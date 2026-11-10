/* Lo del llavero que necesitan la conversación y el compositor: la llave del equipo y las claves guardadas. Se lee
   del servidor del chat una vez y otra vez cuando hace falta (al abrir el menú de claves). */
import { reactive } from 'vue'

export const keyring = reactive({ teamKey: '', saved: [], autoShare: true, loaded: false })

export async function loadKeyring() {
  try {
    const [k, s, c] = await Promise.all(['/api/keyring', '/api/keyring/keys', '/api/keyring/settings'].map((u) => fetch(u).then((r) => r.json())))
    keyring.teamKey = k.teamKey || ''
    keyring.saved = s.keys || []
    keyring.autoShare = c.autoShare !== false
  } catch { /* sin servidor: queda lo que había */ }
  keyring.loaded = true
}

// Compartir mi llavero solo: el servidor contesta los pedidos de las conversaciones directas.
export async function setAutoShare(on) {
  const r = await fetch('/api/keyring/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoShare: on }) })
  if (r.ok) keyring.autoShare = on
}
