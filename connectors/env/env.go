// Package env es de dónde saca cada conector sus credenciales: UN archivo por ambiente,
// `connectors/.env.<target>`, fuera de git. Las variables del proceso ganan, para que una automatización
// no tenga que escribir secretos en disco.
//
// ⚠ ES UNA DECISIÓN QUE REVIERTE OTRA, y sólo en parte. Desde el 2026-07-22 cada herramienta tenía su
// `.env.<target>` autosuficiente, y eso estaba bien mientras cada una tenía su propio cliente. Con un
// solo cliente por servicio, las credenciales de ese servicio viven con él: medido el 2026-09-24, el
// tablero no tenía en esta máquina credenciales de base para NINGÚN ambiente y el trazador sí, así que
// `tablero-db` contestaba «no hay fuente» siempre. Las perillas propias de cada herramienta se quedan
// en su `.env`.
package env

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Dir es la carpeta `connectors/`: se busca hacia arriba desde donde se corre, porque los comandos
// corren desde la carpeta de cada herramienta (`tablero/server`, `trazador/server`).
func Dir() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for d := wd; ; d = filepath.Dir(d) {
		if info, err := os.Stat(filepath.Join(d, "connectors", "env")); err == nil && info.IsDir() {
			return filepath.Join(d, "connectors"), nil
		}
		if filepath.Dir(d) == d {
			return "", fmt.Errorf("no encontré la carpeta connectors/ subiendo desde %s", wd)
		}
	}
}

// Values son las claves de un ambiente, y de qué archivo salieron (vacío si no hay archivo).
type Values struct {
	File string
	kv   map[string]string
}

// Load lee `connectors/.env.<target>`. Que el archivo no exista no es un error: puede venir todo del
// proceso. Qué falta lo dice cada conector, que sabe qué necesita.
func Load(target string) (Values, error) {
	dir, err := Dir()
	if err != nil {
		return Values{}, err
	}
	path := filepath.Join(dir, ".env."+target)
	kv, err := parse(path)
	if os.IsNotExist(err) {
		return Values{kv: map[string]string{}}, nil
	}
	if err != nil {
		return Values{}, err
	}
	return Values{File: path, kv: kv}, nil
}

// Get devuelve la primera clave con valor, primero en el proceso y después en el archivo.
func (v Values) Get(keys ...string) string {
	for _, k := range keys {
		if s := strings.TrimSpace(os.Getenv(k)); s != "" {
			return s
		}
	}
	for _, k := range keys {
		if s := strings.TrimSpace(v.kv[k]); s != "" {
			return s
		}
	}
	return ""
}

// parse lee un KEY=VALUE por línea, sin interpolación ni multilínea: un `.env` nunca se ejecuta.
func parse(path string) (map[string]string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		out[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	return out, nil
}
