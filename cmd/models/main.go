// models — los modelos de IA instalados en la Mac y qué herramienta usa cada uno, por consola (lib/models, el mismo
// código que la sección «Instalados» de News). El registro de quién usa qué está en models/registry.json.
//
//	bin/models list [--json]                    lo instalado, con tamaño y quién lo usa
//	bin/models path <modelo|herramienta|clave>  las rutas que abre una herramienta (una por línea)
//	bin/models unused [--json]                  lo que ninguna herramienta usa: lo que se puede borrar
//	bin/models rm <clave> [--force]             borra (si está en uso, pide --force)
//	bin/models replace --tool T --old M --new M --files k1,k2 [--why '…']
//	                                            el ganador pasa a ser el de la herramienta, el perdedor se borra y
//	                                            queda en el historial de News
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"creditop/my-tools/lib/models"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	root := os.Getenv("MY_TOOLS_ROOT")
	if root == "" {
		root, _ = os.Getwd()
	}
	reg, err := models.LoadRegistry(root)
	if err != nil {
		fail(err)
	}
	roots := models.DefaultRoots()
	cmd, args := os.Args[1], os.Args[2:]
	switch cmd {
	case "list", "unused":
		fs := flag.NewFlagSet(cmd, flag.ExitOnError)
		asJSON := fs.Bool("json", false, "salida en JSON")
		fs.Parse(args)
		list := reg.Annotate(models.Scan(roots))
		if cmd == "unused" {
			var free []models.Installed
			for _, it := range list {
				if len(it.Tools) == 0 {
					free = append(free, it)
				}
			}
			list = free
		}
		if *asJSON {
			json.NewEncoder(os.Stdout).Encode(list)
			return
		}
		var total int64
		for _, it := range list {
			total += it.Bytes
			use := "—"
			if len(it.Tools) > 0 {
				use = "en uso: " + strings.Join(it.Tools, ", ")
			}
			fmt.Printf("%-40s %9s  %s\n", it.Key, size(it.Bytes), use)
		}
		label := "instalado"
		if cmd == "unused" {
			label = "sin uso (se puede borrar)"
		}
		fmt.Printf("%d · %s %s\n", len(list), size(total), label)
	case "path":
		if len(args) != 1 {
			usage()
		}
		os.Exit(path(reg, roots, args[0]))
	case "rm":
		fs := flag.NewFlagSet("rm", flag.ExitOnError)
		force := fs.Bool("force", false, "borrarlo aunque una herramienta lo use")
		fs.Parse(reorder(args))
		if fs.NArg() != 1 {
			usage()
		}
		key := fs.Arg(0)
		if uses := reg.UsesOf(key); len(uses) > 0 && !*force {
			fail(fmt.Errorf("%s lo usa %s: deja de andar hasta volver a bajarlo (si es lo que querés, --force)", key, tools(uses)))
		}
		it, err := models.Remove(roots, key)
		if err != nil {
			fail(err)
		}
		fmt.Printf("borrado %s (%s)\n", it.Key, size(it.Bytes))
	case "replace":
		replace(root, reg, roots, args)
	default:
		usage()
	}
}

// path: las rutas para abrir un modelo; por clave, por id del modelo o por herramienta. Sale 1 si no está instalado.
func path(reg *models.Registry, roots models.Roots, name string) int {
	installed := map[string]models.Installed{}
	for _, it := range models.Scan(roots) {
		installed[it.Key] = it
	}
	keys := []string{name}
	if uses := reg.Find(name); len(uses) > 0 {
		keys = nil
		for _, u := range uses {
			keys = append(keys, u.Files...)
		}
	}
	missing := 0
	for _, k := range keys {
		it, ok := installed[k]
		if !ok {
			fmt.Fprintf(os.Stderr, "models: %s no está instalado\n", k)
			missing++
			continue
		}
		for _, p := range it.Locations() {
			fmt.Println(p)
		}
	}
	if missing > 0 {
		return 1
	}
	return 0
}

// replace: la regla de Miguel (2026-11-19) en un paso: si un modelo le gana a otro en la misma tarea, se registra, el
// ganador queda de default en el registro y el perdedor se borra y queda en el historial de News como descartado.
func replace(root string, reg *models.Registry, roots models.Roots, args []string) {
	fs := flag.NewFlagSet("replace", flag.ExitOnError)
	tool := fs.String("tool", "", "la herramienta")
	oldM := fs.String("old", "", "el modelo que pierde")
	newM := fs.String("new", "", "el modelo que gana")
	files := fs.String("files", "", "las claves instaladas del ganador, separadas por coma")
	why := fs.String("why", "", "por qué ganó, en una línea (va al historial de News)")
	keep := fs.Bool("keep", false, "no borrar al perdedor")
	fs.Parse(args)
	if *tool == "" || *oldM == "" || *newM == "" || *files == "" {
		fail(fmt.Errorf("faltan --tool, --old, --new y --files"))
	}
	newFiles := strings.Split(*files, ",")
	installed := map[string]bool{}
	for _, it := range models.Scan(roots) {
		installed[it.Key] = true
	}
	for _, f := range newFiles {
		if !installed[f] {
			fail(fmt.Errorf("%s no está instalado: el ganador tiene que estar en la Mac antes de reemplazar", f))
		}
	}
	today := time.Now().Format("2006-01-02")
	free, err := reg.Replace(*tool, *oldM, *newM, newFiles, "", "", today)
	if err != nil {
		fail(err)
	}
	if err := reg.Save(); err != nil {
		fail(err)
	}
	fmt.Printf("registro: %s usa ahora %s (antes %s)\n", *tool, *newM, *oldM)
	if !*keep {
		for _, k := range free {
			if !installed[k] {
				continue
			}
			it, err := models.Remove(roots, k)
			if err != nil {
				fail(err)
			}
			fmt.Printf("borrado %s (%s)\n", it.Key, size(it.Bytes))
		}
	}
	if err := markFavorites(root, *oldM, *newM, *tool, *why, today); err != nil {
		fmt.Fprintln(os.Stderr, "models: el historial de News no se tocó:", err)
	}
}

// markFavorites deja el reemplazo en el historial de News (news/favorites.json): el perdedor descartado, el ganador
// en uso. Si alguno no está entre los favoritos, no lo inventa.
func markFavorites(root, oldM, newM, tool, why, today string) error {
	p := filepath.Join(root, "news", "favorites.json")
	raw, err := os.ReadFile(p)
	if err != nil {
		return err
	}
	var favs []map[string]any
	if err := json.Unmarshal(raw, &favs); err != nil {
		return err
	}
	for _, f := range favs {
		switch f["id"] {
		case oldM:
			f["verdict"], f["installed"] = "dropped", []string{}
			reason := strings.TrimSpace(why)
			if reason != "" && !strings.HasSuffix(reason, ".") {
				reason += "."
			}
			f["verdictWhy"] = strings.Join(strings.Fields(fmt.Sprintf("Superado por %s el %s en %s. %s Borrado de la Mac.", newM, today, tool, reason)), " ")
			delete(f, "usedBy")
			if f["triedOn"] == nil {
				f["triedOn"] = today
			}
		case newM:
			f["verdict"], f["usedBy"] = "keep", tool
			if f["triedOn"] == nil {
				f["triedOn"] = today
			}
			if why != "" {
				f["verdictWhy"] = why
			}
		}
	}
	out, err := json.MarshalIndent(favs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, append(out, '\n'), 0o644)
}

func tools(uses []models.Use) string {
	var out []string
	for _, u := range uses {
		out = append(out, u.Tool)
	}
	return strings.Join(out, ", ")
}

// reorder: deja las opciones antes que la clave, así `rm clave --force` y `rm --force clave` andan igual.
func reorder(args []string) []string {
	var flags, rest []string
	for _, a := range args {
		if strings.HasPrefix(a, "-") {
			flags = append(flags, a)
		} else {
			rest = append(rest, a)
		}
	}
	return append(flags, rest...)
}

func size(n int64) string {
	switch {
	case n >= 1e9:
		return fmt.Sprintf("%.1f GB", float64(n)/1e9)
	case n >= 1e6:
		return fmt.Sprintf("%d MB", n/1e6)
	default:
		return fmt.Sprintf("%d KB", max(n/1e3, 1))
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `uso: bin/models list|unused [--json] · path <modelo|herramienta|clave> · rm <clave> [--force]
     replace --tool T --old M --new M --files k1,k2 [--why '…'] [--keep]`)
	os.Exit(2)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "models:", err)
	os.Exit(1)
}
