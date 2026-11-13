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
 * ⚠ Mandar sale a nombre de quien está logueado en el CLI. El texto ajeno se pinta como texto.
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useChatStore, isImage, IMAGE_AUTO_MAX } from './stores/chat.js'
import ServerPanel from './ServerPanel.vue'
import KeyringPanel from './KeyringPanel.vue'
import KeyCard from './KeyCard.vue'
import { askKeysMessage, envMessage, parseKeyText } from './keyring.js'
import { keyring, loadKeyring, setAutoShare } from './keyringStore.js'
import { renderMarkdown } from './markdown.js'
import { setBadge } from './desktop.js'
import { activeQuery, candidates, handleOf, mentionsMe, segments } from './mentions.js'
import NotifySettings from './NotifySettings.vue'
import { defaultVoice, MAX_WORDS_OPTIONS, setMaxWords, setRate, setVoice, speech, stop as stopSpeech, toggleSpeak, tooLong } from './speech.js'
import RegionMenu from './RegionMenu.vue'
import EmojiButton from './EmojiButton.vue'
import DictationButton from './DictationButton.vue'
import CallView from './CallView.vue'
import { cast as callCastOf } from './characters/index.js'
import { conversationMode, loadNotify, notify, reportView, setConversationMode } from './notifyStore.js'
import ServicePanel from './ServicePanel.vue'
import ServiceSide from './ServiceSide.vue'
import { forget as forgetHistory, historyFor, pick as pickHistory } from './stores/service-history.js'
import {
  vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle, bindPanelMaximize, readHashRoute, hashRoute, setRoute,
} from './workbench.js'

/* Lo pesado se baja sólo cuando se usa: el lector de PDF (pdf.js) al abrir un PDF o al mostrar su miniatura. Así
   abrir el chat no lo carga. */
const PdfPages = defineAsyncComponent(() => import('./PdfPages.vue'))
const PdfThumb = defineAsyncComponent(() => import('./PdfThumb.vue'))

const chat = useChatStore()
/* En «Mi chat», la región de la DERECHA (`auxiliarybar`) es tu perfil —avisos, voz, llavero y conexión—, al lado de
   tu bandeja. En otra conversación no está. Se cierra con su ✕ o el botón del
   pie, y recuerda si quedó cerrada y su ancho. */
const agentOpen = ref(readSize('chat.agente-open', 1) !== 0)
const agentW = ref(readSize('chat.agente-w', 380))
// En angosto, cerrarlo sólo vuelve al chat: no se guarda, para que en la pantalla ancha siga donde estaba.
function setAgentOpen(v) { if (!v && narrow.value) { narrowRight.value = false; return } agentOpen.value = v; saveSize('chat.agente-open', v ? 1 : 0) }
// «Mi chat»: tu bandeja en el editor y tu perfil a la derecha.
/* Eliminar un grupo: si lo creaste vos, se borra para todos (cuadrilla, donde viven los grupos, deja borrarlo a quien
   lo creó). Si lo creó otro, salís; y si quedás sin nadie, se borra solo. Lo dice antes de hacerlo. */
const groupDeleteError = ref('')
async function deleteGroup(g) {
  const others = (g.person.members || []).filter((m) => !chat.isMe({ email: String(m).split("/")[0] })).length
  const mine = chat.isMe({ email: g.person.owner || '' })
  const msg = mine || !others
    ? (others
      ? `¿Eliminar ${g.person.name}? Si el servidor del equipo ya permite borrarlo, se borra también para ${others === 1 ? 'el otro miembro' : `los otros ${others}`}; si no, salís vos y sigue para ell${others === 1 ? 'e' : 'os'}. No se puede deshacer.`
      : `¿Eliminar ${g.person.name}? Sos el único miembro: se borra para siempre.`)
    : `¿Salir de ${g.person.name}? Lo creó ${g.person.owner}: sigue existiendo para ${others === 1 ? 'el otro miembro' : `los otros ${others}`}.`
  if (!window.confirm(msg)) return
  groupDeleteError.value = ''
  try {
    if (chat.activeKey === g.person.email) chat.activeKey = ''
    const r = await chat.leaveGroup(g.person.email)
    // Si era tuyo y quedó gente, es que todavía no se puede borrar para todos: saliste vos.
    if (r?.others) groupDeleteError.value = `Saliste de ${g.person.name}, pero sigue para los demás: borrarlo para todos todavía no está disponible en el servidor del equipo.`
  } catch (e) { groupDeleteError.value = `No se pudo: ${e.message}` }
}
function deleteConversation(c) {
  if (window.confirm(`¿Borrar la conversación con ${c.person.name || c.person.email}? Sólo se borra de este navegador.`)) chat.removeConversation(c.person.email)
}
// Tu @ en el chat del equipo: la parte del correo antes de la arroba, como te escriben (`playground send @miguel`).
const myHandle = computed(() => { const e = chat.state?.session?.email || chat.me?.email || ''; return e ? `@${e.split('@')[0]}` : '' })

/* ── MENCIONES EN LOS GRUPOS (mentions.js): `@usuario`, `@usuario/agente` o `@todos`, dentro del texto. Se autocompletan
   al escribir, se resaltan y, la que te nombra, marca su burbuja, el grupo en la lista y su aviso. */
const myUser = computed(() => myHandle.value.slice(1).toLowerCase())
const myAgentNames = computed(() => chat.agentsOf(chat.meKey).map((a) => a.name))
const activeIsGroup = computed(() => !!chat.active?.person.group)
const membersOf = (person) => chat.groups.find((g) => `#${g.id}` === person?.email)?.members || person?.members || []
const groupMembers = computed(() => (activeIsGroup.value ? membersOf(chat.active.person) : []))
const knownHandles = computed(() => new Set(groupMembers.value.map(handleOf)))
// El nombre de alguien por su correo: de su conversación o de quién está conectado; si no, su usuario.
function nameOfEmail(email) {
  const key = String(email || '').toLowerCase()
  return chat.conversations[key]?.person.name || chat.online.find((p) => String(p.email || '').toLowerCase() === key)?.name || key.split('@')[0]
}
// El nombre de una conversación por su clave (`#grupo` o un correo), para la lista de excepciones de los avisos.
const conversationName = (key) => (String(key).startsWith('#') ? key : nameOfEmail(key))
const mentionsMeIn = (text) => mentionsMe(text, myUser.value, myAgentNames.value)
const textSegments = (text) => segments(text, knownHandles.value, myUser.value, myAgentNames.value)
/* A QUIÉN VA, COMO EN WHATSAPP: lo escrito para un agente (`toAgent`, el tuyo para el de alguien; `forAgent`, el de
   alguien para uno tuyo) empieza con la mención, «@luigi …», en vez de una etiqueta aparte. Si el texto ya la trae, no
   se repite. */
const mentionOf = (item) => {
  const a = item?.toAgent || item?.forAgent || ''
  return a && !String(item.text || '').trimStart().toLowerCase().startsWith(`@${a.toLowerCase()}`) ? `@${a}` : ''
}
// Las menciones a vos que todavía no leíste en un grupo de la lista.
const unreadMentions = (g) => (g.messages || []).filter((m) => m.dir === 'in' && m.time > (g.readAt || '') && mentionsMeIn(m.text)).length
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
/* LAS FOTOS DE GOOGLE: la de cada persona viene con ella (el home la manda en quién está conectado y en cada mensaje);
   la tuya, de tu sesión. Sin foto, las iniciales de siempre. Se piden sin «referer»: así las sirve Google. */
const myPhoto = computed(() => chat.state?.session?.picture || '')
const photoOf = (p) => {
  const email = String(p?.email || '').toLowerCase()
  if (email && email === chat.meKey) return myPhoto.value
  return p?.picture || chat.online.find((o) => String(o.email || '').toLowerCase() === email)?.picture || ''
}
// Los agentes de una persona, por nombre: para el título de su muñequito.
const agentNames = (p) => chat.agentsOf(p?.email).map((a) => a.name).join(', ')
/* EL COLOR DE CADA AGENTE: sale de su nombre, así es siempre el mismo (en el borde del muñequito de su dueño y en su
   propio muñequito dentro del chat). Colores que se leen sobre el tema claro y el oscuro. */
const AGENT_COLORS = ['#e8735a', '#d99a2b', '#4fae6e', '#2fa3c4', '#5b7fe6', '#9a68dd', '#cf5aa8', '#3fb3a3']
function baseColor(name) {
  let h = 0
  for (const ch of String(name || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return h % AGENT_COLORS.length
}
/* Dentro de una persona, dos agentes no comparten color: en orden de nombre, el que choca toma el siguiente libre. Así
   el color de su parte del borde y el de su muñequito en el chat son el mismo. */
function agentColor(name, ownerEmail) {
  const names = chat.agentsOf(ownerEmail).map((a) => a.name).sort()
  if (!names.includes(name)) return AGENT_COLORS[baseColor(name)]
  const used = new Set()
  for (const n of names) {
    let i = baseColor(n)
    for (let k = 0; k < AGENT_COLORS.length && used.has(i); k++) i = (i + 1) % AGENT_COLORS.length
    used.add(i)
    if (n === name) return AGENT_COLORS[i]
  }
  return AGENT_COLORS[baseColor(name)]
}
/* EL BORDE PARTIDO: alrededor del muñequito, una parte por agente, cada una de su color (como las historias de
   WhatsApp). Un círculo SVG por parte, con stroke-dasharray; con un solo agente, el borde entero. */
const RING_R = 19.5
const RING_C = 2 * Math.PI * RING_R
function ringOf(p) {
  const list = chat.agentsOf(p?.email)
  const n = list.length
  if (!n) return []
  const gap = n > 1 ? 6 : 0
  const seg = RING_C / n - gap
  return list.map((a, i) => ({ name: a.name, color: agentColor(a.name, p?.email), dash: `${seg} ${RING_C - seg}`, offset: -i * (RING_C / n) }))
}
/* QUIÉN HABLA EN UN MENSAJE, como en un grupo de WhatsApp aunque el chat sea privado: la persona o uno de sus agentes
   (`via`). Lo tuyo sólo se marca si salió como uno de tus agentes (`asAgent`). */
function speakerOf(item) {
  if (item.dir === 'out') return item.asAgent ? { agent: item.asAgent, mine: true, label: `${item.asAgent} · tu agente` } : null
  const owner = item.author || chat.active?.person || {}
  if (item.via) return { agent: item.via, mine: false, owner, label: `${item.via} · agente de ${firstName(owner)}` }
  // Firmado en el texto (`signatureOf`): habla el agente, como en un grupo; de quién es, al pasar el mouse.
  if (item.signedAgent) return { agent: item.signedAgent, mine: false, owner, label: `${item.signedAgent} · ${item.signedRole}` }
  return { person: owner, label: owner.name || owner.email || '' }
}

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
/* Antes del primer pintado, lo que dice la URL: sin esto la app arranca un instante en «Mi chat» aunque se entre
   directo a una conversación. La ruta entera (abrir, marcar leído) se aplica al montar. */
{
  const { parts } = readHashRoute()
  const key = routeKey()
  if (parts[0] === 'server' && parts[1]) serverOpen.value = parts[1]
  else if (key && chat.conversations[key]) chat.activeKey = key
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
/* EL LLAVERO es la consola de una conversación (KeyringPanel.vue): se abre y se cierra aparte de la de los servers. */
const keyringOpen = ref(readSize('chat.keyring-open', 0) !== 0)
const keyringContext = computed(() => !!chat.activeKey && !serverOpen.value)
function setKeyringOpen(v) { keyringOpen.value = v; saveSize('chat.keyring-open', v ? 1 : 0) }
function toggleConsole() { if (keyringContext.value) setKeyringOpen(!panelShown.value); else setConsoleOpen(!panelShown.value) }
/* Un servicio: sus rutas a la derecha (se cierran y se recuerdan aparte) y su historial abajo, en la consola, que es la
   misma de los servers. */
/* FOTOS Y ARCHIVOS, por defecto en la derecha de cada conversación con una persona o un grupo (como «Archivos,
   enlaces y documentos» de WhatsApp): agrupados por día, las fotos en grilla y debajo los documentos. Tocar uno lo abre
   ahí mismo; «Volver» regresa a la lista. Se muestra u oculta desde la cabecera y se recuerda. */
const mediaOpen = ref(readSize('chat.media-open', 1) !== 0)
// En angosto, cerrarlo sólo vuelve al chat: no se guarda, para que en la pantalla ancha siga donde estaba.
function setMediaOpen(v) { if (!v && narrow.value) { narrowRight.value = false; return } mediaOpen.value = v; saveSize('chat.media-open', v ? 1 : 0) }
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
const mediaContext = computed(() => !!chat.active && !serverOpen.value && !activeIsAgent.value && !activeIsCanon.value && !activeIsCuadrilla.value)
// Qué es el sidebar derecho en lo que está abierto (para el botón de la barra de abajo); vacío si no hay.
const rightKind = computed(() => docView.value ? 'el documento' : openService.value ? 'las rutas' : serverOpen.value ? ''
  : mediaContext.value ? 'fotos y archivos' : !chat.activeKey ? 'tu perfil' : '')
function toggleRight() {
  if (narrow.value) {
    if (narrowList.value) return
    if (showingNarrowRight.value) { narrowRight.value = false; return }
    narrowRight.value = true
    if (rightOpen.value) return
  }
  const open = !agentShown.value
  if (docView.value) { closeDoc(); if (mediaContext.value) setMediaOpen(false); return }
  if (openService.value) setRoutesOpen(open)
  else if (mediaContext.value) setMediaOpen(open)
  else if (!chat.activeKey) setAgentOpen(open)
}
const rightOpen = computed(() => {
  if (docView.value) return true
  if (openService.value) return routesOpen.value
  if (serverOpen.value) return false
  if (mediaContext.value) return mediaOpen.value
  return agentOpen.value && !chat.activeKey
})
// Si no entra todo, se pliega primero la derecha (tu agente) y después las conversaciones, como en VS Code.
const fitted = computed(() => fitRegions(viewportW.value - cssSize('--editor-min', 360), [
  { size: rightOpen.value ? agentW.value : 0, min: 320 },
  { size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 240) },
]))
/* ANGOSTO (un celular): si las conversaciones no entran al lado del chat, se ve una cosa por vez, como WhatsApp.
   La lista ocupa todo; tocar una conversación la abre, y «Volver» en su cabecera regresa a la lista. Sin una ruta en
   la URL se arranca en la lista. */
const narrow = computed(() => viewportW.value < cssSize('--sidebar-min', 240) + cssSize('--editor-min', 360))
const narrowList = ref(!location.hash)
/* La derecha (fotos y archivos, la ficha del agente) es una tercera pantalla: se abre con su botón de la barra de abajo
   y se cierra con su ✕ o con el mismo botón. */
const narrowRight = ref(false)
const showingNarrowList = computed(() => narrow.value && narrowList.value)
const showingNarrowRight = computed(() => narrow.value && !narrowList.value && narrowRight.value && rightOpen.value)
function onSidebarPick(e) { if (e.target.closest?.('.conversation')) { narrowList.value = false; narrowRight.value = false } }
const agentShown = computed(() => (narrow.value ? (showingNarrowRight.value ? viewportW.value : 0) : fitted.value[0]))
const sidebarShown = computed(() => (narrow.value ? (narrowList.value ? viewportW.value : 0) : fitted.value[1]))
const panelShown = computed(() => fitRegions(viewportH.value - 200, [
  { size: (serverOpen.value && consoleOpen.value) || (keyringContext.value && keyringOpen.value) ? consoleH.value : 0, min: cssSize('--panel-min', 124) },
])[0])
const layoutVars = computed(() => ({
  '--sidebar-w': `${sidebarShown.value}px`, '--auxiliarybar-w': `${agentShown.value}px`, '--panel-h': `${panelShown.value}px`,
}))
const consoleResize = {
  label: 'Alto de la consola', axis: 'y', sign: -1, defaultValue: 240,
  min: () => cssSize('--panel-min', 124),
  max: () => viewportH.value - 200,
  get: () => panelShown.value,
  set: (v) => { const open = keyringContext.value ? keyringOpen : consoleOpen; if (!v) open.value = false; else { open.value = true; consoleH.value = v } },
  reopen: () => consoleH.value,
  commit: (v) => { saveSize(keyringContext.value ? 'chat.keyring-open' : 'chat.server-console-open', v ? 1 : 0); if (v) saveSize('chat.server-console-h', consoleH.value) },
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
    if (docView.value && !v) { closeDoc(); if (mediaContext.value) setMediaOpen(false); return }
    if (docView.value) { if (v) agentW.value = v; return }
    if (mediaContext.value) { setMediaOpen(!!v); if (v) agentW.value = v; return }
    if (openService.value) routesOpen.value = !!v
    else if (serverOpen.value) { /* un server no tiene región derecha */ }
    else agentOpen.value = !!v
    if (v) agentW.value = v
  },
  reopen: () => agentW.value,
  commit: (v) => {
    saveSize(openService.value ? 'chat.service-routes-open' : serverOpen.value ? 'chat.server-share-open' : 'chat.agente-open', v ? 1 : 0)
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
  if (narrow.value) { narrowList.value = !narrowList.value; return }
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
  // Como WhatsApp: dentro de la última semana, sólo el día («martes»); antes, la fecha, con el año si no es este.
  const date = new Date(iso)
  const label = Date.now() - date < 6 * 864e5
    ? date.toLocaleDateString('es-CO', { timeZone: TZ, weekday: 'long' })
    : date.toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'long',
        ...(dayOf(iso).slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
const initials = (p) => (p?.name || p?.email || '?').split(/[^\p{L}]+/u).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
const handle = (p) => `@${(p?.email || '').split('@')[0]}`
const firstName = (p) => String(p?.name || p?.email || '').split(/[\s@]+/)[0]
// La firma con la que un agente del equipo escribe por su dueño: «Rambo (agente de Duncan): …».
const AGENT_SIGNATURE = /^(\S{1,24}) \(agente de ([^)]{1,40})\):\s*/u
// …o al final, como las respuestas automáticas: «… — Jairo, oficina de QA de Duncan (respuesta automática)».
const AGENT_SIGNATURE_END = /\s*[—–]\s*(\p{Lu}\S{0,23}), ([^\n()]{3,60}?) \((respuesta automática)\)\s*$/u
// Quién firma un mensaje que llegó a nombre de una persona: el agente, de quién es (para el hover) y el texto sin la firma.
function signatureOf(text) {
  const t = String(text || '')
  const start = AGENT_SIGNATURE.exec(t)
  if (start) return { agent: start[1], role: `agente de ${start[2]}`, body: t.slice(start[0].length) }
  const end = AGENT_SIGNATURE_END.exec(t)
  if (end && end.index > 0) return { agent: end[1], role: `${end[2]} (${end[3]})`, body: t.slice(0, end.index) }
  return null
}
const snippetOf = (m, bare = false) => {
  if (!m) return ''
  if (m.kind === 'asked') return `le preguntó a tu ${m.agent}: ${m.text}`
  // Un mensaje con adjuntos y sin texto se ve por sus adjuntos.
  const body = (signatureOf(m.text)?.body ?? m.text ?? '') || (m.files?.length ? m.files.map((f) => `📎 ${f.name}`).join(' · ') : '')
  return `${m.dir === 'out' && !bare ? 'Vos: ' : ''}${body}`
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
/* LA VIDEOLLAMADA: los de esta conversación como personajes (CallView, con los de ./personajes). Se abre con el botón de
   la cámara del encabezado y queda abierta sólo en la conversación donde se abrió. Por ahora es sólo visual. */
const callCast = computed(() => {
  const p = chat.active?.person
  if (!p || p.tool) return []
  const members = p.group ? (chat.groups.find((g) => `#${g.id}` === p.email)?.members || p.members || []) : []
  const keys = [chat.meKey, ...(p.group ? members : p.agent ? [p.owner?.email] : [p.email])].filter(Boolean)
  return callCastOf(keys)
})
// la videollamada tiene sentido si además de vos hay alguien con personaje: otra persona, o en un grupo un agente (en
// «Mi chat» no, aunque tus agentes estén: no hay con quién hablar)
const callAvailable = computed(() => callCast.value.some((c) => (c.handle && c.handle.toLowerCase() !== (chat.meKey || '').split('@')[0])
  || (c.agent && chat.active?.person?.group)))
const callKey = ref('')
const callOpen = computed(() => callAvailable.value && !!callKey.value && callKey.value === chat.activeKey)
const toggleCall = () => { callKey.value = callOpen.value ? '' : chat.activeKey }
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
/* POR TANDAS, como WhatsApp: se pintan los últimos PAGE mensajes y, al llegar arriba, la tanda anterior, sin que la
   vista salte. Una conversación larga abre al toque y lo viejo se trae cuando se pide. */
const PAGE = 60
const shown = ref(PAGE)
const hiddenCount = computed(() => Math.max(0, (chat.active?.messages?.length || 0) - shown.value))
const thread = computed(() => {
  const out = []
  let day = ''
  let prev = null
  let prevSigned = ''
  const all = chat.active?.messages || []
  for (const m of all.slice(Math.max(0, all.length - shown.value))) {
    const d = dayOf(m.time)
    if (d !== day) { day = d; out.push({ kind: 'day', id: `day-${d}`, label: dayLabel(m.time) }); prev = null }
    // Firmado por un agente del equipo («Rambo (agente de Duncan): …», o la firma al final de una respuesta automática):
    // habla el agente, con su avatar, y el texto queda limpio.
    const signed = m.dir === 'in' && !m.via && !activeIsAgent.value ? signatureOf(m.text) : null
    const cont = !!prev && prev.dir === m.dir && prev.kind === m.kind && m.kind !== 'asked'
      && prevSigned === (signed?.agent || '')
      && (prev.author?.email || '') === (m.author?.email || '') && (prev.via || '') === (m.via || '')
      && (prev.asAgent || '') === (m.asAgent || '') && (prev.toAgent || '') === (m.toAgent || '')
      && new Date(m.time) - new Date(prev.time) < GROUP_MS
    let quote = null
    if (m.re && !(chat.active.person.agent && m.re === prev?.sid)) {
      const found = chat.findBySid(m.re)
      quote = found
        ? { who: found.message.dir === 'out' ? 'Vos' : signatureOf(found.message.text)?.agent || firstName(found.conversation.person.agent ? { name: found.conversation.person.agentName } : found.conversation.person),
            text: quoteText(signatureOf(found.message.text)?.body ?? found.message.text) }
        : { who: '', text: 'un mensaje que ya no está en este navegador' }
    }
    const extra = signed ? { text: signed.body, signedAgent: signed.agent, signedRole: signed.role } : {}
    out.push({ ...m, ...extra, kind: m.kind || 'message', cont, quote })
    prev = m
    prevSigned = signed?.agent || ''
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
const canReply = (item) => !activeIsAgent.value && item.kind === 'message' && !!item.sid
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
/* LAS CLAVES EN LA CONVERSACIÓN: viajan como texto (`🔑 Pido tu llavero`, la lista, `🔑 Pido estas claves` y el bloque .env) y se pintan como tarjeta (KeyCard). */
const keyInfoCache = new Map()
function keyInfo(item) {
  if (!item.text || !/^[🔒🔑]/u.test(item.text)) return null
  if (!keyInfoCache.has(item.text)) keyInfoCache.set(item.text, parseKeyText(item.text))
  return keyInfoCache.get(item.text)
}
async function askKeys(names, re) {
  await chat.send(askKeysMessage(names), re || '', null, {}, [])
}
// A mano (si «Compartir mi llavero» está apagado): las pedidas que tenés, en un bloque .env.
async function sendKeysByName(names, re) {
  await loadKeyring()
  const keys = names.map((n) => keyring.saved.find((x) => x.name === n)).filter(Boolean)
  if (keys.length) await chat.send(envMessage(keys), re || '', null, {}, [])
}
// Quién es el otro en una tarjeta: el que lo mandó en un grupo, o la persona de la conversación.
const keyWho = (item) => firstName(item.dir === 'in' && item.from?.name ? item.from : chat.active.person)
loadKeyring()
async function submit() {
  const text = draft.value.trim()
  // En «Mi chat» te escribís a vos mismo: lo leen tus agentes (`bin/chat history <vos>`), no sale a nadie más.
  if (!chat.active) {
    if (!text) return
    draft.value = ''
    await nextTick(); autosize()
    await chat.send(text, '', chat.ensure({ email: chat.meKey, name: (chat.me || chat.state?.session)?.name || '' }))
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
const canAttach = computed(() => !!chat.active && !chat.active.person.agent && !chat.active.person.group && !chat.active.person.tool)
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
const docView = ref(null)   // { kind: 'pdf' | 'image', item, f }
const docLoading = ref('')
async function openDoc(item, f) {
  if (f.status !== 'bajado') {
    docLoading.value = f.id || f.name
    try { await chat.getFile(item, f, { cache: true }) } finally { docLoading.value = '' }
    if (f.status !== 'bajado') return
  }
  docView.value = { kind: 'pdf', item, f }
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
/* LA GALERÍA, en la región de la derecha: tocar una imagen la abre ahí, grande, con todas las de la conversación para
   pasar con ‹ › o las flechas del teclado. «Ampliar» la lleva a pantalla completa (la vista de siempre). */
function openImage(item, f) { if (imageSrc(item, f)) docView.value = { kind: 'image', item, f } }
function zoomImage() {
  const v = docView.value
  const src = v && imageSrc(v.item, v.f)
  if (src) lightbox.value = { src, name: v.f.name, item: v.item, f: v.f }
}
const mediaDays = computed(() => {
  const days = []
  for (const m of chat.active?.messages || []) {
    for (const f of m.files || []) {
      const d = dayOf(m.time)
      let day = days.at(-1)
      if (!day || day.key !== d) { day = { key: d, label: dayLabel(m.time), items: [] }; days.push(day) }
      day.items.push({ item: m, f })   // fotos y archivos juntos, en el orden en que llegaron
    }
  }
  return days.reverse()   // lo más nuevo arriba
})
const mediaCount = computed(() => mediaDays.value.reduce((n, d) => n + d.items.length, 0))
// Un PDF cuya portada no se pudo dibujar queda con su tipo, sin volver a intentarlo.
const thumbFailed = reactive(new Set())
const pdfThumbOf = (e) => isPdf(e.f) && e.f.status === 'bajado' && !thumbFailed.has(e.f.id || e.f.name) ? chat.fileUrl(e.f) : ''
function openMedia(entry) {
  if (isImage(entry.f)) { if (imageSrc(entry.item, entry.f)) openImage(entry.item, entry.f); return }
  if (isPdf(entry.f) && entry.f.id) openDoc(entry.item, entry.f)
}
const galleryItems = computed(() => {
  const out = []
  for (const m of chat.active?.messages || []) for (const f of m.files || []) if (isImage(f) && imageSrc(m, f)) out.push({ item: m, f })
  return out
})
const galleryIndex = computed(() => (docView.value?.kind === 'image' ? galleryItems.value.findIndex((g) => g.f === docView.value.f) : -1))
function galleryGo(step) {
  const list = galleryItems.value
  if (!list.length || galleryIndex.value < 0) return
  const next = list[(galleryIndex.value + step + list.length) % list.length]
  docView.value = { kind: 'image', item: next.item, f: next.f }
}
const galleryWho = (item) => (item.dir === 'out' ? 'Vos' : item.author?.name || firstName(chat.active?.person))
const galleryWhen = (iso) => { try { return new Date(iso).toLocaleString('es-CO', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
// Las flechas pasan de imagen y Esc cierra la galería, salvo mientras escribís.
function onGalleryKey(e) {
  if (docView.value?.kind !== 'image' || lightbox.value || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return
  if (e.key === 'ArrowLeft') { e.preventDefault(); galleryGo(-1) }
  else if (e.key === 'ArrowRight') { e.preventDefault(); galleryGo(1) }
  else if (e.key === 'Escape') closeDoc()
}
onMounted(() => window.addEventListener('keydown', onGalleryKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onGalleryKey))
// La miniatura de la actual, siempre a la vista en la tira.
watch(() => docView.value?.f, async () => { await nextTick(); document.querySelector('.gallery-thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'center' }) })
function onLightboxKey(e) { if (e.key === 'Escape') lightbox.value = null }
watch(lightbox, (v) => (v ? window.addEventListener('keydown', onLightboxKey) : window.removeEventListener('keydown', onLightboxKey)))
// El menú de @: lo que se escribió después de la @ y cuál está elegido. Sólo en grupos.
const mention = ref(null)   // { start, query, index }
const mentionOptions = computed(() => (mention.value ? candidates(groupMembers.value, mention.value.query, nameOfEmail, myUser.value) : []))
function updateMention() {
  const el = composer.value
  if (!activeIsGroup.value || !el) { mention.value = null; return }
  const q = activeQuery(draft.value, el.selectionStart ?? draft.value.length)
  mention.value = q ? { ...q, index: mention.value?.query === q.query ? mention.value.index : 0 } : null
}
function onComposerInput() { autosize(); updateMention() }
// Un emoji del selector (EmojiButton): entra donde estaba el cursor, o reemplaza lo seleccionado, y el foco vuelve a la
// caja para seguir escribiendo. Vacío (Esc): sólo vuelve el foco.
/* DICTAR (DictationButton): el micrófono ocupa el lugar de «mandar» cuando no hay nada para mandar, sólo si el
   servidor dice que Whisper está listo (GET /api/dictate); mientras graba o transcribe se queda aunque haya texto. */
const dictationReady = ref(false)
const dictationState = ref({ phase: 'idle', seconds: 0, error: '' })
fetch('/api/dictate').then((r) => r.json()).then((d) => { dictationReady.value = !!d.ready }).catch(() => {})
const showDictation = (empty) => dictationReady.value && (empty || dictationState.value.phase !== 'idle')
let dictationErrorTimer = 0
function onDictationState(s) {
  dictationState.value = { error: '', ...s }
  clearTimeout(dictationErrorTimer)
  if (s.error) dictationErrorTimer = setTimeout(() => { dictationState.value = { ...dictationState.value, error: '' } }, 6000)
}
const dictationNote = computed(() => {
  const s = dictationState.value
  if (s.error) return s.error
  if (s.phase === 'recording') return `● Escuchando ${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, '0')} · tocá ■ para terminar, Esc cancela`
  if (s.phase === 'working') return 'Transcribiendo en tu máquina…'
  return ''
})
// Un texto dictado entra como un emoji, con un espacio antes si lo anterior no termina en uno.
function insertDictation(text) {
  const el = composer.value
  const start = el?.selectionStart ?? draft.value.length
  insertEmoji(start > 0 && !/\s$/.test(draft.value.slice(0, start)) ? ` ${text}` : text)
}
async function insertEmoji(emoji) {
  const el = composer.value
  if (!el) return
  const start = el.selectionStart ?? draft.value.length
  const end = el.selectionEnd ?? start
  if (emoji) draft.value = draft.value.slice(0, start) + emoji + draft.value.slice(end)
  await nextTick()
  const caret = start + (emoji ? emoji.length : 0)
  el.focus(); el.setSelectionRange(caret, caret); autosize()
}
async function pickMention(option) {
  const m = mention.value
  const el = composer.value
  if (!m || !option || !el) return
  const end = el.selectionStart ?? draft.value.length
  const insert = `@${option.handle} `
  draft.value = draft.value.slice(0, m.start) + insert + draft.value.slice(end).replace(/^ /, '')
  mention.value = null
  await nextTick()
  const caret = m.start + insert.length
  el.focus(); el.setSelectionRange(caret, caret); autosize()
}
function onKeydown(e) {
  if (mentionOptions.value.length) {
    const n = mentionOptions.value.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      mention.value.index = (mention.value.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.isComposing) { e.preventDefault(); pickMention(mentionOptions.value[mention.value.index]); return }
    if (e.key === 'Escape') { e.preventDefault(); mention.value = null; return }
  }
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
const canSubmit = computed(() => {
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
watch(() => chat.activeKey, () => { taskTarget.value = null; mention.value = null; stopSpeech(); if (activeIsCuadrilla.value) chat.loadCuadrilla() })
function autosize() {
  const el = composer.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}
const notesEl = ref(null)
/* «MI CHAT»: lo que vos y tus agentes se dicen entre ustedes por el chat (`bin/chat send <vos> … --as luigi`: la
   conversación con vos mismo). Lo
   que dice uno de tus agentes va a la izquierda, con su muñequito de color; lo tuyo, a la derecha. */
const myThread = computed(() => {
  // Cada mensaje una vez, por su id del home: si quedaron el enviado y el recibido (te lo mandaste a vos), el enviado.
  const all = chat.conversations[chat.meKey]?.messages || []
  const sentIds = new Set(all.filter((m) => m.dir === 'out' && m.sid).map((m) => m.sid))
  const self = all.filter((m) => !(m.dir === 'in' && sentIds.has(m.sid || m.id)))
  const items = self.map((m) => ({ kind: 'self', id: `self|${m.id}`, time: m.time, m, agent: m.asAgent || m.via || '' })).sort((a, b) => String(a.time).localeCompare(String(b.time)))
  // Seguidos del mismo que habla, a pocos minutos: una tanda (el muñequito y el nombre sólo en la primera).
  let prev = null
  for (const it of items) {
    const who = it.agent ? `agente:${it.agent}` : 'yo'
    it.cont = !!prev && prev.who === who && new Date(it.time) - new Date(prev.time) < GROUP_MS
    it.who = who
    prev = it
  }
  return items
})
const myLast = computed(() => myThread.value.at(-1) || null)
/* TUS AGENTES (la pestaña «Agentes» del perfil): elegir uno deja en Mi chat sólo lo suyo —lo que dijo y lo que le
   escribiste a él—; tocarlo de nuevo, o la ✕ de la cabecera, vuelve a todo. */
const myAgents = computed(() => [...chat.agentsOf(chat.meKey)].sort((a, b) => String(b.lastActive || '').localeCompare(String(a.lastActive || ''))))
const agentFilter = ref('')
function toggleAgentFilter(name) {
  agentFilter.value = agentFilter.value === name ? '' : name
  if (chat.activeKey) openMyChat()
  scrollNotesToEnd()
}
const shownThread = computed(() => {
  const f = agentFilter.value
  if (!f) return myThread.value
  const mentioned = new RegExp(`(^|\\s)@${f}\\b`, 'i')
  const kept = myThread.value.filter((it) => it.agent === f || (!it.agent && (it.m.toAgent === f || it.m.forAgent === f || mentioned.test(it.m.text || ''))))
  // Las tandas se vuelven a armar: sin los de en medio, dos seguidos pueden quedar juntos o separarse.
  return kept.map((it, i) => ({ ...it, cont: i > 0 && kept[i - 1].who === it.who && new Date(it.time) - new Date(kept[i - 1].time) < GROUP_MS }))
})
// Si el agente elegido se borra, el filtro se va con él.
watch(myAgents, (list) => { if (agentFilter.value && !list.some((a) => a.name === agentFilter.value)) agentFilter.value = '' })
const removeAgentError = ref('')
async function removeAgent(name) {
  if (!window.confirm(`¿Borrar a ${name}? Sale de tu lista (sus mensajes quedan). Si una sesión vuelve a hablar como ${name}, renace.`)) return
  removeAgentError.value = ''
  try { await chat.removeAgent(name) } catch (e) { removeAgentError.value = e.message }
}
// «hace 5 min», «hace 2 h», «hace 3 días»: cuándo habló por última vez.
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60_000))
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  if (min < 48 * 60) return `hace ${Math.round(min / 60)} h`
  return `hace ${Math.round(min / 1440)} días`
}
async function scrollNotesToEnd() {
  await nextTick()
  if (notesEl.value) notesEl.value.scrollTop = notesEl.value.scrollHeight
}
watch(() => chat.activeKey, (key) => { if (!key) scrollNotesToEnd() })
// Lo que llega a «Mi chat» (un mensaje tuyo o de tus agentes) y la primera vez que se pinta: abajo de todo.
watch(() => myThread.value.length, () => { if (!chat.activeKey) scrollNotesToEnd() }, { immediate: true })
const atBottom = ref(true)
const unseen = ref(0)          // los que llegaron mientras mirabas más arriba
let loadingOlder = false
async function scrollToEnd(smooth = false) {
  await nextTick()
  const el = threadEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  atBottom.value = true
  unseen.value = 0
}
async function loadOlder() {
  const el = threadEl.value
  if (!el || loadingOlder || !hiddenCount.value) return
  loadingOlder = true
  const before = el.scrollHeight - el.scrollTop
  shown.value += PAGE
  await nextTick()
  el.scrollTop = el.scrollHeight - before   // la vista queda donde estaba
  loadingOlder = false
}
function onThreadScroll() {
  const el = threadEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  if (atBottom.value) unseen.value = 0
  if (el.scrollTop < 120) loadOlder()
}
watch(() => chat.activeKey, () => { shown.value = PAGE; scrollToEnd() })
// Al cargar la página con una conversación ya elegida no hay cambio de activeKey: se baja cuando aparece el hilo.
watch(() => !!thread.value.length, (has) => { if (has) scrollToEnd() }, { immediate: true })
// Una imagen o un PDF que termina de cargar empuja el contenido: si estabas abajo, se sigue abajo.
function onMediaLoad() { if (atBottom.value) scrollToEnd() }
watch(() => chat.active?.messages.length, (n, old) => {
  const last = chat.active?.messages.at(-1)
  // Lo que mandaste vos siempre lleva al final; lo que llega, sólo si ya estabas abajo.
  if (atBottom.value || last?.dir === 'out') { shown.value += Math.max(0, (n || 0) - (old || 0)); scrollToEnd() }
  else if (n > old) { shown.value += n - old; unseen.value += n - old }
})
watch(() => chat.activeKey, async (key) => {
  // El de la conversación que se abre (el de la anterior ya quedó guardado al escribirlo).
  draft.value = drafts[draftKey(key)] || ''
  replyTo.value = null
  await nextTick(); autosize(); composer.value?.focus()
})
const activeIsCanon = computed(() => chat.active?.person.tool === 'canon')
const sendLabel = computed(() => (activeIsCuadrilla.value ? 'Anotar' : activeIsCanon.value ? 'Preguntar' : 'Mandar'))
const placeholder = computed(() => {
  if (activeIsCuadrilla.value) {
    const t = taskTarget.value
    if (!t) return 'Elegí una tarea de arriba para anotar en ella'
    if (t.kind === 'bloqueo') return 'Qué falta'
    if (t.kind === 'desbloqueo') return 'Qué lo destrabó (opcional)'
    return 'Qué pasó, en una línea'
  }
  if (!activeIsAgent.value) return 'Escribí un mensaje'
  if (activeIsCanon.value) return 'Preguntale a canon cómo funciona algo de CreditOp'
  return activeOwnerIsMe.value ? `Escribile a tu agente ${activeTitle.value}` : `Escribile a ${activeTitle.value}, agente de ${firstName(activeOwner.value)}`
})

// La pregunta que canon sugiere para seguir: un clic la hace.
async function askNext(text) {
  await chat.send(text)
}

function clearActive() {
  const c = chat.active
  if (c && window.confirm(`¿Vaciar la conversación con ${c.person.name || c.person.email}? Se borran sus mensajes de este navegador.`)) chat.clearMessages(c.person.email)
}
function clearMyChat() {
  if (window.confirm('¿Vaciar «Mi chat»? Se borran sus mensajes de este navegador.')) chat.clearMessages(chat.meKey)
}
// Borrar la conversación, igual que su ✕ del sidebar: sale de la lista y lo ya recibido no vuelve (forget sola la sacaba
// de la lista, pero `listen` la traía de nuevo con todos sus mensajes).
function forgetActive() {
  if (chat.active) deleteConversation(chat.active)
}

// El título de la pestaña dice cuántos no leídos hay, como cualquier chat.
// …y en la app de escritorio, el globito del Dock.
watch(() => chat.unreadTotal, (n) => { document.title = n ? `(${n}) chat` : 'chat'; setBadge(n) }, { immediate: true })
/* LOS AVISOS (server/notify.go): los decide el servidor con la configuración de «Avisos», también con la ventana
   cerrada, y los muestra macOS (tocarlos abre la conversación en la app). La ventana le cuenta qué conversación tenés
   al frente para no avisarte de ésa. */
/* EL PERFIL: el panel derecho de «Mi chat». Junta lo tuyo en secciones por icono — tus agentes, los avisos, la voz, el llavero y
   la conexión — en vez de tenerlo repartido en la barra de abajo y en diálogos. */
const PROFILE_TABS = [
  { id: 'agents', label: 'Tus agentes' },
  { id: 'notify', label: 'Avisos', icon: 'bell' },
  { id: 'voice', label: 'Voz', icon: 'play' },
  { id: 'keyring', label: 'Llavero', icon: 'key' },
  { id: 'connection', label: 'Conexión', icon: 'server' },
]
const profileTab = ref(PROFILE_TABS.some((t) => t.id === readPref('chat.profile-tab', '')) ? readPref('chat.profile-tab', '') : 'agents')
function setProfileTab(id) { profileTab.value = id; savePref('chat.profile-tab', id) }
function openProfile(tab) {
  serverOpen.value = ''; chat.activeKey = ''; setAgentOpen(true)
  if (tab) setProfileTab(tab)
  narrowList.value = false; narrowRight.value = true
  if (tab === 'notify') loadNotify()
}
function openNotify() { openProfile('notify') }
// Qué tenés al frente: la conversación abierta (o ninguna) y si la pestaña tiene el foco.
const viewKey = computed(() => (serverOpen.value ? '' : chat.activeKey))
const sendView = (opts) => reportView(viewKey.value, document.visibilityState === 'visible' && document.hasFocus(), opts)
watch(viewKey, () => sendView())
const onViewChange = () => sendView()
const onPageHide = () => reportView('', false, { beacon: true })
let viewTimer = null
// El menú de la campana de una conversación: seguir su tipo, o una excepción.
const NOTIFY_LABEL = { all: 'Todos', mentions: 'Sólo menciones', off: 'Ninguno' }
const canNotifyConversation = computed(() => !!chat.active && !activeIsAgent.value && !chat.active.person.tool && !chat.isMe(chat.active.person))
const activeNotifyMode = computed(() => conversationMode(chat.activeKey))
const activeNotifyDefault = computed(() => (activeIsGroup.value ? notify.settings?.groups : notify.settings?.direct) || 'all')
const notifyMenuItems = computed(() => {
  const modes = activeIsGroup.value ? ['all', 'mentions', 'off'] : ['all', 'off']
  return [
    { id: '', label: `Como ${activeIsGroup.value ? 'los grupos' : 'los directos'} (${NOTIFY_LABEL[activeNotifyDefault.value].toLowerCase()})`, selected: !activeNotifyMode.value },
    ...modes.map((m) => ({ id: m, label: m === 'off' ? 'Silenciar' : NOTIFY_LABEL[m], selected: activeNotifyMode.value === m })),
    { separator: true },
    { id: 'settings', label: 'Configurar avisos…', icon: 'bell' },
  ]
})
function onNotifyMenu(id) {
  if (id === 'settings') { openNotify(); return }
  setConversationMode(chat.activeKey, id)
}
const notifyEffective = computed(() => activeNotifyMode.value || activeNotifyDefault.value)
const notifyStatusText = computed(() => {
  const st = notify.settings
  if (!st) return 'avisos'
  if (!st.enabled) return 'avisos apagados'
  return 'avisos'
})

const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  applyRoute()
  chat.start()
  loadServers()
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('popstate', applyRoute)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  loadNotify()
  window.addEventListener('focus', onViewChange)
  window.addEventListener('blur', onViewChange)
  document.addEventListener('visibilitychange', onViewChange)
  window.addEventListener('pagehide', onPageHide)
  sendView({ force: true })
  viewTimer = setInterval(() => sendView({ force: true }), 60_000)
})
onBeforeUnmount(() => {
  chat.stop()
  clearTimeout(serversTimer)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('popstate', applyRoute)
  themeBinding?.destroy?.()
  window.removeEventListener('focus', onViewChange)
  window.removeEventListener('blur', onViewChange)
  document.removeEventListener('visibilitychange', onViewChange)
  window.removeEventListener('pagehide', onPageHide)
  clearInterval(viewTimer)
})

const listening = computed(() => chat.state?.listening)
const statusText = computed(() => {
  const s = chat.state
  if (chat.live && s?.listening) return 'en vivo'
  if (chat.stateError) return 'sin la API de chat'
  if (!s) return 'preguntando al CLI…'
  if (!s.installed) return 'falta el CLI playground'
  if (!s.session) return 'sin sesión'
  if (!s.listening) return 'no estás escuchando'
  return s.connected ? 'escuchando' : 'reconectando'
})
// Al final porque `rightOpen` lee regiones que se declaran más abajo (docView, el agente): cerrar la derecha en angosto vuelve al chat.
watch(rightOpen, (v) => { if (!v) narrowRight.value = false })
</script>

<template>
  <div class="workbench" :class="{ narrow, 'narrow-list': showingNarrowList, 'narrow-right': showingNarrowRight }" :style="layoutVars">
    <aside v-show="sidebarShown" class="sidebar en-bloques" aria-label="Conversaciones" @click.capture="onSidebarPick">
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
              <span class="avatar" :title="agentNames({ email: chat.meKey }) ? `Tus agentes: ${agentNames({ email: chat.meKey })}` : null"><img v-if="myPhoto" class="avatar-photo" :src="myPhoto" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(chat.me || chat.state?.session) }}</template><svg v-if="ringOf({ email: chat.meKey }).length" class="agent-ring" viewBox="0 0 42 42" aria-hidden="true"><circle v-for="s in ringOf({ email: chat.meKey })" :key="s.name" cx="21" cy="21" r="19.5" :stroke="s.color" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" transform="rotate(-90 21 21)"/></svg></span>
              <span class="conversation-main">
                <span class="conversation-top"><b class="name">Mi chat</b></span>
                <span class="conversation-bottom"><span class="snippet">{{ !myLast ? 'vos y tus agentes' : `${myLast.agent || 'Vos'}: ${myLast.m.text}` }}</span><span v-if="chat.selfUnread" class="unread">{{ chat.selfUnread }}</span></span>
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
              <span class="avatar" :title="agentNames(c.person) ? `Sus agentes: ${agentNames(c.person)}` : null"><img v-if="photoOf(c.person)" class="avatar-photo" :src="photoOf(c.person)" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(c.person) }}</template><i v-if="c.online" class="presence"></i><svg v-if="ringOf(c.person).length" class="agent-ring" viewBox="0 0 42 42" aria-hidden="true"><circle v-for="s in ringOf(c.person)" :key="s.name" cx="21" cy="21" r="19.5" :stroke="s.color" :stroke-dasharray="s.dash" :stroke-dashoffset="s.offset" transform="rotate(-90 21 21)"/></svg></span>
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
                    @click.stop="deleteConversation(c)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
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

      <!-- Los grupos (`#ecommerce`): personas y agentes en una misma conversación. Los reparte el home. -->
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
          Sin grupos. Con <b>+</b> creás uno: personas (<code>@dani</code>) y agentes (<code>@miguel/luigi</code>).
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
                  <span class="snippet">{{ g.last ? `${g.last.dir === 'out' ? (g.last.asAgent || 'Vos') : (g.last.via || signatureOf(g.last.text)?.agent || firstName(g.last.author))}: ${snippetOf(g.last, true)}` : `${(g.person.members || []).length} miembros` }}</span>
                  <span v-if="unreadMentions(g)" class="unread at" :title="`Te mencionaron ${unreadMentions(g) === 1 ? 'una vez' : `${unreadMentions(g)} veces`}`">@</span>
                  <span v-if="g.unread" class="unread">{{ g.unread }}</span>
                </span>
              </span>
            </button>
            <button type="button" class="conv-del" aria-label="Eliminar o salir del grupo"
                    :title="chat.isMe({ email: g.person.owner || '' }) ? 'Eliminar grupo (para todos)' : 'Salir del grupo'"
                    @click.stop="deleteGroup(g)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
          </li>
        </ul>
        <p v-if="groupDeleteError" class="side-note bad">{{ groupDeleteError }}</p>
      </div>
      </section>

      <!-- Los agentes del equipo: los de cada persona conectada (`playground agents`), los tuyos primero. -->
      <section class="view wb-bloque bloque-agentes" :class="{ open: isViewOpen('agents') }">
      <div class="region-head">
        <button type="button" class="view-tog" :aria-expanded="isViewOpen('agents')" @click="toggleView('agents')">
          <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>Del equipo</span>
        </button>
        <span class="count">{{ chat.agentList.length }}</span>
      </div>
      <div v-if="isViewOpen('agents')" class="region-body">
        <p v-if="chat.teamAgentsError" class="side-note bad">{{ chat.teamAgentsError }}</p>
        <p v-else-if="!chat.agentList.length" class="side-note">
          Nadie tiene agentes todavía. Uno nace la primera vez que una sesión habla como él:
          <code>bin/chat send … --as luigi</code>.
        </p>
        <ul v-else class="conversations">
          <li v-for="a in chat.agentList" :key="a.key">
            <button type="button" class="conversation" :class="{ on: a.key === chat.activeKey }" @click="serverOpen = ''; chat.openAgent(a)">
              <span class="avatar agent" :class="{ mine: a.mine, tool: a.tool }" aria-hidden="true">{{ (a.agentName || '?')[0].toUpperCase() }}</span>
              <span class="conversation-main">
                <span class="conversation-top">
                  <b class="name">{{ a.agentName }}</b>
                  <span class="owner">{{ a.tool ? 'del equipo' : a.mine ? 'tuyo' : firstName(a.owner) }}</span>
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
      <ServicePanel :service="openService" :serving="teamServices.serving" :back="narrow" @changed="loadServers" @close="serverOpen = ''" @back="narrowList = true" />
    </main>
    <main v-else-if="openServer" class="editor">
      <ServerPanel :server="openServer" :back="narrow" @changed="loadServers" @close="serverOpen = ''" @back="narrowList = true" />
    </main>

    <main v-else class="editor">
      <div class="region-head conversation-head">
        <template v-if="chat.active">
          <!-- Un solo primer hijo: la base le da a ese el ancho que sobra y lo recorta con «…». -->
          <span class="head-who">
            <button v-if="narrow" type="button" class="region-action narrow-back" title="Volver a las conversaciones"
                    aria-label="Volver a las conversaciones" @click="narrowList = true">
              <span class="ui-icon" data-icon="back" aria-hidden="true"></span>
            </button>
            <span class="avatar small" :class="{ agent: activeIsAgent, mine: activeIsAgent && activeOwnerIsMe, tool: activeIsCanon }" aria-hidden="true">
              <img v-if="!activeIsAgent && photoOf(chat.active.person)" class="avatar-photo" :src="photoOf(chat.active.person)" alt="" referrerpolicy="no-referrer">
              <template v-else>{{ chat.active.person.group ? '#' : activeIsAgent ? (activeTitle || '?')[0].toUpperCase() : initials(chat.active.person) }}</template><i v-if="activeOnline" class="presence"></i>
            </span>
            <span class="head-title">{{ activeTitle }}</span>
            <span class="count head-sub">{{ activeSubtitle }}</span>
          </span>
          <div class="region-actions">
            <button v-if="callAvailable" type="button" class="region-action" :aria-pressed="callOpen"
                    :title="callOpen ? 'Volver al chat' : 'Videollamada: ver a los de esta conversación'" :aria-label="callOpen ? 'Volver al chat' : 'Videollamada'" @click="toggleCall">
              <!-- el ícono dice adónde lleva: la cámara abre la videollamada; el globo de chat vuelve a los mensajes -->
              <svg v-if="callOpen" class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
              <svg v-else class="call-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>
            </button>
            <RegionMenu v-if="canNotifyConversation && notify.settings" icon="bell" :items="notifyMenuItems" :active="!!activeNotifyMode"
                        :class="['group-notify', { quiet: notifyEffective !== 'all' || !notify.settings.enabled }]"
                        :title="`Avisos de esta conversación: ${!notify.settings.enabled ? 'apagados' : NOTIFY_LABEL[notifyEffective].toLowerCase()}`"
                        @select="onNotifyMenu" />
            <button type="button" class="region-action" title="Vaciar chat: borra los mensajes y la conversación queda"
                    aria-label="Vaciar chat" @click="clearActive">
              <span class="ui-icon" data-icon="eraser" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Borrar conversación: sale de la lista (sólo en este navegador)"
                    aria-label="Borrar conversación" @click="forgetActive">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </div>
        </template>
        <template v-else>
          <span class="head-who"><button v-if="narrow" type="button" class="region-action narrow-back" title="Volver a las conversaciones"
                    aria-label="Volver a las conversaciones" @click="narrowList = true"><span class="ui-icon" data-icon="back" aria-hidden="true"></span></button><span class="avatar small" aria-hidden="true"><img v-if="myPhoto" class="avatar-photo" :src="myPhoto" alt="" referrerpolicy="no-referrer"><template v-else>{{ initials(chat.me || chat.state?.session) }}</template></span><span class="head-title">Mi chat</span><span v-if="myHandle" class="count head-sub">{{ myHandle }}</span><button v-if="agentFilter" type="button" class="agent-filter" :style="{ borderColor: agentColor(agentFilter, chat.meKey) }" :title="'Volver a todo Mi chat'" @click="agentFilter = ''">sólo {{ agentFilter }} <span class="ui-icon" data-icon="close" aria-hidden="true"></span></button></span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Vaciar «Mi chat»"
                    aria-label="Vaciar «Mi chat»" :disabled="!myThread.length" @click="clearMyChat">
              <span class="ui-icon" data-icon="eraser" aria-hidden="true"></span>
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

      <!-- MI CHAT: vos y tus agentes. Lo que escribís acá te llega a vos; lo que te escribe cada persona está en su
           conversación. -->
      <div v-if="!chat.active" ref="notesEl" class="region-body thread" aria-live="polite">
        <p v-if="agentFilter && !shownThread.length" class="side-note center">Nada de {{ agentFilter }} en Mi chat todavía.</p>
        <p v-else-if="!myThread.length" class="side-note center">
          Tu conversación con vos mismo y tus agentes: lo que escribís acá no sale a nadie más. Un agente te habla con
          <code>bin/chat send &lt;vos&gt; … --as luigi</code>.
        </p>
        <template v-for="it in shownThread" :key="it.id">
          <!-- Lo que vos y tus agentes se dicen por el chat: uno de tus agentes a la izquierda, con su color; vos a la derecha. -->
          <div v-if="it.kind === 'self' && it.agent" class="bubble-row in with-avatar" :class="{ cont: it.cont }">
            <span class="msg-avatar avatar small agent mine" :class="{ ghost: it.cont }" :title="`${it.agent} · tu agente`"
                  :style="it.cont ? null : { background: agentColor(it.agent, chat.meKey), color: '#fff' }" aria-hidden="true">{{ it.cont ? '' : it.agent[0].toUpperCase() }}</span>
            <div class="bubble">
              <span v-if="!it.cont" class="author-label via"><b>{{ it.agent }}</b> · tu agente</span>
              <p class="text">{{ it.m.text }}</p>
              <span class="meta">{{ clock(it.time) }}</span>
            </div>
          </div>
          <div v-else-if="it.kind === 'self'" class="bubble-row out" :class="{ cont: it.cont }">
            <div class="bubble">
              <p class="text"><template v-if="mentionOf(it.m)"><span class="mention">{{ mentionOf(it.m) }}</span>{{ ' ' }}</template>{{ it.m.text }}</p>
              <span class="meta">{{ clock(it.time) }}</span>
            </div>
          </div>
        </template>
      </div>

      <form v-if="!chat.active" class="composer" @submit.prevent="submit">
        <p v-if="dictationNote" class="dictation-note" :class="{ error: dictationState.error }" role="status">{{ dictationNote }}</p>
        <div class="composer-row">
          <div class="composer-field">
            <label class="sr-only" for="composer-text">Escribite algo</label>
            <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1"
                      maxlength="2000" placeholder="Escribite algo: lo ven vos y tus agentes" @keydown="onKeydown" @input="autosize"></textarea>
            <EmojiButton class="composer-emoji" @pick="insertEmoji" />
          </div>
          <DictationButton v-if="showDictation(!draft.trim())" @text="insertDictation" @state="onDictationState" />
          <button v-else type="submit" class="btn btn-send" :disabled="!draft.trim()" title="Mandar"
                  aria-label="Mandar"><span class="ui-icon" data-icon="send" aria-hidden="true"></span></button>
        </div>
      </form>

      <template v-else>
        <CallView v-if="callOpen" :cast="callCast" :messages="chat.active?.messages || []" :me="chat.meKey" :peer="chat.activeKey" />
        <div v-show="!callOpen" ref="threadEl" class="region-body thread" aria-live="polite" @scroll.passive="onThreadScroll" @load.capture="onMediaLoad">
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
            <template v-else-if="activeIsAgent">Un agente es una identidad {{ activeOwnerIsMe ? 'tuya' : `de ${firstName(activeOwner)}` }}: lo que le escribís le llega a {{ activeOwnerIsMe ? 'vos' : firstName(activeOwner) }}, marcado para {{ activeTitle }}, y contesta la sesión que habla como él.</template>
            <template v-else>Todavía no hay mensajes con {{ chat.active.person.name || chat.active.person.email }}.</template>
          </p>
          <button v-if="hiddenCount" type="button" class="older" @click="loadOlder">
            {{ hiddenCount }} mensaje{{ hiddenCount === 1 ? '' : 's' }} anterior{{ hiddenCount === 1 ? '' : 'es' }} · subí o tocá para verlos
          </button>
          <template v-for="item in thread" :key="item.id">
            <div v-if="item.kind === 'day'" class="day"><span>{{ item.label }}</span></div>

            <!-- Alguien le preguntó a uno de tus agentes: tu listen ya le contestó. -->
            <div v-else-if="item.kind === 'asked'" class="asked">
              <span class="asked-label">Le preguntó a tu agente <b>{{ item.agent }}</b> · {{ clock(item.time) }}</span>
              <span class="asked-text">{{ item.text }}</span>
            </div>

            <!-- Lo que tu agente contestaría: no salió. «Mandar» lo manda a tu nombre; «Descartar» lo tira. -->
            <div v-else class="bubble-row" :class="[item.dir, { cont: item.cont, 'with-avatar': !activeIsAgent }]">
              <!-- Quién habla: su muñequito al empezar cada tanda (la persona, o uno de sus agentes); en las siguientes
                   queda el lugar vacío para que las burbujas se alineen. -->
              <span v-if="!activeIsAgent && speakerOf(item)" class="msg-avatar avatar small" :class="{ agent: speakerOf(item).agent, mine: speakerOf(item).mine, ghost: item.cont }"
                    :style="speakerOf(item).agent && !item.cont ? { background: agentColor(speakerOf(item).agent, speakerOf(item).mine ? chat.meKey : speakerOf(item).owner?.email), color: '#fff' } : null"
                    :title="speakerOf(item).label" aria-hidden="true">
                <template v-if="!item.cont">
                  <template v-if="speakerOf(item).agent">{{ speakerOf(item).agent[0].toUpperCase() }}</template>
                  <img v-else-if="photoOf(speakerOf(item).person)" class="avatar-photo" :src="photoOf(speakerOf(item).person)" alt="" referrerpolicy="no-referrer">
                  <template v-else>{{ initials(speakerOf(item).person) }}</template>
                </template>
              </span>
              <span v-else-if="!activeIsAgent && item.dir === 'out'" class="msg-avatar avatar small ghost" aria-hidden="true"></span>
              <div class="bubble" :class="{ failed: item.status === 'error', 'mentions-me': activeIsGroup && item.dir === 'in' && mentionsMeIn(item.text) }">
                <!-- Un agente se nombra solo, como en un grupo; de quién es lo dice el hover (también en su avatar). -->
                <span v-if="item.dir === 'in' && !item.cont && !activeIsAgent && speakerOf(item)" class="author-label"
                      :class="{ via: speakerOf(item).agent }" :title="speakerOf(item).agent ? speakerOf(item).label : null">
                  <b v-if="speakerOf(item).agent" :style="{ color: agentColor(speakerOf(item).agent, speakerOf(item).owner?.email) }">{{ speakerOf(item).agent }}</b>
                  <b v-else>{{ speakerOf(item).label }}</b>
                </span>
                <span v-if="item.kind === 'publish' && !item.cont" class="published-label">publicó</span>
                <!-- Lo que mandó un agente tuyo desde la terminal (bin/chat --as): sale como él, no como vos. -->
                <span v-if="item.asAgent && !item.cont" class="published-label agent-chip">{{ item.asAgent }} · tu agente</span>
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
                  <!-- Una clave (o un pedido de clave) se pinta como tarjeta; lo que venga después, como texto. -->
                  <template v-else-if="keyInfo(item)">
                    <KeyCard :info="keyInfo(item)" :mine="item.dir === 'out'" :who="keyWho(item)"
                             @ask-keys="(names) => askKeys(names, item.sid)" @send-keys="(names) => sendKeysByName(names, item.sid)" />
                    <p v-if="keyInfo(item).rest" class="text">{{ keyInfo(item).rest }}</p>
                  </template>
                  <p v-else-if="item.text && activeIsGroup" class="text"><template v-for="(seg, i) in textSegments(item.text)" :key="i"><span v-if="seg.mention" class="mention" :class="{ me: seg.me }">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></p>
                  <p v-else-if="item.text" class="text"><template v-if="mentionOf(item)"><span class="mention" :class="{ me: !!item.forAgent }">{{ mentionOf(item) }}</span>{{ ' ' }}</template>{{ item.text }}</p>
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
                              title="Bajarlo a Descargas: se borra del playground. No se abre solo" @click="chat.getFile(item, f)"><span class="ui-icon" data-icon="download" aria-hidden="true"></span>Bajar a Descargas</button>
                      <button v-else-if="f.status === 'bajado' && !f.savedPath && f.cached" type="button" class="btn-link"
                              title="Guardar una copia en Descargas" @click="chat.saveFile(f)"><span class="ui-icon" data-icon="download" aria-hidden="true"></span>Guardar en Descargas</button>
                      <button v-if="f.savedPath" type="button" class="btn-link" title="Mostrar en el Finder (no lo abre)" @click="chat.revealFile(f)"><span class="ui-icon" data-icon="folder" aria-hidden="true"></span>Mostrar en el Finder</button>
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
              <!-- muy largo para la voz (el tope de palabras del perfil): no se lee, y se dice por qué -->
              <span v-if="speech.supported && item.text && item.format !== 'json' && !keyInfo(item) && tooLong(item.text)" class="reply-action speak-muted"
                    :title="`Muy largo para leerlo en voz alta (más de ${speech.maxWords} palabras): no se gastan créditos en él`"
                    :aria-label="`Muy largo para leerlo en voz alta`">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" /><path d="M16 9l5 6M21 9l-5 6" fill="none" /></svg>
              </span>
              <button v-else-if="speech.supported && item.text && item.format !== 'json' && !keyInfo(item)" type="button" class="reply-action speak-action"
                      :class="{ on: speech.speakingId === item.id }" :title="speech.speakingId === item.id ? 'Parar' : 'Escuchar'"
                      :aria-label="speech.speakingId === item.id ? 'Parar la lectura' : 'Escuchar este mensaje'" @click="toggleSpeak(item.id, item.text)">
                <span class="ui-icon" :data-icon="speech.speakingId === item.id ? 'stop' : 'play'" aria-hidden="true"></span>
              </button>
              <button v-if="canReply(item)" type="button" class="reply-action" title="Responder a este mensaje"
                      aria-label="Responder a este mensaje" @click="startReply(item)">
                <span class="ui-icon" data-icon="comment" aria-hidden="true"></span>
              </button>
            </div>
          </template>
          <!-- Bajar al final, como WhatsApp: aparece al subir, y cuenta lo que llegó mientras mirabas arriba. -->
          <button v-if="!atBottom && thread.length" type="button" class="to-bottom" :title="unseen ? `${unseen} nuevo${unseen === 1 ? '' : 's'}: bajar al final` : 'Bajar al final'"
                  :aria-label="unseen ? `Bajar al final: ${unseen} mensaje${unseen === 1 ? '' : 's'} nuevo${unseen === 1 ? '' : 's'}` : 'Bajar al final'" @click="scrollToEnd(true)">
            <span class="ui-icon" data-icon="down" aria-hidden="true"></span>
            <span v-if="unseen" class="to-bottom-count">{{ unseen > 99 ? '99+' : unseen }}</span>
          </button>
        </div>
        <form class="composer" @submit.prevent="submit">
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
          <!-- A quién nombrar: los del grupo y @todos. ↑↓ elige, Enter o Tab lo pone, Esc cierra. -->
          <ul v-if="mentionOptions.length" id="mention-menu" class="mention-menu" role="listbox" aria-label="Mencionar a">
            <li v-for="(o, i) in mentionOptions" :id="`mention-${i}`" :key="o.handle" role="option" :aria-selected="i === mention.index"
                class="mention-option" :class="{ on: i === mention.index }" @mousedown.prevent="pickMention(o)" @mouseenter="mention.index = i">
              <span class="mention-handle">@{{ o.handle }}</span><span class="mention-label">{{ o.label }}</span>
            </li>
          </ul>
          <p v-if="dictationNote" class="dictation-note" :class="{ error: dictationState.error }" role="status">{{ dictationNote }}</p>
          <div class="composer-row" @dragover.prevent @drop.prevent="onDropFiles">
            <template v-if="canAttach">
              <input ref="fileInput" type="file" multiple class="sr-only" aria-hidden="true" tabindex="-1" @change="onPickFiles">
              <button type="button" class="btn btn-outline composer-attach" title="Adjuntar archivos (hasta 25 MB cada uno; también se pueden arrastrar)"
                      aria-label="Adjuntar archivos" @click="fileInput?.click()">
                <span class="ui-icon" data-icon="attach" aria-hidden="true"></span>
              </button>
            </template>
            <div class="composer-field">
            <label class="sr-only" for="composer-text">{{ placeholder }}</label>
            <textarea id="composer-text" ref="composer" v-model="draft" class="input composer-text" rows="1"
                      maxlength="2000" :placeholder="placeholder" @keydown="onKeydown" @input="onComposerInput" @paste="onPasteFiles"
                      @click="updateMention" @blur="mention = null" role="combobox" :aria-expanded="mentionOptions.length > 0"
                      aria-autocomplete="list" :aria-controls="mentionOptions.length ? 'mention-menu' : undefined"
                      :aria-activedescendant="mentionOptions.length ? `mention-${mention.index}` : undefined"></textarea>
            <EmojiButton class="composer-emoji" @pick="insertEmoji" />
            </div>
            <DictationButton v-if="showDictation(!canSubmit)" @text="insertDictation" @state="onDictationState" />
            <button v-else type="submit" class="btn btn-send" :disabled="!canSubmit" :title="sendLabel" :aria-label="sendLabel"><span class="ui-icon" data-icon="send" aria-hidden="true"></span></button>
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
                  @click="chat.saveFile(lightbox.f)"><span class="ui-icon" data-icon="download" aria-hidden="true"></span>Guardar en Descargas</button>
          <button v-else type="button" class="btn-link" title="Mostrarla en el Finder (no la abre)" @click="chat.revealFile(lightbox.f)"><span class="ui-icon" data-icon="folder" aria-hidden="true"></span>Mostrar en el Finder</button>
        </template>
      </div>
      <p v-if="lightbox.f.error" class="error">{{ lightbox.f.error }}</p>
      <button type="button" class="region-action lightbox-close" aria-label="Cerrar" title="Cerrar (Esc)" @click="lightbox = null">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>

    <!-- ── tu agente: la región de la derecha ─────────────────────────────────────────── -->
    <aside v-show="agentShown" class="auxiliarybar" :aria-label="docView ? (docView.kind === 'image' ? 'Galería' : 'Documento') : mediaContext && !openService ? 'Fotos y archivos' : openService ? 'Rutas' : 'Tu perfil'">
      <div class="rsz rsz-edge-left" v-resize="agentResize"></div>
      <template v-if="docView">
        <div class="region-head">
          <button v-if="mediaContext && mediaOpen" type="button" class="region-action doc-back" title="Volver a fotos y archivos" aria-label="Volver a fotos y archivos" @click="closeDoc">
            <span class="ui-icon" data-icon="back" aria-hidden="true"></span>
          </button>
          <span class="doc-view-title" :title="docView.f.name">
            <template v-if="docView.kind === 'image' && galleryItems.length > 1">{{ galleryIndex + 1 }} de {{ galleryItems.length }} · </template>{{ docView.f.name }}
          </span>
          <div class="region-actions">
            <button v-if="docView.kind === 'image'" type="button" class="region-action" title="Ampliar a pantalla completa" aria-label="Ampliar" @click="zoomImage">
              <span class="ui-icon" data-icon="maximize" aria-hidden="true"></span>
            </button>
            <button v-if="!docView.f.savedPath" type="button" class="region-action" title="Guardar una copia en Descargas"
                    aria-label="Guardar en Descargas" @click="chat.saveFile(docView.f)">
              <span class="ui-icon" data-icon="download" aria-hidden="true"></span>
            </button>
            <button v-else type="button" class="region-action" title="Mostrar en el Finder" aria-label="Mostrar en el Finder" @click="chat.revealFile(docView.f)">
              <span class="ui-icon" data-icon="folder" aria-hidden="true"></span>
            </button>
            <button type="button" class="region-action" title="Cerrar (Esc)" :aria-label="docView.kind === 'image' ? 'Cerrar la galería' : 'Cerrar el documento'" @click="closeDoc">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <PdfPages v-if="docView.kind === 'pdf'" :key="docView.f.id" :src="chat.fileUrl(docView.f)" :name="docView.f.name" />
        <div v-else class="gallery">
          <div class="gallery-stage">
            <img :src="imageSrc(docView.item, docView.f)" :alt="docView.f.name" @dblclick="zoomImage">
            <button v-if="galleryItems.length > 1" type="button" class="gallery-nav prev" title="Anterior (←)" aria-label="Imagen anterior" @click="galleryGo(-1)"><span class="ui-icon" data-icon="prev" aria-hidden="true"></span></button>
            <button v-if="galleryItems.length > 1" type="button" class="gallery-nav next" title="Siguiente (→)" aria-label="Imagen siguiente" @click="galleryGo(1)"><span class="ui-icon" data-icon="chevron" aria-hidden="true"></span></button>
          </div>
          <div class="gallery-caption">
            <span class="gallery-meta">{{ galleryWho(docView.item) }} · {{ galleryWhen(docView.item.time) }}</span>
            <p v-if="docView.item.text" class="gallery-text">{{ docView.item.text }}</p>
          </div>
          <div v-if="galleryItems.length > 1" class="gallery-strip" role="list" aria-label="Imágenes de la conversación">
            <button v-for="g in galleryItems" :key="g.f.id || g.f.name + g.item.id" type="button" role="listitem" class="gallery-thumb"
                    :class="{ on: g.f === docView.f }" :title="g.f.name" @click="docView = { kind: 'image', item: g.item, f: g.f }">
              <img :src="imageSrc(g.item, g.f)" :alt="g.f.name" loading="lazy">
            </button>
          </div>
        </div>
      </template>
      <ServiceSide v-else-if="openService" :service="openService" @close="setRoutesOpen(false)" />
      <template v-else-if="mediaContext">
        <div class="region-head">
          <span>Fotos y archivos <small v-if="mediaCount" class="count">{{ mediaCount }}</small></span>
          <div class="region-actions">
            <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar fotos y archivos" @click="setMediaOpen(false)">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="region-body media-panel">
          <p v-if="!mediaCount" class="side-note center">Todavía no hay fotos ni archivos en esta conversación.</p>
          <section v-for="d in mediaDays" :key="d.key" class="media-day">
            <h4 class="media-day-label">{{ d.label }}</h4>
            <div class="media-tiles">
              <template v-for="e in d.items" :key="e.f.id || e.f.name + e.item.id">
                <button v-if="isImage(e.f)" type="button" class="media-tile"
                        :title="`${e.f.name} · ${galleryWho(e.item)}`" @click="openMedia(e)">
                  <img v-if="imageSrc(e.item, e.f)" :src="imageSrc(e.item, e.f)" :alt="e.f.name" loading="lazy">
                  <span v-else class="media-tile-wait">{{ e.f.status === 'error' ? 'no está' : 'cargando…' }}</span>
                </button>
                <!-- Un archivo es un cuadro más: la portada si es un PDF, si no su tipo en grande; abajo, el nombre. -->
                <component v-else :is="isPdf(e.f) && e.f.id ? 'button' : 'div'" :type="isPdf(e.f) && e.f.id ? 'button' : undefined"
                           class="media-tile file-tile" :class="`kind-${kindOf(e.f)}`"
                           :title="`${e.f.name} · ${sizeText(e.f.size)} · ${galleryWho(e.item)}`" @click="openMedia(e)">
                  <PdfThumb v-if="pdfThumbOf(e)" :src="pdfThumbOf(e)" @fail="thumbFailed.add(e.f.id || e.f.name)" />
                  <span v-else class="file-tile-ext" aria-hidden="true">{{ extOf(e.f) }}</span>
                  <span class="file-tile-foot">
                    <span class="file-tile-badge">{{ extOf(e.f) }}</span>
                    <span class="file-tile-name">{{ e.f.name }}</span>
                  </span>
                </component>
              </template>
            </div>
          </section>
        </div>
      </template>
      <template v-else>
      <div class="region-head profile-head">
        <nav class="profile-tabs" role="tablist" aria-label="Tu perfil">
          <button v-for="t in PROFILE_TABS" :key="t.id" type="button" role="tab" class="region-action profile-tab"
                  :class="{ on: profileTab === t.id }" :aria-selected="profileTab === t.id" :title="t.label" :aria-label="t.label"
                  @click="setProfileTab(t.id)">
            <svg v-if="t.id === 'agents'" class="tab-ring" viewBox="0 0 42 42" aria-hidden="true"><circle v-if="!myAgents.length" cx="21" cy="21" r="15" stroke="currentColor"/><circle v-for="r in ringOf({ email: chat.meKey })" :key="r.name" cx="21" cy="21" r="19.5" :stroke="r.color" :stroke-dasharray="r.dash" :stroke-dashoffset="r.offset" transform="rotate(-90 21 21) translate(21 21) scale(.77) translate(-21 -21)"/></svg>
            <span v-else class="ui-icon" :data-icon="t.icon || 'settings'" aria-hidden="true"></span>
          </button>
        </nav>
        <div class="region-actions">
          <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar el perfil" @click="setAgentOpen(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div v-if="profileTab === 'agents'" class="region-body profile-section">
        <p v-if="!myAgents.length" class="field-hint">Todavía no tenés agentes. Nace uno la primera vez que una sesión habla
          con su nombre: <code>bin/chat send &lt;vos&gt; "…" --as luigi</code>.</p>
        <ul v-else class="my-agents">
          <li v-for="a in myAgents" :key="a.name" class="my-agent" :class="{ on: agentFilter === a.name }">
            <button type="button" class="my-agent-main" :aria-pressed="agentFilter === a.name"
                    :title="agentFilter === a.name ? 'Volver a todo Mi chat' : `Ver en Mi chat sólo lo de ${a.name}`" @click="toggleAgentFilter(a.name)">
              <span class="avatar small agent" :style="{ background: agentColor(a.name, chat.meKey), color: '#fff' }" aria-hidden="true">{{ a.name[0].toUpperCase() }}</span>
              <span class="my-agent-text">
                <span class="my-agent-top"><b>{{ a.name }}</b><small>{{ a.lastActive ? `habló ${ago(a.lastActive)}` : 'todavía no habló' }}</small></span>
                <small v-if="a.description" class="my-agent-desc">{{ a.description }}</small>
                <span v-if="a.groups?.length" class="my-agent-groups"><span v-for="g in a.groups" :key="g" class="my-agent-group">{{ g }}</span></span>
              </span>
            </button>
            <button type="button" class="region-action my-agent-del" :title="`Borrar a ${a.name}`" :aria-label="`Borrar a ${a.name}`" @click="removeAgent(a.name)">
              <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
            </button>
          </li>
        </ul>
        <p v-if="removeAgentError" class="field-hint bad">{{ removeAgentError }}</p>
      </div>
      <div v-else-if="profileTab === 'notify'" class="region-body">
        <NotifySettings :name-of="conversationName" />
      </div>
      <div v-else-if="profileTab === 'voice'" class="region-body profile-section">
        <p v-if="!speech.supported" class="field-hint">Este navegador no reproduce audio.</p>
        <template v-else>
          <label class="field">
            <span class="label">Voz</span>
            <select class="input" :value="speech.voice || defaultVoice()" @change="setVoice($event.target.value)">
              <option v-for="v in speech.voices" :key="v.name" :value="v.name">{{ v.name }}{{ v.accent ? ` · ${v.accent}` : '' }}{{ v.gender ? ` · ${v.gender === 'female' ? 'mujer' : v.gender === 'male' ? 'hombre' : v.gender}` : '' }}</option>
            </select>
          </label>
          <div class="field">
            <span class="label">Velocidad</span>
            <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Velocidad">
              <button v-for="r in [0.85, 1, 1.2, 1.5]" :key="r" type="button" class="toggle" role="radio" :aria-checked="speech.rate === r"
                      :aria-pressed="speech.rate === r" @click="setRate(r)">{{ r }}×</button>
            </div>
          </div>
          <div class="field">
            <span class="label">Máximo de palabras</span>
            <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Máximo de palabras">
              <button v-for="n in MAX_WORDS_OPTIONS" :key="n" type="button" class="toggle" role="radio" :aria-checked="speech.maxWords === n"
                      :aria-pressed="speech.maxWords === n" @click="setMaxWords(n)">{{ n }}</button>
            </div>
            <small class="field-hint">Un mensaje más largo no se lee en voz alta, ni con el ▶ ni en la videollamada: no se gastan créditos en él.</small>
          </div>
          <div class="notify-actions">
            <button type="button" class="btn btn-outline btn-sm" @click="toggleSpeak('voice-test', `Hola ${firstName(chat.me || chat.state?.session || {})}, así suena tu chat.`)">
              <span class="ui-icon" :data-icon="speech.speakingId === 'voice-test' ? 'stop' : 'play'" aria-hidden="true"></span>Probar</button>
          </div>
          <p v-if="speech.error" class="field-hint bad">{{ speech.error }}</p>
          <p class="field-hint">El ▶ de cada mensaje lo lee en voz alta con ElevenLabs, como la videollamada: el texto va a ElevenLabs y gasta créditos (lo ya escuchado no se vuelve a cobrar).</p>
        </template>
      </div>
      <div v-else-if="profileTab === 'keyring'" class="region-body profile-section">
        <label class="profile-row">
          <span><b>Compartir solo</b><small>quien te lo pide recibe los nombres y, si las pide, las claves encriptadas</small></span>
          <button type="button" class="switch" role="switch" :aria-checked="keyring.autoShare" aria-label="Compartir mi llavero solo"
                  @click="setAutoShare(!keyring.autoShare)"></button>
        </label>
        <p class="profile-row"><span><b>{{ keyring.saved.length }}</b><small>{{ keyring.saved.length === 1 ? 'clave guardada' : 'claves guardadas' }}</small></span></p>
        <p class="field-hint">Para pedirle el suyo a alguien: <code>🔑 Pido tu llavero</code> en su conversación. Encriptar y desencriptar, en la consola de cada conversación.</p>
      </div>
      <div v-else class="region-body profile-section">
        <p class="profile-row"><span><b><i class="status-dot" :class="{ on: listening && chat.state?.connected }" aria-hidden="true"></i> {{ statusText }}</b>
          <small v-if="chat.state?.since && listening">desde las {{ clock(chat.state.since) }}</small></span></p>
        <p v-if="chat.me || chat.state?.session" class="profile-row"><span><b>{{ (chat.me || chat.state.session).email }}</b><small>la sesión del CLI: lo que mandás sale con este nombre</small></span></p>
        <p class="profile-row"><span><b>{{ notify.status.via === 'tab' ? 'esta pestaña' : notify.status.macTool === 'chat-notifier' ? 'Chat del playground' : notify.status.macTool }}</b><small>muestra los avisos ahora</small></span></p>
      </div>
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
            <span class="ui-icon" data-icon="eraser" aria-hidden="true"></span>
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

    <!-- ── el llavero: la consola de una conversación ─────────────── -->
    <section v-else-if="keyringContext && panelShown" class="panel" aria-label="Llavero">
      <div class="rsz rsz-edge-top" v-resize="consoleResize"></div>
      <nav class="tabs" role="tablist" aria-label="Consola">
        <button type="button" role="tab" class="tab on" aria-selected="true">Llavero</button>
        <div class="region-actions">
          <button ref="consoleMax" type="button" class="region-action"><span class="ui-icon" aria-hidden="true"></span></button>
          <button type="button" class="region-action" title="Ocultar el llavero" aria-label="Ocultar el llavero" @click="setKeyringOpen(false)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </nav>
      <KeyringPanel />
    </section>

    <footer class="statusbar">
      <!-- La barra deja sólo el estado, quién contesta y los avisos; el detalle está en tu perfil (Mi chat). -->
      <button type="button" class="statusbar-item mode-toggle" :title="`${statusText}${chat.state?.since && listening ? ` desde las ${clock(chat.state.since)}` : ''} · ver la conexión`"
              :aria-label="`Conexión: ${statusText}`" @click="openProfile('connection')">
        <i class="status-dot" :class="{ on: listening && chat.state?.connected }" aria-hidden="true"></i>
        <span v-if="!(listening && chat.state?.connected)">{{ statusText }}</span>
      </button>
      <!-- Lo que hizo el servidor por su cuenta (el llavero que contestó solo), unos segundos. -->
      <span v-if="chat.liveNotice" class="statusbar-item live-notice"><span class="ui-icon" data-icon="key" aria-hidden="true"></span>{{ chat.liveNotice.text }}</span>
      <button type="button" class="statusbar-item mode-toggle icon-only" :class="{ off: notify.settings && !notify.settings.enabled }"
              :title="notify.settings && !notify.settings.enabled ? 'Avisos apagados' : 'Avisos'" :aria-label="notifyStatusText" @click="openNotify">
        <span class="ui-icon" data-icon="bell" aria-hidden="true"></span></button>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!sidebarShown" title="Mostrar u ocultar las conversaciones"
                aria-label="Mostrar u ocultar las conversaciones" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
        <!-- La consola: la de un server o un servicio y, en una conversación, el llavero. -->
        <button type="button" class="region-action" :aria-pressed="!!panelShown" :disabled="!(openServer || openService || keyringContext)"
                :title="openService ? 'Mostrar u ocultar el historial' : openServer ? 'Mostrar u ocultar la consola' : keyringContext ? 'Mostrar u ocultar el llavero' : 'Abrí una conversación para usar el llavero'"
                :aria-label="openService ? 'Mostrar u ocultar el historial' : keyringContext ? 'Mostrar u ocultar el llavero' : 'Mostrar u ocultar la consola'" @click="toggleConsole">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        </button>
        <!-- El sidebar derecho: según lo que esté abierto son las rutas, la ficha del agente, fotos y archivos o tu agente. -->
        <button type="button" class="region-action" :aria-pressed="!!agentShown" :disabled="!rightKind || showingNarrowList"
                :title="rightKind ? `Mostrar u ocultar ${rightKind}` : 'Acá no hay sidebar derecho'"
                :aria-label="`Mostrar u ocultar ${rightKind || 'el sidebar derecho'}`" @click="toggleRight">
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
.tab-ring { width: 18px; height: 18px }
.tab-ring circle { fill: none; stroke-width: 5; stroke-linecap: round }
.my-agents { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.my-agent { display: flex; align-items: center; gap: var(--space-1); border-radius: var(--radius-md, 8px) }
.my-agent.on { background: color-mix(in oklab, var(--foreground) 8%, transparent) }
.my-agent-main { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: var(--space-2); padding: var(--space-2);
  border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; border-radius: inherit }
.my-agent-main:hover { background: color-mix(in oklab, var(--foreground) 5%, transparent) }
.my-agent-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px }
.my-agent-top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2) }
.my-agent-top small, .my-agent-desc { color: var(--fg-2); font-size: var(--text-xs) }
.my-agent-desc { overflow-wrap: anywhere }
.my-agent-groups { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px }
.my-agent-group { font-size: var(--text-xs); padding: 0 6px; border-radius: 999px; background: color-mix(in oklab, var(--foreground) 9%, transparent) }
.my-agent-del { opacity: 0 }
.my-agent:hover .my-agent-del, .my-agent-del:focus-visible { opacity: 1 }
.agent-filter { display: inline-flex; align-items: center; gap: 4px; margin-left: var(--space-2); padding: 0 4px 0 8px; height: 20px;
  border: 1.5px solid; border-radius: 999px; background: none; font: inherit; font-size: var(--text-xs); color: inherit; cursor: pointer }
.agent-filter .ui-icon { width: 12px; height: 12px }
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
/* Sin aire propio: la banda ya trae el suyo, y con los dos la banda del editor medía 43 en vez de 40 (2026-11-11). */
.head-who { display: flex; align-items: center; gap: var(--space-2) }
.narrow-back { flex: none; margin-inline-start: -6px }
/* Menciones: el nombre resaltado; el que te nombra, con el acento y su burbuja con una línea al costado. */
.mention { padding: 0 2px; border-radius: 4px; color: var(--primary); background: color-mix(in oklab, var(--primary) 12%, transparent); font-weight: 600 }
.mention.me { color: var(--primary-foreground); background: var(--primary) }
.bubble.mentions-me { box-shadow: inset 3px 0 0 var(--primary) }
.unread.at { background: var(--primary); color: var(--primary-foreground) }
.composer { position: relative }
.mention-menu { position: absolute; z-index: 5; left: var(--space-6); right: var(--space-6); bottom: calc(100% - var(--space-2)); margin: 0; padding: 4px;
  list-style: none; max-height: 260px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-lg, 10px);
  background: var(--popover, var(--background)); box-shadow: 0 8px 24px rgb(0 0 0 / .25) }
.mention-option { display: flex; align-items: baseline; gap: var(--space-2); padding: 6px 8px; border-radius: 6px; cursor: pointer; min-width: 0 }
.mention-option.on { background: var(--hover) }
.mention-handle { flex: none; font-weight: 600 }
.mention-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-2); font-size: var(--text-sm) }
/* La campana del grupo: atenuada cuando avisa sólo las menciones. */
.group-notify.quiet { opacity: .5 }
.mode-toggle.off { opacity: .6 }
.btn-send { width: var(--control-md); padding: 0; flex: none }
.speak-action.on { opacity: 1; color: var(--primary) }
.notify-actions { display: flex; gap: var(--space-2) }
/* El perfil: pestañas por icono en la cabecera y filas cortas (lo que es arriba, el detalle chico abajo). */
.profile-head { gap: var(--space-2) }
.profile-tabs { display: flex; align-items: center; gap: 2px; min-width: 0 }
.profile-tab.on { background: var(--hover); color: var(--foreground) }
.profile-section { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) var(--gutter, var(--space-4)) }
.profile-row { margin: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3) }
.profile-row > span { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.profile-row b { display: flex; align-items: center; gap: 6px; font-weight: 600; overflow-wrap: anywhere }
.profile-row small { color: var(--fg-2); font-size: var(--text-xs) }
/* En angosto, la lista sola: ocupa todo el ancho y el chat, la consola y la derecha no se ven. */
.workbench.narrow-list > .sidebar { width: auto; grid-column: 1 / -1 }
.workbench.narrow-list > .editor, .workbench.narrow-list > .panel, .workbench.narrow-list > .auxiliarybar { display: none }
.workbench.narrow-right > .auxiliarybar { width: auto; grid-column: 1 / -1 }
.workbench.narrow-right > .editor, .workbench.narrow-right > .panel { display: none }
/* En angosto la barra de abajo deja sólo lo que cambia qué hacés: si estás en vivo, quién contesta y los botones. */
.workbench.narrow .wide-only { display: none }
/* Si no entra, primero se recorta el estado («conectado · @usuario», los miembros de un grupo) y recién después el nombre. */
.head-title { flex: 0 1 auto; min-width: 3em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600 }
.head-sub { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.notice { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: 8px var(--gutter);
  border-bottom: 1px solid var(--border); background: var(--muted); color: var(--fg-2); font-size: var(--text-sm) }
.thread { display: flex; flex-direction: column; gap: 8px; padding: var(--space-4) var(--space-6) }
/* DESVIACIÓN DECLARADA de la base (superficies planas): el hilo de una conversación lleva un patrón tenue de fondo, como
   un chat. Sólo acá; scrollea con los mensajes (`local`). El patrón es un token del tema (--chat-wallpaper, style.css). */
.thread { background-image: var(--chat-wallpaper); background-attachment: local; background-repeat: repeat }
/* La tanda de arriba y el botón de bajar al final (WhatsApp). */
.older { align-self: center; margin: 0 0 var(--space-2); padding: 3px 12px; border: 0; border-radius: 999px; background: var(--muted);
  color: var(--fg-2); font: inherit; font-size: var(--text-xs); cursor: pointer }
.older:hover { color: var(--foreground) }
.to-bottom { position: sticky; bottom: 4px; align-self: flex-end; margin-top: auto; display: grid; place-items: center; width: 40px; height: 40px;
  flex: none; border: 1px solid var(--border); border-radius: 50%; background: var(--popover); color: var(--popover-foreground);
  box-shadow: 0 2px 8px color-mix(in oklab, var(--background) 60%, transparent); cursor: pointer; z-index: 2 }
.to-bottom:hover { background: var(--accent); color: var(--accent-foreground) }
.to-bottom:focus-visible { outline: 2px solid var(--ring) }
.to-bottom-count { position: absolute; top: -6px; right: -4px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: var(--primary); color: var(--primary-foreground); font-size: 11px; font-weight: 700; line-height: 18px; text-align: center }
.day { align-self: center; margin: var(--space-3) 0 var(--space-1); padding: 2px 10px; border-radius: 999px; background: var(--muted);
  color: var(--fg-2); font-size: var(--text-xs); text-transform: capitalize }

.author-label { display: block; font-size: var(--text-xs); color: var(--fg-2); margin-bottom: 2px }
.author-label b { color: var(--foreground) }
.author-label.via b { color: var(--foreground); font-style: italic }
.group-avatar { font-weight: 700 }
.new-group { display: flex; flex-direction: column; gap: 6px; padding: 6px var(--gutter, 12px) }
.new-group-actions { display: flex; gap: 6px }
.bubble-row { display: flex; align-items: center; gap: 6px }
/* El muñequito de quién habla, arriba de la tanda; en las siguientes, el lugar vacío para alinear. */
.bubble-row.with-avatar { align-items: flex-start }
.msg-avatar { width: 26px; height: 26px; margin-top: 2px }
.msg-avatar.ghost { visibility: hidden }
/* El borde partido alrededor del muñequito: una parte de color por agente de la persona. */
.agent-ring { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); pointer-events: none; overflow: visible }
.agent-ring circle { fill: none; stroke-width: 2.5; stroke-linecap: round }
.bubble-row.out { flex-direction: row-reverse }
.bubble-row.cont { margin-top: -5px }
.bubble { max-width: min(560px, 78%); padding: 7px 10px 5px; border-radius: 12px; background: var(--bubble-theirs);
  color: var(--foreground); display: flex; flex-direction: column; gap: 3px; min-width: 0;
  /* La sombra de un píxel de WhatsApp: despega la burbuja del fondo en tema claro sin dibujarle un borde. */
  box-shadow: 0 1px .5px var(--hairline) }
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

/* Los dos bloques del costado: las conversaciones se llevan el alto que sobra; los agentes, lo suyo y no más de la
   mitad. Cada uno scrollea su cuerpo. */

.mode-toggle { border: 0; background: none; font: inherit; color: inherit; cursor: pointer; display: inline-flex; align-items: center; gap: 6px }
.agent-state { font-weight: 400; color: var(--fg-2); margin-left: 4px }

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
/* Markdown de un agente: los mismos espacios de la burbuja, sin el pre-wrap del texto plano. */
.text.md { white-space: normal }
.text.md :is(p, ul, ol, pre) { margin: 0 0 var(--space-2) }
.text.md > :last-child { margin-bottom: 0 }
.text.md :is(ul, ol) { padding-left: var(--space-4) }
.text.md code { font-family: var(--font-mono); font-size: .92em }
.text.md pre { font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap; overflow-x: auto }
.text.md strong { font-weight: 600 }
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
  background: color-mix(in oklab, var(--foreground) 5%, transparent); border: 1px solid var(--hairline); overflow: hidden }
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
/* EL DELINEADO: un filo de 1 px apenas visible alrededor de cada imagen y cada miniatura. Una captura casi blanca sobre
   un fondo blanco se pierde (tema claro); con el filo, cada una es una pieza. Va con outline hacia adentro, que se pinta
   ENCIMA de la imagen y no le cambia el tamaño. */
.media-open img, .media-tile img, .gallery-thumb img, .gallery-stage img { outline: 1px solid var(--hairline); outline-offset: -1px }
/* Las capturas se reconocen por arriba (su encabezado): el recorte cuadrado las toma desde ahí. */
.media-tile img, .gallery-thumb img, .media-open img { object-position: top center }
/* Fotos y archivos de la conversación: un bloque por día, la grilla de 3 y los documentos debajo. */
.media-panel { display: flex; flex-direction: column; gap: var(--space-4); padding: 0 var(--space-4) var(--space-6) }
.media-day { display: flex; flex-direction: column; gap: 6px }
.media-day + .media-day { padding-top: var(--space-2); border-top: 1px solid var(--hairline) }
/* El día queda fijo arriba mientras se baja por sus fotos, como en la galería de WhatsApp. */
.media-day-label { position: sticky; top: 0; z-index: 1; margin: 0 calc(-1 * var(--space-4)); padding: 8px var(--space-4) 6px;
  background: var(--sidebar, var(--background)); color: var(--fg-2); font-size: var(--text-xs); font-weight: 600 }
.media-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px }
.media-tile { position: relative; aspect-ratio: 1; padding: 0; border: 0; border-radius: 6px; overflow: hidden; background: var(--muted); cursor: zoom-in }
.media-tile img { border-radius: inherit }
.media-tile img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .15s }
.media-tile:hover img { transform: scale(1.04) }
.media-tile:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px }
.media-tile-wait { position: absolute; inset: 0; display: grid; place-items: center; color: var(--fg-2); font-size: var(--text-xs) }
.file-tile { display: block; color: inherit; font: inherit; text-align: left; outline: 1px solid var(--hairline); outline-offset: -1px;
  background: color-mix(in oklab, var(--kind, var(--fg-2)) 14%, var(--background)) }
div.file-tile { cursor: default }
button.file-tile { cursor: zoom-in }
.file-tile.kind-pdf { --kind: var(--destructive) }
.file-tile.kind-sheet { --kind: var(--chart-1) }
.file-tile.kind-doc { --kind: var(--primary) }
.file-tile.kind-zip { --kind: var(--chart-2) }
.file-tile.kind-code { --kind: var(--chart-3) }
.file-tile:has(.pdf-thumb) { background: var(--card) }
.file-tile-ext { position: absolute; inset: 0 0 26px; display: grid; place-items: center; font-size: var(--text-sm); font-weight: 700;
  letter-spacing: .04em; color: color-mix(in oklab, var(--kind, var(--fg-2)) 70%, var(--foreground)) }
.file-tile-foot { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 4px; height: 26px; padding: 0 6px;
  background: color-mix(in oklab, var(--background) 88%, transparent); border-top: 1px solid var(--hairline) }
.file-tile-badge { flex: none; padding: 0 3px; border-radius: 3px; font-size: 9px; font-weight: 700; line-height: 14px;
  background: color-mix(in oklab, var(--kind, var(--fg-2)) 22%, var(--background)); color: color-mix(in oklab, var(--kind, var(--fg-2)) 70%, var(--foreground)) }
.file-tile-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px }
/* La galería: la imagen ocupa lo que queda, el pie dice de quién y cuándo, y abajo la tira de miniaturas. */
.gallery { flex: 1; min-height: 0; display: flex; flex-direction: column; background: color-mix(in oklab, var(--muted) 55%, var(--background)) }
.gallery-stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; padding: 14px }
.gallery-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; cursor: zoom-in;
  box-shadow: 0 1px 2px color-mix(in oklab, var(--background) 55%, transparent), 0 6px 18px color-mix(in oklab, var(--background) 45%, transparent) }
.gallery-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 50%;
  background: var(--popover); color: var(--popover-foreground); display: grid; place-items: center; cursor: pointer; opacity: .85 }
.gallery-nav:hover { opacity: 1; background: var(--accent); color: var(--accent-foreground) }
.gallery-nav:focus-visible { outline: 2px solid var(--ring); opacity: 1 }
.gallery-nav.prev { left: 8px }
.gallery-nav.next { right: 8px }
.gallery-caption { flex: none; padding: 0 16px 10px; display: flex; flex-direction: column; gap: 2px }
.gallery-meta { color: var(--fg-2); font-size: var(--text-xs) }
.gallery-text { margin: 0; font-size: var(--text-sm); line-height: 1.35; max-height: 4.1em; overflow-y: auto; white-space: pre-wrap }
.gallery-strip { flex: none; display: flex; gap: 6px; overflow-x: auto; padding: 8px 12px 12px; border-top: 1px solid var(--border) }
.gallery-thumb { flex: none; width: 52px; height: 52px; padding: 0; border: 2px solid transparent; border-radius: 6px; overflow: hidden;
  background: var(--muted); cursor: pointer; opacity: .65 }
.gallery-thumb img { width: 100%; height: 100%; object-fit: cover; display: block }
.gallery-thumb:hover { opacity: 1 }
.gallery-thumb.on { border-color: var(--primary); opacity: 1 }
.gallery-thumb:focus-visible { outline: 2px solid var(--ring) }
.attach-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2) }
.attach-chip { display: flex; align-items: center; gap: var(--space-2); max-width: 280px; padding: 2px 4px 2px 10px;
  border: 1px solid var(--border); border-radius: 999px }
.composer-attach { flex: none; width: var(--control-md); min-height: var(--control-md); padding: 0; border-radius: 50% }
.replying { display: flex; align-items: center; gap: var(--space-2) }
.replying .quote { flex: 1 }
/* Un botón de texto con su icono: el icono a la izquierda, un poco más chico que la letra. */
.doc-actions .btn-link, .lightbox-bar .btn-link, .lightbox-bar .btn, .mode-toggle { display: inline-flex; align-items: center; gap: 5px }
.doc-actions .btn-link .ui-icon, .lightbox-bar .btn-link .ui-icon, .lightbox-bar .btn .ui-icon, .mode-toggle .ui-icon { width: 14px; height: 14px }
.live-notice { display: inline-flex; align-items: center; gap: 6px; color: var(--primary-ink, var(--primary)) }
.live-notice .ui-icon { width: 13px; height: 13px }
.composer-row { display: flex; align-items: flex-end; gap: var(--space-2) }
/* La caja con el 😊 adentro, a la derecha (como WhatsApp): la caja deja lugar para el botón. */
.composer-field { position: relative; flex: 1; min-width: 0; display: flex }
.composer-field .composer-text { flex: 1; padding-right: 42px }
.composer-emoji { position: absolute; right: 6px; bottom: 4px }
.dictation-note { margin: 0; font-size: var(--text-sm); color: var(--fg-2) }
.dictation-note.error { color: var(--send-fail) }
.composer-text { height: auto; min-height: var(--control-md); max-height: 160px; padding-block: 7px; resize: none; line-height: 1.4;
  font: inherit; font-size: var(--text-body); border-radius: 18px; padding-inline: 14px }

.json { font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.5; white-space: pre-wrap; overflow-x: auto; margin: 0;
  max-height: 420px; overflow-y: auto }
.bubble-row.in .bubble:has(.json) { max-width: min(720px, 92%) }

/* ── el pie ── */
.status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-3); margin-right: 6px }
.status-dot.on { background: var(--presence-on) }
</style>
