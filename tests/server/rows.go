package main

import (
	"fmt"
	"strings"

	dbsql "creditop/playground/connectors/sql"
)

// maxTableRows es el tope de filas que se leen de una tabla: una solicitud normal tiene pocas por tabla.
const maxTableRows = 200

// TableRows son las filas de UNA tabla que son de la solicitud, con las columnas en el orden de la base.
type TableRows struct {
	Table     string      `json:"table"`
	Columns   []string    `json:"columns"`
	Rows      []dbsql.Row `json:"rows"`
	Truncated bool        `json:"truncated"`
}

// RequestTableRows lee las filas de la solicitud en una tabla: la misma tabla y el mismo filtro con que se
// cuentan (countTables) y se borran. Sólo lee. La tabla tiene que ser una de las que cuelgan de la solicitud
// en ESTA base: el nombre no se arma con lo que llega por la URL.
func RequestTableRows(target string, request int, table string) (*TableRows, error) {
	if !validTarget(target) {
		return nil, fmt.Errorf("ambiente %q: tests mira %s", target, strings.Join(Targets, " o "))
	}
	if request <= 0 {
		return nil, fmt.Errorf("falta el número de solicitud")
	}
	src, err := source(target)
	if err != nil {
		return nil, err
	}
	list := intList([]int{request})
	where, order := "", ""
	switch table {
	case "user_requests":
		where, order = fmt.Sprintf("id IN (%s)", list), "id"
	case "device_locks":
		where = deviceLocksWhere(list)
	default:
		children, err := childTables(src)
		if err != nil {
			return nil, err
		}
		for _, t := range children {
			if t.name == table {
				where = childWhere(t.name, list)
				if t.hasID {
					order = "id"
				}
			}
		}
	}
	if where == "" {
		return nil, fmt.Errorf("la tabla %q no cuelga de la solicitud", table)
	}
	// El conector sólo acepta argumentos de dígitos (por Redash): el nombre va en la consulta, y es seguro porque
	// salió de la lista de arriba y pasa reTable.
	if !reTable.MatchString(table) {
		return nil, fmt.Errorf("nombre de tabla inesperado %q", table)
	}
	cols, err := rows(src, fmt.Sprintf(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '%s' ORDER BY ORDINAL_POSITION`, table))
	if err != nil {
		return nil, fmt.Errorf("columnas de %s: %w", table, err)
	}
	out := &TableRows{Table: table, Columns: []string{}}
	for _, c := range cols {
		out.Columns = append(out.Columns, cell(c, "c"))
	}
	query := fmt.Sprintf("SELECT * FROM `%s` WHERE %s", table, where)
	if order != "" {
		query += " ORDER BY " + order
	}
	// Una fila de más dice si hay más que el tope, sin contarlas aparte.
	got, err := rows(src, fmt.Sprintf("%s LIMIT %d", query, maxTableRows+1))
	if err != nil {
		return nil, fmt.Errorf("filas de %s: %w", table, err)
	}
	if len(got) > maxTableRows {
		got, out.Truncated = got[:maxTableRows], true
	}
	out.Rows = got
	return out, nil
}
