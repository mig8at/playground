package main

// EN VIVO: la interfaz abre UN stream (`GET /api/events`, server-sent events) y le llega cada cosa apenas pasa, en vez
// de preguntar cada 2,5 s. La fuente es `playground messages --follow` (el listen avisa cada mensaje en el momento), y
// también lo que este servidor hace por su cuenta: lo que manda (el llavero que contesta solo, bin/chat) y los
// adjuntos que termina de bajar. La interfaz sigue preguntando de vez en cuando, por si el stream se cortó.
//
//	event: messages   data: [cli.Message…]   lo nuevo del historial (llegó o salió)
//	event: file       data: {id, path}       un adjunto quedó en el caché del chat
//	event: keyring    data: {to, kind}       el llavero le contestó solo a alguien (list | keys)
//	event: notify     data: {title, body, key} un aviso que decidió el servidor (notify.go), para que lo muestre la ventana

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

// Cada ventana suscrita al stream.
type hub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

var events = &hub{subs: map[chan []byte]struct{}{}}

// publish manda un evento a todas las ventanas abiertas. No espera a ninguna: a la que va atrasada se le pierde éste
// (su próxima consulta de respaldo lo trae).
func (h *hub) publish(name string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	frame := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", name, b))
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- frame:
		default:
		}
	}
}

func (h *hub) subscribe() chan []byte {
	ch := make(chan []byte, 64)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// count: cuántas ventanas tienen el stream abierto (notify.go: si no hay ninguna, no estás mirando nada).
func (h *hub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

func (h *hub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

func registerEvents(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			fail(w, http.StatusInternalServerError, fmt.Errorf("sin streaming"))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		ch := events.subscribe()
		defer events.unsubscribe(ch)
		_, _ = fmt.Fprint(w, "retry: 3000\nevent: hello\ndata: {}\n\n")
		flusher.Flush()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case frame := <-ch:
				if _, err := w.Write(frame); err != nil {
					return
				}
				flusher.Flush()
			case <-ping.C:
				// Un evento y no un comentario: la ventana lo ve, y si deja de llegar sabe que el stream quedó muerto (pasa
				// cuando este servidor se reinicia detrás del proxy de vite) y lo vuelve a abrir.
				if _, err := fmt.Fprint(w, "event: ping\ndata: {}\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
	})
}

// followListen sigue el listen mientras el servidor esté prendido: cada mensaje va al historial (que lo publica) y,
// si es nuevo, baja sus imágenes y pasa por el llavero. Si el listen no está o se reinicia, vuelve a probar.
func followListen() {
	wait := 2 * time.Second
	for {
		if cli.Installed() && chatHistory != nil {
			started := time.Now()
			err := cli.Follow(context.Background(), func(m cli.Message) {
				fresh, err := chatHistory.add([]cli.Message{m})
				if err != nil || len(fresh) == 0 {
					return
				}
				go fetchImagesOf(fresh)
				go answerKeyring(fresh)
			})
			if time.Since(started) > time.Minute {
				wait = 2 * time.Second
			}
			if err != nil {
				log.Printf("en vivo: el listen se cortó (%v); reintento en %s", err, wait)
			}
		}
		time.Sleep(wait)
		if wait < 30*time.Second {
			wait *= 2
		}
	}
}
