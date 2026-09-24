package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"

	"creditop/playground/connectors/atlassian"
)

// Jira por el conector de Atlassian. Lo que hacían `jira-mcp` y sus herramientas, ahora como comandos
// de pg: se usan igual desde la consola y desde el MCP, y las escrituras muestran antes de hacer.

// issueKey: la forma de una clave de Jira. Se valida antes de ponerla en una JQL.
var issueKey = regexp.MustCompile(`^[A-Z][A-Z0-9]+-[0-9]+$`)

func jira() (*atlassian.Client, string, int) {
	c, err := atlassian.LoadConfig()
	if err != nil {
		return nil, "", fail(2, "%v", err)
	}
	return atlassian.NewFromConfig(c), c.Site, 0
}

func runJiraMyself(args []string) int {
	cl, _, code := jira()
	if cl == nil {
		return code
	}
	me, err := cl.GetMyself(context.Background())
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("Autenticado como %s <%s> · accountId %s\n", me.DisplayName, me.EmailAddress, me.AccountID)
	return 0
}

func runJiraSearch(args []string) int {
	fs := flag.NewFlagSet("jira search", flag.ContinueOnError)
	jql := fs.String("jql", "", "JQL con al menos una restricción")
	max := fs.Int("max", 25, "máximo de resultados (1-100)")
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*jql) == "" {
		return fail(2, "falta --jql")
	}
	cl, _, code := jira()
	if cl == nil {
		return code
	}
	found, err := cl.SearchIssues(context.Background(), *jql, *max)
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("%d issue(s):\n", len(found))
	for _, it := range found {
		fmt.Printf("  %s  [%s]  %s\n", it.Key, it.Status, it.Summary)
	}
	return 0
}

func runJiraCreate(args []string) int {
	fs := flag.NewFlagSet("jira create", flag.ContinueOnError)
	summary := fs.String("summary", "", "el título")
	description := fs.String("description", "", "la descripción, en Markdown")
	project := fs.String("project", "CORE", "la clave del proyecto")
	issueType := fs.String("type", "Task", "el nombre del tipo de issue")
	typeID := fs.String("type-id", "", "el id del tipo (gana sobre --type)")
	assignee := fs.String("assignee", "", "accountId del asignado")
	board := fs.Int("board", 0, "board cuyo sprint activo recibe el issue")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	if strings.TrimSpace(*summary) == "" {
		return fail(2, "falta --summary")
	}
	if code := guarded(*summary, *description); code != 0 {
		return code
	}
	cl, site, code := jira()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	// El sprint se resuelve ANTES de crear: si el board no tiene sprint activo, se ve en la vista previa
	// y no con el issue ya creado y suelto.
	var sprint *atlassian.Sprint
	if *board > 0 {
		sp, err := cl.ActiveSprint(ctx, *board)
		if err != nil {
			return fail(1, "no pude resolver el sprint activo del board %d: %v", *board, err)
		}
		sprint = sp
	}
	kind := *issueType
	if *typeID != "" {
		kind = "id " + *typeID
	}
	fmt.Printf("  Va a CREARSE en Jira (%s):\n", site)
	fmt.Printf("    proyecto    %s · tipo %s\n", *project, kind)
	fmt.Printf("    título      %s\n", *summary)
	fmt.Printf("    descripción %d caracteres\n", len(*description))
	if sprint != nil {
		fmt.Printf("    sprint      %s (activo del board %d)\n", sprint.Name, *board)
	} else {
		fmt.Printf("    sprint      (ninguno: queda en el backlog)\n")
	}
	if !*apply {
		return dryRun()
	}
	created, err := cl.CreateIssue(ctx, atlassian.CreateIssueParams{
		ProjectKey: *project, Summary: *summary, IssueType: *issueType, IssueTypeID: *typeID,
		AssigneeID: *assignee, Description: *description,
	})
	if err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("\n  %s creado · %s/browse/%s\n", created.Key, strings.TrimRight(site, "/"), created.Key)
	if sprint != nil {
		if err := cl.AddIssuesToSprint(ctx, sprint.ID, []string{created.Key}); err != nil {
			fmt.Fprintf(os.Stderr, "pg: %s quedó creado, pero no entró al sprint %q: %v\n", created.Key, sprint.Name, err)
			return 1
		}
		fmt.Printf("  y agregado al sprint %q\n", sprint.Name)
	}
	return 0
}

func runJiraDelete(args []string) int {
	fs := flag.NewFlagSet("jira delete", flag.ContinueOnError)
	key := fs.String("key", "", "la clave del issue")
	apply := applyFlag(fs)
	if fs.Parse(args) != nil {
		return 2
	}
	k := strings.ToUpper(strings.TrimSpace(*key))
	if !issueKey.MatchString(k) {
		return fail(2, "--key tiene que ser una clave de issue, ej. CORE-210 (dio %q)", *key)
	}
	cl, site, code := jira()
	if cl == nil {
		return code
	}
	ctx := context.Background()
	// Se muestra QUÉ se borra, leído de Jira: borrar por una clave tipeada mal es borrar otra tarjeta.
	found, err := cl.SearchIssues(ctx, "key = "+k, 1)
	if err != nil {
		return fail(1, "%v", err)
	}
	if len(found) == 0 {
		return fail(1, "no existe %s en %s", k, site)
	}
	fmt.Printf("  Va a BORRARSE de Jira (%s), sin vuelta atrás:\n", site)
	fmt.Printf("    %s  [%s]  %s\n", found[0].Key, found[0].Status, found[0].Summary)
	if !*apply {
		return dryRun()
	}
	if err := cl.DeleteIssue(ctx, k); err != nil {
		return fail(1, "%v", err)
	}
	fmt.Printf("\n  %s borrado\n", k)
	return 0
}
