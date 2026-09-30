package canon

import (
	"strings"
	"testing"
)

// Lo que debe pasar como lectura, incluidos los casos donde una palabra "peligrosa" es DATO, nombre o función.
func TestAPostgresReadPasses(t *testing.T) {
	ok := []string{
		`SELECT 1`,
		`select * from canon_revision order by id desc limit 5;`,
		`WITH r AS (SELECT * FROM canon_revision) SELECT count(*) FROM r`,
		`SELECT author, reason FROM canon_revision WHERE reason ILIKE '%drop%'`, // la palabra está en un dato
		`SELECT 'insert into x; delete from y' AS texto`,                        // un ';' y verbos dentro de un texto
		`SELECT updated_at, deleted, inserted_by FROM t`,                        // columnas que CONTIENEN la palabra
		`SELECT replace(a, 'x', 'y'), left(b, 3) FROM t`,                        // funciones que se llaman como verbos
		`SELECT "delete" FROM t`,                                                // un identificador entre comillas dobles
		"SELECT 1 -- ; drop table canon_file\n",                                 // un comentario de línea
		`SELECT 1 /* ; drop table x */`,                                         // un comentario de bloque
		`SELECT 1 /* uno /* anidado ; drop */ sigue */`,                         // los comentarios de bloque SE ANIDAN en Postgres
		`SELECT $$ drop table x; delete from y $$ AS t`,                         // texto entre dólares
		`SELECT $tag$ ; insert into x $tag$ AS t`,                               // ...con etiqueta
		`SELECT 'it''s; a trap' AS t`,                                           // comilla doblada
		`SELECT E'\'; drop table x; --' AS t`,                                   // E'…' escapa con barra
		`SELECT content->>'a' FROM canon_file WHERE revision = $1`,              // un parámetro $1 no es una etiqueta
		`SELECT current_setting('server_version')`,                              // leer un parámetro es inocuo
	}
	for _, q := range ok {
		if err := ValidateReadOnlyPG(q); err != nil {
			t.Errorf("debía pasar y dio %v:\n  %s", err, q)
		}
	}
}

// Lo que NO es una lectura, con el motivo en español.
func TestWhatIsNotAReadDoesNotPass(t *testing.T) {
	cases := []struct{ q, reason string }{
		{`INSERT INTO canon_revision (author) VALUES ('x')`, "SELECT o WITH"},
		{`UPDATE canon_file SET content = ''`, "SELECT o WITH"},
		{`DROP TABLE canon_file`, "SELECT o WITH"},
		{`  delete from canon_file`, "SELECT o WITH"},
		{`SELECT 1; SELECT 2`, "una sola sentencia"},
		{`SELECT 1; DROP TABLE canon_file`, "una sola sentencia"},
		{`WITH x AS (DELETE FROM canon_file RETURNING *) SELECT * FROM x`, "DELETE"},
		{`WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x`, "INSERT"},
		{`SELECT * INTO copia FROM canon_file`, "INTO"},
		{`SELECT * FROM canon_file FOR UPDATE`, "FOR UPDATE"},
		{`SELECT * FROM canon_file FOR SHARE`, "FOR SHARE"},
		{`SELECT pg_read_file('/etc/passwd')`, "pg_read_file"},
		{`SELECT pg_sleep(30)`, "pg_sleep"},
		{`SELECT set_config('default_transaction_read_only', 'off', false)`, "set_config"},
		{`SELECT pg_terminate_backend(123)`, "pg_terminate_backend"},
		{`SELECT lo_import('/etc/passwd')`, "lo_import"},
		{`SELECT * FROM dblink('host=x', 'select 1') AS t(a int)`, "dblink"},
		{`SELECT 'sin cerrar`, "comilla"},
		{`SELECT $$ sin cerrar`, "sin cerrar"},
		{`SELECT 1 /* sin cerrar`, "sin cerrar"},
		{`   `, "vacía"},
		{`SELECT ` + strings.Repeat("a", MaxQueryDB), "supera"},
	}
	for _, c := range cases {
		err := ValidateReadOnlyPG(c.q)
		if err == nil {
			t.Errorf("no debía pasar:\n  %.80s", c.q)
			continue
		}
		if !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(c.reason)) {
			t.Errorf("el motivo tenía que mencionar %q y dijo %q\n  %.80s", c.reason, err, c.q)
		}
	}
}

// Un truco clásico: esconder el verbo detrás de un comentario o un texto para que el chequeo lo lea como dato.
func TestAVerbCannotHideBehindACommentOrAString(t *testing.T) {
	tricks := []string{
		"SELECT 1 --\n; DROP TABLE canon_file",
		"SELECT 1; -- inocente\nDROP TABLE canon_file",
		"SELECT 1 /* x */; DROP TABLE canon_file",
		`SELECT '' ; DROP TABLE canon_file`,
		`SELECT $$ x $$; DROP TABLE canon_file`,
		`SELECT E'\\'; DROP TABLE canon_file; --'`,
	}
	for _, q := range tricks {
		if err := ValidateReadOnlyPG(q); err == nil {
			t.Errorf("no debía pasar: %q", q)
		}
	}
}
