// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEET, PRESETS, PERIODS, withPeriods, defaultInputs } from './sheets.js'
import { evalSheet } from './engine.js'

export const ui = reactive({
  /** qué configuración de producto está cargada. La HOJA es siempre la misma. */
  preset: 'generico',
  dark: true, showDoc: false,
  /** fórmula abierta en el panel derecho, o null */
  selected: null,
})

/** Los valores del producto. Editables en el nodo Entrada. */
export const inputs = reactive({})
/** Los períodos elegidos: nombres, no números. Se resuelven a statedPerYear / periodsPerYear. */
export const periods = reactive({})

export const preset = computed(() => PRESETS[ui.preset])

/** La hoja con los períodos resueltos. SHEET queda intacta. */
export const effDef = computed(() => withPeriods(SHEET, periods))

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

/** Carga los valores del preset. La hoja no cambia — eso es todo el punto. */
export function loadPreset() {
  const p = PRESETS[ui.preset]
  for (const k of Object.keys(inputs)) delete inputs[k]
  Object.assign(inputs, defaultInputs(SHEET), p.values)
  for (const k of Object.keys(periods)) delete periods[k]
  Object.assign(periods, SHEET.periods, p.periods || {})
}

watch(() => ui.preset, () => { loadPreset(); ui.selected = null }, { immediate: true })
watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' }, { immediate: true })

/** LA HOJA: las fórmulas y el contrato de entrada. Una sola, para todos los productos. */
export const sheetDoc = computed(() => ({
  periods: { ...periods },
  inputs: SHEET.inputs.map(i => {
    const o = { name: i.name, type: i.type }
    if (i.min != null) o.min = i.min
    return o
  }),
  formulas: { ...SHEET.formulas },
  series: SHEET.series,
  output: SHEET.output,
}))

/** LA CONFIGURACIÓN: solo valores. Es lo único que distingue un producto de otro. */
export const presetDoc = computed(() => ({
  label: preset.value.label,
  legalNature: preset.value.legalNature,
  periods: { ...periods },
  values: Object.fromEntries(
    SHEET.inputs.map(i => [i.name, inputs[i.name]]).filter(([, v]) => v !== 0 && v !== false)),
}))

/** El período de una tasa, para NUNCA mostrar un porcentaje pelado.
 *  Un "2%" sin período no es un dato: es medio dato. Es el pecado de `user_requests.rate`
 *  en la BD real — la única columna de tasa sin `rate_suffix`, y la que se desincronizó en
 *  CORE-127 (1,82 contra TEA 28,79). Ver F-71. Devuelve null si no es una tasa. */
export function periodOf(name) {
  if (!/rate/i.test(name)) return null
  if (/^annual/i.test(name)) return 'anual'
  if (/^daily/i.test(name)) return 'diaria'
  if (/^stated/i.test(name)) return periods.rateStatedIn || null
  if (/^period/i.test(name)) return periods.chargedEvery || null
  return null
}

/** Cómo se edita un valor: el tipo declarado manda. */
export function controlFor(name, value, declaredType) {
  if (declaredType) return declaredType
  if (/rate|factor|ratio|share/i.test(name)) return 'rate'
  return Math.abs(Number(value)) >= 1000 ? 'money' : 'count'
}
