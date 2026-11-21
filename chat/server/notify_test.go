package main

import (
	"context"
	"testing"
	"time"

	"creditop/my-tools/chat/cli"
)

// En las pruebas ningún aviso sale de verdad ni se le pregunta la sesión al CLI (history.add llama a notifyFresh).
func init() {
	deliver = func(notice) {}
	whoLookup = func(context.Context) me {
		return me{user: "miguel", email: "miguel@creditop.com", agents: []string{"jira"}}
	}
}

func TestMentionsMe(t *testing.T) {
	cases := map[string]bool{
		"ey @miguel mirá":               true,
		"ey @Miguel.":                   true,
		"para @miguel/jira":             true,
		"avisen a @todos":               true,
		"ey @miguelito":                 false,
		"escribí a miguel@creditop.com": false,
		"@duncan.estrada":               false,
	}
	for text, want := range cases {
		if got := mentionsMe(text, "miguel", []string{"jira"}); got != want {
			t.Errorf("mentionsMe(%q) = %v, quería %v", text, got, want)
		}
	}
}

func TestDecide(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.Local)
	recent := now.Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	who := me{user: "miguel", email: "miguel@creditop.com", agents: []string{"jira"}}
	duncan := cli.Person{Email: "duncan.estrada@creditop.com", Name: "Duncan"}
	group := &cli.GroupRef{ID: "shopify"}
	dm := cli.Message{ID: "1", Dir: "in", From: duncan, Text: "hola", Time: recent}
	inGroup := cli.Message{ID: "2", Dir: "in", From: duncan, Text: "arranquemos", Time: recent, Group: group}
	named := cli.Message{ID: "3", Dir: "in", From: duncan, Text: "@miguel mirá esto", Time: recent, Group: group}

	base := defaultNotifySettings()
	check := func(name string, m cli.Message, s notifySettings, want bool) notice {
		t.Helper()
		n, ok := decide(m, s.normalized(), who, now)
		if ok != want {
			t.Errorf("%s: avisa = %v, quería %v", name, ok, want)
		}
		return n
	}
	check("directo", dm, base, true)
	if n := check("grupo", inGroup, base, true); n.Title != "Duncan en #shopify" || n.Key != "#shopify" {
		t.Errorf("título/clave del grupo: %q %q", n.Title, n.Key)
	}
	if n := check("mención", named, base, true); n.Title != "Duncan te mencionó en #shopify" || !n.Mention {
		t.Errorf("título de la mención: %q", n.Title)
	}

	off := base
	off.Enabled = false
	check("todo apagado", dm, off, false)

	mine := dm
	mine.From = cli.Person{Email: "Miguel@creditop.com"}
	check("lo mío", mine, base, false)
	old := dm
	old.Time = now.Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	check("viejo", old, base, false)

	onlyMentions := base
	onlyMentions.Groups = notifyMentions
	check("grupos sólo menciones, sin mención", inGroup, onlyMentions, false)
	check("grupos sólo menciones, con mención", named, onlyMentions, true)

	perConv := base
	perConv.Conversations = map[string]string{"#shopify": "off", "Duncan.Estrada@creditop.com": "mentions"}
	check("grupo silenciado", named, perConv, false)
	check("directo en sólo menciones (un directo nunca menciona)", dm, perConv, false)

	if n := check("una mención es importante (atraviesa el no molestar de Cockpit)", named, base, true); !n.Mention {
		t.Error("la mención no quedó marcada")
	}

	noPreview := base
	noPreview.Preview = false
	if n := check("sin vista previa", dm, noPreview, true); n.Body != "Nuevo mensaje" {
		t.Errorf("sin vista previa mostró %q", n.Body)
	}
}
