// News: lo que pasó en Hugging Face cada semana (Miguel, 2026-11-18: «documentar los modelos existentes y ver qué es
// lo más innovador de cada semana»). La API (:5241) junta la semana de la API pública de Hugging Face, le pide al modelo
// de fondo los textos (lo más innovador, qué hace y qué trae cada modelo nuevo, los papers en español) y guarda cada
// semana en `.data/weeks/<año>-W<semana>.json`. La interfaz (:5240) las muestra.
//
// La semana es la ISO (lunes a domingo). La de hoy se actualiza cada 6 horas mientras el servidor corre; al cambiar de
// semana, la anterior queda guardada como estaba en su última actualización. `-once` actualiza la de hoy por consola.
package main

import (
	"context"
	"creditop/my-tools/lib/machine"
	"creditop/my-tools/lib/models"
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

	"creditop/my-tools/lib/launchagent"
)

// Model es un modelo en tendencia, con su ficha y lo que escribió el modelo de fondo (sólo los nuevos).
type Model struct {
	ID        string   `json:"id"`
	Org       string   `json:"org"`
	Name      string   `json:"name"`
	Task      string   `json:"task"`
	Created   string   `json:"created"`
	Likes     int      `json:"likes"`
	Downloads int      `json:"downloads"`
	Trending  float64  `json:"trending"`
	Rank      int      `json:"rank"`
	New       bool     `json:"new"`
	License   string   `json:"license,omitempty"`
	Params    int64    `json:"params,omitempty"`
	Library   string   `json:"library,omitempty"`
	Languages []string `json:"languages,omitempty"`
	Base      string   `json:"base,omitempty"`
	Formats   []string `json:"formats,omitempty"`
	What      string   `json:"what,omitempty"`
	Novelty   string   `json:"novelty,omitempty"`
}

// Paper es uno de los más votados de la semana.
type Paper struct {
	ID             string `json:"id"`
	Title          string `json:"title"`
	Upvotes        int    `json:"upvotes"`
	Day            string `json:"day"`
	GitHub         string `json:"github,omitempty"`
	Summary        string `json:"summary"`
	SummarySpanish string `json:"summarySpanish,omitempty"`
	Comments       int    `json:"comments"`
}

// Week es una semana guardada.
type Week struct {
	Key         string  `json:"key"`
	Number      int     `json:"number"`
	From        string  `json:"from"`
	To          string  `json:"to"`
	Fetched     string  `json:"fetched"`
	Models      []Model `json:"models"`
	Papers      []Paper `json:"papers"`
	PapersTotal int     `json:"papersTotal"`
	Lead        string  `json:"lead,omitempty"`
	Why         string  `json:"why,omitempty"`
	WrittenBy   string  `json:"writtenBy,omitempty"`
	Wrote       string  `json:"wrote,omitempty"` // la huella de lo que se le mandó al modelo
	WriteError  string  `json:"writeError,omitempty"`
	// FetchWarnings: lo que no se pudo leer de Hugging Face en esta actualización (un día de papers, la ficha de un
	// modelo). La semana se guarda igual, pero dice que le falta algo en vez de pasar por completa.
	FetchWarnings []string `json:"fetchWarnings,omitempty"`
}

const refreshEvery = 6 * time.Hour

type server struct {
	root, dir string
	roots     models.Roots // dónde se buscan los modelos instalados (lib/models)
	facts     *factStore   // lo medido en Hugging Face de cada favorito (facts.go)
	scanMu    sync.Mutex
	scan      []models.Installed // la última medida de lo instalado (installed.go)
	scanAt    time.Time
	activity  activity // lo que hizo el servidor, para la consola (activity.go)
	mu        sync.Mutex
	busy      bool
	lastErr   string
	lastAt    time.Time
}

func main() {
	serve := flag.String("serve", "127.0.0.1:5241", "host:puerto de la API")
	once := flag.Bool("once", false, "actualizar la semana de hoy por consola y salir")
	flag.Parse()
	root := os.Getenv("MY_TOOLS_ROOT")
	if root == "" {
		wd, _ := os.Getwd()
		root = wd
	}
	s := &server{root: root, dir: filepath.Join(root, "news", ".data", "weeks"), roots: models.DefaultRoots(), facts: newFactStore(root)}
	if *once {
		w, err := s.refresh(context.Background())
		if err != nil {
			fmt.Fprintln(os.Stderr, "news:", err)
			os.Exit(1)
		}
		fresh := 0
		for _, m := range w.Models {
			if m.New {
				fresh++
			}
		}
		fmt.Printf("semana %s: %d modelos en tendencia, %d nuevos, %d papers · lo más innovador: %s%s\n",
			w.Key, len(w.Models), fresh, w.PapersTotal, orNone(w.Lead), map[bool]string{true: " · ⚠ " + w.WriteError, false: ""}[w.WriteError != ""])
		return
	}
	ln, err := launchagent.Listen("news", *serve)
	if err != nil {
		log.Fatal(err)
	}
	s.note("info", fmt.Sprintf("News arrancó en %s", machine.Detect().Here))
	go s.loop()
	log.Printf("news: API en http://%s", *serve)
	log.Fatal(http.Serve(ln, s.routes()))
}

// weekOf: la semana ISO que contiene t, de lunes a domingo.
func weekOf(t time.Time) (key string, number int, from, to time.Time) {
	year, n := t.ISOWeek()
	wd := int(t.Weekday())
	if wd == 0 {
		wd = 7
	}
	from = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()).AddDate(0, 0, 1-wd)
	return fmt.Sprintf("%d-W%02d", year, n), n, from, from.AddDate(0, 0, 6)
}

func (s *server) path(key string) string { return filepath.Join(s.dir, key+".json") }

func (s *server) load(key string) (*Week, error) {
	raw, err := os.ReadFile(s.path(key))
	if err != nil {
		return nil, err
	}
	var w Week
	return &w, json.Unmarshal(raw, &w)
}

func (s *server) save(w *Week) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(w, "", " ")
	tmp := s.path(w.Key) + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path(w.Key))
}

// refresh junta la semana de hoy y, si cambió lo que se le mandaría al modelo, vuelve a escribir los textos. Una a la vez.
func (s *server) refresh(ctx context.Context) (*Week, error) {
	s.mu.Lock()
	if s.busy {
		s.mu.Unlock()
		return nil, errors.New("ya se está actualizando")
	}
	s.busy = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.busy = false; s.lastAt = time.Now(); s.mu.Unlock() }()

	now := time.Now()
	key, number, from, to := weekOf(now)
	s.note("info", "actualizando la semana "+key+": leyendo Hugging Face")
	upTo := to
	if now.Before(to) {
		upTo = now // los papers de un día que todavía no llegó no existen
	}
	models, papers, total, warnings, err := fetchWeek(ctx, from, upTo)
	if err != nil {
		s.note("error", "no se pudo leer Hugging Face: "+firstLine(err.Error()))
		s.setErr(err)
		return nil, err
	}
	w := &Week{Key: key, Number: number, From: from.Format("2006-01-02"), To: to.Format("2006-01-02"),
		Fetched: now.Format(time.RFC3339), Models: models, Papers: papers, PapersTotal: total, FetchWarnings: warnings}
	prev, _ := s.load(key)
	print := fingerprint(w)
	if prev != nil && prev.Wrote == print && prev.WriteError == "" {
		carry(prev, w) // los mismos modelos y papers: los textos de antes siguen valiendo
		s.note("info", "la lista no cambió: se conservan los textos")
	} else {
		s.note("info", "pidiendo los textos al modelo de fondo")
		errM := writeModels(ctx, s.root, w)
		errP := writePapers(ctx, s.root, w)
		if err := errors.Join(errM, errP); err != nil {
			w.WriteError = firstLine(err.Error())
			s.note("warn", "sin textos nuevos: "+w.WriteError)
			if prev != nil {
				carry(prev, w) // mejor los textos de la vez anterior que ninguno
			}
		} else {
			w.Wrote = print
		}
	}
	if err := s.save(w); err != nil {
		s.setErr(err)
		return nil, err
	}
	s.setErr(nil)
	fresh := 0
	for _, m := range w.Models {
		if m.New {
			fresh++
		}
	}
	for _, warning := range w.FetchWarnings {
		s.note("warn", "semana incompleta: "+warning)
	}
	s.note("ok", fmt.Sprintf("semana %s lista: %d modelos en tendencia, %d nuevos, %d papers", w.Key, len(w.Models), fresh, w.PapersTotal))
	return w, nil
}

// carry pasa los textos de una versión anterior de la semana a la nueva, por id.
func carry(prev, w *Week) {
	texts := map[string][2]string{}
	for _, m := range prev.Models {
		texts[m.ID] = [2]string{m.What, m.Novelty}
	}
	for i := range w.Models {
		if t, ok := texts[w.Models[i].ID]; ok && w.Models[i].What == "" {
			w.Models[i].What, w.Models[i].Novelty = t[0], t[1]
		}
	}
	spanish := map[string]string{}
	for _, p := range prev.Papers {
		spanish[p.ID] = p.SummarySpanish
	}
	for i := range w.Papers {
		if w.Papers[i].SummarySpanish == "" {
			w.Papers[i].SummarySpanish = spanish[w.Papers[i].ID]
		}
	}
	if w.Lead == "" {
		w.Lead, w.Why, w.WrittenBy = prev.Lead, prev.Why, prev.WrittenBy
	}
	if w.Wrote == "" && w.WriteError == "" {
		w.Wrote = prev.Wrote
	}
}

func (s *server) setErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil {
		s.lastErr = ""
	} else {
		s.lastErr = firstLine(err.Error())
		log.Printf("news: %v", err)
	}
}

// loop: al arrancar, si la semana de hoy no está o tiene más de 6 horas, la actualiza; después, cada 6 horas.
func (s *server) loop() {
	for {
		key, _, _, _ := weekOf(time.Now())
		w, _ := s.load(key)
		due := w == nil
		if w != nil {
			t, err := time.Parse(time.RFC3339, w.Fetched)
			due = err != nil || time.Since(t) >= refreshEvery
		}
		if due {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			if w, err := s.refresh(ctx); err == nil {
				log.Printf("news: semana %s actualizada (%d modelos, %d papers)", w.Key, len(w.Models), w.PapersTotal)
			}
			cancel()
		}
		time.Sleep(10 * time.Minute)
	}
}

type weekSummary struct {
	Key    string `json:"key"`
	Number int    `json:"number"`
	From   string `json:"from"`
	To     string `json:"to"`
	New    int    `json:"new"`
	Papers int    `json:"papers"`
	Lead   string `json:"lead,omitempty"`
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/weeks", func(w http.ResponseWriter, _ *http.Request) {
		entries, _ := os.ReadDir(s.dir)
		out := []weekSummary{}
		for _, e := range entries {
			key, ok := strings.CutSuffix(e.Name(), ".json")
			if !ok {
				continue
			}
			wk, err := s.load(key)
			if err != nil {
				continue
			}
			n := 0
			for _, m := range wk.Models {
				if m.New {
					n++
				}
			}
			out = append(out, weekSummary{Key: wk.Key, Number: wk.Number, From: wk.From, To: wk.To, New: n, Papers: wk.PapersTotal, Lead: wk.Lead})
		}
		sort.Slice(out, func(a, b int) bool { return out[a].Key > out[b].Key })
		s.mu.Lock()
		state := map[string]any{"weeks": out, "refreshing": s.busy, "error": s.lastErr}
		s.mu.Unlock()
		writeJSON(w, 200, state)
	})
	mux.HandleFunc("GET /api/weeks/{key}", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		if strings.ContainsAny(key, "/.\\") {
			writeJSON(w, 400, map[string]string{"error": "semana inválida"})
			return
		}
		wk, err := s.load(key)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": "no hay semana " + key})
			return
		}
		writeJSON(w, 200, wk)
	})
	// Actualizar ya (lo hace solo cada 6 horas): vuelve enseguida; el trabajo sigue de fondo.
	mux.HandleFunc("POST /api/refresh", func(w http.ResponseWriter, _ *http.Request) {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			defer cancel()
			_, _ = s.refresh(ctx)
		}()
		writeJSON(w, 202, map[string]bool{"ok": true})
	})
	s.favoritesRoute(mux)
	s.researchRoute(mux)
	s.installedRoutes(mux)
	s.consoleRoutes(mux)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func firstLine(s string) string {
	s, _, _ = strings.Cut(s, "\n")
	return s
}
