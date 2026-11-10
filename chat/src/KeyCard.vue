<script setup>
/* LAS CLAVES EN LA CONVERSACIÓN, como un archivo de WhatsApp: el icono a la izquierda, qué es, y lo que se puede hacer.
   - «Pido tu llavero»: el pedido (lo contesta solo el servidor de quien lo recibe).
   - «Mi llavero (n)»: la lista de nombres; quien la pidió marca las que quiere y «Pedir» (también se contesta solo).
   - «Pido estas claves»: el pedido de unas en concreto.
   - «Llavero · n claves»: un bloque .env con los valores encriptados; «Guardar en mi llavero» las suma a tu tabla y
     «Descargar .env» baja el archivo ya desencriptado con tu llave del equipo.
   - «Clave «x»» (el formato de antes): una clave encriptada. */
import { computed, ref } from 'vue'
import { envName, open } from './keyring.js'
import { keyring, loadKeyring } from './keyringStore.js'

const props = defineProps({ info: { type: Object, required: true }, mine: { type: Boolean, default: false }, who: { type: String, default: '' } })
const emit = defineEmits(['ask-keys', 'send-keys'])
const value = ref('')
const visible = ref(false)
const error = ref('')
const copied = ref('')
const picked = ref(new Set())
const busy = ref(false)

const kind = computed(() => props.info.kind)
// Las que ya tenés, por su nombre o como variable de entorno (shopify-admin-dev y SHOPIFY_ADMIN_DEV son la misma).
const savedNames = computed(() => new Set(keyring.saved.flatMap((k) => [k.name, envName(k.name)])))
const haveKey = (n) => savedNames.value.has(n) || savedNames.value.has(envName(n))
const envToSave = computed(() => (props.info.keys || []).filter((k) => !keyring.saved.some((s) => s.sealed === k.sealed)))
const alreadySaved = computed(() => keyring.saved.some((k) => k.name === props.info.name && k.sealed === props.info.sealed))
const icon = computed(() => (kind.value === 'key' ? (value.value ? 'unlock' : 'lock') : kind.value === 'env' ? 'lock' : 'key'))
const title = computed(() => {
  switch (kind.value) {
    case 'ask-keyring': return props.mine ? `Pediste el llavero de ${props.who}` : `${props.who} pide tu llavero`
    case 'list': return props.mine ? 'Tu llavero' : `Llavero de ${props.who}`
    case 'ask': return props.mine ? `Pediste ${props.info.names.length === 1 ? 'una clave' : `${props.info.names.length} claves`}` : `${props.who} pide ${props.info.names.length === 1 ? 'una clave' : `${props.info.names.length} claves`}`
    case 'env': return `${props.info.keys.length} clave${props.info.keys.length === 1 ? '' : 's'} · .env`
    default: return props.info.name
  }
})
const meta = computed(() => {
  switch (kind.value) {
    case 'ask-keyring': return props.mine ? 'Te llega la lista de sus claves (sólo los nombres)' : 'Se le contesta solo con los nombres'
    case 'list': return `${props.info.names.length} clave${props.info.names.length === 1 ? '' : 's'} · sólo los nombres`
    case 'ask': return props.mine ? 'Te llegan encriptadas' : 'Se le mandan solas, encriptadas'
    case 'env': return 'Encriptadas con la llave del equipo'
    default: return 'Clave encriptada · llave del equipo'
  }
})
const toPick = computed(() => (props.info.names || []).filter((n) => !haveKey(n)))

function toggle(n) {
  const s = new Set(picked.value)
  s.has(n) ? s.delete(n) : s.add(n)
  picked.value = s
}
async function decrypt() {
  error.value = ''
  if (!keyring.teamKey) { error.value = 'Falta la llave del equipo (consola → Llavero).'; return }
  try { value.value = await open(keyring.teamKey, props.info.sealed); visible.value = true } catch { error.value = 'No abre con tu llavero del equipo.' }
}
// Guardar en mi llavero: va el MISMO encriptado (todos tenemos la misma llave del equipo).
async function save() {
  busy.value = true
  try {
    const r = await fetch('/api/keyring/keys', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: props.info.name, sealed: props.info.sealed, updated: new Date().toISOString() }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
    await loadKeyring()
  } catch (e) { error.value = e.message } finally { busy.value = false }
}
// Guardar todas las del bloque que no tenías (mismo encriptado), con su nombre de variable.
async function saveAll() {
  busy.value = true
  error.value = ''
  try {
    for (const k of envToSave.value) {
      const r = await fetch('/api/keyring/keys', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: k.name, sealed: k.sealed, updated: new Date().toISOString() }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
    }
    await loadKeyring()
  } catch (e) { error.value = e.message } finally { busy.value = false }
}
// Descargar .env: el bloque desencriptado con tu llave del equipo, como archivo.
async function downloadEnv() {
  error.value = ''
  if (!keyring.teamKey) { error.value = 'Falta la llave del equipo (consola → Llavero).'; return }
  try {
    const lines = []
    for (const k of props.info.keys) lines.push(`${k.name}=${await open(keyring.teamKey, k.sealed)}`)
    const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'llavero.env' })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { error.value = 'No abre con tu llave del equipo.' }
}
async function copy(text, tag) {
  try { await navigator.clipboard.writeText(text); copied.value = tag; setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500) } catch { /* sin portapapeles */ }
}
</script>

<template>
  <div class="key-card" :class="`kind-${kind}`">
    <div class="key-head">
      <span class="key-icon" aria-hidden="true"><span class="ui-icon" :data-icon="icon"></span></span>
      <span class="key-main">
        <span class="key-name" :class="{ mono: kind === 'key' }">{{ title }}</span>
        <span class="key-meta">{{ meta }}</span>
      </span>
    </div>

    <!-- La lista de un llavero: quien la pidió marca las que quiere. Las que ya tenés, aparecen marcadas así. -->
    <ul v-if="kind === 'list' && info.names.length" class="key-list">
      <li v-for="n in info.names" :key="n">
        <label v-if="!mine && !haveKey(n)" class="key-pick">
          <input type="checkbox" :checked="picked.has(n)" @change="toggle(n)"><span class="mono">{{ n }}</span>
        </label>
        <span v-else class="key-pick" :class="{ have: haveKey(n) && !mine }">
          <span class="ui-icon" :data-icon="haveKey(n) && !mine ? 'check' : 'lock'" aria-hidden="true"></span><span class="mono">{{ n }}</span>
          <small v-if="haveKey(n) && !mine">ya la tenés</small>
        </span>
      </li>
    </ul>
    <!-- El bloque .env: cada variable con su candado (o ✓ si ya la tenés); lo que no estaba, como nota. -->
    <ul v-else-if="kind === 'env'" class="key-list">
      <li v-for="k in info.keys" :key="k.name">
        <span class="key-pick" :class="{ have: !mine && !envToSave.includes(k) }">
          <span class="ui-icon" :data-icon="!mine && !envToSave.includes(k) ? 'check' : 'lock'" aria-hidden="true"></span><span class="mono">{{ k.name }}</span>
          <small v-if="!mine && !envToSave.includes(k)">ya la tenés</small>
        </span>
      </li>
      <li v-for="n in info.notes" :key="n" class="key-note">{{ n }}</li>
    </ul>
    <ul v-else-if="kind === 'ask'" class="key-list">
      <li v-for="n in info.names" :key="n"><span class="key-pick"><span class="ui-icon" data-icon="lock" aria-hidden="true"></span><span class="mono">{{ n }}</span></span></li>
    </ul>

    <div v-if="kind === 'key' && value" class="key-value">
      <code>{{ visible ? value : '••••••••••' }}</code>
      <button type="button" class="region-action" :title="visible ? 'Ocultar' : 'Ver'" :aria-label="visible ? 'Ocultar' : 'Ver'" @click="visible = !visible">
        <span class="ui-icon" :data-icon="visible ? 'eye-off' : 'eye'" aria-hidden="true"></span>
      </button>
      <button type="button" class="region-action" :title="copied === 'v' ? 'Copiada' : 'Copiar la clave'" aria-label="Copiar la clave" @click="copy(value, 'v')">
        <span class="ui-icon" :data-icon="copied === 'v' ? 'check' : 'copy'" aria-hidden="true"></span>
      </button>
    </div>
    <p v-if="error" class="key-error">{{ error }}</p>

    <div class="key-actions">
      <template v-if="kind === 'env'">
        <button v-if="info.keys.length" type="button" class="key-btn" @click="downloadEnv"><span class="ui-icon" data-icon="download" aria-hidden="true"></span>Descargar .env</button>
        <template v-if="!mine && info.keys.length">
          <span v-if="!envToSave.length" class="key-meta key-wait"><span class="ui-icon" data-icon="check" aria-hidden="true"></span>En tu llavero</span>
          <button v-else type="button" class="key-btn" :disabled="busy" @click="saveAll"><span class="ui-icon" data-icon="key" aria-hidden="true"></span>Guardar en mi llavero</button>
        </template>
      </template>
      <template v-else-if="kind === 'key'">
        <button v-if="!value" type="button" class="key-btn" @click="decrypt"><span class="ui-icon" data-icon="unlock" aria-hidden="true"></span>Desencriptar</button>
        <span v-if="alreadySaved" class="key-meta key-wait"><span class="ui-icon" data-icon="check" aria-hidden="true"></span>En tu llavero</span>
        <button v-else type="button" class="key-btn" :disabled="busy" @click="save"><span class="ui-icon" data-icon="key" aria-hidden="true"></span>Guardar en mi llavero</button>
      </template>
      <template v-else-if="kind === 'list' && !mine">
        <span v-if="!toPick.length" class="key-meta key-wait"><span class="ui-icon" data-icon="check" aria-hidden="true"></span>{{ info.names.length ? 'Ya las tenés todas' : 'No tiene claves' }}</span>
        <template v-else>
          <button type="button" class="key-btn" @click="picked = new Set(picked.size === toPick.length ? [] : toPick)">{{ picked.size === toPick.length ? 'Ninguna' : 'Todas' }}</button>
          <button type="button" class="key-btn" :disabled="!picked.size" @click="emit('ask-keys', [...picked]); picked = new Set()">
            <span class="ui-icon" data-icon="send" aria-hidden="true"></span>Pedir {{ picked.size || '' }}
          </button>
        </template>
      </template>
      <template v-else-if="kind === 'ask' && !mine && !keyring.autoShare">
        <button type="button" class="key-btn" @click="emit('send-keys', info.names)"><span class="ui-icon" data-icon="send" aria-hidden="true"></span>Enviarlas</button>
      </template>
      <span v-else-if="mine && kind !== 'list' && kind !== 'env'" class="key-meta key-wait"><span class="ui-icon" data-icon="clock" aria-hidden="true"></span>Esperando respuesta</span>
      <span v-else-if="!mine && kind !== 'list' && kind !== 'env'" class="key-meta key-wait"><span class="ui-icon" data-icon="send" aria-hidden="true"></span>Contestado solo</span>
    </div>
  </div>
</template>

<style scoped>
.key-card { width: 300px; max-width: 100%; margin: 2px 0 4px; border: 1px solid var(--hairline); border-radius: 10px; overflow: hidden;
  background: color-mix(in oklab, var(--foreground) 5%, transparent) }
.key-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 8px }
.key-icon { flex: none; display: grid; place-items: center; width: 38px; height: 44px; border-radius: 6px;
  background: color-mix(in oklab, var(--primary) 18%, var(--background)); color: color-mix(in oklab, var(--primary) 75%, var(--foreground)) }
.key-icon .ui-icon { width: 20px; height: 20px }
.key-card:not(.kind-key) .key-icon { background: color-mix(in oklab, var(--chart-2) 22%, var(--background)); color: color-mix(in oklab, var(--chart-2) 70%, var(--foreground)) }
.key-main { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.key-name { font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.mono { font-family: var(--font-mono) }
.key-meta { color: var(--fg-2); font-size: var(--text-xs) }
.key-list { list-style: none; margin: 0 12px 8px; padding: 4px 0; border-radius: 6px; background: var(--background) }
.key-pick { display: flex; align-items: center; gap: 8px; padding: 4px 10px; font-size: var(--text-sm) }
label.key-pick { cursor: pointer }
label.key-pick:hover { background: color-mix(in oklab, var(--foreground) 5%, transparent) }
.key-pick .ui-icon { width: 14px; height: 14px; color: var(--fg-2) }
.key-pick small { margin-left: auto; color: var(--fg-2); font-size: var(--text-xs) }
.key-pick.have .mono { color: var(--fg-2) }
.key-note { padding: 4px 10px; color: var(--fg-2); font-size: var(--text-xs) }
.key-value { display: flex; align-items: center; gap: 2px; margin: 0 12px 6px; padding: 2px 2px 2px 10px; border-radius: 6px; background: var(--background) }
.key-value code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.key-error { margin: 0 12px 6px; color: var(--destructive-ink); font-size: var(--text-xs) }
.key-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); padding: 4px 6px; border-top: 1px solid var(--hairline) }
/* Una acción de la tarjeta: icono y texto, como los botones de un archivo en WhatsApp. */
.key-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; white-space: nowrap; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
  color: var(--primary-ink, var(--primary)); font: inherit; font-size: var(--text-sm); font-weight: 500; cursor: pointer }
.key-btn:hover:not(:disabled) { background: color-mix(in oklab, var(--foreground) 6%, transparent) }
.key-btn:disabled { opacity: .5; cursor: default }
.key-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.key-btn .ui-icon { width: 15px; height: 15px }
.key-wait { display: inline-flex; align-items: center; gap: 6px; padding: 0 6px; height: 28px }
.key-wait .ui-icon { width: 14px; height: 14px }
</style>
