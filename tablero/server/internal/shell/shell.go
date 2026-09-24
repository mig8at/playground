// Package shell parte comandos como lo hacía `shlex.split` de Python (modo POSIX), que es con lo que
// nació la guarda de los tests destructivos. La guarda decide qué ejecutable corre en cada segmento de
// un comando: si partiera distinto, un comando que antes frenaba podría pasar.
package shell

import (
	"errors"
	"strings"

	"creditop/tablero/server/internal/text"
)

// ErrNoClosingQuotation y ErrNoEscapedCharacter son los dos errores de `shlex`: una comilla sin cerrar y
// una barra invertida al final.
var (
	ErrNoClosingQuotation = errors.New("No closing quotation")
	ErrNoEscapedCharacter = errors.New("No escaped character")
)

func isWhitespace(r rune) bool { return r == ' ' || r == '\t' || r == '\r' || r == '\n' }

/* Split es `shlex.split(s, posix=True)`: corta en espacios, respeta comillas simples y dobles, y la
 * barra invertida escapa afuera de las comillas y, adentro de las dobles, sólo a `\` y a `"`. Una
 * palabra vacía entre comillas (`''`) es una palabra. */
func Split(s string) ([]string, error) {
	var out []string
	var tok strings.Builder
	state := ' ' // ' ' entre palabras · 'a' en una palabra · '\'' o '"' adentro de comillas · '\\' escapando
	escaped := 'a'
	for _, r := range s {
		switch state {
		case ' ':
			switch {
			case isWhitespace(r):
			case r == '\\':
				escaped, state = 'a', '\\'
			case r == '\'' || r == '"':
				state = r
			default:
				tok.WriteRune(r)
				state = 'a'
			}
		case 'a':
			switch {
			case isWhitespace(r):
				out = append(out, tok.String())
				tok.Reset()
				state = ' '
			case r == '\'' || r == '"':
				state = r
			case r == '\\':
				escaped, state = 'a', '\\'
			default:
				tok.WriteRune(r)
			}
		case '\'', '"':
			switch {
			case r == state:
				state = 'a'
			case r == '\\' && state == '"':
				escaped, state = state, '\\'
			default:
				tok.WriteRune(r)
			}
		case '\\':
			// adentro de comillas dobles la barra sólo escapa a sí misma y a la comilla: si no, queda
			if escaped == '"' && r != '\\' && r != '"' {
				tok.WriteRune('\\')
			}
			tok.WriteRune(r)
			state = escaped
		}
	}
	switch state {
	case '\'', '"':
		return nil, ErrNoClosingQuotation
	case '\\':
		return nil, ErrNoEscapedCharacter
	case 'a':
		out = append(out, tok.String())
	}
	return out, nil
}

// Tokens: las palabras del comando; si no se puede partir como shell, por espacios.
func Tokens(s string) []string {
	if toks, err := Split(s); err == nil {
		return toks
	}
	return strings.FieldsFunc(s, text.IsSpace)
}
