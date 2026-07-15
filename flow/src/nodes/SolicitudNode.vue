<script setup>
import { computed, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { state, fieldNull, lenders, ui, money, openFieldInfo, findLenderDef, entidadCfg } from '../store'
import { ClipboardList } from 'lucide-vue-next'
import { useFails } from '../useFails'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Reglas que el lender SELECCIONADO no cumple con la solicitud actual → se resalta el campo en rojo.
const { bad } = useFails()
// Igual que el flujo real: solo se pide el salario declarado si Ágil Data y Mareigua no lo reportan.
const noCentrales = computed(() => fieldNull('agilIncome') && fieldNull('mareiguaIncome'))
// Sin NINGÚN ingreso de central (incl. la estimación Quanto de Experian) → el declarado sería la única fuente.
const sinIngresoCentral = computed(() => noCentrales.value && fieldNull('quantoIncome'))
// El ingreso manual es "Información complementaria" POR ENTIDAD: la entidad elegida debe aceptarlo (Configurar entidad).
const selDef = computed(() => ui.selected ? findLenderDef(ui.selected) : null)
const manualAllowed = computed(() => !selDef.value || entidadCfg(selDef.value).manualIncome)
const needSalary = computed(() => noCentrales.value && manualAllowed.value)
// Sin ninguna central Y la entidad NO acepta ingreso manual → el cliente queda sin ingreso.
const manualBlocked = computed(() => sinIngresoCentral.value && !manualAllowed.value)

// Cuota inicial: la exige el lender elegido (categoría de cupo). Aparece con mínimo = su monto.
const sel = computed(() => lenders.value.find(l => l.name === ui.selected))
// La cuota inicial la EXIGE el lender elegido (config), independiente de que pase o no otras reglas.
const feeReq = computed(() => (sel.value && sel.value.initialFeePct > 0)
  ? { min: sel.value.initialFeeAmount, pct: sel.value.initialFeePct, name: sel.value.name } : null)
watch(() => feeReq.value?.min, (m) => { if (m != null) state.cuotaInicial = m }, { immediate: true })
// La cuota inicial ingresada queda corta vs el mínimo que exige el lender elegido.
const feeShort = computed(() => feeReq.value
  ? (parseInt(String(state.cuotaInicial).replace(/\D/g, '')) || 0) < feeReq.value.min : false)
</script>

<template>
  <div class="node node--sol">
    <Handle type="target" :position="Position.Left" />
    <div class="node__hd nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.solicitud')">
      <div class="node__title"><ClipboardList :size="13" /> Solicitud</div>
      <div class="node__kind">input</div>
    </div>
    <div class="node__body">
      <label class="field" :class="{ 'field--fail': bad('amount') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.monto')">Monto</span>
        <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.monto" /></AffixField>
      </label>
      <template v-if="feeReq">
        <label class="field" :class="{ 'field--fail': feeShort }"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.cuotaInicial')">Cuota inicial</span>
          <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.cuotaInicial" /></AffixField>
        </label>
        <div class="pv-hint" :class="{ 'pv-hint--fail': feeShort }">mínimo {{ money(feeReq.min) }} ({{ feeReq.pct }}% · {{ feeReq.name }})</div>
      </template>
      <template v-if="needSalary">
        <label class="field" :class="{ 'field--fail': bad('monthlyIncome') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.salario')">Salario</span>
          <AffixField prefix="$"><MoneyInput class="afld__in" v-model="state.salario" placeholder="declarado" /></AffixField>
        </label>
        <div class="pv-hint">el buró no reportó ingreso → se declara (info. complementaria)</div>
      </template>
      <div v-else-if="manualBlocked" class="pv-hint pv-hint--warn" @click="openFieldInfo('ent.manual')" title="clic: dónde vive y por qué">
        {{ selDef?.name }} no acepta ingreso manual → sin centrales, sin ingreso
      </div>
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.nombre')">Nombre</span>
        <input class="nodrag" v-model="state.nombre" />
      </label>
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.apellido')">Apellido</span>
        <input class="nodrag" v-model="state.apellido" />
      </label>
      <label class="field" :class="{ 'field--fail': bad('documentTypes') }"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.tipoDoc')">Tipo doc.</span>
        <select class="nodrag" v-model="state.tipoDoc">
          <option>CC</option><option>CE</option><option>PEP</option>
        </select>
      </label>
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.numDoc')">N° documento</span>
        <input class="nodrag" v-model="state.numDoc" inputmode="numeric" />
      </label>
      <label class="field"><span class="fld-doc" title="clic: dónde vive y por qué" @click.prevent.stop="openFieldInfo('sol.fechaExp')">Fecha exped.</span>
        <input class="nodrag" type="date" v-model="state.fechaExp" />
      </label>
    </div>
    <Handle type="source" :position="Position.Right" />
  </div>
</template>
