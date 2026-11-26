<script setup>
import { computed } from 'vue'
import { state, bureau, clientProfile as profile, setNull, editTick, money, requestDocumentTypes } from './store'

// El cliente de la solicitud: TODOS los datos que deciden en Flow —los grupos de reglas de la sucursal, las reglas de
// centrales y las de cada categoría—, para poder hacer cumplir (o fallar) cualquier categoría desde acá. Vive en el
// sidebar «Escenario» y vale para las dos vistas: el grafo y la tabla leen lo mismo de `store.js`. (2026-11-26: se
// sumaron género, identidad, listas, fuente del ingreso, mora, consultas e historia, que sólo estaban en los nodos.)
const EMP = [['empleado', 'Empleado'], ['independiente', 'Independiente'], ['pensionado', 'Pensionado'], ['desempleado', 'Desempleado']]
const CONT = [['<3m', '< 3 meses'], ['3m', '3 meses'], ['6m', '6 meses'], ['12m', '12 meses o más']]
const GENDER = [['F', 'Mujer'], ['M', 'Hombre']]
function setBureau(key, v, numeric = true) {
  bureau[key] = numeric ? (v === '' ? null : Number(v)) : v
  setNull(key, v === '' || v == null)
  editTick.n++
}
const digits = (v) => String(v).replace(/\D/g, '')
function setAmount(v) { state.monto = digits(v); editTick.n++ }

// El ingreso sale de la primera central que lo trae (Ágil Data → Mareigua → Quanto) o, si ninguna, del declarado. La
// fuente importa: «ingreso verificado» exige una central, y Finandina sólo acepta Ágil Data o Mareigua. Elegir la fuente
// deja el mismo monto en esa central y apaga las que van antes en la cascada (como si no hubieran contestado).
const SOURCES = [['agilIncome', 'Ágil Data'], ['mareiguaIncome', 'Mareigua'], ['quantoIncome', 'Quanto'], ['declared', 'Declarado']]
const sourceKey = computed(() => (SOURCES.find(([, label]) => label === profile.value.salarioFuente) || ['declared'])[0])
function setIncomeAt(key, n) {
  if (key === 'declared') state.salario = String(n)
  else { bureau[key] = n; setNull(key, false) }
}
function setIncome(v) { const n = Number(digits(v)) || 0; setIncomeAt(sourceKey.value, n); editTick.n++ }
function setIncomeSource(key) {
  const n = profile.value.salario || 0
  for (const [k] of SOURCES) {
    if (k === key) break
    setNull(k, true)                                   // las de antes en la cascada no contestaron
  }
  setIncomeAt(key, n)
  editTick.n++
}

// Los tipos de documento del país del comercio (o todos si no tiene), y el actual aunque no esté en la lista.
const documentTypes = computed(() => {
  const list = requestDocumentTypes()
  return list.includes(state.tipoDoc) ? list : [state.tipoDoc, ...list].filter(Boolean)
})
function setDocumentType(v) { state.tipoDoc = v; editTick.n++ }
const amount = computed(() => parseInt(digits(state.monto)) || 0)
</script>

<template>
  <!-- Cuatro grupos: lo que pide, quién es, de qué vive y qué dice el buró. Cada campo es una fila de rótulo y control
       compacto (28), como las preferencias de VS Code: en 300 de ancho se lee de un vistazo. -->
  <div class="client-form">
    <div class="cf-group">Solicitud</div>
    <label class="cf-row"><span class="cf-label">Monto</span>
      <input class="input input-sm" inputmode="numeric" :value="money(amount)" @change="e => setAmount(e.target.value)" /></label>
    <label class="cf-row"><span class="cf-label">Documento</span>
      <span class="select"><select class="input input-sm" :value="state.tipoDoc" @change="e => setDocumentType(e.target.value)">
        <option v-for="d in documentTypes" :key="d" :value="d">{{ d }}</option>
      </select></span></label>

    <div class="cf-group">Persona</div>
    <label class="cf-row"><span class="cf-label">Edad</span>
      <input class="input input-sm" type="number" :value="profile.edad ?? ''" @change="e => setBureau('edad', e.target.value)" /></label>
    <label class="cf-row" title="El de Ágil Data. Lo piden los grupos de reglas de algunas sucursales y las categorías."><span class="cf-label">Género</span>
      <span class="select"><select class="input input-sm" :value="profile.gender ?? ''" @change="e => setBureau('gender', e.target.value, false)">
        <option v-for="[k, t] in GENDER" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-row" title="TusDatos: si se pudo validar la identidad. Lo exige la regla «identidad verificada» de la sucursal."><span class="cf-label">Identidad</span>
      <span class="select"><select class="input input-sm" :value="profile.identidad === false ? 'no' : 'si'" @change="e => setBureau('identidad', e.target.value === 'si', false)">
        <option value="si">Verificada</option><option value="no">No verificada</option>
      </select></span></label>
    <label class="cf-row" title="TusDatos: listas restrictivas (lavado, terrorismo). Lo exige la regla «AML limpio» de la sucursal."><span class="cf-label">Listas AML</span>
      <span class="select"><select class="input input-sm" :value="profile.listas ?? 'limpio'" @change="e => setBureau('listas', e.target.value, false)">
        <option value="limpio">Limpio</option><option value="hit">Con coincidencia</option>
      </select></span></label>

    <div class="cf-group">Ingreso y empleo</div>
    <label class="cf-row"><span class="cf-label">Ingreso</span>
      <input class="input input-sm" inputmode="numeric" :value="money(profile.salario)" @change="e => setIncome(e.target.value)" /></label>
    <label class="cf-row" title="De dónde sale el ingreso. «Ingreso verificado» exige una central; Finandina, Ágil Data o Mareigua."><span class="cf-label">Fuente del ingreso</span>
      <span class="select"><select class="input input-sm" :value="sourceKey" @change="e => setIncomeSource(e.target.value)">
        <option v-for="[k, t] in SOURCES" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-row"><span class="cf-label">Ocupación</span>
      <span class="select"><select class="input input-sm" :value="profile.employment ?? ''" @change="e => setBureau('employment', e.target.value, false)">
        <option v-for="[k, t] in EMP" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-row"><span class="cf-label">Continuidad</span>
      <span class="select"><select class="input input-sm" :value="bureau.agilContinuity ?? ''" @change="e => setBureau('agilContinuity', e.target.value, false)">
        <option v-for="[k, t] in CONT" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-row" title="Lo que paga por mes en cuotas de las deudas que ya tiene (Experian). La capacidad de Finandina lo descuenta.">
      <span class="cf-label">Cuotas que paga</span>
      <input class="input input-sm" inputmode="numeric" :value="money(bureau.monthlyDebtPayment ?? 0)" @change="e => setBureau('monthlyDebtPayment', digits(e.target.value) || 0)" /></label>

    <div class="cf-group">Buró</div>
    <label class="cf-row"><span class="cf-label">Score</span>
      <input class="input input-sm" type="number" :value="profile.score ?? ''" @change="e => setBureau('score', e.target.value)" /></label>
    <label class="cf-row"><span class="cf-label">Negativos 12m</span>
      <input class="input input-sm" type="number" :value="profile.negatives12m ?? ''" @change="e => setBureau('negatives12m', e.target.value)" /></label>
    <label class="cf-row" title="Obligaciones en mora hoy (Experian)."><span class="cf-label">Mora vigente</span>
      <input class="input input-sm" type="number" :value="profile.currentArrears ?? ''" @change="e => setBureau('currentArrears', e.target.value)" /></label>
    <label class="cf-row" title="Cuántas veces lo consultaron en centrales en los últimos 6 meses (Experian)."><span class="cf-label">Consultas 6m</span>
      <input class="input input-sm" type="number" :value="profile.inquiries6m ?? ''" @change="e => setBureau('inquiries6m', e.target.value)" /></label>
    <label class="cf-row" title="Meses desde su primer crédito (Experian). Lo usan la madurez de las centrales y la «historia» de las categorías.">
      <span class="cf-label">Historia crediticia<small>meses</small></span>
      <input class="input input-sm" type="number" :value="profile.creditHistoryMonths ?? ''" @change="e => setBureau('creditHistoryMonths', e.target.value)" /></label>
    <label class="cf-row" title="Si tuvo un crédito de al menos el mínimo de la entidad. Sin experiencia, Finandina topa el monto.">
      <span class="cf-label">Experiencia</span>
      <span class="select"><select class="input input-sm" :value="bureau.creditExperience === false ? 'no' : 'si'" @change="e => setBureau('creditExperience', e.target.value === 'si', false)">
        <option value="si">Con experiencia</option><option value="no">Sin experiencia</option>
      </select></span></label>
  </div>
</template>

<style scoped>
/* `.cf-row` y no `.field`: el `.field` de Flow va en fila con otra forma (lo usan los nodos). */
.client-form { display: flex; flex-direction: column; gap: var(--space-1); }
.cf-group { margin: var(--space-2) 0 2px; font-size: var(--text-xs); font-weight: 600; color: var(--fg-3); }
.cf-group:first-child { margin-top: 0; }
.cf-row { display: grid; grid-template-columns: minmax(0, 42%) minmax(0, 1fr); align-items: center; gap: var(--space-2); min-height: var(--control-sm); }
.cf-label { display: flex; flex-direction: column; min-width: 0; font-size: var(--text-sm); color: var(--fg-2); line-height: 1.25; }
.cf-label small { font-size: var(--text-xs); color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cf-row .input { width: 100%; font-variant-numeric: tabular-nums; }
/* En oscuro, el borde del tema (`--input`) casi no se separa del panel y los campos se leían como texto: un relleno
   tenue de la tinta los marca como editables en los dos temas, sin color propio. */
.cf-row .input { background: color-mix(in oklab, var(--foreground) 4%, transparent); border-color: color-mix(in oklab, var(--foreground) 12%, transparent); }
.cf-row .input:hover { border-color: color-mix(in oklab, var(--foreground) 24%, transparent); }
.cf-row .select { width: 100%; }
</style>
