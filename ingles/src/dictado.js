/* El dictado: oír una palabra y escribirla, antes de sentarse a transcribir el cuento.
 *
 * Es el paso previo al método de la herramienta. Transcribir la historia entera con el glosario al
 * lado se puede hacer copiando letra por letra sin haber aprendido a escribir ninguna palabra; el
 * dictado saca el modelo de la pantalla y deja sólo el sonido, que es donde el inglés no se deja
 * deducir —«neighbor» no se escribe como suena y «though» no se parece a nada—.
 *
 * Este archivo no sabe nada de Vue a propósito: es lo que permite probarlo con `node` sin navegador,
 * y lo no trivial de acá —la comparación— falla de una forma que no se ve mirando la pantalla.
 *
 * Dos decisiones que explican el resto:
 *
 * 1. NO se compara con `===`. Decir «está mal» es fácil; lo que enseña es DÓNDE está mal, y para eso
 *    hay que alinear las dos escrituras. Comparar posición por posición no sirve: a «neigbor» le
 *    falta una letra en el medio, y desde ahí todas las demás quedan corridas — el resultado sería
 *    «tenés mal la mitad de la palabra» cuando tenés mal UNA. Por eso va una distancia de edición
 *    con reconstrucción del camino: dice «acá falta una h» y nada más.
 *
 * 2. La respuesta esperada es la frase SIN el hueco. En el glosario los separables viven como
 *    «pick ~ up» —el `~` es el hueco de `lex.js`—, pero dictado suena «pick up» y eso es lo que uno
 *    escribe. El `~` vuelve a aparecer en la corrección, donde sí explica algo.
 */

/* El `~` de los separables y el `…` con que se muestran no se dictan ni se escriben. */
export const sinHueco = (en) => String(en ?? '').replace(/[~…]/g, ' ').replace(/\s+/g, ' ').trim()

/* Lo que se perdona al comparar: mayúsculas, espacios de más y la comilla tipográfica —que la pone
   el teclado, no vos—. El apóstrofo en sí NO se perdona: en «don't» es la lección. */
export const normalizar = (s) =>
  String(s ?? '').toLowerCase().replace(/[’‘´`]/g, "'").replace(/\s+/g, ' ').trim()

export const CONJUNTOS = [
  ['nuevo',  'lo que esta historia agrega'],
  ['cien',   'las 100 que salen en ésta'],
  ['todo',   'todas las de esta historia'],
  ['flojas', 'las que te vienen costando'],
]

const ficha = (e) => ({
  clave: e.en.toLowerCase(),
  en: e.en,
  es: e.es,
  nota: e.nota,
  tipo: e.tipo,
  respuesta: sinHueco(e.en),
})

const entradasDe = (lex) => [
  ...(lex?.palabras?.values?.() ?? []),
  ...(lex?.frases?.values?.() ?? []),
  ...(lex?.huecos ?? []),
]

/* «Las que te cuestan» sale del uso y no de una lista, igual que la pestaña Repasar — pero acá suma
   DOS evidencias distintas: las veces que miraste la traducción y las veces que no la supiste
   escribir. La segunda pesa doble porque es la más cara: haberla mirado significa que no te acordabas
   del significado; haberla fallado de dictado significa que ni siquiera la reconocés oyéndola. */
function flojas(global, { vistas = {}, sabidas = [], dictado = {} } = {}) {
  const costo = new Map()
  const sumar = (k, n) => costo.set(k, (costo.get(k) ?? 0) + n)
  for (const [k, n] of Object.entries(vistas)) if (n > 0) sumar(k, n)
  for (const [k, d] of Object.entries(dictado)) if (d?.mal > 0) sumar(k, d.mal * 2)
  return [...costo.entries()]
    .filter(([k]) => !sabidas.includes(k) && global?.has?.(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => global.get(k))
}

/* Las candidatas de un conjunto, SIN barajar: así se puede contar sin sortear, que es lo que hace
   el selector para decir cuántas son antes de empezar. */
export function armar(conjunto, { lex, usadas, global, memoria } = {}) {
  const todas = entradasDe(lex)
  const nuevas = todas.filter((e) => e.tipo !== 'core')
  // Del núcleo, sólo las que de verdad salen en esta historia: las otras no son «del cuento».
  const core = todas.filter((e) => e.tipo === 'core' && usadas?.has?.(e.en.toLowerCase()))

  const elegidas =
    conjunto === 'cien' ? core
    : conjunto === 'todo' ? [...nuevas, ...core]
    : conjunto === 'flojas' ? flojas(global, memoria)
    : nuevas

  const vistas = new Set()
  return elegidas
    .filter((e) => e?.en && !vistas.has(e.en.toLowerCase()) && vistas.add(e.en.toLowerCase()))
    .map(ficha)
}

export function barajar(lista) {
  const a = [...lista]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* Compara lo escrito contra lo esperado y devuelve las dos palabras ALINEADAS, paso a paso, para
 * poder pintarlas una debajo de la otra. Cada paso es una columna:
 *
 *    { t: 'h', c: 'h', estado: 'ok'     }   coinciden
 *    { t: 'a', c: 'e', estado: 'cambia' }   pusiste otra letra
 *    { t: 'r', c: null, estado: 'sobra' }   sobra en lo tuyo
 *    { t: null, c: 'h', estado: 'falta' }   falta en lo tuyo
 *
 * Las dos filas terminan con la misma cantidad de columnas, así que el hueco cae debajo de la letra
 * que no escribiste. Es la diferencia entre «está mal» y «te falta la h de neighbor».
 */
export function comparar(escrito, esperado) {
  const a = [...normalizar(escrito)]
  const b = [...normalizar(esperado)]
  const m = a.length
  const n = b.length

  // D[i][j] = ediciones mínimas entre los primeros i de `a` y los primeros j de `b`.
  const D = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) D[i][0] = i
  for (let j = 1; j <= n; j++) D[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      D[i][j] = Math.min(
        D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        D[i - 1][j] + 1,
        D[i][j - 1] + 1,
      )
    }
  }

  /* Se rehace el camino desde el final, y la diagonal se prueba PRIMERO: sin eso, cambiar una letra
     se cuenta como «sobra una» + «falta otra» —mismo costo, dos columnas— y la corrección muestra
     dos errores donde hay uno. */
  const pasos = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    const igual = i > 0 && j > 0 && a[i - 1] === b[j - 1]
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (igual ? 0 : 1)) {
      pasos.unshift({ t: a[i - 1], c: b[j - 1], estado: igual ? 'ok' : 'cambia' })
      i--; j--
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      pasos.unshift({ t: a[i - 1], c: null, estado: 'sobra' })
      i--
    } else {
      pasos.unshift({ t: null, c: b[j - 1], estado: 'falta' })
      j--
    }
  }

  return { bien: a.join('') === b.join(''), pasos, tuyo: a.join(''), va: b.join('') }
}
