// demo — buscá en el código de ESTE repo, y llevate el vecindario.
//
// PARA QUÉ EXISTE. Un modelo parado en un repo cualquiera necesita contestar «¿qué archivos toco para
// esto?» en la PRIMERA iteración, sin construir nada antes. `grep` le da los archivos que contienen el
// término y nada más; lo que le falta es lo de al lado: de quién dependen esos archivos, quién los
// llama, y qué saben hacer. Eso es lo que agrega esta herramienta.
//
//	demo can_check_preapproval
//
// Un término suelto y listo: descubre el repo del directorio actual, grepea, y devuelve los archivos
// que matchearon MÁS sus vecinos a un salto, cada uno con su clase, qué inyecta, sus métodos y —si es
// un test— las reglas de negocio que describe en prosa.
//
// CÓMO FUNCIONA, y por qué no hay paso de índice. El grep no es sólo la semilla: es el RESOLVEDOR. Una
// semilla dice `private LenderRepo $repo`; para saber qué archivo es se le pregunta al repo con
// `git grep "class LenderRepo"`, todos los nombres en una sola invocación. Se parsean decenas de
// archivos, no miles. No hay archivo de índice, así que no hay nada que pueda envejecer sin avisar.
//
// QUÉ NO CONTESTA. El cableado no es el negocio: el grafo dice que `getLenders()` llama a
// `applyProfilingRules()`, no dice que perfilamiento sólo CLASIFICA mientras el status de la sucursal
// EXCLUYE. Es un enrutador, no un contestador.
//
// ⚠ PROTOTIPO. No está en el `make` a propósito.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
)

// ── plomería común ───────────────────────────────────────────────────────────────────────────────

type ctx struct {
	fs     *flag.FlagSet
	dir    string
	rev    string
	ext    string
	asJSON bool
	f      filter
}

// newCtx — un FlagSet por subcomando, para que `<sub> --help` liste SUS opciones con sus valores
// válidos. La ayuda sale del código que corre, así que no se puede desincronizar.
func newCtx(name, about string, withFilters bool) *ctx {
	c := &ctx{fs: flag.NewFlagSet(name, flag.ExitOnError)}
	c.fs.StringVar(&c.dir, "C", "", "correr como si estuvieras en este directorio (default: el actual)")
	c.fs.StringVar(&c.rev, "rev", "", "leer de este ref de git en vez del working tree (ej: main)")
	c.fs.StringVar(&c.ext, "ext", ".php", "extensión a parsear")
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
// ⚠ El `flag` de Go deja de parsear en el primer argumento suelto, así que `demo foo --new-only`
// trataba la bandera como un segundo positional y el comando fallaba con «pasá un término» teniendo el
// término delante. Nadie escribe las banderas primero, y un CLI que exige un orden que no anunció es un
// CLI que se siente roto.
//
// Para saber si una bandera consume el argumento siguiente se le pregunta al propio FlagSet: las
// booleanas exponen IsBoolFlag(). Una lista a mano sería una segunda fuente de verdad sobre las
// banderas, desincronizándose en el primer flag nuevo.
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

// explorer — abre el repo del directorio actual. Todo comando empieza por acá: no hay estado previo.
func (c *ctx) explorer() *explorer {
	r, err := openRepo(c.dir, c.rev)
	if err != nil {
		die(err)
	}
	return newExplorer(r)
}

// whole — el repo entero parseado. Lo usan los comandos que necesitan afirmar algo sobre TODO (contar,
// decir «nadie lo llama»). Cuesta ~0,5 s y lo dice, para que quede claro que no es lo mismo que el
// vecindario a demanda.
func (c *ctx) whole() (*explorer, *graph) {
	x := c.explorer()
	g := x.fullGraph(c.ext)
	if !c.asJSON {
		fmt.Fprintf(os.Stderr, "  (%s @ %s · %d archivos parseados)\n", g.Repo, g.Branch, x.parsed)
	}
	return x, g
}

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

// ── el despachador ───────────────────────────────────────────────────────────────────────────────

type command struct {
	name  string
	about string
	run   func([]string)
}

var commands = []command{
	{"find", "⭐ un término → los archivos que lo contienen + sus vecinos. El default", cmdFind},
	{"methods", "métodos por nombre. Lo que una lista de rutas no puede dar", cmdMethods},
	{"cases", "las reglas de negocio en prosa, de las descripciones de los tests", cmdCases},
	{"", "", nil},
	{"show", "el detalle de UN archivo, o el esqueleto de lo que pase el filtro", cmdShow},
	{"files", "listar y FILTRAR archivos del repo", cmdFiles},
	{"", "", nil},
	{"neighbors", "de UN archivo: quién lo llama y a quién llama, con la procedencia", cmdNeighbors},
	{"hierarchy", "la cadena de herencia de una clase, y quién hereda de ella", cmdHierarchy},
	{"edges", "las conexiones del repo, filtrables por cómo se resolvieron", cmdEdges},
	{"measure", "los números: compresión y qué tanto del cableado se pudo resolver", cmdMeasure},
}

func usage() {
	fmt.Println(`demo — buscá en el código de ESTE repo, y llevate el vecindario

  demo <término>                    lo más usado: grep + los vecinos a un salto
  demo <command> [options]          demo <command> --help para sus opciones
`)
	for _, c := range commands {
		if c.name == "" {
			fmt.Println()
			continue
		}
		fmt.Printf("    %-11s %s\n", c.name, c.about)
	}
	fmt.Println(`
  El repo se DESCUBRE del directorio actual: no hay que configurar nada ni construir un índice.
  Por defecto lee el WORKING TREE (lo que hay en disco). --rev main lee esa rama; la salida
  siempre dice cuál de las dos usó.

  Filtros, combinables, en casi todos los comandos:
    --prefix Modules/Risk   --tier code|test|migration   --class X   --extends X
    --trait X   --implements X   --uses X   --method X   --table X   --case "texto"
    --with-cases   --orphan   --leaf   --min-methods N   --max-methods N
    --sort path|tokens|methods|in|out   --limit N

  Y en todos:  -C <dir>   --rev <ref>   --ext .php   --json`)
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
	// Un primer argumento que no es un comando conocido y no es una bandera se toma como TÉRMINO. Es
	// la razón de ser de la herramienta: `demo can_check_preapproval` tiene que funcionar sin que nadie
	// lea la ayuda antes.
	if !strings.HasPrefix(os.Args[1], "-") {
		cmdFind(os.Args[1:])
		return
	}
	fmt.Fprintf(os.Stderr, "comando desconocido %q\n\n", os.Args[1])
	usage()
	os.Exit(2)
}
