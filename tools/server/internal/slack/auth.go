package slack

import (
	"context"
	"fmt"
)

// AuthInfo es el resultado de auth.test (identidad del bot).
type AuthInfo struct {
	User string `json:"user"`
	Team string `json:"team"`
}

type authTestResp struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	User  string `json:"user"`
	Team  string `json:"team"`
}

// AuthTest valida el token y devuelve el bot/workspace (endpoint auth.test).
func (c *Client) AuthTest(ctx context.Context) (*AuthInfo, error) {
	var out authTestResp
	if err := c.post(ctx, "auth.test", map[string]any{}, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("slack auth.test: %s", out.Error)
	}
	return &AuthInfo{User: out.User, Team: out.Team}, nil
}
