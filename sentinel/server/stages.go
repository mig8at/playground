package main

// LOS ERRORES POR ETAPA DEL RECORRIDO. Idea de Miguel (2026-11-26): poder decir «está fallando la identidad» o «está
// fallando el pagaré» y no sólo «legacy-backend tiene más errores». Cada línea de error de producción se ubica en una
// etapa del recorrido de una solicitud (OTP → datos personales → laborales → centrales → perfilamiento → entidad →
// identidad → firma → pagaré → cobro → equipo y desembolso) o en una transversal (ecommerce, app, administración,
// plataforma). Lo que no encaja queda en «sin etapa»: esa lista dice qué falta mapear, no se esconde.
//
// La etapa sale del ERROR, no del estado de la solicitud: medido el 26/11/2026, 21.175 de ~38.000 solicitudes del mes
// estaban en el estado 9 «Formulario de perfil», que no cambia en casi todo el asistente (OTP, datos, centrales,
// perfilamiento). El estado en que quedaron las solicitudes tocadas se muestra aparte, en el detalle (`stageDetail`).
//
// UNA sola fuente: `stageRules`. De ahí salen el clasificador en Go (`classifyStage`, el detalle y las pruebas) y la
// plantilla de Loki (`stageTemplate`) con la que la pasada cuenta por bloque de 5 minutos (`stage:<etapa>`, en
// fetch.go). `stages_test.go` comprueba que las dos clasifiquen igual cada mensaje conocido.
//
// ⚠ Muchos «errores» son desvíos esperados del flujo, registrados como error: ONB002 (usuario temporal, 11.089 en 7 días)
// y ONB004 (sin datos laborales) sólo mandan al cliente a la pantalla siguiente. Por eso una etapa se compara contra lo
// normal de ESA etapa, como un servicio: un volumen alto de base no es alerta.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	connlogs "creditop/my-tools/connectors/logs"
)

// Stage: una etapa, en el orden del recorrido.
type Stage struct {
	Key       string   `json:"key"`
	Label     string   `json:"label"`
	Journey   bool     `json:"journey"`   // del recorrido de la solicitud (no transversal)
	What      string   `json:"what"`      // qué cae acá, en una línea
	Providers []string `json:"providers"` // los proveedores externos (`out:`) de esta etapa
}

var stages = []Stage{
	{Key: "otp", Label: "OTP", Journey: true, What: "envío y validación del código por SMS o WhatsApp", Providers: []string{"otp_service", "messaging_service"}},
	{Key: "personal", Label: "Datos personales", Journey: true, What: "registro del cliente: documento, correo, celular duplicados, usuario temporal"},
	{Key: "labor", Label: "Datos laborales", Journey: true, What: "información laboral y formulario dinámico", Providers: []string{"form_service"}},
	{Key: "bureaus", Label: "Centrales de riesgo", Journey: true, What: "Ágil Data, Mareigua, TusDatos, Experian y el preprocesador", Providers: []string{"agildata", "mareigua", "tusdatos", "experian", "experian_open_customer_info"}},
	{Key: "profiling", Label: "Perfilamiento", Journey: true, What: "reglas duras y el perfilador", Providers: []string{"h2oapi", "new_profiler_ml"}},
	{Key: "lender", Label: "Consulta a la entidad", Journey: true, What: "preaprobación y cupo de cada entidad (pre-approvals, Welli, Meddipay, Prami, Bancolombia, CreditopX…)", Providers: []string{"pre_approvals", "welli", "meddipay", "prami", "bancolombia", "credifamilia_consumo"}},
	{Key: "identity", Label: "Validación de identidad", Journey: true, What: "ADO, Jumio y CrossCore", Providers: []string{"ado", "jumio", "crosscore"}},
	{Key: "signing", Label: "Firma de documentos", Journey: true, What: "generación y firma (Netco, pdf-mapper)", Providers: []string{"netco"}},
	{Key: "promissory", Label: "Pagaré", Journey: true, What: "Deceval", Providers: []string{"deceval"}},
	{Key: "payment", Label: "Cobro y cuota inicial", Journey: true, What: "Nequi, Wompi, fecha de pago y cambio de monto", Providers: []string{"wompi"}},
	{Key: "disbursement", Label: "Desembolso y equipo", Journey: true, What: "formalización, IMEI y bloqueo de equipos", Providers: []string{"merchant_gateways"}},
	{Key: "ecommerce", Label: "Ecommerce", What: "pedidos de tiendas y su aviso de vuelta", Providers: []string{"corbeta"}},
	{Key: "app", Label: "App de clientes", What: "customer, entitlement, salud financiera, mobile", Providers: []string{"entitlement_service"}},
	{Key: "admin", Label: "Administración", What: "backoffice, comercios, sucursales y asesores"},
	{Key: "http", Label: "Pedidos HTTP rechazados", What: "404, 405 y 429 que la app responde: escáneres que buscan archivos (.env, terraform.tfstate), webhooks frenados por límite, archivos viejos del panel"},
	{Key: "platform", Label: "Plataforma", What: "la base de datos, código roto (clases o columnas que no existen), procesos y tareas agendadas"},
	{Key: "other", Label: "Sin etapa", What: "lo que ninguna regla ubica: hay que mapearlo"},
}

// silentStages: las etapas que se ven pero no avisan (alerts.go): no son una falla del recorrido.
var silentStages = map[string]bool{"other": true, "http": true}

func stageByKey(key string) *Stage {
	for i := range stages {
		if stages[i].Key == key {
			return &stages[i]
		}
	}
	return nil
}

// stageRule: la PRIMERA que cumple decide. Cumple si el servicio coincide (vacío: cualquiera), el código coincide
// (vacío: cualquiera), si pide entidad la línea nombra una (`Lender`), y si hay palabras, el texto (en minúsculas)
// contiene alguna. El texto es el mensaje más la clase que falló y la URL del contexto, si las trae.
type stageRule struct {
	Stage   string
	Service string
	Code    string
	Lender  bool
	Any     []string
}

// stageFields: lo que se lee de una línea de error para ubicarla.
type stageFields struct {
	Service string // la etiqueta `service_name`
	Code    string // `context.error_code` (los ONB del onboarding)
	Lender  string // la etiqueta `lender` que legacy-backend pone en las llamadas a una entidad («bancolombia_bnpl»)
	Message string // `message` del JSON, `exception_message` de los servicios en Go, o la línea
	Context string // `context.controller` y `context.url`: la clase que falló y la página pedida
}

// stageRules: el orden importa. Lo transversal de la plataforma va primero (una columna que no existe es un despliegue
// roto, esté donde esté); después lo más específico (los códigos ONB y los proveedores) y al final lo genérico.
var stageRules = []stageRule{
	// Plataforma: la base y el código roto.
	{Stage: "platform", Any: []string{"sqlstate", "connection refused", "mysql server has gone away", "lock wait timeout", "call to undefined method",
		"class \"", "signaled with signal", "scheduled command", "[commands]", "must be of type", "cannot use object of type", "fallo backfill", "unknown column"}},

	// legacy-application registra cada pedido HTTP rechazado (un 404 de un escáner, un 429 de un webhook) con este
	// mensaje y nada más que lo ubique (va antes de las palabras: la URL de un 403 del panel dice «centrales-de-riesgo»): medido el 26/11/2026, 1.813 de 2.026 líneas sin etapa en 24 horas.
	{Stage: "http", Any: []string{"http_exception_rendering"}},

	// Los códigos del orquestador del onboarding (BancolombiaBnplController: ONB001 OTP, ONB002 datos personales,
	// ONB004 laborales, ONB005 validación de datos personales; ONB040, límite de intentos).
	{Stage: "otp", Code: "ONB001"},
	{Stage: "otp", Code: "ONB040"},
	{Stage: "personal", Code: "ONB002"},
	{Stage: "personal", Code: "ONB003"},
	{Stage: "labor", Code: "ONB004"},
	{Stage: "personal", Any: []string{"returning onb002", "storepersonalinfo", "document_duplicate", "ya está asociado a otro usuario", "ya esta registrado", "document_number unique", "temporal user"}},
	{Stage: "labor", Any: []string{"returning onb004", "laboral", "no field values found", "dynamic form schema"}},

	// Servicios que son de una sola etapa.
	{Stage: "otp", Service: "otp-service"},
	{Stage: "otp", Service: "messaging-service"},
	{Stage: "lender", Service: "preapprovals-service"},
	{Stage: "identity", Service: "identity-service"},
	{Stage: "app", Service: "customer-service"},
	{Stage: "app", Service: "entitlement-service"},
	{Stage: "app", Service: "financial-health-service"},
	{Stage: "app", Service: "access-service"},
	{Stage: "admin", Service: "merchant-api"},
	{Stage: "disbursement", Service: "merchant-gateways-service"},
	{Stage: "labor", Service: "form-service"},
	{Stage: "labor", Service: "onboarding-forms-service"},

	// Por el mensaje.
	{Stage: "otp", Any: []string{"otp", "registercellphone", "labsmobile", "whatsapp config", "code_invalid", "too_many_attempts", "rate limit exceeded", "rate_limit_exceeded", "messaging service", "message sent response", "code generation service"}},
	{Stage: "bureaus", Any: []string{"tusdatos", "agildata", "mareigua", "experian", "acierta", "risk central", "riskv2", "datacredito", "identity bureau", "pre-processor", "returning onb005",
		"coinciden ani", "fecha de expedicion", "fecha de expedición", "identification-type catalogue", "centrales de riesgo", "refreshburos", "checkifabletoomit", "flow a risk validation"}},
	{Stage: "profiling", Any: []string{"perfilamiento", "reglas duras", "lenderdatacreditorule", "lenderrulesservice", "profiler"}},
	{Stage: "identity", Any: []string{"ado.", " ado ", "adoservice", "ado_validation", "jumio", "crosscore", "identidad", "kycflow", "biometr"}},
	{Stage: "promissory", Any: []string{"deceval", "pagaré", "pagare", "promissory"}},
	{Stage: "signing", Any: []string{"netco", "firma de documentos", "signing", "pdf-mapper", "pdf_mapper"}},
	{Stage: "payment", Any: []string{"nequi", "wompi", "firma del evento no es valida", "estado pagable", "payment date", "cuota inicial", "update amount", "amountupdate", "monto es inferior"}},
	{Stage: "disbursement", Any: []string{"device_lock", "device-locking", "imei", "formalize", "desembolso", "disburs"}},
	{Stage: "lender", Lender: true},
	{Stage: "lender", Any: []string{"lenderservicefactory", "app\\actions\\lenders", "error al consultar", "error al validar cupo", "welli", "meddipay", "prami", "sistecr", "bancolombia", "credito365", "credifamilia",
		"getcreditlimitclient", "quota_check_error", "revolving_credit_sp_error", "integration credentials", "lendercredentialkey", "consumerloan", "cupo de credito vigente", "punto de venta", "intituci"}},
	{Stage: "ecommerce", Any: []string{"ecommerce"}},
	{Stage: "app", Any: []string{"orquestador de eliminacion", "mobile onboarding", "mobileonboarding", "mobilev1", "salud financiera", "terms and conditions", "revenuecat"}},
	{Stage: "admin", Any: []string{"admin.creditop.com", "backoffice", "alliedbranch", "allied.test_advisor", "settingsservice", "settingsrepository", "recordatorio creditopx"}},
}

// classifyStage: la etapa de una línea de error.
func classifyStage(f stageFields) string {
	m := strings.ToLower(f.Message + " " + f.Context)
	for _, r := range stageRules {
		if r.Service != "" && r.Service != f.Service {
			continue
		}
		if r.Code != "" && r.Code != f.Code {
			continue
		}
		if r.Lender && f.Lender == "" {
			continue
		}
		if len(r.Any) > 0 {
			hit := false
			for _, w := range r.Any {
				if strings.Contains(m, w) {
					hit = true
					break
				}
			}
			if !hit {
				continue
			}
		}
		return r.Stage
	}
	return "other"
}

// stageTemplate: `classifyStage` como plantilla de Loki (Go text/template con las funciones de Loki), para
// `label_format stage=…`. Lee `.service_name` (la etiqueta), `.code` (el `context.error_code` del JSON) y el mensaje:
// el `message` del JSON (los monolitos), el metadato `exception_message` (los servicios en Go) o la línea.
func stageTemplate() string {
	var b strings.Builder
	b.WriteString(`{{ $m := lower (printf "%s %s %s" (or .msg .exception_message __line__) .ctrl .url) }}`)
	for i, r := range stageRules {
		var conds []string
		if r.Service != "" {
			conds = append(conds, fmt.Sprintf(`(eq .service_name %q)`, r.Service))
		}
		if r.Code != "" {
			conds = append(conds, fmt.Sprintf(`(eq .code %q)`, r.Code))
		}
		if r.Lender {
			conds = append(conds, `(ne .lender "")`)
		}
		if len(r.Any) > 0 {
			var any []string
			for _, w := range r.Any {
				any = append(any, fmt.Sprintf(`(contains %q $m)`, w))
			}
			if len(any) == 1 {
				conds = append(conds, any[0])
			} else {
				conds = append(conds, "(or "+strings.Join(any, " ")+")")
			}
		}
		cond := conds[0]
		if len(conds) > 1 {
			cond = "(and " + strings.Join(conds, " ") + ")"
		}
		if i == 0 {
			b.WriteString("{{ if " + cond + " }}" + r.Stage)
		} else {
			b.WriteString("{{ else if " + cond + " }}" + r.Stage)
		}
	}
	b.WriteString("{{ else }}other{{ end }}")
	return b.String()
}

// stagePipeline: lo que extrae los campos y clasifica; lo usan el conteo de la pasada y el detalle.
func stagePipeline() string {
	return `{service_name=~".+"} | detected_level="error" | json msg="message", code="context.error_code", ureq="context.user_request_id", ctrl="context.controller", url="context.url" | drop __error__, __error_details__ | label_format stage=` +
		"`" + stageTemplate() + "`"
}

// stagesLogQL: el conteo por etapa, por bloque de 5 minutos.
func stagesLogQL() string {
	return `sum by (stage) (count_over_time(` + stagePipeline() + ` [5m]))`
}

// stagesNamedLogQL: por etapa, las líneas que nombran una solicitud (`context.user_request_id`).
func stagesNamedLogQL() string {
	return `sum by (stage) (count_over_time(` + stagePipeline() + ` | ureq!="" [5m]))`
}

// stagesDistinctLogQL: por etapa, cuántas solicitudes distintas nombran las líneas del bloque. Sumado bloque a bloque
// cuenta dos veces a quien reintenta en dos bloques seguidos: para la compuerta eso es conservador (baja menos alertas).
func stagesDistinctLogQL() string {
	return `count by (stage) (sum by (stage, ureq) (count_over_time(` + stagePipeline() + ` | ureq!="" [5m])))`
}

// stageMinRequests: una etapa cuyas líneas nombran la solicitud sólo es ALERTA si toca al menos tantas distintas.
// El 22/11/2026 el pagaré dio alerta con 20 errores contra 0: eran 20 reintentos de UNA solicitud (la 637606, un cupo
// rotativo sin número de contrato), en poco más de un minuto. Era un caso trabado, no una caída: queda «para mirar».
const stageMinRequests = 3

// stageGate: si la mayoría de las líneas nombran una solicitud y tocan menos de `stageMinRequests`, la alerta baja a
// «para mirar»; y el porqué dice cuántas toca. Las etapas cuyas líneas no la nombran (las centrales traen el usuario)
// siguen por líneas.
func stageGate(ev *Eval, named, distinct int) {
	if named == 0 || ev.Now == 0 {
		return
	}
	ev.Why += fmt.Sprintf(" · tocan %d %s", distinct, plural(distinct, "solicitud", "solicitudes"))
	if ev.Level == levelAlert && named*2 >= ev.Now && distinct < stageMinRequests {
		ev.Level = levelWarn
		ev.Why += fmt.Sprintf(" (menos de %d: un caso trabado o alguien reintentando, no una caída)", stageMinRequests)
	}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

func stageSignalOf(m map[string]string) Signal {
	if stageByKey(m["stage"]) == nil {
		return ""
	}
	return "stage:" + m["stage"]
}

// stageOrder: la posición de una etapa en el recorrido (para ordenar `stage:<etapa>`).
func stageOrder(sig Signal) int {
	key := strings.TrimPrefix(sig, "stage:")
	for i, s := range stages {
		if s.Key == key {
			return i
		}
	}
	return len(stages)
}

func stageName(key string) string {
	if st := stageByKey(key); st != nil {
		return st.Label
	}
	return key
}

// ── el detalle de una etapa, a pedido ────────────────────────────────────────────────────────────────────────────

// StageMessage: un mensaje (normalizado) de la etapa en la ventana.
type StageMessage struct {
	Service string `json:"service"`
	Text    string `json:"text"`
	Code    string `json:"code,omitempty"`
	Count   int    `json:"count"`
	Sample  string `json:"sample"`
}

// StageStatus: cuántas de las solicitudes tocadas están hoy en cada estado.
type StageStatus struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// StageDetail: lo que pasó en una etapa en la ventana.
type StageDetail struct {
	Stage     Stage          `json:"stage"`
	From      string         `json:"from"`
	To        string         `json:"to"`
	Lines     int            `json:"lines"`     // líneas leídas de la etapa (hasta el tope)
	Capped    bool           `json:"capped"`    // si llegó al tope de lectura: los conteos son de las últimas
	Requests  int            `json:"requests"`  // solicitudes distintas que nombran las líneas
	Named     int            `json:"named"`     // líneas que nombran una solicitud
	Messages  []StageMessage `json:"messages"`  // de la más repetida a la menos
	Statuses  []StageStatus  `json:"statuses"`  // en qué estado están hoy las solicitudes tocadas
	Examples  []int          `json:"examples"`  // hasta 8 solicitudes, la más reciente primero
	TracerURL string         `json:"tracerURL"` // dónde se abre una solicitud (con el número al final)
	Note      string         `json:"note,omitempty"`
}

const stageDetailLimit = 5000

var reStageLine = regexp.MustCompile(`^([^\t]*)\t([^\t]*)\t([^\t]*)\t(.*)$`)

// stageDetail: lee de Loki las líneas de la etapa en [from, to) (hasta `stageDetailLimit`, las más recientes) y, de
// producción, el estado de hoy de las solicitudes que nombran. Sólo lectura; sin datos de la persona.
func stageDetail(key string, from, to time.Time) (*StageDetail, error) {
	st := stageByKey(key)
	if st == nil {
		return nil, fmt.Errorf("no conozco la etapa «%s»: %s", key, stageKeys())
	}
	out := &StageDetail{Stage: *st, From: from.Format(time.RFC3339), To: to.Format(time.RFC3339), Messages: []StageMessage{}, Statuses: []StageStatus{}, Examples: []int{}, TracerURL: tracerURL}
	cl, err := lokiClient()
	if err != nil {
		return nil, err
	}
	q := stagePipeline() + fmt.Sprintf(` | stage=%q | line_format "{{ .service_name }}\t{{ .code }}\t{{ .ureq }}\t{{ or .msg .exception_message __line__ | trunc 300 }}"`, key)
	status, body, err := cl.API("query_range", url.Values{"query": {q}, "start": {fmt.Sprint(from.UnixNano())}, "end": {fmt.Sprint(to.UnixNano())},
		"limit": {strconv.Itoa(stageDetailLimit)}, "direction": {"backward"}})
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("Loki contestó %d: %s", status, connlogs.Explain(status, body))
	}
	var res struct {
		Data struct {
			Result []struct {
				Values [][2]string `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return nil, fmt.Errorf("la respuesta de Loki no se pudo leer: %w", err)
	}
	type hit struct {
		at   int64
		ureq int
	}
	msgs := map[string]*StageMessage{}
	var hits []hit
	ureqs := map[int]bool{}
	for _, s := range res.Data.Result {
		for _, v := range s.Values {
			out.Lines++
			m := reStageLine.FindStringSubmatch(v[1])
			if m == nil {
				continue
			}
			text := normalizeMessage(m[4])
			k := m[1] + "\x00" + text
			if msgs[k] == nil {
				msgs[k] = &StageMessage{Service: m[1], Text: text, Code: m[2], Sample: m[4]}
			}
			msgs[k].Count++
			if id, err := strconv.Atoi(strings.TrimSpace(m[3])); err == nil && id > 0 {
				out.Named++
				ureqs[id] = true
				ns, _ := strconv.ParseInt(v[0], 10, 64)
				hits = append(hits, hit{ns, id})
			}
		}
	}
	out.Capped = out.Lines >= stageDetailLimit
	out.Requests = len(ureqs)
	for _, m := range msgs {
		out.Messages = append(out.Messages, *m)
	}
	sort.Slice(out.Messages, func(i, j int) bool { return out.Messages[i].Count > out.Messages[j].Count })
	if len(out.Messages) > 15 {
		out.Messages = out.Messages[:15]
	}
	sort.Slice(hits, func(i, j int) bool { return hits[i].at > hits[j].at })
	seen := map[int]bool{}
	for _, h := range hits {
		if !seen[h.ureq] && len(out.Examples) < 8 {
			seen[h.ureq] = true
			out.Examples = append(out.Examples, h.ureq)
		}
	}
	if len(ureqs) > 0 {
		if err := out.readStatuses(ureqs); err != nil {
			out.Note = "sin el estado de las solicitudes: " + err.Error()
		}
	}
	return out, nil
}

// readStatuses: el estado de hoy de las solicitudes tocadas, de a 500 ids por consulta.
func (d *StageDetail) readStatuses(ureqs map[int]bool) error {
	r, err := openReader()
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(ureqs))
	for id := range ureqs {
		ids = append(ids, strconv.Itoa(id))
	}
	counts := map[int]*StageStatus{}
	for len(ids) > 0 {
		n := min(500, len(ids))
		rows, err := r.rows(fmt.Sprintf(`SELECT s.id AS id, s.name AS name, COUNT(*) AS n FROM user_requests u
JOIN user_request_statuses s ON s.id = u.user_request_status_id WHERE u.id IN (%s) GROUP BY s.id, s.name`, strings.Join(ids[:n], ",")))
		if err != nil {
			return err
		}
		for _, row := range rows {
			id := num(row["id"])
			if counts[id] == nil {
				counts[id] = &StageStatus{ID: id, Name: fmt.Sprint(row["name"])}
			}
			counts[id].Count += num(row["n"])
		}
		ids = ids[n:]
	}
	for _, c := range counts {
		d.Statuses = append(d.Statuses, *c)
	}
	sort.Slice(d.Statuses, func(i, j int) bool { return d.Statuses[i].Count > d.Statuses[j].Count })
	return nil
}

func stageKeys() string {
	keys := make([]string, len(stages))
	for i, s := range stages {
		keys[i] = s.Key
	}
	return strings.Join(keys, ", ")
}

// Text: el detalle de una etapa para la consola.
func (d *StageDetail) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s · de %s a %s\n%s\n\n", d.Stage.Label, clockOf(d.From), clockOf(d.To), d.Stage.What)
	fmt.Fprintf(&b, "%d líneas de error", d.Lines)
	if d.Capped {
		fmt.Fprintf(&b, " (llegó al tope: son las %d más recientes)", stageDetailLimit)
	}
	fmt.Fprintf(&b, "; %d nombran una solicitud (%d distintas).\n", d.Named, d.Requests)
	if len(d.Statuses) > 0 {
		b.WriteString("\nEn qué estado están hoy las solicitudes tocadas:\n")
		for _, s := range d.Statuses {
			fmt.Fprintf(&b, "  %5d  %d · %s\n", s.Count, s.ID, s.Name)
		}
	}
	b.WriteString("\nLos mensajes:\n")
	for _, m := range d.Messages {
		code := ""
		if m.Code != "" {
			code = " [" + m.Code + "]"
		}
		fmt.Fprintf(&b, "  %5d  %s%s · %s\n", m.Count, m.Service, code, m.Text)
	}
	if len(d.Examples) > 0 {
		ex := make([]string, len(d.Examples))
		for i, id := range d.Examples {
			ex[i] = strconv.Itoa(id)
		}
		fmt.Fprintf(&b, "\nSolicitudes de ejemplo: %s (bin/pg request timeline --target prod --ureq N)\n", strings.Join(ex, ", "))
	}
	if d.Note != "" {
		fmt.Fprintf(&b, "\n%s\n", d.Note)
	}
	return b.String()
}

// StagesReport: todas las etapas, de lo guardado, contra lo normal (`bin/sentinel stages`).
type StagesReport struct {
	At        string    `json:"at"`
	Freshness string    `json:"freshness,omitempty"`
	List      []Subject `json:"list"`
	Stages    []Stage   `json:"stages"`
}

func (r *StagesReport) Text() string {
	var b strings.Builder
	if r.Freshness != "" {
		fmt.Fprintf(&b, "%s\n", r.Freshness)
	}
	fmt.Fprintf(&b, "Errores por etapa del recorrido · guardado hasta las %s\n\n", clockOf(r.At))
	by := map[string]Subject{}
	for _, s := range r.List {
		by[strings.TrimPrefix(s.Signal, "stage:")] = s
	}
	mark := map[string]string{"alert": "✗", "warn": "!", "ok": "·", "quiet": " "}
	journey := true
	for _, st := range r.Stages {
		if journey && !st.Journey {
			b.WriteString("\n  Transversales\n")
			journey = false
		}
		s, ok := by[st.Key]
		if !ok {
			fmt.Fprintf(&b, "    %-24s sin errores guardados\n", st.Label)
			continue
		}
		fmt.Fprintf(&b, "  %s %-24s %5d en %s · lo normal %s\n", mark[s.State], st.Label, s.Now.Total, windowLabel(s.WindowMinutes), fmtNum(s.Median))
	}
	b.WriteString("\nEl detalle de una (mensajes, solicitudes tocadas y en qué estado quedaron): bin/sentinel stages <etapa> [--hours N]\n")
	b.WriteString("Etapas: " + stageKeys() + "\n")
	return b.String()
}

func windowLabel(minutes int) string {
	if minutes <= 60 {
		return "la última hora"
	}
	return fmt.Sprintf("las últimas %d horas", minutes/60)
}
