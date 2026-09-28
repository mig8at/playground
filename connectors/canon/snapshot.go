package canon

/* Lo que el tablero guarda de canon para trabajar el día a día: la lista de temas y el mapa global. Dos
 * pedidos GRATIS (no pasan por ningún modelo) y chicos. Se piden con If-None-Match, pero ⚠ `/api/topics`
 * nunca contestó 304 (medido el 2026-09-27): baja la lista entera cada vez. La revalidación de verdad es la
 * del export (abajo). La copia en disco la maneja el tablero; acá sólo viven las rutas de la API, como
 * manda `TestNoOtherCanonClientInTheRepo`. */

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
)

// TopicSummary es un tema tal como lo lista `/api/topics`.
type TopicSummary struct {
	Topic    string `json:"topic"`
	Title    string `json:"title"`
	Summary  string `json:"summary"`
	Kind     string `json:"kind"`
	Parent   string `json:"parent"`
	Sections int    `json:"sections"`
	Areas    int    `json:"areas"`
}

// Stage es una etapa del recorrido del crédito (un grupo del mapa global) con los temas que tienen al
// menos una estación en ella, en el orden en que aparecen.
type Stage struct {
	Title  string   `json:"title"`
	Topics []string `json:"topics"`
}

// conditionalGet pide `path` con If-None-Match; notModified=true si canon contestó 304.
func (c *Client) conditionalGet(ctx context.Context, path, etag string) (body []byte, newETag string, notModified bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, "", false, err
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, "", false, fmt.Errorf("no pude consultar Canon (%s): %w", c.baseURL, err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotModified {
		return nil, etag, true, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", false, fmt.Errorf("Canon respondió HTTP %d en %s", res.StatusCode, path)
	}
	body, err = io.ReadAll(res.Body)
	return body, res.Header.Get("ETag"), false, err
}

// Topics: la lista de temas, o notModified si el corpus no cambió desde `etag`.
func (c *Client) Topics(ctx context.Context, etag string) ([]TopicSummary, string, bool, error) {
	body, newETag, notModified, err := c.conditionalGet(ctx, "/api/topics", etag)
	if err != nil || notModified {
		return nil, newETag, notModified, err
	}
	var out struct {
		Topics []TopicSummary `json:"temas"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, "", false, fmt.Errorf("Canon devolvió una lista de temas inválida: %w", err)
	}
	sort.Slice(out.Topics, func(i, j int) bool { return out.Topics[i].Topic < out.Topics[j].Topic })
	return out.Topics, newETag, false, nil
}

// GlobalMap: el mapa global tal cual (grupos, estaciones, rieles y los recorridos de cada tema).
func (c *Client) GlobalMap(ctx context.Context) (json.RawMessage, error) {
	body, _, _, err := c.conditionalGet(ctx, "/api/globalmap", "")
	return body, err
}

/* Stages deriva del mapa global en qué etapa del recorrido tiene estaciones cada tema. La etapa de una
 * estación es el último grupo cuya `x` no la pasa, que es como las dibuja el mapa. Un tema aparece en
 * TODAS las etapas donde tiene estaciones: tomar sólo la primera ponía a `cartera` en «cierre» y dejaba
 * «pagos y cartera» vacía (medido el 2026-09-27). */
func Stages(globalMap json.RawMessage) ([]Stage, error) {
	var gm struct {
		Map struct {
			Groups []struct {
				Title string  `json:"titulo"`
				X     float64 `json:"x"`
			} `json:"groups"`
			Stations []struct {
				Topic string  `json:"tema"`
				X     float64 `json:"x"`
			} `json:"stations"`
		} `json:"mapa"`
	}
	if err := json.Unmarshal(globalMap, &gm); err != nil {
		return nil, fmt.Errorf("mapa global inválido: %w", err)
	}
	groups := gm.Map.Groups
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].X < groups[j].X })
	stations := gm.Map.Stations
	sort.SliceStable(stations, func(i, j int) bool { return stations[i].X < stations[j].X })
	stages := make([]Stage, len(groups))
	for i, g := range groups {
		stages[i].Title = g.Title
	}
	seen := make([]map[string]bool, len(groups))
	for i := range seen {
		seen[i] = map[string]bool{}
	}
	for _, s := range stations {
		idx := -1
		for i, g := range groups {
			if s.X >= g.X {
				idx = i
			}
		}
		if idx < 0 || s.Topic == "" || seen[idx][s.Topic] {
			continue
		}
		seen[idx][s.Topic] = true
		stages[idx].Topics = append(stages[idx].Topics, s.Topic)
	}
	return stages, nil
}

/* Export es el corpus ENTERO tal como está en la base de canon: ruta → contenido (`content/<tema>/context.md`,
 * `map.json`, `flow.json`…). Es lo que arma la copia local del tablero, para leer canon con grep y sin VPN.
 * Trae un `sha256` de todos los archivos, que `Verify` recalcula. El `etag` del cuerpo es el del corpus
 * (el If-Match de las escrituras); el del HEADER es ese sha256, y es con el que se revalida la copia. */
type Export struct {
	ETag       string            `json:"etag"`
	SHA256     string            `json:"sha256"`
	Files      map[string]string `json:"files"`
	ExportedAt string            `json:"exportado"`
}

/* Export baja el corpus si cambió desde `tag` (el ETag del header de la última vez): con uno igual canon
 * contesta 304 y no se baja nada. Devuelve el ETag nuevo del header. ⚠ Una instancia anterior al
 * 2026-09-27 no respeta If-None-Match y contesta 200 siempre: quien llama compara el sha256. */
func (c *Client) Export(ctx context.Context, tag string) (exp Export, newTag string, notModified bool, err error) {
	body, newTag, notModified, err := c.conditionalGet(ctx, "/api/export", tag)
	if err != nil || notModified {
		return Export{}, newTag, notModified, err
	}
	if err := json.Unmarshal(body, &exp); err != nil {
		return Export{}, "", false, fmt.Errorf("Canon devolvió un export inválido: %w", err)
	}
	return exp, newTag, false, nil
}

/* Verify recalcula el sha256 con la fórmula de canon (`snapshotSHA`, en `internal/api/patch.go` de su
 * repo): por ruta ordenada, `len(ruta):ruta len(contenido):contenido`. Un export cortado a mitad de camino
 * o un contenido que cambió en el viaje no coinciden. */
func (e Export) Verify() error {
	paths := make([]string, 0, len(e.Files))
	for p := range e.Files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	h := sha256.New()
	for _, p := range paths {
		fmt.Fprintf(h, "%d:%s%d:", len(p), p, len(e.Files[p]))
		io.WriteString(h, e.Files[p])
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != e.SHA256 {
		return fmt.Errorf("el export no coincide con su sha256 (%s… ≠ %s…)", got[:12], clipHash(e.SHA256))
	}
	return nil
}

func clipHash(h string) string {
	if len(h) > 12 {
		return h[:12]
	}
	return h
}
