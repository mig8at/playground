<script setup>
/* EL LLAVERO, en la consola de una conversación: encriptar una clave con la llave del equipo para pasarla por el chat,
   o desencriptar una que te mandaron. No guarda nada: sólo la llave del equipo, en esta máquina (la misma en la de
   todos; se abre también con openssl). */
import { onMounted, ref } from 'vue'
import { newTeamKey, open, seal } from './keyring.js'

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
    <div class="keyring-inner">
      <!-- La llave del equipo: la misma en la máquina de todos. Se pasa una vez, por Slack. -->
      <div v-if="!teamKey || changingKey" class="keyring-team">
        <span>{{ teamKey ? 'Cambiar la llave del equipo' : 'Falta la llave del equipo' }}</span>
        <button type="button" class="btn" @click="setTeamKey(newTeamKey())">Generar una</button>
        <input v-model="pastedKey" class="keyring-input mono" type="text" placeholder="o pegá la que te pasaron" spellcheck="false" autocomplete="off">
        <button type="button" class="btn" :disabled="!pastedKey.trim()" @click="setTeamKey(pastedKey.trim())">Guardar</button>
        <button v-if="teamKey" type="button" class="btn-link" @click="changingKey = false">Cancelar</button>
      </div>
      <p v-else class="keyring-team">
        <span class="ui-icon" data-icon="check" aria-hidden="true"></span>
        <span>Llave del equipo en <code>{{ teamKeyPath }}</code></span>
        <button type="button" class="btn-link" @click="copy(teamKey, 'team')">{{ copied === 'team' ? 'copiada' : 'copiar' }}</button>
        <button type="button" class="btn-link" @click="changingKey = true">cambiar</button>
      </p>
      <p v-if="error" class="keyring-error">{{ error }}</p>

      <div class="keyring-cards">
        <form class="keyring-card" @submit.prevent="encrypt">
          <h4 class="keyring-title">Encriptar</h4>
          <div class="keyring-fields">
            <label class="keyring-field"><span>Nombre</span>
              <input v-model="name" class="keyring-input" type="text" placeholder="shopify-admin-dev" spellcheck="false" autocomplete="off"></label>
            <label class="keyring-field"><span>Valor</span>
              <input v-model="value" class="keyring-input" type="text" spellcheck="false" autocomplete="off" @input="sealed = ''"></label>
          </div>
          <div class="keyring-result">
            <div class="keyring-output" :class="{ 'is-blank': !sealed }">
              <code>{{ sealed || 'El encriptado aparece acá' }}</code>
              <button v-if="sealed" type="button" class="region-action" :title="copied === 'sealed' ? 'Copiado' : 'Copiar'" aria-label="Copiar el encriptado" @click="copy(sealed, 'sealed')">
                <span class="ui-icon" :data-icon="copied === 'sealed' ? 'check' : 'copy'" aria-hidden="true"></span>
              </button>
            </div>
            <button type="submit" class="btn" :disabled="!teamKey || !value">Encriptar</button>
          </div>
        </form>

        <form class="keyring-card" @submit.prevent="decrypt">
          <h4 class="keyring-title">Desencriptar</h4>
          <div class="keyring-fields">
            <label class="keyring-field"><span>Valor encriptado</span>
              <input v-model="sealedIn" class="keyring-input mono" type="text" placeholder="U2FsdGVkX1…" spellcheck="false" autocomplete="off" @input="opened = ''"></label>
          </div>
          <div class="keyring-result">
            <div class="keyring-output" :class="{ 'is-blank': !opened }">
              <code>{{ opened || 'El valor aparece acá' }}</code>
              <button v-if="opened" type="button" class="region-action" :title="copied === 'opened' ? 'Copiado' : 'Copiar'" aria-label="Copiar el valor" @click="copy(opened, 'opened')">
                <span class="ui-icon" :data-icon="copied === 'opened' ? 'check' : 'copy'" aria-hidden="true"></span>
              </button>
            </div>
            <button type="submit" class="btn" :disabled="!teamKey || !sealedIn.trim()">Desencriptar</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.keyring { overflow-y: auto }
.keyring-inner { display: flex; flex-direction: column; gap: var(--space-3); padding: 12px 16px 16px }
.keyring-team { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-team .keyring-input { flex: 1 1 200px; max-width: 360px }
.keyring-error { margin: 0; color: var(--destructive-ink); font-size: var(--text-sm) }
/* Dos tarjetas lado a lado (una debajo de la otra si no entran), con el mismo armado: campos, y abajo el resultado
   con su botón. */
.keyring-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px }
.keyring-card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 12px; border: 1px solid var(--hairline); border-radius: 8px;
  background: var(--card) }
.keyring-title { margin: 0; font-size: var(--text-xs); font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--fg-2) }
.keyring-fields { display: flex; gap: 8px }
.keyring-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 0; min-width: 0; font-size: var(--text-xs); color: var(--fg-2) }
.keyring-input { height: 30px; min-width: 0; padding: 0 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--background); color: var(--foreground); font: inherit; font-size: var(--text-sm) }
.keyring-input.mono { font-family: var(--font-mono) }
.keyring-input:focus-visible { outline: 2px solid var(--ring); outline-offset: -1px }
.keyring-result { display: flex; align-items: center; gap: 8px }
.keyring-output { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; height: 30px; padding: 0 4px 0 10px; border-radius: 6px;
  background: color-mix(in oklab, var(--foreground) 5%, transparent) }
.keyring-output code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.keyring-output.is-blank code { font-family: inherit; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-result .btn { flex: none; min-width: 108px }
</style>
