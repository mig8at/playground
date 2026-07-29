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
 *    kind   'money' monto fijo · 'rate' porcentaje · 'formula' una expresión
 *    base   solo para 'rate': el `name` de OTRO campo del mismo nodo. Vacío = la base del punto
 *           (el monto, o el valor a financiar).
 *    spread solo en 'charges': es un total y se reparte entre las cuotas.
 *    expr   solo para 'formula': la expresión. No se valida acá — el motor devuelve el error. */
export function addField({ label, kind = 'money', at, base = '', spread = false, expr = '',
                           value = 0 }) {
  const texto = String(label || '').trim()
  if (!texto || !at) return null
  const name = nombreDe(texto, SHEET, fields.map(f => f.name))
  const f = { id: 'f' + ++seq, name, label: texto, kind, at, base, spread, expr }
  fields.push(f)
  // un campo agregado a mano arranca en cero y no mueve ningún número; los del ejemplo cableado
  // traen su valor
  inputs[name] = value
  return f
}

/** Reescribe la expresión de un campo fórmula. Se guarda tal cual y se recalcula: si está a medio
 *  escribir el motor la marca en error y solo se apagan sus descendientes. */
export function setExpr(id, expr) {
  const f = fields.find(x => x.id === id)
  if (f) f.expr = expr
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

/** Pone el ejemplo cableado. `baseOf` se resuelve acá —por LABEL— porque las bases van por `name`
 *  y el name lo genera `addField`: la hoja no puede saberlo de antemano. */
function sembrar() {
  for (const d of DEFAULT_FIELDS) {
    // `baseOf` se resuelve por LABEL (el name lo genera addField); `base` ya viene explícito
    const base = d.baseOf ? fields.find(f => f.label === d.baseOf)?.name || '' : (d.base || '')
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
