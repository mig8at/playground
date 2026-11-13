package sql

// No persiguen cobertura: cada una fija una lógica que ya dio, o podía dar, una respuesta equivocada.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Los casos que frenaba cada una de las dos guardas que había, juntos: si la unión perdiera uno, una
// escritura saldría a la red.
func TestValidateReadOnly(t *testing.T) {
	for _, q := range []string{
		"SELECT id FROM user_requests",
		"with recientes AS (SELECT id FROM user_requests) SELECT * FROM recientes",
		"SELECT REPLACE(name, 'a', 'b'), INSERT(name, 1, 2, 'x') FROM lenders",
		"SELECT updated_at FROM inserts;",
		"SELECT 1 -- update users\n",
		"SELECT 1 /* delete */",
		// Lo que hay entre comillas es texto, no sintaxis (antes rechazaba la primera por el 'drop').
		"SELECT 'drop' AS word, 'a;b' AS semi, '--x' AS dash FROM t",
		"SELECT `update` FROM t WHERE name = 'it''s' OR note = 'a\\'b'",
		"SELECT 5 - -1, 3 # un comentario con delete\n",
	} {
		if err := ValidateReadOnly(q); err != nil {
			t.Errorf("rechazó una lectura %q: %v", q, err)
		}
	}
	for _, q := range []string{
		"", "   -- sólo un comentario",
		"DELETE FROM users",
		"SHOW TABLES",
		"SELECT * INTO OUTFILE '/tmp/a' FROM users",
		"SELECT * FROM users INTO DUMPFILE '/tmp/b'",
		"SELECT 1; DELETE FROM users",
		"SELECT 1 FROM t WHERE x IN (SELECT 1) UNION SELECT 1 FROM t; DROP TABLE t",
		"WITH x AS (SELECT 1) UPDATE users SET a = 1",
		"SELECT '" + strings.Repeat("a", MaxQuery) + "'",
		// Los agujeros del borrado de comentarios por líneas (2026-09-25): los tres pasaban.
		"SELECT 1 /*!50000 INTO OUTFILE '/tmp/x' */",
		"SELECT 5--1 INTO OUTFILE '/tmp/x'",
		"SELECT 'x'; DROP TABLE t",
		"SELECT 'sin cerrar FROM t",
	} {
		if err := ValidateReadOnly(q); err == nil {
			t.Errorf("dejó pasar %q", q[:min(len(q), 60)])
		}
	}
}

func TestTheTargetIsMandatoryAndThereAreFive(t *testing.T) {
	for _, target := range []string{"local", "dev", "qa", "staging", "prod"} {
		if !ValidTarget(target) {
			t.Errorf("%s tendría que ser válido", target)
		}
	}
	for _, target := range []string{"", "production", "../x", "QA"} {
		if _, err := Open(Config{Target: target, Host: "x"}); err == nil {
			t.Errorf("Open aceptó el ambiente %q", target)
		}
	}
}

// Sin fuente configurada no se lee otra cosa: se falla con el motivo.
func TestAnUnconfiguredTargetFailsInsteadOfFallingBack(t *testing.T) {
	if _, err := Open(Config{Target: "dev"}); err == nil || !strings.Contains(err.Error(), "no hay fuente para dev") {
		t.Errorf("err = %v", err)
	}
	if _, err := Open(Config{Target: "dev", Host: "h", Name: "n", User: "u"}); err == nil || !strings.Contains(err.Error(), "contraseña") {
		t.Errorf("un MySQL a medias tenía que fallar por la contraseña; dio %v", err)
	}
}

// La interpolación de Redash sólo es segura con dígitos: cualquier otra cosa no sale.
func TestArgumentsThatAreNotDigitsNeverReachRedash(t *testing.T) {
	src := &redashSource{base: "http://no-se-llama", http: http.DefaultClient}
	for _, arg := range []any{"1 OR 1=1", "'x'", "", -1, 1.5} {
		if _, err := src.Rows("SELECT * FROM t WHERE id = ?", arg); err == nil || !strings.Contains(err.Error(), "dígitos") {
			t.Errorf("el argumento %v salió: %v", arg, err)
		}
	}
}

// El ciclo de Redash: el trabajo, la espera y el resultado, con los `?` interpolados y el token en su
// cabecera.
func TestRedashRunsTheJobAndInterpolatesDigits(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		if r.Header.Get("Authorization") != "Key token-de-prueba" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/api/query_results":
			var body struct {
				Query string `json:"query"`
				DS    int    `json:"data_source_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body.Query != "SELECT id FROM lenders WHERE id = 77" || body.DS != 7 {
				t.Errorf("body = %+v", body)
			}
			_, _ = w.Write([]byte(`{"job":{"id":"j1","status":1}}`))
		case "/api/jobs/j1":
			_, _ = w.Write([]byte(`{"job":{"status":3,"query_result_id":9}}`))
		case "/api/query_results/9":
			_, _ = w.Write([]byte(`{"query_result":{"data":{"rows":[{"id":77,"name":"Prueba","amount":1560414.0,"grande":12345678901}]}}}`))
		}
	}))
	defer server.Close()
	src, err := Open(Config{Target: "prod", RedashURL: server.URL, RedashToken: "token-de-prueba", RedashDataSource: 7})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := src.Rows("SELECT id FROM lenders WHERE id = ?", 77)
	if err != nil {
		t.Fatal(err)
	}
	if src.Name() != "redash ds=7" || len(rows) != 1 || rows[0]["name"] != "Prueba" || src.Zone().String() != "America/Bogota" {
		t.Errorf("name=%s rows=%v zone=%s", src.Name(), rows, src.Zone())
	}
	// los números llegan como su literal: decodificados a float64 se imprimían en notación científica
	if got := fmt.Sprint(rows[0]["amount"], " ", rows[0]["grande"]); got != "1560414.0 12345678901" {
		t.Errorf("los números de Redash cambiaron: %s", got)
	}
	if strings.Join(Columns(rows), ",") != "amount,grande,id,name" || len(calls) != 3 {
		t.Errorf("columnas %v, llamadas %v", Columns(rows), calls)
	}
}

// Las credenciales salen de connectors/.env.<target>, y el proceso gana.
func TestLoadConfigReadsTheConnectorsFileAndTheProcessWins(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "connectors", "env"), 0o755)
	os.WriteFile(filepath.Join(root, "connectors", ".env.qa"), []byte("E2E_DB_HOST=archivo\nE2E_DB_NAME=creditop\nDB_USER=nunca\n"), 0o600)
	wd, _ := os.Getwd()
	defer os.Chdir(wd)
	os.MkdirAll(filepath.Join(root, "tablero", "server"), 0o755)
	os.Chdir(filepath.Join(root, "tablero", "server"))
	t.Setenv("E2E_DB_NAME", "del-proceso")
	// ⚠ el DB_HOST de una terminal preparada para artisan no puede cambiarle la base al conector
	t.Setenv("DB_HOST", "el-de-laravel")
	c, file, err := LoadConfig("qa")
	if err != nil {
		t.Fatal(err)
	}
	if c.Host != "archivo" || c.Name != "del-proceso" || c.User != "" || !strings.HasSuffix(file, filepath.Join("connectors", ".env.qa")) {
		t.Errorf("config = %+v, archivo %s", c, file)
	}
	if _, _, err := LoadConfig("produccion"); err == nil {
		t.Error("LoadConfig aceptó un ambiente inventado")
	}
}

// Las columnas salen en el orden de la consulta, no alfabéticas; el alfabético queda de respaldo.
func TestOrderedColumnsKeepTheOrderOfTheQuery(t *testing.T) {
	rows := []Row{{"id": 1, "name": "a", "amount": 2}}
	for _, c := range []struct {
		why   string
		order []string
		rows  []Row
		want  string
	}{
		{"el orden de la fuente manda", []string{"id", "name", "amount"}, rows, "id,name,amount"},
		{"sin orden, alfabético como antes", nil, rows, "amount,id,name"},
		{"una repetida va una vez", []string{"id", "id", "name", "amount"}, rows, "id,name,amount"},
		{"la que la fuente no nombró va al final", []string{"name"}, rows, "name,amount,id"},
		{"la que no está en las filas no se inventa", []string{"id", "fantasma", "name", "amount"}, rows, "id,name,amount"},
		{"sin filas vale el orden de la fuente", []string{"id", "name"}, nil, "id,name"},
	} {
		if got := strings.Join(OrderedColumns(c.order, c.rows), ","); got != c.want {
			t.Errorf("%s: %s, se esperaba %s", c.why, got, c.want)
		}
	}
}

// Redash dice el orden en `data.columns`, y QueryOrdered lo entrega.
func TestRedashKeepsTheColumnOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"query_result":{"data":{"columns":[{"name":"id"},{"name":"name"},{"name":"amount"}],"rows":[{"amount":5,"id":77,"name":"Prueba"}]}}}`))
	}))
	defer server.Close()
	rows, columns, name, err := QueryOrdered(Config{Target: "prod", RedashURL: server.URL, RedashToken: "t"}, "SELECT id, name, amount FROM lenders")
	if err != nil || len(rows) != 1 || name != "redash ds=1" {
		t.Fatalf("rows=%v name=%s err=%v", rows, name, err)
	}
	if got := strings.Join(columns, ","); got != "id,name,amount" {
		t.Errorf("columnas %s", got)
	}
	if _, _, _, err := QueryOrdered(Config{Target: "prod", RedashURL: server.URL, RedashToken: "t"}, "DELETE FROM lenders"); err == nil {
		t.Error("QueryOrdered tiene que pasar por la guarda de sólo lectura")
	}
}

// El sondeo de Redash empieza corto y no pasa de 1 s; el techo total sigue cerca de los 60 s.
func TestRedashPollDelay(t *testing.T) {
	want := []time.Duration{150 * time.Millisecond, 300 * time.Millisecond, 600 * time.Millisecond, time.Second, time.Second}
	var total time.Duration
	for i := 0; i < redashPollAttempts; i++ {
		d := redashPollDelay(i)
		if i < len(want) && d != want[i] {
			t.Errorf("intento %d: %v, se esperaba %v", i, d, want[i])
		}
		if d > time.Second {
			t.Errorf("intento %d: %v pasa del tope", i, d)
		}
		total += d
	}
	if total < 55*time.Second || total > 65*time.Second {
		t.Errorf("el techo total cambió: %v", total)
	}
}

// Sin fuente, el error nombra las claves y el archivo; un error de conexión lleva la pista de la VPN (o de Docker
// en local) y cualquier otro pasa igual.
func TestErrorsNameWhatToFix(t *testing.T) {
	_, err := Open(Config{Target: "prod"})
	if !errors.Is(err, ErrNoSource) {
		t.Fatalf("err = %v", err)
	}
	for _, piece := range []string{"E2E_DB_HOST", "REDASH_URL", "REDASH_TOKEN", "connectors/.env.prod"} {
		if !strings.Contains(err.Error(), piece) {
			t.Errorf("el error no nombra %s: %v", piece, err)
		}
	}
	dial := &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("i/o timeout")}
	if got := connectError("dev", "h", dial).Error(); !strings.Contains(got, "¿la VPN de dev está conectada?") || !strings.Contains(got, "i/o timeout") {
		t.Errorf("dev: %s", got)
	}
	if got := connectError("local", "h", errors.New("dial tcp 127.0.0.1:3306: connect: connection refused")).Error(); !strings.Contains(got, "Docker") || strings.Contains(got, "VPN") {
		t.Errorf("local: %s", got)
	}
	plain := errors.New("Error 1045: Access denied")
	if connectError("dev", "h", plain) != plain {
		t.Error("un error que no es de conexión pasa sin tocar")
	}
}
