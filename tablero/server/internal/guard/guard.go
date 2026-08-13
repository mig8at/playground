// Package guard tiene los patrones de lo que NO puede salir del playground hacia Jira o Slack.
//
// Es la FUENTE ÚNICA: la UI los pide por `/api/guard` para bloquear el botón con feedback inmediato,
// el POST del server los re-aplica antes de escribir, y `cmd/issue-create` los aplica antes de
// publicar. Vive en `internal/` justamente porque tener el guard dentro de `cmd/web` obligaba a
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

// Patterns es la lista prohibida. Al agregar una regla, acordate de que la UI la compila también.
var Patterns = []Pattern{
	{`\bF-\d+\b`, "referencia a un hallazgo interno"},
	{`playground`, "menciona el playground"},
	{`harness|backend-e2e|legacy-backend|frontend-monorepo|creditop-woocommerce`, "nombra un repo interno"},
	{`[\w/-]+\.(ts|tsx|php|go|vue|json|mjs)\b`, "incluye una ruta de archivo"},
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
