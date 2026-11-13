/* LAS VOCES DE LA VIDEOLLAMADA: cada personaje dice sus frases con su voz de ElevenLabs (`voice` de su JSON: nombre
   y, si lo trae, un toque de tono). Las genera el servidor del chat (POST /api/voice, por el conector) y acá se
   reproducen. Las voces de macOS y Gemini se quitaron el 2026-11-12: si ElevenLabs falla, la frase no suena y se avisa.

   LA BOCA SIGUE LA VOZ: el audio pasa por un analizador (WebAudio) y, cuadro a cuadro, `voice.level` dice cuánto suena
   (0 a 1); la videollamada se lo pasa al personaje (atributo `boca`), que abre la boca en esa medida: grande en las
   vocales fuertes, cerrada en las pausas. No se alterna el gesto: eso reiniciaba la animación y la boca no llegaba a
   abrirse.

   EN FILA: los mensajes se dicen de a uno, en el orden en que llegan; si llegan dos juntos, el segundo espera a que
   termine el primero. Mientras suena una frase, `voice.speaker` dice quién habla y `voice.line` qué está diciendo (el
   subtítulo). */
import { reactive } from 'vue'
import { forSpeech } from './speech.js'

export const voice = reactive({
  supported: typeof window !== 'undefined' && typeof Audio !== 'undefined',
  speaker: '',   // la clave del personaje que habla
  line: '',      // la frase que está diciendo
  addressed: [], // a quiénes les habla el mensaje que suena (las claves de los que nombró con @)
  busy: false,   // si hay algo sonando o en fila
  level: 0,      // cuánto abre la boca en este instante (0 a 1), del volumen de lo que suena
  error: '',
  ready: false,  // si el servidor tiene la llave de ElevenLabs
})
fetch('/api/voice').then((r) => r.json()).then((d) => { voice.ready = !!d.elevenlabs }).catch(() => {})

const queue = []
let busy = false
let current = null      // el <audio> que suena
let ctx = null, analyser = null, samples = null, raf = 0

// Frases cortas: así el subtítulo cambia con lo que se oye.
function sentences(text) {
  return (forSpeech(text).match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || []).map((s) => s.trim()).filter(Boolean)
}

// El analizador se arma una vez, al primer audio (después de un clic: el navegador no deja antes).
function listen(audio) {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      samples = new Uint8Array(analyser.fftSize)
      analyser.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') ctx.resume()
    ctx.createMediaElementSource(audio).connect(analyser)
  } catch { analyser = null }
}

// Cuadro a cuadro: cuánto suena. Sube rápido y baja un poco más lento, para que la boca no tiemble.
function track() {
  cancelAnimationFrame(raf)
  const tick = () => {
    if (!current) { voice.level = 0; return }
    let target = 0.6 // sin analizador, media boca todo el rato
    if (analyser) {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += (s - 128) * (s - 128)
      const rms = Math.sqrt(sum / samples.length) / 128
      target = Math.min(1, Math.max(0, (rms - 0.02) * 5))
    }
    voice.level = +(target > voice.level ? voice.level * 0.3 + target * 0.7 : voice.level * 0.65 + target * 0.35).toFixed(2)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

// El audio de una frase, como URL lista para reproducir, y con qué tono se reproduce (más rápido y agudo, o más lento
// y grave, sin conservar el tono: el toque de caricatura de los animales).
async function render(item) {
  const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: item.voice?.name, text: item.text }) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return { url: URL.createObjectURL(await res.blob()), pitch: item.voice?.pitch ?? 1 }
}

// Se generan de a dos frases por adelantado, no todas: mientras suena una, la siguiente ya está lista, y si se calla la
// llamada no quedan frases pagadas sin oír.
const AHEAD = 2
function start(item) {
  if (!item.audio) { item.audio = render(item); item.audio.catch(() => {}) }
  return item.audio
}
function prefetch() { queue.slice(0, AHEAD).forEach(start) }

async function next() {
  const item = queue.shift()
  if (!item) { busy = false; voice.busy = false; current = null; voice.speaker = ''; voice.line = ''; voice.level = 0; voice.addressed = []; return }
  busy = true
  try {
    // ya se venía generando desde que llegó el mensaje: acá sólo se espera lo que falte
    const pending = start(item)
    prefetch()
    const { url, pitch } = await pending
    if (item.gen !== generation) { URL.revokeObjectURL(url); return } // se calló mientras se generaba
    const audio = new Audio(url)
    audio.preservesPitch = false
    audio.webkitPreservesPitch = false
    audio.playbackRate = pitch
    current = audio
    listen(audio)
    voice.speaker = item.speaker; voice.line = item.text; voice.addressed = item.addressed
    const done = () => {
      URL.revokeObjectURL(url)
      if (current !== audio) return
      current = null; voice.line = ''; voice.level = 0
      // un respiro entre frases, y uno más largo al cambiar de turno
      setTimeout(next, item.last ? 380 : 120)
    }
    audio.onended = done
    audio.onerror = done
    await audio.play()
    track()
  } catch (e) {
    if (item.gen !== generation) return
    voice.error = String(e.message || e)
    setTimeout(next, 50)
  }
}

let generation = 0
/** Que `speaker` diga `text` con su voz. Se suma a la fila. addressed: a quiénes les habla (reaccionan mientras suena). */
export function say(speaker, text, v, addressed = []) {
  if (!voice.supported || !voice.ready || !v?.name) return
  const parts = sentences(text)
  // un mensaje largo se recorta: la videollamada lo dice, no lo lee entero
  const kept = parts.slice(0, 4)
  if (parts.length > kept.length) kept.push('Y sigue en el chat.')
  kept.forEach((t, i) => {
    queue.push({ speaker, text: t, voice: v, addressed, last: i === kept.length - 1, gen: generation })
  })
  prefetch()
  voice.busy = true
  if (!busy) next()
}

/** Calla a todos y vacía la fila. */
export function hush() {
  generation++
  queue.length = 0
  if (current) { current.pause(); current.onended = null; current = null }
  cancelAnimationFrame(raf)
  busy = false; voice.busy = false; voice.speaker = ''; voice.line = ''; voice.level = 0; voice.addressed = []
}
