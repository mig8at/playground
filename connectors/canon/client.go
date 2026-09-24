// Package canon lee las referencias que una tarea declaró en Canon.
//
// No copia el corpus al tablero ni le pide resúmenes a un modelo. Una referencia
// queda en el Markdown de la tarea y este cliente sólo la resuelve por la API
// pública de Canon para mostrar su título, resumen y enlace estable.
package canon

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

const DefaultURL = "https://canon.playground.creditop.com"

// URL devuelve el origen de Canon configurado para esta herramienta. Mantener
// un default hace que una instalación nueva pueda leer referencias sin tener
// que conocer dónde vive el corpus; CANON_URL permite usar un Canon local.
func URL() string {
	if value := strings.TrimSpace(os.Getenv("CANON_URL")); value != "" {
		return strings.TrimRight(value, "/")
	}
	return DefaultURL
}

type Client struct {
	baseURL string
	http    *http.Client
}

func New(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultURL
	}
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 8 * time.Second},
	}
}

func FromEnv() *Client { return New(URL()) }

// Reference es la proyección chica que necesita Tablero. ID conserva la cita
// canónica que se puede poner de nuevo en una tarea; Requested conserva lo que
// escribió la persona para que un error se pueda corregir sin adivinarlo.
type Reference struct {
	Requested string `json:"requested"`
	ID        string `json:"id,omitempty"`
	Title     string `json:"title,omitempty"`
	Summary   string `json:"summary,omitempty"`
	Verified  string `json:"verified,omitempty"`
	Error     string `json:"error,omitempty"`
}

type Area struct {
	ID       string                       `json:"id"`
	Goal     string                       `json:"objetivo"`
	Sections []string                     `json:"secciones"`
	Tables   []string                     `json:"tablas"`
	Sources  map[string]map[string]string `json:"fuentes"`
}

// Brief es el apoyo compacto que `make retomar BRIEF=1` muestra. Sale de
// /api/read: no es una inferencia ni una segunda base de conocimiento.
type Brief struct {
	ID      string
	Title   string
	Summary string
	Areas   []Area
	Tables  []string
	Repos   []string
}

type node struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Summary  string            `json:"summary"`
	Verified string            `json:"verified"`
	Areas    []Area            `json:"areas"`
	Repos    map[string]string `json:"repos"`
}

type readResponse struct {
	Nodes    []node   `json:"nodes"`
	NotFound []string `json:"not_found"`
}

// CanonicalID acepta el atajo histórico de Tablero ("onboarding") y la cita
// completa de Canon ("onboarding/context#paso"). El segundo es preferible al
// declarar una sección precisa; ambos terminan consultando la misma API.
func CanonicalID(reference string) (string, error) {
	reference = strings.TrimSpace(reference)
	if reference == "" {
		return "", fmt.Errorf("referencia vacía")
	}
	path, anchor, hasAnchor := strings.Cut(reference, "#")
	path = strings.TrimSpace(path)
	if path == "" || strings.ContainsAny(path, "?&,") || strings.ContainsAny(anchor, "?&,") {
		return "", fmt.Errorf("referencia inválida: %q", reference)
	}
	if !strings.Contains(path, "/") {
		path += "/context"
	}
	if hasAnchor {
		anchor = strings.TrimSpace(anchor)
		if anchor == "" {
			return "", fmt.Errorf("referencia inválida: %q", reference)
		}
		return path + "#" + anchor, nil
	}
	return path, nil
}

// References resuelve las citas en una única llamada a /api/read. Que una cita
// no exista no hace caer las otras: vuelve marcada para que la UI o el lint la
// nombren con exactitud.
func (c *Client) References(ctx context.Context, requested []string) ([]Reference, error) {
	ids := make([]string, 0, len(requested))
	refs := make([]Reference, 0, len(requested))
	for _, raw := range requested {
		id, err := CanonicalID(raw)
		if err != nil {
			refs = append(refs, Reference{Requested: raw, Error: err.Error()})
			continue
		}
		refs = append(refs, Reference{Requested: raw, ID: id})
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return refs, nil
	}

	response, err := c.read(ctx, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]node, len(response.Nodes))
	for _, n := range response.Nodes {
		byID[n.ID] = n
	}
	for i := range refs {
		if refs[i].ID == "" {
			continue
		}
		base, _, _ := strings.Cut(refs[i].ID, "#")
		n, ok := byID[base]
		if !ok {
			refs[i].Error = "no existe en Canon"
			continue
		}
		refs[i].Title, refs[i].Summary, refs[i].Verified = n.Title, n.Summary, n.Verified
	}
	return refs, nil
}

func (c *Client) Brief(ctx context.Context, reference string) (Brief, error) {
	id, err := CanonicalID(reference)
	if err != nil {
		return Brief{}, err
	}
	response, err := c.read(ctx, []string{id})
	if err != nil {
		return Brief{}, err
	}
	if len(response.Nodes) == 0 {
		return Brief{}, fmt.Errorf("la referencia %q no existe en Canon", reference)
	}
	n := response.Nodes[0]
	f := Brief{ID: id, Title: n.Title, Summary: n.Summary, Areas: n.Areas}
	tables, repos := map[string]bool{}, map[string]bool{}
	for repo := range n.Repos {
		repos[repo] = true
	}
	for _, area := range n.Areas {
		for _, table := range area.Tables {
			tables[table] = true
		}
		for repo := range area.Sources {
			repos[repo] = true
		}
	}
	f.Tables, f.Repos = sorted(tables), sorted(repos)
	return f, nil
}

func (c *Client) read(ctx context.Context, ids []string) (readResponse, error) {
	u, err := url.Parse(c.baseURL + "/api/read")
	if err != nil {
		return readResponse{}, fmt.Errorf("CANON_URL inválida: %w", err)
	}
	q := u.Query()
	q.Set("ids", strings.Join(ids, ","))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return readResponse{}, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return readResponse{}, fmt.Errorf("no pude consultar Canon (%s): %w", c.baseURL, err)
	}
	defer res.Body.Close()
	if res.StatusCode < http.StatusOK || res.StatusCode >= http.StatusMultipleChoices {
		return readResponse{}, fmt.Errorf("Canon respondió HTTP %d", res.StatusCode)
	}
	var output readResponse
	if err := json.NewDecoder(res.Body).Decode(&output); err != nil {
		return readResponse{}, fmt.Errorf("Canon devolvió una respuesta inválida: %w", err)
	}
	return output, nil
}

func sorted(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
