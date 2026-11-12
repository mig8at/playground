/* LAS VOCES DE LA VIDEOLLAMADA: cada personaje dice sus mensajes con una voz de macOS, con su tono y su velocidad.
   Nada sale de la máquina: el servidor del chat (en tu Mac) la genera con `say` (POST /api/voice) y acá se reproduce.
   No se usa la síntesis del navegador porque dentro de Cockpit (WebKit) sólo trae Mónica y Paulina.

   LA BOCA SIGUE LA VOZ: el audio pasa por un analizador (WebAudio) y, cuadro a cuadro, `voice.open` dice si en ese
   momento suena algo; la videollamada abre la boca del personaje en las sílabas y la cierra en las pausas.

   EL TONO: `say` no cambia el tono de estas voces, así que se reproduce más rápido (agudo: el búho) o más lento (grave:
   el oso) sin conservar el tono, y la velocidad se compensa al generar para que el ritmo quede como pide el JSON.

   Los mensajes se dicen de a uno, en fila. Mientras suena una frase, `voice.speaker` dice quién habla y `voice.line`
   qué está diciendo (el subtítulo). */
import { reactive } from 'vue'
import { forSpeech } from './speech.js'

export const voice = reactive({
  supported: typeof window !== 'undefined' && typeof Audio !== 'undefined',
  speaker: '',   // la clave del personaje que habla
  line: '',      // la frase que está diciendo
  open: false,   // si en este instante suena (la boca abierta)
  error: '',
})

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

// Cuadro a cuadro: ¿suena? Con un poco de inercia, para que la boca no tiemble.
let held = 0
function track() {
  cancelAnimationFrame(raf)
  const tick = () => {
    if (!current) { voice.open = false; return }
    if (analyser) {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += (s - 128) * (s - 128)
      const level = Math.sqrt(sum / samples.length) / 128
      if (level > 0.06) held = 4
      voice.open = held-- > 0
    } else {
      voice.open = !current.paused // sin analizador, la boca habla todo el rato
    }
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
}

async function next() {
  const item = queue.shift()
  if (!item) { busy = false; current = null; voice.speaker = ''; voice.line = ''; voice.open = false; return }
  busy = true
  const pitch = item.voice?.pitch ?? 1
  try {
    const res = await fetch('/api/voice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice: await voiceName(item.voice), text: item.text, rate: (item.voice?.rate ?? 1) / pitch }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
    const url = URL.createObjectURL(await res.blob())
    if (item.gen !== generation) { URL.revokeObjectURL(url); return } // se calló mientras se generaba
    const audio = new Audio(url)
    audio.preservesPitch = false
    audio.webkitPreservesPitch = false
    audio.playbackRate = pitch
    current = audio
    listen(audio)
    voice.speaker = item.speaker; voice.line = item.text; voice.error = ''
    const done = () => {
      URL.revokeObjectURL(url)
      if (current !== audio) return
      current = null; voice.line = ''; voice.open = false
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
  kept.forEach((t, i) => queue.push({ speaker, text: t, voice: v, last: i === kept.length - 1, gen: generation }))
  if (!busy) next()
}

/** Calla a todos y vacía la fila. */
export function hush() {
  generation++
  queue.length = 0
  if (current) { current.pause(); current.onended = null; current = null }
  cancelAnimationFrame(raf)
  busy = false; voice.speaker = ''; voice.line = ''; voice.open = false
}
