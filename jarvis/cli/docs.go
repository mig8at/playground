package main

/* La documentación de las herramientas y sus recetas, por consola y SIN el servidor: lee el repo con el paquete
 * jarvis/docs, así que sirve también en una máquina sin Chrome (la nube).
 *
 *	bin/jarvis docs                         las herramientas que Jarvis sabe usar
 *	bin/jarvis docs vtex [apis]             las recetas: qué hacen, por qué camino, qué escriben, sus llamadas
 *	bin/jarvis docs vtex screens            las pantallas del mapa y las secciones del barrido
 *	bin/jarvis docs vtex cases              lo que el admin escribe en cada caso grabado
 *	bin/jarvis docs vtex overview           el nivel 1 en prosa (maps/<app>/README.md)
 *	bin/jarvis docs vtex … --json           lo mismo, para otro programa
 *	bin/jarvis recipe vtex order [args]     corre una receta (como make jarvis-recipe) */

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"creditop/playground/jarvis/docs"
)

// repoRoot: la raíz del playground (bin/jarvis la pasa en JARVIS_ROOT; si no, se busca hacia arriba).
func repoRoot() (string, error) {
	if r := os.Getenv("JARVIS_ROOT"); r != "" {
		return r, nil
	}
	dir, _ := os.Getwd()
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, "jarvis", "recipes")); err == nil {
			return d, nil
		}
		if filepath.Dir(d) == d {
			return "", errors.New("no encuentro el playground (jarvis/recipes): corré desde adentro o con JARVIS_ROOT")
		}
	}
}

var modeName = map[string]string{
	"api":     "API con la llave de la cuenta · corre en cualquier máquina",
	"session": "las llamadas del admin con tu sesión · necesita tu Chrome con Jarvis",
	"screen":  "por pantalla · maneja el admin en tu Chrome con Jarvis",
}

func docsCmd(args []string) error {
	asJSON := false
	var rest []string
	for _, a := range args {
		if a == "--json" {
			asJSON = true
		} else {
			rest = append(rest, a)
		}
	}
	root, err := repoRoot()
	if err != nil {
		return err
	}
	if len(rest) == 0 {
		apps := docs.Apps(root)
		if asJSON {
			return printJSON(apps)
		}
		for _, id := range apps {
			a, err := docs.Load(root, id)
			if err != nil {
				return err
			}
			screens := 0
			for _, s := range a.Sections {
				screens += len(s.Screens)
			}
			fmt.Printf("%-8s %d recetas · %d casos grabados · %d pantallas en el mapa · %d del menú en %d secciones\n",
				id, len(a.Recipes), len(a.Cases), len(a.Screens), screens, len(a.Sections))
		}
		fmt.Println("\nbin/jarvis docs <herramienta> [apis | screens | cases | overview] [--json]")
		return nil
	}
	a, err := docs.Load(root, rest[0])
	if err != nil {
		return err
	}
	if len(a.Recipes) == 0 && len(a.Screens) == 0 && len(a.Sections) == 0 {
		return fmt.Errorf("no sé nada de %q (jarvis/recipes/%s ni jarvis/maps/%s)", rest[0], rest[0], rest[0])
	}
	what := "apis"
	if len(rest) > 1 {
		what = rest[1]
	}
	switch what {
	case "apis", "api", "recipes", "recetas":
		if asJSON {
			return printJSON(a.Recipes)
		}
		printRecipes(a)
	case "screens", "pantallas", "screen":
		if asJSON {
			return printJSON(map[string]any{"screens": a.Screens, "sections": a.Sections, "swept": a.Swept})
		}
		printScreens(a)
	case "cases", "casos", "grabaciones":
		if asJSON {
			return printJSON(a.Cases)
		}
		printCases(a)
	case "overview", "resumen":
		if asJSON {
			return printJSON(map[string]string{"overview": a.Overview})
		}
		fmt.Print(a.Overview)
	default:
		return fmt.Errorf("no conozco %q: apis, screens, cases u overview", what)
	}
	return nil
}

func printRecipes(a *docs.App) {
	fmt.Printf("%s · %d recetas (make jarvis-recipe APP=%s RECIPE=<receta> o bin/jarvis recipe %s <receta>)\n", a.ID, len(a.Recipes), a.ID, a.ID)
	for _, r := range a.Recipes {
		fmt.Printf("\n■ %s — %s\n", r.ID, r.Title)
		fmt.Printf("  camino: %s\n", modeName[r.Mode])
		if r.Writes != "" {
			fmt.Printf("  %s\n", r.Writes)
		} else {
			fmt.Println("  sólo lee")
		}
		for _, u := range r.Usage {
			fmt.Printf("  %s\n", u)
		}
		for _, c := range r.Calls {
			step := ""
			if c.Step != "" {
				step = "   · " + c.Step
			}
			fmt.Printf("    %-6s %-8s %s%s\n", c.Method, c.Host, c.Path, step)
		}
		if len(r.Operations) > 0 {
			fmt.Printf("    operaciones del admin (de la grabación %s): %s\n", r.Case, strings.Join(r.Operations, ", "))
		} else if r.Case != "" {
			fmt.Printf("    graba el caso %s (bin/jarvis docs %s cases)\n", r.Case, a.ID)
		}
		for _, w := range r.Warnings {
			fmt.Printf("  ⚠ %s\n", w)
		}
	}
}

func printScreens(a *docs.App) {
	fmt.Printf("%s · el mapa: %d pantallas con sus elementos (localizadores verificados)\n", a.ID, len(a.Screens))
	for _, s := range a.Screens {
		fmt.Printf("\n■ %s — %s\n  %s (guardada %s)\n", s.ID, s.Title, s.URL, s.Saved)
		fragile := 0
		for _, e := range s.Elements {
			if e.Fragile {
				fragile++
				continue
			}
			cond := ""
			if e.Conditional != "" {
				cond = " (aparece " + e.Conditional + ")"
			}
			fmt.Printf("    %-30s %-12s %s%s\n", e.Key, e.Kind, e.Locator, cond)
		}
		if fragile > 0 {
			fmt.Printf("    (+%d frágiles: sin un localizador estable)\n", fragile)
		}
	}
	total := 0
	for _, s := range a.Sections {
		total += len(s.Screens)
	}
	fmt.Printf("\n%s · el menú (barrido del %s): %d pantallas en %d secciones\n", a.ID, a.Swept, total, len(a.Sections))
	for _, s := range a.Sections {
		var names []string
		for _, sc := range s.Screens {
			names = append(names, sc.Name)
		}
		fmt.Printf("  %-15s %s\n", s.Name, strings.Join(names, " · "))
	}
}

func printCases(a *docs.App) {
	fmt.Printf("%s · %d casos grabados: lo que el admin ESCRIBE en cada uno (las lecturas de la pantalla no van)\n", a.ID, len(a.Cases))
	for _, c := range a.Cases {
		fmt.Printf("\n■ %s (grabado el %s)\n", c.ID, c.Recorded)
		for _, w := range c.Writes {
			op := ""
			if w.Operation != "" {
				op = " " + w.Operation
			}
			fmt.Printf("    [%s] %-6s %s%s → %d\n", w.Step, w.Method, w.Path, op, w.Status)
		}
	}
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// recipeCmd corre una receta con node, con la entrada y la salida de esta terminal.
func recipeCmd(args []string) error {
	if len(args) < 2 {
		return errors.New("uso: bin/jarvis recipe <herramienta> <receta> [args] (bin/jarvis docs <herramienta> las lista)")
	}
	root, err := repoRoot()
	if err != nil {
		return err
	}
	name := args[1]
	if n, ok := legacyRecipes[name]; ok {
		name = n
	}
	file := filepath.Join(root, "jarvis", "recipes", args[0], name+".ts")
	if _, err := os.Stat(file); err != nil {
		return fmt.Errorf("no existe %s (bin/jarvis docs %s las lista)", strings.TrimPrefix(file, root+"/"), args[0])
	}
	cmd := exec.Command("node", append([]string{file}, args[2:]...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			os.Exit(ee.ExitCode())
		}
		return err
	}
	return nil
}
