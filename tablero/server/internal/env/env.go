// Package env carga variables desde un archivo .env (formato KEY=VALUE),
// sin dependencias externas. Las variables que ya vengan del entorno tienen
// prioridad (no se pisan), para que `claude mcp add --env ...` o un export
// manual ganen sobre el .env.
package env

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// LoadDefaults carga .env desde el directorio actual y, además, desde el
// directorio del binario y su padre. Útil cuando el server se lanza desde otro
// cwd (ej. registrado en Claude Code): así encuentra tools/.env igual.
// No pisa variables ya definidas.
func LoadDefaults() {
	Load(".env")
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		Load(filepath.Join(dir, ".env"))      // junto al binario
		Load(filepath.Join(dir, "..", ".env")) // p.ej. bin/ -> raíz del repo
	}
}

// Load lee el archivo dado (si existe) y exporta sus variables al proceso.
// Si el archivo no existe, no hace nada: se usan las del entorno.
func Load(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")

		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)

		// quitar comillas envolventes si las hay
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}

		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			_ = os.Setenv(key, val)
		}
	}
}
