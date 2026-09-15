/* Qué te cuesta, medido por lo que hacés y no por una lista.
 *
 * La diferencia con un simple marcador: acá se cuenta por REGLA, no sólo por ítem. Saber que
 * fallaste «tuvo» no sirve de mucho —es una palabra—; saber que fallás 3 de cada 4 de la tilde
 * diacrítica sí, porque esa regla decide cientos de palabras y se puede estudiar en una tarde.
 *
 * localStorage y nada más. No hay server, no hay cuenta, no sale de este navegador.
 */
import { reactive } from 'vue'

const LLAVE = 'escriba.memoria.v1'

const vacio = () => ({ items: {}, reglas: {}, sabidos: [] })

function leer() {
  try {
    const crudo = localStorage.getItem(LLAVE)
    if (!crudo) return vacio()
    const d = JSON.parse(crudo)
    return { items: d.items ?? {}, reglas: d.reglas ?? {}, sabidos: d.sabidos ?? [] }
  } catch {
    return vacio()   // modo privado, storage bloqueado, JSON corrupto — la app sigue igual
  }
}

function escribir(d) {
  try { localStorage.setItem(LLAVE, JSON.stringify(d)) } catch { /* sin persistencia, pero anda */ }
}

export const estado = reactive(leer())

const sumar = (m, k, bien) => {
  const p = m[k] ?? { bien: 0, mal: 0 }
  m[k] = { bien: p.bien + (bien ? 1 : 0), mal: p.mal + (bien ? 0 : 1) }
}

/* Cada respuesta se anota DOS veces: en el ítem y en su regla. Es la misma respuesta contada en dos
   escalas, y las dos preguntas son distintas — «¿me sé esta palabra?» y «¿entendí esta regla?». */
export function anotar(clave, regla, bien) {
  sumar(estado.items, clave, bien)
  sumar(estado.reglas, regla, bien)
  escribir(estado)
}

export const marcaDe = (m, k) => m[k] ?? { bien: 0, mal: 0 }
export const itemDe = (clave) => marcaDe(estado.items, clave)
export const reglaDe = (id) => marcaDe(estado.reglas, id)

export const sabido = (clave) => estado.sabidos.includes(clave)

/* «Ya la sé» lo saca del repaso sin borrar la cuenta: la cuenta es la evidencia de cuánto costó y
   sirve para volver a mirarlo si más adelante se vuelve a caer. */
export function alternarSabido(clave) {
  const i = estado.sabidos.indexOf(clave)
  if (i >= 0) estado.sabidos.splice(i, 1)
  else estado.sabidos.push(clave)
  escribir(estado)
}

export function olvidarTodo() {
  estado.items = {}
  estado.reglas = {}
  estado.sabidos = []
  escribir(estado)
}
