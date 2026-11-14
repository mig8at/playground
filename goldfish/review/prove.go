package review

// COMPROBAR CORRIENDO: el análisis de Goldfish lee; esto CORRE. A pedido («Comprobar corriendo»), el clon local del
// repo del PR se pone en el commit del PR (detached), un agente con el harness prueba contra LOCAL los hallazgos
// confirmados y plausibles que se pueden probar corriendo, y cada uno queda con su evidencia: el comando y lo que dio.
// Al terminar —bien, mal o frenado— el clon vuelve a la rama en la que estaba.
//
// Por qué local y con el PR: local corre lo que tenga cada clon (sail monta la carpeta de legacy-backend; el wizard de
// :5174, la de frontend-monorepo), así que con el clon en el PR lo que se prueba es el cambio de verdad. Si el clon
// tiene cambios sin commit, no se toca y no se prueba: lo dice.
//
// ⚠ Mientras corre, el clon NO está en tu rama. Hay un candado por clon: dos comprobaciones no se pisan.

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed prompts/elephant-prove.md
var promptProve string

// Proof: lo que dio correr un hallazgo.
type Proof struct {
	Status  string `json:"status"`  // comprobado · refutado · sin probar
	Command string `json:"command"` // lo que se corrió (para repetirlo)
	Result  string `json:"result"`  // lo que dio, corto
}

var cloneLocks sync.Map // carpeta del clon → *sync.Mutex

// ProveStage: el paso que se agrega a la validación.
const ProveStage = "prove"

// Prove corre la comprobación sobre una validación ya terminada.
func Prove(ctx context.Context, myTools string, r *Run, save Recorder) {
	var mu sync.Mutex
	set := func(f func(*Stage)) {
		mu.Lock()
		for i := range r.Stages {
			if r.Stages[i].ID == ProveStage {
				f(&r.Stages[i])
			}
		}
		r.CostUSD = 0
		for _, s := range r.Stages {
			r.CostUSD += s.CostUSD
		}
		mu.Unlock()
		save(r)
	}
	// el paso, nuevo o de nuevo
	found := false
	for i := range r.Stages {
		if r.Stages[i].ID == ProveStage {
			r.Stages[i] = Stage{ID: ProveStage, Label: r.Stages[i].Label}
			found = true
		}
	}
	if !found {
		r.Stages = append(r.Stages, Stage{ID: ProveStage, Label: "Elephant con el harness: comprobar corriendo, en local con el PR"})
	}
	r.Proving = true
	set(func(s *Stage) { s.Status = "running" })
	done := func(status, note string) {
		r.Proving = false
		set(func(s *Stage) { s.Status, s.Note = status, note })
	}

	var testable []Finding
	for _, f := range r.Findings {
		if f.Verdict == "confirmado" || f.Verdict == "plausible" {
			testable = append(testable, f)
		}
	}
	if len(testable) == 0 {
		done("skipped", "no hay hallazgos confirmados ni plausibles para probar")
		return
	}
	clone := r.cloneDir(ctx)
	if clone == "" {
		done("failed", "no hay un clon de "+r.Slug)
		return
	}
	lockAny, _ := cloneLocks.LoadOrStore(clone, &sync.Mutex{})
	lock := lockAny.(*sync.Mutex)
	if !lock.TryLock() {
		done("failed", "el clon ya está en otra comprobación")
		return
	}
	defer lock.Unlock()

	// el clon en el PR, sólo si no tiene nada sin commit; y de vuelta a su rama pase lo que pase
	restore, err := checkoutPR(ctx, clone, r)
	if err != nil {
		done("failed", err.Error())
		return
	}
	var restoreErr error
	defer func() {
		if restoreErr = restore(); restoreErr != nil {
			done("failed", "⚠ el clon NO volvió a su rama: "+restoreErr.Error())
		}
	}()

	dir := filepath.Join(RunsDir(myTools), r.ID)
	raw, _ := json.MarshalIndent(testable, "", "  ")
	tfile := filepath.Join(dir, "package", "testable.json")
	_ = os.WriteFile(tfile, raw, 0o644)
	prompt := strings.NewReplacer("{{REPO}}", r.Slug, "{{REPO_DIR}}", clone, "{{PR}}", r.label(),
		"{{HEAD}}", r.Head, "{{PACKAGE}}", filepath.Join(dir, "package"), "{{TESTABLE}}", tfile).Replace(promptProve)
	res, err := runAgent(ctx, agentSpec{
		dir: myTools, prompt: prompt, schema: schemaProve,
		tools: []string{"Read", "Grep", "Glob", "Bash", "Agent", "Skill"},
		// y la prueba del PR por su ruta, desde su clon (nunca la suite entera: el hook destructive-tests lo frena igual)
		// (un comando compuesto se revisa por partes: el `cd` y el `sail` van por separado)
		// y lo de my-tools también desde su raíz o por su ruta completa (`cd <my-tools> && make …`, `<my-tools>/bin/pg …`)
		allowed: append(append([]string{}, proveAllowed...), "Bash(cd "+clone+")", "Bash(cd "+clone+":*)",
			"Bash(./vendor/bin/sail artisan test:*)", "Bash("+clone+"/vendor/bin/sail artisan test:*)",
			"Bash(cd "+myTools+")", "Bash(cd "+myTools+":*)", "Bash(./bin/pg sql:*)", "Bash("+myTools+"/bin/pg sql:*)",
			"Bash("+myTools+"/bin/pg logs:*)", "Bash("+myTools+"/bin/pg request timeline:*)",
			"Bash(make -C "+myTools+" harness-:*)", "Bash(make -C "+myTools+" tablero-db:*)",
			// la API local, sólo por el ayudante que rechaza todo host que no sea localhost (curl libre podría ir a prod)
			"Bash(goldfish/bin/local-http:*)", "Bash("+myTools+"/goldfish/bin/local-http:*)"),
		denied:  proveDenied,
		addDirs: []string{clone, dir}, budgetUSD: 8, timeout: 45 * time.Minute,
		env: []string{"E2E_TARGET=local"},
	})
	set(func(s *Stage) { s.CostUSD, s.Millis = res.CostUSD, res.Millis })
	if err != nil {
		done("failed", err.Error())
		return
	}
	var out struct {
		Proofs []struct {
			N       int    `json:"n"`
			Status  string `json:"status"`
			Command string `json:"command"`
			Result  string `json:"result"`
		} `json:"proofs"`
	}
	if err := json.Unmarshal(res.Output, &out); err != nil {
		done("failed", "la respuesta no se pudo leer: "+err.Error())
		return
	}
	counts := map[string]int{}
	for _, p := range out.Proofs {
		if p.N >= 1 && p.N <= len(r.Findings) {
			r.Findings[p.N-1].Proof = &Proof{Status: p.Status, Command: p.Command, Result: p.Result}
			counts[p.Status]++
		}
	}
	// el informe, con la evidencia
	_ = os.WriteFile(filepath.Join(dir, "report.md"), []byte(Report(r)), 0o644)
	if r.Artifact != "" {
		_ = os.WriteFile(r.Artifact, []byte(Report(r)), 0o644)
	}
	done("done", fmt.Sprintf("%d comprobados · %d refutados · %d sin probar", counts["comprobado"], counts["refutado"], counts["sin probar"]))
}

// checkoutPR pone el clon en el commit del PR (detached) y devuelve cómo dejarlo como estaba.
func checkoutPR(ctx context.Context, clone string, r *Run) (func() error, error) {
	// si el clon ya está en ese commit (la rama local en la que se trabaja), no se mueve nada
	if cur, _ := git(ctx, clone, "rev-parse", "HEAD"); cur != "" && cur == r.Head {
		return func() error { return nil }, nil
	}
	dirty, err := git(ctx, clone, "status", "--porcelain", "--untracked-files=no")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(dirty) != "" {
		return nil, fmt.Errorf("el clon %s tiene cambios sin commit: no se toca (guardalos o commitealos y volvé a probar)", filepath.Base(clone))
	}
	branch, _ := git(ctx, clone, "branch", "--show-current")
	sha, err := git(ctx, clone, "rev-parse", "HEAD")
	if err != nil {
		return nil, err
	}
	r.ProveFrom = sha
	if branch != "" {
		r.ProveFrom = branch
	}
	if r.Head == "" {
		return nil, errors.New("la validación no tiene el commit del PR")
	}
	if _, err := git(ctx, clone, "-c", "advice.detachedHead=false", "checkout", "--detach", r.Head); err != nil {
		return nil, err
	}
	return func() error {
		// sin el contexto de la corrida: aunque la hayan frenado, el clon vuelve
		back := context.Background()
		var err error
		if branch != "" {
			_, err = git(back, clone, "checkout", branch)
		} else {
			_, err = git(back, clone, "-c", "advice.detachedHead=false", "checkout", "--detach", sha)
		}
		return err
	}, nil
}

// Lo que el agente puede correr: el harness, las lecturas de bin/pg y git para leer. Nada que cambie el clon, empuje
// o borre la base local.
var (
	proveAllowed = []string{"Read", "Grep", "Glob", "Agent", "Skill",
		"Bash(make harness-:*)", "Bash(make tablero-db:*)", "Bash(make knowledge-:*)", "Bash(bin/pg sql:*)",
		"Bash(bin/pg logs:*)", "Bash(bin/pg request timeline:*)", "Bash(bin/pg client state:*)", "Bash(bin/pg events:*)",
		"Bash(bin/pg jobs failed:*)", "Bash(bin/pg settings diff:*)", "Bash(git -C:*)", "Bash(git show:*)", "Bash(git log:*)",
		"Bash(git diff:*)", "Bash(gh pr view:*)", "Bash(gh pr diff:*)", "Bash(curl -s http://127.0.0.1:*)", "Bash(curl -s http://localhost:*)", "Bash(curl -s http://localhost/:*)",
		"Bash(curl -s http://127.0.0.1/:*)", "Bash(docker ps:*)"}
	proveDenied = []string{"Edit", "Write", "NotebookEdit",
		"Bash(git -C * checkout:*)", "Bash(git -C * commit:*)", "Bash(git -C * push:*)", "Bash(git -C * reset:*)",
		"Bash(git -C * stash:*)", "Bash(git -C * merge:*)", "Bash(git -C * rebase:*)", "Bash(git checkout:*)",
		"Bash(git push:*)", "Bash(git commit:*)", "Bash(make fresh:*)", "Bash(make test:*)"}
)

// RestoreAfterCrash: si una comprobación se cortó con el clon todavía en el PR, lo devuelve a donde estaba.
// Sólo si el clon sigue exactamente en el commit del PR, sin rama y sin cambios: si alguien ya lo movió, no se toca.
func RestoreAfterCrash(ctx context.Context, r *Run) (string, error) {
	clone := r.cloneDir(ctx)
	if clone == "" || r.ProveFrom == "" || r.Head == "" {
		return "", nil
	}
	if b, _ := git(ctx, clone, "branch", "--show-current"); b != "" {
		return "", nil
	}
	if head, _ := git(ctx, clone, "rev-parse", "HEAD"); head != r.Head {
		return "", nil
	}
	if dirty, _ := git(ctx, clone, "status", "--porcelain", "--untracked-files=no"); strings.TrimSpace(dirty) != "" {
		return "", fmt.Errorf("%s quedó en el PR y tiene cambios: no se toca", filepath.Base(clone))
	}
	if _, err := git(ctx, clone, "-c", "advice.detachedHead=false", "checkout", r.ProveFrom); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s volvió a %s", filepath.Base(clone), r.ProveFrom), nil
}
