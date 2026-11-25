<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Check, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { ui, findLenderDef, recheckStatus, setCommittedSinceOffer, captureOfferSnapshot, money, openFieldInfo } from '../store'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// El listado es una foto; al confirmar, /available-quota vuelve a mirar el caso. No fingimos
// llamar ese endpoint: el simulador compara el snapshot con la oferta calculada ahora y deja
// probar el cupo comprometido entre ambos momentos.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const check = computed(() => name.value ? recheckStatus(name.value) : null)
const ok = computed(() => check.value?.allowed)
const changed = computed(() => check.value?.kind === 'changed')
const tone = computed(() => ok.value ? (changed.value ? 'lowp' : 'ok') : 'no')
const title = computed(() => check.value?.kind === 'pass' ? 'la oferta sigue vigente'
  : check.value?.kind === 'changed' ? 'la oferta cambió, pero aún alcanza'
    : check.value?.kind === 'blocked' ? check.value.reason : 'tomá un snapshot de la oferta')

function capture() { if (name.value) captureOfferSnapshot(name.value) }
function setCommitted(value) { if (name.value) setCommittedSinceOffer(name.value, value) }
</script>

<template>
  <div v-if="lender" class="node node--recheck prov-node" :class="{ 'node--recheck-blocked': !ok }">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--amber nhd-doc" title="clic: por qué el POS vuelve a revisar" @click="openFieldInfo('psel.recheck')">
      <div class="node__title"><ShieldCheck :size="13" /> Re-evaluación en POS</div>
      <span class="pl-cat">2º motor</span>
    </div>
    <div class="node__body rc-body">
      <div class="rc-hint">El listado es una foto. Al confirmar, el cupo y las reglas se vuelven a revisar.</div>
      <template v-if="check?.snapshot">
        <div class="rc-snapshot">
          <span>oferta mostrada</span>
          <b>{{ check.snapshot.category || 'sin categoría' }} · {{ money(check.snapshot.cupo) }}</b>
        </div>
        <label class="rc-field">
          <span>Cupo comprometido después del listado</span>
          <AffixField currency><MoneyInput class="afld__in" :model-value="check.committed" @update:model-value="setCommitted" /></AffixField>
        </label>
        <div class="rn-status" :class="tone" :title="title">
          <Check v-if="ok" :size="13" />
          <CircleAlert v-else :size="13" />
          <span>{{ title }}</span>
        </div>
        <div class="rc-now">cupo al confirmar: <b>{{ money(check.cupo ?? 0) }}</b></div>
      </template>
      <div v-else class="rc-empty">No hay una oferta guardada para comparar.</div>
      <button class="rc-refresh nodrag" @click.stop="capture"><RefreshCw :size="12" /> {{ check?.snapshot ? 'tomar oferta actual' : 'guardar oferta actual' }}</button>
      <div class="rc-model">Modelo local: no llama el endpoint autoritativo.</div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
