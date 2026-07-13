package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	_ "github.com/go-sql-driver/mysql"
)

func connect(c Config) (*sql.DB, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=8s&readTimeout=15s",
		c.DBUser, c.DBPass, c.DBHost, c.DBPort, c.DBName)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping dev DB: %w", err)
	}
	return db, nil
}

// --- comercio + branch ---

type Merchant struct {
	BranchID, AlliedID int
	Hash, Name, Slug   string
}

// needsPersonalInfo: comercios donde personal-info FIJA el documento por primera vez (Pullman 94,
// Dentix 189 — Experian Quanto). Para ellos register NO manda el doc (si no, ONB005 DOCUMENT_DUPLICATE).
func needsPersonalInfo(alliedID int) bool { return alliedID == 94 || alliedID == 189 }

func resolveMerchant(db *sql.DB, q string) (Merchant, error) {
	var m Merchant
	like := "%" + q + "%"
	// Solo columnas presentes en dev: allied_branches(hash), allieds(slug,name). (El esquema del
	// mock local tenía ab.name/ab.slug; dev no necesariamente — no referenciarlas.)
	err := db.QueryRow(`
		SELECT ab.id, ab.allied_id, COALESCE(ab.hash,''), a.name, COALESCE(a.slug,'')
		FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id
		WHERE ab.hash = ? OR a.slug = ? OR a.name LIKE ?
		ORDER BY ab.status DESC, ab.id LIMIT 1`,
		q, q, like).Scan(&m.BranchID, &m.AlliedID, &m.Hash, &m.Name, &m.Slug)
	if err != nil {
		return m, fmt.Errorf("comercio no encontrado: %q (%v)", q, err)
	}
	return m, nil
}

type Branch struct {
	ID         int
	Name, Hash string
}

func ensureBranch(db *sql.DB, alliedID int, preferHash string) (Branch, error) {
	var b Branch
	if preferHash != "" {
		if err := db.QueryRow(
			"SELECT id, name, COALESCE(hash,'') FROM allied_branches WHERE allied_id=? AND hash=? AND status=1 LIMIT 1",
			alliedID, preferHash).Scan(&b.ID, &b.Name, &b.Hash); err == nil {
			return b, nil
		}
	}
	if err := db.QueryRow(
		"SELECT id, name, COALESCE(hash,'') FROM allied_branches WHERE allied_id=? AND status=1 ORDER BY id LIMIT 1",
		alliedID).Scan(&b.ID, &b.Name, &b.Hash); err != nil {
		return b, fmt.Errorf("comercio #%d sin branch activo", alliedID)
	}
	return b, nil
}

// --- crear asesor ---

// hash bcrypt placeholder (no se usa: el login es por header x-cognito-identity-id; columna NOT NULL).
const placeholderPassword = "$2y$12$uBbVUxorF2lcsD0KsWA5J.vkzlV//OSy7wOx7WchEBMKRWxP4TnH."

var roleProfiles = map[string]string{
	"comercial": "Comercial", "asesor": "Comercial",
	"administrador": "Administrador", "admin": "Administrador",
	"analista": "Analista", "superadmin": "Superadmin comercio", "admincomercio": "Admin comercio",
}
var roleSlugs = map[string]string{
	"comercial": "adviser", "asesor": "adviser",
	"administrador": "administrator", "admin": "administrator",
	"analista": "analyst", "superadmin": "super-admin", "admincomercio": "merchant-admin",
}

type CreatedAsesor struct {
	ID                 int
	CognitoID, Email   string
	AlliedID, BranchID int
	Profile            string
}

func createAsesor(db *sql.DB, role, merchantSlug string, alliedID, branchID int, seed string) (CreatedAsesor, error) {
	var out CreatedAsesor
	profile := roleProfiles[strings.ToLower(role)]
	if profile == "" {
		profile = role
	}
	slug := sanitizeSlug(roleSlugs[strings.ToLower(role)])
	if slug == "" {
		slug = sanitizeSlug(role)
	}
	clean := strings.ReplaceAll(slug, "-", "")
	cognito := seed + "-" + slug + "-test"
	domain := domainSlug(merchantSlug)
	email := cognito + "@" + domain + ".com"
	out.CognitoID, out.Email, out.AlliedID, out.BranchID, out.Profile = cognito, email, alliedID, branchID, profile

	var profileID int
	db.QueryRow("SELECT id FROM user_profiles WHERE name=? LIMIT 1", profile).Scan(&profileID)
	doc := strings.ToUpper("T" + seed + clean)
	if len(doc) > 20 {
		doc = doc[:20]
	}
	cols := []string{"cognito_id", "first_name", "surname", "full_name", "email", "cell_phone",
		"document_number", "document_type", "country_id", "allied_id", "allied_branch_id",
		"user_profile_id", "status", "password"}
	vals := []any{cognito, strings.ToUpper(clean), "TEST", strings.ToUpper(clean) + " TEST", email,
		uniquePhone(cognito), doc, "CC", 1, alliedID, branchID, nullIfZero(profileID), 1, placeholderPassword}

	var existing int
	if db.QueryRow("SELECT id FROM users WHERE cognito_id=? LIMIT 1", cognito).Scan(&existing) == nil && existing > 0 {
		sets := make([]string, len(cols))
		for i, c := range cols {
			sets[i] = "`" + c + "`=?"
		}
		if _, err := db.Exec(fmt.Sprintf("UPDATE users SET %s, updated_at=NOW() WHERE id=?", strings.Join(sets, ", ")),
			append(append([]any{}, vals...), existing)...); err != nil {
			return out, err
		}
		out.ID = existing
	} else {
		colList := make([]string, len(cols))
		ph := make([]string, len(cols))
		for i, c := range cols {
			colList[i] = "`" + c + "`"
			ph[i] = "?"
		}
		res, err := db.Exec(fmt.Sprintf("INSERT INTO users (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())",
			strings.Join(colList, ", "), strings.Join(ph, ", ")), vals...)
		if err != nil {
			return out, err
		}
		id, _ := res.LastInsertId()
		out.ID = int(id)
	}
	if profileID > 0 {
		db.Exec(`REPLACE INTO model_has_roles (role_id, model_type, model_id) VALUES (?, 'App\\Models\\User', ?)`, profileID, out.ID)
	}
	return out, nil
}

// --- usuario sintético + KYC armado (sin llamadas externas) ---

// synthDoc deriva un documento SINTÉTICO determinístico por seed, en el rango [2900000000,2999999999]
// (10 dígitos, válido como CC) — improbable que choque con un CC real (los reales son < ~1.4B).
func synthDoc(seed string) string {
	var h uint32
	for i := 0; i < len(seed); i++ {
		h = h*31 + uint32(seed[i])
	}
	return fmt.Sprintf("29%08d", h%100000000)
}

func userIDOfRequest(db *sql.DB, uReqID int) int {
	var id int
	db.QueryRow("SELECT user_id FROM user_requests WHERE id = ?", uReqID).Scan(&id)
	return id
}

// branchHashOfRequest devuelve el hash de la sucursal del user_request (para derivar reglas). Vacío si
// no se puede resolver (el caller cae a perfil por defecto).
func branchHashOfRequest(db *sql.DB, uReqID int) string {
	var h string
	db.QueryRow(`SELECT COALESCE(ab.hash,'') FROM user_requests ur
		JOIN allied_branches ab ON ab.id = ur.allied_branch_id WHERE ur.id = ? LIMIT 1`, uReqID).Scan(&h)
	return h
}

// setSynthIdentity fija una identidad sintética en el user (por id): doc + nombres + fechas + email.
// `age` es una COLUMNA real en users (no se calcula de date_of_birth en el path de group rules:
// validateRulesByLender la lee con DB::table('users')->...->age) → hay que setearla (18..82).
func setSynthIdentity(db *sql.DB, userID int, doc, email, gender string, age int) {
	db.Exec(`UPDATE users SET document_type='CC', document_number=?, first_name='SYNTH', surname='TEST USER',
		full_name='SYNTH TEST USER', email=?, date_of_birth='1990-01-01', expedition_date='2010-01-01',
		age=?, gender=?, updated_at=NOW() WHERE id=?`, doc, email, age, gender, userID)
}

// injectSummary inserta/actualiza user_summaries (agildata + datacredito) SINTÉTICO — esto es el "KYC
// armado": el marketplace + LenderUserCategoryService leen de acá (no vuelven a llamar al externo).
// El datacredito fabrica el data.agregatedInfo / creditCard / liabilities que las reglas de elegibilidad
// chequean (tc_vector_validation, min_credit_cards, negativos, capacidad) para un perfil LIMPIO ideal.
func injectSummary(db *sql.DB, userID, income, score int) {
	agildata := fmt.Sprintf(`{"employed":true,"self_employed":false,"retired":false,"approximate_real_salary":%d,"last_payment_value":%d,"lowest_payment_value":%d,"continuity_3_months":true,"continuity_6_months":true,"continuity_12_months":true}`,
		income, income, income)
	dcMap := map[string]any{"score": score, "value_monthly_payment": income / 3, "data": datacreditoData(income)}
	dcBytes, _ := json.Marshal(dcMap)
	datacredito := string(dcBytes)
	var id int
	db.QueryRow("SELECT id FROM user_summaries WHERE user_id = ? LIMIT 1", userID).Scan(&id)
	if id > 0 {
		db.Exec("UPDATE user_summaries SET agildata=?, datacredito=?, updated_at=NOW() WHERE id=?", agildata, datacredito, id)
	} else {
		db.Exec("INSERT INTO user_summaries (user_id, agildata, datacredito, created_at, updated_at) VALUES (?,?,?,NOW(),NOW())", userID, agildata, datacredito)
	}
}

// injectIncomeFields setea los user_field_values DERIVADOS de las reglas (87 ingreso, 29 ocupación,
// 160 reportado, y lo que pidan las group rules del lender). Upsert por (user, field, form_id=1).
func injectIncomeFields(db *sql.DB, userID, uReqID int, fields map[int]string) {
	for fid, val := range fields {
		var ex int
		db.QueryRow("SELECT id FROM user_field_values WHERE user_id=? AND field_id=? AND form_id=1 LIMIT 1", userID, fid).Scan(&ex)
		if ex > 0 {
			db.Exec("UPDATE user_field_values SET value=?, user_request_id=?, updated_at=NOW() WHERE id=?", val, uReqID, ex)
		} else {
			db.Exec("INSERT INTO user_field_values (field_id, user_id, user_request_id, form_id, value, status, created_at, updated_at) VALUES (?,?,?,1,?,1,NOW(),NOW())",
				fid, userID, uReqID, val)
		}
	}
}

// ensureLenderCredential siembra una lender_allied_credentials para (allied, lender) si falta — la
// necesitan los lenders rt=1 (integración) para ofrecerse. Copia una fila plantilla de OTRO allied del
// mismo lender (como prep). No-op para rt=2/3 (in-platform). Devuelve un mensaje legible.
func ensureLenderCredential(db *sql.DB, alliedID, lenderID int) string {
	var ex int
	db.QueryRow("SELECT id FROM lender_allied_credentials WHERE allied_id=? AND lender_id=? LIMIT 1", alliedID, lenderID).Scan(&ex)
	if ex > 0 {
		return "ya existía"
	}
	var alliedType, credential sql.NullString
	if err := db.QueryRow("SELECT allied_type, credential FROM lender_allied_credentials WHERE lender_id=? LIMIT 1", lenderID).Scan(&alliedType, &credential); err != nil {
		return "sin plantilla para copiar"
	}
	if _, err := db.Exec("INSERT INTO lender_allied_credentials (lender_id, allied_type, allied_id, credential, created_at, updated_at) VALUES (?,?,?,?,NOW(),NOW())",
		lenderID, alliedType, alliedID, credential); err != nil {
		return fmt.Sprintf("error: %v", err)
	}
	return "sembrada (copiada de plantilla)"
}

// datacreditoData fabrica el cuerpo que LenderUserCategoryService lee de `$user->datacredito->data`:
// perfil LIMPIO ideal — 0 negativos/morosidades, pocas consultas, 1 TC activa con vector OK, sin saldo
// en mora, y deuda actual baja (valueMonthlyPayment×1000) para que la capacidad de pago sobre el monto.
func datacreditoData(income int) map[string]any {
	return map[string]any{
		"agregatedInfo": map[string]any{
			"overview": map[string]any{
				"principals": map[string]any{
					"currentNegativeCredits":         0,
					"negativeHistoricalLast12Months": 0,
					"consultedLast6Months":           1,
					"maturationSince":                "2015-01-01", // historial financiero presente → maturationMonths ok
				},
				"balances": map[string]any{
					"valueMonthlyPayment":      100, // ×1000 = 100k de deuda actual → capacidad holgada
					"totalValueBalanceOverdue": 0,
				},
			},
		},
		"creditCard": []any{
			map[string]any{
				"status": map[string]any{
					"account": map[string]any{"businessAccountStatus": "00"}, // 0..7 = activa OK
					"payment": map[string]any{"businessBureauEvent": 1},       // [0,1,47] o 13..45 = OK
				},
				"creditCardAccount": map[string]any{
					"businessBehaviourVectorProduct": "111111111111111111111111", // no solo '-'/espacio → pasa tc_vector
				},
			},
		},
		"liabilities": []any{
			map[string]any{
				"liabilitiesAccount": map[string]any{
					"businessBehaviourVectorProduct": "NNNNNNNNNNNNNNNNNNNNNNNN", // limpio → sin mora
				},
			},
		},
	}
}

// experianRiskCentralID resuelve el id de la central que `$user->datacredito` exige (Acierta+Quanto
// preferido — el de Pullman —, si no Acierta). 0 si no existe.
func experianRiskCentralID(db *sql.DB) int {
	var id int
	db.QueryRow(`SELECT id FROM risk_centrals
		WHERE name IN ('Experian - Acierta+Quanto','Experian - Acierta')
		ORDER BY FIELD(name,'Experian - Acierta+Quanto','Experian - Acierta') LIMIT 1`).Scan(&id)
	return id
}

// injectDatacredito FORJA la fila Experian (risk_central_user_data) que lee CrediPullman: `score` plano
// + `data` ENCRIPTADA igual que Laravel (cast encrypted:collection, AES-256-CBC con APP_KEY). Sin esto
// el listado nunca ofrece los lenders Creditop X aunque el resto del KYC esté armado. Reemplaza la fila
// previa del mismo (user, central). Devuelve error si falta APP_KEY o la central.
func injectDatacredito(db *sql.DB, appKey string, userID, income, score int) error {
	if appKey == "" {
		return fmt.Errorf("falta APP_KEY en .env.dev (necesario para encriptar el datacredito)")
	}
	rcID := experianRiskCentralID(db)
	if rcID == 0 {
		return fmt.Errorf("no encontré risk_central Experian (Acierta/+Quanto) en dev")
	}
	pt, _ := json.Marshal(datacreditoData(income))
	enc, err := laravelEncrypt(appKey, string(pt))
	if err != nil {
		return fmt.Errorf("encrypt datacredito: %w", err)
	}
	db.Exec("DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?", userID, rcID)
	_, err = db.Exec(`INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at)
		VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())`, userID, rcID, score, enc)
	return err
}

// --- limpieza (uno a uno, por clave; NUNCA bulk) ---

var childTables = []string{
	"confirmation_email_logs", "lender_transactions", "user_request_products",
	"user_request_modes", "user_request_device_infos", "risk_central_user_data",
	"user_summaries", "user_field_values", "creditop_x_consents",
	"revolving_credits", "promissory_notes", "logs", "twilio_logs",
	"creditop_x_user_requests_records", "creditop_x_revolving_credits",
	"user_requests_by_ecommerce_request",
}

// scrubIdentity borra los user(s) que matcheen CUALQUIERA de (tel, doc, email) + sus user_requests +
// filas hijas, por id. Ignora campos vacíos. Deja la identidad de prueba limpia sin tocar ajenos.
func scrubIdentity(db *sql.DB, phone, doc, email string) int {
	var conds []string
	var args []any
	for _, c := range []struct{ col, val string }{{"cell_phone", phone}, {"document_number", doc}, {"email", email}} {
		if c.val != "" {
			conds = append(conds, c.col+"=?")
			args = append(args, c.val)
		}
	}
	if len(conds) == 0 {
		return 0
	}
	ids := queryIDs(db, "SELECT id FROM users WHERE "+strings.Join(conds, " OR "), args...)
	return deleteUsers(db, ids)
}

// deleteUsers borra los users dados + sus user_requests + filas hijas, por id (FK checks off).
func deleteUsers(db *sql.DB, userIDs []int) int {
	if len(userIDs) == 0 {
		return 0
	}
	reqIDs := queryIDs(db, "SELECT id FROM user_requests WHERE user_id IN ("+placeholders(len(userIDs))+")", toAny(userIDs)...)
	db.Exec("SET FOREIGN_KEY_CHECKS=0")
	for _, t := range childTables {
		if len(reqIDs) > 0 {
			db.Exec(fmt.Sprintf("DELETE FROM %s WHERE user_request_id IN (%s)", t, placeholders(len(reqIDs))), toAny(reqIDs)...)
		}
		db.Exec(fmt.Sprintf("DELETE FROM %s WHERE user_id IN (%s)", t, placeholders(len(userIDs))), toAny(userIDs)...)
	}
	db.Exec("DELETE FROM user_requests WHERE user_id IN ("+placeholders(len(userIDs))+")", toAny(userIDs)...)
	db.Exec("DELETE FROM model_has_roles WHERE model_id IN ("+placeholders(len(userIDs))+")", toAny(userIDs)...)
	db.Exec("DELETE FROM users WHERE id IN ("+placeholders(len(userIDs))+")", toAny(userIDs)...)
	db.Exec("SET FOREIGN_KEY_CHECKS=1")
	return len(userIDs)
}

// cleanSeed borra el namespace del seed (asesores sintéticos `{seed}-%-test`) + sus requests/hijos.
func cleanSeed(db *sql.DB, seed string) int {
	ids := queryIDs(db, "SELECT id FROM users WHERE cognito_id LIKE ? OR email LIKE ?", seed+"-%-test", seed+"-%-test@%")
	return deleteUsers(db, ids)
}

// --- helpers ---

func queryIDs(db *sql.DB, q string, args ...any) []int {
	rows, err := db.Query(q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil && id > 0 {
			out = append(out, id)
		}
	}
	return out
}

func placeholders(n int) string {
	if n <= 0 {
		return "NULL"
	}
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

func toAny(ids []int) []any {
	out := make([]any, len(ids))
	for i, v := range ids {
		out[i] = v
	}
	return out
}

func sanitizeSlug(s string) string {
	var b strings.Builder
	for _, c := range strings.ToLower(s) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' {
			b.WriteRune(c)
		}
	}
	if out := b.String(); out != "" {
		return out
	}
	return "user"
}

func domainSlug(s string) string {
	d := strings.ReplaceAll(sanitizeSlug(s), "-", "")
	if d == "" {
		return "creditop"
	}
	return d
}

func uniquePhone(id string) string {
	var h uint32
	for i := 0; i < len(id); i++ {
		h = h*31 + uint32(id[i])
	}
	return fmt.Sprintf("3%09d", h%1_000_000_000)
}

func nullIfZero(n int) any {
	if n == 0 {
		return nil
	}
	return n
}
