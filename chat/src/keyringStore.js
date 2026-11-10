/* Lo del llavero que necesitan la conversación y el compositor: la llave del equipo y las claves guardadas. Se lee
   del servidor del chat una vez y otra vez cuando hace falta (al abrir el menú de claves). */
import { reactive } from 'vue'

export const keyring = reactive({ teamKey: '', saved: [], loaded: false })

export async function loadKeyring() {
  try {
    const [k, s] = await Promise.all([fetch('/api/keyring').then((r) => r.json()), fetch('/api/keyring/keys').then((r) => r.json())])
    keyring.teamKey = k.teamKey || ''
    keyring.saved = s.keys || []
  } catch { /* sin servidor: queda lo que había */ }
  keyring.loaded = true
}
