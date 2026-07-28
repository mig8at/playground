// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEETS, POLICIES, PERIODS, withPeriods, defaultInputs } from './sheets.js'
import { evalSheet } from './engine.js'

// `seriesOpen` arranca cerrado: el plan de pagos son 104 filas que competían por la atención
// con el grafo, que es lo que se vino a mirar.
export const ui = reactive({
  slug: 'simulador', tab: 'calc', dark: true, seriesOpen: false, showDoc: false,
  /** fórmula abierta en el panel derecho, o null */
  selected: null,
})

/** Lo que manda el llamador. Editable en el nodo Entrada. */
export const inputs = reactive({})
/** Las constantes de la hoja. También editables — es un simulador: "¿y si el IVA fuera 21%?". */
export const consts = reactive({})
/** Los períodos elegidos: nombres, no números. El store los resuelve a statedPerYear /
 *  periodsPerYear / termPerYear y los inyecta como constantes, así las fórmulas no cambian. */
export const periods = reactive({})

/** Las tablas de búsqueda. Son ENTRADA igual que los inputs: datos, no cálculo. */
export const tables = reactive({})
/** Los datos de la persona, que solo mira la política. */
export const risk = reactive({ monthlyIncome: 3200000, creditScore: 520 })

export const sheetDef = computed(() => SHEETS[ui.slug])

/** La hoja con las constantes editadas encima. SHEETS queda intacto. */
export const effDef = computed(() => {
  const base = withPeriods({ ...sheetDef.value, constants: { ...consts } }, periods)
  return { ...base, tables: JSON.parse(JSON.stringify(tables)) }
})

/** La evaluación viva. Vive acá para que el panel derecho no necesite props. */
export const out = computed(() => evalSheet(effDef.value, inputs))

/** Quién usa a quién — para el "lo usan" del panel. */
export const usedBy = computed(() => {
  const m = {}
  for (const [f, deps] of Object.entries(out.value.deps || {})) {
    for (const d of deps) (m[d] ??= []).push(f)
  }
  return m
})

export function selectFormula(name) {
  ui.selected = ui.selected === name ? null : name
}

export const policyDef = computed(() =>
  Object.values(POLICIES).find(p => p.appliesTo.includes(ui.slug)) || null)

export function resetSheet() {
  const d = SHEETS[ui.slug]
  for (const k of Object.keys(inputs)) delete inputs[k]
  Object.assign(inputs, defaultInputs(d))
  for (const k of Object.keys(consts)) delete consts[k]
  Object.assign(consts, d.constants)
  // copia PROFUNDA: si no, editar una celda mutaría SHEETS y no habría cómo restablecer
  for (const k of Object.keys(tables)) delete tables[k]
  Object.assign(tables, JSON.parse(JSON.stringify(d.tables || {})))
  for (const k of Object.keys(periods)) delete periods[k]
  Object.assign(periods, d.periods || {})
}

watch(() => ui.slug, () => { resetSheet(); ui.selected = null }, { immediate: true })
watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' }, { immediate: true })

/** El documento que se guardaría. Es TODA la lógica de la hoja: nada vive en código.
 *  Los valores de prueba de los inputs NO van — la hoja declara el contrato, no los datos. */
export const sheetDoc = computed(() => {
  const d = sheetDef.value
  const doc = {}
  if (d.rateConvention) doc.rateConvention = d.rateConvention
  if (d.periods) doc.periods = { ...periods }
  if (d.realWorldCharge) doc.realWorldCharge = d.realWorldCharge
  if (Object.keys(consts).length) doc.constants = { ...consts }
  doc.inputs = (d.inputs || []).map(i => {
    const o = { name: i.name, type: i.type }
    if (i.min != null) o.min = i.min
    if (i.enum) o.enum = i.enum
    return o
  })
  if (d.tables) doc.tables = JSON.parse(JSON.stringify(tables))
  doc.formulas = { ...d.formulas }
  if (d.groups) doc.groups = d.groups
  if (d.series) doc.series = d.series
  doc.output = d.output
  return doc
})

/** Cómo se edita un valor según su tipo o, para constantes, según su magnitud. */
export function controlFor(name, value, declaredType) {
  if (declaredType) return declaredType === 'money' ? 'money' : declaredType
  if (/rate|factor|ratio|share/i.test(name)) return 'rate'
  return Math.abs(Number(value)) >= 1000 ? 'money' : 'count'
}
