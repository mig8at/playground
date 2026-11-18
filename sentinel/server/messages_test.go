package main

import (
	"strings"
	"testing"
	"time"
)

// Lo que cambia de una vez a otra se va; lo que distingue un error de otro (el nombre de la columna) se queda.
func TestNormalizeMessage(t *testing.T) {
	cases := []struct{ a, b string }{
		{"Error 1054 (42S22): Unknown column 'cell_phone_lenght' in 'field list'", "Error N (NSN): Unknown column 'cell_phone_lenght' in 'field list'"},
		{"no se encontró la solicitud 505132", "no se encontró la solicitud N"},
		{"token 9f8e7d6c5b4a3f2e vencido", "token <id> vencido"},
		{"user 3fa85f64-5717-4562-b3fc-2c963f66afa6 sin sesión", "user <id> sin sesión"},
		{"falló contra https://demos.netco.la/netcosigner/rest/x?y=1", "falló contra <url>"},
		{`valor "123-abc" inválido`, "valor '…' inválido"},
	}
	for _, c := range cases {
		if got := normalizeMessage(c.a); got != c.b {
			t.Errorf("%q\n  dio   %q\n  debía %q", c.a, got, c.b)
		}
	}
	if normalizeMessage("solicitud 1") != normalizeMessage("solicitud 2") {
		t.Fatal("dos solicitudes distintas deben ser el mismo mensaje")
	}
	if normalizeMessage("Unknown column 'a'") == normalizeMessage("Unknown column 'b'") {
		t.Fatal("dos columnas distintas son dos mensajes")
	}
}

// El mensaje sale del metadato de los servicios en Go, del JSON de los monolitos, o de la línea.
func TestMessageOf(t *testing.T) {
	if got := messageOf(map[string]string{"exception_message": "boom"}, "otra cosa"); got != "boom" {
		t.Fatal(got)
	}
	if got := messageOf(nil, `{"message":"Llamada fallida","context":{}}`); got != "Llamada fallida" {
		t.Fatal(got)
	}
	if got := messageOf(nil, "mysql repository step failed"); got != "mysql repository step failed" {
		t.Fatal(got)
	}
}

// Sólo es nuevo lo que apareció después de la siembra y en las últimas horas; avisa según cuántas veces se repitió.
func TestNewMessagesAfterSeed(t *testing.T) {
	m := &msgStore{path: t.TempDir() + "/messages.json", Services: map[string]map[string]*MsgSeen{}}
	now := time.Date(2026, 11, 18, 9, 0, 0, 0, bogota)
	m.record([]errorLine{{At: now.AddDate(0, 0, -3), Service: "form-service", Message: "context canceled"}})
	if len(m.subjects(now)) != 0 {
		t.Fatal("sin siembra nada es nuevo")
	}
	m.Seeded = now.Add(-24 * time.Hour).Format(time.RFC3339)
	var lines []errorLine
	for i := 0; i < 12; i++ {
		lines = append(lines, errorLine{At: now.Add(-time.Hour + time.Duration(i)*time.Minute), Service: "form-service",
			Message: "Error 1054 (42S22): Unknown column 'cell_phone_lenght' in 'field list'"})
	}
	lines = append(lines, errorLine{At: now.Add(-30 * time.Minute), Service: "form-service", Message: "context canceled"})
	for i := 0; i < 3; i++ {
		lines = append(lines, errorLine{At: now.Add(-10 * time.Minute), Service: "otp-service", Message: "algo raro " + string(rune('a'+i))})
	}
	m.record(lines)
	got := map[string]string{}
	for _, s := range m.subjects(now) {
		got[s.Message.Text] = s.State
		if !strings.HasPrefix(s.Signal, "newmsg:"+s.Message.Service+"#") {
			t.Fatalf("señal: %s", s.Signal)
		}
	}
	if got["Error N (NSN): Unknown column 'cell_phone_lenght' in 'field list'"] != "alert" {
		t.Fatalf("el de la columna debía ser alerta: %v", got)
	}
	if _, ok := got["context canceled"]; ok {
		t.Fatal("un mensaje de antes de la siembra no es nuevo")
	}
	if got["algo raro a"] != "quiet" {
		t.Fatalf("uno que salió una vez no avisa: %v", got)
	}
	if len(m.subjects(now.Add(7*time.Hour))) != 0 {
		t.Fatal("pasadas las primeras horas deja de ser nuevo")
	}
}

// La falla de un proveedor se mide contra su tasa de siempre: un 404 de Netco en cada login es alerta; los rechazos de
// siempre, no.
func TestOutboundFailRate(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota)
	total := map[string]*[bucketsPerDay]int{}
	denied := map[string]*[bucketsPerDay]int{}
	have := map[string]bool{}
	put := func(day time.Time, calls, fails int) {
		key := day.Format("2006-01-02")
		c, f := &[bucketsPerDay]int{}, &[bucketsPerDay]int{}
		for m := 0; m < 60; m += 5 {
			b := bucketOf(day.Add(-time.Hour).Add(time.Duration(m) * time.Minute))
			c[b], f[b] = calls/12, fails/12
		}
		total[key], denied[key], have[key] = c, f, true
	}
	day := now
	for i := 0; i < 8; {
		day = day.AddDate(0, 0, -1)
		if !weekend(day) {
			put(day, 120, 12) // 10 % de siempre
			i++
		}
	}
	put(now, 120, 60) // hoy, la mitad
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"out:netco": {total: total, denied: denied}}, have: have, ceils: map[string]float64{}}
	ev := e.eval("out:netco", now)
	if ev.Level != levelAlert || ev.Out == nil || ev.Out.Fails != 60 || !strings.Contains(ev.Why, "netco") {
		t.Fatalf("nivel %d · %+v · %s", ev.Level, ev.Out, ev.Why)
	}
	put(now, 120, 12)
	if ev := e.eval("out:netco", now); ev.Level != levelOK {
		t.Fatalf("la tasa de siempre debía ser normal: %d · %s", ev.Level, ev.Why)
	}
	put(now, 6, 6)
	if ev := e.eval("out:netco", now); ev.Level != levelQuiet {
		t.Fatalf("con 6 llamadas no se habla: %d · %s", ev.Level, ev.Why)
	}
}
