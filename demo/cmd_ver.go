// cmd_ver.go — los comandos que MUESTRAN: listar, esqueletos, métodos, casos.
package main

import (
	"fmt"
	"sort"
	"strings"
)

func cmdArchivos(args []string) {
	c := nuevoCtx("archivos", "listar y filtrar archivos", true)
	c.parsear(args)
	g := c.grafo()
	entran, salen := g.grado()
	sel := c.f.seleccionar(g)
	if c.json {
		type fila struct {
			Ruta    string `json:"ruta"`
			Tier    string `json:"tier"`
			Clase   string `json:"clase,omitempty"`
			Metodos int    `json:"metodos"`
			Casos   int    `json:"casos,omitempty"`
			Entran  int    `json:"entran"`
			Salen   int    `json:"salen"`
			Tokens  int    `json:"tokens"`
		}
		out := make([]fila, 0, len(sel))
		for _, a := range sel {
			out = append(out, fila{a.Ruta, a.Tier, a.Clase, len(a.Metodos), len(a.Casos),
				entran[a.Ruta], salen[a.Ruta], a.BytesEsq / 4})
		}
		c.emitir(out)
		return
	}
	fmt.Printf("  %-9s %4s %5s %4s %5s  %s\n", "tier", "mét", "casos", "←", "→", "ruta")
	tot := 0
	for _, a := range sel {
		tot += a.BytesEsq / 4
		casos := ""
		if len(a.Casos) > 0 {
			casos = fmt.Sprint(len(a.Casos))
		}
		fmt.Printf("  %-9s %4d %5s %4d %5d  %s\n", a.Tier, len(a.Metodos), casos,
			entran[a.Ruta], salen[a.Ruta], a.Ruta)
	}
	fmt.Printf("\n  %d archivos · ~%d tokens si pidieras el mapa de todos\n", len(sel), tot)
}

func cmdMapa(args []string) {
	c := nuevoCtx("mapa", "el esqueleto de lo que pase el filtro. Un argumento suelto = una ruta", true)
	var soloRutas bool
	var presupuesto int
	c.fs.BoolVar(&soloRutas, "solo-rutas", false, "sólo las rutas, sin esqueleto (la línea base barata)")
	c.fs.IntVar(&presupuesto, "tokens", 0, "presupuesto en tokens; al cortar lo DICE (0 = sin tope)")
	resto := c.parsear(args)
	g := c.grafo()

	// Una ruta exacta como argumento suelto → la vista detallada de ese archivo.
	if len(resto) == 1 {
		rel := strings.TrimPrefix(resto[0], c.alias+"/")
		if a := g.Archivos[rel]; a != nil {
			if c.emitir(a) {
				return
			}
			detalle(a)
			return
		}
		c.f.prefijo = rel // no es un archivo: tratalo como prefijo
	}
	sel := c.f.seleccionar(g)
	if len(sel) == 0 {
		salir(fmt.Errorf("ningún archivo pasó el filtro"))
	}
	if c.emitir(sel) {
		return
	}
	gastado, cortados := 0, 0
	for _, a := range sel {
		txt := a.Ruta + "\n"
		if !soloRutas {
			txt = renderizar(a)
		}
		if presupuesto > 0 && gastado+len(txt)/4 > presupuesto {
			cortados++
			continue
		}
		gastado += len(txt) / 4
		fmt.Print(txt)
	}
	fmt.Printf("\n  %d archivos · ~%d tokens", len(sel)-cortados, gastado)
	if cortados > 0 {
		// El corte se DICE. Un mapa truncado en silencio se lee como completo.
		fmt.Printf("  ⚠ %d quedaron FUERA por presupuesto (subí --tokens)", cortados)
	}
	fmt.Println()
}

func detalle(a *archivo) {
	fmt.Printf("%s   [%s]\n", a.Ruta, a.Tier)
	if a.Clase != "" {
		fmt.Printf("  clase   %s", a.Clase)
		if a.Extiende != "" {
			fmt.Printf("   extiende %s", a.Extiende)
		}
		fmt.Println()
	}
	if len(a.Traits) > 0 {
		fmt.Printf("  traits  %s\n", strings.Join(a.Traits, ", "))
	}
	if len(a.Implementa) > 0 {
		fmt.Printf("  implem. %s\n", strings.Join(a.Implementa, ", "))
	}
	if len(a.Tablas) > 0 {
		fmt.Printf("  tablas  %s\n", strings.Join(a.Tablas, ", "))
	}
	if n := len(a.Props) + len(a.Ctor); n > 0 {
		fmt.Println("  inyecta:")
		tipo := map[string]string{}
		for k, v := range a.Ctor {
			tipo[k] = v + "   (inferido del constructor)"
		}
		for k, v := range a.Props {
			tipo[k] = v
		}
		claves := make([]string, 0, len(tipo))
		for k := range tipo {
			claves = append(claves, k)
		}
		sort.Strings(claves)
		for _, k := range claves {
			fmt.Printf("    $%-30s %s\n", k, tipo[k])
		}
	}
	if len(a.Casos) > 0 {
		fmt.Printf("  %d casos:\n", len(a.Casos))
		for _, x := range a.Casos {
			fmt.Printf("    · %s\n", x)
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
	fmt.Printf("\n  %d bytes · esqueleto pleno %d · lo que manda su tier %d  →  %.1fx\n",
		a.Bytes, a.BytesPle, a.BytesEsq, float64(a.Bytes)/float64(max(a.BytesEsq, 1)))
}

// cmdBuscar — métodos por nombre. Es lo ÚNICO que una lista de rutas no puede dar, y está medido:
// en la prueba de fuego, la condición «sólo rutas» encontró el archivo correcto en el puesto #1 las
// dos veces y no pudo nombrar el método. Este comando es esa diferencia.
func cmdBuscar(args []string) {
	c := nuevoCtx("buscar", "métodos por nombre en todo el repo", true)
	resto := c.parsear(args)
	if len(resto) == 0 && c.f.metodo == "" {
		salir(fmt.Errorf("pasá un nombre de método (o parte):  demo buscar recalcul"))
	}
	aguja := c.f.metodo
	if len(resto) > 0 {
		aguja = resto[0]
	}
	c.f.metodo = aguja
	type hit struct {
		Ruta  string `json:"ruta"`
		Clase string `json:"clase,omitempty"`
		Met   string `json:"metodo"`
		Firma string `json:"firma"`
		Linea int    `json:"linea"`
	}
	var out []hit
	for _, a := range c.f.seleccionar(c.grafo()) {
		for _, m := range a.Metodos {
			if contiene(m.Nombre, aguja) {
				out = append(out, hit{a.Ruta, a.Clase, m.Nombre, m.Firma, m.Linea})
			}
		}
	}
	if c.emitir(out) {
		return
	}
	for _, h := range out {
		fmt.Printf("%s:%d\n    %s\n", h.Ruta, h.Linea, h.Firma)
	}
	fmt.Printf("\n  %d métodos matchean «%s»\n", len(out), aguja)
}

// cmdCasos — las reglas de negocio en prosa. Salieron de un hallazgo: la mitad de los tests son Pest,
// que no declara métodos sino casos con una descripción. Un tier que sólo mirara métodos los perdía
// enteros, y son lo único del mapa que dice QUÉ DECIDE el código y no sólo cómo está cableado.
func cmdCasos(args []string) {
	c := nuevoCtx("casos", "las reglas de negocio en prosa, de las descripciones de los tests", true)
	resto := c.parsear(args)
	aguja := c.f.caso
	if len(resto) > 0 {
		aguja = resto[0]
	}
	c.f.caso = "" // el filtro por archivo no sirve acá: se filtra CASO por CASO
	c.f.conCasos = true
	type hit struct {
		Ruta string `json:"ruta"`
		Caso string `json:"caso"`
	}
	var out []hit
	for _, a := range c.f.seleccionar(c.grafo()) {
		for _, x := range a.Casos {
			if contiene(x, aguja) {
				out = append(out, hit{a.Ruta, x})
			}
		}
	}
	if c.emitir(out) {
		return
	}
	ult := ""
	for _, h := range out {
		if h.Ruta != ult {
			fmt.Printf("\n%s\n", h.Ruta)
			ult = h.Ruta
		}
		fmt.Printf("  · %s\n", h.Caso)
	}
	fmt.Printf("\n  %d casos", len(out))
	if aguja != "" {
		fmt.Printf(" matchean «%s»", aguja)
	}
	fmt.Println()
}
