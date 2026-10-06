package main

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"

	"creditop/playground/connectors/env"
)

// El conector de asesor usa el runtime Node/Playwright ya instalado para el navegador.
func runAdvisor(command string, args []string) int {
	dir, err := env.Dir()
	if err != nil {
		return fail(2, "%v", err)
	}
	argv := append([]string{filepath.Join(dir, "advisor", "cli.ts"), command}, args...)
	cmd := exec.Command("node", argv...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Dir = filepath.Dir(dir)
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode()
		}
		return fail(2, "no pude ejecutar el conector de asesor: %v", err)
	}
	return 0
}
func runAdvisorStatus(args []string) int {
	fs := flag.NewFlagSet("advisor status", flag.ContinueOnError)
	target := fs.String("target", "", "local | dev | qa | staging (default todos)")
	origin := fs.String("origin", "", "origen del wizard")
	asJSON := fs.Bool("json", false, "estado en JSON")
	account := fs.String("account", "", "el asesor de prueba de un comercio (c<hash>-fake@creditop.com)")
	if fs.Parse(args) != nil {
		return 2
	}
	var flags []string
	if *target != "" {
		flags = append(flags, "--target", *target)
	}
	if *origin != "" {
		flags = append(flags, "--origin", *origin)
	}
	if *asJSON {
		flags = append(flags, "--json")
	}
	if *account != "" {
		flags = append(flags, "--account", *account)
	}
	return runAdvisor("status", flags)
}
func runAdvisorLogin(args []string) int  { return runAdvisor("login", args) }
func runAdvisorLogout(args []string) int { return runAdvisor("logout", args) }
