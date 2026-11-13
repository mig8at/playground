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

// Publish manda un evento a todos: kind es el tipo SSE (live · ask · askstate · tabs · runs · flows), v su dato.
// live, ask y askstate llevan su pestaña (`tab`): la interfaz muestra los de la que está mirando.
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

// listening dice si hay alguien conectado al stream (una interfaz abierta, o un cliente de /api/events).
func (h *Hub) listening() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs) > 0
}

// watchLive publica el estado de cada pestaña cada vez que cambia algo que la interfaz muestra (lo compara cada
// 250 ms: más simple y más robusto que avisar desde cada rincón de live.go), y la lista de pestañas cuando cambia.
//
// Sin nadie escuchando no compara nada: cada pestaña cuesta dos viajes a Playwright (título y scroll) por vuelta, y
// por consola —sin interfaz abierta— eran ocho por segundo y por pestaña para publicarle a nadie. No se pierde nada:
// quien se conecta recibe el estado completo (serveEvents), y la primera vuelta con alguien publica lo que cambió.
func watchLive(tabs *Tabs) {
	last := map[string]string{}
	lastTabs := ""
	for range time.Tick(250 * time.Millisecond) {
		if !hub.listening() {
			continue
		}
		seen := map[string]bool{}
		for _, tab := range tabs.All() {
			st := tab.Runner.LiveState(false)
			key := liveKey(st)
			seen[tab.ID] = true
			if key != last[tab.ID] {
				last[tab.ID] = key
				hub.Publish("live", st)
			}
		}
		for id := range last {
			if !seen[id] {
				delete(last, id)
			}
		}
		info := tabs.Info()
		b, _ := json.Marshal(info)
		if string(b) != lastTabs {
			lastTabs = string(b)
			hub.Publish("tabs", info)
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
func serveEvents(w http.ResponseWriter, r *http.Request, tabs *Tabs, store *Store) {
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
	send("tabs", tabs.Info())
	for _, tab := range tabs.All() {
		send("live", tab.Runner.LiveState(false))
		send("askstate", tab.Asker.State(0))
	}
	send("runs", store.Runs())
	send("flows", listFlows())
	send("apps", listAll())
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
