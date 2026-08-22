// cmd_show.go — mostrar: el detalle de un archivo, listados, métodos, casos, y los números.
//
// ⚠ QUÉ COMANDO CUESTA QUÉ. `show <ruta>` parsea UN archivo. Los que listan o cuentan sobre todo el
// repo (`files`, `methods`, `cases`, `measure`, `edges`) parsean todo — ~0,5 s en 2.500 archivos — y lo
// avisan por stderr. La distinción importa: sólo los segundos pueden afirmar algo sobre el conjunto.
package main

import (
	"fmt"
	"sort"
	"strings"
)

func cmdShow(args []string) {
	c := newCtx("show", "el detalle de UN archivo, o el esqueleto de lo que pase el filtro", true)
	var pathsOnly bool
	var budget int
	c.fs.BoolVar(&pathsOnly, "paths-only", false, "sólo las rutas, sin esqueleto")
	c.fs.IntVar(&budget, "tokens", 0, "presupuesto en tokens; al cortar lo DICE (0 = sin tope)")
	rest := c.parse(args)

	// Una ruta concreta: se parsea SOLA. No hace falta el repo entero para mirar un archivo.
	if len(rest) == 1 {
		x := c.explorer()
		defer x.close()
		if s := x.parse(rest[0]); s != nil {
			if c.emit(s) {
				return
			}
			showFile(s)
			return
		}
		c.f.prefix = rest[0] // no es un archivo legible: tratalo como prefijo
	}
	_, g := c.whole()
	picked := c.f.selectFiles(g)
	if len(picked) == 0 {
		die(fmt.Errorf("ningún archivo pasó el filtro"))
	}
	if c.emit(picked) {
		return
	}
	spent, cut := 0, 0
	for _, s := range picked {
		txt := s.Path + "\n"
		if !pathsOnly {
			txt = render(s)
		}
		if budget > 0 && spent+len(txt)/4 > budget {
			cut++
			continue
		}
		spent += len(txt) / 4
		fmt.Print(txt)
	}
	fmt.Printf("\n  %d archivos · ~%d tokens", len(picked)-cut, spent)
	if cut > 0 {
		// El corte se DICE. Un mapa truncado en silencio se lee como completo.
		fmt.Printf("  ⚠ %d quedaron FUERA por presupuesto (subí --tokens)", cut)
	}
	fmt.Println()
}

func showFile(s *sourceFile) {
	fmt.Printf("%s   [%s]\n", s.Path, s.Tier)
	if s.Class != "" {
		fmt.Printf("  class      %s", s.Class)
		if s.Extends != "" {
			fmt.Printf("   extends %s", s.Extends)
		}
		fmt.Println()
	}
	if len(s.Traits) > 0 {
		fmt.Printf("  traits     %s\n", strings.Join(s.Traits, ", "))
	}
	if len(s.Implements) > 0 {
		fmt.Printf("  implements %s\n", strings.Join(s.Implements, ", "))
	}
	if len(s.Tables) > 0 {
		fmt.Printf("  tables     %s\n", strings.Join(s.Tables, ", "))
	}
	if n := len(s.Props) + len(s.CtorProps); n > 0 {
		fmt.Println("  injects:")
		typ := map[string]string{}
		for k, v := range s.CtorProps {
			typ[k] = v + "   (inferido del constructor)"
		}
		for k, v := range s.Props {
			typ[k] = v
		}
		keys := make([]string, 0, len(typ))
		for k := range typ {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			fmt.Printf("    $%-30s %s\n", k, typ[k])
		}
	}
	if len(s.Cases) > 0 {
		fmt.Printf("  %d cases:\n", len(s.Cases))
		for _, x := range s.Cases {
			fmt.Printf("    · %s\n", x)
		}
	}
	fmt.Printf("  %d methods:\n", len(s.Methods))
	for _, m := range s.Methods {
		if s.Tier == tierTest {
			fmt.Printf("    %4d  %s\n", m.Line, m.Name)
			continue
		}
		fmt.Printf("    %4d  %s\n", m.Line, m.Signature)
	}
	fmt.Printf("\n  %d bytes · esqueleto pleno %d · lo que manda su tier %d  →  %.1fx\n",
		s.Bytes, s.BytesFull, s.BytesTier, float64(s.Bytes)/float64(max(s.BytesTier, 1)))
}

func cmdFiles(args []string) {
	c := newCtx("files", "listar y filtrar archivos del repo", true)
	c.parse(args)
	_, g := c.whole()
	in, out := g.degrees()
	picked := c.f.selectFiles(g)
	if c.asJSON {
		type row struct {
			Path    string `json:"path"`
			Tier    string `json:"tier"`
			Class   string `json:"class,omitempty"`
			Methods int    `json:"methods"`
			Cases   int    `json:"cases,omitempty"`
			In      int    `json:"in"`
			Out     int    `json:"out"`
			Tokens  int    `json:"tokens"`
		}
		rows := make([]row, 0, len(picked))
		for _, s := range picked {
			rows = append(rows, row{s.Path, s.Tier, s.Class, len(s.Methods), len(s.Cases),
				in[s.Path], out[s.Path], s.BytesTier / 4})
		}
		c.emit(rows)
		return
	}
	fmt.Printf("  %-10s %4s %5s %4s %5s  %s\n", "tier", "mét", "casos", "←", "→", "ruta")
	tokens := 0
	for _, s := range picked {
		tokens += s.BytesTier / 4
		cases := ""
		if len(s.Cases) > 0 {
			cases = fmt.Sprint(len(s.Cases))
		}
		fmt.Printf("  %-10s %4d %5s %4d %5d  %s\n", s.Tier, len(s.Methods), cases,
			in[s.Path], out[s.Path], s.Path)
	}
	fmt.Printf("\n  %d archivos · ~%d tokens si pidieras el esqueleto de todos\n", len(picked), tokens)
}

// cmdMethods — métodos por nombre. Es lo ÚNICO que una lista de rutas no puede dar, y está medido: en
// un experimento anterior, la condición «sólo rutas» encontró el archivo correcto en el puesto #1 las
// dos veces y no pudo nombrar el método. Este comando es esa diferencia.
func cmdMethods(args []string) {
	c := newCtx("methods", "métodos por nombre en todo el repo", true)
	rest := c.parse(args)
	if len(rest) == 0 && c.f.method == "" {
		die(fmt.Errorf("pasá un nombre de método (o parte):  demo methods recalcul"))
	}
	needle := c.f.method
	if len(rest) > 0 {
		needle = rest[0]
	}
	c.f.method = needle
	_, g := c.whole()
	type hit struct {
		Path      string `json:"path"`
		Class     string `json:"class,omitempty"`
		Method    string `json:"method"`
		Signature string `json:"signature"`
		Line      int    `json:"line"`
	}
	var hits []hit
	for _, s := range c.f.selectFiles(g) {
		for _, m := range s.Methods {
			if hasFold(m.Name, needle) {
				hits = append(hits, hit{s.Path, s.Class, m.Name, m.Signature, m.Line})
			}
		}
	}
	if c.emit(hits) {
		return
	}
	for _, h := range hits {
		fmt.Printf("%s:%d\n    %s\n", h.Path, h.Line, h.Signature)
	}
	fmt.Printf("\n  %d métodos matchean «%s»\n", len(hits), needle)
}

// cmdCases — las reglas de negocio en prosa. Salieron de un hallazgo: la mitad de los tests de este
// repo son Pest, que no declara métodos sino casos con una descripción. Un tier que sólo mirara métodos
// los perdía enteros, y son lo único del mapa que dice QUÉ DECIDE el código y no sólo cómo se cablea.
func cmdCases(args []string) {
	c := newCtx("cases", "las reglas de negocio en prosa, de las descripciones de los tests", true)
	rest := c.parse(args)
	needle := c.f.testCase
	if len(rest) > 0 {
		needle = rest[0]
	}
	c.f.testCase = "" // el filtro por archivo no sirve acá: se filtra CASO por CASO
	c.f.withCases = true
	_, g := c.whole()
	type hit struct {
		Path string `json:"path"`
		Case string `json:"case"`
	}
	var hits []hit
	for _, s := range c.f.selectFiles(g) {
		for _, x := range s.Cases {
			if hasFold(x, needle) {
				hits = append(hits, hit{s.Path, x})
			}
		}
	}
	if c.emit(hits) {
		return
	}
	last := ""
	for _, h := range hits {
		if h.Path != last {
			fmt.Printf("\n%s\n", h.Path)
			last = h.Path
		}
		fmt.Printf("  · %s\n", h.Case)
	}
	fmt.Printf("\n  %d casos", len(hits))
	if needle != "" {
		fmt.Printf(" matchean «%s»", needle)
	}
	fmt.Println()
}

func cmdMeasure(args []string) {
	c := newCtx("measure", "los números del repo", true)
	c.parse(args)
	_, g := c.whole()
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
	fmt.Printf("%s @ %s   (%d archivos tras el filtro)\n\n", g.Repo, g.Branch, len(picked))
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
	fmt.Printf("      método no hallado        %6d   la jerarquía sale del repo\n", s["not_found"])
	fmt.Printf("      fuera del repo (vendor)  %6d\n", s["outside_repo"])
	fmt.Printf("      propiedad sin type hint  %6d\n", s["untyped"])
	fmt.Printf("\n  ⚠ el grafo es PARCIAL: `--orphan` significa «nadie lo llama SEGÚN ESTE MAPA», no\n")
	fmt.Printf("    «código muerto». Con %s de los call sites sin resolver, no alcanza para afirmarlo.\n",
		pct(calls-s["resolved"]))
}
