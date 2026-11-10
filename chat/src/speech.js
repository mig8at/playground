/* ESCUCHAR UN MENSAJE: lo lee en voz alta la síntesis de voz del navegador (speechSynthesis), con las voces que trae
   macOS (Paulina, Mónica, Eddy…). No sale nada de la máquina. La voz y la velocidad se eligen en el perfil y se
   recuerdan en este navegador.

   Antes de leer, el texto se limpia para el oído: sin las marcas del Markdown, los enlaces como «un enlace de
   <dominio>», un bloque de código como «(bloque de código)». Y se lee por frases: Chrome corta una sola lectura larga
   a los ~15 segundos. */
import { reactive } from 'vue'
import { readPref, savePref } from './workbench.js'

export const speech = reactive({
  supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  voices: [],                                 // las voces en español de esta máquina
  voice: readPref('chat.voice', ''),          // su nombre; vacío = defaultVoice()
  rate: readPref('chat.voice-rate', 1),
  speakingId: '',                             // qué mensaje se está leyendo ahora
})

function loadVoices() {
  if (!speech.supported) return
  const all = window.speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith('es'))
  // Primero las de Latinoamérica (más cerca de cómo hablamos), después las de España.
  speech.voices = all.sort((a, b) => Number(b.lang !== 'es-ES') - Number(a.lang !== 'es-ES') || a.name.localeCompare(b.name))
    .map((v) => ({ name: v.name, lang: v.lang }))
}
if (speech.supported) {
  loadVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}

// La que se usa si no elegiste: Paulina (es-MX) o Mónica (es-ES), las más naturales de macOS; si no, la primera.
export function defaultVoice() {
  return (speech.voices.find((v) => v.name === 'Paulina') || speech.voices.find((v) => v.name === 'Mónica') || speech.voices[0])?.name || ''
}

export function setVoice(name) { speech.voice = name; savePref('chat.voice', name || undefined) }
export function setRate(rate) { speech.rate = rate; savePref('chat.voice-rate', rate) }

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

// Frases de hasta ~200 caracteres: así ninguna lectura llega al corte de Chrome.
function chunks(text) {
  const out = []
  for (const sentence of text.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || [text]) {
    let s = sentence.trim()
    while (s.length > 200) {
      const cut = s.lastIndexOf(' ', 200) > 80 ? s.lastIndexOf(' ', 200) : 200
      out.push(s.slice(0, cut)); s = s.slice(cut).trim()
    }
    if (s) out.push(s)
  }
  return out
}

export function stop() {
  if (!speech.supported) return
  window.speechSynthesis.cancel()
  speech.speakingId = ''
}

/* Leer el mensaje `id`. Si ya se está leyendo, lo para (el mismo botón hace las dos cosas). */
export function toggleSpeak(id, text) {
  if (!speech.supported) return
  if (speech.speakingId === id) { stop(); return }
  window.speechSynthesis.cancel()
  const parts = chunks(forSpeech(text))
  if (!parts.length) return
  const all = window.speechSynthesis.getVoices()
  const voice = all.find((v) => v.name === speech.voice) || all.find((v) => v.name === defaultVoice()) || null
  speech.speakingId = id
  parts.forEach((part, i) => {
    const u = new SpeechSynthesisUtterance(part)
    u.lang = voice?.lang || 'es-MX'
    if (voice) u.voice = voice
    u.rate = speech.rate
    if (i === parts.length - 1) u.onend = () => { if (speech.speakingId === id) speech.speakingId = '' }
    u.onerror = () => { if (speech.speakingId === id) speech.speakingId = '' }
    window.speechSynthesis.speak(u)
  })
}
