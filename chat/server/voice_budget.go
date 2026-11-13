package main

// EL TOPE DIARIO DE VOZ: cuántos caracteres se le pueden pedir a ElevenLabs en un día (por defecto 20.000, ~20 minutos
// de voz y ~4.000 créditos; CHAT_VOICE_DAILY_CHARS lo cambia). Es la red de seguridad de la plata: aunque la
// videollamada ya corta cada mensaje (~40 s) y silencia los mamotretos, un agente en un bucle o una llamada abierta todo
// el día no pasan de acá. Lo que sale de la caché no cuenta. Se guarda en la caché de voces (budget.json), así que un
// reinicio del servidor no lo pone en cero.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

const defaultDailyVoiceChars = 20000

var budgetMu sync.Mutex

type voiceBudget struct {
	Day   string `json:"day"`
	Chars int    `json:"chars"`
}

func dailyVoiceLimit() int {
	if n, err := strconv.Atoi(os.Getenv("CHAT_VOICE_DAILY_CHARS")); err == nil && n > 0 {
		return n
	}
	return defaultDailyVoiceChars
}

func budgetFile() string { return filepath.Join(voiceCacheDir(), "budget.json") }

// readBudget lee lo gastado hoy (otro día, o sin archivo: cero).
func readBudget() voiceBudget {
	today := time.Now().Format("2006-01-02")
	var b voiceBudget
	if raw, err := os.ReadFile(budgetFile()); err == nil {
		_ = json.Unmarshal(raw, &b)
	}
	if b.Day != today {
		b = voiceBudget{Day: today}
	}
	return b
}

// spendVoice reserva n caracteres del día; si no alcanzan, no reserva nada y dice por qué.
func spendVoice(n int) error {
	budgetMu.Lock()
	defer budgetMu.Unlock()
	b := readBudget()
	if limit := dailyVoiceLimit(); b.Chars+n > limit {
		return fmt.Errorf("se llegó al tope de voz de hoy (%d caracteres): la llamada sigue en silencio hasta mañana", limit)
	}
	b.Chars += n
	if err := os.MkdirAll(voiceCacheDir(), 0o755); err != nil {
		return err
	}
	raw, _ := json.Marshal(b)
	return os.WriteFile(budgetFile(), raw, 0o644)
}

// refundVoice devuelve lo reservado si el pedido a ElevenLabs falló (no se cobró).
func refundVoice(n int) {
	budgetMu.Lock()
	defer budgetMu.Unlock()
	b := readBudget()
	b.Chars = max(0, b.Chars-n)
	raw, _ := json.Marshal(b)
	_ = os.WriteFile(budgetFile(), raw, 0o644)
}
