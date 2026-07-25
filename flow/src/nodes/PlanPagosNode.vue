<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, duesOf, setDues, state, cuotaBreakdown, money, openFieldInfo } from '../store'
import { CalendarClock } from 'lucide-vue-next'

// Nodo posterior a "Validación de identidad" para TODO CreditopX (crédito · renting · Credifamilia).
// Dos campos: (1) primera fecha de pago —solo días 6/15/28, se ofrecen las 3 próximas desde HOY— y
// (2) número de cuotas, HEREDADO del listado (mismo valor compartido que "Entidades disponibles").
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const row = computed(() => lenders.value.find(x => x.name === name.value) || null)

// Primera fecha de pago: próxima ocurrencia de cada día permitido (6/15/28) desde hoy, ordenadas.
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const payOptions = computed(() => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate()
  return [6, 15, 28]
    .map(day => {
      const dt = day <= d ? new Date(y, m + 1, day) : new Date(y, m, day) // pasó este mes → el próximo
      return { day, date: dt, label: `${day} ${MESES[dt.getMonth()]} ${dt.getFullYear()}` }
    })
    .sort((a, b) => a.date - b.date)
})
const selDay = computed(() => state.firstPaymentDay ?? payOptions.value[0]?.day)
const pickDay = (day) => { state.firstPaymentDay = day }

// Número de cuotas: heredado del listado (mismo valor compartido). Editarlo acá lo cambia allá también.
const dues = computed(() => row.value?.dues || [])
const numCuotas = computed(() => (row.value ? duesOf(row.value) : 0))
const pickCuotas = (v) => { if (name.value) setDues(name.value, v) }

// Plan de cuotas: cuota mensual (misma para todas, sistema francés) + la fecha de cada pago (mes a mes
// desde la 1ª fecha elegida, manteniendo el día 6/15/28). Tabla #, fecha, monto.
const monthly = computed(() => (row.value && numCuotas.value ? cuotaBreakdown(row.value, numCuotas.value).cuota : 0))
const schedule = computed(() => {
  const opt = payOptions.value.find(o => o.day === selDay.value) || payOptions.value[0]
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
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('psel.planpagos')">
      <div class="node__title"><CalendarClock :size="13" /> Plan de pagos</div>
    </div>
    <div class="node__body pp-body">
      <div class="pp-field">
        <span class="pp-lbl">Primera fecha de pago <span class="pp-hint">solo 6 · 15 · 28</span></span>
        <div class="pp-dates">
          <button v-for="o in payOptions" :key="o.day" class="pp-date nodrag" :class="{ 'pp-date--on': selDay === o.day }" @click.stop="pickDay(o.day)">{{ o.label }}</button>
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
        <div class="pp-tbl-wrap">
          <table class="pp-tbl">
            <thead><tr><th>#</th><th>Fecha</th><th>Monto</th></tr></thead>
            <tbody>
              <tr v-for="r in schedule" :key="r.n"><td>{{ r.n }}</td><td>{{ r.fecha }}</td><td class="pp-monto">{{ money(r.monto) }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
