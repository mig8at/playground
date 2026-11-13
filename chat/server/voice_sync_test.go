package main

import (
	"testing"

	"creditop/playground/chat/cli"
)

// Quién dijo cada mensaje (la regla de speakerOf en CallView.vue): lo tuyo no se dice; lo de tus agentes sí.
func TestSpeakerKey(t *testing.T) {
	cases := []struct {
		m    cli.Message
		want string
	}{
		{cli.Message{Dir: "out", To: "#oficina", Via: &cli.Via{Name: "Luigi"}}, "miguel/luigi"},
		{cli.Message{Dir: "out", To: "#oficina"}, ""},
		{cli.Message{Dir: "in", From: cli.Person{Email: "Duncan.Estrada@creditop.com"}}, "duncan.estrada"},
		{cli.Message{Dir: "in", From: cli.Person{Email: "duncan.estrada@creditop.com"}, Via: &cli.Via{Name: "rambo"}}, "duncan.estrada/rambo"},
	}
	for _, c := range cases {
		if got := speakerKey(c.m, "miguel"); got != c.want {
			t.Errorf("speakerKey(%+v) = %q, quería %q", c.m, got, c.want)
		}
	}
}

func ids(ms []cli.Message) []string {
	var out []string
	for _, m := range ms {
		out = append(out, m.ID)
	}
	return out
}

func equal(a []string, b ...string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Por días (hora local): solo se completa el último; un día viejo se baja desde el mensaje donde se le dio play.
func TestSyncDays(t *testing.T) {
	ms := []cli.Message{
		{ID: "a1", Time: "2026-11-10T15:00:00Z"},
		{ID: "a2", Time: "2026-11-10T16:00:00Z"},
		{ID: "b1", Time: "2026-11-11T15:00:00Z"},
		{ID: "b2", Time: "2026-11-11T16:00:00Z"},
		{ID: "b3", Time: "2026-11-11T17:00:00Z"},
		{ID: "c1", Time: "2026-11-13T15:00:00Z"},
		{ID: "c2", Time: "2026-11-13T16:00:00Z"},
	}
	if got := ids(lastDay(ms)); !equal(got, "c1", "c2") {
		t.Errorf("lastDay = %v, quería [c1 c2]", got)
	}
	if got := ids(dayFrom(ms, "b2")); !equal(got, "b2", "b3") {
		t.Errorf("dayFrom(b2) = %v, quería [b2 b3]", got)
	}
	if got := dayFrom(ms, "zz"); got != nil {
		t.Errorf("dayFrom de uno que no existe = %v, quería nada", ids(got))
	}
	if lastDay(nil) != nil {
		t.Error("lastDay de nada debería ser nada")
	}
}

// Qué se pone en fila: sólo los que tienen voz y algo que decir, de la conversación pedida.
func TestJobFor(t *testing.T) {
	c := syncConversation{Me: "miguel", Voices: map[string]string{"miguel/luigi": "Brian Latino"}, MaxWords: 150}
	luigi := cli.Message{ID: "1", Dir: "out", To: "#oficina", Via: &cli.Via{Name: "luigi"}, Text: "Hola. Listo."}
	if j, ok := jobFor("#oficina", c, luigi, nil); !ok || j.voice != "Brian Latino" || len(j.lines) != 2 {
		t.Errorf("jobFor(luigi) = %+v, %v", j, ok)
	}
	// la voz con que ya sonó gana: lo dicho no cambia de voz
	if j, _ := jobFor("#oficina", c, luigi, map[string]string{"1": "Gaby"}); j.voice != "Gaby" {
		t.Errorf("con voz anotada = %q, quería Gaby", j.voice)
	}
	mine := cli.Message{ID: "2", Dir: "out", To: "#oficina", Text: "Lo mío no se dice."}
	stranger := cli.Message{ID: "3", Dir: "out", To: "#oficina", Via: &cli.Via{Name: "kira"}, Text: "Sin voz."}
	for _, m := range []cli.Message{mine, stranger} {
		if _, ok := jobFor("#oficina", c, m, nil); ok {
			t.Errorf("jobFor(%s) no debería generar nada", m.ID)
		}
	}
}
