package main

/* La configuración vive en UN archivo: el `.env` de la raíz del proyecto. Las claves de cada ambiente llevan su
 * nombre adelante (`QA_DB_HOST`, `LOCAL_API_BASE_URL`, `PROD_REDASH_TOKEN`); las que no dependen del ambiente van
 * sin prefijo (`SHOPIFY_REPO`). El proceso gana sobre el archivo, y una variable vacía en el proceso no lo tapa. */

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

var (
	envOnce sync.Once
	envFile = map[string]string{}
)

// appRoot es la raíz del proyecto (la carpeta que tiene server/ y src/).
func appRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Clean(filepath.Join(filepath.Dir(file), ".."))
}

func loadEnvFile() {
	data, err := os.ReadFile(filepath.Join(appRoot(), ".env"))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(strings.TrimPrefix(line, "export "), "=")
		if ok {
			envFile[strings.TrimSpace(k)] = strings.Trim(strings.TrimSpace(v), `"'`)
		}
	}
}

// env lee una clave sin ambiente.
func env(k string) string {
	envOnce.Do(loadEnvFile)
	if v := os.Getenv(k); v != "" {
		return v
	}
	return envFile[k]
}

// envKey es el nombre de la clave de un ambiente: envKey("qa", "DB_HOST") = "QA_DB_HOST".
func envKey(target, k string) string { return strings.ToUpper(target) + "_" + k }

// appEnv lee las claves de un ambiente por su nombre corto: appEnv("qa")("DB_HOST") lee QA_DB_HOST.
func appEnv(target string) func(string) string {
	return func(k string) string { return env(envKey(target, k)) }
}
