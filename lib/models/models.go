// Package models: los modelos de IA instalados en esta máquina (la Mac o el PC: lib/machine) y qué herramienta usa cada uno. Lo comparten el CLI
// `bin/models` y la sección «Instalados» de News, así los dos dicen siempre lo mismo (Miguel, 2026-11-19: «un CLI, algo
// más tipo consola que podamos usar fácilmente desde nuestras herramientas locales»).
//
// Lo instalado se busca en cuatro lugares, siempre los mismos:
//
//   - la caché de Hugging Face (`$HF_HUB_CACHE`, `$HF_HOME/hub` o `~/.cache/huggingface/hub`): un modelo por carpeta
//     `models--autor--nombre`, con su tamaño real (los snapshots apuntan a `blobs/`, que se comparten);
//   - los GGUF de `~/.cache/my-tools/models` (llama-server), agrupados por modelo: el peso y su proyector juntos;
//   - los entornos de `~/.cache/my-tools/<carpeta>` que tienen un venv (el código y las librerías de un modelo);
//   - los modelos de whisper.cpp de `~/.cache/whisper`.
//
// Qué herramienta usa qué lo dice el registro versionado, `models/registry.json` (registry.go). Borrar sólo acepta una
// clave que salió de esta misma búsqueda y sólo dentro de esas raíces: nunca una ruta que mande el que llama.
package models

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Installed: una cosa instalada, con su clave (`hub:autor/nombre`, `gguf:Nombre`, `env:carpeta`, `whisper:nombre`).
type Installed struct {
	Key    string   `json:"key"`
	Name   string   `json:"name"`
	Kind   string   `json:"kind"` // hub · gguf · env · whisper
	Where  string   `json:"where"`
	Bytes  int64    `json:"bytes"`
	UsedBy string   `json:"usedBy,omitempty"` // las herramientas del registro que lo usan, en palabras
	Tools  []string `json:"tools,omitempty"`  // las mismas, por nombre
	remove []string // lo que se borra
	locate []string // lo que una herramienta abre
}

// Locations: las rutas que una herramienta abre para usarlo (el GGUF y su proyector, la carpeta del snapshot, el venv,
// el archivo de whisper.cpp).
func (it Installed) Locations() []string { return it.locate }

// Roots: dónde se busca.
type Roots struct{ Hub, Mine, Whisper string }

func DefaultRoots() Roots {
	home, _ := os.UserHomeDir()
	// la caché del usuario: $XDG_CACHE_HOME si está (Linux; huggingface_hub también la respeta) o ~/.cache, que es
	// lo que usan las dos máquinas hoy
	cache := filepath.Join(home, ".cache")
	if x := os.Getenv("XDG_CACHE_HOME"); x != "" {
		cache = x
	}
	hub := filepath.Join(cache, "huggingface", "hub")
	if h := os.Getenv("HF_HOME"); h != "" {
		hub = filepath.Join(h, "hub")
	}
	if h := os.Getenv("HF_HUB_CACHE"); h != "" {
		hub = h
	}
	// whisper.cpp guarda en ~/.cache/whisper y no mira XDG: se deja ahí, que es donde lo busca el dictado del chat
	return Roots{Hub: hub, Mine: filepath.Join(cache, "my-tools"), Whisper: filepath.Join(home, ".cache", "whisper")}
}

func dirSize(dir string) int64 {
	var n int64
	filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && info.Mode().IsRegular() {
			n += info.Size()
		}
		return nil
	})
	return n
}

// hubBlobs: los blobs (rutas reales) a los que apuntan los snapshots de un modelo de la caché de Hugging Face.
func hubBlobs(modelDir string) map[string]int64 {
	out := map[string]int64{}
	filepath.Walk(filepath.Join(modelDir, "snapshots"), func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		real, err := filepath.EvalSymlinks(p)
		if err != nil {
			return nil
		}
		if st, err := os.Stat(real); err == nil && st.Mode().IsRegular() {
			out[real] = st.Size()
		}
		return nil
	})
	return out
}

// latestSnapshot: la carpeta de snapshot más nueva de un modelo de la caché.
func latestSnapshot(modelDir string) string {
	entries, _ := os.ReadDir(filepath.Join(modelDir, "snapshots"))
	best, bestT := "", int64(0)
	for _, e := range entries {
		if info, err := e.Info(); err == nil && e.IsDir() && info.ModTime().UnixNano() > bestT {
			best, bestT = filepath.Join(modelDir, "snapshots", e.Name()), info.ModTime().UnixNano()
		}
	}
	return best
}

var quantRe = regexp.MustCompile(`(?i)[-.](q\d[\w]*|f16|f32|bf16|iq\d[\w]*)$`)

// ggufModel: el modelo al que pertenece un archivo GGUF, sin el prefijo del proyector ni la cuantización.
func ggufModel(file string) string {
	name := strings.TrimSuffix(file, ".gguf")
	name = strings.TrimPrefix(name, "mmproj-")
	name = strings.TrimSuffix(name, ".mmproj")
	for {
		trimmed := quantRe.ReplaceAllString(name, "")
		trimmed = strings.TrimSuffix(trimmed, ".mmproj")
		if trimmed == name {
			return name
		}
		name = trimmed
	}
}

func isProjector(file string) bool { return strings.Contains(file, "mmproj") }

// Scan: todo lo instalado, del más grande al más chico. Sin registro, nada dice quién lo usa.
func Scan(r Roots) []Installed {
	var out []Installed
	// la caché de Hugging Face; un blob compartido entre dos modelos no se borra con ninguno de los dos
	entries, _ := os.ReadDir(r.Hub)
	owners := map[string]int{}
	blobsOf := map[string]map[string]int64{}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), "models--") {
			continue
		}
		b := hubBlobs(filepath.Join(r.Hub, e.Name()))
		blobsOf[e.Name()] = b
		for p := range b {
			owners[p]++
		}
	}
	for dir, blobs := range blobsOf {
		id := strings.Replace(strings.TrimPrefix(dir, "models--"), "--", "/", 1)
		full := filepath.Join(r.Hub, dir)
		it := Installed{Key: "hub:" + id, Name: id, Kind: "hub", Where: "caché de Hugging Face", remove: []string{full}}
		if snap := latestSnapshot(full); snap != "" {
			it.locate = []string{snap}
		}
		// El tamaño es el de su carpeta, UNA vez. En la caché real los blobs viven DENTRO de la carpeta del modelo
		// (models--autor--nombre/blobs/), así que ya los cuenta dirSize: sumarlos además por los enlaces de los
		// snapshots daba el doble (medido con la forma real en TestScanRealHubLayoutCountsOnce). Sólo se suma aparte
		// el blob que quedó FUERA de la carpeta (una caché vieja o compartida).
		inside := full
		if real, err := filepath.EvalSymlinks(full); err == nil {
			inside = real
		}
		for p, n := range blobs {
			if !strings.HasPrefix(p, inside+string(filepath.Separator)) {
				it.Bytes += n
			}
			if owners[p] == 1 {
				it.remove = append(it.remove, p)
			}
		}
		it.Bytes += dirSize(full)
		out = append(out, it)
	}
	// los GGUF de llama-server: el peso primero y el proyector después
	files, _ := os.ReadDir(filepath.Join(r.Mine, "models"))
	byModel := map[string]*Installed{}
	var order []string
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".gguf") {
			continue
		}
		m := ggufModel(f.Name())
		it := byModel[m]
		if it == nil {
			it = &Installed{Key: "gguf:" + m, Name: m, Kind: "gguf", Where: "GGUF de llama-server"}
			byModel[m] = it
			order = append(order, m)
		}
		p := filepath.Join(r.Mine, "models", f.Name())
		if st, err := os.Stat(p); err == nil {
			it.Bytes += st.Size()
		}
		it.remove = append(it.remove, p)
		it.locate = append(it.locate, p)
	}
	for _, m := range order {
		it := byModel[m]
		sort.SliceStable(it.locate, func(a, b int) bool { return !isProjector(it.locate[a]) && isProjector(it.locate[b]) })
		out = append(out, *it)
	}
	// los entornos: una carpeta de ~/.cache/my-tools con un venv adentro
	dirs, _ := os.ReadDir(r.Mine)
	for _, d := range dirs {
		if !d.IsDir() || d.Name() == "models" {
			continue
		}
		p := filepath.Join(r.Mine, d.Name())
		if !hasVenv(p) {
			continue
		}
		out = append(out, Installed{Key: "env:" + d.Name(), Name: d.Name(), Kind: "env", Where: "entorno (código y librerías)", Bytes: dirSize(p), remove: []string{p}, locate: []string{p}})
	}
	// los modelos de whisper.cpp (un .bin por modelo)
	wfiles, _ := os.ReadDir(r.Whisper)
	for _, f := range wfiles {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".bin") {
			continue
		}
		p := filepath.Join(r.Whisper, f.Name())
		st, err := os.Stat(p)
		if err != nil {
			continue
		}
		name := strings.TrimSuffix(f.Name(), ".bin")
		out = append(out, Installed{Key: "whisper:" + name, Name: name, Kind: "whisper", Where: "whisper.cpp", Bytes: st.Size(), remove: []string{p}, locate: []string{p}})
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Bytes > out[b].Bytes })
	return out
}

func hasVenv(dir string) bool {
	for _, v := range []string{"venv", ".venv"} {
		if _, err := os.Stat(filepath.Join(dir, v, "bin", "python")); err == nil {
			return true
		}
	}
	return false
}

// Inside: la ruta está adentro de una de las raíces (y no es la raíz).
func (r Roots) Inside(p string) bool {
	p = filepath.Clean(p)
	for _, root := range []string{r.Hub, r.Mine, r.Whisper} {
		if root == "" {
			continue
		}
		// la raíz tal cual y resuelta: los blobs vienen de EvalSymlinks (/var → /private/var en macOS)
		cands := []string{filepath.Clean(root)}
		if real, err := filepath.EvalSymlinks(root); err == nil {
			cands = append(cands, real)
		}
		for _, c := range cands {
			if p != c && strings.HasPrefix(p, c+string(filepath.Separator)) {
				return true
			}
		}
	}
	return false
}

// Remove borra lo que la búsqueda dice para esa clave; nada fuera de las raíces.
func Remove(r Roots, key string) (Installed, error) {
	for _, it := range Scan(r) {
		if it.Key != key {
			continue
		}
		for _, p := range it.remove {
			if !r.Inside(p) {
				return it, fmt.Errorf("%s queda fuera de las carpetas de modelos: no se borra", p)
			}
		}
		for _, p := range it.remove {
			if err := os.RemoveAll(p); err != nil {
				return it, err
			}
		}
		return it, nil
	}
	return Installed{}, fmt.Errorf("no hay un modelo instalado %q", key)
}
