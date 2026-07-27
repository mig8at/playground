// Disposición automática. No usa dagre: el grafo de una hoja es un DAG chico (18-26 nodos),
// así que alcanza con ordenar por PROFUNDIDAD (camino más largo desde una fuente) y apilar
// cada nivel en una columna. El resultado se lee de izquierda a derecha, que es el orden en
// que el motor calcula.

const COL_W = 268
const ROW_H = 118

/* ───────── grafo de una hoja ───────── */
export function layoutSheet(def, out, opts = {}) {
  const { showConstants = false, inputValues = {} } = opts
  const formulas = Object.keys(def.formulas || {})
  const inputs = (def.inputs || []).map(i => i.name)
  const constants = Object.keys(def.constants || {})
  const tables = Object.keys(def.tables || {})

  const isFormula = new Set(formulas)
  const visible = new Set([...formulas, ...inputs, ...tables])
  if (showConstants) constants.forEach(c => visible.add(c))

  // profundidad = 1 + la mayor de sus dependencias visibles
  const depth = {}
  inputs.forEach(n => depth[n] = 0)
  constants.forEach(n => depth[n] = 0)
  tables.forEach(n => depth[n] = 0)
  const seen = new Set()
  function d(name) {
    if (depth[name] != null) return depth[name]
    if (seen.has(name)) return 0            // ciclo: cortamos
    seen.add(name)
    const deps = (out.deps[name] || []).filter(x => visible.has(x) || isFormula.has(x))
    const v = deps.length ? 1 + Math.max(...deps.map(d)) : 1
    depth[name] = v
    return v
  }
  formulas.forEach(d)

  // agrupar por columna, ordenando cada una por el orden de declaración
  const cols = new Map()
  const declOrder = [...inputs, ...tables, ...constants, ...formulas]
  for (const name of declOrder) {
    if (!visible.has(name)) continue
    const c = depth[name] ?? 0
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c).push(name)
  }

  const maxRows = Math.max(...[...cols.values()].map(a => a.length), 1)
  const nodes = []
  for (const [c, names] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    const offset = (maxRows - names.length) / 2
    names.forEach((name, i) => {
      const kind = isFormula.has(name) ? (name === def.output ? 'output' : 'formula')
        : tables.includes(name) ? 'table'
          : inputs.includes(name) ? 'input' : 'const'
      const r = out.res[name]
      nodes.push({
        id: name,
        type: kind === 'table' ? 'tableNode' : 'calcNode',
        position: { x: c * COL_W, y: (offset + i) * ROW_H },
        data: {
          name, kind,
          expr: def.formulas?.[name] ?? null,
          table: def.tables?.[name] ?? null,
          value: kind === 'const' ? def.constants[name]
            : kind === 'input' ? inputValues[name]
              : r?.status === 'ok' ? r.value : undefined,
          status: kind === 'formula' || kind === 'output' ? (r?.status ?? 'skipped') : 'ok',
          why: r?.status === 'skipped'
            ? (r.reason === 'missing_input' ? `falta ${r.missing.join(', ')}` : `espera ${r.dependsOn.join(', ')}`)
            : r?.status === 'error' ? r.reason : null,
        },
      })
    })
  }

  const edges = []
  for (const f of formulas) {
    for (const dep of new Set(out.deps[f] || [])) {
      if (!visible.has(dep)) continue
      const ok = out.res[f]?.status === 'ok'
      edges.push({
        id: `${dep}->${f}`, source: dep, target: f,
        animated: ok && f === def.output,
        style: { strokeWidth: ok ? 1.6 : 1, opacity: ok ? 1 : .35 },
      })
    }
  }
  return { nodes, edges }
}

/* ───────── árbol de una política ─────────
   El gate corre en cadena y CORTA en la primera que falla — por eso va en fila,
   con una única salida "rechazado" abajo. Las ramas del outcome abanican al final. */
export function layoutPolicy(policy, verdict) {
  const rules = policy.gate.rules
  const nodes = [], edges = []
  const firedIdx = rules.findIndex(r => r.id === verdict.firedRule)
  const cut = firedIdx >= 0 ? firedIdx : rules.length

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
