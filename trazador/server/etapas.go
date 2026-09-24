// etapas.go — el TRAZADOR propiamente: hasta dónde llegó una solicitud y por qué se rompió.
//
// EL MODELO DE ETAPAS NO ES NUEVO. Sale del diseño que ya existía en `playground/soporte/`, borrado el
// 2026-07-22 y recuperable con `git show 3a01e53^:soporte/docs/ARQUITECTURA-TRACING.md`. De ahí vienen las
// siete etapas, los enums (`ok|warn|fail|skip`, `aprobado|roto|abandonado`) y —lo más importante— la
// **provenance por dato**: cada etapa dice de qué fuente salió, para que quien lee sepa cuánto confiar.
//
// LA REGLA QUE ORDENA TODO: la BD dice QUÉ pasó, los logs dicen POR QUÉ.
//   · La BD es un HECHO: una transición de estado ocurrió o no ocurrió, y punto.
//   · Un log AUSENTE no prueba nada — tiene cuatro causas indistinguibles (no se logueó · el level lo
//     filtró · el batch no hizo flush · lag de ingesta). Por eso los logs nunca marcan una etapa como
//     fallida: solo la explican. Si una etapa no tiene esqueleto en la BD, se marca `sin evidencia`, que
//     es distinto de `no ocurrió`.
//
// LA BD TAMBIÉN ANCLA LA CONSULTA, y esto es lo que la vuelve mejor que Loki solo (medido el 2026-08-04
// sobre la solicitud 464618, 295 líneas):
//   · anclando solo por el número de solicitud → 36 líneas (`user_request_id` + `user_request.id`)
//   · sumando el `user_id` que da la BD        → 50 líneas más (`user_id` + `user.id`), o sea 2,4×
//   Y más anclas no es solo más líneas: cada ancla nueva puede revelar un `trace_id` desconocido, y ahí
//   se expande a la petición completa.
//   El `user_id` solo es ambiguo (1,69 solicitudes por usuario en promedio, 228 el peor caso), así que
//   se usa SIEMPRE acotado a la ventana temporal que da el historial de estados. Preciso y amplio a la vez.
//
// LO QUE LA BD NO PUEDE DAR (verificado contra el dump local, no supuesto):
//   · `listado` — `displayed_lenders` es de lenders-v2 y no existe acá; para rt=1 vive en DynamoDB, que
//     se consulta por el pre-approvals-service.
//   · `cupo` (rt=2) — el diseño dice que NO se persiste la razón fina, a propósito.
//   Esas dos etapas se arman desde Loki, que sí las tiene (`Iniciando listado de entidades`,
//   `Evaluando reglas para entidad`, `QUOTA_CHECK_START`). Ahí Loki no es complemento: es la única fuente.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.

package main

import (
	"creditop/playground/connectors/logs"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// ─── etapas ─────────────────────────────────────────────────────────────────────────────────────────

// Stage es un paso del flujo, en el orden en que el cliente lo recorre.
type Stage struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Status: ok | warn | fail | skip | sin-evidencia | no-aplica. `skip` y `no-aplica` NO son lo mismo y
	// mezclarlos fue un error real del mapa: `skip` es «podía pasar acá y no pasó» (una pregunta abierta),
	// `no-aplica` es «acá esto no ocurre nunca en este ramal» (una pregunta cerrada, declarada en ramales.json).
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	Reason string `json:"reason,omitempty"` // el POR QUÉ; casi siempre de Loki
	Source string `json:"source"`           // db | loki | dynamodb | reeval | —
	At     string `json:"at,omitempty"`
	Lines  int    `json:"lineas,omitempty"` // cuántas líneas de log respaldan esta etapa
	Subs   []Sub  `json:"subs,omitempty"`   // el detalle de la etapa, como los steps de un job
	// Events: las líneas crudas de esta etapa, para el panel de log numerado. Van TOPEADAS y el tope se
	// declara — una etapa puede tener 300 líneas y volcarlas todas convierte la vista en un archivo.
	Events   []Event `json:"eventos,omitempty"`
	EventsOf int     `json:"eventosDe,omitempty"` // cuántas había en total, si se recortó
}

// Event es una línea de log tal como se leerá en el panel derecho.
type Event struct {
	At    string `json:"at"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
}

// Sub es un paso DENTRO de una etapa — lo que en un Action serían los steps de un job. Hoy salen de dos
// lugares medidos: las entidades evaluadas (una por lender, con su regla y veredicto) y las fallas
// deduplicadas por código. Ambos vienen de los logs, así que llevan su fuente.
type Sub struct {
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	Source string `json:"source"`
	// Detail2 es de uso interno (el lender_id, para poder agrupar por familia después). No se serializa.
	Detail2 string `json:"-"`
	// Children permite DOS niveles: familia → entidad en `listado`, y nada más. Más profundidad no aporta y
	// vuelve el árbol ilegible, que es justo lo contrario de para qué existe.
	Children []Sub `json:"hijos,omitempty"`
	// Events: LAS LÍNEAS QUE PRODUJO ESTE SUB-PASO, no las de la etapa. Es el cambio que vuelve esto
	// navegable como un run de CI: se abre un paso y se ven SUS logs, en vez de un panel al final con las
	// 110 líneas de la etapa entera mezcladas y sin dueño. `EventsOf` dice cuántas había si se recortó —
	// un sub que muestra 40 de 66 sin decirlo se lee como completo.
	Events   []Event `json:"eventos,omitempty"`
	EventsOf int     `json:"eventosDe,omitempty"`
	// Declarative: este sub DESCRIBE lo que debería pasar (la configuración del lender, una regla del mapa),
	// no algo que se midió. No cuenta como evidencia. Es la segunda vez que hace falta: «Camino configurado:
	// Ado» pintó de verde la etapa biométrica primero en un rt=1 y después en la uReq 464709 de staging, que
	// tiene CERO centrales consultadas. Una declaración no puede encender una etapa.
	Declarative bool      `json:"-"`
	Evidence    *Evidence `json:"evidencia,omitempty"`
}

// Evidence es la consulta que respalda un paso de BD, con el `?` ya resuelto para que se pueda pegar en
// Redash y comprobar el renglón. `Filas` son los valores que produjeron ESTE paso —no la fila entera—:
// volcar `SELECT *` mete columnas que no participaron y el lector no puede saber cuáles miró el trazador.
type Evidence struct {
	Source string   `json:"fuente"`
	SQL    string   `json:"sql"`
	Rows   []string `json:"filas,omitempty"`
}

// evidence arma el bloque resolviendo los `?` posicionalmente. Se resuelven porque una consulta con
// placeholders no se puede pegar y correr, y una evidencia que no se puede correr no es evidencia.
func evidence(source, sqlText string, args []any, rows ...string) *Evidence {
	q := strings.TrimSpace(sqlText)
	for _, a := range args {
		q = strings.Replace(q, "?", fmt.Sprint(a), 1)
	}
	clean := make([]string, 0, len(rows))
	for _, f := range rows {
		if f != "" {
			clean = append(clean, f)
		}
	}
	return &Evidence{Source: source, SQL: q, Rows: clean}
}

// order es la secuencia canónica. `origen` es un agregado del pedido de Miguel: no es una etapa del
// backend sino de dónde entró el cliente, y hoy NO está en los logs — se deduce de la BD (canal/comercio).
var order = []struct{ id, label string }{
	{"origen", "Origen"},
	{"registro", "Registro y OTP"},
	{"formulario", "Formulario de perfil"},
	{"cupo", "Cupo / POS"},
	{"listado", "Listado de entidades"},
	{"seleccion", "Selección de entidad"},
	{"desembolso", "Desembolso"},
}

// stageStatus / closingStatus / stoppingStatus se derivan del MAPA (etapas.json → bd.estados/cierran/
// detienen) al entrar a ensamblar. Vivían hardcodeados acá y `Mapa.StageStatus()` era código muerto:
// cero call sites, así que editar el JSON no cambiaba nada — el peor tipo de mentira, la que no falla.
// Verificado al cablear: el derivado y el hardcodeado eran idénticos, así que el cableado en sí no movió
// un byte; lo que sí agrega es que `detienen` ahora existe (9→formulario, 10/20/30→desembolso).
var (
	stageStatus    map[int]string
	closingStatus  map[int]bool
	stoppingStatus map[int]string
)

// malos son los desenlaces de muerte: llegar acá sin pedirlo es el fallo, no un matiz. Mismo criterio que
// `harness/pkg/trace.ts` para que "roto" signifique lo mismo en las dos herramientas.
var badStatuses = map[int]string{
	6: "Negada", 8: "Cancelado", 12: "Autorización negada",
	24: "Rechazado por validación de identidad",
}

// sealed = llegó al final. 25 es el sello del canal QR (nunca pasa por 11).
var sealed = map[int]bool{11: true, 28: true, 5: true, 25: true, 26: true}

// La prosa que explicaba closingStatus/stoppingStatus vive ahora en dos lugares, a propósito: la mecánica
// en el comentario de las vars derivadas (arriba) y los HECHOS medidos en `etapas.json → bd.nota_estados`
// de cada etapa — al lado del dato que justifican, donde los va a leer quien edite el JSON. Los dos falsos
// verdes que motivaron la separación cierran/detienen: el estado 10 (F-103, uReq 464709) y el estado 9,
// cuya fila se escribe al CREAR la solicitud (≤1 s del created_at, 4/4 trazas del censo 2026-08-07).

// outcomeOf traduce un estado de `user_requests` a uno de los CUATRO desenlaces. Una sola definición,
// porque ya había dos y no coincidían: `BuildTrace` contemplaba `abandonado` (estado 7) y el buscador de
// la API no, así que la MISMA solicitud salía «en curso» en la lista de intentos y «abandonado» al abrirla.
// La vista incluso tenía color para un desenlace que su fuente nunca emitía.
func outcomeOf(status int) string {
	switch {
	case sealed[status]:
		return "aprobado"
	case badStatuses[status] != "":
		return "roto"
	case status == 7:
		return "abandonado"
	default:
		return "en-curso"
	}
}

// LOS PATRONES YA NO VIVEN ACÁ. Están declarados en `mapa/etapas.json` y los resuelve `mapa.go`.
//
// ⚠ POR QUÉ SE MOVIERON, y no fue por prolijidad: la versión anterior era un `map[string]*regexp.Regexp`
// que se iteraba con `range` y cortaba en el primer match. **El orden de iteración de un map en Go es
// aleatorio**, así que un mensaje que matcheara dos etapas caía en una etapa DISTINTA en cada corrida —
// el trazador daba respuestas diferentes para los mismos datos, sin que nada avisara. `Mapa.StageOf`
// recorre un slice ordenado por el campo `orden`, así que es determinista y el empate lo gana la etapa
// que va antes en el flujo.

// ─── la solicitud según la BD ───────────────────────────────────────────────────────────────────────

// LoanRequest es el esqueleto: lo que la BD afirma. Nada de acá se infiere de logs.
type LoanRequest struct {
	ID       int64
	UserID   int64
	Document string
	Phone    string
	Status   int
	StatusN  string
	Lender   string
	LenderID int64
	LenderRT int
	Merchant string
	Branch   string
	// `Canal` es en realidad el flow_id: `user_requests` NO tiene columna de canal. El origen
	// (asesor / QR / ecommerce) hay que derivarlo, y hoy tampoco está en los logs — es el hueco del
	// nivel `[origen]` del modelo de etapas.
	Channel string
	Amount  float64
	Created time.Time
	// Transitions ya colapsadas: `user_request_records` repite el mismo estado muchas veces (una fila
	// por cada toque), así que sin colapsar el "historial" miente sobre cuántas veces avanzó el flujo.
	Transitions []Transition
	Bureau      []BureauRow
	// Origin y si fue DERIVADO o asumido. Se separa porque `asesor` es el default y un default que se
	// lee como verificado es peor que no tenerlo.
	Origin        string
	DerivedOrigin bool
	// Validation: `lender_identity_validation_types.identity_validation_type_id` (o el fallback
	// `lenders.validation_type`). Enum en Modules/Identity/App/Enums/IdentityValidationType.php:
	// 0 Unknown · 1 None · 2 AwsOcrRekognition · 3 Questions · 4 Ado · 5 CrossCore · 6 Evidente.
	Validation int
	AlliedID   int64
	// Corbeta: este comercio está en el setting `corbeta_allieds`, o sea que su onboarding es el del
	// canal Corbeta→Bancolombia y NO el del resto. Se lee de la BD del target, no se supone.
	Corbeta bool
	// El snapshot del motor de perfilamiento. Es el esqueleto de `listado` y la huella del webhook del
	// lender — nil si esta solicitud nunca llegó a perfilarse.
	Profiling *Profiling
	// La evaluación de categoría por entidad (`users_category_log`): POR QUÉ una entidad in-platform no le
	// salió al cliente. Es la única fuente que lo dice criterio por criterio; el log de texto no puede.
	Categories []Category
	// Las operaciones contra Deceval (`deceval_logs`), el tramo del pagaré digital. Vacío = o el lender no
	// firma con Deceval, o no llegó — el veredicto se cruza con la etapa, no se decide acá.
	Deceval []DecevalOp
}

type Transition struct {
	Status int
	Name   string
	At     time.Time
}

type BureauRow struct {
	Central string
	Score   *float64
	At      time.Time
}

// window es el rango de tiempo de esta solicitud, y es lo que hace SEGURO anclar por `user_id`. Sin
// esto, buscar por usuario traería sus otras solicitudes mezcladas.
func (s *LoanRequest) window() (time.Time, time.Time) {
	since, until := s.Created, s.Created
	for _, t := range s.Transitions {
		if t.At.After(until) {
			until = t.At
		}
		if t.At.Before(since) {
			since = t.At
		}
	}
	for _, b := range s.Bureau {
		if b.At.After(until) {
			until = b.At
		}
	}
	// Colchón: el log de una petición puede caer fuera del instante en que se grabó el estado.
	return since.Add(-10 * time.Minute), until.Add(30 * time.Minute)
}

// ─── ensamblado ─────────────────────────────────────────────────────────────────────────────────────

// Trace es lo que se imprime o se devuelve como JSON. El shape sigue al diseño recuperado para que un
// front pueda consumirlo sin traducir.
type Trace struct {
	UReq    int64  `json:"ureq"`
	Target  string `json:"target"`
	Outcome string `json:"outcome"` // aprobado | roto | abandonado | en-curso
	BrokeAt string `json:"brokeAt,omitempty"`
	// Lane: por cuál de las variantes de flujo fue ESTA solicitud (`creditopx` · `agregador` ·
	// `redirect` · `credifamilia`, los ids de `ramales.json`). Se calculaba desde siempre para decidir
	// qué etapas NO aplican, pero no salía del servidor — y sin él la vista puede decir «esta etapa se
	// saltó» y no puede decir **por qué carril fue y cuáles había**, que es la mitad del diagnóstico.
	// Vacío hasta que el cliente elige entidad: antes de `seleccion` no hay ramal, y eso es un hecho, no
	// un dato faltante.
	Lane     string   `json:"ramal,omitempty"`
	Stages   []Stage  `json:"etapas"`
	Sources  []string `json:"sources"`
	Warnings []string `json:"warnings,omitempty"`
	// Findings: el resumen de auditoría — todo lo que quedó en fail, con su ruta, ANTES del árbol. Existe
	// para que soporte lea cinco renglones y sepa dónde abrir, en vez de escanear el árbol buscando rojos.
	Findings []string `json:"hallazgos,omitempty"`
	// Files: QUÉ CÓDIGO dejó rastro en esta traza, en orden de primera aparición. Sale de resolver
	// cada mensaje contra `trazador/logs.json` (ver archivos.go e indice_logs.go). Es la pregunta que sigue a «¿por qué
	// se rompió?» y hasta ahora obligaba a copiar el mensaje a otra herramienta.
	// ⚠ Dice qué archivos DEJARON RASTRO, no cuáles se ejecutaron: uno sin logs es invisible acá, y
	// eso no prueba que no corrió — la misma regla que rige toda esta herramienta.
	Files []TraceFile `json:"archivos,omitempty"`
	// Pantallas: QUÉ VIO el cliente en el navegador, de PostHog. Es la mitad que el backend no puede
	// contar — «el backend dice que llegó a firmar, ¿el cliente llegó a ver esa pantalla?»— y hasta
	// ahora vivía en otro comando. No hace falta un mapa: la llave (`loan_request_<n>`) ya existe.
	// Tree: los 39 pasos del árbol de negocio, con cuántas líneas tocó cada uno. Contesta «dónde
	// quedó» con grano fino — no «falló la validación» sino «falló en la cascada de identidad, y la
	// biometría ni se intentó». Se deriva de `mapa/negocio.json`; ver arbol.go.
	Tree       []ReachedStep `json:"arbol,omitempty"`
	TreeLast   int           `json:"arbolUltimo,omitempty"`
	Screens    []SeenScreen  `json:"pantallas,omitempty"`
	PHNotice   string        `json:"avisoPosthog,omitempty"`
	Unresolved int           `json:"archivosSinResolver,omitempty"`
	// El estado ACTUAL de la solicitud. Sin esto el outcome no se podía auditar desde el JSON: una traza
	// decía «aprobado» y no había forma de saber contra qué estado se calculó (la 522238 cambió de estado
	// entre dos lecturas y la diferencia era invisible).
	Status     int    `json:"estado"`
	StatusName string `json:"estadoNombre,omitempty"`
	// Orphans: las líneas que ningún patrón del mapa reclamó. Van EN LA TRAZA y no solo contadas en un
	// aviso, porque son el trabajo pendiente concreto: para cerrar el hueco hay que leerlas y declarar el
	// patrón que falta. Un contador no se puede accionar; una lista sí.
	Orphans []Event `json:"huerfanas,omitempty"`
}

// assemble arma la traza: primero el esqueleto de la BD (hechos), después el porqué de los logs.
func assemble(stageMap *Map, subMap *SubMap, s *LoanRequest, lines []Line, target string,
	bureaus map[int64]string, lenders map[int64]LenderInfo) Trace {
	// Los mapas de estado salen del JSON, no de este archivo: una sola fuente.
	stageStatus, closingStatus, stoppingStatus = stageMap.StageStatus(), stageMap.ClosingStatus(), stageMap.StoppingStatus()

	t := Trace{UReq: s.ID, Target: target, Sources: []string{"db"}, Status: s.Status, StatusName: s.StatusN}
	if len(lines) > 0 {
		t.Sources = append(t.Sources, "loki")
	}

	// Qué etapas prueba la BD, y cuándo.
	seen := map[string]time.Time{}
	for _, tr := range s.Transitions {
		// La misma compuerta que abajo: una transición prueba la etapa SOLO si su estado la cierra. La fila
		// de estado 9 se escribe al crear la solicitud (≤1 s del created_at, medido), así que dejarla pasar
		// acá pintaba «personal-info ✔» con el formulario sin tocar.
		if e, ok := stageStatus[tr.Status]; ok && closingStatus[tr.Status] {
			if _, already := seen[e]; !already {
				seen[e] = tr.At
			}
		}
	}
	// EL ESTADO FINAL TAMBIÉN ES UN HECHO, y faltaba. `visto` se armaba sólo con `user_request_records`, o
	// sea con el HISTORIAL — y hay solicitudes sin historial: medido en prod, dos de tres solicitudes de
	// Alkosto en estado 11 tienen CERO filas en `user_request_records` (520374 y 519546; la tercera tiene
	// una, del estado 9). Para ellas el trazador mostraba «Desembolso ·» mientras `user_requests` decía
	// «Autorizada». La columna de la solicitud es tan afirmable como el registro histórico; lo único que no
	// da es la HORA, así que se usa la de la solicitud sólo si el historial no aportó nada.
	// ⚠ SÓLO PARA LOS ESTADOS QUE PRUEBAN QUE LA ETAPA TERMINÓ. `stageStatus` contesta «¿a qué etapa
	// PERTENECE este estado?», que es otra pregunta: el estado 10 pertenece a `desembolso` porque el flujo ya
	// está en el tramo de cierre, pero significa que está ADENTRO, no que lo completó. Usar ese mapa acá
	// pintaba la etapa en VERDE para una solicitud detenida en 10 — reportado sobre la uReq 464709 de
	// staging, que falló firmando documentos y salía «Desembolso ✔». Un falso verde es el peor error que
	// puede tener esta herramienta: afirma un éxito que no ocurrió.
	if et, ok := stageStatus[s.Status]; ok && closingStatus[s.Status] {
		if _, already := seen[et]; !already {
			seen[et] = s.Created
		}
	}

	// ⚠ SÓLO las centrales DECLARADAS en `buro` prueban la etapa del buró. Antes era `s.Buro[0].At` — la
	// primera fila de CUALQUIER central—, y con el catálogo repartido eso miente sin avisar: en la uReq
	// 520830 de prod los cuatro burós reales eran del DÍA ANTERIOR (cliente que vuelve, dato en caché) y las
	// únicas filas nuevas eran de `TusDatos - AML` y `Ado`, que son del tramo biométrico. Resultado: «✔
	// Consulta a burós 16:00:27» con las seis centrales en «no consultada» — un check verde tomado prestado
	// de otra etapa. Es el mismo error que tenía `Ado`, ahora en la dimensión del TIEMPO.
	for _, f := range s.Bureau {
		if !declaredIn(subMap, "formulario", f.Central) {
			continue
		}
		if v, already := seen["formulario"]; !already || f.At.Before(v) {
			seen["formulario"] = f.At
		}
	}
	// `origen` lo prueba la existencia misma de la solicitud: alguien la creó por algún canal.
	seen["origen"] = s.Created

	// El desenlace sale SOLO de la BD.
	t.Outcome = outcomeOf(s.Status)

	// Las líneas de log, repartidas por etapa. DOS LLAVES, en este orden:
	//
	//	1. EL PATRÓN declarado en el mapa (determinista, y es la llave fuerte).
	//	2. EL SPAN, para lo que el patrón no reclamó: si las demás líneas del MISMO span cayeron todas en una
	//	   sola etapa, la línea hereda esa etapa.
	//
	// Por qué hace falta la segunda. 152 de los 153 patrones matchean la PROSA del mensaje, así que siempre
	// se escapa algo por cómo está redactado: `Starting RegisterCellPhoneService::…` no matchea un patrón
	// anclado en `^RegisterCellPhone` por culpa del verbo. Declarar una variante por cada forma de escribir lo
	// mismo es una carrera que no se gana. El span no es una redacción: es la unidad de trabajo en que se
	// emitió la línea. Medido en la uReq 519245 de prod: de 38 líneas sin ubicar, 30 se resuelven así — la
	// cobertura pasa de 92 % a 98 %.
	//
	// ⚠ LA HERENCIA NO PUEDE INVENTAR UNA ETAPA, y eso es una propiedad de la construcción, no una promesa:
	// sólo se hereda hacia una etapa que YA tenía líneas por patrón en ese mismo span. Una etapa vacía nunca
	// se enciende por herencia.
	//
	// Y cuando el span abarca DOS etapas no se hereda: pasa de verdad —guardar los datos personales dispara
	// la consulta de buró dentro de la misma operación— así que ahí el span no desempata y elegir sería
	// inventar. Esas líneas quedan «sin ubicar», que es la respuesta honesta.
	byStage := map[string][]Line{}
	spanStages := map[string]map[string]bool{}
	var withoutPattern []Line
	for _, l := range lines {
		if id := stageMap.StageOf(l.msg, l.ctx); id != "" {
			byStage[id] = append(byStage[id], l)
			if spanStages[l.span] == nil {
				spanStages[l.span] = map[string]bool{}
			}
			spanStages[l.span][id] = true
		} else {
			withoutPattern = append(withoutPattern, l)
		}
	}
	inherited := 0
	var withoutStage []Line
	for _, l := range withoutPattern {
		is := spanStages[l.span]
		if l.span == "" || len(is) != 1 {
			withoutStage = append(withoutStage, l)
			continue
		}
		for id := range is {
			l.inheritedOne = true
			byStage[id] = append(byStage[id], l)
			inherited++
		}
	}
	if inherited > 0 {
		t.Warnings = append(t.Warnings, fmt.Sprintf("%d líneas se ubicaron por SPAN y no por patrón del mapa: "+
			"van en la etapa correcta pero sin nombre de negocio (aparecen bajo «eventos sin nombre»)", inherited))
	}
	// Las líneas que NADA reclama SE MUESTRAN, no solo se cuentan. Un aviso que dice «38 líneas no las pude
	// ubicar» sin decir cuáles no se puede accionar: para cerrar el hueco hay que leerlas y declarar el patrón
	// que falta. Antes esto era un contador, y por eso el hueco no se cerraba nunca.
	if len(withoutStage) > 0 {
		t.Orphans, _ = eventsOf(withoutStage, 120)
		t.Warnings = append(t.Warnings, fmt.Sprintf("%d de %d líneas no las ubica ni el patrón ni el span "+
			"(mapa v%s): están listadas en «sin ubicar» — o el span abarca dos etapas, o ninguna hermana suya "+
			"está ubicada", len(withoutStage), len(lines), stageMap.Version))
	}

	// LA FAMILIA, una sola vez y antes del loop. Sale del `response_type` del lender ya sellado en la
	// solicitud, así que sólo existe DESPUÉS de que el cliente eligió: antes de `seleccion` no hay ramal, y
	// eso es correcto — no se puede declarar «esta etapa no aplica» sin saber a qué ramal fue.
	fam := ""
	if s.Lender != "" {
		fam = laneOfRT(s.LenderID, s.LenderRT)
	}
	t.Lane = fam

	// La etapa de muerte se calcula UNA vez, con todo el material (transiciones + líneas por etapa), y
	// puede ser "": ver deathStage.
	death := deathStage(stageMap, s, byStage)

	for _, o := range stageMap.Order() {
		e := Stage{ID: o.id, Label: o.label, Source: "—", Status: "skip"}
		ls := byStage[o.id]
		e.Lines = len(ls)

		// ¿Esta etapa está DECLARADA como inexistente para esta solicitud? Se resuelve acá arriba, antes de
		// armar nada, porque además de decidir el estado final decide qué NO hay que agregar: un sub que
		// describe un tramo que no existe se cuenta como evidencia y evita que el tramo se marque ausente.
		// Pasó exactamente eso — «Camino configurado: Ado» apareció en una solicitud rt=1 (Alkosto +
		// Bancolombia) y la etapa biométrica salió ✔ en un ramal donde no ocurre.
		declNotApplicable, declReason := notApplicableReason(stageMap, s, fam, o.id)

		if o.id == "origen" {
			// EL MONTO ADELANTE, EL CANAL ABAJO. Esta era la única fila del árbol que no se medía: el canal
			// se ASUME asesor porque `user_requests` no tiene columna de canal. Abrir una traza con una
			// suposición es el peor lugar para ponerla — se lee como el resto, que sí está probado.
			e.Status, e.At, e.Source = "ok", hhmm(s.Created), "db"
			e.Detail = fmt.Sprintf("%s solicitados", pesosText(s.Amount))
			channel := Sub{Label: "Canal de entrada: " + s.Origin, Status: "ok", Source: "db",
				Detail: "derivado de ecommerce_requests"}
			if !s.DerivedOrigin {
				channel.Status, channel.Source = "skip", "default"
				channel.Detail = "ASUMIDO — user_requests no guarda el canal; sólo ecommerce se puede derivar"
				channel.Declarative = true // una suposición no es evidencia: no puede encender la etapa
			}
			// Las líneas que el mapa enruta a esta etapa (los matchers de canal: «Corbeta checkout»,
			// IsCorbeta/IsEcommerce) se adjuntan al sub del canal: esta etapa no reparte por hitos y antes
			// se CONTABAN y se tiraban — 4 líneas en 2/25 trazas del censo, invisibles hasta en el backlog.
			if len(ls) > 0 {
				channel.Events, channel.EventsOf = eventsOf(ls, 40)
				if channel.Source == "default" {
					channel.Source = "loki"
				}
			}
			e.Subs = append(e.Subs, channel)
			// EL FLAG CORBETA ES DEL COMERCIO, NO EL CANAL — y no puede pisar el renglón de arriba: en el
			// censo hubo Corbeta SIN fila de ecommerce (522230, entró por otro lado) y Corbeta CON ella
			// (522215: el QR de Corbeta CREA la fila — «ecommerce» no es falso, es incompleto). Dos hechos
			// distintos, dos renglones. Este es además la fuente del «no aplica» del formulario: si las dos
			// filas salieran de lecturas distintas podrían discrepar, y ya pasó (origen decía «asesor
			// ASUMIDO» mientras formulario decía «Canal Corbeta → Bancolombia»).
			if s.Corbeta {
				e.Subs = append(e.Subs, Sub{
					Label: "Onboarding Corbeta: sí", Status: "ok", Source: "db",
					Detail: fmt.Sprintf("allied %d está en el setting corbeta_allieds — el formulario se "+
						"salta y la info laboral se fabrica", s.AlliedID),
					Evidence: evidence("settings", sqlCorbeta, nil,
						fmt.Sprintf("corbeta_allieds contiene %d", s.AlliedID),
						"⚠ es la variante de ONBOARDING del comercio, no el punto de entrada de la solicitud"),
				})
			}
			t.Stages = append(t.Stages, e)
			continue
		}
		if at, ok := seen[o.id]; ok {
			e.Status, e.Source, e.At = "ok", "db", hhmm(at)
		} else if stoppingStatus[s.Status] == o.id {
			// DETENIDA ACÁ. La solicitud entró a esta etapa y no salió: en la BD no figura como rota —sigue
			// «en curso»— así que sin esto la etapa quedaba en gris y el corte no se veía en ninguna parte.
			// Es la respuesta a «¿dónde se quedó?», que es la pregunta con la que llega el soporte.
			//
			// Va como SUB-PASO y no sólo como texto de la etapa: el corte es un hecho de la BD igual que
			// «estado 3 · Seleccionó entidad», y ponerlo en prosa aparte lo sacaba de la lista donde se lee
			// todo lo demás. Con la misma forma que el resto se abre, se copia y se busca igual.
			e.Status, e.Source = "fail", "db"
			e.At = statusAt(s, s.Status)
			e.Subs = append([]Sub{{
				Label:  fmt.Sprintf("estado %d · %s", s.Status, s.StatusN),
				Status: "fail", Source: "db",
				Detail: "DETENIDA acá — entró y no salió",
				// La afirmación más fuerte que hace el trazador ES la que más tiene que probarse: «no salió»
				// se sostiene en que el historial se termina acá, y sin el historial a la vista el lector
				// tiene que creer. Es el renglón que soporte copia a un ticket.
				// ⚠ La afirmación se apoya en DOS tablas y hay que decirlo, porque no siempre coinciden: el
				// estado actual vive en `user_requests.user_request_status_id` y el recorrido en
				// `user_request_records`. En la uReq 464709 de staging el estado actual es 10 y el historial
				// NO tiene fila para el 10 — o sea que el registro de transiciones no cubre todos los
				// estados. Escribir «última transición: estado 10» habría sido inventar una fila que no
				// existe, y fue este mismo bloque de evidencia el que lo destapó al mostrarlas juntas.
				Evidence: evidence("user_requests + user_request_records", sqlHistory, []any{s.ID},
					append(historyRows(s), currentStatusRow(s))...),
			}}, e.Subs...)
		} else if len(ls) > 0 {
			// Sin respaldo en la BD pero con logs: la etapa OCURRIÓ (los logs son evidencia positiva),
			// solo que la BD no la registra. Es el caso de `listado` y `cupo`, por diseño.
			e.Status, e.Source, e.Source = "ok", "loki", "loki"
			e.At = hhmm(time.UnixMilli(ls[0].ts))
		} else if badStatuses[s.Status] != "" && death != "" && o.id == death {
			// La etapa donde murió: lo dice la BD (el estado final), no un log.
			e.Status, e.Source, e.Detail = "fail", "db", fmt.Sprintf("estado %d «%s»", s.Status, s.StatusN)
			e.At = statusAt(s, s.Status)
		} else if o.id == "listado" || o.id == "cupo" {
			// Estas dos NO tienen esqueleto posible: decir "no ocurrió" sería mentir.
			e.Status, e.Detail = "sin-evidencia", "la BD no registra esta etapa (rt=2 no persiste; rt=1 vive en DynamoDB)"
		}

		// Sub-steps de `listado`: una fila por entidad. El veredicto se lee SOLO de la línea «Resultado de
		// evaluación» — tomar cualquier `rule_id` emparejaría el veredicto con la regla de una categoría
		// rechazada, que es lo contrario de lo que decidió.
		// ── CADA LÍNEA VA A LA ENTIDAD QUE NOMBRA ──
		//
		// Muchas líneas del listado traen `lender_id` en su contexto —incluida la excepción de la
		// integración: `Exception in lenderServiceFactory->consult()` viene con `lender_id` Y con la causa en
		// `context_error` («No query results for model [LenderAlliedCredential]» = faltan credenciales, o el
		// 401 del proveedor)—. Mandarlas a un cajón «Fallo consultando al lender» borraba justo el dato que se
		// necesita: CUÁL entidad falló. Con esto la evidencia aterriza en la fila de esa entidad.
		//
		// Y se usa el SPAN para las hermanas mudas: el 401 crudo no trae `lender_id` pero comparte span con la
		// excepción que sí. Mismo criterio que la herencia de etapa — se hereda sólo si el span apunta a UNA
		// entidad; si abarca dos, elegir sería inventar.
		lenderLines := map[string][]Line{}
		if o.id == "listado" && len(ls) > 0 {
			spanLender := map[string]string{}
			for _, l := range ls {
				if id := pick(l.ctx, []string{"lender_id"}); id != "" && l.span != "" {
					if other, already := spanLender[l.span]; already && other != id {
						spanLender[l.span] = "" // el span toca dos entidades: no desempata
					} else if !already {
						spanLender[l.span] = id
					}
				}
			}
			for _, l := range ls {
				id := pick(l.ctx, []string{"lender_id"})
				if id == "" {
					id = spanLender[l.span]
				}
				if id != "" {
					lenderLines[id] = append(lenderLines[id], l)
				}
			}
		}

		if o.id == "listado" {
			type ent struct {
				name, rule, res string
				cats            []string
			}
			byID := map[string]*ent{}
			var ids []string
			for _, l := range ls {
				id := pick(l.ctx, []string{"lender_id"})
				if id == "" {
					continue
				}
				e0, ok := byID[id]
				if !ok {
					e0 = &ent{}
					byID[id] = e0
					ids = append(ids, id)
				}
				if n := pick(l.ctx, []string{"lender_name"}); n != "" {
					e0.name = n
				}
				r := pick(l.ctx, []string{"rule_id"})
				if regexp.MustCompile(`(?i)Resultado de evaluaci`).MatchString(l.msg) {
					if r != "" {
						e0.rule = r
					}
					if v := pick(l.ctx, []string{"result", "resultado"}); v != "" {
						e0.res = v
					}
				} else if regexp.MustCompile(`CATEGORY_RULE_REJECTED`).MatchString(l.msg) && r != "" {
					e0.cats = append(e0.cats, r)
				}
			}
			for _, id := range ids {
				e0 := byID[id]
				st := "ok"
				if e0.res != "" && e0.res != "aprobado" {
					st = "fail"
				} else if e0.res == "" {
					st = "skip"
				}
				d := ""
				if e0.rule != "" {
					d = "regla " + e0.rule
				}
				if len(e0.cats) > 0 {
					d += fmt.Sprintf("  ·  %d categoría(s) rechazada(s): %s", len(e0.cats), strings.Join(e0.cats, ", "))
				}
				name := e0.name
				if name == "" {
					name = "lender " + id
				}
				e.Subs = append(e.Subs, Sub{Label: name, Status: st, Detail: d, Source: "loki", Detail2: id})
			}
			// Se dejan PLANAS a propósito: el bloque de la BD las fusiona por `lender_id` y agrupa por
			// familia UNA vez. Agrupar acá producía dos árboles concatenados —cada entidad dos veces, una
			// con su veredicto y otra con su regla—, que es justo lo que este árbol vino a evitar.
			if len(e.Subs) > 0 {
				e.Status, e.Source = "ok", "loki"
				e.At = hhmm(time.UnixMilli(ls[0].ts))
			}
		}

		// SUB-STEPS DE LA BD — hechos, uno por transición de estado que cae en esta etapa. Van primero
		// porque son lo único que se puede afirmar; los de log vienen después como evidencia.
		for _, tr := range s.Transitions {
			if stageStatus[tr.Status] != o.id {
				continue
			}
			st, det := "ok", hhmm(tr.At)
			decl := false
			if badStatuses[tr.Status] != "" {
				st = "fail"
			}
			if tr.Status == 9 {
				// El hecho se muestra, pero dice lo que es — y no puede encender la etapa (Declarativo):
				// probaría que la solicitud NACIÓ, no que el formulario se llenó.
				det += " · ⚠ esta fila se escribe al CREAR la solicitud: no prueba el formulario"
				decl = true
			}
			e.Subs = append(e.Subs, Sub{
				Label:  fmt.Sprintf("estado %d · %s", tr.Status, tr.Name),
				Status: st, Detail: det, Source: "db", Declarative: decl,
				// El historial COMPLETO, no sólo esta transición: el renglón afirma «pasó por acá» y lo
				// que lo respalda —o lo desmiente— es la secuencia entera. `user_request_records` repite
				// el mismo estado muchas veces, así que se muestra ya colapsada, igual que se leyó.
				Evidence: evidence("user_request_records", sqlHistory, []any{s.ID}, historyRows(s)...),
			})
		}
		// Las centrales son un hecho de BD y van en la etapa DONDE SE CONSULTAN, según el reparto declarado
		// en `mapa/substeps.json`. Antes se volcaba el catálogo entero en `buro`, y por eso `Ado` —que es del
		// tramo creditopx, después de elegir la entidad— salía «no consultada» bajo «Consulta a burós».
		for _, b := range subMap.Blocks(o.id) {
			if b.Kind == "catalogo" && len(b.Known) > 0 {
				e.Subs = append(e.Subs, bureausTree(b.Label, b.Known, bureaus, s.Bureau, s.UserID)...)
			}
		}
		// Las que tienen datos y ninguna etapa declaró se muestran en el buró, marcadas. Un dato medido que
		// desaparece porque el mapa no lo esperaba es peor que uno mal ubicado: el segundo se ve.
		if o.id == "formulario" {
			e.Subs = append(e.Subs, orphanBureaus(subMap, stageMap, s.Bureau)...)
		}
		// ── QUÉ CAMINO DE IDENTIDAD LE TOCA A ESTE LENDER ──
		//
		// Es lo que vuelve interpretable la ausencia. El tipo lo elige el LENDER
		// (`lender_identity_validation_types`, fallback `lenders.validation_type`;
		// `CreditopXFlowService.php:117` → `IdentityValidationStepResolver`), y sólo `Ado`, `CrossCore` y
		// `Evidente` escriben fila en `risk_central_user_data`. Medido en prod: de 119 lenders in-platform,
		// **64 usan Ado, 46 usan AWS OCR+Rekognition y 9 no validan**. Para esos 46 las cuatro centrales
		// salen «no consultada» y sin esta línea se lee como «no pasó nada», cuando corrieron el OCR y el
		// reconocimiento facial completos — su evidencia son los LOGS, no la BD.
		if o.id == "biometria" && s.Validation > 0 && declNotApplicable == "" {
			v := identityValidation[s.Validation]
			st, det := "ok", v.name
			if !v.leavesRow {
				st = "sin-evidencia"
				det += " — NO escribe fila de central: la ausencia de filas acá es ESPERADA, el rastro está en los logs"
			}
			e.Subs = append([]Sub{{Label: "Camino configurado: " + v.name, Status: st, Source: "db",
				Detail: det, Declarative: true}}, e.Subs...)
		}
		// Una etapa que la BD no prueba por ESTADO puede estar probada por sus centrales. `biometria` es el
		// caso: ningún `user_request_status` la marca, así que quedaba en `skip` con dos centrales consultadas
		// a la vista — y después la inferencia la rotulaba «puede no haber ocurrido» encima de la evidencia.
		if e.Status == "skip" && e.At == "" && hasEvidence(e) {
			e.Status, e.Source = "ok", "db"
			e.At = firstSubsTime(e.Subs)
		}
		if o.id == "seleccion" && fam != "" {
			// El único punto del flujo donde SÍ hay un camino elegido: una entidad ganó, y su familia es
			// «por dónde se fue». En el listado no lo hay — ahí conviven todas las familias.
			e.Subs = append(e.Subs, Sub{
				Label: fam, Status: "ok", Source: "db",
				Detail: "◄ por acá se fue",
				Children: []Sub{{Label: s.Lender, Status: "ok", Source: "db",
					Detail: fmt.Sprintf("lender %d · response_type %d", s.LenderID, s.LenderRT)}},
			})
		}

		// SUB-STEPS DE LOG — un renglón por método/evento distinto, con su conteo. Agrupar es obligatorio:
		// sin esto, `registro` tendría 312 renglones y dejaría de ser legible, que es lo contrario de lo
		// que un resumen tiene que hacer.
		//
		// ⚠ ACÁ NO SE EXCLUYE NINGUNA ETAPA. `listado` y `respuesta-lender` estaban excluidas porque arman su
		// propio árbol desde la BD (las entidades por familia, el diagnóstico del webhook) y no quería una
		// segunda lista en paralelo. El costo era invisible y grave: `listado` mostraba «52 líneas» en la
		// cabecera y CERO pasos donde abrirlas — los logs de la etapa se tiraban enteros. Es el mismo error
		// que tenían las centrales duplicadas, y la solución es la misma: no borrar una de las dos vistas,
		// sino ponerlas juntas. El árbol de la BD es el RESULTADO; los logs, el PROCESO.
		// Cuántas veces corrió la cascada. Se calcula al repartir los logs y se usa mucho más abajo, al
		// armar el renglón de la etapa, así que vive acá afuera: usar `e.Detail` como buzón no sirve —ese
		// campo se REASIGNA después— y componer a ciegas llegó a pegar dos frases que se contradecían.
		var runsNote string
		// Las líneas del profiler ML, apartadas ACÁ para que su paso las tenga. Reclamarlas explícitamente
		// —y no dejarlas en el reparto general— es lo que garantiza que aparezcan UNA vez: si además las
		// tomara un hito del mapa, la misma línea saldría en dos renglones y los conteos dirían el doble.
		var profilerLines []Line
		if len(ls) > 0 {
			// El MS de pre-aprobación se agrupa POR ENTIDAD y sale del reparto por mensaje: sus líneas
			// pertenecen a llamadas independientes (una por lender), y mezclarlas en «Veredicto ×14» pierde
			// la pregunta real, que es por cuál de las entidades. Ver `preapprovalTree`.
			var fromMS []Line
			rest0 := ls[:0:0]
			for _, l := range ls {
				if pick(l.ctx, []string{"service_name"}) == "preapprovals-service" {
					fromMS = append(fromMS, l)
				} else {
					rest0 = append(rest0, l)
				}
			}
			// La pre-aprobación se FUSIONA en la fila de cada entidad del listado, no va como bloque aparte.
			// Es la misma entidad vista por dos fuentes —el snapshot de `profiling_reviews` dice el veredicto,
			// el MS dice cómo se llegó a él— y tenerlas en listas paralelas obliga a cruzarlas de cabeza. La
			// llave es el `lender_id`, que las dos traen: el árbol del listado en `Detail2` y el MS en su
			// etiqueta. Mismo criterio que la fusión de centrales del buró.
			if len(fromMS) > 0 {
				e.Subs = mergePreapproval(e.Subs, preapprovalTree(fromMS))
			}
			ls = rest0
			// Lo que ya se atribuyó a una entidad sale de acá: si no, cada línea aparecería dos veces —en su
			// entidad y en el bloque de proceso— y los conteos dirían el doble.
			if len(lenderLines) > 0 {
				alreadyIs := map[string]bool{}
				for _, rawLines := range lenderLines {
					for _, l := range rawLines {
						alreadyIs[fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)] = true
					}
				}
				remaining := ls[:0:0]
				for _, l := range ls {
					if !alreadyIs[fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)] {
						remaining = append(remaining, l)
					}
				}
				ls = remaining
			}
			// El LISTADO se parte por CORRIDA: la cascada corre varias veces en una misma solicitud y sus
			// líneas mezcladas no se pueden leer. El resto de las etapas se agrupa por hito, como siempre.
			if o.id == "listado" {
				// El timeout del profiler sale del reparto por hito: es del modelo que ORDENA el listado,
				// no de una entidad ni de la cascada. Se reconoce por la URL, que es la única parte del
				// mensaje que dice de qué era — leer sólo «cURL error 28» llevó a atribuírselo a un lender.
				remaining := ls[:0:0]
				for _, l := range ls {
					if strings.HasPrefix(l.msg, "cURL error 28") && strings.Contains(l.msg, "predict_w") {
						profilerLines = append(profilerLines, l)
						continue
					}
					remaining = append(remaining, l)
				}
				ls = remaining

				// ── LA CASCADA: UNA LÍNEA, Y SÓLO SI DICE ALGO ──
				//
				// De todo lo que loguea la cascada, UNA sola cosa informaba a soporte —si algo se cayó— y esa
				// ya no vive acá: el timeout del profiler es del ML y se muestra en su propio paso, junto al
				// perfilador que la BD dice que ordenó el listado. Lo que quedaba era el orquestador
				// narrándose a sí mismo («Arranque ×1», «Reglas heredadas ×2», «Recorrido ×2»): confirma que
				// el código ejecutó sus propios pasos y no contesta ninguna pregunta.
				//
				// Así que la fila desaparece y el único dato que sobrevive —CUÁNTAS veces corrió, porque más
				// de una es un reintento y no lo normal— se dice en el renglón de la etapa, sin gastar un
				// nivel de árbol. Las líneas no se pierden: caen en «eventos sin nombre de negocio», que es
				// lo que son.
				if n := cascadeRuns(ls); n > 1 {
					runsNote = fmt.Sprintf("la cascada corrió %d veces", n)
				}
				// Las líneas que NO son de una corrida (fragmentos de otras peticiones que tocaron el
				// listado) vuelven al agrupamiento por hito: no se pierden, sólo dejan de contarse como
				// ejecuciones de la cascada.
				// ⚠ Se descarta SOLO la línea de apertura, que ya se contó como corrida. La versión anterior
				// descartaba el TRACE ENTERO de cada corrida — o sea, justo el caso sano: la etapa declaraba
				// «22 líneas» y mostraba cero (medido en 522154 22→0, 522237 16→0, 520593 10→0), y el
				// comentario de al lado prometía lo contrario. No hay doble conteo posible: lo atribuido a
				// una entidad ya salió de `ls` más arriba.
				remainingRun := ls[:0:0]
				for _, l := range ls {
					if strings.HasPrefix(l.msg, "Iniciando listado de entidades") {
						continue
					}
					remainingRun = append(remainingRun, l)
				}
				ls = remainingRun
			}
			byBusiness, rest := groupByMilestones(subMap.Blocks(o.id), ls)
			e.Subs = append(e.Subs, byBusiness...)
			// Y se FUSIONAN los pasos que son la misma consulta vista por BD y por log: una fila por cosa,
			// con el hecho y la evidencia juntos, en vez de dos filas que hay que cruzar de cabeza.
			e.Subs = mergeBureaus(e.Subs, subMap.Blocks(o.id), bureaus)
			if len(rest) > 0 {
				// Cuántas de estas llegaron acá POR SPAN y no por patrón. Se dice, porque son las dos cosas a
				// la vez: están en la etapa correcta (el span lo garantiza) y el mapa no las nombra. Ese número
				// es el backlog concreto de hitos por declarar.
				bySpan := 0
				for _, l := range rest {
					if l.inheritedOne {
						bySpan++
					}
				}
				// El renglón ya no dice «candidatos a declararse como hitos»: ese es lenguaje del
				// mantenimiento del mapa, no de una auditoría. El backlog sigue siendo este mismo bloque —
				// está dicho acá y en el comentario de Huerfanas, que es donde lo busca quien mantiene.
				det := "informativos"
				if bySpan > 0 {
					det = fmt.Sprintf("informativos · %d ubicadas por span", bySpan)
				}
				e.Subs = append(e.Subs, Sub{
					Label:  fmt.Sprintf("Eventos sin nombre de negocio (%d líneas)", len(rest)),
					Status: "skip", Source: "loki",
					Detail:   det,
					Children: logGroups(rest),
				})
			}
		}

		// EL LOG YA NO VIVE EN LA ETAPA: vive en cada sub-paso, que es el que lo produjo. Antes esta etapa
		// volcaba sus 110 líneas en un panel al final, mezcladas y sin dueño — había que leerlas enteras para
		// saber cuál correspondía a «Datos personales» y cuál a la cascada de KYC. Con las líneas repartidas
		// se abre el paso que interesa y se ven SUS líneas, como en un run de CI.
		//
		// `EventsOf` a nivel etapa se mantiene como TOTAL (lo usa la cabecera y el aviso de recorte), pero
		// sin `Eventos`: duplicar las líneas en los dos niveles es peso y una segunda verdad que deriva.
		e.EventsOf = len(ls)

		// ── LA RESPUESTA DEL LENDER: cinco casos que la BD sola no distingue ──
		//
		// «no llegó» y «llegó y falló» se ven IDÉNTICOS desde la BD (disbursed_lender vacío en los dos) y
		// sólo la excepción HTTP los separa. Confundirlos manda a revisar el lugar equivocado: uno es
		// problema del agregador y el otro es nuestro.
		if o.id == "respuesta-lender" {
			p := s.Profiling
			failure := len(ls) > 0 // alguna línea con la url del webhook = llegó y explotó
			switch {
			case p != nil && p.Disbursed > 0:
				e.Status, e.Source = "ok", "db"
				e.At = hhmm(p.UpdatedAt)
				nom := fmt.Sprint(p.Disbursed)
				for _, l := range p.Shown {
					if l.ID == p.Disbursed && l.Name != "" {
						nom = l.Name
					}
				}
				// ⚠ `disbursed_lender` LLENO no significa «el webhook llegó»: significa que alguien escribió
				// quién desembolsa, y quién es ese alguien DEPENDE DEL RAMAL. Visto en prod: la uReq 520830
				// (Crediemo, rt=2) y la 509592 (Credifamilia) decían «el webhook se aplicó» — una decide
				// in-platform y la otra radica por SOAP; ninguna tiene ese webhook. Es el mismo error que
				// `Ado` en el buró —un mecanismo atribuido al lugar equivocado— y manda a soporte a revisar
				// una integración inexistente.
				//
				// No se pregunta por el nombre del ramal sino por su DECLARACIÓN: si el ramal puso
				// `respuesta-lender` en `noAplica`, este webhook no es lo que llenó el campo. Así, agregar un
				// ramal nuevo no obliga a volver acá.
				byWebhook := true
				if r := stageMap.Lane(fam); r != nil {
					for _, p := range r.NotApplicable {
						if p.ID == "respuesta-lender" {
							byWebhook = false
						}
					}
				}
				if byWebhook {
					e.Detail = "el webhook se aplicó: desembolsa " + nom
					e.Subs = append(e.Subs, Sub{Label: "Llegó y se aplicó", Status: "ok", Source: "db",
						Detail:   "profiling_reviews.disbursed_lender = " + nom,
						Evidence: webhookEvidence(s)})
				} else {
					// Se dice qué se SABE (el campo está lleno) y qué NO (quién lo llenó). El endpoint del
					// webhook acepta cualquier `lender_id` sin lista blanca —verificado en
					// ListLenderController::storeLenderResult— y no deja huella de recepción (F-94), así que
					// «lo llenó el flujo local» sería una afirmación sin evidencia. La declaración del ramal es
					// lo único que hay, y se cita como lo que es: una declaración.
					e.Detail = fmt.Sprintf("desembolsa %s. ⚠ el ramal «%s» declara que NO espera este webhook "+
						"(%s) — y el campo no dice QUIÉN lo escribió: el webhook no registra su recepción "+
						"(F-94) y su endpoint acepta cualquier lender. El dato es bueno; la etiqueta «webhook» "+
						"no se puede afirmar.", nom, fam, whyNotApplicable(stageMap, fam, "respuesta-lender"))
					e.Subs = append(e.Subs, Sub{Label: "Desembolso registrado, autor desconocido", Status: "ok",
						Source: "db", Detail: "profiling_reviews.disbursed_lender = " + nom,
						Evidence: webhookEvidence(s)})
					// warn y no ok: el mismo ramal rendía esta etapa «no aplica» en una traza y VERDE en la
					// de al lado (522190 vs 522227) — mismo mapa, veredictos opuestos. El dato queda; el
					// color dice que hay una contradicción entre el ramal declarado y el campo lleno.
					e.Status = "warn"
				}
			case failure:
				e.Status, e.Source = "fail", "loki"
				e.At = hhmm(time.UnixMilli(ls[0].ts))
				e.Detail = "el webhook LLEGÓ y terminó en error — el agregador sí respondió, el problema es nuestro"
				e.Subs = append(e.Subs, Sub{Label: "Llegó y falló", Status: "fail", Source: "loki",
					Detail: fmt.Sprintf("%d línea(s) con la url del webhook", len(ls))})
			case s.Status == 3:
				// Estado 3 con lender elegido y sin respuesta: la firma exacta del reporte más frecuente.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = ("sin evidencia de RECEPCIÓN del webhook y la solicitud sigue en «Seleccionó entidad». " +
					"Es la firma del reporte más común de soporte. ⚠ NO se puede afirmar que el agregador no llamó: " +
					"el webhook no loguea su recepción, así que la ausencia no prueba nada.")
				e.Subs = append(e.Subs, Sub{Label: "No llegó (o llegó y no dejó huella)", Status: "skip",
					Source: "db", Detail: "disbursed_lender vacío · sin excepción con la url del webhook",
					Evidence: webhookEvidence(s)})
			case p != nil && p.Disbursed == 0 &&
				stageStatus[s.Status] != "registro" && stageStatus[s.Status] != "formulario":
				// La compuerta de los dos primeros tramos: una solicitud que todavía está en el registro o
				// en el formulario no eligió entidad, y «no registra desembolso» ahí es cierto pero vacío —
				// dispararía en la mitad del universo. El caso que esta rama existe para atrapar es el
				// contrario: estados POSTERIORES (10, 11, 28) o muertes con la fila de perfilamiento vacía.
				// El predicado es el DATO, no el número de estado: los ids no son orden de flujo (el 9 va
				// antes que el 3; el 7 y el 8 son muertes). Cubre el caso más jugoso del censo: la 520593
				// quedó «Autorizada» con disbursed_lender vacío — y hasta acá salía muda.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = fmt.Sprintf("la solicitud está en «%s» y profiling_reviews NO registra desembolso", s.StatusN)
				if badStatuses[s.Status] != "" {
					e.Detail = fmt.Sprintf("la solicitud murió en «%s» sin desembolso registrado", s.StatusN)
				}
				e.Subs = append(e.Subs, Sub{Label: "Sin desembolso registrado", Status: "skip",
					Source: "db", Detail: "disbursed_lender vacío en profiling_reviews",
					Evidence: webhookEvidence(s)})
			case p == nil && fam == "agregador":
				// El ramal que SÍ espera este webhook, sin fila de perfilamiento que citar: 4 de las 7
				// trazas mudas del censo eran exactamente esto, y no tenían ni un renglón que lo dijera.
				e.Status, e.Source = "sin-evidencia", "db"
				e.Detail = "no hay fila en profiling_reviews para esta solicitud: no hay contra qué comparar el webhook"
				e.Subs = append(e.Subs, Sub{Label: "Sin fila de perfilamiento", Status: "skip",
					Source: "db", Evidence: webhookEvidence(s)})
			default:
				e.Status = "skip"
			}
		}

		// ── LISTADO desde la BD: el snapshot exacto de lo que se mostró, con su probabilidad ──
		// Es MEJOR que inferirlo de los logs: `displayed_lenders` es lo que el cliente vio de verdad.
		if o.id == "listado" && s.Profiling != nil && len(s.Profiling.Shown) > 0 {
			p := s.Profiling
			var children []Sub
			for _, l := range p.Shown {
				st, det := "ok", l.Probability
				if l.Approve != nil && !*l.Approve {
					st = "fail"
					det += " · el lender NO aprobó"
				}
				if l.ID == p.Recommended {
					det += " · RECOMENDADO"
				}
				children = append(children, Sub{Label: l.Name, Status: st, Detail: det, Source: "db",
					Detail2: fmt.Sprint(l.ID)})
			}
			// UN SOLO ÁRBOL. El snapshot de `profiling_reviews` dice QUÉ vio el cliente y con qué
			// probabilidad; los logs dicen QUÉ REGLA lo decidió. Son la misma entidad por dos fuentes, así
			// que se fusionan por `lender_id` y recién ahí se agrupa por familia. Antes se concatenaban los
			// dos árboles YA agrupados y cada entidad salía dos veces — el comentario de este bloque decía
			// «para que el árbol sea uno y no dos» y el código hacía exactamente lo contrario.
			byID := map[string]int{}
			for i, h := range children {
				if h.Detail2 != "" {
					byID[h.Detail2] = i
				}
			}
			var loose []Sub
			for _, s2 := range e.Subs {
				i, ok := byID[s2.Detail2]
				if !ok || s2.Detail2 == "" {
					loose = append(loose, s2) // evaluada en logs y no mostrada al cliente: se conserva
					continue
				}
				if s2.Detail != "" {
					if children[i].Detail != "" {
						children[i].Detail += " · " + s2.Detail
					} else {
						children[i].Detail = s2.Detail
					}
				}
				// El estado de la BD manda —es el hecho— salvo que el log traiga un fallo.
				if s2.Status == "fail" {
					children[i].Status = "fail"
				}
				// Y SE LLEVAN LOS EVENTOS. Sin esto la fila fusionada mostraba «4 llamadas · 1 pending» y no
				// abría: el detalle viajaba y las líneas se quedaban en la fila que se descartó. Una fila que
				// anuncia evidencia y no la muestra es peor que no anunciarla.
				if len(s2.Events) > 0 {
					children[i].Events, children[i].EventsOf = s2.Events, s2.EventsOf
				}
				// Las líneas de legacy que nombran a ESTA entidad se suman a las del MS: la fila queda con
				// toda su evidencia junta, incluida la excepción de integración con su causa.
				if rawLines := lenderLines[s2.Detail2]; len(rawLines) > 0 {
					evs, of := eventsOf(rawLines, 40)
					children[i].Events = append(children[i].Events, evs...)
					children[i].EventsOf += of
					sort.Slice(children[i].Events, func(a, b int) bool {
						return children[i].Events[a].At < children[i].Events[b].At
					})
					for _, ev := range evs {
						if ev.Level == "error" {
							children[i].Status = "fail"
							if children[i].Detail != "" && !strings.Contains(children[i].Detail, "con error") {
								children[i].Detail += " · con error"
							}
						}
					}
				}
				if s2.Status == "warn" {
					children[i].Status = "warn" // el `pending` del MS deja la entidad colgada
				}
				children[i].Source = "db+loki"
			}
			e.Subs = append(listingTree(children, lenders), loose...)
			if e.Status == "skip" || e.Status == "sin-evidencia" {
				e.Status, e.Source = "ok", "db"
				e.At = hhmm(p.CreatedAt)
			}
			e.Detail = fmt.Sprintf("%d entidades mostradas al cliente (snapshot de profiling_reviews)", len(p.Shown))
			if runsNote != "" {
				e.Detail += " · " + runsNote
			}

			// ── EL ORDEN DEL LISTADO: UN PASO PROPIO ──
			//
			// El perfilador ML no es una entidad y no debe ensuciar la lista de entidades, pero tampoco es
			// plomería: decide EN QUÉ ORDEN se le muestran los lenders al cliente, y cuando no responde el
			// orden lo dan las matrices de la BD. Antes esta información estaba a tres niveles de profundidad
			// —dentro de una corrida, dentro de un hito— cuando en la uReq 521997 de prod ES el titular: 4
			// timeouts de 15 s, 14 minutos de listado.
			//
			// El QUIÉN sale de la BD (`ML_predictions.perfilador`, que el backend guarda a propósito) y el
			// PORQUÉ de los logs. Va después de las entidades porque ese es su lugar en el flujo: primero se
			// evalúa, después se ordena.
			if p.Profiler != "" || p.MLError != "" || p.MLAnswered {
				// Lo que este renglón contesta es «¿quién puso este orden?» — una pregunta que la lista de
				// entidades no puede contestar y que antes no contestaba nadie, con la evidencia del fallo
				// enterrada tres niveles adentro de «la cascada corrió N veces».
				//
				// ⚠ El fallback NO es «las matrices»: la estrategia es `new_then_legacy`, así que caer al
				// respaldo significa que el perfilador NUEVO falló y puntuó el H2O de siempre. Decirlo mal
				// mandaría a buscar un problema de configuración donde hay un servicio caído.
				st, det := "ok", p.Profiler
				switch {
				case p.MLRaw && p.Profiler == "":
					// El sistema viejo guarda la respuesta sin transformar: trae el resultado pero no el autor.
					det = "no queda registrado cuál perfilador (lo escribió el sistema viejo)"
				case det == "":
					det = "sin registrar quién ordenó"
				}
				if p.MLFallback && p.MLError == "" {
					det += " · el perfilador nuevo falló y respondió el de respaldo"
					st = "warn"
				}
				switch {
				case p.MLError != "" && p.MLFallback:
					// Los dos fallaron. Decir «respondió el de respaldo» y «ninguno respondió» en el mismo
					// renglón, como salía antes, es una contradicción que obliga a leer dos veces.
					det += " · falló el nuevo y también el de respaldo: " + trim(p.MLError, 85)
					st = "fail"
				case p.MLError != "":
					det += " · no respondió: " + trim(p.MLError, 90)
					st = "fail"
				case p.MLScored > 0:
					det += fmt.Sprintf(" · %d entidades puntuadas", p.MLScored)
				case p.MLAnswered:
					det += " · respondió sin puntajes"
					st = "warn"
				}
				if p.MLPrevious != "" {
					det += " · antes intentó " + trim(p.MLPrevious, 80)
				}
				ml := Sub{Label: "Orden del listado (perfilador ML)", Status: st, Source: "db", Detail: det,
					Evidence: evidence("profiling_reviews.ML_predictions", sqlProfiling, []any{s.ID},
						"perfilador          = "+orDash(p.Profiler),
						fmt.Sprintf("fallback_triggered  = %t", p.MLFallback),
						fmt.Sprintf("entidades puntuadas = %d", p.MLScored),
						cond(p.MLError != "", "error               = "+p.MLError),
						cond(p.MLPrevious != "", "previous_attempt    = "+p.MLPrevious),
						cond(p.MLRaw, "⚠ fila escrita por el sistema VIEJO (legacy-application): guarda la respuesta cruda y no registra el perfilador"),
						"created_at          = "+dateTime(p.CreatedAt),
						"updated_at          = "+dateTime(p.UpdatedAt)+"  (se mueve con el webhook del lender: no es la hora del listado)"),
				}
				// Y se le adjunta la evidencia de log del profiler, que hasta acá vivía enterrada tres
				// niveles adentro de «la cascada corrió N veces».
				if len(profilerLines) > 0 {
					ml.Events, ml.EventsOf = eventsOf(profilerLines, 40)
					ml.Source = "db+loki"
					ml.Status = "fail"
					ml.Detail += fmt.Sprintf(" · %s de 15 s", plural(len(profilerLines), "timeout", "timeouts"))
				}
				e.Subs = append(e.Subs, ml)
				// Y va ANTES del cajón de sastre: un paso con nombre propio no puede quedar debajo de
				// «eventos sin nombre de negocio», que es justamente lo que todavía no tiene nombre.
				for i, s := range e.Subs {
					if strings.HasPrefix(s.Label, "Eventos sin nombre") && i < len(e.Subs)-1 {
						e.Subs = append(append(e.Subs[:i:i], e.Subs[i+1:]...), s)
						break
					}
				}
			}
		}

		// ── EL PAGARÉ DIGITAL: LAS CUATRO OPERACIONES CONTRA DECEVAL ──
		//
		// Este tramo está al FINAL del embudo —el cliente ya completó todo y ya validó su OTP— así que un
		// fallo acá es el más caro de todos. Y hasta hoy el trazador no lo veía: `deceval_logs` es de las
		// pocas tablas de log que escriben `user_request_id` (F-108), o sea que se ancla sin inferir nada.
		//
		// ⚠ El detalle accionable es `mensajeRespuesta`; la `<descripcion>` de Deceval es genérica. Y el
		// log es best-effort (try/catch que nunca rompe la firma): que falte una operación NO prueba que
		// no corrió, por eso este bloque no baja el status de la etapa por ausencia — sólo por un rechazo
		// explícito.
		if o.id == "desembolso" && len(s.Deceval) > 0 {
			// El wrapper `createPromisoryNote` repite muchas veces por solicitud (medido en prod: 711 filas
			// para 174 solicitudes) y no aporta veredicto propio: las que deciden son las cuatro
			// operaciones SOAP. Se cuenta aparte en vez de tirarlo, porque su cantidad dice cuántos
			// intentos hubo.
			order := map[string]int{"createGirador": 1, "createPagare": 2, "consultPagare": 3, "signPagare": 4}
			var ops []DecevalOp
			attempts := 0
			for _, op := range s.Deceval {
				if order[op.Method] == 0 {
					attempts++
					continue
				}
				ops = append(ops, op)
			}
			var children []Sub
			rejections, signed := 0, false
			for _, op := range ops {
				st, det := "ok", op.Name
				switch {
				case op.Succeeded != nil && !*op.Succeeded:
					st, rejections = "fail", rejections+1
					det = "Deceval rechazó"
					if op.Code != "" {
						det += " · " + op.Code
					}
					if op.Message != "" {
						det += " · " + trim(op.Message, 110)
					}
				case op.Succeeded == nil:
					// Sin `<exitoso>` no se puede afirmar que salió bien. Pintarlo verde sería inventar.
					st, det = "sin-evidencia", op.Name+" · la respuesta no trae «exitoso»"
				case op.Method == "signPagare":
					signed = true
				}
				label := map[string]string{
					"createGirador": "Registro del firmante (girador)",
					"createPagare":  "Creación del pagaré",
					"consultPagare": "Vista previa del pagaré (PDF)",
					"signPagare":    "Firma del pagaré",
				}[op.Method]
				children = append(children, Sub{Label: label, Status: st, Source: "db", Detail: det,
					Detail2: op.Method,
					Evidence: evidence("deceval_logs", sqlDeceval, []any{s.ID},
						"method            = "+op.Method,
						"name              = "+op.Name,
						"exitoso           = "+cond(op.Succeeded != nil, fmt.Sprintf("%t", op.Succeeded != nil && *op.Succeeded))+cond(op.Succeeded == nil, "(la respuesta no lo trae)"),
						cond(op.Code != "", "codigoError       = "+op.Code),
						cond(op.Message != "", "mensajeRespuesta  = "+op.Message),
						"created_at        = "+dateTime(op.At),
						"⚠ el log es best-effort: una operación que falta NO prueba que no corrió")})
			}
			// ⚠ El orden es de FLUJO, no de hora ni de id: `consultPagare` se vuelve a llamar DURANTE la
			// firma para resolver el id numérico del pagaré, así que ordenar por timestamp lo intercala
			// después de `signPagare` y se lee como un ida y vuelta que no ocurrió. Mismo criterio que el
			// orden de las etapas del árbol.
			sort.SliceStable(children, func(a, b int) bool {
				return order[children[a].Detail2] < order[children[b].Detail2]
			})
			cab := Sub{Label: "Pagaré digital (Deceval)", Source: "db", Children: children}
			switch {
			case rejections > 0:
				cab.Status = "fail"
				cab.Detail = fmt.Sprintf("%s de Deceval", plural(rejections, "rechazo", "rechazos"))
			case signed:
				cab.Status, cab.Detail = "ok", "el pagaré quedó firmado y registrado en Deceval"
			default:
				cab.Status, cab.Detail = "warn", "no hay evidencia de la firma"
			}
			if attempts > len(ops) {
				cab.Detail += fmt.Sprintf(" · %d registros del orquestador", attempts)
			}
			e.Subs = append([]Sub{cab}, e.Subs...)
			if rejections > 0 && e.Status != "no-aplica" {
				e.Status, e.Source = "fail", "db"
				e.Detail = "Deceval rechazó el pagaré: " + cab.Detail
			}
		}

		// ── POR QUÉ NO PASÓ LA POLÍTICA: LA EVALUACIÓN, CRITERIO POR CRITERIO ──
		//
		// Contesta el reporte más frecuente de soporte —«¿por qué a este cliente no le salió CreditopX?»—
		// que hasta acá el trazador NO podía contestar: los logs `CATEGORY_*` no traen quién los llamó (el
		// mapa lo dice en su propia nota), así que ni siquiera se podía atribuir la evaluación a una entidad.
		// `users_category_log` sí: una fila por entidad, con la evaluación completa en JSON.
		//
		// ⚠ TRES cosas que hay que respetar al leerlo, y las tres se aprendieron mirando el escritor:
		//
		//  1. **Una clave ausente NO es un criterio que pasó**: es un criterio que NUNCA SE EVALUÓ. El motor
		//     mide 5 criterios básicos (ocupación, edad, ingreso, género, continuidad) y si alguno falla
		//     RETORNA sin tocar el buró (`LenderUserCategoryService::evaluateEligibility:425`). Por eso se
		//     muestra dónde cortó cada tier y no sólo qué falló.
		//  2. **La misma regla tiene DOS grafías** — `occupation` y `ocupations` — porque la escriben dos
		//     servicios distintos con el mismo nombre de clase. Ver F-118.
		//  3. **La fila no dice a qué solicitud pertenece**: se ata por `user_id` + ventana, igual que el
		//     buró. Lo que se puede afirmar es que cae dentro de ±120 s de la corrida del perfilamiento, y
		//     eso se marca como inferencia, no como hecho (mismo criterio que F-107).
		if o.id == "cupo" && len(s.Categories) > 0 {
			// ⚠ COLAPSAR ES OBLIGATORIO, no cosmético. `getLenderUserCategory` se llama desde TRES sitios y
			// la cascada corre varias veces por solicitud: medido en la uReq 522511 de prod, **nueve filas
			// idénticas de CrediPullman**. Sin colapsar, el paso que existe para contestar «¿por qué no le
			// salió?» contesta lo mismo nueve veces y esconde a las otras entidades. Se agrupa por
			// (entidad + resultado + criterios que fallaron): dos evaluaciones que dieron distinto SÍ son
			// dos renglones, porque eso es información — el motor cambió de opinión.
			vistas := map[string]int{}
			uniqueOnes := make([]Category, 0, len(s.Categories))
			repeats := map[int]int{}
			for _, c := range s.Categories {
				signature := fmt.Sprintf("%d|%d|%s|%v", c.LenderID, c.CatID, c.Special, c.Failures)
				if i, already := vistas[signature]; already {
					repeats[i]++
					// El REPRESENTANTE del grupo tiene que ser la fila que SÍ se puede atribuir a esta
					// solicitud. Quedarse con la primera por orden de id hacía que un grupo con nueve filas
					// —ocho de esta corrida y una de otro intento del mismo cliente— se mostrara con la
					// advertencia «puede ser de otro intento» puesta al conjunto entero. Medido en la
					// uReq 522511 de prod, que tiene evaluaciones de dos solicitudes en la misma ventana.
					if c.Window == "misma" && uniqueOnes[i].Window != "misma" {
						uniqueOnes[i] = c
					}
					continue
				}
				vistas[signature] = len(uniqueOnes)
				uniqueOnes = append(uniqueOnes, c)
			}
			var subs []Sub
			withCat, withoutCat := 0, 0
			for idx, c := range uniqueOnes {
				label := c.Lender
				if label == "" {
					label = fmt.Sprintf("entidad %d", c.LenderID)
				}
				st, det := "ok", ""
				switch {
				case c.Special == "blacklisted":
					st, det = "fail", "documento en la LISTA NEGRA de esta entidad — se salta toda la evaluación"
					withoutCat++
				case c.Special != "":
					st, det = "warn", "atajo `"+c.Special+"`: se saltaron TODAS las reglas y se asignó una categoría fija"
					withCat++
				case c.CatID > 0:
					det = "categoría " + orDash(c.CatName)
					if c.Quota > 0 {
						det += fmt.Sprintf(" · cupo %s", pesosText(c.Quota))
					}
					withCat++
				default:
					st = "fail"
					det = fmt.Sprintf("ninguno de los %s de admisión pasó", plural(c.Tiers, "tier", "tiers"))
					withoutCat++
				}
				// El detalle que importa: qué criterio bloqueó, y en qué tier. Se muestran los tiers en orden
				// y se recorta, porque un lender con 12 tiers repite el mismo motivo doce veces.
				var lines []string
				keys := make([]string, 0, len(c.Failures))
				for k := range c.Failures {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					lines = append(lines, fmt.Sprintf("tier %-6s cortó en %-8s → %s",
						k, c.Short[k], strings.Join(c.Failures[k], ", ")))
				}
				if c.Tiers > 0 && len(c.Failures) == 0 {
					lines = append(lines, fmt.Sprintf("los %d tiers pasaron todos sus criterios", c.Tiers))
				}
				if c.Special != "" {
					lines = append(lines, "bandera de raíz: "+c.Special+" = true (no hay evaluación de tiers)")
				}
				switch c.Window {
				case "otra":
					lines = append(lines, "⚠ fuera de ±120 s de la corrida del perfilamiento: puede ser de OTRO intento del mismo cliente")
				case "sin-referencia":
					lines = append(lines, "esta solicitud no tiene fila de profiling_reviews: no hay corrida contra la cual fechar esta evaluación")
				}
				// El motivo más repetido, arriba: es lo que soporte pega en el ticket.
				if st == "fail" && len(keys) > 0 {
					det += " · el criterio que más bloqueó: " + mostRepeated(c.Failures)
				}
				// Que se haya evaluado N veces con el MISMO resultado no cambia el diagnóstico, pero sí
				// dice que la cascada corrió N veces — que es lo que explica un listado lento.
				if n := repeats[idx]; n > 0 {
					label += fmt.Sprintf("  ×%d", n+1)
					lines = append(lines, fmt.Sprintf("evaluada %d veces con idéntico resultado (getLenderUserCategory se llama desde 3 sitios)", n+1))
				}
				subs = append(subs, Sub{
					Label: label, Status: st, Source: "db", Detail: det,
					Evidence: evidence("users_category_log.category_rules_acceptance", sqlCategories,
						[]any{s.UserID, "<desde>", "<hasta>"}, lines...),
				})
			}
			sort.SliceStable(subs, func(a, b int) bool { return subs[a].Status == "fail" && subs[b].Status != "fail" })
			cab := Sub{Label: "Política por entidad (¿por qué no le salió?)", Source: "db", Children: subs,
				Detail: fmt.Sprintf("%d con categoría · %d sin ninguna", withCat, withoutCat)}
			if len(s.Categories) > len(uniqueOnes) {
				cab.Detail += fmt.Sprintf(" · %d evaluaciones colapsadas en %d", len(s.Categories), len(uniqueOnes))
			}
			cab.Status = "ok"
			if withCat == 0 {
				cab.Status = "fail"
			} else if withoutCat > 0 {
				cab.Status = "warn"
			}
			e.Subs = append([]Sub{cab}, e.Subs...)
			// ── EL STATUS DE `cupo` TAMBIÉN ES UN VEREDICTO ──
			//
			// Misma trampa que ya se corrigió en `listado`: la rama genérica «hay líneas ⇒ ok» pintaba
			// verde una etapa donde el cliente NO obtuvo categoría en ninguna entidad (uReq 522511 de prod:
			// 9 evaluaciones, 0 categorías, y la etapa salía ✔). Que el motor haya corrido no es que haya
			// aprobado. Ahora la BD manda, que es la fuente fuerte.
			if e.Status != "no-aplica" {
				switch {
				case withCat == 0:
					e.Status, e.Source = "fail", "db"
					if len(uniqueOnes) == 1 {
						e.Detail = "la única entidad evaluada no le dio categoría"
					} else {
						e.Detail = fmt.Sprintf("ninguna de las %d entidades evaluadas le dio categoría", len(uniqueOnes))
					}
				case e.Status == "sin-evidencia" || e.Status == "skip":
					e.Status, e.Source, e.Detail = "ok", "db", cab.Detail
				}
				if e.At == "" && len(s.Categories) > 0 {
					e.At = hhmm(s.Categories[0].At)
				}
			}
		}

		// ── EL STATUS DEL LISTADO ES UN VEREDICTO, NO UN PULSO ──
		//
		// La rama genérica «hay líneas ⇒ ok» pintaba verde trazas donde el cliente no vio NINGUNA oferta:
		// 522154 salía ✔ con su única entidad rechazada, y 522230/522238/522239 salían ✔ con puro backlog.
		// «Hubo logs» no es «el cliente vio ofertas». El veredicto, en orden de fuerza:
		//   1. la fila de perfilamiento (BD): len(Mostrados) manda — 0 mostradas es un FALLO del listado;
		//   2. sin fila, el cierre del log («Listado de entidades completado», trae lenders_count);
		//   3. sin veredicto, entidades armadas de logs: todas rechazadas ⇒ fail;
		//   4. sólo líneas y ningún veredicto ⇒ sin-evidencia, no ok.
		if o.id == "listado" && e.Status != "no-aplica" {
			p := s.Profiling
			logCount := -1
			for _, l := range byStage[o.id] {
				if strings.HasPrefix(l.msg, "Listado de entidades completado") {
					if v := pick(l.ctx, []string{"lenders_count"}); v != "" {
						fmt.Sscanf(v, "%d", &logCount)
					}
				}
			}
			entities, dropped := 0, 0
			for _, sb := range e.Subs {
				for _, h := range sb.Children {
					if h.Detail2 != "" {
						entities++
						if h.Status == "fail" {
							dropped++
						}
					}
				}
				if sb.Detail2 != "" {
					entities++
					if sb.Status == "fail" {
						dropped++
					}
				}
			}
			switch {
			case p != nil && len(p.Shown) == 0:
				e.Status, e.Source = "fail", "db"
				e.Detail = "0 entidades mostradas al cliente (profiling_reviews existe y está vacío)"
			case p != nil:
				// ya lo puso el bloque de arriba: ok/db con el snapshot
			case logCount == 0:
				e.Status, e.Source = "fail", "loki"
				e.Detail = "el código cerró el listado con 0 entidades (lenders_count=0; sin snapshot en BD)"
			case logCount > 0:
				e.Status, e.Source = "ok", "loki"
				e.Detail = fmt.Sprintf("el código cerró el listado con %d entidades (sin snapshot en BD)", logCount)
			case entities > 0 && dropped == entities:
				e.Status = "fail"
				e.Detail = fmt.Sprintf("las %d entidades evaluadas quedaron rechazadas y no hay snapshot en BD", entities)
			case e.Status == "ok" && e.Source == "loki":
				e.Status = "sin-evidencia"
				e.Detail = "hay actividad en los logs pero ningún veredicto: no se puede afirmar que el cliente vio ofertas"
			}
		}

		// El porqué: el primer error de la etapa. Nunca cambia el status a fail por sí solo — eso lo
		// decide la BD. Un error logueado puede ser un reintento que después salió bien.
		for _, l := range ls {
			if l.level == "error" {
				if c := pick(l.ctx, []string{"error_code"}); c != "" {
					e.Reason = c
					if sub := pick(l.ctx, []string{"error_subcode", "subcode"}); sub != "" {
						e.Reason += "/" + sub
					}
					e.Reason += " · " + trim(l.msg, 90)
				} else {
					e.Reason = trim(l.msg, 110)
				}
				if e.Status == "ok" {
					e.Status = "warn" // pasó, pero con ruido: hay que mirarlo
				}
				break
			}
		}

		// ── «NO APLICA A ESTE RAMAL» ──
		//
		// Los ramales ya declaraban en `noAplica` qué etapas no existen para cada familia, pero eso sólo se
		// usaba para dibujar el diagrama: el ensamblado mostraba las nueve etapas para toda solicitud. Por eso
		// una solicitud rt=0 (que SALE a una url externa y no vuelve) mostraba «Validación biométrica · no
		// consultada», como si hubiera un tramo que se saltó. Es la misma familia de error que tenía `Ado` en
		// el buró: un lugar del flujo donde eso no ocurre nunca.
		//
		// ⚠ SÓLO cuando la etapa NO TIENE EVIDENCIA, y «evidencia» no es «tiene subs»: el catálogo declarado
		// ya mete una fila por central con «no consultada», que es un placeholder, no un hecho. Si se mide
		// por `len(Subs)` la regla nunca dispara — así lo escribí primero y no disparó. Evidencia = un sub
		// con datos (status ≠ skip), líneas de log, o una hora.
		//
		// Si aparece evidencia en una etapa declarada no-aplicable, se muestra tal cual: declarar «no aplica»
		// NO puede hacer desaparecer un dato medido, y la contradicción es un hallazgo — o el mapa está mal o
		// el flujo cambió.
		// Se miran LOS DOS EJES: el canal (por comercio) y el ramal (por response_type del lender). El canal
		// va primero porque decide antes en el flujo —en la validación del OTP— y porque existe sin que haya
		// lender elegido todavía, mientras el ramal sólo se conoce después de `seleccion`.
		if declNotApplicable != "" && !hasEvidence(e) {
			e.Status, e.Source = "no-aplica", "db"
			e.Detail = "no aplica a « " + declNotApplicable + " » — " + declReason
			e.Reason = "" // el diagnóstico de la etapa asume que el tramo existe; acá no existe
			e.Subs = nil  // eran placeholders del catálogo: listarlos invita a buscar lo que no hay
		}
		t.Stages = append(t.Stages, e)
	}

	// Las etapas anteriores a la última probada se marcan `sin-registro`: ocurrieron (el flujo pasó por
	// ahí) pero la BD no las anotó. Distinto de `skip`, que es "el flujo no llegó".
	//
	// ⚠ SÓLO SI EL RAMAL LA DECLARA OBLIGATORIA. «El flujo siguió, así que esto ocurrió» vale para una etapa
	// por la que hay que pasar; para una CONDICIONAL es una invención. Los ramales ya declaran `obligatorio`
	// exactamente para esto y la inferencia no lo miraba: por eso `formulario` —cuyas dos pantallas salen
	// sólo con ONB002/ONB004, y que un usuario ya registrado se salta entero— venía diciendo «ocurrió pero no
	// quedó registrada» de una pantalla que probablemente nunca se mostró.
	// Las etapas que dependen del RAMAL: sin entidad elegida no hay ramal, y sin ramal no se puede afirmar
	// que estas ocurrieron. El default anterior (`fam=="" → true`) hacía exactamente eso: en la uReq 520593
	// (estado 11 SIN lender) el árbol decía que la selección de entidad «ocurrió» en una solicitud que no
	// tiene entidad. La salvaguarda del condicional sólo funcionaba cuando había ramal — fallaba justo en
	// la familia sin ramal, que es la mitad del universo.
	ofLane := map[string]bool{"seleccion": true, "respuesta-lender": true, "biometria": true, "desembolso": true}
	required := func(id string) bool {
		if fam == "" {
			return !ofLane[id] // el tronco sí se puede afirmar por progresión; el tramo ramal no
		}
		r := stageMap.Lane(fam)
		if r == nil {
			return true
		}
		for _, p := range r.Steps {
			if p.ID == id {
				return p.Required
			}
		}
		return false // no está entre los pasos del ramal: no se puede afirmar que ocurrió
	}
	lastTried := -1
	for i, e := range t.Stages {
		if e.Status == "ok" || e.Status == "warn" || e.Status == "fail" {
			lastTried = i
		}
	}
	for i := range t.Stages {
		if i >= lastTried || t.Stages[i].Status != "skip" {
			continue
		}
		if required(t.Stages[i].ID) {
			t.Stages[i].Status = "sin-registro"
			t.Stages[i].Detail = "ocurrió (el flujo siguió más adelante) pero no quedó registrada"
			continue
		}
		// `condicional` y no `skip`: la vista traduce `skip` como «no se ejecutó», que es una AFIRMACIÓN — la
		// misma que este texto se niega a hacer. Dejarlo en `skip` ponía el rótulo «no se ejecutó» justo
		// encima de «no se puede afirmar ninguna de las dos cosas».
		t.Stages[i].Status = "condicional"
		if fam == "" {
			t.Stages[i].Detail = "sin entidad elegida no hay ramal: no se puede afirmar si este tramo ocurrió"
		} else {
			t.Stages[i].Detail = fmt.Sprintf("sin registro y CONDICIONAL en «%s»: el flujo siguió, pero esta "+
				"etapa puede no haber ocurrido — no se puede afirmar ninguna de las dos cosas", fam)
		}
	}

	// La etapa donde se rompió: la primera sin ok DESPUÉS de la última que sí ocurrió — y ahora el código
	// hace lo que este comentario siempre prometió. El bucle arrancaba en 0 e ignoraba `lastTried`
	// (calculada veinte líneas más arriba), así que en 6 de 6 trazas rotas del censo señalaba una etapa
	// ANTERIOR a la evidencia. Y se excluye lo que el propio trazador declara no afirmable: culpar a una
	// etapa `no-aplica` o `sin-evidencia` es afirmar con la mano izquierda lo que se negó con la derecha.
	if t.Outcome == "roto" || t.Outcome == "abandonado" {
		for i := lastTried + 1; i >= 0 && i < len(t.Stages); i++ {
			switch t.Stages[i].Status {
			case "ok", "warn", "sin-evidencia", "no-aplica", "condicional":
				continue
			}
			t.BrokeAt = t.Stages[i].ID
			break
		}
	}
	if badStatuses[s.Status] != "" {
		t.Warnings = append(t.Warnings, fmt.Sprintf("desenlace de muerte en BD: estado %d «%s»", s.Status, s.StatusN))
	}
	// Un estado que el mapa no conoce Y que no es desenlace: la solicitud está parada en un lugar que el
	// árbol no puede señalar. Medido: 21 «En aprobación del médico» (13 casos en 5 semanas) y 22 (1 caso).
	// Con tan pocos casos no merecen etapa —sería el hito que nunca dispara—, pero callarlos convertiría
	// la cabecera en la única pista y nadie mira la cabecera buscando un hueco del mapa.
	if _, ok := stageStatus[s.Status]; !ok && badStatuses[s.Status] == "" && s.Status != 7 {
		t.Warnings = append(t.Warnings, fmt.Sprintf("el estado actual %d «%s» NO está mapeado a ninguna etapa: "+
			"el árbol no muestra dónde está parada esta solicitud", s.Status, s.StatusN))
	}
	// Las horas de las etapas deberían crecer. Cuando no crecen, el historial de esa solicitud NO está en
	// orden de flujo — pasa de verdad (visto en la 464432: cancelada 10:38, selección 16:29, formulario
	// 16:49). Puede ser una solicitud reutilizada, un backfill, o un estado escrito fuera de secuencia. Se
	// avisa en vez de ordenarlo por hora: reordenar escondería el dato y la etapa quedaría en el lugar
	// equivocado del flujo.
	prev, unordered := "", ""
	for _, et := range t.Stages {
		if et.At == "" || (et.Status != "ok" && et.Status != "warn" && et.Status != "fail") {
			continue
		}
		if prev != "" && et.At < prev {
			unordered = et.Label
		}
		prev = et.At
	}
	if unordered != "" {
		t.Warnings = append(t.Warnings, "las horas no son monótonas («"+unordered+"» es anterior a la etapa previa): "+
			"el historial de esta solicitud no está en orden de flujo — ¿reutilizada? ¿backfill? Las etapas se muestran "+
			"en orden de FLUJO, no de hora.")
	}

	if len(lines) == 0 {
		t.Warnings = append(t.Warnings, "sin líneas de log: el porqué no se pudo enriquecer (¿fuera de retención? ¿backend sin instrumentar?)")
	}
	sort.Strings(t.Sources)
	// De los mensajes al CÓDIGO. Si el mapa no está construido devuelve -1 y no se agrega nada: un
	// bloque «0 archivos» se leería como «no corrió ninguno», que es falso.
	{
		msgs := make([]string, 0, len(lines))
		for _, l := range lines {
			msgs = append(msgs, l.msg)
		}
		if arch, without := traceFiles(msgs); without >= 0 {
			t.Files, t.Unresolved = arch, without
		}
		if steps, ult := reachedSteps(msgs); ult >= 0 {
			t.Tree, t.TreeLast = steps, ult
		}
	}
	hoistErrorsWithoutMilestone(&t)
	buildFindings(&t)
	return t
}

// groupByMilestones reparte las líneas de una etapa entre los HITOS declarados en mapa/substeps.json y
// devuelve un Sub por hito con actividad — con su NOMBRE DE NEGOCIO — más las líneas que ningún hito
// reclamó. Es lo que hace legible la vista: «Datos personales ×24» dice algo; el nombre del orquestador
// no. Los nombres viven en el JSON a propósito: afinarlos es editar datos, no Go.
//
// Lo no reclamado NO se esconde: se pliega como «eventos sin nombre de negocio», que es el backlog
// honesto de hitos por declarar. Esconderlo haría parecer que el mapa cubre todo, que es justo lo que no
// se puede saber sin mirarlo.
func groupByMilestones(blocks []*BlockDef, ls []Line) ([]Sub, []Line) {
	type acc struct {
		n     int
		first int64
		err   string
		lines []Line // las líneas de ESTE hito, para poder abrirlo y ver sus logs
	}
	byMilestone := map[string]*acc{}
	var rest []Line
	for _, l := range ls {
		var owner *MilestoneDef
		for _, b := range blocks {
			for i := range b.Milestones {
				h := &b.Milestones[i]
				if h.Matcher != nil && h.Matcher.matches(l.msg, l.ctx) {
					owner = h
					break
				}
			}
			if owner != nil {
				break
			}
		}
		if owner == nil {
			rest = append(rest, l)
			continue
		}
		a := byMilestone[owner.ID]
		if a == nil {
			a = &acc{first: l.ts}
			byMilestone[owner.ID] = a
		}
		a.n++
		a.lines = append(a.lines, l)
		if l.level == "error" && a.err == "" {
			if c := pick(l.ctx, []string{"error_code"}); c != "" {
				a.err = c
			} else {
				a.err = "error"
			}
		}
	}
	// UN SUB POR BLOQUE, con sus hitos como hijos. Antes esto devolvía la lista plana de hitos y el mapa ya
	// declaraba los grupos —«Centrales», «Validación de identidad (KYC)», «¿Se disparó?»—, así que el
	// agrupamiento existía y se tiraba: el buró mostraba «Pasos 14» mezclando el RESULTADO (a quién se
	// consultó y qué dijo) con el PROCESO (qué fue pasando). Son dos preguntas distintas y en una lista de 14
	// no se lee ninguna.
	var subs []Sub
	for _, b := range blocks {
		var children []Sub
		wrong, first := false, int64(0)
		for _, h := range b.Milestones {
			a := byMilestone[h.ID]
			if a == nil {
				continue // los hitos SIN actividad los pinta la vista desde el mapa, apagados
			}
			st := "ok"
			// Un hito ENLAZADO a una central no lleva hora: se va a fusionar con la fila de BD, que ya trae
			// la suya, y dos horas seguidas en un mismo renglón no se leen — parecen dos eventos.
			det := fmt.Sprintf("×%d · %s", a.n, hhmm(time.UnixMilli(a.first)))
			if h.Central != 0 {
				det = fmt.Sprintf("×%d", a.n)
			}
			if a.err != "" {
				// `a.err` es el `error_code` cuando existe y el literal "error" cuando no. Concatenarlo
				// siempre daba «×10 con error error».
				suffix := " con error"
				if a.err != "error" {
					suffix += " " + a.err
				}
				st, det, wrong = "fail", det+suffix, true
			}
			hj := Sub{Label: h.Label, Status: st, Detail: det, Source: "loki"}
			hj.Events, hj.EventsOf = eventsOf(a.lines, 40)
			children = append(children, hj)
			if first == 0 || a.first < first {
				first = a.first
			}
		}
		if len(children) == 0 {
			continue
		}
		st, det := "ok", fmt.Sprintf("%s · %s", plural(len(children), "paso", "pasos"), hhmm(time.UnixMilli(first)))
		if wrong {
			st, det = "fail", "con error · "+det
		}
		// La pantalla, al final del renglón: es lo que permite leer el árbol en el idioma del reporte sin
		// perder el del backend. Va con el nombre crudo de la ruta —`sign-documents`, no «Firma»— porque
		// así se busca en `routes.ts` y así se nombra entre quienes tocan el wizard.
		if b.Screen != "" {
			det += " · pantalla " + b.Screen
		}
		subs = append(subs, Sub{Label: b.Label, Status: st, Detail: det, Source: "loki", Children: children})
	}
	return subs, rest
}

// eventsOf convierte líneas crudas en eventos para la vista, en orden cronológico y con tope.
//
// LOS ERRORES VAN PRIMERO AL RECORTAR y después se reordena por hora: si hay que cortar, lo que no puede
// faltar es la línea que explica el fallo. Es la misma regla que ya usaba el panel de log de la etapa —
// vive acá para que valga igual en los dos lugares en vez de duplicarse y derivar.
func eventsOf(ls []Line, limit int) ([]Event, int) {
	if len(ls) == 0 {
		return nil, 0
	}
	order := make([]Line, 0, len(ls))
	for _, l := range ls {
		if l.level == "error" {
			order = append(order, l)
		}
	}
	for _, l := range ls {
		if l.level != "error" {
			order = append(order, l)
		}
	}
	if limit > 0 && len(order) > limit {
		order = order[:limit]
	}
	sort.Slice(order, func(i, j int) bool { return order[i].ts < order[j].ts })
	out := make([]Event, 0, len(order))
	for _, l := range order {
		out = append(out, Event{At: hhmm(time.UnixMilli(l.ts)), Level: l.level, Msg: trim(l.msg, 400)})
	}
	return out, len(ls)
}

// logGroups colapsa las líneas de una etapa en renglones legibles: uno por `Clase::metodo` (o por
// mensaje normalizado si no lo tiene), con su conteo y marcado en rojo si alguna de esas líneas fue error.
//
// El tope de 8 renglones se DECLARA cuando corta: un resumen que esconde que recortó se lee como completo,
// y eso es peor que mostrar mucho.
func logGroups(ls []Line) []Sub {
	type g struct {
		n      int
		err    string
		primer int64
		lines  []Line // igual que en los hitos: abrir el renglón muestra SUS líneas
	}
	keys := map[string]*g{}
	var order []string
	reMet := regexp.MustCompile(`^([A-Za-z][\w\\]*?(?:Controller|Service|Repository|Orchestrator))::(\w+)`)
	reNum := regexp.MustCompile(`\d{3,}`)
	reVerb := regexp.MustCompile(`^(?:Starting|Ending|Calling)\s+`)
	for _, l := range ls {
		k := ""
		msg := reVerb.ReplaceAllString(l.msg, "")
		if m := reMet.FindStringSubmatch(msg); m != nil {
			parts := strings.Split(m[1], `\`)
			k = parts[len(parts)-1] + "::" + m[2]
		} else {
			k = trim(reNum.ReplaceAllString(msg, "N"), 64)
		}
		it, ok := keys[k]
		if !ok {
			it = &g{primer: l.ts}
			keys[k] = it
			order = append(order, k)
		}
		it.n++
		it.lines = append(it.lines, l)
		if l.level == "error" && it.err == "" {
			if c := pick(l.ctx, []string{"error_code"}); c != "" {
				it.err = c
			} else {
				it.err = "error"
			}
		}
	}
	sort.Slice(order, func(i, j int) bool { return keys[order[i]].primer < keys[order[j]].primer })
	// SIN TOPE: el recorte es decisión de la VISTA, no del dato. La versión con tope de 8 escondió ≥265
	// grupos en el censo de 25 trazas y el `-json` no publicaba ni su texto ni su conteo — o sea que el
	// propio censo que audita este mapa estaba censando una lista truncada sin saberlo. La terminal
	// recorta al imprimir (y lo dice); el JSON viaja completo, que para eso existe.
	var out []Sub
	for _, k := range order {
		it := keys[k]
		st, d := "ok", fmt.Sprintf("×%d · %s", it.n, hhmm(time.UnixMilli(it.primer)))
		if it.err != "" {
			st, d = "fail", it.err+" · "+d
		}
		sb := Sub{Label: k, Status: st, Detail: d, Source: "loki"}
		sb.Events, sb.EventsOf = eventsOf(it.lines, 40)
		out = append(out, sb)
	}
	return out
}

// webhookEvidence cita la fila de perfilamiento en los tres desenlaces del webhook. Los tres se apoyan
// en el MISMO campo (`disbursed_lender` lleno o vacío), así que los tres tienen que poder mostrarlo — el
// que dice «no llegó» es justamente el que más necesita probar que miró.
func webhookEvidence(s *LoanRequest) *Evidence {
	p := s.Profiling
	if p == nil {
		return evidence("profiling_reviews", sqlProfiling, []any{s.ID},
			"(sin fila: esta solicitud nunca se perfiló)")
	}
	return evidence("profiling_reviews", sqlProfiling, []any{s.ID},
		fmt.Sprintf("recommended_lender = %d", p.Recommended),
		fmt.Sprintf("disbursed_lender   = %d%s", p.Disbursed, cond(p.Disbursed == 0, "   ← vacío")),
		fmt.Sprintf("displayed_lenders  = %d entidades", len(p.Shown)),
		"created_at         = "+dateTime(p.CreatedAt),
		"updated_at         = "+dateTime(p.UpdatedAt),
		"⚠ F-94: el webhook NO registra su recepción y su endpoint acepta cualquier lender_id, así que este campo no dice QUIÉN lo escribió")
}

// cond devuelve el texto sólo si la condición se cumple; `evidencia` descarta los vacíos. Evita armar los
// bloques con ifs sueltos y que una línea quede en blanco diciendo nada.
func cond(ok bool, txt string) string {
	if ok {
		return txt
	}
	return ""
}

// currentStatusRow dice de dónde sale el estado que se está reportando y si el historial lo respalda.
// Separar las dos fuentes es el punto: si el estado actual no aparece en el recorrido, la fila lo dice en
// vez de dejar que el lector asuma que la lista de arriba está completa.
func currentStatusRow(s *LoanRequest) string {
	for _, tr := range s.Transitions {
		if tr.Status == s.Status {
			return fmt.Sprintf("← user_requests.user_request_status_id = %d · el historial termina acá y no registra ninguna transición posterior", s.Status)
		}
	}
	return fmt.Sprintf("← user_requests.user_request_status_id = %d («%s») · ⚠ el historial NO tiene fila para este estado: "+
		"`user_request_records` no registra todas las transiciones, así que la lista de arriba no es el recorrido completo",
		s.Status, s.StatusN)
}

// historyRows rinde el historial ya colapsado, en el mismo orden en que se leyó.
func historyRows(s *LoanRequest) []string {
	out := make([]string, 0, len(s.Transitions))
	for _, tr := range s.Transitions {
		out = append(out, fmt.Sprintf("%s  estado %d · %s", dateTime(tr.At), tr.Status, tr.Name))
	}
	return out
}

// deathStage dice en qué etapa se detuvo: la siguiente a la última que la BD probó. Es una inferencia
// del ESQUELETO (no de logs), así que se puede afirmar.
func deathStage(stageMap *Map, s *LoanRequest, byStage map[string][]Line) string {
	// La última etapa CON EVIDENCIA —transición que cierra o líneas de log— y la muerte es la siguiente.
	//
	// ⚠ Antes ignoraba los logs y, sin historial mapeado, FABRICABA una etapa: en la uReq 522215 pintó
	// «registro fail · estado 8» con CERO líneas y CERO subs, mientras los únicos errores de la traza
	// estaban en cupo y desembolso. Un renglón rojo inventado manda a soporte a la etapa equivocada, que
	// es lo único peor que no señalar ninguna. Si no hay evidencia de ninguna etapa, se devuelve "" y la
	// muerte queda sin ubicar — «cancelada, no se puede ubicar» es una respuesta; un fantasma no.
	ord := stageMap.Order()
	lastOne := -1
	for i, o := range ord {
		if len(byStage[o.id]) > 0 {
			lastOne = i
		}
	}
	for _, tr := range s.Transitions {
		e, ok := stageStatus[tr.Status]
		if !ok || !closingStatus[tr.Status] {
			continue
		}
		for i, o := range ord {
			if o.id == e && i > lastOne {
				lastOne = i
			}
		}
	}
	switch {
	case lastOne < 0:
		return ""
	case lastOne+1 < len(ord):
		return ord[lastOne+1].id
	}
	return ord[lastOne].id
}

// hhmm es el ÚNICO formateador de horas: las de la BD llegan en UTC y las de los logs en epoch, y
// mezclarlas sin normalizar fue lo que desordenó la primera versión de la línea de tiempo.
func hhmm(t time.Time) string { return t.Local().Format("15:04:05") }

// dateTime: la MISMA hora local que muestra el árbol, con la fecha. Va en la evidencia, y ahí la zona no
// es cosmética: la evidencia se copia y se pega en Redash junto al `created_at` de la consulta. Formatear
// en UTC mientras el árbol dice Bogotá manda a buscar en una ventana cinco horas corrida — el mismo tipo
// de desfase que ya se corrigió al parsear (`fecha`, en fuentes.go).
func dateTime(t time.Time) string { return t.Local().Format("2006-01-02 15:04:05") }

// statusAt busca cuándo se registró un estado puntual. Se usa para la etapa de muerte: tomar "la
// última transición" daba una hora ANTERIOR al resto del flujo, porque `user_request_records` no siempre
// viene en orden cronológico.
func statusAt(s *LoanRequest, status int) string {
	for i := len(s.Transitions) - 1; i >= 0; i-- {
		if s.Transitions[i].Status == status {
			return hhmm(s.Transitions[i].At)
		}
	}
	return lastAt(s)
}

func lastAt(s *LoanRequest) string {
	if n := len(s.Transitions); n > 0 {
		return hhmm(s.Transitions[n-1].At)
	}
	return hhmm(s.Created)
}

// ─── render tipo «checks» ───────────────────────────────────────────────────────────────────────────

func printTrace(t Trace, s *LoanRequest) {
	icon := map[string]string{
		"ok": paint("32", "✔"), "warn": paint("33", "!"), "fail": paint("31", "✘"),
		"skip": gray("·"), "sin-evidencia": paint("33", "?"), "sin-registro": gray("~"),
		// `no-aplica` lleva glifo PROPIO y no el punto de `skip`: «acá esto no ocurre nunca en este ramal» es
		// una pregunta cerrada, y verla igual que «podía pasar y no pasó» manda a buscar un tramo que no existe.
		"no-aplica": gray("∅"), "condicional": gray("·"),
	}
	fmt.Println()
	fmt.Printf("  %s\n", bold(fmt.Sprintf("── TRAZA · uReq %d · %s ──", t.UReq, t.Target)))
	fmt.Printf("     %s · %s%s · monto %s\n",
		orDash(s.Merchant), orDash(s.Branch),
		func() string {
			if s.Lender != "" {
				return fmt.Sprintf(" · %s (rt=%d)", s.Lender, s.LenderRT)
			}
			return ""
		}(),
		fmt.Sprintf("%.0f", s.Amount))

	res := map[string]string{"aprobado": green("aprobado"), "roto": red("roto"),
		"abandonado": paint("33", "abandonado"), "en-curso": gray("en curso")}[t.Outcome]
	fmt.Printf("     estado %d «%s» → %s%s\n", s.Status, s.StatusN, res,
		func() string {
			if t.BrokeAt != "" {
				return red(" · se rompió en «" + t.BrokeAt + "»")
			}
			return ""
		}())
	// EL RESUMEN PRIMERO: soporte abre esto con una pregunta («¿dónde se rompió?») y la respuesta no
	// puede estar repartida en cien renglones de árbol. Si no hay fallas, no hay sección.
	if len(t.Findings) > 0 {
		fmt.Println()
		for _, h := range t.Findings {
			fmt.Printf("     %s %s\n", red("✘"), h)
		}
	}
	fmt.Println()

	for _, e := range t.Stages {
		source := gray("")
		switch e.Source {
		case "db":
			source = gray("[BD]")
		case "loki":
			source = gray("[logs]")
		case "default":
			source = gray("[supuesto]")
		default:
			source = gray("[—]")
		}
		line := fmt.Sprintf("     %s %-22s %-7s %s", icon[e.Status], e.Label, e.At, source)
		if e.Lines > 0 {
			line += gray(fmt.Sprintf(" %d líneas", e.Lines))
		}
		fmt.Println(line)
		if e.Detail != "" {
			fmt.Printf("          %s\n", gray(e.Detail))
		}
		// EL ÁRBOL: familia o central en un nivel, las entidades colgando. Con guías a propósito — sin
		// ellas hay que contar espacios para saber qué cuelga de qué, y entonces el árbol no ahorra nada.
		// EL ÁRBOL: familia o central en un nivel, las entidades colgando. Con guías a propósito — sin
		// ellas hay que contar espacios para saber qué cuelga de qué, y entonces el árbol no ahorra nada.
		// Se imprime COMPLETO: nada se esconde por ser rutina (ver hoistErrorsWithoutMilestone).
		for i, sb := range e.Subs {
			ult := i == len(e.Subs)-1
			branchName := "├─"
			if ult {
				branchName = "└─"
			}
			fmt.Printf("          %s %s %s  %s\n", gray(branchName), dot(sb.Status),
				pad(sb.Label, 32), gray(trim(sb.Detail, 54)))
			guide := "│ "
			if ult {
				guide = "  "
			}
			// El recorte vive ACÁ, en la vista: primero los que fallan (el recorte no puede comerse la
			// causa), después la rutina hasta el tope. El JSON no recorta nada.
			children := sb.Children
			trimmed := 0
			if len(children) > 12 {
				withError := children[:0:0]
				var healthy []Sub
				for _, h := range children {
					if h.Status == "fail" {
						withError = append(withError, h)
					} else {
						healthy = append(healthy, h)
					}
				}
				if len(withError) < 12 {
					withError = append(withError, healthy[:12-len(withError)]...)
				}
				trimmed = len(children) - len(withError)
				children = withError
			}
			for j, h := range children {
				sub := "├─"
				if j == len(children)-1 && trimmed == 0 {
					sub = "└─"
				}
				fmt.Printf("          %s  %s %s %s  %s\n", gray(guide), gray(sub), dot(h.Status),
					pad(h.Label, 28), gray(trim(h.Detail, 48)))
			}
			if trimmed > 0 {
				fmt.Printf("          %s  %s %s\n", gray(guide), gray("└─ ·"),
					gray(fmt.Sprintf("… y %d más — completos en la UI y en -json; con error nunca se recorta", trimmed)))
			}
		}
		if e.Reason != "" {
			fmt.Printf("          %s %s\n", red("→"), e.Reason)
		}
	}

	fmt.Println()
	if len(t.Tree) > 0 {
		fmt.Printf("\n     %s\n", bold("DÓNDE QUEDÓ · el recorrido en 39 pasos"))
		segment := ""
		for i, p := range t.Tree {
			// Sólo se imprimen los tramos que tuvieron algo, MÁS el que sigue al último alcanzado:
			// el valor está en ver dónde se cortó, no en listar 39 renglones vacíos.
			if p.Lines == 0 && i > t.TreeLast+3 {
				continue
			}
			if p.Segment != segment {
				segment = p.Segment
				fmt.Printf("       %s\n", gray(segment))
			}
			mark, det := gray("·"), ""
			if p.Lines > 0 {
				mark = paint("32", "●")
				plural := "líneas"
				if p.Lines == 1 {
					plural = "línea"
				}
				det = gray(fmt.Sprintf("  %d %s", p.Lines, plural))
			}
			if i == t.TreeLast {
				det += paint("33", "   ◄ hasta acá llegó")
			}
			fmt.Printf("         %s %-40s%s\n", mark, p.Step, det)
		}
		fmt.Println()
	}
	if len(t.Screens) > 0 {
		fmt.Printf("\n     %s\n", bold("QUÉ VIO EL CLIENTE EN EL NAVEGADOR"))
		for _, p := range t.Screens {
			extra := ""
			if p.Detail != "" {
				extra = gray("  · " + p.Detail)
			}
			fmt.Printf("       %s  %s%s\n", gray(p.When), p.What, extra)
		}
		if t.PHNotice != "" {
			fmt.Printf("       %s\n", gray(t.PHNotice))
		}
	}
	if len(t.Files) > 0 {
		fmt.Printf("\n     %s\n", bold("EL CÓDIGO QUE DEJÓ RASTRO"))
		for _, a := range t.Files {
			where := ""
			if len(a.Lines) > 0 {
				where = gray("  :" + strings.Join(a.Lines, ","))
			}
			fmt.Printf("       %3d×  %s%s\n", a.Times, a.Path, where)
		}
		if t.Unresolved > 0 {
			fmt.Printf("       %s\n", gray(fmt.Sprintf(
				"(%d mensajes no matchean ningún literal del código — el mapa no los conoce)", t.Unresolved)))
		}
		fmt.Println()
	}
	fmt.Printf("     %s %s\n", gray("fuentes:"), strings.Join(t.Sources, " + "))
	for _, w := range t.Warnings {
		fmt.Printf("     %s %s\n", paint("33", "⚠"), w)
	}
	fmt.Printf("     %s\n", gray("la BD dice QUÉ pasó · los logs dicen POR QUÉ · «?» = la BD no registra esa etapa"))
}

// ── IZAR LOS ERRORES SIN HITO · ARMAR EL RESUMEN ────────────────────────────────────────────────────
//
// Acá vivió un pliegue de la rutina: los pasos que corrían bien y no decidían nada se colapsaban a un
// renglón «N sin novedad». Se quitó a pedido, y la razón por la que no vuelve es buena: el criterio de
// qué es rutina era una HEURÍSTICA sobre la etiqueta (una regex de «rechaz|fall|erro|timeout…»), o sea
// que el árbol escondía renglones según una adivinanza. Para una herramienta cuyo trabajo es sostener
// afirmaciones, esconder por corazonada es el trato equivocado: quien audita quiere ver TODO lo que
// corrió, y el resumen de arriba ya contesta «¿dónde se rompió?» sin quitarle nada a la lista.

// hoistErrorsWithoutMilestone saca a la vista los errores que cayeron en «eventos sin nombre de negocio». Un error
// sin hito declarado seguía siendo un error: dejarlo dentro del cajón de sastre lo escondía detrás de un
// renglón gris que se lee como «acá no pasó nada».
func hoistErrorsWithoutMilestone(t *Trace) {
	for i := range t.Stages {
		e := &t.Stages[i]
		subs := e.Subs[:0:0]
		for _, s := range e.Subs {
			if !strings.HasPrefix(s.Label, "Eventos sin nombre") {
				subs = append(subs, s)
				continue
			}
			remaining := s.Children[:0:0]
			for _, h := range s.Children {
				if h.Status == "fail" {
					h.Detail += " · sin hito declarado"
					subs = append(subs, h)
					continue
				}
				remaining = append(remaining, h)
			}
			s.Children = remaining
			subs = append(subs, s)
		}
		e.Subs = subs
	}
}

// buildFindings junta TODO lo que quedó en fail con su ruta. Con tope declarado: si hay más de 8, el
// último renglón lo dice — un resumen que recorta en silencio se lee como completo, y no lo es.
func buildFindings(t *Trace) {
	seen := map[string]bool{}
	skipped := 0
	add := func(txt string) {
		if txt == "" || seen[txt] {
			return
		}
		seen[txt] = true
		if len(t.Findings) >= 8 {
			skipped++
			return
		}
		t.Findings = append(t.Findings, txt)
	}
	for _, e := range t.Stages {
		before := len(t.Findings)
		// Si un descendiente ya está en fail, el padre NO entra al resumen: «Registro del cliente — con
		// error · 6 pasos» y «redirect — 1 rechazada(s)» son el mismo hallazgo que su hijo, dicho sin la
		// causa. El renglón útil es la hoja.
		var hasFailureBelow func(s Sub) bool
		hasFailureBelow = func(s Sub) bool {
			for _, h := range s.Children {
				if h.Status == "fail" || hasFailureBelow(h) {
					return true
				}
			}
			return false
		}
		var rec func(s Sub)
		rec = func(s Sub) {
			if s.Status == "fail" && !hasFailureBelow(s) {
				txt := s.Detail
				// La primera línea de error del paso suele decir más que su Detail («HTTP 401 …» contra
				// «con error»); si existe, es la que va al resumen.
				for _, ev := range s.Events {
					if ev.Level == "error" {
						txt = ev.Msg
						break
					}
				}
				add(fmt.Sprintf("%s › %s — %s", e.Label, s.Label, trim(txt, 96)))
			}
			for _, h := range s.Children {
				rec(h)
			}
		}
		for _, s := range e.Subs {
			rec(s)
		}
		// El Reason de la etapa suele ser el MISMO error que ya aportó un paso; solo suma cuando la etapa
		// falló sin que ningún paso lo dijera.
		if e.Reason != "" && len(t.Findings) == before && skipped == 0 {
			add(fmt.Sprintf("%s — %s", e.Label, trim(e.Reason, 110)))
		}
	}
	// Las huérfanas con nivel error: líneas que NINGUNA etapa reclamó y que hasta acá no aparecían ni en
	// una etapa ni en el resumen — un error invisible en la herramienta que existe para encontrarlos.
	// Medido en el censo: ≥15 líneas de error así en 25 trazas.
	for _, ev := range t.Orphans {
		if ev.Level == "error" {
			add(fmt.Sprintf("sin etapa › %s — el mapa no ubica esta línea (está en «sin ubicar»)", trim(ev.Msg, 96)))
		}
	}
	if skipped > 0 {
		t.Findings = append(t.Findings, fmt.Sprintf("… y %d más, en el árbol", skipped))
	}
}

// pesosText formatea el monto con separador de miles. 6395900 se lee mal; 6.395.900 se lee de un golpe, y el
// monto es de las pocas cosas que soporte compara contra lo que dice el cliente.
func pesosText(v float64) string {
	s := fmt.Sprintf("%.0f", v)
	var out []byte
	for i, c := range []byte(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, c)
	}
	return "$" + string(out)
}

func green(s string) string { return paint("32", s) }
func red(s string) string   { return paint("31", s) }

// ─── traer los logs de ESTA solicitud ───────────────────────────────────────────────────────────────

// Line es una línea de log ya parseada.
type Line struct {
	ts    int64
	level string
	msg   string
	ctx   map[string]any
	// span: el `span_id` que Loki trae COMO ETIQUETA. Se guardaba nada de las etiquetas salvo `level`, y ese
	// descarte es la causa del hueco de cobertura: un span es una unidad de trabajo REAL (una acción de
	// controlador, un método de servicio), así que todas las líneas de un mismo span pertenecen al mismo
	// momento del flujo. Con el span, ubicar una línea no depende de reconocer su prosa.
	span  string
	trace string
	// inheritedOne: esta línea NO matcheó ningún patrón — la ubicó el span. Se marca porque es evidencia más
	// débil que una línea reclamada por un patrón declarado, y mezclarlas haría que el mapa parezca cubrir
	// más de lo que cubre. La vista la muestra bajo «eventos sin nombre de negocio» de su etapa.
	inheritedOne bool
}

// fetchLines hace el join de dos fases, pero ANCLADO POR LA BD — que es la mejora sobre buscar solo por
// el número de solicitud:
//
//	fase 1  anclas: se buscan las líneas que traigan el uReq **o el user_id** (que solo la BD conoce),
//	        acotadas a la ventana de la solicitud. El user_id aparece en más líneas (50 vs 36 en la
//	        medición) pero es ambiguo por sí solo; la ventana de la BD es lo que lo vuelve seguro.
//	fase 2  expansión: cada `trace_id` descubierto se trae completo, que es una búsqueda indexada.
func fetchLines(cl *logs.Client, s *LoanRequest, envFilter string) ([]Line, []string) {
	since, until := s.window()
	var notes []string

	// ── EL FILTRO DE AMBIENTE SE VERIFICA ANTES DE USARSE ── (la regla, en `environmentSelector`)
	var environments []string
	if envFilter != "" {
		environments = labelValues(cl, "environment", since, until)
	}
	sel, selNote := environmentSelector(envFilter, environments)
	if selNote != "" {
		notes = append(notes, selNote)
	}

	// ── EL ANCLA FILTRA POR CAMPO, NO POR SUBSTRING ──
	//
	// Antes era `|= "88255"` más una verificación acá de que algún campo del contexto valiera eso. Misma
	// precisión, pero el filtrado ocurría DESPUÉS de traer las líneas, y eso tiene dos costos: se transfiere
	// ruido (medido: `|= "88255"` trae 66 líneas y sólo 45 son del usuario — el resto lo lleva en una clave de
	// caché, un monto o el texto del mensaje), y ese ruido consume el `limit` de 5000. Para un cliente que
	// aparece en muchas líneas, las anclas de verdad se pueden quedar afuera del tope sin que nada avise.
	//
	// `| json | context_user_id="X"` lo resuelve del lado del servidor. Y aplana los anidados: un mismo filtro
	// alcanza `user_id` y `user.id` (medido: 33 + 12 = 45).
	//
	// ⚠ SE VERIFICÓ QUE `| json` NO PIERDA LÍNEAS antes de cablearlo, porque descarta en silencio lo que no
	// puede parsear —sería perder evidencia, justo lo contrario de lo que se busca—. Medido sobre un trace
	// entero: 24 líneas sin `| json` y 24 con, y `__error__="JSONParserErr"` devuelve cero. Si algún día el
	// backend loguea texto plano, esta consulta lo va a callar: el chequeo hay que repetirlo.
	traces := map[string]bool{}
	tracesLabel := map[string]bool{}
	servicesLabel := map[string]bool{}
	anchors := map[string]int{}
	var rawLines []Line
	// Los MS Go llevan el id como ETIQUETA, no en el cuerpo: `| json` no los alcanza (el cuerpo es texto
	// plano y el parser los descarta), así que llevan su propia consulta con filtro de etiqueta. Medido:
	// `preapprovals-service` ancla 33 líneas en 4 h por `user_request_id`, todas invisibles antes. Y como su
	// trace_id es PROPIO (no se propaga desde legacy), la expansión posterior es la que trae su request
	// completo — autenticación, llamada al lender, veredicto.
	for _, anchor := range []struct{ value, fields, filter string }{
		{fmt.Sprint(s.ID), "user_request_id (etiqueta MS)", `user_request_id="%s"`},
		// ⚠ LAS DOS GRAFÍAS, y no es prolijidad: la integración BNPL de Bancolombia loguea
		// `context_userRequestId` en camelCase mientras el resto del backend usa snake_case. Cablear sólo
		// snake_case costó 5 de las 7 líneas ancladas de la uReq 520374 (Alkosto) y 3 de sus 5 traces — la
		// traza pasó de 12 líneas a 6 sin que nada avisara. Lo atrapó comparar antes/contra-después; si se
		// agrega una integración nueva, este es el chequeo que hay que repetir.
		// `context_request_id` es el TERCER nombre, y el más delicado: es el id de correlación del
		// microservicio de PDFs (`PdfMapperClient`: `$request->requestId ?? Str::uuid()`), al que le pasan el
		// uReq. Su valor coincide con nuestra solicitud, pero el campo no significa «user_request» — si otro
		// llamador le pasa un id numérico distinto, podría anclar de más. Se incluye porque es la ÚNICA
		// evidencia del tramo de generación de documentos (4 líneas medidas en la uReq 520835) y porque el
		// chequeo por valor de contexto sigue puesto detrás.
		{fmt.Sprint(s.ID), "user_request_id",
			`context_user_request_id="%s" or context_userRequestId="%s" or context_request_id="%s"`},
		{fmt.Sprint(s.UserID), "user_id",
			`context_user_id="%s" or context_userId="%s" or context_user_by_cell_phone_id="%s"`},
	} {
		if anchor.value == "" || anchor.value == "0" {
			continue
		}
		filter := strings.ReplaceAll(anchor.filter, "%s", anchor.value)
		// El chequeo por contexto se mantiene aunque el filtro ya sea exacto: es la red que atrapa un cambio
		// de nombre de campo del lado del backend. Si el filtro dejara de aplicar, esto lo cortaría igual.
		//
		// ⚠ La ancla de ETIQUETA va SIN `| json`: el cuerpo de un MS Go es texto plano, y `| json` marca esas
		// líneas con __error__ y el filtro posterior las tira — o sea que el pipeline que encuentra a Monolog
		// es exactamente el que hace invisible al microservicio. Se distinguen porque el filtro de etiqueta
		// no menciona campos `context_*`.
		//
		// ⚠ Y el ancla de ETIQUETA tampoco usa el selector del monolito: los MS Go no llevan la etiqueta
		// `environment` (la suya es `deployment_environment`) ni el `service_name` del PHP, así que
		// cualquiera de los dos filtros los dejaba afuera sin avisar. No hace falta separarlos por
		// ambiente: se anclan por el `user_request_id` EXACTO, y ese id es único en la BD que dev, qa y
		// staging comparten.
		isLabel := !strings.Contains(anchor.filter, "context_")
		q := fmt.Sprintf(`%s | json | %s`, sel, filter)
		if isLabel {
			q = fmt.Sprintf(`{service_name=~".+"} | %s`, filter)
		}
		ls, tr, err := linesAndTraces(cl, q, since, until, anchor.value)
		if err != nil {
			notes = append(notes, fmt.Sprintf("la búsqueda por %s falló: %v", anchor.fields, err))
			continue
		}
		rawLines = append(rawLines, ls...)
		anchors[anchor.fields] = len(ls)
		for t := range tr {
			if isLabel {
				tracesLabel[t] = true // trace de MS: NO es indexado, la expansión normal no lo ve
			} else {
				traces[t] = true
			}
		}
		if isLabel {
			for _, l := range ls {
				if v := pick(l.ctx, []string{"service_name"}); v != "" {
					servicesLabel[v] = true
				}
			}
		}
	}

	if len(traces) == 0 {
		if len(rawLines) > 0 {
			notes = append(notes, fmt.Sprintf("%d líneas ancladas pero SIN trace_id: no se pudo expandir a la petición completa (falta Tempo/OTel en ese backend)", len(rawLines)))
			return rawLines, notes
		}
		notes = append(notes, "ninguna línea nombra esta solicitud ni su usuario en la ventana")
		return nil, notes
	}

	ids := make([]string, 0, len(traces))
	for t := range traces {
		ids = append(ids, t)
	}
	sort.Strings(ids)
	all, _, err := linesAndTraces(cl, fmt.Sprintf(`{trace_id=~"%s"}`, strings.Join(ids, "|")), since, until, "")
	if err != nil {
		notes = append(notes, fmt.Sprintf("la expansión por trace_id falló: %v", err))
		return rawLines, notes
	}

	// ── LA EXPANSIÓN NO ALCANZA A LOS MICROSERVICIOS, y devolver solo la expansión los BORRABA ──
	//
	// `{trace_id=~"…"}` exige que `trace_id` sea etiqueta INDEXADA. En los monolitos lo es (LokiHandler la
	// promueve — de ahí sus 959 streams); en los MS Go via OTel es metadata estructurada, y el selector
	// devuelve 0 — medido con un trace de `preapprovals-service` que existía y el selector no encontraba.
	// Como esta función devolvía SOLO `todas`, las líneas del MS que el ancla sí había encontrado se
	// perdían en el camino: anclar 6 y devolver 0.
	//
	// Dos arreglos, los dos necesarios:
	//   1. la UNIÓN crudas ∪ expansión (dedupe por instante+span+mensaje): lo anclado nunca se pierde;
	//   2. una expansión PROPIA para esos traces, con filtro de metadata (`| trace_id=~"…"`) acotada a los
	//      service_name vistos en las anclas — trae el request completo del MS (autenticación → llamada al
	//      lender → veredicto), que el ancla sola no ve porque esas líneas no llevan el user_request_id.
	if len(tracesLabel) > 0 {
		var tIDs, svcs []string
		for id := range tracesLabel {
			tIDs = append(tIDs, id)
		}
		for s2 := range servicesLabel {
			svcs = append(svcs, s2)
		}
		sort.Strings(tIDs)
		sort.Strings(svcs)
		ms, _, errMS := linesAndTraces(cl, fmt.Sprintf(`{service_name=~"%s"} | trace_id=~"%s"`,
			strings.Join(svcs, "|"), strings.Join(tIDs, "|")), since, until, "")
		if errMS != nil {
			notes = append(notes, fmt.Sprintf("la expansión del microservicio falló: %v", errMS))
		} else {
			all = append(all, ms...)
		}
	}
	// La unión. El dedupe es por (instante, span, mensaje): dos fuentes pueden traer la misma línea y
	// duplicarla inflaría los conteos de los hitos.
	seenL := map[string]bool{}
	joined := make([]Line, 0, len(all)+len(rawLines))
	for _, l := range append(all, rawLines...) {
		k := fmt.Sprintf("%d|%s|%s", l.ts, l.span, l.msg)
		if seenL[k] {
			continue
		}
		seenL[k] = true
		joined = append(joined, l)
	}
	all = joined
	// ── DESCARTAR LO QUE ES DE OTRA SOLICITUD ──
	//
	// La expansión trae la petición completa, y ahí entra la única contaminación real que tiene este método:
	// se ancla también por `user_id`, así que un cliente con VARIAS solicitudes arrastra los traces de las
	// otras. Medido en prod: la uReq 520530 traía 5 líneas de la 520535 y la 519372, 3 de la 519397 — las dos
	// de clientes con 4 solicitudes. En clientes de una sola solicitud, cero.
	//
	// Y no hay que suponer nada para arreglarlo: esas líneas dicen a qué solicitud pertenecen EN SU PROPIO
	// CONTEXTO. Una línea que trae `user_request_id` de otra solicitud no es dudosa, es ajena. Se descarta.
	//
	// ⚠ Lo que NO se puede descartar son las líneas sin `user_request_id` de un trace mezclado: no dicen de
	// quién son. Se quedan —tirarlas costaría la mayoría de la evidencia— y el trace mezclado se AVISA, que
	// es la diferencia entre una duda declarada y una suposición silenciosa.
	mine := asTextValue(s.ID)
	mixedTraces := map[string]bool{}
	foreign := map[string]int{}
	clean := make([]Line, 0, len(all))
	for _, l := range all {
		ur := pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"})
		if ur != "" && ur != mine {
			foreign[ur]++
			mixedTraces[l.trace] = true
			continue
		}
		clean = append(clean, l)
	}
	if len(foreign) > 0 {
		var who []string
		total := 0
		for k, n := range foreign {
			who = append(who, fmt.Sprintf("%s×%d", k, n))
			total += n
		}
		sort.Strings(who)
		notes = append(notes, fmt.Sprintf("%d líneas DESCARTADAS por ser de otra solicitud del mismo cliente "+
			"(%s): las trae la expansión por trace y lo dicen en su propio contexto", total, strings.Join(who, " ")))
		// Las líneas SIN uReq de esos mismos traces no se pueden atribuir con certeza. Se cuentan y se avisa.
		doubtful := 0
		for _, l := range clean {
			if mixedTraces[l.trace] && pick(l.ctx, []string{"user_request_id", "userRequestId", "user_request"}) == "" {
				doubtful++
			}
		}
		if doubtful > 0 {
			notes = append(notes, fmt.Sprintf("%d líneas vienen de un trace que toca DOS solicitudes y no "+
				"dicen de cuál son: se muestran, pero no se pueden afirmar de esta", doubtful))
		}
	}

	// El desglose por ancla (`user_id→110 user_request_id→37 …`) era jerga de diagnóstico en la vista de
	// auditoría; vive completo en `-anclas`, que es su modo. Acá queda lo que un lector necesita creer:
	// cuántas líneas y de cuántas peticiones.
	notes = append(notes, fmt.Sprintf("%d líneas de %d traces · el desglose por ancla: -anclas", len(clean), len(ids)))
	notes = append(notes, splitByBackend(clean, cl.Config.Service)...)
	return clean, notes
}

// splitByBackend dice qué backend PHP sirvió las líneas de la traza, contra el que el target declara
// como suyo (`LOKI_SERVICE`). No filtra: AVISA.
//
// ⚠ Filtrar era la primera idea y habría mentido. Dev, qa y staging comparten BD, así que los ids no se
// pisan y anclar por ellos no trae líneas de otra solicitud; pero una misma solicitud SÍ pasa por más de
// un backend. Medido el 2026-09-23: la uReq 502690, creada en qa, tiene 110 líneas en `CreditopDev` (qa)
// y 18 `QUOTA_CHECK_START` en `legacy-backend` (dev) — el chequeo de cupo lo corrió el código de OTRA
// rama. Con el filtro esas 18 desaparecían y la traza decía menos de lo que pasó; sin el aviso, se leían
// como si las hubiera escrito qa.
//
// Sólo cuentan las líneas con etiqueta `environment`, que es la que pone el LokiHandler del monolito
// (medido el 2026-09-23 en `creditopdev`: los MS Go traen `deployment_environment` en su lugar). No se
// usa `app`, que también es del PHP, porque `boilerplateOTel` la saca del contexto. Y los MS quedan
// afuera a propósito: su única etiqueta de ambiente vale `development` en dev, qa y staging por igual,
// así que una línea suya no dice de qué rama es.
func splitByBackend(lines []Line, service string) []string {
	if service == "" {
		return nil
	}
	by := map[string]int{}
	for _, l := range lines {
		if pick(l.ctx, []string{"environment"}) == "" {
			continue
		}
		if sv := pick(l.ctx, []string{"service_name"}); sv != "" {
			by[sv]++
		}
	}
	var others []string
	for sv, n := range by {
		if sv != service {
			others = append(others, fmt.Sprintf("%s %d", sv, n))
		}
	}
	if len(others) == 0 {
		return nil
	}
	sort.Strings(others)
	if by[service] == 0 {
		return []string{fmt.Sprintf("NINGUNA línea del monolito es de %q, el backend de este target: todas "+
			"son de %s. La solicitud la atendió OTRO ambiente (dev, qa y staging comparten BD y se abre igual "+
			"con cualquiera de los tres)", service, strings.Join(others, " · "))}
	}
	return []string{fmt.Sprintf("la solicitud pasó por MÁS DE UN backend: %s %d (el de este target) · %s. "+
		"Las de otro backend las corrió el código de OTRA rama", service, by[service], strings.Join(others, " · "))}
}

// boilerplateOTel: las etiquetas de infraestructura que el SDK de OTel pega a toda línea y que no dicen
// nada de la solicitud. Se saltan al fusionar etiquetas al ctx para que éste siga siendo contexto de
// NEGOCIO y no un inventario de la máquina.
var boilerplateOTel = map[string]bool{
	"os_description": true, "os_type": true, "process_runtime_description": true,
	"telemetry_sdk_language": true, "telemetry_sdk_name": true, "telemetry_sdk_version": true,
	"host_name": true, "observed_timestamp": true, "loki_attribute_labels": true, "flags": true,
	"severity_number": true, "severity_text": true, "scope_version": true, "service_version": true,
	"detected_level": true, "level": true, "channel": true, "app": true, "cluster_name": true,
}

// linesAndTraces corre una consulta y devuelve las líneas + los trace_id vistos. `anchorValue` no vacío
// exige que el valor aparezca como VALOR de un campo del context: sin eso, un documento o un monto que
// contenga los mismos dígitos anclaría la solicitud de otra persona.
func linesAndTraces(cl *logs.Client, logql string, since, until time.Time, anchorValue string) ([]Line, map[string]bool, error) {
	streams, err := cl.Range(logql, since, until, 5000, "forward")
	if err != nil {
		return nil, nil, err
	}
	traces := map[string]bool{}
	var out []Line
	for _, st := range streams {
		for _, v := range st.Values {
			var obj struct {
				Message string          `json:"message"`
				Context json.RawMessage `json:"context"`
			}
			l := Line{level: st.Labels["level"], msg: v[1], ctx: map[string]any{},
				span: st.Labels["span_id"], trace: st.Labels["trace_id"]}
			if json.Unmarshal([]byte(v[1]), &obj) == nil {
				if obj.Message != "" {
					l.msg = obj.Message
				}
				var m map[string]any
				if json.Unmarshal(obj.Context, &m) == nil {
					l.ctx = m
				}
			}
			// LAS ETIQUETAS DEL STREAM TAMBIÉN SON CONTEXTO. Los microservicios Go (OTel) no llevan el
			// contexto en el cuerpo como Monolog: lo llevan como etiquetas — `preapprovals-service` pone ahí
			// `user_request_id`, `lender_name`, `preapproval_id`, `status`. Descartarlas hacía tres cosas a
			// la vez: el chequeo del ancla no encontraba el valor y tiraba la línea, `pick()` no veía nada, y
			// ningún matcher con `campo` podía mirar `service_name`. El cuerpo GANA en caso de choque: es lo
			// que el que logueó quiso decir. La morralla de OTel se salta para que el ctx siga siendo legible.
			for k, v2 := range st.Labels {
				if _, already := l.ctx[k]; already || boilerplateOTel[k] {
					continue
				}
				l.ctx[k] = v2
			}
			var ns int64
			fmt.Sscanf(v[0], "%d", &ns)
			l.ts = ns / 1e6
			if anchorValue != "" {
				hit := false
				for _, vv := range l.ctx {
					if asTextValue(vv) == anchorValue {
						hit = true
						break
					}
				}
				if !hit {
					continue
				}
			}
			if t := st.Labels["trace_id"]; t != "" {
				traces[t] = true
			}
			out = append(out, l)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ts < out[j].ts })
	return out, traces, nil
}

// asTextValue formatea un valor del context para comparar. Existe por un bug que costó encontrar: el JSON
// del log deserializa los números a `float64`, y `fmt.Sprint(float64(1827791))` devuelve "1.827791e+06"
// (Go usa %g y salta a notación científica). O sea que anclar por un id de 6 dígitos funcionaba y por uno
// de 7 fallaba EN SILENCIO — el bug dependía de la cantidad de dígitos.
func asTextValue(v any) string {
	if f, ok := v.(float64); ok && f == float64(int64(f)) {
		return strconv.FormatInt(int64(f), 10)
	}
	return fmt.Sprint(v)
}

// pick saca el primer valor no vacío de una lista de claves del context.
func pick(ctx map[string]any, keys []string) string {
	for _, k := range keys {
		if v, ok := ctx[k]; ok && v != nil && asTextValue(v) != "" {
			return asTextValue(v)
		}
	}
	return ""
}

func gray(s string) string { return paint("90", s) }

// ─── modo traza ─────────────────────────────────────────────────────────────────────────────────────

// traceMode es la entrada del trazador cuando se pide una solicitud. Devuelve el exit code:
//
//	0  se pudo trazar
//	2  no concluyente (sin BD para este target, o la solicitud no existe)
//
// Nunca 1: como el forense del harness, esto EXPLICA — no dictamina que algo esté mal.
// BuildTrace es el ÚNICO camino que arma una traza: lo usan la consola, el HTML y el server. Tener dos
// caminos sería tener dos definiciones de «qué pasó con esta solicitud».
func BuildTrace(target string, ureq int64) (Trace, *LoanRequest, error) {
	c, _ := loadConfig(target)
	stageMap, err := Load()
	if err != nil {
		return Trace{}, nil, fmt.Errorf("el mapa del flujo no carga: %w", err)
	}
	subMap, err := LoadSub()
	if err != nil {
		return Trace{}, nil, fmt.Errorf("el árbol declarado no carga: %w", err)
	}
	source, err := openSource(c)
	if err != nil {
		return Trace{}, nil, err
	}
	defer source.Close()

	s, err := GetLoanRequest(source, ureq)
	if err != nil {
		return Trace{}, nil, err
	}

	var lines []Line
	var notes []string
	if no := c.loki.Missing(); no != "" {
		notes = append(notes, "sin logs: "+no)
	} else {
		cl := logs.New(c.loki, 60*time.Second)
		lines, notes = fetchLines(cl, s, c.loki.Env)
	}

	bureaus := GetBureaus(source)
	s.Corbeta = GetCorbetaAllieds(source)[s.AlliedID]

	// La evaluación de categoría, entidad por entidad. Va acotada a la ventana de ESTA solicitud porque la
	// tabla se indexa por `user_id`: un cliente con dos intentos el mismo día trae las filas de los dos.
	// La ventana es generosa hacia atrás (la categoría se evalúa al armar el listado, que puede empezar
	// antes de que la fila de `user_requests` quede escrita) y corta hacia adelante.
	if !s.Created.IsZero() {
		// La referencia es la corrida del perfilamiento, NUNCA la creación de la solicitud: la
		// categorización pasa minutos después de crearse la fila, así que compararla contra `created_at`
		// tira siempre «fuera de ventana» y la advertencia se vuelve ruido que se aprende a ignorar.
		var run time.Time
		if s.Profiling != nil {
			run = s.Profiling.CreatedAt
		}
		s.Categories = GetCategories(source, s.UserID, s.Created.Add(-15*time.Minute), s.Created.Add(6*time.Hour), run)
	}
	// El pagaré digital. Ésta SÍ se ancla por `user_request_id`: no hace falta ventana ni heurística.
	s.Deceval = GetDeceval(source, s.ID)
	var lenderIDs []int64
	for _, l := range lines {
		if v := pick(l.ctx, []string{"lender_id"}); v != "" {
			var id int64
			if fmt.Sscanf(v, "%d", &id); id > 0 {
				lenderIDs = append(lenderIDs, id)
			}
		}
	}
	if s.LenderID > 0 {
		lenderIDs = append(lenderIDs, s.LenderID)
	}
	// Y los del SNAPSHOT del listado. Faltaban: los ids se juntaban sólo de los logs, pero las entidades
	// mostradas salen de `profiling_reviews.displayed_lenders`, que es BD. Con pocas líneas de log —el caso
	// normal cuando el flujo salió bien— el árbol quedaba con la elegida clasificada y el resto en «sin
	// clasificar», incluidos lenders tan conocidos como Addi o Sistecrédito (uReq 520830 de prod: 1 de 5).
	if s.Profiling != nil {
		for _, l := range s.Profiling.Shown {
			if l.ID > 0 {
				lenderIDs = append(lenderIDs, l.ID)
			}
		}
	}
	lenders := GetLenders(source, lenderIDs)

	t := assemble(stageMap, subMap, s, lines, target, bureaus, lenders)
	t.Warnings = append(t.Warnings, notes...)
	return t, s, nil
}

// Resolver traduce cédula/teléfono/uReq a intentos, sobre cualquier fuente.
func Resolver(r Runner, value string) ([]Match, []string, error) {
	return resolveSource(r, value)
}

func traceMode(c config, target string, ureq int64, tel string, jsonOut bool, htmlOut string, mdOut bool, block string) int {
	// Render-only: el armado vive en BuildTrace, que es el MISMO camino del server y del HTML. Este modo
	// duplicaba ese cuerpo entero — la clase de deriva que este repo señala en trace.ts/veredicto().
	t, s, err := BuildTrace(target, ureq)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s no puedo armar la traza para target «%s»: %v\n\n", paint("31", "✘"), target, err)
		return 2
	}

	// LA TERCERA FUENTE. Va acá y no en `ensamblar` porque es el único punto con la config —y por lo
	// tanto con las credenciales—; `ensamblar` es el camino compartido con el server y el HTML, y
	// meterle una llamada de red lo volvería no-determinista para los dos.
	// Si no hay credenciales no se agrega nada y no se anuncia: un bloque vacío se leería como «el
	// cliente no vio nada», que es distinto de «no miramos».
	if screenName, notice := requestScreens(c, ureq, tel); len(screenName) > 0 {
		t.Screens, t.PHNotice = screenName, notice
		t.Sources = append(t.Sources, "posthog")
	}

	if jsonOut {
		b, _ := json.MarshalIndent(t, "", "  ")
		fmt.Println(string(b))
		return 0
	}
	cmd := cmdMake("trazador-ureq", target, "UREQ", fmt.Sprint(ureq), "TEL", tel)
	if mdOut {
		fmt.Print(annotationMD(traceSummary(t, s), cmd, traceEvidence(t)...))
		emitBlock(block, blockMD(traceSummary(t, s), cmd, traceEvidence(t)...))
		return 0
	}
	printTrace(t, s)
	if when, other, there := traceNeighbor(target, ureq); there {
		neighbor(when, other)
	}
	pie(cmd)
	if htmlOut != "" {
		if err := writeHTML(t, s, htmlOut); err != nil {
			fmt.Fprintf(os.Stderr, "  no pude escribir %s: %v\n", htmlOut, err)
		} else {
			fmt.Printf("\n  %s\n", gray("vista de checks: "+htmlOut))
		}
	}
	emitBlock(block, blockMD(traceSummary(t, s), cmd, traceEvidence(t)...))
	return 0
}

// searchMode lista los intentos que coinciden con lo que se escribió. Es la puerta natural del soporte:
// quien llama dice su cédula o su celular, no un `user_request_id`.
func searchMode(c config, target, value string, asJSON, mdOut bool, block string) int {
	source, err := openSource(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s sin BD para «%s»: %v\n\n", paint("31", "✘"), target, err)
		return 2
	}
	defer source.Close()
	cs, as, err := resolveSource(source, value)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n  %s %v\n\n", paint("31", "✘"), err)
		return 2
	}
	if asJSON {
		return searchJSON(value, cs, as, target)
	}
	cmd := cmdMake("trazador-buscar", target, "Q", value)
	// ⚠ El valor buscado NO entra en el resumen: es una cédula o un celular de producción, y lo que se pega
	// en una tarea queda en git. El comando sí lo lleva —hace falta para repetirlo— pero la afirmación se
	// escribe sobre las solicitudes, que es de lo que habla la medición. Vale igual para el bloque.
	summary := fmt.Sprintf("la persona detrás de esta búsqueda en `%s`: %s.", target,
		strings.TrimRight(summarizeHistory(cs), "."))
	if len(cs) == 0 {
		summary = fmt.Sprintf("sin coincidencias en `%s`.", target)
	}
	evidence := "Coincidió como " + strings.Join(as, " y ") + "."
	if mdOut {
		fmt.Print(annotationMD(summary, cmd, evidence))
	} else {
		printMatches(value, cs, as, target)
		pie(cmd)
	}
	emitBlock(block, blockMD(summary, cmd, evidence))
	if len(cs) == 0 {
		return 2
	}
	return 0
}

// searchJSON es la MISMA búsqueda, renderizada para quien no mira una pantalla.
//
// Por qué existe: `-json` sólo servía con `-ureq`, así que la pregunta que más se hace por consola
// —«¿qué le pasó a esta persona?», por cédula— sólo tenía la vista humana: columnas alineadas, colores
// y una tabla pensada para el ojo. Un modelo puede leerla, pero la parsea, y parsear una tabla de
// ancho fijo es exactamente donde se inventan datos.
//
// ⚠ NO incluye documento ni teléfono, y es deliberado: el JSON se pega en un informe o se encadena a
// otro comando, y ahí un dato personal viaja a lugares que nadie miró. Para identificar una fila
// alcanzan `ureq` y `user_id`; quien de verdad necesite el documento tiene la vista humana, que se
// mira una vez y no se guarda.
func searchJSON(value string, cs []Match, as []string, target string) int {
	type row struct {
		UReq     int64  `json:"ureq"`
		UserID   int64  `json:"user_id"`
		Status   int    `json:"estado"`
		StatusN  string `json:"estado_nombre"`
		Lender   string `json:"lender,omitempty"`
		Merchant string `json:"comercio,omitempty"`
		Created  string `json:"creada"`
		Direct   bool   `json:"directa"`
	}
	out := struct {
		Searched   string   `json:"busque"`
		Target     string   `json:"target"`
		ResolvedAs []string `json:"resuelto_como"`
		Count      int      `json:"cuantas"`
		Note       string   `json:"nota"`
		Rows       []row    `json:"solicitudes"`
	}{Searched: value, Target: target, ResolvedAs: as, Count: len(cs),
		Note: "`directa:true` es lo que matcheó lo que buscaste; el resto es el historial de la " +
			"misma persona. Sin documento ni teléfono a propósito: identificá por ureq/user_id."}
	for _, x := range cs {
		out.Rows = append(out.Rows, row{x.UReq, x.UserID, x.Status, x.StatusN, x.Lender,
			x.Merchant, x.Created.Format(time.RFC3339), x.Direct})
	}
	e := json.NewEncoder(os.Stdout)
	e.SetIndent("", "  ")
	_ = e.Encode(out)
	if len(cs) == 0 {
		return 2
	}
	return 0
}

// ─── buscar por teléfono, cédula o número de solicitud ──────────────────────────────────────────────

// Match es un intento encontrado a partir de lo que se buscó.
type Match struct {
	UReq     int64
	UserID   int64
	Status   int
	StatusN  string
	Lender   string
	Merchant string
	Created  time.Time
	Document string
	Phone    string
	// Direct: lo trajo la búsqueda literal, no la expansión a la persona. La distinción no es cosmética
	// —es la diferencia entre «esto es lo que pediste» y «esto es el resto de su vida»—, y sin marcarla la
	// lista de un ureq pasa de 1 fila a 40 sin decir cuál era la que se buscó.
	Direct bool
}

// resolver traduce lo que el usuario escribió a una lista de solicitudes.
//
// NO ADIVINA EL TIPO DE DATO: consulta los tres (solicitud, teléfono, documento) y reporta cuál coincidió.
// Adivinar por la forma es tentador —10 dígitos que empiezan con 3 parece un celular— pero una cédula
// también puede tener 10 dígitos y empezar con 3, y un `user_request_id` de 7 dígitos se parece a todo.
// Un buscador que elige mal en silencio te muestra la solicitud de otra persona con total seguridad.
//
// Teléfono y documento son únicos en `users` (medido: 1.00 usuarios por cada uno, máximo 1), así que
// resuelven a UN cliente — pero ese cliente puede tener varios intentos (1,69 en promedio, 228 el peor).
func resolveSource(r Runner, value string) ([]Match, []string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil, fmt.Errorf("no me pasaste nada que buscar")
	}
	// Todo lo que se busca es de dígitos, y esa restricción es lo que hace segura la interpolación en
	// Redash (ver `validarArgs`). Un valor con letras se rechaza acá, con un mensaje que lo explica.
	if !digitsOnly.MatchString(value) {
		return nil, nil, fmt.Errorf("«%s» no es un número: el trazador busca por cédula, teléfono o "+
			"número de solicitud, y los tres son de dígitos", trim(value, 30))
	}

	var as []string
	seenOnes := map[int64]bool{}
	var out []Match

	fetch := func(where, label, arg string, direct bool) error {
		fs, err := r.Rows(sqlSearch+where+sqlSearchOrder, arg)
		if err != nil {
			return err
		}
		fresh := 0
		for _, f := range fs {
			id := integer(f["id"])
			if seenOnes[id] {
				continue
			}
			seenOnes[id] = true
			fresh++
			out = append(out, Match{
				UReq: id, UserID: integer(f["uid"]), Status: int(integer(f["st"])), StatusN: asText(f["estado"]),
				Lender: asText(f["lender"]), Merchant: asText(f["comercio"]), Created: date(f["created_at"], r.Zone()),
				Document: asText(f["documento"]), Phone: asText(f["telefono"]), Direct: direct,
			})
		}
		if fresh > 0 && label != "" {
			as = append(as, fmt.Sprintf("%s → %d", label, fresh))
		}
		return nil
	}

	// Se prueban los TRES y se reporta cuál coincidió. Adivinar por la forma es tentador —10 dígitos que
	// empiezan con 3 parece un celular— pero una cédula también puede serlo, y un id de solicitud de 7
	// dígitos se parece a todo. Un buscador que elige mal en silencio muestra la solicitud de otra persona.
	for _, p := range []struct{ where, label string }{
		{"ur.id = ?", "número de solicitud"},
		{"u.cell_phone = ?", "teléfono"},
		{"u.document_number = ?", "documento"},
	} {
		if err := fetch(p.where, p.label, value, true); err != nil {
			return nil, nil, err
		}
	}

	// SE EXPANDE A LA PERSONA. Buscar por número de solicitud devolvía UNA fila, y ahí se perdía lo que el
	// soporte más necesita: si esta persona ya intentó antes y qué le pasó. El caso real es el de todos los
	// días — llega un ureq por Jira, se abre, y para saber si es un reintento hay que buscar de nuevo por
	// cédula. La cédula y el teléfono son únicos en `users`, así que esto resuelve a un puñado de user_id
	// (normalmente uno) y cada uno cuesta una consulta más.
	//
	// Con `user_id`, no con el documento: el documento se puede corregir en el camino (ver F-97, el caso de
	// la cédula transpuesta) y buscar por el valor final se comería los intentos hechos con el equivocado.
	people := map[int64]bool{}
	for _, c := range out {
		if c.UserID > 0 {
			people[c.UserID] = true
		}
	}
	ids := make([]int64, 0, len(people))
	for id := range people {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] }) // determinista: el orden de un map no lo es
	//
	// La expansión NO entra en `como`: `como` responde «cómo coincidió lo que escribiste», y su aviso de
	// ambigüedad («⚠ coincidió como documento y como número de solicitud — mirá bien cuál buscabas») se
	// dispara cuando hay más de una forma. Contar acá la expansión haría saltar ese aviso en casi toda
	// búsqueda, y un aviso que suena siempre deja de avisar. Lo expandido se cuenta en la Historia.
	for _, uid := range ids {
		if err := fetch("ur.user_id = ?", "", strconv.FormatInt(uid, 10), false); err != nil {
			return nil, nil, err
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out, as, nil
}

// History es la vida de una persona en CreditOp, contada por sus solicitudes. El conteo se hace ACÁ y no
// en la vista por la razón de siempre: «roto» es una definición de negocio (`malos`/`sellados`), y si la
// Vue tallara sus propios totales habría dos respuestas para «¿cuántas veces le fue mal a esta persona?».
type History struct {
	Total      int    `json:"total"`
	Approved   int    `json:"aprobadas"`
	Broken     int    `json:"rotas"`
	Abandoned  int    `json:"abandonadas"`
	InProgress int    `json:"enCurso"`
	Since      string `json:"desde"`
	Until      string `json:"hasta"`
	People     int    `json:"personas"`  // >1 = el valor coincidió con clientes distintos: mirá bien cuál
	SameDay    int    `json:"mismoDia"`  // el día con más intentos: 5 en un día es un reintento, no un cliente indeciso
	Truncated  bool   `json:"truncada"`  // se llegó al LIMIT: hay más solicitudes de las que se ven
	Merchants  int    `json:"comercios"` // intentar en varios comercios distingue «no le alcanza» de «este comercio falla»
	// Expanded: las que NO pidió la búsqueda literal y aparecieron por ser del mismo cliente. Se cuenta
	// acá y no en `como` para no disparar el aviso de ambigüedad en cada búsqueda (ver resolveSource).
	Expanded int `json:"expandidas"`
}

// plural evita el «1 solicitud(es)», que en una herramienta de soporte se lee como descuido.
// mostRepeated dice qué criterio bloqueó en MÁS tiers. Un lender con doce tiers repite el mismo motivo
// doce veces: sin esto, el renglón que soporte pega en el ticket sería una lista y no un diagnóstico.
func mostRepeated(failures map[string][]string) string {
	count := map[string]int{}
	for _, criteria := range failures {
		for _, c := range criteria {
			count[c]++
		}
	}
	best, n := "", 0
	for c, k := range count {
		if k > n || (k == n && c < best) {
			best, n = c, k
		}
	}
	if n > 1 {
		return fmt.Sprintf("%s (en %d de %d tiers)", best, n, len(failures))
	}
	return best
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// summarizeHistory arma el resumen y su versión en una línea para la consola.
func buildHistory(cs []Match) History {
	h := History{Total: len(cs)}
	if len(cs) == 0 {
		return h
	}
	byDay := map[string]int{}
	people, merchants := map[int64]bool{}, map[string]bool{}
	for _, c := range cs {
		switch outcomeOf(c.Status) {
		case "aprobado":
			h.Approved++
		case "roto":
			h.Broken++
		case "abandonado":
			h.Abandoned++
		default:
			h.InProgress++
		}
		d := c.Created.Local().Format("2006-01-02")
		byDay[d]++
		if byDay[d] > h.SameDay {
			h.SameDay = byDay[d]
		}
		if c.UserID > 0 {
			people[c.UserID] = true
		}
		if c.Merchant != "" {
			merchants[c.Merchant] = true
		}
		if !c.Direct {
			h.Expanded++
		}
	}
	h.People, h.Merchants = len(people), len(merchants)
	// `cs` viene ordenado de más nueva a más vieja (lo ordena resolveSource).
	h.Until = cs[0].Created.Local().Format("2006-01-02")
	h.Since = cs[len(cs)-1].Created.Local().Format("2006-01-02")
	// El LIMIT del buscador. Si se alcanzó exacto, hay que decirlo: un «12 solicitudes» que en realidad son
	// 228 cambia el diagnóstico de «reintentó» a «algo la está reintentando sola».
	h.Truncated = len(cs) >= searchLimit
	return h
}

func summarizeHistory(cs []Match) string {
	h := buildHistory(cs)
	if h.Total == 0 {
		return ""
	}
	parts := []string{plural(h.Total, "solicitud", "solicitudes")}
	for _, p := range []struct {
		n    int
		u, m string
	}{{h.Approved, "aprobada", "aprobadas"}, {h.Broken, "rota", "rotas"},
		{h.Abandoned, "abandonada", "abandonadas"}, {h.InProgress, "en curso", "en curso"}} {
		if p.n > 0 {
			parts = append(parts, plural(p.n, p.u, p.m))
		}
	}
	if h.Since != h.Until {
		parts = append(parts, "de "+h.Since+" a "+h.Until)
	} else {
		parts = append(parts, "todas el "+h.Until)
	}
	if h.SameDay > 1 {
		parts = append(parts, fmt.Sprintf("hasta %d el mismo día", h.SameDay))
	}
	if h.Merchants > 1 {
		parts = append(parts, fmt.Sprintf("%d comercios", h.Merchants))
	}
	if h.People > 1 {
		parts = append(parts, fmt.Sprintf("⚠ %d clientes distintos", h.People))
	}
	if h.Expanded > 0 {
		parts = append(parts, fmt.Sprintf("%d por la misma persona", h.Expanded))
	}
	if h.Truncated {
		parts = append(parts, fmt.Sprintf("⚠ recortado en %d", searchLimit))
	}
	return strings.Join(parts, " · ")
}

// printMatches lista los intentos para elegir. Cuando el mismo valor coincide como DOS cosas
// distintas (por ejemplo una cédula que además es un id de solicitud válido), lo dice: es el caso en que
// un buscador que adivina te da la respuesta de otra persona.
func printMatches(value string, cs []Match, as []string, target string) {
	fmt.Println()
	fmt.Printf("  %s\n", bold(fmt.Sprintf("── «%s» en %s ──", value, target)))
	if len(as) > 1 {
		fmt.Printf("     %s\n", paint("33", "⚠ coincidió como "+strings.Join(as, " y ")+
			" — mirá bien cuál es el que buscabas"))
	} else if len(as) == 1 {
		fmt.Printf("     %s\n", gray("coincidió como "+as[0]))
	}
	if len(cs) == 0 {
		fmt.Printf("     %s\n", gray("sin coincidencias"))
		return
	}
	fmt.Printf("     %s\n\n", gray(summarizeHistory(cs)))
	for _, c := range cs {
		res := map[string]string{
			"aprobado": green("aprobado"), "roto": red(badStatuses[c.Status]),
			"abandonado": paint("33", "abandonado"), "en-curso": gray("en curso"),
		}[outcomeOf(c.Status)]
		mark := "  "
		if c.Direct {
			mark = paint("36", "◂ ") // lo que se buscó, frente a lo que trajo la expansión a la persona
		}
		fmt.Printf("   %s%-8d %s  %-11s %-24s %s\n", mark, c.UReq, c.Created.Local().Format("2006-01-02 15:04"),
			res, trim(c.Merchant, 24), gray(trim(c.Lender, 26)))
	}
	// El comando, no la bandera: `-ureq <n>` obliga a traducir a mano lo que la herramienta ya sabe —y
	// a acordarse del target, que acá no es un detalle porque dev y qa comparten base. Y con el PRIMER
	// resultado puesto, no con un `<número>` de relleno: un ejemplo que se pega y corre ahorra el paso
	// de elegir, y de paso muestra la forma exacta del comando.
	fmt.Printf("\n     %s\n", gray("para ver una: "+cmdMake("trazador-ureq", target, "UREQ", fmt.Sprint(cs[0].UReq))))
}

// ─── el árbol de caminos ────────────────────────────────────────────────────────────────────────────

// LenderInfo es lo que la BD sabe de una entidad. El `rt` es lo que decide a qué FAMILIA pertenece, y por
// eso sale de la BD y no de los logs: los logs traen `lender_id` y `lender_name`, nunca el response_type.
type LenderInfo struct {
	ID   int64
	Name string
	RT   int
}

// laneOfRT traduce el response_type a la familia. Los ids son los de `mapa/ramales.json` y de
// `harness/panel/steps.json`, a propósito.
//
// Credifamilia (lender 24) es un caso aparte y no un rt: tiene tres integraciones propias (REST de
// preaprobación, KYC V2 con Evidente/CrossCore/Jumio, y radicación SOAP), así que mezclarla con el resto
// de su rt escondería que su camino es distinto.
func laneOfRT(id int64, rt int) string {
	if id == 24 {
		return "credifamilia"
	}
	switch rt {
	case 2, 3, 4:
		return "creditopx"
	case 1:
		return "agregador"
	default:
		return "redirect"
	}
}

// listingTree agrupa las entidades evaluadas por FAMILIA.
//
// La forma sale de medir, no de suponer: una solicitud NO elige un ramal en el listado — evalúa entidades
// de todas las familias a la vez (en la uReq 464630, 12 entidades entre agregadores, CreditopX y
// Credifamilia). El ramal recién se vuelve «por dónde se fue» en `seleccion`, cuando una gana. Un árbol que
// mostrara «esta solicitud fue por agregador» en el listado estaría mintiendo.
func listingTree(flat []Sub, info map[int64]LenderInfo) []Sub {
	byLane := map[string][]Sub{}
	var laneOrder []string
	for _, s := range flat {
		var id int64
		fmt.Sscanf(s.Detail2, "%d", &id) // Detail2 lleva el lender_id
		fam := "sin clasificar"
		if l, ok := info[id]; ok {
			fam = laneOfRT(l.ID, l.RT)
			if l.Name != "" {
				s.Label = l.Name
			}
		}
		if _, already := byLane[fam]; !already {
			laneOrder = append(laneOrder, fam)
		}
		byLane[fam] = append(byLane[fam], s)
	}
	// Orden estable y con sentido de negocio: primero in-platform, después terceros.
	prio := map[string]int{"creditopx": 0, "agregador": 1, "credifamilia": 2, "redirect": 3, "sin clasificar": 9}
	sort.Slice(laneOrder, func(i, j int) bool { return prio[laneOrder[i]] < prio[laneOrder[j]] })

	var out []Sub
	for _, fam := range laneOrder {
		children := byLane[fam]
		approved, rejected := 0, 0
		for _, h := range children {
			if h.Status == "fail" {
				rejected++
			} else if h.Status == "ok" {
				approved++
			}
		}
		st := "ok"
		if approved == 0 && rejected > 0 {
			st = "fail"
		}
		det := fmt.Sprintf("%d evaluada(s)", len(children))
		if rejected > 0 {
			det += fmt.Sprintf(" · %d rechazada(s)", rejected)
		}
		out = append(out, Sub{Label: fam, Status: st, Detail: det, Source: "db", Children: children})
	}
	return out
}

// identityValidation traduce el enum `IdentityValidationType` (Modules/Identity/App/Enums) y dice —lo
// importante— si ese camino DEJA FILA en `risk_central_user_data`. Sin ese dato, la etapa biométrica no se
// puede leer: para casi la mitad de los lenders la ausencia de filas es lo normal, no una señal.
var identityValidation = map[int]struct {
	name      string
	leavesRow bool
}{
	0: {"sin configurar (Unknown)", false},
	1: {"ninguna — el lender no valida identidad", false},
	2: {"AWS OCR + Rekognition", false}, // documento + facial; rastro sólo en logs
	3: {"preguntas de seguridad", false},
	4: {"Ado (enrolamiento externo)", true},
	5: {"CrossCore (Credifamilia V2)", true},
	6: {"Evidente (Credifamilia V2)", true},
}

// firstSubsTime: la hora más temprana entre los subs CON datos. El detalle de una central viene como
// «score 488 · 16:00:27» o «sin score · 16:00:27», así que la hora son los últimos 8 caracteres — se lee
// desde ahí y no de la fila original porque `Sub` es lo único que llega hasta acá.
func firstSubsTime(subs []Sub) string {
	best := ""
	for _, s := range subs {
		if s.Status == "skip" || len(s.Detail) < 8 {
			continue
		}
		h := s.Detail[len(s.Detail)-8:]
		if !reTime.MatchString(h) {
			continue
		}
		if best == "" || h < best {
			best = h
		}
	}
	return best
}

var reTime = regexp.MustCompile(`^\d{2}:\d{2}:\d{2}$`)

// notApplicableReason contesta «¿esta etapa NO EXISTE para esta solicitud?» mirando los DOS ejes, y devuelve
// quién lo declara más el motivo. Vacío = no está declarado, y entonces la etapa se muestra: la diferencia
// entre «acá esto no ocurre nunca» y «acá no hay evidencia» es la que hace que un árbol dinámico sea útil o
// mentiroso.
func notApplicableReason(m *Map, s *LoanRequest, fam, stage string) (string, string) {
	// CANAL primero: decide en la validación del OTP, o sea antes de que exista un lender elegido.
	if s.Corbeta {
		if c := m.Channel("corbeta"); c != nil {
			for _, p := range c.NotApplicable {
				if p.ID == stage {
					return c.Label, p.Because
				}
			}
		}
	}
	if fam == "" {
		return "", "" // sin lender no hay ramal que consultar, y eso es correcto: aún no se decidió
	}
	if r := m.Lane(fam); r != nil {
		for _, p := range r.NotApplicable {
			if p.ID == stage {
				return "ramal " + fam, p.Because
			}
		}
	}
	return "", ""
}

// whyNotApplicable devuelve el motivo declarado, recortado para caber en una línea de detalle. El motivo
// completo vive en `mapa/ramales.json` y se lee ahí.
func whyNotApplicable(m *Map, fam, stage string) string {
	if r := m.Lane(fam); r != nil {
		for _, p := range r.NotApplicable {
			if p.ID == stage {
				return trim(p.Because, 90)
			}
		}
	}
	return "declarado en mapa/ramales.json"
}

// declaredIn: ¿esta central está declarada como propia de esta etapa? El reparto vive en
// `mapa/substeps.json`, así que la respuesta es un dato, no una lista en Go.
func declaredIn(sub *SubMap, stage, central string) bool {
	for _, b := range sub.Blocks(stage) {
		for _, c := range b.Known {
			if c.Label == central {
				return true
			}
		}
	}
	return false
}

// mergeBureaus junta los pasos que son LA MISMA COSA vista desde dos fuentes: la fila de
// `risk_central_user_data` (el hecho: se consultó, esto devolvió) y las líneas de log de esa misma consulta
// (la evidencia: cuántos intentos, con qué error).
//
// El enlace lo declara el mapa (`hito.central` → `risk_centrals.id`), no una coincidencia de nombres:
// «Agildata» y «Identidad con AgilData» no se parecen lo suficiente para adivinarlo, y adivinar acá uniría
// pasos que no van juntos. Los hitos que NO declaran central (la compuerta de reintentos, la persistencia)
// quedan como están: son proceso, no una consulta.
func mergeBureaus(subs []Sub, blocks []*BlockDef, bureaus map[int64]string) []Sub {
	// hito label → nombre de la central con la que se fusiona.
	link := map[string]string{}
	// `consultada` dice qué centrales tienen fila en ESTA traza. Es lo que permite resolver las candidatas
	// sin inventar: la entidad a la que pertenece un hito ambiguo es la única de su familia que se consultó.
	queried := map[string]bool{}
	for i := range subs {
		for _, h := range subs[i].Children {
			if h.Source == "db" && h.Status == "ok" {
				queried[h.Label] = true
			}
		}
	}
	for _, b := range blocks {
		for _, h := range b.Milestones {
			if h.Central != 0 {
				if n, ok := bureaus[h.Central]; ok && n != "" {
					link[h.Label] = n
				}
				continue
			}
			// Candidatas: sólo se resuelve si UNA sola de ellas fue consultada. Con cero no hay a dónde
			// colgarlo; con varias, cualquier elección sería una adivinanza con cara de dato.
			var single string
			n := 0
			for _, id := range h.Bureaus {
				if nom, ok := bureaus[id]; ok && queried[nom] {
					single, n = nom, n+1
				}
			}
			if n == 1 {
				link[h.Label] = single
			}
		}
	}
	if len(link) == 0 {
		return subs
	}
	// DOS FASES, y el orden importa. La primera versión indexaba las filas de central con punteros y en la
	// misma pasada reemplazaba `Hijos` por un slice nuevo: los punteros quedaban apuntando al array viejo y
	// el enriquecimiento se escribía en memoria descartada. Compilaba, corría, y no hacía nada.
	//
	// Fase 1: sacar los hitos enlazados y guardar lo que aportan.
	// ⚠ Es N:1, no 1:1. Con las candidatas resueltas, TRES hitos de Experian («disparado», «NO disparado»,
	// «Consulta terminada») caen en la misma fila. La versión anterior guardaba `aporta[destino] = h` y el
	// último pisaba a los dos anteriores: la fila decía «×1» y las otras dos evidencias desaparecían del
	// árbol sin dejar rastro. Un merge que descarta callado es peor que no fusionar.
	contributes := map[string][]Sub{}
	for i := range subs {
		var remaining []Sub
		for _, h := range subs[i].Children {
			if target, ok := link[h.Label]; ok {
				contributes[target] = append(contributes[target], h)
				continue
			}
			remaining = append(remaining, h)
		}
		subs[i].Children = remaining
	}
	// Fase 2: aplicarlo sobre la fila de la central, ya con los slices definitivos.
	for i := range subs {
		for j := range subs[i].Children {
			c := &subs[i].Children[j]
			hs, ok := contributes[c.Label]
			if !ok {
				continue
			}
			// TODO LO DE LA ENTIDAD DENTRO DE SU PASO, en UN nivel. Como hijos serían nietos —la entidad ya
			// cuelga del grupo— y el árbol dibuja dos niveles a propósito. Así que sus líneas se juntan en
			// la entidad y sus nombres van al detalle: se abre el paso y está todo lo suyo, que era el punto.
			var names []string
			var total int
			for _, h := range hs {
				// La FILA DE BD manda en el estado —es el hecho—, salvo que el log traiga un error: eso el
				// esqueleto no lo sabe y es justo lo que se vino a buscar.
				if h.Status == "fail" {
					c.Status = "fail"
				}
				names = append(names, h.Label)
				total += h.EventsOf
				c.Events = append(c.Events, h.Events...)
			}
			// El tope se aplica DESPUÉS de juntar, y el total dice cuántas había: recortar en silencio acá
			// haría que un paso con 60 líneas se leyera como uno con 40.
			if len(c.Events) > 40 {
				c.Events = c.Events[:40]
			}
			c.EventsOf = total
			if len(names) > 0 {
				c.Detail += " · " + strings.Join(names, " · ")
			}
			c.Source = "db+loki"
		}
	}
	// Un grupo que se quedó sin hijos (todos fusionados) ya no dice nada: se cae. Y el que sobrevive
	// RECUENTA: decía «5 pasos» mostrando 3, porque el resumen se armaba antes de fusionar.
	var out []Sub
	for _, s := range subs {
		if len(s.Children) == 0 && len(s.Events) == 0 && s.Source == "loki" {
			continue
		}
		if s.Source == "loki" && len(s.Children) > 0 {
			timeOfDay := ""
			if i := strings.LastIndex(s.Detail, " · "); i >= 0 {
				timeOfDay = s.Detail[i:]
			}
			err := false
			for _, h := range s.Children {
				if h.Status == "fail" {
					err = true
				}
			}
			s.Detail = plural(len(s.Children), "paso", "pasos") + timeOfDay
			if err {
				s.Detail = "con error · " + s.Detail
			} else {
				s.Status = "ok"
			}
		}
		out = append(out, s)
	}
	return out
}

// hasEvidence: ¿esta etapa tiene algo MEDIDO, o sólo el esqueleto declarado? Un sub en `skip` es un
// placeholder («esta central existe y no se consultó»), no un hecho — contarlo como evidencia haría que la
// regla de «no aplica a este ramal» nunca dispare.
func hasEvidence(e Stage) bool {
	if e.Lines > 0 || e.At != "" {
		return true
	}
	for _, s := range e.Subs {
		if s.Status != "skip" && !s.Declarative {
			return true
		}
	}
	return false
}

// mergePreapproval mete las llamadas del MS DENTRO de la fila de su entidad, por `lender_id`.
//
// Lo que sobra —una llamada a un lender que el listado no muestra— NO se tira: va en una fila propia al
// final. Que el MS haya consultado una entidad que después no apareció es exactamente la clase de cosa que
// hay que ver, no esconder.
func mergePreapproval(subs []Sub, byID map[string]Sub) []Sub {
	used := map[string]bool{}
	var adds func(xs []Sub) []Sub
	adds = func(xs []Sub) []Sub {
		for i := range xs {
			if ms, ok := byID[xs[i].Detail2]; ok && xs[i].Detail2 != "" {
				used[xs[i].Detail2] = true
				// El detalle del listado (el veredicto) manda; lo del MS se agrega detrás.
				if xs[i].Detail != "" {
					xs[i].Detail += " · " + ms.Detail
				} else {
					xs[i].Detail = ms.Detail
				}
				xs[i].Events, xs[i].EventsOf = ms.Events, ms.EventsOf
				xs[i].Source = "db+loki"
				if ms.Status == "warn" {
					xs[i].Status = "warn" // el `pending` deja la entidad colgada: se propaga
				}
			}
			xs[i].Children = adds(xs[i].Children)
		}
		return xs
	}
	subs = adds(subs)

	var leftover []Sub
	var keys []string
	for id := range byID {
		if !used[id] {
			keys = append(keys, id)
		}
	}
	sort.Strings(keys)
	for _, id := range keys {
		s := byID[id]
		s.Label = fmt.Sprintf("%s (lender %s)", s.Label, id)
		leftover = append(leftover, s)
	}
	if len(leftover) > 0 {
		subs = append(subs, Sub{
			Label:  "Consultadas al MS pero NO en el listado",
			Status: "warn", Source: "loki",
			Detail:   plural(len(leftover), "entidad", "entidades") + " — se pre-aprobaron y no aparecen arriba",
			Children: leftover,
		})
	}
	return subs
}

// arbolCorridas parte las líneas comunes del listado POR CORRIDA, no por tipo de mensaje.
//
// La cascada se ejecuta VARIAS VECES en una misma solicitud —medido en la uReq 521997 de prod: tres, a las
// 18:33, 18:45 y 18:46— y cada ejecución es una petición HTTP con su `trace_id`, verificado: «Iniciando
// listado de entidades» y «Listado de entidades completado» comparten trace de a pares.
//
// Agrupadas por mensaje, las líneas de las tres corridas quedan mezcladas: abrir «Reglas por entidad» daba
// 10 renglones entre 18:33 y 18:46 sin forma de saber a cuál ejecución pertenecía cada uno. Por corrida, en
// cambio, cada bloque es una historia completa y comparable — y la que se colgó se ve sola.
func cascadeRuns(ls []Line) int {
	// ⚠ UNA CORRIDA ES UN TRACE QUE ARRANCÓ LA CASCADA, no cualquier trace con líneas del listado.
	//
	// La primera versión contaba traces a secas y decía «la cascada corrió 6 veces» cuando cuatro de esos
	// traces eran fragmentos —uno traía sólo `validatePreApproveLender: entered/exiting`— que ni siquiera
	// intentaban listar. Un número inventado es peor que no dar número.
	//
	// La marca de arranque es `Iniciando listado de entidades`, verificada contra Loki: aparece de a pares
	// con `Listado de entidades completado` bajo el MISMO trace.
	//
	// Antes esto armaba un ÁRBOL entero —una rama por corrida, con sus líneas adentro— y ese árbol se
	// eliminó a pedido: de todo lo que la cascada loguea, lo único que informaba era el timeout del
	// profiler, que hoy vive en su propio paso junto al perfilador que la BD dice que ordenó. Lo que
	// sobrevive es el conteo, porque más de una corrida es un reintento y eso sí es una señal.
	started := map[string]bool{}
	for _, l := range ls {
		if l.trace != "" && strings.HasPrefix(l.msg, "Iniciando listado de entidades") {
			started[l.trace] = true
		}
	}
	return len(started)
}

// preapprovalTree agrupa las líneas del MS de pre-aprobación POR ENTIDAD, no por tipo de mensaje.
//
// La pre-aprobación se pide UNA VEZ POR LENDER: el front llama al MS lender por lender, así que cada
// llamada es un `trace_id` propio con su `lender_name` y su `status` en las etiquetas. Agrupar por mensaje
// («Autenticación ×40, Veredicto ×14») mezcla las cuatro entidades y pierde justo lo que se viene a
// preguntar — *«¿por qué Welli me rechazó?»*.
//
// Medido en la uReq 521997 de prod: 14 llamadas para 4 entidades — `creditop_x` ×6, `credifamilia` ×4,
// `welli` ×2, `bancolombia_bnpl` ×2. Ese conteo por sí solo es una señal: seis intentos contra el mismo
// lender es un patrón de reintento que agrupado por mensaje no se ve en ninguna parte.
func preapprovalTree(ls []Line) map[string]Sub {
	type acc struct {
		traces   map[string]bool
		statuses map[string]int
		lines    []Line
		first    int64
		lenderID string // `lenders.id` real: la llave para fusionar con el árbol de entidades del listado
	}
	// PRIMERO POR TRACE, y recién después por lender. Dentro de una misma llamada las etiquetas están
	// repartidas entre líneas distintas: `lender_name` viaja en las de la llamada al lender y `status` sólo
	// en `preapproval checked successfully`. Agrupar directo por `lender_name` mandaba las 14 líneas de
	// veredicto —las que traen el status— a un cajón «(sin entidad)», que es el dato más útil de todos.
	// El trace es la unidad real: una llamada, un lender, un veredicto.
	lenderOf := map[string]string{}
	idOf := map[string]string{}
	statusOf := map[string]string{}
	for _, l := range ls {
		if l.trace == "" {
			continue
		}
		if v := pick(l.ctx, []string{"lender_id"}); v != "" && idOf[l.trace] == "" {
			idOf[l.trace] = v
		}
		if v := pick(l.ctx, []string{"lender_name"}); v != "" && lenderOf[l.trace] == "" {
			lenderOf[l.trace] = v
		}
		if v := pick(l.ctx, []string{"status"}); v != "" && statusOf[l.trace] == "" {
			statusOf[l.trace] = v
		}
	}

	byLender := map[string]*acc{}
	var order []string
	for _, l := range ls {
		name := lenderOf[l.trace]
		if name == "" {
			name = pick(l.ctx, []string{"lender_name"})
		}
		if name == "" {
			name = "(sin entidad en la etiqueta)"
		}
		// ⚠ SE AGRUPA POR `lender_id`, NO POR NOMBRE. `lender_name` del MS es la FAMILIA en algunos casos:
		// `creditop_x` cubre DENTIX FINANCIAL SERVICES (139) y DFS ORTODONCIA (181) a la vez, y agrupar por
		// ese nombre juntaría dos entidades distintas en una fila. El `lender_id` es el `lenders.id` real —
		// medido: 68 Bancolombia CPD, 24 Credifamilia, 23 Welli, 139/181 los dos DENTIX.
		id := idOf[l.trace]
		if id == "" {
			id = pick(l.ctx, []string{"lender_id"})
		}
		key := id
		if key == "" {
			key = "sin-id:" + name
		}
		a := byLender[key]
		if a == nil {
			a = &acc{traces: map[string]bool{}, statuses: map[string]int{}, first: l.ts, lenderID: key}
			byLender[key] = a
			order = append(order, key)
		}
		a.lines = append(a.lines, l)
		if l.trace != "" && !a.traces[l.trace] {
			a.traces[l.trace] = true
			// El estado se cuenta UNA VEZ POR LLAMADA. Contarlo por línea daría «13 rejected» donde hay 13
			// llamadas rechazadas o una rechazada con 13 líneas — dos cosas muy distintas.
			if st := statusOf[l.trace]; st != "" {
				a.statuses[st]++
			}
		}
		if l.ts < a.first {
			a.first = l.ts
		}
	}
	// Por volumen de llamadas: el lender con más reintentos primero, que es el que suele ser el problema.
	sort.Slice(order, func(i, j int) bool {
		if n, m := len(byLender[order[i]].traces), len(byLender[order[j]].traces); n != m {
			return n > m
		}
		return order[i] < order[j]
	})

	out := map[string]Sub{}
	for _, name := range order {
		a := byLender[name]
		calls := len(a.traces)
		if calls == 0 {
			calls = 1
		}
		var parts []string
		parts = append(parts, plural(calls, "llamada", "llamadas"))
		// Los estados en orden estable: el conteo de un map en Go es aleatorio al recorrerlo.
		var keys []string
		for k := range a.statuses {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		st := "ok"
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%d %s", a.statuses[k], k))
			// `pending` es el que deja la solicitud colgada esperando al lender: se marca. `rejected` NO es
			// un error — es un veredicto de negocio, y pintarlo en rojo haría ver rota una evaluación sana.
			if k == "pending" {
				st = "warn"
			}
		}
		s := Sub{
			Label:  name,
			Status: st,
			Detail: strings.Join(parts, " · ") + " · " + hhmm(time.UnixMilli(a.first)),
			Source: "loki",
		}
		s.Events, s.EventsOf = eventsOf(a.lines, 40)
		out[a.lenderID] = s
	}
	return out
}

// bureausTree lista las centrales que le TOCAN a una etapa: las consultadas con su score y las que no,
// marcadas. Mostrar solo las consultadas dejaría la pregunta a medias — «no fue a consultar» es una
// respuesta.
//
// ⚠ FILTRA POR ETAPA, y esto corrige un error que el mapa tenía: la versión anterior volcaba TODO el
// catálogo de `risk_centrals` en «Consulta a burós», así que `Ado` salía «no consultada» en una etapa donde
// nunca se consulta — ADO es del tramo creditopx, después de elegir la entidad. `risk_centrals` no es «la
// lista de burós»: es donde se guarda cualquier dato de un tercero de identidad o riesgo, y sus filas se
// escriben en momentos distintos. El reparto se declara en `mapa/substeps.json` (bloque `centrales` de cada
// etapa) con el call site que lo prueba, así que afinarlo es editar datos.
//
// `huerfanas` recibe las centrales CON DATOS que ninguna etapa declaró. No se descartan: se devuelven para
// que la etapa del buró las muestre marcadas. Un dato medido que desaparece de la vista porque el mapa no lo
// esperaba es peor que un dato mal ubicado — el segundo se ve, el primero no.
func bureausTree(label string, declaredOnes []CatalogItem, catalog map[int64]string, rows []BureauRow, userID int64) []Sub {
	done := map[string]BureauRow{}
	for _, f := range rows {
		done[f.Central] = f
	}
	// UN SOLO GRUPO, con las CONSULTADAS como hijos y las demás resumidas en un renglón. La lista completa
	// de 6 (4 de ellas «no consultada») convertía la pregunta «¿a quién se consultó y qué dijo?» en un
	// ejercicio de descarte. Pero el universo NO se puede omitir: «no se consultó Mareigua» sólo significa
	// algo si sabés que Mareigua existía como opción, así que las no consultadas se cuentan y se nombran.
	var facts, missing []Sub
	var missingNames []string
	for _, d := range declaredOnes {
		// El NOMBRE sale de la BD cuando existe: el catálogo varía por ambiente y el label declarado es solo
		// para dibujar el árbol antes de consultar.
		name := d.Label
		if n, ok := catalog[d.ID]; ok && n != "" {
			name = n
		}
		s := subCentral(name, done)
		if s.Status == "ok" {
			facts = append(facts, s)
		} else {
			missing = append(missing, s)
			missingNames = append(missingNames, name)
		}
	}
	if len(facts) == 0 && len(missing) == 0 {
		return nil
	}
	children := facts
	if len(missing) > 0 {
		children = append(children, Sub{
			Label:  plural(len(missing), "no consultada", "no consultadas"),
			Status: "skip", Source: "db", Detail: trim(strings.Join(missingNames, " · "), 70),
		})
	}
	st, det := "ok", fmt.Sprintf("%d de %d consultadas", len(facts), len(declaredOnes))
	if len(facts) == 0 {
		st = "skip"
	}
	// La evidencia va en el GRUPO y no en cada central: la afirmación auditable es «2 de 6», y para
	// comprobarla hace falta ver TODAS las filas que trajo la consulta, incluidas las que este bloque no
	// declara. Ahí es donde se descubre que una central que el mapa no conoce sí se consultó.
	rawLines := make([]string, 0, len(rows))
	for _, f := range rows {
		sc := "sin score"
		if f.Score != nil {
			sc = fmt.Sprintf("score %.0f", *f.Score)
		}
		rawLines = append(rawLines, fmt.Sprintf("%s  %s · %s", dateTime(f.At), f.Central, sc))
	}
	if len(rawLines) == 0 {
		rawLines = append(rawLines, "(la consulta no devolvió filas para este user_id)")
	}
	// ⚠ El `?` es el user_id, NO la solicitud: el buró se indexa por cliente, así que estas filas pueden
	// ser de otro intento del mismo cliente. Va dicho acá porque quien copie esto va a pegar la consulta.
	ev := evidence("risk_central_user_data (por user_id, no por solicitud)", sqlBureau, []any{userID}, rawLines...)
	return []Sub{{Label: label, Status: st, Detail: det, Source: "db", Children: children, Evidence: ev}}
}

// subCentral arma la fila de UNA central. Separado porque lo usan el reparto declarado y las huérfanas.
func subCentral(name string, done map[string]BureauRow) Sub {
	f, ok := done[name]
	if !ok {
		return Sub{Label: name, Status: "skip", Detail: "no consultada", Source: "db"}
	}
	d := hhmm(f.At)
	if f.Score != nil {
		d = fmt.Sprintf("score %.0f · %s", *f.Score, d)
	} else {
		d = "sin score · " + d // Agildata nunca trae score: 0 de 202 filas medidas
	}
	return Sub{Label: name, Status: "ok", Detail: d, Source: "db"}
}

// orphanBureaus: las que tienen FILAS pero ninguna etapa las declara. Se busca en TODAS las etapas
// (no solo en la del buró) para que una central nueva en la BD aparezca marcada en vez de desaparecer.
func orphanBureaus(sub *SubMap, stageMap *Map, rows []BureauRow) []Sub {
	declaredOne := map[string]bool{}
	for id := range stageMap.byStage {
		for _, b := range sub.Blocks(id) {
			for _, c := range b.Known {
				declaredOne[c.Label] = true
			}
		}
	}
	done, seenOnes := map[string]BureauRow{}, map[string]bool{}
	var names []string
	for _, f := range rows {
		done[f.Central] = f
		if !declaredOne[f.Central] && !seenOnes[f.Central] {
			seenOnes[f.Central] = true
			names = append(names, f.Central)
		}
	}
	sort.Strings(names)
	var out []Sub
	for _, n := range names {
		s := subCentral(n, done)
		s.Status = "warn"
		s.Detail += " · ⚠ sin etapa declarada en mapa/substeps.json"
		out = append(out, s)
	}
	return out
}

// dot y pad: el vocabulario visual del árbol. Se comparten para que consola y HTML digan lo mismo.
func dot(st string) string {
	switch st {
	case "ok":
		return green("●")
	case "fail":
		return red("●")
	case "warn":
		return paint("33", "●")
	}
	return gray("○")
}

func pad(s string, n int) string {
	s = trim(s, n)
	if len(s) < n {
		return s + strings.Repeat(" ", n-len(s))
	}
	return s
}

// labelValues lee los valores reales de una etiqueta en la ventana. Existe para que el trazador pueda
// DESCUBRIR que su propio filtro no aplica, en vez de devolver vacío y dejar que el vacío se lea como
// «el backend no logueó». Ante cualquier error devuelve nil: no poder comprobar no es lo mismo que
// comprobar que está mal, así que en ese caso el filtro configurado se respeta.
// environmentSelector decide con qué selector se buscan las anclas del MONOLITO (las de `context_*`), y dice
// si no pudo usar el filtro. Es pura a propósito: su error no rompe nada, sale prolijo —una traza «sin
// líneas de log» con los logs a un filtro de distancia—, y eso sólo se atrapa probándola.
//
// Un filtro que no matchea nada es peor que ninguno: no falla, devuelve vacío, y el vacío se lee como «el
// backend no logueó». Por eso se COMPRUEBA contra los valores reales de la etiqueta y, si no está, se cae a
// no filtrar Y SE DICE. Si la lista vino vacía (no se pudo pedir) se usa igual: no hay contra qué
// comprobarlo, y descartarlo sería decidir por el usuario.
//
// Por qué existe: `LOKI_ENV` decía `qa` para el target `staging`, y `environment` en `creditopdev` sólo
// tiene `development`, `local` y `testing`. Toda traza de staging salía sin líneas (uReq 464709, que falló
// firmando con `Deceval createGirador no exitoso`). Y hasta el 2026-09-23 la comprobación comparaba
// `development|develop` ENTERO contra cada valor: como regex es una alternativa, como cadena no existe, así
// que el filtro de dev no se aplicaba nunca y la nota decía que el valor no existía cuando sí.
//
// ⚠ Lo que este filtro separa en `creditopdev` NO es dev de qa (los dos PHP son `development`): es lo
// desplegado de las máquinas de desarrollo (`local`, `testing`), que pueden correr contra su PROPIA base y
// entonces repetir ids de la compartida con otra persona detrás. Dev y qa se distinguen por `service_name`, y eso lo dice
// `splitByBackend` sin filtrar.
func environmentSelector(env string, environments []string) (sel, note string) {
	if env == "" {
		return `{service_name=~".+"}`, ""
	}
	exists := len(environments) == 0
	for _, alt := range strings.Split(env, "|") {
		if contains(environments, strings.TrimSpace(alt)) {
			exists = true
		}
	}
	if exists {
		return fmt.Sprintf(`{environment=~"%s"}`, env), ""
	}
	return `{service_name=~".+"}`, fmt.Sprintf("LOKI_ENV=%q NO existe como valor de `environment` en este stack "+
		"(los que hay: %s) — se consultó SIN filtrar por ambiente, así que pueden colarse líneas de máquinas de "+
		"desarrollo, que pueden tener su propia base", env, strings.Join(environments, " · "))
}

func labelValues(cl *logs.Client, label string, since, until time.Time) []string {
	values := cl.LabelValues(label, since, until)
	sort.Strings(values)
	return values
}

func contains(xs []string, v string) bool {
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}
