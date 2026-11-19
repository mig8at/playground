package main

// Los modelos instalados en la Mac (Miguel, 2026-11-19: «un apartado de los modelos instalados, con su tamaño y una
// papelera para borrarlos fácil»). Se arma mirando tres lugares, siempre los mismos:
//
//   - la caché de Hugging Face (`$HF_HOME/hub`, o `~/.cache/huggingface/hub`): un modelo por carpeta `models--autor--nombre`,
//     con su tamaño real (los archivos de sus snapshots apuntan a `blobs/`, que se comparten);
//   - los GGUF de `~/.cache/my-tools/models` (los de llama-server), agrupados por modelo: el peso y su proyector juntos;
//   - los entornos de `~/.cache/my-tools/<carpeta>` que tienen un venv (el código y las librerías de un modelo que se probó).
//
// Borrar sólo acepta una clave que salió de esta misma lista, y sólo dentro de esas raíces: nunca una ruta que mande
// el que llama.

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type Installed struct {
	Key    string   `json:"key"`
	Name   string   `json:"name"`
	Kind   string   `json:"kind"` // hub · gguf · env
	Where  string   `json:"where"`
	Bytes  int64    `json:"bytes"`
	UsedBy string   `json:"usedBy,omitempty"`
	paths  []string // lo que se borra
}

type roots struct{ hub, mine string }

func defaultRoots() roots {
	home, _ := os.UserHomeDir()
	hub := filepath.Join(home, ".cache", "huggingface", "hub")
	if h := os.Getenv("HF_HOME"); h != "" {
		hub = filepath.Join(h, "hub")
	}
	if h := os.Getenv("HF_HUB_CACHE"); h != "" {
		hub = h
	}
	mine := filepath.Join(home, ".cache", "my-tools")
	if x := os.Getenv("XDG_CACHE_HOME"); x != "" {
		mine = filepath.Join(x, "my-tools")
	}
	return roots{hub: hub, mine: mine}
}

// Quién usa cada cosa, para que el borrado lo diga antes.
var usedBy = map[string]string{
	"gguf:Qwen3VL-4B-Instruct": "bin/point",
	"hub:amazon/chronos-2":     "Sentinel -chronos",
	"env:chronos":              "Sentinel -chronos",
}

// dirSize suma los archivos de una carpeta sin seguir enlaces.
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

func scanInstalled(r roots) []Installed {
	var out []Installed
	// la caché de Hugging Face; un blob compartido entre dos modelos no se borra con ninguno de los dos
	entries, _ := os.ReadDir(r.hub)
	owners := map[string]int{}
	blobsOf := map[string]map[string]int64{}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), "models--") {
			continue
		}
		b := hubBlobs(filepath.Join(r.hub, e.Name()))
		blobsOf[e.Name()] = b
		for p := range b {
			owners[p]++
		}
	}
	for dir, blobs := range blobsOf {
		id := strings.Replace(strings.TrimPrefix(dir, "models--"), "--", "/", 1)
		it := Installed{Key: "hub:" + id, Name: id, Kind: "hub", Where: "caché de Hugging Face", paths: []string{filepath.Join(r.hub, dir)}}
		for p, n := range blobs {
			it.Bytes += n
			if owners[p] == 1 {
				it.paths = append(it.paths, p)
			}
		}
		it.Bytes += dirSize(filepath.Join(r.hub, dir))
		out = append(out, it)
	}
	// los GGUF de llama-server
	files, _ := os.ReadDir(filepath.Join(r.mine, "models"))
	byModel := map[string]*Installed{}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".gguf") {
			continue
		}
		m := ggufModel(f.Name())
		it := byModel[m]
		if it == nil {
			it = &Installed{Key: "gguf:" + m, Name: m, Kind: "gguf", Where: "GGUF de llama-server"}
			byModel[m] = it
		}
		p := filepath.Join(r.mine, "models", f.Name())
		if st, err := os.Stat(p); err == nil {
			it.Bytes += st.Size()
		}
		it.paths = append(it.paths, p)
	}
	for _, it := range byModel {
		out = append(out, *it)
	}
	// los entornos: una carpeta de ~/.cache/my-tools con un venv adentro
	dirs, _ := os.ReadDir(r.mine)
	for _, d := range dirs {
		if !d.IsDir() || d.Name() == "models" {
			continue
		}
		p := filepath.Join(r.mine, d.Name())
		if !hasVenv(p) {
			continue
		}
		out = append(out, Installed{Key: "env:" + d.Name(), Name: d.Name(), Kind: "env", Where: "entorno (código y librerías)", Bytes: dirSize(p), paths: []string{p}})
	}
	for i := range out {
		out[i].UsedBy = usedBy[out[i].Key]
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

// inside: la ruta está adentro de una de las raíces (y no es la raíz).
func (r roots) inside(p string) bool {
	p = filepath.Clean(p)
	for _, root := range []string{r.hub, r.mine} {
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

// removeInstalled borra lo que la lista dice para esa clave; nada fuera de las raíces.
func removeInstalled(r roots, key string) (Installed, error) {
	for _, it := range scanInstalled(r) {
		if it.Key != key {
			continue
		}
		for _, p := range it.paths {
			if !r.inside(p) {
				return it, fmt.Errorf("%s queda fuera de las carpetas de modelos: no se borra", p)
			}
		}
		for _, p := range it.paths {
			if err := os.RemoveAll(p); err != nil {
				return it, err
			}
		}
		return it, nil
	}
	return Installed{}, fmt.Errorf("no hay un modelo instalado %q", key)
}

func (s *server) installedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/installed", func(w http.ResponseWriter, _ *http.Request) {
		list := scanInstalled(s.roots)
		var total int64
		for _, it := range list {
			total += it.Bytes
		}
		writeJSON(w, 200, map[string]any{"installed": list, "bytes": total})
	})
	// Borrar pide el encabezado X-News: un navegador no lo manda desde otra página sin preguntar (CORS), así una web
	// cualquiera no puede borrar modelos aunque la API escuche en 127.0.0.1.
	mux.HandleFunc("DELETE /api/installed", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-News") != "1" {
			writeJSON(w, 403, map[string]string{"error": "falta el encabezado X-News"})
			return
		}
		it, err := removeInstalled(s.roots, r.URL.Query().Get("key"))
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"removed": it.Key, "bytes": it.Bytes})
	})
}
