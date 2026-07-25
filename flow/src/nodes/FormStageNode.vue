<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, postSelVal, setPostSel, postSelApplies, postSelSteps, creditStatus, openFieldInfo } from '../store'
import { Check, X, Minus } from 'lucide-vue-next'

// UN nodo por ETAPA de la formalización externa/redirect (rt=1 agregador · rt=0 redirect). El flujo
// in-platform (CreditopX rt=2) se modela con nodos propios en App.vue, no con estas etapas.
// El estado (pass/fail/blocked/skip) lo deriva creditStatus(); tocar el círculo simula que ese paso falla.
const props = defineProps({ id: { type: String, default: '' }, data: { type: Object, default: () => ({}) } })
const stepKey = computed(() => props.data?.stepKey)
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))

const STEP_META = {
  radica:   { title: 'Radicación',                     opts: [{ v: 'radica', l: 'radica' }, { v: 'falla', l: 'falla' }] },
  decision: { title: 'Decisión externa (su API)',      opts: [{ v: 'aprueba', l: 'aprueba' }, { v: 'rechaza', l: 'rechaza' }, { v: 'timeout', l: 'timeout' }] },
  redirect: { title: 'Redirección',                    opts: [{ v: 'abre', l: 'abre el sitio' }] },
}
const meta = computed(() => STEP_META[stepKey.value] || { title: stepKey.value, opts: [] })

const order = computed(() => lender.value ? postSelSteps(lender.value.rt).map(s => s.key) : [])
const st = computed(() => name.value ? creditStatus(name.value) : null)
const failIdx = computed(() => st.value?.failedAt ? order.value.indexOf(st.value.failedAt) : -1)
const applies = computed(() => name.value ? postSelApplies(name.value, stepKey.value) : true)
const state = computed(() => {
  if (!applies.value) return 'skip'
  const i = order.value.indexOf(stepKey.value), f = failIdx.value
  if (f === -1 || i < f) return 'pass'
  if (i === f) return 'fail'
  return 'blocked'
})
const valOf = computed(() => name.value ? postSelVal(name.value, stepKey.value) : '')
const labelOf = computed(() => meta.value.opts.find(o => o.v === valOf.value)?.l ?? valOf.value)
const clickable = computed(() => meta.value.opts.length > 1 && ['pass', 'fail'].includes(state.value))
function cycle() {
  if (!clickable.value) return
  const opts = meta.value.opts, i = opts.findIndex(o => o.v === valOf.value)
  setPostSel(name.value, stepKey.value, opts[(i + 1) % opts.length].v)
}

const bulletTitle = computed(() =>
  clickable.value ? 'clic: alternar (simula que falla)'
  : state.value === 'skip' ? 'no aplica a este caso'
  : state.value === 'blocked' ? 'no se alcanza (un paso previo falló)'
  : 'paso sin fallo posible')
</script>

<template>
  <div v-if="lender" class="node node--formstage prov-node" :class="'lc--' + state">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('psel.' + stepKey)">
      <div class="node__title">{{ meta.title }}</div>
    </div>
    <div class="node__body fstage-body">
      <button class="lc-bullet nodrag" :class="{ 'lc-bullet--click': clickable }" :disabled="!clickable" :title="bulletTitle" @click.stop="cycle">
        <Check v-if="state === 'pass'" :size="12" />
        <X v-else-if="state === 'fail'" :size="12" />
        <Minus v-else-if="state === 'skip'" :size="12" />
      </button>
      <div class="fstage-txt">
        <span class="lc-opt">{{ state === 'skip' ? 'se salta' : labelOf }}</span>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
