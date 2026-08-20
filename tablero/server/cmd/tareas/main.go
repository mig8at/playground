// Command tareas es el CLI del tablero: su propio dominio, sin levantar el server ni abrir la UI.
//
// POR QUÉ EXISTE. El store ya había resuelto la mitad —pasó de SQLite a archivos justamente porque
// «el tablero era el único rincón del playground que un modelo no puede leer sin levantar un
// server»— así que LEER una tarea ya funciona: es un `.md`. Lo que seguía atrás de la UI era todo lo
// demás: preguntar EN QUÉ SE ESTÁ TRABAJANDO obligaba a parsear 38 frontmatters a mano cada vez, y
// el GUARD —la regla de qué puede salir a Jira— sólo corría al publicar, cuando ya es tarde para
// decidir cómo escribir.
//
//	go run ./cmd/tareas                      las abiertas, con estado, Jira y nodos
//	go run ./cmd/tareas -todas               incluidas las archivadas
//	go run ./cmd/tareas -stage work          filtradas por etapa
//	go run ./cmd/tareas -n <slug|id>         una tarea: qué es PÚBLICO y qué es PRIVADO
//	go run ./cmd/tareas -guard <archivo>     ¿este texto puede salir a Jira? (sale 1 si no)
//	go run ./cmd/tareas -json                lo mismo, para encadenar
//
// El `-guard` reusa `internal/guard`, que es la fuente única: la UI compila esos mismos patrones y
// `issue-create` los aplica antes de publicar. Reimplementarlos acá habría sido la cuarta copia, y
// el propio paquete advierte que dos ya habrían derivado.
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

	"creditop/tablero/server/internal/guard"
)

// Tarea es lo que se puede saber de un `.md` SIN abrirlo entero: su frontmatter.
type Tarea struct {
	Slug     string   `json:"slug"`
	ID       int      `json:"id"`
	Title    string   `json:"title"`
	Stage    string   `json:"stage"`
	Archived bool     `json:"archived"`
	Jira     []string `json:"jira,omitempty"`
	Nodos    []string `json:"context_nodes,omitempty"`
	Archivo  string   `json:"archivo"`
}

var (
	reLista  = regexp.MustCompile(`\[(.*?)\]`)
	reCita   = regexp.MustCompile(`^["']|["']$`)
	rePublic = regexp.MustCompile(`(?m)^##\s+Tarea \(publicable\)\s*$`)
	// La mitad de QA de lo publicable. Los nombres NO son inventados: son los que ya usan las tareas
	// que la tienen bien (Ábaco, card de renting, codeudor, KYC del segundo apellido). Se buscan los
	// tres, y basta uno — imponer la plantilla completa haría fallar a una tarea chica que con «Cómo
	// validar» ya deja a QA sin preguntas.
	reQA = regexp.MustCompile(`(?im)^#{2,4}\s*(C[óo]mo validar|D[óo]nde probar|Criterios de aceptaci[óo]n|C[óo]mo se prueba)`)
)

func valor(linea string) string {
	_, v, _ := strings.Cut(linea, ":")
	return reCita.ReplaceAllString(strings.TrimSpace(v), "")
}

func lista(linea string) []string {
	m := reLista.FindStringSubmatch(linea)
	if m == nil || strings.TrimSpace(m[1]) == "" {
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

// leer saca el frontmatter. No parsea YAML de verdad a propósito: el frontmatter de una tarea es
// plano y conocido, y meter una dependencia para cinco claves sería pagar de más.
func leer(ruta string) (Tarea, string, error) {
	b, err := os.ReadFile(ruta)
	if err != nil {
		return Tarea{}, "", err
	}
	cuerpo := string(b)
	t := Tarea{Slug: strings.TrimSuffix(filepath.Base(ruta), ".md"), Archivo: ruta}
	partes := strings.SplitN(cuerpo, "---", 3)
	if len(partes) < 3 {
		return t, cuerpo, nil // sin frontmatter: se devuelve igual, con lo que se sepa
	}
	for _, l := range strings.Split(partes[1], "\n") {
		switch {
		case strings.HasPrefix(l, "id:"):
			t.ID, _ = strconv.Atoi(valor(l))
		case strings.HasPrefix(l, "title:"):
			t.Title = valor(l)
		case strings.HasPrefix(l, "stage:"):
			t.Stage = valor(l)
		case strings.HasPrefix(l, "archived:"):
			t.Archived = valor(l) == "true"
		case strings.HasPrefix(l, "jira:"):
			t.Jira = lista(l)
		case strings.HasPrefix(l, "context_nodes:"):
			t.Nodos = lista(l)
		}
	}
	return t, partes[2], nil
}

func dirDatos() string {
	// Se corre con `go run ./cmd/tareas` desde `server/`, así que `../data` es lo normal; pero
	// también se acepta desde la raíz del tablero, para que no importe desde dónde se lance.
	for _, d := range []string{"../data", "data", "tablero/data"} {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return d
		}
	}
	return "../data"
}

func todas() ([]Tarea, error) {
	rutas, err := filepath.Glob(filepath.Join(dirDatos(), "*.md"))
	if err != nil {
		return nil, err
	}
	var out []Tarea
	for _, r := range rutas {
		t, _, err := leer(r)
		if err == nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID > out[j].ID })
	return out, nil
}

// verGuard es el único modo que puede salir con código 1: se usa para DECIDIR antes de publicar, así
// que tiene que poder frenar un pipeline, no sólo informar.
func verGuard(ruta string, comoJSON bool) int {
	b, err := os.ReadFile(ruta)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	// Se mide LO QUE SALE, no el archivo entero. Si el archivo tiene su sección publicable, el guard va
	// sobre ESA: lo de arriba es privado y puede —debe— nombrar repos, rutas y F-xx.
	//
	// Medirlo todo daba falsos positivos con razón de sobra para ignorarlos: el 2026-08-20 marcó un
	// comentario HTML del Registro, que es privado y está bien que exista. Un guard que se equivoca en lo
	// legítimo entrena a saltear el que acierta.
	texto := string(b)
	alcance := "el archivo entero (no tiene sección publicable)"
	if loc := rePublic.FindStringIndex(texto); loc != nil {
		texto = strings.TrimSpace(texto[loc[1]:])
		alcance = "la sección `## Tarea (publicable)`"
	}

	v := guard.Violations(texto)
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"archivo": ruta, "alcance": alcance, "violaciones": v})
	} else if len(v) == 0 {
		fmt.Printf("  ✓ %s puede salir a Jira: %s no matchea ningún patrón prohibido\n", ruta, alcance)
	} else {
		fmt.Printf("  (medido sobre %s)\n", alcance)
		fmt.Printf("  ✗ %s NO puede salir — %d violación(es):\n", ruta, len(v))
		for _, x := range v {
			fmt.Printf("      %-46s encontró: %s\n", x["what"], x["found"])
		}
		fmt.Println("\n  (recordá: a Jira sólo salen `jira_title` y la sección `## Tarea (publicable)`)")
	}
	if len(v) > 0 {
		return 1
	}
	return 0
}

func verUna(ref string, comoJSON bool) int {
	ts, _ := todas()
	var elegida *Tarea
	for i, t := range ts {
		if t.Slug == ref || strconv.Itoa(t.ID) == ref || strings.Contains(strings.ToLower(t.Slug), strings.ToLower(ref)) {
			elegida = &ts[i]
			break
		}
	}
	if elegida == nil {
		fmt.Fprintf(os.Stderr, "no encontré una tarea que matchee %q. Corré sin -n para ver la lista.\n", ref)
		return 2
	}
	_, cuerpo, _ := leer(elegida.Archivo)
	// La frontera del repo hecha visible: lo de arriba de `## Tarea (publicable)` es PRIVADO y puede
	// nombrar repos, rutas y F-xx; lo de abajo es lo único que sale. Mostrarlas mezcladas es cómo se
	// publica sin querer algo que no debía salir.
	publico := ""
	if loc := rePublic.FindStringIndex(cuerpo); loc != nil {
		publico = strings.TrimSpace(cuerpo[loc[1]:])
	}
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
			"tarea": elegida, "privado": strings.TrimSpace(cuerpo), "publicable": publico})
		return 0
	}
	fmt.Printf("\n  #%d  %s\n  %s · %s%s\n", elegida.ID, elegida.Title, elegida.Slug, elegida.Stage,
		map[bool]string{true: " · ARCHIVADA"}[elegida.Archived])
	if len(elegida.Jira) > 0 {
		fmt.Printf("  jira: %s\n", strings.Join(elegida.Jira, ", "))
	}
	if len(elegida.Nodos) > 0 {
		fmt.Printf("  nodos de context: %s\n", strings.Join(elegida.Nodos, ", "))
	}
	fmt.Printf("\n  archivo: %s\n", elegida.Archivo)
	if publico == "" {
		fmt.Println("\n  ⚠ no tiene sección `## Tarea (publicable)`: no hay nada que se pueda mandar a Jira.")
	} else {
		fmt.Printf("\n  ── PUBLICABLE (%d chars, lo único que sale a Jira) ──\n", len(publico))
		v := guard.Violations(publico)
		if len(v) == 0 {
			fmt.Println("  ✓ pasa el guard")
		} else {
			fmt.Printf("  ✗ NO pasa el guard: %d violación(es) — corré -guard para el detalle\n", len(v))
		}
		// La OTRA mitad de lo publicable, que el guard no puede ver: la receta de prueba. El guard
		// contesta "¿esto puede salir?"; esto contesta "¿alcanza para que QA lo pruebe sin preguntar?".
		// Medido el 2026-08-19 sobre las 16 tareas de los últimos 4 sprints: ninguna publicable la tenía,
		// y los archivos que sí explican cómo probar lo hacen en el cuerpo PRIVADO, donde QA no entra.
		if !reQA.MatchString(publico) {
			fmt.Println("  ⚠ le falta la mitad de QA (`## Cómo validar` / `## Dónde probar` /")
			fmt.Println("    `## Criterios de aceptación`): así QA tiene que preguntar cómo verificarlo")
		}
	}
	fmt.Println("\n  (el cuerpo entero es PRIVADO: leelo del archivo, puede nombrar repos, rutas y F-xx)")
	return 0
}

// verSprint lee el SNAPSHOT de Jira que alimenta la UI (`data/cache/jira.json`).
//
// ⚠ Es una foto, no el estado vivo: cada fila trae su `seen_at` y acá se imprime, porque un tablero
// de sprint presentado como actual siendo de hace días es peor que no tenerlo — se decide sobre él.
// Para el dato fresco hay que pasar por Jira (el server al refrescar, o los `jira-*` del Makefile).
func verSprint(comoJSON bool) int {
	b, err := os.ReadFile(filepath.Join(dirDatos(), "cache", "jira.json"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "no hay snapshot de Jira todavía:", err)
		return 2
	}
	var d struct {
		Sprints []struct {
			ID     int    `json:"id"`
			Name   string `json:"name"`
			State  string `json:"state"`
			SeenAt string `json:"seen_at"`
		} `json:"sprints"`
		Tasks []struct {
			Key      string   `json:"key"`
			Summary  string   `json:"summary"`
			Status   string   `json:"status"`
			Category string   `json:"category"`
			Points   *float64 `json:"points"`
			SprintID int      `json:"sprint_id"`
			SeenAt   string   `json:"seen_at"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(b, &d); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 2
	}
	activo, nombre, visto := 0, "", ""
	for _, s := range d.Sprints {
		if s.State == "active" {
			activo, nombre, visto = s.ID, s.Name, s.SeenAt
		}
	}
	var enSprint []int
	for i, t := range d.Tasks {
		if t.SprintID == activo {
			enSprint = append(enSprint, i)
		}
	}
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"sprint": nombre, "sprint_id": activo,
			"seen_at": visto, "tareas": d.Tasks})
		return 0
	}
	if activo == 0 {
		fmt.Println("\n  no hay sprint activo en el snapshot")
		return 0
	}
	fmt.Printf("\n  %s  (#%d)\n  ⚠ SNAPSHOT tomado %s — no es el estado vivo de Jira\n\n", nombre, activo, visto)
	puntos := 0.0
	for _, i := range enSprint {
		t := d.Tasks[i]
		p := ""
		if t.Points != nil {
			p = fmt.Sprintf("%.0f pt", *t.Points)
			puntos += *t.Points
		}
		fmt.Printf("  %-10s %-6s %-22s %s\n", t.Key, p, t.Status, t.Summary)
	}
	fmt.Printf("\n  %d tarea(s) · %.0f puntos\n", len(enSprint), puntos)
	return 0
}

// verBitacora lee `data/entries/*.jsonl` — el tiempo registrado, que es dato PERSONAL y está fuera
// de git a propósito. Se agrupa por día porque la pregunta real es «¿en qué se fue el día?», no el
// listado de asientos.
func verBitacora(dias int, comoJSON bool) int {
	rutas, _ := filepath.Glob(filepath.Join(dirDatos(), "entries", "*.jsonl"))
	type entrada struct {
		Day       string `json:"day"`
		TaskKey   string `json:"taskKey"`
		FreeTitle string `json:"freeTitle"`
		Minutes   int    `json:"minutes"`
		Note      string `json:"note"`
		Kind      string `json:"kind"`
	}
	var todas []entrada
	for _, r := range rutas {
		b, err := os.ReadFile(r)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(string(b), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var e entrada
			if json.Unmarshal([]byte(l), &e) == nil {
				todas = append(todas, e)
			}
		}
	}
	sort.Slice(todas, func(i, j int) bool { return todas[i].Day > todas[j].Day })
	porDia := map[string][]entrada{}
	var orden []string
	for _, e := range todas {
		if _, ok := porDia[e.Day]; !ok {
			orden = append(orden, e.Day)
		}
		porDia[e.Day] = append(porDia[e.Day], e)
	}
	if dias > 0 && len(orden) > dias {
		orden = orden[:dias]
	}
	if comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(todas)
		return 0
	}
	fmt.Printf("\n  bitácora · %d asiento(s) en %d día(s)\n", len(todas), len(porDia))
	for _, d := range orden {
		tot := 0
		for _, e := range porDia[d] {
			tot += e.Minutes
		}
		fmt.Printf("\n  %s — %dh %02dm\n", d, tot/60, tot%60)
		for _, e := range porDia[d] {
			qué := e.TaskKey
			if qué == "" {
				qué = e.FreeTitle
			}
			// La nota se RECORTA acá y no en el dato: son párrafos enteros —el registro de esfuerzo
			// se escribe en prosa— y sin recortar la vista es ilegible. `-json` la devuelve completa,
			// que es la forma en que la quiere un modelo.
			// ⚠ Se corta por RUNAS, no por bytes. `n[:96]` parte un carácter multibyte por la mitad
			// y saca un `�` — y en español pasa casi siempre, porque las tildes y la ñ son de
			// dos bytes. Un recorte que rompe el texto que venía a hacer legible.
			r := []rune(strings.Join(strings.Fields(e.Note), " "))
			n := string(r)
			if len(r) > 96 {
				n = string(r[:96]) + "…"
			}
			fmt.Printf("      %3dm  %-34.34s  %s\n", e.Minutes, qué, n)
		}
	}
	return 0
}

func main() {
	var (
		una      = flag.String("n", "", "una tarea, por slug o por id (acepta subcadena del slug)")
		guardar  = flag.String("guard", "", "¿el texto de este archivo puede salir a Jira? sale 1 si no")
		stage    = flag.String("stage", "", "filtrar por etapa (p. ej. work)")
		conTodas = flag.Bool("todas", false, "incluir las archivadas")
		sprint   = flag.Bool("sprint", false, "el sprint activo, del snapshot de Jira (dice cuándo se tomó)")
		bitacora = flag.Int("bitacora", 0, "el tiempo registrado, agrupado por día: cuántos días mirar")
		comoJSON = flag.Bool("json", false, "salida en JSON")
	)
	flag.Parse()

	if *guardar != "" {
		os.Exit(verGuard(*guardar, *comoJSON))
	}
	if *sprint {
		os.Exit(verSprint(*comoJSON))
	}
	if *bitacora > 0 {
		os.Exit(verBitacora(*bitacora, *comoJSON))
	}
	if *una != "" {
		os.Exit(verUna(*una, *comoJSON))
	}

	ts, err := todas()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	var vis []Tarea
	for _, t := range ts {
		if !*conTodas && t.Archived {
			continue
		}
		if *stage != "" && t.Stage != *stage {
			continue
		}
		vis = append(vis, t)
	}
	if *comoJSON {
		_ = json.NewEncoder(os.Stdout).Encode(vis)
		return
	}
	fmt.Printf("\n  %d tarea(s)%s · de %d en total\n\n", len(vis),
		map[bool]string{true: "", false: " abiertas"}[*conTodas], len(ts))
	for _, t := range vis {
		j := ""
		if len(t.Jira) > 0 {
			j = "  " + strings.Join(t.Jira, ",")
		}
		fmt.Printf("  #%-3d %-10s %s%s\n", t.ID, t.Stage, t.Title, j)
		fmt.Printf("       %s\n", t.Slug)
	}
	fmt.Println("\n  -n <slug|id> para una · -guard <archivo> antes de publicar · -json para encadenar")
}
