package slack

import (
	"errors"

	"creditop/playground/connectors/env"
)

// Config son los dos tokens de Slack. Son de dos identidades distintas y sirven para cosas distintas:
// el del BOT (xoxb-) es con el que la app escribe y lee lo que la invitaron a ver; el del USUARIO (xoxp-)
// actúa como la persona, que es lo que hace falta para mandarle un mensaje a otro a su nombre.
type Config struct {
	BotToken, UserToken string
	File                string
}

// LoadConfig lee `SLACK_BOT_TOKEN` y `SLACK_USER_TOKEN` de `connectors/.env` (el proceso gana). Que falte
// uno no es un error acá: lo dice quien lo necesita (ver Bot y User).
func LoadConfig() (Config, error) {
	v, err := env.LoadShared()
	if err != nil {
		return Config{}, err
	}
	return Config{BotToken: v.Get("SLACK_BOT_TOKEN"), UserToken: v.Get("SLACK_USER_TOKEN"), File: v.File}, nil
}

// ErrNoBotToken y ErrNoUserToken dicen qué falta y dónde va.
var (
	ErrNoBotToken  = errors.New("falta SLACK_BOT_TOKEN (bot token xoxb-…) en connectors/.env")
	ErrNoUserToken = errors.New("falta SLACK_USER_TOKEN (user token xoxp-…) en connectors/.env")
)

// Bot arma el cliente con el token del bot.
func (c Config) Bot() (*Client, error) {
	if c.BotToken == "" {
		return nil, ErrNoBotToken
	}
	return New(c.BotToken), nil
}

// User arma el cliente con el token del usuario.
func (c Config) User() (*Client, error) {
	if c.UserToken == "" {
		return nil, ErrNoUserToken
	}
	return New(c.UserToken), nil
}
