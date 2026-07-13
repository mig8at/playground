<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { merchant, ui, calcValue, calcInherit, setCalc, resetCalc, openFieldInfo, montoVsComercio, findLenderDef } from '../store'
import { Calculator } from 'lucide-vue-next'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

// Nivel 1 · Comercio (negocio): la calculadora económica, EDITABLE. Cada campo hereda de un PADRE; al
// editarlo se crea un override que lo PISA (dot amarillo). Clic en el dot → hereda de nuevo (dot gris).
//  · Monto máx → hereda del RANGO de la entidad (credit_line_by_lenders.max_amount), su padre real.
//  · el resto de la calculadora → hereda de la base de la familia (no tienen padre en la entidad).
// Clasificación por "¿participa en la solicitud y quién paga?" (ver DOCUMENTATION.md):
//  · (sin flag)  = DECIDE el cupo (Monto máx del comercio).
//  · cuota:true  = lo paga el CLIENTE financiado: entra en la cuota (acento teal), siempre visible.
//  · biz:true    = cobro al COMERCIO (comisión), fuera de la solicitud. Toggle "Cobros al comercio".
// El ENGANCHE (cuota inicial) NO vive acá: lo decide la categoría de perfilamiento (rt=2), ver nodo
// Perfilamiento. Se quitaron IVA / castigo / múltiplo del ingreso: el código real no los usa (fantasmas).
const FIELDS = [
  { key: 'montoMax', label: 'Monto máx', unit: '$', sep: true, desc: 'max_amount@lenders_by_allieds — HEREDA del rango de la entidad (credit_line_by_lenders); el comercio puede pisarlo hacia abajo. Para rt=2 la categoría de perfilamiento puede topar aún más.' },
  { key: 'cargoFijo', cuota: true, label: 'Cargo administrativo fijo', unit: '$', sep: true, desc: 'administrative_fixed_value — costo fijo en $ que paga el CLIENTE financiado. Se suma al capital → sube la cuota.' },
  { key: 'costosAdmin', cuota: true, label: 'Costos administrativos', unit: '%', desc: 'administrative_costs_percentage — % del monto que paga el CLIENTE. Se suma al capital → sube la cuota.' },
  { key: 'fondoGarantias', cuota: true, label: 'Fondo de garantías', unit: '%', desc: 'guarantee_fund_percentage — colchón anti-impago (con IVA 19%). Se suma al capital → sube la cuota. Override por categoría.' },
  { key: 'seguroVidaVar', cuota: true, label: 'Seguro de vida (variable)', unit: '%', desc: 'life_insurance_percentage — prima que paga el CLIENTE: % que se suma a la cuota mensual.' },
  { key: 'seguroVidaFijo', cuota: true, label: 'Seguro de vida (fijo)', unit: '$', sep: true, desc: 'life_insurance_fixed — prima fija mensual que paga el CLIENTE: se suma a la cuota.' },
  { key: 'comision', biz: true, label: 'Comisión', unit: '%', desc: 'comission_percentage — lo que CreditOp le cobra al COMERCIO (%·final_amount), después de originar. Fuera de la solicitud.' },
]
// Campos que el admin PIDE pero el cálculo real ignora (muerto) o pisa antes de usar (pisado).
// Atenuados + no editables; clic → sidebar con la causa (fieldDocs.js, verificado contra el código).
const DEAD = [
  { key: 'cuotaInicial', label: 'Cuota inicial', unit: '%', dead: 'pisado', docKey: 'calc.cuotaInicial' },
  { key: 'iva', label: 'IVA', unit: '%', dead: 'muerto', docKey: 'calc.iva' },
  { key: 'castigo', label: 'Castigo / gastos', unit: '%', dead: 'muerto', docKey: 'calc.castigo' },
  { key: 'multiploIngreso', label: 'Múltiplo del ingreso', unit: '×', dead: 'muerto', docKey: 'calc.multiplo' },
]
const deadTag = { muerto: 'no se usa', pisado: 'se pisa' }
const c = computed(() => merchant.nombre)
const selLender = computed(() => findLenderDef(ui.selected)) // Monto máx hereda del rango de ESTA entidad
const val = (k) => calcValue(c.value, k, selLender.value)
const inh = (k) => calcInherit(c.value, k)
function onInput(k, raw) { const n = Number(String(raw).replace(/[^\d.]/g, '')); if (!isNaN(n)) setCalc(c.value, k, n) }
function heredar(k) { resetCalc(c.value, k) }
// De quién hereda cada campo: Monto máx del rango de la entidad; el resto, de la base de la familia.
const parentLabel = (k) => k === 'montoMax' ? 'del rango de la entidad' : 'de la base de la familia'
</script>

<template>
  <div class="node node--comercio prov-node">
    <Handle id="in" type="target" :position="Position.Right" />
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.comercioConfig')">
      <div class="node__title"><Calculator :size="13" /> Configurar comercio</div>
      <span class="pl-cat pl-cat--blue">nivel 1</span>
    </div>
    <div class="node__body">
      <div class="node__desc"><b>{{ ui.selected }}</b> en {{ c }} — calculadora económica</div>
      <div class="dr-scroll nowheel nodrag">
        <div v-for="f in FIELDS" :key="f.key" class="dr dr--row" :class="{ 'dr--on': inh(f.key) === 'editada', 'cfg-biz': f.biz, 'dr--fail': f.key === 'montoMax' && montoVsComercio() }">
          <div class="dr-top">
            <button class="dr-dot nodrag" :class="'dot-' + inh(f.key)" :disabled="inh(f.key) !== 'editada'"
                    :title="(inh(f.key) === 'editada' ? 'editado — clic para heredar ' : 'heredado ') + parentLabel(f.key)"
                    @click="heredar(f.key)"></button>
            <span class="dr-l fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('calc.' + f.key)">{{ f.label }}</span>
          </div>
          <span class="dr-c">
            <AffixField v-if="f.sep" prefix="$" class="afld--dr"><MoneyInput class="afld__in" :model-value="val(f.key)" @update:model-value="v => setCalc(c, f.key, v)" /></AffixField>
            <AffixField v-else :suffix="f.unit" class="afld--drn"><input class="nodrag afld__in" type="number" :value="val(f.key)" @input="e => onInput(f.key, e.target.value)" /></AffixField>
          </span>
        </div>
        <!-- Campos del admin que NO tienen efecto (atenuados; clic = por qué) -->
        <div class="cfg-sub cfg-sub--extra" style="margin-top:9px">Campos del admin sin efecto <span class="pl-hint">· clic = por qué</span></div>
        <div v-for="f in DEAD" :key="f.key" class="dr dr--row fld-dead nodrag" @click="openFieldInfo(f.docKey)"
             :title="'clic: por qué ' + deadTag[f.dead]">
          <div class="dr-top">
            <span class="dr-l">{{ f.label }}</span>
            <span class="fld-tag" :class="'fld-tag--' + f.dead">{{ deadTag[f.dead] }}</span>
          </div>
          <span class="dr-c"><span class="fld-val">{{ val(f.key) }}{{ f.unit }}</span></span>
        </div>
      </div>
    </div>
  </div>
</template>
