// hoy — la primera pantalla del día, derivada de las tareas: qué sigue, qué espera respuesta, qué se durmió.
//
// Cada tarea ya tiene su pila de bloques, sus casillas pendientes —con a quién se espera, si lo dicen— y
// sus ramas. La tarjeta muestra cada cosa en su tarea, pero nadie las cruzaba: medido el 2026-09-14
// había 11 preguntas vencidas hace más de 7 días y 57 casillas abiertas repartidas en 10 tareas, y 21 de
// las 39 abiertas llevaban más de 3 semanas sin tocarse sin que nada lo dijera.
//
// ⚠ Hasta el 2026-09-23 la agenda mostraba el «próximo paso» de cada tarea y retomar lo exigía; y las
// «preguntas vencidas» salían de las anotaciones PREGUNTA del documento. Se fueron con la pila de bloques:
// lo que dice dónde quedó una tarea es su último bloque; un próximo paso fijo obliga a hacer algo después
// cuando eso es decisión de cómo se va desarrollando la tarea (Miguel); y una pregunta abierta a alguien
// es un pendiente con su «Depende de:», que a diferencia de la anotación tiene casilla y se cierra.
//
// Dos vistas, ninguna escribe:
//
//	hoy                la agenda: en movimiento (con su último bloque, lo que espera a alguien y entrega) y dormidas
//	hoy -n <id|slug>   RETOMAR una tarea en frío: la pila primero —el último bloque entero—, y en rojo lo que falta
//	hoy -n … -brief 1 …y al final la FICHA de cada referencia de Canon declarada por la tarea.
//	                   Es un APOYO: decide qué tema se abre, no reemplaza leerlo — y va opt-in porque una
//	                   tarea llega a declarar 9.
//
// «Días sin tocar» sale de git (último commit del archivo, o hoy si está modificado) y del último bloque
// de la pila, el que sea más reciente: una tarea que sólo recibe bloques no se duerme. Dormida = 14 días;
// a los 30 la vista sugiere archivar o anotar por qué espera. Los umbrales son del tablero, no de Jira.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/playground/tablero/server/internal/canon"
	"creditop/playground/tablero/server/internal/env"
	"creditop/playground/tablero/server/internal/layout"
	"creditop/playground/tablero/server/internal/store"
	"creditop/playground/tablero/server/internal/taskcontext"
)

const (
	dormantDays = 14
	archiveDays = 30
)

type task struct {
	Slug, Title, Stage, Class, Created, Path string
	ID                                       int
	Archived                                 bool
	Branches                                 []string
	Jira, Nodes                              []string
	Body                                     string
	Touch                                    time.Time // último cambio del archivo (git; hoy si está sucio)
}

var (
	reCitation       = regexp.MustCompile(`^["']|["']$`)
	reList           = regexp.MustCompile(`\[(.*?)\]`)
	rePublic         = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
	reSectionHeading = regexp.MustCompile(`(?m)^#{2,4}\s+(.*)$`)
	reDateInTitle    = regexp.MustCompile(`20\d\d-\d\d-\d\d`)
)

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

func readTaskFile(path string, touches map[string]string) task {
	b, _ := os.ReadFile(path)
	t := task{Slug: layout.SlugOf(path), Path: path}
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

func (t task) days() int { return int(time.Since(t.Touch).Hours() / 24) }

func requiresBranches(t task) bool {
	// Los contenedores locales agrupan mejoras sucesivas y pueden no tener una rama activa. Una tarea
	// de producto en work sí debe declarar por dónde se entrega.
	return t.Stage == "work" && t.Class != "proyecto"
}

// private: el cuerpo hasta la publicable — los pendientes se buscan sólo ahí, como hace el store.
func (t task) private() string {
	if loc := rePublic.FindStringIndex(t.Body); loc != nil {
		return t.Body[:loc[0]]
	}
	return t.Body
}

func openPendingItems(t task) (open []store.PendingItem, total int) {
	for _, p := range store.Pending(t.private()) {
		total++
		if !p.Done {
			open = append(open, p)
		}
	}
	return
}

// ── el snapshot de ramas: la entrega ──

type branchSnap struct {
	Repo   string          `json:"repo"`
	Branch string          `json:"branch"`
	In     map[string]bool `json:"in"`
	PR     *struct {
		Number int    `json:"number"`
		State  string `json:"state"`
		Base   string `json:"base"`
	} `json:"pr"`
}

type branchesSnap struct {
	MeasuredAt string `json:"measuredAt"`
	Tasks      map[string]struct {
		Branches []branchSnap `json:"branches"`
	} `json:"tasks"`
	Incomplete []string `json:"incomplete"`
}

func readSnap(data string) branchesSnap {
	var s branchesSnap
	b, err := os.ReadFile(filepath.Join(data, "cache", "ramas.json"))
	if err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

// delivery resume las ramas de una tarea en una línea: «4 ramas · 2 en main · 1 PR abierto → qa».
func delivery(s branchesSnap, id int) string {
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

// ── la bitácora ──

type entry struct {
	Day       string `json:"day"`
	Minutes   int    `json:"minutes"`
	EffortID  int    `json:"effortId"`
	FreeTitle string `json:"freeTitle"`
}

func worklogOf(data string, id int) []entry {
	var out []entry
	paths, _ := filepath.Glob(filepath.Join(data, "entries", "*.jsonl"))
	for _, r := range paths {
		b, _ := os.ReadFile(r)
		for _, l := range strings.Split(string(b), "\n") {
			var e entry
			if strings.TrimSpace(l) != "" && json.Unmarshal([]byte(l), &e) == nil && e.EffortID == id {
				out = append(out, e)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day > out[j].Day })
	return out
}

// plain saca el énfasis de Markdown para la consola: un `**` a mitad de un renglón truncado se lee como
// ruido, no como negrita.
func plain(s string) string {
	return strings.NewReplacer("**", "", "__", "", "`", "").Replace(s)
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

func main() {
	var (
		single  = flag.String("n", "", "retomar UNA tarea, por id o slug (acepta subcadena del slug)")
		stage   = flag.String("stage", "", "sólo esta etapa (work · evaluation · tasks)")
		anatomy = flag.Bool("anatomia", false, "cómo está repartido el archivo de cada tarea, y qué sección parece estar en el lugar equivocado")
		asJSON  = flag.Bool("json", false, "salida en JSON")
		brief   = flag.String("brief", "", "al final, la ficha de las referencias de Canon declaradas: 1 = las declaradas (hasta 4) · a,b = sólo esas")
	)
	flag.Parse()
	env.LoadDefaults()
	lay := layout.Find()
	data := lay.Data

	touches := lay.LastTouches()
	paths, _ := lay.TaskPaths()
	var tasks []task
	for _, r := range paths {
		tasks = append(tasks, readTaskFile(r, touches))
	}
	snap := readSnap(data)

	if *anatomy {
		os.Exit(showAnatomy(data, tasks, *single))
	}
	if *single != "" {
		os.Exit(resume(data, tasks, snap, *single, *asJSON, *brief))
	}
	os.Exit(agenda(data, tasks, snap, *stage, *asJSON))
}

type row struct {
	ID           int      `json:"id"`
	Slug         string   `json:"slug"`
	Title        string   `json:"title"`
	Stage        string   `json:"stage"`
	Class        string   `json:"class"`
	Days         int      `json:"daysUntouched"`
	LastBlock    string   `json:"lastBlock"`
	BlockDays    int      `json:"lastBlockDays"` // -1 si la pila está vacía
	Delivery     string   `json:"delivery"`
	Waiting      []string `json:"waiting"` // pendientes abiertos que dependen de alguien
	Pending      int      `json:"pending"`
	Dormant      bool     `json:"dormant"`
	SuggestClose bool     `json:"suggestArchive"`
}

// daysSince: días de CALENDARIO desde una fecha RFC3339 —el bloque de anoche es «ayer» aunque no hayan
// pasado 24 horas—, o -1 si no se puede leer. Es la misma cuenta que `days()` hace con el documento, que
// arranca a la medianoche de su último commit.
func daysSince(at string) int {
	when, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return -1
	}
	y, m, d := when.In(time.Local).Date()
	ty, tm, td := time.Now().Date()
	then, today := time.Date(y, m, d, 0, 0, 0, 0, time.Local), time.Date(ty, tm, td, 0, 0, 0, 0, time.Local)
	return int(math.Round(today.Sub(then).Hours() / 24))
}

// ago dice cuándo, en la forma corta de la agenda.
func ago(days int) string {
	switch days {
	case 0:
		return "hoy"
	case 1:
		return "ayer"
	}
	return fmt.Sprintf("hace %d d", days)
}

func agenda(data string, tasks []task, snap branchesSnap, stage string, asJSON bool) int {
	var rows []row
	for _, t := range tasks {
		if t.Archived || (stage != "" && t.Stage != stage) {
			continue
		}
		f := row{ID: t.ID, Slug: t.Slug, Title: t.Title, Stage: t.Stage, Class: t.Class, Days: t.days(),
			BlockDays: -1, Delivery: delivery(snap, t.ID)}
		// El último bloque dice dónde quedó la tarea; y si es más reciente que el documento, la tarea se
		// tocó entonces.
		if events, err := taskcontext.Read(data, t.Slug); err == nil && len(events) > 0 {
			f.LastBlock, f.BlockDays = events[0].Title, daysSince(events[0].At)
			if f.BlockDays >= 0 && f.BlockDays < f.Days {
				f.Days = f.BlockDays
			}
		}
		ab, _ := openPendingItems(t)
		f.Pending = len(ab)
		// Lo que espera a alguien: el pendiente con su «Depende de:». Es lo que reemplazó a la pregunta
		// vencida, que salía de las anotaciones PREGUNTA del documento y no se cerraba nunca.
		for _, p := range ab {
			if p.WaitingOn != "" {
				f.Waiting = append(f.Waiting, fmt.Sprintf("%s · %s", truncate(plain(p.WaitingOn), 60), truncate(plain(p.What), 70)))
			}
		}
		f.Dormant = f.Days >= dormantDays
		f.SuggestClose = f.Days >= archiveDays
		rows = append(rows, f)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Days != rows[j].Days {
			return rows[i].Days < rows[j].Days
		}
		return rows[i].ID > rows[j].ID
	})
	if asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(rows)
		return 0
	}

	var liveTasks, dormant, projects []row
	nWaiting, nPend, nWork := 0, 0, 0
	for _, f := range rows {
		nWaiting += len(f.Waiting)
		nPend += f.Pending
		// LOS CONTENEDORES LOCALES VAN APARTE. Son seis herramientas y playground: no son el día a día
		// comprometido en Jira y mezclarlos ahoga lo que alguien del equipo está esperando. Se listan
		// igual, abajo y sin detalle: se retoman con `make retomar`.
		if f.Class == "proyecto" {
			projects = append(projects, f)
			continue
		}
		if f.Stage == "work" {
			nWork++
		}
		if f.Dormant {
			dormant = append(dormant, f)
		} else {
			liveTasks = append(liveTasks, f)
		}
	}
	fmt.Printf("\n  hoy · %s · %d tarea(s) (%d en work) · %d dormidas (≥%d días sin tocar) · %d contenedor(es) local(es) · %d pendiente(s), %d esperando a alguien\n",
		time.Now().Format("2006-01-02"), len(rows)-len(projects), nWork, len(dormant), dormantDays, len(projects), nPend, nWaiting)
	if snap.MeasuredAt != "" {
		fmt.Printf("  entrega según `make tareas-ramas` del %s", snap.MeasuredAt[:10])
		if len(snap.Incomplete) > 0 {
			fmt.Printf(" ⚠ incompleto (%d sin medir)", len(snap.Incomplete))
		}
		fmt.Println()
	}

	fmt.Printf("\n  EN MOVIMIENTO — tocadas hace menos de %d días\n", dormantDays)
	for _, f := range liveTasks {
		printRow(f, true)
	}
	if len(dormant) > 0 {
		fmt.Printf("\n  DORMIDAS — %d días o más sin tocar. A los %d conviene archivar, o anotar por qué espera\n", dormantDays, archiveDays)
		for _, f := range dormant {
			printRow(f, false)
		}
	}
	if len(projects) > 0 {
		fmt.Println("\n  CONTENEDORES LOCALES — una tarea por herramienta y playground para lo transversal. No van a Jira")
		for _, f := range projects {
			when := fmt.Sprintf("%d d", f.Days)
			if f.Days == 0 {
				when = "hoy"
			}
			fmt.Printf("  #%-3d %-10s %-5s %s\n", f.ID, f.Stage, when, truncate(f.Title, 70))
		}
	}
	fmt.Println()
	return 0
}

func printRow(f row, detail bool) {
	when := fmt.Sprintf("%d d", f.Days)
	if f.Days == 0 {
		when = "hoy"
	}
	mark := ""
	if f.SuggestClose {
		mark = "  ⏸ ¿archivar?"
	}
	fmt.Printf("  #%-3d %-10s %-5s %s%s\n", f.ID, f.Stage, when, truncate(f.Title, 70), mark)
	if f.Delivery != "" {
		fmt.Printf("       ↳ %s\n", f.Delivery)
	}
	if !detail {
		return
	}
	if f.LastBlock != "" {
		fmt.Printf("       ▸ %s · %s\n", truncate(f.LastBlock, 100), ago(f.BlockDays))
	} else {
		fmt.Printf("       · la pila está vacía\n")
	}
	for _, v := range f.Waiting {
		fmt.Printf("       ⏳ espera a %s\n", v)
	}
	if f.Pending > 0 {
		fmt.Printf("       ☐ %d pendiente(s)\n", f.Pending)
	}
}

// ── anatomía: cómo está repartido el archivo ────────────────────────────────────────────────────

// CUATRO COSAS VIVEN EN UNA TAREA, y desde el 2026-09-23 cada una tiene su lugar:
//
//	1 PLAN         objetivo, cómo se ataca            → se REESCRIBE, en el documento
//	2 MATERIAL     recetas, consultas, datos de prueba → se MANTIENE, en el documento
//	3 HISTORIA     qué pasó, qué se midió o se decidió → se APILA, en la pila (un bloque por hecho)
//	4 CONOCIMIENTO cómo funciona el sistema            → GRADÚA a canon
//
// Lo que más se equivoca es la 3 escrita como 2: una sección nueva con fecha en el documento («🔧 Segunda
// pasada (13/9)»). Medido el 2026-09-15 sobre las 40 abiertas, antes de la pila: la mediana pesaba 16 KB,
// 11 pasaban de 40 KB y 6 de 80, y lo que las engordaba eran 91 secciones con fecha de 621. ⚠ Pero tener
// fecha NO alcanza para condenar una sección: «Cómo se prueba, de cero (verificado el 2026-08-20)» es
// MATERIAL vigente y la fecha dice cuándo se comprobó. El test que sí discrimina es el mismo del repo:
// **si esto se mergea mañana, ¿sigue siendo cierto?** Por eso acá no se mueve nada solo — se señala para
// que alguien mire.
const (
	kbUncomfortable = 40 // por encima, una tarea deja de retomarse leyéndola entera
	kbSevere        = 80
)

func showAnatomy(data string, tasks []task, ref string) int {
	type row struct {
		t                       task
		kb, secs, dated, blocks int
		examples                []string
	}
	var rows []row
	for _, t := range tasks {
		if t.Archived {
			continue
		}
		if ref != "" && t.Slug != ref && strconv.Itoa(t.ID) != ref && !strings.Contains(strings.ToLower(t.Slug), strings.ToLower(ref)) {
			continue
		}
		b, err := os.ReadFile(t.Path)
		if err != nil {
			continue
		}
		f := row{t: t, kb: len(b) / 1024}
		if events, err := taskcontext.Read(data, t.Slug); err == nil {
			f.blocks = len(events)
		}
		for _, m := range reSectionHeading.FindAllStringSubmatch(t.private(), -1) {
			f.secs++
			if reDateInTitle.MatchString(m[1]) {
				f.dated++
				if len(f.examples) < 4 {
					f.examples = append(f.examples, strings.TrimSpace(m[1]))
				}
			}
		}
		rows = append(rows, f)
	}
	if len(rows) == 0 {
		fmt.Fprintln(os.Stderr, "no encontré esa tarea")
		return 2
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].dated != rows[j].dated {
			return rows[i].dated > rows[j].dated
		}
		return rows[i].kb > rows[j].kb
	})

	fmt.Printf("\n  ANATOMÍA · qué hay dentro del documento de cada tarea, y qué parece estar fuera de lugar\n")
	fmt.Printf("  El documento tiene PLAN (se reescribe) y MATERIAL (se mantiene); la HISTORIA va a la pila y lo que\n")
	fmt.Printf("  es CONOCIMIENTO gradúa a canon. Más de %d KB ya cuesta retomarlo leyéndolo.\n\n", kbUncomfortable)
	for _, f := range rows {
		mark := " "
		switch {
		case f.kb >= kbSevere:
			mark = "🔴"
		case f.kb >= kbUncomfortable:
			mark = "🟠"
		}
		fmt.Printf("  %s #%-3d %-44s %3d KB · %2d secciones · %d bloque(s) en la pila\n",
			mark, f.t.ID, truncate(f.t.Slug, 44), f.kb, f.secs, f.blocks)
		if f.dated > 0 {
			fmt.Printf("        ⚠ %d sección(es) con fecha en el documento — mirá si son historia (→ un bloque de la pila)\n", f.dated)
			for _, e := range f.examples {
				fmt.Printf("           · %s\n", truncate(e, 86))
			}
			fmt.Printf("           el test: si esto se mergea mañana, ¿sigue siendo cierto? sí → queda (o gradúa a canon); no → la pila\n")
		}
	}
	fmt.Println()
	return 0
}

// canonBrief es lo que `-brief` agrega al final de la retoma: lo que una referencia de Canon declara
// sobre sí misma, leído desde la API vigente.
//
// ⚠ NO SE LE PIDE A UN MODELO. Canon entrega `title`, `summary` y el objetivo de cada área; la ficha
// sólo los proyecta. Así la tarea consulta la fuente vigente en Postgres y no una carpeta que Canon
// ya no usa.
type canonBrief struct {
	Topic    string      `json:"topic"`
	Declared bool        `json:"declared"`
	Title    string      `json:"title,omitempty"`
	Summary  string      `json:"summary,omitempty"`
	Areas    []areaCanon `json:"areas,omitempty"`
	Tables   []string    `json:"tables,omitempty"`
	Repos    []string    `json:"repos,omitempty"`
	Error    string      `json:"error,omitempty"`
}

type areaCanon struct {
	ID       string `json:"id"`
	Goal     string `json:"objetivo"`
	Sections int    `json:"secciones"`
}

const briefLimit = 4

// canonBriefs decide QUÉ temas van y se los pide a `readTaskFile`, sin interpretar la respuesta.
// `requested` es el valor de BRIEF=: «1» son los declarados por la tarea, en su orden y hasta el tope
// —una tarea llega a declarar 9, y nueve fichas pesan más que el documento que se quería no abrir—;
// «a,b» son esos, estén declarados o no (y se marca cuando no). Un error de `readTaskFile` se DEVUELVE en su
// ficha, nunca se calla: una ficha que falta se lee igual que un tema que no existe.
func canonBriefs(declared []string, requested string, readBrief func(topic string) (canonBrief, error)) (briefs []canonBrief, notice string) {
	seen := map[string]bool{}
	for _, n := range declared {
		seen[n] = true
	}
	topics := declared
	if requested != "1" {
		topics = nil
		for _, n := range strings.Split(requested, ",") {
			if n = strings.TrimSpace(n); n != "" {
				topics = append(topics, n)
			}
		}
	} else if len(topics) > briefLimit {
		notice = fmt.Sprintf("… y %d más (%s) — BRIEF=a,b elige cuáles", len(topics)-briefLimit, strings.Join(topics[briefLimit:], ", "))
		topics = topics[:briefLimit]
	}
	for _, n := range topics {
		f, err := readBrief(n)
		f.Topic, f.Declared = n, seen[n]
		if err != nil {
			f.Error = err.Error()
		}
		briefs = append(briefs, f)
	}
	return briefs, notice
}

func briefFromCanon(client *canon.Client) func(string) (canonBrief, error) {
	return func(reference string) (canonBrief, error) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		f, err := client.Brief(ctx, reference)
		if err != nil {
			return canonBrief{}, err
		}
		out := canonBrief{Title: f.Title, Summary: f.Summary, Tables: f.Tables, Repos: f.Repos}
		for _, area := range f.Areas {
			out.Areas = append(out.Areas, areaCanon{ID: area.ID, Goal: area.Goal, Sections: len(area.Sections)})
		}
		return out, nil
	}
}

func resume(data string, tasks []task, snap branchesSnap, ref string, asJSON bool, brief string) int {
	var t *task
	for i := range tasks {
		if tasks[i].Slug == ref || strconv.Itoa(tasks[i].ID) == ref {
			t = &tasks[i]
			break
		}
	}
	if t == nil {
		for i := range tasks {
			if strings.Contains(strings.ToLower(tasks[i].Slug), strings.ToLower(ref)) {
				t = &tasks[i]
				break
			}
		}
	}
	if t == nil {
		fmt.Fprintf(os.Stderr, "no hay tarea que matchee %q. `make tareas` las lista.\n", ref)
		return 2
	}
	contextInfo, contextErr := taskcontext.Read(data, t.Slug)
	if contextErr != nil {
		fmt.Fprintf(os.Stderr, "⚠ la pila de %s: %v\n", t.Slug, contextErr)
		contextInfo = nil
	}
	contextInfo = taskcontext.Recent(contextInfo, 8)
	pend, totalPend := openPendingItems(*t)
	bit := worklogOf(data, t.ID)
	var missing []string
	if len(contextInfo) == 0 {
		missing = append(missing, "la pila está vacía: `make tarea-bloque N="+strconv.Itoa(t.ID)+" ARCHIVO=<bloque.md>`")
	}
	if len(t.Branches) == 0 && requiresBranches(*t) {
		missing = append(missing, "`ramas:` en el frontmatter — sin eso no se mide hasta dónde llegó")
	}
	if len(bit) == 0 {
		missing = append(missing, "bitácora: ninguna entrada apunta a esta tarea")
	}
	var briefs []canonBrief
	var briefsNotice string
	if brief != "" {
		briefs, briefsNotice = canonBriefs(t.Nodes, brief, briefFromCanon(canon.FromEnv()))
	}

	if asJSON {
		output := map[string]any{
			"id": t.ID, "slug": t.Slug, "title": t.Title, "stage": t.Stage, "daysUntouched": t.days(),
			"delivery": delivery(snap, t.ID), "branches": snap.Tasks[strconv.Itoa(t.ID)].Branches,
			"pending": pend, "worklog": bit, "context": contextInfo, "missing": missing,
		}
		if brief != "" {
			output["canon"], output["canonNotice"] = briefs, briefsNotice
		}
		_ = json.NewEncoder(os.Stdout).Encode(output)
		return 0
	}

	fmt.Printf("\n  #%d · %s\n  %s · %s · tocada hace %d día(s) · creada %s\n", t.ID, t.Title, t.Slug, t.Stage, t.days(), strings.SplitN(t.Created+"T", "T", 2)[0])
	if len(t.Jira) > 0 || len(t.Nodes) > 0 {
		fmt.Printf("  jira: %s · referencias de Canon: %s\n", strings.Join(t.Jira, ", "), strings.Join(t.Nodes, ", "))
	}
	if len(t.Nodes) > 0 && brief == "" {
		fmt.Printf("  la ficha de cada referencia de Canon: make retomar N=%d BRIEF=1\n", t.ID)
	}
	fmt.Printf("  archivo: %s\n", t.Path)

	// LA PILA PRIMERO: el último bloque entero —es el que dice dónde quedó la tarea, con sus archivos
	// fijados a su commit— y los anteriores por su título.
	fmt.Println("\n  ── La pila ──")
	if len(contextInfo) == 0 {
		fmt.Println("  ✗ está vacía")
	}
	for i, event := range contextInfo {
		if i == 0 {
			fmt.Printf("  %s · %s\n\n    %s\n", event.At[:10], event.Title, strings.ReplaceAll(event.Body, "\n", "\n    "))
			if len(contextInfo) > 1 {
				fmt.Println()
			}
			continue
		}
		fmt.Printf("  %s · %s\n", event.At[:10], truncate(event.Title, 150))
	}

	fmt.Print("\n  ── Ramas y entrega")
	if snap.MeasuredAt != "" {
		fmt.Printf(" (snapshot del %s)", snap.MeasuredAt[:10])
	}
	fmt.Println(" ──")
	rs := snap.Tasks[strconv.Itoa(t.ID)].Branches
	switch {
	case len(t.Branches) == 0 && t.Class == "proyecto":
		fmt.Println("  · contenedor local: no requiere una rama permanente")
	case len(t.Branches) == 0:
		fmt.Println("  ✗ la tarea no declara `ramas:`")
	case len(rs) == 0:
		fmt.Println("  · sin ramas medidas — corré `make tareas-ramas N=" + strconv.Itoa(t.ID) + "`")
	default:
		for _, r := range rs {
			var presentIn []string
			for _, envName := range []string{"develop", "staging", "qa", "main"} {
				if r.In[envName] {
					presentIn = append(presentIn, envName)
				}
			}
			pr := "sin PR"
			if r.PR != nil {
				pr = fmt.Sprintf("PR #%d %s → %s", r.PR.Number, r.PR.State, r.PR.Base)
			}
			where := "en ningún ambiente"
			if len(presentIn) > 0 {
				where = "en " + strings.Join(presentIn, ", ")
			}
			fmt.Printf("  %-20s %-52s %s · %s\n", r.Repo, truncate(r.Branch, 52), where, pr)
		}
	}

	if len(pend) > 0 {
		fmt.Printf("\n  ── Pendientes (%d de %d abiertos) ──\n", len(pend), totalPend)
		for i, p := range pend {
			if i == 10 {
				fmt.Printf("  … y %d más\n", len(pend)-10)
				break
			}
			fmt.Printf("  ☐ %s\n", truncate(plain(p.What), 110))
			if p.WaitingOn != "" {
				fmt.Printf("     ⏳ espera a %s\n", truncate(plain(p.WaitingOn), 100))
			}
		}
	}

	fmt.Println("\n  ── Bitácora ──")
	if len(bit) == 0 {
		fmt.Println("  ✗ ninguna entrada apunta a esta tarea")
	} else {
		total := 0
		for _, e := range bit {
			total += e.Minutes
		}
		fmt.Printf("  %d entrada(s), %dh%02d en total. Las últimas:\n", len(bit), total/60, total%60)
		for i, e := range bit {
			if i == 3 {
				break
			}
			fmt.Printf("  %s  %4d′  %s\n", e.Day, e.Minutes, truncate(e.FreeTitle, 80))
		}
	}

	if len(missing) > 0 {
		fmt.Println("\n  ── Faltan ──")
		for _, f := range missing {
			fmt.Println("  ✗ " + f)
		}
	}

	if brief != "" {
		fmt.Println("\n  ── Canon: referencias declaradas por la tarea ──")
		if len(briefs) == 0 {
			fmt.Println("  ✗ la tarea no declara `canon:`. Para encontrar una referencia de una pregunta nueva:")
			fmt.Println("    canon -pregunta '<la pregunta>'   (desde github/playground/tools/canon)")
		}
		for i, f := range briefs {
			if i > 0 {
				fmt.Println()
			}
			if !f.Declared {
				fmt.Printf("  ⚠ %s no está en el `canon:` de la tarea\n", f.Topic)
			}
			if f.Error != "" {
				fmt.Printf("  ✗ %s: %s\n", f.Topic, f.Error)
				continue
			}
			fmt.Printf("  %s · %s\n", f.Topic, f.Title)
			if f.Summary != "" {
				fmt.Println("  " + fit(f.Summary, 96, "  "))
			}
			secs := 0
			for _, a := range f.Areas {
				secs += a.Sections
			}
			fmt.Printf("  %d áreas · %d secciones", len(f.Areas), secs)
			if len(f.Repos) > 0 {
				fmt.Printf(" · %s", strings.Join(f.Repos, ", "))
			}
			if len(f.Tables) > 0 {
				fmt.Printf("\n  tablas: %s", fit(strings.Join(f.Tables, ", "), 92, "  "))
			}
			fmt.Println()
			// El `id` del área NO se imprime: en canon es un hash (`area-dda3b2591178`), así que
			// ocupaba media columna sin decir nada. Lo que nombra a un área es su `objetivo`.
			for _, a := range f.Areas {
				fmt.Printf("    · %s\n", fit(a.Goal, 92, "      "))
			}
		}
		if briefsNotice != "" {
			fmt.Println("  " + briefsNotice)
		}
		fmt.Println("  la ficha decide qué referencia se abre; si ninguna contesta, la pregunta va al código de main — no a otra referencia")
	}
	fmt.Println()
	return 0
}

// fit parte un texto largo en renglones de a lo sumo `width` runas, sangrando los siguientes con
// `indent`. Los `objetivo` de canon son frases de una o dos líneas y sin esto se salen de la
// terminal: el que lee pierde justo el final, que es donde suele estar la condición.
//
// ⚠ Cuenta RUNAS, no bytes. Los objetivos están en español —«decisión», «también», «qué»— y con
// `len()` una frase con diez tildes se corta diez caracteres antes de donde debería.
func fit(text string, width int, indent string) string {
	words := strings.Fields(text)
	if len(words) == 0 {
		return ""
	}
	var b strings.Builder
	line := 0
	for i, p := range words {
		n := len([]rune(p))
		switch {
		case i == 0:
			b.WriteString(p)
			line = n
		case line+1+n <= width:
			b.WriteString(" " + p)
			line += 1 + n
		default:
			b.WriteString("\n" + indent + p)
			line = len([]rune(indent)) + n
		}
	}
	return b.String()
}
