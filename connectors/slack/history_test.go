package slack

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// History sigue el cursor hasta que Slack deja de mandarlo, y respeta el tope de páginas.
// Replies devuelve las respuestas sin el mensaje original, que Slack manda primero.
func TestHistoryFollowsTheCursorAndRepliesDropTheOriginal(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer xoxb-test" {
			t.Errorf("falta el token: %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/conversations.history":
			calls++
			if r.URL.Query().Get("oldest") != "1700000000" {
				t.Errorf("oldest = %q", r.URL.Query().Get("oldest"))
			}
			next := ""
			if r.URL.Query().Get("cursor") == "" {
				next = "p2"
			}
			fmt.Fprintf(w, `{"ok":true,"messages":[{"ts":"%d.1","text":"m%d","reply_count":2}],"response_metadata":{"next_cursor":"%s"}}`, calls, calls, next)
		case "/conversations.replies":
			fmt.Fprint(w, `{"ok":true,"messages":[{"ts":"1.1","text":"original"},{"ts":"1.2","text":"respuesta"}]}`)
		default:
			fmt.Fprint(w, `{"ok":false,"error":"unknown_method"}`)
		}
	}))
	defer srv.Close()
	old := apiBase
	apiBase = srv.URL
	defer func() { apiBase = old }()

	c := New("xoxb-test")
	ctx := context.Background()
	msgs, err := c.History(ctx, "C1", time.Unix(1700000000, 0), 12)
	if err != nil || len(msgs) != 2 || msgs[1].Text != "m2" || msgs[0].ReplyCount != 2 {
		t.Fatalf("History = %+v, %v; quería las dos páginas", msgs, err)
	}
	calls = 0
	if msgs, _ := c.History(ctx, "C1", time.Unix(1700000000, 0), 1); len(msgs) != 1 {
		t.Errorf("con maxPages=1 tenía que cortar en una página; trajo %d", len(msgs))
	}
	replies, err := c.Replies(ctx, "C1", "1.1", 60)
	if err != nil || len(replies) != 1 || replies[0].Text != "respuesta" {
		t.Errorf("Replies = %+v, %v; quería sólo la respuesta", replies, err)
	}
	if _, err := c.Replies(ctx, "C1", "", 1); err != nil {
		t.Errorf("Replies: %v", err)
	}
}
