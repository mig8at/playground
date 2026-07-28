// Disposición automática. No usa dagre: el grafo de una hoja es un DAG chico (18-26 nodos),
// así que alcanza con ordenar por PROFUNDIDAD (camino más largo desde una fuente) y apilar
// cada nivel en una columna. El resultado se lee de izquierda a derecha, que es el orden en
// que el motor calcula.

// COL_W tiene que ser MAYOR que el nodo más ancho (Entrada = 296) o las columnas se solapan.
const COL_W = 372
const ROW_H = 124

/* ───────── grafo de una hoja, agrupado por ETAPA ─────────
   Cada grupo es un nodo con sus fórmulas adentro. El documento no cambia: `groups` es
   metadato de presentación y el motor lo ignora por completo.
   Si una hoja no declara `groups`, cada fórmula es su propio grupo. */
export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {}, policy = null, verdict = null } = opts
  const groups = Object.keys(def.groups || {}).length
    ? def.groups
    : Object.fromEntries(Object.keys(def.formulas || {}).map(f => [f, [f]]))
  const names = Object.keys(groups)

  const groupOf = {}
  for (const [g, fs] of Object.entries(groups)) fs.forEach(f => groupOf[f] = g)
  const inputNames = new Set((def.inputs || []).map(i => i.name))
  const constants = Object.keys(def.constants || {})
  const tables = Object.keys(def.tables || {})

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
    for (const t of out.tableDeps?.[f] || []) gtables.get(g).add(t)
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

  const entradaH = 62 + ((def.inputs || []).length + constants.length) * 21
  const tablesH = tables.reduce((h, t) => h + 60 + (def.tables[t].rows.length + 1) * 23 + 26, 0)
  const col0H = entradaH + (tables.length ? 26 + tablesH : 0)
  const gH = g => 54 + groups[g].length * 22 + 10

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: { inputs: def.inputs || [], constants, values: inputValues, constValues: def.constants || {} },
  }]
  let ty = entradaH + 26
  for (const t of tables) {
    nodes.push({ id: t, type: 'tableNode', position: { x: 0, y: ty }, data: { name: t, table: def.tables[t] } })
    ty += 60 + (def.tables[t].rows.length + 1) * 23 + 26
  }

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
  for (const t of tables) {
    edges.push({ id: t + '->calc', source: t, target: '@calc', style: { strokeWidth: 1.4, opacity: .8 } })
  }

  /* ═══ ETAPA 3 · qué se hace con los números ═══
     Dos cosas las produce el motor (plan de pagos y veredicto); el resto no. Ese corte
     es la frontera del servicio, y por eso el último nodo va apagado. */
  const nx = 2 * COL_W
  const next = []

  const S = out.series
  if (S && S.rows?.length) {
    const first = S.rows[0], last = S.rows[S.rows.length - 1]
    const money = v => Math.round(v).toLocaleString('es-CO')
    // La columna que interesa es la que paga el CLIENTE. En alta-fleet hay vehiclePayment,
    // policyPayment y totalPayment: agarrar la primera que matcheara mostraba la del vehículo
    // (plana) y ocultaba que el total baja en el mes 11.
    const pay = S.cols.find(c => /^total/i.test(c))
      || S.cols.find(c => /payment|cuota|rent/i.test(c))
      || S.cols[S.cols.length - 1]
    next.push({
      title: 'Plan de pagos', tag: S.name, tone: 'plan', action: 'series',
      rows: [
        { k: 'filas', v: S.rows.length },
        { k: '1ª ' + pay, v: money(first[pay]) },
        { k: 'última ' + pay, v: money(last[pay]) },
      ],
      detail: first[pay] !== last[pay] ? 'La cuota NO es plana: cambia a lo largo del plan.' : null,
    })
  }

  if (policy && verdict) {
    next.push({
      title: 'Política · ' + policy.label.split('·').pop().trim(), tag: 'veredicto',
      tone: verdict.outcome === 'aprobado' ? 'ok' : verdict.outcome === 'rechazado' ? 'no' : 'mid',
      headline: verdict.outcome, action: 'policy',
      detail: verdict.explanation, rows: [],
    })
  } else {
    next.push({
      title: 'Política', tag: 'sin definir', tone: 'mid', rows: [],
      detail: 'Esta hoja no tiene política. El cálculo igual corre: son recursos separados.',
    })
  }

  // el alto depende del contenido: con la nota de "cuota no plana" el nodo crece ~40px
  // y con espaciado fijo se montaba sobre el de abajo
  const nH = d => 46 + (d.headline ? 27 : 0) + (d.rows?.length || 0) * 20
    + (d.detail ? 44 : 0) + (d.action ? 34 : 0)
  let ny = 0
  next.forEach((d, i) => {
    nodes.push({ id: '@next' + i, type: 'nextNode', position: { x: nx, y: ny }, data: d })
    ny += nH(d) + 30
    edges.push({
      id: 'out->next' + i, source: '@calc', target: '@next' + i,
      label: def.output, style: { strokeWidth: 1.5, opacity: .8 },
    })
  })

  nodes.push({
    id: '@outside', type: 'nextNode', position: { x: nx + COL_W, y: 0 },
    data: {
      kind: 'outside',
      items: ['generar y firmar documentos', 'crear el crédito en el core',
              'guardar la solicitud en la BD', 'pintar la pantalla al cliente'],
    },
  })
  next.forEach((_, i) => edges.push({
    id: 'next' + i + '->outside', source: '@next' + i, target: '@outside',
    style: { strokeWidth: 1, opacity: .25 },
  }))

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

/* ───────── árbol de una política ─────────
   El gate corre en cadena y CORTA en la primera que falla — por eso va en fila,
   con una única salida "rechazado" abajo. Las ramas del outcome abanican al final. */
export function layoutPolicy(policy, verdict, opts = {}) {
  const rules = policy.gate.rules
  const nodes = [], edges = []
  const firedIdx = rules.findIndex(r => r.id === verdict.firedRule)
  const cut = firedIdx >= 0 ? firedIdx : rules.length

  nodes.push({
    id: '@risk', type: 'riskNode', position: { x: -320, y: -30 },
    data: {
      fromSheetName: opts.fromSheetName || 'weeklyRent',
      fromSheetValue: opts.fromSheetValue,
      derived: verdict.derived,
    },
  })
  edges.push({
    id: '@risk->' + rules[0].id, source: '@risk', target: rules[0].id,
    style: { strokeWidth: 1.4, opacity: .85 },
  })

  rules.forEach((rule, i) => {
    const ev = verdict.evaluated.find(e => e.id === rule.id)
    const state = !ev ? 'skip' : ev.pass === true ? 'pass' : ev.pass === false ? 'fail' : 'skip'
    nodes.push({
      id: rule.id, type: 'ruleNode',
      position: { x: i * 250, y: 0 },
      data: { ...rule, state, env: verdict.env },
    })
    if (i > 0) {
      const live = i <= cut
      edges.push({
        id: `${rules[i - 1].id}->${rule.id}`, source: rules[i - 1].id, target: rule.id,
        label: 'pasa', animated: live,
        style: { strokeWidth: live ? 1.8 : 1, opacity: live ? 1 : .25 },
      })
    }
  })

  nodes.push({
    id: '@reject', type: 'endNode',
    position: { x: Math.max(0, (rules.length - 1) * 250 / 2), y: 230 },
    data: { kind: 'reject', hit: verdict.outcome === 'rechazado', explanation: verdict.explanation },
  })
  rules.forEach((rule, i) => {
    const hit = rule.id === verdict.firedRule
    edges.push({
      id: `${rule.id}->rej`, source: rule.id, target: '@reject',
      label: 'no pasa', animated: hit,
      style: { strokeWidth: hit ? 2 : 1, opacity: hit ? 1 : .12 },
    })
  })

  const bx = rules.length * 250
  policy.outcome.branches.forEach((b, i) => {
    const br = verdict.branches[i]
    const hit = !!br?.hit && verdict.outcome === b.then
    nodes.push({
      id: '@out' + i, type: 'endNode',
      position: { x: bx, y: (i - 1) * 132 },
      data: { kind: 'outcome', then: b.then, label: b.label, note: b.note, hit, reached: cut === rules.length },
    })
    edges.push({
      id: `gate->out${i}`, source: rules[rules.length - 1].id, target: '@out' + i,
      animated: hit, style: { strokeWidth: hit ? 2 : 1, opacity: hit ? 1 : .18 },
    })
  })
  return { nodes, edges }
}
