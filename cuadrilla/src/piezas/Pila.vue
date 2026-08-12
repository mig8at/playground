<script setup>
import { computed } from 'vue'
import Avatar from './Avatar.vue'

// Avatares apilados. Más de `max` y el resto se resume en +N: cinco caras pisadas no se leen.
const props = defineProps({
  devs: { type: Array, required: true },
  max:  { type: Number, default: 4 },
  tam:  { type: Number, default: 29 },
})

const ver   = computed(() => props.devs.slice(0, props.max))
const resto = computed(() => props.devs.length - ver.value.length)
</script>

<template>
  <span class="pila">
    <Avatar v-for="d in ver" :key="d" :quien="d" :tam="tam" />
    <span v-if="resto > 0" class="av mas"
          :style="{ width: tam + 'px', height: tam + 'px', fontSize: Math.round(tam * .36) + 'px' }"
    >+{{ resto }}</span>
  </span>
</template>

<style scoped>
.pila{display:flex;align-items:center}
.pila > :deep(*){margin-left:-7px;border:2px solid var(--panel)}
.pila > :deep(*:first-child){margin-left:0}
.mas{border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-weight:700;
  background:var(--soft-bg2);color:var(--page-soft);line-height:1}
</style>
