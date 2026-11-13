/* QUÉ SE DICE DE UN MENSAJE EN LA VIDEOLLAMADA: lo conversado, hasta unos 40 segundos. Una explicación puede ser
   larga y se escucha entera mientras quepa (lo que cambió, qué se sugirió); lo que no es para el oído no se lee:
   títulos, tablas y código. Las listas sí: cada punto se dice como una frase. Si pasa de ~40 s, se dice hasta ahí, se
   cierra con «el resto se los dejo en el chat» y el personaje se queda leyendo.

   POR QUÉ 40 s: la regla del semáforo para hablar (los primeros 20 s en verde, de 20 a 40 en amarillo —el interés
   empieza a caer— y desde 40 en rojo). La guía pide ~20 s por mensaje; la llamada corta en el rojo. Un adjunto se anuncia en una frase
   («les dejé un documento») y el personaje lo muestra (una hoja, una foto). El texto completo queda en el chat.

   La guía de cómo escribir para que esto casi no haga falta está en chat/CLAUDE.md §«Cómo habla un agente». */
import { isImage } from './stores/chat.js'

// ~40 s de voz: ElevenLabs (eleven_flash_v2_5) dice ~16,5 caracteres por segundo (medido el 2026-11-12: 369 en 22,4 s)
const MAX_CHARS = 650

// Lo que no es para el oído, línea por línea: títulos y tablas. Las listas se dicen (sin la viñeta).
const DROPPED_LINE = /^\s*(#{1,6}\s|\|)/
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/

/**
 * Lo que la llamada hace con un mensaje: { text, prop }. text es lo que se dice (vacío: nada); prop, la animación del
 * personaje: 'image' (muestra una foto), 'doc' (muestra una hoja) o 'read' (lee: quedó algo largo en el chat), o ''.
 */
export function forCall(message) {
  const raw = String(message?.text || '')
  let dropped = false
  // los bloques de código, enteros
  let text = raw.replace(/```[\s\S]*?```/g, () => { dropped = true; return '\n' })
  // fuera títulos y tablas; cada punto de una lista, como una frase (con su punto final si no lo traía)
  text = text.split('\n').flatMap((line) => {
    if (DROPPED_LINE.test(line)) { dropped = true; return [] }
    if (LIST_ITEM.test(line)) {
      const item = line.replace(LIST_ITEM, '').trim()
      return item ? [/[.!?:]$/.test(item) ? item : `${item}.`] : []
    }
    return [line]
  }).join(' ')
  const sentences = (text.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || []).map((s) => s.trim()).filter((s) => /\p{L}/u.test(s))
  // hasta ~40 s: frases enteras mientras quepan
  const said = []
  let size = 0
  for (const s of sentences) {
    if (size + s.length > MAX_CHARS && said.length) { dropped = true; break }
    said.push(s)
    size += s.length + 1
  }
  const cut = said.length < sentences.length
  if (cut) said.push('El resto se los dejo en el chat.')

  const files = Array.isArray(message?.files) ? message.files : []
  const images = files.filter((f) => isImage(f)).length
  const docs = files.length - images
  if (files.length) said.push(attachmentLine(images, docs))
  else if (dropped && !said.length) said.push('Les dejé algo para leer en el chat.')

  const prop = images ? 'image' : docs ? 'doc' : dropped ? 'read' : ''
  return { text: said.join(' '), prop }
}

function attachmentLine(images, docs) {
  if (images && docs) return 'Les dejé unos archivos.'
  if (images) return images === 1 ? 'Les dejé una imagen.' : `Les dejé ${images} imágenes.`
  return docs === 1 ? 'Les dejé un documento.' : `Les dejé ${docs} documentos.`
}
