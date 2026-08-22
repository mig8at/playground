// cmd_neighborhood.go — EL GREP PONE LA INTENCIÓN, EL GRAFO PONE EL VECINDARIO. La entrada útil.
//
// EL PROBLEMA QUE RESUELVE. Un mapa entero es detalle uniforme SIN intención: el mismo nivel para los
// 2.529 archivos, sin importar la pregunta. Medido, eso costaba 265.000 tokens y empataba con darle la
// lista de rutas y dejarlo pedir detalle de los pocos que le importan. Acá la semilla la pone la
// pregunta —lo que matcheó el grep— y el grafo sólo agrega lo pegado a eso.
//
// LO QUE APORTA SOBRE EL GREP SOLO, que es la única razón para que exista: el archivo que **no
// matcheó** pero está a un salto. Grepeando `can_check_preapproval` aparece `ProfilingRulesService`,
// que no contiene el término y es uno de los cuatro archivos que el experimento del triaje tuvo que
// rescatar a mano. Un grep no puede verlo por construcción.
//
// ⚠ LA EXPANSIÓN EXPLOTA SI NO SE LA ATA. Medido en 5 términos: a 1 salto son 2-39 archivos, todos del
// vecindario real; a 2 saltos, 198-342, con OTP, ecommerce y contadores de Experian adentro — el
// fan-out del padre arrastra el módulo entero. Por eso el default es 1 salto y `--hops 2` avisa con
// esos números en vez de bajarlo en silencio.
package main

import (
	"fmt"
	"os/exec"
	"sort"
	"strings"
)

type nearby struct {
	Path      string          `json:"path"`
	Hops      int             `json:"hops"`
	seeds     map[string]bool // qué semillas lo tocan: co-activación
	SeedCount int             `json:"seeded_by"`
	Edges     []edge          `json:"via,omitempty"`
}

func cmdNeighborhood(args []string) {
	c := newCtx("neighborhood", "un término → los archivos que lo contienen + sus vecinos", true)
	var hops, budget int
	var asRegex, newOnly bool
	c.fs.IntVar(&hops, "hops", 1, "cuántos saltos expandir (⚠ 2 explota: ver la advertencia)")
	c.fs.IntVar(&budget, "tokens", 25000, "presupuesto; al cortar lo DICE")
	c.fs.BoolVar(&asRegex, "regex", false, "tratar el término como regex en vez de texto literal")
	c.fs.BoolVar(&newOnly, "new-only", false, "sólo lo que el grep NO encontró: el aporte del grafo")
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá un término:  demo neighborhood can_check_preapproval"))
	}
	term := rest[0]
	g := c.graph()

	// ── LA SEMILLA: lo que matcheó el grep, contra `main` y no contra el working tree.
	mode := "-F"
	if asRegex {
		mode = "-E"
	}
	raw, _ := exec.Command("git", "-C", repoFor(c.alias), "grep", "-l", mode, "--", term, branch).Output()
	in, out := g.degrees()
	seeds := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		p := strings.TrimPrefix(strings.TrimSpace(line), branch+":")
		if s := g.Files[p]; s != nil && c.f.matches(s, in, out) {
			seeds[p] = true
		}
	}
	if len(seeds) == 0 {
		fmt.Printf("«%s» no matcheó ningún archivo indexado de %s:%s\n", term, c.alias, branch)
		return
	}

	// ── LA EXPANSIÓN, en las dos direcciones: para «¿por qué no apareció?» los que LLAMAN importan
	// tanto como los llamados.
	adj := map[string][]edge{}
	for _, e := range g.Edges {
		if e.From == e.To {
			continue
		}
		adj[e.From] = append(adj[e.From], e)
		adj[e.To] = append(adj[e.To], edge{From: e.To, To: e.From, Class: e.Class, Method: e.Method,
			Line: e.Line, Kind: e.Kind, Via: e.Via})
	}
	found := map[string]*nearby{}
	frontier := make([]string, 0, len(seeds))
	for s := range seeds {
		found[s] = &nearby{Path: s, seeds: map[string]bool{s: true}}
		frontier = append(frontier, s)
	}
	sort.Strings(frontier)
	for h := 1; h <= hops; h++ {
		var next []string
		for _, cur := range frontier {
			origin := found[cur].seeds
			for _, e := range adj[cur] {
				n := found[e.To]
				if n == nil {
					n = &nearby{Path: e.To, Hops: h, seeds: map[string]bool{}}
					found[e.To] = n
					next = append(next, e.To)
				}
				for s := range origin {
					n.seeds[s] = true
				}
				if n.Hops == h {
					n.Edges = append(n.Edges, e)
				}
			}
		}
		sort.Strings(next)
		frontier = next
	}

	// ── EL RANKING: semillas primero, después lo CO-ACTIVADO, después por cercanía.
	//
	// ⚠ RESULTADO NEGATIVO, medido: a 1 salto la co-activación NO DISPARA. Con las 5 semillas de
	// `can_check_preapproval`, a cada uno de los 7 vecinos lo toca UNA sola semilla — el grafo es
	// demasiado ralo (77,8% de los call sites sin resolver) para que compartan vecinos. Recién aparece
	// a 2 saltos, que es donde el vecindario ya no sirve. Queda el criterio porque no cuesta y porque
	// un grafo más denso lo activaría, pero HOY el orden efectivo es semillas → cercanía → ruta.
	list := make([]*nearby, 0, len(found))
	for _, n := range found {
		n.SeedCount = len(n.seeds)
		if newOnly && n.Hops == 0 {
			continue
		}
		if s := g.Files[n.Path]; s == nil || !c.f.matches(s, in, out) {
			continue
		}
		list = append(list, n)
	}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if (a.Hops == 0) != (b.Hops == 0) {
			return a.Hops == 0
		}
		if a.SeedCount != b.SeedCount {
			return a.SeedCount > b.SeedCount
		}
		if a.Hops != b.Hops {
			return a.Hops < b.Hops
		}
		return a.Path < b.Path
	})
	if c.emit(map[string]any{"term": term, "seeds": len(seeds), "neighborhood": list}) {
		return
	}

	fmt.Printf("«%s» en %s:%s — %d semillas, %d más en el vecindario a %d salto(s)\n",
		term, c.alias, branch, len(seeds), len(found)-len(seeds), hops)
	if hops > 1 {
		fmt.Printf("  ⚠ MEDIDO: a 1 salto son 2-39 archivos; a 2 saltos, 198-342. El segundo salto\n" +
			"    arrastra el fan-out del padre (OTP, ecommerce, Experian) y deja de ser un vecindario.\n")
	}
	fmt.Println()
	spent, dropped := 0, 0
	for _, n := range list {
		txt := render(g.Files[n.Path])
		if budget > 0 && spent+len(txt)/4 > budget {
			dropped++
			continue
		}
		spent += len(txt) / 4
		mark := "[GREP]"
		if n.Hops > 0 {
			mark = fmt.Sprintf("[+%d hop]", n.Hops)
			if n.SeedCount > 1 {
				mark = fmt.Sprintf("[+%d hop · CO-ACTIVADO por %d semillas]", n.Hops, n.SeedCount)
			}
		}
		fmt.Printf("%s\n%s", mark, txt)
		for _, e := range n.Edges[:min(len(n.Edges), 3)] {
			fmt.Printf("    ← %s ::%s %s\n", truncate(e.To, 62), e.Method, label(e))
		}
	}
	fmt.Printf("\n  ~%d tokens", spent)
	if dropped > 0 {
		fmt.Printf("  ⚠ %d archivos quedaron FUERA por presupuesto (subí --tokens)", dropped)
	}
	fmt.Println()
}
