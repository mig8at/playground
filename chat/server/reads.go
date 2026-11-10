package main

/* LO LEÍDO, EN EL SERVIDOR. Antes vivía sólo en el navegador (`readAt` de cada conversación), así que un agente que
 * contestaba desde la terminal no lo marcaba, y no podía saber qué no habías leído. Ahora lo guarda el servidor
 * (reads.json, junto al historial): la app lo marca al mirar una conversación, bin/chat al contestar o con `read`, y
 * los dos ven lo mismo. Sólo avanza: marcar algo más viejo no «desleé» nada.
 *
 * Con eso, el servidor arma lo que un agente necesita sin repetir reglas en cada cliente:
 *
 *	GET  /api/reads                    { key: hora } de cada conversación
 *	POST /api/reads {key, at?}         marca leída la conversación hasta `at` (o hasta lo último que tiene)
 *	GET  /api/inbox[?unread=1]         cada conversación: lo último, cuántos sin leer y cuántas menciones sin leer
 *	GET  /api/mentions[?all=1]         los mensajes de grupos que te nombran (por defecto, los sin leer)
 */

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/playground/chat/cli"
)

var (
	readsMu sync.Mutex
	reads   map[string]string // conversación → hora (RFC3339) hasta la que está leída
)

func readsPath() (string, error) {
	dir, err := historyDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "reads.json"), nil
}

// loadReads: lo guardado, una vez (con el candado tomado).
func loadReadsLocked() {
	if reads != nil {
		return
	}
	reads = map[string]string{}
	if p, err := readsPath(); err == nil {
		if b, err := os.ReadFile(p); err == nil {
			_ = json.Unmarshal(b, &reads)
		}
	}
}

func readsSnapshot() map[string]string {
	readsMu.Lock()
	defer readsMu.Unlock()
	loadReadsLocked()
	out := make(map[string]string, len(reads))
	for k, v := range reads {
		out[k] = v
	}
	return out
}

// markRead avanza lo leído de `key` hasta `at`. Devuelve la hora que quedó y si cambió.
func markRead(key, at string) (string, bool, error) {
	key = strings.ToLower(strings.TrimSpace(key))
	if key == "" {
		return "", false, errors.New("falta la conversación")
	}
	if _, err := time.Parse(time.RFC3339Nano, at); err != nil {
		return "", false, errors.New("la hora va en RFC3339")
	}
	readsMu.Lock()
	defer readsMu.Unlock()
	loadReadsLocked()
	if !later(at, reads[key]) {
		return reads[key], false, nil
	}
	reads[key] = at
	b, _ := json.MarshalIndent(reads, "", "  ")
	p, err := readsPath()
	if err == nil {
		err = writePrivate(p, b)
	}
	if err != nil {
		return at, true, err
	}
	events.publish("read", map[string]string{"key": key, "at": at})
	return at, true, nil
}

// later: ¿a es posterior a b? Compara como horas (los textos pueden tener distinta cantidad de decimales).
func later(a, b string) bool {
	ta, err := time.Parse(time.RFC3339Nano, a)
	if err != nil {
		return false
	}
	tb, err := time.Parse(time.RFC3339Nano, b)
	if err != nil {
		return true
	}
	return ta.After(tb)
}

// lastTimeOf: la hora del último mensaje de una conversación en el historial.
func lastTimeOf(key string) string {
	if chatHistory == nil {
		return ""
	}
	last := ""
	for _, m := range chatHistory.all() {
		if conversationOf(m) == key && later(m.Time, last) {
			last = m.Time
		}
	}
	return last
}

type inboxRow struct {
	Key      string      `json:"key"`
	Group    bool        `json:"group"`
	Last     cli.Message `json:"last"`
	Unread   int         `json:"unread"`
	Mentions int         `json:"mentions"` // menciones a vos o a tus agentes sin leer (sólo grupos)
	ReadAt   string      `json:"readAt,omitempty"`
}

// unreadIn: ¿este mensaje cuenta como no leído? Es de otro y llegó después de lo leído.
func unreadIn(m cli.Message, readAt string, who me) bool {
	return m.Dir != "out" && !strings.EqualFold(m.From.Email, who.email) && later(m.Time, readAt)
}

func inbox(who me) []inboxRow {
	rows := map[string]*inboxRow{}
	r := readsSnapshot()
	if chatHistory == nil {
		return nil
	}
	for _, m := range chatHistory.all() {
		key := conversationOf(m)
		if key == "" {
			continue
		}
		row := rows[key]
		if row == nil {
			row = &inboxRow{Key: key, Group: strings.HasPrefix(key, "#"), ReadAt: r[key]}
			rows[key] = row
		}
		if row.Last.Time == "" || !later(row.Last.Time, m.Time) {
			row.Last = m
		}
		if unreadIn(m, row.ReadAt, who) {
			row.Unread++
			if row.Group && mentionsMe(m.Text, who.user, who.agents) {
				row.Mentions++
			}
		}
	}
	out := make([]inboxRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, *row)
	}
	sort.Slice(out, func(i, j int) bool { return later(out[i].Last.Time, out[j].Last.Time) })
	return out
}

type mentionEntry struct {
	With string `json:"with"`
	cli.Message
}

func mentionsOf(who me, all bool) []mentionEntry {
	if chatHistory == nil {
		return nil
	}
	r := readsSnapshot()
	var out []mentionEntry
	for _, m := range chatHistory.all() {
		if m.Group == nil || m.Dir == "out" || !mentionsMe(m.Text, who.user, who.agents) {
			continue
		}
		key := conversationOf(m)
		if !all && !unreadIn(m, r[key], who) {
			continue
		}
		out = append(out, mentionEntry{With: key, Message: m})
	}
	return out
}

func registerReads(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/reads", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"reads": readsSnapshot()})
	})
	mux.HandleFunc("POST /api/reads", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Key string `json:"key"`
			At  string `json:"at"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, errors.New("el cuerpo va en JSON: {key, at?}"))
			return
		}
		key := strings.ToLower(strings.TrimSpace(in.Key))
		at := strings.TrimSpace(in.At)
		if at == "" {
			if at = lastTimeOf(key); at == "" {
				at = time.Now().UTC().Format(time.RFC3339Nano)
			}
		}
		saved, changed, err := markRead(key, at)
		if err != nil {
			fail(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": key, "at": saved, "changed": changed})
	})
	mux.HandleFunc("GET /api/inbox", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		rows := inbox(whoLookup(ctx))
		if r.URL.Query().Get("unread") == "1" {
			kept := rows[:0]
			for _, row := range rows {
				if row.Unread > 0 {
					kept = append(kept, row)
				}
			}
			rows = kept
		}
		writeJSON(w, http.StatusOK, map[string]any{"conversations": rows})
	})
	mux.HandleFunc("GET /api/mentions", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		who := whoLookup(ctx)
		writeJSON(w, http.StatusOK, map[string]any{"mentions": mentionsOf(who, r.URL.Query().Get("all") == "1"), "me": who.user, "agents": who.agents})
	})
}
