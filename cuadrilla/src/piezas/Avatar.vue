<script setup>
import { computed } from 'vue'
import { persona } from '../datos.js'

const props = defineProps({
  quien: { type: String, required: true },
  tam:   { type: Number, default: 29 },
})

const p = computed(() => persona(props.quien))
const iniciales = computed(() =>
  p.value.nombre.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase())
</script>

<template>
  <span
    class="av"
    :style="{ '--c': p.c, width: tam + 'px', height: tam + 'px', fontSize: Math.round(tam * .38) + 'px' }"
    :title="p.nombre"
  >{{ iniciales }}</span>
</template>

<style scoped>
.av{border-radius:50%;flex:0 0 auto;display:grid;place-items:center;
  font-weight:700;color:#fff;background:var(--c);line-height:1}
</style>
