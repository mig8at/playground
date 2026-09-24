package slack

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// Message es la vista mínima de un mensaje de un canal. Sólo lectura: nada de acá escribe.
type Message struct {
	TS    string `json:"ts"`
	User  string `json:"user"`
	Text  string `json:"text"`
	BotID string `json:"bot_id"`
	// ReplyCount: cuántas respuestas tiene el hilo. Un mensaje sin respuestas nunca se contestó ahí.
	ReplyCount int `json:"reply_count"`
}

type messagesResp struct {
	OK       bool      `json:"ok"`
	Error    string    `json:"error"`
	Messages []Message `json:"messages"`
	Meta     struct {
		NextCursor string `json:"next_cursor"`
	} `json:"response_metadata"`
}

// History trae los mensajes de un canal desde `oldest`, de a 200 por página y hasta `maxPages`
// páginas (conversations.history). Scope requerido: channels:history.
//
// ⚠ El tope de páginas es un corte, no un error: si el canal tiene más, lo que falta NO aparece. Quien
// llama elige el tope sabiendo cuántos mensajes entran (200 × maxPages).
func (c *Client) History(ctx context.Context, channel string, oldest time.Time, maxPages int) ([]Message, error) {
	var all []Message
	cursor := ""
	for page := 0; page < maxPages; page++ {
		params := url.Values{
			"channel": {channel},
			"limit":   {"200"},
			"oldest":  {strconv.FormatInt(oldest.Unix(), 10)},
		}
		if cursor != "" {
			params.Set("cursor", cursor)
		}
		var out messagesResp
		if err := c.get(ctx, "conversations.history", params, &out); err != nil {
			return nil, err
		}
		if !out.OK {
			return nil, fmt.Errorf("slack: %s", out.Error)
		}
		all = append(all, out.Messages...)
		cursor = out.Meta.NextCursor
		if cursor == "" {
			break
		}
	}
	return all, nil
}

// Replies trae las RESPUESTAS de un mensaje, sin el mensaje original (conversations.replies).
// Scope requerido: channels:history.
func (c *Client) Replies(ctx context.Context, channel, ts string, limit int) ([]Message, error) {
	params := url.Values{"channel": {channel}, "ts": {ts}, "limit": {strconv.Itoa(limit)}}
	var out messagesResp
	if err := c.get(ctx, "conversations.replies", params, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("slack replies: %s", out.Error)
	}
	// La primera es el mensaje original; las respuestas son el resto.
	if len(out.Messages) > 0 {
		return out.Messages[1:], nil
	}
	return nil, nil
}
