package main

import (
	"bufio"
	"os"
	"strings"
)

// loadEnvFile parsea un .env (líneas `export KEY=value` o `KEY=value`, con comillas simples/dobles
// y comentarios inline) y las setea en el entorno del proceso. No pisa variables ya presentes.
// El MCP se autoabastece de backend-mcp/.env.dev al arrancar.
func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		switch {
		case len(v) >= 2 && v[0] == '\'' && v[len(v)-1] == '\'':
			v = v[1 : len(v)-1]
		case len(v) >= 2 && v[0] == '"' && v[len(v)-1] == '"':
			v = v[1 : len(v)-1]
		default:
			// comentario inline en valor sin comillas: cortar en el primer " #" o "\t#"
			if i := strings.IndexAny(v, "#"); i > 0 && (v[i-1] == ' ' || v[i-1] == '\t') {
				v = strings.TrimSpace(v[:i])
			}
		}
		if _, present := os.LookupEnv(k); !present {
			os.Setenv(k, v)
		}
	}
	return sc.Err()
}

// Config — apunta a dev (default) o local según --target / E2E_TARGET. Lee .env.<target>.
type Config struct {
	DBUser, DBPass, DBHost, DBPort, DBName string
	APIBaseURL                             string
	Seed                                   string
	AppKey                                 string // APP_KEY de Laravel (base64:…) — para forjar el datacredito encriptado
	Target                                 string // "dev" (default) | "local"
}

func getenvOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func configFromEnv() Config {
	return Config{
		DBUser:     os.Getenv("E2E_DB_USER"),
		DBPass:     os.Getenv("E2E_DB_PASS"),
		DBHost:     os.Getenv("E2E_DB_HOST"),
		DBPort:     getenvOr("E2E_DB_PORT", "3306"),
		DBName:     getenvOr("E2E_DB_NAME", "creditop"),
		APIBaseURL: getenvOr("E2E_API_BASE_URL", "http://legacy-backend.inertia-develop/api"),
		Seed:       getenvOr("SEED", "mcp"),
		AppKey:     os.Getenv("APP_KEY"),
	}
}

// guardOK: en local no hace falta confirmación; en dev (compartido) exige el flag explícito.
func guardOK() bool {
	return cfg.Target == "local" || os.Getenv("I_KNOW_THIS_TOUCHES_SHARED_DEV") == "1"
}
