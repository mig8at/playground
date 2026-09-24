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

var blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)

// MaxQuery es el largo máximo de una consulta, en caracteres.
const MaxQuery = 12000

/* ValidateReadOnly decide si la consulta puede salir a la red, ANTES de abrir una conexión.
 *
 * Es la unión de los dos chequeos que había (el del tablero y el del trazador), que ya eran casi iguales:
 * el del tablero sumaba el tope de largo. El orden importa: primero se sacan los comentarios —el
 * escondite clásico, y al revés un `-- update` en un comentario rechazaría una consulta legítima—, después
 * se exige el arranque de lectura, y recién al final se buscan verbos. */
func ValidateReadOnly(query string) error {
	clean := withoutComments(query)
	if strings.TrimSpace(clean) == "" {
		return fmt.Errorf("la consulta está vacía")
	}
	if len([]rune(clean)) > MaxQuery {
		return fmt.Errorf("la consulta supera %d caracteres", MaxQuery)
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

// withoutComments saca `-- …`, `# …` y `/* … */` para que el chequeo mire SQL y no prosa.
func withoutComments(query string) string {
	var b strings.Builder
	for _, line := range strings.Split(query, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return blockComment.ReplaceAllString(b.String(), " ")
}
