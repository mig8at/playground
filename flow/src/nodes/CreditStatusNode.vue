<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, postSelVal, creditStatus, openFieldInfo } from '../store'
import { Check, X, Clock, ExternalLink } from 'lucide-vue-next'

// Estado final del crédito, al costado derecho de la formalización. Deriva de creditStatus() (función
// pura). Presentación tipo "badge": ícono grande centrado + palabra de estado + detalle corto.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const STEP_TITLE = { plan: 'Plan de pagos', kyc: 'KYC (ADO)', firma: 'Firma del pagaré', enganche: 'Cobro del enganche', radica: 'Radicación', decision: 'Decisión externa', infoAdicional: 'Información adicional', merge: 'Merge de documentos', soap: 'Radicación SOAP' }
const ICON = { ok: Check, bad: X, wait: Clock, unknown: ExternalLink, na: ExternalLink }
const view = computed(() => {
  const s = name.value ? creditStatus(name.value) : null
  if (!s) return { kind: 'na', word: '—', label: '' }
  if (s.rt === 0) return { kind: 'unknown', word: 'Fuera de CreditOp', label: 'El desenlace ocurre en el sitio del lender; la plataforma no lo sabe.' }
  if (!s.ok) {
    if (s.rt === 1) {
      if (s.failedAt === 'radica') return { kind: 'bad', word: 'No radicado', label: 'No se pudo radicar la solicitud.' }
      const d = postSelVal(name.value, 'decision')
      if (d === 'timeout') return { kind: 'wait', word: 'En proceso', label: 'Timeout — formalización asíncrona; el resultado llega después.' }
      return { kind: 'bad', word: 'Rechazado', label: 'Rechazado por su API.' }
    }
    // Credifamilia (rt=4): la radicación SOAP la rechazó por datos → CREDIT_INVALID (400). Motivo desde creditStatus().
    if (s.rt === 4) return { kind: 'bad', word: 'CREDIT_INVALID', label: s.reason || 'Credifamilia rechazó la radicación (400) por datos obligatorios.' }
    return { kind: 'bad', word: 'Detenido', label: 'Se detuvo en “' + (STEP_TITLE[s.failedAt] || s.failedAt) + '” — no llega al Estado 11.' }
  }
  if (s.rt === 1) return { kind: 'ok', word: 'Aprobado', label: 'Radicado · Estado 11. La cartera queda del lender.' }
  if (s.rt === 4) return { kind: 'ok', word: 'Radicado', label: 'Radicado en Credifamilia (transaccionConsumo + guardarDocumentoOpenKm OK) · Estado 11.' }
  return { kind: 'ok', word: 'Desembolsado', label: 'Estado 11 “Autorizada” + aviso a la tienda (webhook).' }
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
