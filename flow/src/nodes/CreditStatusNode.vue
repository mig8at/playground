<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, postSelVal, creditStatus, openFieldInfo } from '../store'
import { Check, X, Clock, ExternalLink } from 'lucide-vue-next'

// Estado final de la formalización externa/redirect (rt=1 agregador · rt=0 redirect). El terminal del
// flujo in-platform (CreditopX rt=2) es el nodo "Estado" (EstadoNode), no éste. Deriva de creditStatus().
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const ICON = { ok: Check, bad: X, wait: Clock, unknown: ExternalLink, na: ExternalLink }
const view = computed(() => {
  const s = name.value ? creditStatus(name.value) : null
  if (!s) return { kind: 'na', word: '—', label: '' }
  if (s.rt === 0) return { kind: 'unknown', word: 'Fuera de CreditOp', label: 'El desenlace ocurre en el sitio del lender; la plataforma no lo sabe.' }
  // rt=1 (agregador): la formalización la decide su API.
  if (!s.ok) {
    if (s.failedAt === 'radica') return { kind: 'bad', word: 'No radicado', label: 'No se pudo radicar la solicitud.' }
    if (postSelVal(name.value, 'decision') === 'timeout') return { kind: 'wait', word: 'En proceso', label: 'Timeout — formalización asíncrona; el resultado llega después.' }
    return { kind: 'bad', word: 'Rechazado', label: 'Rechazado por su API.' }
  }
  return { kind: 'ok', word: 'Aprobado', label: 'Radicado · Estado 11. La cartera queda del lender.' }
})
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
