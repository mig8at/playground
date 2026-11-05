package main

import (
	"os"
	"path/filepath"
	"testing"

	"creditop/playground/chat/cli"
)

// Un adjunto se muestra sólo si lo bajó este chat o si es un archivo dentro de ~/Downloads: nunca otra ruta.
func TestSavedPathOnlyDownloads(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	downloads := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(downloads, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(downloads, "foto.png")
	_ = os.WriteFile(inside, []byte("x"), 0o600)
	secret := filepath.Join(home, ".ssh", "id_rsa")
	_ = os.MkdirAll(filepath.Dir(secret), 0o700)
	_ = os.WriteFile(secret, []byte("no"), 0o600)

	if p, err := savedPath("abc", inside); err != nil || p != inside {
		t.Fatalf("un archivo de Descargas tiene que servirse: %v %q", err, p)
	}
	for _, bad := range []string{secret, filepath.Join(downloads, "..", ".ssh", "id_rsa"), downloads, "", filepath.Join(downloads, "no-existe.png")} {
		if _, err := savedPath("abc", bad); err == nil {
			t.Fatalf("no tiene que servir %q", bad)
		}
	}
	// Un symlink dentro de Descargas que apunta afuera tampoco.
	link := filepath.Join(downloads, "atajo.png")
	_ = os.Symlink(secret, link)
	if _, err := savedPath("abc", link); err == nil {
		t.Fatal("no tiene que seguir un symlink")
	}
	// El caché de imágenes del chat también vale; y copiar a Descargas nunca pisa.
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))
	cache, err := cacheDir()
	if err != nil {
		t.Fatal(err)
	}
	cached := filepath.Join(cache, "captura.png")
	_ = os.WriteFile(cached, []byte("img"), 0o600)
	if p, err := savedPath("abc", cached); err != nil || p != cached {
		t.Fatalf("una imagen del caché tiene que servirse: %v", err)
	}
	first, _ := copyUnique(cached, downloads)
	second, _ := copyUnique(cached, downloads)
	if filepath.Base(first) != "captura.png" || filepath.Base(second) != "captura (1).png" {
		t.Fatalf("copias: %q %q", first, second)
	}
	// Lo que bajó este chat se sirve por su id, esté donde esté.
	saved.Lock()
	saved.byID["def"] = cli.Saved{ID: "def", Path: secret}
	saved.Unlock()
	if p, _ := savedPath("def", ""); p != secret {
		t.Fatal("lo bajado por id tiene que encontrarse")
	}
}
