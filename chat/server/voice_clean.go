package main

// LIMPIAR EL AUDIO DE GEMINI: los modelos 3.8 de voz (Flash y Flash Lite) entregan cada frase con un clic al
// principio y, después de que termina de hablar y de un silencio, ~200 ms de ruido fuerte (casi al máximo: se oye como
// un micrófono que raspa). Medido 2026-11-12 en el audio crudo de Google, no en nuestra envoltura; el 2.5 no lo traía.
// cleanSpeech corta ese ruido de las puntas (sólo si está separado del habla por un silencio) y suaviza los bordes.

import (
	"encoding/binary"
	"math"
)

const (
	cleanWindowMs = 10
	quietDB       = -45.0 // por debajo de esto, la ventana es silencio
	minQuietMs    = 60    // un silencio así de largo separa el habla del ruido de la punta
	maxHeadMs     = 200   // ruido al principio: como mucho esto
	maxTailMs     = 450   // ruido al final: como mucho esto
	fadeMs        = 10
)

// cleanSpeech recibe PCM de 16 bits mono (little endian) y devuelve el mismo audio sin el ruido de las puntas.
func cleanSpeech(pcm []byte, rate int) []byte {
	n := len(pcm) / 2
	x := make([]int16, n)
	for i := range x {
		x[i] = int16(binary.LittleEndian.Uint16(pcm[2*i:]))
	}
	win := rate * cleanWindowMs / 1000
	if win <= 0 || n < win*20 {
		return pcm
	}
	nw := n / win
	quiet := make([]bool, nw)
	for w := 0; w < nw; w++ {
		var sum float64
		for _, v := range x[w*win : (w+1)*win] {
			sum += float64(v) * float64(v)
		}
		rms := math.Sqrt(sum/float64(win)) / 32768
		quiet[w] = 20*math.Log10(rms+1e-9) < quietDB
	}
	need := minQuietMs / cleanWindowMs
	start, end := 0, nw
	// la punta final: en los últimos maxTailMs, el silencio largo más tardío; lo que viene después es el ruido. Se
	// busca el silencio y no el borde del ruido porque el ruido trae ventanitas calladas intercaladas.
	for w := nw - 1; w >= nw-maxTailMs/cleanWindowMs && w >= 0; w-- {
		if run := quietRun(quiet, w, -1); run >= need {
			if w < nw-1 {
				end = w + 1 - (run - need) // del silencio queda sólo un respiro
			}
			break
		}
	}
	// la punta inicial: lo mismo, el silencio largo más temprano en los primeros maxHeadMs
	for w := 0; w < maxHeadMs/cleanWindowMs && w < nw; w++ {
		if run := quietRun(quiet, w, 1); run >= need {
			if w > 0 {
				start = w + (run - need)
			}
			break
		}
	}
	if end <= start {
		return pcm
	}
	y := x[start*win : end*win]
	fade := rate * fadeMs / 1000
	for i := 0; i < fade && i < len(y)/2; i++ {
		g := float64(i) / float64(fade)
		y[i] = int16(float64(y[i]) * g)
		y[len(y)-1-i] = int16(float64(y[len(y)-1-i]) * g)
	}
	out := make([]byte, 2*len(y))
	for i, v := range y {
		binary.LittleEndian.PutUint16(out[2*i:], uint16(v))
	}
	return out
}

// quietRun cuenta cuántas ventanas de silencio seguidas hay desde `from`, andando en la dirección `step`.
func quietRun(quiet []bool, from, step int) int {
	c := 0
	for w := from; w >= 0 && w < len(quiet) && quiet[w]; w += step {
		c++
	}
	return c
}
