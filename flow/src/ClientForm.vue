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
  <!-- Tres grupos, en el orden en que pesan en la decisión: lo que pide, de qué vive y qué dice el buró. Cada campo es una
       fila de rótulo y control compacto (28), como las preferencias de VS Code: en 300 de ancho se lee de un vistazo. -->
  <div class="client-form">
    <div class="cf-group">Solicitud</div>
    <label class="cf-row"><span class="cf-label">Monto</span>
      <input class="input input-sm" inputmode="numeric" :value="money(amount)" @change="e => setAmount(e.target.value)" /></label>
    <label class="cf-row"><span class="cf-label">Documento</span>
      <span class="select"><select class="input input-sm" :value="state.tipoDoc" @change="e => setDocumentType(e.target.value)">
        <option v-for="d in documentTypes" :key="d" :value="d">{{ d }}</option>
      </select></span></label>
    <label class="cf-row"><span class="cf-label">Edad</span>
      <input class="input input-sm" type="number" :value="profile.edad ?? ''" @change="e => setBureau('edad', e.target.value)" /></label>

    <div class="cf-group">Ingreso y empleo</div>
    <label class="cf-row" :title="'Sale de ' + profile.salarioFuente + '. Al editarlo se escribe como el de Ágil Data, que es el primero de la cascada.'">
      <span class="cf-label">Ingreso<small>{{ profile.salarioFuente }}</small></span>
      <input class="input input-sm" inputmode="numeric" :value="money(profile.salario)" @change="e => setIncome(e.target.value)" /></label>
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
