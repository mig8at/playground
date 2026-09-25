package sql

import (
	"fmt"
	"regexp"
	"strings"
)

// Sólo estas dos formas arrancan una lectura. `SHOW`/`DESCRIBE`/`EXPLAIN` quedan afuera a propósito: la
// regla tiene que poder leerse de un vistazo, y un allowlist que «casi» acierta es peor que uno que
// molesta.
var readStart = regexp.MustCompile(`(?is)^\s*(select|with)\b`)

// ⚠ `SELECT … INTO OUTFILE/DUMPFILE` ES UNA ESCRITURA, y empieza con SELECT: pasa el arranque y ningún
// verbo de la lista lo nombra. Va aparte porque es de DOS palabras (F-109).
var writeFile = regexp.MustCompile(`(?is)\binto\s+(outfile|dumpfile)\b`)

// Verbos que jamás aparecen en una lectura, buscados como PALABRA para no rechazar una columna
// `updated_at` ni un `FROM inserts`.
var writeVerb = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|rename|call|load|handler|lock|unlock|commit|rollback|savepoint|prepare|execute|do|set)\b`)

// MaxQuery es el largo máximo de una consulta, en caracteres.
const MaxQuery = 12000

/* ValidateReadOnly decide si la consulta puede salir a la red, ANTES de abrir una conexión.
 *
 * Es la unión de los dos chequeos que había (el del tablero y el del trazador), que ya eran casi iguales:
 * el del tablero sumaba el tope de largo. El orden importa: primero se arma el ESQUELETO de la consulta
 * —sin comentarios y con el texto entre comillas vaciado—, después se exige el arranque de lectura, y
 * recién al final se buscan verbos sobre ese esqueleto. */
func ValidateReadOnly(query string) error {
	// El tope se mide sobre lo que se escribió, no sobre el esqueleto: un literal largo también pesa.
	if len([]rune(query)) > MaxQuery {
		return fmt.Errorf("la consulta supera %d caracteres", MaxQuery)
	}
	clean, err := skeleton(query)
	if err != nil {
		return err
	}
	if strings.TrimSpace(clean) == "" {
		return fmt.Errorf("la consulta está vacía")
	}
	if !readStart.MatchString(clean) {
		return fmt.Errorf("sólo se permiten consultas que empiecen con SELECT o WITH")
	}
	// Un `;` que no sea el último carácter significa que viene otra sentencia detrás.
	if strings.Contains(strings.TrimRight(clean, " \t\r\n;"), ";") {
		return fmt.Errorf("una sola sentencia por consulta (hay un ';' intermedio)")
	}
	if m := writeFile.FindString(clean); m != "" {
		return fmt.Errorf("contiene %q: escribe un archivo en el servidor, no es una lectura",
			strings.ToUpper(strings.Join(strings.Fields(m), " ")))
	}
	for _, index := range writeVerb.FindAllStringIndex(clean, -1) {
		// ⚠ Un verbo seguido de `(` es una FUNCIÓN: `REPLACE(str,a,b)` e `INSERT(str,pos,len,new)` son de
		// cadena en MySQL. La sentencia siempre lleva separador antes del destino (`REPLACE INTO`), nunca
		// un paréntesis pegado. Costó una consulta legítima que contaba saltos de línea con REPLACE.
		if strings.HasPrefix(strings.TrimLeft(clean[index[1]:], " \t\r\n"), "(") {
			continue
		}
		return fmt.Errorf("contiene el verbo %q, que no pertenece a una lectura", strings.ToUpper(clean[index[0]:index[1]]))
	}
	return nil
}

// skeleton devuelve la consulta como la lee MySQL, sin lo que no ejecuta: saca los comentarios y vacía el
// texto entre comillas (queda `”`), para que el chequeo mire SQL y no prosa ni datos.
//
// ⚠ Hasta el 2026-09-25 esto era un borrado por líneas que no sabía de comillas, y tenía tres agujeros,
// medidos con ValidateReadOnly:
//   - `/*! … */` es un comentario EJECUTABLE: MySQL corre lo de adentro. Borrarlo como comentario dejaba
//     pasar `SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */`. Ahora se rechaza.
//   - `--` sólo abre un comentario si lo sigue un espacio o un control. `SELECT 5--1 INTO OUTFILE …` es
//     una resta para MySQL; borrar desde `--` escondía el INTO OUTFILE.
//   - un `--`, `#` o `;` DENTRO de comillas se leía como sintaxis, y una palabra dentro de un literal
//     (`SELECT 'drop'`) rechazaba una lectura legítima.
//
// Una comilla sin cerrar se rechaza: no se sabe dónde termina el texto, y MySQL tampoco la correría.
func skeleton(query string) (string, error) {
	var b strings.Builder
	n := len(query)
	for i := 0; i < n; i++ {
		c := query[i]
		switch {
		case c == '\'' || c == '"' || c == '`':
			end, ok := closeQuote(query, i)
			if !ok {
				return "", fmt.Errorf("hay una comilla %c sin cerrar", c)
			}
			b.WriteByte(c)
			b.WriteByte(c)
			i = end
		case c == '/' && i+1 < n && query[i+1] == '*':
			if i+2 < n && query[i+2] == '!' {
				return "", fmt.Errorf("contiene un comentario ejecutable de MySQL (/*! … */): MySQL corre lo de adentro")
			}
			end := strings.Index(query[i+2:], "*/")
			if end < 0 {
				i = n
			} else {
				i += 2 + end + 1
			}
			b.WriteByte(' ')
		case c == '#', c == '-' && i+1 < n && query[i+1] == '-' && (i+2 == n || query[i+2] <= ' '):
			for i < n && query[i] != '\n' {
				i++
			}
			b.WriteByte('\n')
		default:
			b.WriteByte(c)
		}
	}
	return b.String(), nil
}

// closeQuote devuelve dónde termina el texto que abre la comilla de `start`. Adentro, la barra escapa el
// carácter siguiente (el modo por defecto de MySQL) y la comilla doblada (`”`) es una comilla literal.
// Entre backticks (un identificador) la barra no escapa.
func closeQuote(query string, start int) (int, bool) {
	q := query[start]
	for i := start + 1; i < len(query); i++ {
		switch query[i] {
		case '\\':
			if q != '`' {
				i++
			}
		case q:
			if i+1 < len(query) && query[i+1] == q {
				i++
				continue
			}
			return i, true
		}
	}
	return 0, false
}
