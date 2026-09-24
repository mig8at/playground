// Package layout sabe dónde vive cada cosa del tablero en disco.
//
// Desde el 2026-09-23 cada tarea es una CARPETA, con todo lo suyo adentro:
//
//	tablero/tasks/<slug>/task.md        el documento: frontmatter, cuerpo privado y publicable
//	tablero/tasks/<slug>/context.jsonl  la pila de bloques
//	tablero/tasks/<slug>/artifacts/     prototipos, SQL, notas: cualquier archivo de la tarea
//	tablero/data/                       lo operativo: bitácora, pulso, cachés, settings, trampas
//
// Antes las tareas eran `data/<slug>.md` sueltos, y lo demás se les unía POR NOMBRE: la pila en
// `data/task-context/<slug>.jsonl` y los prototipos en `data/artifacts/<slug>.<variante>.html`. Esa
// convención se desincronizó sin avisar: la tarea 48 se renombró el 2026-08-14 y su prototipo quedó con
// el nombre viejo, invisible en el tablero durante cinco semanas. Una carpeta no se desincroniza:
// renombrarla se lleva todo lo que tiene adentro.
//
// Y antes de este paquete, seis comandos resolvían `../data` cada uno por su cuenta.
package layout

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

// Los nombres fijos dentro de la carpeta de una tarea.
const (
	TaskFile     = "task.md"
	ContextFile  = "context.jsonl"
	ArtifactsDir = "artifacts"
)

// Layout son las dos raíces del tablero en disco. `Tasks` vive siempre al lado de `Data`.
type Layout struct {
	Data  string
	Tasks string
}

// Tools es la carpeta `tools/` de la raíz del playground: ahí vive `repos.json`, la lista ÚNICA de repos que
// el tablero consulta en vez de copiarla, y su padre es desde donde se corre `make`.
//
// Primero, dos niveles arriba de `data/`. ⚠ Pero TABLERO_DATA puede apuntar AFUERA del repo —el agente
// del pulso, una copia para probar sin tocar las pilas reales— y ahí «al lado de los datos» no hay nada:
// una herramienta que mandaba su bloque con `make tarea-bloque` recibía «No rule to make target» (lo cazó
// la prueba de punta a punta del 2026-09-23). Entonces se busca hacia arriba desde donde se corre.
func (l Layout) Tools() string {
	data, err := filepath.Abs(l.Data)
	if err != nil {
		data = l.Data
	}
	fromData := filepath.Join(filepath.Dir(filepath.Dir(data)), "tools")
	if _, err := os.Stat(filepath.Join(fromData, "repos.json")); err == nil {
		return fromData
	}
	if wd, err := os.Getwd(); err == nil {
		for d := wd; ; d = filepath.Dir(d) {
			if _, err := os.Stat(filepath.Join(d, "tools", "repos.json")); err == nil {
				return filepath.Join(d, "tools")
			}
			if filepath.Dir(d) == d {
				break
			}
		}
	}
	return fromData
}

// At arma el layout a partir de la carpeta `data/`.
func At(data string) Layout {
	return Layout{Data: data, Tasks: filepath.Join(filepath.Dir(filepath.Clean(data)), "tasks")}
}

// candidates: dónde puede estar `data/` según desde dónde se corra. `../data` al correr desde
// `server/` (como lo hacen el Makefile y `npm run dev`), `data` desde `tablero/`, `tablero/data` desde
// la raíz del repo.
var candidates = []string{"../data", "data", "tablero/data"}

// Find: TABLERO_DATA si está —la usa el agente del pulso, que no corre desde el repo—, y si no, la
// primera `data/` que exista desde el directorio actual. Sin ninguna, `../data`.
func Find() Layout {
	if l, err := FindExisting(); err == nil {
		return l
	}
	return At("../data")
}

// FindExisting es Find sin el último recurso: falla si no encuentra una `data/` que exista.
func FindExisting() (Layout, error) {
	if v := os.Getenv("TABLERO_DATA"); v != "" {
		return At(v), nil
	}
	for _, d := range candidates {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return At(d), nil
		}
	}
	return Layout{}, errors.New("no encontré `tablero/data`: corré esto desde el repo")
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// ValidSlug: un slug es una carpeta de primer nivel de `tasks/`, sin subcarpetas ni subidas de nivel.
func ValidSlug(slug string) bool { return slugRe.MatchString(slug) }

// Dir es la carpeta de una tarea.
func (l Layout) Dir(slug string) string { return filepath.Join(l.Tasks, slug) }

// TaskPath es el documento de una tarea.
func (l Layout) TaskPath(slug string) string { return filepath.Join(l.Dir(slug), TaskFile) }

// ContextPath es la pila de bloques de una tarea.
func (l Layout) ContextPath(slug string) string { return filepath.Join(l.Dir(slug), ContextFile) }

// ArtifactsPath es la carpeta de artifacts de una tarea.
func (l Layout) ArtifactsPath(slug string) string { return filepath.Join(l.Dir(slug), ArtifactsDir) }

// Slugs: las tareas que existen, o sea las carpetas de `tasks/` que tienen su `task.md`, en orden
// alfabético. Una carpeta sin `task.md` no es una tarea (puede ser una a medio crear).
func (l Layout) Slugs() ([]string, error) {
	entries, err := os.ReadDir(l.Tasks)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []string
	for _, e := range entries {
		if !e.IsDir() || !ValidSlug(e.Name()) {
			continue
		}
		if fi, err := os.Stat(l.TaskPath(e.Name())); err == nil && !fi.IsDir() {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	return out, nil
}

// TaskPaths son los documentos de todas las tareas, en el orden de Slugs.
func (l Layout) TaskPaths() ([]string, error) {
	slugs, err := l.Slugs()
	if err != nil {
		return nil, err
	}
	out := make([]string, len(slugs))
	for i, s := range slugs {
		out[i] = l.TaskPath(s)
	}
	return out, nil
}

// SlugOf devuelve el slug a partir de la ruta del documento de una tarea (`…/tasks/<slug>/task.md`).
func SlugOf(taskPath string) string { return filepath.Base(filepath.Dir(taskPath)) }
