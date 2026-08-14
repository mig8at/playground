import { DatabaseSync } from 'node:sqlite'
import { randomBytes, createHash } from 'node:crypto'

/* ═══ LA BASE ═══════════════════════════════════════════════════════════════════════════════════
   SQLite del propio Node (`node:sqlite`): sin dependencias, un archivo, y transacciones de verdad.

   QUÉ SE GUARDA ACÁ: solo lo DECLARADO — lo que ninguna API puede saber sola.
     · qué épicas existen y cómo se llaman
     · quiénes están en cada una
     · en qué repos se toca y desde qué rama sale cada uno
     · qué rama pertenece a qué épica y de quién es
     · la documentación

   QUÉ NO DEBERÍA GUARDARSE: el estado de una rama (si hay PR, si está aprobada, cuántos días
   lleva). Eso se deriva de GitHub. Las columnas `estado/dias/pr/mas/men` existen igual porque
   todavía no hay GitHub conectado y sin ellas el tablero se ve plano; el día que la GitHub App
   exista, se dejan de escribir y se llenan al leer. Están agrupadas al final de la tabla y
   marcadas para que se note que son las prestadas.                                              */

const ESQUEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS epicas (
  id      TEXT PRIMARY KEY,
  nombre  TEXT NOT NULL,
  creada  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS epica_devs (
  epica TEXT NOT NULL REFERENCES epicas(id) ON DELETE CASCADE,
  quien TEXT NOT NULL,
  orden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (epica, quien)
);

CREATE TABLE IF NOT EXISTS epica_repos (
  epica TEXT NOT NULL REFERENCES epicas(id) ON DELETE CASCADE,
  repo  TEXT NOT NULL,
  base  TEXT NOT NULL,
  PRIMARY KEY (epica, repo)
);

/* La clave es (epica, repo, rama): la MISMA rama puede existir en dos repos —pasa siempre, un
   feature que toca back y front usa el mismo nombre— y son dos filas distintas. */
CREATE TABLE IF NOT EXISTS ramas (
  epica  TEXT NOT NULL REFERENCES epicas(id) ON DELETE CASCADE,
  repo   TEXT NOT NULL,
  rama   TEXT NOT NULL,
  autor  TEXT NOT NULL,
  base   TEXT,
  nota   TEXT NOT NULL DEFAULT '',
  -- prestadas hasta que GitHub las provea:
  estado TEXT NOT NULL DEFAULT 'desarrollo',
  dias   INTEGER NOT NULL DEFAULT 0,
  pr     INTEGER,
  mas    INTEGER NOT NULL DEFAULT 0,
  men    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (epica, repo, rama)
);

/* Las sesiones dejaron de vivir en memoria: con las escrituras pidiendo autenticación, reiniciar
   el server dejaba a todo el mundo sin poder usar la app hasta volver a entrar. */
CREATE TABLE IF NOT EXISTS sesiones (
  sid    TEXT PRIMARY KEY,
  login  TEXT NOT NULL,
  nombre TEXT NOT NULL,
  avatar TEXT,
  token  TEXT,              -- token de GitHub, para consultar la org en nombre de esta persona
  vence  INTEGER NOT NULL   -- epoch en ms
);

/* Tokens personales para que un agente use la API. Se guarda el HASH, no el token: si alguien se
   lleva el archivo .db, no se lleva llaves que funcionen. El texto plano se muestra UNA vez. */
CREATE TABLE IF NOT EXISTS tokens (
  id     TEXT PRIMARY KEY,
  hash   TEXT NOT NULL UNIQUE,
  login  TEXT NOT NULL,
  nota   TEXT NOT NULL DEFAULT '',
  creado TEXT NOT NULL,
  usado  TEXT
);

/* login de GitHub → persona del tablero. Vivía solo en el front, pero el server lo necesita para
   saber de quién es un token: el token dice mig-creditop y las épicas dicen miguel. */
CREATE TABLE IF NOT EXISTS identidades (
  login TEXT PRIMARY KEY,
  quien TEXT NOT NULL
);

/* Quién aprobó qué PR. Es dato DERIVADO de GitHub (GET /pulls/{n}/reviews, state APPROVED), no
   declarado: nadie debería poder decir «yo aprobé esto» desde la app. Hasta que exista la GitHub
   App se llena con npm run simular, igual que los estados.
   demora = cuántos días esperó el PR antes de esta aprobación. Es lo que distingue revisar de
   pasar el sello: un contador de aprobaciones a secas premia al que aprueba sin mirar. */
CREATE TABLE IF NOT EXISTS aprobaciones (
  epica  TEXT NOT NULL REFERENCES epicas(id) ON DELETE CASCADE,
  repo   TEXT NOT NULL,
  rama   TEXT NOT NULL,
  quien  TEXT NOT NULL,
  demora INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (epica, repo, rama, quien)
);

CREATE TABLE IF NOT EXISTS docs (
  epica  TEXT NOT NULL REFERENCES epicas(id) ON DELETE CASCADE,
  quien  TEXT NOT NULL,
  texto  TEXT NOT NULL DEFAULT '',
  trampa TEXT NOT NULL DEFAULT '',
  dias   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (epica, quien)
);
`

let db

/* Las docs pasaron de dos campos (`texto` + `trampa`) a uno solo en markdown. Lo ya escrito NO se
   pierde: la trampa se dobla dentro del texto como una sección, y la columna se vacía para que la
   migración no se repita. Corre en cada arranque y es idempotente — sin esto, lo que alguien
   escribió en «Ojo con esto» dejaba de mostrarse sin explicación. */
function migrarDocs(){
  const viejas = db.prepare("SELECT epica, quien, texto, trampa FROM docs WHERE trampa <> ''").all()
  if (!viejas.length) return
  const up = db.prepare("UPDATE docs SET texto = ?, trampa = '' WHERE epica = ? AND quien = ?")
  for (const d of viejas) {
    const junto = [d.texto.trim(), `## Ojo con esto\n${d.trampa.trim()}`].filter(Boolean).join('\n\n')
    up.run(junto, d.epica, d.quien)
  }
  console.log(`  migradas ${viejas.length} doc(s): «Ojo con esto» quedó dentro del texto`)
}

export function abrir(archivo){
  db = new DatabaseSync(archivo)
  db.exec(ESQUEMA)
  migrarDocs()

  // `INSERT OR IGNORE`: si alguien ya ató un login a otra persona a mano, no se le pisa.
  const iId = db.prepare('INSERT OR IGNORE INTO identidades (login, quien) VALUES (?, ?)')
  for (const [login, quien] of IDENTIDADES_BASE) iId.run(login, quien)
  db.prepare('DELETE FROM sesiones WHERE vence < ?').run(Date.now())
  /* Una épica de arranque para que la app no abra en blanco la primera vez, CON una rama en cada
     estado: si todo arranca en «desarrollo», la mitad del tablero (Revisión, el represamiento, «lo
     más trabado») abre en cero y no se entiende para qué está. */
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM epicas').get()
  if (n === 0) {
    const id = crearEpica({
      nombre: 'example',
      devs: ['miguel'],
      repos: [{ repo: 'legacy-backend', base: 'develop' },
              { repo: 'frontend-monorepo', base: 'develop' }],
    })
    agregarRama(id, { repo:'legacy-backend', rama:'feature/pais-como-dato', autor:'miguel',
                      base:'develop', nota:'el árbol país→depto→ciudad y su seeder' })
    simularEstado(id, 'legacy-backend', 'feature/pais-como-dato',
                  { estado:'aprobacion', dias:5, pr:1479, mas:520, men:143 })

    agregarRama(id, { repo:'frontend-monorepo', rama:'feat/country-selector-wizard', autor:'miguel',
                      base:'develop', nota:'el selector en el wizard' })
    simularEstado(id, 'frontend-monorepo', 'feat/country-selector-wizard',
                  { estado:'desarrollo', dias:1, mas:112, men:8 })

    agregarRama(id, { repo:'legacy-backend', rama:'feat/pais-seed-countries', autor:'miguel',
                      base:'develop' })
    simularEstado(id, 'legacy-backend', 'feat/pais-seed-countries',
                  { estado:'mergeada', dias:9, pr:1461, mas:240, men:4 })
  }
  return db
}

/* ── lectura ─────────────────────────────────────────────────────────────────────────────────
   Una épica se arma con cuatro consultas y no con un JOIN gigante: el JOIN devuelve el producto
   cartesiano de devs × repos × ramas y hay que des-duplicar a mano, que es más código y más
   fácil de romper. Con estos volúmenes la diferencia de velocidad no existe. */
export function epicas(){
  return db.prepare('SELECT * FROM epicas ORDER BY creada DESC').all().map(armar)
}

export function epica(id){
  const e = db.prepare('SELECT * FROM epicas WHERE id = ?').get(id)
  return e ? armar(e) : null
}

function armar(e){
  const devs = db.prepare('SELECT quien FROM epica_devs WHERE epica = ? ORDER BY orden, quien').all(e.id)
  const repos = db.prepare('SELECT repo, base FROM epica_repos WHERE epica = ? ORDER BY repo').all(e.id)
  const ramas = db.prepare('SELECT repo, rama, autor, base, nota, estado, dias, pr, mas, men FROM ramas WHERE epica = ?').all(e.id)
  const aprob = db.prepare('SELECT repo, rama, quien, demora FROM aprobaciones WHERE epica = ?').all(e.id)
  for (const r of ramas) {
    r.aprobada = aprob.filter(a => a.repo === r.repo && a.rama === r.rama)
                      .map(a => ({ quien: a.quien, demora: a.demora }))
  }
  const filasDoc = db.prepare('SELECT quien, texto, trampa, dias FROM docs WHERE epica = ?').all(e.id)
  const docs = {}
  for (const d of filasDoc) docs[d.quien] = { texto: d.texto, trampa: d.trampa, dias: d.dias }
  return { id: e.id, nombre: e.nombre, devs: devs.map(d => d.quien), repos, ramas, docs }
}

/* ── escritura ───────────────────────────────────────────────────────────────────────────────
   Todo lo que toca más de una tabla va en una transacción: una épica a medio crear —con nombre
   pero sin repos— pasa los chequeos del front y después no se entiende de dónde salió. */
const enTx = fn => (...args) => {
  db.exec('BEGIN')
  try { const r = fn(...args); db.exec('COMMIT'); return r }
  catch (e) { db.exec('ROLLBACK'); throw e }
}

const babosa = txt =>
  txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, "")
     .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export const crearEpica = enTx(({ nombre, devs, repos }) => {
  const raiz = babosa(nombre) || 'epica'
  let id = raiz, n = 2
  while (db.prepare('SELECT 1 FROM epicas WHERE id = ?').get(id)) id = `${raiz}-${n++}`

  db.prepare('INSERT INTO epicas (id, nombre, creada) VALUES (?, ?, datetime())').run(id, nombre)
  const iDev = db.prepare('INSERT INTO epica_devs (epica, quien, orden) VALUES (?, ?, ?)')
  devs.forEach((q, i) => iDev.run(id, q, i))
  const iRepo = db.prepare('INSERT INTO epica_repos (epica, repo, base) VALUES (?, ?, ?)')
  for (const r of repos) iRepo.run(id, r.repo, r.base)
  return id
})

export const borrarEpica = id => db.prepare('DELETE FROM epicas WHERE id = ?').run(id)

export const renombrar = (id, nombre) =>
  db.prepare('UPDATE epicas SET nombre = ? WHERE id = ?').run(nombre, id)

export function agregarDev(id, quien){
  const { n } = db.prepare('SELECT COALESCE(MAX(orden), -1) + 1 AS n FROM epica_devs WHERE epica = ?').get(id)
  db.prepare('INSERT OR IGNORE INTO epica_devs (epica, quien, orden) VALUES (?, ?, ?)').run(id, quien, n)
}

/* Sacar a alguien NO borra sus ramas ni su documentación: el trabajo que ya hizo sigue siendo parte
   de la épica. Sacarlo significa «ya no está asignado», no «nunca estuvo». */
export const quitarDev = (id, quien) =>
  db.prepare('DELETE FROM epica_devs WHERE epica = ? AND quien = ?').run(id, quien)

export const agregarRepo = (id, repo, base) =>
  db.prepare('INSERT OR REPLACE INTO epica_repos (epica, repo, base) VALUES (?, ?, ?)').run(id, repo, base)

// Quitar un repo SÍ se lleva sus ramas: sin el repo declarado, esas ramas quedarían huérfanas en
// una épica que ya no dice tocar ese código.
export const quitarRepo = enTx((id, repo) => {
  db.prepare('DELETE FROM ramas WHERE epica = ? AND repo = ?').run(id, repo)
  db.prepare('DELETE FROM epica_repos WHERE epica = ? AND repo = ?').run(id, repo)
})

export function agregarRama(id, { repo, rama, autor, base, nota }){
  db.prepare(`INSERT OR IGNORE INTO ramas (epica, repo, rama, autor, base, nota)
              VALUES (?, ?, ?, ?, ?, ?)`).run(id, repo, rama, autor, base ?? null, nota ?? '')
}

export const quitarRama = (id, repo, rama) =>
  db.prepare('DELETE FROM ramas WHERE epica = ? AND repo = ? AND rama = ?').run(id, repo, rama)


/* ═══ IDENTIDAD, SESIONES Y TOKENS ══════════════════════════════════════════════════════════════ */

// Los tres logins que aparecen firmando ramas en origin. El resto se completa cuando cada quien
// entre: GitHub devuelve su `login` exacto y ahí se ata, sin adivinar.
const IDENTIDADES_BASE = [
  ['mig-creditop', 'miguel'],
  ['lhCabra-creditop', 'lucho'],
  ['joseesco24-creditop', 'jose'],
]

export const quienEs = login =>
  db.prepare('SELECT quien FROM identidades WHERE login = ?').get(login)?.quien ?? null


// ── sesiones
const VIDA_SESION = 8 * 3600 * 1000

export function guardarSesion({ login, nombre, avatar, token }){
  const sid = randomBytes(24).toString('hex')
  db.prepare(`INSERT INTO sesiones (sid, login, nombre, avatar, token, vence)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(sid, login, nombre, avatar ?? null, token ?? null, Date.now() + VIDA_SESION)
  return sid
}

export function leerSesion(sid){
  if (!sid) return null
  const s = db.prepare('SELECT * FROM sesiones WHERE sid = ?').get(sid)
  if (!s) return null
  // Vencida: se borra al leerla. Así la limpieza no necesita un cron.
  if (s.vence < Date.now()) { borrarSesion(sid); return null }
  return s
}

export const borrarSesion = sid => db.prepare('DELETE FROM sesiones WHERE sid = ?').run(sid)

// ── tokens
const hashear = t => createHash('sha256').update(t).digest('hex')

/* El token se devuelve UNA vez, en texto plano, y no se puede recuperar después: en la base solo
   queda el hash. El prefijo `cua_` es para que se reconozca de un vistazo en un `.env` ajeno y para
   poder buscarlo si alguien lo pega donde no debía. */
export function crearToken(login, nota){
  const plano = `cua_${randomBytes(24).toString('base64url')}`
  const id = randomBytes(8).toString('hex')
  db.prepare(`INSERT INTO tokens (id, hash, login, nota, creado) VALUES (?, ?, ?, ?, datetime())`)
    .run(id, hashear(plano), login, (nota ?? '').trim().slice(0, 60))
  return { id, plano }
}

export const tokensDe = login =>
  db.prepare('SELECT id, nota, creado, usado FROM tokens WHERE login = ? ORDER BY creado DESC').all(login)

export const revocarToken = (login, id) =>
  db.prepare('DELETE FROM tokens WHERE login = ? AND id = ?').run(login, id)

/* Busca por hash, no por texto: la comparación la hace SQLite sobre un índice único, así que no
   hace falta recorrer nada. `usado` se pisa en cada uso — sirve para que la UI muestre si un token
   está vivo o quedó olvidado. */
export function porToken(plano){
  if (!plano?.startsWith('cua_')) return null
  const t = db.prepare('SELECT id, login, nota FROM tokens WHERE hash = ?').get(hashear(plano))
  if (!t) return null
  db.prepare("UPDATE tokens SET usado = datetime() WHERE id = ?").run(t.id)
  return t
}

/* ⚠ SIMULACIÓN, no una operación del producto. Escribe los campos que en producción va a traer
   GitHub (`estado`, `dias`, `pr`, `mas`, `men`). No hay endpoint HTTP para esto a propósito: el
   progreso no se declara, se deriva —si se pudiera tocar desde la UI, en dos semanas nadie sabría
   si un «por aprobación» es real o lo puso alguien a mano—. Se usa desde `server/simular.js`.
   Cuando la GitHub App exista, esta función y ese script se borran juntos. */
/* ⚠ SIMULACIÓN, igual que `simularEstado`: no hay endpoint HTTP para esto y no debe haberlo. Que
   alguien pueda registrarse aprobaciones a sí mismo convierte el podio en un formulario. */
export function simularAprobacion(id, repo, rama, quien, demora = 1){
  return db.prepare(`INSERT OR REPLACE INTO aprobaciones (epica, repo, rama, quien, demora)
                     VALUES (?, ?, ?, ?, ?)`).run(id, repo, rama, quien, demora)
}

export function simularEstado(id, repo, rama, { estado, dias = 0, pr = null, mas = 0, men = 0 }){
  return db.prepare(`UPDATE ramas SET estado = ?, dias = ?, pr = ?, mas = ?, men = ?
                     WHERE epica = ? AND repo = ? AND rama = ?`)
           .run(estado, dias, pr, mas, men, id, repo, rama)
}

/* La documentación es UN campo markdown. La columna `trampa` sigue existiendo pero ya no se
   escribe: se conserva como respaldo de lo que se escribió cuando eran dos campos —borrar una
   columna en SQLite es reconstruir la tabla, y no vale el riesgo por un campo vacío—. */
export function guardarDoc(id, quien, { texto }){
  const t = (texto ?? '').trim()
  if (!t) return db.prepare('DELETE FROM docs WHERE epica = ? AND quien = ?').run(id, quien)
  return db.prepare(`INSERT INTO docs (epica, quien, texto, dias) VALUES (?, ?, ?, 0)
                     ON CONFLICT(epica, quien) DO UPDATE SET texto = ?, dias = 0`)
           .run(id, quien, t, t)
}
