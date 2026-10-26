package main

/* Borrar de verdad una solicitud —o todas las de un celular— y todo lo que cuelga de ella, para que una
 * prueba empiece limpia.
 *
 * Es la ÚNICA escritura de tests, y por eso no pasa por el conector de SQL (que es de sólo lectura): usa la
 * base del harness (`E2E_DB_*` de `harness/.env.<target>`), la misma excepción que ya tiene el harness para
 * sembrar.
 *
 * DECISIÓN DE MIGUEL (2026-10-26): tests borra CUALQUIER solicitud de local o de la base compartida, sin
 * I_KNOW_THIS_TOUCHES_SHARED_DEV y sin limitarse a las de prueba. Es la excepción a F-53, y sólo para esta
 * operación de este servidor. Lo que la hace segura vive acá, no en una variable:
 *
 *   · nunca prod: sólo local y qa (`Targets`), con las credenciales del harness de ese ambiente;
 *   · la confirmación (el número, o el celular) se vuelve a comprobar en el servidor, y el plan se rearma;
 *   · lo que no es de prueba (otro comercio, un usuario sin marca) no se bloquea pero AVISA, con el nombre;
 *   · un RESPALDO de cada fila antes de borrarla (y del usuario antes de su baja) en tests/.backups/, para
 *     poder reponerla;
 *   · un tope de solicitudes por borrado, nunca la baja de una cuenta que no es de cliente (asesor, admin), y
 *     todo en UNA transacción: si una tabla falla, no se borra nada.
 *
 * Para empezar un flujo DE CERO con el mismo celular no alcanza con borrar las solicitudes: el OTP pega la
 * próxima al usuario que ya tiene ese número. Por eso, con el celular, se puede además dar de BAJA a sus
 * usuarios, igual que la papelera del admin (`UserController@disableUser` de legacy-application): status 0,
 * la cédula con -t<n> y sin correo ni celular. El usuario no se borra: queda la fila, como en el admin. Sólo
 * clientes (perfil 1).
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
	Warning   string `json:"warning,omitempty"`   // se borra, pero conviene saber de quién es
}

// PlanUser es un usuario del celular que se daría de baja, con por qué no si está protegido.
type PlanUser struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Document  string `json:"document"`
	Email     string `json:"email"`
	IsTest    bool   `json:"isTest"`
	Protected string `json:"protected,omitempty"`
	Warning   string `json:"warning,omitempty"`
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
	// LastOf: el usuario al que, con este borrado, no le queda ninguna solicitud. Es cuando tiene sentido
	// preguntar si darlo de baja también; con el celular, se ofrece siempre.
	LastOf string `json:"lastOf,omitempty"`
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
	Backup     string       `json:"backup"` // dónde quedó la copia de lo borrado
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
		// En la base compartida, lo que no es de prueba puede ser de otra persona del equipo: se borra, pero avisa.
		if target != "local" && !strings.HasPrefix(strings.ToUpper(pr.Allied), TestAllied) && cell(r, "is_test") != "1" {
			pr.Warning = fmt.Sprintf("no es de prueba: comercio «%s» y el usuario %s no está marcado de prueba", pr.Allied, pr.User)
		}
		plan.Requests = append(plan.Requests, pr)
	}

	// Una sola solicitud: ¿es la última de su usuario? Entonces se ofrece darlo de baja.
	var lastUser int
	if !byPhone && len(plan.Requests) == 1 && plan.Requests[0].Protected == "" && plan.Requests[0].UserID > 0 {
		other, err := first(src, `SELECT COUNT(*) AS n FROM user_requests WHERE user_id = ? AND id <> ?`, plan.Requests[0].UserID, request)
		if err != nil {
			return nil, err
		}
		if cell(other, "n") == "0" {
			lastUser, plan.LastOf = plan.Requests[0].UserID, plan.Requests[0].User
		}
	}

	if freeUsers && (byPhone || lastUser > 0) {
		query, arg := `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(surname, ''))) AS name, document_number,
				email, is_test, user_profile_id FROM users WHERE cell_phone LIKE CONCAT('%', ?) AND status = 1 ORDER BY id`, any(plan.Phone)
		if !byPhone {
			query, arg = `SELECT id, TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(surname, ''))) AS name, document_number,
				email, is_test, user_profile_id FROM users WHERE id = ? AND status = 1`, lastUser
		}
		users, err := rows(src, query, arg)
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
				pu.Warning = "no está marcado de prueba"
			}
			plan.Users = append(plan.Users, pu)
		}
	}

	eligible := plan.eligible()
	switch {
	case len(eligible) == 0:
		plan.Blocked = "no hay nada que borrar"
	case len(eligible) > MaxDelete:
		plan.Blocked = fmt.Sprintf("son %d solicitudes y el tope es %d: algo no está bien con ese celular", len(eligible), MaxDelete)
	default:
		plan.Blocked = writeBlocked(target)
	}
	if len(eligible) == 0 || len(eligible) > MaxDelete {
		return plan, nil
	}

	counts, err := countTables(src, eligible, childWhere)
	if err != nil {
		return nil, err
	}
	for _, c := range counts {
		plan.Tables = append(plan.Tables, c)
		plan.Total += c.Rows
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

// countTables cuenta, tabla por tabla, las filas que cuelgan de esas solicitudes (sin la solicitud misma).
// Sólo lee: es lo que muestra el editor y la base del plan.
func countTables(src dbsql.Source, ids []int, where func(table, list string) string) ([]TableCount, error) {
	tables, err := childTables(src)
	if err != nil {
		return nil, err
	}
	list := intList(ids)
	var parts []string
	for _, t := range tables {
		parts = append(parts, fmt.Sprintf("SELECT '%s' AS t, COUNT(*) AS n FROM `%s` WHERE %s", t.name, t.name, where(t.name, list)))
	}
	parts = append(parts, fmt.Sprintf("SELECT 'device_locks' AS t, COUNT(*) AS n FROM device_locks WHERE %s", deviceLocksWhere(list)))
	counts, err := rows(src, strings.Join(parts, " UNION ALL "))
	if err != nil {
		return nil, fmt.Errorf("contar lo que cuelga: %w", err)
	}
	out := []TableCount{}
	for _, c := range counts {
		if n, _ := strconv.Atoi(cell(c, "n")); n > 0 {
			out = append(out, TableCount{cell(c, "t"), n})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Rows > out[j].Rows })
	return out, nil
}

// RequestTables: las tablas con filas de UNA solicitud, para mostrarlas en el editor. Sólo lee, y vale para
// cualquier solicitud (también las protegidas, que no se pueden borrar).
func RequestTables(target string, request int) ([]TableCount, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	out, err := countTables(src, []int{request}, viewWhere)
	if err != nil {
		return nil, err
	}
	head := []TableCount{{"user_requests", 1}}
	// El usuario va como una tabla más, para ver sus datos junto al resto; no se borra con la solicitud.
	if u, err := first(src, `SELECT user_id FROM user_requests WHERE id = ?`, request); err == nil && cell(u, "user_id") != "" {
		head = append(head, TableCount{"users", 1})
	}
	return append(head, out...), nil
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

// viewWhere es childWhere más lo que se MUESTRA pero no se borra con la solicitud: los chequeos de identidad
// que TusDatos guarda sin `user_request_id` (TusDatosService los registra con null), del usuario de la
// solicitud. Sin solicitud no se sabe de cuál son —el usuario puede tener varias—, así que borrar una no los
// toca; se van al borrar del todo al usuario.
func viewWhere(table, list string) string {
	if table == "kyc_name_checks" {
		return fmt.Sprintf("%s OR (user_request_id IS NULL AND user_id IN (SELECT user_id FROM user_requests WHERE id IN (%s)))",
			childWhere(table, list), list)
	}
	return childWhere(table, list)
}

func deviceLocksWhere(list string) string {
	return fmt.Sprintf("user_request_product_id IN (SELECT id FROM user_request_products WHERE user_request_id IN (%s))", list)
}

// writeBlocked dice por qué no se puede escribir en ese ambiente, o "" si se puede. Sin variable de permiso a
// propósito (decisión de Miguel, ver arriba): basta con que el ambiente sea local o qa y tenga credenciales.
func writeBlocked(target string) string {
	if _, err := writeConfig(target); err != nil {
		return err.Error()
	}
	return ""
}

type dbConfig struct{ host, port, name, user, pass string }

// writeConfig lee la base del harness: el proceso gana sobre `harness/.env.<target>`, como en harness/pkg/env.ts.
func writeConfig(target string) (dbConfig, error) {
	get := harnessEnv(target)
	c := dbConfig{get("E2E_DB_HOST"), get("E2E_DB_PORT"), get("E2E_DB_NAME"), get("E2E_DB_USER"), get("E2E_DB_PASS")}
	if c.host == "" || c.name == "" || c.user == "" {
		return c, fmt.Errorf("faltan E2E_DB_HOST, E2E_DB_NAME o E2E_DB_USER en harness/.env.%s: sin ellos no se escribe", target)
	}
	if c.port == "" {
		c.port = "3306"
	}
	return c, nil
}

// harnessEnv lee una clave de harness/.env.<target>; el proceso gana sobre el archivo.
func harnessEnv(target string) func(string) string {
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
	return func(k string) string {
		if v := os.Getenv(k); v != "" {
			return v
		}
		return vals[k]
	}
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
	db, err := openWrite(target)
	if err != nil {
		return nil, err
	}
	defer db.Close()

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

	backup, keep := newBackup(tx)
	del := &txDeleter{tx: tx, keep: keep, counts: map[string]int{}}
	counts, exec, byID := del.counts, del.exec, del.byID

	if err := byID("device_locks", deviceLocksWhere(list)); err != nil {
		return nil, fmt.Errorf("device_locks: %w", err)
	}
	if err := del.purge(tables, func(t childTable) string { return childWhere(t.name, list) }); err != nil {
		return nil, err
	}
	if err := keep("ecommerce_requests (original_user_request_id)", fmt.Sprintf("SELECT id, original_user_request_id FROM ecommerce_requests WHERE original_user_request_id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("respaldo de ecommerce_requests: %w", err)
	}
	if err := exec("ecommerce_requests", fmt.Sprintf("UPDATE ecommerce_requests SET original_user_request_id = NULL WHERE original_user_request_id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("ecommerce_requests.original_user_request_id: %w", err)
	}
	if err := keep("user_requests", fmt.Sprintf("SELECT * FROM user_requests WHERE id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("respaldo de user_requests: %w", err)
	}
	if err := exec("user_requests", fmt.Sprintf("DELETE FROM user_requests WHERE id IN (%s)", list)); err != nil {
		return nil, fmt.Errorf("user_requests: %w", err)
	}
	// La baja, como la papelera del admin: el siguiente sufijo libre -t<n> de la cédula, y sin correo ni celular.
	var freed []int
	for _, u := range plan.freeable() {
		ok, err := disableUserTx(tx, keep, u.ID, u.Document)
		if err != nil {
			return nil, err
		}
		if ok {
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

	// El respaldo se escribe ANTES de confirmar: si no se puede guardar, no se borra.
	out.Backup, err = writeBackup(out, backup)
	if err != nil {
		return nil, fmt.Errorf("no se pudo guardar el respaldo, no se borró nada: %w", err)
	}
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

// txDeleter borra filas dentro de una transacción, respaldando cada una antes y contando por tabla.
type txDeleter struct {
	tx     *stdsql.Tx
	keep   func(table, query string) error
	counts map[string]int
}

func (d *txDeleter) exec(table, query string) error {
	res, err := d.tx.Exec(query)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	d.counts[table] += int(n)
	return nil
}

// byID borra por llave primaria: primero los ids (lectura), después de a tandas, respaldando cada tanda.
func (d *txDeleter) byID(table, where string) error {
	got, err := d.tx.Query(fmt.Sprintf("SELECT id FROM `%s` WHERE %s", table, where))
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
		batch := intList(pks[start:end])
		if err := d.keep(table, fmt.Sprintf("SELECT * FROM `%s` WHERE id IN (%s)", table, batch)); err != nil {
			return err
		}
		if err := d.exec(table, fmt.Sprintf("DELETE FROM `%s` WHERE id IN (%s)", table, batch)); err != nil {
			return err
		}
	}
	return nil
}

// purge borra en cada tabla lo que diga where. Las tablas entre sí pueden tener llaves foráneas (firmas →
// codeudores): se reintenta en otra pasada lo que falló por una llave (1451) hasta que no avance más.
func (d *txDeleter) purge(tables []childTable, where func(childTable) string) error {
	pending := tables
	for len(pending) > 0 {
		var retry []childTable
		var lastErr error
		for _, t := range pending {
			var err error
			if t.hasID {
				err = d.byID(t.name, where(t))
			} else {
				err = d.keep(t.name, fmt.Sprintf("SELECT * FROM `%s` WHERE %s", t.name, where(t)))
				if err == nil {
					err = d.exec(t.name, fmt.Sprintf("DELETE FROM `%s` WHERE %s", t.name, where(t)))
				}
			}
			var me *mysql.MySQLError
			if errors.As(err, &me) && me.Number == 1451 {
				retry, lastErr = append(retry, t), fmt.Errorf("%s: %w", t.name, err)
				continue
			}
			if err != nil {
				return fmt.Errorf("%s: %w", t.name, err)
			}
		}
		if len(retry) == len(pending) {
			return fmt.Errorf("no se pudo borrar por una llave foránea sin cascada, no se borró nada: %w", lastErr)
		}
		pending = retry
	}
	return nil
}

// newBackup arma el respaldo de una transacción: keep lee y guarda cada fila tal como estaba, justo antes de
// tocarla, en la misma transacción.
func newBackup(tx *stdsql.Tx) (map[string][]map[string]any, func(table, query string) error) {
	backup := map[string][]map[string]any{}
	keep := func(table, query string) error {
		got, err := tx.Query(query)
		if err != nil {
			return err
		}
		defer got.Close()
		cols, err := got.Columns()
		if err != nil {
			return err
		}
		for got.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := got.Scan(ptrs...); err != nil {
				return err
			}
			row := map[string]any{}
			for i, c := range cols {
				if b, ok := vals[i].([]byte); ok {
					row[c] = string(b)
				} else {
					row[c] = vals[i]
				}
			}
			backup[table] = append(backup[table], row)
		}
		return got.Err()
	}
	return backup, keep
}

// disableUserTx da de baja a un cliente como la papelera del admin: el siguiente sufijo libre -t<n> de la cédula,
// sin correo ni celular. Respalda la fila antes. Dice si de verdad cambió (sólo un cliente activo cambia).
func disableUserTx(tx *stdsql.Tx, keep func(table, query string) error, id int, document string) (bool, error) {
	var next int
	if err := tx.QueryRow(`SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(document_number, '-t', -1) AS UNSIGNED)), 0) + 1
		FROM users WHERE document_number LIKE CONCAT(?, '-t%')`, document).Scan(&next); err != nil {
		return false, fmt.Errorf("baja del usuario %d: %w", id, err)
	}
	if err := keep("users", fmt.Sprintf("SELECT * FROM users WHERE id = %d", id)); err != nil {
		return false, fmt.Errorf("respaldo del usuario %d: %w", id, err)
	}
	res, err := tx.Exec(`UPDATE users SET status = 0, document_number = CONCAT(document_number, '-t', ?), email = NULL,
		cell_phone = NULL, updated_at = NOW() WHERE id = ? AND status = 1 AND user_profile_id = 1`, next, id)
	if err != nil {
		return false, fmt.Errorf("baja del usuario %d: %w", id, err)
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// openWrite abre la base del harness de ese ambiente, la única con la que tests escribe.
func openWrite(target string) (*stdsql.DB, error) {
	cfg, err := writeConfig(target)
	if err != nil {
		return nil, err
	}
	db, err := stdsql.Open("mysql", fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?timeout=10s&readTimeout=60s&writeTimeout=60s",
		cfg.user, cfg.pass, cfg.host, cfg.port, cfg.name))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// DisableUser da de baja a UN usuario suelto —uno sin solicitudes, o al que se busca por correo o cédula—,
// con las mismas reglas que la baja dentro de un borrado: sólo un cliente activo, con respaldo, en una
// transacción. confirm es el id del usuario.
func DisableUser(target string, id int, confirm string, rollback bool) (*Deleted, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	if blocked := writeBlocked(target); blocked != "" {
		return nil, errors.New(blocked)
	}
	if strings.TrimSpace(confirm) != strconv.Itoa(id) {
		return nil, fmt.Errorf("la confirmación no coincide: hay que mandar el id del usuario, %d", id)
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	u, err := first(src, `SELECT id, status, user_profile_id, document_number FROM users WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	switch {
	case u == nil:
		return nil, fmt.Errorf("no existe el usuario %d en %s", id, target)
	case cell(u, "status") != "1":
		return nil, fmt.Errorf("el usuario %d ya está dado de baja", id)
	case cell(u, "user_profile_id") != "1":
		return nil, fmt.Errorf("el usuario %d no es un cliente (perfil %s): no se da de baja desde tests", id, cell(u, "user_profile_id"))
	}
	db, err := openWrite(target)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	backup, keep := newBackup(tx)
	ok, err := disableUserTx(tx, keep, id, cell(u, "document_number"))
	if err != nil || !ok {
		_ = tx.Rollback()
		if err == nil {
			err = fmt.Errorf("el usuario %d no cambió: ya no está activo o no es un cliente", id)
		}
		return nil, err
	}
	out := &Deleted{Target: target, Requests: []int{}, Users: []int{id}, Tables: []TableCount{{"users (baja)", 1}}, Total: 1,
		RolledBack: rollback, At: time.Now().Format("2006-01-02 15:04:05")}
	if out.Backup, err = writeBackup(out, backup); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("no se pudo guardar el respaldo, no se dio de baja: %w", err)
	}
	if rollback {
		err = tx.Rollback()
	} else {
		err = tx.Commit()
	}
	if err != nil {
		return nil, err
	}
	if !rollback {
		journal(out)
	}
	return out, nil
}

// userTables son las tablas con `user_id` de ESTA base (menos users), como childTables con `user_request_id`.
func userTables(src dbsql.Source) ([]childTable, error) {
	list, err := rows(src, `SELECT c.TABLE_NAME AS t, (SELECT COUNT(*) FROM information_schema.COLUMNS i
			WHERE i.TABLE_SCHEMA = c.TABLE_SCHEMA AND i.TABLE_NAME = c.TABLE_NAME AND i.COLUMN_NAME = 'id' AND i.COLUMN_KEY = 'PRI') AS has_id
		FROM information_schema.COLUMNS c JOIN information_schema.TABLES tb
			ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME AND tb.TABLE_TYPE = 'BASE TABLE'
		WHERE c.TABLE_SCHEMA = DATABASE() AND c.COLUMN_NAME = 'user_id' AND c.TABLE_NAME <> 'users' ORDER BY c.TABLE_NAME`)
	if err != nil {
		return nil, fmt.Errorf("tablas del usuario: %w", err)
	}
	var out []childTable
	for _, r := range list {
		if name := cell(r, "t"); reTable.MatchString(name) {
			out = append(out, childTable{name, cell(r, "has_id") == "1"})
		}
	}
	return out, nil
}

// PurgeUser borra DEL TODO a un cliente ya dado de baja: su fila de users y las filas suyas de toda tabla con
// `user_id`, con respaldo y en una transacción. Sólo clientes, sólo dados de baja (el activo primero se da de
// baja, que es lo que libera su correo y celular) y sólo sin solicitudes (esas se borran antes, con lo que
// cuelga de ellas). confirm es el id.
func PurgeUser(target string, id int, confirm string, rollback bool) (*Deleted, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	if blocked := writeBlocked(target); blocked != "" {
		return nil, errors.New(blocked)
	}
	if strings.TrimSpace(confirm) != strconv.Itoa(id) {
		return nil, fmt.Errorf("la confirmación no coincide: hay que mandar el id del usuario, %d", id)
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	u, err := first(src, `SELECT id, status, user_profile_id, (SELECT COUNT(*) FROM user_requests q WHERE q.user_id = u.id) AS requests
		FROM users u WHERE id = ?`, id)
	if err != nil {
		return nil, err
	}
	switch {
	case u == nil:
		return nil, fmt.Errorf("no existe el usuario %d en %s", id, target)
	case cell(u, "user_profile_id") != "1":
		return nil, fmt.Errorf("el usuario %d no es un cliente (perfil %s): no se borra desde tests", id, cell(u, "user_profile_id"))
	case cell(u, "status") == "1":
		return nil, fmt.Errorf("el usuario %d está activo: primero se da de baja", id)
	case cell(u, "requests") != "0":
		return nil, fmt.Errorf("el usuario %d todavía tiene %s solicitudes: borralas antes", id, cell(u, "requests"))
	}
	tables, err := userTables(src)
	if err != nil {
		return nil, err
	}
	db, err := openWrite(target)
	if err != nil {
		return nil, err
	}
	defer db.Close()
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
	backup, keep := newBackup(tx)
	del := &txDeleter{tx: tx, keep: keep, counts: map[string]int{}}
	if err := del.purge(tables, func(childTable) string { return fmt.Sprintf("user_id = %d", id) }); err != nil {
		return nil, err
	}
	if err := keep("users", fmt.Sprintf("SELECT * FROM users WHERE id = %d", id)); err != nil {
		return nil, fmt.Errorf("respaldo del usuario: %w", err)
	}
	if err := del.exec("users", fmt.Sprintf("DELETE FROM users WHERE id = %d AND status = 0 AND user_profile_id = 1", id)); err != nil {
		return nil, fmt.Errorf("users: %w", err)
	}
	out := &Deleted{Target: target, Requests: []int{}, Users: []int{id}, Tables: []TableCount{}, RolledBack: rollback,
		At: time.Now().Format("2006-01-02 15:04:05")}
	for t, n := range del.counts {
		if n > 0 {
			out.Tables = append(out.Tables, TableCount{t, n})
			out.Total += n
		}
	}
	sort.SliceStable(out.Tables, func(i, j int) bool { return out.Tables[i].Rows > out.Tables[j].Rows })
	if out.Backup, err = writeBackup(out, backup); err != nil {
		return nil, fmt.Errorf("no se pudo guardar el respaldo, no se borró nada: %w", err)
	}
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

// writeBackup guarda en tests/.backups/ (fuera de git, sólo para vos) cada fila borrada o cambiada, por tabla,
// tal como estaba. Con ellas se puede reponer lo borrado. Lleva datos personales: no se comparte.
func writeBackup(d *Deleted, rows map[string][]map[string]any) (string, error) {
	dir := filepath.Join(repoRoot(), "tests", ".backups")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	what := "solicitud"
	if len(d.Requests) > 0 {
		what = strconv.Itoa(d.Requests[0])
	} else if len(d.Users) > 0 {
		what = fmt.Sprintf("usuario-%d", d.Users[0])
	}
	name := fmt.Sprintf("%s-%s-%s", time.Now().Format("20060102-150405"), d.Target, what)
	if d.RolledBack {
		name += "-rollback"
	}
	file := filepath.Join(dir, name+".json")
	data, err := json.MarshalIndent(map[string]any{"target": d.Target, "at": d.At, "requests": d.Requests,
		"users": d.Users, "rolledBack": d.RolledBack, "rows": rows}, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(file, data, 0o600); err != nil {
		return "", err
	}
	rel, _ := filepath.Rel(repoRoot(), file)
	return rel, nil
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
