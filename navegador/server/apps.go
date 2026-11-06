package main

/* Las apps locales para practicar flujos: cada una vive en navegador/apps/<id>/ con su app.json (nombre, puerto,
 * descripción) y la API la sirve en su puerto al arrancar. El navegador las trata como sitios REALES: lo
 * destructivo pide confirmación igual que en un panel de verdad. */

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
)

type App struct {
	ID          string `json:"id"`
	Name        string `json:"nombre"`
	Port        int    `json:"puerto"`
	Description string `json:"descripcion"`
	Start       string `json:"inicio,omitempty"` // la ruta donde se arranca (por defecto, /)
	URL         string `json:"url"`
	Real        bool   `json:"real,omitempty"` // un proyecto con nombre propio de un sitio real (no una app de práctica)
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

// Project es un proyecto con nombre propio para sitios reales (VTEX, Grafana…): agrupa los flujos de uno o varios
// hosts. Vive en navegador/flujos/<id>/proyecto.json, al lado de sus flujos.
type Project struct {
	Name  string   `json:"nombre"`
	Hosts []string `json:"hosts"`
	Start string   `json:"inicio"` // dónde se abre en vivo
}

// listProjects son los proyectos con nombre propio (proyecto.json), con su id.
func listProjects() map[string]Project {
	out := map[string]Project{}
	files, _ := filepath.Glob(filepath.Join(flowsDir(), "*", "proyecto.json"))
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		var p Project
		if json.Unmarshal(b, &p) == nil {
			out[filepath.Base(filepath.Dir(f))] = p
		}
	}
	return out
}

// listAll es lo que ve la interfaz como proyectos: las apps de práctica y los proyectos con nombre propio.
func listAll() []App {
	all := listApps()
	for id, p := range listProjects() {
		all = append(all, App{ID: id, Name: p.Name, Description: "Sitio real: " + strings.Join(p.Hosts, ", "), URL: p.Start, Real: true})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Name < all[j].Name })
	return all
}

// createProject da de alta un proyecto con nombre propio para el host de una URL.
func createProject(id, name, start string) error {
	id = slugify(id)
	u, err := url.Parse(withScheme(start))
	if err != nil || u.Host == "" {
		return fmt.Errorf("no es una URL: %q", start)
	}
	if strings.TrimSpace(name) == "" {
		name = id
	}
	b, _ := json.MarshalIndent(Project{Name: strings.TrimSpace(name), Hosts: []string{u.Host}, Start: u.String()}, "", "  ")
	dir := filepath.Join(flowsDir(), id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "proyecto.json"), append(b, '\n'), 0o644); err != nil {
		return err
	}
	hub.Publish("apps", listAll())
	hub.Publish("flows", listFlows())
	return nil
}
