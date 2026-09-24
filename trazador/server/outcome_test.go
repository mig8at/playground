package main

// Las pruebas de la LÓGICA PURA del trazador: las funciones que traducen un dato de la BD a una
// afirmación del diagnóstico, sin pedirle nada a ninguna fuente.
//
// POR QUÉ ESTAS Y NO OTRAS. El harness tiene diez specs en `pkg/` que no tocan browser ni BD, y el
// criterio de qué se cubre ahí es el mismo que acá: **la lógica que ya produjo un diagnóstico
// equivocado**. No es cobertura por cobertura — son las dos funciones cuyo error no rompe nada y sale
// prolijo, que es la clase de bug más cara de esta herramienta.

import (
	"strings"
	"testing"
)

// outcomeOf existe porque HABÍA DOS DEFINICIONES y no coincidían: `BuildTrace` contemplaba
// `abandonado` (estado 7) y el buscador de la API no, así que la misma solicitud salía «en curso» en la
// lista de intentos y «abandonado» al abrirla. Unificarlas arregló el síntoma; esta prueba es lo que
// impide que se vuelva a partir sin que nadie se entere.
func TestOutcomeOfCoversTheFourAndStatus7(t *testing.T) {
	cases := []struct {
		status  int
		want    string
		because string
	}{
		{11, "aprobado", "el sello clásico"},
		{25, "aprobado", "el sello del canal QR, que NUNCA pasa por 11"},
		{5, "aprobado", "desembolsada"},
		{6, "roto", "negada"},
		{8, "roto", "cancelado"},
		{24, "roto", "rechazado por identidad"},
		{7, "abandonado", "EL QUE FALTABA en una de las dos definiciones"},
		{9, "en-curso", "formulario de perfil: está adentro, no terminó"},
		{0, "en-curso", "sin estado conocido no se afirma un desenlace"},
	}
	for _, c := range cases {
		if got := outcomeOf(c.status); got != c.want {
			t.Errorf("estado %d → %q, esperaba %q (%s)", c.status, got, c.want, c.because)
		}
	}
}

// ⚠ Un estado no puede ser sello Y malo a la vez: si alguien agrega uno a las dos tablas, `outcomeOf`
// lo resuelve por el ORDEN del switch —gana «aprobado»— y una solicitud negada saldría verde. El orden
// es una decisión invisible; esto la vuelve una regla.
func TestNoStatusIsBothSealAndBad(t *testing.T) {
	for e := range sealed {
		if badStatuses[e] != "" {
			t.Errorf("el estado %d está en `sellados` Y en `malos` (%q): desenlaceDe lo daría por APROBADO", e, badStatuses[e])
		}
	}
}

// laneOfRT decide por cuál de las variantes de flujo fue una solicitud, y de eso cuelga qué etapas se
// declaran «no aplica». Un ramal que el código devuelve y el mapa no declara deja esas etapas sin
// clasificar: se dibujan como «podía pasar y no pasó» cuando en realidad ahí no se pasa nunca — que son
// diagnósticos opuestos.
func TestEveryLaneTheCodeReturnsIsDeclaredInTheMap(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatalf("el mapa no carga: %v", err)
	}
	declared := map[string]bool{}
	for _, r := range m.Lanes {
		declared[r.ID] = true
	}
	// Los cuatro caminos del switch, más el hardcode de identidad.
	for _, c := range []struct {
		id  int64
		rt  int
		qué string
	}{
		{1, 2, "rt=2"}, {1, 3, "rt=3"}, {1, 4, "rt=4"},
		{1, 1, "rt=1"}, {1, 0, "rt=0"}, {1, 99, "un rt que nadie declaró"},
		{24, 0, "Credifamilia, que se decide por ID y no por rt"},
	} {
		got := laneOfRT(c.id, c.rt)
		if !declared[got] {
			t.Errorf("%s → ramal %q, que ramales.json no declara", c.qué, got)
		}
	}
}

// ⚠ EL HARDCODE ESTÁ A LA VISTA A PROPÓSITO. `laneOfRT` decide Credifamilia por `id == 24`, o sea por
// IDENTIDAD y no por configuración: es deuda conocida (un id quemado en el código, no en la config) y
// el día que Credifamilia deje de ser el lender 24 —o que otro lender necesite ese ramal— esto miente en
// silencio. La prueba no lo arregla; lo deja escrito para que el cambio sea deliberado.
func TestCredifamiliaIsDecidedByIdentityNotByItsResponseType(t *testing.T) {
	if got := laneOfRT(24, 0); got != "credifamilia" {
		t.Errorf("el lender 24 debería caer en credifamilia, dio %q", got)
	}
	// Otro lender con el MISMO response_type no cae ahí: la diferencia es la identidad, no el tipo.
	if got := laneOfRT(999, 0); got == "credifamilia" {
		t.Errorf("un lender que no es el 24 no debería caer en credifamilia (rt=0 → redirect), dio %q", got)
	}
	if got := laneOfRT(24, 2); got != "credifamilia" {
		t.Errorf("el id gana sobre el rt: el 24 con rt=2 debería seguir en credifamilia, dio %q", got)
	}
}

// ⚠ UN MATCHER NO SE ANCLA EN EL NÚMERO DE UN STAGE, y esto costó seis patrones mudos.
//
// El pipeline de Experian numera sus pasos (`STAGE 2 — Frequency review`) y esos números son el ORDEN,
// que cambia cuando alguien reordena. Medido el 2026-09-18 contra `origin/main`: «Frequency review» pasó
// de 2 a 4, «Check flow omitions» de 3 a 2 y «Bypass rules review» de 4 a 3 — y los cinco matchers
// anclados al número quedaron mudos **sin que nada avisara**, porque un matcher que no captura no falla:
// sus líneas caen en «sin ubicar» y la etapa se dibuja más vacía de lo que fue.
//
// Lo estable es el NOMBRE. Y el nombre además distingue este pipeline del de `FlowSignatureService`, que
// tiene sus propios STAGE 0-2 con otros nombres: un `^STAGE \d+` a secas se los comería.
func TestNoMatcherAnchorsToAStageNumber(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatalf("el mapa no carga: %v", err)
	}
	for _, e := range m.Stages {
		for _, mt := range e.Matchers {
			if mt.Kind == "regex" {
				continue // `^STAGE \d+ — Nombre` es justamente la forma correcta
			}
			if len(mt.Pattern) > 7 && strings.HasPrefix(mt.Pattern, "STAGE ") && mt.Pattern[6] >= '0' && mt.Pattern[6] <= '9' {
				t.Errorf("etapa %s: el patrón %q ancla en el NÚMERO del stage; usá regex con el nombre "+
					"(`^STAGE \\d+ — ...`), porque el número es el orden del pipeline y se renumera",
					e.ID, mt.Pattern)
			}
		}
	}
}
