// Package naming contesta si el código del tablero nombra algo en español.
//
// Recorre lo que se ESCRIBE al invocar el tablero —los identificadores declarados en su Go, su Vue/JS y
// su Python, las claves JSON que emite su server y los nombres de archivo y carpeta— y marca los que
// llevan una palabra que no es inglés. Es la fase 4 del frente «el código en inglés»
// (tablero/tasks/tablero/task.md): una regla escrita envejece y un chequeo no. Los comentarios y las
// tareas de `tasks/` quedan afuera a propósito: se leen para entender. Las claves JSON entraron con la
// fase 4b (2026-09-23), y las que son el contrato de OTRO —canon, cuadrilla, Jira, el frontmatter que se
// escribe a mano— se aceptan con su alcance en naming-allow.txt (`json:`), no como palabras sueltas.
//
// ⚠ LA VARA DEL INGLÉS NO ES EL DICCIONARIO DEL SISTEMA. Se probó en la fase 1 y deja pasar `aviso`,
// `leer`, `tema` o `antes`, porque trae inglés arcaico. La vara es el código de las bibliotecas estándar
// de Go y de Python: una palabra que casi no aparece ahí es sospechosa. Dos listas la corrigen:
//   - Spanish, acá abajo: palabras españolas que SÍ abundan en esas bibliotecas (`de`, `es`, `fin`) y
//     que igual se rechazan;
//   - naming-allow.txt: palabras inglesas o nombres propios que casi no aparecen ahí y son legítimos, y
//     las rutas que se aceptan en español con su motivo.
//
// Nació como `tablero/tools/naming.py` y pasó a Go el 2026-09-23, comparando hallazgo por hallazgo y la
// tabla de frecuencias entera contra la versión anterior.
package naming

import (
	"os"
	"regexp"
	"strings"
)

// Threshold: una palabra que aparece menos que esto en las dos bibliotecas estándar juntas no cuenta
// como inglés.
const Threshold = 5

// Spanish son las españolas que abundan en las bibliotecas estándar (locales, abreviaturas, otro idioma
// que coincide) y por eso la frecuencia no las frena. Sólo va acá lo que se MIDIÓ por encima del umbral:
// el resto ya lo rechaza la frecuencia. Ambiguas que se dejaron afuera a propósito: `el` (element en
// JS), `lo` (low), `si` (abreviatura), `todo`/`todos` (inglés), `real`, `total`, `final`, `base`, `actual`.
var Spanish = set(strings.Fields(`
    de del al con sin por para que una uno unos unas los las es en ya fin mal hay pero como cuando donde
    esta este esto solo sola nada cada desde hasta antes luego sobre entre tiene dia dias mes hora ver
`))

func set(words []string) map[string]bool {
	out := make(map[string]bool, len(words))
	for _, w := range words {
		out[w] = true
	}
	return out
}

var separators = regexp.MustCompile(`[^A-Za-z0-9]+`)

func isUpper(b byte) bool { return b >= 'A' && b <= 'Z' }
func isLower(b byte) bool { return b >= 'a' && b <= 'z' }
func isDigit(b byte) bool { return b >= '0' && b <= '9' }

/* SplitWords: `leerTareaVieja` → leer, tarea, vieja · `HTTPServer` → http, server · `dry_run` → dry, run.
 *
 * Es la expresión `[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+` escrita a mano, porque RE2 no tiene
 * lookahead: una sigla se corta antes de la mayúscula que abre la palabra siguiente. */
func SplitWords(name string) []string {
	var out []string
	for _, part := range separators.Split(name, -1) {
		for i := 0; i < len(part); {
			j := i
			switch {
			case isUpper(part[i]):
				for j < len(part) && isUpper(part[j]) {
					j++
				}
				switch {
				case j-1 > i && j < len(part) && isLower(part[j]):
					j-- // la sigla termina antes de la mayúscula de la palabra que sigue
				case j == i+1 && j < len(part) && isLower(part[j]):
					for j < len(part) && isLower(part[j]) {
						j++
					}
				}
			case isLower(part[i]):
				for j < len(part) && isLower(part[j]) {
					j++
				}
			case isDigit(part[i]):
				for j < len(part) && isDigit(part[j]) {
					j++
				}
			default:
				j++
			}
			out = append(out, strings.ToLower(part[i:j]))
			i = j
		}
	}
	return out
}

var regularPlural = regexp.MustCompile(`(s|x|z|ch|sh)es$`)

// BaseForms: la palabra y sus formas de base inglesas. Se cuida de NO convertir un plural español en
// inglés: `-es` sólo se quita tras s/x/z/ch/sh (`classes`, `matches`), así `partes` no pasa a ser `part`.
func BaseForms(word string) []string {
	out := []string{word}
	if strings.HasSuffix(word, "ies") && len(word) > 4 {
		out = append(out, word[:len(word)-3]+"y")
	}
	if regularPlural.MatchString(word) {
		out = append(out, word[:len(word)-2])
	}
	if strings.HasSuffix(word, "s") && !strings.HasSuffix(word, "ss") && len(word) > 3 {
		out = append(out, word[:len(word)-1])
	}
	for _, suffix := range []string{"ed", "ing", "er", "ers"} {
		if strings.HasSuffix(word, suffix) && len(word) > len(suffix)+2 {
			stem := word[:len(word)-len(suffix)]
			out = append(out, stem, stem+"e")
			if stem[len(stem)-1] == stem[len(stem)-2] {
				out = append(out, stem[:len(stem)-1])
			}
		}
	}
	return out
}

func allDigits(w string) bool {
	if w == "" {
		return false
	}
	for i := 0; i < len(w); i++ {
		if !isDigit(w[i]) {
			return false
		}
	}
	return true
}

// ForeignWords: las palabras de `name` que no pasan como inglés.
func ForeignWords(name string, baseline map[string]int, allowed map[string]bool) []string {
	var out []string
	for _, word := range SplitWords(name) {
		if allDigits(word) || allowed[word] {
			continue
		}
		if Spanish[word] {
			out = append(out, word)
			continue
		}
		if len(word) < 3 {
			continue
		}
		english := false
		for _, form := range BaseForms(word) {
			if baseline[form] >= Threshold || allowed[form] {
				english = true
				break
			}
		}
		if !english {
			out = append(out, word)
		}
	}
	return out
}

// Allow es lo que dice naming-allow.txt: palabras, rutas con su motivo y claves JSON con su alcance.
type Allow struct {
	Words map[string]bool
	Paths map[string]string
	JSON  []JSONRule
}

// JSONRule: `json: <ruta>[:<tipo|clase>] <clave…|*>` — claves JSON en español aceptadas SÓLO ahí. <ruta>
// es un prefijo relativo a `tablero/`; el calificador opcional es la clase de aparición (`tag`, `map`,
// `index`) o el tipo de Go que la contiene (`areaCanon`).
type JSONRule struct {
	Where, Qualifier string
	Keys             map[string]bool
}

/* LoadAllow lee naming-allow.txt: una palabra por línea, `path: <ruta relativa a tablero/>  # motivo`, o
 * `json: …`. ⚠ Las líneas `json:` NO entran como palabras: si entraran, permitir la clave `rama` de
 * cuadrilla dejaría pasar cualquier identificador `rama`. */
func LoadAllow(path string) (Allow, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Allow{}, err
	}
	a := Allow{Words: map[string]bool{}, Paths: map[string]string{}}
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		text, reason, _ := strings.Cut(line, "#")
		text, reason = strings.TrimSpace(text), strings.TrimSpace(reason)
		switch {
		case text == "":
		case strings.HasPrefix(text, "json:"):
			fields := strings.Fields(text[len("json:"):])
			if len(fields) == 0 {
				continue
			}
			where, qualifier, _ := strings.Cut(fields[0], ":")
			a.JSON = append(a.JSON, JSONRule{Where: where, Qualifier: qualifier, Keys: set(fields[1:])})
		case strings.HasPrefix(text, "path:"):
			a.Paths[strings.TrimSpace(text[len("path:"):])] = reason
		default:
			for _, w := range strings.Fields(strings.ToLower(text)) {
				a.Words[w] = true
			}
		}
	}
	return a, nil
}

// JSONAllowed: ¿la clave `key` que aparece en `rel` (como `kind`, dentro de `ctx`) la acepta alguna regla?
func JSONAllowed(rel, kind, ctx, key string, rules []JSONRule) bool {
	for _, r := range rules {
		if !strings.HasPrefix(rel, r.Where) {
			continue
		}
		if r.Qualifier != "" && r.Qualifier != kind && !strings.HasPrefix(ctx, r.Qualifier+".") {
			continue
		}
		if r.Keys["*"] || r.Keys[key] {
			return true
		}
	}
	return false
}
