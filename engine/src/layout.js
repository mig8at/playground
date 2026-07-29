import { FORMULA_LABEL } from './sheets.js'

// Cinco nodos: entrada → (tasa ∥ valor a financiar) → cuota → plan de pagos.
//
// `tasa` y `valor a financiar` van en PARALELO porque ninguna depende de la otra — verificado
// contra las dependencias reales, no supuesto. `cuota` depende de las dos, así que va después.
//
// Las claves de las etapas son las mismas que las secciones de la entrada, así que se lee el
// par: lo que se puso "al monto" sale como `valor a financiar`.
const COL_W = 372   // > que el nodo Entrada (336), o se solapan
const GAP_Y = 26

export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {} } = opts
  const stages = def.stages || []

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: { inputs: def.inputs || [], inputSections: def.inputSections, values: inputValues },
  }]
  const edges = []

  const row = (name) => ({
    name, expr: def.formulas[name],
    status: out.res[name]?.status ?? 'skipped',
    value: out.res[name]?.status === 'ok' ? out.res[name].value : undefined,
  })
  const stageH = st => 44 + st.formulas.length * 22 + 10
  const salida = st => st.formulas[st.formulas.length - 1]

  // qué etapa depende de qué etapa, y por cuál fórmula cruza
  const dueño = {}
  stages.forEach(st => st.formulas.forEach(f => (dueño[f] = st.key)))
  const dep = new Map(stages.map(st => [st.key, new Map()]))
  for (const st of stages) {
    for (const f of st.formulas) {
      for (const d of new Set(out.deps[f] || [])) {
        const otra = dueño[d]
        if (otra && otra !== st.key) {
          if (!dep.get(st.key).has(otra)) dep.get(st.key).set(otra, new Set())
          dep.get(st.key).get(otra).add(d)
        }
      }
    }
  }

  // profundidad: las etapas sin dependencias van en la primera columna
  const prof = {}
  const d = k => {
    if (prof[k] != null) return prof[k]
    prof[k] = 1
    const ds = [...dep.get(k).keys()]
    prof[k] = ds.length ? 1 + Math.max(...ds.map(d)) : 1
    return prof[k]
  }
  stages.forEach(st => d(st.key))

  const cols = new Map()
  for (const st of stages) {
    const c = prof[st.key]
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c).push(st)
  }
  const maxCol = Math.max(...[...cols.keys()])

  const altoCol = c => cols.get(c).reduce((h, st) => h + stageH(st) + GAP_Y, -GAP_Y)
  const masAlta = Math.max(...[...cols.keys()].map(altoCol))

  for (const [c, sts] of cols) {
    let y = (masAlta - altoCol(c)) / 2
    for (const st of sts) {
      nodes.push({
        id: '@st:' + st.key, type: 'stageNode', position: { x: c * COL_W, y },
        data: { key: st.key, title: st.title, rows: st.formulas.map(row) },
      })
      y += stageH(st) + GAP_Y
    }
  }

  // la entrada alimenta a las etapas de la primera columna
  for (const st of cols.get(1) || []) {
    edges.push({ id: '@entrada->' + st.key, source: '@entrada', target: '@st:' + st.key,
      style: { strokeWidth: 1.5, opacity: .85 } })
  }
  // y entre etapas, con etiqueta de qué cruza
  for (const st of stages) {
    for (const [otra, via] of dep.get(st.key)) {
      const lbl = [...via].map(v => FORMULA_LABEL[v] || v).join(', ')
      edges.push({
        id: otra + '->' + st.key, source: '@st:' + otra, target: '@st:' + st.key,
        label: lbl.length > 26 ? via.size + ' valores' : lbl,
        style: { strokeWidth: 1.5, opacity: .85 },
      })
    }
  }

  // la tabla, al final
  const S = out.series
  if (S) {
    nodes.push({
      id: '@series', type: 'seriesNode', position: { x: (maxCol + 1) * COL_W, y: 0 },
      data: {
        title: 'Plan de pagos', cols: S.cols || [], rows: S.rows || [],
        error: S.error, labels: def.series?.labels || {},
      },
    })
    const ultima = stages.find(st => salida(st) === def.output)
    if (ultima) {
      edges.push({
        id: 'stage->series', source: '@st:' + ultima.key, target: '@series',
        label: FORMULA_LABEL[def.output] || def.output, style: { strokeWidth: 1.6 },
      })
    }
  }
  return { nodes, edges }
}
