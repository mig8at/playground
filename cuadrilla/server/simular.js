import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as db from './db.js'

/* ⚠ SIMULADOR — no es parte del producto.
   Escribe a mano el estado que en producción va a traer GitHub (si hay PR abierto, cuántos días
   lleva, el número, el diff). Existe por una razón sola: sin datos en `aprobacion` y `mergeada`,
   la mitad del tablero —Revisión, el represamiento por antigüedad, «lo más trabado»— abre en cero
   y no se puede ver si está bien hecha.

   Deliberadamente NO hay endpoint HTTP para esto. Si el estado se pudiera tocar desde la UI, en dos
   semanas nadie sabría si un «por aprobación» es real o lo puso alguien a mano. Es un script que se
   corre a conciencia, y el día que exista la GitHub App se borra junto con `db.simularEstado`.

   Uso:
     npm run simular                        → lista las ramas y sus estados
     npm run simular -- pr <rama> [dias]    → la pone en «por aprobación»
     npm run simular -- merge <rama>        → la pone en «mergeada»
     npm run simular -- dev <rama>          → la vuelve a «en desarrollo», sin PR
     npm run simular -- aprobar <rama> <quien> [demora]   → registra que <quien> aprobó ese PR
*/

db.abrir(process.env.CUADRILLA_DB
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'cuadrilla.db'))

const [accion, aguja, arg, arg2] = process.argv.slice(2)
const epicas = db.epicas()

if (!epicas.length) {
  console.log('No hay épicas todavía.')
  process.exit(0)
}

// Sin argumentos: mostrar qué hay. Un simulador que no deja ver el estado actual obliga a adivinar
// el nombre exacto de la rama.
if (!accion) {
  for (const e of epicas) {
    console.log(`\n  ${e.nombre}  (${e.id})`)
    if (!e.ramas.length) console.log('    — sin ramas')
    for (const r of e.ramas) {
      const pr = r.pr ? `#${r.pr}` : 'sin PR'
      console.log(`    ${r.estado.padEnd(11)} ${String(r.dias).padStart(2)}d  ${pr.padEnd(7)} ${r.rama}  (${r.repo})`)
    }
  }
  console.log('\n  npm run simular -- pr <rama> [dias]   ·   merge <rama>   ·   dev <rama>\n')
  process.exit(0)
}

if (!aguja) {
  console.error('Falta el nombre (o un trozo) de la rama.')
  process.exit(2)
}

// Se busca por trozo del nombre para no tener que escribir `feature/CORE-123-lo-que-sea` completo.
const halladas = epicas.flatMap(e =>
  e.ramas.filter(r => r.rama.includes(aguja)).map(r => ({ epica: e, rama: r })))

if (!halladas.length) {
  console.error(`Ninguna rama contiene «${aguja}». Corré \`npm run simular\` para ver las que hay.`)
  process.exit(1)
}
if (halladas.length > 1) {
  console.error(`«${aguja}» coincide con ${halladas.length} ramas — sé más específico:`)
  for (const h of halladas) console.error(`    ${h.rama.rama}  (${h.rama.repo})`)
  process.exit(1)
}

const { epica, rama } = halladas[0]

/* El diff se conserva si ya lo tenía: es lo único de estos campos que no depende del estado —una
   rama mergeada tuvo el mismo +/- que cuando esperaba—. Si viene en cero (las ramas que se agregan
   por la UI no traen diff, porque eso lo sabe GitHub) se inventa uno DETERMINISTA a partir del
   nombre: sin él, el podio muestra «0 líneas» al lado de alguien que sí revisó, y el cero se lee
   como que no hizo nada cuando la que no sabe es la herramienta. */
const semilla = [...rama.rama].reduce((a, c) => a + c.charCodeAt(0), 0)
const diff = (rama.mas || rama.men)
  ? { mas: rama.mas, men: rama.men }
  : { mas: 40 + semilla % 460, men: 4 + semilla % 90 }

/* Aprobar no es un estado de la rama: es una fila aparte, porque un PR puede tener varios
   revisores y porque el podio cuenta personas, no ramas. */
if (accion === 'aprobar') {
  if (!arg) {
    console.error('Falta quién aprueba:  npm run simular -- aprobar <rama> <quien> [demora]')
    process.exit(2)
  }
  db.simularAprobacion(epica.id, rama.repo, rama.rama, arg, Number(arg2 ?? 1))
  console.log(`  ${arg} aprobó ${rama.rama} (${rama.repo}), tras ${arg2 ?? 1}d de espera`)
  console.log('  ⚠ simulado a mano: esto lo va a traer GitHub (GET /pulls/{n}/reviews).')
  process.exit(0)
}

const estados = {
  pr:    { estado: 'aprobacion', dias: Number(arg ?? 5), pr: rama.pr ?? 1000 + Math.floor(rama.rama.length * 7), ...diff },
  merge: { estado: 'mergeada',   dias: Number(arg ?? 2), pr: rama.pr ?? null, ...diff },
  dev:   { estado: 'desarrollo', dias: Number(arg ?? 1), pr: null, ...diff },
}

if (!estados[accion]) {
  console.error(`Acción desconocida «${accion}». Son: pr · merge · dev · aprobar`)
  process.exit(2)
}

db.simularEstado(epica.id, rama.repo, rama.rama, estados[accion])
const e = estados[accion]
console.log(`  ${rama.rama} (${rama.repo}) → ${e.estado}, ${e.dias}d${e.pr ? `, PR #${e.pr}` : ''}`)
console.log('  ⚠ simulado a mano: esto lo va a pisar GitHub cuando esté conectado.')
