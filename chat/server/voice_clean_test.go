package main

import (
	"encoding/binary"
	"math"
	"testing"
)

// un audio como los de Gemini 3.8: clic, silencio, habla, silencio, ruido fuerte
func TestCleanSpeechCutsTheNoisyEnds(t *testing.T) {
	const rate = 24000
	ms := func(m int) int { return rate * m / 1000 }
	var x []int16
	add := func(m int, f func(i int) int16) {
		for i := 0; i < ms(m); i++ {
			x = append(x, f(i))
		}
	}
	noise := func(i int) int16 { return int16(((i * 7919) % 60000) - 30000) }
	add(30, noise)
	add(150, func(int) int16 { return 0 })
	add(1000, func(i int) int16 { return int16(8000 * math.Sin(float64(i)/8)) })
	add(250, func(int) int16 { return 0 })
	add(200, noise)
	pcm := make([]byte, 2*len(x))
	for i, v := range x {
		binary.LittleEndian.PutUint16(pcm[2*i:], uint16(v))
	}
	out := cleanSpeech(pcm, rate)
	got := len(out) / 2 * 1000 / rate
	// queda el habla (1000 ms) con un respiro a cada lado, y ni el clic ni el ruido
	if got < 1000 || got > 1150 {
		t.Fatalf("quedaron %d ms, esperaba ~1100", got)
	}
	tail := out[len(out)-2*ms(20):]
	for i := 0; i < len(tail); i += 2 {
		if v := int16(binary.LittleEndian.Uint16(tail[i:])); v > 2000 || v < -2000 {
			t.Fatalf("el final todavía suena fuerte: %d", v)
		}
	}
}

// un audio limpio no se toca (salvo los fundidos)
func TestCleanSpeechKeepsCleanAudio(t *testing.T) {
	const rate = 24000
	x := make([]byte, 2*rate)
	for i := 0; i < rate; i++ {
		binary.LittleEndian.PutUint16(x[2*i:], uint16(int16(8000*math.Sin(float64(i)/8))))
	}
	if out := cleanSpeech(x, rate); len(out) != len(x) {
		t.Fatalf("cambió el largo de un audio limpio: %d → %d", len(x), len(out))
	}
}
