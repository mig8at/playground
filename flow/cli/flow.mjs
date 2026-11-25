#!/usr/bin/env node
// bin/flow — manejar Flow por consola (2026-11-25): cargar entidades reales de una base (por bin/pg, sólo lectura) y
// cambiar lo que se ve. Le habla a la app abierta por su servidor (:5252, server/bridge.mjs); si no hay ninguna, abre
// la de Cockpit. Para que lo haga Claude y Miguel sólo lo mire.
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE = process.env.FLOW_URL || 'http://127.0.0.1:5252'
const PRODUCT = { credito: 'credito', credit: 'credito', renting: 'renting', rto: 'rto', consumo: 'consumo' }

const USAGE = `bin/flow — Flow por consola (le habla a la app abierta; si no hay, abre la de Cockpit)

  bin/flow status [--json]                       qué entidades tiene la app y cuál está elegida
  bin/flow branches --target qa --lender 149     sucursales activas con esa entidad (id, hash, comercio)
  bin/flow import --target qa --branch <id|hash> --lender 149[,24,…] [--select <nombre>] [--replace]
                                                 trae cada entidad REAL de esa sucursal: línea, categorías activas
                                                 (política titular inicial), tramos, reglas de la sucursal, producto
                                                 y, si es delegada, su ficha (delegated_origination_profiles).
                                                 --replace borra antes las que tenía la app. Sólo lectura de la base.
  bin/flow add --name <n> --rt 2|4|1|0 [--product credito|renting|rto] [--engine 0|1] [--radica 0|1] [--days 5,10]
                                                 una entidad de ejemplo, sin base
  bin/flow select <nombre> · unselect · remove <nombre> · clear
  bin/flow delegated <nombre> [--engine 0|1] [--radica 0|1] [--days 2,16] [--bond 10] [--bond-type anticipada|mensual]
  bin/flow client [--score 800] [--negatives 0] [--arrears 0] [--inquiries 2] [--history 24] [--occupation empleado|independiente|pensionado|desempleado]
                  [--continuity <3m|3m|6m|12m] [--age 41] [--gender F|M] [--income 5400000] [--amount 1200000]
                                                 el cliente de la solicitud (lo que contestan las centrales) y el monto
  bin/flow open                                  la trae al frente en Cockpit

  --target: local · dev · qa · staging · prod (prod por Redash, sólo lectura). Sin --target, qa.`

function parse(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++ } }
    else out._.push(a)
  }
  return out
}
const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 32 << 20 }, (e, stdout, stderr) => (e ? reject(new Error((stderr || e.message).trim())) : resolve(stdout))))
const ids = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { if (!/^\d+$/.test(s)) throw new Error('id no numérico: ' + s); return Number(s) })
const TARGETS = new Set(['local', 'dev', 'qa', 'staging', 'prod'])

async function sql(target, query) {
  const out = await run(path.join(ROOT, 'bin', 'pg'), ['sql', '--target', target, '--json', '--query', query])
  return JSON.parse(out).rows || []
}

async function http(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

// Que haya una app escuchando: si no, la abre en Cockpit y espera a que se conecte.
async function ensureApp() {
  const ok = async () => { try { const r = await http('GET', '/api/report'); return r.data.apps > 0 } catch { return false } }
  if (await ok()) return
  await run(path.join(ROOT, 'bin', 'cockpit'), ['open', 'flow']).catch(() => {})
  for (let i = 0; i < 40; i++) { if (await ok()) return; await new Promise(r => setTimeout(r, 500)) }
  throw new Error('no hay ninguna app de Flow conectada: abrila en Cockpit (bin/cockpit open flow)')
}

async function send(commands) {
  await ensureApp()
  const r = await http('POST', '/api/commands', { commands })
  if (r.status !== 200) throw new Error(r.data.error || 'la app no contestó')
  const first = r.data.results[0] || []
  if (r.data.timedOut && !first.length) throw new Error('la app no contestó a tiempo')
  const bad = first.filter(x => !x.ok)
  for (const x of first) console.log(x.ok ? `  ✓ ${x.type}${x.name ? ' · ' + x.name : ''}${x.selected ? ' · ' + x.selected : ''}${x.removed ? ' · ' + [].concat(x.removed).join(', ') : ''}` : `  ✗ ${x.type}: ${x.error}`)
  if (r.data.apps > 1) console.log(`  (${r.data.apps} apps abiertas: cada una guarda su propio escenario)`)
  if (bad.length) process.exitCode = 1
}

const delegatedFlags = (o) => {
  const d = {}
  if (o.engine !== undefined) d.usesQuotaEngine = String(o.engine) === '1'
  if (o.radica !== undefined) d.formalization = String(o.radica) === '1'
  if (o.days) d.paymentDays = ids(o.days)
  if (o.bond) d.bondPct = Number(o.bond)
  if (o['bond-type']) d.bondType = String(o['bond-type']).toLowerCase() === 'mensual' ? 'mensual' : 'anticipada'
  return d
}

async function branchOf(target, ref) {
  const where = /^\d+$/.test(ref) ? `b.id = ${Number(ref)}` : /^[a-z0-9]{4,16}$/i.test(ref) ? `b.hash = '${ref}'` : null
  if (!where) throw new Error('--branch es un id o un hash de sucursal')
  const rows = await sql(target, `SELECT b.id, b.name, b.hash, b.status, a.id AS allied_id, a.name AS allied_name, a.country_id FROM allied_branches b JOIN allieds a ON a.id = b.allied_id WHERE ${where} LIMIT 1`)
  if (!rows.length) throw new Error('no existe la sucursal ' + ref + ' en ' + target)
  return rows[0]
}

// Lo mismo que leía el importador del trazador (retirado el 2026-10-13), más el producto y la ficha delegada. Las
// categorías: sólo ACTIVAS y con regla de política titular inicial (tipo 1), que es lo que evalúa el motor.
async function lenderPhoto(target, branch, lender) {
  const [item] = await sql(target, `SELECT l.id, l.name, l.response_type, l.product, l.country_id, l.status, lbab.document_types, clbl.min_amount, clbl.max_amount, NULL AS max_fee_number, clbl.fee_numbers, clbl.rate, d.score AS min_score, d.negative_historical_last_12_months AS max_negatives, d.consulted_last_6_months AS max_inquiries, d.time_finance_sector AS min_maturation, d.allow_0_score FROM lenders l JOIN lenders_by_allied_branches lbab ON lbab.lender_id = l.id AND lbab.allied_branch_id = ${branch.id} LEFT JOIN credit_line_by_lenders clbl ON clbl.lender_id = l.id AND clbl.status = 1 LEFT JOIN lender_datacredito_rules d ON d.lender_id = l.id AND d.allied_branch_id = ${branch.id} WHERE l.id = ${lender} ORDER BY clbl.sort, clbl.id LIMIT 1`)
  if (!item) throw new Error(`la entidad ${lender} no está en la sucursal ${branch.id} (${target})`)
  const [profiles, tramos, groupRules, delegatedRows] = await Promise.all([
    sql(target, `SELECT c.id, c.name, c.loan_limit, c.already_used_loan, c.min_initial_fee, c.max_fee_number, c.max_amount, c.\`order\` AS priority, r.occupation, r.min_age, r.max_age, r.monthly_income, r.gender, r.negative_reports_last_12_months, r.current_delinquencies, r.financial_history_length, r.min_score, r.employment_continuity, r.consulted_last_6_months FROM lender_users_categories c JOIN lender_users_category_rules r ON r.lender_users_category_id = c.id AND r.lender_id = c.lender_id AND r.lender_users_category_type_id = 1 WHERE c.lender_id = ${lender} AND c.active = 1 ORDER BY c.\`order\`, c.id`),
    sql(target, `SELECT min_amount, max_amount, max_fee_number, mandatory_fee_number FROM creditop_x_conditions_by_amount_by_lender WHERE lender_id = ${lender} ORDER BY min_amount, max_amount, id`),
    sql(target, `SELECT gr.id AS group_id, gr.rule_name, lr.name, lr.specific_table, lr.\`column\`, lr.operator, lr.value FROM group_rules gr JOIN lender_rules lr ON lr.group_rule_id = gr.id WHERE gr.allied_branch_id = ${branch.id} AND lr.status = 1 ORDER BY gr.id, lr.id`),
    Number(item.response_type) === 4 ? sql(target, `SELECT inputs_source, forced_bond_type, payment_days, formalization FROM delegated_origination_profiles WHERE lender_id = ${lender} LIMIT 1`) : Promise.resolve([]),
  ])
  let delegated
  if (delegatedRows[0]) {
    const d = delegatedRows[0]
    let days = []; try { days = JSON.parse(d.payment_days) } catch { days = String(d.payment_days || '').match(/\d+/g)?.map(Number) || [] }
    delegated = { usesQuotaEngine: d.inputs_source === 'creditop_x_pre_approval', formalization: !!d.formalization, paymentDays: days.length ? days : undefined,
      bondType: d.forced_bond_type ? (String(d.forced_bond_type).toLowerCase() === 'mensual' ? 'mensual' : 'anticipada') : undefined }
  }
  const payload = { comercio: { id: branch.allied_id, name: branch.allied_name, country_id: branch.country_id }, sucursal: { id: branch.id, name: branch.name }, item, profiles, tramos, groupRules }
  return { payload, delegated, summary: `${item.name} (#${item.id}, rt${item.response_type}, ${item.product}) · ${profiles.length} categorías · ${tramos.length} tramos${delegated ? ` · ficha: ${delegated.usesQuotaEngine ? 'motor' : 'su API'}${delegated.formalization ? ', radica' : ''}` : ''}` }
}

async function main2status() { process.argv = [process.argv[0], process.argv[1], 'status']; return main() }

async function main() {
  const o = parse(process.argv.slice(2))
  const cmd = o._[0]
  const target = o.target ? String(o.target) : 'qa'
  if (!TARGETS.has(target)) throw new Error('--target no válido: ' + target)
  switch (cmd) {
    case 'status': {
      const r = await http('GET', '/api/report').catch(() => null)
      if (!r) throw new Error('Flow no está arriba (bin/cockpit ensure flow)')
      if (o.json) { console.log(JSON.stringify(r.data, null, 2)); return }
      const rep = r.data.report
      if ((r.data.reports || []).length > 1) console.log(`  ⚠ ${r.data.reports.length} apps abiertas con escenarios propios: muestro la última que contó`)
      console.log(`Flow · ${r.data.apps} app(s) abierta(s)` + (rep ? ` · ${rep.merchant?.name || ''} / ${rep.merchant?.branch || ''}` : ''))
      if (!rep) return
      for (const e of rep.entities) {
        console.log(`  ${e.name === rep.selected ? '▸' : ' '} ${e.name} · rt${e.rt} · ${e.product}${e.production ? ` · real #${e.production.lenderId} de la sucursal ${e.production.branchId}` : ' · de ejemplo'}${e.delegated ? ` · ${e.delegated.usesQuotaEngine ? 'motor' : 'su API'}${e.delegated.formalization ? ', radica' : ''}, días ${e.delegated.paymentDays.join('/')}` : ''}`)
        const g = e.listing
        if (g) console.log(`      listado: ${g.ok ? `se ofrece · cupo ${Number(g.cupo || 0).toLocaleString('es-CO')}${g.category ? ' · ' + g.category : ''}${g.prob && g.prob !== 'alta' ? ` · prioridad ${g.prob}${g.reason ? ': ' + g.reason : ''}` : ''}` : 'no se ofrece · ' + (g.reason || 'sin motivo')}`)
        else if (e.enabled === false) console.log('      listado: no habilitada en el comercio')
      }
      return
    }
    case 'branches': {
      const [lender] = ids(o.lender); if (!lender) throw new Error('falta --lender <id>')
      const rows = await sql(target, `SELECT b.id, b.hash, b.name, a.id AS allied_id, a.name AS allied FROM lenders_by_allied_branches lbab JOIN allied_branches b ON b.id = lbab.allied_branch_id JOIN allieds a ON a.id = b.allied_id WHERE lbab.lender_id = ${lender} AND lbab.status = 1 AND b.status = 1 ORDER BY b.id DESC LIMIT ${Math.min(Number(o.limit) || 20, 100)}`)
      for (const b of rows) console.log(`  ${b.id} · ${b.hash} · ${b.name} · ${b.allied} (#${b.allied_id})`)
      if (!rows.length) console.log('  ninguna sucursal activa con esa entidad en ' + target)
      return
    }
    case 'import': {
      if (!o.branch) throw new Error('falta --branch <id|hash>')
      const lenders = ids(o.lender); if (!lenders.length) throw new Error('falta --lender <id>[,id]')
      const branch = await branchOf(target, String(o.branch))
      console.log(`${target} · sucursal ${branch.id} (${branch.hash}) · ${branch.allied_name}`)
      const photos = []
      for (const l of lenders) { const p = await lenderPhoto(target, branch, l); console.log('  · ' + p.summary); photos.push(p) }
      const commands = []
      if (o.replace) commands.push({ type: 'clear' })
      for (const p of photos) commands.push({ type: 'import', payload: p.payload, delegated: p.delegated })
      if (o.select) commands.push({ type: 'select', name: String(o.select) })
      return send(commands)
    }
    case 'add': {
      if (!o.name) throw new Error('falta --name')
      return send([{ type: 'add', name: String(o.name), rt: Number(o.rt ?? 2), product: PRODUCT[o.product] || 'credito', delegated: delegatedFlags(o) }])
    }
    case 'select': if (!o._[1]) throw new Error('falta el nombre'); return send([{ type: 'select', name: o._.slice(1).join(' ') }])
    case 'unselect': return send([{ type: 'unselect' }])
    case 'remove': if (!o._[1]) throw new Error('falta el nombre'); return send([{ type: 'remove', name: o._.slice(1).join(' ') }])
    case 'clear': return send([{ type: 'clear' }])
    case 'delegated': if (!o._[1]) throw new Error('falta el nombre'); return send([{ type: 'delegated', name: o._.slice(1).join(' '), fields: delegatedFlags(o) }])
    case 'client': {
      const fields = {}
      for (const k of ['score', 'negatives', 'arrears', 'inquiries', 'history', 'occupation', 'continuity', 'age', 'gender', 'income', 'amount']) if (o[k] !== undefined && o[k] !== true) fields[k] = String(o[k])
      if (!Object.keys(fields).length) throw new Error('nada para cambiar (bin/flow client --score 800 …)')
      await send([{ type: 'client', fields }])
      await new Promise(r => setTimeout(r, 1200))
      return main2status()
    }
    case 'open': await run(path.join(ROOT, 'bin', 'cockpit'), ['open', 'flow']); console.log('Cockpit: flow'); return
    default: console.log(USAGE); if (cmd && cmd !== 'help') process.exitCode = 2
  }
}

main().catch(e => { console.error('flow: ' + e.message); process.exit(1) })
