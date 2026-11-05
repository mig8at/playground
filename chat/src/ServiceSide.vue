<script setup>
/* EL SIDEBAR DERECHO DE UN SERVICIO, en dos pestañas:
   - Rutas: lo que el servicio dice de sí mismo, su `/openapi.json` y su `/health` (la convención de los servicios del
     playground; server/services.go los lee). Un clic en una ruta la deja lista en el Postman, con los parámetros y el
     cuerpo de ejemplo que declare.
   - Historial: lo que mandaste, lo último arriba; un clic lo vuelve a cargar. Vive en este navegador.
   Las dos cargan en la ficha por stores/service-history.js (`pick`). */
import { computed, ref, watch } from 'vue'
import { forget, historyFor, pick } from './stores/service-history.js'
import { loadSchema as fetchSchema, schemaState } from './stores/service-schema.js'

const props = defineProps({ service: { type: Object, required: true } })
const emit = defineEmits(['close'])

const TAB_KEY = 'chat.service-side-tab'
const tab = ref((() => { try { return localStorage.getItem(TAB_KEY) || 'routes' } catch { return 'routes' } })())
function setTab(t) { tab.value = t; try { localStorage.setItem(TAB_KEY, t) } catch { /* sólo no se recuerda */ } }

// ── rutas ──
const schemaOf = computed(() => schemaState(props.service.alias))
const info = computed(() => schemaOf.value.info)
const loading = computed(() => schemaOf.value.loading)
const loadSchema = () => fetchSchema(props.service.alias)
watch(() => [props.service.alias, props.service.listening], loadSchema, { immediate: true })

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const schema = computed(() => info.value?.schema || null)
// `$ref` de un mismo documento (#/components/…): lo justo para armar ejemplos.
function deref(node, depth = 0) {
  if (!node || depth > 8) return node
  if (node.$ref?.startsWith('#/')) return deref(node.$ref.slice(2).split('/').reduce((o, k) => o?.[k], schema.value), depth + 1)
  return node
}
function exampleOf(node, depth = 0) {
  node = deref(node, depth)
  if (!node || depth > 8) return null
  if (node.example !== undefined) return node.example
  if (node.default !== undefined) return node.default
  if (node.type === 'object' || node.properties) {
    return Object.fromEntries(Object.entries(node.properties || {}).map(([k, v]) => [k, exampleOf(v, depth + 1)]))
  }
  if (node.type === 'array') return [exampleOf(node.items, depth + 1)]
  return { string: '', integer: 0, number: 0, boolean: false }[node.type] ?? null
}
const routes = computed(() => {
  const out = []
  for (const [path, item] of Object.entries(schema.value?.paths || {})) {
    for (const m of METHODS) {
      const op = item?.[m]
      if (!op) continue
      const params = [...(item.parameters || []), ...(op.parameters || [])].map((p) => deref(p))
      const query = params.filter((p) => p?.in === 'query')
        .map((p) => [p.name, p.example ?? p.schema?.example ?? p.schema?.default]).filter(([, v]) => v !== undefined)
      const body = op.requestBody && exampleOf(deref(op.requestBody)?.content?.['application/json']?.schema)
      out.push({
        method: m.toUpperCase(), path, summary: op.summary || op.description || '',
        params: params.filter((p) => p?.in === 'query').map((p) => p.name),
        entry: {
          method: m.toUpperCase(),
          path: path + (query.length ? '?' + new URLSearchParams(query.map(([k, v]) => [k, String(v)])).toString() : ''),
          body: body != null ? JSON.stringify(body, null, 2) : '', headers: '',
        },
      })
    }
  }
  return out
})
const health = computed(() => {
  const h = info.value?.health
  if (!info.value) return null
  if (info.value.healthError && !h) return { kind: 'bad', text: info.value.healthError }
  const status = String(h?.status ?? '').toLowerCase()
  const ok = !info.value.healthError && (!status || ['ok', 'up', 'pass', 'healthy'].includes(status))
  const bits = [ok ? 'está bien' : (h?.status || info.value.healthError)]
  if (h?.version) bits.push(`v${h.version}`)
  if (h?.desde || h?.since) {
    try { bits.push('desde ' + new Date(h.desde || h.since).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })) } catch { /* sin fecha */ }
  }
  return { kind: ok ? 'ok' : 'bad', text: bits.join(' · ') }
})
const schemaUrl = computed(() => `${props.service.url}/openapi.json`)
const copied = ref(false)
async function copySchema() {
  try { await navigator.clipboard.writeText(schemaUrl.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

// ── historial ──
const history = computed(() => historyFor(props.service.alias))
const when = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
</script>

<template>
  <nav class="tabs" role="tablist" aria-label="El servicio">
    <button type="button" role="tab" class="tab" :class="{ on: tab === 'routes' }" :aria-selected="tab === 'routes'" @click="setTab('routes')">
      Rutas <span v-if="routes.length" class="count">{{ routes.length }}</span>
    </button>
    <button type="button" role="tab" class="tab" :class="{ on: tab === 'history' }" :aria-selected="tab === 'history'" @click="setTab('history')">
      Historial <span v-if="history.length" class="count">{{ history.length }}</span>
    </button>
    <div class="region-actions">
      <button v-if="tab === 'routes'" type="button" class="region-action" title="Volver a leer el esquema" aria-label="Volver a leer el esquema"
              :disabled="loading" @click="loadSchema">
        <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
      </button>
      <button v-if="tab === 'history' && history.length" type="button" class="region-action" title="Vaciar el historial" aria-label="Vaciar el historial" @click="forget(service.alias)">
        <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
      </button>
      <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </nav>

  <div v-if="tab === 'routes'" class="region-body side">
    <p v-if="loading && !info" class="note">Leyendo el esquema…</p>
    <template v-else-if="info">
      <p v-if="health" class="health" :data-kind="health.kind"><span class="dot" aria-hidden="true"></span>{{ health.text }}</p>
      <p v-if="info.schemaError" class="note">{{ info.schemaError }}<template v-if="info.schemaError.startsWith('no tiene')">: la ruta se escribe a mano en la ficha.</template></p>
      <template v-else>
        <p v-if="schema?.info?.description" class="note">{{ schema.info.description }}</p>
        <button v-for="r in routes" :key="r.method + r.path" type="button" class="row route-row" :title="`Cargar ${r.entry.method} ${r.entry.path}`" @click="pick(service.alias, r.entry)">
          <b class="m">{{ r.method }}</b>
          <span class="route"><span class="label">{{ r.path }}<span v-if="r.params.length" class="params">?{{ r.params.join('&') }}</span></span>
            <span v-if="r.summary" class="summary">{{ r.summary }}</span></span>
        </button>
        <p class="note share">Para conectarse: <code>{{ schemaUrl }}</code> <button type="button" class="btn-link" @click="copySchema">{{ copied ? 'copiada' : 'copiar' }}</button></p>
      </template>
    </template>
  </div>

  <div v-else class="region-body side">
    <p v-if="!history.length" class="note">Las peticiones que mandes a {{ service.alias }} quedan acá.</p>
    <button v-for="(h, i) in history" :key="i" type="button" class="row history-row" :title="`${h.method} ${h.path}`" @click="pick(service.alias, h)">
      <b class="m">{{ h.method }}</b><span class="label">{{ h.path }}</span>
      <span class="row-meta" :data-kind="h.status >= 400 || !h.status ? 'bad' : 'ok'">{{ h.status || '—' }}</span>
      <span class="row-meta">{{ when(h.at) }}</span>
    </button>
  </div>
</template>

<style scoped>
.side { display: flex; flex-direction: column; overflow: auto; padding: var(--space-2) 0 }
.note { margin: 0; padding: var(--space-2) var(--gutter); color: var(--fg-2); font-size: var(--text-sm) }
.share code { font-family: var(--font-mono); word-break: break-all }
.health { margin: 0; padding: var(--space-2) var(--gutter); display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm) }
.health .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--presence-on) }
.health[data-kind="bad"] .dot { background: var(--send-fail) }
.m { flex: none; width: 52px; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-2) }
.label { font-family: var(--font-mono); font-size: var(--text-sm) }
.history-row, .route-row { gap: var(--space-2) }
.route-row { height: auto; align-items: flex-start; padding-top: var(--space-1); padding-bottom: var(--space-1) }
.route { display: flex; flex-direction: column; min-width: 0 }
.params { color: var(--fg-2) }
.summary { color: var(--fg-2); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.row-meta[data-kind="bad"] { color: var(--send-fail) }
</style>
