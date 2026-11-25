<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, delegatedOf, setDelegated, bondOf, delegatedBaselineOf, delegatedChanged, resetDelegated, openFieldInfo } from '../store'
import { FileCog, X, RotateCcw } from 'lucide-vue-next'

// Riel 4 · la ficha de originación delegada (`delegated_origination_profiles`) de la entidad ELEGIDA: cómo se arma el
// plan y qué pasa al autorizar. Qué se aprueba lo contesta el servicio de preaprobación, en su nodo.
//
// Lo que se puede cambiar acá es lo que en la tabla es un valor FIJO (los días de pago y el tipo de fianza forzado, y el
// % cuando sale de la tabla del FNG, que Flow simula): sirve para preguntar «¿y si la fila dijera otra cosa?». Las tres
// claves que eligen qué código corre (inputs_source, bond_percentage_source, formalization) son de sólo lectura. Lo que
// se cambió se marca contra lo que vino de qa (`bin/flow import`) y se vuelve a eso con un botón.
const lender = computed(() => findLenderDef(ui.selected))
const d = computed(() => delegatedOf(lender.value))
const bond = computed(() => bondOf(lender.value))
const base = computed(() => delegatedBaselineOf(lender.value))
const changed = (k) => delegatedChanged(lender.value, k)
const anyChanged = computed(() => ['paymentDays', 'bondType', 'bondPct'].some(changed))
const set = (k, v) => setDelegated(lender.value, k, v)

const rows = computed(() => {
  const x = d.value
  return [
    { key: 'inputs_source', value: x.usesQuotaEngine ? 'creditop_x_pre_approval' : 'credifamilia_pre_approval',
      what: x.usesQuotaEngine
        ? 'El cupo lo decide el motor de CreditopX; la tasa sale de su línea de crédito (N.M. → E.A.), el seguro del convenio y la fianza del FGA de la categoría ganadora.'
        : 'Los números los trae la preaprobación de la entidad (su API, por el servicio de preaprobación): tasa, seguro, monto máximo y fianza.' },
    { key: 'formalization', value: x.formalization ? 'credifamilia_radication' : '(ninguna)',
      what: x.formalization
        ? 'Al autorizar: reúne los documentos, arma el PDF unificado y radica por SOAP con la entidad. Si falta un documento o el PDF, no radica.'
        : 'Al autorizar no radica nada: la solicitud termina en el 11 al firmar.' },
  ]
})

// Días de pago: fichas que se quitan con × y un campo para agregar (1 a 31, sin repetir, en orden).
const newDay = ref('')
function addDay() {
  const n = parseInt(newDay.value, 10); newDay.value = ''
  if (!(n >= 1 && n <= 31) || d.value.paymentDays.includes(n)) return
  set('paymentDays', [...d.value.paymentDays, n].sort((a, b) => a - b))
}
function removeDay(n) {
  if (d.value.paymentDays.length <= 1) return // la fila siempre ofrece al menos un día
  set('paymentDays', d.value.paymentDays.filter(x => x !== n))
}
const BOND_TYPES = [['anticipada', 'Anticipada'], ['mensual', 'Vencida'], ['pre_approval', 'NULL · la preaprobación']]
const typeLabel = (t) => (BOND_TYPES.find(([k]) => k === t) || [, t])[1]
const daysLabel = (a) => (a || []).join(' · ')
</script>

<template>
  <div v-if="lender" class="node node--tramo prov-node node--delegated">
    <div class="node__hd node__hd--teal nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.delegated')">
      <div class="node__title"><FileCog :size="13" /> Ficha de originación delegada</div>
      <div class="node__kind">rt=4</div>
    </div>
    <div class="node__body nodrag nowheel" @wheel.stop>
      <div class="dl-who">La fila de <b>{{ lender.name }}</b> en <code>delegated_origination_profiles</code>{{ base ? ' (de qa)' : '' }}</div>

      <div class="dl-sec">Eligen qué código corre · sólo lectura</div>
      <div v-for="r in rows" :key="r.key" class="dl-row">
        <div class="dl-kv"><code>{{ r.key }}</code><b>{{ r.value }}</b></div>
        <div class="dl-what">{{ r.what }}</div>
      </div>

      <div class="dl-sec">Valores fijos · editables</div>

      <div class="dl-edit" :class="{ 'dl-edit--changed': changed('paymentDays') }">
        <div class="dl-kv"><code>payment_days</code></div>
        <div class="dl-days">
          <span v-for="n in d.paymentDays" :key="n" class="dl-day">{{ n }}
            <button v-if="d.paymentDays.length > 1" class="dl-x" :title="'quitar el ' + n" @click.stop="removeDay(n)"><X :size="10" /></button>
          </span>
          <input v-model="newDay" class="dl-add" type="number" min="1" max="31" placeholder="+ día" @keydown.enter.prevent="addDay" @blur="addDay" />
        </div>
        <div v-if="changed('paymentDays')" class="dl-was">editado · en qa: {{ daysLabel(base.paymentDays) }}</div>
      </div>

      <div class="dl-edit" :class="{ 'dl-edit--changed': changed('bondType') }">
        <div class="dl-kv"><code>forced_bond_type</code></div>
        <div class="cat__chips">
          <button v-for="[k, label] in BOND_TYPES" :key="k" class="chip-toggle" :class="{ on: d.bondType === k }" @click.stop="set('bondType', k)">{{ label }}</button>
        </div>
        <div v-if="changed('bondType')" class="dl-was">editado · en qa: {{ typeLabel(base.bondType) }}</div>
      </div>

      <div class="dl-sec">La fianza que resulta</div>
      <div class="dl-row">
        <div class="dl-kv"><code>bond_percentage_source</code><b>{{ d.bondSource }}</b></div>
        <div v-if="d.bondSource === 'fng_table'" class="dl-edit" :class="{ 'dl-edit--changed': changed('bondPct') }">
          <div class="dl-kv"><span class="dl-what">% de la tabla del FNG (Flow no la tiene: se simula)</span>
            <input class="dl-pct" type="number" min="0" step="0.1" :value="d.bondPct" @input="e => set('bondPct', Number(e.target.value))" />
          </div>
          <div v-if="changed('bondPct')" class="dl-was">editado · antes: {{ base.bondPct }} %</div>
        </div>
      </div>
      <div class="dl-bond">
        <b>{{ bond.pct }} % {{ bond.type === 'mensual' ? 'vencida (en cada cuota)' : 'anticipada (financiada)' }}</b>
        <div class="dl-what">el % sale de {{ bond.pctFrom }}; el tipo, de {{ bond.typeFrom }}.
          <template v-if="d.bondSource === 'pre_approval' && d.usesQuotaEngine"> Se cambia en la categoría (FGA).</template>
          <template v-else-if="d.bondSource === 'pre_approval'"> Se dicta en el servicio de preaprobación.</template>
        </div>
      </div>

      <button v-if="anyChanged" class="dl-reset" @click.stop="resetDelegated(lender)"><RotateCcw :size="11" /> Volver a lo de qa</button>
      <div class="tr-hint dl-foot">La lee el backend en dos momentos: ↓ al armar el plan de pagos y → al autorizar.</div>
    </div>
    <Handle id="down" type="source" :position="Position.Bottom" />
    <Handle id="right" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.node--delegated { width: 320px; }
.dl-sec { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: var(--mut); font-weight: 600; margin: 8px 0 4px; }
.dl-what { font-size: 10px; line-height: 1.4; color: var(--fg-2); margin: 2px 0 6px; }
.dl-who { font-size: 10.5px; color: var(--fg-2); margin-bottom: 2px; }
.dl-row { margin-bottom: 6px; }
.dl-kv { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 11px; padding: 2px 0; }
.dl-kv code { color: var(--mut); font-size: 10px; }
.dl-kv b { color: var(--ink); font-weight: 600; text-align: right; }
.dl-edit { margin-bottom: 6px; padding: 2px 6px 4px; margin-left: -6px; margin-right: -6px; border-left: 2px solid transparent; border-radius: 3px; }
.dl-edit--changed { border-left-color: var(--amber); background: color-mix(in srgb, var(--amber) 8%, transparent); }
.dl-was { font-size: 9.5px; color: var(--amber); margin-top: 2px; }
.dl-days { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.dl-day { display: inline-flex; align-items: center; gap: 2px; font-size: 11px; font-weight: 600; color: var(--ink); padding: 1px 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.dl-x { display: inline-flex; padding: 0; border: 0; background: none; color: var(--mut); cursor: pointer; }
.dl-x:hover { color: var(--red); }
.dl-add { width: 54px; font-size: 11px; padding: 1px 4px; }
.dl-pct { width: 60px; font-size: 11px; padding: 1px 4px; text-align: right; }
.dl-bond { padding: 4px 0 2px; font-size: 11.5px; color: var(--ink); }
.dl-reset { display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; margin-top: 4px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--card); color: var(--fg-2); cursor: pointer; }
.dl-reset:hover { color: var(--ink); }
.dl-foot { margin-top: 6px; }
</style>
