package store

import (
	"regexp"
	"sort"
	"strings"
)

// FUENTES: con QUÉ se comprobó una anotación, y CONTRA QUÉ ambiente.
//
// El porqué. El `Cómo` de una anotación ya trae el comando que la vuelve a comprobar —desde el
// 2026-09-18 varias herramientas lo emiten solas—, pero para leerlo hay que abrir la anotación y
// parsear un comando con la vista. Lo que uno quiere saber de un vistazo es otra cosa, y son dos
// preguntas distintas:
//
//   1. ¿con qué se comprobó?   una corrida del arnés no pesa lo mismo que un `git grep`
//   2. ¿contra qué ambiente?   «medido en prod» y «medido en local» son afirmaciones distintas,
//      y el archivo de una tarea las escribe igual
//
// Se DERIVA del texto, no se declara: un campo nuevo en el frontmatter sería otra lista que mantener a
// mano, y una lista a mano miente en silencio en cuanto alguien cambia el comando. Es el mismo criterio
// que ya usan los pendientes (casillas del cuerpo), las ramas (patrón + git) y las anotaciones mismas.
//
// ⚠ Y lo que NO hace, a propósito: no adivina. Si el `Cómo` no matchea ninguna herramienta conocida,
// devuelve vacío en vez de inventar una etiqueta — y una anotación SIN `Cómo` no tiene fuentes, que es
// justo lo que hay que poder ver: una afirmación que nadie puede volver a comprobar.

// Cada patrón es específico a propósito. Buscar palabras sueltas (`loki`, `sql`) daba falsos positivos
// sobre la prosa de las propias anotaciones, que hablan de esas cosas sin haberlas corrido.
var tools = []struct {
	name string
	re   *regexp.Regexp
}{
	// El arnés: sus targets de `make`, sus runners y Playwright.
	{"harness", regexp.MustCompile(`(?i)\bmake harness-|\bnode dev/|\bnpx playwright|\bdev/[a-z-]+\.(ts|spec\.ts)\b`)},
	// El trazador sólo reconstruye el comportamiento de una solicitud. SQL no entra: una consulta de
	// datos no se vuelve una traza por el lugar histórico desde donde se ejecutó.
	{"trazador", regexp.MustCompile(`(?i)\bmake trazador-(ureq|buscar|posthog|diag|chequeo|validar|slack|hilos)\b|\bgo run \. -(ureq|buscar|posthog|validar|slack)\b`)},
	// La base: una consulta escrita, sin atribuirla a Trazador. Las consultas antiguas conservan la
	// etiqueta DB para que el historial no se lea como una traza.
	{"DB", regexp.MustCompile(`(?i)\b(select|with)\b[\s\S]*\bfrom\b|\bmake (tablero-db|trazador-sql)\b|\bdbops\b`)},
	// Los logs: LogQL o el forense.
	{"Loki", regexp.MustCompile(`(?i)count_over_time|\{service_name=|\{environment=|\bloki-trace\b|\bmake harness-loki\b|\btrazador-acceso\b`)},
	{"PostHog", regexp.MustCompile(`(?i)\bposthog\b`)},
	// El código y su historia. `git grep` sobre una rama es la forma de verificar contra `main`.
	{"git", regexp.MustCompile(`(?i)\bgit (grep|log|show|ls-tree|cherry|merge-base|diff|rev-list)\b|\bgh (pr|run|issue)\b`)},
	// Una llamada HTTP a mano: el `curl` que contesta lo que el log no.
	{"HTTP", regexp.MustCompile(`(?i)\bcurl\b|\bhttp(s)?://`)},
	// El navegador de verdad, que es la única fuente de lo que el cliente VE.
	{"navegador", regexp.MustCompile(`(?i)\bnavegador\b|--headed|\bchromium\b|matchRoutes`)},
	// La receta vive en otra sección de la MISMA tarea («las tres corridas de §Cómo se comprueba»). No es
	// una herramienta, pero tampoco es «no se puede comprobar»: hay que distinguirlas o la etiqueta
	// castiga a una anotación que sí dice cómo, sólo que sin repetir el comando.
	{"receta", regexp.MustCompile(`(?i)§\s*«?c[óo]mo se comprueba|ver §|«c[óo]mo se comprueba»`)},
}

// El ambiente sale de cómo se escribe en los comandos de la casa (`TARGET=` / `E2E_TARGET=`), y sólo de
// ahí: deducirlo de la prosa —«en producción son 14.160»— confundiría el ambiente donde se MIDIÓ con el
// que la frase menciona, que no es lo mismo.
var reEnvironment = regexp.MustCompile(`(?i)\b(?:E2E_)?(?:CFE_)?TARGET=(prod|production|qa|staging|dev|develop|local)\b|\bDB\s*·\s*(prod|production|qa|staging|dev|develop|local)\b`)

var canonEnvironment = map[string]string{
	"prod": "prod", "production": "prod", "qa": "qa",
	"staging": "staging", "dev": "dev", "develop": "dev", "local": "local",
}

// SourcesOf devuelve las herramientas y el ambiente de un `Cómo`, en orden estable.
//
// El ambiente va al final y con su nombre a secas (`prod`, `local`): en la tarjeta se pinta distinto,
// porque no es una herramienta — es cuánto pesa lo que se afirma.
func SourcesOf(how string) []string {
	if strings.TrimSpace(how) == "" {
		return nil
	}
	var out []string
	for _, h := range tools {
		if h.re.MatchString(how) {
			out = append(out, h.name)
		}
	}
	// Un mismo `Cómo` puede tocar dos ambientes (el caso medido contra `qa` y su control en `local`):
	// se muestran los dos, sin elegir por nadie.
	envs := map[string]bool{}
	for _, m := range reEnvironment.FindAllStringSubmatch(how, -1) {
		environment := m[1]
		if environment == "" {
			environment = m[2]
		}
		if c, ok := canonEnvironment[strings.ToLower(environment)]; ok {
			envs[c] = true
		}
	}
	var list []string
	for a := range envs {
		list = append(list, a)
	}
	sort.Strings(list)
	return append(out, list...)
}

// IsEnvironment dice si una fuente es un ambiente y no una herramienta. La UI lo usa para pintarlas
// distinto; vive acá para que no haya dos listas de nombres que se puedan desincronizar.
func IsEnvironment(source string) bool {
	switch source {
	case "prod", "qa", "staging", "dev", "local":
		return true
	}
	return false
}
