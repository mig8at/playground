package atlassian

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
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

// En la API v3 de Jira el campo description debe ser ADF (Atlassian Document
// Format, un JSON de nodos), no Markdown ni HTML. mdToADF renderiza el
// subconjunto de Markdown que usan nuestras plantillas para que la tarea se vea
// ordenada en Jira: encabezados, negrita, listas, checklist y links.

var (
	reHeading  = regexp.MustCompile(`^(#{1,3})\s+(.*)$`)
	reTaskItem = regexp.MustCompile(`^[-*]\s+\[([ xX])\]\s+(.*)$`)
	reOrdered  = regexp.MustCompile(`^\d+\.\s+(.*)$`)
	reBullet   = regexp.MustCompile(`^[-*]\s+(.*)$`)
	reBlock    = regexp.MustCompile(`^(#{1,3}\s|[-*]\s|\d+\.\s)`)
	reBold     = regexp.MustCompile(`\*\*(.+?)\*\*`)
	reMdLink   = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)
	reBareURL  = regexp.MustCompile(`https?://[^\s)]+`)
)

func textNode(s string, marks ...any) map[string]any {
	n := map[string]any{"type": "text", "text": s}
	if len(marks) > 0 {
		n["marks"] = marks
	}
	return n
}

// inlineNodes convierte texto con **negrita**, [texto](url) y URLs sueltas en
// nodos inline de ADF. Procesa siempre el match más temprano.
func inlineNodes(s string) []any {
	out := make([]any, 0)
	for s != "" {
		start, end := -1, 0
		var node map[string]any
		consider := func(lo, hi int, n map[string]any) {
			if lo >= 0 && (start == -1 || lo < start) {
				start, end, node = lo, hi, n
			}
		}
		if m := reMdLink.FindStringSubmatchIndex(s); m != nil {
			consider(m[0], m[1], textNode(s[m[2]:m[3]], map[string]any{"type": "link", "attrs": map[string]any{"href": s[m[4]:m[5]]}}))
		}
		if m := reBold.FindStringSubmatchIndex(s); m != nil {
			consider(m[0], m[1], textNode(s[m[2]:m[3]], map[string]any{"type": "strong"}))
		}
		if m := reBareURL.FindStringIndex(s); m != nil {
			consider(m[0], m[1], textNode(s[m[0]:m[1]], map[string]any{"type": "link", "attrs": map[string]any{"href": s[m[0]:m[1]]}}))
		}
		if start == -1 {
			out = append(out, textNode(s))
			break
		}
		if start > 0 {
			out = append(out, textNode(s[:start]))
		}
		out = append(out, node)
		s = s[end:]
	}
	if len(out) == 0 {
		out = append(out, textNode(" "))
	}
	return out
}

func mdToADF(md string) map[string]any {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	content := make([]any, 0)
	uid := 0
	nextID := func() string { uid++; return fmt.Sprintf("t%d", uid) }

	i := 0
	for i < len(lines) {
		t := strings.TrimSpace(lines[i])
		if t == "" {
			i++
			continue
		}
		switch {
		case reHeading.MatchString(t):
			m := reHeading.FindStringSubmatch(t)
			content = append(content, map[string]any{"type": "heading", "attrs": map[string]any{"level": len(m[1])}, "content": inlineNodes(m[2])})
			i++
		case reTaskItem.MatchString(t):
			items := make([]any, 0)
			for i < len(lines) {
				m := reTaskItem.FindStringSubmatch(strings.TrimSpace(lines[i]))
				if m == nil {
					break
				}
				state := "TODO"
				if m[1] != " " {
					state = "DONE"
				}
				items = append(items, map[string]any{"type": "taskItem", "attrs": map[string]any{"localId": nextID(), "state": state}, "content": inlineNodes(m[2])})
				i++
			}
			content = append(content, map[string]any{"type": "taskList", "attrs": map[string]any{"localId": nextID()}, "content": items})
		case reOrdered.MatchString(t):
			items := make([]any, 0)
			for i < len(lines) {
				m := reOrdered.FindStringSubmatch(strings.TrimSpace(lines[i]))
				if m == nil {
					break
				}
				items = append(items, map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": inlineNodes(m[1])}}})
				i++
			}
			content = append(content, map[string]any{"type": "orderedList", "content": items})
		case reBullet.MatchString(t):
			items := make([]any, 0)
			for i < len(lines) {
				m := reBullet.FindStringSubmatch(strings.TrimSpace(lines[i]))
				if m == nil {
					break
				}
				items = append(items, map[string]any{"type": "listItem", "content": []any{map[string]any{"type": "paragraph", "content": inlineNodes(m[1])}}})
				i++
			}
			content = append(content, map[string]any{"type": "bulletList", "content": items})
		default:
			buf := make([]string, 0)
			for i < len(lines) {
				ln := strings.TrimSpace(lines[i])
				if ln == "" || reBlock.MatchString(ln) {
					break
				}
				buf = append(buf, ln)
				i++
			}
			content = append(content, map[string]any{"type": "paragraph", "content": inlineNodes(strings.Join(buf, " "))})
		}
	}
	if len(content) == 0 {
		content = append(content, map[string]any{"type": "paragraph", "content": []any{textNode(" ")}})
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
		fields["description"] = mdToADF(p.Description)
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

// UpdateIssueParams son los campos editables de un issue. Vacío = no se toca.
type UpdateIssueParams struct {
	Summary     string
	Description string
}

// UpdateIssue edita summary y/o descripción de un issue existente
// (PUT /rest/api/3/issue/{key}). ESCRITURA. La descripción se envía como ADF,
// igual que en CreateIssue.
func (c *Client) UpdateIssue(ctx context.Context, key string, p UpdateIssueParams) error {
	fields := map[string]any{}
	if p.Summary != "" {
		fields["summary"] = p.Summary
	}
	if p.Description != "" {
		fields["description"] = mdToADF(p.Description)
	}
	return c.do(ctx, http.MethodPut, "/rest/api/3/issue/"+key, map[string]any{"fields": fields}, nil)
}

// Transition es una transición disponible desde el estado actual de un issue.
type Transition struct {
	ID   string // id de la transición (lo que se aplica)
	Name string // nombre de la transición
	To   string // nombre del estado destino (ej. "En pruebas")
}

// IssueTransitions lista las transiciones disponibles desde el estado actual
// (GET /rest/api/3/issue/{key}/transitions). Solo lectura.
func (c *Client) IssueTransitions(ctx context.Context, key string) ([]Transition, error) {
	var raw struct {
		Transitions []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			To   struct {
				Name string `json:"name"`
			} `json:"to"`
		} `json:"transitions"`
	}
	if err := c.do(ctx, http.MethodGet, "/rest/api/3/issue/"+key+"/transitions", nil, &raw); err != nil {
		return nil, err
	}
	out := make([]Transition, 0, len(raw.Transitions))
	for _, t := range raw.Transitions {
		out = append(out, Transition{ID: t.ID, Name: t.Name, To: t.To.Name})
	}
	return out, nil
}

// TransitionIssue mueve el issue aplicando una transición
// (POST /rest/api/3/issue/{key}/transitions). ESCRITURA.
func (c *Client) TransitionIssue(ctx context.Context, key, transitionID string) error {
	body := map[string]any{"transition": map[string]string{"id": transitionID}}
	return c.do(ctx, http.MethodPost, "/rest/api/3/issue/"+key+"/transitions", body, nil)
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
