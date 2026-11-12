/* LAS VOCES DE LA VIDEOLLAMADA: cada personaje dice sus mensajes con su voz. Hay dos motores, y se elige en la
   videollamada: GEMINI (gemini-3.8-flash-lite-tts: la voz de `voice.gemini` del JSON y, si lo trae, su tono; el texto va a Google)
   y LOCAL (las voces de macOS con `say`: nada sale de la máquina). Los dos los genera el servidor del chat
   (POST /api/voice) y acá se reproducen.
   No se usa la síntesis del navegador porque dentro de Cockpit (WebKit) sólo trae Mónica y Paulina.

   LA BOCA SIGUE LA VOZ: el audio pasa por un analizador (WebAudio) y, cuadro a cuadro, `voice.level` dice cuánto suena
   (0 a 1); la videollamada se lo pasa al personaje (atributo `boca`), que abre la boca en esa medida: grande en las
   vocales fuertes, cerrada en las pausas. No se alterna el gesto: eso reiniciaba la animación y la boca no llegaba a
   abrirse.

   EL TONO: `say` no cambia el tono de estas voces, así que se reproduce más rápido (agudo: el búho) o más lento (grave:
   el oso) sin conservar el tono, y la velocidad se compensa al generar para que el ritmo quede como pide el JSON.

   Los mensajes se dicen de a uno, en fila. Mientras suena una frase, `voice.speaker` dice quién habla y `voice.line`
   qué está diciendo (el subtítulo). */
import { reactive } from 'vue'
import { forSpeech } from './speech.js'
import { readPref, savePref } from './workbench.js'

export const voice = reactive({
  supported: typeof window !== 'undefined' && typeof Audio !== 'undefined',
  speaker: '',   // la clave del personaje que habla
  line: '',      // la frase que está diciendo
  busy: false,   // si hay algo sonando o en fila
  level: 0,      // cuánto abre la boca en este instante (0 a 1), del volumen de lo que suena
  error: '',
  engine: readPref('chat.call-engine', 'gemini'),   // 'gemini' o 'local'
  geminiReady: false,                               // si el servidor tiene la llave de Gemini
})
fetch('/api/voice').then((r) => r.json()).then((d) => { voice.geminiReady = !!d.gemini }).catch(() => {})

/** Gemini (en la nube de Google, ~0,6 s y ~US$0,0012 por mensaje) o las voces de macOS (gratis, nada sale). */
export function setEngine(engine) { voice.engine = engine; voice.error = ''; savePref('chat.call-engine', engine) }

const queue = []
let busy = false
let current = null      // el <audio> que suena
let ctx = null, analyser = null, samples = null, raf = 0

// Las voces que tiene `say` en esta máquina; el JSON dice «Eddy» + «es-MX» y `say` la llama «Eddy (Español (México))».
let systemVoices = null
async function voiceName(v) {
  if (!systemVoices) systemVoices = fetch('/api/voice').then((r) => r.json()).then((d) => d.voices || []).catch(() => [])
  const all = await systemVoices
  const region = { 'es-mx': 'México', 'es-es': 'España' }[String(v?.lang || 'es-MX').toLowerCase()]
  const name = v?.name || 'Paulina'
  return all.find((x) => x === `${name} (Español (${region}))`) || all.find((x) => x === name) || all.find((x) => x.startsWith(`${name} (`))
    || all.find((x) => x === 'Paulina') || all[0] || ''
}

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

// El audio de una frase, como URL lista para reproducir, y con qué tono se reproduce. Con Gemini el tono lo pone la
// voz y su estilo; con las locales, la velocidad de reproducción. Si Gemini falla, esa frase sale con la voz local.
async function render(item) {
  const post = (body) => fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async (res) => {
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      return URL.createObjectURL(await res.blob())
    })
  const g = item.voice?.gemini
  if (voice.engine === 'gemini' && voice.geminiReady && g) {
    try { return { url: await post({ engine: 'gemini', voice: g.voice, text: item.text }), pitch: g.pitch ?? 1 } }
    catch (e) { voice.error = `Gemini: ${e.message || e} (sigue con la voz local)` }
  }
  const pitch = item.voice?.pitch ?? 1
  return { url: await post({ voice: await voiceName(item.voice), text: item.text, rate: (item.voice?.rate ?? 1) / pitch }), pitch }
}

async function next() {
  const item = queue.shift()
  if (!item) { busy = false; voice.busy = false; current = null; voice.speaker = ''; voice.line = ''; voice.level = 0; return }
  busy = true
  try {
    // ya se venía generando desde que llegó el mensaje: acá sólo se espera lo que falte
    const { url, pitch } = await item.audio
    if (item.gen !== generation) { URL.revokeObjectURL(url); return } // se calló mientras se generaba
    const audio = new Audio(url)
    audio.preservesPitch = false
    audio.webkitPreservesPitch = false
    audio.playbackRate = pitch
    current = audio
    listen(audio)
    voice.speaker = item.speaker; voice.line = item.text
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
/** Que `speaker` diga `text` con su voz. Se suma a la fila. */
export function say(speaker, text, v) {
  if (!voice.supported) return
  const parts = sentences(text)
  // un mensaje largo se recorta: la videollamada lo dice, no lo lee entero
  const kept = parts.slice(0, 4)
  if (parts.length > kept.length) kept.push('Y sigue en el chat.')
  kept.forEach((t, i) => {
    const item = { speaker, text: t, voice: v, last: i === kept.length - 1, gen: generation }
    // cada frase se empieza a generar ya, en paralelo: mientras suena una, la siguiente está lista
    item.audio = render(item)
    item.audio.catch(() => {})
    queue.push(item)
  })
  voice.busy = true
  if (!busy) next()
}

/** Calla a todos y vacía la fila. */
export function hush() {
  generation++
  queue.length = 0
  if (current) { current.pause(); current.onended = null; current = null }
  cancelAnimationFrame(raf)
  busy = false; voice.busy = false; voice.speaker = ''; voice.line = ''; voice.level = 0
}
