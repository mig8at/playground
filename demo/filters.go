// filters.go — EL MOTOR DE FILTROS. Un solo predicado que todos los subcomandos comparten.
//
// POR QUÉ ACÁ Y NO EN CADA COMANDO. Si cada subcomando arma su propio filtrado, `--tier test` empieza
// a significar cosas distintas según dónde lo pongas, y eso no falla: devuelve otra cosa. Acá el
// filtro es UNO y los comandos sólo eligen qué mostrar de lo que pasó el colador. Así `--prefix` y
// `--table` componen igual en `files`, en `map` y en `methods` sin escribirlo tres veces.
package main

import (
	"flag"
	"sort"
	"strings"
)

type filter struct {
	prefix     string
	tier       string
	class      string
	extends    string
	trait      string
	implements string
	uses       string
	method     string
	table      string
	testCase   string
	withCases  bool
	orphan     bool
	leaf       bool
	minMethods int
	maxMethods int
	sortBy     string
	limit      int
}

func (f *filter) register(fs *flag.FlagSet) {
	fs.StringVar(&f.prefix, "prefix", "", "la ruta empieza con esto (un módulo, una carpeta)")
	fs.StringVar(&f.tier, "tier", "", "code | test | migration")
	fs.StringVar(&f.class, "class", "", "el nombre de la clase contiene esto")
	fs.StringVar(&f.extends, "extends", "", "hereda de esta clase")
	fs.StringVar(&f.trait, "trait", "", "usa este trait")
	fs.StringVar(&f.implements, "implements", "", "implementa esta interfaz")
	fs.StringVar(&f.uses, "uses", "", "importa esta clase")
	fs.StringVar(&f.method, "method", "", "tiene un método cuyo nombre contiene esto")
	fs.StringVar(&f.table, "table", "", "toca esta tabla (hoy: sólo migraciones)")
	fs.StringVar(&f.testCase, "case", "", "algún caso de test cuya descripción contiene esto")
	fs.BoolVar(&f.withCases, "with-cases", false, "sólo archivos con casos de test descritos en prosa")
	fs.BoolVar(&f.orphan, "orphan", false, "nadie lo llama SEGÚN ESTE MAPA (⚠ no es «código muerto»)")
	fs.BoolVar(&f.leaf, "leaf", false, "no llama a nadie del repo")
	fs.IntVar(&f.minMethods, "min-methods", 0, "al menos N métodos")
	fs.IntVar(&f.maxMethods, "max-methods", 0, "a lo sumo N métodos (0 = sin tope)")
	fs.StringVar(&f.sortBy, "sort", "path", "path | tokens | methods | in | out")
	fs.IntVar(&f.limit, "limit", 0, "cortar a N resultados (0 = todos)")
}

// hasFold — subcadena sin distinguir mayúsculas. Una aguja vacía matchea todo, para que un filtro no
// puesto no filtre.
func hasFold(haystack, needle string) bool {
	return needle == "" || strings.Contains(strings.ToLower(haystack), strings.ToLower(needle))
}

func anyHasFold(haystacks []string, needle string) bool {
	if needle == "" {
		return true
	}
	for _, h := range haystacks {
		if hasFold(h, needle) {
			return true
		}
	}
	return false
}

func (f *filter) matches(s *sourceFile, in, out map[string]int) bool {
	switch {
	case f.prefix != "" && !strings.HasPrefix(s.Path, f.prefix):
		return false
	case f.tier != "" && s.Tier != f.tier:
		return false
	case !hasFold(s.Class, f.class):
		return false
	case !hasFold(s.Extends, f.extends):
		return false
	case !anyHasFold(s.Traits, f.trait):
		return false
	case !anyHasFold(s.Implements, f.implements):
		return false
	case !anyHasFold(s.Tables, f.table):
		return false
	case !anyHasFold(s.Cases, f.testCase):
		return false
	case f.withCases && len(s.Cases) == 0:
		return false
	case f.orphan && in[s.Path] > 0:
		return false
	case f.leaf && out[s.Path] > 0:
		return false
	case len(s.Methods) < f.minMethods:
		return false
	case f.maxMethods > 0 && len(s.Methods) > f.maxMethods:
		return false
	}
	if f.uses != "" {
		found := false
		for short, fqcn := range s.Imports {
			if hasFold(short, f.uses) || hasFold(fqcn, f.uses) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if f.method != "" {
		found := false
		for _, m := range s.Methods {
			if hasFold(m.Name, f.method) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// selectFiles — los archivos que pasan el filtro, ordenados y recortados.
func (f *filter) selectFiles(g *graph) []*sourceFile {
	in, out := g.degrees()
	var picked []*sourceFile
	for _, s := range g.Files {
		if f.matches(s, in, out) {
			picked = append(picked, s)
		}
	}
	sort.Slice(picked, func(i, j int) bool {
		a, b := picked[i], picked[j]
		switch f.sortBy {
		case "tokens":
			if a.BytesTier != b.BytesTier {
				return a.BytesTier > b.BytesTier
			}
		case "methods":
			if len(a.Methods) != len(b.Methods) {
				return len(a.Methods) > len(b.Methods)
			}
		case "in":
			if in[a.Path] != in[b.Path] {
				return in[a.Path] > in[b.Path]
			}
		case "out":
			if out[a.Path] != out[b.Path] {
				return out[a.Path] > out[b.Path]
			}
		}
		return a.Path < b.Path
	})
	if f.limit > 0 && len(picked) > f.limit {
		picked = picked[:f.limit]
	}
	return picked
}
