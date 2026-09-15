/* La lógica del ejercicio. Sin Vue adentro a propósito: así se prueba con `node`, sin navegador, y
 * lo no trivial de acá —la comparación— falla de una forma que no se ve mirando la pantalla.
 *
 * El ítem es UNA FRASE CON UN HUECO, y el hueco va marcado en el propio texto:
 *
 *     "Ayer [tuvo] mucha suerte."
 *
 * Eso es una decisión, no una comodidad. La alternativa —guardar la frase y la respuesta en dos
 * campos— tiene una sola fuente de verdad de más: el día que alguien corrige la frase y no el campo,
 * el ejercicio empieza a pedir una palabra que ya no está ahí, y no se ve leyendo el JSON.
 *
 * Y la frase existe porque en español el DICTADO DE PALABRAS SUELTAS ES IMPOSIBLE. «Tuvo» y «tubo»
 * suenan idénticas; «casa» y «caza» también, y «cayó» y «calló». Sin contexto no hay forma de
 * acertar salvo adivinando, y un ejercicio que se falla por adivinar mal no enseña nada. La frase
 * desambigua, y el hueco deja que lo único que escribas sea justo lo que se está practicando.
 */

/* ⚠ Se quita SÓLO el acento agudo (U+0301), no «los diacríticos». Descomponer y borrar todo el
   rango 0300-036F —que es lo que uno copia de internet— se come la **ñ** (n + U+0303) y la **ü**
   (u + U+0308), o sea que «año» pasaría a «ano» y «pingüino» a «pinguino»: dos letras distintas del
   español convertidas en la misma. Acá la ñ y la ü son letras; la tilde es la que se compara. */
const sinTilde = (s) => s.normalize('NFD').replace(/́/g, '').normalize('NFC')
const cuantasTildes = (s) => (s.normalize('NFD').match(/́/g) ?? []).length

/* Se perdonan mayúsculas y espacios de más. La tilde NO: acá es la lección, no un adorno.
   El `NFC` es obligatorio: «á» puede venir del teclado como un carácter o como «a» + acento
   combinante, y sin normalizar las dos formas se ven distintas aunque en pantalla sean idénticas. */
export const normalizar = (s) =>
  String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

const HUECO = /\[([^\]]*)\]/

/* Frase → sus tres pedazos. `dictado` es la frase entera CON la palabra puesta: se lee completa,
   porque es el contexto el que dice cuál de las dos gemelas es. */
export function partir(frase) {
  const m = HUECO.exec(String(frase ?? ''))
  if (!m || !m[1].trim()) return null
  const antes = frase.slice(0, m.index)
  const despues = frase.slice(m.index + m[0].length)
  return { antes, va: m[1], despues, dictado: antes + m[1] + despues }
}

export function fichas(reglas) {
  const out = []
  for (const r of reglas ?? []) {
    for (const it of r.items ?? []) {
      const p = partir(it.frase)
      if (!p) continue
      out.push({
        // La clave es (regla, palabra) y no la frase: la unidad que se aprende es la PALABRA, así
        // que dos frases que practican «qué» tienen que sumar a la misma cuenta, no a dos.
        clave: `${r.id}#${normalizar(p.va)}`,
        regla: r.id, tituloRegla: r.titulo, oido: r.oido,
        ...p, porque: it.porque, ojo: it.ojo,
      })
    }
  }
  return out
}

export function armar(conjunto, { reglas, memoria } = {}) {
  const todas = fichas(reglas)
  if (conjunto === 'flojas') {
    const { items = {}, sabidos = [] } = memoria ?? {}
    return todas
      .filter((f) => (items[f.clave]?.mal ?? 0) > 0 && !sabidos.includes(f.clave))
      .sort((a, b) => (items[b.clave]?.mal ?? 0) - (items[a.clave]?.mal ?? 0))
  }
  if (conjunto && conjunto !== 'todo') return todas.filter((f) => f.regla === conjunto)
  return todas
}

export function barajar(lista) {
  const a = [...lista]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* Alinea lo que escribiste con lo que va y devuelve las dos palabras COLUMNA A COLUMNA, para
 * pintarlas una debajo de la otra:
 *
 *    { t: 'b', c: 'b', estado: 'ok'     }   coinciden
 *    { t: 'b', c: 'v', estado: 'cambia' }   pusiste otra letra
 *    { t: 'h', c: null, estado: 'sobra' }   sobra en lo tuyo
 *    { t: null, c: 'h', estado: 'falta' }   falta en lo tuyo
 *
 * Comparar posición por posición no sirve: a una palabra a la que le falta una letra en el medio se
 * le corren TODAS las de atrás, y la corrección diría «tenés mal media palabra» cuando tenés mal
 * una. Por eso va una distancia de edición con reconstrucción del camino.
 */
export function comparar(escrito, va) {
  const a = [...normalizar(escrito)]
  const b = [...normalizar(va)]
  const m = a.length
  const n = b.length

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

  /* La diagonal se prueba PRIMERO: sin eso, cambiar una letra se reconstruye como «sobra una» más
     «falta otra» —mismo costo, dos columnas— y la corrección muestra dos errores donde hay uno. */
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

  return { bien: a.join('') === b.join(''), pasos, diagnostico: diagnostico(a.join(''), b.join(''), pasos) }
}

/* Y acá está lo que separa esto de un corrector en inglés: en español el error casi siempre TIENE
 * NOMBRE. «Está mal» no enseña; «es la tilde», «va junto» o «acá va b, no v» sí, porque nombra la
 * clase del error y esa clase se repite en cientos de palabras.
 *
 * Devuelve `null` cuando no hay un nombre corto y honesto — mejor callarse que inventar una
 * categoría: para eso está el `porque` del ítem, que explica la regla de verdad.
 */
function diagnostico(a, b, pasos) {
  if (a === b) return null

  // 1. sólo cambian las tildes
  if (sinTilde(a) === sinTilde(b)) {
    const na = cuantasTildes(a)
    const nb = cuantasTildes(b)
    if (na < nb) return 'Es la tilde: falta.'
    if (na > nb) return 'Es la tilde: sobra.'
    return 'La tilde está, pero en otra sílaba.'
  }

  // 2. sólo cambia el espacio: la familia porque / por que / sino / si no
  const pegado = (s) => s.replace(/\s+/g, '')
  if (pegado(a) === pegado(b)) {
    return b.includes(' ') ? 'Van separadas, son dos palabras.' : 'Va junto, en una sola palabra.'
  }

  /* 3. espacio Y tilde a la vez. Va después de las dos anteriores y antes de la de las letras
        porque es el error más común del español escrito —«porque» contra «por qué»— y caía en el
        hueco entre las dos: dos diferencias, así que ninguna rama lo agarraba y se quedaba mudo. */
  if (pegado(sinTilde(a)) === pegado(sinTilde(b))) {
    return b.includes(' ') ? 'Son dos palabras, y la tilde también cambia.'
                           : 'Es una sola palabra, y la tilde también cambia.'
  }

  // 4. una sola letra de diferencia: se puede nombrar cuál
  const fallos = pasos.filter((p) => p.estado !== 'ok')
  if (fallos.length === 1) {
    const f = fallos[0]
    if (f.estado === 'cambia') return `Acá va «${f.c}», no «${f.t}».`
    if (f.estado === 'falta') return `Falta la «${f.c}».`
    if (f.estado === 'sobra') return `Sobra esa «${f.t}».`
  }
  return null
}
