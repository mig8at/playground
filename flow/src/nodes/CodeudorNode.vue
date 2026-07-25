<script setup>
import { Handle, Position } from '@vue-flow/core'
import { state, openFieldInfo } from '../store'
import { Users } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Codeudor — solo en RENTING cuando el ingreso del solicitante ≤ 3.000.000 (bifurcación en App.vue).
// Mismos datos que el nodo Solicitud (persona + ingreso/egresos), del codeudor que respalda la operación.
</script>

<template>
  <div class="node node--sol">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.codeudor')">
      <div class="node__title"><Users :size="13" /> Codeudor</div>
      <div class="node__kind">input</div>
    </div>
    <div class="node__body">
      <label class="field"><span>Nombre</span>
        <input class="nodrag" v-model="state.codeudor.nombre" />
      </label>
      <label class="field"><span>Apellido</span>
        <input class="nodrag" v-model="state.codeudor.apellido" />
      </label>
      <label class="field"><span>Tipo doc.</span>
        <select class="nodrag" v-model="state.codeudor.tipoDoc">
          <option>CC</option><option>CE</option><option>PEP</option>
        </select>
      </label>
      <label class="field"><span>N° documento</span>
        <input class="nodrag" v-model="state.codeudor.numDoc" inputmode="numeric" />
      </label>
      <label class="field"><span>Fecha exped.</span>
        <input class="nodrag" type="date" v-model="state.codeudor.fechaExp" />
      </label>
      <label class="field"><span>Ingreso</span>
        <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.codeudor.salario" /></AffixField>
      </label>
      <label class="field"><span>Egresos</span>
        <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.codeudor.egresos" /></AffixField>
      </label>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
