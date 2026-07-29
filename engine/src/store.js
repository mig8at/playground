// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEET, withPeriods, defaultInputs } from './sheets.js'
import { evalSheet } from './engine.js'

export const ui = reactive({ dark: true, showDoc: false })

export const inputs = reactive({ ...defaultInputs(SHEET) })
export const periods = reactive({ ...SHEET.periods })

export const effDef = computed(() => withPeriods(SHEET, periods))
export const out = computed(() => evalSheet(effDef.value, inputs))

export function reset() {
  Object.assign(inputs, defaultInputs(SHEET))
  Object.assign(periods, SHEET.periods)
}

watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' },
  { immediate: true })

/** El documento que se guardaría. Toda la hoja: nada vive en código. */
export const sheetDoc = computed(() => ({
  periods: { ...periods },
  inputs: SHEET.inputs.map(i => ({ name: i.name, type: i.type })),
  formulas: { ...SHEET.formulas },
  series: SHEET.series,
  output: SHEET.output,
}))
