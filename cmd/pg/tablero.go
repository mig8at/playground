package main

import (
	"errors"
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// EL TABLERO COMO HERRAMIENTA. Escribir en una tarea era `make tarea-bloque N=… ARCHIVO=<bloque.md>`: un archivo
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
	root, err := playgroundRoot()
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

func runTareas(args []string) int {
	fs := flag.NewFlagSet("tareas", flag.ContinueOnError)
	n := fs.String("n", "", "una tarea, por id o slug")
	all := fs.Bool("todas", false, "también las archivadas")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	cmd := []string{"./cmd/tasks"}
	if *n != "" {
		cmd = append(cmd, "-n", *n)
	}
	if *all {
		cmd = append(cmd, "-todas")
	}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runTareaPila(args []string) int {
	fs := flag.NewFlagSet("tarea pila", flag.ContinueOnError)
	task := fs.String("tarea", "", "id o slug")
	if fs.Parse(args) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --tarea")
	}
	return runTablero("", "./cmd/task-context", "-tarea", *task, "-ver")
}

func runTareaRamas(args []string) int {
	fs := flag.NewFlagSet("tarea ramas", flag.ContinueOnError)
	task := fs.String("tarea", "", "id o slug")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --tarea")
	}
	cmd := []string{"./cmd/branches", "-n", *task}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runTareaBloque(args []string) int {
	fs := flag.NewFlagSet("tarea bloque", flag.ContinueOnError)
	task := fs.String("tarea", "", "id o slug")
	title := fs.String("titulo", "", "la conclusión, en una línea")
	body := fs.String("cuerpo", "", "lo que la sostiene, en Markdown")
	dry := fs.Bool("seco", false, "valida y muestra el bloque sin escribirlo")
	if fs.Parse(args) != nil {
		return 2
	}
	if *task == "" || strings.TrimSpace(*title) == "" || strings.TrimSpace(*body) == "" {
		return fail(2, "faltan --tarea, --titulo y --cuerpo")
	}
	if strings.ContainsAny(*title, "\r\n") {
		return fail(2, "el título va en una sola línea: lo demás va en --cuerpo")
	}
	cmd := []string{"./cmd/task-context", "-tarea", *task, "-bloque", "-"}
	if *dry {
		cmd = append(cmd, "-n")
	}
	return runTablero("# "+strings.TrimSpace(*title)+"\n\n"+strings.TrimSpace(*body)+"\n", cmd...)
}

func runCierre(args []string) int {
	fs := flag.NewFlagSet("cierre", flag.ContinueOnError)
	task := fs.String("tarea", "", "id o slug")
	asJSON := fs.Bool("json", false, "en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	if *task == "" {
		return fail(2, "falta --tarea")
	}
	cmd := []string{"./cmd/closeout", "-tarea", *task}
	if *asJSON {
		cmd = append(cmd, "-json")
	}
	return runTablero("", cmd...)
}

func runBitacoraAdd(args []string) int {
	fs := flag.NewFlagSet("bitacora add", flag.ContinueOnError)
	task := fs.String("tarea", "", "id o slug")
	title := fs.String("titulo", "", "qué se hizo, corto")
	note := fs.String("nota", "", "realizada → resultado → validación")
	span := fs.String("lapso", "", "HH:MM-HH:MM")
	pulse := fs.String("pulso", "", "HH:MM: desde esa hora, medido por el pulso")
	minutes := fs.String("min", "", "minutos, con --fuente")
	source := fs.String("fuente", "", "de dónde salen los minutos de --min")
	day := fs.String("dia", "", "AAAA-MM-DD, para un día anterior")
	since := fs.String("desde", "", "HH:MM, con --min en un día anterior")
	dry := fs.Bool("seco", false, "valida y muestra sin escribir")
	if fs.Parse(args) != nil {
		return 2
	}
	if *task == "" || *title == "" {
		return fail(2, "faltan --tarea y --titulo")
	}
	cmd := []string{"./cmd/worklog", "-tarea", *task, "-titulo", *title}
	for _, f := range []struct{ flag, value string }{
		{"-nota", *note}, {"-lapso", *span}, {"-pulso", *pulse}, {"-min", *minutes},
		{"-fuente", *source}, {"-dia", *day}, {"-desde", *since},
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
