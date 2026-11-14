package review

// A QUÉ TAREA PERTENECE UNA RAMA: la que la declara en `ramas:` (tablero/tasks/<slug>/task.md). Una entrada es el
// nombre de la rama o un patrón (`feat/abaco-*`), y puede llevar el repo delante: `vtex:core-800-vtex-5-0-1`.

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

// Task: la tarea del tablero de una rama.
type Task struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Path  string `json:"path"` // su task.md
}

type branchRule struct {
	repo, pattern string
	task          Task
}

// Tasks: las reglas `ramas:` de todas las tareas.
type Tasks []branchRule

var (
	reFront = regexp.MustCompile(`(?s)\A---\n(.*?)\n---`)
	reField = regexp.MustCompile(`(?m)^(id|title|ramas):\s*(.*)$`)
)

// LoadTasks lee el frontmatter de cada tarea (las archivadas también: una rama puede ser de una tarea cerrada).
func LoadTasks(myTools string) Tasks {
	var out Tasks
	files, _ := filepath.Glob(filepath.Join(myTools, "tablero", "tasks", "*", "task.md"))
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			continue
		}
		m := reFront.FindSubmatch(raw)
		if m == nil {
			continue
		}
		t := Task{Slug: filepath.Base(filepath.Dir(f)), Path: f}
		var ramas string
		for _, fm := range reField.FindAllStringSubmatch(string(m[1]), -1) {
			v := strings.Trim(strings.TrimSpace(fm[2]), `"'`)
			switch fm[1] {
			case "id":
				t.ID = v
			case "title":
				t.Title = v
			case "ramas":
				ramas = v
			}
		}
		for _, entry := range strings.Split(ramas, ",") {
			entry = strings.Trim(strings.TrimSpace(entry), `"'`)
			if entry == "" {
				continue
			}
			repo, pattern := "", entry
			// `repo:rama`: el repo delante (una rama no lleva «:», así que no hay ambigüedad)
			if i := strings.Index(entry, ":"); i > 0 {
				repo, pattern = entry[:i], entry[i+1:]
			}
			out = append(out, branchRule{repo: repo, pattern: pattern, task: t})
		}
	}
	return out
}

// ForBranch: la tarea que declara esta rama (la regla con repo gana a la que vale para cualquiera).
func (ts Tasks) ForBranch(repo, branch string) *Task {
	var loose *Task
	for _, r := range ts {
		ok := r.pattern == branch
		if !ok && strings.ContainsAny(r.pattern, "*?[") {
			ok, _ = path.Match(r.pattern, branch)
		}
		if !ok {
			continue
		}
		t := r.task
		if r.repo == repo {
			return &t
		}
		if r.repo == "" && loose == nil {
			loose = &t
		}
	}
	return loose
}

// reSection: un título de sección de la tarea.
var reSection = regexp.MustCompile(`(?m)^## (.+)$`)

// TaskIntent: lo que la tarea dice que el cambio tiene que lograr, para los revisores en frío: el objetivo, los
// criterios y la versión publicable. No van los pendientes, la bitácora ni cómo se midió (es contexto del elephant).
func TaskIntent(t *Task) string {
	if t == nil {
		return ""
	}
	raw, err := os.ReadFile(t.Path)
	if err != nil {
		return ""
	}
	text := reFront.ReplaceAllString(string(raw), "")
	idx := reSection.FindAllStringSubmatchIndex(text, -1)
	keep := regexp.MustCompile(`(?i)^(objetivo|specs|criterios|tarea \(publicable\)|en una línea)`)
	var b strings.Builder
	for i, m := range idx {
		title := text[m[2]:m[3]]
		if !keep.MatchString(strings.TrimSpace(title)) {
			continue
		}
		end := len(text)
		if i+1 < len(idx) {
			end = idx[i+1][0]
		}
		b.WriteString(strings.TrimSpace(text[m[0]:end]))
		b.WriteString("\n\n")
	}
	return strings.TrimSpace(b.String())
}
