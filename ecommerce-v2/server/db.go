package main

/* La base de cada ambiente, sin depender de nada fuera de este proyecto. Es una copia reducida del cliente SQL del
 * playground (MySQL directo para local y qa, Redash para prod) y lee sus credenciales del `.env` de la raíz (env.go).
 * Toda lectura pasa por ValidateReadOnly (readonly.go) y sus argumentos tienen que ser dígitos (validArgs). */

import (
	"bytes"
	stdsql "database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Row es una fila genérica. El texto y las fechas del driver de MySQL llegan como string, igual que desde Redash.
type Row map[string]any

// Source ejecuta lecturas contra la base de UN ambiente.
type Source interface {
	Rows(query string, args ...any) ([]Row, error)
	// Name dice qué contestó («mysql <host>» o «redash ds=<id>»): qa comparte la base con dev y staging.
	Name() string
	Close()
}

// openSource abre la base de lectura de un ambiente: MySQL directo si hay `<T>_DB_HOST`, si no Redash.
func openSource(target string, maxOpen int) (Source, error) {
	get := appEnv(target)
	if host := get("DB_HOST"); host != "" {
		for _, field := range []struct{ key, value string }{{"DB_NAME", get("DB_NAME")}, {"DB_USER", get("DB_USER")}, {"DB_PASS", get("DB_PASS")}} {
			if field.value == "" {
				return nil, fmt.Errorf("falta %s en .env", envKey(target, field.key))
			}
		}
		port := get("DB_PORT")
		if port == "" {
			port = "3306"
		}
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=10s&readTimeout=30s",
			get("DB_USER"), get("DB_PASS"), host, port, get("DB_NAME"))
		db, err := stdsql.Open("mysql", dsn)
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(maxOpen)
		if err := db.Ping(); err != nil {
			db.Close()
			return nil, err
		}
		return &mysqlSource{db: db, name: "mysql " + host}, nil
	}
	if url, token := get("REDASH_URL"), get("REDASH_TOKEN"); url != "" && token != "" {
		ds, _ := strconv.Atoi(get("REDASH_DATA_SOURCE_ID"))
		if ds == 0 {
			ds = 1 // la fuente «Live» (rds_mysql) de producción
		}
		zone, err := time.LoadLocation("America/Bogota")
		if err != nil {
			return nil, err
		}
		return &redashSource{zone: zone, base: strings.TrimRight(url, "/"), token: token, ds: ds,
			http: &http.Client{Timeout: 90 * time.Second}, name: fmt.Sprintf("redash ds=%d", ds)}, nil
	}
	return nil, fmt.Errorf("no hay base para %s: completá %s… o %s y %s en .env",
		target, envKey(target, "DB_HOST"), envKey(target, "REDASH_URL"), envKey(target, "REDASH_TOKEN"))
}

// La interpolación de Redash es segura porque sólo se aceptan argumentos de dígitos; se exige también en MySQL
// para que la regla valga igual en las dos fuentes.
var digitsOnly = regexp.MustCompile(`^\d{1,20}$`)

func validArgs(args []any) error {
	for i, a := range args {
		if !digitsOnly.MatchString(fmt.Sprint(a)) {
			return fmt.Errorf("argumento %d (%q) no es de dígitos: sólo se consulta por id, teléfono o documento", i+1, a)
		}
	}
	return nil
}

type mysqlSource struct {
	db   *stdsql.DB
	name string
}

func (s *mysqlSource) Name() string { return s.name }

func (s *mysqlSource) Close() { _ = s.db.Close() }

func (s *mysqlSource) Rows(query string, args ...any) ([]Row, error) {
	if err := validArgs(args); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var out []Row
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		row := Row{}
		for i, column := range columns {
			// El driver devuelve []byte para texto y fechas: se pasa a string para que las dos fuentes
			// entreguen lo mismo y quien lee no tenga que preguntar de dónde vino.
			if b, ok := values[i].([]byte); ok {
				row[column] = string(b)
			} else {
				row[column] = values[i]
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ─── Redash (prod) ───────────────────────────────────────────────────────────────────────────────────

type redashSource struct {
	zone  *time.Location
	base  string
	token string
	ds    int
	http  *http.Client
	name  string
}

func (s *redashSource) Name() string { return s.name }

// Zone: Redash serializa los datetime en la zona de SU servidor, que devuelve hora de Bogotá. Se fija
// explícitamente y no con `time.Local`: una herramienta que da horas distintas en dos máquinas no sirve
// para auditar.
func (s *redashSource) Zone() *time.Location { return s.zone }
func (s *redashSource) Close()               {}

func (s *redashSource) Rows(query string, args ...any) ([]Row, error) {
	if err := validArgs(args); err != nil {
		return nil, err
	}
	// Interpolación posicional. Segura porque `validArgs` ya garantizó que todo es de dígitos.
	text := query
	for _, a := range args {
		text = strings.Replace(text, "?", fmt.Sprint(a), 1)
	}
	body, _ := json.Marshal(map[string]any{"query": text, "data_source_id": s.ds, "max_age": 0})
	var start struct {
		Job struct {
			ID     string `json:"id"`
			Status int    `json:"status"`
			Error  string `json:"error"`
			Result int    `json:"query_result_id"`
		} `json:"job"`
		QueryResult *struct {
			Data struct {
				Rows []Row `json:"rows"`
			} `json:"data"`
		} `json:"query_result"`
	}
	if err := s.request("POST", "/api/query_results", body, &start); err != nil {
		return nil, err
	}
	// Redash puede devolver el resultado ya cacheado; en ese caso no hay trabajo que esperar.
	if start.QueryResult != nil {
		return start.QueryResult.Data.Rows, nil
	}
	if start.Job.ID == "" {
		return nil, fmt.Errorf("Redash no devolvió trabajo ni resultado")
	}

	// Estados de Redash: 1 pendiente · 2 corriendo · 3 ok · 4 falló · 5 cancelado.
	result := 0
	for attempt := 0; attempt < 60 && result == 0; attempt++ {
		var state struct {
			Job struct {
				Status int    `json:"status"`
				Error  string `json:"error"`
				Result int    `json:"query_result_id"`
			} `json:"job"`
		}
		if err := s.request("GET", "/api/jobs/"+start.Job.ID, nil, &state); err != nil {
			return nil, err
		}
		switch state.Job.Status {
		case 3:
			result = state.Job.Result
		case 4, 5:
			return nil, fmt.Errorf("la consulta falló en Redash: %s", state.Job.Error)
		}
		if result == 0 {
			time.Sleep(time.Second)
		}
	}
	if result == 0 {
		return nil, fmt.Errorf("Redash no terminó en 60 s: la cola está lenta o la consulta es muy grande")
	}
	var res struct {
		QueryResult struct {
			Data struct {
				Rows []Row `json:"rows"`
			} `json:"data"`
		} `json:"query_result"`
	}
	if err := s.request("GET", fmt.Sprintf("/api/query_results/%d", result), nil, &res); err != nil {
		return nil, err
	}
	return res.QueryResult.Data.Rows, nil
}

func (s *redashSource) request(method, path string, body []byte, dest any) error {
	req, err := http.NewRequest(method, s.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Key "+s.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		// El balanceador de Redash es INTERNO: sin VPN esto es un timeout, no un 401. Se dice acá porque el
		// síntoma no se parece a la causa.
		return fmt.Errorf("%s %s: %w — ¿la VPN está puesta? Redash es interno", method, path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		var b bytes.Buffer
		_, _ = b.ReadFrom(resp.Body)
		msg := b.String()
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return fmt.Errorf("%s %s → %d: %s", method, path, resp.StatusCode, msg)
	}
	// ⚠ LOS NÚMEROS SE LEEN COMO SU LITERAL (`UseNumber`), NO COMO float64. Redash los manda exactos
	// (`12345678901`, `1560414.0`), pero decodificados a float64 se imprimían `1.2345678901e+10` y
	// `1.560414e+06`: medido el 2026-09-24 con la misma consulta en local y en prod. Es el mismo error que
	// el trazador ya había pagado con los ids de los logs (un id de 7 dígitos dejaba de anclar).
	dec := json.NewDecoder(resp.Body)
	dec.UseNumber()
	return dec.Decode(dest)
}
