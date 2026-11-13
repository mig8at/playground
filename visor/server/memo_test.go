package main

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"

	"creditop/playground/connectors/figma"
)

// Dos pedidos simultáneos del mismo mapa leen una vez; el siguiente, ya terminado el primero, vuelve a leer.
func TestMapFlightsReadOncePerKey(t *testing.T) {
	var f mapFlights
	var reads atomic.Int32
	started, release := make(chan struct{}, 2), make(chan struct{})
	read := func() (figma.Structure, error) {
		reads.Add(1)
		started <- struct{}{}
		<-release
		return figma.Structure{Version: "v1"}, nil
	}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if st, err := f.do(context.Background(), "K|1:2", read); err != nil || st.Version != "v1" {
			t.Errorf("el pedido recibe el mapa: %+v %v", st.Version, err)
		}
	}()
	<-started // la lectura está en curso
	// Quien llega ahora se suma a esa lectura, no lanza otra; y si se cansa de esperar se va con su error, sin
	// tumbar la lectura del primero.
	gone, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.do(gone, "K|1:2", read); err == nil {
		t.Error("un pedido cancelado no espera")
	}
	if n := reads.Load(); n != 1 {
		t.Fatalf("con una lectura en curso se leyó %d veces; se esperaba 1", n)
	}
	close(release)
	wg.Wait()
	if _, err := f.do(context.Background(), "K|1:2", read); err != nil || reads.Load() != 2 {
		t.Errorf("terminado el primero, el siguiente lee de nuevo: %v · %d lecturas", err, reads.Load())
	}
}

// La pantalla se parsea y se traduce una vez por JSON; con otro JSON (otra lectura) se hace de nuevo, y la memoria
// no pasa del tope.
func TestScreenIsParsedAndRenderedOnce(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.versions["K"] = "v1"
	calls := 0
	s.nodeJSON = func(_ context.Context, _, id string) ([]byte, error) {
		calls++
		return []byte(fmt.Sprintf(`{"id":%q,"name":"P","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":430,"height":932}}`, id)), nil
	}
	ctx := context.Background()
	a, version, err := s.screenNode(ctx, "K", "1:2")
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := s.screenNode(ctx, "K", "1:2")
	if a.Box != b.Box || calls != 1 {
		t.Fatalf("la segunda lectura sale de lo guardado (mismo nodo): %p %p · %d bajadas", a.Box, b.Box, calls)
	}
	doc1, _ := s.renderScreen("K", version, "1:2", a)
	e := s.screens.entries["K|v1|1:2"]
	if e == nil || !e.hasDoc || doc1 == "" {
		t.Fatalf("la traducción queda guardada: %+v", e)
	}
	// La guardada es la que se entrega: se marca y tiene que volver marcada.
	e.doc = "guardada"
	if doc2, _ := s.renderScreen("K", version, "1:2", b); doc2 != "guardada" {
		t.Error("con el mismo nodo, variantes y tokens no se traduce de nuevo")
	}
	// Llegan tokens al archivo: lo guardado ya no vale.
	s.maps["K|0:1"] = figma.Structure{Tokens: &figma.Tokens{}}
	if doc3, _ := s.renderScreen("K", version, "1:2", b); doc3 == "guardada" || doc3 != doc1 {
		t.Error("con otros tokens se traduce de nuevo")
	}
	for i := 0; i < screenMemoMax+10; i++ {
		if _, _, err := s.screenNode(ctx, "K", fmt.Sprintf("9:%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(s.screens.entries); n > screenMemoMax {
		t.Errorf("la memoria pasó del tope: %d", n)
	}
}
