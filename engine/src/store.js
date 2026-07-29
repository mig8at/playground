// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEET, resolveSheet, defaultInputs } from './sheets.js'
import { evalSheet } from './engine.js'

export const ui = reactive({ dark: true, showDoc: false })

export const inputs = reactive({ ...defaultInputs(SHEET) })
export const periods = reactive({ ...SHEET.periods })
// a dónde va cada costo movible. No es un input: es DÓNDE VIVE el bloque — o sea, en qué nodo
// aparecen sus perillas y qué fórmula lo recoge. Un solo dato para las dos cosas.
export const where = reactive({ ...SHEET.where })

export const effDef = computed(() => resolveSheet(SHEET, { periods, where }))
export const out = computed(() => evalSheet(effDef.value, inputs))

export function reset() {
  Object.assign(inputs, defaultInputs(SHEET))
  Object.assign(periods, SHEET.periods)
  Object.assign(where, SHEET.where)
}

watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' },
  { immediate: true })

/** El documento que se guardaría. Toda la hoja: nada vive en código. */
export const sheetDoc = computed(() => ({
  periods: { ...periods },
  where: { ...where },
  inputs: SHEET.inputs.map(i => ({ name: i.name, type: i.type })),
  // las fórmulas RESUELTAS: es lo que se guardaría para este lender, con la fianza ya recogida
  // por el lado que le toca. Por eso `financedAmount` cambia al mover el bloque.
  formulas: { ...effDef.value.formulas },
  series: SHEET.series,
  output: SHEET.output,
}))
