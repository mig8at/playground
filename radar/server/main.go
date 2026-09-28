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
	"path/filepath"
	"strings"
	"time"

	"creditop/playground/radar/scan"
)

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

func main() {
	view := flag.String("view", "usage", "usage · friction · drift · session")
	days := flag.Int("days", 30, "el período, en días hacia atrás")
	sessionID := flag.String("session", "", "con -view session: el id (o su comienzo) de la sesión")
	asJSON := flag.Bool("json", false, "la salida en JSON")
	all := flag.Bool("all", false, "incluir las corridas automáticas (sin nadie escribiendo: claude -p, bancos de prueba)")
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1)")
	projects := flag.String("projects", filepath.Join(os.Getenv("HOME"), ".claude", "projects"), "dónde guarda Claude Code las transcripciones")
	flag.Parse()

	root, err := playgroundRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "radar:", err)
		os.Exit(2)
	}
	if *addr != "" {
		if err := serve(root, *projects, *addr); err != nil {
			fmt.Fprintln(os.Stderr, "radar:", err)
			os.Exit(1)
		}
		return
	}
	dirs := scan.TranscriptDirs(*projects, root)
	if len(dirs) == 0 {
		fmt.Fprintf(os.Stderr, "radar: no hay transcripciones de %s en %s\n", root, *projects)
		os.Exit(1)
	}
	sessions, read, err := scan.LoadSessions(dirs, scan.CachePath(root))
	if err != nil {
		fmt.Fprintln(os.Stderr, "radar:", err)
		os.Exit(1)
	}
	since := time.Now().AddDate(0, 0, -*days)
	sessions, skipped := scan.HumanOnly(sessions, *all)
	calls := scan.InPeriod(sessions, since)
	src, _ := os.ReadFile(filepath.Join(root, "Makefile"))
	mk := scan.ParseMakefile(string(src))

	var out any
	switch *view {
	case "usage":
		out = scan.UsageView(calls, mk)
	case "friction":
		out = scan.FrictionView(calls)
	case "drift":
		out = scan.DriftView(calls, mk, scan.GitHistory(root), scan.SkillNames(root))
	case "session":
		s, ok := scan.FindSession(sessions, *sessionID)
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
	fmt.Printf("radar · %s · últimos %d días · %d sesiones de este playground (%d leídas de nuevo)",
		*view, *days, scan.CountSince(sessions, since), read)
	if skipped > 0 {
		fmt.Printf(" · sin %d corridas automáticas (-all las suma)", skipped)
	}
	fmt.Print("\n\n")
	printView(os.Stdout, out)
}

func printCounts(w io.Writer, title string, rows []scan.Count, limit int) {
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
	case scan.Usage:
		printCounts(w, "targets de make", x.Make, 25)
		printCounts(w, "skills cargadas", x.Skills, 20)
		printCounts(w, "subagentes", x.Agents, 10)
		printCounts(w, "conectores (pg) y MCP", x.Other, 15)
	case scan.Friction:
		fmt.Fprintln(w, "⚠ un permiso APROBADO no deja marca en la transcripción: acá no aparece.")
		fmt.Fprintln(w)
		printCounts(w, "pidió aprobación y no la tuvo", x.Denied, 15)
		printCounts(w, "Miguel dijo que no", x.Rejected, 15)
		printCounts(w, "lo frenó un hook", x.Blocked, 15)
		printCounts(w, "terminó en error", x.Errors, 20)
	case scan.Drift:
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
	case scan.Session:
		fmt.Fprintf(w, "sesión %s · %s · %s · %d llamadas\n\n", x.ID, x.Entrypoint, x.Start.Local().Format("2006-01-02 15:04"), len(x.Calls))
		marks := map[string]string{scan.OutcomeOK: " ", scan.OutcomeDenied: "⊘", scan.OutcomeRejected: "✗", scan.OutcomeBlocked: "⛔", scan.OutcomeError: "!"}
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
