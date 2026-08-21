// Package store persiste el tablero en ARCHIVOS (markdown + JSON, cero base de datos).
//
// POR QUÉ ARCHIVOS. Eran 44 filas en SQLite con un WAL de 1,9 MB para 139 KB de datos, pero el tamaño no
// es la razón: `tech_notes` —el detalle técnico de una tarea— sólo se podía leer POR API, así que el
// tablero era el único rincón del playground que un modelo no puede leer sin levantar un server, mientras
// `context/` es markdown que lee cualquiera. Y en archivos los esfuerzos tienen historia en git.
//
// UNA TAREA = UN ARCHIVO, suelto en `data/<tarea>.md`. Sin carpeta intermedia: `ls data/` muestra en
// qué se está trabajando, que es la pregunta que el tablero contesta.
//
//	nombre del archivo      el slug de la tarea (renombralo a mano si querés: el id vive adentro)
//	frontmatter             id · title · stage · created · archived? · context_nodes[] · jira[] · jira_title · ramas?
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
// Las anotaciones locales de una tarea (estado real, definición, estimados) van a
// `data/tareas-locales.json`, y sólo si alguna tiene contenido: son propiedad de la TAREA, mientras que el
// vínculo esfuerzo→tareas es propiedad del ESFUERZO. Mientras nadie las use, ese archivo no existe.
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
)

// Store guarda todo en memoria y escribe a disco en cada mutación. `dir` es la carpeta `data/`.
type Store struct {
	dir string
	mu  sync.Mutex

	efforts []Effort // ordenados por id ascendente
	// Firma de lo leído en disco, para saber si hay que releer: el mtime más nuevo y cuántos `.md`
	// hay. Ver `relerSiCambio`.
	mdMtime  time.Time
	mdCount  int
	slugs    map[int64]string     // id → nombre de archivo (renombrarlo a mano no rompe nada: el id va adentro)
	archived map[int64]string     // id → fecha de archivado ("" = vivo)
	entries  []Entry              // TODOS, incluidos los borrados: el borrado es suave
	borrados map[int64]string     // id de entry → deleted_at
	locals   map[string]TaskLocal // clave de tarea → capa local
	ajustes  map[string]string
	cache    map[string]any // snapshot de Jira: sprints y tasks
}

// Open abre (o crea) el directorio de datos y carga todo en memoria.
func Open(dir string) (*Store, error) {
	s := &Store{
		dir:      dir,
		slugs:    map[int64]string{},
		archived: map[int64]string{},
		borrados: map[int64]string{},
		locals:   map[string]TaskLocal{},
		ajustes:  map[string]string{},
		cache:    map[string]any{},
	}
	for _, sub := range []string{"entries", "cache"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return nil, fmt.Errorf("creando %s: %w", sub, err)
		}
	}
	if err := s.cargar(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error { return nil }

// ── carga ───────────────────────────────────────────────────────────────────────────────────────────────

func (s *Store) cargar() error {
	// Las TAREAS son los `.md` sueltos de `data/`: `ls data/` las muestra de una, que es el punto.
	// Los subdirectorios (entries, cache) no son tareas.
	archivos, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	// Se parte de cero: esto ya no corre sólo al arrancar, también cuando un `.md` cambió en disco
	// (ver `relerSiCambio`). Acumular sobre lo anterior duplicaría cada tarea en cada relectura.
	s.efforts, s.slugs, s.archived = nil, map[int64]string{}, map[int64]string{}
	for _, d := range archivos {
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			continue
		}
		e, arch, err := s.leerEffort(strings.TrimSuffix(d.Name(), ".md"))
		if err != nil {
			return fmt.Errorf("leyendo %s: %w", d.Name(), err)
		}
		s.efforts = append(s.efforts, e)
		s.slugs[e.ID] = d.Name()
		s.archived[e.ID] = arch
	}
	sort.Slice(s.efforts, func(i, j int) bool { return s.efforts[i].ID < s.efforts[j].ID })

	if err := s.cargarEntries(); err != nil {
		return err
	}
	if err := leerJSON(filepath.Join(s.dir, "settings.json"), &s.ajustes); err != nil {
		return err
	}
	if err := leerJSON(filepath.Join(s.dir, "cache", "jira.json"), &s.cache); err != nil {
		return err
	}
	// Anotaciones de tareas (estado real, definición, estimados). Se cargan DESPUÉS de los esfuerzos y se
	// MEZCLAN: el vínculo con el esfuerzo lo puso el frontmatter y no debe perderse acá.
	anotaciones := map[string]tareaLocalJSON{}
	if err := leerJSON(filepath.Join(s.dir, "tareas-locales.json"), &anotaciones); err != nil {
		return err
	}
	for k, a := range anotaciones {
		tl := s.locals[k]
		tl.TaskKey = k
		tl.RealState, tl.Definition = a.RealState, a.Definition
		tl.EstimateMinutes, tl.EstimatePoints, tl.UpdatedAt = a.EstimateMinutes, a.EstimatePoints, a.UpdatedAt
		s.locals[k] = tl
	}
	return nil
}

// SECCION es la frontera del guard DENTRO del archivo: lo de abajo se publica, lo de arriba no.
// Se busca al principio de línea y se toma la PRIMERA aparición.
const SECCION = "## Tarea (publicable)"

// ArtifactsDir es el subdirectorio de `data/` con los prototipos, uno por tarea y con su mismo slug.
// Es el ÚNICO subdirectorio de `data/` que no son tareas y sí se versiona: los otros (entries, pulse,
// cache) están fuera de git por ser dato personal o descartable, y un prototipo no es ninguna de las
// dos cosas — es el acuerdo al que se llegó, y perderlo es perder lo acordado.
const ArtifactsDir = "artifacts"

// Artifact es un prototipo de una tarea: el archivo que se sirve y cómo se llama en la UI.
type Artifact struct {
	File  string `json:"file"`
	Label string `json:"label"`
}

// artefactosDe lista los prototipos de una tarea, ordenados alfabéticamente para que el orden de
// los botones no dependa de cómo los devuelva el sistema de archivos.
// `<slug>.html` se etiqueta «prototipo»; `<slug>.<variante>.html` toma la variante como etiqueta.
func (s *Store) artefactosDe(slug string) []Artifact {
	entradas, err := os.ReadDir(filepath.Join(s.dir, ArtifactsDir))
	if err != nil {
		return nil
	}
	var out []Artifact
	for _, d := range entradas {
		n := d.Name()
		if d.IsDir() || !strings.HasSuffix(n, ".html") || !strings.HasPrefix(n, slug) {
			continue
		}
		resto := strings.TrimSuffix(strings.TrimPrefix(n, slug), ".html")
		switch {
		case resto == "": // <slug>.html
			out = append(out, Artifact{File: n, Label: "prototipo"})
		case strings.HasPrefix(resto, "."): // <slug>.<variante>.html
			out = append(out, Artifact{File: n, Label: strings.ReplaceAll(resto[1:], "-", " ")})
		}
		// cualquier otra cosa es de OTRA tarea cuyo slug empieza igual: se ignora
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func (s *Store) leerEffort(slug string) (Effort, string, error) {
	fm, cuerpo, err := leerMD(filepath.Join(s.dir, slug+".md"))
	if err != nil {
		return Effort{}, "", err
	}
	id, err := strconv.ParseInt(fm["id"], 10, 64)
	if err != nil {
		return Effort{}, "", fmt.Errorf("id inválido en el frontmatter: %q", fm["id"])
	}
	notas, desc := partirCuerpo(cuerpo)
	e := Effort{
		ID:              id,
		Title:           fm["title"],
		TechNotes:       notas,
		JiraTitle:       fm["jira_title"],
		JiraDescription: desc,
		Stage:           fm["stage"],
		CreatedAt:       fm["created"],
		// el struct expone los nodos como cadena separada por comas (así lo consume la UI);
		// en el archivo son una lista YAML, que es lo legible
		ContextNodes: strings.Join(listaYAML(fm["context_nodes"]), ","),
		RamasPatron:  fm["ramas"],
	}
	if e.Stage == "" {
		e.Stage = "evaluation"
	}
	e.Artifacts = s.artefactosDe(slug)
	// Del cuerpo PRIVADO: las anotaciones pueden nombrar repos y rutas, igual que el resto de
	// `TechNotes`. No pasan por el guard porque no salen a Jira.
	e.Anotaciones = Anotaciones(notas)
	// Del mismo cuerpo privado, y por la misma razón: las casillas de la publicable son criterios de
	// aceptación de QA, no pendientes.
	e.Pendientes = Pendientes(notas)
	// el vínculo esfuerzo → tareas de Jira; las anotaciones (si las hay) se cargan aparte
	for _, k := range listaYAML(fm["jira"]) {
		tl := s.locals[k]
		tl.TaskKey, tl.EffortID = k, id
		s.locals[k] = tl
	}
	return e, fm["archived"], nil
}

// partirCuerpo separa lo privado de lo publicable por la marca SECCION.
func partirCuerpo(cuerpo string) (notas, publicable string) {
	i := strings.Index(cuerpo, "\n"+SECCION)
	if strings.HasPrefix(cuerpo, SECCION) {
		i = 0
	} else if i >= 0 {
		i++ // saltar el salto de línea que se usó para anclar
	}
	if i < 0 {
		return cuerpo, ""
	}
	return cuerpo[:i], strings.TrimLeft(strings.TrimPrefix(cuerpo[i:], SECCION), "\n")
}

func (s *Store) cargarEntries() error {
	rutas, err := filepath.Glob(filepath.Join(s.dir, "entries", "*.jsonl"))
	if err != nil {
		return err
	}
	sort.Strings(rutas)
	for _, r := range rutas {
		crudo, err := os.ReadFile(r)
		if err != nil {
			return err
		}
		for _, l := range strings.Split(string(crudo), "\n") {
			if strings.TrimSpace(l) == "" {
				continue
			}
			var m entryJSON
			if err := json.Unmarshal([]byte(l), &m); err != nil {
				return fmt.Errorf("%s: línea ilegible: %w", filepath.Base(r), err)
			}
			s.entries = append(s.entries, m.aEntry())
			if m.DeletedAt != "" {
				s.borrados[m.ID] = m.DeletedAt
			}
		}
	}
	return nil
}

// ── entries (la bitácora) ───────────────────────────────────────────────────────────────────────────────

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
		ID:      s.siguienteEntryID(),
		TaskKey: taskKey, FreeTitle: freeTitle, SprintID: sprintID, EffortID: effortID, Kind: kind,
		StartedAt: startedAt.Format(time.RFC3339), Day: startedAt.Format("2006-01-02"), Hour: startedAt.Hour(),
		Minutes: minutes, Note: note, CreatedAt: time.Now().Format(time.RFC3339),
	}
	s.entries = append(s.entries, e)
	if err := s.escribirMes(mesDe(e.Day)); err != nil {
		return Entry{}, err
	}
	return e, nil
}

// List trae los registros vivos de una VENTANA de días O de un sprint (unión): la UI necesita las dos
// cosas a la vez — el mapa de jornada mira por fecha y la bitácora por sprint elegido.
func (s *Store) List(days int, sprintID int64) ([]Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	out := []Entry{}
	for _, e := range s.entries {
		if _, muerto := s.borrados[e.ID]; muerto {
			continue
		}
		if e.Day >= cutoff || (sprintID != 0 && e.SprintID == sprintID) {
			out = append(out, e)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartedAt > out[j].StartedAt })
	return out, nil
}

// SoftDelete marca el registro, no lo elimina: el análisis histórico no pierde datos por un mis-click.
func (s *Store) SoftDelete(id int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ya := s.borrados[id]; ya {
		return nil
	}
	for _, e := range s.entries {
		if e.ID == id {
			s.borrados[id] = time.Now().Format(time.RFC3339)
			return s.escribirMes(mesDe(e.Day))
		}
	}
	return nil
}

func (s *Store) siguienteEntryID() int64 {
	var max int64
	for _, e := range s.entries {
		if e.ID > max {
			max = e.ID
		}
	}
	return max + 1
}

func mesDe(dia string) string {
	if len(dia) >= 7 {
		return dia[:7]
	}
	return "sin-fecha"
}

// escribirMes re-escribe el archivo del mes completo. Con 3 registros no vale complicarse con append: un
// archivo entero es atómico de una y no deja líneas a medias.
func (s *Store) escribirMes(mes string) error {
	var lineas []string
	for _, e := range s.entries {
		if mesDe(e.Day) != mes {
			continue
		}
		m := entryJSON{
			ID: e.ID, Day: e.Day, Hour: e.Hour, Minutes: e.Minutes, Kind: e.Kind,
			StartedAt: e.StartedAt, CreatedAt: e.CreatedAt, TaskKey: e.TaskKey, FreeTitle: e.FreeTitle,
			Note: e.Note, UploadedAt: e.UploadedAt, SprintID: e.SprintID, EffortID: e.EffortID,
			DeletedAt: s.borrados[e.ID], Effort: s.slugs[e.EffortID],
		}
		b, err := json.Marshal(m)
		if err != nil {
			return err
		}
		lineas = append(lineas, string(b))
	}
	return escribirAtomico(filepath.Join(s.dir, "entries", mes+".jsonl"), []byte(strings.Join(lineas, "\n")+"\n"))
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
	fila := map[string]any{
		"key": key, "summary": summary, "status": status, "category": category,
		"sprint_id": sprintID, "seen_at": time.Now().Format(time.RFC3339),
	}
	if points != nil {
		fila["points"] = *points
	}
	return s.upsertCache("tasks", "key", key, fila)
}

func (s *Store) upsertCache(tabla, clave, valor string, fila map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var lista []any
	if v, ok := s.cache[tabla].([]any); ok {
		lista = v
	}
	reemplazado := false
	for i, it := range lista {
		if m, ok := it.(map[string]any); ok && fmt.Sprint(m[clave]) == valor {
			lista[i] = fila
			reemplazado = true
			break
		}
	}
	if !reemplazado {
		lista = append(lista, fila)
	}
	s.cache[tabla] = lista
	return s.escribirJSON(filepath.Join(s.dir, "cache", "jira.json"), s.cache)
}

// ── capa local de una tarea ─────────────────────────────────────────────────────────────────────────────

// TaskLocal es la capa privada de una tarea (mi verdad, separada del snapshot de Jira). Punteros para
// distinguir "sin definir" de "cero": un estimado de 0 no es lo mismo que no haberlo puesto.
type TaskLocal struct {
	TaskKey         string   `json:"taskKey"`
	RealState       string   `json:"realState"`
	Definition      string   `json:"definition"`
	EstimateMinutes *int     `json:"estimateMinutes"`
	EstimatePoints  *float64 `json:"estimatePoints"`
	EffortID        int64    `json:"effortId"`
	UpdatedAt       string   `json:"updatedAt,omitempty"`
}

// tareaLocalJSON es la forma en disco, dentro del `jira.json` del esfuerzo que la contiene.
type tareaLocalJSON struct {
	Key             string   `json:"key"`
	RealState       string   `json:"realState,omitempty"`
	Definition      string   `json:"definition,omitempty"`
	EstimateMinutes *int     `json:"estimateMinutes,omitempty"`
	EstimatePoints  *float64 `json:"estimatePoints,omitempty"`
	EffortID        int64    `json:"-"`
	UpdatedAt       string   `json:"updatedAt,omitempty"`
}

func (t tareaLocalJSON) aTaskLocal() TaskLocal {
	return TaskLocal{
		TaskKey: t.Key, RealState: t.RealState, Definition: t.Definition,
		EstimateMinutes: t.EstimateMinutes, EstimatePoints: t.EstimatePoints,
		EffortID: t.EffortID, UpdatedAt: t.UpdatedAt,
	}
}

type jiraJSON struct {
	EffortID int64            `json:"effortId"`
	Tasks    []tareaLocalJSON `json:"tasks"`
}

// GetTaskLocal trae la capa local; si no existe, devuelve una vacía con la clave (no es error).
func (s *Store) GetTaskLocal(key string) (TaskLocal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if tl, ok := s.locals[key]; ok {
		return tl, nil
	}
	return TaskLocal{TaskKey: key}, nil
}

// SaveTaskLocal guarda la capa local en el `jira.json` del esfuerzo al que pertenece. Si la tarea no
// cuelga de ningún esfuerzo va a `tareas-locales.json`: si no, no tendría dónde vivir.
func (s *Store) SaveTaskLocal(tl TaskLocal) (TaskLocal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	anterior := s.locals[tl.TaskKey]
	tl.UpdatedAt = time.Now().Format(time.RFC3339)
	s.locals[tl.TaskKey] = tl

	// El VÍNCULO vive en el frontmatter del esfuerzo, así que si cambió de esfuerzo hay que reescribir
	// los dos: el nuevo para que la liste, y el de origen para que deje de listarla.
	afectados := map[int64]bool{}
	if tl.EffortID != 0 {
		afectados[tl.EffortID] = true
	}
	if anterior.EffortID != 0 && anterior.EffortID != tl.EffortID {
		afectados[anterior.EffortID] = true
	}
	for id := range afectados {
		if err := s.escribirEffort(id); err != nil {
			return TaskLocal{}, err
		}
	}
	if err := s.escribirAnotaciones(); err != nil {
		return TaskLocal{}, err
	}
	return tl, nil
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

// escribirAnotaciones guarda SOLO las capas locales con contenido. Una tarea que sólo está ligada a un
// esfuerzo no aparece acá: su vínculo ya vive en el `jira:` del esfuerzo, y duplicarlo daría dos lugares
// que se pueden contradecir. Si no queda ninguna con contenido, el archivo se borra en vez de quedar `{}`.
func (s *Store) escribirAnotaciones() error {
	out := map[string]tareaLocalJSON{}
	for k, tl := range s.locals {
		if tl.RealState == "" && tl.Definition == "" && tl.EstimateMinutes == nil && tl.EstimatePoints == nil {
			continue
		}
		out[k] = tareaLocalJSON{
			Key: tl.TaskKey, RealState: tl.RealState, Definition: tl.Definition,
			EstimateMinutes: tl.EstimateMinutes, EstimatePoints: tl.EstimatePoints, UpdatedAt: tl.UpdatedAt,
		}
	}
	ruta := filepath.Join(s.dir, "tareas-locales.json")
	if len(out) == 0 {
		os.Remove(ruta)
		return nil
	}
	return s.escribirJSON(ruta, out)
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
	// slugs de los nodos de contexto que toca, separados por coma (el mapa del código vive allá).
	// En el archivo son una lista YAML; acá van como cadena porque así lo consume la UI.
	ContextNodes string `json:"contextNodes"`
	// ETAPA del método de trabajo: evaluar → trabajar → crear las tareas. Las tareas de Jira se
	// escriben AL FINAL, cuando ya se entendió el problema — por eso la etapa es explícita y no
	// derivada: "evaluando" y "trabajando" se distinguen por decisión, no por si ya hay tarea.
	Stage     string `json:"stage"` // evaluation | work | tasks
	CreatedAt string `json:"createdAt"`
	// ANOTACIONES: los marcadores con fecha que el CUERPO declara (mediciones, decisiones, preguntas,
	// riesgos). Igual que los prototipos, salen del contenido y no de una lista que haya que mantener.
	// Ver `anotaciones.go` para la forma y el porqué.
	Anotaciones []Anotacion `json:"anotaciones"`
	// PENDIENTES: lo que queda por hacer, en casillas de markdown dentro del CUERPO. Mismo criterio que
	// las anotaciones —el dato vive donde se argumenta y la UI lo deriva—, y por el mismo motivo: una
	// lista aparte se desincroniza en cuanto alguien resuelve el pendiente sin tocar el archivo.
	// Sólo del cuerpo privado: las casillas de la publicable son los criterios de aceptación de QA, que
	// no son pendientes de nadie. Ver `pendientes.go`.
	Pendientes []Pendiente `json:"pendientes"`
	// PROTOTIPOS de la tarea: los HTML autocontenidos de `data/artifacts/` que se abren desde el
	// tablero. El vínculo es el NOMBRE, no una entrada en el frontmatter: una convención de nombre no
	// se desincroniza, una lista escrita a mano sí.
	//   <slug>.html            → una sola propuesta, se etiqueta «prototipo»
	//   <slug>.<variante>.html → varias propuestas de la MISMA tarea, cada una con su etiqueta
	// Lo segundo existe porque una tarea suele tener más de un actor o más de un camino posible, y
	// verlos al lado es lo que permite decidir entre ellos.
	// Un artefacto es UN html sin build; si necesita `npm install` no es un artefacto, es una carpeta
	// del playground. Y NO gradúa a `context/`: describe lo que se acordó un día, no cómo funciona
	// CreditOp — muere con la tarea.
	Artifacts []Artifact `json:"artifacts"`
	// RAMAS: el PATRÓN de nombre de rama con el que se trabaja esta tarea (ej. `pais-como-dato`). Es lo
	// ÚNICO que se escribe a mano; qué ramas existen y hasta dónde llegó cada una lo mide git —ver
	// `ramas.go`—, porque una lista de ramas a mano miente en silencio en cuanto algo se mergea o se
	// renombra. Vacío = la tarea no toca código (o todavía no se sabe).
	RamasPatron string `json:"ramasPatron"`
}

// Stages son las etapas válidas, en orden.
var Stages = []string{"evaluation", "work", "tasks"}

func validStage(s string) bool {
	for _, v := range Stages {
		if v == s {
			return true
		}
	}
	return false
}

// relerSiCambio vuelve a leer las tareas si algún `.md` cambió en disco desde la última lectura.
//
// Hace falta porque los `.md` NO los escribe sólo este server: el asistente los edita directamente
// —es el punto de que sean archivos— y antes esos cambios no se veían hasta reiniciar. Con las
// anotaciones eso pasó de incómodo a inutilizante: escribís una medición en el cuerpo y el tablero
// sigue mostrando la lista vieja, sin ninguna señal de por qué.
//
// Es mtime y no un watcher a propósito: son unas decenas de archivos y esto corre al listar, así que
// un `os.Stat` por archivo es más barato que sostener un watcher y su cola de eventos.
//
// ⚠ Se llama con el lock TOMADO.
func (s *Store) relerSiCambio() {
	archivos, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	var ultima time.Time
	n := 0
	for _, d := range archivos {
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			continue
		}
		n++
		if fi, err := d.Info(); err == nil && fi.ModTime().After(ultima) {
			ultima = fi.ModTime()
		}
	}
	// El CONTEO entra en la firma además del mtime: borrar una tarea no adelanta el reloj de las
	// otras, y sin esto una tarea borrada seguiría listada.
	if n == s.mdCount && !ultima.After(s.mdMtime) {
		return
	}
	if err := s.cargar(); err != nil {
		return
	}
	s.mdCount, s.mdMtime = n, ultima
}

// Efforts lista los esfuerzos vivos (no archivados), del más nuevo al más viejo.
func (s *Store) Efforts() ([]Effort, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.relerSiCambio()
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
	File     string `json:"file"`
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
		out = append(out, EffortRef{Effort: e, File: s.slugs[e.ID], Archived: s.archived[e.ID]})
	}
	return out
}

// nuevoEffort reserva id y slug para un esfuerzo y lo deja en memoria SIN escribirlo: quien llama
// termina de llenarlo y escribe. Asume el lock tomado. Lo comparten la creación a mano y la
// importación desde Jira, que solo se diferencian en con qué nace el archivo.
func (s *Store) nuevoEffort(title, stage string) Effort {
	var max int64
	usados := map[string]bool{}
	for _, e := range s.efforts {
		if e.ID > max {
			max = e.ID
		}
	}
	for _, sl := range s.slugs {
		usados[strings.TrimSuffix(sl, ".md")] = true
	}
	e := Effort{ID: max + 1, Title: title, Stage: stage, CreatedAt: time.Now().Format(time.RFC3339)}
	s.efforts = append(s.efforts, e)
	// `slugs` guarda el NOMBRE DEL ARCHIVO, con extensión — así lo llena la carga (`d.Name()`) y así lo
	// usa la escritura. Antes acá se guardaba el slug pelado: una tarea creada en el proceso se escribía
	// bien, pero al reabrir el server su nombre pasaba a tener `.md` y la siguiente escritura le sumaba
	// otro (`tarea.md.md`), dejando el archivo real intacto. Fallaba en silencio.
	s.slugs[e.ID] = slugDe(title, e.ID, usados) + ".md"
	s.archived[e.ID] = ""
	return e
}

// CreateEffort crea la tarea local (su archivo `data/<slug>.md`) y la devuelve.
func (s *Store) CreateEffort(title string) (Effort, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	e := s.nuevoEffort(title, "evaluation")
	if err := s.escribirEffort(e.ID); err != nil {
		return Effort{}, err
	}
	return e, nil
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

// ImportarDeJira registra un issue de Jira como tarea local: el archivo nace YA vinculado (`jira: [KEY]`)
// y con `stage: tasks`, porque la tarea de Jira existe desde antes — la etapa describe el método
// (evaluar → trabajar → crear las tareas) y acá se entra por el final.
//
// Es IDEMPOTENTE: si la clave ya cuelga de un esfuerzo devuelve ese, con creada=false. Sin eso, dos
// clics del botón dejarían dos archivos para el mismo issue, que es justo el desorden que esto arregla.
//
// Un issue cerrado nace ARCHIVADO: el historial queda registrado pero `ls data/` sigue contestando "en
// qué estoy trabajando", que es para lo que se lee esa carpeta.
func (s *Store) ImportarDeJira(in ImportIssue) (Effort, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if tl, ok := s.locals[in.Key]; ok && tl.EffortID != 0 {
		if e := s.buscar(tl.EffortID); e != nil {
			return *e, false, nil
		}
	}

	e := s.nuevoEffort(in.Summary, "tasks")
	e.JiraTitle = in.Summary
	e.TechNotes = in.Body
	e.ContextNodes = in.Nodes
	*s.buscar(e.ID) = e
	if in.Closed {
		s.archived[e.ID] = time.Now().Format(time.RFC3339)
	}

	// El VÍNCULO vive en el frontmatter, y escribirEffort lo deriva de las capas locales: hay que
	// registrarlo ANTES de escribir o el archivo nace con `jira: []`.
	tl := s.locals[in.Key]
	tl.TaskKey, tl.EffortID = in.Key, e.ID
	s.locals[in.Key] = tl

	if err := s.escribirEffort(e.ID); err != nil {
		return Effort{}, false, err
	}
	return e, true, nil
}

// VincularTarea cuelga una tarea de Jira de un esfuerzo SIN tocar sus anotaciones (estado real,
// definición, estimados). SaveTaskLocal recibe la capa entera y la reemplaza —correcto cuando la manda
// el formulario, destructivo cuando lo único que querés es enlazar.
func (s *Store) VincularTarea(key string, effortID int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.buscar(effortID) == nil {
		return "", fmt.Errorf("no existe la tarea local %d", effortID)
	}
	anterior := s.locals[key].EffortID
	if anterior == effortID {
		return s.slugs[effortID], nil
	}

	tl := s.locals[key]
	tl.TaskKey, tl.EffortID = key, effortID
	s.locals[key] = tl

	// Los dos archivos cambian: el nuevo para que liste la clave, el de origen para que deje de listarla.
	if err := s.escribirEffort(effortID); err != nil {
		return "", err
	}
	if anterior != 0 && s.buscar(anterior) != nil {
		if err := s.escribirEffort(anterior); err != nil {
			return "", err
		}
	}
	return s.slugs[effortID], nil
}

// TareasVinculadas devuelve, por clave de Jira, el id del esfuerzo que la registra. Es lo que el cruce
// necesita saber: qué claves YA están en el registro local.
func (s *Store) TareasVinculadas() map[string]int64 {
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

// SetEffortStage mueve el esfuerzo de etapa.
func (s *Store) SetEffortStage(id int64, stage string) error {
	if !validStage(stage) {
		return fmt.Errorf("etapa inválida: %s (válidas: %v)", stage, Stages)
	}
	return s.mutar(id, func(e *Effort) { e.Stage = stage })
}

// SaveEffortTech guarda el detalle técnico privado y/o los nodos de contexto. Recibe PUNTEROS: nil = "no
// lo toques". Sin eso, guardar un solo campo borraba el otro (ya pasó una vez).
func (s *Store) SaveEffortTech(id int64, techNotes, contextNodes *string) error {
	return s.mutar(id, func(e *Effort) {
		if techNotes != nil {
			e.TechNotes = *techNotes
		}
		if contextNodes != nil {
			e.ContextNodes = *contextNodes
		}
	})
}

// SaveEffortDraft guarda el borrador de Jira. Mismos punteros que SaveEffortTech.
func (s *Store) SaveEffortDraft(id int64, jiraTitle, jiraDescription *string) error {
	return s.mutar(id, func(e *Effort) {
		if jiraTitle != nil {
			e.JiraTitle = *jiraTitle
		}
		if jiraDescription != nil {
			e.JiraDescription = *jiraDescription
		}
	})
}

// mutar aplica el cambio y re-escribe el archivo del esfuerzo.
func (s *Store) mutar(id int64, aplicar func(*Effort)) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.efforts {
		if s.efforts[i].ID != id {
			continue
		}
		if s.archived[id] != "" {
			return fmt.Errorf("no existe el esfuerzo %d", id) // archivado = no editable, como antes
		}
		aplicar(&s.efforts[i])
		return s.escribirEffort(id)
	}
	return fmt.Errorf("no existe el esfuerzo %d", id)
}

func (s *Store) buscar(id int64) *Effort {
	for i := range s.efforts {
		if s.efforts[i].ID == id {
			return &s.efforts[i]
		}
	}
	return nil
}

func (s *Store) escribirEffort(id int64) error {
	e := s.buscar(id)
	if e == nil {
		return fmt.Errorf("no existe el esfuerzo %d", id)
	}
	claves := []string{}
	for _, tl := range s.locals {
		if tl.EffortID == id {
			claves = append(claves, tl.TaskKey)
		}
	}
	sort.Strings(claves)

	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "id: %d\n", e.ID)
	fmt.Fprintf(&b, "title: %s\n", escYAML(e.Title))
	fmt.Fprintf(&b, "stage: %s\n", e.Stage)
	fmt.Fprintf(&b, "created: %s\n", escYAML(e.CreatedAt))
	if a := s.archived[id]; a != "" {
		fmt.Fprintf(&b, "archived: %s\n", escYAML(a))
	}
	fmt.Fprintf(&b, "context_nodes: [%s]\n", strings.Join(listaYAML(e.ContextNodes), ", "))
	fmt.Fprintf(&b, "jira: [%s]\n", strings.Join(claves, ", "))
	fmt.Fprintf(&b, "jira_title: %s\n", escYAML(e.JiraTitle))
	// Sólo si hay patrón: una tarea que no toca código no debería cargar una clave vacía.
	if e.RamasPatron != "" {
		fmt.Fprintf(&b, "ramas: %s\n", escYAML(e.RamasPatron))
	}
	b.WriteString("---\n\n")
	b.WriteString(conSaltoFinal(e.TechNotes))
	if e.JiraDescription != "" {
		b.WriteString("\n" + SECCION + "\n\n")
		b.WriteString(conSaltoFinal(e.JiraDescription))
	}
	// `slugs[id]` YA es el nombre del archivo, con extensión: no se le agrega nada. Concatenar `.md` acá
	// era el otro lado del bug del `.md.md` (ver nuevoEffort).
	return escribirAtomico(filepath.Join(s.dir, s.slugs[id]), []byte(b.String()))
}

// ── ajustes ─────────────────────────────────────────────────────────────────────────────────────────────

// KnownSettings son los flags que el tablero reconoce, con su default. Off por defecto: la empresa no pide
// tiempo ni puntos, así que arrancan ocultos. Cualquier clave fuera de acá se ignora.
var KnownSettings = map[string]bool{"trackTime": false, "trackPoints": false}

// Settings devuelve los flags con sus defaults, pisados por lo guardado.
func (s *Store) Settings() (map[string]bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]bool{}
	for k, def := range KnownSettings {
		out[k] = def
	}
	for k, v := range s.ajustes {
		if _, ok := KnownSettings[k]; ok { // ignora claves que ya no existen
			out[k] = v == "true"
		}
	}
	return out, nil
}

// SetSetting persiste un flag (solo si es conocido).
func (s *Store) SetSetting(key string, val bool) error {
	if _, ok := KnownSettings[key]; !ok {
		return fmt.Errorf("setting desconocido: %s", key)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ajustes[key] = strconv.FormatBool(val)
	return s.escribirJSON(filepath.Join(s.dir, "settings.json"), s.ajustes)
}

// ── utilidades de archivo ───────────────────────────────────────────────────────────────────────────────

func (s *Store) escribirJSON(ruta string, v any) error {
	datos, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return escribirAtomico(ruta, append(datos, '\n'))
}

// escribirAtomico escribe temporal + rename. Un corte a mitad de escritura sobre el archivo real dejaría
// un archivo de tarea truncado, y eso sí pierde datos.
func escribirAtomico(ruta string, datos []byte) error {
	if err := os.MkdirAll(filepath.Dir(ruta), 0o755); err != nil {
		return err
	}
	tmp := ruta + ".tmp"
	if err := os.WriteFile(tmp, datos, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, ruta)
}

// leerJSON tolera que el archivo no exista (todavía no se escribió nada).
func leerJSON(ruta string, dest any) error {
	crudo, err := os.ReadFile(ruta)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(crudo))) == 0 {
		return nil
	}
	return json.Unmarshal(crudo, dest)
}

// leerJSONEstricto exige que exista: un `jira.json` faltante es una carpeta de esfuerzo a medio escribir,
// y callarlo haría perder las tareas ligadas sin aviso.
func leerJSONEstricto(ruta string, dest any) error {
	crudo, err := os.ReadFile(ruta)
	if err != nil {
		return err
	}
	return json.Unmarshal(crudo, dest)
}

// leerMD parte un archivo en frontmatter (escalares) y cuerpo.
func leerMD(ruta string) (map[string]string, string, error) {
	crudo, err := os.ReadFile(ruta)
	if err != nil {
		return nil, "", err
	}
	txt := string(crudo)
	if !strings.HasPrefix(txt, "---\n") {
		return nil, "", fmt.Errorf("%s: sin frontmatter", filepath.Base(ruta))
	}
	resto := txt[4:]
	i := strings.Index(resto, "\n---\n")
	if i < 0 {
		return nil, "", fmt.Errorf("%s: frontmatter sin cierre", filepath.Base(ruta))
	}
	fm := map[string]string{}
	for _, l := range strings.Split(resto[:i], "\n") {
		if j := strings.Index(l, ":"); j > 0 {
			fm[strings.TrimSpace(l[:j])] = desescYAML(strings.TrimSpace(l[j+1:]))
		}
	}
	return fm, strings.TrimPrefix(resto[i+5:], "\n"), nil
}

// escYAML/desescYAML: JSON entrecomilla y escapa, y YAML acepta esa forma. Un título con `:` o comillas
// rompería un `title: valor` a pelo.
func escYAML(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func desescYAML(s string) string {
	if s == "" {
		return ""
	}
	var out string
	if json.Unmarshal([]byte(s), &out) == nil {
		return out
	}
	return s
}

// listaYAML parte `[a, b]` o `a,b` en elementos limpios. Sirve para las dos direcciones: leer el archivo
// y normalizar lo que manda la UI (que llega separado por comas, a veces con espacios).
func listaYAML(s string) []string {
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

func conSaltoFinal(s string) string {
	if s == "" || strings.HasSuffix(s, "\n") {
		return s
	}
	return s + "\n"
}

var noAlfa = regexp.MustCompile(`[^a-z0-9]+`)

// slugDe arma el nombre de carpeta desde el título. El acento se baja SIEMPRE a minúscula primero: si se
// compara sólo contra minúsculas acentuadas, una `Á` no matchea, se vuelve espacio, y el esfuerzo termina
// en una carpeta a la que le falta una letra — que no falla en ningún lado, sólo queda mal para siempre.
func slugDe(titulo string, id int64, usados map[string]bool) string {
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
	}, titulo)
	s = strings.Trim(noAlfa.ReplaceAllString(s, "-"), "-")

	// corta en frontera de palabra, no a la mitad
	var partes []string
	total := 0
	for _, p := range strings.Split(s, "-") {
		if total+len(p)+1 > 42 && len(partes) > 0 {
			break
		}
		partes = append(partes, p)
		total += len(p) + 1
	}
	s = strings.Join(partes, "-")
	if s == "" {
		s = fmt.Sprintf("effort-%d", id)
	}
	if usados[s] {
		s = fmt.Sprintf("%s-%d", s, id)
	}
	return s
}
