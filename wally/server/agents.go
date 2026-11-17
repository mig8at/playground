package main

// LOS AGENTES (idea de Miguel, 2026-11-17): una lista de chats con nombre propio (Pikachu, …), cada uno con UNA
// intención —poner y tener al día el contexto local de una parte, p. ej. KYC— y sus temas de knowledge. No hablan
// entre ellos: cada uno es una conversación larga, en el modo asistente (WALLY.md y sus comandos de lectura), que
// lleva SIEMPRE precargado el texto vigente de sus temas y el estado de sus fuentes contra main. Así, cuando cambia
// algo en main, se ve qué agente lo tiene que tomar (la cuenta de fuentes cambiadas en la lista) y él ya arranca con
// el contexto puesto. Compactar la conversación cuando crezca queda para más adelante.
//
// El agente vive DENTRO de su conversación (Conversation.Agent): la lista, borrar y los comandos son los de siempre.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Agent: quién es y de qué se ocupa. Los temas son ids de knowledge/.
type Agent struct {
	Name   string   `json:"name"`
	Intent string   `json:"intent"`
	Topics []string `json:"topics"`
}

// AgentRow es una fila de la lista de agentes, con lo que cambió en main en sus temas.
type AgentRow struct {
	Conv    string    `json:"conv"`
	Agent   Agent     `json:"agent"`
	Model   string    `json:"model"`
	Count   int       `json:"count"`
	Updated time.Time `json:"updated"`
	Changed int       `json:"changed"` // fuentes de sus temas que cambiaron (o ya no están) en main
}

func (a *app) listAgents(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	var rows []AgentRow
	for _, c := range a.store.convs {
		if c.Agent != nil {
			rows = append(rows, AgentRow{Conv: c.ID, Agent: *c.Agent, Model: c.Model, Count: len(c.Messages), Updated: c.Updated})
		}
	}
	a.store.mu.Unlock()
	// Todas las fuentes de todos los agentes, contra main de una vez: un `git cat-file` por repo y no uno por
	// fuente (con 9 agentes y 48 temas, uno por fuente tardaba 16 s y la lista salía vacía hasta entonces).
	byTopic := map[string][]source{}
	var all []source
	for _, row := range rows {
		for _, t := range row.Agent.Topics {
			if _, ok := byTopic[t]; !ok {
				byTopic[t], _ = a.topicSources(t)
				all = append(all, byTopic[t]...)
			}
		}
	}
	blobs := a.blobsAtMain(r.Context(), all)
	for i := range rows {
		for _, t := range rows[i].Agent.Topics {
			for _, s := range byTopic[t] {
				if blobs[s.Repo+":"+s.Path] != s.Blob {
					rows[i].Changed++
				}
			}
		}
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Agent.Name < rows[j].Agent.Name })
	writeJSON(w, 200, map[string]any{"agents": rows})
}

// createAgent abre la conversación del agente, vacía: no le pregunta nada a Google. Su contexto viaja con la
// primera pregunta (agentContext).
func (a *app) createAgent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Agent
		Model string `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	ag := Agent{Name: strings.TrimSpace(in.Name), Intent: strings.TrimSpace(in.Intent)}
	if ag.Name == "" || ag.Intent == "" {
		writeErr(w, 400, errors.New("el agente necesita nombre e intención"))
		return
	}
	for _, t := range in.Topics {
		if _, err := a.topicSources(t); err != nil {
			writeErr(w, 400, fmt.Errorf("el tema «%s»: %v", t, err))
			return
		}
		ag.Topics = append(ag.Topics, t)
	}
	if len(ag.Topics) == 0 {
		writeErr(w, 400, errors.New("el agente necesita al menos un tema de knowledge"))
		return
	}
	if in.Model == "" {
		in.Model = chatModels[0].Name
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	for _, c := range a.store.convs {
		if c.Agent != nil && strings.EqualFold(c.Agent.Name, ag.Name) {
			writeErr(w, 400, fmt.Errorf("ya hay un agente que se llama %s", c.Agent.Name))
			return
		}
	}
	now := time.Now()
	c := &Conversation{ID: newID(), Title: ag.Name + " · " + ag.Intent, Model: in.Model, Mode: "asistente", Agent: &ag,
		Created: now, Updated: now, Messages: []Message{}}
	a.store.convs[c.ID] = c
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}

// blobsAtMain: el blob de cada fuente en la ref de main de su repo («repo:ruta» → blob; sin entrada si no está).
func (a *app) blobsAtMain(ctx context.Context, sources []source) map[string]string {
	paths := map[string][]string{}
	for _, s := range sources {
		paths[s.Repo] = append(paths[s.Repo], s.Path)
	}
	out := map[string]string{}
	for repo, list := range paths {
		dir, ref, err := a.repoDir(repo)
		if err != nil {
			continue
		}
		var in strings.Builder
		for _, p := range list {
			fmt.Fprintf(&in, "%s:%s\n", ref, p)
		}
		cmd := exec.CommandContext(ctx, "git", "-C", dir, "cat-file", "--batch-check=%(objectname)")
		cmd.Stdin = strings.NewReader(in.String())
		raw, err := cmd.Output()
		if err != nil {
			continue
		}
		// Una línea por pedido, en orden: el blob, o «<ref:ruta> missing».
		for i, line := range strings.Split(strings.TrimRight(string(raw), "\n"), "\n") {
			if i < len(list) && !strings.HasSuffix(line, " missing") {
				out[repo+":"+list[i]] = strings.TrimSpace(line)
			}
		}
	}
	return out
}

// changedSources: las fuentes del tema cuyo blob en main ya no es el revisado (o que ya no están).
func (a *app) changedSources(ctx context.Context, topic string) []source {
	sources, err := a.topicSources(topic)
	if err != nil {
		return nil
	}
	var out []source
	for _, s := range sources {
		dir, ref, err := a.repoDir(s.Repo)
		if err != nil {
			continue
		}
		if blob, err := git(ctx, dir, "rev-parse", ref+":"+s.Path); err != nil || strings.TrimSpace(blob) != s.Blob {
			out = append(out, s)
		}
	}
	return out
}

// agentContext es lo que el agente lleva SIEMPRE, antes de la conversación: quién es, y el texto VIGENTE de sus temas
// con el estado de sus fuentes. Se arma en cada pregunta: si alguien aplicó una propuesta, la próxima ya lo ve.
func (a *app) agentContext(ctx context.Context, ag Agent) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Sos **%s**, uno de los agentes de Wally, con UNA intención: %s.\n\n", ag.Name, ag.Intent)
	b.WriteString("Esta conversación es tuya y larga: Miguel vuelve a ella cada vez que algo cambia en tu parte. Abajo va tu " +
		"contexto precargado, leído en este momento: el texto vigente de cada tema de knowledge que te toca y el estado de " +
		"sus fuentes contra main (CAMBIÓ = el archivo es distinto del que se revisó). Trabajá sólo sobre tu parte; si algo " +
		"cae afuera, decilo y nombrá qué tema le tocaría. Para ver código o diffs, pedí comandos como dice WALLY.md, y lo " +
		"que propongas para knowledge va en su formato de propuesta: nadie lo escribe sin verificarlo contra main.\n")
	for _, t := range ag.Topics {
		raw, err := os.ReadFile(filepath.Join(a.root, "knowledge", t, "rules.md"))
		if err != nil {
			return "", fmt.Errorf("no pude leer el tema %s: %v", t, err)
		}
		report, err := a.sourcesReport(ctx, t)
		if err != nil {
			return "", err
		}
		fmt.Fprintf(&b, "\n===== tema %s =====\n%s\n\n----- sus fuentes -----\n%s===== fin de %s =====\n",
			t, strings.TrimRight(string(raw), "\n"), report, t)
	}
	return b.String(), nil
}
