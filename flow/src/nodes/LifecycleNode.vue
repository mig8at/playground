<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, postSelVal, setPostSel, postSelApplies, postSelSteps, creditStatus, cuotaBreakdown, lenders, money, openFieldInfo, RT_LABEL } from '../store'
import { Workflow, Check, X, Minus } from 'lucide-vue-next'

// Formalización DESPUÉS de elegir (estado 3) como UN nodo tipo "GitHub Actions": un paso por fila,
// círculo de estado a la izquierda unidos por una línea vertical. Tocar el círculo hace fallar ese
// paso (o cicla sus opciones); la cascada se recalcula (verde pasa · rojo corta · gris no se alcanza).
// Solo se muestran los pasos del rt del lender seleccionado. El estado final vive en el nodo de al lado.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const rtLabel = computed(() => RT_LABEL[lender.value?.rt] ?? '') // RT_LABEL unificado, importado de store.js

const STEP_META = {
  plan:     { title: 'Plan de pagos',             opts: [{ v: 'elige', l: 'define plan' }] },
  kyc:      { title: 'KYC · biométrico (ADO)',    opts: [{ v: 'valida', l: 'valida' }, { v: 'no valida', l: 'no valida' }] },
  firma:    { title: 'Firma del pagaré',          opts: [{ v: 'firma', l: 'firma' }, { v: 'abandona', l: 'abandona' }] },
  enganche: { title: 'Cobro del enganche',        opts: [{ v: 'paga', l: 'paga' }, { v: 'falla', l: 'falla' }] },
  radica:   { title: 'Radicación',                opts: [{ v: 'radica', l: 'radica' }, { v: 'falla', l: 'falla' }] },
  decision: { title: 'Decisión externa (su API)', opts: [{ v: 'aprueba', l: 'aprueba' }, { v: 'rechaza', l: 'rechaza' }, { v: 'timeout', l: 'timeout' }] },
  redirect: { title: 'Redirección',               opts: [{ v: 'abre', l: 'abre el sitio' }] },
}
const steps = computed(() => lender.value ? postSelSteps(lender.value.rt).map(s => s.key) : [])
const st = computed(() => name.value ? creditStatus(name.value) : null)
const order = computed(() => steps.value)
const failIdx = computed(() => st.value?.failedAt ? order.value.indexOf(st.value.failedAt) : -1)

const applies = (key) => name.value ? postSelApplies(name.value, key) : true
const valOf = (key) => name.value ? postSelVal(name.value, key) : ''
const labelOf = (key) => { const o = STEP_META[key]?.opts.find(o => o.v === valOf(key)); return o ? o.l : valOf(key) }
function stepState(key) {
  if (!applies(key)) return 'skip'
  const i = order.value.indexOf(key), f = failIdx.value
  if (f === -1 || i < f) return 'pass'
  if (i === f) return 'fail'
  return 'blocked'
}
// Clickable solo los pasos alcanzados con >1 opción (los alcanzados: pass/fail). Se arregla la cadena
// clicando el paso rojo; los pasos bloqueados/saltados no son interactivos (como en GitHub Actions).
const clickable = (key) => STEP_META[key]?.opts.length > 1 && ['pass', 'fail'].includes(stepState(key))
function cycle(key) {
  if (!clickable(key)) return
  const opts = STEP_META[key].opts, cur = valOf(key)
  const i = opts.findIndex(o => o.v === cur)
  setPostSel(name.value, key, opts[(i + 1) % opts.length].v)
}

// Refuerzo del lazo con la categoría: cuota ya ensamblada (se muestra bajo el paso "Plan de pagos").
const row = computed(() => lenders.value.find(x => x.name === name.value) || null)
const cuotaPlan = computed(() => { const r = row.value; return (r && r.dues && r.dues.length) ? cuotaBreakdown(lender.value, r.dues[0]).cuota : 0 })
</script>

<template>
  <div v-if="lender" class="node node--lifecycle prov-node">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: qué pasa después de elegir (formalización)" @click="openFieldInfo('node.lifecycle')">
      <div class="node__title"><Workflow :size="13" /> Formalización</div>
      <span class="pl-cat">{{ rtLabel }}</span>
    </div>
    <div class="node__body">
      <div class="lc-hint">tocá el círculo de un paso para simular que falla</div>
      <div class="lc-steps">
        <div v-for="key in steps" :key="key" class="lc-step" :class="'lc--' + stepState(key)">
          <span class="lc-rail">
            <button class="lc-bullet nodrag" :class="{ 'lc-bullet--click': clickable(key) }" :disabled="!clickable(key)"
                    :title="clickable(key) ? 'clic: alternar (simula que falla)' : (stepState(key) === 'skip' ? 'no aplica a este caso' : (stepState(key) === 'blocked' ? 'no se alcanza (un paso previo falló)' : 'paso sin fallo posible'))"
                    @click.stop="cycle(key)">
              <Check v-if="stepState(key) === 'pass'" :size="11" />
              <X v-else-if="stepState(key) === 'fail'" :size="11" />
              <Minus v-else-if="stepState(key) === 'skip'" :size="11" />
            </button>
          </span>
          <div class="lc-txt">
            <span class="lc-name fld-doc" title="clic: dónde vive y por qué" @click.stop="openFieldInfo('psel.' + key)">{{ STEP_META[key].title }}</span>
            <span class="lc-opt">{{ stepState(key) === 'skip' ? 'se salta' : labelOf(key) }}</span>
            <span v-if="key === 'plan' && cuotaPlan" class="lc-cuota">cuota ≈ {{ money(cuotaPlan) }}/mes</span>
          </div>
        </div>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
