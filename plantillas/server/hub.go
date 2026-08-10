package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"sync"
)

// El evento se emite DONDE SE TOMA LA DECISIÓN (en el handler, después de escribir),
// no escuchando la tabla. Un update hook de SQLite te da (tabla, rowid) y te obliga a
// reconstruir la intención desde el diff; acá la intención es el dato.
type evento struct {
	ID      int64           `json:"id"`
	Tipo    string          `json:"tipo"`
	Payload json.RawMessage `json:"payload"`
	TS      string          `json:"ts"`
}

type hub struct {
	db  *sql.DB
	mu  sync.Mutex
	sub map[string]map[chan evento]struct{} // solicitud → suscriptores
}

func nuevoHub(db *sql.DB) *hub {
	return &hub{db: db, sub: map[string]map[chan evento]struct{}{}}
}

func (h *hub) suscribir(solicitud string) chan evento {
	ch := make(chan evento, 32)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.sub[solicitud] == nil {
		h.sub[solicitud] = map[chan evento]struct{}{}
	}
	h.sub[solicitud][ch] = struct{}{}
	return ch
}

func (h *hub) desuscribir(solicitud string, ch chan evento) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m := h.sub[solicitud]; m != nil {
		delete(m, ch)
		if len(m) == 0 {
			delete(h.sub, solicitud)
		}
	}
	close(ch)
}

// emitir persiste PRIMERO y después reparte: el que se conecta tarde recibe el
// historial completo (replay), así el segundo dispositivo no depende de haber
// estado escuchando desde el principio.
func (h *hub) emitir(solicitud, tipo string, payload any) {
	cuerpo, err := json.Marshal(payload)
	if err != nil {
		cuerpo = []byte("{}")
	}
	res, err := h.db.Exec(`INSERT INTO eventos (solicitud_id, tipo, payload) VALUES (?,?,?)`,
		solicitud, tipo, string(cuerpo))
	if err != nil {
		log.Printf("emitir %s/%s: %v", solicitud, tipo, err)
		return
	}
	id, _ := res.LastInsertId()

	var ts string
	h.db.QueryRow(`SELECT ts FROM eventos WHERE id = ?`, id).Scan(&ts)
	ev := evento{ID: id, Tipo: tipo, Payload: cuerpo, TS: ts}

	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.sub[solicitud] {
		select {
		case ch <- ev:
		default: // suscriptor lento: se salta, no se bloquea el handler
		}
	}
}

// historial es el replay: todo lo que pasó en la solicitud, para el que recién llega.
func (h *hub) historial(solicitud string, desde int64) []evento {
	filas, err := h.db.Query(
		`SELECT id, tipo, payload, ts FROM eventos WHERE solicitud_id = ? AND id > ? ORDER BY id`,
		solicitud, desde)
	if err != nil {
		return nil
	}
	defer filas.Close()

	var out []evento
	for filas.Next() {
		var e evento
		var p string
		if err := filas.Scan(&e.ID, &e.Tipo, &p, &e.TS); err == nil {
			e.Payload = json.RawMessage(p)
			out = append(out, e)
		}
	}
	return out
}
