package taskcontext

import (
	"fmt"
	"path"
	"sort"
	"strings"
)

// LO MECÁNICO SE ARREGLA SOLO. Un archivo nombrado sin su repo frenaba el bloque entero, aunque el repo
// fuera obvio: medido el 2026-10-20, seis bloques rebotados en una sola sesión, casi todos por esto. Antes
// de validar, cada ruta suelta de la prosa se busca en `main` de los repos citables; si está en UNO solo,
// se reescribe como su enlace y se avisa. Si está en varios o en ninguno, se deja como estaba y el error
// dice dónde está —o que no está—, porque elegir el repo ahí sería inventar.

// aliasLister es lo que hace falta para buscar una ruta en todos los repos: la lista de repos de
// tools/repos.json lo cumple. Un FileResolver que no lo cumple (las pruebas viejas) no arregla nada.
type aliasLister interface {
	Citable() map[string]string
}

// pathFix es lo que se averiguó de una ruta suelta: en qué repos está.
type pathFix struct {
	repos []string
}

// autolinkPaths reescribe las rutas sueltas de la prosa que existen en un solo repo. Devuelve el cuerpo,
// los avisos de lo que cambió y, de lo que no pudo cambiar, en qué repos está cada ruta.
func autolinkPaths(body string, files FileResolver) (string, []string, map[string][]string) {
	lister, ok := files.(aliasLister)
	if !ok {
		return body, nil, nil
	}
	var aliases []string
	for alias := range lister.Citable() {
		if files.Knows(alias) {
			aliases = append(aliases, alias)
		}
	}
	sort.Strings(aliases)
	found := map[string]pathFix{}
	locate := func(p string) pathFix {
		if f, ok := found[p]; ok {
			return f
		}
		var f pathFix
		for _, alias := range aliases {
			if _, err := files.Pin(alias, p, ""); err == nil {
				f.repos = append(f.repos, alias)
			}
		}
		found[p] = f
		return f
	}
	link := func(p string) (string, bool) {
		f := locate(p)
		if len(f.repos) != 1 {
			return "", false
		}
		return "[" + path.Base(p) + "](repo:" + f.repos[0] + "/" + p + ")", true
	}
	body = mapProse(body, func(line string) string {
		return eachOutside(line, blockLinkRe, func(text string) string {
			// Una ruta entre comillas invertidas se cambia sólo si es TODO el código: `cat app/x.php` es
			// un comando, y un enlace adentro de él dejaría de ser código.
			return eachOutside(text, inlineCodeRe, func(plain string) string {
				return replaceBarePaths(plain, link)
			}, func(code string) string {
				if m := barePathRe.FindStringSubmatch(code); m != nil && m[1] == strings.Trim(code, "`") {
					if l, ok := link(m[1]); ok {
						return l
					}
				}
				return code
			})
		}, nil)
	})
	var notes []string
	unresolved := map[string][]string{}
	var paths []string
	for p := range found {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		if f := found[p]; len(f.repos) == 1 {
			notes = append(notes, fmt.Sprintf("«%s» iba sin repo: quedó como enlace a %s, el único repo donde está", p, f.repos[0]))
		} else {
			unresolved[p] = f.repos
		}
	}
	return body, notes, unresolved
}

// eachOutside aplica out a lo que queda entre las coincidencias de re, e in (si no es nil) a cada una.
func eachOutside(s string, re interface {
	FindAllStringIndex(string, int) [][]int
}, out func(string) string, in func(string) string) string {
	var b strings.Builder
	last := 0
	for _, m := range re.FindAllStringIndex(s, -1) {
		b.WriteString(out(s[last:m[0]]))
		if in != nil {
			b.WriteString(in(s[m[0]:m[1]]))
		} else {
			b.WriteString(s[m[0]:m[1]])
		}
		last = m[1]
	}
	b.WriteString(out(s[last:]))
	return b.String()
}

// replaceBarePaths cambia cada ruta de texto plano por lo que devuelva link. La expresión se come el
// separador de después, así que dos rutas separadas por un solo espacio piden una segunda vuelta.
func replaceBarePaths(s string, link func(string) (string, bool)) string {
	for range 4 {
		changed := false
		var b strings.Builder
		last := 0
		for _, m := range barePathRe.FindAllStringSubmatchIndex(s, -1) {
			if l, ok := link(s[m[2]:m[3]]); ok {
				b.WriteString(s[last:m[2]])
				b.WriteString(l)
				last = m[3]
				changed = true
			}
		}
		b.WriteString(s[last:])
		s = b.String()
		if !changed {
			break
		}
	}
	return s
}

// describeUnresolved explica por qué una ruta suelta no se enlazó sola.
func describeUnresolved(unresolved map[string][]string) string {
	var parts []string
	var paths []string
	for p := range unresolved {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		if repos := unresolved[p]; len(repos) == 0 {
			parts = append(parts, fmt.Sprintf("«%s» no está en main de ningún repo citable", p))
		} else {
			parts = append(parts, fmt.Sprintf("«%s» está en %s: elegí uno", p, strings.Join(repos, " y ")))
		}
	}
	return strings.Join(parts, " · ")
}
