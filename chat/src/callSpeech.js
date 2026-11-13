/* QUÉ SE DICE DE UN MENSAJE EN LA VIDEOLLAMADA: sólo lo conversado. Un mensaje de chat puede traer un informe entero
   (títulos, listas, tablas, código) o adjuntos; en la llamada eso no se lee: se dicen las primeras frases de lo que
   es conversación, se anuncia el adjunto en una frase («les dejé un documento») y el personaje hace la animación de
   lo que trae (una hoja, una foto, o leer). El texto completo queda en el chat. Así suena humano y se paga poco.

   La guía de cómo escribir para que esto casi no haga falta está en chat/CLAUDE.md §«Cómo habla un agente». */
import { isImage } from './stores/chat.js'

const MAX_SENTENCES = 2

// Lo que es formato de documento, línea por línea: títulos, listas, tablas y citas.
const FORMATTED_LINE = /^\s*(#{1,6}\s|[-*•]\s|\d+[.)]\s|\||>\s)/

/**
 * Lo que la llamada hace con un mensaje: { text, prop }. text es lo que se dice (vacío: nada); prop, la animación del
 * personaje: 'image' (muestra una foto), 'doc' (muestra una hoja) o 'read' (lee: quedó algo largo en el chat), o ''.
 */
export function forCall(message) {
  const raw = String(message?.text || '')
  let dropped = false
  // los bloques de código, enteros
  let text = raw.replace(/```[\s\S]*?```/g, () => { dropped = true; return '\n' })
  // las líneas con formato de documento
  text = text.split('\n').filter((line) => {
    if (FORMATTED_LINE.test(line)) { dropped = true; return false }
    return true
  }).join(' ')
  const sentences = (text.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || []).map((s) => s.trim()).filter((s) => /\p{L}/u.test(s))
  if (sentences.length > MAX_SENTENCES) dropped = true
  const said = sentences.slice(0, MAX_SENTENCES)

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
