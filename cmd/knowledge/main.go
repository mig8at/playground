// knowledge: catálogo, búsqueda, lectura y comprobación local. No necesita un servidor.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"creditop/my-tools/connectors/repos"
	"creditop/my-tools/knowledge"
)

func main() { os.Exit(run(os.Args[1:])) }
func run(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "uso: knowledge map|search|read|check|touch|fetch [--json] [--root <repo>] <consulta|referencia|repo:ruta…|repo:a..b>")
		return 2
	}
	fs := flag.NewFlagSet("knowledge", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "salida JSON")
	root := fs.String("root", ".", "raíz de my-tools")
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
	case "fetch":
		/* Trae main a los clones de `main_clones` (los de canon) de los repos que cita la biblioteca. Un repo sin
		 * clon ahí no se toca: su clon de trabajo tiene ramas y stashes de otras sesiones. */
		client := repos.New(filepath.Join(*root, "tools"))
		seen := map[string]bool{}
		for _, t := range l.Topics {
			for _, s := range t.Sources {
				seen[s.Repo] = true
			}
		}
		aliases := make([]string, 0, len(seen))
		for a := range seen {
			aliases = append(aliases, a)
		}
		sort.Strings(aliases)
		bad := 0
		for _, alias := range aliases {
			dir := client.MainRoot(alias)
			if dir == "" || dir == client.Citable()[alias] {
				fmt.Printf("  · %s: sin clon en main_clones, no se toca (%s)\n", alias, dir)
				continue
			}
			out, err := exec.Command("git", "-C", dir, "fetch", "-q", "origin").CombinedOutput()
			if err != nil {
				bad++
				fmt.Printf("  ✗ %s: %s\n", alias, strings.TrimSpace(string(out)))
				continue
			}
			/* Los clones de canon son parciales (`blob:none`): el primer `git grep` sobre main baja el contenido de los
			 * archivos de a uno y tardaba ~24 s por búsqueda en Wally. Se baja acá, una vez, con una búsqueda que no
			 * encuentra nada; después cada búsqueda tarda centésimas. */
			_ = exec.Command("git", "-C", dir, "grep", "-q", "-F", "-e", "knowledge fetch: texto que no existe en ningún repo", "FETCH_HEAD").Run()
			head, _ := exec.Command("git", "-C", dir, "log", "-1", "--format=%h · %cr", "FETCH_HEAD").Output()
			fmt.Printf("  ✓ %s · %s\n", alias, strings.TrimSpace(string(head)))
		}
		if bad > 0 {
			return 1
		}
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
	case "touch":
		/* Las secciones que respaldan estos archivos. Cada argumento es `repo:ruta` (un archivo) o
		 * `repo:a..b` (lo que cambió entre dos refs del clon: «¿qué releo después de este merge?»). */
		client := repos.New(filepath.Join(*root, "tools"))
		var files []knowledge.RepoFile
		for _, arg := range fs.Args() {
			repo, rest, ok := strings.Cut(arg, ":")
			alias := knowledge.AliasOf(client, repo)
			if !ok || alias == "" {
				fmt.Fprintf(os.Stderr, "«%s» no es repo:ruta ni repo:a..b con un repo de tools/repos.json\n", arg)
				return 2
			}
			if a, b, isRange := strings.Cut(rest, ".."); isRange {
				for _, path := range knowledge.ChangedBetween(client.MainRoot(alias), a, b) {
					files = append(files, knowledge.RepoFile{Repo: alias, Path: path})
				}
				continue
			}
			files = append(files, knowledge.RepoFile{Repo: alias, Path: rest})
		}
		if len(files) == 0 {
			fmt.Fprintln(os.Stderr, "faltan archivos: repo:ruta… o repo:a..b")
			return 2
		}
		touched := l.Touched(files)
		if *asJSON {
			printJSON(touched)
			return 0
		}
		fmt.Printf("%d archivo(s) · %d sección(es) los citan como fuente\n", len(files), len(touched))
		for _, t := range touched {
			fmt.Printf("  %s · %s\n      por: %s\n", t.ID, t.Title, strings.Join(t.Files, ", "))
		}
		if len(touched) == 0 {
			fmt.Println("Ninguna sección cita esos archivos. No prueba que no haya contexto: probá make knowledge-search.")
		}
	default:
		fmt.Fprintf(os.Stderr, "modo desconocido: %s\n", args[0])
		return 2
	}
	return 0
}
