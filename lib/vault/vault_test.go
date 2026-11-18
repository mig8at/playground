package vault

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func paths(t *testing.T) Paths {
	dir := t.TempDir()
	return Paths{File: filepath.Join(dir, "vault.json"), Key: filepath.Join(dir, "personal-key")}
}

// El formato es el de openssl: lo que cifra Go lo abre openssl con la llave en un archivo, y al revés.
func TestOpensslCompatible(t *testing.T) {
	if _, err := exec.LookPath("openssl"); err != nil {
		t.Skip("sin openssl")
	}
	p := paths(t)
	pass, err := p.PersonalKey(true)
	if err != nil {
		t.Fatal(err)
	}
	value := "valor-de-prueba ñ 🔑 con espacios"
	sealed, err := Seal(pass, value)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-a", "-A", "-pass", "file:"+p.Key)
	cmd.Stdin = strings.NewReader(sealed)
	out, err := cmd.Output()
	if err != nil || string(out) != value {
		t.Fatalf("openssl no abrió lo de Go: %q %v", out, err)
	}
	cmd = exec.Command("openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "100000", "-md", "sha256", "-a", "-A", "-pass", "file:"+p.Key)
	cmd.Stdin = strings.NewReader(value)
	out, err = cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	got, err := Open(pass, string(out))
	if err != nil || got != value {
		t.Fatalf("Go no abrió lo de openssl: %q %v", got, err)
	}
	if _, err := Open("otra-llave", sealed); err == nil {
		t.Fatal("con otra llave tenía que fallar")
	}
}

func TestRingsAndKeys(t *testing.T) {
	p := paths(t)
	if _, err := p.CreateRing("VTEX pruebas"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.CreateRing("vtex-pruebas"); err == nil {
		t.Fatal("dos llaveros con el mismo slug")
	}
	if _, err := p.CreateRing("Finandina"); err != nil {
		t.Fatal(err)
	}
	k, err := p.SetKey("vtex-pruebas", "app key", "uno")
	if err != nil || k.Name != "APP_KEY" || k.Print == "" {
		t.Fatalf("%+v %v", k, err)
	}
	// La llave personal la crea la primera llave, con permisos 600.
	if fi, err := os.Stat(p.Key); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("llave personal: %v %v", fi, err)
	}
	// Ningún valor en claro en el archivo.
	raw, _ := os.ReadFile(p.File)
	if strings.Contains(string(raw), "uno\"") {
		t.Fatal("el valor quedó en claro")
	}
	// Guardar de nuevo cambia el valor, no duplica, y conserva el id.
	k2, _ := p.SetKey("VTEX pruebas", "APP_KEY", "dos")
	if k2.ID != k.ID || k2.Print == k.Print {
		t.Fatalf("no reemplazó: %+v %+v", k, k2)
	}
	if v, _ := p.Reveal("vtex-pruebas", "APP_KEY"); v != "dos" {
		t.Fatalf("reveal: %q", v)
	}
	if _, err := p.RenameKey("vtex-pruebas", "APP_KEY", "vtex app key"); err != nil {
		t.Fatal(err)
	}
	if err := p.RenameRing("vtex-pruebas", "VTEX"); err != nil {
		t.Fatal(err)
	}
	if err := p.MoveKey("vtex", "VTEX_APP_KEY", "finandina"); err != nil {
		t.Fatal(err)
	}
	env, err := p.Env("Finandina")
	if err != nil || len(env) != 1 || env[0] != [2]string{"VTEX_APP_KEY", "dos"} {
		t.Fatalf("env: %v %v", env, err)
	}
	if err := p.DeleteRing("finandina", false); err == nil {
		t.Fatal("borró un llavero con llaves sin --force")
	}
	if err := p.DeleteKey("finandina", "VTEX_APP_KEY"); err != nil {
		t.Fatal(err)
	}
	if err := p.DeleteRing("finandina", false); err != nil {
		t.Fatal(err)
	}
	d, _ := p.Load()
	if len(d.Rings) != 1 || d.Rings[0].Name != "VTEX" {
		t.Fatalf("%+v", d)
	}
}

// Varias escrituras a la vez no se pierden (el candado). Con goroutines y no procesos: el flock es por archivo
// abierto, así que dos descriptores del mismo proceso se excluyen igual.
func TestParallelWrites(t *testing.T) {
	p := paths(t)
	if _, err := p.CreateRing("r"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.SetKey("r", fmt.Sprintf("K%d", i), "v"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	d, _ := p.Load()
	if n := len(d.Rings[0].Keys); n != 12 {
		t.Fatalf("quedaron %d de 12", n)
	}
}

func TestEnvName(t *testing.T) {
	for in, want := range map[string]string{"app key": "APP_KEY", "Contraseña": "CONTRASENA", "1password": "_1PASSWORD", "  x-y.z ": "X_Y_Z"} {
		if got := EnvName(in); got != want {
			t.Errorf("%q → %q, quería %q", in, got, want)
		}
	}
}
