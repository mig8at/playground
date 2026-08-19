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
// explica (es el mismo motivo por el que los prototipos se enlazan por nombre de archivo); y así la
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
type Anotacion struct {
	Tipo  string `json:"tipo"`  // medicion | decision | pregunta | riesgo
	Fecha string `json:"fecha"` // YYYY-MM-DD
	Quien string `json:"quien"` // sólo pregunta: de quién se espera la respuesta
	Que   string `json:"que"`   // la afirmación, una línea
	Como  string `json:"como"`  // opcional: la consulta o el comando que la vuelve a comprobar
}

var (
	// El tipo se acepta con y sin tilde: quien escribe a mano no debería pelear con el acento.
	reAnotacion = regexp.MustCompile(`(?i)^>\s*\*\*(MEDICI[ÓO]N|DECISI[ÓO]N|PREGUNTA|RIESGO)\s*·\s*(\d{4}-\d{2}-\d{2})\s*(?:·\s*([^*]+?))?\s*\*\*\s*(?:—|--|-)?\s*(.*)$`)
	reCita      = regexp.MustCompile(`^>\s?(.*)$`)
)

var sinTilde = strings.NewReplacer("Ó", "O", "ó", "o")

// Anotaciones recoge los marcadores del cuerpo, en el orden en que aparecen.
//
// Las líneas de cita que siguen a un marcador son su `Como`: ahí va la consulta que la vuelve a
// comprobar. Es lo único que distingue una medición de una afirmación — sin eso, nadie sabe cómo
// verificar si sigue siendo cierta, y el número envejece sin que nadie se entere.
func Anotaciones(cuerpo string) []Anotacion {
	out := []Anotacion{}
	lineas := strings.Split(cuerpo, "\n")
	for i := 0; i < len(lineas); i++ {
		m := reAnotacion.FindStringSubmatch(strings.TrimSpace(lineas[i]))
		if m == nil {
			continue
		}
		a := Anotacion{
			Tipo:  strings.ToLower(sinTilde.Replace(strings.ToUpper(m[1]))),
			Fecha: m[2],
			Quien: strings.TrimSpace(strings.Trim(m[3], "· ")),
			Que:   strings.TrimSpace(m[4]),
		}
		// La continuación: las citas siguientes, hasta que se corta la cita o aparece otro marcador.
		var como []string
		for j := i + 1; j < len(lineas); j++ {
			l := strings.TrimSpace(lineas[j])
			if !strings.HasPrefix(l, ">") || reAnotacion.MatchString(l) {
				break
			}
			if c := reCita.FindStringSubmatch(l); c != nil {
				como = append(como, strings.TrimSpace(strings.Trim(c[1], "`")))
			}
			i = j
		}
		a.Como = strings.TrimSpace(strings.Join(como, "\n"))
		if a.Que != "" {
			out = append(out, a)
		}
	}
	return out
}
