// repos contesta, en JSON, lo que las herramientas en Python necesitan de la lista de repos
// (`tools/repos.py` le pregunta acá para todo lo que toca git). La lógica es `internal/repos`.
//
//	roots                          la lista: indexados, citables, extensiones y la raíz del playground
//	ref <alias|carpeta>            la ref que se mira en ese repo y por qué
//	refs                           las de todos los repos indexados, en una sola llamada
//	in-ref [<ref>]                 los archivos de código que existen en la ref, más lo no verificado
//	refresh [<segundos>]           `git fetch` de cada repo en paralelo; los que fallaron
//	file <alias> <ruta> [<sha>]    si la ruta existe, en qué commit, y dónde se ve
//	web                            dónde se ve cada repo citable
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/repos"
)

func main() {
	client := repos.New(layout.Find().Tools())
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
	}
	var out any
	switch args[0] {
	case "roots":
		out = map[string]any{"indexed": client.Indexed(), "citable": client.Citable(),
			"extensions": client.Extensions(), "playground": client.Playground, "stale_days": repos.StaleDays}
	case "ref":
		if len(args) != 2 {
			usage()
		}
		root := args[1]
		if path, ok := client.Indexed()[root]; ok {
			root = path
		}
		ref, reason := client.RefToIndex(root)
		out = map[string]string{"ref": ref, "reason": reason}
	case "refs":
		// Las de todos los repos indexados, en una sola llamada: carpeta → {ref, reason}.
		all := map[string]map[string]string{}
		for _, root := range client.Indexed() {
			ref, reason := client.RefToIndex(root)
			all[root] = map[string]string{"ref": ref, "reason": reason}
		}
		out = all
	case "in-ref":
		ref := ""
		if len(args) > 1 {
			ref = args[1]
		}
		have, unverified, stale := client.InRef(ref)
		out = map[string]any{"have": nonNil(have), "unverified": unverified, "stale": stale}
	case "refresh":
		seconds := 30
		if len(args) > 1 {
			seconds, _ = strconv.Atoi(args[1])
		}
		out = map[string]any{"failed": nonNil(client.RefreshRemotes(time.Duration(seconds) * time.Second))}
	case "file":
		if len(args) != 3 && len(args) != 4 {
			usage()
		}
		sha := ""
		if len(args) == 4 {
			sha = args[3]
		}
		f, _ := client.File(args[1], args[2], sha) // el error viaja en `error`, como lo lee quien llama
		out = f
	case "web":
		web, err := client.Web()
		if err != nil {
			fmt.Fprintln(os.Stderr, "✗", err)
			os.Exit(1)
		}
		out = web
	default:
		usage()
	}
	if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
		fmt.Fprintln(os.Stderr, "✗", err)
		os.Exit(1)
	}
}

func nonNil(xs []string) []string {
	if xs == nil {
		return []string{}
	}
	return xs
}

func usage() {
	fmt.Fprintln(os.Stderr, "uso: repos roots | ref <alias> | in-ref [<ref>] | refresh [<s>] | file <alias> <ruta> [<sha>] | web")
	os.Exit(2)
}
