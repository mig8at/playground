package models

// El registro: qué herramienta usa qué modelo, y qué claves de lo instalado son suyas. Vive en `models/registry.json`
// (en git). Lo que no aparece en el registro no lo usa ninguna herramienta: se puede borrar sin dudar.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"creditop/my-tools/lib/machine"
)

// Use: una herramienta que usa un modelo.
type Use struct {
	Tool   string   `json:"tool"`   // point · chat · sentinel …
	Model  string   `json:"model"`  // el id de Hugging Face (o el nombre del modelo)
	Files  []string `json:"files"`  // las claves de lo instalado que necesita
	What   string   `json:"what"`   // para qué, en palabras
	Source string   `json:"source"` // dónde está escrito en el código que lo usa
	Since  string   `json:"since"`
}

type Registry struct {
	Uses []Use `json:"uses"`
	path string
}

func RegistryPath(root string) string { return filepath.Join(root, "models", "registry.json") }

// LoadRegistry lee el registro; uno que no existe está vacío, uno a medio escribir es un error.
func LoadRegistry(root string) (*Registry, error) {
	reg := &Registry{path: RegistryPath(root)}
	raw, err := os.ReadFile(reg.path)
	if os.IsNotExist(err) {
		return reg, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, reg); err != nil {
		return nil, fmt.Errorf("models/registry.json: %w", err)
	}
	for i, u := range reg.Uses {
		if u.Tool == "" || u.Model == "" || len(u.Files) == 0 {
			return nil, fmt.Errorf("models/registry.json: el %d.º uso no tiene tool, model o files", i+1)
		}
		for _, f := range u.Files {
			if !strings.Contains(f, ":") {
				return nil, fmt.Errorf("models/registry.json: %s/%s: %q no es una clave (hub:, gguf:, env:, whisper:)", u.Tool, u.Model, f)
			}
		}
	}
	return reg, nil
}

func (reg *Registry) Save() error {
	raw, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(reg.path, append(raw, '\n'), 0o644)
}

// UsesOf: los usos que necesitan esa clave.
func (reg *Registry) UsesOf(key string) []Use {
	var out []Use
	for _, u := range reg.Uses {
		for _, f := range u.Files {
			if f == key {
				out = append(out, u)
				break
			}
		}
	}
	return out
}

// Annotate le pone a cada instalado quién lo usa, según el registro.
func (reg *Registry) Annotate(list []Installed) []Installed {
	for i := range list {
		var tools, words []string
		for _, u := range reg.UsesOf(list[i].Key) {
			tools = append(tools, u.Tool)
			words = append(words, u.What)
		}
		sort.Strings(tools)
		list[i].Tools = tools
		list[i].UsedBy = strings.Join(words, " · ")
	}
	return list
}

// Find: los usos de un modelo o de una herramienta (por id del modelo, nombre de la herramienta o clave).
func (reg *Registry) Find(name string) []Use {
	var out []Use
	for _, u := range reg.Uses {
		if u.Model == name || u.Tool == name || strings.EqualFold(lastPart(u.Model), name) {
			out = append(out, u)
			continue
		}
		for _, f := range u.Files {
			if f == name {
				out = append(out, u)
				break
			}
		}
	}
	return out
}

func lastPart(id string) string {
	if i := strings.LastIndex(id, "/"); i >= 0 {
		return id[i+1:]
	}
	return id
}

// Replace pasa a la herramienta del modelo viejo al nuevo y devuelve las claves del viejo que ya nadie usa (las que se
// pueden borrar).
func (reg *Registry) Replace(tool, oldModel, newModel string, newFiles []string, what, source, since string) ([]string, error) {
	var oldFiles []string
	found := false
	for i, u := range reg.Uses {
		if u.Tool != tool || u.Model != oldModel {
			continue
		}
		found = true
		oldFiles = append(oldFiles, u.Files...)
		reg.Uses[i].Model, reg.Uses[i].Files, reg.Uses[i].Since = newModel, newFiles, since
		if what != "" {
			reg.Uses[i].What = what
		}
		if source != "" {
			reg.Uses[i].Source = source
		}
	}
	if !found {
		return nil, fmt.Errorf("%s no usa %s según el registro", tool, oldModel)
	}
	var free []string
	for _, f := range oldFiles {
		if len(reg.UsesOf(f)) == 0 {
			free = append(free, f)
		}
	}
	return free, nil
}

// For: las rutas de lo que usa una herramienta según el registro, en el orden de sus `files` (y, dentro de un GGUF,
// el peso antes del proyector). Con model vacío, el primer uso de la herramienta. Es lo mismo que `bin/models path`,
// para las herramientas en Go. El error dice qué falta: no está en el registro, o está pero no en esta máquina.
func For(root, tool, model string) ([]string, error) {
	reg, err := LoadRegistry(root)
	if err != nil {
		return nil, err
	}
	var use *Use
	for i, u := range reg.Uses {
		if u.Tool == tool && (model == "" || u.Model == model) {
			use = &reg.Uses[i]
			break
		}
	}
	if use == nil {
		return nil, fmt.Errorf("%s no tiene modelo en models/registry.json", tool)
	}
	installed := map[string]Installed{}
	for _, it := range Scan(DefaultRoots()) {
		installed[it.Key] = it
	}
	var out []string
	for _, f := range use.Files {
		it, ok := installed[f]
		if !ok {
			return nil, fmt.Errorf("%s (%s, de %s) no está en %s", f, use.Model, tool, machine.Detect().Label)
		}
		out = append(out, it.Locations()...)
	}
	return out, nil
}

// FindRoot: la raíz de my-tools, donde está el registro: MY_TOOLS_ROOT, o subiendo desde la carpeta actual y desde el
// ejecutable hasta encontrar models/registry.json. Vacío si no la encuentra.
func FindRoot() string {
	if r := os.Getenv("MY_TOOLS_ROOT"); r != "" {
		return r
	}
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		if real, err := filepath.EvalSymlinks(exe); err == nil {
			exe = real
		}
		starts = append(starts, filepath.Dir(exe))
	}
	for _, dir := range starts {
		for d := dir; ; d = filepath.Dir(d) {
			if _, err := os.Stat(RegistryPath(d)); err == nil {
				return d
			}
			if filepath.Dir(d) == d {
				break
			}
		}
	}
	return ""
}
