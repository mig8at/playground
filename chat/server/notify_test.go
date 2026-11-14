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

func TestQuietHours(t *testing.T) {
	at := func(h, m int) time.Time { return time.Date(2026, 11, 10, h, m, 0, 0, time.Local) }
	night := quietHours{On: true, From: "19:00", To: "08:00"}
	for _, c := range []struct {
		t    time.Time
		want bool
	}{{at(18, 59), false}, {at(19, 0), true}, {at(23, 30), true}, {at(7, 59), true}, {at(8, 0), false}, {at(12, 0), false}} {
		if got := night.inQuiet(c.t); got != c.want {
			t.Errorf("19→08 a las %s = %v", c.t.Format("15:04"), got)
		}
	}
	lunch := quietHours{On: true, From: "12:00", To: "13:00"}
	if !lunch.inQuiet(at(12, 30)) || lunch.inQuiet(at(13, 0)) {
		t.Error("12→13 no se respeta")
	}
	if (quietHours{On: false, From: "00:00", To: "23:59"}).inQuiet(at(12, 0)) {
		t.Error("apagado no debería silenciar")
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

	quiet := base
	quiet.Quiet = quietHours{On: true, From: "11:00", To: "13:00"}
	check("no molestar", dm, quiet, false)
	check("no molestar, pero te mencionan", named, quiet, true)
	quiet.MentionsBreakQuiet = false
	check("no molestar sin excepción", named, quiet, false)

	noPreview := base
	noPreview.Preview = false
	if n := check("sin vista previa", dm, noPreview, true); n.Body != "Nuevo mensaje" {
		t.Errorf("sin vista previa mostró %q", n.Body)
	}
}

func TestAppleString(t *testing.T) {
	if got := appleString(`dijo "hola" \ chau`); got != `"dijo \"hola\" \\ chau"` {
		t.Errorf("appleString = %s", got)
	}
}
