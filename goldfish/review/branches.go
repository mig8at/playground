// Package review: GOLDFISH, la validación de una rama antes de abrir su PR, con el modelo Elephant-Goldfish
// (https://github.com/google/elephant-goldfish-model). Quien propone no valida su propio trabajo:
//
//   - ELEPHANT, con todo el contexto local (el playground: la tarea, knowledge/, las trampas), arma la propuesta: el
//     diff contra main y la descripción del PR (la del PR si ya existe; si no, la redacta).
//   - GOLDFISH, revisores en frío: reciben SÓLO la propuesta (descripción, diff, los archivos tocados y lo que la
//     tarea dice que tiene que cumplir), en una carpeta aparte y sin las instrucciones del proyecto. Lo que el elephant
//     sabe y no dejó escrito es justo lo que tienen que encontrar.
//   - ELEPHANT OTRA VEZ, con contexto: le da a cada hallazgo su veredicto contra el código de verdad (confirmado,
//     plausible o descartado) y suma lo que sólo se ve con el playground: las trampas ya vividas, el conocimiento de la
//     tarea y las reglas de los PRs (la descripción no nombra herramientas internas, un PR por tarea y por repo).
//   - MIGUEL resuelve: decide qué corregir. Goldfish no abre PRs ni pushea: sólo valida.
//
// Este archivo: qué ramas están por subir.
package review

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Branch: una rama local de un repo real con commits que main todavía no tiene.
type Branch struct {
	Repo      string `json:"repo"`      // la carpeta en ~/Desktop/CREDITOP/github
	Slug      string `json:"slug"`      // owner/name en GitHub
	Name      string `json:"name"`      // la rama
	Base      string `json:"base"`      // contra qué se compara: origin/main (o la rama por defecto)
	Ahead     int    `json:"ahead"`     // commits que main no tiene
	Behind    int    `json:"behind"`    // commits de main que la rama no tiene
	Updated   string `json:"updated"`   // el último commit
	Subject   string `json:"subject"`   // su mensaje
	PR        *PR    `json:"pr"`        // su PR, si tiene
	Task      *Task  `json:"task"`      // la tarea del tablero que la declara en `ramas:`
	LastRunID string `json:"lastRunId"` // la última validación
}

// PR: el de la rama en GitHub.
type PR struct {
	Number int    `json:"number"`
	State  string `json:"state"` // OPEN · MERGED · CLOSED
	URL    string `json:"url"`
	Title  string `json:"title"`
}

// Lo que no se valida: las ramas largas de los ambientes.
var longLived = map[string]bool{"main": true, "master": true, "develop": true, "qa": true, "staging": true, "main-pro": true}

// RecentDays: sólo las ramas con un commit en este tiempo (una rama de hace meses no está «por subir»).
const RecentDays = 45

// ReposDir: dónde están los clones de los repos reales.
func ReposDir() string {
	if d := os.Getenv("GOLDFISH_REPOS"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Desktop", "CREDITOP", "github")
}

func git(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("git %s: %s", strings.Join(args, " "), strings.TrimSpace(string(ee.Stderr)))
		}
		return "", err
	}
	return strings.TrimRight(string(out), "\n"), nil
}

// baseRef: la rama por defecto del remoto (origin/main casi siempre).
func baseRef(ctx context.Context, dir string) string {
	if ref, err := git(ctx, dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"); err == nil && ref != "" {
		return ref
	}
	for _, b := range []string{"origin/main", "origin/master"} {
		if _, err := git(ctx, dir, "rev-parse", "--verify", "--quiet", b); err == nil {
			return b
		}
	}
	return ""
}

// slugOf: owner/name del remoto origin. Acepta https, ssh y los alias de ~/.ssh/config («git@github.com-mig:owner/name»).
func slugOf(ctx context.Context, dir string) string {
	url, err := git(ctx, dir, "remote", "get-url", "origin")
	if err != nil {
		return ""
	}
	if m := reRemote.FindStringSubmatch(strings.TrimSpace(url)); m != nil {
		return m[1]
	}
	return ""
}

var reRemote = regexp.MustCompile(`github\.com[^:/]*[:/]([^/]+/[^/]+?)(?:\.git)?/?$`)

// repoBranches: las ramas de un repo con commits por delante de su base, tocadas en los últimos RecentDays.
func repoBranches(ctx context.Context, dir string) ([]Branch, error) {
	base := baseRef(ctx, dir)
	if base == "" {
		return nil, nil
	}
	refs, err := git(ctx, dir, "for-each-ref", "refs/heads", "--format=%(refname:short)\t%(committerdate:iso-strict)\t%(subject)")
	if err != nil {
		return nil, err
	}
	since := time.Now().AddDate(0, 0, -RecentDays)
	repo, slug := filepath.Base(dir), slugOf(ctx, dir)
	var out []Branch
	for _, line := range strings.Split(refs, "\n") {
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) < 3 || longLived[parts[0]] {
			continue
		}
		when, err := time.Parse(time.RFC3339, parts[1])
		if err != nil || when.Before(since) {
			continue
		}
		counts, err := git(ctx, dir, "rev-list", "--left-right", "--count", base+"..."+parts[0])
		if err != nil {
			continue
		}
		f := strings.Fields(counts)
		if len(f) != 2 {
			continue
		}
		behind, _ := strconv.Atoi(f[0])
		ahead, _ := strconv.Atoi(f[1])
		if ahead == 0 {
			continue
		}
		out = append(out, Branch{Repo: repo, Slug: slug, Name: parts[0], Base: base, Ahead: ahead, Behind: behind, Updated: parts[1], Subject: parts[2]})
	}
	return out, nil
}

// prsOf: los PRs de Miguel en un repo, por rama (una sola llamada a gh por repo).
func prsOf(ctx context.Context, slug string) map[string]*PR {
	out := map[string]*PR{}
	if slug == "" {
		return out
	}
	cmd := exec.CommandContext(ctx, "gh", "pr", "list", "-R", slug, "--author", "@me", "--state", "all", "--limit", "200",
		"--json", "headRefName,number,state,url,title")
	raw, err := cmd.Output()
	if err != nil {
		return out
	}
	var prs []struct {
		Head   string `json:"headRefName"`
		Number int    `json:"number"`
		State  string `json:"state"`
		URL    string `json:"url"`
		Title  string `json:"title"`
	}
	if json.Unmarshal(raw, &prs) != nil {
		return out
	}
	// gh los da del más nuevo al más viejo: queda el más nuevo de cada rama
	for i := len(prs) - 1; i >= 0; i-- {
		p := prs[i]
		out[p.Head] = &PR{Number: p.Number, State: p.State, URL: p.URL, Title: p.Title}
	}
	return out
}

var (
	cacheMu  sync.Mutex
	cached   []Branch
	cachedAt time.Time
)

// CacheTTL: la lista se recalcula a lo sumo cada tanto (pregunta a GitHub una vez por repo).
const CacheTTL = 3 * time.Minute

// Pending: las ramas por subir de todos los repos reales, con su PR y su tarea. Primero las que no tienen PR.
func Pending(ctx context.Context, playground string, refresh bool) ([]Branch, error) {
	cacheMu.Lock()
	if !refresh && cached != nil && time.Since(cachedAt) < CacheTTL {
		out := append([]Branch(nil), cached...)
		cacheMu.Unlock()
		return withLastRuns(playground, out), nil
	}
	cacheMu.Unlock()
	dirs, err := os.ReadDir(ReposDir())
	if err != nil {
		return nil, err
	}
	tasks := LoadTasks(playground)
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		all []Branch
	)
	sem := make(chan struct{}, 6)
	for _, d := range dirs {
		dir := filepath.Join(ReposDir(), d.Name())
		if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			bs, err := repoBranches(ctx, dir)
			if err != nil || len(bs) == 0 {
				return
			}
			prs := prsOf(ctx, bs[0].Slug)
			for i := range bs {
				bs[i].PR = prs[bs[i].Name]
				bs[i].Task = tasks.ForBranch(bs[i].Repo, bs[i].Name)
			}
			mu.Lock()
			all = append(all, bs...)
			mu.Unlock()
		}()
	}
	wg.Wait()
	all = dedupe(all)
	sort.Slice(all, func(i, j int) bool {
		pi, pj := rank(all[i]), rank(all[j])
		if pi != pj {
			return pi < pj
		}
		return all[i].Updated > all[j].Updated
	})
	cacheMu.Lock()
	cached, cachedAt = all, time.Now()
	cacheMu.Unlock()
	return withLastRuns(playground, append([]Branch(nil), all...)), nil
}

// rank: primero lo que está por subir (sin PR), después lo que tiene un PR abierto, al final lo ya mergeado o cerrado.
func rank(b Branch) int {
	switch {
	case b.PR == nil:
		return 0
	case b.PR.State == "OPEN":
		return 1
	default:
		return 2
	}
}

// FindBranch: una rama por repo y nombre (de la lista, o leída en el momento si todavía no estaba).
func FindBranch(ctx context.Context, playground, repo, name string) (Branch, error) {
	all, err := Pending(ctx, playground, false)
	if err != nil {
		return Branch{}, err
	}
	for _, b := range all {
		if b.Repo == repo && b.Name == name {
			return b, nil
		}
	}
	dir := filepath.Join(ReposDir(), repo)
	bs, err := repoBranches(ctx, dir)
	if err != nil {
		return Branch{}, err
	}
	for _, b := range bs {
		if b.Name == name {
			b.Task = LoadTasks(playground).ForBranch(repo, name)
			b.PR = prsOf(ctx, b.Slug)[name]
			return b, nil
		}
	}
	return Branch{}, fmt.Errorf("no encuentro la rama %q en %s con commits por delante de main", name, repo)
}

// dedupe: varios clones del mismo repo de GitHub (legacy-backend y legacy-backend-finandina, los del playground
// compartido) traen la misma rama. Queda una: la del clon que se llama como el repo; si ninguno, la del commit más nuevo.
func dedupe(all []Branch) []Branch {
	best := map[string]int{}
	var out []Branch
	for _, b := range all {
		if b.Slug == "" {
			out = append(out, b)
			continue
		}
		k := b.Slug + "\x00" + b.Name
		i, ok := best[k]
		if !ok {
			best[k] = len(out)
			out = append(out, b)
			continue
		}
		cur := out[i]
		own := func(x Branch) bool { return path.Base(x.Slug) == x.Repo }
		if (own(b) && !own(cur)) || (own(b) == own(cur) && b.Updated > cur.Updated) {
			if b.Task == nil {
				b.Task = cur.Task
			}
			out[i] = b
		}
	}
	return out
}
