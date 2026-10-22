<script setup>
/* chat · la interfaz. Un mini WhatsApp sobre el chat de la terminal del playground compartido.
 *
 * El sidebar lista las conversaciones (la más reciente arriba, con lo no leído) y, debajo, quién está
 * conectado ahora: con un clic se abre una conversación nueva. El editor es la conversación —burbujas y el
 * campo para contestar— y el pie dice si `playground listen` está prendido, que es lo que hace que los
 * mensajes lleguen.
 *
 * Todo lo que se manda y se recibe pasa por el CLI (la API en Go no es otro cliente). El historial lo
 * guarda el store en el navegador. La conversación abierta vive en la URL (`#/c/<correo>`); el ancho del
 * sidebar, en el navegador.
 *
 * ⚠ Mandar sale a nombre de quien está logueado en el CLI. El texto ajeno se pinta como texto.
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from './stores/chat.js'
// La oficina 3D trae Three.js: se baja recién cuando se abre, no con el chat.
const OfficeView = defineAsyncComponent(() => import('./office/OfficeView.vue'))
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const chat = useChatStore()

// ── la ruta: #/c/<correo> la conversación · #/oficina la oficina en 3D ──
// En la oficina no queda ninguna conversación abierta (si no, se darían por leídas sin verse); la última se
// recuerda para volver a ella con «Chat».
const view = ref('chat')
let lastKey = ''
function routeKey() {
  const { parts } = readHashRoute()
  return parts[0] === 'c' && parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : ''
}
function applyRoute() {
  if (readHashRoute().parts[0] === 'oficina') {
    if (chat.activeKey) lastKey = chat.activeKey
    chat.activeKey = ''
    view.value = 'office'
    return
  }
  view.value = 'chat'
  const key = routeKey()
  if (key && chat.conversations[key]) chat.open(chat.conversations[key].person)
  else if (key) chat.open({ email: key, name: key.split('@')[0] })
  else chat.activeKey = ''
}
function currentHash() {
  if (view.value === 'office') return hashRoute(['oficina'])
  return chat.activeKey ? hashRoute(['c', chat.activeKey]) : ''
}
watch([view, () => chat.activeKey], () => {
  const target = currentHash()
  if (target !== (location.hash || '')) setRoute(`${location.pathname}${location.search}${target}`, { push: true })
})
function openChat(person) {
  view.value = 'chat'
  chat.open(person)
}
function toggleOffice() {
  if (view.value === 'office') {
    view.value = 'chat'
    if (lastKey && chat.conversations[lastKey]) chat.open(chat.conversations[lastKey].person)
    return
  }
  if (chat.activeKey) lastKey = chat.activeKey
  chat.activeKey = ''
  view.value = 'office'
}

// ── las regiones: el sidebar a la izquierda, con el contrato de la base ──
const sidebarOpen = ref(readSize('chat.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('chat.sidebar-w', 300))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
const sidebarShown = computed(() => fitRegions(viewportW.value - cssSize('--editor-min', 360), [
  { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
])[0])
const layoutVars = computed(() => ({ '--sidebar-w': `${sidebarShown.value}px` }))
const sidebarResize = {
  label: 'Ancho de las conversaciones', sign: 1, defaultValue: 300,
  min: () => cssSize('--sidebar-min', 240),
  max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => sidebarShown.value,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('chat.sidebar-open', v ? 1 : 0); if (v) saveSize('chat.sidebar-w', sidebarW.value) },
}
function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  saveSize('chat.sidebar-open', sidebarOpen.value ? 1 : 0)
}

// ── formatos: la hora de Colombia, como el chat de la terminal ──
const TZ = 'America/Bogota'
const dayOf = (iso) => new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ })
const clock = (iso) => new Date(iso).toLocaleTimeString('es-CO', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
function shortWhen(iso) {
  if (!iso) return ''
  return dayOf(iso) === dayOf(new Date().toISOString()) ? clock(iso)
    : new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short' })
}
function dayLabel(iso) {
  const today = dayOf(new Date().toISOString())
  const yesterday = dayOf(new Date(Date.now() - 864e5).toISOString())
  const d = dayOf(iso)
  if (d === today) return 'Hoy'
  if (d === yesterday) return 'Ayer'
  return new Date(iso).toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
}
const initials = (p) => (p?.name || p?.email || '?').split(/[^\p{L}]+/u).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
const handle = (p) => `@${(p?.email || '').split('@')[0]}`

// Los mensajes de la conversación abierta, con un separador por día.
const thread = computed(() => {
  const out = []
  let day = ''
  for (const m of chat.active?.messages || []) {
    const d = dayOf(m.time)
    if (d !== day) { day = d; out.push({ kind: 'day', id: `day-${d}`, label: dayLabel(m.time) }) }
    out.push({ kind: 'message', ...m })
  }
  return out
})

// Quién está conectado y todavía no tiene conversación (sin contarme a mí).
const onlineWithoutChat = computed(() => chat.online.filter((p) => {
  const key = (p.email || '').toLowerCase()
  return key !== chat.meKey && !chat.conversations[key]
}))
const activeOnline = computed(() => chat.active && chat.onlineKeys.has(chat.active.person.email))

// ── el campo para contestar: Enter manda, Shift+Enter baja de renglón ──
const draft = ref('')
const composer = ref(null)
const threadEl = ref(null)
async function submit() {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  await nextTick(); autosize()
  await chat.send(text)
}
function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
}
function autosize() {
  const el = composer.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
async function scrollToEnd() {
  await nextTick()
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
}
watch(() => [chat.activeKey, chat.active?.messages.length], scrollToEnd)
watch(() => chat.activeKey, async () => { draft.value = ''; await nextTick(); composer.value?.focus() })

function forgetActive() {
  if (chat.active) chat.forget(chat.active.person.email)
}

// El título de la pestaña dice cuántos no leídos hay, como cualquier chat.
watch(() => chat.unreadTotal, (n) => { document.title = n ? `(${n}) chat` : 'chat' }, { immediate: true })

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  applyRoute()
  chat.start()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('popstate', applyRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
})
onBeforeUnmount(() => {
  chat.stop()
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('popstate', applyRoute)
  themeBinding?.destroy?.()
})

const listening = computed(() => chat.state?.listening)
const statusText = computed(() => {
  const s = chat.state
  if (chat.stateError) return 'sin API'
  if (!s) return 'preguntando al CLI…'
  if (!s.installed) return 'falta el CLI playground'
  if (!s.listening) return 'no estás escuchando'
  return s.connected ? 'escuchando' : 'reconectando'
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="sidebarShown" class="sidebar" aria-label="Conversaciones">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Conversaciones</span>
        <span v-if="chat.unreadTotal" class="count filtered" :title="`${chat.unreadTotal} sin leer`">{{ chat.unreadTotal }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Actualizar" aria-label="Actualizar"
                  @click="chat.loadState(); chat.loadOnline()">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <p v-if="!chat.list.length" class="side-note">
          Todavía no hay conversaciones. Abrí una con alguien de «Conectados», o esperá a que te escriban.
        </p>
        <ul v-else class="conversations">
          <li v-for="c in chat.list" :key="c.person.email">
            <button type="button" class="conversation" :class="{ on: c.person.email === chat.activeKey }" @click="openChat(c.person)">
              <span class="avatar" aria-hidden="true">{{ initials(c.person) }}<i v-if="c.online" class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ c.person.name || c.person.email }}</b>
                  <span class="when">{{ shortWhen(c.last?.time) }}</span>
                </span>
                <span class="conversation-bottom">
                  <span class="snippet"><template v-if="c.last?.dir === 'out'">Vos: </template>{{ c.last?.text || 'sin mensajes' }}</span>
                  <span v-if="c.unread" class="unread">{{ c.unread }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>

        <div class="region-head group">
          <span>Conectados</span>
          <span class="count">{{ onlineWithoutChat.length }}</span>
        </div>
        <p v-if="chat.onlineError" class="side-note bad">{{ chat.onlineError }}</p>
        <p v-else-if="!onlineWithoutChat.length" class="side-note">Nadie más, o ya tenés conversación con todos los conectados.</p>
        <ul v-else class="conversations">
          <li v-for="p in onlineWithoutChat" :key="p.email">
            <button type="button" class="conversation" @click="openChat(p)">
              <span class="avatar" aria-hidden="true">{{ initials(p) }}<i class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">{{ p.name || p.email }}</b></span>
                <span class="conversation-bottom"><span class="snippet">{{ handle(p) }}</span></span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <main class="editor">
      <template v-if="view === 'office'">
        <div class="region-head">
          <span>Oficina</span>
          <span class="count">vista 3D</span>
        </div>
        <OfficeView />
      </template>
      <template v-else>
      <div class="region-head">
        <template v-if="chat.active">
          <span>{{ chat.active.person.name || chat.active.person.email }}</span>
          <span class="count">{{ activeOnline ? 'conectado' : 'desconectado' }} · {{ handle(chat.active.person) }}</span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Borrar esta conversación de este navegador"
                    aria-label="Borrar esta conversación de este navegador" @click="forgetActive">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <span v-else>chat</span>
      </div>

      <!-- Avisos que cambian lo que se puede hacer: van dentro del editor, no como banner global. -->
      <div v-if="chat.stateError" class="notice bad">{{ chat.stateError }}</div>
      <div v-else-if="chat.state && !chat.state.installed" class="notice">
        Falta el CLI <code>playground</code>: <code>curl -fsSL https://playground.creditop.com/cli/install | sh</code> y después <code>playground login</code>.
      </div>
      <div v-else-if="chat.state && !listening" class="notice">
        <span>No estás escuchando: lo que te escriban no llega. Mandar sí funciona.</span>
        <button type="button" class="btn btn-sm" :disabled="chat.listenBusy" @click="chat.startListening()">
          {{ chat.listenBusy ? 'Prendiendo…' : 'Empezar a escuchar' }}
        </button>
        <span v-if="chat.listenError" class="bad">{{ chat.listenError }}</span>
      </div>

      <div v-if="!chat.active" class="region-body">
        <div class="empty">
          <div class="empty-head">
            <div class="empty-title">Elegí una conversación</div>
            <div class="empty-desc">
              Los mensajes llegan por <code>playground listen</code> y se guardan en este navegador.
              A quien está conectado le podés escribir desde «Conectados».
            </div>
          </div>
        </div>
      </div>

      <template v-else>
        <div ref="threadEl" class="region-body thread" aria-live="polite">
          <p v-if="!thread.length" class="side-note center">Todavía no hay mensajes con {{ chat.active.person.name || chat.active.person.email }}.</p>
          <template v-for="item in thread" :key="item.id">
            <div v-if="item.kind === 'day'" class="day"><span>{{ item.label }}</span></div>
            <div v-else class="bubble-row" :class="item.dir">
              <div class="bubble" :class="{ failed: item.status === 'error' }">
                <p class="text">{{ item.text }}</p>
                <span class="meta">
                  {{ clock(item.time) }}
                  <template v-if="item.dir === 'out'">
                    <span v-if="item.status === 'sending'" title="Mandando">· mandando…</span>
                    <span v-else-if="item.status === 'sent'" title="Entregado a sus terminales abiertas">· ✓</span>
                  </template>
                </span>
                <p v-if="item.status === 'error'" class="error">
                  No salió: {{ item.error }}
                  <button type="button" class="btn-link" @click="chat.retry(item.id)">reintentar</button>
                </p>
              </div>
            </div>
          </template>
        </div>
        <form class="composer" @submit.prevent="submit">
          <label class="sr-only" for="composer-text">Mensaje para {{ chat.active.person.name || chat.active.person.email }}</label>
          <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1"
                    maxlength="2000" placeholder="Escribí un mensaje" @keydown="onKeydown" @input="autosize"></textarea>
          <button type="submit" class="btn" :disabled="!draft.trim()">Mandar</button>
        </form>
      </template>
      </template>
    </main>

    <footer class="statusbar">
      <span class="statusbar-item">
        <i class="status-dot" :class="{ on: listening && chat.state?.connected }" aria-hidden="true"></i>
        {{ statusText }}<template v-if="chat.me"> · {{ chat.me.email }}</template>
      </span>
      <span v-if="chat.state?.since && listening">desde las {{ clock(chat.state.since) }}</span>
      <button type="button" class="statusbar-item office-toggle" :aria-pressed="view === 'office'" @click="toggleOffice">
        {{ view === 'office' ? 'Volver al chat' : 'Oficina 3D' }}
      </button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!sidebarShown" title="Mostrar u ocultar las conversaciones"
                aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
code { font-family: var(--font-mono); font-size: .92em }
.bad { color: var(--send-fail) }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }

/* ── el sidebar ── */
.side-note { margin: 0; padding: var(--space-3) var(--gutter); color: var(--fg-2); font-size: var(--text-sm); line-height: 1.5 }
.side-note.center { text-align: center; padding-top: var(--space-6) }
.conversations { list-style: none; margin: 0; padding: var(--space-1) 0 }
.conversation { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px var(--gutter);
  border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit }
.conversation:hover { background: var(--hover) }
.conversation.on { background: var(--accent); color: var(--accent-foreground) }
.conversation:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.avatar { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  background: var(--muted); color: var(--foreground); font-size: var(--text-sm); font-weight: 600 }
.presence { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--presence-on); box-shadow: 0 0 0 2px var(--sidebar) }
.conversation-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px }
.conversation-top, .conversation-bottom { display: flex; align-items: baseline; gap: 8px; min-width: 0 }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600 }
.when { flex: none; color: var(--fg-2); font-size: var(--text-xs) }
.snippet { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: var(--text-sm) }
.unread { flex: none; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: grid; place-items: center;
  background: var(--primary); color: var(--primary-foreground); font-size: var(--text-xs); font-weight: 600 }

/* ── el editor: la conversación ── */
.editor { display: flex; flex-direction: column; min-height: 0 }
.notice { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: 8px var(--gutter);
  border-bottom: 1px solid var(--border); background: var(--muted); color: var(--fg-2); font-size: var(--text-sm) }
.thread { display: flex; flex-direction: column; gap: 6px; padding: var(--space-4) var(--space-6) }
.day { align-self: center; margin: var(--space-2) 0; padding: 2px 10px; border-radius: 999px; background: var(--muted);
  color: var(--fg-2); font-size: var(--text-xs); text-transform: capitalize }
.bubble-row { display: flex }
.bubble-row.out { justify-content: flex-end }
.bubble { max-width: min(560px, 78%); padding: 7px 10px 5px; border-radius: 10px; background: var(--bubble-theirs);
  color: var(--foreground); display: flex; flex-direction: column; gap: 2px }
.bubble-row.in .bubble { border-top-left-radius: 3px }
.bubble-row.out .bubble { background: var(--bubble-mine); border-top-right-radius: 3px }
.bubble.failed { box-shadow: inset 0 0 0 1px var(--send-fail) }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.45 }
.meta { align-self: flex-end; color: var(--fg-2); font-size: var(--text-xs); font-variant-numeric: tabular-nums }
.error { margin: 2px 0 0; color: var(--send-fail); font-size: var(--text-sm) }
.btn-link { border: 0; padding: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit }
.composer { flex: none; display: flex; align-items: flex-end; gap: var(--space-2); padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--border) }
.composer-text { height: auto; min-height: var(--control-md); max-height: 160px; padding-block: 7px; resize: none; line-height: 1.4;
  font: inherit; font-size: 14px }

/* ── el pie ── */
.office-toggle { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer }
.office-toggle[aria-pressed="true"] { color: var(--foreground); font-weight: 600 }
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3); margin-right: 6px }
.status-dot.on { background: var(--presence-on) }
</style>
