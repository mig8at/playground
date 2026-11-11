<script setup>
/* EL SELECTOR DE EMOJIS de la barra de escribir: un botón 😊 que abre, encima, `emoji-picker-element` (buscador en
 * español, categorías, los más usados y tono de piel). Al elegir uno avisa (`pick`) y se cierra: el chat lo mete donde
 * está el cursor y le devuelve el foco a la caja de texto.
 *
 * Los datos van SERVIDOS POR EL CHAT (`emoji-picker-element-data`, CLDR en español), no por la CDN que la biblioteca
 * usa por defecto: así anda dentro de Cockpit sin red y no depende de un servicio de afuera. La biblioteca y sus datos
 * se cargan la primera vez que se abre, no al arrancar el chat. Toma los colores del tema de la base. */
import { ref, onBeforeUnmount, nextTick } from 'vue'
import dataSource from 'emoji-picker-element-data/es/cldr/data.json?url'

const emit = defineEmits(['pick'])
const open = ref(false)
const root = ref(null)
const host = ref(null)
let picker = null

const isDark = () => document.documentElement.classList.contains('dark')
function paintTheme() {
  picker?.classList.toggle('dark', isDark())
  picker?.classList.toggle('light', !isDark())
}

async function mount() {
  if (!picker) {
    const [{ Picker }, { default: spanishStrings }] = await Promise.all([import('emoji-picker-element'), import('emoji-picker-element/i18n/es.js')])
    picker = new Picker({ locale: 'es', dataSource, i18n: spanishStrings })
    picker.addEventListener('emoji-click', (e) => {
      emit('pick', e.detail.unicode)
      close()
    })
    addEventListener('ui-theme', paintTheme)
  }
  paintTheme()
  host.value?.append(picker)
}

async function toggle() {
  if (open.value) return close()
  open.value = true
  await nextTick()
  await mount()
  // El buscador, para escribir de una («fuego», «risa»).
  requestAnimationFrame(() => picker?.shadowRoot?.querySelector('input')?.focus())
  document.addEventListener('mousedown', outside, true)
  document.addEventListener('keydown', escape, true)
}
function close() {
  open.value = false
  document.removeEventListener('mousedown', outside, true)
  document.removeEventListener('keydown', escape, true)
}
function outside(e) { if (!root.value?.contains(e.target)) close() }
function escape(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); emit('pick', '') } }

onBeforeUnmount(() => { close(); removeEventListener('ui-theme', paintTheme) })
</script>

<template>
  <div ref="root" class="emoji-button">
    <button type="button" class="btn btn-outline composer-attach" :aria-expanded="open" aria-haspopup="dialog"
            title="Emojis" aria-label="Elegir un emoji" @click="toggle">
      <span class="ui-icon" data-icon="emoji" aria-hidden="true"></span>
    </button>
    <div v-show="open" ref="host" class="emoji-pop" role="dialog" aria-label="Emojis"></div>
  </div>
</template>

<style scoped>
.emoji-button { position: relative; flex: none }
.emoji-pop { position: absolute; bottom: calc(100% + 8px); left: 0; z-index: 30; border-radius: var(--radius-control);
  border: 1px solid var(--border); overflow: hidden; box-shadow: var(--shadow-popover, none) }
/* Los colores de la base dentro del selector (sus variables atraviesan el shadow DOM). */
.emoji-pop :deep(emoji-picker) {
  --background: var(--popover);
  --border-color: var(--border);
  --input-border-color: var(--border);
  --input-font-color: var(--foreground);
  --input-placeholder-color: var(--fg-3);
  --button-hover-background: var(--hover);
  --button-active-background: var(--hover);
  --category-font-color: var(--fg-2);
  --indicator-color: var(--primary);
  --outline-color: var(--ring);
  --num-columns: 9;
  --emoji-size: 1.35rem;
  height: 360px;
}
</style>
