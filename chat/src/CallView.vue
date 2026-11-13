<script setup>
/* LA VIDEOLLAMADA de una conversación: los que están en ella (personas y sus agentes) como personajes en papel
   cortado. Por ahora es sólo visual: todos escuchan, con su parpadeo y su balanceo; todavía no reaccionan a lo que se
   escribe en el chat. Los personajes salen de ./characters (un JSON por personaje).

   EL ACOMODO, COMO EN UNA VIDEOLLAMADA: cada recuadro guarda su proporción (4:3) y la grilla prueba todas las
   columnas posibles y se queda con la que deja los recuadros más grandes en el espacio que hay. Así, en una ventana
   ancha van en una fila, en una alta se apilan, y siempre quedan centrados, sin estirarse ni cortarse. La última fila,
   si está incompleta, también se centra.

   LAS VOCES (callVoice.js, ElevenLabs): MIENTRAS LA VIDEOLLAMADA ESTÁ ABIERTA, cada mensaje que llega lo dice quien lo
   escribió (la persona, o su agente si habló por él), con la voz de su JSON; si llegan varios juntos, esperan su turno
   y no se pisan. Lo que escribís vos no se lee, y lo que llegó antes de abrir la llamada tampoco: así sólo se paga lo
   que se oye. Quien habla abre la boca con el volumen real del audio y abajo sale la frase. Un clic en un recuadro hace
   que ese personaje salude. (Hubo un «Reproducir demo» con una conversación inventada; se quitó cuando llegó la línea de
   tiempo, que repite la conversación de verdad.)

   LAS MENCIONES: «hola @miguel/luigi» se dice «hola Luigi» (y @todos, «todos»), y mientras suena, los nombrados
   reaccionan: su recuadro se marca, miran hacia arriba y aparece un 👋. También cuenta el nombre al empezar, sin @
   («Luigi, te envío…»). Los que NO son nombrados siguen en lo suyo (teclean, un poco apagados): el mensaje no es
   con ellos. Lo que escribís vos no suena, pero si nombrás
   a alguien, también reacciona un momento: así se ve a quién le hablás.

   SÓLO LO CONVERSADO (callSpeech.js): de cada mensaje se dice hasta ~40 s; títulos, tablas y código no se leen, y un
   adjunto sin presentar se anuncia en una frase. LO QUE SE MANDA LO TIENEN LOS QUE LO RECIBEN: mientras quien lo mandó
   habla, los nombrados (o todos los demás, si no nombró a nadie) sostienen una hoja (un documento), una foto (una
   imagen), el llavero (claves) o una hoja que corre (lo largo que quedó en el chat) y miran hacia abajo, leyéndolo;
   unos segundos después lo guardan. */
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { hush, refreshVoice, say, voice } from './callVoice.js'
import { EVERYONE, mentionsIn } from './mentions.js'
import { forCall } from './callSpeech.js'
import { spokenNames } from './voiceText.js'
import { speech } from './speech.js'
import { characters } from './characters/index.js'
import { assignVoice, voiceAssign } from './voiceAssign.js'
import { loop as sfxLoop, play as sfxPlay, setAmbient, setSfx, sfx, stopLoops } from './sfx.js'

const props = defineProps({
  cast: { type: Array, required: true },
  messages: { type: Array, default: () => [] },   // los de la conversación abierta
  me: { type: String, default: '' },              // mi correo
  peer: { type: String, default: '' },            // la clave de la conversación (correo o #grupo)
})
const ASPECT = 4 / 3, GAP = 10, PAD = 12, BAR = 46 // BAR: el alto de la línea de tiempo, abajo
const box = ref(null)
const size = ref({ w: 0, h: 0 })
let observer = null
// se mide el tamaño real del contenedor (con su relleno) cada vez que cambia, también cuando pasa de oculto a visible
// (en pantalla angosta la conversación arranca escondida y mide 0)
const measure = () => { const el = box.value; if (el) size.value = { w: el.clientWidth, h: el.clientHeight } }
onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(box.value)
  measure() // ya, sin esperar al primer cuadro: en una ventana que no se está pintando (de fondo) ese cuadro no llega y la grilla quedaba en 0
  requestAnimationFrame(measure)
  // ¿hay voz ahora? (la llave o el tope del día pueden haber cambiado desde que cargó la página): el chip «sin voz»
  refreshVoice()
})
onBeforeUnmount(() => { observer?.disconnect(); hush(); clearTimeout(nudgeTimer); clearTimeout(muteTimer) })

// la mejor grilla: para cada número de columnas, el ancho de recuadro que entra en ancho y en alto; gana el más grande
const layout = computed(() => {
  const n = props.cast.length, W = size.value.w - PAD * 2, H = size.value.h - PAD * 2 - BAR // clientHeight incluye el relleno de abajo (PAD + BAR)
  if (!n || W <= 0 || H <= 0) return { cols: 1, w: 0 }
  let best = { cols: 1, w: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * ASPECT)
    if (w > best.w) best = { cols, w: Math.floor(w) }
  }
  return best
})
// en recuadros chicos la placa se achica, para no tapar la cara
const compact = computed(() => layout.value.w < 220)

// ── LA VOZ DE CADA UNO, y cambiarla de género (el ♂/♀ que aparece al pasar el mouse por su recuadro) ─────────
// Cada personaje habla con la voz de su JSON, salvo que se le haya cambiado (voice-assign.json en el servidor, que vale
// en el navegador y en Cockpit). Cambiar de género le da la PRIMERA VOZ LIBRE del otro: en la lista de voces de
// ElevenLabs (guardada en el servidor), primero las colombianas, después las latinas y después las demás, por nombre
// (esto vale para PERSONAS; un animal cambia entre las dos voces de su especie);
// libre = que no la use ningún personaje (de esta llamada o de otra). Primero van las mejores voces en español (el
// ranking de uso de ElevenLabs, chat/server/voice_top.go). Si la del JSON es del género pedido y está libre,
// vuelve a ésa.
const voiceList = ref([])
fetch('/api/voice/voices').then((r) => r.json()).then((d) => { voiceList.value = d.voices || [] }).catch(() => {})
const assigned = computed(() => voiceAssign.map) // compartido con el perfil (voiceAssign.js)
const charKey = (c) => (c.handle ? c.handle.toLowerCase() : `${c.owner.toLowerCase()}/${c.agent.toLowerCase()}`)
// LOS ANIMALES HABLAN CON LA VOZ DE SU ESPECIE (chat/server/voice_top.go): cada especie tiene una de mujer y una de
// hombre, voces de personaje; las 20 mejores quedan para las personas. Para un animal, lo asignado es su género
// ('female' o 'male', lo cambia el ♂/♀) o, si se eligió en el perfil, una voz con nombre. Sin nada, mujer.
const speciesVoices = ref({})
fetch('/api/voice/species').then((r) => r.json()).then((d) => { speciesVoices.value = d.species || {} }).catch(() => {})
const speciesOf = (c) => c.character?.species || ''
const isAnimal = (c) => !!speciesVoices.value[speciesOf(c)]
const GENDERS = ['female', 'male']
const animalGender = (c) => (GENDERS.includes(assigned.value[charKey(c)]) ? assigned.value[charKey(c)] : c.voice?.gender || 'female')
function voiceName(c) {
  const a = assigned.value[charKey(c)]
  if (isAnimal(c)) return a && !GENDERS.includes(a) ? a : speciesVoices.value[speciesOf(c)][animalGender(c) === 'male' ? 'male' : 'female']
  return a || c.voice?.name || ''
}
// la voz con que sonó cada mensaje (por su id): al repetirlo, ésa; lo nuevo, la de ahora (y queda anotada)
const said = ref({})
fetch('/api/voice/said').then((r) => r.json()).then((d) => { said.value = d.said || {} }).catch(() => {})
const msgId = (m) => m.sid || m.id || ''
function voiceForMessage(m, c) {
  const id = msgId(m), had = id && said.value[id]
  if (had) return { ...voiceOf(c), name: had }
  const v = voiceOf(c)
  if (id && v.name) {
    said.value = { ...said.value, [id]: v.name }
    fetch('/api/voice/said', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, voice: v.name }) }).catch(() => {})
  }
  return v
}
const voiceOf = (c) => ({ ...(c.voice || {}), name: voiceName(c) })
// la voz de la lista que corresponde a un nombre: el JSON puede traer el nombre corto («Rogher Osorio») y la lista el
// completo («Rogher Osorio Locutor Colombia»); cuentan como la misma
const findVoice = (name) => voiceList.value.find((v) => v.name === name) || voiceList.value.find((v) => name && v.name.startsWith(`${name} `))
const genderOf = (c) => (isAnimal(c) && !(assigned.value[charKey(c)] && !GENDERS.includes(assigned.value[charKey(c)]))
  ? animalGender(c) : findVoice(voiceName(c))?.gender || '')
const ACCENT_RANK = (a) => (/colomb/i.test(a) ? 0 : /latin|mexic|argentin|spanish|chile|peru|venezuel/i.test(a) ? 1 : 2)
// las voces ocupadas (menos la de `c`), por su nombre en la lista: las de los personajes con archivo y todas las
// asignadas (también las de agentes sin archivo). Así «Rogher Osorio» del JSON ocupa «Rogher Osorio Locutor Colombia».
// (Sólo cuentan las PERSONAS: los animales usan la voz de su especie y pueden repetir.)
function usedVoices(c) {
  const names = characters.filter((x) => charKey(x) !== charKey(c) && !isAnimal(x)).map(voiceName)
  return new Set(names.filter(Boolean).map((n) => findVoice(n)?.name || n))
}
// las voces para personas: las mejores (pool people) y las de la cuenta; nunca las de personaje (son de los animales)
const peopleVoices = () => voiceList.value.filter((v) => v.pool !== 'character')
// el género con más voces libres (para un agente nuevo: que se repartan parejo)
function roomierGender(c) {
  const used = usedVoices(c)
  const free = (g) => peopleVoices().filter((v) => v.gender === g && !used.has(v.name)).length
  return free('female') >= free('male') ? 'female' : 'male'
}
function freeVoice(gender, c) {
  // las ocupadas, por su nombre en la lista (así «Rogher Osorio» del JSON ocupa «Rogher Osorio Locutor Colombia»)
  const used = usedVoices(c)
  const own = findVoice(c.voice?.name)?.name || c.voice?.name
  const candidates = peopleVoices().filter((v) => v.gender === gender)
    // primero las mejores (su puesto en el ranking de ElevenLabs: voice_top.go), después por acento y nombre
    .sort((a, b) => (Number(a.top) || 999) - (Number(b.top) || 999) || ACCENT_RANK(a.accent) - ACCENT_RANK(b.accent) || a.name.localeCompare(b.name))
  // la de su JSON primero, si es de ese género y nadie la usa
  if (own && candidates.some((v) => v.name === own) && !used.has(own)) return own
  return (candidates.find((v) => !used.has(v.name)) || candidates[0])?.name || ''
}
const genderBusy = ref('')
async function switchGender(c) {
  const target = genderOf(c) === 'female' ? 'male' : 'female'
  if (isAnimal(c)) {
    // un animal pasa a la otra voz de su especie; si vuelve a la de siempre (su JSON, o mujer), se borra lo asignado
    genderBusy.value = charKey(c)
    try { await assignVoice(charKey(c), target === (c.voice?.gender || 'female') ? '' : target) } catch { /* se queda como estaba */ }
    finally { genderBusy.value = '' }
    greet(c)
    return
  }
  const name = freeVoice(target, c)
  if (!name) return
  genderBusy.value = charKey(c)
  try {
    // si queda la de su JSON, se borra la asignación (vuelve a lo de siempre)
    await assignVoice(charKey(c), name === (findVoice(c.voice?.name)?.name || c.voice?.name) ? '' : name)
  } catch { /* sin servidor: se queda como estaba */ } finally { genderBusy.value = '' }
  greet(c) // que se oiga cómo quedó
}
// ── ENTRAR Y SALIR DE LA LLAMADA ────────────────────────────────────────────────────────────────────
// Cuando alguien entra al grupo (o sale), su recuadro aparece (o se va) con su animación y la grilla se reacomoda sola,
// como en una videollamada. El que entra, si no tiene voz (un agente nuevo), recibe la primera libre del género con más
// voces libres, y saluda. Abajo sale el aviso. Lo que ya estaba al abrir la llamada no cuenta como entrar.
const arrival = ref('') // el aviso de quién entró o salió
let arrivalTimer = 0
function announce(text) { arrival.value = text; clearTimeout(arrivalTimer); arrivalTimer = setTimeout(() => { arrival.value = '' }, 5000) }
onBeforeUnmount(() => clearTimeout(arrivalTimer))
// una voz para quien no tiene (un agente nuevo): la primera libre del género con más voces libres
async function giveVoice(c) {
  // sin la lista de voces todavía, se espera un poco (recién abierta la llamada)
  for (let i = 0; i < 20 && !voiceList.value.length; i++) await new Promise((r) => setTimeout(r, 250))
  if (isAnimal(c) || voiceName(c) || !voiceList.value.length) return // un animal ya tiene la de su especie
  const name = freeVoice(roomierGender(c), c)
  if (name) { try { await assignVoice(charKey(c), name) } catch { /* sin servidor: queda sin voz */ } }
}
async function welcome(c) {
  await giveVoice(c)
  say(keyOf(c), `Hola a todos, soy ${c.name}. Acabo de entrar.`, voiceOf(c))
}
// al abrir la llamada, los que ya estaban y no tienen voz reciben una (sin saludar: no acaban de entrar)
onMounted(async () => { for (const c of props.cast) await giveVoice(c) })
watch(() => props.cast.map(keyOf).join(','), (current, before) => {
  if (before === undefined) return
  const was = new Set(before.split(',').filter(Boolean)), is = new Set(current.split(',').filter(Boolean))
  for (const c of props.cast) if (!was.has(keyOf(c))) { sfxPlay('join'); announce(`${c.name} entró a la llamada.`); welcome(c) }
  for (const k of was) if (!is.has(k)) { sfxPlay('leave'); announce(`${leftNames.get(k) || k.split('/').pop()} salió de la llamada.`) }
})
// los nombres de los que estaban, para decir quién salió cuando ya no está en la lista
const leftNames = new Map()
watch(() => props.cast, (list) => { for (const c of list) leftNames.set(keyOf(c), c.name) }, { immediate: true })

const genderTitle = (c) => {
  const g = genderOf(c)
  return `${g === 'female' ? 'Voz de mujer' : g === 'male' ? 'Voz de hombre' : 'Voz'} (${voiceName(c)}). Clic: cambiar a voz de ${g === 'female' ? 'hombre' : 'mujer'}`
}

// ── quién habla ───────────────────────────────────────────────────────────────────────────────────
const userOf = (key) => String(key || '').toLowerCase().replace(/^agent:/, '').split('/')[0].split('@')[0]
// función declarada (no una const): la usan vigilancias inmediatas que están más arriba en el archivo, y una const
// todavía no existe ahí (en desarrollo revienta la llamada; en producción el minificador lo escondía)
function keyOf(c) { return c.handle ? c.handle.toLowerCase() : `${c.owner.toLowerCase()}/${c.agent.toLowerCase()}` }
const byKey = computed(() => Object.fromEntries(props.cast.map((c) => [keyOf(c), c])))
// quién dijo un mensaje: lo que llega es de su autor (o de su agente, `via`); lo que sale es tuyo y sólo cuenta si lo
// mandó uno de tus agentes (`asAgent`): lo que escribís vos no se lee
function speakerOf(m) {
  if (m.dir === 'out') return m.asAgent ? byKey.value[`${userOf(props.me)}/${m.asAgent.toLowerCase()}`] || null : null
  const person = userOf(m.author?.email || props.peer)
  const agent = String(m.via || '').toLowerCase()
  return byKey.value[agent ? `${person}/${agent}` : person] || null
}
// las menciones de un mensaje: a quiénes nombra (claves de la llamada; @todos son todos menos quien habla)
function addressedBy(text, speakerKey) {
  const keys = new Set()
  for (const h of mentionsIn(text)) {
    if (h === EVERYONE) props.cast.forEach((c) => keys.add(keyOf(c)))
    else if (byKey.value[h]) keys.add(h)
  }
  // sin @, también cuenta el nombre al empezar, como se le habla a alguien: «Luigi, te envío…», «Hola Wario, …»
  if (!keys.size) {
    const opening = String(text || '').trimStart().replace(/^[¡¿]/, '').replace(/^(hola|oye|ey|buenas)[\s,!]+/i, '')
    for (const c of props.cast) {
      const name = c.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const head = opening.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if (new RegExp(`^${name}\\s*[,:!?.]`, 'i').test(head)) keys.add(keyOf(c))
    }
  }
  keys.delete(speakerKey)
  return [...keys]
}
// el texto como se dice: cada mención por el nombre del personaje («@miguel/luigi» → «Luigi»)
function spoken(text) {
  return spokenNames(text, Object.fromEntries(props.cast.map((c) => [keyOf(c), c.name])))
}
// SILENCIADO: un mensaje gigante (o uno que no entró en la fila) no se dice; quien lo mandó lleva un 🔇 unos segundos y
// abajo sale el aviso. Así no se gasta ElevenLabs en un mamotreto y se sabe que llegó algo para leer en el chat.
const muted = ref(null) // { key, until }
let muteTimer = 0
function mute(key) {
  muted.value = { key, until: Date.now() + 6000 }
  clearTimeout(muteTimer)
  muteTimer = setTimeout(() => { muted.value = null }, 6000)
}
const mutedNote = computed(() => (muted.value ? `${byKey.value[muted.value.key]?.name || 'Alguien'} mandó algo muy largo: quedó en el chat.` : ''))
// (el tope de palabras es el del perfil, Voz: speech.js)

// los que nombraste vos (tus mensajes no suenan): reaccionan unos segundos
const nudged = ref([])
let nudgeTimer = 0
function nudge(keys) {
  if (!keys.length) return
  nudged.value = keys
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => { nudged.value = [] }, 3500)
}
// Decir un mensaje: true si quedó sonando (o en fila); false si no hay nada que decir (silenciado, vacío, tuyo).
function speakMessage(m) {
  const c = speakerOf(m)
  if (!c || !(m.text || m.files?.length)) return false
  const { text, prop, muted: tooLong } = forCall(m)
  if (tooLong) { mute(keyOf(c)); return false }
  const to = addressedBy(m.text, keyOf(c))
  // lo que se mandó lo tienen en la mano los que lo reciben: los nombrados o, si no nombró a nadie, todos los demás
  const holders = prop ? (to.length ? to : props.cast.map(keyOf).filter((k) => k !== keyOf(c))) : []
  if (!text) return false
  if (!say(keyOf(c), spoken(text), voiceForMessage(m, c), to, prop, holders)) { mute(keyOf(c)); return false }
  return true
}

// ── LA VOZ YA LISTA: lo que se dice en la conversación queda en audio aunque la llamada esté cerrada ──────────────
// Sin botón (server/voice_sync.go): al abrir la llamada se le pasa al servidor la voz y el nombre de cada personaje (los
// sabe resolver esta vista: su JSON, lo cambiado, la de su especie) y desde ahí él pasa a voz cada mensaje que entra y
// completa hoy y ayer. De anteayer para atrás queda sin audio (en gris en la línea) hasta escucharlo: si en la línea de tiempo
// se vuelve a un mensaje sin audio y suena, se le pide al servidor ese día desde ahí, y lo va bajando por delante de lo
// que suena; al pasar al día siguiente se pide ése. Las frases salen de la misma receta (voiceText.js) a los dos lados.
const syncState = ref(null)       // { on, pending, spent, error } de esta conversación
const readyIds = ref(new Set())   // los mensajes que ya tienen todo su audio
const msgDay = (m) => (m?.time ? new Date(m.time).toLocaleDateString('sv-SE') : '') // «2026-11-13», en la hora local
function castVoices() {
  const voices = {}, names = {}
  for (const c of props.cast) {
    const v = voiceName(c)
    if (v) voices[keyOf(c)] = v
    names[keyOf(c)] = c.name
  }
  return { voices, names }
}
function syncBody(extra = {}) {
  return JSON.stringify({ conversation: props.peer, me: userOf(props.me), maxWords: speech.maxWords, ...castVoices(), ...extra })
}
async function loadReady() {
  try {
    const d = await (await fetch(`/api/voice/sync?conversation=${encodeURIComponent(props.peer)}`)).json()
    syncState.value = d.status || null
    readyIds.value = new Set(d.ready || [])
  } catch { /* sin servidor: la barra no marca qué falta */ }
}
// la llamada se abrió (o cambió una voz, o el tope de palabras): en vivo, hoy y ayer
function pushVoices() {
  if (!props.peer || !Object.keys(castVoices().voices).length) return
  fetch('/api/voice/sync', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: syncBody() })
    .then(() => loadReady()).catch(() => {})
}
watch(() => [props.peer, speech.maxWords, JSON.stringify(castVoices())].join('|'), pushVoices, { immediate: true })
// un día viejo sin audio, al escucharlo: se pide desde ese mensaje hasta el final de su día (una vez por día)
const askedDays = new Set()
function fetchAhead(m) {
  const id = msgId(m), day = msgDay(m)
  if (!id || readyIds.value.has(id) || askedDays.has(day)) return
  askedDays.add(day)
  fetch('/api/voice/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: syncBody({ from: id }) }).catch(() => { askedDays.delete(day) })
}
// cada avance del servidor: cómo va y, un momento después, qué quedó listo
let readyTimer = 0
function onSyncEvent(e) {
  if (String(e.detail?.conversation || '') !== String(props.peer).toLowerCase()) return
  syncState.value = e.detail.status
  clearTimeout(readyTimer)
  readyTimer = setTimeout(loadReady, 400)
}
onMounted(() => window.addEventListener('chat:voice-sync', onSyncEvent))
onBeforeUnmount(() => { window.removeEventListener('chat:voice-sync', onSyncEvent); clearTimeout(readyTimer) })
watch(() => props.peer, () => { askedDays.clear(); loadReady() })
const syncLabel = computed(() => {
  const s = syncState.value
  if (s?.pending > 0) return `Preparando la voz: ${s.pending} ${s.pending === 1 ? 'mensaje' : 'mensajes'}`
  return s?.error ? `La voz no se pudo preparar: ${s.error}` : ''
})

// ── LA LÍNEA DE TIEMPO, como un directo ─────────────────────────────────────────────────────────
// Cada mensaje que la llamada puede decir es un punto. En vivo (lo normal) suena lo que va llegando; con un clic en un
// punto (o ⏮, desde el primero) se vuelve atrás y se escucha de corrido, mensaje por mensaje, hasta alcanzar el
// directo. Lo ya escuchado no se vuelve a pagar: el servidor guarda cada frase (voice.go).
const timeline = computed(() => props.messages
  .filter((m) => speakerOf(m) && (m.text || m.files?.length))
  .map((m) => ({ m, c: speakerOf(m) })))
const mode = ref('live')     // 'live' · 'replay' (reproduciendo desde atrás) · 'paused'
const at = ref(-1)           // el punto que suena (índice en timeline), -1 si ninguno
let advanceTimer = 0

// reproducir desde el punto i, de corrido
function replayFrom(i) {
  hush(); clearTimeout(advanceTimer)
  mode.value = 'replay'
  playAt(i)
}
function playAt(i) {
  if (i >= timeline.value.length) { mode.value = 'live'; at.value = -1; return } // alcanzó el directo
  at.value = i
  fetchAhead(timeline.value[i].m)
  // uno sin voz (silenciado, sólo un adjunto sin texto…) se muestra un momento y se sigue
  if (!speakMessage(timeline.value[i].m)) advanceTimer = setTimeout(() => { if (mode.value === 'replay' && at.value === i) playAt(i + 1) }, 1500)
}
// cuando termina de sonar un mensaje, en repetición sigue el siguiente
watch(() => voice.busy, (busy) => {
  if (!busy && mode.value === 'replay' && at.value >= 0) playAt(at.value + 1)
  if (!busy && mode.value === 'live') at.value = -1
})
function togglePause() {
  if (mode.value === 'paused') { replayFrom(Math.max(0, at.value)); return }
  if (mode.value === 'replay') { mode.value = 'paused'; clearTimeout(advanceTimer); hush(); return }
  // en vivo: pausar es quedarse en el último y no decir lo que llegue
  mode.value = 'paused'; hush(); at.value = Math.max(0, timeline.value.length - 1)
}
function goLive() { hush(); clearTimeout(advanceTimer); mode.value = 'live'; at.value = -1 }
onBeforeUnmount(() => clearTimeout(advanceTimer))

// lo que llega con la llamada abierta: en vivo se dice, en fila (callVoice espera a que termine el anterior); en
// repetición o en pausa espera su turno en la línea de tiempo
watch(() => props.messages.length, (n, old) => {
  if (!(n > old)) return
  for (const m of props.messages.slice(old)) {
    if (speakerOf(m)) {
      if (mode.value === 'live' && speakMessage(m)) at.value = timeline.value.findIndex((x) => x.m === m)
    }
    else if (m.dir === 'out' && m.text) nudge(addressedBy(m.text, userOf(props.me)))
  }
})
// LA BARRA, como la de un video en directo: una línea limpia con lo ya escuchado relleno y un cabezal donde vas (sin
// marcas: hacían ruido). Cada mensaje tiene su lugar parejo a lo largo de la línea (una conversación tiene huecos de
// horas: por hora real, todo quedaría apretado en una punta) y al final está el directo. Se toca o se arrastra en
// cualquier parte: el cabezal salta al mensaje más cercano, arriba se ve quién y cuándo, y al soltar suena desde ahí;
// llevarlo hasta el final es volver al directo. Los últimos 80.
const TIMELINE_MAX = 80
const windowStart = computed(() => Math.max(0, timeline.value.length - TIMELINE_MAX))
const shown = computed(() => timeline.value.slice(windowStart.value))
// n mensajes y, al final, el directo: el mensaje k está en k/n y el directo en 100%
const pos = (k) => (shown.value.length ? (k / shown.value.length) * 100 : 100)
// LOS DÍAS en la línea: una raya donde empieza cada uno, con su fecha. Y lo que todavía no tiene audio (los días viejos
// que nadie escuchó) va en gris: al darle play desde ahí se baja.
const dayLabel = (m) => new Date(m.time).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })
const dayMarks = computed(() => shown.value.flatMap(({ m }, k) => (k && msgDay(m) !== msgDay(shown.value[k - 1].m) ? [{ at: pos(k), label: dayLabel(m) }] : [])))
const missing = computed(() => {
  const out = []
  shown.value.forEach(({ m }, k) => {
    if (readyIds.value.has(msgId(m)) || !forCall(m).text) return
    const last = out[out.length - 1]
    if (last && last.to === pos(k)) last.to = pos(k + 1)
    else out.push({ from: pos(k), to: pos(k + 1) })
  })
  return out
})
function describe(i) {
  const x = timeline.value[i]
  if (!x) return ''
  const time = x.m.time ? new Date(x.m.time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''
  const words = String(x.m.text || '').split(/\s+/).filter(Boolean)
  return `${x.c.name}${time ? ` · ${time}` : ''} · ${words.length ? words.slice(0, 8).join(' ') + (words.length > 8 ? '…' : '') : '(adjunto)'}`
}
const scrub = ref(-1)        // la marca bajo el dedo mientras se arrastra (-1: no se está arrastrando)
// dónde está el cabezal (0–100): arrastrando, la marca bajo el dedo; repitiendo, la que suena; en vivo, al final
const head = computed(() => {
  if (scrub.value === LIVE) return 100
  const i = scrub.value >= 0 ? scrub.value : mode.value !== 'live' && at.value >= 0 ? at.value : -1
  return i < 0 ? 100 : pos(i - windowStart.value)
})
const LIVE = Infinity // la marca del directo, al final de la línea
const headLabel = computed(() => (scrub.value === LIVE ? 'En vivo' : scrub.value >= 0 ? describe(scrub.value) : ''))
const track = ref(null)
// la marca más cercana a un punto de la línea
function markAt(clientX) {
  const r = track.value.getBoundingClientRect(), n = shown.value.length
  if (!n) return -1
  const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  const k = Math.round(f * n)
  return k >= n ? LIVE : windowStart.value + k // hasta el final de la línea es volver al directo
}
function scrubStart(e) {
  if (!shown.value.length) return
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* sin captura, el arrastre igual sigue mientras el dedo esté encima */ }
  scrub.value = markAt(e.clientX)
}
function scrubMove(e) { if (scrub.value >= 0) scrub.value = markAt(e.clientX) }
function scrubEnd() {
  if (scrub.value < 0) return
  const i = scrub.value
  scrub.value = -1
  if (i === LIVE) goLive(); else replayFrom(i)
}
// con el teclado: ← y → mueven de a un mensaje
function scrubKey(e) {
  const cur = mode.value !== 'live' && at.value >= 0 ? at.value : timeline.value.length
  if (e.key === 'ArrowLeft') { e.preventDefault(); replayFrom(Math.max(windowStart.value, cur - 1)) }
  if (e.key === 'ArrowRight') { e.preventDefault(); if (cur + 1 >= timeline.value.length) goLive(); else replayFrom(cur + 1) }
}
// lo que muestra cada uno ahora (una hoja, una foto): callVoice dice hasta cuándo; un reloj de medio segundo lo apaga
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 500)
onBeforeUnmount(() => clearInterval(clock))
const propOf = (c) => { const p = voice.props[keyOf(c)]; return p && p.until > now.value ? p.kind : '' }
const gestureOf = (c) => (speaking.value === keyOf(c) ? 'habla' : propOf(c) ? 'teclea' : addressed.value.has(keyOf(c)) ? 'escucha'
  : activityOf(c) === 'cafe' || reactionOf(c) ? 'escucha' : 'teclea') // los ojos, en el portátil; con la taza o celebrando, arriba

// ── EL PORTÁTIL Y LO QUE HACEN MIENTRAS TANTO ───────────────────────────────────────────────────────────
// Todos tienen su portátil delante (abajo, a la altura del pecho) y la mirada puesta en él. Cada uno, por su cuenta y de
// vez en cuando, lo cierra y se toma un tinto, y lo vuelve a abrir; o se pone los audífonos mientras trabaja. Si le
// hablan (lo nombran), levanta la mirada; si le mandan algo, guarda el portátil para tener la hoja o la foto.
const ACTIVITIES = { cafe: [8000, 12000], audifonos: [9000, 14000] } // cuánto dura cada una: entre [mín, máx] ms
const activities = ref({}) // clave → { kind, until }
const activityOf = (c) => { const a = activities.value[keyOf(c)]; return a && a.until > now.value ? a.kind : '' }
const isIdle = (c) => speaking.value !== keyOf(c) && !propOf(c) && !addressed.value.has(keyOf(c)) && muted.value?.key !== keyOf(c)
const activityTimer = setInterval(() => {
  const t = Date.now(), next = {}
  for (const c of props.cast) {
    const a = activities.value[keyOf(c)]
    if (a && a.until > t) { next[keyOf(c)] = a; continue }
    // cada 3 s, uno libre arranca algo con poca probabilidad: así cada quien va a su ritmo
    if (!isIdle(c) || Math.random() > 0.1) continue
    const kind = Math.random() < 0.5 ? 'cafe' : 'audifonos'
    const [lo, hi] = ACTIVITIES[kind]
    next[keyOf(c)] = { kind, until: t + lo + Math.random() * (hi - lo) }
  }
  activities.value = next
}, 3000)
onBeforeUnmount(() => clearInterval(activityTimer))
// EL PORTÁTIL, LA TAZA, LOS AUDÍFONOS Y LOS BRAZOS LOS DIBUJA EL PERSONAJE (office/personajes.js, personProps): acá
// sólo se le dice qué hace, con los atributos `portatil` y `actividad` del componente. Antes el chat dibujaba su propio
// portátil y su taza encima del recuadro, y para los audífonos cambiaba la config, que redibujaba el personaje entero.
// el portátil: abierto, salvo mientras toma tinto; no está mientras tiene algo en la mano (null quita el atributo)
const laptopOf = (c) => (propOf(c) ? null : activityOf(c) === 'cafe' ? 'cerrado' : 'abierto')
// lo que hace: el nombrado saluda; si no, su reacción a lo que se acaba de decir; si no, su pausa (tinto o audífonos)
const doingOf = (c) => (propOf(c) || speaking.value === keyOf(c) ? null
  : addressed.value.has(keyOf(c)) ? 'saluda' : reactionOf(c) || activityOf(c) || null)
const configOf = (c) => JSON.stringify({ name: c.name, owner: c.agent ? c.owner : '', ...c.character })
// CUANDO ALGO SALE BIEN, SE NOTA: si lo que se está diciendo trae una buena noticia, de los que escuchan unos celebran
// (brazos arriba y confeti) y otros dan el visto bueno, unos segundos. Una vez por frase.
// (sin \b: no entiende las tildes, y «quedó» seguido de un espacio no le parecía fin de palabra)
const GOOD_NEWS = /(?<![a-záéíóúñ])(listo|lista|comprobado|qued[oó]|pas[oó] tod[oa]|mergead[oa]|desplegad[oa]|resuelt[oa]|arreglad[oa])(?![a-záéíóúñ])|🎉|🚀|✅|🙌/i
const reactions = ref({}) // clave → { kind, until }
const reactionOf = (c) => { const r = reactions.value[keyOf(c)]; return r && r.until > now.value ? r.kind : '' }
// lo gracioso hace reír, lo raro deja con la duda y un susto sorprende: la cara de cada reacción la dibuja el personaje
const FUNNY = /(?<![a-záéíóúñ])(ja(ja)+|je(je)+|ji(ji)+)(?![a-záéíóúñ])|😂|🤣|😄|😆/i
const ODD = /¿c[oó]mo as[ií]|no entiendo|no me cuadra|qu[eé] raro|qu[eé] extraño|🤔/i
const ALARM = /(?<![a-záéíóúñ])(uy|ups|se cay[oó]|se rompi[oó]|en serio)(?![a-záéíóúñ])|😮|😱|🤯|\?!|!\?/i
// qué reacción pide una frase: [cuál, a qué parte de los que escuchan, cuánto dura] o null. Varias por frase, por sorteo.
function reactionsTo(line) {
  if (FUNNY.test(line)) return [['rie', .7, 2200, 1600]]
  if (ODD.test(line)) return [['duda', .45, 2600, 1600]]
  if (ALARM.test(line)) return [['sorpresa', .45, 1800, 1200]]
  // «no quedó», «todavía no está listo»: una negación cerca no es para celebrar
  if (GOOD_NEWS.test(line) && !/(^|[^a-záéíóúñ])(no|ni|sin|falta)\s+(\S+\s+){0,2}(listo|lista|qued|pas[oó]|resuelt|arreglad|comprobad|mergead|desplegad)/i.test(line)) return [['celebra', .4, 2800, 1600], ['pulgar', .3, 2400, 1400]]
  return null
}
watch(() => voice.line, (line) => {
  const kinds = line && reactionsTo(line)
  if (!kinds) return
  const t = Date.now(), next = {}
  for (const c of props.cast) {
    const k = keyOf(c)
    if (k === voice.speaker || propOf(c) || activityOf(c) === 'cafe') continue
    // en un mensaje dirigido, reaccionan los nombrados; los demás siguen en lo suyo
    if (voice.addressed.length && !voice.addressed.includes(k)) continue
    let r = Math.random()
    for (const [kind, share, base, extra] of kinds) {
      if (r < share) { next[k] = { kind, until: t + base + Math.random() * extra }; break }
      r -= share
    }
  }
  reactions.value = next
})

// ── LOS EFECTOS DE SONIDO (sfx.js): lo que pasa en la llamada suena, bajito ─────────────────────────────
// el portátil: al cerrarlo, el clic y enseguida el sorbo del tinto; al abrirlo, su clic
watch(() => props.cast.map((c) => `${keyOf(c)}:${activityOf(c) === 'cafe' ? 'closed' : 'open'}`).join(','), (cur, before) => {
  if (before === undefined) return
  const prev = Object.fromEntries(before.split(',').map((x) => x.split(/:(?=[^:]*$)/)))
  for (const [k, st] of cur.split(',').map((x) => x.split(/:(?=[^:]*$)/))) {
    if (prev[k] === 'open' && st === 'closed') { sfxPlay('lid-close'); setTimeout(() => sfxPlay('sip'), 1300) }
    if (prev[k] === 'closed' && st === 'open') sfxPlay('lid-open')
  }
})
// la música de los audífonos, mientras alguien los tenga puestos; el murmullo de la oficina, si está prendido
watch(() => props.cast.some((c) => activityOf(c) === 'audifonos'), (on) => sfxLoop('headphones', on), { immediate: true })
watch(() => sfx.ambient && sfx.on, (on) => sfxLoop('ambient', on), { immediate: true })
watch(() => sfx.on, (on) => { if (on) { sfxLoop('ambient', sfx.ambient); sfxLoop('headphones', props.cast.some((c) => activityOf(c) === 'audifonos')) } })
onBeforeUnmount(stopLoops)
// una mención: un pop cuando empieza el mensaje que nombra a alguien (o cuando nombrás vos)
watch(() => voice.addressed, (list, old) => { if (list !== old && list?.length) sfxPlay('mention') })
watch(() => nudged.value, (list) => { if (list.length) sfxPlay('mention') })
// lo que reciben: papel, obturador o llaves, cuando aparece en la mano de alguien
watch(() => Object.values(voice.props).map((p) => p.kind).sort().join(','), (cur, before) => {
  const was = new Set(String(before || '').split(','))
  for (const kind of new Set(cur.split(',').filter(Boolean))) {
    if (was.has(kind)) continue
    if (kind === 'doc') sfxPlay('paper')
    if (kind === 'image') sfxPlay('photo')
    if (kind === 'key') sfxPlay('keys')
  }
})
// un mensaje dirigido a alguien (con @ o por su nombre al empezar) no es con los demás: siguen en lo suyo, tecleando, un
// poco apagados. Con @todos, o sin nombrar a nadie, todos escuchan.
const aside = (c) => addressed.value.size > 0 && !addressed.value.has(keyOf(c)) && speaking.value !== keyOf(c) && !propOf(c)

// los que reaccionan ahora: los nombrados por quien habla, o por vos hace un momento
const addressed = computed(() => new Set([...(voice.busy ? voice.addressed : []), ...nudged.value]))

function greet(c) {
  goLive()
  say(keyOf(c), c.agent ? `Hola, soy ${c.name}, el agente de ${c.ownerName || c.owner}.` : `Hola, soy ${c.name}.`, voiceOf(c))
}
const speaking = computed(() => (voice.line ? voice.speaker : ''))
/* LA BOCA VA POR FUERA DEL RENDER DE VUE: `voice.level` cambia en cada cuadro mientras alguien habla, y leerla en el
   template re-evaluaba TODOS los recuadros 60 veces por segundo. Este efecto escribe el atributo `boca` sólo en el
   personaje de quien habla (y sólo cuando el valor cambia de verdad, a dos decimales); al callarse o cambiar de turno
   se lo quita, y el personaje vuelve a su vaivén propio. Corre después del render (`post`): el recuadro ya existe. */
let mouthEl = null, mouthKey = '', mouthValue = ''
function clearMouth() { mouthEl?.removeAttribute('boca'); mouthEl = null; mouthKey = ''; mouthValue = '' }
watchEffect(() => {
  const key = speaking.value, level = voice.level
  if (key !== mouthKey || (mouthEl && !mouthEl.isConnected)) {
    clearMouth()
    mouthKey = key
    if (key) for (const el of box.value?.querySelectorAll('.call-tile') || []) {
      if (el.dataset.key === key) { mouthEl = el.querySelector('office-personaje'); break }
    }
  }
  if (!mouthEl) return
  const value = level.toFixed(2)
  if (value !== mouthValue) { mouthValue = value; mouthEl.setAttribute('boca', value) }
}, { flush: 'post' })
onBeforeUnmount(clearMouth)
/* LOS OJOS, HACIA QUIEN HABLA: mientras alguien tiene la palabra, las pupilas de los demás van hacia su recuadro (el
   atributo `mira` del personaje: la dirección, de -1 a 1). Depende de dónde quedó cada recuadro en la grilla, así que
   se mide en el DOM después del render, igual que la boca. Los que siguen en lo suyo (un mensaje dirigido a otro) no miran. */
watchEffect(() => {
  const key = speaking.value
  void layout.value; void props.cast.length // si la grilla se reacomoda, se vuelve a medir
  const tiles = [...(box.value?.querySelectorAll('.call-tile') || [])]
  const target = key ? tiles.find((el) => el.dataset.key === key) : null // sin nadie hablando key es '', no null
  const to = target ? target.getBoundingClientRect() : null
  for (const el of tiles) {
    const who = el.querySelector('office-personaje')
    if (!who) continue
    const c = byKey.value[el.dataset.key]
    if (!to || el === target || !c || aside(c)) { who.removeAttribute('mira'); continue }
    const from = el.getBoundingClientRect()
    const x = (to.left + to.width / 2) - (from.left + from.width / 2), y = (to.top + to.height / 2) - (from.top + from.height / 2), d = Math.hypot(x, y)
    d < 1 ? who.removeAttribute('mira') : who.setAttribute('mira', `${(x / d).toFixed(2)},${(y / d).toFixed(2)}`)
  }
}, { flush: 'post' })
// el JSON de cada personaje se arma una vez por elenco, no en cada render
const configs = computed(() => Object.fromEntries(props.cast.map((c) => [keyOf(c), configOf(c)])))
const caption = computed(() => (voice.line ? { name: byKey.value[voice.speaker]?.name || '', line: voice.line } : null))

const label = (c) => (c.agent ? `agente de ${c.ownerName || c.owner.split('.')[0]}` : '')
</script>

<template>
  <div ref="box" class="region-body call" aria-label="Videollamada">
    <TransitionGroup tag="div" name="tile" class="call-grid" :class="{ compact }" :style="{ '--tile': `${layout.w}px`, '--cols': layout.cols }">
      <!-- la placa lleva sólo el nombre; de quién es un agente se ve al pasar el mouse -->
      <!-- cada recuadro es un botón (saluda): se llega con Tab y se activa con Enter o espacio. data-key: por ahí
           encuentra el efecto de la boca al personaje de quien habla -->
      <figure v-for="c in cast" :key="keyOf(c)" class="call-tile" :data-key="keyOf(c)" role="button" tabindex="0"
              :class="{ speaking: speaking === keyOf(c), addressed: speaking !== keyOf(c) && addressed.has(keyOf(c)), aside: aside(c) }"
              :title="label(c) ? `${c.name} · ${label(c)}` : c.name"
              :aria-label="`${c.name}${label(c) ? `, ${label(c)}` : ''}: que salude`"
              @click="greet(c)" @keydown.enter.prevent="greet(c)" @keydown.space.prevent="greet(c)">
        <office-personaje :config="configs[keyOf(c)]" :gesto="gestureOf(c)" :portatil="laptopOf(c)" :actividad="doingOf(c)" aria-hidden="true" />
        <!-- lo que muestra: una hoja, una foto o una hoja que corre, en papel cortado como los personajes -->
        <svg v-if="propOf(c)" class="call-prop" :class="propOf(c)" viewBox="0 0 100 80" aria-hidden="true">
          <template v-if="propOf(c) === 'image'">
            <rect x="14" y="10" width="72" height="62" rx="3" fill="#13323a" opacity=".25" transform="translate(3 4)" />
            <rect x="14" y="10" width="72" height="62" rx="3" fill="#fbf6ea" />
            <rect x="20" y="16" width="60" height="42" fill="#8fc9d9" />
            <circle cx="66" cy="27" r="6" fill="#f2c14e" />
            <path d="M20 58 L20 46 Q34 34 46 44 Q58 36 80 46 L80 58 Z" fill="#4f8b8a" />
            <path d="M20 58 L20 52 Q40 46 58 54 Q70 50 80 54 L80 58 Z" fill="#2b6670" />
          </template>
          <!-- el llavero: un aro, una llave dorada y una etiqueta, colgando -->
          <template v-else-if="propOf(c) === 'key'">
            <g class="keyring">
              <g opacity=".25" fill="#13323a" transform="translate(3 4)">
                <circle cx="34" cy="22" r="11" /><circle cx="50" cy="44" r="13" /><rect x="58" y="40" width="30" height="8" rx="2" />
              </g>
              <circle cx="34" cy="22" r="10" fill="none" stroke="#b9cdc6" stroke-width="4" />
              <path d="M26 30 L22 52 L36 56 L40 34 Z" fill="#f6ecd6" />
              <circle cx="31" cy="38" r="2.5" fill="#e5592a" />
              <circle cx="50" cy="44" r="13" fill="#f2c14e" />
              <circle cx="50" cy="44" r="5" fill="#c59a2e" />
              <rect x="58" y="40" width="30" height="8" rx="2" fill="#f2c14e" />
              <rect x="74" y="48" width="5" height="8" fill="#f2c14e" /><rect x="82" y="48" width="5" height="11" fill="#f2c14e" />
              <path d="M41 30 Q46 26 50 31" fill="none" stroke="#b9cdc6" stroke-width="4" />
            </g>
          </template>
          <template v-else>
            <rect x="22" y="6" width="56" height="70" rx="2" fill="#13323a" opacity=".25" transform="translate(3 4)" />
            <path d="M22 6 H66 L78 18 V76 H22 Z" fill="#f6ecd6" />
            <path d="M66 6 V18 H78 Z" fill="#d9c9a6" />
            <rect x="30" y="16" width="26" height="5" rx="2" fill="#e5592a" />
            <!-- los renglones van en su propia ventana: al correr no se salen de la hoja ni pisan el título -->
            <svg x="0" y="25" width="100" height="48" viewBox="0 25 100 48">
              <g class="lines">
                <rect v-for="i in 9" :key="i" x="30" :y="22 + i * 7" :width="i % 3 === 0 ? 28 : 40" height="3" rx="1.5" fill="#2b6670" opacity=".7" />
              </g>
            </svg>
          </template>
        </svg>
        <span v-if="muted?.key === keyOf(c)" class="call-muted" title="Mandó algo muy largo: no se leyó en voz alta">🔇</span>
        <figcaption class="call-name"><b>{{ c.name }}</b></figcaption>
        <!-- cambiar el género de la voz: aparece al pasar el mouse (o con el teclado) -->
        <button v-if="voiceList.length && genderOf(c)" type="button" class="call-gender" :class="{ busy: genderBusy === charKey(c) }"
                :title="genderTitle(c)" :aria-label="genderTitle(c)" @click.stop="switchGender(c)">
          {{ genderOf(c) === 'female' ? '♀' : '♂' }}
        </button>
      </figure>
    </TransitionGroup>
    <!-- sin voz (sin llave, tope del día, servidor caído): se dice por qué, en vez de una llamada muda sin explicación -->
    <span v-if="voice.why" class="call-novoice" role="status">🔇 sin voz: {{ voice.why }}</span>
    <div class="call-timeline" role="group" aria-label="Línea de tiempo de la conversación">
      <button type="button" class="tl-btn" title="Desde el primer mensaje" aria-label="Escuchar desde el primer mensaje"
              :disabled="!timeline.length" @click="replayFrom(windowStart)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 5L9 12l10 7z" /></svg>
      </button>
      <button type="button" class="tl-btn" :title="mode === 'paused' ? 'Seguir' : 'Pausar'" :aria-label="mode === 'paused' ? 'Seguir' : 'Pausar'"
              :disabled="!timeline.length" @click="togglePause">
        <svg v-if="mode === 'paused'" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true" style="stroke: none"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
      </button>
      <div ref="track" class="tl-track" role="slider" tabindex="0" aria-label="Línea de tiempo: ← y → para moverse por los mensajes; al final, el directo"
           :aria-valuemin="0" :aria-valuemax="timeline.length" :aria-valuenow="mode !== 'live' && at >= 0 ? at : timeline.length"
           :aria-valuetext="mode === 'live' ? 'En vivo' : describe(at)"
           @pointerdown="scrubStart" @pointermove="scrubMove" @pointerup="scrubEnd" @pointercancel="scrub = -1" @keydown="scrubKey">
        <div class="tl-line"><div class="tl-fill" :style="{ width: `${head}%` }"></div>
          <span v-for="(g, n) in missing" :key="`g${n}`" class="tl-missing" :style="{ left: `${g.from}%`, width: `${g.to - g.from}%` }"></span>
        </div>
        <template v-for="d in dayMarks" :key="d.label + d.at">
          <span class="tl-day" :style="{ left: `${d.at}%` }"></span>
          <span class="tl-day-label" :style="{ left: `${d.at}%` }">{{ d.label }}</span>
        </template>
        <span class="tl-head" :class="{ live: mode === 'live' && scrub < 0, dragging: scrub >= 0 }" :style="{ left: `${head}%` }"></span>
        <span v-if="headLabel" class="tl-tip" :style="{ left: `${Math.min(85, Math.max(15, head))}%` }">{{ headLabel }}</span>
      </div>
      <!-- preparando la voz (server/voice_sync.go): sólo se ve mientras hay mensajes en fila o si algo falló -->
      <span v-if="syncLabel" class="tl-sync" :class="{ working: syncState?.pending > 0, bad: !(syncState?.pending > 0) }" role="status" :title="syncLabel" :aria-label="syncLabel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></svg>
        <span v-if="syncState?.pending > 0" class="tl-badge">{{ syncState.pending }}</span>
      </span>
      <!-- los efectos de sonido y el murmullo de la oficina (sfx.js) -->
      <button type="button" class="tl-btn" :class="{ off: !sfx.on }" :aria-pressed="sfx.on" :title="sfx.on ? 'Efectos de sonido: prendidos' : 'Efectos de sonido: apagados'"
              :aria-label="sfx.on ? 'Apagar los efectos de sonido' : 'Prender los efectos de sonido'" @click="setSfx(!sfx.on)">
        <svg viewBox="0 0 24 24" aria-hidden="true" style="stroke: none"><path d="M9 17.5a2.5 2.5 0 1 1-1.5-2.3V5l10-2v11.5a2.5 2.5 0 1 1-1.5-2.3V7.2L9 8.6z" /></svg>
      </button>
      <button type="button" class="tl-btn" :class="{ off: !sfx.ambient || !sfx.on }" :aria-pressed="sfx.ambient" :disabled="!sfx.on"
              :title="sfx.ambient ? 'Ambiente de oficina: prendido' : 'Ambiente de oficina: apagado'"
              :aria-label="sfx.ambient ? 'Apagar el ambiente de oficina' : 'Prender el ambiente de oficina'" @click="setAmbient(!sfx.ambient)">
        <svg viewBox="0 0 24 24" aria-hidden="true" style="stroke: none"><path d="M4 21V8l8-5 8 5v13h-6v-6h-4v6zM8 11h2v2H8zm6 0h2v2h-2z" /></svg>
      </button>
      <!-- en vivo, la etiqueta; para volver, el cabezal hasta el final de la línea -->
      <span class="tl-live" :class="{ off: mode !== 'live' }" :title="mode === 'live' ? 'Suena lo que va llegando' : 'Arrastrá hasta el final para volver al directo'">● En vivo</span>
    </div>
    <p v-if="arrival && !caption" class="call-caption arrival">{{ arrival }}</p>
    <p v-else-if="mutedNote && !caption" class="call-caption muted">🔇 {{ mutedNote }}</p>
    <p v-else-if="voice.error && !caption" class="call-caption">{{ voice.error }}</p>
    <p v-if="caption" class="call-caption" aria-live="polite"><b>{{ caption.name }}</b> {{ caption.line }}</p>
  </div>
</template>

<style scoped>
/* el fondo es el del tema (el mismo del editor): sigue el claro, el oscuro y la paleta que se elija en Cockpit */
/* los colores de papel de la llamada (placas, subtítulos): declarados acá, una sola palanca */
.call {
  --call-ink: rgba(19, 50, 58, .88);
  --call-cream: #f6ecd6;
  --call-gold: #f2c14e;
  --call-text-shadow: rgba(0, 0, 0, .25);
}
.call { position: relative; overflow: hidden; background: var(--region-bg, var(--background)); display: grid; place-items: center; padding: 12px;
  padding-bottom: calc(12px + 46px); } /* abajo, el lugar de la línea de tiempo (BAR): la grilla se centra en lo que queda */
/* filas centradas (también la última, si está incompleta): flex con ancho justo para las columnas elegidas */
.call-grid { display: flex; flex-wrap: wrap; justify-content: center; align-content: center; gap: 10px;
  width: calc(var(--cols) * var(--tile) + (var(--cols) - 1) * 10px); max-width: 100%; }
/* el alto va explícito, no con aspect-ratio: en WebKit (la ventana de Cockpit) el recuadro quedaba de 0 de alto porque
   su único hijo pide height: 100% */
.call-tile { position: relative; margin: 0; width: var(--tile); height: calc(var(--tile) * 3 / 4); border-radius: 14px; overflow: hidden;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .35); }
.call-tile office-personaje { display: block; width: 100%; height: 100%; border-radius: 14px; }
.call-name { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); display: flex; gap: 6px; align-items: baseline;
  padding: 3px 9px; border-radius: 8px; background: #f1e4c7; color: #13323a; font-size: 12px; box-shadow: 0 2px 0 #d9c9a6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-name b { font-weight: 800; }
.call-tile { cursor: pointer; transition: box-shadow .15s; }
.call-tile:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
/* quien habla se marca como en una videollamada: el borde del recuadro */
.call-tile.speaking { box-shadow: 0 0 0 3px #f08c3d, 0 6px 18px rgba(0, 0, 0, .35); }
.call-muted { position: absolute; top: 8px; left: 10px; font-size: calc(var(--tile) * .1); line-height: 1;
  padding: 4px 6px; border-radius: 10px; background: var(--call-ink); animation: wave-in .25s ease-out; }
.call-gender { position: absolute; top: 8px; right: 8px; width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer;
  font-size: 17px; font-weight: 800; line-height: 1; color: var(--primary-foreground); background: var(--primary);
  box-shadow: 0 2px 6px rgba(0,0,0,.3); opacity: 0; transform: scale(.85); transition: opacity .15s, transform .15s; }
.call-tile:hover .call-gender, .call-gender:focus-visible { opacity: 1; transform: scale(1); }
.call-gender:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.call-gender.busy { opacity: .6; }
/* entrar y salir: el que entra crece desde el centro, el que sale se achica, y los demás se acomodan en su lugar */
.tile-enter-active { transition: opacity .45s ease, transform .45s cubic-bezier(.2, .9, .3, 1.2); }
.tile-leave-active { transition: opacity .35s ease, transform .35s ease; position: absolute; }
.tile-enter-from { opacity: 0; transform: scale(.6); }
.tile-leave-to { opacity: 0; transform: scale(.7); }
.tile-move { transition: transform .45s ease; }
@media (prefers-reduced-motion: reduce) { .tile-enter-active, .tile-leave-active, .tile-move { transition: none; } }
.call-tile.aside { filter: saturate(.7) brightness(.92); transition: filter .3s; }
.call-tile.addressed { box-shadow: 0 0 0 3px #2b9c8f, 0 6px 18px rgba(0, 0, 0, .35); }
@keyframes wave-in { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
/* el objeto que muestra: sube desde abajo a la altura del pecho, corrido a un lado para no tapar la cara (la boca
   tiene que verse mientras habla), un poco ladeado, y se mece apenas */
.call-prop { position: absolute; left: 68%; bottom: -2%; width: 28%; transform: translateX(-50%) rotate(-6deg);
  animation: prop-in .35s ease-out, prop-bob 2.4s ease-in-out .35s infinite alternate; filter: drop-shadow(0 2px 0 rgba(0,0,0,.15)); }
.call-prop.image { transform: translateX(-50%) rotate(5deg); }
@keyframes prop-in { from { translate: 0 60%; opacity: 0; } to { translate: 0 0; opacity: 1; } }
@keyframes prop-bob { from { translate: 0 0; } to { translate: 0 -4%; } }
/* lo largo que quedó en el chat: los renglones corren, como quien lo va leyendo */
.call-prop.read .lines { animation: prop-read 3s linear infinite; }
@keyframes prop-read { from { transform: translateY(0); } to { transform: translateY(-14px); } }
/* el llavero cuelga y se balancea desde el aro */
.call-prop.key .keyring { transform-origin: 34px 22px; animation: key-swing 1.6s ease-in-out infinite alternate; }
@keyframes key-swing { from { transform: rotate(-10deg); } to { transform: rotate(12deg); } }
@media (prefers-reduced-motion: reduce) { .call-prop, .call-prop.read .lines, .call-prop.key .keyring { animation: none; } }
.call-novoice { position: absolute; top: 10px; right: 12px; max-width: calc(100% - 24px); display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 8px;
  background: var(--card); color: var(--foreground); border: 1px solid var(--border); font-size: 12px; font-weight: 700; }
/* la línea de tiempo: abajo, como la de un directo */
.call-timeline { position: absolute; left: 12px; right: 12px; bottom: 8px; height: 38px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-radius: 12px; background: color-mix(in oklab, var(--background) 85%, transparent);
  border: 1px solid var(--border); }
.tl-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px;
  background: transparent; color: var(--foreground); cursor: pointer; }
.tl-btn:hover { background: var(--hover); }
.tl-btn:disabled { opacity: .4; cursor: default; }
.tl-btn.off { opacity: .45; }
.tl-btn svg { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
.tl-track { flex: 1; min-width: 0; height: 100%; position: relative; margin: 0 8px; cursor: pointer; touch-action: none; outline: none; }
.tl-track:focus-visible .tl-line { outline: 2px solid var(--ring); outline-offset: 4px; }
.tl-line { position: absolute; left: 0; right: 0; top: 50%; height: 4px; translate: 0 -50%; border-radius: 2px;
  background: color-mix(in oklab, var(--foreground) 18%, transparent); }
.tl-fill { height: 100%; border-radius: 2px; background: var(--primary); }
/* el cabezal: donde vas; en vivo, al final y rojo */
/* centrado de verdad sobre la línea: el borde va por dentro (border-box) y se corre con translate, no con márgenes */
.tl-head { position: absolute; top: 50%; width: 16px; height: 16px; box-sizing: border-box; translate: -50% -50%; border-radius: 50%; pointer-events: none;
  background: var(--background); border: 3px solid var(--primary); box-shadow: 0 1px 4px rgba(0,0,0,.35); transition: left .2s ease; }
.tl-head.dragging { transition: none; transform: scale(1.2); }
.tl-head.live { background: var(--primary); }
.tl-tip { position: absolute; bottom: calc(100% + 6px); transform: translateX(-50%); white-space: nowrap; max-width: 320px; overflow: hidden;
  text-overflow: ellipsis; padding: 4px 8px; border-radius: 6px; font-size: 12px; background: var(--foreground); color: var(--background);
  pointer-events: none; }
/* preparando la voz: gira con cuántos faltan; si algo falló, en el color de error */
.tl-sync { position: relative; flex: 0 0 auto; display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; color: var(--primary); }
.tl-sync.bad { color: var(--destructive); }
.tl-sync svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.tl-sync.working svg { animation: tl-spin 1.2s linear infinite; }
@keyframes tl-spin { to { transform: rotate(-360deg); } }
.tl-badge { position: absolute; top: -5px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px; font-size: 10px; font-weight: 800;
  line-height: 15px; text-align: center; background: var(--primary); color: var(--primary-foreground); }
/* lo que no tiene audio (de anteayer para atrás, sin escuchar): la línea en gris, también si ya pasó el cabezal */
.tl-missing { position: absolute; inset: 0 auto; border-radius: 2px; pointer-events: none;
  background: color-mix(in oklab, var(--muted-foreground) 45%, var(--background)); }
/* dónde empieza cada día: una raya y la fecha arriba */
.tl-day { position: absolute; top: 50%; width: 2px; height: 14px; translate: -50% -50%; border-radius: 1px; pointer-events: none;
  background: color-mix(in oklab, var(--foreground) 55%, transparent); }
.tl-day-label { position: absolute; top: -1px; translate: -50% 0; font-size: 9.5px; line-height: 1; white-space: nowrap; pointer-events: none;
  color: var(--muted-foreground); }
@media (prefers-reduced-motion: reduce) { .tl-sync.working svg { animation: none; } }
.tl-live { flex: 0 0 auto; font-size: 12px; font-weight: 800; color: var(--primary); white-space: nowrap; transition: opacity .2s; }
.tl-live.off { opacity: .35; filter: grayscale(1); }
.call-caption { position: absolute; left: 50%; bottom: 58px; transform: translateX(-50%); margin: 0; max-width: min(640px, calc(100% - 32px));
  padding: 6px 12px; border-radius: 10px; background: var(--call-ink); color: var(--call-cream); font-size: 13px; line-height: 1.35; text-align: center; }
.call-caption b { color: var(--call-gold); margin-right: 4px; }
.compact .call-name { left: 5px; bottom: 5px; padding: 1px 6px; font-size: 10.5px; border-radius: 6px; }
</style>
