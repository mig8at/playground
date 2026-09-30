package canon

import (
	"context"
	stdsql "database/sql"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"creditop/playground/connectors/env"
)

/* LA BASE DE CANON, sólo para leer.
 *
 * Canon guarda su corpus, las preguntas y las conversaciones en Postgres, y hasta ahora sólo se le hablaba por su API.
 * Esto es la otra mitad del mismo servicio: mirar las tablas (los esquemas de las galaxias, los mantenedores, las
 * revisiones) cuando la API no las expone. Vive acá y no en una herramienta por la misma razón que `connectors/sql`: un
 * solo lugar sabe qué base atiende cada ambiente y cómo se le habla.
 *
 * ⚠ TRES REGLAS, y la primera ya se pagó una vez con la base compartida de dev:
 *
 *  1. SÓLO LECTURA, impuesta por la BASE (transacción READ ONLY + `default_transaction_read_only=on`) y además por un
 *     chequeo previo (`ValidateReadOnlyPG`). El usuario de prod tiene que ser de sólo lectura de todos modos: esto es el cinturón,
 *     no el permiso.
 *  2. El ambiente es OBLIGATORIO y hay dos: `local` (el laboratorio de canon en Docker) y `prod`. Sin fallback: si prod no
 *     está configurado falla diciendo qué falta; jamás cae al laboratorio ni al revés.
 *  3. Las claves son `CANON_POSTGRES_*` y NUNCA `DB_HOST` ni `DATABASE_URL`: esos los leen Laravel y el propio canon, y en
 *     una terminal preparada para ellos cambiarían la base sin decirlo.
 *
 * ⚠ Esa base tiene las PREGUNTAS y CONVERSACIONES que la gente le hizo a canon, y pueden traer nombres o datos de personas.
 * Se consultan para diagnosticar; no se pegan en tareas, PRs ni mensajes. */

// DBTargets son los ambientes que tienen base de canon.
var DBTargets = []string{"local", "prod"}

// ValidDBTarget: ¿este ambiente tiene base de canon?
func ValidDBTarget(t string) bool {
	for _, x := range DBTargets {
		if x == t {
			return true
		}
	}
	return false
}

const (
	// MaxRowsDB es el tope de filas que devuelve una consulta; una lectura más grande se corta y se avisa.
	MaxRowsDB = 500
	// DefaultTimeoutMs es lo que puede tardar UNA consulta en el servidor antes de que Postgres la corte.
	DefaultTimeoutMs = 15000
)

// DBConfig es de dónde leer en un ambiente.
type DBConfig struct {
	Target, Host, Port, Database, User, Password, SSLMode string
	// TimeoutMs: tope de una consulta en el servidor (default 15 s).
	TimeoutMs int
}

// LoadDBConfig arma la configuración desde `connectors/.env.<target>` (las variables del proceso ganan).
func LoadDBConfig(target string) (DBConfig, string, error) {
	if !ValidDBTarget(target) {
		return DBConfig{}, "", fmt.Errorf("canon sólo tiene base en %s (pediste %q)", strings.Join(DBTargets, " · "), target)
	}
	v, err := env.Load(target)
	if err != nil {
		return DBConfig{}, "", err
	}
	return DBConfig{
		Target: target, Host: v.Get("CANON_POSTGRES_HOST"), Port: v.Get("CANON_POSTGRES_PORT"),
		Database: v.Get("CANON_POSTGRES_DATABASE"), User: v.Get("CANON_POSTGRES_USER"),
		Password: v.Get("CANON_POSTGRES_PASSWORD"), SSLMode: v.Get("CANON_POSTGRES_SSLMODE"),
	}, v.File, nil
}

// Missing dice qué falta para conectar, en el orden en que se piden. Vacío si está todo.
func (c DBConfig) Missing() []string {
	var out []string
	for _, f := range []struct{ key, value string }{
		{"CANON_POSTGRES_HOST", c.Host}, {"CANON_POSTGRES_USER", c.User}, {"CANON_POSTGRES_PASSWORD", c.Password},
	} {
		if f.value == "" {
			out = append(out, f.key)
		}
	}
	return out
}

// ConnString arma la cadena de conexión. La contraseña va CODIFICADA: una generada trae `@`, `/`, `:` o `#` con toda
// naturalidad, y pegada cruda parte el host o el nombre de la base (el error resultante, «no se pudo resolver el host»,
// manda a revisar la red en vez de la contraseña). Y `sslmode` VIAJA: si la base lo exige y no se manda, corta la conexión.
func (c DBConfig) ConnString() string {
	port, database, ssl := c.Port, c.Database, c.SSLMode
	if port == "" {
		port = "5432"
	}
	if database == "" {
		database = "canon"
	}
	if ssl == "" {
		ssl = "require"
	}
	timeout := c.TimeoutMs
	if timeout <= 0 {
		timeout = DefaultTimeoutMs
	}
	u := url.URL{Scheme: "postgres", User: url.UserPassword(c.User, c.Password), Host: c.Host + ":" + port, Path: "/" + database}
	q := url.Values{}
	q.Set("sslmode", ssl)
	q.Set("connect_timeout", "10")
	q.Set("application_name", "playground-connectors")
	// Parámetros de la SESIÓN: la base misma rechaza cualquier escritura y corta lo que tarde de más.
	q.Set("default_transaction_read_only", "on")
	q.Set("statement_timeout", fmt.Sprint(timeout))
	q.Set("idle_in_transaction_session_timeout", "60000")
	u.RawQuery = q.Encode()
	return u.String()
}

// Row es una fila: quien pregunta decide la consulta, el conector no inventa un modelo intermedio.
type Row map[string]any

// Result es lo que contestó la base: las columnas en el orden de la consulta, las filas y de dónde salieron.
type Result struct {
	Source    string   `json:"source"`
	Columns   []string `json:"columns"`
	Rows      []Row    `json:"rows"`
	Truncated bool     `json:"truncated,omitempty"`
}

// DB es una conexión de sólo lectura a la base de canon de UN ambiente.
type DB struct {
	db     *stdsql.DB
	source string
}

// OpenDB valida la configuración y abre la conexión. No hay fallback entre ambientes.
func OpenDB(ctx context.Context, c DBConfig) (*DB, error) {
	if !ValidDBTarget(c.Target) {
		return nil, fmt.Errorf("canon sólo tiene base en %s (pediste %q)", strings.Join(DBTargets, " · "), c.Target)
	}
	if missing := c.Missing(); len(missing) > 0 {
		return nil, fmt.Errorf("falta %s para la base de canon en %s (connectors/.env.%s)", strings.Join(missing, ", "), c.Target, c.Target)
	}
	cfg, err := pgx.ParseConfig(c.ConnString())
	if err != nil {
		// Nunca se repite la cadena en el error: lleva la contraseña.
		return nil, fmt.Errorf("la configuración de la base de canon no es válida: %s", redact(err.Error(), c.Password))
	}
	db := stdlib.OpenDB(*cfg)
	db.SetMaxOpenConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("no se pudo conectar a la base de canon en %s (%s:%s; ¿VPN de prod?): %s",
			c.Target, c.Host, orDefault(c.Port, "5432"), redact(err.Error(), c.Password))
	}
	return &DB{db: db, source: fmt.Sprintf("canon postgres %s/%s", c.Host, orDefault(c.Database, "canon"))}, nil
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// redactar saca la contraseña de un texto: un error de conexión puede traer la cadena entera.
func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	s = strings.ReplaceAll(s, secret, "***")
	return strings.ReplaceAll(s, url.QueryEscape(secret), "***")
}

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
