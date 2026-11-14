package main

import (
	"context"
	"flag"
	"strings"
	"time"

	"creditop/my-tools/connectors/canon"
	"creditop/my-tools/connectors/shopifyapp"
)

// ─── la base de la app de pagos de Shopify ─────────────────────────────────────────────────────────────
//
// SÓLO PARA LEER: las tiendas configuradas (sucursal y token cifrado) y las sesiones de pago de la app desplegada en dev.
// La sólo-lectura la impone la base (ver `connectors/shopifyapp/db.go`); acá sólo se arma la línea de comandos. La
// consulta y la salida son las de `canon sql`.

func shopifyTarget() param {
	return param{Name: "target", Type: "string", Desc: "el ambiente con la app desplegada: dev", Required: true, Enum: shopifyapp.DBTargets}
}

func openShopifyDB(target string) (*canon.DB, int) {
	if !shopifyapp.ValidDBTarget(target) {
		return nil, fail(2, "falta o no es válido --target (la app de Shopify sólo tiene base en %s)", strings.Join(shopifyapp.DBTargets, " · "))
	}
	cfg, _, err := shopifyapp.LoadDBConfig(target)
	if err != nil {
		return nil, fail(2, "%v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db, err := shopifyapp.OpenDB(ctx, cfg)
	if err != nil {
		return nil, fail(1, "%v", err)
	}
	return db, 0
}

func runShopifySQL(args []string) int {
	fs := flag.NewFlagSet("shopify sql", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): dev")
	query := fs.String("query", "", "SELECT o WITH, una sola sentencia")
	asJSON := fs.Bool("json", false, "filas en JSON completas, con el ambiente y la fuente")
	if fs.Parse(args) != nil {
		return 2
	}
	if err := canon.ValidateReadOnlyPG(*query); err != nil {
		return fail(2, "consulta rechazada: %v", err)
	}
	db, code := openShopifyDB(*target)
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

func runShopifyTables(args []string) int {
	fs := flag.NewFlagSet("shopify tables", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): dev")
	asJSON := fs.Bool("json", false, "las tablas en JSON")
	if fs.Parse(args) != nil {
		return 2
	}
	db, code := openShopifyDB(*target)
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

// runShopifyConfig no abre ninguna conexión: dice qué base atendería el ambiente y qué falta, sin la contraseña.
func runShopifyConfig(args []string) int {
	fs := flag.NewFlagSet("shopify config", flag.ContinueOnError)
	target := fs.String("target", "", "ambiente (obligatorio): dev")
	if fs.Parse(args) != nil {
		return 2
	}
	if !shopifyapp.ValidDBTarget(*target) {
		return fail(2, "falta o no es válido --target (la app de Shopify sólo tiene base en %s)", strings.Join(shopifyapp.DBTargets, " · "))
	}
	cfg, file, err := shopifyapp.LoadDBConfig(*target)
	if err != nil {
		return fail(2, "%v", err)
	}
	port, ssl := cfg.Port, cfg.SSLMode
	if port == "" {
		port = "5432"
	}
	if ssl == "" {
		ssl = "require"
	}
	return writeJSON(map[string]any{
		"target": cfg.Target, "host": cfg.Host, "port": port, "database": cfg.Database, "user": cfg.User, "schema": cfg.Schema,
		"sslmode": ssl, "awsProfile": cfg.AWSProfile, "iam": cfg.Password == "" && cfg.AWSProfile != "",
		"hasCredentials": len(cfg.Missing()) == 0, "missing": cfg.Missing(), "file": file, "readOnly": true,
	})
}
