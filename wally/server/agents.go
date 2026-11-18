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

// Agent: quién es, de qué se ocupa y con qué contexto trabaja. GENÉRICO (Miguel, 2026-11-17: «que no sea sólo para
// recontextualizar knowledge»): el contexto es lo que se le escriba (Notes), los archivos que se le adjunten (Files,
// con su texto sacado en esta máquina, como los de una pregunta) y, si viene al caso, temas de knowledge (Topics).
type Agent struct {
	Name   string       `json:"name"`
	Intent string       `json:"intent"`
	Notes  string       `json:"notes,omitempty"`
	Files  []Attachment `json:"files,omitempty"`
	Topics []string     `json:"topics,omitempty"`
	// Provider: con qué proveedor contesta ESTE agente («aistudio», «deepseek», «chatgpt», «groq»); vacío, el de la
	// configuración. Elegirlo acá es la decisión de Miguel para este agente: vale aunque el permiso general de agentes
	// esté apagado (Miguel, 2026-11-17).
	Provider string `json:"provider,omitempty"`
}

// AgentRow es una fila de la lista de agentes, con lo que cambió en main en sus temas.
type AgentRow struct {
	Conv    string    `json:"conv"`
	Agent   Agent     `json:"agent"`
	Model   string    `json:"model"`
	Count   int       `json:"count"`
	Updated time.Time `json:"updated"`
	Changed int       `json:"changed"` // fuentes de sus temas que cambiaron (o ya no están) en main
	// Preload: cuántos caracteres viajan en cada pregunta antes de la conversación (WALLY.md + su contexto), estimado
	// sin git: alcanza para avisar si no le entra a un proveedor con tope.
	Preload int `json:"preload"`
	// History: los caracteres de la conversación guardada, que también viajan.
	History int `json:"history"`
	// Effective: por dónde va a contestar, con la configuración de ahora (el suyo, o la regla general).
	Effective string `json:"effective"`
}

// preloadSize estima lo que el agente manda antes de la conversación: WALLY.md, sus notas, sus archivos, sus temas y
// una línea por fuente (lo que `sourcesReport` agrega).
func (a *app) preloadSize(ag Agent) int {
	n := 600 + len(ag.Notes)
	if raw, err := os.ReadFile(filepath.Join(a.root, "wally", "WALLY.md")); err == nil {
		n += len([]rune(string(raw)))
	}
	for _, f := range ag.Files {
		n += f.Chars + 80
	}
	for _, t := range ag.Topics {
		if raw, err := os.ReadFile(filepath.Join(a.root, "knowledge", t, "rules.md")); err == nil {
			n += len([]rune(string(raw)))
		}
		if s, err := a.topicSources(t); err == nil {
			n += len(s) * 160
		}
	}
	return n
}

// setAgentProvider: `PUT /api/agents/{conv}` con {provider}; vacío vuelve a la configuración.
func (a *app) setAgentProvider(w http.ResponseWriter, r *http.Request) {
	// Lo que no viene no se toca: `provider` (legado), y la intención o las notas (bin/wally agent update).
	var in struct {
		Provider *string `json:"provider"`
		Intent   *string `json:"intent"`
		Notes    *string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	if in.Provider != nil {
		if _, ok := providerModels[*in.Provider]; *in.Provider != "" && !ok {
			writeErr(w, 400, fmt.Errorf("no existe el proveedor «%s»", *in.Provider))
			return
		}
	}
	if in.Intent != nil && strings.TrimSpace(*in.Intent) == "" {
		writeErr(w, 400, errors.New("la intención no puede quedar vacía"))
		return
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c, ok := a.store.convs[r.PathValue("conv")]
	if !ok || c.Agent == nil {
		writeErr(w, 404, errors.New("no existe ese agente"))
		return
	}
	if in.Provider != nil {
		c.Agent.Provider = *in.Provider
	}
	if in.Intent != nil {
		c.Agent.Intent = strings.TrimSpace(*in.Intent)
	}
	if in.Notes != nil {
		c.Agent.Notes = *in.Notes
	}
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}

func (a *app) listAgents(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	var rows []AgentRow
	for _, c := range a.store.convs {
		if c.Agent != nil {
			history := 0
			for _, m := range c.Messages {
				history += len([]rune(m.Text))
				for _, f := range append(append([]Attachment{}, m.Files...), commandOutputs(m)...) {
					history += f.Chars
				}
			}
			rows = append(rows, AgentRow{Conv: c.ID, Agent: *c.Agent, Model: c.Model, Count: len(c.Messages), Updated: c.Updated, History: history})
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
	cfg := a.config.get()
	for i := range rows {
		rows[i].Preload = a.preloadSize(rows[i].Agent)
		rows[i].Effective = cfg.providerForAgent("asistente", &rows[i].Agent)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Agent.Name < rows[j].Agent.Name })
	writeJSON(w, 200, map[string]any{"agents": rows})
}

// createAgent abre la conversación del agente, vacía: no le pregunta nada a Google. Su contexto viaja con la
// primera pregunta (agentContext).
func (a *app) createAgent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Agent
		FileIDs []string `json:"fileIds"`
		Model   string   `json:"model"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	ag := Agent{Name: strings.TrimSpace(in.Name), Intent: strings.TrimSpace(in.Intent), Notes: strings.TrimSpace(in.Notes)}
	for _, id := range in.FileIDs {
		att, err := a.attachment(id)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		ag.Files = append(ag.Files, att)
	}
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
	if in.Model == "" {
		in.Model = a.chatModels()[0].Name
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

// agentContext es lo que el agente lleva SIEMPRE, antes de la conversación: quién es, lo que tiene que saber, sus
// archivos y, si tiene, el texto VIGENTE de sus temas de knowledge con el estado de sus fuentes. Se arma en cada
// pregunta: si se aplicó una propuesta o cambió un tema, la próxima ya lo ve.
func (a *app) agentContext(ctx context.Context, ag Agent) (string, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "Sos **%s**, uno de los agentes de Wally. Tu intención: %s.\n\n", ag.Name, ag.Intent)
	b.WriteString("Esta conversación es tuya y larga: Miguel vuelve a ella cuando hay algo de lo tuyo. Abajo va tu contexto " +
		"precargado, leído en este momento. Trabajá sobre eso y con esa intención; si te piden algo que cae afuera, decilo. " +
		"Si necesitás ver algo de la máquina (código, knowledge, trampas), pedí comandos de lectura como dice WALLY.md.\n")
	if ag.Notes != "" {
		fmt.Fprintf(&b, "\n===== lo que tenés que saber =====\n%s\n===== fin =====\n", ag.Notes)
	}
	for _, f := range ag.Files {
		text, err := a.fileText(f.ID)
		if err != nil {
			fmt.Fprintf(&b, "\n(el archivo «%s» ya no está)\n", f.Name)
			continue
		}
		fmt.Fprintf(&b, "\n----- archivo «%s» -----\n%s\n----- fin de «%s» -----\n", f.Name, strings.TrimRight(text, "\n"), f.Name)
	}
	if len(ag.Topics) > 0 {
		b.WriteString("\nTemas de knowledge que te tocan: su texto vigente y el estado de sus fuentes contra main (CAMBIÓ = el " +
			"archivo es distinto del que se revisó). Lo que propongas para knowledge va en el formato de propuesta de " +
			"WALLY.md: nadie lo escribe sin verificarlo contra main.\n")
	}
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
