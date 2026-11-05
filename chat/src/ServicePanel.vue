<script setup>
/* UN SERVICIO DEL PLAYGROUND EN EL EDITOR (server/services.go): un servidor de esta máquina que el equipo alcanza por
   la VPN con un nombre fijo. El interruptor lo prende (el chat levanta el programa y reinicia `playground serve`) o lo
   apaga; «Probar» le pide un ejemplo desde esta máquina. */
import { ref, watch } from 'vue'

const props = defineProps({ service: { type: Object, required: true }, serving: Boolean, serveLog: { type: String, default: '' } })
const emit = defineEmits(['changed', 'close'])

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

const sample = ref(null)
async function trySample() {
  sample.value = { loading: true }
  try {
    const res = await fetch(`/api/services/${encodeURIComponent(props.service.alias)}/sample`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    let pretty = body.body
    try { pretty = JSON.stringify(JSON.parse(body.body), null, 2) } catch { /* no es JSON: va tal cual */ }
    sample.value = { path: body.path, body: pretty }
  } catch (e) { sample.value = { error: e.message } }
}
watch(() => props.service.alias, () => { sample.value = null; error.value = '' })

const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(props.service.url); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}
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
  <div class="region-body service">
    <p>{{ service.description }}</p>
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
    <p v-if="error" class="bad">{{ error }}</p>

    <div v-if="service.managed" class="try">
      <button type="button" class="btn btn-outline btn-sm" :disabled="!service.listening || sample?.loading" @click="trySample">Probar</button>
      <span class="note">{{ service.listening ? 'le pide un ejemplo desde esta máquina' : 'prendelo para probarlo' }}</span>
    </div>
    <template v-if="sample && !sample.loading">
      <p v-if="sample.error" class="bad">{{ sample.error }}</p>
      <pre v-else class="sample"><span class="note">GET {{ sample.path }}</span>
{{ sample.body }}</pre>
    </template>

    <details v-if="serveLog" class="serve-log">
      <summary>Lo último de <code>playground serve</code></summary>
      <pre>{{ serveLog }}</pre>
    </details>
  </div>
</template>

<style scoped>
.head-who { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0 }
.service { padding: var(--space-4) var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); overflow: auto }
.service p { margin: 0 }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-4); font-size: var(--text-sm) }
dt { color: var(--fg-2) }
dd { margin: 0; word-break: break-word }
code, pre { font-family: var(--font-mono) }
.try { display: flex; align-items: center; gap: var(--space-3) }
.note { color: var(--fg-2); font-size: var(--text-sm) }
.sample, .serve-log pre { margin: 0; font-size: var(--text-sm); white-space: pre-wrap; padding: var(--space-3); border-top: 1px solid var(--border) }
.serve-log summary { cursor: pointer; color: var(--fg-2); font-size: var(--text-sm) }
.bad { color: var(--send-fail) }
</style>
