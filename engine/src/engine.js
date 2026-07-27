// Motor de evaluación: tokenizer → parser descendente → AST → intérprete.
// NO usa eval(). Es el mismo diseño que iría en el paquete `formula` de Go, y las cuatro hojas
// de sheets.js reproducen los .xlsm reales al peso (ver docs/VERIFICACION.md).

/* ───────────────────────── tokenizer ───────────────────────── */
export function tokenize(src) {
  const T = [], isD = c => c >= '0' && c <= '9', isA = c => /[A-Za-z_]/.test(c)
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (isD(c) || (c === '.' && isD(src[i + 1]))) {
      let j = i; while (j < src.length && (isD(src[j]) || src[j] === '.')) j++
      T.push({ t: 'num', v: parseFloat(src.slice(i, j)) }); i = j; continue
    }
    if (isA(c)) {
      let j = i; while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++
      const w = src.slice(i, j), lw = w.toLowerCase(); i = j
      if (lw === 'and' || lw === 'or' || lw === 'not') T.push({ t: 'op', v: lw })
      else if (lw === 'true') T.push({ t: 'bool', v: true })
      else if (lw === 'false') T.push({ t: 'bool', v: false })
      else T.push({ t: 'id', v: w })
      continue
    }
    if (c === '"') {
      let j = i + 1; while (j < src.length && src[j] !== '"') j++
      if (j >= src.length) throw new Error('texto sin cerrar')
      T.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue
    }
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '==', '!='].includes(two)) { T.push({ t: 'op', v: two }); i += 2; continue }
    if ('+-*/^(),<>'.includes(c)) { T.push({ t: 'op', v: c }); i++; continue }
    throw new Error(`carácter inesperado "${c}"`)
  }
  return T
}

/* ── parser · precedencia: or < and < not < comparación < +- < */ /* < ^ < unario < átomo ── */
export function parse(T) {
  let p = 0
  const peek = () => T[p]
  const isOp = v => { const t = T[p]; return t && t.t === 'op' && t.v === v }
  const eat = v => { if (!isOp(v)) throw new Error(`se esperaba "${v}"`); p++ }

  function or() { let l = and(); while (isOp('or')) { p++; l = { k: 'bin', o: 'or', l, r: and() } } return l }
  function and() { let l = nt(); while (isOp('and')) { p++; l = { k: 'bin', o: 'and', l, r: nt() } } return l }
  function nt() { if (isOp('not')) { p++; return { k: 'not', x: nt() } } return cmp() }
  function cmp() {
    const l = add()
    for (const o of ['<=', '>=', '==', '!=', '<', '>']) if (isOp(o)) { p++; return { k: 'bin', o, l, r: add() } }
    return l
  }
  function add() { let l = mul(); while (isOp('+') || isOp('-')) { const o = peek().v; p++; l = { k: 'bin', o, l, r: mul() } } return l }
  function mul() { let l = pw(); while (isOp('*') || isOp('/')) { const o = peek().v; p++; l = { k: 'bin', o, l, r: pw() } } return l }
  function pw() { const b = un(); if (isOp('^')) { p++; return { k: 'bin', o: '^', l: b, r: pw() } } return b }
  function un() { if (isOp('-')) { p++; return { k: 'neg', x: un() } } return atom() }
  function atom() {
    const t = peek()
    if (!t) throw new Error('expresión incompleta')
    if (t.t === 'num') { p++; return { k: 'num', v: t.v } }
    if (t.t === 'str') { p++; return { k: 'str', v: t.v } }
    if (t.t === 'bool') { p++; return { k: 'bool', v: t.v } }
    if (t.t === 'id') {
      p++
      if (isOp('(')) {
        p++; const args = []
        if (!isOp(')')) { args.push(or()); while (isOp(',')) { p++; args.push(or()) } }
        eat(')'); return { k: 'call', f: t.v.toLowerCase(), args }
      }
      return { k: 'ref', name: t.v }
    }
    if (t.t === 'op' && t.v === '(') { p++; const e = or(); eat(')'); return e }
    throw new Error(`token inesperado "${t.v}"`)
  }
  const ast = or()
  if (p < T.length) throw new Error(`sobra "${T[p].v}"`)
  return ast
}

/* ── financieras · convención de Excel pero SIEMPRE positivas (sin -PMT) ── */
export function pmt(r, n, pv) { if (n <= 0) return 0; return r === 0 ? pv / n : pv * r / (1 - Math.pow(1 + r, -n)) }
function balance(r, n, pv, k) {
  const P = pmt(r, n, pv)
  if (r === 0) return pv - P * k
  const f = Math.pow(1 + r, k)
  return pv * f - P * (f - 1) / r
}
export function ipmt(r, i, n, pv) { if (i < 1 || i > n) return 0; return balance(r, n, pv, i - 1) * r }
export function ppmt(r, i, n, pv) { if (i < 1 || i > n) return 0; return pmt(r, n, pv) - ipmt(r, i, n, pv) }

const FN = {
  round: (x, d) => { const p = Math.pow(10, d || 0); return Math.round(x * p) / p },
  ceil: Math.ceil, floor: Math.floor, abs: Math.abs, sqrt: Math.sqrt,
  min: Math.min, max: Math.max, pow: Math.pow,
  pmt, ipmt, ppmt,
}
const truthy = v => v === true || (typeof v === 'number' && v !== 0)
function num(v) {
  if (v === true) return 1
  if (v === false) return 0
  if (typeof v !== 'number' || !isFinite(v)) throw new Error('valor no numérico')
  return v
}

export function run(node, R) {
  switch (node.k) {
    case 'num': case 'str': case 'bool': return node.v
    case 'ref': return R(node.name)
    case 'neg': return -num(run(node.x, R))
    case 'not': return !truthy(run(node.x, R))
    case 'bin': {
      const o = node.o
      if (o === 'and') return truthy(run(node.l, R)) ? truthy(run(node.r, R)) : false
      if (o === 'or') return truthy(run(node.l, R)) ? true : truthy(run(node.r, R))
      const a = run(node.l, R), b = run(node.r, R)
      switch (o) {
        case '+': return num(a) + num(b)
        case '-': return num(a) - num(b)
        case '*': return num(a) * num(b)
        case '/': if (num(b) === 0) throw new Error('división por cero'); return num(a) / num(b)
        case '^': return Math.pow(num(a), num(b))
        case '==': return a === b
        case '!=': return a !== b
        case '<': return num(a) < num(b)
        case '>': return num(a) > num(b)
        case '<=': return num(a) <= num(b)
        case '>=': return num(a) >= num(b)
      }
      throw new Error('operador ' + o)
    }
    case 'call': {
      // if() es PEREZOSO a propósito: en la fila 1 de una serie, prev.x no existe
      // y no debe evaluarse nunca.
      if (node.f === 'if') {
        if (node.args.length !== 3) throw new Error('if(cond, a, b) lleva 3 argumentos')
        return truthy(run(node.args[0], R)) ? run(node.args[1], R) : run(node.args[2], R)
      }
      // lookup(tabla, clave, columna) — la tabla la resuelve el contexto.
      if (node.f === 'lookup') {
        const tbl = R('@table:' + node.args[0].name)
        const key = num(run(node.args[1], R))
        const col = node.args[2].v
        const row = tbl.rows.find(r => Number(r[tbl.key]) === key)
        if (!row) throw new Error(`la clave ${key} no está en la tabla`)
        return row[col]
      }
      const f = FN[node.f]
      if (!f) throw new Error(`función desconocida "${node.f}"`)
      return f.apply(null, node.args.map(a => num(run(a, R))))
    }
  }
  throw new Error('nodo inválido')
}

export function refsOf(n, out) {
  out = out || new Set()
  if (!n) return out
  if (n.k === 'ref') out.add(n.name)
  if (n.k === 'bin') { refsOf(n.l, out); refsOf(n.r, out) }
  if (n.k === 'neg' || n.k === 'not') refsOf(n.x, out)
  if (n.k === 'call') {
    // en lookup(tabla, clave, "col") el 1er y 3er argumento no son referencias a fórmulas
    if (n.f === 'lookup') refsOf(n.args[1], out)
    else n.args.forEach(a => refsOf(a, out))
  }
  return out
}

/* ───────────────────── evaluar una hoja ───────────────────── */
export const MAX_ROWS = 520

export function evalSheet(sheet, inputValues) {
  const res = {}, env = {}, order = [], asts = {}, deps = {}
  const tables = sheet.tables || {}

  for (const [k, v] of Object.entries(sheet.constants || {})) env[k] = v

  const missing = []
  for (const it of sheet.inputs || []) {
    const raw = inputValues[it.name]
    if (raw === undefined || raw === null || raw === '') { missing.push(it.name); continue }
    env[it.name] = it.type === 'bool' ? (raw === true || raw === 'true')
      : it.type === 'text' ? String(raw)
        : Number(raw)
  }

  for (const [name, expr] of Object.entries(sheet.formulas || {})) {
    try { asts[name] = parse(tokenize(expr)); deps[name] = [...refsOf(asts[name])] }
    catch (e) { res[name] = { status: 'error', reason: e.message }; deps[name] = [] }
  }

  const inProg = new Set()
  function resolve(name) {
    if (name.startsWith('@table:')) {
      const t = tables[name.slice(7)]
      if (!t) throw { msg: `tabla desconocida "${name.slice(7)}"` }
      return t
    }
    if (name in env) return env[name]
    if (!(name in asts)) {
      const isIn = (sheet.inputs || []).some(x => x.name === name)
      throw { miss: isIn ? name : null, msg: isIn ? null : `referencia desconocida "${name}"` }
    }
    compute(name)
    const r = res[name]
    if (r.status === 'ok') return r.value
    throw { up: name }
  }

  function compute(name) {
    if (name in res) return
    if (inProg.has(name)) { res[name] = { status: 'error', reason: 'ciclo: ' + name }; return }
    inProg.add(name)
    try {
      const v = run(asts[name], resolve)
      res[name] = { status: 'ok', value: v }
      env[name] = v
    } catch (e) {
      const pre = res[name]
      if (pre && pre.status === 'error' && /^ciclo/.test(pre.reason || '')) { /* conservar */ }
      else if (e && e.miss) res[name] = { status: 'skipped', reason: 'missing_input', missing: [e.miss] }
      else if (e && e.up) res[name] = { status: 'skipped', reason: 'upstream', dependsOn: [e.up] }
      else res[name] = { status: 'error', reason: (e && (e.msg || e.message)) || 'error' }
    }
    inProg.delete(name)
    if (!order.includes(name)) order.push(name)
  }

  for (const name of Object.keys(asts)) compute(name)

  /* ── la serie ── */
  let series = null
  const S = sheet.series
  if (S && S.name) {
    const cols = Object.entries(S.rows)
    let n = null, err = null
    try { n = Math.floor(num(run(parse(tokenize(S.n)), resolve))) }
    catch (e) {
      err = e && e.miss ? `falta el input "${e.miss}"`
        : e && e.up ? `depende de "${e.up}", que no se pudo calcular`
          : ((e && (e.msg || e.message)) || 'n inválido')
    }
    if (err) series = { name: S.name, error: err }
    else {
      const capped = n > MAX_ROWS
      n = Math.max(0, Math.min(n, MAX_ROWS))
      const cAst = {}, rows = []
      try { for (const [c, ex] of cols) cAst[c] = parse(tokenize(ex)) } catch (e) { err = e.message }
      if (err) series = { name: S.name, error: err }
      else {
        let prev = null
        for (let i = 1; i <= n; i++) {
          const row = {}
          const R = nm => {
            if (nm === 'i') return i
            if (nm === 'n') return n
            if (nm.startsWith('prev.')) {
              const k = nm.slice(5)
              if (!prev) throw { msg: `prev.${k} no existe en la fila 1 — envolvelo en if(i == 1, …, prev.${k})` }
              if (!(k in prev)) throw { msg: `prev.${k} no es una columna de la serie` }
              return prev[k]
            }
            if (nm in row) return row[nm]
            return resolve(nm)
          }
          try { for (const [c] of cols) row[c] = num(run(cAst[c], R)) }
          catch (e) {
            err = e && e.miss ? `falta el input "${e.miss}"`
              : e && e.up ? `depende de "${e.up}", que no se pudo calcular`
                : `fila ${i}: ${(e && (e.msg || e.message)) || 'error'}`
            break
          }
          rows.push(row); prev = row
        }
        series = { name: S.name, cols: cols.map(c => c[0]), rows, n, capped, error: err }
      }
    }
  }

  return { res, order, deps, missing, series }
}

/* ───────────────────── evaluar una política ───────────────────── */
// gate: TODAS deben pasar, corta en la primera que falla.
// outcome: PRIMERA rama que matchea gana.
export function evalPolicy(policy, inputValues) {
  const env = {}
  for (const [k, v] of Object.entries(policy.constants || {})) env[k] = v
  const missing = []
  for (const it of policy.inputs || []) {
    const raw = inputValues[it.name]
    if (raw === undefined || raw === null || raw === '') { missing.push(it.name); continue }
    env[it.name] = it.type === 'bool' ? (raw === true || raw === 'true') : Number(raw)
  }
  const R = nm => {
    if (nm in env) return env[nm]
    throw { miss: nm }
  }
  const derived = {}
  for (const [k, ex] of Object.entries(policy.derived || {})) {
    try { const v = run(parse(tokenize(ex)), R); env[k] = v; derived[k] = { status: 'ok', value: v } }
    catch (e) { derived[k] = { status: 'skipped', reason: e && e.miss ? `falta ${e.miss}` : 'error' } }
  }

  const evaluated = []
  let outcome = null, firedRule = null, explanation = null
  for (const rule of policy.gate.rules) {
    let pass = null, why = null
    try { pass = !!run(parse(tokenize(rule.test)), R) }
    catch (e) { why = e && e.miss ? `falta ${e.miss}` : 'error' }
    evaluated.push({ id: rule.id, label: rule.label, test: rule.test, pass, why })
    if (pass === false) {
      outcome = 'rechazado'; firedRule = rule.id
      explanation = interpolate(rule.fail, env)
      break // corta: las que siguen no se evalúan
    }
    if (pass === null) { outcome = 'indeterminado'; firedRule = rule.id; explanation = why; break }
  }

  const branches = []
  if (!outcome) {
    for (const b of policy.outcome.branches) {
      let hit = false
      try { hit = !!run(parse(tokenize(b.when)), R) } catch { hit = false }
      branches.push({ when: b.when, label: b.label, then: b.then, hit })
      if (hit && !outcome) { outcome = b.then; explanation = b.note || null }
    }
  }
  return { outcome, firedRule, explanation, evaluated, branches, derived, env, missing }
}

// {nombre} usa el formato por defecto; {nombre|1} fuerza 1 decimal — útil para porcentajes.
function interpolate(tpl, env) {
  return String(tpl || '').replace(/\{(\w+)(?:\|(\d+))?\}/g, (_, k, d) => {
    const v = env[k]
    return typeof v === 'number' ? fmtNum(v, d == null ? undefined : Number(d)) : String(v ?? `{${k}}`)
  })
}

/* ───────────────────── formato ───────────────────── */
export function fmtNum(v, dec) {
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (typeof v === 'string') return v
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  const a = Math.abs(v)
  const d = dec != null ? dec : (a >= 1000 ? 0 : a >= 1 ? 2 : 6)
  return v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })
}
