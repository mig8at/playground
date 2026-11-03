// agent arma, en UNA salida, lo que un agente necesita para arrancar una tarea del tablero: la tarea
// (lo mismo que `make retomar`), las trampas que pueden tocarla, si las fuentes de sus temas de
// `knowledge:` siguen al día, las suites que comprueban esos temas, el estado del ambiente local y el
// recorrido de trabajo con los comandos ya puestos.
//
//	agent -n <id|slug> [-json] [-env]
//
// POR QUÉ EXISTE. Hasta el 2026-11-02 arrancar una tarea eran cinco comandos (`retomar`, `knowledge-check`,
// el índice de síntomas de las trampas, `harness-doctor`, `harness-knowledge LIST=1`) y un agente se
// salteaba alguno. Las tres conclusiones falsas de esa sesión salieron de no mirar el ambiente o la fuente
// antes de concluir. Esto no decide nada: junta lo que ya existe y lo deja a la vista. El recorrido vive en
// `tablero/tasks/playground-local/task.md`, frente «un agente saca una tarea solo».
//
// `-env` corre `harness-doctor` contra local (tarda: mira migraciones con artisan). Sin él no se toca el
// ambiente. Sale 0 aunque haya avisos: el veredicto lo da el trabajo, no el arranque.
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
	"sort"
	"strings"

	"creditop/playground/lib/text"
	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/specs"
)

const format = "tablero.agent-brief/v1"

type brief struct {
	Format      string          `json:"format"`
	Task        json.RawMessage `json:"task"`
	Traps       traps           `json:"traps"`
	Knowledge   []topicState    `json:"knowledge"`
	Specs       []specs.Spec    `json:"specs"`
	Environment json.RawMessage `json:"environment,omitempty"`
	Steps       []step          `json:"steps"`
	Warnings    []string        `json:"warnings"`
}

type traps struct {
	BySymptom []symptomMatch `json:"bySymptom"`
	Cited     []trapLine     `json:"cited"`
}

type symptomMatch struct {
	Symptom string   `json:"symptom"`
	Traps   []string `json:"traps"`
	Shared  []string `json:"shared"`
}

type trapLine struct {
	ID   string `json:"id"`
	What string `json:"what"`
}

type topicState struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Changed []string `json:"changed"`
	Suites  []string `json:"suites"`
}

type step struct {
	N        int    `json:"n"`
	Question string `json:"question"`
	Command  string `json:"command"`
}

// Lo que se lee de `cmd/today -json`: sólo lo que este comando usa para cruzar.
type taskView struct {
	ID      int    `json:"id"`
	Slug    string `json:"slug"`
	Title   string `json:"title"`
	Pending []struct {
		What string `json:"what"`
		Done bool   `json:"done"`
	} `json:"pending"`
	Context []struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	} `json:"context"`
	Knowledge struct {
		Topics []struct {
			ID    string `json:"id"`
			Title string `json:"title"`
		} `json:"topics"`
	} `json:"knowledge"`
}

func main() {
	n := flag.String("n", "", "la tarea: id o slug")
	asJSON := flag.Bool("json", false, "la salida como un objeto tablero.agent-brief/v1")
	withEnv := flag.Bool("env", false, "correr harness-doctor contra local (tarda)")
	flag.Parse()
	if *n == "" {
		fmt.Fprintln(os.Stderr, "falta -n <id|slug>")
		os.Exit(2)
	}

	lay := layout.Find()
	root := filepath.Dir(lay.Tools())
	server := filepath.Join(root, "tablero", "server")

	raw, err := run(server, nil, "go", "run", "./cmd/today", "-n", *n, "-json")
	if err != nil {
		fmt.Fprintln(os.Stderr, "✗ no pude leer la tarea:", err)
		os.Exit(1)
	}
	var task taskView
	if err := json.Unmarshal(raw, &task); err != nil {
		fmt.Fprintln(os.Stderr, "✗ la tarea no devolvió JSON:", err)
		os.Exit(1)
	}

	b := brief{Format: format, Task: raw, Warnings: []string{}}
	doc, err := os.ReadFile(filepath.Join(lay.Data, "traps", "doc.md"))
	if err != nil {
		b.Warnings = append(b.Warnings, "no pude leer las trampas: "+err.Error())
	} else {
		b.Traps = matchTraps(text.SplitLines(string(doc)), task)
	}
	b.Knowledge, b.Warnings = knowledgeState(root, task, b.Warnings)
	b.Specs = []specs.Spec{}
	if doc, err := os.ReadFile(filepath.Join(root, "tablero", "tasks", task.Slug, "task.md")); err == nil {
		if list := specs.Parse(string(doc)); list != nil {
			b.Specs = list
		}
	}
	if *withEnv {
		out, err := run(filepath.Join(root, "harness"), []string{"E2E_TARGET=local"}, "node", "dev/doctor.ts", "--json")
		if line := lastLine(out); json.Valid(line) {
			b.Environment = line
		} else {
			b.Warnings = append(b.Warnings, fmt.Sprintf("harness-doctor no devolvió JSON: %v", err))
		}
	}
	b.Steps = steps(task)

	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", "  ")
		_ = enc.Encode(b)
		return
	}
	printText(b, task)
}

/* matchTraps: las trampas que pueden tocar la tarea, por dos caminos.
 *
 * - por SÍNTOMA: cada fila del «Índice · ¿con qué síntoma llegás?» contra las palabras de la tarea (título,
 *   pendientes abiertos y los títulos de la pila). Es léxico a propósito: propone, no decide, y una fila con
 *   dos palabras raras en común vale más que una con una común. Sólo cuentan las palabras de 5 letras o más.
 * - CITADAS: los `F-xx` que la tarea o su pila ya nombran, con su línea del índice de una línea. Son las que
 *   alguien ya cruzó con este trabajo. */
func matchTraps(lines []string, task taskView) traps {
	words := map[string]bool{}
	var cited []string
	add := func(s string) {
		for _, w := range tokens(s) {
			words[w] = true
		}
	}
	add(task.Title)
	for _, p := range task.Pending {
		if !p.Done {
			add(p.What)
		}
	}
	for _, c := range task.Context {
		add(c.Title)
		cited = append(cited, trapRe.FindAllString(c.Title+" "+c.Body, -1)...)
	}

	out := traps{BySymptom: []symptomMatch{}, Cited: []trapLine{}}
	oneLine := map[string]string{}
	section := ""
	for _, l := range lines {
		if strings.HasPrefix(l, "## ") {
			section = l
			continue
		}
		cells := strings.Split(l, "|")
		if len(cells) < 4 {
			continue
		}
		switch {
		case strings.Contains(section, "síntoma"):
			symptom := strings.ReplaceAll(text.Strip(cells[1]), "**", "")
			ids := trapRe.FindAllString(cells[2], -1)
			if len(ids) == 0 {
				continue
			}
			var shared []string
			for _, w := range uniq(tokens(symptom)) {
				if words[w] {
					shared = append(shared, w)
				}
			}
			if len(shared) >= 2 {
				out.BySymptom = append(out.BySymptom, symptomMatch{Symptom: symptom, Traps: ids, Shared: shared})
			}
		case strings.Contains(section, "una línea"):
			if id := text.Strip(cells[1]); trapRe.MatchString(id) {
				oneLine[id] = text.Strip(cells[2])
			}
		}
	}
	sort.SliceStable(out.BySymptom, func(i, j int) bool { return len(out.BySymptom[i].Shared) > len(out.BySymptom[j].Shared) })
	if len(out.BySymptom) > 8 {
		out.BySymptom = out.BySymptom[:8]
	}
	for _, id := range uniq(cited) {
		out.Cited = append(out.Cited, trapLine{ID: id, What: oneLine[id]})
	}
	if len(out.Cited) > 15 {
		out.Cited = out.Cited[:15]
	}
	return out
}

var (
	trapRe  = regexp.MustCompile(`F-[0-9]+`)
	wordRe  = regexp.MustCompile(`[\p{L}]{5,}`)
	suiteRe = regexp.MustCompile(`SUITE=(harness/suites/[A-Za-z0-9._-]+\.json)`)
)

// Palabras que aparecen en casi cualquier tarea y no distinguen nada.
var common = map[string]bool{
	"termina": true, "cuando": true, "entidad": true, "comercio": true, "solicitud": true, "sobre": true,
	"desde": true, "hasta": true, "porque": true, "puede": true, "tiene": true, "queda": true, "harness": true,
	"tarea": true, "estado": true, "local": true, "todos": true, "otros": true, "donde": true, "según": true,
	"ambiente": true, "prueba": true, "pruebas": true, "datos": true, "nadie": true, "mismo": true, "misma": true,
}

func tokens(s string) []string {
	var out []string
	for _, w := range wordRe.FindAllString(strings.ToLower(s), -1) {
		if !common[w] {
			out = append(out, w)
		}
	}
	return out
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

/* knowledgeState: por cada tema de `knowledge:`, qué fuentes cambiaron en main desde que se leyó (de
 * `knowledge check`) y qué suites lo comprueban corriendo (las `SUITE=` de su prosa). Un tema con fuentes
 * cambiadas se relee antes de citarlo; uno sin suite está leído, no corrido. */
func knowledgeState(root string, task taskView, warnings []string) ([]topicState, []string) {
	out := []topicState{}
	if len(task.Knowledge.Topics) == 0 {
		return out, warnings
	}
	changed := map[string][]string{}
	raw, err := run(root, nil, "go", "run", "./cmd/knowledge", "check", "--json")
	var states []struct{ Topic, Repo, Path, State string }
	if jerr := json.Unmarshal(raw, &states); jerr != nil {
		warnings = append(warnings, fmt.Sprintf("knowledge check no devolvió JSON: %v", err))
	}
	for _, s := range states {
		if s.State != "unchanged" {
			changed[s.Topic] = append(changed[s.Topic], fmt.Sprintf("%s/%s (%s)", s.Repo, s.Path, s.State))
		}
	}
	for _, t := range task.Knowledge.Topics {
		st := topicState{ID: t.ID, Title: t.Title, Changed: changed[t.ID], Suites: []string{}}
		if st.Changed == nil {
			st.Changed = []string{}
		}
		if prose, err := os.ReadFile(filepath.Join(root, "knowledge", t.ID, "rules.md")); err == nil {
			for _, m := range suiteRe.FindAllStringSubmatch(string(prose), -1) {
				st.Suites = append(st.Suites, m[1])
			}
			st.Suites = uniq(st.Suites)
		}
		out = append(out, st)
	}
	return out, warnings
}

// steps: el recorrido del frente «un agente saca una tarea solo», con la tarea ya puesta en cada comando.
func steps(task taskView) []step {
	id := fmt.Sprint(task.ID)
	return []step{
		{1, "¿qué pide, qué se hizo y qué se sabe?", "make retomar N=" + id + " · make knowledge-search Q='…'"},
		{2, "¿qué corrida dice «hecho», y contra qué ambiente?", "escribirla antes de tocar nada como S# en `## Specs` de la tarea, con su comando (el ambiente más chico)"},
		{3, "¿una corrida ahora diría la verdad?", "make harness-doctor TARGET=local · make keyring · en remoto, make harness-env-drift TARGET=…"},
		{4, "¿pasa, y cuánto?", "make harness-case|harness-listing|harness-walk-wizard TARGET=… JSON=1 · prod sólo lectura: bin/pg request timeline|events request|sql --target prod"},
		{5, "¿dónde se decide?", "git grep contra main en los DOS monolitos, o el subagente main-verifier"},
		{6, "¿lo arreglé sin romper otro flujo?", "make tarea-verify N=" + id + " (las S# del paso 2) · make harness-regression TARGET=local"},
		{7, "¿lo encuentra el próximo?", "BLOQUE=" + id + " en las corridas · make tarea-bloque N=" + id + " · knowledge/ si es mecanismo · traps/doc.md si es trampa"},
		{8, "¿quedó medido y entregado?", "make bitacora-add TAREA=" + id + " PULSO=HH:MM · make cierre · commit por ruta; push, PR, Jira o Canon sólo con el sí de Miguel"},
	}
}

func printText(b brief, task taskView) {
	open := 0
	for _, p := range task.Pending {
		if !p.Done {
			open++
		}
	}
	fmt.Printf("\n  AGENTE · #%d %s · %d pendiente(s) abierto(s) · %d bloque(s) recientes\n", task.ID, task.Title, open, len(task.Context))
	fmt.Printf("  (el detalle de la tarea: make retomar N=%d · todo junto: JSON=1)\n\n", task.ID)

	fmt.Println("  TRAMPAS que pueden tocarla")
	if len(b.Traps.BySymptom)+len(b.Traps.Cited) == 0 {
		fmt.Println("    ninguna por síntoma ni citada (que no haya no prueba nada: el índice es léxico)")
	}
	for _, m := range b.Traps.BySymptom {
		fmt.Printf("    %s  %s  [%s]\n", strings.Join(m.Traps, " · "), m.Symptom, strings.Join(m.Shared, ", "))
	}
	for _, c := range b.Traps.Cited {
		fmt.Printf("    %s  (citada en la tarea) %s\n", c.ID, truncate(c.What, 110))
	}

	fmt.Println("\n  CRITERIO DE HECHO")
	if len(b.Specs) == 0 {
		fmt.Println("    la tarea no tiene `## Specs`: escribí cada S# con su cita y su comando antes de tocar nada (tablero/TASK-TEMPLATE.md)")
	}
	for _, sp := range b.Specs {
		cmd := sp.Command
		if cmd == "" {
			cmd = "(sin comando)"
		}
		fmt.Printf("    %s · %s\n        %s\n", sp.ID, truncate(sp.What, 100), cmd)
	}
	if len(b.Specs) > 0 {
		fmt.Printf("    el veredicto: make tarea-verify N=%d\n", task.ID)
	}

	fmt.Println("\n  CONOCIMIENTO declarado")
	if len(b.Knowledge) == 0 {
		fmt.Println("    la tarea no declara `knowledge:` — buscá: make knowledge-search Q='…'")
	}
	for _, k := range b.Knowledge {
		state := "fuentes al día"
		if len(k.Changed) > 0 {
			state = fmt.Sprintf("⚠ %d fuente(s) cambiaron en main: releer antes de citar", len(k.Changed))
		}
		suites := "sin suite: leído, no corrido"
		if len(k.Suites) > 0 {
			suites = "se comprueba con " + strings.Join(k.Suites, ", ")
		}
		fmt.Printf("    %s · %s · %s\n", k.ID, state, suites)
	}

	if len(b.Environment) > 0 {
		var env struct {
			OK     bool `json:"ok"`
			Checks []struct {
				ID      string `json:"id"`
				OK      bool   `json:"ok"`
				Frena   bool   `json:"frena"`
				Detalle string `json:"detalle"`
			} `json:"checks"`
		}
		_ = json.Unmarshal(b.Environment, &env)
		fmt.Printf("\n  AMBIENTE local · %s\n", map[bool]string{true: "nada frena", false: "✗ algo FRENA: una corrida mentiría"}[env.OK])
		for _, c := range env.Checks {
			if !c.OK {
				fmt.Printf("    %s %s · %s\n", map[bool]string{true: "✗", false: "⚠"}[c.Frena], c.ID, truncate(c.Detalle, 110))
			}
		}
	} else {
		fmt.Println("\n  AMBIENTE · no se miró (ENV=1 corre harness-doctor contra local)")
	}

	fmt.Println("\n  RECORRIDO")
	for _, s := range b.Steps {
		fmt.Printf("    %d · %s\n        %s\n", s.N, s.Question, s.Command)
	}
	for _, w := range b.Warnings {
		fmt.Println("\n  ⚠", w)
	}
	fmt.Println()
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func run(dir string, env []string, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = os.Stderr
	err := cmd.Run()
	return out.Bytes(), err
}

func lastLine(b []byte) []byte {
	lines := bytes.Split(bytes.TrimSpace(b), []byte("\n"))
	return lines[len(lines)-1]
}
