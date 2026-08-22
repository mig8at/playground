// cmd_graph.go — los comandos que recorren el GRAFO: neighbors, edges, hierarchy.
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
	c.fs.StringVar(&kind, "kind", "", "sólo aristas de esta procedencia: self|prop|ctor|static")
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá una ruta:  demo neighbors Modules/.../Foo.php"))
	}
	g := c.graph()
	p := strings.TrimPrefix(rest[0], c.alias+"/")
	if g.Files[p] == nil {
		die(fmt.Errorf("%q no está en el mapa de %s", p, c.alias))
	}
	in, out := g.neighbors(p)
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
	if c.emit(map[string]any{"file": p, "called_by": in, "calls": out}) {
		return
	}
	fmt.Printf("%s\n\n  LO LLAMAN (%d):\n", p, len(in))
	for _, e := range in {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", truncate(e.From, 68), e.Line, e.Method, label(e))
	}
	fmt.Printf("\n  LLAMA A (%d):\n", len(out))
	for _, e := range out {
		fmt.Printf("    %-68s :%-5d ::%s  %s\n", truncate(e.To, 68), e.Line, e.Method, label(e))
	}
}

// cmdEdges — el grafo crudo, filtrable. Sirve para AUDITARLO: `--kind ctor` lista lo único que se
// resolvió por inferencia, y `--inherited` lo que se halló subiendo. Poder mirar por procedencia es la
// diferencia entre un grafo que se puede desconfiar por partes y uno que hay que creer entero.
func cmdEdges(args []string) {
	c := newCtx("edges", "las conexiones, filtrables por cómo se resolvieron", false)
	var kind, from, to string
	var inherited bool
	var limit int
	c.fs.StringVar(&kind, "kind", "", "self | prop | ctor | static")
	c.fs.StringVar(&from, "from", "", "la ruta de origen contiene esto")
	c.fs.StringVar(&to, "to", "", "la ruta de destino contiene esto")
	c.fs.BoolVar(&inherited, "inherited", false, "sólo las halladas SUBIENDO por extends o un trait")
	c.fs.IntVar(&limit, "limit", 60, "cortar a N (0 = todas)")
	c.parse(args)
	g := c.graph()
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

// cmdHierarchy — la cadena hacia arriba y quién hereda hacia abajo. Existe por un caso concreto:
// `LenderListingService` inyecta 10 servicios y no llama a ninguno — los pasa a `parent::__construct`.
// Sin ver la cadena, el archivo más importante del listado parece vacío.
func cmdHierarchy(args []string) {
	c := newCtx("hierarchy", "la cadena de herencia de una clase, y quién hereda de ella", false)
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá una ruta o un nombre de clase:  demo hierarchy LenderListingService"))
	}
	g := c.graph()
	needle := strings.TrimPrefix(rest[0], c.alias+"/")

	root := g.Files[needle]
	if root == nil {
		for _, s := range g.Files {
			if shortName(s.Class) == needle {
				root = s
				break
			}
		}
	}
	if root == nil {
		die(fmt.Errorf("no encontré %q como ruta ni como nombre de clase", needle))
	}
	byShort := map[string]*sourceFile{}
	for _, s := range g.Files {
		if s.Class != "" {
			byShort[shortName(s.Class)] = s
		}
	}
	// hacia arriba
	var chain []*sourceFile
	seen := map[string]bool{}
	for cur := root; cur != nil && !seen[cur.Path] && len(chain) < 24; {
		seen[cur.Path] = true
		chain = append(chain, cur)
		cur = byShort[cur.Extends]
	}
	// hacia abajo
	var children []string
	for _, s := range g.Files {
		if s.Extends != "" && s.Extends == shortName(root.Class) {
			children = append(children, s.Path)
		}
	}
	sort.Strings(children)
	if c.emit(map[string]any{"chain": chain, "extended_by": children}) {
		return
	}
	fmt.Printf("HACIA ARRIBA (%d):\n", len(chain))
	for i, s := range chain {
		fmt.Printf("  %s%s\n      %d métodos · %d inyectados · %s\n",
			strings.Repeat("  ", i), shortName(s.Class), len(s.Methods),
			len(s.Props)+len(s.CtorProps), s.Path)
		if len(s.Traits) > 0 {
			fmt.Printf("      %straits: %s\n", strings.Repeat("  ", i), strings.Join(s.Traits, ", "))
		}
	}
	if last := chain[len(chain)-1]; last.Extends != "" {
		fmt.Printf("  %s↑ %s  (fuera del repo: vendor o un repo sin indexar)\n",
			strings.Repeat("  ", len(chain)), last.Extends)
	}
	fmt.Printf("\nHEREDAN DE ÉL (%d):\n", len(children))
	for _, ch := range children {
		fmt.Printf("  %s\n", ch)
	}
}
