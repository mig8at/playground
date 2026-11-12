<script setup>
/* LA VIDEOLLAMADA de una conversación: los que están en ella (personas y sus agentes) como personajes en papel
   cortado. Por ahora es sólo visual: todos escuchan, con su parpadeo y su balanceo; todavía no reaccionan a lo que se
   escribe en el chat. Los personajes salen de ./characters (un JSON por personaje).

   EL ACOMODO, COMO EN UNA VIDEOLLAMADA: cada recuadro guarda su proporción (4:3) y la grilla prueba todas las
   columnas posibles y se queda con la que deja los recuadros más grandes en el espacio que hay. Así, en una ventana
   ancha van en una fila, en una alta se apilan, y siempre quedan centrados, sin estirarse ni cortarse. La última fila,
   si está incompleta, también se centra. */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({ cast: { type: Array, required: true } })
const ASPECT = 4 / 3, GAP = 10, PAD = 12
const box = ref(null)
const size = ref({ w: 0, h: 0 })
let observer = null
// se mide el tamaño real del contenedor (con su relleno) cada vez que cambia, también cuando pasa de oculto a visible
// (en pantalla angosta la conversación arranca escondida y mide 0)
const measure = () => { const el = box.value; if (el) size.value = { w: el.clientWidth, h: el.clientHeight } }
onMounted(() => {
  observer = new ResizeObserver(measure)
  observer.observe(box.value)
  requestAnimationFrame(measure)
})
onBeforeUnmount(() => observer?.disconnect())

// la mejor grilla: para cada número de columnas, el ancho de recuadro que entra en ancho y en alto; gana el más grande
const layout = computed(() => {
  const n = props.cast.length, W = size.value.w - PAD * 2, H = size.value.h - PAD * 2
  if (!n || W <= 0 || H <= 0) return { cols: 1, w: 0 }
  let best = { cols: 1, w: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const w = Math.min((W - GAP * (cols - 1)) / cols, ((H - GAP * (rows - 1)) / rows) * ASPECT)
    if (w > best.w) best = { cols, w: Math.floor(w) }
  }
  return best
})
// en recuadros chicos la placa se achica, para no tapar la cara
const compact = computed(() => layout.value.w < 220)
const label = (c) => (c.agent ? `agente de ${c.ownerName || c.owner.split('.')[0]}` : '')
</script>

<template>
  <div ref="box" class="region-body call" aria-label="Videollamada">
    <div class="call-grid" :class="{ compact }" :style="{ '--tile': `${layout.w}px`, '--cols': layout.cols }">
      <figure v-for="c in cast" :key="c.handle || `${c.owner}/${c.agent}`" class="call-tile">
        <office-personaje :config="JSON.stringify({ name: c.name, owner: c.agent ? c.owner : '', ...c.character })" gesto="escucha" />
        <figcaption class="call-name">
          <b>{{ c.name }}</b>
          <span v-if="label(c)">{{ label(c) }}</span>
        </figcaption>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.call { position: relative; overflow: hidden; background: #0b0c0e; display: grid; place-items: center; padding: 12px; }
/* filas centradas (también la última, si está incompleta): flex con ancho justo para las columnas elegidas */
.call-grid { display: flex; flex-wrap: wrap; justify-content: center; align-content: center; gap: 10px;
  width: calc(var(--cols) * var(--tile) + (var(--cols) - 1) * 10px); max-width: 100%; }
.call-tile { position: relative; margin: 0; width: var(--tile); aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .35); }
.call-tile office-personaje { display: block; width: 100%; height: 100%; border-radius: 14px; }
.call-name { position: absolute; left: 8px; bottom: 8px; max-width: calc(100% - 16px); display: flex; gap: 6px; align-items: baseline;
  padding: 3px 9px; border-radius: 8px; background: #f1e4c7; color: #13323a; font-size: 12px; box-shadow: 0 2px 0 #d9c9a6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-name b { font-weight: 800; }
.call-name span { color: #2b6670; font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.compact .call-name { left: 5px; bottom: 5px; padding: 1px 6px; font-size: 10.5px; border-radius: 6px; }
.compact .call-name span { display: none; }
</style>
