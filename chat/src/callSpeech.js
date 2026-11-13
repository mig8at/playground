/* QUÉ SE DICE DE UN MENSAJE EN LA VIDEOLLAMADA: lo conversado, hasta unos 40 segundos. Una explicación puede ser
   larga y se escucha entera mientras quepa (lo que cambió, qué se sugirió); lo que no es para el oído no se lee:
   títulos, tablas y código. Las listas sí: cada punto se dice como una frase. Si pasa de ~40 s, se dice hasta ahí, se
   cierra con «el resto se los dejo en el chat» y el personaje se queda leyendo.

   POR QUÉ 40 s: la regla del semáforo para hablar (los primeros 20 s en verde, de 20 a 40 en amarillo —el interés
   empieza a caer— y desde 40 en rojo). La guía pide ~55 palabras (~20 s) por mensaje; la llamada corta en el rojo.

   UN ADJUNTO lo muestra el personaje (una hoja, una foto) y, si el mensaje no trae texto que lo presente, se anuncia en
   una frase («les dejé un documento»). LOS MENSAJES DEL LLAVERO no se leen (son nombres de claves o valores
   encriptados): se anuncian. El texto completo queda siempre en el chat.

   La guía de cómo escribir para que esto casi no haga falta está en chat/CLAUDE.md §«Cómo habla un agente». */
import { isImage } from './stores/chat.js'

// ~40 s de voz: ElevenLabs (eleven_flash_v2_5) dice ~16,5 caracteres por segundo (medido el 2026-11-12: 369 en 22,4 s)
const MAX_CHARS = 650
// Un mensaje de más de esto (en palabras, contando todo: código, tablas, un log pegado) no se dice: se silencia y la
// llamada lo avisa. Es el tope de la guía (~110 palabras, 40 s) con margen; protege la plata de ElevenLabs.
export const MUTE_WORDS = 150

// Lo que no es para el oído, línea por línea: títulos y tablas. Las listas se dicen (sin la viñeta).
const DROPPED_LINE = /^\s*(#{1,6}\s|\|)/
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/

/**
 * Lo que la llamada hace con un mensaje: { text, prop, muted? }. muted: era demasiado largo y no se dice. text es lo que se dice (vacío: nada); prop, la animación del
 * personaje: 'image' (una foto), 'doc' (una hoja), 'key' (el llavero) o 'read' (lee: quedó algo largo en el chat), o ''.
 */
export function forCall(message) {
  const raw = String(message?.text || '')
  // el llavero no se lee: son nombres de claves o valores encriptados (U2FsdGVkX1…); se anuncia y se muestra una hoja
  const keyring = keyringLine(raw)
  if (keyring) return { text: keyring, prop: 'key' }
  // un mamotreto no se manda a la voz: se silencia (muted) y queda en el chat
  if (raw.split(/\s+/).filter(Boolean).length > MUTE_WORDS) return { text: '', prop: 'read', muted: true }
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
  // el adjunto se anuncia sólo si el mensaje no dice nada: si trae texto, ahí ya se presentó («te dejé las notas…»)
  if (files.length && !said.length) said.push(attachmentLine(images, docs))
  else if (dropped && !said.length) said.push('Les dejé algo para leer en el chat.')

  const prop = images ? 'image' : docs ? 'doc' : dropped ? 'read' : ''
  return { text: said.join(' '), prop }
}

function attachmentLine(images, docs) {
  if (images && docs) return 'Les dejé unos archivos.'
  if (images) return images === 1 ? 'Les dejé una imagen.' : `Les dejé ${images} imágenes.`
  return docs === 1 ? 'Les dejé un documento.' : `Les dejé ${docs} documentos.`
}

// Los mensajes del llavero (chat/server/keyring_auto.go): el pedido, la lista de nombres y el bloque encriptado.
function keyringLine(text) {
  const t = text.trimStart()
  if (/^🔑\s*Pido/.test(t)) return 'Les pedí unas claves del llavero.'
  if (/^🔑\s*Mi llavero/.test(t)) return 'Les mostré qué claves tengo en el llavero.'
  if (/^🔒/.test(t) || /=U2FsdGVkX1/.test(t)) return 'Les mandé unas claves del llavero, encriptadas.'
  return ''
}
