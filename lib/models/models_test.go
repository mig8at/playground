package models

import (
	"os"
	"path/filepath"
	"testing"
)

func fakeRoots(t *testing.T) Roots {
	tmp := t.TempDir()
	r := Roots{Hub: filepath.Join(tmp, "hub"), Mine: filepath.Join(tmp, "mine"), Whisper: filepath.Join(tmp, "whisper")}
	write := func(p string, n int) {
		os.MkdirAll(filepath.Dir(p), 0o755)
		os.WriteFile(p, make([]byte, n), 0o644)
	}
	write(filepath.Join(r.Mine, "models", "mmproj-Foo-4B-Instruct-Q8_0.gguf"), 10)
	write(filepath.Join(r.Mine, "models", "Foo-4B-Instruct-Q4_K_M.gguf"), 100)
	write(filepath.Join(r.Mine, "tool", ".venv", "bin", "python"), 5)
	write(filepath.Join(r.Mine, "chat", "x"), 5) // sin venv: no es un modelo
	write(filepath.Join(r.Whisper, "ggml-base.bin"), 30)
	write(filepath.Join(r.Hub, "blobs", "shared"), 50)
	write(filepath.Join(r.Hub, "blobs", "own"), 20)
	for _, m := range []string{"models--a--x", "models--b--y"} {
		os.MkdirAll(filepath.Join(r.Hub, m, "snapshots", "1"), 0o755)
		os.Symlink(filepath.Join(r.Hub, "blobs", "shared"), filepath.Join(r.Hub, m, "snapshots", "1", "w"))
	}
	os.Symlink(filepath.Join(r.Hub, "blobs", "own"), filepath.Join(r.Hub, "models--a--x", "snapshots", "1", "v"))
	return r
}

// La búsqueda agrupa el GGUF con su proyector (el peso primero), cuenta el blob compartido en los dos modelos y no
// confunde una carpeta sin venv con un modelo.
func TestScan(t *testing.T) {
	r := fakeRoots(t)
	got := map[string]Installed{}
	for _, it := range Scan(r) {
		got[it.Key] = it
	}
	if got["gguf:Foo-4B-Instruct"].Bytes != 110 || got["env:tool"].Bytes != 5 || got["hub:a/x"].Bytes != 70 ||
		got["hub:b/y"].Bytes != 50 || got["whisper:ggml-base"].Bytes != 30 || len(got) != 5 {
		t.Fatalf("%v", got)
	}
	loc := got["gguf:Foo-4B-Instruct"].Locations()
	if len(loc) != 2 || filepath.Base(loc[0]) != "Foo-4B-Instruct-Q4_K_M.gguf" {
		t.Fatalf("el peso va antes que el proyector: %v", loc)
	}
	if l := got["hub:a/x"].Locations(); len(l) != 1 || filepath.Base(l[0]) != "1" {
		t.Fatalf("la ruta de un modelo de la caché es su snapshot: %v", l)
	}
}

// Borrar uno de la caché no se lleva el blob que comparte con otro; una clave que no está en la búsqueda no se borra,
// y nada fuera de las raíces.
func TestRemove(t *testing.T) {
	r := fakeRoots(t)
	if _, err := Remove(r, "hub:a/x"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(r.Hub, "blobs", "shared")); err != nil {
		t.Fatal("borró un blob que también usa b/y")
	}
	if _, err := os.Stat(filepath.Join(r.Hub, "blobs", "own")); !os.IsNotExist(err) {
		t.Fatal("no borró el blob propio de a/x")
	}
	if _, err := Remove(r, "env:../../etc"); err == nil {
		t.Fatal("una clave que no está en la búsqueda no se borra")
	}
	if r.Inside(r.Mine) || r.Inside("/etc/passwd") || !r.Inside(filepath.Join(r.Mine, "tool")) {
		t.Fatal("Inside")
	}
}

// El registro anota quién usa cada cosa, encuentra por modelo, herramienta o clave, y al reemplazar devuelve sólo lo
// que ya no usa nadie.
func TestRegistry(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "models"), 0o755)
	os.WriteFile(RegistryPath(root), []byte(`{"uses":[
	 {"tool":"a","model":"org/Old","files":["hub:org/Old","env:shared"],"what":"A"},
	 {"tool":"b","model":"org/Other","files":["env:shared"],"what":"B"}]}`), 0o644)
	reg, err := LoadRegistry(root)
	if err != nil {
		t.Fatal(err)
	}
	list := reg.Annotate([]Installed{{Key: "env:shared"}, {Key: "hub:org/Old"}, {Key: "gguf:Nadie"}})
	if list[0].UsedBy != "A · B" || len(list[0].Tools) != 2 || list[2].UsedBy != "" {
		t.Fatalf("%+v", list)
	}
	if len(reg.Find("Old")) != 1 || len(reg.Find("b")) != 1 || len(reg.Find("env:shared")) != 2 {
		t.Fatal("Find")
	}
	free, err := reg.Replace("a", "org/Old", "org/New", []string{"hub:org/New"}, "", "", "2026-11-19")
	if err != nil {
		t.Fatal(err)
	}
	if len(free) != 1 || free[0] != "hub:org/Old" {
		t.Fatalf("sólo se libera lo que nadie más usa: %v", free)
	}
	if _, err := reg.Replace("a", "org/Nope", "x", []string{"hub:x"}, "", "", ""); err == nil {
		t.Fatal("reemplazar algo que la herramienta no usa es un error")
	}
	os.WriteFile(RegistryPath(root), []byte(`{"uses":[{"tool":"a","model":"m","files":["sin-clave"]}]}`), 0o644)
	if _, err := LoadRegistry(root); err == nil {
		t.Fatal("un archivo que no es una clave es un error")
	}
}

// El registro del repo se lee entero.
func TestRepoRegistryIsValid(t *testing.T) {
	reg, err := LoadRegistry("../..")
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.Uses) == 0 {
		t.Fatal("models/registry.json vacío")
	}
}

// For devuelve las rutas de la herramienta en el orden del registro, y dice qué falta si no está.
func TestFor(t *testing.T) {
	r := fakeRoots(t)
	t.Setenv("HOME", filepath.Dir(r.Mine)) // DefaultRoots mira ~/.cache: se arma uno falso con la misma forma
	home := filepath.Dir(r.Mine)
	cache := filepath.Join(home, ".cache")
	os.MkdirAll(cache, 0o755)
	os.Rename(r.Mine, filepath.Join(cache, "my-tools"))
	t.Setenv("XDG_CACHE_HOME", "")
	t.Setenv("HF_HOME", "")
	t.Setenv("HF_HUB_CACHE", r.Hub)
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "models"), 0o755)
	os.WriteFile(RegistryPath(root), []byte(`{"uses":[{"tool":"point","model":"o/Foo","files":["gguf:Foo-4B-Instruct"]},
	 {"tool":"ghost","model":"o/Nope","files":["gguf:Nope"]}]}`), 0o644)
	got, err := For(root, "point", "")
	if err != nil || len(got) != 2 || filepath.Base(got[0]) != "Foo-4B-Instruct-Q4_K_M.gguf" {
		t.Fatalf("%v %v", got, err)
	}
	if _, err := For(root, "ghost", ""); err == nil {
		t.Fatal("un modelo registrado que no está en la Mac es un error")
	}
	if _, err := For(root, "nadie", ""); err == nil {
		t.Fatal("una herramienta sin registro es un error")
	}
}
