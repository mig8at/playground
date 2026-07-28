<script setup>
// Rótulo de zona. No es un nodo real del grafo: no tiene handles ni aristas, solo marca
// dónde empieza cada una de las tres etapas.
defineProps({ data: Object })
</script>

<template>
  <div class="zone" :class="'zone--' + data.tone">
    <b>{{ data.n }}</b>{{ data.title }}
    <span>{{ data.sub }}</span>
  </div>
</template>
