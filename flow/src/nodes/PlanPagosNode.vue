<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, duesOf, setDues, state, cuotaBreakdown, money, openFieldInfo, delegatedOf, paymentDateOptions, paymentSchedule } from '../store'
import { CalendarClock } from 'lucide-vue-next'

// Nodo posterior a "Validación de identidad" para TODO CreditopX (crédito · renting · Credifamilia).
// Dos campos: (1) primera fecha de pago —CreditopX 5/16/28 en su ventana; la delegada, los días de su ficha— y
// (2) número de cuotas, HEREDADO del listado (mismo valor compartido que "Entidades disponibles").
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const row = computed(() => lenders.value.find(x => x.name === name.value) || null)

// Primera fecha de pago.
//   CreditopX (verificado en main, CreditopXRequestHistoryService::calculateFirstBillingDate, 2026-11-25): días FIJOS
//   en el código, 5 · 16 · 28, de este mes y los dos siguientes, y sólo los que caen entre 26 y 60 días después de
//   mañana. (Renting y rto tienen corte semanal: una sola fecha; Flow no lo modela todavía.)
//   Originación delegada (rt=4): los días de su ficha (`payment_days`), la próxima ocurrencia de cada uno.
// Las mismas opciones que la tabla (`paymentDateOptions` en store.js): CreditopX el 5, 16 o 28 en su ventana; la
// delegada, cada día de su ficha en el mes siguiente si faltan 30 días o más, y si no en el subsiguiente.
const payOptions = computed(() => paymentDateOptions(lender.value))
// La elegida se guarda por su etiqueta («5 ene»): en la ventana de CreditopX un mismo día puede salir en dos meses.
const selDay = computed(() => (payOptions.value.some(o => o.label === state.firstPaymentDay) ? state.firstPaymentDay : payOptions.value[0]?.label))
const pickDay = (lbl) => { state.firstPaymentDay = lbl }

// Número de cuotas: heredado del listado (mismo valor compartido). Editarlo acá lo cambia allá también.
const dues = computed(() => row.value?.dues || [])
const numCuotas = computed(() => (row.value ? duesOf(row.value) : 0))
const pickCuotas = (v) => { if (name.value) setDues(name.value, v) }

// Plan de cuotas: el mismo de la tabla (`paymentSchedule`): la cuota francesa con seguros y, en la delegada, el interés
// de los días de más en la primera o en la última cuota según su ficha.
const plan = computed(() => {
  const opt = payOptions.value.find(o => o.label === selDay.value) || payOptions.value[0]
  return row.value && numCuotas.value && opt ? paymentSchedule(row.value, numCuotas.value, opt) : null
})
const monthly = computed(() => plan.value?.breakdown.cuota || 0)
const totalPagar = computed(() => plan.value?.total || 0)
const schedule = computed(() => (plan.value?.rows || []).map(r => ({ n: r.n, fecha: r.label, monto: r.amount })))
const payDays = computed(() => [...new Set(payOptions.value.map(o => o.day))])
</script>

<template>
  <div v-if="lender" class="node node--planpagos prov-node">
    <Handle id="in" type="target" :position="Position.Left" />
    <Handle id="fromprofile" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('psel.planpagos')">
      <div class="node__title"><CalendarClock :size="13" /> Plan de pagos</div>
    </div>
    <div class="node__body pp-body">
      <div class="pp-field">
        <span class="pp-lbl">Primera fecha de pago <span class="pp-hint">solo {{ payDays.join(' · ') }}</span></span>
        <div class="pp-dates">
          <button v-for="o in payOptions" :key="o.label" class="pp-date nodrag" :class="{ 'pp-date--on': selDay === o.label }" @click.stop="pickDay(o.label)">{{ o.label }}</button>
        </div>
      </div>
      <label class="pp-field">
        <span class="pp-lbl">Número de cuotas <span class="pp-hint">heredado del listado</span></span>
        <select v-if="dues.length" class="nodrag" :value="numCuotas" @change="e => pickCuotas(e.target.value)" title="Plazo (nº de cuotas): sale de las opciones de la entidad en el listado. Cambiarlo acá también lo cambia allá.">
          <option v-for="n in dues" :key="n" :value="n">{{ n }} cuotas</option>
        </select>
        <span v-else class="pp-empty">sin plazos ofrecibles</span>
      </label>
      <div v-if="schedule.length" class="pp-field">
        <span class="pp-lbl">Plan de cuotas <span class="pp-hint">{{ schedule.length }} × {{ money(monthly) }}</span></span>
        <div class="pp-tbl-wrap nowheel nodrag" @wheel.stop>
          <table class="pp-tbl">
            <thead><tr><th>#</th><th>Fecha</th><th>Monto</th></tr></thead>
            <tbody>
              <tr v-for="r in schedule" :key="r.n"><td>{{ r.n }}</td><td>{{ r.fecha }}</td><td class="pp-monto">{{ money(r.monto) }}</td></tr>
            </tbody>
            <tfoot><tr><td></td><td>Total</td><td class="pp-monto">{{ money(totalPagar) }}</td></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
