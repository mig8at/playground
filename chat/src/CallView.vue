<script setup>
/* LA VIDEOLLAMADA de una conversación: los que están en ella (personas y sus agentes) como personajes en papel
   cortado, en una grilla. Por ahora es sólo visual: todos escuchan, con su parpadeo y su balanceo; todavía no
   reaccionan a lo que se escribe en el chat. Los personajes salen de ./characters (un JSON por personaje). */
import { computed } from 'vue'

const props = defineProps({ cast: { type: Array, required: true } })
// la grilla se acomoda a cuántos son: dos columnas hasta cuatro, tres hasta nueve
const cols = computed(() => (props.cast.length <= 4 ? 2 : props.cast.length <= 9 ? 3 : 4))
const label = (c) => (c.agent ? `agente de ${c.ownerName || c.owner.split('.')[0]}` : '')
</script>

<template>
  <div class="region-body call" :style="{ '--cols': cols }" aria-label="Videollamada">
    <figure v-for="c in cast" :key="c.handle || `${c.owner}/${c.agent}`" class="call-tile">
      <office-personaje :config="JSON.stringify({ name: c.name, owner: c.agent ? c.owner : '', ...c.character })" gesto="escucha" />
      <figcaption class="call-name">
        <b>{{ c.name }}</b>
        <span v-if="label(c)">{{ label(c) }}</span>
      </figcaption>
    </figure>
  </div>
</template>

<style scoped>
.call { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); grid-auto-rows: minmax(0, 1fr);
  gap: 12px; padding: 12px; align-content: stretch; background: #0b0c0e; }
.call-tile { position: relative; margin: 0; min-height: 0; border-radius: 16px; overflow: hidden; }
.call-tile office-personaje { display: block; width: 100%; height: 100%; aspect-ratio: auto; border-radius: 16px; }
.call-name { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 6px; align-items: baseline; padding: 3px 10px; border-radius: 8px;
  background: #f1e4c7; color: #13323a; font-size: 12px; box-shadow: 0 2px 0 #d9c9a6; }
.call-name b { font-weight: 800; }
.call-name span { color: #2b6670; font-weight: 700; }
</style>
