<script setup>
import { Handle, Position } from '@vue-flow/core'
import { ArrowRight, ChevronDown } from 'lucide-vue-next'
import { ui } from '../store.js'

// ETAPA 3 · qué se hace con los números una vez calculados.
// Dos de estas cosas las produce el motor (el plan de pagos y el veredicto de la política);
// el resto NO — documentos, core, BD, pantalla. Ese corte es la frontera del servicio y
// por eso el último nodo va apagado: está para verse, no para funcionar.
defineProps({ data: Object })
</script>

<template>
  <!-- fuera del motor: la frontera -->
  <div v-if="data.kind === 'outside'" class="n n--outside" style="min-width:250px;max-width:250px">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd"><b>Fuera del motor</b><span class="n__kind">el llamador</span></div>
    <div class="nx">
      <div v-for="t in data.items" :key="t" class="nx__row">{{ t }}</div>
      <div class="nx__note">El motor devolvió números y un veredicto. Lo de acá es del que llama.</div>
    </div>
  </div>

  <!-- lo que el motor sí produce -->
  <div v-else class="n n--next" :class="'v-' + (data.tone || '')" style="min-width:250px;max-width:250px">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="n__hd"><b>{{ data.title }}</b><span class="n__kind">{{ data.tag }}</span></div>
    <div class="nx">
      <div v-if="data.headline" class="nx__head">{{ data.headline }}</div>
      <div v-for="r in data.rows" :key="r.k" class="nx__kv">
        <span>{{ r.k }}</span><b>{{ r.v }}</b>
      </div>
      <div v-if="data.detail" class="nx__note">{{ data.detail }}</div>
      <button v-if="data.action" class="nodrag nx__go" @click="data.action === 'series'
        ? (ui.seriesOpen = true) : (ui.tab = 'policy')">
        <ChevronDown v-if="data.action === 'series'" :size="12" />
        <ArrowRight v-else :size="12" />
        {{ data.action === 'series' ? 'ver la tabla' : 'ver el árbol' }}
      </button>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
