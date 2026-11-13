/* ESCUCHAR UN MENSAJE (el ▶ de cada mensaje): lo lee ElevenLabs con la voz que elijas, por el servidor del chat
   (POST /api/voice, el mismo de la videollamada, con su caché y su tope diario). Hasta el 2026-11-12 lo leía la
   síntesis del navegador con las voces de macOS; se pasó a ElevenLabs para que suene igual que la llamada. La voz, la
   velocidad y el tope de palabras se eligen en el perfil (Voz) y se recuerdan en este navegador.

   EL TOPE DE PALABRAS (por defecto 150): un mensaje más largo no se manda a la voz —ni acá ni en la videollamada—,
   para no gastar créditos en un mamotreto. Se avisa y queda para leer.

   Antes de leer, el texto se limpia para el oído: sin las marcas del Markdown, los enlaces como «un enlace de
   <dominio>», un bloque de código como «(bloque de código)». Y se lee por frases, en fila. */
import { reactive } from 'vue'
import { readPref, savePref } from './workbench.js'

export const DEFAULT_MAX_WORDS = 150
export const MAX_WORDS_OPTIONS = [80, 150, 250, 400]

export const speech = reactive({
  supported: typeof window !== 'undefined' && typeof Audio !== 'undefined',
  voices: [],                                       // las voces de la cuenta de ElevenLabs: { name, gender, accent }
  voice: readPref('chat.voice-eleven', ''),         // su nombre; vacío = defaultVoice()
  rate: readPref('chat.voice-rate', 1),
  maxWords: readPref('chat.voice-max-words', DEFAULT_MAX_WORDS),
  speakingId: '',                                   // qué mensaje se está leyendo ahora
  error: '',                                        // lo último que no se pudo leer (y por qué)
})

if (speech.supported) {
  fetch('/api/voice/voices').then((r) => r.json()).then((d) => { speech.voices = d.voices || [] }).catch(() => {})
}

// La que se usa si no elegiste: Lina (colombiana), si está; si no, la primera.
export function defaultVoice() {
  return (speech.voices.find((v) => v.name === 'Lina') || speech.voices[0])?.name || 'Lina'
}

export function setVoice(name) { speech.voice = name; savePref('chat.voice-eleven', name || undefined) }
export function setRate(rate) { speech.rate = rate; savePref('chat.voice-rate', rate) }
export function setMaxWords(n) { speech.maxWords = n; savePref('chat.voice-max-words', n) }

/** ¿Es demasiado largo para mandarlo a la voz? (el tope de palabras del perfil) */
export const tooLong = (text) => String(text || '').split(/\s+/).filter(Boolean).length > (speech.maxWords || DEFAULT_MAX_WORDS)

// El texto como se escucha.
export function forSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
    .replace(/https?:\/\/([^/\s)]+)[^\s)]*/g, (_, host) => ` un enlace de ${host.replace(/^www\./, '')} `)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g, (_, a, b, c) => a || b || c)
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Frases de hasta ~300 caracteres (el servidor acepta 600 por pedido).
function chunks(text) {
  const out = []
  for (const sentence of text.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || [text]) {
    let s = sentence.trim()
    while (s.length > 300) {
      const cut = s.lastIndexOf(' ', 300) > 80 ? s.lastIndexOf(' ', 300) : 300
      out.push(s.slice(0, cut)); s = s.slice(cut).trim()
    }
    if (s) out.push(s)
  }
  return out
}

let current = null   // el <audio> que suena
let run = 0          // cada lectura nueva invalida la anterior

export function stop() {
  run++
  if (current) { current.pause(); current = null }
  speech.speakingId = ''
}

async function audioFor(text) {
  const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: speech.voice || defaultVoice(), text }) })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

/* Leer el mensaje `id`. Si ya se está leyendo, lo para (el mismo botón hace las dos cosas). */
export async function toggleSpeak(id, text) {
  if (!speech.supported) return
  if (speech.speakingId === id) { stop(); return }
  stop()
  speech.error = ''
  if (tooLong(text)) { speech.error = `Es muy largo para leerlo en voz alta (más de ${speech.maxWords} palabras).`; return }
  const parts = chunks(forSpeech(text))
  if (!parts.length) return
  const mine = ++run
  speech.speakingId = id
  // la frase siguiente se pide mientras suena la actual
  let next = audioFor(parts[0])
  for (let i = 0; i < parts.length; i++) {
    let url
    try { url = await next } catch (e) { if (mine === run) { speech.error = String(e.message || e); speech.speakingId = '' } return }
    if (i + 1 < parts.length) next = audioFor(parts[i + 1])
    if (mine !== run) { URL.revokeObjectURL(url); return }
    const audio = new Audio(url)
    audio.playbackRate = speech.rate // la velocidad sin cambiar el tono (preservesPitch queda como viene: activado)
    current = audio
    await new Promise((done) => { audio.onended = done; audio.onerror = done; audio.play().catch(done) })
    URL.revokeObjectURL(url)
    if (mine !== run) return
  }
  if (mine === run) { speech.speakingId = ''; current = null }
}
