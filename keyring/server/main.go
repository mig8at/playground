// Command keyring es la consola de keyring/check: la tabla entera de a qué hay acceso ahora y cuándo
// vence. Sale 1 si alguna fila falló, para que lo pueda usar un script antes de arrancar.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"creditop/playground/keyring/check"
)

func main() {
	asJSON := flag.Bool("json", false, "las filas en JSON")
	only := flag.String("only", "", "sólo estos grupos, separados por coma: "+strings.Join(check.Groups, ","))
	brief := flag.Bool("brief", false, "el resumen del arranque de sesión: sólo red, AWS y sesiones")
	timeout := flag.Duration("timeout", 12*time.Second, "tope por sonda")
	flag.Parse()

	var groups []string
	if *only != "" {
		groups = strings.Split(*only, ",")
	}
	if *brief {
		groups, *timeout = check.Quick, 4*time.Second
	}
	checks := check.Run(check.Select(groups), *timeout)
	switch {
	case *asJSON:
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(checks)
	case *brief:
		fmt.Println(check.Brief(checks))
	default:
		render(checks)
	}
	for _, c := range checks {
		if c.State == check.Fail {
			os.Exit(1)
		}
	}
}

func render(checks []check.Check) {
	fmt.Printf("\n  KEYRING · %s\n", time.Now().Format("2006-01-02 15:04"))
	counts := map[check.State]int{}
	for _, c := range checks {
		counts[c.State]++
	}
	fmt.Printf("  %d ok · %d por vencer · %d fallan · %d no aplican\n",
		counts[check.OK], counts[check.Warn], counts[check.Fail], counts[check.Off])
	group := ""
	for _, c := range checks {
		if c.Group != group {
			group = c.Group
			fmt.Printf("\n  %s\n", strings.ToUpper(check.GroupLabel[group]))
		}
		line := fmt.Sprintf("    %s %-20s %s", check.Mark(c.State), c.Name, c.Detail)
		if c.Expires != nil {
			line += " · " + check.UntilText(*c.Expires)
		}
		fmt.Println(line)
	}
	fmt.Println()
}
