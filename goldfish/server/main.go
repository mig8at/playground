package main

// GOLDFISH: validar un PR con Elephant-Goldfish (el método está en goldfish/review). La API de la app
// (127.0.0.1:5217) y la consola:
//
//	go run ./goldfish/server -list                         tus PRs abiertos y los externos, por repo
//	go run ./goldfish/server -run -pr <url>                valida un PR y deja el informe
//	go run ./goldfish/server -check -repo R [-branch B] [-base main] [-desc archivo.md] [-prove]
//	                                                       el paso previo a publicar: valida la rama local (la que tiene
//	                                                       el clon si no se dice) y escribe un resumen corto
//	go run ./goldfish/server -serve 127.0.0.1:5217         la API de la app
//
//	GET    /api/prs[?refresh=1]          los bloques por repo (se pide a GitHub a lo sumo cada 3 min, salvo refresh)
//	POST   /api/prs  {url}               un PR pegado: si es de otro, queda como externo; devuelve el PR
//	DELETE /api/prs?url=<url>            saca un externo de la lista
//	GET    /api/runs                     las validaciones, de la más nueva a la más vieja
//	GET    /api/runs/{id}                una, con sus pasos y hallazgos (la interfaz la pregunta mientras corre)
//	GET    /api/runs/{id}/report         su informe en Markdown
//	POST   /api/runs  {url}              valida un PR (uno a la vez por PR)
//	POST   /api/runs/{id}/prove          «Comprobar corriendo»: pone el clon en el PR, prueba con el harness en local
//	                                     los hallazgos confirmados y plausibles, y lo devuelve a su rama
//	POST   /api/runs/{id}/stop           la frena (también la comprobación)
//
// Sólo escucha en 127.0.0.1. De los repos sólo trae el PR y su base al clon (refs, sin tocar el árbol de trabajo):
// no comenta en GitHub, no aprueba ni pushea.

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

	"creditop/my-tools/goldfish/review"
)

func main() {
	serve := flag.String("serve", "", "levantar la API en esta dirección (127.0.0.1:5217)")
	list := flag.Bool("list", false, "listar tus PRs abiertos y los externos")
	run := flag.Bool("run", false, "validar un PR (con -pr)")
	prURL := flag.String("pr", "", "la URL del PR")
	check := flag.Bool("check", false, "antes del PR: validar una rama local (con -repo)")
	repo := flag.String("repo", "", "el repo: la carpeta en ~/Desktop/CREDITOP/github o una ruta")
	branch := flag.String("branch", "", "la rama (por defecto, la que tiene el clon)")
	base := flag.String("base", "main", "contra qué rama se va a abrir el PR")
	desc := flag.String("desc", "", "un Markdown con la descripción del PR que se va a abrir (la primera línea, el título)")
	prove := flag.Bool("prove", false, "además, comprobar corriendo con el harness en local")
	flag.Parse()
	root, err := myToolsRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
	switch {
	case *serve != "":
		markInterrupted(root)
		listen(root, *serve)
	case *list:
		printBlocks(root)
	case *check:
		if *repo == "" {
			fmt.Fprintln(os.Stderr, "goldfish: falta -repo")
			os.Exit(2)
		}
		os.Exit(checkConsole(root, *repo, *branch, *base, *desc, *prove))
	case *run:
		if *prURL == "" {
			fmt.Fprintln(os.Stderr, "goldfish: falta -pr <url>")
			os.Exit(2)
		}
		os.Exit(runConsole(root, *prURL))
	default:
		flag.Usage()
		os.Exit(2)
	}
}

// myToolsRoot: la raíz de my-tools, subiendo desde la carpeta actual hasta su go.mod.
func myToolsRoot() (string, error) {
	dir, _ := os.Getwd()
	for {
		if raw, err := os.ReadFile(filepath.Join(dir, "go.mod")); err == nil && strings.Contains(string(raw), "module creditop/my-tools\n") {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no estoy dentro de my-tools (no encuentro su go.mod)")
		}
		dir = parent
	}
}

func printBlocks(root string) {
	bs, err := review.Blocks(context.Background(), root, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		os.Exit(1)
	}
	for _, b := range bs {
		fmt.Printf("%s (%d)\n", b.Name, len(b.PRs))
		for _, p := range b.PRs {
			extra := ""
			if p.External {
				extra = " · externo, de " + p.Author
			}
			if p.Task != nil {
				extra += " · tarea " + p.Task.Slug
			}
			fmt.Printf("  #%-5d %s%s\n         %s\n", p.Number, p.Title, extra, p.URL)
		}
	}
}

func startRun(ctx context.Context, root, url string) (*review.Run, error) {
	p, err := review.AddByURL(ctx, root, url)
	if err != nil {
		return nil, err
	}
	if p.State != "OPEN" {
		return nil, fmt.Errorf("el PR #%d está %s: sólo se validan los abiertos", p.Number, strings.ToLower(p.State))
	}
	clone := review.CloneOf(ctx, p.Slug)
	if clone == "" {
		return nil, fmt.Errorf("no hay un clon de %s en %s: sin él no se puede leer el código", p.Slug, review.ReposDir())
	}
	return review.NewRun(p, clone), nil
}

func runConsole(root, url string) int {
	ctx := context.Background()
	r, err := startRun(ctx, root, url)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		return 1
	}
	fmt.Printf("Goldfish · %s #%d · %s · %s\n", r.Slug, r.PR.Number, r.PR.Title, r.ID)
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

// checkConsole: el paso previo a publicar, para la sesión que trabaja en la rama. Imprime el avance por stderr y el
// resumen por stdout. Sale 0 si terminó (aunque haya hallazgos: decidir es de la sesión y de Miguel), 1 si falló.
func checkConsole(root, repo, branch, base, descFile string, prove bool) int {
	ctx := context.Background()
	clone := repo
	if !filepath.IsAbs(clone) {
		clone = filepath.Join(review.ReposDir(), repo)
	}
	if _, err := os.Stat(filepath.Join(clone, ".git")); err != nil {
		fmt.Fprintf(os.Stderr, "goldfish: %s no es un clon de git\n", clone)
		return 1
	}
	title, body := "", ""
	if descFile != "" {
		raw, err := os.ReadFile(descFile)
		if err != nil {
			fmt.Fprintln(os.Stderr, "goldfish:", err)
			return 1
		}
		text := strings.TrimSpace(string(raw))
		title, body, _ = strings.Cut(text, "\n")
		title = strings.TrimSpace(strings.TrimLeft(title, "# "))
		body = strings.TrimSpace(body)
	}
	r, err := review.NewLocalRun(ctx, root, clone, branch, base, title, body)
	if err != nil {
		fmt.Fprintln(os.Stderr, "goldfish:", err)
		return 1
	}
	fmt.Fprintf(os.Stderr, "Goldfish · %s · %s → %s · %s\n", r.Repo, r.Branch, r.Base, r.ID)
	progress := func() func(*review.Run) {
		seen := map[string]string{}
		return func(x *review.Run) {
			_ = review.Save(root, x)
			for _, s := range x.Stages {
				if seen[s.ID] != s.Status {
					seen[s.ID] = s.Status
					note := ""
					if s.Note != "" {
						note = " · " + s.Note
					}
					fmt.Fprintf(os.Stderr, "  %-8s %s%s\n", s.Status, s.Label, note)
				}
			}
		}
	}
	review.Execute(ctx, root, r, progress())
	if r.Status == "done" && prove {
		review.Prove(ctx, root, r, progress())
	}
	fmt.Print(review.Summary(r))
	if r.Status != "done" {
		return 1
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
		if r.Proving && !r.Alive() {
			r.Proving = false
			for i := range r.Stages {
				if r.Stages[i].ID == review.ProveStage && r.Stages[i].Status == "running" {
					note, err := review.RestoreAfterCrash(context.Background(), r)
					switch {
					case err != nil:
						note = "se cortó y el clon NO volvió: " + err.Error()
					case note != "":
						note = "se cortó; " + note
					default:
						note = "se cortó"
					}
					r.Stages[i].Status, r.Stages[i].Note = "failed", note
				}
			}
			_ = review.Save(root, r)
		}
	}
}

var (
	runsMu  sync.Mutex
	running = map[string]context.CancelFunc{} // id → cómo frenarla
	byPR    = map[string]string{}             // owner/name#n → la que corre
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

func decodeURL(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req struct{ URL string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, err)
		return "", false
	}
	return strings.TrimSpace(req.URL), true
}

func listen(root, addr string) {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/prs", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()
		bs, err := review.Blocks(ctx, root, r.URL.Query().Get("refresh") == "1")
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"repos": bs, "me": review.Me(ctx)})
	})
	mux.HandleFunc("POST /api/prs", func(w http.ResponseWriter, r *http.Request) {
		url, ok := decodeURL(w, r)
		if !ok {
			return
		}
		p, err := review.AddByURL(r.Context(), root, url)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, p)
	})
	mux.HandleFunc("DELETE /api/prs", func(w http.ResponseWriter, r *http.Request) {
		slug, n, err := review.ParsePRURL(r.URL.Query().Get("url"))
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		if err := review.RemoveExternal(root, slug, n); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"removed": true})
	})
	// las validaciones, con su resumen: la app es el registro de lo que se validó (sobre todo desde la consola)
	mux.HandleFunc("GET /api/runs", func(w http.ResponseWriter, r *http.Request) {
		type summary struct {
			ID       string         `json:"id"`
			Repo     string         `json:"repo"`
			Slug     string         `json:"slug"`
			Branch   string         `json:"branch"`
			Base     string         `json:"base"`
			Title    string         `json:"title"`
			Local    bool           `json:"local"`  // antes del PR
			PR       *review.PR     `json:"pr"`     // si fue un PR ya abierto
			Status   string         `json:"status"` // running · done · failed
			Started  string         `json:"started"`
			Verdicts map[string]int `json:"verdicts"`
			Proofs   map[string]int `json:"proofs"`
			CostUSD  float64        `json:"costUsd"`
			Task     *review.Task   `json:"task"`
		}
		out := []summary{}
		for _, x := range review.List(root) {
			if x.Slug == "" {
				continue // las del primer día, por rama local con el formato viejo
			}
			s := summary{ID: x.ID, Repo: x.Repo, Slug: x.Slug, Branch: x.Branch, Base: strings.TrimPrefix(x.Base, "origin/"),
				Title: x.Proposal.Title, Local: x.Local || x.PR == nil, Status: x.Status, Started: x.Started,
				Verdicts: map[string]int{}, Proofs: map[string]int{}, CostUSD: x.CostUSD, Task: x.Task}
			if !s.Local {
				s.PR = x.PR
				if s.Title == "" {
					s.Title = x.PR.Title
				}
			}
			if s.Title == "" {
				s.Title = x.Branch
			}
			for _, f := range x.Findings {
				s.Verdicts[f.Verdict]++
				if f.Proof != nil {
					s.Proofs[f.Proof.Status]++
				}
			}
			out = append(out, s)
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
		if err != nil || x.Slug == "" {
			fail(w, http.StatusNotFound, errors.New("no existe esa validación"))
			return
		}
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		_, _ = w.Write([]byte(review.Report(x)))
	})
	mux.HandleFunc("POST /api/runs", func(w http.ResponseWriter, r *http.Request) {
		url, ok := decodeURL(w, r)
		if !ok {
			return
		}
		slug, n, err := review.ParsePRURL(url)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		key := fmt.Sprintf("%s#%d", slug, n)
		runsMu.Lock()
		if id, ok := byPR[key]; ok {
			runsMu.Unlock()
			writeJSON(w, http.StatusOK, map[string]string{"id": id, "note": "ya se está validando"})
			return
		}
		runsMu.Unlock()
		x, err := startRun(r.Context(), root, url)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		_ = review.Save(root, x)
		ctx, cancel := context.WithCancel(context.Background())
		runsMu.Lock()
		running[x.ID], byPR[key] = cancel, x.ID
		runsMu.Unlock()
		go func() {
			defer func() {
				runsMu.Lock()
				delete(running, x.ID)
				delete(byPR, key)
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
	mux.HandleFunc("POST /api/runs/{id}/prove", func(w http.ResponseWriter, r *http.Request) {
		x, err := review.Load(root, r.PathValue("id"))
		if err != nil || x.Slug == "" {
			fail(w, http.StatusNotFound, errors.New("no existe esa validación"))
			return
		}
		runsMu.Lock()
		if _, busy := running[x.ID]; busy {
			runsMu.Unlock()
			fail(w, http.StatusConflict, errors.New("esa validación todavía está corriendo"))
			return
		}
		if x.Status != "done" {
			runsMu.Unlock()
			fail(w, http.StatusConflict, errors.New("sólo se comprueba una validación terminada"))
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		running[x.ID] = cancel
		runsMu.Unlock()
		x.PID = os.Getpid()
		go func() {
			defer func() {
				runsMu.Lock()
				delete(running, x.ID)
				runsMu.Unlock()
				cancel()
			}()
			review.Prove(ctx, root, x, func(y *review.Run) { _ = review.Save(root, y) })
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
