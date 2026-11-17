// WALLY: un chat para hacerle preguntas a Gemini eligiendo el modelo, POR LA WEB de AI Studio: cada pregunta la hace
// `bin/aistudio` (la receta jarvis/recipes/aistudio/ask.ts) en el Chrome de Miguel con Jarvis, con su cuenta y en un
// chat temporal, sin llave de API: usa el uso gratuito de la web, no la cuota de una llave. La interfaz (wally/src,
// :5228) habla con esta API (:5229), que guarda las conversaciones en disco (`wally/.data/conversations.json`).
//
// Cada pregunta abre un chat NUEVO en AI Studio: la conversación anterior viaja en el texto, como transcripción. Las
// preguntas van de a una (Jarvis maneja una pestaña por vez), y cuando Google corta («Permiso denegado», 403, cuota)
// la receta deja una pausa de 1 a 5 min, al azar, para toda la cuenta (`~/.cache/my-tools/aistudio-pausa.json`): Wally la muestra
// y no deja preguntar hasta que vence.
//
//	go run ./wally/server -serve 127.0.0.1:5229
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

func main() {
	serve := flag.String("serve", "127.0.0.1:5229", "dónde escucha la API")
	flag.Parse()
	root, err := repoRoot()
	if err != nil {
		log.Fatal(err)
	}
	st := &store{file: filepath.Join(root, "wally", ".data", "conversations.json")}
	if err := st.load(); err != nil {
		log.Fatal(err)
	}
	cs := &configStore{file: filepath.Join(root, "wally", ".data", "config.json")}
	cs.load()
	a := &app{store: st, root: root, pool: &pool{root: root}, config: cs}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/models", a.models)
	mux.HandleFunc("GET /api/conversations", a.list)
	mux.HandleFunc("GET /api/conversations/{id}", a.get)
	mux.HandleFunc("DELETE /api/conversations/{id}", a.remove)
	mux.HandleFunc("DELETE /api/conversations/{id}/messages/{mid}", a.removeMessage)
	mux.HandleFunc("POST /api/ask", a.ask)
	mux.HandleFunc("POST /api/conversations/{id}/messages/{mid}/commands/{cid}", a.commandAction)
	mux.HandleFunc("GET /api/topics", a.listTopics)
	mux.HandleFunc("GET /api/main", a.mainConversation)
	mux.HandleFunc("GET /api/config", a.getConfig)
	mux.HandleFunc("GET /api/providers", a.providers)
	mux.HandleFunc("POST /api/providers/check", a.checkProvidersNow)
	mux.HandleFunc("PUT /api/config", a.putConfig)
	mux.HandleFunc("GET /api/usage", a.usage)
	mux.HandleFunc("GET /api/agents", a.listAgents)
	mux.HandleFunc("POST /api/agents", a.createAgent)
	mux.HandleFunc("PUT /api/agents/{conv}", a.setAgentProvider)
	mux.HandleFunc("PUT /api/conversations/{id}/provider", a.setConversationProvider)
	mux.HandleFunc("POST /api/files", a.upload)
	mux.HandleFunc("GET /api/files/{id}", a.readFile)
	mux.HandleFunc("DELETE /api/files/{id}", a.deleteFile)
	log.Printf("wally: API en http://%s", *serve)
	// Al arrancar (Cockpit levanta Wally al abrirse), qué proveedores están listos: sin preguntar nada (status.go).
	go func() {
		time.Sleep(5 * time.Second)
		a.checkProviders()
	}()
	log.Fatal(http.ListenAndServe(*serve, mux))
}

// repoRoot sube desde donde se corre hasta la carpeta que tiene go.mod (la raíz de my-tools).
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no encuentro la raíz de my-tools (go.mod) subiendo desde acá")
		}
		dir = parent
	}
}

// ── lo guardado ──────────────────────────────────────────────────────────────────────────────────────

// Message es un BLOQUE guardado: una pregunta tuya (user) o una respuesta (model). Las respuestas dicen con qué modelo
// salieron y cuánto tardaron. Cada bloque se puede borrar por su id: lo que queda es el contexto que viaja en la
// próxima pregunta (AI Studio no recuerda nada: el chat es temporal y cada pregunta abre uno nuevo).
type Message struct {
	ID    string    `json:"id"`
	Role  string    `json:"role"` // user · model
	Text  string    `json:"text"`
	Model string    `json:"model,omitempty"`
	Ms    int64     `json:"ms,omitempty"`
	At    time.Time `json:"at"`
	// Files: los archivos de una pregunta (sólo su ficha; el texto vive en wally/.data/files y viaja en la pregunta).
	Files []Attachment `json:"files,omitempty"`
	// Commands: los comandos que el modelo pidió en una respuesta del modo asistido (commands.go).
	Commands []Command `json:"commands,omitempty"`
}

// Conversation es un chat: el título sale de la primera pregunta.
type Conversation struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Model string `json:"model"` // el último elegido: la interfaz lo vuelve a poner al abrirla
	// Provider: con qué proveedor sigue ESTA conversación, elegido en la barra de escribir (vacío: el de la
	// configuración). Elegirlo es la decisión de Miguel para ésta, también si es de un agente (Miguel, 2026-11-17).
	Provider string `json:"provider,omitempty"`
	// Main: LA conversación con Wally, el orquestador (como «Mi chat» del chat): una sola, arriba en la lista, en el
	// modo asistente (conoce las herramientas por WALLY.md). Miguel, 2026-11-17.
	Main     bool      `json:"main,omitempty"`
	Mode     string    `json:"mode,omitempty"`  // «knowledge»: el modo asistido (commands.go); vacío, un chat
	Agent    *Agent    `json:"agent,omitempty"` // la conversación de un agente (agents.go): su nombre, intención y temas
	Created  time.Time `json:"created"`
	Updated  time.Time `json:"updated"`
	Messages []Message `json:"messages"`
}

type store struct {
	mu    sync.Mutex
	file  string
	convs map[string]*Conversation
}

func (s *store) load() error {
	s.convs = map[string]*Conversation{}
	raw, err := os.ReadFile(s.file)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var list []*Conversation
	if err := json.Unmarshal(raw, &list); err != nil {
		return fmt.Errorf("%s no es JSON válido: %w", s.file, err)
	}
	fixed := false
	for _, c := range list {
		// Los bloques de antes de que se pudieran borrar no tenían id: se les pone uno, una vez.
		for i := range c.Messages {
			if c.Messages[i].ID == "" {
				c.Messages[i].ID = newID()
				fixed = true
			}
		}
		s.convs[c.ID] = c
	}
	if fixed {
		return s.save()
	}
	return nil
}

// save escribe a un temporal y lo renombra: un corte a mitad no deja el archivo roto. Se llama con mu tomado.
func (s *store) save() error {
	list := make([]*Conversation, 0, len(s.convs))
	for _, c := range s.convs {
		list = append(list, c)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Updated.After(list[j].Updated) })
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.file), 0o755); err != nil {
		return err
	}
	tmp := s.file + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.file)
}

func newID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ── la API ───────────────────────────────────────────────────────────────────────────────────────────

type app struct {
	store *store
	root  string
	// pool: las preguntas a AI Studio, en pestañas de una sola conexión (pool.go); él decide cuántas a la vez.
	pool   *pool
	config *configStore
	status statusStore
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// Model es un modelo de chat de AI Studio sin la etiqueta «Paid» (leído del selector de la web el 2026-11-17).
type Model struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Note        string `json:"note,omitempty"`
	Paused      string `json:"paused,omitempty"` // hasta qué hora, si Google lo cortó
}

// chatModels: el modelo con que contesta Wally, que sale de la configuración (config.go): Gemini 4 Hydrogen por AI
// Studio, o DeepSeek por su web. Uno solo a la vez: la interfaz no muestra selector (Miguel, 2026-11-17).
func (a *app) chatModels() []Model { return []Model{providerModels[a.config.get().Provider]} }

// pauses lee las pausas que deja la receta cuando Google corta un modelo: modelo → hasta cuándo (ms).
func pauses() map[string]int64 {
	home, _ := os.UserHomeDir()
	raw, err := os.ReadFile(filepath.Join(home, ".cache", "my-tools", "aistudio-pausa.json"))
	out := map[string]int64{}
	if err != nil {
		return out
	}
	var all map[string]struct {
		Until int64 `json:"until"`
	}
	if json.Unmarshal(raw, &all) != nil {
		return out
	}
	now := time.Now().UnixMilli()
	for m, p := range all {
		if p.Until > now {
			out[m] = p.Until
		}
	}
	return out
}

// mainConversation: `GET /api/main`, la conversación con Wally; si no existe, la crea vacía (no le pregunta nada a nadie).
func (a *app) mainConversation(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	for _, c := range a.store.convs {
		if c.Main {
			writeJSON(w, 200, c)
			return
		}
	}
	now := time.Now()
	c := &Conversation{ID: newID(), Title: "Wally", Mode: "asistente", Main: true, Created: now, Updated: now, Messages: []Message{}}
	a.store.convs[c.ID] = c
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}

// setConversationProvider: `PUT /api/conversations/{id}/provider` con {provider}; vacío o «auto», el de la configuración.
func (a *app) setConversationProvider(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Provider string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	if in.Provider == "auto" {
		in.Provider = ""
	}
	if _, ok := providerModels[in.Provider]; in.Provider != "" && !ok {
		writeErr(w, 400, fmt.Errorf("no existe el proveedor «%s»", in.Provider))
		return
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c, ok := a.store.convs[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	c.Provider = in.Provider
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}

// GET /api/providers: los proveedores con su modelo y su tope por mensaje (para el selector de cada agente).
func (a *app) providers(w http.ResponseWriter, r *http.Request) {
	type row struct {
		ID     string         `json:"id"`
		Model  Model          `json:"model"`
		Limit  int            `json:"limit"`
		Status providerStatus `json:"status"`
		// Context: los tokens que maneja su modelo más poderoso según lo publicado; ContextNote, de dónde sale y lo
		// que aceptó su web gratis por mensaje, medido.
		Context     int    `json:"context"`
		ContextNote string `json:"contextNote"`
		// Paused: hasta qué hora no se le puede preguntar («15:04»), y en ms para la cuenta regresiva.
		Paused      string `json:"paused,omitempty"`
		PausedUntil int64  `json:"pausedUntil,omitempty"`
	}
	paused := pauses()
	a.status.mu.Lock()
	byID := a.status.byID
	running := a.status.running
	finished := a.status.finished
	a.status.mu.Unlock()
	var out []row
	for _, id := range []string{"aistudio", "deepseek", "chatgpt", "groq"} {
		st, ok := byID[id]
		if !ok {
			st = providerStatus{State: "sin-comprobar", Detail: "todavía no se comprobó"}
		}
		r := row{ID: id, Model: providerModels[id], Limit: providerLimits[id], Status: st,
			Context: providerContext[id].tokens, ContextNote: providerContext[id].note}
		if id == "groq" {
			r.Model.DisplayName = groqModelNames[a.config.get().GroqModel] // el modelo que contesta, no el servicio
		}
		if until := pauseFor(id, paused); until > 0 {
			r.PausedUntil = until
			r.Paused = time.UnixMilli(until).Format("15:04")
		}
		out = append(out, r)
	}
	// Kimi: la receta está (jarvis/recipes/kimi/), pero en el plan gratis sus modelos buenos contestan «muchas personas
	// están chateando… suscríbete» y no mandan la pregunta (2026-11-17). Se lista apagado, «Próximamente», y no está en
	// `providerModels`: no se puede elegir ni en la barra ni en la configuración (Miguel: «déjalo deshabilitado»).
	out = append(out, row{ID: "kimi", Model: Model{Name: "kimi-web", DisplayName: "Kimi", Note: "kimi.ai"}, Status: providerStatus{
		State:  "proximamente",
		Detail: "Próximamente: en el plan gratis Kimi frena sus modelos buenos (K3.1 Pro, K3, K2.8) con «Muchas personas están chateando… Suscríbete» y no manda la pregunta. La receta está lista (bin/kimi) para cuando se pueda usar.",
	}})
	cfg := a.config.get()
	writeJSON(w, 200, map[string]any{"providers": out, "default": cfg.Provider, "agentsOther": cfg.AgentsOther, "checking": running, "checked": finished})
}

func (a *app) models(w http.ResponseWriter, r *http.Request) {
	paused := pauses()
	models := a.chatModels()
	list := make([]Model, len(models))
	for i, m := range models {
		// «*» es la cuenta entera de AI Studio (corta por el ritmo); no frena a DeepSeek.
		if until, ok := paused["*"]; ok && m.Name == providerModels["aistudio"].Name {
			m.Paused = time.UnixMilli(until).Format("15:04")
		} else if until, ok := paused[m.Name]; ok {
			m.Paused = time.UnixMilli(until).Format("15:04")
		}
		list[i] = m
	}
	writeJSON(w, 200, map[string]any{"models": list, "default": models[0].Name})
}

// Summary es una fila de la lista: sin los mensajes.
type Summary struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Model   string    `json:"model"`
	Updated time.Time `json:"updated"`
	Count   int       `json:"count"`
	Mode    string    `json:"mode,omitempty"`
	Agent   string    `json:"agent,omitempty"` // el nombre, si es la conversación de un agente
	Main    bool      `json:"main,omitempty"`  // la conversación con Wally
	Preview string    `json:"preview,omitempty"`
}

func (a *app) list(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	out := make([]Summary, 0, len(a.store.convs))
	for _, c := range a.store.convs {
		s := Summary{ID: c.ID, Title: c.Title, Model: c.Model, Updated: c.Updated, Count: len(c.Messages), Mode: c.Mode, Main: c.Main}
		if c.Agent != nil {
			s.Agent = c.Agent.Name
		}
		// Lo último que se dijo, para la lista (como «Vos: …» en el chat).
		if n := len(c.Messages); n > 0 {
			who := map[string]string{"user": "Vos: ", "model": ""}[c.Messages[n-1].Role]
			// Sin las marcas de Markdown (negritas, código, títulos): en la lista se leen como texto.
			text := strings.Join(strings.Fields(strings.NewReplacer("**", "", "__", "", "`", "", "#", "").Replace(c.Messages[n-1].Text)), " ")
			if r := []rune(text); len(r) > 90 {
				text = string(r[:90]) + "…"
			}
			s.Preview = who + text
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Updated.After(out[j].Updated) })
	writeJSON(w, 200, map[string]any{"conversations": out})
}

func (a *app) get(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c, ok := a.store.convs[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	writeJSON(w, 200, c)
}

func (a *app) remove(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	if c, ok := a.store.convs[r.PathValue("id")]; ok {
		for _, m := range c.Messages {
			a.forgetFiles(m.Files)
			a.forgetFiles(commandOutputs(m))
		}
		if c.Agent != nil {
			a.forgetFiles(c.Agent.Files) // los archivos del contexto de un agente son suyos: se van con él
		}
	}
	delete(a.store.convs, r.PathValue("id"))
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// removeMessage borra UN bloque (una pregunta o una respuesta) para sacarlo del contexto de las próximas preguntas.
// La conversación queda aunque se vacíe: se borra entera con su propio DELETE.
func (a *app) removeMessage(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c, ok := a.store.convs[r.PathValue("id")]
	if !ok {
		writeErr(w, 404, errors.New("no existe esa conversación"))
		return
	}
	mid := r.PathValue("mid")
	kept := c.Messages[:0:0]
	for _, m := range c.Messages {
		if m.ID != mid {
			kept = append(kept, m)
		} else {
			a.forgetFiles(m.Files)
			a.forgetFiles(commandOutputs(m))
		}
	}
	if len(kept) == len(c.Messages) {
		writeErr(w, 404, errors.New("no existe ese bloque"))
		return
	}
	c.Messages = kept
	c.Updated = time.Now()
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}

// transcript arma lo que se le manda a AI Studio: cada pregunta abre un chat nuevo, así que la conversación anterior
// viaja como texto antes de la pregunta. Los archivos de cada pregunta van a continuación de ella, delimitados con su
// nombre (`fileText` da su texto; los que ya no están se nombran y se saltean).
func transcript(history []Message, question string, files []Attachment, fileText func(string) (string, error)) string {
	var b strings.Builder
	writeFiles := func(atts []Attachment) {
		for _, f := range atts {
			text, err := fileText(f.ID)
			if err != nil {
				fmt.Fprintf(&b, "\n(el archivo «%s» ya no está)\n", f.Name)
				continue
			}
			label := "archivo adjunto"
			if f.Kind == "salida" {
				label = "salida del comando que pediste"
			}
			fmt.Fprintf(&b, "\n----- %s: «%s» -----\n%s\n----- fin de «%s» -----\n", label, f.Name, strings.TrimRight(text, "\n"), f.Name)
		}
	}
	if len(history) == 0 {
		b.WriteString(question)
		if len(files) > 0 {
			b.WriteString("\n")
			writeFiles(files)
		}
		return b.String()
	}
	b.WriteString("Esta es la conversación que venimos teniendo; seguila y contestá sólo la última pregunta.\n\n")
	for _, m := range history {
		who := "Yo"
		if m.Role == "model" {
			who = "Vos"
		}
		fmt.Fprintf(&b, "### %s\n%s\n", who, m.Text)
		writeFiles(m.Files)
		// Lo que pidió el modelo y Miguel corrió viaja justo después de esa respuesta; lo descartado se dice.
		writeFiles(commandOutputs(m))
		for _, c := range m.Commands {
			if c.Status == "descartado" || c.Status == "no-permitido" {
				fmt.Fprintf(&b, "\n(no se corrió «%s»: %s)\n", c.Cmd, map[string]string{"descartado": "Miguel lo descartó", "no-permitido": "no está en la lista"}[c.Status])
			}
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "### Yo (la pregunta de ahora)\n%s\n", question)
	writeFiles(files)
	return strings.TrimRight(b.String(), "\n")
}

// askProvider le hace la pregunta al proveedor de la configuración por el pool (pool.go): una conexión a Chrome,
// varias pestañas. Devuelve la respuesta y el modelo con que salió.
func (a *app) askProvider(ctx context.Context, mode string, agent *Agent, chosen, text string) (string, string, error) {
	cfg := a.config.get()
	provider := cfg.providerForConversation(chosen, mode, agent)
	model := providerModels[provider].Name
	answer, err := a.pool.ask(ctx, poolJob{Provider: provider, Model: model, Text: text, Thinking: cfg.Thinking,
		DeepThink: cfg.DeepThink, Search: cfg.Search, ChatGPTThink: cfg.ChatGPTThink, GroqModel: cfg.GroqModel, Window: cfg.Window})
	return answer, model, err
}

// ask agrega la pregunta, se la hace a AI Studio con el modelo elegido y guarda la respuesta. Sin `id` abre una
// conversación nueva. Si falla, la pregunta no queda guardada: se puede volver a mandar.
func (a *app) ask(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    string   `json:"id"`
		Model string   `json:"model"`
		Text  string   `json:"text"`
		Files []string `json:"files"`
		Mode  string   `json:"mode"` // sólo al empezar una conversación
		// Provider: el de la barra de escribir; vacío o «auto», el de la configuración.
		Provider string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	var files []Attachment
	for _, id := range in.Files {
		att, err := a.attachment(id)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		files = append(files, att)
	}
	c, err := a.askInConversation(r.Context(), askInput{ID: in.ID, Model: in.Model, Text: in.Text, Files: files, Mode: in.Mode, Provider: in.Provider})
	if err != nil {
		var bad errBadRequest
		if errors.As(err, &bad) {
			writeErr(w, 400, err)
		} else {
			writeErr(w, 502, err)
		}
		return
	}
	writeJSON(w, 200, c)
}

// askInput: una pregunta en una conversación (nueva si ID está vacío). Title sólo para una nueva.
type askInput struct {
	ID, Model, Text, Mode, Title string
	Files                        []Attachment
	// Provider: el elegido en la barra para esta conversación; «auto» o vacío, el de la configuración. Se guarda en la
	// conversación al contestar.
	Provider string
}

type errBadRequest struct{ msg string }

func (e errBadRequest) Error() string { return e.msg }

// askInConversation es una pregunta entera: arma el texto con lo guardado y las instrucciones del modo, se la hace a
// AI Studio (por el pool) y guarda la pregunta y la respuesta, con los comandos que pidió. La usan la interfaz (ask) y
// los agentes (agents.go). Si falla, no guarda nada.
func (a *app) askInConversation(ctx context.Context, in askInput) (Conversation, error) {
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" {
		return Conversation{}, errBadRequest{"la pregunta está vacía"}
	}
	if in.Model == "" {
		in.Model = a.chatModels()[0].Name
	}
	files := in.Files

	// El historial se copia con el candado tomado, y la pregunta (segundos) va sin él.
	a.store.mu.Lock()
	var history []Message
	var agent *Agent
	if in.ID != "" {
		c, ok := a.store.convs[in.ID]
		if !ok {
			a.store.mu.Unlock()
			return Conversation{}, errBadRequest{"no existe esa conversación"}
		}
		history = append(history, c.Messages...)
		in.Mode = c.Mode
		agent = c.Agent
	}
	a.store.mu.Unlock()
	if in.Mode != "" && !modes[in.Mode] {
		return Conversation{}, errBadRequest{fmt.Sprintf("no existe el modo «%s»", in.Mode)}
	}
	// Al empezar en un modo asistido, lo que el modo adjunta (el mapa de knowledge) va con la primera pregunta.
	if len(history) == 0 && in.Mode != "" {
		extra, err := a.modeContext(ctx, in.Mode)
		if err != nil {
			return Conversation{}, err
		}
		files = append(extra, files...)
	}

	asked := time.Now()
	prompt := transcript(history, in.Text, files, a.fileText)
	instructions, err := a.instructionsFor(in.Mode)
	if err != nil {
		return Conversation{}, err
	}
	// Un agente lleva su contexto precargado (agents.go) entre las instrucciones y la conversación.
	if agent != nil {
		pre, err := a.agentContext(ctx, *agent)
		if err != nil {
			return Conversation{}, err
		}
		prompt = pre + "\n\n---\n\n" + prompt
	}
	if instructions != "" {
		prompt = instructions + "\n\n---\n\n" + prompt
	}
	askCtx, cancel := context.WithTimeout(ctx, 12*time.Minute)
	answer, model, err := a.askProvider(askCtx, in.Mode, agent, in.Provider, prompt)
	in.Model = model
	cancel()
	if err != nil {
		return Conversation{}, err
	}
	done := time.Now()

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c := a.store.convs[in.ID]
	if c == nil {
		// Nueva (o borrada mientras contestaba): el título es el pedido, o el comienzo de la pregunta.
		title := in.Title
		if title == "" {
			title = strings.Join(strings.Fields(in.Text), " ")
			if r := []rune(title); len(r) > 60 {
				title = string(r[:60]) + "…"
			}
		}
		c = &Conversation{ID: newID(), Title: title, Mode: in.Mode, Created: asked}
		a.store.convs[c.ID] = c
	}
	c.Model = in.Model
	c.Updated = done
	c.Messages = append(c.Messages,
		Message{ID: newID(), Role: "user", Text: in.Text, Files: files, At: asked},
		Message{ID: newID(), Role: "model", Text: answer, Model: in.Model, Ms: done.Sub(asked).Milliseconds(), At: done,
			Commands: modeCommands(in.Mode, answer)})
	if err := a.store.save(); err != nil {
		return Conversation{}, err
	}
	return *c, nil
}

// modeCommands: en un modo asistido, los comandos que pidió el modelo; en un chat, ninguno.
func modeCommands(mode, answer string) []Command {
	if mode == "" {
		return nil
	}
	return parseCommands(answer)
}

// commandOutputs: las salidas guardadas de los comandos de un bloque (se borran con él).
func commandOutputs(m Message) []Attachment {
	var out []Attachment
	for _, c := range m.Commands {
		if c.Output != nil {
			out = append(out, *c.Output)
		}
	}
	return out
}
