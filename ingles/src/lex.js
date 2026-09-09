/* El matcher. Es LO ÚNICO no trivial de esta herramienta, así que vale explicar por qué es así.
 *
 * El JSON de una historia trae TEXTO PLANO y un glosario. No trae posiciones («la palabra 5 a la 7»).
 * Esa fue una decisión, no una simplificación: los índices se rompen solos —los genera mal un modelo,
 * y los invalida cualquier coma que uno agregue después—. Acá el texto y el glosario son
 * independientes: se pueden editar los dos por separado y nada queda desalineado.
 *
 * El precio es que hay que RECONOCER las entradas dentro del texto, y ahí aparecen dos problemas del
 * inglés que un `indexOf` no resuelve:
 *
 *   1. El texto viene conjugado. En el glosario está «go»; en la historia dice «went».
 *   2. Los phrasal verbs son varias palabras Y SE SEPARAN: «pick it up», «put them back»,
 *      «take all the things out». El significado vive en el par (verbo, partícula), no en el verbo.
 *
 * Para (1): `candidatos()` — de una palabra del texto salen sus formas posibles y se prueban contra
 * el glosario, la literal primero. NO es un lematizador correcto y no pretende serlo: «morning» da
 * «morn», que no es una palabra. Da igual — sólo se usa para preguntarle al glosario, y si no
 * acierta, la palabra queda sin marcar, que es exactamente lo que pasaría sin él.
 *
 * Para (2): en el glosario, `~` es el hueco. «pick ~ up» reconoce «pick up», «pick it up» y
 * «pick the small key up». Las frases contiguas se prueban ANTES y de la más larga a la más corta,
 * porque «look for» tiene que ganarle a «look» — si gana la palabra suelta, el hover enseña
 * «mirar» donde el texto dice «buscar», que es peor que no enseñar nada.
 */

/* Formas que ninguna regla de sufijo va a sacar. Sólo las de los verbos que de verdad aparecen: esto
   no quiere ser un diccionario, quiere que las 100 palabras se reconozcan conjugadas. */
const IRREGULARES = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', done: 'do', doing: 'do',
  said: 'say', goes: 'go', went: 'go', gone: 'go',
  got: 'get', gotten: 'get', made: 'make',
  knew: 'know', known: 'know', took: 'take', taken: 'take',
  saw: 'see', seen: 'see', came: 'come', thought: 'think',
  found: 'find', gave: 'give', given: 'give', left: 'leave',
  told: 'tell', felt: 'feel', kept: 'keep', held: 'hold', heard: 'hear',
  brought: 'bring', bought: 'buy', ran: 'run', sat: 'sit', stood: 'stand',
  wrote: 'write', written: 'write', read: 'read', met: 'meet', lost: 'lose',
  men: 'man', women: 'woman', children: 'child', feet: 'foot', teeth: 'tooth',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad', most: 'much',
  an: 'a', 'll': 'will', 've': 'have', 're': 'be',
}

// Si la palabra termina en consonante doble, la deshace: «stopped» → «stopp» → «stop».
const sinDoble = (s) => (s.length > 2 && s[s.length - 1] === s[s.length - 2] ? s.slice(0, -1) : s)

/* Las formas que podría tener esta palabra en el glosario, la literal PRIMERO. Devolver varias y
   probarlas es más robusto que acertar una sola: si sobra un candidato inventado, simplemente no
   está en el glosario y no pasa nada. */
export function candidatos(w) {
  const out = [w]
  const add = (x) => { if (x && x.length > 1 && !out.includes(x)) out.push(x) }
  if (IRREGULARES[w]) add(IRREGULARES[w])
  if (w.endsWith('ies') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es') && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -1)) }
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1))
  if (w.endsWith('ied') && w.length > 4) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ed') && w.length > 3) {
    add(w.slice(0, -2)); add(w.slice(0, -1)); add(sinDoble(w.slice(0, -2)))
  }
  if (w.endsWith('ing') && w.length > 4) {
    add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); add(sinDoble(w.slice(0, -3)))
  }
  if (w.endsWith('est') && w.length > 4) add(w.slice(0, -3))
  if (w.endsWith('er') && w.length > 3) { add(w.slice(0, -2)); add(w.slice(0, -1)) }
  return out
}

// Una entrada del glosario puede ser "texto" o {es, nota}. Adentro siempre es lo segundo.
const norm = (v) => (typeof v === 'string' ? { es: v } : { es: v?.es ?? '', nota: v?.nota })

/* El léxico de UNA historia: el núcleo compartido más lo suyo. El orden importa y es el de abajo —
   `sentidos` gana sobre todo porque es la historia diciendo «acá esta palabra NO significa lo de
   siempre», que es justo el caso donde el glosario general miente. */
export function construirLexico(core, historia) {
  const palabras = new Map()   // forma → entrada
  const frases = new Map()     // "a b c" → entrada  (contiguas)
  const huecos = []            // { a, b, entrada, clave }  (separables, con `~`)

  const meter = (mapa, clave, entrada, tipo) => {
    const k = clave.toLowerCase().trim()
    if (!mapa.has(k)) mapa.set(k, { ...norm(entrada), tipo, en: clave })
  }

  for (const [k, v] of Object.entries(historia?.sentidos ?? {})) meter(palabras, k, v, 'sentido')
  for (const [k, v] of Object.entries(historia?.nuevas ?? {})) meter(palabras, k, v, 'nueva')
  for (const [k, v] of Object.entries(core?.contracciones ?? {})) meter(palabras, k, v, 'core')
  for (const p of core?.palabras ?? []) meter(palabras, p.en, { es: p.es, nota: p.nota }, 'core')

  for (const [k, v] of Object.entries(historia?.frases ?? {})) {
    if (k.includes('~')) {
      const [a, b] = k.split('~').map((s) => s.trim().toLowerCase())
      huecos.push({ a, b, clave: k, ...norm(v), tipo: 'frase', en: k.replace(' ~ ', ' … ') })
    } else {
      meter(frases, k, v, 'frase')
    }
  }

  const maxLargo = Math.max(1, ...[...frases.keys()].map((k) => k.split(' ').length))
  return { palabras, frases, huecos, maxLargo }
}

const RE_PALABRA = /[A-Za-z]+(?:['’][A-Za-z]+)?/g
const HUECO_MAX = 4  // «take all the things out» son tres palabras en el medio; cuatro da margen

/* Parte un párrafo en tokens conservando TODO: espacios, puntuación y comillas quedan como están,
   porque el texto se lee y una historia con la puntuación comida se lee mal. */
function tokenizar(parrafo) {
  const tk = []
  let i = 0
  for (const m of parrafo.matchAll(RE_PALABRA)) {
    if (m.index > i) tk.push({ w: false, texto: parrafo.slice(i, m.index) })
    tk.push({ w: true, texto: m[0], baja: m[0].toLowerCase().replace('’', "'") })
    i = m.index + m[0].length
  }
  if (i < parrafo.length) tk.push({ w: false, texto: parrafo.slice(i) })
  return tk
}

/* Texto + léxico → párrafos de piezas listas para pintar.
   Pieza: { texto } suelta, o { texto, entrada, clave } marcada. */
export function analizar(texto, lex) {
  return String(texto ?? '').split(/\n\s*\n/).map((parrafo) => {
    const tk = tokenizar(parrafo)
    const idx = tk.map((t, n) => (t.w ? n : -1)).filter((n) => n >= 0)  // posiciones de las palabras
    const piezas = []
    let p = 0        // índice dentro de `idx`
    let cursor = 0   // índice dentro de `tk` — lo ya emitido

    const emitirCrudo = (hasta) => {
      const s = tk.slice(cursor, hasta).map((t) => t.texto).join('')
      if (s) piezas.push({ texto: s })
      cursor = hasta
    }

    while (p < idx.length) {
      const desde = idx[p]
      let hit = null

      // 1. frases contiguas, de la más larga a la más corta — «look for» antes que «look»
      for (let largo = Math.min(lex.maxLargo, idx.length - p); largo >= 2 && !hit; largo--) {
        const resto = idx.slice(p + 1, p + largo).map((n) => tk[n].baja)
        for (const c of candidatos(tk[desde].baja)) {
          const e = lex.frases.get([c, ...resto].join(' '))
          if (e) { hit = { entrada: e, hastaP: p + largo - 1 }; break }
        }
      }

      // 2. separables: «pick ~ up» reconoce «pick it up» y también «pick up» pelado
      if (!hit) {
        const cs = candidatos(tk[desde].baja)
        for (const h of lex.huecos) {
          if (!cs.includes(h.a)) continue
          for (let salto = 1; salto <= HUECO_MAX + 1 && p + salto < idx.length; salto++) {
            if (tk[idx[p + salto]].baja === h.b) { hit = { entrada: h, hastaP: p + salto }; break }
          }
          if (hit) break
        }
      }

      // 3. palabra suelta: la forma literal antes que cualquier forma deducida
      if (!hit) {
        for (const c of candidatos(tk[desde].baja)) {
          const e = lex.palabras.get(c)
          if (e) { hit = { entrada: e, hastaP: p }; break }
        }
      }

      if (hit) {
        emitirCrudo(desde)
        const fin = idx[hit.hastaP] + 1
        piezas.push({
          texto: tk.slice(desde, fin).map((t) => t.texto).join(''),
          entrada: hit.entrada,
          clave: hit.entrada.en.toLowerCase(),
        })
        cursor = fin
        p = hit.hastaP + 1
      } else {
        p++
      }
    }
    emitirCrudo(tk.length)
    return piezas
  })
}

/* Cuántas entradas del glosario aparecen DE VERDAD en el texto. Sirve para dos cosas: decir «esta
   historia trae 27 palabras nuevas» sin mentir, y avisar de las que quedaron declaradas y sin usar
   —que casi siempre es un typo en el JSON, no una palabra de más—. */
export function cobertura(parrafos, lex) {
  const usadas = new Map()
  for (const pf of parrafos) {
    for (const pz of pf) {
      if (!pz.entrada) continue
      usadas.set(pz.clave, (usadas.get(pz.clave) ?? 0) + 1)
    }
  }
  /* Una entrada puede no aparecer suelta y aun así estar bien: «right» no se marca en «all right»
     porque ganó la frase, que es lo correcto. Eso es ABSORBIDA, no huérfana — distinguirlas importa,
     porque un chequeo que grita por lo que funciona deja de mirarse y ahí se cuela el typo de verdad. */
  const tokensUsados = new Set()
  for (const k of usadas.keys()) for (const t of k.split(/\s+/)) if (t !== '~') tokensUsados.add(t)

  const declaradas = [...lex.palabras.values(), ...lex.frases.values(), ...lex.huecos]
    .filter((e) => e.tipo !== 'core' && !usadas.has(e.en.toLowerCase()))
  const absorbidas = declaradas
    .filter((e) => e.en.split(/\s+/).every((t) => t === '~' || t === '…' || tokensUsados.has(t.toLowerCase())))
    .map((e) => e.en)
  const huerfanas = declaradas.map((e) => e.en).filter((n) => !absorbidas.includes(n))
  return { usadas, huerfanas, absorbidas }
}
