package main

/* LA PRUEBA EN VIVO. Mientras corre una compra de prueba, la solicitud cambia de estado y aparecen solicitudes nuevas;
 * antes había que volver a buscar para verlo. Ahora la interfaz, con un resultado en pantalla, se suscribe a:
 *
 *   GET /api/watch?target=qa&request=504059&users=12,34   (SSE)
 *
 * y el servidor mira cada 3 s, con UNA consulta barata, la firma de lo que se ve: el estado y la última actualización
 * de la solicitud mostrada, cuántos registros de estado tiene (su historial), y la solicitud más nueva de esas
 * personas. Si cambió, manda `changed` y la interfaz vuelve a buscar (la búsqueda entera son ocho consultas: no se
 * repite a ciegas). Sólo lee.
 *
 * Sólo con la base DIRECTA (local, qa): en producción ecommerce lee por Redash, y consultarlo cada 3 s no corresponde;
 * ahí el stream contesta `unsupported` y la interfaz sigue como antes, buscando a mano. */

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// idList: los ids de la consulta, sólo dígitos y a lo sumo 20 (una persona con muchos homónimos no dispara un IN enorme).
func idList(raw string) []any {
	var out []any
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if n, err := strconv.Atoi(part); err == nil && n > 0 {
			out = append(out, strconv.Itoa(n))
		}
		if len(out) == 20 {
			break
		}
	}
	return out
}

// watchSignature: lo que, si cambia, cambia la pantalla.
func watchSignature(src Source, request string, users []any) (string, error) {
	var parts []string
	if request != "" {
		got, err := rows(src, `SELECT ur.user_request_status_id AS status, ur.updated_at,
				(SELECT COUNT(*) FROM user_request_records r WHERE r.user_request_id = ur.id) AS records
			FROM user_requests ur WHERE ur.id = ?`, request)
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(got)
		parts = append(parts, string(b))
	}
	if len(users) > 0 {
		marks := strings.TrimSuffix(strings.Repeat("?,", len(users)), ",")
		got, err := rows(src, `SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS last FROM user_requests WHERE user_id IN (`+marks+`)`, users...)
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(got)
		parts = append(parts, string(b))
	}
	return strings.Join(parts, "|"), nil
}

// watchStaleAfter: cuántas consultas seguidas tienen que fallar para avisar que el vivo está cortado.
const watchStaleAfter = 3

func registerWatch(mux *http.ServeMux) {
	mux.HandleFunc("/api/watch", func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "sin streaming", http.StatusInternalServerError)
			return
		}
		q := r.URL.Query()
		target := q.Get("target")
		request := ""
		if n, err := strconv.Atoi(q.Get("request")); err == nil && n > 0 {
			request = strconv.Itoa(n)
		}
		users := idList(q.Get("users"))
		w.Header().Set("content-type", "text/event-stream")
		w.Header().Set("cache-control", "no-cache")
		send := func(name string, data any) {
			b, _ := json.Marshal(data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, b)
			flusher.Flush()
		}
		if !validReadTarget(target) {
			send("unsupported", map[string]string{"reason": "ambiente desconocido"})
			return
		}
		src, err := source(target)
		if err != nil {
			send("unsupported", map[string]string{"reason": err.Error()})
			return
		}
		if !strings.HasPrefix(src.Name(), "mysql") {
			send("unsupported", map[string]string{"reason": "en " + target + " se lee por Redash: sin vivo"})
			return
		}
		if request == "" && len(users) == 0 {
			send("unsupported", map[string]string{"reason": "nada que mirar"})
			return
		}
		last, err := watchSignature(src, request, users)
		if err != nil {
			send("unsupported", map[string]string{"reason": err.Error()})
			return
		}
		send("hello", map[string]any{})
		tick := time.NewTicker(3 * time.Second)
		defer tick.Stop()
		beat := 0
		// Fallas SEGUIDAS de la consulta: una sola no dice nada, pero varias son la VPN caída o la base que no
		// contesta, y la interfaz seguía diciendo «en vivo». A la tercera (~9 s) se avisa `stale`; cuando vuelve a
		// contestar, `fresh` (y `changed` si además cambió).
		fails := 0
		for {
			select {
			case <-r.Context().Done():
				return
			case <-tick.C:
				sig, err := watchSignature(src, request, users)
				if err != nil {
					// Una consulta que falló no es un cambio; la próxima vuelve a intentar.
					if fails++; fails == watchStaleAfter {
						send("stale", map[string]string{"reason": err.Error()})
					}
					continue
				}
				if fails >= watchStaleAfter {
					send("fresh", map[string]any{})
				}
				fails = 0
				if sig != last {
					last = sig
					send("changed", map[string]any{})
				} else if beat++; beat%8 == 0 {
					send("ping", map[string]any{}) // cada ~24 s, para que un proxy no corte el stream callado
				}
			}
		}
	})
}
