// Command jarvis es el servidor local de Jarvis: la API que usan la interfaz, el CLI (bin/jarvis) y Claude, y el
// puente con la extensión Jarvis del Chrome de la persona (chrome.go), que es donde corre todo. Lo que guarda vive
// en jarvis/.data/ (ver store.go).
//
//	go run ./jarvis/server -serve 127.0.0.1:5203   la API (make jarvis); sirve también las apps de jarvis/apps
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"creditop/my-tools/lib/launchagent"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"creditop/my-tools/jarvis/docs"
)

var cliMode bool

func main() {
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1); sirve también las apps locales de jarvis/apps")
	install := flag.Bool("install", false, "dejar la API de fondo (LaunchAgent)")
	uninstall := flag.Bool("uninstall", false, "sacarla de fondo")
	status := flag.Bool("status", false, "¿corre de fondo?")
	flag.Parse()
	// DE FONDO (2026-11-18): la API como LaunchAgent, para que `bin/jarvis` ande con Cockpit cerrado o con Jarvis oculto.
	// `make jarvis-install`; después de cambiar el servidor, de nuevo (o `bin/cockpit restart jarvis`).
	if *install || *uninstall || *status {
		wd, _ := os.Getwd()
		agent := launchagent.Agent{Label: "com.creditop.my-tools.jarvis", Args: []string{"-serve", "127.0.0.1:5203"}, Root: wd, Log: "my-tools-jarvis.log"}
		var err error
		switch {
		case *install:
			err = agent.Install()
		case *uninstall:
			err = agent.Uninstall()
		default:
			fmt.Println(agent.Status())
		}
		if err != nil {
			fail(err)
		}
		return
	}
	if *addr == "" {
		flag.Usage()
		os.Exit(2)
	}
	// Antes que nada: si otra copia ya escucha (la de fondo, o la de `make jarvis`), ésta espera su turno. Sólo la que
	// escucha abre el store, las pestañas y las apps de práctica.
	ln, err := launchagent.Listen("jarvis", *addr)
	if err != nil {
		fail(err)
	}
	store, err := OpenStore(dataDir())
	if err != nil {
		fail(err)
	}
	tabs := NewTabs(store)
	defer tabs.CloseAll()
	if v := os.Getenv("JARVIS_TAB_DONE_IDLE"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d >= 0 {
			tabs.doneIdle = d
		}
	}
	go sweepTabs(tabs, IdleLimit(os.Getenv("JARVIS_TAB_IDLE")))
	go syncAttention(tabs)
	for _, a := range listApps() {
		go serveDir(a.Addr(), filepath.Join("apps", a.ID), a.Name, a.API)
	}
	if err := serve(ln, store, tabs); err != nil {
		fail(err)
	}
}

// sweepTabs cierra cada medio minuto lo que ya no hace falta (cleanup.go): las sesiones de Claude sin uso y las
// pestañas huérfanas que dejó un reinicio.
func sweepTabs(tabs *Tabs, idle time.Duration) {
	if idle <= 0 {
		return
	}
	log.Printf("jarvis: se cierran solas las sesiones de Claude terminadas a los %s y las olvidadas a los %s (JARVIS_TAB_DONE_IDLE, JARVIS_TAB_IDLE), y las pestañas huérfanas", tabs.doneIdle, idle)
	for range time.Tick(30 * time.Second) {
		for _, it := range tabs.Cleanup(time.Now(), idle, false, true) {
			log.Printf("jarvis: cerré %s %s%d (%s): %s", it.Kind, it.Session, it.ChromeTab, it.URL, it.Reason)
		}
	}
}

// serveDir sirve una app local (jarvis/apps/<app>) en su puerto: el navegador la trata como un sitio aparte.
func serveDir(addr, sub, name string, withAPI bool) {
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(filepath.Dir(file)), sub)
	fs := http.FileServer(http.Dir(dir))
	api := newPracticeAPI()
	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if withAPI && strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		fs.ServeHTTP(w, r)
	})
	fmt.Fprintf(os.Stderr, "jarvis: %s en http://%s\n", name, addr)
	if err := http.ListenAndServe(addr, h); err != nil {
		fmt.Fprintf(os.Stderr, "jarvis: %s: %v\n", name, err)
	}
}

// dataDir es jarvis/.data, al lado de este archivo, corra desde donde corra.
func dataDir() string {
	if d := os.Getenv("JARVIS_DATA"); d != "" {
		return d
	}
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		return ".data"
	}
	return filepath.Join(filepath.Dir(filepath.Dir(file)), ".data")
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "jarvis:", err)
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

func handler(store *Store, tabs *Tabs) http.Handler {
	mux := http.NewServeMux()
	ok := map[string]bool{"ok": true}

	// GET /api/state?since=N — el registro de lo que hace el corredor (y si está ocupado).
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		since, _ := strconv.Atoi(r.URL.Query().Get("since"))
		writeJSON(w, http.StatusOK, runner.State(since))
	})
	// GET /api/events — el stream en tiempo real de la interfaz (events.go).
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) { serveEvents(w, r, tabs, store) })
	// GET /api/tabs — las pestañas · POST /api/tabs — abre una vacía y devuelve su id · DELETE /api/tabs/<id> — la
	// cierra (frena su Claude y su sesión).
	mux.HandleFunc("/api/tabs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			// Con {group, color}, la sesión nace en ese grupo de Chrome (groups.go).
			var body struct{ Group, Color string }
			_ = json.NewDecoder(r.Body).Decode(&body)
			tab, err := tabs.NewIn(fromCLI(r), body.Group, body.Color)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"id": tab.ID, "group": tab.Group, "color": tab.Color})
			return
		}
		writeJSON(w, http.StatusOK, tabs.Info())
	})
	// POST /api/tabs/claim {group, color} — la sesión para una meta nueva de ese grupo, elegida y reservada de una vez
	// (Tabs.Claim): así dos `start` en paralelo no toman la misma.
	mux.HandleFunc("/api/tabs/claim", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("POST"))
			return
		}
		var body struct {
			Group, Color, URL string
			Auto, Aside       bool
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		tab, how, err := tabs.Claim(fromCLI(r), body.Group, body.Color, body.URL, body.Auto, body.Aside)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		t := tabs.Info()
		out := map[string]string{"id": tab.ID, "reused": how}
		for _, i := range t {
			if i.ID == tab.ID {
				out["group"], out["color"], out["url"] = i.Group, i.Color, i.URL
			}
		}
		writeJSON(w, http.StatusOK, out)
	})
	// PUT /api/tabs/<id> {group, color} — la pasa a otro grupo (vacío: al «Jarvis» de siempre) y mueve su pestaña.
	mux.HandleFunc("/api/tabs/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			tab := tabs.Get(strings.TrimPrefix(r.URL.Path, "/api/tabs/"))
			if tab == nil || strings.TrimPrefix(r.URL.Path, "/api/tabs/") == "" {
				writeErr(w, http.StatusNotFound, fmt.Errorf("no hay pestaña %s", strings.TrimPrefix(r.URL.Path, "/api/tabs/")))
				return
			}
			var body struct{ Group, Color string }
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			name, color, err := tabs.SetGroup(tab, body.Group, body.Color)
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			tabs.Touch(tab)
			writeJSON(w, http.StatusOK, map[string]string{"id": tab.ID, "group": name, "color": color})
			return
		}
		if r.Method != http.MethodDelete {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("DELETE o PUT"))
			return
		}
		if err := tabs.Close(strings.TrimPrefix(r.URL.Path, "/api/tabs/")); err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/apps — las apps locales para practicar (jarvis/apps/*/app.json).
	mux.HandleFunc("/api/apps", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, listAll())
	})
	// ── la sesión en vivo (live.go) ──
	// POST /api/live/start?url=…[&tab=new] · POST /api/live/stop (siempre en el Chrome de la persona). Con tab=new abre la página en
	// una pestaña nueva; si no, en la del pedido (o la última).
	mux.HandleFunc("/api/live/start", func(w http.ResponseWriter, r *http.Request) {
		var tab *Tab
		if r.URL.Query().Get("tab") == "new" || r.Header.Get(tabHeader) == "new" {
			tab = tabs.NewBy(fromCLI(r))
		} else if tab = tabs.pick(w, r); tab == nil {
			return
		}
		runner := tab.Runner
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("POST"))
			return
		}
		q := r.URL.Query()
		if q.Get("aside") == "1" {
			runner.SetAside(true) // la pestaña va en la ventana aparte (aside.go)
		}
		site, err := store.SiteFor(q.Get("url"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		// Si ya hay una sesión: del mismo sitio (y el mismo perfil), se navega ahí; de otro, se cierra primero.
		if st := runner.LiveState(false); st.Active {
			if st.Site == site.Slug {
				if err := runner.LiveNav("goto", q.Get("url")); err != nil {
					writeErr(w, http.StatusConflict, err)
					return
				}
				writeJSON(w, http.StatusOK, runner.LiveState(false))
				return
			}
			runner.Stop()
			for i := 0; i < 100 && runner.State(0).Busy; i++ {
				time.Sleep(100 * time.Millisecond)
			}
		}
		if err := runner.LiveStart(site.Slug, q.Get("url")); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, runner.LiveState(false))
	})
	mux.HandleFunc("/api/live/stop", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		if st := runner.State(0); st.Busy && st.Kind == "live" {
			runner.Stop()
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/live/state[?fresh=1] — dónde está, qué hay para tocar (con sus localizadores) y los pasos.
	mux.HandleFunc("/api/live/state", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		writeJSON(w, http.StatusOK, runner.LiveState(r.URL.Query().Get("fresh") == "1"))
	})
	// GET /api/live/thumbs — el último cuadro de cada sesión, a lo sumo uno por segundo, por un solo stream: la vista
	// «Todas» de la interfaz (thumbs.go). No cuenta como mirar: no frena el cierre automático.
	mux.HandleFunc("/api/live/thumbs", func(w http.ResponseWriter, r *http.Request) { serveThumbs(w, r, tabs) })
	// GET /api/live/frames — los cuadros del screencast, por Server-Sent Events (JSON: {data: jpeg base64, meta}).
	mux.HandleFunc("/api/live/frames", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		frames, cancel, err := runner.LiveSubscribe()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		defer cancel()
		// Mientras la interfaz la mira, la pestaña no se cierra sola (Sweep).
		defer tabs.Watch(tab)()
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
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
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
	// POST /api/live/device {device: desktop|mobile} — reabre la sesión en la misma página en ese dispositivo.
	mux.HandleFunc("/api/live/device", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ Device string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := runner.LiveDevice(in.Device); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/ua {ua: iphone|<texto>|""} — el agente de la pestaña (live.go, LiveUserAgent).
	mux.HandleFunc("/api/live/ua", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		var in struct{ UA string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		ua, err := tab.Runner.LiveUserAgent(in.UA)
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"ua": ua})
	})
	// POST /api/live/nav {action: goto|back|forward|reload, url}
	mux.HandleFunc("/api/live/nav", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ Action, URL string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		err := runner.LiveNav(in.Action, in.URL)
		runner.noteFocusResult(err)
		if err != nil {
			var note *NavNote
			if errors.As(err, &note) {
				writeJSON(w, http.StatusOK, map[string]any{"ok": true, "note": note.Note})
				return
			}
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/act {control, action, value, version} — una acción sobre un elemento, por su localizador.
	mux.HandleFunc("/api/live/act", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in LiveAct
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		step, err := runner.LiveAct(in)
		runner.noteFocusResult(err)
		if err != nil {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "step": step})
			return
		}
		writeJSON(w, http.StatusOK, step)
	})
	// GET /api/live/text — el texto visible de la página.
	mux.HandleFunc("/api/live/text", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		text, err := runner.LiveText()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"text": text})
	})
	// GET /api/live/shot — lo que se ve ahora, en PNG. Con ?full=1, todo lo que se desplaza (fullshot.go).
	mux.HandleFunc("/api/live/shot", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		if r.URL.Query().Get("full") == "1" {
			// Las páginas, en JSON (base64): el CLI las guarda numeradas (captura-01.png, -02…).
			list, err := runner.LiveShotFull()
			if err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string][][]byte{"pages": list})
			return
		}
		png, err := runner.LiveShot()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(png)
	})
	// GET /api/live/record — cómo va la grabación · POST {"action": "start"|"stop"} — empezar o terminar (record.go).
	mux.HandleFunc("/api/live/record", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var (
			info RecordingInfo
			err  error
		)
		if r.Method == http.MethodGet {
			info, err = runner.LiveRecordStatus()
		} else {
			var body struct {
				Action string `json:"action"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			switch body.Action {
			case "start":
				info, err = runner.LiveRecordStart()
			case "stop":
				info, err = runner.LiveRecordStop()
			default:
				err = fmt.Errorf("action: start o stop, no %q", body.Action)
			}
		}
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, info)
	})
	// GET /api/live/script — los pasos como script de Playwright.
	mux.HandleFunc("/api/live/script", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(runner.LiveScript()))
	})
	// POST /api/live/expect {text, seconds} — espera a que el texto se vea y lo deja como aserción.
	mux.HandleFunc("/api/live/expect", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
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
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
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
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
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
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in ReportInfo
		_ = json.NewDecoder(r.Body).Decode(&in)
		dir, err := runner.LiveReport(in)
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"dir": dir, "id": filepath.Base(dir), "url": "http://localhost:5202/#/corrida/" + filepath.Base(dir)})
	})
	// POST /api/live/download {control, text, url} — baja el recurso de un elemento o de una URL.
	mux.HandleFunc("/api/live/download", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
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
	// GET /api/live/read — el contenido principal de la página, legible, con su fecha de actualización.
	mux.HandleFunc("/api/live/read", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		res, err := runner.LiveRead()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// DELETE /api/live/steps — empieza la lista de pasos de cero.
	mux.HandleFunc("/api/live/steps", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		runner.LiveClearSteps()
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/guide {control|text, version, name, instruction} — modo guía: marca el elemento y espera a que
	// la persona lo haga (hasta 100 s). POST /api/live/guide/answer {done, note} — su «Hecho» / «No lo encuentro».
	mux.HandleFunc("/api/live/guide", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct {
			LiveAct
			Instruction string `json:"instruction"`
		}
		in.Control = -1
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		res, err := runner.LiveGuide(in.LiveAct, in.Instruction)
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	mux.HandleFunc("/api/live/guide/answer", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct {
			Done bool   `json:"done"`
			Note string `json:"note"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := runner.LiveGuideAnswer(in.Done, in.Note); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/live/changes — los campos cambiados desde el último guardar: antes → después (secretos tapados).
	mux.HandleFunc("/api/live/changes", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		ch, err := runner.LiveChanges()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ch)
	})
	// POST /api/live/replay/start {run} — repite una corrida sin Claude, paso a paso, con la persona eligiendo.
	// POST /api/live/replay/answer {choice: do|self|done|skip|stop|auto|manual}
	mux.HandleFunc("/api/live/replay/start", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ Run, Mode string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := runner.LiveReplayStart(in.Run, in.Mode); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, runner.LiveState(false))
	})
	mux.HandleFunc("/api/live/replay/answer", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ Choice string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := runner.LiveReplayAnswer(in.Choice); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/narrate {text} — lo que Claude pensó antes de su próxima acción (el «por qué» del subtítulo).
	mux.HandleFunc("/api/live/narrate", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ Text string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		runner.LiveNarrate(in.Text)
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/live/check {js} — para la suite de evals: si una expresión da true en la página (lo que quedó
	// guardado). No tiene comando en el CLI: Claude no corre JS.
	mux.HandleFunc("/api/live/check", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		var in struct{ JS string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		ok, err := runner.LiveCheck(in.JS)
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": ok})
	})
	// GET /api/cleanup — qué se puede cerrar ahora y por qué (sesiones de Claude terminadas u olvidadas, pestañas
	// huérfanas) · POST — lo cierra. cleanup.go.
	mux.HandleFunc("/api/cleanup", func(w http.ResponseWriter, r *http.Request) {
		items := tabs.Cleanup(time.Now(), IdleLimit(os.Getenv("JARVIS_TAB_IDLE")), true, r.Method == http.MethodPost)
		if items == nil {
			items = []CleanupItem{}
		}
		writeJSON(w, http.StatusOK, items)
	})
	// GET /api/live/devlog?since=N — la consola y la red de la sesión desde el número N (devlog.go).
	mux.HandleFunc("/api/live/devlog", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		since, _ := strconv.Atoi(r.URL.Query().Get("since"))
		writeJSON(w, http.StatusOK, tab.Runner.LiveDevLog(since))
	})
	// POST /api/live/attention {reason} — Claude necesita a la persona en esta sesión (vacío lo borra). attention.go.
	mux.HandleFunc("/api/live/attention", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		var in struct{ Reason string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		tab.Runner.SetAttention(in.Reason)
		writeJSON(w, http.StatusOK, map[string]string{"attention": tab.Attention()})
	})
	// GET /api/focus — qué sitios van al frente (focus.go) · PUT {host, mode} — lo pone a mano (mode "" lo borra) ·
	// PUT {follow} — «seguir a Claude»: cada comando trae su pestaña.
	mux.HandleFunc("/api/focus", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			var in struct {
				Host   string
				Mode   string
				Follow *bool
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			var err error
			switch {
			case in.Follow != nil:
				err = focusStore.SetFollow(*in.Follow)
			case in.Mode == "":
				err = focusStore.Set(focusHost("https://"+in.Host), nil)
			default:
				err = focusStore.Set(focusHost("https://"+in.Host), &FocusProfile{Mode: in.Mode, Source: "manual"})
			}
			if err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
		}
		writeJSON(w, http.StatusOK, focusStore.View())
	})
	// POST /api/live/focus-check — mide si el sitio de la sesión anda con la pestaña detrás y lo guarda.
	mux.HandleFunc("/api/live/focus-check", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		res, err := tab.Runner.FocusCheck()
		if err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, res)
	})
	// GET /api/flows — los flujos (jarvis/flows). POST /api/flows {run, name} — guarda una corrida como flujo.
	// GET|DELETE /api/flows/<app>/<id> · POST /api/flows/<app>/<id>/replay {mode: auto|teach}
	// ── el motor «chrome» (chrome.go): la extensión, Playwright y el estado ──
	mux.HandleFunc("/api/chrome/bridge", chromeBridge.serveExtension)
	mux.HandleFunc("/api/chrome/cdp", chromeBridge.servePlaywright)
	mux.HandleFunc("/api/chrome", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, chromeBridge.Status())
	})
	// ── la documentación de cada herramienta (jarvis/docs: recetas, grabaciones, mapa y barrido) ──
	// GET /api/docs — las herramientas, con lo que hay de cada una · GET /api/docs/<app> — todo lo de una.
	// La pestaña Jarvis de la extensión la muestra; el CLI la arma solo, sin el servidor.
	repo := filepath.Dir(jarvisDir())
	mux.HandleFunc("/api/docs", func(w http.ResponseWriter, r *http.Request) {
		type summary struct {
			ID       string   `json:"id"`
			Name     string   `json:"name"`
			Hosts    []string `json:"hosts,omitempty"`
			Recipes  int      `json:"recipes"`
			Cases    int      `json:"cases"`
			Screens  int      `json:"screens"`
			Sections int      `json:"sections"`
			Menu     int      `json:"menu"`
		}
		out := []summary{}
		for _, id := range docs.Apps(repo) {
			a, err := docs.Load(repo, id)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err)
				return
			}
			menu := 0
			for _, s := range a.Sections {
				menu += len(s.Screens)
			}
			out = append(out, summary{a.ID, a.Name, a.Hosts, len(a.Recipes), len(a.Cases), len(a.Screens), len(a.Sections), menu})
		}
		writeJSON(w, http.StatusOK, out)
	})
	mux.HandleFunc("/api/docs/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/docs/"), "/")
		if id == "" || strings.ContainsAny(id, "./\\") {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("herramienta inválida %q", id))
			return
		}
		a, err := docs.Load(repo, id)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		if len(a.Recipes) == 0 && len(a.Screens) == 0 && len(a.Sections) == 0 {
			writeErr(w, http.StatusNotFound, fmt.Errorf("Jarvis no sabe nada de %q", id))
			return
		}
		writeJSON(w, http.StatusOK, a)
	})
	mux.HandleFunc("/api/flows", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var in struct {
				Run, Name string
				Into      string `json:"into"` // <app>/<id>: actualizar ése
				New       bool   `json:"new"`  // uno nuevo aunque haya uno igual
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			fl, how, err := store.SaveFlow(in.Run, in.Name, SaveOpts{Into: in.Into, New: in.New})
			if err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"app": fl.App, "id": fl.ID, "how": how, "path": filepath.Join("jarvis", "flows", fl.App, fl.ID+".json")})
			return
		}
		writeJSON(w, http.StatusOK, listFlows())
	})
	mux.HandleFunc("/api/flows/", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/flows/"), "/")
		if len(parts) < 2 {
			http.NotFound(w, r)
			return
		}
		app, id := parts[0], parts[1]
		switch {
		case len(parts) == 3 && parts[2] == "replay" && r.Method == http.MethodPost:
			var in struct {
				Mode   string         `json:"mode"`
				Values map[int]string `json:"values"` // los datos que la persona cambió, por número de paso
				Start  string         `json:"start"`  // otra página de entrada (un lote no puede arrancar en «?reset»)
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			if err := runner.LiveReplayFlow(app, id, in.Mode, in.Values, in.Start); err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, runner.LiveState(false))
		case len(parts) == 3 && parts[2] == "repairs" && r.Method == http.MethodPost:
			// POST /api/flows/<app>/<id>/repairs {action: apply|discard}: los arreglos que propuso una repetición.
			var in struct{ Action string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			fl, n, err := FlowRepairs(app, id, in.Action)
			if err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"app": fl.App, "id": fl.ID, "count": n})
		case r.Method == http.MethodPut:
			var in struct {
				Name  string     `json:"name"`
				Steps []FlowEdit `json:"steps"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			if _, err := updateFlow(app, id, in.Name, in.Steps); err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, ok)
		case r.Method == http.MethodDelete:
			if err := deleteFlow(app, id); err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeJSON(w, http.StatusOK, ok)
		default:
			fl, err := getFlow(app, id)
			if err != nil {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"app": fl.App, "id": fl.ID, "flow": fl})
		}
	})
	// POST /api/projects {id, nombre, url} — un proyecto con nombre propio para un sitio real.
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ ID, Name, URL string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := createProject(in.ID, in.Name, in.URL); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// DELETE /api/projects/<app> — borra un proyecto: sus flujos y sus corridas.
	mux.HandleFunc("/api/projects/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeErr(w, http.StatusMethodNotAllowed, fmt.Errorf("DELETE"))
			return
		}
		flows, runs, err := store.DeleteProject(strings.TrimPrefix(r.URL.Path, "/api/projects/"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]int{"flows": flows, "runs": runs})
	})
	// GET /api/runs — las corridas con reporte (meta, palabra final, costo), las más nuevas primero.
	// GET /api/runs/<id> — una corrida completa: pasos con sus fotos, fuentes y script.
	mux.HandleFunc("/api/runs", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, store.Runs())
	})
	mux.HandleFunc("/api/runs/", func(w http.ResponseWriter, r *http.Request) {
		// GET /api/runs/<id|last>/devlog — la consola y la red guardadas de la corrida (devlog.go).
		if id, ok := strings.CutSuffix(strings.TrimPrefix(r.URL.Path, "/api/runs/"), "/devlog"); ok {
			d, real, err := store.RunDevLog(id)
			if err != nil {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"run": real, "console": d.Console, "network": d.Network, "active": true})
			return
		}
		run, err := store.Run(strings.TrimPrefix(r.URL.Path, "/api/runs/"))
		if err != nil {
			writeErr(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, http.StatusOK, run)
	})
	// POST /api/ask {meta, url, pasos} — lanza una meta (bin/jarvis ask). GET /api/ask?desde=N — lo que va
	// diciendo. POST /api/ask/answer {text} — contesta un NECESITO/CONFIRMAR. POST /api/ask/stop — la frena.
	mux.HandleFunc("/api/ask", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		asker := tab.Asker
		if r.Method == http.MethodGet {
			since, _ := strconv.Atoi(r.URL.Query().Get("desde"))
			writeJSON(w, http.StatusOK, asker.State(since))
			return
		}
		var in struct {
			Goal   string `json:"meta"`
			URL    string `json:"url"`
			Steps  int    `json:"steps"`
			Device string `json:"device"`
			Mode   string `json:"mode"` // guide · do
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if err := asker.Start("http://"+apiAddr, in.Goal, in.URL, in.Device, in.Mode == "guide", in.Steps); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	mux.HandleFunc("/api/ask/answer", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		asker := tab.Asker
		var in struct{ Text string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := asker.Answer(in.Text); err != nil {
			writeErr(w, http.StatusConflict, err)
			return
		}
		writeJSON(w, http.StatusOK, ok)
	})
	// POST /api/ask/external {accion: begin|event|end, meta, k, t} — una sesión que maneja Claude desde la
	// conversación (bin/jarvis start · think · finish): el panel la muestra igual que una de ask.
	mux.HandleFunc("/api/ask/external", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		runner := tab.Runner
		asker := tab.Asker
		var in struct {
			Action string `json:"action"`
			Goal   string `json:"meta"`
			Kind   string `json:"k"`
			Text   string `json:"t"`
			Keep   string `json:"keep"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := checkKeep(in.Keep); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		switch in.Action {
		case "keep":
			asker.SetKeep(in.Keep)
			runner.SetKeep(in.Keep)
		case "discard": // finish de una meta «none»: la corrida no queda
			writeJSON(w, http.StatusOK, map[string]string{"discarded": runner.DiscardRun()})
			return
		case "begin":
			runner.SetKeep(in.Keep)
			if err := asker.Begin(in.Goal, in.Keep); err != nil {
				writeErr(w, http.StatusConflict, err)
				return
			}
			tabs.Release(tab) // ya la protege su meta: la reserva de Claim sobra
		case "end":
			asker.End()
			runner.SetKeep("")      // la meta ya decidió qué quedaba (finish); lo que siga en la sesión, como siempre
			runner.SetAttention("") // terminada la meta, lo que Claude había pedido ya no corre
			tabs.Release(tab)       // terminada, la puede tomar la próxima meta (en el mismo sitio, con su pestaña)
		default:
			if in.Kind == "think" {
				runner.LiveNarrate(in.Text) // también es el subtítulo del próximo paso
			}
			asker.Event(in.Kind, in.Text)
		}
		writeJSON(w, http.StatusOK, ok)
	})
	mux.HandleFunc("/api/ask/stop", func(w http.ResponseWriter, r *http.Request) {
		tab := tabs.pick(w, r)
		if tab == nil {
			return
		}
		asker := tab.Asker
		asker.Stop()
		writeJSON(w, http.StatusOK, ok)
	})
	// GET /api/run-files/<corrida>/<archivo> — el paso a paso de una corrida (sus fotos y el script).
	runFiles := http.StripPrefix("/api/run-files/", http.FileServer(http.Dir(filepath.Join(store.dir, "runs"))))
	mux.Handle("/api/run-files/", runFiles)
	return mux
}

// apiAddr es la dirección de la API, para que el ask que se lanza desde la interfaz le hable a ésta.
var apiAddr string

func serve(ln net.Listener, store *Store, tabs *Tabs) error {
	addr := ln.Addr().String()
	apiAddr = addr
	go watchLive(tabs)
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
	srv := &http.Server{Addr: addr, Handler: handler(store, tabs)}
	go func() {
		<-stop
		tabs.CloseAll()
		_ = srv.Close()
	}()
	fmt.Fprintf(os.Stderr, "jarvis: API en http://%s\n", addr)
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
