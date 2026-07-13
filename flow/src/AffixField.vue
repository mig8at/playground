<script setup>
// Campo con prefijo/sufijo ADENTRO (se ve como un solo input): el borde/fondo los pone el wrapper
// y el input va sin borde. El input del slot debe llevar la clase `afld__in`.
defineProps({ prefix: String, suffix: String })
</script>

<template>
  <span class="afld">
    <span v-if="prefix" class="afld__affix afld__affix--pre">{{ prefix }}</span>
    <slot />
    <span v-if="suffix" class="afld__affix afld__affix--suf">{{ suffix }}</span>
  </span>
</template>
