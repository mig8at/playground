// cmd_show.go — los comandos que MUESTRAN: listar, esqueletos, métodos, casos.
package main

import (
	"fmt"
	"sort"
	"strings"
)

func cmdFiles(args []string) {
	c := newCtx("files", "listar y filtrar archivos", true)
	c.parse(args)
	g := c.graph()
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
	fmt.Printf("\n  %d archivos · ~%d tokens si pidieras el mapa de todos\n", len(picked), tokens)
}

func cmdMap(args []string) {
	c := newCtx("map", "el esqueleto de lo que pase el filtro. Un argumento suelto = una ruta", true)
	var pathsOnly bool
	var budget int
	c.fs.BoolVar(&pathsOnly, "paths-only", false, "sólo las rutas, sin esqueleto (la línea base barata)")
	c.fs.IntVar(&budget, "tokens", 0, "presupuesto en tokens; al cortar lo DICE (0 = sin tope)")
	rest := c.parse(args)
	g := c.graph()

	// Una ruta exacta como argumento suelto → la vista detallada de ese archivo.
	if len(rest) == 1 {
		p := strings.TrimPrefix(rest[0], c.alias+"/")
		if s := g.Files[p]; s != nil {
			if c.emit(s) {
				return
			}
			showFile(s)
			return
		}
		c.f.prefix = p // no es un archivo: tratalo como prefijo
	}
	picked := c.f.selectFiles(g)
	if len(picked) == 0 {
		die(fmt.Errorf("ningún archivo pasó el filtro"))
	}
	if c.emit(picked) {
		return
	}
	spent, dropped := 0, 0
	for _, s := range picked {
		txt := s.Path + "\n"
		if !pathsOnly {
			txt = render(s)
		}
		if budget > 0 && spent+len(txt)/4 > budget {
			dropped++
			continue
		}
		spent += len(txt) / 4
		fmt.Print(txt)
	}
	fmt.Printf("\n  %d archivos · ~%d tokens", len(picked)-dropped, spent)
	if dropped > 0 {
		// El corte se DICE. Un mapa truncado en silencio se lee como completo.
		fmt.Printf("  ⚠ %d quedaron FUERA por presupuesto (subí --tokens)", dropped)
	}
	fmt.Println()
}

func showFile(s *sourceFile) {
	fmt.Printf("%s   [%s]\n", s.Path, s.Tier)
	if s.Class != "" {
		fmt.Printf("  class     %s", s.Class)
		if s.Extends != "" {
			fmt.Printf("   extends %s", s.Extends)
		}
		fmt.Println()
	}
	if len(s.Traits) > 0 {
		fmt.Printf("  traits    %s\n", strings.Join(s.Traits, ", "))
	}
	if len(s.Implements) > 0 {
		fmt.Printf("  implements %s\n", strings.Join(s.Implements, ", "))
	}
	if len(s.Tables) > 0 {
		fmt.Printf("  tables    %s\n", strings.Join(s.Tables, ", "))
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

// cmdMethods — métodos por nombre. Es lo ÚNICO que una lista de rutas no puede dar, y está medido: en
// la prueba de fuego, la condición «sólo rutas» encontró el archivo correcto en el puesto #1 las dos
// veces y no pudo nombrar el método. Este comando es esa diferencia.
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
	type hit struct {
		Path      string `json:"path"`
		Class     string `json:"class,omitempty"`
		Method    string `json:"method"`
		Signature string `json:"signature"`
		Line      int    `json:"line"`
	}
	var hits []hit
	for _, s := range c.f.selectFiles(c.graph()) {
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

// cmdCases — las reglas de negocio en prosa. Salieron de un hallazgo: la mitad de los tests son Pest,
// que no declara métodos sino casos con una descripción. Un tier que sólo mirara métodos los perdía
// enteros, y son lo único del mapa que dice QUÉ DECIDE el código y no sólo cómo está cableado.
func cmdCases(args []string) {
	c := newCtx("cases", "las reglas de negocio en prosa, de las descripciones de los tests", true)
	rest := c.parse(args)
	needle := c.f.testCase
	if len(rest) > 0 {
		needle = rest[0]
	}
	c.f.testCase = "" // el filtro por archivo no sirve acá: se filtra CASO por CASO
	c.f.withCases = true
	type hit struct {
		Path string `json:"path"`
		Case string `json:"case"`
	}
	var hits []hit
	for _, s := range c.f.selectFiles(c.graph()) {
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
