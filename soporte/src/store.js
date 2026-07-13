import { reactive, computed } from 'vue'
import { CASES, STAGES } from './mock'

// Estado de la UI: qué se buscó, qué cédula/intento/nodo está seleccionado.
export const ui = reactive({ query: '', cedula: null, notFound: false, intentoId: null, nodeId: null })

export const caseData = computed(() => (ui.cedula && CASES[ui.cedula]) || null)
export const intentos = computed(() => caseData.value?.intentos || [])
export const intento = computed(() =>
  intentos.value.find(i => i.id === ui.intentoId) || intentos.value[0] || null)

// Etapa/lender seleccionado en el grafo → alimenta el panel de detalle.
export const selectedNode = computed(() => {
  const it = intento.value; if (!it || !ui.nodeId) return null
  if (ui.nodeId.startsWith('lender:')) {
    const nm = ui.nodeId.slice(7)
    const l = (it.stages.listado?.lenders || []).find(x => x.name === nm)
    return l ? { kind: 'lender', lender: l } : null
  }
  const st = STAGES.find(s => s.id === ui.nodeId)
  const data = it.stages[ui.nodeId]
  return st && data ? { kind: 'stage', stage: st, data } : null
})

export function search(q) {
  ui.query = q
  const key = String(q || '').replace(/\D/g, '')
  ui.nodeId = null
  if (key && CASES[key]) { ui.cedula = key; ui.intentoId = CASES[key].intentos[0].id; ui.notFound = false }
  else { ui.cedula = null; ui.intentoId = null; ui.notFound = !!key }
}
export function selectIntento(id) { ui.intentoId = id; ui.nodeId = null }
export function selectNode(id) { ui.nodeId = ui.nodeId === id ? null : id }

// Resumen del intento: hasta dónde llegó + por qué se rompió (para el header del detalle).
export function intentoSummary(it) {
  if (!it) return null
  const reached = STAGES.filter(s => ['ok', 'warn', 'fail'].includes(it.stages[s.id]?.status))
  const last = reached[reached.length - 1]
  const broke = it.brokeAt ? STAGES.find(s => s.id === it.brokeAt) : null
  return { llegoHasta: last?.label || '—', broke, reason: broke ? it.stages[it.brokeAt]?.reason : null }
}
