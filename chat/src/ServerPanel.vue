<script setup>
/* UN SERVER EN EL EDITOR: lo que hay que tener prendido en esta máquina para que otra persona pruebe contra ella
   (server/servers.go). Muestra cada pieza con su punto, «Levantar» hace sólo lo que falta y «Mandar» le pasa la
   dirección del túnel a alguien del chat, mostrando antes el texto: sale a tu nombre. */
import { computed, ref, watch } from 'vue'
import { useChatStore } from './stores/chat.js'

const props = defineProps({ server: { type: Object, required: true } })
const emit = defineEmits(['changed', 'close', 'sent'])
const chat = useChatStore()

const acting = ref('')
const actionError = ref('')
async function act(path) {
  acting.value = path
  actionError.value = ''
  try {
    const res = await fetch(`/api/servers/${props.server.id}/${path}`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
  } catch (e) {
    actionError.value = e.message
  } finally {
    acting.value = ''
    emit('changed')
  }
}

// La línea que va en el .env de quien prueba (ecommerce-final): su pestaña Conexiones mira ese túnel.
const envLine = computed(() => (props.server.tunnelUrl ? `SHOPIFY_TUNNEL_URL=${props.server.tunnelUrl}` : ''))
const copied = ref(false)
async function copy() {
  try { await navigator.clipboard.writeText(envLine.value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* sin portapapeles */ }
}

// A quién mandársela: las personas del chat (conversaciones y conectados), sin agentes ni vos. Duncan primero.
const people = computed(() => {
  const seen = new Map()
  for (const p of [...chat.list.map((c) => c.person), ...chat.online]) {
    const email = String(p?.email || '').toLowerCase()
    if (!email || p.agent || p.tool || chat.isMe?.(p) || email === chat.meKey || seen.has(email)) continue
    seen.set(email, p)
  }
  return [...seen.values()].sort((a, b) => Number(/^duncan/i.test(b.email)) - Number(/^duncan/i.test(a.email)))
})
const to = ref('')
watch(people, (list) => { if (!to.value && list.length) to.value = list[0].email }, { immediate: true })
const draft = ref('')
function prepare() {
  draft.value = `El ambiente de Shopify está listo para probar. En el .env de ecommerce-final:\n${envLine.value}\n` +
    `Después reinicia npm run dev. La tienda: https://creditop-dev-store.myshopify.com (con la contraseña de siempre).`
}
async function send() {
  const person = people.value.find((p) => p.email === to.value)
  if (!person || !draft.value.trim()) return
  chat.open(person)
  await chat.send(draft.value)
  draft.value = ''
  emit('sent')
}

const dotOf = (ok) => (ok ? 'ok' : 'off')
</script>

<template>
  <div class="region-head">
    <span class="head-who"><span class="head-title">{{ server.name }}</span>
      <span class="count head-sub">{{ server.busy ? server.step || 'trabajando…' : server.ready ? 'listo para probar' : 'falta prender algo' }}</span></span>
    <div class="region-actions">
      <button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>
  </div>
  <div class="region-body server">
    <ul class="checks">
      <li v-for="c in server.checks" :key="c.name">
        <i class="dot" :data-state="dotOf(c.ok)" aria-hidden="true"></i>
        <span class="check-name">{{ c.name }}</span>
        <span class="check-detail" :title="c.detail">{{ c.detail }}</span>
      </li>
    </ul>

    <div class="actions">
      <button type="button" class="btn btn-sm" :disabled="server.busy || !!acting" @click="act('up')">
        {{ server.busy ? 'Levantando…' : server.ready ? 'Revisar y levantar lo que falte' : 'Levantar todo' }}
      </button>
      <button type="button" class="btn btn-outline btn-sm" :disabled="server.busy || !!acting || !server.tunnelUrl" @click="act('down')">Apagar túnel</button>
      <button type="button" class="btn btn-outline btn-sm" :disabled="!envLine" @click="copy">{{ copied ? 'Copiada' : 'Copiar línea del .env' }}</button>
      <button type="button" class="btn btn-outline btn-sm" :disabled="!server.ready || !people.length" @click="prepare">Mandar por el chat…</button>
    </div>
    <p v-if="actionError || server.error" class="note bad">{{ actionError || server.error }}</p>
    <p v-if="envLine" class="note"><code>{{ envLine }}</code></p>

    <form v-if="draft" class="send" @submit.prevent="send">
      <label class="note">Sale a tu nombre. Revisa el texto antes de mandarlo.</label>
      <div class="send-row">
        <select v-model="to" class="input input-sm" aria-label="A quién">
          <option v-for="p in people" :key="p.email" :value="p.email">{{ p.name || p.email }}</option>
        </select>
        <button type="submit" class="btn btn-sm">Mandar</button>
        <button type="button" class="btn btn-ghost btn-sm" @click="draft = ''">Cancelar</button>
      </div>
      <textarea v-model="draft" class="input" rows="4" aria-label="Mensaje"></textarea>
    </form>

    <div v-if="server.log.length" class="log" aria-label="Lo que hizo">
      <div v-for="(l, i) in server.log" :key="i" class="log-line">{{ l }}</div>
    </div>
  </div>
</template>

<style scoped>
.head-who { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0 }
.server { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4) var(--gutter); overflow: auto }
.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2) }
.checks li { display: grid; grid-template-columns: 10px 160px 1fr; gap: var(--space-3); align-items: baseline }
.check-name { font-weight: 500 }
.check-detail { color: var(--fg-2); font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3); align-self: center }
.dot[data-state="ok"] { background: var(--presence-on) }
.actions, .send-row { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center }
.note { margin: 0; color: var(--fg-2); font-size: var(--text-sm) }
.note code { font-family: var(--font-mono); user-select: all }
.bad { color: var(--send-fail) }
.send { display: flex; flex-direction: column; gap: var(--space-2) }
.send textarea { width: 100%; font: inherit; resize: vertical }
.log { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--fg-2); border-top: 1px solid var(--border); padding-top: var(--space-3); display: flex; flex-direction: column; gap: 2px }
.log-line { white-space: pre-wrap; word-break: break-word }
</style>
