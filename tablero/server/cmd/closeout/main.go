// cierre — el cierre de sesión del tablero, como COMANDO y no como lista de buenas intenciones.
//
// `tablero/CLAUDE.md` pide dos cosas al terminar de trabajar en una tarea: un BLOQUE del día en su pila
// —lo que se hizo, con lo que lo sostiene— y la bitácora con minutos medidos (más `ramas:` si hay código).
// Una regla que depende de que alguien se acuerde es una regla que se olvida, sobre todo cuando
// olvidarla no rompe nada: el 26/8 se olvidaron todas y el tablero mintió ocho días.
//
// ⚠ Hasta el 2026-09-23 pedía cuatro: además, reescribir la sección de retoma y un «próximo paso». Se
// fueron con la pila de bloques: la historia de la tarea son sus bloques, y un próximo paso fijo obliga a
// hacer algo después cuando eso es decisión de cómo se va desarrollando la tarea (Miguel).
//
// Esto contesta, para UN día: ¿qué tareas se tocaron, y a cuál le falta qué? Cruza cuatro fuentes que ya
// existen y ninguna escribe:
//
//	git       qué documentos de tarea se commitearon o están modificados ese día (un commit que declara
//	          `Sin-avance:` es un barrido: sus tareas se listan aparte y no se les pide nada)
//	la pila   qué tareas tienen un bloque fechado ese día (cuenta la FECHA del bloque, no el archivo:
//	          una migración que reescribe bloques viejos no vuelve «tocadas» a sus tareas)
//	el pulso  qué ramas se tocaron ese día → qué tarea las declara en `ramas:` (y cuáles ninguna)
//	entries   la bitácora del día: minutos por tarea, y los que no tienen dueño
//
// Sale 1 cuando a una tarea tocada le falta una pieza, o cuando hay ramas del día que ninguna tarea
// declara. Es a propósito: sirve para frenar, igual que `-guard`. Con `-quiet` no imprime nada si está
// todo en orden — es la forma que usa el hook de Stop, que sólo habla cuando hay algo que decir.
//
//	cierre                 el día de hoy
//	cierre -dia 2026-09-10 otro día
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
	"slices"
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
	ID               int      `json:"id"`
	Slug             string   `json:"slug"`
	Title            string   `json:"title"`
	Reasons          []string `json:"touchedBy"` // por qué cuenta como tocada: "archivo", "bloque", "rama <x>"
	BlockToday       bool     `json:"blockToday"`
	MinutesToday     int      `json:"minutesToday"`
	DeclaredBranches bool     `json:"declaredBranches"`
	Missing          []string `json:"missing"`
	// Watch: lo que conviene revisar pero NO es una pieza faltante — no suma a `MissingPieces` ni hace
	// salir 1. La distinción es la misma que el repo ya usa en el lint: el chequeo habla de lo que está
	// MAL, y los juicios se ofrecen sin bloquear.
	Watch []string `json:"watch,omitempty"`
}

type Report struct {
	Day            string     `json:"day"`
	PulseMinutes   int        `json:"pulseMinutes"`
	WorklogMin     int        `json:"worklogMinutes"`
	WorklogN       int        `json:"worklogEntries"`
	WithoutTaskMin int        `json:"worklogWithoutTaskMinutes"`
	Tasks          []Revision `json:"tasks"`
	// Swept: las tareas que sólo tocó un barrido declarado en su commit (layout.SweepTrailer), con el
	// motivo. No se les pide bloque ni bitácora —el tiempo del barrido está en la tarea que lo hizo, y
	// contarlo en cada una lo sumaría dos veces en un dato que sube a Jira—, pero se muestran: callarlas
	// se leería igual que un día sin tocarlas.
	Swept               []Swept  `json:"swept,omitempty"`
	BranchesWithoutTask []string `json:"branchesWithoutTask"`
	Warnings            []string `json:"warnings"`
	MissingPieces       int      `json:"missingPieces"`
	PulseAvailable      bool     `json:"pulseAvailable"`
}

type Swept struct {
	ID     int    `json:"id"`
	Slug   string `json:"slug"`
	Reason string `json:"reason"`
}

var reCitation = regexp.MustCompile(`^["']|["']$`)

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

// touchedByGit: los slugs cuyo documento se commiteó en el día o está cambiado en el working tree (esto
// último sólo cuenta si el día es hoy: lo sin commitear no tiene fecha), y aparte los que sólo tocó un
// barrido. Ni una MUDANZA pura ni un barrido declarado cuentan como trabajo (ver layout.TouchedOn): sin
// eso, el día de la mudanza de `data/` a `tasks/` el cierre le habría reclamado piezas a las 46 tareas.
func touchedByGit(data, day string, isToday bool) (map[string]bool, map[string]string) {
	return layout.At(data).TouchedOn(day, isToday)
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

// ⚠ HASTA EL 2026-09-23 UN BARRIDO SE DECLARABA EN LA TAREA: una línea «**<día> · sin avance.**» en la
// entrada del día de su `## Registro`. Era el segundo caso de «tocar no es trabajar», hermano de
// `metadataOnly`: el 2026-09-21, apagar el árbol de contexto reapuntó rutas en 45 tareas y a tres el
// cierre les reclamó bitácora; anotarla habría inventado minutos y los habría contado dos veces. Ese día
// el Registro se fue a la pila, y la declaración pasó al COMMIT del barrido (layout.SweepTrailer): lo dice
// una vez, donde se hizo. Sigue siendo DECLARADA y no deducida: se probó deducirla comparando el cuerpo
// con las citas normalizadas y falla, porque al barrer se escribe la nota que explica el barrido.

// blocksOn: ¿la pila tiene un bloque fechado ese día (`any`), y alguno que sea trabajo de ese día y no un
// hito viejo convertido (`work`)? Un bloque migrado cumple con el bloque del día —es el hito que se
// escribió entonces— pero no vuelve tocada a la tarea. La fecha va con el huso local, así que el
// prefijo es el día de acá.
func blocksOn(events []taskcontext.Event, day string) (any, work bool) {
	for _, e := range events {
		if strings.HasPrefix(e.At, day+"T") {
			any = true
			work = work || e.Via != "migration"
		}
	}
	return any, work
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
	touched, swept := touchedByGit(data, *day, isToday)
	branches, base, pulseMin, pulseOK := branchesOfDay(data, *day)
	inf.PulseMinutes, inf.PulseAvailable = pulseMin, pulseOK
	minutesByTask, withoutTask, totalWorklog, nBit := worklog(data, *day)
	inf.WorklogMin, inf.WorklogN, inf.WithoutTaskMin = totalWorklog, nBit, withoutTask

	reasons, branchWithTask := attribute(tasks, touched, branches)
	// Un bloque fechado ese día también es trabajo en la tarea, aunque su documento no cambie: la pila es
	// donde se documenta ahora. Cuenta la FECHA del bloque y no el archivo tocado, así que la migración que
	// reescribió los 37 hitos viejos con sus fechas no volvió «tocadas» a sus 22 tareas. Y un bloque
	// MIGRADO no vuelve tocada a nadie: es un hito viejo convertido, no trabajo de ese día (el 2026-09-22 un
	// agente sembró uno por tarea, y contarlos pedía bitácora en veinte).
	stacks, stackErrs := map[string][]taskcontext.Event{}, map[string]error{}
	for _, t := range tasks {
		events, err := taskcontext.Read(data, t.Slug)
		stacks[t.Slug], stackErrs[t.Slug] = events, err
		if _, work := blocksOn(events, *day); work && !slices.Contains(reasons[t.Slug], "bloque") {
			reasons[t.Slug] = append(reasons[t.Slug], "bloque")
		}
	}
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
		rv.DeclaredBranches = len(t.Branches) > 0
		rv.MinutesToday = minutesByTask[t.ID]
		events := stacks[t.Slug]
		if err := stackErrs[t.Slug]; err != nil {
			rv.Watch = append(rv.Watch, "la pila no se pudo leer: "+err.Error())
		}
		rv.BlockToday, _ = blocksOn(events, *day)
		if !rv.BlockToday {
			rv.Missing = append(rv.Missing, "falta un bloque del día en la pila: `make tarea-bloque N="+strconv.Itoa(t.ID)+" ARCHIVO=<bloque.md>`")
		}
		if rv.MinutesToday == 0 {
			rv.Missing = append(rv.Missing, "sin bitácora del día: `make bitacora-add TAREA="+strconv.Itoa(t.ID)+" LAPSO=HH:MM-HH:MM TITULO='…' NOTA='…'` (o PULSO=HH:MM; los minutos los mide el comando)")
		}
		// ⚠ CON QUÉ SE COMPROBÓ — avisa, no frena, y la diferencia importa: hay tareas de diseño o de
		// lectura donde no hay nada que correr, y convertir eso en un error enseña a ignorar el cierre.
		//
		// La señal sale de dos lados: los comandos del cuerpo (`store.SourcesOf`, lo que pinta la tarjeta) y
		// los bloques de la pila que traen un comando con su resultado. Si la tarea declara ramas —o sea
		// que hay código— y no hay un solo comando en ninguno de los dos, lo que se afirme no se puede
		// volver a comprobar. Medido el 2026-09-18: de 350 anotaciones del tablero, 308 tenían texto debajo
		// y sólo 51 dejaban una fuente; lo que se escribe suele ser prosa donde iba el comando.
		if rv.DeclaredBranches && len(store.SourcesOf(t.Body)) == 0 && !taskcontext.HasCommand(events) {
			rv.Watch = append(rv.Watch, "tocó código y no dice con QUÉ se comprobó: agregá un bloque con el comando y su «Resultado:»")
		}
		inf.MissingPieces += len(rv.Missing)
		inf.Tasks = append(inf.Tasks, rv)
	}
	sort.Slice(inf.Tasks, func(i, j int) bool { return inf.Tasks[i].ID > inf.Tasks[j].ID })
	listed := map[string]bool{}
	for _, rv := range inf.Tasks {
		listed[rv.Slug] = true
	}
	for _, t := range tasks {
		if why, ok := swept[t.Slug]; ok && !listed[t.Slug] {
			inf.Swept = append(inf.Swept, Swept{ID: t.ID, Slug: t.Slug, Reason: why})
		}
	}
	sort.Slice(inf.Swept, func(i, j int) bool { return inf.Swept[i].ID > inf.Swept[j].ID })

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
		fmt.Printf("       %s bloque del día   %s bitácora (%s)\n", mark(t.BlockToday), mark(t.MinutesToday > 0), hm(t.MinutesToday))
		for _, f := range t.Missing {
			fmt.Printf("       ✗ %s\n", f)
		}
		// Con otro glifo a propósito: `✗` es una pieza que falta y hace salir 1; `▲` es algo para mirar.
		// Verlos iguales convierte el aviso en un error, y un cierre que «falla» por un juicio se aprende
		// a ignorar entero — incluidas las piezas que sí importan.
		for _, m := range t.Watch {
			fmt.Printf("       ▲ %s\n", m)
		}
		fmt.Println()
	}
	// ⚠ Una tarea barrida se marca «—», no «✓»: un tilde diría que sus piezas están, y no están. Ver la
	// misma regla en el panel del harness — una vista apagada se ve apagada, no se esconde.
	if len(inf.Swept) > 0 {
		fmt.Println("  — barridas, sin avance (lo declara su commit; no se les pide bloque ni bitácora):")
		for _, t := range inf.Swept {
			fmt.Printf("    #%-3d %s — %s\n", t.ID, t.Slug, t.Reason)
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
