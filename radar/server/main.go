// radar: cómo se usan de verdad las herramientas del playground, leído de las transcripciones de Claude
// Code. Sólo lectura, sólo local y sin modelo: todo se deriva de las transcripciones, el Makefile (con sus
// alias), las skills y `git log`.
//
//	go run ./radar/server -view usage|friction|drift|session [-days 30] [-session <id>] [-json]
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	return string(out), err
}

// playgroundRoot: subiendo desde donde se corre, la carpeta que tiene el Makefile y `radar/`.
func playgroundRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "radar", "server")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "Makefile")); err == nil {
				return dir, nil
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no encontré la raíz del playground subiendo desde %s", dir)
		}
		dir = parent
	}
}

// indexVersion cambia cada vez que cambia CÓMO se clasifica una llamada: el índice guarda las llamadas ya
// clasificadas, y sin esto un arreglo del parser no se aplicaría a lo que ya estaba leído.
const indexVersion = 5

// cacheFile es el índice en disco.
type cacheFile struct {
	Version int                   `json:"version"`
	Entries map[string]cacheEntry `json:"entries"`
}

// cacheEntry: una transcripción ya leída, con la huella del archivo con que se leyó.
type cacheEntry struct {
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
	Session Session   `json:"session"`
}

// LoadSessions lee las transcripciones, reusando las que no cambiaron desde la última vez.
func LoadSessions(dirs []string, cachePath string) ([]Session, int, error) {
	var stored cacheFile
	if raw, err := os.ReadFile(cachePath); err == nil {
		_ = json.Unmarshal(raw, &stored)
	}
	cache := stored.Entries
	if stored.Version != indexVersion || cache == nil {
		cache = map[string]cacheEntry{}
	}
	fresh := map[string]cacheEntry{}
	read := 0
	var sessions []Session
	for _, dir := range dirs {
		files, _ := filepath.Glob(filepath.Join(dir, "*.jsonl"))
		for _, f := range files {
			info, err := os.Stat(f)
			if err != nil {
				continue
			}
			e, ok := cache[f]
			if !ok || e.Size != info.Size() || !e.ModTime.Equal(info.ModTime()) {
				s, err := ReadSession(f)
				if err != nil {
					continue
				}
				e = cacheEntry{Size: info.Size(), ModTime: info.ModTime(), Session: s}
				read++
			}
			fresh[f] = e
			sessions = append(sessions, e.Session)
		}
	}
	if raw, err := json.Marshal(cacheFile{Version: indexVersion, Entries: fresh}); err == nil {
		if os.MkdirAll(filepath.Dir(cachePath), 0o755) == nil {
			_ = os.WriteFile(cachePath, raw, 0o644)
		}
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].Start.Before(sessions[j].Start) })
	return sessions, read, nil
}

// skillNames: las skills del proyecto, por su carpeta.
func skillNames(root string) []string {
	entries, _ := os.ReadDir(filepath.Join(root, ".claude", "skills"))
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			out = append(out, e.Name())
		}
	}
	return out
}

func main() {
	view := flag.String("view", "usage", "usage · friction · drift · session")
	days := flag.Int("days", 30, "el período, en días hacia atrás")
	sessionID := flag.String("session", "", "con -view session: el id (o su comienzo) de la sesión")
	asJSON := flag.Bool("json", false, "la salida en JSON")
	projects := flag.String("projects", filepath.Join(os.Getenv("HOME"), ".claude", "projects"), "dónde guarda Claude Code las transcripciones")
	flag.Parse()

	root, err := playgroundRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "radar:", err)
		os.Exit(2)
	}
	dirs := TranscriptDirs(*projects, root)
	if len(dirs) == 0 {
		fmt.Fprintf(os.Stderr, "radar: no hay transcripciones de %s en %s\n", root, *projects)
		os.Exit(1)
	}
	sessions, read, err := LoadSessions(dirs, filepath.Join(root, "radar", ".cache", "sessions.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "radar:", err)
		os.Exit(1)
	}
	since := time.Now().AddDate(0, 0, -*days)
	calls := inPeriod(sessions, since)
	src, _ := os.ReadFile(filepath.Join(root, "Makefile"))
	mk := ParseMakefile(string(src))

	var out any
	switch *view {
	case "usage":
		out = UsageView(calls, mk)
	case "friction":
		out = FrictionView(calls)
	case "drift":
		out = DriftView(calls, mk, GitHistory(root), skillNames(root))
	case "session":
		s, ok := findSession(sessions, *sessionID)
		if !ok {
			fmt.Fprintf(os.Stderr, "radar: no encontré una sesión que empiece con %q (-session)\n", *sessionID)
			os.Exit(2)
		}
		out = s
	default:
		fmt.Fprintf(os.Stderr, "radar: -view %q no existe (usage · friction · drift · session)\n", *view)
		os.Exit(2)
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(out)
		return
	}
	fmt.Printf("radar · %s · últimos %d días · %d sesiones de este playground (%d leídas de nuevo)\n\n",
		*view, *days, countSince(sessions, since), read)
	printView(os.Stdout, out)
}

func countSince(sessions []Session, since time.Time) int {
	n := 0
	for _, s := range sessions {
		for _, c := range s.Calls {
			if !c.Time.Before(since) {
				n++
				break
			}
		}
	}
	return n
}

// findSession: la sesión cuyo id empieza con el prefijo; sin prefijo, la más reciente.
func findSession(sessions []Session, prefix string) (Session, bool) {
	for i := len(sessions) - 1; i >= 0; i-- {
		if prefix == "" || strings.HasPrefix(sessions[i].ID, prefix) {
			return sessions[i], true
		}
	}
	return Session{}, false
}

func printCounts(w io.Writer, title string, rows []Count, limit int) {
	fmt.Fprintf(w, "── %s\n", title)
	if len(rows) == 0 {
		fmt.Fprintln(w, "   (nada)")
	}
	for i, r := range rows {
		if i == limit {
			fmt.Fprintf(w, "   … y %d más (JSON=1 las trae todas)\n", len(rows)-limit)
			break
		}
		line := fmt.Sprintf("   %5d  %-34s %3d ses · %s", r.Calls, r.Key, r.Sessions, r.Last.Local().Format("2006-01-02"))
		if r.Note != "" {
			line += " · " + r.Note
		}
		fmt.Fprintln(w, line)
	}
	fmt.Fprintln(w)
}

func printView(w io.Writer, v any) {
	switch x := v.(type) {
	case Usage:
		printCounts(w, "targets de make", x.Make, 25)
		printCounts(w, "skills cargadas", x.Skills, 20)
		printCounts(w, "subagentes", x.Agents, 10)
		printCounts(w, "conectores (pg) y MCP", x.Other, 15)
	case Friction:
		fmt.Fprintln(w, "⚠ un permiso APROBADO no deja marca en la transcripción: acá no aparece.")
		fmt.Fprintln(w)
		printCounts(w, "pidió aprobación y no la tuvo", x.Denied, 15)
		printCounts(w, "Miguel dijo que no", x.Rejected, 15)
		printCounts(w, "lo frenó un hook", x.Blocked, 15)
		printCounts(w, "terminó en error", x.Errors, 20)
	case Drift:
		printCounts(w, "se siguieron invocando DESPUÉS de salir del Makefile", x.UsedAfterRemoval, 20)
		printCounts(w, "invocados sin haber existido nunca en el Makefile de la raíz", x.NeverExisted, 20)
		printCounts(w, "nombres viejos que se siguen usando", x.OldNames, 20)
		fmt.Fprintf(w, "── targets documentados sin ninguna llamada en el período: %d (una señal, no un veredicto;\n"+
			"   los que abre Miguel —tablero, panel, visor— no pasan por el agente)\n", len(x.UnusedTargets))
		for _, u := range x.UnusedTargets {
			fmt.Fprintf(w, "   %-30s existe desde %s\n", u.Target, u.Since.Local().Format("2006-01-02"))
		}
		fmt.Fprintln(w)
		fmt.Fprintf(w, "── skills que no se cargaron nunca en el período: %d\n   %s\n",
			len(x.UnusedSkills), strings.Join(x.UnusedSkills, " · "))
	case Session:
		fmt.Fprintf(w, "sesión %s · %s · %s · %d llamadas\n\n", x.ID, x.Entrypoint, x.Start.Local().Format("2006-01-02 15:04"), len(x.Calls))
		marks := map[string]string{OutcomeOK: " ", OutcomeDenied: "⊘", OutcomeRejected: "✗", OutcomeBlocked: "⛔", OutcomeError: "!"}
		for _, c := range x.Calls {
			what := strings.Join(c.Keys, " · ")
			if c.Command != "" {
				what = c.Command
			}
			line := fmt.Sprintf(" %s %s  %-6s %s", marks[c.Outcome], c.Time.Local().Format("15:04"), c.Tool, what)
			if c.Hook != "" {
				line += "   (hook " + c.Hook + ")"
			}
			fmt.Fprintln(w, line)
		}
	}
}
