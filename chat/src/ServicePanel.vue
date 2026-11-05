<script setup>
/* UN SERVICIO DEL PLAYGROUND EN EL EDITOR (server/services.go): un servidor de esta máquina que el equipo alcanza por
   la VPN con un nombre fijo. El interruptor lo prende (el chat levanta el programa y reinicia `playground serve`) o lo
   apaga. Y para probarlo, un Postman chico: método, ruta, cuerpo y encabezados, siempre por el playground (como le
   llega al equipo); y la respuesta con su estado, tiempo y tamaño. El historial va en el sidebar derecho
   (ServiceSide.vue, con las rutas del esquema) y vive en este navegador. La petición la hace el servidor del chat (sin CORS) y sólo va a la dirección del servicio. */
import { computed, ref, watch } from 'vue'
import { picked, remember } from './stores/service-history.js'
import { loadSchema, methodsFor, schemaState } from './stores/service-schema.js'

const props = defineProps({ service: { type: Object, required: true }, serving: Boolean, serveLog: { type: String, default: '' } })
const emit = defineEmits(['changed', 'close'])

// ── prender y apagar ──
const busy = ref(false)
const error = ref('')
async function toggle() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(props.service.alias)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !props.service.on }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  } catch (e) { error.value = e.message } finally {
    busy.value = false
    emit('changed')
  }
}
const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(props.service.url); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

// ── la petición ──
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const method = ref('GET')
const path = ref('/persona')
/* El método lo dicta el esquema: si la ruta está en él con uno solo, queda fijo; con varios, se elige entre esos. Sin
   esquema, o con una ruta que no declara, se elige libre. */
const declared = computed(() => methodsFor(props.service.alias, path.value))
const methods = computed(() => (declared.value?.length ? declared.value : METHODS))
const methodFixed = computed(() => declared.value?.length === 1)
const methodTitle = computed(() => (methodFixed.value ? 'Lo fija el esquema del servicio'
  : declared.value?.length ? 'Los métodos que el esquema declara para esta ruta'
    : declared.value ? 'Esta ruta no está en el esquema' : 'Método'))
watch(() => props.service.alias, (alias) => { const st = schemaState(alias); if (!st.info && !st.loading) loadSchema(alias) }, { immediate: true })
watch(methods, (list) => { if (!list.includes(method.value)) method.value = list[0] }, { immediate: true })
// Siempre por el playground: lo que importa es que le sirva al equipo, no que ande en tu máquina.
const via = 'playground'
const reqTab = ref('body')
const bodyText = ref('')
const headersText = ref('')
const bodyPlaceholder = computed(() => (method.value === 'GET' ? 'GET no lleva cuerpo' : '{ "campo": "valor" }'))
const sending = ref(false)
const response = ref(null)
const resTab = ref('body')

const parseHeaders = (text) => Object.fromEntries(text.split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]).filter(([k]) => k))
const prettyBody = computed(() => {
  const b = response.value?.body ?? ''
  try { return JSON.stringify(JSON.parse(b), null, 2) } catch { return b }
})
const statusKind = computed(() => {
  const s = response.value?.status || 0
  return s >= 500 ? 'bad' : s >= 400 ? 'warn' : s >= 200 ? 'ok' : 'bad'
})
const size = (n) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`)

// Al cambiar de servicio, la respuesta de otro no sirve. Y lo que elijas en el historial (sidebar derecho) se carga acá.
watch(() => props.service.alias, () => { response.value = null })
watch(picked, (p) => {
  if (!p || p.alias !== props.service.alias) return
  const h = p.entry
  method.value = h.method; path.value = h.path; bodyText.value = h.body || ''; headersText.value = h.headers || ''
})

async function send() {
  if (sending.value || !path.value.trim()) return
  sending.value = true
  response.value = null
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(props.service.alias)}/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: method.value, path: path.value, via, headers: parseHeaders(headersText.value), body: bodyText.value }),
    })
    const out = await res.json()
    if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
    response.value = out
    remember(props.service.alias, { method: method.value, path: path.value, body: bodyText.value, headers: headersText.value, status: out.status || 0, at: new Date().toISOString() })
  } catch (e) { response.value = { error: e.message } } finally { sending.value = false }
}
function onKeydown(e) { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send() }
</script>

<template>
  <div class="region-head">
    <span class="head-who"><span class="head-title">{{ service.name }}</span>
      <span class="count head-sub">{{ service.on ? (service.listening && serving ? 'publicado' : 'prendiendo…') : 'apagado' }}</span></span>
    <div class="region-actions">
      <button type="button" class="switch" role="switch" :aria-checked="service.on" :disabled="busy" @click="toggle"
              :title="service.on ? 'Apagar: el equipo deja de verlo' : 'Prender: el equipo lo alcanza por la VPN'"
              :aria-label="service.on ? `Apagar ${service.alias}` : `Prender ${service.alias}`"></button>
      <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="region-body service" @keydown="onKeydown">
    <details class="info">
      <summary>{{ service.description }}</summary>
      <dl>
        <dt>Estado</dt>
        <dd v-if="!service.on">apagado: el equipo no lo ve</dd>
        <dd v-else-if="!service.listening">prendido, pero su puerto no contesta</dd>
        <dd v-else-if="!serving">prendido, pero <code>playground serve</code> no está corriendo</dd>
        <dd v-else>el equipo lo alcanza por la VPN</dd>
        <dt>En el equipo</dt>
        <dd><code>{{ service.url }}</code> <button type="button" class="btn-link" @click="copy">{{ copied ? 'copiada' : 'copiar' }}</button></dd>
        <dt>En esta máquina</dt>
        <dd><code>{{ service.to }}</code>{{ service.managed ? ' · lo levanta el chat' : ' · lo levantás vos' }}</dd>
        <dt>Se declara en</dt>
        <dd><code>~/playground/team/services.json</code> (prendidos) y <code>services.off.json</code> (apagados)</dd>
      </dl>
      <details v-if="serveLog" class="serve-log"><summary>Lo último de <code>playground serve</code></summary><pre>{{ serveLog }}</pre></details>
    </details>
    <p v-if="error" class="bad">{{ error }}</p>

    <div class="main">
      <!-- La petición -->
      <form class="request-bar" @submit.prevent="send">
        <select v-model="method" class="input input-sm method" aria-label="Método" :disabled="methodFixed" :title="methodTitle">
          <option v-for="m in methods" :key="m" :value="m">{{ m }}</option>
        </select>
        <input v-model="path" class="input input-sm path" aria-label="Ruta" placeholder="/persona" spellcheck="false" />
        <button type="submit" class="btn btn-sm" :disabled="sending || !service.listening" :title="service.listening ? 'Enviar (⌘ Enter)' : 'Prendelo para probarlo'">
          {{ sending ? 'Enviando…' : 'Enviar' }}
        </button>
      </form>
      <nav class="tabs" role="tablist" aria-label="La petición">
        <button type="button" role="tab" class="tab" :class="{ on: reqTab === 'body' }" :aria-selected="reqTab === 'body'" @click="reqTab = 'body'">Cuerpo</button>
        <button type="button" role="tab" class="tab" :class="{ on: reqTab === 'headers' }" :aria-selected="reqTab === 'headers'" @click="reqTab = 'headers'">
          Encabezados <span v-if="Object.keys(parseHeaders(headersText)).length" class="count">{{ Object.keys(parseHeaders(headersText)).length }}</span>
        </button>
      </nav>
      <textarea v-if="reqTab === 'body'" v-model="bodyText" class="input code" rows="4" spellcheck="false"
                :placeholder="bodyPlaceholder" :disabled="method === 'GET'"></textarea>
      <textarea v-else v-model="headersText" class="input code" rows="4" spellcheck="false" placeholder="Authorization: Bearer …&#10;X-Algo: valor"></textarea>

      <!-- La respuesta -->
      <section class="response" aria-live="polite">
        <p v-if="!response && !sending" class="note">{{ service.listening ? 'Mandá una petición: la respuesta sale acá.' : 'Prendé el servicio para probarlo.' }}</p>
        <p v-else-if="sending" class="note">Enviando…</p>
        <template v-else-if="response.error">
          <p class="bad">{{ response.error }}</p>
          <p v-if="response.url" class="note"><code>{{ response.url }}</code></p>
        </template>
        <template v-else>
          <div class="response-head">
            <span class="badge" :data-kind="statusKind">{{ response.status }} {{ response.statusText }}</span>
            <span class="note">{{ response.ms }} ms · {{ size(response.size) }}</span>
            <code class="note url" :title="response.url">{{ response.url }}</code>
          </div>
          <nav class="tabs" role="tablist" aria-label="La respuesta">
            <button type="button" role="tab" class="tab" :class="{ on: resTab === 'body' }" :aria-selected="resTab === 'body'" @click="resTab = 'body'">Cuerpo</button>
            <button type="button" role="tab" class="tab" :class="{ on: resTab === 'headers' }" :aria-selected="resTab === 'headers'" @click="resTab = 'headers'">
              Encabezados <span class="count">{{ Object.keys(response.headers || {}).length }}</span>
            </button>
          </nav>
          <pre v-if="resTab === 'body'" class="out">{{ prettyBody }}</pre>
          <dl v-else class="out headers"><template v-for="(v, k) in response.headers" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template></dl>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.head-who { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0 }
.service { padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); overflow: auto }
.info summary { cursor: pointer; color: var(--fg-2) }
.info dl { margin: var(--space-3) 0 0; display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); font-size: var(--text-sm) }
dt { color: var(--fg-2) }
dd { margin: 0; word-break: break-word }
code, pre, .code { font-family: var(--font-mono) }
.serve-log { margin-top: var(--space-3) }
.serve-log summary { cursor: pointer; color: var(--fg-2); font-size: var(--text-sm) }
.serve-log pre { margin: var(--space-2) 0 0; font-size: var(--text-sm); white-space: pre-wrap }
.main { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0 }
.request-bar { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center }
.request-bar .method { flex: none; width: 96px; font-family: var(--font-mono) }
.request-bar .path { flex: 1 1 180px; min-width: 0; font-family: var(--font-mono) }
.code { width: 100%; font-size: var(--text-sm); resize: vertical }
.response { display: flex; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--border); padding-top: var(--space-3) }
.response-head { display: flex; align-items: center; gap: var(--space-3); min-width: 0 }
.url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0 }
.badge { flex: none; padding: 2px var(--space-2); border-radius: 999px; font-size: var(--text-xs); font-weight: 600; font-family: var(--font-mono) }
.badge[data-kind="ok"] { background: color-mix(in oklab, var(--presence-on) 18%, transparent); color: var(--foreground) }
.badge[data-kind="warn"] { background: color-mix(in oklab, var(--task-blocked) 18%, transparent); color: var(--foreground) }
.badge[data-kind="bad"] { background: color-mix(in oklab, var(--send-fail) 18%, transparent); color: var(--foreground) }
.out { margin: 0; font-family: var(--font-mono); font-size: var(--text-sm); white-space: pre-wrap; word-break: break-word }
.out.headers { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3) }
.note { margin: 0; color: var(--fg-2); font-size: var(--text-sm) }
.bad { margin: 0; color: var(--send-fail) }
</style>
