package atlassian

import (
	"fmt"
	"strings"

	"creditop/playground/connectors/env"
)

// Config es a qué Atlassian hablarle. Jira y Confluence comparten sitio, cuenta y token: son el mismo
// conector con dos partes, y un token de Atlassian sirve para las dos.
type Config struct {
	Site, Email, Token string
	File               string // de dónde salió, para decirlo en un error
}

// LoadConfig lee `ATLASSIAN_SITE`, `ATLASSIAN_EMAIL` y `ATLASSIAN_API_TOKEN` de `connectors/.env` (el
// proceso gana). Atlassian no tiene ambientes: es un sitio solo.
func LoadConfig() (Config, error) {
	v, err := env.LoadShared()
	if err != nil {
		return Config{}, err
	}
	c := Config{Site: strings.TrimRight(v.Get("ATLASSIAN_SITE"), "/"), Email: v.Get("ATLASSIAN_EMAIL"),
		Token: v.Get("ATLASSIAN_API_TOKEN"), File: v.File}
	var missing []string
	for _, f := range []struct{ key, value string }{
		{"ATLASSIAN_SITE", c.Site}, {"ATLASSIAN_EMAIL", c.Email}, {"ATLASSIAN_API_TOKEN", c.Token},
	} {
		if f.value == "" {
			missing = append(missing, f.key)
		}
	}
	if len(missing) > 0 {
		return c, fmt.Errorf("faltan en connectors/.env: %s", strings.Join(missing, ", "))
	}
	return c, nil
}

// NewFromConfig arma el cliente.
func NewFromConfig(c Config) *Client { return New(c.Site, c.Email, c.Token) }
