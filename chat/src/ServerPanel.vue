<script setup>
/* UN SERVER EN EL EDITOR: lo que hay que tener prendido en esta máquina para que otra persona pruebe contra ella
   (server/servers.go). Cada pieza con su punto, y los botones. Lo que se le pasa a quien prueba va a la derecha
   (ServerShare.vue) y la salida de cada comando, abajo, en la consola. */
import { ref } from 'vue'

const props = defineProps({ server: { type: Object, required: true } })
const emit = defineEmits(['changed', 'close'])

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
        <i class="dot" :data-state="c.ok ? 'ok' : server.busy ? 'busy' : 'off'" aria-hidden="true"></i>
        <span class="check-name">{{ c.name }}</span>
        <span class="check-detail" :title="c.detail">{{ c.detail }}</span>
        <span class="check-how">{{ c.how }}</span>
      </li>
    </ul>

    <div class="actions">
      <button type="button" class="btn btn-sm" :disabled="server.busy || !!acting" @click="act('up')">
        {{ server.busy ? 'Levantando…' : server.ready ? 'Levantar lo que falte' : 'Levantar todo' }}
      </button>
      <button v-if="server.downLabel" type="button" class="btn btn-outline btn-sm" :disabled="server.busy || !!acting || !server.canDown" @click="act('down')">{{ server.downLabel }}</button>
    </div>
    <p v-if="actionError || server.error" class="note bad">{{ actionError || server.error }}</p>
    <p v-else class="note">«Levantar» hace sólo lo que falta, en este orden. Lo que va corriendo se ve abajo, en la consola.</p>
  </div>
</template>

<style scoped>
.head-who { display: flex; align-items: baseline; gap: var(--space-2); min-width: 0 }
.server { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-4) var(--gutter); overflow: auto }
.checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3) }
.checks li { display: grid; grid-template-columns: 10px 160px 1fr; column-gap: var(--space-3); row-gap: 2px; align-items: baseline }
.check-name { font-weight: 500 }
.check-detail { color: var(--fg-2); font-family: var(--font-mono); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.check-how { grid-column: 3; color: var(--fg-3); font-size: var(--text-xs) }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-3); align-self: center }
.dot[data-state="ok"] { background: var(--presence-on) }
.dot[data-state="busy"] { background: var(--fg-2) }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center }
.note { margin: 0; color: var(--fg-2); font-size: var(--text-sm) }
.bad { color: var(--send-fail) }
</style>
