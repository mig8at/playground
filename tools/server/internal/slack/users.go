package slack

import (
	"context"
	"fmt"
	"net/url"
)

// User es la vista mínima de un usuario de Slack.
type User struct {
	ID       string `json:"id"`
	Name     string `json:"name"`      // handle (@name)
	RealName string `json:"real_name"` // nombre completo
}

type userResp struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	User  *User  `json:"user"`
}

// LookupUserByEmail busca un usuario por email (users.lookupByEmail).
// Scope requerido: users:read.email
func (c *Client) LookupUserByEmail(ctx context.Context, email string) (*User, error) {
	var out userResp
	if err := c.get(ctx, "users.lookupByEmail", url.Values{"email": {email}}, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("no se encontró usuario con email %q: %s", email, out.Error)
	}
	return out.User, nil
}

type openDMResp struct {
	OK      bool   `json:"ok"`
	Error   string `json:"error"`
	Channel struct {
		ID string `json:"id"`
	} `json:"channel"`
}

// OpenDM abre (o recupera) el canal de mensaje directo con un usuario y devuelve
// su ID de canal (conversations.open). Scope requerido: im:write
func (c *Client) OpenDM(ctx context.Context, userID string) (string, error) {
	var out openDMResp
	if err := c.post(ctx, "conversations.open", map[string]any{"users": userID}, &out); err != nil {
		return "", err
	}
	if !out.OK {
		return "", fmt.Errorf("no se pudo abrir el DM con %q: %s", userID, out.Error)
	}
	return out.Channel.ID, nil
}
