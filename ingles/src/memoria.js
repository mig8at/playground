/* Cuántas veces miraste cada palabra.
 *
 * Es la pieza que hace que el hover no sea sólo una muleta. Con la traducción siempre a un píxel de
 * distancia el cerebro no hace el esfuerzo de recordar — pero si además queda el REGISTRO de cuántas
 * veces la miraste, el hover deja de ser ayuda y pasa a ser diagnóstico: al terminar la historia
 * sabés cuáles no sabés, sin haber hecho ningún examen.
 *
 * Cuenta cuando el globo APARECE (250 ms parado encima), no cuando el mouse pasa: si contara el
 * paso, cruzar el párrafo con el cursor sumaría treinta y el número no querría decir nada.
 *
 * localStorage y nada más. No hay server, no hay cuenta, no sale de este navegador.
 */
import { reactive } from 'vue'

const LLAVE = 'ingles.memoria.v1'

const vacio = () => ({ vistas: {}, sabidas: [], parrafos: [], dictado: {} })

function leer() {
  try {
    const crudo = localStorage.getItem(LLAVE)
    if (!crudo) return vacio()
    const d = JSON.parse(crudo)
    return { vistas: d.vistas ?? {}, sabidas: d.sabidas ?? [], parrafos: d.parrafos ?? [],
             dictado: d.dictado ?? {} }
  } catch {
    return vacio()   // modo privado, storage bloqueado, JSON corrupto — la app sigue igual
  }
}

function escribir(d) {
  try { localStorage.setItem(LLAVE, JSON.stringify(d)) } catch { /* sin persistencia, pero anda */ }
}

/* `reactive` y no un objeto pelado: el contador se pinta en el sidebar mientras leés, y sin
   reactividad habría que forzar el redibujo a mano desde cada sitio que cuenta. */
export const estado = reactive(leer())

export function ver(clave) {
  estado.vistas[clave] = (estado.vistas[clave] ?? 0) + 1
  escribir(estado)
}

export function veces(clave) {
  return estado.vistas[clave] ?? 0
}

export function sabida(clave) {
  return estado.sabidas.includes(clave)
}

/* «Ya la sé» saca la palabra del repaso sin borrar el contador — porque el contador es la evidencia
   de cuánto costó, y sirve para volver a mirarla si más adelante se cae de nuevo. */
export function alternarSabida(clave) {
  const i = estado.sabidas.indexOf(clave)
  if (i >= 0) estado.sabidas.splice(i, 1)
  else estado.sabidas.push(clave)
  escribir(estado)
}

/* Qué párrafos pediste traducidos. No lleva cuenta de cuántas veces —a diferencia de las palabras—
   porque acá la pregunta es otra: no «cuánto me cuesta ésta», sino «cuáles no entendí», y para eso
   alcanza con sí o no. Queda un punto en el margen al releer. Clave: «<historia>#<índice>». */
export function parrafoPedido(clave) {
  return estado.parrafos.includes(clave)
}

export function marcarParrafo(clave) {
  if (!estado.parrafos.includes(clave)) {
    estado.parrafos.push(clave)
    escribir(estado)
  }
}

/* El dictado lleva su propia cuenta y NO suma al contador de arriba, aunque las dos digan «ésta te
   cuesta». Miden cosas distintas: `vistas` dice cuántas veces no te acordaste del SIGNIFICADO, y
   esto dice cuántas veces no supiste ESCRIBIRLA oyéndola. Mezclarlas volvería el número de arriba
   —«la miraste 5 veces»— una frase falsa, que es justo lo que lo hace servir. */
export function anotarDictado(clave, bien) {
  const d = estado.dictado[clave] ?? { bien: 0, mal: 0 }
  estado.dictado[clave] = { bien: d.bien + (bien ? 1 : 0), mal: d.mal + (bien ? 0 : 1) }
  escribir(estado)
}

export function dictadoDe(clave) {
  return estado.dictado[clave] ?? { bien: 0, mal: 0 }
}

export function olvidarTodo() {
  estado.vistas = {}
  estado.sabidas = []
  estado.parrafos = []
  estado.dictado = {}
  escribir(estado)
}
