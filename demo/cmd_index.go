// cmd_index.go — construir el mapa y medirlo.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

func cmdIndex(args []string) {
	c := newCtx("index", "construye el mapa del repo leyendo `main`", false)
	c.parse(args)
	repo := repoFor(c.alias)

	start := time.Now()
	files, err := listFiles(repo, branch, ".php")
	if err != nil {
		die(err)
	}
	fmt.Printf("%d archivos .php en %s:%s\n", len(files), c.alias, branch)

	blobs := make(chan blob, 256)
	go func() {
		if err := readBlobs(repo, files, blobs); err != nil {
			fmt.Fprintln(os.Stderr, "aviso al leer blobs:", err)
		}
	}()

	// Un extractor por goroutine: el parser de tree-sitter no es seguro para compartir.
	g := &graph{Repo: c.alias, Branch: branch, Files: map[string]*sourceFile{}, Stats: map[string]int{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := newExtractor()
			defer e.close()
			for b := range blobs {
				s := e.extract(b.Path, b.Src)
				mu.Lock()
				g.Files[s.Path] = s
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	parsed := time.Since(start)

	g.resolve()
	g.Stats["files"] = len(g.Files)
	g.Stats["edges"] = len(g.Edges)

	b, err := json.Marshal(g)
	if err != nil {
		die(err)
	}
	if err := os.WriteFile(graphPath(c.alias), b, 0o644); err != nil {
		die(err)
	}
	fmt.Printf("parseado en %s · resuelto y guardado en %s (%.1f MB) · total %s\n",
		parsed.Round(time.Millisecond), filepath.Base(graphPath(c.alias)),
		float64(len(b))/1e6, time.Since(start).Round(time.Millisecond))
	printStats(g)
}

func cmdMeasure(args []string) {
	c := newCtx("measure", "los números del mapa", true)
	c.parse(args)
	g := c.graph()
	picked := c.f.selectFiles(g)

	type acc struct{ Files, Full, Skeleton, Tier int }
	byTier := map[string]*acc{}
	total := &acc{}
	for _, s := range picked {
		t := byTier[s.Tier]
		if t == nil {
			t = &acc{}
			byTier[s.Tier] = t
		}
		for _, x := range []*acc{t, total} {
			x.Files++
			x.Full += s.Bytes
			x.Skeleton += s.BytesFull
			x.Tier += s.BytesTier
		}
	}
	if c.emit(map[string]any{"by_tier": byTier, "total": total, "stats": g.Stats}) {
		return
	}
	fmt.Printf("%s:%s   (%d archivos tras el filtro)\n\n", g.Repo, g.Branch, len(picked))
	fmt.Printf("  %-11s %6s %14s %14s %14s\n", "tier", "arch", "completos", "esq. pleno", "SU TIER")
	fmt.Println("  " + strings.Repeat("-", 62))
	for _, k := range []string{tierCode, tierTest, tierMigration} {
		if t := byTier[k]; t != nil {
			fmt.Printf("  %-11s %6d %14d %14d %14d\n", k, t.Files, t.Full/4, t.Skeleton/4, t.Tier/4)
		}
	}
	fmt.Println("  " + strings.Repeat("-", 62))
	fmt.Printf("  %-11s %6d %14d %14d %14d\n", "TOTAL", total.Files, total.Full/4,
		total.Skeleton/4, total.Tier/4)
	fmt.Printf("\n  completos ~%d tok  ·  esqueleto pleno ~%d (%.1fx)  ·  ESCALONADO ~%d (%.1fx)\n",
		total.Full/4, total.Skeleton/4, float64(total.Full)/float64(max(total.Skeleton, 1)),
		total.Tier/4, float64(total.Full)/float64(max(total.Tier, 1)))
	if len(picked) == len(g.Files) {
		printStats(g)
	}
}

func printStats(g *graph) {
	s := g.Stats
	methods := 0
	for _, f := range g.Files {
		methods += len(f.Methods)
	}
	fmt.Printf("\n  archivos %d · métodos %d · aristas %d\n", s["files"], methods, s["edges"])
	calls := s["calls"]
	if calls == 0 {
		return
	}
	pct := func(n int) string { return fmt.Sprintf("%5.1f%%", 100*float64(n)/float64(calls)) }
	fmt.Printf("  call sites: %d\n", calls)
	fmt.Printf("    RESUELTAS       %6d  %s\n", s["resolved"], pct(s["resolved"]))
	fmt.Printf("      self %d · prop %d · ctor %d · static %d\n",
		s["kind_self"], s["kind_prop"], s["kind_ctor"], s["kind_static"])
	fmt.Printf("      de esas, halladas SUBIENDO la jerarquía: %d\n", s["by_hierarchy"])
	fmt.Printf("    sin resolver    %6d  %s\n", calls-s["resolved"], pct(calls-s["resolved"]))
	fmt.Printf("      free ($var->x())         %6d   haría falta inferir tipos\n", s["free"])
	fmt.Printf("      método no hallado        %6d   la jerarquía llega a una base de Laravel\n", s["not_found"])
	fmt.Printf("      fuera del repo (vendor)  %6d\n", s["outside_repo"])
	fmt.Printf("      propiedad sin type hint  %6d\n", s["untyped"])
	fmt.Printf("\n  ⚠ el grafo es PARCIAL: `--orphan` significa «nadie lo llama SEGÚN ESTE MAPA», no\n")
	fmt.Printf("    «código muerto». Con %s de los call sites sin resolver, no alcanza para afirmarlo.\n",
		pct(calls-s["resolved"]))
}
