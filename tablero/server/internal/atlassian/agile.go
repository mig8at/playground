package atlassian

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Sprint es un sprint de un board (API Agile / Jira Software).
type Sprint struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	State     string `json:"state"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
}

// ActiveSprint devuelve el sprint activo de un board.
// (GET /rest/agile/1.0/board/{boardId}/sprint?state=active)
func (c *Client) ActiveSprint(ctx context.Context, boardID int) (*Sprint, error) {
	var raw struct {
		Values []Sprint `json:"values"`
	}
	path := fmt.Sprintf("/rest/agile/1.0/board/%d/sprint?state=active", boardID)
	if err := c.do(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}
	if len(raw.Values) == 0 {
		return nil, fmt.Errorf("el board %d no tiene sprint activo", boardID)
	}
	return &raw.Values[0], nil
}

// allSprints trae todos los sprints del board (cerrados + activo + próximos), ordenados del más reciente
// al más viejo.
//
// OJO CON LA PAGINACIÓN: la Agile API devuelve los sprints en orden ASCENDENTE y no acepta orderBy, así
// que la primera página trae los MÁS VIEJOS. Pedir `maxResults=n` daría los n primeros sprints del board
// — justo lo contrario de lo que queremos. Hay que recorrer hasta `isLast` y cortar por la cola. Hoy los
// boards entran en una página, pero eso caduca solo.
//
// Incluimos `future`: un board puede estar ENTRE SPRINTS (el anterior cerró, el próximo no arrancó), como
// CORE hoy. Sin future, el tablero se quedaría sin nada que mostrar justo en el cambio de sprint.
func (c *Client) allSprints(ctx context.Context, boardID int) ([]Sprint, error) {
	var todos []Sprint
	for startAt := 0; ; {
		var raw struct {
			Values []Sprint `json:"values"`
			IsLast bool     `json:"isLast"`
		}
		path := fmt.Sprintf("/rest/agile/1.0/board/%d/sprint?state=closed,active,future&maxResults=50&startAt=%d", boardID, startAt)
		if err := c.do(ctx, http.MethodGet, path, nil, &raw); err != nil {
			return nil, err
		}
		todos = append(todos, raw.Values...)
		if raw.IsLast || len(raw.Values) == 0 {
			break
		}
		startAt += len(raw.Values)
	}
	if len(todos) == 0 {
		return nil, fmt.Errorf("el board %d no tiene sprints", boardID)
	}

	// Ordenamos por fecha de inicio (no por id: los ids son globales de la instancia, así que un sprint
	// creado antes pero arrancado después quedaría fuera de lugar). El id queda como desempate. Un future
	// sin fecha cae al fondo, que es donde queremos que esté.
	sort.Slice(todos, func(i, j int) bool {
		if todos[i].StartDate != todos[j].StartDate {
			return todos[i].StartDate > todos[j].StartDate
		}
		return todos[i].ID > todos[j].ID
	})
	return todos, nil
}

// RecentSprints devuelve los n sprints más recientes del board (incluye el próximo si el board está
// entre sprints), del más reciente al más viejo. Para el selector.
func (c *Client) RecentSprints(ctx context.Context, boardID, n int) ([]Sprint, error) {
	todos, err := c.allSprints(ctx, boardID)
	if err != nil {
		return nil, err
	}
	if n > 0 && len(todos) > n {
		todos = todos[:n]
	}
	return todos, nil
}

// DefaultSprint elige qué sprint mostrar al abrir, sin asumir que hay uno activo. Prioridad:
//  1. el ACTIVO, si existe (el caso normal);
//  2. el que CONTIENE HOY por fechas — aunque Jira lo tenga en `future` porque nadie le dio "start".
//     Ese es el sprint en el que estás trabajando de verdad, y es donde caen las tareas nuevas;
//  3. el último CERRADO (board entre sprints, sin uno vigente);
//  4. el más reciente que quede.
//
// La regla 2 existe por CORE: el Sprint 8 arrancaba hoy pero seguía `future`, así que el tablero abría en
// el 7 y la tarea recién creada no se veía. "Sin iniciar en Jira" no significa "no es el actual".
func (c *Client) DefaultSprint(ctx context.Context, boardID int) (*Sprint, error) {
	todos, err := c.allSprints(ctx, boardID)
	if err != nil {
		return nil, err
	}
	for i := range todos { // 1. activo
		if todos[i].State == "active" {
			return &todos[i], nil
		}
	}
	hoy := time.Now().Format("2006-01-02")
	for i := range todos { // 2. el que contiene hoy (comparación por día, iso ordena lexicográfico)
		s, e := todos[i].StartDate, todos[i].EndDate
		if len(s) >= 10 && len(e) >= 10 && s[:10] <= hoy && hoy <= e[:10] {
			return &todos[i], nil
		}
	}
	for i := range todos { // 3. el último cerrado (todos vienen ordenados desc por fecha)
		if todos[i].State == "closed" {
			return &todos[i], nil
		}
	}
	return &todos[0], nil // 4. lo que quede
}

// SprintByID trae un sprint puntual. (GET /rest/agile/1.0/sprint/{id})
func (c *Client) SprintByID(ctx context.Context, sprintID int) (*Sprint, error) {
	var sp Sprint
	if err := c.do(ctx, http.MethodGet, fmt.Sprintf("/rest/agile/1.0/sprint/%d", sprintID), nil, &sp); err != nil {
		return nil, err
	}
	return &sp, nil
}

// AddIssuesToSprint mueve issues a un sprint.
// (POST /rest/agile/1.0/sprint/{sprintId}/issue)
func (c *Client) AddIssuesToSprint(ctx context.Context, sprintID int, issueKeys []string) error {
	path := fmt.Sprintf("/rest/agile/1.0/sprint/%d/issue", sprintID)
	return c.do(ctx, http.MethodPost, path, map[string]any{"issues": issueKeys}, nil)
}

// SprintIssue es la vista de una tarea del sprint para el dashboard.
type SprintIssue struct {
	Key            string
	Summary        string
	Description    string // lo que HOY dice Jira (aplanado a texto)
	Created        string // cuándo se creó (para ordenar nuevo → viejo)
	Status         string
	StatusCategory string // "new" (por hacer) | "indeterminate" (en curso) | "done"
	Points         float64
	HasPoints      bool
	EstimateSecs   int
	SpentSecs      int
}

// adfNode es un nodo del Atlassian Document Format (el árbol que Jira Cloud usa para texto rico).
type adfNode struct {
	Type    string    `json:"type"`
	Text    string    `json:"text"`
	Content []adfNode `json:"content"`
}

// adfText aplana una descripción de Jira a texto plano. Este sitio la devuelve como STRING, pero otras
// instancias (y otros endpoints) la mandan como documento ADF: aceptamos las dos formas para que la
// descripción no aparezca vacía —o como un JSON crudo— según de dónde venga la tarea.
func adfText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil { // string plano
		return strings.TrimSpace(s)
	}
	var root adfNode
	if json.Unmarshal(raw, &root) != nil {
		return ""
	}
	var b strings.Builder
	walkADF(&root, &b)
	return strings.TrimSpace(b.String())
}

func walkADF(n *adfNode, b *strings.Builder) {
	if n.Text != "" {
		b.WriteString(n.Text)
	}
	for i := range n.Content {
		walkADF(&n.Content[i], b)
	}
	switch n.Type { // los bloques cortan línea; los inline no
	case "paragraph", "heading", "listItem", "blockquote", "codeBlock":
		b.WriteString("\n")
	}
}

// respuesta cruda del listado de issues de un sprint.
// Nota: el campo de Story Points en CORE es customfield_10036.
type sprintIssuesResp struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary     string          `json:"summary"`
			Description json.RawMessage `json:"description"`
			Created     string          `json:"created"`
			Status      struct {
				Name           string `json:"name"`
				StatusCategory struct {
					Key string `json:"key"`
				} `json:"statusCategory"`
			} `json:"status"`
			Points       *float64 `json:"customfield_10036"`
			TimeTracking struct {
				OriginalEstimateSeconds int `json:"originalEstimateSeconds"`
				TimeSpentSeconds        int `json:"timeSpentSeconds"`
			} `json:"timetracking"`
		} `json:"fields"`
	} `json:"issues"`
}

// MySprintIssues devuelve las tareas del usuario autenticado en un sprint
// (GET /rest/agile/1.0/sprint/{id}/issue con jql assignee = currentUser()).
func (c *Client) MySprintIssues(ctx context.Context, sprintID int) ([]SprintIssue, error) {
	path := fmt.Sprintf(
		"/rest/agile/1.0/sprint/%d/issue?jql=%s&fields=summary,description,created,status,timetracking,customfield_10036&maxResults=100",
		sprintID, url.QueryEscape("assignee = currentUser()"),
	)

	var raw sprintIssuesResp
	if err := c.do(ctx, http.MethodGet, path, nil, &raw); err != nil {
		return nil, err
	}

	out := make([]SprintIssue, 0, len(raw.Issues))
	for _, it := range raw.Issues {
		f := it.Fields
		si := SprintIssue{
			Key:            it.Key,
			Summary:        f.Summary,
			Description:    adfText(f.Description),
			Created:        f.Created,
			Status:         f.Status.Name,
			StatusCategory: f.Status.StatusCategory.Key,
			EstimateSecs:   f.TimeTracking.OriginalEstimateSeconds,
			SpentSecs:      f.TimeTracking.TimeSpentSeconds,
		}
		if f.Points != nil {
			si.Points = *f.Points
			si.HasPoints = true
		}
		out = append(out, si)
	}
	// La Agile API devuelve las tareas en el orden del backlog, que no dice nada útil acá. Ordenamos
	// por fecha de creación DESC: lo último que entró al sprint es lo que estás mirando hoy.
	sort.Slice(out, func(i, j int) bool { return out[i].Created > out[j].Created })
	return out, nil
}
