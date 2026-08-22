// cmd_find.go — EL COMANDO. Un término, y el vecindario de vuelta.
//
// LO QUE APORTA SOBRE UN GREP, que es la única razón para que exista: el archivo que **no matcheó**
// pero está a un salto. Buscando `can_check_preapproval` aparece `ProfilingRulesService`, que no
// contiene el término y es uno de los archivos que un experimento anterior tuvo que rescatar a mano.
// Un grep no puede verlo por construcción.
//
// ⚠ LA EXPANSIÓN EXPLOTA SI NO SE LA ATA. Medido: a 1 salto son 2-39 archivos, todos del vecindario
// real; a 2 saltos, 198-342, con OTP, ecommerce y contadores de Experian adentro — el fan-out del padre
// arrastra el módulo entero. El default es 1 salto y `--hops 2` avisa con esos números en vez de
// bajarlo en silencio.
package main

import (
	"fmt"
	"os"
	"sort"
)

type nearby struct {
	Path      string          `json:"path"`
	Hops      int             `json:"hops"`
	seeds     map[string]bool // qué semillas lo tocan: co-activación
	SeedCount int             `json:"seeded_by"`
	Edges     []edge          `json:"via,omitempty"`
}

func cmdFind(args []string) {
	c := newCtx("find", "un término → los archivos que lo contienen + sus vecinos", true)
	var hops, budget, maxCallers int
	var asRegex, newOnly, pathsOnly bool
	c.fs.IntVar(&hops, "hops", 1, "cuántos saltos expandir (⚠ 2 explota: ver la advertencia)")
	c.fs.IntVar(&budget, "tokens", 25000, "presupuesto de salida; al cortar lo DICE")
	c.fs.IntVar(&maxCallers, "max-callers", 300, "tope de archivos a parsear buscando quién llama")
	c.fs.BoolVar(&asRegex, "regex", false, "tratar el término como regex en vez de texto literal")
	c.fs.BoolVar(&newOnly, "new-only", false, "sólo lo que el grep NO encontró: el aporte del grafo")
	c.fs.BoolVar(&pathsOnly, "paths-only", false, "sólo las rutas, sin esqueletos")
	rest := c.parse(args)
	if len(rest) != 1 {
		die(fmt.Errorf("pasá un término:  demo can_check_preapproval"))
	}
	term := rest[0]

	x := c.explorer()
	defer x.close()

	// ── LA SEMILLA: lo que matcheó el grep.
	hits, err := x.r.grep([]string{term}, !asRegex)
	if err != nil {
		die(err)
	}
	var seeds []*sourceFile
	for _, p := range hits {
		if len(p) >= len(c.ext) && p[len(p)-len(c.ext):] == c.ext {
			if s := x.parse(p); s != nil {
				seeds = append(seeds, s)
			}
		}
	}
	if len(seeds) == 0 {
		fmt.Printf("«%s» no matcheó ningún %s en %s @ %s\n", term, c.ext, x.r.name(), x.r.fuente())
		if len(hits) > 0 {
			fmt.Printf("  (sí matcheó %d archivo(s) de otra extensión: %v)\n",
				len(hits), hits[:min(len(hits), 5)])
		}
		return
	}

	// ── LA EXPANSIÓN: dependencias y llamadores, resueltos sobre el subconjunto cargado.
	g, dropped := x.expand(seeds, maxCallers)
	in, out := g.degrees()

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
	frontier := []string{}
	for _, s := range seeds {
		found[s.Path] = &nearby{Path: s.Path, seeds: map[string]bool{s.Path: true}}
		frontier = append(frontier, s.Path)
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
	// ⚠ RESULTADO NEGATIVO, medido: a 1 salto la co-activación casi no dispara. Con 5 semillas de
	// `can_check_preapproval`, a cada uno de los 7 vecinos lo tocaba UNA sola semilla — el grafo es
	// ralo. Queda el criterio porque no cuesta, pero HOY el orden efectivo es semillas → cercanía.
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
	if c.emit(map[string]any{"term": term, "repo": g.Repo, "source": g.Branch,
		"seeds": len(seeds), "parsed": x.parsed, "neighborhood": list}) {
		return
	}

	fmt.Printf("«%s» en %s @ %s — %d %s, %d más a %d salto(s)   [%d archivos parseados]\n",
		term, g.Repo, g.Branch, len(seeds), plural(len(seeds), "semilla", "semillas"),
		len(found)-len(seeds), hops, x.parsed)
	if hops > 1 {
		fmt.Printf("  ⚠ MEDIDO: a 1 salto son 2-39 archivos; a 2 saltos, 198-342. El segundo salto\n" +
			"    arrastra el fan-out del padre y deja de ser un vecindario.\n")
	}
	if dropped > 0 {
		// El corte se DICE: si no, «éstos son los que lo llaman» sería una afirmación falsa.
		fmt.Fprintf(os.Stderr, "  ⚠ %d candidatos a llamador quedaron sin parsear (--max-callers)\n",
			dropped)
	}
	fmt.Println()
	spent, cut := 0, 0
	for _, n := range list {
		txt := n.Path + "\n"
		if !pathsOnly {
			txt = render(g.Files[n.Path])
		}
		if budget > 0 && spent+len(txt)/4 > budget {
			cut++
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
	if cut > 0 {
		fmt.Printf("  ⚠ %d archivos quedaron FUERA por presupuesto (subí --tokens)", cut)
	}
	fmt.Println()
}
