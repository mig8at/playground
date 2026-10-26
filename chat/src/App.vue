<script setup>
/* chat · la interfaz. Un mini WhatsApp sobre el chat de la terminal del playground compartido.
 *
 * El sidebar lista las conversaciones (la más reciente arriba, con lo no leído; el punto verde dice quién está
 * conectado), debajo quien está conectado y todavía no tiene una, y los agentes del equipo: con un clic se abre
 * una conversación. El editor es la conversación —burbujas, la
 * cita del mensaje al que contesta cada una y el campo para escribir— y el pie dice si `playground listen`
 * está prendido, que es lo que hace que los mensajes lleguen.
 *
 * Todo lo que se manda y se recibe pasa por el CLI (la API en Go no es otro cliente). El historial lo
 * guarda el store en el navegador. La conversación abierta vive en la URL (`#/c/<clave>`); el ancho del
 * sidebar, en el navegador.
 *
 * La oficina 3D y el creador de personajes (`src/office/`) quedaron fuera de la interfaz: el código sigue
 * ahí, pero no se carga ni tiene ruta.
 *
 * ⚠ Mandar sale a nombre de quien está logueado en el CLI. El texto ajeno se pinta como texto.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChatStore } from './stores/chat.js'
import { useMyAgentStore } from './stores/myAgent.js'
import MyAgent from './MyAgent.vue'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, readHashRoute, hashRoute, setRoute,
} from './workbench.js'

const chat = useChatStore()
const mine = useMyAgentStore()
/* Vos y tu agente son lo mismo: en «Mi chat», la región de la DERECHA (`auxiliarybar`) es tu agente —cómo se ve, qué
   modelo usa, quién contesta—, al lado de tu bandeja. En otra conversación no está. Se cierra con su ✕ o el botón del
   pie, y recuerda si quedó cerrada y su ancho. */
const agentOpen = ref(readSize('chat.agente-open', 1) !== 0)
const agentW = ref(readSize('chat.agente-w', 380))
function setAgentOpen(v) { agentOpen.value = v; saveSize('chat.agente-open', v ? 1 : 0) }
// «Mi chat»: tu bandeja en el editor y tu agente a la derecha.
function deleteConversation(c) {
  if (window.confirm(`¿Borrar la conversación con ${c.person.name || c.person.email}? Sólo se borra de este navegador.`)) chat.removeConversation(c.person.email)
}
function openMyChat() { chat.activeKey = ''; setAgentOpen(true) }
const agentLabel = computed(() => mine.agent.name || 'Mi agente')
/* LAS FOTOS DE GOOGLE: la de cada persona viene con ella (el home la manda en quién está conectado y en cada mensaje);
   la tuya, de tu sesión. Sin foto, las iniciales de siempre. Se piden sin «referer»: así las sirve Google. */
const myPhoto = computed(() => chat.state?.session?.picture || '')
const photoOf = (p) => {
  const email = String(p?.email || '').toLowerCase()
  if (email && email === chat.meKey) return myPhoto.value
  return p?.picture || chat.online.find((o) => String(o.email || '').toLowerCase() === email)?.picture || ''
}
// Responder desde «Mi chat»: abre la conversación con ese mensaje citado, listo para escribir.
async function replyFromInbox(item) {
  chat.open(item.person)
  await nextTick()
  if (item.sid) startReply({ ...item, kind: 'message' })
  composer.value?.focus()
}
function toggleMode() { mine.setMode(mine.agent.mode === 'agente' ? 'yo' : 'agente') }

// ── la ruta: #/c/<clave> es la conversación abierta (un correo, o `agent:<dueño>/<agente>`) ──
function routeKey() {
  const { parts } = readHashRoute()
  return parts[0] === 'c' && parts[1] ? parts[1].toLowerCase() : ''
}
function applyRoute() {
  // `#/mi-agente`, de cuando era una pantalla: abre la región de la derecha.
  if (readHashRoute().parts[0] === 'mi-agente') { setAgentOpen(true); chat.activeKey = ''; return }
  const key = routeKey()
  if (key && chat.conversations[key]) chat.open(chat.conversations[key].person)
  // Una conversación con un agente que este navegador no tiene no se inventa: se abre desde «Agentes».
  else if (key && !key.startsWith('agent:')) chat.open({ email: key, name: key.split('@')[0] })
  else chat.activeKey = ''
}
watch(() => chat.activeKey, (key) => {
  const target = key ? hashRoute(['c', key]) : ''
  if (target !== (location.hash || '')) setRoute(`${location.pathname}${location.search}${target}`, { push: true })
})

// ── las regiones: el sidebar a la izquierda, con el contrato de la base ──
const sidebarOpen = ref(readSize('chat.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('chat.sidebar-w', 300))
const viewportW = ref(window.innerWidth)
const onWindowResize = () => { viewportW.value = window.innerWidth }
// Si no entra todo, se pliega primero la derecha (tu agente) y después las conversaciones, como en VS Code.
const fitted = computed(() => fitRegions(viewportW.value - cssSize('--editor-min', 360), [
  { size: agentOpen.value && !chat.activeKey ? agentW.value : 0, min: 320 },
  { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
]))
const agentShown = computed(() => fitted.value[0])
const sidebarShown = computed(() => fitted.value[1])
const layoutVars = computed(() => ({ '--sidebar-w': `${sidebarShown.value}px`, '--auxiliarybar-w': `${agentShown.value}px` }))
const agentResize = {
  label: 'Ancho de tu agente', sign: -1, defaultValue: 380,
  min: () => 320,
  max: () => viewportW.value - cssSize('--editor-min', 360) - sidebarShown.value,
  get: () => agentShown.value,
  set: (v) => { if (!v) agentOpen.value = false; else { agentOpen.value = true; agentW.value = v } },
  reopen: () => agentW.value,
  commit: (v) => { saveSize('chat.agente-open', v ? 1 : 0); if (v) saveSize('chat.agente-w', agentW.value) },
}
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
const firstName = (p) => String(p?.name || p?.email || '').split(/[\s@]+/)[0]
const snippetOf = (m) => {
  if (!m) return ''
  if (m.kind === 'asked') return `le preguntó a tu ${m.agent}: ${m.text}`
  return `${m.dir === 'out' ? 'Vos: ' : ''}${m.text}`
}
const quoteText = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 120 ? `${x.slice(0, 119)}…` : x }

// La conversación abierta: con un agente o con una persona.
const activeIsAgent = computed(() => !!chat.active?.person.agent)
const activeOwner = computed(() => chat.active?.person.owner || null)
const activeOwnerIsMe = computed(() => (activeOwner.value?.email || '').toLowerCase() === chat.meKey)
const activeTitle = computed(() => {
  const p = chat.active?.person
  if (!p) return 'chat'
  if (p.agent) return p.agentName || p.name
  return p.name || p.email
})
const activeOnline = computed(() => {
  const p = chat.active?.person
  if (!p) return false
  if (p.tool) return false
  return chat.onlineKeys.has((p.agent ? p.owner?.email : p.email || '').toLowerCase())
})
const activeSubtitle = computed(() => {
  const p = chat.active?.person
  if (!p) return ''
  if (p.tool) return `del equipo · ${p.detail}`
  if (p.agent) {
    const whose = activeOwnerIsMe.value ? 'tu agente' : `agente de ${firstName(p.owner)}`
    return [whose, p.detail].filter(Boolean).join(' · ')
  }
  return `${activeOnline.value ? 'conectado' : 'desconectado'} · ${handle(p)}`
})

/* Los mensajes de la conversación abierta, con un separador por día. Los seguidos del mismo lado y a pocos
   minutos se agrupan (`cont`). Cada respuesta trae su cita, salvo la de un agente justo después de su pregunta. */
const GROUP_MS = 3 * 60_000
const thread = computed(() => {
  const out = []
  let day = ''
  let prev = null
  for (const m of chat.active?.messages || []) {
    const d = dayOf(m.time)
    if (d !== day) { day = d; out.push({ kind: 'day', id: `day-${d}`, label: dayLabel(m.time) }); prev = null }
    const cont = !!prev && prev.dir === m.dir && prev.kind === m.kind && m.kind !== 'asked'
      && new Date(m.time) - new Date(prev.time) < GROUP_MS
    let quote = null
    if (m.re && !(chat.active.person.agent && m.re === prev?.sid)) {
      const found = chat.findBySid(m.re)
      quote = found
        ? { who: found.message.dir === 'out' ? 'Vos' : firstName(found.conversation.person.agent ? { name: found.conversation.person.agentName } : found.conversation.person), text: quoteText(found.message.text) }
        : { who: '', text: 'un mensaje que ya no está en este navegador' }
    }
    out.push({ ...m, kind: m.kind || 'message', cont, quote })
    prev = m
  }
  return out
})

// Quién está conectado y todavía no tiene conversación (sin contarme a mí).
const onlineWithoutChat = computed(() => chat.online.filter((p) => {
  const key = (p.email || '').toLowerCase()
  return key !== chat.meKey && !chat.conversations[key]
}))

// ── responder a un mensaje: «Responder» en la burbuja, y el campo muestra a qué se contesta ──
const replyTo = ref(null)
const canReply = (item) => !activeIsAgent.value && !agentAnswers.value && item.kind === 'message' && !!item.sid
function startReply(item) {
  replyTo.value = { sid: item.sid, who: item.dir === 'out' ? 'Vos' : firstName(chat.active.person), text: quoteText(item.text) }
  composer.value?.focus()
}

// ── el campo para escribir: Enter manda, Shift+Enter baja de renglón, Esc deja de responder ──
const draft = ref('')
const composer = ref(null)
const threadEl = ref(null)
async function submit() {
  if (agentAnswers.value) return
  const text = draft.value.trim()
  if (activeIsCuadrilla.value) return submitCuadrilla(text)
  if (!text) return
  const re = replyTo.value?.sid || ''
  draft.value = ''
  replyTo.value = null
  await nextTick(); autosize()
  await chat.send(text, re)
}
function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
  if (e.key === 'Escape' && replyTo.value) { e.preventDefault(); replyTo.value = null }
  if (e.key === 'Escape' && taskTarget.value) { e.preventDefault(); taskTarget.value = null }
}

/* ── CUADRILLA: lo que se escribe va a UNA tarea, la que se eligió arriba con «Anotar», «Bloquear» o «Destrabar».
   Un bloqueo pide además de quién depende. Sin tarea elegida no se escribe: no hay a dónde mandarlo. */
const activeIsCuadrilla = computed(() => chat.active?.person.tool === 'cuadrilla')
const taskTarget = ref(null)   // { task, kind: 'avance' | 'bloqueo' | 'desbloqueo' }
const blockOwner = ref('')
const KIND_LABEL = { avance: 'Anotando en', bloqueo: 'Bloqueo en', desbloqueo: 'Destrabando' }
const NOTE_LABEL = { avance: 'avance', bloqueo: 'bloqueo', desbloqueo: 'desbloqueo', hecha: 'hecha' }
function startTask(task, kind) {
  taskTarget.value = { task, kind }
  blockOwner.value = ''
  composer.value?.focus()
}
/* Con tu agente prendido, en tus conversaciones con personas contesta él: el campo se apaga hasta que lo apagues. Con
   canon, cuadrilla y los agentes del equipo seguís escribiendo: ahí preguntás vos. */
const agentAnswers = computed(() => mine.agent.mode === 'agente' && !!chat.active && !chat.active.person.agent)
const canSubmit = computed(() => {
  if (agentAnswers.value) return false
  if (!activeIsCuadrilla.value) return !!draft.value.trim()
  const t = taskTarget.value
  if (!t) return false
  if (t.kind === 'desbloqueo') return true
  if (t.kind === 'bloqueo' && !blockOwner.value.trim()) return false
  return !!draft.value.trim()
})
async function submitCuadrilla(text) {
  if (!canSubmit.value) return
  const { task, kind } = taskTarget.value
  const owner = blockOwner.value.trim().replace(/^@/, '')
  draft.value = ''; taskTarget.value = null; blockOwner.value = ''
  await nextTick(); autosize()
  await chat.noteTask(task, kind, text, owner)
}
async function markDone(task) {
  if (!confirm(`¿Marcar hecha «${task.titulo}»?`)) return
  await chat.doneTask(task)
}
const taskState = (t) => (t.bloqueo ? 'bloqueada' : t.hecha ? 'hecha' : 'curso')
const taskStateLabel = (t) => (t.bloqueo ? `bloqueada · depende de ${t.bloqueo.depende_de}` : t.hecha ? 'hecha' : 'en curso')
watch(() => chat.activeKey, () => { taskTarget.value = null; if (activeIsCuadrilla.value) chat.loadCuadrilla() })
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
watch(() => chat.activeKey, async () => { draft.value = ''; replyTo.value = null; await nextTick(); composer.value?.focus() })
const activeIsCanon = computed(() => chat.active?.person.tool === 'canon')
const placeholder = computed(() => {
  if (agentAnswers.value) return `Contesta ${agentLabel.value}: apagalo para escribir vos`
  if (activeIsCuadrilla.value) {
    const t = taskTarget.value
    if (!t) return 'Elegí una tarea de arriba para anotar en ella'
    if (t.kind === 'bloqueo') return 'Qué falta'
    if (t.kind === 'desbloqueo') return 'Qué lo destrabó (opcional)'
    return 'Qué pasó, en una línea'
  }
  if (!activeIsAgent.value) return 'Escribí un mensaje'
  if (activeIsCanon.value) return 'Preguntale a canon cómo funciona algo de CreditOp'
  return activeOwnerIsMe.value ? `Preguntale a tu agente ${activeTitle.value}` : `Preguntale a ${activeTitle.value} de ${firstName(activeOwner.value)}`
})

// La pregunta que canon sugiere para seguir: un clic la hace.
async function askNext(text) {
  await chat.send(text)
}

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
  if (chat.stateError) return 'sin la API de chat'
  if (!s) return 'preguntando al CLI…'
  if (!s.installed) return 'falta el CLI playground'
  if (!s.session) return 'sin sesión'
  if (!s.listening) return 'no estás escuchando'
  return s.connected ? 'escuchando' : 'reconectando'
})
</script>

<template>
  <div class="workbench" :style="layoutVars">
    <aside v-show="sidebarShown" class="sidebar en-bloques" aria-label="Conversaciones">
      <!-- DOS BLOQUES (`en-bloques` de la base): tus conversaciones y los agentes del equipo. Con «Paneles», cada uno es un
           panel sobre el lienzo, como en canon. -->
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="wb-bloque bloque-conversaciones">
      <div class="region-head">
        <span>Conversaciones</span>
        <span v-if="chat.unreadTotal" class="count filtered" :title="`${chat.unreadTotal} sin leer`">{{ chat.unreadTotal }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Actualizar" aria-label="Actualizar"
                  @click="chat.loadState(); chat.loadOnline(); chat.loadTeamAgents()">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <ul class="conversations">
          <li>
            <button type="button" class="conversation" :class="{ on: !chat.activeKey }" @click="openMyChat">
              <span class="avatar" aria-hidden="true"><img v-if="myPhoto" class="avatar-photo" :src="myPhoto" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(chat.me || chat.state?.session) }}</template></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">Mi chat</b></span>
                <span class="conversation-bottom"><span class="snippet">todo lo que te escriben · {{ mine.agent.mode === 'agente' ? `contesta ${agentLabel}` : 'contestás vos' }}</span></span>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="!chat.list.length && !onlineWithoutChat.length" class="side-note">
          Todavía no hay conversaciones ni nadie más conectado. Cuando alguien abra <code>playground listen</code>, aparece acá.
        </p>
        <p v-if="chat.onlineError" class="side-note bad">{{ chat.onlineError }}</p>
        <!-- Una sola lista: las conversaciones y, abajo, quien está conectado y todavía no tiene una (el punto verde
             dice quién está). -->
        <ul v-if="chat.list.length || onlineWithoutChat.length" class="conversations">
          <li v-for="c in chat.list" :key="c.person.email" class="conv-item">
            <button type="button" class="conversation" :class="{ on: c.person.email === chat.activeKey }" @click="chat.open(c.person)">
              <span class="avatar" aria-hidden="true"><img v-if="photoOf(c.person)" class="avatar-photo" :src="photoOf(c.person)" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(c.person) }}</template><i v-if="c.online" class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ c.person.name || c.person.email }}</b>
                  <span class="when">{{ shortWhen(c.last?.time) }}</span>
                </span>
                <span class="conversation-bottom">
                  <span class="snippet" :class="{ 'is-asked': c.last?.kind === 'asked' }">{{ snippetOf(c.last) || 'sin mensajes' }}</span>
                  <span v-if="c.unread" class="unread">{{ c.unread }}</span>
                </span>
              </span>
            </button>
            <button type="button" class="conv-del" title="Borrar conversación" aria-label="Borrar conversación"
                    @click.stop="deleteConversation(c)">✕</button>
          </li>
          <li v-for="p in onlineWithoutChat" :key="p.email">
            <button type="button" class="conversation" @click="chat.open(p)">
              <span class="avatar" aria-hidden="true"><img v-if="photoOf(p)" class="avatar-photo" :src="photoOf(p)" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(p) }}</template><i class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">{{ p.name || p.email }}</b></span>
                <span class="conversation-bottom"><span class="snippet">{{ handle(p) }} · escribile</span></span>
              </span>
            </button>
          </li>
        </ul>

      </div>
      </div>

      <!-- Los agentes del equipo: los de cada persona conectada (`playground agents`), los tuyos primero. -->
      <div class="wb-bloque bloque-agentes">
      <div class="region-head">
        <span>Agentes</span>
        <span class="count">{{ chat.agentList.length }}</span>
      </div>
      <div class="region-body">
        <p v-if="chat.teamAgentsError" class="side-note bad">{{ chat.teamAgentsError }}</p>
        <p v-else-if="!chat.agentList.length" class="side-note">
          Nadie tiene agentes conectados ahora. Los tuyos los anuncia <code>playground listen</code>: tu journal y los de
          <code>~/playground/team/agents.json</code>.
        </p>
        <ul v-else class="conversations">
          <li v-for="a in chat.agentList" :key="a.key">
            <button type="button" class="conversation" :class="{ on: a.key === chat.activeKey }" @click="chat.openAgent(a)">
              <span class="avatar agent" :class="{ mine: a.mine, tool: a.tool }" aria-hidden="true">{{ (a.agentName || '?')[0].toUpperCase() }}</span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ a.agentName }}</b>
                  <span class="owner">{{ a.tool ? 'del equipo' : a.mine ? 'tuyo' : firstName(a.owner) }}{{ a.offline ? ' · sin conexión' : '' }}</span>
                  <span class="when">{{ shortWhen(a.last?.time) }}</span>
                </span>
                <span class="conversation-bottom">
                  <span class="snippet">{{ a.last ? snippetOf(a.last) : a.description }}</span>
                  <span v-if="a.unread" class="unread">{{ a.unread }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head conversation-head">
        <template v-if="chat.active">
          <!-- Un solo primer hijo: la base le da a ese el ancho que sobra y lo recorta con «…». -->
          <span class="head-who">
            <span class="avatar small" :class="{ agent: activeIsAgent, mine: activeIsAgent && activeOwnerIsMe, tool: activeIsCanon }" aria-hidden="true">
              <img v-if="!activeIsAgent && photoOf(chat.active.person)" class="avatar-photo" :src="photoOf(chat.active.person)" alt="" referrerpolicy="no-referrer">
              <template v-else>{{ activeIsAgent ? (activeTitle || '?')[0].toUpperCase() : initials(chat.active.person) }}</template><i v-if="activeOnline" class="presence"></i>
            </span>
            <span class="head-title">{{ activeTitle }}</span>
            <span class="count head-sub">{{ activeSubtitle }}</span>
          </span>
          <div class="region-actions">
            <button v-if="!activeIsAgent" type="button" class="btn btn-ghost btn-sm" title="Esta cuenta eres tú: se une a «Mi chat»"
                    @click="chat.claimAsMe(chat.active.person)">Es mi cuenta</button>
            <button type="button" class="region-action" title="Borrar esta conversación de este navegador"
                    aria-label="Borrar esta conversación de este navegador" @click="forgetActive">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <span v-else>Mi chat</span>
      </div>

      <!-- Avisos que cambian lo que se puede hacer: van dentro del editor, no como banner global. -->
      <div v-if="chat.stateError" class="notice bad">{{ chat.stateError }}</div>
      <div v-else-if="chat.state && !chat.state.installed" class="notice">
        Falta el CLI <code>playground</code>: <code>curl -fsSL https://playground.creditop.com/cli/install | sh</code> y después <code>playground login</code>.
      </div>
      <!-- Sin sesión (dura 12 horas) no se manda ni se escucha: se entra desde acá, con el navegador de esta máquina. -->
      <div v-else-if="chat.state && !chat.state.session" class="notice">
        <template v-if="chat.state.login?.running || chat.loginBusy">
          <span>Elegí tu cuenta de Google de CreditOp en el navegador que se abrió.</span>
          <a v-if="chat.state.login?.url" :href="chat.state.login.url" target="_blank" rel="noopener">Si no se abrió, abrilo acá</a>
        </template>
        <template v-else>
          <span>{{ chat.state.listening ? 'Tu sesión del playground venció.' : 'No entraste al playground, o tu sesión venció (dura 12 horas).' }}</span>
          <button type="button" class="btn btn-sm" @click="chat.login()">Entrar</button>
        </template>
        <span v-if="chat.loginError" class="bad">{{ chat.loginError }}</span>
      </div>
      <div v-else-if="chat.state && !listening" class="notice">
        <span>No estás escuchando: lo que te escriban no llega. Mandar sí funciona.</span>
        <button type="button" class="btn btn-sm" :disabled="chat.listenBusy" @click="chat.startListening()">
          {{ chat.listenBusy ? 'Prendiendo…' : 'Empezar a escuchar' }}
        </button>
        <span v-if="chat.listenError" class="bad">{{ chat.listenError }}</span>
      </div>

      <!-- MI CHAT: sin conversación abierta, el editor es tu bandeja. Vos y tu agente usan el mismo chat: lo que te
           escriben llega acá, y con tu agente prendido cada mensaje trae su propuesta de respuesta. -->
      <div v-if="!chat.active" class="region-body my-chat">

        <p v-if="!chat.inbox.length" class="side-note center">
          Todavía no te escribió nadie. Lo que te escriban llega acá, de cualquier conversación.
        </p>
        <ol v-else class="inbox">
          <li v-for="item in chat.inbox" :key="item.key" class="inbox-item" :class="{ answered: item.answered }">
            <span class="avatar" aria-hidden="true"><img v-if="photoOf(item.person)" class="avatar-photo" :src="photoOf(item.person)" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(item.person) }}</template></span>
            <div class="inbox-body">
              <span class="inbox-top">
                <button type="button" class="btn-link inbox-name" @click="chat.open(item.person)">{{ item.person.name || item.person.email }}</button>
                <span v-if="item.kind === 'asked'" class="inbox-tag">le preguntó a tu agente {{ item.agent }}</span>
                <span class="when">{{ shortWhen(item.time) === clock(item.time) ? clock(item.time) : `${shortWhen(item.time)} · ${clock(item.time)}` }}</span>
              </span>
              <p class="text">{{ item.text }}</p>
              <div v-if="item.proposal && item.proposal.status !== 'descartada' && !item.answered" class="proposal-inline">
                <img v-if="mine.agent.avatar" class="proposal-avatar" :src="mine.agent.avatar" alt="">
                <div class="proposal-body">
                  <span class="proposal-label"><b>{{ agentLabel }}</b> contestaría · no se mandó</span>
                  <p class="text">{{ item.proposal.text }}</p>
                  <span class="proposal-actions">
                    <button type="button" class="btn btn-sm" @click="chat.sendProposal(item.proposal.id)">Mandar</button>
                    <button type="button" class="btn btn-ghost btn-sm" @click="chat.discardProposal(item.proposal.id)">Descartar</button>
                  </span>
                </div>
              </div>
              <span class="inbox-actions">
                <span v-if="item.answered" class="inbox-done">✓ contestado</span>
                <button v-else-if="item.kind !== 'asked' && mine.agent.mode !== 'agente'" type="button" class="btn btn-outline btn-sm" @click="replyFromInbox(item)">{{ item.proposal && item.proposal.status !== 'descartada' ? 'Responder yo' : 'Responder' }}</button>
              </span>
            </div>
          </li>
        </ol>
      </div>

      <!-- En tu chat no hay a quién escribirle (serías vos mismo): el campo está, pero apagado. -->
      <form v-if="!chat.active" class="composer" @submit.prevent>
        <div class="composer-row">
          <label class="sr-only" for="composer-mine">Tu chat</label>
          <textarea id="composer-mine" class="input composer-text" rows="1" disabled
                    placeholder="En tu chat no te escribís a vos mismo"></textarea>
          <button type="submit" class="btn" disabled>Mandar</button>
        </div>
      </form>

      <template v-else>
        <div ref="threadEl" class="region-body thread" aria-live="polite">
          <!-- TUS TAREAS de cuadrilla, arriba del hilo: cada una con lo que se puede hacer con ella. -->
          <section v-if="activeIsCuadrilla" class="tasks" aria-label="Tus tareas">
            <div class="tasks-head">
              <b>Tus tareas</b>
              <span v-if="chat.cuadrillaError" class="bad">{{ chat.cuadrillaError }}</span>
              <span v-else-if="!chat.cuadrilla" class="side-note">leyendo cuadrilla…</span>
            </div>
            <p v-if="chat.cuadrilla && !chat.myTasks.length" class="side-note">No llevás ninguna tarea en cuadrilla.</p>
            <ul v-else class="task-list">
              <li v-for="t in chat.myTasks" :key="t.codigo || t.id" class="task" :class="[taskState(t), { on: taskTarget?.task === t }]">
                <i class="task-dot" aria-hidden="true"></i>
                <span class="task-main">
                  <span class="task-title">{{ t.titulo }}</span>
                  <span class="task-meta">{{ t.epica.nombre }} · {{ taskStateLabel(t) }}<template v-if="t.ultima"> · {{ t.ultima.autor }}: {{ t.ultima.texto }}</template></span>
                </span>
                <span class="task-actions">
                  <button type="button" class="btn btn-outline btn-sm" @click="startTask(t, 'avance')">Anotar</button>
                  <template v-if="!t.hecha">
                    <button v-if="!t.bloqueo" type="button" class="btn btn-outline btn-sm" @click="startTask(t, 'bloqueo')">Bloquear</button>
                    <button v-else type="button" class="btn btn-outline btn-sm" @click="startTask(t, 'desbloqueo')">Destrabar</button>
                    <button type="button" class="btn btn-outline btn-sm" @click="markDone(t)">Hecha</button>
                  </template>
                  <a v-if="chat.taskUrl(t)" class="region-action" :href="chat.taskUrl(t)" target="_blank" rel="noopener"
                     title="Abrirla en cuadrilla" aria-label="Abrirla en cuadrilla"><span class="ui-icon" data-icon="external" aria-hidden="true"></span></a>
                </span>
              </li>
            </ul>
          </section>
          <p v-if="!thread.length" class="side-note center">
            <template v-if="activeIsCuadrilla">Acá llega lo que los demás anotan en tus tareas y los bloqueos que dependen de vos.</template>
            <template v-else-if="activeIsCanon">Preguntale cómo funciona algo de CreditOp: contesta con el corpus del equipo y cita de dónde. Cada pregunta va sola, sin las anteriores.</template>
            <template v-else-if="activeIsAgent">Preguntale lo que quieras: contesta {{ activeOwnerIsMe ? 'desde tu máquina' : `desde la máquina de ${firstName(activeOwner)}` }}.</template>
            <template v-else>Todavía no hay mensajes con {{ chat.active.person.name || chat.active.person.email }}.</template>
          </p>
          <template v-for="item in thread" :key="item.id">
            <div v-if="item.kind === 'day'" class="day"><span>{{ item.label }}</span></div>

            <!-- Alguien le preguntó a uno de tus agentes: tu listen ya le contestó. -->
            <div v-else-if="item.kind === 'asked'" class="asked">
              <span class="asked-label">Le preguntó a tu agente <b>{{ item.agent }}</b> · {{ clock(item.time) }}</span>
              <span class="asked-text">{{ item.text }}</span>
            </div>

            <!-- Lo que tu agente contestaría: no salió. «Mandar» lo manda a tu nombre; «Descartar» lo tira. -->
            <div v-else-if="item.kind === 'propuesta'" class="proposal" :class="{ discarded: item.status === 'descartada' }">
              <img v-if="mine.agent.avatar" class="proposal-avatar" :src="mine.agent.avatar" alt="">
              <div class="proposal-body">
                <span class="proposal-label">
                  <b>{{ agentLabel }}</b> contestaría · {{ item.status === 'descartada' ? 'descartada' : 'no se mandó' }}
                </span>
                <p class="text">{{ item.text }}</p>
                <span v-if="item.status !== 'descartada'" class="proposal-actions">
                  <button type="button" class="btn btn-sm" @click="chat.sendProposal(item.id)">Mandar</button>
                  <button type="button" class="btn btn-ghost btn-sm" @click="chat.discardProposal(item.id)">Descartar</button>
                </span>
              </div>
            </div>

            <div v-else class="bubble-row" :class="[item.dir, { cont: item.cont }]">
              <div class="bubble" :class="{ failed: item.status === 'error' }">
                <span v-if="item.kind === 'publish' && !item.cont" class="published-label">publicó</span>
                <span v-if="item.cuadrilla" class="task-note-label">
                  <template v-if="item.dir === 'in'"><b>{{ item.cuadrilla.autor }}</b> · </template>{{ NOTE_LABEL[item.cuadrilla.tipo] || item.cuadrilla.tipo }}
                  en «{{ item.cuadrilla.tarea }}»<template v-if="item.cuadrilla.dependeDe"> · depende de {{ item.cuadrilla.dependeDe }}</template>
                </span>
                <span v-if="item.quote" class="quote">
                  <b v-if="item.quote.who">{{ item.quote.who }}</b>
                  <span>{{ item.quote.text }}</span>
                </span>
                <pre v-if="item.format === 'json'" class="text json">{{ item.text }}</pre>
                <template v-else>
                  <p v-if="item.summary" class="summary">{{ item.summary }}</p>
                  <p class="text">{{ item.text }}</p>
                </template>
                <p v-if="item.backed === false" class="unbacked">El corpus no la respalda del todo: tomala como pista, no como regla.</p>
                <ul v-if="item.sources?.length" class="sources" aria-label="Fuentes">
                  <li v-for="src in item.sources" :key="src.read" :title="`playground canon read ${src.read}`">{{ src.title }}</li>
                </ul>
                <button v-if="item.next" type="button" class="next-question" @click="askNext(item.next)">{{ item.next }}</button>
                <span class="meta">
                  {{ clock(item.time) }}<template v-if="item.queued"> · llegó mientras no estabas</template>
                  <template v-if="item.dir === 'out'">
                    <span v-if="item.status === 'sending'">· {{ activeIsCuadrilla ? 'anotando…' : activeIsCanon ? 'canon está pensando…' : activeIsAgent ? 'preguntando…' : 'mandando…' }}</span>
                    <span v-else-if="item.status === 'pending'" title="El agente tarda: la respuesta llega acá cuando conteste">· esperando respuesta</span>
                    <span v-else-if="item.status === 'sent' || item.status === 'answered'" :title="activeIsAgent ? 'Contestó' : 'Entregado a sus terminales abiertas'">· ✓</span>
                  </template>
                </span>
                <p v-if="item.status === 'error'" class="error">
                  No salió: {{ item.error }}
                  <button v-if="!item.cuadrilla" type="button" class="btn-link" @click="chat.retry(item.id)">reintentar</button>
                </p>
              </div>
              <button v-if="canReply(item)" type="button" class="reply-action" title="Responder a este mensaje"
                      aria-label="Responder a este mensaje" @click="startReply(item)">
                <span class="ui-icon" data-icon="comment" aria-hidden="true"></span>
              </button>
            </div>
          </template>
        </div>
        <form class="composer" @submit.prevent="submit">
          <div v-if="agentAnswers" class="agent-answers">
            <img v-if="mine.agent.avatar" :src="mine.agent.avatar" alt="">
            <span>En esta conversación contesta <b>{{ agentLabel }}</b>: sus respuestas te quedan listas para mandar.</span>
            <button type="button" class="btn btn-outline btn-sm" @click="mine.setMode('yo')">Contesto yo</button>
          </div>
          <div v-if="activeIsCuadrilla && taskTarget" class="replying">
            <span class="quote">
              <b>{{ KIND_LABEL[taskTarget.kind] }}</b>
              <span>{{ taskTarget.task.titulo }}</span>
            </span>
            <input v-if="taskTarget.kind === 'bloqueo'" v-model="blockOwner" class="input input-sm block-owner"
                   placeholder="de quién depende: @persona" aria-label="De quién depende" />
            <button type="button" class="region-action" title="No anotar en esa tarea" aria-label="No anotar en esa tarea"
                    @click="taskTarget = null">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
          <div v-if="replyTo" class="replying">
            <span class="quote">
              <b>Respondiendo a {{ replyTo.who === 'Vos' ? 'tu mensaje' : replyTo.who }}</b>
              <span>{{ replyTo.text }}</span>
            </span>
            <button type="button" class="region-action" title="No responder a ese mensaje" aria-label="No responder a ese mensaje"
                    @click="replyTo = null">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
          <div class="composer-row">
            <label class="sr-only" for="composer-text">{{ placeholder }}</label>
            <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1" :disabled="agentAnswers"
                      maxlength="2000" :placeholder="placeholder" @keydown="onKeydown" @input="autosize"></textarea>
            <button type="submit" class="btn" :disabled="!canSubmit">{{ activeIsCuadrilla ? 'Anotar' : activeIsAgent ? 'Preguntar' : 'Mandar' }}</button>
          </div>
        </form>
      </template>
    </main>

    <!-- ── tu agente: la región de la derecha ─────────────────────────────────────────── -->
    <aside v-show="agentShown" class="auxiliarybar" aria-label="Mi agente">
      <div class="rsz rsz-edge-left" v-resize="agentResize"></div>
      <div class="region-head">
        <span>Mi agente <small class="agent-state">{{ mine.agent.mode === 'agente' ? 'activo' : 'apagado' }}</small></span>
        <div class="region-actions">
          <!-- Prenderlo o apagarlo: con el agente apagado contestás vos, y el muñeco queda en blanco y negro. -->
          <button type="button" class="switch" role="switch" :aria-checked="mine.agent.mode === 'agente'" @click="toggleMode"
                  :title="mine.agent.mode === 'agente' ? `Apagar a ${agentLabel}: contestás vos` : `Prender a ${agentLabel}: contesta por vos`"
                  :aria-label="mine.agent.mode === 'agente' ? `Apagar a ${agentLabel}` : `Prender a ${agentLabel}`"></button>
          <button type="button" class="region-action" title="Ocultar tu agente" aria-label="Ocultar tu agente" @click="setAgentOpen(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <MyAgent v-if="agentShown" class="region-body" />
    </aside>

    <footer class="statusbar">
      <span class="statusbar-item">
        <i class="status-dot" :class="{ on: listening && chat.state?.connected }" aria-hidden="true"></i>
        {{ statusText }}<template v-if="chat.me || chat.state?.session"> ·
          <img v-if="myPhoto" class="me-photo" :src="myPhoto" alt="" referrerpolicy="no-referrer">
          {{ (chat.me || chat.state.session).email }}</template>
      </span>
      <span v-if="chat.state?.since && listening" class="statusbar-item">desde las {{ clock(chat.state.since) }}</span>
      <span v-if="chat.agentList.some((a) => a.mine)" class="statusbar-item">
        tus agentes: {{ chat.agentList.filter((a) => a.mine).map((a) => a.agentName).join(', ') }}
      </span>
      <!-- Quién contesta: vos o tu agente. Siempre a la vista, para que no quede prendido sin querer. -->
      <button type="button" class="statusbar-item mode-toggle" :class="{ on: mine.agent.mode === 'agente' }" @click="toggleMode"
              :title="mine.agent.mode === 'agente' ? `Contesta ${agentLabel}: tocá para contestar vos` : `Contestás vos: tocá para que conteste ${agentLabel}`">
        <img v-if="mine.agent.avatar" class="mode-avatar" :src="mine.agent.avatar" alt="">
        {{ mine.agent.mode === 'agente' ? `contesta ${agentLabel}` : 'contesto yo' }}
      </button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!sidebarShown" title="Mostrar u ocultar las conversaciones"
                aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <button v-if="!chat.activeKey" type="button" class="region-action" :aria-pressed="!!agentShown" title="Mostrar u ocultar tu agente"
                aria-label="Mostrar u ocultar tu agente" @click="setAgentOpen(!agentShown)">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
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
.conv-item { position: relative }
.conv-del { position: absolute; top: 6px; right: 6px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; background: var(--muted);
  color: var(--fg-2); font-size: 11px; cursor: pointer; opacity: 0; transition: opacity .12s }
.conv-item:hover .conv-del, .conv-del:focus-visible { opacity: 1 }
.conv-del:hover { color: var(--task-blocked) }
.conversations { list-style: none; margin: 0; padding: var(--space-1) 0 }
.conversation { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px var(--gutter);
  border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit }
.conversation:hover { background: var(--hover) }
.conversation.on { background: var(--accent); color: var(--accent-foreground) }
.conversation:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.avatar { position: relative; flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
  background: var(--muted); color: var(--foreground); font-size: var(--text-sm); font-weight: 600 }
.avatar.small { width: 26px; height: 26px; font-size: var(--text-xs) }
/* Un agente es un cuadrado redondeado (no una persona); el tuyo, con el acento. */
.avatar.agent { border-radius: 8px; background: var(--agent-bg); color: var(--agent-ink) }
.avatar.agent.mine { background: var(--agent-mine-bg); color: var(--agent-mine-ink) }
.avatar.agent.tool { background: var(--canon-bg); color: var(--canon-ink) }
.presence { position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--presence-on); box-shadow: 0 0 0 2px var(--sidebar) }
.avatar.small .presence { width: 8px; height: 8px; box-shadow: 0 0 0 2px var(--background) }
.conversation-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px }
.conversation-top, .conversation-bottom { display: flex; align-items: baseline; gap: 8px; min-width: 0 }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600 }
.owner { flex: none; color: var(--fg-2); font-size: var(--text-xs) }
.when { flex: none; color: var(--fg-2); font-size: var(--text-xs); font-variant-numeric: tabular-nums }
.snippet { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: var(--text-sm) }
.snippet.is-asked { font-style: italic }
.unread { flex: none; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; display: grid; place-items: center;
  background: var(--primary); color: var(--primary-foreground); font-size: var(--text-xs); font-weight: 600 }

/* ── el editor: la conversación ── */
.editor { display: flex; flex-direction: column; min-height: 0 }
.head-who { display: flex; align-items: center; gap: 10px; padding-block: 4px }
.head-title { flex: none; font-weight: 600 }
.head-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis }
.notice { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: 8px var(--gutter);
  border-bottom: 1px solid var(--border); background: var(--muted); color: var(--fg-2); font-size: var(--text-sm) }
.thread { display: flex; flex-direction: column; gap: 8px; padding: var(--space-4) var(--space-6) }
.day { align-self: center; margin: var(--space-3) 0 var(--space-1); padding: 2px 10px; border-radius: 999px; background: var(--muted);
  color: var(--fg-2); font-size: var(--text-xs); text-transform: capitalize }

.bubble-row { display: flex; align-items: center; gap: 6px }
.bubble-row.out { flex-direction: row-reverse }
.bubble-row.cont { margin-top: -5px }
.bubble { max-width: min(560px, 78%); padding: 7px 10px 5px; border-radius: 12px; background: var(--bubble-theirs);
  color: var(--foreground); display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.bubble-row.in:not(.cont) .bubble { border-top-left-radius: 4px }
.bubble-row.out .bubble { background: var(--bubble-mine) }
.bubble-row.out:not(.cont) .bubble { border-top-right-radius: 4px }
.bubble.failed { box-shadow: inset 0 0 0 1px var(--send-fail) }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.45 }
.meta { align-self: flex-end; color: var(--fg-2); font-size: var(--text-xs); font-variant-numeric: tabular-nums }
.error { margin: 2px 0 0; color: var(--send-fail); font-size: var(--text-sm) }
.btn-link { border: 0; padding: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit }

/* MI CHAT: tu bandeja, cada mensaje con su respuesta o la de tu agente. Quién contesta se elige en tu agente (derecha) y en el pie. */
.my-chat { padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4) }
.inbox { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3) }
.inbox-item { display: flex; gap: var(--space-3); align-items: flex-start }
.inbox-item.answered .inbox-body > .text { color: var(--fg-2) }
.inbox-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px }
.inbox-top { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap }
.inbox-name { font-weight: 600; text-decoration: none }
.inbox-name:hover { text-decoration: underline }
.inbox-tag, .inbox-top .when { font-size: var(--text-xs); color: var(--fg-2) }
.inbox-body > .text { margin: 0; white-space: pre-wrap }
.proposal-inline { display: flex; gap: var(--space-2); margin-top: 2px }
.inbox-actions { display: flex; gap: var(--space-2); align-items: center }
.inbox-done { font-size: var(--text-xs); color: var(--fg-2) }

/* La foto de Google ocupa el círculo entero del avatar; el punto verde sigue encima. */
.avatar-photo { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; display: block }
.me-photo { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: -3px }

/* MI AGENTE: su avatar es la foto del muñeco; sus propuestas, una burbuja punteada con «Mandar» y «Descartar». */
.avatar-img { object-fit: cover; background: var(--office-bg); border-radius: 8px }
.proposal { display: flex; gap: var(--space-2); align-self: flex-end; max-width: min(560px, 85%); margin: 2px 0 var(--space-2) }
.proposal.discarded { opacity: .55 }
.proposal-avatar { flex: none; width: 28px; height: 28px; border-radius: 8px; object-fit: cover; background: var(--office-bg) }
.proposal-body { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 12px;
  border: 1px dashed var(--office-accent); background: color-mix(in oklab, var(--office-accent) 8%, var(--background)) }
.proposal-label { font-size: var(--text-xs); color: var(--fg-2) }
.proposal-actions { display: flex; gap: var(--space-1); margin-top: 2px }
/* Los dos bloques del costado: las conversaciones se llevan el alto que sobra; los agentes, lo suyo y no más de la
   mitad. Cada uno scrollea su cuerpo. */
.bloque-conversaciones { flex: 1 1 auto }
.bloque-agentes { flex: 0 1 auto; max-height: 45% }

.mode-toggle { border: 0; background: none; font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px }
.mode-toggle.on { color: var(--office-accent); font-weight: 600 }
.mode-avatar { width: 16px; height: 16px; border-radius: 4px; object-fit: cover; background: var(--office-bg) }
/* Apagado, tu agente se ve en blanco y negro donde aparezca. */
.mode-toggle:not(.on) .mode-avatar { filter: grayscale(1) }
.agent-state { font-weight: 400; color: var(--fg-2); margin-left: 4px }
.agent-answers { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--fg-2) }
.agent-answers img { width: 22px; height: 22px; border-radius: 6px; object-fit: cover; flex: none }
.agent-answers span { flex: 1; min-width: 0 }

/* CUADRILLA: tus tareas arriba del hilo, con su estado en un punto y sus acciones; y la etiqueta de cada nota. */
.tasks { display: flex; flex-direction: column; gap: var(--space-2); padding-bottom: var(--space-3); margin-bottom: var(--space-2);
  border-bottom: 1px solid var(--border) }
.tasks-head { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm) }
.task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px }
.task { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2); border-radius: var(--radius-control) }
.task:hover, .task.on { background: var(--hover) }
.task-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.task.bloqueada .task-dot { background: var(--task-blocked) }
.task.hecha .task-dot { background: var(--task-done) }
.task.hecha .task-title { color: var(--fg-3) }
.task-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px }
.task-title { font-size: var(--text-base); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.task-meta { font-size: var(--text-xs); color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.task.bloqueada .task-meta { color: var(--task-blocked) }
.task-actions { flex: none; display: flex; align-items: center; gap: var(--space-1) }
.task-note-label { font-size: var(--text-xs); color: var(--fg-2) }
.block-owner { flex: 0 1 220px; min-width: 0 }

/* La respuesta de canon: el resumen arriba, las fuentes abajo y la pregunta para seguir. */
.summary { margin: 0; font-weight: 600; font-size: 14px; line-height: 1.4 }
.unbacked { margin: 0; color: var(--fg-2); font-size: var(--text-xs); font-style: italic }
.sources { list-style: none; margin: 4px 0 0; padding: 6px 0 0; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px;
  font-size: var(--text-xs); color: var(--fg-2) }
.sources li::before { content: "↳ "; color: var(--quote-rule) }
.next-question { align-self: flex-start; margin-top: 4px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px;
  background: transparent; color: var(--foreground); font: inherit; font-size: var(--text-xs); text-align: left; cursor: pointer }
.next-question:hover { background: var(--hover) }
.next-question:focus-visible { outline: 2px solid var(--ring) }

/* La cita del mensaje al que se contesta: en la burbuja y sobre el campo de escribir. */
.quote { display: flex; flex-direction: column; gap: 1px; padding: 4px 8px; border-left: 3px solid var(--quote-rule);
  border-radius: 4px; background: var(--quote-bg); font-size: var(--text-sm); color: var(--fg-2); min-width: 0 }
.quote b { color: var(--foreground); font-weight: 600; font-size: var(--text-xs) }
.quote span { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical }

/* «Responder»: aparece al pasar por la burbuja o al llegarle con el teclado. */
.reply-action { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border: 0; border-radius: 50%;
  background: transparent; color: var(--fg-2); cursor: pointer; opacity: 0 }
.bubble-row:hover .reply-action, .reply-action:focus-visible { opacity: 1 }
.reply-action:hover { background: var(--hover); color: var(--foreground) }
.reply-action:focus-visible { outline: 2px solid var(--ring) }
@media (hover: none) { .reply-action { opacity: 1 } }

/* Lo que alguien le preguntó a tu agente: una nota en el hilo, no una burbuja. */
.asked { align-self: center; max-width: min(520px, 90%); display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 6px 12px; border: 1px dashed var(--border); border-radius: 10px; color: var(--fg-2); text-align: center }
.asked-label { font-size: var(--text-xs) }
.asked-label b { color: var(--foreground) }
.asked-text { font-size: var(--text-sm); overflow-wrap: anywhere }

/* Lo que publicó un agente al que estás anotado: una burbuja ajena con su etiqueta arriba. */
.published-label { font-size: var(--text-xs); font-weight: 600; color: var(--quote-rule) }

.composer { flex: none; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--border) }
.replying { display: flex; align-items: center; gap: var(--space-2) }
.replying .quote { flex: 1 }
.composer-row { display: flex; align-items: flex-end; gap: var(--space-2) }
.composer-text { height: auto; min-height: var(--control-md); max-height: 160px; padding-block: 7px; resize: none; line-height: 1.4;
  font: inherit; font-size: 14px; border-radius: 18px; padding-inline: 14px }

.json { font-family: var(--font-mono); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-x: auto; margin: 0;
  max-height: 420px; overflow-y: auto }
.bubble-row.in .bubble:has(.json) { max-width: min(720px, 92%) }

/* ── el pie ── */
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3); margin-right: 6px }
.status-dot.on { background: var(--presence-on) }
</style>
