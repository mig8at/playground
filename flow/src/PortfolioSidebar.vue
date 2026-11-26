<script setup>
// La pista «Cartera», el SIDEBAR: qué historia se cuenta y con qué números. Es de la pista y no comparte nada con el
// escenario de la tabla y el grafo (las entidades y el cliente de la solicitud no cambian la cartera de juguete).
import { reactive, watch } from 'vue'
import { readPref, savePref } from './workbench.js'
import './portfolio.css'
import {
  portfolio, SCENARIOS, COLLECTION_TIERS, DEFAULT_ASSUMPTIONS, fmt,
  portfolioSim as sim, chooseScenario,
} from './portfolio.js'

const open = reactive({ story: true, assume: true, ...readPref('flow.portfolio-sections', {}) })
watch(open, () => savePref('flow.portfolio-sections', { ...open }), { deep: true })

const FIELDS = [
  { key: 'amount', label: 'Monto', step: 100000, min: 100000 },
  { key: 'term', label: 'Cuotas', step: 1, min: 1 },
  { key: 'monthlyRate', label: 'Interés mensual %', step: 0.1, min: 0 },
  { key: 'lateRate', label: 'Mora mensual %', step: 0.1, min: 0 },
  { key: 'guaranteeFundPct', label: 'FGA %', step: 1, min: 0 },
  { key: 'lifePerMillion', label: 'Seguro de vida por millón', step: 100, min: 0 },
  { key: 'guaranteeFee', label: 'Seguro de garantía por corte', step: 500, min: 0 },
  { key: 'ctxCommissionPct', label: 'Comisión CTX %', step: 0.5, min: 0 },
]
</script>

<template>
  <div class="region-head pf-side-head"><span>Cartera</span><span class="count">un crédito CreditopX de juguete</span></div>
  <div class="region-body pf-side">
    <button type="button" class="region-head group pf-side-group" :aria-expanded="open.story" @click="open.story = !open.story">
      <span>Historia</span><span class="count">{{ SCENARIOS.length }}</span><span class="ui-icon pf-chev" data-icon="down" aria-hidden="true"></span>
    </button>
    <div v-show="open.story" role="listbox" aria-label="La historia">
      <button v-for="s in SCENARIOS" :key="s.key" type="button" role="option" class="row pf-story"
        :class="{ on: portfolio.scenario === s.key }" :aria-selected="portfolio.scenario === s.key" @click="chooseScenario(s.key)">
        <span class="pf-story-name">{{ s.label }}</span>
        <span class="pf-story-hint">{{ s.hint }}</span>
      </button>
    </div>

    <button type="button" class="region-head group pf-side-group" :aria-expanded="open.assume" @click="open.assume = !open.assume">
      <span>Supuestos</span><span class="count">cuota {{ fmt(sim.quota) }}</span><span class="ui-icon pf-chev" data-icon="down" aria-hidden="true"></span>
    </button>
    <div v-show="open.assume" class="pf-side-body">
      <label v-for="f in FIELDS" :key="f.key" class="pf-field">
        <span>{{ f.label }}</span>
        <input v-model.number="portfolio.assumptions[f.key]" class="input" type="number" :min="f.min" :step="f.step">
      </label>
      <p class="pf-side-note">FGA {{ fmt(sim.guaranteeFund) }} (con IVA) sobre {{ fmt(sim.financed) }}: Juan debe {{ fmt(sim.base) }}.
        Gasto de cobranza: {{ COLLECTION_TIERS.map((t) => `${fmt(t.amount)} el día ${t.from}`).join(' · ') }}.</p>
      <p class="pf-side-note">Números de juguete: ninguno es de una entidad real.
        <button type="button" class="btn btn-link" @click="portfolio.assumptions = { ...DEFAULT_ASSUMPTIONS }">volver a los de ejemplo</button></p>
    </div>
  </div>
</template>

<style scoped>
.pf-side-head .count { margin-left: auto }
.pf-side-group { width: 100%; cursor: pointer; text-align: left; font: inherit; font-size: var(--text-base) }
.pf-side-group .count { margin-left: auto }
.pf-chev { transition: transform var(--motion-fast) }
.pf-side-group[aria-expanded="false"] .pf-chev { transform: rotate(-90deg) }
.pf-story { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; height: auto; min-height: var(--row-h);
  padding: var(--space-2) var(--space-4); text-align: left; border: 0; background: none; font: inherit; color: inherit; cursor: pointer }
.pf-story:hover { background: var(--hover) }
.pf-story.on { background: var(--hover); box-shadow: inset 2px 0 0 var(--primary-ink) }
.pf-story-name { font-weight: 500 }
.pf-story-hint { color: var(--fg-3); font-size: var(--text-sm); line-height: 1.4; white-space: normal }
.pf-story-name { white-space: normal }
.pf-side-body { padding: var(--space-2) var(--space-4) var(--space-4); display: flex; flex-direction: column; gap: var(--space-2) }
.pf-field { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--fg-2); font-size: var(--text-sm) }
.pf-field .input { width: 120px; text-align: right }
.pf-side-note { margin: var(--space-1) 0 0; color: var(--fg-3); font-size: var(--text-sm); line-height: 1.5 }
</style>
