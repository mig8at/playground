package main

/* Lo que la interfaz ve en tiempo real, por UN solo stream (Server-Sent Events en /api/events): el estado de la
 * sesión en vivo cuando cambia, cada cosa que dice Claude en cuanto la dice, y las corridas y los flujos cuando se
 * guardan. Los cuadros del navegador van aparte (/api/live/frames), porque son muchos y pesados. */

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Hub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

var hub = &Hub{subs: map[chan []byte]struct{}{}}

// Publish manda un evento a todos: kind es el tipo SSE (live · ask · askstate · runs · flows), v su dato.
func (h *Hub) Publish(kind string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	msg := []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", kind, b))
	h.mu.Lock()
	for ch := range h.subs {
		select {
		case ch <- msg:
		default: // uno lento se pierde eventos; el próximo estado completo lo pone al día
		}
	}
	h.mu.Unlock()
}

func (h *Hub) subscribe() (chan []byte, func()) {
	ch := make(chan []byte, 256)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() { h.mu.Lock(); delete(h.subs, ch); h.mu.Unlock() }
}

// watchLive publica el estado de la sesión cada vez que cambia algo que la interfaz muestra (lo compara cada
// 250 ms: más simple y más robusto que avisar desde cada rincón de live.go).
func watchLive(runner *Runner) {
	last := ""
	for range time.Tick(250 * time.Millisecond) {
		st := runner.LiveState(false)
		key := liveKey(st)
		if key != last {
			last = key
			hub.Publish("live", st)
		}
	}
}

func liveKey(st LiveState) string {
	k := fmt.Sprintf("%v|%s|%s|%s|%d|%v|%d|%s|%s", st.Active, st.Site, st.URL, st.Title, st.Version, st.Analyzing, len(st.Steps), st.Device, st.Popup)
	if st.Guide != nil {
		k += fmt.Sprintf("|g%d", st.Guide.ID)
	}
	if r := st.Replay; r != nil {
		k += fmt.Sprintf("|r%s%d%s%v%s%d%d%d%s", r.Status, r.Index, r.Note, r.Auto, r.Report, r.Did, r.ByHand, r.Skipped, r.Run)
	}
	return k
}

// serveEvents es el stream: al conectarse, el estado completo; después, cada cambio.
func serveEvents(w http.ResponseWriter, r *http.Request, runner *Runner, store *Store) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "sin streaming", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := hub.subscribe()
	defer cancel()
	send := func(kind string, v any) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
	}
	send("live", runner.LiveState(false))
	send("askstate", asker.State(0))
	send("runs", store.Runs())
	send("flows", listFlows())
	send("apps", listApps())
	fl.Flush()
	ping := time.NewTicker(20 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			_, _ = w.Write(msg)
			fl.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			fl.Flush()
		}
	}
}
