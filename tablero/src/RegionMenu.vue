<script setup>
/* EL MENÚ … DE UNA REGIÓN — el patrón del Explorer de VS Code.
 *
 * Lo que se ALTERNA y se toca poco vive acá; lo que se HACE y es frecuente vive como icono en la
 * barra, al lado. El CSS lo pone `taller.css` (`.region-menu`, `.region-menu-item`); esto es el
 * comportamiento, que ninguna hoja puede dar.
 *
 * ⚠ Se teleporta al `body`. `region-body` tiene `overflow: auto`, y un hijo posicionado adentro se
 * recorta contra el borde de la región: el menú se cortaría contra el canto del sidebar.
 *
 * ⚠ Y un clic en un ítem NO lo cierra, al revés que en VS Code. Acá los ítems son FILTROS y casi
 * nunca se toca uno solo —se apagan «terminada» y «locales» de una sentada—; cerrar en cada clic
 * obliga a reabrir el menú por cada casilla. Se cierra con Escape, con un clic afuera o con el mismo
 * botón.
 */
import { ref, nextTick, onUnmounted } from 'vue';

defineProps({ items: { type: Array, required: true }, title: { type: String, default: 'Más opciones' } });
const emit = defineEmits(['toggle']);
const abierto = ref(false);
const boton = ref(null);
const menu = ref(null);
const pos = ref({});

function ubicar() {
  const r = boton.value.getBoundingClientRect();
  // alineado al borde DERECHO del botón: el menú crece hacia adentro de la región, no hacia afuera
  // de la ventana. `max()` lo impide salirse por la izquierda en una región angosta.
  pos.value = { top: `${Math.round(r.bottom + 4)}px`, right: `${Math.round(innerWidth - r.right)}px`,
                maxHeight: `${Math.round(innerHeight - r.bottom - 16)}px`, overflowY: 'auto' };
}
function afuera(e) { if (!menu.value?.contains(e.target) && !boton.value?.contains(e.target)) cerrar(); }
function escape(e) { if (e.key === 'Escape') { e.preventDefault(); cerrar(); boton.value?.focus(); } }
function cerrar() {
  abierto.value = false;
  document.removeEventListener('pointerdown', afuera, true);
  document.removeEventListener('keydown', escape, true);
}
async function alternar() {
  if (abierto.value) return cerrar();
  ubicar();
  abierto.value = true;
  document.addEventListener('pointerdown', afuera, true);
  document.addEventListener('keydown', escape, true);
  await nextTick();
  menu.value?.querySelector('.region-menu-item:not(:disabled)')?.focus();
}
// ↑/↓ recorren; el foco no se sale del menú mientras está abierto
function flechas(e) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const its = [...menu.value.querySelectorAll('.region-menu-item:not(:disabled)')];
  const i = its.indexOf(document.activeElement);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? its.length - 1
    : (i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length;
  its[n]?.focus();
}
onUnmounted(cerrar);
</script>

<template>
  <button ref="boton" type="button" class="region-action" :title="title"
          aria-haspopup="menu" :aria-expanded="abierto" @click="alternar">⋯</button>
  <Teleport to="body">
    <div v-if="abierto" ref="menu" class="region-menu" :style="pos" role="menu" @keydown="flechas">
      <template v-for="(it, n) in items" :key="it.id || 'sep' + n">
        <hr v-if="it.separador" />
        <button v-else type="button" class="region-menu-item" role="menuitemcheckbox"
                :aria-checked="!!it.checked" :disabled="it.disabled" :title="it.title"
                @click="emit('toggle', it.id)">
          <span class="tick" aria-hidden="true">{{ it.checked ? '✓' : '' }}</span>
          <span class="label">{{ it.label }}</span>
          <span v-if="it.count !== undefined" class="n">{{ it.count }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
