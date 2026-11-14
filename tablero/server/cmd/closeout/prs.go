package main

// prs.go — ¿algún pendiente abierto pide algo de un PR que ya se mergeó o se cerró?
//
// Un documento de tarea se escribe antes del merge y nadie lo vuelve a abrir después. El 2026-11-06 una
// revisión de nueve tareas encontró que en cuatro el documento iba detrás de `main`: pedía «mergear
// legacy-backend#1492 y taguear» cuando el PR llevaba seis semanas en producción, o «revisar y mergear
// #345 y #1806» con los dos mergeados —y en ese caso lo que de verdad faltaba (correr la migración en la
// base compartida) quedaba tapado por el pendiente viejo. Cruzar los pendientes abiertos con el estado de
// sus PRs lo encuentra en segundos y sin modelo.
//
// Es ▲, no ✗: un pendiente puede nombrar un PR mergeado como contexto («#11 (mergeado) agrega…, falta que
// infra…») y seguir abierto con razón. El aviso dice dónde mirar; decidir si está viejo es de quien lo lee.
//
// Sólo reconoce PRs con su repo: `pr:<alias>#N`, `<repo>#N` y la URL de GitHub. Un `#1670` suelto no dice
// de qué repo es y se ignora.

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"creditop/my-tools/connectors/repos"
)

// prRef es un PR citado: `owner/repo` en GitHub y su número.
type prRef struct {
	Repo   string
	Number string
}

func (p prRef) String() string { return p.Repo + "#" + p.Number }

// StalePR: un pendiente abierto que cita un PR ya mergeado o cerrado.
type StalePR struct {
	Slug  string `json:"slug"`
	ID    int    `json:"id"`
	PR    string `json:"pr"`
	State string `json:"state"` // MERGED o CLOSED
	Date  string `json:"date"`  // cuándo se mergeó o se cerró (YYYY-MM-DD)
	Base  string `json:"base"`  // la rama a la que fue
	Item  string `json:"item"`  // el comienzo del pendiente
}

var (
	pendingBox  = regexp.MustCompile(`^- \[([ xX])\]`)
	prByAlias   = regexp.MustCompile(`pr:([\w-]+)#(\d+)`)
	prByURL     = regexp.MustCompile(`github\.com/([\w-]+/[\w.-]+)/pull/(\d+)`)
	prByRepoTag = regexp.MustCompile(`(?:^|[^\w/:.-])([a-z][\w-]*)#(\d+)`)
)

// openPendingItems devuelve los pendientes ABIERTOS de `## Pendientes`, cada uno con sus líneas de
// continuación unidas. Una casilla cerrada corta el pendiente anterior y no se devuelve.
func openPendingItems(body string) []string {
	var items []string
	var cur []string
	in := false
	flush := func() {
		if cur != nil {
			items = append(items, strings.Join(cur, " "))
		}
		cur = nil
	}
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "## ") {
			flush()
			in = strings.TrimSpace(line) == "## Pendientes"
			continue
		}
		if !in {
			continue
		}
		if m := pendingBox.FindStringSubmatch(line); m != nil {
			flush()
			if m[1] == " " {
				cur = []string{strings.TrimSpace(line)}
			}
			continue
		}
		if cur != nil && strings.HasPrefix(line, " ") && strings.TrimSpace(line) != "" {
			cur = append(cur, strings.TrimSpace(line))
			continue
		}
		flush()
	}
	flush()
	return items
}

// mergeAck: el pendiente ya dice que su PR entró («(mergeado)», «ya está en `main`»). Sigue abierto por
// otra cosa —infra, comprobarlo en prod— y avisarlo cada día enseñaría a ignorar el aviso.
var mergeAck = regexp.MustCompile("(?i)mergead[oa]s?\\b|ya está en `?(main|develop|qa|producción)`?")

func acknowledgesMerge(item string) bool { return mergeAck.MatchString(item) }

// prRefsIn encuentra los PRs con repo de un pendiente. `aliases` va de alias de my-tools a
// `owner/repo`; `names` del nombre del repo en GitHub a `owner/repo` (para `legacy-application#171`).
func prRefsIn(item string, aliases, names map[string]string) []prRef {
	seen := map[prRef]bool{}
	var out []prRef
	add := func(repo, n string) {
		r := prRef{repo, n}
		if repo != "" && !seen[r] {
			seen[r] = true
			out = append(out, r)
		}
	}
	for _, m := range prByAlias.FindAllStringSubmatch(item, -1) {
		add(aliases[m[1]], m[2])
	}
	for _, m := range prByURL.FindAllStringSubmatch(item, -1) {
		add(m[1], m[2])
	}
	for _, m := range prByRepoTag.FindAllStringSubmatch(item, -1) {
		repo := aliases[m[1]]
		if repo == "" {
			repo = names[m[1]]
		}
		add(repo, m[2])
	}
	return out
}

// repoNames arma los dos mapas de prRefsIn desde la lista única de repos (su remoto de GitHub).
func repoNames() (aliases, names map[string]string) {
	aliases, names = map[string]string{}, map[string]string{}
	web, err := repos.Find().Web()
	if err != nil {
		return
	}
	for alias, w := range web {
		slug := strings.TrimPrefix(w.Web, "https://github.com/")
		if slug == w.Web || slug == "" {
			continue
		}
		aliases[alias] = slug
		if i := strings.LastIndex(slug, "/"); i >= 0 {
			names[slug[i+1:]] = slug
		}
	}
	return
}

type prState struct {
	State   string `json:"state"`
	Merged  string `json:"mergedAt"`
	Closed  string `json:"closedAt"`
	BaseRef string `json:"baseRefName"`
}

// ghPRState pregunta a `gh` por un PR. Un error (sin red, sin permiso, repo de otro dueño) no es un PR viejo.
func ghPRState(ctx context.Context, r prRef) (prState, error) {
	out, err := exec.CommandContext(ctx, "gh", "pr", "view", r.Number, "-R", r.Repo,
		"--json", "state,mergedAt,closedAt,baseRefName").Output()
	if err != nil {
		return prState{}, err
	}
	var s prState
	return s, json.Unmarshal(out, &s)
}

// stalePRs cruza los pendientes abiertos de las tareas no archivadas con el estado de sus PRs. `lookup`
// es la parte de red, para poder probar el resto. Devuelve también cuántos PRs no se pudieron consultar.
func stalePRs(tasks []task, aliases, names map[string]string, lookup func(prRef) (prState, error)) ([]StalePR, int) {
	type hit struct {
		t    task
		item string
		ref  prRef
	}
	var hits []hit
	unique := map[prRef]bool{}
	for _, t := range tasks {
		if t.Archived {
			continue
		}
		for _, item := range openPendingItems(t.Body) {
			if acknowledgesMerge(item) {
				continue
			}
			for _, r := range prRefsIn(item, aliases, names) {
				hits = append(hits, hit{t, item, r})
				unique[r] = true
			}
		}
	}

	states := map[prRef]prState{}
	failed := 0
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	for r := range unique {
		wg.Add(1)
		go func(r prRef) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			s, err := lookup(r)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				failed++
				return
			}
			states[r] = s
		}(r)
	}
	wg.Wait()

	var out []StalePR
	for _, h := range hits {
		s, ok := states[h.ref]
		if !ok || (s.State != "MERGED" && s.State != "CLOSED") {
			continue
		}
		date := s.Merged
		if date == "" {
			date = s.Closed
		}
		if len(date) > 10 {
			date = date[:10]
		}
		item := h.item
		if r := []rune(item); len(r) > 110 {
			item = string(r[:110]) + "…"
		}
		out = append(out, StalePR{Slug: h.t.Slug, ID: h.t.ID, PR: h.ref.String(), State: s.State, Date: date, Base: s.BaseRef, Item: item})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, failed
}

// checkPRs es la versión con red: `gh`, con un tope de tiempo para todo el cruce.
func checkPRs(tasks []task) ([]StalePR, int) {
	aliases, names := repoNames()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	return stalePRs(tasks, aliases, names, func(r prRef) (prState, error) { return ghPRState(ctx, r) })
}

func printStalePRs(ps []StalePR) {
	if len(ps) == 0 {
		return
	}
	fmt.Println("  ▲ pendientes abiertos que citan un PR ya mergeado o cerrado (¿el pendiente quedó viejo?):")
	for _, p := range ps {
		state := "mergeado"
		if p.State == "CLOSED" {
			state = "cerrado sin merge"
		}
		fmt.Printf("    · #%d %s — %s %s el %s (→ %s)\n        %s\n", p.ID, p.Slug, p.PR, state, p.Date, p.Base, p.Item)
	}
	fmt.Println()
}
