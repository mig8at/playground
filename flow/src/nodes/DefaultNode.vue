<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, findLenderDef, entidadCfg, setEntidadProducto, setEntidadMonto, setEntidadRate, setEntidadDues, setEntidad, setEntidadAbaco, openFieldInfo, montoVsEntidad } from '../store'
import { Building2, X } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Config de lender (nivel 0) = lo que edita el admin en "Editar entidad": producto + economía.
// Las reglas de riesgo NO viven acá (están por sucursal en Configurar sucursal). El rango de Monto se
// pinta rojo SOLO si el monto pedido queda fuera de ESTE rango (no por el cupo/comercio — eso es de otro nivel).
const lender = computed(() => findLenderDef(ui.selected))
const PRODUCTOS = [{ key: 'credito', label: 'Crédito' }, { key: 'renting', label: 'Renting' }, { key: 'rto', label: 'Renting con compra' }]
const prodVal = computed(() => lender.value?.producto || lender.value?.product || 'credito')
// Header teñido por response_type: rt1 ámbar · rt0 azul · rt2/rt3 morado (default).
const hdClass = computed(() => { const rt = lender.value?.rt; return rt === 1 ? 'node__hd--amber' : rt === 0 ? 'node__hd--blue' : '' })
const econ = computed(() => entidadCfg(lender.value))
const montoBad = computed(() => { const e = econ.value; return !!e && e.amountMax > 0 && e.amountMin > e.amountMax })
const who = computed(() => lender.value ? lender.value.name : '')
</script>

<template>
  <div class="node node--default prov-node">
    <div class="node__hd nhd-doc" :class="hdClass" title="clic: detalle del nodo" @click="openFieldInfo('node.default')">
      <div class="node__title"><Building2 :size="13" /> Configurar entidad</div>
      <button class="prov__x nodrag" @click.stop="ui.selected = null" title="cerrar la ficha (también: Esc, o re-clic en la tarjeta)" aria-label="cerrar"><X :size="14" /></button>
    </div>
    <div class="node__body" v-if="econ">
      <div class="node__desc"><b>{{ who }}</b> — producto y economía</div>
      <!-- Config de entidad: lo que HOY edita el admin en "Editar entidad" (tabla lenders) -->
      <div class="pl-sec">Config de entidad <span class="pl-hint">· admin · editable</span></div>
      <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('ent.producto')">Producto</span>
        <select class="nodrag ent-in" :value="prodVal" @change="e => setEntidadProducto(lender, e.target.value)">
          <option v-for="p in PRODUCTOS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
      </div>
      <div class="ent-row" :class="{ 'ent-row--fail': montoVsEntidad(ui.selected) }"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('ent.monto')">Monto</span>
        <AffixField prefix="$" class="afld--mny"><MoneyInput class="afld__in" :model-value="econ.amountMin" @update:model-value="v => setEntidadMonto(lender, 'min', v)" /></AffixField>
        <span class="ent-u">–</span>
        <AffixField prefix="$" class="afld--mny"><MoneyInput class="afld__in" :model-value="econ.amountMax" @update:model-value="v => setEntidadMonto(lender, 'max', v)" /></AffixField>
      </div>
      <div v-if="montoBad" class="ent-warn">⚠ el mínimo es mayor que el máximo</div>
      <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('ent.dues')">Nº de cuotas</span>
        <input class="nodrag ent-in" :value="econ.dues.join(', ')" @change="e => setEntidadDues(lender, e.target.value)" />
      </div>
      <div class="ent-row"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('ent.tasa')">Tasa</span>
        <AffixField suffix="% M.V." class="afld--rate"><input class="nodrag afld__in" type="number" step="0.01" :value="econ.rate" @input="e => setEntidadRate(lender, e.target.value)" /></AffixField>
      </div>
      <div class="ent-row ent-row--flag"><span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('ent.abaco')">Info. complementaria · Ábaco</span>
        <label class="ent-toggle nodrag" :title="econ.abacoExtra ? 'Ábaco activo: pide ingreso extra gig en el nodo Información complementaria' : 'Ábaco inactivo para esta entidad'">
          <input type="checkbox" :checked="econ.abacoExtra" @change="e => setEntidadAbaco(lender, e.target.checked)" />
          <span>{{ econ.abacoExtra ? 'activo' : 'inactivo' }}</span>
        </label>
      </div>
      <div class="ent-row cfg-servicing"><span class="fld-doc" title="clic: por qué NO baja la cuota de la oferta" @click="openFieldInfo('ent.condonadas')">Cuotas condonadas <span class="fld-tag fld-tag--servicing">servicing</span></span>
        <AffixField suffix="cuotas" class="afld--cuo"><input class="nodrag afld__in" type="number" :value="econ.condonedDues" @input="e => setEntidad(lender, 'condonedDues', e.target.value)" /></AffixField>
      </div>
      <div class="ent-row cfg-servicing"><span class="fld-doc" title="clic: por qué no toca la oferta (es servicing)" @click="openFieldInfo('ent.mora')">Tasa de mora <span class="fld-tag fld-tag--servicing">servicing</span></span>
        <AffixField suffix="%" class="afld--pct"><input class="nodrag afld__in" type="number" step="0.01" :value="econ.lateRate" @input="e => setEntidad(lender, 'lateRate', e.target.value)" /></AffixField>
      </div>
    </div>
    <Handle id="tocat" type="source" :position="Position.Right" />
    <Handle id="toperf" type="source" :position="Position.Left" />
  </div>
</template>
