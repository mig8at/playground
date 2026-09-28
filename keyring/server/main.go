// Command keyring es la consola de keyring/check: la tabla entera de a qué hay acceso ahora y cuándo
// vence. Sale 1 si alguna fila falló, para que lo pueda usar un script antes de arrancar.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"context"
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
	awsOnly := flag.Bool("aws", false, "sólo la matriz de AWS: qué servicios alcanza cada perfil")
	addr := flag.String("serve", "", "levanta la API para la interfaz en esta dirección (sólo 127.0.0.1)")
	flag.Parse()

	if *addr != "" {
		if err := serve(*addr, *timeout); err != nil {
			fmt.Fprintln(os.Stderr, "keyring:", err)
			os.Exit(1)
		}
		return
	}

	if *awsOnly {
		os.Exit(runAWS(*asJSON))
	}
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

// runAWS imprime la matriz de AWS: un renglón por servicio, una columna por perfil.
func runAWS(asJSON bool) int {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	accounts, hidden, err := check.AWSAccounts(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "keyring:", err)
		return 1
	}
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(map[string]any{"accounts": accounts, "hidden": hidden})
		return 0
	}
	fmt.Printf("\n  KEYRING · AWS · %s\n", time.Now().Format("2006-01-02 15:04"))
	fmt.Println("  lectura medida con una llamada List/Describe por servicio · la escritura, sin medir")
	fmt.Println()
	for _, a := range accounts {
		if a.Error != "" {
			fmt.Printf("  %-8s ✗ %s\n", a.Profile, a.Error)
			continue
		}
		fmt.Printf("  %-8s %s (%s) · permission set %s · %s · %s\n", a.Profile, a.Account, a.AccountLabel, a.PermissionSet, a.Person, a.Credentials)
	}
	const col = 10
	fmt.Printf("\n  %-24s", "")
	for _, a := range accounts {
		fmt.Printf("%-*s", col, a.Profile)
	}
	fmt.Println()
	for _, cat := range check.Categories {
		fmt.Printf("  %s\n", strings.ToUpper(cat))
		for i, svc := range check.AWSServiceList() {
			if svc.Category != cat {
				continue
			}
			fmt.Printf("    %-22s", svc.Label)
			for _, a := range accounts {
				mark := "·"
				if i < len(a.Services) {
					mark = readMark(a.Services[i].Read)
				}
				fmt.Printf("%-*s", col, mark)
			}
			fmt.Println()
		}
	}
	fmt.Println("\n  ✔ lectura · ✗ negada · ? no se pudo saber (no es de permisos) · · perfil sin identidad")
	if len(hidden) > 0 {
		fmt.Printf("  ocultos por no tener credenciales: %s\n", strings.Join(hidden, ", "))
	}
	fmt.Println()
	return 0
}

func readMark(a check.Access) string {
	switch a {
	case check.Yes:
		return "✔"
	case check.No:
		return "✗"
	case check.Unknown:
		return "?"
	}
	return "·"
}
