import { FORMULA_LABEL } from './sheets.js'

// el crédito → (tasa ∥ al monto) → a la cuota → cuota → plan de pagos.
// Cada etapa es AUTOCONTENIDA: trae sus propios inputs y sus propias fórmulas.
//
// Ninguna columna está escrita a mano: la profundidad sale de las dependencias REALES del AST.
// Por eso `tasa` y `al monto` caen en paralelo (ninguna depende de la otra) y `a la cuota` cae
// después de `al monto` — porque el seguro de vida se calcula sobre lo financiado. Ese hecho
// no está declarado en ningún lado: lo dibuja la fórmula.
// El nodo mide 296 y la etiqueta del cable lleva nombre + valor ("valor a financiar
// 10.000.000"), así que la columna tiene que dejarle ~150px o se corta detrás del nodo.
const COL_W = 452
const GAP_Y = 34

export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {} } = opts
  const stages = def.stages || []

  const nodes = []
  const edges = []
  const host = def.inputHost || {}
  // a qué etapa pertenece cada input: su `appliesTo`, o el anfitrión si no es una etapa
  const etapaDe = a => host[a] || a

  const row = (name) => ({
    name, expr: def.formulas[name],
    status: out.res[name]?.status ?? 'skipped',
    value: out.res[name]?.status === 'ok' ? out.res[name].value : undefined,
  })
  // el alto cuenta TODO lo que hay adentro: inputs propios, el bloque de tasa, la sección de
  // fianza con su encabezado, y las fórmulas. Contar solo las fórmulas hacía que los nodos de
  // una misma columna se solaparan.
  const propios = k => (def.inputs || []).filter(i => etapaDe(i.appliesTo) === k)
  const stageH = st => {
    const ins = propios(st.key)
    const enBloque = st.rateBlock ? ins.filter(i => ['statedRate', 'compound'].includes(i.name)).length : 0
    const fianzas = ins.filter(i => i.appliesTo === 'guarantee').length
    return 40
      + (ins.length - enBloque - fianzas) * 21
      + (st.rateBlock ? 113 : 0)   // medido en el DOM, no estimado
      + (fianzas ? 22 + fianzas * 21 : 0)
      // con showRows:false igual queda UNA fila (la salida), no cero
      + (st.formulas.length ? 8 + (st.showRows === false ? 1 : st.formulas.length) * 22 : 0)
      + 12
  }
  const salida = st => (st && st.formulas.length ? st.formulas[st.formulas.length - 1] : null)

  // qué etapa depende de qué etapa. Cuenta las fórmulas Y los inputs: si una etapa lee un
  // input que vive en otra, eso ES una dependencia (y es lo que pone `el crédito` primero).
  const dueño = {}
  stages.forEach(st => st.formulas.forEach(f => (dueño[f] = st.key)))
  for (const i of def.inputs || []) dueño[i.name] = etapaDe(i.appliesTo)
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
  const sinFormulas = new Set(stages.filter(st => !st.formulas.length).map(st => st.key))
  const d = k => {
    if (prof[k] != null) return prof[k]
    if (sinFormulas.has(k)) return (prof[k] = 0)   // `el crédito` no calcula: va primero
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
        data: {
          key: st.key, title: st.title, rateBlock: !!st.rateBlock,
          showRows: st.showRows !== false,
          rows: st.formulas.map(row),
          inputs: (def.inputs || []).filter(i => etapaDe(i.appliesTo) === st.key),
        },
      })
      y += stageH(st) + GAP_Y
    }
  }

  // entre etapas, con etiqueta de qué cruza
  // La arista lleva NOMBRE + VALOR. Importa cuando la etapa origen no muestra sus fórmulas
  // (`showRows: false`): ahí el cable es el único lugar donde se ve el resultado.
  //
  // Un cable puede llevar varios valores (la cuota lee `financedAmount`, `totalGuarantee` y
  // `guaranteeUpfront` del monto). Rotular "3 valores" era honesto pero inútil: se rotula la
  // SALIDA de la etapa origen, que es la que interesa.
  const porNombre = Object.fromEntries((def.inputs || []).map(i => [i.name, i]))
  const fmt = v => (Math.abs(v) < 1 && v !== 0
    ? (v * 100).toFixed(4).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',') + '%'
    : Math.round(v).toLocaleString('es-CO'))
  const etiqueta = n => {
    const nom = FORMULA_LABEL[n] || porNombre[n]?.label || n
    const r = out.res[n]
    if (r?.status === 'ok') return nom + ' ' + fmt(r.value)          // es una fórmula
    const v = inputValues[n]                                        // es un input
    if (v === true) return nom + ' sí'
    if (v === false) return nom + ' no'
    return v === '' || v == null ? nom : nom + ' ' + fmt(Number(v))
  }
  for (const st of stages) {
    for (const [otra, via] of dep.get(st.key)) {
      const salidaOtra = salida(stages.find(x => x.key === otra))
      const cual = via.has(salidaOtra) ? salidaOtra : [...via][0]
      edges.push({
        id: otra + '->' + st.key, source: '@st:' + otra, target: '@st:' + st.key,
        label: etiqueta(cual) + (via.size > 1 ? ` +${via.size - 1}` : ''),
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
        // con `etiqueta` y no solo el nombre: todos los demás cables llevan su valor
        label: etiqueta(def.output), style: { strokeWidth: 1.6 },
      })
    }
  }
  return { nodes, edges }
}
