// cockpit maneja Cockpit (cockpit/, la app de escritorio del playground) por consola, para que Claude navegue las
// herramientas y cuente lo que hace mientras Miguel lo ve en vivo en el panel «Claude». Lo llama `bin/cockpit`.
//
//	bin/cockpit status [--json]          qué apps hay, cuáles están arriba y cuál está al frente
//	bin/cockpit open <app> [ruta]        trae una app al frente, en una ruta (#/… o /…)
//	bin/cockpit restart <app>            reinicia una app (su servidor Go no se recarga solo) y Cockpit la recarga
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
	"strings"
	"time"

	"creditop/playground/lib/cockpit"
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
  bin/cockpit restart <app>         la reinicia para que tome un cambio en su servidor; Cockpit la recarga sola
  bin/cockpit say <texto…>          cuenta en el panel qué vas a hacer o qué encontraste
  bin/cockpit apps                  los ids de las apps

Cada herramienta que usa Claude llega sola al panel (hook «cockpit»); say es para la intención y las conclusiones.`))
		return 0
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
