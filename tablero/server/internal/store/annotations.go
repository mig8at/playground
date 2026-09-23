package store

import (
	"regexp"
	"strings"
)

// ANOTACIONES: los hechos con fecha que una tarea produce y que la prosa no sabe conservar.
//
// El cuerpo de una tarea es narración, y ahí una medición se lee bien el día que se escribe y miente
// tres semanas después, porque nada dice cuándo se tomó ni cómo volver a tomarla. Lo mismo con una
// decisión (se re-discute) y con una pregunta abierta (nadie ve que lleva cinco días sin respuesta).
//
// La forma es un MARCADOR EN LÍNEA dentro del cuerpo, no una lista en el frontmatter. Tres razones:
// el parser de frontmatter sólo entiende escalares; una lista aparte se desincroniza del texto que la
// explica (es el mismo motivo por el que los artifacts son lo que hay en la carpeta de la tarea); y así la
// anotación vive DONDE se argumenta, que es donde se entiende.
//
//	> **MEDICIÓN · 2026-08-18** — el 86,6% de las consultas no pasa por el contador.
//	> `SELECT ... FROM kyc_name_checks`
//
//	> **DECISIÓN · 2026-08-18** — los drivers fake de burós quedan sin usar.
//	> **PREGUNTA · 2026-08-15 · Joel** — ¿cuándo aterriza el TusDatos nuevo?
//	> **RIESGO · 2026-08-18** — el harness se rompe cuando esto mergee.
//
// Se eligió la cita de markdown porque se ve distinta al leer el archivo a pelo —que es como lo lee
// un modelo— y no necesita que nadie mantenga un índice.
type Annotation struct {
	Kind string `json:"kind"` // medicion | decision | pregunta | riesgo
	Date string `json:"date"` // YYYY-MM-DD
	Who  string `json:"who"`  // sólo pregunta: de quién se espera la respuesta
	What string `json:"what"` // la afirmación, una línea
	How  string `json:"how"`  // opcional: la consulta o el comando ya limpio de Markdown
	// Sources: con QUÉ se comprobó y contra qué ambiente, DERIVADO del `How` (ver sources.go). Vacío
	// cuando no hay `How` o cuando no matchea ninguna herramienta conocida — que es un dato, no un
	// hueco: dice que esa afirmación no trae con qué volver a comprobarla.
	Sources []string `json:"sources,omitempty"`
}

var (
	// El tipo se acepta con y sin tilde: quien escribe a mano no debería pelear con el acento.
	reAnnotation = regexp.MustCompile(`(?i)^>\s*\*\*(MEDICI[ÓO]N|DECISI[ÓO]N|PREGUNTA|RIESGO)\s*·\s*(\d{4}-\d{2}-\d{2})\s*(?:·\s*([^*]+?))?\s*\*\*\s*(?:—|--|-)?\s*(.*)$`)
	reCitation   = regexp.MustCompile(`^>\s?(.*)$`)
	// El documento conserva una consulta como Markdown normal dentro de la cita. La tarjeta no debe
	// mostrar ese Markdown como texto dentro de otro `<pre>`: recibe sólo el SQL de su fence.
	reSQLFence = regexp.MustCompile("(?is)(?:^|\\n)\\s*```sql\\s*\\n(.*?)\\n\\s*```(?:\\s*(?:\\n|$))")
)

var withoutAccent = strings.NewReplacer("Ó", "O", "ó", "o")

func asVisible(raw string) string {
	raw = strings.TrimSpace(raw)
	if match := reSQLFence.FindStringSubmatch(raw); match != nil {
		return strings.TrimSpace(match[1])
	}
	// Las recetas cortas históricas se escribieron entre backticks. El pre de la UI no necesita
	// conservar esa capa de Markdown, igual que no necesita conservar los fences SQL.
	return strings.TrimSpace(strings.Trim(raw, "`"))
}

// Annotations recoge los marcadores del cuerpo, en el orden en que aparecen.
//
// Las líneas de cita que siguen a un marcador son su `How`: ahí va la consulta que la vuelve a
// comprobar. Es lo único que distingue una medición de una afirmación — sin eso, nadie sabe cómo
// verificar si sigue siendo cierta, y el número envejece sin que nadie se entere.
func Annotations(body string) []Annotation {
	out := []Annotation{}
	lines := strings.Split(body, "\n")
	for i := 0; i < len(lines); i++ {
		m := reAnnotation.FindStringSubmatch(strings.TrimSpace(lines[i]))
		if m == nil {
			continue
		}
		a := Annotation{
			Kind: strings.ToLower(withoutAccent.Replace(strings.ToUpper(m[1]))),
			Date: m[2],
			Who:  strings.TrimSpace(strings.Trim(m[3], "· ")),
			What: strings.TrimSpace(m[4]),
		}
		// La continuación: las citas siguientes, hasta que se corta la cita o aparece otro marcador.
		var how []string
		for j := i + 1; j < len(lines); j++ {
			l := strings.TrimSpace(lines[j])
			if !strings.HasPrefix(l, ">") || reAnnotation.MatchString(l) {
				break
			}
			if c := reCitation.FindStringSubmatch(l); c != nil {
				// Se conserva el fence hasta `asVisible`: quitar sus backticks aquí convertía
				// ```sql en texto "sql" y después la UI terminaba mostrando Markdown crudo.
				how = append(how, strings.TrimSpace(c[1]))
			}
			i = j
		}
		rawHow := strings.TrimSpace(strings.Join(how, "\n"))
		a.How = asVisible(rawHow)
		// Sources usa la forma original porque `**DB · prod**` indica el ambiente, mientras que la
		// tarjeta sólo necesita la consulta pura para presentarla como SQL.
		a.Sources = SourcesOf(rawHow)
		if a.What != "" {
			out = append(out, a)
		}
	}
	return out
}
