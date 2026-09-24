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

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/playground/connectors/atlassian"
	"creditop/playground/tablero/server/internal/env"
)

func main() {
	log.SetFlags(0)
	log.SetPrefix("[jira-mcp] ")

	env.LoadDefaults()

	cfg, err := atlassian.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}
	client := atlassian.NewFromConfig(cfg)

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
