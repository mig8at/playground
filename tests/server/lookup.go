package main

/* Lo que tests dice de UNA solicitud: de qué comercio y sucursal viene, qué mandó la tienda, a qué usuario
 * quedó pegada y con qué datos, y por qué estados pasó. Todo es lectura por el conector (`connectors/sql`),
 * con `ValidateReadOnly` antes de cada consulta.
 *
 * Se pide cada columna por nombre, a propósito: `users` guarda la contraseña y los tokens, y
 * `ecommerce_requests` la referencia del checkout y la firma del webhook. Un `SELECT *` los mandaría al
 * navegador. */

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	dbsql "creditop/playground/connectors/sql"
)

// Targets son los ambientes que mira tests. `qa` lee la base compartida de dev, qa y staging.
var Targets = []string{"local", "qa"}

// Input es lo que se pegó, ya separado.
type Input struct {
	Request int    `json:"request,omitempty"`
	Hash    string `json:"hash,omitempty"`
	Phone   string `json:"phone,omitempty"` // los 10 dígitos, sin indicativo
}

// La URL del wizard: …/ecommerce/<sucursal>/<solicitud>/… (también la del asesor, /<sucursal>/<solicitud>).
var (
	reURL    = regexp.MustCompile(`/([0-9a-f]{8})/(\d{3,})(?:/|$|\?|#)`)
	reNumber = regexp.MustCompile(`^\s*(\d{3,})\s*$`)
	// Un celular como se copia: con espacios, guiones, paréntesis o el +57 adelante.
	rePhone = regexp.MustCompile(`^\+?[\d\s().-]{10,18}$`)
)

// ParseInput acepta el celular (lo que se pide), la URL completa del wizard o el número de solicitud.
// Un celular de Colombia son 10 dígitos que empiezan con 3, con o sin el 57 adelante; una solicitud tiene
// menos de 10 dígitos. Así no se confunden.
func ParseInput(raw string) (Input, error) {
	raw = strings.TrimSpace(raw)
	if rePhone.MatchString(raw) {
		d := onlyDigits(raw)
		if len(d) == 12 && strings.HasPrefix(d, "57") {
			d = d[2:]
		}
		if len(d) == 10 && strings.HasPrefix(d, "3") {
			return Input{Phone: d}, nil
		}
	}
	if m := reNumber.FindStringSubmatch(raw); m != nil && len(m[1]) < 10 {
		n, _ := strconv.Atoi(m[1])
		return Input{Request: n}, nil
	}
	if m := reURL.FindStringSubmatch(raw); m != nil {
		n, _ := strconv.Atoi(m[2])
		return Input{Request: n, Hash: m[1]}, nil
	}
	return Input{}, fmt.Errorf("no reconozco %q: escribí el celular (10 dígitos, como 3016992677), o pegá la URL del wizard o el número de la solicitud", raw)
}

// Warning es algo que no cuadra y que conviene ver primero.
type Warning struct {
	Level string `json:"level"` // warn · info
	Text  string `json:"text"`
}

// Result es la respuesta entera de una búsqueda.
type Result struct {
	Target string `json:"target"`
	Source string `json:"source"`
	Input  Input  `json:"input"`
	// Con búsqueda por celular: todas las solicitudes de los usuarios con ese número, de la más nueva a la
	// más vieja. La que se muestra es la pedida o, si no se pidió una, la más nueva.
	PhoneRequests []dbsql.Row `json:"phoneRequests"`
	Request       dbsql.Row   `json:"request"`
	Branch        dbsql.Row   `json:"branch"`
	Order         dbsql.Row   `json:"order"`
	OrderData     any         `json:"orderData"`
	User          dbsql.Row   `json:"user"`
	SamePhone     []dbsql.Row `json:"samePhone"`
	Records       []dbsql.Row `json:"records"`
	Requests      []dbsql.Row `json:"requests"`
	Fields        []dbsql.Row `json:"fields"`
	Warnings      []Warning   `json:"warnings"`
	ReadAt        string      `json:"readAt"`
}

// Una fuente por ambiente, abierta la primera vez y reusada: cada búsqueda son ocho consultas.
var (
	sourcesMu sync.Mutex
	sources   = map[string]dbsql.Source{}
)

func source(target string) (dbsql.Source, error) {
	sourcesMu.Lock()
	defer sourcesMu.Unlock()
	if s, ok := sources[target]; ok {
		return s, nil
	}
	cfg, _, err := dbsql.LoadConfig(target)
	if err != nil {
		return nil, err
	}
	cfg.MaxOpen = 4
	s, err := dbsql.Open(cfg)
	if err != nil {
		return nil, fmt.Errorf("base de %s: %w", target, err)
	}
	sources[target] = s
	return s, nil
}

// forget cierra la fuente de un ambiente después de un error de red, para que la próxima la reabra.
func forget(target string) {
	sourcesMu.Lock()
	defer sourcesMu.Unlock()
	if s, ok := sources[target]; ok {
		s.Close()
		delete(sources, target)
	}
}

func rows(src dbsql.Source, query string, args ...any) ([]dbsql.Row, error) {
	if err := dbsql.ValidateReadOnly(query); err != nil {
		return nil, err
	}
	out, err := src.Rows(query, args...)
	if out == nil {
		out = []dbsql.Row{} // una lista vacía, no null: la interfaz la recorre igual
	}
	for _, r := range out {
		for k, v := range r {
			// La fecha va como la guarda la base (reloj de pared): la zona varía por fila (F-241).
			if t, ok := v.(time.Time); ok {
				r[k] = t.Format("2006-01-02 15:04:05")
			}
		}
	}
	return out, err
}

func first(src dbsql.Source, query string, args ...any) (dbsql.Row, error) {
	out, err := rows(src, query, args...)
	if err != nil || len(out) == 0 {
		return nil, err
	}
	return out[0], nil
}

func cell(r dbsql.Row, k string) string {
	if r == nil || r[k] == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(r[k]))
}

// Lookup arma el Result de una solicitud en un ambiente.
func Lookup(target string, in Input) (*Result, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	res, err := lookup(src, target, in)
	if err != nil && strings.Contains(err.Error(), "connection") {
		forget(target)
	}
	return res, err
}

func lookup(src dbsql.Source, target string, in Input) (*Result, error) {
	res := &Result{Target: target, Source: src.Name(), Input: in, Warnings: []Warning{}, SamePhone: []dbsql.Row{},
		Records: []dbsql.Row{}, Requests: []dbsql.Row{}, Fields: []dbsql.Row{}, PhoneRequests: []dbsql.Row{},
		ReadAt: time.Now().Format("2006-01-02 15:04:05")}
	var err error

	if in.Phone != "" {
		// Por cómo termina: el celular se guarda con y sin indicativo (+573016992677). Activos o dados de baja.
		res.PhoneRequests, err = rows(src, `SELECT q.id, q.user_id, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.surname, ''))) AS user,
				u.status AS user_status, q.user_request_status_id AS status_id, s.name AS status, a.name AS allied, b.hash, q.amount, q.created_at
			FROM user_requests q JOIN users u ON u.id = q.user_id LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id
			LEFT JOIN allieds a ON a.id = q.allied_id LEFT JOIN allied_branches b ON b.id = q.allied_branch_id
			WHERE u.cell_phone LIKE CONCAT('%', ?) ORDER BY q.id DESC LIMIT 50`, in.Phone)
		if err != nil {
			return nil, fmt.Errorf("solicitudes del celular: %w", err)
		}
		if len(res.PhoneRequests) == 0 {
			return nil, fmt.Errorf("ningún usuario con el celular %s tiene solicitudes en %s", in.Phone, target)
		}
		picked := false
		for _, q := range res.PhoneRequests {
			if cell(q, "id") == strconv.Itoa(in.Request) {
				picked = true
			}
		}
		if !picked {
			in.Request, _ = strconv.Atoi(cell(res.PhoneRequests[0], "id"))
			res.Input = in
		}
	}

	res.Request, err = first(src, `SELECT q.id, q.user_id, q.allied_id, q.allied_branch_id, q.lender_id, l.name AS lender,
			q.user_request_status_id AS status_id, s.name AS status, q.flow_id, q.amount, q.purchase_amount, q.final_amount,
			q.initial_fee, q.fee_number, q.fee_value, q.self_management, q.is_test, q.disbursed_at, q.created_at, q.updated_at
		FROM user_requests q LEFT JOIN lenders l ON l.id = q.lender_id
		LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id WHERE q.id = ?`, in.Request)
	if err != nil {
		return nil, fmt.Errorf("solicitud: %w", err)
	}
	if res.Request == nil {
		return nil, fmt.Errorf("no existe la solicitud %d en %s", in.Request, target)
	}

	res.Branch, err = first(src, `SELECT b.id, b.hash, b.name, b.address, b.status, b.allied_id, a.name AS allied
		FROM allied_branches b LEFT JOIN allieds a ON a.id = b.allied_id WHERE b.id = ?`, cell(res.Request, "allied_branch_id"))
	if err != nil {
		return nil, fmt.Errorf("sucursal: %w", err)
	}

	// El pedido: por el vínculo (el que usa el wizard) o, si no hay, por la columna directa.
	res.Order, err = first(src, `SELECT er.id, er.ecommerce_id, e.name AS platform, er.allied_branch_id, b.hash AS branch_hash,
			b.name AS branch_name, er.origin, er.order_key, er.order_identifier, er.data, er.products, er.return_url,
			er.checkout_reference IS NOT NULL AS has_reference, er.reference_expires_at, er.reference_used_at,
			er.processed, er.user_id, er.created_at, er.updated_at
		FROM ecommerce_requests er LEFT JOIN ecommerces e ON e.id = er.ecommerce_id
		LEFT JOIN allied_branches b ON b.id = er.allied_branch_id
		WHERE er.id IN (SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id = ?)
		   OR er.user_request_id = ?
		ORDER BY er.id DESC LIMIT 1`, in.Request, in.Request)
	if err != nil {
		return nil, fmt.Errorf("pedido de la tienda: %w", err)
	}
	if raw := cell(res.Order, "data"); raw != "" {
		res.OrderData = parseJSON(raw)
	}

	res.User, err = first(src, `SELECT id, first_name, surname, full_name, document_type, document_number, email, cell_phone,
			date_of_birth, expedition_date, gender, age, status, user_profile_id, is_test, test_reason, validated,
			manual_validation, cellphone_validation, onboarding_channel, onboarding_backend, country_id, cognito_id,
			last_validation, created_at, updated_at
		FROM users WHERE id = ?`, cell(res.Request, "user_id"))
	if err != nil {
		return nil, fmt.Errorf("usuario: %w", err)
	}

	// Por cómo termina: el celular se guarda con y sin indicativo.
	if phone := onlyDigits(cell(res.User, "cell_phone")); len(phone) >= 7 {
		res.SamePhone, err = rows(src, `SELECT id, first_name, surname, document_number, email, is_test, created_at
			FROM users WHERE cell_phone LIKE CONCAT('%', ?) AND status = 1 AND id <> ? ORDER BY id DESC LIMIT 10`, lastN(phone, 10), cell(res.User, "id"))
		if err != nil {
			return nil, fmt.Errorf("mismo celular: %w", err)
		}
	}

	// `update_by` es quien movió el estado: un asesor, un usuario del admin o el propio cliente.
	res.Records, err = rows(src, `SELECT r.id, r.created_at, r.user_request_status_id AS status_id, s.name AS status, r.update_by,
			u.user_profile_id AS by_profile, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.surname, ''))) AS by_name,
			LEFT(r.comment, 160) AS comment
		FROM user_request_records r LEFT JOIN user_request_statuses s ON s.id = r.user_request_status_id
		LEFT JOIN users u ON u.id = r.update_by WHERE r.user_request_id = ? ORDER BY r.id`, in.Request)
	if err != nil {
		return nil, fmt.Errorf("estados: %w", err)
	}

	if uid := cell(res.Request, "user_id"); uid != "" {
		res.Requests, err = rows(src, `SELECT q.id, q.user_request_status_id AS status_id, s.name AS status, q.allied_branch_id,
				b.hash, q.amount, q.created_at
			FROM user_requests q LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id
			LEFT JOIN allied_branches b ON b.id = q.allied_branch_id
			WHERE q.user_id = ? ORDER BY q.id DESC LIMIT 15`, uid)
		if err != nil {
			return nil, fmt.Errorf("otras solicitudes: %w", err)
		}
		// El último valor de cada campo del perfil (situación laboral, ingreso, …), como `pg client fields`.
		res.Fields, err = rows(src, `SELECT v.field_id, f.name AS field, LEFT(v.value, 120) AS value, v.user_request_id, v.updated_at
			FROM user_field_values v JOIN fields f ON f.id = v.field_id
			WHERE v.user_id = ? AND v.id IN (SELECT MAX(id) FROM user_field_values WHERE user_id = ? GROUP BY field_id)
			ORDER BY v.field_id`, uid, uid)
		if err != nil {
			return nil, fmt.Errorf("campos del perfil: %w", err)
		}
	}

	res.Warnings = warnings(res)
	return res, nil
}

// warnings dice lo que no cuadra entre lo que mandó la tienda, la URL y el usuario que quedó.
func warnings(r *Result) []Warning {
	out := []Warning{}
	add := func(level, format string, a ...any) { out = append(out, Warning{level, fmt.Sprintf(format, a...)}) }

	if r.Input.Hash != "" && r.Branch != nil && cell(r.Branch, "hash") != r.Input.Hash {
		add("warn", "la URL dice la sucursal %s, pero la solicitud está en %s", r.Input.Hash, cell(r.Branch, "hash"))
	}
	if n := len(r.Records); n > 0 && cell(r.Records[n-1], "status_id") != cell(r.Request, "status_id") {
		add("info", "el estado actual (%s «%s») no está en el historial, que termina en %s: lo cambió algo que no deja registro, como el simulador o un UPDATE",
			cell(r.Request, "status_id"), cell(r.Request, "status"), cell(r.Records[n-1], "status_id"))
	}
	if r.Order == nil {
		add("info", "la solicitud no tiene pedido de ecommerce: no entró por una tienda")
	}
	if r.User == nil {
		add("warn", "la solicitud no tiene usuario (user_id %s)", cell(r.Request, "user_id"))
		return out
	}
	if n := len(r.SamePhone); n > 0 {
		add("warn", "el celular %s lo tienen %d usuario(s) activo(s) más: el OTP pega la solicitud a uno de ellos", cell(r.User, "cell_phone"), n)
	}
	if cell(r.User, "is_test") == "1" && strings.HasPrefix(cell(r.User, "test_reason"), "renacido") {
		add("info", "el usuario es un cliente de prueba renacido: %s", cell(r.User, "test_reason"))
	}

	billing, _ := mapAt(r.OrderData, "billing")
	if billing == nil {
		return out
	}
	shopName := strings.TrimSpace(str(billing["first_name"]) + " " + str(billing["last_name"]))
	userName := cell(r.User, "full_name")
	if userName == "" {
		userName = strings.TrimSpace(cell(r.User, "first_name") + " " + cell(r.User, "surname"))
	}
	if shopName != "" && userName != "" && !sameName(shopName, userName) {
		add("warn", "la tienda mandó «%s» y la solicitud quedó en el usuario «%s»", shopName, userName)
	}
	if e := strings.ToLower(str(billing["email"])); e != "" && !strings.EqualFold(e, cell(r.User, "email")) {
		add("warn", "la tienda mandó el correo %s y el usuario tiene %s", e, orDash(cell(r.User, "email")))
	}
	if p := onlyDigits(str(billing["phone"])); p != "" && !strings.HasSuffix(onlyDigits(cell(r.User, "cell_phone")), lastN(p, 10)) {
		add("warn", "la tienda mandó el celular %s y el usuario tiene %s", p, orDash(cell(r.User, "cell_phone")))
	}
	if d := onlyDigits(str(billing["document_number"])); d != "" && !strings.HasPrefix(cell(r.User, "document_number"), d) {
		add("warn", "la tienda mandó la cédula %s y el usuario tiene %s", d, orDash(cell(r.User, "document_number")))
	}
	return out
}

// sameName compara sin mayúsculas ni tildes, y alcanza con que una lista de palabras contenga a la otra
// («Miguel Ochoa» contra «MIGUEL ANGEL OCHOA TORRES»).
func sameName(a, b string) bool {
	wa, wb := words(a), words(b)
	if len(wa) > len(wb) {
		wa, wb = wb, wa
	}
	set := map[string]bool{}
	for _, w := range wb {
		set[w] = true
	}
	for _, w := range wa {
		if !set[w] {
			return false
		}
	}
	return len(wa) > 0
}

// Las tildes del español, que es lo que llega en los nombres.
var stripMarks = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "ü", "u", "ñ", "n")

func words(s string) []string {
	return strings.Fields(stripMarks.Replace(strings.ToLower(s)))
}

func validTarget(t string) bool {
	for _, x := range Targets {
		if x == t {
			return true
		}
	}
	return false
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func lastN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

func str(v any) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

func mapAt(v any, key string) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, false
	}
	sub, ok := m[key].(map[string]any)
	return sub, ok
}
