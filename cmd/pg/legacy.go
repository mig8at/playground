package main

import (
	"fmt"
	"os"
	"strings"
)

// legacyCommands: los subcomandos de antes (en español) → los de ahora (2026-11-18). Siguen andando porque las
// tareas guardan el comando exacto y otras herramientas los escribían; avisan el nombre nuevo por stderr.
var legacyCommands = map[string]string{
	"tareas": "tasks", "tarea pila": "task stack", "tarea ramas": "task branches", "tarea bloque": "task block",
	"cierre": "closeout", "bitacora add": "worklog add", "canon yo": "canon me",
	// un grupo sin su verbo (`pg tarea`) lista los del grupo nuevo
	"tarea": "task", "bitacora": "worklog",
}

// legacyCommand traduce las primeras palabras de un subcomando de antes: con dos palabras primero (`tarea bloque`),
// después con una (`cierre`).
func legacyCommand(args []string) []string {
	if len(args) > 1 {
		if n, ok := legacyCommands[args[0]+" "+args[1]]; ok {
			fmt.Fprintf(os.Stderr, "  ⚠ pg %s %s se llama pg %s (el nombre viejo sigue andando)\n", args[0], args[1], n)
			return append(strings.Fields(n), args[2:]...)
		}
	}
	if n, ok := legacyCommands[args[0]]; ok {
		fmt.Fprintf(os.Stderr, "  ⚠ pg %s se llama pg %s (el nombre viejo sigue andando)\n", args[0], n)
		return append(strings.Fields(n), args[1:]...)
	}
	return args
}
