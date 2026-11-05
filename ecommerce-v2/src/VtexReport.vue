<script setup>
/* El lado de VTEX de un pedido, como lo arma el servidor (server/vtex.go): estado del pedido y de la transacción, cuánto
 * tardó el conector en contestar el authorize, las incidencias y el historial. Acá no se calcula nada: se pinta. */
defineProps({
  report: { type: Object, required: true },
  // En la lista de incidencias el pedido se puede abrir; en la solicitud ya está abierto.
  compact: { type: Boolean, default: false },
})
defineEmits(['open-request'])

const LEVEL_ICON = { fail: '✕', warn: '!', info: 'i' }
const secs = (n) => (n == null ? '—' : `${n.toFixed(1)} s`)
// La hora de VTEX viene en UTC y con siete decimales: se muestra hasta el segundo.
const time = (d) => (d || '').replace('T', ' ').slice(0, 19)
</script>

<template>
  <div class="vtex">
    <dl class="kv">
      <dt>Pedido VTEX</dt>
      <dd>
        <code>{{ report.vtex?.orderId || '—' }}</code>
        <span v-if="report.vtex" class="muted"> · {{ report.vtex.orderStatus || 'sin estado en el OMS' }}</span>
      </dd>
      <dt>Transacción</dt>
      <dd>
        <code>{{ report.vtex?.transactionId || '—' }}</code>
        <span v-if="report.vtex?.txStatus"> · <b>{{ report.vtex.txStatus }}</b></span>
      </dd>
      <dt>Authorize del checkout</dt>
      <dd :class="{ hot: report.authLatency > 1.5 }">
        {{ secs(report.authLatency) }}<span v-if="report.authResponse" class="muted"> · {{ report.authResponse }}</span>
        <span class="muted"> · VTEX a veces corta a los ~2 s</span>
      </dd>
      <dt>Creditop</dt>
      <dd>
        pedido <code>{{ report.ecommerceRequest }}</code>
        <template v-if="report.request">
          · solicitud
          <button v-if="compact" type="button" class="btn-link" @click="$emit('open-request', report.request)">{{ report.request }}</button>
          <template v-else>{{ report.request }}</template>
          en <b>{{ report.statusId }} · {{ report.status }}</b>
        </template>
        <span v-else class="hot"> · sin solicitud</span>
        <span class="muted"> · {{ report.processed ? 'ya le avisó a la tienda' : 'no le avisó a la tienda' }}</span>
      </dd>
    </dl>

    <p v-if="report.vtexError" class="none warn">VTEX: {{ report.vtexError }}</p>

    <div v-if="report.findings?.length" class="findings">
      <div v-for="f in report.findings" :key="f.code" class="alert" :data-level="f.level">
        <span class="alert-icon" aria-hidden="true">{{ LEVEL_ICON[f.level] }}</span>
        <div class="alert-desc"><p>{{ f.text }}</p></div>
      </div>
    </div>
    <p v-else-if="report.vtex" class="none ok">Sin incidencias: los dos lados cuadran.</p>

    <details v-if="report.vtex?.events?.length" class="accordion-item timeline">
      <summary class="accordion-trigger">
        <span>Historial de la transacción en VTEX <span class="muted">· {{ report.vtex.events.length }} eventos, hora UTC</span></span>
        <span class="accordion-chev" aria-hidden="true">⌄</span>
      </summary>
      <div class="accordion-content">
        <div v-for="(e, i) in report.vtex.events" :key="i" class="log-line">
          <span class="log-time">{{ time(e.date) }}</span>
          <span>{{ e.message }}</span>
        </div>
      </div>
    </details>
  </div>
</template>

<style scoped>
.kv { display: grid; grid-template-columns: minmax(120px, 180px) 1fr; column-gap: var(--space-3); row-gap: var(--space-1);
  margin: 0; padding: var(--space-2) var(--gutter) var(--space-2) }
.kv dt { color: var(--fg-2) }
.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere }
code { font-family: var(--font-mono); font-size: var(--text-sm) }
.muted { color: var(--fg-3) }
.hot { color: var(--ecommerce-fail) }
.warn { color: var(--ecommerce-warn) }
.ok { color: var(--ecommerce-ok) }
.none { margin: 0; padding: var(--space-1) var(--gutter); font-size: var(--text-sm) }
.findings { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-1) var(--gutter) var(--space-2) }
.alert[data-level="fail"] { border-left-color: var(--ecommerce-fail); background: color-mix(in oklab, var(--ecommerce-fail) 10%, transparent) }
.alert[data-level="fail"] .alert-icon { color: var(--ecommerce-fail) }
.alert[data-level="warn"] { border-left-color: var(--ecommerce-warn); background: color-mix(in oklab, var(--ecommerce-warn) 10%, transparent) }
.alert[data-level="warn"] .alert-icon { color: var(--ecommerce-warn) }
.alert-desc p { color: var(--foreground) }
.timeline { margin: 0 var(--gutter) }
.timeline .log-line { padding: 0 }
</style>
