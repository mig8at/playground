<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, delegatedOf, setDelegated, applyDelegatedPreset, DELEGATED_PRESETS, openFieldInfo } from '../store'
import { FileCog } from 'lucide-vue-next'

// Riel 4 · la ficha de originación delegada (`delegated_origination_profiles`) de la entidad elegida. Arriba del
// hub de perfilamiento, como las categorías: dice de dónde salen los números del plan y qué pasa al autorizar.
const lender = computed(() => findLenderDef(ui.selected))
const d = computed(() => delegatedOf(lender.value))
const set = (k, v) => setDelegated(lender.value, k, v)
const setDays = (txt) => {
  const days = String(txt).split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 31)
  if (days.length) set('paymentDays', [...new Set(days)].sort((a, b) => a - b))
}
</script>

<template>
  <div v-if="lender" class="node node--tramo prov-node">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.delegated')">
      <div class="node__title"><FileCog :size="13" /> Ficha de originación delegada</div>
      <div class="node__kind">rt=4</div>
    </div>
    <div class="node__body">
      <div class="dl-presets">
        <button v-for="(p, k) in DELEGATED_PRESETS" :key="k" class="pp-date nodrag" @click.stop="applyDelegatedPreset(lender, k)">{{ p.label }}</button>
      </div>
      <label class="field"><span>¿Quién aplica la política?</span>
        <select class="nodrag" :value="d.source" @change="e => set('source', e.target.value)">
          <option value="motor">nuestro motor de cupo (categorías)</option>
          <option value="entidad">la API de la entidad</option>
        </select>
      </label>
      <label class="field"><span>Días de pago</span>
        <input class="nodrag" :value="d.paymentDays.join(', ')" @change="e => setDays(e.target.value)" />
      </label>
      <label class="field"><span>Fianza (% del financiado, + IVA)</span>
        <input class="nodrag" type="number" min="0" step="0.5" :value="d.bondPct" @input="e => set('bondPct', Number(e.target.value))" />
      </label>
      <label class="field"><span>Cobro de la fianza</span>
        <select class="nodrag" :value="d.bondType" @change="e => set('bondType', e.target.value)">
          <option value="anticipada">anticipada (se financia con el crédito)</option>
          <option value="mensual">mensual (en cada cuota)</option>
        </select>
      </label>
      <label class="field dl-check"><input class="nodrag" type="checkbox" :checked="d.formalization" @change="e => set('formalization', e.target.checked)" />
        <span>Al autorizar, se radica con la entidad</span>
      </label>
      <div class="tr-hint">
        {{ d.source === 'motor'
          ? 'El cupo y el plazo salen de la categoría, como en CreditopX, pero con la política de la entidad. Un monto mayor al cupo bloquea la tarjeta.'
          : 'Aprueba o rechaza su API; el cupo es el máximo que devuelve. Un monto mayor bloquea la tarjeta.' }}
        {{ d.formalization ? 'Después de la firma, la radicación; el 11 llega cuando la entidad la acepta.' : 'Termina en el 11 al firmar.' }}
      </div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.dl-presets { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.dl-check { display: flex; align-items: center; gap: 6px; flex-direction: row; }
</style>
