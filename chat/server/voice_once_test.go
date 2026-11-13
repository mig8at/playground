package main

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// dos (o veinte) pedidos iguales a la vez generan una sola vez y todos reciben lo mismo; terminado, el candado se suelta
func TestVoiceOnce(t *testing.T) {
	var calls atomic.Int32
	release := make(chan struct{})
	generate := func() (string, error) {
		calls.Add(1)
		<-release
		return "frase.mp3", nil
	}
	const n = 20
	var wg sync.WaitGroup
	results := make([]string, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _ = voiceOnce("misma-frase", generate)
		}()
	}
	// se espera a que el primero esté generando y se da tiempo a que los demás se pongan en fila detrás
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()
	if got := calls.Load(); got != 1 {
		t.Fatalf("se generó %d veces, esperaba 1", got)
	}
	for i, r := range results {
		if r != "frase.mp3" {
			t.Fatalf("el pedido %d recibió %q", i, r)
		}
	}
	// otra frase no espera a nadie, y la misma se puede volver a pedir cuando terminó
	if _, err := voiceOnce("otra", func() (string, error) { return "otra.mp3", nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := voiceOnce("misma-frase", func() (string, error) { calls.Add(1); return "frase.mp3", nil }); err != nil || calls.Load() != 2 {
		t.Fatalf("terminado el primero, el candado tenía que soltarse (llamadas: %d, err: %v)", calls.Load(), err)
	}
}
