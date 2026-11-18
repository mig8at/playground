// Package pgreadonly lee una base Postgres SIN poder escribirla: una transacción READ ONLY impuesta por la base,
// más un chequeo previo de la consulta (ValidateReadOnlyPG). Lo usa el conector de la app de Shopify. Nació dentro
// del conector de canon, que se sacó de my-tools el 2026-11-18.
package pgreadonly

import (
	"context"
	stdsql "database/sql"
	"time"
)

const (
	// MaxRowsDB es el tope de filas que devuelve una consulta; una lectura más grande se corta y se avisa.
	MaxRowsDB = 500
	// DefaultTimeoutMs es lo que puede tardar UNA consulta en el servidor antes de que Postgres la corte.
	DefaultTimeoutMs = 15000
)

// DBConfig es de dónde leer en un ambiente.
// Row es una fila: quien pregunta decide la consulta, el conector no inventa un modelo intermedio.
type Row map[string]any

// Result es lo que contestó la base: las columnas en el orden de la consulta, las filas y de dónde salieron.
type Result struct {
	Source    string   `json:"source"`
	Columns   []string `json:"columns"`
	Rows      []Row    `json:"rows"`
	Truncated bool     `json:"truncated,omitempty"`
}

// DB es una conexión de sólo lectura a UNA base.
type DB struct {
	db     *stdsql.DB
	source string
}

// NewDB envuelve una conexión de Postgres YA ABIERTA de otro servicio del mismo conector (la base de la app de Shopify,
// `connectors/shopifyapp`) para que use esta misma consulta de sólo lectura: la validación previa, la transacción READ
// ONLY, el tope de filas y cómo salen los valores. Quien la abre pone `default_transaction_read_only=on` en la sesión.
func NewDB(db *stdsql.DB, source string) *DB { return &DB{db: db, source: source} }

// Source dice qué base contestó. Va en todo resultado citable.
func (d *DB) Source() string { return d.source }

// Close cierra la conexión.
func (d *DB) Close() error { return d.db.Close() }

// Query valida, abre una transacción de SÓLO LECTURA y corre la consulta. Devuelve a lo sumo `MaxRowsDB` filas y dice si
// hubo más. Los valores salen como los entrega el driver: enteros, booleanos y texto tal cual; fechas en RFC3339; y `json/jsonb`, `numeric` y arreglos como TEXTO (sin parsear: lo que se ve es lo que hay en la base).
func (d *DB) Query(ctx context.Context, query string, args ...any) (Result, error) {
	if err := ValidateReadOnlyPG(query); err != nil {
		return Result{}, err
	}
	tx, err := d.db.BeginTx(ctx, &stdsql.TxOptions{ReadOnly: true})
	if err != nil {
		return Result{}, err
	}
	defer tx.Rollback() // nunca hay nada que confirmar
	rs, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return Result{}, err
	}
	defer rs.Close()
	columns, err := rs.Columns()
	if err != nil {
		return Result{}, err
	}
	out := Result{Source: d.source, Columns: columns, Rows: []Row{}}
	for rs.Next() {
		if len(out.Rows) >= MaxRowsDB {
			out.Truncated = true
			break
		}
		values := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rs.Scan(ptrs...); err != nil {
			return Result{}, err
		}
		row := Row{}
		for i, c := range columns {
			row[c] = plain(values[i])
		}
		out.Rows = append(out.Rows, row)
	}
	return out, rs.Err()
}

// plain deja un valor de la base como algo que se imprime y se serializa sin sorpresas.
func plain(v any) any {
	switch x := v.(type) {
	case []byte:
		return string(x)
	case time.Time:
		return x.Format(time.RFC3339)
	default:
		return v
	}
}

// Tables lista lo que hay: esquema, tabla y una estimación de filas (la que mantiene Postgres, no un COUNT). Vacía —NULL— si Postgres todavía no
// analizó la tabla (guarda -1 ahí, y un -1 se leería como un número).
func (d *DB) Tables(ctx context.Context) (Result, error) {
	return d.Query(ctx, `
SELECT n.nspname AS esquema, c.relname AS tabla, CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS filas_estimadas
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
 ORDER BY 1, 2`)
}
