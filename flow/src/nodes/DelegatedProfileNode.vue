<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, delegatedOf, openFieldInfo } from '../store'
import { FileCog } from 'lucide-vue-next'

// Riel 4 · la ficha de originación delegada (`delegated_origination_profiles`) de la entidad elegida. Arriba del
// hub de perfilamiento: cómo se arma el plan y qué pasa al autorizar. Qué se aprueba lo contesta el servicio de
// preaprobación, en su nodo.
const lender = computed(() => findLenderDef(ui.selected))
const d = computed(() => delegatedOf(lender.value))
// Sólo lectura: es la fila de ESTA entidad. Se cambia por consola (`bin/flow delegated <nombre> …`) o volviéndola a
// importar de la base (`bin/flow import`).
const rows = computed(() => {
  const x = d.value
  return [
    { key: 'inputs_source', value: x.usesQuotaEngine ? 'creditop_x_pre_approval' : 'credifamilia_pre_approval',
      what: x.usesQuotaEngine
        ? 'El cupo lo decide el motor de CreditopX; la tasa sale de su línea de crédito (N.M. → E.A.) y el seguro y el fondo de garantía, del convenio y de la categoría ganadora.'
        : 'Los números los trae la preaprobación de la entidad (su API, por el servicio de preaprobación): tasa, seguro, monto máximo y fianza.' },
    { key: 'bond_percentage_source', value: x.bondSource,
      what: x.bondSource === 'fng_table' ? 'El % de la fianza sale de la tabla del FNG, según el plazo de cada opción de cuotas.' : 'El % de la fianza lo trae la preaprobación.' },
    { key: 'formalization', value: x.formalization ? 'credifamilia_radication' : '(ninguna)',
      what: x.formalization
        ? 'Al autorizar: reúne los documentos, arma el PDF unificado y radica por SOAP con la entidad. Si falta un documento o el PDF, no radica.'
        : 'Al autorizar no radica nada: la solicitud termina en el 11 al firmar.' },
  ]
})
const fixed = computed(() => [
  { key: 'payment_days', value: d.value.paymentDays.join(' · ') },
  { key: 'forced_bond_type', value: d.value.bondType === 'mensual' ? 'Vencida (en cada cuota)' : 'Anticipada (financiada)' },
  { key: '% de fianza', value: d.value.bondPct + ' % (simulado en Flow)' },
])
</script>

<template>
  <div v-if="lender" class="node node--tramo prov-node">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.delegated')">
      <div class="node__title"><FileCog :size="13" /> Ficha de originación delegada</div>
      <div class="node__kind">rt=4</div>
    </div>
    <div class="node__body">
      <div class="dl-who">La fila de <b>{{ lender.name }}</b> en <code>delegated_origination_profiles</code></div>
      <div class="dl-sec">De dónde sale cada cosa</div>
      <div v-for="r in rows" :key="r.key" class="dl-row">
        <div class="dl-kv"><code>{{ r.key }}</code><b>{{ r.value }}</b></div>
        <div class="dl-what">{{ r.what }}</div>
      </div>
      <div class="dl-sec">Valores fijos</div>
      <div v-for="r in fixed" :key="r.key" class="dl-kv"><code>{{ r.key }}</code><b>{{ r.value }}</b></div>
      <div class="tr-hint dl-foot">La lee el backend en dos momentos: ↓ al armar el plan de pagos y → al autorizar.</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
    <Handle id="right" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.dl-sec { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: var(--mut); font-weight: 600; margin: 8px 0 4px; }
.dl-what { font-size: 10px; line-height: 1.4; color: var(--fg-2); margin: 2px 0 6px; }
.dl-who { font-size: 10.5px; color: var(--fg-2); margin-bottom: 2px; }
.dl-row { margin-bottom: 6px; }
.dl-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11px; padding: 2px 0; }
.dl-kv code { color: var(--mut); font-size: 10px; }
.dl-kv b { color: var(--ink); font-weight: 600; text-align: right; }
.dl-foot { margin-top: 6px; }
</style>
