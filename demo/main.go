// demo — EL MAPA DE CABLEADO: esqueletos en vez de archivos, y aristas resueltas por el código.
//
// LA TESIS QUE PRUEBA. Hoy el lector de `workers` recibe archivos ENTEROS y el techo real está en
// 35-40 antes de que recorte. Medido sobre 4 archivos reales, el esqueleto (sólo firmas) es 7,3x más
// chico —15x en los services de PHP, 3,9x en un .tsx—. Si el esqueleto alcanza para ELEGIR, el mismo
// presupuesto de tokens cubre un orden de magnitud más de código.
//
// LO QUE ESTE MAPA NO CONTESTA, y hay que decirlo antes de que alguien lo use mal: el cableado no es
// el negocio. El grafo dice que `getLenders()` llama a `applyProfilingRules()`; NO dice que
// perfilamiento sólo CLASIFICA mientras el status de la sucursal EXCLUYE — y esa diferencia, que es un
// `continue` contra una asignación dentro de un loop, es la respuesta a casi toda pregunta de soporte.
// El significado vive en `context/`, y este mapa apunta ahí; no lo reemplaza.
//
// Es un ENRUTADOR, no un contestador.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const rama = "main"

func salir(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func rutaGrafo(alias string) string { return filepath.Join(dirBase(), "grafo-"+alias+".json") }

func dirBase() string {
	d, err := os.Executable()
	if err == nil {
		if p := filepath.Dir(d); strings.Contains(p, "demo") {
			return p
		}
	}
	wd, _ := os.Getwd()
	return wd
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println(`demo — mapa de cableado (esqueletos + aristas resueltas)

  demo extraer <alias>          construye el mapa de un repo y lo guarda en grafo-<alias>.json
  demo mapa <alias/ruta>        el ESQUELETO de un archivo: su interfaz, sin cuerpos
  demo vecinos <alias/ruta>     quién lo llama y a quién llama, con la procedencia de cada arista
  demo medir <alias>            los números: compresión y tasa de resolución

  Los alias salen de roots.json (derivado de context/tools/roots.py con  make demo-roots).`)
		return
	}
	switch os.Args[1] {
	case "extraer":
		cmdExtraer()
	case "mapa":
		cmdMapa()
	case "vecinos":
		cmdVecinos()
	case "medir":
		cmdMedir()
	default:
		salir(fmt.Errorf("subcomando desconocido %q", os.Args[1]))
	}
}

func arg(i int, que string) string {
	if len(os.Args) <= i {
		salir(fmt.Errorf("falta %s", que))
	}
	return os.Args[i]
}

func cargarGrafo(alias string) *grafo {
	b, err := os.ReadFile(rutaGrafo(alias))
	if err != nil {
		salir(fmt.Errorf("no hay mapa de %s todavía — corré:  demo extraer %s", alias, alias))
	}
	var g grafo
	if err := json.Unmarshal(b, &g); err != nil {
		salir(err)
	}
	return &g
}

// partir — "alias/relpath" → (alias, relpath). Es la misma llave que usan los map.json de context/.
func partir(s string) (string, string) {
	i := strings.IndexByte(s, '/')
	if i < 0 {
		salir(fmt.Errorf("esperaba alias/ruta, recibí %q", s))
	}
	return s[:i], s[i+1:]
}

func cmdExtraer() {
	alias := arg(2, "el alias del repo")
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

	t0 := time.Now()
	archivos, err := listar(repo, rama, ".php")
	if err != nil {
		salir(err)
	}
	fmt.Printf("%d archivos .php en %s:%s\n", len(archivos), alias, rama)

	blobs := make(chan blob, 256)
	go func() {
		if err := leer(repo, archivos, blobs); err != nil {
			fmt.Fprintln(os.Stderr, "aviso al leer blobs:", err)
		}
	}()

	// Un extractor por goroutine: el parser de tree-sitter no es seguro para compartir.
	g := &grafo{Repo: alias, Rama: rama, Archivos: map[string]*archivo{}, Stats: map[string]int{}}
	var mu sync.Mutex
	var wg sync.WaitGroup
	n := runtime.NumCPU()
	for i := 0; i < n; i++ {
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
	if err := os.WriteFile(rutaGrafo(alias), b, 0o644); err != nil {
		salir(err)
	}
	fmt.Printf("parseado en %s · resuelto y guardado en %s (%.1f MB) · total %s\n",
		tParseo.Round(time.Millisecond), filepath.Base(rutaGrafo(alias)), float64(len(b))/1e6, time.Since(t0).Round(time.Millisecond))
	imprimirStats(g)
}

func imprimirStats(g *grafo) {
	s := g.Stats
	fmt.Printf("\n  archivos %d · métodos %d · aristas %d\n", s["archivos"], contarMetodos(g), s["aristas"])
	llam := s["llamadas"]
	if llam == 0 {
		return
	}
	pct := func(n int) string { return fmt.Sprintf("%5.1f%%", 100*float64(n)/float64(llam)) }
	fmt.Printf("  call sites: %d\n", llam)
	fmt.Printf("    RESUELTAS       %6d  %s\n", s["resueltas"], pct(s["resueltas"]))
	fmt.Printf("      interno       %6d\n", s["interno"]-s["interno_heredado"])
	fmt.Printf("      por propiedad %6d\n", s["prop"]-s["prop_sin_tipo"]-s["prop_fuera"]-s["prop_metodo_heredado"])
	fmt.Printf("      estático      %6d\n", s["estatico"]-s["estatico_fuera"]-s["estatico_metodo_heredado"])
	fmt.Printf("    sin resolver    %6d  %s\n", llam-s["resueltas"], pct(llam-s["resueltas"]))
	fmt.Printf("      libre ($var->x())        %6d   sobre una variable local: haría falta inferir tipos\n", s["libre"])
	fmt.Printf("      heredado/trait           %6d   el método está en el padre — NO se inventa la arista\n",
		s["interno_heredado"]+s["prop_metodo_heredado"]+s["estatico_metodo_heredado"])
	fmt.Printf("      fuera del repo (vendor)  %6d\n", s["prop_fuera"]+s["estatico_fuera"])
	fmt.Printf("      propiedad sin type hint  %6d\n", s["prop_sin_tipo"])
}

func contarMetodos(g *grafo) int {
	n := 0
	for _, a := range g.Archivos {
		n += len(a.Metodos)
	}
	return n
}

func cmdMapa() {
	alias, rel := partir(arg(2, "alias/ruta"))
	g := cargarGrafo(alias)

	// Un archivo exacto → la vista detallada. Un prefijo → EL MAPA DEL MÓDULO, que es la unidad que
	// de verdad se le entrega a un seleccionador: el repo entero nunca fue la unidad correcta.
	if a := g.Archivos[rel]; a != nil {
		detalle(a)
		return
	}
	pref := strings.TrimSuffix(rel, "/") + "/"
	var rutas []string
	for r := range g.Archivos {
		if strings.HasPrefix(r, pref) {
			rutas = append(rutas, r)
		}
	}
	if len(rutas) == 0 {
		salir(fmt.Errorf("%s no es un archivo ni un prefijo con archivos en el mapa de %s", rel, alias))
	}
	sort.Strings(rutas)
	porTier := map[string]int{}
	total := 0
	for _, r := range rutas {
		a := g.Archivos[r]
		txt := renderizar(a)
		fmt.Print(txt)
		total += len(txt)
		porTier[a.Tier]++
	}
	fmt.Printf("\n  %s — %d archivos (codigo %d · test %d · migracion %d) · ~%d tokens de mapa\n",
		pref, len(rutas), porTier[tierCodigo], porTier[tierTest], porTier[tierMigracion], total/4)
}

func detalle(a *archivo) {
	fmt.Printf("%s   [%s]\n", a.Ruta, a.Tier)
	if a.Clase != "" {
		fmt.Printf("  clase   %s", a.Clase)
		if a.Extiende != "" {
			fmt.Printf("  extiende %s", a.Extiende)
		}
		fmt.Println()
	}
	if len(a.Tablas) > 0 {
		fmt.Printf("  tablas  %s\n", strings.Join(a.Tablas, ", "))
	}
	if n := len(a.Props) + len(a.Ctor); n > 0 {
		fmt.Println("  inyecta:")
		claves := make([]string, 0, n)
		tipo := map[string]string{}
		for k, v := range a.Ctor {
			claves = append(claves, k)
			tipo[k] = v + "   (inferido del constructor)"
		}
		for k, v := range a.Props {
			if _, ya := tipo[k]; !ya {
				claves = append(claves, k)
			}
			tipo[k] = v
		}
		sort.Strings(claves)
		for _, k := range claves {
			fmt.Printf("    $%-30s %s\n", k, tipo[k])
		}
	}
	if len(a.Casos) > 0 {
		fmt.Printf("  %d casos:\n", len(a.Casos))
		for _, c := range a.Casos {
			fmt.Printf("    · %s\n", c)
		}
	}
	fmt.Printf("  %d métodos:\n", len(a.Metodos))
	for _, m := range a.Metodos {
		if a.Tier == tierTest {
			fmt.Printf("    %4d  %s\n", m.Linea, m.Nombre)
			continue
		}
		fmt.Printf("    %4d  %s\n", m.Linea, m.Firma)
	}
	fmt.Printf("\n  %d bytes · esqueleto pleno %d · lo que manda su tier %d  →  %.1fx contra el archivo\n",
		a.Bytes, a.BytesPle, a.BytesEsq, float64(a.Bytes)/float64(max(a.BytesEsq, 1)))
}

func cmdVecinos() {
	alias, rel := partir(arg(2, "alias/ruta"))
	g := cargarGrafo(alias)
	if g.Archivos[rel] == nil {
		salir(fmt.Errorf("%s no está en el mapa de %s", rel, alias))
	}
	entran, salen := g.vecinos(rel)
	fmt.Printf("%s\n\n  LO LLAMAN (%d):\n", rel, len(entran))
	for _, e := range entran {
		fmt.Printf("    %-70s :%-5d ::%s  [%s]\n", acortar(e.De), e.Linea, e.Met, e.Como)
	}
	fmt.Printf("\n  LLAMA A (%d):\n", len(salen))
	for _, e := range salen {
		fmt.Printf("    %-70s :%-5d ::%s  [%s]\n", acortar(e.A), e.Linea, e.Met, e.Como)
	}
}

func acortar(s string) string {
	if len(s) <= 70 {
		return s
	}
	return "…" + s[len(s)-69:]
}

func cmdMedir() {
	alias := arg(2, "el alias del repo")
	g := cargarGrafo(alias)
	type acc struct{ n, full, pleno, tier int }
	por := map[string]*acc{}
	t := &acc{}
	for _, a := range g.Archivos {
		p := por[a.Tier]
		if p == nil {
			p = &acc{}
			por[a.Tier] = p
		}
		p.n++
		p.full += a.Bytes
		p.pleno += a.BytesPle
		p.tier += a.BytesEsq
		t.n++
		t.full += a.Bytes
		t.pleno += a.BytesPle
		t.tier += a.BytesEsq
	}
	fmt.Printf("%s:%s\n\n", g.Repo, g.Rama)
	fmt.Printf("  %-11s %6s %14s %14s %14s\n", "tier", "arch", "completos", "esq. pleno", "SU TIER")
	fmt.Println("  " + strings.Repeat("-", 62))
	for _, k := range []string{tierCodigo, tierTest, tierMigracion} {
		p := por[k]
		if p == nil {
			continue
		}
		fmt.Printf("  %-11s %6d %14d %14d %14d\n", k, p.n, p.full/4, p.pleno/4, p.tier/4)
	}
	fmt.Println("  " + strings.Repeat("-", 62))
	fmt.Printf("  %-11s %6d %14d %14d %14d\n", "TOTAL", t.n, t.full/4, t.pleno/4, t.tier/4)
	fmt.Printf("\n  el repo completo:      ~%d tokens\n", t.full/4)
	fmt.Printf("  esqueleto pleno:       ~%d tokens   (%.1fx)\n", t.pleno/4, float64(t.full)/float64(max(t.pleno, 1)))
	fmt.Printf("  ESCALONADO:            ~%d tokens   (%.1fx)  — %d menos que el pleno\n",
		t.tier/4, float64(t.full)/float64(max(t.tier, 1)), (t.pleno-t.tier)/4)
	imprimirStats(g)
}
