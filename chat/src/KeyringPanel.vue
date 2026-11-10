<script setup>
/* EL LLAVERO, en la consola de una conversación: encriptar una clave con la llave del equipo para pasarla por el chat,
   o desencriptar una que te mandaron. No guarda nada: sólo la llave del equipo, en esta máquina (la misma en la de
   todos; se abre también con openssl). */
import { onMounted, ref } from 'vue'
import { messageFor, newTeamKey, open, seal } from './keyring.js'

const emit = defineEmits(['insert'])
const teamKey = ref('')
const teamKeyPath = ref('')
const pastedKey = ref('')
const changingKey = ref(false)
const error = ref('')
const copied = ref('')

const name = ref('')
const value = ref('')
const sealed = ref('')
const sealedIn = ref('')
const opened = ref('')

onMounted(async () => {
  try {
    const body = await (await fetch('/api/keyring')).json()
    teamKey.value = body.teamKey || ''
    teamKeyPath.value = (body.teamKeyPath || '').replace(/^\/Users\/[^/]+/, '~')
  } catch (e) { error.value = `No se pudo leer la llave del equipo: ${e.message}` }
})

async function setTeamKey(k) {
  if (teamKey.value && k !== teamKey.value && !confirm('Lo que ya mandaste encriptado sólo se abre con la llave anterior. ¿Cambiarla?')) return
  const r = await fetch('/api/keyring', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey: k }) })
  if (!r.ok) { error.value = (await r.json().catch(() => ({}))).error || r.statusText; return }
  teamKey.value = k; pastedKey.value = ''; changingKey.value = false; error.value = ''
}
async function encrypt() { sealed.value = await seal(teamKey.value, value.value) }
async function decrypt() {
  const m = sealedIn.value.match(/U2FsdGVkX1[A-Za-z0-9+/=]+/)
  if (!m) { opened.value = ''; error.value = 'No es un encriptado (empieza con U2FsdGVkX1).'; return }
  try { opened.value = await open(teamKey.value, m[0]); error.value = '' } catch { opened.value = ''; error.value = 'No abre con esta llave del equipo.' }
}
async function copy(text, tag) {
  try { await navigator.clipboard.writeText(text); copied.value = tag; setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500) } catch { /* sin portapapeles */ }
}
</script>

<template>
  <div class="region-body console keyring">
    <!-- La llave del equipo: la misma en la máquina de todos. Se pasa una vez, por Slack. -->
    <div v-if="!teamKey || changingKey" class="keyring-row">
      <span class="keyring-hint">{{ teamKey ? 'Cambiar la llave del equipo:' : 'Falta la llave del equipo:' }}</span>
      <button type="button" class="btn" @click="setTeamKey(newTeamKey())">Generar una</button>
      <input v-model="pastedKey" class="keyring-input" type="text" placeholder="o pegá la que te pasaron" spellcheck="false" autocomplete="off">
      <button type="button" class="btn" :disabled="!pastedKey.trim()" @click="setTeamKey(pastedKey.trim())">Guardar</button>
      <button v-if="teamKey" type="button" class="btn-link" @click="changingKey = false">Cancelar</button>
    </div>
    <p v-else class="keyring-hint">
      Llave del equipo en <code>{{ teamKeyPath }}</code> ·
      <button type="button" class="btn-link" @click="copy(teamKey, 'team')">{{ copied === 'team' ? 'copiada' : 'copiarla' }}</button> ·
      <button type="button" class="btn-link" @click="changingKey = true">cambiarla</button>
    </p>
    <p v-if="error" class="keyring-error">{{ error }}</p>

    <form class="keyring-grid" @submit.prevent="encrypt">
      <label>Nombre<input v-model="name" class="keyring-input" type="text" placeholder="shopify-admin-dev" spellcheck="false" autocomplete="off"></label>
      <label>Valor<input v-model="value" class="keyring-input" type="text" spellcheck="false" autocomplete="off" @input="sealed = ''"></label>
      <label>Encriptado
        <span class="keyring-out">
          <input :value="sealed" class="keyring-input mono" type="text" readonly placeholder="—">
          <button v-if="sealed" type="button" class="region-action" :title="copied === 'sealed' ? 'Copiado' : 'Copiar'" aria-label="Copiar" @click="copy(sealed, 'sealed')">
            <span class="ui-icon" :data-icon="copied === 'sealed' ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
          <button v-if="sealed" type="button" class="btn-link" title="Dejarlo en el mensaje con el comando para abrirlo"
                  @click="emit('insert', messageFor(name.trim() || 'clave', sealed))">al mensaje</button>
        </span>
      </label>
      <button type="submit" class="btn" :disabled="!teamKey || !value">Encriptar</button>
    </form>

    <form class="keyring-grid" @submit.prevent="decrypt">
      <label>Valor encriptado<input v-model="sealedIn" class="keyring-input mono" type="text" spellcheck="false" autocomplete="off" @input="opened = ''"></label>
      <label>Desencriptado
        <span class="keyring-out">
          <input :value="opened" class="keyring-input mono" type="text" readonly placeholder="—">
          <button v-if="opened" type="button" class="region-action" :title="copied === 'opened' ? 'Copiado' : 'Copiar'" aria-label="Copiar" @click="copy(opened, 'opened')">
            <span class="ui-icon" :data-icon="copied === 'opened' ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
        </span>
      </label>
      <button type="submit" class="btn" :disabled="!teamKey || !sealedIn.trim()">Desencriptar</button>
    </form>
  </div>
</template>

<style scoped>
.keyring { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-4) }
.keyring-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) }
.keyring-grid { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-2) var(--space-3); padding-top: var(--space-3); border-top: 1px solid var(--hairline) }
.keyring-grid label { display: flex; flex-direction: column; gap: 2px; flex: 1 1 160px; min-width: 0; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-grid label > .keyring-input { flex: none }
.keyring-out { display: flex; align-items: center; gap: 4px }
.keyring-input { flex: 1 1 160px; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--background); color: var(--foreground); font: inherit; font-size: var(--text-sm) }
.keyring-input.mono { font-family: var(--font-mono) }
.keyring-input[readonly] { background: color-mix(in oklab, var(--foreground) 4%, var(--background)) }
.keyring-input:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px }
.keyring-hint { margin: 0; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-error { margin: 0; color: var(--destructive-ink); font-size: var(--text-sm) }
</style>
