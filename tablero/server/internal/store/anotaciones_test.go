package store

import "testing"

func TestAnotaciones(t *testing.T) {
	cuerpo := "" +
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

	got := Anotaciones(cuerpo)
	if len(got) != 4 {
		t.Fatalf("esperaba 4 anotaciones, hubo %d: %+v", len(got), got)
	}

	// La medición: sin el `como` no se puede volver a comprobar, que es su única razón de ser.
	if got[0].Tipo != "medicion" || got[0].Fecha != "2026-08-18" {
		t.Errorf("medición mal parseada: %+v", got[0])
	}
	if got[0].Como != "SELECT SUM(x) FROM kyc_name_checks" {
		t.Errorf("el `como` no se recogió o quedaron los backticks: %q", got[0].Como)
	}

	// Sin tilde tiene que valer: quien escribe a mano no debería pelear con el acento.
	if got[1].Tipo != "decision" {
		t.Errorf("«DECISION» sin tilde debería valer: %+v", got[1])
	}

	// El tercer campo es de quién se espera la respuesta, y sólo lo trae `pregunta`.
	if got[2].Tipo != "pregunta" || got[2].Quien != "Joel" {
		t.Errorf("el dueño de la pregunta se perdió: %+v", got[2])
	}
	if got[2].Que == "" || got[3].Tipo != "riesgo" {
		t.Errorf("cola mal parseada: %+v %+v", got[2], got[3])
	}

	// Dos marcadores pegados no se mezclan: el segundo no puede tragarse como `como` al tercero.
	if got[1].Como != "" {
		t.Errorf("una anotación se comió a la siguiente: %q", got[1].Como)
	}
}

func TestAnotacionesSinNada(t *testing.T) {
	if n := len(Anotaciones("sólo prosa\n> una cita suelta\n")); n != 0 {
		t.Fatalf("no debería encontrar anotaciones, encontró %d", n)
	}
}
