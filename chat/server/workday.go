package main

/* EL TRABAJO DE UN DÍA, CONTADO PARA EL EQUIPO — lo que el agente de Jira responde a «¿cómo te fue ayer?».
 *
 * La fuente es la bitácora del tablero (tablero/data/entries): cada tramo de trabajo con su día, sus minutos, un
 * título y una nota, y la tarea a la que pertenece. Pero la bitácora también registra el trabajo propio — las
 * herramientas de cada quien (el banco de pruebas, el tablero, el corpus de conocimiento) —, y eso no le
 * interesa al equipo ni tiene por qué llegarle. La frontera:
 *
 *   - SÓLO las tareas con Jira. Los contenedores propios (`clase: proyecto`: tablero, harness, canon,
 *     playground…) no tienen Jira y quedan afuera enteros. Cada tarea se nombra con su `jira_title`, que es el
 *     título que ya se publica en Jira.
 *   - Lo que sí entra se cuenta por lo que se avanzó, no por cómo se hizo: la nota pasa el guard (el mismo que
 *     se aplica antes de escribir en Jira) y una lista de nombres propios; la que no pasa no se usa.
 *   - La redacción la hace `claude -p` sin herramientas, aislado (sin MCP, sin los ajustes de usuario ni de
 *     proyecto, en una carpeta vacía) y sólo con esos datos. Su respuesta vuelve a pasar el mismo filtro. Si no
 *     pasa, o si Claude Code no está, se responde con un resumen fijo hecho sólo de títulos y minutos.
 */

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/connectors/guard"
)

// Dónde está el tablero: el server corre desde la raíz del playground. TABLERO_DIR lo cambia.
func tableroDir() string {
	if d := os.Getenv("TABLERO_DIR"); d != "" {
		return d
	}
	return "tablero"
}

type logEntry struct {
	Day       string `json:"day"`
	Minutes   int    `json:"minutes"`
	Kind      string `json:"kind"`
	FreeTitle string `json:"freeTitle"`
	Note      string `json:"note"`
	EffortID  int    `json:"effortId"`
}

type taskMeta struct {
	ID        int
	Project   bool // clase: proyecto (un contenedor propio)
	Jira      []string
	JiraTitle string
}

// Palabras que delatan el trabajo propio aunque pasen el guard: si aparecen, ese texto no se usa.
var internalWords = regexp.MustCompile(`(?i)\b(harness|tablero|playground|trazador|canon|cuadrilla|pulso|bit[aá]cora|mock(s|oon)?|localhost|worktree|stash|make\s+\w|claude|subagente|caminador)\b`)

func publishable(text string) bool {
	return strings.TrimSpace(text) != "" && guard.Violations(text) == nil && !internalWords.MatchString(text)
}

// Cómo se comprobó algo: la nota de la bitácora va en la forma «acción → resultado → validación», y la
// validación (con qué consulta, qué prueba, qué ambiente) es justamente el cómo.
var validationTail = regexp.MustCompile(`(?is)(→|->|;|\.)\s*(validad[oa]s?|verificad[oa]s?|comprobad[oa]s?)\b.*$`)

// Frases sobre cómo se midió el tiempo («Minutos medidos…», «Lapso desde…»): son de la bitácora, no del trabajo.
var timingSentence = regexp.MustCompile(`(?i)(^|[.\n])\s*(minutos|lapso)\b[^.\n]*[.\n]?`)

// La nota contada para el equipo: sin la línea de minutos, sin la validación y sin las frases de cómo se midió.
func cleanNote(note string) string {
	var keep []string
	for _, line := range strings.Split(note, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "MINUTOS:") {
			continue
		}
		keep = append(keep, line)
	}
	text := strings.TrimSpace(strings.Join(keep, " "))
	text = validationTail.ReplaceAllString(text, "")
	text = timingSentence.ReplaceAllString(text, "$1")
	return strings.TrimSpace(strings.TrimRight(strings.TrimSpace(text), "→;"))
}

func readTasks() map[int]taskMeta {
	out := map[int]taskMeta{}
	files, _ := filepath.Glob(filepath.Join(tableroDir(), "tasks", "*", "task.md"))
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil || !bytes.HasPrefix(data, []byte("---")) {
			continue
		}
		front := string(data[3:])
		if end := strings.Index(front, "\n---"); end >= 0 {
			front = front[:end]
		}
		var t taskMeta
		for _, line := range strings.Split(front, "\n") {
			key, value, ok := strings.Cut(line, ":")
			if !ok {
				continue
			}
			value = strings.TrimSpace(value)
			switch strings.TrimSpace(key) {
			case "id":
				t.ID, _ = strconv.Atoi(value)
			case "clase":
				t.Project = value == "proyecto"
			case "jira_title":
				t.JiraTitle = strings.Trim(value, `"`)
			case "jira":
				for _, k := range strings.Split(strings.Trim(value, "[]"), ",") {
					if k = strings.Trim(strings.TrimSpace(k), `"`); k != "" {
						t.Jira = append(t.Jira, k)
					}
				}
			}
		}
		if t.ID > 0 {
			out[t.ID] = t
		}
	}
	return out
}

func readDay(day string) []logEntry {
	file := filepath.Join(tableroDir(), "data", "entries", day[:7]+".jsonl")
	f, err := os.Open(file)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []logEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var e logEntry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.Day == day {
			out = append(out, e)
		}
	}
	return out
}

// Lo que se le pasa a Claude (y lo único que puede usar): por tarea del equipo, su clave, su título público,
// los minutos y lo que se avanzó.
type dayTask struct {
	Key      string   `json:"clave"`
	Title    string   `json:"titulo"`
	Minutes  int      `json:"minutos"`
	Progress []string `json:"avances"`
}

func teamWork(day string) ([]dayTask, int) {
	tasks := readTasks()
	byKey := map[string]*dayTask{}
	var order []string
	total := 0
	for _, e := range readDay(day) {
		t, ok := tasks[e.EffortID]
		if !ok || t.Project || len(t.Jira) == 0 {
			continue // trabajo propio, o sin tarea del equipo
		}
		key := t.Jira[0]
		dt := byKey[key]
		if dt == nil {
			title := t.JiraTitle
			if !publishable(title) {
				title = ""
			}
			dt = &dayTask{Key: key, Title: title}
			byKey[key] = dt
			order = append(order, key)
		}
		dt.Minutes += e.Minutes
		total += e.Minutes
		for _, text := range []string{e.FreeTitle, cleanNote(e.Note)} {
			if publishable(text) {
				dt.Progress = append(dt.Progress, text)
			}
		}
	}
	out := make([]dayTask, 0, len(order))
	for _, k := range order {
		out = append(out, *byKey[k])
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Minutes > out[j].Minutes })
	return out, total
}

// ── qué día pregunta ──
var isoDate = regexp.MustCompile(`\b(20\d\d-\d\d-\d\d)\b`)

func askedDay(text string, now time.Time) (string, string, bool) {
	t := strings.ToLower(text)
	switch {
	case isoDate.MatchString(t):
		d := isoDate.FindString(t)
		return d, "el " + d, true
	case strings.Contains(t, "anteayer"), strings.Contains(t, "antier"):
		return now.AddDate(0, 0, -2).Format("2006-01-02"), "anteayer", true
	case strings.Contains(t, "ayer"):
		return now.AddDate(0, 0, -1).Format("2006-01-02"), "ayer", true
	case strings.Contains(t, "hoy"):
		return now.Format("2006-01-02"), "hoy", true
	}
	return "", "", false
}

func humanMinutes(m int) string {
	if m < 60 {
		return fmt.Sprintf("%d min", m)
	}
	if m%60 == 0 {
		return fmt.Sprintf("%d h", m/60)
	}
	return fmt.Sprintf("%d h %d min", m/60, m%60)
}

// El resumen fijo: sólo títulos públicos y minutos. Es lo que se responde si Claude no está o su texto no pasa.
func plainDaySummary(who, label string, work []dayTask, total int) string {
	if len(work) == 0 {
		return fmt.Sprintf("%s %s no registró trabajo en tareas del equipo.", strings.ToUpper(label[:1])+label[1:], who)
	}
	parts := make([]string, 0, len(work))
	for _, w := range work {
		name := w.Key
		if w.Title != "" {
			name += " (" + w.Title + ")"
		}
		parts = append(parts, fmt.Sprintf("%s, %s", name, humanMinutes(w.Minutes)))
	}
	return fmt.Sprintf("%s %s trabajó %s en %d %s del equipo: %s.", strings.ToUpper(label[:1])+label[1:], who,
		humanMinutes(total), len(work), map[bool]string{true: "tarea", false: "tareas"}[len(work) == 1], strings.Join(parts, "; "))
}

const dayPrompt = `Sos el agente de Jira de %[1]s, de CreditOp. Un compañero del equipo te pregunta: «%[2]s».
Contestá qué trabajó %[1]s %[3]s, sólo con los datos de abajo.

Reglas:
- Contá lo que se avanzó en cada tarea y en qué quedó: lo que le sirve al equipo. Nunca cómo se hizo.
- No nombres herramientas, ambientes locales, pruebas internas, scripts, comandos, repositorios, ramas ni archivos.
- No agregues nada que no esté en los datos. Si una tarea no tiene avances, nombrala con su tiempo y nada más.
- Escribí en español, en tercera persona, de 2 a 5 frases, con la clave de Jira de cada tarea. Sin listas ni formato.

Datos (JSON): %[4]s`

// redactar con Claude Code, sin herramientas y aislado; devuelve "" si no se puede.
func claudeWrite(ctx context.Context, prompt string) string {
	path, err := exec.LookPath("claude")
	if err != nil {
		return ""
	}
	dir, err := os.MkdirTemp("", "chat-agent-")
	if err != nil {
		return ""
	}
	defer os.RemoveAll(dir)
	cmd := exec.CommandContext(ctx, path, "-p", "--output-format", "text", "--tools", "", "--strict-mcp-config",
		"--restricted", "--no-session-persistence")
	cmd.Dir = dir
	cmd.Stdin = strings.NewReader(prompt)
	var out bytes.Buffer
	cmd.Stdout = &out
	if cmd.Run() != nil {
		return ""
	}
	return strings.TrimSpace(out.String())
}

// workdayReply contesta «¿cómo te fue <día>?».
func workdayReply(ctx context.Context, who, question, day, label string) (string, error) {
	work, total := teamWork(day)
	if len(work) == 0 {
		return plainDaySummary(who, label, nil, 0), nil
	}
	data, _ := json.Marshal(map[string]any{"dia": day, "minutos_totales": total, "tareas": work})
	if text := claudeWrite(ctx, fmt.Sprintf(dayPrompt, who, question, label, data)); publishable(text) {
		return text, nil
	}
	return plainDaySummary(who, label, work, total), nil
}
