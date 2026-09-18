<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { readPreference, savePreference, panelWidth } from './ui-state.js';

const props = defineProps({ title: String, taskKey: String, tab: String, tabs: Array });
const emit = defineEmits(['close', 'update:tab']);
const panel = ref(null);
const content = ref(null);
const viewport = ref(window.innerWidth);
const width = ref(panelWidth(readPreference('panel-width', 820), viewport.value));
const resizing = ref(false);
let stopResize = null;
let returnFocus = null;
let previousOverflow = '';

function setWidth(value) { width.value = panelWidth(value, viewport.value); }
function resetWidth() { setWidth(820); savePreference('panel-width', width.value); }
function resize(event) {
  if (event.button !== 0) return;
  stopResize?.();
  const initialWidth = width.value, initialX = event.clientX;
  const move = e => setWidth(initialWidth + initialX - e.clientX);
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    window.removeEventListener('blur', stop);
    resizing.value = false;
    savePreference('panel-width', width.value);
    stopResize = null;
  };
  stopResize = stop;
  resizing.value = true;
  event.currentTarget.focus();
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
}
function resizeKey(event) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Home' || event.key === 'Enter') resetWidth();
  else {
    setWidth(width.value + (event.key === 'ArrowLeft' ? 1 : -1) * (event.shiftKey ? 80 : 24));
    savePreference('panel-width', width.value);
  }
}
async function tabKey(event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const count = props.tabs.length;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
  emit('update:tab', props.tabs[next].id);
  await nextTick();
  panel.value?.querySelectorAll('[role=tab]')[next]?.focus();
}
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return; }
  if (event.key !== 'Tab') return;
  const focusable = [...panel.value.querySelectorAll('button, a[href], input, select, textarea, summary, iframe, [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
const fitViewport = () => { viewport.value = window.innerWidth; setWidth(width.value); };
watch(() => props.tab, () => { if (content.value) content.value.scrollTop = 0; });
onMounted(() => {
  returnFocus = document.activeElement;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  panel.value.focus();
  window.addEventListener('resize', fitViewport);
});
onUnmounted(() => {
  stopResize?.();
  window.removeEventListener('resize', fitViewport);
  document.body.style.overflow = previousOverflow;
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <div class="panel-overlay" :class="{ resizing }">
    <div class="panel-backdrop" @click="emit('close')"></div>
    <aside ref="panel" class="task-panel" :style="{ width: width + 'px' }" role="dialog"
      aria-modal="true" aria-labelledby="task-panel-title" tabindex="-1" @keydown="keydown">
      <div class="resize-handle" role="separator" tabindex="0" aria-orientation="vertical"
        aria-label="Ancho del panel" :aria-valuenow="Math.round(width)" :aria-valuemin="Math.min(340, width)"
        :aria-valuemax="Math.floor(viewport * .96)"
        title="Arrastra para ajustar · doble clic para restablecer · flechas para ajustar con teclado"
        @pointerdown.prevent="resize" @dblclick="resetWidth" @keydown="resizeKey"></div>
      <header class="panel-header">
        <div class="panel-heading"><span>{{ taskKey }}</span><h2 id="task-panel-title">{{ title }}</h2></div>
        <button class="panel-close" aria-label="Cerrar panel" title="Cerrar (Esc)" @click="emit('close')">×</button>
      </header>
      <nav class="panel-tabs" role="tablist" aria-label="Secciones de la tarea">
        <button v-for="(item, index) in tabs" :key="item.id" :id="'task-tab-' + item.id" role="tab"
          :aria-selected="tab === item.id" :tabindex="tab === item.id ? 0 : -1"
          aria-controls="task-panel-content" @click="emit('update:tab', item.id)" @keydown="tabKey($event, index)">
          {{ item.label }}<span v-if="item.count !== undefined">{{ item.count }}</span>
          <i v-if="item.alert" aria-label="Requiere revisión">●</i>
        </button>
      </nav>
      <div ref="content" id="task-panel-content" class="panel-content" role="tabpanel"
        :aria-labelledby="'task-tab-' + tab" tabindex="0"><slot /></div>
    </aside>
  </div>
</template>

<style scoped>
.panel-overlay { position: fixed; inset: 0; z-index: 60 }
.panel-backdrop { position: absolute; inset: 0; background: #0009 }
.task-panel { position: absolute; inset: 0 0 0 auto; display: flex; flex-direction: column;
  max-width: 96vw; background: var(--panel); border-left: 1px solid var(--line2); box-shadow: -12px 0 32px #0008; outline: none }
.resize-handle { position: absolute; z-index: 2; inset: 0 auto 0 -6px; width: 12px; cursor: col-resize; touch-action: none }
.resize-handle::after { content: ''; position: absolute; left: 5px; top: calc(50% - 20px); height: 40px;
  width: 2px; border-radius: 2px; background: var(--line2) }
.resize-handle:hover::after, .resize-handle:focus-visible::after, .resizing .resize-handle::after { background: var(--txt) }
.resizing { cursor: col-resize; user-select: none }
.panel-header { display: flex; align-items: flex-start; gap: 20px; padding: 22px 24px 18px }
.panel-heading { flex: 1; min-width: 0 }
.panel-heading > span { font: 11px ui-monospace, monospace; color: var(--mut) }
h2 { margin: 6px 0 0; font-size: 17px; line-height: 1.4; font-weight: 600; overflow-wrap: anywhere }
.panel-close { background: none; border: 1px solid var(--line); color: var(--mut); border-radius: 6px;
  width: 30px; height: 30px; flex: none; cursor: pointer; font-size: 22px }
.panel-close:hover { color: var(--txt); background: var(--panel2) }
.panel-tabs { display: flex; gap: 18px; padding: 0 24px; overflow-x: auto; flex-shrink: 0; border-bottom: 1px solid var(--line) }
.panel-tabs button { display: flex; align-items: center; gap: 6px; white-space: nowrap; border: 0;
  border-bottom: 2px solid transparent; background: none; color: var(--mut); padding: 12px 0; font: inherit; font-size: 12px; cursor: pointer }
.panel-tabs button[aria-selected=true] { color: var(--txt); border-bottom-color: var(--txt) }
.panel-tabs span { font-size: 10px; background: var(--panel2); padding: 0 5px; border-radius: 4px }
.panel-tabs i { color: var(--warn); font-style: normal; font-size: 8px }
.panel-content { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px 32px; overflow-wrap: anywhere }
:focus-visible { outline: 2px solid var(--mut); outline-offset: 3px }
@media (max-width: 600px) { .panel-header, .panel-content { padding: 16px } .panel-tabs { padding: 0 16px; gap: 14px } }
</style>
