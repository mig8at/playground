// Package store persiste la bitácora en SQLite (archivo local, cero servidor).
//
// EL ESQUEMA ESTÁ DISEÑADO PARA ANÁLISIS DE TIEMPO, no solo para que la UI recargue. Las decisiones
// que importan, y por qué:
//
//   - `entries` es una tabla de HECHOS: una fila = un bloque de tiempo trabajado. `sprints` y `tasks`
//     son DIMENSIONES: snapshots de lo que Jira dijo la última vez que se consultó, upserteadas de
//     pasada en cada carga del dashboard. Así el análisis (¿cuánto costó cada tarea vs sus puntos?) se
//     hace con JOINs locales, sin depender de que Jira responda.
//
//   - `started_at` es CUÁNDO EMPEZÓ EL TRABAJO (RFC3339 con offset local), no cuándo se registró; eso
//     otro es `created_at`. Son cosas distintas y la brecha entre ambas —cuánto tardás en anotar—
//     también es un dato. `day` y `hour` desnormalizan el mismo instante en hora LOCAL porque las
//     funciones de fecha de SQLite convierten el offset a UTC: agrupar por strftime('%H') movería "las
//     9am" a "las 14" y el análisis mañana/tarde saldría corrido 5 horas sin que nadie lo note.
//
//   - `minutes` (lo que pasó) y `uploaded_minutes` (lo que Jira vio) CONVIVEN. El ajuste al publicar
//     —redondeo, completar el día— es una decisión de publicación, no una reescritura de la verdad.
//     Sin las dos columnas, inflar destruiría el dato real que hace útil el análisis.
//
//   - `task_key` puede ser NULL: no todo el tiempo real cae en una tarea del sprint (reuniones,
//     soporte, entrevistas). Forzar eso a una tarea envenena el análisis; `free_title` dice qué fue.
//
//   - `note` es PUBLICABLE POR CONSTRUCCIÓN: el guard (mismos patrones que muestra la UI) corre en el
//     server ANTES del INSERT y rechaza la fila. Nada que entre acá puede filtrar el playground el día
//     que la subida a Jira sea automática.
//
//   - Borrado SUAVE (`deleted_at`): un mis-click no agujerea la historia; el listado filtra.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // driver "sqlite" (Go puro, sin cgo)
)

const schema = `
CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  task_key      TEXT,                      -- clave Jira (CORE-265); NULL = trabajo sin tarea
  free_title    TEXT,                      -- qué fue, cuando task_key es NULL (reunión, soporte, ...)
  sprint_id     INTEGER,

  kind          TEXT NOT NULL,             -- progress | finding | test | blocker (extensible)

  started_at    TEXT NOT NULL,             -- RFC3339 con offset local: cuándo EMPEZÓ el trabajo
  day           TEXT NOT NULL,             -- YYYY-MM-DD local (desnormalizado: strftime va a UTC)
  hour          INTEGER NOT NULL,          -- 0..23 local, hora en que empezó el bloque
  minutes       INTEGER NOT NULL CHECK (minutes > 0),

  note          TEXT NOT NULL,             -- publicable por construcción (guard antes del INSERT)

  created_at    TEXT NOT NULL,             -- cuándo se anotó (≠ started_at)
  deleted_at    TEXT,                      -- soft delete

  jira_worklog_id   TEXT,                  -- rellenos cuando la entrada se sube a Jira:
  uploaded_minutes  INTEGER,               --   lo publicado (puede diferir de minutes)
  uploaded_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_day    ON entries(day);
CREATE INDEX IF NOT EXISTS idx_entries_task   ON entries(task_key);
CREATE INDEX IF NOT EXISTS idx_entries_sprint ON entries(sprint_id);

CREATE TABLE IF NOT EXISTS sprints (
  id          INTEGER PRIMARY KEY,         -- id real de Jira
  board_id    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  state       TEXT NOT NULL,               -- future | active | closed
  start_date  TEXT,
  end_date    TEXT,
  seen_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  key        TEXT PRIMARY KEY,             -- CORE-265
  summary    TEXT NOT NULL,
  points     REAL,                         -- NULL = sin estimar (≠ 0 estimado en cero)
  status     TEXT,
  category   TEXT,                         -- new | indeterminate | done
  sprint_id  INTEGER,                      -- último sprint donde se la vio
  seen_at    TEXT NOT NULL
);

-- preferencias del tablero (no de una tarea): qué campos de la empresa se piden. key-value simple.
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- CAPA LOCAL PRIVADA de una tarea. La tabla tasks es el snapshot de Jira (se pisa en cada carga); ESTO
-- es lo mío y NO se toca al sincronizar. La separación es el punto: mi verdad no la clobberea Jira.
--   real_state       = dónde está DE VERDAD (privado), independiente del estado reportado en Jira
--   definition       = descripción para Jira, redactada por el esfuerzo que la tarea REPRESENTA
--   estimate_minutes = tiempo ESTIPULADO (representativo), NO mi crunch real (que vive en entries)
--   effort_id        = agrupa la tarea bajo un esfuerzo privado
CREATE TABLE IF NOT EXISTS task_local (
  task_key         TEXT PRIMARY KEY,
  real_state       TEXT,
  definition       TEXT,
  estimate_minutes INTEGER,
  estimate_points  REAL,
  effort_id        INTEGER,
  updated_at       TEXT NOT NULL
);

-- esfuerzo PRIVADO: el trabajo real (análisis grande) del que salen N tareas reportables a Jira.
CREATE TABLE IF NOT EXISTS efforts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
`

type Store struct{ db *sql.DB }

// Open crea/abre el archivo y aplica el esquema. WAL para que un lector (análisis con sqlite3 a mano)
// no bloquee al server, y una sola conexión de escritura: SQLite tiene UN escritor, y serializar acá
// evita SQLITE_BUSY en vez de manejarlo en cada llamada.
func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("creando el directorio de datos: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("aplicando esquema: %w", err)
	}
	return &Store{db: db}, nil
}

// Entry es la fila de la tabla de hechos, en el shape que consume el frontend.
type Entry struct {
	ID         int64  `json:"id"`
	TaskKey    string `json:"taskKey"`   // "" = sin tarea
	FreeTitle  string `json:"freeTitle"` // qué fue, cuando no hay tarea
	SprintID   int64  `json:"sprintId"`
	Kind       string `json:"kind"`
	StartedAt  string `json:"startedAt"`
	Day        string `json:"day"`
	Hour       int    `json:"hour"`
	Minutes    int    `json:"minutes"`
	Note       string `json:"note"`
	CreatedAt  string `json:"createdAt"`
	UploadedAt string `json:"uploadedAt,omitempty"`
}

// Create inserta un registro. `startedAt` llega ya en zona local del server; day/hour se derivan acá
// para que NUNCA puedan desalinearse del instante (una sola fuente).
func (s *Store) Create(taskKey, freeTitle string, sprintID int64, kind string, startedAt time.Time, minutes int, note string) (Entry, error) {
	e := Entry{
		TaskKey: taskKey, FreeTitle: freeTitle, SprintID: sprintID, Kind: kind,
		StartedAt: startedAt.Format(time.RFC3339), Day: startedAt.Format("2006-01-02"), Hour: startedAt.Hour(),
		Minutes: minutes, Note: note, CreatedAt: time.Now().Format(time.RFC3339),
	}
	res, err := s.db.Exec(`INSERT INTO entries (task_key, free_title, sprint_id, kind, started_at, day, hour, minutes, note, created_at)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		nullStr(e.TaskKey), nullStr(e.FreeTitle), nullNum(e.SprintID), e.Kind, e.StartedAt, e.Day, e.Hour, e.Minutes, e.Note, e.CreatedAt)
	if err != nil {
		return Entry{}, err
	}
	e.ID, _ = res.LastInsertId()
	return e, nil
}

// List trae los registros vivos de una VENTANA de días O de un sprint (unión): la UI necesita las dos
// cosas a la vez — el mapa de jornada mira por fecha y la bitácora por sprint elegido.
func (s *Store) List(days int, sprintID int64) ([]Entry, error) {
	cutoff := time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	rows, err := s.db.Query(`SELECT id, COALESCE(task_key,''), COALESCE(free_title,''), COALESCE(sprint_id,0),
			kind, started_at, day, hour, minutes, note, created_at, COALESCE(uploaded_at,'')
		FROM entries
		WHERE deleted_at IS NULL AND (day >= ? OR sprint_id = ?)
		ORDER BY started_at DESC`, cutoff, sprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Entry{}
	for rows.Next() {
		var e Entry
		if err := rows.Scan(&e.ID, &e.TaskKey, &e.FreeTitle, &e.SprintID, &e.Kind, &e.StartedAt, &e.Day,
			&e.Hour, &e.Minutes, &e.Note, &e.CreatedAt, &e.UploadedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// SoftDelete marca la fila, no la elimina: el análisis histórico no pierde datos por un mis-click.
func (s *Store) SoftDelete(id int64) error {
	_, err := s.db.Exec(`UPDATE entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
		time.Now().Format(time.RFC3339), id)
	return err
}

// SaveSprint y SaveTask upsertean las dimensiones. Se llaman de pasada en cada carga del dashboard:
// navegar el tablero ES la sincronización.
func (s *Store) SaveSprint(id int64, boardID int, name, state, startDate, endDate string) error {
	_, err := s.db.Exec(`INSERT INTO sprints (id, board_id, name, state, start_date, end_date, seen_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET name=excluded.name, state=excluded.state,
			start_date=excluded.start_date, end_date=excluded.end_date, seen_at=excluded.seen_at`,
		id, boardID, name, state, startDate, endDate, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) SaveTask(key, summary string, points *float64, status, category string, sprintID int64) error {
	_, err := s.db.Exec(`INSERT INTO tasks (key, summary, points, status, category, sprint_id, seen_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET summary=excluded.summary, points=excluded.points,
			status=excluded.status, category=excluded.category, sprint_id=excluded.sprint_id,
			seen_at=excluded.seen_at`,
		key, summary, points, status, category, sprintID, time.Now().Format(time.RFC3339))
	return err
}

// TaskLocal es la capa privada de una tarea (mi verdad, separada del snapshot de Jira). Punteros para
// distinguir "sin definir" (NULL) de "cero": un estimado de 0 no es lo mismo que no haberlo puesto.
type TaskLocal struct {
	TaskKey         string   `json:"taskKey"`
	RealState       string   `json:"realState"`
	Definition      string   `json:"definition"`
	EstimateMinutes *int     `json:"estimateMinutes"`
	EstimatePoints  *float64 `json:"estimatePoints"`
	EffortID        int64    `json:"effortId"`
	UpdatedAt       string   `json:"updatedAt,omitempty"`
}

// GetTaskLocal trae la capa local; si no existe, devuelve una vacía con la clave (no es error).
func (s *Store) GetTaskLocal(key string) (TaskLocal, error) {
	tl := TaskLocal{TaskKey: key}
	var eff sql.NullInt64
	err := s.db.QueryRow(`SELECT COALESCE(real_state,''), COALESCE(definition,''), estimate_minutes,
			estimate_points, effort_id, updated_at
		FROM task_local WHERE task_key = ?`, key).
		Scan(&tl.RealState, &tl.Definition, &tl.EstimateMinutes, &tl.EstimatePoints, &eff, &tl.UpdatedAt)
	if err == sql.ErrNoRows {
		return tl, nil
	}
	if err != nil {
		return tl, err
	}
	tl.EffortID = eff.Int64
	return tl, nil
}

// SaveTaskLocal upsertea la capa local.
func (s *Store) SaveTaskLocal(tl TaskLocal) (TaskLocal, error) {
	_, err := s.db.Exec(`INSERT INTO task_local (task_key, real_state, definition, estimate_minutes, estimate_points, effort_id, updated_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(task_key) DO UPDATE SET real_state=excluded.real_state, definition=excluded.definition,
			estimate_minutes=excluded.estimate_minutes, estimate_points=excluded.estimate_points,
			effort_id=excluded.effort_id, updated_at=excluded.updated_at`,
		tl.TaskKey, nullStr(tl.RealState), nullStr(tl.Definition), tl.EstimateMinutes, tl.EstimatePoints,
		nullNum(tl.EffortID), time.Now().Format(time.RFC3339))
	if err != nil {
		return TaskLocal{}, err
	}
	return s.GetTaskLocal(tl.TaskKey)
}

// Effort es un esfuerzo PRIVADO: agrupa varias tareas de Jira bajo un mismo trabajo real. El título es
// mío y NO va a Jira, así que no pasa por el guard.
type Effort struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	CreatedAt string `json:"createdAt"`
}

// Efforts lista los esfuerzos vivos (no archivados), del más nuevo al más viejo.
func (s *Store) Efforts() ([]Effort, error) {
	rows, err := s.db.Query(`SELECT id, title, created_at FROM efforts WHERE archived_at IS NULL ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Effort{}
	for rows.Next() {
		var e Effort
		if err := rows.Scan(&e.ID, &e.Title, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// CreateEffort crea un esfuerzo y lo devuelve.
func (s *Store) CreateEffort(title string) (Effort, error) {
	now := time.Now().Format(time.RFC3339)
	res, err := s.db.Exec(`INSERT INTO efforts (title, created_at) VALUES (?, ?)`, title, now)
	if err != nil {
		return Effort{}, err
	}
	id, _ := res.LastInsertId()
	return Effort{ID: id, Title: title, CreatedAt: now}, nil
}

// AllTaskLocals devuelve todas las capas locales, indexadas por clave de tarea. La UI la usa para
// agrupar el listado por esfuerzo sin pedir la capa de cada tarea por separado.
func (s *Store) AllTaskLocals() (map[string]TaskLocal, error) {
	rows, err := s.db.Query(`SELECT task_key, COALESCE(real_state,''), COALESCE(definition,''),
			estimate_minutes, estimate_points, effort_id, updated_at FROM task_local`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]TaskLocal{}
	for rows.Next() {
		var tl TaskLocal
		var eff sql.NullInt64
		if err := rows.Scan(&tl.TaskKey, &tl.RealState, &tl.Definition, &tl.EstimateMinutes,
			&tl.EstimatePoints, &eff, &tl.UpdatedAt); err != nil {
			return nil, err
		}
		tl.EffortID = eff.Int64
		out[tl.TaskKey] = tl
	}
	return out, rows.Err()
}

// KnownSettings son los flags que el tablero reconoce, con su default. Off por defecto: la empresa no
// pide tiempo ni puntos, así que arrancan ocultos. Cualquier clave fuera de acá se ignora.
var KnownSettings = map[string]bool{"trackTime": false, "trackPoints": false}

// Settings devuelve los flags con sus defaults, pisados por lo guardado.
func (s *Store) Settings() (map[string]bool, error) {
	out := map[string]bool{}
	for k, def := range KnownSettings {
		out[k] = def
	}
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		if _, ok := KnownSettings[k]; ok { // ignora claves que ya no existen
			out[k] = v == "true"
		}
	}
	return out, rows.Err()
}

// SetSetting persiste un flag (solo si es conocido).
func (s *Store) SetSetting(key string, val bool) error {
	if _, ok := KnownSettings[key]; !ok {
		return fmt.Errorf("setting desconocido: %s", key)
	}
	v := "false"
	if val {
		v = "true"
	}
	_, err := s.db.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, v)
	return err
}

// nullStr/nullNum: "" y 0 se guardan como NULL para que los agregados (COUNT, GROUP BY task_key) no
// traten "sin valor" como un valor más.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullNum(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}
