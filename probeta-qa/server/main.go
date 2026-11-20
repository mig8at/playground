// El servidor de Probeta: lo que la extensión Probeta-qa no puede hacer desde Chrome porque necesita la base de qa. Corre
// en la Mac de cada persona (`127.0.0.1:5230`) con las credenciales de su `.env`, y sólo le contesta a extensiones de
// Chrome. El contrato es el del README de probeta-qa:
//
//	GET  /api/health                → si llega a la base y si puede descifrar las centrales
//	GET  /api/person?doc=&phone=    → si la cédula y el celular están libres (sin cliente activo)
//	GET  /api/tables?ureq=          → las tablas de la solicitud y su cliente, con los nombres de los catálogos
//	GET  /api/decrypt?ureq=&id=     → la respuesta de una central, descifrada con el APP_KEY de qa
//	POST /api/identity {ureq,phone} → la identidad aprobada a mano (`users.manual_validation = 1`)
//
// LAS GUARDAS VIVEN ACÁ, no en la extensión: no arranca contra una base que no sea la de desarrollo (nunca prod), sólo
// descifra y aprueba clientes DE PRUEBA (por su correo) y sólo aprueba la solicitud del celular de la prueba. Todo lo
// demás es lectura.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Los clientes de prueba, por su correo: los que arman Probeta (`ext.prueba+…`), el harness y las pruebas a mano.
var testMail = regexp.MustCompile(`(?i)^(qa[\w.+-]*@gmail\.com|qa\.harness[\w.+-]*@creditop\.com|synth-[\w.+-]*@creditop\.com|miguel-test@creditop\.com|ext\.prueba[\w.+-]*@creditop\.com)$`)

// Las fotos de la cédula de un cliente aprobado a mano: una imagen sintética (un rectángulo gris) en el bucket público de
// dev. Sin ellas la formalización muere con «faltan documentos obligatorios»: el pdf-mapper de qa descarga cada URL.
const synthIDBase = "https://creditop-app-development-5yctskjv.s3.us-east-2.amazonaws.com/harness/synth"

type server struct {
	db     *sql.DB
	appKey []byte // nil si el `.env` no trae APP_KEY: entonces no se descifra
}

func main() {
	loadEnv()
	host := os.Getenv("PROBETA_DB_HOST")
	// ⚠ La guarda principal: sólo la base de desarrollo (la que comparten dev, qa y staging). Una dirección de producción
	// no arranca, aunque alguien la copie en el `.env`.
	if host == "" {
		log.Fatal("falta PROBETA_DB_HOST en el .env (mirá .env.example)")
	}
	if !strings.Contains(host, "development") || strings.Contains(strings.ToLower(host), "prod") {
		log.Fatalf("PROBETA_DB_HOST=%s no es la base de desarrollo: el servidor de Probeta sólo trabaja contra qa", host)
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?timeout=8s&readTimeout=20s&charset=utf8mb4",
		os.Getenv("PROBETA_DB_USER"), os.Getenv("PROBETA_DB_PASS"), host, envOr("PROBETA_DB_PORT", "3306"), envOr("PROBETA_DB_NAME", "creditop"))
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(6)
	db.SetConnMaxLifetime(5 * time.Minute)
	s := &server{db: db}
	if k := os.Getenv("PROBETA_APP_KEY"); k != "" {
		if s.appKey, err = laravelKey(k); err != nil {
			log.Printf("⚠ PROBETA_APP_KEY no sirve (%v): no se van a descifrar las centrales", err)
		}
	}
	addr := "127.0.0.1:" + envOr("PROBETA_PORT", "5230")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.health)
	mux.HandleFunc("/api/person", s.person)
	mux.HandleFunc("/api/tables", s.tables)
	mux.HandleFunc("/api/decrypt", s.decrypt)
	mux.HandleFunc("/api/identity", s.identity)
	log.Printf("servidor de Probeta en http://%s · base %s", addr, host)
	log.Fatal(http.ListenAndServe(addr, onlyExtensions(mux)))
}

// onlyExtensions: le contesta sólo a una extensión de Chrome (o a una consola sin `Origin`, como curl). Una página web
// cualquiera no puede leer la base de qa a través de este servidor.
func onlyExtensions(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !strings.HasPrefix(origin, "chrome-extension://") {
			http.Error(w, "sólo para la extensión", http.StatusForbidden)
			return
		}
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "content-type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func send(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func digits(s string) string { return regexp.MustCompile(`\D`).ReplaceAllString(s, "") }

// ── /api/health ──────────────────────────────────────────────────────────────────────────────────────────────────
func (s *server) health(w http.ResponseWriter, _ *http.Request) {
	type piece struct {
		Name   string `json:"name"`
		OK     bool   `json:"ok"`
		Detail string `json:"detail,omitempty"`
	}
	start := time.Now()
	var one int
	dbErr := s.db.QueryRow("SELECT 1").Scan(&one)
	pieces := []piece{{Name: "base de qa", OK: dbErr == nil}}
	if dbErr != nil {
		pieces[0].Detail = shortErr(dbErr) + " (¿VPN de dev? ¿credenciales del .env?)"
	} else {
		pieces[0].Detail = fmt.Sprintf("%d ms", time.Since(start).Milliseconds())
	}
	dec := piece{Name: "descifrar centrales"}
	switch {
	case s.appKey == nil:
		dec.Detail = "sin PROBETA_APP_KEY en el .env"
	case dbErr != nil:
		dec.Detail = "sin base"
	default:
		// El APP_KEY es el de qa si el MAC de una fila real valida.
		var payload string
		err := s.db.QueryRow("SELECT data FROM risk_central_user_data WHERE data IS NOT NULL AND data <> '' ORDER BY id DESC LIMIT 1").Scan(&payload)
		dec.OK = err == nil && verifyMAC(payload, s.appKey)
		if !dec.OK {
			dec.Detail = "el APP_KEY no es el de qa"
		}
	}
	pieces = append(pieces, dec)
	send(w, 200, map[string]any{"ok": dbErr == nil, "pieces": pieces})
}

// ── /api/person ──────────────────────────────────────────────────────────────────────────────────────────────────
func (s *server) person(w http.ResponseWriter, r *http.Request) {
	doc, phone := digits(r.URL.Query().Get("doc")), digits(r.URL.Query().Get("phone"))
	if len(doc) < 6 {
		send(w, 400, map[string]any{"error": "falta la cédula"})
		return
	}
	var name string
	err := s.db.QueryRow(`SELECT CONCAT(COALESCE(first_name,''), ' ', COALESCE(surname,'')) FROM users
		WHERE status = 1 AND (document_number = ? OR (? <> '' AND cell_phone = ?)) LIMIT 1`, doc, phone, phone).Scan(&name)
	if err == sql.ErrNoRows {
		send(w, 200, map[string]any{"free": true})
		return
	}
	if err != nil {
		send(w, 500, map[string]any{"error": shortErr(err)})
		return
	}
	send(w, 200, map[string]any{"free": false, "detail": "Ya hay cliente activo con esa cédula o ese celular: " + strings.TrimSpace(name)})
}

// ── /api/tables ──────────────────────────────────────────────────────────────────────────────────────────────────
// Las filas de UNA solicitud y su cliente, tabla por tabla: por la solicitud y su usuario, no por ventana de tiempo, así
// que en la base compartida no se cuela lo del equipo. Las credenciales del usuario no se leen; un texto enorme (la
// respuesta de una central) se corta en 40 KB.
var requestTables = []struct {
	table, where string
	byUser       bool
	limit        int
}{
	{"user_requests", "id = ?", false, 30},
	{"users", "id = ?", true, 30},
	{"user_request_records", "user_id = ?", true, 30},
	{"risk_central_user_data", "user_id = ?", true, 30},
	{"user_request_risk_central_user_data", "user_request_id = ?", false, 30},
	{"user_summaries", "user_id = ?", true, 30},
	{"user_field_values", "user_id = ?", true, 30},
	{"creditop_x_user_requests_records", "user_id = ?", true, 30},
	{"lender_transactions", "user_request_id = ?", false, 30},
	{"logs", "user_id = ?", true, 40},
}
var secretCol = regexp.MustCompile(`(?i)password|remember_token|secret|token$`)

// Los catálogos: para cada columna que apunta a uno, el nombre de cada valor que aparece (`11` → «Autorizada»).
var lookups = map[string]struct{ from, label, only string }{
	"user_request_status_id": {"user_request_statuses", "name", ""},
	"lender_id":              {"lenders", "name", ""},
	"risk_central_id":        {"risk_centrals", "name", ""},
	"creditop_x_user_requests_process_statuses_id": {"creditop_x_user_requests_process_statuses", "CONCAT(name, COALESCE(CONCAT(' · ', description), ''))", ""},
	"status_id":        {"lender_transaction_statuses", "name", "lender_transactions"},
	"field_id":         {"fields", "CONCAT(name, COALESCE(CONCAT(' · ', description), ''))", ""},
	"allied_branch_id": {"allied_branches", "name", ""},
	"credit_line_id":   {"credit_lines", "name", ""},
	"user_profile_id":  {"user_profiles", "name", ""},
}

type tableRows struct {
	Table string           `json:"table"`
	Rows  []map[string]any `json:"rows"`
	Error string           `json:"error,omitempty"`
}

func (s *server) tables(w http.ResponseWriter, r *http.Request) {
	ureq, _ := strconv.Atoi(digits(r.URL.Query().Get("ureq")))
	if ureq == 0 {
		send(w, 400, map[string]any{"error": "falta la solicitud"})
		return
	}
	var uid int
	if err := s.db.QueryRow("SELECT user_id FROM user_requests WHERE id = ?", ureq).Scan(&uid); err != nil {
		if err == sql.ErrNoRows {
			send(w, 200, map[string]any{"ureq": ureq, "user": nil, "tables": []tableRows{}})
		} else {
			send(w, 500, map[string]any{"error": shortErr(err)})
		}
		return
	}
	out := make([]tableRows, len(requestTables))
	done := make(chan struct{}, len(requestTables))
	for i, t := range requestTables {
		go func(i int) {
			defer func() { done <- struct{}{} }()
			p := ureq
			if t.byUser {
				p = uid
			}
			rows, err := queryRows(s.db, fmt.Sprintf("SELECT * FROM `%s` WHERE %s ORDER BY id DESC LIMIT %d", t.table, t.where, t.limit), p)
			out[i] = tableRows{Table: t.table, Rows: rows}
			if err != nil {
				out[i].Error = shortErr(err)
				out[i].Rows = []map[string]any{}
			}
		}(i)
	}
	for range requestTables {
		<-done
	}
	labels := map[string]map[string]string{}
	for col, l := range lookups {
		seen := map[string]bool{}
		var values []any
		for _, t := range out {
			if l.only != "" && t.Table != l.only {
				continue
			}
			for _, row := range t.Rows {
				if v, ok := row[col].(string); ok && regexp.MustCompile(`^\d+$`).MatchString(v) && !seen[v] {
					seen[v] = true
					values = append(values, v)
				}
			}
		}
		if len(values) == 0 {
			continue
		}
		q := fmt.Sprintf("SELECT id, %s AS label FROM `%s` WHERE id IN (%s)", l.label, l.from, strings.TrimSuffix(strings.Repeat("?,", len(values)), ","))
		found, err := queryRows(s.db, q, values...)
		if err != nil {
			continue // catálogo ausente en este ambiente
		}
		labels[col] = map[string]string{}
		for _, f := range found {
			id, _ := f["id"].(string)
			label, _ := f["label"].(string)
			if len(label) > 160 {
				label = label[:160]
			}
			labels[col][id] = label
		}
	}
	send(w, 200, map[string]any{"ureq": ureq, "user": uid, "tables": out, "labels": labels})
}

// queryRows devuelve cada fila como columna → texto (o nil). Las fechas llegan como texto de MySQL y los JSON enteros.
func queryRows(db *sql.DB, q string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	var out []map[string]any
	for rows.Next() {
		raw := make([]sql.RawBytes, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := map[string]any{}
		for i, c := range cols {
			if secretCol.MatchString(c) {
				continue
			}
			if raw[i] == nil {
				row[c] = nil
				continue
			}
			v := string(raw[i])
			if len(v) > 40000 {
				v = fmt.Sprintf("%s… (recortado: %d caracteres)", v[:40000], len(v))
			}
			row[c] = v
		}
		out = append(out, row)
	}
	if out == nil {
		out = []map[string]any{}
	}
	return out, rows.Err()
}

// ── /api/decrypt ─────────────────────────────────────────────────────────────────────────────────────────────────
// La `data` de una fila de `risk_central_user_data`, sólo si es del cliente de esa solicitud y el cliente es de prueba.
func (s *server) decrypt(w http.ResponseWriter, r *http.Request) {
	ureq, _ := strconv.Atoi(digits(r.URL.Query().Get("ureq")))
	id, _ := strconv.Atoi(digits(r.URL.Query().Get("id")))
	if ureq == 0 || id == 0 {
		send(w, 400, map[string]any{"ok": false, "detail": "falta la solicitud o la fila"})
		return
	}
	if s.appKey == nil {
		send(w, 409, map[string]any{"ok": false, "detail": "el servidor no tiene PROBETA_APP_KEY"})
		return
	}
	var data sql.NullString
	var central sql.NullString
	var mail sql.NullString
	err := s.db.QueryRow(`SELECT d.data, rc.name, u.email FROM risk_central_user_data d
		JOIN user_requests ur ON ur.user_id = d.user_id AND ur.id = ?
		JOIN users u ON u.id = d.user_id
		LEFT JOIN risk_centrals rc ON rc.id = d.risk_central_id
		WHERE d.id = ? LIMIT 1`, ureq, id).Scan(&data, &central, &mail)
	if err == sql.ErrNoRows {
		send(w, 409, map[string]any{"ok": false, "detail": fmt.Sprintf("la fila %d no es del cliente de la solicitud %d", id, ureq)})
		return
	}
	if err != nil {
		send(w, 500, map[string]any{"ok": false, "detail": shortErr(err)})
		return
	}
	if !testMail.MatchString(mail.String) {
		send(w, 409, map[string]any{"ok": false, "detail": fmt.Sprintf("el cliente de %d no parece de prueba (correo «%s»): no se descifra", ureq, mail.String)})
		return
	}
	if !data.Valid || data.String == "" {
		send(w, 200, map[string]any{"ok": true, "central": central.String, "plain": nil})
		return
	}
	plain, err := decryptLaravel(data.String, s.appKey)
	if err != nil {
		send(w, 409, map[string]any{"ok": false, "detail": "no se pudo descifrar: " + err.Error()})
		return
	}
	send(w, 200, map[string]any{"ok": true, "central": central.String, "plain": plain})
}

// ── /api/identity ────────────────────────────────────────────────────────────────────────────────────────────────
// LA IDENTIDAD APROBADA A MANO, como la deja el admin: la selfie no se puede hacer desde un Chrome de escritorio. Sólo si
// la solicitud es del celular de la prueba y su cliente es de prueba. Es un rodeo: no prueba que la validación real
// funcione. No se usa el botón del admin porque manda un WhatsApp real al celular del cliente.
func (s *server) identity(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		send(w, 405, map[string]any{"ok": false, "detail": "es POST"})
		return
	}
	var b struct {
		Ureq  any `json:"ureq"`
		Phone any `json:"phone"`
	}
	_ = json.NewDecoder(r.Body).Decode(&b)
	ureq, _ := strconv.Atoi(digits(fmt.Sprint(b.Ureq)))
	phone := digits(fmt.Sprint(b.Phone))
	if ureq == 0 || len(phone) < 10 {
		send(w, 400, map[string]any{"ok": false, "detail": "falta la solicitud o el celular de la prueba"})
		return
	}
	var uid int
	var doc, cell, mail sql.NullString
	err := s.db.QueryRow(`SELECT u.id, u.document_number, u.cell_phone, u.email FROM user_requests ur JOIN users u ON u.id = ur.user_id
		WHERE ur.id = ? LIMIT 1`, ureq).Scan(&uid, &doc, &cell, &mail)
	if err != nil {
		send(w, 409, map[string]any{"ok": false, "detail": fmt.Sprintf("no pude leer la solicitud %d (%s)", ureq, shortErr(err))})
		return
	}
	if digits(cell.String) != phone {
		send(w, 409, map[string]any{"ok": false, "detail": fmt.Sprintf("la solicitud %d no es del celular %s: no se aprueba", ureq, phone)})
		return
	}
	if !testMail.MatchString(mail.String) {
		send(w, 409, map[string]any{"ok": false, "detail": fmt.Sprintf("el cliente de %d no parece de prueba (correo «%s»): no se aprueba", ureq, mail.String)})
		return
	}
	res, err := s.db.Exec(`UPDATE users SET manual_validation = 1, last_validation = NOW(),
		front_url = COALESCE(NULLIF(front_url, ''), ?), back_url = COALESCE(NULLIF(back_url, ''), ?), updated_at = NOW()
		WHERE id = ?`, synthIDBase+"/cedula-frontal.png", synthIDBase+"/cedula-reverso.png", uid)
	if err != nil {
		send(w, 500, map[string]any{"ok": false, "detail": shortErr(err)})
		return
	}
	n, _ := res.RowsAffected()
	log.Printf("identidad aprobada a mano: solicitud %d, usuario %d", ureq, uid)
	send(w, 200, map[string]any{"ok": n > 0, "detail": fmt.Sprintf("identidad de %d aprobada a mano", ureq)})
}

func shortErr(err error) string {
	m := strings.SplitN(err.Error(), "\n", 2)[0]
	if len(m) > 160 {
		m = m[:160]
	}
	return m
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

// loadEnv lee `.env` de la carpeta actual y de la del ejecutable. Lo que ya está en el proceso gana.
func loadEnv() {
	paths := []string{".env"}
	if exe, err := os.Executable(); err == nil {
		paths = append(paths, strings.TrimSuffix(exe, "/"+lastPart(exe))+"/.env")
	}
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
				continue
			}
			k, v, _ := strings.Cut(line, "=")
			k, v = strings.TrimSpace(k), strings.Trim(strings.TrimSpace(v), `"'`)
			if os.Getenv(k) == "" {
				os.Setenv(k, v)
			}
		}
	}
}

func lastPart(p string) string { i := strings.LastIndex(p, "/"); return p[i+1:] }
