// Package dbquery ejecuta una consulta SQL de sólo lectura para el tablero.
//
// No sabe nada de solicitudes ni logs: eso es trabajo del Trazador. Acá la única pregunta es de
// datos, en un ambiente explícito, y la salida se puede citar sin atribuirle una consulta de BD a otra
// herramienta.
package dbquery

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var targets = map[string]bool{"local": true, "dev": true, "staging": true, "prod": true}

// ValidTarget evita abrir un archivo de entorno arbitrario desde un argumento de CLI.
func ValidTarget(target string) bool { return targets[target] }

// Config describe una fuente de lectura. Local, dev y staging suelen usar MySQL directo; producción
// puede usar Redash, que deja la consulta auditada por el token del dueño.
type Config struct {
	Target string

	Host, Port, Name, User, Password string
	RedashURL, RedashToken           string
	RedashDataSource                 int
}

// Row es deliberadamente genérica: el usuario decide la consulta y la herramienta no inventa un
// modelo de datos intermedio.
type Row map[string]any

// Result conserva sólo los datos que sirven para presentar una lectura reproducible.
type Result struct {
	Target string
	Source string
	Rows   []Row
}

var (
	readStart    = regexp.MustCompile(`(?is)^\s*(select|with)\b`)
	writeFile    = regexp.MustCompile(`(?is)\binto\s+(outfile|dumpfile)\b`)
	writeVerb    = regexp.MustCompile(`(?is)\b(insert|update|delete|drop|alter|create|truncate|replace|grant|revoke|rename|call|load|handler|lock|unlock|commit|rollback|savepoint|prepare|execute|do|set)\b`)
	blockComment = regexp.MustCompile(`(?s)/\*.*?\*/`)
)

// ValidateReadOnly bloquea una escritura antes de abrir una conexión, incluso si la cuenta de la
// fuente tuviera más permisos de los necesarios.
func ValidateReadOnly(query string) error {
	clean := withoutComments(query)
	if strings.TrimSpace(clean) == "" {
		return fmt.Errorf("la consulta está vacía")
	}
	if len([]rune(clean)) > 12000 {
		return fmt.Errorf("la consulta supera 12.000 caracteres")
	}
	if !readStart.MatchString(clean) {
		return fmt.Errorf("solo se permiten consultas que empiecen con SELECT o WITH")
	}
	if i := strings.Index(strings.TrimRight(clean, " \t\r\n;"), ";"); i >= 0 {
		return fmt.Errorf("solo se permite una sentencia por consulta")
	}
	if m := writeFile.FindString(clean); m != "" {
		return fmt.Errorf("%s escribe un archivo en el servidor", strings.ToUpper(strings.Join(strings.Fields(m), " ")))
	}
	for _, index := range writeVerb.FindAllStringIndex(clean, -1) {
		// REPLACE(...) e INSERT(...) son funciones de texto en MySQL; no son sentencias de escritura.
		if strings.HasPrefix(strings.TrimLeft(clean[index[1]:], " \t\r\n"), "(") {
			continue
		}
		return fmt.Errorf("contiene %q, que no pertenece a una lectura", strings.ToUpper(clean[index[0]:index[1]]))
	}
	return nil
}

func withoutComments(query string) string {
	var b strings.Builder
	for _, line := range strings.Split(query, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		if i := strings.Index(line, "#"); i >= 0 {
			line = line[:i]
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	return blockComment.ReplaceAllString(b.String(), " ")
}

// LoadConfig carga únicamente el archivo del ambiente elegido. Las variables reales del proceso
// ganan, para que una automatización no tenga que escribir secretos en disco.
func LoadConfig(target string) (Config, error) {
	if !ValidTarget(target) {
		return Config{}, fmt.Errorf("ambiente %q no permitido (local · dev · staging · prod)", target)
	}
	values := map[string]string{}
	for _, path := range []string{".env." + target, filepath.Join("server", ".env."+target), filepath.Join("tablero", "server", ".env."+target)} {
		for key, value := range readEnv(path) {
			if _, exists := values[key]; !exists {
				values[key] = value
			}
		}
	}
	pick := func(key string) string {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
		return strings.TrimSpace(values[key])
	}
	dataSource, _ := strconv.Atoi(pick("TABLERO_DB_REDASH_DATA_SOURCE"))
	if dataSource == 0 {
		dataSource = 1
	}
	port := pick("TABLERO_DB_PORT")
	if port == "" {
		port = "3306"
	}
	return Config{
		Target: target, Host: pick("TABLERO_DB_HOST"), Port: port, Name: pick("TABLERO_DB_NAME"),
		User: pick("TABLERO_DB_USER"), Password: pick("TABLERO_DB_PASSWORD"),
		RedashURL:   strings.TrimRight(pick("TABLERO_DB_REDASH_URL"), "/"),
		RedashToken: pick("TABLERO_DB_REDASH_TOKEN"), RedashDataSource: dataSource,
	}, nil
}

func readEnv(path string) map[string]string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), "\"'")
	}
	return values
}

// Query valida primero y después elige una sola fuente. No hay fallback: si el ambiente pidió Redash
// o MySQL y no está configurado, es mejor fallar que leer otro ambiente por accidente.
func Query(ctx context.Context, config Config, query string) (Result, error) {
	if !ValidTarget(config.Target) {
		return Result{}, fmt.Errorf("ambiente %q no permitido", config.Target)
	}
	if err := ValidateReadOnly(query); err != nil {
		return Result{}, err
	}
	if config.Host != "" {
		rows, err := queryMySQL(ctx, config, query)
		return Result{Target: config.Target, Source: "mysql", Rows: rows}, err
	}
	if config.RedashURL != "" && config.RedashToken != "" {
		rows, err := queryRedash(ctx, config, query)
		return Result{Target: config.Target, Source: "redash", Rows: rows}, err
	}
	return Result{}, fmt.Errorf("no hay fuente para %s: configurá MySQL directo o Redash en .env.%s", config.Target, config.Target)
}

func queryMySQL(ctx context.Context, config Config, query string) ([]Row, error) {
	for key, value := range map[string]string{"TABLERO_DB_NAME": config.Name, "TABLERO_DB_USER": config.User, "TABLERO_DB_PASSWORD": config.Password} {
		if value == "" {
			return nil, fmt.Errorf("falta %s para MySQL", key)
		}
	}
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=10s&readTimeout=30s",
		config.User, config.Password, config.Host, config.Port, config.Name)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if err := db.PingContext(ctx); err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRows(rows)
}

func scanRows(rows *sql.Rows) ([]Row, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	var result []Row
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
			if bytes, ok := values[i].([]byte); ok {
				row[column] = string(bytes)
			} else {
				row[column] = values[i]
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func queryRedash(ctx context.Context, config Config, query string) ([]Row, error) {
	body, _ := json.Marshal(map[string]any{"query": query, "data_source_id": config.RedashDataSource, "max_age": 0})
	client := &http.Client{Timeout: 90 * time.Second}
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
	if err := redashRequest(ctx, client, config, http.MethodPost, "/api/query_results", body, &start); err != nil {
		return nil, err
	}
	if start.QueryResult != nil {
		return start.QueryResult.Data.Rows, nil
	}
	if start.Job.ID == "" {
		return nil, fmt.Errorf("Redash no devolvió resultado ni trabajo")
	}

	resultID := start.Job.Result
	for attempt := 0; resultID == 0 && attempt < 60; attempt++ {
		var state struct {
			Job struct {
				Status int    `json:"status"`
				Error  string `json:"error"`
				Result int    `json:"query_result_id"`
			} `json:"job"`
		}
		if err := redashRequest(ctx, client, config, http.MethodGet, "/api/jobs/"+start.Job.ID, nil, &state); err != nil {
			return nil, err
		}
		switch state.Job.Status {
		case 3:
			resultID = state.Job.Result
		case 4, 5:
			return nil, fmt.Errorf("la consulta falló en Redash: %s", state.Job.Error)
		}
		if resultID == 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Second):
			}
		}
	}
	if resultID == 0 {
		return nil, fmt.Errorf("Redash no terminó en 60 segundos")
	}
	var result struct {
		QueryResult struct {
			Data struct {
				Rows []Row `json:"rows"`
			} `json:"data"`
		} `json:"query_result"`
	}
	if err := redashRequest(ctx, client, config, http.MethodGet, fmt.Sprintf("/api/query_results/%d", resultID), nil, &result); err != nil {
		return nil, err
	}
	return result.QueryResult.Data.Rows, nil
}

func redashRequest(ctx context.Context, client *http.Client, config Config, method, path string, body []byte, destination any) error {
	request, err := http.NewRequestWithContext(ctx, method, config.RedashURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Key "+config.RedashToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("%s %s respondió %d", method, path, response.StatusCode)
	}
	return json.NewDecoder(response.Body).Decode(destination)
}

// Columns ordena las claves de manera estable para que la salida de terminal se pueda comparar.
func Columns(rows []Row) []string {
	seen := map[string]bool{}
	var columns []string
	for _, row := range rows {
		for column := range row {
			if !seen[column] {
				seen[column] = true
				columns = append(columns, column)
			}
		}
	}
	sort.Strings(columns)
	return columns
}
