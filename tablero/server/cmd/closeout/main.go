// cierre — el cierre de sesión del tablero, como COMANDO y no como lista de buenas intenciones.
//
// `tablero/CLAUDE.md` pide cuatro cosas al terminar de trabajar en una tarea: reescribir la sección de
// retoma, apilar el Registro del día, declarar `ramas:` y escribir la bitácora con minutos medidos. Las
// cuatro se olvidaron el 26/8 y el tablero mintió ocho días; medido el 2026-09-14 sobre las 39 abiertas,
// 23 no tienen sección de retoma y 3 trabajadas en septiembre no tienen bitácora. Una regla que depende
// de que alguien se acuerde es una regla que se olvida, sobre todo cuando olvidarla no rompe nada.
//
// Esto contesta, para UN día: ¿qué tareas se tocaron, y a cuál le falta qué? Cruza tres fuentes que ya
// existen y ninguna escribe:
//
//	git       qué archivos de tarea se commitearon o están modificados ese día — y si la sección de
//	          retoma CAMBIÓ respecto del último commit anterior al día (existir no alcanza: tiene que
//	          decir lo de hoy)
//	el pulso  qué ramas se tocaron ese día → qué tarea las declara en `ramas:` (y cuáles ninguna)
//	entries   la bitácora del día: minutos por tarea, y los que no tienen dueño
//
// Sale 1 cuando a una tarea tocada le falta una pieza, o cuando hay ramas del día que ninguna tarea
// declara. Es a propósito: sirve para frenar, igual que `-guard`. Con `-quiet` no imprime nada si está
// todo en orden — es la forma que usa el hook de Stop, que sólo habla cuando hay algo que decir.
//
//	cierre                 el día de hoy
//	cierre -dia 2026-09-10 otro día (la comparación de la retoma va contra el último commit ANTES de ese día)
//	cierre -json           para otro programa
//	cierre -quiet          silencio si no falta nada
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/layout"
	"creditop/tablero/server/internal/pulse"
	"creditop/tablero/server/internal/store"
	"creditop/tablero/server/internal/taskcontext"
)

type task struct {
	Slug     string
	ID       int
	Title    string
	Stage    string
	Class    string
	Archived bool
	Branches []string // los patrones de `ramas:`, ya partidos por coma
	Body     string
	Path     string
}

// Revision es lo que se sabe de UNA tarea tocada en el día.
type Revision struct {
	ID           int      `json:"id"`
	Slug         string   `json:"slug"`
	Title        string   `json:"title"`
	Reasons      []string `json:"touchedBy"` // por qué cuenta como tocada: "archivo", "rama <x>"
	Resume       string   `json:"resume"`    // ok · sin-seccion · sin-cambios · sin-avance
	NextStep     bool     `json:"nextStep"`
	RecordToday  bool     `json:"recordToday"`
	ContextToday bool     `json:"contextToday"`
	MinutesToday int      `json:"minutesToday"`
	// NoProgress: la entrada del día DECLARA que la tarea no avanzó (ver `noProgress`). Exime de la
	// bitácora y de reescribir la retoma; nada más.
	NoProgress       bool     `json:"noProgress,omitempty"`
	DeclaredBranches bool     `json:"declaredBranches"`
	Missing          []string `json:"missing"`
	// Watch: lo que conviene revisar pero NO es una pieza faltante — no suma a `MissingPieces` ni hace
	// salir 1. La distinción es la misma que el repo ya usa en el lint: el chequeo habla de lo que está
	// MAL, y los juicios se ofrecen sin bloquear.
	Watch []string `json:"watch,omitempty"`
}

type Report struct {
	Day                 string     `json:"day"`
	PulseMinutes        int        `json:"pulseMinutes"`
	WorklogMin          int        `json:"worklogMinutes"`
	WorklogN            int        `json:"worklogEntries"`
	WithoutTaskMin      int        `json:"worklogWithoutTaskMinutes"`
	Tasks               []Revision `json:"tasks"`
	BranchesWithoutTask []string   `json:"branchesWithoutTask"`
	Warnings            []string   `json:"warnings"`
	MissingPieces       int        `json:"missingPieces"`
	PulseAvailable      bool       `json:"pulseAvailable"`
}

var (
	reCitation = regexp.MustCompile(`^["']|["']$`)
	// ⚠ INSENSIBLE A MAYÚSCULAS Y CON NUMERACIÓN OPCIONAL. La tarea de Bancolombia titula su sección
	// «## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ» y el patrón exacto no la veía: el cierre
	// reclamaba «la sección no existe» sobre una tarea que la tiene desde julio. Un chequeo que
	// contesta «no hay» cuando no supo buscar es peor que no tenerlo (2026-09-15).
	reResume     = regexp.MustCompile(`(?mi)^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n`)
	reSection    = regexp.MustCompile(`(?m)^##\s`)
	reNext       = regexp.MustCompile(`(?i)\*\*El pr[óo]ximo paso es:?\*\*`)
	reRecordDate = regexp.MustCompile(`(?m)^###\s+(\d{4}-\d{2}-\d{2})`)
	// El marcador con el que una tarea DECLARA que el día no la hizo avanzar. Ver `noProgress`.
	reNoProgress = regexp.MustCompile(`(?i)\*\*[^*]*sin avance[^*]*\*\*`)
)

func value(l string) string {
	_, v, _ := strings.Cut(l, ":")
	return reCitation.ReplaceAllString(strings.TrimSpace(v), "")
}

// dataDir: la carpeta `data/`; las tareas viven al lado, en `tasks/`. Ver el paquete layout.
func dataDir() string { return layout.Find().Data }

func readTaskFile(path string) (task, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return task{}, err
	}
	t := task{Slug: layout.SlugOf(path), Path: path}
	parts := strings.SplitN(string(b), "---", 3)
	if len(parts) < 3 {
		t.Body = string(b)
		return t, nil
	}
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
		case strings.HasPrefix(l, "archived:"):
			v := value(l)
			t.Archived = v != "" && v != "false" && v != "null"
		case strings.HasPrefix(l, "ramas:"):
			for _, p := range strings.Split(value(l), ",") {
				if p = strings.TrimSpace(p); p != "" {
					t.Branches = append(t.Branches, p)
				}
			}
		}
	}
	return t, nil
}

// resumeSection devuelve el texto de «Si retomás esto sin contexto» hasta el próximo `##`, o "" si no está.
func resumeSection(body string) string {
	m := reResume.FindStringIndex(body)
	if m == nil {
		return ""
	}
	rest := body[m[1]:]
	if end := reSection.FindStringIndex(rest); end != nil {
		rest = rest[:end[0]]
	}
	return strings.TrimSpace(rest)
}

// touchedByGit: los slugs cuyo documento se commiteó en el día o está cambiado en el working tree (esto
// último sólo cuenta si el día es hoy: lo sin commitear no tiene fecha). Una MUDANZA pura no cuenta:
// mover una tarea de carpeta no es trabajar en ella (ver layout.TouchedOn). Sin eso, el día de la
// mudanza de `data/` a `tasks/` el cierre le habría reclamado piezas a las 46 tareas.
func touchedByGit(data, day string, isToday bool) map[string]bool {
	return layout.At(data).TouchedOn(day, isToday)
}

// resumeBefore: la sección de retoma como estaba en el último commit ANTERIOR al día. Si el archivo no
// existía, devuelve ok=false: una tarea que nació ese día no tiene con qué compararse.
func resumeBefore(data, day, slug string) (text string, ok bool) {
	old, ok := bodyBefore(data, day, slug)
	if !ok {
		return "", false
	}
	return resumeSection(old), true
}

// bodyBefore devuelve el CUERPO (lo que sigue al frontmatter) como estaba en el último commit anterior
// al día. Es la base de las dos preguntas que el cierre necesita: ¿se reescribió la retoma? y ¿esto fue
// trabajo de verdad, o sólo un cambio de metadato?
func bodyBefore(data, day, slug string) (string, bool) {
	// siguiendo las mudanzas: el día que la tarea se movió, lo de antes vivía en la ruta vieja
	old, ok := layout.At(data).DocumentBefore(slug, day)
	if !ok {
		return "", false
	}
	if parts := strings.SplitN(old, "---", 3); len(parts) == 3 {
		return parts[2], true
	}
	return old, true
}

// metadataOnly: el archivo cambió hoy, pero su CUERPO no. O sea que lo único que se tocó fue el
// frontmatter — declarar `ramas:`, marcar `clase: proyecto`, corregir un id.
//
// CLASIFICAR NO ES TRABAJAR, y confundirlos hace ruido del caro: el 2026-09-15, marcar ocho tareas como
// proyecto (una línea cada una) hizo que el cierre le reclamara a CINCO de ellas reescribir el estado,
// apilar un Registro y anotar bitácora, por un cambio de metadato que no dice nada nuevo de la tarea.
// Un aviso que reclama de más se empieza a ignorar, y ahí deja de servir para lo que existe.
func metadataOnly(data, day, slug, bodyToday string) bool {
	before, ok := bodyBefore(data, day, slug)
	return ok && strings.TrimSpace(before) == strings.TrimSpace(bodyToday)
}

// noProgress: ¿la entrada de HOY del Registro declara que la tarea no avanzó?
//
// SEGUNDO CASO DE «TOCAR NO ES TRABAJAR», hermano de `metadataOnly` y por el mismo motivo medido. Ese
// cubre el cambio que no toca el cuerpo; éste cubre el que SÍ lo toca sin que nadie haya trabajado en
// la tarea: un barrido. El 2026-09-21, apagar el árbol de contexto renombró un campo del frontmatter
// y reapuntó rutas en 45 archivos de tareas, y a tres de ellas —#15, #46, #47— el cierre les reclamó
// bitácora. Anotarla habría sido inventar minutos, y peor: los mismos minutos ya estaban contados en
// la tarea del barrido, así que el total del día —que sube a Jira— habría contado doble.
//
// ⚠ SE DECLARA, NO SE ADIVINA. Se probó deducirlo comparando el cuerpo con las citas normalizadas —la
// idea era «si sólo cambiaron rutas, nadie afirmó nada»— y NO sirve: medido sobre esas tres tareas, la
// prosa fuera de los backticks también cambió, porque al barrer se escribe la nota que explica el
// barrido. Deducirlo habría dado falso en los tres casos que venía a resolver. Así que lo dice la
// tarea, con un marcador en negrita dentro de su entrada del día.
//
// ⚠ Y NO exime del Registro: al contrario, el marcador VIVE en la entrada del día. Se perdonan dos
// piezas: la bitácora, que mide TIEMPO, y reescribir la retoma, que describe el ESTADO — y un barrido
// no cambia ninguno de los dos. Hasta el 2026-09-23 se perdonaba sólo la bitácora, y alcanzaba porque el
// barrido del 21 había tocado también las secciones de retoma. El de la fase 3 y la mudanza a carpetas
// no las tocó: a #46 y #47 el cierre les exigía reescribir un estado que no había cambiado, o sea
// inventar uno. Ver `resumeState`.
func noProgress(body, day string) bool {
	loc := reRecordDate.FindAllStringSubmatchIndex(body, -1)
	for i, m := range loc {
		if body[m[2]:m[3]] != day {
			continue
		}
		end := len(body)
		if i+1 < len(loc) {
			end = loc[i+1][0]
		}
		return reNoProgress.MatchString(body[m[1]:end])
	}
	return false
}

// resumeState: ¿se reescribió la retoma? `now` es la sección de hoy; `before`, la del último commit
// anterior al día (`existed` = false si la tarea nació ese día y no hay con qué comparar).
//
// Una retoma idéntica a la de antes es una pieza faltante, SALVO que la entrada del día declare «sin
// avance»: si la tarea no se movió, su estado tampoco, y exigir reescribirlo es pedir que se invente. Lo
// que no se perdona nunca es que la sección falte: eso es un defecto del documento, no del día.
func resumeState(now, before string, existed, declaredNoProgress bool) (state, missing string) {
	switch {
	case now == "":
		return "sin-seccion", "la sección «Si retomás esto sin contexto» no existe"
	case !existed || before != now:
		return "ok", ""
	case declaredNoProgress:
		return "sin-avance", ""
	default:
		return "sin-cambios", "«Si retomás» dice lo mismo que antes del día: hay que reescribirla con lo de HOY"
	}
}

func isOnlyContainerCreation(t task, reasons []string, existedBefore bool) bool {
	return len(reasons) == 1 && reasons[0] == "archivo" && t.Class == "proyecto" && !existedBefore
}

type entry struct {
	Day      string `json:"day"`
	Minutes  int    `json:"minutes"`
	EffortID int    `json:"effortId"`
}

func worklog(data, day string) (byTask map[int]int, withoutTask, total, n int) {
	byTask = map[int]int{}
	paths, _ := filepath.Glob(filepath.Join(data, "entries", day[:7]+".jsonl"))
	for _, r := range paths {
		b, err := os.ReadFile(r)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(string(b), "\n") {
			var e entry
			if strings.TrimSpace(l) == "" || json.Unmarshal([]byte(l), &e) != nil || e.Day != day {
				continue
			}
			n++
			total += e.Minutes
			if e.EffortID == 0 {
				withoutTask += e.Minutes
			} else {
				byTask[e.EffortID] += e.Minutes
			}
		}
	}
	return
}

// branchesOfDay: las ramas con actividad ese día según el pulso, como "repo/rama", cuáles de ellas son
// ramas BASE, y los minutos totales (tramos de 5' con cambios). `ok` es false si no hay ningún tick de ese
// día: pulso apagado ≠ no trabajé.
func branchesOfDay(data, day string) (branches []string, base map[string]bool, minutes int, ok bool) {
	today := time.Now()
	d, _ := time.Parse("2006-01-02", day)
	days := int(today.Sub(d).Hours()/24) + 2
	ticks, err := pulse.Read(data, days)
	if err != nil {
		return nil, nil, 0, false
	}
	return dayBranches(pulse.Aggregate(ticks, 0), day)
}

// dayBranches es la parte de `branchesOfDay` que no lee disco. La rama base se decide ACÁ, con el repo y
// la rama todavía separados: el texto "repo/rama" es ambiguo, porque las dos partes pueden llevar barras
// —`microservices/customer-service` es UN repo (el pulso baja un nivel en `github/`) y `feat/x` es una
// rama—. Partirlo después en la primera barra leía `microservices/customer-service/main` como la rama
// «customer-service/main»: medido el 2026-09-23, dos `main` de microservicios salían como ramas sin
// dueño y el cierre salía 1 por tocar una rama base.
func dayBranches(hours []pulse.Hour, day string) (branches []string, base map[string]bool, minutes int, ok bool) {
	seen := map[string]bool{}
	base = map[string]bool{}
	for _, h := range hours {
		if h.Day != day {
			continue
		}
		if h.Covered > 0 {
			ok = true
		}
		minutes += h.Slots * 5
		for _, r := range h.Repos {
			if r.Branch == "" {
				continue
			}
			k := r.Repo + "/" + r.Branch
			if !seen[k] {
				seen[k] = true
				branches = append(branches, k)
				base[k] = isBaseBranch(r.Branch)
			}
		}
	}
	sort.Strings(branches)
	return branches, base, minutes, ok
}

/*
atribuir: por qué tarea hay que pasar hoy —por su archivo o por una rama— y qué ramas no las declara

	ninguna. Está afuera de `main` para que lo pruebe una prueba: es la regla que el 2026-09-17 pidió
	escribir historia falsa, y una regla que nadie puede ejercer sin terminar una jornada entera es una
	regla que se arregla a ciegas.

	⚠ UNA TAREA TERMINADA NO LA REABRE UNA RAMA. Los patrones se declaran como SUBCADENA —`canon/`
	cubre las sesenta y siete ramas de esa herramienta— y mientras la tarea vive eso es justo lo que
	hace que declarar cueste una línea. Pero cuando cierra, el patrón queda pescando el futuro: ese día
	una rama nueva de canon reclamó la #67, terminada diez días antes, y el cierre pidió un
	`### 2026-09-17` en el Registro de una tarea cerrada. Eso no es cerrar: es escribir historia falsa
	para que el guard se calle. Una tarea con `archived:` no tiene día que registrar.

	Y la rama tampoco queda DECLARADA por ella: si lo único que la reclama es una tarea cerrada, sale
	en «ramas que ninguna tarea declara», que es exactamente lo que hay que hacer con ella —declararla
	en la tarea viva que continúa el trabajo—. Darla por declarada la taparía con la misma línea que ya
	no corresponde, que es el mismo error con otra cara.

	Lo que SÍ sigue valiendo para una tarea archivada es el motivo «archivo»: si hoy se editó su texto,
	algo se está haciendo ahí y el cierre lo pregunta igual.
*/
func attribute(tasks []task, touched map[string]bool, branches []string) (map[string][]string, map[string]bool) {
	reasons := map[string][]string{}
	branchWithTask := map[string]bool{}
	for _, t := range tasks {
		if touched[t.Slug] {
			reasons[t.Slug] = append(reasons[t.Slug], "archivo")
		}
		if t.Archived {
			continue
		}
		for _, r := range branches {
			for _, p := range t.Branches {
				if strings.Contains(r, p) {
					branchWithTask[r] = true
					reasons[t.Slug] = append(reasons[t.Slug], "rama "+r)
					break
				}
			}
		}
	}
	return reasons, branchWithTask
}

func main() {
	var (
		day    = flag.String("dia", time.Now().Format("2006-01-02"), "qué día cerrar (YYYY-MM-DD)")
		asJSON = flag.Bool("json", false, "salida en JSON")
		quiet  = flag.Bool("quiet", false, "no imprimir nada si no falta ninguna pieza")
	)
	flag.Parse()
	if _, err := time.Parse("2006-01-02", *day); err != nil {
		fmt.Fprintln(os.Stderr, "-dia tiene que ser YYYY-MM-DD")
		os.Exit(2)
	}
	isToday := *day == time.Now().Format("2006-01-02")
	data := dataDir()

	paths, _ := layout.At(data).TaskPaths()
	var tasks []task
	byID := map[int][]string{}
	for _, r := range paths {
		if t, err := readTaskFile(r); err == nil {
			tasks = append(tasks, t)
			byID[t.ID] = append(byID[t.ID], t.Slug)
		}
	}

	inf := Report{Day: *day}
	touched := touchedByGit(data, *day, isToday)
	branches, base, pulseMin, pulseOK := branchesOfDay(data, *day)
	inf.PulseMinutes, inf.PulseAvailable = pulseMin, pulseOK
	minutesByTask, withoutTask, totalWorklog, nBit := worklog(data, *day)
	inf.WorklogMin, inf.WorklogN, inf.WithoutTaskMin = totalWorklog, nBit, withoutTask

	reasons, branchWithTask := attribute(tasks, touched, branches)
	for _, r := range branches {
		if !branchWithTask[r] && !base[r] {
			inf.BranchesWithoutTask = append(inf.BranchesWithoutTask, r)
		}
	}

	for _, t := range tasks {
		m := reasons[t.Slug]
		if len(m) == 0 {
			continue
		}
		// Si lo único que cambió hoy es el frontmatter y no hay trabajo en ramas, no hay nada que cerrar.
		if len(m) == 1 && m[0] == "archivo" && metadataOnly(data, *day, t.Slug, t.Body) {
			continue
		}
		// Crear el contenedor permanente de una herramienta es organización del tablero, no trabajo en
		// esa herramienta. Si además se tocó una rama declarada, sí se cierra como trabajo real. Esta
		// excepción sólo aplica el primer día del archivo; después cualquier cambio de cuerpo vuelve a
		// exigir retoma, Registro y bitácora como siempre.
		_, existedBefore := bodyBefore(data, *day, t.Slug)
		if isOnlyContainerCreation(t, m, existedBefore) {
			continue
		}
		rv := Revision{ID: t.ID, Slug: t.Slug, Title: t.Title, Reasons: m}
		rv.NextStep = reNext.MatchString(t.Body)
		rv.DeclaredBranches = len(t.Branches) > 0
		rv.MinutesToday = minutesByTask[t.ID]
		for _, f := range reRecordDate.FindAllStringSubmatch(t.Body, -1) {
			if f[1] == *day {
				rv.RecordToday = true
				break
			}
		}
		if events, err := taskcontext.Read(data, t.Slug); err != nil {
			rv.Watch = append(rv.Watch, "el contexto estructurado no se pudo leer: "+err.Error())
		} else {
			for _, event := range events {
				if strings.HasPrefix(event.At, *day+"T") {
					rv.ContextToday = true
					break
				}
			}
		}
		rv.NoProgress = rv.RecordToday && noProgress(t.Body, *day)
		before, existed := resumeBefore(data, *day, t.Slug)
		var missing string
		rv.Resume, missing = resumeState(resumeSection(t.Body), before, existed, rv.NoProgress)
		if missing != "" {
			rv.Missing = append(rv.Missing, missing)
		}
		if !rv.NextStep {
			rv.Missing = append(rv.Missing, "falta «**El próximo paso es:**» (UNA acción)")
		}
		if !rv.RecordToday && !rv.ContextToday {
			rv.Missing = append(rv.Missing, "falta un bloque del día en la pila (`make tarea-bloque`) o una entrada de Registro `### "+*day+"`")
		}
		if rv.MinutesToday == 0 && !rv.NoProgress {
			rv.Missing = append(rv.Missing, "sin bitácora del día: `make bitacora-add TAREA="+strconv.Itoa(t.ID)+" LAPSO=HH:MM-HH:MM TITULO='…' NOTA='…'` (o PULSO=HH:MM; los minutos los mide el comando)")
		}
		// ⚠ CON QUÉ SE COMPROBÓ — avisa, no frena, y la diferencia importa: hay tareas de diseño o de
		// lectura donde no hay nada que correr, y convertir eso en un error enseña a ignorar el cierre.
		//
		// La señal es la misma que pinta la tarjeta (`store.SourcesOf`): de los comandos escritos en el
		// cuerpo sale con QUÉ se comprobó. Si la tarea declara ramas —o sea que hay código— y en todo el
		// archivo no hay un solo comando reconocible, lo que se afirme no se puede volver a comprobar.
		// Medido el 2026-09-18: de 350 anotaciones del tablero, 308 tienen texto debajo y sólo 51 dejan
		// una fuente; lo que se escribe suele ser prosa donde iba el comando.
		if rv.DeclaredBranches && len(store.SourcesOf(t.Body)) == 0 {
			rv.Watch = append(rv.Watch, "tocó código y no dice con QUÉ se comprobó: pegá el comando "+
				"(el trazador lo emite con `MD=1`) en «Cómo se comprueba» o en una anotación")
		}
		inf.MissingPieces += len(rv.Missing)
		inf.Tasks = append(inf.Tasks, rv)
	}
	sort.Slice(inf.Tasks, func(i, j int) bool { return inf.Tasks[i].ID > inf.Tasks[j].ID })

	// avisos globales: lo que miente sin que nadie lo note
	ids := make([]int, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		if len(byID[id]) > 1 {
			inf.Warnings = append(inf.Warnings, fmt.Sprintf("id %d repetido: %s", id, strings.Join(byID[id], ", ")))
		}
	}
	for _, t := range tasks {
		if !t.Archived && t.Stage != "" && t.Stage != "evaluation" && t.Stage != "work" && t.Stage != "tasks" {
			inf.Warnings = append(inf.Warnings, fmt.Sprintf("#%d %s: etapa «%s» no existe — si terminó, va `archived:` con fecha", t.ID, t.Slug, t.Stage))
		}
	}
	if !pulseOK {
		inf.Warnings = append(inf.Warnings, "el pulso no tiene registro de este día: las ramas tocadas y los minutos reales no se saben (`make pulso-status`)")
	}
	if withoutTask > 0 {
		inf.Warnings = append(inf.Warnings, fmt.Sprintf("%d′ de bitácora sin tarea asignada (effortId vacío)", withoutTask))
	}

	failure := inf.MissingPieces > 0 || len(inf.BranchesWithoutTask) > 0
	if *asJSON {
		_ = json.NewEncoder(os.Stdout).Encode(inf)
	} else if !(*quiet && !failure) {
		printReport(inf)
	}
	if failure {
		os.Exit(1)
	}
}

// isBaseBranch: tocar `main`, `develop`, `qa` o `staging` no es trabajo de una tarea —es un merge, un
// pull o una prueba contra el ambiente—, así que no cuenta como rama sin dueño. Recibe la RAMA sola, nunca
// "repo/rama" (ver `dayBranches`).
func isBaseBranch(branch string) bool {
	switch branch {
	case "main", "master", "develop", "qa", "staging":
		return true
	}
	return false
}

func hm(min int) string {
	if min < 60 {
		return fmt.Sprintf("%d′", min)
	}
	return fmt.Sprintf("%dh%02d", min/60, min%60)
}

func printReport(inf Report) {
	pulseLabel := "sin pulso"
	if inf.PulseAvailable {
		pulseLabel = "pulso " + hm(inf.PulseMinutes)
	}
	fmt.Printf("\n  cierre · %s · %s · bitácora %s en %d entrada(s)", inf.Day, pulseLabel, hm(inf.WorklogMin), inf.WorklogN)
	if inf.WithoutTaskMin > 0 {
		fmt.Printf(" (%s sin tarea)", hm(inf.WithoutTaskMin))
	}
	fmt.Println()
	fmt.Println()
	if len(inf.Tasks) == 0 {
		fmt.Println("  ninguna tarea tocada este día (ni por archivo ni por rama declarada)")
	}
	for _, t := range inf.Tasks {
		fmt.Printf("  #%-3d %s\n", t.ID, t.Slug)
		fmt.Printf("       tocada por: %s\n", strings.Join(t.Reasons, " · "))
		mark := func(ok bool) string {
			if ok {
				return "✔"
			}
			return "✗"
		}
		// ⚠ Una tarea eximida se marca «—», no «✓»: un tilde diría que la bitácora está, y no está.
		// Ver la misma regla en el panel del harness — una vista apagada se ve apagada, no se esconde.
		bit := mark(t.MinutesToday > 0)
		detail := hm(t.MinutesToday)
		if t.NoProgress && t.MinutesToday == 0 {
			bit, detail = "—", "declara sin avance"
		}
		resume, resumeLabel := mark(t.Resume == "ok"), "retoma reescrita"
		if t.Resume == "sin-avance" {
			resume, resumeLabel = "—", "retoma (declara sin avance)"
		}
		fmt.Printf("       %s %s   %s próximo paso   %s bloque/registro del día   %s bitácora (%s)\n",
			resume, resumeLabel, mark(t.NextStep), mark(t.RecordToday || t.ContextToday), bit, detail)
		for _, f := range t.Missing {
			fmt.Printf("       ✗ %s\n", f)
		}
		// Con otro glifo a propósito: `✗` es una pieza que falta y hace salir 1; `▲` es algo para mirar.
		// Verlos iguales convierte el aviso en un error, y un cierre que «falla» por un juicio se aprende
		// a ignorar entero — incluidas las cuatro piezas que sí importan.
		for _, m := range t.Watch {
			fmt.Printf("       ▲ %s\n", m)
		}
		fmt.Println()
	}
	if len(inf.BranchesWithoutTask) > 0 {
		fmt.Println("  ramas tocadas hoy que NINGUNA tarea declara en `ramas:`:")
		for _, r := range inf.BranchesWithoutTask {
			fmt.Printf("    · %s\n", r)
		}
		fmt.Println()
	}
	for _, a := range inf.Warnings {
		fmt.Printf("  ⚠ %s\n", a)
	}
	if len(inf.Warnings) > 0 {
		fmt.Println()
	}
	switch {
	case inf.MissingPieces > 0:
		fmt.Printf("  faltan %d pieza(s) → salgo 1. El detalle de cada una: tablero/CLAUDE.md §«AL CERRAR UNA SESIÓN»\n\n", inf.MissingPieces)
	case len(inf.BranchesWithoutTask) > 0:
		fmt.Println("  hay ramas sin dueño → salgo 1. Declaralas en `ramas:` de su tarea (o es trabajo que no tiene tarea todavía)")
		fmt.Println()
	default:
		fmt.Println("  todo en orden.")
		fmt.Println()
	}
}
