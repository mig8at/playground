<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, duesOf, setDues, state, cuotaBreakdown, money, openFieldInfo, delegatedOf } from '../store'
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
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const CX_DAYS = [5, 16, 28]
const payDays = computed(() => (lender.value?.rt === 4 ? delegatedOf(lender.value).paymentDays : CX_DAYS))
const label = (dt) => `${dt.getDate()} ${MESES[dt.getMonth()]}`
const payOptions = computed(() => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  if (lender.value?.rt !== 4) {
    const tomorrow = new Date(y, m, d + 1)
    const min = new Date(y, m, d + 1 + 26), max = new Date(y, m, d + 1 + 60)
    const out = []
    for (const k of [0, 1, 2]) for (const day of CX_DAYS) {
      const dt = new Date(tomorrow.getFullYear(), tomorrow.getMonth() + k, day)
      if (dt >= min && dt <= max) out.push({ day, date: dt, label: label(dt) })
    }
    return out.sort((a, b) => a.date - b.date)
  }
  return payDays.value
    .map(day => {
      const dt = day <= d ? new Date(y, m + 1, day) : new Date(y, m, day) // pasó este mes → el próximo
      return { day, date: dt, label: label(dt) }
    })
    .sort((a, b) => a.date - b.date)
})
// La elegida se guarda por su etiqueta («5 ene»): en la ventana de CreditopX un mismo día puede salir en dos meses.
const selDay = computed(() => (payOptions.value.some(o => o.label === state.firstPaymentDay) ? state.firstPaymentDay : payOptions.value[0]?.label))
const pickDay = (lbl) => { state.firstPaymentDay = lbl }

// Número de cuotas: heredado del listado (mismo valor compartido). Editarlo acá lo cambia allá también.
const dues = computed(() => row.value?.dues || [])
const numCuotas = computed(() => (row.value ? duesOf(row.value) : 0))
const pickCuotas = (v) => { if (name.value) setDues(name.value, v) }

// Plan de cuotas: cuota mensual (misma para todas, sistema francés) + la fecha de cada pago (mes a mes
// desde la 1ª fecha elegida, manteniendo su día). Tabla #, fecha, monto.
const monthly = computed(() => (row.value && numCuotas.value ? cuotaBreakdown(row.value, numCuotas.value).cuota : 0))
const totalPagar = computed(() => monthly.value * (numCuotas.value || 0))
const schedule = computed(() => {
  const opt = payOptions.value.find(o => o.label === selDay.value) || payOptions.value[0]
  const n = numCuotas.value || 0
  if (!opt || !n) return []
  const rows = []
  for (let i = 0; i < n; i++) {
    const dt = new Date(opt.date.getFullYear(), opt.date.getMonth() + i, opt.day)
    rows.push({ n: i + 1, fecha: `${opt.day} ${MESES[dt.getMonth()]} ${dt.getFullYear()}`, monto: monthly.value })
  }
  return rows
})
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
