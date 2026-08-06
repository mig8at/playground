// mapa.go — el flujo declarado como DATO, no como código.
//
// POR QUÉ: hasta ahora las etapas y sus patrones vivían hardcodeados en `etapas.go`. Eso tiene dos
// problemas que se notan enseguida:
//  1. Nadie puede revisar el mapa sin leer Go, y el mapa es conocimiento de NEGOCIO — quién lo sabe de
//     verdad no necesariamente lee Go.
//  2. Una regex amplia pisa dos etapas y no hay forma de auditarlo. Como dato, se puede verificar que
//     ningún patrón capture mensajes de otra etapa (ver `Validar`).
//
// Es el mismo movimiento que ya está hecho en `context/`: el conocimiento vive en `map.json` + `doc.md` y
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
var mapaFS embed.FS

// ─── el mapa ────────────────────────────────────────────────────────────────────────────────────────

// Matcher dice cómo reconocer que una línea de log pertenece a una etapa.
//
// `exacto` y `prefijo` existen porque son los que NO se equivocan. Una regex amplia (`(?i)quota`) captura
// tanto el cupo como el listado —el cupo ES un filtro del listado— y entonces el diagnóstico queda
// contaminado sin que nada avise. La regex se permite, pero pidiendo el porqué por escrito.
type Matcher struct {
	Tipo   string `json:"tipo"` // exacto | prefijo | regex
	Patron string `json:"patron"`
	Porque string `json:"porque,omitempty"`
	// Campo: contra QUÉ se compara. Vacío = el mensaje. Con nombre = esa clave del `context`.
	//
	// ⚠ Existe porque hay evidencia que NO está en el mensaje. El caso que lo forzó: el webhook del
	// agregador solo deja huella como la `url` dentro de `http_exception_rendering` — el mensaje es siempre
	// el mismo texto genérico. Un matcher que solo mira el mensaje NUNCA podía encontrarlo, y no fallaba:
	// se quedaba mudo. Lo cazó `-validar`.
	Campo string `json:"campo,omitempty"`
	// SoloEnCodigo: el mensaje existe (verificado en el código) pero no apareció en el corpus medido.
	SoloEnCodigo bool `json:"soloEnCodigo,omitempty"`

	re *regexp.Regexp // compilado en Cargar
}

// coincide compara contra el mensaje o, si el matcher declara `campo`, contra ese campo del context.
func (m *Matcher) coincide(msg string, ctx map[string]any) bool {
	objetivo := msg
	if m.Campo != "" {
		v, ok := ctx[m.Campo]
		if !ok || v == nil {
			return false
		}
		objetivo = fmt.Sprint(v)
	}
	switch m.Tipo {
	case "exacto":
		return objetivo == m.Patron
	case "prefijo":
		return strings.HasPrefix(objetivo, m.Patron)
	case "regex":
		return m.re != nil && m.re.MatchString(objetivo)
	}
	return false
}

// Decision es un mensaje que NO es instrumentación: es un veredicto de negocio, con los campos del
// context que lo explican. Son lo que hace útil al trazador — «QUOTA_CHECK_REJECTED» con su `reason` vale
// más que veinte líneas de entrar y salir de métodos.
type Decision struct {
	Mensaje string `json:"mensaje"`
	// Campo: igual que en `Matcher`. Una decisión cuya evidencia vive en el context (la `url` del webhook,
	// por ejemplo) no se puede reconocer por el mensaje, que es genérico. Sin esto quedaba declarada y
	// muda — el mismo defecto que ya había aparecido con las etiquetas compuestas.
	Campo     string   `json:"campo,omitempty"`
	Significa string   `json:"significa"`
	Campos    []string `json:"campos,omitempty"`
	Severidad string   `json:"severidad"` // ok | rechazo | error | informativo
}

// EtapaDef es una etapa del flujo tal como se declara.
type EtapaDef struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Orden  int    `json:"orden"`
	Porque string `json:"porque,omitempty"`
	// BD: de qué evidencia estructurada dispone esta etapa. Vacío = la BD no la registra, y entonces la
	// ausencia NO prueba nada (se muestra como `sin-evidencia`, no como `no ocurrió`).
	BD struct {
		Estados []int    `json:"estados,omitempty"`
		Tablas  []string `json:"tablas,omitempty"`
	} `json:"bd"`
	Matchers   []*Matcher `json:"matchers,omitempty"`
	Decisiones []Decision `json:"decisiones,omitempty"`
}

// PasoRamal dice si una etapa aplica a una variante de flujo, y si es obligatoria.
type PasoRamal struct {
	ID          string `json:"id"`
	Obligatorio bool   `json:"obligatorio"`
	Porque      string `json:"porque,omitempty"`
}

// CanalDef es una variante del flujo que depende del COMERCIO, no del lender. Hoy hay uno: Corbeta. La
// diferencia con `RamalDef` no es cosmética — un ramal y un canal se pueden combinar (una solicitud de
// Alkosto con Bancolombia es «canal corbeta» + «ramal agregador»), así que suprimen etapas por separado.
type CanalDef struct {
	ID       string      `json:"id"`
	Label    string      `json:"label"`
	Detecta  string      `json:"detecta,omitempty"`
	Porque   string      `json:"porque,omitempty"`
	NoAplica []PasoRamal `json:"noAplica,omitempty"`
}

// Canal devuelve la definición de un canal por id.
func (m *Mapa) Canal(id string) *CanalDef {
	for _, c := range m.Canales {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// RamalDef es una variante del flujo. Los ids son los mismos que usa `panel/steps.json` del harness, a
// propósito: dos vocabularios para lo mismo es como empiezan a derivar.
type RamalDef struct {
	ID       string      `json:"id"`
	Label    string      `json:"label"`
	RT       []int       `json:"rt,omitempty"`
	Pasos    []PasoRamal `json:"pasos"`
	NoAplica []PasoRamal `json:"noAplica,omitempty"`
}

// Mapa es el flujo entero.
type Mapa struct {
	Version string      `json:"version"`
	Nota    string      `json:"nota,omitempty"`
	Etapas  []*EtapaDef `json:"etapas"`
	Ramales []*RamalDef `json:"ramales"`
	// Canales: el SEGUNDO EJE. Los ramales se eligen por el `response_type` del lender; los canales por el
	// COMERCIO, y son independientes — el mismo lender 100 consulta buró en Tripleten y no en Alkosto. Un
	// eje solo no puede describir eso, y por eso el árbol dinámico necesita los dos.
	Canales  []*CanalDef `json:"canales"`
	porEtapa map[string]*EtapaDef
}

// Cargar lee el mapa embebido y compila lo que haga falta.
func Cargar() (*Mapa, error) {
	m := &Mapa{porEtapa: map[string]*EtapaDef{}}

	var etapas struct {
		Version string      `json:"version"`
		Nota    string      `json:"nota"`
		Etapas  []*EtapaDef `json:"etapas"`
	}
	b, err := mapaFS.ReadFile("mapa/etapas.json")
	if err != nil {
		return nil, fmt.Errorf("mapa/etapas.json: %w", err)
	}
	if err := json.Unmarshal(b, &etapas); err != nil {
		return nil, fmt.Errorf("mapa/etapas.json: %w", err)
	}
	m.Version, m.Nota, m.Etapas = etapas.Version, etapas.Nota, etapas.Etapas

	var ramales struct {
		Ramales []*RamalDef `json:"ramales"`
		Canales []*CanalDef `json:"canales"`
	}
	if b, err := mapaFS.ReadFile("mapa/ramales.json"); err == nil {
		_ = json.Unmarshal(b, &ramales)
	}
	m.Ramales, m.Canales = ramales.Ramales, ramales.Canales

	sort.Slice(m.Etapas, func(i, j int) bool { return m.Etapas[i].Orden < m.Etapas[j].Orden })
	for _, e := range m.Etapas {
		m.porEtapa[e.ID] = e
		for _, mt := range e.Matchers {
			if mt.Tipo == "regex" {
				re, err := regexp.Compile(mt.Patron)
				if err != nil {
					return nil, fmt.Errorf("etapa %s: regex %q no compila: %w", e.ID, mt.Patron, err)
				}
				mt.re = re
			}
		}
	}
	return m, nil
}

// EtapaDe dice a qué etapa pertenece un mensaje, o "" si a ninguna.
//
// Recorre en el ORDEN DECLARADO y devuelve la primera que coincide. Ese orden no es casual: si dos
// etapas pudieran reclamar el mismo mensaje, gana la que va antes en el flujo — pero eso es una red de
// seguridad, no el diseño. Lo correcto es que no haya solapes, y `Validar` existe para probarlo.
func (m *Mapa) EtapaDe(msg string, ctx map[string]any) string {
	for _, e := range m.Etapas {
		for _, mt := range e.Matchers {
			if mt.coincide(msg, ctx) {
				return e.ID
			}
		}
	}
	return ""
}

// DecisionDe devuelve la definición de negocio de un mensaje, si es un veredicto declarado.
func (m *Mapa) DecisionDe(msg string, ctx map[string]any) *Decision {
	for _, e := range m.Etapas {
		for i := range e.Decisiones {
			d := &e.Decisiones[i]
			objetivo := msg
			if d.Campo != "" {
				v, ok := ctx[d.Campo]
				if !ok || v == nil {
					continue
				}
				objetivo = fmt.Sprint(v)
			}
			if strings.Contains(objetivo, d.Mensaje) {
				return d
			}
		}
	}
	return nil
}

// Ramal busca una variante por id.
func (m *Mapa) Ramal(id string) *RamalDef {
	for _, r := range m.Ramales {
		if r.ID == id {
			return r
		}
	}
	return nil
}

// ─── validación del propio mapa ─────────────────────────────────────────────────────────────────────

// Validar contesta la pregunta que un mapa hardcodeado no permite hacer: **¿algún patrón pisa a otro?**
//
// Se corre contra un corpus de mensajes reales (el censo). Un patrón que captura mensajes de dos etapas
// no falla en ningún lado: simplemente reparte mal la evidencia, y el diagnóstico sale prolijo y
// equivocado. Es exactamente la clase de error que hay que poder auditar.
func (m *Mapa) Validar(corpus []string) []string {
	var problemas []string

	// 1. Un mensaje reclamado por dos etapas.
	for _, msg := range corpus {
		var duenos []string
		for _, e := range m.Etapas {
			for _, mt := range e.Matchers {
				if mt.coincide(msg, nil) {
					duenos = append(duenos, e.ID)
					break
				}
			}
		}
		if len(duenos) > 1 {
			problemas = append(problemas, fmt.Sprintf("«%s» lo reclaman %s", trim(msg, 70), strings.Join(duenos, " y ")))
		}
	}

	// 2. Un matcher que no captura nada del corpus: o el mensaje ya no existe, o el patrón está mal.
	for _, e := range m.Etapas {
		for _, mt := range e.Matchers {
			// Los que miran un campo del context no se pueden validar contra un corpus de mensajes crudos:
			// se declaran no-validables en vez de acusarlos de mudos, que sería un falso positivo.
			if mt.Campo != "" || mt.SoloEnCodigo {
				continue
			}
			usado := false
			for _, msg := range corpus {
				if mt.coincide(msg, nil) {
					usado = true
					break
				}
			}
			if !usado {
				problemas = append(problemas, fmt.Sprintf("etapa %s: el patrón %q no captura NADA del corpus", e.ID, mt.Patron))
			}
		}
	}

	// 3. Una decisión declarada que ningún matcher de su etapa captura: quedaría invisible.
	for _, e := range m.Etapas {
		for _, d := range e.Decisiones {
			if d.Campo != "" {
				continue // no validable contra un corpus de mensajes crudos
			}
			if got := m.EtapaDe(d.Mensaje, nil); got != e.ID {
				problemas = append(problemas, fmt.Sprintf("etapa %s: la decisión «%s» cae en %q, no en su etapa",
					e.ID, trim(d.Mensaje, 50), got))
			}
		}
	}
	return problemas
}

// ─── diagrama ───────────────────────────────────────────────────────────────────────────────────────

// Mermaid dibuja el mapa. Existe porque un flujo declarado se puede DIBUJAR, y un dibujo se revisa con
// gente que no lee JSON — que es medio punto de tener el mapa como dato.
func (m *Mapa) Mermaid(ramal string) string {
	var b strings.Builder
	b.WriteString("flowchart LR\n")
	r := m.Ramal(ramal)

	aplica := func(id string) (bool, bool) { // (aplica, obligatorio)
		if r == nil {
			return true, false
		}
		for _, p := range r.Pasos {
			if p.ID == id {
				return true, p.Obligatorio
			}
		}
		return false, false
	}

	var prev string
	for _, e := range m.Etapas {
		ok, obl := aplica(e.ID)
		if !ok {
			continue
		}
		n := len(e.Decisiones)
		etiqueta := e.Label
		if n > 0 {
			etiqueta = fmt.Sprintf("%s<br/><small>%d decisión(es)</small>", e.Label, n)
		}
		forma := "[\"%s\"]"
		if !obl {
			forma = "(\"%s\")" // opcional: forma redondeada
		}
		if len(e.BD.Estados) == 0 && len(e.BD.Tablas) == 0 {
			forma = "{{\"%s\"}}" // sin esqueleto en BD: la ausencia no prueba nada
		}
		fmt.Fprintf(&b, "  %s"+forma+"\n", e.ID, etiqueta)
		if prev != "" {
			fmt.Fprintf(&b, "  %s --> %s\n", prev, e.ID)
		}
		prev = e.ID
	}
	if r != nil {
		fmt.Fprintf(&b, "  %%%% ramal %s: %s\n", r.ID, r.Label)
		for _, p := range r.NoAplica {
			fmt.Fprintf(&b, "  %%%% no aplica: %s — %s\n", p.ID, p.Porque)
		}
	}
	return b.String()
}

// Orden devuelve las etapas en su orden de flujo, con la forma que espera el ensamblado. Existe para que
// migrar de los slices hardcodeados al mapa no obligue a reescribir `ensamblar`.
func (m *Mapa) Orden() []struct{ id, label string } {
	out := make([]struct{ id, label string }, 0, len(m.Etapas))
	for _, e := range m.Etapas {
		out = append(out, struct{ id, label string }{e.ID, e.Label})
	}
	return out
}

// EstadoEtapa: qué etapa prueba cada estado de `user_request_statuses`, según el mapa.
func (m *Mapa) EstadoEtapa() map[int]string {
	out := map[int]string{}
	for _, e := range m.Etapas {
		for _, st := range e.BD.Estados {
			out[st] = e.ID
		}
	}
	return out
}

// TieneEsqueleto dice si la BD puede probar esta etapa. Si no, su ausencia NO significa "no ocurrió".
func (m *Mapa) TieneEsqueleto(id string) bool {
	e, ok := m.porEtapa[id]
	return ok && (len(e.BD.Estados) > 0 || len(e.BD.Tablas) > 0)
}

// ─── modo validar ───────────────────────────────────────────────────────────────────────────────────

// ValidarContra corre las comprobaciones del mapa contra un corpus de mensajes CRUDOS y devuelve el exit
// code. Es la lección más caras de la primera versión del mapa: cinco matchers se habían validado contra
// una lista de mensajes NORMALIZADA (sin el verbo del span, con los números colapsados) en vez de contra
// la línea que Loki devuelve de verdad. Ninguno fallaba: se quedaban mudos, y la etapa aparecía vacía.
//
//	0  el mapa está sano
//	1  hay problemas (y se listan)
//	2  no se pudo leer el corpus
func ValidarContra(ruta string) int {
	m, err := Cargar()
	if err != nil {
		fmt.Printf("  %s el mapa no carga: %v\n", paint("31", "✘"), err)
		return 1
	}
	crudos, err := corpusCrudo(ruta)
	if err != nil {
		fmt.Printf("  %s no pude leer el corpus %s: %v\n", paint("31", "✘"), ruta, err)
		fmt.Printf("  %s\n", gray("se espera un TSV con la columna `ejemplo` (la línea CRUDA) o un .ndjson con {msg}"))
		return 2
	}

	fmt.Printf("\n  %s\n", bold("── VALIDACIÓN DEL MAPA ──"))
	fmt.Printf("     mapa v%s · %d etapas · %d mensajes crudos en el corpus\n", m.Version, len(m.Etapas), len(crudos))

	// Cobertura por etapa: una etapa que no captura nada es una etapa muda.
	fmt.Println()
	total := 0
	for _, e := range m.Etapas {
		n := 0
		for _, msg := range crudos {
			for _, mt := range e.Matchers {
				if mt.coincide(msg, nil) {
					n++
					break
				}
			}
		}
		total += n
		marca := gray("·")
		if len(e.Matchers) == 0 {
			marca = paint("33", "—")
		} else if n == 0 {
			marca = paint("31", "✘")
		}
		fmt.Printf("     %s %-11s %2d matchers → %3d mensajes  %s\n", marca, e.ID, len(e.Matchers), n,
			gray(fmt.Sprintf("%d decisiones", len(e.Decisiones))))
	}
	fmt.Printf("     %s\n", gray(fmt.Sprintf("cobertura: %d de %d mensajes distintos (%.0f%%)",
		total, len(crudos), 100*float64(total)/float64(max(1, len(crudos))))))

	problemas := m.Validar(crudos)

	// El árbol declarado también se audita: un hito que captura líneas que su etapa no reclama muestra un
	// sub-paso colgando de la nada, y eso no se ve mirando la pantalla.
	if sub, err := CargarSub(); err != nil {
		problemas = append(problemas, "substeps.json no carga: "+err.Error())
	} else {
		bl, hi := 0, 0
		for _, e := range sub.Etapas {
			bl += len(e.Bloques)
			for _, b := range e.Bloques {
				hi += len(b.Hitos)
			}
		}
		fmt.Printf("     %s\n", gray(fmt.Sprintf("árbol declarado v%s: %d bloques · %d hitos", sub.Version, bl, hi)))
		problemas = append(problemas, sub.ValidarSub(m, crudos)...)
	}

	if len(problemas) == 0 {
		fmt.Printf("\n     %s sin solapes, sin patrones mudos y todas las decisiones resuelven\n\n", paint("32", "✔"))
		return 0
	}
	fmt.Printf("\n  %s\n", paint("31", bold(fmt.Sprintf("── %d PROBLEMA(S) ──", len(problemas)))))
	for _, p := range problemas {
		fmt.Printf("     %s %s\n", paint("31", "✘"), p)
	}
	fmt.Println()
	return 1
}

// corpusCrudo lee las líneas CRUDAS. Acepta el TSV del censo (columna `ejemplo`, que es la línea real) o
// un `timeline.ndjson` de los que deja el forense del harness.
func corpusCrudo(ruta string) ([]string, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return nil, err
	}
	vistos := map[string]bool{}
	var out []string
	add := func(s string) {
		s = strings.TrimSpace(s)
		if s != "" && !vistos[s] {
			vistos[s] = true
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

type HitoDef struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Matcher *Matcher `json:"matcher"`
	Porque  string   `json:"porque,omitempty"`
	// SoloEnCodigo: el mensaje EXISTE (verificado grepeando el código) pero no apareció en el corpus
	// medido. Es distinto de un patrón mal escrito, y mezclarlos es cómo un validador se vuelve ruidoso y
	// deja de mirarse. `ValidarSub` lo reporta como aviso, no como problema.
	SoloEnCodigo bool `json:"soloEnCodigo,omitempty"`
	// Central: el `risk_centrals.id` del que este hito es EL LADO DE LOG. Cuando está declarado, el
	// ensamblado FUSIONA los dos en un solo paso en vez de mostrarlos como dos.
	//
	// Sin esto el buró listaba «Agildata · sin score · 08:43:18» (la fila de BD) y aparte «Identidad con
	// AgilData ×5» (sus líneas), que son la misma consulta vista desde dos fuentes. Duplicar el paso obliga a
	// cruzarlos de cabeza; fusionado queda una sola fila con el HECHO de la BD y la EVIDENCIA del log junta.
	Central int64 `json:"central,omitempty"`
}

type ValorFamilia struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	RT     []int  `json:"rt,omitempty"`
	Lender int64  `json:"lender,omitempty"`
}

type ItemCatalogo struct {
	ID    int64  `json:"id"`
	Label string `json:"label"`
	Nota  string `json:"nota,omitempty"`
}

type BloqueDef struct {
	ID        string         `json:"id"`
	Label     string         `json:"label"`
	Tipo      string         `json:"tipo"` // hitos | catalogo | familias | dinamico
	Nota      string         `json:"nota,omitempty"`
	Fuente    string         `json:"fuente,omitempty"`
	Hitos     []HitoDef      `json:"hitos,omitempty"`
	Valores   []ValorFamilia `json:"valores,omitempty"`
	Conocidos []ItemCatalogo `json:"conocidos,omitempty"`
}

type SubMapa struct {
	Version string `json:"version"`
	Nota    string `json:"nota,omitempty"`
	Etapas  map[string]struct {
		Bloques []*BloqueDef `json:"bloques"`
	} `json:"etapas"`
}

// CargarSub lee el árbol declarado y compila las regex de los hitos.
func CargarSub() (*SubMapa, error) {
	b, err := mapaFS.ReadFile("mapa/substeps.json")
	if err != nil {
		return nil, err
	}
	var s SubMapa
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("mapa/substeps.json: %w", err)
	}
	for et, e := range s.Etapas {
		for _, bl := range e.Bloques {
			for i := range bl.Hitos {
				mt := bl.Hitos[i].Matcher
				if mt == nil || mt.Tipo != "regex" {
					continue
				}
				re, err := regexp.Compile(mt.Patron)
				if err != nil {
					return nil, fmt.Errorf("etapa %s, hito %s: regex %q no compila: %w", et, bl.Hitos[i].ID, mt.Patron, err)
				}
				mt.re = re
			}
		}
	}
	return &s, nil
}

// Bloques devuelve los bloques declarados de una etapa (vacío si no declara ninguno).
func (s *SubMapa) Bloques(etapa string) []*BloqueDef {
	if s == nil {
		return nil
	}
	return s.Etapas[etapa].Bloques
}

// ValidarSub comprueba la regla que hace consistente al árbol: **el matcher de un hito tiene que ser un
// subconjunto del de su etapa.** Si un hito captura una línea que su etapa no reclama, el árbol muestra un
// sub-paso colgando de una etapa que no lo tiene — y eso no lo nota nadie mirando la pantalla.
func (s *SubMapa) ValidarSub(m *Mapa, corpus []string) []string {
	var problemas []string
	for etapa, e := range s.Etapas {
		if _, ok := m.porEtapa[etapa]; !ok {
			problemas = append(problemas, fmt.Sprintf("substeps declara la etapa %q, que no existe en etapas.json", etapa))
			continue
		}
		for _, bl := range e.Bloques {
			for _, h := range bl.Hitos {
				if h.Matcher == nil {
					continue // los hitos sin matcher son deliberados (ej. `asesor`, que se infiere por ausencia)
				}
				if h.Matcher.Campo != "" {
					continue // igual que arriba: no validable contra mensajes crudos
				}
				capturaAlgo, fuera := false, 0
				for _, msg := range corpus {
					if !h.Matcher.coincide(msg, nil) {
						continue
					}
					capturaAlgo = true
					if dueno := m.EtapaDe(msg, nil); dueno != etapa {
						fuera++
					}
				}
				if !capturaAlgo {
					if h.SoloEnCodigo {
						continue // declarado desde el código, no medido: es esperado
					}
					problemas = append(problemas, fmt.Sprintf("hito %s/%s: el patrón %q no captura NADA del corpus",
						etapa, h.ID, h.Matcher.Patron))
				} else if fuera > 0 {
					problemas = append(problemas, fmt.Sprintf("hito %s/%s: captura %d mensaje(s) que su etapa NO reclama "+
						"(colgarían de la nada)", etapa, h.ID, fuera))
				}
			}
		}
	}
	sort.Strings(problemas)
	return problemas
}
