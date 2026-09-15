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
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"creditop/tablero/server/internal/pulso"
)

type tarea struct {
	Slug     string
	ID       int
	Title    string
	Stage    string
	Archived bool
	Ramas    []string // los patrones de `ramas:`, ya partidos por coma
	Cuerpo   string
	Ruta     string
}

// Revision es lo que se sabe de UNA tarea tocada en el día.
type Revision struct {
	ID          int      `json:"id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Motivos     []string `json:"tocada"` // por qué cuenta como tocada: "archivo", "rama <x>"
	Retoma      string   `json:"retoma"` // ok · sin-seccion · sin-cambios
	ProximoPaso bool     `json:"proximoPaso"`
	RegistroHoy bool     `json:"registroHoy"`
	MinutosHoy  int      `json:"minutosHoy"`
	RamasDecl   bool     `json:"ramasDeclaradas"`
	Faltan      []string `json:"faltan"`
}

type Informe struct {
	Dia            string     `json:"dia"`
	PulsoMinutos   int        `json:"pulsoMinutos"`
	BitacoraMin    int        `json:"bitacoraMinutos"`
	BitacoraN      int        `json:"bitacoraEntradas"`
	SinTareaMin    int        `json:"bitacoraSinTareaMinutos"`
	Tareas         []Revision `json:"tareas"`
	RamasSinTarea  []string   `json:"ramasSinTarea"`
	Avisos         []string   `json:"avisos"`
	PiezasFaltan   int        `json:"piezasFaltan"`
	PulsoDisponble bool       `json:"pulsoDisponible"`
}

var (
	reCita = regexp.MustCompile(`^["']|["']$`)
	// ⚠ INSENSIBLE A MAYÚSCULAS Y CON NUMERACIÓN OPCIONAL. La tarea de Bancolombia titula su sección
	// «## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ» y el patrón exacto no la veía: el cierre
	// reclamaba «la sección no existe» sobre una tarea que la tiene desde julio. Un chequeo que
	// contesta «no hay» cuando no supo buscar es peor que no tenerlo (2026-09-15).
	reRetoma    = regexp.MustCompile(`(?mi)^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n`)
	reSeccion   = regexp.MustCompile(`(?m)^##\s`)
	reProximo   = regexp.MustCompile(`(?i)\*\*El pr[óo]ximo paso es:?\*\*`)
	reFechaReg  = regexp.MustCompile(`(?m)^###\s+(\d{4}-\d{2}-\d{2})`)
	reSlugEnRef = regexp.MustCompile(`^(?:tablero/)?data/([^/]+)\.md$`)
)

func valor(l string) string {
	_, v, _ := strings.Cut(l, ":")
	return reCita.ReplaceAllString(strings.TrimSpace(v), "")
}

func dirDatos() string {
	for _, d := range []string{"../data", "data", "tablero/data"} {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return d
		}
	}
	return "../data"
}

func leer(ruta string) (tarea, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return tarea{}, err
	}
	t := tarea{Slug: strings.TrimSuffix(filepath.Base(ruta), ".md"), Ruta: ruta}
	partes := strings.SplitN(string(b), "---", 3)
	if len(partes) < 3 {
		t.Cuerpo = string(b)
		return t, nil
	}
	t.Cuerpo = partes[2]
	for _, l := range strings.Split(partes[1], "\n") {
		switch {
		case strings.HasPrefix(l, "id:"):
			t.ID, _ = strconv.Atoi(valor(l))
		case strings.HasPrefix(l, "title:"):
			t.Title = valor(l)
		case strings.HasPrefix(l, "stage:"):
			t.Stage = valor(l)
		case strings.HasPrefix(l, "archived:"):
			v := valor(l)
			t.Archived = v != "" && v != "false" && v != "null"
		case strings.HasPrefix(l, "ramas:"):
			for _, p := range strings.Split(valor(l), ",") {
				if p = strings.TrimSpace(p); p != "" {
					t.Ramas = append(t.Ramas, p)
				}
			}
		}
	}
	return t, nil
}

// seccionRetoma devuelve el texto de «Si retomás esto sin contexto» hasta el próximo `##`, o "" si no está.
func seccionRetoma(cuerpo string) string {
	m := reRetoma.FindStringIndex(cuerpo)
	if m == nil {
		return ""
	}
	resto := cuerpo[m[1]:]
	if fin := reSeccion.FindStringIndex(resto); fin != nil {
		resto = resto[:fin[0]]
	}
	return strings.TrimSpace(resto)
}

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// tocadasPorGit: los slugs cuyo archivo se commiteó en el día o está modificado en el working tree
// (esto último sólo cuenta si el día es hoy: lo sin commitear no tiene fecha).
func tocadasPorGit(datos, dia string, esHoy bool) map[string]bool {
	out := map[string]bool{}
	desde := dia + " 00:00:00"
	d, _ := time.Parse("2006-01-02", dia)
	hasta := d.AddDate(0, 0, 1).Format("2006-01-02") + " 00:00:00"
	if txt, err := git(datos, "log", "--since="+desde, "--until="+hasta, "--format=", "--name-only", "--", "."); err == nil {
		for _, l := range strings.Split(txt, "\n") {
			if m := reSlugEnRef.FindStringSubmatch(strings.TrimSpace(l)); m != nil {
				out[m[1]] = true
			}
		}
	}
	if esHoy {
		if txt, err := git(datos, "status", "--porcelain", "--", "."); err == nil {
			for _, l := range strings.Split(txt, "\n") {
				if len(l) > 3 {
					if m := reSlugEnRef.FindStringSubmatch(strings.TrimSpace(l[3:])); m != nil {
						out[m[1]] = true
					}
				}
			}
		}
	}
	return out
}

// retomaAntes: la sección de retoma como estaba en el último commit ANTERIOR al día. Si el archivo no
// existía, devuelve ok=false: una tarea que nació ese día no tiene con qué compararse.
func retomaAntes(datos, dia, slug string) (texto string, ok bool) {
	viejo, ok := cuerpoAntes(datos, dia, slug)
	if !ok {
		return "", false
	}
	return seccionRetoma(viejo), true
}

// cuerpoAntes devuelve el CUERPO (lo que sigue al frontmatter) como estaba en el último commit anterior
// al día. Es la base de las dos preguntas que el cierre necesita: ¿se reescribió la retoma? y ¿esto fue
// trabajo de verdad, o sólo un cambio de metadato?
func cuerpoAntes(datos, dia, slug string) (string, bool) {
	rev, err := git(datos, "rev-list", "-1", "--before="+dia+" 00:00:00", "HEAD", "--", slug+".md")
	if err != nil || rev == "" {
		return "", false
	}
	// la ruta para `show` es relativa a la raíz del repo, no a `datos`
	rel, err := git(datos, "ls-files", "--full-name", slug+".md")
	if err != nil || rel == "" {
		return "", false
	}
	viejo, err := git(datos, "show", rev+":"+rel)
	if err != nil {
		return "", false
	}
	if partes := strings.SplitN(viejo, "---", 3); len(partes) == 3 {
		return partes[2], true
	}
	return viejo, true
}

// soloMetadatos: el archivo cambió hoy, pero su CUERPO no. O sea que lo único que se tocó fue el
// frontmatter — declarar `ramas:`, marcar `clase: proyecto`, corregir un id.
//
// CLASIFICAR NO ES TRABAJAR, y confundirlos hace ruido del caro: el 2026-09-15, marcar ocho tareas como
// proyecto (una línea cada una) hizo que el cierre le reclamara a CINCO de ellas reescribir el estado,
// apilar un Registro y anotar bitácora, por un cambio de metadato que no dice nada nuevo de la tarea.
// Un aviso que reclama de más se empieza a ignorar, y ahí deja de servir para lo que existe.
func soloMetadatos(datos, dia, slug, cuerpoHoy string) bool {
	antes, ok := cuerpoAntes(datos, dia, slug)
	return ok && strings.TrimSpace(antes) == strings.TrimSpace(cuerpoHoy)
}

type entrada struct {
	Day      string `json:"day"`
	Minutes  int    `json:"minutes"`
	EffortID int    `json:"effortId"`
}

func bitacora(datos, dia string) (porTarea map[int]int, sinTarea, total, n int) {
	porTarea = map[int]int{}
	rutas, _ := filepath.Glob(filepath.Join(datos, "entries", dia[:7]+".jsonl"))
	for _, r := range rutas {
		b, err := os.ReadFile(r)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(string(b), "\n") {
			var e entrada
			if strings.TrimSpace(l) == "" || json.Unmarshal([]byte(l), &e) != nil || e.Day != dia {
				continue
			}
			n++
			total += e.Minutes
			if e.EffortID == 0 {
				sinTarea += e.Minutes
			} else {
				porTarea[e.EffortID] += e.Minutes
			}
		}
	}
	return
}

// ramasDelDia: las ramas con actividad ese día según el pulso, como "repo/rama", y los minutos totales
// (tramos de 5' con cambios). `ok` es false si no hay ningún tick de ese día: pulso apagado ≠ no trabajé.
func ramasDelDia(datos, dia string) (ramas []string, minutos int, ok bool) {
	hoy := time.Now()
	d, _ := time.Parse("2006-01-02", dia)
	dias := int(hoy.Sub(d).Hours()/24) + 2
	ticks, err := pulso.Read(datos, dias)
	if err != nil {
		return nil, 0, false
	}
	vistas := map[string]bool{}
	for _, h := range pulso.Aggregate(ticks, 0) {
		if h.Day != dia {
			continue
		}
		if h.Covered > 0 {
			ok = true
		}
		minutos += h.Slots * 5
		for _, r := range h.Repos {
			if r.Branch == "" {
				continue
			}
			k := r.Repo + "/" + r.Branch
			if !vistas[k] {
				vistas[k] = true
				ramas = append(ramas, k)
			}
		}
	}
	sort.Strings(ramas)
	return ramas, minutos, ok
}

func main() {
	var (
		dia      = flag.String("dia", time.Now().Format("2006-01-02"), "qué día cerrar (YYYY-MM-DD)")
		comoJSON = flag.Bool("json", false, "salida en JSON")
		quiet    = flag.Bool("quiet", false, "no imprimir nada si no falta ninguna pieza")
	)
	flag.Parse()
	if _, err := time.Parse("2006-01-02", *dia); err != nil {
		fmt.Fprintln(os.Stderr, "-dia tiene que ser YYYY-MM-DD")
		os.Exit(2)
	}
	esHoy := *dia == time.Now().Format("2006-01-02")
	datos := dirDatos()

	rutas, _ := filepath.Glob(filepath.Join(datos, "*.md"))
	var tareas []tarea
	porID := map[int][]string{}
	for _, r := range rutas {
		if t, err := leer(r); err == nil {
			tareas = append(tareas, t)
			porID[t.ID] = append(porID[t.ID], t.Slug)
		}
	}

	inf := Informe{Dia: *dia}
	tocadas := tocadasPorGit(datos, *dia, esHoy)
	ramas, pulsoMin, pulsoOK := ramasDelDia(datos, *dia)
	inf.PulsoMinutos, inf.PulsoDisponble = pulsoMin, pulsoOK
	minPorTarea, sinTarea, totalBit, nBit := bitacora(datos, *dia)
	inf.BitacoraMin, inf.BitacoraN, inf.SinTareaMin = totalBit, nBit, sinTarea

	// ramas → tareas, por los patrones declarados (subcadena, igual que `ramas`)
	ramaConTarea := map[string]bool{}
	motivos := map[string][]string{}
	for _, t := range tareas {
		if tocadas[t.Slug] {
			motivos[t.Slug] = append(motivos[t.Slug], "archivo")
		}
		for _, r := range ramas {
			for _, p := range t.Ramas {
				if strings.Contains(r, p) {
					ramaConTarea[r] = true
					motivos[t.Slug] = append(motivos[t.Slug], "rama "+r)
					break
				}
			}
		}
	}
	for _, r := range ramas {
		if !ramaConTarea[r] && !esRamaBase(r) {
			inf.RamasSinTarea = append(inf.RamasSinTarea, r)
		}
	}

	for _, t := range tareas {
		m := motivos[t.Slug]
		if len(m) == 0 {
			continue
		}
		// Si lo único que cambió hoy es el frontmatter y no hay trabajo en ramas, no hay nada que cerrar.
		if len(m) == 1 && m[0] == "archivo" && soloMetadatos(datos, *dia, t.Slug, t.Cuerpo) {
			continue
		}
		rv := Revision{ID: t.ID, Slug: t.Slug, Title: t.Title, Motivos: m}
		rv.ProximoPaso = reProximo.MatchString(t.Cuerpo)
		rv.RamasDecl = len(t.Ramas) > 0
		rv.MinutosHoy = minPorTarea[t.ID]
		for _, f := range reFechaReg.FindAllStringSubmatch(t.Cuerpo, -1) {
			if f[1] == *dia {
				rv.RegistroHoy = true
				break
			}
		}
		ahora := seccionRetoma(t.Cuerpo)
		switch {
		case ahora == "":
			rv.Retoma = "sin-seccion"
			rv.Faltan = append(rv.Faltan, "la sección «Si retomás esto sin contexto» no existe")
		default:
			antes, hubo := retomaAntes(datos, *dia, t.Slug)
			if hubo && antes == ahora {
				rv.Retoma = "sin-cambios"
				rv.Faltan = append(rv.Faltan, "«Si retomás» dice lo mismo que antes del día: hay que reescribirla con lo de HOY")
			} else {
				rv.Retoma = "ok"
			}
		}
		if !rv.ProximoPaso {
			rv.Faltan = append(rv.Faltan, "falta «**El próximo paso es:**» (UNA acción)")
		}
		if !rv.RegistroHoy {
			rv.Faltan = append(rv.Faltan, "el Registro no tiene entrada `### "+*dia+"`")
		}
		if rv.MinutosHoy == 0 {
			rv.Faltan = append(rv.Faltan, "sin bitácora del día: `make bitacora-add TAREA="+strconv.Itoa(t.ID)+" LAPSO=HH:MM-HH:MM TITULO='…' NOTA='…'` (o PULSO=HH:MM; los minutos los mide el comando)")
		}
		inf.PiezasFaltan += len(rv.Faltan)
		inf.Tareas = append(inf.Tareas, rv)
	}
	sort.Slice(inf.Tareas, func(i, j int) bool { return inf.Tareas[i].ID > inf.Tareas[j].ID })

	// avisos globales: lo que miente sin que nadie lo note
	ids := make([]int, 0, len(porID))
	for id := range porID {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		if len(porID[id]) > 1 {
			inf.Avisos = append(inf.Avisos, fmt.Sprintf("id %d repetido: %s", id, strings.Join(porID[id], ", ")))
		}
	}
	for _, t := range tareas {
		if !t.Archived && t.Stage != "" && t.Stage != "evaluation" && t.Stage != "work" && t.Stage != "tasks" {
			inf.Avisos = append(inf.Avisos, fmt.Sprintf("#%d %s: etapa «%s» no existe — si terminó, va `archived:` con fecha", t.ID, t.Slug, t.Stage))
		}
	}
	if !pulsoOK {
		inf.Avisos = append(inf.Avisos, "el pulso no tiene registro de este día: las ramas tocadas y los minutos reales no se saben (`make pulso-status`)")
	}
	if sinTarea > 0 {
		inf.Avisos = append(inf.Avisos, fmt.Sprintf("%d′ de bitácora sin tarea asignada (effortId vacío)", sinTarea))
	}

	falla := inf.PiezasFaltan > 0 || len(inf.RamasSinTarea) > 0
	if *comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(inf)
	} else if !(*quiet && !falla) {
		imprimir(inf)
	}
	if falla {
		os.Exit(1)
	}
}

// esRamaBase: tocar `main`, `develop`, `qa` o `staging` no es trabajo de una tarea —es un merge, un
// pull o una prueba contra el ambiente—, así que no cuenta como rama sin dueño.
func esRamaBase(repoRama string) bool {
	rama := repoRama[strings.Index(repoRama, "/")+1:]
	switch rama {
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

func imprimir(inf Informe) {
	pulso := "sin pulso"
	if inf.PulsoDisponble {
		pulso = "pulso " + hm(inf.PulsoMinutos)
	}
	fmt.Printf("\n  cierre · %s · %s · bitácora %s en %d entrada(s)", inf.Dia, pulso, hm(inf.BitacoraMin), inf.BitacoraN)
	if inf.SinTareaMin > 0 {
		fmt.Printf(" (%s sin tarea)", hm(inf.SinTareaMin))
	}
	fmt.Println()
	fmt.Println()
	if len(inf.Tareas) == 0 {
		fmt.Println("  ninguna tarea tocada este día (ni por archivo ni por rama declarada)")
	}
	for _, t := range inf.Tareas {
		fmt.Printf("  #%-3d %s\n", t.ID, t.Slug)
		fmt.Printf("       tocada por: %s\n", strings.Join(t.Motivos, " · "))
		marca := func(ok bool) string {
			if ok {
				return "✔"
			}
			return "✗"
		}
		fmt.Printf("       %s retoma reescrita   %s próximo paso   %s registro del día   %s bitácora (%s)\n",
			marca(t.Retoma == "ok"), marca(t.ProximoPaso), marca(t.RegistroHoy), marca(t.MinutosHoy > 0), hm(t.MinutosHoy))
		for _, f := range t.Faltan {
			fmt.Printf("       ✗ %s\n", f)
		}
		fmt.Println()
	}
	if len(inf.RamasSinTarea) > 0 {
		fmt.Println("  ramas tocadas hoy que NINGUNA tarea declara en `ramas:`:")
		for _, r := range inf.RamasSinTarea {
			fmt.Printf("    · %s\n", r)
		}
		fmt.Println()
	}
	for _, a := range inf.Avisos {
		fmt.Printf("  ⚠ %s\n", a)
	}
	if len(inf.Avisos) > 0 {
		fmt.Println()
	}
	switch {
	case inf.PiezasFaltan > 0:
		fmt.Printf("  faltan %d pieza(s) → salgo 1. El detalle de cada una: tablero/CLAUDE.md §«AL CERRAR UNA SESIÓN»\n\n", inf.PiezasFaltan)
	case len(inf.RamasSinTarea) > 0:
		fmt.Println("  hay ramas sin dueño → salgo 1. Declaralas en `ramas:` de su tarea (o es trabajo que no tiene tarea todavía)")
		fmt.Println()
	default:
		fmt.Println("  todo en orden.")
		fmt.Println()
	}
}
