package naming

// No persiguen cobertura: cada una fija una lógica que ya dio, o podía dar, un diagnóstico equivocado.
//
//   - la vara del diccionario dejó pasar `aviso`, `leer` y `tema` como inglés (fase 1);
//   - quitar un `-es` a ciegas convierte un plural español en inglés (`partes` → `part`);
//   - un extractor que no devuelve nada da «todo en inglés» sin haber mirado;
//   - la condición de cierre de la fase 4: un nombre español inventado a propósito, en cada lenguaje y
//     en un nombre de archivo, tiene que hacer fallar el chequeo;
//   - y la de la 4b: una clave JSON en español aceptada en UN lugar (la API de cuadrilla) no queda
//     aceptada en otro, ni se vuelve una palabra permitida para los identificadores.

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
)

// Una vara chica y fija, para que las pruebas de la lógica no dependan de la versión de Go o Python.
func smallBase() map[string]int {
	base := map[string]int{}
	for _, w := range strings.Fields("read task old file root error log class part plane load parse run dry") {
		base[w] = 100
	}
	for _, w := range []string{"de", "es", "del"} {
		base[w] = 1000
	}
	return base
}

func TestSplitCamelSnakeAndAcronyms(t *testing.T) {
	cases := map[string][]string{
		"leerTareaVieja":     {"leer", "tarea", "vieja"},
		"HTTPServer":         {"http", "server"},
		"dry_run":            {"dry", "run"},
		"JIRA-TASK-TEMPLATE": {"jira", "task", "template"},
		"phase1b":            {"phase", "1", "b"},
		"parseURLs":          {"parse", "ur", "ls"},
	}
	for name, want := range cases {
		if got := SplitWords(name); !reflect.DeepEqual(got, want) {
			t.Errorf("SplitWords(%q) = %q, quería %q", name, got, want)
		}
	}
}

func TestASpanishPluralDoesNotBecomeEnglish(t *testing.T) {
	if slices.Contains(BaseForms("partes"), "part") {
		t.Error("`partes` no puede tener `part` como forma de base")
	}
	for word, form := range map[string]string{"classes": "class", "files": "file", "parsed": "parse", "running": "run"} {
		if !slices.Contains(BaseForms(word), form) {
			t.Errorf("BaseForms(%q) no trae %q", word, form)
		}
	}
}

func TestForeignWords(t *testing.T) {
	base, none := smallBase(), map[string]bool{}
	cases := []struct {
		name    string
		allowed map[string]bool
		want    []string
	}{
		{"leerTareaVieja", none, []string{"leer", "tarea", "vieja"}}, // un diccionario las aceptaría
		{"aviso", none, []string{"aviso"}},
		{"tema", none, []string{"tema"}},
		{"errorDelLog", none, []string{"del"}}, // `del` abunda en Python y en un nombre es español
		{"readOldFiles", none, nil},
		{"partes", none, []string{"partes"}},
		{"tableroRoot", map[string]bool{"tablero": true}, nil},
		{"id", none, nil},
	}
	for _, c := range cases {
		if got := ForeignWords(c.name, base, c.allowed); !reflect.DeepEqual(got, c.want) {
			t.Errorf("ForeignWords(%q) = %q, quería %q", c.name, got, c.want)
		}
	}
}

func TestTheAllowFileKeepsWordsPathsAndJSONApart(t *testing.T) {
	f := filepath.Join(t.TempDir(), "allow.txt")
	os.WriteFile(f, []byte("# comentario\njira jql\npath: src/tema.css   # compartido\n"+
		"json: server/cmd/cuadrilla/ rama autor   # la API de cuadrilla\n"), 0o644)
	a, err := LoadAllow(f)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.Words, map[string]bool{"jira": true, "jql": true}) {
		t.Errorf("palabras = %v: una clave aceptada no puede volverse una palabra aceptada", a.Words)
	}
	if !reflect.DeepEqual(a.Paths, map[string]string{"src/tema.css": "compartido"}) {
		t.Errorf("rutas = %v", a.Paths)
	}
	want := []JSONRule{{"server/cmd/cuadrilla/", "", map[string]bool{"rama": true, "autor": true}}}
	if !reflect.DeepEqual(a.JSON, want) {
		t.Errorf("reglas json = %v", a.JSON)
	}
}

func TestJSONKeyIsAcceptedOnlyWhereTheRuleSays(t *testing.T) {
	rules := []JSONRule{
		{"server/cmd/cuadrilla/", "", map[string]bool{"rama": true}},
		{"server/cmd/today/main.go", "areaCanon", map[string]bool{"objetivo": true}},
		{"server/cmd/branches/main.go", "map", map[string]bool{"*": true}},
	}
	cases := []struct {
		rel, kind, ctx, key string
		want                bool
	}{
		{"server/cmd/cuadrilla/main.go", "tag", "branch.Branch", "rama", true},
		{"server/cmd/today/main.go", "tag", "branchSnap.Branch", "rama", false},
		{"server/cmd/today/main.go", "tag", "areaCanon.Goal", "objetivo", true},
		{"server/cmd/today/main.go", "tag", "row.Goal", "objetivo", false},
		{"server/cmd/branches/main.go", "map", "-", "desde", true},
		{"server/cmd/branches/main.go", "tag", "x.Y", "desde", false},
	}
	for _, c := range cases {
		if got := JSONAllowed(c.rel, c.kind, c.ctx, c.key, rules); got != c.want {
			t.Errorf("JSONAllowed(%s, %s, %s, %s) = %v", c.rel, c.kind, c.ctx, c.key, got)
		}
	}
}

// ── de punta a punta: los extractores de verdad (Go, Vue/JS, Python, git) sobre un árbol inventado ──

var english = map[string]string{
	"server/x.go": "package x\n\ntype task struct {\n\tTitle string `json:\"title\"`\n}\n\nfunc loadTask() {}\n",
	"src/a.js":    "const taskList = [];\nexport function readFile(path) { return path; }\n",
	"src/b.vue":   "<script setup>\nconst title = 1;\n</script>\n<template><p v-for=\"item in [1]\">{{ item }}</p></template>\n",
	"tools/c.py":  "def load(path):\n    return path\n",
}

// board arma el árbol con el extractor de Vue/JS de verdad, que es un archivo del tablero.
func board(t *testing.T, files map[string]string) Board {
	t.Helper()
	for _, bin := range []string{"node", "python3", "git"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Fatalf("hace falta %s para esta prueba: sin él no mira nada, y no mirar no es pasar", bin)
		}
	}
	root := t.TempDir()
	for rel, text := range files {
		os.MkdirAll(filepath.Dir(filepath.Join(root, rel)), 0o755)
		os.WriteFile(filepath.Join(root, rel), []byte(text), 0o644)
	}
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	decls, _ := filepath.Abs("../../../tools/rename/js/decls.mjs")
	return Board{Root: root, GoRoots: []string{"server"}, JSGlobs: []string{"src/*.js", "src/*.vue"},
		PyGlobs: []string{"tools/*.py"}, DeclsScript: decls}
}

// realBaseline es la vara de verdad, del mismo caché que usa el chequeo: armarla cuesta unos segundos.
var realBaseline = sync.OnceValues(func() (map[string]int, error) {
	cache, _ := filepath.Abs("../../../data/cache/naming-baseline.json")
	return Baseline(cache)
})

func baseline(t *testing.T) map[string]int {
	t.Helper()
	base, err := realBaseline()
	if err != nil {
		t.Fatal(err)
	}
	return base
}

func TestInventedSpanishNamesFailInEveryLanguage(t *testing.T) {
	files := map[string]string{
		"server/y.go":   "package x\n\nfunc leerTarea() {}\n\ntype plan struct {\n\tNext string `json:\"proximoPaso\"`\n}\n",
		"src/c.js":      "const { fecha } = {};\n",
		"src/d.vue":     "<template><p v-for=\"fila in [1]\">{{ fila }}</p></template>\n",
		"tools/d.py":    "def cargar():\n    pass\n",
		"docs/notas.md": "x\n",
	}
	for k, v := range english {
		files[k] = v
	}
	findings, _, err := Check(board(t, files), baseline(t), Allow{Words: map[string]bool{}, Paths: map[string]string{}}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]bool{}
	for _, f := range findings {
		found[f.Name] = true
	}
	for _, want := range []string{"leerTarea", "proximoPaso", "fecha", "fila", "cargar", "notas.md"} {
		if !found[want] {
			t.Errorf("no se encontró %q entre %v", want, found)
		}
	}
}

func TestAnEnglishTreePasses(t *testing.T) {
	findings, counts, err := Check(board(t, english), baseline(t), Allow{Words: map[string]bool{}, Paths: map[string]string{}}, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 0 {
		t.Errorf("hallazgos = %v", findings)
	}
	for _, c := range counts {
		if c.N == 0 {
			t.Errorf("la fuente %s no leyó nada: %v", c.Source, counts)
		}
	}
}

func TestAnEmptyExtractorIsAnErrorNotAPass(t *testing.T) {
	files := map[string]string{}
	for k, v := range english {
		if k != "server/x.go" {
			files[k] = v
		}
	}
	if _, _, err := Check(board(t, files), baseline(t), Allow{}, io.Discard); err == nil || !strings.Contains(err.Error(), "go") {
		t.Errorf("sin Go que leer tenía que fallar nombrando la fuente; dio %v", err)
	}
}
