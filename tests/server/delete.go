package main

/* Borrar de verdad una solicitud de prueba —o todas las de un celular— y todo lo que cuelga de ella.
 *
 * Es la ÚNICA escritura de tests, y por eso no pasa por el conector de SQL (que es de sólo lectura): usa la
 * base del harness (`E2E_DB_*` de `harness/.env.<target>`), la misma excepción que ya tiene el harness para
 * sembrar. Y lleva las mismas guardas que él, más las propias:
 *
 *   · sólo local y qa; qa sólo si el proceso trae I_KNOW_THIS_TOUCHES_SHARED_DEV=1 exportado a mano (F-53:
 *     escrito en un .env desarma la guarda, así que acá se lee SÓLO del proceso);
 *   · sólo solicitudes de prueba: las de un comercio «PRUEBA AUTO…» o de un usuario marcado de prueba. Las
 *     demás se listan como protegidas y no se tocan;
 *   · un tope de solicitudes por borrado, y la confirmación escrita (el número o el celular), que se vuelve a
 *     comprobar en el servidor;
 *   · todo en UNA transacción: si una tabla falla, no se borra nada.
 *
 * Para empezar un flujo DE CERO con el mismo celular no alcanza con borrar las solicitudes: el OTP pega la
 * próxima al usuario que ya tiene ese número. Por eso, con el celular, se puede además dar de BAJA a sus
 * usuarios, igual que la papelera del admin (`UserController@disableUser` de legacy-application): status 0,
 * la cédula con -t<n> y sin correo ni celular. El usuario no se borra: queda la fila, como en el admin. Sólo
 * clientes (perfil 1) y, en la base compartida, marcados de prueba.
 *
 * «Lo que cuelga» se descubre en cada base, no se escribe a mano: toda tabla con la columna
 * `user_request_id` (69 en qa y 74 en local el 2026-10-26), más el pedido de la tienda unido por
 * `user_requests_by_ecommerce_request` y los `device_locks` de sus productos. Los nietos con llave foránea en
 * cascada los borra la base; uno sin cascada hace fallar la transacción y lo dice.
 *
 * ⚠ En la base compartida se borra POR LLAVE PRIMARIA: primero se leen los ids de cada tabla (una lectura no
 * bloquea) y después se borran por id. Un `DELETE … WHERE user_request_id IN (…)` sobre una tabla grande sin
 * índice (hay varias) bloquea filas que está usando el resto del equipo mientras dure la transacción. */

import (
	stdsql "database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"

	dbsql "creditop/playground/connectors/sql"
)

// MaxDelete es el tope de solicitudes por borrado: un celular de prueba que acumuló más es un error de algo.
const MaxDelete = 50

// TestAllied: el prefijo de los comercios creados para pruebas (`PRUEBA AUTO Shopify`, `PRUEBA AUTO VTEX`…).
const TestAllied = "PRUEBA AUTO"

var reTable = regexp.MustCompile(`^[a-z0-9_]+$`)

// PlanRequest es una solicitud del plan, con por qué se borra o no.
type PlanRequest struct {
	ID        int    `json:"id"`
	UserID    int    `json:"userId"`
	User      string `json:"user"`
	Document  string `json:"document"`
	Allied    string `json:"allied"`
	Hash      string `json:"hash"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	Protected string `json:"protected,omitempty"` // por qué NO se borra
}

// PlanUser es un usuario del celular que se daría de baja, con por qué no si está protegido.
type PlanUser struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Document  string `json:"document"`
	Email     string `json:"email"`
	IsTest    bool   `json:"isTest"`
	Protected string `json:"protected,omitempty"`
}

// TableCount es cuántas filas de una tabla caen.
type TableCount struct {
	Table string `json:"table"`
	Rows  int    `json:"rows"`
}

// Plan dice qué se borraría, sin borrar nada.
type Plan struct {
	Target   string        `json:"target"`
	Scope    string        `json:"scope"` // request · phone
	Request  int           `json:"request"`
	Phone    string        `json:"phone,omitempty"`
	Requests []PlanRequest `json:"requests"`
	Users    []PlanUser    `json:"users"` // sólo si se pidió dar de baja a los usuarios del celular
	Tables   []TableCount  `json:"tables"`
	Total    int           `json:"total"`
	Confirm  string        `json:"confirm"`           // lo que hay que escribir para confirmar
	Blocked  string        `json:"blocked,omitempty"` // por qué no se puede borrar ahora
}

// Deleted es el resultado de un borrado.
type Deleted struct {
	Target     string       `json:"target"`
	Requests   []int        `json:"requests"`
	Users      []int        `json:"users"` // los dados de baja
	Tables     []TableCount `json:"tables"`
	Total      int          `json:"total"`
	RolledBack bool         `json:"rolledBack"`
	At         string       `json:"at"`
}

type childTable struct {
	name  string
	hasID bool
}

// freeable son los usuarios que sí se dan de baja.
func (p *Plan) freeable() []PlanUser {
	var out []PlanUser
	for _, u := range p.Users {
		if u.Protected == "" {
			out = append(out, u)
		}
	}
	return out
}

// eligible son las solicitudes que sí se borran.
func (p *Plan) eligible() []int {
	var ids []int
	for _, r := range p.Requests {
		if r.Protected == "" {
			ids = append(ids, r.ID)
		}
	}
	return ids
}

// BuildPlan lee (por el conector, sólo lectura) qué solicitudes caen y cuántas filas de cada tabla.
func BuildPlan(target string, request int, byPhone, freeUsers bool) (*Plan, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	plan := &Plan{Target: target, Scope: "request", Request: request, Requests: []PlanRequest{}, Users: []PlanUser{}, Tables: []TableCount{},
		Confirm: strconv.Itoa(request)}

	ids := []int{request}
	if byPhone {
		owner, err := first(src, `SELECT u.cell_phone FROM user_requests q JOIN users u ON u.id = q.user_id WHERE q.id = ?`, request)
		if err != nil {
			return nil, err
		}
		phone := lastN(onlyDigits(cell(owner, "cell_phone")), 10)
		if len(phone) < 7 {
			return nil, fmt.Errorf("el usuario de la solicitud %d no tiene celular: no hay «todas las del celular»", request)
		}
		plan.Scope, plan.Phone, plan.Confirm = "phone", phone, phone
		// Todas las solicitudes de todos los usuarios con ese celular, activos o dados de baja.
		list, err := rows(src, `SELECT q.id FROM user_requests q JOIN users u ON u.id = q.user_id
			WHERE u.cell_phone LIKE CONCAT('%', ?) ORDER BY q.id`, phone)
		if err != nil {
			return nil, err
		}
		ids = ids[:0]
		for _, r := range list {
			n, _ := strconv.Atoi(cell(r, "id"))
			ids = append(ids, n)
		}
	}

	info, err := rows(src, `SELECT q.id, q.user_id, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.surname, ''))) AS user,
			u.document_number, u.is_test, a.name AS allied, b.hash, s.name AS status, q.created_at
		FROM user_requests q LEFT JOIN users u ON u.id = q.user_id LEFT JOIN allieds a ON a.id = q.allied_id
		LEFT JOIN allied_branches b ON b.id = q.allied_branch_id LEFT JOIN user_request_statuses s ON s.id = q.user_request_status_id
		WHERE q.id IN (`+intList(ids)+`) ORDER BY q.id`)
	if err != nil {
		return nil, err
	}
	if len(info) == 0 {
		return nil, fmt.Errorf("no existe la solicitud %d en %s", request, target)
	}
	for _, r := range info {
		id, _ := strconv.Atoi(cell(r, "id"))
		uid, _ := strconv.Atoi(cell(r, "user_id"))
		pr := PlanRequest{ID: id, UserID: uid, User: cell(r, "user"), Document: cell(r, "document_number"),
			Allied: cell(r, "allied"), Hash: cell(r, "hash"), Status: cell(r, "status"), CreatedAt: cell(r, "created_at")}
		// En local todo es tuyo; en la base compartida, sólo lo que es de prueba.
		if target != "local" && !strings.HasPrefix(strings.ToUpper(pr.Allied), TestAllied) && cell(r, "is_test") != "1" {
			pr.Protected = fmt.Sprintf("ni el comercio es «%s…» ni el usuario está marcado de prueba", TestAllied)
		}
		plan.Requests = append(plan.Requests, pr)
	}

	if byPhone && freeUsers {
		users, err := rows(src, `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(surname, ''))) AS name, document_number,
				email, is_test, user_profile_id FROM users WHERE cell_phone LIKE CONCAT('%', ?) AND status = 1 ORDER BY id`, plan.Phone)
		if err != nil {
			return nil, fmt.Errorf("usuarios del celular: %w", err)
		}
		for _, u := range users {
			id, _ := strconv.Atoi(cell(u, "id"))
			pu := PlanUser{ID: id, Name: cell(u, "name"), Document: cell(u, "document_number"), Email: cell(u, "email"), IsTest: cell(u, "is_test") == "1"}
			switch {
			case cell(u, "user_profile_id") != "1":
				pu.Protected = "no es un cliente (perfil " + cell(u, "user_profile_id") + ")"
			case target != "local" && !pu.IsTest:
				pu.Protected = "no está marcado de prueba"
			}
			plan.Users = append(plan.Users, pu)
		}
	}

	eligible := plan.eligible()
	switch {
	case len(eligible) == 0:
		plan.Blocked = "ninguna de estas solicitudes es de prueba: no se borra nada"
	case len(eligible) > MaxDelete:
		plan.Blocked = fmt.Sprintf("son %d solicitudes y el tope es %d: algo no está bien con ese celular", len(eligible), MaxDelete)
	default:
		plan.Blocked = writeBlocked(target)
	}
	if len(eligible) == 0 || len(eligible) > MaxDelete {
		return plan, nil
	}

	tables, err := childTables(src)
	if err != nil {
		return nil, err
	}
	list := intList(eligible)
	var parts []string
	for _, t := range tables {
		parts = append(parts, fmt.Sprintf("SELECT '%s' AS t, COUNT(*) AS n FROM `%s` WHERE %s", t.name, t.name, childWhere(t.name, list)))
	}
	parts = append(parts, fmt.Sprintf("SELECT 'device_locks' AS t, COUNT(*) AS n FROM device_locks WHERE %s", deviceLocksWhere(list)))
	counts, err := rows(src, strings.Join(parts, " UNION ALL "))
	if err != nil {
		return nil, fmt.Errorf("contar lo que cuelga: %w", err)
	}
	for _, c := range counts {
		if n, _ := strconv.Atoi(cell(c, "n")); n > 0 {
			plan.Tables = append(plan.Tables, TableCount{cell(c, "t"), n})
			plan.Total += n
		}
	}
	plan.Tables = append(plan.Tables, TableCount{"user_requests", len(eligible)})
	plan.Total += len(eligible)
	if n := len(plan.freeable()); n > 0 {
		plan.Tables = append(plan.Tables, TableCount{"users (baja)", n})
		plan.Total += n
	}
	sort.SliceStable(plan.Tables, func(i, j int) bool { return plan.Tables[i].Rows > plan.Tables[j].Rows })
	return plan, nil
}

// childTables son las tablas con `user_request_id` de ESTA base, y si tienen `id` de llave primaria.
func childTables(src dbsql.Source) ([]childTable, error) {
	list, err := rows(src, `SELECT c.TABLE_NAME AS t, (SELECT COUNT(*) FROM information_schema.COLUMNS i
			WHERE i.TABLE_SCHEMA = c.TABLE_SCHEMA AND i.TABLE_NAME = c.TABLE_NAME AND i.COLUMN_NAME = 'id' AND i.COLUMN_KEY = 'PRI') AS has_id
		FROM information_schema.COLUMNS c JOIN information_schema.TABLES tb
			ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
		WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'user_request_id' ORDER BY c.TABLE_NAME`)
	if err != nil {
		return nil, fmt.Errorf("tablas que cuelgan: %w", err)
	}
	var out []childTable
	for _, r := range list {
		name := cell(r, "t")
		if !reTable.MatchString(name) {
			return nil, fmt.Errorf("nombre de tabla inesperado %q", name)
		}
		out = append(out, childTable{name, cell(r, "has_id") == "1"})
	}
	return out, nil
}

// childWhere: las filas de una tabla que cuelgan de las solicitudes. El pedido de la tienda también por el vínculo.
func childWhere(table, list string) string {
	if table == "ecommerce_requests" {
		return fmt.Sprintf("user_request_id IN (%s) OR id IN (SELECT ecommerce_request_id FROM user_requests_by_ecommerce_request WHERE user_request_id IN (%s))", list, list)
	}
	return fmt.Sprintf("user_request_id IN (%s)", list)
}

func deviceLocksWhere(list string) string {
	return fmt.Sprintf("user_request_product_id IN (SELECT id FROM user_request_products WHERE user_request_id IN (%s))", list)
}

// writeBlocked dice por qué no se puede escribir en ese ambiente, o "" si se puede.
func writeBlocked(target string) string {
	cfg, err := writeConfig(target)
	if err != nil {
		return err.Error()
	}
	if target == "local" || isLocalHost(cfg.host) {
		return ""
	}
	// Del PROCESO y nada más: escrito en un .env desarma la guarda (F-53).
	if os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") == "1" {
		return ""
	}
	return "borrar en la base compartida pide levantar tests con I_KNOW_THIS_TOUCHES_SHARED_DEV=1 exportado en la shell (F-53)"
}

type dbConfig struct{ host, port, name, user, pass string }

// writeConfig lee la base del harness: el proceso gana sobre `harness/.env.<target>`, como en harness/pkg/env.ts.
func writeConfig(target string) (dbConfig, error) {
	file := filepath.Join(repoRoot(), "harness", ".env."+target)
	vals := map[string]string{}
	if data, err := os.ReadFile(file); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			k, v, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
			if ok {
				vals[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
			}
		}
	}
	get := func(k string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return vals[k]
	}
	c := dbConfig{get("E2E_DB_HOST"), get("E2E_DB_PORT"), get("E2E_DB_NAME"), get("E2E_DB_USER"), get("E2E_DB_PASS")}
	if c.host == "" || c.name == "" || c.user == "" {
		return c, fmt.Errorf("faltan E2E_DB_HOST, E2E_DB_NAME o E2E_DB_USER en harness/.env.%s: sin ellos no se escribe", target)
	}
	if c.port == "" {
		c.port = "3306"
	}
	return c, nil
}

func isLocalHost(h string) bool { return h == "127.0.0.1" || h == "localhost" || h == "::1" }

func repoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", ".."))
}

// Delete borra lo que dice el plan. Vuelve a armarlo y a comprobar las guardas: no le cree al navegador.
// Con rollback=true hace todo y deshace al final: así se prueba el camino entero sin borrar nada.
func Delete(target string, request int, byPhone, freeUsers bool, confirm string, rollback bool) (*Deleted, error) {
	plan, err := BuildPlan(target, request, byPhone, freeUsers)
	if err != nil {
		return nil, err
	}
	if plan.Blocked != "" {
		return nil, errors.New(plan.Blocked)
	}
	if strings.TrimSpace(confirm) != plan.Confirm {
		return nil, fmt.Errorf("la confirmación no coincide: hay que escribir %s", plan.Confirm)
	}
	cfg, err := writeConfig(target)
	if err != nil {
		return nil, err
	}
	db, err := stdsql.Open("mysql", fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?timeout=10s&readTimeout=60s&writeTimeout=60s",
		cfg.user, cfg.pass, cfg.host, cfg.port, cfg.name))
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	src, err := source(target)
	if err != nil {
		return nil, err
	}
	tables, err := childTables(src)
	if err != nil {
		return nil, err
	}
	ids := plan.eligible()
	list := intList(ids)

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	done := false
	defer func() {
		if !done {
			_ = tx.Rollback()
		}
	}()

	counts := map[string]int{}
	exec := func(table, query string) error {
		res, err := tx.Exec(query)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		counts[table] += int(n)
		return nil
	}
	// Por llave primaria: primero los ids (lectura), después el borrado de a tandas.
	byID := func(table, where string) error {
		got, err := tx.Query(fmt.Sprintf("SELECT id FROM `%s` WHERE %s", table, where))
		if err != nil {
			return err
		}
		var pks []int
		for got.Next() {
			var id int
			if err := got.Scan(&id); err != nil {
				got.Close()
				return err
			}
			pks = append(pks, id)
		}
		got.Close()
		for start := 0; start < len(pks); start += 500 {
			end := min(start+500, len(pks))
			if err := exec(table, fmt.Sprintf("DELETE FROM `%s` WHERE id IN (%s)", table, intList(pks[start:end]))); err != nil {
				return err
			}
		}
		return nil
	}

	if err := byID("device_locks", deviceLocksWhere(list)); err != nil {
		return nil, fmt.Errorf("device_locks: %w", err)
	}
	// Las tablas entre sí pueden tener llaves foráneas (firmas → codeudores): se reintenta en otra pasada lo
	// que falló por una llave (1451) hasta que no avance más.
	pending := tables
	for pass := 0; len(pending) > 0; pass++ {
		var retry []childTable
		var lastErr error
		for _, t := range pending {
			var err error
			if t.hasID {
				err = byID(t.name, childWhere(t.name, list))
			} else {
				err = exec(t.name, fmt.Sprintf("DELETE FROM `%s` WHERE %s", t.name, childWhere(t.name, list)))
			}
			var me *mysql.MySQLError
			if errors.As(err, &me) && me.Number == 1451 {
				retry, lastErr = append(retry, t), fmt.Errorf("%s: %w", t.name, err)
				continue
			}
			if err != nil {
				return nil, fmt.Errorf("%s: %w", t.name, err)
			}
		}
		if len(retry) == len(pending) {
			return nil, fmt.Errorf("no se pudo borrar por una llave foránea sin cascada, no se borró nada: %w", lastErr)
		}
		pending = retry
	}
	if err := exec("ecommerce_requests", fmt.Sprintf("UPDATE ecommerce_requests SET original_user_request_id = NULL WHERE original_user_request_id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("ecommerce_requests.original_user_request_id: %w", err)
	}
	if err := exec("user_requests", fmt.Sprintf("DELETE FROM user_requests WHERE id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("user_requests: %w", err)
	}
	// La baja, como la papelera del admin: el siguiente sufijo libre -t<n> de la cédula, y sin correo ni celular.
	var freed []int
	for _, u := range plan.freeable() {
		var next int
		if err := tx.QueryRow(`SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(document_number, '-t', -1) AS UNSIGNED)), 0) + 1
			FROM users WHERE document_number LIKE CONCAT(?, '-t%')`, u.Document).Scan(&next); err != nil {
			return nil, fmt.Errorf("baja del usuario %d: %w", u.ID, err)
		}
		res, err := tx.Exec(`UPDATE users SET status = 0, document_number = CONCAT(document_number, '-t', ?), email = NULL,
			cell_phone = NULL, updated_at = NOW() WHERE id = ? AND status = 1 AND user_profile_id = 1`, next, u.ID)
		if err != nil {
			return nil, fmt.Errorf("baja del usuario %d: %w", u.ID, err)
		}
		if n, _ := res.RowsAffected(); n == 1 {
			counts["users (baja)"]++
			freed = append(freed, u.ID)
		}
	}

	out := &Deleted{Target: target, Requests: ids, Users: freed, Tables: []TableCount{}, RolledBack: rollback, At: time.Now().Format("2006-01-02 15:04:05")}
	if out.Users == nil {
		out.Users = []int{}
	}
	for t, n := range counts {
		if n > 0 {
			out.Tables = append(out.Tables, TableCount{t, n})
			out.Total += n
		}
	}
	sort.SliceStable(out.Tables, func(i, j int) bool { return out.Tables[i].Rows > out.Tables[j].Rows })

	if rollback {
		err = tx.Rollback()
	} else {
		err = tx.Commit()
	}
	done = true
	if err != nil {
		return nil, err
	}
	if !rollback {
		journal(out)
	}
	return out, nil
}

// journal deja constancia de cada borrado en tests/.deletions.ndjson (fuera de git): qué, dónde y cuánto.
func journal(d *Deleted) {
	f, err := os.OpenFile(filepath.Join(repoRoot(), "tests", ".deletions.ndjson"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	line, _ := json.Marshal(d)
	_, _ = f.Write(append(line, '\n'))
}

func intList(ids []int) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, ",")
}
