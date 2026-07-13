// prep — siembra PRECONDICIONALES de pruebas E2E (idempotente). Portado de
// creditop-cli/src/lib/prep.ts + asesor.ts.
//
// Para correr un triplete contra (merchant, lender) típicamente hace falta: un BRANCH
// activo, una fila en `lenders_by_allieds` (que el comercio OFREZCA el lender), una
// `lender_allied_credentials` si el lender es rt=1 con integración externa, y un ASESOR
// Comercial atado al branch. `prep` encadena todo eso de forma idempotente (UPSERT por
// seed, oferta/credencial solo si faltan).
//
// Salida: `export KEY=value` (stdout, eval-friendly) + resumen humano (stderr). Así:
//   eval "$(go run . prep --merchant pullman --lender credipullman)"
//
// Por qué BD directa y no API REST: lenders_by_allieds / lender_allied_credentials no
// tienen endpoint en legacy-backend (solo viven en application/admin Inertia). Ver
// docs/hallazgos-backend.md. Toca SIEMPRE la BD local (mirror de dev) — CONVENCIONES.md.

package main

import (
	"creditop-tests/lender"
	"creditop-tests/merchant"
	"creditop-tests/pkg/client"
	"creditop-tests/pkg/config"
	"creditop-tests/pkg/database"
	"creditop-tests/pkg/identity"
	"database/sql"
	"fmt"
	"os"
	"strings"
)

// Hash bcrypt placeholder (Hash::make("test1234")). La password no se usa (el login es
// por header x-cognito-identity-id), pero la columna es NOT NULL.
const placeholderPassword = "$2y$12$uBbVUxorF2lcsD0KsWA5J.vkzlV//OSy7wOx7WchEBMKRWxP4TnH."

type prepOpts struct {
	merchant, lender, asesor, branch string
	ecommerce                        bool
	cognitoID                        string // sub real del usuario Cognito → asesor LOGUEABLE por el hub
}

func parsePrepFlags(args []string) prepOpts {
	o := prepOpts{asesor: "comercial"}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--ecommerce" {
			o.ecommerce = true
			continue
		}
		// Soporta --key=value y --key value.
		key, val, hasEq := strings.Cut(a, "=")
		next := func() string {
			if hasEq {
				return val
			}
			if i+1 < len(args) {
				i++
				return args[i]
			}
			return ""
		}
		switch key {
		case "--merchant", "-m":
			o.merchant = next()
		case "--lender", "-l":
			o.lender = next()
		case "--asesor":
			o.asesor = next()
		case "--branch":
			o.branch = next()
		case "--cognito-id":
			o.cognitoID = next()
		}
	}
	return o
}

func runPrep(args []string) {
	o := parsePrepFlags(args)
	if o.merchant == "" || o.lender == "" {
		fmt.Fprintln(os.Stderr, "uso: go run . prep --merchant X --lender Y [--asesor name] [--branch hash]")
		os.Exit(2)
	}

	db := database.Connect(config.GetConfig(target))
	defer db.Close()

	m, err := merchant.Resolve(db, o.merchant)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ comercio no encontrado: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	l, err := lender.Resolve(db, o.lender)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ lender no encontrado: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}

	branch, err := ensureBranch(db, m.AlliedID, o.branch)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ branch: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	offerPre, err := ensureMerchantOffersLender(db, m.AlliedID, l.ID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ oferta lenders_by_allieds: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	cred := ensureLenderAlliedCredential(db, m.AlliedID, l.ID, l.ResponseType)
	ecomCred := ""
	if o.ecommerce {
		ecomCred = ensureEcommerceCredential(db, m.AlliedID, branch.id)
	}
	seed := identity.Seed()
	asesor, err := createAsesor(db, descriptiveRoleSlug(o.asesor), domainSlug(o.merchant), m.AlliedID, branch.id, "Comercial", seed)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s✗ asesor: %v%s\n", client.CRed, err, client.CReset)
		os.Exit(1)
	}
	// Asesor LOGUEABLE por Cognito: cognito_id = el sub real del usuario del hub. Al loguearte en el
	// Hosted UI con ese usuario, el backend (ResolveCognitoUser por header) te resuelve como ESTE asesor.
	var cognitoAsesor createdAsesor
	if o.cognitoID != "" {
		cognitoAsesor, err = ensureCognitoAsesor(db, m.AlliedID, branch.id, o.cognitoID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s⚠ asesor cognito: %v%s\n", client.CRed, err, client.CReset)
		}
	}

	// Resumen humano → stderr (no contamina los exports de stdout).
	g := func(s string) string { return client.CGreen + s + client.CReset }
	fmt.Fprintf(os.Stderr, "%s✓ Comercio:%s  %s (allied #%d, hash %s)\n", client.CGreen, client.CReset, m.Name, m.AlliedID, m.Hash)
	fmt.Fprintf(os.Stderr, "%s✓ Branch:%s    %s (#%d, hash %s)\n", client.CGreen, client.CReset, branch.name, branch.id, branch.hash)
	fmt.Fprintf(os.Stderr, "%s✓ Lender:%s    %s (#%d, rt=%d)\n", client.CGreen, client.CReset, l.Name, l.ID, l.ResponseType)
	if offerPre {
		fmt.Fprintf(os.Stderr, "  Oferta en lenders_by_allieds: preexistía\n")
	} else {
		fmt.Fprintf(os.Stderr, "  Oferta en lenders_by_allieds: %s\n", g("sembrada"))
	}
	fmt.Fprintf(os.Stderr, "  Credencial:  %s\n", cred)
	if o.ecommerce {
		fmt.Fprintf(os.Stderr, "  Ecommerce:   %s\n", ecomCred)
	}
	fmt.Fprintf(os.Stderr, "%s✓ Asesor:%s    %s (cognito_id %s)\n", client.CGreen, client.CReset, asesor.email, asesor.cognitoID)
	if o.cognitoID != "" && cognitoAsesor.id > 0 {
		fmt.Fprintf(os.Stderr, "%s✓ Asesor Cognito:%s %s · cognito_id %s (logueable por el hub)\n", client.CGreen, client.CReset, cognitoAsesor.email, cognitoAsesor.cognitoID)
	}

	// Exports eval-friendly → stdout.
	fmt.Printf("export E2E_COGNITO_ID=%q\n", asesor.cognitoID)
	fmt.Printf("export E2E_PARTNER_HASH=%q\n", branch.hash)
	fmt.Printf("export E2E_LENDER_ID=%q\n", fmt.Sprint(l.ID))
	fmt.Printf("export E2E_MERCHANT_ID=%q\n", fmt.Sprint(m.AlliedID))
	fmt.Printf("export E2E_BRANCH_ID=%q\n", fmt.Sprint(branch.id))
	fmt.Printf("export E2E_SEED=%q\n", seed)
	if o.cognitoID != "" && cognitoAsesor.id > 0 {
		fmt.Printf("export E2E_COGNITO_ASESOR_ID=%q\n", cognitoAsesor.cognitoID)
	}
}

// ensureCognitoAsesor crea/actualiza un asesor Comercial del comercio cuyo cognito_id = el sub REAL del
// usuario Cognito del hub. Así, al loguearte en login.creditop.com con ese usuario, el backend
// (ResolveCognitoUser confía en el header x-cognito-identity-id) te resuelve como este asesor. UPSERT
// por cognito_id; email/doc/tel sintéticos namespaced por el sub (no chocan con users reales).
func ensureCognitoAsesor(db *sql.DB, alliedID, branchID int, cognitoID string) (createdAsesor, error) {
	var out createdAsesor
	out.cognitoID = cognitoID
	out.alliedID, out.branchID = alliedID, branchID

	var profileID int
	db.QueryRow("SELECT id FROM user_profiles WHERE name = ? LIMIT 1", "Comercial").Scan(&profileID)
	out.userProfileID = profileID

	clean := keepAlnum(strings.ToLower(cognitoID))
	if len(clean) > 12 {
		clean = clean[:12]
	}
	email := "cog-" + clean + "@creditop.com" // sintético: la resolución es por cognito_id, no por email
	out.email = email
	doc := strings.ToUpper("TC" + clean)
	if len(doc) > 20 {
		doc = doc[:20]
	}

	cols := []string{
		"cognito_id", "first_name", "surname", "full_name", "email", "cell_phone",
		"document_number", "document_type", "country_id", "allied_id", "allied_branch_id",
		"user_profile_id", "status", "password",
	}
	vals := []any{
		cognitoID, "ASESOR", "COGNITO", "ASESOR COGNITO", email, uniquePhone(cognitoID),
		doc, "CC", 1, alliedID, branchID, nullIfZero(profileID), 1, placeholderPassword,
	}

	var existingID int
	db.QueryRow("SELECT id FROM users WHERE cognito_id = ? LIMIT 1", cognitoID).Scan(&existingID)
	if existingID > 0 {
		sets := make([]string, len(cols))
		for i, c := range cols {
			sets[i] = "`" + c + "` = ?"
		}
		args := append(append([]any{}, vals...), existingID)
		if _, err := db.Exec(fmt.Sprintf("UPDATE users SET %s, updated_at = NOW() WHERE id = ?", strings.Join(sets, ", ")), args...); err != nil {
			return out, err
		}
		out.id = existingID
	} else {
		colList := make([]string, len(cols))
		ph := make([]string, len(cols))
		for i, c := range cols {
			colList[i] = "`" + c + "`"
			ph[i] = "?"
		}
		res, err := db.Exec(
			fmt.Sprintf("INSERT INTO users (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())", strings.Join(colList, ", "), strings.Join(ph, ", ")),
			vals...)
		if err != nil {
			return out, err
		}
		id, _ := res.LastInsertId()
		out.id = int(id)
	}
	if profileID > 0 {
		db.Exec(`REPLACE INTO model_has_roles (role_id, model_type, model_id) VALUES (?, 'App\\Models\\User', ?)`, profileID, out.id)
	}
	return out, nil
}

type resolvedBranch struct {
	id         int
	name, hash string
}

// ensureBranch devuelve el branch a usar: si preferHash matchea un branch activo del
// allied lo usa; si no, el primer branch activo. No CREA branches (QR/country_city_id
// exigen contexto que no sembramos a ciegas).
func ensureBranch(db *sql.DB, alliedID int, preferHash string) (resolvedBranch, error) {
	var b resolvedBranch
	if preferHash != "" {
		err := db.QueryRow(
			"SELECT id, name, COALESCE(hash,'') FROM allied_branches WHERE allied_id = ? AND hash = ? AND status = 1 LIMIT 1",
			alliedID, preferHash).Scan(&b.id, &b.name, &b.hash)
		if err == nil {
			return b, nil
		}
	}
	err := db.QueryRow(
		"SELECT id, name, COALESCE(hash,'') FROM allied_branches WHERE allied_id = ? AND status = 1 ORDER BY id LIMIT 1",
		alliedID).Scan(&b.id, &b.name, &b.hash)
	if err != nil {
		return b, fmt.Errorf("comercio #%d no tiene branch activo (crealo por la UI de admin)", alliedID)
	}
	return b, nil
}

// ensureMerchantOffersLender asegura la fila (allied, lender) en lenders_by_allieds. Si
// falta, copia los defaults (rate, FGA, %) de OTRA fila existente del mismo lender. Lanza
// si el lender no tiene ninguna fila plantilla (no se puede inventar la config).
func ensureMerchantOffersLender(db *sql.DB, alliedID, lenderID int) (bool, error) {
	var existing int
	db.QueryRow("SELECT id FROM lenders_by_allieds WHERE allied_id = ? AND lender_id = ? AND status = 1 LIMIT 1",
		alliedID, lenderID).Scan(&existing)
	if existing > 0 {
		return true, nil
	}

	// Copio todas las columnas de una plantilla excepto las auto-managed; reemplazo allied_id.
	rows, err := db.Query("SELECT * FROM lenders_by_allieds WHERE lender_id = ? AND status = 1 LIMIT 1", lenderID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if !rows.Next() {
		return false, fmt.Errorf("lender #%d no tiene ninguna fila plantilla en lenders_by_allieds para copiar", lenderID)
	}
	raw := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return false, err
	}
	rows.Close()

	skip := map[string]bool{"id": true, "created_at": true, "updated_at": true}
	var insCols []string
	var placeholders []string
	var vals []any
	for i, c := range cols {
		if skip[c] {
			continue
		}
		insCols = append(insCols, "`"+c+"`")
		placeholders = append(placeholders, "?")
		if c == "allied_id" {
			vals = append(vals, alliedID)
		} else {
			vals = append(vals, raw[i])
		}
	}
	q := fmt.Sprintf("INSERT INTO lenders_by_allieds (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())",
		strings.Join(insCols, ", "), strings.Join(placeholders, ", "))
	if _, err := db.Exec(q, vals...); err != nil {
		return false, err
	}
	return false, nil
}

// ensureLenderAlliedCredential asegura credencial cuando aplica. rt=2 (Creditop X) y rt=3
// (cupo rotativo) son in-platform → no requieren. Para otros, copia de OTRO allied si falta.
// Devuelve un mensaje legible del resultado.
func ensureLenderAlliedCredential(db *sql.DB, alliedID, lenderID, responseType int) string {
	if responseType == 2 || responseType == 3 {
		return fmt.Sprintf("no requerida (rt=%d in-platform)", responseType)
	}
	var existing int
	db.QueryRow("SELECT id FROM lender_allied_credentials WHERE allied_id = ? AND lender_id = ? LIMIT 1",
		alliedID, lenderID).Scan(&existing)
	if existing > 0 {
		return "ya existía"
	}
	var alliedType, credential sql.NullString
	err := db.QueryRow("SELECT allied_type, credential FROM lender_allied_credentials WHERE lender_id = ? LIMIT 1",
		lenderID).Scan(&alliedType, &credential)
	if err != nil {
		return fmt.Sprintf("⚠ no hay credencial de lender #%d en toda la BD para copiar (rt=%d puede no evaluar)", lenderID, responseType)
	}
	_, err = db.Exec(
		"INSERT INTO lender_allied_credentials (lender_id, allied_type, allied_id, credential, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())",
		lenderID, alliedType, alliedID, credential)
	if err != nil {
		return fmt.Sprintf("⚠ error sembrando credencial: %v", err)
	}
	return "sembrada (copiada de otro comercio)"
}

// wizardEcommerceToken DEBE coincidir con $tokenRaw en github/generate_checkout_url.php (el token que
// la URL del wizard embebe en el param `t`). El handshake valida el token contra credential del branch,
// así que ambos tienen que ser el mismo string para que el flujo MANUAL desde el wizard funcione local.
const wizardEcommerceToken = "3230393766393838643938323032352d30392d3234"

// ensureEcommerceCredential asegura una fila allied_ecommerce_credentials para el branch con
// credential = el token del wizard. Si falta, copia una fila plantilla (cualquiera) y reemplaza
// allied/branch/credential (como ensureMerchantOffersLender). Habilita el handshake ecommerce local.
func ensureEcommerceCredential(db *sql.DB, alliedID, branchID int) string {
	var existing int
	db.QueryRow("SELECT id FROM allied_ecommerce_credentials WHERE allied_branch_id = ? LIMIT 1", branchID).Scan(&existing)
	if existing > 0 {
		db.Exec("UPDATE allied_ecommerce_credentials SET credential = ?, updated_at = NOW() WHERE allied_branch_id = ?", wizardEcommerceToken, branchID)
		return "ya existía (credential alineado al token del wizard)"
	}
	rows, err := db.Query("SELECT * FROM allied_ecommerce_credentials LIMIT 1")
	if err != nil {
		return fmt.Sprintf("⚠ %v", err)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	if !rows.Next() {
		return "⚠ no hay fila plantilla en allied_ecommerce_credentials para copiar"
	}
	raw := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return fmt.Sprintf("⚠ scan: %v", err)
	}
	rows.Close()
	skip := map[string]bool{"id": true, "created_at": true, "updated_at": true}
	var insCols, ph []string
	var vals []any
	for i, c := range cols {
		if skip[c] {
			continue
		}
		insCols = append(insCols, "`"+c+"`")
		ph = append(ph, "?")
		switch c {
		case "allied_id":
			vals = append(vals, alliedID)
		case "allied_branch_id":
			vals = append(vals, branchID)
		case "credential":
			vals = append(vals, wizardEcommerceToken)
		default:
			vals = append(vals, raw[i])
		}
	}
	q := fmt.Sprintf("INSERT INTO allied_ecommerce_credentials (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())",
		strings.Join(insCols, ", "), strings.Join(ph, ", "))
	if _, err := db.Exec(q, vals...); err != nil {
		return fmt.Sprintf("⚠ error sembrando: %v", err)
	}
	return "sembrada (copiada de plantilla, token del wizard)"
}

type createdAsesor struct {
	id                 int
	cognitoID, email   string
	alliedID, branchID int
	userProfileID      int
}

// createAsesor hace UPSERT de un asesor sintético namespaced por seed (cognito_id =
// "{name}__{seed}_test") + fila en model_has_roles. El login es por header
// x-cognito-identity-id (no Cognito real). Portado de asesor.ts::createAsesor.
func createAsesor(db *sql.DB, nameSlug, domain string, alliedID, branchID int, profileName, seed string) (createdAsesor, error) {
	var out createdAsesor
	slug := sanitizeSlug(nameSlug)             // descriptivo, puede tener guiones (ej. "super-admin")
	clean := strings.ReplaceAll(slug, "-", "") // sin guiones, para nombre/documento
	cognito := identity.TestName(seed, slug)   // {seed}-{slug}-test  (ej. "mig-adviser-test")
	if domain == "" {
		domain = "creditop"
	}
	email := cognito + "@" + domain + ".com" // ej. mig-adviser-test@pullman.com
	out.cognitoID, out.email = cognito, email
	out.alliedID, out.branchID = alliedID, branchID

	var profileID int
	db.QueryRow("SELECT id FROM user_profiles WHERE name = ? LIMIT 1", profileName).Scan(&profileID)
	out.userProfileID = profileID

	doc := strings.ToUpper("T" + seed + clean)
	if len(doc) > 20 {
		doc = doc[:20]
	}

	// Columnas en orden estable (UPSERT manual: la BD tiene unique en cell_phone/document_number).
	cols := []string{
		"cognito_id", "first_name", "surname", "full_name", "email", "cell_phone",
		"document_number", "document_type", "country_id", "allied_id", "allied_branch_id",
		"user_profile_id", "status", "password",
	}
	vals := []any{
		cognito, strings.ToUpper(clean), "TEST", strings.ToUpper(clean) + " TEST", email,
		uniquePhone(cognito), doc, "CC", 1, alliedID, branchID,
		nullIfZero(profileID), 1, placeholderPassword,
	}

	var existingID int
	err := db.QueryRow("SELECT id FROM users WHERE cognito_id = ? LIMIT 1", cognito).Scan(&existingID)
	if err == nil && existingID > 0 {
		sets := make([]string, len(cols))
		for i, c := range cols {
			sets[i] = "`" + c + "` = ?"
		}
		args := append(append([]any{}, vals...), existingID)
		if _, err := db.Exec(fmt.Sprintf("UPDATE users SET %s, updated_at = NOW() WHERE id = ?", strings.Join(sets, ", ")), args...); err != nil {
			return out, err
		}
		out.id = existingID
	} else {
		colList := make([]string, len(cols))
		ph := make([]string, len(cols))
		for i, c := range cols {
			colList[i] = "`" + c + "`"
			ph[i] = "?"
		}
		res, err := db.Exec(
			fmt.Sprintf("INSERT INTO users (%s, created_at, updated_at) VALUES (%s, NOW(), NOW())", strings.Join(colList, ", "), strings.Join(ph, ", ")),
			vals...)
		if err != nil {
			return out, err
		}
		id, _ := res.LastInsertId()
		out.id = int(id)
	}

	// Rol spatie best-effort (role_id = user_profile_id, como hace el admin).
	if profileID > 0 {
		db.Exec(`REPLACE INTO model_has_roles (role_id, model_type, model_id) VALUES (?, 'App\\Models\\User', ?)`, profileID, out.id)
	}
	return out, nil
}

func keepAlnum(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// uniquePhone deriva un celular sintético ÚNICO y determinista por identidad (users tiene
// unique en cell_phone). "3" + (hash % 1e9) con padding a 9 dígitos.
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
