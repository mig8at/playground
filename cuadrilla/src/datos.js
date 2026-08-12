import { reactive } from 'vue'
import * as api from './api.js'

/* ═══ EL MODELO ═════════════════════════════════════════════════════════════════════════════════
   La unidad de trabajo es la RAMA, no el PR: una rama existe desde el primer push, el PR llega
   después. Por eso el estado tiene tres valores y no dos:

     desarrollo  — la rama está en origin, todavía no hay PR abierto (o está en borrador)
     aprobacion  — hay PR abierto esperando que alguien lo apruebe
     mergeada    — entró a la rama base

   `dias` significa una cosa distinta en cada estado y por eso la UI lo dice con todas las letras
   («abierto hace 4 días» / «último commit hace 2 días» / «mergeada hace 6 días»). Un solo número
   con tres significados escondidos es la forma clásica de mentir en un dashboard.

   Una rama tiene UN `autor`: cada quien trabaja en la suya. Si una rama ya está tomada por otro,
   el buscador la muestra pero no la deja elegir — dos dueños para la misma rama duplicaban la fila
   y el conteo de la épica mentía.

   ⚠ TODO ESTO ES MOCK. Los repos, las personas y el catálogo de ramas remotas salen de
   `git for-each-ref refs/remotes/origin` sobre los repos reales (al 10 ago 2026); los números de
   PR, los estados, las notas y el reparto por persona están puestos a mano. Cuando se conecte la
   API de GitHub, este archivo se reemplaza entero y el resto de la app no se entera.            */

/* `github` son los LOGIN de GitHub de cada quien, que es lo único que identifica sin ambigüedad.
   Solo están los tres que aparecen firmando ramas en origin; el resto firma con `user.name`, que
   NO es el login. Ese es justo el agujero que tapa el login con OAuth: cuando alguien entra,
   GitHub devuelve su `login` exacto y el mapa se completa sin adivinar —hoy no hay forma de saber
   si `jose guzman` y `Jose Escobar` son la misma persona o dos—. */
export const PERSONAS = {
  joel:   { nombre:'Joel',           c:'#b06f2b', github:[] },
  lucho:  { nombre:'Luis Cabra',     c:'#2f7d8f', github:['lhCabra-creditop'] },
  oscar:  { nombre:'Oscar Rincón',   c:'#7a5bbf', github:[] },
  jose:   { nombre:'José Escobar',   c:'#3f7a4b', github:['joseesco24-creditop'] },
  guzman: { nombre:'José Guzmán',    c:'#4a7a6a', github:[] },
  miguel: { nombre:'Miguel Ochoa',   c:'#a04a5e', github:['mig-creditop'] },
  hans:   { nombre:'Hans Peter',     c:'#5a6f9e', github:[] },
  abel:   { nombre:'Abel Arismendy', c:'#8a7020', github:[] },
  yamid:  { nombre:'Yamid Viloria',  c:'#4f6b8a', github:[] },
}

/* Color estable a partir del identificador. Los miembros reales de la org no están en PERSONAS y
   sin esto saldrían todos del mismo gris. Hash simple → tono; saturación y luz fijas para que
   ninguno quede ilegible ni en claro ni en oscuro. */
export function colorDe(id){
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return `hsl(${h} 40% 42%)`
}

/* Resuelve CUALQUIER identificador: un id del roster local (`miguel`) o un login de GitHub
   (`mig-creditop`). Es lo que deja convivir los datos de mentira con la gente real sin tener que
   migrar todo de golpe: quien no está en PERSONAS se muestra igual, con su login por nombre. */
export function persona(id){
  return PERSONAS[id] ?? { nombre: id, c: colorDe(id), github: [id] }
}

export const ESTADOS = {
  aprobacion: { etiqueta:'por aprobación', verbo:'abierto hace',        orden:0 },
  desarrollo: { etiqueta:'en desarrollo',  verbo:'último commit hace',  orden:1 },
  mergeada:   { etiqueta:'mergeada',       verbo:'mergeada hace',       orden:2 },
}

// Los repos donde la squad toca código. Son los de ~/Desktop/CREDITOP/github/ más form-service.
export const REPOS = [
  'legacy-backend',
  'frontend-monorepo',
  'legacy-application',
  'pre-approvals-service',
  'form-service',
]

// Las ramas compartidas que existen de verdad en los repos (origin/develop, origin/qa, origin/main,
// origin/staging). `develop` es la base normal; las otras son la excepción y por eso se avisan.
export const BASES = ['develop', 'qa', 'main', 'staging']

/* Qué ramas base tiene CADA repo. No todos tienen las mismas —`pre-approvals-service` solo tiene
   develop y main—, y ofrecer `qa` donde no existe es mandar a alguien a ramificar de la nada.
   Cuando GitHub esté conectado esto sale de `GET /repos/{org}/{repo}/branches`. */
export const BASES_POR_REPO = {
  'legacy-backend':        ['develop', 'qa', 'staging', 'main'],
  'frontend-monorepo':     ['develop', 'qa', 'staging', 'main'],
  'legacy-application':    ['develop', 'qa', 'staging', 'main'],
  'pre-approvals-service': ['develop', 'main'],
  'form-service':          ['develop', 'main'],
}
export const basesDeRepo = repo => BASES_POR_REPO[repo] ?? BASES

/* ── el contrato de repos ──────────────────────────────────────────────────────────────────────
   `epica.repos` es una lista de { repo, base }: la rama de la que sale cada uno. Antes había UNA
   base para toda la épica, y era mentira en cuanto un repo no tenía esa rama o el equipo salía de
   `qa` en el front y de `develop` en el back. */
export const nombresDeRepos = epica => (epica.repos ?? []).map(r => r.repo)
export const baseDe = (epica, repo) => (epica.repos ?? []).find(r => r.repo === repo)?.base ?? null
export const basesDistintas = epica => [...new Set((epica.repos ?? []).map(r => r.base))]

/* ═══ EL CATÁLOGO DE ORIGIN ═════════════════════════════════════════════════════════════════════
   Lo que se ve al buscar una rama: SOLO ramas que ya existen en origin. El developer no inventa un
   nombre acá — crea y pushea la rama en su local, y después la encuentra en esta lista.

   `empujo` y `dias` salen del último commit de la rama. `base` es de qué rama salió.
   ⚠ Ojo cuando esto sea real: la API de GitHub NO te dice de qué rama salió una rama. Se estima con
   `git merge-base` contra las candidatas (develop/qa/main/staging) y puede errar en ramas viejas o
   ya rebasadas — por eso el formulario deja corregirla a mano.                                   */
export const REMOTAS = [
  // ── legacy-backend
  { repo:'legacy-backend', rama:'fix/CORE-368-correcciones-producto',            empujo:'joel',   dias:2,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/CORE-362-conexion-flujo',                  empujo:'joel',   dias:2,  base:'develop' },
  { repo:'legacy-backend', rama:'feature/pais-como-dato',                        empujo:'miguel', dias:4,  base:'develop' },
  { repo:'legacy-backend', rama:'fix/abaco',                                     empujo:'guzman', dias:4,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/next-step-after-identity',                 empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/category-rules-priority',                  empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'legacy-backend', rama:'feature/CRED-133-agregar-campo-pago-minimo',    empujo:'hans',   dias:6,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/pais-seed-countries',                      empujo:'miguel', dias:9,  base:'develop' },
  { repo:'legacy-backend', rama:'fix/country-tree-cache',                        empujo:'lucho',  dias:7,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/soporte-auditoria-cambios',                empujo:'miguel', dias:1,  base:'develop' },
  { repo:'legacy-backend', rama:'feat/soporte-otp-whatsapp',                     empujo:'miguel', dias:2,  base:'develop' },
  { repo:'legacy-backend', rama:'fix/user-requests-status-id',                   empujo:'miguel', dias:4,  base:'main' },

  // ── frontend-monorepo
  { repo:'frontend-monorepo', rama:'fix/CORE-368-correcciones-producto',         empujo:'joel',   dias:2,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/CORE-362-conexion-flujo',               empujo:'joel',   dias:2,  base:'develop' },
  { repo:'frontend-monorepo', rama:'fix/CORE-389-remove-ismotairenting-call-site', empujo:'joel', dias:3,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feature/pais-como-dato',                     empujo:'miguel', dias:4,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/next-step-after-identity',              empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'frontend-monorepo', rama:'fix/credifamilia-preapproval-signal',        empujo:'oscar',  dias:5,  base:'develop' },
  { repo:'frontend-monorepo', rama:'fix/lenders-marketplace-cupo-maximo',        empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/medipay-improvements',                  empujo:'jose',   dias:6,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/lender-fallback-category',              empujo:'lucho',  dias:6,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/country-selector-wizard',               empujo:'lucho',  dias:1,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/soporte-panel-asesor',                  empujo:'miguel', dias:5,  base:'develop' },
  { repo:'frontend-monorepo', rama:'feat/qr-corbeta-bnpl',                       empujo:'joel',   dias:15, base:'qa' },

  // ── legacy-application
  { repo:'legacy-application', rama:'fix/CORE-391-conservar-response-type-entidad', empujo:'joel', dias:2, base:'develop' },
  { repo:'legacy-application', rama:'feature/pais-como-dato',                    empujo:'miguel', dias:4,  base:'develop' },
  { repo:'legacy-application', rama:'fix/mas-asesores-prueba-reporte',           empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'legacy-application', rama:'fix/excluir-solicitudes-de-prueba-reporte', empujo:'lucho',  dias:5,  base:'develop' },
  { repo:'legacy-application', rama:'fix/creditopx-report-entidad-comercio-lender-scope', empujo:'oscar', dias:5, base:'develop' },
  { repo:'legacy-application', rama:'fix/CORE-371-welli-voucher-desembolso',     empujo:'joel',   dias:6,  base:'develop' },
  { repo:'legacy-application', rama:'feat/CORE-380-voucher-manual-admin',        empujo:'joel',   dias:6,  base:'develop' },
  { repo:'legacy-application', rama:'feat/CORE-385-usuarios-comerciales-copiar-credenciales', empujo:'joel', dias:6, base:'develop' },

  // ── pre-approvals-service
  { repo:'pre-approvals-service', rama:'feat/flamingo-implementation',           empujo:'jose',   dias:50, base:'develop' },
  { repo:'pre-approvals-service', rama:'feat/notify-lender-result-on-cache',     empujo:'abel',   dias:18, base:'qa' },
  { repo:'pre-approvals-service', rama:'feat/notify-lender-result-legacy',       empujo:'abel',   dias:18, base:'qa' },
  { repo:'pre-approvals-service', rama:'fix/notify-lender-result-main',          empujo:'abel',   dias:51, base:'main' },
  { repo:'pre-approvals-service', rama:'feature/bancolombia-frontend-response',  empujo:'joel',   dias:20, base:'qa' },
  { repo:'pre-approvals-service', rama:'fix/traces-localdev',                    empujo:'joel',   dias:56, base:'develop' },
  { repo:'pre-approvals-service', rama:'feat/trace-propagation',                 empujo:'yamid',  dias:12, base:'develop' },

  // ── form-service
  { repo:'form-service', rama:'feat/form-service-country-tree',                  empujo:'jose',   dias:3,  base:'develop' },
  { repo:'form-service', rama:'feat/dynamic-form-cascada-ciudad',                empujo:'jose',   dias:8,  base:'develop' },
]

/* ═══ LAS ÉPICAS ════════════════════════════════════════════════════════════════════════════════
   Ya NO viven acá: viven en SQLite, del otro lado de `/api/epicas`. Este arreglo es el espejo que
   mira la UI, y se llena con `cargarEpicas()`.

   Todo lo DERIVADO de más abajo (avance, represamiento, la gente, la cola de revisión) no cambió
   ni una línea al mudar los datos: sigue operando sobre los mismos objetos. Esa es la ventaja de
   haber tenido el cálculo separado del almacenamiento desde el principio.                       */
export const EPICAS = reactive([])

export const estadoDatos = reactive({ estado: 'cargando', error: null })

// Reemplaza una épica en su lugar. `splice` y no asignación por índice: es lo que Vue observa.
function refrescar(e){
  const i = EPICAS.findIndex(x => x.id === e.id)
  if (i >= 0) EPICAS.splice(i, 1, e)
  else EPICAS.unshift(e)
  return e
}

export async function cargarEpicas(){
  try {
    const lista = await api.listar()
    EPICAS.splice(0, EPICAS.length, ...lista)
    estadoDatos.estado = 'listo'
    estadoDatos.error = null
  } catch (e) {
    // Sin server no hay datos, y hay que decirlo: una lista vacía se lee como «no hay épicas».
    estadoDatos.estado = 'sinServer'
    estadoDatos.error = e.message
  }
}

/* ═══ DERIVADO ══════════════════════════════════════════════════════════════════════════════════
   El % NO es un campo: se calcula. Un porcentaje guardado a mano se desactualiza el primer día.
   Definición de hoy: ramas mergeadas sobre el total. Es la más simple que se sostiene, y la UI
   siempre muestra la fracción al lado para que el número nunca sea magia.                       */
export function avance(epica){
  const total = epica.ramas.length
  if (!total) return { pct: 0, mergeadas: 0, total: 0 }
  const mergeadas = epica.ramas.filter(r => r.estado === 'mergeada').length
  return { pct: Math.round(mergeadas / total * 100), mergeadas, total }
}

export function ramasDe(epica, quien){
  return epica.ramas
    .filter(r => r.autor === quien)
    .sort((a, b) => ESTADOS[a.estado].orden - ESTADOS[b.estado].orden || b.dias - a.dias)
}

export function conteo(epica){
  const c = { aprobacion: 0, desarrollo: 0, mergeada: 0 }
  epica.ramas.forEach(r => c[r.estado]++)
  return c
}

// La rama que más lleva esperando. Es el renglón que decide si la épica está trabada.
export function masVieja(epica){
  const esperando = epica.ramas.filter(r => r.estado === 'aprobacion')
  if (!esperando.length) return null
  return esperando.reduce((a, b) => (b.dias > a.dias ? b : a))
}

// La gente se ordena por lo que tiene esperando: quien tiene algo trabado, arriba.
export function genteDe(epica){
  return [...epica.devs].sort((a, b) => {
    const esp = q => Math.max(0, ...epica.ramas
      .filter(r => r.autor === q && r.estado === 'aprobacion').map(r => r.dias))
    return esp(b) - esp(a)
  })
}

export function buscarEpica(id){
  return EPICAS.find(e => e.id === id)
}

/* ═══ TRANSVERSAL ═══════════════════════════════════════════════════════════════════════════════
   Lo que cruza épicas: el header y las vistas de Gente y Revisión. Todo sale de las mismas ramas,
   nada se guarda aparte — dos fuentes para el mismo número es cómo empiezan a discrepar.        */

// Cada rama con su épica al lado. Es la base de todo lo transversal.
export function ramasGlobales(){
  return EPICAS.flatMap(e => e.ramas.map(r => ({ ...r, epica: e })))
}

// El estado del equipo ahora. `vieja` es el renglón del header: lo que más lleva esperando.
export function pulso(){
  const todas = ramasGlobales()
  const esperando = todas.filter(r => r.estado === 'aprobacion')
  return {
    aprobacion: esperando.length,
    desarrollo: todas.filter(r => r.estado === 'desarrollo').length,
    mergeada:   todas.filter(r => r.estado === 'mergeada').length,
    total:      todas.length,
    vieja:      esperando.length ? esperando.reduce((a, b) => (b.dias > a.dias ? b : a)) : null,
  }
}

// Todo lo que espera aprobación, en todas las épicas, lo más viejo arriba.
export const colaDeRevision = () =>
  ramasGlobales().filter(r => r.estado === 'aprobacion').sort((a, b) => b.dias - a.dias)

/* Cuánto lleva represado lo que espera, por antigüedad. Los tramos NO son parejos a propósito:
   el corte que importa está en los 4 días (el mismo umbral que marca en naranja la fila de rama),
   y a partir de ahí cada tramo pesa más. Tramos de 7 en 7 esconderían justo eso. */
export function represamiento(){
  const tramos = [
    { rango: '1 día o menos', min: 0,  max: 1,        nivel: 'ok'   },
    { rango: '2 a 3 días',    min: 2,  max: 3,        nivel: 'tibio'},
    { rango: '4 a 6 días',    min: 4,  max: 6,        nivel: 'malo' },
    { rango: '7 días o más',  min: 7,  max: Infinity, nivel: 'peor' },
  ]
  const esperando = colaDeRevision()
  const filas = tramos.map(t => ({
    ...t,
    n: esperando.filter(r => r.dias >= t.min && r.dias <= t.max).length,
  }))
  const tope = Math.max(1, ...filas.map(f => f.n))
  return { filas: filas.reverse(), tope, total: esperando.length }   // el tramo peor, arriba
}

// En quién se acumula lo que espera. Es lo que no se ve en ninguna otra pantalla del Home.
export function represadoPorPersona(){
  const esperando = colaDeRevision()
  const m = new Map()
  esperando.forEach(r => {
    const a = m.get(r.autor) ?? { quien: r.autor, n: 0, masDias: 0 }
    a.n++; a.masDias = Math.max(a.masDias, r.dias)
    m.set(r.autor, a)
  })
  const filas = [...m.values()].sort((a, b) => b.n - a.n || b.masDias - a.masDias)
  return { filas, tope: Math.max(1, ...filas.map(f => f.n)) }
}

export function resumenPersona(quien){
  const suyas = ramasGlobales().filter(r => r.autor === quien)
  const esperando = suyas.filter(r => r.estado === 'aprobacion')
  const mergeadas = suyas.filter(r => r.estado === 'mergeada').length
  return {
    quien,
    nombre: persona(quien).nombre,
    ramas: suyas,
    total: suyas.length,
    mergeadas,
    pct: suyas.length ? Math.round(mergeadas / suyas.length * 100) : 0,
    desarrollo: suyas.filter(r => r.estado === 'desarrollo').length,
    esperando: esperando.length,
    masDias: esperando.length ? Math.max(...esperando.map(r => r.dias)) : 0,
    epicas: EPICAS.filter(e => e.devs.includes(quien)),
  }
}

// La gente del tablero: quien esté en alguna épica o tenga alguna rama. Ordenada por lo que tiene
// trabado — el que espera hace más, arriba.
export const laGente = () =>
  Object.keys(PERSONAS)
    .map(resumenPersona)
    .filter(p => p.total || p.epicas.length)
    .sort((a, b) => b.masDias - a.masDias || b.esperando - a.esperando || b.total - a.total)

/* \u2500\u2500 mutaciones \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Todas pasan por el server y todas terminan reemplazando la \u00e9pica con lo que la base respondi\u00f3.
   Ninguna adivina el resultado: si el server rechaza algo, la pantalla no queda mostrando un
   cambio que no ocurri\u00f3. El id lo calcula el server, que es quien sabe cu\u00e1les ya existen. */
export async function crearEpica(nombre, devs, repos){
  return refrescar(await api.crear(nombre, devs, repos))
}

export const renombrarEpica = async (epica, nombre) => refrescar(await api.renombrar(epica.id, nombre))

export async function borrarEpica(epica){
  await api.borrar(epica.id)
  const i = EPICAS.findIndex(x => x.id === epica.id)
  if (i >= 0) EPICAS.splice(i, 1)
}

export const sumarDev = async (epica, quien) => refrescar(await api.sumarDev(epica.id, quien))
export const sacarDev = async (epica, quien) => refrescar(await api.sacarDev(epica.id, quien))

export const sumarRepo = async (epica, repo, base) => refrescar(await api.sumarRepo(epica.id, repo, base))
export const sacarRepo = async (epica, repo) => refrescar(await api.sacarRepo(epica.id, repo))

export const sacarRama = async (epica, repo, rama) => refrescar(await api.sacarRama(epica.id, repo, rama))

const misma = (a, b) => a.repo === b.repo && a.rama === b.rama

/* Busca en origin, solo dentro de los repos que la épica declaró. Por defecto muestra SOLO las
   ramas de `quien`: está agregando LA SUYA, no explorando el repo.

   ⚠ `empujo` es el autor del ÚLTIMO COMMIT de la rama, que es lo que da git — «quién creó la rama»
   no es un dato que exista. Si otro le mete un commit encima, o si la persona pushea con otro
   usuario de git (`Miguel Ochoa` vs `mig-creditop`), la rama deja de aparecer como suya. Por eso
   `todas` existe: sin esa salida, un mapeo de identidades incompleto se vuelve «mi rama no está».

   `tomada` dice si esa rama ya está en la épica y de quién es — se muestra igual, pero no se deja
   elegir: una rama, un dueño. */
/* Tres filtros por defecto y el tercero es el que respeta la directiva de la épica:
     1. solo los repos que la épica declaró;
     2. solo las ramas de `quien` — está buscando LA SUYA, no explorando el repo;
     3. solo las que salen de la base asignada A ESE REPO.

   Si la épica dice que `legacy-backend` sale de `develop`, una rama nacida en `main` no pertenece
   a esta épica: ofrecerla es invitar a ensuciarla. `todas` levanta el 2 y el 3 juntos, y hace
   falta porque la base se ESTIMA (ver el aviso sobre `merge-base` arriba) — una estimación errada
   escondería una rama legítima sin dejar forma de agregarla. */
const saleDeLaBase = (epica, r) => r.base === baseDe(epica, r.repo)

export function buscarRemotas(epica, texto, quien, todas = false){
  const t = texto.trim().toLowerCase()
  return REMOTAS
    .filter(r => nombresDeRepos(epica).includes(r.repo))
    .filter(r => todas || (r.empujo === quien && saleDeLaBase(epica, r)))
    .filter(r => !t || r.rama.toLowerCase().includes(t) || r.repo.toLowerCase().includes(t))
    .map(r => ({ ...r, tomada: epica.ramas.find(x => misma(x, r)) ?? null }))
    .sort((a, b) => (b.empujo === quien) - (a.empujo === quien) || a.dias - b.dias)
}

/* Cuántas ramas de esta persona quedaron afuera SOLO por salir de otra base. Se muestra el número
   en vez de esconderlas en silencio: si alguien no encuentra su rama, la diferencia entre «no la
   pusheaste» y «salió de otra base» es la diferencia entre buscar bien y buscar mal. */
export const ocultasPorBase = (epica, quien) =>
  REMOTAS.filter(r => nombresDeRepos(epica).includes(r.repo)
                   && r.empujo === quien
                   && !saleDeLaBase(epica, r)).length

// Cuántas ramas hay en origin de esta persona, en los repos de la épica. Sirve para no ofrecer
// «ver todas» cuando el problema es que no pusheó nada.
export const cuantasSuyas = (epica, quien) =>
  REMOTAS.filter(r => nombresDeRepos(epica).includes(r.repo) && r.empujo === quien).length

/* Agregar una rama a la épica, a nombre de una persona. El estado NO se pregunta: una rama recién
   agregada está en `desarrollo` y pasa a `aprobacion` cuando exista el PR — eso lo sabrá GitHub. */
export async function agregarRama(epica, { repo, rama, base, quien, nota }){
  if (epica.ramas.some(x => misma(x, { repo, rama }))) return null   // ya está: no se duplica
  return refrescar(await api.sumarRama(epica.id, {
    repo, rama, autor: quien,
    nota: nota?.trim() || '',
    base: base || baseDe(epica, repo) || 'develop',
  }))
}

/* ═══ DOCUMENTACIÓN ═════════════════════════════════════════════════════════════════════════════
   Lo que cada quien deja escrito DENTRO de una épica para el resto de la cuadrilla. Es por persona
   y por épica: la misma persona documenta cosas distintas en épicas distintas.

   Dos campos y no uno: `texto` es qué hizo y dónde quedó, y `trampa` es lo que le costó tiempo.
   Sin el segundo campo la gente escribe un diario; con él escribe lo que al otro le sirve —
   es el mismo criterio del nodo `findings` del playground.

   `dias` = cuándo se actualizó. Una documentación sin fecha se lee como vigente aunque tenga
   meses; con fecha, el que lee decide cuánto confiar. */
export const docDe = (epica, quien) => epica.docs?.[quien] ?? null

// Vaciar los dos campos borra la entrada: de eso se encarga el server, que es el que sabe si había.
export const guardarDoc = async (epica, quien, { texto, trampa }) =>
  refrescar(await api.escribirDoc(epica.id, quien, { texto, trampa }))

export const cuantasDocs = epica => Object.keys(epica.docs ?? {}).length

export const dias = n => (n === 0 ? 'hoy' : n === 1 ? '1 día' : `${n} días`)

// El adjetivo concuerda con `rama(s)`, no con el numerador: «0 de 1 rama mergeada».
export const fraccion = (m, t) =>
  t === 1 ? `${m} de 1 rama mergeada` : `${m} de ${t} ramas mergeadas`

// «Joel y Abel», no «Joel, Abel». Pasado `max`, corta con «y N más».
export function enumerar(quienes, max = 3){
  const n = quienes.map(q => persona(q).nombre.split(' ')[0])
  if (n.length === 0) return ''
  if (n.length === 1) return n[0]
  if (n.length <= max) return `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`
  return `${n.slice(0, max - 1).join(', ')} y ${n.length - (max - 1)} más`
}
