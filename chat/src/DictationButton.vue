<script setup>
/* DICTAR: el micrófono de la barra de escribir, como en WhatsApp (ocupa el lugar de «mandar» con la caja vacía). Un
 * toque empieza a grabar, otro termina; el audio va al servidor del chat, que lo transcribe con Whisper EN ESTA
 * MÁQUINA (server/dictation.go), y el texto vuelve a la caja (`text`) para revisarlo antes de mandarlo. Esc cancela.
 *
 * El estado se cuenta afuera (`state`): grabando, con su tiempo, o transcribiendo, para que la caja lo diga. */
import { ref, onBeforeUnmount } from 'vue'

const emit = defineEmits(['text', 'state'])
const phase = ref('idle') // idle · recording · working
let recorder = null
let stream = null
let chunks = []
let started = 0
let ticker = 0
let cancelled = false

// webm/opus en Chrome; mp4 en Safari (y en el WebKit de Cockpit). El servidor lee cualquiera con ffmpeg.
const MIME = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || ''

function tell(extra = {}) { emit('state', { phase: phase.value, seconds: started ? Math.floor((Date.now() - started) / 1000) : 0, ...extra }) }

async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (e) {
    tell({ error: e?.name === 'NotAllowedError' ? 'El micrófono está bloqueado: permitilo para dictar' : 'No pude abrir el micrófono' })
    return
  }
  chunks = []
  cancelled = false
  recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined)
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  recorder.onstop = finish
  recorder.start()
  started = Date.now()
  phase.value = 'recording'
  tell()
  ticker = setInterval(() => tell(), 500)
  document.addEventListener('keydown', escape, true)
}

function stop(cancel = false) {
  cancelled = cancel
  clearInterval(ticker)
  document.removeEventListener('keydown', escape, true)
  if (recorder?.state === 'recording') recorder.stop()
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

async function finish() {
  const blob = new Blob(chunks, { type: recorder?.mimeType || MIME || 'audio/webm' })
  recorder = null
  started = 0
  if (cancelled || !blob.size) { phase.value = 'idle'; tell(); return }
  phase.value = 'working'
  tell()
  try {
    const res = await fetch('/api/dictate', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    phase.value = 'idle'
    tell()
    if (body.text) emit('text', body.text)
    else tell({ error: 'No se entendió nada: probá de nuevo, más cerca del micrófono' })
  } catch (e) {
    phase.value = 'idle'
    tell({ error: `No se pudo transcribir: ${e.message}` })
  }
}

function escape(e) { if (e.key === 'Escape') { e.stopPropagation(); stop(true) } }
function toggle() { if (phase.value === 'recording') stop(); else if (phase.value === 'idle') start() }

onBeforeUnmount(() => stop(true))
</script>

<template>
  <button type="button" class="btn btn-send dictation" :class="phase" :disabled="phase === 'working'"
          :aria-pressed="phase === 'recording'"
          :title="phase === 'recording' ? 'Terminar y transcribir (Esc cancela)' : phase === 'working' ? 'Transcribiendo…' : 'Dictar'"
          :aria-label="phase === 'recording' ? 'Terminar de dictar' : 'Dictar un mensaje'" @click="toggle">
    <span class="ui-icon" :data-icon="phase === 'recording' ? 'stop' : 'mic'" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
.dictation.recording { background: var(--send-fail); color: var(--background); border-color: transparent }
.dictation.working .ui-icon { animation: dictation-pulse 1s ease-in-out infinite }
@keyframes dictation-pulse { 50% { opacity: .35 } }
</style>
