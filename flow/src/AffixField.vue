<script setup>
// Campo con prefijo/sufijo ADENTRO (se ve como un solo input): el borde/fondo los pone el wrapper
// y el input va sin borde. El input del slot debe llevar la clase `afld__in`.
import { computed } from 'vue'
import { currencyAffix } from './store'

const props = defineProps({ prefix: String, suffix: String, currency: Boolean })
const displayedPrefix = computed(() => props.currency ? currencyAffix() : props.prefix)
</script>

<template>
  <span class="afld">
    <span v-if="displayedPrefix" class="afld__affix afld__affix--pre">{{ displayedPrefix }}</span>
    <slot />
    <span v-if="suffix" class="afld__affix afld__affix--suf">{{ suffix }}</span>
  </span>
</template>
