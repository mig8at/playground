<script setup>
/* LA VIDEOLLAMADA de una conversación: los que están en ella (personas y sus agentes) como personajes en papel
   cortado. Por ahora es sólo visual: todos escuchan, con su parpadeo y su balanceo; todavía no reaccionan a lo que se
   escribe en el chat. Los personajes salen de ./characters (un JSON por personaje).

   EL ACOMODO, COMO EN UNA VIDEOLLAMADA: cada recuadro guarda su proporción (4:3) y la grilla prueba todas las
   columnas posibles y se queda con la que deja los recuadros más grandes en el espacio que hay. Así, en una ventana
   ancha van en una fila, en una alta se apilan, y siempre quedan centrados, sin estirarse ni cortarse. La última fila,
   si está incompleta, también se centra.

   LAS VOCES (callVoice.js): con la voz prendida, cada mensaje nuevo de la conversación lo dice quien lo escribió, con
   la voz de su JSON, y su personaje mueve la boca mientras suena; abajo sale la frase. «Repetir» vuelve a decir los
   últimos mensajes y un clic en un recuadro hace que ese personaje salude. Todo es local: voces de macOS generadas por
   el servidor del chat en esta máquina, y la boca se abre cuando suena (el volumen real del audio). */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { hush, say, voice } from './callVoice.js'
import { readPref, savePref } from './workbench.js'

const props = defineProps({
  cast: { type: Array, required: true },
  messages: { type: Array, default: () => [] },   // los de la conversación abierta
  me: { type: String, default: '' },              // mi correo
  peer: { type: String, default: '' },            // el correo (o la clave) de la conversación
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
onBeforeUnmount(() => { observer?.disconnect(); hush() })

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
// el personaje que escribió un mensaje: la persona, o su agente si habló por él
function speakerOf(m) {
  const person = m.dir === 'out' ? userOf(props.me) : userOf(m.author?.email || props.peer)
  const agent = String(m.via || '').toLowerCase()
  return byKey.value[agent ? `${person}/${agent}` : person] || null
}
function speak(m) {
  const c = speakerOf(m)
  if (c && m.text) say(keyOf(c), m.text, c.voice)
}

const voiceOn = ref(readPref('chat.call-voice', true))
function toggleVoice() {
  voiceOn.value = !voiceOn.value
  savePref('chat.call-voice', voiceOn.value)
  if (!voiceOn.value) hush()
}
// lo que llega mientras la videollamada está abierta se dice (lo de antes, no: para eso está «Repetir»)
watch(() => props.messages.length, (n, old) => {
  if (!voiceOn.value || !(n > old)) return
  for (const m of props.messages.slice(old).slice(-3)) speak(m)
})
function replay() {
  hush()
  for (const m of props.messages.filter((x) => speakerOf(x) && x.text).slice(-4)) speak(m)
}
function greet(c) {
  hush()
  say(keyOf(c), c.agent ? `Hola, soy ${c.name}, el agente de ${c.ownerName || c.owner}.` : `Hola, soy ${c.name}.`, c.voice)
}
const speaking = computed(() => (voice.line ? voice.speaker : ''))
const caption = computed(() => (voice.line ? { name: byKey.value[voice.speaker]?.name || '', line: voice.line } : null))

const label = (c) => (c.agent ? `agente de ${c.ownerName || c.owner.split('.')[0]}` : '')
</script>

<template>
  <div ref="box" class="region-body call" aria-label="Videollamada">
    <div class="call-grid" :class="{ compact }" :style="{ '--tile': `${layout.w}px`, '--cols': layout.cols }">
      <!-- la placa lleva sólo el nombre; de quién es un agente se ve al pasar el mouse -->
      <figure v-for="c in cast" :key="keyOf(c)" class="call-tile" :class="{ speaking: speaking === keyOf(c) }"
              :title="label(c) ? `${c.name} · ${label(c)}` : c.name" @click="greet(c)">
        <office-personaje :config="JSON.stringify({ name: c.name, owner: c.agent ? c.owner : '', ...c.character })"
                          :gesto="speaking === keyOf(c) && voice.open ? 'habla' : 'escucha'" />
        <figcaption class="call-name"><b>{{ c.name }}</b></figcaption>
      </figure>
    </div>
    <div v-if="voice.supported" class="call-controls">
      <button type="button" :aria-pressed="voiceOn" :title="voiceOn ? 'Silenciar las voces' : 'Que hablen los mensajes'" @click="toggleVoice">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path v-if="voiceOn" d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" />
          <path v-else d="M16 9l5 6M21 9l-5 6" fill="none" /></svg>
        {{ voiceOn ? 'Voz' : 'Sin voz' }}
      </button>
      <button type="button" title="Decir otra vez los últimos mensajes" @click="replay">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" fill="none" /></svg>
        Repetir
      </button>
    </div>
    <p v-if="voice.error && !caption" class="call-caption">No pude generar la voz: {{ voice.error }}</p>
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
