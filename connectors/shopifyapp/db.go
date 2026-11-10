package shopifyapp

import (
	"context"
	"fmt"
	"net/url"
	"os/exec"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"creditop/playground/connectors/canon"
	"creditop/playground/connectors/env"
)

/* LA BASE DE LA APP DE PAGOS DE SHOPIFY, sólo para leer.
 *
 * La app del repo `shopify` guarda en Postgres la configuración de cada tienda (la sucursal y su token, cifrado) y cada
 * sesión de pago (`CreditopShop`, `creditopPaymentSession`…). Desde el 2026-11-09 corre desplegada en dev
 * (`shopify-app.dev.creditop.com`) con su base en RDS. Esto es para mirarla: si la tienda quedó configurada, en qué
 * estado quedó una sesión de pago, si llegó el aviso de Creditop.
 *
 * Las mismas tres reglas que la base de canon (`connectors/canon/db.go`), y por lo mismo:
 *  1. SÓLO LECTURA, impuesta por la base (transacción READ ONLY + `default_transaction_read_only=on`) y por el chequeo
 *     previo. Igual, el usuario tiene que ser de sólo lectura: la app entra con el suyo por IAM; éste es otro.
 *  2. El ambiente es OBLIGATORIO. Hoy sólo `dev`; prod se suma cuando la app esté desplegada allá.
 *  3. Las claves son `SHOPIFY_POSTGRES_*` y NUNCA `DATABASE_URL`: ésa la lee la propia app.
 *
 * La base usa IAM (el RDS `microservices-development`): sin contraseña, con `SHOPIFY_POSTGRES_AWS_PROFILE` el conector
 * pide a AWS un token de 15 minutos por conexión (`aws rds generate-db-auth-token`) con la sesión de ese perfil. Sirve
 * sólo si el rol de esa sesión tiene `rds-db:connect` sobre el usuario: medido el 2026-11-09, el DeveloperAccess de dev
 * NO lo tiene para `shopify_user` («PAM authentication failed»). Con un usuario de contraseña, va en
 * `SHOPIFY_POSTGRES_PASSWORD` y el perfil no hace falta.
 *
 * ⚠ La tabla de tiendas guarda el token de cada sucursal CIFRADO, y la de sesiones trae datos del comprador: se consulta
 * para diagnosticar, no se pega en tareas, PRs ni mensajes. */

// DBTargets son los ambientes que tienen la app desplegada con su base.
var DBTargets = []string{"dev"}

// ValidDBTarget: ¿este ambiente tiene la base de la app?
func ValidDBTarget(t string) bool {
	for _, x := range DBTargets {
		if x == t {
			return true
		}
	}
	return false
}

// DBConfig es de dónde leer en un ambiente.
type DBConfig struct {
	Target, Host, Port, Database, User, Password, SSLMode, Schema string
	// AWSProfile: con él y sin contraseña, la contraseña es un token de IAM de esa sesión de AWS.
	AWSProfile, AWSRegion string
}

// LoadDBConfig arma la configuración desde `connectors/.env.<target>` (las variables del proceso ganan).
func LoadDBConfig(target string) (DBConfig, string, error) {
	if !ValidDBTarget(target) {
		return DBConfig{}, "", fmt.Errorf("la app de Shopify sólo tiene base en %s (pediste %q)", strings.Join(DBTargets, " · "), target)
	}
	v, err := env.Load(target)
	if err != nil {
		return DBConfig{}, "", err
	}
	return DBConfig{
		Target: target, Host: v.Get("SHOPIFY_POSTGRES_HOST"), Port: v.Get("SHOPIFY_POSTGRES_PORT"),
		Database: v.Get("SHOPIFY_POSTGRES_DATABASE"), User: v.Get("SHOPIFY_POSTGRES_USER"),
		Password: v.Get("SHOPIFY_POSTGRES_PASSWORD"), SSLMode: v.Get("SHOPIFY_POSTGRES_SSLMODE"),
		Schema: v.Get("SHOPIFY_POSTGRES_SCHEMA"), AWSProfile: v.Get("SHOPIFY_POSTGRES_AWS_PROFILE"),
		AWSRegion: v.Get("SHOPIFY_POSTGRES_AWS_REGION"),
	}, v.File, nil
}

// Missing dice qué falta para conectar. Vacío si está todo.
func (c DBConfig) Missing() []string {
	var out []string
	for _, f := range []struct{ key, value string }{
		{"SHOPIFY_POSTGRES_HOST", c.Host}, {"SHOPIFY_POSTGRES_DATABASE", c.Database},
		{"SHOPIFY_POSTGRES_USER", c.User},
	} {
		if f.value == "" {
			out = append(out, f.key)
		}
	}
	if c.Password == "" && c.AWSProfile == "" {
		out = append(out, "SHOPIFY_POSTGRES_PASSWORD o SHOPIFY_POSTGRES_AWS_PROFILE")
	}
	return out
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

// ConnString arma la cadena de conexión, con la contraseña codificada y la sesión de sólo lectura. El esquema de Prisma
// (el `?schema=` de la app) va como `search_path`, para que las tablas se nombren sin prefijo.
func (c DBConfig) ConnString() string {
	u := url.URL{Scheme: "postgres", User: url.UserPassword(c.User, c.Password), Host: c.Host + ":" + orDefault(c.Port, "5432"), Path: "/" + c.Database}
	q := url.Values{}
	q.Set("sslmode", orDefault(c.SSLMode, "require")) // RDS: cifrada
	q.Set("connect_timeout", "10")
	q.Set("application_name", "playground-connectors")
	q.Set("default_transaction_read_only", "on")
	q.Set("statement_timeout", fmt.Sprint(canon.DefaultTimeoutMs))
	q.Set("idle_in_transaction_session_timeout", "60000")
	if c.Schema != "" {
		q.Set("search_path", c.Schema)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// OpenDB valida la configuración y abre la conexión, con la misma consulta de sólo lectura que la base de canon.
func OpenDB(ctx context.Context, c DBConfig) (*canon.DB, error) {
	if !ValidDBTarget(c.Target) {
		return nil, fmt.Errorf("la app de Shopify sólo tiene base en %s (pediste %q)", strings.Join(DBTargets, " · "), c.Target)
	}
	if missing := c.Missing(); len(missing) > 0 {
		return nil, fmt.Errorf("falta %s para la base de la app de Shopify en %s (connectors/.env.%s)", strings.Join(missing, ", "), c.Target, c.Target)
	}
	if c.Password == "" {
		token, err := iamToken(ctx, c)
		if err != nil {
			return nil, err
		}
		c.Password = token
	}
	cfg, err := pgx.ParseConfig(c.ConnString())
	if err != nil {
		return nil, fmt.Errorf("la configuración de la base de la app de Shopify no es válida: %s", redact(err.Error(), c.Password))
	}
	db := stdlib.OpenDB(*cfg)
	db.SetMaxOpenConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		hint := "¿VPN de dev?"
		if strings.Contains(err.Error(), "PAM authentication failed") {
			hint = "la red llega, pero el rol de AWS de " + orDefault(c.AWSProfile, "esta sesión") + " no tiene rds-db:connect sobre " + c.User
		}
		return nil, fmt.Errorf("no se pudo conectar a la base de la app de Shopify en %s (%s:%s; %s): %s",
			c.Target, c.Host, orDefault(c.Port, "5432"), hint, redact(err.Error(), c.Password))
	}
	return canon.NewDB(db, fmt.Sprintf("shopify-app postgres %s/%s", c.Host, c.Database)), nil
}

// iamToken pide a AWS la contraseña de 15 minutos de IAM para el usuario, con la sesión del perfil. Firma local: no
// falla por permisos; si el rol no puede entrar, lo dice la base al conectar («PAM authentication failed»).
func iamToken(ctx context.Context, c DBConfig) (string, error) {
	out, err := exec.CommandContext(ctx, "aws", "rds", "generate-db-auth-token", "--hostname", c.Host, "--port", orDefault(c.Port, "5432"),
		"--region", orDefault(c.AWSRegion, "us-east-2"), "--username", c.User, "--profile", c.AWSProfile).Output()
	if err != nil {
		return "", fmt.Errorf("no se pudo pedir el token de IAM con el perfil %q (¿`aws sso login --profile %s`?): %v", c.AWSProfile, c.AWSProfile, err)
	}
	return strings.TrimSpace(string(out)), nil
}

// redact saca la contraseña de un texto: un error de conexión puede traer la cadena entera.
func redact(s, secret string) string {
	if secret == "" {
		return s
	}
	s = strings.ReplaceAll(s, secret, "***")
	return strings.ReplaceAll(s, url.QueryEscape(secret), "***")
}
