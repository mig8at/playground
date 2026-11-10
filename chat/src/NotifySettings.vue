<script setup>
/* LA CONFIGURACIÓN DE AVISOS (notifyStore.js → server/notify.go), como sección del perfil (Mi chat): qué avisa cada
   tipo de conversación, las excepciones por conversación, el horario de no molestar y por dónde sale el aviso ahora.
   Todo se guarda en el servidor al tocarlo, y vale aunque la pestaña esté cerrada. */
import { computed, ref } from 'vue'
import { notify, saveNotify, setConversationMode, testNotify } from './notifyStore.js'

const props = defineProps({
  permission: { type: String, default: 'default' }, // el permiso de avisos del navegador
  nameOf: { type: Function, default: (k) => k },    // el nombre de una conversación por su clave
})
const emit = defineEmits(['ask-permission'])

const s = computed(() => notify.settings)
const MODES = { all: 'Todos', mentions: 'Sólo menciones', off: 'Ninguno' }
const overrides = computed(() => Object.entries(s.value?.conversations || {})
  .map(([key, mode]) => ({ key, mode, name: props.nameOf(key) }))
  .sort((a, b) => a.name.localeCompare(b.name)))
const viaText = computed(() => {
  const st = notify.status
  if (st.via === 'tab') return 'Salen por esta pestaña.'
  if (st.macTool === 'chat-notifier') return 'Salen por «Chat del playground».'
  if (st.macTool === 'terminal-notifier') return 'Salen por terminal-notifier.'
  return 'Salen por osascript y pueden no verse: make chat-service A=refresh compila el avisador.'
})
const testing = ref(false)
async function test(via) { testing.value = true; await testNotify(via); testing.value = false }
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

      <fieldset class="notify-group" :disabled="!s.enabled">
        <label class="notify-check"><input type="checkbox" :checked="s.quiet.on" @change="saveNotify({ quiet: { ...s.quiet, on: $event.target.checked } })"> No molestar</label>
        <div class="notify-row quiet-hours" :class="{ off: !s.quiet.on }">
          <span class="label">de</span>
          <input class="input" type="time" :value="s.quiet.from" :disabled="!s.quiet.on" aria-label="No molestar desde"
                 @change="saveNotify({ quiet: { ...s.quiet, from: $event.target.value } })">
          <span class="label">a</span>
          <input class="input" type="time" :value="s.quiet.to" :disabled="!s.quiet.on" aria-label="No molestar hasta"
                 @change="saveNotify({ quiet: { ...s.quiet, to: $event.target.value } })">
        </div>
        <label class="notify-check"><input type="checkbox" :checked="s.mentionsBreakQuiet" :disabled="!s.quiet.on"
               @change="saveNotify({ mentionsBreakQuiet: $event.target.checked })"> Si me mencionan, avisar igual</label>
      </fieldset>

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
        <p v-if="permission === 'default'" class="field-hint">
          <button type="button" class="btn-link" @click="emit('ask-permission')">Que avise esta pestaña</button>
        </p>
        <div class="notify-actions">
          <button type="button" class="btn btn-outline btn-sm" :disabled="testing" @click="test('')">Probar un aviso</button>
          <button v-if="notify.status.via === 'tab'" type="button" class="btn btn-outline btn-sm" :disabled="testing" @click="test('mac')">Probar con la pestaña cerrada</button>
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
.quiet-hours { justify-content: flex-start }
.quiet-hours .input { width: auto }
.quiet-hours.off { opacity: .6 }
.notify-check { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm) }
.notify-overrides { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px }
.notify-overrides li { display: flex; align-items: center; gap: var(--space-2); min-width: 0 }
.override-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.override-mode { flex: none; color: var(--fg-2); font-size: var(--text-sm) }
.notify-foot { display: flex; flex-direction: column; gap: var(--space-2); padding-top: var(--space-3); border-top: 1px solid var(--border) }
.notify-foot p { margin: 0 }
.notify-actions { display: flex; gap: var(--space-2); flex-wrap: wrap }
</style>
