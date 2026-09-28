package main

/* El tablero mantiene al día la copia local de canon y dice en el pie si lo está.
 *
 * La copia (`data/cache/canon`) es de donde se lee canon para trabajar: grep, `retomar CANON=1`,
 * `canon-code`. El arranque de sesión ya la revalida, pero una sesión larga no vuelve a arrancar, y lo que
 * el equipo dicta a canon en el medio no llegaría. Mientras el tablero está abierto, esto la revalida
 * cada tanto contra el ETag del export —304 si nada cambió, sin bajar nada—, y la UI lo muestra: «al
 * día», o de cuándo es la copia si canon no contesta (sin la VPN de prod, por ejemplo). */

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"creditop/playground/connectors/canon"
	"creditop/playground/tablero/server/internal/canoncache"
)

const (
	canonCheckEvery = 10 * time.Minute // la revalidación de fondo
	canonFreshFor   = time.Minute      // un pedido de la UI no vuelve a preguntarle a canon antes de esto
)

// canonKeeper es quien revalida la copia. Un solo sync a la vez: el cambio de carpeta no se pisa.
type canonKeeper struct {
	mu        sync.Mutex
	client    *canon.Client
	source    string
	cacheDir  string
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

func newCanonKeeper(client *canon.Client, source, cacheDir string) *canonKeeper {
	return &canonKeeper{client: client, source: source, cacheDir: cacheDir, now: time.Now}
}

// check revalida si la última vez fue hace más de `maxAge` (0 = siempre) y devuelve el estado.
func (k *canonKeeper) check(maxAge time.Duration) canonStatus {
	k.mu.Lock()
	defer k.mu.Unlock()
	updated := false
	if maxAge == 0 || k.now().Sub(k.checkedAt) > maxAge {
		ctx, cancel := context.WithTimeout(context.Background(), canoncache.MirrorWait)
		_, changed, err := canoncache.SyncMirror(ctx, k.client, k.source, k.cacheDir, k.now())
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
	m, ok := canoncache.LoadMirror(k.cacheDir)
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

// run revalida de fondo mientras el servidor esté arriba.
func (k *canonKeeper) run(ctx context.Context) {
	k.check(0)
	t := time.NewTicker(canonCheckEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			k.check(0)
		}
	}
}

// canonStatusHandler: GET el estado (revalidando si pasó un minuto), POST revalida ya.
func (a *app) canonStatusHandler(w http.ResponseWriter, r *http.Request) {
	cors(w)
	w.Header().Set("Cache-Control", "no-store")
	switch r.Method {
	case http.MethodOptions:
		return
	case http.MethodGet:
		json.NewEncoder(w).Encode(a.canonKeeper.check(canonFreshFor))
	case http.MethodPost:
		json.NewEncoder(w).Encode(a.canonKeeper.check(0))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}
