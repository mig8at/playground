<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, lenders, usesQuotaEngine, isInHouse, money, openFieldInfo } from '../store'
import { Cpu } from 'lucide-vue-next'

// El motor de cupo de CreditOp, en legacy-backend: aplica las categorías de perfilamiento de la entidad con los datos
// guardados de las centrales y contesta si aprueba, con qué cupo y qué plazos. No es un paso que vea el cliente: se le
// PREGUNTA. Verificado en main (legacy-backend e98bfe119, 2026-11-25): `POST /api/loans/lender/available-quota`
// (CreditopXQuotaController::getAvailableQuota, política titular inicial), que pide pre-approvals-service por cada
// tarjeta CreditopX del listado; y `available-quota/extended` (titular extendida), que pide el servidor del wizard después
// de validar la identidad, para CUALQUIER entidad que siga en casa, y decide el paso siguiente (sin esa política, aprueba). Las categorías: LenderUserCategoryService, con lo guardado de las
// centrales. La delegada que lo usa (Finandina) llega por un alias de pre-approvals-service que está en develop, no en main.
const lender = computed(() => findLenderDef(ui.selected))
const row = computed(() => lenders.value.find(x => x.name === ui.selected) || null)
const consulted = computed(() => usesQuotaEngine(lender.value))          // en el listado (y después de la identidad)
const onlyExtended = computed(() => !!lender.value && !consulted.value && isInHouse(lender.value.rt)) // sólo después de la identidad
const who = computed(() => {
  const l = lender.value
  if (!l) return ''
  if (l.rt === 4) return 'contesta su propia API'
  if (l.rt === 1) return 'decide la API de la entidad'
  return 'redirige a su sitio'
})
</script>

<template>
  <div class="node node--tramo prov-node node--engine" :class="{ 'node--idle': lender && !consulted && !onlyExtended }">
    <Handle id="top" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--purple nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('node.engine')">
      <div class="node__title"><Cpu :size="13" /> Motor de cupo</div>
      <div class="node__kind">legacy-backend</div>
    </div>
    <div class="node__body">
      <div v-if="!lender" class="tr-hint">Aplica las categorías de perfilamiento con lo que guardaron las centrales. Lo consultan la preaprobación de cada tarjeta CreditopX del listado y, para toda entidad que siga en casa, el paso que sigue a validar la identidad. Elegí una entidad para ver qué contesta.</div>
      <template v-else-if="consulted">
        <div class="tr-hint">Para {{ lender.name }} contesta:</div>
        <div v-if="row && row.category" class="eng-row"><span>Categoría</span><b>{{ row.category }}</b></div>
        <div v-if="row && row.category" class="eng-row"><span>Cupo</span><b>{{ money(row.cupo) }}</b></div>
        <div v-if="row && row.category" class="eng-row"><span>Plazos</span><b>{{ (row.dues || []).join(' · ') || '—' }}</b></div>
        <div v-else class="tr-active tr-active--no">sin categoría: no aprueba</div>
        <div class="tr-hint eng-who">↓ preaprobación de la tarjeta: <code>available-quota</code> · → después de validar identidad: <code>available-quota/extended</code></div>
        <div v-if="lender.rt === 4" class="tr-hint eng-who">⚠ El alias que la manda acá está en develop, todavía no en main.</div>
      </template>
      <template v-else-if="onlyExtended">
        <div class="tr-hint">En el listado, {{ lender.name }} no lo consulta: contesta su API.</div>
        <div class="tr-hint eng-who">→ después de validar identidad, sí: <code>available-quota/extended</code>. Si la entidad no tiene política «titular extendida», aprueba sin evaluar y sigue a la fecha de pago.</div>
      </template>
      <div v-else class="tr-hint">{{ lender.name }} no lo consulta: {{ who }}.</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
    <Handle id="right" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.node--engine { width: 300px; }
.node--idle { opacity: .55; }
.eng-row { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 2px 0; }
.eng-row span { color: var(--mut); }
.eng-who { margin-top: 6px; }
</style>
