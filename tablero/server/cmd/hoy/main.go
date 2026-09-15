// hoy — la primera pantalla del día, derivada de las tareas: qué sigue, qué espera respuesta, qué se durmió.
//
// Cada tarea ya declara su «próximo paso», sus preguntas con fecha y a quién se le deben, sus casillas
// pendientes y sus ramas. La tarjeta muestra cada cosa en su tarea, pero nadie las cruzaba: medido el
// 2026-09-14 había 11 preguntas vencidas hace más de 7 días y 57 casillas abiertas repartidas en 10
// tareas, y 21 de las 39 abiertas llevaban más de 3 semanas sin tocarse sin que nada lo dijera.
//
// Dos vistas, ninguna escribe:
//
//	hoy                la agenda: en movimiento (con su próximo paso, preguntas vencidas y entrega) y dormidas
//	hoy -n <id|slug>   RETOMAR una tarea en frío: sólo lo que hace falta para arrancar, y en rojo lo que no está
//
// «Días sin tocar» sale de git (último commit del archivo, o hoy si está modificado). Dormida = 14 días;
// a los 30 la vista sugiere archivar o anotar por qué espera. Los umbrales son del tablero, no de Jira.
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

	"creditop/tablero/server/internal/store"
)

const (
	diasDormida  = 14
	diasArchivar = 30
	diasPregunta = 7
)

type tarea struct {
	Slug, Title, Stage, Created, Ruta string
	ID                                int
	Archived                          bool
	Ramas                             []string
	Jira, Nodos                       []string
	Cuerpo                            string
	Toque                             time.Time // último cambio del archivo (git; hoy si está sucio)
}

var (
	reCita    = regexp.MustCompile(`^["']|["']$`)
	reLista   = regexp.MustCompile(`\[(.*?)\]`)
	reRetoma  = regexp.MustCompile(`(?m)^##\s+Si retom[áa]s esto sin contexto[^\n]*\n`)
	reSeccion = regexp.MustCompile(`(?m)^##\s`)
	reProximo = regexp.MustCompile(`(?is)\*\*El pr[óo]ximo paso es:?\*\*\s*(.*?)(?:\n\s*\n|\n##|\z)`)
	reRegDia  = regexp.MustCompile(`(?m)^###\s+(\d{4}-\d{2}-\d{2})[^\n]*\n`)
	rePublic  = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
)

func valor(l string) string {
	_, v, _ := strings.Cut(l, ":")
	return reCita.ReplaceAllString(strings.TrimSpace(v), "")
}

func lista(l string) []string {
	m := reLista.FindStringSubmatch(l)
	if m == nil {
		return nil
	}
	var out []string
	for _, x := range strings.Split(m[1], ",") {
		if x = reCita.ReplaceAllString(strings.TrimSpace(x), ""); x != "" {
			out = append(out, x)
		}
	}
	return out
}

func dirDatos() string {
	for _, d := range []string{"../data", "data", "tablero/data"} {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return d
		}
	}
	return "../data"
}

func git(dir string, args ...string) string {
	out, _ := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	return strings.TrimSpace(string(out))
}

func leer(datos, ruta string, sucios map[string]bool) tarea {
	b, _ := os.ReadFile(ruta)
	t := tarea{Slug: strings.TrimSuffix(filepath.Base(ruta), ".md"), Ruta: ruta}
	partes := strings.SplitN(string(b), "---", 3)
	if len(partes) == 3 {
		t.Cuerpo = partes[2]
		for _, l := range strings.Split(partes[1], "\n") {
			switch {
			case strings.HasPrefix(l, "id:"):
				t.ID, _ = strconv.Atoi(valor(l))
			case strings.HasPrefix(l, "title:"):
				t.Title = valor(l)
			case strings.HasPrefix(l, "stage:"):
				t.Stage = valor(l)
			case strings.HasPrefix(l, "created:"):
				t.Created = valor(l)
			case strings.HasPrefix(l, "archived:"):
				v := valor(l)
				t.Archived = v != "" && v != "false" && v != "null"
			case strings.HasPrefix(l, "jira:"):
				t.Jira = lista(l)
			case strings.HasPrefix(l, "context_nodes:"):
				t.Nodos = lista(l)
			case strings.HasPrefix(l, "ramas:"):
				for _, p := range strings.Split(valor(l), ",") {
					if p = strings.TrimSpace(p); p != "" {
						t.Ramas = append(t.Ramas, p)
					}
				}
			}
		}
	} else {
		t.Cuerpo = string(b)
	}
	if t.Stage == "" {
		t.Stage = "evaluation"
	}
	if sucios[t.Slug+".md"] {
		t.Toque = time.Now()
	} else if d := git(datos, "log", "-1", "--format=%cs", "--", t.Slug+".md"); d != "" {
		t.Toque, _ = time.ParseInLocation("2006-01-02", d, time.Local)
	} else if fi, err := os.Stat(ruta); err == nil {
		t.Toque = fi.ModTime()
	}
	return t
}

func (t tarea) dias() int { return int(time.Since(t.Toque).Hours() / 24) }

func (t tarea) proximoPaso() string {
	m := reProximo.FindStringSubmatch(t.Cuerpo)
	if m == nil {
		return ""
	}
	p := strings.TrimSpace(m[1])
	p = strings.TrimLeft(p, "*: ")
	return strings.Join(strings.Fields(p), " ")
}

func (t tarea) retoma() string {
	m := reRetoma.FindStringIndex(t.Cuerpo)
	if m == nil {
		return ""
	}
	resto := t.Cuerpo[m[1]:]
	if fin := reSeccion.FindStringIndex(resto); fin != nil {
		resto = resto[:fin[0]]
	}
	return strings.TrimSpace(resto)
}

// privado: el cuerpo hasta la publicable — las anotaciones y pendientes se buscan sólo ahí, como hace el store.
func (t tarea) privado() string {
	if loc := rePublic.FindStringIndex(t.Cuerpo); loc != nil {
		return t.Cuerpo[:loc[0]]
	}
	return t.Cuerpo
}

func (t tarea) ultimoRegistro() (fecha, bloque string) {
	locs := reRegDia.FindAllStringSubmatchIndex(t.Cuerpo, -1)
	if len(locs) == 0 {
		return "", ""
	}
	// el más reciente por FECHA, no por posición: las tareas viejas apilan hacia abajo y las nuevas hacia arriba
	best := -1
	for i, l := range locs {
		if best < 0 || t.Cuerpo[l[2]:l[3]] > t.Cuerpo[locs[best][2]:locs[best][3]] {
			best = i
		}
	}
	l := locs[best]
	fin := len(t.Cuerpo)
	if best+1 < len(locs) && locs[best+1][0] > l[1] {
		fin = locs[best+1][0]
	}
	if pub := rePublic.FindStringIndex(t.Cuerpo[l[1]:]); pub != nil && l[1]+pub[0] < fin {
		fin = l[1] + pub[0]
	}
	if sec := reSeccion.FindStringIndex(t.Cuerpo[l[1]:]); sec != nil && l[1]+sec[0] < fin {
		fin = l[1] + sec[0]
	}
	return t.Cuerpo[l[2]:l[3]], strings.TrimSpace(t.Cuerpo[l[1]:fin])
}

func preguntasVencidas(t tarea) []store.Anotacion {
	var out []store.Anotacion
	for _, a := range store.Anotaciones(t.privado()) {
		if a.Tipo != "pregunta" {
			continue
		}
		if f, err := time.ParseInLocation("2006-01-02", a.Fecha, time.Local); err == nil && time.Since(f).Hours()/24 > diasPregunta {
			out = append(out, a)
		}
	}
	return out
}

func pendientesAbiertos(t tarea) (abiertos []store.Pendiente, total int) {
	for _, p := range store.Pendientes(t.privado()) {
		total++
		if !p.Hecho {
			abiertos = append(abiertos, p)
		}
	}
	return
}

// ── el snapshot de ramas: la entrega ──

type ramaSnap struct {
	Repo string          `json:"repo"`
	Rama string          `json:"rama"`
	En   map[string]bool `json:"en"`
	PR   *struct {
		Numero int    `json:"numero"`
		Estado string `json:"estado"`
		Base   string `json:"base"`
	} `json:"pr"`
}

type snapRamas struct {
	MedidoEn string `json:"medidoEn"`
	Tareas   map[string]struct {
		Ramas []ramaSnap `json:"ramas"`
	} `json:"tareas"`
	Incompletas []string `json:"incompletas"`
}

func leerSnap(datos string) snapRamas {
	var s snapRamas
	b, err := os.ReadFile(filepath.Join(datos, "cache", "ramas.json"))
	if err == nil {
		_ = json.Unmarshal(b, &s)
	}
	return s
}

// entrega resume las ramas de una tarea en una línea: «4 ramas · 2 en main · 1 PR abierto → qa».
func entrega(s snapRamas, id int) string {
	t, ok := s.Tareas[strconv.Itoa(id)]
	if !ok || len(t.Ramas) == 0 {
		return ""
	}
	enMain, abiertos := 0, map[string]int{}
	for _, r := range t.Ramas {
		if r.En["main"] {
			enMain++
		}
		if r.PR != nil && r.PR.Estado == "OPEN" {
			abiertos[r.PR.Base]++
		}
	}
	out := fmt.Sprintf("%d rama(s) · %d en main", len(t.Ramas), enMain)
	if len(abiertos) > 0 {
		var partes []string
		for base, n := range abiertos {
			partes = append(partes, fmt.Sprintf("%d PR abierto(s) → %s", n, base))
		}
		sort.Strings(partes)
		out += " · " + strings.Join(partes, ", ")
	}
	return out
}

// ── la bitácora ──

type entrada struct {
	Day       string `json:"day"`
	Minutes   int    `json:"minutes"`
	EffortID  int    `json:"effortId"`
	FreeTitle string `json:"freeTitle"`
}

func bitacoraDe(datos string, id int) []entrada {
	var out []entrada
	rutas, _ := filepath.Glob(filepath.Join(datos, "entries", "*.jsonl"))
	for _, r := range rutas {
		b, _ := os.ReadFile(r)
		for _, l := range strings.Split(string(b), "\n") {
			var e entrada
			if strings.TrimSpace(l) != "" && json.Unmarshal([]byte(l), &e) == nil && e.EffortID == id {
				out = append(out, e)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Day > out[j].Day })
	return out
}

func corta(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

func main() {
	var (
		una      = flag.String("n", "", "retomar UNA tarea, por id o slug (acepta subcadena del slug)")
		stage    = flag.String("stage", "", "sólo esta etapa (work · evaluation · tasks)")
		comoJSON = flag.Bool("json", false, "salida en JSON")
	)
	flag.Parse()
	datos := dirDatos()

	sucios := map[string]bool{}
	for _, l := range strings.Split(git(datos, "status", "--porcelain", "--", "."), "\n") {
		if len(l) > 3 {
			sucios[filepath.Base(strings.TrimSpace(l[3:]))] = true
		}
	}
	rutas, _ := filepath.Glob(filepath.Join(datos, "*.md"))
	var tareas []tarea
	for _, r := range rutas {
		tareas = append(tareas, leer(datos, r, sucios))
	}
	snap := leerSnap(datos)

	if *una != "" {
		os.Exit(retomar(datos, tareas, snap, *una, *comoJSON))
	}
	os.Exit(agenda(tareas, snap, *stage, *comoJSON))
}

type fila struct {
	ID            int      `json:"id"`
	Slug          string   `json:"slug"`
	Title         string   `json:"title"`
	Stage         string   `json:"stage"`
	Dias          int      `json:"diasSinTocar"`
	ProximoPaso   string   `json:"proximoPaso"`
	Entrega       string   `json:"entrega"`
	Vencidas      []string `json:"preguntasVencidas"`
	Pendientes    int      `json:"pendientes"`
	Dormida       bool     `json:"dormida"`
	SugerirCierre bool     `json:"sugerirArchivar"`
}

func agenda(tareas []tarea, snap snapRamas, stage string, comoJSON bool) int {
	var filas []fila
	for _, t := range tareas {
		if t.Archived || (stage != "" && t.Stage != stage) {
			continue
		}
		f := fila{ID: t.ID, Slug: t.Slug, Title: t.Title, Stage: t.Stage, Dias: t.dias(),
			ProximoPaso: t.proximoPaso(), Entrega: entrega(snap, t.ID)}
		for _, a := range preguntasVencidas(t) {
			q := a.Quien
			if q == "" {
				q = "¿a quién?"
			}
			f.Vencidas = append(f.Vencidas, fmt.Sprintf("%s · %s — %s", a.Fecha, q, corta(a.Que, 90)))
		}
		ab, _ := pendientesAbiertos(t)
		f.Pendientes = len(ab)
		f.Dormida = f.Dias >= diasDormida
		f.SugerirCierre = f.Dias >= diasArchivar
		filas = append(filas, f)
	}
	sort.Slice(filas, func(i, j int) bool {
		if filas[i].Dias != filas[j].Dias {
			return filas[i].Dias < filas[j].Dias
		}
		return filas[i].ID > filas[j].ID
	})
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(filas)
		return 0
	}

	var vivas, dormidas []fila
	nVenc, nPend, nWork := 0, 0, 0
	for _, f := range filas {
		nVenc += len(f.Vencidas)
		nPend += f.Pendientes
		if f.Stage == "work" {
			nWork++
		}
		if f.Dormida {
			dormidas = append(dormidas, f)
		} else {
			vivas = append(vivas, f)
		}
	}
	fmt.Printf("\n  hoy · %s · %d abiertas (%d en work) · %d dormidas (≥%d días sin tocar) · %d pregunta(s) vencida(s) · %d pendiente(s)\n",
		time.Now().Format("2006-01-02"), len(filas), nWork, len(dormidas), diasDormida, nVenc, nPend)
	if snap.MedidoEn != "" {
		fmt.Printf("  entrega según `make tareas-ramas` del %s", snap.MedidoEn[:10])
		if len(snap.Incompletas) > 0 {
			fmt.Printf(" ⚠ incompleto (%d sin medir)", len(snap.Incompletas))
		}
		fmt.Println()
	}

	fmt.Printf("\n  EN MOVIMIENTO — tocadas hace menos de %d días\n", diasDormida)
	for _, f := range vivas {
		imprimirFila(f, true)
	}
	if len(dormidas) > 0 {
		fmt.Printf("\n  DORMIDAS — %d días o más sin tocar. A los %d conviene archivar, o anotar por qué espera\n", diasDormida, diasArchivar)
		for _, f := range dormidas {
			imprimirFila(f, false)
		}
	}
	fmt.Println()
	return 0
}

func imprimirFila(f fila, detalle bool) {
	cuando := fmt.Sprintf("%d d", f.Dias)
	if f.Dias == 0 {
		cuando = "hoy"
	}
	marca := ""
	if f.SugerirCierre {
		marca = "  ⏸ ¿archivar?"
	}
	fmt.Printf("  #%-3d %-10s %-5s %s%s\n", f.ID, f.Stage, cuando, corta(f.Title, 70), marca)
	if f.Entrega != "" {
		fmt.Printf("       ↳ %s\n", f.Entrega)
	}
	if !detalle {
		return
	}
	if f.ProximoPaso != "" {
		fmt.Printf("       → %s\n", corta(f.ProximoPaso, 110))
	} else {
		fmt.Printf("       ✗ sin «El próximo paso es»\n")
	}
	for _, v := range f.Vencidas {
		fmt.Printf("       ⏰ pregunta vencida · %s\n", v)
	}
	if f.Pendientes > 0 {
		fmt.Printf("       ☐ %d pendiente(s)\n", f.Pendientes)
	}
}

func retomar(datos string, tareas []tarea, snap snapRamas, ref string, comoJSON bool) int {
	var t *tarea
	for i := range tareas {
		if tareas[i].Slug == ref || strconv.Itoa(tareas[i].ID) == ref {
			t = &tareas[i]
			break
		}
	}
	if t == nil {
		for i := range tareas {
			if strings.Contains(strings.ToLower(tareas[i].Slug), strings.ToLower(ref)) {
				t = &tareas[i]
				break
			}
		}
	}
	if t == nil {
		fmt.Fprintf(os.Stderr, "no hay tarea que matchee %q. `make tareas` las lista.\n", ref)
		return 2
	}
	retoma, prox := t.retoma(), t.proximoPaso()
	regFecha, regBloque := t.ultimoRegistro()
	vencidas := preguntasVencidas(*t)
	pend, totalPend := pendientesAbiertos(*t)
	bit := bitacoraDe(datos, t.ID)
	var faltan []string
	if retoma == "" {
		faltan = append(faltan, "la sección «Si retomás esto sin contexto» — es la que se lee primero, y no está")
	}
	if prox == "" {
		faltan = append(faltan, "«**El próximo paso es:**» — UNA acción")
	}
	if regFecha == "" {
		faltan = append(faltan, "un Registro con fecha (`### YYYY-MM-DD`)")
	}
	if len(t.Ramas) == 0 && t.Stage == "work" {
		faltan = append(faltan, "`ramas:` en el frontmatter — sin eso no se mide hasta dónde llegó")
	}
	if len(bit) == 0 {
		faltan = append(faltan, "bitácora: ninguna entrada apunta a esta tarea")
	}

	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"id": t.ID, "slug": t.Slug, "title": t.Title, "stage": t.Stage, "diasSinTocar": t.dias(),
			"retoma": retoma, "proximoPaso": prox, "registroFecha": regFecha, "registro": regBloque,
			"entrega": entrega(snap, t.ID), "ramas": snap.Tareas[strconv.Itoa(t.ID)].Ramas,
			"preguntasVencidas": vencidas, "pendientes": pend, "bitacora": bit, "faltan": faltan,
		})
		return 0
	}

	fmt.Printf("\n  #%d · %s\n  %s · %s · tocada hace %d día(s) · creada %s\n", t.ID, t.Title, t.Slug, t.Stage, t.dias(), strings.SplitN(t.Created+"T", "T", 2)[0])
	if len(t.Jira) > 0 || len(t.Nodos) > 0 {
		fmt.Printf("  jira: %s · nodos de context: %s\n", strings.Join(t.Jira, ", "), strings.Join(t.Nodos, ", "))
	}
	fmt.Printf("  archivo: %s\n", t.Ruta)

	fmt.Println("\n  ── Si retomás esto sin contexto ──")
	if retoma == "" {
		fmt.Println("  ✗ no existe")
	} else {
		fmt.Println("  " + strings.ReplaceAll(retoma, "\n", "\n  "))
	}
	fmt.Println("\n  ── El próximo paso es ──")
	if prox == "" {
		fmt.Println("  ✗ no está")
	} else {
		fmt.Println("  → " + prox)
	}

	fmt.Print("\n  ── Ramas y entrega")
	if snap.MedidoEn != "" {
		fmt.Printf(" (snapshot del %s)", snap.MedidoEn[:10])
	}
	fmt.Println(" ──")
	rs := snap.Tareas[strconv.Itoa(t.ID)].Ramas
	switch {
	case len(t.Ramas) == 0:
		fmt.Println("  ✗ la tarea no declara `ramas:`")
	case len(rs) == 0:
		fmt.Println("  · sin ramas medidas — corré `make tareas-ramas N=" + strconv.Itoa(t.ID) + "`")
	default:
		for _, r := range rs {
			var en []string
			for _, amb := range []string{"develop", "staging", "qa", "main"} {
				if r.En[amb] {
					en = append(en, amb)
				}
			}
			pr := "sin PR"
			if r.PR != nil {
				pr = fmt.Sprintf("PR #%d %s → %s", r.PR.Numero, r.PR.Estado, r.PR.Base)
			}
			donde := "en ningún ambiente"
			if len(en) > 0 {
				donde = "en " + strings.Join(en, ", ")
			}
			fmt.Printf("  %-20s %-52s %s · %s\n", r.Repo, corta(r.Rama, 52), donde, pr)
		}
	}

	if len(vencidas) > 0 {
		fmt.Println("\n  ── Preguntas vencidas (más de 7 días sin respuesta) ──")
		for _, a := range vencidas {
			q := a.Quien
			if q == "" {
				q = "¿a quién?"
			}
			fmt.Printf("  ⏰ %s · %s — %s\n", a.Fecha, q, corta(a.Que, 120))
		}
	}
	if len(pend) > 0 {
		fmt.Printf("\n  ── Pendientes (%d de %d abiertos) ──\n", len(pend), totalPend)
		for i, p := range pend {
			if i == 10 {
				fmt.Printf("  … y %d más\n", len(pend)-10)
				break
			}
			fmt.Printf("  ☐ %s\n", corta(p.Que, 110))
		}
	}

	fmt.Println("\n  ── Último Registro ──")
	if regFecha == "" {
		fmt.Println("  ✗ no hay entradas `### YYYY-MM-DD`")
	} else {
		fmt.Printf("  %s\n  %s\n", regFecha, strings.ReplaceAll(corta(regBloque, 900), "\n", "\n  "))
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
			fmt.Printf("  %s  %4d′  %s\n", e.Day, e.Minutes, corta(e.FreeTitle, 80))
		}
	}

	if len(faltan) > 0 {
		fmt.Println("\n  ── Faltan ──")
		for _, f := range faltan {
			fmt.Println("  ✗ " + f)
		}
	}
	fmt.Println()
	return 0
}
