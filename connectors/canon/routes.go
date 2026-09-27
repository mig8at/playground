package canon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

// La referencia guarda IDs del recorrido, no nombres ni una copia del mapa.
// El paso es opcional: sin él se muestra la variante completa.
var routeRefPattern = regexp.MustCompile(`^([a-z0-9][a-z0-9-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)(?:#([A-Za-z0-9][A-Za-z0-9._-]*))?$`)
var ErrRouteMissing = errors.New("la referencia no existe en el recorrido vigente de Canon")

type RouteRef struct {
	Topic   string
	Variant string
	Step    string
}

func ParseRouteRef(value string) (RouteRef, error) {
	m := routeRefPattern.FindStringSubmatch(value)
	if m == nil {
		return RouteRef{}, fmt.Errorf("usa canon-ruta:tema/variante#paso (el paso es opcional)")
	}
	return RouteRef{Topic: m[1] + "/context", Variant: m[2], Step: m[3]}, nil
}

// Sólo se decodifica lo necesario del contrato de Canon. Geometría, prosa y archivos
// permanecen en su origen. Flows y estaciones llegan en una misma revisión.
type routeCatalog struct {
	Map *struct {
		Stations []struct {
			ID string `json:"id"`
		} `json:"stations"`
		Rails []struct {
			From string `json:"desde"`
			To   string `json:"hasta"`
		} `json:"rails"`
	} `json:"mapa"`
	Flows map[string]routeFlow `json:"flows"`
	ETag  string               `json:"etag"`
}

type routeFlow struct {
	Title    string `json:"titulo"`
	Variants []struct {
		ID    string   `json:"id"`
		Title string   `json:"titulo"`
		When  string   `json:"cuando"`
		Steps []string `json:"pasos"`
	} `json:"rutas"`
	Steps []struct {
		ID        string `json:"id"`
		Station   string `json:"estacion_global"`
		Title     string `json:"titulo"`
		Reference string `json:"referencia"`
		Note      string `json:"nota"`
	} `json:"estaciones"`
}

type RouteStep struct {
	ID        string `json:"id"`
	Station   string `json:"station"`
	Title     string `json:"title"`
	Note      string `json:"note,omitempty"`
	SourceURL string `json:"source_url,omitempty"`
	URL       string `json:"url"`
	Focused   bool   `json:"focused"`
}

type RouteView struct {
	Reference    string      `json:"reference"`
	Topic        string      `json:"topic"`
	Title        string      `json:"title"`
	Variant      string      `json:"variant"`
	VariantTitle string      `json:"variant_title"`
	When         string      `json:"when,omitempty"`
	URL          string      `json:"url"`
	ETag         string      `json:"etag"`
	Steps        []RouteStep `json:"steps"`
	Before       int         `json:"before"`
	After        int         `json:"after"`
}

// La caché compartida evita bajar el mapa una vez por bloque. Se revalida al minuto;
// un fallo de red no convierte una copia vencida en una afirmación vigente.
func (c *Client) routeCatalog(ctx context.Context) (*routeCatalog, error) {
	c.catalogMu.Lock()
	defer c.catalogMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if c.catalog != nil && time.Since(c.catalogAt) < time.Minute {
		return c.catalog, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/globalmap", nil)
	if err != nil {
		return nil, err
	}
	if c.catalogETag != "" {
		req.Header.Set("If-None-Match", c.catalogETag)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("no se pudo leer el recorrido de Canon: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotModified && c.catalog != nil {
		c.catalogAt = time.Now()
		return c.catalog, nil
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Canon respondió HTTP %d", res.StatusCode)
	}
	var catalog routeCatalog
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&catalog); err != nil {
		return nil, fmt.Errorf("mapa de Canon inválido: %w", err)
	}
	if catalog.Map == nil || len(catalog.Flows) == 0 || catalog.ETag == "" {
		return nil, fmt.Errorf("Canon no tiene un mapa de recorridos disponible")
	}
	c.catalog, c.catalogETag, c.catalogAt = &catalog, res.Header.Get("ETag"), time.Now()
	return &catalog, nil
}

func (c *Client) routeURL(ref RouteRef, station string) string {
	q := url.Values{"tema": {ref.Topic}, "ruta": {ref.Variant}}
	if station != "" {
		q.Set("estacion", station)
	}
	return c.baseURL + "/recorridos?" + q.Encode()
}

// Route conserva el orden documentado y separa pasos que comparten estación.
// Con foco devuelve el paso y sus dos vecinos; no construye caminos nuevos.
func (c *Client) Route(ctx context.Context, value string) (RouteView, error) {
	ref, err := ParseRouteRef(value)
	if err != nil {
		return RouteView{}, err
	}
	catalog, err := c.routeCatalog(ctx)
	if err != nil {
		return RouteView{}, err
	}
	flow, ok := catalog.Flows[ref.Topic]
	if !ok {
		return RouteView{}, ErrRouteMissing
	}
	view := RouteView{Reference: value, Topic: ref.Topic, Title: flow.Title, Variant: ref.Variant, ETag: catalog.ETag, URL: c.routeURL(ref, "")}
	var order []string
	for _, variant := range flow.Variants {
		if variant.ID == ref.Variant {
			order, view.VariantTitle, view.When = variant.Steps, variant.Title, variant.When
			break
		}
	}
	if len(order) == 0 {
		return RouteView{}, ErrRouteMissing
	}
	stations, rails := map[string]bool{}, map[[2]string]bool{}
	for _, s := range catalog.Map.Stations {
		stations[s.ID] = true
	}
	for _, r := range catalog.Map.Rails {
		rails[[2]string{r.From, r.To}] = true
	}
	focus := -1
	for i, id := range order {
		step := RouteStep{}
		for _, s := range flow.Steps {
			if s.ID == id {
				step = RouteStep{ID: id, Station: s.Station, Title: s.Title, Note: s.Note, URL: c.routeURL(ref, s.Station), Focused: id == ref.Step}
				if s.Reference != "" {
					step.SourceURL = c.baseURL + "/?" + url.Values{"nodo": {s.Reference}}.Encode()
				}
				break
			}
		}
		if step.ID == "" || !stations[step.Station] {
			return RouteView{}, fmt.Errorf("el paso %s no tiene estación en el mapa vigente", id)
		}
		if i > 0 {
			previous := view.Steps[i-1].Station
			if previous != step.Station && !rails[[2]string{previous, step.Station}] {
				return RouteView{}, fmt.Errorf("el tramo antes de %s no tiene conexión documentada", id)
			}
		}
		if step.Focused {
			focus, view.URL = i, step.URL
		}
		view.Steps = append(view.Steps, step)
	}
	if ref.Step != "" {
		if focus < 0 {
			return RouteView{}, ErrRouteMissing
		}
		start, end := max(0, focus-1), min(len(view.Steps), focus+2)
		view.Before, view.After = start, len(view.Steps)-end
		view.Steps = view.Steps[start:end]
	}
	return view, nil
}

func (c *Client) MissingRoutes(ctx context.Context, refs []string) ([]string, error) {
	var missing []string
	for _, ref := range refs {
		_, err := c.Route(ctx, ref)
		if errors.Is(err, ErrRouteMissing) {
			missing = append(missing, ref)
			continue
		}
		if err != nil {
			return missing, err
		}
	}
	return missing, nil
}
