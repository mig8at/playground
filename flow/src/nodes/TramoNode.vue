<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, state, money, tramosOf, tramoIsOn, setTramoOn, addTramo, removeTramo, setTramo, activeTramoIndex, openFieldInfo } from '../store'
import { X, Plus, Ruler } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Tramo por monto como nodo propio (junto a las categorías, arriba del hub). Último ajuste del
// cascade rt=2: según el monto recorta plazos y topea el cupo; NO toca el enganche.
const name = computed(() => ui.selected)
const tramos = computed(() => tramosOf(name.value))
const on = computed(() => tramoIsOn(name.value))
const activeIdx = computed(() => activeTramoIndex(name.value))
const montoFmt = computed(() => Number(String(state.monto).replace(/\D/g, '') || 0).toLocaleString('es-CO'))
</script>

<template>
  <div class="node node--tramo prov-node">
    <div class="node__hd node__hd--teal">
      <div class="node__title"><Ruler :size="13" /> <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('tramo')">Tramos por monto</span></div>
      <span class="dc-sw nodrag" :class="{ on }" @click.stop="setTramoOn(name, !on)">{{ on ? 'aplica' : 'sin tramos' }}</span>
    </div>
    <div class="node__body">
      <template v-if="on">
        <div class="tr-hint">Según el monto pedido: recorta los plazos y topea el cupo. El enganche NO cambia (lo fija la categoría).</div>
        <div class="tr-hd"><span>desde</span><span>hasta</span><span>plazo</span><span>oblig.</span><span></span></div>
        <div v-for="(t, i) in tramos" :key="i" class="tr-row" :class="{ 'tr-row--on': i === activeIdx }">
          <AffixField prefix="$" class="afld--mny tr-f"><MoneyInput class="afld__in" :model-value="t.min" @update:model-value="v => setTramo(name, i, 'min', v)" /></AffixField>
          <AffixField prefix="$" class="afld--mny tr-f"><MoneyInput class="afld__in" :model-value="t.max" @update:model-value="v => setTramo(name, i, 'max', v)" /></AffixField>
          <input class="nodrag tr-n" type="number" min="0" :value="t.maxFee" @input="e => setTramo(name, i, 'maxFee', e.target.value)" title="plazo máximo (nº de cuotas) de esta franja" />
          <input class="nodrag tr-n" type="number" min="0" :value="t.mandatory" @input="e => setTramo(name, i, 'mandatory', e.target.value)" title="plazo obligatorio: 0 = no obliga; si >0, fuerza ese único plazo" />
          <button class="gr-x nodrag" @click.stop="removeTramo(name, i)" title="quitar tramo"><X :size="11" /></button>
        </div>
        <button class="gr-add nodrag" @click.stop="addTramo(name)"><Plus :size="11" /> tramo</button>
        <div v-if="activeIdx >= 0" class="tr-active">monto ${{ montoFmt }} → tramo {{ activeIdx + 1 }}: {{ tramos[activeIdx].mandatory ? tramos[activeIdx].mandatory + ' cuotas (obligatorio)' : 'hasta ' + tramos[activeIdx].maxFee + ' cuotas' }} · cupo topeado a {{ money(tramos[activeIdx].max) }}</div>
        <div v-else-if="!tramos.length" class="tr-active tr-active--muted">sin franjas — el monto no se restringe</div>
        <div v-else class="tr-active tr-active--no">monto ${{ montoFmt }} → por debajo del primer tramo (rechazo)</div>
      </template>
      <div v-else class="dn-hint">Tramos desactivados: el monto no recorta plazos ni topea el cupo.</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>
