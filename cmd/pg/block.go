package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	dbsql "creditop/playground/connectors/sql"
)

// LA CONSULTA COMO EVIDENCIA DE UNA TAREA. Lo que hacía `make trazador-sql MD=1 BLOQUE=…`, que ahora vive acá: el
// bloque lleva la consulta en su caja ` ```sql <ambiente> ` y debajo «Resultado:», que es lo que el validador de la pila
// exige (una consulta sin lo que dio no se puede volver a tomar ni desmentir).

// sqlResult resume las filas en una línea: la única fila entera, o las primeras cinco.
func sqlResult(columns []string, rows []dbsql.Row) string {
	if len(rows) == 0 {
		return "cero filas."
	}
	row := func(r dbsql.Row) string {
		vals := make([]string, 0, len(columns))
		for _, c := range columns {
			vals = append(vals, c+" = "+strings.Join(strings.Fields(cell(r[c])), " "))
		}
		return strings.Join(vals, " · ")
	}
	if len(rows) == 1 {
		return row(rows[0]) + "."
	}
	var parts []string
	for i, r := range rows {
		if i == 5 {
			parts = append(parts, fmt.Sprintf("y %d más", len(rows)-5))
			break
		}
		parts = append(parts, "("+row(r)+")")
	}
	return fmt.Sprintf("%d filas: %s.", len(rows), strings.Join(parts, "; "))
}

// sqlEvidence es la caja con la consulta y lo que dio, en el formato de la pila de una tarea.
func sqlEvidence(target, query string, columns []string, rows []dbsql.Row) string {
	result := sqlResult(columns, rows)
	if r := []rune(result); len(r) > 2000 {
		result = string(r[:1999]) + "…"
	}
	return fmt.Sprintf("```sql %s\n%s\n```\nResultado: %s\n", target, strings.TrimSpace(query), result)
}

// sqlTableMD es la tabla en Markdown, para pegar en un documento junto con la evidencia.
func sqlTableMD(columns []string, rows []dbsql.Row) string {
	if len(rows) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("| " + strings.Join(columns, " | ") + " |\n|" + strings.Repeat(" --- |", len(columns)) + "\n")
	for i, r := range rows {
		if i == 50 {
			fmt.Fprintf(&b, "\n(%d filas más)\n", len(rows)-50)
			break
		}
		vals := make([]string, len(columns))
		for j, c := range columns {
			vals[j] = strings.ReplaceAll(strings.Join(strings.Fields(cell(r[c])), " "), "|", "\\|")
		}
		b.WriteString("| " + strings.Join(vals, " | ") + " |\n")
	}
	return b.String()
}

// addTaskBlock agrega el bloque a la pila de la tarea por la puerta de siempre (`make tarea-bloque`), con el entorno
// de make LIMPIO: un `N=` heredado por MAKEFLAGS mandaría el bloque a otra tarea sin decirlo.
func addTaskBlock(task, title, body string) error {
	root, err := playgroundRoot()
	if err != nil {
		return err
	}
	if r := []rune(title); len(r) > 120 {
		title = string(r[:119]) + "…"
	}
	cmd := exec.Command("make", "-s", "-C", root, "tarea-bloque", "N="+task, "ARCHIVO=-", "VIA=db")
	cmd.Stdin = strings.NewReader("# " + title + "\n\n" + body)
	for _, kv := range os.Environ() {
		if k, _, _ := strings.Cut(kv, "="); k != "MAKEFLAGS" && k != "MFLAGS" && k != "MAKELEVEL" && k != "MAKEOVERRIDES" {
			cmd.Env = append(cmd.Env, kv)
		}
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 3 {
			lines = lines[len(lines)-3:]
		}
		return fmt.Errorf("%s", strings.Join(lines, " · "))
	}
	return nil
}

// playgroundRoot: la raíz del playground, buscando hacia arriba el módulo de Go con el tablero adentro. Buscaba
// `tablero/server/go.mod`, que dejó de existir cuando el playground pasó a un solo módulo en la raíz (ddfb05db): desde
// ahí `pg sql --bloque` fallaba siempre con «no encontré la raíz del playground» (visto el 2026-10-20).
func playgroundRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for d := dir; ; d = filepath.Dir(d) {
		_, mod := os.Stat(filepath.Join(d, "go.mod"))
		_, board := os.Stat(filepath.Join(d, "tablero", "server"))
		if mod == nil && board == nil {
			return d, nil
		}
		if filepath.Dir(d) == d {
			return "", fmt.Errorf("no encontré la raíz del playground desde %s", dir)
		}
	}
}
