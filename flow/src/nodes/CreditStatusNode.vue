<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, externalOutcome, openFieldInfo } from '../store'
import { Check, X, Clock, ExternalLink } from 'lucide-vue-next'

// Estado final de la formalización externa/redirect (rt=1 agregador · rt=0 redirect). El terminal del
// flujo in-platform (CreditopX rt=2) es el nodo "Estado" (EstadoNode), no éste. Se alimenta del
// retorno externo, que es independiente de haber radicado la solicitud.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const ICON = { ok: Check, bad: X, blocked: X, wait: Clock, unknown: ExternalLink, na: ExternalLink }
const view = computed(() => name.value ? externalOutcome(name.value) : { kind: 'na', word: '—', label: '' })
const icon = computed(() => ICON[view.value.kind] || ExternalLink)
</script>

<template>
  <div v-if="lender" class="node node--cstatus prov-node" :class="'psel--' + view.kind">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd nhd-doc psel-hd" title="clic: qué significa el estado final" @click="openFieldInfo('psel.terminal')">
      <div class="node__title">Estado del crédito</div>
    </div>
    <div class="node__body cst-body">
      <div class="cst-badge" :class="'cst-badge--' + view.kind"><component :is="icon" :size="30" :stroke-width="2.75" /></div>
      <div class="cst-word" :class="'cst-word--' + view.kind">{{ view.word }}</div>
      <div class="cst-detail">{{ view.label }}</div>
    </div>
  </div>
</template>
