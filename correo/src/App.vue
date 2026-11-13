<script setup>
/* CORREO: los correos de los remitentes que importan (Shopify, VTEX…), sin estar mirando Gmail. A la izquierda SÓLO
 * los seguimientos; al centro, las conversaciones del elegido (una por hilo, como chats) y, al tocar una, la
 * conversación entera (ellos y vos, en orden) con «←» en la barra para volver; a la derecha, su desglose en español.
 * Avisa macOS el servidor (correo/server), aunque esto esté cerrado.
 *
 * Sólo lee: «visto» es de esta herramienta, no toca Gmail. La ruta es `#/w/<seguimiento>[/<id de correo o de hilo>]`:
 * el aviso al tocarlo trae el id del correo (Cockpit lleva el iframe a esa ruta) y abre su conversación. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const data = ref(null)
const apiError = ref('')
const watchId = ref('')
const messageId = ref('')
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
// Al cambiar de seguimiento, el filtro vuelve a «Todos»: si no, uno heredado («Por responder») mostraba la lista vacía.
watch(watchId, (now, before) => { if (before !== undefined && now !== before) filter.value = 'all' })
const READER_STATUS = {
  unread: () => 'Sin ver',
  pending: () => 'Por responder: lo último del hilo es de ellos',
  replied: (c) => `Respondiste el ${full(c.repliedAt)}`,
  noreply: () => 'No hace falta responder',
}

// LAS CONVERSACIONES: una por hilo. El estado es el de lo último que escribieron ellos (sin ver si hay alguno sin ver).
const conversations = computed(() => {
  const byThread = new Map()
  for (const m of allMessages.value) {
    let c = byThread.get(m.threadId)
    if (!c) { c = { threadId: m.threadId, url: m.url, msgs: [] }; byThread.set(m.threadId, c) }
    c.msgs.push(m)
  }
  return [...byThread.values()].map((c) => {
    c.msgs.sort((a, b) => new Date(b.date) - new Date(a.date))
    const last = c.msgs[0]
    const names = [...new Set(c.msgs.map((m) => senderName(m.from)))]
    const status = c.msgs.some((m) => m.status === 'unread') ? 'unread' : last.status
    return { threadId: c.threadId, url: c.url, subject: last.subject, snippet: last.snippet, date: last.date, names,
      count: c.msgs.length, status, repliedAt: last.repliedAt, lastId: last.id, ids: c.msgs.map((m) => m.id) }
  }).sort((a, b) => new Date(b.date) - new Date(a.date))
})
const counts = computed(() => {
  const c = { all: conversations.value.length, unread: 0, pending: 0, replied: 0, noreply: 0 }
  for (const x of conversations.value) c[x.status] = (c[x.status] || 0) + 1
  return c
})
const shownConversations = computed(() => (filter.value === 'all' ? conversations.value : conversations.value.filter((c) => c.status === filter.value)))

// LA CONVERSACIÓN ABIERTA: la ruta trae el id de un correo (el aviso) o de un hilo.
const openThreadId = computed(() => {
  const id = messageId.value
  if (!id) return ''
  return allMessages.value.find((m) => m.id === id)?.threadId || id
})
const openedConv = computed(() => conversations.value.find((c) => c.threadId === openThreadId.value) || null)
const thread = ref(null)     // { threadId, url, messages: [{…, mine}] }
const openError = ref('')
const threadLoading = ref(false)
async function loadThread(id) {
  if (!id) { thread.value = null; return }
  openError.value = ''
  threadLoading.value = !thread.value || thread.value.threadId !== id
  try {
    const t = await api(`/api/thread/${encodeURIComponent(id)}`)
    if (openThreadId.value === id) {
      const fresh = !thread.value || thread.value.threadId !== id
      thread.value = t
      // Como en un chat: al abrir, a la vista el último mensaje.
      if (fresh) nextTick(() => requestAnimationFrame(() => {
        const last = document.querySelector('.thread > .msg:last-child')
        const body = last?.closest('.region-body')
        if (last && body) body.scrollTop = last.offsetTop - body.offsetTop - 8
      }))
    }
    // Abrirla la da por vista.
    const unseen = (openedConv.value?.ids || []).filter((x) => allMessages.value.find((m) => m.id === x)?.unread)
    if (unseen.length) take(await api('/api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: unseen }) }))
  } catch (e) { openError.value = e.message } finally { threadLoading.value = false }
}
// Se vuelve a pedir si cambia la conversación o si le llegó otro mensaje.
watch(() => [openThreadId.value, openedConv.value?.count], ([id]) => loadThread(id))
function back() { go(current.value?.id || '') }

// EL DESGLOSE del hilo abierto, en español (el servidor lo arma con `claude -p` y lo guarda por hilo: la segunda vez
// sale al instante; se rearma solo si llegó un mensaje nuevo).
const digest = ref(null)
const digestError = ref('')
const digestLoading = ref(false)
const reply = ref('') // «qué responderle»: por ahora lo escribe Miguel; más adelante, un borrador sugerido
let digestFor = ''
async function loadDigest(thread, refresh = false) {
  if (!thread) { digest.value = null; return }
  if (thread !== digestFor) { digest.value = null; reply.value = '' }
  digestFor = thread
  digestError.value = ''
  digestLoading.value = true
  try {
    const g = await api(`/api/digest/${encodeURIComponent(thread)}${refresh ? '?refresh=1' : ''}`)
    if (digestFor === thread) digest.value = g
  } catch (e) {
    if (digestFor === thread) digestError.value = e.message
  } finally {
    if (digestFor === thread) digestLoading.value = false
  }
}
// Cuando cambia el correo abierto, o llega otro mensaje a su hilo (el servidor lo dice en la vista), se pide de nuevo:
// el servidor devuelve lo guardado si el hilo no cambió.
watch(() => [openThreadId.value, openedConv.value?.count], ([id]) => loadDigest(id))

// «No hace falta responder»: un acuse automático o un aviso deja de figurar como por responder (y queda visto).
async function noReply(ids, undo = false) {
  try { take(await api('/api/noreply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids, undo }) })) } catch (e) { apiError.value = e.message }
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
const sidebarW = ref(readSize('correo.sidebar-w2', 260))
const auxOpen = ref(readSize('correo.aux-open', 1) !== 0)
const auxW = ref(readSize('correo.aux-w', 460))
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
  commit: (v) => { saveSize('correo.sidebar-open', v ? 1 : 0); if (v) saveSize('correo.sidebar-w2', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del desglose', sign: -1, defaultValue: 460,
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
        <button type="button" class="region-action" :aria-pressed="adding" title="Seguir otro remitente" aria-label="Seguir otro remitente" @click="adding = !adding">
          <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
        </button>
      </div>
      <div class="region-body">
        <form v-if="adding" class="add" @submit.prevent="addWatch">
          <input v-model="form.name" class="input" placeholder="Nombre (Soporte de Shopify)" aria-label="Nombre del seguimiento" />
          <input v-model="form.query" class="input" placeholder="from:support@shopify.com" aria-label="Búsqueda de Gmail" />
          <p class="hint">La misma búsqueda que en Gmail: <code>from:</code>, <code>subject:</code>, <code>OR</code>…</p>
          <p v-if="formError" class="hint warn-text">{{ formError }}</p>
          <button type="submit" class="btn">Seguir</button>
        </form>
        <button v-for="w in watches" :key="w.id" type="button" class="row" :class="{ on: current?.id === w.id }" :title="w.query" @click="go(w.id)">
          <span>{{ w.name }}</span>
          <b v-if="w.pending" class="pill is-pending" :title="`${w.pending} por responder`">{{ w.pending }}</b>
          <b v-if="w.unread" class="pill is-unread" :title="`${w.unread} sin ver`">{{ w.unread }}</b>
        </button>
        <p v-if="data && !watches.length" class="none">Sin seguimientos: agregá uno con +.</p>
      </div>
    </aside>

    <main class="editor">
      <!-- Una conversación abierta: ← vuelve a la lista. -->
      <template v-if="openThreadId">
        <div class="region-head">
          <button type="button" class="region-action back-action" title="Volver a las conversaciones" aria-label="Volver a las conversaciones" @click="back">
            <span class="ui-icon" data-icon="back" aria-hidden="true"></span>
          </button>
          <span class="head-title">{{ openedConv?.subject || thread?.messages?.[0]?.subject || 'Conversación' }}</span>
          <a v-if="thread?.url || openedConv?.url" class="region-action" :href="thread?.url || openedConv?.url" target="_blank" rel="noopener" title="Abrir el hilo en Gmail para contestar" aria-label="Abrir el hilo en Gmail">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </a>
        </div>
        <div class="region-body">
          <div v-if="openedConv" class="conv-status">
            <span class="status" :class="`is-${openedConv.status}`">{{ READER_STATUS[openedConv.status]?.(openedConv) }}</span>
            <button v-if="openedConv.status === 'pending' || openedConv.status === 'unread'" type="button" class="btn btn-outline btn-sm" title="Un acuse automático o un aviso: deja de contar como por responder" @click="noReply(openedConv.ids)">No hace falta responder</button>
            <button v-else-if="openedConv.status === 'noreply'" type="button" class="btn btn-outline btn-sm" @click="noReply(openedConv.ids, true)">Volver a por responder</button>
          </div>
          <p v-if="openError" class="none warn-text">⚠ {{ openError }}</p>
          <p v-if="threadLoading" class="none">Abriendo la conversación…</p>
          <ol v-if="thread" class="thread">
            <li v-for="m in thread.messages" :key="m.id" class="msg" :class="{ mine: m.mine }">
              <div class="msg-head">
                <b>{{ m.mine ? 'Vos' : senderName(m.from) }}</b>
                <span>{{ full(m.date) }}</span>
              </div>
              <pre class="msg-body">{{ m.body }}</pre>
            </li>
          </ol>
        </div>
      </template>

      <!-- Las conversaciones del seguimiento elegido. -->
      <template v-else>
        <div class="region-head">
          <span class="head-title">{{ current?.name || 'Correo' }}</span>
          <span v-if="current" class="count">{{ current.query }}</span>
          <button v-if="current?.unread" type="button" class="region-action" title="Marcar todo como visto" aria-label="Marcar todo como visto" @click="markAll">
            <span class="ui-icon" data-icon="check" aria-hidden="true"></span>
          </button>
          <button v-if="current" type="button" class="region-action" title="Dejar de seguir" aria-label="Dejar de seguir" @click="removeWatch(current)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
        <div v-if="current" class="summary">
          <span><b>{{ conversations.length }}</b> conversaciones · <b>{{ current.week }}</b> correos esta semana · <b>{{ allMessages.length }}</b> en 60 días</span>
          <div class="filters" role="group" aria-label="Filtrar por estado">
            <button v-for="f in ['all', 'unread', 'pending', 'replied', 'noreply']" v-show="f !== 'noreply' || counts.noreply" :key="f" type="button" class="chip" :class="[`is-${f}`, { on: filter === f }]" :aria-pressed="filter === f" @click="filter = f">
              {{ f === 'all' ? 'Todas' : STATUS[f] }} <span class="chip-n">{{ counts[f] || 0 }}</span>
            </button>
          </div>
        </div>
        <div class="region-body">
          <p v-if="data?.error" class="none warn-text">⚠ {{ data.error }}</p>
          <p v-if="conversations.length && !shownConversations.length" class="none">Ninguna {{ STATUS[filter]?.toLowerCase() }}.</p>
          <p v-if="current && !conversations.length && !data?.error" class="none">Nada de los últimos 60 días. Cuando llegue algo, avisa macOS.</p>
          <button v-for="c in shownConversations" :key="c.threadId" type="button" class="mail" :class="{ unread: c.status === 'unread' }" @click="go(current.id, c.threadId)">
            <span class="mail-top">
              <i v-if="c.status === 'unread'" class="unread-dot" aria-label="sin ver"></i>
              <span class="mail-from">{{ c.names.join(', ') }}<span v-if="c.count > 1" class="mail-count"> · {{ c.count }}</span></span>
              <span class="mail-date">{{ when(c.date) }}</span>
            </span>
            <span class="mail-subject">{{ c.subject || '(sin asunto)' }}</span>
            <span class="mail-bottom">
              <span class="status" :class="`is-${c.status}`" :title="c.status === 'replied' ? `respondiste el ${full(c.repliedAt)}` : STATUS[c.status]">{{ c.status === 'replied' ? `Respondido ${when(c.repliedAt)}` : STATUS[c.status] }}</span>
              <span class="mail-snippet">{{ c.snippet }}</span>
            </span>
          </button>
        </div>
      </template>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="El desglose de la conversación">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head">
        <span>Desglose</span>
        <span v-if="digest" class="count" :title="`armado con ${digest.model} el ${full(digest.at)}`">{{ digest.count }} mensajes</span>
        <button v-if="openThreadId" type="button" class="region-action" :disabled="digestLoading" title="Volver a armar el desglose" aria-label="Volver a armar el desglose" @click="loadDigest(openThreadId, true)">
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
      </div>
      <div class="region-body">
        <p v-if="!openThreadId" class="none">Al abrir una conversación, se desglosa acá en español: el resumen, en qué está, qué te toca y cada mensaje (ellos / vos) en puntos.</p>
        <p v-else-if="digestLoading && !digest" class="none">Armando el desglose con Claude… (unos 20 s la primera vez; después queda guardado)</p>
        <p v-if="digestError" class="none warn-text">⚠ {{ digestError }}</p>
        <div v-if="digest && openThreadId" class="digest">
          <p class="digest-summary">{{ digest.summary }}</p>
          <dl class="digest-state">
            <dt>En qué está</dt><dd>{{ digest.status }}</dd>
            <dt>Qué sigue</dt><dd>{{ digest.next }}</dd>
          </dl>
          <ol class="turns">
            <li v-for="t in digest.turns" :key="t.id" class="turn" :class="{ mine: t.mine }">
              <div class="turn-head"><b>{{ t.mine ? 'Vos' : senderName(t.from) }}</b><span>{{ full(t.date) }}</span></div>
              <ul><li v-for="(p, i) in t.points" :key="i">{{ p }}</li></ul>
            </li>
          </ol>
          <label class="reply">
            <span>Qué responderle</span>
            <textarea v-model="reply" class="input" rows="5" placeholder="Por ahora vacío: acá va a ir un borrador de respuesta."></textarea>
          </label>
          <p v-if="digestLoading" class="hint">Revisando si la conversación cambió…</p>
        </div>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="data">{{ data.account || 'sin sesión de Gmail' }} · {{ new Date(data.checkedAt).getFullYear() > 2000 ? `leído a las ${when(data.checkedAt)}` : 'leyendo Gmail…' }} · mira cada {{ data.every }}</span>
      <span v-else>{{ apiError || 'leyendo…' }}</span>
      <span v-if="apiError && data" class="statusbar-item warn-text">{{ apiError }}</span>
      <button type="button" class="statusbar-item linkish" @click="refresh">leer ahora</button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los seguimientos" aria-label="Mostrar u ocultar los seguimientos" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar el desglose" aria-label="Mostrar u ocultar el desglose" @click="toggleAux">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
