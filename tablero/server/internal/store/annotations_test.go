package store

import (
	"strings"
	"testing"
)

func TestDatedRecordsFindsWhatBelongsToTheStack(t *testing.T) {
	body := "" +
		"Prosa cualquiera.\n" +
		"\n" +
		"> **MEDICIÓN · 2026-08-18** — el 86,6% de las consultas no pasa por el contador.\n" +
		"> `SELECT SUM(x) FROM kyc_name_checks`\n" +
		"> **DECISION · 2026-08-18** — sin tilde también vale.\n" +
		"> **PREGUNTA · 2026-08-15 · Joel** — ¿cuándo aterriza el TusDatos nuevo?\n" +
		"> **CANON · 2026-09-22 · leído** — `listado/context#regla` — se usó para decidir.\n" +
		"> una cita normal, que NO es un registro\n" +
		"\n" +
		"## Si retomás esto sin contexto, empezá acá\n" +
		"\n" +
		"## Registro\n" +
		"\n" +
		"### 2026-09-21\n"
	got := DatedRecords(body)
	var whats []string
	for _, r := range got {
		whats = append(whats, r.What)
	}
	want := []string{
		"la anotación MEDICIÓN del 2026-08-18",
		"la anotación DECISION del 2026-08-18",
		"la anotación PREGUNTA del 2026-08-15",
		"el marcador CANON del 2026-09-22",
		"la sección de retoma («Si retomás esto sin contexto»)",
		"la sección «Registro»",
	}
	if strings.Join(whats, "|") != strings.Join(want, "|") {
		t.Fatalf("registros:\n  got  %q\n  want %q", whats, want)
	}
	if got[0].Line != 3 || got[5].Line != 12 {
		t.Errorf("las líneas son las del texto recibido: %+v", got)
	}
}

// Un ejemplo del formato escrito como código no es un registro: el lint no puede frenar a quien
// documenta el formato viejo.
func TestDatedRecordsIgnoresCodeBlocks(t *testing.T) {
	body := "```markdown\n> **MEDICIÓN · 2026-08-18** — ejemplo\n## Registro\n```\n\n> ```\n> ## Registro\n> ```\n"
	if got := DatedRecords(body); len(got) != 0 {
		t.Fatalf("no hay registros fuera del código, y encontró %+v", got)
	}
}

// Un comentario HTML tampoco: la plantilla vieja traía los ejemplos de anotación comentados, y una tarea
// copiada de ella los conserva.
func TestDatedRecordsIgnoresHTMLComments(t *testing.T) {
	body := "<!-- Pestaña Hallazgos:\n> **DECISIÓN · 2026-08-20** — el filtro va por comercio.\n-->\n" +
		"<!-- una línea -->\n> **RIESGO · 2026-08-21** — éste sí cuenta.\n"
	got := DatedRecords(body)
	if len(got) != 1 || got[0].What != "la anotación RIESGO del 2026-08-21" || got[0].Line != 5 {
		t.Fatalf("sólo cuenta lo que está fuera del comentario: %+v", got)
	}
}

func TestDatedRecordsOnAPlainDocument(t *testing.T) {
	body := "## Objetivo\n\nProsa.\n\n## Pendientes\n\n- [ ] algo\n\n> una cita suelta\n"
	if got := DatedRecords(body); len(got) != 0 {
		t.Fatalf("un documento sin historia no tiene registros: %+v", got)
	}
}
