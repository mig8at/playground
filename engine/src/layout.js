// Disposición automática. No usa dagre: el grafo de una hoja es un DAG chico (18-26 nodos),
// así que alcanza con ordenar por PROFUNDIDAD (camino más largo desde una fuente) y apilar
// cada nivel en una columna. El resultado se lee de izquierda a derecha, que es el orden en
// que el motor calcula.

// COL_W tiene que ser MAYOR que el nodo más ancho (Entrada = 296) o las columnas se solapan.
const COL_W = 372
const ROW_H = 124

/* ───────── grafo de una hoja ───────── */
export function layoutSheet(def, out, opts = {}) {
  const { inputValues = {} } = opts
  const formulas = Object.keys(def.formulas || {})
  const inputNames = (def.inputs || []).map(i => i.name)
  const constants = Object.keys(def.constants || {})
  const tables = Object.keys(def.tables || {})
  const isFormula = new Set(formulas)
  const isInput = new Set(inputNames)

  // Profundidad contando SOLO dependencias entre fórmulas. Inputs y constantes son hojas
  // del grafo y viven todas en el nodo @entrada, así que no ocupan columna.
  const depth = {}
  const seen = new Set()
  function d(name) {
    if (depth[name] != null) return depth[name]
    if (seen.has(name)) return 1                 // ciclo: cortamos
    seen.add(name)
    const deps = (out.deps[name] || []).filter(x => isFormula.has(x))
    depth[name] = deps.length ? 1 + Math.max(...deps.map(d)) : 1
    return depth[name]
  }
  formulas.forEach(d)

  const cols = new Map()
  for (const name of formulas) {
    const c = depth[name] ?? 1
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c).push(name)
  }

  /* ── columna 0: el nodo de entrada + las tablas debajo ── */
  const entradaH = 62 + (inputNames.length + constants.length) * 21
  const tablesH = tables.reduce((h, t) => h + 62 + (def.tables[t].rows.length + 1) * 19 + 26, 0)
  const col0H = entradaH + (tables.length ? 26 + tablesH : 0)

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: {
      inputs: def.inputs || [], constants, values: inputValues, constValues: def.constants || {},
    },
  }]

  let ty = entradaH + 26
  for (const t of tables) {
    nodes.push({
      id: t, type: 'tableNode', position: { x: 0, y: ty },
      data: { name: t, table: def.tables[t] },
    })
    ty += 62 + (def.tables[t].rows.length + 1) * 19 + 26
  }

  /* ── columnas 1..N: las fórmulas ── */
  const maxRows = Math.max(...[...cols.values()].map(a => a.length), 1)
  const gridH = maxRows * ROW_H
  const yTop = (col0H - gridH) / 2       // centramos las fórmulas contra la altura de la entrada

  for (const [c, names] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    const offset = (maxRows - names.length) / 2
    names.forEach((name, i) => {
      const r = out.res[name]
      nodes.push({
        id: name, type: 'calcNode',
        position: { x: c * COL_W, y: yTop + (offset + i) * ROW_H },
        data: {
          name, kind: name === def.output ? 'output' : 'formula',
          expr: def.formulas[name],
          value: r?.status === 'ok' ? r.value : undefined,
          status: r?.status ?? 'skipped',
          why: r?.status === 'skipped'
            ? (r.reason === 'missing_input' ? `falta ${r.missing.join(', ')}` : `espera ${r.dependsOn.join(', ')}`)
            : r?.status === 'error' ? r.reason : null,
        },
      })
    })
  }

  /* ── aristas: fórmula→fórmula, tabla→fórmula, y entrada→fórmula solo si lee un INPUT.
        Las constantes no tiran arista: son ambiente y cablearlas era el hairball. ── */
  const edges = []
  const push = (source, target, extra = {}) => {
    const ok = out.res[target]?.status === 'ok'
    edges.push({
      id: `${source}->${target}`, source, target,
      animated: ok && target === def.output,
      style: { strokeWidth: ok ? 1.6 : 1, opacity: ok ? 1 : .3 },
      ...extra,
    })
  }
  for (const f of formulas) {
    const deps = new Set(out.deps[f] || [])
    for (const dep of deps) if (isFormula.has(dep)) push(dep, f)
    for (const t of new Set(out.tableDeps?.[f] || [])) push(t, f)
    const usedInputs = [...deps].filter(x => isInput.has(x))
    if (usedInputs.length) {
      const lbl = usedInputs.join(', ')
      push('@entrada', f, { label: lbl.length > 26 ? `${usedInputs.length} inputs` : lbl })
    }
  }
  return { nodes, edges }
}

/* ───────── el mismo grafo, pero AGRUPADO POR ETAPA ─────────
   Cada grupo es un nodo con sus fórmulas adentro. El documento no cambia: `groups` es
   metadato de presentación y el motor lo ignora por completo. */
export function layoutSheetGrouped(def, out, opts = {}) {
  const { inputValues = {} } = opts
  const groups = def.groups || {}
  const names = Object.keys(groups)
  if (!names.length) return layoutSheet(def, out, opts)

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
  const tablesH = tables.reduce((h, t) => h + 62 + (def.tables[t].rows.length + 1) * 19 + 26, 0)
  const col0H = entradaH + (tables.length ? 26 + tablesH : 0)
  const gH = g => 54 + groups[g].length * 22 + 10

  const nodes = [{
    id: '@entrada', type: 'inputsNode', position: { x: 0, y: 0 },
    data: { inputs: def.inputs || [], constants, values: inputValues, constValues: def.constants || {} },
  }]
  let ty = entradaH + 26
  for (const t of tables) {
    nodes.push({ id: t, type: 'tableNode', position: { x: 0, y: ty }, data: { name: t, table: def.tables[t] } })
    ty += 62 + (def.tables[t].rows.length + 1) * 19 + 26
  }

  const colH = {}
  for (const [c, gs] of cols) colH[c] = gs.reduce((h, g) => h + gH(g) + 34, -34)
  const tallest = Math.max(col0H, ...Object.values(colH))

  for (const [c, gs] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    let y = (tallest - colH[c]) / 2
    for (const g of gs) {
      nodes.push({
        id: '@g:' + g, type: 'groupNode',
        position: { x: c * COL_W, y },
        data: {
          title: g,
          hasOutput: groups[g].includes(def.output),
          rows: groups[g].map(f => ({
            name: f, expr: def.formulas[f], isOutput: f === def.output,
            status: out.res[f]?.status ?? 'skipped',
            value: out.res[f]?.status === 'ok' ? out.res[f].value : undefined,
          })),
        },
      })
      y += gH(g) + 34
    }
  }

  const edges = []
  const ok = g => groups[g].some(f => out.res[f]?.status === 'ok')
  for (const g of names) {
    for (const [dg, via] of gdeps.get(g)) {
      const lbl = [...via].join(', ')
      edges.push({
        id: `${dg}->${g}`, source: '@g:' + dg, target: '@g:' + g,
        label: lbl.length > 26 ? `${via.size} valores` : lbl,
        animated: groups[g].includes(def.output) && ok(g),
        style: { strokeWidth: ok(g) ? 1.6 : 1, opacity: ok(g) ? 1 : .3 },
      })
    }
    for (const t of gtables.get(g)) {
      edges.push({ id: `${t}->${g}`, source: t, target: '@g:' + g, style: { strokeWidth: 1.4 } })
    }
    if (ginputs.get(g).size) {
      const lbl = [...ginputs.get(g)].join(', ')
      edges.push({
        id: `@entrada->${g}`, source: '@entrada', target: '@g:' + g,
        label: lbl.length > 26 ? `${ginputs.get(g).size} inputs` : lbl,
        style: { strokeWidth: 1.4, opacity: .85 },
      })
    }
  }
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
