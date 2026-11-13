/* LOS EFECTOS DE SONIDO DE LA VIDEOLLAMADA: los genera el servidor una sola vez (chat/server/sfx.go, catálogo fijo) y
   acá se suenan bajito, por nombre: join, leave, lid-close, lid-open, sip, mention, paper, photo, keys, y dos fondos en
   bucle, headphones (mientras alguien tiene los audífonos puestos) y ambient (el murmullo de la oficina).
   Dos perillas, recordadas en este navegador: los efectos (prendidos por defecto) y el ambiente (apagado). */
import { reactive } from 'vue'
import { readPref, savePref } from './workbench.js'

export const sfx = reactive({
  on: readPref('chat.call-sfx', true),
  ambient: readPref('chat.call-ambient', false),
})

const VOLUME = { join: 0.35, leave: 0.3, 'lid-close': 0.4, 'lid-open': 0.4, sip: 0.45, mention: 0.3, paper: 0.4, photo: 0.35, keys: 0.35,
  headphones: 0.12, ambient: 0.1 }
const lastPlayed = {}

/** Suena un efecto una vez (si los efectos están prendidos). El mismo, no dos veces en menos de medio segundo. */
export function play(name) {
  if (!sfx.on || typeof Audio === 'undefined') return
  const now = Date.now()
  if (now - (lastPlayed[name] || 0) < 500) return
  lastPlayed[name] = now
  const a = new Audio(`/api/sfx/${name}`)
  a.volume = VOLUME[name] ?? 0.3
  a.play().catch(() => {})
}

// los fondos en bucle: uno por nombre, que se prende o se apaga
const loops = {}
export function loop(name, on) {
  const want = on && sfx.on && typeof Audio !== 'undefined'
  if (want && !loops[name]) {
    const a = new Audio(`/api/sfx/${name}`)
    a.loop = true
    a.volume = VOLUME[name] ?? 0.1
    a.play().catch(() => {})
    loops[name] = a
  } else if (!want && loops[name]) {
    loops[name].pause()
    delete loops[name]
  }
}
export function stopLoops() { for (const k of Object.keys(loops)) loop(k, false) }

export function setSfx(on) { sfx.on = on; savePref('chat.call-sfx', on); if (!on) stopLoops() }
export function setAmbient(on) { sfx.ambient = on; savePref('chat.call-ambient', on) }
