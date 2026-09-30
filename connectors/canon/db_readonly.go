package canon

import (
	"fmt"
	"regexp"
	"strings"
)

// SÓLO LECTURA, EN DOS CAPAS — y la que manda no es la segunda.
//
//  1. La BASE lo impone: cada consulta corre en una transacción `READ ONLY` y la conexión abre con
//     `default_transaction_read_only=on`. Un INSERT, un DROP o un `SELECT … FOR UPDATE` los rechaza Postgres, no una
//     expresión regular. Es la que hay que creer.
//  2. Ésta, ANTES de abrir nada: dice rápido y en español por qué una consulta no es una lectura, y corta lo que una
//     transacción de sólo lectura NO impide (leer archivos del servidor, dormir la conexión, cambiar parámetros de la
//     sesión, cancelar otras conexiones). Es la que da el mensaje; no la que protege.
//
// Lo mismo que hace `connectors/sql` para MySQL, pero con las reglas de Postgres: los comentarios de bloque se ANIDAN,
// `--` abre un comentario siempre, las comillas simples sólo se escapan doblándolas (salvo `E'…'`), el texto puede ir
// entre dólares (`$$…$$` o con etiqueta), y un identificador entre comillas dobles puede llevar cualquier cosa.

// MaxQueryDB es el largo máximo de una consulta, en caracteres.
const MaxQueryDB = 12000

var (
	readStartPG = regexp.MustCompile(`(?is)^\s*(select|with)\b`)
	// Verbos que modifican, como PALABRA (no rechazar una columna `updated_at`). Sólo caben tres lugares donde una sentencia que
	// EMPIEZA con SELECT/WITH y es UNA sola puede escribir: un WITH con INSERT/UPDATE/DELETE/MERGE adentro, y `SELECT … INTO`
	// (crea una tabla). Otras palabras —comment, commit, release, set— pueden ser columnas y no pueden abrir una sentencia acá.
	writeVerbPG = regexp.MustCompile(`(?is)\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|vacuum|lock|listen|notify|refresh|reindex|cluster|into)\b`)
	// Funciones que una transacción de sólo lectura no frena y que no pertenecen a una consulta de consulta.
	dangerousFuncPG = regexp.MustCompile(`(?is)\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_ls_[a-z_]*dir|pg_stat_file|lo_import|lo_export|lo_get|lo_put|pg_sleep[a-z_]*|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|dblink[a-z_]*|pg_advisory_[a-z_]*|nextval|setval|pg_logical_[a-z_]*|pg_create_[a-z_]*|pg_drop_[a-z_]*|pg_switch_wal|pg_promote|query_to_xml[a-z_]*)\s*\(`)
	// `FOR UPDATE/SHARE` toma bloqueos: en una lectura de sólo lectura Postgres lo rechaza, pero se dice acá con su motivo.
	forLock = regexp.MustCompile(`(?is)\bfor\s+(no\s+key\s+update|update|share|key\s+share)\b`)
)

// ValidateReadOnlyPG decide si la consulta puede salir a la red, ANTES de abrir una conexión.
func ValidateReadOnlyPG(query string) error {
	if len([]rune(query)) > MaxQueryDB {
		return fmt.Errorf("la consulta supera %d caracteres", MaxQueryDB)
	}
	clean, err := skeletonPG(query)
	if err != nil {
		return err
	}
	if strings.TrimSpace(clean) == "" {
		return fmt.Errorf("la consulta está vacía")
	}
	if !readStartPG.MatchString(clean) {
		return fmt.Errorf("sólo se permiten consultas que empiecen con SELECT o WITH")
	}
	// Un `;` que no sea el último carácter significa que viene otra sentencia detrás.
	if strings.Contains(strings.TrimRight(clean, " \t\r\n;"), ";") {
		return fmt.Errorf("una sola sentencia por consulta (hay un ';' intermedio)")
	}
	if m := forLock.FindString(clean); m != "" {
		return fmt.Errorf("contiene %q: toma bloqueos, no es una lectura", strings.ToUpper(strings.Join(strings.Fields(m), " ")))
	}
	for _, ix := range writeVerbPG.FindAllStringIndex(clean, -1) {
		word := strings.ToLower(clean[ix[0]:ix[1]])
		// Un verbo seguido de `(` es una FUNCIÓN (`replace(…)`, `left(…)`); la sentencia lleva separador antes del destino.
		if strings.HasPrefix(strings.TrimLeft(clean[ix[1]:], " \t\r\n"), "(") {
			continue
		}
		return fmt.Errorf("contiene el verbo %q, que no pertenece a una lectura", strings.ToUpper(word))
	}
	if m := dangerousFuncPG.FindString(clean); m != "" {
		name := strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(m), "(")))
		return fmt.Errorf("llama a %s(), que no pertenece a una consulta de lectura", name)
	}
	return nil
}

// skeletonPG devuelve la consulta como la lee Postgres, sin lo que no ejecuta: saca los comentarios y vacía los
// textos (queda `”`, `""` o `$$$$`), para que el chequeo mire SQL y no prosa ni datos.
func skeletonPG(query string) (string, error) {
	var b strings.Builder
	n := len(query)
	for i := 0; i < n; i++ {
		c := query[i]
		switch {
		case c == '-' && i+1 < n && query[i+1] == '-': // `--` abre un comentario SIEMPRE (a diferencia de MySQL)
			for i < n && query[i] != '\n' {
				i++
			}
			b.WriteByte('\n')
		case c == '/' && i+1 < n && query[i+1] == '*': // los bloques se ANIDAN
			depth := 1
			i += 2
			for i < n && depth > 0 {
				switch {
				case query[i] == '/' && i+1 < n && query[i+1] == '*':
					depth++
					i += 2
				case query[i] == '*' && i+1 < n && query[i+1] == '/':
					depth--
					i += 2
				default:
					i++
				}
			}
			if depth > 0 {
				return "", fmt.Errorf("hay un comentario /* sin cerrar")
			}
			i-- // el for suma uno
			b.WriteByte(' ')
		case c == '\'':
			// `E'…'` escapa con barra; el resto sólo con la comilla doblada.
			escapes := i > 0 && (query[i-1] == 'E' || query[i-1] == 'e') && (i < 2 || !isIdentByte(query[i-2]))
			end, ok := closeQuotePG(query, i, '\'', escapes)
			if !ok {
				return "", fmt.Errorf("hay una comilla ' sin cerrar")
			}
			b.WriteString("''")
			i = end
		case c == '"':
			end, ok := closeQuotePG(query, i, '"', false)
			if !ok {
				return "", fmt.Errorf(`hay una comilla " sin cerrar`)
			}
			b.WriteString(`""`)
			i = end
		case c == '$':
			if tag, ok := dollarTag(query, i); ok {
				close := strings.Index(query[i+len(tag):], tag)
				if close < 0 {
					return "", fmt.Errorf("hay un texto %s sin cerrar", tag)
				}
				b.WriteString("$$")
				i += len(tag) + close + len(tag) - 1
				continue
			}
			b.WriteByte(c)
		default:
			b.WriteByte(c)
		}
	}
	return b.String(), nil
}

func isIdentByte(c byte) bool {
	return c == '_' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c >= 0x80
}

// closeQuotePG devuelve dónde termina el texto que abre la comilla de `start`.
func closeQuotePG(query string, start int, q byte, backslash bool) (int, bool) {
	for i := start + 1; i < len(query); i++ {
		switch {
		case backslash && query[i] == '\\':
			i++
		case query[i] == q:
			if i+1 < len(query) && query[i+1] == q {
				i++
				continue
			}
			return i, true
		}
	}
	return 0, false
}

// dollarTag reconoce `$$` o `$nombre$` en `i`. Un `$1` (parámetro) no es una etiqueta.
func dollarTag(query string, i int) (string, bool) {
	j := i + 1
	for j < len(query) && (query[j] == '_' || (query[j] >= 'a' && query[j] <= 'z') || (query[j] >= 'A' && query[j] <= 'Z') || query[j] >= 0x80 || (j > i+1 && query[j] >= '0' && query[j] <= '9')) {
		j++
	}
	if j < len(query) && query[j] == '$' {
		// `a$b$` dentro de un identificador no abre nada: la etiqueta sólo vale si lo anterior no es parte de un nombre.
		if i > 0 && isIdentByte(query[i-1]) {
			return "", false
		}
		return query[i : j+1], true
	}
	return "", false
}
