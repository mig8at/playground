import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as db from './db.js'
import * as impostor from './impostor.js'

/* ═══ EL SERVIDOR DE SESIÓN ═════════════════════════════════════════════════════════════════════
   Existe por una razón concreta: **el navegador no puede hacer el login de GitHub solo**. El
   endpoint que canjea el `code` por un token (github.com/login/oauth/access_token) no manda
   cabeceras CORS, así que una llamada desde el front muere en el preflight. Y el client secret no
   puede vivir en un bundle que cualquiera abre con F12. De ahí este proceso, y nada más: es un
   canje de código y una cookie.

   Lo que este server hace:  saber QUIÉN sos.
   Lo que NO hace:           traer las ramas. Eso va con una GitHub App de la org y su propio
                             token de instalación — ver README. Los datos de los repos son los
                             mismos para todo el mundo; pedirlos con el token de cada persona
                             multiplica las mismas llamadas y rompe distinto para cada uno cuando
                             a alguien se le vence el token.

   El token de GitHub NUNCA sale de este proceso: el navegador solo recibe una cookie de sesión
   httpOnly. Si el front tuviera un XSS, se lleva la cookie de esta app, no una llave de la org.  */

const PUERTO = Number(process.env.PUERTO) || 8091
const CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? ''
const ORG = process.env.CUADRILLA_ORG ?? 'Creditop-SAS'
const APP_URL = process.env.CUADRILLA_URL ?? 'http://localhost:5197'

/* Salida explícita para trabajar en local mientras la org aprueba la app. Con esto entra CUALQUIER
   cuenta de GitHub, así que solo tiene sentido en localhost. Es una variable propia y ruidosa —no
   «dejar CUADRILLA_ORG vacío»— para que apagar la única puerta del tablero sea una decisión
   deliberada y no el efecto lateral de borrar una línea. */
const SIN_ORG = process.env.CUADRILLA_SKIP_ORG === '1'

const configurado = () => Boolean(CLIENT_ID && CLIENT_SECRET)

/* Las sesiones viven en SQLite (`db.leerSesion` / `db.guardarSesion`). Estaban en memoria, pero al
   exigir autenticación para escribir, cada reinicio del server dejaba a todo el mundo sin poder
   usar la app hasta volver a loguearse. */
const pendientes = new Map()   // state → cuándo se emitió, para el chequeo anti-CSRF

const VIDA_STATE = 10 * 60 * 1000

// La lista de la org cambia poco y cuesta ~10 llamadas armarla: se cachea para todo el proceso,
// no por sesión — es la misma para todos.
const VIDA_CACHE = 5 * 60 * 1000
let cacheMiembros = null
let cacheRepos = null
const cacheRamas = new Map()   // repo → { cuando, datos }

function limpiarPendientes(){
  const corte = Date.now() - VIDA_STATE
  for (const [s, t] of pendientes) if (t < corte) pendientes.delete(s)
}

// Comparación en tiempo constante: comparar tokens con === filtra información por el tiempo que
// tarda en fallar. Con `state` el riesgo es bajo, pero el hábito se paga solo.
function igual(a, b){
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

const cookies = req => Object.fromEntries(
  (req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).filter(p => p[0]))

const json = (res, code, cuerpo) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(cuerpo))
}

// Cuerpo JSON sin dependencias. El tope de 1 MB no es por rendimiento: sin límite, un POST
// interminable mantiene el proceso comiendo memoria hasta que se cae.
async function cuerpo(req){
  const trozos = []
  let n = 0
  for await (const t of req) {
    n += t.length
    if (n > 1e6) throw new Error('cuerpo demasiado grande')
    trozos.push(t)
  }
  if (!trozos.length) return {}
  return JSON.parse(Buffer.concat(trozos).toString('utf8'))
}

/* ═══ QUIÉN ESTÁ ESCRIBIENDO ════════════════════════════════════════════════════════════════════
   Dos caminos con permisos distintos a propósito:

     · cookie de sesión → una persona en el navegador. Puede escribir por otro: un lead ordenando la
       documentación de la épica es un caso real y útil.
     · Bearer token     → un agente. Solo puede escribir COMO SU DUEÑO. Un token que puede
       suplantar vuelve inverificable el campo `autor`, que es justo lo que este tablero existe
       para saber.

   `quien` es el id del tablero (`miguel`), no el login de GitHub (`mig-creditop`): la tabla
   `identidades` traduce. Si el login no está atado a nadie, el token no puede escribir — y el
   mensaje lo dice, en vez de guardar la doc bajo un id que nadie mira. */
function quienEscribe(req){
  const cabecera = req.headers.authorization ?? ''
  if (cabecera.startsWith('Bearer ')) {
    const t = db.porToken(cabecera.slice(7).trim())
    if (!t) return { error: 'token inválido o revocado', codigo: 401 }
    const quien = db.quienEs(t.login)
    if (!quien) {
      return { error: `el login ${t.login} no está atado a ninguna persona del tablero`, codigo: 409 }
    }
    return { via: 'token', login: t.login, quien, puedeEscribirPorOtro: false }
  }

  const s = db.leerSesion(cookies(req).cuadrilla_sid)
  if (!s) return { error: 'hay que entrar con GitHub, o usar un token', codigo: 401 }
  return { via: 'sesion', login: s.login, quien: db.quienEs(s.login), puedeEscribirPorOtro: true }
}

async function gh(url, token){
  const r = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'cuadrilla',
    },
  })
  if (!r.ok) throw new Error(`GitHub ${r.status} en ${url}`)
  return r.json()
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`)
  const ruta = url.pathname

  try {
    /* ═══ IMPOSTOR ════════════════════════════════════════════════════════════════════════════
       El juego. Va antes que todo porque el stream NO debe pasar por ningún `await cuerpo(req)`
       ni por los chequeos de sesión: es una conexión que se queda abierta, no un pedido que
       responde y termina.

       No pide autenticación: es un juego de oficina y exigir login para jugar es la forma más
       rápida de que nadie juegue. La identidad es el nombre que cada uno escribe. */
    if (ruta.startsWith('/api/impostor')) {
      const accion = ruta.slice('/api/impostor'.length).replace(/^\//, '')

      if (accion === 'eventos') {
        const id = url.searchParams.get('jugador') ?? ''
        return impostor.suscribir(req, res, id)
      }
      if (accion === 'estado' && req.method === 'GET') return json(res, 200, impostor.estado())

      if (req.method === 'POST') {
        const b = await cuerpo(req)
        const jugador = b.jugador ?? ''
        const r = accion === 'entrar'    ? impostor.entrar(b.nombre)
                : accion === 'salir'     ? impostor.salir(jugador)
                : accion === 'arrancar'  ? impostor.arrancar()
                : accion === 'pista'     ? impostor.pista(jugador, b.texto)
                : accion === 'avotar'    ? impostor.aVotar()
                : accion === 'votar'     ? impostor.votar(jugador, b.aQuien)
                : accion === 'reiniciar' ? impostor.reiniciar()
                : { error: 'acción desconocida' }
        return json(res, r?.error ? 400 : 200, r ?? { ok: true })
      }
      return json(res, 405, { error: 'método no soportado' })
    }

    /* ═══ LAS ÉPICAS ══════════════════════════════════════════════════════════════════════════
       Todo lo que se DECLARA vive en SQLite y se toca solo por acá. Las lecturas son abiertas; las
       escrituras piden sesión o token (ver `quienEscribe`). */
    const m = ruta.match(/^\/api\/epicas(?:\/([^/]+))?(?:\/(devs|repos|ramas|docs)(?:\/(.+))?)?$/)
    if (m) {
      const [, id, sub, resto] = m

      /* La puerta única de escritura: un solo lugar donde decidir, en vez de repetir el chequeo en
         los ocho handlers y olvidarlo en uno.

         Un TOKEN solo toca lo suyo: su documentación y sus ramas. El contrato de la épica —nombre,
         quiénes están, qué repos, desde qué rama— es un acuerdo del equipo, y no debería cambiarlo
         un agente en medio de una tarea. Para eso está la sesión del navegador, donde hay una
         persona mirando lo que aprieta. */
      let yo = null
      if (req.method !== 'GET') {
        yo = quienEscribe(req)
        if (yo.error) return json(res, yo.codigo, { error: yo.error })

        const esDeLaEpica = !sub || sub === 'devs' || sub === 'repos'
        if (yo.via === 'token' && esDeLaEpica) {
          return json(res, 403, {
            error: 'un token solo puede tocar tus ramas y tu documentación; ' +
                   'el contrato de la épica se edita desde el navegador',
          })
        }
      }

      if (!id) {
        if (req.method === 'GET') return json(res, 200, db.epicas())
        if (req.method === 'POST') {
          const b = await cuerpo(req)
          if (!b.nombre?.trim()) return json(res, 400, { error: 'falta el nombre' })
          if (!b.devs?.length) return json(res, 400, { error: 'falta al menos una persona' })
          if (!b.repos?.length) return json(res, 400, { error: 'falta al menos un repo' })
          const nuevo = db.crearEpica({ nombre: b.nombre.trim(), devs: b.devs, repos: b.repos })
          return json(res, 201, db.epica(nuevo))
        }
      }

      if (id && !db.epica(id)) return json(res, 404, { error: 'no existe esa épica' })

      if (id && !sub) {
        if (req.method === 'GET') return json(res, 200, db.epica(id))
        if (req.method === 'PATCH') {
          const b = await cuerpo(req)
          if (!b.nombre?.trim()) return json(res, 400, { error: 'falta el nombre' })
          db.renombrar(id, b.nombre.trim())
          return json(res, 200, db.epica(id))
        }
        if (req.method === 'DELETE') { db.borrarEpica(id); return json(res, 200, { ok: true }) }
      }

      if (id && sub === 'devs') {
        if (req.method === 'POST') {
          const b = await cuerpo(req)
          if (!b.quien) return json(res, 400, { error: 'falta quién' })
          db.agregarDev(id, b.quien)
          return json(res, 200, db.epica(id))
        }
        if (req.method === 'DELETE' && resto) {
          db.quitarDev(id, decodeURIComponent(resto))
          return json(res, 200, db.epica(id))
        }
      }

      if (id && sub === 'repos') {
        if (req.method === 'POST') {
          const b = await cuerpo(req)
          if (!b.repo || !b.base) return json(res, 400, { error: 'faltan repo y base' })
          db.agregarRepo(id, b.repo, b.base)
          return json(res, 200, db.epica(id))
        }
        if (req.method === 'DELETE' && resto) {
          db.quitarRepo(id, decodeURIComponent(resto))
          return json(res, 200, db.epica(id))
        }
      }

      if (id && sub === 'ramas') {
        if (req.method === 'POST') {
          const b = await cuerpo(req)
          // Con token, el autor NO se acepta del cuerpo: sale de quién es el token. Un agente no
          // debería poder cargar una rama a nombre de un compañero.
          const autor = yo.puedeEscribirPorOtro ? b.autor : yo.quien
          if (!b.repo || !b.rama || !autor) return json(res, 400, { error: 'faltan repo, rama o autor' })
          db.agregarRama(id, { ...b, autor })
          return json(res, 200, db.epica(id))
        }
        /* El nombre de una rama trae barras (`feat/algo`), así que va por query y no por ruta:
           en la ruta habría que escaparlo y cualquier proxy en el medio lo normaliza distinto. */
        if (req.method === 'DELETE') {
          const repo = url.searchParams.get('repo'), rama = url.searchParams.get('rama')
          if (!repo || !rama) return json(res, 400, { error: 'faltan repo y rama' })
          // Con token, solo se saca la propia: quitar la rama de un compañero es borrarle trabajo
          // del tablero, y eso no lo hace un agente por su cuenta.
          if (!yo.puedeEscribirPorOtro) {
            const suya = db.epica(id).ramas.find(r => r.repo === repo && r.rama === rama)
            if (!suya) return json(res, 404, { error: 'esa rama no está en la épica' })
            if (suya.autor !== yo.quien) {
              return json(res, 403, { error: `esa rama es de ${suya.autor}, no tuya` })
            }
          }
          db.quitarRama(id, repo, rama)
          return json(res, 200, db.epica(id))
        }
      }

      /* `PUT .../docs/:quien` desde el navegador y `PUT .../docs` desde un agente: sin `:quien`, el
         dueño sale del token. Así la llamada del agente es más corta Y no puede mentir sobre la
         autoría; si igual manda un `:quien` que no es el suyo, se rechaza en vez de ignorarlo en
         silencio — un 403 explícito es lo que evita que alguien crea que escribió donde no. */
      if (id && sub === 'docs' && req.method === 'PUT') {
        const pedido = resto ? decodeURIComponent(resto) : yo.quien
        if (!pedido) return json(res, 400, { error: 'falta de quién es la documentación' })
        if (!yo.puedeEscribirPorOtro && pedido !== yo.quien) {
          return json(res, 403, { error: `ese token solo puede escribir la documentación de ${yo.quien}` })
        }
        db.guardarDoc(id, pedido, await cuerpo(req))
        return json(res, 200, db.epica(id))
      }

      return json(res, 405, { error: 'método no soportado' })
    }

    /* ── tokens personales ────────────────────────────────────────────────────────────────────
       Se administran SOLO con sesión de navegador: un token no puede emitir otro token. Si pudiera,
       filtrar uno bastaría para fabricarse acceso permanente aunque revoquen el original. */
    const mt = ruta.match(/^\/api\/tokens(?:\/([\w-]+))?$/)
    if (mt) {
      const s = db.leerSesion(cookies(req).cuadrilla_sid)
      if (!s) return json(res, 401, { error: 'entrá con GitHub para administrar tus tokens' })
      const idTok = mt[1]

      if (!idTok && req.method === 'GET') {
        return json(res, 200, { login: s.login, quien: db.quienEs(s.login), tokens: db.tokensDe(s.login) })
      }
      if (!idTok && req.method === 'POST') {
        const b = await cuerpo(req)
        const { id, plano } = db.crearToken(s.login, b.nota)
        // `plano` viaja UNA vez y no se vuelve a poder leer: en la base queda solo el hash.
        return json(res, 201, { id, token: plano, tokens: db.tokensDe(s.login) })
      }
      if (idTok && req.method === 'DELETE') {
        db.revocarToken(s.login, idTok)
        return json(res, 200, { tokens: db.tokensDe(s.login) })
      }
      return json(res, 405, { error: 'método no soportado' })
    }

    // ── ¿está configurado? El front lo pregunta para saber si dibuja el botón o el aviso.
    if (ruta === '/api/config') {
      return json(res, 200, { configurado: configurado(), org: ORG })
    }

    // ── quién soy
    if (ruta === '/api/me') {
      const s = db.leerSesion(cookies(req).cuadrilla_sid)
      // Campo por campo, NUNCA `s` entero: la sesión guarda el token de GitHub y devolverla tal
      // cual lo publicaría en un fetch que cualquiera puede hacer desde la consola del navegador.
      return json(res, 200, s ? { login: s.login, nombre: s.nombre, avatar: s.avatar } : null)
    }

    /* ── la gente de la org ───────────────────────────────────────────────────────────────────
       Para el selector de «Desarrolladores involucrados». Se pide con el token de quien entró, así
       que depende de que la org le haya dado acceso a la app: si no, devuelve `disponible:false`
       con el motivo y el front cae al roster local en vez de mostrar una lista vacía. */
    if (ruta === '/api/members') {
      const s = db.leerSesion(cookies(req).cuadrilla_sid)
      if (!s) return json(res, 200, { disponible: false, motivo: 'sinSesion', miembros: [] })

      const fresco = cacheMiembros && Date.now() - cacheMiembros.cuando < VIDA_CACHE
      if (fresco) return json(res, 200, cacheMiembros.datos)

      const r = await fetch(`https://api.github.com/orgs/${ORG}/members?per_page=100`, {
        headers: {
          authorization: `Bearer ${s.token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'cuadrilla',
        },
      })
      if (!r.ok) {
        // 403 = la org no aprobó la app · 404 = no sos miembro (o la org no existe)
        const motivo = r.status === 403 ? 'sinPermisoDeOrg' : r.status === 404 ? 'sinAcceso' : 'error'
        return json(res, 200, { disponible: false, motivo, miembros: [] })
      }
      const crudos = await r.json()

      /* El listado de miembros NO trae el nombre real, solo el login. Se completa con una llamada
         por persona, en paralelo y cacheada: para una org de este tamaño son ~10 llamadas cada 5
         minutos, y la diferencia en el selector es «Miguel Ochoa» contra `mig-creditop`. */
      const miembros = await Promise.all(crudos.map(async (m) => {
        try {
          const u = await gh(`https://api.github.com/users/${m.login}`, s.token)
          return { login: m.login, nombre: u.name ?? m.login, avatar: m.avatar_url }
        } catch {
          return { login: m.login, nombre: m.login, avatar: m.avatar_url }
        }
      }))
      miembros.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

      const datos = { disponible: true, miembros }
      cacheMiembros = { cuando: Date.now(), datos }
      return json(res, 200, datos)
    }

    /* ── los repos de la org ──────────────────────────────────────────────────────────────────
       ⚠ Con el token de una OAuth App de scope `read:user read:org` esto devuelve SOLO los repos
       públicos. Los privados —que son casi todos— piden el scope `repo`, que es lectura Y
       escritura sobre todo lo que esa persona alcanza; por eso no se pide. La forma correcta es
       una GitHub App instalada en la org con `Contents: read`. Hasta entonces, una respuesta
       vacía NO significa «la org no tiene repos» sino «no tengo permiso para verlos», y así se
       reporta para que el front no muestre una lista vacía sin explicación. */
    if (ruta === '/api/repos') {
      const s = db.leerSesion(cookies(req).cuadrilla_sid)
      if (!s) return json(res, 200, { disponible: false, motivo: 'sinSesion', repos: [] })

      const fresco = cacheRepos && Date.now() - cacheRepos.cuando < VIDA_CACHE
      if (fresco) return json(res, 200, cacheRepos.datos)

      const r = await fetch(`https://api.github.com/orgs/${ORG}/repos?per_page=100&sort=pushed`, {
        headers: {
          authorization: `Bearer ${s.token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'cuadrilla',
        },
      })
      if (!r.ok) {
        const motivo = r.status === 403 ? 'sinPermisoDeOrg' : r.status === 404 ? 'sinAcceso' : 'error'
        return json(res, 200, { disponible: false, motivo, repos: [] })
      }
      const crudos = await r.json()
      const repos = crudos.map(x => ({ nombre: x.name, privado: x.private, base: x.default_branch }))

      const datos = repos.length
        ? { disponible: true, repos }
        : { disponible: false, motivo: 'sinPermisoDeRepos', repos: [] }
      cacheRepos = { cuando: Date.now(), datos }
      return json(res, 200, datos)
    }

    /* ── las ramas de UN repo ─────────────────────────────────────────────────────────────────
       Se pide al hacer clic en el repo, no de entrada: traer las ramas de todos los repos por si
       acaso son decenas de llamadas para una lista que a lo mejor nadie abre. */
    if (ruta === '/api/branches') {
      const s = db.leerSesion(cookies(req).cuadrilla_sid)
      const repo = url.searchParams.get('repo') ?? ''
      if (!s) return json(res, 200, { disponible: false, motivo: 'sinSesion', ramas: [] })
      if (!/^[\w.-]+$/.test(repo)) return json(res, 400, { error: 'repo inválido' })

      const enCache = cacheRamas.get(repo)
      if (enCache && Date.now() - enCache.cuando < VIDA_CACHE) return json(res, 200, enCache.datos)

      const r = await fetch(`https://api.github.com/repos/${ORG}/${repo}/branches?per_page=100`, {
        headers: {
          authorization: `Bearer ${s.token}`,
          accept: 'application/vnd.github+json',
          'user-agent': 'cuadrilla',
        },
      })
      if (!r.ok) {
        const motivo = r.status === 403 ? 'sinPermisoDeOrg' : r.status === 404 ? 'sinAcceso' : 'error'
        return json(res, 200, { disponible: false, motivo, ramas: [] })
      }
      const datos = { disponible: true, ramas: (await r.json()).map(b => b.name) }
      cacheRamas.set(repo, { cuando: Date.now(), datos })
      return json(res, 200, datos)
    }

    // ── arranca el login
    if (ruta === '/api/login') {
      if (!configurado()) return json(res, 503, { error: 'falta configurar GITHUB_CLIENT_ID/SECRET' })
      limpiarPendientes()
      const state = randomBytes(16).toString('hex')
      pendientes.set(state, Date.now())
      const a = new URL('https://github.com/login/oauth/authorize')
      a.searchParams.set('client_id', CLIENT_ID)
      a.searchParams.set('redirect_uri', `${APP_URL}/api/callback`)
      // `read:org` es lo que permite confirmar que la persona es de la org. NO se pide acceso al
      // código: este login es para identificar, no para leer repos.
      // Sin chequeo de org tampoco se pide el scope: pedir permisos que no se van a usar es la
      // forma más rápida de que alguien no apruebe la app.
      a.searchParams.set('scope', SIN_ORG ? 'read:user' : 'read:user read:org')
      a.searchParams.set('state', state)
      res.writeHead(302, { location: a.toString() })
      return res.end()
    }

    // ── vuelve de GitHub
    if (ruta === '/api/callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const guardado = [...pendientes.keys()].find(s => igual(s, state ?? ''))
      if (!code || !guardado) {
        res.writeHead(302, { location: `${APP_URL}/?error=state` })
        return res.end()
      }
      pendientes.delete(guardado)

      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: `${APP_URL}/api/callback`,
        }),
      })
      const tok = await r.json()
      if (!tok.access_token) {
        res.writeHead(302, { location: `${APP_URL}/?error=token` })
        return res.end()
      }

      const u = await gh('https://api.github.com/user', tok.access_token)

      /* Solo gente de la org. Sin esto, cualquiera con cuenta de GitHub entra a ver el tablero.
         Los dos «no» se separan a propósito porque se arreglan de forma distinta:
           404 → esta persona no es de la org, no hay nada que hacer;
           403 → la org tiene restringidas las OAuth Apps y a esta no le dieron acceso todavía.
         Mostrar «no sos miembro» en el segundo caso manda a buscar el problema donde no está. */
      if (!SIN_ORG) {
        const m = await fetch(`https://api.github.com/user/memberships/orgs/${ORG}`, {
          headers: {
            authorization: `Bearer ${tok.access_token}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'cuadrilla',
          },
        })

        if (m.status === 403) {
          res.writeHead(302, { location: `${APP_URL}/?error=orgapp` })
          return res.end()
        }
        const membresia = m.ok ? await m.json() : null
        if (membresia?.state !== 'active') {
          res.writeHead(302, { location: `${APP_URL}/?error=org` })
          return res.end()
        }
      }

      /* El token de GitHub SÍ se guarda, pero solo de este lado: hace falta para consultar la org
         (los miembros del equipo) en nombre de quien entró. Nunca sale en una respuesta —`/api/me`
         devuelve solo login/nombre/avatar— y se borra al salir. Alcance del daño si se filtrara:
         `read:user read:org`, o sea leer perfiles y membresías. NO da acceso al código. */
      const sid = db.guardarSesion({
        login: u.login, nombre: u.name ?? u.login, avatar: u.avatar_url, token: tok.access_token,
      })
      res.writeHead(302, {
        'set-cookie': `cuadrilla_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 3600}`,
        location: `${APP_URL}/`,
      })
      return res.end()
    }

    // ── salir
    if (ruta === '/api/logout' && req.method === 'POST') {
      const sid = cookies(req).cuadrilla_sid
      if (sid) db.borrarSesion(sid)
      res.writeHead(200, {
        'set-cookie': 'cuadrilla_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        'content-type': 'application/json',
      })
      return res.end('{"ok":true}')
    }

    json(res, 404, { error: 'no existe' })
  } catch (e) {
    // El mensaje va al log del server, no al navegador: puede traer detalles de la respuesta de
    // GitHub que no hacen falta del otro lado.
    console.error('[cuadrilla]', e.message)
    json(res, 500, { error: 'error interno' })
  }
})

// La base vive al lado del código, no en el sistema: es de este prototipo y se borra con él.
const ARCHIVO_DB = process.env.CUADRILLA_DB
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'cuadrilla.db')
db.abrir(ARCHIVO_DB)

server.listen(PUERTO, HOST, () => {
  console.log(`  cuadrilla · sesión en http://${HOST}:${PUERTO}`)
  console.log(`  base: ${ARCHIVO_DB}`)
  if (!configurado()) {
    console.log('  ⚠ sin GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET: el login queda deshabilitado')
    console.log('    (la app sigue andando con los datos de mentira — ver .env.example)')
  } else if (SIN_ORG) {
    console.log('  ⚠ CUADRILLA_SKIP_ORG=1 — entra CUALQUIER cuenta de GitHub, sin chequear la org.')
    console.log('    Solo para local mientras la org aprueba la app. NO usar en un dominio público.')
  } else {
    console.log(`  org exigida: ${ORG}`)
  }
})
