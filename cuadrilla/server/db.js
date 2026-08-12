import { DatabaseSync } from 'node:sqlite'

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

export function abrir(archivo){
  db = new DatabaseSync(archivo)
  db.exec(ESQUEMA)
  // Una épica de arranque para que la app no abra en blanco la primera vez.
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM epicas').get()
  if (n === 0) {
    crearEpica({
      nombre: 'example',
      devs: ['miguel'],
      repos: [{ repo: 'legacy-backend', base: 'develop' },
              { repo: 'frontend-monorepo', base: 'develop' }],
    })
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

// Vaciar los dos campos borra la entrada: una doc vacía es ruido, no un dato.
export function guardarDoc(id, quien, { texto, trampa }){
  const t = (texto ?? '').trim(), tr = (trampa ?? '').trim()
  if (!t && !tr) return db.prepare('DELETE FROM docs WHERE epica = ? AND quien = ?').run(id, quien)
  return db.prepare(`INSERT INTO docs (epica, quien, texto, trampa, dias) VALUES (?, ?, ?, ?, 0)
                     ON CONFLICT(epica, quien) DO UPDATE SET texto = ?, trampa = ?, dias = 0`)
           .run(id, quien, t, tr, t, tr)
}
