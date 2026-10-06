package main

import (
	"testing"
	"time"
)

func TestAtDayUsaElDiaDeLaBase(t *testing.T) {
	base := time.Date(2026, 10, 5, 3, 0, 0, 0, time.Local)
	got, err := atDay(base, "14:47")
	if err != nil {
		t.Fatal(err)
	}
	if got.Format("2006-01-02 15:04") != "2026-10-05 14:47" {
		t.Fatalf("salió %s", got.Format("2006-01-02 15:04"))
	}
	if _, err := atDay(base, "25:99"); err == nil {
		t.Fatal("una hora inválida debía fallar")
	}
}

func TestEntryDay(t *testing.T) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.Local)
	if d, err := entryDay(now, ""); err != nil || !d.Equal(now) {
		t.Fatalf("sin -dia es hoy: %v %v", d, err)
	}
	if d, err := entryDay(now, "2026-10-05"); err != nil || d.Day() != 5 {
		t.Fatalf("un día pasado debía valer: %v %v", d, err)
	}
	if _, err := entryDay(now, "2026-10-07"); err == nil {
		t.Fatal("un día futuro debía fallar")
	}
	if _, err := entryDay(now, "05/10/2026"); err == nil {
		t.Fatal("un formato distinto de AAAA-MM-DD debía fallar")
	}
}
