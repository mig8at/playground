package main

import (
	"context"
	"errors"
	"testing"
)

// La medida se guarda por versión y se reusa sin volver a medir; «sólo lo guardado» nunca lanza un
// Chromium; y una medida de otro método no se reusa aunque sea de la misma versión.
func TestFidelityIsMeasuredOnceAndReused(t *testing.T) {
	s := newServer(nil, t.TempDir())
	s.versions["K"] = "v1"
	s.nodeJSON = func(context.Context, string, string) ([]byte, error) {
		return []byte(`{"id":"1:2","type":"FRAME","absoluteBoundingBox":{"x":0,"y":0,"width":430,"height":932}}`), nil
	}
	runs := 0
	s.measure = func(_ context.Context, _, _ string, w, h float64) (measured, error) {
		runs++
		if w != 430 || h != 932 {
			t.Errorf("se mide con el tamaño de la pantalla: %v×%v", w, h)
		}
		return measured{Same: 0.99, SameReal: 0.9998, Threshold: 48}, nil
	}
	ctx := context.Background()
	if _, err := s.fidelityOf(ctx, "K", "1:2", false, true); !errors.Is(err, errNotMeasured) || runs != 0 {
		t.Fatalf("sin medida, «sólo lo guardado» no mide: %v · %d corridas", err, runs)
	}
	f, err := s.fidelityOf(ctx, "K", "1:2", false, false)
	if err != nil || f.SameReal != 0.9998 || f.Same != 0.99 || f.Version != "v1" || runs != 1 {
		t.Fatalf("mide una vez: %+v %v · %d corridas", f, err, runs)
	}
	if g, err := s.fidelityOf(ctx, "K", "1:2", false, true); err != nil || g.SameReal != 0.9998 || runs != 1 {
		t.Errorf("la segunda vez sale de lo guardado: %+v %v · %d corridas", g, err, runs)
	}
	if _, err := s.fidelityOf(ctx, "K", "1:2", true, false); err != nil || runs != 2 {
		t.Errorf("«medir de nuevo» mide: %v · %d corridas", err, runs)
	}
	// Otra versión del archivo: la medida de la anterior no vale.
	s.versions["K"] = "v2"
	if _, err := s.fidelityOf(ctx, "K", "1:2", false, true); !errors.Is(err, errNotMeasured) {
		t.Errorf("una versión nueva no tiene medida: %v", err)
	}
}
