package main

import (
	"strings"
	"testing"
)

// el tope del día: reserva mientras alcance, rechaza lo que se pase y devuelve lo que falló
func TestVoiceBudget(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // la caché de voces va a una carpeta de prueba
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("CHAT_VOICE_DAILY_CHARS", "100")
	if err := spendVoice(60); err != nil {
		t.Fatalf("60 de 100 tenía que entrar: %v", err)
	}
	if err := spendVoice(50); err == nil || !strings.Contains(err.Error(), "tope de voz") {
		t.Fatalf("60+50 pasa de 100 y tenía que rechazarse: %v", err)
	}
	refundVoice(60)
	if err := spendVoice(90); err != nil {
		t.Fatalf("después de devolver 60, 90 tenía que entrar: %v", err)
	}
	if got := readBudget().Chars; got != 90 {
		t.Fatalf("gastado hoy = %d, esperaba 90", got)
	}
}
