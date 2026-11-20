package main

/* LAS MINIATURAS: la vista «Todas» de la interfaz muestra en vivo cada sesión a la vez (cómo trabaja Claude en
 * paralelo). Va por UN solo stream (GET /api/live/thumbs, Server-Sent Events) con el último cuadro de cada sesión, a lo
 * sumo uno por segundo y sólo si cambió:
 *   - uno solo, porque un navegador abre a lo sumo 6 conexiones de streaming al mismo servidor por HTTP/1.1, y la
 *     interfaz ya tiene la de los eventos: con un stream por miniatura, la sexta sesión se congelaba;
 *   - uno por segundo, porque para mirar alcanza; la sesión que se abre en grande sigue a velocidad completa
 *     (/api/live/frames);
 *   - y NO cuenta como «mirar» (Tabs.Watch): si contara, ninguna sesión se cerraría sola mientras la grilla está
 *     abierta. */

import (
	"bytes"
	"fmt"
	"net/http"
	"time"
)

// thumbInterval: cada cuánto se mira si alguna sesión tiene un cuadro nuevo.
const thumbInterval = time.Second

// LastFrame es el último cuadro de la sesión (el mensaje JSON del screencast: {data, meta}); nil si no tiene página.
func (r *Runner) LastFrame() []byte {
	l := r.liveSession()
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.lastFrame
}

// serveThumbs manda, por sesión, su último cuadro cuando cambia: evento «thumb» con {tab, frame}. Una sesión que se
// cierra o se queda sin página manda «gone», para que la grilla la saque.
func serveThumbs(w http.ResponseWriter, r *http.Request, tabs *Tabs) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, fmt.Errorf("sin streaming"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()
	sent := map[string][]byte{}
	tick := time.NewTicker(thumbInterval)
	defer tick.Stop()
	lastPing := time.Now()
	for {
		// Señal de vida cada 10 s, como /api/events: la grilla reabre el stream si deja de llegar.
		if time.Since(lastPing) > 10*time.Second {
			fmt.Fprint(w, "event: ping\ndata: {}\n\n")
			lastPing = time.Now()
		}
		alive := map[string]bool{}
		for _, tab := range tabs.All() {
			frame := tab.Runner.LastFrame()
			if frame == nil {
				continue
			}
			alive[tab.ID] = true
			if bytes.Equal(sent[tab.ID], frame) {
				continue
			}
			sent[tab.ID] = frame
			fmt.Fprintf(w, "event: thumb\ndata: {\"tab\":%q,\"frame\":%s}\n\n", tab.ID, frame)
		}
		for id := range sent {
			if !alive[id] {
				delete(sent, id)
				fmt.Fprintf(w, "event: gone\ndata: {\"tab\":%q}\n\n", id)
			}
		}
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-tick.C:
		}
	}
}
