// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEET, resolveSheet, defaultInputs, nombreDe } from './sheets.js'
import { evalSheet } from './engine.js'

export const ui = reactive({ dark: true, showDoc: false })

export const inputs = reactive({ ...defaultInputs(SHEET) })
export const periods = reactive({ ...SHEET.periods })
// a dónde va cada costo movible. No es un input: es DÓNDE VIVE el bloque — o sea, en qué nodo
// aparecen sus perillas y qué fórmula lo recoge. Un solo dato para las dos cosas.
export const where = reactive({ ...SHEET.where })

// Campos agregados desde la UI. Viven acá y no en la hoja porque son de esta configuración, no
// del motor: `resolveSheet` los convierte en inputs, fórmulas y términos de la suma.
export const extras = reactive([])
let seq = 0

/** Agrega un campo a un punto de inserción. `kind` es 'money' (monto fijo) o 'rate' (porcentaje
 *  sobre la base de ese punto: el monto, o el valor a financiar). */
export function addExtra({ label, kind = 'money', at }) {
  const texto = String(label || '').trim()
  if (!texto || !at) return null
  const name = nombreDe(texto, SHEET, extras.map(e => e.name))
  const e = { id: 'x' + ++seq, name, label: texto, kind, at }
  extras.push(e)
  inputs[name] = 0     // arranca en cero: no mueve ningún número hasta que se llene
  return e
}

export function removeExtra(id) {
  const i = extras.findIndex(e => e.id === id)
  if (i < 0) return
  delete inputs[extras[i].name]
  extras.splice(i, 1)
}

export const effDef = computed(() => resolveSheet(SHEET, { periods, where, extras })) 
export const out = computed(() => evalSheet(effDef.value, inputs))

export function reset() {
  extras.splice(0)
  for (const k of Object.keys(inputs)) delete inputs[k]
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
  // los inputs RESUELTOS: incluyen los campos agregados a mano, que es lo que se guardaría
  inputs: effDef.value.inputs.map(i => ({
    name: i.name, type: i.type, appliesTo: i.appliesTo,
    ...(i.extra ? { label: i.label, agregado: true } : {}),
  })),
  terms: effDef.value.terms.map(t => ({ value: t.value, at: t.at, ...(t.spread ? { spread: true } : {}) })),
  // las fórmulas RESUELTAS: es lo que se guardaría para este lender, con la fianza ya recogida
  // por el lado que le toca. Por eso `financedAmount` cambia al mover el bloque.
  formulas: { ...effDef.value.formulas },
  series: SHEET.series,
  output: SHEET.output,
}))
