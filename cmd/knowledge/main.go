// knowledge: catálogo, búsqueda, lectura y comprobación local. No necesita un servidor.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"creditop/playground/connectors/repos"
	"creditop/playground/knowledge"
)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "uso: knowledge map|search|read|check [--json] [--root <repo>] <consulta|referencia>")
		return 2
	}
	fs := flag.NewFlagSet("knowledge", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "salida JSON")
	root := fs.String("root", ".", "raíz del playground")
	if err := fs.Parse(args[1:]); err != nil {
		return 2
	}
	l, err := knowledge.Open(filepath.Join(*root, "knowledge"))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	printJSON := func(v any) { json.NewEncoder(os.Stdout).Encode(v) }
	switch args[0] {
	case "map":
		if *asJSON {
			printJSON(l.Topics)
			return 0
		}
		fmt.Printf("Conocimiento local · %d tema(s) · sin consultas a Canon\n", len(l.Topics))
		for _, t := range l.Topics {
			fmt.Printf("  %s · %s\n    %s\n", t.ID, t.Title, t.Summary)
		}
	case "search":
		q := strings.Join(fs.Args(), " ")
		if strings.TrimSpace(q) == "" {
			fmt.Fprintln(os.Stderr, "falta la consulta")
			return 2
		}
		hits := l.Search(q)
		if *asJSON {
			printJSON(hits)
			return 0
		}
		for _, h := range hits {
			fmt.Printf("  %s · %s\n", h.ID, h.Title)
		}
		if len(hits) == 0 {
			fmt.Println("Sin coincidencias locales. Comprobá el código y las fuentes; la ausencia de contexto no prueba ausencia de comportamiento.")
		}
	case "read":
		if fs.NArg() != 1 {
			fmt.Fprintln(os.Stderr, "falta una referencia <tema[#sección]>")
			return 2
		}
		t, err := l.Read(fs.Arg(0))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if *asJSON {
			printJSON(t)
			return 0
		}
		fmt.Printf("# %s\n\n%s\n", t.Title, t.Intro)
		for _, s := range t.Sections {
			fmt.Printf("\n## %s\n\n%s\n", s.Title, s.Text)
		}
		fmt.Printf("\nFuentes: knowledge/%s/sources.json · revisión registrada: %s\n", t.ID, t.ReviewedAt)
	case "check":
		states, err := l.Check(repos.New(filepath.Join(*root, "tools")))
		if *asJSON {
			printJSON(states)
		} else {
			fmt.Println("Comprobación contra las refs de main disponibles en disco; no consulta remotos ni certifica despliegues.")
			for _, s := range states {
				fmt.Printf("  %s · %s · %s/%s · %s\n", s.State, s.Topic, s.Repo, s.Path, s.Detail)
			}
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
	default:
		fmt.Fprintf(os.Stderr, "modo desconocido: %s\n", args[0])
		return 2
	}
	return 0
}
