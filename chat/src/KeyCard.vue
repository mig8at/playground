<script setup>
/* UNA CLAVE EN LA CONVERSACIÓN, como un archivo de WhatsApp: el candado a la izquierda, el nombre y qué es, y lo que se
   puede hacer. Si llegó encriptada: «Desencriptar» la abre acá con la llave del equipo (y se copia); si es un pedido
   y la tenés guardada: «Enviarla». */
import { computed, ref } from 'vue'
import { open } from './keyring.js'
import { keyring } from './keyringStore.js'

const props = defineProps({ info: { type: Object, required: true }, mine: { type: Boolean, default: false } })
const emit = defineEmits(['send-key'])
const value = ref('')
const visible = ref(false)
const error = ref('')
const copied = ref('')

const isAsk = computed(() => props.info.kind === 'ask')
const have = computed(() => keyring.saved.find((k) => k.name === props.info.name))

async function decrypt() {
  error.value = ''
  if (!keyring.teamKey) { error.value = 'Falta la llave del equipo (consola → Llavero).'; return }
  try { value.value = await open(keyring.teamKey, props.info.sealed); visible.value = true } catch { error.value = 'No abre con tu llave del equipo.' }
}
async function copy(text, tag) {
  try { await navigator.clipboard.writeText(text); copied.value = tag; setTimeout(() => { if (copied.value === tag) copied.value = '' }, 1500) } catch { /* sin portapapeles */ }
}
</script>

<template>
  <div class="key-card" :class="{ ask: isAsk }">
    <div class="key-head">
      <span class="key-icon" aria-hidden="true"><span class="ui-icon" :data-icon="isAsk ? 'key' : value ? 'unlock' : 'lock'"></span></span>
      <span class="key-main">
        <span class="key-name">{{ info.name }}</span>
        <span class="key-meta">{{ isAsk ? 'Pide esta clave' : 'Clave encriptada · llave del equipo' }}</span>
      </span>
    </div>

    <div v-if="!isAsk && value" class="key-value">
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
      <template v-if="!isAsk">
        <button v-if="!value" type="button" class="key-btn" @click="decrypt"><span class="ui-icon" data-icon="unlock" aria-hidden="true"></span>Desencriptar</button>
        <button type="button" class="key-btn" @click="copy(info.sealed, 's')"><span class="ui-icon" :data-icon="copied === 's' ? 'check' : 'copy'" aria-hidden="true"></span>{{ copied === 's' ? 'Copiado' : 'Copiar encriptado' }}</button>
      </template>
      <template v-else-if="!mine">
        <button v-if="have" type="button" class="key-btn" @click="emit('send-key', have)"><span class="ui-icon" data-icon="send" aria-hidden="true"></span>Enviarla</button>
        <span v-else class="key-meta">No la tenés en «Guardadas»</span>
      </template>
      <span v-else class="key-meta key-wait"><span class="ui-icon" data-icon="clock" aria-hidden="true"></span>Esperando que te la pasen</span>
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
.ask .key-icon { background: color-mix(in oklab, var(--chart-2) 22%, var(--background)); color: color-mix(in oklab, var(--chart-2) 70%, var(--foreground)) }
.key-main { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
.key-name { font-family: var(--font-mono); font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.key-meta { color: var(--fg-2); font-size: var(--text-xs) }
.key-value { display: flex; align-items: center; gap: 2px; margin: 0 12px 6px; padding: 2px 2px 2px 10px; border-radius: 6px; background: var(--background) }
.key-value code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: var(--text-sm) }
.key-error { margin: 0 12px 6px; color: var(--destructive-ink); font-size: var(--text-xs) }
.key-actions { display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); padding: 4px 6px; border-top: 1px solid var(--hairline) }
/* Una acción de la tarjeta: icono y texto, como los botones de un archivo en WhatsApp. */
.key-btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
  color: var(--primary-ink, var(--primary)); font: inherit; font-size: var(--text-sm); font-weight: 500; cursor: pointer }
.key-btn:hover { background: color-mix(in oklab, var(--foreground) 6%, transparent) }
.key-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.key-btn .ui-icon { width: 15px; height: 15px }
.key-wait { display: inline-flex; align-items: center; gap: 6px; padding: 0 6px; height: 28px }
.key-wait .ui-icon { width: 14px; height: 14px }
</style>
