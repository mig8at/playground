package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"creditop/playground/tablero/server/internal/pulse"
	"creditop/playground/tablero/server/internal/store"
)

// EL CIERRE EN UN PASO. `make cierre` decía QUÉ faltaba —el bloque, la bitácora— y dejaba al agente
// reconstruir el resto: desde qué hora medir, qué commits entran, cómo se escribe cada comando. Medido el
// 2026-10-20: cerrar una tarea llevaba unas quince llamadas. Con `-tarea N` el cierre arma la propuesta: el
// lapso desde donde terminó la última entrada de bitácora del día, los commits de la tarea en ese lapso y
// los dos comandos para escribirlo. No escribe nada: el título del bloque es una conclusión, y ésa la pone
// quien trabajó.

// Proposal es lo que el cierre propone para una tarea.
type Proposal struct {
	ID         int           `json:"id"`
	Slug       string        `json:"slug"`
	Since      string        `json:"since"`      // HH:MM: dónde empieza el tramo sin bitácora
	SinceFrom  string        `json:"sinceFrom"`  // de dónde salió esa hora
	Until      string        `json:"until"`      // HH:MM: ahora
	PulseSlots int           `json:"pulseSlots"` // tramos de 5′ con cambios en el pulso dentro del lapso
	Commits    []repoCommits `json:"commits"`
	BlockTitle string        `json:"blockTitle"`
	BlockBody  string        `json:"blockBody"`
	BlockCmd   string        `json:"blockCmd"`
	WorklogCmd string        `json:"worklogCmd"`
	Notes      []string      `json:"notes,omitempty"`
}

type timedEntry struct {
	Day       string `json:"day"`
	Minutes   int    `json:"minutes"`
	StartedAt string `json:"startedAt"`
}

// lastWorklogEnd es dónde terminó la última entrada de bitácora de hoy, de CUALQUIER tarea: el tiempo
// anterior ya está contado, y contarlo dos veces infla lo que sube a Jira.
func lastWorklogEnd(data string, now time.Time) (time.Time, bool) {
	f, err := os.Open(filepath.Join(data, "entries", now.Format("2006-01")+".jsonl"))
	if err != nil {
		return time.Time{}, false
	}
	defer f.Close()
	day := now.Format("2006-01-02")
	var last time.Time
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var e timedEntry
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.Day != day {
			continue
		}
		start, err := time.Parse(time.RFC3339, e.StartedAt)
		if err != nil {
			continue
		}
		if end := start.Add(time.Duration(e.Minutes) * time.Minute); end.After(last) && !end.After(now) {
			last = end
		}
	}
	return last, !last.IsZero()
}

// pulseSince devuelve el primer cambio del pulso desde `since` y cuántos tramos de 5′ tuvieron cambios.
func pulseSince(data string, since time.Time) (first time.Time, slots int) {
	ticks, err := pulse.Read(data, 1)
	if err != nil {
		return time.Time{}, 0
	}
	seen := map[int64]bool{}
	for _, tk := range ticks {
		for _, sg := range tk.Signals {
			at, err := time.Parse(time.RFC3339, sg.At)
			if err != nil || at.Before(since) {
				continue
			}
			seen[at.Unix()/300] = true
			if first.IsZero() || at.Before(first) {
				first = at
			}
		}
	}
	return first, len(seen)
}

func gitOut(dir string, args ...string) string {
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// repoCommits son los commits de la tarea en un repo, con el comando que los vuelve a listar.
type repoCommits struct {
	Repo  string   `json:"repo"`
	Cmd   string   `json:"cmd"`
	Lines []string `json:"commits"` // "abc1234 asunto"
}

// taskCommits: los commits desde `since` que son de la tarea. En el playground, por el asunto —las
// sesiones comparten el worktree, así que «todo lo de hoy» traería trabajo de otras tareas—: el que
// empieza con el slug (`tablero: …`) o nombra la tarea (`tarea 84`). En los repos, los de las ramas que
// declara `ramas:`.
func taskCommits(playground, reposDir string, t task, since time.Time) []repoCommits {
	stamp := since.Format("2006-01-02 15:04")
	out := []repoCommits{}
	own := regexp.MustCompile(`^(?:` + regexp.QuoteMeta(t.Slug) + `:|.*\btarea (?:` + strconv.Itoa(t.ID) + `|` + regexp.QuoteMeta(t.Slug) + `)\b)`)
	pg := repoCommits{Repo: "playground", Cmd: "git log --since=\"" + stamp + "\" --oneline main"}
	for _, l := range strings.Split(gitOut(playground, "log", "--since="+stamp, "--format=%h %s", "main"), "\n") {
		if _, subject, ok := strings.Cut(l, " "); ok && own.MatchString(subject) {
			pg.Lines = append(pg.Lines, l)
		}
	}
	if len(pg.Lines) > 0 {
		out = append(out, pg)
	}
	if len(t.Branches) == 0 {
		return out
	}
	seen := map[string]bool{}
	dirs, _ := os.ReadDir(reposDir)
	for _, d := range dirs {
		dir := filepath.Join(reposDir, d.Name())
		if !d.IsDir() || gitOut(dir, "rev-parse", "--git-dir") == "" {
			continue
		}
		repo := store.RepoName(dir)
		var refs []string
		for _, b := range strings.Split(gitOut(dir, "for-each-ref", "refs/heads", "--format=%(refname:short)"), "\n") {
			for _, p := range t.Branches {
				if bp := store.ParseBranchPattern(p); b != "" && bp.AppliesTo(repo) && strings.Contains(b, bp.Fragment) {
					refs = append(refs, b)
					break
				}
			}
		}
		if len(refs) == 0 {
			continue
		}
		rc := repoCommits{Repo: repo, Cmd: "git -C " + repo + " log --since=\"" + stamp + "\" --oneline " + strings.Join(refs, " ")}
		// Lo que ya está en una rama base no es trabajo de la rama: sin esto, el log de una rama recién
		// cortada trae los commits de main del día.
		args := append([]string{"log", "--since=" + stamp, "--format=%h %s"}, refs...)
		var bases []string
		for _, b := range []string{"main", "master", "develop", "qa", "staging"} {
			for _, ref := range []string{"refs/heads/" + b, "refs/remotes/origin/" + b} {
				if gitOut(dir, "rev-parse", "--verify", "-q", ref) != "" {
					bases = append(bases, ref)
				}
			}
		}
		if len(bases) > 0 {
			args = append(append(args, "--not"), bases...)
			rc.Cmd += " --not " + strings.Join(bases, " ")
		}
		for _, l := range strings.Split(gitOut(dir, args...), "\n") {
			// Un worktree y su repo original ven las mismas ramas: cada commit entra una vez.
			if sha, _, _ := strings.Cut(l, " "); l != "" && !seen[repo+sha] {
				seen[repo+sha] = true
				rc.Lines = append(rc.Lines, l)
			}
		}
		if len(rc.Lines) > 0 {
			out = append(out, rc)
		}
	}
	return out
}

// shellQuote encierra en comillas simples para zsh y bash.
func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func propose(data string, t task, now time.Time, playground, reposDir string) (Proposal, error) {
	p := Proposal{ID: t.ID, Slug: t.Slug, Until: now.Format("15:04")}
	midnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	since, ok := lastWorklogEnd(data, now)
	p.SinceFrom = "el final de la última entrada de bitácora de hoy"
	if !ok {
		first, _ := pulseSince(data, midnight)
		if first.IsZero() {
			return p, fmt.Errorf("no hay bitácora ni pulso de hoy: no hay de dónde medir. Usá `make bitacora-add TAREA=%d LAPSO=HH:MM-HH:MM` con la hora de `date`", t.ID)
		}
		since = first.Truncate(5 * time.Minute)
		p.SinceFrom = "el primer cambio del pulso de hoy"
	}
	p.Since = since.Format("15:04")
	_, p.PulseSlots = pulseSince(data, since)
	p.Commits = taskCommits(playground, reposDir, t, since)
	if len(p.Commits) == 0 {
		p.Notes = append(p.Notes, "no hay commits de la tarea en el lapso: si el trabajo fue correr o leer, el bloque nombra el comando y lo que dio")
	}
	if now.Sub(since) > 3*time.Hour {
		p.Notes = append(p.Notes, fmt.Sprintf("el lapso es de %s: si hubo una pausa en el medio, partilo o usá -pulso", hm(int(now.Sub(since).Minutes()))))
	}

	// El título queda para quien trabajó: es la conclusión, y un asunto de commit dice la actividad.
	p.BlockTitle = "<la conclusión, en una línea>"
	var body strings.Builder
	body.WriteString("<lo que la sostiene: qué se cambió y por qué>\n\n")
	for _, rc := range p.Commits {
		fmt.Fprintf(&body, "```sh\n%s\n```\nResultado: %d commits de la tarea en %s.\n", rc.Cmd, len(rc.Lines), rc.Repo)
		for _, l := range rc.Lines {
			body.WriteString("- " + l + "\n")
		}
		body.WriteString("\n")
	}
	p.BlockBody = strings.TrimSpace(body.String())
	p.BlockCmd = fmt.Sprintf("bin/pg tarea bloque --tarea %d --seco --titulo %s --cuerpo %s", t.ID, shellQuote(p.BlockTitle), shellQuote(p.BlockBody))
	p.WorklogCmd = fmt.Sprintf("bin/pg bitacora add --tarea %d --lapso %s-%s --titulo %s --nota %s", t.ID, p.Since, p.Until,
		shellQuote("<qué se hizo, corto>"), shellQuote("<acción realizada> → <resultado> → <cómo se validó>"))
	return p, nil
}

func printProposal(p Proposal) {
	fmt.Printf("\n  #%d %s · de %s a %s (%s; el pulso vio %d tramos de 5′)\n", p.ID, p.Slug, p.Since, p.Until, p.SinceFrom, p.PulseSlots)
	if len(p.Commits) > 0 {
		fmt.Println("\n  commits de la tarea en el lapso:")
		for _, rc := range p.Commits {
			for _, l := range rc.Lines {
				fmt.Println("    " + rc.Repo + " " + l)
			}
		}
	}
	for _, n := range p.Notes {
		fmt.Println("\n  ▲ " + n)
	}
	fmt.Println("\n  1 · el bloque (completá título y prosa, sacá --seco para escribirlo):\n\n    " + p.BlockCmd)
	fmt.Println("\n  2 · la bitácora (los minutos salen del lapso):\n\n    " + p.WorklogCmd)
	fmt.Println()
}
