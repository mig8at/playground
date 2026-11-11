package main

/* Las apps locales para practicar flujos: cada una vive en jarvis/apps/<id>/ con su app.json (name, port,
 * description, start) y la API la sirve en su puerto al arrancar. El navegador las trata como sitios REALES: lo
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
	Name        string `json:"name"`
	Port        int    `json:"port"`
	Description string `json:"description"`
	Start       string `json:"start,omitempty"` // la ruta donde se arranca (por defecto, /)
	URL         string `json:"url"`
	Real        bool   `json:"real,omitempty"` // un proyecto con nombre propio de un sitio real (no una app de práctica)
}

func (a App) Addr() string { return fmt.Sprintf("127.0.0.1:%d", a.Port) }

// navegadorDir es jarvis/, al lado de este archivo, corra desde donde corra.
func jarvisDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Dir(filepath.Dir(file))
}

// listApps lee el registro. JARVIS_APPS_PORT_OFFSET corre los puertos (la copia de prueba no choca con la tuya).
func listApps() []App {
	files, _ := filepath.Glob(filepath.Join(jarvisDir(), "apps", "*", "app.json"))
	offset := 0
	fmt.Sscan(os.Getenv("JARVIS_APPS_PORT_OFFSET"), &offset)
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
// hosts. Vive en jarvis/flows/<id>/project.json, al lado de sus flujos.
type Project struct {
	Name  string   `json:"name"`
	Hosts []string `json:"hosts"`
	Start string   `json:"start"` // dónde se abre en vivo
}

// listProjects son los proyectos con nombre propio (project.json; los de antes del 2026-11-07, proyecto.json), con su id.
func listProjects() map[string]Project {
	out := map[string]Project{}
	files, _ := filepath.Glob(filepath.Join(flowsDir(), "*", "project.json"))
	old, _ := filepath.Glob(filepath.Join(flowsDir(), "*", "proyecto.json"))
	files = append(files, old...)
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
	if err := os.WriteFile(filepath.Join(dir, "project.json"), append(b, '\n'), 0o644); err != nil {
		return err
	}
	hub.Publish("apps", listAll())
	hub.Publish("flows", listFlows())
	return nil
}
