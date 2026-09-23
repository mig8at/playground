package store

import (
	"fmt"
	"regexp"
	"strings"
)

// LO QUE YA NO VA EN EL DOCUMENTO DE UNA TAREA: los registros con fecha.
//
// Hasta el 2026-09-23 el cuerpo de una tarea llevaba cuatro cosas con fecha metidas en la prosa: las
// anotaciones (`> **MEDICIÓN · fecha** — …`, y DECISIÓN, PREGUNTA, RIESGO), el `## Registro` de qué pasó
// cada día, la sección de retoma («Si retomás esto sin contexto») y los marcadores de uso de canon
// (`> **CANON · fecha** — …`). Ese día pasaron a la PILA de la tarea (`tasks/<slug>/context.jsonl`) como
// bloques con su fecha: la historia en un solo lugar, y el documento con lo que sigue siendo cierto —el
// plan, el material, los pendientes—. Ver el paquete `taskcontext`.
//
// Por eso este archivo ya no las parsea para mostrarlas: las RECONOCE, para que el lint de las tareas
// frene una nueva y diga adónde va. El marcador de anotación sigue siendo el formato de los documentos
// que NO son una tarea —los `CLAUDE.md`, las trampas del sistema— y lo que el arnés y el trazador
// imprimen con `MD=1`: `harness/pkg/anotacion.spec.ts` lee `reAnnotation` de acá para comprobar que lo
// que emite el arnés es lo que el tablero reconoce como anotación.
var (
	// El tipo se acepta con y sin tilde: quien escribe a mano no debería pelear con el acento.
	reAnnotation = regexp.MustCompile(`(?i)^>\s*\*\*(MEDICI[ÓO]N|DECISI[ÓO]N|PREGUNTA|RIESGO)\s*·\s*(\d{4}-\d{2}-\d{2})\s*(?:·\s*([^*]+?))?\s*\*\*\s*(?:—|--|-)?\s*(.*)$`)
	reCanonMark  = regexp.MustCompile(`(?i)^>\s*\*\*CANON\s*·\s*(\d{4}-\d{2}-\d{2})`)
	reRecordHead = regexp.MustCompile(`(?i)^##\s+(Registro|Bit[áa]cora)\s*$`)
	reResumeHead = regexp.MustCompile(`(?i)^##\s+[0-9.·\s]*si retom[áa]s`)
	reCodeFence  = regexp.MustCompile("^\\s*(?:>\\s*)*```")
)

// DatedRecord es un registro con fecha que está en el documento: en qué línea y qué es.
type DatedRecord struct {
	Line int    // 1 = la primera línea del texto recibido
	What string // «la anotación MEDICIÓN del 2026-09-18», «la sección «Registro»»…
}

// DatedRecords devuelve los registros con fecha de un cuerpo de tarea, sin mirar adentro de los bloques
// de código ni de los comentarios HTML: un ejemplo del formato —la plantilla vieja los traía comentados—
// no es un registro.
func DatedRecords(body string) []DatedRecord {
	var out []DatedRecord
	inside, comment := false, false
	for i, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		if comment {
			comment = !strings.Contains(raw, "-->")
			continue
		}
		if !inside && strings.HasPrefix(line, "<!--") {
			comment = !strings.Contains(line[4:], "-->")
			continue
		}
		if reCodeFence.MatchString(raw) {
			inside = !inside
			continue
		}
		if inside {
			continue
		}
		switch m := reAnnotation.FindStringSubmatch(line); {
		case m != nil:
			out = append(out, DatedRecord{i + 1, fmt.Sprintf("la anotación %s del %s", strings.ToUpper(m[1]), m[2])})
		case reCanonMark.MatchString(line):
			out = append(out, DatedRecord{i + 1, fmt.Sprintf("el marcador CANON del %s", reCanonMark.FindStringSubmatch(line)[1])})
		case reRecordHead.MatchString(raw):
			out = append(out, DatedRecord{i + 1, fmt.Sprintf("la sección «%s»", strings.TrimSpace(strings.TrimPrefix(raw, "##")))})
		case reResumeHead.MatchString(raw):
			out = append(out, DatedRecord{i + 1, "la sección de retoma («Si retomás esto sin contexto»)"})
		}
	}
	return out
}
