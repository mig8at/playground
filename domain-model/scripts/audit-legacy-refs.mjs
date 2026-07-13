// Verdad determinística para el barrido de alineamiento modelo deber-ser <-> tablas reales.
// Cruza cada referencia legacy del modelo contra las 212 tablas reales (docs/audit/real_tables.txt).
// Salida: docs/audit/ground-truth.json + resumen por consola.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/modelo-dominio.json'), 'utf8'))
const real = new Set(
  fs.readFileSync(path.join(ROOT, 'docs/audit/real_tables.txt'), 'utf8')
    .split('\n').map(s => s.trim()).filter(Boolean)
)

const exists = t => real.has(t)
const isGreenfield = s => typeof s === 'string' && /green-?field/i.test(s)

// SOLO tabla + absorbe[] son referencias a TABLAS. reducidas[].legacy son COLUMNAS.
const tableRefsOf = e => {
  const out = []
  const L = e.legacy || {}
  if (L.tabla && !isGreenfield(L.tabla)) out.push({ kind: 'tabla', name: L.tabla })
  ;(L.absorbe || []).forEach(t => out.push({ kind: 'absorbe', name: t }))
  return out
}

const entidades = model.entidades.map(e => {
  const L = e.legacy || {}
  const greenfield = isGreenfield(L.ref) || isGreenfield(L.tabla)
  const tableRefs = tableRefsOf(e).map(r => ({ ...r, exists: exists(r.name) }))
  const broken = tableRefs.filter(r => !r.exists)
  // columnas reducidas (no son tablas; se validan contra columnas, no acá)
  const columnasReducidas = (L.reducidas || []).map(r => r.legacy).filter(Boolean)

  let estado
  if (e.tipo === 'external') estado = 'externo'
  else if (greenfield && tableRefs.length === 0) estado = 'NUEVA_greenfield'      // nueva, marcada OK
  else if (tableRefs.length === 0) estado = 'NUEVA_sin_marcar'                    // nueva pero SIN marcar (revisar)
  else if (broken.length === 0) estado = 'mapeada_ok'
  else estado = 'REF_ROTA'                                                        // <-- apunta a tabla inexistente
  return {
    key: e.key, name: e.name, contexto: e.contexto, tipo: e.tipo,
    nAtributos: (e.atributos || []).length, estado, greenfield,
    tableRefs, broken: broken.map(b => `${b.kind}:${b.name}`),
    columnasReducidas,
  }
})

const byEstado = {}
entidades.forEach(e => { byEstado[e.estado] = (byEstado[e.estado] || 0) + 1 })

const out = {
  generado: 'audit-legacy-refs.mjs',
  modelVersion: model.version,
  totalEntidades: entidades.length,
  totalTablasReales: real.size,
  resumen: byEstado,
  // lo que el usuario quiere cazar: modelo apunta a tabla legacy inexistente
  referenciasRotas: entidades.filter(e => e.estado === 'REF_ROTA')
    .map(e => ({ entidad: e.key, contexto: e.contexto, tablasInexistentes: e.broken })),
  // nuevas marcadas como green-field (OK)
  nuevasGreenfield: entidades.filter(e => e.estado === 'NUEVA_greenfield').map(e => e.key),
  // nuevas SIN marcar (revisar: ¿son nuevas o falta el legacy.tabla?)
  nuevasSinMarcar: entidades.filter(e => e.estado === 'NUEVA_sin_marcar')
    .map(e => ({ entidad: e.key, contexto: e.contexto })),
  entidades,
  valueObjects: (model.valueObjects || []).map(v => v.key),
}
fs.writeFileSync(path.join(ROOT, 'docs/audit/ground-truth.json'), JSON.stringify(out, null, 2))

console.log('=== RESUMEN ALINEAMIENTO (determinístico) ===')
console.log('Entidades:', out.totalEntidades, '| Tablas reales:', out.totalTablasReales)
console.log(byEstado)
console.log('\n=== REFERENCIAS ROTAS (modelo -> tabla legacy inexistente) [' + out.referenciasRotas.length + '] ===')
if (!out.referenciasRotas.length) console.log('  (ninguna)')
out.referenciasRotas.forEach(r => console.log(`  [${r.contexto}] ${r.entidad} -> ${r.tablasInexistentes.join(', ')}`))
console.log('\n=== NUEVAS green-field marcadas OK [' + out.nuevasGreenfield.length + '] ===')
console.log('  ' + out.nuevasGreenfield.join(', '))
console.log('\n=== NUEVAS SIN MARCAR (revisar) [' + out.nuevasSinMarcar.length + '] ===')
out.nuevasSinMarcar.forEach(n => console.log(`  [${n.contexto}] ${n.entidad}`))
