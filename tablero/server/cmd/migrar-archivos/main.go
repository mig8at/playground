// Migrador SQLite → archivos, de un solo uso.
//
// POR QUÉ. El tablero guarda 44 filas en SQLite y arrastra un WAL de 1,9 MB para 139 KB de datos. Pero la
// razón de fondo no es el tamaño: `tech_notes` —el detalle técnico de una tarea— hoy sólo se lee **por
// API**, así que el tablero es el único rincón del playground que un modelo no puede leer sin levantar un
// server, mientras `context/` es markdown que lee cualquiera. En archivos, además, los efforts pasan a
// tener historia en git.
//
// TRES NATURALEZAS, TRES ARCHIVOS — y la frontera del guard queda FÍSICA:
//
//	efforts/<slug>/effort.md   privado, SIN guard: puede nombrar repos y rutas
//	efforts/<slug>/jira.md     lo que se PUBLICA (título + descripción) → CON guard
//	efforts/<slug>/jira.json   estado de máquina: tareas de Jira ligadas, estimaciones
//
// Si la descripción publicable viviera dentro del JSON, el guard volvería a ser una convención que hay que
// recordar. Separada en su propio archivo, el publicador lee UNO y no puede filtrar una ruta por accidente.
//
// Los datos van a `tablero/data/`, NO a `server/data/`: si el server algún día se reduce a un proxy o
// desaparece, los datos no pueden vivir dentro de él.
//
// USO (desde tablero/server):
//
//	go run ./cmd/migrar-archivos volcar      → escribe los archivos (no borra nada de SQLite)
//	go run ./cmd/migrar-archivos verificar   → relee los archivos y los compara campo a campo con SQLite
//
// El volcado y la verificación viven en el MISMO binario a propósito: si fueran dos programas, sus listas
// de campos podrían discrepar y la verificación diría "ok" sobre un campo que nadie escribió.
package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode"

	_ "modernc.org/sqlite"
)

const (
	rutaDB   = "data/tablero.db"
	rutaSald = "../data" // tablero/data
)

type effort struct {
	ID              int64
	Title           string
	CreatedAt       string
	ArchivedAt      string
	JiraTitle       string
	JiraDescription string
	TechNotes       string
	ContextNodes    []string
	Stage           string
	Slug            string
}

type tareaLocal struct {
	Key             string   `json:"key"`
	RealState       string   `json:"realState,omitempty"`
	Definition      string   `json:"definition,omitempty"`
	EstimateMinutes *int     `json:"estimateMinutes,omitempty"`
	EstimatePoints  *float64 `json:"estimatePoints,omitempty"`
	UpdatedAt       string   `json:"updatedAt,omitempty"`
}

type jiraJSON struct {
	EffortID int64        `json:"effortId"`
	Tasks    []tareaLocal `json:"tasks"`
}

func main() {
	modo := "verificar"
	if len(os.Args) > 1 {
		modo = os.Args[1]
	}
	db, err := sql.Open("sqlite", "file:"+rutaDB+"?_pragma=busy_timeout(5000)")
	revisar(err)
	defer db.Close()

	efs := leerEfforts(db)
	switch modo {
	case "volcar":
		volcar(db, efs)
	case "verificar":
		verificar(db, efs)
	default:
		fmt.Println("uso: migrar-archivos [volcar|verificar]")
		os.Exit(2)
	}
}

// ── lectura de SQLite ───────────────────────────────────────────────────────────────────────────────────

func leerEfforts(db *sql.DB) []effort {
	filas, err := db.Query(`SELECT id, title, created_at, COALESCE(archived_at,''),
		COALESCE(jira_title,''), COALESCE(jira_description,''), COALESCE(tech_notes,''),
		COALESCE(context_nodes,''), stage FROM efforts ORDER BY id`)
	revisar(err)
	defer filas.Close()

	var out []effort
	usados := map[string]bool{}
	for filas.Next() {
		var e effort
		var nodos string
		revisar(filas.Scan(&e.ID, &e.Title, &e.CreatedAt, &e.ArchivedAt,
			&e.JiraTitle, &e.JiraDescription, &e.TechNotes, &nodos, &e.Stage))
		e.ContextNodes = nodosDeCadena(nodos)
		e.Slug = slugUnico(e.Title, e.ID, usados)
		out = append(out, e)
	}
	revisar(filas.Err())
	return out
}

// nodosDeCadena parte la lista separada por comas y NORMALIZA (recorta espacios, descarta vacíos). En BD
// hay valores como "form-service, dynamic-forms, credifamilia" con espacios: se limpian, y por eso la
// verificación compara la versión normalizada de los dos lados y no byte a byte.
func nodosDeCadena(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func leerTareas(db *sql.DB, effortID int64) []tareaLocal {
	filas, err := db.Query(`SELECT task_key, COALESCE(real_state,''), COALESCE(definition,''),
		estimate_minutes, estimate_points, COALESCE(updated_at,'')
		FROM task_local WHERE effort_id = ? ORDER BY task_key`, effortID)
	revisar(err)
	defer filas.Close()
	out := []tareaLocal{}
	for filas.Next() {
		var t tareaLocal
		revisar(filas.Scan(&t.Key, &t.RealState, &t.Definition, &t.EstimateMinutes, &t.EstimatePoints, &t.UpdatedAt))
		out = append(out, t)
	}
	revisar(filas.Err())
	return out
}

// ── volcado ─────────────────────────────────────────────────────────────────────────────────────────────

func volcar(db *sql.DB, efs []effort) {
	porID := map[int64]string{}
	for _, e := range efs {
		dir := filepath.Join(rutaSald, "efforts", e.Slug)
		revisar(os.MkdirAll(dir, 0o755))
		porID[e.ID] = e.Slug

		// effort.md — privado, sin guard. El cuerpo son las tech_notes tal cual.
		var fm strings.Builder
		fm.WriteString("---\n")
		fmt.Fprintf(&fm, "id: %d\n", e.ID)
		fmt.Fprintf(&fm, "title: %s\n", esc(e.Title))
		fmt.Fprintf(&fm, "stage: %s\n", e.Stage)
		fmt.Fprintf(&fm, "created: %s\n", esc(e.CreatedAt))
		if e.ArchivedAt != "" {
			fmt.Fprintf(&fm, "archived: %s\n", esc(e.ArchivedAt))
		}
		fmt.Fprintf(&fm, "context_nodes: [%s]\n", strings.Join(e.ContextNodes, ", "))
		fm.WriteString("---\n\n")
		cuerpo := e.TechNotes
		if cuerpo != "" && !strings.HasSuffix(cuerpo, "\n") {
			cuerpo += "\n"
		}
		escribir(filepath.Join(dir, "effort.md"), fm.String()+cuerpo)

		// jira.md — lo publicable, CON guard. Título en frontmatter, descripción en el cuerpo.
		var jm strings.Builder
		jm.WriteString("---\n")
		fmt.Fprintf(&jm, "title: %s\n", esc(e.JiraTitle))
		jm.WriteString("---\n\n")
		desc := e.JiraDescription
		if desc != "" && !strings.HasSuffix(desc, "\n") {
			desc += "\n"
		}
		escribir(filepath.Join(dir, "jira.md"), jm.String()+desc)

		// jira.json — estado de máquina.
		datos, err := json.MarshalIndent(jiraJSON{EffortID: e.ID, Tasks: leerTareas(db, e.ID)}, "", "  ")
		revisar(err)
		escribir(filepath.Join(dir, "jira.json"), string(datos)+"\n")
	}

	volcarEntries(db, porID)
	volcarSettings(db)
	volcarCache(db)
	fmt.Printf("\n✓ volcados %d efforts a %s/efforts/\n", len(efs), rutaSald)
	fmt.Println("  (SQLite quedó intacto — corré `verificar` antes de tocar nada)")
}

// volcarEntries escribe el tiempo como JSONL por mes. NO va en markdown: sus campos son
// day/hour/minutes/jira_worklog_id/uploaded_at, o sea estado de sincronización, no prosa.
func volcarEntries(db *sql.DB, slugPorID map[int64]string) {
	filas, err := db.Query(`SELECT id, COALESCE(task_key,''), COALESCE(free_title,''), COALESCE(sprint_id,0),
		COALESCE(effort_id,0), COALESCE(kind,''), COALESCE(started_at,''), COALESCE(day,''),
		COALESCE(hour,0), COALESCE(minutes,0), COALESCE(note,''), COALESCE(created_at,''),
		COALESCE(deleted_at,''), COALESCE(jira_worklog_id,''), COALESCE(uploaded_minutes,0),
		COALESCE(uploaded_at,'') FROM entries ORDER BY day, id`)
	revisar(err)
	defer filas.Close()

	porMes := map[string][]string{}
	n := 0
	for filas.Next() {
		var r struct {
			ID                                    int64
			TaskKey, FreeTitle                    string
			SprintID, EffortID                    int64
			Kind, StartedAt, Day                  string
			Hour, Minutes                         int
			Note, CreatedAt, DeletedAt, WorklogID string
			UploadedMinutes                       int
			UploadedAt                            string
		}
		revisar(filas.Scan(&r.ID, &r.TaskKey, &r.FreeTitle, &r.SprintID, &r.EffortID, &r.Kind,
			&r.StartedAt, &r.Day, &r.Hour, &r.Minutes, &r.Note, &r.CreatedAt, &r.DeletedAt,
			&r.WorklogID, &r.UploadedMinutes, &r.UploadedAt))
		m := map[string]any{
			"id": r.ID, "day": r.Day, "hour": r.Hour, "minutes": r.Minutes,
			"kind": r.Kind, "startedAt": r.StartedAt, "createdAt": r.CreatedAt,
		}
		poner := func(k, v string) {
			if v != "" {
				m[k] = v
			}
		}
		poner("taskKey", r.TaskKey)
		poner("freeTitle", r.FreeTitle)
		poner("note", r.Note)
		poner("deletedAt", r.DeletedAt)
		poner("jiraWorklogId", r.WorklogID)
		poner("uploadedAt", r.UploadedAt)
		if r.SprintID != 0 {
			m["sprintId"] = r.SprintID
		}
		if r.UploadedMinutes != 0 {
			m["uploadedMinutes"] = r.UploadedMinutes
		}
		if r.EffortID != 0 {
			m["effortId"] = r.EffortID
			// el slug además del id: así la línea se lee sin abrir otro archivo
			if s, ok := slugPorID[r.EffortID]; ok {
				m["effort"] = s
			}
		}
		linea, err := json.Marshal(m)
		revisar(err)
		mes := r.Day
		if len(mes) >= 7 {
			mes = mes[:7]
		} else {
			mes = "sin-fecha"
		}
		porMes[mes] = append(porMes[mes], string(linea))
		n++
	}
	revisar(filas.Err())
	for mes, ls := range porMes {
		escribir(filepath.Join(rutaSald, "entries", mes+".jsonl"), strings.Join(ls, "\n")+"\n")
	}
	fmt.Printf("  entries: %d registro(s) en %d archivo(s)\n", n, len(porMes))
}

func volcarSettings(db *sql.DB) {
	filas, err := db.Query(`SELECT key, value FROM settings ORDER BY key`)
	revisar(err)
	defer filas.Close()
	m := map[string]string{}
	for filas.Next() {
		var k, v string
		revisar(filas.Scan(&k, &v))
		m[k] = v
	}
	revisar(filas.Err())
	datos, err := json.MarshalIndent(m, "", "  ")
	revisar(err)
	escribir(filepath.Join(rutaSald, "settings.json"), string(datos)+"\n")
	fmt.Printf("  settings: %d clave(s)\n", len(m))
}

// volcarCache guarda el snapshot de Jira. Es DESCARTABLE (se rehace pidiéndoselo a Jira): se vuelca para
// no perder nada en la mudanza, no porque haga falta conservarlo.
func volcarCache(db *sql.DB) {
	cache := map[string]any{}
	for _, t := range []string{"sprints", "tasks"} {
		filas, err := db.Query("SELECT * FROM " + t)
		revisar(err)
		cols, err := filas.Columns()
		revisar(err)
		var reg []map[string]any
		for filas.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			revisar(filas.Scan(ptrs...))
			fila := map[string]any{}
			for i, c := range cols {
				if b, ok := vals[i].([]byte); ok {
					fila[c] = string(b)
				} else {
					fila[c] = vals[i]
				}
			}
			reg = append(reg, fila)
		}
		revisar(filas.Err())
		filas.Close()
		cache[t] = reg
	}
	datos, err := json.MarshalIndent(cache, "", "  ")
	revisar(err)
	escribir(filepath.Join(rutaSald, "cache", "jira.json"), string(datos)+"\n")
	fmt.Println("  cache de Jira: volcado (descartable)")
}

// ── verificación ────────────────────────────────────────────────────────────────────────────────────────

// verificar RELEE los archivos y los compara campo a campo con SQLite. Es lo único que autoriza a borrar
// la BD: sin esto, "los archivos están" no dice que estén COMPLETOS.
func verificar(db *sql.DB, efs []effort) {
	fallos := 0
	comparar := func(quien, campo, esperado, obtenido string) {
		if esperado != obtenido {
			fallos++
			fmt.Printf("  ✗ %s · %s\n      SQLite:  %s\n      archivo: %s\n",
				quien, campo, recorte(esperado), recorte(obtenido))
		}
	}

	for _, e := range efs {
		dir := filepath.Join(rutaSald, "efforts", e.Slug)
		fmEff, cuerpoEff, err := leerMD(filepath.Join(dir, "effort.md"))
		if err != nil {
			fmt.Printf("  ✗ %s · effort.md: %v\n", e.Slug, err)
			fallos++
			continue
		}
		comparar(e.Slug, "id", fmt.Sprint(e.ID), fmEff["id"])
		comparar(e.Slug, "title", e.Title, desesc(fmEff["title"]))
		comparar(e.Slug, "stage", e.Stage, fmEff["stage"])
		comparar(e.Slug, "created", e.CreatedAt, desesc(fmEff["created"]))
		comparar(e.Slug, "archived", e.ArchivedAt, desesc(fmEff["archived"]))
		comparar(e.Slug, "context_nodes", strings.Join(e.ContextNodes, ", "),
			strings.Join(nodosDeCadena(strings.Trim(fmEff["context_nodes"], "[]")), ", "))
		comparar(e.Slug, "tech_notes", strings.TrimRight(e.TechNotes, "\n"), strings.TrimRight(cuerpoEff, "\n"))

		fmJira, cuerpoJira, err := leerMD(filepath.Join(dir, "jira.md"))
		if err != nil {
			fmt.Printf("  ✗ %s · jira.md: %v\n", e.Slug, err)
			fallos++
			continue
		}
		comparar(e.Slug, "jira_title", e.JiraTitle, desesc(fmJira["title"]))
		comparar(e.Slug, "jira_description", strings.TrimRight(e.JiraDescription, "\n"), strings.TrimRight(cuerpoJira, "\n"))

		crudo, err := os.ReadFile(filepath.Join(dir, "jira.json"))
		if err != nil {
			fmt.Printf("  ✗ %s · jira.json: %v\n", e.Slug, err)
			fallos++
			continue
		}
		var jj jiraJSON
		if err := json.Unmarshal(crudo, &jj); err != nil {
			fmt.Printf("  ✗ %s · jira.json ilegible: %v\n", e.Slug, err)
			fallos++
			continue
		}
		esperadas, _ := json.Marshal(leerTareas(db, e.ID))
		obtenidas, _ := json.Marshal(jj.Tasks)
		comparar(e.Slug, "tasks", string(esperadas), string(obtenidas))
	}

	// entries: se cuentan y se suman minutos de los dos lados
	var nDB, minDB int
	revisar(db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(minutes),0) FROM entries`).Scan(&nDB, &minDB))
	nAr, minAr := contarEntries()
	comparar("entries", "cantidad", fmt.Sprint(nDB), fmt.Sprint(nAr))
	comparar("entries", "minutos", fmt.Sprint(minDB), fmt.Sprint(minAr))

	// settings
	var nSet int
	revisar(db.QueryRow(`SELECT COUNT(*) FROM settings`).Scan(&nSet))
	crudo, err := os.ReadFile(filepath.Join(rutaSald, "settings.json"))
	if err != nil {
		fmt.Printf("  ✗ settings.json: %v\n", err)
		fallos++
	} else {
		var m map[string]string
		revisar(json.Unmarshal(crudo, &m))
		comparar("settings", "cantidad", fmt.Sprint(nSet), fmt.Sprint(len(m)))
	}

	if fallos == 0 {
		fmt.Printf("\n✓ %d efforts · %d entries · %d settings — los archivos coinciden campo a campo con SQLite\n",
			len(efs), nDB, nSet)
		fmt.Println("  recién ahora es seguro recortar el store y borrar la BD.")
		return
	}
	fmt.Printf("\n✗ %d discrepancia(s) — NO borres SQLite\n", fallos)
	os.Exit(1)
}

func contarEntries() (int, int) {
	var n, min int
	patrones, _ := filepath.Glob(filepath.Join(rutaSald, "entries", "*.jsonl"))
	for _, p := range patrones {
		crudo, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		for _, l := range strings.Split(strings.TrimSpace(string(crudo)), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var m map[string]any
			if json.Unmarshal([]byte(l), &m) != nil {
				continue
			}
			n++
			if v, ok := m["minutes"].(float64); ok {
				min += int(v)
			}
		}
	}
	return n, min
}

// ── utilidades ──────────────────────────────────────────────────────────────────────────────────────────

// leerMD parte un archivo en frontmatter (mapa de escalares) y cuerpo.
func leerMD(ruta string) (map[string]string, string, error) {
	crudo, err := os.ReadFile(ruta)
	if err != nil {
		return nil, "", err
	}
	txt := string(crudo)
	if !strings.HasPrefix(txt, "---\n") {
		return nil, "", fmt.Errorf("sin frontmatter")
	}
	resto := txt[4:]
	i := strings.Index(resto, "\n---\n")
	if i < 0 {
		return nil, "", fmt.Errorf("frontmatter sin cierre")
	}
	fm := map[string]string{}
	for _, l := range strings.Split(resto[:i], "\n") {
		if j := strings.Index(l, ":"); j > 0 {
			fm[strings.TrimSpace(l[:j])] = strings.TrimSpace(l[j+1:])
		}
	}
	return fm, strings.TrimPrefix(resto[i+5:], "\n"), nil
}

// esc escribe un escalar YAML sin perder nada: JSON entrecomilla y escapa, y YAML acepta esa forma. Un
// título con `:` o comillas rompería un `title: valor` a pelo.
func esc(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func desesc(s string) string {
	if s == "" {
		return ""
	}
	var out string
	if json.Unmarshal([]byte(s), &out) == nil {
		return out
	}
	return s
}

var noAlfa = regexp.MustCompile(`[^a-z0-9]+`)

// nombres ELEGIDOS A MANO para los 11 efforts que existían al migrar. El algoritmo de abajo produce slugs
// legibles pero largos, y cortados en frontera de palabra igual quedan como frases a medias
// ("catalogo-global-de-campos-nuevo-campo-de"). Un nombre de carpeta se lee cien veces: vale nombrarlo.
// Va por ID y no por título porque el título se edita; y queda explícito en vez de escondido, así una
// re-corrida es determinista y cualquier effort nuevo cae en el algoritmo.
var nombres = map[int64]string{
	4:  "omitir-buro-cupo-confirmado",
	5:  "motai-v2",
	6:  "ecommerce-stateless",
	7:  "fix-min-income",
	8:  "credifamilia-ciudad-nacimiento",
	9:  "pdf-mapper-borrado-y-publicacion",
	10: "catalogo-campos-autorizacion-datos",
	11: "pdf-mapper-proteccion-borrado",
	12: "codeudor-cierre-tras-firma",
	13: "abaco-lender-requirements",
	14: "card-renting-planes",
}

// slugUnico arma un nombre de carpeta legible y estable desde el título. No usa la key de Jira a propósito:
// por el método del tablero la tarea se redacta AL FINAL, así que el effort existe antes de tener key.
func slugUnico(titulo string, id int64, usados map[string]bool) string {
	if n, ok := nombres[id]; ok {
		usados[n] = true
		return n
	}
	// ⚠ El acento se baja SIEMPRE a minúscula primero. Antes se comparaba sólo contra las minúsculas
	// acentuadas y la `Á` de «Ábaco» no matcheaba: caía en el `default`, se volvía espacio, y el effort
	// terminó en una carpeta llamada `baco-…`. Perder una letra en un nombre de carpeta no falla en
	// ningún lado: solo queda mal para siempre.
	s := strings.Map(func(r rune) rune {
		r = unicode.ToLower(r)
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			return r
		}
		switch r {
		case 'á', 'à', 'ä', 'â', 'ã':
			return 'a'
		case 'é', 'è', 'ë', 'ê':
			return 'e'
		case 'í', 'ì', 'ï', 'î':
			return 'i'
		case 'ó', 'ò', 'ö', 'ô', 'õ':
			return 'o'
		case 'ú', 'ù', 'ü', 'û':
			return 'u'
		case 'ñ':
			return 'n'
		case 'ç':
			return 'c'
		}
		return ' '
	}, titulo)
	s = strings.Trim(noAlfa.ReplaceAllString(s, "-"), "-")

	// corta en frontera de palabra, no a la mitad
	palabras := strings.Split(s, "-")
	var b []string
	total := 0
	for _, p := range palabras {
		if total+len(p)+1 > 42 && len(b) > 0 {
			break
		}
		b = append(b, p)
		total += len(p) + 1
	}
	s = strings.Join(b, "-")
	if s == "" {
		s = fmt.Sprintf("effort-%d", id)
	}
	if usados[s] {
		s = fmt.Sprintf("%s-%d", s, id)
	}
	usados[s] = true
	return s
}

func escribir(ruta, contenido string) {
	revisar(os.MkdirAll(filepath.Dir(ruta), 0o755))
	revisar(os.WriteFile(ruta, []byte(contenido), 0o644))
}

func recorte(s string) string {
	s = strings.ReplaceAll(s, "\n", "⏎")
	if len(s) > 90 {
		return s[:90] + "…"
	}
	return s
}

func revisar(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

var _ = sort.Strings
