// db-query ejecuta SQL de sólo lectura para una tarea del tablero.
//
// El ambiente es obligatorio: omitirlo no puede significar producción por accidente. Para registrar el
// resultado en el documento se usa -md, que imprime sólo ambiente y consulta, sin el nombre de ninguna
// otra herramienta. Con -bloque <tarea> la consulta y lo que dio entran como BLOQUE a la pila de esa
// tarea, con `via: db`.
package main

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	dbsql "creditop/playground/connectors/sql"
	"creditop/playground/tablero/server/internal/layout"
)

func main() {
	target := flag.String("target", "", "ambiente: local · dev · qa · staging · prod")
	query := flag.String("sql", "", "consulta SELECT o WITH de una sola sentencia")
	markdown := flag.Bool("md", false, "imprime la cita limpia para el documento de la tarea")
	block := flag.String("bloque", "", "agrega la consulta y lo que dio como bloque a la pila de esa tarea (id o slug)")
	flag.Parse()

	fail := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", args...)
		os.Exit(2)
	}
	if !dbsql.ValidTarget(*target) {
		fail("falta o no es válido -target (%s)", strings.Join(dbsql.Targets, " · "))
	}
	if err := dbsql.ValidateReadOnly(*query); err != nil {
		fail("consulta rechazada: %v", err)
	}
	config, _, err := dbsql.LoadConfig(*target)
	if err != nil {
		fail("configuración: %v", err)
	}
	rows, source, err := dbsql.Query(config, *query)
	if err != nil {
		fail("consulta en DB %s: %v", *target, err)
	}
	result := queryResult{Target: *target, Source: source, Rows: rows}
	defer addBlock(*block, result, *query)
	if *markdown {
		fmt.Printf("> **DB · %s**\n>\n> \x60\x60\x60sql\n> %s\n> \x60\x60\x60\n", result.Target, strings.TrimSpace(*query))
		return
	}
	fmt.Printf("\n  DB · %s · %s\n\n", result.Target, result.Source)
	if len(result.Rows) == 0 {
		fmt.Println("  (sin filas)")
		return
	}
	columns := dbsql.Columns(result.Rows)
	for _, column := range columns {
		fmt.Printf("  %s", column)
	}
	fmt.Println()
	for _, row := range result.Rows {
		for _, column := range columns {
			fmt.Printf("  %v", row[column])
		}
		fmt.Println()
	}
	fmt.Printf("\n  %d fila(s)\n", len(result.Rows))
}

// queryResult es lo que se imprime y se cita: el ambiente, qué fuente contestó y las filas.
type queryResult struct {
	Target, Source string
	Rows           []dbsql.Row
}

// rowText es una fila en una línea: `columna = valor`, en el orden estable de las columnas.
func rowText(columns []string, row dbsql.Row) string {
	values := make([]string, 0, len(columns))
	for _, column := range columns {
		values = append(values, fmt.Sprintf("%s = %v", column, row[column]))
	}
	return strings.Join(values, " · ")
}

// blockMarkdown arma el bloque de una consulta: el título dice lo que dio —la fila entera si es una sola
// y chica, o cuántas—, la consulta va en su caja con su ambiente, y debajo el resultado en una línea.
func blockMarkdown(result queryResult, query string) string {
	columns := dbsql.Columns(result.Rows)
	title := fmt.Sprintf("%d fila(s) en `%s`", len(result.Rows), result.Target)
	outcome := fmt.Sprintf("%d filas.", len(result.Rows))
	switch n := len(result.Rows); {
	case n == 0:
		title, outcome = fmt.Sprintf("Cero filas en `%s`", result.Target), "cero filas."
	case n == 1:
		outcome = rowText(columns, result.Rows[0]) + "."
		if len(columns) <= 3 {
			title = fmt.Sprintf("%s en `%s`", rowText(columns, result.Rows[0]), result.Target)
		}
	default:
		parts := make([]string, 0, 6)
		for i, row := range result.Rows {
			if i == 5 {
				parts = append(parts, fmt.Sprintf("y %d más", n-5))
				break
			}
			parts = append(parts, "("+rowText(columns, row)+")")
		}
		outcome = fmt.Sprintf("%d filas: %s.", n, strings.Join(parts, "; "))
	}
	clean := strings.NewReplacer("<", "‹", ">", "›", "\n", " ")
	title, outcome = clean.Replace(title), clean.Replace(outcome)
	if r := []rune(title); len(r) > 120 {
		title = string(r[:119]) + "…"
	}
	if r := []rune(outcome); len(r) > 2000 {
		outcome = string(r[:1999]) + "…"
	}
	return fmt.Sprintf("# %s\n\n```sql %s\n%s\n```\nResultado: %s\n", title, result.Target, strings.TrimSpace(query), outcome)
}

// addBlock manda el bloque a la pila por la puerta de siempre, `make tarea-bloque`, que lo valida. Con el
// entorno de make limpio: un make hijo hereda por MAKEFLAGS las variables del padre, y un `N=` de afuera
// mandaría el bloque a otra tarea sin decirlo. Uno que no entra no cambia lo que la consulta dio, pero
// se dice fuerte.
func addBlock(task string, result queryResult, query string) {
	if task == "" {
		return
	}
	root := filepath.Dir(layout.Find().Tools())
	cmd := exec.Command("make", "-s", "-C", root, "tarea-bloque", "N="+task, "ARCHIVO=-", "VIA=db")
	cmd.Stdin = strings.NewReader(blockMarkdown(result, query))
	for _, kv := range os.Environ() {
		if key, _, _ := strings.Cut(kv, "="); key != "MAKEFLAGS" && key != "MFLAGS" && key != "MAKELEVEL" && key != "MAKEOVERRIDES" {
			cmd.Env = append(cmd.Env, kv)
		}
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 3 {
			lines = lines[len(lines)-3:]
		}
		fmt.Printf("\n  ✗ el bloque NO se agregó a la tarea %s: %s\n", task, strings.Join(lines, " · "))
		return
	}
	fmt.Printf("\n  ▸ bloque agregado a la pila de la tarea %s\n", task)
}
