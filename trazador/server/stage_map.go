// stage_map.go — el flujo declarado como DATO, no como código.
//
// POR QUÉ: hasta ahora las etapas y sus patrones vivían hardcodeados en `stages.go`. Eso tiene dos
// problemas que se notan enseguida:
//  1. Nadie puede revisar el mapa sin leer Go, y el mapa es conocimiento de NEGOCIO — quién lo sabe de
//     verdad no necesariamente lee Go.
//  2. Una regex amplia pisa dos etapas y no hay forma de auditarlo. Como dato, se puede verificar que
//     ningún patrón capture mensajes de otra etapa (ver `Validar`).
//
// Es el mismo movimiento que hace canon: el conocimiento vive en `map.json` + `doc.md` y
// las herramientas lo leen. Acá el equivalente son `mapa/etapas.json` (qué mensajes marcan cada etapa) y
// `mapa/ramales.json` (qué etapas aplican a cada variante de flujo).
//
// VA EMBEBIDO con go:embed a propósito: el mapa viaja con el binario y no puede quedar desfasado de él.
// Editarlo es editar el JSON y volver a correr — `go run .` recompila igual.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

//go:embed mapa/*.json
var mapFS embed.FS

// ─── el mapa ────────────────────────────────────────────────────────────────────────────────────────

// Matcher dice cómo reconocer que una línea de log pertenece a una etapa.
//
// `exacto` y `prefijo` existen porque son los que NO se equivocan. Una regex amplia (`(?i)quota`) captura
// tanto el cupo como el listado —el cupo ES un filtro del listado— y entonces el diagnóstico queda
// contaminado sin que nada avise. La regex se permite, pero pidiendo el porqué por escrito.
type Matcher struct {
	Kind    string `json:"tipo"` // exacto | prefijo | regex
	Pattern string `json:"patron"`
	Because string `json:"porque,omitempty"`
	// Field: contra QUÉ se compara. Vacío = el mensaje. Con nombre = esa clave del `context`.
	//
	// ⚠ Existe porque hay evidencia que NO está en el mensaje. El caso que lo forzó: el webhook del
	// agregador solo deja huella como la `url` dentro de `http_exception_rendering` — el mensaje es siempre
	// el mismo texto genérico. Un matcher que solo mira el mensaje NUNCA podía encontrarlo, y no fallaba:
	// se quedaba mudo. Lo cazó `-validar`.
	Field string `json:"campo,omitempty"`
	// OnlyInCode: el mensaje existe (verificado en el código) pero no apareció en el corpus medido.
	OnlyInCode bool `json:"soloEnCodigo,omitempty"`

	re *regexp.Regexp // compilado en Cargar
}

// matches compara contra el mensaje o, si el matcher declara `campo`, contra ese campo del context.
func (m *Matcher) matches(msg string, ctx map[string]any) bool {
	goal := msg
	if m.Field != "" {
		v, ok := ctx[m.Field]
		if !ok || v == nil {
			return false
		}
		goal = fmt.Sprint(v)
	}
	switch m.Kind {
	case "exacto":
		return goal == m.Pattern
	case "prefijo":
		return strings.HasPrefix(goal, m.Pattern)
	case "regex":
		return m.re != nil && m.re.MatchString(goal)
	}
	return false
}

// Decision es un mensaje que NO es instrumentación: es un veredicto de negocio, con los campos del
// context que lo explican. Son lo que hace útil al trazador — «QUOTA_CHECK_REJECTED» con su `reason` vale
// más que veinte líneas de entrar y salir de métodos.
type Decision struct {
	Message string `json:"mensaje"`
	// Field: igual que en `Matcher`. Una decisión cuya evidencia vive en el context (la `url` del webhook,
	// por ejemplo) no se puede reconocer por el mensaje, que es genérico. Sin esto quedaba declarada y
	// muda — el mismo defecto que ya había aparecido con las etiquetas compuestas.
	Field    string   `json:"campo,omitempty"`
	Means    string   `json:"significa"`
	Fields   []string `json:"campos,omitempty"`
	Severity string   `json:"severidad"` // ok | rechazo | error | informativo
}

// StageDef es una etapa del flujo tal como se declara.
type StageDef struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Order   int    `json:"orden"`
	Because string `json:"porque,omitempty"`
	// BD: de qué evidencia estructurada dispone esta etapa. Vacío = la BD no la registra, y entonces la
	// ausencia NO prueba nada (se muestra como `sin-evidencia`, no como `no ocurrió`).
	// La PERTENENCIA (estados) y la SEMÁNTICA (cierran/detienen) son preguntas distintas y costaron un
	// falso verde cada vez que se mezclaron: el estado 10 pertenece a desembolso pero no lo cierra
	// (F-103), y el 9 pertenece a formulario pero su fila se escribe al CREAR la solicitud. Declararlas
	// por separado es lo que permite que el 20 «Aprobada no desembolsada» aparezca como DETENIDA en vez
	// de pintar la etapa verde.
	BD struct {
		Statuses []int    `json:"estados,omitempty"`
		Close    []int    `json:"cierran,omitempty"`  // prueban que la etapa TERMINÓ
		Stop     []int    `json:"detienen,omitempty"` // la solicitud está ADENTRO y no salió
		Tables   []string `json:"tablas,omitempty"`
	} `json:"bd"`
	Matchers  []*Matcher `json:"matchers,omitempty"`
	Decisions []Decision `json:"decisiones,omitempty"`
}

// LaneStep dice si una etapa aplica a una variante de flujo, y si es obligatoria.
type LaneStep struct {
	ID       string `json:"id"`
	Required bool   `json:"obligatorio"`
	Because  string `json:"porque,omitempty"`
}

// ChannelDef es una variante del flujo que depende del COMERCIO, no del lender. Hoy hay uno: Corbeta. La
// diferencia con `LaneDef` no es cosmética — un ramal y un canal se pueden combinar (una solicitud de
// Alkosto con Bancolombia es «canal corbeta» + «ramal agregador»), así que suprimen etapas por separado.
type ChannelDef struct {
	ID            string     `json:"id"`
	Label         string     `json:"label"`
	Detects       string     `json:"detecta,omitempty"`
	Because       string     `json:"porque,omitempty"`
	NotApplicable []LaneStep `json:"noAplica,omitempty"`
}

// Channel devuelve la definición de un canal por id.
func (m *Map) Channel(id string) *ChannelDef {
	for _, c := range m.Channels {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// LaneDef es una variante del flujo. Los ids son los mismos que usa `panel/steps.json` del harness, a
// propósito: dos vocabularios para lo mismo es como empiezan a derivar.
type LaneDef struct {
	ID            string     `json:"id"`
	Label         string     `json:"label"`
	RT            []int      `json:"rt,omitempty"`
	Steps         []LaneStep `json:"pasos"`
	NotApplicable []LaneStep `json:"noAplica,omitempty"`
}

// Map es el flujo entero.
type Map struct {
	Version string      `json:"version"`
	Note    string      `json:"nota,omitempty"`
	Stages  []*StageDef `json:"etapas"`
	Lanes   []*LaneDef  `json:"ramales"`
	// Channels: el SEGUNDO EJE. Los ramales se eligen por el `response_type` del lender; los canales por el
	// COMERCIO, y son independientes — el mismo lender 100 consulta buró en Tripleten y no en Alkosto. Un
	// eje solo no puede describir eso, y por eso el árbol dinámico necesita los dos.
	Channels []*ChannelDef `json:"canales"`
	byStage  map[string]*StageDef
}

// Load lee el mapa embebido y compila lo que haga falta.
func Load() (*Map, error) {
	m := &Map{byStage: map[string]*StageDef{}}

	var stages struct {
		Version string      `json:"version"`
		Note    string      `json:"nota"`
		Stages  []*StageDef `json:"etapas"`
	}
	b, err := mapFS.ReadFile("mapa/etapas.json")
	if err != nil {
		return nil, fmt.Errorf("mapa/etapas.json: %w", err)
	}
	if err := json.Unmarshal(b, &stages); err != nil {
		return nil, fmt.Errorf("mapa/etapas.json: %w", err)
	}
	m.Version, m.Note, m.Stages = stages.Version, stages.Note, stages.Stages

	var lanes struct {
		Lanes    []*LaneDef    `json:"ramales"`
		Channels []*ChannelDef `json:"canales"`
	}
	if b, err := mapFS.ReadFile("mapa/ramales.json"); err == nil {
		_ = json.Unmarshal(b, &lanes)
	}
	m.Lanes, m.Channels = lanes.Lanes, lanes.Channels

	sort.Slice(m.Stages, func(i, j int) bool { return m.Stages[i].Order < m.Stages[j].Order })
	for _, e := range m.Stages {
		m.byStage[e.ID] = e
		for _, mt := range e.Matchers {
			if mt.Kind == "regex" {
				re, err := regexp.Compile(mt.Pattern)
				if err != nil {
					return nil, fmt.Errorf("etapa %s: regex %q no compila: %w", e.ID, mt.Pattern, err)
				}
				mt.re = re
			}
		}
	}
	return m, nil
}

// StageOf dice a qué etapa pertenece un mensaje, o "" si a ninguna.
//
// Recorre en el ORDEN DECLARADO y devuelve la primera que coincide. Ese orden no es casual: si dos
// etapas pudieran reclamar el mismo mensaje, gana la que va antes en el flujo — pero eso es una red de
// seguridad, no el diseño. Lo correcto es que no haya solapes, y `Validar` existe para probarlo.
func (m *Map) StageOf(msg string, ctx map[string]any) string {
	for _, e := range m.Stages {
		for _, mt := range e.Matchers {
			if mt.matches(msg, ctx) {
				return e.ID
			}
		}
	}
	return ""
}

// DecisionOf devuelve la definición de negocio de un mensaje, si es un veredicto declarado.
func (m *Map) DecisionOf(msg string, ctx map[string]any) *Decision {
	for _, e := range m.Stages {
		for i := range e.Decisions {
			d := &e.Decisions[i]
			goal := msg
			if d.Field != "" {
				v, ok := ctx[d.Field]
				if !ok || v == nil {
					continue
				}
				goal = fmt.Sprint(v)
			}
			if strings.Contains(goal, d.Message) {
				return d
			}
		}
	}
	return nil
}

// Lane busca una variante por id.
func (m *Map) Lane(id string) *LaneDef {
	for _, r := range m.Lanes {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// ─── validación del propio mapa ─────────────────────────────────────────────────────────────────────

// Validate contesta la pregunta que un mapa hardcodeado no permite hacer: **¿algún patrón pisa a otro?**
//
// Se corre contra un corpus de mensajes reales (el censo). Un patrón que captura mensajes de dos etapas
// no falla en ningún lado: simplemente reparte mal la evidencia, y el diagnóstico sale prolijo y
// equivocado. Es exactamente la clase de error que hay que poder auditar.
func (m *Map) Validate(corpus []string) []string {
	var problems []string

	// 1. Un mensaje reclamado por dos etapas.
	for _, msg := range corpus {
		var owners []string
		for _, e := range m.Stages {
			for _, mt := range e.Matchers {
				if mt.matches(msg, nil) {
					owners = append(owners, e.ID)
					break
				}
			}
		}
		if len(owners) > 1 {
			problems = append(problems, fmt.Sprintf("«%s» lo reclaman %s", trim(msg, 70), strings.Join(owners, " y ")))
		}
	}

	// 2. Un matcher que no captura nada del corpus: o el mensaje ya no existe, o el patrón está mal.
	for _, e := range m.Stages {
		for _, mt := range e.Matchers {
			// Los que miran un campo del context no se pueden validar contra un corpus de mensajes crudos:
			// se declaran no-validables en vez de acusarlos de mudos, que sería un falso positivo.
			if mt.Field != "" || mt.OnlyInCode {
				continue
			}
			usedOne := false
			for _, msg := range corpus {
				if mt.matches(msg, nil) {
					usedOne = true
					break
				}
			}
			if !usedOne {
				problems = append(problems, fmt.Sprintf("etapa %s: el patrón %q no captura NADA del corpus", e.ID, mt.Pattern))
			}
		}
	}

	// 3. Una decisión declarada que ningún matcher de su etapa captura: quedaría invisible.
	for _, e := range m.Stages {
		for _, d := range e.Decisions {
			if d.Field != "" {
				continue // no validable contra un corpus de mensajes crudos
			}
			if got := m.StageOf(d.Message, nil); got != e.ID {
				problems = append(problems, fmt.Sprintf("etapa %s: la decisión «%s» cae en %q, no en su etapa",
					e.ID, trim(d.Message, 50), got))
			}
		}
	}
	return problems
}

// ─── diagrama ───────────────────────────────────────────────────────────────────────────────────────

// Mermaid dibuja el mapa. Existe porque un flujo declarado se puede DIBUJAR, y un dibujo se revisa con
// gente que no lee JSON — que es medio punto de tener el mapa como dato.
func (m *Map) Mermaid(lane string) string {
	var b strings.Builder
	b.WriteString("flowchart LR\n")
	r := m.Lane(lane)

	applies := func(id string) (bool, bool) { // (aplica, obligatorio)
		if r == nil {
			return true, false
		}
		for _, p := range r.Steps {
			if p.ID == id {
				return true, p.Required
			}
		}
		return false, false
	}

	var prev string
	for _, e := range m.Stages {
		ok, req := applies(e.ID)
		if !ok {
			continue
		}
		n := len(e.Decisions)
		label := e.Label
		if n > 0 {
			label = fmt.Sprintf("%s<br/><small>%d decisión(es)</small>", e.Label, n)
		}
		shape := "[\"%s\"]"
		if !req {
			shape = "(\"%s\")" // opcional: forma redondeada
		}
		if len(e.BD.Statuses) == 0 && len(e.BD.Tables) == 0 {
			shape = "{{\"%s\"}}" // sin esqueleto en BD: la ausencia no prueba nada
		}
		fmt.Fprintf(&b, "  %s"+shape+"\n", e.ID, label)
		if prev != "" {
			fmt.Fprintf(&b, "  %s --> %s\n", prev, e.ID)
		}
		prev = e.ID
	}
	if r != nil {
		fmt.Fprintf(&b, "  %%%% ramal %s: %s\n", r.ID, r.Label)
		for _, p := range r.NotApplicable {
			fmt.Fprintf(&b, "  %%%% no aplica: %s — %s\n", p.ID, p.Because)
		}
	}
	return b.String()
}

// Order devuelve las etapas en su orden de flujo, con la forma que espera el ensamblado. Existe para que
// migrar de los slices hardcodeados al mapa no obligue a reescribir `ensamblar`.
func (m *Map) Order() []struct{ id, label string } {
	out := make([]struct{ id, label string }, 0, len(m.Stages))
	for _, e := range m.Stages {
		out = append(out, struct{ id, label string }{e.ID, e.Label})
	}
	return out
}

// StageStatus: qué etapa prueba cada estado de `user_request_statuses`, según el mapa.
func (m *Map) StageStatus() map[int]string {
	out := map[int]string{}
	for _, e := range m.Stages {
		for _, st := range e.BD.Statuses {
			out[st] = e.ID
		}
	}
	return out
}

// ClosingStatus y StoppingStatus derivan la SEMÁNTICA de los estados desde el mapa, igual que StageStatus
// deriva la pertenencia. Vivían hardcodeados en stages.go y `bd.estados` era letra muerta: un estado
// agregado al JSON no movía nada, y eso no fallaba — daba un mapa distinto del que el JSON afirmaba.
func (m *Map) ClosingStatus() map[int]bool {
	out := map[int]bool{}
	for _, e := range m.Stages {
		for _, st := range e.BD.Close {
			out[st] = true
		}
	}
	return out
}

func (m *Map) StoppingStatus() map[int]string {
	out := map[int]string{}
	for _, e := range m.Stages {
		for _, st := range e.BD.Stop {
			out[st] = e.ID
		}
	}
	return out
}

// HasSkeleton dice si la BD puede probar esta etapa. Si no, su ausencia NO significa "no ocurrió".
func (m *Map) HasSkeleton(id string) bool {
	e, ok := m.byStage[id]
	return ok && (len(e.BD.Statuses) > 0 || len(e.BD.Tables) > 0)
}

// ─── modo validar ───────────────────────────────────────────────────────────────────────────────────

// ValidateAgainst corre las comprobaciones del mapa contra un corpus de mensajes CRUDOS y devuelve el exit
// code. Es la lección más caras de la primera versión del mapa: cinco matchers se habían validado contra
// una lista de mensajes NORMALIZADA (sin el verbo del span, con los números colapsados) en vez de contra
// la línea que Loki devuelve de verdad. Ninguno fallaba: se quedaban mudos, y la etapa aparecía vacía.
//
//	0  el mapa está sano
//	1  hay problemas (y se listan)
//	2  no se pudo leer el corpus
func ValidateAgainst(path string) int {
	m, err := Load()
	if err != nil {
		fmt.Printf("  %s el mapa no carga: %v\n", paint("31", "✘"), err)
		return 1
	}
	raws, err := rawCorpus(path)
	if err != nil {
		fmt.Printf("  %s no pude leer el corpus %s: %v\n", paint("31", "✘"), path, err)
		fmt.Printf("  %s\n", gray("se espera un TSV con la columna `ejemplo` (la línea CRUDA) o un .ndjson con {msg}"))
		return 2
	}

	fmt.Printf("\n  %s\n", bold("── VALIDACIÓN DEL MAPA ──"))
	fmt.Printf("     mapa v%s · %d etapas · %d mensajes crudos en el corpus\n", m.Version, len(m.Stages), len(raws))

	// Cobertura por etapa: una etapa que no captura nada es una etapa muda.
	fmt.Println()
	total := 0
	for _, e := range m.Stages {
		n := 0
		for _, msg := range raws {
			for _, mt := range e.Matchers {
				if mt.matches(msg, nil) {
					n++
					break
				}
			}
		}
		total += n
		mark := gray("·")
		if len(e.Matchers) == 0 {
			mark = paint("33", "—")
		} else if n == 0 {
			mark = paint("31", "✘")
		}
		fmt.Printf("     %s %-11s %2d matchers → %3d mensajes  %s\n", mark, e.ID, len(e.Matchers), n,
			gray(fmt.Sprintf("%d decisiones", len(e.Decisions))))
	}
	fmt.Printf("     %s\n", gray(fmt.Sprintf("cobertura: %d de %d mensajes distintos (%.0f%%)",
		total, len(raws), 100*float64(total)/float64(max(1, len(raws))))))

	problems := m.Validate(raws)

	// El árbol declarado también se audita: un hito que captura líneas que su etapa no reclama muestra un
	// sub-paso colgando de la nada, y eso no se ve mirando la pantalla.
	if sub, err := LoadSub(); err != nil {
		problems = append(problems, "substeps.json no carga: "+err.Error())
	} else {
		bl, hi := 0, 0
		for _, e := range sub.Stages {
			bl += len(e.Blocks)
			for _, b := range e.Blocks {
				hi += len(b.Milestones)
			}
		}
		fmt.Printf("     %s\n", gray(fmt.Sprintf("árbol declarado v%s: %d bloques · %d hitos", sub.Version, bl, hi)))
		problems = append(problems, sub.ValidateSub(m, raws)...)
	}

	if len(problems) == 0 {
		fmt.Printf("\n     %s sin solapes, sin patrones mudos y todas las decisiones resuelven\n\n", paint("32", "✔"))
		return 0
	}
	fmt.Printf("\n  %s\n", paint("31", bold(fmt.Sprintf("── %d PROBLEMA(S) ──", len(problems)))))
	for _, p := range problems {
		fmt.Printf("     %s %s\n", paint("31", "✘"), p)
	}
	fmt.Println()
	return 1
}

// rawCorpus lee las líneas CRUDAS. Acepta el TSV del censo (columna `ejemplo`, que es la línea real) o
// un `timeline.ndjson` de los que deja el forense del harness.
func rawCorpus(path string) ([]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	seenOnes := map[string]bool{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s != "" && !seenOnes[s] {
			seenOnes[s] = true
			out = append(out, s)
		}
	}
	for i, ln := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(strings.TrimSpace(ln), "{") {
			var o struct {
				Msg     string `json:"msg"`
				Message string `json:"message"`
			}
			if json.Unmarshal([]byte(ln), &o) == nil {
				add(o.Msg + o.Message)
			}
			continue
		}
		cols := strings.Split(ln, "\t")
		if i == 0 || len(cols) < 5 {
			continue
		}
		add(cols[4]) // `ejemplo`: la línea cruda, NO la normalizada
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no encontré líneas crudas")
	}
	return out, nil
}

// ─── el árbol declarado (mapa/substeps.json) ────────────────────────────────────────────────────────
//
// Declara la FORMA del árbol para poder dibujarlo antes de tener datos, y después encender lo que la
// corrida confirma. La frontera de qué se declara y qué no está escrita en el propio JSON: se declara lo
// de universo cerrado (hitos, familias) y no lo que es dato variable (los lenders, cuyo response_type
// cambia por ambiente).

type MilestoneDef struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Matcher *Matcher `json:"matcher"`
	Because string   `json:"porque,omitempty"`
	// OnlyInCode: el mensaje EXISTE (verificado grepeando el código) pero no apareció en el corpus
	// medido. Es distinto de un patrón mal escrito, y mezclarlos es cómo un validador se vuelve ruidoso y
	// deja de mirarse. `ValidateSub` lo reporta como aviso, no como problema.
	OnlyInCode bool `json:"soloEnCodigo,omitempty"`
	// Central: el `risk_centrals.id` del que este hito es EL LADO DE LOG. Cuando está declarado, el
	// ensamblado FUSIONA los dos en un solo paso en vez de mostrarlos como dos.
	//
	// Sin esto el buró listaba «Agildata · sin score · 08:43:18» (la fila de BD) y aparte «Identidad con
	// AgilData ×5» (sus líneas), que son la misma consulta vista desde dos fuentes. Duplicar el paso obliga a
	// cruzarlos de cabeza; fusionado queda una sola fila con el HECHO de la BD y la EVIDENCIA del log junta.
	Central int64 `json:"central,omitempty"`
	// Bureaus: CANDIDATAS, cuando el mensaje nombra a la entidad pero no dice CUÁL de sus filas del
	// catálogo. «Experian disparado desde…» es de Experian, pero el catálogo tiene tres Experian (Acierta,
	// Quanto, Acierta+Quanto) y el texto no distingue. Declarar una fija haría que en la mitad de las
	// solicitudes el paso colgara de la entidad equivocada — peor que dejarlo suelto.
	//
	// Se resuelve EN CADA TRAZA: si exactamente una de las candidatas fue consultada, el hito se fusiona
	// ahí; si fueron cero o varias, se queda en su bloque y no se atribuye. Sin adivinar.
	Bureaus []int64 `json:"centrales,omitempty"`
}

type FamilyValue struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	RT     []int  `json:"rt,omitempty"`
	Lender int64  `json:"lender,omitempty"`
}

type CatalogItem struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
	Note  string `json:"nota,omitempty"`
}

type BlockDef struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"tipo"` // hitos | catalogo | familias | dinamico
	Note  string `json:"nota,omitempty"`
	// Screen: la ruta del wizard que produce este bloque
	// (`frontend-monorepo/apps/loan-request-wizard/app/routes.ts`). No es decorado: es la traducción entre
	// el idioma del backend —en el que está todo lo demás— y el idioma en el que llega el reporte de
	// soporte. «Falló en firma de documentos» es `sign-documents`, y antes aterrizaba en «Desembolso».
	//
	// ⚠ Se INFIERE del endpoint que sirvió el backend; nunca se observa. El wizard no manda nada a Loki
	// (sus logs de ruta salen por OTLP hacia PostHog), así que una pantalla sin llamada al backend es
	// invisible acá. Por eso se muestra como «pantalla X», no como «el cliente estuvo en X».
	Screen     string         `json:"pantalla,omitempty"`
	Source     string         `json:"fuente,omitempty"`
	Milestones []MilestoneDef `json:"hitos,omitempty"`
	Values     []FamilyValue  `json:"valores,omitempty"`
	Known      []CatalogItem  `json:"conocidos,omitempty"`
}

type SubMap struct {
	Version string `json:"version"`
	Note    string `json:"nota,omitempty"`
	Stages  map[string]struct {
		Blocks []*BlockDef `json:"bloques"`
	} `json:"etapas"`
}

// LoadSub lee el árbol declarado y compila las regex de los hitos.
func LoadSub() (*SubMap, error) {
	b, err := mapFS.ReadFile("mapa/substeps.json")
	if err != nil {
		return nil, err
	}
	var s SubMap
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("mapa/substeps.json: %w", err)
	}
	for et, e := range s.Stages {
		for _, bl := range e.Blocks {
			for i := range bl.Milestones {
				mt := bl.Milestones[i].Matcher
				if mt == nil || mt.Kind != "regex" {
					continue
				}
				re, err := regexp.Compile(mt.Pattern)
				if err != nil {
					return nil, fmt.Errorf("etapa %s, hito %s: regex %q no compila: %w", et, bl.Milestones[i].ID, mt.Pattern, err)
				}
				mt.re = re
			}
		}
	}
	return &s, nil
}

// Blocks devuelve los bloques declarados de una etapa (vacío si no declara ninguno).
func (s *SubMap) Blocks(stage string) []*BlockDef {
	if s == nil {
		return nil
	}
	return s.Stages[stage].Blocks
}

// ValidateSub comprueba la regla que hace consistente al árbol: **el matcher de un hito tiene que ser un
// subconjunto del de su etapa.** Si un hito captura una línea que su etapa no reclama, el árbol muestra un
// sub-paso colgando de una etapa que no lo tiene — y eso no lo nota nadie mirando la pantalla.
func (s *SubMap) ValidateSub(m *Map, corpus []string) []string {
	var problems []string
	for stage, e := range s.Stages {
		if _, ok := m.byStage[stage]; !ok {
			problems = append(problems, fmt.Sprintf("substeps declara la etapa %q, que no existe en etapas.json", stage))
			continue
		}
		for _, bl := range e.Blocks {
			for _, h := range bl.Milestones {
				if h.Matcher == nil {
					continue // los hitos sin matcher son deliberados (ej. `asesor`, que se infiere por ausencia)
				}
				if h.Matcher.Field != "" {
					continue // igual que arriba: no validable contra mensajes crudos
				}
				capturesSomething, outside := false, 0
				for _, msg := range corpus {
					if !h.Matcher.matches(msg, nil) {
						continue
					}
					capturesSomething = true
					if owner := m.StageOf(msg, nil); owner != stage {
						outside++
					}
				}
				if !capturesSomething {
					if h.OnlyInCode {
						continue // declarado desde el código, no medido: es esperado
					}
					problems = append(problems, fmt.Sprintf("hito %s/%s: el patrón %q no captura NADA del corpus",
						stage, h.ID, h.Matcher.Pattern))
				} else if outside > 0 {
					problems = append(problems, fmt.Sprintf("hito %s/%s: captura %d mensaje(s) que su etapa NO reclama "+
						"(colgarían de la nada)", stage, h.ID, outside))
				}
			}
		}
	}
	sort.Strings(problems)
	return problems
}
