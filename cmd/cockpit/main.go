// cockpit maneja Cockpit (cockpit/, la app de escritorio de my-tools) por consola, para que Claude navegue las
// herramientas y cuente lo que hace mientras Miguel lo ve en vivo en el panel «Claude». Lo llama `bin/cockpit`.
//
//	bin/cockpit status [--json]          qué apps hay, cuáles están arriba y cuál está al frente
//	bin/cockpit open <app> [ruta]        trae una app al frente, en una ruta (#/… o /…)
//	bin/cockpit restart <app> [--wait]   reinicia una app (su servidor Go no se recarga solo) y Cockpit la recarga;
//	                                     con --wait vuelve recién cuando la app contesta de nuevo
//	bin/cockpit logs <app> [--lines 40] [--errors]   lo último que escribió una app (su servidor y su Vite)
//	bin/cockpit say <texto…>             cuenta en el panel qué vas a hacer o qué encontraste
//	bin/cockpit apps                     los ids de las apps
//
// Cada herramienta que usa Claude ya llega sola al panel (el hook `cockpit` de Claude Code): `say` es para lo que
// los comandos no dicen — la intención, una conclusión, una pregunta.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"creditop/my-tools/lib/cockpit"
)

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Println(strings.TrimSpace(`
bin/cockpit — manejar Cockpit por consola (y que se vea en su panel «Claude»)

  bin/cockpit status [--json]       qué apps hay, cuáles están arriba y cuál está al frente
  bin/cockpit open <app> [ruta]     trae una app al frente, en una ruta: #/tareas/core-543 · /local/motai/asesor
  bin/cockpit restart <app> [--wait]  la reinicia para que tome un cambio en su servidor; Cockpit la recarga sola.
                                    --wait: vuelve cuando contesta de nuevo (hasta 90 s; sale 1 si no levantó)
  bin/cockpit logs <app> [--lines 40] [--errors]   lo último que escribió una app; --errors, sólo lo que huele a falla
  bin/cockpit say <texto…>          cuenta en el panel qué vas a hacer o qué encontraste
  bin/cockpit apps                  los ids de las apps

Cada herramienta que usa Claude llega sola al panel (hook «cockpit»); say es para la intención y las conclusiones.`))
		return 0
	}
	// logs no pasa por Cockpit: lee el archivo, así sirve también con Cockpit cerrado o con la app caída.
	if args[0] == "logs" {
		return logs(args[1:])
	}
	ctl, err := cockpit.Load(os.Getenv("HOME"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "cockpit:", err)
		return 1
	}
	session := os.Getenv("COCKPIT_SESSION")
	const wait = 5 * time.Second
	switch args[0] {
	case "status", "apps":
		var st cockpit.Status
		if err := ctl.Do("GET", "/status", nil, &st, wait); err != nil {
			fmt.Fprintln(os.Stderr, "cockpit:", err)
			return 1
		}
		if len(args) > 1 && args[1] == "--json" {
			_ = json.NewEncoder(os.Stdout).Encode(st)
			return 0
		}
		for _, a := range st.Apps {
			if args[0] == "apps" {
				fmt.Println(a.ID)
				continue
			}
			mark, state := " ", "apagada"
			if a.ID == st.Current {
				mark = "▸"
			}
			if a.Ready {
				state = "arriba"
			}
			fmt.Printf("%s %-10s %-10s %s\n", mark, a.ID, a.Name, state)
		}
		return 0
	case "open":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "uso: bin/cockpit open <app> [ruta]")
			return 2
		}
		route := ""
		if len(args) > 2 {
			route = args[2]
		}
		if err := ctl.Do("POST", "/open", map[string]string{"app": args[1], "route": route, "session": session}, nil, wait); err != nil {
			fmt.Fprintln(os.Stderr, "cockpit:", err)
			return 1
		}
		fmt.Printf("Cockpit: %s %s\n", args[1], route)
		return 0
	case "restart":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "uso: bin/cockpit restart <app>")
			return 2
		}
		var out struct {
			Text string `json:"text"`
		}
		// Espera a que suelte el puerto (hasta 10 s) antes de volver a levantarla.
		if err := ctl.Do("POST", "/restart", map[string]string{"app": args[1]}, &out, 20*time.Second); err != nil {
			fmt.Fprintln(os.Stderr, "cockpit:", err)
			return 1
		}
		fmt.Println("Cockpit:", out.Text)
		// --wait: `restart` vuelve cuando la app SOLTÓ el puerto, no cuando levantó de nuevo; el comando que sigue le
		// pegaba a un servidor que todavía no estaba (2026-11-17: quince reinicios de Wally con un bucle de curl a mano).
		if len(args) > 2 && args[2] == "--wait" {
			start := time.Now()
			for time.Since(start) < 90*time.Second {
				time.Sleep(500 * time.Millisecond)
				var st cockpit.Status
				if err := ctl.Do("GET", "/status", nil, &st, wait); err != nil {
					continue
				}
				for _, a := range st.Apps {
					if a.ID == args[1] && a.Ready {
						fmt.Printf("Cockpit: %s contesta de nuevo (%.1f s)\n", a.Name, time.Since(start).Seconds())
						return 0
					}
				}
			}
			fmt.Fprintf(os.Stderr, "cockpit: %s no levantó en 90 s (su log: ~/Library/Logs/cockpit-%s.log)\n", args[1], args[1])
			return 1
		}
		return 0
	case "say":
		text := strings.TrimSpace(strings.Join(args[1:], " "))
		if text == "" {
			fmt.Fprintln(os.Stderr, "uso: bin/cockpit say <texto…>")
			return 2
		}
		if err := ctl.Do("POST", "/say", map[string]string{"text": text, "session": session}, nil, wait); err != nil {
			fmt.Fprintln(os.Stderr, "cockpit:", err)
			return 1
		}
		return 0
	}
	fmt.Fprintf(os.Stderr, "cockpit: no conozco %q (bin/cockpit help)\n", args[0])
	return 2
}

// logFiles: dónde escribe cada app. Las que levanta Cockpit, en cockpit-<id>.log; las de fondo tienen el suyo.
var logFiles = map[string][]string{
	"chat":     {"creditop-my-tools-chat.log", "cockpit-chat.log"},
	"sentinel": {"cockpit-sentinel.log", "sentinel.log"},
	"correo":   {"cockpit-correo.log", "correo.log"},
}

var errorLine = regexp.MustCompile(`(?i)error|panic|fatal|failed|no pude|no contest|refused|timeout|exception|✗`)

// logs muestra lo último del registro de una app: `bin/cockpit logs <app> [--lines N] [--errors]`.
func logs(args []string) int {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") {
		fmt.Fprintln(os.Stderr, "uso: bin/cockpit logs <app> [--lines 40] [--errors]")
		return 2
	}
	app, lines, onlyErrors := args[0], 40, false
	for i := 1; i < len(args); i++ {
		switch args[i] {
		case "--errors":
			onlyErrors = true
		case "--lines":
			if i+1 < len(args) {
				if n, err := strconv.Atoi(args[i+1]); err == nil && n > 0 {
					lines = n
				}
				i++
			}
		}
	}
	dir := filepath.Join(os.Getenv("HOME"), "Library", "Logs")
	names := logFiles[app]
	if names == nil {
		names = []string{"cockpit-" + app + ".log"}
	}
	// De los que existan, el que se escribió último.
	path, newest := "", time.Time{}
	for _, n := range names {
		if st, err := os.Stat(filepath.Join(dir, n)); err == nil && st.ModTime().After(newest) {
			path, newest = filepath.Join(dir, n), st.ModTime()
		}
	}
	if path == "" {
		fmt.Fprintf(os.Stderr, "cockpit: no hay registro de %q en %s (¿se abrió alguna vez? bin/cockpit apps da los ids)\n", app, dir)
		return 1
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cockpit:", err)
		return 1
	}
	// Los archivos son de megas como mucho; alcanza con mirar el final.
	if len(raw) > 2<<20 {
		raw = raw[len(raw)-2<<20:]
	}
	var keep []string
	for _, l := range strings.Split(strings.TrimRight(string(raw), "\n"), "\n") {
		if !onlyErrors || errorLine.MatchString(l) {
			keep = append(keep, l)
		}
	}
	if len(keep) > lines {
		keep = keep[len(keep)-lines:]
	}
	fmt.Printf("%s · escrito por última vez %s%s\n", path, newest.Format("15:04:05"), map[bool]string{true: " · sólo lo que huele a falla", false: ""}[onlyErrors])
	if len(keep) == 0 {
		fmt.Println("  (nada)")
		return 0
	}
	fmt.Println(strings.Join(keep, "\n"))
	return 0
}
