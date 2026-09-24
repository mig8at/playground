package naming

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// ── la vara: frecuencias de las bibliotecas estándar ──────────────────────────────────────────────

func goEnv(key string) (string, error) {
	out, err := exec.Command("go", "env", key).Output()
	return strings.TrimSpace(string(out)), err
}

// pythonStdlib: dónde está la biblioteca estándar de Python y qué versión es. Se le pregunta al
// intérprete porque es el único que lo sabe; la vara es su código, no el del playground.
func pythonStdlib() (string, string, error) {
	out, err := exec.Command("python3", "-c",
		`import sys, sysconfig; print(sysconfig.get_paths()["stdlib"]); print(sys.version.split()[0])`).Output()
	if err != nil {
		return "", "", fmt.Errorf("no pude preguntarle a python3 dónde está su biblioteca estándar: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 2 {
		return "", "", fmt.Errorf("python3 contestó algo inesperado: %q", out)
	}
	return lines[0], lines[1], nil
}

var identifier = regexp.MustCompile(`[A-Za-z][A-Za-z0-9_]*`)

// dropInvalid saca los bytes que no son UTF-8, como el `errors="ignore"` con que se leía antes.
func dropInvalid(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var sb strings.Builder
	for len(b) > 0 {
		r, size := utf8.DecodeRune(b)
		if !(r == utf8.RuneError && size == 1) {
			sb.Write(b[:size])
		}
		b = b[size:]
	}
	return sb.String()
}

func countTree(root, suffix string, counts map[string]int) {
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != root && (d.Name() == "site-packages" || d.Name() == "__pycache__") {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(d.Name(), suffix) {
			return nil
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return nil
		}
		for _, tok := range identifier.FindAllString(dropInvalid(raw), -1) {
			for _, word := range SplitWords(tok) {
				counts[word]++
			}
		}
		return nil
	})
}

type baselineFile struct {
	Versions  string         `json:"versions"`
	Threshold int            `json:"threshold"`
	Counts    map[string]int `json:"counts"`
}

// Baseline: cuántas veces aparece cada palabra en las bibliotecas estándar de Go y de Python. Se arma
// la primera vez (unos segundos) y queda en `cache`, atada a las dos versiones: otra versión, otra vara.
func Baseline(cache string) (map[string]int, error) {
	goVersion, err := goEnv("GOVERSION")
	if err != nil {
		return nil, fmt.Errorf("go env GOVERSION: %w", err)
	}
	stdlib, pyVersion, err := pythonStdlib()
	if err != nil {
		return nil, err
	}
	versions := goVersion + " · python " + pyVersion
	if raw, err := os.ReadFile(cache); err == nil {
		var cached baselineFile
		if json.Unmarshal(raw, &cached) == nil && cached.Versions == versions && cached.Counts != nil {
			return cached.Counts, nil
		}
	}
	goroot, err := goEnv("GOROOT")
	if err != nil {
		return nil, fmt.Errorf("go env GOROOT: %w", err)
	}
	counts := map[string]int{}
	countTree(filepath.Join(goroot, "src"), ".go", counts)
	countTree(stdlib, ".py", counts)
	for w, n := range counts {
		if n < Threshold {
			delete(counts, w)
		}
	}
	if err := os.MkdirAll(filepath.Dir(cache), 0o755); err == nil {
		if raw, err := json.Marshal(baselineFile{versions, Threshold, counts}); err == nil {
			_ = os.WriteFile(cache, raw, 0o644)
		}
	}
	return counts, nil
}

// ── el chequeo ────────────────────────────────────────────────────────────────────────────────────

// Board es lo que se recorre, relativo a su raíz. Una fuente sin patrones no se lee ni se cuenta: el
// código compartido no tiene Vue, y eso no es un extractor que falló.
type Board struct {
	Name        string   // cómo se llama la pasada en el resumen
	Root        string   // la carpeta desde la que se miden las rutas
	GoRoots     []string // árboles de Go
	JSONRoots   []string // árboles de Go cuyas claves JSON se revisan
	JSGlobs     []string
	PyGlobs     []string
	DeclsScript string   // el extractor de Vue/JS
	PathRoots   []string // prefijos de las rutas que se revisan; vacío = todo lo que git sigue bajo Root
}

// Default es el tablero de verdad.
func Default(root string) Board {
	return Board{
		Name:        "tablero",
		Root:        root,
		GoRoots:     []string{"server", "tools/rename/go"},
		JSONRoots:   []string{"server"},
		JSGlobs:     []string{"src/*.vue", "src/*.js", "tests/*.js", "tools/rename/js/*.mjs"},
		PyGlobs:     []string{"tools/*.py", "tools/rename/py/*.py"},
		DeclsScript: filepath.Join(root, "tools", "rename", "js", "decls.mjs"),
	}
}

// Shared es el código que usan todas las herramientas, en la raíz del playground: los conectores, el
// binario que los expone y las bibliotecas. Hasta el 2026-09-24 vivía adentro del tablero y lo cubría su
// pasada; al mudarse quedó sin vara, y el conteo de Go del tablero bajó de 6.100 a 5.292 sin avisar.
func Shared(root string) Board {
	trees := []string{"connectors", "cmd", "lib"}
	return Board{
		Name:        "compartido",
		Root:        root,
		GoRoots:     trees,
		JSONRoots:   trees,
		JSGlobs:     []string{"tools/*.js", "tools/*.mjs", "tools/ui/*.js"},
		PyGlobs:     []string{"tools/*.py", "twilio/*.py"},
		DeclsScript: filepath.Join(root, "tablero", "tools", "rename", "js", "decls.mjs"),
		PathRoots:   []string{"connectors/", "cmd/", "lib/", "bin/", "tools/", "twilio/"},
	}
}

// Tracer es el Go del trazador. Sus claves JSON son el contrato con su UI en Vue y se pasan a inglés
// junto con ella, así que por ahora las acepta una regla de la lista; lo que se revisa es el código.
func Tracer(root string) Board {
	return Board{
		Name:      "trazador",
		Root:      root,
		GoRoots:   []string{"trazador/server"},
		JSONRoots: []string{"trazador/server"},
		PyGlobs:   []string{"trazador/tools/*.py"},
		PathRoots: []string{"trazador/server/", "trazador/tools/"},
	}
}

// Finding es un nombre con palabras que no pasan como inglés.
type Finding struct {
	Where string   `json:"where"`
	Name  string   `json:"name"`
	Kind  string   `json:"kind"`
	Words []string `json:"words"`
}

// Count: cuántos nombres se leyeron de una fuente. Van en orden, para imprimirlos siempre igual.
type Count struct {
	Source string
	N      int
}

func rel(board, path string) string {
	if r, err := filepath.Rel(board, path); err == nil {
		return r
	}
	return path
}

// Check revisa el tablero contra la vara y la lista. ⚠ Una fuente con cero nombres es un ERROR, no un
// verde: un extractor que no devuelve nada daría «todo en inglés» sin haber mirado. La de Python sólo
// cuenta si hay archivos de Python que leer: el día que no quede ninguno, no hay nada que mirar ahí.
func Check(b Board, baseline map[string]int, allow Allow, errs io.Writer) ([]Finding, []Count, error) {
	var goDecls []Decl
	for _, r := range b.GoRoots {
		goDecls = append(goDecls, GoDecls(filepath.Join(b.Root, r), errs)...)
	}
	type rootedKey struct {
		root string
		Key
	}
	var keys []rootedKey
	for _, r := range b.JSONRoots {
		for _, k := range JSONKeys(filepath.Join(b.Root, r)) {
			keys = append(keys, rootedKey{r, k})
		}
	}
	var jsDecls []Decl
	if len(b.JSGlobs) > 0 {
		var err error
		if jsDecls, err = JSDecls(b.DeclsScript, Glob(b.Root, b.JSGlobs)); err != nil {
			return nil, nil, err
		}
	}
	pyFiles := Glob(b.Root, b.PyGlobs)
	pyDecls, err := PyDecls(pyFiles)
	if err != nil {
		return nil, nil, err
	}
	tracked, err := TrackedPaths(b.Root)
	if err != nil {
		return nil, nil, err
	}
	if len(b.PathRoots) > 0 {
		var within []string
		for _, p := range tracked {
			for _, prefix := range b.PathRoots {
				if strings.HasPrefix(p, prefix) {
					within = append(within, p)
					break
				}
			}
		}
		tracked = within
	}
	paths := PathNames(tracked)

	var counts []Count
	if len(b.GoRoots) > 0 {
		counts = append(counts, Count{"go", len(goDecls)})
	}
	if len(b.JSGlobs) > 0 {
		counts = append(counts, Count{"vue/js", len(jsDecls)})
	}
	if len(pyFiles) > 0 {
		counts = append(counts, Count{"python", len(pyDecls)})
	}
	if len(b.JSONRoots) > 0 {
		counts = append(counts, Count{"claves json", len(keys)})
	}
	counts = append(counts, Count{"rutas", len(paths)})
	var empty []string
	for _, c := range counts {
		if c.N == 0 {
			empty = append(empty, c.Source)
		}
	}
	if len(empty) > 0 {
		return nil, counts, fmt.Errorf("✗ %s: no se leyó ningún nombre de: %s — el chequeo no miró nada ahí", b.Name, strings.Join(empty, ", "))
	}

	var findings []Finding
	for _, decls := range [][]Decl{goDecls, jsDecls, pyDecls} {
		for _, d := range decls {
			if bad := ForeignWords(d.Name, baseline, allow.Words); len(bad) > 0 {
				findings = append(findings, Finding{fmt.Sprintf("%s:%d", rel(b.Root, d.Path), d.Line), d.Name, d.Kind, bad})
			}
		}
	}
	for _, k := range keys {
		where := k.root + "/" + k.Path
		if JSONAllowed(where, k.Kind, k.Ctx, k.Key.Key, allow.JSON) {
			continue
		}
		if bad := ForeignWords(k.Key.Key, baseline, allow.Words); len(bad) > 0 {
			findings = append(findings, Finding{fmt.Sprintf("%s:%d", where, k.Line), k.Key.Key, "json (" + k.Kind + ")", bad})
		}
	}
	for _, p := range paths {
		if _, ok := allow.Paths[p.Rel]; ok {
			continue
		}
		if bad := ForeignWords(p.Stem, baseline, allow.Words); len(bad) > 0 {
			findings = append(findings, Finding{p.Rel, filepath.Base(p.Rel), "path", bad})
		}
	}
	return findings, counts, nil
}

// Seen: «5628 go · 1403 vue/js · …», lo que se leyó de cada fuente.
func Seen(counts []Count) string {
	parts := make([]string, len(counts))
	for i, c := range counts {
		parts[i] = fmt.Sprintf("%d %s", c.N, c.Source)
	}
	return strings.Join(parts, " · ")
}

// ByWord agrupa los hallazgos por palabra: las más usadas primero, y a igual uso por orden alfabético.
func ByWord(findings []Finding) []struct {
	Word  string
	Names []string
} {
	names := map[string][]string{}
	for _, f := range findings {
		for _, w := range f.Words {
			names[w] = append(names[w], f.Name)
		}
	}
	out := make([]struct {
		Word  string
		Names []string
	}, 0, len(names))
	for w, ns := range names {
		out = append(out, struct {
			Word  string
			Names []string
		}{w, ns})
	}
	sort.Slice(out, func(i, j int) bool {
		if len(out[i].Names) != len(out[j].Names) {
			return len(out[i].Names) > len(out[j].Names)
		}
		return out[i].Word < out[j].Word
	})
	return out
}
