<script setup>
// La pista «Cartera», la CONSOLA: la bitácora del crédito hasta el día del reloj, una línea por evento. Al tocar una, el
// reloj va a esa noche y el detalle la abre. Es de la pista: lo que llega por bin/flow sigue en la consola de la tabla.
import { computed, nextTick, ref, watch } from 'vue'
import './portfolio.css'
import { portfolioSim as sim, portfolioUi as clock, jumpPortfolio, dateOf } from './portfolio.js'

const MARK = { disbursement: 'pf-mk-disbursement', billing: 'pf-mk-billing', payment: 'pf-mk-payment', state: 'pf-mk-state', collection: 'pf-mk-collection' }
const lines = computed(() => sim.value.events.map((e, i) => ({ ...e, i })).filter((e) => e.day <= clock.day))
const body = ref(null)
// Sigue al final mientras el reloj corre, como una consola.
watch(() => lines.value.length, async () => { await nextTick(); if (body.value) body.value.scrollTop = body.value.scrollHeight })
defineExpose({ count: computed(() => lines.value.length) })
</script>

<template>
  <div ref="body" class="region-body flow-console pf-console">
    <p v-if="!lines.length" class="flow-console__empty">Todavía nada: el reloj está en el desembolso.</p>
    <div v-for="e in lines" :key="e.i" class="log-line pf-log-line" :class="[MARK[e.kind], { on: clock.selected === e.i }]" @click="jumpPortfolio(e.day, e.i)">
      <span class="log-time">día {{ e.day }} · {{ dateOf(sim.days[e.day].date) }}</span><span>{{ e.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.pf-log-line { cursor: pointer; border-left: 2px solid transparent }
.pf-log-line:hover, .pf-log-line.on { background: var(--hover) }
.pf-log-line.pf-mk-payment { border-left-color: var(--status-ok) }
.pf-log-line.pf-mk-collection { border-left-color: var(--status-bad) }
.pf-log-line.pf-mk-state { border-left-color: var(--status-warn) }
.pf-log-line.pf-mk-disbursement { border-left-color: var(--primary-ink) }
</style>
