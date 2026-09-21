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
//	hoy -n … -brief 1 …y al final la FICHA de cada tema de canon que la tarea declara, sin abrir su context.md.
//	                   Es un APOYO: decide qué tema se abre, no reemplaza leerlo — y va opt-in porque una
//	                   tarea llega a declarar 9.
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
	Slug, Title, Stage, Clase, Created, Ruta string
	ID                                       int
	Archived                                 bool
	Ramas                                    []string
	Jira, Nodos                              []string
	Cuerpo                                   string
	Toque                                    time.Time // último cambio del archivo (git; hoy si está sucio)
}

var (
	reCita  = regexp.MustCompile(`^["']|["']$`)
	reLista = regexp.MustCompile(`\[(.*?)\]`)
	// ⚠ INSENSIBLE A MAYÚSCULAS Y CON NUMERACIÓN OPCIONAL. La tarea de Bancolombia titula su sección
	// «## 0 · SI RETOMÁS ESTO SIN CONTEXTO, EMPEZÁ ACÁ» y el patrón exacto no la veía: el cierre
	// reclamaba «la sección no existe» sobre una tarea que la tiene desde julio. Un chequeo que
	// contesta «no hay» cuando no supo buscar es peor que no tenerlo (2026-09-15).
	reRetoma  = regexp.MustCompile(`(?mi)^##\s+[0-9.·\s]*si retom[áa]s[^\n]*\n`)
	reSeccion = regexp.MustCompile(`(?m)^##\s`)
	reProximo = regexp.MustCompile(`(?is)\*\*El pr[óo]ximo paso es:?\*\*\s*(.*?)(?:\n\s*\n|\n##|\z)`)
	reRegDia  = regexp.MustCompile(`(?m)^###\s+(\d{4}-\d{2}-\d{2})[^\n]*\n`)
	rePublic  = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
	// «Bitácora» es como llaman al Registro las tareas viejas: mirar sólo «Registro» contaba su diario
	// entero como estado y las dejaba arriba del ranking por un nombre.
	reRegistro      = regexp.MustCompile(`(?m)^##\s+(Registro|Bit[áa]cora)\s*$`)
	reSecc          = regexp.MustCompile(`(?m)^#{2,4}\s+(.*)$`)
	reFechaEnTitulo = regexp.MustCompile(`20\d\d-\d\d-\d\d`)
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
			case strings.HasPrefix(l, "clase:"):
				t.Clase = valor(l)
			case strings.HasPrefix(l, "created:"):
				t.Created = valor(l)
			case strings.HasPrefix(l, "archived:"):
				v := valor(l)
				t.Archived = v != "" && v != "false" && v != "null"
			case strings.HasPrefix(l, "jira:"):
				t.Jira = lista(l)
			case strings.HasPrefix(l, "canon:"):
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

func requiereRamas(t tarea) bool {
	// Los contenedores locales agrupan mejoras sucesivas y pueden no tener una rama activa. Una tarea
	// de producto en work sí debe declarar por dónde se entrega.
	return t.Stage == "work" && t.Clase != "proyecto"
}

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
		anatomia = flag.Bool("anatomia", false, "cómo está repartido el archivo de cada tarea, y qué sección parece estar en el lugar equivocado")
		comoJSON = flag.Bool("json", false, "salida en JSON")
		brief    = flag.String("brief", "", "al final, la ficha de los nodos de context declarados, sin abrir sus docs: 1 = los declarados (hasta 4) · a,b = sólo esos")
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

	if *anatomia {
		os.Exit(verAnatomia(datos, tareas, *una))
	}
	if *una != "" {
		os.Exit(retomar(datos, tareas, snap, *una, *comoJSON, *brief))
	}
	os.Exit(agenda(tareas, snap, *stage, *comoJSON))
}

type fila struct {
	ID            int      `json:"id"`
	Slug          string   `json:"slug"`
	Title         string   `json:"title"`
	Stage         string   `json:"stage"`
	Clase         string   `json:"clase"`
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
		f := fila{ID: t.ID, Slug: t.Slug, Title: t.Title, Stage: t.Stage, Clase: t.Clase, Dias: t.dias(),
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

	var vivas, dormidas, proyectos []fila
	nVenc, nPend, nWork := 0, 0, 0
	for _, f := range filas {
		nVenc += len(f.Vencidas)
		nPend += f.Pendientes
		// LOS CONTENEDORES LOCALES VAN APARTE. Son seis herramientas y playground: no son el día a día
		// comprometido en Jira y mezclarlos ahoga lo que alguien del equipo está esperando. Se listan
		// igual, abajo y sin detalle: se retoman con `make retomar`.
		if f.Clase == "proyecto" {
			proyectos = append(proyectos, f)
			continue
		}
		if f.Stage == "work" {
			nWork++
		}
		if f.Dormida {
			dormidas = append(dormidas, f)
		} else {
			vivas = append(vivas, f)
		}
	}
	fmt.Printf("\n  hoy · %s · %d tarea(s) (%d en work) · %d dormidas (≥%d días sin tocar) · %d contenedor(es) local(es) · %d pregunta(s) vencida(s) · %d pendiente(s)\n",
		time.Now().Format("2006-01-02"), len(filas)-len(proyectos), nWork, len(dormidas), diasDormida, len(proyectos), nVenc, nPend)
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
	if len(proyectos) > 0 {
		fmt.Println("\n  CONTENEDORES LOCALES — una tarea por herramienta y playground para lo transversal. No van a Jira")
		for _, f := range proyectos {
			cuando := fmt.Sprintf("%d d", f.Dias)
			if f.Dias == 0 {
				cuando = "hoy"
			}
			fmt.Printf("  #%-3d %-10s %-5s %s\n", f.ID, f.Stage, cuando, corta(f.Title, 70))
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

// ── anatomía: cómo está repartido el archivo ────────────────────────────────────────────────────

// CINCO COSAS VIVEN EN UN ARCHIVO DE TAREA, y sólo tres tienen nombre propio hoy. La medición del
// 2026-09-15 sobre las 40 abiertas: la mediana pesa 16 KB y está sana, pero 11 pasan de 40 KB y 6 de
// 80 — y las grandes no son grandes por el Registro (que es append-only a propósito), sino porque el
// ESTADO se volvió un diario: 91 de sus 621 secciones llevan fecha, y en la peor son 21 de 72.
//
//	1 ESTADO      dónde estoy hoy        → se REESCRIBE      «Si retomás esto sin contexto»
//	2 PLAN        objetivo, cómo se ataca → se REESCRIBE      «Objetivo» · «Cómo se ataca» · «Lo que se evaluó»
//	3 MATERIAL    recetas, consultas, datos de prueba, esquemas → se MANTIENE (se corrige, no se apila)
//	4 REGISTRO    qué pasó ese día       → se APILA          «Registro»
//	5 CONOCIMIENTO cómo funciona el sistema → GRADÚA a context/
//
// Lo que se apila en el estado casi siempre es 4 disfrazado de 3. ⚠ Pero tener fecha NO alcanza para
// condenar una sección: «Cómo se prueba, de cero (verificado el 2026-08-20)» es MATERIAL vigente y la
// fecha dice cuándo se comprobó. El test que sí discrimina es el mismo del repo: **si esto se mergea
// mañana, ¿sigue siendo cierto?** Por eso acá no se mueve nada solo — se señala para que alguien mire.
const (
	kbIncomodo = 40 // por encima, una tarea deja de retomarse leyéndola entera
	kbGrave    = 80
)

func verAnatomia(datos string, tareas []tarea, ref string) int {
	type fila struct {
		t                        tarea
		kb, secs, fechadas, dias int
		pEstado, pReg, pPub      int
		ejemplos                 []string
	}
	var filas []fila
	for _, t := range tareas {
		if t.Archived {
			continue
		}
		if ref != "" && t.Slug != ref && strconv.Itoa(t.ID) != ref && !strings.Contains(strings.ToLower(t.Slug), strings.ToLower(ref)) {
			continue
		}
		b, err := os.ReadFile(t.Ruta)
		if err != nil {
			continue
		}
		total := len(b)
		f := fila{t: t, kb: total / 1024}
		iReg := len(t.Cuerpo)
		if m := reRegistro.FindStringIndex(t.Cuerpo); m != nil {
			iReg = m[0]
		}
		iPub := len(t.Cuerpo)
		if m := rePublic.FindStringIndex(t.Cuerpo); m != nil {
			iPub = m[0]
		}
		finReg := iPub
		if finReg < iReg {
			finReg = len(t.Cuerpo)
		}
		cl := len(t.Cuerpo)
		if cl == 0 {
			cl = 1
		}
		f.pEstado, f.pReg, f.pPub = iReg*100/cl, (finReg-iReg)*100/cl, (len(t.Cuerpo)-iPub)*100/cl
		f.dias = len(reRegDia.FindAllString(t.Cuerpo, -1))
		for _, m := range reSecc.FindAllStringSubmatch(t.Cuerpo[:iReg], -1) {
			f.secs++
			if reFechaEnTitulo.MatchString(m[1]) {
				f.fechadas++
				if len(f.ejemplos) < 4 {
					f.ejemplos = append(f.ejemplos, strings.TrimSpace(m[1]))
				}
			}
		}
		filas = append(filas, f)
	}
	if len(filas) == 0 {
		fmt.Fprintln(os.Stderr, "no encontré esa tarea")
		return 2
	}
	sort.Slice(filas, func(i, j int) bool {
		if filas[i].fechadas != filas[j].fechadas {
			return filas[i].fechadas > filas[j].fechadas
		}
		return filas[i].kb > filas[j].kb
	})

	fmt.Printf("\n  ANATOMÍA · qué hay dentro del archivo de cada tarea, y qué parece estar fuera de lugar\n")
	fmt.Printf("  Un archivo tiene ESTADO (se reescribe) · MATERIAL (se mantiene) · REGISTRO (se apila) ·\n")
	fmt.Printf("  y lo que es CONOCIMIENTO gradúa a context/. Más de %d KB ya cuesta retomarlo leyéndolo.\n\n", kbIncomodo)
	for _, f := range filas {
		marca := " "
		switch {
		case f.kb >= kbGrave:
			marca = "🔴"
		case f.kb >= kbIncomodo:
			marca = "🟠"
		}
		fmt.Printf("  %s #%-3d %-44s %3d KB · %2d secciones · estado %d%% / registro %d%% (%d día(s))\n",
			marca, f.t.ID, corta(f.t.Slug, 44), f.kb, f.secs, f.pEstado, f.pReg, f.dias)
		if f.fechadas > 0 {
			fmt.Printf("        ⚠ %d sección(es) con fecha DENTRO del estado — mirá si son hechos de un día (→ Registro)\n", f.fechadas)
			for _, e := range f.ejemplos {
				fmt.Printf("           · %s\n", corta(e, 86))
			}
			fmt.Printf("           el test: si esto se mergea mañana, ¿sigue siendo cierto? sí → queda (o gradúa a context/); no → Registro\n")
		}
		if f.kb >= kbIncomodo && f.pReg > 50 {
			fmt.Printf("        · el Registro es el %d%%: es append-only a propósito, pero a este tamaño conviene cerrar el mes viejo\n", f.pReg)
		}
	}
	fmt.Println()
	return 0
}

// fichaCanon es lo que `-brief` agrega al final de la retoma: lo que un TEMA de canon DECLARA sobre
// sí mismo, leído de su `map.json`.
//
// ⚠ NO SE LE PIDE A UN MODELO, Y ESE ES EL CAMBIO. Hasta el 2026-09-21 la ficha era un resumen que
// generaba Jev sobre el doc de un nodo de `context/`: costaba una llamada, tardaba, y podía decir algo
// que el doc no dijera. Un tema de canon ya viene con el resumen ESCRITO A MANO —`title`, `summary`, y
// el `objetivo` de cada área, que es literalmente «qué contesta esta parte»—, así que la ficha se
// DERIVA. Sale gratis, es instantánea, y no puede inventar. Medido ese día: la ficha de `kyc` pesa
// 3.593 bytes contra 31.388 de su `context.md` (8,7×), y la de la versión con modelo pesaba 5.074.
type fichaCanon struct {
	Tema      string      `json:"topic"`
	Declarado bool        `json:"declared"`
	Titulo    string      `json:"title,omitempty"`
	Resumen   string      `json:"summary,omitempty"`
	Areas     []areaCanon `json:"areas,omitempty"`
	Tablas    []string    `json:"tables,omitempty"`
	Repos     []string    `json:"repos,omitempty"`
	Error     string      `json:"error,omitempty"`
}

type areaCanon struct {
	ID        string `json:"id"`
	Objetivo  string `json:"objetivo"`
	Secciones int    `json:"secciones"`
}

const topeFichas = 4

// fichasCanon decide QUÉ temas van y se los pide a `leer`, sin interpretar la respuesta.
// `pedido` es el valor de BRIEF=: «1» son los declarados por la tarea, en su orden y hasta el tope
// —una tarea llega a declarar 9, y nueve fichas pesan más que el documento que se quería no abrir—;
// «a,b» son esos, estén declarados o no (y se marca cuando no). Un error de `leer` se DEVUELVE en su
// ficha, nunca se calla: una ficha que falta se lee igual que un tema que no existe.
func fichasCanon(declarados []string, pedido string, leer func(tema string) (fichaCanon, error)) (fichas []fichaCanon, aviso string) {
	es := map[string]bool{}
	for _, n := range declarados {
		es[n] = true
	}
	temas := declarados
	if pedido != "1" {
		temas = nil
		for _, n := range strings.Split(pedido, ",") {
			if n = strings.TrimSpace(n); n != "" {
				temas = append(temas, n)
			}
		}
	} else if len(temas) > topeFichas {
		aviso = fmt.Sprintf("… y %d más (%s) — BRIEF=a,b elige cuáles", len(temas)-topeFichas, strings.Join(temas[topeFichas:], ", "))
		temas = temas[:topeFichas]
	}
	for _, n := range temas {
		f, err := leer(n)
		f.Tema, f.Declarado = n, es[n]
		if err != nil {
			f.Error = err.Error()
		}
		fichas = append(fichas, f)
	}
	return fichas, aviso
}

// canonContenido es dónde vive el corpus compartido en disco. Se puede mover con `CANON_CONTENIDO`,
// el mismo nombre que ya usan las otras herramientas que lo leen.
func canonContenido() string {
	if v := strings.TrimSpace(os.Getenv("CANON_CONTENIDO")); v != "" {
		return v
	}
	casa, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(casa, "Desktop", "CREDITOP", "github", "playground", "tools", "canon", "content")
}

// fichaDeCanon lee el `map.json` de un tema. Es sólo disco: no levanta el servidor de canon ni sale a
// la red, así que una retoma funciona igual sin conexión y sin nada corriendo.
func fichaDeCanon(contenido string) func(string) (fichaCanon, error) {
	return func(tema string) (fichaCanon, error) {
		if contenido == "" {
			return fichaCanon{}, fmt.Errorf("no sé dónde está el corpus (pasá CANON_CONTENIDO)")
		}
		crudo, err := os.ReadFile(filepath.Join(contenido, tema, "map.json"))
		if err != nil {
			return fichaCanon{}, fmt.Errorf("el tema no está en %s", contenido)
		}
		var m struct {
			Title   string `json:"title"`
			Summary string `json:"summary"`
			Areas   []struct {
				ID        string              `json:"id"`
				Objetivo  string              `json:"objetivo"`
				Secciones []string            `json:"secciones"`
				Tablas    []string            `json:"tablas"`
				Fuentes   map[string]struct{} `json:"-"`
				FuentesJS json.RawMessage     `json:"fuentes"`
			} `json:"areas"`
		}
		if err := json.Unmarshal(crudo, &m); err != nil {
			return fichaCanon{}, fmt.Errorf("map.json ilegible: %v", err)
		}
		f := fichaCanon{Titulo: m.Title, Resumen: m.Summary}
		tablas, repos := map[string]bool{}, map[string]bool{}
		for _, a := range m.Areas {
			f.Areas = append(f.Areas, areaCanon{ID: a.ID, Objetivo: a.Objetivo, Secciones: len(a.Secciones)})
			for _, t := range a.Tablas {
				tablas[t] = true
			}
			var porRepo map[string]json.RawMessage
			if len(a.FuentesJS) > 0 {
				_ = json.Unmarshal(a.FuentesJS, &porRepo)
			}
			for r := range porRepo {
				repos[r] = true
			}
		}
		f.Tablas, f.Repos = ordenadas(tablas), ordenadas(repos)
		return f, nil
	}
}

func ordenadas(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func retomar(datos string, tareas []tarea, snap snapRamas, ref string, comoJSON bool, brief string) int {
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
	if len(t.Ramas) == 0 && requiereRamas(*t) {
		faltan = append(faltan, "`ramas:` en el frontmatter — sin eso no se mide hasta dónde llegó")
	}
	if len(bit) == 0 {
		faltan = append(faltan, "bitácora: ninguna entrada apunta a esta tarea")
	}
	var fichas []fichaCanon
	var fichasAviso string
	if brief != "" {
		fichas, fichasAviso = fichasCanon(t.Nodos, brief, fichaDeCanon(canonContenido()))
	}

	if comoJSON {
		salida := map[string]any{
			"id": t.ID, "slug": t.Slug, "title": t.Title, "stage": t.Stage, "diasSinTocar": t.dias(),
			"retoma": retoma, "proximoPaso": prox, "registroFecha": regFecha, "registro": regBloque,
			"entrega": entrega(snap, t.ID), "ramas": snap.Tareas[strconv.Itoa(t.ID)].Ramas,
			"preguntasVencidas": vencidas, "pendientes": pend, "bitacora": bit, "faltan": faltan,
		}
		if brief != "" {
			salida["canon"], salida["canonAviso"] = fichas, fichasAviso
		}
		_ = json.NewEncoder(os.Stdout).Encode(salida)
		return 0
	}

	fmt.Printf("\n  #%d · %s\n  %s · %s · tocada hace %d día(s) · creada %s\n", t.ID, t.Title, t.Slug, t.Stage, t.dias(), strings.SplitN(t.Created+"T", "T", 2)[0])
	if len(t.Jira) > 0 || len(t.Nodos) > 0 {
		fmt.Printf("  jira: %s · temas de canon: %s\n", strings.Join(t.Jira, ", "), strings.Join(t.Nodos, ", "))
	}
	if len(t.Nodos) > 0 && brief == "" {
		fmt.Printf("  la ficha de cada tema, sin abrir su context.md: make retomar N=%d BRIEF=1\n", t.ID)
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
	case len(t.Ramas) == 0 && t.Clase == "proyecto":
		fmt.Println("  · contenedor local: no requiere una rama permanente")
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

	if brief != "" {
		fmt.Println("\n  ── Canon: lo que declara cada tema, sin abrir su context.md ──")
		if len(fichas) == 0 {
			fmt.Println("  ✗ la tarea no declara `canon:`. Para encontrar el tema de una pregunta nueva:")
			fmt.Println("    canon -pregunta '<la pregunta>'   (desde github/playground/tools/canon)")
		}
		for i, f := range fichas {
			if i > 0 {
				fmt.Println()
			}
			if !f.Declarado {
				fmt.Printf("  ⚠ %s no está en el `canon:` de la tarea\n", f.Tema)
			}
			if f.Error != "" {
				fmt.Printf("  ✗ %s: %s\n", f.Tema, f.Error)
				continue
			}
			fmt.Printf("  %s · %s\n", f.Tema, f.Titulo)
			if f.Resumen != "" {
				fmt.Println("  " + ajustar(f.Resumen, 96, "  "))
			}
			secs := 0
			for _, a := range f.Areas {
				secs += a.Secciones
			}
			fmt.Printf("  %d áreas · %d secciones", len(f.Areas), secs)
			if len(f.Repos) > 0 {
				fmt.Printf(" · %s", strings.Join(f.Repos, ", "))
			}
			if len(f.Tablas) > 0 {
				fmt.Printf("\n  tablas: %s", ajustar(strings.Join(f.Tablas, ", "), 92, "  "))
			}
			fmt.Println()
			// El `id` del área NO se imprime: en canon es un hash (`area-dda3b2591178`), así que
			// ocupaba media columna sin decir nada. Lo que nombra a un área es su `objetivo`.
			for _, a := range f.Areas {
				fmt.Printf("    · %s\n", ajustar(a.Objetivo, 92, "      "))
			}
		}
		if fichasAviso != "" {
			fmt.Println("  " + fichasAviso)
		}
		fmt.Println("  la ficha decide qué tema se abre; si ninguno contesta, la pregunta va a workers/ — no a otro tema")
	}
	fmt.Println()
	return 0
}

// ajustar parte un texto largo en renglones de a lo sumo `ancho` runas, sangrando los siguientes con
// `sangria`. Los `objetivo` de canon son frases de una o dos líneas y sin esto se salen de la
// terminal: el que lee pierde justo el final, que es donde suele estar la condición.
//
// ⚠ Cuenta RUNAS, no bytes. Los objetivos están en español —«decisión», «también», «qué»— y con
// `len()` una frase con diez tildes se corta diez caracteres antes de donde debería.
func ajustar(texto string, ancho int, sangria string) string {
	palabras := strings.Fields(texto)
	if len(palabras) == 0 {
		return ""
	}
	var b strings.Builder
	linea := 0
	for i, p := range palabras {
		n := len([]rune(p))
		switch {
		case i == 0:
			b.WriteString(p)
			linea = n
		case linea+1+n <= ancho:
			b.WriteString(" " + p)
			linea += 1 + n
		default:
			b.WriteString("\n" + sangria + p)
			linea = len([]rune(sangria)) + n
		}
	}
	return b.String()
}
