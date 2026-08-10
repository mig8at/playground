package main

import (
	"database/sql"
	"encoding/json"
	"log"

	_ "modernc.org/sqlite"
)

// El esquema es la tesis del prototipo: el CATÁLOGO de componentes es cerrado y
// vive en código-adyacente (una tabla que se siembra), y la VARIACIÓN —qué pasos
// ve cada (comercio, entidad, país)— es una FILA. Agregar un país no compila nada.
const esquema = `
CREATE TABLE IF NOT EXISTS componentes (
  tipo        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  efecto      TEXT NOT NULL   -- qué hace en backend, no solo qué pinta
);

CREATE TABLE IF NOT EXISTS plantillas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  comercio  TEXT NOT NULL,
  entidad   TEXT NOT NULL,
  pais      TEXT NOT NULL,
  pasos     TEXT NOT NULL,    -- JSON: ["telefono","otp","datos"]
  UNIQUE (comercio, entidad, pais)
);

CREATE TABLE IF NOT EXISTS sesiones (
  id           TEXT PRIMARY KEY,
  plantilla_id INTEGER NOT NULL,
  pasos        TEXT NOT NULL, -- SNAPSHOT de la plantilla al crear la sesión
  paso_actual  INTEGER NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'abierta',
  creada       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS valores (
  sesion_id TEXT NOT NULL,
  campo     TEXT NOT NULL,
  valor     TEXT NOT NULL,
  PRIMARY KEY (sesion_id, campo)
);

CREATE TABLE IF NOT EXISTS otp (
  sesion_id TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  expira    TEXT NOT NULL,
  intentos  INTEGER NOT NULL DEFAULT 0,
  verificado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS eventos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sesion_id TEXT NOT NULL,
  tipo      TEXT NOT NULL,
  payload   TEXT NOT NULL,
  ts        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eventos_sesion ON eventos (sesion_id, id);
`

// El catálogo: cada componente entra con su EFECTO declarado. Un componente que
// solo sabe pintarse es lo que dejó a form-engine sin backend que lo sirviera.
var catalogo = [][3]string{
	{"telefono", "Teléfono", "valida prefijo y longitud según país; guarda en valores"},
	{"otp", "Código de verificación", "genera y verifica un código de 6 dígitos con vencimiento e intentos"},
	{"datos", "Datos del titular", "captura campos del titular; guarda en valores (EAV)"},
}

// Dos plantillas con secuencias DISTINTAS y el mismo código corriendo: es lo que
// el prototipo tiene que demostrar. La de Perú es más corta a propósito — es la
// forma real del caso BCP (iframe + teléfono + OTP), sin captura de datos propia.
var semillas = []struct {
	comercio, entidad, pais string
	pasos                   []string
}{
	{"pullman", "credipullman", "CO", []string{"telefono", "otp", "datos"}},
	{"bcp", "cuotealo", "PE", []string{"telefono", "otp"}},
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

func sembrar(db *sql.DB) {
	for _, c := range catalogo {
		db.Exec(`INSERT OR IGNORE INTO componentes (tipo, label, efecto) VALUES (?,?,?)`, c[0], c[1], c[2])
	}
	for _, s := range semillas {
		pasos, _ := json.Marshal(s.pasos)
		db.Exec(`INSERT OR IGNORE INTO plantillas (comercio, entidad, pais, pasos) VALUES (?,?,?,?)`,
			s.comercio, s.entidad, s.pais, string(pasos))
	}
}
