// Package agenda es la agenda del día derivada de las tareas: en movimiento (con su último bloque, lo que espera a
// alguien y su entrega) y dormidas. La comparten `make hoy` (cmd/today, que también retoma una tarea) y el home del
// tablero (`/api/today`), para que las dos digan lo mismo.
package agenda

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/store"
	"creditop/playground/tablero/server/internal/taskcontext"
)

// Dormida: 14 días sin tocar; a los 30 la agenda sugiere archivar o anotar por qué espera.
const (
	DormantDays = 14
	ArchiveDays = 30
)

var (
	reCitation = regexp.MustCompile(`^["']|["']$`)
	reList     = regexp.MustCompile(`\[(.*?)\]`)
	rePublic   = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
)

type Task struct {
	Slug, Title, Stage, Class, Created, Path string
	ID                                       int
	Archived                                 bool
	Branches                                 []string
	Jira, Nodes, Knowledge, Chat             []string
	Mail                                     []string // `correo:`: los seguimientos de Correo (correo/) de la tarea
	Body                                     string
	Touch                                    time.Time // último cambio del archivo (git; hoy si está sucio)
}

func value(l string) string {
	_, v, _ := strings.Cut(l, ":")
	return reCitation.ReplaceAllString(strings.TrimSpace(v), "")
}

func list(l string) []string {
	m := reList.FindStringSubmatch(l)
	if m == nil {
		return nil
	}
	var out []string
	for _, x := range strings.Split(m[1], ",") {
		if x = reCitation.ReplaceAllString(strings.TrimSpace(x), ""); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func ReadTask(path string, touches map[string]string) Task {
	b, _ := os.ReadFile(path)
	t := Task{Slug: layout.SlugOf(path), Path: path}
	parts := strings.SplitN(string(b), "---", 3)
	if len(parts) == 3 {
		t.Body = parts[2]
		for _, l := range strings.Split(parts[1], "\n") {
			switch {
			case strings.HasPrefix(l, "id:"):
				t.ID, _ = strconv.Atoi(value(l))
			case strings.HasPrefix(l, "title:"):
				t.Title = value(l)
			case strings.HasPrefix(l, "stage:"):
				t.Stage = value(l)
			case strings.HasPrefix(l, "clase:"):
				t.Class = value(l)
			case strings.HasPrefix(l, "created:"):
				t.Created = value(l)
			case strings.HasPrefix(l, "archived:"):
				v := value(l)
				t.Archived = v != "" && v != "false" && v != "null"
			case strings.HasPrefix(l, "jira:"):
				t.Jira = list(l)
			case strings.HasPrefix(l, "knowledge:"):
				t.Knowledge = list(l)
			case strings.HasPrefix(l, "chat:"):
				// Dónde se habla de la tarea en el chat del equipo: un grupo (`#ecommerce`) o personas (`duncan`).
				t.Chat = list(l)
			case strings.HasPrefix(l, "correo:"):
				// Los seguimientos de la herramienta Correo (`vtex`, `shopify`): la correspondencia de la tarea.
				t.Mail = list(l)
			case strings.HasPrefix(l, "canon:"):
				t.Nodes = list(l)
			case strings.HasPrefix(l, "ramas:"):
				for _, p := range strings.Split(value(l), ",") {
					if p = strings.TrimSpace(p); p != "" {
						t.Branches = append(t.Branches, p)
					}
				}
			}
		}
	} else {
		t.Body = string(b)
	}
	if t.Stage == "" {
		t.Stage = "evaluation"
	}
	// El último toque sale de git siguiendo las mudanzas (hoy si está cambiada sin commitear): mover la
	// tarea de carpeta no la despierta. Ver layout.LastTouches.
	if d := touches[t.Slug]; d != "" {
		t.Touch, _ = time.ParseInLocation("2006-01-02", d, time.Local)
	} else if fi, err := os.Stat(path); err == nil {
		t.Touch = fi.ModTime()
	}
	return t
}

func (t Task) Days() int { return int(time.Since(t.Touch).Hours() / 24) }

func RequiresBranches(t Task) bool {
	// Los contenedores locales agrupan mejoras sucesivas y pueden no tener una rama activa. Una tarea
	// de producto en work sí debe declarar por dónde se entrega.
	return t.Stage == "work" && t.Class != "proyecto"
}

// Private: el cuerpo hasta la publicable — los pendientes se buscan sólo ahí, como hace el store.
func (t Task) Private() string {
	if loc := rePublic.FindStringIndex(t.Body); loc != nil {
		return t.Body[:loc[0]]
	}
	return t.Body
}

func OpenPending(t Task) (open []store.PendingItem, total int) {
	for _, p := range store.Pending(t.Private()) {
		total++
		if !p.Done {
			open = append(open, p)
		}
	}
	return
}

// ── el snapshot de ramas: la entrega ──

type BranchSnap struct {
	Repo   string          `json:"repo"`
	Branch string          `json:"branch"`
	Commit string          `json:"commit"`
	In     map[string]bool `json:"in"`
	PR     *struct {
		Number      int    `json:"number"`
		State       string `json:"state"`
		Base        string `json:"base"`
		MergeCommit string `json:"mergeCommit"`
	} `json:"pr"`
}

type BranchesSnap struct {
	MeasuredAt string `json:"measuredAt"`
	Tasks      map[string]struct {
		Branches []BranchSnap `json:"branches"`
	} `json:"tasks"`
	Incomplete []string `json:"incomplete"`
}

func ReadSnap(data string) BranchesSnap {
	var s BranchesSnap
	b, err := os.ReadFile(filepath.Join(data, "cache", "ramas.json"))
	if err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

// Delivery resume las ramas de una tarea en una línea: «4 ramas · 2 en main · 1 PR abierto → qa».
func Delivery(s BranchesSnap, id int) string {
	t, ok := s.Tasks[strconv.Itoa(id)]
	if !ok || len(t.Branches) == 0 {
		return ""
	}
	inMain, open := 0, map[string]int{}
	for _, r := range t.Branches {
		if r.In["main"] {
			inMain++
		}
		if r.PR != nil && r.PR.State == "OPEN" {
			open[r.PR.Base]++
		}
	}
	out := fmt.Sprintf("%d rama(s) · %d en main", len(t.Branches), inMain)
	if len(open) > 0 {
		var parts []string
		for base, n := range open {
			parts = append(parts, fmt.Sprintf("%d PR abierto(s) → %s", n, base))
		}
		sort.Strings(parts)
		out += " · " + strings.Join(parts, ", ")
	}
	return out
}

// Plain saca el énfasis de Markdown para la consola: un `**` a mitad de un renglón truncado se lee como
// ruido, no como negrita.
func Plain(s string) string {
	return strings.NewReplacer("**", "", "__", "", "`", "").Replace(s)
}

func Truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

type Row struct {
	ID        int      `json:"id"`
	Slug      string   `json:"slug"`
	Title     string   `json:"title"`
	Stage     string   `json:"stage"`
	Class     string   `json:"class"`
	Days      int      `json:"daysUntouched"`
	LastBlock string   `json:"lastBlock"`
	BlockDays int      `json:"lastBlockDays"` // -1 si la pila está vacía
	Delivery  string   `json:"delivery"`
	Waiting   []string `json:"waiting"` // pendientes abiertos que dependen de alguien
	// WaitingFor: lo mismo, separado y sin recortar, para agruparlo por persona (el home del tablero).
	WaitingFor   []Wait `json:"waitingFor,omitempty"`
	Pending      int    `json:"pending"`
	Dormant      bool   `json:"dormant"`
	SuggestClose bool   `json:"suggestArchive"`
}

// Wait es un pendiente abierto que espera a alguien.
type Wait struct {
	Who  string `json:"who"`           // lo que dice el «Depende de:» antes de la raya: la persona o el equipo
	What string `json:"what"`          // la casilla
	Why  string `json:"why,omitempty"` // lo que dice después de la raya: qué se le pide
}

// DaysSince: días de CALENDARIO desde una fecha RFC3339 —el bloque de anoche es «ayer» aunque no hayan
// pasado 24 horas—, o -1 si no se puede leer. Es la misma cuenta que `days()` hace con el documento, que
// arranca a la medianoche de su último commit.
func DaysSince(at string) int {
	when, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return -1
	}
	y, m, d := when.In(time.Local).Date()
	ty, tm, td := time.Now().Date()
	then, today := time.Date(y, m, d, 0, 0, 0, 0, time.Local), time.Date(ty, tm, td, 0, 0, 0, 0, time.Local)
	return int(math.Round(today.Sub(then).Hours() / 24))
}

// Build arma la agenda: una fila por tarea no archivada (de la etapa pedida, o todas), con su último bloque, lo que
// espera a alguien y su entrega, ordenada por lo más reciente. La usan `make hoy` y el home del tablero.
func Build(data string, tasks []Task, snap BranchesSnap, stage string) []Row {
	var rows []Row
	for _, t := range tasks {
		if t.Archived || (stage != "" && t.Stage != stage) {
			continue
		}
		f := Row{ID: t.ID, Slug: t.Slug, Title: t.Title, Stage: t.Stage, Class: t.Class, Days: t.Days(),
			BlockDays: -1, Delivery: Delivery(snap, t.ID)}
		// El último bloque dice dónde quedó la tarea; y si es más reciente que el documento, la tarea se
		// tocó entonces.
		if events, err := taskcontext.Read(data, t.Slug); err == nil && len(events) > 0 {
			f.LastBlock, f.BlockDays = events[0].Title, DaysSince(events[0].At)
			if f.BlockDays >= 0 && f.BlockDays < f.Days {
				f.Days = f.BlockDays
			}
		}
		ab, _ := OpenPending(t)
		f.Pending = len(ab)
		// Lo que espera a alguien: el pendiente con su «Depende de:». Es lo que reemplazó a la pregunta
		// vencida, que salía de las anotaciones PREGUNTA del documento y no se cerraba nunca.
		for _, p := range ab {
			if p.WaitingOn != "" {
				f.Waiting = append(f.Waiting, fmt.Sprintf("%s · %s", Truncate(Plain(p.WaitingOn), 60), Truncate(Plain(p.What), 70)))
				who, why, _ := strings.Cut(Plain(p.WaitingOn), " — ")
				f.WaitingFor = append(f.WaitingFor, Wait{Who: strings.TrimSpace(who), What: Plain(p.What), Why: strings.TrimSpace(why)})
			}
		}
		f.Dormant = f.Days >= DormantDays
		f.SuggestClose = f.Days >= ArchiveDays
		rows = append(rows, f)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Days != rows[j].Days {
			return rows[i].Days < rows[j].Days
		}
		return rows[i].ID > rows[j].ID
	})
	return rows
}

// LoadTasks lee el documento de cada tarea, con su último toque en git.
func LoadTasks(lay layout.Layout) []Task {
	touches := lay.LastTouches()
	paths, _ := lay.TaskPaths()
	var tasks []Task
	for _, r := range paths {
		tasks = append(tasks, ReadTask(r, touches))
	}
	return tasks
}
