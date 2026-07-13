package atlassian

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
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
