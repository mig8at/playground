// db-query ejecuta SQL de sólo lectura para una tarea del tablero.
//
// El ambiente es obligatorio: omitirlo no puede significar producción por accidente. Para registrar el
// resultado en el documento se usa -md, que imprime sólo ambiente y consulta, sin el nombre de ninguna
// otra herramienta.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"creditop/tablero/server/internal/dbquery"
)

func main() {
	target := flag.String("target", "", "ambiente: local · dev · staging · prod")
	query := flag.String("sql", "", "consulta SELECT o WITH de una sola sentencia")
	markdown := flag.Bool("md", false, "imprime la cita limpia para el documento de la tarea")
	flag.Parse()

	fail := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", args...)
		os.Exit(2)
	}
	if !dbquery.ValidTarget(*target) {
		fail("falta o no es válido -target (local · dev · staging · prod)")
	}
	if err := dbquery.ValidateReadOnly(*query); err != nil {
		fail("consulta rechazada: %v", err)
	}
	config, err := dbquery.LoadConfig(*target)
	if err != nil {
		fail("configuración: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	result, err := dbquery.Query(ctx, config, *query)
	if err != nil {
		fail("consulta en DB %s: %v", *target, err)
	}
	if *markdown {
		fmt.Printf("> **DB · %s**\n>\n> \x60\x60\x60sql\n> %s\n> \x60\x60\x60\n", result.Target, strings.TrimSpace(*query))
		return
	}
	fmt.Printf("\n  DB · %s · %s\n\n", result.Target, result.Source)
	if len(result.Rows) == 0 {
		fmt.Println("  (sin filas)")
		return
	}
	columns := dbquery.Columns(result.Rows)
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
