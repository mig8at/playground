package main

import (
	"testing"

	"creditop/my-tools/lib/machine"
)

func params(n int64) *int64 { return &n }

var (
	pc  = machine.Info{ID: "pc", Here: "este PC", OS: "linux", RAM: 32 * gib, VRAM: 8 * gib, Accel: "cuda"}
	mac = machine.Info{ID: "mac", Here: "esta Mac", OS: "darwin", RAM: 36 * gib, VRAM: 36 * gib, Accel: "mps"}
)

func TestFitUsesWhatTheFileDeclaresForThatMachine(t *testing.T) {
	f := Favorite{ID: "a/b", Mac: "yes", Params: params(70e9)}
	if got := fitFor(mac, f); got.Status != "yes" || got.Basis != "declared" {
		t.Fatalf("en la Mac manda `mac`: %+v", got)
	}
	// para el PC no hay nada escrito: se estima, y 70 B no entra
	if got := fitFor(pc, f); got.Basis != "estimated" || got.Status != "no" {
		t.Fatalf("en el PC se estima: %+v", got)
	}
	f.PC = "yes"
	if got := fitFor(pc, f); got.Status != "yes" || got.Basis != "declared" {
		t.Fatalf("`pc` escrito manda sobre la cuenta: %+v", got)
	}
}

func TestEstimateBySize(t *testing.T) {
	for _, c := range []struct {
		name   string
		f      Favorite
		status string
	}{
		{"chico: entra entero en la GPU", Favorite{ID: "a/tiny", Params: params(600e6)}, "yes"},
		{"7 B: entra cuantizado", Favorite{ID: "a/seven", Params: params(7e9)}, "yes"},
		{"27 B: sólo en la RAM", Favorite{ID: "a/big", Params: params(27e9)}, "slow"},
		{"120 B: no entra", Favorite{ID: "a/huge", Params: params(120e9)}, "no"},
		{"sin tamaño: no se sabe", Favorite{ID: "a/x"}, "unknown"},
		{"formato de Apple", Favorite{ID: "mlx-community/parakeet", Params: params(600e6)}, "no"},
		{"pide NVIDIA y no dice tamaño", Favorite{ID: "nvidia/x", Group: "gpu"}, "unknown"},
	} {
		if got := estimate(pc, c.f); got.Status != c.status || got.Basis != "estimated" || got.Why == "" {
			t.Errorf("%s: %+v, quería %s", c.name, got, c.status)
		}
	}
	// en la Mac el formato de Apple no es un no
	if got := estimate(mac, Favorite{ID: "mlx-community/parakeet", Params: params(600e6)}); got.Status != "yes" {
		t.Errorf("MLX en la Mac: %+v", got)
	}
}

func TestTriedInDefaultsToTheMac(t *testing.T) {
	if triedIn(Favorite{TriedOn: "2026-11-19"}) != "mac" || triedIn(Favorite{TriedIn: "pc"}) != "pc" {
		t.Fatal("lo probado sin máquina escrita es de la Mac")
	}
}
