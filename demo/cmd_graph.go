// cmd_graph.go — recorrer el GRAFO: neighbors, hierarchy, edges.
//
// ⚠ `neighbors` y `hierarchy` son A DEMANDA (parsean el archivo pedido y su vecindad, decenas de
// archivos). `edges` necesita el repo entero, porque filtrar «todas las aristas de tal procedencia» es
// una afirmación sobre el conjunto.
package main

import (
	"fmt"
	"sort"
	"strings"
)

// label — el mecanismo, y por qué ancestro se llegó si no fue la clase misma. Sin el `via`, una arista
// hallada subiendo dos niveles se lee igual que una declarada al lado, y quien lea el mapa no puede
// saber que el método no está donde lo buscó.
func label(e edge) string {
	if e.Via != "" {
		return "[" + e.Kind + " ↑" + e.Via + "]"
	}
	return "[" + e.Kind + "]"
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "…" + s[len(s)-n+1:]
}

func cmdNeighbors(args []string) {
	c := newCtx("neighbors", "de UN archivo: quién lo llama y a quién llama", false)
	var kind string
	var maxCallers int
	c.fs.StringVar(&kind, "kind", "", "sólo aristas de esta procedencia: self|prop|ctor|static")
	c.fs.IntVar(&maxCallers, "max-callers", 300, "tope de archivos a parsear buscando quién llama")
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá una ruta:  demo neighbors Modules/.../Foo.php"))
	}
	x := c.explorer()
	defer x.close()
	seed := x.parse(rest[0])
	if seed == nil {
		die(fmt.Errorf("no pude leer %q en %s @ %s", rest[0], x.r.name(), x.r.fuente()))
	}
	g, dropped := x.expand([]*sourceFile{seed}, maxCallers)
	in, out := g.neighbors(seed.Path)
	keep := func(es []edge) []edge {
		if kind == "" {
			return es
		}
		var kept []edge
		for _, e := range es {
			if e.Kind == kind {
				kept = append(kept, e)
			}
		}
		return kept
	}
	in, out = keep(in), keep(out)
	if c.emit(map[string]any{"file": seed.Path, "parsed": x.parsed,
		"called_by": in, "calls": out, "callers_not_parsed": dropped}) {
		return
	}
	fmt.Printf("%s   [%s @ %s · %d archivos parseados]\n", seed.Path, x.r.name(), x.r.fuente(), x.parsed)
	if dropped > 0 {
		fmt.Printf("  ⚠ %d candidatos a llamador quedaron sin parsear (--max-callers): la lista de\n"+
			"    «lo llaman» está INCOMPLETA\n", dropped)
	}
	fmt.Printf("\n  LO LLAMAN (%d):\n", len(in))
	for _, e := range in {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", truncate(e.From, 68), e.Line, e.Method, label(e))
	}
	fmt.Printf("\n  LLAMA A (%d):\n", len(out))
	for _, e := range out {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", truncate(e.To, 68), e.Line, e.Method, label(e))
	}
}

// cmdHierarchy — la cadena hacia arriba y quién hereda hacia abajo. Existe por un caso concreto: una
// clase puede inyectar diez servicios y no llamar a ninguno, porque los pasa a `parent::__construct`.
// Sin ver la cadena, el archivo más importante de un flujo parece vacío.
//
// Los dos lados salen de un grep: hacia arriba se resuelve `extends X` archivo por archivo; hacia abajo
// se busca quién escribe `extends <esta clase>`. Sin índice.
func cmdHierarchy(args []string) {
	c := newCtx("hierarchy", "la cadena de herencia de una clase, y quién hereda de ella", false)
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá una ruta o un nombre de clase:  demo hierarchy LenderListingService"))
	}
	x := c.explorer()
	defer x.close()
	needle := rest[0]

	root := x.parse(needle)
	if root == nil {
		x.locate([]string{needle})
		if p := x.classAt[needle]; p != "" {
			root = x.parse(p)
		}
	}
	if root == nil {
		die(fmt.Errorf("no encontré %q como ruta ni como clase en %s @ %s",
			needle, x.r.name(), x.r.fuente()))
	}
	// hacia arriba, resolviendo cada padre con un grep
	var chain []*sourceFile
	seen := map[string]bool{}
	for cur := root; cur != nil && !seen[cur.Path] && len(chain) < 24; {
		seen[cur.Path] = true
		chain = append(chain, cur)
		if cur.Extends == "" {
			break
		}
		x.locate([]string{cur.Extends})
		p := x.classAt[cur.Extends]
		if p == "" {
			break
		}
		cur = x.parse(p)
	}
	// hacia abajo: quién escribe `extends <esta clase>`
	short := shortName(root.Class)
	var children []string
	if short != "" {
		hits, _ := x.r.grepLines([]string{`extends[[:space:]]+` + short + `([[:space:]]|$|\{)`})
		for _, h := range hits {
			if h.path != root.Path {
				children = append(children, h.path)
			}
		}
		sort.Strings(children)
	}
	if c.emit(map[string]any{"chain": chain, "extended_by": children, "parsed": x.parsed}) {
		return
	}
	fmt.Printf("%s @ %s\n\nHACIA ARRIBA (%d):\n", x.r.name(), x.r.fuente(), len(chain))
	for i, s := range chain {
		fmt.Printf("  %s%s\n      %d métodos · %d inyectados · %s\n",
			strings.Repeat("  ", i), shortName(s.Class), len(s.Methods),
			len(s.Props)+len(s.CtorProps), s.Path)
		if len(s.Traits) > 0 {
			fmt.Printf("      %straits: %s\n", strings.Repeat("  ", i), strings.Join(s.Traits, ", "))
		}
	}
	if last := chain[len(chain)-1]; last.Extends != "" {
		fmt.Printf("  %s↑ %s  (no se declara en este repo: vendor, o fuera del checkout)\n",
			strings.Repeat("  ", len(chain)), last.Extends)
	}
	fmt.Printf("\nHEREDAN DE ÉL (%d):\n", len(children))
	for _, ch := range children {
		fmt.Printf("  %s\n", ch)
	}
}

// cmdEdges — el grafo crudo del repo, filtrable. Sirve para AUDITARLO: `--kind ctor` lista lo único que
// se resolvió por inferencia, y `--inherited` lo que se halló subiendo. Poder mirar por procedencia es
// la diferencia entre un grafo del que se puede desconfiar por partes y uno que hay que creer entero.
func cmdEdges(args []string) {
	c := newCtx("edges", "las conexiones del repo, filtrables por cómo se resolvieron", false)
	var kind, from, to string
	var inherited bool
	var limit int
	c.fs.StringVar(&kind, "kind", "", "self | prop | ctor | static")
	c.fs.StringVar(&from, "from", "", "la ruta de origen contiene esto")
	c.fs.StringVar(&to, "to", "", "la ruta de destino contiene esto")
	c.fs.BoolVar(&inherited, "inherited", false, "sólo las halladas SUBIENDO por extends o un trait")
	c.fs.IntVar(&limit, "limit", 60, "cortar a N (0 = todas)")
	c.parse(args)
	_, g := c.whole()
	var kept []edge
	for _, e := range g.Edges {
		switch {
		case kind != "" && e.Kind != kind:
		case inherited && e.Via == "":
		case !hasFold(e.From, from):
		case !hasFold(e.To, to):
		default:
			kept = append(kept, e)
		}
	}
	total := len(kept)
	if limit > 0 && len(kept) > limit {
		kept = kept[:limit]
	}
	if c.emit(kept) {
		return
	}
	for _, e := range kept {
		fmt.Printf("%-56s :%-5d → %-46s ::%s %s\n",
			truncate(e.From, 56), e.Line, truncate(e.To, 46), e.Method, label(e))
	}
	fmt.Printf("\n  %d aristas", total)
	if total > len(kept) {
		fmt.Printf("  (mostrando %d — subí --limit)", len(kept))
	}
	fmt.Println()
}
