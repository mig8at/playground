/* LO QUE SE DICE DE UN MENSAJE, frase por frase, sin nada de la interfaz (sin Vue, sin el navegador): es la única
   receta de qué texto va a la voz. La usan la videollamada (callSpeech.js, callVoice.js, CallView.vue) y, para no
   tener dos, la sincronización del servidor la copia en Go (chat/server/voice_text.go): cada frase se paga una vez por
   voz y texto, así que el servidor tiene que armar EXACTAMENTE las mismas frases que después pide la llamada, o la
   llamada no las encuentra y las vuelve a pagar. `go test ./server -run TestVoiceTextParity` compara las dos con
   node sobre los mismos mensajes.

   El camino de un mensaje: forCall (lo conversado, hasta ~40 s; sin títulos, tablas ni código) → spokenNames (cada
   @mención por el nombre del personaje) → sentences (limpio para el oído y partido en frases, hasta 20). */

// ~40 s de voz: ElevenLabs (eleven_flash_v2_5) dice ~16,5 caracteres por segundo (medido el 2026-11-12: 369 en 22,4 s)
export const MAX_CHARS = 650
export const DEFAULT_MAX_WORDS = 150
export const MAX_SENTENCES = 20

export const isImage = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f?.name || '') && (!f?.type || f.type.startsWith('image/'))

/** ¿Es demasiado largo para mandarlo a la voz? (el tope de palabras del perfil) */
export const tooLong = (text, maxWords = DEFAULT_MAX_WORDS) => String(text || '').split(/\s+/).filter(Boolean).length > (maxWords || DEFAULT_MAX_WORDS)

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

// Lo que no es para el oído, línea por línea: títulos y tablas. Las listas se dicen (sin la viñeta).
const DROPPED_LINE = /^\s*(#{1,6}\s|\|)/
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/

/**
 * Lo que la llamada hace con un mensaje: { text, prop, muted? }. muted: era demasiado largo y no se dice. text es lo
 * que se dice (vacío: nada); prop, la animación del personaje: 'image' (una foto), 'doc' (una hoja), 'key' (el
 * llavero) o 'read' (lee: quedó algo largo en el chat), o ''.
 */
export function forCall(message, maxWords = DEFAULT_MAX_WORDS) {
  const raw = String(message?.text || '')
  // el llavero no se lee: son nombres de claves o valores encriptados (U2FsdGVkX1…); se anuncia y se muestra una hoja
  const keyring = keyringLine(raw)
  if (keyring) return { text: keyring, prop: 'key' }
  // un mamotreto no se manda a la voz: se silencia (muted) y queda en el chat
  if (tooLong(raw, maxWords)) return { text: '', prop: 'read', muted: true }
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
  const all = (text.match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || []).map((s) => s.trim()).filter((s) => /\p{L}/u.test(s))
  // hasta ~40 s: frases enteras mientras quepan
  const said = []
  let size = 0
  for (const s of all) {
    if (size + s.length > MAX_CHARS && said.length) { dropped = true; break }
    said.push(s)
    size += s.length + 1
  }
  const cut = said.length < all.length
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

/** El texto como se dice: cada mención por el nombre del personaje («@miguel/luigi» → «Luigi»). names: clave → nombre
    (las claves en minúscula, «miguel» o «miguel/luigi»); una que no está se dice por su usuario. */
export function spokenNames(text, names = {}) {
  return String(text || '').replace(/(^|[^\w@./-])@([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)/gi, (all, pre, handle) => {
    const h = handle.replace(/[._-]+$/, '').toLowerCase()
    const tail = handle.slice(h.length)
    if (h === 'todos') return `${pre}todos${tail}`
    const name = names[h] || h.split('/').pop().split('.')[0]
    return `${pre}${name.charAt(0).toUpperCase()}${name.slice(1)}${tail}`
  })
}

/** Frases cortas, limpias para el oído: así el subtítulo cambia con lo que se oye. Hasta MAX_SENTENCES. */
export function sentences(text) {
  return (forSpeech(text).match(/[^.!?¿¡]+[.!?]*|[¿¡][^?!]+[?!]/g) || []).map((s) => s.trim()).filter(Boolean).slice(0, MAX_SENTENCES)
}

/** Todo junto: las frases que la llamada dice de un mensaje ([] si no dice nada o está silenciado). */
export function callLines(message, names = {}, maxWords = DEFAULT_MAX_WORDS) {
  const { text, muted } = forCall(message, maxWords)
  return muted || !text ? [] : sentences(spokenNames(text, names))
}
