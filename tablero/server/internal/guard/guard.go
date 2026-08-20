// Package guard tiene los patrones de lo que NO puede salir del playground hacia Jira o Slack.
//
// Es la FUENTE ÚNICA: el POST del server los re-aplica antes de escribir, `cmd/issue-create` los aplica
// antes de publicar y `cmd/tareas` los usa para decir si una tarea puede salir. `/api/guard` los expone
// para que un cliente los compile y bloquee el botón sin ir al server — hoy **nadie lo consume**: la UI
// manda el POST y muestra los `problems` que devuelve. Si algún día se usa, el patrón tiene que seguir
// siendo válido en JS además de RE2. Vive en `internal/` justamente porque tener el guard dentro de `cmd/web` obligaba a
// copiarlo para usarlo desde otro comando — y el comentario original ya advertía que dos copias
// habrían derivado. Tres, peor.
//
// Sintaxis compatible RE2 (Go) y JS a la vez: nada de lookbehind ni named groups, porque la UI
// compila estos mismos patrones en el navegador.
package guard

import "regexp"

// Pattern es una regla con su motivo. `What` es texto para mostrarle a una persona → va en español;
// el resto son identificadores. Se serializa tal cual para `/api/guard`.
type Pattern struct {
	Re   string `json:"re"`
	What string `json:"what"`
}

// Patterns es la lista prohibida. Un patrón nuevo tiene que ser válido en RE2 y en JS a la vez (ver
// arriba), pero NO hay que tocar el cliente: no existe una segunda copia de esta lista.
var Patterns = []Pattern{
	{`\bF-\d+\b`, "referencia a un hallazgo interno"},
	{`playground`, "menciona el playground"},
	{`harness|backend-e2e|legacy-backend|frontend-monorepo|creditop-woocommerce`, "nombra un repo interno"},
	{`[\w/-]+\.(ts|tsx|php|go|vue|json|mjs)\b`, "incluye una ruta de archivo"},
	// La trampa que trae `PLANTILLA-TAREA.md`: su guía va en comentarios HTML, y una tarea copiada y
	// llenada sin borrarlos publicaría «<!-- Qué se logra. Una oración… -->» en Jira. Y en general un
	// comentario es donde alguien deja la nota que NO quería que se vea.
	{`<!--`, "quedaron comentarios de la plantilla (o notas ocultas)"},
}

var compiled = func() []*regexp.Regexp {
	out := make([]*regexp.Regexp, len(Patterns))
	for i, p := range Patterns {
		out[i] = regexp.MustCompile(`(?i)` + p.Re)
	}
	return out
}()

// Violations devuelve qué reglas rompe un texto (vacío = publicable). Cada entrada trae `what` (el
// motivo, para mostrar) y `found` (el fragmento exacto que lo disparó, para poder corregirlo sin
// adivinar).
func Violations(text string) []map[string]string {
	var out []map[string]string
	for i, re := range compiled {
		if m := re.FindString(text); m != "" {
			out = append(out, map[string]string{"what": Patterns[i].What, "found": m})
		}
	}
	return out
}
