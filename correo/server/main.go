// correo — vigila en Gmail los remitentes que importan (Shopify, VTEX…) y avisa por macOS cuando llega algo nuevo, aunque
// Cockpit esté cerrado. Sólo lee (`gmail.readonly`, la sesión de `bin/pg gmail login`): nunca manda, borra ni marca
// nada en Gmail; «visto» es de esta herramienta.
//
//	go run ./correo/server -serve 127.0.0.1:5225   la API (y la vigilancia), lo que levanta `make correo`
//	go run ./correo/server -once                    una lectura por consola, sin avisar
//	correo/bin/correo -install | -uninstall         de fondo, como LaunchAgent (`make correo-install`)
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/connectors/gmail"
	"creditop/my-tools/lib/launchagent"
)

type app struct {
	store  *store
	digest *digester

	mu        sync.Mutex
	client    *gmail.Client
	account   string
	checkedAt time.Time
	lastErr   string
	running   bool
	bodies    map[string]gmail.Message // los cuerpos ya pedidos, en memoria
}

// gmailClient abre la sesión la primera vez que hace falta (y de nuevo si falló: el login puede llegar después).
func (a *app) gmailClient() (*gmail.Client, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.client != nil {
		return a.client, nil
	}
	c, err := gmail.Open()
	if err != nil {
		return nil, err
	}
	a.client, a.account = c, c.Email()
	return c, nil
}

// pass lee cada seguimiento: sus últimos correos (de los nuevos, sólo los encabezados) y avisa de los que no avisaron.
func (a *app) pass(notify bool) error {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return nil
	}
	a.running = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.running = false; a.mu.Unlock() }()

	err := a.read(notify)
	a.mu.Lock()
	a.checkedAt = time.Now()
	a.lastErr = ""
	if err != nil {
		a.lastErr = err.Error()
	}
	a.mu.Unlock()
	return err
}

func (a *app) read(notify bool) error {
	c, err := a.gmailClient()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	for _, w := range a.store.watches() {
		ids, err := c.Search(ctx, w.Query+" newer_than:60d", keepPerWatch)
		if err != nil {
			return fmt.Errorf("%s: %w", w.Name, err)
		}
		known := a.store.known(w.ID)
		var msgs []gmail.Message
		for _, id := range ids {
			if m, ok := known[id]; ok {
				msgs = append(msgs, m)
				continue
			}
			m, err := c.Get(ctx, id, false)
			if err != nil {
				return fmt.Errorf("%s: %w", w.Name, err)
			}
			msgs = append(msgs, m)
		}
		// Los hilos de lo que se muestra: quién escribió último, para saber si se respondió.
		threads := map[string]Thread{}
		for _, m := range msgs {
			if _, done := threads[m.ThreadID]; done {
				continue
			}
			th, err := c.Thread(ctx, m.ThreadID)
			if err != nil {
				return fmt.Errorf("%s: %w", w.Name, err)
			}
			threads[m.ThreadID] = threadOf(th, c.Email())
		}
		a.store.setThreads(threads)
		for _, m := range a.store.update(w.ID, w.Query, msgs, time.Now()) {
			if notify {
				if err := notice(w, m, threads[m.ThreadID]); err != nil {
					log.Printf("correo: el aviso de %s no salió: %v", m.ID, err)
				}
			}
		}
	}
	return nil
}

// Overview es lo que pide la interfaz.
type Overview struct {
	Account   string      `json:"account"`
	CheckedAt time.Time   `json:"checkedAt"`
	Error     string      `json:"error,omitempty"`
	Running   bool        `json:"running"`
	Unread    int         `json:"unread"`
	Watches   []WatchView `json:"watches"`
	Every     string      `json:"every"`
}

func (a *app) overview(every time.Duration) Overview {
	a.mu.Lock()
	o := Overview{Account: a.account, CheckedAt: a.checkedAt, Error: a.lastErr, Running: a.running, Every: every.String()}
	a.mu.Unlock()
	o.Watches, o.Unread = a.store.view(o.Account)
	return o
}

func (a *app) message(id string) (gmail.Message, error) {
	a.mu.Lock()
	m, ok := a.bodies[id]
	a.mu.Unlock()
	if ok {
		return m, nil
	}
	c, err := a.gmailClient()
	if err != nil {
		return m, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	m, err = c.Get(ctx, id, true)
	if err != nil {
		return m, err
	}
	a.mu.Lock()
	a.bodies[id] = m
	a.mu.Unlock()
	return m, nil
}

func ctxTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func agent(root, serve string) launchagent.Agent {
	return launchagent.Agent{Label: "com.creditop.correo", Args: []string{"-serve", serve}, Root: root, Log: "correo.log"}
}

// correoAt: ¿en esa dirección contesta una API de correo?
func correoAt(addr string) bool {
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get("http://" + addr + "/api/overview")
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusOK
}

func main() {
	// La consola (cli.go): `correo list|latest|read|search|…`. Va antes de los flags del servidor.
	if len(os.Args) > 1 && cliCommands[os.Args[1]] {
		root := os.Getenv("MY_TOOLS_ROOT")
		if root == "" {
			root, _ = os.Getwd()
		}
		os.Exit(runCLI(root, os.Args[1:]))
	}
	serve := flag.String("serve", "127.0.0.1:5225", "dónde escucha la API (sólo 127.0.0.1)")
	every := flag.Duration("every", time.Minute, "cada cuánto mira Gmail")
	once := flag.Bool("once", false, "una lectura por consola, sin avisar, y sale")
	notifyTest := flag.Bool("notify-test", false, "manda un aviso de prueba de macOS y sale")
	install := flag.Bool("install", false, "la deja corriendo de fondo como LaunchAgent (desde el binario compilado)")
	uninstall := flag.Bool("uninstall", false, "saca el LaunchAgent (lo guardado se queda)")
	status := flag.Bool("status", false, "¿el LaunchAgent está cargado?")
	flag.Parse()

	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "connectors", "gmail")); err != nil {
		log.Fatalf("correo: corré desde la raíz de my-tools (no encuentro connectors/gmail en %s)", root)
	}
	exitOn := func(err error) {
		if err != nil {
			fmt.Fprintln(os.Stderr, "correo:", err)
			os.Exit(1)
		}
	}
	switch {
	case *notifyTest:
		// Apunta a la conversación más reciente que se sigue: tocarlo tiene que abrir Cockpit ahí.
		title, body, route := "Correo · prueba", "Así llega un aviso de un correo nuevo. Tocalo y abre Correo en Cockpit.", ""
		if st, err := openStore(filepath.Join(root, "correo", ".data")); err == nil {
			views, _ := st.view("")
			var best *MessageView
			var watch string
			for _, v := range views {
				for i := range v.Messages {
					if best == nil || v.Messages[i].Date.After(best.Date) {
						best, watch = &v.Messages[i], v.ID
					}
				}
			}
			if best != nil {
				title = "Correo · prueba: " + sender(best.From)
				body, route = best.Subject, threadRoute(watch, best.ThreadID)
			}
		}
		exitOn(macNotice(title, body, route, false))
		fmt.Println("aviso de prueba →", "cockpit://correo/"+route)
		return
	case *install:
		exitOn(agent(root, *serve).Install())
		return
	case *uninstall:
		exitOn(agent(root, *serve).Uninstall())
		return
	case *status:
		fmt.Println(agent(root, *serve).Status())
		return
	}

	st, err := openStore(filepath.Join(root, "correo", ".data"))
	if err != nil {
		log.Fatal(err)
	}
	a := &app{store: st, digest: newDigester(filepath.Join(root, "correo", ".data")), bodies: map[string]gmail.Message{}}
	if *once {
		exitOn(a.pass(false))
		o := a.overview(*every)
		fmt.Printf("%s · %d sin ver\n", o.Account, o.Unread)
		for _, w := range o.Watches {
			fmt.Printf("\n%s (%s) · %d sin ver\n", w.Name, w.Query, w.Unread)
			for i, m := range w.Messages {
				if i == 5 {
					break
				}
				fmt.Printf("  %s  %s · %s\n", m.Date.Format("2006-01-02 15:04"), m.From, m.Subject)
			}
		}
		return
	}

	if !strings.HasPrefix(*serve, "127.0.0.1:") {
		log.Fatal("correo: la API escucha sólo en 127.0.0.1")
	}
	ln, err := net.Listen("tcp", *serve)
	if err != nil && correoAt(*serve) {
		// Ya corre otra (la de fondo, o la de `make correo`): ésta espera y toma el relevo cuando se suelte. Así no
		// avisan dos del mismo correo.
		log.Printf("correo: la API ya corre en %s; espero a que se suelte para tomar el relevo", *serve)
		for err != nil {
			time.Sleep(15 * time.Second)
			ln, err = net.Listen("tcp", *serve)
		}
	}
	if err != nil {
		log.Fatal(err)
	}
	go func() {
		for {
			if err := a.pass(true); err != nil {
				log.Printf("correo: %v", err)
			}
			time.Sleep(*every)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/overview", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, a.overview(*every)) })
	mux.HandleFunc("POST /api/refresh", func(w http.ResponseWriter, r *http.Request) {
		go func() { _ = a.pass(true) }()
		writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/messages/{id}", func(w http.ResponseWriter, r *http.Request) {
		m, err := a.message(r.PathValue("id"))
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, m)
	})
	// GET /api/thread/{hilo} — la conversación entera, en orden: cada mensaje con su texto (sin lo citado de la
	// respuesta anterior) y si lo escribiste vos.
	mux.HandleFunc("GET /api/thread/{thread}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("thread")
		if !threadIDRe.MatchString(id) {
			fail(w, http.StatusBadRequest, fmt.Errorf("id de hilo inválido"))
			return
		}
		c, err := a.gmailClient()
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		ctx, cancel := ctxTimeout(time.Minute)
		defer cancel()
		msgs, err := c.ThreadFull(ctx, id)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		type turn struct {
			gmail.Message
			Mine bool `json:"mine"`
		}
		me := strings.ToLower(c.Email())
		out := make([]turn, 0, len(msgs))
		for _, m := range msgs {
			m.Body = strings.TrimSpace(cleanQuoted(m.Body))
			if m.Body == "" {
				m.Body = m.Snippet
			}
			out = append(out, turn{Message: m, Mine: me != "" && strings.Contains(strings.ToLower(m.From), me)})
		}
		writeJSON(w, http.StatusOK, map[string]any{"threadId": id, "url": threadURL(c.Email(), id), "messages": out})
	})
	// GET /api/digest/{hilo}[?refresh=1] — el desglose del hilo en español (digest.go): el guardado si el hilo no
	// cambió; si no, lo arma Gemini (unos segundos).
	mux.HandleFunc("GET /api/digest/{thread}", func(w http.ResponseWriter, r *http.Request) {
		c, err := a.gmailClient()
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		g, err := a.digest.get(c, r.PathValue("thread"), r.URL.Query().Get("refresh") == "1")
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, g)
	})
	// POST /api/read {"ids":[…]} o {"watch":"shopify"} (todos los de ese seguimiento) o {"all":true}.
	mux.HandleFunc("POST /api/read", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IDs   []string `json:"ids"`
			Watch string   `json:"watch"`
			All   bool     `json:"all"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		ids := body.IDs
		if body.Watch != "" || body.All {
			ids = append(ids, a.store.unreadIDs(body.Watch)...)
		}
		if err := a.store.markRead(ids, time.Now()); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, a.overview(*every))
	})
	// POST /api/noreply {"ids":[…]} marca «no hace falta responder» (un acuse automático); con "undo":true lo saca.
	mux.HandleFunc("POST /api/noreply", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			IDs  []string `json:"ids"`
			Undo bool     `json:"undo"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&body); err != nil || len(body.IDs) == 0 {
			fail(w, http.StatusBadRequest, fmt.Errorf("falta {\"ids\": [\"<id del correo>\"]}"))
			return
		}
		if err := a.store.markNoReply(body.IDs, body.Undo, time.Now()); err != nil {
			fail(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, a.overview(*every))
	})
	// POST /api/watches {"name":"Shopify","query":"from:shopify.com"} agrega (con "id", cambia); DELETE ?id= saca.
	mux.HandleFunc("POST /api/watches", func(w http.ResponseWriter, r *http.Request) {
		var body Watch
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		if _, err := a.store.addWatch(body); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		go func() { _ = a.pass(true) }()
		writeJSON(w, http.StatusOK, a.overview(*every))
	})
	mux.HandleFunc("DELETE /api/watches", func(w http.ResponseWriter, r *http.Request) {
		if err := a.store.removeWatch(r.URL.Query().Get("id")); err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, a.overview(*every))
	})
	log.Printf("correo: escuchando en %s, mirando Gmail cada %s", *serve, *every)
	log.Fatal(http.Serve(ln, mux))
}
