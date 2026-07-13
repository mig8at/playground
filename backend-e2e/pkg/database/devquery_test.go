package database

// Consultas READ-ONLY exploratorias contra el RDS de dev (se MANTIENE entre iteraciones).
// SOLO SELECT acá — nunca INSERT/UPDATE/DELETE. Skipea sin E2E_DB_*. Correr:
//   cd backend-e2e && set -a; source .env.dev; set +a
//   go test ./pkg/database/ -run TestQueryDevUsers -v -count=1

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

func TestQueryDevUsers(t *testing.T) {
	host := os.Getenv("E2E_DB_HOST")
	if host == "" {
		t.Skip("E2E_DB_* no seteado (set -a; source .env.dev; set +a)")
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=6s&readTimeout=12s",
		os.Getenv("E2E_DB_USER"), os.Getenv("E2E_DB_PASS"), host,
		os.Getenv("E2E_DB_PORT"), os.Getenv("E2E_DB_NAME"))
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		t.Fatalf("ping falló (¿VPN / security group / creds?): %v", err)
	}
	t.Log("✓ conexión al RDS dev OK")

	var total, withCognito int
	db.QueryRow("SELECT COUNT(*) FROM users WHERE user_profile_id=4 AND status=1").Scan(&total)
	db.QueryRow("SELECT COUNT(*) FROM users WHERE user_profile_id=4 AND status=1 AND cognito_id IS NOT NULL AND cognito_id<>''").Scan(&withCognito)
	t.Logf("Comercial(perfil 4) activos: %d · con cognito_id: %d", total, withCognito)

	rows, err := db.Query(`
		SELECT id, cognito_id, email, allied_id, allied_branch_id
		FROM users
		WHERE user_profile_id=4 AND status=1
		  AND cognito_id IS NOT NULL AND cognito_id<>''
		  AND allied_branch_id IS NOT NULL
		ORDER BY id DESC LIMIT 15`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, alliedID, branchID sql.NullInt64
		var cognito, email sql.NullString
		if err := rows.Scan(&id, &cognito, &email, &alliedID, &branchID); err != nil {
			t.Fatalf("scan: %v", err)
		}
		n++
		t.Logf("  id=%-8d cognito_id=%-40s allied=%-5d branch=%-6d email=%s",
			id.Int64, cognito.String, alliedID.Int64, branchID.Int64, maskEmail(email.String))
	}
	if n == 0 {
		t.Log("  (ningún Comercial con cognito_id + branch — habría que crear uno)")
	}
}

func maskEmail(e string) string {
	at := strings.IndexByte(e, '@')
	if at <= 1 {
		return e
	}
	return e[:1] + "***" + e[at:]
}

// openDevDB abre el RDS dev desde env (skip si no está). Helper read-only compartido.
func openDevDB(t *testing.T) *sql.DB {
	if os.Getenv("E2E_DB_HOST") == "" {
		t.Skip("E2E_DB_* no seteado (set -a; source .env.dev; set +a)")
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=6s&readTimeout=12s",
		os.Getenv("E2E_DB_USER"), os.Getenv("E2E_DB_PASS"), os.Getenv("E2E_DB_HOST"),
		os.Getenv("E2E_DB_PORT"), os.Getenv("E2E_DB_NAME"))
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return db
}

// TestFindTestCustomers — datos de los CLIENTES de prueba para el flujo de crédito (los que el
// KYC real reconoce). go test ./pkg/database/ -run TestFindTestCustomers -v -count=1
func TestFindTestCustomers(t *testing.T) {
	db := openDevDB(t)
	defer db.Close()
	rows, err := db.Query(`
		SELECT id, COALESCE(document_type,''), COALESCE(document_number,''),
		       COALESCE(DATE_FORMAT(expedition_date,'%Y-%m-%d'),''),
		       COALESCE(DATE_FORMAT(date_of_birth,'%Y-%m-%d'),''),
		       COALESCE(gender,''), COALESCE(full_name,''),
		       COALESCE(cell_phone,''), COALESCE(email,'')
		FROM users
		WHERE full_name LIKE '%viloria%' OR full_name LIKE '%riascos%'
		   OR (full_name LIKE '%jose%' AND full_name LIKE '%escobar%')
		   OR full_name LIKE '%yamid%' OR full_name LIKE '%joel%'
		ORDER BY id DESC LIMIT 25`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id int
		var dt, dn, exp, dob, gen, full, phone, email string
		if err := rows.Scan(&id, &dt, &dn, &exp, &dob, &gen, &full, &phone, &email); err != nil {
			t.Fatalf("scan: %v", err)
		}
		n++
		t.Logf("id=%-8d %-3s %-12s exp=%s nac=%s %s · %-28s · tel=%-12s · %s", id, dt, dn, exp, dob, gen, full, phone, email)
	}
	t.Logf("→ %d clientes de prueba", n)
}

// TestCustomerFields — descubre DÓNDE vive la fecha de expedición (y demás campos KYC) de un
// cliente de prueba: vuelca su fila de `users` + sus `user_field_values`.
// go test ./pkg/database/ -run TestCustomerFields -v -count=1
func TestCustomerFields(t *testing.T) {
	db := openDevDB(t)
	defer db.Close()
	const joel = 1827186 // JOEL SEBASTIAN RIASCOS HURTADO, doc 1001065139

	t.Logf("── users (id=%d) — columnas no vacías ──", joel)
	dumpQuery(t, db, "SELECT * FROM users WHERE id = ?", joel)

	t.Logf("── user_field_values (user_id=%d) ──", joel)
	dumpQuery(t, db, "SELECT * FROM user_field_values WHERE user_id = ? LIMIT 50", joel)
}

// dumpQuery imprime las columnas NO vacías de cada fila (esquema-agnóstico), salteando ruido.
func dumpQuery(t *testing.T, db *sql.DB, q string, args ...any) {
	skip := map[string]bool{"password": true, "remember_token": true}
	rows, err := db.Query(q, args...)
	if err != nil {
		t.Logf("  (query falló: %v)", err)
		return
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	n := 0
	for rows.Next() {
		vals := make([]sql.RawBytes, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if rows.Scan(ptrs...) != nil {
			continue
		}
		n++
		var parts []string
		for i, c := range cols {
			if len(vals[i]) > 0 && !skip[strings.ToLower(c)] {
				parts = append(parts, c+"="+string(vals[i]))
			}
		}
		t.Logf("  [%d] %s", n, strings.Join(parts, " · "))
	}
	if n == 0 {
		t.Log("  (sin filas)")
	}
}

// TestInspectDoc — inspecciona el user que ya tiene un documento (E2E_CUSTOMER_DOC) + su historial,
// para decidir si es seguro liberarlo. go test ./pkg/database/ -run TestInspectDoc -v -count=1
func TestInspectDoc(t *testing.T) {
	db := openDevDB(t)
	defer db.Close()
	doc := os.Getenv("E2E_CUSTOMER_DOC")
	if doc == "" {
		t.Skip("E2E_CUSTOMER_DOC vacío")
	}
	t.Logf("── users con doc %s ──", doc)
	dumpQuery(t, db, "SELECT id, document_type, document_number, full_name, cell_phone, email, user_profile_id, status, created_at FROM users WHERE document_number = ?", doc)
	t.Log("── user_requests de ese user (historial) ──")
	dumpQuery(t, db, "SELECT id, user_id, user_request_status_id, lender_id, created_at FROM user_requests WHERE user_id IN (SELECT id FROM users WHERE document_number = ?) ORDER BY id DESC LIMIT 10", doc)
}

// TestOtpBypass — diagnostica cómo saltar el OTP en dev: (1) setting qa_otp_bypass_phones (mecanismo
// QA legítimo), (2) formato del otp_code en `otps` (¿plaintext numérico → leíble?). NO vuelca códigos.
func TestOtpBypass(t *testing.T) {
	db := openDevDB(t)
	defer db.Close()

	t.Log("── settings OTP / bypass ──")
	srows, err := db.Query("SELECT COALESCE(code,''), COALESCE(`key`,''), COALESCE(value,'') FROM settings WHERE `key` LIKE '%otp%' OR `key` LIKE '%bypass%' OR code LIKE '%otp%' OR code LIKE '%bypass%' LIMIT 20")
	if err != nil {
		t.Logf("  (settings query falló: %v)", err)
	} else {
		any := false
		for srows.Next() {
			var code, key, val string
			srows.Scan(&code, &key, &val)
			any = true
			has677 := strings.Contains(val, "3016992677")
			has101 := strings.Contains(val, "3131010101")
			t.Logf("  key=%q · contiene 3016992677=%v · contiene 3131010101=%v", key, has677, has101)
			t.Logf("    value=%s", val)
		}
		srows.Close()
		if !any {
			t.Log("  (sin settings otp/bypass)")
		}
	}

	t.Log("── formato de `otps` (sin volcar códigos) ──")
	frows, err := db.Query("SELECT (otp_code REGEXP '^[0-9]{4,8}$') AS is_num, LENGTH(otp_code) AS len, COALESCE(validated,-1) FROM otps ORDER BY id DESC LIMIT 5")
	if err != nil {
		t.Logf("  (otps query falló: %v)", err)
		return
	}
	defer frows.Close()
	for frows.Next() {
		var isNum, length, validated int
		frows.Scan(&isNum, &length, &validated)
		t.Logf("  otp_code: numérico=%d len=%d validated=%d", isNum, length, validated)
	}
}
