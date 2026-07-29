import { DERIVED_PERIOD_CONSTANTS } from './sheets.js'

// Disposición automática. No usa dagre: el grafo de una hoja es un DAG chico (18-26 nodos),
// así que alcanza con ordenar por PROFUNDIDAD (camino más largo desde una fuente) y apilar
// cada nivel en una columna. El resultado se lee de izquierda a derecha, que es el orden en
// que el motor calcula.

// COL_W tiene que ser MAYOR que el nodo más ancho (Entrada = 316) o las columnas se solapan.
const COL_W = 380
const ROW_H = 124

/* ───────── grafo de una hoja, agrupado por ETAPA ─────────
   Cada grupo es un nodo con sus fórmulas adentro. El documento no cambia: `groups` es
   metadato de presentación y el motor lo ignora por completo.
   Si una hoja no declara `groups`, cada fórmula es su propio grupo. */
export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {} } = opts
  const groups = Object.keys(def.groups || {}).length
    ? def.groups
    : Object.fromEntries(Object.keys(def.formulas || {}).map(f => [f, [f]]))
  const names = Object.keys(groups)

  const groupOf = {}
  for (const [g, fs] of Object.entries(groups)) fs.forEach(f => groupOf[f] = g)
  const inputNames = new Set((def.inputs || []).map(i => i.name))
  const constants = Object.keys(def.constants || {}).filter(c => !DERIVED_PERIOD_CONSTANTS.includes(c))
  const tables = []

  // qué grupo depende de qué grupo, y por cuál fórmula cruza
  const gdeps = new Map(names.map(g => [g, new Map()]))
  const gtables = new Map(names.map(g => [g, new Set()]))
  const ginputs = new Map(names.map(g => [g, new Set()]))
  for (const [f, g] of Object.entries(groupOf)) {
    for (const dep of new Set(out.deps[f] || [])) {
      const dg = groupOf[dep]
      if (dg && dg !== g) {
        if (!gdeps.get(g).has(dg)) gdeps.get(g).set(dg, new Set())
        gdeps.get(g).get(dg).add(dep)
      } else if (inputNames.has(dep)) ginputs.get(g).add(dep)
    }

  }

  const depth = {}, seen = new Set()
  function d(g) {
    if (depth[g] != null) return depth[g]
    if (seen.has(g)) return 1
    seen.add(g)
    const ds = [...gdeps.get(g).keys()]
    depth[g] = ds.length ? 1 + Math.max(...ds.map(d)) : 1
    return depth[g]
  }
  names.forEach(d)

  const cols = new Map()
  for (const g of names) {
    const c = depth[g]
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c).push(g)
  }

  // los inputs van agrupados en secciones, así que el alto suma también los encabezados
  const nGroups = Object.keys(def.inputGroups || {}).length
  // la tasa ya no es una fila: es el bloque RateBlock (~78px con su leyenda y la E.A.)
  const nRateInputs = 2   // statedRate y compound viven en el bloque, no en la lista
  const col0H = 62 + ((def.inputs || []).length - nRateInputs + constants.length) * 21
    + (nGroups + 1) * 22 + 104
  const gH = g => 54 + groups[g].length * 22 + 10

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: {
      inputs: def.inputs || [], constants, values: inputValues,
      constValues: def.constants || {}, periods: def.periods || {},
      inputGroups: def.inputGroups || null,
    },
  }]

  /* ── UN nodo de cálculo, con las etapas como secciones ── */
  const calcNode = {
    id: '@calc', type: 'groupNode', position: { x: COL_W, y: 0 },
    data: {
      total: Object.keys(def.formulas || {}).length,
      sections: names
        .sort((a, b) => depth[a] - depth[b])
        .map(g => ({
          title: g,
          rows: groups[g].map(f => ({
            name: f, expr: def.formulas[f], isOutput: f === def.output,
            status: out.res[f]?.status ?? 'skipped',
            value: out.res[f]?.status === 'ok' ? out.res[f].value : undefined,
          })),
        })),
    },
  }
  nodes.push(calcNode)

  // centramos entrada y cálculo entre sí
  const calcH = 44 + names.length * 24 + Object.keys(def.formulas || {}).length * 22
  calcNode.position.y = Math.max(0, (col0H - calcH) / 2)
  if (calcH > col0H) nodes[0].position.y = (calcH - col0H) / 2

  const edges = []
  const allInputs = new Set()
  for (const g of names) for (const x of ginputs.get(g)) allInputs.add(x)
  if (allInputs.size) {
    const lbl = [...allInputs].join(', ')
    edges.push({
      id: '@entrada->calc', source: '@entrada', target: '@calc',
      label: lbl.length > 30 ? `${allInputs.size} inputs` : lbl,
      style: { strokeWidth: 1.5, opacity: .85 },
    })
  }

  /* ═══ ETAPA 3 · qué se hace con los números ═══
     Dos cosas las produce el motor (plan de pagos y veredicto); el resto no. Ese corte
     es la frontera del servicio, y por eso el último nodo va apagado. */
  const nx = 2 * COL_W
  const next = []

  // La tabla va como NODO, no como resumen: en el simulador la tabla ES la salida.
  const S = out.series
  let seriesH = 0
  if (S) {
    nodes.push({
      id: '@series', type: 'seriesNode', position: { x: nx, y: 0 },
      data: { title: 'Plan de pagos · ' + S.name, cols: S.cols || [], rows: S.rows || [], error: S.error },
    })
    edges.push({
      id: 'calc->series', source: '@calc', target: '@series',
      label: def.output, style: { strokeWidth: 1.5, opacity: .8 },
    })
    seriesH = Math.min(430, 44 + 26 + (S.rows?.length || 1) * 20) + 30
  }


  // el alto depende del contenido: con la nota de "cuota no plana" el nodo crece ~40px
  // y con espaciado fijo se montaba sobre el de abajo
  const nH = d => 46 + (d.headline ? 27 : 0) + (d.rows?.length || 0) * 20
    + (d.detail ? 44 : 0) + (d.action ? 34 : 0)
  let ny = seriesH
  next.forEach((d, i) => {
    nodes.push({ id: '@next' + i, type: 'nextNode', position: { x: nx, y: ny }, data: d })
    ny += nH(d) + 30
    edges.push({
      id: 'out->next' + i, source: '@calc', target: '@next' + i,
      label: def.output, style: { strokeWidth: 1.5, opacity: .8 },
    })
  })

  nodes.push({
    id: '@outside', type: 'nextNode', position: { x: nx + 600, y: 0 },
    data: {
      kind: 'outside',
      items: ['juzgar el resultado con la política de riesgo', 'generar y firmar documentos',
              'crear el crédito en el core', 'guardar la solicitud en la BD'],
    },
  })
  next.forEach((_, i) => edges.push({
    id: 'next' + i + '->outside', source: '@next' + i, target: '@outside',
    style: { strokeWidth: 1, opacity: .25 },
  }))
  if (S) edges.push({ id: 'series->outside', source: '@series', target: '@outside',
    style: { strokeWidth: 1, opacity: .25 } })

  /* ═══ rótulos de las tres zonas ═══ */
  const top = Math.min(...nodes.filter(n => n.type !== 'zoneNode').map(n => n.position.y)) - 62
  ;[
    { x: 0, n: '1', title: 'Entrada', sub: 'datos · editable', tone: 'in' },
    { x: COL_W, n: '2', title: 'Cálculo', sub: 'fórmulas por etapa', tone: 'calc' },
    { x: nx, n: '3', title: 'Qué sigue', sub: 'con los números ya calculados', tone: 'next' },
  ].forEach((z, i) => nodes.push({
    id: '@zone' + i, type: 'zoneNode', position: { x: z.x, y: top }, data: z,
    draggable: false, selectable: false,
  }))

  return { nodes, edges }
}
