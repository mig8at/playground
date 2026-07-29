// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEET, resolveSheet, defaultInputs, nombreDe, DEFAULT_FIELDS } from './sheets.js'
import { evalSheet } from './engine.js'

export const ui = reactive({ dark: true, showDoc: false })

export const inputs = reactive({ ...defaultInputs(SHEET) })
export const periods = reactive({ ...SHEET.periods })

// ── LOS CAMPOS ──
// Todo costo vive acá, no en la hoja: la hoja no sabe qué es una fianza. Cada campo dice qué hace
// (tipo · base · si se reparte) y `resolveSheet` lo convierte en input, fórmula y término.
export const fields = reactive([])
let seq = 0

/** Agrega un campo a un punto de inserción.
 *    kind   'money' monto fijo · 'rate' porcentaje
 *    base   solo para 'rate': el `name` de OTRO campo del mismo nodo. Vacío = la base del punto
 *           (el monto, o el valor a financiar).
 *    spread solo en 'charges': es un total y se reparte entre las cuotas. */
export function addField({ label, kind = 'money', at, base = '', spread = false }) {
  const texto = String(label || '').trim()
  if (!texto || !at) return null
  const name = nombreDe(texto, SHEET, fields.map(f => f.name))
  const f = { id: 'f' + ++seq, name, label: texto, kind, at, base, spread }
  fields.push(f)
  inputs[name] = 0     // arranca en cero: no mueve ningún número hasta que se llene
  return f
}

export function removeField(id) {
  const i = fields.findIndex(f => f.id === id)
  if (i < 0) return
  const muerto = fields[i]
  delete inputs[muerto.name]
  fields.splice(i, 1)
  // un campo que se apoyaba en el borrado se queda sin base: vuelve a la base del punto, que es
  // lo único que se puede garantizar. Dejarlo apuntando a la nada rompería la fórmula.
  for (const f of fields) if (f.base === muerto.name) f.base = ''
}

/** Los campos que un campo NUEVO puede usar como base: los del MISMO nodo y ANTERIORES. Así un
 *  ciclo no se puede ni escribir. */
export function basesDisponibles(at, hasta = fields.length) {
  return fields.slice(0, hasta).filter(f => f.at === at)
}

export const effDef = computed(() => resolveSheet(SHEET, { periods, fields }))
export const out = computed(() => evalSheet(effDef.value, inputs))

export function reset() {
  fields.splice(0)
  for (const k of Object.keys(inputs)) delete inputs[k]
  Object.assign(inputs, defaultInputs(SHEET))
  Object.assign(periods, SHEET.periods)
  sembrar()
}

/** Pone los campos por defecto. `baseOf` se resuelve acá porque las bases van por `name`, y el
 *  name lo genera `addField`. */
function sembrar() {
  for (const d of DEFAULT_FIELDS) {
    const base = d.baseOf ? fields.find(f => f.label === d.baseOf)?.name || '' : ''
    addField({ ...d, base })
  }
}
sembrar()

watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' },
  { immediate: true })

/** El documento que se guardaría. Toda la hoja: nada vive en código. */
export const sheetDoc = computed(() => ({
  periods: { ...periods },
  // los inputs RESUELTOS: incluyen los campos agregados a mano, que es lo que se guardaría
  inputs: effDef.value.inputs.map(i => ({
    name: i.name, type: i.type, appliesTo: i.appliesTo,
    ...(i.field ? { label: i.label, agregado: true } : {}),
  })),
  fields: fields.map(f => ({ name: f.name, label: f.label, kind: f.kind, at: f.at,
    ...(f.base ? { base: f.base } : {}), ...(f.spread ? { spread: true } : {}) })),
  terms: effDef.value.terms.map(t => ({ value: t.value, at: t.at, ...(t.spread ? { spread: true } : {}) })),
  // las fórmulas RESUELTAS: es lo que se guardaría para este lender, con la fianza ya recogida
  // por el lado que le toca. Por eso `financedAmount` cambia al mover el bloque.
  formulas: { ...effDef.value.formulas },
  series: SHEET.series,
  output: SHEET.output,
}))
