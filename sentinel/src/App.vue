<script setup>
/* SENTINEL: el vigía de producción. A la izquierda toda la originación y LO QUE SE SIGUE (comercios o entidades que se
 * agregan a mano, cada uno con su curva chica de hoy); al centro el elegido, con su curva del día contra lo normal y las
 * marcas de los despliegues a producción; abajo, en la consola, la tabla con TODAS las señales (errores, entidades y
 * comercios: la última hora contra la misma hora de los días comparables); a la derecha lo que pide atención, los avisos
 * y los despliegues. Lo que se sigue vive en el servidor (following.go): decide además de qué comercios avisa macOS.
 *
 * Sólo lee: la API (sentinel/server) guarda cuatro semanas en disco y cada 5 minutos pide sólo lo que falta. La ruta es
 * `#/lender/<id>`, `#/merchant/<id>`, `#/service/<nombre>`, `#/queue` o vacía (toda la originación). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, regionSize, reopenSize, bindThemeToggle, bindPanelMaximize, readHashRoute, hashRoute, setRoute } from './workbench.js'

const data = ref(null)       // el Overview de la API
const apiError = ref('')
const running = ref(false)
const loading = ref('')      // la carga inicial de la historia, mientras corre
const stale = ref(false)     // lo que se ve es lo guardado de la última vez; la lectura de ahora sigue
const query = ref('')
const following = ref([])   // las señales que se siguen («merchant:94»), en el orden en que se agregaron
const route = ref({ kind: 'all', id: 0 })

async function load() {
  try {
    const res = await fetch('/api/overview')
    const body = await res.json()
    data.value = body.overview || data.value
    apiError.value = body.error || ''
    running.value = !!body.running
    loading.value = body.loading || ''
    stale.value = !!body.stale
    following.value = body.following || []
  } catch {
    apiError.value = 'No contesta la API. ¿Está arriba? (make sentinel levanta las dos partes)'
    running.value = false // sin API no hay pasada que seguir de cerca: el sondeo vuelve al ritmo lento
  }
}
// EL SONDEO. En reposo, cada 30 s (el servidor lee cada 5 min). Mientras el servidor dice que está leyendo o cargando
// la historia, cada 2 s: antes «leer ahora» miraba una vez a los 1,5 s y el resultado aparecía hasta 30 s después de
// terminar. Con la pestaña oculta no se sondea; al volver, se lee en el acto.
const POLL_IDLE = 30_000
const POLL_BUSY = 2_000
let timer = null
let busyUntil = 0 // tras «leer ahora», un rato de sondeo rápido aunque el servidor todavía no diga `running`
function schedule() {
  clearTimeout(timer)
  if (document.hidden) return
  const busy = running.value || !!loading.value || Date.now() < busyUntil
  timer = setTimeout(async () => { await load(); schedule() }, busy ? POLL_BUSY : POLL_IDLE)
}
function onVisibility() {
  if (document.hidden) clearTimeout(timer)
  else load().then(schedule)
}
async function refresh() {
  running.value = true
  busyUntil = Date.now() + 6000
  try { await fetch('/api/refresh', { method: 'POST' }) } catch { /* lo dice load */ }
  schedule()
}

// ── lo elegido ──
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtered = (list) => (query.value.trim() ? (list || []).filter((s) => fold(s.name).includes(fold(query.value))) : list || [])
// Sin movimiento: lo normal a esta hora es 0 y hoy tampoco entró nada. Van plegados al final de su grupo: son la
// mayoría de las entidades a cualquier hora y tapaban las que sí se mueven.
const idle = (s) => s.median === 0 && s.now.total === 0
const everything = computed(() => [...(data.value?.services || []), ...(data.value?.liveness || []), ...(data.value?.lenderErrors || []), ...(data.value?.providers || []), ...(data.value?.rejections || []), ...(data.value?.funnel || []), ...(data.value?.steps || []), ...(data.value?.lenders || []), ...(data.value?.merchants || [])])
const bySignal = computed(() => new Map(everything.value.map((s) => [s.signal, s])))
const followed = computed(() => following.value.map((sig) => bySignal.value.get(sig) || { signal: sig, name: sig, kind: sig.split(':')[0], id: Number(sig.split(':')[1]), state: 'quiet', now: { total: 0 }, median: 0, why: 'Sin datos todavía: no aparece en lo guardado.' }))
// Lo que se sigue, en dos secciones: entidades primero (son menos y cada una cruza varios comercios), después comercios.
const followedGroups = computed(() => [{ kind: 'lender', title: 'Entidades que sigo' }, { kind: 'merchant', title: 'Comercios que sigo' }]
  .map((g) => ({ ...g, list: followed.value.filter((s) => s.kind === g.kind) })).filter((g) => g.list.length))
const isFollowed = (s) => following.value.includes(s.signal)
const canFollow = (s) => s.kind === 'lender' || s.kind === 'merchant'
// Lo que propone el buscador del sidebar: comercios y entidades que todavía no se siguen, primero los que se mueven.
const suggestions = computed(() => {
  if (!query.value.trim()) return []
  return filtered([...(data.value?.merchants || []), ...(data.value?.lenders || [])])
    .filter((s) => !isFollowed(s)).sort((a, b) => b.now.total + b.median - (a.now.total + a.median)).slice(0, 8)
})
async function setFollow(s, on) {
  try {
    const res = await fetch(on ? '/api/following' : `/api/following?signal=${encodeURIComponent(s.signal)}`,
      on ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signal: s.signal }) } : { method: 'DELETE' })
    const body = await res.json()
    if (body.error) { apiError.value = body.error; return }
    following.value = body.following || []
    if (on) query.value = ''
  } catch { apiError.value = 'No contesta la API: no se pudo cambiar lo que se sigue.' }
}
// La curva chica de una fila: hoy (hasta la hora en curso) contra la mediana, en una caja de 72×22.
function spark(s) {
  if (!s?.normal?.length) return null
  const top = Math.max(1, ...s.normal, ...(s.today || []))
  const x = (h) => 1 + (h / 23) * 70
  const y = (v) => 21 - (v / top) * 19
  return { normal: s.normal.map((v, h) => `${x(h)},${y(v)}`).join(' '), today: (s.today || []).map((v, h) => `${x(h)},${y(v)}`).join(' ') }
}

// ── la tabla de la consola: todas las señales ──
const KIND_TABS = [{ id: 'all', label: 'Todas' }, { id: 'errors', label: 'Errores' }, { id: 'logs', label: 'Vida' }, { id: 'step', label: 'Pantallas' }, { id: 'out', label: 'Proveedores' }, { id: 'reject', label: 'Rechazo' }, { id: 'funnel', label: 'Embudo' }, { id: 'lender', label: 'Entidades' }, { id: 'merchant', label: 'Comercios' }]
const tableKind = ref('all')
const tableQuery = ref('')
const showIdle = ref(false)
const sortBy = ref({ key: 'state', dir: 1 })
const SEVERITY = { alert: 0, warn: 1, ok: 2, quiet: 3 }
const ofKind = (s, k) => k === 'all' || (k === 'errors' ? isErrors(s) : s.kind === k)
const kindCount = (k) => everything.value.filter((s) => ofKind(s, k) && (showIdle.value || !idle(s))).length
const SORTS = {
  state: (s) => [SEVERITY[s.state] ?? 9, -Math.abs(s.z || 0)],
  name: (s) => [fold(s.name)],
  kind: (s) => [s.kind, fold(s.name)],
  now: (s) => [-s.now.total],
  median: (s) => [-s.median],
  z: (s) => [-Math.abs(s.z || 0)],
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1 } return 0 }
const tableRows = computed(() => {
  const q = fold(tableQuery.value.trim())
  const key = SORTS[sortBy.value.key] || SORTS.state
  return everything.value
    .filter((s) => ofKind(s, tableKind.value) && (showIdle.value || q || !idle(s)) && (!q || fold(s.name).includes(q)))
    .sort((a, b) => sortBy.value.dir * cmp(key(a), key(b)))
})
function sortOn(key) { sortBy.value = sortBy.value.key === key ? { key, dir: -sortBy.value.dir } : { key, dir: 1 } }
const ariaSort = (key) => (sortBy.value.key === key ? (sortBy.value.dir > 0 ? 'ascending' : 'descending') : 'none')
const selected = computed(() => {
  const d = data.value
  if (!d) return null
  if (route.value.kind === 'queue') return d.services?.find((s) => s.kind === 'queue') || d.all
  if (route.value.kind === 'service') return d.services?.find((s) => s.name === route.value.name) || d.all
  if (route.value.kind === 'jserr') return d.services?.find((s) => s.signal === `jserr:${route.value.name}`) || d.all
  if (route.value.kind === 'step') return d.steps?.find((s) => s.signal === `step:${route.value.name}`) || d.all
  if (route.value.kind === 'lerr') return d.lenderErrors?.find((s) => s.id === route.value.id) || d.all
  if (route.value.kind === 'logs') return d.liveness?.find((s) => s.signal === `logs:${route.value.name}`) || d.all
  if (route.value.kind === 'out') return d.providers?.find((s) => s.signal === `out:${route.value.name}`) || d.all
  if (route.value.kind === 'reject') return d.rejections?.find((s) => s.signal === `reject:${route.value.name}`) || d.all
  if (route.value.kind === 'funnel') return d.funnel?.find((s) => s.signal === `funnel:${route.value.name}`) || d.all
  if (route.value.kind === 'lender') return d.lenders?.find((s) => s.id === route.value.id) || d.all
  if (route.value.kind === 'merchant') return d.merchants?.find((s) => s.id === route.value.id) || d.all
  return d.all
})
// Lo que pide atención se parte en tres: lo que avisa y nadie reconoció (arriba), lo reconocido («Conocidos»: ya lo
// sabés, vuelve si empeora) y lo de comercios que no se siguen (se ve en la tabla pero no avisa: antes no estaba en
// este panel y la tabla mostraba alertas que acá no aparecían).
const stepFollowed = (x) => !x.signal.includes('@') || following.value.includes(`merchant:${x.signal.split('@')[1]}`)
const outOfNormal = (s) => s.state === 'alert' || s.state === 'warn'
const noticing = computed(() => [...(data.value?.services || []), ...(data.value?.liveness || []), ...(data.value?.lenderErrors || []), ...(data.value?.providers || []), ...(data.value?.rejections || []), ...(data.value?.funnel || []), ...(data.value?.newMessages || []), ...(data.value?.steps || []).filter(stepFollowed), ...(data.value?.lenders || []), ...(data.value?.merchants || [])]
  .filter(outOfNormal)
  // Lo peor primero y, a igual estado, lo que más plata mueve (stake: su parte de lo desembolsado en 28 días).
  .sort((a, b) => (SEVERITY[a.state] ?? 9) - (SEVERITY[b.state] ?? 9) || (b.stake?.share || 0) - (a.stake?.share || 0)))
const attention = computed(() => noticing.value.filter((s) => !s.acked))
const known = computed(() => noticing.value.filter((s) => s.acked))
const unfollowed = computed(() => (data.value?.steps || []).filter((x) => !stepFollowed(x) && outOfNormal(x)))
const showUnfollowed = ref(false)
async function setAck(s, on) {
  try {
    const res = await fetch(on ? '/api/ack' : `/api/ack?signal=${encodeURIComponent(s.signal)}`,
      on ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signal: s.signal }) } : { method: 'DELETE' })
    const body = await res.json()
    if (body.error) { apiError.value = body.error; return }
    data.value = body.overview || data.value
  } catch { apiError.value = 'No contesta la API: no se pudo reconocer.' }
}

function readRoute() {
  const { parts } = readHashRoute()
  if (parts[0] === 'queue') route.value = { kind: 'queue', id: 0 }
  else if ((parts[0] === 'service' || parts[0] === 'logs' || parts[0] === 'step' || parts[0] === 'jserr' || parts[0] === 'out' || parts[0] === 'reject' || parts[0] === 'funnel') && parts[1]) route.value = { kind: parts[0], id: 0, name: decodeURIComponent(parts[1]) }
  else route.value = (parts[0] === 'lender' || parts[0] === 'merchant' || parts[0] === 'lerr') && parts[1] ? { kind: parts[0], id: Number(parts[1]) } : { kind: 'all', id: 0 }
}
// Ir a una señal: `setRoute` recibe una URL, no las partes; con la lista escribía `/merchant,94` en la ruta y el
// editor, que lee el hash, volvía a «Toda la originación». Entra al historial: atrás vuelve a lo anterior.
const go = (parts) => setRoute(location.pathname.replace(/[^/]*$/, '') + hashRoute(parts), { push: true })
function pick(s) {
  if (!s || s.kind === 'all') go([])
  else if (s.kind === 'queue') go(['queue'])
  else if (s.kind === 'service') go(['service', s.name])
  else if (s.kind === 'logs') go(['logs', s.signal.slice(5)])
  else if (s.kind === 'step') go(['step', s.signal.slice(5)])
  else if (s.kind === 'jserr') go(['jserr', s.signal.slice(6)])
  else if (s.kind === 'out') go(['out', s.signal.slice(4)])
  else if (s.kind === 'reject') go(['reject', s.signal.slice(7)])
  else if (s.kind === 'funnel') go(['funnel', s.signal.slice(7)])
  else if (s.kind === 'newmsg') go(['service', s.message.service]) // el error nuevo se mira en su servicio
  else go([s.kind, String(s.id)])
  readRoute()
}
const isOn = (s) => route.value.kind === s.kind && (s.kind === 'queue' || (s.kind === 'service' ? route.value.name === s.name : s.kind === 'logs' || s.kind === 'step' || s.kind === 'jserr' || s.kind === 'out' || s.kind === 'reject' || s.kind === 'funnel' ? `${s.kind}:${route.value.name}` === s.signal : route.value.id === s.id))

// El último despliegue a producción de un servicio: los servicios de Loki se llaman como sus repos.
const lastDeployOf = (name) => (data.value?.deploys || []).find((d) => d.repo === name)
// Los servicios en producción (las tarjetas): su versión sale del último despliegue a producción en GitHub.
const apps = computed(() => data.value?.apps || [])
// Las tarjetas: las que piden atención arriba y completas; las normales, en una línea (eran 23 tarjetas largas y lo
// que importaba quedaba abajo). La elegida se abre aunque esté normal.
const APP_RANK = { alert: 0, warn: 1, ok: 2, quiet: 3 }
const sortedApps = computed(() => [...apps.value].sort((a, b) => (APP_RANK[a.state] ?? 4) - (APP_RANK[b.state] ?? 4)))
const compactCard = (a) => (a.state === 'ok' || a.state === 'quiet') && !a.lines?.silence && !(a.errors && isOn(a.errors)) && !(a.lines && isOn(a.lines)) && !appNote(a)
const isService = (s) => s?.kind === 'service' || s?.kind === 'logs' || s?.kind === 'jserr'
const serviceOf = (s) => (s.kind === 'logs' ? s.signal.slice(5) : s.kind === 'jserr' ? 'frontend-monorepo' : s.name)
// Una fuente que no contestó en la última pasada: la API sigue con lo que tiene y lo dice en una nota. Lo que se ve de
// esa fuente es lo de la última lectura buena, así que se marca: un número viejo sin aviso se lee como «todo normal».
// Los servicios salen de Loki; el front (sus errores de JavaScript) y las pantallas, de PostHog.
const sourceNoteOf = (s) => (!s ? '' : s.kind === 'service' || s.kind === 'logs' || s.kind === 'lerr' ? data.value?.logsNote || '' : s.kind === 'jserr' || s.kind === 'step' ? data.value?.stepsNote || '' : '')
const appNote = (a) => (a.service === 'frontend-monorepo' ? data.value?.stepsNote : data.value?.logsNote) || ''
const sourceNotes = computed(() => [['sin Loki', data.value?.logsNote], ['sin PostHog', data.value?.stepsNote], ['sin despliegues', data.value?.deploysNote], ['sin rechazo de CreditopX', data.value?.rejectNote]].filter((x) => x[1]))
const releaseOf = (s) => apps.value.find((a) => a.service === serviceOf(s))?.release
const silentFor = (m) => (m >= 2880 ? `${Math.floor(m / 1440)} días` : m >= 120 ? `${Math.floor(m / 60)} h` : `${m} min`)
const compact = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : fmt(n))
const ago = (iso) => {
  const h = Math.round((Date.now() - new Date(iso)) / 3600000)
  return h < 1 ? 'hace menos de una hora' : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`
}

// ── textos ──
const STATE_LABEL = { alert: 'alerta', warn: 'para mirar', ok: 'normal', quiet: 'poco volumen' }
// En la tabla, corto: es una columna.
const TABLE_KIND = { reject: 'Rechazo', out: 'Proveedor', newmsg: 'Error nuevo', jserr: 'Errores', step: 'Pantalla', lerr: 'Errores', lender: 'Entidad', merchant: 'Comercio', service: 'Errores', queue: 'Cola', all: 'Producción', logs: 'Vida' }
const KIND_LABEL = { funnel: 'Embudo del backend', reject: 'Rechazo de CreditopX', out: 'Proveedor externo', newmsg: 'Error que no estaba', jserr: 'Errores del front', step: 'Pantalla del wizard', lerr: 'Errores de una entidad', lender: 'Entidad', merchant: 'Comercio', all: 'Producción', service: 'Errores en los logs', queue: 'La cola', logs: 'Líneas en los logs' }
const NOTICE_LABEL = { alert: 'Alerta', warn: 'Para mirar', recovered: 'Volvió a lo normal', stale: 'Sin leer producción', late: 'Atrasados', gap: 'No estuvo mirando', verdict: 'Dictamen', why: 'Por qué' }
const NOTICE_DOT = { alert: 'alert', warn: 'warn', recovered: 'ok', stale: 'warn', late: 'warn', gap: 'warn', verdict: 'ok', why: 'warn' }
// EL DICTAMEN DE LA MAÑANA (verdict.go): lo escribe el modelo de segundo plano de lunes a viernes desde las 7:30. Su
// Markdown se muestra en renglones: los títulos en negrita, las viñetas como lista y el resto como párrafo.
const VERDICT_DOT = { green: 'ok', yellow: 'warn', red: 'alert' }
const verdictOpen = ref(false)
const plainMd = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').replace(/^#+\s*/, '')
const verdictLines = computed(() => (data.value?.verdict?.text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim())
  .map((l) => {
    const indent = /^\s{2,}-/.test(l)
    const t = l.trim()
    if (t.startsWith('- ')) return { kind: indent ? 'sub' : 'li', text: plainMd(t.slice(2)) }
    if (/^\*\*[^*]+\*\*:?$/.test(t)) return { kind: 'h', text: plainMd(t).replace(/:$/, '') }
    return { kind: 'p', text: plainMd(t) }
  }))
const verdictDay = computed(() => {
  const d = data.value?.verdict?.day
  if (!d) return ''
  const today = new Date().toLocaleDateString('en-CA')
  return d === today ? 'de hoy' : `del ${new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric' })}`
})
// La cabecera cuenta por nivel («2 alertas · 1 para mirar») con el color del peor: antes decía «3 para mirar» en
// amarillo aunque las tres fueran alertas.
const attentionCounts = computed(() => {
  const alerts = attention.value.filter((s) => s.state === 'alert').length
  const warns = attention.value.length - alerts
  const parts = []
  if (alerts) parts.push(`${alerts} ${alerts === 1 ? 'alerta' : 'alertas'}`)
  if (warns) parts.push(`${warns} para mirar`)
  return { text: parts.join(' · '), worst: alerts ? 'alert' : 'warn' }
})
// Un aviso lleva a su señal: «lender:6», «service:legacy-backend», «queue:failed»; «sentinel» y «all» a la vista general.
function pickSignal(sig) {
  const [kind, key] = String(sig).split(':')
  if (kind === 'lender' || kind === 'merchant' || kind === 'lerr') go([kind, key])
  else if (kind === 'service' || kind === 'logs' || kind === 'step' || kind === 'jserr' || kind === 'out' || kind === 'reject' || kind === 'funnel') go([kind, String(sig).slice(kind.length + 1)])
  else if (kind === 'queue') go(['queue'])
  else go([])
  readRoute()
}
// La ventana que mira una señal: una hora, o más para lo que se sigue y es chico (FollowedWindows en el servidor).
const hours = (s) => Math.round((s?.windowMinutes || 60) / 60)
const spanLabel = (s) => (hours(s) === 1 ? 'Última hora' : `Últimas ${hours(s)} horas`) // 24 h: un día móvil, no «hoy»
const spanShort = (s) => (hours(s) === 1 ? '' : ` (${hours(s)} h)`)
// Desde cuándo hasta cuándo mira: con 24 horas, la hora sola se repite («10:54–10:54»), así que va con el día.
function windowRange(s) {
  const from = new Date(new Date(data.value.windowTo) - (s.windowMinutes || 60) * 60000).toISOString()
  return hours(s) >= 24 ? `${dayClock(from)} – ${dayClock(data.value.windowTo)}` : `${clock(from)}–${clock(data.value.windowTo)}`
}
// «normal» con 29 errores contra 0 de mediana se leía como contradicción: está por debajo del techo (el percentil 99 de
// cualquier hora de los días comparables), y por eso no avisa. La marca lo dice.
const overButUnderCeiling = (s) => s.state === 'ok' && isErrors(s) && s.now.total >= 10 && s.now.total >= 1.5 * Math.max(s.median, 1)
const isErrors = (s) => s?.kind === 'service' || s?.kind === 'queue' || s?.kind === 'lerr' || s?.kind === 'jserr'
const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' })
// El cambio de nivel: no es alerta, es que lo normal se movió y se quedó (la última semana contra las anteriores).
const shiftText = (s) => s?.shift && `Cambio de nivel: ×${fmt(s.shift.ratio)} por día (de ${fmt(s.shift.before)} a ${fmt(s.shift.after)}), la última semana contra las anteriores. Ya cuenta como lo normal; si nadie lo explicó, vale la pena mirarlo.`
const dayBarMax = computed(() => Math.max(1, selected.value?.now?.total || 0, ...(selected.value?.samples || []).map((x) => x.n)))
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const dayClock = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '')
const pct = (x) => `${Math.round((x || 0) * 100)} %`
// Pesos en corto: «$1.234 millones», «$85,3 millones», «$950 mil».
const money = (x) => (x >= 1e9 ? `$${Math.round(x / 1e6).toLocaleString('es-CO')} millones` : x >= 1e6 ? `$${(x / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} millones` : `$${Math.round(x / 1e3).toLocaleString('es-CO')} mil`)
const sharePct = (x) => (x < 0.01 ? 'menos del 1 %' : pct(x))
const fmt = (x) => (Number.isInteger(x) ? String(x) : (x || 0).toFixed(1))
const repoShort = (r) => r.replace('legacy-', '')

// ── la curva: hoy contra lo normal (mediana y rango de los 7 días anteriores), por hora ──
const W = 720
const H = 220
// LA LÍNEA DEL DÍA (GET /api/day, lo de `bin/sentinel day`): cada tramo que se salió de lo normal hoy, con los
// despliegues y los avisos, en una tira de 0 a 23 h. Se pide al abrir y cada 10 minutos (cuesta ~3 s en el servidor).
const day = ref(null)
async function loadDay() {
  try {
    const res = await fetch('/api/day')
    if (res.ok) day.value = await res.json()
  } catch { /* sin la línea del día; lo demás sigue */ }
}
let dayTimer = null
const DAY_ROW = 26 // la etiqueta arriba de su barra, sin pisar la de la fila anterior
const timeline = computed(() => {
  const d = day.value
  if (!d) return null
  const x = (iso) => {
    const t = new Date(iso)
    return PAD.l + Math.min(24, t.getHours() + t.getMinutes() / 60) / 24 * (W - PAD.l - PAD.r)
  }
  const through = d.through
  const spells = (d.spells || []).slice(0, 12).map((sp, i) => {
    const x1 = x(sp.from)
    const x2 = Math.max(x1 + 3, x(sp.to || through))
    return { ...sp, i, x1, x2, y: 30 + i * DAY_ROW, label: `${sp.name} · ${dayClock(sp.from)}${sp.to ? `–${dayClock(sp.to)}` : ', sigue'}` }
  })
  const height = 34 + Math.max(1, spells.length) * DAY_ROW
  const deploys = (d.deploys || []).map((dp) => ({ ...dp, x: x(dp.at) }))
  const policies = (d.policies || []).map((p) => ({ ...p, x: x(p.at) }))
  const notices = (d.notices || []).filter((n) => n.level !== 'recovered').map((n) => ({ ...n, x: x(n.at) }))
  const hours = [0, 6, 12, 18, 24].map((h) => ({ h, x: PAD.l + (h / 24) * (W - PAD.l - PAD.r) }))
  return { spells, deploys, policies, notices, hours, height, more: Math.max(0, (d.spells || []).length - spells.length) }
})
const PAD = { l: 34, r: 12, t: 12, b: 24 }
const chart = computed(() => chartFor(selected.value))
// La curva de una señal: la del centro, y la de los errores de una entidad debajo de sus solicitudes.
function chartFor(s) {
  if (!s?.normal) return null
  const top = Math.max(4, ...s.normalHigh, ...(s.today || [])) * 1.1
  const x = (h) => PAD.l + (h / 23) * (W - PAD.l - PAD.r)
  const y = (v) => H - PAD.b - (v / top) * (H - PAD.t - PAD.b)
  const band = s.normalHigh.map((v, h) => `${x(h)},${y(v)}`).concat(s.normalLow.map((v, h) => `${x(h)},${y(v)}`).reverse()).join(' ')
  const median = s.normal.map((v, h) => `${x(h)},${y(v)}`).join(' ')
  const today = (s.today || []).map((v, h) => `${x(h)},${y(v)}`).join(' ')
  const last = (s.today || []).length - 1
  const ticks = [0, Math.round(top / 2), Math.round(top)].map((v) => ({ v, y: y(v) }))
  // Los despliegues de HOY, en su hora. Los de ayer se listan a la derecha.
  const todayStr = new Date().toDateString()
  const marks = (data.value?.deploys || []).filter((d) => new Date(d.at).toDateString() === todayStr).map((d) => {
    const t = new Date(d.at)
    return { ...d, x: x(t.getHours() + t.getMinutes() / 60) }
  })
  // Los cambios de política de HOY de la entidad elegida (o de todas, en el rechazo de CreditopX): como los despliegues.
  const lenderId = s.kind === 'lender' ? s.id : s.kind === 'reject' ? s.signal.slice(7) : null
  const policyMarks = lenderId == null ? [] : (data.value?.policies || [])
    .filter((p) => new Date(p.at).toDateString() === todayStr && (lenderId === 'all' || String(p.lenderId) === String(lenderId)))
    // varias versiones seguidas (tres en dos minutos el 18/11) se dibujaban encimadas: queda la última de cada tanda
    .filter((p, i, all) => !all.some((q) => q !== p && String(q.lenderId) === String(p.lenderId) && new Date(q.at) > new Date(p.at) && new Date(q.at) - new Date(p.at) < 30 * 60_000))
    .map((p) => { const t = new Date(p.at); return { ...p, x: x(t.getHours() + t.getMinutes() / 60) } })
  // Los tramos de HOY en que Sentinel no miró (el Mac dormido, la VPN): la curva ahí es real (se rellenó después), pero
  // nadie avisó de lo que pasó en ellos.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const hourOf = (iso) => Math.min(23, Math.max(0, (new Date(iso) - dayStart) / 3_600_000))
  const gaps = (data.value?.gaps || []).filter((g) => new Date(g.to) > dayStart).map((g) => ({
    key: g.from, x1: x(hourOf(g.from)), x2: x(hourOf(g.to)), title: `Sentinel no miró de ${dayClock(g.from)} a ${dayClock(g.to)}`,
  })).filter((g) => g.x2 - g.x1 > 1)
  return { band, median, today, ticks, marks, policyMarks, gaps, lastX: last >= 0 ? x(last) : 0, lastY: last >= 0 ? y(s.today[last]) : 0, hours: [0, 6, 12, 18, 23].map((h) => ({ h, x: x(h) })) }
}
// Los errores en los logs que nombran a la entidad elegida (preapprovals-service y legacy-backend).
const lenderErrors = computed(() => (selected.value?.kind === 'lender' ? (data.value?.lenderErrors || []).find((x) => x.id === selected.value.id) : null))
const lenderReject = computed(() => (selected.value?.kind === 'lender' ? (data.value?.rejections || []).find((x) => x.signal === `reject:${selected.value.id}`) : null))
// Casos de ejemplo de la señal elegida y, de una entidad, qué regla rechaza: se piden al tocar el botón (cuestan una
// consulta a Redash o a Loki), no en cada pasada. Sólo números de solicitud, con su enlace a tracer.
const EXAMPLE_KINDS = ['reject', 'lender', 'merchant', 'all', 'lerr', 'service']
const examples = ref(null)
const examplesBusy = ref(false)
async function loadExamples(s) {
  examplesBusy.value = true
  try {
    const res = await fetch(`/api/examples?signal=${encodeURIComponent(s.signal)}&minutes=${Math.max(60, s.windowMinutes || 60)}`)
    const body = await res.json()
    examples.value = { signal: s.signal, ...(res.ok ? body : { list: [], note: body.error || 'no contestó' }) }
  } catch (e) {
    examples.value = { signal: s.signal, list: [], note: String(e) }
  } finally { examplesBusy.value = false }
}
const rulesLender = computed(() => {
  const s = selected.value
  if (s?.kind === 'lender') return s.id
  if (s?.kind === 'reject' && s.signal !== 'reject:all') return Number(s.signal.slice(7))
  return null
})
const rules = ref(null)
const rulesBusy = ref(false)
async function loadRules(lender) {
  rulesBusy.value = true
  try {
    const res = await fetch(`/api/rules?lender=${lender}&hours=24`)
    const body = await res.json()
    rules.value = { lender, ...(res.ok ? body : { list: [], note: body.error || 'no contestó' }) }
  } catch (e) {
    rules.value = { lender, list: [], note: String(e) }
  } finally { rulesBusy.value = false }
}
const shownExamples = computed(() => (examples.value?.signal === selected.value?.signal ? examples.value : null))
const shownRules = computed(() => (rules.value && rules.value.lender === rulesLender.value ? rules.value : null))
const clockOf = (iso) => { const t = new Date(iso); return `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` }
const lenderErrorsOf = (s) => (s?.kind === 'lender' ? (data.value?.lenderErrors || []).find((x) => x.id === s.id) : null)
const errChart = computed(() => chartFor(lenderErrors.value))
// Las pantallas del wizard de lo elegido: de todo el wizard en la vista general, del comercio en la de un comercio.
const STEP_ORDER = ['otp', 'amount', 'registration', 'offer', 'amount-update']
const stepsOf = (s) => {
  const suffix = s?.kind === 'merchant' ? `@${s.id}` : s?.kind === 'all' ? '' : null
  if (suffix === null) return []
  return STEP_ORDER.map((id) => (data.value?.steps || []).find((x) => x.signal === `step:${id}${suffix}`)).filter(Boolean)
}
const shownSteps = computed(() => stepsOf(selected.value))
const stepLabel = (x) => x.name.split(' · ').slice(-1)[0]

// ── las regiones, con el contrato de la base ──
const sidebarOpen = ref(readSize('sentinel.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('sentinel.sidebar-w', 300))
const auxOpen = ref(readSize('sentinel.aux-open', 1) !== 0)
const auxW = ref(readSize('sentinel.aux-w', 320))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 240)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  return { sidebar, aux }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px` }))
const sidebarResize = {
  label: 'Ancho de la lista', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('sentinel.sidebar-open', v ? 1 : 0); if (v) saveSize('sentinel.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho de las alertas', sign: -1, defaultValue: 320,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('sentinel.aux-open', v ? 1 : 0); if (v) saveSize('sentinel.aux-w', auxW.value) },
}
// La consola: la tabla de todas las señales, debajo del editor. Mínimo o nada en alto, como en el tablero.
const viewportH = ref(window.innerHeight)
const panelOpen = ref(readSize('sentinel.panel-open', 1) !== 0)
const panelH = ref(readSize('sentinel.panel-h', 300))
const panelMax = () => Math.max(cssSize('--panel-min', 124), viewportH.value - 260)
const panelShown = computed(() => (panelOpen.value ? regionSize(panelH.value, cssSize('--panel-min', 124), panelMax()) : 0))
const panelResize = {
  label: 'Alto de la tabla de señales', axis: 'y', sign: -1, defaultValue: 300,
  min: () => cssSize('--panel-min', 124), max: panelMax,
  get: () => panelShown.value,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('sentinel.panel-open', v ? 1 : 0); if (v) saveSize('sentinel.panel-h', panelH.value) },
}
function togglePanel() {
  if (panelShown.value) { panelOpen.value = false } else { panelH.value = reopenSize(panelH.value, cssSize('--panel-min', 124), panelMax(), 300); panelOpen.value = true }
  saveSize('sentinel.panel-open', panelOpen.value ? 1 : 0)
}
const panelMaxButton = ref(null)
let panelMaxBinding = null
watch(panelMaxButton, (el) => { panelMaxBinding?.destroy?.(); panelMaxBinding = el ? bindPanelMaximize(el) : null })

function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('sentinel.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('sentinel.aux-open', auxOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  window.addEventListener('popstate', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  document.addEventListener('visibilitychange', onVisibility)
  load().then(schedule)
  loadDay()
  dayTimer = setInterval(loadDay, 600_000)
})
onBeforeUnmount(() => {
  clearInterval(dayTimer)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  window.removeEventListener('popstate', readRoute)
  document.removeEventListener('visibilitychange', onVisibility)
  clearTimeout(timer)
  themeBinding?.destroy?.()
  panelMaxBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Lo que se sigue">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Sentinel</span>
        <span v-if="attention.length" class="count attention" :class="`is-${attentionCounts.worst}`">{{ attentionCounts.text }}</span>
      </div>
      <div class="search">
        <input v-model="query" class="input" type="search" placeholder="Seguir un comercio o una entidad…" aria-label="Buscar un comercio o una entidad para seguir" />
      </div>
      <div class="region-body">
        <template v-if="query.trim()">
          <div class="region-head group"><span>Para seguir</span><span class="count">{{ suggestions.length }}</span></div>
          <p v-if="data && !suggestions.length" class="none">Nada con «{{ query }}» que no sigas ya.</p>
          <div v-for="s in suggestions" :key="`q-${s.signal}`" class="row subject suggestion">
            <button type="button" class="subject-open" :title="s.why" @click="pick(s)">
              <i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>
              <span class="subject-name">{{ s.name }}</span>
              <small class="subject-kind">{{ KIND_LABEL[s.kind].toLowerCase() }}</small>
            </button>
            <button type="button" class="region-action" :title="`Seguir ${s.name}`" :aria-label="`Seguir ${s.name}`" @click="setFollow(s, true)">
              <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <button type="button" class="row subject" :class="{ on: route.kind === 'all' }" @click="pick(null)">
          <i class="dot" :class="`is-${data?.all?.state}`" aria-hidden="true"></i>
          <span class="subject-name">Toda la originación</span>
          <svg v-if="spark(data?.all)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(data.all).normal" /><polyline class="spark-today" :points="spark(data.all).today" /></svg>
          <small v-if="data?.all" class="subject-nums" title="en la última hora · lo normal a esta hora">{{ data.all.now.total }} · {{ fmt(data.all.median) }}</small>
        </button>
        <p v-if="data && !followed.length" class="none">Todavía no seguís ninguno. Buscá un comercio o una entidad arriba y tocá + para seguirlo: de los comercios, sólo los que seguís avisan por macOS.</p>
        <template v-for="group in followedGroups" :key="group.kind">
          <div class="region-head group"><span>{{ group.title }}</span><span class="count">{{ group.list.length }}</span></div>
          <div v-for="s in group.list" :key="`f-${s.signal}`" class="row subject followed" :class="{ on: isOn(s), 'is-quiet': s.state === 'quiet' }">
            <button type="button" class="subject-open" :title="s.why" @click="pick(s)">
              <i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>
              <span class="subject-name">{{ s.name }}</span>
              <svg v-if="spark(s)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(s).normal" /><polyline class="spark-today" :points="spark(s).today" /></svg>
              <small class="subject-nums" :title="`${spanLabel(s).toLowerCase()} · lo normal en esa ventana`">{{ s.now.total }} · {{ fmt(s.median) }}</small>
              <small v-if="lenderErrorsOf(s)?.now.total" class="err-badge" :class="`is-${lenderErrorsOf(s).state}`" :title="`errores en los logs: ${lenderErrorsOf(s).why}`">{{ lenderErrorsOf(s).now.total }} err</small>
            </button>
            <button type="button" class="region-action unfollow" :title="`Dejar de seguir ${s.name}`" :aria-label="`Dejar de seguir ${s.name}`" @click="setFollow(s, false)">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <p v-if="!data && !apiError" class="none">{{ loading || 'Leyendo producción…' }}</p>
        <p v-if="apiError && !data" class="none">{{ apiError }}</p>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ selected ? selected.name : 'Sentinel' }}</span>
        <span v-if="selected" class="count">{{ KIND_LABEL[selected.kind] }} · {{ spanLabel(selected).toLowerCase() }} {{ windowRange(selected) }}</span>
      </div>
      <div class="region-body">
        <div v-if="selected" class="view">
          <p class="verdict" :class="`is-${selected.state}`">
            <i class="dot" :class="`is-${selected.state}`" aria-hidden="true"></i>
            <b>{{ STATE_LABEL[selected.state] }}</b> · {{ selected.why }}
          </p>
          <p v-if="sourceNoteOf(selected)" class="source-note" role="status">⚠ {{ sourceNoteOf(selected) }}. Lo que se ve acá es lo de la última lectura que sí llegó.</p>
          <p v-if="selected.raw !== selected.state && (selected.raw === 'alert' || selected.raw === 'warn')" class="note">
            Ahora mismo daría «{{ STATE_LABEL[selected.raw] }}», pero todavía no se sostuvo: se avisa cuando dura {{ data.rules.sustain }} lecturas seguidas ({{ data.rules.sustain * data.rules.stepMinutes }} min).</p>
          <p v-if="hours(selected) > 1" class="note">Mira las últimas {{ hours(selected) }} horas y no una: {{ selected.kind === 'reject' || selected.kind === 'out' || selected.kind === 'funnel' ? 'en una hora hay muy pocas para hablar de una tasa' : 'es de lo que seguís, y en una hora entra tan poco que no hay con qué comparar' }}.</p>
          <p v-if="selected.silence" class="note">Callado desde el {{ dayClock(selected.silence.since) }}: {{ silentFor(selected.silence.minutes) }} sin escribir una línea, más que el silencio más largo de las semanas anteriores ({{ silentFor(selected.silence.longest) }}). Se marca hasta que vuelva a escribir, aunque la estadística de la hora ya lo tome por normal.</p>
          <p v-if="selected.shift" class="note">{{ shiftText(selected) }}</p>
          <p v-if="selected.explain" class="note why-note"><b>Por qué (hipótesis del modelo, al pasar a alerta):</b> {{ selected.explain }}</p>
          <p v-if="selected.stake && selected.stake.share < 1" class="note">Mueve {{ sharePct(selected.stake.share) }} de lo desembolsado en los últimos 28 días (~{{ money(selected.stake.perDay) }} por día, {{ selected.stake.count }} créditos): es lo que se deja de colocar si esto se cae.</p>

          <div class="cards">
            <div class="card-num"><span class="card-label">{{ spanLabel(selected) }}</span><span class="card-value">{{ selected.now.total }}</span>
              <span class="card-what">{{ selected.kind === 'jserr' ? 'errores de JavaScript en el front (PostHog)' : selected.kind === 'step' ? 'enviaron esta pantalla (la curva: por hora)' : selected.kind === 'lerr' ? 'errores en los logs que nombran a la entidad' : selected.kind === 'service' ? 'errores en los logs de producción' : selected.kind === 'queue' ? 'trabajos fallidos en la cola' : selected.kind === 'logs' ? 'líneas que escribió en los logs (si deja de escribir, probablemente se cayó)' : selected.kind === 'reject' ? 'ofertas: perfilamientos en que el cliente vio la entidad' : selected.kind === 'funnel' ? `${selected.funnel?.toText || 'llegaron'} (la curva: por hora)` : 'solicitudes que entraron' }}</span></div>
            <div class="card-num"><span class="card-label">Lo normal</span><span class="card-value">{{ fmt(selected.median) }}</span>
              <span class="card-what">casi siempre entre {{ selected.low }} y {{ selected.high }} {{ hours(selected) === 1 ? 'a esta hora' : `en estas ${hours(selected)} horas` }}, en {{ selected.samples?.length || 0 }} días comparables</span></div>
            <div v-if="isService(selected)" class="card-num"><span class="card-label">Desplegado en producción</span>
              <template v-if="releaseOf(selected)">
                <span class="card-value">{{ releaseOf(selected).version }}</span>
                <span class="card-what">{{ ago(releaseOf(selected).at) }} · {{ dayClock(releaseOf(selected).at) }}{{ releaseOf(selected).ok ? '' : ' · ese despliegue FALLÓ' }}</span>
              </template>
              <span v-else class="card-what">sin despliegues a producción en GitHub</span></div>
            <div v-else-if="selected.kind === 'step'" class="card-num"><span class="card-label">La enviaron · fallaron</span>
              <span class="card-value">{{ selected.step?.rate >= 0 ? `${Math.round(selected.step.rate * 100)} %` : '—' }} · {{ selected.step?.done ? `${Math.round(selected.step.failRate * 100)} %` : '—' }}</span>
              <span class="card-what">de {{ selected.step?.views || 0 }} que la vieron; lo normal, {{ selected.step?.baseRate ? `${Math.round(selected.step.baseRate * 100)} %` : '—' }} y {{ selected.step?.baseFail ? `${Math.round(selected.step.baseFail * 100)} %` : '—' }} de fallos</span></div>
            <div v-else-if="selected.kind === 'funnel'" class="card-num"><span class="card-label">Siguieron</span>
              <span class="card-value">{{ selected.funnel ? pct(selected.funnel.rate) : '—' }}</span>
              <span class="card-what">{{ selected.funnel?.reached || 0 }} de {{ selected.funnel?.from || 0 }} que {{ selected.funnel?.fromText }}; lo normal a esta hora, {{ selected.funnel ? pct(selected.funnel.baseRate) : '—' }}</span></div>
            <div v-else-if="selected.kind === 'reject'" class="card-num"><span class="card-label">Rechazadas</span>
              <span class="card-value">{{ selected.reject ? pct(selected.reject.rate) : '—' }}</span>
              <span class="card-what">{{ selected.reject?.rejects || 0 }} de {{ selected.reject?.offers || 0 }} ofertas; lo normal a esta hora, {{ selected.reject ? pct(selected.reject.baseRate) : '—' }}{{ selected.reject?.policy ? ` · ${selected.reject.policy}` : '' }}</span></div>
            <div v-else-if="!isErrors(selected)" class="card-num"><span class="card-label">Aprobadas · negadas</span><span class="card-value">{{ selected.now.approved }} · {{ selected.now.denied }}</span>
              <span class="card-what">negadas {{ pct(selected.deniedRate) }} de las que terminaron; lo de hoy todavía avanza</span></div>
          </div>

          <section class="chart-box">
            <div class="chart-head">
              <h3>Hoy, hora por hora</h3>
              <span class="legend"><i class="sw today" aria-hidden="true"></i>hoy <i class="sw normal" aria-hidden="true"></i>lo normal (mediana)
                <i class="sw band" aria-hidden="true"></i>casi siempre (días comparables) <i class="sw deploy" aria-hidden="true"></i>despliegue a producción</span>
            </div>
            <svg v-if="chart" class="chart" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`${selected.kind === 'service' ? 'Errores' : 'Solicitudes'} por hora de ${selected.name}, hoy contra lo normal`">
              <g class="grid">
                <line v-for="t in chart.ticks" :key="t.v" :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" />
                <text v-for="t in chart.ticks" :key="`l${t.v}`" :x="PAD.l - 6" :y="t.y + 4" text-anchor="end">{{ t.v }}</text>
                <text v-for="h in chart.hours" :key="`h${h.h}`" :x="h.x" :y="H - 6" text-anchor="middle">{{ h.h }}h</text>
              </g>
              <rect v-for="g in chart.gaps" :key="g.key" class="gap" :x="g.x1" :y="PAD.t" :width="g.x2 - g.x1" :height="H - PAD.t - PAD.b"><title>{{ g.title }}</title></rect>
              <polygon class="band" :points="chart.band" />
              <polyline class="median" :points="chart.median" />
              <g v-for="m in chart.marks" :key="m.url" class="deploy-mark">
                <line :x1="m.x" :x2="m.x" :y1="PAD.t" :y2="H - PAD.b" />
                <text :x="m.x + 4" :y="PAD.t + 10">{{ repoShort(m.repo) }} {{ m.version }}</text>
              </g>
              <g v-for="p in chart.policyMarks" :key="`pol-${p.lenderId}-${p.version}`" class="policy-mark">
                <line :x1="p.x" :x2="p.x" :y1="PAD.t" :y2="H - PAD.b" />
                <text :x="p.x + 4" :y="PAD.t + 22">política v{{ p.version }}</text>
                <title>Cambio de política de {{ p.lender }} (versión {{ p.version }}) · {{ dayClock(p.at) }}</title>
              </g>
              <polyline class="today" :points="chart.today" />
              <circle class="now" :cx="chart.lastX" :cy="chart.lastY" r="4"><title>hora en curso: todavía se está llenando</title></circle>
            </svg>
            <p class="chart-note">El último punto es la hora en curso: todavía se está llenando.</p>
          </section>
          <section v-if="selected?.kind === 'all' && timeline" class="chart-box day-line" aria-label="La línea del día">
            <div class="chart-head"><h3>La línea del día</h3></div>
            <p v-if="!timeline.spells.length" class="none">Hoy nada se salió de lo normal.</p>
            <svg class="chart timeline" :viewBox="`0 0 ${W} ${timeline.height}`" role="img" aria-label="Lo que se salió de lo normal hoy, por hora">
              <g class="grid">
                <line v-for="h in timeline.hours" :key="`tl${h.h}`" :x1="h.x" :x2="h.x" y1="10" :y2="timeline.height - 14" />
                <text v-for="h in timeline.hours" :key="`tt${h.h}`" :x="h.x" :y="timeline.height - 2" text-anchor="middle">{{ h.h }}h</text>
              </g>
              <g v-for="dp in timeline.deploys" :key="dp.url" class="deploy-mark">
                <line :x1="dp.x" :x2="dp.x" y1="6" :y2="timeline.height - 14" />
                <title>{{ repoShort(dp.repo) }} {{ dp.version }} · {{ dayClock(dp.at) }}</title>
              </g>
              <g v-for="p in timeline.policies" :key="`tp-${p.lenderId}-${p.version}`" class="policy-mark">
                <line :x1="p.x" :x2="p.x" y1="6" :y2="timeline.height - 14" />
                <title>Cambio de política de {{ p.lender }} (versión {{ p.version }}) · {{ dayClock(p.at) }}</title>
              </g>
              <g v-for="sp in timeline.spells" :key="`sp-${sp.signal}-${sp.from}`" class="spell" :class="`is-${sp.level}`" @click="pickSignal(sp.signal)">
                <rect :x="sp.x1" :y="sp.y - 2" :width="sp.x2 - sp.x1" height="8" rx="2" />
                <text :x="Math.min(sp.x1, W - PAD.r - 260)" :y="sp.y - 5">{{ sp.label }}</text>
                <title>{{ sp.why }}</title>
              </g>
              <g v-for="n in timeline.notices" :key="`tn-${n.at}-${n.signal}`" class="notice-mark">
                <circle :cx="n.x" cy="8" r="3" :class="`is-${NOTICE_DOT[n.level] || 'warn'}`" />
                <title>{{ NOTICE_LABEL[n.level] || n.level }} · {{ n.name }} · {{ dayClock(n.at) }}{{ n.sent ? '' : ' · no salió' }}</title>
              </g>
            </svg>
            <p v-if="timeline.more" class="chart-note">Y {{ timeline.more }} tramos más: <code>bin/sentinel day</code> los lista todos.</p>
          </section>

          <section v-if="selected.samples?.length" class="days">
            <h3>{{ hours(selected) === 1 ? 'Esta misma hora' : `Estas mismas ${hours(selected)} horas` }}, los días comparables</h3>
            <div class="day-bars">
              <div v-for="x in [...selected.samples].reverse()" :key="x.date" class="day-bar" :title="`${x.date}: ${x.n}`">
                <span class="bar" :style="{ height: `${Math.max(4, (x.n / dayBarMax) * 64)}px` }"></span>
                <small>{{ shortDate(x.date) }}</small>
              </div>
              <div class="day-bar today" :title="`hoy: ${selected.now.total}`">
                <span class="bar" :style="{ height: `${Math.max(4, (selected.now.total / dayBarMax) * 64)}px` }"></span>
                <small>hoy</small>
              </div>
            </div>
          </section>

          <section v-if="shownSteps.length" class="steps-box">
            <h3>Pantallas del wizard{{ selected.kind === 'merchant' ? ` en ${selected.name}` : '' }}</h3>
            <table class="table steps">
              <thead><tr><th>Pantalla</th><th class="num">La vieron</th><th class="num">La enviaron</th><th class="num">Lo normal</th><th class="num">Fallaron</th><th class="num">Lo normal</th></tr></thead>
              <tbody>
                <tr v-for="x in shownSteps" :key="x.signal" :title="x.why" @click="pick(x)">
                  <td><i class="dot" :class="`is-${x.state}`" aria-hidden="true"></i>{{ stepLabel(x) }}<small v-if="hours(x) > 1" class="muted"> ({{ hours(x) }} h)</small></td>
                  <td class="num">{{ x.step?.views || '—' }}</td>
                  <td class="num"><b>{{ x.step && x.step.rate >= 0 ? `${Math.round(x.step.rate * 100)} %` : x.step?.done }}</b></td>
                  <td class="num muted">{{ x.step?.baseRate ? `${Math.round(x.step.baseRate * 100)} %` : '—' }}</td>
                  <td class="num"><b>{{ x.step?.done && (x.step.fails || x.step.baseFail) ? `${Math.round(x.step.failRate * 100)} %` : '—' }}</b></td>
                  <td class="num muted">{{ x.step?.baseFail ? `${Math.round(x.step.baseFail * 100)} %` : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="chart-note">De PostHog: de los que vieron cada pantalla, cuántos la enviaron, y de los resultados, cuántos fallaron, contra lo normal de esta hora. Si un despliegue del front rompe una pantalla, el backend no se entera; esto sí.<template v-if="data.stepsNote"> ⚠ {{ data.stepsNote }}</template></p>
          </section>

          <section v-if="selected.kind === 'all' && data.funnel?.length" class="steps-box">
            <h3>Embudo del backend</h3>
            <table class="table steps">
              <thead><tr><th>Etapa</th><th class="num">De</th><th class="num">Siguieron</th><th class="num">Lo normal</th></tr></thead>
              <tbody>
                <tr v-for="x in data.funnel" :key="x.signal" :title="x.why" @click="pick(x)">
                  <td><i class="dot" :class="`is-${x.state}`" aria-hidden="true"></i>{{ x.name.replace('Embudo · ', '') }}<small v-if="hours(x) > 1" class="muted"> ({{ hours(x) }} h)</small></td>
                  <td class="num">{{ x.funnel?.from ?? '—' }}</td>
                  <td class="num"><b>{{ x.funnel ? pct(x.funnel.rate) : '—' }}</b></td>
                  <td class="num muted">{{ x.funnel?.baseRate ? pct(x.funnel.baseRate) : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="chart-note">De la base: de las que entraron, cuántas se perfilaron, y de esas, cuántas eligieron entidad (la primera vez de cada solicitud), contra lo normal de esta hora. Que entren igual y se queden en una etapa es lo que el volumen no ve.</p>
          </section>

          <section v-if="lenderReject" class="chart-box lender-reject">
            <div class="chart-head">
              <h3>Rechazo de CreditopX</h3>
              <button type="button" class="btn btn-link btn-xs" @click="pick(lenderReject)">abrir como señal</button>
            </div>
            <p class="verdict" :class="`is-${lenderReject.state}`">
              <i class="dot" :class="`is-${lenderReject.state}`" aria-hidden="true"></i>
              <b>{{ STATE_LABEL[lenderReject.state] }}</b> · {{ lenderReject.why }}
            </p>
          </section>

          <section v-if="rulesLender" class="chart-box rules-box">
            <div class="chart-head">
              <h3>Qué regla rechaza</h3>
              <button type="button" class="btn btn-link btn-xs" :disabled="rulesBusy" @click="loadRules(rulesLender)">{{ rulesBusy ? 'leyendo…' : shownRules ? 'volver a leer' : 'ver' }}</button>
            </div>
            <template v-if="shownRules">
              <table v-if="shownRules.list?.length" class="steps-table">
                <thead><tr><th>Regla</th><th class="num">Últimas {{ shownRules.hours }} h</th><th class="num">7 días antes</th></tr></thead>
                <tbody>
                  <tr v-for="r in shownRules.list.slice(0, 8)" :key="`${r.rule}-${r.column}-${r.value}`" :class="{ 'is-up': r.rateNow >= r.rateBefore * 1.5 && r.rateNow - r.rateBefore >= 0.02 }">
                    <td :title="`${r.column} ${r.operator} ${r.value}`">{{ r.rule || r.column }}</td>
                    <td class="num">{{ pct(r.rateNow) }} <small class="muted">({{ r.failsNow }} de {{ r.evalsNow }})</small></td>
                    <td class="num">{{ pct(r.rateBefore) }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="chart-note">{{ shownRules.note || 'De las reglas duras de los perfilamientos: en cuántos falló cada una, ahora contra los 7 días anteriores, de la que más subió a la que menos.' }}</p>
            </template>
            <p v-else class="chart-note">Las reglas duras que la rechazan en los perfilamientos, ahora contra los 7 días anteriores. Se lee al pedirlo (una consulta a la base).</p>
          </section>

          <section v-if="EXAMPLE_KINDS.includes(selected.kind)" class="chart-box examples-box">
            <div class="chart-head">
              <h3>Casos de ejemplo</h3>
              <button type="button" class="btn btn-link btn-xs" :disabled="examplesBusy" @click="loadExamples(selected)">{{ examplesBusy ? 'leyendo…' : shownExamples ? 'volver a leer' : 'ver' }}</button>
            </div>
            <template v-if="shownExamples">
              <ul v-if="shownExamples.list?.length" class="examples">
                <li v-for="x in shownExamples.list" :key="x.ureq">
                  <a :href="x.tracer" target="_blank" rel="noopener">#{{ x.ureq }}</a>
                  <span class="muted">{{ clockOf(x.at) }}</span>
                  <span v-if="x.note" class="ex-note">{{ x.note }}</span>
                  <code :title="'Por consola'">{{ x.cmd }}</code>
                </li>
              </ul>
              <p class="chart-note">{{ shownExamples.note || `De ${shownExamples.source}. Cada número abre la solicitud en tracer (VPN de producción).` }}</p>
            </template>
            <p v-else class="chart-note">Solicitudes de esta ventana para ir a mirar una por una, con su enlace a tracer y el comando de consola.</p>
          </section>

          <section v-if="selected.kind === 'lender'" class="chart-box lender-errors">
            <div class="chart-head">
              <h3>Errores en los logs que la nombran</h3>
              <button v-if="lenderErrors" type="button" class="btn btn-link btn-xs" @click="pick(lenderErrors)">abrir como señal</button>
            </div>
            <template v-if="lenderErrors">
              <p class="verdict" :class="`is-${lenderErrors.state}`">
                <i class="dot" :class="`is-${lenderErrors.state}`" aria-hidden="true"></i>
                <b>{{ STATE_LABEL[lenderErrors.state] }}</b> · {{ lenderErrors.why }}
              </p>
              <svg v-if="errChart" class="chart chart-small" :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Errores por hora de ${selected.name}, hoy contra lo normal`">
                <g class="grid">
                  <line v-for="t in errChart.ticks" :key="t.v" :x1="PAD.l" :x2="W - PAD.r" :y1="t.y" :y2="t.y" />
                  <text v-for="t in errChart.ticks" :key="`l${t.v}`" :x="PAD.l - 6" :y="t.y + 4" text-anchor="end">{{ t.v }}</text>
                  <text v-for="h in errChart.hours" :key="`h${h.h}`" :x="h.x" :y="H - 6" text-anchor="middle">{{ h.h }}h</text>
                </g>
                <polygon class="band" :points="errChart.band" />
                <polyline class="median" :points="errChart.median" />
                <polyline class="today errors" :points="errChart.today" />
                <circle class="now errors" :cx="errChart.lastX" :cy="errChart.lastY" r="4" />
              </svg>
            </template>
            <p class="chart-note">Cuentan los errores de preapprovals-service (que nombra la entidad en cada línea) y los de legacy-backend que traen su id;
              los demás servicios no la nombran.<template v-if="!lenderErrors"> En cuatro semanas, ninguno nombra a {{ selected.name }}.</template></p>
          </section>
        </div>
        <div v-else class="empty-state">
          <p class="empty-title">Sentinel</p>
          <p>{{ apiError || loading || 'Leyendo producción…' }}</p>
        </div>
      </div>
    </main>

    <section v-if="panelShown" class="panel signals-panel" :style="{ height: `${panelShown}px` }" aria-label="Todas las señales">
      <div class="rsz rsz-edge-top" data-rsz="panel" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Qué señales">
        <button v-for="t in KIND_TABS" :key="t.id" type="button" role="tab" class="tab" :aria-selected="tableKind === t.id" @click="tableKind = t.id">
          <span>{{ t.label }}</span><span class="count">{{ kindCount(t.id) }}</span>
        </button>
        <div class="region-actions">
          <input v-model="tableQuery" class="input table-search" type="search" placeholder="Filtrar…" aria-label="Filtrar la tabla" />
          <label class="idle-check" title="Las que a esta hora no tienen movimiento: lo normal es 0 y hoy tampoco entró nada">
            <input v-model="showIdle" type="checkbox" /> sin movimiento
          </label>
          <button ref="panelMaxButton" type="button" class="region-action"></button>
          <button type="button" class="region-action" title="Cerrar la tabla" aria-label="Cerrar la tabla" @click="togglePanel">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div class="region-body table-wrap">
        <table class="table signals">
          <thead>
            <tr>
              <th :aria-sort="ariaSort('state')"><button type="button" class="th-sort" @click="sortOn('state')">Estado</button></th>
              <th :aria-sort="ariaSort('name')"><button type="button" class="th-sort" @click="sortOn('name')">Señal</button></th>
              <th :aria-sort="ariaSort('kind')"><button type="button" class="th-sort" @click="sortOn('kind')">Tipo</button></th>
              <th class="num" :aria-sort="ariaSort('now')"><button type="button" class="th-sort" @click="sortOn('now')">Última hora</button></th>
              <th class="num" :aria-sort="ariaSort('median')"><button type="button" class="th-sort" @click="sortOn('median')">Lo normal</button></th>
              <th class="num">Casi siempre</th>
              <th class="num" :aria-sort="ariaSort('z')"><button type="button" class="th-sort" @click="sortOn('z')">z</button></th>
              <th class="num">Aprob. · neg.</th>
              <th class="follow-col"><span class="sr-only">Seguir</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in tableRows" :key="`t-${s.signal}`" :class="{ on: isOn(s) }" :title="s.why" @click="pick(s)">
              <td><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ STATE_LABEL[s.state] }}<b v-if="overButUnderCeiling(s)" class="over-mark" title="Sobre lo normal de esta hora, pero por debajo del techo (lo que llega a pasar en una hora cualquiera de los días comparables): por eso no avisa">↑</b></td>
              <td class="name-cell">{{ s.name }}</td>
              <td class="muted">{{ TABLE_KIND[s.kind] }}</td>
              <td class="num">{{ s.now.total }}<small v-if="hours(s) > 1" class="muted">{{ spanShort(s) }}</small></td>
              <td class="num">{{ fmt(s.median) }}</td>
              <td class="num muted">{{ s.low }}–{{ s.high }}</td>
              <td class="num">{{ s.z ? s.z.toFixed(1) : '·' }}</td>
              <td class="num muted">{{ s.kind === 'funnel' && s.funnel ? `${pct(s.funnel.rate)} · lo normal ${pct(s.funnel.baseRate)}` : s.kind === 'reject' && s.reject ? `${pct(s.reject.rate)} · lo normal ${pct(s.reject.baseRate)}` : s.kind === 'out' && s.out ? `${s.out.fails} fallas` : isErrors(s) || s.kind === 'logs' || s.kind === 'step' ? '' : `${s.now.approved} · ${s.now.denied}` }}</td>
              <td class="follow-col">
                <button v-if="canFollow(s)" type="button" class="region-action" :class="{ following: isFollowed(s) }"
                        :aria-pressed="isFollowed(s)" :title="isFollowed(s) ? `Dejar de seguir ${s.name}` : `Seguir ${s.name}`"
                        :aria-label="isFollowed(s) ? `Dejar de seguir ${s.name}` : `Seguir ${s.name}`" @click.stop="setFollow(s, !isFollowed(s))">
                  <span class="ui-icon" :data-icon="isFollowed(s) ? 'check' : 'plus'" aria-hidden="true"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="data && !tableRows.length" class="none">Nada con ese filtro.</p>
      </div>
    </section>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="Alertas y despliegues">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Para mirar</span>
        <span class="count attention" :class="`is-${attentionCounts.worst}`">{{ attentionCounts.text || 0 }}</span>
      </div>
      <div class="region-body">
        <p v-if="data?.unsent" class="source-note is-alert" role="alert">
          ⚠ {{ data.unsent.count }} {{ data.unsent.count === 1 ? 'aviso no salió' : 'avisos no salieron' }} desde {{ dayClock(data.unsent.since) }}.
          Salen juntos cuando el aviso vuelva a funcionar.<small v-if="data.unsent.error" class="row-desc">{{ data.unsent.error }}</small>
        </p>
        <section v-if="data?.verdict" class="verdict-box" aria-label="Dictamen">
          <button type="button" class="verdict-head" :aria-expanded="verdictOpen" @click="verdictOpen = !verdictOpen">
            <i class="dot" :class="`is-${VERDICT_DOT[data.verdict.level] || 'warn'}`" aria-hidden="true"></i>
            <span>Dictamen {{ verdictDay }}</span>
            <span class="ui-icon verdict-chevron" data-icon="chevron" aria-hidden="true"></span>
          </button>
          <p class="verdict-lede">{{ verdictLines[0]?.text }}</p>
          <div v-show="verdictOpen" class="verdict-rest">
            <template v-for="(l, i) in verdictLines.slice(1)" :key="i">
              <p v-if="l.kind === 'h'" class="verdict-h">{{ l.text }}</p>
              <p v-else-if="l.kind === 'li' || l.kind === 'sub'" class="verdict-li" :class="{ sub: l.kind === 'sub' }">{{ l.text }}</p>
              <p v-else class="verdict-p">{{ l.text }}</p>
            </template>
            <small class="row-desc">Lo escribió el modelo de segundo plano ({{ data.verdict.model }}) con lo guardado de ayer y de hoy. Lo que dice como causa es hipótesis. Por consola: <code>bin/sentinel verdict</code>.</small>
          </div>
        </section>
        <p v-if="data && !attention.length" class="none">Nada fuera de lo normal en la última hora{{ known.length ? ' que no conozcas' : '' }}.</p>
        <div v-for="s in attention" :key="`a-${s.signal}`" class="attention-item">
          <button type="button" class="row stacked attention-row" :class="`is-${s.state}`" @click="pick(s)">
            <span class="attention-name"><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ s.name }}</span>
            <small class="muted attention-kind">{{ KIND_LABEL[s.kind] }}</small>
            <small class="row-desc">{{ s.why }}</small>
            <small v-if="s.explain" class="row-desc why-text">Por qué: {{ s.explain }}</small>
          </button>
          <button type="button" class="btn btn-ghost ack" title="Ya lo sé: pasa a «Conocidos» hasta que se cierre o empeore" @click="setAck(s, true)">Reconocer</button>
        </div>

        <template v-if="known.length">
          <div class="region-head group"><span>Conocidos</span><span class="count">{{ known.length }}</span></div>
          <div v-for="s in known" :key="`k-${s.signal}`" class="attention-item">
            <button type="button" class="row attention-row known" :title="s.why" @click="pick(s)">
              <span class="attention-name"><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ s.name }}</span>
            </button>
            <button type="button" class="btn btn-ghost ack" title="Vuelve a «Para mirar»" @click="setAck(s, false)">Devolver</button>
          </div>
        </template>

        <template v-if="unfollowed.length">
          <button type="button" class="region-head group toggle" :aria-expanded="showUnfollowed" @click="showUnfollowed = !showUnfollowed">
            <span>{{ showUnfollowed ? '▾' : '▸' }} De lo que no seguís · no avisa</span><span class="count">{{ unfollowed.length }}</span>
          </button>
          <template v-if="showUnfollowed">
            <button v-for="s in unfollowed" :key="`u-${s.signal}`" type="button" class="row stacked attention-row" @click="pick(s)">
              <span class="attention-name"><i class="dot" :class="`is-${s.state}`" aria-hidden="true"></i>{{ s.name }}</span>
              <small class="row-desc">{{ s.why }}</small>
            </button>
          </template>
        </template>

        <template v-if="data?.newMessages?.length || data?.messagesNote">
          <div class="region-head group"><span>Errores que no estaban</span><span class="count">{{ data?.newMessages?.length || 0 }}</span></div>
          <p v-if="data?.messagesNote" class="source-note" role="status">⚠ {{ data.messagesNote }}</p>
          <button v-for="m in data?.newMessages || []" :key="`m-${m.signal}`" type="button" class="row stacked attention-row" :title="m.message?.sample" @click="pick(m)">
            <span class="attention-name"><i class="dot" :class="`is-${m.state}`" aria-hidden="true"></i>{{ m.message?.service }} · {{ m.message?.count }} {{ m.message?.count === 1 ? 'vez' : 'veces' }}</span>
            <small class="row-desc msg-text">{{ m.message?.text }}</small>
            <small class="row-desc">desde {{ dayClock(m.message?.first) }}</small>
          </button>
        </template>

        <div class="region-head group"><span>Servicios en producción</span><span class="count">{{ apps.length }}</span></div>
        <p v-if="data?.logsNote" class="source-note" role="status">⚠ {{ data.logsNote }}. Los errores y las líneas de las tarjetas son los de la última lectura que sí llegó.</p>
        <p v-if="data && !apps.length" class="none">Todavía sin servicios: se leen de los logs de producción.</p>
        <div class="app-cards">
          <div v-for="a in sortedApps" :key="a.service" class="app-card" :title="appNote(a) ? `Datos viejos: ${appNote(a)}` : null"
               :class="[`is-${a.state}`, { on: (a.errors && isOn(a.errors)) || (a.lines && isOn(a.lines)), 'is-old': appNote(a), compact: compactCard(a) }]">
            <div class="app-head">
              <i class="dot" :class="`is-${a.state}`" aria-hidden="true"></i>
              <span class="app-name" :title="a.repo && a.repo !== a.service ? `repo ${a.repo}` : a.service">{{ a.service }}</span>
              <button v-if="compactCard(a)" type="button" class="app-inline" :title="a.errors?.why || a.lines?.why" @click="pick(a.errors || a.lines)">
                {{ a.errors ? `${compact(a.errors.now.total)} err` : '' }}{{ a.errors && a.lines ? ' · ' : '' }}{{ a.lines ? `${compact(a.lines.now.total)} lín` : '' }}
              </button>
              <a v-if="a.release" class="app-version" :class="{ failed: !a.release.ok }" :href="a.release.url" target="_blank" rel="noopener"
                 :title="`${a.release.title} · ${dayClock(a.release.at)}`">{{ a.release.version }}</a>
            </div>
            <template v-if="!compactCard(a)">
            <small class="app-when">
              <template v-if="a.release">desplegado {{ ago(a.release.at) }}<template v-if="!a.release.ok"> · FALLÓ<template v-if="a.release.lastOk">, sigue {{ a.release.lastOk.version }}</template></template></template>
              <template v-else>sin despliegues a producción en GitHub</template>
            </small>
            <small v-if="a.lines?.silence" class="app-silent" :title="a.lines.silence.why">
              callado desde el {{ dayClock(a.lines.silence.since) }} · {{ silentFor(a.lines.silence.minutes) }}
            </small>
            <div class="app-metrics">
              <button v-if="a.errors" type="button" class="metric" :title="a.errors.why" @click="pick(a.errors)">
                <span class="metric-label"><i class="dot" :class="`is-${a.errors.state}`" aria-hidden="true"></i>errores</span>
                <span class="metric-nums"><b>{{ compact(a.errors.now.total) }}</b> · {{ compact(a.errors.median) }}</span>
                <svg v-if="spark(a.errors)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(a.errors).normal" /><polyline class="spark-today" :points="spark(a.errors).today" /></svg>
              </button>
              <span v-else class="metric metric-none"><span class="metric-label">errores</span><span class="metric-nums"><b>0</b> en 4 semanas</span></span>
              <button v-if="a.lines" type="button" class="metric" :title="a.lines.why" @click="pick(a.lines)">
                <span class="metric-label"><i class="dot" :class="`is-${a.lines.state}`" aria-hidden="true"></i>líneas</span>
                <span class="metric-nums"><b>{{ compact(a.lines.now.total) }}</b> · {{ compact(a.lines.median) }}</span>
                <svg v-if="spark(a.lines)" class="spark" viewBox="0 0 72 22" aria-hidden="true"><polyline class="spark-normal" :points="spark(a.lines).normal" /><polyline class="spark-today" :points="spark(a.lines).today" /></svg>
              </button>
            </div>
            </template>
          </div>
        </div>

        <div class="region-head group"><span>Avisos</span><span class="count">{{ data?.notices?.length || 0 }}</span></div>
        <p v-if="data && !data.notices?.length" class="none">Ninguno todavía. Avisa macOS cuando algo pasa a alerta, una vez por episodio, y cuando vuelve.</p>
        <button v-for="n in data?.notices || []" :key="`${n.at}-${n.signal}`" type="button" class="row stacked" :class="{ unsent: !n.sent }" :title="n.via ? `${n.text}\nSalió por ${n.via}` : n.text" @click="pickSignal(n.signal)">
          <span><i class="dot" :class="`is-${NOTICE_DOT[n.level] || 'warn'}`" aria-hidden="true"></i>{{ NOTICE_LABEL[n.level] || n.level }} · {{ n.name }}<b v-if="!n.sent" class="unsent-tag">no salió</b></span>
          <small class="row-desc">{{ dayClock(n.at) }} · {{ n.text }}</small>
        </button>

        <div class="region-head group"><span>Despliegues a producción</span><span class="count">{{ data?.deploys?.length || 0 }}</span></div>
        <p v-if="data?.deploysNote" class="source-note" role="status">⚠ {{ data.deploysNote }}</p>
        <p v-if="data && !data.deploys?.length && !data.deploysNote" class="none">Ninguno en los últimos días.</p>
        <a v-for="d in data?.deploys || []" :key="d.url" class="row stacked" :href="d.url" target="_blank" rel="noopener">
          <span><i class="dot" :class="d.ok ? 'is-ok' : 'is-alert'" aria-hidden="true"></i>{{ repoShort(d.repo) }} <b>{{ d.version }}</b></span>
          <small class="row-desc">{{ dayClock(d.at) }} · {{ d.title }}</small>
        </a>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="data">{{ data.source }} · leído a las {{ clock(data.checkedAt) }} ({{ fmt(data.seconds) }} s) · {{ data.history.days }} días guardados desde el {{ data.history.from }}</span>
      <span v-else>{{ apiError || 'leyendo producción…' }}</span>
      <span v-if="apiError && data" class="statusbar-item warn-text">{{ apiError }}</span>
      <span v-for="n in sourceNotes" :key="n[0]" class="statusbar-item warn-text" :title="n[1]">⚠ {{ n[0] }}</span>
      <span v-if="loading && data" class="statusbar-item">{{ loading }}</span>
      <span v-else-if="stale" class="statusbar-item">lo guardado de las {{ clock(data.checkedAt) }}; leyendo lo de ahora…</span>
      <button type="button" class="statusbar-item" :disabled="running" @click="refresh">{{ running ? 'leyendo…' : 'leer ahora' }}</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar la lista" aria-label="Mostrar u ocultar la lista" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!panelShown" title="Mostrar u ocultar la tabla de señales" aria-label="Mostrar u ocultar la tabla de señales" @click="togglePanel">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar las alertas" aria-label="Mostrar u ocultar las alertas" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.search { padding: 0 var(--space-3) var(--space-2) }
.search .input { width: 100%; box-sizing: border-box }
.none { margin: 0; padding: var(--space-3); color: var(--fg-2); font-size: var(--text-sm) }
.count.attention { color: var(--status-warn) }
.count.attention.is-alert { color: var(--status-bad) }
.source-note.is-alert { border-left-color: var(--status-bad) }
.source-note .row-desc { display: block; margin-top: var(--space-1) }
.row.unsent .unsent-tag { margin-left: var(--space-2); padding: 0 var(--space-1); border-radius: var(--radius-sm, 3px); font-size: var(--text-sm); font-weight: 600;
  color: var(--foreground); background: color-mix(in oklab, var(--status-bad) 35%, transparent) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3); margin-right: 6px; vertical-align: 1px }
.dot.is-alert { background: var(--status-bad) }
.dot.is-warn { background: var(--status-warn) }
.dot.is-ok { background: var(--status-ok) }
.dot.is-quiet { background: color-mix(in oklab, var(--fg-3) 60%, transparent) }
.subject { display: flex; align-items: center; gap: 2px }
.subject-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.subject-nums { flex: none; color: var(--fg-3); font-variant-numeric: tabular-nums }
.on .subject-nums { color: var(--fg-2) }   /* sobre lo elegido, --fg-3 no llega a AA en oscuro */
.subject.is-quiet .subject-name { color: var(--fg-2) }
.subject-kind { flex: none; color: var(--fg-3); font-size: var(--text-xs) }
/* Una fila que se sigue: abrirla es la fila entera; dejar de seguirla, la ✕ que aparece al pasar. */
.followed, .suggestion { padding-right: var(--space-1) }
.subject-open { display: flex; flex: 1; min-width: 0; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer }
.followed .unfollow { visibility: hidden }
.followed:hover .unfollow, .followed:focus-within .unfollow { visibility: visible }
.spark { flex: none; width: 72px; height: 22px }
.err-badge { flex: none; padding: 0 5px; border-radius: 999px; font-size: var(--text-xs); color: var(--fg-2);
  background: color-mix(in oklab, var(--status-bad) 14%, transparent) }
.err-badge.is-warn, .err-badge.is-alert { color: var(--foreground); background: color-mix(in oklab, var(--status-bad) 35%, transparent) }
.spark-normal { fill: none; stroke: var(--fg-3); stroke-width: 1; stroke-dasharray: 2 2 }
.spark-today { fill: none; stroke: var(--primary); stroke-width: 1.5; stroke-linejoin: round }

.signals-panel { display: flex; flex-direction: column }
.table-wrap { flex: 1; min-height: 0; overflow: auto }
.table-search { width: 160px; height: var(--control-xs) }
.idle-check { display: inline-flex; align-items: center; gap: 4px; padding: 0 var(--space-2); font-size: var(--text-sm); color: var(--fg-2); white-space: nowrap }
.signals thead th { position: sticky; top: 0; z-index: 1; background: var(--region-bg, var(--background)) }
.signals th, .signals td { white-space: nowrap }
.signals tbody tr { cursor: pointer }
.signals tbody tr:hover td { background: var(--hover) }
.signals .name-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.th-sort { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer }
th[aria-sort="ascending"] .th-sort::after { content: ' ↑' }
th[aria-sort="descending"] .th-sort::after { content: ' ↓' }
.follow-col { width: 36px; text-align: right }
.region-action.following { color: var(--primary) }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0) }

.view { display: flex; flex-direction: column; gap: var(--space-6); padding: var(--space-6); max-width: 980px }
.verdict { margin: 0; display: flex; align-items: center; gap: 4px; font-size: var(--text-body); color: var(--fg-2) }
.verdict b { color: var(--foreground) }
.verdict.is-alert b { color: var(--status-bad) }
.verdict.is-warn b { color: var(--status-warn) }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3) }
.card-num { display: flex; flex-direction: column; gap: 2px; padding: var(--space-3) var(--space-4); border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px); background: var(--card) }
.card-label { font-size: var(--text-xs); font-weight: 600; color: var(--fg-3); text-transform: uppercase; letter-spacing: .04em }
.card-value { font-size: calc(var(--text-title) * 1.5); font-weight: 600; font-variant-numeric: tabular-nums }
.card-what { font-size: var(--text-sm); color: var(--fg-2) }

.chart-box, .days { display: flex; flex-direction: column; gap: var(--space-2) }
.chart-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap }
h3 { margin: 0; font-size: var(--text-xs); font-weight: 600; color: var(--fg-3); text-transform: uppercase; letter-spacing: .04em }
.legend { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--text-xs); color: var(--fg-2) }
.sw { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-left: 6px }
.sw.today { background: var(--primary) }
.sw.normal { background: var(--fg-3) }
.sw.band { height: 10px; background: color-mix(in oklab, var(--fg-3) 25%, transparent) }
.sw.deploy { width: 2px; height: 10px; background: var(--status-warn) }
.chart { width: 100%; height: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) + 4px); background: var(--card) }
.chart .grid line { stroke: var(--border); stroke-width: 1 }
.chart .grid text { fill: var(--fg-3); font-size: 10px }
.chart .band { fill: color-mix(in oklab, var(--fg-3) 18%, transparent); stroke: none }
.chart .median { fill: none; stroke: var(--fg-3); stroke-width: 1.5; stroke-dasharray: 4 4 }
.chart .today { fill: none; stroke: var(--primary); stroke-width: 2.5; stroke-linejoin: round }
.chart .now { fill: var(--card); stroke: var(--primary); stroke-width: 2 }
.chart .today.errors, .chart .now.errors { stroke: var(--status-bad) }
.chart-small { max-height: 180px }
.steps-box { display: flex; flex-direction: column; gap: var(--space-2) }
.steps tbody tr { cursor: pointer }
.steps tbody tr:hover td { background: var(--hover) }
.steps td, .steps th { white-space: nowrap }
.chart .deploy-mark line { stroke: var(--status-warn); stroke-width: 1.5; stroke-dasharray: 2 3 }
.chart .deploy-mark text { fill: var(--status-warn); font-size: 10px }
.examples { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px }
.examples li { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; font-size: var(--text-sm) }
.examples a { color: var(--primary); font-variant-numeric: tabular-nums }
.examples .ex-note { color: var(--muted-foreground) }
.examples code { margin-left: auto; font-size: var(--text-xs); color: var(--muted-foreground); user-select: all }
.rules-box tr.is-up td { color: var(--status-bad) }
.rules-box th:first-child { text-align: left }
.verdict-box { margin: 4px 8px 10px; padding: 8px 10px; border-radius: 6px; background: color-mix(in oklab, var(--foreground) 5%, transparent) }
.verdict-head { display: flex; align-items: center; gap: 6px; width: 100%; border: 0; background: none; color: var(--foreground); font: inherit; font-weight: 600; padding: 0; cursor: pointer; text-align: left }
.verdict-chevron { margin-left: auto; transition: transform .15s }
.verdict-head[aria-expanded="true"] .verdict-chevron { transform: rotate(180deg) }
.verdict-lede { margin: 6px 0 0; font-size: var(--text-sm); line-height: 1.45 }
.verdict-rest { display: grid; gap: 4px; margin-top: 6px; font-size: var(--text-sm); line-height: 1.45 }
.verdict-rest p { margin: 0 }
.verdict-h { font-weight: 600; margin-top: 4px !important }
.verdict-li { padding-left: 12px; position: relative }
.verdict-li::before { content: '–'; position: absolute; left: 0; color: var(--muted-foreground) }
.verdict-li.sub { padding-left: 24px }
.verdict-li.sub::before { left: 12px }
.why-text { font-style: italic }
.why-note { border-left: 2px solid var(--muted-foreground); padding-left: 8px }
.chart .policy-mark line { stroke: var(--primary); stroke-width: 1.5; stroke-dasharray: 1 3 }
.chart .policy-mark text { fill: var(--primary); font-size: 10px }
.chart-note { margin: 0; font-size: var(--text-xs); color: var(--fg-3) }
.day-bars { display: flex; align-items: flex-end; gap: var(--space-3); height: 90px; padding: var(--space-2) 0 }
.day-bar { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--fg-3) }
.day-bar .bar { width: 28px; border-radius: 4px 4px 0 0; background: color-mix(in oklab, var(--fg-3) 35%, transparent) }
.day-bar.today .bar { background: var(--primary) }
.day-bar.today small { color: var(--foreground); font-weight: 600 }

.attention-row .row-desc { white-space: normal }
.attention-item { display: flex; align-items: flex-start; gap: var(--space-1) }
.attention-item .attention-row { flex: 1; min-width: 0 }
.attention-name { white-space: normal; overflow-wrap: anywhere }
.attention-kind { display: block; padding-left: calc(var(--space-2) + 8px) }
.attention-item .ack { flex: none; margin: var(--space-1) var(--space-2) 0 0; font-size: var(--text-sm) }
.attention-item:not(:hover, :focus-within) .ack { color: var(--fg-3) }   /* en reposo, apagado por la tinta (con opacity no pasaba AA) */
.attention-row.known { opacity: 0.75 }
.region-head.toggle { width: 100%; border: 0; background: none; cursor: pointer; font: inherit; color: inherit; text-align: left }
.chart .gap { fill: var(--fg-2); opacity: 0.12 }
.day-line { margin-top: var(--space-4) }
.timeline .spell { cursor: pointer }
.timeline .spell rect { fill: var(--status-warn); opacity: 0.7 }
.timeline .spell.is-alert rect { fill: var(--status-bad) }
.timeline .spell text { fill: var(--fg-2); font-size: 10px }
.timeline .spell:hover text { fill: var(--foreground) }
.timeline .notice-mark circle { fill: var(--status-warn) }
.timeline .notice-mark circle.is-alert { fill: var(--status-bad) }
.timeline .notice-mark circle.is-ok { fill: var(--status-ok, var(--fg-2)) }
.over-mark { margin-left: var(--space-1); color: var(--status-warn) }
.msg-text { font-family: var(--font-mono, ui-monospace, monospace); overflow-wrap: anywhere }
.app-card.compact { padding-block: var(--space-1) }
.app-inline { margin-left: auto; border: 0; background: none; padding: 0 var(--space-1); color: var(--fg-2); font: inherit; font-size: var(--text-sm); cursor: pointer; white-space: nowrap }
.app-inline:hover { color: var(--foreground) }
/* Las tarjetas de los servicios: nombre y versión arriba, cuándo se desplegó, y las dos señales (errores y líneas)
   con su número de la última hora contra lo normal y su curva de hoy. Un clic en una señal la abre al centro. */
.app-cards { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-1) var(--space-3) var(--space-3) }
.app-card { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) var(--space-3); border: 1px solid var(--border);
  border-radius: calc(var(--radius) + 4px); background: var(--card) }
.app-card.is-alert { border-color: color-mix(in oklab, var(--status-bad) 60%, var(--border)) }
.app-card.is-warn { border-color: color-mix(in oklab, var(--status-warn) 60%, var(--border)) }
.app-card.on { box-shadow: inset 2px 0 0 var(--primary) }
.app-head { display: flex; align-items: center; gap: 2px; min-width: 0 }
.app-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600 }
.app-version { flex: none; padding: 0 6px; border-radius: 999px; background: var(--muted); color: var(--foreground);
  font-size: var(--text-xs); font-variant-numeric: tabular-nums; text-decoration: none }
.app-version:hover { text-decoration: underline }
.app-version.failed { background: color-mix(in oklab, var(--status-bad) 25%, var(--muted)) }
.app-when { color: var(--fg-3); font-size: var(--text-xs) }
.app-silent { align-self: flex-start; margin-top: 2px; padding: 1px 6px; border-radius: var(--radius-control); font-size: var(--text-xs);
  color: var(--foreground); background: color-mix(in oklab, var(--status-bad) 22%, transparent) }
.app-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); margin-top: var(--space-1) }
.metric { display: flex; flex-direction: column; align-items: flex-start; gap: 0; min-width: 0; padding: 4px 6px; border: 0;
  border-radius: var(--radius-control); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer }
.metric:hover { background: var(--hover) }
.metric-none { cursor: default }
.metric-none:hover { background: none }
.metric-label { display: flex; align-items: center; color: var(--fg-3); font-size: var(--text-xs) }
.metric-nums { font-size: var(--text-sm); color: var(--fg-2); font-variant-numeric: tabular-nums; white-space: nowrap }
.metric-nums b { color: var(--foreground) }
.metric .spark { width: 100%; height: 18px }
/* Una fuente que no contestó (Loki, PostHog, los despliegues): el aviso de la base —barra de color a la izquierda y un
   tinte, cuadrado, sin marco— sobre el grupo al que le faltan datos. El texto del error puede ser largo: se parte. */
.source-note { margin: 0; padding: var(--space-2) var(--space-3); border-left: 3px solid var(--status-warn);
  background: color-mix(in oklab, var(--status-warn) 12%, transparent); color: var(--foreground); font-size: var(--text-sm); overflow-wrap: anywhere }
.auxiliarybar .source-note { margin: var(--space-1) var(--space-3) }
.warn-text { color: var(--status-warn) }
/* Una tarjeta con datos viejos: borde punteado y los números atenuados (el nombre y la versión, que no salen de esa
   fuente, quedan enteros). */
.app-card.is-old { border-style: dashed }
.app-card.is-old .app-metrics { opacity: .6 }
.note { margin: calc(var(--space-3) * -1) 0 0; font-size: var(--text-sm); color: var(--fg-2) }
.muted { color: var(--fg-3) }
.empty-state { padding: var(--space-6) }
.empty-title { margin: 0 0 var(--space-2); font-size: var(--text-title); font-weight: 600 }
</style>
