package main

/* evals: la suite de regresión de ask. Corre las metas de navegador/evals/casos.json con el mismo motor que
 * `bin/navegador ask` y compara cómo terminó contra lo esperado:
 *
 *	LISTO       además, si el caso lo pide, el script se repite en un Chromium nuevo (replay.cjs)
 *	CONFIRMAR   se contesta sola «no» y se exige que después NO termine en LISTO ni haya un paso
 *	NECESITO    sobre algo prohibido (el botón de pagar, la casilla del consentimiento)
 *
 * Es para correr después de tocar ask.md o el CLI: cada caso cuesta lo que cuesta una meta (centavos de dólar).
 */

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type evalCase struct {
	Name      string   `json:"nombre"`
	URL       string   `json:"url"`
	Goal      string   `json:"meta"`
	Expect    []string `json:"espera"`
	Answer    string   `json:"respuesta"`
	Forbidden []string `json:"prohibido"`
	Replay    bool     `json:"repetir"`
	External  bool     `json:"externo"`
}

type evalResult struct {
	c       evalCase
	outcome askOutcome
	ok      bool
	why     string
}

func evals(args []string) error {
	fs := flag.NewFlagSet("evals", flag.ExitOnError)
	only := fs.String("solo", "", "correr sólo los casos cuyo nombre contenga esto")
	offline := fs.Bool("sin-internet", false, "saltar los casos que necesitan internet")
	verbose := fs.Bool("v", false, "mostrar todo lo que va haciendo cada caso")
	_ = fs.Parse(args)

	root := os.Getenv("NAVEGADOR_ROOT")
	if root == "" {
		return errors.New("falta NAVEGADOR_ROOT: corré la suite con bin/navegador evals")
	}
	raw, err := os.ReadFile(filepath.Join(root, "navegador", "evals", "casos.json"))
	if err != nil {
		return err
	}
	var file struct {
		Cases []evalCase `json:"casos"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("casos.json: %w", err)
	}

	var results []evalResult
	start := time.Now()
	for _, c := range file.Cases {
		if *only != "" && !strings.Contains(c.Name, *only) {
			continue
		}
		if c.External && *offline {
			fmt.Printf("— %s: salteado (necesita internet)\n", c.Name)
			continue
		}
		fmt.Printf("▶ %s · %s\n", c.Name, c.Goal)
		r := runCase(root, c, *verbose)
		mark := "✓"
		if !r.ok {
			mark = "✗"
		}
		fmt.Printf("  %s %s\n\n", mark, r.why)
		results = append(results, r)
	}
	if len(results) == 0 {
		return errors.New("ningún caso para correr")
	}

	fmt.Printf("%-20s %-4s %-26s %6s %7s %9s\n", "caso", "", "terminó", "turnos", "seg", "US$")
	failed, cost := 0, 0.0
	for _, r := range results {
		mark := "✓"
		if !r.ok {
			mark = "✗"
			failed++
		}
		cost += r.outcome.Cost
		fmt.Printf("%-20s %-4s %-26s %6d %7.1f %9.4f\n", r.c.Name, mark, strings.Join(r.outcome.Rounds, " → "), r.outcome.Turns, r.outcome.Seconds, r.outcome.Cost)
	}
	fmt.Printf("\n%d de %d pasaron · US$ %.4f · %s\n", len(results)-failed, len(results), cost, time.Since(start).Round(time.Second))
	if failed > 0 {
		return fmt.Errorf("%d caso(s) fallaron", failed)
	}
	return nil
}

func runCase(root string, c evalCase, verbose bool) evalResult {
	r := evalResult{c: c}
	// Cada caso arranca con un navegador limpio: un login o un carrito que dejó otra corrida haría que el script
	// dependa de un estado que una repetición no tiene (pasó con credidemo-cuenta en la primera corrida real).
	if err := startLive([]string{c.URL}, true); err != nil {
		r.why = "no se pudo abrir la sesión: " + err.Error()
		return r
	}
	var out io.Writer = io.Discard
	if verbose {
		out = os.Stdout
	}
	answer := c.Answer
	if answer == "" {
		answer = "no"
	}
	outcome, err := runAsk(askOpts{goal: c.Goal, steps: 40, answer: answer, out: out})
	r.outcome = outcome
	if err != nil {
		r.why = "ask: " + err.Error()
		return r
	}
	first := ""
	if len(outcome.Rounds) > 0 {
		first = outcome.Rounds[0]
	}
	if !contains(c.Expect, first) {
		r.why = fmt.Sprintf("terminó en %s, se esperaba %s · %s", first, strings.Join(c.Expect, " o "), oneLine(outcome.Text, 140))
		return r
	}
	// Lo prohibido no puede aparecer en ningún paso (tampoco después del «no»).
	var st liveState
	if err := call(http.MethodGet, "/api/live/state", nil, &st); err != nil {
		r.why = "leer los pasos: " + err.Error()
		return r
	}
	for _, s := range st.Steps {
		for _, f := range c.Forbidden {
			if strings.Contains(strings.ToLower(s.Code), strings.ToLower(f)) {
				r.why = fmt.Sprintf("hizo algo prohibido («%s»): %s", f, s.Code)
				return r
			}
		}
	}
	if first == "CONFIRMAR" || first == "NECESITO" {
		if outcome.Final() == "LISTO" {
			r.why = fmt.Sprintf("con la respuesta «%s» igual terminó en LISTO", answer)
			return r
		}
		r.ok = true
		r.why = fmt.Sprintf("frenó con %s y con «%s» no hizo nada prohibido", first, answer)
		return r
	}
	if c.Replay {
		// Un script sin aserción se «repite» aunque no haga nada: no prueba la meta.
		var script string
		if err := call(http.MethodGet, "/api/live/script", nil, &script); err != nil {
			r.why = "leer el script: " + err.Error()
			return r
		}
		// Sólo cuentan las aserciones que corren: una que falló queda COMENTADA en el script y no prueba nada.
		asserts := 0
		for _, line := range strings.Split(script, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "await expect(") {
				asserts++
			}
		}
		if asserts == 0 {
			r.why = "LISTO, pero el script no tiene ninguna aserción que pase: no prueba que la meta se cumplió"
			return r
		}
		res, err := replay(root)
		if err != nil {
			r.why = "repetir el script: " + err.Error()
			return r
		}
		if !res.OK {
			r.why = fmt.Sprintf("LISTO, pero el script no se repite (%d líneas): %s", res.Lines, res.Error)
			return r
		}
		r.ok = true
		r.why = fmt.Sprintf("LISTO y el script se repite (%d líneas)", res.Lines)
		return r
	}
	r.ok = true
	r.why = "LISTO"
	return r
}

type replayResult struct {
	OK    bool   `json:"ok"`
	Lines int    `json:"lineas"`
	URL   string `json:"url"`
	Error string `json:"error"`
}

// replay repite el script de la sesión con el playwright-core del driver de playwright-go.
func replay(root string) (replayResult, error) {
	var res replayResult
	var script string
	if err := call(http.MethodGet, "/api/live/script", nil, &script); err != nil {
		return res, err
	}
	tmp, err := os.CreateTemp("", "navegador-eval-*.spec.ts")
	if err != nil {
		return res, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(script); err != nil {
		return res, err
	}
	tmp.Close()
	home, _ := os.UserHomeDir()
	cores, _ := filepath.Glob(filepath.Join(home, ".cache", "ms-playwright-go", "*", "package"))
	if len(cores) == 0 {
		return res, errors.New("no encuentro playwright-core (~/.cache/ms-playwright-go/*/package): abrí make navegador una vez")
	}
	sort.Strings(cores)
	cmd := exec.Command("node", filepath.Join(root, "navegador", "evals", "replay.cjs"), tmp.Name())
	cmd.Env = append(os.Environ(), "PW_CORE="+cores[len(cores)-1])
	out, err := cmd.Output()
	if err != nil {
		return res, fmt.Errorf("node: %v", err)
	}
	if err := json.Unmarshal(out, &res); err != nil {
		return res, fmt.Errorf("salida de replay.cjs: %s", strings.TrimSpace(string(out)))
	}
	return res, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
