package main

// Las habilidades de Wally (wally/skills/*.md): lo que sabe hacer, un archivo por habilidad. De entrada el modelo ve
// sólo el nombre y una línea de cada una (el índice que arma skillIndex, pegado a WALLY.md); el detalle —sus comandos
// exactos, cómo usarlos, sus formatos— lo pide con `ayuda <nombre>` cuando lo necesita. Es la carga de a poco de un
// agente de código (Miguel, 2026-11-17: «que pidan los comandos disponibles, no que los cargue todo de totazo»).
// Agregar una habilidad es agregar un archivo: su primera línea es `# nombre: para qué sirve`.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var skillName = regexp.MustCompile(`^[a-z][a-z0-9-]{1,30}$`)

type skill struct {
	Name  string `json:"name"`
	About string `json:"about"`
}

// skills lee la carpeta en cada uso: editar o agregar una habilidad vale desde la próxima pregunta.
func (a *app) skills() []skill {
	dir := filepath.Join(a.root, "wally", "skills")
	entries, _ := os.ReadDir(dir)
	var out []skill
	for _, e := range entries {
		name := strings.TrimSuffix(e.Name(), ".md")
		if e.IsDir() || name == e.Name() || !skillName.MatchString(name) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		first := strings.TrimSpace(strings.TrimPrefix(strings.SplitN(string(raw), "\n", 2)[0], "#"))
		about := strings.TrimSpace(strings.TrimPrefix(first, name+":"))
		out = append(out, skill{Name: name, About: about})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// skillIndex: lo que va pegado a WALLY.md: una línea por habilidad.
func (a *app) skillIndex() string {
	list := a.skills()
	if len(list) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Tus habilidades (pedí `ayuda <nombre>` antes de usar una: ahí están sus comandos)\n\n")
	for _, s := range list {
		fmt.Fprintf(&b, "- `%s` — %s\n", s.Name, s.About)
	}
	return b.String()
}

// skillHelp: `ayuda` (el índice) o `ayuda <nombre>` (la habilidad entera).
func (a *app) skillHelp(name string) (string, int, error) {
	if name == "" {
		return a.skillIndex(), 0, nil
	}
	if !skillName.MatchString(name) {
		return "el nombre de una habilidad va en minúsculas, sin espacios", 1, nil
	}
	raw, err := os.ReadFile(filepath.Join(a.root, "wally", "skills", name+".md"))
	if err != nil {
		names := []string{}
		for _, s := range a.skills() {
			names = append(names, s.Name)
		}
		return fmt.Sprintf("no hay una habilidad «%s»; las que hay: %s", name, strings.Join(names, ", ")), 1, nil
	}
	return string(raw), 0, nil
}

// knownSkills valida los nombres de habilidades de un agente (sin repetir).
func (a *app) knownSkills(names []string) ([]string, error) {
	have := map[string]bool{}
	for _, s := range a.skills() {
		have[s.Name] = true
	}
	var out []string
	seen := map[string]bool{}
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		if !have[n] {
			return nil, fmt.Errorf("no hay una habilidad «%s» (bin/wally skills las lista)", n)
		}
		seen[n] = true
		out = append(out, n)
	}
	return out, nil
}
