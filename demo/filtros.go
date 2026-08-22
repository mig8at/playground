// filtros.go — EL MOTOR DE FILTROS. Un solo predicado que todos los subcomandos comparten.
//
// POR QUÉ ACÁ Y NO EN CADA COMANDO. Si cada subcomando arma su propio filtrado, `--tier test` empieza
// a significar cosas distintas según dónde lo pongas, y eso no falla: devuelve otra cosa. Acá el
// filtro es UNO y los comandos sólo eligen qué mostrar de lo que pasó el colador. Así `--prefijo` y
// `--tabla` componen igual en `archivos`, en `mapa` y en `metodos` sin escribirlo tres veces.
package main

import (
	"flag"
	"sort"
	"strings"
)

type filtro struct {
	prefijo    string
	tier       string
	clase      string
	extiende   string
	trait      string
	implementa string
	usa        string
	metodo     string
	tabla      string
	caso       string
	conCasos   bool
	huerfano   bool
	hoja       bool
	minMet     int
	maxMet     int
	ordenar    string
	tope       int
}

func (f *filtro) registrar(fs *flag.FlagSet) {
	fs.StringVar(&f.prefijo, "prefijo", "", "la ruta empieza con esto (un módulo, una carpeta)")
	fs.StringVar(&f.tier, "tier", "", "codigo | test | migracion")
	fs.StringVar(&f.clase, "clase", "", "el nombre de la clase contiene esto")
	fs.StringVar(&f.extiende, "extiende", "", "hereda de esta clase")
	fs.StringVar(&f.trait, "trait", "", "usa este trait")
	fs.StringVar(&f.implementa, "implementa", "", "implementa esta interfaz")
	fs.StringVar(&f.usa, "usa", "", "importa esta clase")
	fs.StringVar(&f.metodo, "metodo", "", "tiene un método cuyo nombre contiene esto")
	fs.StringVar(&f.tabla, "tabla", "", "toca esta tabla (hoy: sólo migraciones)")
	fs.StringVar(&f.caso, "caso", "", "algún caso de test cuya descripción contiene esto")
	fs.BoolVar(&f.conCasos, "con-casos", false, "sólo archivos con casos de test descritos en prosa")
	fs.BoolVar(&f.huerfano, "huerfano", false, "nadie lo llama (⚠ el grafo es parcial: ver `medir`)")
	fs.BoolVar(&f.hoja, "hoja", false, "no llama a nadie del repo")
	fs.IntVar(&f.minMet, "min-metodos", 0, "al menos N métodos")
	fs.IntVar(&f.maxMet, "max-metodos", 0, "a lo sumo N métodos (0 = sin tope)")
	fs.StringVar(&f.ordenar, "ordenar", "ruta", "ruta | tokens | metodos | entradas | salidas")
	fs.IntVar(&f.tope, "tope", 0, "cortar a N resultados (0 = todos)")
}

func contiene(h, n string) bool {
	return n == "" || strings.Contains(strings.ToLower(h), strings.ToLower(n))
}

func algunoContiene(hs []string, n string) bool {
	if n == "" {
		return true
	}
	for _, h := range hs {
		if contiene(h, n) {
			return true
		}
	}
	return false
}

// grado — cuántas aristas entran y salen de cada archivo. Se calcula una vez por corrida: los
// filtros `--huerfano`/`--hoja` y el orden por grado lo necesitan para TODOS los archivos, así que
// hacerlo por archivo sería cuadrático sobre 11.000 aristas.
func (g *grafo) grado() (entran, salen map[string]int) {
	entran, salen = map[string]int{}, map[string]int{}
	for _, e := range g.Aristas {
		if e.De == e.A {
			continue
		}
		entran[e.A]++
		salen[e.De]++
	}
	return
}

func (f *filtro) aplica(a *archivo, entran, salen map[string]int) bool {
	switch {
	case f.prefijo != "" && !strings.HasPrefix(a.Ruta, f.prefijo):
		return false
	case f.tier != "" && a.Tier != f.tier:
		return false
	case !contiene(a.Clase, f.clase):
		return false
	case !contiene(a.Extiende, f.extiende):
		return false
	case !algunoContiene(a.Traits, f.trait):
		return false
	case !algunoContiene(a.Implementa, f.implementa):
		return false
	case !algunoContiene(a.Tablas, f.tabla):
		return false
	case !algunoContiene(a.Casos, f.caso):
		return false
	case f.conCasos && len(a.Casos) == 0:
		return false
	case f.huerfano && entran[a.Ruta] > 0:
		return false
	case f.hoja && salen[a.Ruta] > 0:
		return false
	case len(a.Metodos) < f.minMet:
		return false
	case f.maxMet > 0 && len(a.Metodos) > f.maxMet:
		return false
	}
	if f.usa != "" {
		hay := false
		for corto, fq := range a.Usa {
			if contiene(corto, f.usa) || contiene(fq, f.usa) {
				hay = true
				break
			}
		}
		if !hay {
			return false
		}
	}
	if f.metodo != "" {
		hay := false
		for _, m := range a.Metodos {
			if contiene(m.Nombre, f.metodo) {
				hay = true
				break
			}
		}
		if !hay {
			return false
		}
	}
	return true
}

// seleccionar — los archivos que pasan el filtro, ordenados y recortados.
func (f *filtro) seleccionar(g *grafo) []*archivo {
	entran, salen := g.grado()
	var out []*archivo
	for _, a := range g.Archivos {
		if f.aplica(a, entran, salen) {
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		switch f.ordenar {
		case "tokens":
			if a.BytesEsq != b.BytesEsq {
				return a.BytesEsq > b.BytesEsq
			}
		case "metodos":
			if len(a.Metodos) != len(b.Metodos) {
				return len(a.Metodos) > len(b.Metodos)
			}
		case "entradas":
			if entran[a.Ruta] != entran[b.Ruta] {
				return entran[a.Ruta] > entran[b.Ruta]
			}
		case "salidas":
			if salen[a.Ruta] != salen[b.Ruta] {
				return salen[a.Ruta] > salen[b.Ruta]
			}
		}
		return a.Ruta < b.Ruta
	})
	if f.tope > 0 && len(out) > f.tope {
		out = out[:f.tope]
	}
	return out
}
