package main

/* Canon es una consulta opcional. GET muestra sólo el estado de la copia que ya existe;
 * POST la actualiza por pedido explícito. Arrancar el tablero no consulta Canon. */

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/tablero/server/internal/canoncache"
)

// canonKeeper es quien revalida la copia. Un solo sync a la vez: el cambio de carpeta no se pisa.
type canonKeeper struct {
	mu        sync.Mutex
	client    *canon.Client
	source    string
	dir       string
	checkedAt time.Time
	lastErr   string
	now       func() time.Time
}

// canonStatus es lo que ve la UI.
type canonStatus struct {
	// State: `current` (la copia es la de canon), `stale` (canon no contestó: la copia es de SyncedAt) o
	// `missing` (no hay copia y canon no contestó).
	State      string    `json:"state"`
	SyncedAt   time.Time `json:"syncedAt,omitempty"`   // cuándo cambió la copia por última vez
	CheckedAt  time.Time `json:"checkedAt,omitempty"`  // cuándo se confirmó contra canon
	ExportedAt string    `json:"exportedAt,omitempty"` // la revisión de canon que tiene la copia
	Files      int       `json:"files,omitempty"`
	Updated    bool      `json:"updated,omitempty"` // esta revalidación trajo una versión nueva
	Error      string    `json:"error,omitempty"`
}

func newCanonKeeper(client *canon.Client, source, dir string) *canonKeeper {
	return &canonKeeper{client: client, source: source, dir: dir, now: time.Now}
}

// check revalida si la última vez fue hace más de `maxAge` (0 = siempre) y devuelve el estado.
func (k *canonKeeper) check(maxAge time.Duration) canonStatus {
	k.mu.Lock()
	defer k.mu.Unlock()
	updated := false
	if maxAge == 0 || k.now().Sub(k.checkedAt) > maxAge {
		ctx, cancel := context.WithTimeout(context.Background(), canoncache.MirrorWait)
		_, changed, err := canoncache.SyncMirror(ctx, k.client, k.source, k.dir, k.now())
		cancel()
		k.lastErr = ""
		if err != nil {
			k.lastErr = err.Error()
		} else {
			k.checkedAt, updated = k.now(), changed
		}
	}
	return k.status(updated)
}

func (k *canonKeeper) status(updated bool) canonStatus {
	m, ok := canoncache.LoadMirror(k.dir)
	out := canonStatus{CheckedAt: k.checkedAt, Updated: updated, Error: k.lastErr}
	if ok {
		out.SyncedAt, out.ExportedAt, out.Files = m.SyncedAt, m.ExportedAt, m.Files
	}
	switch {
	case !ok:
		out.State = "missing"
	case k.lastErr != "" || k.checkedAt.IsZero():
		out.State = "stale"
	default:
		out.State = "current"
	}
	return out
}

// canonStatusHandler: GET sólo lee la copia existente; POST actualiza por pedido explícito.
func (a *app) canonStatusHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodOptions:
		return
	case http.MethodGet:
		a.canonKeeper.mu.Lock()
		status := a.canonKeeper.status(false)
		a.canonKeeper.mu.Unlock()
		json.NewEncoder(w).Encode(status)
	case http.MethodPost:
		json.NewEncoder(w).Encode(a.canonKeeper.check(0))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
