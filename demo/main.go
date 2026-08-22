// demo — el mapa de cableado de un repo, como CLI.
//
// QUÉ ES. Dos cosas sobre el código de un repo: el ESQUELETO de cada archivo (su clase, qué inyecta y
// la firma de cada método, sin los cuerpos) y el GRAFO de quién llama a quién, siguiendo la herencia.
// Todo derivado de `main` con AST, no del working tree y no con regex.
//
// QUÉ NO ES. El cableado no es el negocio: el grafo dice que `getLenders()` llama a
// `applyProfilingRules()`, no dice que perfilamiento sólo CLASIFICA mientras el status de la sucursal
// EXCLUYE. Eso vive en `context/`. Es un enrutador, no un contestador.
//
// CÓMO SE USA. El mapa NO se manda como contexto: se consulta. Está medido — mandarlo entero costaba
// 265.000 tokens y empataba con darle la lista de rutas y dejarlo pedir detalle de los pocos que le
// importan. Por eso la entrada útil es `neighborhood`: la pregunta pone la semilla, el grafo el resto.
//
// ⚠ PROTOTIPO. No está en el `make` a propósito, y no es fuente de contexto.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const branch = "main"

// ── plomería común ───────────────────────────────────────────────────────────────────────────────

type ctx struct {
	fs     *flag.FlagSet
	alias  string
	asJSON bool
	f      filter
}

// newCtx — un FlagSet por subcomando, para que `<sub> --help` liste SUS opciones con sus valores
// válidos. La ayuda sale del código que corre, así que no se puede desincronizar.
func newCtx(name, about string, withFilters bool) *ctx {
	c := &ctx{fs: flag.NewFlagSet(name, flag.ExitOnError)}
	c.fs.StringVar(&c.alias, "r", "legacy-backend", "el repo (alias de roots.json)")
	c.fs.BoolVar(&c.asJSON, "json", false, "salida en JSON")
	if withFilters {
		c.f.register(c.fs)
	}
	c.fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "demo %s — %s\n\nopciones:\n", name, about)
		c.fs.PrintDefaults()
	}
	return c
}

func (c *ctx) parse(args []string) []string {
	_ = c.fs.Parse(reorderArgs(c.fs, args))
	return c.fs.Args()
}

// reorderArgs — mueve las banderas adelante para que el orden NO importe.
//
// ⚠ El `flag` de Go deja de parsear en el primer argumento suelto, así que
// `demo neighborhood can_check_preapproval --new-only` trataba la bandera como un segundo positional y
// el comando fallaba con «pasá un término» teniendo el término delante. Nadie escribe las banderas
// primero, y un CLI que exige un orden que no anunció es un CLI que se siente roto.
//
// Para saber si una bandera consume el argumento siguiente se le pregunta al propio FlagSet: las
// booleanas exponen IsBoolFlag(). Hacerlo con una lista a mano sería una segunda fuente de verdad
// sobre las banderas, desincronizándose en el primer flag nuevo.
func reorderArgs(fs *flag.FlagSet, args []string) []string {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if len(a) > 1 && strings.HasPrefix(a, "-") {
			flags = append(flags, a)
			name := strings.TrimLeft(a, "-")
			if !strings.Contains(name, "=") {
				if f := fs.Lookup(name); f != nil {
					isBool := false
					if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok {
						isBool = bf.IsBoolFlag()
					}
					if !isBool && i+1 < len(args) {
						i++
						flags = append(flags, args[i])
					}
				}
			}
			continue
		}
		positional = append(positional, a)
	}
	return append(flags, positional...)
}

func (c *ctx) graph() *graph { return loadGraph(c.alias) }

func (c *ctx) emit(v any) bool {
	if !c.asJSON {
		return false
	}
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		die(err)
	}
	fmt.Println(string(b))
	return true
}

func die(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func baseDir() string {
	if d, err := os.Executable(); err == nil {
		if p := filepath.Dir(d); strings.Contains(p, "demo") {
			return p
		}
	}
	wd, _ := os.Getwd()
	return wd
}

func graphPath(alias string) string { return filepath.Join(baseDir(), "graph-"+alias+".json") }

func loadGraph(alias string) *graph {
	b, err := os.ReadFile(graphPath(alias))
	if err != nil {
		die(fmt.Errorf("no hay mapa de %q todavía — corré:  demo index -r %s", alias, alias))
	}
	var g graph
	if err := json.Unmarshal(b, &g); err != nil {
		die(err)
	}
	return &g
}

func repoFor(alias string) string {
	all, err := loadRoots(filepath.Join(baseDir(), "roots.json"))
	if err != nil {
		die(err)
	}
	repo, ok := all[alias]
	if !ok {
		keys := make([]string, 0, len(all))
		for k := range all {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		die(fmt.Errorf("alias desconocido %q. Los válidos: %s", alias, strings.Join(keys, ", ")))
	}
	return repo
}

// ── el despachador ───────────────────────────────────────────────────────────────────────────────

type command struct {
	name  string
	about string
	run   func([]string)
}

var commands = []command{
	{"index", "construye el mapa del repo leyendo `main` (~0,5 s)", cmdIndex},
	{"measure", "los números del mapa: compresión y qué tanto del cableado se resolvió", cmdMeasure},
	{"", "", nil},
	{"neighborhood", "⭐ un término → los archivos que lo contienen + sus vecinos a 1 salto", cmdNeighborhood},
	{"methods", "métodos por nombre, en todo el repo. Lo que una lista de rutas no puede dar", cmdMethods},
	{"cases", "las reglas de negocio en prosa, sacadas de las descripciones de los tests", cmdCases},
	{"", "", nil},
	{"files", "listar y FILTRAR archivos. La puerta a todos los filtros", cmdFiles},
	{"map", "el esqueleto de lo que pase el filtro (un archivo, un módulo, un tier)", cmdMap},
	{"", "", nil},
	{"neighbors", "de UN archivo: quién lo llama y a quién llama, con la procedencia", cmdNeighbors},
	{"edges", "las conexiones, filtrables por cómo se resolvieron", cmdEdges},
	{"hierarchy", "la cadena de herencia de una clase, y quién hereda de ella", cmdHierarchy},
}

func usage() {
	fmt.Println(`demo — el mapa de cableado de un repo

  demo <command> [options]        ·  demo <command> --help  para sus opciones`)
	for _, c := range commands {
		if c.name == "" {
			fmt.Println()
			continue
		}
		fmt.Printf("    %-13s %s\n", c.name, c.about)
	}
	fmt.Println(`
  Casi todo acepta los MISMOS filtros y se pueden combinar:
    --prefix Modules/Risk   --tier code|test|migration   --class X   --extends X
    --trait X   --implements X   --uses X   --method X   --table X   --case "texto"
    --with-cases   --orphan   --leaf   --min-methods N   --max-methods N
    --sort path|tokens|methods|in|out   --limit N

  Y todos aceptan  -r <repo>  (default legacy-backend)  y  --json.

  Los repos salen de roots.json, DERIVADO de context/tools/roots.py:
    python3 -c "import sys,json; sys.path.insert(0,'../context/tools'); from roots import ROOTS; \
print(json.dumps(ROOTS,indent=2,sort_keys=True))" > roots.json`)
}

func main() {
	if len(os.Args) < 2 || os.Args[1] == "-h" || os.Args[1] == "--help" || os.Args[1] == "help" {
		usage()
		return
	}
	for _, c := range commands {
		if c.name != "" && c.name == os.Args[1] {
			c.run(os.Args[2:])
			return
		}
	}
	fmt.Fprintf(os.Stderr, "comando desconocido %q\n\n", os.Args[1])
	usage()
	os.Exit(2)
}
