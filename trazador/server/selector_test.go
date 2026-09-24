package main

import (
	"strings"
	"testing"
)

// El selector de las anclas del monolito y el reparto por backend. Su error no rompe nada: sale una traza
// «sin líneas de log» con los logs ahí, o una traza de qa con líneas de dev leídas como si fueran de qa.
// Los valores son los medidos en `creditopdev` el 2026-09-23.
var devEnvironments = []string{"development", "local", "testing"}

func TestAnEnvironmentWithAlternativesIsComparedByAlternative(t *testing.T) {
	// Hasta el 2026-09-23 se comparaba `development|develop` ENTERO contra cada valor: nunca matcheaba,
	// el filtro de dev no se aplicaba y la nota decía que el valor no existía.
	sel, note := environmentSelector("development|develop", devEnvironments)
	if sel != `{environment=~"development|develop"}` || note != "" {
		t.Fatalf("una alternativa presente alcanza: %q · %q", sel, note)
	}
}

func TestAnUnknownEnvironmentDoesNotFilterAndSaysSo(t *testing.T) {
	// El caso de la uReq 464709: `LOKI_ENV=qa` contra un stack que no tiene ese valor.
	sel, note := environmentSelector("qa", devEnvironments)
	if sel != `{service_name=~".+"}` {
		t.Fatalf("sin un filtro que exista, se consulta sin filtrar: %q", sel)
	}
	if !strings.Contains(note, `"qa"`) {
		t.Errorf("y se dice, nombrando el valor que faltó: %q", note)
	}
}

func TestWithoutAValueListTheFilterIsStillUsed(t *testing.T) {
	// Si no se pudieron pedir los valores no hay contra qué comprobar: descartar el filtro sería decidir
	// por el usuario.
	if sel, _ := environmentSelector("local", nil); sel != `{environment=~"local"}` {
		t.Errorf("ambiente sin lista: %q", sel)
	}
}

// linea arma una línea como la deja `linesAndTraces`: las etiquetas del stream, dentro del contexto.
func sourceLine(labels ...string) Line {
	ctx := map[string]any{}
	for i := 0; i+1 < len(labels); i += 2 {
		ctx[labels[i]] = labels[i+1]
	}
	return Line{ctx: ctx}
}

func TestARequestThroughTwoBackendsIsReported(t *testing.T) {
	// La uReq 502690: creada en qa, con el chequeo de cupo corrido por el backend de dev. No se filtra —
	// esas líneas son de ESTA solicitud—, pero tampoco pueden leerse como si las hubiera escrito qa.
	ls := []Line{
		sourceLine("service_name", "CreditopDev", "environment", "development"),
		sourceLine("service_name", "CreditopDev", "environment", "development"),
		sourceLine("service_name", "legacy-backend", "environment", "development"),
	}
	notes := splitByBackend(ls, "CreditopDev")
	if len(notes) != 1 || !strings.Contains(notes[0], "CreditopDev 2") || !strings.Contains(notes[0], "legacy-backend 1") {
		t.Fatalf("el reparto tiene que nombrar los dos backends con su conteo: %v", notes)
	}
}

func TestARequestFromAnotherEnvironmentIsReported(t *testing.T) {
	// Con la BD compartida, una solicitud de dev se abre igual con el target qa.
	notes := splitByBackend([]Line{sourceLine("service_name", "legacy-backend", "environment", "development")}, "CreditopDev")
	if len(notes) != 1 || !strings.Contains(notes[0], "NINGUNA") {
		t.Fatalf("tiene que decir que el backend de este target no aparece: %v", notes)
	}
}

func TestMicroservicesDoNotCountAsAnotherBackend(t *testing.T) {
	// Una línea de un MS Go no dice de qué rama es (su ambiente vale `development` en los tres), y
	// contarlos daría «pasó por más de un backend» en cada traza que toque uno.
	ls := []Line{
		sourceLine("service_name", "CreditopDev", "environment", "development"),
		sourceLine("service_name", "self-manager-api", "deployment_environment", "development"),
	}
	if notes := splitByBackend(ls, "CreditopDev"); len(notes) != 0 {
		t.Fatalf("un MS no es otro backend: %v", notes)
	}
	if notes := splitByBackend(ls, ""); len(notes) != 0 {
		t.Fatalf("sin LOKI_SERVICE no hay contra qué comparar: %v", notes)
	}
}
