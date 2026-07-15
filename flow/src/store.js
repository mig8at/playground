import { reactive, computed, watch, nextTick } from 'vue'

function money(n) { return '$' + Number(n || 0).toLocaleString('es-CO') }
export { money }
// Persistencia del grafo (bloque al final del archivo): `restoring` evita re-sembrar el buró durante
// la rehidratación; `editTick` sube en cada edición de regla, para disparar el guardado del escenario.
let restoring = false
export const editTick = reactive({ n: 0 })
// Sube cada vez que se persiste el escenario en localStorage → la barra muestra "✓ guardado".
export const persistPing = reactive({ n: 0 })

/* ============================================================================
 * CATÁLOGO ÚNICO DE REGLAS — todas las entidades comparten estas 16 reglas.
 * Por defecto cada regla está "abierta" (open) = no restringe. Cada lender
 * solo define OVERRIDES; una regla "aplica" cuando su valor difiere del open.
 * type: range {min,max} · min · max · set · bool · value
 * control: slider · number · money · chips · toggle
 * ========================================================================== */
export const RULE_CATALOG = [
  { key: 'score', label: 'Score datacrédito', desc: 'Puntaje de riesgo del buró (0–1000). Más alto = mejor comportamiento de pago.', group: 'riesgo', type: 'range', control: 'slider', min: 0, max: 1000, step: 10, open: { min: 0, max: 1000 } },
  { key: 'age', label: 'Edad', desc: 'Edad del solicitante que la entidad acepta.', group: 'perfil', type: 'range', control: 'slider', min: 18, max: 100, step: 1, open: { min: 18, max: 100 } },
  { key: 'amount', label: 'Monto', desc: 'Rango de monto del crédito que la entidad financia.', group: 'solicitud', type: 'range', control: 'money', min: 0, max: 50000000, open: { min: 0, max: 50000000 } },
  { key: 'monthlyIncome', label: 'Ingreso mensual (mín)', desc: 'Ingreso mensual mínimo exigido al solicitante.', group: 'perfil', type: 'min', control: 'money', min: 0, max: 20000000, open: { min: 0 } },
  { key: 'negatives12m', label: 'Negativos 12m (máx)', desc: 'Máximo de reportes negativos en los últimos 12 meses.', group: 'riesgo', type: 'max', control: 'slider', min: 0, max: 20, step: 1, open: { max: 20 } },
  { key: 'currentArrears', label: 'Mora vigente (máx)', desc: 'Máximo de cuentas actualmente en mora.', group: 'riesgo', type: 'max', control: 'slider', min: 0, max: 10, step: 1, open: { max: 10 } },
  { key: 'inquiries6m', label: 'Consultas 6m (máx)', desc: 'Máximo de consultas al buró en 6 meses (muchas = busca mucho crédito).', group: 'riesgo', type: 'max', control: 'slider', min: 0, max: 20, step: 1, open: { max: 20 } },
  { key: 'creditHistoryMonths', label: 'Antigüedad historial (meses mín)', desc: 'Antigüedad mínima del historial crediticio, en meses.', group: 'riesgo', type: 'min', control: 'number', min: 0, max: 240, open: { min: 0 } },
  { key: 'debtToIncomePct', label: 'Endeudamiento (máx %)', desc: 'Nivel máximo de deuda sobre el ingreso (capacidad de pago).', group: 'riesgo', type: 'max', control: 'slider', min: 0, max: 100, step: 1, open: { max: 100 } },
  { key: 'documentTypes', label: 'Tipos de documento', desc: 'Documentos que la entidad acepta (CC, CE, pasaporte PEP).', group: 'perfil', type: 'set', control: 'chips', options: ['CC', 'CE', 'PEP'], open: ['CC', 'CE', 'PEP'] },
  { key: 'gender', label: 'Género', desc: 'Géneros aceptados (normalmente todos).', group: 'perfil', type: 'set', control: 'chips', options: ['M', 'F'], open: ['M', 'F'] },
  { key: 'employment', label: 'Situación laboral', desc: 'Situaciones laborales aceptadas (empleado, independiente, etc.).', group: 'perfil', type: 'set', control: 'chips', options: ['empleado', 'independiente', 'pensionado', 'desempleado'], open: ['empleado', 'independiente', 'pensionado', 'desempleado'] },
  { key: 'requireCleanAml', label: 'Exige AML limpio', desc: 'Rechaza si aparece en listas restrictivas (lavado/terrorismo).', group: 'kyc', type: 'bool', control: 'toggle', open: false },
  { key: 'requireVerifiedIdentity', label: 'Exige identidad verificada', desc: 'Rechaza si no se pudo validar la identidad del solicitante.', group: 'kyc', type: 'bool', control: 'toggle', open: false },
  { key: 'acceptThinFile', label: 'Acepta sin historial (thin file)', desc: 'Si presta a clientes sin historial en el buró.', group: 'riesgo', type: 'bool', control: 'toggle', open: true },
  { key: 'initialFeePct', label: 'Cuota inicial exigida (%)', desc: 'Porcentaje del monto que se paga por adelantado.', group: 'solicitud', type: 'value', control: 'slider', min: 0, max: 100, step: 5, open: 0 },
]
const ruleDef = (key) => RULE_CATALOG.find(r => r.key === key)

// Override disperso: cada capa hereda de su PADRE si no tiene override propio.
// Cadena: relación (sucursal, nivel 2) → def del lender (nivel 0) → abierto.
const parentOf = (def) => (def && def.parent) || null

export function ruleValue(lender, key) {
  const r = ruleDef(key)
  const ov = lender.overrides ? lender.overrides[key] : undefined
  const p = parentOf(lender)
  const inherited = p ? ruleValue(p, key) : r.open   // valor heredado de la base (o abierto si no hay padre)
  if (ov == null) return inherited
  if (r.type === 'range' || r.type === 'min' || r.type === 'max') return { ...inherited, ...ov } // override parcial pisa sobre lo heredado
  return ov
}
export function setRule(lender, key, val) { if (!lender.overrides) lender.overrides = reactive({}); lender.overrides[key] = val; editTick.n++ }

/* ============================================================================
 * ENTIDADES (lenders reales, top uso / CreditopX). rt = response_type real.
 * Solo overrides; lo ausente queda abierto. Reglas MOCK ilustrativas.
 * ========================================================================== */
// Lender REACTIVO: rt / terms / overrides / entidad son editables desde "Config de entidad".
const L = (def) => {
  def.overrides = def.overrides || {}
  def.terms = def.terms || {}
  def.entidad = def.entidad || {}
  return reactive(def)
}
// terms = solo para mostrar en la tarjeta (tasa m.v., plazo máx, monto/cupo máx). No afecta la decisión.

/* ── Config de la ENTIDAD (lo que HOY edita el admin en "Editar entidad" → tabla lenders):
 * response_type + economía (monto/cuotas/tasa/mora/condonadas). Se DERIVA de terms/overrides
 * que ya existen; se puede afinar por lender con un objeto `entidad`. Es solo-mostrar (no decide). */
export const RT_LABEL = { 0: 'Redirect', 1: 'Agregador', 2: 'CreditopX', 3: 'CreditopX rotativo', 4: 'Híbrido' }
export function entidadCfg(lender) {
  if (!lender) return null
  const t = lender.terms || {}, ov = lender.overrides || {}, e = lender.entidad || {}
  const duesMax = t.maxFee ?? 36
  const dues = e.dues || [6, 12, 24, 36, 48, 60].filter(n => n <= duesMax)
  return {
    rt: lender.rt,
    rtLabel: RT_LABEL[lender.rt] || ('rt' + lender.rt),
    amountMin: e.amountMin ?? (ov.amount && ov.amount.min) ?? 1000000,
    amountMax: t.amountMax ?? (ov.amount && ov.amount.max) ?? 20000000,
    dues, // lista de plazos ofrecibles; el mín/máx de cuotas (min_fee_number/max_fee_number) se deriva de acá
    feeNumMin: dues.length ? Math.min(...dues) : null,     // derivado del listado (menor plazo)
    feeNumMax: dues.length ? Math.max(...dues) : null,     // derivado del listado (mayor plazo)
    duesMin: e.duesMin ?? (dues[0] ?? 6),
    duesMax,
    rate: t.rate ?? null,
    lateRate: e.lateRate ?? (t.rate != null ? +(t.rate + 1.5).toFixed(2) : null),
    condonedDues: e.condonedDues ?? 0,
    abacoExtra: !!e.abacoExtra, // ¿la entidad pide ingreso extra vía Ábaco? (flag del nodo "Información complementaria")
  }
}
// Setters de la Config de entidad (editable desde el nodo Config de lender).
export function setEntidadRt(lender, rt) { if (lender) lender.rt = Number(rt) }
// Producto de la entidad (crédito / renting / renting con compra). Cambio no destructivo:
// solo reetiqueta el producto; la economía/reglas ya cargadas se conservan (igual que hacía rt).
export function setEntidadProducto(lender, producto) { if (lender) lender.producto = producto || null }
export function setEntidadMonto(lender, which, val) {
  if (!lender) return
  const cur = entidadCfg(lender)
  const min = which === 'min' ? Number(val) : cur.amountMin
  const max = which === 'max' ? Number(val) : cur.amountMax
  setRule(lender, 'amount', { min, max })       // "Monto" ES la regla `amount` que filtra rt≠2 (el rango real)
  lender.terms = lender.terms || {}
  lender.terms.amountMax = max                  // sincroniza la tarjeta (máx / cupo rt≠2)
}
export function setEntidadRate(lender, val) { if (lender) { lender.terms = lender.terms || {}; lender.terms.rate = val === '' ? null : Number(val) } }
export function setEntidadDues(lender, str) {
  if (!lender) return
  const arr = String(str).split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0)
  lender.entidad = lender.entidad || {}
  lender.entidad.dues = arr.length ? arr : undefined
  if (arr.length) { lender.terms = lender.terms || {}; lender.terms.maxFee = Math.max(...arr) }
}
export function setEntidad(lender, key, val) { if (lender) { lender.entidad = lender.entidad || {}; lender.entidad[key] = val === '' ? null : Number(val) } }
// Flag Ábaco (info. complementaria) de la entidad (booleano; no numérico → setter aparte de setEntidad).
export function setEntidadAbaco(lender, on) { if (lender) { lender.entidad = lender.entidad || {}; lender.entidad.abacoExtra = !!on; editTick.n++ } }

// UI: lender seleccionado + campo inerte inspeccionado (sidebar "por qué no tiene efecto").
export const ui = reactive({ selected: null, fieldInfo: null })
// Abre/cierra el sidebar de documentación de un campo (key de FIELD_DOCS en fieldDocs.js).
export function openFieldInfo(key) { ui.fieldInfo = key }
export function closeFieldInfo() { ui.fieldInfo = null }

/* ============================================================================
 * Comercio y sucursal = etiquetas de contexto (texto libre en el nodo Comercio).
 * La calculadora económica se resuelve por nombre (merchantCalc[nombre]); las
 * entidades se crean en "Entidades del comercio" (customLenders). `enabled`
 * arranca vacío y lo pueblan las entidades custom al crearse.
 * ========================================================================== */
export const merchant = reactive({
  nombre: 'Motai',
  sucursal: 'PRINCIPAL',
  enabled: {},
})

/* ============================================================================
 * CANAL: por dónde ENTRA la solicitud. Hoy dos opciones — asesor (en el comercio)
 * o ecommerce (checkout de la tienda). Por ahora es etiqueta de contexto (nombre del
 * asesor o de la tienda); más adelante el nodo ramifica el flujo (wizard vs checkout).
 * ========================================================================== */
export const canal = reactive({
  tipo: 'asesor',        // 'asesor' | 'ecommerce'
  asesorNombre: 'Camila',
  tiendaNombre: '',
})

/* ============================================================================
 * Plantillas de PRODUCTO CreditopX (crédito / renting / rent-to-own): las SEMILLAS
 * que usa "Agregar entidad" (addCustomLender) para prellenar terms + overrides al
 * crear una entidad de ese producto. No son un motor: solo defaults de arranque.
 * ========================================================================== */
export const CREDITOPX_PRODUCTS = [
  { key: 'credito', label: 'Compra financiada', category: 'crédito', suffix: 'Compra',
    terms: { rate: 2.2, maxFee: 24, amountMax: 3000000 },
    overrides: { score: { min: 500 }, initialFeePct: 15 } },              // sube score y cuota inicial
  { key: 'renting', label: 'Renting operativo', category: 'arrendamiento', suffix: 'Renting',
    terms: { rate: 1.8, maxFee: 36, amountMax: 4000000 },
    overrides: { acceptThinFile: true, monthlyIncome: { min: 1000000 }, initialFeePct: 0 } }, // sin buró duro, exige ingreso, sin inicial
  { key: 'rto', label: 'Rent-to-Own', category: 'arrendamiento con compra', suffix: 'Rent-to-Own',
    terms: { rate: 2.0, maxFee: 48, amountMax: 5000000 },
    overrides: { monthlyIncome: { min: 1200000 } } },                     // hereda score/doc/inicial; agrega ingreso
]

// ── Nivel 1 · COMERCIO (negocio): la CALCULADORA económica ───────────────────
// En la realidad vive en `lenders_by_allieds` (por COMERCIO, no por sucursal). El comercio hereda
// el default de la familia y overridea lo suyo (override disperso, igual mecánica que las reglas).
export const CREDITOPX_CALCULADORA = { comision: 2.0, cuotaInicial: 10, cargoFijo: 0, iva: 19, fondoGarantias: 0, montoMax: 3000000, castigo: 0, costosAdmin: 0, seguroVidaVar: 0, seguroVidaFijo: 0, multiploIngreso: 0 }
// Overrides por comercio (mock). Ejemplo real del panel (aliado Motai/Sonría): cuota inicial 30%, cargo fijo 400k.
export const merchantCalc = reactive({
  'Motai': { cuotaInicial: 30, cargoFijo: 400000 }, // sin override de montoMax → hereda el máx de la entidad
})
export function calcValue(comercio, key, lender) {
  const ov = merchantCalc[comercio]
  if (ov && ov[key] != null) return ov[key]                    // override del comercio → PISA
  if (key === 'montoMax' && lender) {                          // Monto máx HEREDA del rango de la entidad (su padre real: credit_line_by_lenders.max_amount)
    const e = entidadCfg(lender)
    if (e && e.amountMax > 0) return e.amountMax
  }
  return CREDITOPX_CALCULADORA[key]                             // base de familia (resto de la calculadora, sin padre en la entidad)
}
export function calcInherit(comercio, key) {
  const ov = merchantCalc[comercio]
  return (ov && ov[key] != null) ? 'editada' : 'heredada'   // punto amarillo si el comercio lo editó; gris si hereda de la base
}
export function setCalc(comercio, key, value) {
  if (!merchantCalc[comercio]) merchantCalc[comercio] = {}
  merchantCalc[comercio][key] = value                        // crea/actualiza el override → PISA la base
}
export function resetCalc(comercio, key) {
  if (merchantCalc[comercio]) delete merchantCalc[comercio][key]  // heredar: vuelve a tomar el valor de la base
}

const clone = (o) => JSON.parse(JSON.stringify(o))

// ── Nivel 2 · SUCURSAL: overlay por lender (la "relación" lender×sucursal). Arranca VACÍO =
// hereda TODO de la config de lender (nivel 0). Editar en "Config de sucursal" pisa solo ese
// campo (● amarillo; clic en el punto → vuelve a heredar). Productos: sucursal → producto → familia.
// El REGISTRO es plano (no reactivo) a propósito: relationOf() se llama dentro de computeds
// (lenders, relation) y mutar un objeto reactivo ahí se auto-invalida. Lo único reactivo es
// `overrides` de cada overlay — que es donde se edita y de donde depende el render.
const relationDefs = {}
export function relationOf(lender) {
  if (!lender) return null
  let rel = relationDefs[lender.name]
  if (!rel) rel = relationDefs[lender.name] = { name: lender.name, isRelation: true, parent: lender, overrides: reactive({}) }
  else rel.parent = lender // los generados se recrean al togglear → re-vincular al objeto vigente
  return rel
}

// ── Nivel 2 · SUCURSAL: STATUS de la entidad en la sucursal (lenders_by_allied_branches.status).
// El comercio habilita la entidad en su catálogo (merchant.enabled ≈ lenders_by_allieds); CADA sucursal
// la ACTIVA o DESACTIVA por separado. Inactiva = NO se ofrece en esa sucursal → filtro DURO del listado
// (igual que getLenders, que solo devuelve las filas activas de lenders_by_allied_branches). Keyed por
// nombre = la sucursal vigente (mismo criterio que los overlays de datacrédito/group_rules de esta capa).
// Ausente = activa (default): las entidades nuevas nacen ofrecidas sin sembrar nada.
export const branchStatus = reactive({})
export function branchStatusOf(name) { return branchStatus[name] !== false }
export function setBranchStatus(name, on) { branchStatus[name] = !!on; editTick.n++ }
export function toggleBranchStatus(name) { branchStatus[name] = !branchStatusOf(name); editTick.n++ }

// El "monto máximo" (terms.amountMax, editable como "Monto") debe ENFORZAR el rango: sembramos la
// regla `amount` desde terms si el lender aún no tiene override propio, para que monto > máx dispare
// rojo. Antes terms.amountMax era solo display y NO se cruzaba con la
// solicitud → el monto se pasaba de largo sin fallar. Non-destructivo: no pisa un override existente.
function seedAmountRule(l) {
  if (!l) return l
  // rt=2 (CreditopX): el cupo lo topa la categoría de perfilamiento → la regla amount NO aplica
  // (limpia overrides viejos por si venía sembrado). rt≠2 sí enforca su monto máx vía la regla amount.
  if (l.rt === 2) { if (l.overrides && l.overrides.amount) delete l.overrides.amount; return l }
  if (l.terms && l.terms.amountMax && !(l.overrides && l.overrides.amount)) {
    if (!l.overrides) l.overrides = {}
    l.overrides.amount = { min: 0, max: l.terms.amountMax }
  }
  return l
}
// ── Entidades CUSTOM (creadas por el usuario en "Entidades del comercio", persistidas en
// localStorage). Se comportan como una entidad base más: se listan, habilitan, seleccionan y
// configuran (Config de lender). CreditopX/agregador/redirect son solo el response_type. ──
const LS_CUSTOM = 'flow-custom-lenders'
function loadCustom() {
  try {
    return (JSON.parse(localStorage.getItem(LS_CUSTOM)) || []).map(d => seedAmountRule(L({
      name: d.name, rt: d.rt, custom: true, producto: d.producto || null,
      terms: d.terms || {}, overrides: d.overrides || {}, entidad: d.entidad || {},
    })))
  } catch { return [] }
}
export const customLenders = reactive(loadCustom())
customLenders.forEach(l => { merchant.enabled[l.name] = true }) // las persistidas nacen habilitadas
watch(customLenders, () => {                                    // persiste catálogo custom + sus ediciones
  try {
    localStorage.setItem(LS_CUSTOM, JSON.stringify(customLenders.map(l =>
      ({ name: l.name, rt: l.rt, producto: l.producto, terms: l.terms, overrides: l.overrides, entidad: l.entidad }))))
  } catch {}
}, { deep: true })
// Crear entidad: Nombre + categoría (rt) + producto. El producto siembra defaults desde su plantilla.
export function addCustomLender(name, rt, producto) {
  const nm = String(name || '').trim()
  if (!nm || customLenders.some(l => l.name === nm)) return null // nombre libre; solo evita duplicar custom
  const tpl = CREDITOPX_PRODUCTS.find(p => p.key === producto)
  const l = seedAmountRule(L({
    name: nm, rt: Number(rt), custom: true, producto: producto || null,
    terms: tpl ? { ...tpl.terms } : { rate: 2.0, maxFee: 24, amountMax: 3000000 },
    overrides: tpl ? clone(tpl.overrides) : {},
  }))
  customLenders.push(l)
  merchant.enabled[nm] = true                     // nace habilitada
  return l
}
export function removeCustomLender(name) {
  const i = customLenders.findIndex(l => l.name === name); if (i < 0) return
  if (ui.selected === name) ui.selected = null
  delete merchant.enabled[name]; delete relationDefs[name] // limpia habilitación + overlay de sucursal
  customLenders.splice(i, 1)
}
// Duplica una entidad custom con nombre único ("X (2)", "X (3)"…), clonando TODA su config.
export function duplicateCustomLender(name) {
  const src = customLenders.find(l => l.name === name); if (!src) return null
  let nm, i = 2
  do { nm = name + ' (' + i++ + ')' } while (customLenders.some(l => l.name === nm))
  const l = L({
    name: nm, rt: src.rt, custom: true, producto: src.producto || null,
    terms: clone(src.terms || {}), overrides: clone(src.overrides || {}), entidad: clone(src.entidad || {}),
  })
  customLenders.push(l)
  merchant.enabled[nm] = true                     // nace habilitada
  return l
}
// Busca la def de un lender por nombre en el catálogo (entidades custom creadas por el usuario).
export function findLenderDef(name) {
  return customLenders.find(l => l.name === name) || null
}

/* ============================================================================
 * Solicitud de onboarding (inputs del cliente).
 * ========================================================================== */
export const state = reactive({
  monto: '1200000',
  salario: '',
  cuotaInicial: 0,
  nombre: 'Ana',
  apellido: 'García',
  tipoDoc: 'CC',
  numDoc: '1032456789',
  fechaExp: '2015-06-20'
})
const montoNum = () => parseInt(String(state.monto).replace(/[^\d]/g, '')) || 0

// Buró editable: cada nodo-proveedor define/edita su parte. Se siembra del documento
// (determinístico) y se re-siembra al cambiar el N° de documento; editar pisa el valor.
export const bureau = reactive({})
// null por-campo: nulls[key]=true simula que el buró NO reportó ese dato (fail-closed).
export const nulls = reactive({})
export function setNull(key, on) { if (on) nulls[key] = true; else delete nulls[key] }
// API caída por proveedor: anula TODOS sus campos (timeout/5xx → sin datos).
export const providerDown = reactive({ experian: false, agil: false, tusdatos: false, mareigua: false, abaco: false })
const PROVIDER_OF = {
  // Datacrédito · Experian (buró)
  score: 'experian', negatives12m: 'experian', currentArrears: 'experian', inquiries6m: 'experian', creditHistoryMonths: 'experian',
  monthlyDebtPayment: 'experian', totalDebt: 'experian', disputes: 'experian', quantoIncome: 'experian',
  // Ágil Data (ingreso/empleo) — FUENTE REAL de edad y género (corrección: antes estaban en TusDatos)
  agilIncome: 'agil', employment: 'agil', agilContinuity: 'agil', edad: 'agil', gender: 'agil',
  // Mareigua (ingreso/empleo, fallback de Ágil Data)
  mareiguaIncome: 'mareigua', mareiguaContinuity: 'mareigua', incomeTrend: 'mareigua',
  // Ábaco (ingreso EXTRA gig — nodo "Información complementaria", informativo; ya no es buró de la cascada)
  abacoIncome: 'abaco',
  // TusDatos (KYC) — identidad + AML (listas movidas desde Mareigua)
  identidad: 'tusdatos', docStatus: 'tusdatos', listas: 'tusdatos',
}
export function fieldNull(key) { return !!nulls[key] || !!providerDown[PROVIDER_OF[key]] }
// Descripción en criollo de cada DATO del buró (para tooltips en ProviderField, hover sobre el nombre).
export const BURO_DESC = {
  score: 'Tu "nota de buen pagador" (0–1000) según DataCrédito, mirando cómo pagaste tus deudas antes. Más alto, mejor.',
  negatives12m: 'Cuántos reportes negativos (deudas mal pagadas o no pagadas) tenés en los últimos 12 meses.',
  currentArrears: 'Cuántas deudas tenés HOY atrasadas, sin pagar (en mora).',
  inquiries6m: 'Cuántas veces consultaron tu buró en 6 meses (muchas = anduviste pidiendo mucho crédito).',
  creditHistoryMonths: 'Hace cuántos meses tenés vida crediticia (antigüedad de tu historial).',
  monthlyDebtPayment: 'Cuánto pagás por mes en cuotas de las deudas que ya tenés.',
  quantoIncome: 'Ingreso ESTIMADO por Experian (modelo Quanto) — es una estimación, no un dato exacto.',
  totalDebt: 'El saldo total que debés hoy (suma de tus deudas). Dato informativo, no decide.',
  disputes: 'Cuántas disputas/reclamos tenés abiertos en el buró. Dato informativo.',
  agilIncome: 'Tu ingreso mensual según ÁgilData (la fuente principal). Sale de aportes/nómina.',
  employment: 'Tu situación laboral: empleado, independiente, pensionado o desempleado.',
  edad: 'Tu edad (dato exacto que trae ÁgilData).',
  gender: 'Tu género.',
  agilContinuity: 'Hace cuánto venís trabajando/cotizando de forma continua (ÁgilData).',
  mareiguaIncome: 'Tu ingreso mensual según Mareigua (fuente alternativa, si ÁgilData no reporta).',
  mareiguaContinuity: 'Continuidad laboral según Mareigua.',
  incomeTrend: 'Tendencia de tu ingreso: creciente, estable o decreciente.',
  abacoIncome: 'Ingreso EXTRA por trabajos gig/informales (Rappi/DiDi/Uber) que valida Ábaco. Se suma aparte al ingreso base — es informativo, no lo reemplaza.',
  identidad: 'Si se pudo confirmar que sos vos (validación de identidad). sí/no.',
  docStatus: 'Estado de tu documento: vigente o cancelado.',
  listas: 'AML (anti-lavado): si aparecés en listas restrictivas de lavado/terrorismo. "limpio" o "hit".',
}
// Pools de nombre (coherentes con el género) — declarados ANTES del seedBureau() de init que
// llama a profile(), para no caer en la TDZ del const.
const NOMBRE_M = ['Juan', 'Carlos', 'Andrés', 'Santiago', 'Felipe', 'David', 'Sergio', 'Mateo']
const NOMBRE_F = ['Ana', 'María', 'Laura', 'Camila', 'Valentina', 'Daniela', 'Paula', 'Sara']
const APELLIDOS = ['García', 'Rodríguez', 'Martínez', 'López', 'González', 'Ramírez', 'Torres', 'Gómez']
function seedBureau(keys) {
  const b = profile(state.numDoc)
  for (const k of (keys || Object.keys(b))) {
    if (k === 'nombre' || k === 'apellido') state[k] = b[k]  // el nombre vive en la solicitud, coherente con el género
    else bureau[k] = b[k]
  }
}
seedBureau()
watch(() => state.numDoc, () => { if (!restoring) seedBureau() }) // no re-sembrar mientras se rehidrata

/* ============================================================================
 * Buró simulado (determinístico por documento). Genera TODOS los datos que
 * consumen las 16 reglas. MOCK: valores y mapeo campo→proveedor ilustrativos.
 * ========================================================================== */
function profile(numDocStr) {
  const digits = String(numDocStr || '').replace(/\D/g, '')
  let h = 2166136261
  for (const ch of digits) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0 }
  const rnd = (n) => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h % n }

  const edad = 18 + rnd(52)                       // Ágil Data (dato exacto)
  const agilIncome = 1000000 + rnd(70) * 100000   // Ágil Data — 1ª prioridad de ingreso
  const mareiguaIncome = 900000 + rnd(55) * 100000 // Mareigua — 2ª prioridad
  const abacoIncome = 850000 + rnd(60) * 100000   // Ábaco — ingreso EXTRA gig (informativo, no entra en la cascada base)
  const quantoIncome = 950000 + rnd(60) * 100000  // Experian · Quanto — 4ª prioridad (estimación)
  const identidad = rnd(100) < 92                 // TusDatos
  const listas = rnd(100) < 6 ? 'hit' : 'limpio'  // TusDatos · AML
  const docStatus = rnd(100) < 96 ? 'vigente' : 'cancelado' // TusDatos
  const gender = rnd(2) === 0 ? 'M' : 'F'         // Ágil Data / Mareigua
  const er = rnd(100)
  const employment = er < 55 ? 'empleado' : er < 82 ? 'independiente' : er < 93 ? 'pensionado' : 'desempleado' // Ágil Data
  const contBucket = () => { const c = rnd(100); return c < 15 ? '<3m' : c < 35 ? '3m' : c < 60 ? '6m' : '12m' }
  const agilContinuity = contBucket()             // Ágil Data (continuidad laboral)
  const mareiguaContinuity = contBucket()         // Mareigua (continuidad laboral)
  const it = rnd(100); const incomeTrend = it < 55 ? 'creciente' : it < 85 ? 'estable' : 'decreciente' // Mareigua

  const file = digits.length >= 6                 // ¿tiene historial en buró?
  let score = null, negatives12m = 0, currentArrears = 0, inquiries6m = 0, creditHistoryMonths = 0
  let monthlyDebtPayment = 0, totalDebt = 0, disputes = 0
  if (file) {
    score = 150 + rnd(801)                         // Datacrédito Experian
    negatives12m = score < 500 ? rnd(6) : rnd(2)   // conteo
    currentArrears = (rnd(100) < (score < 500 ? 40 : 8)) ? rnd(3) + 1 : 0
    inquiries6m = rnd(9)
    creditHistoryMonths = 6 + rnd(115)
    monthlyDebtPayment = rnd(16) * 50000           // Experian · cuota mensual de deuda
    totalDebt = monthlyDebtPayment * (12 + rnd(24)) // Experian · saldo total de deuda
    disputes = rnd(5)                              // Experian · disputas vigentes
  }
  // Nombre COHERENTE con el género (mismo profile determinístico). rnd al final para no correr
  // las derivaciones de arriba (así edad/score/etc. no cambian con este agregado).
  const nombre = (gender === 'M' ? NOMBRE_M : NOMBRE_F)[rnd(NOMBRE_F.length)]
  const apellido = APELLIDOS[rnd(APELLIDOS.length)]
  return { file, edad, agilIncome, mareiguaIncome, abacoIncome, quantoIncome, identidad, listas, docStatus, gender, employment, agilContinuity, mareiguaContinuity, incomeTrend, monthlyDebtPayment, totalDebt, disputes, score, negatives12m, currentArrears, inquiries6m, creditHistoryMonths, nombre, apellido }
}

// El salario declarado (si > 0) sobrescribe el ingreso estimado de Ágil Data.
// Perfil consolidado: aplica los null por-campo + cascada de ingreso (Ágil→Mareigua→declarado→0).
export const perfil = computed(() => {
  const nz = (k) => fieldNull(k) ? null : bureau[k]
  const declarado = parseInt(String(state.salario).replace(/\D/g, '')) || 0
  const agil = fieldNull('agilIncome') ? null : bureau.agilIncome
  const mare = fieldNull('mareiguaIncome') ? null : bureau.mareiguaIncome
  const abaco = fieldNull('abacoIncome') ? null : bureau.abacoIncome // ingreso EXTRA (Ábaco · gig): informativo, NO entra en la cascada base
  const quanto = fieldNull('quantoIncome') ? null : bureau.quantoIncome
  // Cascada de ingreso BASE: Ágil Data → Mareigua → Quanto (Experian) → declarado → 0.
  // Ábaco queda FUERA de la cascada: es un ingreso extra aparte (nodo "Información complementaria"), sin reemplazar el base.
  let salario, salarioFuente
  if (agil != null) { salario = agil; salarioFuente = 'Ágil Data' }
  else if (mare != null) { salario = mare; salarioFuente = 'Mareigua' }
  else if (quanto != null) { salario = quanto; salarioFuente = 'Quanto' }
  else if (declarado > 0) { salario = declarado; salarioFuente = 'declarado' }
  else { salario = 0; salarioFuente = '—' }
  // Endeudamiento DERIVADO: cuota mensual de deuda (Experian) ÷ ingreso (no es un dato de Ágil Data)
  const mdp = fieldNull('monthlyDebtPayment') ? null : bureau.monthlyDebtPayment
  const debtToIncome = mdp == null ? null : (salario > 0 ? Math.min(100, Math.round(mdp / salario * 100)) : 100)
  return {
    score: nz('score'), edad: nz('edad'), gender: nz('gender'), employment: nz('employment'),
    negatives12m: nz('negatives12m'), currentArrears: nz('currentArrears'), inquiries6m: nz('inquiries6m'),
    creditHistoryMonths: nz('creditHistoryMonths'), debtToIncome,
    identidad: nz('identidad'), listas: nz('listas'),
    agilIncome: agil, mareiguaIncome: mare, abacoIncome: abaco, quantoIncome: quanto, salario, salarioFuente,
    continuity: fieldNull('agilContinuity') ? (fieldNull('mareiguaContinuity') ? null : bureau.mareiguaContinuity) : bureau.agilContinuity,
  }
})

const CONT_M = { '<3m': 1, '3m': 3, '6m': 6, '12m': 12 } // bucket de continuidad → meses (para reglas de categoría)
// El SUJETO canónico como computed: cachea la derivación (antes era una función que se reconstruía
// —y re-parseaba el monto— en CADA llamada desde lenders/perfilDiag/sucursalDiag/failingRuleKeys).
const subject = computed(() => {
  const p = perfil.value
  const contB = fieldNull('agilContinuity') ? (fieldNull('mareiguaContinuity') ? null : bureau.mareiguaContinuity) : bureau.agilContinuity
  return {
    amount: montoNum(), documentType: state.tipoDoc,
    score: p.score, age: p.edad, monthlyIncome: p.salario,
    negatives12m: p.negatives12m, currentArrears: p.currentArrears, inquiries6m: p.inquiries6m,
    creditHistoryMonths: p.creditHistoryMonths, debtToIncomePct: p.debtToIncome,
    gender: p.gender, employment: p.employment,
    amlClean: p.listas == null ? null : p.listas === 'limpio',
    identityVerified: p.identidad,
    incomeVerified: !['declarado', '—'].includes(p.salarioFuente), // ingreso de buró (Ágil/Mareigua/Quanto) vs declarado
    continuityMonths: contB == null ? null : (CONT_M[contB] ?? null), // continuidad laboral (Ágil→Mareigua)
  }
})
function subjectOf() { return subject.value }
// Reglas que HOY hacen fallar al lender (para resaltar en el buró)
export function failingRuleKeys(lenderName) {
  const l = findLenderDef(lenderName)
  if (!l) return new Set()
  const s = subjectOf()
  const keys = new Set()
  const g = sucursalGate(lenderName, s, l.rt)           // 2ª capa: datacrédito + group_rules por sucursal
  g.datacredito.fails.forEach(f => keys.add(f.key))
  if (!g.groups.ok) g.groups.groups.forEach(gr => { if (!gr.ok) gr.conds.forEach(x => { if (!x.ok) keys.add(FIELD_TO_RULE[x.c.field] || x.c.field) }) })
  if (l.rt === 2) { // rt=2: el corte de monto lo pone el CUPO de la categoría (no la regla amount) → resalta Monto igual
    const cat = resolveCategory(lenderName)
    const cap = cat ? Math.min(catCupo(l, cat, s), calcValue(merchant.nombre, 'montoMax', l) || Infinity) : 0
    if (cat && s.amount > cap) keys.add('amount')
  }
  return keys
}
// Atribución del rojo del MONTO por nivel: cada tope se pinta rojo SOLO si su propio límite se
// excede (no un genérico). Así el usuario ve qué nivel puntual lo bloquea (comercio ≠ entidad ≠ categoría).
export function montoVsComercio() {
  // Solo pinta rojo si el comercio puso su PROPIO tope (override) y el monto lo supera. Si Monto máx
  // está heredado de la entidad, el límite es de la entidad → que se pinte allá (montoVsEntidad), no acá.
  const ov = merchantCalc[merchant.nombre]
  const cap = ov && ov.montoMax != null ? ov.montoMax : 0
  return cap > 0 && montoNum() > cap
}
export function montoVsEntidad(lenderName) {
  const l = findLenderDef(lenderName); if (!l) return false
  const e = entidadCfg(l); const m = montoNum()
  return (e.amountMin > 0 && m < e.amountMin) || (e.amountMax > 0 && m > e.amountMax)
}
// Computed COMPARTIDO de las reglas que fallan para el lender seleccionado. useFails() lee de acá:
// antes cada componente creaba su propio computed (~20 instancias vía ProviderField + nodos) y cada
// uno re-corría sucursalGate + categoría + cupo en cada cambio del escenario.
export const failing = computed(() => (ui.selected ? failingRuleKeys(ui.selected) : new Set()))

/* ============================================================================
 * PERFILAMIENTO (nivel categoría) — mecanismo REAL que decide enganche/cupo/plazo en rt=2 (CreditopX):
 * tabla lender_users_categories + reglas lender_users_category_rules. El usuario cae en la PRIMERA
 * categoría (por prioridad) cuya regla cumple (ocupación · edad · ingreso[+verificado] · género); esa
 * categoría trae min_initial_fee / max_amount / max_fee_number. NO es del comercio (ver DOCUMENTATION.md §3).
 * ========================================================================== */
export const OCCUPATIONS = ['empleado', 'independiente', 'pensionado', 'desempleado']
// Cada categoría (lender_users_categories): parámetros que trae (enganche/cupo/plazo + fondo del lender
// + capacidad de pago) y su REGLA de asignación (ocupación/edad/ingreso/continuidad/género, por prioridad).
const perfilTemplate = () => [
  { id: 'A', label: 'Premium',  minInitialFee: 10, maxAmount: 5000000, maxFeeNumber: 36, loanLimit: 8000000, usedLoan: 0, capacityCheck: true, capacityPct: 30, priority: 1, occupation: ['empleado', 'pensionado'], minAge: 22, maxAge: 70, minIncome: 2500000, verifiedIncome: true, minContinuity: 12, gender: ['M', 'F'], minScore: 700, maxNegatives: 0, maxDelinq: 0, minHistory: 12, maxInquiries: 4 },
  { id: 'B', label: 'Estándar', minInitialFee: 20, maxAmount: 3000000, maxFeeNumber: 24, loanLimit: 5000000, usedLoan: 0, capacityCheck: true, capacityPct: 30, priority: 2, occupation: ['empleado', 'independiente', 'pensionado'], minAge: 20, maxAge: 75, minIncome: 1200000, verifiedIncome: false, minContinuity: 6, gender: ['M', 'F'], minScore: 550, maxNegatives: 1, maxDelinq: 0, minHistory: 6, maxInquiries: 8 },
  { id: 'C', label: 'Básica',   minInitialFee: 30, maxAmount: 1500000, maxFeeNumber: 12, loanLimit: 3000000, usedLoan: 0, capacityCheck: false, capacityPct: 30, priority: 3, occupation: [...OCCUPATIONS], minAge: 18, maxAge: 80, minIncome: 0, verifiedIncome: false, minContinuity: 0, gender: ['M', 'F'], minScore: 0, maxNegatives: 20, maxDelinq: 10, minHistory: 0, maxInquiries: 20 },
]
// Registro PLANO (no reactivo) con arrays reactivos por lender — como relationDefs, para no mutar
// estado reactivo dentro de computeds. Se siembra desde la plantilla al primer acceso.
const perfilDefs = {}
export function perfilOf(lenderName) {
  if (!perfilDefs[lenderName]) perfilDefs[lenderName] = reactive(perfilTemplate())
  return perfilDefs[lenderName]
}
// Lista negra de documentos (1ra compuerta de getLenderUserCategory) + pre-aprobación externa rt=1.
const perfilBlacklist = reactive({}) // { [lenderName]: bool } — documento en lista negra → sin categoría
const preApproval = reactive({})     // { [lenderName]: 'aprueba' | 'rechaza' | 'timeout' } — API externa rt=1
export function isBlacklisted(lenderName) { return !!perfilBlacklist[lenderName] }
export function setBlacklist(lenderName, on) { perfilBlacklist[lenderName] = !!on; editTick.n++ }
export function preApprovalOf(lenderName) { return preApproval[lenderName] || 'aprueba' }
export function setPreApproval(lenderName, v) { preApproval[lenderName] = v; editTick.n++ }
function catChecks(c, s) {
  return {
    // Perfil (regla de categoría, parte demográfica)
    occupation: s.employment != null && c.occupation.includes(s.employment),
    age: s.age != null && s.age >= c.minAge && s.age <= c.maxAge,
    income: s.monthlyIncome >= c.minIncome && (!c.verifiedIncome || s.incomeVerified),
    continuity: !c.minContinuity || (s.continuityMonths != null && s.continuityMonths >= c.minContinuity),
    gender: s.gender != null && c.gender.includes(s.gender),
    // Riesgo (buró) — también vive DENTRO de la regla de categoría (min_score / negatives / delinquencies /
    // financial_history / consulted). Umbral "abierto" → no restringe; fail-closed si falta el dato.
    score: !(c.minScore > 0) || (s.score != null && s.score >= c.minScore),
    negatives: !(c.maxNegatives < 20) || (s.negatives12m != null && s.negatives12m <= c.maxNegatives),
    delinq: !(c.maxDelinq < 10) || (s.currentArrears != null && s.currentArrears <= c.maxDelinq),
    history: !(c.minHistory > 0) || (s.creditHistoryMonths != null && s.creditHistoryMonths >= c.minHistory),
    inquiries: !(c.maxInquiries < 20) || (s.inquiries6m != null && s.inquiries6m <= c.maxInquiries),
  }
}
// Cupo de una categoría (espejo de LenderUserCategoryService): min(max_amount, fondo del lender)
// INFLADO por el enganche `/(1−fee)`, y topeado por capacidad de pago (anualidad inversa sobre el ingreso).
function catCupo(lender, c, s) {
  const loanAvailable = Math.max(0, (c.loanLimit || 0) - (c.usedLoan || 0))
  const byLender = c.loanLimit ? Math.min(c.maxAmount, loanAvailable) : c.maxAmount
  let cupo = byLender / (1 - (c.minInitialFee || 0) / 100)              // el enganche INFLA lo financiable
  if (c.capacityCheck && s.monthlyIncome > 0) {                        // tope por capacidad de pago
    const r = (entidadCfg(lender).rate || 0) / 100, n = c.maxFeeNumber || 1
    const cuotaMax = s.monthlyIncome * (c.capacityPct || 0) / 100
    const cupoPerfil = r > 0 ? cuotaMax * (1 - Math.pow(1 + r, -n)) / r : cuotaMax * n
    cupo = Math.min(cupo, cupoPerfil)
  }
  return Math.round(cupo)
}
// Resuelve la categoría del usuario para un lender: lista negra → null; si no, la 1ra (por prioridad) que cumple.
export function resolveCategory(lenderName) {
  if (perfilBlacklist[lenderName]) return null
  const s = subjectOf()
  const cats = [...perfilOf(lenderName)].sort((a, b) => a.priority - b.priority)
  for (const c of cats) if (Object.values(catChecks(c, s)).every(Boolean)) return c
  return null
}
export function categoryCupo(lenderName) {
  const l = findLenderDef(lenderName); const c = l ? resolveCategory(lenderName) : null
  return c ? catCupo(l, c, subjectOf()) : 0
}
// Diagnóstico para el nodo Perfilamiento: cada categoría con checks + cupo calculado + cuál ganó.
export function perfilDiag(lenderName) {
  const s = subjectOf(); const l = findLenderDef(lenderName)
  const blacklisted = !!perfilBlacklist[lenderName]
  const cats = [...perfilOf(lenderName)].sort((a, b) => a.priority - b.priority)
  let winner = null
  const rows = cats.map(c => {
    const checks = catChecks(c, s); const ok = !blacklisted && Object.values(checks).every(Boolean)
    const won = ok && winner == null; if (won) winner = c.id
    return { cat: c, checks, ok, won, cupo: l ? catCupo(l, c, s) : 0 }
  })
  return { rows, winner, blacklisted, subject: { employment: s.employment, age: s.age, income: s.monthlyIncome, gender: s.gender, verified: s.incomeVerified, continuity: s.continuityMonths } }
}
// Diagnóstico del lender SELECCIONADO, compartido: el hub Perfilamiento + las 3 tarjetas de categoría
// leen este computed (antes cada nodo evaluaba perfilDiag() por su cuenta = 4 pasadas por render).
export const perfilDiagSel = computed(() => {
  const l = ui.selected ? findLenderDef(ui.selected) : null
  return l && l.rt === 2 ? perfilDiag(ui.selected) : null
})
export function setCatParam(lenderName, id, key, val) { const c = perfilOf(lenderName).find(x => x.id === id); if (c) { c[key] = Number(val); editTick.n++ } }
export function setCatRule(lenderName, id, key, val) { const c = perfilOf(lenderName).find(x => x.id === id); if (c) { c[key] = val; editTick.n++ } }
export function toggleCatSet(lenderName, id, key, opt) { // ocupación/género (chips)
  const c = perfilOf(lenderName).find(x => x.id === id); if (!c) return
  const arr = c[key]; const i = arr.indexOf(opt); if (i >= 0) arr.splice(i, 1); else arr.push(opt); editTick.n++
}
export function perfilSnapshot() {
  return {
    cats: Object.fromEntries(Object.entries(perfilDefs).map(([n, arr]) => [n, clone(arr)])),
    blacklist: { ...perfilBlacklist }, preApproval: { ...preApproval },
  }
}
export function perfilRestore(snap) {
  if (!snap) return
  const cats = snap.cats || snap // compat: formato viejo = solo el mapa de categorías
  for (const [n, c] of Object.entries(cats)) { const cur = perfilOf(n); cur.splice(0, cur.length, ...c) }
  if (snap.blacklist) Object.assign(perfilBlacklist, snap.blacklist)
  if (snap.preApproval) Object.assign(preApproval, snap.preApproval)
}

/* ============================================================================
 * 2ª CAPA · REGLAS POR SUCURSAL (group_rules + datacrédito) — COPIADAS por
 * allied_branch_id. Corren ANTES del perfilamiento (categoría). Semántica fiel
 * al cascade real (ver flow/MAP.md · S5):
 *   · rt=2  → si FALLA se EXCLUYE del listado (inline, hard).
 *   · rt≠2  → si FALLA se CLASIFICA al fondo ("prob. baja"); el datacrédito rt≠2
 *            solo REORDENA, nunca excluye (por eso el lender sigue disponible).
 * Datacrédito = 4 umbrales del buró (score/negativos/consultas/maduración) + allow_0_score.
 * group_rules = grupos de condiciones: AND dentro del grupo, OR entre grupos.
 * Ambos ARRANCAN sembrados desde los overrides del lender (la plantilla
 * allied_branch_id NULL) y se editan por sucursal (deriva) en "Config de sucursal".
 * ========================================================================== */
function cmp(a, op, b) {
  switch (op) { case '>=': return a >= b; case '<=': return a <= b; case '>': return a > b; case '<': return a < b; case '==': return a === b; case '!=': return a !== b }
  return false
}
// Campos que puede referenciar una group_rule (cualquiera del sujeto salvo los 4 del datacrédito).
export const GROUP_FIELDS = [
  { key: 'age', label: 'Edad', kind: 'num', ops: ['>=', '<=', '>', '<'] },
  { key: 'monthlyIncome', label: 'Ingreso mensual', kind: 'money', ops: ['>=', '<=', '>', '<'] },
  { key: 'employment', label: 'Situación laboral', kind: 'set', options: OCCUPATIONS, ops: ['in', 'not in'] },
  { key: 'gender', label: 'Género', kind: 'set', options: ['M', 'F'], ops: ['in', 'not in'] },
  { key: 'documentType', label: 'Tipo de documento', kind: 'set', options: ['CC', 'CE', 'PEP'], ops: ['in', 'not in'] },
  { key: 'amount', label: 'Monto solicitado', kind: 'money', ops: ['>=', '<=', '>', '<'] },
  { key: 'currentArrears', label: 'Mora vigente', kind: 'num', ops: ['<=', '<', '==', '>='] },
  { key: 'debtToIncomePct', label: 'Endeudamiento %', kind: 'num', ops: ['<=', '<', '>='] },
  { key: 'amlClean', label: 'AML limpio', kind: 'bool', ops: ['=='] },
  { key: 'identityVerified', label: 'Identidad verificada', kind: 'bool', ops: ['=='] },
]
export const groupField = (k) => GROUP_FIELDS.find(f => f.key === k)
// campo del sujeto → clave de regla del catálogo (para resaltar el dato en los burós)
const FIELD_TO_RULE = { age: 'age', monthlyIncome: 'monthlyIncome', employment: 'employment', gender: 'gender', documentType: 'documentTypes', amount: 'amount', currentArrears: 'currentArrears', debtToIncomePct: 'debtToIncomePct', amlClean: 'requireCleanAml', identityVerified: 'requireVerifiedIdentity' }

// ── Datacrédito por sucursal (umbral abierto = no restringe) ──────────────────
const sucDatacredito = {} // { [lenderName]: reactive({...}) }
// Valores BASE del datacrédito = lo que se COPIA del lender a la sucursal (el "template" del cascade real).
// Es el padre del que hereda la sucursal: el punto gris/amarillo compara contra esto.
function datacreditoSeed(name) {
  const l = findLenderDef(name); const ov = (l && l.overrides) || {}
  const minScore = (ov.score && ov.score.min) || 0
  const maxNeg = ov.negatives12m && ov.negatives12m.max
  const maxInq = ov.inquiries6m && ov.inquiries6m.max
  const minMat = (ov.creditHistoryMonths && ov.creditHistoryMonths.min) || 0
  const allowZeroScore = l ? ruleValue(l, 'acceptThinFile') !== false : true
  return {
    minScore, maxNegatives: maxNeg != null ? maxNeg : 20, maxInquiries: maxInq != null ? maxInq : 20,
    minMaturation: minMat, allowZeroScore,
    enabled: minScore > 0 || maxNeg != null || maxInq != null || minMat > 0 || !allowZeroScore,
  }
}
function seedDatacredito(name) { return reactive(datacreditoSeed(name)) }
export function sucursalDatacreditoOf(name) { if (!sucDatacredito[name]) sucDatacredito[name] = seedDatacredito(name); return sucDatacredito[name] }
// Herencia: gris = igual al valor copiado del lender; amarillo = esta sucursal lo editó. Clic → revertir al base.
export function datacreditoInherit(name, key) { return sucursalDatacreditoOf(name)[key] === datacreditoSeed(name)[key] ? 'heredada' : 'editada' }
export function resetDatacredito(name, key) { sucursalDatacreditoOf(name)[key] = datacreditoSeed(name)[key]; editTick.n++ }
export function setDatacredito(name, key, val) { const d = sucursalDatacreditoOf(name); d[key] = typeof d[key] === 'boolean' ? !!val : Number(val); editTick.n++ }
export function toggleDatacredito(name, on) { sucursalDatacreditoOf(name).enabled = !!on; editTick.n++ }
function evalDatacredito(name, s) {
  const d = sucursalDatacreditoOf(name)
  if (!d.enabled) return { on: false, ok: true, fails: [] }
  const fails = []
  if (s.score == null) { // thin file: lo gobierna allow_0_score; sin score no se evalúan los umbrales numéricos
    if (!d.allowZeroScore) fails.push({ key: 'score', reason: 'sin historial (thin file)' })
    return { on: true, ok: fails.length === 0, fails }
  }
  if (d.minScore > 0 && s.score < d.minScore) fails.push({ key: 'score', reason: `score ${s.score} < ${d.minScore}` })
  if (d.maxNegatives < 20) { if (s.negatives12m == null) fails.push({ key: 'negatives12m', reason: 'negativos sin dato' }); else if (s.negatives12m > d.maxNegatives) fails.push({ key: 'negatives12m', reason: `negativos ${s.negatives12m} > ${d.maxNegatives}` }) }
  if (d.maxInquiries < 20) { if (s.inquiries6m == null) fails.push({ key: 'inquiries6m', reason: 'consultas sin dato' }); else if (s.inquiries6m > d.maxInquiries) fails.push({ key: 'inquiries6m', reason: `consultas ${s.inquiries6m} > ${d.maxInquiries}` }) }
  if (d.minMaturation > 0) { if (s.creditHistoryMonths == null) fails.push({ key: 'creditHistoryMonths', reason: 'maduración sin dato' }); else if (s.creditHistoryMonths < d.minMaturation) fails.push({ key: 'creditHistoryMonths', reason: `maduración ${s.creditHistoryMonths}m < ${d.minMaturation}m` }) }
  return { on: true, ok: fails.length === 0, fails }
}

// ── group_rules por sucursal (AND dentro del grupo · OR entre grupos) ─────────
const sucGroups = {} // { [lenderName]: reactive([ { conds: [{field,op,value}] } ]) }
function seedGroups(name) {
  const l = findLenderDef(name); const ov = (l && l.overrides) || {}; const conds = []
  if (ov.age) { if (ov.age.min > 18) conds.push({ field: 'age', op: '>=', value: ov.age.min }); if (ov.age.max < 100) conds.push({ field: 'age', op: '<=', value: ov.age.max }) }
  if (ov.monthlyIncome && ov.monthlyIncome.min > 0) conds.push({ field: 'monthlyIncome', op: '>=', value: ov.monthlyIncome.min })
  if (ov.documentTypes && ov.documentTypes.length < 3) conds.push({ field: 'documentType', op: 'in', value: [...ov.documentTypes] })
  if (ov.employment && ov.employment.length < 4) conds.push({ field: 'employment', op: 'in', value: [...ov.employment] })
  if (ov.gender && ov.gender.length < 2) conds.push({ field: 'gender', op: 'in', value: [...ov.gender] })
  if (ov.requireCleanAml === true) conds.push({ field: 'amlClean', op: '==', value: true })
  if (ov.requireVerifiedIdentity === true) conds.push({ field: 'identityVerified', op: '==', value: true })
  return reactive(conds.length ? [{ conds }] : [])
}
export function sucursalGroupsOf(name) { if (!sucGroups[name]) sucGroups[name] = seedGroups(name); return sucGroups[name] }
export function addGroup(name) { sucursalGroupsOf(name).push({ conds: [{ field: 'age', op: '>=', value: 18 }] }); editTick.n++ }
export function removeGroup(name, gi) { const g = sucursalGroupsOf(name); if (gi >= 0 && gi < g.length) g.splice(gi, 1); editTick.n++ }
export function addCond(name, gi) { const g = sucursalGroupsOf(name)[gi]; if (g) g.conds.push({ field: 'age', op: '>=', value: 18 }); editTick.n++ }
export function removeCond(name, gi, ci) { const g = sucursalGroupsOf(name)[gi]; if (!g) return; g.conds.splice(ci, 1); if (!g.conds.length) removeGroup(name, gi); editTick.n++ }
export function setCond(name, gi, ci, patch) {
  const g = sucursalGroupsOf(name)[gi]; if (!g || !g.conds[ci]) return
  const c = g.conds[ci]
  if ('field' in patch) { c.field = patch.field; const f = groupField(patch.field); c.op = f.ops[0]; c.value = f.kind === 'set' ? [...f.options] : f.kind === 'bool' ? true : 0 }
  if ('op' in patch) c.op = patch.op
  if ('value' in patch) c.value = f_num(g.conds[ci], patch.value)
  editTick.n++
}
function f_num(c, v) { const f = groupField(c.field); return (f && (f.kind === 'num' || f.kind === 'money')) ? Number(v) : v }
export function toggleCondSet(name, gi, ci, opt) {
  const c = sucursalGroupsOf(name)[gi] && sucursalGroupsOf(name)[gi].conds[ci]; if (!c || !Array.isArray(c.value)) return
  const i = c.value.indexOf(opt); if (i >= 0) c.value.splice(i, 1); else c.value.push(opt); editTick.n++
}
function evalCond(c, s) {
  const sv = s[c.field]; const f = groupField(c.field)
  if (sv == null) return { ok: false, reason: `${f ? f.label : c.field} sin dato` } // fail-closed
  if (f.kind === 'set') { const arr = Array.isArray(c.value) ? c.value : []; const has = arr.includes(sv); const ok = c.op === 'in' ? has : !has; return { ok, reason: ok ? '' : `${sv} ${c.op === 'in' ? '∉' : '∈'} {${arr.join(', ')}}` } }
  if (f.kind === 'bool') { const ok = !!sv === !!c.value; return { ok, reason: ok ? '' : `${f.label}=${sv ? 'sí' : 'no'}` } }
  const v = Number(c.value); const ok = cmp(Number(sv), c.op, v); const disp = f.kind === 'money' ? money : (x) => x
  return { ok, reason: ok ? '' : `${disp(sv)} ${c.op} ${disp(v)}` }
}
function evalGroups(name, s) {
  const groups = sucursalGroupsOf(name)
  if (!groups.length) return { on: false, ok: true, groups: [] }
  const gr = groups.map(g => { const conds = g.conds.map(c => ({ c, ...evalCond(c, s) })); return { ok: conds.length > 0 && conds.every(x => x.ok), conds } })
  return { on: true, ok: gr.some(g => g.ok), groups: gr } // OR entre grupos
}
// Compuerta completa de la 2ª capa para un lender: datacrédito AND group_rules.
export function sucursalGate(name, s, rt) {
  const dc = evalDatacredito(name, s), gr = evalGroups(name, s)
  const ok = dc.ok && gr.ok
  const reason = !dc.ok ? dc.fails[0].reason : (!gr.ok ? 'no cumple ningún grupo de reglas' : null)
  return { datacredito: dc, groups: gr, ok, reason, verdict: ok ? 'pass' : (rt === 2 ? 'exclude' : 'classify') }
}
export function sucursalActiveCount(name) {
  const d = sucursalDatacreditoOf(name); let n = 0
  if (d.enabled) { if (d.minScore > 0) n++; if (d.maxNegatives < 20) n++; if (d.maxInquiries < 20) n++; if (d.minMaturation > 0) n++; if (!d.allowZeroScore) n++ }
  return n + sucursalGroupsOf(name).reduce((a, g) => a + g.conds.length, 0)
}
// Diagnóstico para el nodo Config de sucursal: compuerta evaluada contra el sujeto actual.
export function sucursalDiag(name) {
  const s = subjectOf(); const l = findLenderDef(name)
  return { gate: sucursalGate(name, s, l ? l.rt : 0), datacredito: sucursalDatacreditoOf(name), groups: sucursalGroupsOf(name) }
}

/* ============================================================================
 * TRAMO POR MONTO (creditop_x_conditions_by_amount_by_lender) — SOLO rt=2.
 * Config de la entidad (por lender_id, como las categorías). Es el ÚLTIMO ajuste
 * del cascade: según el MONTO pedido elige una franja [desde, hasta) que
 *   · RECORTA los plazos (fee ≤ maxFee; si 'mandatory' > 0, solo ese plazo), y
 *   · TOPEA el cupo (hasta 'hasta').
 * NO toca el enganche (lo fija la categoría). Manda el MÁS restrictivo entre
 * categoría y tramo. Monto por debajo del primer 'desde' → rechazo (below_min_amount).
 * Ver flow/MAP.md · S5.
 * ========================================================================== */
const tramoTemplate = () => [
  { min: 0, max: 1500000, maxFee: 12, mandatory: 0 },
  { min: 1500000, max: 3000000, maxFee: 24, mandatory: 0 },
  { min: 3000000, max: 8000000, maxFee: 36, mandatory: 0 },
]
const tramoDefs = {}            // { [lenderName]: reactive([{min,max,maxFee,mandatory}]) } — registro plano
const tramoState = reactive({}) // { [lenderName]: { on } } — default ON para rt=2
export function tramosOf(name) { if (!tramoDefs[name]) tramoDefs[name] = reactive(tramoTemplate()); return tramoDefs[name] }
export function tramoIsOn(name) { const st = tramoState[name]; return st ? !!st.on : true }
export function setTramoOn(name, on) { if (!tramoState[name]) tramoState[name] = {}; tramoState[name].on = !!on; editTick.n++ }
export function addTramo(name) {
  const ts = tramosOf(name); const last = ts[ts.length - 1]; const min = last ? last.max : 0
  ts.push({ min, max: min + 1500000, maxFee: last ? last.maxFee : 12, mandatory: 0 }); editTick.n++
}
export function removeTramo(name, i) { const ts = tramosOf(name); if (i >= 0 && i < ts.length) ts.splice(i, 1); editTick.n++ }
export function setTramo(name, i, key, val) { const t = tramosOf(name)[i]; if (t) { t[key] = Number(val); editTick.n++ } }
// Franja que aplica al monto (ordenada por 'desde'); null si el monto está por debajo del primer 'desde'.
export function selectTramo(name, amount) {
  const ts = [...tramosOf(name)].sort((a, b) => a.min - b.min)
  if (!ts.length) return null
  if (amount < ts[0].min) return null                 // below_min_amount → rechazo
  for (const t of ts) if (amount >= t.min && amount < t.max) return t
  return ts[ts.length - 1]                             // por encima de todo → cae en el último (se topea)
}
// Índice de la franja activa según el monto actual (para resaltar en el nodo). -1 = sin tramo/off.
export function activeTramoIndex(name) {
  if (!tramoIsOn(name)) return -1
  const tr = selectTramo(name, montoNum()); return tr ? tramosOf(name).indexOf(tr) : -1
}

const PROB_RANK = { alta: 0, media: 1, baja: 2 }
export const lenders = computed(() => {
  const s = subjectOf()
  const active = customLenders.filter(l => merchant.enabled[l.name] && branchStatusOf(l.name)) // catálogo del comercio (lenders_by_allieds) ∩ activas en la sucursal (lenders_by_allied_branches.status)
  return active.map(l => {
    // Tope del comercio (lenders_by_allieds.max_amount) POR entidad: hereda el máx de ESA entidad
    // (credit_line_by_lenders) salvo que el comercio lo haya pisado con un override propio.
    const montoMaxCom = calcValue(merchant.nombre, 'montoMax', l) || Infinity
    const gate = sucursalGate(l.name, s, l.rt)   // 2ª capa: group_rules + datacrédito por sucursal (ANTES del perfilamiento)
    const t = l.terms || {}
    let ok = true, prob = 'alta', pct, cupo, dues = entidadCfg(l).dues, cat = null
    let reason = s.score == null ? 'sin historial, cumple' : `score ${s.score} · edad ${s.age}`
    if (!gate.ok) {
      if (l.rt === 2) { ok = false; reason = 'excluido: ' + gate.reason }   // rt=2 → EXCLUYE del listado
      else { prob = 'baja'; reason = 'prob. baja: ' + gate.reason }         // rt≠2 → CLASIFICA (se conserva, no excluye)
    }
    if (l.rt === 2) {                            // CreditopX: la CATEGORÍA de perfilamiento decide enganche/cupo/plazo
      if (ok) {                                  // …solo si pasó la 2ª capa
        cat = resolveCategory(l.name)
        pct = cat ? cat.minInitialFee : 0
        let catC = cat ? Math.min(catCupo(l, cat, s), montoMaxCom) : 0 // cupo real (fondo + enganche + capacidad)
        if (cat) {
          dues = dues.filter(n => n <= cat.maxFeeNumber)               // techo de plazos de la categoría
          if (tramoIsOn(l.name) && tramosOf(l.name).length) {          // TRAMO por monto: recorta plazos + topea cupo (NO toca enganche)
            const tr = selectTramo(l.name, s.amount)                   // (sin franjas definidas = sin restricción)
            if (!tr) { ok = false; reason = 'monto por debajo del mínimo (tramo)' }
            else {
              catC = Math.min(catC, tr.max)                            // topea el cupo al 'hasta' del tramo
              dues = tr.mandatory ? dues.filter(n => n === tr.mandatory) : dues.filter(n => n <= tr.maxFee) // recorta dentro del techo
            }
          }
        } else { ok = false; reason = isBlacklisted(l.name) ? 'documento en lista negra' : 'sin categoría de perfilamiento' }
        if (ok && s.amount > catC) { ok = false; reason = `monto > cupo ${money(catC)}` }
        cupo = Math.min(s.amount, catC)
      } else { pct = 0; cupo = 0 }
    } else {                                     // rt≠2: enganche por regla del lender; la API externa decide (pre-aprobación)
      pct = ruleValue(l, 'initialFeePct') || 0
      cupo = Math.min(t.amountMax || Infinity, montoMaxCom)
      if (l.rt === 1 && ok) {                    // pre-aprobación externa rt=1: la API de la entidad decide
        const pa = preApprovalOf(l.name)
        if (pa === 'rechaza') { ok = false; reason = 'su API: rechazado' }
        else if (pa === 'timeout') { ok = false; reason = 'su API: timeout' }
      }
    }
    return {
      name: l.name, rt: l.rt, category: cat ? cat.label : (l.category || null), catId: cat ? cat.id : null,
      ok, reason, prob, initialFeePct: pct, initialFeeAmount: Math.round((pct || 0) / 100 * s.amount),
      rate: t.rate, maxFee: t.maxFee, amountMax: t.amountMax, dues, cupo,
    }
  }).sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0) || (PROB_RANK[a.prob] ?? 0) - (PROB_RANK[b.prob] ?? 0))
})

// Cuota mensual ENSAMBLADA, fiel al pagaré real (PromissoryNoteController):
// capital = financiado + costos admin + fondo de garantías·1.19 (IVA 19% fijo); cuota = anualidad(capital) + seguros.
// El enganche (que resta al financiado) sale de la CATEGORÍA de perfilamiento en rt=2.
export function cuotaBreakdown(l, n) {
  const monto = montoNum(), c = merchant.nombre, rate = (l.rate || 0) / 100
  if (!monto || !n) return { cuota: 0, financiado: 0, admin: 0, fga: 0, seguros: 0, capital: 0 }
  const financiado = Math.max(0, monto - (l.initialFeeAmount || 0))
  const admin = financiado * (calcValue(c, 'costosAdmin') / 100) + calcValue(c, 'cargoFijo')
  const fga = (financiado + admin) * (calcValue(c, 'fondoGarantias') / 100) * 1.19 // IVA 19% fijo (fiel)
  const capital = financiado + admin + fga
  const base = rate ? capital * rate / (1 - Math.pow(1 + rate, -n)) : capital / n
  const seguros = financiado * (calcValue(c, 'seguroVidaVar') / 100) + calcValue(c, 'seguroVidaFijo')
  return { cuota: Math.round(base + seguros), financiado: Math.round(financiado), admin: Math.round(admin), fga: Math.round(fga), seguros: Math.round(seguros), capital: Math.round(capital) }
}
export const availableCount = computed(() => lenders.value.filter(l => l.ok).length)

// ── POST-SELECCIÓN · el ciclo de vida DESPUÉS de elegir (estado 3 = "Seleccion de entidad") ────────
// La cadena se RAMIFICA por response_type, igual que el perfilamiento. Cada etapa es un toggle;
// creditStatus() camina la cadena y devuelve el terminal → función PURA de (rt + toggles), sin estado
// propio que se desincronice (mismo espíritu que preApproval/providerDown). Persiste en el snapshot.
// Fidelidad: rt=1 la pre-aprobación YA ocurrió en el listado; acá es la FORMALIZACIÓN (2ª decisión
// externa, no inyectable localmente). rt=0 no corre nada local (redirige y pierde visibilidad). rt=2/3
// corre local, estado por estado, hasta el Estado 11.
export const postSel = reactive({}) // { [lenderName]: { plan|kyc|firma|enganche | radica|decision | redirect } }
function postSelBag(name) { if (!postSel[name]) postSel[name] = {}; return postSel[name] }
export function setPostSel(name, key, val) { postSelBag(name)[key] = val; editTick.n++ }
// Cadena ordenada por rt. `pass` = el valor del toggle que DEJA avanzar; cualquier otro corta ahí.
const POSTSEL_STEPS = {
  0: [{ key: 'redirect', pass: 'abre' }],
  1: [{ key: 'radica', pass: 'radica' }, { key: 'decision', pass: 'aprueba' }],
  2: [{ key: 'plan', pass: 'elige' }, { key: 'kyc', pass: 'valida' }, { key: 'firma', pass: 'firma' }, { key: 'enganche', pass: 'paga' }],
}
POSTSEL_STEPS[3] = POSTSEL_STEPS[2] // rotativo = in-platform, misma cadena que CreditopX
export function postSelSteps(rt) { return POSTSEL_STEPS[rt] || [] }
// Valor actual de una etapa; por defecto su `pass` (arranca todo en verde → llega al terminal feliz).
export function postSelVal(name, key) {
  const b = postSel[name]
  if (b && b[key] != null) return b[key]
  const l = findLenderDef(name)
  return (l ? postSelSteps(l.rt) : []).find(s => s.key === key)?.pass ?? ''
}
// ¿Aplica la etapa al lender/sujeto actual? Solo el enganche es condicional (initial_fee>0).
export function postSelApplies(name, key) {
  if (key !== 'enganche') return true
  const r = lenders.value.find(x => x.name === name)
  return !!(r && r.initialFeePct > 0)
}
// Camina la cadena → terminal. failedAt = 1ª etapa aplicable que no pasó (null si llegó al final).
export function creditStatus(name) {
  const l = findLenderDef(name); if (!l) return null
  for (const s of postSelSteps(l.rt)) {
    if (!postSelApplies(name, s.key)) continue
    if (postSelVal(name, s.key) !== s.pass) return { ok: false, failedAt: s.key, rt: l.rt }
  }
  return { ok: true, failedAt: null, rt: l.rt }
}

// Productos DISTINTOS que ofrece el comercio, derivados de sus entidades habilitadas (por `producto`).
// Orden estable crédito → renting → renting c/compra.
const PRODUCTO_LABELS = { credito: 'Crédito', renting: 'Renting', rto: 'Renting con compra' }
const PRODUCTO_SHORT = { credito: 'C', renting: 'R', rto: 'RB' }
export const merchantProductos = computed(() => {
  const keys = new Set(customLenders.filter(l => merchant.enabled[l.name]).map(l => l.producto).filter(Boolean))
  return ['credito', 'renting', 'rto'].filter(k => keys.has(k)).map(k => ({ key: k, label: PRODUCTO_LABELS[k], short: PRODUCTO_SHORT[k] }))
})

/* ============================================================================
 * PERSISTENCIA DEL GRAFO (escenario) en localStorage. Guarda comercio, solicitud,
 * ediciones del buró, overlays de sucursal, calculadora y selección. El tema y los
 * toggles de visibilidad los persiste settings.js aparte; las entidades custom tienen
 * su propia clave. Snapshot versionado: si cambia el formato, se ignora (defaults).
 * ========================================================================== */
const GRAPH_KEY = 'flow-graph'
const GRAPH_VERSION = 1
function graphSnapshot() {
  return {
    version: GRAPH_VERSION,
    merchant: { nombre: merchant.nombre, sucursal: merchant.sucursal, enabled: { ...merchant.enabled } },
    canal: { ...canal },
    state: { ...state },
    bureau: { ...bureau },
    nulls: { ...nulls },
    providerDown: { ...providerDown },
    merchantCalc: clone(merchantCalc),
    relations: Object.fromEntries(Object.entries(relationDefs).map(([n, r]) => [n, clone(r.overrides)])), // overlays de sucursal
    perfiles: perfilSnapshot(), // categorías de perfilamiento editadas por lender
    sucursal: { // 2ª capa por sucursal (status + group_rules + datacrédito)
      status: { ...branchStatus }, // lenders_by_allied_branches.status (activa/inactiva por sucursal)
      datacredito: Object.fromEntries(Object.entries(sucDatacredito).map(([n, d]) => [n, { ...d }])),
      groups: Object.fromEntries(Object.entries(sucGroups).map(([n, g]) => [n, clone(g)])),
    },
    tramos: { // tramo por monto (config de entidad, rt=2)
      defs: Object.fromEntries(Object.entries(tramoDefs).map(([n, t]) => [n, clone(t)])),
      state: { ...tramoState },
    },
    postSel: clone(postSel), // ciclo de vida post-selección (toggles por etapa/lender)
    selected: ui.selected,
  }
}
function saveGraph() { try { localStorage.setItem(GRAPH_KEY, JSON.stringify(graphSnapshot())); persistPing.n++ } catch {} }
function restoreGraph() {
  let snap
  try { snap = JSON.parse(localStorage.getItem(GRAPH_KEY)) } catch { return }
  if (!snap || snap.version !== GRAPH_VERSION) return
  restoring = true // evita que el watch de numDoc re-siembre el buró encima de lo persistido
  try {
    if (snap.merchant) { merchant.nombre = snap.merchant.nombre; merchant.sucursal = snap.merchant.sucursal; Object.assign(merchant.enabled, snap.merchant.enabled) }
    if (snap.canal) Object.assign(canal, snap.canal)
    if (snap.state) Object.assign(state, snap.state)
    if (snap.bureau) Object.assign(bureau, snap.bureau)
    if (snap.nulls) { Object.keys(nulls).forEach(k => delete nulls[k]); Object.assign(nulls, snap.nulls) }
    if (snap.providerDown) Object.assign(providerDown, snap.providerDown)
    if (snap.merchantCalc) Object.assign(merchantCalc, snap.merchantCalc)
    if (snap.relations) for (const [n, ov] of Object.entries(snap.relations)) { const l = findLenderDef(n); if (l) Object.assign(relationOf(l).overrides, ov) }
    if (snap.perfiles) perfilRestore(snap.perfiles)
    if (snap.sucursal) {
      if (snap.sucursal.status) Object.assign(branchStatus, snap.sucursal.status)
      if (snap.sucursal.datacredito) for (const [n, d] of Object.entries(snap.sucursal.datacredito)) Object.assign(sucursalDatacreditoOf(n), d)
      if (snap.sucursal.groups) for (const [n, g] of Object.entries(snap.sucursal.groups)) { const cur = sucursalGroupsOf(n); cur.splice(0, cur.length, ...g) }
    }
    if (snap.tramos) {
      if (snap.tramos.defs) for (const [n, t] of Object.entries(snap.tramos.defs)) { const cur = tramosOf(n); cur.splice(0, cur.length, ...t) }
      if (snap.tramos.state) Object.assign(tramoState, snap.tramos.state)
    }
    if (snap.postSel) Object.assign(postSel, snap.postSel)
    if (snap.selected !== undefined) ui.selected = snap.selected
  } catch { /* snapshot corrupto: quedamos con lo que se haya aplicado */ }
  nextTick(() => { restoring = false })
}
restoreGraph() // rehidrata al cargar el módulo (después de que todo está definido)
let saveTimer
watch([merchant, canal, state, bureau, nulls, providerDown, merchantCalc, () => ui.selected, () => editTick.n],
  () => { if (restoring) return; clearTimeout(saveTimer); saveTimer = setTimeout(saveGraph, 400) },
  { deep: true })
// "Reiniciar": borra escenario + entidades custom y recarga (tema/toggles se conservan).
export function resetGraph() {
  try { localStorage.removeItem(GRAPH_KEY); localStorage.removeItem(LS_CUSTOM) } catch {}
  location.reload()
}
