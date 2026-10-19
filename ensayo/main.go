// ensayo: ¿un cambio al playground (un CLAUDE.md, una skill, un hook, una memoria) mejora lo que hace el
// modelo, o sólo lo cambia? Corre las preguntas fijas de preguntas.json con `claude -p`, las califica con
// un juez que no es un modelo (el harness, la base, `git grep`) y compara dos tandas: la de antes del
// cambio y la de después, en el mismo checkout.
//
//	go run ./ensayo -tanda base [-n 3] [-solo listado-local,…] [-budget 1.5] [-seco]
//	go run ./ensayo -comparar base,recorte [-json]
//
// Las tandas quedan en ensayo/.tandas/<tanda>.json (fuera de git). La salida de `-comparar` es el
// veredicto: 0 = B se puede adoptar, 1 = no.
package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"creditop/playground/radar/scan"
)

// Batch es una tanda: las corridas y lo que dijo cada juez.
type Batch struct {
	Name    string             `json:"name"`
	Created time.Time          `json:"created"`
	Commit  string             `json:"commit"` // el HEAD del playground cuando corrió: qué versión se midió
	Prints  map[string]string  `json:"fingerprints"`
	Judges  map[string]Verdict `json:"judges"`
	Runs    []Run              `json:"runs"`
}

var batchName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// allowed: lo que una corrida puede hacer sin preguntar. En `-p` lo demás se niega solo, y eso cuenta
// como fricción. Lectura, `make` de consulta y `bin/pg`; nada que edite el repo ni escriba hacia afuera.
var allowed = []string{
	"Read", "Grep", "Glob", "Skill",
	"Bash(make harness-*)", "Bash(E2E_TARGET=local make harness-*)", "Bash(make knowledge-*)",
	"Bash(make tablero-db *)", "Bash(make retomar *)", "Bash(make trampas *)",
	"Bash(bin/pg sql *)", "Bash(bin/pg logs *)", "Bash(bin/pg events *)",
	"Bash(git grep *)", "Bash(git -C *)", "Bash(git show *)", "Bash(git log *)",
	"Bash(grep *)", "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)",
	"Bash(go run ./cmd/repos *)",
}

var denied = []string{
	"Edit", "Write", "NotebookEdit",
	"Bash(git commit *)", "Bash(git push *)", "Bash(git add *)",
	"Bash(make harness-allied-create *)", "Bash(make harness-payment-link *)", "Bash(*--apply*)",
}

func findRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "ensayo", "preguntas.json")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("no encontré ensayo/preguntas.json subiendo desde acá")
		}
		dir = parent
	}
}

func loadQuestions(root string) ([]Question, error) {
	raw, err := os.ReadFile(filepath.Join(root, "ensayo", "preguntas.json"))
	if err != nil {
		return nil, err
	}
	var doc struct {
		Questions []Question `json:"questions"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("preguntas.json: %w", err)
	}
	return doc.Questions, nil
}

// fingerprint: si cambia, la pregunta ya no es la misma y comparar tandas deja de valer.
func fingerprint(q Question) string {
	b, _ := json.Marshal([]any{q.Prompt, q.Judge, q.Must, q.MustNot})
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])[:12]
}

func batchPath(root, name string) string {
	return filepath.Join(root, "ensayo", ".tandas", name+".json")
}

func loadBatch(root, name string) (Batch, error) {
	var b Batch
	raw, err := os.ReadFile(batchPath(root, name))
	if err != nil {
		return b, err
	}
	return b, json.Unmarshal(raw, &b)
}

func saveBatch(root string, b Batch) error {
	if err := os.MkdirAll(filepath.Dir(batchPath(root, b.Name)), 0o755); err != nil {
		return err
	}
	raw, _ := json.MarshalIndent(b, "", "  ")
	return os.WriteFile(batchPath(root, b.Name), raw, 0o644)
}

// childEnv: el ambiente de las corridas y los jueces, sin `E2E_TARGET`. Que el modelo lo diga es parte
// de lo que se mide (por defecto es dev).
func childEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "E2E_TARGET=") {
			env = append(env, kv)
		}
	}
	return env
}

func judge(root string, q Question) Verdict {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "bash", "-c", "set -o pipefail; "+q.Judge)
	cmd.Dir, cmd.Env = root, childEnv()
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	if err := cmd.Run(); err != nil {
		return Verdict{Error: fmt.Sprintf("%v: %s", err, tail(errb.String()+out.String(), 300))}
	}
	var tokens []string
	for _, line := range strings.Split(out.String(), "\n") {
		if t := strings.TrimSpace(line); t != "" {
			tokens = append(tokens, t)
		}
	}
	if len(tokens) == 0 {
		return Verdict{Error: "el juez no imprimió nada: no se sabe qué es lo correcto"}
	}
	return Verdict{Tokens: tokens}
}

func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > n {
		return "…" + string(r[len(r)-n:])
	}
	return s
}

// ask corre una pregunta con `claude -p` en la raíz del playground.
func ask(root string, q Question, budget float64) (Run, error) {
	r := Run{Question: q.ID}
	args := []string{"-p", q.Prompt, "--output-format", "json",
		"--max-budget-usd", fmt.Sprintf("%.2f", budget),
		"--allowedTools", strings.Join(allowed, ","),
		"--disallowedTools", strings.Join(denied, ","),
		// los repos reales, como en una sesión normal: sin esto el permiso frena todo `git -C` a main
		"--add-dir", filepath.Join(os.Getenv("HOME"), "Desktop", "CREDITOP", "github")}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, "claude", args...)
	cmd.Dir, cmd.Env = root, childEnv()
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	runErr := cmd.Run()
	var res struct {
		Result    string  `json:"result"`
		SessionID string  `json:"session_id"`
		Cost      float64 `json:"total_cost_usd"`
		Turns     int     `json:"num_turns"`
		Millis    int     `json:"duration_ms"`
		IsError   bool    `json:"is_error"`
		Subtype   string  `json:"subtype"`
	}
	if err := json.Unmarshal(out.Bytes(), &res); err != nil {
		if runErr != nil {
			return r, fmt.Errorf("claude -p: %v: %s", runErr, tail(errb.String(), 300))
		}
		return r, fmt.Errorf("claude -p no devolvió JSON: %s", tail(out.String(), 300))
	}
	r.Answer, r.Session, r.CostUSD, r.Turns, r.Millis = res.Result, res.SessionID, res.Cost, res.Turns, res.Millis
	if res.IsError || runErr != nil {
		r.Error = "la corrida terminó con error: " + res.Subtype
	}
	return r, nil
}

// transcript: dónde guardó Claude Code la sesión de una corrida.
func transcript(root, session string) (string, error) {
	projects := filepath.Join(os.Getenv("HOME"), ".claude", "projects")
	for _, dir := range scan.TranscriptDirs(projects, root) {
		p := filepath.Join(dir, session+".jsonl")
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("no está la transcripción de la sesión %s", session)
}

// fullCalls: cada llamada de la sesión (id → texto entero) (radar las corta a 160 caracteres, y un
// `TARGET=` al final se perdería). Bash va como su comando; lo demás, como su entrada en JSON.
func fullCalls(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	calls := map[string]string{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for sc.Scan() {
		var ev struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		var blocks []struct {
			Type  string          `json:"type"`
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		}
		if json.Unmarshal(ev.Message.Content, &blocks) != nil {
			continue
		}
		for _, b := range blocks {
			if b.Type != "tool_use" {
				continue
			}
			var in struct {
				Command string `json:"command"`
			}
			if b.Name == "Bash" && json.Unmarshal(b.Input, &in) == nil {
				calls[b.ID] = "Bash " + in.Command
			} else {
				calls[b.ID] = b.Name + " " + string(b.Input)
			}
		}
	}
	return calls, sc.Err()
}

func headCommit(root string) string {
	out, err := exec.Command("git", "-C", root, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return ""
	}
	dirty := ""
	if st, _ := exec.Command("git", "-C", root, "status", "--porcelain", "--untracked-files=no").Output(); len(st) > 0 {
		dirty = "+cambios"
	}
	return strings.TrimSpace(string(out)) + dirty
}

func runBatch(root, name string, qs []Question, n int, budget float64, dry bool) error {
	b, err := loadBatch(root, name)
	if errors.Is(err, os.ErrNotExist) {
		b = Batch{Name: name, Created: time.Now()}
	} else if err != nil {
		return err
	}
	if b.Prints == nil {
		b.Prints, b.Judges = map[string]string{}, map[string]Verdict{}
	}
	b.Commit = headCommit(root)
	for _, q := range qs {
		if old, ok := b.Prints[q.ID]; ok && old != fingerprint(q) {
			return fmt.Errorf("%s cambió desde que se empezó la tanda %q: usá otra tanda", q.ID, name)
		}
		b.Prints[q.ID] = fingerprint(q)
		v := judge(root, q)
		b.Judges[q.ID] = v
		if v.Error != "" {
			fmt.Printf("⚠ %-18s sin juez: %s\n", q.ID, v.Error)
		} else {
			fmt.Printf("  %-18s juez: %s\n", q.ID, strings.Join(v.Tokens, " · "))
		}
	}
	if dry {
		fmt.Println("\n(-seco: sólo corrieron los jueces; ninguna pregunta fue al modelo)")
		return nil
	}
	if err := saveBatch(root, b); err != nil {
		return err
	}
	for _, q := range qs {
		for i := 0; i < n; i++ {
			r, err := ask(root, q, budget)
			if err != nil {
				r.Error = err.Error()
			} else if r.Session != "" {
				if path, err := transcript(root, r.Session); err != nil {
					r.Error = err.Error()
				} else {
					calls, err := fullCalls(path)
					s, err2 := scan.ReadSession(path)
					if err != nil || err2 != nil {
						r.Error = fmt.Sprint("leyendo la transcripción: ", errors.Join(err, err2))
					}
					// el desenlace de cada llamada lo decide radar, con su mismo criterio
					var ok, all []string
					for _, c := range s.Calls {
						text := calls[c.ID]
						all = append(all, text)
						if c.Outcome == scan.OutcomeOK {
							ok = append(ok, text)
						}
					}
					if err := Score(&r, q, b.Judges[q.ID], ok, all); err != nil {
						return err
					}
				}
			}
			b.Runs = append(b.Runs, r)
			if err := saveBatch(root, b); err != nil {
				return err
			}
			fmt.Printf("  %-18s %d/%d  %s\n", q.ID, i+1, n, describe(r))
		}
	}
	fmt.Printf("\ntanda %q: %d corridas en %s\n", name, len(b.Runs), batchPath(root, name))
	return nil
}

func describe(r Run) string {
	if r.Error != "" {
		return "✗ " + r.Error
	}
	verdict := "sin juez"
	if r.Graded && r.Correct {
		verdict = "✓ acierto"
	} else if r.Graded {
		verdict = "✗ faltó " + strings.Join(r.Missing, ", ")
	}
	route := "ruta ok"
	if !r.RouteOK {
		route = "ruta: " + strings.Join(r.RouteBad, "; ")
	}
	return fmt.Sprintf("%s · %s · fricción %d · US$%.2f · %d turnos", verdict, route, r.Friction, r.CostUSD, r.Turns)
}

func compareBatches(root, pair string, asJSON bool) (bool, error) {
	names := strings.Split(pair, ",")
	if len(names) != 2 {
		return false, errors.New("-comparar va con dos tandas: A,B")
	}
	a, err := loadBatch(root, names[0])
	if err != nil {
		return false, fmt.Errorf("tanda %s: %w", names[0], err)
	}
	b, err := loadBatch(root, names[1])
	if err != nil {
		return false, fmt.Errorf("tanda %s: %w", names[1], err)
	}
	for id, fa := range a.Prints {
		if fb, ok := b.Prints[id]; ok && fa != fb {
			return false, fmt.Errorf("%s no es la misma pregunta en %s y en %s: no se comparan", id, a.Name, b.Name)
		}
	}
	rows, adopt := Compare(a.Runs, b.Runs)
	if asJSON {
		raw, _ := json.MarshalIndent(map[string]any{"a": a.Name, "b": b.Name, "commit_a": a.Commit,
			"commit_b": b.Commit, "rows": rows, "adopt": adopt}, "", "  ")
		fmt.Println(string(raw))
		return adopt, nil
	}
	fmt.Printf("A = %s (%s)   B = %s (%s)\n\n", a.Name, a.Commit, b.Name, b.Commit)
	fmt.Printf("%-18s %-9s %-9s %-9s %-11s %-13s %s\n", "pregunta", "acierto", "ruta", "fricción", "US$", "", "")
	for _, r := range rows {
		fmt.Printf("%-18s %-9s %-9s %-9s %-11s %-6s %s\n", r.Question,
			pairOf(ratio(r.A.Correct, r.A.Graded), ratio(r.B.Correct, r.B.Graded)),
			pairOf(ratio(r.A.RouteOK, r.A.Runs), ratio(r.B.RouteOK, r.B.Runs)),
			pairOf(fmt.Sprintf("%.1f", r.A.Friction), fmt.Sprintf("%.1f", r.B.Friction)),
			pairOf(fmt.Sprintf("%.2f", r.A.Cost), fmt.Sprintf("%.2f", r.B.Cost)),
			r.Status, r.Reason)
	}
	if adopt {
		fmt.Println("\n→ B no empeora ninguna pregunta y mejora alguna: se puede adoptar.")
	} else {
		fmt.Println("\n→ B no se adopta: empeora alguna pregunta, o no mejora ninguna.")
	}
	return adopt, nil
}

func ratio(k, n int) string {
	if n == 0 {
		return "—"
	}
	return fmt.Sprintf("%d/%d", k, n)
}

func pairOf(a, b string) string { return a + "→" + b }

func main() {
	name := flag.String("tanda", "", "el nombre de la tanda que se corre (se agrega si ya existe)")
	n := flag.Int("n", 3, "corridas por pregunta: una sola es ruido")
	only := flag.String("solo", "", "sólo estas preguntas, separadas por coma")
	budget := flag.Float64("budget", 1.5, "tope en US$ por corrida")
	dry := flag.Bool("seco", false, "sólo corre los jueces: no gasta modelo")
	pair := flag.String("comparar", "", "A,B: compara dos tandas")
	asJSON := flag.Bool("json", false, "con -comparar: la salida en JSON")
	flag.Parse()

	root, err := findRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "ensayo:", err)
		os.Exit(2)
	}
	if *pair != "" {
		adopt, err := compareBatches(root, *pair, *asJSON)
		if err != nil {
			fmt.Fprintln(os.Stderr, "ensayo:", err)
			os.Exit(2)
		}
		if !adopt {
			os.Exit(1)
		}
		return
	}
	if !batchName.MatchString(*name) {
		fmt.Fprintln(os.Stderr, "ensayo: falta -tanda <nombre> (minúsculas, números y guiones)")
		os.Exit(2)
	}
	qs, err := loadQuestions(root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "ensayo:", err)
		os.Exit(2)
	}
	if *only != "" {
		keep := map[string]bool{}
		for _, id := range strings.Split(*only, ",") {
			keep[strings.TrimSpace(id)] = true
		}
		var sel []Question
		for _, q := range qs {
			if keep[q.ID] {
				sel = append(sel, q)
				delete(keep, q.ID)
			}
		}
		for id := range keep {
			fmt.Fprintf(os.Stderr, "ensayo: no hay una pregunta %q\n", id)
			os.Exit(2)
		}
		qs = sel
	}
	if err := runBatch(root, *name, qs, *n, *budget, *dry); err != nil {
		fmt.Fprintln(os.Stderr, "ensayo:", err)
		os.Exit(1)
	}
}
