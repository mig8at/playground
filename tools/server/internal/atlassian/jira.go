package atlassian

import (
	"context"
	"net/http"
	"strings"
)

// Myself es el usuario autenticado (GET /rest/api/3/myself).
type Myself struct {
	AccountID    string `json:"accountId"`
	DisplayName  string `json:"displayName"`
	EmailAddress string `json:"emailAddress"`
}

// GetMyself valida las credenciales y devuelve quién eres. Solo lectura.
func (c *Client) GetMyself(ctx context.Context) (*Myself, error) {
	var m Myself
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/myself", nil, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Issue es la vista mínima de un issue que devolvemos.
type Issue struct {
	Key     string
	Summary string
	Status  string
}

// searchJQLResp: respuesta cruda del endpoint nuevo /rest/api/3/search/jql.
// (El viejo /rest/api/3/search fue removido en oct-2025 → 410 Gone.)
type searchJQLResp struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary string `json:"summary"`
			Status  struct {
				Name string `json:"name"`
			} `json:"status"`
		} `json:"fields"`
	} `json:"issues"`
	NextPageToken string `json:"nextPageToken"`
}

// SearchIssues corre una consulta JQL (POST /rest/api/3/search/jql). Solo lectura.
// Devuelve la primera página; la paginación por nextPageToken se puede agregar luego.
func (c *Client) SearchIssues(ctx context.Context, jql string, maxResults int) ([]Issue, error) {
	if maxResults <= 0 || maxResults > 100 {
		maxResults = 25
	}
	body := map[string]any{
		"jql":        jql,
		"maxResults": maxResults,
		"fields":     []string{"summary", "status"},
	}

	var raw searchJQLResp
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &raw); err != nil {
		return nil, err
	}

	issues := make([]Issue, 0, len(raw.Issues))
	for _, it := range raw.Issues {
		issues = append(issues, Issue{
			Key:     it.Key,
			Summary: it.Fields.Summary,
			Status:  it.Fields.Status.Name,
		})
	}
	return issues, nil
}

// CreateIssueParams describe el issue a crear.
type CreateIssueParams struct {
	ProjectKey  string // ej "CORE"
	Summary     string
	IssueType   string // nombre del tipo, ej "Tarea" (usar si no hay ID)
	IssueTypeID string // id del tipo, ej "10005" (gana sobre IssueType; evita ambigüedad por nombres duplicados)
	AssigneeID  string // accountId (opcional)
	Description string // texto plano (opcional; se convierte a ADF)
}

// CreatedIssue es la respuesta de crear un issue.
type CreatedIssue struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}

// adfFromText arma un documento ADF (Atlassian Document Format) a partir de
// texto plano. En la API v3 el campo description debe ser ADF, no string.
// Cada bloque separado por una línea en blanco se vuelve un párrafo.
func adfFromText(text string) map[string]any {
	content := make([]any, 0)
	for _, block := range strings.Split(strings.TrimSpace(text), "\n\n") {
		block = strings.TrimSpace(block)
		if block == "" {
			continue
		}
		content = append(content, map[string]any{
			"type":    "paragraph",
			"content": []any{map[string]any{"type": "text", "text": block}},
		})
	}
	if len(content) == 0 {
		content = append(content, map[string]any{
			"type":    "paragraph",
			"content": []any{map[string]any{"type": "text", "text": " "}},
		})
	}
	return map[string]any{"type": "doc", "version": 1, "content": content}
}

// CreateIssue crea un issue (POST /rest/api/3/issue). ESCRITURA.
func (c *Client) CreateIssue(ctx context.Context, p CreateIssueParams) (*CreatedIssue, error) {
	// El tipo se identifica por ID si se da (evita ambigüedad cuando hay
	// nombres duplicados, como dos "Tarea"); si no, por nombre.
	issueType := map[string]string{"name": p.IssueType}
	if p.IssueTypeID != "" {
		issueType = map[string]string{"id": p.IssueTypeID}
	}

	fields := map[string]any{
		"project":   map[string]string{"key": p.ProjectKey},
		"summary":   p.Summary,
		"issuetype": issueType,
	}
	if p.AssigneeID != "" {
		fields["assignee"] = map[string]string{"accountId": p.AssigneeID}
	}
	if p.Description != "" {
		fields["description"] = adfFromText(p.Description)
	}

	var out CreatedIssue
	if err := c.do(ctx, http.MethodPost, "/rest/api/3/issue", map[string]any{"fields": fields}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteIssue borra un issue (DELETE /rest/api/3/issue/{key}). ESCRITURA, irreversible.
func (c *Client) DeleteIssue(ctx context.Context, key string) error {
	return c.do(ctx, http.MethodDelete, "/rest/api/3/issue/"+key, nil, nil)
}

// IssueType es un tipo de issue disponible en un proyecto.
type IssueType struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Subtask bool   `json:"subtask"`
}

// ProjectIssueTypes lista los tipos de issue creables en un proyecto
// (GET /rest/api/3/issue/createmeta/{key}/issuetypes). Solo lectura.
func (c *Client) ProjectIssueTypes(ctx context.Context, projectKey string) ([]IssueType, error) {
	var raw struct {
		IssueTypes []IssueType `json:"issueTypes"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/issue/createmeta/"+projectKey+"/issuetypes", nil, &raw); err != nil {
		return nil, err
	}
	return raw.IssueTypes, nil
}
