// Command navegador entra a una página con Chromium (playwright-go), te deja loguearte A MANO en una ventana
// visible, y después la recorre sola con esa sesión: de cada página saca su estructura (encabezados, enlaces,
// formularios y sus campos, botones, con qué framework está hecha), con qué backend habla (XHR/fetch) y qué
// errores tira, más una captura. Todo queda en navegador/.data/ (ver store.go).
//
//	go run ./navegador/server -serve 127.0.0.1:5203                 la API de la interfaz (make navegador)
//	go run ./navegador/server -add https://sitio.com                da de alta un sitio
//	go run ./navegador/server -browse <sitio>                       abre la ventana para loguearte y navegar
//	go run ./navegador/server -explore <sitio> [-max 300 -depth 0]  recorre sin ventana con la sesión guardada (0: sin límite de niveles)
//	go run ./navegador/server -sites                                lista los sitios, en JSON
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"
)

var cliMode bool

func main() {
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1)")
	add := flag.String("add", "", "da de alta un sitio por su URL de entrada")
	name := flag.String("name", "", "con -add: el nombre a mostrar")
	browse := flag.String("browse", "", "abre la ventana visible en ese sitio (login manual y navegación)")
	explore := flag.String("explore", "", "recorre ese sitio sin ventana, con la sesión guardada")
	max := flag.Int("max", 300, "con -explore: cuántas páginas como mucho (tope 2000)")
	depth := flag.Int("depth", 0, "con -explore: cuántos clics desde la entrada (0: sin límite)")
	start := flag.String("start", "", "con -browse o -explore: arrancar en esta URL en vez de la entrada del sitio")
	sites := flag.Bool("sites", false, "lista los sitios")
	flag.Parse()

	store, err := OpenStore(dataDir())
	if err != nil {
		fail(err)
	}
	runner := NewRunner(store)
	defer runner.Close()

	switch {
	case *addr != "":
		if err := serve(*addr, store, runner); err != nil {
			fail(err)
		}
	case *add != "":
		site, err := store.AddSite(*add, *name)
		if err != nil {
			fail(err)
		}
		printJSON(site)
	case *sites:
		printJSON(store.Sites())
	case *explore != "":
		cliMode = true
		if err := runner.ExploreSync(*explore, ExploreOptions{Max: *max, Depth: *depth, Start: *start}); err != nil {
			fail(err)
		}
	case *browse != "":
		cliMode = true
		if err := runner.Browse(*browse, *start); err != nil {
			fail(err)
		}
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		for runner.State(0).Busy {
			select {
			case <-stop:
				runner.Stop()
			case <-time.After(300 * time.Millisecond):
			}
		}
	default:
		flag.Usage()
		os.Exit(2)
	}
}

// dataDir es navegador/.data, al lado de este archivo, corra desde donde corra.
func dataDir() string {
	if d := os.Getenv("NAVEGADOR_DATA"); d != "" {
		return d
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return ".data"
	}
	return filepath.Join(filepath.Dir(filepath.Dir(file)), ".data")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "navegador:", err)
	os.Exit(1)
}

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func handler(store *Store, runner *Runner) http.Handler {
	mux := http.NewServeMux()
	ok := map[string]bool{"ok": true}

	// GET /api/sites · POST /api/sites {url, name} · DELETE /api/sites?site=… (borra perfil, mapa y capturas)
	mux.HandleFunc("/api/sites", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, store.Sites())
		case http.MethodPost:
			var in struct{ URL, Name string }
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			site, err := store.AddSite(in.URL, in.Name)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			writeJSON(w, http.StatusOK, site)
		case http.MethodDelete:
			slug := r.URL.Query().Get("site")
			if st := runner.State(0); st.Busy && st.Site == slug {
				writeErr(w, http.StatusConflict, fmt.Errorf("el sitio está en uso: paralo primero"))
				return
			}
			if err := store.RemoveSite(slug); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			writeJSON(w, http.StatusOK, ok)
		default:
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("GET, POST o DELETE"))
		}
	})
	// GET /api/state?since=<seq> — si hay algo corriendo y los renglones nuevos de la consola.
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		since, _ := strconv.Atoi(r.URL.Query().Get("since"))
		writeJSON(w, http.StatusOK, runner.State(since))
	})
	// POST /api/browse?site=…&start=… — la ventana visible.
	mux.HandleFunc("/api/browse", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("POST"))
			return
		}
		if err := runner.Browse(r.URL.Query().Get("site"), r.URL.Query().Get("start")); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/explore?site=… {max, depth, start} — el recorrido sin ventana.
	mux.HandleFunc("/api/explore", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("POST"))
			return
		}
		var opts ExploreOptions
		_ = json.NewDecoder(r.Body).Decode(&opts)
		if err := runner.Explore(r.URL.Query().Get("site"), opts); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	mux.HandleFunc("/api/stop", func(w http.ResponseWriter, r *http.Request) {
		runner.Stop()
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/pages?site=… · DELETE /api/pages?site=… (vacía el mapa, no la sesión)
	mux.HandleFunc("/api/pages", func(w http.ResponseWriter, r *http.Request) {
		slug := r.URL.Query().Get("site")
		if _, err := store.Site(slug); err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		if r.Method == http.MethodDelete {
			if err := store.ClearPages(slug); err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, ok)
			return
		}
		pages, err := store.Pages(slug)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"pages": pages, "run": store.LastRun(slug)})
	})
	// GET /api/shot?site=…&id=… — la captura de una página.
	mux.HandleFunc("/api/shot", func(w http.ResponseWriter, r *http.Request) {
		slug, id := r.URL.Query().Get("site"), r.URL.Query().Get("id")
		if _, err := store.Site(slug); err != nil || len(id) != 12 {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, store.ShotPath(slug, id))
	})
	return mux
}

func serve(addr string, store *Store, runner *Runner) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	// Sólo local: el perfil de cada sitio tiene sesiones abiertas.
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("sólo escucha en 127.0.0.1, no en %q", host)
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	srv := &http.Server{Addr: addr, Handler: handler(store, runner)}
	go func() {
		<-stop
		runner.Close()
		_ = srv.Close()
	}()
	fmt.Fprintf(os.Stderr, "navegador: API en http://%s\n", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
