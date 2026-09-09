/* Pronunciación. El navegador ya trae un sintetizador — cero dependencias, cero red, y para
   aprender un idioma leer sin oír es media herramienta.
 *
 * Elige una voz en inglés de verdad (`en-*`): sin eso, macOS lee «key» con la voz del sistema en
 * español y suena «kei» a la colombiana, que es peor que no tener audio. */
let cache = null

function vozInglesa() {
  if (cache) return cache
  const voces = window.speechSynthesis?.getVoices?.() ?? []
  cache =
    voces.find((v) => /^en[-_]US/i.test(v.lang) && /Samantha|Alex|Google/i.test(v.name)) ??
    voces.find((v) => /^en[-_]US/i.test(v.lang)) ??
    voces.find((v) => /^en/i.test(v.lang)) ??
    null
  return cache
}

// Las voces cargan en diferido en varios navegadores: sin esto la primera pronunciación sale muda.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { cache = null; vozInglesa() }
}

export const hayVoz = () => typeof window !== 'undefined' && !!window.speechSynthesis

export function decir(texto) {
  if (!hayVoz()) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(String(texto).replace(/…|~/g, ' '))
  const v = vozInglesa()
  if (v) u.voice = v
  u.lang = v?.lang ?? 'en-US'
  u.rate = 0.85   // un poco lento: es para aprender, no para sonar natural
  window.speechSynthesis.speak(u)
}
