package main

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/tools/server/internal/atlassian"
)

// --- jira_myself ---

// MyselfInput no lleva parámetros.
type MyselfInput struct{}

// MyselfOutput es el usuario autenticado.
type MyselfOutput struct {
	AccountID   string `json:"account_id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
}

func registerMyself(server *mcp.Server, client *atlassian.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "jira_myself",
		Description: "Devuelve el usuario autenticado en Jira. Útil para validar las credenciales. Solo lectura.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ MyselfInput) (*mcp.CallToolResult, MyselfOutput, error) {
		me, err := client.GetMyself(ctx)
		if err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, MyselfOutput{}, nil
		}
		out := MyselfOutput{AccountID: me.AccountID, DisplayName: me.DisplayName, Email: me.EmailAddress}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{
				Text: fmt.Sprintf("Autenticado como %s <%s>", me.DisplayName, me.EmailAddress),
			}},
		}, out, nil
	})
}

// --- jira_search_issues ---

// SearchInput es la consulta JQL.
type SearchInput struct {
	JQL        string `json:"jql" jsonschema:"consulta JQL. DEBE incluir al menos una restricción (el endpoint no permite JQL ilimitadas). Ej: project = CORE AND created >= -30d ORDER BY created DESC"`
	MaxResults int    `json:"max_results,omitempty" jsonschema:"máximo de resultados (1-100, por defecto 25)"`
}

// SearchIssue es un issue en la salida.
type SearchIssue struct {
	Key     string `json:"key"`
	Summary string `json:"summary"`
	Status  string `json:"status"`
}

// SearchOutput es el resultado de la búsqueda.
type SearchOutput struct {
	Count  int           `json:"count"`
	Issues []SearchIssue `json:"issues"`
}

func registerSearchIssues(server *mcp.Server, client *atlassian.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "jira_search_issues",
		Description: "Busca issues en Jira con una consulta JQL (endpoint /rest/api/3/search/jql). La JQL debe incluir al menos una restricción (no se permiten consultas ilimitadas). Solo lectura.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in SearchInput) (*mcp.CallToolResult, SearchOutput, error) {
		found, err := client.SearchIssues(ctx, in.JQL, in.MaxResults)
		if err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, SearchOutput{}, nil
		}

		issues := make([]SearchIssue, 0, len(found))
		var b strings.Builder
		fmt.Fprintf(&b, "%d issue(s):\n", len(found))
		for _, it := range found {
			issues = append(issues, SearchIssue{Key: it.Key, Summary: it.Summary, Status: it.Status})
			fmt.Fprintf(&b, "  %s  [%s]  %s\n", it.Key, it.Status, it.Summary)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: strings.TrimRight(b.String(), "\n")}},
		}, SearchOutput{Count: len(issues), Issues: issues}, nil
	})
}

// --- jira_create_issue (ESCRITURA) ---

// CreateIssueInput describe el issue a crear.
type CreateIssueInput struct {
	ProjectKey  string `json:"project_key" jsonschema:"clave del proyecto, ej CORE"`
	Summary     string `json:"summary" jsonschema:"título/resumen del issue"`
	IssueType   string `json:"issue_type,omitempty" jsonschema:"nombre del tipo de issue (ej Tarea); por defecto Task. Ignorado si se da issue_type_id"`
	IssueTypeID string `json:"issue_type_id,omitempty" jsonschema:"id del tipo de issue (ej 10005); recomendado cuando hay nombres duplicados"`
	AssigneeID  string `json:"assignee_account_id,omitempty" jsonschema:"accountId del asignado (opcional)"`
	Description string `json:"description,omitempty" jsonschema:"descripción en texto plano (opcional)"`
	BoardID     int    `json:"board_id,omitempty" jsonschema:"si se da, tras crear el issue lo agrega al sprint ACTIVO de ese board (ej 384)"`
}

// CreateIssueOutput confirma la creación.
type CreateIssueOutput struct {
	Key    string `json:"key"`
	ID     string `json:"id"`
	Sprint string `json:"sprint,omitempty"`
}

func registerCreateIssue(server *mcp.Server, client *atlassian.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "jira_create_issue",
		Description: "Crea un issue en Jira (POST /rest/api/3/issue). ESCRITURA. Si se pasa board_id, además lo agrega al sprint activo de ese board.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in CreateIssueInput) (*mcp.CallToolResult, CreateIssueOutput, error) {
		issueType := in.IssueType
		if issueType == "" {
			issueType = "Task"
		}
		created, err := client.CreateIssue(ctx, atlassian.CreateIssueParams{
			ProjectKey:  in.ProjectKey,
			Summary:     in.Summary,
			IssueType:   issueType,
			IssueTypeID: in.IssueTypeID,
			AssigneeID:  in.AssigneeID,
			Description: in.Description,
		})
		if err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, CreateIssueOutput{}, nil
		}

		out := CreateIssueOutput{Key: created.Key, ID: created.ID}
		note := ""
		if in.BoardID > 0 {
			sp, serr := client.ActiveSprint(ctx, in.BoardID)
			if serr != nil {
				note = fmt.Sprintf(" (creado, pero no se pudo resolver el sprint activo: %v)", serr)
			} else if aerr := client.AddIssuesToSprint(ctx, sp.ID, []string{created.Key}); aerr != nil {
				note = fmt.Sprintf(" (creado, pero no se pudo agregar al sprint %q: %v)", sp.Name, aerr)
			} else {
				out.Sprint = sp.Name
				note = fmt.Sprintf(" y agregado al sprint activo %q", sp.Name)
			}
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{
				Text: fmt.Sprintf("Issue %s creado%s.", created.Key, note),
			}},
		}, out, nil
	})
}

// --- jira_delete_issue (ESCRITURA, irreversible) ---

// DeleteIssueInput identifica el issue a borrar.
type DeleteIssueInput struct {
	Key string `json:"key" jsonschema:"clave del issue a borrar, ej CORE-210"`
}

// DeleteIssueOutput confirma el borrado.
type DeleteIssueOutput struct {
	Deleted bool   `json:"deleted"`
	Key     string `json:"key"`
}

func registerDeleteIssue(server *mcp.Server, client *atlassian.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "jira_delete_issue",
		Description: "Borra un issue de Jira (DELETE /rest/api/3/issue/{key}). ESCRITURA IRREVERSIBLE.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in DeleteIssueInput) (*mcp.CallToolResult, DeleteIssueOutput, error) {
		if err := client.DeleteIssue(ctx, in.Key); err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, DeleteIssueOutput{}, nil
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("Issue %s borrado.", in.Key)}},
		}, DeleteIssueOutput{Deleted: true, Key: in.Key}, nil
	})
}
