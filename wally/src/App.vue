<script setup>
/* WALLY: un chat para hacerle preguntas a Gemini, eligiendo el modelo, POR LA WEB de AI Studio (bin/aistudio, en el
 * Chrome de Miguel con Jarvis y su cuenta, sin llave de API). A la izquierda las conversaciones guardadas; al centro la
 * abierta, con el campo para preguntar y el selector de modelo abajo. El servidor (wally/server) guarda todo; un
 * modelo que Google cortó sale en pausa y no se puede elegir hasta que vence.
 *
 * La ruta es `#/c/<id>`; sin id, una conversación nueva. El modelo elegido se recuerda en esta máquina y, al abrir
 * una conversación, vuelve a ser el que se usó ahí. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const models = ref([])
const defaultModel = ref('')
const model = ref(readPref('wally.model', ''))
const conversations = ref([])
const conv = ref(null)          // la abierta: { id, title, model, messages }
const convId = ref('')
const draft = ref('')
const pending = ref(null)       // la pregunta que espera respuesta: { text, model, since }
const error = ref('')
const apiError = ref('')
const elapsed = ref(0)

async function api(path, options) {
  const res = await fetch(path, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  return body
}

async function loadModels() {
  try {
    const r = await api('/api/models')
    models.value = r.models || []
    defaultModel.value = r.default
    const usable = (name) => models.value.some((m) => m.name === name && !m.paused)
    if (!usable(model.value)) model.value = usable(r.default) ? r.default : (models.value.find((m) => !m.paused)?.name || model.value || r.default)
  } catch (e) { apiError.value = `No pude leer los modelos: ${e.message}` }
}
async function loadList() {
  try { conversations.value = (await api('/api/conversations')).conversations; apiError.value = '' } catch { apiError.value = 'No contesta la API. ¿Está arriba? (make wally) · reintenta cada 30 s' }
}
async function loadConv(id) {
  error.value = ''
  if (!id) { conv.value = null; return }
  try {
    conv.value = await api(`/api/conversations/${encodeURIComponent(id)}`)
    if (conv.value.model && models.value.some((m) => m.name === conv.value.model)) model.value = conv.value.model
    scrollDown()
  } catch (e) { conv.value = null; error.value = e.message }
}

// La ruta: #/c/<id>.
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  convId.value = parts[0] === 'c' ? decodeURIComponent(parts[1] || '') : ''
}
function go(id) {
  const hash = id ? `#/c/${encodeURIComponent(id)}` : '#/'
  if (location.hash !== hash) location.hash = hash
  else readRoute()
}
watch(convId, (id) => { if (!pending.value) loadConv(id); focusInput() })
watch(model, (m) => { if (m) savePref('wally.model', m) })

const messages = computed(() => conv.value?.messages || [])
const modelName = (name) => models.value.find((m) => m.name === name)?.displayName || name
const pausedCount = computed(() => models.value.filter((m) => m.paused).length)
// Toda la cuenta en pausa: Google cortó y no se pregunta hasta que vence (la hora es la de la pausa).
const allPaused = computed(() => models.value.length > 0 && models.value.every((m) => m.paused) ? models.value[0].paused : '')

// MANDAR: la pregunta se ve al instante; la respuesta llega cuando Gemini termina (sin streaming).
let tick = null
let refresher = null
async function send() {
  const text = draft.value.trim()
  if (!text || pending.value) return
  error.value = ''
  pending.value = { text, model: model.value, since: Date.now() }
  elapsed.value = 0
  tick = setInterval(() => { elapsed.value = Math.floor((Date.now() - pending.value.since) / 1000) }, 250)
  draft.value = ''
  scrollDown()
  const askedIn = convId.value
  try {
    const c = await api('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: askedIn, model: model.value, text }) })
    if (convId.value === askedIn) { conv.value = c; if (!askedIn) go(c.id) }
    loadList()
  } catch (e) {
    error.value = e.message
    if (!draft.value) draft.value = text   // no se pierde lo escrito
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
function newChat() { go(''); conv.value = null; draft.value = ''; focusInput() }
// BORRAR UN BLOQUE: una pregunta o una respuesta sale de lo guardado y, con eso, del contexto de la próxima pregunta
// (AI Studio no recuerda nada: cada pregunta le manda todo lo que queda). Sin confirmación, como en un chat.
async function removeBlock(m) {
  if (!conv.value || !m.id) return
  try {
    conv.value = await api(`/api/conversations/${encodeURIComponent(conv.value.id)}/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' })
    loadList()
  } catch (e) { error.value = e.message }
}
const contextChars = computed(() => messages.value.reduce((n, m) => n + (m.text || '').length, 0))

async function removeConv(c) {
  if (!confirm(`¿Borrar «${c.title}»? No se puede recuperar.`)) return
  try {
    await api(`/api/conversations/${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    if (convId.value === c.id) newChat()
    loadList()
  } catch (e) { apiError.value = e.message }
}

// LAS RESPUESTAS, en Markdown. El HTML crudo que venga en una respuesta se muestra como texto (no se ejecuta), y los
// enlaces sólo pueden ser http(s): lo que escribe un modelo no es de confianza.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const renderer = new marked.Renderer()
renderer.html = ({ text }) => escapeHtml(text)
const baseLink = renderer.link.bind(renderer)
renderer.link = function (token) {
  if (!/^https?:\/\//i.test(token.href || '')) return escapeHtml(token.text || '')
  return baseLink(token).replace(/^<a /, '<a target="_blank" rel="noopener" ')
}
renderer.image = ({ text }) => escapeHtml(text || '')
const md = (text) => marked.parse(text || '', { gfm: true, breaks: false, renderer })

const copiedAt = ref(-1)
async function copy(text, i) {
  try { await navigator.clipboard.writeText(text); copiedAt.value = i; setTimeout(() => { if (copiedAt.value === i) copiedAt.value = -1 }, 1500) } catch { /* sin portapapeles */ }
}

const thread = ref(null)
const input = ref(null)
function scrollDown() { nextTick(() => { if (thread.value) thread.value.scrollTop = thread.value.scrollHeight }) }
function focusInput() { nextTick(() => input.value?.focus()) }
const seconds = (ms) => (ms / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })
const pad = (n) => String(n).padStart(2, '0')
function when(iso) {
  const d = new Date(iso)
  if (d.toDateString() === new Date().toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
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
const onWindowResize = () => { viewportW.value = window.innerWidth }

const themeToggle = ref(null)
let themeBinding = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  await loadModels()
  readRoute()
  loadList()
  // Cada 30 s: si la API no contestaba al abrir, aparece sola, y una pausa que venció habilita «Preguntar».
  refresher = setInterval(() => { if (!document.hidden && !pending.value) { loadModels(); loadList() } }, 30_000)
  if (convId.value) loadConv(convId.value)
  focusInput()
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
        <button type="button" class="region-action" title="Conversación nueva" aria-label="Conversación nueva" @click="newChat">
          <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
        </button>
      </div>
      <div class="region-body">
        <div v-for="c in conversations" :key="c.id" class="conv-row" :class="{ on: convId === c.id }">
          <button type="button" class="conv" :title="`${c.title} · ${modelName(c.model)}`" @click="go(c.id)">
            <span class="conv-title">{{ c.title }}</span>
            <span class="conv-meta">{{ modelName(c.model) }} · {{ when(c.updated) }}</span>
          </button>
          <button type="button" class="region-action conv-del" title="Borrar la conversación" aria-label="Borrar la conversación" @click="removeConv(c)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </div>
        <p v-if="!conversations.length" class="none">Todavía no le preguntaste nada.</p>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <span class="head-title">{{ conv?.title || 'Conversación nueva' }}</span>
        <span v-if="messages.length" class="count" :title="'Lo que viaja como contexto en la próxima pregunta: AI Studio no recuerda nada (chat temporal), así que se le manda todo lo guardado. Borrá los bloques que no hagan falta.'">contexto: {{ messages.length }} bloque{{ messages.length > 1 ? 's' : '' }} · {{ contextChars.toLocaleString('es-CO') }} caracteres</span>
      </div>
      <div ref="thread" class="region-body thread">
        <div v-if="!messages.length && !pending" class="empty">
          <div class="empty-head">
            <div class="empty-media"><span class="ui-icon" data-icon="comment" aria-hidden="true"></span></div>
            <div class="empty-title">Preguntale a Wally</div>
            <div class="empty-desc">Pregunta por la web de AI Studio, en tu Chrome y con tu cuenta, sin llave de API. Elegí el modelo abajo: Flash Lite es el liviano; Hydrogen, el más capaz, para lo que lo valga.</div>
          </div>
        </div>
        <template v-for="(m, i) in messages" :key="m.id || i">
          <div v-if="m.role === 'user'" class="block block-user">
            <button type="button" class="region-action block-del" :disabled="!!pending" title="Borrar esta pregunta del contexto" aria-label="Borrar esta pregunta del contexto" @click="removeBlock(m)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
            <div class="bubble mine">{{ m.text }}</div>
          </div>
          <article v-else class="block answer">
            <div class="answer-body" v-html="md(m.text)"></div>
            <div class="answer-meta">
              <span>{{ modelName(m.model) }} · {{ seconds(m.ms) }} s</span>
              <button type="button" class="btn btn-ghost btn-xs" @click="copy(m.text, i)">{{ copiedAt === i ? 'Copiado' : 'Copiar' }}</button>
              <button type="button" class="region-action block-del" :disabled="!!pending" title="Borrar esta respuesta del contexto" aria-label="Borrar esta respuesta del contexto" @click="removeBlock(m)">
                <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
              </button>
            </div>
          </article>
        </template>
        <template v-if="pending">
          <div class="bubble mine">{{ pending.text }}</div>
          <p class="thinking">{{ modelName(pending.model) }} está pensando en AI Studio (tu Chrome)… {{ elapsed }} s</p>
        </template>
        <div v-if="error" class="alert alert-destructive" role="alert"><span class="ui-icon alert-icon" data-icon="alert" aria-hidden="true"></span><div class="alert-desc"><p>{{ error }}</p></div></div>
      </div>
      <form class="composer" @submit.prevent="send">
        <textarea ref="input" v-model="draft" class="input" rows="3" placeholder="Preguntale algo… (Enter manda, Shift+Enter baja de renglón)"
                  aria-label="La pregunta" :disabled="!!pending" @keydown="onKey"></textarea>
        <div class="composer-bar">
          <label class="select model-select" title="El modelo que contesta">
            <select v-model="model" class="input input-sm" aria-label="Modelo" :disabled="!!pending || !models.length">
              <option v-for="m in models" :key="m.name" :value="m.name" :disabled="!!m.paused">{{ m.displayName }}{{ m.paused ? ` · en pausa hasta las ${m.paused}` : m.note ? ` · ${m.note}` : '' }}</option>
            </select>
          </label>
          <span v-if="allPaused" class="paused-note">Google cortó: en pausa hasta las {{ allPaused }}</span>
          <button type="submit" class="btn btn-sm" :disabled="!draft.trim() || !!pending || !!allPaused">Preguntar</button>
        </div>
      </form>
    </main>

    <footer class="statusbar">
      <span v-if="apiError" class="warn-text">{{ apiError }}</span>
      <span v-else>{{ conversations.length }} conversaciones · por la web de AI Studio{{ allPaused ? ` · en pausa hasta las ${allPaused}` : pausedCount ? ` · ${pausedCount} modelo${pausedCount > 1 ? 's' : ''} en pausa` : '' }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las conversaciones" aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
