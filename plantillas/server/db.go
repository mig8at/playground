package main

import (
	"database/sql"
	"encoding/json"
	"log"

	_ "modernc.org/sqlite"
)

// El esquema es la tesis del prototipo: el CATÁLOGO de componentes es cerrado y la
// VARIACIÓN —qué ve cada (comercio, entidad, país)— es una FILA.
//
// Y la unidad de la fila son ETAPAS, no pasos: "validá tu celular" es UNA cosa para
// la persona aunque por debajo sean dos componentes (pedir el número y verificar el
// código). Eso es lo que hace que volver atrás desde el perfil devuelva al número y
// no al código: se retrocede de etapa, no de pantalla.
//
// El id que viaja en el URL es el de la SOLICITUD —el equivalente de `user_requests`
// en CreditOp—, no un "paso": el paso lo contesta el server y así no hay nada que
// manipular desde la barra de direcciones.
const esquema = `
CREATE TABLE IF NOT EXISTS componentes (
  tipo        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  efecto      TEXT NOT NULL,
  reversible  INTEGER NOT NULL DEFAULT 1,
  deshace     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS plantillas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  comercio  TEXT NOT NULL,
  entidad   TEXT NOT NULL,
  pais      TEXT NOT NULL,
  etapas    TEXT NOT NULL,
  UNIQUE (comercio, entidad, pais)
);

CREATE TABLE IF NOT EXISTS solicitudes (
  id           TEXT PRIMARY KEY,
  plantilla_id INTEGER NOT NULL,
  etapas       TEXT NOT NULL, -- SNAPSHOT de la plantilla al crear la solicitud
  paso_actual  INTEGER NOT NULL DEFAULT 0, -- índice PLANO sobre los pasos aplanados
  estado       TEXT NOT NULL DEFAULT 'abierta',
  creada       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS valores (
  solicitud_id TEXT NOT NULL,
  campo        TEXT NOT NULL,
  valor        TEXT NOT NULL,
  PRIMARY KEY (solicitud_id, campo)
);

CREATE TABLE IF NOT EXISTS otp (
  solicitud_id TEXT PRIMARY KEY,
  hash         TEXT NOT NULL,
  expira       TEXT NOT NULL,
  intentos     INTEGER NOT NULL DEFAULT 0,
  verificado   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS eventos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  ts           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eventos_solicitud ON eventos (solicitud_id, id);
`

// El catálogo. Cada componente declara TRES cosas: qué pinta (su .vue), qué hace en
// backend (`efecto`) y qué pasa si alguien retrocede por encima suyo (`reversible` +
// `deshace`). El tercer contrato es el que hace posible el "atrás" sin dejar basura.
var catalogo = []struct {
	tipo, label, efecto string
	reversible          bool
	deshace             string
}{
	{"telefono", "Teléfono", "valida prefijo y longitud según el país de la solicitud; guarda en valores", true,
		"nada: el número queda como borrador para poder corregirlo"},
	{"otp", "Código de verificación", "genera y verifica un código de 6 dígitos con vencimiento e intentos", true,
		"borra el código pendiente o verificado: el viejo no vale para otro número"},
	{"perfil", "Perfil del usuario", "todavía nada: pantalla de texto, sin captura", true, "nada"},
}

// Una plantilla, Colombia. Dos etapas: validar el celular (dos componentes, una sola
// cosa para la persona) y el perfil. `al_volver` es la pregunta que se le hace al
// usuario antes de retroceder — también es dato, no está cableada en el front.
const etapasCO = `[
  {"etapa":"celular","titulo":"Tu celular","pasos":["telefono","otp"],
   "al_volver":"¿Querés cambiar el número de teléfono? Vas a tener que verificarlo otra vez."},
  {"etapa":"perfil","titulo":"Tu perfil","pasos":["perfil"],"al_volver":""}
]`

var semillas = []struct {
	comercio, entidad, pais, etapas string
}{
	{"pullman", "credipullman", "CO", etapasCO},
}

func abrirDB(ruta string) *sql.DB {
	db, err := sql.Open("sqlite", ruta+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		log.Fatalf("abrir sqlite: %v", err)
	}
	if _, err := db.Exec(esquema); err != nil {
		log.Fatalf("esquema: %v", err)
	}
	sembrar(db)
	return db
}

// El seed es un UPSERT: si cambia el catálogo o la plantilla, la BD converge sin
// borrar el archivo (y sin perder las solicitudes de ayer).
func sembrar(db *sql.DB) {
	for _, c := range catalogo {
		rev := 0
		if c.reversible {
			rev = 1
		}
		db.Exec(`INSERT INTO componentes (tipo, label, efecto, reversible, deshace) VALUES (?,?,?,?,?)
		         ON CONFLICT(tipo) DO UPDATE SET label = excluded.label, efecto = excluded.efecto,
		           reversible = excluded.reversible, deshace = excluded.deshace`,
			c.tipo, c.label, c.efecto, rev, c.deshace)
	}
	for _, s := range semillas {
		var compacto any
		json.Unmarshal([]byte(s.etapas), &compacto)
		crudo, _ := json.Marshal(compacto)
		db.Exec(`INSERT INTO plantillas (comercio, entidad, pais, etapas) VALUES (?,?,?,?)
		         ON CONFLICT(comercio, entidad, pais) DO UPDATE SET etapas = excluded.etapas`,
			s.comercio, s.entidad, s.pais, string(crudo))
	}
}

// esReversible lee el flag del catálogo. Falla CERRADO: un tipo que no está en el
// catálogo no se puede deshacer, porque no sabemos qué dejó hecho.
func (s *srv) esReversible(tipo string) bool {
	var rev int
	if err := s.db.QueryRow(`SELECT reversible FROM componentes WHERE tipo = ?`, tipo).Scan(&rev); err != nil {
		return false
	}
	return rev == 1
}
