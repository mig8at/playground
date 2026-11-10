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
