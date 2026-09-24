// Package store persiste el tablero en ARCHIVOS (markdown + JSON, cero base de datos).
//
// POR QUÉ ARCHIVOS. Eran 44 filas en SQLite con un WAL de 1,9 MB para 139 KB de datos, pero el tamaño no
// es la razón: `tech_notes` —el detalle técnico de una tarea— sólo se podía leer POR API, así que el
// tablero era el único rincón del playground que un modelo no puede leer sin levantar un server, mientras
// una tarea es markdown que lee cualquiera. Y en archivos los esfuerzos tienen historia en git.
//
// UNA TAREA DE JIRA = UNA CARPETA, `tasks/<slug>/`, con su documento `task.md`, su pila de bloques
// `context.jsonl` y sus `artifacts/` adentro (desde el 2026-09-23; antes era un `data/<tarea>.md` suelto
// y lo demás se le unía por nombre — ver el paquete layout). El trabajo local se concentra en siete
// contenedores permanentes (una herramienta por tarea y playground para lo transversal), validados por
// cmd/tasks. Así `ls tasks/` muestra trabajo comprometido y no una tarea nueva por cada mejora.
//
//	nombre de la carpeta    el slug de la tarea (renombrala a mano si querés: el id vive adentro)
//	frontmatter             id · title · stage · created · archived? · canon[] · jira[] · jira_title · ramas?
//	cuerpo                  las notas técnicas: PRIVADO, puede nombrar repos y rutas
//	## Tarea (publicable)   lo único que va a Jira, y pasa el guard
//
// La regla en una frase: **todo lo que está fuera de esa sección nunca sale de local.**
//
// Se probó con tres archivos (effort.md + jira.md + jira.json) para hacer FÍSICA esa frontera, y se
// descartó: el guard es el mecanismo real —corre sobre el texto antes de publicar y ataja repos, rutas y
// F-xx— así que el archivo aparte era redundancia, no seguridad. El `jira.json`, además, no llevaba nada:
// sus filas tenían SOLO la clave de la tarea, o sea existía para guardar una lista → hoy es `jira:`.
//
// El vínculo esfuerzo→tareas de Jira es propiedad del ESFUERZO: vive en su `jira:`. (Hubo además
// anotaciones locales por tarea —estado real, definición, estimados— en `data/tareas-locales.json`; la UI
// dejó de escribirlas el 2026-07-21, el archivo ya no existía, y se retiraron el 2026-09-23.)
//
// QUÉ SE CONSERVÓ DEL DISEÑO ANTERIOR (las decisiones siguen valiendo, cambió el soporte):
//
//   - `entries` es una tabla de HECHOS: un registro = un bloque de tiempo trabajado. `sprints` y `tasks`
//     son DIMENSIONES: snapshot de lo que Jira dijo la última vez. Por eso viven en `cache/jira.json` y
//     son DESCARTABLES — se rehacen navegando el tablero.
//   - `started_at` es CUÁNDO EMPEZÓ EL TRABAJO (RFC3339 con offset local), no cuándo se registró; eso otro
//     es `created_at`, y la brecha entre ambas también es un dato. `day`/`hour` se desnormalizan en hora
//     LOCAL al crear el registro: derivarlos después obliga a reinterpretar el offset y ahí se corren las
//     horas sin que nadie lo note.
//   - `minutes` (lo que pasó) y `uploaded_minutes` (lo que Jira vio) CONVIVEN: el ajuste al publicar es una
//     decisión de publicación, no una reescritura de la verdad.
//   - `task_key` puede ir vacío: no todo el tiempo cae en una tarea del sprint (reuniones, soporte); en ese
//     caso `free_title` dice qué fue.
//   - Borrado SUAVE (`deleted_at`): un mis-click no agujerea la historia; el listado filtra.
//
// CONCURRENCIA. Un solo usuario y 44 registros: todo se carga en memoria al abrir y cada mutación
// re-escribe su archivo con un mutex tomado. Es el equivalente al `SetMaxOpenConns(1)` de antes —
// serializar acá en vez de manejar carreras en cada llamada.
//
// ESCRITURA ATÓMICA. Siempre archivo temporal + rename: un corte a mitad de escritura dejaría un
// archivo de tarea truncado, y eso sí perdería datos de verdad.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"creditop/playground/tablero/server/internal/layout"
)

// Store guarda todo en memoria y escribe a disco en cada mutación. `dir` es la carpeta `data/` (lo
// operativo); las tareas viven al lado, en `tasks/<slug>/` — ver el paquete layout.
type Store struct {
	dir    string
	layout layout.Layout
	mu     sync.Mutex

	efforts []Effort // ordenados por id ascendente
	// Firma de lo leído en disco, para saber si hay que releer: el mtime más nuevo y cuántos `.md`
	// hay. Ver `rereadIfChanged`.
	mdMtime  time.Time
	mdCount  int
	slugs    map[int64]string     // id → slug, o sea la carpeta de la tarea (renombrarla no rompe nada: el id va adentro)
	archived map[int64]string     // id → fecha de archivado ("" = vivo)
	entries  []Entry              // TODOS, incluidos los borrados: el borrado es suave
	deleted  map[int64]string     // id de entry → deleted_at
	locals   map[string]TaskLocal // clave de tarea → capa local
	cache    map[string]any       // snapshot de Jira: sprints y tasks
}

// Open abre (o crea) el directorio de datos y carga todo en memoria.
func Open(dir string) (*Store, error) {
	s := &Store{
		dir:      dir,
		layout:   layout.At(dir),
		slugs:    map[int64]string{},
		archived: map[int64]string{},
		deleted:  map[int64]string{},
		locals:   map[string]TaskLocal{},
		cache:    map[string]any{},
	}
	for _, sub := range []string{filepath.Join(dir, "entries"), filepath.Join(dir, "cache"), s.layout.Tasks} {
		if err := os.MkdirAll(sub, 0o755); err != nil {
			return nil, fmt.Errorf("creando %s: %w", sub, err)
		}
	}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

// ── carga ───────────────────────────────────────────────────────────────────────────────────────────────

func (s *Store) load() error {
	// Las TAREAS son las carpetas de `tasks/` con su `task.md`: `ls tasks/` las muestra de una.
	slugs, err := s.layout.Slugs()
	if err != nil {
		return err
	}
	// Se parte de cero: esto ya no corre sólo al arrancar, también cuando un `.md` cambió en disco
	// (ver `rereadIfChanged`). Acumular sobre lo anterior duplicaría cada tarea o avance en cada
	// relectura. Las mutaciones se escriben antes de volver acá, así que reconstruir desde disco es
	// la fuente de verdad y no pierde cambios.
	s.efforts, s.slugs, s.archived = nil, map[int64]string{}, map[int64]string{}
	s.entries, s.deleted = nil, map[int64]string{}
	type readEntry struct {
		e    Effort
		arch string
		slug string
	}
	var readEntries []readEntry
	var max int64
	for _, slug := range slugs {
		e, arch, err := s.readEffort(slug)
		if err != nil {
			return fmt.Errorf("leyendo %s: %w", slug, err)
		}
		if e.ID > max {
			max = e.ID
		}
		readEntries = append(readEntries, readEntry{e, arch, slug})
	}
	// Por slug y siguiendo las mudanzas: mover una tarea de carpeta no es tocarla (ver layout.LastTouches).
	touches := s.layout.LastTouches()
	for i := range readEntries {
		readEntries[i].e.TouchedAt = touches[readEntries[i].slug]
	}

	// LOS `id: 0` RECIBEN UN ID DE VERDAD, ACÁ Y AHORA.
	//
	// La plantilla dice «lo reasigna el tablero al cargar — poné 0 y no lo peleés», y era mentira: nadie
	// lo reasignaba. `newEffort` numera sólo lo que se crea DESDE la UI, y una tarea escrita a mano —que
	// es como las escribe el asistente— se quedaba en 0 para siempre.
	//
	// No es cosmético, rompe el store: abajo se indexa `s.slugs[e.ID]`, así que **varias tareas en 0 se
	// pisan entre sí en ese mapa y sólo sobrevive la última**. Medido el 2026-08-27: cuatro archivos en
	// 0, y por eso ninguno tenía tarjeta en el tablero ni podía ser blanco de un enlace con Jira.
	//
	// Se persiste en el archivo (no sólo en memoria) porque un id que cambia en cada arranque no sirve
	// para enlazar nada: los avances y el vínculo con Jira lo guardan.
	var renumbered []int64
	for i := range readEntries {
		if readEntries[i].e.ID == 0 {
			max++
			readEntries[i].e.ID = max
			renumbered = append(renumbered, max)
		}
	}
	// Y LOS IDS REPETIDOS TAMBIÉN, por la misma razón: el mapa de abajo va por id, así que dos archivos
	// con el mismo número se pisan y sobrevive uno solo — el mismo modo de falla del `id: 0`, pero
	// sin que nada lo delate. Pasó el 2026-09-14: una tarea nueva escrita a mano nació con el 79, que
	// ya era de una archivada. Se queda con el número la más VIEJA (por `created`) —es la que puede
	// tener avances y Jira colgados de él— y la otra recibe el siguiente libre, persistido.
	byID := map[int64]int{}
	for i := range readEntries {
		id := readEntries[i].e.ID
		j, seen := byID[id]
		if !seen {
			byID[id] = i
			continue
		}
		newItem, old := i, j
		if readEntries[i].e.CreatedAt < readEntries[j].e.CreatedAt {
			newItem, old = j, i
		}
		max++
		readEntries[newItem].e.ID = max
		renumbered = append(renumbered, max)
		byID[id] = old
		fmt.Fprintf(os.Stderr, "tablero: id %d repetido en %s y %s → %s pasa a %d\n",
			id, readEntries[old].slug, readEntries[newItem].slug, readEntries[newItem].slug, max)
	}
	for _, l := range readEntries {
		s.efforts = append(s.efforts, l.e)
		s.slugs[l.e.ID] = l.slug
		s.archived[l.e.ID] = l.arch
	}
	for _, id := range renumbered {
		if err := s.writeEffort(id); err != nil {
			return fmt.Errorf("asignando id a %s: %w", s.slugs[id], err)
		}
	}
	sort.Slice(s.efforts, func(i, j int) bool { return s.efforts[i].ID < s.efforts[j].ID })

	if err := s.loadEntries(); err != nil {
		return err
	}
	if err := readJSON(filepath.Join(s.dir, "cache", "jira.json"), &s.cache); err != nil {
		return err
	}
	return nil
}

// SECTION es la frontera del guard DENTRO del archivo: lo de abajo se publica, lo de arriba no.
// Se busca al principio de línea y se toma la PRIMERA aparición.
const SECTION = "## Tarea (publicable)"

// Artifact es un archivo que produjo una tarea: un prototipo, un SQL, una nota. `File` es su ruta bajo
// `/artifacts/` del server (`<slug>/<archivo>`) y `Label` cómo se llama en la UI.
type Artifact struct {
	File  string `json:"file"`
	Label string `json:"label"`
	// URL: un `.url` (acceso directo, `URL=https://…`) es un artefacto que vive AFUERA —una página de
	// claude.ai, por ejemplo—: la UI abre la URL en vez de servir el archivo. Sólo https.
	URL string `json:"url,omitempty"`
}

// shortcutURL lee la URL de un acceso directo `.url`. Vacío si no hay una https válida.
func shortcutURL(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(raw), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "URL="); ok && strings.HasPrefix(v, "https://") {
			return v
		}
	}
	return ""
}

// artifactsOf lista los artifacts de una tarea: TODO lo que haya en `tasks/<slug>/artifacts/`, ordenado
// por etiqueta para que el orden no dependa del sistema de archivos.
//
// Hasta el 2026-09-23 eran los `data/artifacts/<slug>*.html`, unidos a la tarea por el nombre, y se
// medía el costo de eso: 13 de los 21 artifacts no eran `.html` y no aparecían nunca, y uno quedó
// huérfano cuando su tarea se renombró. La carpeta resuelve las dos cosas.
//
// La etiqueta es el nombre sin extensión, sin el `<slug>.` que traían los que nacieron con la
// convención vieja, y con los guiones como espacios; `<slug>.html` sigue siendo «prototipo».
// artifactLabel: los guiones son espacios, y el punto que queda separa el grupo de la parte
// (`sdk-del-comercio.prototipo-tecnico` → «sdk del comercio · prototipo tecnico»).
var artifactLabel = strings.NewReplacer("-", " ", ".", " · ")

func (s *Store) artifactsOf(slug string) []Artifact {
	entries, err := os.ReadDir(s.layout.ArtifactsPath(slug))
	if err != nil {
		return nil
	}
	var out []Artifact
	for _, d := range entries {
		n := d.Name()
		if d.IsDir() || strings.HasPrefix(n, ".") {
			continue
		}
		// La extensión no va en la etiqueta: la UI muestra el tipo aparte, y 13 de los 21 no son HTML.
		ext := filepath.Ext(n)
		base := strings.TrimSuffix(n, ext)
		label := strings.TrimPrefix(base, slug+".")
		if base == slug && ext == ".html" {
			label = "prototipo"
		}
		a := Artifact{File: slug + "/" + n, Label: artifactLabel.Replace(label)}
		if ext == ".url" {
			if a.URL = shortcutURL(filepath.Join(s.layout.ArtifactsPath(slug), n)); a.URL == "" {
				continue // un acceso directo sin https no se ofrece: abrirlo no llevaría a ningún lado
			}
		}
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func (s *Store) readEffort(slug string) (Effort, string, error) {
	fm, body, err := readMD(s.layout.TaskPath(slug))
	if err != nil {
		return Effort{}, "", err
	}
	id, err := strconv.ParseInt(fm["id"], 10, 64)
	if err != nil {
		return Effort{}, "", fmt.Errorf("id inválido en el frontmatter: %q", fm["id"])
	}
	notes, desc := splitBody(body)
	e := Effort{
		ID:              id,
		Title:           fm["title"],
		TechNotes:       notes,
		JiraTitle:       fm["jira_title"],
		JiraDescription: desc,
		Stage:           fm["stage"],
		Class:           fm["clase"],
		CreatedAt:       fm["created"],
		// el struct expone los temas como cadena separada por comas (así lo consume la UI);
		// en el archivo son una lista YAML, que es lo legible
		CanonTopics:    strings.Join(yamlList(fm["canon"]), ","),
		BranchPatterns: fm["ramas"],
	}
	if e.Stage == "" {
		e.Stage = "evaluation"
	}
	if e.Class == "" {
		e.Class = "tarea"
	}
	e.Artifacts = s.artifactsOf(slug)
	// Del cuerpo PRIVADO: las casillas de la publicable son criterios de aceptación de QA, no pendientes.
	e.Pending = Pending(notes)
	// el vínculo esfuerzo → tareas de Jira
	for _, k := range yamlList(fm["jira"]) {
		tl := s.locals[k]
		tl.TaskKey, tl.EffortID = k, id
		s.locals[k] = tl
	}
	return e, fm["archived"], nil
}

// splitBody separa lo privado de lo publicable por la marca SECCION.
func splitBody(body string) (notes, publishable string) {
	i := strings.Index(body, "\n"+SECTION)
	if strings.HasPrefix(body, SECTION) {
		i = 0
	} else if i >= 0 {
		i++ // saltar el salto de línea que se usó para anclar
	}
	if i < 0 {
		return body, ""
	}
	return body[:i], strings.TrimLeft(strings.TrimPrefix(body[i:], SECTION), "\n")
}

func (s *Store) loadEntries() error {
	paths, err := filepath.Glob(filepath.Join(s.dir, "entries", "*.jsonl"))
	if err != nil {
		return err
	}
	sort.Strings(paths)
	for _, r := range paths {
		raw, err := os.ReadFile(r)
		if err != nil {
			return err
		}
		for _, l := range strings.Split(string(raw), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var m entryJSON
			if err := json.Unmarshal([]byte(l), &m); err != nil {
				return fmt.Errorf("%s: línea ilegible: %w", filepath.Base(r), err)
			}
			s.entries = append(s.entries, m.aEntry())
			if m.DeletedAt != "" {
				s.deleted[m.ID] = m.DeletedAt
			}
		}
	}
	return nil
}

// ── entries (avances) ───────────────────────────────────────────────────────────────────────────────────

// Entry es un bloque de tiempo trabajado.
type Entry struct {
	ID         int64  `json:"id"`
	TaskKey    string `json:"taskKey"`   // "" = sin tarea
	FreeTitle  string `json:"freeTitle"` // qué fue, cuando no hay tarea
	SprintID   int64  `json:"sprintId"`
	EffortID   int64  `json:"effortId"`
	Kind       string `json:"kind"`
	StartedAt  string `json:"startedAt"`
	Day        string `json:"day"`
	Hour       int    `json:"hour"`
	Minutes    int    `json:"minutes"`
	Note       string `json:"note"`
	CreatedAt  string `json:"createdAt"`
	UploadedAt string `json:"uploadedAt,omitempty"`
}

// entryJSON es la forma en disco: campos vacíos se omiten para que la línea se lea de un vistazo.
type entryJSON struct {
	ID              int64  `json:"id"`
	Day             string `json:"day"`
	Hour            int    `json:"hour"`
	Minutes         int    `json:"minutes"`
	Kind            string `json:"kind"`
	StartedAt       string `json:"startedAt"`
	CreatedAt       string `json:"createdAt"`
	TaskKey         string `json:"taskKey,omitempty"`
	FreeTitle       string `json:"freeTitle,omitempty"`
	Note            string `json:"note,omitempty"`
	DeletedAt       string `json:"deletedAt,omitempty"`
	JiraWorklogID   string `json:"jiraWorklogId,omitempty"`
	UploadedAt      string `json:"uploadedAt,omitempty"`
	SprintID        int64  `json:"sprintId,omitempty"`
	EffortID        int64  `json:"effortId,omitempty"`
	Effort          string `json:"effort,omitempty"` // el slug, para leer la línea sin abrir otro archivo
	UploadedMinutes int    `json:"uploadedMinutes,omitempty"`
}

func (m entryJSON) aEntry() Entry {
	return Entry{
		ID: m.ID, TaskKey: m.TaskKey, FreeTitle: m.FreeTitle, SprintID: m.SprintID, EffortID: m.EffortID,
		Kind: m.Kind, StartedAt: m.StartedAt, Day: m.Day, Hour: m.Hour, Minutes: m.Minutes,
		Note: m.Note, CreatedAt: m.CreatedAt, UploadedAt: m.UploadedAt,
	}
}

// Create inserta un registro. `startedAt` llega ya en zona local del server; day/hour se derivan acá
// para que NUNCA puedan desalinearse del instante (una sola fuente).
func (s *Store) Create(taskKey, freeTitle string, sprintID, effortID int64, kind string, startedAt time.Time, minutes int, note string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	e := Entry{
		ID:      s.nextEntryID(),
		TaskKey: taskKey, FreeTitle: freeTitle, SprintID: sprintID, EffortID: effortID, Kind: kind,
		StartedAt: startedAt.Format(time.RFC3339), Day: startedAt.Format("2006-01-02"), Hour: startedAt.Hour(),
		Minutes: minutes, Note: note, CreatedAt: time.Now().Format(time.RFC3339),
	}
	s.entries = append(s.entries, e)
	if err := s.writeMonth(monthOf(e.Day)); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// List trae los registros vivos de una VENTANA de días O de un sprint (unión): la UI necesita las dos
// cosas a la vez — el mapa de jornada mira por fecha y los indicadores por sprint elegido.
func (s *Store) List(days int, sprintID int64) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	out := []Entry{}
	for _, e := range s.entries {
		if _, dead := s.deleted[e.ID]; dead {
			continue
		}
		if e.Day >= cutoff || (sprintID != 0 && e.SprintID == sprintID) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out, nil
}

func (s *Store) nextEntryID() int64 {
	var max int64
	for _, e := range s.entries {
		if e.ID > max {
			max = e.ID
		}
	}
	return max + 1
}

func monthOf(day string) string {
	if len(day) >= 7 {
		return day[:7]
	}
	return "sin-fecha"
}

// writeMonth re-escribe el archivo del mes completo. Con 3 registros no vale complicarse con append: un
// archivo entero es atómico de una y no deja líneas a medias.
func (s *Store) writeMonth(month string) error {
	var lines []string
	for _, e := range s.entries {
		if monthOf(e.Day) != month {
			continue
		}
		m := entryJSON{
			ID: e.ID, Day: e.Day, Hour: e.Hour, Minutes: e.Minutes, Kind: e.Kind,
			StartedAt: e.StartedAt, CreatedAt: e.CreatedAt, TaskKey: e.TaskKey, FreeTitle: e.FreeTitle,
			Note: e.Note, UploadedAt: e.UploadedAt, SprintID: e.SprintID, EffortID: e.EffortID,
			DeletedAt: s.deleted[e.ID], Effort: s.slugs[e.EffortID],
		}
		b, err := json.Marshal(m)
		if err != nil {
			return err
		}
		lines = append(lines, string(b))
	}
	return writeAtomic(filepath.Join(s.dir, "entries", month+".jsonl"), []byte(strings.Join(lines, "\n")+"\n"))
}

// ── el snapshot de Jira (descartable) ───────────────────────────────────────────────────────────────────

// SaveSprint y SaveTask upsertean las dimensiones. Se llaman de pasada en cada carga del dashboard:
// navegar el tablero ES la sincronización. Van a `cache/` porque se rehacen preguntándole a Jira.
func (s *Store) SaveSprint(id int64, boardID int, name, state, startDate, endDate string) error {
	return s.upsertCache("sprints", "id", fmt.Sprint(id), map[string]any{
		"id": id, "board_id": boardID, "name": name, "state": state,
		"start_date": startDate, "end_date": endDate, "seen_at": time.Now().Format(time.RFC3339),
	})
}

func (s *Store) SaveTask(key, summary string, points *float64, status, category string, sprintID int64) error {
	row := map[string]any{
		"key": key, "summary": summary, "status": status, "category": category,
		"sprint_id": sprintID, "seen_at": time.Now().Format(time.RFC3339),
	}
	if points != nil {
		row["points"] = *points
	}
	return s.upsertCache("tasks", "key", key, row)
}

func (s *Store) upsertCache(table, key, value string, row map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var list []any
	if v, ok := s.cache[table].([]any); ok {
		list = v
	}
	replaced := false
	for i, it := range list {
		if m, ok := it.(map[string]any); ok && fmt.Sprint(m[key]) == value {
			list[i] = row
			replaced = true
			break
		}
	}
	if !replaced {
		list = append(list, row)
	}
	s.cache[table] = list
	return s.writeJSON(filepath.Join(s.dir, "cache", "jira.json"), s.cache)
}

// ── vínculo de una tarea de Jira con su tarea local ─────────────────────────────────────────────────────

// TaskLocal dice de qué tarea local cuelga una tarea de Jira. El vínculo vive en el `jira:` del
// frontmatter de la tarea local; esto es su índice inverso.
//
// Tuvo además estado real, definición y estimados, editables desde la UI. La UI los dejó de escribir
// el 2026-07-21 («la tarea es la de Jira») y el archivo que los guardaba ya no existía: se retiraron.
type TaskLocal struct {
	TaskKey  string `json:"taskKey"`
	EffortID int64  `json:"effortId"`
}

// AllTaskLocals devuelve todas las capas locales, indexadas por clave de tarea. La UI la usa para agrupar
// el listado por esfuerzo sin pedir la capa de cada tarea por separado.
func (s *Store) AllTaskLocals() (map[string]TaskLocal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]TaskLocal, len(s.locals))
	for k, v := range s.locals {
		out[k] = v
	}
	return out, nil
}

// ── esfuerzos ───────────────────────────────────────────────────────────────────────────────────────────

// Effort es un esfuerzo PRIVADO: agrupa varias tareas de Jira bajo un mismo trabajo real. El título es
// mío y NO va a Jira, así que no pasa por el guard.
type Effort struct {
	ID    int64  `json:"id"`
	Title string `json:"title"` // privado: nombra el esfuerzo, no sale de acá
	// Borrador de la tarea de Jira que nace de este esfuerzo. Se redacta y se revisa ACÁ antes de
	// subir nada; por eso pasa el mismo guard que las notas (termina publicado). Vive en `jira.md`.
	JiraTitle       string `json:"jiraTitle"`
	JiraDescription string `json:"jiraDescription"`
	// PRIVADO y SIN GUARD: el detalle técnico de la tarea (archivos, análisis, rutas). Nunca sale de
	// acá, por eso puede nombrar archivos y repos — justo lo que el borrador de Jira tiene prohibido.
	// Es el CUERPO del archivo de la tarea.
	TechNotes string `json:"techNotes"`
	// Referencias de Canon que toca, separadas por coma. En el archivo son una lista YAML; acá van
	// como cadena porque así lo consume la UI. Preferir `tema/context#ancla` evita presentar un tema
	// entero como evidencia de una decisión puntual.
	CanonTopics string `json:"canon"`
	// ETAPA del método de trabajo: evaluar → trabajar → crear las tareas. Las tareas de Jira se
	// escriben AL FINAL, cuando ya se entendió el problema — por eso la etapa es explícita y no
	// derivada: "evaluando" y "trabajando" se distinguen por decisión, no por si ya hay tarea.
	Stage string `json:"stage"` // evaluation | work | tasks
	// CLASE: qué es esto, que es otra pregunta que en qué etapa está.
	//
	//	"tarea"     (default) trabajo del día a día sobre CreditOp. Va, o irá, a Jira.
	//	"proyecto"  uno de los siete contenedores locales canónicos. NO va a Jira nunca.
	//
	// Existe porque el tablero las trataba igual y no lo son: medido el 2026-09-15, 23 de las 40
	// abiertas no tienen clave de Jira, y buena parte son proyectos propios (las herramientas del
	// playground, el corpus técnico, el SDK) a los que el tablero les pedía sección publicable y les
	// reclamaba las piezas del cierre como si alguien fuera a leerlas del otro lado. ⚠ No se deduce de
	// si hay clave de Jira ni de qué repo toca: hay trabajo sobre las herramientas que SÍ se publicó
	// (CORE-421). Es una decisión, y por eso se declara.
	Class     string `json:"class,omitempty"`
	CreatedAt string `json:"createdAt"`
	// TouchedAt: el último día que alguien tocó el archivo de la tarea (YYYY-MM-DD), según git. Es lo
	// que separa una tarea viva de una dormida — la etapa no lo hace. Ver `layout/history.go`.
	TouchedAt string `json:"touchedAt,omitempty"`
	// PENDIENTES: lo que queda por hacer, en casillas de markdown dentro del CUERPO. Mismo criterio que
	// los artifacts —el dato sale de la tarea y la UI lo deriva—, y por el mismo motivo: una lista
	// aparte se desincroniza en cuanto alguien resuelve el pendiente sin tocar el archivo.
	// Sólo del cuerpo privado: las casillas de la publicable son los criterios de aceptación de QA, que
	// no son pendientes de nadie. Ver `pending.go`.
	Pending []PendingItem `json:"pending"`
	// ARTIFACTS de la tarea: todo lo que hay en `tasks/<slug>/artifacts/`, que se abre desde el
	// tablero. El vínculo es la CARPETA, no una entrada en el frontmatter ni el nombre: hasta el
	// 2026-09-23 era el nombre, y se desincronizó —un artifact quedó huérfano al renombrarse su tarea—.
	//   <slug>.html            → se etiqueta «prototipo»
	//   <slug>.<variante>.html → la variante es la etiqueta; cualquier otro archivo, su nombre
	// Lo segundo existe porque una tarea suele tener más de un actor o más de un camino posible, y
	// verlos al lado es lo que permite decidir entre ellos.
	// Un artefacto es UN html sin build; si necesita `npm install` no es un artefacto, es una carpeta
	// del playground. Y NO gradúa a `context/`: describe lo que se acordó un día, no cómo funciona
	// CreditOp — muere con la tarea.
	Artifacts []Artifact `json:"artifacts"`
	// RAMAS: el PATRÓN de nombre de rama con el que se trabaja esta tarea (ej. `pais-como-dato`). Es lo
	// ÚNICO que se escribe a mano; qué ramas existen y hasta dónde llegó cada una lo mide git —ver
	// `branches.go`—, porque una lista de ramas a mano miente en silencio en cuanto algo se mergea o se
	// renombra. Vacío = la tarea no toca código (o todavía no se sabe).
	BranchPatterns string `json:"branchPatterns"`
}

// rereadIfChanged vuelve a leer las tareas si algún `.md` cambió en disco desde la última lectura.
//
// Hace falta porque los `.md` NO los escribe sólo este server: el asistente los edita directamente
// —es el punto de que sean archivos— y antes esos cambios no se veían hasta reiniciar: tildás un
// pendiente en el cuerpo y el tablero sigue mostrando la lista vieja, sin ninguna señal de por qué.
//
// Es mtime y no un watcher a propósito: son unas decenas de archivos y esto corre al listar, así que
// un `os.Stat` por archivo es más barato que sostener un watcher y su cola de eventos.
//
// ⚠ Se llama con el lock TOMADO.
func (s *Store) rereadIfChanged() {
	paths, err := s.layout.TaskPaths()
	if err != nil {
		return
	}
	var last time.Time
	n := 0
	for _, p := range paths {
		n++
		if fi, err := os.Stat(p); err == nil && fi.ModTime().After(last) {
			last = fi.ModTime()
		}
	}
	// El CONTEO entra en la firma además del mtime: borrar una tarea no adelanta el reloj de las
	// otras, y sin esto una tarea borrada seguiría listada.
	if n == s.mdCount && !last.After(s.mdMtime) {
		return
	}
	if err := s.load(); err != nil {
		return
	}
	s.mdCount, s.mdMtime = n, last
}

// Efforts lista los esfuerzos vivos (no archivados), del más nuevo al más viejo.
func (s *Store) Efforts() ([]Effort, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rereadIfChanged()
	out := []Effort{}
	for i := len(s.efforts) - 1; i >= 0; i-- { // id DESC
		if s.archived[s.efforts[i].ID] != "" {
			continue
		}
		out = append(out, s.efforts[i])
	}
	return out, nil
}

// EffortRef es un esfuerzo + de dónde salió: el archivo y, si está archivado, cuándo. Lo devuelve la
// vista que necesita SABER de todos (el cruce con Jira), no la que lista para trabajar.
type EffortRef struct {
	Effort
	Slug     string `json:"slug"`
	File     string `json:"file"` // legible: `<slug>/task.md`
	Archived string `json:"archived,omitempty"`
}

// EffortsAll lista TODOS los esfuerzos, archivados incluidos. Existe por el cruce con Jira: un issue
// puede estar registrado en una tarea ya archivada, y tratarlo como "no está" porque no sale en el
// listado vivo lo importaría por segunda vez.
func (s *Store) EffortsAll() []EffortRef {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]EffortRef, 0, len(s.efforts))
	for i := len(s.efforts) - 1; i >= 0; i-- { // id DESC
		e := s.efforts[i]
		slug := s.slugs[e.ID]
		out = append(out, EffortRef{Effort: e, Slug: slug, File: slug + "/" + layout.TaskFile, Archived: s.archived[e.ID]})
	}
	return out
}

// newEffort reserva id y slug para un esfuerzo importado desde Jira y lo deja en memoria SIN
// escribirlo: quien llama termina de llenarlo y escribe. Asume el lock tomado.
func (s *Store) newEffort(title, stage string) Effort {
	var max int64
	used := map[string]bool{}
	for _, e := range s.efforts {
		if e.ID > max {
			max = e.ID
		}
	}
	for _, sl := range s.slugs {
		used[sl] = true
	}
	e := Effort{ID: max + 1, Title: title, Stage: stage, CreatedAt: time.Now().Format(time.RFC3339)}
	s.efforts = append(s.efforts, e)
	// `slugs` guarda el SLUG, que es la carpeta de la tarea — igual que la carga. (Cuando las tareas
	// eran archivos sueltos guardaba el nombre con `.md`, y mezclar las dos formas llegó a escribir un
	// `tarea.md.md` en silencio.)
	s.slugs[e.ID] = slugOf(title, e.ID, used)
	s.archived[e.ID] = ""
	return e
}

// ImportIssue es un issue de Jira listo para volverse tarea local. Lo arma el server desde lo que trajo
// la API; el store no habla con Jira.
type ImportIssue struct {
	Key     string
	Summary string
	Body    string // el cuerpo PRIVADO ya redactado (procedencia + lo que hoy dice Jira)
	Closed  bool   // si ya está cerrado, la tarea nace archivada
	Nodes   string // nodos de contexto, separados por coma (opcional)
}

// ImportFromJira registra un issue de Jira como tarea local: el archivo nace YA vinculado (`jira: [KEY]`)
// y con `stage: tasks`, porque la tarea de Jira existe desde antes — la etapa describe el método
// (evaluar → trabajar → crear las tareas) y acá se entra por el final.
//
// Es IDEMPOTENTE: si la clave ya cuelga de un esfuerzo devuelve ese, con creada=false. Sin eso, dos
// clics del botón dejarían dos archivos para el mismo issue, que es justo el desorden que esto arregla.
//
// Un issue cerrado nace ARCHIVADO: el historial queda registrado pero `ls tasks/` sigue contestando "en
// qué estoy trabajando", que es para lo que se lee esa carpeta.
func (s *Store) ImportFromJira(in ImportIssue) (Effort, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if tl, ok := s.locals[in.Key]; ok && tl.EffortID != 0 {
		if e := s.find(tl.EffortID); e != nil {
			return *e, false, nil
		}
	}

	e := s.newEffort(in.Summary, "tasks")
	e.JiraTitle = in.Summary
	e.TechNotes = in.Body
	e.CanonTopics = in.Nodes
	*s.find(e.ID) = e
	if in.Closed {
		s.archived[e.ID] = time.Now().Format(time.RFC3339)
	}

	// El VÍNCULO vive en el frontmatter, y escribirEffort lo deriva de las capas locales: hay que
	// registrarlo ANTES de escribir o el archivo nace con `jira: []`.
	tl := s.locals[in.Key]
	tl.TaskKey, tl.EffortID = in.Key, e.ID
	s.locals[in.Key] = tl

	if err := s.writeEffort(e.ID); err != nil {
		return Effort{}, false, err
	}
	return e, true, nil
}

// LinkTask cuelga una tarea de Jira de un esfuerzo.
func (s *Store) LinkTask(key string, effortID int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.find(effortID) == nil {
		return "", fmt.Errorf("no existe la tarea local %d", effortID)
	}
	previous := s.locals[key].EffortID
	if previous == effortID {
		return s.slugs[effortID], nil
	}

	tl := s.locals[key]
	tl.TaskKey, tl.EffortID = key, effortID
	s.locals[key] = tl

	// Los dos archivos cambian: el nuevo para que liste la clave, el de origen para que deje de listarla.
	if err := s.writeEffort(effortID); err != nil {
		return "", err
	}
	if previous != 0 && s.find(previous) != nil {
		if err := s.writeEffort(previous); err != nil {
			return "", err
		}
	}
	return s.slugs[effortID], nil
}

// LinkedTasks devuelve, por clave de Jira, el id del esfuerzo que la registra. Es lo que el cruce
// necesita saber: qué claves YA están en el registro local.
func (s *Store) LinkedTasks() map[string]int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]int64{}
	for k, tl := range s.locals {
		if tl.EffortID != 0 {
			out[k] = tl.EffortID
		}
	}
	return out
}

func (s *Store) find(id int64) *Effort {
	for i := range s.efforts {
		if s.efforts[i].ID == id {
			return &s.efforts[i]
		}
	}
	return nil
}

func (s *Store) writeEffort(id int64) error {
	e := s.find(id)
	if e == nil {
		return fmt.Errorf("no existe el esfuerzo %d", id)
	}
	keys := []string{}
	for _, tl := range s.locals {
		if tl.EffortID == id {
			keys = append(keys, tl.TaskKey)
		}
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "id: %d\n", e.ID)
	fmt.Fprintf(&b, "title: %s\n", escapeYAML(e.Title))
	fmt.Fprintf(&b, "stage: %s\n", e.Stage)
	fmt.Fprintf(&b, "created: %s\n", escapeYAML(e.CreatedAt))
	if a := s.archived[id]; a != "" {
		fmt.Fprintf(&b, "archived: %s\n", escapeYAML(a))
	}
	fmt.Fprintf(&b, "canon: [%s]\n", strings.Join(yamlList(e.CanonTopics), ", "))
	fmt.Fprintf(&b, "jira: [%s]\n", strings.Join(keys, ", "))
	fmt.Fprintf(&b, "jira_title: %s\n", escapeYAML(e.JiraTitle))
	// Sólo si hay patrón: una tarea que no toca código no debería cargar una clave vacía.
	if e.BranchPatterns != "" {
		fmt.Fprintf(&b, "ramas: %s\n", escapeYAML(e.BranchPatterns))
	}
	b.WriteString("---\n\n")
	b.WriteString(withTrailingNewline(e.TechNotes))
	if e.JiraDescription != "" {
		b.WriteString("\n" + SECTION + "\n\n")
		b.WriteString(withTrailingNewline(e.JiraDescription))
	}
	// `slugs[id]` es la carpeta de la tarea; writeAtomic la crea si es una tarea nueva.
	return writeAtomic(s.layout.TaskPath(s.slugs[id]), []byte(b.String()))
}

// ── utilidades de archivo ───────────────────────────────────────────────────────────────────────────────

func (s *Store) writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(data, '\n'))
}

// writeAtomic escribe temporal + rename. Un corte a mitad de escritura sobre el archivo real dejaría
// un archivo de tarea truncado, y eso sí pierde datos.
func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// readJSON tolera que el archivo no exista (todavía no se escribió nada).
func readJSON(path string, dest any) error {
	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return nil
	}
	return json.Unmarshal(raw, dest)
}

// readMD parte un archivo en frontmatter (escalares) y cuerpo.
func readMD(path string) (map[string]string, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	txt := string(raw)
	if !strings.HasPrefix(txt, "---\n") {
		return nil, "", fmt.Errorf("%s: sin frontmatter", filepath.Base(path))
	}
	rest := txt[4:]
	i := strings.Index(rest, "\n---\n")
	if i < 0 {
		return nil, "", fmt.Errorf("%s: frontmatter sin cierre", filepath.Base(path))
	}
	fm := map[string]string{}
	for _, l := range strings.Split(rest[:i], "\n") {
		if j := strings.Index(l, ":"); j > 0 {
			fm[strings.TrimSpace(l[:j])] = unescapeYAML(strings.TrimSpace(l[j+1:]))
		}
	}
	return fm, strings.TrimPrefix(rest[i+5:], "\n"), nil
}

// escapeYAML/desescYAML: JSON entrecomilla y escapa, y YAML acepta esa forma. Un título con `:` o comillas
// rompería un `title: valor` a pelo.
func escapeYAML(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func unescapeYAML(s string) string {
	if s == "" {
		return ""
	}
	var out string
	if json.Unmarshal([]byte(s), &out) == nil {
		return out
	}
	return s
}

// yamlList parte `[a, b]` o `a,b` en elementos limpios. Sirve para las dos direcciones: leer el archivo
// y normalizar lo que manda la UI (que llega separado por comas, a veces con espacios).
func yamlList(s string) []string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	out := []string{}
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func withTrailingNewline(s string) string {
	if s == "" || strings.HasSuffix(s, "\n") {
		return s
	}
	return s + "\n"
}

var noAlpha = regexp.MustCompile(`[^a-z0-9]+`)

// slugOf arma el nombre de carpeta desde el título. El acento se baja SIEMPRE a minúscula primero: si se
// compara sólo contra minúsculas acentuadas, una `Á` no matchea, se vuelve espacio, y el esfuerzo termina
// en una carpeta a la que le falta una letra — que no falla en ningún lado, sólo queda mal para siempre.
func slugOf(title string, id int64, used map[string]bool) string {
	s := strings.Map(func(r rune) rune {
		r = unicode.ToLower(r)
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
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
	}, title)
	s = strings.Trim(noAlpha.ReplaceAllString(s, "-"), "-")

	// corta en frontera de palabra, no a la mitad
	var parts []string
	total := 0
	for _, p := range strings.Split(s, "-") {
		if total+len(p)+1 > 42 && len(parts) > 0 {
			break
		}
		parts = append(parts, p)
		total += len(p) + 1
	}
	s = strings.Join(parts, "-")
	if s == "" {
		s = fmt.Sprintf("effort-%d", id)
	}
	if used[s] {
		s = fmt.Sprintf("%s-%d", s, id)
	}
	return s
}
