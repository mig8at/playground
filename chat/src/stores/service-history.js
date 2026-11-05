/* EL HISTORIAL DEL POSTMAN DE LOS SERVICIOS: por servicio y en este navegador, las últimas 20. Lo comparten la ficha del
   servicio (que manda y recuerda) y el sidebar derecho (que lo lista): elegir una fila deja la petición en `picked`, y
   la ficha la carga. */
import { reactive, ref } from 'vue'

const MAX = 20
const key = (alias) => `chat.service-history.${alias}`
const lists = reactive({})

export function historyFor(alias) {
  if (!(alias in lists)) {
    try { lists[alias] = JSON.parse(localStorage.getItem(key(alias)) || '[]') } catch { lists[alias] = [] }
  }
  return lists[alias]
}

const same = (a, b) => a.method === b.method && a.path === b.path && a.body === b.body
export function remember(alias, entry) {
  lists[alias] = [entry, ...historyFor(alias).filter((h) => !same(h, entry))].slice(0, MAX)
  try { localStorage.setItem(key(alias), JSON.stringify(lists[alias])) } catch { /* sólo no se recuerda */ }
}

export function forget(alias) {
  lists[alias] = []
  try { localStorage.removeItem(key(alias)) } catch { /* nada */ }
}

// La fila elegida en el sidebar: `{ alias, entry, n }` (n cambia en cada clic, así elegir la misma dos veces recarga).
export const picked = ref(null)
let n = 0
export function pick(alias, entry) { picked.value = { alias, entry, n: ++n } }
