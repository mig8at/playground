<script setup>
import { computed } from 'vue'
import { state, bureau, clientProfile as profile, setNull, editTick, money, requestDocumentTypes } from './store'

// El cliente de la solicitud: los datos que deciden. Vive en el sidebar «Escenario» y vale para las dos vistas —el grafo y
// la tabla leen lo mismo de `store.js`—, así que editarlo acá recalcula todo. (Hasta el 2026-11-26 era una barra arriba de
// la tabla y sólo se veía en esa vista.)
const EMP = [['empleado', 'Empleado'], ['independiente', 'Independiente'], ['pensionado', 'Pensionado'], ['desempleado', 'Desempleado']]
const CONT = [['<3m', '< 3 meses'], ['3m', '3 meses'], ['6m', '6 meses'], ['12m', '12 meses o más']]
function setBureau(key, v, numeric = true) {
  bureau[key] = numeric ? (v === '' ? null : Number(v)) : v
  setNull(key, v === '' || v == null)
  editTick.n++
}
const digits = (v) => String(v).replace(/\D/g, '')
function setAmount(v) { state.monto = digits(v); editTick.n++ }
// El ingreso que deciden las reglas es el primero de la cascada (Ágil Data → Mareigua → Quanto → declarado). Editarlo
// acá lo escribe como el de Ágil Data, que es el que gana: para las reglas no importa de qué central venga.
function setIncome(v) { const n = digits(v); setBureau('agilIncome', n === '' ? '' : Number(n)) }
// Los tipos de documento del país del comercio (o todos si no tiene), y el actual aunque no esté en la lista.
const documentTypes = computed(() => {
  const list = requestDocumentTypes()
  return list.includes(state.tipoDoc) ? list : [state.tipoDoc, ...list].filter(Boolean)
})
function setDocumentType(v) { state.tipoDoc = v; editTick.n++ }
const amount = computed(() => parseInt(digits(state.monto)) || 0)
</script>

<template>
  <div class="client-form">
    <label class="cf-field cf-wide"><span class="label">Monto</span>
      <input class="input" inputmode="numeric" :value="money(amount)" @change="e => setAmount(e.target.value)" /></label>
    <label class="cf-field cf-wide" :title="'Sale de ' + profile.salarioFuente + '. Al editarlo se escribe como el de Ágil Data, que es el primero de la cascada.'">
      <span class="label">Ingreso <small>{{ profile.salarioFuente }}</small></span>
      <input class="input" inputmode="numeric" :value="money(profile.salario)" @change="e => setIncome(e.target.value)" /></label>
    <label class="cf-field cf-wide"><span class="label">Ocupación</span>
      <span class="select"><select class="input" :value="profile.employment ?? ''" @change="e => setBureau('employment', e.target.value, false)">
        <option v-for="[k, t] in EMP" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-field cf-wide"><span class="label">Continuidad laboral</span>
      <span class="select"><select class="input" :value="bureau.agilContinuity ?? ''" @change="e => setBureau('agilContinuity', e.target.value, false)">
        <option v-for="[k, t] in CONT" :key="k" :value="k">{{ t }}</option>
      </select></span></label>
    <label class="cf-field"><span class="label">Edad</span>
      <input class="input" type="number" :value="profile.edad ?? ''" @change="e => setBureau('edad', e.target.value)" /></label>
    <label class="cf-field"><span class="label">Score</span>
      <input class="input" type="number" :value="profile.score ?? ''" @change="e => setBureau('score', e.target.value)" /></label>
    <label class="cf-field"><span class="label">Negativos 12m</span>
      <input class="input" type="number" :value="profile.negatives12m ?? ''" @change="e => setBureau('negatives12m', e.target.value)" /></label>
    <label class="cf-field"><span class="label">Documento</span>
      <span class="select"><select class="input" :value="state.tipoDoc" @change="e => setDocumentType(e.target.value)">
        <option v-for="d in documentTypes" :key="d" :value="d">{{ d }}</option>
      </select></span></label>
    <label class="cf-field cf-wide" title="Lo que paga por mes en cuotas de las deudas que ya tiene (Experian). La capacidad de Finandina lo descuenta.">
      <span class="label">Cuotas que ya paga</span>
      <input class="input" inputmode="numeric" :value="money(bureau.monthlyDebtPayment ?? 0)" @change="e => setBureau('monthlyDebtPayment', digits(e.target.value) || 0)" /></label>
    <label class="cf-field cf-wide" title="Si tuvo un crédito de al menos el mínimo de la entidad. Sin experiencia, Finandina topa el monto.">
      <span class="label">Experiencia crediticia</span>
      <span class="select"><select class="input" :value="bureau.creditExperience === false ? 'no' : 'si'" @change="e => setBureau('creditExperience', e.target.value === 'si', false)">
        <option value="si">Sí</option><option value="no">No</option>
      </select></span></label>
  </div>
</template>

<style scoped>
/* Dos columnas: lo corto (edad, score, negativos, documento) de a dos; lo largo, a lo ancho. `.cf-field` y no `.field`:
   el `.field` de Flow va en fila (lo usan los nodos). */
.client-form { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3) var(--space-2); }
.cf-field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
.cf-wide { grid-column: 1 / -1; }
.cf-field .label { display: flex; justify-content: space-between; gap: var(--space-2); }
.cf-field .label small { font-weight: 400; color: var(--fg-3); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cf-field .input { width: 100%; font-variant-numeric: tabular-nums; }
</style>
