package main

/* Un tema de canon, leído de la COPIA LOCAL (`tablero/canon`), para la pestaña «Canon» de una tarea. Es
 * la misma copia que lee el agente —grep, `retomar CANON=1`—, así que lo que se ve en el tablero y lo que
 * usa quien trabaja no pueden diferir. No pide VPN ni pasa por canon de producción. */

import (
	"encoding/json"
	"net/http"
	"regexp"
	"time"

	"creditop/playground/tablero/server/internal/canoncache"
)

// canonTopicRef: `kyc`, `kyc/context` o `kyc/context#ancla` —como lo cita canon—, y nada que salga de la
// carpeta.
var canonTopicRef = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*(/[a-z]+)?(#[a-z0-9=_-]+)?$`)

type canonTopicResponse struct {
	canoncache.LocalTopic
	SyncedAt time.Time `json:"syncedAt,omitempty"`
}

func (a *app) canonTopic(w http.ResponseWriter, r *http.Request) {
	cors(w)
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	id := r.URL.Query().Get("id")
	if !canonTopicRef.MatchString(id) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "id inválido: `tema`, `tema/context` o `tema/context#ancla`"})
		return
	}
	dir := a.canonKeeper.dir
	topic, err := canoncache.ReadTopicDoc(dir, id)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "canon no tiene ese tema (o todavía no hay copia local)"})
		return
	}
	out := canonTopicResponse{LocalTopic: topic}
	if m, ok := canoncache.LoadMirror(dir); ok {
		out.SyncedAt = m.SyncedAt
	}
	json.NewEncoder(w).Encode(out)
}
