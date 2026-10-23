// Command server es la API de chat, el mini WhatsApp del chat de la terminal del playground compartido.
//
// No es otro cliente del chat: todo pasa por el CLI `playground` (paquete chat/cli). Lo que llegó lo tiene
// `playground listen`; lo que se manda sale con la sesión de `playground login`. El historial de las
// conversaciones lo guarda la interfaz, en el navegador: acá no se escribe nada en disco.
//
// Sólo escucha en 127.0.0.1: manda mensajes a nombre de quien está logueado en el CLI.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

// maxText es el mismo tope que pone el home: más largo, lo rechaza igual.
const maxText = 2000

// loginState es el `playground login` que lanzó el chat, si hay uno: uno a la vez.
type loginState struct {
	mu      sync.Mutex
	running bool
	url     string
	err     string
}

type loginView struct {
	Running bool   `json:"running"`
	URL     string `json:"url,omitempty"`
	Error   string `json:"error,omitempty"`
}

func (l *loginState) view() loginView {
	l.mu.Lock()
	defer l.mu.Unlock()
	return loginView{Running: l.running, URL: l.url, Error: l.err}
}

var login loginState

type stateResponse struct {
	Installed bool          `json:"installed"`
	Session   *cli.Session  `json:"session,omitempty"`
	Login     loginView     `json:"login"`
	Listening bool          `json:"listening"`
	Connected bool          `json:"connected"`
	Since     string        `json:"since,omitempty"`
	Me        *cli.Person   `json:"me,omitempty"`
	Messages  []cli.Message `json:"messages"`
	Error     string        `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func handler() http.Handler {
	mux := http.NewServeMux()

	// Si el CLI está, si `listen` está prendido y lo que recibió.
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		body := stateResponse{Installed: cli.Installed(), Messages: []cli.Message{}, Login: login.view()}
		if !body.Installed {
			writeJSON(w, http.StatusOK, body)
			return
		}
		body.Session = cli.CurrentSession(ctx)
		status, _ := cli.ListenStatus(ctx)
		if status == nil {
			writeJSON(w, http.StatusOK, body)
			return
		}
		body.Listening, body.Connected, body.Since, body.Me = true, status.Connected, status.Since, status.Me
		if messages, err := cli.All(ctx); err != nil {
			body.Error = err.Error()
		} else {
			body.Messages = messages
		}
		writeJSON(w, http.StatusOK, body)
	})

	mux.HandleFunc("GET /api/online", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		online, err := cli.Online(ctx)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"online": online})
	})

	mux.HandleFunc("POST /api/send", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			To   string `json:"to"`
			Text string `json:"text"`
			Re   string `json:"re"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {to, text}"))
			return
		}
		in.To, in.Text = strings.TrimSpace(in.To), strings.TrimSpace(in.Text)
		switch {
		case in.To == "":
			fail(w, http.StatusBadRequest, errors.New("falta a quién"))
			return
		case in.Text == "":
			fail(w, http.StatusBadRequest, errors.New("falta el texto"))
			return
		case len([]rune(in.Text)) > maxText:
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("el texto pasa de %d caracteres", maxText))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		result, err := cli.Send(ctx, in.To, in.Text, strings.TrimSpace(in.Re))
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	// Entrar al playground: lanza `playground login`, que abre el navegador de esta máquina. Vuelve enseguida con
	// la URL (por si el navegador no se abrió); el resultado se ve en /api/state.
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		login.mu.Lock()
		if login.running {
			login.mu.Unlock()
			writeJSON(w, http.StatusOK, login.view())
			return
		}
		login.running, login.url, login.err = true, "", ""
		login.mu.Unlock()
		started, err := cli.StartLogin()
		if err != nil {
			login.mu.Lock()
			login.running, login.err = false, err.Error()
			login.mu.Unlock()
			fail(w, http.StatusBadGateway, err)
			return
		}
		login.mu.Lock()
		login.url = started.URL
		login.mu.Unlock()
		go func() {
			err := <-started.Done
			login.mu.Lock()
			defer login.mu.Unlock()
			login.running, login.url = false, ""
			if err != nil {
				login.err = err.Error()
			}
		}()
		writeJSON(w, http.StatusOK, login.view())
	})

	mux.HandleFunc("POST /api/listen", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		if err := cli.Listen(ctx); err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	// Los agentes del equipo: los de cada persona conectada, que corren en su máquina.
	mux.HandleFunc("GET /api/team-agents", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		people, err := cli.Agents(ctx)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"people": people})
	})

	// Preguntarle a un agente del equipo. El home espera la respuesta hasta 45 s; si no llegó, contesta
	// `pending` con el id, y la respuesta llega después entre los mensajes (con `re` = ese id).
	mux.HandleFunc("POST /api/ask", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			To    string `json:"to"`
			Agent string `json:"agent"`
			Text  string `json:"text"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {to, agent, text}"))
			return
		}
		in.To, in.Agent, in.Text = strings.TrimSpace(in.To), strings.TrimSpace(in.Agent), strings.TrimSpace(in.Text)
		if in.To == "" || in.Agent == "" || in.Text == "" {
			fail(w, http.StatusBadRequest, errors.New("falta a quién, qué agente o la pregunta"))
			return
		}
		if len([]rune(in.Text)) > maxText {
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("la pregunta pasa de %d caracteres", maxText))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 70*time.Second)
		defer cancel()
		result, err := cli.Ask(ctx, in.To, in.Agent, in.Text)
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, result)
	})
	// Preguntarle a canon, la herramienta del equipo (no el agente de una persona): siempre está, aunque no haya
	// nadie conectado. Tarda unos segundos; la red del playground corta a los 60.
	mux.HandleFunc("POST /api/canon", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in); err != nil || strings.TrimSpace(in.Text) == "" {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {text}"))
			return
		}
		if len([]rune(in.Text)) > maxText {
			fail(w, http.StatusRequestEntityTooLarge, fmt.Errorf("la pregunta pasa de %d caracteres", maxText))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 120*time.Second)
		defer cancel()
		answer, err := cli.CanonAsk(ctx, strings.TrimSpace(in.Text))
		if err != nil {
			fail(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, answer)
	})
	agentHandlers(mux)
	return mux
}

func main() {
	addr := flag.String("serve", "127.0.0.1:5185", "dirección de la API (sólo 127.0.0.1)")
	flag.Parse()
	host, _, err := net.SplitHostPort(*addr)
	if err != nil || host != "127.0.0.1" {
		fmt.Fprintln(os.Stderr, "chat: la API escucha sólo en 127.0.0.1 (manda mensajes a tu nombre)")
		os.Exit(2)
	}
	fmt.Printf("chat · API en http://%s\n", *addr)
	srv := &http.Server{Addr: *addr, Handler: handler(), ReadHeaderTimeout: 5 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, "chat:", err)
		os.Exit(1)
	}
}
