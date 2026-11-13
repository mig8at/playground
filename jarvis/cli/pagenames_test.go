package main

import "testing"

func TestFullShotPagesAreNumberedNextToTheName(t *testing.T) {
	got := pageNames("capturas/correo.png", 3)
	want := []string{"capturas/correo-01.png", "capturas/correo-02.png", "capturas/correo-03.png"}
	for i, w := range want {
		if got[i].path != w {
			t.Fatalf("página %d: %q, quería %q", i+1, got[i].path, w)
		}
	}
	if one := pageNames("correo.png", 1); len(one) != 1 || one[0].path != "correo.png" {
		t.Fatalf("una sola página queda con el nombre tal cual: %+v", one)
	}
	if many := pageNames("x", 120); many[0].path != "x-001.png" || many[119].path != "x-120.png" {
		t.Fatalf("con más de 99, tres cifras y .png por defecto: %q %q", many[0].path, many[119].path)
	}
}
