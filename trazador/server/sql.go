package main

// sql.go — modo `-sql`: una consulta de SOLO LECTURA contra la fuente del target.
//
//   go run . -sql "SELECT id, name FROM countries WHERE id IN (47,60)"
//   go run . -target dev -sql "..." -csv
//
// Por qué existe: el trazador ya tiene la única puerta a la BD de PRODUCCIÓN (Redash), y auditar datos
// —"¿esta columna está vacía también en prod?"— exigía o abrir un túnel aparte o pegar SQL a mano en la
// UI. Los modos existentes (`-ureq`, `-buscar`) responden preguntas de UNA solicitud; esto responde
// preguntas del CONJUNTO, que es lo que hace falta para decidir una migración.
//
// ⚠ CONTRA PROD, Y AUDITADO A NOMBRE DEL TOKEN. El default de `-target` es `prod` (convención del
// binario), así que una consulta sin target va a producción y queda registrada. Por eso el modo:
//
//   1. Es SOLO LECTURA y lo verifica ANTES de salir a la red, con el chequeo único del conector
//      (`connectors/sql.ValidateReadOnly`). No confía en los permisos del datasource: si el usuario de
//      Redash tuviera escritura, la guarda es lo único que hay.
//   2. Imprime target, fuente y la consulta antes de correrla. Nada se ejecuta a ciegas.
//   3. NO pagina ni sigue cursores: lo que devuelve la fuente es lo que se imprime.
//

import (
	"encoding/csv"
	"fmt"
	"os"
	"sort"
	"strings"

	dbsql "creditop/playground/connectors/sql"
)

// sqlMode corre UNA consulta de lectura y la imprime. Exit: 0 ok · 1 falló la consulta · 2 rechazada.
func sqlMode(c config, target, query string, asCSV, mdOut bool, block string) int {
	if err := dbsql.ValidateReadOnly(query); err != nil {
		fmt.Fprintf(os.Stderr, "  %s consulta rechazada: %v\n\n  %s\n\n",
			paint("31", "✘"), err, strings.TrimSpace(query))
		return 2
	}

	source, err := openSource(c)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
		return 1
	}
	defer source.Close()

	if !asCSV && !mdOut {
		step("Consulta de solo lectura")
		detail("target   %s", target)
		detail("fuente   %s", source.Name())
		if strings.HasPrefix(source.Name(), "redash") {
			detail("%s", gray("va a la BD de PRODUCCIÓN y queda auditada a nombre del token"))
		}
		fmt.Println()
		for _, l := range strings.Split(strings.TrimSpace(query), "\n") {
			fmt.Println("       " + gray(strings.TrimRight(l, " \t")))
		}
		fmt.Println()
	}

	rows, err := source.Rows(query)
	if err != nil {
		fmt.Fprintf(os.Stderr, "  %s la consulta falló: %v\n", paint("31", "✘"), err)
		return 1
	}
	cmd := cmdMake("trazador-sql", target, "SQL", strings.Join(strings.Fields(query), " "))
	cols := columns(rows)
	summary := fmt.Sprintf("%d fila(s) en `%s`.", len(rows), target)
	if len(rows) == 0 {
		// Un cero se pega igual que cualquier otro número, y es el que más se malinterpreta: sin la
		// consulta al lado no se distingue «no pasa» de «no supe buscar». Por eso el bloque la lleva.
		summary = fmt.Sprintf("cero filas en `%s`.", target)
		switch {
		case mdOut:
			fmt.Print(annotationMD(summary, cmd))
		case !asCSV:
			fmt.Println("       (sin filas)")
		}
		emitBlock(block, blockMD(summary, cmd, rowsResult(cols, rows)))
		return 0
	}

	if asCSV {
		return printCSV(cols, rows)
	}
	if mdOut {
		fmt.Print(annotationMD(summary, cmd))
		fmt.Print("\n" + tableMD(cols, rows))
	} else {
		printTable(cols, rows)
		fmt.Printf("\n       %s\n", gray(fmt.Sprintf("%d fila(s)", len(rows))))
		pie(cmd)
	}
	emitBlock(block, blockMD(summary, cmd, rowsResult(cols, rows)))
	return 0
}

// columns devuelve las llaves en un orden ESTABLE. `Fila` es un map, así que sin esto el orden de las
// columns cambiaría entre corridas y comparar dos salidas sería imposible.
func columns(rows []Row) []string {
	vistas := map[string]bool{}
	var cols []string
	for _, f := range rows {
		for k := range f {
			if !vistas[k] {
				vistas[k] = true
				cols = append(cols, k)
			}
		}
	}
	sort.Strings(cols)
	return cols
}

// cell aplana para la TABLA: un salto de línea rompería las columnas. Para CSV se usa `rawCell`
// —`encoding/csv` ya entrecomilla lo que trae saltos—, porque ahí el punto es la fidelidad: aplanar
// devolvía el cuerpo de una función almacenada en UNA sola línea, imposible de revisar en un diff.
func cell(v any) string {
	return strings.ReplaceAll(rawCell(v), "\n", " ")
}

func rawCell(v any) string {
	if v == nil {
		return "NULL"
	}
	return fmt.Sprint(v)
}

func printTable(cols []string, rows []Row) {
	width := make([]int, len(cols))
	for i, c := range cols {
		width[i] = len(c)
	}
	for _, f := range rows {
		for i, c := range cols {
			if n := len(cell(f[c])); n > width[i] {
				width[i] = n
			}
		}
	}
	var cab, sep strings.Builder
	for i, c := range cols {
		cab.WriteString(fmt.Sprintf("%-*s  ", width[i], c))
		sep.WriteString(strings.Repeat("─", width[i]) + "  ")
	}
	fmt.Println("       " + bold(strings.TrimRight(cab.String(), " ")))
	fmt.Println("       " + gray(strings.TrimRight(sep.String(), " ")))
	for _, f := range rows {
		var l strings.Builder
		for i, c := range cols {
			l.WriteString(fmt.Sprintf("%-*s  ", width[i], cell(f[c])))
		}
		fmt.Println("       " + strings.TrimRight(l.String(), " "))
	}
}

func printCSV(cols []string, rows []Row) int {
	w := csv.NewWriter(os.Stdout)
	defer w.Flush()
	if err := w.Write(cols); err != nil {
		fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
		return 1
	}
	for _, f := range rows {
		rec := make([]string, len(cols))
		for i, c := range cols {
			rec[i] = rawCell(f[c])
		}
		if err := w.Write(rec); err != nil {
			fmt.Fprintf(os.Stderr, "  %s %v\n", paint("31", "✘"), err)
			return 1
		}
	}
	return 0
}
