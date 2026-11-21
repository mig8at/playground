package notice

import (
	"errors"
	"os"
	"testing"
	"time"
)

func at(h, m int) time.Time { return time.Date(2026, 11, 21, h, m, 0, 0, time.Local) }

func TestQuietHours(t *testing.T) {
	night := QuietHours{On: true, From: "19:00", To: "08:00"}
	for _, c := range []struct {
		t    time.Time
		want bool
	}{{at(18, 59), false}, {at(19, 0), true}, {at(23, 30), true}, {at(7, 59), true}, {at(8, 0), false}, {at(12, 0), false}} {
		if got := night.In(c.t); got != c.want {
			t.Errorf("%s: %v, quería %v", c.t.Format("15:04"), got, c.want)
		}
	}
	lunch := QuietHours{On: true, From: "12:00", To: "13:00"}
	if !lunch.In(at(12, 30)) || lunch.In(at(13, 0)) {
		t.Error("el horario que no cruza la medianoche")
	}
	if (QuietHours{On: false, From: "00:00", To: "23:59"}).In(at(12, 0)) {
		t.Error("apagado no calla")
	}
}

func TestSilences(t *testing.T) {
	s := Settings{Quiet: QuietHours{On: true, From: "19:00", To: "08:00"}, ImportantBreaksQuiet: true,
		Apps: map[string]string{"news": LevelNone, "wally": LevelImportant}}
	day, night := at(10, 0), at(22, 0)
	check := func(name string, n Notice, now time.Time, silenced bool) {
		t.Helper()
		if got := s.Silences(n, now) != ""; got != silenced {
			t.Errorf("%s: callado=%v, quería %v (%q)", name, got, silenced, s.Silences(n, now))
		}
	}
	check("de día, todos", Notice{App: "sentinel"}, day, false)
	check("ninguno", Notice{App: "news", Important: true}, day, true)
	check("sólo importantes, uno que no", Notice{App: "wally"}, day, true)
	check("sólo importantes, uno que sí", Notice{App: "wally", Important: true}, day, false)
	check("no molestar", Notice{App: "sentinel"}, night, true)
	check("no molestar, pero importante", Notice{App: "sentinel", Important: true}, night, false)
	s.ImportantBreaksQuiet = false
	check("no molestar sin excepción", Notice{App: "sentinel", Important: true}, night, true)
	s.PausedUntil = day.Add(time.Hour).Format(time.RFC3339)
	check("pausa", Notice{App: "sentinel", Important: true}, day, true)
	check("pausa vencida", Notice{App: "sentinel", Important: true}, day.Add(2*time.Hour), false)
}

func TestSendInbox(t *testing.T) {
	t.Setenv("MY_TOOLS_NOTICES_DIR", t.TempDir())
	t.Setenv("HOME", t.TempDir()) // sin el horario del chat de verdad
	var sent []Notice
	deliver = func(n Notice) (string, error) {
		sent = append(sent, n)
		if n.Title == "falla" {
			return "", errors.New("sin avisador")
		}
		return "prueba", nil
	}
	defer func() { deliver = deliverSystem }()
	if err := WriteSettings(Settings{Apps: map[string]string{"news": LevelNone, "sentinel": LevelAll}}); err != nil {
		t.Fatal(err)
	}
	if via, err := Send(Notice{Title: "alerta", URL: "cockpit://sentinel/#/x"}); err != nil || via != "prueba" {
		t.Fatalf("sentinel: %q %v", via, err)
	}
	if via, _ := Send(Notice{App: "news", Title: "semana"}); via != "callado: news en «ninguno»" {
		t.Fatalf("news: %q", via)
	}
	if _, err := Send(Notice{App: "correo", Title: "falla"}); err == nil {
		t.Fatal("una falla al mandar tiene que volver como error")
	}
	if len(sent) != 2 {
		t.Fatalf("salieron %d, quería 2 (el callado no sale)", len(sent))
	}
	list, err := List("", 0)
	if err != nil || len(list) != 3 {
		t.Fatalf("bandeja: %d avisos, %v", len(list), err)
	}
	byApp := map[string]Record{}
	for _, r := range list {
		byApp[r.App] = r
	}
	if r := byApp["sentinel"]; !r.Delivered || r.Via != "prueba" {
		t.Errorf("la app sale del enlace y queda entregado: %+v", r)
	}
	if r := byApp["news"]; r.Delivered || r.Silenced == "" {
		t.Errorf("el callado queda con su motivo: %+v", r)
	}
	if r := byApp["correo"]; r.Delivered || r.Error == "" {
		t.Errorf("la falla queda con su error: %+v", r)
	}
	if n := Unread(list, ReadState()); n != 2 {
		t.Errorf("sin leer: %d, quería 2 (el callado no cuenta)", n)
	}
	if err := MarkRead(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if n := Unread(list, ReadState()); n != 0 {
		t.Errorf("después de leer: %d", n)
	}
	if s := ReadSettings(); s.Level("sentinel") != LevelAll || len(s.Apps) != 1 {
		t.Errorf("«all» no se guarda: %+v", s.Apps)
	}
}

func TestPrune(t *testing.T) {
	t.Setenv("MY_TOOLS_NOTICES_DIR", t.TempDir())
	old := time.Now().Add(-Keep - time.Hour).UTC().Format(time.RFC3339)
	if err := appendRecord(Record{ID: "viejo", At: old, App: "x"}); err != nil {
		t.Fatal(err)
	}
	if err := appendRecord(Record{ID: "nuevo", At: time.Now().UTC().Format(time.RFC3339), App: "x"}); err != nil {
		t.Fatal(err)
	}
	unlock, _ := lock()
	if err := pruneLocked(time.Now()); err != nil {
		t.Fatal(err)
	}
	unlock()
	list, _ := List("", 0)
	if len(list) != 1 || list[0].ID != "nuevo" {
		t.Fatalf("quedó %+v", list)
	}
	if _, err := os.Stat(inboxPath() + ".tmp"); err == nil {
		t.Error("quedó el temporal")
	}
}
