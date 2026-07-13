// Command jira-mcp es un servidor MCP (stdio) que expone tools de Jira Cloud.
//
// Requiere en el entorno (o en .env):
//
//	ATLASSIAN_SITE       https://<tu-sitio>.atlassian.net
//	ATLASSIAN_EMAIL      tu email de Atlassian
//	ATLASSIAN_API_TOKEN  token de id.atlassian.com/manage-profile/security/api-tokens
package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/tools/server/internal/atlassian"
	"creditop/tools/server/internal/env"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[jira-mcp] ")

	env.LoadDefaults()

	site := os.Getenv("ATLASSIAN_SITE")
	email := os.Getenv("ATLASSIAN_EMAIL")
	token := os.Getenv("ATLASSIAN_API_TOKEN")

	var missing []string
	if site == "" {
		missing = append(missing, "ATLASSIAN_SITE")
	}
	if email == "" {
		missing = append(missing, "ATLASSIAN_EMAIL")
	}
	if token == "" {
		missing = append(missing, "ATLASSIAN_API_TOKEN")
	}
	if len(missing) > 0 {
		log.Fatalf("faltan variables de entorno: %s", strings.Join(missing, ", "))
	}

	client := atlassian.New(site, email, token)

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "creditop-jira",
		Version: "0.1.0",
	}, nil)

	registerMyself(server, client)
	registerSearchIssues(server, client)
	registerCreateIssue(server, client)
	registerDeleteIssue(server, client)

	log.Println("iniciado; esperando peticiones MCP por stdio…")
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("el servidor terminó con error: %v", err)
	}
}
