<script setup>
import { Handle, Position } from '@vue-flow/core'
import { Check, X, Minus } from 'lucide-vue-next'

// Una regla del gate. Acá SÍ tiene sentido el nodo sí/no: una decisión es lógica de negocio,
// no aritmética — hay dos caminos de verdad. (En el grafo de cálculo no los hay: todo se
// calcula siempre, no existe la rama "no".)
defineProps({ data: Object })
</script>

<template>
  <div class="p" :class="data.state">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="p__hd">
      <span class="p__id">{{ data.id }}</span>
      {{ data.label }}
      <span style="margin-left:auto">
        <Check v-if="data.state === 'pass'" :size="15" />
        <X v-else-if="data.state === 'fail'" :size="15" />
        <Minus v-else :size="15" />
      </span>
    </div>
    <div class="p__body">
      {{ data.test }}
      <div class="p__res">
        <span class="badge" :class="data.state === 'pass' ? 'b-ok' : data.state === 'fail' ? 'b-no' : 'b-sk'">
          {{ data.state === 'pass' ? 'pasa' : data.state === 'fail' ? 'no pasa' : 'no se evaluó' }}
        </span>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
    <Handle id="no" type="source" :position="Position.Bottom" />
  </div>
</template>
