<script setup>
/* EL HISTORIAL DE UN SERVICIO, en el sidebar derecho: lo que mandaste desde su ficha, lo último arriba. Un clic carga
   la petición en la ficha para volver a mandarla. Vive en este navegador (stores/service-history.js). */
import { computed } from 'vue'
import { forget, historyFor, pick } from './stores/service-history.js'

const props = defineProps({ service: { type: Object, required: true } })
const emit = defineEmits(['close'])
const history = computed(() => historyFor(props.service.alias))
const when = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
</script>

<template>
  <div class="region-head">
    <span>Historial <span class="count">{{ history.length }}</span></span>
    <div class="region-actions">
      <button v-if="history.length" type="button" class="region-action" title="Vaciar el historial" aria-label="Vaciar el historial" @click="forget(service.alias)">
        <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
      </button>
      <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar el historial" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="region-body history">
    <p v-if="!history.length" class="note">Las peticiones que mandes a {{ service.alias }} quedan acá.</p>
    <button v-for="(h, i) in history" :key="i" type="button" class="row history-row" :title="`${h.method} ${h.path}`" @click="pick(service.alias, h)">
      <b class="m">{{ h.method }}</b><span class="label">{{ h.path }}</span>
      <span class="row-meta" :data-kind="h.status >= 400 || !h.status ? 'bad' : 'ok'">{{ h.status || '—' }}</span>
      <span class="row-meta">{{ when(h.at) }}</span>
    </button>
  </div>
</template>

<style scoped>
.history { display: flex; flex-direction: column; overflow: auto; padding: var(--space-2) 0 }
.note { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-2); font-size: var(--text-sm) }
.history-row { gap: var(--space-2) }
.history-row .m { flex: none; width: 52px; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-2) }
.history-row .label { font-family: var(--font-mono); font-size: var(--text-sm) }
.row-meta[data-kind="bad"] { color: var(--send-fail) }
</style>
