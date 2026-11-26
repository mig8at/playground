<script setup>
// La pista «Cartera», el DETALLE (`auxiliarybar`): la noche que se eligió en el reloj o en la bitácora. Aparece con la
// elección y se cierra con su ✕ o con Esc, como el detalle de la tabla y el del grafo.
import { computed } from 'vue'
import './portfolio.css'
import { portfolioSim as sim, portfolioUi as pui, CASCADE, STATES, fmt, dateOf } from './portfolio.js'

defineProps({ width: { type: Number, default: 340 } })
const KIND = { disbursement: 'Desembolso', billing: 'Corte', payment: 'Pago', state: 'Cambio de estado', collection: 'Gasto de cobranza' }
const event = computed(() => (pui.selected === null ? null : sim.value.events[pui.selected] || null))
const snap = computed(() => (event.value ? sim.value.days[event.value.day] : null))
const parts = computed(() => {
  const p = event.value?.parts || {}
  const rows = CASCADE.map((c) => ({ key: c.key, label: c.label, value: p[c.key] || 0, cls: 'pf-c-' + c.key }))
  if (p.extra) rows.push({ key: 'extra', label: 'Sobrante → abono a capital', value: p.extra, cls: 'pf-c-principal-soft' })
  if (p.favor) rows.push({ key: 'favor', label: 'Sobrante → saldo a favor', value: p.favor, cls: 'pf-c-favor' })
  return rows
})
const due = computed(() => (snap.value ? CASCADE.map((c) => ({ key: c.key, label: c.label, value: snap.value.due[c.key], cls: 'pf-c-' + c.key })) : []))
const dueTotal = computed(() => due.value.reduce((a, r) => a + r.value, 0))
function close() { pui.selected = null }
</script>

<template>
  <aside v-if="event" class="auxiliarybar pf-detail" aria-label="La noche elegida" :style="{ width: width + 'px' }">
    <slot name="resize" />
    <div class="region-head">
      <span>{{ KIND[event.kind] }}</span><span class="count">día {{ event.day }}</span>
      <div class="region-actions"><button type="button" class="region-action" title="Cerrar el detalle" aria-label="Cerrar el detalle" @click="close"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button></div>
    </div>
    <div class="region-body pf-detail-body">
      <p class="pf-detail-date">{{ dateOf(snap.date) }}</p>
      <p class="pf-detail-text">{{ event.text }}</p>

      <template v-if="event.kind === 'payment'">
        <div class="region-head group"><span>Cómo se repartió</span><span class="count">{{ fmt(event.amount) }}</span></div>
        <ol class="pf-rows pf-cascade pf-detail-pad">
          <li v-for="p in parts" :key="p.key" :class="{ zero: !p.value }"><i :class="p.cls"></i>{{ p.label }}<b>{{ p.value ? fmt(p.value) : '—' }}</b></li>
        </ol>
        <p class="pf-note pf-detail-pad">Después del cobro, en una cola aparte, sale el voucher de pago y le llega por correo y WhatsApp.</p>
      </template>

      <template v-if="event.kind === 'billing' || event.kind === 'collection' || event.kind === 'state'">
        <div class="region-head group"><span>El mínimo ese día</span><span class="count">{{ fmt(dueTotal) }}</span></div>
        <ul class="pf-rows pf-detail-pad">
          <li v-for="r in due" :key="r.key" :class="{ zero: !r.value }"><i :class="r.cls"></i>{{ r.label }}<b>{{ r.value ? fmt(r.value) : '—' }}</b></li>
        </ul>
        <p v-if="event.kind === 'billing'" class="pf-note pf-detail-pad">El corte factura la cuota: el interés causado del ciclo y el capital de la cuota pasan al mínimo, que acumula lo que no se pagó antes. Vence 5 días después.</p>
      </template>

      <div class="region-head group"><span>Ese día</span></div>
      <dl class="pf-detail-kv pf-detail-pad">
        <dt>Estado</dt><dd>{{ STATES[snap.status]?.name || snap.status }}</dd>
        <dt>Días de mora</dt><dd>{{ snap.daysLate }}</dd>
        <dt>Cuota</dt><dd>{{ snap.installment }}</dd>
        <dt>Saldo total</dt><dd>{{ fmt(snap.total) }}</dd>
        <dt>Por facturar</dt><dd>{{ fmt(snap.unbilled) }}</dd>
      </dl>
    </div>
  </aside>
</template>

<style scoped>
.pf-detail-body { padding-bottom: var(--space-4) }
.pf-detail-date { margin: var(--space-3) var(--space-4) 0; color: var(--fg-3); font-size: var(--text-sm) }
.pf-detail-text { margin: var(--space-1) var(--space-4) var(--space-3); line-height: 1.5 }
.pf-detail-pad { padding: 0 var(--space-4); margin-bottom: var(--space-3) }
.pf-detail-kv { display: grid; grid-template-columns: auto 1fr; gap: 3px var(--space-3); margin-top: var(--space-2) }
.pf-detail-kv dt { color: var(--fg-3) }
.pf-detail-kv dd { margin: 0; text-align: right; font-family: var(--font-mono); font-size: var(--text-sm) }
</style>
