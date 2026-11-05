package main

/* Las apps locales para practicar flujos: cada una vive en navegador/apps/<id>/ con su app.json (nombre, puerto,
 * descripción) y la API la sirve en su puerto al arrancar. El navegador las trata como sitios REALES: lo
 * destructivo pide confirmación igual que en un panel de verdad. */

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

type App struct {
	ID          string `json:"id"`
	Name        string `json:"nombre"`
	Port        int    `json:"puerto"`
	Description string `json:"descripcion"`
	Start       string `json:"inicio,omitempty"` // la ruta donde se arranca (por defecto, /)
	URL         string `json:"url"`
}

func (a App) Addr() string { return fmt.Sprintf("127.0.0.1:%d", a.Port) }

// navegadorDir es navegador/, al lado de este archivo, corra desde donde corra.
func navegadorDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Dir(filepath.Dir(file))
}

// listApps lee el registro. NAVEGADOR_APPS_PORT_OFFSET corre los puertos (la copia de prueba no choca con la tuya).
func listApps() []App {
	files, _ := filepath.Glob(filepath.Join(navegadorDir(), "apps", "*", "app.json"))
	offset := 0
	fmt.Sscan(os.Getenv("NAVEGADOR_APPS_PORT_OFFSET"), &offset)
	out := []App{}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var a App
		if json.Unmarshal(b, &a) != nil || a.Port == 0 {
			continue
		}
		a.ID = filepath.Base(filepath.Dir(f))
		a.Port += offset
		if a.Start == "" {
			a.Start = "/"
		}
		a.URL = fmt.Sprintf("http://127.0.0.1:%d%s", a.Port, a.Start)
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
