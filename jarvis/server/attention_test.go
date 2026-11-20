package main

import "testing"

// Lo que pide Claude manda: aparece en la sesión (y en lo que ven el CLI y la interfaz) hasta que se borra. Sin
// pedido y sin nada en curso, la sesión no necesita a nadie.
func TestAttentionExplicit(t *testing.T) {
	tabs := NewTabs(nil)
	tab := tabs.NewBy(true)
	if got := tab.Attention(); got != "" {
		t.Fatalf("sin nada en curso no necesita atención, dio %q", got)
	}
	tab.Runner.SetAttention("  Necesito el código que te llegó al celular ")
	if got := tab.Attention(); got != "Necesito el código que te llegó al celular" {
		t.Fatalf("el motivo pedido tendría que verse tal cual, dio %q", got)
	}
	var found bool
	for _, i := range tabs.Info() {
		if i.ID == tab.ID && i.Attention == "Necesito el código que te llegó al celular" {
			found = true
		}
	}
	if !found {
		t.Fatal("Info tendría que llevar el motivo para la interfaz y el CLI")
	}
	tab.Runner.SetAttention("")
	if tab.Attention() != "" {
		t.Fatal("borrado, ya no necesita atención")
	}
}
