package main

import (
	"testing"
	"time"
)

// La caché del esquema lee una vez por ambiente, no mezcla ambientes y vence.
func TestCachedColumns(t *testing.T) {
	forgetSchema("t1")
	forgetSchema("t2")
	calls := 0
	read := func() ([]string, error) { calls++; return []string{"id", "name"}, nil }
	for i := 0; i < 3; i++ {
		got, err := cachedColumns("t1", "users", read)
		if err != nil || len(got) != 2 {
			t.Fatalf("columnas: %v %v", got, err)
		}
	}
	if calls != 1 {
		t.Fatalf("se leyó %d veces; se esperaba 1", calls)
	}
	if _, _ = cachedColumns("t2", "users", read); calls != 2 {
		t.Fatalf("otro ambiente no debe usar la caché del primero (lecturas: %d)", calls)
	}
	// Vencida: se vuelve a leer.
	schemaMu.Lock()
	schemaByEnv["t1"].at = time.Now().Add(-schemaTTL - time.Second)
	schemaMu.Unlock()
	if _, _ = cachedColumns("t1", "users", read); calls != 3 {
		t.Fatalf("una entrada vencida se vuelve a leer (lecturas: %d)", calls)
	}
}

// El sondeo de Redash empieza corto y no pasa de 1 s; en total sigue cerca de los 60 s de antes.
func TestRedashPollDelay(t *testing.T) {
	want := []time.Duration{150 * time.Millisecond, 300 * time.Millisecond, 600 * time.Millisecond, time.Second, time.Second}
	var total time.Duration
	for i := 0; i < redashPollAttempts; i++ {
		d := redashPollDelay(i)
		if i < len(want) && d != want[i] {
			t.Fatalf("intento %d: %v, se esperaba %v", i, d, want[i])
		}
		if d > time.Second {
			t.Fatalf("intento %d: %v pasa del tope", i, d)
		}
		total += d
	}
	if total < 55*time.Second || total > 65*time.Second {
		t.Fatalf("el techo total cambió: %v", total)
	}
}
