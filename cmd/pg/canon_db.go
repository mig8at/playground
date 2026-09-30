package main

import (
	"context"
	"flag"
	"fmt"
	"strings"
	"time"

	"creditop/playground/connectors/canon"
)

// ─── canon (la base) ───────────────────────────────────────────────────────────────────────────────
//
// La base de Postgres de canon, SÓLO PARA LEER: las tablas del corpus, los esquemas de las galaxias, los mantenedores, las
// revisiones. La API de canon (`connectors/canon`) no las expone todas. La solo-lectura la impone la propia base (ver
// `connectors/canon/db.go`); acá sólo se arma la línea de comandos.
//
// ⚠ Esa base tiene las preguntas y conversaciones que la gente le hizo a canon: pueden traer nombres o datos de personas. Se
// consulta para diagnosticar; no se pega en tareas, PRs ni mensajes.

// canonTarget: sólo dos ambientes tienen base de canon.
func canonTarget() param {
	return param{Name: "target", Type: "string", Desc: "el ambiente: local (el laboratorio de canon) o prod", Required: true, Enum: canon.DBTargets}
}

// abrirCanonDB carga, valida y abre. Devuelve el código de salida si algo falla.
func openCanonDB(target string) (*canon.DB, int) {
	if !canon.ValidDBTarget(target) {
		return nil, fail(2, "falta o no es válido --target (canon sólo tiene base en %s)", strings.Join(canon.DBTargets, " · "))
	}
	cfg, _, err := canon.LoadDBConfig(target)
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db, err := canon.OpenDB(ctx, cfg)
	if err != nil {
		return nil, fail(1, "%v", err)
	}
	return db, 0
}

func printResult(target string, r canon.Result, query string, asJSON bool) int {
	if asJSON {
		out := map[string]any{"target": target, "source": r.Source, "columns": r.Columns, "rows": r.Rows}
		if query != "" {
			out["query"] = query
		}
		if r.Truncated {
			out["truncated"] = fmt.Sprintf("hay más de %d filas: se cortó", canon.MaxRowsDB)
		}
		return writeJSON(out)
	}
	truncation := ""
	if r.Truncated {
		truncation = fmt.Sprintf(" (cortado en %d)", canon.MaxRowsDB)
	}
	fmt.Printf("%s · %s · %d fila(s)%s\n", target, r.Source, len(r.Rows), truncation)
	for _, row := range r.Rows {
		parts := make([]string, len(r.Columns))
		for i, c := range r.Columns {
			v := strings.ReplaceAll(cell(row[c]), "\n", " ")
			// Un contenido de archivo o una conversación entera taparía la pantalla: en texto se recorta; --json lo trae completo.
			if r := []rune(v); len(r) > 240 {
				v = string(r[:240]) + "… (" + fmt.Sprint(len(r)) + " caracteres; --json los trae completos)"
			}
			parts[i] = c + "=" + v
		}
		fmt.Println("  " + strings.Join(parts, " · "))
	}
	return 0
}

func runCanonSQL(args []string) int {
	fs := flag.NewFlagSet("canon sql", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): local o prod")
	query := fs.String("query", "", "SELECT o WITH, una sola sentencia")
	asJSON := fs.Bool("json", false, "filas en JSON completas, con el ambiente y la fuente")
	if fs.Parse(args) != nil {
		return 2
	}
	if !canon.ValidDBTarget(*target) {
		return fail(2, "falta o no es válido --target (canon sólo tiene base en %s)", strings.Join(canon.DBTargets, " · "))
	}
	if err := canon.ValidateReadOnlyPG(*query); err != nil {
		return fail(2, "consulta rechazada: %v", err)
	}
	db, code := openCanonDB(*target)
	if db == nil {
		return code
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	r, err := db.Query(ctx, *query)
	if err != nil {
		return fail(1, "consulta en %s: %v", *target, err)
	}
	return printResult(*target, r, *query, *asJSON)
}

func runCanonTables(args []string) int {
	fs := flag.NewFlagSet("canon tables", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): local o prod")
	asJSON := fs.Bool("json", false, "las tablas en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	db, code := openCanonDB(*target)
	if db == nil {
		return code
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	r, err := db.Tables(ctx)
	if err != nil {
		return fail(1, "tablas en %s: %v", *target, err)
	}
	return printResult(*target, r, "", *asJSON)
}

// runCanonConfig no abre ninguna conexión: dice qué base atendería el ambiente y qué falta, sin la contraseña.
func runCanonConfig(args []string) int {
	fs := flag.NewFlagSet("canon config", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): local o prod")
	if fs.Parse(args) != nil {
		return 2
	}
	if !canon.ValidDBTarget(*target) {
		return fail(2, "falta o no es válido --target (canon sólo tiene base en %s)", strings.Join(canon.DBTargets, " · "))
	}
	cfg, file, err := canon.LoadDBConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	port, database, ssl := cfg.Port, cfg.Database, cfg.SSLMode
	if port == "" {
		port = "5432"
	}
	if database == "" {
		database = "canon"
	}
	if ssl == "" {
		ssl = "require"
	}
	return writeJSON(map[string]any{
		"target": cfg.Target, "host": cfg.Host, "port": port, "database": database, "user": cfg.User, "sslmode": ssl,
		"hasCredentials": len(cfg.Missing()) == 0, "missing": cfg.Missing(), "file": file, "readOnly": true,
	})
}
