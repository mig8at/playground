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
// código). La etapa es lo que se le muestra como progreso.
//
// El id que viaja en el URL es el de la SOLICITUD —el equivalente de `user_requests`
// en CreditOp—, no un "paso": el paso lo contesta el server y así no hay nada que
// manipular desde la barra de direcciones.
const esquema = `
CREATE TABLE IF NOT EXISTS componentes (
  tipo        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  efecto      TEXT NOT NULL
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

// El catálogo. Cada componente declara qué pinta (su .vue) y qué hace en backend
// (`efecto`). NO declara cómo deshacerse: volver atrás es reiniciar la solicitud
// entera, una sola regla para todos, en vez de un contrato de undo por componente.
// (Se probó lo otro y para dos componentes era maquinaria de más.)
var catalogo = []struct {
	tipo, label, efecto string
}{
	{"telefono", "Teléfono", "valida prefijo y longitud según el país de la solicitud; guarda en valores"},
	{"otp", "Código de verificación", "genera y verifica un código de 6 dígitos con vencimiento e intentos"},
	{"perfil", "Perfil del usuario", "todavía nada: pantalla de texto, sin captura"},
}

// Una plantilla, Colombia. Dos etapas: validar el celular (dos componentes, una sola
// cosa para la persona) y el perfil.
const etapasCO = `[
  {"etapa":"celular","titulo":"Tu celular","pasos":["telefono","otp"]},
  {"etapa":"perfil","titulo":"Tu perfil","pasos":["perfil"]}
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
	// El catálogo es 100% semilla: se rehace en cada arranque. Así cambiarle columnas
	// no necesita migración ni renombrar el archivo (y no hay dato de nadie ahí).
	db.Exec(`DROP TABLE IF EXISTS componentes`)
	if _, err := db.Exec(esquema); err != nil {
		log.Fatalf("esquema: %v", err)
	}
	sembrar(db)
	abrirBuros(db)
	return db
}

// El seed es un UPSERT: si cambia el catálogo o la plantilla, la BD converge sin
// borrar el archivo (y sin perder las solicitudes de ayer).
func sembrar(db *sql.DB) {
	for _, c := range catalogo {
		db.Exec(`INSERT INTO componentes (tipo, label, efecto) VALUES (?,?,?)`,
			c.tipo, c.label, c.efecto)
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

