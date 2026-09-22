<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Check, Clock, RadioTower, X } from 'lucide-vue-next'
import { ui, findLenderDef, externalReturnOf, externalOutcome, setExternalReturn, openFieldInfo } from '../store'

// La respuesta externa es una señal que vuelve tarde; no es parte de la radicación. Separarla evita
// que un "radicado" se lea erróneamente como crédito aprobado.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const outcome = computed(() => name.value ? externalOutcome(name.value) : null)
const value = computed(() => name.value ? externalReturnOf(name.value) : '')
const options = computed(() => lender.value?.rt === 1
  ? [
      { value: 'pendiente', label: 'en espera' }, { value: 'fulfilled', label: 'autorizada' },
      { value: 'rejected', label: 'rechazada' }, { value: 'pending_disbursement', label: 'por desembolsar' },
      { value: 'webhook_failed', label: 'sin retorno' },
    ]
  : [
      { value: 'desconocido', label: 'sin visibilidad' }, { value: 'fulfilled', label: 'autorizada' },
      { value: 'webhook_failed', label: 'sin retorno' },
    ])
const Icon = computed(() => outcome.value?.kind === 'ok' ? Check : outcome.value?.kind === 'bad' ? X : outcome.value?.kind === 'wait' ? Clock : RadioTower)
const tone = computed(() => outcome.value?.kind === 'ok' ? 'ok' : outcome.value?.kind === 'bad' ? 'no' : outcome.value?.kind === 'wait' ? 'lowp' : 'na')
function set(value) { if (name.value) setExternalReturn(name.value, value) }
</script>

<template>
  <div v-if="lender" class="node node--return prov-node">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--amber nhd-doc" title="clic: el resultado vuelve en otro momento" @click="openFieldInfo('psel.return')">
      <div class="node__title"><RadioTower :size="13" /> Retorno externo</div>
      <span class="pl-cat">asíncrono</span>
    </div>
    <div class="node__body return-body">
      <div class="return-hint">{{ lender.rt === 1 ? 'Radicar no es aprobar. El proveedor responde después.' : 'La entidad decide fuera; CreditOp puede no recibir el cierre.' }}</div>
      <div class="return-options nodrag">
        <button v-for="option in options" :key="option.value" class="return-option" :class="{ on: value === option.value }" @click.stop="set(option.value)">{{ option.label }}</button>
      </div>
      <div class="rn-status" :class="tone"><component :is="Icon" :size="13" /><span>{{ outcome?.label }}</span></div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
