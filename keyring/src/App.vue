<script setup>
/* keyring · la interfaz. El editor es AWS: qué servicios lee cada perfil de ~/.aws, medido con una llamada
 * List/Describe por servicio. Abajo, en la consola, el resto de los accesos (red, bases, logs, eventos,
 * servicios, sesiones), un grupo por pestaña. Todo sale de la API en Go —las mismas filas que
 * `make keyring`—: acá no se prueba nada, se pinta. La pestaña elegida vive en la URL. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle,
  readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const READ_LABEL = { yes: 'lectura', no: 'negada', error: 'no se supo', unmeasured: 'sin medir' }
const STATE_LABEL = { ok: 'ok', warn: 'vence pronto', fail: 'falla', off: 'no aplica' }
const STATE_RANK = { fail: 0, warn: 1, ok: 2, off: 3 }

// ── la ruta: #/?tab=<grupo> ──
const route = readHashRoute()
const tab = ref(route.params.get('tab') || '')
function writeRoute(push) { setRoute(hashRoute([], { tab: tab.value }, { tab: '' }), { push }) }
function onHashChange() { tab.value = readHashRoute().params.get('tab') || tab.value }

async function getJSON(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── AWS: el editor ──
const aws = ref(null)
const awsLoading = ref(false)
const awsError = ref('')
async function loadAWS() {
  awsLoading.value = true
  awsError.value = ''
  try {
    aws.value = await getJSON('/api/aws')
  } catch (e) {
    awsError.value = `No se pudo leer: ${e.message}. ¿Está la API arriba? (make keyring-ui levanta las dos partes)`
  } finally {
    awsLoading.value = false
  }
}
const accounts = computed(() => aws.value?.accounts || [])
const categories = computed(() => (aws.value?.categories || []).map((c) => ({
  id: c, rows: (aws.value?.services || []).map((s, i) => ({ ...s, index: i })).filter((s) => s.category === c),
})))
const cell = (account, index) => account.services?.[index] || null
const readCount = (account) => (account.services || []).filter((s) => s.read === 'yes').length
// «pegadas a mano el 28/09 10:56, sin vencimiento declarado» → «pegadas 28/09 10:56»; el texto entero va en el title.
const credShort = (text) => text?.replace(/^pegadas a mano el ([^,]+),.*$/, 'pegadas $1') || ''
const serviceCount = computed(() => aws.value?.services?.length || 0)

// ── los demás accesos: la consola ──
const groups = ref([])
const rows = ref({})
const pending = ref({})
const errors = ref({})
async function loadGroup(id) {
  pending.value = { ...pending.value, [id]: true }
  try {
    // Primero la respuesta, después la copia: copiar antes del await pisa con un objeto viejo lo que los
    // otros grupos escribieron mientras tanto (pasó: sólo quedaba el último en llegar).
    const body = await getJSON(`/api/checks?group=${encodeURIComponent(id)}`)
    rows.value = { ...rows.value, [id]: body }
    errors.value = { ...errors.value, [id]: '' }
  } catch (e) {
    errors.value = { ...errors.value, [id]: e.message }
  } finally {
    pending.value = { ...pending.value, [id]: false }
  }
}
async function loadGroups() {
  try {
    // La identidad de AWS ya está en el editor: la consola no la repite.
    if (!groups.value.length) groups.value = (await getJSON('/api/groups')).filter((g) => g.id !== 'aws')
  } catch { return }
  if (!groups.value.some((g) => g.id === tab.value)) tab.value = groups.value[0]?.id || ''
  await Promise.all(groups.value.map((g) => loadGroup(g.id)))
}
function worst(list) {
  if (!list?.length) return null
  return list.reduce((w, r) => (STATE_RANK[r.state] < STATE_RANK[w] ? r.state : w), 'off')
}
const tabs = computed(() => groups.value.map((g) => ({
  ...g, state: pending.value[g.id] ? 'pending' : worst(rows.value[g.id]),
  fails: (rows.value[g.id] || []).filter((r) => r.state === 'fail').length,
})))
const tabRows = computed(() => rows.value[tab.value] || [])
const failTotal = computed(() => Object.values(rows.value).flat().filter((r) => r.state === 'fail').length)

const checkedAt = ref(null)
async function loadAll() {
  await Promise.all([loadAWS(), loadGroups()])
  checkedAt.value = new Date()
}
const busy = computed(() => awsLoading.value || Object.values(pending.value).some(Boolean))

// El vencimiento se relee cada 30 s: «en 40′» no puede quedar congelado mientras la pestaña está abierta.
const now = ref(Date.now())
let clock = null
function until(t) {
  const d = new Date(t).getTime() - now.value
  const mins = Math.floor(Math.abs(d) / 60000)
  const text = mins < 60 ? `${mins}′` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}` : `${Math.floor(mins / 1440)}d`
  return d <= 0 ? `venció hace ${text}` : `vence en ${text}`
}
const fmtFull = (t) => (t ? new Date(t).toLocaleString('es-CO') : '')
const fmtTime = (t) => (t ? t.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '')

watch(tab, () => writeRoute(false))

// ── las regiones: la consola se redimensiona y se pliega, con el contrato de la base ──
const panelOpen = ref(readSize('keyring.panel-open', 1) !== 0)
const panelH = ref(readSize('keyring.panel-h', 240))
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportH.value = window.innerHeight }
const shown = computed(() => {
  const [panel] = fitRegions(viewportH.value - 200, [
    { size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) },
  ])
  return { panel }
})
const layoutVars = computed(() => ({ '--panel-h': `${shown.value.panel}px` }))
const panelResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 240,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('keyring.panel-open', v ? 1 : 0); if (v) saveSize('keyring.panel-h', panelH.value) },
}
function togglePanel() { panelOpen.value = !shown.value.panel; saveSize('keyring.panel-open', panelOpen.value ? 1 : 0) }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', onHashChange)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  clock = setInterval(() => { now.value = Date.now() }, 30000)
  loadAll()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', onHashChange)
  clearInterval(clock)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <main class="editor">
      <div class="region-head">
        <span>AWS</span>
        <span v-if="aws" class="count">{{ serviceCount }} servicios · {{ accounts.length }} perfiles</span>
        <div class="region-actions">
          <button type="button" class="region-action" :disabled="busy" title="Volver a probar" aria-label="Volver a probar" @click="loadAll">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div v-if="awsError" class="alert alert-destructive" role="alert">
          <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
          <div class="alert-title">{{ awsError }}</div>
        </div>
        <div v-else-if="!aws" class="empty"><div class="empty-desc">Preguntando a cada servicio de cada perfil…</div></div>
        <template v-else>
          <div class="region-head group"><span>Perfiles de ~/.aws</span><span class="count">{{ accounts.length }}</span></div>
          <table class="table" aria-label="Perfiles de AWS">
            <thead><tr><th>Perfil</th><th>Cuenta</th><th>Permission set</th><th class="num">Lectura</th><th>Credenciales</th></tr></thead>
            <tbody>
              <tr v-for="a in accounts" :key="a.profile">
                <td :title="a.person ? `sesión de ${a.person}` : ''"><code>{{ a.profile }}</code></td>
                <template v-if="a.error"><td colspan="4" class="hot">{{ a.error }}</td></template>
                <template v-else>
                  <td class="nowrap">{{ a.account }} <span class="muted">· {{ a.accountLabel }}</span></td>
                  <td class="nowrap" :title="a.role"><code>{{ a.permissionSet || a.role }}</code></td>
                  <td class="num">{{ readCount(a) }} / {{ serviceCount }}</td>
                  <td class="nowrap muted" :title="a.credentials">{{ a.expires ? until(a.expires) : credShort(a.credentials) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
          <div class="alert" role="note">
            <span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span>
            <div class="alert-desc">La lectura se mide con una llamada List/Describe por servicio. La escritura todavía no se mide: el nombre del permission set es una pista, no una medición.</div>
          </div>
          <section v-for="c in categories" :key="c.id">
            <div class="region-head group"><span>{{ c.id }}</span><span class="count">{{ c.rows.length }}</span></div>
            <table class="table matrix">
              <colgroup><col class="c-service"><col><col v-for="a in accounts" :key="a.profile" class="c-access"></colgroup>
              <thead>
                <tr><th>Servicio</th><th>Acción probada</th><th v-for="a in accounts" :key="a.profile" class="access">{{ a.profile }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in c.rows" :key="s.id">
                  <td class="nowrap">{{ s.label }}</td>
                  <td class="action"><code>{{ s.action }}</code></td>
                  <td v-for="a in accounts" :key="a.profile" class="access" :data-read="cell(a, s.index)?.read || 'none'"
                    :title="cell(a, s.index) ? `${cell(a, s.index).detail} · ${cell(a, s.index).ms} ms` : a.error">
                    <template v-if="cell(a, s.index)">
                      <i class="dot" :data-read="cell(a, s.index).read" aria-hidden="true"></i>
                      {{ READ_LABEL[cell(a, s.index).read] }}
                    </template>
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
      </div>
    </main>

    <section v-if="shown.panel" class="panel" aria-label="Otros accesos">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Otros accesos">
        <button v-for="t in tabs" :key="t.id" type="button" role="tab" class="tab" :class="{ on: t.id === tab }"
          :aria-selected="t.id === tab" @click="tab = t.id">
          <i class="dot" :data-state="t.state" aria-hidden="true"></i>
          {{ t.label }}
          <span v-if="t.fails" class="count">{{ t.fails }}</span>
        </button>
      </nav>
      <div class="region-body">
        <p v-if="errors[tab]" class="none hot">{{ errors[tab] }}</p>
        <p v-else-if="pending[tab] && !tabRows.length" class="none">Probando…</p>
        <div v-for="r in tabRows" :key="r.name" class="log-line" :data-state="r.state">
          <i class="dot" :data-state="r.state" aria-hidden="true"></i>
          <span class="name">{{ r.name }}</span>
          <span class="state">{{ STATE_LABEL[r.state] }}</span>
          <span class="what">{{ r.detail }}</span>
          <span v-if="r.expires" class="log-time" :title="fmtFull(r.expires)">{{ until(r.expires) }}</span>
        </div>
      </div>
    </section>

    <footer class="statusbar">
      <span v-if="checkedAt" :title="fmtFull(checkedAt)">probado a las {{ fmtTime(checkedAt) }}</span>
      <span v-if="failTotal" class="hot">{{ failTotal }} accesos fallan en la consola</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la consola" aria-label="Mostrar u ocultar la consola" @click="togglePanel">
          <span class="ui-icon" data-icon="bottom" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* Lo que la base no da. Todo lo demás —bandas, pestañas, tabla, grupos, avisos, líneas, pie— es de workbench.css. */
.theme-toggle { margin-right: var(--space-1) }
.none { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-3); font-size: var(--text-sm) }
.nowrap { white-space: nowrap }
.muted { color: var(--fg-3) }
.hot { color: var(--access-fail) }
.alert { margin: var(--space-2) var(--gutter) }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
/* Las tablas de cada categoría son tablas distintas: con anchos fijos, las columnas quedan alineadas de una a otra. */
.matrix { table-layout: fixed }
.matrix .c-service { width: 176px }
.matrix .c-access { width: 104px }
.action { color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.access { white-space: nowrap; min-width: 96px }
.access[data-read="yes"] { color: var(--access-ok) }
.access[data-read="no"] { color: var(--fg-3) }
.access[data-read="error"] { color: var(--access-warn) }
/* El estado es un punto (un <i>: la base estira todo <span> de una fila); el texto de al lado lo dice para quien no lo ve. */
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: var(--space-1); background: var(--access-off) }
.dot[data-read="yes"], .dot[data-state="ok"] { background: var(--access-ok) }
.dot[data-read="error"], .dot[data-state="warn"] { background: var(--access-warn) }
.dot[data-state="fail"] { background: var(--access-fail) }
.dot[data-state="pending"] { background: transparent; box-shadow: inset 0 0 0 1px var(--access-off) }
.log-line { display: flex; gap: var(--space-2); align-items: baseline }
.log-line .dot { align-self: center; margin-right: 0 }
.log-line .name { min-width: 120px }
.log-line .state { min-width: 80px; color: var(--fg-3) }
.log-line .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2) }
.log-line[data-state="off"] .name { color: var(--fg-3) }
.log-line[data-state="fail"] .state { color: var(--access-fail) }
</style>
