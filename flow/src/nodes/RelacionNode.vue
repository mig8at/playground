<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, merchant, lenders, sucursalDiag,
  setDatacredito, toggleDatacredito, datacreditoInherit, resetDatacredito, sucursalActiveCount, openFieldInfo } from '../store'
import { X, Check, SlidersHorizontal } from 'lucide-vue-next'

// Config de sucursal (nivel 2) = la 2ª CAPA del cascade: group_rules + datacrédito COPIADOS por
// sucursal (allied_branch_id). Corren ANTES del perfilamiento. Semántica fiel:
//   rt=2 falla → EXCLUYE · rt≠2 falla → clasifica al fondo ("prob. baja"; datacrédito solo reordena).
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const diag = computed(() => name.value ? sucursalDiag(name.value) : null)
const dc = computed(() => diag.value?.datacredito)            // umbrales datacrédito (editable)
const gate = computed(() => diag.value?.gate)                 // evaluación contra el sujeto actual
const result = computed(() => lenders.value.find(l => l.name === name.value))
const rt2 = computed(() => lender.value?.rt === 2)
// fallas de datacrédito por key → ✗ en la fila
const dcFail = computed(() => { const m = {}; (gate.value?.datacredito.fails || []).forEach(f => m[f.key] = f.reason); return m })
// 4 umbrales numéricos del datacrédito (el thin-file se pinta aparte). failKey = key con la que llega la falla.
const DC_FIELDS = [
  { key: 'minScore', label: 'Score mín', failKey: 'score', title: 'Score mínimo del buró (0 = no exige score).' },
  { key: 'maxNegatives', label: 'Negativos 12m máx', failKey: 'negatives12m', title: 'Máximo de reportes negativos 12m (20 = no exige).' },
  { key: 'maxInquiries', label: 'Consultas 6m máx', failKey: 'inquiries6m', title: 'Máximo de consultas al buró 6m (20 = no exige).' },
  { key: 'minMaturation', label: 'Maduración mín', failKey: 'creditHistoryMonths', unit: 'm', title: 'Maduración mínima del historial en meses (0 = no exige).' },
]
// Herencia del datacrédito: se COPIA del lender por sucursal → punto gris (heredado) / amarillo (editado).
const dcInh = (k) => datacreditoInherit(name.value, k)
const dcHeredar = (k) => resetDatacredito(name.value, k)
</script>

<template>
  <div class="node node--relacion prov-node" v-if="lender">
    <Handle id="in" type="target" :position="Position.Right" />
    <Handle id="fromgr" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.relacion')">
      <div class="hd-left"><div class="node__title"><SlidersHorizontal :size="13" /> Configurar sucursal</div></div>
      <div class="hd-right">
        <span class="pl-cat" title="reglas por sucursal · 2ª capa · antes de perfilar">2ª capa</span>
        <button class="prov__x nodrag" @click.stop="ui.selected = null" aria-label="cerrar"><X :size="14" /></button>
      </div>
    </div>
    <div class="node__body">
      <div class="node__desc"><b>{{ lender.name }}</b> en {{ merchant.sucursal }} — reglas por sucursal</div>
      <div class="rn-sub">rt{{ lender.rt }} · {{ sucursalActiveCount(name) }} reglas · al fallar:
        <b :class="rt2 ? 'v-excl' : 'v-cls'">{{ rt2 ? 'EXCLUYE (rt2)' : 'clasifica (rt≠2)' }}</b>
      </div>
      <div class="rn-status" :class="result ? (result.ok ? (result.prob === 'baja' ? 'lowp' : 'ok') : 'no') : 'na'">
        <Check v-if="result && result.ok && result.prob !== 'baja'" :size="13" />
        <X v-else-if="result && !result.ok" :size="13" />
        <span v-else class="rn-dot">●</span>
        <span>{{ result ? (result.ok ? (result.prob === 'baja' ? result.reason : 'pasa la 2ª capa') : result.reason) : '— no ofrecido en esta sucursal' }}</span>
      </div>

      <!-- ── Datacrédito por sucursal: 4 umbrales del buró (AND) ── -->
      <div class="pl-sec">
        <span class="fld-doc" title="clic: dónde vive y por qué (copiado por sucursal)" @click="openFieldInfo('suc.datacredito')">Datacrédito <span class="pl-hint">· buró · AND</span></span>
        <span class="dc-sw nodrag" :class="{ on: dc.enabled }" @click.stop="toggleDatacredito(name, !dc.enabled)"
              :title="dc.enabled ? 'regla datacrédito activa en esta sucursal' : 'sin regla datacrédito para esta sucursal'">
          {{ dc.enabled ? 'aplica' : 'sin regla' }}
        </span>
      </div>
      <div v-if="dc.enabled" class="dc-box">
        <div v-for="f in DC_FIELDS" :key="f.key" class="dr dr--row" :class="{ 'dr--on': dcInh(f.key) === 'editada', 'dr--fail': dcFail[f.failKey] }">
          <div class="dr-top">
            <button class="dr-dot nodrag" :class="'dot-' + dcInh(f.key)" :disabled="dcInh(f.key) !== 'editada'"
                    :title="(dcInh(f.key) === 'editada' ? 'editado — clic para heredar ' : 'heredado ') + 'del datacrédito copiado del lender'"
                    @click="dcHeredar(f.key)"></button>
            <span class="dr-l" :title="f.title">{{ f.label }}</span>
          </div>
          <span class="dr-c"><input class="nodrag afld__in dc-in" type="number" :value="dc[f.key]" @input="e => setDatacredito(name, f.key, e.target.value)" /><span v-if="f.unit" class="dc-u">{{ f.unit }}</span></span>
        </div>
        <div class="dr dr--row" :class="{ 'dr--on': dcInh('allowZeroScore') === 'editada' }">
          <div class="dr-top">
            <button class="dr-dot nodrag" :class="'dot-' + dcInh('allowZeroScore')" :disabled="dcInh('allowZeroScore') !== 'editada'"
                    :title="(dcInh('allowZeroScore') === 'editada' ? 'editado — clic para heredar ' : 'heredado ') + 'del datacrédito copiado del lender'"
                    @click="dcHeredar('allowZeroScore')"></button>
            <span class="dr-l" title="allow_0_score: si acepta clientes sin historial (thin file).">Acepta sin historial</span>
          </div>
          <button class="chip-toggle nodrag dr-bool" :class="{ on: dc.allowZeroScore }" @click="setDatacredito(name, 'allowZeroScore', !dc.allowZeroScore)">{{ dc.allowZeroScore ? 'sí' : 'no' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
