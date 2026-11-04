<script setup>
/* Shopify · Store demo, en la consola de abajo (pestaña Conexiones): si se llega a todo lo que la compra necesita —el
 * playground, el host de la app por su canal y este Shopify falso por el suyo—. Lo comprueba el servidor
 * (GET /api/shopify-demo/status); el botón de volver a comprobar está en la barra de pestañas (App.vue). */
import { onBeforeUnmount, onMounted } from 'vue'
import { demo, startPolling, stopPolling } from './shopify-demo-state.js'

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
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm); margin: 0 }
.hot { color: var(--ecommerce-fail) }
.mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm) }
.dot { display: inline-block; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3) }
.dot[data-state="ok"] { background: var(--ecommerce-ok) }
.dot[data-state="fail"] { background: var(--ecommerce-fail) }
</style>
