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
// 265.000 tokens y empataba con darle la lista de rutas y dejar que pida detalle de los pocos que le
// interesan. Por eso la entrada útil es `vecindario`: la pregunta pone la semilla, el grafo el resto.
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

const rama = "main"

// ── plomería común ───────────────────────────────────────────────────────────────────────────────

type ctx struct {
	fs    *flag.FlagSet
	alias string
	json  bool
	f     filtro
}

// nuevoCtx — un FlagSet por subcomando, para que `<sub> --help` liste SUS opciones con sus valores
// válidos. La ayuda sale del código que corre, así que no se puede desincronizar.
func nuevoCtx(nombre, uso string, conFiltros bool) *ctx {
	c := &ctx{fs: flag.NewFlagSet(nombre, flag.ExitOnError)}
	c.fs.StringVar(&c.alias, "r", "legacy-backend", "el repo (alias de roots.json)")
	c.fs.BoolVar(&c.json, "json", false, "salida en JSON")
	if conFiltros {
		c.f.registrar(c.fs)
	}
	c.fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "demo %s — %s\n\nopciones:\n", nombre, uso)
		c.fs.PrintDefaults()
	}
	return c
}

func (c *ctx) parsear(args []string) []string {
	_ = c.fs.Parse(reordenar(c.fs, args))
	return c.fs.Args()
}

// reordenar — mueve las banderas adelante para que el orden NO importe.
//
// ⚠ El `flag` de Go deja de parsear en el primer argumento suelto, así que
// `demo vecindario can_check_preapproval --solo-nuevos` trataba la bandera como un segundo positional
// y el comando fallaba con «pasá un término» teniendo el término delante. Nadie escribe las banderas
// primero, y un CLI que exige un orden que no anunció es un CLI que se siente roto.
//
// Para saber si una bandera consume el argumento siguiente se le pregunta al propio FlagSet: las
// booleanas exponen IsBoolFlag(). Hacerlo con una lista a mano sería una segunda fuente de verdad
// sobre las banderas, desincronizándose en el primer flag nuevo.
func reordenar(fs *flag.FlagSet, args []string) []string {
	var banderas, sueltos []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			sueltos = append(sueltos, args[i+1:]...)
			break
		}
		if len(a) > 1 && strings.HasPrefix(a, "-") {
			banderas = append(banderas, a)
			nombre := strings.TrimLeft(a, "-")
			if !strings.Contains(nombre, "=") {
				if f := fs.Lookup(nombre); f != nil {
					esBool := false
					if bf, ok := f.Value.(interface{ IsBoolFlag() bool }); ok {
						esBool = bf.IsBoolFlag()
					}
					if !esBool && i+1 < len(args) {
						i++
						banderas = append(banderas, args[i])
					}
				}
			}
			continue
		}
		sueltos = append(sueltos, a)
	}
	return append(banderas, sueltos...)
}

func (c *ctx) grafo() *grafo { return cargarGrafo(c.alias) }

func (c *ctx) emitir(v any) bool {
	if !c.json {
		return false
	}
	b, err := json.MarshalIndent(v, "", " ")
	if err != nil {
		salir(err)
	}
	fmt.Println(string(b))
	return true
}

func salir(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func dirBase() string {
	if d, err := os.Executable(); err == nil {
		if p := filepath.Dir(d); strings.Contains(p, "demo") {
			return p
		}
	}
	wd, _ := os.Getwd()
	return wd
}

func rutaGrafo(alias string) string { return filepath.Join(dirBase(), "grafo-"+alias+".json") }

func cargarGrafo(alias string) *grafo {
	b, err := os.ReadFile(rutaGrafo(alias))
	if err != nil {
		salir(fmt.Errorf("no hay mapa de %q todavía — corré:  demo extraer -r %s", alias, alias))
	}
	var g grafo
	if err := json.Unmarshal(b, &g); err != nil {
		salir(err)
	}
	return &g
}

func repoDe(alias string) string {
	raices, err := cargarRaices(filepath.Join(dirBase(), "roots.json"))
	if err != nil {
		salir(err)
	}
	repo, ok := raices[alias]
	if !ok {
		claves := make([]string, 0, len(raices))
		for k := range raices {
			claves = append(claves, k)
		}
		sort.Strings(claves)
		salir(fmt.Errorf("alias desconocido %q. Los válidos: %s", alias, strings.Join(claves, ", ")))
	}
	return repo
}

// ── el despachador ───────────────────────────────────────────────────────────────────────────────

type subcomando struct {
	nombre string
	que    string
	correr func([]string)
}

var subcomandos = []subcomando{
	{"extraer", "construye el mapa del repo leyendo `main` (~0,5 s)", cmdExtraer},
	{"medir", "los números del mapa: compresión y qué tanto del cableado se resolvió", cmdMedir},
	{"", "", nil},
	{"vecindario", "⭐ un término → los archivos que lo contienen + sus vecinos a 1 salto", cmdVecindario},
	{"buscar", "métodos por nombre, en todo el repo. Lo que una lista de rutas no puede dar", cmdBuscar},
	{"casos", "las reglas de negocio en prosa, sacadas de las descripciones de los tests", cmdCasos},
	{"", "", nil},
	{"archivos", "listar y FILTRAR archivos. La puerta a todos los filtros", cmdArchivos},
	{"mapa", "el esqueleto de lo que pase el filtro (un archivo, un módulo, un tier)", cmdMapa},
	{"", "", nil},
	{"vecinos", "de UN archivo: quién lo llama y a quién llama, con la procedencia", cmdVecinos},
	{"aristas", "las conexiones, filtrables por cómo se resolvieron", cmdAristas},
	{"jerarquia", "la cadena de herencia de una clase, y quién hereda de ella", cmdJerarquia},
}

func ayuda() {
	fmt.Println(`demo — el mapa de cableado de un repo

  demo <subcomando> [opciones]        ·  demo <subcomando> --help  para sus opciones`)
	for _, s := range subcomandos {
		if s.nombre == "" {
			fmt.Println()
			continue
		}
		fmt.Printf("    %-12s %s\n", s.nombre, s.que)
	}
	fmt.Println(`
  Casi todo acepta los MISMOS filtros y se pueden combinar:
    --prefijo Modules/Risk   --tier test|codigo|migracion   --clase X   --extiende X
    --trait X   --implementa X   --usa X   --metodo X   --tabla X   --caso "texto"
    --con-casos   --huerfano   --hoja   --min-metodos N   --max-metodos N
    --ordenar ruta|tokens|metodos|entradas|salidas   --tope N

  Y todos aceptan  -r <repo>  (default legacy-backend)  y  --json.

  Los repos salen de roots.json, DERIVADO de context/tools/roots.py:
    python3 -c "import sys,json; sys.path.insert(0,'../context/tools'); from roots import ROOTS; \
print(json.dumps(ROOTS,indent=2))" > roots.json`)
}

func main() {
	if len(os.Args) < 2 || os.Args[1] == "-h" || os.Args[1] == "--help" || os.Args[1] == "help" {
		ayuda()
		return
	}
	for _, s := range subcomandos {
		if s.nombre != "" && s.nombre == os.Args[1] {
			s.correr(os.Args[2:])
			return
		}
	}
	fmt.Fprintf(os.Stderr, "subcomando desconocido %q\n\n", os.Args[1])
	ayuda()
	os.Exit(2)
}
