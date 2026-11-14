package main

import (
	"os"
	"strings"
	"testing"
	"time"

	"creditop/my-tools/connectors/gmail"
)

// Corre de verdad contra `claude -p` (unos 20 s y centavos): sólo con CORREO_LIVE=1. Es la vara del borrador: con un
// pedido de ellos al final, tiene que proponer una respuesta en el idioma del hilo y su traducción.
func TestLiveTheyAskSoThereIsADraftInTheirLanguage(t *testing.T) {
	if os.Getenv("CORREO_LIVE") != "1" {
		t.Skip("CORREO_LIVE=1 para correrlo contra claude -p")
	}
	now := time.Now()
	me := "miguel@creditop.com"
	msgs := []gmail.Message{
		{ID: "a", Subject: "[VTEX] Homologation request", From: "Miguel <" + me + ">", Date: now.Add(-48 * time.Hour),
			Body: "Hi team, we'd like to start the homologation of our PPF connector creditop.creditop v5.2.0. Thanks, Miguel"},
		{ID: "b", Subject: "[VTEX] Re: Homologation request", From: "Juan Alzate (VTEX) <support@vtexhelp.zendesk.com>", Date: now.Add(-time.Hour),
			Body: "Hi Miguel, thanks. To continue we need two things: could you confirm which Service URL we should validate against, and could you send us the signed MPA? Best, Juan"},
	}
	g, err := digest("t", msgs, me)
	if err != nil {
		t.Fatal(err)
	}
	if !g.Reply || g.Draft == "" || g.DraftEs == "" {
		t.Fatalf("tenía que proponer respuesta: reply=%v why=%q draft=%q es=%q", g.Reply, g.ReplyWhy, g.Draft, g.DraftEs)
	}
	if !strings.Contains(strings.ToLower(g.Draft), "service url") {
		t.Errorf("el borrador va en el idioma del hilo y contesta lo pedido: %q", g.Draft)
	}
	t.Logf("por qué: %s\n--- borrador ---\n%s\n--- en español ---\n%s", g.ReplyWhy, g.Draft, g.DraftEs)
}
