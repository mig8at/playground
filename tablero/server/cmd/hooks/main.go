// hooks corre un hook de Claude Code del playground: `hooks <nombre>`, con el evento en stdin. Qué hace
// cada uno y por qué existe: `internal/hooks`. Lo llama `.claude/hooks/run`, que es lo que declara
// `.claude/settings.json`.
package main

import (
	"os"
	"path/filepath"
	"time"

	"creditop/playground/tablero/server/internal/hooks"
)

func main() {
	if len(os.Args) != 2 {
		os.Stderr.WriteString("uso: hooks session-start|generated|destructive-tests|task-lint|closeout\n")
		os.Exit(0) // un hook mal llamado no puede frenar la sesión
	}
	root := os.Getenv("PLAYGROUND_ROOT")
	if root == "" {
		exe, _ := os.Executable()
		root = filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	}
	os.Exit(hooks.Run(os.Args[1], hooks.Env{
		Root: root, Home: os.Getenv("HOME"),
		Stdin: os.Stdin, Stdout: os.Stdout, Stderr: os.Stderr,
		Today: func() string { return time.Now().Format("2006-01-02") },
	}))
}
