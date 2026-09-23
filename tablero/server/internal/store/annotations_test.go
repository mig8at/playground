package store

import (
	"strings"
	"testing"
)

func TestAnnotations(t *testing.T) {
	body := "" +
		"Prosa cualquiera que no es una anotación.\n" +
		"\n" +
		"> **MEDICIÓN · 2026-08-18** — el 86,6% de las consultas no pasa por el contador.\n" +
		"> `SELECT SUM(x) FROM kyc_name_checks`\n" +
		"\n" +
		"Más prosa en el medio.\n" +
		"\n" +
		"> **DECISION · 2026-08-18** — los drivers fake de burós quedan sin usar.\n" +
		"> **PREGUNTA · 2026-08-15 · Joel** — ¿cuándo aterriza el TusDatos nuevo?\n" +
		"> **RIESGO · 2026-08-18** — el harness se rompe cuando esto mergee.\n" +
		"\n" +
		"> una cita normal, que NO es anotación\n"

	got := Annotations(body)
	if len(got) != 4 {
		t.Fatalf("esperaba 4 anotaciones, hubo %d: %+v", len(got), got)
	}

	// La medición: sin el `como` no se puede volver a comprobar, que es su única razón de ser.
	if got[0].Kind != "medicion" || got[0].Date != "2026-08-18" {
		t.Errorf("medición mal parseada: %+v", got[0])
	}
	if got[0].How != "SELECT SUM(x) FROM kyc_name_checks" {
		t.Errorf("el `como` no se recogió o quedaron los backticks: %q", got[0].How)
	}

	// Sin tilde tiene que valer: quien escribe a mano no debería pelear con el acento.
	if got[1].Kind != "decision" {
		t.Errorf("«DECISION» sin tilde debería valer: %+v", got[1])
	}

	// El tercer campo es de quién se espera la respuesta, y sólo lo trae `pregunta`.
	if got[2].Kind != "pregunta" || got[2].Who != "Joel" {
		t.Errorf("el dueño de la pregunta se perdió: %+v", got[2])
	}
	if got[2].What == "" || got[3].Kind != "riesgo" {
		t.Errorf("cola mal parseada: %+v %+v", got[2], got[3])
	}

	// Dos marcadores pegados no se mezclan: el segundo no puede tragarse como `como` al tercero.
	if got[1].How != "" {
		t.Errorf("una anotación se comió a la siguiente: %q", got[1].How)
	}
}

func TestAnnotationsEmpty(t *testing.T) {
	if n := len(Annotations("sólo prosa\n> una cita suelta\n")); n != 0 {
		t.Fatalf("no debería encontrar anotaciones, encontró %d", n)
	}
}

func TestSQLAnnotationKeepsMarkdownOutOfCard(t *testing.T) {
	body := "> **MEDICIÓN · 2026-09-22** — la configuración fue confirmada.\n" +
		"> **DB · prod**\n>\n> ```sql\n" +
		"> SELECT id, status FROM user_requests WHERE id = 42\n> ```\n"
	got := Annotations(body)
	if len(got) != 1 {
		t.Fatalf("esperaba una anotación, hubo %d", len(got))
	}
	if got[0].How != "SELECT id, status FROM user_requests WHERE id = 42" {
		t.Errorf("la tarjeta debe recibir SQL puro, recibió %q", got[0].How)
	}
	if strings.Join(got[0].Sources, ",") != "DB,prod" {
		t.Errorf("la fuente y ambiente siguen saliendo del bloque Markdown: %v", got[0].Sources)
	}
}
