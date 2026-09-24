// Package text corta y recorta texto como lo hacía Python, que es donde nacieron las herramientas que
// lo usan (las citas, las trampas, los hooks). No es un capricho: cortar sólo por `\n` o recortar sólo
// los espacios ASCII cambia en qué línea cae una cita o qué segmento de un comando se mira, y una
// herramienta portada que cambia eso ya no es la misma herramienta.
package text

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// SplitLines corta donde corta `str.splitlines` de Python: no sólo `\n`, también `\r`, `\r\n`, `\v`,
// `\f`, los separadores 0x1c–0x1e, U+0085 y U+2028/2029. Un archivo con `\r\n` o con un `\f` cuenta sus
// líneas distinto si se corta sólo por `\n`.
func SplitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		switch r {
		case '\n', '\v', '\f', 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029:
			out = append(out, s[start:i])
			i += size
			start = i
		case '\r':
			out = append(out, s[start:i])
			i += size
			if i < len(s) && s[i] == '\n' {
				i++
			}
			start = i
		default:
			i += size
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

// IsSpace es `str.isspace` de Python: lo de Unicode más los separadores 0x1c–0x1f.
func IsSpace(r rune) bool { return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f) }

// Strip es `str.strip()` de Python.
func Strip(s string) string { return strings.TrimFunc(s, IsSpace) }

// Space es la clase `\s` de las expresiones de Python, para escribir en RE2 lo mismo que matcheaba
// allá (el `\s` de Go es sólo ASCII). `NotSpace` es su complemento, el `\S`.
// `SpaceChars` es el interior de la clase, para sumarlo a otra (`[;&|` + SpaceChars + `]`).
const (
	SpaceChars = `\t\n\v\f\r\x{1c}-\x{1f} \x{85}\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}`
	Space      = `[` + SpaceChars + `]`
	NotSpace   = `[^` + SpaceChars + `]`
	Word       = `[\p{L}\p{N}_]`
)

// IsWord es la clase `\w` de Python sobre texto: letras, números y el guion bajo.
func IsWord(r rune) bool { return r == '_' || unicode.IsLetter(r) || unicode.IsNumber(r) }
