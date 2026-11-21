package main

// QUÉ SE GUARDA DE UNA META: `start --keep none|run|flow|recipe` y `finish --keep …` (server/keep.go lo explica).

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	keepNone   = "none"
	keepRun    = "run"
	keepFlow   = "flow"
	keepRecipe = "recipe"
)

var keepSays = map[string]string{
	keepNone:   "nada, sólo investigar",
	keepRun:    "la corrida (fotos, consola y red), sin flujo",
	keepFlow:   "la corrida y, si termina en LISTO, el flujo",
	keepRecipe: "la corrida, el flujo y su receta por API",
}

func validKeep(k string) bool { _, ok := keepSays[k]; return ok }

// recipeFromFlow escribe (o actualiza: una receta por flujo) la receta por API de un flujo recién guardado
// (recipes/api-from-flow.ts). El nombre de una receta va en inglés (make tablero-naming): finish --recipe.
func recipeFromFlow(app, flowPath, name string) error {
	root, err := repoRoot()
	if err != nil {
		return err
	}
	// Sin nombre, el generador usa la receta que ya salió de este flujo (y la actualiza) o, si no hay, el id del flujo.
	args := []string{filepath.Join(root, "jarvis", "recipes", "api-from-flow.ts"), "--flow", flowPath, "--app", app}
	if name != "" {
		args = append(args, "--name", name)
	} else {
		fmt.Println("sin --recipe: la receta de este flujo si ya hay una, o una con el id del flujo (en inglés es con finish --recipe <nombre>)")
	}
	cmd := exec.Command("node", args...)
	cmd.Dir, cmd.Stdout, cmd.Stderr = root, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("el flujo quedó, la receta no (si el flujo no escribió por API, no hay receta que sacar): %w", err)
	}
	return nil
}
