<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, delegatedOf, setDelegated, openFieldInfo } from '../store'
import { FileCog } from 'lucide-vue-next'

// Riel 4 · la ficha de originación delegada (`delegated_origination_profiles`) de la entidad elegida. Arriba del
// hub de perfilamiento: cómo se arma el plan y qué pasa al autorizar. Qué se aprueba lo contesta el servicio de
// preaprobación, en su nodo.
const lender = computed(() => findLenderDef(ui.selected))
const d = computed(() => delegatedOf(lender.value))
const set = (k, v) => setDelegated(lender.value, k, v)
const setDays = (txt) => {
  const days = String(txt).split(/[^0-9]+/).map(Number).filter(n => n >= 1 && n <= 31)
  if (days.length) set('paymentDays', [...new Set(days)].sort((a, b) => a - b))
}
</script>

<template>
  <div v-if="lender" class="node node--tramo prov-node">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.delegated')">
      <div class="node__title"><FileCog :size="13" /> Ficha de originación delegada</div>
      <div class="node__kind">rt=4</div>
    </div>
    <div class="node__body">
      <!-- Las tres columnas que NOMBRAN una lógica: la tabla guarda el nombre y el backend lo traduce a una clase. -->
      <div class="dl-sec">De dónde sale cada cosa</div>
      <label class="field dl-pick"><span><code>inputs_source</code> · los números del plan</span>
        <select class="nodrag" :value="d.usesQuotaEngine ? 'creditop_x_pre_approval' : 'credifamilia_pre_approval'" @change="e => set('usesQuotaEngine', e.target.value === 'creditop_x_pre_approval')">
          <option value="creditop_x_pre_approval">creditop_x_pre_approval</option>
          <option value="credifamilia_pre_approval">credifamilia_pre_approval</option>
        </select>
      </label>
      <div class="dl-what">{{ d.usesQuotaEngine
        ? 'CreditopXPreApprovalInputs: el cupo lo decide el motor de CreditopX; la tasa sale de su línea de crédito (N.M. → E.A.) y el seguro y el fondo de garantía, del convenio y de la categoría. Fianza anticipada. (Finandina)'
        : 'CredifamiliaPreApprovalInputs: le pide a pre-approvals-service la preaprobación de la entidad; tasa, seguro, monto máximo y fianza los trae su API. (Credifamilia)' }}</div>

      <label class="field dl-pick"><span><code>bond_percentage_source</code> · el % de la fianza</span>
        <select class="nodrag" :value="d.bondSource" @change="e => set('bondSource', e.target.value)">
          <option value="pre_approval">pre_approval</option>
          <option value="fng_table">fng_table</option>
        </select>
      </label>
      <div class="dl-what">{{ d.bondSource === 'fng_table'
        ? 'La tabla del FNG, según el plazo: cada opción de cuotas lleva su propio %. (Credifamilia Materiales)'
        : 'Lo trae la preaprobación (guarantee_percentage). (Credifamilia Salud, Finandina)' }}</div>

      <label class="field dl-pick"><span><code>formalization</code> · al autorizar</span>
        <select class="nodrag" :value="d.formalization ? 'credifamilia_radication' : ''" @change="e => set('formalization', e.target.value === 'credifamilia_radication')">
          <option value="">(ninguna)</option>
          <option value="credifamilia_radication">credifamilia_radication</option>
        </select>
      </label>
      <div class="dl-what">{{ d.formalization
        ? 'CredifamiliaFormalizationService: reúne los documentos, arma el PDF unificado (pdf-mapper) y radica por SOAP. Si falta un documento o el PDF, no radica (422).'
        : 'Sin formalización: no radica nada y la solicitud termina en el 11 al firmar. (Finandina)' }}</div>

      <div class="dl-sec">Valores fijos</div>
      <label class="field dl-pick"><span><code>payment_days</code> · los días que se ofrecen</span>
        <input class="nodrag" :value="d.paymentDays.join(', ')" @change="e => setDays(e.target.value)" />
      </label>
      <label class="field dl-pick"><span><code>forced_bond_type</code> · pisa el tipo que traiga la preaprobación</span>
        <select class="nodrag" :value="d.bondType" @change="e => set('bondType', e.target.value)">
          <option value="anticipada">Anticipada (se financia con el crédito)</option>
          <option value="mensual">Vencida (se cobra en cada cuota)</option>
        </select>
      </label>
      <label class="field"><span>% de fianza <i class="dl-sim">simulado</i></span>
        <input class="nodrag" type="number" min="0" step="0.5" :value="d.bondPct" @input="e => set('bondPct', Number(e.target.value))" />
      </label>
      <div class="tr-hint">La lee el backend en dos momentos: ↓ al armar el plan de pagos (los números, los días y la fianza) y → al autorizar (la formalización). Tabla <code>delegated_origination_profiles</code>.</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
    <Handle id="right" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.dl-check { display: flex; align-items: flex-start; gap: 8px; flex-direction: row; margin: 6px 0; }
.dl-check input { flex: none; width: auto; margin-top: 2px; }
.dl-check span { flex: 1; min-width: 0; text-align: left; white-space: normal; width: auto; line-height: 1.35; }
.dl-sec { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: var(--mut); font-weight: 600; margin: 8px 0 4px; }
.dl-pick { flex-direction: column !important; align-items: stretch !important; gap: 3px !important; }
.dl-pick > span { text-align: left; width: auto; }
.dl-what { font-size: 10px; line-height: 1.4; color: var(--fg-2); margin: 2px 0 6px; }
.dl-sim { font-style: normal; color: var(--mut); font-size: 9px; }
</style>
