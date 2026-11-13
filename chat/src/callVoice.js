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
import { forSpeech, voiceBlob } from './speech.js'

export const voice = reactive({
  supported: typeof window !== 'undefined' && typeof Audio !== 'undefined',
  speaker: '',   // la clave del personaje que habla
  line: '',      // la frase que está diciendo
  addressed: [], // a quiénes les habla el mensaje que suena (las claves de los que nombró con @)
  props: {},     // lo que tiene en la mano cada personaje (clave → { kind: 'doc'|'image'|'key'|'read', until }): los
                 // que RECIBEN lo que se mandó, mientras quien lo mandó habla y unos segundos después
  busy: false,   // si hay algo sonando o en fila
  level: 0,      // cuánto abre la boca en este instante (0 a 1), del volumen de lo que suena. ⚠ Cambia en cada cuadro:
                 // no se lee desde un template (re-renderizaría la llamada 60 veces por segundo); CallView la sigue
                 // con un efecto que escribe sólo el atributo `boca` de quien habla
  error: '',     // por qué no sonó la última frase; se limpia cuando la siguiente suena
  ready: false,  // si el servidor tiene la llave de ElevenLabs
  why: '',       // por qué la llamada está sin voz (sin llave, tope del día, servidor caído): el chip de la llamada
})

/** ¿Hay voz? Se pregunta al cargar y cada vez que se abre la videollamada: la llave o el tope del día pueden haber
    cambiado desde entonces, y sin esto la llamada quedaba muda sin decir por qué. */
export function refreshVoice() {
  if (!voice.supported) { voice.why = 'este navegador no reproduce audio'; return Promise.resolve() }
  return fetch('/api/voice').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((d) => {
    voice.ready = !!d.elevenlabs
    voice.why = !voice.ready ? 'falta la llave de ElevenLabs'
      : d.dailyLimit > 0 && d.usedToday >= d.dailyLimit ? 'se llegó al tope de voz de hoy' : ''
  }).catch(() => { voice.ready = false; voice.why = 'el servidor del chat no contesta' })
}
refreshVoice()

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
  // el MP3 sale de lo ya pedido en esta pestaña si la frase se repite (speech.js: voiceBlob); la URL es de esta vez
  return { url: URL.createObjectURL(await voiceBlob(item.voice?.name, item.text)), pitch: item.voice?.pitch ?? 1 }
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
    if (item.prop && item.first) voice.props = { ...voice.props, ...holding(item, Infinity) }
    const done = () => {
      URL.revokeObjectURL(url)
      if (current !== audio) return
      current = null; voice.line = ''; voice.level = 0
      // lo que mostraba se queda unos segundos más, como quien termina de mirarlo
      if (item.prop && item.last) voice.props = { ...voice.props, ...holding(item, Date.now() + PROP_LINGER) }
      // un respiro entre frases, y uno más largo al cambiar de turno
      setTimeout(next, item.last ? 380 : 120)
    }
    audio.onended = done
    audio.onerror = done
    await audio.play()
    voice.error = '' // ésta sí sonó: el aviso de la que falló antes ya no va
    track()
  } catch (e) {
    if (item.gen !== generation) return
    voice.error = String(e.message || e)
    setTimeout(next, 50)
  }
}

const PROP_LINGER = 4000
// lo que tienen en la mano los que reciben un mensaje, hasta `until`
const holding = (item, until) => Object.fromEntries(item.holders.map((k) => [k, { kind: item.prop, until }]))
let generation = 0
/** Que `speaker` diga `text` con su voz. Se suma a la fila. addressed: a quiénes les habla (reaccionan mientras suena);
    prop: lo que se mandó ('doc', 'image', 'key', 'read'); holders: quiénes lo reciben y lo tienen en la mano
    mientras. Lo que se dice ya viene recortado a ~40 s (callSpeech.js); acá sólo se pone un techo por si acaso.
    Devuelve false si no entró en la fila (demasiados esperando): quien llama lo avisa como silenciado. */
// Si llegan muchos juntos (un agente en un bucle), la fila no crece sin fin: lo que no entra se silencia.
const MAX_QUEUE = 24
export function say(speaker, text, v, addressed = [], prop = '', holders = []) {
  if (!voice.supported || !voice.ready || !v?.name) return true
  const kept = sentences(text).slice(0, 20)
  if (queue.length + kept.length > MAX_QUEUE) return false
  kept.forEach((t, i) => {
    queue.push({ speaker, text: t, voice: v, addressed, prop, holders, first: i === 0, last: i === kept.length - 1, gen: generation })
  })
  prefetch()
  voice.busy = true
  if (!busy) next()
  return true
}

/** Calla a todos y vacía la fila. */
export function hush() {
  generation++
  queue.length = 0
  if (current) { current.pause(); current.onended = null; current = null }
  cancelAnimationFrame(raf)
  busy = false; voice.busy = false; voice.speaker = ''; voice.line = ''; voice.level = 0; voice.addressed = []; voice.props = {}
}
