package main

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"creditop/tablero/server/internal/slack"
)

// CreateChannelInput es lo que el modelo debe entregar para crear un canal.
// Los tags `jsonschema` se convierten en la descripción que ve el modelo.
type CreateChannelInput struct {
	Name      string `json:"name" jsonschema:"nombre del canal en minúsculas, sin espacios (ej: equipo-loan-origination)"`
	IsPrivate bool   `json:"is_private,omitempty" jsonschema:"true crea un canal privado; por defecto es público"`
}

// CreateChannelOutput es la salida estructurada que devuelve la tool.
type CreateChannelOutput struct {
	ChannelID string `json:"channel_id" jsonschema:"ID del canal creado (ej C0123ABCD)"`
	Name      string `json:"name" jsonschema:"nombre final del canal ya normalizado por Slack"`
}

// registerCreateChannel registra la tool slack_create_channel en el servidor.
func registerCreateChannel(server *mcp.Server, client *slack.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slack_create_channel",
		Description: "Crea un canal en Slack. Requiere el scope channels:manage (público) o groups:write (privado) en el bot token.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in CreateChannelInput) (*mcp.CallToolResult, CreateChannelOutput, error) {
		ch, err := client.CreateConversation(ctx, in.Name, in.IsPrivate)
		if err != nil {
			// Devolver el error como resultado de tool (isError) es más útil
			// para el modelo que un error de transporte.
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, CreateChannelOutput{}, nil
		}

		out := CreateChannelOutput{ChannelID: ch.ID, Name: ch.Name}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{
				Text: fmt.Sprintf("Canal #%s creado (id %s).", ch.Name, ch.ID),
			}},
		}, out, nil
	})
}

// PostMessageInput es lo que necesita enviar un mensaje.
type PostMessageInput struct {
	Channel string `json:"channel" jsonschema:"ID del canal (ej C0123ABCD) al que enviar. El bot debe ser miembro del canal."`
	Text    string `json:"text" jsonschema:"texto del mensaje"`
}

// PostMessageOutput confirma el envío.
type PostMessageOutput struct {
	Channel string `json:"channel"`
	TS      string `json:"ts" jsonschema:"timestamp/id del mensaje enviado"`
}

// registerPostMessage registra slack_post_message.
func registerPostMessage(server *mcp.Server, client *slack.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slack_post_message",
		Description: "Envía un mensaje de texto a un canal de Slack. El bot debe ser miembro del canal (en privados hay que invitarlo). Requiere el scope chat:write.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in PostMessageInput) (*mcp.CallToolResult, PostMessageOutput, error) {
		msg, err := client.PostMessage(ctx, in.Channel, in.Text)
		if err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, PostMessageOutput{}, nil
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{
				Text: fmt.Sprintf("Mensaje enviado al canal %s (ts %s).", msg.Channel, msg.TS),
			}},
		}, PostMessageOutput{Channel: msg.Channel, TS: msg.TS}, nil
	})
}

// ArchiveChannelInput identifica el canal a archivar.
type ArchiveChannelInput struct {
	ChannelID string `json:"channel_id" jsonschema:"ID del canal a archivar (ej C0123ABCD), no el nombre"`
}

// ArchiveChannelOutput confirma el archivado.
type ArchiveChannelOutput struct {
	Archived  bool   `json:"archived"`
	ChannelID string `json:"channel_id"`
}

// registerArchiveChannel registra slack_archive_channel.
func registerArchiveChannel(server *mcp.Server, client *slack.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "slack_archive_channel",
		Description: "Archiva un canal de Slack. Slack no permite BORRAR canales por API en workspaces normales; archivar es el equivalente reversible (queda oculto, se puede desarchivar). Requiere el scope channels:manage.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ArchiveChannelInput) (*mcp.CallToolResult, ArchiveChannelOutput, error) {
		if err := client.ArchiveConversation(ctx, in.ChannelID); err != nil {
			return &mcp.CallToolResult{
				IsError: true,
				Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}},
			}, ArchiveChannelOutput{}, nil
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{
				Text: fmt.Sprintf("Canal %s archivado.", in.ChannelID),
			}},
		}, ArchiveChannelOutput{Archived: true, ChannelID: in.ChannelID}, nil
	})
}
