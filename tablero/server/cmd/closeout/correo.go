package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// LA CORRESPONDENCIA DE LA TAREA. Una tarea declara en `correo:` qué seguimientos de la herramienta Correo son suyos
// (`vtex`, `shopify`). Correo guarda en correo/.data/state.json los correos de esos remitentes y, por hilo, la última
// vez que escribió Miguel; no sabe de tareas ni escribe en el tablero. El cierre lo LEE (como hace con Jarvis) y pone en
// el bloque lo que llegó y lo que se respondió en el lapso, con el enlace a cada conversación en Gmail.

// mailEvent es un correo de la tarea en el lapso: uno que llegó de ellos o una respuesta de Miguel.
type mailEvent struct {
	At      time.Time `json:"at"`
	Watch   string    `json:"watch"`
	What    string    `json:"what"` // «Juan Alzate (VTEX) escribió» · «respondiste»
	Subject string    `json:"subject"`
	URL     string    `json:"url"`
}

type correoState struct {
	Messages map[string][]struct {
		ID       string    `json:"id"`
		ThreadID string    `json:"threadId"`
		From     string    `json:"from"`
		Subject  string    `json:"subject"`
		Date     time.Time `json:"date"`
	} `json:"messages"`
	Threads map[string]struct {
		LastMine time.Time `json:"lastMine"`
	} `json:"threads"`
}

// correoStatePath: lo guardado por Correo (CORREO_DATA lo cambia, como JARVIS_DATA).
func correoStatePath(playground string) string {
	if d := os.Getenv("CORREO_DATA"); d != "" {
		return filepath.Join(d, "state.json")
	}
	return filepath.Join(playground, "correo", ".data", "state.json")
}

func mailSender(from string) string {
	if i := strings.Index(from, "<"); i > 0 {
		if n := strings.Trim(strings.TrimSpace(from[:i]), `"`); n != "" {
			return n
		}
	}
	return from
}

// mailEvents: los correos de los seguimientos `watches` que llegaron entre `since` y `until`, y las respuestas de
// Miguel en esos hilos dentro del mismo lapso. Sin seguimientos, o sin Correo, nada.
func mailEvents(playground string, watches []string, since, until time.Time) []mailEvent {
	if len(watches) == 0 {
		return nil
	}
	b, err := os.ReadFile(correoStatePath(playground))
	if err != nil {
		return nil
	}
	var st correoState
	if json.Unmarshal(b, &st) != nil {
		return nil
	}
	var out []mailEvent
	in := func(t time.Time) bool { return !t.Before(since) && !t.After(until) }
	seenThread := map[string]bool{}
	for _, w := range watches {
		for _, m := range st.Messages[w] {
			url := "https://mail.google.com/mail/#all/" + m.ThreadID
			if in(m.Date) {
				out = append(out, mailEvent{At: m.Date, Watch: w, What: mailSender(m.From) + " escribió", Subject: m.Subject, URL: url})
			}
			if !seenThread[m.ThreadID] {
				seenThread[m.ThreadID] = true
				if mine := st.Threads[m.ThreadID].LastMine; in(mine) {
					out = append(out, mailEvent{At: mine, Watch: w, What: "respondiste", Subject: m.Subject, URL: url})
				}
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// mailSection es la parte del bloque que nombra la correspondencia del lapso.
func mailSection(watches []string, events []mailEvent) string {
	if len(events) == 0 {
		return ""
	}
	var b strings.Builder
	fmt.Fprintf(&b, "\nCorreo (%s):\n", strings.Join(watches, ", "))
	for _, e := range events {
		subject := strings.NewReplacer("[", "(", "]", ")").Replace(oneLine(e.Subject, 110))
		fmt.Fprintf(&b, "- %s · %s: [%s](%s)\n", e.At.Format("15:04"), e.What, subject, e.URL)
	}
	return b.String()
}
