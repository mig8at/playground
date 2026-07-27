// Estado compartido. Los nodos lo importan directo (misma convención que playground/flow):
// así el v-model de un input NO depende del prop `data`, que se recrea en cada recálculo.
// Si dependiera de `data`, escribir en un campo perdería el foco a cada tecla.
import { reactive, computed, watch } from 'vue'
import { SHEETS, POLICIES, defaultInputs } from './sheets.js'
import { evalSheet } from './engine.js'

// `seriesOpen` arranca cerrado: el plan de pagos son 104 filas que competían por la atención
// con el grafo, que es lo que se vino a mirar.
export const ui = reactive({
  slug: 'motai-rto', tab: 'calc', grouped: true, dark: true, seriesOpen: false,
  /** fórmula abierta en el panel derecho, o null */
  selected: null,
})

/** Lo que manda el llamador. Editable en el nodo Entrada. */
export const inputs = reactive({})
/** Las constantes de la hoja. También editables — es un simulador: "¿y si el IVA fuera 21%?". */
export const consts = reactive({})
/** Los datos de la persona, que solo mira la política. */
export const risk = reactive({ monthlyIncome: 3200000, creditScore: 520 })

export const sheetDef = computed(() => SHEETS[ui.slug])

/** La hoja con las constantes editadas encima. SHEETS queda intacto. */
export const effDef = computed(() => ({ ...sheetDef.value, constants: { ...consts } }))

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
}

watch(() => ui.slug, () => { resetSheet(); ui.selected = null }, { immediate: true })
watch(() => ui.dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' }, { immediate: true })

/** Cómo se edita un valor según su tipo o, para constantes, según su magnitud. */
export function controlFor(name, value, declaredType) {
  if (declaredType) return declaredType === 'money' ? 'money' : declaredType
  if (/rate|factor|ratio|share/i.test(name)) return 'rate'
  return Math.abs(Number(value)) >= 1000 ? 'money' : 'count'
}
