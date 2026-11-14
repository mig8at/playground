package main

/* EL TABLERO EN TIEMPO REAL. Las sesiones de Claude escriben en disco todo el tiempo —bloques en la pila de una tarea,
 * el documento, la bitácora, las ramas medidas, el pulso— y la interfaz no se enteraba hasta recargar. Ahora:
 *
 *   GET /api/events   un stream SSE. Al conectarse, `hello`; cada 25 s, `ping`; y cuando algo cambió en disco,
 *                     `changed` con QUÉ: {"tasks": ["<slug>", …], "entries": true, "branches": true, "pulse": true}
 *
 * Lo que cambió lo ve un vigía que mira el disco cada 2 s, y sólo mientras haya alguien suscripto: fechas y tamaños de
 * cada `task.md`, su `context.jsonl` y sus artifacts, de la bitácora (`data/entries`), de `data/cache/ramas.json` y del
 * pulso. Es por fecha de archivo y no por fsnotify a propósito: sin dependencias nuevas, y lo que escribe una sesión
 * desde otro proceso (git, un editor, `make tarea-bloque`) se ve igual.
 *
 * La interfaz recarga sólo lo que cambió (App.vue, `onLiveChange`). Lo de Jira no pasa por acá: no está en disco. */

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"creditop/my-tools/tablero/server/internal/layout"
)

type liveHub struct {
	mu   sync.Mutex
	subs map[chan []byte]struct{}
}

func (h *liveHub) subscribe() chan []byte {
	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *liveHub) unsubscribe(ch chan []byte) {
	h.mu.Lock()
	delete(h.subs, ch)
	h.mu.Unlock()
}

func (h *liveHub) count() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// publish no espera a nadie: a un cliente atrasado se le pierde ese aviso (el próximo trae el estado entero igual,
// porque la interfaz recarga desde la API, no aplica diferencias).
func (h *liveHub) publish(name string, data any) {
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

// diskSnapshot: la firma de lo que la interfaz muestra y vive en disco.
type diskSnapshot struct {
	tasks    map[string]string // slug → firma de su documento, pila y artifacts
	entries  string
	branches string
	pulse    string
}

// stamp: fecha y tamaño de un archivo (o de lo más nuevo de una carpeta, con su conteo). Vacío si no existe.
func stamp(path string) string {
	fi, err := os.Stat(path)
	if err != nil {
		return ""
	}
	if !fi.IsDir() {
		return fmt.Sprintf("%d:%d", fi.ModTime().UnixNano(), fi.Size())
	}
	items, err := os.ReadDir(path)
	if err != nil {
		return ""
	}
	var newest int64
	for _, it := range items {
		if info, err := it.Info(); err == nil && info.ModTime().UnixNano() > newest {
			newest = info.ModTime().UnixNano()
		}
	}
	return fmt.Sprintf("%d:%d", newest, len(items))
}

func takeSnapshot(dataDir string) diskSnapshot {
	l := layout.At(dataDir)
	snap := diskSnapshot{tasks: map[string]string{}}
	if slugs, err := l.Slugs(); err == nil {
		for _, slug := range slugs {
			snap.tasks[slug] = stamp(l.TaskPath(slug)) + "|" + stamp(l.ContextPath(slug)) + "|" + stamp(l.ArtifactsPath(slug))
		}
	}
	snap.entries = stamp(filepath.Join(dataDir, "entries"))
	snap.branches = stamp(filepath.Join(dataDir, "cache", "ramas.json"))
	snap.pulse = stamp(filepath.Join(dataDir, "pulse"))
	return snap
}

// diffSnapshots: qué cambió entre dos fotos, o nil si nada.
func diffSnapshots(before, after diskSnapshot) map[string]any {
	var tasks []string
	for slug, sig := range after.tasks {
		if before.tasks[slug] != sig {
			tasks = append(tasks, slug)
		}
	}
	for slug := range before.tasks {
		if _, ok := after.tasks[slug]; !ok {
			tasks = append(tasks, slug)
		}
	}
	sort.Strings(tasks)
	out := map[string]any{}
	if len(tasks) > 0 {
		out["tasks"] = tasks
	}
	if before.entries != after.entries {
		out["entries"] = true
	}
	if before.branches != after.branches {
		out["branches"] = true
	}
	if before.pulse != after.pulse {
		out["pulse"] = true
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func registerEvents(mux *http.ServeMux, dataDir string) {
	hub := &liveHub{subs: map[chan []byte]struct{}{}}

	go func() {
		var last *diskSnapshot
		for range time.Tick(2 * time.Second) {
			if hub.count() == 0 {
				last = nil // sin nadie mirando no se mira el disco; al volver alguien, se arranca de cero
				continue
			}
			snap := takeSnapshot(dataDir)
			if last != nil {
				if changed := diffSnapshots(*last, snap); changed != nil {
					hub.publish("changed", changed)
				}
			}
			last = &snap
		}
	}()

	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "sin streaming", http.StatusInternalServerError)
			return
		}
		w.Header().Set("content-type", "text/event-stream")
		w.Header().Set("cache-control", "no-cache")
		w.Header().Set("access-control-allow-origin", "*")
		ch := hub.subscribe()
		defer hub.unsubscribe(ch)
		fmt.Fprint(w, "event: hello\ndata: {}\n\n")
		flusher.Flush()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case frame := <-ch:
				_, _ = w.Write(frame)
				flusher.Flush()
			case <-ping.C:
				fmt.Fprint(w, "event: ping\ndata: {}\n\n")
				flusher.Flush()
			}
		}
	})
}
