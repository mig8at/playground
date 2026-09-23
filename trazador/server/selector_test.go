package main

import (
	"strings"
	"testing"
)

// El selector de las anclas del monolito y el reparto por backend. Su error no rompe nada: sale una traza
// «sin líneas de log» con los logs ahí, o una traza de qa con líneas de dev leídas como si fueran de qa.
// Los valores son los medidos en `creditopdev` el 2026-09-23.
var ambientesDev = []string{"development", "local", "testing"}

func TestElAmbienteConAlternativasSeComparaPorAlternativa(t *testing.T) {
	// Hasta el 2026-09-23 se comparaba `development|develop` ENTERO contra cada valor: nunca matcheaba,
	// el filtro de dev no se aplicaba y la nota decía que el valor no existía.
	sel, nota := selectorAmbiente("development|develop", ambientesDev)
	if sel != `{environment=~"development|develop"}` || nota != "" {
		t.Fatalf("una alternativa presente alcanza: %q · %q", sel, nota)
	}
}

func TestUnAmbienteQueNoExisteNoFiltraYLoDice(t *testing.T) {
	// El caso de la uReq 464709: `LOKI_ENV=qa` contra un stack que no tiene ese valor.
	sel, nota := selectorAmbiente("qa", ambientesDev)
	if sel != `{service_name=~".+"}` {
		t.Fatalf("sin un filtro que exista, se consulta sin filtrar: %q", sel)
	}
	if !strings.Contains(nota, `"qa"`) {
		t.Errorf("y se dice, nombrando el valor que faltó: %q", nota)
	}
}

func TestSinListaDeValoresElFiltroSeUsaIgual(t *testing.T) {
	// Si no se pudieron pedir los valores no hay contra qué comprobar: descartar el filtro sería decidir
	// por el usuario.
	if sel, _ := selectorAmbiente("local", nil); sel != `{environment=~"local"}` {
		t.Errorf("ambiente sin lista: %q", sel)
	}
}

// linea arma una línea como la deja `lineasYTraces`: las etiquetas del stream, dentro del contexto.
func linea(etiquetas ...string) Linea {
	ctx := map[string]any{}
	for i := 0; i+1 < len(etiquetas); i += 2 {
		ctx[etiquetas[i]] = etiquetas[i+1]
	}
	return Linea{ctx: ctx}
}

func TestUnaSolicitudQuePasaPorDosBackendsSeDice(t *testing.T) {
	// La uReq 502690: creada en qa, con el chequeo de cupo corrido por el backend de dev. No se filtra —
	// esas líneas son de ESTA solicitud—, pero tampoco pueden leerse como si las hubiera escrito qa.
	ls := []Linea{
		linea("service_name", "CreditopDev", "environment", "development"),
		linea("service_name", "CreditopDev", "environment", "development"),
		linea("service_name", "legacy-backend", "environment", "development"),
	}
	notas := repartoPorBackend(ls, "CreditopDev")
	if len(notas) != 1 || !strings.Contains(notas[0], "CreditopDev 2") || !strings.Contains(notas[0], "legacy-backend 1") {
		t.Fatalf("el reparto tiene que nombrar los dos backends con su conteo: %v", notas)
	}
}

func TestUnaSolicitudDeOtroAmbienteSeDice(t *testing.T) {
	// Con la BD compartida, una solicitud de dev se abre igual con el target qa.
	notas := repartoPorBackend([]Linea{linea("service_name", "legacy-backend", "environment", "development")}, "CreditopDev")
	if len(notas) != 1 || !strings.Contains(notas[0], "NINGUNA") {
		t.Fatalf("tiene que decir que el backend de este target no aparece: %v", notas)
	}
}

func TestLosMicroserviciosNoCuentanComoOtroBackend(t *testing.T) {
	// Una línea de un MS Go no dice de qué rama es (su ambiente vale `development` en los tres), y
	// contarlos daría «pasó por más de un backend» en cada traza que toque uno.
	ls := []Linea{
		linea("service_name", "CreditopDev", "environment", "development"),
		linea("service_name", "self-manager-api", "deployment_environment", "development"),
	}
	if notas := repartoPorBackend(ls, "CreditopDev"); len(notas) != 0 {
		t.Fatalf("un MS no es otro backend: %v", notas)
	}
	if notas := repartoPorBackend(ls, ""); len(notas) != 0 {
		t.Fatalf("sin LOKI_SERVICE no hay contra qué comparar: %v", notas)
	}
}
