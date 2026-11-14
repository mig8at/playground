package main

import (
	"os"
	"path/filepath"
	"testing"

	"creditop/my-tools/chat/cli"
)

// Lo que se sube queda en el caché con SU nombre (no el del temporal) y el mensaje enviado recupera su ficha.
func TestSentFilesKeepTheirNameAndCard(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(t.TempDir(), "chat-adjunto-123")
	if err := os.WriteFile(src, []byte("png"), 0o600); err != nil {
		t.Fatal(err)
	}
	p, err := copyNamed(src, dir, "../captura.png")
	if err != nil || filepath.Base(p) != "captura.png" || filepath.Dir(p) != dir {
		t.Fatalf("copyNamed = %q, %v", p, err)
	}
	if again, _ := copyNamed(src, dir, "captura.png"); filepath.Base(again) != "captura (1).png" {
		t.Errorf("no tiene que pisar: %q", again)
	}
	keepSent(cli.File{ID: "f9", Name: "captura.png", Size: 3}, src)
	if got := sentFilesOf([]string{"nope", "f9"}); len(got) != 1 || got[0].Name != "captura.png" {
		t.Errorf("sentFilesOf = %+v", got)
	}
}
