// knowledge-ui es la API de la app visual del conocimiento local (`knowledge/`): leerlo, no editarlo. Sirve los temas
// tal como los lee `make knowledge-read` (el paquete `knowledge`, sin copias), sus fuentes con su enlace al repo y su
// vigencia contra `main` (el mismo chequeo de `make knowledge-check`, sin red), y qué tareas del tablero lo citan.
//
//	go run ./knowledge-ui/server -serve 127.0.0.1:5211      (desde la raíz del playground; `make knowledge-ui` lo hace)
//
// Sólo escucha en 127.0.0.1 y sólo lee. Para cambiar un tema se edita en el repo, con su contrato (knowledge/CLAUDE.md).
package main

import (
	"bufio"
	"encoding/json"
	"flag"
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

	"creditop/playground/connectors/repos"
	"creditop/playground/knowledge"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// La vigencia de las fuentes: el chequeo lee git por cada fuente (más de mil), así que corre de fondo al arrancar y
// cuando se pide de nuevo, y la interfaz lo lee de acá.
type checkState struct {
	mu      sync.Mutex
	running bool
	at      time.Time
	states  []knowledge.SourceState
	err     string
}

func (c *checkState) run(lib func() (knowledge.Library, error), client *repos.Client) {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.mu.Unlock()
	go func() {
		l, err := lib()
		var states []knowledge.SourceState
		msg := ""
		if err != nil {
			msg = err.Error()
		} else {
			// Check devuelve error cuando hay fuentes para revisar: eso es un resultado, no una falla.
			states, _ = l.Check(client)
		}
		c.mu.Lock()
		c.running, c.at, c.states, c.err = false, time.Now(), states, msg
		c.mu.Unlock()
	}()
}

func (c *checkState) view() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := map[string]any{"running": c.running, "states": c.states, "error": c.err}
	if !c.at.IsZero() {
		out["checkedAt"] = c.at.Format(time.RFC3339)
	}
	return out
}

// citations: qué tareas del tablero citan cada tema — en su frontmatter (`knowledge: [tema#ancla]`) o en un bloque de
// su pila (`knowledge:tema`). Se lee del disco en cada pedido: son unas decenas de archivos.
var (
	frontKnowledge = regexp.MustCompile(`^knowledge:\s*\[(.*)\]\s*$`)
	blockKnowledge = regexp.MustCompile(`knowledge:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)`)
	frontTitle     = regexp.MustCompile(`^title:\s*['"]?(.+?)['"]?\s*$`)
)

type citation struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
}

func citations(tasksDir string) map[string][]citation {
	out := map[string][]citation{}
	entries, err := os.ReadDir(tasksDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		slug := e.Name()
		title, topics := slug, map[string]bool{}
		if f, err := os.Open(filepath.Join(tasksDir, slug, "task.md")); err == nil {
			sc := bufio.NewScanner(f)
			fences := 0
			for sc.Scan() {
				line := sc.Text()
				if line == "---" {
					if fences++; fences == 2 {
						break
					}
					continue
				}
				if m := frontTitle.FindStringSubmatch(line); m != nil {
					title = m[1]
				}
				if m := frontKnowledge.FindStringSubmatch(line); m != nil {
					for _, item := range strings.Split(m[1], ",") {
						id, _, _ := strings.Cut(strings.Trim(strings.TrimSpace(item), `'"`), "#")
						if id != "" {
							topics[id] = true
						}
					}
				}
			}
			f.Close()
		}
		if raw, err := os.ReadFile(filepath.Join(tasksDir, slug, "context.jsonl")); err == nil {
			for _, m := range blockKnowledge.FindAllStringSubmatch(string(raw), -1) {
				topics[m[1]] = true
			}
		}
		for id := range topics {
			out[id] = append(out[id], citation{Slug: slug, Title: title})
		}
	}
	for id := range out {
		sort.Slice(out[id], func(i, j int) bool { return out[id][i].Slug < out[id][j].Slug })
	}
	return out
}

type sectionRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type topicSummary struct {
	ID         string       `json:"id"`
	Title      string       `json:"title"`
	Summary    string       `json:"summary"`
	ReviewedAt string       `json:"reviewedAt"`
	Sections   []sectionRef `json:"sections"`
	Sources    int          `json:"sources"`
	Cited      int          `json:"cited"`
}

type sourceView struct {
	knowledge.Source
	URL string `json:"url,omitempty"` // el archivo en GitHub, en el commit revisado
}

func handler(root string) http.Handler {
	dir := filepath.Join(root, "knowledge")
	tasks := filepath.Join(root, "tablero", "tasks")
	lib := func() (knowledge.Library, error) { return knowledge.Open(dir) }
	client := repos.New(filepath.Join(root, "tools"))
	check := &checkState{}
	check.run(lib, client)

	webOf := func(s knowledge.Source) string {
		web, err := client.Web()
		if err != nil {
			return ""
		}
		w, ok := web[s.Repo]
		if !ok || w.Web == "" {
			return ""
		}
		return fmt.Sprintf("%s/blob/%s/%s%s", w.Web, s.Commit, w.Prefix, s.Path)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/topics", func(w http.ResponseWriter, r *http.Request) {
		l, err := lib()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		cited := citations(tasks)
		out := make([]topicSummary, 0, len(l.Topics))
		for _, t := range l.Topics {
			s := topicSummary{ID: t.ID, Title: t.Title, Summary: t.Summary, ReviewedAt: t.ReviewedAt,
				Sources: len(t.Sources), Cited: len(cited[t.ID]), Sections: []sectionRef{}}
			for _, sec := range t.Sections {
				s.Sections = append(s.Sections, sectionRef{ID: sec.ID, Title: sec.Title})
			}
			out = append(out, s)
		}
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("GET /api/topic", func(w http.ResponseWriter, r *http.Request) {
		l, err := lib()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		t, err := l.Read(r.URL.Query().Get("id"))
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
			return
		}
		sources := make([]sourceView, 0, len(t.Sources))
		for _, s := range t.Sources {
			sources = append(sources, sourceView{Source: s, URL: webOf(s)})
		}
		cited := citations(tasks)[t.ID]
		if cited == nil {
			cited = []citation{}
		}
		writeJSON(w, http.StatusOK, map[string]any{"topic": t, "sources": sources, "cited": cited})
	})
	mux.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		l, err := lib()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		hits := l.Search(r.URL.Query().Get("q"))
		if len(hits) > 40 {
			hits = hits[:40]
		}
		writeJSON(w, http.StatusOK, hits)
	})
	mux.HandleFunc("GET /api/check", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, check.view())
	})
	mux.HandleFunc("POST /api/check", func(w http.ResponseWriter, r *http.Request) {
		check.run(lib, client)
		writeJSON(w, http.StatusOK, check.view())
	})
	return mux
}

func main() {
	serve := flag.String("serve", "127.0.0.1:5211", "dónde escucha la API (sólo 127.0.0.1)")
	flag.Parse()
	if !strings.HasPrefix(*serve, "127.0.0.1:") {
		log.Fatal("knowledge-ui: la API escucha sólo en 127.0.0.1")
	}
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "knowledge", "CLAUDE.md")); err != nil {
		log.Fatalf("knowledge-ui: corré desde la raíz del playground (no encuentro knowledge/ en %s)", root)
	}
	log.Printf("knowledge-ui: API en http://%s", *serve)
	log.Fatal((&http.Server{Addr: *serve, Handler: handler(root), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
