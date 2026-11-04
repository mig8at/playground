<script setup>
/* Shopify · Store demo, en la consola de abajo (pestaña Conexiones): si se llega a todo lo que la compra necesita —el
 * playground, el host de la app por su canal y este Shopify falso por el suyo—. Lo comprueba el servidor
 * (GET /api/shopify-demo/status); el botón de volver a comprobar está en la barra de pestañas (App.vue). */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { demo, startPolling, stopPolling } from './shopify-demo-state.js'

const share = computed(() => demo.status?.share ?? null)
const copied = ref(false)
async function copy(text) {
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

onMounted(startPolling)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="connections">
    <p v-if="demo.statusError" class="hot small">{{ demo.statusError }}</p>
    <p v-else-if="!demo.status" class="muted small">Comprobando…</p>
    <div v-for="c in demo.status?.checks ?? []" :key="c.name" class="check">
      <i class="dot" :data-state="c.ok ? 'ok' : 'fail'" aria-hidden="true"></i>
      <div class="text">
        <div class="name">{{ c.name }}</div>
        <div class="muted small">{{ c.detail }}</div>
        <div v-if="c.url" class="mono muted url">{{ c.url }}</div>
      </div>
    </div>
    <!-- El nombre propio: lo publica `npm run dev` (scripts/share.mjs). Es lo que hay que pasarle al dueño del host. -->
    <div v-if="share" class="share" :data-ok="share.state === 'serving'">
      <template v-if="share.state === 'serving'">
        <div class="name">Tu Shopify falso: <code>{{ share.name }}</code></div>
        <div class="muted small">Pasale este nombre al dueño del host: su dirección va en su <code>SHOPIFY_PAYMENTS_API_URL</code>.</div>
        <div class="row">
          <code class="mono url">{{ share.url }}</code>
          <button type="button" class="btn btn-outline btn-xs" @click="copy(share.url)">{{ copied ? 'Copiada' : 'Copiar dirección' }}</button>
        </div>
      </template>
      <template v-else>
        <div class="name">Tu Shopify falso todavía no está publicado</div>
        <div v-if="share.hint" class="small">Falta: <code>{{ share.hint.replace(/^[^:]*: /, '') }}</code></div>
        <div class="muted small">{{ share.state === 'starting' ? 'Publicándolo…' : 'Se vuelve a probar solo cada 15 s.' }}</div>
      </template>
    </div>
    <p v-if="demo.status" class="muted small note">
      Tienda <b>{{ demo.status.config.shop }}</b> · «Avisar como Creditop» busca el aviso firmado en <b>{{ demo.status.config.target }}</b>
    </p>
  </div>
</template>

<style scoped>
.connections { padding: var(--space-3) var(--gutter); display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--space-3) }
.check { display: flex; gap: var(--space-2); align-items: flex-start }
.check .dot { margin-top: 5px }
.text { min-width: 0 }
.name { font-weight: 600 }
.url { word-break: break-all }
.note { grid-column: 1 / -1 }
.share { grid-column: 1 / -1; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2) var(--space-3);
         display: flex; flex-direction: column; gap: var(--space-1) }
.share[data-ok="false"] { border-color: var(--ecommerce-warn) }
.share .row { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm); margin: 0 }
.hot { color: var(--ecommerce-fail) }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--ecommerce-ok) }
.dot[data-state="fail"] { background: var(--ecommerce-fail) }
</style>
