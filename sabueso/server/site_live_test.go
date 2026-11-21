package main

import (
	"context"
	"os"
	"testing"
)

// Contra el sitio de verdad: sólo con SABUESO_LIVE=1 (va a internet).
func TestReadSiteLive(t *testing.T) {
	if os.Getenv("SABUESO_LIVE") != "1" {
		t.Skip("SABUESO_LIVE=1 para leer dismerca.com de verdad")
	}
	got := readSite(context.Background(), "https://dismerca.com")
	for _, c := range got {
		t.Logf("%s %s · %s · %s", c.Channel, c.Value, c.Area, c.Source)
	}
	found := false
	for _, c := range got {
		if c.Channel == "whatsapp" && digits(c.Value) >= 10 {
			found = true
		}
	}
	if !found {
		t.Error("el WhatsApp comercial de dismerca.com/post-venta tiene que salir del sitio")
	}
}
