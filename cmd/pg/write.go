package main

import (
	"flag"
	"fmt"
	"os"

	"creditop/playground/connectors/guard"
)

// Lo que comparten los comandos que escriben hacia afuera.
//
// ⚠ POR DEFECTO SÓLO MUESTRAN. Un issue en Jira o un mensaje en Slack lo lee el equipo apenas sale, y
// no hay «deshacer» que lo des-lea: la vista previa resuelve todo lo que se puede resolver sin escribir
// (quién soy, qué sprint, cómo queda el nombre) y dice qué haría. Recién con `--apply` escribe.

// applyFlag registra `--apply` en un comando que escribe.
func applyFlag(fs *flag.FlagSet) *bool {
	return fs.Bool("apply", false, "hacerlo de verdad; sin esto sólo muestra lo que haría")
}

// guarded frena el texto que no puede salir del playground —nombres de herramientas internas, rutas de
// archivo, hallazgos— con las MISMAS reglas que la bitácora que sube a Jira. Devuelve 0 si pasa.
func guarded(texts ...string) int {
	var found []map[string]string
	for _, t := range texts {
		found = append(found, guard.Violations(t)...)
	}
	if len(found) == 0 {
		return 0
	}
	fmt.Fprintln(os.Stderr, "pg: el texto no puede salir así (lo lee el equipo, que no tiene este repo):")
	for _, v := range found {
		fmt.Fprintf(os.Stderr, "  · %s → %q\n", v["what"], v["found"])
	}
	fmt.Fprintln(os.Stderr, "pg: corregilo y volvé a correr; no se escribió nada")
	return 2
}

// dryRun cierra una vista previa.
func dryRun() int {
	fmt.Println("\n  (vista previa: no se escribió nada — repetí con --apply para hacerlo)")
	return 0
}
