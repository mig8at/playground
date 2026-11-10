<script setup>
/* EL LLAVERO, en la consola de una conversación: encriptar una clave con la llave del equipo para pasarla por el chat,
   o desencriptar una que te mandaron. No guarda nada: sólo la llave del equipo, en esta máquina (la misma en la de
   todos; se abre también con openssl). */
import { computed, onMounted, ref } from 'vue'
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
// Las guardadas: nombre y encriptado (el valor no se guarda); `shown` son las que se están viendo abiertas.
const saved = ref([])
const shown = ref({})
const sortedSaved = computed(() => [...saved.value].sort((a, b) => (b.updated || '').localeCompare(a.updated || '')))

onMounted(async () => {
  try {
    const body = await (await fetch('/api/keyring')).json()
    teamKey.value = body.teamKey || ''
    teamKeyPath.value = (body.teamKeyPath || '').replace(/^\/Users\/[^/]+/, '~')
  } catch (e) { error.value = `No se pudo leer la llave del equipo: ${e.message}` }
  try { saved.value = (await (await fetch('/api/keyring/keys')).json()).keys || [] } catch { /* sin guardadas */ }
})
async function keysCall(path, options) {
  const r = await fetch(path, options)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) { error.value = body.error || r.statusText; return }
  saved.value = body.keys || []
}

async function setTeamKey(k) {
  if (teamKey.value && k !== teamKey.value && !confirm('Lo que ya mandaste encriptado sólo se abre con la llave anterior. ¿Cambiarla?')) return
  const r = await fetch('/api/keyring', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey: k }) })
  if (!r.ok) { error.value = (await r.json().catch(() => ({}))).error || r.statusText; return }
  teamKey.value = k; pastedKey.value = ''; changingKey.value = false; error.value = ''
}
// Encriptar también la guarda en la tabla (con el mismo nombre, la reemplaza).
async function encrypt() {
  sealed.value = await seal(teamKey.value, value.value)
  const n = name.value.trim()
  if (n) await keysCall('/api/keyring/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n, sealed: sealed.value, updated: new Date().toISOString() }) })
}
async function toggleShown(k) {
  if (shown.value[k.name] != null) { const { [k.name]: _, ...rest } = shown.value; shown.value = rest; return }
  try { shown.value = { ...shown.value, [k.name]: await open(teamKey.value, k.sealed) } } catch { shown.value = { ...shown.value, [k.name]: '✗ no abre con esta llave' } }
}
async function removeSaved(k) {
  if (!confirm(`¿Borrar «${k.name}» de las guardadas?`)) return
  await keysCall(`/api/keyring/keys/${encodeURIComponent(k.name)}`, { method: 'DELETE' })
}
const when = (iso) => { try { return new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) } catch { return '' } }
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

      <!-- Las guardadas: cada vez que encriptás con nombre, queda acá (sólo encriptada). -->
      <section class="keyring-saved">
        <h4 class="keyring-title">Guardadas <span v-if="saved.length" class="count">{{ saved.length }}</span></h4>
        <p v-if="!saved.length" class="keyring-empty">Todavía no hay. Al encriptar con un nombre, la clave queda acá, encriptada.</p>
        <table v-else class="keyring-table">
          <thead><tr><th class="c-name">Nombre</th><th class="c-sealed">Encriptado</th><th class="c-value">Valor</th><th class="c-when">Actualizada</th><th class="c-acts" aria-label="Acciones"></th></tr></thead>
          <tbody>
            <tr v-for="k in sortedSaved" :key="k.name">
              <td class="name">{{ k.name }}</td>
              <td class="c-sealed mono cut" :title="k.sealed">{{ k.sealed }}</td>
              <td class="mono cut">{{ shown[k.name] != null ? shown[k.name] : '••••••' }}</td>
              <td class="c-when when">{{ when(k.updated) }}</td>
              <td class="acts">
                <button type="button" class="region-action" :title="copied === `s:${k.name}` ? 'Copiado' : 'Copiar el encriptado'" aria-label="Copiar el encriptado" @click="copy(k.sealed, `s:${k.name}`)">
                  <span class="ui-icon" :data-icon="copied === `s:${k.name}` ? 'check' : 'copy'" aria-hidden="true"></span>
                </button>
                <button type="button" class="region-action" :disabled="!teamKey" :title="shown[k.name] != null ? 'Ocultar el valor' : 'Ver el valor'" aria-label="Ver el valor" @click="toggleShown(k)">
                  <span class="ui-icon" data-icon="eye" aria-hidden="true"></span>
                </button>
                <button type="button" class="region-action" title="Borrar" aria-label="Borrar" @click="removeSaved(k)">
                  <span class="ui-icon" data-icon="trash" aria-hidden="true"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
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
.keyring-saved { display: flex; flex-direction: column; gap: 8px }
.keyring-empty { margin: 0; color: var(--fg-2); font-size: var(--text-xs) }
.keyring-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: var(--text-sm) }
.keyring-table th { padding: 6px 8px; text-align: left; font-size: var(--text-xs); font-weight: 500; color: var(--fg-2); border-bottom: 1px solid var(--hairline) }
.keyring-table td { padding: 4px 8px; border-bottom: 1px solid var(--hairline); vertical-align: middle }
.keyring-table tbody tr:hover { background: color-mix(in oklab, var(--foreground) 4%, transparent) }
.keyring-saved { container-type: inline-size }
.keyring-table .c-name { width: 24% }
.keyring-table .c-value { width: 20% }
.keyring-table .c-when { width: 120px }
.keyring-table .c-acts { width: 104px }
/* En una consola angosta, lo que se puede pedir con un botón (copiar el encriptado) deja su columna. */
@container (max-width: 560px) { .keyring-table .c-sealed, .keyring-table .c-when { display: none } .keyring-table .c-name { width: 45% } .keyring-table .c-value { width: auto } }
.keyring-table .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.keyring-table .mono { font-family: var(--font-mono) }
.keyring-table .cut { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.keyring-table .when { color: var(--fg-2); font-size: var(--text-xs); white-space: nowrap }
.keyring-table .acts { text-align: right; white-space: nowrap }
.keyring-table .acts .region-action { display: inline-flex }
</style>
