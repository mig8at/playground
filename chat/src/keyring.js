/* EL CIFRADO DEL LLAVERO, en el navegador y compatible con openssl, para que quien recibe la clave la descifre con lo
   que trae cualquier Mac:

     echo '<cifrado>' | openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -md sha256 -a -A -pass file:$HOME/.config/creditop/team-key

   Es el formato de `openssl enc`: «Salted__» + 8 bytes de sal + el texto en AES-256-CBC; la llave y el IV salen de
   PBKDF2-SHA256 sobre la llave del equipo (100 000 vueltas, 48 bytes), todo en base64. */

export const TEAM_KEY_FILE = '$HOME/.config/creditop/team-key'
const ITER = 100000

const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (s) => Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0))

async function derive(teamKey, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(teamKey), 'PBKDF2', false, ['deriveBits'])
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, 384))
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-CBC', false, ['encrypt', 'decrypt'])
  return { key, iv: bits.slice(32, 48) }
}

export async function seal(teamKey, value) {
  const salt = crypto.getRandomValues(new Uint8Array(8))
  const { key, iv } = await derive(teamKey, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, new TextEncoder().encode(value)))
  const out = new Uint8Array(16 + ct.length)
  out.set(new TextEncoder().encode('Salted__'))
  out.set(salt, 8)
  out.set(ct, 16)
  return b64(out)
}

export async function open(teamKey, sealed) {
  const raw = unb64(sealed)
  if (new TextDecoder().decode(raw.slice(0, 8)) !== 'Salted__') throw new Error('no es un cifrado del llavero')
  const { key, iv } = await derive(teamKey, raw.slice(8, 16))
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, raw.slice(16)))
}

// Una llave del equipo nueva: 32 bytes al azar, en base64 sin «=» (una línea, sin espacios).
export const newTeamKey = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/=+$/, '')

/* LA CLAVE COMO MENSAJE. Viaja como texto (la lee cualquiera: una persona, un agente, la terminal) y la interfaz la
   pinta como una tarjeta, como un archivo:

     🔒 Clave «shopify-admin-dev» · encriptada con la llave del equipo
     U2FsdGVkX1…

   Y el pedido: «🔑 Pido la clave «nombre»», que se pinta con «Enviarla» si la tenés guardada. Lo que se escriba después
   de una línea en blanco es texto normal. */
const KEY_RE = /^🔒 Clave «([^»\n]+)»[^\n]*\n(U2FsdGVkX1[A-Za-z0-9+/=]+)[ \t]*(?:\n\n([\s\S]*))?$/
const ASK_RE = /^🔑 Pido la clave «([^»\n]+)»[^\n]*(?:\n\n([\s\S]*))?$/

export const keyMessage = (name, sealed, extra = '') =>
  `🔒 Clave «${name}» · encriptada con la llave del equipo\n${sealed}${extra.trim() ? `\n\n${extra.trim()}` : ''}`
export const askMessage = (name, extra = '') => `🔑 Pido la clave «${name}»${extra.trim() ? `\n\n${extra.trim()}` : ''}`

// { kind: 'key', name, sealed, rest } · { kind: 'ask', name, rest } · null
export function parseKeyText(text) {
  const t = (text || '').trim()
  let m = t.match(KEY_RE)
  if (m) return { kind: 'key', name: m[1], sealed: m[2], rest: m[3] || '' }
  m = t.match(ASK_RE)
  if (m) return { kind: 'ask', name: m[1], rest: m[2] || '' }
  return null
}
