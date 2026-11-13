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
   que se oye. Quien habla abre la boca con el volumen real del audio y abajo sale la frase. «Reproducir demo» pone a
   hablar a todos con una conversación inventada (callDemo.js) y un clic en un recuadro hace que ese personaje salude.

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
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hush, say, voice } from './callVoice.js'
import { EVERYONE, mentionsIn } from './mentions.js'
import { forCall } from './callSpeech.js'
import { demoLines } from './callDemo.js'

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
  requestAnimationFrame(measure)
})
onBeforeUnmount(() => { observer?.disconnect(); hush(); clearTimeout(nudgeTimer); clearTimeout(muteTimer) })

// la mejor grilla: para cada número de columnas, el ancho de recuadro que entra en ancho y en alto; gana el más grande
const layout = computed(() => {
  const n = props.cast.length, W = size.value.w - PAD * 2, H = size.value.h - PAD * 2 - BAR
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

// ── quién habla ───────────────────────────────────────────────────────────────────────────────────
const userOf = (key) => String(key || '').toLowerCase().replace(/^agent:/, '').split('/')[0].split('@')[0]
const keyOf = (c) => (c.handle ? c.handle.toLowerCase() : `${c.owner.toLowerCase()}/${c.agent.toLowerCase()}`)
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
  return String(text || '').replace(/(^|[^\w@./-])@([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)/gi, (all, pre, handle) => {
    const h = handle.replace(/[._-]+$/, '').toLowerCase()
    const tail = handle.slice(h.length)
    if (h === EVERYONE) return `${pre}todos${tail}`
    const name = byKey.value[h]?.name || h.split('/').pop().split('.')[0]
    return `${pre}${name.charAt(0).toUpperCase()}${name.slice(1)}${tail}`
  })
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
  if (!say(keyOf(c), spoken(text), c.voice, to, prop, holders)) { mute(keyOf(c)); return false }
  return true
}

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
// los puntos de la barra: los últimos 80, con quién y cuándo
const TIMELINE_MAX = 80
const dots = computed(() => {
  const all = timeline.value, from = Math.max(0, all.length - TIMELINE_MAX)
  return all.slice(from).map(({ m, c }, k) => {
    const i = from + k
    const time = m.time ? new Date(m.time).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''
    const words = String(m.text || '').split(/\s+/).filter(Boolean)
    return { i, color: c.character?.shirt || '#2b6670', title: `${c.name}${time ? ` · ${time}` : ''} · ${words.slice(0, 8).join(' ')}${words.length > 8 ? '…' : ''}${!m.text ? '(adjunto)' : ''}`,
      state: i === at.value ? 'now' : at.value >= 0 && i < at.value ? 'past' : mode.value === 'live' ? 'past' : 'next' }
  })
})
// lo que muestra cada uno ahora (una hoja, una foto): callVoice dice hasta cuándo; un reloj de medio segundo lo apaga
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 500)
onBeforeUnmount(() => clearInterval(clock))
const propOf = (c) => { const p = voice.props[keyOf(c)]; return p && p.until > now.value ? p.kind : '' }
const gestureOf = (c) => (speaking.value === keyOf(c) ? 'habla' : propOf(c) ? 'teclea' : addressed.value.has(keyOf(c)) ? 'piensa'
  : aside(c) ? 'teclea' : 'escucha')
// un mensaje dirigido a alguien (con @ o por su nombre al empezar) no es con los demás: siguen en lo suyo, tecleando, un
// poco apagados. Con @todos, o sin nombrar a nadie, todos escuchan.
const aside = (c) => addressed.value.size > 0 && !addressed.value.has(keyOf(c)) && speaking.value !== keyOf(c) && !propOf(c)

// los que reaccionan ahora: los nombrados por quien habla, o por vos hace un momento
const addressed = computed(() => new Set([...(voice.busy ? voice.addressed : []), ...nudged.value]))

// los papeles del demo: vos, la otra persona y los agentes de cada uno
const roles = computed(() => {
  const me = userOf(props.me)
  const meChar = props.cast.find((c) => c.handle && c.handle.toLowerCase() === me)
  const peerChar = props.cast.find((c) => c.handle && c.handle.toLowerCase() !== me)
  const agentsOf = (p) => (p ? props.cast.filter((c) => c.owner && c.owner.toLowerCase() === p.handle.toLowerCase()) : [])
  const [me1, me2] = agentsOf(meChar), [peer1, peer2] = agentsOf(peerChar)
  return { me: meChar, peer: peerChar, me1, me2, peer1, peer2 }
})
function playDemo() {
  if (voice.busy) { hush(); return }
  goLive()
  for (const { who, text } of demoLines(roles.value)) say(keyOf(who), text, who.voice)
}
function greet(c) {
  hush()
  say(keyOf(c), c.agent ? `Hola, soy ${c.name}, el agente de ${c.ownerName || c.owner}.` : `Hola, soy ${c.name}.`, c.voice)
}
const speaking = computed(() => (voice.line ? voice.speaker : ''))
// la apertura de la boca de quien habla (con dos decimales: el atributo cambia sólo cuando cambia de verdad)
const mouth = (c) => (speaking.value === keyOf(c) ? voice.level.toFixed(2) : null)
const caption = computed(() => (voice.line ? { name: byKey.value[voice.speaker]?.name || '', line: voice.line } : null))

const label = (c) => (c.agent ? `agente de ${c.ownerName || c.owner.split('.')[0]}` : '')
</script>

<template>
  <div ref="box" class="region-body call" aria-label="Videollamada">
    <div class="call-grid" :class="{ compact }" :style="{ '--tile': `${layout.w}px`, '--cols': layout.cols }">
      <!-- la placa lleva sólo el nombre; de quién es un agente se ve al pasar el mouse -->
      <figure v-for="c in cast" :key="keyOf(c)" class="call-tile"
              :class="{ speaking: speaking === keyOf(c), addressed: speaking !== keyOf(c) && addressed.has(keyOf(c)), aside: aside(c) }"
              :title="label(c) ? `${c.name} · ${label(c)}` : c.name" @click="greet(c)">
        <office-personaje :config="JSON.stringify({ name: c.name, owner: c.agent ? c.owner : '', ...c.character })"
                          :gesto="gestureOf(c)" :boca="mouth(c)" />
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
        <span v-if="speaking !== keyOf(c) && addressed.has(keyOf(c)) && !propOf(c)" class="call-wave" aria-hidden="true">👋</span>
        <span v-if="muted?.key === keyOf(c)" class="call-muted" title="Mandó algo muy largo: no se leyó en voz alta">🔇</span>
        <figcaption class="call-name"><b>{{ c.name }}</b></figcaption>
      </figure>
    </div>
    <div v-if="voice.supported" class="call-controls">
      <button type="button" class="demo" :aria-pressed="voice.busy" :title="voice.busy ? 'Parar' : 'Una conversación inventada, para oír las voces y ver las bocas'" @click="playDemo">
        <svg v-if="!voice.busy" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10v12H7z" /></svg>
        {{ voice.busy ? 'Parar' : 'Reproducir demo' }}
      </button>
    </div>
    <div class="call-timeline" role="group" aria-label="Línea de tiempo de la conversación">
      <button type="button" class="tl-btn" title="Desde el primer mensaje" aria-label="Escuchar desde el primer mensaje"
              :disabled="!timeline.length" @click="replayFrom(Math.max(0, timeline.length - TIMELINE_MAX))">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M19 5L9 12l10 7z" /></svg>
      </button>
      <button type="button" class="tl-btn" :title="mode === 'paused' ? 'Seguir' : 'Pausar'" :aria-label="mode === 'paused' ? 'Seguir' : 'Pausar'"
              :disabled="!timeline.length" @click="togglePause">
        <svg v-if="mode === 'paused'" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
      </button>
      <div class="tl-track">
        <button v-for="d in dots" :key="d.i" type="button" class="tl-dot" :class="d.state" :style="{ '--dot': d.color }"
                :title="d.title" :aria-label="`Escuchar desde aquí: ${d.title}`" @click="replayFrom(d.i)"></button>
      </div>
      <span v-if="mode === 'live'" class="tl-live" title="Suena lo que va llegando">● En vivo</span>
      <button v-else type="button" class="tl-golive" @click="goLive">Volver al directo</button>
    </div>
    <p v-if="mutedNote && !caption" class="call-caption muted">🔇 {{ mutedNote }}</p>
    <p v-else-if="voice.error && !caption" class="call-caption">{{ voice.error }}</p>
    <p v-if="caption" class="call-caption" aria-live="polite"><b>{{ caption.name }}</b> {{ caption.line }}</p>
  </div>
</template>

<style scoped>
/* el fondo es el del tema (el mismo del editor): sigue el claro, el oscuro y la paleta que se elija en Cockpit */
.call { position: relative; overflow: hidden; background: var(--region-bg, var(--background)); display: grid; place-items: center; padding: 12px; }
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
/* quien habla se marca como en una videollamada: el borde del recuadro */
.call-tile.speaking { box-shadow: 0 0 0 3px #f08c3d, 0 6px 18px rgba(0, 0, 0, .35); }
.call-muted { position: absolute; top: 8px; right: 10px; font-size: calc(var(--tile) * .1); line-height: 1;
  padding: 4px 6px; border-radius: 10px; background: rgba(19, 50, 58, .8); animation: wave-in .25s ease-out; }
.call-tile.aside { filter: saturate(.7) brightness(.92); transition: filter .3s; }
.call-tile.addressed { box-shadow: 0 0 0 3px #2b9c8f, 0 6px 18px rgba(0, 0, 0, .35); }
/* el nombrado saluda: la mano aparece con un saltito y se mece */
.call-wave { position: absolute; top: 8px; right: 10px; font-size: calc(var(--tile) * .11); line-height: 1;
  animation: wave-in .25s ease-out, wave 1s ease-in-out .25s infinite alternate; transform-origin: 70% 80%; }
@keyframes wave-in { from { transform: scale(.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes wave { from { transform: rotate(-14deg); } to { transform: rotate(16deg); } }
@media (prefers-reduced-motion: reduce) { .call-wave { animation: none; } }
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
/* la línea de tiempo: abajo, como la de un directo */
.call-timeline { position: absolute; left: 12px; right: 12px; bottom: 8px; height: 38px; display: flex; align-items: center; gap: 8px;
  padding: 0 10px; border-radius: 12px; background: color-mix(in oklab, var(--background, #fff) 85%, transparent);
  border: 1px solid var(--border, rgba(0,0,0,.12)); }
.tl-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px;
  background: transparent; color: var(--foreground, #222); cursor: pointer; }
.tl-btn:hover { background: var(--hover, rgba(0,0,0,.06)); }
.tl-btn:disabled { opacity: .4; cursor: default; }
.tl-btn svg { width: 16px; height: 16px; fill: currentColor; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
.tl-track { flex: 1; min-width: 0; height: 100%; display: flex; align-items: center; justify-content: space-between; gap: 2px; position: relative;
  overflow: hidden; padding: 0 4px; }
.tl-track::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 2px; background: var(--border, rgba(0,0,0,.15)); }
/* los puntos se achican (redondos) si no caben a su tamaño: nunca pisan los botones */
.tl-dot { position: relative; width: 10px; min-width: 5px; aspect-ratio: 1; padding: 0; border-radius: 50%; border: 2px solid var(--dot);
  background: var(--background, #fff); cursor: pointer; flex: 0 1 10px; transition: transform .15s; }
.tl-dot.past { background: var(--dot); }
.tl-dot.now { background: var(--dot); transform: scale(1.6); box-shadow: 0 0 0 3px color-mix(in oklab, var(--dot) 30%, transparent); }
.tl-dot:hover { transform: scale(1.4); }
.tl-dot:focus-visible, .tl-btn:focus-visible, .tl-golive:focus-visible { outline: 2px solid #f08c3d; outline-offset: 2px; }
.tl-live { flex: 0 0 auto; font-size: 12px; font-weight: 800; color: #e5592a; white-space: nowrap; }
.tl-golive { flex: 0 0 auto; font: inherit; font-size: 12px; font-weight: 800; white-space: nowrap; padding: 4px 9px; border-radius: 8px; cursor: pointer;
  border: 1px solid var(--border, rgba(0,0,0,.15)); background: var(--background, #fff); color: var(--foreground, #222); }
.call-controls { position: absolute; top: 10px; right: 12px; display: flex; gap: 6px; }
.call-controls button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; font-weight: 700;
  padding: 4px 9px; border-radius: 8px; border: 1px solid var(--border, rgba(0,0,0,.15)); cursor: pointer;
  background: var(--background, #fff); color: var(--foreground, #222); }
.call-controls button:hover { background: var(--hover, rgba(0,0,0,.06)); }
.call-controls svg { width: 15px; height: 15px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.call-caption { position: absolute; left: 50%; bottom: 58px; transform: translateX(-50%); margin: 0; max-width: min(640px, calc(100% - 32px));
  padding: 6px 12px; border-radius: 10px; background: rgba(19, 50, 58, .88); color: #f6ecd6; font-size: 13px; line-height: 1.35; text-align: center; }
.call-caption b { color: #f2c14e; margin-right: 4px; }
.compact .call-name { left: 5px; bottom: 5px; padding: 1px 6px; font-size: 10.5px; border-radius: 6px; }
</style>
