<script setup>
/* LA TAREA EN EL EDITOR — sólo su DOCUMENTO.
 *
 * Tuvo dos formas antes de esta. Primero fue un CAJÓN flotando sobre la página (`TaskPanel`), con
 * overlay, trampa de foco y manija de ancho; después un editor con OCHO pestañas adentro. Hoy el
 * editor muestra una sola cosa —el documento de la tarea—; las vistas de consulta (Jira, Pendientes,
 * Hallazgos, Registro, Bitácora y Prototipos) viven en pestañas del sidebar derecho, y las
 * ramas viven en la consola inferior.
 *
 * ⚠ Eso vale la pena entenderlo antes de «devolver» las pestañas: con pestañas, mirar una rama
 * MIENTRAS leés el documento era imposible — eran excluyentes. Al costado se ven a la vez, que es lo
 * que uno hace de verdad al retomar una tarea.
 *
 * El encabezado reúne identidad, estado, datos de Jira y contexto local; el cuerpo scrollea solo.
 * `Esc` cierra la pestaña de la tarea, lo mismo que su ×.
 */
import { ref, watch } from 'vue';

const props = defineProps({ title: String, taskKey: String });
const emit = defineEmits(['close']);
const raiz = ref(null);
const content = ref(null);
// Escape CIERRA la pestaña enfocada — lo mismo que su ×. Antes sólo soltaba la tarea, y con pestañas
// eso dejaba un estado raro: la barra mostrando pestañas y el editor mostrando el sprint.
function keydown(event) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); }
}
// Cambiar de tarea vuelve al tope: si no, entrás a una tarea nueva a mitad del documento porque
// venías scrolleado en la anterior.
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
    <div ref="content" class="te-body region-body" tabindex="0"><slot /></div>
  </section>
</template>

<style scoped>
.task-editor { display: flex; flex-direction: column; min-height: 0; height: 100%; outline: none }
.te-head { display: flex; flex-direction: column; gap: 7px; padding: 14px 20px 11px; flex: none;
  border-bottom: 1px solid var(--line) }
.te-linea { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0 }
.te-k { font: 11px var(--font-mono); color: var(--mut); flex: none }
/* Las acciones al BORDE derecho: es el único sitio donde el ojo las busca sin leer, y deja el
   renglón de la izquierda para lo que identifica la tarea. */
.te-acts { margin-left: auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap }
.te-acts:empty { display: none }
h2 { margin: 0; font-size: 17px; line-height: 1.35; font-weight: 600; overflow-wrap: anywhere }
.te-body { padding: 20px 20px 32px; overflow-wrap: anywhere }
:focus-visible { outline: 2px solid var(--mut); outline-offset: 3px }
@media (max-width: 600px) { .te-head, .te-body { padding: 16px } }
</style>
