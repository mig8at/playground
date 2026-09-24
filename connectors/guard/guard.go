// Package guard tiene los patrones de lo que NO puede salir del playground hacia Jira o Slack.
//
// Es la FUENTE ÚNICA: el aviso a QA del server los aplica antes de mandar el DM, `cmd/issue-create` antes
// de publicar, `make bitacora-add` antes de escribir, y `cmd/tasks` los usa para decir si una tarea puede
// salir. Vive en `internal/` justamente porque tener el guard dentro de `cmd/web` obligaba a copiarlo
// para usarlo desde otro comando — y el comentario original ya advertía que dos copias habrían
// derivado. Tres, peor.
//
// Sintaxis RE2 (Go). Hasta el 2026-09-23 además tenían que valer en JS, porque `/api/guard` los servía
// para que la UI los compilara en el navegador; nunca tuvo quien lo llamara y se retiró.
package guard

import "regexp"

// Pattern es una regla con su motivo. `What` es texto para mostrarle a una persona → va en español;
// el resto son identificadores.
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
	// La trampa que trae `TASK-TEMPLATE.md`: su guía va en comentarios HTML, y una tarea copiada y
	// llenada sin borrarlos publicaría «<!-- Qué se logra. Una oración… -->» en Jira. Y en general un
	// comentario es donde alguien deja la nota que NO quería que se vea.
	{`<!--`, "quedaron comentarios de la plantilla (o notas ocultas)"},
	// LAS HERRAMIENTAS PROPIAS NO SE NOMBRAN AFUERA. Son de Miguel y nadie más las corre, así que
	// citarlas en Jira manda al lector a algo que no tiene — y peor, hace parecer que la prueba depende
	// de una herramienta personal. Lo que SÍ va es QUÉ se hizo, en general: se recorrió el flujo, se
	// consultó producción, se corrió una migración, se sembró un dato. Por eso cada motivo dice con qué
	// reemplazarlo: un guard que sólo prohíbe hace borrar información, uno que traduce la conserva.
	//
	// ⚠ Los patrones son ESPECÍFICOS a propósito, y la lista de lo que quedó afuera importa tanto como
	// la de adentro: `canon` es el pago mensual del renting (6 tareas lo usan así), `panel` es el de
	// administración del producto, `suite` es la de PHPUnit del repo real y `plantillas` son las del
	// contrato. Medido el 2026-09-15 sobre las 32 publicables: con estos patrones no se frena ninguna
	// —son red de seguridad, no un cambio de reglas—, y buscar palabras comunes habría dado 7 falsos
	// positivos, todos legítimos.
	{`\bmake\s+[a-z][a-z0-9-]{2,}\b`, "cita un comando de mis herramientas — decí QUÉ se hizo (se recorrió el flujo, se consultó la base), no con qué"},
	{`E2E_TARGET|I_KNOW_THIS_[A-Z_]+`, "nombra una variable de mis herramientas — el ambiente se dice por su nombre (dev, qa, staging, producción)"},
	{`\btrazador\b|\bcredibot\b|\bcredibrain\b|\bcuadrilla\b`, "nombra una herramienta propia que nadie más corre — decí el resultado, no la herramienta"},
	{`localhost|127\.0\.0\.1|:5[0-9]{3}\b`, "apunta a algo que corre en mi máquina — nombrá el ambiente compartido donde QA lo puede ver"},
}

// companyHosts son las direcciones de las herramientas internas DE LA COMPAÑÍA (`playground.creditop.com` y
// sus subdominios). Se quitan del texto antes de mirar las reglas: desde que cuadrilla, credibot y credibrain
// se mudaron al repo compartido, esos nombres son también hosts reales que infraestructura configura —
// una tarea para poner el login en `cuadrilla.playground.creditop.com` no se puede escribir sin nombrarlo.
// Lo que sigue frenando es el nombre SUELTO: «el playground», «la cuadrilla», sin el dominio.
var companyHosts = regexp.MustCompile(`(?i)\b(?:[a-z0-9-]+\.)*playground\.creditop\.com\b`)

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
	text = companyHosts.ReplaceAllString(text, "")
	var out []map[string]string
	for i, re := range compiled {
		if m := re.FindString(text); m != "" {
			out = append(out, map[string]string{"what": Patterns[i].What, "found": m})
		}
	}
	return out
}
