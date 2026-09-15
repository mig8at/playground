#!/usr/bin/env node
/* El oráculo de las reglas. Existe porque estos .json fallan en SILENCIO: un ítem al que le falta
 * el hueco simplemente no aparece en el ejercicio, y nadie se entera nunca — no hay error, hay una
 * pregunta menos.
 *
 * Lo que de verdad importa acá es la lista «sin porqué». Un ítem sin explicación igual funciona: te
 * dicta la frase, te dice si acertaste y sigue. Pero entonces la herramienta dejó de ser lo que es
 * —la que te dice QUÉ REGLA rompiste— y pasó a ser un juego de adivinar palabras. Es el fallo más
 * caro y el más invisible, porque en pantalla se ve perfecto.
 *
 *   npm run check          todas las reglas
 *   npm run check -- 04    sólo las que matcheen «04»
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { partir, normalizar } from '../src/ejercicio.js'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(raiz, 'data/reglas')
const filtro = process.argv[2]

const C = { rojo: '\x1b[31m', amar: '\x1b[33m', verde: '\x1b[32m', gris: '\x1b[90m', off: '\x1b[0m' }
let problemas = 0

const archivos = readdirSync(dir).filter((f) => f.endsWith('.json'))
  .filter((f) => !filtro || f.includes(filtro)).sort()

if (!archivos.length) {
  console.log(`sin reglas que revisar${filtro ? ` para «${filtro}»` : ''} en data/reglas/`)
  process.exit(0)
}

// Sólo letras del español y espacios. Atrapa dos cosas: puntuación que se coló dentro del hueco
// —que haría imposible acertar— y el mojibake de un archivo mal guardado («canciÃ³n»).
const LIMPIA = /^[a-záéíóúüñ ]+$/i

const frasesVistas = new Map()
let totalItems = 0

console.log(`\n  ${archivos.length} regla(s)\n`)
/* Con filtro, «frase repetida» sólo puede comparar contra lo que se cargó — y un chequeo que
   contesta «no hay» cuando no supo buscar es peor que no tenerlo. Así que lo dice. */
if (filtro) console.log(`  ${C.gris}filtrado por «${filtro}»: las frases repetidas sólo se buscan entre estas.${C.off}\n`)

for (const archivo of archivos) {
  let r
  try {
    r = JSON.parse(readFileSync(join(dir, archivo), 'utf8'))
  } catch (e) {
    console.log(`${C.rojo}✗ ${archivo}${C.off}  el JSON no parsea: ${e.message}`)
    problemas++
    continue
  }

  const faltan = ['id', 'titulo', 'resumen', 'regla', 'oido', 'seOye', 'items'].filter((k) => !r[k])
  const sinHueco = []
  const sinPorque = []
  const sucias = []
  const repetidas = []
  const dosVeces = new Map()   // misma respuesta dos veces en la MISMA regla

  for (const [n, it] of (r.items ?? []).entries()) {
    totalItems++
    const donde = `#${n + 1} «${String(it.frase ?? '').slice(0, 40)}…»`
    const p = partir(it.frase)
    if (!p) { sinHueco.push(donde); continue }
    if (!it.porque) sinPorque.push(`${donde} → ${p.va}`)
    if (!LIMPIA.test(p.va)) sucias.push(`${p.va}`)

    const clave = normalizar(p.dictado)
    if (frasesVistas.has(clave)) repetidas.push(`${p.va} (ya está en ${frasesVistas.get(clave)})`)
    else frasesVistas.set(clave, archivo)

    const k = normalizar(p.va)
    dosVeces.set(k, (dosVeces.get(k) ?? 0) + 1)
  }

  const mal = faltan.length || sinHueco.length || sinPorque.length || sucias.length || repetidas.length
  if (mal) problemas++
  const marca = mal ? `${C.rojo}✗` : `${C.verde}✓`
  const juntas = [...dosVeces.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`)

  console.log(`${marca} ${archivo}${C.off}  ${C.gris}${(r.items ?? []).length} ítems · ${r.titulo ?? '(sin título)'}${C.off}`)
  if (r.id && !archivo.startsWith(r.id)) {
    console.log(`   ${C.amar}el id «${r.id}» no coincide con el nombre del archivo${C.off}`)
  }
  if (faltan.length) console.log(`   ${C.rojo}le faltan campos: ${faltan.join(', ')}${C.off}`)
  if (r.seOye && !['decide', 'ayuda', 'no'].includes(r.seOye)) {
    console.log(`   ${C.rojo}«seOye» tiene que ser decide, ayuda o no — dice «${r.seOye}»${C.off}`)
    problemas++
  }
  // El hueco es lo que hace existir a la pregunta: sin él, el ítem no se cae, DESAPARECE.
  if (sinHueco.length) console.log(`   ${C.rojo}sin hueco [ ] — no van a aparecer nunca:\n     ${sinHueco.join('\n     ')}${C.off}`)
  if (sinPorque.length) console.log(`   ${C.rojo}sin porqué — corrigen sin enseñar:\n     ${sinPorque.join('\n     ')}${C.off}`)
  if (sucias.length) console.log(`   ${C.rojo}respuesta con algo que no es una letra: ${sucias.join(' · ')}${C.off}`)
  if (repetidas.length) console.log(`   ${C.amar}frase repetida: ${repetidas.join(' · ')}${C.off}`)
  // Dos frases para la misma palabra está BIEN —se practica dos veces— pero comparten contador.
  if (juntas.length) console.log(`   ${C.gris}misma palabra en dos frases (está bien, suman al mismo contador): ${juntas.join(' · ')}${C.off}`)
}

console.log(`\n  ${totalItems} ítems en total`)
console.log(problemas ? `\n${C.rojo}${problemas} archivo(s) con problemas.${C.off}\n`
                      : `\n${C.verde}todo en orden.${C.off}\n`)
process.exit(problemas ? 1 : 0)
