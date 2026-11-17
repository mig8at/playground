<script setup>
/* WALLY: un chat para hacerle preguntas a Gemini, eligiendo el modelo, POR LA WEB de AI Studio (bin/aistudio, en el
 * Chrome de Miguel con Jarvis y su cuenta, sin llave de API). A la izquierda las conversaciones guardadas, con un
 * buscador y agrupadas por día; al centro, en PESTAÑAS, las abiertas (varias a la vez, como documentos de un editor),
 * cada una con su campo para preguntar, su borrador y su modelo. El servidor (wally/server) guarda todo; cuando Google
 * corta, la cuenta queda en pausa y no se pregunta hasta que vence.
 *
 * Pestañas, con la gramática del taller (tools/ui/README.md): un clic en la lista abre la conversación «de paso»
 * (itálica, la reemplaza el próximo clic); doble clic, o mandar una pregunta, la deja fija. «+» abre una nueva. Las
 * pestañas abiertas y la activa se recuerdan en esta máquina (`wally.tabs`). La ruta es `#/c/<id>` (la activa) o
 * `#/nueva/<n>` (una sin preguntas todavía).
 *
 * Preguntas de a una: AI Studio se maneja en UNA pestaña de Chrome y corta si se le pide mucho. Mientras una pestaña
 * espera, en las otras se puede escribir y leer, pero no mandar. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const models = ref([])
const defaultModel = ref('')
const lastModel = ref(readPref('wally.model', ''))
const conversations = ref([])
const apiError = ref('')

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

// ── LOS MODELOS ──
const usable = (name) => models.value.some((m) => m.name === name && !m.paused)
async function loadModels() {
  try {
    const r = await api('/api/models')
    models.value = r.models || []
    defaultModel.value = r.default
    if (!usable(lastModel.value)) lastModel.value = usable(r.default) ? r.default : (models.value.find((m) => !m.paused)?.name || lastModel.value || r.default)
  } catch (e) { apiError.value = `No pude leer los modelos: ${e.message}` }
}
// Un modelo que ya no está en la lista (conversaciones viejas) se nombra desde su id: gemini-3.5-flash-lite → Gemini 3.5 Flash Lite.
const prettyModel = (id) => (id || '').split('-').map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ').replace(/ It$/, '')
const modelName = (name) => models.value.find((m) => m.name === name)?.displayName || prettyModel(name)
const pausedCount = computed(() => models.value.filter((m) => m.paused).length)
// Toda la cuenta en pausa: Google cortó y no se pregunta hasta que vence (la hora es la de la pausa).
const allPaused = computed(() => models.value.length > 0 && models.value.every((m) => m.paused) ? models.value[0].paused : '')

async function loadList() {
  try { conversations.value = (await api('/api/conversations')).conversations; apiError.value = '' } catch { apiError.value = 'No contesta la API. ¿Está arriba? (make wally) · reintenta cada 30 s' }
}

// ── LAS PESTAÑAS ──
// Una pestaña: { key, preview }. La clave es el id de la conversación, o `nueva-<n>` mientras no tiene preguntas.
// Lo de cada pestaña (la conversación cargada, el borrador, el modelo, el error) va en mapas por clave.
const saved = readPref('wally.tabs', { tabs: [], active: '' })
const tabs = ref(Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && t.key) : [])
const active = ref(saved.active || '')
const loaded = ref({})      // clave → conversación { id, title, model, messages }
const drafts = ref({})      // clave → texto sin mandar
const tabModel = ref({})    // clave → modelo elegido en esa pestaña
const errors = ref({})      // clave → el último error
const attachments = ref({}) // clave → archivos subidos y todavía sin mandar: [{ id, name, size, chars, kind }]
const uploading = ref({})   // clave → cuántos se están subiendo
let newCounter = Math.max(0, ...tabs.value.map((t) => Number((/^nueva-(\d+)$/.exec(t.key) || [])[1] || 0)))
const isNew = (key) => key.startsWith('nueva-')

function persistTabs() { savePref('wally.tabs', { tabs: tabs.value, active: active.value }) }
watch([tabs, active], persistTabs, { deep: true })

const tabTitle = (t) => {
  if (isNew(t.key)) return 'Conversación nueva'
  return loaded.value[t.key]?.title || conversations.value.find((c) => c.id === t.key)?.title || 'Conversación'
}

async function loadConv(key) {
  if (isNew(key)) return
  try {
    const c = await api(`/api/conversations/${encodeURIComponent(key)}`)
    loaded.value = { ...loaded.value, [key]: c }
    if (!tabModel.value[key] && c.model && models.value.some((m) => m.name === c.model)) tabModel.value = { ...tabModel.value, [key]: c.model }
  } catch (e) {
    // Una conversación que ya no existe (se borró en otra ventana) no deja la pestaña colgada.
    if (/no existe/.test(e.message)) closeTab(key)
    else errors.value = { ...errors.value, [key]: e.message }
  }
}

/** Abre (o trae al frente) una pestaña. `preview`: de paso, la reemplaza la próxima que se abra de paso. */
function openTab(key, { preview = false } = {}) {
  const existing = tabs.value.find((t) => t.key === key)
  if (existing) {
    if (!preview && existing.preview) existing.preview = false
  } else {
    const prev = tabs.value.findIndex((t) => t.preview)
    if (preview && prev >= 0) tabs.value.splice(prev, 1, { key, preview: true })
    else tabs.value.push({ key, preview })
  }
  activate(key)
}
function pinTab(key) { const t = tabs.value.find((x) => x.key === key); if (t) t.preview = false }
function newTab() { newCounter += 1; openTab(`nueva-${newCounter}`) }
function closeTab(key) {
  const i = tabs.value.findIndex((t) => t.key === key)
  if (i < 0 || pending.value?.key === key) return
  tabs.value.splice(i, 1)
  const { [key]: _d, ...restDrafts } = drafts.value
  drafts.value = restDrafts
  // Los archivos subidos y sin mandar se borran del disco: nadie los va a mandar.
  for (const f of attachments.value[key] || []) fetch(`/api/files/${f.id}`, { method: 'DELETE' }).catch(() => {})
  const { [key]: _a, ...restAtts } = attachments.value
  attachments.value = restAtts
  if (active.value === key) {
    const next = tabs.value[i] || tabs.value[i - 1]
    if (next) activate(next.key)
    else newTab()
  }
}
function activate(key) {
  active.value = key
  if (!isNew(key) && !loaded.value[key]) loadConv(key)
  writeRoute()
  scrollDown()
  focusInput()
}

// La ruta dice la pestaña activa: abrir un enlace `#/c/<id>` la abre.
function writeRoute() {
  const hash = isNew(active.value) ? `#/nueva/${active.value.slice(6)}` : `#/c/${encodeURIComponent(active.value)}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
}
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'c' && parts[1]) openTab(decodeURIComponent(parts[1]))
  else if (parts[0] === 'nueva' && parts[1] && tabs.value.some((t) => t.key === `nueva-${parts[1]}`)) activate(`nueva-${parts[1]}`)
}

// ── LA PESTAÑA ACTIVA ──
const conv = computed(() => loaded.value[active.value] || null)
const messages = computed(() => conv.value?.messages || [])
const draft = computed({
  get: () => drafts.value[active.value] || '',
  set: (v) => { drafts.value = { ...drafts.value, [active.value]: v } },
})
const model = computed({
  get: () => (usable(tabModel.value[active.value]) ? tabModel.value[active.value] : lastModel.value),
  set: (v) => { tabModel.value = { ...tabModel.value, [active.value]: v }; lastModel.value = v; savePref('wally.model', v) },
})
const error = computed(() => errors.value[active.value] || '')
const pendingFiles = computed(() => attachments.value[active.value] || [])
const fileChars = (files) => (files || []).reduce((n, f) => n + (f.chars || 0), 0)
const contextChars = computed(() => messages.value.reduce((n, m) => n + (m.text || '').length + fileChars(m.files), 0))
const contextFiles = computed(() => messages.value.reduce((n, m) => n + (m.files?.length || 0), 0))

// ── MANDAR ── (de a una pregunta en toda la app: la respuesta llega cuando AI Studio termina, sin streaming)
const pending = ref(null)   // { key, text, model, since }
const elapsed = ref(0)
let tick = null
let refresher = null
const busyElsewhere = computed(() => !!pending.value && pending.value.key !== active.value)
async function send() {
  const key = active.value
  const files = attachments.value[key] || []
  const draftBefore = draft.value
  const text = draft.value.trim() || (files.length ? (files.length > 1 ? 'Revisá los archivos adjuntos.' : 'Revisá el archivo adjunto.') : '')
  if (!text || pending.value || allPaused.value || uploading.value[key]) return
  errors.value = { ...errors.value, [key]: '' }
  pending.value = { key, text, files, model: model.value, since: Date.now() }
  attachments.value = { ...attachments.value, [key]: [] }   // salen del campo: ya van con la pregunta
  elapsed.value = 0
  tick = setInterval(() => { elapsed.value = Math.floor((Date.now() - pending.value.since) / 1000) }, 250)
  drafts.value = { ...drafts.value, [key]: '' }
  pinTab(key)
  scrollDown()
  try {
    const c = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: isNew(key) ? '' : key, model: pending.value.model, text, files: files.map((f) => f.id) }) })
    attachments.value = { ...attachments.value, [key]: [] }
    if (isNew(key)) {
      // La pestaña nueva pasa a ser la de su conversación, en el mismo lugar.
      const t = tabs.value.find((x) => x.key === key)
      if (t) t.key = c.id
      tabModel.value = { ...tabModel.value, [c.id]: pending.value.model }
      attachments.value = { ...attachments.value, [c.id]: [] }
      if (active.value === key) active.value = c.id
      writeRoute()
    }
    loaded.value = { ...loaded.value, [c.id]: c }
    loadList()
  } catch (e) {
    errors.value = { ...errors.value, [key]: e.message }
    if (!drafts.value[key]) drafts.value = { ...drafts.value, [key]: draftBefore }   // no se pierde lo escrito
    if (files.length) attachments.value = { ...attachments.value, [key]: [...files, ...(attachments.value[key] || [])] }
  } finally {
    loadModels()
    clearInterval(tick)
    pending.value = null
    scrollDown()
    focusInput()
  }
}
function onKey(e) {
  // Enter manda; Shift+Enter, renglón nuevo (como en el chat del equipo).
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send() }
}

// LOS ARCHIVOS: se suben a Wally (no a AI Studio, que los guardaría en tu Drive), que les saca el texto en esta máquina;
// en el campo quedan como fichas, y su texto viaja con la pregunta sin ocupar la conversación. Texto y código, PDF y
// Word; una imagen o un binario vuelve con su porqué.
const fileInput = ref(null)
const dragging = ref(false)
async function addFiles(list) {
  const key = active.value
  for (const file of [...list]) {
    uploading.value = { ...uploading.value, [key]: (uploading.value[key] || 0) + 1 }
    try {
      const body = new FormData()
      body.append('file', file)
      const att = await api('/api/files', { method: 'POST', body })
      attachments.value = { ...attachments.value, [key]: [...(attachments.value[key] || []), att] }
    } catch (e) {
      errors.value = { ...errors.value, [key]: e.message }
    } finally {
      uploading.value = { ...uploading.value, [key]: (uploading.value[key] || 1) - 1 }
    }
  }
  focusInput()
}
// Pegar un archivo copiado en el Finder también lo adjunta (el texto se pega como siempre).
function onPaste(e) { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }
function pickFiles(e) { addFiles(e.target.files); e.target.value = '' }
function removeAttachment(f) {
  const key = active.value
  attachments.value = { ...attachments.value, [key]: (attachments.value[key] || []).filter((x) => x.id !== f.id) }
  fetch(`/api/files/${f.id}`, { method: 'DELETE' }).catch(() => {})
}
let dragDepth = 0
function onDragEnter(e) { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth += 1; dragging.value = true } }
function onDragLeave() { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragging.value = false }
function onDrop(e) { dragDepth = 0; dragging.value = false; if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files) }
// Ver un archivo ya mandado: su ficha se abre y muestra el texto que viajó (el comienzo; «Ver todo» lo abre entero).
const openFile = ref({ id: '', text: '', full: false })
async function toggleFile(f) {
  if (openFile.value.id === f.id) { openFile.value = { id: '', text: '', full: false }; return }
  try {
    const text = await (await fetch(`/api/files/${f.id}`)).text()
    openFile.value = { id: f.id, text, full: false }
  } catch (e) { errors.value = { ...errors.value, [active.value]: e.message } }
}
const PREVIEW_CHARS = 4000
const sizeLabel = (n) => n >= 1048576 ? `${(n / 1048576).toLocaleString('es-CO', { maximumFractionDigits: 1 })} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`
const charsLabel = (n) => n >= 1000 ? `${Math.round(n / 1000).toLocaleString('es-CO')} mil car.` : `${n} car.`
const FILE_ICON = { pdf: 'PDF', documento: 'DOC', texto: 'TXT' }

// BORRAR UN BLOQUE: una pregunta o una respuesta sale de lo guardado y, con eso, del contexto de la próxima pregunta
// (AI Studio no recuerda nada: cada pregunta le manda todo lo que queda). Sin confirmación, como en un chat.
async function removeBlock(m) {
  const key = active.value
  if (!conv.value || !m.id) return
  try {
    const c = await api(`/api/conversations/${encodeURIComponent(conv.value.id)}/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    loaded.value = { ...loaded.value, [key]: c }
    loadList()
  } catch (e) { errors.value = { ...errors.value, [key]: e.message } }
}
async function removeConv(c) {
  if (!confirm(`¿Borrar «${c.title}»? No se puede recuperar.`)) return
  try {
    await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    closeTab(c.id)
    loadList()
  } catch (e) { apiError.value = e.message }
}

// ── LA LISTA: buscador y grupos por día ──
const search = ref('')
const DAY = 86_400_000
function dayGroup(iso) {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const t = new Date(iso).getTime()
  if (t >= start.getTime()) return 'Hoy'
  if (t >= start.getTime() - DAY) return 'Ayer'
  if (t >= start.getTime() - 6 * DAY) return 'Últimos 7 días'
  return 'Antes'
}
const groups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const out = []
  for (const c of conversations.value) {
    if (q && !c.title.toLowerCase().includes(q)) continue
    const name = dayGroup(c.updated)
    let g = out.find((x) => x.name === name)
    if (!g) { g = { name, items: [] }; out.push(g) }
    g.items.push(c)
  }
  return out
})
const openKeys = computed(() => new Set(tabs.value.map((t) => t.key)))

// ── LAS RESPUESTAS, en Markdown ── El HTML crudo que venga en una respuesta se muestra como texto (no se ejecuta), y
// los enlaces sólo pueden ser http(s): lo que escribe un modelo no es de confianza. Un bloque de código lleva su
// lenguaje y su «Copiar» (un clic delegado en el hilo, abajo).
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const renderer = new marked.Renderer()
renderer.html = ({ text }) => escapeHtml(text)
const baseLink = renderer.link.bind(renderer)
renderer.link = function (token) {
  if (!/^https?:\/\//i.test(token.href || '')) return escapeHtml(token.text || '')
  return baseLink(token).replace(/^<a /, '<a target="_blank" rel="noopener" ')
}
renderer.image = ({ text }) => escapeHtml(text || '')
renderer.code = ({ text, lang }) => {
  const label = escapeHtml((lang || '').split(/\s/)[0] || 'código')
  return `<div class="code-block"><div class="code-head"><span>${label}</span><button type="button" class="btn btn-ghost btn-xs code-copy">Copiar</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`
}
const md = (text) => marked.parse(text || '', { gfm: true, breaks: false, renderer })
function onThreadClick(e) {
  const button = e.target.closest?.('.code-copy')
  if (!button) return
  const code = button.closest('.code-block')?.querySelector('code')?.textContent || ''
  navigator.clipboard.writeText(code).then(() => {
    button.textContent = 'Copiado'
    setTimeout(() => { button.textContent = 'Copiar' }, 1500)
  }).catch(() => {})
}

const copiedId = ref('')
async function copy(m) {
  try { await navigator.clipboard.writeText(m.text); copiedId.value = m.id; setTimeout(() => { if (copiedId.value === m.id) copiedId.value = '' }, 1500) } catch { /* sin portapapeles */ }
}

// Sugerencias de una conversación vacía: sólo escriben en el campo, no mandan nada.
const SUGGESTIONS = [
  { label: 'Resumir un texto', text: 'Resumí en cinco puntos lo esencial de este texto:\n\n' },
  { label: 'Explicar algo', text: 'Explicame en palabras simples, con un ejemplo: ' },
  { label: 'Revisar código', text: 'Revisá este código y decime qué puede fallar:\n\n```\n\n```' },
  { label: 'Redactar un mensaje', text: 'Redactá un mensaje corto y cordial para ' },
]
function suggest(s) { draft.value = s.text; focusInput(true) }

// ── el hilo y el campo ──
const thread = ref(null)
const input = ref(null)
function scrollDown() { nextTick(() => { if (thread.value) thread.value.scrollTop = thread.value.scrollHeight }) }
function focusInput(toEnd = false) {
  nextTick(() => {
    const el = input.value
    if (!el) return
    el.focus()
    if (toEnd) el.setSelectionRange(el.value.length, el.value.length)
    grow()
  })
}
// El campo crece con lo escrito, hasta un tope (después scrollea).
function grow() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`
}
watch(draft, () => nextTick(grow))

const seconds = (ms) => (ms / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })
const pad = (n) => String(n).padStart(2, '0')
const clock = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function when(iso) {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return clock(iso)
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('wally.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('wally.sidebar-w', 260))
const shown = computed(() => {
  const [sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [
    { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
  ])
  return { sidebar }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px` }))
const sidebarResize = {
  label: 'Ancho de las conversaciones', sign: 1, defaultValue: 260,
  min: () => cssSize('--sidebar-min', 240), max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shown.value.sidebar,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('wally.sidebar-open', v ? 1 : 0); if (v) saveSize('wally.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shown.value.sidebar; saveSize('wally.sidebar-open', sidebarOpen.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth; grow() }

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadModels()
  await loadList()
  // Las pestañas recordadas cuya conversación ya no existe se cierran; sin ninguna, una nueva.
  const ids = new Set(conversations.value.map((c) => c.id))
  if (!apiError.value) tabs.value = tabs.value.filter((t) => isNew(t.key) || ids.has(t.key))
  readRoute()
  if (!tabs.value.length) newTab()
  else activate(tabs.value.some((t) => t.key === active.value) ? active.value : tabs.value[0].key)
  // Cada 30 s: si la API no contestaba al abrir, aparece sola, y una pausa que venció habilita «Preguntar».
  refresher = setInterval(() => { if (!document.hidden && !pending.value) { loadModels(); loadList() } }, 30_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  clearInterval(tick)
  clearInterval(refresher)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Conversaciones">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Wally</span>
        <span class="count">{{ conversations.length }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Conversación nueva" aria-label="Conversación nueva" @click="newTab">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="sidebar-search">
        <div class="input-group">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <input v-model="search" class="input input-sm" type="search" placeholder="Buscar conversaciones" aria-label="Buscar conversaciones" />
        </div>
      </div>
      <div class="region-body">
        <section v-for="g in groups" :key="g.name">
          <div class="region-head group"><span>{{ g.name }}</span></div>
          <div v-for="c in g.items" :key="c.id" class="conv-row" :class="{ on: active === c.id, open: openKeys.has(c.id) }">
            <button type="button" class="conv" :title="`${c.title} · ${modelName(c.model)}\nUn clic la abre de paso; doble clic la deja fija`"
                    @click="openTab(c.id, { preview: true })" @dblclick="openTab(c.id)">
              <span class="conv-title">
                <i v-if="pending && pending.key === c.id" class="live-dot" aria-label="esperando la respuesta"></i>
                {{ c.title }}
              </span>
              <span class="conv-meta">{{ modelName(c.model) }} · {{ c.count }} bloque{{ c.count === 1 ? '' : 's' }} · {{ when(c.updated) }}</span>
            </button>
            <button type="button" class="region-action conv-del" title="Borrar la conversación" aria-label="Borrar la conversación" @click="removeConv(c)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
        </section>
        <p v-if="!conversations.length" class="none">Todavía no le preguntaste nada.</p>
        <p v-else-if="!groups.length" class="none">Ninguna conversación dice «{{ search }}».</p>
      </div>
    </aside>

    <main class="editor">
      <nav class="tabs" aria-label="Conversaciones abiertas" @dblclick.self="newTab">
        <div v-for="t in tabs" :key="t.key" class="tab" :class="{ on: t.key === active, preview: t.preview }" role="tab" :aria-selected="t.key === active"
             @mousedown.middle.prevent="closeTab(t.key)">
          <button type="button" class="tab-label" :title="tabTitle(t)" @click="activate(t.key)" @dblclick="pinTab(t.key)">
            <i v-if="pending && pending.key === t.key" class="live-dot" aria-label="esperando la respuesta"></i>
            <span>{{ tabTitle(t) }}</span>
          </button>
          <button type="button" class="tab-close" :disabled="pending && pending.key === t.key" title="Cerrar la pestaña" aria-label="Cerrar la pestaña" @click="closeTab(t.key)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
        <div class="region-actions">
          <button type="button" class="region-action" title="Pestaña nueva" aria-label="Pestaña nueva" @click="newTab">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
      </nav>

      <div ref="thread" class="region-body thread" :class="{ dragging }" @click="onThreadClick"
           @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
        <div v-if="dragging" class="drop-hint"><span class="ui-icon" data-icon="attach" aria-hidden="true"></span>Soltá para adjuntar: el texto viaja con la pregunta</div>
        <div v-if="!messages.length && !(pending && pending.key === active)" class="empty">
          <div class="empty-head">
            <div class="empty-media"><span class="ui-icon" data-icon="comment" aria-hidden="true"></span></div>
            <div class="empty-title">Preguntale a Wally</div>
            <div class="empty-desc">Pregunta por la web de AI Studio, en tu Chrome y con tu cuenta, sin llave de API. Lo que quede guardado acá es el contexto de la próxima pregunta.</div>
          </div>
          <div class="suggestions">
            <button v-for="s in SUGGESTIONS" :key="s.label" type="button" class="btn btn-outline btn-sm" @click="suggest(s)">{{ s.label }}</button>
          </div>
        </div>
        <template v-for="m in messages" :key="m.id">
          <div v-if="m.role === 'user'" class="block block-user">
            <button type="button" class="region-action block-del" :disabled="!!pending" title="Borrar esta pregunta del contexto" aria-label="Borrar esta pregunta del contexto" @click="removeBlock(m)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
            <div class="user-col">
              <div class="bubble mine" :title="clock(m.at)">{{ m.text }}</div>
              <div v-if="m.files?.length" class="file-chips sent">
                <button v-for="f in m.files" :key="f.id" type="button" class="file-chip" :class="{ on: openFile.id === f.id }" :title="`${f.name} · ${sizeLabel(f.size)} · ${charsLabel(f.chars)} de texto: tocá para verlo`" @click="toggleFile(f)">
                  <span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span><span class="file-size">{{ charsLabel(f.chars) }}</span>
                </button>
              </div>
            </div>
          </div>
          <div v-if="m.role === 'user' && m.files?.some((f) => f.id === openFile.id)" class="file-view">
            <div class="file-view-head">
              <b>{{ m.files.find((f) => f.id === openFile.id)?.name }}</b>
              <span class="count">el texto que viaja con la pregunta</span>
              <button v-if="openFile.text.length > PREVIEW_CHARS" type="button" class="btn btn-ghost btn-xs" @click="openFile.full = !openFile.full">{{ openFile.full ? 'Ver menos' : 'Ver todo' }}</button>
              <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="openFile = { id: '', text: '', full: false }"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
            </div>
            <pre>{{ openFile.full ? openFile.text : openFile.text.slice(0, PREVIEW_CHARS) + (openFile.text.length > PREVIEW_CHARS ? '\n…' : '') }}</pre>
          </div>
          <article v-if="m.role === 'model'" class="block answer">
            <div class="answer-who"><span class="avatar" aria-hidden="true">W</span><b>Wally</b><span>{{ modelName(m.model) }} · {{ seconds(m.ms) }} s · {{ clock(m.at) }}</span></div>
            <div class="answer-body" v-html="md(m.text)"></div>
            <div class="answer-meta">
              <button type="button" class="btn btn-ghost btn-xs" @click="copy(m)">
                <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>{{ copiedId === m.id ? 'Copiado' : 'Copiar' }}
              </button>
              <button type="button" class="btn btn-ghost btn-xs block-del" :disabled="!!pending" title="Borrar esta respuesta del contexto" @click="removeBlock(m)">
                <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>Borrar
              </button>
            </div>
          </article>
        </template>
        <template v-if="pending && pending.key === active">
          <div class="block block-user"><div class="user-col">
            <div class="bubble mine">{{ pending.text }}</div>
            <div v-if="pending.files?.length" class="file-chips sent">
              <span v-for="f in pending.files" :key="f.id" class="file-chip"><span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span></span>
            </div>
          </div></div>
          <article class="answer">
            <div class="answer-who"><span class="avatar" aria-hidden="true">W</span><b>Wally</b><span>{{ modelName(pending.model) }} · en AI Studio, en tu Chrome · {{ elapsed }} s</span></div>
            <div class="typing" aria-label="pensando"><i></i><i></i><i></i></div>
          </article>
        </template>
        <div v-if="error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ error }}</p></div></div>
      </div>

      <form class="composer" @submit.prevent="send">
        <div class="composer-box" :class="{ dragging }" @dragenter.prevent="onDragEnter" @dragover.prevent @dragleave="onDragLeave" @drop.prevent="onDrop">
          <div v-if="pendingFiles.length || uploading[active]" class="file-chips">
            <span v-for="f in pendingFiles" :key="f.id" class="file-chip" :title="`${f.name} · ${sizeLabel(f.size)} · ${charsLabel(f.chars)} de texto`">
              <span class="file-kind">{{ FILE_ICON[f.kind] || 'TXT' }}</span><span class="file-name">{{ f.name }}</span><span class="file-size">{{ charsLabel(f.chars) }}</span>
              <button type="button" class="file-del" title="Quitar el archivo" aria-label="Quitar el archivo" @click="removeAttachment(f)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
            </span>
            <span v-if="uploading[active]" class="file-chip uploading"><i class="live-dot"></i>leyendo {{ uploading[active] }} archivo{{ uploading[active] > 1 ? 's' : '' }}…</span>
          </div>
          <textarea ref="input" v-model="draft" class="composer-input" rows="2" placeholder="Preguntale algo… (Enter manda, Shift+Enter baja de renglón)"
                    aria-label="La pregunta" @keydown="onKey" @input="grow" @paste="onPaste"></textarea>
          <div class="composer-bar">
            <input ref="fileInput" type="file" multiple hidden @change="pickFiles" />
            <button type="button" class="region-action" title="Adjuntar archivos: texto y código, PDF o Word. También se pueden arrastrar" aria-label="Adjuntar archivos" @click="fileInput?.click()">
              <span class="ui-icon" data-icon="attach" aria-hidden="true"></span>
            </button>
            <label class="select model-select" title="El modelo que contesta en esta pestaña">
              <select v-model="model" class="input input-xs" aria-label="Modelo" :disabled="!models.length">
                <option v-for="m in models" :key="m.name" :value="m.name" :disabled="!!m.paused">{{ m.displayName }}{{ m.paused ? ` · en pausa hasta las ${m.paused}` : m.note ? ` · ${m.note}` : '' }}</option>
              </select>
            </label>
            <span class="count" :title="'Lo que viaja como contexto en la próxima pregunta: AI Studio no recuerda nada (chat temporal), así que se le manda todo lo guardado. Borrá los bloques que no hagan falta.'">
              {{ messages.length ? `contexto: ${messages.length} bloque${messages.length > 1 ? 's' : ''}${contextFiles ? ` · ${contextFiles} archivo${contextFiles > 1 ? 's' : ''}` : ''} · ${contextChars.toLocaleString('es-CO')} car.` : 'sin contexto' }}
            </span>
            <span v-if="allPaused" class="composer-note warn-text">Google cortó: en pausa hasta las {{ allPaused }}</span>
            <span v-else-if="busyElsewhere" class="composer-note">Wally está contestando en otra pestaña</span>
            <button type="submit" class="btn btn-sm send" :disabled="(!draft.trim() && !pendingFiles.length) || !!pending || !!allPaused || !!uploading[active]" title="Preguntar (Enter)">
              <span class="ui-icon" data-icon="send" aria-hidden="true"></span>Preguntar
            </button>
          </div>
        </div>
      </form>
    </main>

    <footer class="statusbar">
      <span v-if="apiError" class="warn-text">{{ apiError }}</span>
      <span v-else>{{ tabs.length }} abierta{{ tabs.length === 1 ? '' : 's' }} · por la web de AI Studio{{ allPaused ? ` · en pausa hasta las ${allPaused}` : pausedCount ? ` · ${pausedCount} modelo${pausedCount > 1 ? 's' : ''} en pausa` : '' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las conversaciones" aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
