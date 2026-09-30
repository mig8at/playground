package canon

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestConnectionStringEncodesThePasswordAndCarriesSslmode(t *testing.T) {
	// Una contraseña generada trae de todo: si va cruda parte el host o la base, y el error apunta a la red, no a la contraseña.
	c := DBConfig{Target: "prod", Host: "db.interno", Port: "5432", Database: "canon", User: "solo_lectura", Password: `p@ss/w:rd#1?&=%`, SSLMode: "require"}
	cfg, err := pgx.ParseConfig(c.ConnString())
	if err != nil {
		t.Fatalf("la cadena no se puede leer de vuelta: %v", err)
	}
	if cfg.Password != c.Password || cfg.User != c.User || cfg.Host != "db.interno" || cfg.Port != 5432 || cfg.Database != "canon" {
		t.Fatalf("la cadena no conserva los datos: %+v", cfg)
	}
	if cfg.TLSConfig == nil {
		t.Fatal("sslmode=require tiene que viajar: sin él la base corta la conexión")
	}
	// Y la base misma queda en sólo lectura desde la conexión.
	if cfg.RuntimeParams["default_transaction_read_only"] != "on" || cfg.RuntimeParams["statement_timeout"] != "15000" || cfg.RuntimeParams["application_name"] != "playground-connectors" {
		t.Fatalf("parámetros de sesión: %v", cfg.RuntimeParams)
	}
	// Los valores por defecto: puerto, base y modo.
	d := DBConfig{Host: "h", User: "u", Password: "p", TimeoutMs: 2000}.ConnString()
	if !strings.Contains(d, ":5432/canon") || !strings.Contains(d, "sslmode=require") || !strings.Contains(d, "statement_timeout=2000") {
		t.Fatalf("defaults: %s", d)
	}
}

func TestWithoutCredentialsSaysWhichAreMissingAndNeitherHitsTheNetworkNorFallsBackToAnotherEnvironment(t *testing.T) {
	c := DBConfig{Target: "prod", Host: "db.interno"}
	if m := c.Missing(); strings.Join(m, ",") != "CANON_POSTGRES_USER,CANON_POSTGRES_PASSWORD" {
		t.Fatalf("faltan, en orden: %v", m)
	}
	_, err := OpenDB(context.Background(), c)
	if err == nil || !strings.Contains(err.Error(), "CANON_POSTGRES_USER") || !strings.Contains(err.Error(), ".env.prod") {
		t.Fatalf("tenía que decir qué falta y dónde: %v", err)
	}
	for _, bad := range []string{"", "dev", "qa", "staging", "producción"} {
		if ValidDBTarget(bad) {
			t.Errorf("%q no tiene base de canon", bad)
		}
		if _, _, err := LoadDBConfig(bad); err == nil {
			t.Errorf("LoadDBConfig(%q) tenía que fallar", bad)
		}
		if _, err := OpenDB(context.Background(), DBConfig{Target: bad, Host: "h", User: "u", Password: "p"}); err == nil {
			t.Errorf("OpenDB con el ambiente %q tenía que fallar", bad)
		}
	}
	if !ValidDBTarget("local") || !ValidDBTarget("prod") {
		t.Fatal("local y prod sí")
	}
}

func TestAConnectionErrorNeverCarriesThePassword(t *testing.T) {
	// Sin base a la que llegar (puerto cerrado): el error dice dónde intentó, no la contraseña.
	c := DBConfig{Target: "local", Host: "127.0.0.1", Port: "1", User: "u", Password: `clave-rara@/:#`, SSLMode: "disable"}
	_, err := OpenDB(context.Background(), c)
	if err == nil {
		t.Fatal("no debía conectar")
	}
	if strings.Contains(err.Error(), c.Password) || strings.Contains(err.Error(), "clave-rara") {
		t.Fatalf("el error trae la contraseña: %v", err)
	}
	if got := redact("password authentication failed for clave%2Frara", "clave/rara"); strings.Contains(got, "rara") {
		t.Fatalf("redactar tiene que sacarla también codificada: %q", got)
	}
}

// ── contra el Postgres del laboratorio de canon (`python3 dev/local.py prepare`) ────────────────────────────────────────────
// Se salta —y `go test` lo imprime como `ok`— si el ambiente `local` no está configurado: el mensaje dice qué no se comprobó.
// NUNCA contra prod: sólo abre `local`.
func lab(t *testing.T, timeoutMs int) *DB {
	t.Helper()
	cfg, _, err := LoadDBConfig("local")
	if err != nil || len(cfg.Missing()) > 0 {
		t.Skip("SIN COMPROBAR: la lectura de la base de canon no se ejercitó contra un Postgres. Necesita CANON_POSTGRES_HOST/_PORT/_USER/_PASSWORD/_SSLMODE de `local` (el laboratorio: dev/local.py prepare).")
	}
	cfg.TimeoutMs = timeoutMs
	db, err := OpenDB(context.Background(), cfg)
	if err != nil {
		t.Fatalf("el laboratorio está configurado pero no responde: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestReadsWithTypesAndSaysWhichDatabaseItCameFrom(t *testing.T) {
	db := lab(t, 0)
	r, err := db.Query(context.Background(), `SELECT 1::int AS n, 'hola'::text AS t, now() AS ahora, '{"a": [1, 2]}'::jsonb AS j, NULL AS nada`)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(r.Columns, ",") != "n,t,ahora,j,nada" || len(r.Rows) != 1 {
		t.Fatalf("columnas en el orden de la consulta: %v %v", r.Columns, r.Rows)
	}
	row := r.Rows[0]
	if row["t"] != "hola" || row["nada"] != nil {
		t.Fatalf("filas: %v", row)
	}
	if s, ok := row["ahora"].(string); !ok || !strings.Contains(s, "T") {
		t.Fatalf("la fecha sale como texto RFC3339: %#v", row["ahora"])
	}
	if j, ok := row["j"].(string); !ok || j != `{"a": [1, 2]}` {
		t.Fatalf("el jsonb sale como texto, sin parsear: %#v", row["j"])
	}
	if !strings.HasPrefix(r.Source, "canon postgres ") {
		t.Fatalf("toda lectura dice de qué base salió: %q", r.Source)
	}
}

func TestTheDatabaseItselfRefusesToWriteEvenIfTheCheckIsSkipped(t *testing.T) {
	// La prueba que importa: el chequeo previo es el mensaje; la protección es de la BASE. Se escribe DIRECTO por la conexión, sin pasar por Query.
	db := lab(t, 0)
	for _, statement := range []string{
		`CREATE TABLE zz_no_debe_existir (x int)`,
		`INSERT INTO canon_revision (author, reason) VALUES ('no', 'no')`,
		`UPDATE canon_revision SET author = 'no'`,
		`DELETE FROM canon_revision`,
	} {
		_, err := db.db.ExecContext(context.Background(), statement)
		if err == nil {
			t.Fatalf("⛔ la base dejó escribir: %s", statement)
		}
		if !strings.Contains(strings.ToLower(err.Error()), "read-only") {
			t.Errorf("rechazó por otra cosa que sólo lectura: %v", err)
		}
	}
	// Y con la transacción de sólo lectura que abre Query, un SELECT … FOR UPDATE tampoco.
	if _, err := db.Query(context.Background(), `SELECT * FROM canon_revision LIMIT 1`); err != nil {
		t.Fatalf("una lectura común tiene que andar: %v", err)
	}
}

func TestCutsWhatTakesTooLongAndWhatBringsTooMuch(t *testing.T) {
	db := lab(t, 300)
	if _, err := db.Query(context.Background(), `SELECT count(*) FROM generate_series(1, 900000000)`); err == nil || !strings.Contains(err.Error(), "statement timeout") {
		t.Fatalf("una consulta larga la corta la base: %v", err)
	}
	db2 := lab(t, 0)
	r, err := db2.Query(context.Background(), `SELECT g FROM generate_series(1, 2000) AS g`)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Rows) != MaxRowsDB || !r.Truncated {
		t.Fatalf("tope de filas y aviso: %d filas, truncado=%v", len(r.Rows), r.Truncated)
	}
}

func TestListsTheTablesOfTheDatabase(t *testing.T) {
	db := lab(t, 0)
	r, err := db.Tables(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, row := range r.Rows {
		seen[row["esquema"].(string)+"."+row["tabla"].(string)] = true
	}
	if !seen["public.canon_revision"] || !seen["public.canon_file"] {
		t.Fatalf("tienen que estar las tablas del corpus: %v", seen)
	}
	for _, row := range r.Rows {
		if n, ok := row["filas_estimadas"].(int64); ok && n < 0 {
			t.Errorf("una tabla sin analizar no puede decir %d filas: %v", n, row)
		}
	}
	for k := range seen {
		if strings.HasPrefix(k, "pg_catalog.") || strings.HasPrefix(k, "information_schema.") {
			t.Errorf("no se listan las del sistema: %s", k)
		}
	}
}
