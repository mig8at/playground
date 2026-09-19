<script setup>
/* LA TAREA, EN EL EDITOR.
 *
 * Era un CAJÓN (`TaskPanel.vue`): overlay, backdrop, `role=dialog`, trampa de foco, manija de ancho y
 * `body.overflow = hidden` mientras estaba abierto. Todo eso existía porque flotaba ENCIMA de la
 * página; acá vive en el `editor` del workbench, así que se va entero:
 *
 *   - sin overlay ni backdrop: no tapa nada, ES la vista;
 *   - sin trampa de foco ni `aria-modal`: no es un modal, y encerrar el tabulador en algo que no lo es
 *     rompe el recorrido con teclado de toda la app;
 *   - sin manija de ancho: el ancho lo decide el grid del taller, no el componente;
 *   - sin tocar `body.overflow`: el contrato de scroll ya lo sostiene el workbench.
 *
 * Lo que SÍ se queda es lo que hacía falta por la tarea y no por el cajón: las pestañas con su
 * navegación por teclado (←/→/Home/End, `roving tabindex`) y el scroll al tope al cambiar de pestaña
 * —si no, entrás a «ramas» a mitad de la tabla porque venías de «hallazgos», que es desorientador.
 */
import { ref, nextTick, watch } from 'vue';

const props = defineProps({ title: String, taskKey: String, tab: String, tabs: Array });
const emit = defineEmits(['close', 'update:tab']);
const raiz = ref(null);
const content = ref(null);

async function tabKey(event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const count = props.tabs.length;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
  emit('update:tab', props.tabs[next].id);
  await nextTick();
  raiz.value?.querySelectorAll('[role=tab]')[next]?.focus();
}
// Escape CIERRA la pestaña enfocada — lo mismo que su ×. Antes sólo soltaba la tarea, y con pestañas
// eso dejaba un estado raro: la barra mostrando pestañas y el editor mostrando el sprint.
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
}
watch(() => props.tab, () => { if (content.value) content.value.scrollTop = 0; });
watch(() => props.taskKey, () => { if (content.value) content.value.scrollTop = 0; });
</script>

<template>
  <section ref="raiz" class="task-editor" :aria-label="`Tarea ${taskKey}`" tabindex="-1" @keydown="keydown">
    <!-- LA CABECERA, en dos renglones y siempre los mismos: arriba QUÉ ES (clave + estado) y QUÉ SE
         PUEDE HACER, alineado al borde; abajo DE QUÉ SE TRATA. Antes eran tres renglones apilados a la
         izquierda —clave, título, acciones— que dejaban media pantalla de ancho sin usar.

         ⚠ Y NO hay botón de cerrar. Lo tiene la pestaña de arriba, que es donde uno ya lo busca porque
         es donde está en cualquier editor; dos botones para lo mismo, uno al lado del otro, sólo
         obligan a decidir cuál. `Esc` sigue cerrando la pestaña enfocada. -->
    <header class="te-head">
      <div class="te-linea">
        <span class="te-k">{{ taskKey }}</span>
        <slot name="meta" />
        <div class="te-acts"><slot name="acciones" /></div>
      </div>
      <h2>{{ title }}</h2>
      <slot name="paneles" />
    </header>
    <nav class="te-tabs" role="tablist" aria-label="Secciones de la tarea">
      <button v-for="(item, index) in tabs" :key="item.id" :id="'task-tab-' + item.id" role="tab"
        :aria-selected="tab === item.id" :tabindex="tab === item.id ? 0 : -1"
        aria-controls="task-editor-content" @click="emit('update:tab', item.id)" @keydown="tabKey($event, index)">
        {{ item.label }}<span v-if="item.count !== undefined">{{ item.count }}</span>
        <i v-if="item.alert" aria-label="Requiere revisión">●</i>
      </button>
    </nav>
    <div ref="content" id="task-editor-content" class="te-body region-body" role="tabpanel"
         :aria-labelledby="'task-tab-' + tab" tabindex="0"><slot /></div>
  </section>
</template>

<style scoped>
.task-editor { display: flex; flex-direction: column; min-height: 0; height: 100%; outline: none }
.te-head { display: flex; flex-direction: column; gap: 8px; padding: 16px 24px 12px; flex: none }
.te-linea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0 }
.te-k { font: 11px var(--font-mono); color: var(--mut); flex: none }
/* Las acciones al BORDE derecho: es el único sitio donde el ojo las busca sin leer, y deja el
   renglón de la izquierda para lo que identifica la tarea. */
.te-acts { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.te-acts:empty { display: none }
h2 { margin: 0; font-size: 17px; line-height: 1.35; font-weight: 600; overflow-wrap: anywhere }
.te-tabs { display: flex; gap: 18px; padding: 0 24px; overflow-x: auto; flex: none;
  border-bottom: 1px solid var(--line) }
.te-tabs button { display: flex; align-items: center; gap: 6px; white-space: nowrap; border: 0;
  border-bottom: 2px solid transparent; background: none; color: var(--mut); padding: 12px 0;
  font: inherit; font-size: 12px; cursor: pointer }
.te-tabs button[aria-selected=true] { color: var(--txt); border-bottom-color: var(--txt) }
.te-tabs span { font-size: 10px; background: var(--panel2); padding: 0 5px; border-radius: var(--r-sm, 4px) }
.te-tabs i { color: var(--warn); font-style: normal; font-size: 8px }
.te-body { padding: 20px 24px 32px; overflow-wrap: anywhere }
:focus-visible { outline: 2px solid var(--mut); outline-offset: 3px }
@media (max-width: 600px) { .te-head, .te-body { padding: 16px } .te-tabs { padding: 0 16px; gap: 14px } }
</style>
