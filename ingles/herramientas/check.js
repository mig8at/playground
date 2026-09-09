#!/usr/bin/env node
/* El oráculo de las historias. Existe porque estos .json los escribe un modelo, y el modo en que
 * fallan es SILENCIOSO: una palabra mal escrita en el glosario no rompe nada, simplemente deja de
 * aparecer al pasar el mouse. Nadie se entera hasta que está leyendo y esa palabra justo no responde.
 *
 * Lo que de verdad importa acá es la tercera lista, «sin traducción»: palabras que están en el texto
 * y en ningún glosario. Ésas son las que dejan al lector colgado.
 *
 *   npm run check          todas las historias
 *   npm run check -- 02    sólo las que matcheen «02»
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construirLexico, analizar, cobertura } from '../src/lex.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const core = JSON.parse(readFileSync(join(raiz, 'data/core-100.json'), 'utf8'))
const dir = join(raiz, 'data/historias')
const filtro = process.argv[2]

const C = { rojo: '\x1b[31m', amar: '\x1b[33m', verde: '\x1b[32m', gris: '\x1b[90m', off: '\x1b[0m' }
let problemas = 0

const archivos = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .filter((f) => !filtro || f.includes(filtro)).sort()

if (!archivos.length) {
  console.log(`sin historias que revisar${filtro ? ` para «${filtro}»` : ''} en data/historias/`)
  process.exit(0)
}

console.log(`\n  ${core.palabras.length} palabras de núcleo · ${archivos.length} historia(s)\n`)

for (const archivo of archivos) {
  let h
  try {
    h = JSON.parse(readFileSync(join(dir, archivo), 'utf8'))
  } catch (e) {
    console.log(`${C.rojo}✗ ${archivo}${C.off}  el JSON no parsea: ${e.message}`)
    problemas++
    continue
  }

  const falta = ['id', 'titulo', 'texto'].filter((k) => !h[k])
  const idMal = h.id && !archivo.startsWith(h.id) ? `id «${h.id}» ≠ nombre del archivo` : null

  const lex = construirLexico(core, h)
  const parrafos = analizar(h.texto, lex)
  const { usadas, huerfanas, absorbidas } = cobertura(parrafos, lex)

  /* Las palabras del texto que ningún glosario cubre. Los nombres propios se declaran en `nombres`
     del .json — sin eso, «Tom» y «Ana» saldrían en la lista todas las veces y la lista útil quedaría
     enterrada bajo ruido conocido. */
  const nombres = new Set((h.nombres ?? []).map((n) => n.toLowerCase()))
  const sinCubrir = new Map()
  /* Se le pregunta al ANÁLISIS, no al glosario. La primera versión comparaba la palabra del texto
     contra las claves del glosario y daba falsos positivos: «picked» está perfectamente cubierta por
     la frase «pick ~ up», pero la clave guarda el lema «pick» y la comparación no coincidía. Las
     piezas SIN marcar son, por definición, exactamente lo que quedó sin ayuda en pantalla. */
  for (const pieza of parrafos.flat()) {
    if (pieza.entrada) continue
    for (const m of pieza.texto.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
      const w = m[0].toLowerCase().replace('’', "'")
      if (nombres.has(w)) continue
      sinCubrir.set(w, (sinCubrir.get(w) ?? 0) + 1)
    }
  }

  const nuevas = Object.keys(h.nuevas ?? {}).length
  const frases = Object.keys(h.frases ?? {}).length
  const sentidos = Object.keys(h.sentidos ?? {}).length
  const total = h.texto.split(/\s+/).length

  const malo = falta.length || idMal || huerfanas.length || sinCubrir.size
  console.log(`${malo ? C.amar + '!' : C.verde + '✓'} ${archivo}${C.off}  ` +
    `${C.gris}${total} palabras · ${nuevas} nuevas · ${frases} frases · ${sentidos} sentidos${C.off}`)

  if (falta.length) { console.log(`   ${C.rojo}faltan campos:${C.off} ${falta.join(', ')}`); problemas++ }
  if (idMal) { console.log(`   ${C.rojo}${idMal}${C.off}`); problemas++ }

  if (huerfanas.length) {
    console.log(`   ${C.amar}en el glosario y NO en el texto${C.off} (typo casi seguro): ${huerfanas.join(', ')}`)
    problemas++
  }
  if (sinCubrir.size) {
    const lista = [...sinCubrir.entries()].sort((a, b) => b[1] - a[1])
      .map(([w, n]) => (n > 1 ? `${w}×${n}` : w))
    console.log(`   ${C.amar}en el texto y SIN traducción${C.off} (${sinCubrir.size}): ${lista.join(', ')}`)
    console.log(`   ${C.gris}→ agregalas a «nuevas», o a «nombres» si son nombres propios${C.off}`)
    problemas++
  }
  if (absorbidas.length) {
    console.log(`   ${C.gris}sueltas pero cubiertas por una frase (está bien): ${absorbidas.join(', ')}${C.off}`)
  }
}

console.log()
if (problemas) {
  console.log(`${C.amar}${problemas} cosa(s) que mirar.${C.off}\n`)
  process.exit(1)
}
console.log(`${C.verde}todo cubierto.${C.off}\n`)
