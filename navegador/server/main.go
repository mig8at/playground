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
	demo := flag.String("demo", "", "con -serve: sirve también Credidemo, el sitio de práctica (navegador/demo), en esta dirección")
	real := flag.String("real", "", "con -serve: sirve también Tienda Andina (navegador/demo-real), una tienda ficticia que ask trata como sitio REAL")
	flag.Parse()

	store, err := OpenStore(dataDir())
	if err != nil {
		fail(err)
	}
	runner := NewRunner(store)
	defer runner.Close()

	switch {
	case *addr != "":
		if *demo != "" {
			go serveDir(*demo, "demo", "Credidemo")
		}
		if *real != "" {
			go serveDir(*real, "demo-real", "Tienda Andina")
		}
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

// serveDir sirve un sitio de prueba de navegador/<sub> en otro puerto, para que el navegador lo trate como un
// sitio aparte: Credidemo (demo, de práctica) o Tienda Andina (demo-real, que ask trata como real).
func serveDir(addr, sub, name string) {
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(filepath.Dir(file)), sub)
	fs := http.FileServer(http.Dir(dir))
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		fs.ServeHTTP(w, r)
	})
	fmt.Fprintf(os.Stderr, "navegador: %s en http://%s\n", name, addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		fmt.Fprintf(os.Stderr, "navegador: %s: %v\n", name, err)
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
	// ── la sesión en vivo (live.go) ──
	// POST /api/live/start?site=…&start=… · POST /api/live/stop
	mux.HandleFunc("/api/live/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("POST"))
			return
		}
		vw, _ := strconv.Atoi(r.URL.Query().Get("w"))
		vh, _ := strconv.Atoi(r.URL.Query().Get("h"))
		if err := runner.LiveStart(r.URL.Query().Get("site"), r.URL.Query().Get("start"), vw, vh, r.URL.Query().Get("clean") == "1"); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, runner.LiveState(false))
	})
	mux.HandleFunc("/api/live/stop", func(w http.ResponseWriter, r *http.Request) {
		if st := runner.State(0); st.Busy && st.Kind == "live" {
			runner.Stop()
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/live/state[?fresh=1] — dónde está, qué hay para tocar (con sus localizadores) y los pasos.
	mux.HandleFunc("/api/live/state", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, runner.LiveState(r.URL.Query().Get("fresh") == "1"))
	})
	// GET /api/live/frames — los cuadros del screencast, por Server-Sent Events (JSON: {data: jpeg base64, meta}).
	mux.HandleFunc("/api/live/frames", func(w http.ResponseWriter, r *http.Request) {
		frames, cancel, err := runner.LiveSubscribe()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		defer cancel()
		flusher, okFlush := w.(http.Flusher)
		if !okFlush {
			writeErr(w, http.StatusInternalServerError, fmt.Errorf("sin streaming"))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		flusher.Flush()
		for {
			select {
			case <-r.Context().Done():
				return
			case f, open := <-frames:
				if !open {
					fmt.Fprint(w, "event: end\ndata: {}\n\n")
					flusher.Flush()
					return
				}
				fmt.Fprintf(w, "data: %s\n\n", f)
				flusher.Flush()
			}
		}
	})
	// POST /api/live/input {type, x, y, dx, dy, key, text} — lo que se hizo sobre el canvas.
	mux.HandleFunc("/api/live/input", func(w http.ResponseWriter, r *http.Request) {
		var in LiveInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := runner.LiveInput(in); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/viewport {w, h} — el tamaño del editor, para que la página se vea 1:1.
	mux.HandleFunc("/api/live/viewport", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ W, H int }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := runner.LiveResize(in.W, in.H); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/nav {action: goto|back|forward|reload, url}
	mux.HandleFunc("/api/live/nav", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Action, URL string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := runner.LiveNav(in.Action, in.URL); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/act {control, action, value, version} — una acción sobre un elemento, por su localizador.
	mux.HandleFunc("/api/live/act", func(w http.ResponseWriter, r *http.Request) {
		var in LiveAct
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		step, err := runner.LiveAct(in)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "step": step})
			return
		}
		writeJSON(w, http.StatusOK, step)
	})
	// GET /api/live/text — el texto visible de la página.
	mux.HandleFunc("/api/live/text", func(w http.ResponseWriter, r *http.Request) {
		text, err := runner.LiveText()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
	})
	// GET /api/live/shot — lo que se ve ahora, en PNG.
	mux.HandleFunc("/api/live/shot", func(w http.ResponseWriter, r *http.Request) {
		png, err := runner.LiveShot()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(png)
	})
	// GET /api/live/script — los pasos como script de Playwright.
	mux.HandleFunc("/api/live/script", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(runner.LiveScript()))
	})
	// POST /api/live/expect {text, seconds} — espera a que el texto se vea y lo deja como aserción.
	mux.HandleFunc("/api/live/expect", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text    string
			Seconds float64
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		step, err := runner.LiveExpect(in.Text, in.Seconds)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "step": step})
			return
		}
		writeJSON(w, http.StatusOK, step)
	})
	// POST /api/live/value {control, text, expected} — el valor de un campo; con expected, queda como aserción.
	mux.HandleFunc("/api/live/value", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Control  int
			Text     string
			Expected string
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		value, step, err := runner.LiveValue(in.Control, in.Text, in.Expected)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "value": value, "step": step})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"value": value, "step": step})
	})
	// POST /api/live/dialog {dismiss} — cómo contestar los próximos alert/confirm/prompt.
	mux.HandleFunc("/api/live/dialog", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Dismiss bool }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := runner.LiveDialogPolicy(in.Dismiss); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/report {meta, resultado} — el paso a paso de la corrida (md, html con fotos y script).
	mux.HandleFunc("/api/live/report", func(w http.ResponseWriter, r *http.Request) {
		var in ReportInfo
		_ = json.NewDecoder(r.Body).Decode(&in)
		dir, err := runner.LiveReport(in)
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"dir": dir, "html": filepath.Join(dir, "reporte.html"), "md": filepath.Join(dir, "reporte.md"),
			"url": "http://localhost:5202/api/corridas/" + filepath.Base(dir) + "/reporte.html"})
	})
	// POST /api/live/download {control, text, url} — baja el recurso de un elemento o de una URL.
	mux.HandleFunc("/api/live/download", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Control   int
			Text, URL string
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		step, err := runner.LiveDownload(in.Control, in.Text, in.URL)
		if err != nil {
			writeErr(w, http.StatusUnprocessableEntity, err)
			return
		}
		writeJSON(w, http.StatusOK, step)
	})
	// GET /api/live/images — las imágenes visibles, las más grandes primero.
	mux.HandleFunc("/api/live/images", func(w http.ResponseWriter, r *http.Request) {
		m, err := runner.LiveImages()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, m)
	})
	// GET /api/live/media — el estado de los videos y audios de la página.
	mux.HandleFunc("/api/live/media", func(w http.ResponseWriter, r *http.Request) {
		m, err := runner.LiveMedia()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, m)
	})
	// DELETE /api/live/steps — empieza la lista de pasos de cero.
	mux.HandleFunc("/api/live/steps", func(w http.ResponseWriter, r *http.Request) {
		runner.LiveClearSteps()
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/corridas/<corrida>/<archivo> — el paso a paso de una corrida (reporte.html, sus fotos, el script).
	corridas := http.StripPrefix("/api/corridas/", http.FileServer(http.Dir(filepath.Join(store.dir, "corridas"))))
	mux.Handle("/api/corridas/", corridas)
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
