// Package store persiste la bitácora en SQLite (archivo local, cero servidor).
//
// EL ESQUEMA ESTÁ DISEÑADO PARA ANÁLISIS DE TIEMPO, no solo para que la UI recargue. Las decisiones
// que importan, y por qué:
//
//   - `registros` es una tabla de HECHOS: una fila = un bloque de tiempo trabajado. `sprints` y
//     `tareas` son DIMENSIONES: snapshots de lo que Jira dijo la última vez que se consultó, upserteadas
//     de pasada en cada carga del dashboard. Así el análisis (¿cuánto costó cada tarea vs sus puntos?)
//     se hace con JOINs locales, sin depender de que Jira responda.
//
//   - `inicio` es CUÁNDO EMPEZÓ EL TRABAJO (RFC3339 con offset local), no cuándo se registró; eso otro
//     es `creado_en`. Son cosas distintas y la brecha entre ambas —cuánto tardás en anotar— también es
//     un dato. `dia` y `hora` desnormalizan el mismo instante en hora LOCAL porque las funciones de
//     fecha de SQLite convierten el offset a UTC: agrupar por strftime('%H') movería "las 9am" a "las
//     14" y el análisis mañana/tarde saldría corrido 5 horas sin que nadie lo note.
//
//   - `minutos` (lo que pasó) y `minutos_subidos` (lo que Jira vio) CONVIVEN. El ajuste al publicar
//     —redondeo, completar el día— es una decisión de publicación, no una reescritura de la verdad.
//     Sin las dos columnas, inflar destruiría el dato real que hace útil el análisis.
//
//   - `tarea` puede ser NULL: no todo el tiempo real cae en una tarea del sprint (reuniones, soporte,
//     entrevistas). Forzar eso a una tarea envenena el análisis; `titulo_libre` dice qué fue.
//
//   - `nota` es PUBLICABLE POR CONSTRUCCIÓN: el guard (mismos patrones que muestra la UI) corre en el
//     server ANTES del INSERT y rechaza la fila. Nada que entre acá puede filtrar el playground el día
//     que la subida a Jira sea automática.
//
//   - Borrado SUAVE (`borrado_en`): un mis-click no agujerea la historia; el listado filtra.
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite" // driver "sqlite" (Go puro, sin cgo)
)

const esquema = `
CREATE TABLE IF NOT EXISTS registros (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  tarea         TEXT,                      -- clave Jira (CORE-265); NULL = trabajo sin tarea
  titulo_libre  TEXT,                      -- qué fue, cuando tarea es NULL (reunión, soporte, ...)
  sprint_id     INTEGER,

  tipo          TEXT NOT NULL,             -- avance | hallazgo | prueba | bloqueo (extensible)

  inicio        TEXT NOT NULL,             -- RFC3339 con offset local: cuándo EMPEZÓ el trabajo
  dia           TEXT NOT NULL,             -- YYYY-MM-DD local (desnormalizado: strftime va a UTC)
  hora          INTEGER NOT NULL,          -- 0..23 local, hora en que empezó el bloque
  minutos       INTEGER NOT NULL CHECK (minutos > 0),

  nota          TEXT NOT NULL,             -- publicable por construcción (guard antes del INSERT)

  creado_en     TEXT NOT NULL,             -- cuándo se anotó (≠ inicio)
  borrado_en    TEXT,                      -- soft delete

  jira_worklog_id  TEXT,                   -- rellenos cuando la entrada se sube a Jira:
  minutos_subidos  INTEGER,                --   lo publicado (puede diferir de minutos)
  subido_en        TEXT
);
CREATE INDEX IF NOT EXISTS idx_registros_dia    ON registros(dia);
CREATE INDEX IF NOT EXISTS idx_registros_tarea  ON registros(tarea);
CREATE INDEX IF NOT EXISTS idx_registros_sprint ON registros(sprint_id);

CREATE TABLE IF NOT EXISTS sprints (
  id        INTEGER PRIMARY KEY,           -- id real de Jira
  board_id  INTEGER NOT NULL,
  nombre    TEXT NOT NULL,
  estado    TEXT NOT NULL,                 -- future | active | closed
  inicio    TEXT,
  fin       TEXT,
  visto_en  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tareas (
  clave      TEXT PRIMARY KEY,             -- CORE-265
  resumen    TEXT NOT NULL,
  puntos     REAL,                         -- NULL = sin estimar (≠ 0 estimado en cero)
  estado     TEXT,
  categoria  TEXT,                         -- new | indeterminate | done
  sprint_id  INTEGER,                      -- último sprint donde se la vio
  visto_en   TEXT NOT NULL
);
`

type Store struct{ db *sql.DB }

// Abrir crea/abre el archivo y aplica el esquema. WAL para que un lector (análisis con sqlite3 a mano)
// no bloquee al server, y una sola conexión de escritura: SQLite tiene UN escritor, y serializar acá
// evita SQLITE_BUSY en vez de manejarlo en cada llamada.
func Abrir(ruta string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(ruta), 0o755); err != nil {
		return nil, fmt.Errorf("creando el directorio de datos: %w", err)
	}
	db, err := sql.Open("sqlite", "file:"+ruta+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(esquema); err != nil {
		return nil, fmt.Errorf("aplicando esquema: %w", err)
	}
	return &Store{db: db}, nil
}

// Registro es la fila de la tabla de hechos, en el shape que consume el frontend.
type Registro struct {
	ID          int64  `json:"id"`
	Tarea       string `json:"tarea"`       // "" = sin tarea
	TituloLibre string `json:"tituloLibre"` // qué fue, cuando no hay tarea
	SprintID    int64  `json:"sprintId"`
	Tipo        string `json:"tipo"`
	Inicio      string `json:"inicio"`
	Dia         string `json:"dia"`
	Hora        int    `json:"hora"`
	Minutos     int    `json:"minutos"`
	Nota        string `json:"nota"`
	CreadoEn    string `json:"creadoEn"`
	SubidoEn    string `json:"subidoEn,omitempty"`
}

// Crear inserta un registro. `inicio` llega ya en zona local del server; dia/hora se derivan acá para
// que NUNCA puedan desalinearse del instante (una sola fuente).
func (s *Store) Crear(tarea, tituloLibre string, sprintID int64, tipo string, inicio time.Time, minutos int, nota string) (Registro, error) {
	r := Registro{
		Tarea: tarea, TituloLibre: tituloLibre, SprintID: sprintID, Tipo: tipo,
		Inicio: inicio.Format(time.RFC3339), Dia: inicio.Format("2006-01-02"), Hora: inicio.Hour(),
		Minutos: minutos, Nota: nota, CreadoEn: time.Now().Format(time.RFC3339),
	}
	res, err := s.db.Exec(`INSERT INTO registros (tarea, titulo_libre, sprint_id, tipo, inicio, dia, hora, minutos, nota, creado_en)
		VALUES (?,?,?,?,?,?,?,?,?,?)`,
		nulo(r.Tarea), nulo(r.TituloLibre), nuloN(r.SprintID), r.Tipo, r.Inicio, r.Dia, r.Hora, r.Minutos, r.Nota, r.CreadoEn)
	if err != nil {
		return Registro{}, err
	}
	r.ID, _ = res.LastInsertId()
	return r, nil
}

// Listar trae los registros vivos de una VENTANA de días O de un sprint (unión): la UI necesita las dos
// cosas a la vez — el mapa de jornada mira por fecha y la bitácora por sprint elegido.
func (s *Store) Listar(dias int, sprintID int64) ([]Registro, error) {
	corte := time.Now().AddDate(0, 0, -dias).Format("2006-01-02")
	rows, err := s.db.Query(`SELECT id, COALESCE(tarea,''), COALESCE(titulo_libre,''), COALESCE(sprint_id,0),
			tipo, inicio, dia, hora, minutos, nota, creado_en, COALESCE(subido_en,'')
		FROM registros
		WHERE borrado_en IS NULL AND (dia >= ? OR sprint_id = ?)
		ORDER BY inicio DESC`, corte, sprintID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Registro{}
	for rows.Next() {
		var r Registro
		if err := rows.Scan(&r.ID, &r.Tarea, &r.TituloLibre, &r.SprintID, &r.Tipo, &r.Inicio, &r.Dia,
			&r.Hora, &r.Minutos, &r.Nota, &r.CreadoEn, &r.SubidoEn); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Borrar marca la fila, no la elimina: el análisis histórico no pierde datos por un mis-click.
func (s *Store) Borrar(id int64) error {
	_, err := s.db.Exec(`UPDATE registros SET borrado_en = ? WHERE id = ? AND borrado_en IS NULL`,
		time.Now().Format(time.RFC3339), id)
	return err
}

// GuardarSprint y GuardarTarea upsertean las dimensiones. Se llaman de pasada en cada carga del
// dashboard: navegar el tablero ES la sincronización.
func (s *Store) GuardarSprint(id int64, boardID int, nombre, estado, inicio, fin string) error {
	_, err := s.db.Exec(`INSERT INTO sprints (id, board_id, nombre, estado, inicio, fin, visto_en)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, estado=excluded.estado,
			inicio=excluded.inicio, fin=excluded.fin, visto_en=excluded.visto_en`,
		id, boardID, nombre, estado, inicio, fin, time.Now().Format(time.RFC3339))
	return err
}

func (s *Store) GuardarTarea(clave, resumen string, puntos *float64, estado, categoria string, sprintID int64) error {
	_, err := s.db.Exec(`INSERT INTO tareas (clave, resumen, puntos, estado, categoria, sprint_id, visto_en)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(clave) DO UPDATE SET resumen=excluded.resumen, puntos=excluded.puntos,
			estado=excluded.estado, categoria=excluded.categoria, sprint_id=excluded.sprint_id,
			visto_en=excluded.visto_en`,
		clave, resumen, puntos, estado, categoria, sprintID, time.Now().Format(time.RFC3339))
	return err
}

// nulo/nuloN: "" y 0 se guardan como NULL para que los agregados (COUNT, GROUP BY tarea) no traten
// "sin valor" como un valor más.
func nulo(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nuloN(n int64) any {
	if n == 0 {
		return nil
	}
	return n
}
