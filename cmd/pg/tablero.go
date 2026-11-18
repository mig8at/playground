package main

import (
	"creditop/my-tools/lib/cliflags"
	"errors"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// EL TABLERO COMO HERRAMIENTA. Escribir en una tarea era `make task-block N=… FILE=<bloque.md>`: un archivo
// temporal por bloque, comillas de shell en cada título y la salida con colores de terminal. Medido el 2026-10-20
// en una sesión: unas quince llamadas por tarea para cerrarla, y seis bloques rebotados por formato. Acá los mismos
// comandos del tablero se ofrecen como comandos de pg —y por eso como herramientas MCP—, con el texto como
// argumento.
//
// Corren el código del tablero tal cual (`go run` en tablero/server, que es otro módulo), sin pasar por make: la
// validación, las guardas y lo que se escribe son los de siempre, y no hay variables de make que se cuelen
// (un `N=` heredado por MAKEFLAGS mandaría el bloque a otra tarea).

// runTablero corre `go run <args>` en tablero/server con el texto en stdin y devuelve su código de salida.
func runTablero(stdin string, args ...string) int {
	root, err := myToolsRoot()
	if err != nil {
		return fail(1, "%v", err)
	}
	cmd := exec.Command("go", append([]string{"run"}, args...)...)
	cmd.Dir = filepath.Join(root, "tablero", "server")
	cmd.Stdin = strings.NewReader(stdin)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); k != "MAKEFLAGS" && k != "MFLAGS" && k != "MAKELEVEL" && k != "MAKEOVERRIDES" {
			cmd.Env = append(cmd.Env, kv)
		}
	}
	cmd.Env = append(cmd.Env, "NO_COLOR=1")
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return exit.ExitCode()
		}
		return fail(1, "no pude correr el tablero: %v", err)
	}
	return 0
}

func runTasks(args []string) int {
	fs := flag.NewFlagSet("tareas", flag.ContinueOnError)
	n := fs.String("n", "", "una tarea, por id o slug")
	all := fs.Bool("all", false, "también las archivadas")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	cmd := []string{"./cmd/tasks"}
	if *n != "" {
		cmd = append(cmd, "-n", *n)
	}
	if *all {
		cmd = append(cmd, "-all")
	}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runTaskStack(args []string) int {
	fs := flag.NewFlagSet("tarea pila", flag.ContinueOnError)
	task := fs.String("task", "", "id o slug")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --task")
	}
	return runTablero("", "./cmd/task-context", "-task", *task, "-show")
}

func runTaskBranches(args []string) int {
	fs := flag.NewFlagSet("tarea ramas", flag.ContinueOnError)
	task := fs.String("task", "", "id o slug")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --task")
	}
	cmd := []string{"./cmd/branches", "-n", *task}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runTaskBlock(args []string) int {
	fs := flag.NewFlagSet("tarea bloque", flag.ContinueOnError)
	task := fs.String("task", "", "id o slug")
	title := fs.String("title", "", "la conclusión, en una línea")
	body := fs.String("body", "", "lo que la sostiene, en Markdown")
	dry := fs.Bool("dry", false, "valida y muestra el bloque sin escribirlo")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	if *task == "" || strings.TrimSpace(*title) == "" || strings.TrimSpace(*body) == "" {
		return fail(2, "faltan --task, --title y --body")
	}
	if strings.ContainsAny(*title, "\r\n") {
		return fail(2, "el título va en una sola línea: lo demás va en --body")
	}
	cmd := []string{"./cmd/task-context", "-task", *task, "-block", "-"}
	if *dry {
		cmd = append(cmd, "-n")
	}
	return runTablero("# "+strings.TrimSpace(*title)+"\n\n"+strings.TrimSpace(*body)+"\n", cmd...)
}

func runCloseout(args []string) int {
	fs := flag.NewFlagSet("cierre", flag.ContinueOnError)
	task := fs.String("task", "", "id o slug")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --task")
	}
	cmd := []string{"./cmd/closeout", "-task", *task}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runWorklogAdd(args []string) int {
	fs := flag.NewFlagSet("bitacora add", flag.ContinueOnError)
	task := fs.String("task", "", "id o slug")
	title := fs.String("title", "", "qué se hizo, corto")
	note := fs.String("note", "", "realizada → resultado → validación")
	span := fs.String("span", "", "HH:MM-HH:MM")
	pulse := fs.String("pulse", "", "HH:MM: desde esa hora, medido por el pulso")
	minutes := fs.String("min", "", "minutos, con --source")
	source := fs.String("source", "", "de dónde salen los minutos de --min")
	day := fs.String("day", "", "AAAA-MM-DD, para un día anterior")
	since := fs.String("since", "", "HH:MM, con --min en un día anterior")
	dry := fs.Bool("dry", false, "valida y muestra sin escribir")
	if fs.Parse(cliflags.Translate(args, cliflags.Legacy)) != nil {
		return 2
	}
	if *task == "" || *title == "" {
		return fail(2, "faltan --task y --title")
	}
	cmd := []string{"./cmd/worklog", "-task", *task, "-title", *title}
	for _, f := range []struct{ flag, value string }{
		{"-note", *note}, {"-span", *span}, {"-pulse", *pulse}, {"-min", *minutes},
		{"-source", *source}, {"-day", *day}, {"-since", *since},
	} {
		if f.value != "" {
			cmd = append(cmd, f.flag, f.value)
		}
	}
	if *dry {
		cmd = append(cmd, "-n")
	}
	return runTablero("", cmd...)
}
