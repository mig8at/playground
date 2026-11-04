<script setup>
/* Shopify · Store demo, en el panel derecho: si se llega a todo (el playground, el host de la app y este Shopify falso)
 * y cada petición HTTP que pasó por debajo de una compra —la sesión de pago, el aviso de Creditop y lo que la app le
 * contestó a Shopify—, con su cuerpo. Lo registra el servidor (GET /api/shopify-demo/log). */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { demo, clock, checkConnections, startPolling, stopPolling } from './shopify-demo-state.js'

const open = ref('')
const onlyOrder = ref(false)
const list = computed(() => {
  const all = [...demo.exchanges].reverse()
  return onlyOrder.value && demo.selected ? all.filter(e => e.order === demo.selected) : all
})
const pretty = v => { try { return JSON.stringify(typeof v === 'string' ? JSON.parse(v) : v, null, 2) } catch { return String(v ?? '') } }
const ok = e => !e.error && e.status >= 200 && e.status < 400
const shortUrl = u => String(u).replace(/^https?:\/\/[^/]+/, '').replace(/^\/hooks\/[A-Za-z0-9_-]{22}/, '…')

onMounted(startPolling)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="region-head">
    <span>Conexiones</span>
    <div class="region-actions">
      <button type="button" class="region-action" :disabled="demo.checking" title="Volver a comprobar" aria-label="Volver a comprobar" @click="checkConnections">
        <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="checks">
    <p v-if="demo.statusError" class="hot small">{{ demo.statusError }}</p>
    <p v-else-if="!demo.status" class="muted small">Comprobando…</p>
    <div v-for="c in demo.status?.checks ?? []" :key="c.name" class="check" :title="c.url">
      <i class="dot" :data-state="c.ok ? 'ok' : 'fail'" aria-hidden="true"></i>
      <div><div class="name">{{ c.name }}</div><div class="muted small">{{ c.detail }}</div></div>
    </div>
  </div>

  <div class="region-head group">
    <span>Peticiones y webhooks</span>
    <span class="count">{{ list.length }}</span>
    <div class="region-actions">
      <button type="button" class="region-action" :aria-pressed="onlyOrder" :title="onlyOrder ? 'Ver todas' : 'Sólo las del pedido elegido'"
              :aria-label="onlyOrder ? 'Ver todas' : 'Sólo las del pedido elegido'" @click="onlyOrder = !onlyOrder">
        <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="region-body">
    <p v-if="!list.length" class="muted small pad">Todavía no pasó nada: comprá en la tienda.</p>
    <div v-for="(e, i) in list" :key="e.at + i" class="ex" :class="{ open: open === e.at + i }">
      <button type="button" class="ex-head" :aria-expanded="open === e.at + i" @click="open = open === e.at + i ? '' : e.at + i">
        <span class="dir" :title="e.dir === 'in' ? 'le llamaron a la demo' : 'la demo llamó'">{{ e.dir === 'in' ? '←' : '→' }}</span>
        <span class="kind">{{ e.kind }}</span>
        <span class="st" :data-ok="ok(e)">{{ e.error ? '✗' : e.status }}</span>
        <span class="muted mono">{{ clock(e.at) }}</span>
      </button>
      <div class="ex-url mono muted">{{ e.method }} {{ shortUrl(e.url) }}<template v-if="e.ms"> · {{ e.ms }} ms</template></div>
      <div v-if="open === e.at + i" class="ex-body">
        <div class="label">Petición</div>
        <pre class="sql"><code>{{ pretty(e.request) }}</code></pre>
        <div class="label">Respuesta {{ e.status || '' }}</div>
        <pre class="sql"><code>{{ e.error || (e.response ? pretty(e.response) : e.text || '(sin cuerpo)') }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.checks { padding: var(--space-2) var(--gutter) var(--space-3) }
.check { display: flex; gap: var(--space-2); align-items: flex-start; padding: var(--space-1) 0 }
.check .dot { margin-top: 5px }
.name { font-weight: 600 }
.pad { padding: var(--space-3) var(--gutter) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm); margin: 0 }
.hot { color: var(--ecommerce-fail) }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--ecommerce-ok) }
.dot[data-state="fail"] { background: var(--ecommerce-fail) }
.ex { border-bottom: 1px solid var(--border); padding: var(--space-2) var(--gutter) }
.ex-head { width: 100%; display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; gap: var(--space-2); align-items: center;
           border: 0; background: none; color: inherit; font: inherit; text-align: left; padding: 0; cursor: pointer }
.kind { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dir { color: var(--fg-3) }
.st { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ecommerce-fail) }
.st[data-ok="true"] { color: var(--ecommerce-ok) }
.ex-url { margin: 2px 0 0 24px; word-break: break-all }
.ex-body { margin-top: var(--space-2) }
.ex-body pre { max-height: 260px; overflow: auto; margin: var(--space-1) 0 var(--space-2) }
</style>
