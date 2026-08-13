package atlassian

import (
	"context"
	"encoding/json"
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

// IssueDetail es un issue con lo suficiente para REGISTRARLO como tarea local: además del resumen y el
// estado trae la categoría (para saber si ya está cerrado sin interpretar el nombre del estado, que en
// CORE lleva emoji y en QC no), las fechas, el sprint de origen y la descripción ya pasada a texto.
type IssueDetail struct {
	Key         string   `json:"key"`
	Project     string   `json:"project"`
	Type        string   `json:"type"`
	Summary     string   `json:"summary"`
	Status      string   `json:"status"`
	Category    string   `json:"category"` // new | indeterminate | done
	Created     string   `json:"created"`  // YYYY-MM-DD
	Updated     string   `json:"updated"`
	Resolved    string   `json:"resolved,omitempty"`
	Reporter    string   `json:"reporter,omitempty"`
	Sprints     []string `json:"sprints,omitempty"`
	Description string   `json:"description,omitempty"`
}

// searchDetailResp: la misma respuesta de /search/jql, con los campos que pide la importación.
type searchDetailResp struct {
	Issues []struct {
		Key    string `json:"key"`
		Fields struct {
			Summary     string                `json:"summary"`
			Description json.RawMessage       `json:"description"`
			Created     string                `json:"created"`
			Updated     string                `json:"updated"`
			Resolution  string                `json:"resolutiondate"`
			Project     struct{ Key string }  `json:"project"`
			IssueType   struct{ Name string } `json:"issuetype"`
			Reporter    struct {
				DisplayName string `json:"displayName"`
			} `json:"reporter"`
			Status struct {
				Name           string `json:"name"`
				StatusCategory struct {
					Key string `json:"key"`
				} `json:"statusCategory"`
			} `json:"status"`
			Sprints []issueSprintRef `json:"customfield_10020"`
		} `json:"fields"`
	} `json:"issues"`
	NextPageToken string `json:"nextPageToken"`
}

// SearchIssuesDetailed corre una JQL y devuelve TODAS las páginas. Solo lectura.
//
// Es una segunda lectura y no un parámetro de SearchIssues a propósito: esa la usa el conector MCP y
// devolver ahí quince campos por issue llenaría el contexto del modelo con ruido. Acá los campos son el
// punto — de ellos se arma el archivo de la tarea.
func (c *Client) SearchIssuesDetailed(ctx context.Context, jql string) ([]IssueDetail, error) {
	fields := []string{"summary", "description", "created", "updated", "resolutiondate",
		"project", "issuetype", "reporter", "status", "customfield_10020"}

	out := []IssueDetail{}
	page := ""
	// Tope de páginas por si la JQL es muy amplia: 20 × 100 = 2000 issues, más de lo que un registro
	// personal puede querer. Sin tope, una JQL mal escrita cuelga el handler.
	for i := 0; i < 20; i++ {
		body := map[string]any{"jql": jql, "maxResults": 100, "fields": fields}
		if page != "" {
			body["nextPageToken"] = page
		}
		var raw searchDetailResp
		if err := c.do(ctx, http.MethodPost, "/rest/api/3/search/jql", body, &raw); err != nil {
			return nil, err
		}
		for _, it := range raw.Issues {
			f := it.Fields
			d := IssueDetail{
				Key:         it.Key,
				Project:     f.Project.Key,
				Type:        f.IssueType.Name,
				Summary:     f.Summary,
				Status:      f.Status.Name,
				Category:    f.Status.StatusCategory.Key,
				Created:     soloFecha(f.Created),
				Updated:     soloFecha(f.Updated),
				Resolved:    soloFecha(f.Resolution),
				Reporter:    f.Reporter.DisplayName,
				Description: adfText(f.Description),
			}
			for _, s := range f.Sprints {
				if s.Name != "" {
					d.Sprints = append(d.Sprints, s.Name)
				}
			}
			out = append(out, d)
		}
		if page = raw.NextPageToken; page == "" {
			break
		}
	}
	return out, nil
}

// soloFecha recorta el timestamp ISO de Jira a YYYY-MM-DD: la hora no aporta nada al registro local y
// hace ruido en el frontmatter.
func soloFecha(s string) string {
	if len(s) < 10 {
		return ""
	}
	return s[:10]
}

// CreateIssueParams describe el issue a crear.
type CreateIssueParams struct {
	ProjectKey  string // ej "CORE"
	Summary     string
	IssueType   string // nombre del tipo, ej "Tarea" (usar si no hay ID)
	IssueTypeID string // id del tipo, ej "10005" (gana sobre IssueType; evita ambigüedad por nombres duplicados)
	AssigneeID  string // accountId (opcional)
	Description string // texto plano (opcional; se convierte a ADF)
	// Points setea Story Points si no es nil. Se manda EN LA CREACIÓN y no en un PUT aparte para que
	// la tarjeta no exista ni un instante sin estimación. ⚠ El id del campo es por instancia: acá es
	// el mismo `customfield_10036` que lee `MySprintIssues` en agile.go — si cambia, cambia en los dos.
	Points *float64
}

// StoryPointsField es el campo de Story Points de ESTA instancia de Jira (proyecto CORE).
// Vive acá para que la escritura y la lectura (`agile.go`) no puedan desincronizarse en silencio.
const StoryPointsField = "customfield_10036"

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
	if p.Points != nil {
		fields[StoryPointsField] = *p.Points
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

// FindTransitionTo elige, entre las transiciones disponibles DESDE EL ESTADO ACTUAL, la que lleva al
// estado cuyo nombre contiene `target` (case-insensitive). Solo lectura.
//
// Se busca por DESTINO y no por id ni por nombre de transición: el id cambia si alguien edita el
// workflow, y el nombre ("Enviar a pruebas") es prosa editable. Como último recurso también matchea el
// nombre, para que "prueba" siga encontrando la transición aunque renombren el estado.
//
// El error lista los destinos que SÍ hay: que la tarea ya esté en ese estado, o bloqueada, es
// información útil, no un fallo opaco. Lo comparten el handoff a QA del server y issue-transition.
func (c *Client) FindTransitionTo(ctx context.Context, key, target string) (Transition, error) {
	trs, err := c.IssueTransitions(ctx, key)
	if err != nil {
		return Transition{}, err
	}
	t := strings.ToLower(strings.TrimSpace(target))
	destinos := make([]string, 0, len(trs))
	for _, tr := range trs {
		if strings.Contains(strings.ToLower(tr.To), t) {
			return tr, nil
		}
		destinos = append(destinos, tr.To)
	}
	for _, tr := range trs {
		if strings.Contains(strings.ToLower(tr.Name), t) {
			return tr, nil
		}
	}
	return Transition{}, fmt.Errorf("desde su estado actual, %s no sale a %q; solo a: %s",
		key, target, strings.Join(destinos, ", "))
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
