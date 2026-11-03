// verify da el veredicto de una tarea POR SPEC: lee su sección `## Specs`, corre el comando que cita cada
// `S#` y contesta `S1 ✓ · S2 ✗`.
//
//	verify -n <id|slug> [-json] [-only S2]
//
// La sección, en el `task.md` (opcional; la plantilla la trae comentada):
//
//	## Specs
//
//	- **S1** · lo que tiene que ser cierto — «la cita de quien lo pidió» (Miguel, 2026-11-02)
//	  `make harness-case TARGET=local SUITE=harness/suites/compuerta-prami.json`
//	  sale: 0
//	  dir: harness
//
// `sale:` es la salida esperada (0 si no se dice), `dice:` un texto que la salida tiene que contener y `dir:`
// desde dónde se corre, relativo a la raíz.
//
// POR QUÉ EXISTE. Una tarea decía «hecho» con una casilla marcada, y el criterio vivía en la cabeza de quien la
// cerró. Idea tomada de ODD (Organic Driven Development): cada spec cita lo que se pidió y lleva su comprobación,
// así el veredicto se repite sin interpretar. Frente «un agente saca una tarea solo» de playground-local.
//
// ⚠ CORRE LO QUE ESTÁ ESCRITO EN UN ARCHIVO, y por eso no hay shell: el comando se parte en palabras, no admite
// `;`, `&&`, `|`, redirecciones ni `$(…)`, y sólo pasa si empieza por uno de los comandos de `allowed` (corridas
// del harness, chequeos y lecturas de bin/pg). El harness nunca contra prod; bin/pg sí, porque sólo lee.
//
// Sale 0 si todas pasan · 1 si alguna falla · 2 si la tarea no tiene specs o alguna no se puede correr.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/specs"
)

type result struct {
	specs.Spec
	OK      bool    `json:"ok"`
	Exit    int     `json:"exit"`
	Seconds float64 `json:"seconds"`
	Refused string  `json:"refused,omitempty"`
	Tail    string  `json:"tail,omitempty"`
}

var reEnv = regexp.MustCompile(`^[A-Z][A-Z0-9_]*=`)

// Los comandos que una spec puede correr: prefijos de palabras, después de las variables de entorno.
var allowed = [][]string{
	{"make", "harness-case"}, {"make", "harness-suite"}, {"make", "harness-listing"}, {"make", "harness-walk-wizard"},
	{"make", "harness-knowledge"}, {"make", "harness-doctor"}, {"make", "harness-regression"}, {"make", "harness-check"},
	{"make", "knowledge-check"}, {"make", "knowledge-test"}, {"make", "trampas"},
	{"npx", "playwright", "test"}, {"go", "test"},
	{"bin/pg", "sql"}, {"bin/pg", "request", "timeline"}, {"bin/pg", "client", "state"}, {"bin/pg", "client", "fields"},
	{"bin/pg", "experian", "check"}, {"bin/pg", "jobs", "failed"}, {"bin/pg", "events", "request"},
	{"bin/pg", "events", "errors"}, {"bin/pg", "settings", "diff"}, {"bin/pg", "logs"},
}

/* check: por qué NO se puede correr este comando, o "" si se puede. Devuelve también las variables de
 * entorno y el argv, ya partidos. */
func check(command string) (env, argv []string, refused string) {
	words, err := split(command)
	if err != nil {
		return nil, nil, err.Error()
	}
	for len(words) > 0 && reEnv.MatchString(words[0]) {
		env = append(env, words[0])
		words = words[1:]
	}
	match := false
	for _, a := range allowed {
		if len(words) >= len(a) && equal(words[:len(a)], a) {
			match = true
			break
		}
	}
	if !match {
		return nil, nil, "no está entre los comandos que una spec puede correr (cmd/verify, `allowed`)"
	}
	if words[0] != "bin/pg" {
		for _, w := range append(append([]string{}, env...), words...) {
			if w == "TARGET=prod" || w == "E2E_TARGET=prod" {
				return nil, nil, "el harness no corre contra prod; para leer prod, bin/pg"
			}
		}
	}
	if words[0] == "npx" && len(words) < 4 {
		return nil, nil, "npx playwright test sin ruta corre toda la colección (incluye el guiado interactivo)"
	}
	return env, words, ""
}

func equal(a, b []string) bool {
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// split: palabras separadas por espacios, con comillas simples o dobles para agruparlas (sin escapes). Un
// operador de shell FUERA de comillas es un error: `CASES='a;b'` es un argumento, `a; b` son dos comandos.
func split(s string) ([]string, error) {
	if strings.Contains(s, "\n") {
		return nil, fmt.Errorf("lleva un salto de línea; una spec corre UN comando")
	}
	var out []string
	var cur strings.Builder
	quote, in := rune(0), false
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote, in = r, true
		case strings.ContainsRune(";&|<>`$", r):
			return nil, fmt.Errorf("lleva operadores de shell fuera de comillas; una spec corre UN comando")
		case r == ' ' || r == '\t':
			if in {
				out = append(out, cur.String())
				cur.Reset()
				in = false
			}
		default:
			cur.WriteRune(r)
			in = true
		}
	}
	if quote != 0 {
		return nil, fmt.Errorf("comillas sin cerrar")
	}
	if in {
		out = append(out, cur.String())
	}
	return out, nil
}

func main() {
	n := flag.String("n", "", "la tarea: id o slug")
	asJSON := flag.Bool("json", false, "la salida como un objeto tablero.verify/v1")
	only := flag.String("only", "", "correr sólo estas specs: S1,S3")
	flag.Parse()
	if *n == "" {
		fmt.Fprintln(os.Stderr, "falta -n <id|slug>")
		os.Exit(2)
	}
	lay := layout.Find()
	root := filepath.Dir(lay.Tools())

	var task struct {
		ID    int    `json:"id"`
		Slug  string `json:"slug"`
		Title string `json:"title"`
	}
	cmd := exec.Command("go", "run", "./cmd/today", "-n", *n, "-json")
	cmd.Dir = filepath.Join(root, "tablero", "server")
	cmd.Stderr = os.Stderr
	raw, err := cmd.Output()
	if err != nil || json.Unmarshal(raw, &task) != nil {
		fmt.Fprintln(os.Stderr, "✗ no pude leer la tarea", *n)
		os.Exit(2)
	}
	body, err := os.ReadFile(filepath.Join(root, "tablero", "tasks", task.Slug, "task.md"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(2)
	}
	list := specs.Parse(string(body))
	if len(list) == 0 {
		fmt.Fprintf(os.Stderr, "  #%d %s no tiene `## Specs`: sin criterio de «hecho» que correr (la forma, en tablero/TASK-TEMPLATE.md)\n", task.ID, task.Title)
		os.Exit(2)
	}

	var results []result
	for _, s := range list {
		if *only != "" && !strings.Contains(","+*only+",", ","+s.ID+",") {
			continue
		}
		results = append(results, runSpec(root, s, *asJSON))
	}

	exit := 0
	for _, r := range results {
		if r.Refused != "" || r.Command == "" {
			exit = 2
			break
		}
		if !r.OK {
			exit = 1
		}
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		_ = enc.Encode(map[string]any{"format": "tablero.verify/v1", "task": task.ID, "slug": task.Slug, "ok": exit == 0, "specs": results})
		os.Exit(exit)
	}
	fmt.Printf("\n  VEREDICTO POR SPEC · #%d %s\n\n", task.ID, task.Title)
	var line []string
	for _, r := range results {
		mark := map[bool]string{true: "✓", false: "✗"}[r.OK]
		if r.Refused != "" || r.Command == "" {
			mark = "?"
		}
		line = append(line, r.ID+" "+mark)
		fmt.Printf("  %s %s · %s\n", mark, r.ID, r.What)
		switch {
		case r.Command == "":
			fmt.Println("      sin comando: la spec no dice cómo se comprueba")
		case r.Refused != "":
			fmt.Printf("      no se corrió: %s\n      %s\n", r.Refused, r.Command)
		default:
			says := ""
			if r.Says != "" {
				says = fmt.Sprintf(" y que diga «%s»", r.Says)
			}
			fmt.Printf("      sale %d (esperaba %d%s) · %.0fs · %s\n", r.Exit, r.Expect, says, r.Seconds, r.Command)
			if !r.OK && r.Tail != "" {
				for _, t := range strings.Split(r.Tail, "\n") {
					fmt.Printf("        │ %s\n", t)
				}
			}
		}
	}
	fmt.Printf("\n  %s\n\n", strings.Join(line, " · "))
	os.Exit(exit)
}

func runSpec(root string, s specs.Spec, quiet bool) result {
	r := result{Spec: s}
	if s.Command == "" {
		return r
	}
	env, argv, refused := check(s.Command)
	if refused != "" {
		r.Refused = refused
		return r
	}
	dir := root
	if s.Dir != "" {
		dir = filepath.Join(root, s.Dir)
		if rel, err := filepath.Rel(root, dir); err != nil || strings.HasPrefix(rel, "..") {
			r.Refused = "dir: sale de la raíz del playground"
			return r
		}
	}
	if !quiet {
		fmt.Fprintf(os.Stderr, "  ▸ %s …\n", s.ID)
	}
	c := exec.Command(argv[0], argv[1:]...)
	c.Dir = dir
	c.Env = append(os.Environ(), env...)
	var out bytes.Buffer
	c.Stdout, c.Stderr = &out, &out
	t0 := time.Now()
	err := c.Run()
	r.Seconds = time.Since(t0).Seconds()
	if ee, ok := err.(*exec.ExitError); ok {
		r.Exit = ee.ExitCode()
	} else if err != nil {
		r.Exit, r.Refused = -1, err.Error()
		return r
	}
	// `dice:` distingue POR QUÉ salió así: `make` devuelve 2 ante cualquier falla de la receta, así que una
	// negativa esperada y un error cualquiera tienen la misma salida.
	r.OK = r.Exit == s.Expect && (s.Says == "" || strings.Contains(out.String(), s.Says))
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) > 6 {
		lines = lines[len(lines)-6:]
	}
	r.Tail = strings.Join(lines, "\n")
	return r
}
