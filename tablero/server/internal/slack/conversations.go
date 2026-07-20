package slack

import (
	"context"
	"fmt"
	"strings"
)

// Channel es la representación mínima de un canal que nos interesa.
type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// createResp: respuesta de conversations.create.
type createResp struct {
	OK      bool     `json:"ok"`
	Error   string   `json:"error"`
	Channel *Channel `json:"channel"`
}

// okResp: respuesta genérica de endpoints que solo devuelven ok/error
// (ej. conversations.archive).
type okResp struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// NormalizeChannelName ajusta un nombre libre a las reglas de Slack:
// minúsculas, sin espacios, solo letras (a-z), números, guion y underscore,
// máximo 80 caracteres. Ej: "Prueba Canal" -> "prueba-canal".
func NormalizeChannelName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))

	var b strings.Builder
	lastHyphen := false
	for _, r := range name {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_':
			b.WriteRune(r)
			lastHyphen = false
		default:
			// espacios y cualquier otro carácter -> un solo guion
			if !lastHyphen && b.Len() > 0 {
				b.WriteByte('-')
				lastHyphen = true
			}
		}
	}

	out := strings.Trim(b.String(), "-")
	if len(out) > 80 {
		out = strings.Trim(out[:80], "-")
	}
	return out
}

// CreateConversation crea un canal (endpoint conversations.create).
// El nombre se normaliza antes de enviarlo. Scope: channels:manage (público)
// o groups:write (privado).
func (c *Client) CreateConversation(ctx context.Context, name string, isPrivate bool) (*Channel, error) {
	clean := NormalizeChannelName(name)
	if clean == "" {
		return nil, fmt.Errorf("nombre de canal inválido: %q", name)
	}

	body := map[string]any{
		"name":       clean,
		"is_private": isPrivate,
	}

	var out createResp
	if err := c.post(ctx, "conversations.create", body, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("Slack rechazó la creación del canal %q: %s", clean, out.Error)
	}
	return out.Channel, nil
}

// ArchiveConversation archiva un canal (endpoint conversations.archive).
//
// OJO: Slack NO permite BORRAR canales por API en un workspace normal.
// Archivar es el equivalente reversible: el canal queda oculto y se puede
// desarchivar. El borrado real solo existe en Enterprise Grid vía
// admin.conversations.delete (con token de admin). Scope: channels:manage.
func (c *Client) ArchiveConversation(ctx context.Context, channelID string) error {
	body := map[string]any{"channel": channelID}

	var out okResp
	if err := c.post(ctx, "conversations.archive", body, &out); err != nil {
		return err
	}
	if !out.OK {
		return fmt.Errorf("Slack rechazó archivar el canal %q: %s", channelID, out.Error)
	}
	return nil
}
