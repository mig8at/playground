<script setup>
/* CORREO: los correos de los remitentes que importan (Shopify, VTEX…), sin estar mirando Gmail. A la izquierda los
 * seguimientos (un nombre y una búsqueda de Gmail) con sus sin ver; al centro los correos del elegido; a la derecha el
 * correo abierto, con su enlace a Gmail. Avisa macOS el servidor (correo/server), aunque esto esté cerrado.
 *
 * Sólo lee: «visto» es de esta herramienta, no toca Gmail. La ruta es `#/w/<seguimiento>[/<id del correo>]`: la usa el
 * aviso al tocarlo (Cockpit lleva el iframe a esa ruta). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const data = ref(null)
const apiError = ref('')
const watchId = ref('')
const messageId = ref('')
const opened = ref(null)       // el correo abierto, con su cuerpo
const openError = ref('')
const adding = ref(false)
const form = ref({ name: '', query: '' })
const formError = ref('')

const inCockpit = window.parent !== window
function toCockpit(message) { if (inCockpit) window.parent.postMessage({ cockpit: true, ...message }, '*') }

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}
function take(o) {
  data.value = o
  apiError.value = ''
  toCockpit({ type: 'badge', count: o.unread || 0 })
}
async function load() {
  try { take(await api('/api/overview')) } catch { apiError.value = 'No contesta la API. ¿Está arriba? (make correo, o make correo-install para que corra de fondo)' }
}

// La ruta: #/w/<seguimiento>[/<correo>].
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  watchId.value = parts[0] === 'w' ? parts[1] || '' : ''
  messageId.value = parts[0] === 'w' ? parts[2] || '' : ''
}
function go(w, m = '') {
  const hash = `#/w/${encodeURIComponent(w)}${m ? `/${encodeURIComponent(m)}` : ''}`
  if (location.hash !== hash) location.hash = hash
  else readRoute()
}

const watches = computed(() => data.value?.watches || [])
const current = computed(() => watches.value.find((w) => w.id === watchId.value) || watches.value[0] || null)
const allMessages = computed(() => current.value?.messages || [])
// El filtro de la lista: todos, sin ver, por responder o respondidos. Se recuerda.
const STATUS = { unread: 'Sin ver', pending: 'Por responder', replied: 'Respondido', noreply: 'No hace falta' }
const filter = ref(localStorage.getItem('correo.filter') || 'all')
watch(filter, (v) => { try { localStorage.setItem('correo.filter', v) } catch { /* sin almacenamiento */ } })
const counts = computed(() => {
  const c = { all: allMessages.value.length, unread: 0, pending: 0, replied: 0, noreply: 0 }
  for (const m of allMessages.value) c[m.status] = (c[m.status] || 0) + 1
  return c
})
const READER_STATUS = {
  unread: () => 'Sin ver',
  pending: () => 'Por responder: lo último del hilo es de ellos',
  replied: (m) => `Respondiste el ${full(m.repliedAt)}`,
  noreply: () => 'No hace falta responder',
}
const openedStatus = computed(() => opened.value && allMessages.value.find((m) => m.id === opened.value.id))
const messages = computed(() => (filter.value === 'all' ? allMessages.value : allMessages.value.filter((m) => m.status === filter.value)))

// Abrir un correo: su cuerpo, y queda visto.
watch([messageId, () => data.value?.checkedAt], async ([id], [before]) => {
  if (!id) { opened.value = null; return }
  if (id === before && opened.value?.id === id) return
  openError.value = ''
  try {
    opened.value = await api(`/api/messages/${encodeURIComponent(id)}`)
    const listed = allMessages.value.find((m) => m.id === id)
    if (!listed || listed.unread) take(await api('/api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }))
  } catch (e) { openError.value = e.message }
}, { immediate: false })

// «No hace falta responder»: un acuse automático o un aviso deja de figurar como por responder (y queda visto).
async function noReply(id, undo = false) {
  try { take(await api('/api/noreply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: [id], undo }) })) } catch (e) { apiError.value = e.message }
}
async function markAll() {
  if (!current.value) return
  try { take(await api('/api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ watch: current.value.id }) })) } catch (e) { apiError.value = e.message }
}
async function refresh() {
  try { await api('/api/refresh', { method: 'POST' }) } catch { /* lo dice load */ }
  setTimeout(load, 2500)
}
async function addWatch() {
  formError.value = ''
  try {
    take(await api('/api/watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form.value) }))
    form.value = { name: '', query: '' }
    adding.value = false
    setTimeout(load, 3000)
  } catch (e) { formError.value = e.message }
}
async function removeWatch(w) {
  if (!confirm(`¿Dejar de seguir «${w.name}»? Lo guardado de ese seguimiento se olvida; Gmail no se toca.`)) return
  try { take(await api(`/api/watches?id=${encodeURIComponent(w.id)}`, { method: 'DELETE' })); go(watches.value[0]?.id || '') } catch (e) { apiError.value = e.message }
}

const pad = (n) => String(n).padStart(2, '0')
function when(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}
function full(iso) { return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) }
function senderName(from) {
  const i = (from || '').indexOf('<')
  return i > 0 ? from.slice(0, i).trim().replace(/^"|"$/g, '') : from
}

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('correo.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('correo.sidebar-w', 260))
const auxOpen = ref(readSize('correo.aux-open', 1) !== 0)
const auxW = ref(readSize('correo.aux-w', 520))
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
  label: 'Ancho de los seguimientos', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('correo.sidebar-open', v ? 1 : 0); if (v) saveSize('correo.sidebar-w', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del correo abierto', sign: -1, defaultValue: 520,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.sidebar - cssSize('--editor-min', 360),
  get: () => shown.value.aux,
  set: (v) => { if (!v) auxOpen.value = false; else { auxOpen.value = true; auxW.value = v } },
  reopen: () => auxW.value,
  commit: (v) => { saveSize('correo.aux-open', v ? 1 : 0); if (v) saveSize('correo.aux-w', auxW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('correo.sidebar-open', sidebarOpen.value ? 1 : 0) }
function toggleAux() { auxOpen.value = !shown.value.aux; saveSize('correo.aux-open', auxOpen.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth }

// El sondeo: el servidor mira Gmail cada minuto; acá se lee lo suyo cada 20 s (en el acto al volver a la pestaña).
let timer = null
function schedule() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load() }, 20_000) }
const onVisibility = () => { if (!document.hidden) load() }

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  document.addEventListener('visibilitychange', onVisibility)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  load().then(schedule)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  document.removeEventListener('visibilitychange', onVisibility)
  clearInterval(timer)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Seguimientos">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Correo</span>
        <span v-if="data?.unread" class="count">{{ data.unread }} sin ver</span>
      </div>
      <div class="region-body">
        <button v-for="w in watches" :key="w.id" type="button" class="row" :class="{ on: current?.id === w.id }" :title="w.query" @click="go(w.id)">
          <span>{{ w.name }}</span>
          <b v-if="w.pending" class="pill is-pending" :title="`${w.pending} por responder`">{{ w.pending }}</b>
          <b v-if="w.unread" class="pill is-unread" :title="`${w.unread} sin ver`">{{ w.unread }}</b>
        </button>
        <p v-if="data && !watches.length" class="none">Sin seguimientos. Agregá uno abajo.</p>
        <div class="region-head group">
          <span>Seguir otro remitente</span>
          <button type="button" class="region-action" :aria-pressed="adding" title="Agregar un seguimiento" aria-label="Agregar un seguimiento" @click="adding = !adding">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
        <form v-if="adding" class="add" @submit.prevent="addWatch">
          <input v-model="form.name" class="input" placeholder="Nombre (Soporte de Shopify)" aria-label="Nombre del seguimiento" />
          <input v-model="form.query" class="input" placeholder="from:support@shopify.com" aria-label="Búsqueda de Gmail" />
          <p class="hint">La misma búsqueda que en Gmail: <code>from:</code>, <code>subject:</code>, <code>OR</code>…</p>
          <p v-if="formError" class="hint warn-text">{{ formError }}</p>
          <button type="submit" class="btn">Seguir</button>
        </form>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span>{{ current?.name || 'Correo' }}</span>
        <span v-if="current" class="count">{{ current.query }}</span>
        <button v-if="current?.unread" type="button" class="region-action" title="Marcar todo como visto" aria-label="Marcar todo como visto" @click="markAll">
          <span class="ui-icon" data-icon="check" aria-hidden="true"></span>
        </button>
        <button v-if="current" type="button" class="region-action" title="Dejar de seguir" aria-label="Dejar de seguir" @click="removeWatch(current)">
          <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
        </button>
      </div>
      <div v-if="current" class="summary">
        <span><b>{{ current.week }}</b> esta semana · <b>{{ allMessages.length }}</b> en 60 días</span>
        <div class="filters" role="group" aria-label="Filtrar por estado">
          <button v-for="f in ['all', 'unread', 'pending', 'replied', 'noreply']" v-show="f !== 'noreply' || counts.noreply" :key="f" type="button" class="chip" :class="[`is-${f}`, { on: filter === f }]" :aria-pressed="filter === f" @click="filter = f">
            {{ f === 'all' ? 'Todos' : STATUS[f] }} <span class="chip-n">{{ counts[f] || 0 }}</span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="data?.error" class="none warn-text">⚠ {{ data.error }}</p>
        <p v-if="current && allMessages.length && !messages.length" class="none">Ninguno {{ STATUS[filter]?.toLowerCase() }}.</p>
        <p v-if="current && !allMessages.length && !data?.error" class="none">Nada de los últimos 60 días. Cuando llegue algo, avisa macOS.</p>
        <button v-for="m in messages" :key="m.id" type="button" class="mail" :class="{ on: messageId === m.id, unread: m.unread }" @click="go(current.id, m.id)">
          <span class="mail-top">
            <i v-if="m.status === 'unread'" class="unread-dot" aria-label="sin ver"></i>
            <span class="mail-from">{{ senderName(m.from) }}</span>
            <span class="status" :class="`is-${m.status}`" :title="m.status === 'replied' ? `respondiste el ${full(m.repliedAt)}` : STATUS[m.status]">{{ m.status === 'replied' ? `Respondido ${when(m.repliedAt)}` : STATUS[m.status] }}</span>
            <span class="mail-date">{{ when(m.date) }}</span>
          </span>
          <span class="mail-subject">{{ m.subject || '(sin asunto)' }}</span>
          <span class="mail-snippet">{{ m.snippet }}</span>
        </button>
      </div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="El correo abierto">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>{{ opened ? 'Correo' : 'Elegí un correo' }}</span>
        <a v-if="opened" class="region-action" :href="allMessages.find((m) => m.id === opened.id)?.url || `https://mail.google.com/mail/#all/${opened.threadId}`" target="_blank" rel="noopener" title="Abrir el hilo en Gmail" aria-label="Abrir el hilo en Gmail">
          <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
        </a>
      </div>
      <div class="region-body">
        <p v-if="openError" class="none warn-text">⚠ {{ openError }}</p>
        <article v-if="opened" class="reader">
          <h2>{{ opened.subject || '(sin asunto)' }}</h2>
          <div class="reader-meta">
            <span>De: {{ opened.from }}</span>
            <span>Para: {{ opened.to }}</span>
            <span v-if="opened.cc">Cc: {{ opened.cc }}</span>
            <span>{{ full(opened.date) }}</span>
            <span v-if="openedStatus" class="reader-status">
              <span class="status" :class="`is-${openedStatus.status}`">{{ READER_STATUS[openedStatus.status]?.(openedStatus) }}</span>
              <button v-if="openedStatus.status === 'pending' || openedStatus.status === 'unread'" type="button" class="btn btn-outline btn-sm" title="Un acuse automático o un aviso: deja de contar como por responder" @click="noReply(openedStatus.id)">No hace falta responder</button>
              <button v-else-if="openedStatus.status === 'noreply'" type="button" class="btn btn-outline btn-sm" @click="noReply(openedStatus.id, true)">Volver a por responder</button>
            </span>
          </div>
          <pre class="reader-body">{{ opened.body || opened.snippet }}</pre>
        </article>
        <p v-else-if="!openError" class="none">El correo que elijas se lee acá. Para contestar, abrilo en Gmail (↗).</p>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="data">{{ data.account || 'sin sesión de Gmail' }} · leído a las {{ when(data.checkedAt) }} · mira cada {{ data.every }}</span>
      <span v-else>{{ apiError || 'leyendo…' }}</span>
      <span v-if="apiError && data" class="statusbar-item warn-text">{{ apiError }}</span>
      <button type="button" class="statusbar-item linkish" @click="refresh">leer ahora</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los seguimientos" aria-label="Mostrar u ocultar los seguimientos" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar el correo abierto" aria-label="Mostrar u ocultar el correo abierto" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
