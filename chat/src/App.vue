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
import { useChatStore, isImage, IMAGE_AUTO_MAX } from './stores/chat.js'
import { MODELS, useMyAgentStore } from './stores/myAgent.js'
import MyAgent from './MyAgent.vue'
import ServerPanel from './ServerPanel.vue'
import { renderMarkdown } from './markdown.js'
import ServicePanel from './ServicePanel.vue'
import ServiceSide from './ServiceSide.vue'
import { forget as forgetHistory, historyFor, pick as pickHistory } from './stores/service-history.js'
import {
  vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle, bindPanelMaximize, readHashRoute, hashRoute, setRoute,
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
// Tu @ en el chat del equipo: la parte del correo antes de la arroba, como te escriben (`playground send @miguel`).
const myHandle = computed(() => { const e = chat.state?.session?.email || chat.me?.email || ''; return e ? `@${e.split('@')[0]}` : '' })
function openMyChat() { serverOpen.value = ''; chat.activeKey = ''; setAgentOpen(true) }
/* LOS SERVERS (server/servers.go): lo que hay que tener prendido en esta máquina para que otra persona pruebe contra
   ella. Su estado se mira cada 15 s, y cada 2 s mientras se levanta; abierto, ocupa el editor. Abrir una
   conversación lo cierra. */
/* LAS VISTAS DEL SIDEBAR, como en canon y VS Code: cada bloque se pliega con su encabezado, las abiertas se reparten el
   alto y una cerrada ocupa una fila (no desaparece). Lo abierto se recuerda en este navegador; sin almacenamiento,
   arrancan todas abiertas. */
const SIDEBAR_VIEWS_KEY = 'chat.sidebar-views'
const sidebarViews = ref((() => { try { return JSON.parse(localStorage.getItem(SIDEBAR_VIEWS_KEY) || '{}') || {} } catch { return {} } })())
const isViewOpen = (id) => sidebarViews.value[id] ?? true
function toggleView(id) {
  sidebarViews.value = { ...sidebarViews.value, [id]: !isViewOpen(id) }
  try { localStorage.setItem(SIDEBAR_VIEWS_KEY, JSON.stringify(sidebarViews.value)) } catch { /* sólo no se recuerda */ }
}
const servers = ref([])
const serverOpen = ref('')
const openServer = computed(() => servers.value.find((s) => s.id === serverOpen.value) || null)
// Tus servicios del playground (server/services.go): se abren como `svc:<alias>` en el mismo lugar que un server.
const teamServices = ref({ services: [], serving: false, serveLog: '' })
const openService = computed(() => (serverOpen.value.startsWith('svc:')
  ? teamServices.value.services.find((s) => `svc:${s.alias}` === serverOpen.value) || null : null))
let serversTimer = null
async function loadServers() {
  clearTimeout(serversTimer)
  try {
    servers.value = (await (await fetch('/api/servers')).json()).servers || []
    teamServices.value = await (await fetch('/api/services')).json()
  } catch { /* el servidor del chat no contestó: se reintenta */ }
  serversTimer = setTimeout(loadServers, servers.value.some((s) => s.busy) ? 2000 : 15000)
}
watch(() => chat.activeKey, () => { serverOpen.value = ''; docView.value = null })
const agentLabel = computed(() => mine.agent.name || 'Mi agente')
/* LAS FOTOS DE GOOGLE: la de cada persona viene con ella (el home la manda en quién está conectado y en cada mensaje);
   la tuya, de tu sesión. Sin foto, las iniciales de siempre. Se piden sin «referer»: así las sirve Google. */
const myPhoto = computed(() => chat.state?.session?.picture || '')
const photoOf = (p) => {
  const email = String(p?.email || '').toLowerCase()
  if (email && email === chat.meKey) return myPhoto.value
  return p?.picture || chat.online.find((o) => String(o.email || '').toLowerCase() === email)?.picture || ''
}
function toggleMode() { mine.setMode(mine.agent.mode === 'agente' ? 'yo' : 'agente') }

// ── la ruta: #/c/<clave> es la conversación abierta (un correo, o `agent:<dueño>/<agente>`) ──
function routeKey() {
  const { parts } = readHashRoute()
  return parts[0] === 'c' && parts[1] ? parts[1].toLowerCase() : ''
}
function applyRoute() {
  // `#/server/<id>`: un server abierto en el editor.
  const { parts } = readHashRoute()
  if (parts[0] === 'server' && parts[1]) { serverOpen.value = parts[1]; return }
  serverOpen.value = ''
  // `#/mi-agente`, de cuando era una pantalla: abre la región de la derecha.
  if (readHashRoute().parts[0] === 'mi-agente') { setAgentOpen(true); chat.activeKey = ''; return }
  const key = routeKey()
  if (key && chat.conversations[key]) chat.open(chat.conversations[key].person)
  // Una conversación con un agente que este navegador no tiene no se inventa: se abre desde «Agentes».
  else if (key && !key.startsWith('agent:')) chat.open({ email: key, name: key.split('@')[0] })
  else chat.activeKey = ''
}
// Lo que se mira va en la URL: la conversación (`#/c/<clave>`) o el server abierto (`#/server/<id>`).
function writeRoute() {
  const target = serverOpen.value ? hashRoute(['server', serverOpen.value]) : chat.activeKey ? hashRoute(['c', chat.activeKey]) : ''
  if (target !== (location.hash || '')) setRoute(`${location.pathname}${location.search}${target}`, { push: true })
}
watch(() => chat.activeKey, writeRoute)
watch(serverOpen, writeRoute)

// ── las regiones: el sidebar a la izquierda, con el contrato de la base ──
const sidebarOpen = ref(readSize('chat.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('chat.sidebar-w', 300))
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
/* Con un server abierto no hay región derecha (lo que se le pasaba a otra persona era el túnel de Shopify, que se sacó
   el 2026-11-09): abajo aparece su consola, la salida de cada comando mientras corre. */
const consoleOpen = ref(readSize('chat.server-console-open', 1) !== 0)
const consoleH = ref(readSize('chat.server-console-h', 240))
/* Un servicio: sus rutas a la derecha (se cierran y se recuerdan aparte) y su historial abajo, en la consola, que es la
   misma de los servers. */
const routesOpen = ref(readSize('chat.service-routes-open', 1) !== 0)
function setRoutesOpen(v) { routesOpen.value = v; saveSize('chat.service-routes-open', v ? 1 : 0) }
const serviceHistory = computed(() => (openService.value ? historyFor(openService.value.alias) : []))
// La consola del servicio: el historial, su ficha (estado, direcciones, dónde se declara) y lo último de `playground serve`.
const SERVICE_TABS = [{ id: 'history', label: 'Historial' }, { id: 'info', label: 'Servicio' }, { id: 'serve', label: 'serve', title: 'Lo último de playground serve' }]
const serviceTab = ref((() => { try { return localStorage.getItem('chat.service-console-tab') || 'history' } catch { return 'history' } })())
function setServiceTab(id) { serviceTab.value = id; try { localStorage.setItem('chat.service-console-tab', id) } catch { /* sólo no se recuerda */ } }
const serveLines = computed(() => (teamServices.value.serveLog || '').split('\n').filter((l) => l.trim()))
const serviceUrlCopied = ref(false)
async function copyServiceUrl() {
  try { await navigator.clipboard.writeText(openService.value.url); serviceUrlCopied.value = true; setTimeout(() => { serviceUrlCopied.value = false }, 1500) } catch { /* sin portapapeles */ }
}
const historyTime = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) } catch { return '' } }
function setConsoleOpen(v) { consoleOpen.value = v; saveSize('chat.server-console-open', v ? 1 : 0) }
const rightOpen = computed(() => {
  if (docView.value) return true
  if (openService.value) return routesOpen.value
  if (serverOpen.value) return false
  if (activeOwnAgent.value) return ownPanelOpen.value
  return agentOpen.value && !chat.activeKey
})
// Si no entra todo, se pliega primero la derecha (tu agente) y después las conversaciones, como en VS Code.
const fitted = computed(() => fitRegions(viewportW.value - cssSize('--editor-min', 360), [
  { size: rightOpen.value ? agentW.value : 0, min: 320 },
  { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
]))
const agentShown = computed(() => fitted.value[0])
const sidebarShown = computed(() => fitted.value[1])
const panelShown = computed(() => fitRegions(viewportH.value - 200, [
  { size: serverOpen.value && consoleOpen.value ? consoleH.value : 0, min: cssSize('--panel-min', 124) },
])[0])
const layoutVars = computed(() => ({
  '--sidebar-w': `${sidebarShown.value}px`, '--auxiliarybar-w': `${agentShown.value}px`, '--panel-h': `${panelShown.value}px`,
}))
const consoleResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 240,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => panelShown.value,
  set: (v) => { if (!v) consoleOpen.value = false; else { consoleOpen.value = true; consoleH.value = v } },
  reopen: () => consoleH.value,
  commit: (v) => { saveSize('chat.server-console-open', v ? 1 : 0); if (v) saveSize('chat.server-console-h', consoleH.value) },
}
// La consola sigue a lo último que imprimió, salvo que hayas subido a leer algo.
const consoleBody = ref(null)
const consoleFollow = ref(true)
function onConsoleScroll() {
  const el = consoleBody.value
  if (el) consoleFollow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}
/* La consola en pestañas por paso de «Levantar»: cada línea es del paso que la abrió (las marcas que escribe
   server/servers.go). «Todo» muestra la corrida entera. */
const CONSOLE_TABS = [
  { id: 'all', label: 'Todo' },
]
const PHASE_MARKS = []
const consoleTab = ref('all')
const allConsoleLines = computed(() => {
  let phase = 'app'
  return (openServer.value?.log || []).map((l) => {
    const time = l.slice(0, 8)
    const text = l.slice(10)
    for (const [re, p] of PHASE_MARKS) if (re.test(text)) { phase = p; break }
    return { time, text, phase, command: text.startsWith('$ '), ok: text.startsWith('✓'), bad: text.startsWith('✗') }
  })
})
const consoleLines = computed(() => (consoleTab.value === 'all' ? allConsoleLines.value : allConsoleLines.value.filter((l) => l.phase === consoleTab.value)))
const phaseCount = (id) => (id === 'all' ? allConsoleLines.value.length : allConsoleLines.value.filter((l) => l.phase === id).length)
// Maximizar la consola (temporal, como en la base): el botón se ata cuando la consola aparece.
const consoleMax = ref(null)
let consoleMaxBinding = null
watch(consoleMax, (el) => { consoleMaxBinding?.destroy(); consoleMaxBinding = el ? bindPanelMaximize(el) : null })
watch(() => consoleLines.value.length, async () => {
  if (!consoleFollow.value) return
  await nextTick()
  if (consoleBody.value) consoleBody.value.scrollTop = consoleBody.value.scrollHeight
})
const agentResize = {
  label: 'Ancho de tu agente', sign: -1, defaultValue: 380,
  min: () => 320,
  max: () => viewportW.value - cssSize('--editor-min', 360) - sidebarShown.value,
  get: () => agentShown.value,
  set: (v) => {
    if (docView.value && !v) { closeDoc(); return }
    if (docView.value) { if (v) agentW.value = v; return }
    if (openService.value) routesOpen.value = !!v
    else if (serverOpen.value) { /* un server no tiene región derecha */ }
    else if (activeOwnAgent.value) ownPanelOpen.value = !!v
    else agentOpen.value = !!v
    if (v) agentW.value = v
  },
  reopen: () => agentW.value,
  commit: (v) => {
    saveSize(openService.value ? 'chat.service-routes-open' : serverOpen.value ? 'chat.server-share-open' : activeOwnAgent.value ? 'chat.own-agent-open' : 'chat.agente-open', v ? 1 : 0)
    if (v) saveSize('chat.agente-w', agentW.value)
  },
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
  // Un mensaje con adjuntos y sin texto se ve por sus adjuntos.
  const body = m.text || (m.files?.length ? m.files.map((f) => `📎 ${f.name}`).join(' · ') : '')
  return `${m.dir === 'out' ? 'Vos: ' : ''}${body}`
}
const quoteText = (t) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 120 ? `${x.slice(0, 119)}…` : x }

// La conversación abierta: con un agente o con una persona.
const activeIsAgent = computed(() => !!chat.active?.person.agent)
const activeOwner = computed(() => chat.active?.person.owner || null)
const activeOwnerIsMe = computed(() => (activeOwner.value?.email || '').toLowerCase() === chat.meKey)
/* UNO DE TUS AGENTES LOCALES abierto (time, fact): a la derecha, su ficha con el interruptor. Apagado no le contesta a
   nadie, ni al equipo ni a vos, y en la lista sale en gris. */
const activeOwnAgent = computed(() => (activeIsAgent.value && activeOwnerIsMe.value
  ? chat.ownAgents.find((a) => a.name === (chat.active.person.agentName || chat.active.person.name)) || null : null))
const ownPanelOpen = ref(readSize('chat.own-agent-open', 1) !== 0)
function setOwnPanelOpen(v) { ownPanelOpen.value = v; saveSize('chat.own-agent-open', v ? 1 : 0) }
const ownBusy = ref(false)
async function toggleOwnAgent() {
  const a = activeOwnAgent.value
  if (!a || ownBusy.value) return
  ownBusy.value = true
  try { await chat.setOwnAgent(a.name, !a.on) } finally { ownBusy.value = false }
}
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
  // Un grupo: quiénes están (las personas por su nombre corto; un agente como «rambo de duncan»).
  if (p.group) {
    const members = (chat.groups.find((g) => `#${g.id}` === p.email)?.members || p.members || [])
    const label = (m) => { const [email, agent] = m.split('/'); const who = email.split('@')[0]; return agent ? `${agent} de ${who}` : who }
    return members.length ? `${members.length} miembros · ${members.map(label).join(', ')}` : 'grupo'
  }
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
      && (prev.author?.email || '') === (m.author?.email || '') && (prev.via || '') === (m.via || '')
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
/* EL BORRADOR, uno por conversación, como en WhatsApp: lo que dejaste escrito en una vuelve cuando la abrís otra vez,
   aunque pases por otra, por un server o recargues. Vive en este navegador; al mandar se borra. */
const DRAFTS_KEY = 'chat.drafts'
const drafts = (() => { try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}') || {} } catch { return {} } })()
const draftKey = (key) => key || 'mi-chat'
const draft = ref(drafts[draftKey(chat.activeKey)] || '')
let saveDraftTimer = null
watch(draft, (text) => {
  const key = draftKey(chat.activeKey)
  if (text) drafts[key] = text
  else delete drafts[key]
  clearTimeout(saveDraftTimer)
  saveDraftTimer = setTimeout(() => { try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)) } catch { /* sólo no se recuerda */ } }, 300)
})
const composer = ref(null)
const threadEl = ref(null)
async function submit() {
  if (agentAnswers.value) return
  const text = draft.value.trim()
  // En «Mi chat» le escribís a tu agente: contesta él y no sale a nadie.
  if (!chat.active) {
    if (!text || myAgentThinking.value) return
    draft.value = ''
    await nextTick(); autosize()
    const asked = chat.askMyAgent(text)
    scrollNotesToEnd()
    await asked
    scrollNotesToEnd()
    return
  }
  if (activeIsCuadrilla.value) return submitCuadrilla(text)
  const files = canAttach.value ? attachments.value : []
  if (!text && !files.length) return
  const re = replyTo.value?.sid || ''
  draft.value = ''
  replyTo.value = null
  attachments.value = []
  await nextTick(); autosize()
  await chat.send(text, re, null, {}, files)
}

/* ── LOS ADJUNTOS: se eligen con el botón del compositor (o se arrastran encima) y salen con el mensaje, hasta 25 MB
   cada uno. Sólo a personas: a un agente, canon o cuadrilla no se les mandan archivos. */
const MAX_ATTACHMENT = 25 * 1024 * 1024
// Crear un grupo desde el sidebar: el nombre y los miembros separados por coma o espacio.
const newGroupOpen = ref(false)
const newGroupName = ref('')
const newGroupMembers = ref('')
const newGroupError = ref('')
async function submitNewGroup() {
  newGroupError.value = ''
  try {
    const members = newGroupMembers.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    const g = await chat.createGroup(newGroupName.value.trim(), members)
    newGroupOpen.value = false
    newGroupName.value = ''
    newGroupMembers.value = ''
    serverOpen.value = ''
    chat.open({ email: `#${g.id}`, name: `#${g.id}`, group: true, members: g.members })
  } catch (e) { newGroupError.value = e.message }
}
const attachments = ref([])
const attachError = ref('')
const fileInput = ref(null)
const canAttach = computed(() => !!chat.active && !chat.active.person.agent && !chat.active.person.group && !chat.active.person.tool && !agentAnswers.value)
function addFiles(list) {
  attachError.value = ''
  for (const f of list) {
    if (f.size > MAX_ATTACHMENT) { attachError.value = `${f.name} pasa de 25 MB`; continue }
    if (!f.size) { attachError.value = `${f.name} está vacío`; continue }
    if (attachments.value.length >= 10) { attachError.value = 'hasta 10 adjuntos por mensaje'; break }
    attachments.value.push(f)
  }
}
function onPickFiles(e) { addFiles([...e.target.files]); e.target.value = '' }
function onDropFiles(e) { if (canAttach.value && e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]) }
/* Pegar del portapapeles (Cmd+V): si trae archivos —una captura de pantalla, una imagen copiada— se adjuntan como al
   arrastrarlos; si es sólo texto, el pegado sigue normal. Una captura llega como «image.png»: se le pone la hora para
   que dos no se llamen igual. */
function onPasteFiles(e) {
  if (!canAttach.value) return
  const files = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile()).filter(Boolean)
  if (!files.length) return
  e.preventDefault()
  const now = new Date()
  const two = (n) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  addFiles(files.map((f, i) => (/^image\.\w+$/i.test(f.name)
    ? new File([f], `captura-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${f.name.split('.').pop()}`, { type: f.type })
    : f)))
}
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const isPdf = (f) => /\.pdf$/i.test(f.name || '')
/* Cómo se ve un archivo que no es imagen, como en WhatsApp: un cuadrito con su tipo (PDF, XLS…) y un color por familia. */
const extOf = (f) => ((f.name || '').match(/\.([a-z0-9]{1,5})$/i)?.[1] || 'archivo').toUpperCase()
const FILE_KINDS = { pdf: ['PDF'], sheet: ['XLS', 'XLSX', 'CSV', 'NUMBERS'], doc: ['DOC', 'DOCX', 'TXT', 'MD', 'PAGES'],
  zip: ['ZIP', 'RAR', '7Z', 'GZ', 'TAR'], code: ['JSON', 'JS', 'TS', 'GO', 'PHP', 'SQL', 'HTML', 'CSS', 'YML', 'YAML'] }
const kindOf = (f) => Object.entries(FILE_KINDS).find(([, exts]) => exts.includes(extOf(f)))?.[0] || 'other'
/* EL VISOR DE PDF, en la región de la derecha: se baja al caché del chat si hace falta (no a Descargas) y se lee al
   lado de la conversación. Mientras está abierto le gana al panel de tu agente; al cerrarlo, la derecha vuelve a ser
   lo que era. */
const docView = ref(null)   // { item, f }
const docLoading = ref('')
async function openDoc(item, f) {
  if (f.status !== 'bajado') {
    docLoading.value = f.id || f.name
    try { await chat.getFile(item, f, { cache: true }) } finally { docLoading.value = '' }
    if (f.status !== 'bajado') return
  }
  docView.value = { item, f }
}
function closeDoc() { docView.value = null }
/* En la burbuja, las imágenes van arriba en grilla (como WhatsApp) y lo demás abajo. Una imagen que llegó y pasa de
   15 MB no se baja sola: va con lo demás, con «Bajar». */
const imagesOf = (item) => (item.files || []).filter((f) => isImage(f) && (item.dir === 'out' || f.size <= IMAGE_AUTO_MAX))
const othersOf = (item) => (item.files || []).filter((f) => !imagesOf(item).includes(f))
// Lo enviado: la miniatura que armó el navegador al mandarlo y, si no la tiene (lo mandó bin/chat, o la ventana se
// cerró), la copia que guardó el servidor del chat en su caché.
const imageSrc = (item, f) => (item.dir === 'out' ? f.thumb || (f.status === 'bajado' ? chat.fileUrl(f) : '') : f.status === 'bajado' ? chat.fileUrl(f) : '')
// La imagen en grande, al tocarla: Escape o un clic afuera la cierran.
const lightbox = ref(null)   // { src, name }
function openImage(item, f) { const src = imageSrc(item, f); if (src) lightbox.value = { src, name: f.name, item, f } }
function onLightboxKey(e) { if (e.key === 'Escape') lightbox.value = null }
watch(lightbox, (v) => (v ? window.addEventListener('keydown', onLightboxKey) : window.removeEventListener('keydown', onLightboxKey)))
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
  if (activeOwnAgent.value && !activeOwnAgent.value.on) return false
  if (!activeIsCuadrilla.value) return !!draft.value.trim() || (canAttach.value && attachments.value.length > 0)
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
const notesEl = ref(null)
const myAgentThinking = computed(() => chat.notes.some((n) => n.status === 'pensando'))
const modelName = (id) => MODELS.find((m) => m.id === id)?.name || id
// «leyó 2 archivos · corrió make tareas»: lo que hizo tu agente para contestar, en una línea.
function stepsSummary(steps) {
  const count = (tool) => steps.filter((s) => s.tool === tool).length
  const parts = []
  if (count('leyó')) parts.push(`leyó ${count('leyó')} ${count('leyó') === 1 ? 'archivo' : 'archivos'}`)
  if (count('buscó') + count('listó')) parts.push(`buscó ${count('buscó') + count('listó')} ${count('buscó') + count('listó') === 1 ? 'vez' : 'veces'}`)
  const ran = steps.filter((s) => s.tool === 'corrió').map((s) => s.detail.split(' ').slice(0, 2).join(' '))
  if (ran.length) parts.push(`corrió ${[...new Set(ran)].join(', ')}`)
  return parts.join(' · ') || `${steps.length} pasos`
}
async function scrollNotesToEnd() {
  await nextTick()
  if (notesEl.value) notesEl.value.scrollTop = notesEl.value.scrollHeight
}
watch(() => chat.activeKey, (key) => { if (!key) scrollNotesToEnd() })
async function scrollToEnd() {
  await nextTick()
  if (threadEl.value) threadEl.value.scrollTop = threadEl.value.scrollHeight
}
watch(() => [chat.activeKey, chat.active?.messages.length], scrollToEnd)
watch(() => chat.activeKey, async (key) => {
  // El de la conversación que se abre (el de la anterior ya quedó guardado al escribirlo).
  draft.value = drafts[draftKey(key)] || ''
  replyTo.value = null
  await nextTick(); autosize(); composer.value?.focus()
})
const activeIsCanon = computed(() => chat.active?.person.tool === 'canon')
const placeholder = computed(() => {
  if (agentAnswers.value) return `Contesta ${agentLabel.value}: apagalo para escribir vos`
  if (activeOwnAgent.value && !activeOwnAgent.value.on) return `${activeOwnAgent.value.name} está apagado: prendelo a la derecha para preguntarle`
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

function clearActive() {
  const c = chat.active
  if (c && window.confirm(`¿Vaciar la conversación con ${c.person.name || c.person.email}? Se borran sus mensajes de este navegador.`)) chat.clearMessages(c.person.email)
}
function clearNotes() {
  if (window.confirm('¿Vaciar tu conversación con tu agente? Sólo está en este navegador: no se puede recuperar.')) chat.clearNotes()
}
// Borrar la conversación, igual que su ✕ del sidebar: sale de la lista y lo ya recibido no vuelve (forget sola la sacaba
// de la lista, pero `listen` la traía de nuevo con todos sus mensajes).
function forgetActive() {
  if (chat.active) deleteConversation(chat.active)
}

// El título de la pestaña dice cuántos no leídos hay, como cualquier chat.
watch(() => chat.unreadTotal, (n) => { document.title = n ? `(${n}) chat` : 'chat' }, { immediate: true })

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  applyRoute()
  chat.start()
  loadServers()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('popstate', applyRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
})
onBeforeUnmount(() => {
  chat.stop()
  clearTimeout(serversTimer)
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
      <!-- TRES VISTAS (`en-bloques` y `.view` de la base): tus conversaciones, los agentes del equipo y los servers. Cada
           una se pliega como en VS Code; con «Paneles», cada una es un panel sobre el lienzo, como en canon. -->
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <section class="view wb-bloque bloque-conversaciones" :class="{ open: isViewOpen('conversations') }">
      <div class="region-head">
        <button type="button" class="view-tog" :aria-expanded="isViewOpen('conversations')" @click="toggleView('conversations')">
          <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Conversaciones</span>
        </button>
        <span v-if="chat.unreadTotal" class="count filtered" :title="`${chat.unreadTotal} sin leer`">{{ chat.unreadTotal }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Actualizar" aria-label="Actualizar"
                  @click="chat.loadState(); chat.loadOnline(); chat.loadTeamAgents()">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div v-if="isViewOpen('conversations')" class="region-body">
        <ul class="conversations">
          <li>
            <button type="button" class="conversation" :class="{ on: !chat.activeKey && !serverOpen }" @click="openMyChat">
              <span class="avatar" aria-hidden="true"><img v-if="myPhoto" class="avatar-photo" :src="myPhoto" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(chat.me || chat.state?.session) }}</template></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">Mi chat</b></span>
                <span class="conversation-bottom"><span class="snippet">{{ chat.notes.length ? (chat.notes[chat.notes.length - 1].status === 'pensando' ? `${agentLabel} está pensando…` : chat.notes[chat.notes.length - 1].text) : `vos y ${agentLabel}` }}</span></span>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="!chat.list.length && !onlineWithoutChat.length" class="side-note">
          Todavía no hay conversaciones ni nadie más conectado. Cuando alguien abra <code>playground listen</code>, aparece acá.
        </p>
        <p v-if="chat.loginBusy || chat.state?.login?.running" class="side-note">Entrando al playground…</p>
        <p v-else-if="chat.onlineError" class="side-note bad">{{ chat.onlineError }}</p>
        <!-- Una sola lista: las conversaciones y, abajo, quien está conectado y todavía no tiene una (el punto verde
             dice quién está). -->
        <ul v-if="chat.list.length || onlineWithoutChat.length" class="conversations">
          <li v-for="c in chat.list" :key="c.person.email" class="conv-item">
            <button type="button" class="conversation" :class="{ on: c.person.email === chat.activeKey }" @click="serverOpen = ''; chat.open(c.person)">
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
                    @click.stop="deleteConversation(c)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </li>
          <li v-for="p in onlineWithoutChat" :key="p.email">
            <button type="button" class="conversation" @click="serverOpen = ''; chat.open(p)">
              <span class="avatar" aria-hidden="true"><img v-if="photoOf(p)" class="avatar-photo" :src="photoOf(p)" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(p) }}</template><i class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">{{ p.name || p.email }}</b></span>
                <span class="conversation-bottom"><span class="snippet">{{ handle(p) }} · escribile</span></span>
              </span>
            </button>
          </li>
        </ul>

      </div>
      </section>

      <!-- Los grupos (`#ecommerce`): personas y agentes delegados en una misma conversación. Los reparte el home. -->
      <section class="view wb-bloque bloque-grupos" :class="{ open: isViewOpen('groups') }">
      <div class="region-head">
        <button type="button" class="view-tog" :aria-expanded="isViewOpen('groups')" @click="toggleView('groups')">
          <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Grupos</span>
        </button>
        <div class="region-actions">
          <button type="button" class="region-action" title="Nuevo grupo" aria-label="Nuevo grupo" @click="newGroupOpen = !newGroupOpen">
            <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div v-if="isViewOpen('groups')" class="region-body">
        <form v-if="newGroupOpen" class="new-group" @submit.prevent="submitNewGroup">
          <input v-model="newGroupName" class="input" placeholder="#ecommerce" aria-label="Nombre del grupo">
          <input v-model="newGroupMembers" class="input" placeholder="@dani, @duncan.estrada/rambo" aria-label="Miembros">
          <div class="new-group-actions">
            <button type="submit" class="btn btn-sm" :disabled="!newGroupName.trim()">Crear</button>
            <button type="button" class="btn btn-outline btn-sm" @click="newGroupOpen = false">Cancelar</button>
          </div>
          <p v-if="newGroupError" class="side-note bad">{{ newGroupError }}</p>
        </form>
        <p v-if="!chat.groupList.length && !newGroupOpen" class="side-note">
          Sin grupos. Con <b>+</b> creás uno: personas (<code>@dani</code>) y agentes delegados (<code>@duncan/rambo</code>).
        </p>
        <ul v-if="chat.groupList.length" class="conversations">
          <li v-for="g in chat.groupList" :key="g.person.email" class="conv-item">
            <button type="button" class="conversation" :class="{ on: g.person.email === chat.activeKey }" @click="serverOpen = ''; chat.open(g.person)">
              <span class="avatar group-avatar" aria-hidden="true">#</span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ g.person.name }}</b>
                  <span class="when">{{ shortWhen(g.last?.time) }}</span>
                </span>
                <span class="conversation-bottom">
                  <span class="snippet">{{ g.last ? `${g.last.dir === 'out' ? 'Vos' : (g.last.via || firstName(g.last.author))}: ${snippetOf(g.last)}` : `${(g.person.members || []).length} miembros` }}</span>
                  <span v-if="g.unread" class="unread">{{ g.unread }}</span>
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
      </section>

      <!-- Los agentes del equipo: los de cada persona conectada (`playground agents`), los tuyos primero. -->
      <section class="view wb-bloque bloque-agentes" :class="{ open: isViewOpen('agents') }">
      <div class="region-head">
        <button type="button" class="view-tog" :aria-expanded="isViewOpen('agents')" @click="toggleView('agents')">
          <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Agentes</span>
        </button>
        <span class="count">{{ chat.agentList.length }}</span>
      </div>
      <div v-if="isViewOpen('agents')" class="region-body">
        <p v-if="chat.teamAgentsError" class="side-note bad">{{ chat.teamAgentsError }}</p>
        <p v-else-if="!chat.agentList.length" class="side-note">
          Nadie tiene agentes conectados ahora. Los tuyos los anuncia <code>playground listen</code>: los de
          <code>~/playground/team/agents.json</code>.
        </p>
        <ul v-else class="conversations">
          <li v-for="a in chat.agentList" :key="a.key">
            <button type="button" class="conversation" :class="{ on: a.key === chat.activeKey, off: a.off }" @click="serverOpen = ''; chat.openAgent(a)">
              <span class="avatar agent" :class="{ mine: a.mine, tool: a.tool }" aria-hidden="true">{{ (a.agentName || '?')[0].toUpperCase() }}</span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ a.agentName }}</b>
                  <span class="owner">{{ a.tool ? 'del equipo' : a.mine ? (a.off ? 'tuyo · apagado' : 'tuyo') : firstName(a.owner) }}{{ a.offline ? ' · sin conexión' : '' }}</span>
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
      </section>

      <!-- Los servers: lo que hay que prender acá para que otra persona pruebe contra esta máquina. -->
      <section class="view wb-bloque bloque-servers" :class="{ open: isViewOpen('servers') }">
      <div class="region-head">
        <button type="button" class="view-tog" :aria-expanded="isViewOpen('servers')" @click="toggleView('servers')">
          <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Servers</span>
        </button>
        <span class="count">{{ servers.length + teamServices.services.length }}</span>
      </div>
      <div v-if="isViewOpen('servers')" class="region-body">
        <ul class="conversations">
          <li v-for="s in servers" :key="s.id">
            <button type="button" class="conversation" :class="{ on: serverOpen === s.id }" @click="serverOpen = serverOpen === s.id ? '' : s.id">
              <span class="avatar svc-tunnel" aria-hidden="true">{{ s.name[0] }}<i v-if="s.ready" class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">{{ s.name }}</b><span class="owner">en esta máquina</span></span>
                <span class="conversation-bottom"><span class="snippet">{{ s.busy ? s.step || 'levantando…' : s.ready ? 'listo' + (s.tunnelUrl ? ' · ' + s.tunnelUrl : '') : (s.checks.find((c) => !c.ok)?.name || '') + ': ' + (s.checks.find((c) => !c.ok)?.detail || '') }}</span></span>
              </span>
            </button>
          </li>
          <!-- Tus servicios del playground: apagados, en gris, como tus agentes. -->
          <li v-for="t in teamServices.services" :key="t.alias">
            <button type="button" class="conversation" :class="{ on: serverOpen === `svc:${t.alias}`, off: !t.on }"
                    @click="serverOpen = serverOpen === `svc:${t.alias}` ? '' : `svc:${t.alias}`">
              <span class="avatar svc-playground" aria-hidden="true">{{ t.alias[0].toUpperCase() }}<i v-if="t.on && t.listening && teamServices.serving" class="presence"></i></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">{{ t.alias }}</b><span class="owner">{{ t.on ? 'playground' : 'playground · apagado' }}</span></span>
                <span class="conversation-bottom"><span class="snippet">{{ t.description }}</span></span>
              </span>
            </button>
          </li>
        </ul>
      </div>
      </section>

    </aside>

    <main v-if="openService" class="editor">
      <ServicePanel :service="openService" :serving="teamServices.serving" @changed="loadServers" @close="serverOpen = ''" />
    </main>
    <main v-else-if="openServer" class="editor">
      <ServerPanel :server="openServer" @changed="loadServers" @close="serverOpen = ''" />
    </main>

    <main v-else class="editor">
      <div class="region-head conversation-head">
        <template v-if="chat.active">
          <!-- Un solo primer hijo: la base le da a ese el ancho que sobra y lo recorta con «…». -->
          <span class="head-who">
            <span class="avatar small" :class="{ agent: activeIsAgent, mine: activeIsAgent && activeOwnerIsMe, tool: activeIsCanon }" aria-hidden="true">
              <img v-if="!activeIsAgent && photoOf(chat.active.person)" class="avatar-photo" :src="photoOf(chat.active.person)" alt="" referrerpolicy="no-referrer">
              <template v-else>{{ chat.active.person.group ? '#' : activeIsAgent ? (activeTitle || '?')[0].toUpperCase() : initials(chat.active.person) }}</template><i v-if="activeOnline" class="presence"></i>
            </span>
            <span class="head-title">{{ activeTitle }}</span>
            <span class="count head-sub">{{ activeSubtitle }}</span>
          </span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Vaciar chat: borra los mensajes y la conversación queda"
                    aria-label="Vaciar chat" @click="clearActive">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Borrar conversación: sale de la lista (sólo en este navegador)"
                    aria-label="Borrar conversación" @click="forgetActive">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <template v-else>
          <span class="head-who"><span class="head-title">Mi chat</span><span v-if="myHandle" class="count head-sub">{{ myHandle }}</span></span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Vaciar tu conversación con tu agente"
                    aria-label="Vaciar tu conversación con tu agente" :disabled="!chat.notes.length" @click="clearNotes">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
        </template>
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

      <!-- MI CHAT: tu conversación con tu agente. Le escribís y contesta él, con el modelo de su panel; no sale a nadie.
           Lo que te escribe cada persona está en su conversación. -->
      <div v-if="!chat.active" ref="notesEl" class="region-body thread my-notes" aria-live="polite">
        <p v-if="!chat.notes.length" class="side-note center">
          Escribile a {{ agentLabel }}: te contesta acá, con {{ modelName(mine.agent.model) }}. Puede leer tu playground —knowledge/, el
          tablero y las herramientas— y correr comandos que sólo consultan; nada que escriba, y no lee credenciales.
        </p>
        <template v-for="n in chat.notes" :key="n.id">
          <div v-if="n.from === 'agente'" class="bubble-row in agent-row">
            <img v-if="mine.agent.avatar" class="agent-avatar" :src="mine.agent.avatar" alt="">
            <div class="bubble" :class="{ failed: n.status === 'error' }">
              <span class="published-label">{{ agentLabel }}<template v-if="n.model"> · {{ modelName(n.model) }}</template></span>
              <template v-if="n.status === 'pensando'">
                <p class="text thinking">{{ n.steps?.length ? 'trabajando…' : 'pensando…' }}</p>
                <ul v-if="n.steps?.length" class="live-steps">
                  <li v-for="(st, i) in n.steps" :key="i"><b>{{ st.tool }}</b> <code>{{ st.detail }}</code></li>
                </ul>
              </template>
              <p v-else-if="n.status === 'error'" class="text">{{ n.text }}</p>
              <div v-else class="text md" v-html="renderMarkdown(n.text)"></div>
              <details v-if="n.steps?.length && n.status !== 'pensando'" class="agent-steps">
                <summary>{{ stepsSummary(n.steps) }}</summary>
                <ul><li v-for="(st, i) in n.steps" :key="i"><b>{{ st.tool }}</b> <code>{{ st.detail }}</code></li></ul>
              </details>
              <span class="meta">{{ clock(n.time) }}</span>
            </div>
            <button type="button" class="conv-del note-del" title="Borrar este mensaje" aria-label="Borrar este mensaje" @click="chat.removeNote(n.id)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </div>
          <div v-else class="bubble-row out">
            <button type="button" class="conv-del note-del" title="Borrar este mensaje" aria-label="Borrar este mensaje" @click="chat.removeNote(n.id)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
            <div class="bubble">
              <p class="text">{{ n.text }}</p>
              <span class="meta">{{ shortWhen(n.time) === clock(n.time) ? clock(n.time) : `${shortWhen(n.time)} · ${clock(n.time)}` }}</span>
            </div>
          </div>
        </template>
      </div>

      <form v-if="!chat.active" class="composer" @submit.prevent="submit">
        <div class="composer-row">
          <label class="sr-only" for="composer-text">Escribile a tu agente</label>
          <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1"
                    maxlength="2000" :placeholder="`Escribile a ${agentLabel}`" @keydown="onKeydown" @input="autosize"></textarea>
          <button type="submit" class="btn" :disabled="!draft.trim() || myAgentThinking">{{ myAgentThinking ? 'Pensando…' : 'Mandar' }}</button>
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
            <div v-else class="bubble-row" :class="[item.dir, { cont: item.cont }]">
              <div class="bubble" :class="{ failed: item.status === 'error' }">
                <span v-if="item.author && !item.cont" class="author-label" :class="{ delegate: item.via }">
                  <template v-if="item.via"><b>{{ item.via }}</b> · agente de {{ firstName(item.author) }}</template>
                  <b v-else>{{ item.author.name }}</b>
                </span>
                <span v-if="item.forAgent && !item.cont" class="published-label">para tu agente {{ item.forAgent }}</span>
                <span v-if="item.kind === 'publish' && !item.cont" class="published-label">publicó</span>
                <span v-if="item.auto && !item.cont" class="published-label">contestó {{ agentLabel }}</span>
                <span v-if="item.cuadrilla" class="task-note-label">
                  <template v-if="item.dir === 'in'"><b>{{ item.cuadrilla.autor }}</b> · </template>{{ NOTE_LABEL[item.cuadrilla.tipo] || item.cuadrilla.tipo }}
                  en «{{ item.cuadrilla.tarea }}»<template v-if="item.cuadrilla.dependeDe"> · depende de {{ item.cuadrilla.dependeDe }}</template>
                </span>
                <span v-if="item.quote" class="quote">
                  <b v-if="item.quote.who">{{ item.quote.who }}</b>
                  <span>{{ item.quote.text }}</span>
                </span>
                <!-- Las imágenes van arriba y el texto abajo, como un pie de foto (WhatsApp): hasta 4 en la grilla y la
                     última con «+N» si hay más; 3 ponen la primera a lo ancho. -->
                <div v-if="imagesOf(item).length" class="media-grid" :class="`n${Math.min(imagesOf(item).length, 4)}`">
                  <figure v-for="(f, i) in imagesOf(item).slice(0, 4)" :key="f.id || f.name" class="media">
                    <button v-if="imageSrc(item, f)" type="button" class="media-open" :title="`Ver ${f.name}`" @click="openImage(item, f)">
                      <img :src="imageSrc(item, f)" :alt="f.name">
                      <span v-if="i === 3 && imagesOf(item).length > 4" class="media-more">+{{ imagesOf(item).length - 4 }}</span>
                    </button>
                    <div v-else class="media-placeholder">
                      <span v-if="f.status === 'error' && f.error">{{ f.error }}</span>
                      <span v-else-if="item.dir === 'out'">{{ item.status === 'error' || f.status === 'error' ? `${f.name}: no salió` : f.status === 'subiendo' ? 'subiendo…' : f.name }}</span>
                      <span v-else>cargando…</span>
                      <button v-if="item.dir === 'in' && f.status === 'error' && !f.gone" type="button" class="btn-link" @click="chat.getFile(item, f, { cache: true })">reintentar</button>
                    </div>
                  </figure>
                </div>
                <pre v-if="item.format === 'json'" class="text json">{{ item.text }}</pre>
                <template v-else>
                  <p v-if="item.summary" class="summary">{{ item.summary }}</p>
                  <!-- Lo que contesta un agente viene con formato: Markdown seguro (escapa todo y entiende una lista corta). -->
                  <div v-if="activeIsAgent && item.dir === 'in'" class="text md" v-html="renderMarkdown(item.text)"></div>
                  <p v-else-if="item.text" class="text">{{ item.text }}</p>
                </template>
                <ul v-if="othersOf(item).length" class="attachments" aria-label="Adjuntos">
                  <!-- Como un documento de WhatsApp: el tipo a la izquierda, el nombre y su tamaño, y lo que se puede hacer.
                       Un PDF se abre en la barra derecha. -->
                  <li v-for="f in othersOf(item)" :key="f.id || f.name" class="attachment" :class="[`kind-${kindOf(f)}`, { openable: isPdf(f) && f.id }]">
                    <component :is="isPdf(f) && f.id ? 'button' : 'div'" :type="isPdf(f) && f.id ? 'button' : undefined" class="doc-card"
                               :title="isPdf(f) && f.id ? `Ver ${f.name} a la derecha` : f.path || f.name" @click="isPdf(f) && f.id && openDoc(item, f)">
                      <span class="doc-icon" aria-hidden="true">{{ extOf(f) }}</span>
                      <span class="doc-main">
                        <span class="doc-name">{{ f.name }}</span>
                        <span class="doc-meta">
                          {{ extOf(f) }} · {{ sizeText(f.size) }}
                          <template v-if="item.dir === 'out' && (item.status === 'error' || f.status === 'error')"> · no salió</template>
                          <template v-else-if="f.status === 'subiendo'"> · subiendo…</template>
                          <template v-else-if="f.status === 'bajando' || docLoading === (f.id || f.name)"> · bajando…</template>
                          <template v-else-if="f.savedPath"> · en Descargas</template>
                        </span>
                      </span>
                      <span v-if="isPdf(f) && f.id" class="doc-open">Ver</span>
                    </component>
                    <div v-if="item.dir === 'in' || f.status === 'bajado'" class="doc-actions">
                      <button v-if="item.dir === 'in' && (!f.status || f.status === 'error')" type="button" class="btn-link"
                              title="Bajarlo a Descargas: se borra del playground. No se abre solo" @click="chat.getFile(item, f)">Bajar a Descargas</button>
                      <button v-else-if="f.status === 'bajado' && !f.savedPath && f.cached" type="button" class="btn-link"
                              title="Guardar una copia en Descargas" @click="chat.saveFile(f)">Guardar en Descargas</button>
                      <button v-if="f.savedPath" type="button" class="btn-link" title="Mostrar en el Finder (no lo abre)" @click="chat.revealFile(f)">Mostrar en el Finder</button>
                    </div>
                    <p v-if="f.error" class="error">{{ f.error }}</p>
                  </li>
                </ul>
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
                    <span v-else-if="activeIsAgent && (item.status === 'sent' || item.status === 'answered')" title="Contestó">· ✓</span>
                    <!-- Como en WhatsApp: ✓✓ le llegó a su chat o su terminal; ✓ quedó en el buzón (no estaba conectado). El
                         playground no avisa cuando el buzón se lo entrega después, ni si lo leyó. -->
                    <span v-else-if="item.status === 'sent' && item.delivered > 0" class="ticks"
                          :title="`Entregado: le llegó a ${item.delivered === 1 ? 'su chat o su terminal abierta' : `sus ${item.delivered} terminales abiertas`}`">· ✓✓</span>
                    <span v-else-if="item.status === 'sent' && item.delivered === 0" class="ticks"
                          title="Enviado: no estaba conectado, quedó en su buzón y le llega cuando abra el chat">· ✓</span>
                    <!-- Los de antes de guardar la entrega (o mandados desde la terminal): no se sabe, así que no se afirma. -->
                    <span v-else-if="item.status === 'sent'" class="ticks" title="Enviado">· ✓</span>
                  </template>
                </span>
                <p v-if="item.status === 'error'" class="error">
                  No salió: {{ item.error }}
                  <button v-if="!item.cuadrilla && chat.canRetry(item)" type="button" class="btn-link" @click="chat.retry(item.id)">reintentar</button>
                  <button v-if="item.dir === 'out' && !item.cuadrilla" type="button" class="btn-link"
                          title="Sacarlo de la conversación: no le llegó a nadie" @click="chat.discard(item.id)">borrar</button>
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
          <ul v-if="attachments.length || attachError" class="attach-list" aria-label="Para adjuntar">
            <li v-for="(f, i) in attachments" :key="`${f.name}|${i}`" class="attach-chip">
              <span class="attachment-name">{{ f.name }}</span><span class="attachment-size">{{ sizeText(f.size) }}</span>
              <button type="button" class="region-action" :aria-label="`Sacar ${f.name}`" title="No adjuntarlo" @click="attachments.splice(i, 1)">
                <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
              </button>
            </li>
            <li v-if="attachError" class="error">{{ attachError }}</li>
          </ul>
          <div class="composer-row" @dragover.prevent @drop.prevent="onDropFiles">
            <template v-if="canAttach">
              <input ref="fileInput" type="file" multiple class="sr-only" aria-hidden="true" tabindex="-1" @change="onPickFiles">
              <button type="button" class="btn btn-outline composer-attach" title="Adjuntar archivos (hasta 25 MB cada uno; también se pueden arrastrar)"
                      aria-label="Adjuntar archivos" @click="fileInput?.click()">
                <span class="ui-icon" data-icon="plus" aria-hidden="true"></span>
              </button>
            </template>
            <label class="sr-only" for="composer-text">{{ placeholder }}</label>
            <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1" :disabled="agentAnswers"
                      maxlength="2000" :placeholder="placeholder" @keydown="onKeydown" @input="autosize" @paste="onPasteFiles"></textarea>
            <button type="submit" class="btn" :disabled="!canSubmit">{{ activeIsCuadrilla ? 'Anotar' : activeIsAgent && !chat.active?.person.delegate ? 'Preguntar' : 'Mandar' }}</button>
          </div>
        </form>
      </template>
    </main>

    <!-- La imagen en grande, como en WhatsApp: clic afuera o Escape la cierran. -->
    <div v-if="lightbox" class="lightbox" role="dialog" aria-modal="true" :aria-label="lightbox.name" @click.self="lightbox = null">
      <img :src="lightbox.src" :alt="lightbox.name">
      <div class="lightbox-bar">
        <span class="attachment-name">{{ lightbox.name }}</span>
        <template v-if="lightbox.item.dir === 'in'">
          <button v-if="!lightbox.f.savedPath" type="button" class="btn btn-outline btn-sm" title="Guardar una copia en Descargas"
                  @click="chat.saveFile(lightbox.f)">Guardar en Descargas</button>
          <button v-else type="button" class="btn-link" title="Mostrarla en el Finder (no la abre)" @click="chat.revealFile(lightbox.f)">en Descargas ↗</button>
        </template>
      </div>
      <p v-if="lightbox.f.error" class="error">{{ lightbox.f.error }}</p>
      <button type="button" class="region-action lightbox-close" aria-label="Cerrar" title="Cerrar (Esc)" @click="lightbox = null">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>

    <!-- ── tu agente: la región de la derecha ─────────────────────────────────────────── -->
    <aside v-show="agentShown" class="auxiliarybar" :aria-label="docView ? 'Documento' : openService ? 'Rutas' : 'Mi agente'">
      <div class="rsz rsz-edge-left" v-resize="agentResize"></div>
      <template v-if="docView">
        <div class="region-head">
          <span class="doc-view-title" :title="docView.f.name">{{ docView.f.name }}</span>
          <div class="region-actions">
            <button v-if="!docView.f.savedPath" type="button" class="region-action" title="Guardar una copia en Descargas"
                    aria-label="Guardar en Descargas" @click="chat.saveFile(docView.f)">
              <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
            </button>
            <button v-else type="button" class="region-action" title="Mostrar en el Finder" aria-label="Mostrar en el Finder" @click="chat.revealFile(docView.f)">
              <span class="ui-icon" data-icon="external" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar el documento" @click="closeDoc">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <iframe class="doc-frame" :src="chat.fileUrl(docView.f)" :title="docView.f.name"></iframe>
      </template>
      <ServiceSide v-else-if="openService" :service="openService" @close="setRoutesOpen(false)" />
      <template v-else-if="activeOwnAgent">
        <div class="region-head">
          <span>{{ activeOwnAgent.name }} <small class="agent-state">{{ activeOwnAgent.on ? 'prendido' : 'apagado' }}</small></span>
          <div class="region-actions">
            <button type="button" class="switch" role="switch" :aria-checked="activeOwnAgent.on" :disabled="ownBusy" @click="toggleOwnAgent"
                    :title="activeOwnAgent.on ? 'Apagar: deja de contestarle al equipo' : 'Prender: el equipo lo vuelve a ver'"
                    :aria-label="activeOwnAgent.on ? `Apagar a ${activeOwnAgent.name}` : `Prender a ${activeOwnAgent.name}`"></button>
            <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar" @click="setOwnPanelOpen(false)">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="region-body own-agent">
          <p>{{ activeOwnAgent.description }}</p>
          <dl>
            <dt>Estado</dt>
            <dd v-if="!activeOwnAgent.on">apagado: el equipo no lo ve y no contesta</dd>
            <dd v-else-if="activeOwnAgent.listening">le contesta al equipo</dd>
            <dd v-else>prendido, pero su puerto no contesta: <code>make chat</code> lo levanta</dd>
            <dt>Dónde escucha</dt>
            <dd><code>{{ activeOwnAgent.url }}</code>, sólo en esta máquina</dd>
            <dt>Se declara en</dt>
            <dd><code>~/playground/team/agents.json</code></dd>
          </dl>
          <p v-if="chat.ownAgentsError" class="bad">{{ chat.ownAgentsError }}</p>
        </div>
      </template>
      <template v-else>
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
      </template>
    </aside>

    <!-- ── la consola de un servicio: el historial de lo que le mandaste; un clic lo vuelve a cargar ──────────── -->
    <section v-if="openService && panelShown" class="panel" aria-label="Consola">
      <div class="rsz rsz-edge-top" v-resize="consoleResize"></div>
      <nav class="tabs" role="tablist" aria-label="Consola">
        <button v-for="t in SERVICE_TABS" :key="t.id" type="button" role="tab" class="tab" :class="{ on: serviceTab === t.id }"
                :aria-selected="serviceTab === t.id" :title="t.title || null" @click="setServiceTab(t.id)">
          {{ t.label }} <span v-if="t.id === 'history' && serviceHistory.length" class="count">{{ serviceHistory.length }}</span>
        </button>
        <div class="region-actions">
          <button v-if="serviceTab === 'history' && serviceHistory.length" type="button" class="region-action" title="Vaciar el historial" aria-label="Vaciar el historial"
                  @click="forgetHistory(openService.alias)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
          <button ref="consoleMax" type="button" class="region-action"><span class="ui-icon" aria-hidden="true"></span></button>
          <button type="button" class="region-action" title="Ocultar la consola" aria-label="Ocultar la consola" @click="setConsoleOpen(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div v-if="serviceTab === 'info'" class="region-body console service-info">
        <p class="console-empty">{{ openService.description }}</p>
        <dl>
          <dt>Estado</dt>
          <dd v-if="!openService.on">apagado: el equipo no lo ve</dd>
          <dd v-else-if="!openService.listening">prendido, pero su puerto no contesta</dd>
          <dd v-else-if="!teamServices.serving">prendido, pero <code>playground serve</code> no está corriendo</dd>
          <dd v-else>el equipo lo alcanza por la VPN</dd>
          <dt>En el equipo</dt>
          <dd><code>{{ openService.url }}</code>
            <button type="button" class="region-action" :title="serviceUrlCopied ? 'Copiada' : 'Copiar la dirección'" aria-label="Copiar la dirección" @click="copyServiceUrl">
              <span class="ui-icon" :data-icon="serviceUrlCopied ? 'check' : 'copy'" aria-hidden="true"></span>
            </button></dd>
          <dt>En esta máquina</dt>
          <dd><code>{{ openService.to }}</code>{{ openService.managed ? ' · lo levanta el chat' : ' · lo levantás vos' }}</dd>
          <dt>Se declara en</dt>
          <dd><code>~/playground/team/services.json</code> (prendidos) y <code>services.off.json</code> (apagados)</dd>
        </dl>
      </div>
      <div v-else-if="serviceTab === 'serve'" class="region-body console">
        <p v-if="!serveLines.length" class="console-empty"><code>playground serve</code> todavía no escribió nada.</p>
        <div v-for="(l, i) in serveLines" :key="i" class="log-line"><span class="log-text">{{ l }}</span></div>
      </div>
      <div v-else class="region-body console">
        <p v-if="!serviceHistory.length" class="console-empty">Las peticiones que mandes a {{ openService.alias }} quedan acá; un clic la vuelve a cargar.</p>
        <button v-for="(h, i) in serviceHistory" :key="i" type="button" class="log-line history-line" :title="`Cargar ${h.method} ${h.path}`"
                @click="pickHistory(openService.alias, h)">
          <span class="log-time">{{ historyTime(h.at) }}</span>
          <span class="history-status" :class="h.status >= 400 || !h.status ? 'is-bad' : 'is-ok'">{{ h.status || '—' }}</span>
          <b class="history-method">{{ h.method }}</b>
          <span class="log-text">{{ h.path }}</span>
          <span v-if="h.ms != null" class="history-ms">{{ h.ms }} ms</span>
        </button>
      </div>
    </section>

    <!-- ── la consola de un server: lo que imprime cada comando mientras corre ─────────────── -->
    <section v-else-if="openServer && panelShown" class="panel" aria-label="Consola">
      <div class="rsz rsz-edge-top" v-resize="consoleResize"></div>
      <nav class="tabs" role="tablist" aria-label="Consola">
        <button v-for="t in CONSOLE_TABS" :key="t.id" type="button" role="tab" class="tab" :class="{ on: consoleTab === t.id }"
                :aria-selected="consoleTab === t.id" @click="consoleTab = t.id">
          {{ t.label }} <span v-if="phaseCount(t.id)" class="count">{{ phaseCount(t.id) }}</span>
        </button>
        <div class="region-actions">
          <span v-if="openServer.busy" class="count console-step">{{ openServer.step || 'corriendo…' }}</span>
          <button ref="consoleMax" type="button" class="region-action"><span class="ui-icon" aria-hidden="true"></span></button>
          <button type="button" class="region-action" title="Ocultar la consola" aria-label="Ocultar la consola" @click="setConsoleOpen(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <div ref="consoleBody" class="region-body console" @scroll="onConsoleScroll">
        <p v-if="!consoleLines.length" class="console-empty">{{ allConsoleLines.length ? 'Este paso todavía no escribió nada.' : 'Acá se ve lo que va haciendo «Levantar»: cada comando con su salida.' }}</p>
        <div v-for="(l, i) in consoleLines" :key="i" class="log-line" :class="{ 'is-command': l.command, 'is-ok': l.ok, 'is-bad': l.bad }">
          <span class="log-time">{{ l.time }}</span><span class="log-text">{{ l.text }}</span>
        </div>
      </div>
    </section>

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
        <template v-if="openServer || openService">
          <button type="button" class="region-action" :aria-pressed="!!panelShown" :title="openService ? 'Mostrar u ocultar el historial' : 'Mostrar u ocultar la consola'"
                  :aria-label="openService ? 'Mostrar u ocultar el historial' : 'Mostrar u ocultar la consola'" @click="setConsoleOpen(!panelShown)">
            <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
          </button>
          <button v-if="openService" type="button" class="region-action" :aria-pressed="!!agentShown" title="Mostrar u ocultar las rutas"
                  aria-label="Mostrar u ocultar las rutas" @click="setRoutesOpen(!agentShown)">
            <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
          </button>
        </template>
        <button v-else-if="activeOwnAgent" type="button" class="region-action" :aria-pressed="!!agentShown" title="Mostrar u ocultar la ficha del agente"
                aria-label="Mostrar u ocultar la ficha del agente" @click="setOwnPanelOpen(!agentShown)">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
        <button v-else-if="!chat.activeKey" type="button" class="region-action" :aria-pressed="!!agentShown" title="Mostrar u ocultar tu agente"
                aria-label="Mostrar u ocultar tu agente" @click="setAgentOpen(!agentShown)">
          <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
code { font-family: var(--font-mono); font-size: .92em }
.console { padding: var(--space-2) 0 }
.console-empty { padding: 0 var(--gutter) }
.console-empty { margin: 0; color: var(--fg-2); font-size: var(--text-sm) }
.console .log-text { white-space: pre-wrap; word-break: break-word; min-width: 0; color: var(--fg-2) }
.console .log-line.is-command .log-text { color: var(--foreground); font-weight: 600 }
.console .log-line.is-ok .log-text { color: var(--presence-on) }
.console .log-line.is-bad .log-text { color: var(--send-fail) }
.console-step { white-space: nowrap }
/* El historial de un servicio, como líneas de consola que se pueden cliquear. */
.service-info dl { margin: var(--space-2) 0 0; padding: 0 var(--gutter); display: grid; grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-4); align-items: center; font-size: var(--text-sm) }
.service-info dt { color: var(--fg-2) }
.service-info dd { margin: 0; display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; word-break: break-word }
.history-line { width: 100%; border: 0; background: transparent; text-align: left; font: inherit; color: inherit; cursor: pointer }
.history-line:hover { background: var(--accent) }
.history-status, .history-method { flex: none; font-family: var(--font-mono); font-size: var(--text-xs); width: 3.5em }
.history-status.is-ok { color: var(--presence-on) }
.history-status.is-bad { color: var(--send-fail) }
.history-method { color: var(--fg-2); font-weight: 600 }
.history-ms { flex: none; margin-left: auto; padding-left: var(--space-3); color: var(--fg-3); font-family: var(--font-mono); font-size: var(--text-xs) }
.bad { color: var(--send-fail) }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap }

/* ── el sidebar ── */
.side-note { margin: 0; padding: var(--space-3) var(--gutter); color: var(--fg-2); font-size: var(--text-sm); line-height: 1.5 }
.side-note.center { text-align: center; padding-top: var(--space-6) }
.conv-item { position: relative }
.conv-del { position: absolute; top: 6px; right: 6px; width: var(--control-xs); height: var(--control-xs); padding: 0; border: 0;
  border-radius: var(--radius-control); background: var(--muted); color: var(--fg-2); display: grid; place-items: center;
  cursor: pointer; opacity: 0; transition: opacity .12s }
.conv-item:hover .conv-del, .conv-del:focus-visible { opacity: 1 }
.conv-del:hover { color: var(--task-blocked) }
.conversations { list-style: none; margin: 0; padding: var(--space-1) 0 }
/* DESVIACIÓN DECLARADA de la base: las filas del sidebar son de conversación, como en WhatsApp —avatar, nombre, hora y
   el último mensaje en dos renglones— y no las `.row` de 28 de las listas. Un chat se elige por quién es y qué dijo. */
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
.avatar.svc-playground { background: var(--svc-playground-bg); color: var(--svc-playground-ink) }
.avatar.svc-tunnel { background: var(--svc-tunnel-bg); color: var(--svc-tunnel-ink) }
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
/* DESVIACIÓN DECLARADA de la base (superficies planas): el hilo de una conversación lleva un patrón tenue de fondo, como
   un chat. Sólo acá; scrollea con los mensajes (`local`). El patrón es un token del tema (--chat-wallpaper, style.css). */
.thread { background-image: var(--chat-wallpaper); background-attachment: local; background-repeat: repeat }
.day { align-self: center; margin: var(--space-3) 0 var(--space-1); padding: 2px 10px; border-radius: 999px; background: var(--muted);
  color: var(--fg-2); font-size: var(--text-xs); text-transform: capitalize }

.author-label { display: block; font-size: var(--text-xs); color: var(--fg-2); margin-bottom: 2px }
.author-label b { color: var(--foreground) }
.author-label.delegate b { color: var(--foreground); font-style: italic }
.group-avatar { font-weight: 700 }
.new-group { display: flex; flex-direction: column; gap: 6px; padding: 6px var(--gutter, 12px) }
.new-group-actions { display: flex; gap: 6px }
.bubble-row { display: flex; align-items: center; gap: 6px }
.bubble-row.out { flex-direction: row-reverse }
.bubble-row.cont { margin-top: -5px }
.bubble { max-width: min(560px, 78%); padding: 7px 10px 5px; border-radius: 12px; background: var(--bubble-theirs);
  color: var(--foreground); display: flex; flex-direction: column; gap: 3px; min-width: 0 }
.bubble-row.in:not(.cont) .bubble { border-top-left-radius: 4px }
.bubble-row.out .bubble { background: var(--bubble-mine) }
.bubble-row.out:not(.cont) .bubble { border-top-right-radius: 4px }
.bubble.failed { box-shadow: inset 0 0 0 1px var(--send-fail) }
.text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--text-body); line-height: 1.45 }
.meta { align-self: flex-end; color: var(--fg-2); font-size: var(--text-xs); font-variant-numeric: tabular-nums }
.error { margin: 2px 0 0; color: var(--send-fail); font-size: var(--text-sm) }
.btn-link { border: 0; padding: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; font: inherit }

/* MI CHAT: tu bandeja, cada mensaje con su respuesta o la de tu agente. Quién contesta se elige en tu agente (derecha) y en el pie. */
.my-chat { padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4) }

/* La foto de Google ocupa el círculo entero del avatar; el punto verde sigue encima. */
.avatar-photo { width: 100%; height: 100%; border-radius: inherit; object-fit: cover; display: block }
.me-photo { width: 16px; height: 16px; border-radius: 50%; object-fit: cover; vertical-align: -3px }

/* MI AGENTE: su avatar es la foto del muñeco. */
.avatar-img { object-fit: cover; background: var(--office-bg); border-radius: 8px }
/* Los dos bloques del costado: las conversaciones se llevan el alto que sobra; los agentes, lo suyo y no más de la
   mitad. Cada uno scrollea su cuerpo. */

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
.summary { margin: 0; font-weight: 600; font-size: var(--text-body); line-height: 1.4 }
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
.note-del { align-self: center; opacity: 0 }
.conversation.off .name, .conversation.off .owner, .conversation.off .snippet { color: var(--fg-3) }
.conversation.off .avatar { filter: grayscale(1); color: var(--fg-3) }
.own-agent { padding: var(--space-4) var(--gutter); display: flex; flex-direction: column; gap: var(--space-3) }
.own-agent p { margin: 0 }
.own-agent dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); font-size: var(--text-sm) }
.own-agent dt { color: var(--fg-2) }
.own-agent dd { margin: 0; word-break: break-word }
.own-agent .btn { align-self: flex-start }
.agent-row { gap: var(--space-2); align-items: flex-end }
.agent-avatar { flex: none; width: 28px; height: 28px; border-radius: 8px; object-fit: cover; background: var(--office-bg) }
.thinking { color: var(--fg-2); font-style: italic }
/* Markdown de un agente: los mismos espacios de la burbuja, sin el pre-wrap del texto plano. */
.text.md { white-space: normal }
.text.md :is(p, ul, ol, pre) { margin: 0 0 var(--space-2) }
.text.md > :last-child { margin-bottom: 0 }
.text.md :is(ul, ol) { padding-left: var(--space-4) }
.text.md code { font-family: var(--font-mono); font-size: .92em }
.text.md pre { font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap; overflow-x: auto }
.text.md strong { font-weight: 600 }
.agent-steps { margin-top: var(--space-2); font-size: var(--text-xs); color: var(--fg-2) }
.live-steps { margin: var(--space-1) 0 0; padding-left: var(--space-4); font-size: var(--text-xs); color: var(--fg-2) }
.live-steps code { font-family: var(--font-mono); word-break: break-all }
.agent-steps summary { cursor: pointer }
.agent-steps ul { margin: var(--space-1) 0 0; padding-left: var(--space-4) }
.agent-steps code { font-family: var(--font-mono); word-break: break-all }
.bubble-row:hover .note-del { opacity: 1 }
.published-label { font-size: var(--text-xs); font-weight: 600; color: var(--quote-rule) }

.composer { flex: none; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-6);
  border-top: 1px solid var(--border) }
/* Las imágenes: en grilla arriba de la burbuja, como WhatsApp; una sola ocupa todo el ancho. */
.media-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; width: 340px; max-width: 100%; margin: 2px 0 6px }
.media-grid.n1 { grid-template-columns: minmax(0, 1fr) }
.media-grid.n3 .media:first-child { grid-column: 1 / -1 }
.media-grid.n3 .media:first-child .media-open img { aspect-ratio: 2 / 1 }
.media { margin: 0; display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.media-open { display: block; padding: 0; border: 0; background: transparent; cursor: zoom-in; border-radius: 8px; overflow: hidden }
.media-open:focus-visible { outline: 2px solid var(--ring) }
.media-open img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover }
.media-grid.n1 .media-open img { aspect-ratio: auto; max-height: 340px; object-fit: contain; background: var(--muted) }
.media-open { position: relative }
.media-more { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: color-mix(in oklab, var(--background) 55%, transparent); color: var(--foreground); font-size: 26px; font-weight: 600 }
.media-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; aspect-ratio: 4 / 3;
  padding: 8px; border-radius: 8px; background: var(--muted); color: var(--fg-2); font-size: var(--text-xs); text-align: center }
.lightbox { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--space-2); padding: 48px 32px 24px;
  background: color-mix(in srgb, var(--background) 97%, transparent) }
.lightbox img { flex: 1 1 auto; min-height: 0; width: 100%; object-fit: contain }
.lightbox-bar { display: flex; align-items: center; gap: var(--space-3); font-size: var(--text-sm) }
.lightbox-close { position: absolute; top: 12px; right: 12px }
/* Los adjuntos: en la burbuja (bajar, ver, mostrar en Descargas) y, antes de mandar, como fichas sobre el compositor. */
.attachments { list-style: none; margin: 4px 0 2px; padding: 0; display: flex; flex-direction: column; gap: 4px; width: 340px; max-width: 100% }
/* La tarjeta de un documento (WhatsApp): una franja apenas más oscura que la burbuja, el tipo en un cuadrito de color. */
.attachment { --kind: var(--fg-3); display: flex; flex-direction: column; gap: 2px; padding: 0; border-radius: 10px;
  background: color-mix(in oklab, var(--foreground) 6%, transparent); overflow: hidden }
.attachment.kind-pdf { --kind: var(--destructive) }
.attachment.kind-sheet { --kind: var(--chart-1) }
.attachment.kind-doc { --kind: var(--primary) }
.attachment.kind-zip { --kind: var(--chart-2) }
.attachment.kind-code { --kind: var(--chart-3) }
.doc-card { display: flex; align-items: center; gap: 10px; width: 100%; min-width: 0; padding: 8px 10px; border: 0; background: transparent;
  color: inherit; font: inherit; text-align: left }
button.doc-card { cursor: pointer }
button.doc-card:hover { background: color-mix(in oklab, var(--foreground) 5%, transparent) }
button.doc-card:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.doc-icon { flex: none; display: grid; place-items: center; width: 38px; height: 44px; border-radius: 6px;
  background: color-mix(in oklab, var(--kind) 22%, var(--background)); color: color-mix(in oklab, var(--kind) 70%, var(--foreground));
  font-size: 10px; font-weight: 700; letter-spacing: .02em; overflow: hidden; text-overflow: ellipsis }
.doc-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 }
.doc-name { font-size: var(--text-sm); line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  word-break: break-word }
.doc-meta { color: var(--fg-2); font-size: var(--text-xs) }
.doc-open { flex: none; color: var(--fg-2); font-size: var(--text-xs); font-weight: 600 }
.doc-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); padding: 0 10px 6px 58px }
.doc-actions:empty { display: none }
.attachment .error { margin: 0; padding: 0 10px 6px 58px }
.attachment-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm) }
.attachment-size, .attachment-state { flex: none; color: var(--fg-2); font-size: var(--text-xs) }
.error .btn-link { margin-left: var(--space-2) }
/* El visor de documentos en la región de la derecha. */
.doc-view-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.doc-frame { flex: 1; width: 100%; min-height: 0; border: 0; background: var(--muted) }
.attach-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2) }
.attach-chip { display: flex; align-items: center; gap: var(--space-2); max-width: 280px; padding: 2px 4px 2px 10px;
  border: 1px solid var(--border); border-radius: 999px }
.composer-attach { flex: none; width: var(--control-md); min-height: var(--control-md); padding: 0; border-radius: 50% }
.replying { display: flex; align-items: center; gap: var(--space-2) }
.replying .quote { flex: 1 }
.composer-row { display: flex; align-items: flex-end; gap: var(--space-2) }
.composer-text { height: auto; min-height: var(--control-md); max-height: 160px; padding-block: 7px; resize: none; line-height: 1.4;
  font: inherit; font-size: var(--text-body); border-radius: 18px; padding-inline: 14px }

.json { font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; overflow-x: auto; margin: 0;
  max-height: 420px; overflow-y: auto }
.bubble-row.in .bubble:has(.json) { max-width: min(720px, 92%) }

/* ── el pie ── */
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3); margin-right: 6px }
.status-dot.on { background: var(--presence-on) }
</style>
