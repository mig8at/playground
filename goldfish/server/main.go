package main

// GOLDFISH: validar una rama de un repo real antes de abrir su PR (el método está en goldfish/review). La API de la
// app (127.0.0.1:5217) y la consola:
//
//	go run ./goldfish/server -list                         las ramas por subir, con su PR y su tarea
//	go run ./goldfish/server -run -repo R -branch B        valida una rama y deja el informe
//	go run ./goldfish/server -serve 127.0.0.1:5217         la API de la app
//
//	GET  /api/branches[?refresh=1]     las ramas por subir (se recalcula a lo sumo cada 3 min, salvo refresh)
//	GET  /api/runs                     las validaciones, de la más nueva a la más vieja
//	GET  /api/runs/{id}                una, con sus pasos y hallazgos (la interfaz la pregunta mientras corre)
//	GET  /api/runs/{id}/report         su informe en Markdown
//	POST /api/runs  {repo, branch}     valida una rama (una a la vez por rama)
//	POST /api/runs/{id}/stop           la frena
//
// Sólo escucha en 127.0.0.1 y sólo lee los repos: no abre PRs ni pushea.

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"creditop/playground/goldfish/review"
)

func main() {
	serve := flag.String("serve", "", "levantar la API en esta dirección (127.0.0.1:5217)")
	list := flag.Bool("list", false, "listar las ramas por subir")
	run := flag.Bool("run", false, "validar una rama (con -repo y -branch)")
	repo := flag.String("repo", "", "el repo (la carpeta en ~/Desktop/CREDITOP/github)")
	branch := flag.String("branch", "", "la rama")
	flag.Parse()
	root, err := playgroundRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
	switch {
	case *serve != "":
		markInterrupted(root)
		listen(root, *serve)
	case *list:
		printBranches(root)
	case *run:
		if *repo == "" || *branch == "" {
			fmt.Fprintln(os.Stderr, "goldfish: faltan -repo y -branch")
			os.Exit(2)
		}
		os.Exit(runConsole(root, *repo, *branch))
	default:
		flag.Usage()
		os.Exit(2)
	}
}

// playgroundRoot: la raíz del playground, subiendo desde la carpeta actual hasta su go.mod.
func playgroundRoot() (string, error) {
	dir, _ := os.Getwd()
	for {
		if raw, err := os.ReadFile(filepath.Join(dir, "go.mod")); err == nil && strings.Contains(string(raw), "module creditop/playground\n") {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no estoy dentro del playground (no encuentro su go.mod)")
		}
		dir = parent
	}
}

func printBranches(root string) {
	bs, err := review.Pending(context.Background(), root, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
	if len(bs) == 0 {
		fmt.Printf("No hay ramas con commits por delante de main en los últimos %d días.\n", review.RecentDays)
		return
	}
	for _, b := range bs {
		pr := "sin PR"
		if b.PR != nil {
			pr = fmt.Sprintf("PR #%d %s", b.PR.Number, strings.ToLower(b.PR.State))
		}
		task := ""
		if b.Task != nil {
			task = " · tarea " + b.Task.Slug
		}
		fmt.Printf("%-24s %-48s +%-3d %s%s\n", b.Repo, b.Name, b.Ahead, pr, task)
	}
}

func runConsole(root, repo, branch string) int {
	ctx := context.Background()
	b, err := review.FindBranch(ctx, root, repo, branch)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		return 1
	}
	r := review.NewRun(b)
	fmt.Printf("Goldfish · %s (%s) · %s\n", branch, repo, r.ID)
	seen := map[string]string{}
	review.Execute(ctx, root, r, func(x *review.Run) {
		_ = review.Save(root, x)
		for _, s := range x.Stages {
			if seen[s.ID] != s.Status {
				seen[s.ID] = s.Status
				note := ""
				if s.Note != "" {
					note = " · " + s.Note
				}
				fmt.Printf("  %-8s %-60s%s\n", s.Status, s.Label, note)
			}
		}
	})
	if r.Status != "done" {
		fmt.Fprintln(os.Stderr, "goldfish: la validación falló:", r.Error)
		return 1
	}
	fmt.Printf("\n%d hallazgos · US$%.2f · informe: %s\n", len(r.Findings), r.CostUSD, r.Report)
	if r.Artifact != "" {
		fmt.Println("en la tarea:", r.Artifact)
	}
	return 0
}

// markInterrupted: lo que quedó «corriendo» de un proceso que ya no existe se cortó (una validación de la consola
// que sigue viva no se toca).
func markInterrupted(root string) {
	for _, r := range review.List(root) {
		if r.Status == "running" && !r.Alive() {
			r.Status, r.Error = "failed", "se cortó: el proceso que la corría se cerró"
			_ = review.Save(root, r)
		}
	}
}

var (
	runsMu  sync.Mutex
	running = map[string]context.CancelFunc{} // id → cómo frenarla
	byRef   = map[string]string{}             // repo+rama → la que corre
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func listen(root, addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/branches", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		bs, err := review.Pending(ctx, root, r.URL.Query().Get("refresh") == "1")
		if err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"branches": bs, "reposDir": review.ReposDir(), "recentDays": review.RecentDays})
	})
	mux.HandleFunc("GET /api/runs", func(w http.ResponseWriter, r *http.Request) {
		type summary struct {
			ID, Repo, Branch, Status, Started, Finished string
			Findings                                    int
			CostUSD                                     float64
		}
		out := []summary{}
		for _, x := range review.List(root) {
			out = append(out, summary{x.ID, x.Repo, x.Branch, x.Status, x.Started, x.Finished, len(x.Findings), x.CostUSD})
		}
		writeJSON(w, http.StatusOK, map[string]any{"runs": out})
	})
	mux.HandleFunc("GET /api/runs/{id}", func(w http.ResponseWriter, r *http.Request) {
		x, err := review.Load(root, r.PathValue("id"))
		if err != nil {
			fail(w, http.StatusNotFound, errors.New("no existe esa validación"))
			return
		}
		writeJSON(w, http.StatusOK, x)
	})
	mux.HandleFunc("GET /api/runs/{id}/report", func(w http.ResponseWriter, r *http.Request) {
		x, err := review.Load(root, r.PathValue("id"))
		if err != nil {
			fail(w, http.StatusNotFound, errors.New("no existe esa validación"))
			return
		}
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		_, _ = w.Write([]byte(review.Report(x)))
	})
	mux.HandleFunc("POST /api/runs", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Repo, Branch string }
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		key := req.Repo + "\x00" + req.Branch
		runsMu.Lock()
		if id, ok := byRef[key]; ok {
			runsMu.Unlock()
			writeJSON(w, http.StatusOK, map[string]string{"id": id, "note": "ya se está validando"})
			return
		}
		runsMu.Unlock()
		b, err := review.FindBranch(r.Context(), root, req.Repo, req.Branch)
		if err != nil {
			fail(w, http.StatusNotFound, err)
			return
		}
		x := review.NewRun(b)
		_ = review.Save(root, x)
		ctx, cancel := context.WithCancel(context.Background())
		runsMu.Lock()
		running[x.ID], byRef[key] = cancel, x.ID
		runsMu.Unlock()
		go func() {
			defer func() {
				runsMu.Lock()
				delete(running, x.ID)
				delete(byRef, key)
				runsMu.Unlock()
				cancel()
			}()
			review.Execute(ctx, root, x, func(y *review.Run) { _ = review.Save(root, y) })
			if ctx.Err() != nil && x.Status != "done" {
				x.Status, x.Error = "failed", "frenada"
				_ = review.Save(root, x)
			}
		}()
		writeJSON(w, http.StatusAccepted, map[string]string{"id": x.ID})
	})
	mux.HandleFunc("POST /api/runs/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		runsMu.Lock()
		cancel, ok := running[r.PathValue("id")]
		runsMu.Unlock()
		if ok {
			cancel()
		}
		writeJSON(w, http.StatusOK, map[string]bool{"stopped": ok})
	})
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
	fmt.Printf("goldfish · API en http://%s · repos en %s\n", addr, review.ReposDir())
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	if err := srv.Serve(ln); err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
}
