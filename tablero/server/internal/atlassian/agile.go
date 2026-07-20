package atlassian

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"sort"
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

// RecentSprints devuelve los últimos n sprints del board (cerrados + el activo), del más reciente al
// más viejo.
//
// OJO CON LA PAGINACIÓN: la Agile API devuelve los sprints en orden ASCENDENTE y no acepta orderBy, así
// que la primera página trae los MÁS VIEJOS. Pedir `maxResults=n` daría los n primeros sprints del board
// — justo lo contrario de lo que queremos. Hay que recorrer hasta `isLast` y cortar por la cola. Hoy el
// board 248 tiene 8 sprints y entra en una página, pero eso caduca solo.
func (c *Client) RecentSprints(ctx context.Context, boardID, n int) ([]Sprint, error) {
	var todos []Sprint
	for startAt := 0; ; {
		var raw struct {
			Values []Sprint `json:"values"`
			IsLast bool     `json:"isLast"`
		}
		path := fmt.Sprintf("/rest/agile/1.0/board/%d/sprint?state=closed,active&maxResults=50&startAt=%d", boardID, startAt)
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
		return nil, fmt.Errorf("el board %d no tiene sprints cerrados ni activos", boardID)
	}

	// Ordenamos por fecha de inicio (no por id: los ids son globales de la instancia, así que un sprint
	// creado antes pero arrancado después quedaría fuera de lugar). El id queda como desempate.
	sort.Slice(todos, func(i, j int) bool {
		if todos[i].StartDate != todos[j].StartDate {
			return todos[i].StartDate > todos[j].StartDate
		}
		return todos[i].ID > todos[j].ID
	})
	if n > 0 && len(todos) > n {
		todos = todos[:n]
	}
	return todos, nil
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
	Status         string
	StatusCategory string // "new" (por hacer) | "indeterminate" (en curso) | "done"
	Points         float64
	HasPoints      bool
	EstimateSecs   int
	SpentSecs      int
}

// respuesta cruda del listado de issues de un sprint.
// Nota: el campo de Story Points en CORE es customfield_10036.
type sprintIssuesResp struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary string `json:"summary"`
			Status  struct {
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
		"/rest/agile/1.0/sprint/%d/issue?jql=%s&fields=summary,status,timetracking,customfield_10036&maxResults=100",
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
	return out, nil
}
