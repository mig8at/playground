<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { perfil, money, state, ui, lenders, providerDown, openFieldInfo } from '../store'
import { Check, X, Gauge } from 'lucide-vue-next'
import { useFails } from '../useFails'

// Estado de los proveedores (color = edge del proveedor). "Caído" = API apagada → no aporta a la cascada.
// Experian se abre en 2 productos/risk_centrals: Acierta (score) y Quanto (ingreso), independientes.
// Ábaco YA NO es buró: vive aparte en el nodo "Información complementaria" (ingreso extra informativo).
const PROVS = [
  { k: 'experian', short: 'Exp', label: 'Experian · Acierta (datacrédito)', color: '#6aa9e2' },
  { k: 'quanto', short: 'Qto', label: 'Experian · Quanto (ingreso est.)', color: '#8ec0ee' },
  { k: 'agil', short: 'Ágil', label: 'Ágil Data', color: '#5dcaa5' },
  { k: 'tusdatos', short: 'TusD', label: 'TusDatos', color: '#b6afe8' },
  { k: 'mareigua', short: 'Mare', label: 'Mareigua', color: '#e0a94e' },
]

const montoNum = computed(() => parseInt(String(state.monto).replace(/\D/g, '')) || 0)
const { bad } = useFails()
const result = computed(() => ui.selected ? lenders.value.find(l => l.name === ui.selected) : null)
const feeShort = computed(() => {
  const r = result.value
  return (r && r.initialFeePct > 0 && state.cuotaInicial < r.initialFeeAmount)
    ? { paid: state.cuotaInicial, min: r.initialFeeAmount } : null
})
const scorePct = computed(() => perfil.value.score == null ? 0 : Math.max(0, Math.min(100, Math.round((perfil.value.score - 150) / 800 * 100))))
const scoreColor = computed(() => {
  const s = perfil.value.score
  if (s == null) return '#b0aea5'
  if (s < 500) return '#c0392b'
  if (s < 700) return '#BA7517'
  return '#3B6D11'
})
</script>

<template>
  <div class="node node--buro">
    <Handle id="top" type="target" :position="Position.Top" />
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--teal nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.buro')">
      <div class="node__title"><Gauge :size="13" /> Perfil consolidado</div>
      <div class="node__kind" style="color:#5dcaa5">{{ ui.selected ? 'vs ' + ui.selected : 'buró' }}</div>
    </div>
    <div class="node__body buro">
      <div class="prov">
        <div class="prov__hd">Solicitud</div>
        <div class="kv" :class="{ 'kv--fail': bad('amount') }"><span class="fld-doc" title="clic: detalle" @click="openFieldInfo('sol.monto')">Monto</span><b>{{ money(montoNum) }}</b></div>
        <div class="kv" :class="{ 'kv--fail': bad('documentTypes') }"><span class="fld-doc" title="clic: detalle" @click="openFieldInfo('sol.tipoDoc')">Tipo doc.</span><b>{{ state.tipoDoc }}</b></div>
      </div>
      <div class="prov">
        <div class="prov__hd">Resumen enriquecimiento</div>
        <div class="kv"><span class="fld-doc" title="clic: detalle" @click="openFieldInfo('buro.score')">Score</span><b>{{ perfil.score ?? '—' }}</b></div>
        <div class="bar"><i :style="{ width: scorePct + '%', background: scoreColor }"></i></div>
        <div class="kv"><span>Ingreso ({{ perfil.salarioFuente }})</span><b>{{ money(perfil.salario) }}</b></div>
        <div class="kv" :class="{ 'kv--fail': bad('debtToIncomePct') }"><span class="fld-doc" title="clic: detalle" @click="openFieldInfo('buro.debtToIncome')">Endeudamiento</span><b>{{ perfil.debtToIncome == null ? '—' : perfil.debtToIncome + '%' }}</b></div>
        <div class="kv"><span class="fld-doc" title="clic: detalle" @click="openFieldInfo('buro.edad')">Edad · género</span><b>{{ perfil.edad ?? '—' }} · {{ perfil.gender ?? '—' }}</b></div>
        <div class="prov-status">
          <span v-for="p in PROVS" :key="p.k" class="ps" :class="{ 'ps--down': providerDown[p.k] }"
                :title="p.label + (providerDown[p.k] ? ' · API caída (no aporta)' : ' · ok')">
            <i class="ps__dot" :style="{ background: p.color }"></i>{{ p.short }}
          </span>
        </div>
      </div>
      <div v-if="ui.selected" class="buro__verdict" :class="result ? (result.ok ? 'good' : 'bad') : 'na'">
        <Check v-if="result && result.ok" :size="13" />
        <X v-else-if="result" :size="13" />
        <span>{{ result ? (result.ok ? ui.selected + ' aprueba' : result.reason) : ui.selected + ' no ofrecido aquí' }}</span>
      </div>
      <div v-if="feeShort" class="buro__verdict bad"><X :size="13" /><span>cuota inicial {{ money(feeShort.paid) }} &lt; mínimo {{ money(feeShort.min) }}</span></div>
      <div class="cert-legend">certeza (borde ☑): <i class="cert-sw cert-sw--1"></i> principal <i class="cert-sw cert-sw--2"></i> respaldo <i class="cert-sw cert-sw--3"></i> estimación</div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
