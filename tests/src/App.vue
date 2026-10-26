<script setup>
/* tests · la interfaz. Se pega la URL del wizard (…/ecommerce/<sucursal>/<solicitud>/…) o el número de la
 * solicitud y dice, contra local o qa: de qué comercio y sucursal viene, qué mandó la tienda, a qué usuario
 * quedó pegada y con qué datos, y por qué estados pasó.
 *
 * Todo sale de la API en Go (`tests/server`), que sólo lee: acá no se calcula nada, se pinta. Los avisos
 * («la tienda mandó otro nombre», «el celular lo tienen dos usuarios») también los arma el servidor.
 * El ambiente y la búsqueda viven en la URL; las últimas búsquedas, en el navegador. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindMenu,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const DEFAULT_TARGET = 'qa'
const TARGET_LABEL = { local: 'local · tu Docker', qa: 'qa · la base compartida de dev, qa y staging' }
// Estados finales: el color del estado en la consola y en la banda.
const FINAL = { 11: 'ok', 5: 'ok', 6: 'fail', 7: 'fail', 8: 'fail' }
const PROFILE = { 1: 'cliente', 2: 'asesor', 3: 'admin' }

// ── la ruta: #/?target=qa&q=504059 ──
const route = readHashRoute()
const target = ref(route.params.get('target') || DEFAULT_TARGET)
const query = ref(route.params.get('q') || '')
const draft = ref(query.value)
function writeRoute(push) {
  setRoute(hashRoute([], { target: target.value, q: query.value }, { target: DEFAULT_TARGET, q: '' }), { push })
}
function onHashChange() {
  const r = readHashRoute()
  target.value = r.params.get('target') || DEFAULT_TARGET
  const q = r.params.get('q') || ''
  if (q !== query.value) { query.value = q; draft.value = q }
}

// ── la búsqueda ──
const result = ref(null)
const editorBody = ref(null)
const error = ref('')
const loading = ref(false)
let seq = 0
async function lookup() {
  if (!query.value) { result.value = null; error.value = ''; return }
  const mine = ++seq
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/lookup?target=${encodeURIComponent(target.value)}&q=${encodeURIComponent(query.value)}`)
    const body = await res.json().catch(() => ({}))
    if (mine !== seq) return
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    result.value = body
    remember(body)
    // Otra solicitud se lee desde arriba: los avisos son lo primero.
    nextTick(() => { if (editorBody.value) editorBody.value.scrollTop = 0 })
  } catch (e) {
    if (mine !== seq) return
    result.value = null
    error.value = e.message === 'Failed to fetch'
      ? 'No contesta la API. ¿Está arriba? (make tests levanta las dos partes)' : e.message
  } finally {
    if (mine === seq) loading.value = false
  }
}
function submit() {
  const q = draft.value.trim()
  if (!q) return
  if (q === query.value) lookup(); else query.value = q
}
function open(q, t) {
  if (t) target.value = t
  draft.value = String(q)
  query.value = String(q)
}

// ── las últimas búsquedas, en el navegador ──
const RECENT_KEY = 'tests.recent'
function readRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
const recent = ref(readRecent())
function remember(r) {
  const item = {
    id: `${r.target}:${r.request.id}`, target: r.target, request: r.request.id,
    status: r.request.status, statusId: r.request.status_id, hash: r.branch?.hash || '',
    who: r.user ? (r.user.full_name || `${r.user.first_name || ''} ${r.user.surname || ''}`).trim() : '',
    warn: r.warnings.filter((w) => w.level === 'warn').length,
  }
  recent.value = [item, ...recent.value.filter((x) => x.id !== item.id)].slice(0, 30)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value)) } catch { /* sin almacenamiento, sólo no se recuerda */ }
}
function clearRecent() {
  recent.value = []
  try { localStorage.removeItem(RECENT_KEY) } catch { /* nada que borrar */ }
}
const currentId = computed(() => (result.value ? `${result.value.target}:${result.value.request.id}` : ''))

// ── lo que se pinta ──
const r = computed(() => result.value)
const billing = computed(() => r.value?.orderData?.billing || null)
const orderExtra = computed(() => {
  const d = r.value?.orderData
  if (!d || typeof d !== 'object') return []
  return Object.entries(d).filter(([k]) => k !== 'billing').map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])
})
const userName = computed(() => {
  const u = r.value?.user
  return u ? (u.full_name || `${u.first_name || ''} ${u.surname || ''}`.trim()) : ''
})
const warns = computed(() => (r.value?.warnings || []))
const warnCount = computed(() => warns.value.filter((w) => w.level === 'warn').length)

// Una fila del usuario se marca si contradice lo que mandó la tienda (el servidor ya dijo el porqué arriba).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const digitsOf = (s) => String(s || '').replace(/\D/g, '')
const mismatch = computed(() => {
  const b = billing.value
  const u = r.value?.user
  if (!b || !u) return {}
  const shopWords = norm(`${b.first_name || ''} ${b.last_name || ''}`).split(/\s+/).filter(Boolean)
  const userWords = new Set(norm(userName.value).split(/\s+/))
  return {
    name: shopWords.length > 0 && !shopWords.every((w) => userWords.has(w)),
    email: !!b.email && norm(b.email) !== norm(u.email),
    phone: !!b.phone && !digitsOf(u.cell_phone).endsWith(digitsOf(b.phone).slice(-10)),
    document: !!b.document_number && !String(u.document_number || '').startsWith(digitsOf(b.document_number)),
  }
})

const money = (v) => (v === null || v === undefined || v === '' ? '—'
  : `$${Number(v).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`)
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v)
const yesNo = (v) => (v === null || v === undefined ? '—' : Number(v) ? 'sí' : 'no')
const stateOf = (id) => FINAL[id] || 'open'

// La consola: el historial y, si el estado de hoy no está en él, una línea más que lo dice.
const lines = computed(() => {
  if (!r.value) return []
  const out = r.value.records.map((x) => ({
    key: x.id, time: x.created_at, id: x.status_id, name: x.status,
    by: x.by_name ? `${x.by_name} (${PROFILE[x.by_profile] || `perfil ${x.by_profile}`})` : x.update_by ? `usuario ${x.update_by}` : '',
    comment: x.comment,
  }))
  const last = out[out.length - 1]
  if (!last || String(last.id) !== String(r.value.request.status_id)) {
    out.push({ key: 'now', time: r.value.request.updated_at, id: r.value.request.status_id, name: r.value.request.status,
      by: 'sin registro en el historial', comment: '', ghost: true })
  }
  return out
})

// ── el ambiente: el selector del pie ──
const targets = ref(['local', 'qa'])
const targetTrigger = ref(null)
let targetMenu = null
const targetItems = computed(() => targets.value.map((t) => ({ id: t, label: TARGET_LABEL[t] || t, selected: t === target.value })))
watch(targetItems, () => targetMenu?.refresh(), { deep: true, flush: 'post' })

watch(target, () => { writeRoute(true); lookup() })
watch(query, () => { writeRoute(true); lookup() })

// ── las regiones: las búsquedas a la izquierda y los estados abajo, con el contrato de la base ──
const sidebarOpen = ref(readSize('tests.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('tests.sidebar-w', 300))
const panelOpen = ref(readSize('tests.panel-open', 1) !== 0)
const panelH = ref(readSize('tests.panel-h', 200))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { sidebar, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--panel-h': `${shown.value.panel}px` }))
const sidebarResize = {
  label: 'Ancho de las búsquedas', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('tests.sidebar-open', v ? 1 : 0); if (v) saveSize('tests.sidebar-w', sidebarW.value) },
}
const panelResize = {
  label: 'Alto de los estados', axis: 'y', sign: -1, defaultValue: 200,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('tests.panel-open', v ? 1 : 0); if (v) saveSize('tests.panel-h', panelH.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('tests.sidebar-open', sidebarOpen.value ? 1 : 0) }
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('tests.panel-open', panelOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  targetMenu = bindMenu(targetTrigger.value, {
    label: 'Contra qué base se busca', getItems: () => targetItems.value,
    onSelect: (id) => { target.value = id },
  })
  try { targets.value = await (await fetch('/api/targets')).json() } catch { /* se quedan los de siempre */ }
  lookup()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  themeBinding?.destroy?.()
  targetMenu?.destroy()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Búsquedas">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Solicitudes</span>
        <span class="count">{{ recent.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="!query || loading" title="Volver a leer" aria-label="Volver a leer" @click="lookup">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :disabled="!recent.length" title="Olvidar las búsquedas" aria-label="Olvidar las búsquedas" @click="clearRecent">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <form class="search" @submit.prevent="submit">
          <label class="label" for="q">URL del wizard o número de solicitud</label>
          <div class="input-group">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
            <input id="q" v-model="draft" class="input" placeholder="…/ecommerce/8ffe96e2/504059/lenders" autocomplete="off" spellcheck="false" />
          </div>
          <button type="submit" class="btn btn-sm" :disabled="!draft.trim() || loading">{{ loading ? 'Leyendo…' : `Buscar en ${target}` }}</button>
        </form>
        <div v-if="recent.length" class="region-head group"><span>Últimas</span></div>
        <button v-for="x in recent" :key="x.id" type="button" class="row recent" :class="{ on: x.id === currentId }" @click="open(x.request, x.target)">
          <i class="dot" :data-state="stateOf(x.statusId)" aria-hidden="true"></i>
          <span class="label">{{ x.request }} <span class="muted">· {{ x.who || 'sin usuario' }}</span></span>
          <span class="row-meta">{{ x.target }}<span v-if="x.warn" class="hot"> · {{ x.warn }}⚠</span></span>
        </button>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ r ? `Solicitud ${r.request.id}` : 'tests' }}</span>
        <span v-if="r" class="count">{{ r.request.status_id }} · {{ r.request.status }}</span>
        <span v-if="r && warnCount" class="count hot">{{ warnCount }} sin cuadrar</span>
      </div>
      <div ref="editorBody" class="region-body">
        <p v-if="error" class="none hot">{{ error }}</p>
        <p v-else-if="loading && !r" class="none">Leyendo la base de {{ target }}…</p>
        <div v-else-if="!r" class="empty">
          <div class="empty-head">
            <div class="empty-title">Pegá una solicitud</div>
            <div class="empty-desc">La URL del wizard (<code>…/ecommerce/8ffe96e2/504059/lenders</code>) o sólo el número. Dice de qué comercio viene, qué mandó la tienda, a qué usuario quedó pegada y por qué estados pasó. Sólo lee, contra <b>local</b> o <b>qa</b> (la base compartida de dev, qa y staging).</div>
          </div>
        </div>
        <template v-else>
          <div v-if="warns.length" class="warnings">
            <div v-for="(w, i) in warns" :key="i" class="alert" :data-level="w.level">
              <span class="alert-icon"><span class="ui-icon" :data-icon="w.level === 'warn' ? 'alert' : 'detail'" aria-hidden="true"></span></span>
              <div class="alert-desc"><p>{{ w.text }}</p></div>
            </div>
          </div>

          <section>
            <div class="region-head group"><span>Comercio</span><span class="count">sucursal {{ r.branch?.hash || '—' }}</span></div>
            <dl class="kv">
              <dt>Comercio</dt><dd>{{ dash(r.branch?.allied) }} <span class="muted">#{{ r.request.allied_id }}</span></dd>
              <dt>Sucursal</dt><dd>{{ dash(r.branch?.name) }} <span class="muted">#{{ r.branch?.id }} · <code>{{ r.branch?.hash }}</code></span></dd>
              <dt>Dirección</dt><dd>{{ dash(r.branch?.address) }}</dd>
              <dt>Entidad</dt><dd>{{ r.request.lender ? `${r.request.lender} #${r.request.lender_id}` : 'sin elegir' }}</dd>
              <dt>Monto</dt><dd>{{ money(r.request.amount) }}<span v-if="r.request.final_amount && Number(r.request.final_amount) !== Number(r.request.amount)" class="muted"> · final {{ money(r.request.final_amount) }}</span></dd>
              <dt>Flujo</dt><dd>{{ dash(r.request.flow_id) }}<span class="muted"> · autogestión {{ yesNo(r.request.self_management) }} · prueba {{ yesNo(r.request.is_test) }}</span></dd>
              <dt>Creada</dt><dd>{{ r.request.created_at }}<span class="muted"> · actualizada {{ r.request.updated_at }}</span></dd>
            </dl>
          </section>

          <section>
            <div class="region-head group"><span>Lo que mandó la tienda</span><span class="count">{{ r.order ? `pedido ${r.order.id}` : 'no hay pedido' }}</span></div>
            <p v-if="!r.order" class="none">La solicitud no tiene pedido de ecommerce: no entró por una tienda.</p>
            <dl v-else class="kv">
              <dt>Plataforma</dt><dd><b>{{ dash(r.order.platform) }}</b> <span class="muted">· ecommerce_id {{ r.order.ecommerce_id }} · origen {{ dash(r.order.origin) }}</span></dd>
              <dt>Sucursal del pedido</dt><dd><code>{{ dash(r.order.branch_hash) }}</code> <span class="muted">{{ r.order.branch_name }}</span></dd>
              <dt>Pedido en la tienda</dt><dd><code>{{ dash(r.order.order_key) }}</code><span v-if="r.order.order_identifier" class="muted"> · {{ r.order.order_identifier }}</span></dd>
              <dt>Referencia</dt><dd>{{ yesNo(r.order.has_reference) }}<span class="muted"> · vence {{ dash(r.order.reference_expires_at) }} · usada {{ dash(r.order.reference_used_at) }}</span></dd>
              <template v-if="billing">
                <dt>Nombre</dt><dd :class="{ hot: mismatch.name }">{{ dash(`${billing.first_name || ''} ${billing.last_name || ''}`.trim()) }}</dd>
                <dt>Correo</dt><dd :class="{ hot: mismatch.email }">{{ dash(billing.email) }}</dd>
                <dt>Celular</dt><dd :class="{ hot: mismatch.phone }">{{ dash(billing.phone) }}</dd>
                <dt>Documento</dt><dd :class="{ hot: mismatch.document }">{{ billing.document_number ? `${billing.document_type || ''} ${billing.document_number}`.trim() : '—' }}</dd>
              </template>
              <template v-for="[k, v] in orderExtra" :key="k">
                <dt>{{ k }}</dt><dd><code class="wrap">{{ k === 'total' ? money(v) : dash(v) }}</code></dd>
              </template>
              <dt>Vuelve a</dt><dd><code class="wrap">{{ dash(r.order.return_url) }}</code></dd>
              <dt>Creado</dt><dd>{{ r.order.created_at }}</dd>
            </dl>
          </section>

          <section>
            <div class="region-head group"><span>Usuario registrado</span><span class="count">{{ r.user ? `#${r.user.id}` : 'sin usuario' }}</span></div>
            <dl v-if="r.user" class="kv">
              <dt>Nombre</dt><dd :class="{ hot: mismatch.name }"><b>{{ dash(userName) }}</b></dd>
              <dt>Documento</dt><dd :class="{ hot: mismatch.document }">{{ r.user.document_type }} {{ r.user.document_number }}<span class="muted"> · expedida {{ dash(r.user.expedition_date) }}</span></dd>
              <dt>Correo</dt><dd :class="{ hot: mismatch.email }">{{ dash(r.user.email) }}</dd>
              <dt>Celular</dt><dd :class="{ hot: mismatch.phone }">{{ dash(r.user.cell_phone) }}<span class="muted"> · validado {{ yesNo(r.user.cellphone_validation) }}</span></dd>
              <dt>Nacimiento</dt><dd>{{ dash(r.user.date_of_birth) }}<span class="muted"> · {{ dash(r.user.age) }} años · {{ dash(r.user.gender) }}</span></dd>
              <dt>Cuenta</dt><dd>{{ Number(r.user.status) === 1 ? 'activa' : 'dada de baja' }}<span class="muted"> · {{ PROFILE[r.user.user_profile_id] || `perfil ${r.user.user_profile_id}` }} · validada {{ yesNo(r.user.validated) }} · manual {{ yesNo(r.user.manual_validation) }}</span></dd>
              <dt>Prueba</dt><dd>{{ yesNo(r.user.is_test) }}<span v-if="r.user.test_reason" class="muted"> · {{ r.user.test_reason }}</span></dd>
              <dt>Canal</dt><dd>{{ dash(r.user.onboarding_channel) }}<span class="muted"> · {{ dash(r.user.onboarding_backend) }}</span></dd>
              <dt>Cognito</dt><dd><code>{{ dash(r.user.cognito_id) }}</code></dd>
              <dt>Creado</dt><dd>{{ r.user.created_at }}<span class="muted"> · última validación {{ dash(r.user.last_validation) }}</span></dd>
            </dl>
            <template v-if="r.samePhone.length">
              <p class="none hot">Otros usuarios activos con el celular {{ r.user.cell_phone }}:</p>
              <table class="table">
                <thead><tr><th>id</th><th>nombre</th><th>documento</th><th>correo</th><th>prueba</th><th>creado</th></tr></thead>
                <tbody>
                  <tr v-for="u in r.samePhone" :key="u.id">
                    <td>{{ u.id }}</td><td>{{ u.first_name }} {{ u.surname }}</td><td>{{ u.document_number }}</td>
                    <td>{{ dash(u.email) }}</td><td>{{ yesNo(u.is_test) }}</td><td>{{ u.created_at }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
          </section>

          <section v-if="r.fields.length">
            <div class="region-head group"><span>Datos del perfil</span><span class="count">{{ r.fields.length }}</span></div>
            <dl class="kv">
              <template v-for="f in r.fields" :key="f.field_id">
                <dt :title="`campo ${f.field_id} · solicitud ${f.user_request_id || '—'}`">{{ f.field }}</dt><dd>{{ dash(f.value) }}</dd>
              </template>
            </dl>
          </section>

          <section v-if="r.requests.length">
            <div class="region-head group"><span>Solicitudes del usuario</span><span class="count">{{ r.requests.length }}</span></div>
            <table class="table">
              <thead><tr><th>solicitud</th><th>estado</th><th>sucursal</th><th>monto</th><th>creada</th></tr></thead>
              <tbody>
                <tr v-for="q in r.requests" :key="q.id" :class="{ on: q.id === r.request.id }">
                  <td><button type="button" class="btn-link" @click="open(q.id)">{{ q.id }}</button></td>
                  <td><i class="dot" :data-state="stateOf(q.status_id)" aria-hidden="true"></i>{{ q.status_id }} · {{ q.status }}</td>
                  <td><code>{{ dash(q.hash) }}</code></td><td>{{ money(q.amount) }}</td><td>{{ q.created_at }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
      </div>
    </main>

    <section v-if="shown.panel" class="panel" aria-label="Estados">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <div class="region-head">
        <span>Estados</span>
        <span v-if="r" class="count">{{ lines.length }}</span>
      </div>
      <div class="region-body">
        <p v-if="!r" class="none">Por qué estados pasó la solicitud, quién la movió y cuándo.</p>
        <div v-for="l in lines" :key="l.key" class="log-line" :class="{ ghost: l.ghost }">
          <span class="log-time">{{ l.time }}</span>
          <i class="dot" :data-state="stateOf(l.id)" aria-hidden="true"></i>
          <span class="status">{{ l.id }} · {{ l.name }}</span>
          <span class="what">{{ l.by }}<template v-if="l.comment"> · {{ l.comment }}</template></span>
        </div>
      </div>
    </section>

    <footer class="statusbar">
      <button ref="targetTrigger" type="button" class="statusbar-item env" title="Contra qué base se busca">
        <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
        <span>Base: {{ target }}</span>
        <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
      </button>
      <span v-if="loading">leyendo…</span>
      <span v-else-if="r" :title="r.source">leído a las {{ r.readAt.slice(11, 16) }} · {{ r.source }}</span>
      <span class="muted">sólo lectura</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las búsquedas" aria-label="Mostrar u ocultar las búsquedas" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar los estados" aria-label="Mostrar u ocultar los estados" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Bandas, filas, grupos, avisos, tablas, líneas de log y pie son de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.hot { color: var(--tests-fail) }
.muted { color: var(--fg-3) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
code.wrap { word-break: break-all }
.env { flex: none }
/* El buscador: etiqueta, campo y botón, apilados en el ancho del sidebar. */
.search { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--gutter) }
.search .btn { align-self: flex-start }
.recent .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* Los avisos: el de la base con la barra en ámbar (no cuadra) o en el color de la marca (para saber). */
.warnings { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--gutter) }
.alert[data-level="warn"] { border-left-color: var(--tests-warn); background: color-mix(in oklab, var(--tests-warn) 10%, transparent) }
.alert[data-level="warn"] .alert-icon { color: var(--tests-warn) }
.alert-desc p { color: var(--foreground) }
/* Clave y valor en dos columnas; el valor que contradice a la tienda va en rojo. */
.kv { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; column-gap: var(--space-3); row-gap: var(--space-1);
  margin: 0; padding: var(--space-2) var(--gutter) var(--space-3) }
.kv dt { color: var(--fg-2) }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere }
.table tr.on td { background: var(--hover) }
.table .dot { margin-right: var(--space-1) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila). */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--tests-ok) }
.dot[data-state="fail"] { background: var(--tests-fail) }
.row .dot { margin-right: var(--space-2) }
/* La consola: hora, punto, estado y quién lo movió. La línea sin registro va atenuada y en cursiva. */
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .dot { align-self: center }
.log-line .status { flex: none; min-width: 200px }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2) }
.log-line.ghost .what { font-style: italic; color: var(--tests-warn) }
</style>
