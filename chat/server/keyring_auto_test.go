package main

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"creditop/my-tools/chat/cli"
)

func TestAskedNames(t *testing.T) {
	cases := map[string][]string{
		"🔑 Pido estas claves\n• shopify-admin-dev\n• vtex-key": {"shopify-admin-dev", "vtex-key"},
		"🔑 Pido la clave «shopify-admin-dev»":                  {"shopify-admin-dev"},
		"🔑 Pido las claves «a», «b»\n\npara probar":            {"a", "b"},
	}
	for text, want := range cases {
		if got := askedNames(text); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: got %v, want %v", text, got, want)
		}
	}
	if !askKeyringRe.MatchString("🔑 Pido tu llavero") || askKeysRe.MatchString("🔑 Pido tu llavero") {
		t.Error("el pedido de llavero se confunde con el de claves")
	}
}

func TestKeyringListText(t *testing.T) {
	if got := keyringListText([]string{"a", "b"}); got != "🔑 Mi llavero (2)\n• a\n• b" {
		t.Errorf("got %q", got)
	}
}

// El circuito entero con el envío cambiado: pedir el llavero da la lista; pedir claves da cada una encriptada y avisa
// la que no está; un grupo, un mensaje viejo o con el compartir apagado no contestan.
func TestAnswerKeyring(t *testing.T) {
	t.Setenv("CHAT_HISTORY_DIR", t.TempDir())
	p, _ := savedKeysPath()
	_ = writePrivate(p, []byte(`[{"name":"a","sealed":"U2FsdGVkX1AAA="},{"name":"b","sealed":"U2FsdGVkX1BBB="}]`))
	var sent []string
	old := sendMessage
	sendMessage = func(_ context.Context, to, text, re string) (cli.SendResult, error) {
		sent = append(sent, to+"|"+re+"|"+text)
		return cli.SendResult{}, nil
	}
	defer func() { sendMessage = old }()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	from := cli.Person{Email: "ana@creditop.com"}

	answerKeyring([]cli.Message{{ID: "1", Dir: "in", From: from, Time: now, Text: "🔑 Pido tu llavero"}})
	answerKeyring([]cli.Message{{ID: "2", Dir: "in", From: from, Time: now, Text: "🔑 Pido estas claves\n• b\n• z"}})
	answerKeyring([]cli.Message{{ID: "3", Dir: "in", From: from, Time: now, Text: "🔑 Pido tu llavero", Group: &cli.GroupRef{ID: "x"}}})
	answerKeyring([]cli.Message{{ID: "4", Dir: "in", From: from, Time: "2020-01-01T00:00:00Z", Text: "🔑 Pido tu llavero"}})
	want := []string{
		"ana@creditop.com|1|🔑 Mi llavero (2)\n• a\n• b",
		"ana@creditop.com|2|🔒 Llavero · 1 clave encriptada con la llave del equipo\nB=U2FsdGVkX1BBB=\n# no está en el llavero: z",
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("got %q\nwant %q", sent, want)
	}

	sp, _ := keyringSettingsPath()
	_ = writePrivate(sp, []byte(`{"autoShare":false}`))
	answerKeyring([]cli.Message{{ID: "5", Dir: "in", From: from, Time: now, Text: "🔑 Pido tu llavero"}})
	if len(sent) != 2 {
		t.Fatalf("con el compartir apagado contestó: %q", sent[2:])
	}
}

func TestEnvBlocks(t *testing.T) {
	if got := envName("shopify-admin.dev "); got != "SHOPIFY_ADMIN_DEV" {
		t.Errorf("envName: %q", got)
	}
	var keys []savedKey
	for i := 0; i < 60; i++ {
		keys = append(keys, savedKey{Name: fmt.Sprintf("clave-%02d", i), Sealed: "U2FsdGVkX1" + strings.Repeat("A", 40)})
	}
	blocks := envBlocks(keys, nil)
	total := 0
	for _, b := range blocks {
		if len([]rune(b)) > maxText {
			t.Fatalf("un bloque pasa el tope: %d", len([]rune(b)))
		}
		total += strings.Count(b, "=U2Fs")
	}
	if len(blocks) < 2 || total != 60 {
		t.Fatalf("bloques %d, claves %d", len(blocks), total)
	}
}
