<script setup>
/* EL LLAVERO, en la consola de una conversación: las claves que se le pasan al equipo (personas o agentes) cuando las
   piden. «Enviar» deja en el mensaje la clave CIFRADA con la llave del equipo y el comando de openssl para abrirla; lo
   mandás vos, como cualquier mensaje. El llavero y la llave viven en esta máquina (los guarda el servidor del chat). */
import { computed, onMounted, ref } from 'vue'
import { messageFor, newTeamKey, open, seal } from './keyring.js'

const emit = defineEmits(['insert'])
const keys = ref([])
const teamKey = ref('')
const teamKeyPath = ref('')
const error = ref('')
const shown = ref(new Set())
const copied = ref('')
const form = ref({ name: '', value: '', note: '' })
const pastedKey = ref('')
const changingKey = ref(false)
const sealedIn = ref('')
const opened = ref('')

async function load() {
  try {
    const r = await fetch('/api/keyring')
    const body = await r.json()
    if (!r.ok) throw new Error(body.error || r.statusText)
    keys.value = body.keys || []
    teamKey.value = body.teamKey || ''
    teamKeyPath.value = body.teamKeyPath || ''
  } catch (e) { error.value = `No se pudo leer el llavero: ${e.message}` }
}
async function save(extra = {}) {
  error.value = ''
  const r = await fetch('/api/keyring', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: keys.value, ...extra }) })
  if (!r.ok) { error.value = (await r.json().catch(() => ({}))).error || r.statusText; return false }
  return true
}
onMounted(load)

const sorted = computed(() => [...keys.value].sort((a, b) => a.name.localeCompare(b.name)))

async function add() {
  const name = form.value.name.trim()
  const value = form.value.value
  if (!name || !value) return
  const entry = { name, value, note: form.value.note.trim(), updated: new Date().toISOString() }
  keys.value = [...keys.value.filter((k) => k.name !== name), entry]
  if (await save()) form.value = { name: '', value: '', note: '' }
}
async function remove(k) {
  if (!confirm(`¿Borrar «${k.name}» del llavero?`)) return
  keys.value = keys.value.filter((x) => x !== k)
  await save()
}
async function send(k) {
  if (!teamKey.value) { error.value = 'Falta la llave del equipo: generala o pegá la que te pasaron.'; return }
  emit('insert', messageFor(k.name, await seal(teamKey.value, k.value)))
}
function toggle(k) {
  const s = new Set(shown.value)
  s.has(k.name) ? s.delete(k.name) : s.add(k.name)
  shown.value = s
}
async function copy(text, tag) {
  try { await navigator.clipboard.writeText(text); copied.value = tag; setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500) } catch { /* sin portapapeles */ }
}
async function setTeamKey(k) {
  if (keys.value.length && teamKey.value && k !== teamKey.value &&
      !confirm('Vas a cambiar la llave del equipo: lo que ya mandaste cifrado sólo se abre con la anterior. ¿Seguir?')) return
  if (await save({ teamKey: k })) { teamKey.value = k; pastedKey.value = ''; changingKey.value = false }
}
// Abrir un cifrado que te mandaron, con la llave del equipo.
async function openSealed() {
  opened.value = ''
  const m = sealedIn.value.match(/U2FsdGVkX1[A-Za-z0-9+/=]+/)
  if (!m) { opened.value = '✗ No encontré un cifrado (empieza con U2FsdGVkX1).'; return }
  try { opened.value = await open(teamKey.value, m[0]) } catch { opened.value = '✗ No abre con esta llave del equipo.' }
}
</script>

<template>
  <div class="region-body console keyring">
    <p v-if="error" class="keyring-error">{{ error }}</p>

    <!-- La llave del equipo: la misma en la máquina de todos. Se pasa una vez, por Slack. -->
    <section v-if="!teamKey || changingKey" class="keyring-team">
      <p class="console-empty">{{ teamKey ? 'Cambiar la llave del equipo.' : 'Falta la llave del equipo: la misma en la máquina de todos, para cifrar y descifrar.' }}</p>
      <div class="keyring-row">
        <button type="button" class="btn" @click="setTeamKey(newTeamKey())">Generar una nueva</button>
        <input v-model="pastedKey" class="keyring-input" type="text" placeholder="o pegá la que te pasaron" spellcheck="false" autocomplete="off">
        <button type="button" class="btn" :disabled="!pastedKey.trim()" @click="setTeamKey(pastedKey.trim())">Guardar</button>
        <button v-if="teamKey" type="button" class="btn-link" @click="changingKey = false">Cancelar</button>
      </div>
    </section>
    <p v-else class="keyring-team-ok">
      Llave del equipo en <code>{{ teamKeyPath.replace(/^\/Users\/[^/]+/, '~') }}</code> ·
      <button type="button" class="btn-link" @click="copy(teamKey, 'team')">{{ copied === 'team' ? 'copiada' : 'copiarla para pasarla' }}</button> ·
      <button type="button" class="btn-link" @click="changingKey = true">cambiarla</button>
    </p>

    <form class="keyring-row keyring-add" @submit.prevent="add">
      <input v-model="form.name" class="keyring-input name" type="text" placeholder="nombre (p. ej. shopify-admin-dev)" spellcheck="false" autocomplete="off">
      <input v-model="form.value" class="keyring-input" type="password" placeholder="valor" autocomplete="new-password">
      <input v-model="form.note" class="keyring-input" type="text" placeholder="para qué es (opcional)">
      <button type="submit" class="btn" :disabled="!form.name.trim() || !form.value">Agregar</button>
    </form>

    <p v-if="!keys.length" class="console-empty">El llavero está vacío. Lo que agregues acá es para pasárselo al equipo cuando lo pida.</p>
    <ul v-else class="keyring-list">
      <li v-for="k in sorted" :key="k.name" class="keyring-item">
        <b class="keyring-name">{{ k.name }}</b>
        <code class="keyring-value">{{ shown.has(k.name) ? k.value : '••••••••' }}</code>
        <span class="keyring-note">{{ k.note }}</span>
        <span class="keyring-actions">
          <button type="button" class="region-action" :title="shown.has(k.name) ? 'Ocultar' : 'Ver el valor'" :aria-label="shown.has(k.name) ? 'Ocultar' : 'Ver el valor'" @click="toggle(k)">
            <span class="ui-icon" data-icon="eye" aria-hidden="true"></span>
          </button>
          <button type="button" class="region-action" :title="copied === k.name ? 'Copiado' : 'Copiar el valor'" aria-label="Copiar el valor" @click="copy(k.value, k.name)">
            <span class="ui-icon" :data-icon="copied === k.name ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
          <button type="button" class="btn" :disabled="!teamKey" title="Dejarla cifrada en el mensaje; la mandás vos" @click="send(k)">Enviar</button>
          <button type="button" class="region-action" title="Borrar" aria-label="Borrar" @click="remove(k)">
            <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
          </button>
        </span>
      </li>
    </ul>

    <!-- Para cuando te mandan una a vos: pegás el mensaje y se abre con la misma llave. -->
    <form v-if="teamKey" class="keyring-row keyring-open" @submit.prevent="openSealed">
      <input v-model="sealedIn" class="keyring-input" type="text" placeholder="pegá un cifrado que te mandaron para abrirlo" spellcheck="false" autocomplete="off">
      <button type="submit" class="btn" :disabled="!sealedIn.trim()">Descifrar</button>
      <code v-if="opened" class="keyring-value opened">{{ opened }}</code>
    </form>
  </div>
</template>

<style scoped>
.keyring { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-4) }
.keyring-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) }
.keyring-input { flex: 1 1 160px; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--background); color: var(--foreground); font: inherit; font-size: var(--text-sm) }
.keyring-input.name { font-family: var(--font-mono) }
.keyring-input:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px }
.keyring-team-ok { margin: 0; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-error { margin: 0; color: var(--destructive-ink); font-size: var(--text-sm) }
.keyring-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column }
.keyring-item { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(100px, 1fr) minmax(0, 1.4fr) auto; align-items: center; gap: var(--space-3);
  padding: 4px 0; border-top: 1px solid var(--hairline) }
.keyring-item:first-child { border-top: 0 }
.keyring-name { font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.keyring-value { font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.keyring-value.opened { flex-basis: 100%; white-space: normal; word-break: break-all }
.keyring-note { color: var(--fg-2); font-size: var(--text-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.keyring-actions { display: flex; align-items: center; gap: 2px }
</style>
