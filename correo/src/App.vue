<script setup>
/* CORREO: los correos de los remitentes que importan (Shopify, VTEX…), sin estar mirando Gmail. A la izquierda SÓLO
 * los seguimientos; al centro, las conversaciones del elegido (una por hilo, como chats) y, al tocar una, la
 * conversación entera (ellos y vos, en orden) con «←» en la barra para volver; a la derecha, su desglose en español.
 * Avisa macOS el servidor (correo/server), aunque esto esté cerrado.
 *
 * Sólo lee: «visto» es de esta herramienta, no toca Gmail. La ruta es `#/w/<seguimiento>[/<id de correo o de hilo>]`:
 * el aviso al tocarlo trae el id del correo (Cockpit lleva el iframe a esa ruta) y abre su conversación. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const STATUS = { unread: 'Sin ver', pending: 'Por responder', replied: 'Respondido', noreply: 'No hace falta' }
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
    // Quiénes están en la conversación: ellos y vos, si respondiste (el círculo de la fila).
    // ⚠ Go manda «sin respuesta» como 0001-01-01 (time.Time no se omite): una cadena, o sea verdadera.
    const people = c.msgs.some((m) => isSet(m.repliedAt)) ? [...names, 'vos'] : names
    return { threadId: c.threadId, url: c.url, subject: last.subject, snippet: last.snippet, date: last.date, names, people,
      count: c.msgs.length, status, repliedAt: last.repliedAt, lastId: last.id, ids: c.msgs.map((m) => m.id) }
  }).sort((a, b) => new Date(b.date) - new Date(a.date))
})

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
    // Sin saltar al último: con los anteriores colapsados en una línea, el último ya queda a la vista.
    if (openThreadId.value === id) thread.value = t
    // Abrirla la da por vista.
    const unseen = (openedConv.value?.ids || []).filter((x) => allMessages.value.find((m) => m.id === x)?.unread)
    if (unseen.length) take(await api('/api/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: unseen }) }))
  } catch (e) { openError.value = e.message } finally { threadLoading.value = false }
}
// Se vuelve a pedir si cambia la conversación o si le llegó otro mensaje.
watch(() => [openThreadId.value, openedConv.value?.count], ([id]) => loadThread(id))
function back() { go(current.value?.id || '') }

// COLAPSADOS, COMO GMAIL: en la conversación abierta, cada mensaje es una línea (bolita con la inicial, nombre, el
// comienzo del texto y la fecha) salvo el último y los sin ver; tocarla lo despliega. `expanded` guarda los que se
// abrieron o cerraron a mano en esta conversación; `allOpen` los despliega todos.
const expanded = ref({})
const allOpen = ref(false)
watch(openThreadId, () => { expanded.value = {}; allOpen.value = false })
function isOpen(m, i) {
  if (allOpen.value) return true
  if (m.id in expanded.value) return expanded.value[m.id]
  const unseen = allMessages.value.find((x) => x.id === m.id)?.unread
  return i === thread.value.messages.length - 1 || !!unseen
}
function toggle(m, i) { expanded.value = { ...expanded.value, [m.id]: !isOpen(m, i) } }
function toggleAll() { allOpen.value = !allOpen.value; expanded.value = {} }
// La vista previa de un mensaje colapsado: lo que escribió la persona. Los avisos de Zendesk (el soporte de VTEX)
// arrancan todos con «Hello… Your request #… has been updated…» y una raya: se toma lo que sigue a la raya, sin la
// línea de «Nombre, fecha».
function preview(m) {
  const body = (m.body || '').replace(/\r\n/g, '\n') // Gmail manda \r\n
  const parts = body.split(/\n[ \t]*-{10,}[ \t]*\n/)
  if (parts.length > 1) {
    const lines = parts.slice(1).join('\n').split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length > 1 && /\d{4}/.test(lines[0]) && lines[0].length < 80) lines.shift()
    const text = lines.join(' ')
    if (text) return text
  }
  return m.snippet || body.replace(/\s+/g, ' ')
}
function initial(name) { return (name || '?').replace(/^[^\p{L}\p{N}]+/u, '').charAt(0).toUpperCase() || '?' }
// Un color por persona, siempre el mismo (de la paleta del tema, sin --chart-2, que es el acento); el tuyo es el acento.
function avatarTone(m) {
  if (m.mine) return 'me'
  let h = 0
  for (const ch of (senderName(m.from) || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return `t${(h % 4) + 1}`
}

// EL DESGLOSE del hilo abierto, en español (el servidor lo arma con `claude -p` y lo guarda por hilo: la segunda vez
// sale al instante; se rearma solo si llegó un mensaje nuevo).
const digest = ref(null)
const digestError = ref('')
const digestLoading = ref(false)
const reply = ref('') // «qué responderle»: el borrador del desglose (si vale la pena responder), editable
const copied = ref(false)
let replyTouched = false // si Miguel lo editó, un desglose nuevo no se lo pisa
async function copyReply() {
  try { await navigator.clipboard.writeText(reply.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}
let digestFor = ''
async function loadDigest(thread, refresh = false) {
  if (!thread) { digest.value = null; return }
  if (thread !== digestFor) { digest.value = null; reply.value = ''; replyTouched = false }
  digestFor = thread
  digestError.value = ''
  digestLoading.value = true
  try {
    const g = await api(`/api/digest/${encodeURIComponent(thread)}${refresh ? '?refresh=1' : ''}`)
    if (digestFor === thread) {
      digest.value = g
      if (!replyTouched) reply.value = g.reply ? g.draft : ''
    }
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

const isSet = (iso) => !!iso && new Date(iso).getFullYear() > 2000
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
const sidebarW = ref(readSize('correo.sidebar-w2', 240))
const auxOpen = ref(readSize('correo.aux-open', 1) !== 0)
const auxW = ref(readSize('correo.aux-w', 380))
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
  label: 'Ancho de los seguimientos', sign: 1, defaultValue: 240,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - shown.value.aux - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('correo.sidebar-open', v ? 1 : 0); if (v) saveSize('correo.sidebar-w2', sidebarW.value) },
}
const auxResize = {
  label: 'Ancho del desglose', sign: -1, defaultValue: 380,
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
          <div class="region-actions">
          <button v-if="thread?.messages?.length > 1" type="button" class="region-action" :aria-pressed="allOpen" :title="allOpen ? 'Colapsar los mensajes' : 'Desplegar todos los mensajes'" :aria-label="allOpen ? 'Colapsar los mensajes' : 'Desplegar todos los mensajes'" @click="toggleAll">
            <span class="ui-icon" :data-icon="allOpen ? 'collapse' : 'maximize'" aria-hidden="true"></span>
          </button>
          <a v-if="thread?.url || openedConv?.url" class="region-action" :href="thread?.url || openedConv?.url" target="_blank" rel="noopener" title="Abrir el hilo en Gmail para contestar" aria-label="Abrir el hilo en Gmail">
            <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
          </a>
          </div>
        </div>
        <div v-if="openedConv" class="subband">
          <span class="grow"><i class="state-dot" :class="`is-${openedConv.status}`" aria-hidden="true"></i>{{ READER_STATUS[openedConv.status]?.(openedConv) }}</span>
          <button v-if="openedConv.status === 'pending' || openedConv.status === 'unread'" type="button" class="btn btn-ghost btn-xs" title="Un acuse automático o un aviso: deja de contar como por responder" @click="noReply(openedConv.ids)">No hace falta responder</button>
          <button v-else-if="openedConv.status === 'noreply'" type="button" class="btn btn-ghost btn-xs" @click="noReply(openedConv.ids, true)">Volver a por responder</button>
        </div>
        <div class="region-body">
          <div v-if="openError" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ openError }}</p></div></div>
          <p v-if="threadLoading" class="none">Abriendo la conversación…</p>
          <ol v-if="thread" class="thread">
            <li v-for="(m, i) in thread.messages" :key="m.id" class="msg" :class="{ mine: m.mine, collapsed: !isOpen(m, i) }">
              <button type="button" class="msg-head" :aria-expanded="isOpen(m, i)" :title="isOpen(m, i) ? 'Colapsar' : 'Desplegar'" @click="toggle(m, i)">
                <span class="avatar" :class="`is-${avatarTone(m)}`" aria-hidden="true">{{ initial(senderName(m.from)) }}</span>
                <b class="msg-name">{{ m.mine ? `${senderName(m.from)} (vos)` : senderName(m.from) }}</b>
                <span v-if="!isOpen(m, i)" class="msg-snippet">{{ preview(m) }}</span>
                <span class="msg-date">{{ isOpen(m, i) ? full(m.date) : when(m.date) }}</span>
              </button>
              <pre v-if="isOpen(m, i)" class="msg-body">{{ m.body }}</pre>
            </li>
          </ol>
        </div>
      </template>

      <!-- Las conversaciones del seguimiento elegido. -->
      <template v-else>
        <div class="region-head">
          <span class="head-title" :title="current?.query">{{ current?.name || 'Correo' }}</span>
          <div class="region-actions">
          <button v-if="current?.unread" type="button" class="region-action" title="Marcar todo como visto" aria-label="Marcar todo como visto" @click="markAll">
            <span class="ui-icon" data-icon="check" aria-hidden="true"></span>
          </button>
          <button v-if="current" type="button" class="region-action" title="Dejar de seguir" aria-label="Dejar de seguir" @click="removeWatch(current)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
          </div>
        </div>
        <div class="region-body">
          <div v-if="data?.error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ data.error }}</p></div></div>
          <div v-if="current && !conversations.length && !data?.error" class="empty">
            <div class="empty-head">
              <div class="empty-media"><span class="ui-icon" data-icon="bell" aria-hidden="true"></span></div>
              <div class="empty-title">Nada en los últimos 60 días</div>
              <div class="empty-desc">Cuando {{ current.name }} escriba, avisa macOS y la conversación aparece acá.</div>
            </div>
          </div>
          <button v-for="c in conversations" :key="c.threadId" type="button" class="conv" :class="{ unread: c.status === 'unread' }" @click="go(current.id, c.threadId)">
            <span class="people" :title="c.people.join(', ')">{{ c.people.length }}</span>
            <span class="conv-main">
              <span class="conv-top">
                <span class="conv-from">{{ c.names.join(', ') }}</span>
                <span class="conv-time">
                  <i v-if="c.status === 'unread'" class="unread-dot" aria-label="sin ver"></i>
                  <template v-if="c.status === 'replied'"><span class="replied-at" :title="`Respondiste el ${full(c.repliedAt)}`">{{ when(c.repliedAt) }}</span> / </template>
                  <span :class="{ 'is-pending': c.status === 'pending' }" :title="c.status === 'pending' ? 'Por responder' : `Llegó el ${full(c.date)}`">{{ when(c.date) }}</span>
                </span>
              </span>
              <span class="conv-subject">{{ c.subject || '(sin asunto)' }}</span>
              <span class="conv-snippet">{{ c.snippet }}</span>
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
        <div v-if="!openThreadId" class="empty">
          <div class="empty-head">
            <div class="empty-media"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></div>
            <div class="empty-title">Desglose</div>
            <div class="empty-desc">Al abrir una conversación, acá queda en español: el resumen, en qué está, qué te toca y cada mensaje en puntos.</div>
          </div>
        </div>
        <p v-else-if="digestLoading && !digest" class="none">Armando el desglose con Claude… (unos 20 s la primera vez; después queda guardado)</p>
        <div v-if="digestError" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ digestError }}</p></div></div>
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
          <section class="reply" :class="{ 'is-needed': digest.reply }">
            <div class="reply-head">
              <span>Qué responderle</span>
              <button v-if="reply" type="button" class="btn btn-outline btn-sm" @click="copyReply">{{ copied ? 'Copiado' : 'Copiar' }}</button>
            </div>
            <p class="reply-why"><b>{{ digest.reply ? 'Conviene responder:' : 'No hace falta responder:' }}</b> {{ digest.replyWhy }}</p>
            <textarea v-model="reply" class="input" :rows="digest.reply ? 10 : 3" :placeholder="digest.reply ? '' : 'Si igual querés contestar, escribilo acá.'" @input="replyTouched = true"></textarea>
            <p v-if="digest.reply" class="hint">Lo que está entre [corchetes] lo completás vos. Se copia y se pega en Gmail (↗): nada se envía desde acá.</p>
            <details v-if="digest.reply && digest.draftEs" class="reply-es">
              <summary>En español</summary>
              <pre>{{ digest.draftEs }}</pre>
            </details>
          </section>
          <p v-if="digestLoading" class="hint">Revisando si la conversación cambió…</p>
        </div>
      </div>
    </aside>

    <footer class="statusbar">
      <span v-if="data">{{ data.account || 'sin sesión de Gmail' }} · {{ new Date(data.checkedAt).getFullYear() > 2000 ? `leído a las ${when(data.checkedAt)}` : 'leyendo Gmail…' }} · mira cada {{ data.every }}</span>
      <span v-else>{{ apiError || 'leyendo…' }}</span>
      <span v-if="apiError && data" class="statusbar-item warn-text">{{ apiError }}</span>
      <button type="button" class="statusbar-item" title="Que lea Gmail ya (lee solo cada minuto)" @click="refresh">Leer ahora</button>
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
