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
   reaccionan: su recuadro se marca, miran hacia arriba y aparece un 👋. Lo que escribís vos no suena, pero si nombrás
   a alguien, también reacciona un momento: así se ve a quién le hablás.

   SÓLO LO CONVERSADO (callSpeech.js): de un mensaje se dicen sus primeras frases; títulos, listas, tablas y código no
   se leen, y un adjunto se anuncia en una frase. Mientras lo dice, el personaje muestra lo que trae —una hoja (un
   documento), una foto (una imagen) o una hoja que corre (lo largo que quedó en el chat)— y después mira hacia abajo
   unos segundos, leyéndolo. */
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
const ASPECT = 4 / 3, GAP = 10, PAD = 12
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
onBeforeUnmount(() => { observer?.disconnect(); hush(); clearTimeout(nudgeTimer) })

// la mejor grilla: para cada número de columnas, el ancho de recuadro que entra en ancho y en alto; gana el más grande
const layout = computed(() => {
  const n = props.cast.length, W = size.value.w - PAD * 2, H = size.value.h - PAD * 2
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
// los que nombraste vos (tus mensajes no suenan): reaccionan unos segundos
const nudged = ref([])
let nudgeTimer = 0
function nudge(keys) {
  if (!keys.length) return
  nudged.value = keys
  clearTimeout(nudgeTimer)
  nudgeTimer = setTimeout(() => { nudged.value = [] }, 3500)
}
// lo que llega con la llamada abierta se dice, en fila (callVoice espera a que termine el anterior)
watch(() => props.messages.length, (n, old) => {
  if (!(n > old)) return
  for (const m of props.messages.slice(old)) {
    const c = speakerOf(m)
    if (c && (m.text || m.files?.length)) {
      const { text, prop } = forCall(m)
      if (text) say(keyOf(c), spoken(text), c.voice, addressedBy(m.text, keyOf(c)), prop)
    }
    else if (m.dir === 'out' && m.text) nudge(addressedBy(m.text, userOf(props.me)))
  }
})
// lo que muestra cada uno ahora (una hoja, una foto): callVoice dice hasta cuándo; un reloj de medio segundo lo apaga
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 500)
onBeforeUnmount(() => clearInterval(clock))
const propOf = (c) => { const p = voice.props[keyOf(c)]; return p && p.until > now.value ? p.kind : '' }
const gestureOf = (c) => (speaking.value === keyOf(c) ? 'habla' : propOf(c) ? 'teclea' : addressed.value.has(keyOf(c)) ? 'piensa' : 'escucha')

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
              :class="{ speaking: speaking === keyOf(c), addressed: speaking !== keyOf(c) && addressed.has(keyOf(c)) }"
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
        <span v-if="speaking !== keyOf(c) && addressed.has(keyOf(c))" class="call-wave" aria-hidden="true">👋</span>
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
    <p v-if="voice.error && !caption" class="call-caption">{{ voice.error }}</p>
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
@media (prefers-reduced-motion: reduce) { .call-prop, .call-prop.read .lines { animation: none; } }
.call-controls { position: absolute; top: 10px; right: 12px; display: flex; gap: 6px; }
.call-controls button { display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; font-weight: 700;
  padding: 4px 9px; border-radius: 8px; border: 1px solid var(--border, rgba(0,0,0,.15)); cursor: pointer;
  background: var(--background, #fff); color: var(--foreground, #222); }
.call-controls button:hover { background: var(--hover, rgba(0,0,0,.06)); }
.call-controls svg { width: 15px; height: 15px; fill: currentColor; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.call-caption { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); margin: 0; max-width: min(640px, calc(100% - 32px));
  padding: 6px 12px; border-radius: 10px; background: rgba(19, 50, 58, .88); color: #f6ecd6; font-size: 13px; line-height: 1.35; text-align: center; }
.call-caption b { color: #f2c14e; margin-right: 4px; }
.compact .call-name { left: 5px; bottom: 5px; padding: 1px 6px; font-size: 10.5px; border-radius: 6px; }
</style>
