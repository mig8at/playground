package store

import (
	"strings"
	"testing"
)

// Los casos son `Cómo` REALES, copiados de las tareas: un test con ejemplos inventados prueba que la
// regex hace lo que la regex hace, no que sirva para lo que hay escrito.

func TestSourcesOfRealCases(t *testing.T) {
	cases := []struct {
		name  string
		how   string
		wants []string
	}{
		{
			"el forense del arnés, con su ambiente",
			"`make harness-loki UREQ=502463 TARGET=staging SINCE=72h`",
			[]string{"harness", "Loki", "staging"},
		},
		{
			"la traza por etapas",
			"**Cómo se vuelve a comprobar:** `make trazador-ureq UREQ=466846 TARGET=local`",
			[]string{"trazador", "local"},
		},
		{
			"una consulta contra prod",
			"`make trazador-sql TARGET=prod SQL='SELECT id FROM user_requests WHERE lender_id=77'`",
			[]string{"DB", "prod"},
		},
		{
			"una consulta nueva conserva sólo DB y ambiente",
			"> **DB · prod**\n>\n> \x60\x60\x60sql\n> SELECT id FROM user_requests WHERE lender_id=77\n> \x60\x60\x60",
			[]string{"DB", "prod"},
		},
		{
			"verificación contra main",
			"`git grep -c standBy origin/qa -- apps/loan-request-wizard` y `git ls-tree -r --name-only origin/main`",
			[]string{"git"},
		},
		{
			"una expresión métrica de Loki",
			`QUERY='sum(count_over_time({environment="qa"} [720h]))'`,
			[]string{"Loki"},
		},
		{
			"el caminador contra qa",
			"E2E_TARGET=qa node dev/caminar-wizard.ts --casos '#13874eb6:77' --flow ecommerce --cerrar",
			[]string{"harness", "qa"},
		},
		{
			"dos ambientes en el mismo cómo: el caso y su control",
			"corrido con TARGET=qa y el control con TARGET=local",
			[]string{"local", "qa"},
		},
		{
			"la receta está en otra sección de la misma tarea: no es «sin cómo»",
			"las tres corridas de §«Cómo se comprueba», y el desenlace en la base",
			[]string{"receta"},
		},
	}
	for _, c := range cases {
		got := SourcesOf(c.how)
		if strings.Join(got, ",") != strings.Join(c.wants, ",") {
			t.Errorf("%s:\n  got  %v\n  want %v", c.name, got, c.wants)
		}
	}
}

func TestSourcesOfDoesNotInvent(t *testing.T) {
	// Una anotación sin `Cómo` no tiene fuentes, y eso es lo que hay que poder VER: una afirmación que
	// nadie puede volver a comprobar. Inventarle una etiqueta la haría parecer verificada.
	if f := SourcesOf(""); f != nil {
		t.Errorf("sin cómo no puede haber fuentes: %v", f)
	}
	if f := SourcesOf("   \n  "); f != nil {
		t.Errorf("un cómo en blanco tampoco: %v", f)
	}
	// Prosa que NOMBRA herramientas sin haberlas corrido: mencionar no es medir.
	if f := SourcesOf("lo vimos en el panel y lo confirmó Joel por Slack"); f != nil {
		t.Errorf("la prosa no es una fuente: %v", f)
	}
}

func TestEnvironmentComesFromCommand_NotFromProse(t *testing.T) {
	// «en producción son 14.160 checkouts» habla DE prod, pero no se midió CONTRA prod desde ese cómo.
	// Confundir las dos cosas le daría peso de producción a una afirmación que no lo tiene.
	if f := SourcesOf("en producción son 14.160 checkouts en 6 meses"); f != nil {
		t.Errorf("la prosa no fija el ambiente: %v", f)
	}
	f := SourcesOf("make tablero-db TARGET=prod SQL='SELECT count(*) FROM user_requests'")
	if len(f) == 0 || f[len(f)-1] != "prod" {
		t.Errorf("el ambiente del comando sí: %v", f)
	}
}

func TestIsEnvironmentSeparatesBothCases(t *testing.T) {
	for _, a := range []string{"prod", "qa", "staging", "dev", "local"} {
		if !IsEnvironment(a) {
			t.Errorf("%q es un ambiente", a)
		}
	}
	for _, h := range []string{"harness", "trazador", "DB", "Loki", "PostHog", "git", "HTTP", "navegador"} {
		if IsEnvironment(h) {
			t.Errorf("%q es una herramienta, no un ambiente", h)
		}
	}
}
