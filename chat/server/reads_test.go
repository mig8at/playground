package main

import (
	"testing"
	"time"

	"creditop/playground/chat/cli"
)

// Lo leído sólo avanza, y el buzón cuenta lo sin leer y las menciones como lo verían la app y bin/chat.
func TestReadsAndInbox(t *testing.T) {
	t.Setenv("CHAT_HISTORY_DIR", t.TempDir())
	reads = nil
	h, err := openHistory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	prev := chatHistory
	chatHistory = h
	defer func() { chatHistory = prev; reads = nil }()

	at := func(min int) string {
		return time.Date(2026, 11, 10, 12, min, 0, 0, time.UTC).Format(time.RFC3339Nano)
	}
	duncan := cli.Person{Email: "duncan.estrada@creditop.com", Name: "Duncan"}
	group := &cli.GroupRef{ID: "shopify"}
	if _, err := h.add([]cli.Message{
		{ID: "1", Dir: "in", From: duncan, Text: "hola", Time: at(1)},
		{ID: "2", Dir: "in", From: duncan, Text: "¿lo viste?", Time: at(2)},
		{ID: "3", Dir: "in", From: duncan, Text: "arranquemos", Time: at(3), Group: group},
		{ID: "4", Dir: "in", From: duncan, Text: "@miguel mirá esto", Time: at(4), Group: group},
		{ID: "5", Dir: "out", To: "#shopify", Text: "voy", Time: at(5)},
	}); err != nil {
		t.Fatal(err)
	}
	who := me{user: "miguel", email: "miguel@creditop.com"}

	box := map[string]inboxRow{}
	for _, r := range inbox(who) {
		box[r.Key] = r
	}
	if r := box["duncan.estrada@creditop.com"]; r.Unread != 2 || r.Mentions != 0 {
		t.Errorf("directo: %d sin leer, %d menciones", r.Unread, r.Mentions)
	}
	if r := box["#shopify"]; r.Unread != 2 || r.Mentions != 1 || r.Last.ID != "5" {
		t.Errorf("grupo: %d sin leer, %d menciones, último %s", r.Unread, r.Mentions, r.Last.ID)
	}
	if got := mentionsOf(who, false); len(got) != 1 || got[0].ID != "4" || got[0].With != "#shopify" {
		t.Errorf("menciones sin leer: %+v", got)
	}

	if _, changed, err := markRead("Duncan.Estrada@creditop.com", at(1)); err != nil || !changed {
		t.Fatalf("marcar: %v %v", changed, err)
	}
	if _, changed, _ := markRead("duncan.estrada@creditop.com", at(0)); changed {
		t.Error("marcar algo más viejo no debería volver atrás")
	}
	if _, _, err := markRead("x", "ayer"); err == nil {
		t.Error("una hora inválida debería fallar")
	}
	if _, _, err := markRead("#shopify", at(4)); err != nil {
		t.Fatal(err)
	}
	for _, r := range inbox(who) {
		if r.Key == "duncan.estrada@creditop.com" && r.Unread != 1 {
			t.Errorf("directo después de leer hasta el 1: %d sin leer", r.Unread)
		}
		if r.Key == "#shopify" && (r.Unread != 0 || r.Mentions != 0) {
			t.Errorf("grupo leído: %d sin leer, %d menciones", r.Unread, r.Mentions)
		}
	}
	if got := mentionsOf(who, false); len(got) != 0 {
		t.Errorf("leída la mención, quedaron %d", len(got))
	}
	if got := mentionsOf(who, true); len(got) != 1 {
		t.Errorf("con --all deberían seguir: %d", len(got))
	}

	// Lo guardado sobrevive a un reinicio.
	reads = nil
	if readsSnapshot()["#shopify"] != at(4) {
		t.Error("lo leído no quedó en disco")
	}
}
