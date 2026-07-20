package slack

import (
	"context"
	"fmt"
)

// PostedMessage identifica un mensaje ya enviado.
type PostedMessage struct {
	Channel string `json:"channel"`
	TS      string `json:"ts"`
}

// postMessageResp: respuesta de chat.postMessage.
type postMessageResp struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Channel string `json:"channel"`
	TS      string `json:"ts"`
}

// PostMessage envía un mensaje de texto a un canal (chat.postMessage).
//
// El bot debe ser MIEMBRO del canal: en canales privados hay que invitarlo
// (/invite @tu-bot). Scope requerido: chat:write.
func (c *Client) PostMessage(ctx context.Context, channel, text string) (*PostedMessage, error) {
	body := map[string]any{
		"channel": channel,
		"text":    text,
	}

	var out postMessageResp
	if err := c.post(ctx, "chat.postMessage", body, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("Slack rechazó el envío al canal %q: %s", channel, out.Error)
	}
	return &PostedMessage{Channel: out.Channel, TS: out.TS}, nil
}
