// WALLY: un chat para hacerle preguntas a Gemini eligiendo el modelo. La interfaz (wally/src, :5228) habla con
// esta API (:5229), que guarda las conversaciones en disco (`wally/.data/conversations.json`) y llama a la API de
// Gemini con el conector (`connectors/gemini`, la llave de `connectors/.env`). Cada pregunta manda la conversación
// entera: la API de Gemini no guarda nada entre llamadas.
//
//	go run ./wally/server -serve 127.0.0.1:5229
package main

import (
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
	"strconv"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/connectors/gemini"
)

func main() {
	serve := flag.String("serve", "127.0.0.1:5229", "dónde escucha la API")
	flag.Parse()
	root, err := repoRoot()
	if err != nil {
		log.Fatal(err)
	}
	// Los conectores buscan connectors/ subiendo desde donde se corre.
	if err := os.Chdir(root); err != nil {
		log.Fatal(err)
	}
	st := &store{file: filepath.Join(root, "wally", ".data", "conversations.json")}
	if err := st.load(); err != nil {
		log.Fatal(err)
	}
	a := &app{store: st}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/models", a.models)
	mux.HandleFunc("GET /api/conversations", a.list)
	mux.HandleFunc("GET /api/conversations/{id}", a.get)
	mux.HandleFunc("DELETE /api/conversations/{id}", a.remove)
	mux.HandleFunc("POST /api/ask", a.ask)
	log.Printf("wally: API en http://%s", *serve)
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

// Message es un turno guardado. Los de Gemini dicen con qué modelo salieron y cuánto tardaron.
type Message struct {
	Role  string    `json:"role"` // user · model
	Text  string    `json:"text"`
	Model string    `json:"model,omitempty"`
	Ms    int64     `json:"ms,omitempty"`
	At    time.Time `json:"at"`
}

// Conversation es un chat: el título sale de la primera pregunta.
type Conversation struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Model    string    `json:"model"` // el último elegido: la interfaz lo vuelve a poner al abrirla
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
	for _, c := range list {
		s.convs[c.ID] = c
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

	modelsMu  sync.Mutex
	modelsAt  time.Time
	modelsOut map[string]any
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// chatModel: de todo lo que la llave puede usar, lo que sirve para conversar en texto. Lo de voz, imagen, audio,
// transcripción y los agentes (Deep Research, Antigravity, Computer Use) contesta otra cosa o no contesta texto.
func chatModel(name string) bool {
	for _, skip := range []string{"tts", "image", "transcribe", "audio", "live", "robotics", "computer-use",
		"deep-research", "antigravity", "embedding", "veo", "imagen", "lyria", "nano-banana", "customtools", "aqa", "learnlm"} {
		if strings.Contains(name, skip) {
			return false
		}
	}
	return strings.HasPrefix(name, "gemini") || strings.HasPrefix(name, "gemma")
}

// models: la lista se pide a Google una vez cada 10 min (cambia poco y abrir la app no tiene que esperar).
func (a *app) models(w http.ResponseWriter, r *http.Request) {
	a.modelsMu.Lock()
	defer a.modelsMu.Unlock()
	if a.modelsOut != nil && time.Since(a.modelsAt) < 10*time.Minute {
		writeJSON(w, 200, a.modelsOut)
		return
	}
	cfg, err := gemini.LoadConfig()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	all, err := gemini.New(cfg).Models()
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	var list []gemini.Model
	for _, m := range all {
		if chatModel(m.Name) {
			list = append(list, m)
		}
	}
	sort.SliceStable(list, func(i, j int) bool {
		gi, gj := modelGroup(list[i].Name), modelGroup(list[j].Name)
		if gi != gj {
			return gi < gj
		}
		vi, vj := modelVersion(list[i].Name), modelVersion(list[j].Name)
		if vi != vj {
			return vi > vj
		}
		return list[i].Name < list[j].Name
	})
	a.modelsOut = map[string]any{"models": list, "default": cfg.Model}
	a.modelsAt = time.Now()
	writeJSON(w, 200, a.modelsOut)
}

// modelGroup ordena la lista: los Gemini con versión (los más nuevos arriba), después los alias que apuntan al
// último («-latest») y los demás Gemini, y al final Gemma (abiertos).
func modelGroup(name string) int {
	switch {
	case strings.HasPrefix(name, "gemma"):
		return 2
	case modelVersion(name) > 0:
		return 0
	}
	return 1
}

// modelVersion: el número de «gemini-3.5-flash» (3.5); 0 si no tiene.
func modelVersion(name string) float64 {
	parts := strings.Split(name, "-")
	if len(parts) < 2 {
		return 0
	}
	v, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0
	}
	return v
}

// Summary es una fila de la lista: sin los mensajes.
type Summary struct {
	ID      string    `json:"id"`
	Title   string    `json:"title"`
	Model   string    `json:"model"`
	Updated time.Time `json:"updated"`
	Count   int       `json:"count"`
}

func (a *app) list(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	out := make([]Summary, 0, len(a.store.convs))
	for _, c := range a.store.convs {
		out = append(out, Summary{c.ID, c.Title, c.Model, c.Updated, len(c.Messages)})
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
	delete(a.store.convs, r.PathValue("id"))
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ask agrega la pregunta, le pasa la conversación entera a Gemini con el modelo elegido y guarda la respuesta.
// Sin `id` abre una conversación nueva. Si Gemini falla, la pregunta no queda guardada: se puede volver a mandar.
func (a *app) ask(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID    string `json:"id"`
		Model string `json:"model"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, 400, err)
		return
	}
	in.Text = strings.TrimSpace(in.Text)
	if in.Text == "" {
		writeErr(w, 400, errors.New("la pregunta está vacía"))
		return
	}
	cfg, err := gemini.LoadConfig()
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if in.Model != "" {
		cfg.Model = in.Model
	}

	// El historial se copia con el candado tomado, y la llamada (segundos) va sin él.
	a.store.mu.Lock()
	var history []gemini.Turn
	if in.ID != "" {
		c, ok := a.store.convs[in.ID]
		if !ok {
			a.store.mu.Unlock()
			writeErr(w, 404, errors.New("no existe esa conversación"))
			return
		}
		for _, m := range c.Messages {
			history = append(history, gemini.Turn{Role: m.Role, Text: m.Text})
		}
	}
	a.store.mu.Unlock()
	history = append(history, gemini.Turn{Role: "user", Text: in.Text})

	asked := time.Now()
	out, err := gemini.New(cfg).Converse(history, "", nil, nil)
	if err != nil {
		writeErr(w, 502, err)
		return
	}
	answer, _ := out.(string)
	done := time.Now()

	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	c := a.store.convs[in.ID]
	if c == nil {
		// Nueva (o borrada mientras contestaba): el título es el comienzo de la pregunta.
		title := strings.Join(strings.Fields(in.Text), " ")
		if r := []rune(title); len(r) > 60 {
			title = string(r[:60]) + "…"
		}
		c = &Conversation{ID: newID(), Title: title, Created: asked}
		a.store.convs[c.ID] = c
	}
	c.Model = cfg.Model
	c.Updated = done
	c.Messages = append(c.Messages,
		Message{Role: "user", Text: in.Text, At: asked},
		Message{Role: "model", Text: answer, Model: cfg.Model, Ms: done.Sub(asked).Milliseconds(), At: done})
	if err := a.store.save(); err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, c)
}
