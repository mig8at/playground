package review

// LA CALIBRACIÓN DEL MAPA DE IMPACTO: ¿el nivel separa los cambios que después necesitaron un arreglo?
//
// Por qué existe. En las primeras pruebas, las tres ramas salieron «alto»: si todo es alto, el nivel no dice nada.
// Esto toma los PRs que ya entraron a la base en los últimos meses, les mide el impacto como estaba EL DÍA DEL MERGE
// (la base de ese merge, y las trampas y knowledge de my-tools de ese día, sacados de su historia: una trampa escrita
// después por culpa de ese PR no puede contar a su favor) y mira qué pasó después: si en las semanas siguientes entró
// a la base un arreglo (`fix`, `hotfix`, `revert`) que toca sus mismos archivos. Es una aproximación —un arreglo
// sobre el mismo archivo puede ser de otra cosa—, la misma idea con que se calibran los «diff risk score».
//
// Con eso dice, por señal y por umbrales: cuántos PRs marca y qué proporción de ellos necesitó un arreglo, contra la
// proporción de todos. Un buen nivel «alto» marca pocos y acierta más que el promedio.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// CalPR: un PR mergeado, con su impacto de ese día y lo que pasó después.
type CalPR struct {
	Merge   string    `json:"merge"`
	Date    time.Time `json:"date"`
	Subject string    `json:"subject"`
	Impact  Impact    `json:"impact"`
	Fixed   bool      `json:"fixed"`   // entró un arreglo sobre sus archivos dentro del horizonte
	FixedBy []string  `json:"fixedBy"` // esos arreglos
}

// Calibration: todos los PRs medidos.
type Calibration struct {
	Repo    string  `json:"repo"`
	Base    string  `json:"base"`
	Days    int     `json:"days"`
	Horizon int     `json:"horizon"`
	PRs     []CalPR `json:"prs"`
	Skipped int     `json:"skipped"` // los que no se miden: sincronizaciones de ramas, demasiado grandes o sin horizonte completo
}

var (
	// un arreglo: en el asunto del commit o en la rama del PR (`Merge pull request #12 from org/hotfix/x`)
	reFixEvent = regexp.MustCompile(`(?i)(^|[\s/(:_-])(fix|fixes|hotfix|bugfix|revert)\b`)
	// lo que no es un PR de alguien sino mover ramas: release, qa a main, merges de una rama de ambiente
	reSync = regexp.MustCompile(`(?i)\brelease\b|\bqa to main\b|\binto (main|qa|develop|staging)\b|^merge branch|from [^ ]+/(main|qa|develop|staging)$|^merge remote`)
	// archivos que se tocan en casi todo y no dicen nada de un arreglo
	reNoise = regexp.MustCompile(`(?i)(\.lock$|lock\.json$|lock\.yaml$|\.md$|^\.github/|CHANGELOG|\.snap$)`)
)

const calMaxFiles = 150 // un PR más grande es una sincronización o una mudanza: no se mide

// Calibrate mide los PRs de los últimos `days` días de `base` en el clon `repoDir`. `horizon`: cuántos días después del
// merge se buscan arreglos; un PR más nuevo que eso no se mide (su ventana no terminó). `progress`, si no es nil, recibe
// cuántos van de cuántos.
func Calibrate(ctx context.Context, myTools, repoDir, base string, days, horizon int, progress func(done, total int)) (Calibration, error) {
	cal := Calibration{Repo: filepath.Base(repoDir), Base: base, Days: days, Horizon: horizon}
	since := time.Now().AddDate(0, 0, -days)
	log, err := git(ctx, repoDir, "log", "--first-parent", "--since="+since.Format(time.RFC3339), "--format=%H%x09%P%x09%cI%x09%s", base)
	if err != nil {
		return cal, err
	}
	type event struct {
		sha, parent, subject string
		date                 time.Time
		files                map[string]bool
	}
	var events []event
	for _, line := range strings.Split(log, "\n") {
		parts := strings.SplitN(line, "\t", 4)
		if len(parts) != 4 {
			continue
		}
		parents := strings.Fields(parts[1])
		if len(parents) == 0 {
			continue
		}
		date, _ := time.Parse(time.RFC3339, parts[2])
		events = append(events, event{sha: parts[0], parent: parents[0], subject: parts[3], date: date})
	}
	// los archivos de cada uno (lo que ese commit le trajo a la base)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range events {
		wg.Add(1)
		sem <- struct{}{}
		go func(e *event) {
			defer wg.Done()
			defer func() { <-sem }()
			out, _ := git(ctx, repoDir, "diff", "--name-only", e.parent, e.sha)
			e.files = map[string]bool{}
			for _, f := range strings.Split(out, "\n") {
				if f != "" && !reNoise.MatchString(f) {
					e.files[f] = true
				}
			}
		}(&events[i])
	}
	wg.Wait()

	// lo que my-tools sabía cada día, una vez por versión de my-tools
	asOf := newAsOf(ctx, myTools)
	defer asOf.cleanup()

	cutoff := time.Now().AddDate(0, 0, -horizon)
	var todo []int
	for i, e := range events {
		if reSync.MatchString(e.subject) || len(e.files) == 0 || len(e.files) > calMaxFiles || e.date.After(cutoff) {
			cal.Skipped++
			continue
		}
		todo = append(todo, i)
	}
	results := make([]CalPR, len(todo))
	done := 0
	var mu sync.Mutex
	for k, i := range todo {
		wg.Add(1)
		sem <- struct{}{}
		go func(k int, e event) {
			defer wg.Done()
			defer func() { <-sem }()
			im := measure(ctx, asOf.at(e.date), repoDir, e.parent, e.sha)
			pr := CalPR{Merge: e.sha[:10], Date: e.date, Subject: e.subject, Impact: im, FixedBy: []string{}}
			end := e.date.AddDate(0, 0, horizon)
			for _, f := range events {
				if f.sha == e.sha || !f.date.After(e.date) || f.date.After(end) || !reFixEvent.MatchString(f.subject) {
					continue
				}
				for path := range f.files {
					if e.files[path] {
						pr.Fixed = true
						pr.FixedBy = append(pr.FixedBy, f.sha[:10]+" "+f.subject)
						break
					}
				}
			}
			results[k] = pr
			mu.Lock()
			done++
			if progress != nil {
				progress(done, len(todo))
			}
			mu.Unlock()
		}(k, events[i])
	}
	wg.Wait()
	sort.Slice(results, func(a, b int) bool { return results[a].Date.Before(results[b].Date) })
	cal.PRs = results
	return cal, nil
}

// asOf: my-tools como estaba un día, desde su propia historia. Las trampas vivieron en `tablero/data/traps/doc.md` y
// desde el 2026-11-18 en `knowledge/traps/traps.md`; knowledge se extrae a una carpeta temporal por versión.
type asOfCache struct {
	ctx     context.Context
	myTools string
	tmp     string
	mu      sync.Mutex
	byRev   map[string]source
}

func newAsOf(ctx context.Context, myTools string) *asOfCache {
	tmp, _ := os.MkdirTemp("", "goldfish-calibrate-")
	return &asOfCache{ctx: ctx, myTools: myTools, tmp: tmp, byRev: map[string]source{}}
}

func (a *asOfCache) cleanup() { _ = os.RemoveAll(a.tmp) }

func (a *asOfCache) at(day time.Time) source {
	rev, _ := git(a.ctx, a.myTools, "rev-list", "-1", "--before="+day.Format(time.RFC3339), "HEAD")
	rev = strings.TrimSpace(rev)
	a.mu.Lock()
	defer a.mu.Unlock()
	if src, ok := a.byRev[rev]; ok {
		return src
	}
	src := source{myTools: a.myTools}
	if rev != "" {
		for _, path := range []string{"knowledge/traps/traps.md", "tablero/data/traps/doc.md"} {
			if raw, err := git(a.ctx, a.myTools, "show", rev+":"+path); err == nil {
				src.traps = raw
				break
			}
		}
		if out, _ := git(a.ctx, a.myTools, "ls-tree", "-d", rev, "knowledge"); strings.TrimSpace(out) != "" {
			dir := filepath.Join(a.tmp, rev)
			_ = os.MkdirAll(dir, 0o755)
			cmd := exec.CommandContext(a.ctx, "sh", "-c", "git -C \"$1\" archive \"$2\" knowledge | tar -x -C \"$3\"", "sh", a.myTools, rev, dir)
			if cmd.Run() == nil {
				src.knowledgeDir = filepath.Join(dir, "knowledge")
			}
		}
	}
	a.byRev[rev] = src
	return src
}

// ── el informe ──────────────────────────────────────────────────────────────────────────────────────────────────────

// Lift: una señal (o un nivel) y cómo le fue.
type Lift struct {
	Name    string  `json:"name"`
	Marked  int     `json:"marked"`  // cuántos PRs marca
	Fixed   int     `json:"fixed"`   // de ésos, cuántos necesitaron un arreglo
	Rate    float64 `json:"rate"`    // fixed / marked
	Share   float64 `json:"share"`   // marked / todos
	Lift    float64 `json:"lift"`    // rate / la proporción de todos
	RestFix float64 `json:"restFix"` // la proporción entre los que NO marca
}

func lift(name string, prs []CalPR, keep func(CalPR) bool) Lift {
	l := Lift{Name: name}
	all, allFixed, restN, restFixed := len(prs), 0, 0, 0
	for _, p := range prs {
		if p.Fixed {
			allFixed++
		}
		if keep(p) {
			l.Marked++
			if p.Fixed {
				l.Fixed++
			}
		} else {
			restN++
			if p.Fixed {
				restFixed++
			}
		}
	}
	if l.Marked > 0 {
		l.Rate = float64(l.Fixed) / float64(l.Marked)
	}
	if all > 0 {
		l.Share = float64(l.Marked) / float64(all)
		if allFixed > 0 {
			l.Lift = l.Rate / (float64(allFixed) / float64(all))
		}
	}
	if restN > 0 {
		l.RestFix = float64(restFixed) / float64(restN)
	}
	return l
}

func maxOver(im Impact, f func(FileSignal) int) int {
	m := 0
	for _, s := range im.Signals {
		if v := f(s); v > m {
			m = v
		}
	}
	return m
}

// Signals: cada señal por separado.
func (c Calibration) Signals() []Lift {
	fan := func(n int) func(CalPR) bool {
		return func(p CalPR) bool { return maxOver(p.Impact, func(s FileSignal) int { return s.FanIn }) >= n }
	}
	fixes := func(n int) func(CalPR) bool {
		return func(p CalPR) bool { return maxOver(p.Impact, func(s FileSignal) int { return s.Fixes90 }) >= n }
	}
	kind := func(k string) func(CalPR) bool {
		return func(p CalPR) bool {
			for _, s := range p.Impact.Signals {
				if contains(s.Kinds, k) {
					return true
				}
			}
			return false
		}
	}
	out := []Lift{
		lift("toca una trampa (de ese día)", c.PRs, func(p CalPR) bool { return len(p.Impact.Traps) > 0 }),
		lift("toca knowledge (de ese día)", c.PRs, func(p CalPR) bool { return len(p.Impact.Knowledge) > 0 }),
		lift("trae una migración", c.PRs, kind("migration")),
		lift("cambia rutas del backend", c.PRs, kind("route")),
		lift("par en el otro monolito", c.PRs, func(p CalPR) bool {
			for _, s := range p.Impact.Signals {
				if s.OtherTwin != "" {
					return true
				}
			}
			return false
		}),
		lift("cambia código y ninguna prueba", c.PRs, func(p CalPR) bool { return p.Impact.NoTests }),
	}
	for _, n := range []int{5, 10, 15, 25, 40} {
		out = append(out, lift(fmt.Sprintf("un archivo lo nombran ≥%d", n), c.PRs, fan(n)))
	}
	for _, n := range []int{1, 2, 3, 5, 8} {
		out = append(out, lift(fmt.Sprintf("un archivo con ≥%d arreglos en 90 días", n), c.PRs, fixes(n)))
	}
	for _, n := range []int{5, 10, 20} {
		n := n
		out = append(out, lift(fmt.Sprintf("≥%d archivos", n), c.PRs, func(p CalPR) bool { return p.Impact.Files >= n }))
	}
	return out
}

// Levels: cómo reparte los PRs el nivel con esos umbrales.
func (c Calibration) Levels(th Thresholds) []Lift {
	graded := make([]CalPR, len(c.PRs))
	for i, p := range c.PRs {
		im := p.Impact
		im.Grade(th)
		p.Impact = im
		graded[i] = p
	}
	var out []Lift
	for _, lv := range []string{"high", "medium", "low"} {
		lv := lv
		out = append(out, lift(label(impactLabels, lv), graded, func(p CalPR) bool { return p.Impact.Level == lv }))
	}
	return out
}

// Search: prueba umbrales y se queda con los que hacen de «alto» una señal útil: que marque pocos (hasta `maxShare`)
// y que, entre los que marca, la proporción de arreglos sea la más alta posible.
func (c Calibration) Search(maxShare float64) []ThresholdResult {
	var out []ThresholdResult
	for _, fx := range []int{3, 5, 8} {
		for _, fh := range []int{10, 15, 25, 40} {
			for _, bf := range []int{10, 20, 30} {
				th := Thresholds{FixesHigh: fx, FanInHigh: fh, BigFiles: bf}
				lv := c.Levels(th)
				if lv[0].Marked == 0 || lv[0].Share > maxShare {
					continue
				}
				out = append(out, ThresholdResult{Thresholds: th, High: lv[0], Medium: lv[1], Low: lv[2]})
			}
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].High.Rate != out[j].High.Rate {
			return out[i].High.Rate > out[j].High.Rate
		}
		return out[i].High.Marked > out[j].High.Marked
	})
	return out
}

// ThresholdResult: unos umbrales y cómo reparten.
type ThresholdResult struct {
	Thresholds Thresholds `json:"thresholds"`
	High       Lift       `json:"high"`
	Medium     Lift       `json:"medium"`
	Low        Lift       `json:"low"`
}

// Markdown: el informe de la calibración.
func (c Calibration) Markdown(maxShare float64) string {
	var b strings.Builder
	fixed := 0
	for _, p := range c.PRs {
		if p.Fixed {
			fixed++
		}
	}
	base := 0.0
	if len(c.PRs) > 0 {
		base = float64(fixed) / float64(len(c.PRs))
	}
	fmt.Fprintf(&b, "## Calibración · %s · %s, últimos %d días\n\n", c.Repo, c.Base, c.Days)
	fmt.Fprintf(&b, "%d PRs medidos (%d fuera: sincronizaciones de ramas, más de %d archivos o con menos de %d días desde el merge). "+
		"**%d (%.0f %%) necesitaron un arreglo** sobre sus archivos en los %d días siguientes: ésa es la vara.\n\n",
		len(c.PRs), c.Skipped, calMaxFiles, c.Horizon, fixed, 100*base, c.Horizon)
	row := func(l Lift) string {
		return fmt.Sprintf("| %s | %d (%.0f %%) | %.0f %% | ×%.2f | %.0f %% |\n", l.Name, l.Marked, 100*l.Share, 100*l.Rate, l.Lift, 100*l.RestFix)
	}
	head := "| | marca | de ésos, con arreglo | contra el promedio | entre los que no marca |\n|---|---|---|---|---|\n"
	b.WriteString("### Cada señal\n\n" + head)
	for _, l := range c.Signals() {
		b.WriteString(row(l))
	}
	b.WriteString("\n### El nivel con los umbrales de hoy\n\n" + head)
	for _, l := range c.Levels(DefaultThresholds) {
		b.WriteString(row(l))
	}
	fmt.Fprintf(&b, "\n### Los mejores umbrales («alto» marca hasta el %.0f %% de los PRs)\n\n", 100*maxShare)
	b.WriteString("| arreglos ≥ | nombran ≥ | archivos ≥ | alto: marca · con arreglo | medio | bajo |\n|---|---|---|---|---|---|\n")
	for i, r := range c.Search(maxShare) {
		if i == 8 {
			break
		}
		fmt.Fprintf(&b, "| %d | %d | %d | %d (%.0f %%) · %.0f %% | %d · %.0f %% | %d · %.0f %% |\n",
			r.Thresholds.FixesHigh, r.Thresholds.FanInHigh, r.Thresholds.BigFiles,
			r.High.Marked, 100*r.High.Share, 100*r.High.Rate, r.Medium.Marked, 100*r.Medium.Rate, r.Low.Marked, 100*r.Low.Rate)
	}
	b.WriteString("\n«Con arreglo»: entró a la base un fix, hotfix o revert que toca alguno de sus archivos. Es una aproximación: puede ser de otra cosa.\n")
	return b.String()
}
