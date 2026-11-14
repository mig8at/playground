// Package review: GOLDFISH, la validación de un PR con el modelo Elephant-Goldfish
// (https://github.com/google/elephant-goldfish-model). Quien propone no valida su propio trabajo:
//
//   - LA PROPUESTA es el PR: su título y su descripción, el diff contra su base, los archivos como quedan y, si la
//     rama es de una tarea del tablero, lo que la tarea pide.
//   - GOLDFISH, dos revisores en frío: reciben SÓLO la propuesta, en una carpeta aparte y sin las instrucciones del
//     proyecto. Lo que quien lo escribió sabe y no dejó escrito es justo lo que tienen que encontrar.
//   - ELEPHANT, con todo el contexto local (my-tools: la tarea, knowledge/, las trampas): le da a cada hallazgo
//     su veredicto contra el código de verdad (confirmado, plausible o descartado) y suma lo que sólo se ve con ese
//     contexto.
//   - MIGUEL resuelve: decide qué corregir o qué comentar. Goldfish no comenta en GitHub, no aprueba ni pushea.
//
// Este archivo: qué PRs se listan. Los de Miguel que siguen abiertos (con el título que les puso; lo mergeado o
// cerrado se va solo), y los de otros que él pegó para validar («externos»), mientras sigan abiertos.
package review

import (
	"context"
	"encoding/json"
	"errors"
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

// PR: un pull request de GitHub.
type PR struct {
	Slug      string `json:"slug"` // owner/name
	Number    int    `json:"number"`
	URL       string `json:"url"`
	Title     string `json:"title"`
	State     string `json:"state"` // OPEN · MERGED · CLOSED
	Author    string `json:"author"`
	Head      string `json:"head"` // la rama
	Base      string `json:"base"` // contra qué
	Draft     bool   `json:"draft"`
	Updated   string `json:"updated"`
	External  bool   `json:"external"`  // de otro: Miguel lo pegó para validarlo
	Task      *Task  `json:"task"`      // la tarea del tablero que declara su rama
	LastRunID string `json:"lastRunId"` // la última validación
}

// Key: cómo se nombra un PR en las validaciones («owner/name#123»).
func (p PR) Key() string { return fmt.Sprintf("%s#%d", p.Slug, p.Number) }

// RepoBlock: un repo con sus PRs (un bloque del sidebar).
type RepoBlock struct {
	Slug  string `json:"slug"`
	Name  string `json:"name"`
	Clone string `json:"clone"` // su clon local ("" si no hay: no se puede validar)
	PRs   []PR   `json:"prs"`
}

// MainRepos: los que siempre tienen su bloque, aunque no haya PRs abiertos.
var MainRepos = []string{"Creditop-SAS/legacy-backend", "Creditop-SAS/frontend-monorepo", "Creditop-SAS/legacy-application"}

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

func gh(ctx context.Context, args ...string) ([]byte, error) {
	out, err := exec.CommandContext(ctx, "gh", args...).Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return nil, fmt.Errorf("gh %s: %s", strings.Join(args[:min(2, len(args))], " "), strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, err
	}
	return out, nil
}

// reRemote: owner/name de un remoto de GitHub, también con los alias de ~/.ssh/config («git@github.com-mig:owner/name»).
var reRemote = regexp.MustCompile(`github\.com[^:/]*[:/]([^/]+/[^/]+?)(?:\.git)?/?$`)

func slugOfURL(url string) string {
	if m := reRemote.FindStringSubmatch(strings.TrimSpace(url)); m != nil {
		return m[1]
	}
	return ""
}

var (
	clonesMu sync.Mutex
	clones   map[string]string // owner/name → su clon
)

// CloneOf: el clon local de un repo de GitHub. Si hay varios (legacy-backend y legacy-backend-finandina), el que se
// llama como el repo.
func CloneOf(ctx context.Context, slug string) string {
	clonesMu.Lock()
	defer clonesMu.Unlock()
	if clones == nil {
		clones = map[string]string{}
		dirs, _ := os.ReadDir(ReposDir())
		for _, d := range dirs {
			dir := filepath.Join(ReposDir(), d.Name())
			if _, err := os.Stat(filepath.Join(dir, ".git")); err != nil {
				continue
			}
			url, err := git(ctx, dir, "remote", "get-url", "origin")
			s := slugOfURL(url)
			if err != nil || s == "" {
				continue
			}
			if cur, ok := clones[s]; !ok || (path.Base(s) == d.Name() && path.Base(s) != filepath.Base(cur)) {
				clones[s] = dir
			}
		}
	}
	return clones[slug]
}

// ── LOS EXTERNOS: los PRs de otros que Miguel pegó (goldfish/.external.json, fuera de git) ──

type externalPR struct {
	Slug   string `json:"slug"`
	Number int    `json:"number"`
	Added  string `json:"added"`
}

var extMu sync.Mutex

func externalFile(myTools string) string {
	return filepath.Join(myTools, "goldfish", ".external.json")
}

func readExternal(myTools string) []externalPR {
	var out []externalPR
	if raw, err := os.ReadFile(externalFile(myTools)); err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func writeExternal(myTools string, list []externalPR) error {
	raw, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(externalFile(myTools), raw, 0o644)
}

// RemoveExternal: lo saca de la lista (sus validaciones quedan).
func RemoveExternal(myTools, slug string, number int) error {
	extMu.Lock()
	defer extMu.Unlock()
	var keep []externalPR
	for _, e := range readExternal(myTools) {
		if e.Slug != slug || e.Number != number {
			keep = append(keep, e)
		}
	}
	return writeExternal(myTools, keep)
}

// ── un PR por su URL ──

var rePRURL = regexp.MustCompile(`github\.com/([^/\s]+/[^/\s]+)/pull/(\d+)`)

// ParsePRURL: owner/name y número de «https://github.com/owner/name/pull/123[/files…]».
func ParsePRURL(url string) (string, int, error) {
	m := rePRURL.FindStringSubmatch(url)
	if m == nil {
		return "", 0, errors.New("eso no parece la URL de un PR de GitHub (…github.com/<dueño>/<repo>/pull/<número>)")
	}
	n, _ := strconv.Atoi(m[2])
	return m[1], n, nil
}

var (
	meOnce  sync.Once
	meLogin string
)

// Me: el usuario de GitHub de Miguel (el de gh).
func Me(ctx context.Context) string {
	meOnce.Do(func() {
		if out, err := gh(ctx, "api", "user", "--jq", ".login"); err == nil {
			meLogin = strings.TrimSpace(string(out))
		}
	})
	return meLogin
}

// View: un PR, leído de GitHub.
func View(ctx context.Context, myTools, slug string, number int) (PR, error) {
	out, err := gh(ctx, "pr", "view", strconv.Itoa(number), "-R", slug, "--json",
		"number,url,title,state,author,headRefName,baseRefName,isDraft,updatedAt")
	if err != nil {
		return PR{}, err
	}
	var v struct {
		Number  int                    `json:"number"`
		URL     string                 `json:"url"`
		Title   string                 `json:"title"`
		State   string                 `json:"state"`
		Author  struct{ Login string } `json:"author"`
		Head    string                 `json:"headRefName"`
		Base    string                 `json:"baseRefName"`
		Draft   bool                   `json:"isDraft"`
		Updated string                 `json:"updatedAt"`
	}
	if err := json.Unmarshal(out, &v); err != nil {
		return PR{}, err
	}
	p := PR{Slug: slug, Number: v.Number, URL: v.URL, Title: v.Title, State: v.State, Author: v.Author.Login,
		Head: v.Head, Base: v.Base, Draft: v.Draft, Updated: v.Updated}
	p.External = p.Author != "" && p.Author != Me(ctx)
	if clone := CloneOf(ctx, slug); clone != "" {
		p.Task = LoadTasks(myTools).ForBranch(filepath.Base(clone), p.Head)
	}
	return p, nil
}

// AddByURL: un PR pegado. Si es de otro, queda en la lista como externo (mientras siga abierto).
func AddByURL(ctx context.Context, myTools, url string) (PR, error) {
	slug, number, err := ParsePRURL(url)
	if err != nil {
		return PR{}, err
	}
	p, err := View(ctx, myTools, slug, number)
	if err != nil {
		return PR{}, err
	}
	if p.External {
		extMu.Lock()
		list := readExternal(myTools)
		found := false
		for _, e := range list {
			found = found || (e.Slug == slug && e.Number == number)
		}
		if !found {
			list = append(list, externalPR{Slug: slug, Number: number, Added: time.Now().Format(time.RFC3339)})
			err = writeExternal(myTools, list)
		}
		extMu.Unlock()
		if err != nil {
			return p, err
		}
	}
	invalidate()
	return p, nil
}

// ── la lista ──

var (
	cacheMu  sync.Mutex
	cached   []RepoBlock
	cachedAt time.Time
)

// CacheTTL: la lista se pide a GitHub a lo sumo cada tanto.
const CacheTTL = 3 * time.Minute

func invalidate() { cacheMu.Lock(); cached = nil; cacheMu.Unlock() }

// Blocks: los repos con los PRs abiertos de Miguel y los externos que pegó. Los repos principales siempre van, primero.
func Blocks(ctx context.Context, myTools string, refresh bool) ([]RepoBlock, error) {
	cacheMu.Lock()
	if !refresh && cached != nil && time.Since(cachedAt) < CacheTTL {
		out := cloneBlocks(cached)
		cacheMu.Unlock()
		return withLastRuns(myTools, out), nil
	}
	cacheMu.Unlock()
	// los míos: una sola búsqueda en todo GitHub
	out, err := gh(ctx, "search", "prs", "--author=@me", "--state=open", "--limit", "100",
		"--json", "repository,number,title,url,updatedAt,isDraft")
	if err != nil {
		return nil, err
	}
	var found []struct {
		Repository struct {
			NameWithOwner string `json:"nameWithOwner"`
		} `json:"repository"`
		Number  int    `json:"number"`
		Title   string `json:"title"`
		URL     string `json:"url"`
		Updated string `json:"updatedAt"`
		Draft   bool   `json:"isDraft"`
	}
	if err := json.Unmarshal(out, &found); err != nil {
		return nil, err
	}
	me := Me(ctx)
	var prs []PR
	for _, f := range found {
		prs = append(prs, PR{Slug: f.Repository.NameWithOwner, Number: f.Number, URL: f.URL, Title: f.Title,
			State: "OPEN", Author: me, Updated: f.Updated, Draft: f.Draft})
	}
	// la rama de cada uno (para la tarea): una consulta por repo, sólo de los que tienen clon
	heads := map[string]map[int][2]string{}
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, slug := range uniqueSlugs(prs) {
		if CloneOf(ctx, slug) == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, err := gh(ctx, "pr", "list", "-R", slug, "--author", "@me", "--state", "open", "--limit", "100",
				"--json", "number,headRefName,baseRefName")
			if err != nil {
				return
			}
			var list []struct {
				Number int    `json:"number"`
				Head   string `json:"headRefName"`
				Base   string `json:"baseRefName"`
			}
			if json.Unmarshal(raw, &list) != nil {
				return
			}
			m := map[int][2]string{}
			for _, x := range list {
				m[x.Number] = [2]string{x.Head, x.Base}
			}
			mu.Lock()
			heads[slug] = m
			mu.Unlock()
		}()
	}
	// los externos: cada uno por su lado; el que ya no está abierto sale de la lista
	extMu.Lock()
	ext := readExternal(myTools)
	extMu.Unlock()
	extPRs := make([]*PR, len(ext))
	for i, e := range ext {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if p, err := View(ctx, myTools, e.Slug, e.Number); err == nil {
				extPRs[i] = &p
			}
		}()
	}
	wg.Wait()
	tasks := LoadTasks(myTools)
	for i := range prs {
		if h, ok := heads[prs[i].Slug][prs[i].Number]; ok {
			prs[i].Head, prs[i].Base = h[0], h[1]
			if clone := CloneOf(ctx, prs[i].Slug); clone != "" {
				prs[i].Task = tasks.ForBranch(filepath.Base(clone), prs[i].Head)
			}
		}
	}
	var gone []externalPR
	for i, p := range extPRs {
		switch {
		case p == nil: // GitHub no contestó: se queda en la lista, sin datos nuevos
		case p.State == "OPEN":
			p.External = true
			prs = append(prs, *p)
		default:
			gone = append(gone, ext[i])
		}
	}
	for _, g := range gone {
		_ = RemoveExternal(myTools, g.Slug, g.Number)
	}
	blocks := group(ctx, prs)
	cacheMu.Lock()
	cached, cachedAt = blocks, time.Now()
	cacheMu.Unlock()
	return withLastRuns(myTools, cloneBlocks(blocks)), nil
}

func uniqueSlugs(prs []PR) []string {
	seen := map[string]bool{}
	var out []string
	for _, p := range prs {
		if !seen[p.Slug] {
			seen[p.Slug] = true
			out = append(out, p.Slug)
		}
	}
	return out
}

// group: un bloque por repo; primero los principales (aunque estén vacíos), después el resto por nombre. Dentro, los
// PRs del más reciente al más viejo.
func group(ctx context.Context, prs []PR) []RepoBlock {
	by := map[string][]PR{}
	for _, p := range prs {
		by[p.Slug] = append(by[p.Slug], p)
	}
	var out []RepoBlock
	add := func(slug string) {
		ps := by[slug]
		sort.Slice(ps, func(i, j int) bool { return ps[i].Updated > ps[j].Updated })
		out = append(out, RepoBlock{Slug: slug, Name: path.Base(slug), Clone: CloneOf(ctx, slug), PRs: ps})
		delete(by, slug)
	}
	for _, s := range MainRepos {
		add(s)
	}
	var rest []string
	for s := range by {
		rest = append(rest, s)
	}
	sort.Strings(rest)
	for _, s := range rest {
		add(s)
	}
	return out
}

func cloneBlocks(bs []RepoBlock) []RepoBlock {
	out := make([]RepoBlock, len(bs))
	for i, b := range bs {
		b.PRs = append([]PR(nil), b.PRs...)
		out[i] = b
	}
	return out
}
