<script setup>
import { Handle, Position } from '@vue-flow/core'

// Los finales del árbol: el rechazo (compartido por todas las reglas del gate) y las ramas
// del outcome. Solo se ilumina el camino que de verdad se tomó.
defineProps({ data: Object })

const OUT = {
  aprobado: { txt: 'Aprobado', cls: 'pass' },
  condicional: { txt: 'Condicional · codeudor', cls: 'fail' },
  revision_manual: { txt: 'Revisión manual', cls: '' },
}
</script>

<template>
  <!-- rechazo -->
  <div v-if="data.kind === 'reject'" class="p p--out" :class="data.hit ? 'fail' : 'skip'">
    <Handle id="in" type="target" :position="Position.Top" />
    <div class="p__hd">Rechazado</div>
    <div class="p__body">
      <template v-if="data.hit">{{ data.explanation }}</template>
      <template v-else>Ninguna regla del gate falló.</template>
    </div>
  </div>

  <!-- rama del outcome -->
  <div v-else class="p p--out" :class="data.hit ? 'hit' : (data.reached ? '' : 'skip')">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="p__hd">{{ (OUT[data.then] || {}).txt || data.then }}</div>
    <div class="p__body">
      {{ data.label }}
      <div v-if="data.note" class="p__res" style="color:var(--amber)">{{ data.note }}</div>
      <div v-if="data.hit" class="p__res"><span class="badge b-ok">esta rama ganó</span></div>
    </div>
  </div>
</template>
