package main

// LOS PASOS. Los de comando son los de `tools/knowledge-drift/drift.py` (paquete, codigo, final, aplicar), con la
// corrida en su carpeta; los de modelo los hace el modelo de segundo plano (model.go). Una corrida para en el primer paso
// que frena o falla, y lo que ya aplicó y no pasó la comprobación se deshace.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"creditop/my-tools/connectors/claude"
)

// errStop: un freno a propósito (no es una falla): la corrida queda «frenada» y espera.
type errStop struct{ msg string }

func (e errStop) Error() string { return e.msg }

func stop(format string, a ...any) error { return errStop{fmt.Sprintf(format, a...)} }

// sh corre un comando en la raíz de my-tools y devuelve su salida (con stderr si falla).
func (f *flow) sh(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = f.root
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if err != nil {
		tail := strings.TrimSpace(errb.String())
		if len(tail) > 600 {
			tail = "…" + tail[len(tail)-600:]
		}
		return out.String(), fmt.Errorf("%s %s: %v %s", name, strings.Join(args, " "), err, tail)
	}
	return out.String(), nil
}

func (f *flow) drift(ctx context.Context, r *Run, step string) (string, error) {
	args := []string{"tools/knowledge-drift/drift.py", step, "--run", r.driftDir(), "--groups", "4"}
	if knowledgeModel == "aistudio" && (step == "paquete" || step == "codigo") {
		args = append(args, "--big") // paquetes grandes: la ventana de AI Studio
	}
	if step == "paquete" {
		args = append(args, "--no-fetch") // la mirada que disparó la corrida ya trajo main
	}
	return f.sh(ctx, "python3", args...)
}

func (r *Run) driftDir() string { return filepath.Join(r.dir, "drift") }

// execute corre los pasos que faltan, de a uno. Los dos primeros ya los hizo la mirada que la disparó.
func (f *flow) execute(ctx context.Context, r *Run) {
	type fn func(context.Context, *Run, *Step) error
	steps := map[string]fn{
		"package": f.stepPackage, "triage": f.stepTriage, "code": f.stepCode, "second": f.stepSecond,
		"final": f.stepFinal, "verify": f.stepVerify, "apply": f.stepApply, "check": f.stepCheck,
	}
	for i := range r.Steps {
		st := &r.Steps[i]
		run := steps[st.ID]
		if run == nil || st.State != stQueued {
			continue
		}
		st.State, st.StartedAt = stRunning, now()
		f.runs.save(r)
		err := run(ctx, r, st)
		st.FinishedAt, st.Now = now(), ""
		var halt errStop
		switch {
		case err == nil:
			if st.State == stRunning {
				st.State = stDone
			}
		case errors.As(err, &halt):
			st.State, r.State, r.Result = stStopped, stStopped, "frenó en «"+st.Label+"»: "+halt.msg
		default:
			st.State, r.State, r.Result = stFailed, stFailed, "falló en «"+st.Label+"»: "+err.Error()
			r.ModelDown = st.Who == "modelo" && modelUnavailable(err)
		}
		f.runs.save(r)
		if err != nil {
			f.undoApply(r)
			break
		}
	}
	if r.State == stRunning {
		r.State = stPassed
	}
	r.FinishedAt = now()
	f.runs.save(r)
}

// modelUnavailable: el error es que el modelo no se pudo usar (sin sesión, la sesión venció, el puente no contesta),
// no que contestó algo malo. Ésos no cuentan como intento fallido.
func modelUnavailable(err error) bool {
	if errors.Is(err, claude.ErrSession) {
		return true
	}
	msg := strings.ToLower(err.Error())
	// el 502 del puente de Bedrock y las pausas de AI Studio (cupo diario, corte de Google, Chrome sin Jarvis) también
	// son «el modelo no contesta»: la corrida espera y se retoma desde el paso donde cayó, sin contar como intento.
	for _, s := range []string{"playground login", "sesión del playground", "connection refused", "no such host", "timeout", "deadline exceeded", "eof",
		"502", "no pudo completar la invocación", "cupo diario", "daily limit", "en pausa", "está cortando", "quota exceeded", "jarvis"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// ── 3 · paquete ──────────────────────────────────────────────────────────────────────────────────────────────────

func (f *flow) stepPackage(ctx context.Context, r *Run, st *Step) error {
	_ = os.MkdirAll(r.driftDir(), 0o755)
	out, err := f.drift(ctx, r, "paquete")
	if err != nil {
		return err
	}
	lines := strings.Split(strings.TrimSpace(out), "\n")
	st.Summary = strings.TrimPrefix(lines[len(lines)-1], "corrida "+r.driftDir()+": ")
	for _, l := range lines {
		if strings.Contains(l, "⚠") {
			st.Detail = append(st.Detail, strings.TrimSpace(l))
		}
	}
	return nil
}

// ── 7 · juntar ───────────────────────────────────────────────────────────────────────────────────────────────────

// verdict: un veredicto final de una sección (final.json de drift.py).
type verdict struct {
	ID       string   `json:"id"`
	Verdict  string   `json:"veredicto"`
	Why      string   `json:"por_que"`
	Evidence []string `json:"evidencia"`
	NewText  string   `json:"texto_nuevo"`
	NewTitle string   `json:"titulo_nuevo"`
	Source   string   `json:"fuente"`
}

func (r *Run) finals() (map[string]verdict, error) {
	raw, err := os.ReadFile(filepath.Join(r.driftDir(), "final.json"))
	if err != nil {
		return nil, err
	}
	out := map[string]verdict{}
	return out, json.Unmarshal(raw, &out)
}

func (f *flow) stepFinal(ctx context.Context, r *Run, st *Step) error {
	if _, err := f.drift(ctx, r, "final"); err != nil {
		return err
	}
	fin, err := r.finals()
	if err != nil {
		return err
	}
	count := map[string]int{}
	var undecided []string
	for id, v := range fin {
		count[v.Verdict]++
		if v.Verdict != "sigue" && v.Verdict != "cambia" && v.Verdict != "nueva" {
			undecided = append(undecided, id+": "+v.Why)
		}
		if (v.Verdict == "cambia" || v.Verdict == "nueva") && strings.TrimSpace(v.NewText) == "" {
			undecided = append(undecided, id+": dice que cambia pero no trae el texto nuevo")
		}
	}
	st.Summary = fmt.Sprintf("%d siguen ciertas · %d cambian · %d sin decidir", count["sigue"], count["cambia"]+count["nueva"], len(undecided))
	if len(undecided) > 0 {
		sort.Strings(undecided)
		st.Detail = undecided
		// Aplicar sella TODAS las fuentes de la corrida: con una sección sin decidir, sellaría algo que nadie verificó.
		return stop("%d sección(es) sin decidir: aplicar sellaría fuentes que nadie verificó", len(undecided))
	}
	return nil
}

// ── 9 · aplicar ──────────────────────────────────────────────────────────────────────────────────────────────────

// topicPaths: los archivos de knowledge que la corrida puede tocar.
func (r *Run) topicPaths() []string {
	var out []string
	for _, t := range r.Topics {
		out = append(out, filepath.Join("knowledge", t, "rules.md"), filepath.Join("knowledge", t, "sources.json"))
	}
	return out
}

func (f *flow) stepApply(ctx context.Context, r *Run, st *Step) error {
	// Otra sesión puede tener a medias el mismo tema: aplicar encima mezclaría su trabajo con el de la corrida.
	dirty, err := f.sh(ctx, "git", append([]string{"status", "--porcelain", "--"}, r.topicPaths()...)...)
	if err != nil {
		return err
	}
	if strings.TrimSpace(dirty) != "" {
		st.Detail = strings.Split(strings.TrimSpace(dirty), "\n")
		return stop("hay cambios sin commitear en esos temas: no se tocan")
	}
	if _, err := f.drift(ctx, r, "aplicar"); err != nil {
		return err
	}
	changed, _ := f.sh(ctx, "git", append([]string{"diff", "--stat", "--"}, r.topicPaths()...)...)
	lines := strings.Split(strings.TrimSpace(changed), "\n")
	if len(lines) > 0 {
		st.Summary = lines[len(lines)-1]
	}
	return nil
}

// undoApply: si la corrida frenó o falló después de aplicar, deja los temas como estaban (aplicar sólo arranca con
// ellos limpios, así que lo que hay es de la corrida).
func (f *flow) undoApply(r *Run) {
	if r.step("apply").State != stDone {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if _, err := f.sh(ctx, "git", append([]string{"checkout", "--"}, r.topicPaths()...)...); err == nil {
		r.Result += " · se deshizo lo aplicado"
	}
}

// ── 10 · comprobar y commitear ───────────────────────────────────────────────────────────────────────────────────

func (f *flow) stepCheck(ctx context.Context, r *Run, st *Step) error {
	out, err := f.sh(ctx, "go", "run", "./cmd/knowledge", "check", "--json")
	var states []Change
	_ = json.Unmarshal([]byte(out), &states)
	var still []string
	for _, c := range states {
		if c.State != "unchanged" && contains(r.Topics, c.Topic) {
			still = append(still, c.Topic+" · "+c.Repo+"/"+c.Path+" · "+c.State)
		}
	}
	if len(still) > 0 {
		st.Detail = still
		return stop("después de aplicar, %d fuente(s) de la corrida siguen viejas", len(still))
	}
	_ = err // check sale 1 si QUEDA algo viejo en otro tema (de la cola): no es de esta corrida
	if _, err := f.sh(ctx, "make", "knowledge-test"); err != nil {
		st.Detail = []string{err.Error()}
		return stop("make knowledge-test no pasa")
	}
	diff, _ := f.sh(ctx, "git", append([]string{"status", "--porcelain", "--"}, r.topicPaths()...)...)
	if strings.TrimSpace(diff) == "" {
		st.Summary = "knowledge-check y knowledge-test en verde · nada que commitear"
		r.Result = "al día: nada cambió en la prosa"
		return nil
	}
	msg := fmt.Sprintf("knowledge: puesto al día contra main (corrida #%d de Knowledge)\n\n%s", r.ID, strings.Join(r.Topics, ", "))
	args := append([]string{"commit", "-q", "-m", msg, "--"}, r.topicPaths()...)
	if _, err := f.sh(ctx, "git", args...); err != nil {
		return err
	}
	sha, _ := f.sh(ctx, "git", "rev-parse", "--short", "HEAD")
	r.Commit = strings.TrimSpace(sha)
	st.Summary = "knowledge-check y knowledge-test en verde · commit " + r.Commit
	fin, _ := r.finals()
	changed := 0
	for _, v := range fin {
		if v.Verdict == "cambia" || v.Verdict == "nueva" {
			changed++
		}
	}
	if changed > 0 {
		r.Result = fmt.Sprintf("%d sección(es) reescritas y fuentes selladas · commit %s", changed, r.Commit)
	} else {
		r.Result = "todo «sigue cierta»: sólo se sellaron las fuentes · commit " + r.Commit
	}
	return nil
}

func contains(list []string, x string) bool {
	for _, y := range list {
		if y == x {
			return true
		}
	}
	return false
}

// files de un directorio de la corrida que empiezan con prefix, en orden.
func filesIn(dir, prefix string) []string {
	entries, _ := os.ReadDir(dir)
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), prefix) {
			out = append(out, filepath.Join(dir, e.Name()))
		}
	}
	sort.Strings(out)
	return out
}

var reGitDiff = regexp.MustCompile("`git -C (\\S+) diff (\\S+) (\\S+) -- ([^`]+)`")
