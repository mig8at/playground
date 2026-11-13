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

// Hacia atrás hasta el tope de caracteres, en orden de llegada; sólo la conversación pedida y quien tiene voz.
func TestBackfill(t *testing.T) {
	chatHistory, _ = openHistory(t.TempDir())
	luigi := &cli.Via{Name: "luigi"}
	msgs := []cli.Message{
		{ID: "1", Dir: "out", To: "#oficina", Via: luigi, Text: "Primero de todos, que ya no entra.", Time: "2026-11-13T10:00:00Z"},
		{ID: "2", Dir: "out", To: "#otro", Via: luigi, Text: "De otra conversación.", Time: "2026-11-13T10:01:00Z"},
		{ID: "3", Dir: "out", To: "#oficina", Text: "Lo mío no se dice.", Time: "2026-11-13T10:02:00Z"},
		{ID: "4", Dir: "out", To: "#oficina", Via: &cli.Via{Name: "kira"}, Text: "Kira no tiene voz.", Time: "2026-11-13T10:03:00Z"},
		{ID: "5", Dir: "out", To: "#oficina", Via: luigi, Text: "Segundo mensaje.", Time: "2026-11-13T10:04:00Z"},
		{ID: "6", Dir: "out", To: "#oficina", Via: luigi, Text: "Tercero y último.", Time: "2026-11-13T10:05:00Z"},
	}
	syncState = map[string]*syncStatus{} // que el historial nuevo no dispare la sincronización guardada
	syncOnce.Do(func() {})
	if _, err := chatHistory.add(msgs); err != nil {
		t.Fatal(err)
	}
	c := syncConversation{Me: "miguel", Voices: map[string]string{"miguel/luigi": "Brian Latino"}, MaxWords: 150}
	jobs := backfill("#oficina", c, 40)
	var ids []string
	for _, j := range jobs {
		ids = append(ids, j.id)
	}
	if len(ids) != 2 || ids[0] != "5" || ids[1] != "6" {
		t.Fatalf("backfill con tope 40 = %v, quería [5 6]", ids)
	}
	if all := backfill("#oficina", c, 10000); len(all) != 3 {
		t.Fatalf("sin tope = %d mensajes, quería 3 (1, 5 y 6)", len(all))
	}
	// el primero siempre entra aunque solo pase el tope: si no, una conversación de mensajes largos no sincroniza nada
	if one := backfill("#oficina", c, 1); len(one) != 1 || one[0].id != "6" {
		t.Fatalf("con tope 1 = %v, quería sólo el último", one)
	}
}
