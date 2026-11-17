package main

// EL GRUPO «KNOWLEDGE»: varios agentes que trabajan la biblioteca a la vez, cada uno con su tema, y un chat del grupo
// donde cada uno deja sólo su resumen (idea de Miguel, 2026-11-17, como los agentes del chat del equipo). La
// conversación completa de cada agente es una conversación normal de Wally: se abre desde el grupo.
//
//   - EL COORDINADOR es Wally y NO usa el modelo: reparte con código (los temas con fuentes cambiadas en main, o los
//     que se le pasan) y escribe el plan y el cierre. Así no gasta cuota de Google.
//   - LOS AGENTES son EVA y M-O. Cada uno toma un tema de la cola y recibe EL PAQUETE EN UN SOLO ENVÍO (las fuentes,
//     los diffs de las que cambiaron y las secciones que respaldan; o el tema entero si se pide revisarlo), como
//     fichas adjuntas: así una vuelta alcanza casi siempre, y cada vuelta de menos es una consulta menos a Google, que
//     corta por el ritmo de la cuenta. Si piden más, los comandos de la lista blanca se corren SOLOS (son de sólo
//     lectura); hasta 5 vueltas.
//   - NADA SE ESCRIBE en knowledge/: las propuestas quedan en la conversación de cada agente y su resumen en el grupo,
//     para que Miguel o Claude las verifiquen contra main y las apliquen.
//   - En paralelo con freno: el pool (pool.go) corre hasta 2 preguntas a la vez y escalona los comienzos. Si Google
//     corta, el agente espera a que venza la pausa y reintenta.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var agentNames = []string{"EVA", "M-O"}

const (
	agentMaxRounds   = 5
	agentMaxCommands = 6
	agentMaxPauses   = 4
)

type GroupPost struct {
	ID     string    `json:"id"`
	At     time.Time `json:"at"`
	Author string    `json:"author"` // Wally (el coordinador) · EVA · M-O
	Kind   string    `json:"kind"`   // plan · toma · resumen · pausa · error · cierre
	Text   string    `json:"text"`
	Conv   string    `json:"conv,omitempty"` // la conversación del agente, para abrirla
	Topic  string    `json:"topic,omitempty"`
}

type GroupMember struct {
	Name   string `json:"name"`
	Status string `json:"status"` // esperando · trabajando · en pausa · listo
	Topic  string `json:"topic,omitempty"`
	Conv   string `json:"conv,omitempty"`
	Rounds int    `json:"rounds,omitempty"`
	Done   int    `json:"done"`
}

type Group struct {
	ID      string        `json:"id"`
	Title   string        `json:"title"`
	Model   string        `json:"model"`
	Status  string        `json:"status"` // corriendo · terminado
	Created time.Time     `json:"created"`
	Updated time.Time     `json:"updated"`
	Members []GroupMember `json:"members"`
	Posts   []GroupPost   `json:"posts"`
}

type groupStore struct {
	mu     sync.Mutex
	file   string
	groups map[string]*Group
}

func (g *groupStore) load() error {
	g.groups = map[string]*Group{}
	raw, err := os.ReadFile(g.file)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var list []*Group
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, x := range list {
		// Un grupo que corría cuando se apagó el servidor no sigue: queda cortado y se dice.
		if x.Status == "corriendo" {
			x.Status = "terminado"
			for i := range x.Members {
				if x.Members[i].Status != "listo" {
					x.Members[i].Status = "cortado"
				}
			}
			x.Posts = append(x.Posts, GroupPost{ID: newID(), At: time.Now(), Author: "Wally", Kind: "error",
				Text: "Se cortó: el servidor de Wally se reinició mientras el grupo trabajaba. Lo que quedó a medias está en cada conversación."})
		}
		g.groups[x.ID] = x
	}
	return nil
}

// save se llama con mu tomado.
func (g *groupStore) save() error {
	list := make([]*Group, 0, len(g.groups))
	for _, x := range g.groups {
		list = append(list, x)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Updated.After(list[j].Updated) })
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(g.file), 0o755); err != nil {
		return err
	}
	tmp := g.file + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, g.file)
}

// update cambia un grupo con el candado tomado y lo guarda.
func (g *groupStore) update(id string, fn func(*Group)) {
	g.mu.Lock()
	defer g.mu.Unlock()
	x := g.groups[id]
	if x == nil {
		return
	}
	fn(x)
	x.Updated = time.Now()
	if err := g.save(); err != nil {
		log.Printf("wally: no pude guardar el grupo %s: %v", id, err)
	}
}

func (g *groupStore) post(id string, p GroupPost) {
	p.ID, p.At = newID(), time.Now()
	g.update(id, func(x *Group) { x.Posts = append(x.Posts, p) })
}

func (g *groupStore) member(id, name string, fn func(*GroupMember)) {
	g.update(id, func(x *Group) {
		for i := range x.Members {
			if x.Members[i].Name == name {
				fn(&x.Members[i])
			}
		}
	})
}

// ── la API ──────────────────────────────────────────────────────────────────────────────────────────────────────

type GroupSummary struct {
	ID      string        `json:"id"`
	Title   string        `json:"title"`
	Status  string        `json:"status"`
	Updated time.Time     `json:"updated"`
	Members []GroupMember `json:"members"`
	Posts   int           `json:"posts"`
}

func (a *app) listGroups(w http.ResponseWriter, r *http.Request) {
	a.groups.mu.Lock()
	defer a.groups.mu.Unlock()
	out := make([]GroupSummary, 0, len(a.groups.groups))
	for _, x := range a.groups.groups {
		out = append(out, GroupSummary{x.ID, x.Title, x.Status, x.Updated, x.Members, len(x.Posts)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	writeJSON(w, 200, map[string]any{"groups": out})
}

func (a *app) getGroup(w http.ResponseWriter, r *http.Request) {
	a.groups.mu.Lock()
	defer a.groups.mu.Unlock()
	x, ok := a.groups.groups[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, errors.New("no existe ese grupo"))
		return
	}
	writeJSON(w, 200, x)
}

func (a *app) deleteGroup(w http.ResponseWriter, r *http.Request) {
	a.groups.mu.Lock()
	defer a.groups.mu.Unlock()
	x, ok := a.groups.groups[r.PathValue("id")]
	if ok && x.Status == "corriendo" {
		writeErr(w, 409, errors.New("el grupo todavía está trabajando"))
		return
	}
	delete(a.groups.groups, r.PathValue("id"))
	if err := a.groups.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// task es un tema para un agente: ponerlo al día (con sus fuentes cambiadas) o revisarlo (sin cambios).
type task struct {
	Topic   string
	Changed []source
}

// createGroup arma el grupo y lo pone a trabajar: POST /api/groups {topics?: [..], model?}. Sin temas, toma los que
// tienen fuentes cambiadas en main; con temas, ésos (si no cambió nada, los revisa).
func (a *app) createGroup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Topics []string `json:"topics"`
		Model  string   `json:"model"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	if in.Model == "" {
		in.Model = chatModels[0].Name
	}
	ctx := context.Background()
	pending, err := a.pendingTopics(ctx)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	var tasks []task
	if len(in.Topics) == 0 {
		for _, t := range sortedKeys(pending) {
			tasks = append(tasks, task{Topic: t, Changed: pending[t]})
		}
		if len(tasks) == 0 {
			writeErr(w, 400, errors.New("la biblioteca está al día con main: no hay temas con fuentes cambiadas. Elegí temas para revisar"))
			return
		}
	} else {
		for _, t := range in.Topics {
			if _, err := a.topicSources(t); err != nil {
				writeErr(w, 400, err)
				return
			}
			tasks = append(tasks, task{Topic: t, Changed: pending[t]})
		}
	}

	g := &Group{ID: newID(), Model: in.Model, Status: "corriendo", Created: time.Now(), Updated: time.Now()}
	g.Title = fmt.Sprintf("Knowledge · %d tema%s", len(tasks), map[bool]string{true: "", false: "s"}[len(tasks) == 1])
	for _, n := range agentNames {
		g.Members = append(g.Members, GroupMember{Name: n, Status: "esperando"})
	}
	g.Posts = append(g.Posts, GroupPost{ID: newID(), At: time.Now(), Author: "Wally", Kind: "plan", Text: planText(tasks, in.Model)})
	a.groups.mu.Lock()
	a.groups.groups[g.ID] = g
	err = a.groups.save()
	a.groups.mu.Unlock()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	go a.runGroup(g.ID, in.Model, tasks)
	writeJSON(w, 200, g)
}

func sortedKeys(m map[string][]source) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func planText(tasks []task, model string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Somos %s, con %s. Hay %d tema%s en la cola; cada uno va con su paquete en un solo envío, y nadie escribe en knowledge: las propuestas quedan para revisar.\n",
		strings.Join(agentNames, " y "), model, len(tasks), map[bool]string{true: "", false: "s"}[len(tasks) == 1])
	for _, t := range tasks {
		if len(t.Changed) > 0 {
			fmt.Fprintf(&b, "\n- `%s`: poner al día (%d fuente%s cambió en main)", t.Topic, len(t.Changed), map[bool]string{true: "", false: "s"}[len(t.Changed) == 1])
		} else {
			fmt.Fprintf(&b, "\n- `%s`: revisar si sigue siendo cierto (sus fuentes no cambiaron)", t.Topic)
		}
	}
	return b.String()
}

// pendingTopics: los temas con fuentes que cambiaron en main desde su revisión (lo mismo que knowledge-check).
func (a *app) pendingTopics(ctx context.Context) (map[string][]source, error) {
	dirs, err := os.ReadDir(filepath.Join(a.root, "knowledge"))
	if err != nil {
		return nil, err
	}
	out := map[string][]source{}
	for _, d := range dirs {
		if !d.IsDir() || !topicID.MatchString(d.Name()) {
			continue
		}
		sources, err := a.topicSources(d.Name())
		if err != nil {
			continue
		}
		for _, s := range sources {
			dir, ref, err := a.repoDir(s.Repo)
			if err != nil {
				continue
			}
			blob, err := git(ctx, dir, "rev-parse", ref+":"+s.Path)
			if err != nil || strings.TrimSpace(blob) != s.Blob {
				out[d.Name()] = append(out[d.Name()], s)
			}
		}
	}
	return out, nil
}

// runGroup: los agentes toman temas de la cola hasta vaciarla; el coordinador cierra.
func (a *app) runGroup(id, model string, tasks []task) {
	queue := make(chan task, len(tasks))
	for _, t := range tasks {
		queue <- t
	}
	close(queue)
	var wg sync.WaitGroup
	results := make(chan string, len(tasks))
	for _, name := range agentNames {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			for t := range queue {
				results <- a.agentWork(id, name, model, t)
			}
			a.groups.member(id, name, func(m *GroupMember) { m.Status, m.Topic, m.Rounds = "listo", "", 0 })
		}(name)
	}
	wg.Wait()
	close(results)
	var lines []string
	for r := range results {
		lines = append(lines, r)
	}
	sort.Strings(lines)
	a.groups.post(id, GroupPost{Author: "Wally", Kind: "cierre", Text: "Terminamos. Lo que dejó cada uno:\n\n" + strings.Join(lines, "\n") +
		"\n\nNada se escribió en knowledge: las propuestas están en la conversación de cada agente, para verificarlas contra main y aplicarlas."})
	a.groups.update(id, func(x *Group) { x.Status = "terminado" })
}

var summaryLine = regexp.MustCompile(`(?mi)^[\s>*_#-]*RESUMEN[\s*_]*:[\s*_]*(.+?)[\s*_]*$`)

// agentWork: un agente con un tema, hasta que propone (o se rinde). Devuelve la línea para el cierre.
func (a *app) agentWork(groupID, name, model string, t task) string {
	ctx := context.Background()
	a.groups.member(groupID, name, func(m *GroupMember) { m.Status, m.Topic, m.Conv, m.Rounds = "trabajando", t.Topic, "", 0 })
	a.groups.post(groupID, GroupPost{Author: name, Kind: "toma", Topic: t.Topic, Text: fmt.Sprintf("Tomo `%s`. Armo el paquete y lo mando.", t.Topic)})

	files, err := a.taskPack(ctx, t)
	if err != nil {
		a.groups.post(groupID, GroupPost{Author: name, Kind: "error", Topic: t.Topic, Text: "No pude armar el paquete: " + err.Error()})
		return fmt.Sprintf("- %s · `%s`: no pude armar el paquete", name, t.Topic)
	}
	text := agentBrief(name, t)
	convID := ""
	var c Conversation
	for round := 1; round <= agentMaxRounds; round++ {
		a.groups.member(groupID, name, func(m *GroupMember) { m.Rounds, m.Status = round, "trabajando" })
		c, err = a.askWithPauses(ctx, groupID, name, askInput{ID: convID, Model: model, Text: text, Files: files, Mode: "asistente",
			Title: fmt.Sprintf("%s · %s", name, t.Topic)})
		if err != nil {
			a.groups.post(groupID, GroupPost{Author: name, Kind: "error", Topic: t.Topic, Conv: convID, Text: "Me quedé sin respuesta: " + err.Error()})
			return fmt.Sprintf("- %s · `%s`: sin respuesta (%s)", name, t.Topic, firstLine(err.Error()))
		}
		if convID == "" {
			convID = c.ID
			a.groups.member(groupID, name, func(m *GroupMember) { m.Conv = convID })
		}
		files = nil
		last := c.Messages[len(c.Messages)-1]
		var ran, skipped int
		for i, cmd := range last.Commands {
			if cmd.Status != "propuesto" {
				continue
			}
			action := "run"
			if i >= agentMaxCommands {
				action = "decline"
			}
			if _, _, err := a.decideCommand(ctx, convID, last.ID, cmd.ID, action); err == nil && action == "run" {
				ran++
			} else {
				skipped++
			}
		}
		if ran == 0 {
			summary := "terminó sin línea RESUMEN: ver su conversación"
			if m := summaryLine.FindAllStringSubmatch(last.Text, -1); len(m) > 0 {
				summary = strings.TrimSpace(m[len(m)-1][1])
			}
			a.groups.post(groupID, GroupPost{Author: name, Kind: "resumen", Topic: t.Topic, Conv: convID,
				Text: fmt.Sprintf("`%s` · %s (%d vuelta%s)", t.Topic, summary, round, map[bool]string{true: "", false: "s"}[round == 1])})
			a.groups.member(groupID, name, func(m *GroupMember) { m.Done++; m.Status = "esperando" })
			return fmt.Sprintf("- %s · `%s`: %s", name, t.Topic, summary)
		}
		text = fmt.Sprintf("Corrí %d comando%s que pediste (solos: son de lectura)%s; la salida va pegada a tu respuesta. Seguí, y cerrá con la línea RESUMEN.",
			ran, map[bool]string{true: "", false: "s"}[ran == 1], map[bool]string{true: "", false: fmt.Sprintf("; %d quedaron afuera (más de %d por vuelta)", skipped, agentMaxCommands)}[skipped == 0])
	}
	a.groups.post(groupID, GroupPost{Author: name, Kind: "error", Topic: t.Topic, Conv: convID,
		Text: fmt.Sprintf("Llegué a %d vueltas sin cerrar: lo que tengo está en mi conversación.", agentMaxRounds)})
	return fmt.Sprintf("- %s · `%s`: no cerró en %d vueltas", name, t.Topic, agentMaxRounds)
}

// askWithPauses: si Google cortó, espera a que venza la pausa (y un poco más) y reintenta, hasta agentMaxPauses.
func (a *app) askWithPauses(ctx context.Context, groupID, name string, in askInput) (Conversation, error) {
	retried := false
	for i := 0; ; i++ {
		c, err := a.askInConversation(ctx, in)
		var p errPaused
		if bad := (errBadRequest{}); err != nil && !errors.As(err, &p) && !retried && !errors.As(err, &bad) {
			// Un error que no es de Google (la pestaña no abrió, el pool se reinició) se reintenta UNA vez, a los 30 s.
			retried = true
			a.groups.post(groupID, GroupPost{Author: name, Kind: "pausa", Text: fmt.Sprintf("Falló (%s). Lo intento de nuevo en 30 s.", firstLine(err.Error()))})
			time.Sleep(30 * time.Second)
			continue
		}
		if err == nil || !errors.As(err, &p) || i >= agentMaxPauses {
			return c, err
		}
		wait := time.Until(p.until) + 20*time.Second
		if wait < 30*time.Second {
			wait = 30 * time.Second
		}
		if wait > 6*time.Minute {
			wait = 6 * time.Minute
		}
		until := time.Now().Add(wait)
		a.groups.member(groupID, name, func(m *GroupMember) { m.Status = "en pausa hasta las " + until.Format("15:04") })
		a.groups.post(groupID, GroupPost{Author: name, Kind: "pausa", Text: fmt.Sprintf("Google cortó (%s). Espero hasta las %s y vuelvo a mandar.", firstLine(p.msg), until.Format("15:04"))})
		time.Sleep(wait)
	}
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if r := []rune(s); len(r) > 140 {
		s = string(r[:140]) + "…"
	}
	return s
}

// taskPack arma el paquete de un tema, como fichas adjuntas (las salidas de los mismos comandos de la lista blanca).
func (a *app) taskPack(ctx context.Context, t task) ([]Attachment, error) {
	var cmds []string
	if len(t.Changed) == 0 {
		cmds = []string{"make knowledge-read ID=" + t.Topic, "fuentes " + t.Topic}
	} else {
		cmds = []string{"fuentes " + t.Topic}
		sections := map[string]bool{}
		var order []string
		for _, s := range t.Changed {
			cmds = append(cmds, fmt.Sprintf("diff %s %s:%s", t.Topic, s.Repo, s.Path))
			for _, sec := range s.Sections {
				if !sections[sec] {
					sections[sec] = true
					order = append(order, sec)
				}
			}
		}
		for _, sec := range order {
			cmds = append(cmds, fmt.Sprintf("make knowledge-read ID=%s#%s", t.Topic, sec))
		}
	}
	var files []Attachment
	for _, c := range cmds {
		att, _, err := a.runToFile(ctx, c, c)
		if err != nil {
			return nil, fmt.Errorf("%s: %v", c, err)
		}
		files = append(files, att)
	}
	return files, nil
}

// agentBrief: el pedido al agente. Lo demás (cómo pedir, el formato de propuesta) está en WALLY.md, que va antes.
func agentBrief(name string, t task) string {
	who := fmt.Sprintf("Sos %s, uno de los agentes del grupo Knowledge que coordina Wally (los otros trabajan otros temas en paralelo). ", name)
	end := "\n\nNo escribís nada: proponés, en el formato de WALLY.md, y Miguel o Claude lo verifican. En la ÚLTIMA línea escribí `RESUMEN:` y, en una sola línea, el veredicto (por ejemplo: «3 siguen ciertas; #x cambió; a #y le falta algo»)."
	if len(t.Changed) > 0 {
		var paths []string
		for _, s := range t.Changed {
			paths = append(paths, fmt.Sprintf("%s:%s", s.Repo, s.Path))
		}
		return who + fmt.Sprintf("Tu tarea: poner al día el tema `%s`. Cambiaron en main: %s. Te adjunto el paquete: las fuentes del tema, el diff de cada una que cambió y las secciones que respaldan. Con eso deberías poder proponer sin pedir nada; si de verdad te falta ver algo (el otro monolito, el contexto de un cambio), pedilo con un bloque de comandos (se corre solo: es de lectura) y no pidas lo que ya está adjunto.",
			t.Topic, strings.Join(paths, ", ")) + end
	}
	return who + fmt.Sprintf("Tu tarea: revisar el tema `%s`. Sus fuentes no cambiaron desde la revisión, pero queremos saber si lo que dice sigue siendo cierto en main. Te adjunto el tema entero y sus fuentes. Elegí las 3 a 5 afirmaciones más específicas y fáciles de comprobar (un método, una condición, un número), pedí sólo los rangos de código que hagan falta (`buscar` y `codigo …:desde-hasta`; se corren solos) y proponé sólo lo que encuentres mal o incompleto. Si todo se sostiene, decilo.",
		t.Topic) + end
}

// listTopics: los temas de knowledge con su título, para elegir qué revisar al armar un grupo; y cuáles tienen fuentes
// cambiadas en main.
func (a *app) listTopics(w http.ResponseWriter, r *http.Request) {
	dirs, err := os.ReadDir(filepath.Join(a.root, "knowledge"))
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	pending, _ := a.pendingTopics(r.Context())
	type topic struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Changed int    `json:"changed"`
	}
	var out []topic
	for _, d := range dirs {
		if !d.IsDir() || !topicID.MatchString(d.Name()) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(a.root, "knowledge", d.Name(), "rules.md"))
		if err != nil {
			continue
		}
		title := d.Name()
		if line := strings.SplitN(string(raw), "\n", 2)[0]; strings.HasPrefix(line, "# ") {
			title = strings.TrimPrefix(line, "# ")
		}
		out = append(out, topic{d.Name(), title, len(pending[d.Name()])})
	}
	writeJSON(w, 200, map[string]any{"topics": out})
}
