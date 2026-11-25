// La app escucha a `bin/flow` (2026-11-25): el servidor (server/bridge.mjs) le pasa comandos y la app los aplica con la
// misma lógica de la interfaz, contesta, y cuenta qué tiene después de cada guardado. Así lo carga y lo cambia Claude por
// consola y Miguel sólo lo mira en Cockpit.
import { watch, nextTick } from 'vue'
import { customLenders, addCustomLender, removeCustomLender, selectOffer, findLenderDef, setDelegated, delegatedOf,
  applyProductionImport, merchant, ui, persistPing, lenders, bureau, state, setNull } from './store'

const KEYS = { usesQuotaEngine: 'usesQuotaEngine', formalization: 'formalization', paymentDays: 'paymentDays', bondPct: 'bondPct', bondType: 'bondType' }
function applyDelegated(l, d) {
  if (!l || l.rt !== 4 || !d) return
  for (const [k, v] of Object.entries(d)) if (KEYS[k] && v != null) setDelegated(l, k, v)
}

// El cliente de la solicitud: los datos de las centrales que deciden (bin/flow client) y el monto.
const CLIENT = { score: 'score', negatives: 'negatives12m', arrears: 'currentArrears', inquiries: 'inquiries6m', history: 'creditHistoryMonths',
  occupation: 'employment', continuity: 'agilContinuity', age: 'edad', gender: 'gender', income: 'agilIncome' }
const CONT = ['<3m', '3m', '6m', '12m'], EMP = ['empleado', 'independiente', 'pensionado', 'desempleado']
const HANDLERS = {
  // La foto de una entidad leída de la base (bin/flow import): categorías, tramos, reglas de sucursal y, si es
  // delegada, su ficha.
  import(c) { const l = applyProductionImport(c.payload); applyDelegated(l, c.delegated); return { name: l.name, rt: l.rt } },
  add(c) {
    if (!findLenderDef(c.name)) { if (!addCustomLender(c.name, Number(c.rt ?? 2), c.product || 'credito')) throw new Error('no se pudo crear ' + c.name) }
    applyDelegated(findLenderDef(c.name), c.delegated)
    return { name: c.name }
  },
  select(c) { if (!findLenderDef(c.name)) throw new Error('no existe ' + c.name); selectOffer(c.name); return { selected: c.name } },
  unselect() { ui.selected = null; return { selected: null } },
  remove(c) { if (!findLenderDef(c.name)) throw new Error('no existe ' + c.name); removeCustomLender(c.name); return { removed: c.name } },
  clear() { const names = customLenders.map(l => l.name); names.forEach(removeCustomLender); return { removed: names } },
  client(c) {
    const set = {}
    for (const [flag, key] of Object.entries(CLIENT)) {
      if (c.fields[flag] == null) continue
      let v = c.fields[flag]
      if (flag === 'continuity' && !CONT.includes(v)) throw new Error('continuity: ' + CONT.join(' | '))
      if (flag === 'occupation' && !EMP.includes(v)) throw new Error('occupation: ' + EMP.join(' | '))
      if (flag === 'gender') v = String(v).toUpperCase()
      else if (!['continuity', 'occupation'].includes(flag)) v = Number(v)
      bureau[key] = v; setNull(key, false); set[flag] = v
    }
    if (c.fields.amount != null) { state.monto = String(Number(c.fields.amount)); set.amount = Number(c.fields.amount) }
    return { client: set }
  },
  delegated(c) { const l = findLenderDef(c.name); if (!l) throw new Error('no existe ' + c.name); if (l.rt !== 4) throw new Error(c.name + ' no es delegada'); applyDelegated(l, c.fields); return { delegated: delegatedOf(l) } },
}

function report() {
  const listing = Object.fromEntries(lenders.value.map(r => [r.name, { ok: r.ok, reason: r.reason || null, cupo: r.cupo, category: r.category || null, dues: r.dues }]))
  const body = {
    merchant: { name: merchant.nombre, branch: merchant.sucursal },
    selected: ui.selected,
    entities: customLenders.map(l => ({ name: l.name, rt: l.rt, product: l.producto, enabled: !!merchant.enabled[l.name],
      production: l.production ? { lenderId: l.production.lenderId, branchId: l.production.branchId, importedAt: l.production.importedAt } : null,
      delegated: l.rt === 4 ? delegatedOf(l) : undefined, listing: listing[l.name] || null })),
  }
  fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
}

export function startBridge() {
  if (typeof EventSource === 'undefined') return
  const source = new EventSource('/api/events')
  source.onopen = () => report()
  source.onmessage = async (ev) => {
    let msg; try { msg = JSON.parse(ev.data) } catch { return }
    const results = []
    for (const c of msg.commands || []) {
      try { results.push({ type: c.type, ok: true, ...(HANDLERS[c.type] ? HANDLERS[c.type](c) : (() => { throw new Error('comando desconocido: ' + c.type) })()) }) }
      catch (e) { results.push({ type: c.type, ok: false, error: e.message }) }
      await nextTick()
    }
    fetch('/api/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: msg.id, results }) }).catch(() => {})
    setTimeout(report, 600)
  }
  let t
  watch(() => persistPing.n, () => { clearTimeout(t); t = setTimeout(report, 300) })
}
