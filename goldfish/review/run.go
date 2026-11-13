package review

// UNA VALIDACIÓN, de punta a punta: la propuesta (elephant) → dos revisores en frío en paralelo (goldfish) → el
// veredicto de cada hallazgo y lo que sólo se ve con contexto (elephant) → el informe. Todo queda en
// goldfish/.runs/<id>/ (fuera de git): run.json, el informe y la carpeta `package/`, que es EXACTAMENTE lo que vieron
// los goldfish. Si la rama es de una tarea, el informe se copia a sus artifacts y un bloque corto va a su pila.

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed prompts/elephant-proposal.md
var promptProposal string

//go:embed prompts/goldfish-intent.md
var promptIntent string

//go:embed prompts/goldfish-risk.md
var promptRisk string

//go:embed prompts/elephant-verdict.md
var promptVerdict string

// Run: una validación.
type Run struct {
	ID       string    `json:"id"`
	Repo     string    `json:"repo"`
	Branch   string    `json:"branch"`
	Base     string    `json:"base"`
	Head     string    `json:"head"` // el commit validado
	Task     *Task     `json:"task"`
	PR       *PR       `json:"pr"`
	Started  string    `json:"started"`
	Finished string    `json:"finished"`
	Status   string    `json:"status"` // running · done · failed
	PID      int       `json:"pid"`    // el proceso que la corre (la consola o el servidor)
	Error    string    `json:"error,omitempty"`
	Stages   []Stage   `json:"stages"`
	Proposal Proposal  `json:"proposal"`
	Findings []Finding `json:"findings"`
	CostUSD  float64   `json:"costUsd"`
	Report   string    `json:"report"`   // el informe (Markdown)
	Artifact string    `json:"artifact"` // su copia en la tarea, si tiene
}

// Stage: un paso, con lo que costó.
type Stage struct {
	ID      string  `json:"id"`
	Label   string  `json:"label"`
	Status  string  `json:"status"` // pending · running · done · failed · skipped
	CostUSD float64 `json:"costUsd"`
	Millis  int     `json:"millis"`
	Note    string  `json:"note,omitempty"`
}

// Proposal: lo que se va a presentar como PR.
type Proposal struct {
	Source string   `json:"source"` // pr (la descripción del PR que ya existe) · elephant (la redactó)
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Claims []string `json:"claims"`
}

// Finding: un hallazgo, con su veredicto.
type Finding struct {
	N        int    `json:"n"`
	From     string `json:"from"` // intent · risk (los goldfish) · context (el elephant)
	Title    string `json:"title"`
	Detail   string `json:"detail"`
	File     string `json:"file"`
	Line     int    `json:"line"`
	Severity string `json:"severity"` // alta · media · baja
	Verdict  string `json:"verdict"`  // confirmado · plausible · descartado (vacío si el veredicto no llegó)
	Reason   string `json:"reason"`
}

// RunsDir: dónde quedan las validaciones.
func RunsDir(playground string) string { return filepath.Join(playground, "goldfish", ".runs") }

const (
	maxDiff = 400 << 10 // lo que pasa de acá del diff se corta (y se dice)
	maxFile = 300 << 10 // un archivo tocado más grande no se copia a files/
)

var stageLabels = []Stage{
	{ID: "package", Label: "Propuesta: el diff y lo que pide la tarea"},
	{ID: "proposal", Label: "Elephant: la descripción del PR"},
	{ID: "intent", Label: "Goldfish: ¿la propuesta y el cambio dicen lo mismo?"},
	{ID: "risk", Label: "Goldfish: ¿qué puede salir mal?"},
	{ID: "verdict", Label: "Elephant: veredicto y lo que se ve con contexto"},
	{ID: "report", Label: "Informe"},
}

// NewRun: una validación lista para correr (sin empezar).
func NewRun(b Branch) *Run {
	now := time.Now()
	r := &Run{
		ID:   now.Format("20060102-150405") + "-" + safeName(b.Repo+"-"+b.Name),
		Repo: b.Repo, Branch: b.Name, Base: b.Base, Task: b.Task, PR: b.PR,
		Started: now.Format(time.RFC3339), Status: "running", PID: os.Getpid(),
	}
	for _, s := range stageLabels {
		s.Status = "pending"
		r.Stages = append(r.Stages, s)
	}
	return r
}

var reUnsafe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func safeName(s string) string { return strings.Trim(reUnsafe.ReplaceAllString(s, "-"), "-") }

// Recorder guarda la validación cada vez que cambia (la interfaz la lee de ahí).
type Recorder func(*Run)

// Execute corre la validación entera. Lo que falle deja la validación en «failed» con el porqué; lo hecho queda.
func Execute(ctx context.Context, playground string, r *Run, save Recorder) {
	var mu sync.Mutex
	set := func(id string, f func(*Stage)) {
		mu.Lock()
		for i := range r.Stages {
			if r.Stages[i].ID == id {
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
	fail := func(id string, err error) {
		set(id, func(s *Stage) { s.Status, s.Note = "failed", err.Error() })
		r.Status, r.Error, r.Finished = "failed", err.Error(), time.Now().Format(time.RFC3339)
		save(r)
	}
	repoDir := filepath.Join(ReposDir(), r.Repo)
	dir := filepath.Join(RunsDir(playground), r.ID)
	pkg := filepath.Join(dir, "package")

	// 1 · la propuesta en una carpeta: lo que verán los goldfish
	set("package", func(s *Stage) { s.Status = "running" })
	head, note, err := buildPackage(ctx, repoDir, r, pkg)
	if err != nil {
		fail("package", err)
		return
	}
	r.Head = head
	set("package", func(s *Stage) { s.Status, s.Note = "done", note })

	// 2 · la descripción: la del PR si ya existe; si no, la redacta el elephant con todo el contexto
	set("proposal", func(s *Stage) { s.Status = "running" })
	if p, ok := existingPR(ctx, r); ok {
		r.Proposal = p
		set("proposal", func(s *Stage) {
			s.Status, s.Note = "skipped", fmt.Sprintf("se usa la descripción del PR #%d", r.PR.Number)
		})
	} else {
		res, err := runAgent(ctx, agentSpec{
			dir: playground, prompt: fill(promptProposal, r, repoDir, pkg), schema: schemaProposal,
			tools: elephantTools, allowed: elephantAllowed, denied: elephantDenied,
			addDirs: []string{repoDir, pkg}, budgetUSD: 1.5, timeout: 12 * time.Minute,
		})
		set("proposal", func(s *Stage) { s.CostUSD, s.Millis = res.CostUSD, res.Millis })
		if err != nil {
			fail("proposal", err)
			return
		}
		var p Proposal
		if err := json.Unmarshal(res.Output, &p); err != nil || strings.TrimSpace(p.Body) == "" {
			fail("proposal", errors.New("el elephant no devolvió una descripción"))
			return
		}
		p.Source = "elephant"
		r.Proposal = p
		set("proposal", func(s *Stage) { s.Status = "done" })
	}
	if err := os.WriteFile(filepath.Join(pkg, "proposal.md"), []byte("# "+r.Proposal.Title+"\n\n"+r.Proposal.Body+"\n"), 0o644); err != nil {
		fail("proposal", err)
		return
	}

	// 3 · los dos goldfish, a la vez y en frío (desde la carpeta de la propuesta, sin nada más)
	type cold struct {
		id, prompt string
		out        []Finding
		err        error
	}
	colds := []*cold{{id: "intent", prompt: promptIntent}, {id: "risk", prompt: promptRisk}}
	var wg sync.WaitGroup
	for _, c := range colds {
		wg.Add(1)
		go func() {
			defer wg.Done()
			set(c.id, func(s *Stage) { s.Status = "running" })
			res, err := runAgent(ctx, agentSpec{
				dir: pkg, prompt: c.prompt, schema: schemaFindings,
				tools: goldfishTools, allowed: goldfishTools, cold: true,
				budgetUSD: 1.5, timeout: 12 * time.Minute,
			})
			var parsed struct {
				Findings []Finding `json:"findings"`
			}
			if err == nil {
				err = json.Unmarshal(res.Output, &parsed)
			}
			c.out, c.err = parsed.Findings, err
			set(c.id, func(s *Stage) {
				s.CostUSD, s.Millis = res.CostUSD, res.Millis
				if err != nil {
					s.Status, s.Note = "failed", err.Error()
				} else {
					s.Status, s.Note = "done", fmt.Sprintf("%d hallazgos", len(parsed.Findings))
				}
			})
		}()
	}
	wg.Wait()
	for _, c := range colds {
		for _, f := range c.out {
			f.From = c.id
			f.N = len(r.Findings) + 1
			r.Findings = append(r.Findings, f)
		}
	}
	if colds[0].err != nil && colds[1].err != nil {
		r.Status, r.Error, r.Finished = "failed", "los dos goldfish fallaron: "+colds[0].err.Error(), time.Now().Format(time.RFC3339)
		save(r)
		return
	}
	save(r)

	// 4 · el elephant otra vez: veredicto de cada hallazgo contra el código, y lo que sólo se ve con el contexto
	set("verdict", func(s *Stage) { s.Status = "running" })
	raw, _ := json.MarshalIndent(r.Findings, "", "  ")
	_ = os.WriteFile(filepath.Join(pkg, "findings.json"), raw, 0o644)
	res, err := runAgent(ctx, agentSpec{
		dir: playground, prompt: fill(promptVerdict, r, repoDir, pkg), schema: schemaVerdict,
		tools: elephantTools, allowed: elephantAllowed, denied: elephantDenied,
		addDirs: []string{repoDir, pkg}, budgetUSD: 4, timeout: 25 * time.Minute,
	})
	set("verdict", func(s *Stage) { s.CostUSD, s.Millis = res.CostUSD, res.Millis })
	if err != nil {
		// sin veredicto los hallazgos igual sirven: quedan sin juzgar, y se dice
		set("verdict", func(s *Stage) { s.Status, s.Note = "failed", err.Error() })
	} else {
		var v struct {
			Verdicts []struct {
				N       int    `json:"n"`
				Verdict string `json:"verdict"`
				Reason  string `json:"reason"`
			} `json:"verdicts"`
			Extra []Finding `json:"extra"`
		}
		if err := json.Unmarshal(res.Output, &v); err != nil {
			set("verdict", func(s *Stage) { s.Status, s.Note = "failed", "el veredicto no se pudo leer: "+err.Error() })
		} else {
			for _, x := range v.Verdicts {
				if x.N >= 1 && x.N <= len(r.Findings) {
					r.Findings[x.N-1].Verdict, r.Findings[x.N-1].Reason = x.Verdict, x.Reason
				}
			}
			for _, f := range v.Extra {
				f.From = "context"
				f.N = len(r.Findings) + 1
				r.Findings = append(r.Findings, f)
			}
			set("verdict", func(s *Stage) {
				s.Status, s.Note = "done", fmt.Sprintf("%d veredictos · %d hallazgos con contexto", len(v.Verdicts), len(v.Extra))
			})
		}
	}

	// 5 · el informe, y su copia en la tarea
	set("report", func(s *Stage) { s.Status = "running" })
	r.Finished = time.Now().Format(time.RFC3339)
	r.Status = "done"
	report := Report(r)
	r.Report = filepath.Join(dir, "report.md")
	_ = os.WriteFile(r.Report, []byte(report), 0o644)
	note = ""
	if r.Task != nil {
		art, err := attachToTask(ctx, playground, r, report)
		r.Artifact = art
		if err != nil {
			note = "no se pudo dejar en la tarea: " + err.Error()
		} else {
			note = "copiado a la tarea " + r.Task.Slug
		}
	}
	set("report", func(s *Stage) { s.Status, s.Note = "done", note })
}

// Las herramientas: el elephant lee (y git sólo para leer), y puede pedirle a main-verifier; el goldfish sólo lee
// su carpeta.
var (
	elephantTools   = []string{"Read", "Grep", "Glob", "Bash", "Agent"}
	elephantAllowed = []string{"Read", "Grep", "Glob", "Agent", "Bash(git show:*)", "Bash(git log:*)", "Bash(git diff:*)",
		"Bash(git grep:*)", "Bash(git ls-tree:*)", "Bash(git rev-parse:*)", "Bash(git branch:*)", "Bash(git merge-base:*)",
		"Bash(git -C:*)"}
	elephantDenied = []string{"Edit", "Write", "NotebookEdit", "Bash(git push:*)", "Bash(git commit:*)", "Bash(git checkout:*)",
		"Bash(git reset:*)", "Bash(git rebase:*)", "Bash(git merge:*)", "Bash(git stash:*)", "Bash(git branch -D:*)",
		"Bash(git -C * push:*)", "Bash(git -C * commit:*)", "Bash(git -C * checkout:*)", "Bash(git -C * reset:*)"}
	goldfishTools = []string{"Read", "Grep", "Glob"}
)

// fill: las marcas de un prompt.
func fill(tpl string, r *Run, repoDir, pkg string) string {
	task := "La rama no está declarada en ninguna tarea del tablero."
	if r.Task != nil {
		task = fmt.Sprintf("Es de la tarea `%s` (#%s, «%s»): `%s`. Leela entera; sus temas de `knowledge:` también.",
			r.Task.Slug, r.Task.ID, r.Task.Title, r.Task.Path)
	}
	return strings.NewReplacer("{{BRANCH}}", r.Branch, "{{REPO}}", r.Repo, "{{REPO_DIR}}", repoDir, "{{BASE}}", r.Base,
		"{{PACKAGE}}", pkg, "{{TASK_LINE}}", task).Replace(tpl)
}

// buildPackage arma la carpeta de la propuesta. Devuelve el commit de la rama y una nota.
func buildPackage(ctx context.Context, repoDir string, r *Run, pkg string) (string, string, error) {
	if err := os.MkdirAll(filepath.Join(pkg, "files"), 0o755); err != nil {
		return "", "", err
	}
	head, err := git(ctx, repoDir, "rev-parse", r.Branch)
	if err != nil {
		return "", "", err
	}
	rng := r.Base + "..." + r.Branch
	diff, err := git(ctx, repoDir, "diff", "--no-color", rng)
	if err != nil {
		return "", "", err
	}
	cut := ""
	if len(diff) > maxDiff {
		diff = diff[:maxDiff] + "\n\n[… el diff sigue: se cortó en 400 KB; los archivos completos están en files/]\n"
		cut = " (diff cortado en 400 KB)"
	}
	commits, _ := git(ctx, repoDir, "log", "--no-color", "--format=%h %ad %s%n%b", "--date=short", r.Base+".."+r.Branch)
	names, err := git(ctx, repoDir, "diff", "--name-only", "--diff-filter=d", rng)
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(filepath.Join(pkg, "diff.patch"), []byte(diff+"\n"), 0o644); err != nil {
		return "", "", err
	}
	_ = os.WriteFile(filepath.Join(pkg, "commits.txt"), []byte(commits+"\n"), 0o644)
	if intent := TaskIntent(r.Task); intent != "" {
		_ = os.WriteFile(filepath.Join(pkg, "intent.md"), []byte(intent+"\n"), 0o644)
	}
	copied, skipped := 0, 0
	for _, name := range strings.Split(names, "\n") {
		if name == "" {
			continue
		}
		raw, err := exec.CommandContext(ctx, "git", "-C", repoDir, "show", r.Branch+":"+name).Output()
		if err != nil || len(raw) > maxFile || bytes.IndexByte(raw, 0) >= 0 {
			skipped++
			continue
		}
		dst := filepath.Join(pkg, "files", filepath.FromSlash(name))
		if !strings.HasPrefix(dst, filepath.Join(pkg, "files")+string(os.PathSeparator)) {
			skipped++
			continue
		}
		_ = os.MkdirAll(filepath.Dir(dst), 0o755)
		if os.WriteFile(dst, raw, 0o644) == nil {
			copied++
		}
	}
	note := fmt.Sprintf("%d archivos%s", copied, cut)
	if skipped > 0 {
		note += fmt.Sprintf(" · %d sin copiar (binarios o muy grandes)", skipped)
	}
	return head, note, nil
}

// existingPR: la descripción del PR si la rama ya tiene uno abierto.
func existingPR(ctx context.Context, r *Run) (Proposal, bool) {
	if r.PR == nil || r.PR.State != "OPEN" {
		return Proposal{}, false
	}
	slug := slugOf(ctx, filepath.Join(ReposDir(), r.Repo))
	out, err := exec.CommandContext(ctx, "gh", "pr", "view", fmt.Sprint(r.PR.Number), "-R", slug, "--json", "title,body").Output()
	if err != nil {
		return Proposal{}, false
	}
	var p Proposal
	if json.Unmarshal(out, &p) != nil || strings.TrimSpace(p.Body) == "" {
		return Proposal{}, false
	}
	p.Source = "pr"
	return p, true
}

// Report: el informe de una validación, en Markdown.
func Report(r *Run) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Goldfish · %s (%s)\n\n", r.Branch, r.Repo)
	fmt.Fprintf(&b, "- Commit validado: `%s` contra `%s`\n", short(r.Head), r.Base)
	if r.PR != nil {
		fmt.Fprintf(&b, "- PR: #%d (%s) %s\n", r.PR.Number, r.PR.State, r.PR.URL)
	}
	fmt.Fprintf(&b, "- Corrida: %s → %s · costo equivalente: US$%.2f\n\n", r.Started, r.Finished, r.CostUSD)
	counts := map[string]int{}
	for _, f := range r.Findings {
		counts[f.Verdict]++
	}
	fmt.Fprintf(&b, "**%d hallazgos**: %d confirmados · %d plausibles · %d descartados · %d sin veredicto\n\n",
		len(r.Findings), counts["confirmado"], counts["plausible"], counts["descartado"], counts[""])
	order := map[string]int{"confirmado": 0, "plausible": 1, "": 2, "descartado": 3}
	sev := map[string]int{"alta": 0, "media": 1, "baja": 2}
	fs := append([]Finding(nil), r.Findings...)
	sort.SliceStable(fs, func(i, j int) bool {
		if order[fs[i].Verdict] != order[fs[j].Verdict] {
			return order[fs[i].Verdict] < order[fs[j].Verdict]
		}
		return sev[fs[i].Severity] < sev[fs[j].Severity]
	})
	from := map[string]string{"intent": "goldfish · propuesta vs cambio", "risk": "goldfish · riesgos", "context": "elephant · contexto"}
	for _, f := range fs {
		verdict := f.Verdict
		if verdict == "" {
			verdict = "sin veredicto"
		}
		fmt.Fprintf(&b, "## %s · %s — %s\n\n", strings.ToUpper(verdict), f.Severity, f.Title)
		if f.File != "" {
			loc := f.File
			if f.Line > 0 {
				loc = fmt.Sprintf("%s:%d", f.File, f.Line)
			}
			fmt.Fprintf(&b, "`%s` · ", loc)
		}
		fmt.Fprintf(&b, "%s\n\n%s\n\n", from[f.From], strings.TrimSpace(f.Detail))
		if f.Reason != "" {
			fmt.Fprintf(&b, "> Veredicto: %s\n\n", strings.TrimSpace(f.Reason))
		}
	}
	fmt.Fprintf(&b, "---\n\n## La propuesta que se revisó (%s)\n\n### %s\n\n%s\n", map[string]string{"pr": "la del PR", "elephant": "redactada por el elephant"}[r.Proposal.Source], r.Proposal.Title, r.Proposal.Body)
	return b.String()
}

func short(sha string) string {
	if len(sha) > 10 {
		return sha[:10]
	}
	return sha
}

// attachToTask copia el informe a los artifacts de la tarea y deja un bloque corto en su pila.
func attachToTask(ctx context.Context, playground string, r *Run, report string) (string, error) {
	taskDir := filepath.Dir(r.Task.Path)
	art := filepath.Join(taskDir, "artifacts", fmt.Sprintf("goldfish-%s.md", r.ID))
	if err := os.MkdirAll(filepath.Dir(art), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(art, []byte(report), 0o644); err != nil {
		return "", err
	}
	counts := map[string]int{}
	for _, f := range r.Findings {
		counts[f.Verdict]++
	}
	var top []string
	for _, f := range r.Findings {
		if f.Verdict == "confirmado" && len(top) < 5 {
			top = append(top, "- "+f.Title)
		}
	}
	// sin la ruta del informe: la pila sólo acepta rutas citadas con su repo; está en los artifacts de la tarea
	block := fmt.Sprintf("# Goldfish antes del PR: %s (%s)\n\nRevisión en frío de la rama en `%s` contra `%s`: %d hallazgos, %d confirmados, %d plausibles, %d descartados. El informe completo quedó en los artifacts de la tarea.\n",
		r.Branch, r.Repo, short(r.Head), r.Base, len(r.Findings), counts["confirmado"], counts["plausible"], counts["descartado"])
	if len(top) > 0 {
		block += "\nConfirmados:\n\n" + strings.Join(top, "\n") + "\n"
	}
	cmd := exec.CommandContext(ctx, "make", "-s", "tarea-bloque", "N="+r.Task.Slug, "ARCHIVO=-")
	cmd.Dir = playground
	cmd.Stdin = strings.NewReader(block)
	if out, err := cmd.CombinedOutput(); err != nil {
		return art, fmt.Errorf("el informe quedó en artifacts, pero el bloque no: %s", tail(string(out), 200))
	}
	return art, nil
}

// Alive: ¿sigue vivo el proceso que la corre? (una validación «corriendo» de un proceso muerto quedó cortada)
func (r *Run) Alive() bool {
	if r.PID <= 0 {
		return false
	}
	return syscall.Kill(r.PID, 0) == nil
}
