package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// Un aviso que no sale queda pendiente, y la pasada siguiente que puede avisar los manda juntos en UNO. Fue lo que
// faltó del 14 al 18/11/2026: el avisador del chat perdió el permiso y 7 alertas quedaron sólo en un archivo.
func TestUnsentNoticesWaitAndGoOutTogether(t *testing.T) {
	broken := true
	var sent []string
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, deliver: func(title, body, route string, sound bool) (string, error) {
		if broken {
			return "", errors.New("sin permiso de avisos")
		}
		sent = append(sent, title+" | "+body)
		return "prueba", nil
	}}
	rules := defaultRules()
	at := time.Date(2026, 11, 14, 11, 0, 0, 0, bogota)
	alert := &Overview{Rules: rules, Lenders: []Subject{
		{Signal: "lender:12", Kind: "lender", Name: "Prami", State: "alert", Why: "13 errores"},
		{Signal: "lender:201", Kind: "lender", Name: "Crédito 365", State: "alert", Why: "11 errores"},
	}}
	n.observe(alert, at)
	if u := n.unsent(); u == nil || u.Count != 2 || !strings.Contains(u.Error, "permiso") {
		t.Fatalf("pendientes: %+v", u)
	}
	if len(sent) != 0 {
		t.Fatalf("no debía salir nada: %v", sent)
	}

	// Sigue roto: no se duplican (el episodio ya se dio por avisado) y siguen esperando.
	n.observe(alert, at.Add(10*time.Minute))
	if u := n.unsent(); u == nil || u.Count != 2 {
		t.Fatalf("pendientes después de otra pasada rota: %+v", u)
	}

	// Vuelve el permiso: sale UN aviso con los dos, y no quedan pendientes.
	broken = false
	n.observe(alert, at.Add(20*time.Minute))
	if len(sent) != 1 || !strings.Contains(sent[0], "2 avisos atrasados") || !strings.Contains(sent[0], "Prami") || !strings.Contains(sent[0], "Crédito 365") {
		t.Fatalf("lo que salió: %v", sent)
	}
	if n.unsent() != nil {
		t.Fatal("quedaron pendientes después de salir")
	}
}

// «Volvió a lo normal» atrasado no sirve: no se guarda como pendiente.
func TestRecoveredIsNotKeptWhenItFails(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, deliver: func(string, string, string, bool) (string, error) {
		return "", errors.New("roto")
	}}
	n.send(Notice{Signal: "lender:6", Name: "Entidad", Level: "recovered", Text: "volvió"}, time.Now(), "", false)
	if n.unsent() != nil {
		t.Fatal("un «volvió a lo normal» no debía quedar pendiente")
	}
}

// Un servicio callado no cierra su episodio aunque la hora salga «normal»: 0 líneas no es haber vuelto.
func TestSilentServiceDoesNotRecover(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}}
	rules := defaultRules()
	at := time.Date(2026, 11, 14, 9, 0, 0, 0, bogota)
	n.observe(&Overview{Rules: rules, Liveness: []Subject{{Signal: "logs:x", Name: "x · líneas", State: "alert"}}}, at)
	for i := 1; i <= 12; i++ { // dos horas «normales», pero sin una línea
		n.observe(&Overview{Rules: rules, Liveness: []Subject{{Signal: "logs:x", Name: "x · líneas", State: "ok"}}}, at.Add(time.Duration(i)*10*time.Minute))
	}
	if n.Episodes["logs:x"] == nil {
		t.Fatal("el episodio se cerró con 0 líneas")
	}
	for _, x := range n.notices {
		if x.Level == "recovered" {
			t.Fatalf("avisó que volvió: %+v", x)
		}
	}
	// Vuelve a escribir: ahora sí se cierra.
	for i := 13; i <= 17; i++ {
		n.observe(&Overview{Rules: rules, Liveness: []Subject{{Signal: "logs:x", Name: "x · líneas", State: "ok", Now: Window{Total: 40}}}}, at.Add(time.Duration(i)*10*time.Minute))
	}
	if n.Episodes["logs:x"] != nil {
		t.Fatal("el episodio no se cerró al volver a escribir")
	}
}

// Cero líneas cuando todos los días comparables escribieron a esa hora es alerta, aunque la dispersión sea tan ancha
// que z no llegue (el «volvió a lo normal: escribió 0 líneas; lo normal es 798,5» del 14/11/2026).
func TestZeroLinesWhenEveryComparableDayWrote(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota) // miércoles
	hourly := []int{900, 50, 1200, 30, 800}             // cinco hábiles anteriores, de 9 a 10
	total := map[string]*[bucketsPerDay]int{}
	have := map[string]bool{}
	put := func(day time.Time, perHour int) {
		key := day.Format("2006-01-02")
		arr := &[bucketsPerDay]int{}
		for m := 0; m < 60; m += 5 {
			arr[bucketOf(day.Add(-time.Hour).Add(time.Duration(m)*time.Minute))] = perHour / 12
		}
		total[key], have[key] = arr, true
	}
	day, i := now, 0
	for i < len(hourly) {
		day = day.AddDate(0, 0, -1)
		if weekend(day) {
			continue
		}
		put(day, hourly[i])
		i++
	}
	put(now, 0)
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"logs:x": {total: total}}, have: have, ceils: map[string]float64{}}
	ev := e.eval("logs:x", now)
	if ev.Level != levelAlert || !strings.Contains(ev.Why, "no escribió una línea") {
		t.Fatalf("nivel %d · %s", ev.Level, ev.Why)
	}

	// Si algún día comparable tampoco escribió a esa hora, no se fuerza nada: queda en lo que diga la estadística.
	day, i = now, 0
	for i < len(hourly) {
		day = day.AddDate(0, 0, -1)
		if !weekend(day) {
			i++
		}
	}
	put(day, 0)
	if ev := e.eval("logs:x", now); strings.Contains(ev.Why, "no escribió una línea") {
		t.Fatalf("con un día comparable en cero no debía forzarse: %s", ev.Why)
	}
}

// Reconocer saca el episodio de «Pide atención» hasta que empeora; si empeora, vuelve y avisa.
func TestAckedUntilItGetsWorse(t *testing.T) {
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}}
	rules := defaultRules()
	rules.Notify.Level = "warn"
	at := time.Date(2026, 11, 18, 9, 0, 0, 0, bogota)
	warn := &Overview{Rules: rules, Services: []Subject{{Signal: "service:x", Name: "x", State: "warn"}}}
	n.observe(warn, at)
	if err := n.ack("service:y", at); err == nil {
		t.Fatal("sin episodio no hay nada que reconocer")
	}
	if err := n.ack("service:x", at); err != nil {
		t.Fatal(err)
	}
	n.observe(warn, at.Add(10*time.Minute))
	if !n.acked()["service:x"] {
		t.Fatal("se perdió el reconocimiento sin empeorar")
	}
	n.observe(&Overview{Rules: rules, Services: []Subject{{Signal: "service:x", Name: "x", State: "alert"}}}, at.Add(20*time.Minute))
	if n.acked()["service:x"] {
		t.Fatal("empeoró y siguió reconocido")
	}
	if last := n.notices[len(n.notices)-1]; last.Level != "alert" {
		t.Fatalf("al empeorar debía avisar: %+v", last)
	}
}

// El aviso del hueco dice cuánto no miró y qué pasó a alerta (sin los comercios que no se siguen), con sonido sólo si
// hubo alertas, y apaga la espera del «volvió a leer».
func TestGapNoticeSummarizesWhatHappened(t *testing.T) {
	var titles, bodies []string
	var sounds []bool
	n := &notifier{dry: true, Episodes: map[Signal]*episode{}, follows: func(Signal) bool { return false },
		deliver: func(title, body, route string, sound bool) (string, error) {
			titles, bodies, sounds = append(titles, title), append(bodies, body), append(sounds, sound)
			return "prueba", nil
		}}
	n.FailingSince, n.StaleNotified = "2026-11-14T15:43:00-05:00", true
	from := time.Date(2026, 11, 14, 15, 43, 0, 0, bogota)
	to := time.Date(2026, 11, 17, 7, 40, 0, 0, bogota)
	g := Gap{From: from.Format(time.RFC3339), To: to.Format(time.RFC3339)}
	n.gap(g, []GapAlert{
		{Signal: "lender:12", Name: "Prami · errores", At: from.Add(24 * time.Hour)},
		{Signal: "merchant:99", Name: "Comercio que no sigo", At: from.Add(25 * time.Hour)},
	}, defaultRules().Notify, false, to)
	if len(bodies) != 1 || !strings.Contains(bodies[0], "No miró 2 d") || !strings.Contains(bodies[0], "Prami") ||
		strings.Contains(bodies[0], "no sigo") || !sounds[0] {
		t.Fatalf("aviso: %q · sonido %v", bodies, sounds)
	}
	if n.StaleNotified || n.FailingSince != "" {
		t.Fatal("después del aviso del hueco no debía quedar esperando el «volvió a leer»")
	}
	n.gap(g, nil, defaultRules().Notify, false, to)
	if !strings.Contains(bodies[1], "nada pasó a alerta") || sounds[1] {
		t.Fatalf("sin alertas: %q · sonido %v", bodies[1], sounds[1])
	}
}

// Errores dos horas seguidas sobre el mínimo con lo normal en cero: «para mirar», aunque el techo lo deje pasar.
func TestErrorsSustainedOverZero(t *testing.T) {
	now := time.Date(2026, 11, 18, 10, 0, 0, 0, bogota)
	total := map[string]*[bucketsPerDay]int{}
	have := map[string]bool{}
	day := now
	for i := 0; i < 10; {
		day = day.AddDate(0, 0, -1)
		if weekend(day) {
			continue
		}
		key := day.Format("2006-01-02")
		arr := &[bucketsPerDay]int{}
		if i < 3 { // ráfagas de otros días, de tarde (dos horas a 40 por hora): suben el techo por encima de 29
			for m := 0; m < 120; m += 5 {
				arr[bucketOf(time.Date(day.Year(), day.Month(), day.Day(), 15, m, 0, 0, bogota))] = 40 / 12
			}
		}
		total[key], have[key] = arr, true
		i++
	}
	arr := &[bucketsPerDay]int{}
	for m := 0; m < 120; m += 5 { // 29 por hora, de 8 a 10
		arr[bucketOf(now.Add(-2*time.Hour).Add(time.Duration(m)*time.Minute))] = 29 / 12
	}
	arr[bucketOf(now.Add(-5*time.Minute))] += 29 - 12*(29/12)
	arr[bucketOf(now.Add(-65*time.Minute))] += 29 - 12*(29/12)
	total[now.Format("2006-01-02")], have[now.Format("2006-01-02")] = arr, true
	e := evaluator{rules: defaultRules(), data: map[Signal]*series{"service:x": {total: total}}, have: have, ceils: map[string]float64{}}
	ev := e.eval("service:x", now)
	if ev.Level != levelWarn || !strings.Contains(ev.Why, "en la anterior") {
		t.Fatalf("nivel %d · %s", ev.Level, ev.Why)
	}
}
