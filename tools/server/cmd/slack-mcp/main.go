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
	"os"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/tools/server/internal/env"
	"creditop/tools/server/internal/slack"
)

func main() {
	// Los logs van a stderr: stdout está reservado para el protocolo MCP.
	log.SetFlags(0)
	log.SetPrefix("[slack-mcp] ")

	// Carga .env (cwd o junto al binario); no pisa variables ya definidas.
	env.LoadDefaults()

	token := os.Getenv("SLACK_BOT_TOKEN")
	if token == "" {
		log.Fatal("falta la variable de entorno SLACK_BOT_TOKEN (bot token xoxb-...)")
	}

	client := slack.New(token)

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
