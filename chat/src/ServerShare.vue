<script setup>
/* LA DERECHA DE UN SERVER: lo que se le pasa a quien va a probar. La línea del .env de ecommerce-final (su pestaña
   Conexiones mira ese túnel) y mandársela por el chat, mostrando antes el texto: sale a tu nombre. */
import { computed, ref, watch } from 'vue'
import { useChatStore } from './stores/chat.js'

const props = defineProps({ server: { type: Object, required: true } })
const emit = defineEmits(['close', 'sent'])
const chat = useChatStore()

const envLine = computed(() => (props.server.tunnelUrl ? `SHOPIFY_TUNNEL_URL=${props.server.tunnelUrl}` : ''))
const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(envLine.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

// A quién: las personas del chat (conversaciones y conectados), sin agentes ni vos. Duncan primero.
const people = computed(() => {
  const seen = new Map()
  for (const p of [...chat.list.map((c) => c.person), ...chat.online]) {
    const email = String(p?.email || '').toLowerCase()
    if (!email || p.agent || p.tool || email === chat.meKey || seen.has(email)) continue
    seen.set(email, p)
  }
  return [...seen.values()].sort((a, b) => Number(/^duncan/i.test(b.email)) - Number(/^duncan/i.test(a.email)))
})
const to = ref('')
watch(people, (list) => { if (!to.value && list.length) to.value = list[0].email }, { immediate: true })

const defaultText = () =>
  `El ambiente de Shopify está listo para probar. En el .env de ecommerce-final:\n${envLine.value}\n` +
  'Después reinicia npm run dev. La tienda: https://creditop-dev-store.myshopify.com (con la contraseña de siempre).'
const draft = ref('')
watch(envLine, (line) => { if (line && !draft.value) draft.value = defaultText() }, { immediate: true })
const sending = ref(false)
async function send() {
  const person = people.value.find((p) => p.email === to.value)
  if (!person || !draft.value.trim() || sending.value) return
  sending.value = true
  try {
    chat.open(person)
    await chat.send(draft.value)
    emit('sent')
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="region-head">
    <span>Para probar</span>
    <div class="region-actions">
      <button type="button" class="region-action" title="Ocultar" aria-label="Ocultar" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="region-body share">
    <template v-if="envLine">
      <p class="note">La línea para el <code>.env</code> de ecommerce-final:</p>
      <code class="env-line">{{ envLine }}</code>
      <button type="button" class="btn btn-outline btn-sm" @click="copy">{{ copied ? 'Copiada' : 'Copiar' }}</button>

      <form class="send" @submit.prevent="send">
        <p class="note">Mandársela por el chat. Sale a tu nombre: revisa el texto.</p>
        <select v-model="to" class="input input-sm" aria-label="A quién" :disabled="!people.length">
          <option v-for="p in people" :key="p.email" :value="p.email">{{ p.name || p.email }}</option>
        </select>
        <textarea v-model="draft" class="input" rows="6" aria-label="Mensaje"></textarea>
        <div class="send-row">
          <button type="submit" class="btn btn-sm" :disabled="!server.ready || !people.length || sending">{{ sending ? 'Mandando…' : 'Mandar' }}</button>
          <button type="button" class="btn btn-ghost btn-sm" @click="draft = defaultText()">Volver al texto de siempre</button>
        </div>
        <p v-if="!server.ready" class="note">Se manda cuando el server esté listo: si no, la dirección no sirve.</p>
      </form>
    </template>
    <p v-else class="note">Cuando el túnel esté prendido, acá aparece su dirección para pasarla.</p>
  </div>
</template>

<style scoped>
.share { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) var(--gutter); overflow: auto }
.share > .btn { align-self: flex-start }
.note { margin: 0; color: var(--fg-2); font-size: var(--text-sm); line-height: 1.5 }
.note code, .env-line { font-family: var(--font-mono) }
.env-line { display: block; font-size: var(--text-sm); word-break: break-all; user-select: all; padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border); border-radius: var(--radius-sm) }
.send { display: flex; flex-direction: column; gap: var(--space-2); border-top: 1px solid var(--border); padding-top: var(--space-3) }
.send textarea { width: 100%; font: inherit; resize: vertical }
.send-row { display: flex; flex-wrap: wrap; gap: var(--space-2) }
</style>
