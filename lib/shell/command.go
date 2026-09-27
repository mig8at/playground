package shell

// Segments y Program: qué programa corre en cada tramo de un comando. Vivían en los hooks del tablero
// (`destructive.go`) y se mudaron acá el 2026-09-27 para que `radar` parta los comandos EXACTAMENTE como
// los hooks: un segundo parser habría contado distinto lo mismo.

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"creditop/playground/lib/text"
)

var (
	segmentSep = regexp.MustCompile(`&&|\|\||;|\||\n`)
	envPrefix  = regexp.MustCompile(`^(?:` + text.Space + `*[A-Za-z_][A-Za-z0-9_]*=` + text.NotSpace + `*` + text.Space + `+)*`)
	// prefixes son los programas que corren OTRO programa: el que importa es el siguiente.
	prefixes = map[string]bool{"sudo": true, "time": true, "nohup": true, "env": true, "exec": true}
)

// SpaceEnds: las posiciones donde puede terminar una corrida de espacios que empieza en `i`, de la más
// larga a la más corta (incluida `i`, la corrida vacía): el orden en que las prueba una expresión voraz.
func SpaceEnds(s string, i int) []int {
	ends := []int{i}
	for j := i; j < len(s); {
		r, size := utf8.DecodeRuneInString(s[j:])
		if !text.IsSpace(r) {
			break
		}
		j += size
		ends = append(ends, j)
	}
	for a, b := 0, len(ends)-1; a < b; a, b = a+1, b-1 {
		ends[a], ends[b] = ends[b], ends[a]
	}
	return ends
}

// optional: con un carácter opcional en `i`, primero consumirlo y después no (así lo prueba `x?`).
func optional(s string, i int, chars string) []int {
	if i < len(s) && strings.IndexByte(chars, s[i]) >= 0 {
		return []int{i + 1, i}
	}
	return []int{i}
}

/* heredocAt emula, desde `i`, la expresión con que la guarda borraba los cuerpos de heredoc:
 *
 *	<<-?\s*['"]?(\w+)['"]?[^\n]*\n.*?\n\1\s*$        (con re.S y re.M)
 *
 * RE2 no tiene referencias hacia atrás (`\1`), así que se recorren las mismas alternativas en el mismo
 * orden en que las prueba un motor con retroceso, y gana la primera que cierra. Devuelve dónde termina. */
func heredocAt(s string, i int) (int, bool) {
	if !strings.HasPrefix(s[i:], "<<") {
		return 0, false
	}
	for _, j1 := range optional(s, i+2, "-") {
		for _, j2 := range SpaceEnds(s, j1) {
			for _, j3 := range optional(s, j2, `'"`) {
				var wordEnds []int
				for j := j3; j < len(s); {
					r, size := utf8.DecodeRuneInString(s[j:])
					if !text.IsWord(r) {
						break
					}
					j += size
					wordEnds = append(wordEnds, j)
				}
				for w := len(wordEnds) - 1; w >= 0; w-- {
					word := s[j3:wordEnds[w]]
					for _, j4 := range optional(s, wordEnds[w], `'"`) {
						nl := strings.IndexByte(s[j4:], '\n')
						if nl < 0 {
							continue
						}
						for p := j4 + nl + 1; p < len(s); p++ {
							if s[p] != '\n' || !strings.HasPrefix(s[p+1:], word) {
								continue
							}
							after := p + 1 + len(word)
							for _, e := range SpaceEnds(s, after) {
								if e == len(s) || s[e] == '\n' {
									return e, true
								}
							}
						}
					}
				}
			}
		}
	}
	return 0, false
}

// withoutHeredocs borra cada cuerpo de heredoc, de izquierda a derecha y sin solaparse, como `re.sub`.
func withoutHeredocs(s string) string {
	var out strings.Builder
	last := 0
	for i := 0; i < len(s); {
		if end, ok := heredocAt(s, i); ok {
			out.WriteString(s[last:i])
			last, i = end, end
			continue
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	out.WriteString(s[last:])
	return out.String()
}

// Segments: los tramos del comando que corren cada uno su programa, sin los cuerpos de heredoc.
func Segments(cmd string) []string {
	var out []string
	for _, seg := range segmentSep.Split(withoutHeredocs(cmd), -1) {
		if seg = text.Strip(seg); seg != "" {
			out = append(out, seg)
		}
	}
	return out
}

// Program: las palabras del segmento sin las asignaciones de variables de adelante (`A=1 B=2 cmd`) ni
// los programas que corren a otro (`sudo`, `time`, `env`…). La primera es el programa, tal como se
// escribió (con su ruta, si la tiene).
func Program(seg string) []string {
	loc := envPrefix.FindStringIndex(seg)
	toks := Tokens(text.Strip(seg[loc[1]:]))
	for len(toks) > 0 && prefixes[base(toks[0])] {
		toks = toks[1:]
	}
	return toks
}

// base: la última parte de una ruta (`/usr/bin/sudo` → `sudo`).
func base(p string) string {
	p = strings.TrimRight(p, "/")
	if i := strings.LastIndexByte(p, '/'); i >= 0 {
		return p[i+1:]
	}
	return p
}
