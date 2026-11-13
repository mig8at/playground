package sql

import (
	"bytes"
	stdsql "database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ─── MySQL directo (local · dev · qa · staging) ─────────────────────────────────────────────────────

type mysqlSource struct {
	db   *stdsql.DB
	name string
}

func (s *mysqlSource) Name() string { return s.name }

// Zone: el driver con `parseTime=true` y sin `loc` interpreta como UTC (ver la nota de F-241 en Source).
func (s *mysqlSource) Zone() *time.Location { return time.UTC }
func (s *mysqlSource) Close()               { _ = s.db.Close() }

func (s *mysqlSource) Rows(query string, args ...any) ([]Row, error) {
	out, _, err := s.RowsOrdered(query, args...)
	return out, err
}

// RowsOrdered: las filas y, aparte, las columnas en el orden del SELECT (la fila es un mapa y lo pierde).
func (s *mysqlSource) RowsOrdered(query string, args ...any) ([]Row, []string, error) {
	if err := validArgs(args); err != nil {
		return nil, nil, err
	}
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	var out []Row
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, nil, err
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
	return out, columns, rows.Err()
}

// ─── Redash (prod) ──────────────────────────────────────────────────────────────────────────────────

// ⚠ Y NO DEVUELVE LO MISMO QUE MySQL DIRECTO, medido el 2026-09-24 con la misma consulta en los dos:
//   - un DECIMAL llega como número (`1560414.0`) y no como el texto del driver (`1560414.0000`): los dos
//     exactos, con distinta cantidad de ceros. Igualarlos pediría el tipo de cada columna.
//   - una cadena BINARIA (`CHAR(10)`, `CONCAT` con ella, columnas BINARY/BLOB) llega en HEX (`610a62`).
//     No se puede corregir acá, porque un texto que parece hex es indistinguible: pedila con
//     `CAST(… AS CHAR)` y llega como texto.
//   - un datetime llega como texto sin zona (`2026-09-24T05:01:14`), en la hora de Bogotá (ver Zone).
//
// ⚠ REDASH ES ASÍNCRONO Y QUEDA AUDITADO. Cada consulta son tres saltos (POST del trabajo → espera →
// leer el resultado) y se registra a nombre del usuario del token: conviene una consulta gorda, no diez
// chiquitas, y saber que no es anónima.
type redashSource struct {
	target string // para nombrar la VPN en el error de conexión
	zone   *time.Location
	base   string
	token  string
	ds     int
	http   *http.Client
	name   string
}

func (s *redashSource) Name() string { return s.name }

// Zone: Redash serializa los datetime en la zona de SU servidor, que devuelve hora de Bogotá. Se fija
// explícitamente y no con `time.Local`: una herramienta que da horas distintas en dos máquinas no sirve
// para auditar.
func (s *redashSource) Zone() *time.Location { return s.zone }
func (s *redashSource) Close()               {}

func (s *redashSource) Rows(query string, args ...any) ([]Row, error) {
	out, _, err := s.RowsOrdered(query, args...)
	return out, err
}

// redashData es el resultado de Redash: las filas y `columns`, que trae los nombres en el orden de la consulta.
type redashData struct {
	Rows    []Row `json:"rows"`
	Columns []struct {
		Name string `json:"name"`
	} `json:"columns"`
}

func (d redashData) order() []string {
	out := make([]string, 0, len(d.Columns))
	for _, c := range d.Columns {
		out = append(out, c.Name)
	}
	return out
}

// redashPollAttempts: con la espera de redashPollDelay suman ~60 s, el mismo techo de antes.
const redashPollAttempts = 62

// redashPollDelay: cuánto se espera antes de volver a preguntar por el trabajo. Una consulta chica termina en
// décimas de segundo, y con 1 s fijo cada lectura pagaba el segundo entero: empieza corto y sube hasta 1 s.
func redashPollDelay(attempt int) time.Duration {
	switch attempt {
	case 0:
		return 150 * time.Millisecond
	case 1:
		return 300 * time.Millisecond
	case 2:
		return 600 * time.Millisecond
	}
	return time.Second
}

// RowsOrdered: las filas y, aparte, las columnas en el orden de la consulta (`data.columns`).
func (s *redashSource) RowsOrdered(query string, args ...any) ([]Row, []string, error) {
	if err := validArgs(args); err != nil {
		return nil, nil, err
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
			Data redashData `json:"data"`
		} `json:"query_result"`
	}
	if err := s.request("POST", "/api/query_results", body, &start); err != nil {
		return nil, nil, err
	}
	// Redash puede devolver el resultado ya cacheado; en ese caso no hay trabajo que esperar.
	if start.QueryResult != nil {
		return start.QueryResult.Data.Rows, start.QueryResult.Data.order(), nil
	}
	if start.Job.ID == "" {
		return nil, nil, fmt.Errorf("Redash no devolvió trabajo ni resultado")
	}

	// Estados de Redash: 1 pendiente · 2 corriendo · 3 ok · 4 falló · 5 cancelado.
	result := 0
	for attempt := 0; attempt < redashPollAttempts && result == 0; attempt++ {
		var state struct {
			Job struct {
				Status int    `json:"status"`
				Error  string `json:"error"`
				Result int    `json:"query_result_id"`
			} `json:"job"`
		}
		if err := s.request("GET", "/api/jobs/"+start.Job.ID, nil, &state); err != nil {
			return nil, nil, err
		}
		switch state.Job.Status {
		case 3:
			result = state.Job.Result
		case 4, 5:
			return nil, nil, fmt.Errorf("la consulta falló en Redash: %s", state.Job.Error)
		}
		if result == 0 {
			time.Sleep(redashPollDelay(attempt))
		}
	}
	if result == 0 {
		return nil, nil, fmt.Errorf("Redash no terminó en ~60 s: la cola está lenta o la consulta es muy grande")
	}
	var res struct {
		QueryResult struct {
			Data redashData `json:"data"`
		} `json:"query_result"`
	}
	if err := s.request("GET", fmt.Sprintf("/api/query_results/%d", result), nil, &res); err != nil {
		return nil, nil, err
	}
	return res.QueryResult.Data.Rows, res.QueryResult.Data.order(), nil
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
		vpn := "la VPN"
		if s.target != "" {
			vpn = "la VPN de " + s.target
		}
		return fmt.Errorf("%s %s: %w — ¿%s está conectada? Redash es interno", method, path, err, vpn)
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
