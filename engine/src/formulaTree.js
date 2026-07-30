// La fórmula como ÁRBOL, para editarla por cajas en vez de por texto.
//
// El motor come texto, así que esto va y vuelve: `desdeTexto` para abrir una fórmula que ya existe,
// `aTexto` para guardarla. Nada de esto sabe de Vue — son funciones puras, y por eso se pueden
// probar sin navegador.
//
// ═══ LOS NODOS ═══
//   { k: 'hueco' }              un cuadrito sin llenar
//   { k: 'ref', name }          un campo o una base
//   { k: 'num', v }             un número literal
//   { k: 'bin', o, l, r }       una operación
//
// Un hueco se serializa como `▢`, que NO es un identificador válido: mientras quede uno, el motor
// dice "carácter inesperado ▢" y el campo se muestra sin calcular. Eso es correcto —la fórmula está
// incompleta— y la evaluación parcial ya apaga solo lo que depende de ella.

import { tokenize, parse } from './engine.js'

export const HUECO = '▢'
export const hueco = () => ({ k: 'hueco' })

/** Precedencia, la misma del parser del motor. */
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
/** Los que NO son asociativos: `a - (b - c)` ≠ `a - b - c`, así que el lado derecho necesita
 *  paréntesis cuando empata en precedencia. Con `+` y `*` sobrarían. */
const NO_ASOC = new Set(['-', '/', '^'])

/** El árbol a texto, con los paréntesis MÍNIMOS que hacen falta. */
export function aTexto(n, precPadre = 0) {
  if (!n || n.k === 'hueco') return HUECO
  if (n.k === 'ref') return n.name
  if (n.k === 'num') return String(n.v ?? '')
  const p = PREC[n.o] ?? 1
  const s = `${aTexto(n.l, p)} ${n.o} ${aTexto(n.r, p + (NO_ASOC.has(n.o) ? 1 : 0))}`
  return p < precPadre ? `(${s})` : s
}

/** Texto a árbol, usando el parser DEL MOTOR — así el tablero y el cálculo no pueden interpretar
 *  distinto la misma fórmula.
 *
 *  Devuelve `null` si la expresión tiene algo que el tablero no sabe dibujar (una función como
 *  `pmt`, una comparación, un texto). En ese caso el campo se sigue editando como texto: es mejor
 *  que dibujar mal algo que el motor entiende bien. */
export function desdeTexto(txt) {
  const s = String(txt || '').trim()
  if (!s) return hueco()
  if (s.includes(HUECO)) return null      // a medio armar: se abre como texto
  try {
    return convertir(parse(tokenize(s)))
  } catch { return null }
}

function convertir(n) {
  if (!n) throw new Error('vacío')
  if (n.k === 'num') return { k: 'num', v: n.v }
  if (n.k === 'ref') return { k: 'ref', name: n.name }
  if (n.k === 'bin' && PREC[n.o]) return { k: 'bin', o: n.o, l: convertir(n.l), r: convertir(n.r) }
  // un menos unario se dibuja como `0 - x`: el tablero no necesita un nodo aparte para eso
  if (n.k === 'neg') return { k: 'bin', o: '-', l: { k: 'num', v: 0 }, r: convertir(n.x) }
  throw new Error('el tablero no dibuja ' + n.k)   // call · not · comparaciones · bool · str
}

/** ¿Este nodo es una RAÍZ? No hay un tipo aparte: una raíz ES una potencia de exponente `1/n`, que
 *  es lo que el motor sabe evaluar. Se detecta al dibujar, así que va y vuelve por texto sin
 *  inventar nada — y cambiar el índice es cambiar un número.
 *
 *  Y tiene un uso real, no decorativo: `(1 + tasa) ^ (1/12) − 1` es la raíz doceava, o sea la
 *  conversión de una tasa anual a mensual. Es la forma que haría falta para capitalizar en un campo.
 *
 *  Devuelve `{ x, idx, rutaX, rutaIdx }` o `null`. Las rutas son relativas al nodo. */
export function esRaiz(n) {
  if (!n || n.k !== 'bin' || n.o !== '^') return null
  const e = n.r
  if (e?.k === 'bin' && e.o === '/' && e.l?.k === 'num' && Number(e.l.v) === 1) {
    return { x: n.l, idx: e.r, rutaX: ['l'], rutaIdx: ['r', 'r'] }
  }
  return null
}

/** Envuelve lo que hay en `ruta` en una RAÍZ: pasa a ser el radicando, con índice 2 editable.
 *
 *  Envuelve y no reemplaza, igual que las operaciones: si estás sobre algo armado y apretás raíz,
 *  querés la raíz DE eso. Reemplazar te hacía perder lo que tenías. */
export function envolverRaiz(n, ruta) {
  const actual = en(n, ruta)
  const x = actual && actual.k !== 'hueco' ? actual : hueco()
  return reemplazar(n, ruta, {
    k: 'bin', o: '^', l: x,
    r: { k: 'bin', o: '/', l: { k: 'num', v: 1 }, r: { k: 'num', v: 2 } },
  })
}

/** El nodo en una ruta. La ruta es un arreglo de 'l' / 'r' — la posición en el árbol, sin ids. */
export function en(n, ruta) {
  return ruta.reduce((x, paso) => (x ? x[paso] : null), n)
}

/** Devuelve un árbol NUEVO con `nuevo` puesto en `ruta`. Inmutable a propósito: así el `watch` de
 *  Vue ve el cambio sin depender de mutaciones profundas. */
export function reemplazar(n, ruta, nuevo) {
  if (!ruta.length) return nuevo
  const [paso, ...resto] = ruta
  return { ...n, [paso]: reemplazar(n[paso], resto, nuevo) }
}

/** Envuelve lo que hay en `ruta` en una operación: `sel` pasa a ser el lado IZQUIERDO y el derecho
 *  queda como hueco. Es lo que hace un editor matemático cuando seleccionás algo y apretás `×`.
 *
 *  Si lo seleccionado ya era un hueco, los dos lados quedan huecos — no tiene sentido operar sobre
 *  nada. */
export function envolver(n, ruta, o) {
  const actual = en(n, ruta)
  const izq = actual && actual.k !== 'hueco' ? actual : hueco()
  return reemplazar(n, ruta, { k: 'bin', o, l: izq, r: hueco() })
}

/** La ruta del primer hueco en orden de lectura, o `null` si no queda ninguno.
 *  `desde` permite buscar el SIGUIENTE: se saltean los huecos que estén antes de esa ruta. */
export function primerHueco(n, ruta = [], desde = null) {
  const salida = []
  recorrer(n, [], salida)
  if (!desde) return salida[0] ?? null
  const clave = desde.join('')
  return salida.find(r => r.join('') > clave) ?? salida[0] ?? null
}

function recorrer(n, ruta, salida) {
  if (!n) return
  if (n.k === 'hueco') { salida.push(ruta); return }
  if (n.k === 'bin') { recorrer(n.l, [...ruta, 'l'], salida); recorrer(n.r, [...ruta, 'r'], salida) }
}

/** Cuántos huecos quedan — para avisar que la fórmula está incompleta. */
export function huecos(n) {
  const s = []
  recorrer(n, [], s)
  return s.length
}
