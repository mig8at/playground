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
  etapas    TEXT NOT NULL,  -- antes de elegir lender
  etapas_lender TEXT NOT NULL DEFAULT '[]', -- dentro de un intento
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

-- Un INTENTO es la solicitud yendo por un lender. Tiene id propio, su propio cursor y su
-- propio estado, y NO se borra al abandonarlo: se queda con la historia de hasta dónde
-- llegó. Es el nivel que en CreditOp no existe — ahí user_requests YA es el intento
-- (tiene lender_id) pero no hay nada por encima que los agrupe: un mismo usuario tuvo
-- 7 filas con 3 lenders el mismo día y lo único que las une es adivinar por fecha.
CREATE TABLE IF NOT EXISTS intentos (
  id           TEXT PRIMARY KEY,
  solicitud_id TEXT NOT NULL,
  lender       TEXT NOT NULL,
  etapas       TEXT NOT NULL,
  paso_actual  INTEGER NOT NULL DEFAULT 0,
  estado       TEXT NOT NULL DEFAULT 'abierto', -- abierto | abandonado | completado
  creado       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intentos_solicitud ON intentos (solicitud_id);

-- Los lenders que se le ofrecen. Semilla: el filtrado real (cupo, reglas por comercio,
-- datacrédito) es otro problema y no es el que este prototipo está probando.
CREATE TABLE IF NOT EXISTS lenders (
  lender TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  nota   TEXT NOT NULL DEFAULT ''
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

-- El evento SIEMPRE es de la solicitud, y OPCIONALMENTE de un intento. Así se puede leer
-- la historia completa ("empezó con A, lo dejó en el paso 2, arrancó con B") o la de un
-- intento solo — que es lo que hace falta para validar qué pasó.
CREATE TABLE IF NOT EXISTS eventos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  solicitud_id TEXT NOT NULL,
  intento_id   TEXT NOT NULL DEFAULT '',
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
// `campos` es la mitad que faltaba: el backend ya decidía la SECUENCIA, ahora también
// el CONTENIDO. Y cada campo es una REFERENCIA a una clave del diccionario —no un nombre
// inventado por este formulario—, así que hereda el tipo y el significado. Es lo que
// form-engine no podía hacer: sus campos eran anónimos, cada schema inventaba su
// vocabulario.
const etapasCO = `[
  {"etapa":"celular","titulo":"Tu celular","pasos":["telefono","otp"]},
  {"etapa":"perfil","titulo":"Tus datos","pasos":["perfil"],
   "campos":{"perfil":[
     {"clave":"firstName","label":"Primer nombre","requerido":true},
     {"clave":"lastName","label":"Primer apellido","requerido":true},
     {"clave":"docType","label":"Tipo de documento","requerido":true,
      "ayuda":"CC o CE","patron":"^(CC|CE)$"},
     {"clave":"docNumber","label":"Número de documento","requerido":true,
      "patron":"^[0-9]{6,10}$"}
   ]}}
]`

// Lo que corre DENTRO de un intento, una vez elegido el lender. Por ahora es igual para
// todos; que dependa del lender es una columna más — y es justo la variación que hoy en
// el monorepo son 216 archivos.
const etapasLender = `[
  {"etapa":"solicitud","titulo":"Tu solicitud","pasos":["monto"],
   "campos":{"monto":[
     {"clave":"requestedAmount","label":"¿Cuánto necesitás?","requerido":true,
      "patron":"^[0-9]{5,9}$","ayuda":"En pesos, sin puntos"}
   ]}}
]`

var semillas = []struct {
	comercio, entidad, pais, etapas, etapasLender string
}{
	{"pullman", "credipullman", "CO", etapasCO, etapasLender},
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
	// `plantillas` NO se puede rehacer como el catálogo: las solicitudes la referencian.
	// Una columna nueva entra con ALTER; el error se ignora porque el caso normal es
	// "ya está".
	db.Exec(`ALTER TABLE plantillas ADD COLUMN etapas_lender TEXT NOT NULL DEFAULT '[]'`)
	db.Exec(`ALTER TABLE eventos ADD COLUMN intento_id TEXT NOT NULL DEFAULT ''`)
	sembrar(db)
	abrirBuros(db)
	validarCampos(db)
	return db
}

// El seed es un UPSERT: si cambia el catálogo o la plantilla, la BD converge sin
// borrar el archivo (y sin perder las solicitudes de ayer).
func sembrar(db *sql.DB) {
	for _, c := range catalogo {
		db.Exec(`INSERT INTO componentes (tipo, label, efecto) VALUES (?,?,?)`,
			c.tipo, c.label, c.efecto)
	}
	db.Exec(`DELETE FROM lenders`)
	for _, l := range [][3]string{
		{"bancolombia", "Bancolombia", "el banco decide por fuera (redirect)"},
		{"credipullman", "CrediPullman", "capital del comercio, decide en plataforma"},
		{"welli", "Welli", "agregador"},
	} {
		db.Exec(`INSERT INTO lenders (lender, nombre, nota) VALUES (?,?,?)`, l[0], l[1], l[2])
	}
	for _, s := range semillas {
		var compacto any
		json.Unmarshal([]byte(s.etapas), &compacto)
		crudo, _ := json.Marshal(compacto)
		var compactoL any
		json.Unmarshal([]byte(s.etapasLender), &compactoL)
		crudoL, _ := json.Marshal(compactoL)
		db.Exec(`INSERT INTO plantillas (comercio, entidad, pais, etapas, etapas_lender) VALUES (?,?,?,?,?)
		         ON CONFLICT(comercio, entidad, pais) DO UPDATE SET etapas = excluded.etapas,
		           etapas_lender = excluded.etapas_lender`,
			s.comercio, s.entidad, s.pais, string(crudo), string(crudoL))
	}
}


// validarCampos corre DESPUÉS de sembrar el diccionario: cada campo de cada plantilla
// tiene que referenciar una clave que exista. Es la misma guarda que ya tienen los
// proveedores, extendida a los formularios — un formulario que captura un nombre que
// nadie más conoce es cómo vuelven los sinónimos por la puerta de atrás.
func validarCampos(db *sql.DB) {
	filas, err := db.Query(`SELECT comercio, entidad, pais, etapas, etapas_lender FROM plantillas`)
	if err != nil {
		log.Fatalf("validar campos: %v", err)
	}
	defer filas.Close()

	type fila struct{ comercio, entidad, pais, etapas, etapasLender string }
	var todas []fila
	for filas.Next() {
		var f fila
		if filas.Scan(&f.comercio, &f.entidad, &f.pais, &f.etapas, &f.etapasLender) == nil {
			todas = append(todas, f)
		}
	}
	for _, f := range todas {
		var etapas []etapa
		json.Unmarshal([]byte(f.etapas), &etapas)
		var deLender []etapa
		json.Unmarshal([]byte(f.etapasLender), &deLender)
		etapas = append(etapas, deLender...)
		for _, e := range etapas {
			for paso, campos := range e.Campos {
				for _, c := range campos {
					var existe int
					db.QueryRow(`SELECT COUNT(*) FROM claves WHERE clave = ?`, c.Clave).Scan(&existe)
					if existe == 0 {
						log.Fatalf("la plantilla %s/%s/%s pide en el paso %q el campo %q, que no está en el diccionario",
							f.comercio, f.entidad, f.pais, paso, c.Clave)
					}
				}
			}
		}
	}
}
