package main

// LA CONSOLA DE KNOWLEDGE (`bin/knowledge <comando>`): lo mismo que la app de Cockpit, para un agente. Nació de la #15
// (2026-11-23): para destrabarla hubo que hablarle a la API con curl y escribir overrides.json a mano, sin nada que
// validara el id de la sección ni el formato de la evidencia.
//
// Las lecturas (status, runs, run, sections) leen `.data` directamente: no piden la API arriba. Lo que mueve al vigía
// (look, resume) va por la API, porque sólo el proceso que escucha el puerto corre corridas. decide y replace escriben
// los archivos de la corrida que lee el paso «Juntar» (overrides.json, reemplazos.json), validados.
//
// Salida: lo que imprime va en inglés (regla de my-tools); los datos (etiquetas de los pasos, resultados) quedan como
// están. Códigos: 0 bien · 1 falló o la corrida frenó · 2 uso · 3 no existe. Con --json, también el error sale en JSON
// por stdout: {"error": "…", "fix": "…"}.

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
	"strconv"
	"strings"
	"time"
)

var cliCommands = map[string]bool{"status": true, "runs": true, "run": true, "sections": true, "decide": true,
	"replace": true, "resume": true, "look": true}

const cliHelp = `knowledge — Knowledge (the watcher of knowledge/) from the terminal. Reads need no API; look and resume do.

 read
  status                          is knowledge/ up to date with main? what is stale, running, waiting, queued
  runs [--all] [--n 15]           the runs, newest first (--all includes superseded ones)
  run [<n>]                       one run step by step, with why it stopped and what to do next (default: the last)
  sections <n>                    the sections of a run with their verdict (model or by hand) and why
 unblock a stopped run
  decide <n> <section> --verdict keep|change --why '…' [--text-file f.md | --text '…'] [--title '…']
         [--evidence repo:path[:line] …]   decide a section by hand (writes overrides.json, validated).
                                  change needs the new text. --remove drops the decision
  replace <n> <deleted-path> <new-path>   main deleted a source and another file took its place
                                  (writes reemplazos.json; the new path must exist in main). --remove drops it
  resume <n> [--wait] [--timeout 30m]   run it again from where it stopped. --wait: until it ends
                                  (exit 0 passed, 1 stopped or failed)
 the watcher
  look [--wait]                   look at main now instead of waiting for the next 30 min (~5 min)

 --json on any command. Exit: 0 ok · 1 failed or stopped · 2 usage · 3 not found.
 The section id is <topic>#<anchor>, as sections lists it. More: knowledge-flow/CLAUDE.md`

// cliErr: un error con el código de salida y, si lo hay, el comando que lo arregla.
type cliErr struct {
	code     int
	msg, fix string
}

func (e cliErr) Error() string { return e.msg }

func usage(format string, a ...any) error {
	return cliErr{2, fmt.Sprintf(format, a...), "bin/knowledge help"}
}
func notFound(fix, format string, a ...any) error {
	return cliErr{3, fmt.Sprintf(format, a...), fix}
}
func failed(fix, format string, a ...any) error { return cliErr{1, fmt.Sprintf(format, a...), fix} }

func unknownCommand(cmd string) string {
	msg := fmt.Sprintf("knowledge: unknown command %q", cmd)
	var names []string
	for k := range cliCommands {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, known := range names {
		if strings.HasPrefix(known, cmd) || strings.HasPrefix(cmd, known) {
			msg += fmt.Sprintf(" (did you mean %s?)", known)
			break
		}
	}
	return msg + " · bin/knowledge help"
}

// cli: lo que comparten los comandos.
type cli struct {
	f      *flow
	json   bool
	out    io.Writer
	api    string
	client *http.Client
}

// runCLI: un comando. Devuelve el código de salida.
func runCLI(root string, args []string) int {
	cmd := args[0]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	asJSON := fs.Bool("json", false, "")
	all := fs.Bool("all", false, "")
	n := fs.Int("n", 15, "")
	verdictFlag := fs.String("verdict", "", "")
	why := fs.String("why", "", "")
	text := fs.String("text", "", "")
	textFile := fs.String("text-file", "", "")
	title := fs.String("title", "", "")
	remove := fs.Bool("remove", false, "")
	wait := fs.Bool("wait", false, "")
	timeout := fs.Duration("timeout", 30*time.Minute, "")
	var evidence multiFlag
	fs.Var(&evidence, "evidence", "")
	// Los flags pueden ir antes o después de los argumentos.
	var pos []string
	rest := args[1:]
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return report(&cli{json: *asJSON, out: os.Stdout}, usage("%s: %v", cmd, err))
		}
		rest = fs.Args()
		if len(rest) > 0 {
			pos, rest = append(pos, rest[0]), rest[1:]
		}
	}
	c := &cli{
		f:      &flow{root: root, runs: &runStore{dir: filepath.Join(root, "knowledge-flow", ".data", "runs")}},
		json:   *asJSON,
		out:    os.Stdout,
		api:    strings.TrimRight(envOr("KNOWLEDGE_API", "http://127.0.0.1:5233"), "/"),
		client: &http.Client{Timeout: 15 * time.Second},
	}
	c.f.loadLook()
	var err error
	switch cmd {
	case "status":
		err = c.status()
	case "runs":
		err = c.listRuns(*all, *n)
	case "run":
		err = c.showRun(pos)
	case "sections":
		err = c.sections(pos)
	case "decide":
		err = c.decide(pos, decision{verdict: *verdictFlag, why: *why, text: *text, textFile: *textFile, title: *title,
			evidence: evidence, remove: *remove})
	case "replace":
		err = c.replace(pos, *remove)
	case "resume":
		err = c.resume(pos, *wait, *timeout)
	case "look":
		err = c.look(*wait, *timeout)
	}
	return report(c, err)
}

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, v); return nil }

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// report: el error en una línea por stderr (y en JSON por stdout con --json), con su código.
func report(c *cli, err error) int {
	if err == nil {
		return 0
	}
	var ce cliErr
	if !errors.As(err, &ce) {
		ce = cliErr{1, err.Error(), ""}
	}
	if c.json {
		_ = json.NewEncoder(c.out).Encode(map[string]string{"error": ce.msg, "fix": ce.fix})
	}
	line := "knowledge: " + ce.msg
	if ce.fix != "" {
		line += " → " + ce.fix
	}
	fmt.Fprintln(os.Stderr, line)
	return ce.code
}

func (c *cli) emit(v any) error {
	enc := json.NewEncoder(c.out)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// ── la API (sólo para lo que mueve al vigía, y para saber qué está corriendo ahora) ─────────────────────────────────

type apiState struct {
	Look          Look      `json:"look"`
	Runs          []Summary `json:"runs"`
	Running       bool      `json:"running"`
	Model         string    `json:"model"`
	ResumePending int       `json:"resumePending"`
}

func (c *cli) state() (*apiState, error) {
	res, err := c.client.Get(c.api + "/api/state")
	if err != nil {
		return nil, failed("make knowledge-flow-install (or open Knowledge in Cockpit)", "the Knowledge API does not answer at %s", c.api)
	}
	defer res.Body.Close()
	var s apiState
	if err := json.NewDecoder(res.Body).Decode(&s); err != nil {
		return nil, failed("", "the Knowledge API answered something that is not its state: %v", err)
	}
	return &s, nil
}

func (c *cli) post(path string) error {
	req, _ := http.NewRequest("POST", c.api+path, nil)
	req.Header.Set("X-Knowledge", "1")
	res, err := c.client.Do(req)
	if err != nil {
		return failed("make knowledge-flow-install (or open Knowledge in Cockpit)", "the Knowledge API does not answer at %s", c.api)
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		var body struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(res.Body).Decode(&body)
		return failed("bin/knowledge status", "%s: %s", path, firstNonEmpty(body.Error, res.Status))
	}
	return nil
}

func firstNonEmpty(a ...string) string {
	for _, s := range a {
		if s != "" {
			return s
		}
	}
	return ""
}

// ── status ───────────────────────────────────────────────────────────────────────────────────────────────────────

func (c *cli) status() error {
	look, live := c.f.look, false
	var st *apiState
	if s, err := c.state(); err == nil {
		st, look, live = s, s.Look, true
	}
	topics := map[string]int{}
	for _, ch := range look.Changes {
		topics[ch.Topic]++
	}
	var stale []string
	for t, k := range topics {
		stale = append(stale, fmt.Sprintf("%s (%d)", t, k))
	}
	sort.Strings(stale)
	last := c.f.lastRun()
	// Lo que pide a alguien: la última corrida frenada o fallada sobre temas que siguen viejos.
	var attention string
	if last != nil && (last.State == stStopped || last.State == stFailed) && !c.f.superseded(look)[last.ID] {
		attention = fmt.Sprintf("run #%d %s: %s", last.ID, last.State, last.Result)
	}
	if c.json {
		out := map[string]any{"api": live, "lookedAt": look.At, "looking": look.Looking, "sources": look.Sources,
			"topics": look.Topics, "stale": look.Changes, "waiting": look.Waiting, "error": look.Error, "attention": attention}
		if last != nil {
			out["lastRun"] = last.summary()
		}
		if st != nil {
			out["running"], out["resumePending"], out["model"], out["queued"] = st.Running, st.ResumePending, st.Model, st.Look.Queued
		}
		return c.emit(out)
	}
	w := c.out
	switch {
	case look.At == "":
		fmt.Fprintln(w, "not looked at main yet")
	case len(look.Changes) == 0:
		fmt.Fprintf(w, "up to date with main: %d topics, %d sources (looked %s)\n", look.Topics, look.Sources, ago(look.At))
	default:
		fmt.Fprintf(w, "STALE: %d of %d sources, in %s (looked %s)\n", len(look.Changes), look.Sources, strings.Join(stale, ", "), ago(look.At))
	}
	if !live {
		fmt.Fprintln(w, "api: down — this is the last saved look; nothing is watching main (make knowledge-flow-install)")
	} else {
		if look.Looking {
			fmt.Fprintf(w, "looking at main now (since %s)\n", ago(look.Since))
		}
		if st.Running {
			for _, r := range st.Runs {
				if r.State == stRunning {
					fmt.Fprintf(w, "running: #%d · %s\n", r.ID, r.Title)
				}
			}
		}
		if st.ResumePending != 0 {
			fmt.Fprintf(w, "queued to resume: #%d (starts when the current look ends)\n", st.ResumePending)
		}
		if len(st.Look.Queued) > 0 {
			fmt.Fprintf(w, "queued for the next run: %d source(s)\n", len(st.Look.Queued))
		}
	}
	// El «waiting» es de la mirada anterior: mientras mira de nuevo, puede ya no valer (la corrida que nombra pasó).
	if look.Waiting != "" && !look.Looking {
		fmt.Fprintln(w, "waiting: "+look.Waiting)
	}
	if look.Error != "" {
		fmt.Fprintln(w, "look error: "+look.Error)
	}
	if attention != "" {
		fmt.Fprintf(w, "NEEDS YOU: %s\n  → bin/knowledge run %d\n", attention, last.ID)
	} else if last != nil {
		fmt.Fprintf(w, "last run: #%d %s · %s\n", last.ID, last.State, last.Result)
	}
	return nil
}

// ago: hace cuánto, para leer de un vistazo.
func ago(iso string) string {
	t, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		return iso
	}
	d := time.Since(t).Round(time.Minute)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%d min ago", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh%02d ago", int(d.Hours()), int(d.Minutes())%60)
	}
	return t.Format("2006-01-02 15:04")
}

// ── runs y run ───────────────────────────────────────────────────────────────────────────────────────────────────

func (c *cli) listRuns(all bool, n int) error {
	sup := c.f.superseded(c.f.look)
	var out []Summary
	hidden := 0
	for _, id := range c.f.runs.ids() {
		r, err := c.f.runs.load(id)
		if err != nil {
			continue
		}
		s := r.summary()
		s.Superseded = sup[id]
		if s.Superseded && !all {
			hidden++
			continue
		}
		if len(out) < n {
			out = append(out, s)
		}
	}
	if c.json {
		return c.emit(map[string]any{"runs": out, "hiddenSuperseded": hidden})
	}
	if len(out) == 0 {
		fmt.Fprintln(c.out, "no runs")
	}
	for _, s := range out {
		tag := ""
		if s.Superseded {
			tag = " (superseded)"
		}
		fmt.Fprintf(c.out, "#%-3d %-7s %s · %s%s\n     %s\n", s.ID, s.State, clockOf(s.StartedAt), s.Title, tag, s.Result)
	}
	if hidden > 0 {
		fmt.Fprintf(c.out, "%d superseded hidden (--all shows them)\n", hidden)
	}
	return nil
}

func clockOf(iso string) string {
	if t, err := time.Parse(time.RFC3339, iso); err == nil {
		return t.Format("01-02 15:04")
	}
	return iso
}

// runArg: la corrida del primer argumento, o la última.
func (c *cli) runArg(pos []string, required bool) (*Run, error) {
	if len(pos) == 0 {
		if required {
			return nil, usage("missing the run number")
		}
		if r := c.f.lastRun(); r != nil {
			return r, nil
		}
		return nil, notFound("", "there are no runs yet")
	}
	id, err := strconv.Atoi(strings.TrimPrefix(pos[0], "#"))
	if err != nil {
		return nil, usage("%q is not a run number", pos[0])
	}
	r, err := c.f.runs.load(id)
	if err != nil {
		return nil, notFound("bin/knowledge runs --all", "there is no run #%d", id)
	}
	return r, nil
}

// nextSteps: qué hacer con una corrida frenada, con los comandos puestos.
func nextSteps(r *Run) []string {
	if r.State != stStopped && r.State != stFailed {
		return nil
	}
	var st *Step
	for i := range r.Steps {
		if s := r.Steps[i].State; s == stStopped || s == stFailed {
			st = &r.Steps[i]
			break
		}
	}
	if st == nil {
		return nil
	}
	id := r.ID
	if r.State == stFailed {
		if r.ModelDown {
			return []string{"the model did not answer: it resumes by itself when it does (bin/cockpit doctor shows the session)"}
		}
		return []string{"something broke (not a verdict): the next look retries it, up to 3 times",
			fmt.Sprintf("bin/knowledge look   # or read the step detail above and fix the cause first")}
	}
	switch st.ID {
	case "final":
		return []string{
			fmt.Sprintf("bin/knowledge sections %d   # which sections are undecided and why", id),
			"read the files in main (git -C ~/Desktop/CREDITOP/main-clones/<repo> show origin/main:<path>) and decide each:",
			fmt.Sprintf("bin/knowledge decide %d '<topic>#<anchor>' --verdict change --text-file new.md --why '…' --evidence repo:path", id),
			fmt.Sprintf("bin/knowledge replace %d <deleted-path> <new-path>   # if main deleted a source and another file replaced it", id),
			fmt.Sprintf("bin/knowledge resume %d --wait", id),
		}
	case "verify":
		return []string{
			"the verifier found problems in the new texts (above). Check each against main; it may be right",
			fmt.Sprintf("bin/knowledge decide %d '<topic>#<anchor>' --verdict change --text-file fixed.md --why '…' --evidence repo:path", id),
			fmt.Sprintf("bin/knowledge resume %d --wait   # joins and verifies again", id),
		}
	case "apply":
		return []string{"another session has uncommitted changes in those topics (above): commit or discard them",
			fmt.Sprintf("bin/knowledge resume %d --wait", id)}
	}
	return []string{fmt.Sprintf("fix what stopped it, then: bin/knowledge resume %d --wait", id)}
}

func (c *cli) showRun(pos []string) error {
	r, err := c.runArg(pos, false)
	if err != nil {
		return err
	}
	if c.json {
		return c.emit(map[string]any{"run": r, "next": nextSteps(r), "driftDir": r.driftDir()})
	}
	w := c.out
	fmt.Fprintf(w, "#%d · %s · %s · started %s", r.ID, r.State, strings.Join(r.Topics, ", "), clockOf(r.StartedAt))
	if r.Commit != "" {
		fmt.Fprintf(w, " · commit %s", r.Commit)
	}
	fmt.Fprintln(w)
	if r.Result != "" {
		fmt.Fprintln(w, "  "+r.Result)
	}
	fmt.Fprintln(w, "\nsources that changed in main:")
	for _, ch := range r.Changes {
		fmt.Fprintf(w, "  %-8s %s:%s  (%s)\n", ch.State, ch.Repo, ch.Path, ch.Topic)
	}
	fmt.Fprintln(w, "\nsteps:")
	mark := map[string]string{stDone: "✓", stStopped: "■", stFailed: "✗", stRunning: "…", stSkipped: "–", stQueued: "·"}
	for i, s := range r.Steps {
		fmt.Fprintf(w, " %2d %s %-52s %s\n", i+1, mark[s.State], s.Label, durOf(s.StartedAt, s.FinishedAt))
		if s.Now != "" {
			fmt.Fprintln(w, "       now: "+s.Now)
		}
		if s.Summary != "" {
			fmt.Fprintln(w, "       "+s.Summary)
		}
		for _, d := range s.Detail {
			fmt.Fprintln(w, "       • "+d)
		}
	}
	if next := nextSteps(r); len(next) > 0 {
		fmt.Fprintln(w, "\nnext:")
		for _, l := range next {
			fmt.Fprintln(w, "  "+l)
		}
	}
	return nil
}

func durOf(from, to string) string {
	a, err := time.Parse(time.RFC3339, from)
	if err != nil {
		return ""
	}
	b := time.Now()
	if t, err := time.Parse(time.RFC3339, to); err == nil {
		b = t
	}
	d := b.Sub(a).Round(time.Second)
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	return fmt.Sprintf("%d:%02d", int(d.Minutes()), int(d.Seconds())%60)
}

// ── sections ─────────────────────────────────────────────────────────────────────────────────────────────────────

type sectionItem struct {
	Topic string   `json:"topic"`
	Prose string   `json:"prose"`
	Files []string `json:"files"`
}

func (r *Run) sectionItems() (map[string]sectionItem, error) {
	raw, err := os.ReadFile(filepath.Join(r.driftDir(), "secciones.json"))
	if err != nil {
		return nil, notFound("", "run #%d has no sections yet (it did not get to «Armar paquetes»)", r.ID)
	}
	out := map[string]sectionItem{}
	return out, json.Unmarshal(raw, &out)
}

// override: una decisión a mano, en el formato que lee `drift.py final` (claves en español: es su contrato).
type override struct {
	Verdict  string   `json:"veredicto"`
	NewText  string   `json:"texto_nuevo,omitempty"`
	NewTitle string   `json:"titulo_nuevo,omitempty"`
	Why      string   `json:"por_que"`
	Evidence []string `json:"evidencia,omitempty"`
}

func (r *Run) overrides() map[string]override {
	out := map[string]override{}
	if raw, err := os.ReadFile(filepath.Join(r.driftDir(), "overrides.json")); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func (r *Run) swaps() map[string]string {
	out := map[string]string{}
	if raw, err := os.ReadFile(filepath.Join(r.driftDir(), "reemplazos.json")); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func (c *cli) sections(pos []string) error {
	r, err := c.runArg(pos, true)
	if err != nil {
		return err
	}
	items, err := r.sectionItems()
	if err != nil {
		return err
	}
	fin, _ := r.finals() // sin final.json (frenó antes de juntar) cada sección sale sin veredicto
	ov := r.overrides()
	type row struct {
		ID      string   `json:"id"`
		Verdict string   `json:"verdict"`
		Source  string   `json:"source"` // codigo · segunda · a mano · pending
		Why     string   `json:"why"`
		Files   []string `json:"files"`
		ByHand  bool     `json:"byHand"`
	}
	var rows []row
	for id, it := range items {
		x := row{ID: id, Files: it.Files, Verdict: "pending", Source: "pending"}
		if v, ok := fin[id]; ok {
			x.Verdict, x.Source, x.Why = v.Verdict, v.Source, v.Why
		}
		if o, ok := ov[id]; ok {
			x.Verdict, x.Source, x.Why, x.ByHand = o.Verdict, "a mano", o.Why, true
		}
		rows = append(rows, x)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID })
	sourceName := map[string]string{"codigo": "code", "segunda": "second look", "a mano": "by hand", "pending": "pending"}
	for i := range rows {
		rows[i].Source = firstNonEmpty(sourceName[rows[i].Source], rows[i].Source)
	}
	if c.json {
		return c.emit(map[string]any{"run": r.ID, "sections": rows, "replacements": r.swaps()})
	}
	for _, x := range rows {
		fmt.Fprintf(c.out, "%-12s %s  [%s]\n", verdictWord(x.Verdict), x.ID, x.Source)
		if x.Why != "" {
			fmt.Fprintf(c.out, "             %s\n", oneLine(x.Why, 300))
		}
		fmt.Fprintf(c.out, "             sources: %s\n", strings.Join(x.Files, ", "))
	}
	if sw := r.swaps(); len(sw) > 0 {
		fmt.Fprintln(c.out, "\nreplacements (deleted → new):")
		for k, v := range sw {
			fmt.Fprintf(c.out, "  %s → %s\n", k, v)
		}
	}
	return nil
}

// Los veredictos de drift.py, con su nombre en inglés para la consola. Los valores guardados siguen siendo los suyos.
var verdictNames = map[string]string{"keep": "sigue", "change": "cambia", "new": "nueva"}

func verdictWord(v string) string {
	for en, es := range verdictNames {
		if es == v {
			return en
		}
	}
	if v == "sin_decidir" {
		return "UNDECIDED"
	}
	return v
}

// ── decide y replace ─────────────────────────────────────────────────────────────────────────────────────────────

type decision struct {
	verdict, why, text, textFile, title string
	evidence                            []string
	remove                              bool
}

// editable: sólo se escribe en una corrida frenada (una que corre está leyendo esos archivos; una que pasó ya aplicó).
func editable(r *Run) error {
	switch r.State {
	case stStopped, stFailed:
		return nil
	case stRunning:
		return failed("bin/knowledge run "+strconv.Itoa(r.ID), "run #%d is running: wait until it stops", r.ID)
	}
	return failed("", "run #%d already %s: nothing to decide there", r.ID, r.State)
}

func writeJSONFile(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path+".tmp", append(raw, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}

func (c *cli) decide(pos []string, d decision) error {
	if len(pos) < 2 {
		return usage("decide <run> <topic#anchor> --verdict keep|change --why '…' [--text-file f]")
	}
	r, err := c.runArg(pos, true)
	if err != nil {
		return err
	}
	if err := editable(r); err != nil {
		return err
	}
	items, err := r.sectionItems()
	if err != nil {
		return err
	}
	id := pos[1]
	if _, ok := items[id]; !ok {
		return notFound(fmt.Sprintf("bin/knowledge sections %d", r.ID), "run #%d has no section %q", r.ID, id)
	}
	ov := r.overrides()
	path := filepath.Join(r.driftDir(), "overrides.json")
	if d.remove {
		delete(ov, id)
		if err := writeJSONFile(path, ov); err != nil {
			return err
		}
		return c.done(map[string]any{"run": r.ID, "section": id, "removed": true}, fmt.Sprintf("removed the decision on %s", id))
	}
	verdict, ok := verdictNames[d.verdict]
	if !ok {
		return usage("--verdict must be keep, change or new (got %q)", d.verdict)
	}
	if strings.TrimSpace(d.why) == "" {
		return usage("--why is required: what you checked in main and what it says")
	}
	body := d.text
	if d.textFile != "" {
		raw, err := os.ReadFile(d.textFile)
		if err != nil {
			return notFound("", "cannot read --text-file %s", d.textFile)
		}
		body = string(raw)
	}
	body = strings.TrimSpace(body)
	if verdict != "sigue" && body == "" {
		return usage("--verdict %s needs the new section text (--text-file or --text), without its «## » title", d.verdict)
	}
	if verdict == "sigue" && (body != "" || d.title != "") {
		return usage("--verdict keep takes no new text or title")
	}
	if strings.HasPrefix(body, "## ") {
		return usage("the text starts with a «## » title: pass the body only, and the title with --title")
	}
	// La evidencia «repo:ruta[:línea] (nota)» es lo que el verificador recibe de main: una que no parsea no le llega.
	known := map[string]bool{}
	for _, it := range items {
		for _, f := range it.Files {
			if repo, _, ok := strings.Cut(f, ":"); ok {
				known[repo] = true
			}
		}
	}
	for _, e := range d.evidence {
		m := reEvidence.FindStringSubmatch(strings.TrimSpace(e))
		if m == nil {
			return usage("--evidence %q: write it as repo:path[:line] (note)", e)
		}
		if !known[m[1]] {
			return usage("--evidence %q: repo %q is not one this run reads (%s), so the verifier would not get it",
				e, m[1], strings.Join(keys(known), ", "))
		}
	}
	ov[id] = override{Verdict: verdict, NewText: body, NewTitle: d.title, Why: d.why, Evidence: d.evidence}
	if err := writeJSONFile(path, ov); err != nil {
		return err
	}
	return c.done(map[string]any{"run": r.ID, "section": id, "verdict": verdict, "file": path},
		fmt.Sprintf("decided %s: %s (%s)\nnext: bin/knowledge resume %d --wait", id, d.verdict, path, r.ID))
}

func keys(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// filesEntry: lo que files.json dice de una fuente de la corrida (lo arma drift.py).
type filesEntry struct {
	Topic  string `json:"topic"`
	Repo   string `json:"repo"`
	Path   string `json:"path"`
	Ref    string `json:"ref"`
	Dir    string `json:"dir"`
	Exists bool   `json:"exists"`
}

func (c *cli) replace(pos []string, remove bool) error {
	if len(pos) < 2 || (len(pos) < 3 && !remove) {
		return usage("replace <run> <deleted-path> <new-path>   (or replace <run> <deleted-path> --remove)")
	}
	r, err := c.runArg(pos, true)
	if err != nil {
		return err
	}
	if err := editable(r); err != nil {
		return err
	}
	var files []filesEntry
	raw, err := os.ReadFile(filepath.Join(r.driftDir(), "files.json"))
	if err != nil || json.Unmarshal(raw, &files) != nil {
		return notFound("", "run #%d has no files.json (it did not get to «Armar paquetes»)", r.ID)
	}
	old := pos[1]
	var src *filesEntry
	var deleted []string
	for i := range files {
		if !files[i].Exists {
			deleted = append(deleted, files[i].Repo+":"+files[i].Path)
			if files[i].Path == old {
				src = &files[i]
			}
		}
	}
	if src == nil {
		if len(deleted) == 0 {
			return failed("", "run #%d has no deleted sources: nothing to replace", r.ID)
		}
		return notFound("", "%q is not a deleted source of run #%d; the deleted ones: %s", old, r.ID, strings.Join(deleted, ", "))
	}
	sw := r.swaps()
	path := filepath.Join(r.driftDir(), "reemplazos.json")
	if remove {
		delete(sw, old)
		if err := writeJSONFile(path, sw); err != nil {
			return err
		}
		return c.done(map[string]any{"run": r.ID, "removed": old}, "removed the replacement of "+old)
	}
	nu := pos[2]
	// El reemplazo se sella contra main: tiene que existir ahí, o aplicar falla después de verificar.
	if err := exec.Command("git", "-C", src.Dir, "cat-file", "-e", src.Ref+":"+nu).Run(); err != nil {
		return notFound(fmt.Sprintf("git -C %s ls-tree -r --name-only %s -- %s", src.Dir, src.Ref, filepath.Dir(nu)),
			"%s is not in %s of %s", nu, src.Ref, src.Repo)
	}
	sw[old] = nu
	if err := writeJSONFile(path, sw); err != nil {
		return err
	}
	return c.done(map[string]any{"run": r.ID, "deleted": old, "replacement": nu, "file": path},
		fmt.Sprintf("%s:%s → %s (%s)\nthe sections it backed still need a decision if they say something about the deleted file:\n  bin/knowledge sections %d",
			src.Repo, old, nu, path, r.ID))
}

// oneLine: el texto en una línea, cortado con «…» (el detalle entero va con --json).
func oneLine(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

func (c *cli) done(v any, text string) error {
	if c.json {
		return c.emit(v)
	}
	fmt.Fprintln(c.out, text)
	return nil
}

// ── resume y look ────────────────────────────────────────────────────────────────────────────────────────────────

func (c *cli) resume(pos []string, wait bool, timeout time.Duration) error {
	r, err := c.runArg(pos, true)
	if err != nil {
		return err
	}
	if r.State != stStopped {
		return failed("", "run #%d is %s: only a stopped run resumes (a failed one is retried by the next look)", r.ID, r.State)
	}
	if err := c.post(fmt.Sprintf("/api/runs/%d/resume", r.ID)); err != nil {
		return err
	}
	if !wait {
		msg := fmt.Sprintf("run #%d queued to resume", r.ID)
		if s, err := c.state(); err == nil && s.Look.Looking {
			msg += " (the watcher is looking at main: it starts when the look ends, a few minutes)"
		}
		return c.done(map[string]any{"run": r.ID, "queued": true}, msg+"\nfollow it: bin/knowledge run "+strconv.Itoa(r.ID))
	}
	if !c.json {
		fmt.Fprintf(c.out, "run #%d queued to resume; waiting (up to %s)…\n", r.ID, timeout)
	}
	deadline := time.Now().Add(timeout)
	lastStep := ""
	for time.Now().Before(deadline) {
		time.Sleep(5 * time.Second)
		s, err := c.state()
		if err != nil {
			continue // el servidor se reinicia: se sigue esperando
		}
		cur, err := c.f.runs.load(r.ID)
		if err != nil {
			return err
		}
		if !c.json {
			for _, st := range cur.Steps {
				if st.State == stRunning && st.Label != lastStep {
					lastStep = st.Label
					fmt.Fprintf(c.out, "  … %s\n", st.Label)
				}
			}
		}
		if s.ResumePending == r.ID || cur.State == stRunning {
			continue
		}
		if c.json {
			if err := c.emit(map[string]any{"run": cur.summary(), "next": nextSteps(cur)}); err != nil {
				return err
			}
		} else {
			if err := c.showRun([]string{strconv.Itoa(r.ID)}); err != nil {
				return err
			}
		}
		if cur.State != stPassed {
			return cliErr{code: 1, msg: fmt.Sprintf("run #%d %s again", r.ID, cur.State)}
		}
		return nil
	}
	return failed("bin/knowledge run "+strconv.Itoa(r.ID), "gave up waiting after %s; the run goes on", timeout)
}

func (c *cli) look(wait bool, timeout time.Duration) error {
	before, err := c.state()
	if err != nil {
		return err
	}
	if err := c.post("/api/look"); err != nil {
		return err
	}
	if !wait {
		return c.done(map[string]any{"asked": true}, "asked the watcher to look at main now (~5 min); bin/knowledge status shows it")
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		time.Sleep(5 * time.Second)
		s, err := c.state()
		if err != nil || s.Look.Looking || s.Look.At == before.Look.At {
			continue
		}
		if s.Running {
			// Encontró algo y arrancó una corrida: eso ya es otra espera.
			return c.done(map[string]any{"look": s.Look, "running": true},
				fmt.Sprintf("looked: %d stale source(s), and a run started → bin/knowledge run", len(s.Look.Changes)))
		}
		return c.status()
	}
	return failed("bin/knowledge status", "gave up waiting after %s", timeout)
}

// cliMain: la puerta desde main(). true si era un comando de la consola (y ya salió).
func cliMain() {
	if len(os.Args) < 2 {
		return
	}
	switch a := os.Args[1]; {
	case a == "help" || a == "-h" || a == "--help" || a == "-help":
		fmt.Println(cliHelp)
		os.Exit(0)
	case cliCommands[a]:
		root := os.Getenv("MY_TOOLS_ROOT")
		if root == "" {
			root, _ = os.Getwd()
		}
		os.Exit(runCLI(root, os.Args[1:]))
	case !strings.HasPrefix(a, "-"):
		fmt.Fprintln(os.Stderr, unknownCommand(a))
		os.Exit(2)
	}
}
