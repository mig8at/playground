<script setup>
/* LA CONFIGURACIÓN DE AVISOS (notifyStore.js → server/notify.go), como sección del perfil (Mi chat): qué avisa cada
   tipo de conversación, las excepciones por conversación, el horario de no molestar y por dónde sale el aviso ahora.
   Todo se guarda en el servidor al tocarlo, y vale aunque la pestaña esté cerrada. */
import { computed, ref } from 'vue'
import { notify, saveNotify, setConversationMode, testNotify } from './notifyStore.js'

const props = defineProps({
  nameOf: { type: Function, default: (k) => k },    // el nombre de una conversación por su clave
})

const s = computed(() => notify.settings)
const MODES = { all: 'Todos', mentions: 'Sólo menciones', off: 'Ninguno' }
const overrides = computed(() => Object.entries(s.value?.conversations || {})
  .map(([key, mode]) => ({ key, mode, name: props.nameOf(key) }))
  .sort((a, b) => a.name.localeCompare(b.name)))
const LEVELS = { all: 'todos', important: 'sólo importantes', none: 'ninguno' }
// Cockpit maneja la salida de todos los avisos (lib/notice): su permiso, el no molestar y el nivel del chat.
const viaText = computed(() => {
  const st = notify.status || {}
  const via = st.notifier === 'authorized' ? 'Salen por Cockpit.'
    : st.notifier === 'denied' ? 'Cockpit no tiene permiso de avisos: Ajustes del Sistema → Notificaciones → «Cockpit».'
    : st.notifier === 'notDetermined' ? 'Cockpit todavía no tiene permiso de avisos: su engranaje → Avisos → «Probar» lo pide.'
    : 'Falta el avisador de Cockpit: make cockpit lo compila.'
  const lvl = st.level && st.level !== 'all' ? ` El chat está en «${LEVELS[st.level] || st.level}» en Cockpit.` : ''
  return via + lvl
})
const quietText = computed(() => {
  const q = notify.status?.quiet
  return q?.on ? `No molestar de ${q.from} a ${q.to} (una mención avisa igual si así está puesto).` : 'Sin horario de no molestar.'
})
const testing = ref(false)
async function test() { testing.value = true; await testNotify(); testing.value = false }
</script>

<template>
  <div class="notify-panel">
    <div v-if="s" class="notify-body">
      <header class="notify-head">
        <span class="label">Avisos, también con el chat cerrado</span>
        <button type="button" class="switch" role="switch" :aria-checked="s.enabled" aria-label="Avisos prendidos"
                :title="s.enabled ? 'Apagar todos los avisos' : 'Prender los avisos'" @click="saveNotify({ enabled: !s.enabled })"></button>
      </header>

      <fieldset class="notify-group" :disabled="!s.enabled">
        <div class="notify-row">
          <span class="label">Mensajes directos</span>
          <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Mensajes directos">
            <button v-for="m in ['all', 'off']" :key="m" type="button" class="toggle" role="radio" :aria-checked="s.direct === m"
                    :aria-pressed="s.direct === m" @click="saveNotify({ direct: m })">{{ MODES[m] }}</button>
          </div>
        </div>
        <div class="notify-row">
          <span class="label">Grupos</span>
          <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Grupos">
            <button v-for="m in ['all', 'mentions', 'off']" :key="m" type="button" class="toggle" role="radio" :aria-checked="s.groups === m"
                    :aria-pressed="s.groups === m" @click="saveNotify({ groups: m })">{{ MODES[m] }}</button>
          </div>
        </div>
        <div class="notify-row">
          <span class="label">Agentes</span>
          <div class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Agentes">
            <button v-for="m in ['all', 'off']" :key="m" type="button" class="toggle" role="radio" :aria-checked="s.agents === m"
                    :aria-pressed="s.agents === m" @click="saveNotify({ agents: m })">{{ MODES[m] }}</button>
          </div>
        </div>
        <label class="notify-check"><input type="checkbox" :checked="s.sound" @change="saveNotify({ sound: $event.target.checked })"> Con sonido</label>
        <label class="notify-check"><input type="checkbox" :checked="s.preview" @change="saveNotify({ preview: $event.target.checked })"> Mostrar el texto del mensaje</label>
      </fieldset>

      <!-- El no molestar es de TODOS los avisos de my-tools desde el 2026-11-21: vive en Cockpit (engranaje → Avisos). -->
      <div class="notify-group">
        <span class="label">No molestar</span>
        <p class="field-hint">{{ quietText }} Se cambia en Cockpit, engranaje → Avisos: vale para todas las herramientas.</p>
      </div>

      <fieldset class="notify-group" :disabled="!s.enabled">
        <span class="label">Por conversación</span>
        <p v-if="!overrides.length" class="field-hint">Ninguna: la 🔔 de cada conversación las agrega.</p>
        <ul v-else class="notify-overrides">
          <li v-for="o in overrides" :key="o.key">
            <span class="override-name">{{ o.name }}</span>
            <span class="override-mode">{{ MODES[o.mode] }}</span>
            <button type="button" class="region-action" :title="`Quitar la excepción de ${o.name}`" :aria-label="`Quitar la excepción de ${o.name}`"
                    @click="setConversationMode(o.key, '')"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
          </li>
        </ul>
      </fieldset>

      <footer class="notify-foot">
        <p class="field-hint">{{ viaText }}</p>
        <div class="notify-actions">
          <button type="button" class="btn btn-outline btn-sm" :disabled="testing" @click="test">Probar un aviso</button>
        </div>
        <p v-if="notify.error" class="field-error">{{ notify.error }}</p>
      </footer>
    </div>
    <p v-else class="notify-body field-hint">{{ notify.error || 'Cargando…' }}</p>
  </div>
</template>

<style scoped>
.notify-panel { min-width: 0 }
.notify-body { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) var(--gutter, var(--space-4)) }
.notify-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3) }
.notify-group { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: var(--space-3) 0 0; border: 0; border-top: 1px solid var(--border); min-width: 0 }
.notify-group:disabled { opacity: .5 }
.notify-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap }
.notify-check { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm) }
.notify-overrides { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.notify-overrides li { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }
.override-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.override-mode { flex: none; color: var(--fg-2); font-size: var(--text-sm) }
.notify-foot { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border) }
.notify-foot p { margin: 0 }
.notify-actions { display: flex; gap: var(--space-2); flex-wrap: wrap }
</style>
