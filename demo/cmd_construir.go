// cmd_construir.go — construir el mapa y medirlo.
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

func cmdExtraer(args []string) {
	c := nuevoCtx("extraer", "construye el mapa del repo leyendo `main`", false)
	c.parsear(args)
	repo := repoDe(c.alias)

	t0 := time.Now()
	archivos, err := listar(repo, rama, ".php")
	if err != nil {
		salir(err)
	}
	fmt.Printf("%d archivos .php en %s:%s\n", len(archivos), c.alias, rama)

	blobs := make(chan blob, 256)
	go func() {
		if err := leer(repo, archivos, blobs); err != nil {
			fmt.Fprintln(os.Stderr, "aviso al leer blobs:", err)
		}
	}()

	// Un extractor por goroutine: el parser de tree-sitter no es seguro para compartir.
	g := &grafo{Repo: c.alias, Rama: rama, Archivos: map[string]*archivo{}, Stats: map[string]int{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < runtime.NumCPU(); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := nuevoExtractor()
			defer e.cerrar()
			for b := range blobs {
				a := e.extraer(b.Ruta, b.Src)
				mu.Lock()
				g.Archivos[a.Ruta] = a
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	tParseo := time.Since(t0)

	g.resolver()
	g.Stats["archivos"] = len(g.Archivos)
	g.Stats["aristas"] = len(g.Aristas)

	b, err := json.Marshal(g)
	if err != nil {
		salir(err)
	}
	if err := os.WriteFile(rutaGrafo(c.alias), b, 0o644); err != nil {
		salir(err)
	}
	fmt.Printf("parseado en %s · resuelto y guardado en %s (%.1f MB) · total %s\n",
		tParseo.Round(time.Millisecond), filepath.Base(rutaGrafo(c.alias)),
		float64(len(b))/1e6, time.Since(t0).Round(time.Millisecond))
	imprimirStats(g)
}

func cmdMedir(args []string) {
	c := nuevoCtx("medir", "los números del mapa", true)
	c.parsear(args)
	g := c.grafo()
	sel := c.f.seleccionar(g)

	type acc struct{ N, Full, Pleno, Tier int }
	por := map[string]*acc{}
	t := &acc{}
	for _, a := range sel {
		p := por[a.Tier]
		if p == nil {
			p = &acc{}
			por[a.Tier] = p
		}
		for _, x := range []*acc{p, t} {
			x.N++
			x.Full += a.Bytes
			x.Pleno += a.BytesPle
			x.Tier += a.BytesEsq
		}
	}
	if c.emitir(map[string]any{"por_tier": por, "total": t, "stats": g.Stats}) {
		return
	}
	fmt.Printf("%s:%s   (%d archivos tras el filtro)\n\n", g.Repo, g.Rama, len(sel))
	fmt.Printf("  %-11s %6s %14s %14s %14s\n", "tier", "arch", "completos", "esq. pleno", "SU TIER")
	fmt.Println("  " + strings.Repeat("-", 62))
	for _, k := range []string{tierCodigo, tierTest, tierMigracion} {
		if p := por[k]; p != nil {
			fmt.Printf("  %-11s %6d %14d %14d %14d\n", k, p.N, p.Full/4, p.Pleno/4, p.Tier/4)
		}
	}
	fmt.Println("  " + strings.Repeat("-", 62))
	fmt.Printf("  %-11s %6d %14d %14d %14d\n", "TOTAL", t.N, t.Full/4, t.Pleno/4, t.Tier/4)
	fmt.Printf("\n  completos ~%d tok  ·  esqueleto pleno ~%d (%.1fx)  ·  ESCALONADO ~%d (%.1fx)\n",
		t.Full/4, t.Pleno/4, float64(t.Full)/float64(max(t.Pleno, 1)),
		t.Tier/4, float64(t.Full)/float64(max(t.Tier, 1)))
	if len(sel) == len(g.Archivos) {
		imprimirStats(g)
	}
}

func imprimirStats(g *grafo) {
	s := g.Stats
	nm := 0
	for _, a := range g.Archivos {
		nm += len(a.Metodos)
	}
	fmt.Printf("\n  archivos %d · métodos %d · aristas %d\n", s["archivos"], nm, s["aristas"])
	llam := s["llamadas"]
	if llam == 0 {
		return
	}
	pct := func(n int) string { return fmt.Sprintf("%5.1f%%", 100*float64(n)/float64(llam)) }
	fmt.Printf("  call sites: %d\n", llam)
	fmt.Printf("    RESUELTAS       %6d  %s\n", s["resueltas"], pct(s["resueltas"]))
	fmt.Printf("      interno %d · prop %d · ctor %d · estatico %d\n",
		s["como_interno"], s["como_prop"], s["como_ctor"], s["como_estatico"])
	fmt.Printf("      de esas, halladas SUBIENDO la jerarquía: %d\n", s["por_jerarquia"])
	fmt.Printf("    sin resolver    %6d  %s\n", llam-s["resueltas"], pct(llam-s["resueltas"]))
	fmt.Printf("      libre ($var->x())        %6d   haría falta inferir tipos\n", s["libre"])
	fmt.Printf("      método no hallado        %6d   la jerarquía llega a una base de Laravel\n", s["no_hallado"])
	fmt.Printf("      fuera del repo (vendor)  %6d\n", s["fuera_del_repo"])
	fmt.Printf("      propiedad sin type hint  %6d\n", s["sin_tipo"])
	fmt.Printf("\n  ⚠ el grafo es PARCIAL: `--huerfano` significa «nadie lo llama SEGÚN ESTE MAPA», no\n")
	fmt.Printf("    «código muerto». Con %s de los call sites sin resolver, no alcanza para afirmarlo.\n",
		pct(llam-s["resueltas"]))
}
