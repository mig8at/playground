// Command slack-mcp es un servidor MCP propio (stdio) que expone tools de Slack.
//
// Uso:
//
//	SLACK_BOT_TOKEN=xoxb-... go run ./cmd/slack-mcp
//
// o registrándolo en Claude Code (ver README).
package main

import (
	"context"
	"log"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/playground/connectors/slack"
	"creditop/playground/tablero/server/internal/env"
)

func main() {
	// Los logs van a stderr: stdout está reservado para el protocolo MCP.
	log.SetFlags(0)
	log.SetPrefix("[slack-mcp] ")

	// Carga .env (cwd o junto al binario); no pisa variables ya definidas.
	env.LoadDefaults()

	cfg, err := slack.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}
	client, err := cfg.Bot()
	if err != nil {
		log.Fatal(err)
	}

	server := mcp.NewServer(&mcp.Implementation{
		Name:    "creditop-tools",
		Version: "0.1.0",
	}, nil)

	// Aquí se registran las tools. Cada una vive en su propia función en tools.go.
	registerCreateChannel(server, client)
	registerArchiveChannel(server, client)
	registerPostMessage(server, client)

	log.Println("iniciado; esperando peticiones MCP por stdio…")
	if err := server.Run(context.Background(), &mcp.StdioTransport{}); err != nil {
		log.Fatalf("el servidor terminó con error: %v", err)
	}
}
