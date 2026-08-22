// cmd_grafo.go — los comandos que recorren el GRAFO: vecinos, aristas, jerarquía.
package main

import (
	"fmt"
	"sort"
	"strings"
)

// etiqueta — el mecanismo, y por qué ancestro se llegó si no fue la clase misma. Sin el `via`, una
// arista hallada subiendo dos niveles se lee igual que una declarada al lado, y quien lea el mapa no
// puede saber que el método no está donde lo buscó.
func etiqueta(e arista) string {
	if e.Via != "" {
		return "[" + e.Como + " ↑" + e.Via + "]"
	}
	return "[" + e.Como + "]"
}

func acortar(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n+1:]
}

func cmdVecinos(args []string) {
	c := nuevoCtx("vecinos", "de UN archivo: quién lo llama y a quién llama", false)
	var como string
	c.fs.StringVar(&como, "como", "", "sólo aristas de esta procedencia: interno|prop|ctor|estatico")
	resto := c.parsear(args)
	if len(resto) != 1 {
		salir(fmt.Errorf("pasá una ruta:  demo vecinos Modules/.../Foo.php"))
	}
	g := c.grafo()
	rel := strings.TrimPrefix(resto[0], c.alias+"/")
	if g.Archivos[rel] == nil {
		salir(fmt.Errorf("%q no está en el mapa de %s", rel, c.alias))
	}
	entran, salen := g.vecinos(rel)
	filtrar := func(es []arista) []arista {
		if como == "" {
			return es
		}
		var out []arista
		for _, e := range es {
			if e.Como == como {
				out = append(out, e)
			}
		}
		return out
	}
	entran, salen = filtrar(entran), filtrar(salen)
	if c.emitir(map[string]any{"archivo": rel, "lo_llaman": entran, "llama_a": salen}) {
		return
	}
	fmt.Printf("%s\n\n  LO LLAMAN (%d):\n", rel, len(entran))
	for _, e := range entran {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", acortar(e.De, 68), e.Linea, e.Met, etiqueta(e))
	}
	fmt.Printf("\n  LLAMA A (%d):\n", len(salen))
	for _, e := range salen {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", acortar(e.A, 68), e.Linea, e.Met, etiqueta(e))
	}
}

// cmdAristas — el grafo crudo, filtrable. Sirve para AUDITARLO: `--como ctor` lista lo único que se
// resolvió por inferencia, y `--jerarquia` lo que se halló subiendo. Poder mirar por procedencia es
// la diferencia entre un grafo que se puede desconfiar por partes y uno que hay que creer entero.
func cmdAristas(args []string) {
	c := nuevoCtx("aristas", "las conexiones, filtrables por cómo se resolvieron", false)
	var como, de, a string
	var soloJerarquia bool
	var tope int
	c.fs.StringVar(&como, "como", "", "interno | prop | ctor | estatico")
	c.fs.StringVar(&de, "de", "", "la ruta de origen contiene esto")
	c.fs.StringVar(&a, "a", "", "la ruta de destino contiene esto")
	c.fs.BoolVar(&soloJerarquia, "jerarquia", false, "sólo las halladas SUBIENDO por extends o un trait")
	c.fs.IntVar(&tope, "tope", 60, "cortar a N (0 = todas)")
	c.parsear(args)
	g := c.grafo()
	var out []arista
	for _, e := range g.Aristas {
		switch {
		case como != "" && e.Como != como:
		case soloJerarquia && e.Via == "":
		case !contiene(e.De, de):
		case !contiene(e.A, a):
		default:
			out = append(out, e)
		}
	}
	total := len(out)
	if tope > 0 && len(out) > tope {
		out = out[:tope]
	}
	if c.emitir(out) {
		return
	}
	for _, e := range out {
		fmt.Printf("%-56s :%-5d → %-46s ::%s %s\n",
			acortar(e.De, 56), e.Linea, acortar(e.A, 46), e.Met, etiqueta(e))
	}
	fmt.Printf("\n  %d aristas", total)
	if total > len(out) {
		fmt.Printf("  (mostrando %d — subí --tope)", len(out))
	}
	fmt.Println()
}

// cmdJerarquia — la cadena hacia arriba y quién hereda hacia abajo. Existe por un caso concreto:
// `LenderListingService` inyecta 10 servicios y no llama a ninguno — los pasa a `parent::__construct`.
// Sin ver la cadena, el archivo más importante del listado parece vacío.
func cmdJerarquia(args []string) {
	c := nuevoCtx("jerarquia", "la cadena de herencia de una clase, y quién hereda de ella", false)
	resto := c.parsear(args)
	if len(resto) != 1 {
		salir(fmt.Errorf("pasá una ruta o un nombre de clase:  demo jerarquia LenderListingService"))
	}
	g := c.grafo()
	aguja := strings.TrimPrefix(resto[0], c.alias+"/")

	var raiz *archivo
	if raiz = g.Archivos[aguja]; raiz == nil {
		for _, a := range g.Archivos {
			if corto(a.Clase) == aguja {
				raiz = a
				break
			}
		}
	}
	if raiz == nil {
		salir(fmt.Errorf("no encontré %q como ruta ni como nombre de clase", aguja))
	}
	porCorto := map[string]*archivo{}
	for _, a := range g.Archivos {
		if a.Clase != "" {
			porCorto[corto(a.Clase)] = a
		}
	}
	// hacia arriba
	var cadena []*archivo
	visto := map[string]bool{}
	for cur := raiz; cur != nil && !visto[cur.Ruta] && len(cadena) < 24; {
		visto[cur.Ruta] = true
		cadena = append(cadena, cur)
		cur = porCorto[cur.Extiende]
	}
	// hacia abajo
	var hijos []string
	for _, a := range g.Archivos {
		if a.Extiende != "" && a.Extiende == corto(raiz.Clase) {
			hijos = append(hijos, a.Ruta)
		}
	}
	sort.Strings(hijos)
	if c.emitir(map[string]any{"cadena": cadena, "heredan_de_el": hijos}) {
		return
	}
	fmt.Printf("HACIA ARRIBA (%d):\n", len(cadena))
	for i, a := range cadena {
		met := len(a.Metodos)
		inj := len(a.Props) + len(a.Ctor)
		fmt.Printf("  %s%s\n      %d métodos · %d inyectados · %s\n",
			strings.Repeat("  ", i), corto(a.Clase), met, inj, a.Ruta)
		if len(a.Traits) > 0 {
			fmt.Printf("      %straits: %s\n", strings.Repeat("  ", i), strings.Join(a.Traits, ", "))
		}
	}
	if cadena[len(cadena)-1].Extiende != "" {
		fmt.Printf("  %s↑ %s  (fuera del repo: vendor o un repo sin indexar)\n",
			strings.Repeat("  ", len(cadena)), cadena[len(cadena)-1].Extiende)
	}
	fmt.Printf("\nHEREDAN DE ÉL (%d):\n", len(hijos))
	for _, h := range hijos {
		fmt.Printf("  %s\n", h)
	}
}
