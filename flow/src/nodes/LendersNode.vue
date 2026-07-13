<script setup>
import { reactive } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { lenders, availableCount, merchant, ui, money, cuotaBreakdown, openFieldInfo } from '../store'
// Los datos de la tarjeta también abren el sidebar (clic) — mismo mecanismo que el resto de labels.
import { Check, X, ListChecks } from 'lucide-vue-next'

const RT = { 0: 'redirect', 1: 'agregador', 2: 'CreditopX', 3: 'rotativo' }
const rtLabel = (rt) => RT[rt] || ('rt' + rt)
// Resaltado del seleccionado con el color de su response_type (mismo mapa que los chips rt):
// rt2 CreditopX = morado · rt1 agregador = amarillo · rt0 redirect = azul. Usa variables del tema.
const RT_VAR = { 0: 'var(--blue)', 1: 'var(--amber)', 2: 'var(--purple)', 3: 'var(--purple)' }
const selStyle = (l) => ui.selected === l.name
  ? { boxShadow: 'inset 3px 0 0 ' + (RT_VAR[l.rt] || 'var(--green)'), borderColor: 'color-mix(in srgb, ' + (RT_VAR[l.rt] || 'var(--green)') + ' 45%, transparent)' }
  : null

// Plazo (nº de cuotas) elegido por lender en el marketplace. Default = primera opción de su lista.
// Clamp: si la categoría/tramo recortó los plazos y el elegido ya no existe, cae al primero disponible
// (antes el select quedaba vacío y la cuota estimada usaba un plazo viejo).
const plazos = reactive({})
const plazo = (l) => {
  const p = plazos[l.name]
  return (p != null && l.dues && l.dues.includes(p)) ? p : ((l.dues && l.dues[0]) ?? 0)
}
const setPlazo = (l, v) => { plazos[l.name] = Number(v) }
// Cuota mensual: ensamblado real (capital + costos admin + castigo + fondo garantías·IVA, luego
// anualidad + seguros) desde la calculadora del comercio. Ver cuotaBreakdown en el store.
const cuota = (l, n) => cuotaBreakdown(l, n).cuota
const cuotaTip = (l, n) => {
  const b = cuotaBreakdown(l, n)
  return `Financiado ${money(b.financiado)} + admin ${money(b.admin)} + fondo gar. ${money(b.fga)} = capital ${money(b.capital)}; anualidad(tasa, plazo) + seguros ${money(b.seguros)}.`
}
</script>

<template>
  <div class="node node--lenders">
    <Handle type="target" :position="Position.Left" />
    <Handle id="top" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.out')">
      <div>
        <div class="node__title"><ListChecks :size="13" /> Entidades disponibles</div>
        <div class="node__kind" style="color:#3B6D11">{{ merchant.nombre }} · {{ merchant.sucursal }}</div>
      </div>
      <div class="badge">{{ availableCount }}</div>
    </div>
    <div class="node__body">
      <div v-if="!lenders.length" class="lenders-empty">
        sin entidades — creá una con “+ Agregar entidad” en “Entidades del comercio”
      </div>
      <div v-else-if="!ui.selected" class="lenders-hint">clic en una entidad → ver sus reglas</div>
      <div v-for="l in lenders" :key="l.name" class="lender nodrag"
           :class="{ 'lender--off': !l.ok, 'lender--sel': ui.selected === l.name }"
           :style="selStyle(l)"
           @click.stop="ui.selected = ui.selected === l.name ? null : l.name" :title="ui.selected === l.name ? 'clic: cerrar la ficha' : 'clic: ver/editar la config de esta entidad'">
        <Handle :id="'psel-' + l.name" type="source" :position="Position.Right" class="lender-h" />
        <div class="lender__top">
          <span class="lender__mk" :class="l.ok ? (l.prob === 'baja' ? 'lowp' : 'ok') : 'no'"><Check v-if="l.ok" :size="13" /><X v-else :size="13" /></span>
          <span class="lender__nm">{{ l.name }}</span>
          <span class="lender__rt fld-doc" :class="'rt' + l.rt" title="clic: quién decide según el tipo" @click.stop="openFieldInfo('mk.rt')">{{ rtLabel(l.rt) }}</span>
          <span v-if="l.ok && l.prob === 'baja'" class="lender__low fld-doc" :title="l.reason + ' — clic: por qué no se excluye'" @click.stop="openFieldInfo('mk.prob')">prob. baja</span>
        </div>
        <div v-if="l.ok" class="lender__facts">
          <span class="fld-doc" title="clic: de dónde sale el cupo" @click.stop="openFieldInfo('mk.cupo')">{{ l.rt === 2 ? 'cupo ' : '' }}{{ money(l.rt === 2 ? l.cupo : l.amountMax) }}{{ l.rt === 2 ? '' : ' máx' }}</span>
          <span v-if="l.rt === 2 && l.category" class="lender__cat fld-doc" title="clic: qué es la categoría" @click.stop="openFieldInfo('mk.cat')">cat. {{ l.category }}</span>
          <span v-if="l.rate" class="fld-doc" title="clic: de dónde sale la tasa" @click.stop="openFieldInfo('ent.tasa')">{{ l.rate }}%</span>
          <span v-if="l.initialFeePct > 0" class="fee fld-doc" title="clic: quién exige el enganche" @click.stop="openFieldInfo('mk.inicial')">inicial {{ money(l.initialFeeAmount) }}</span>
        </div>
        <div v-if="l.ok && l.prob === 'baja'" class="lender__rs lender__rs--low" title="rt≠2: la 2ª capa no excluye, solo reordena al fondo (probabilidad muy baja).">{{ l.reason }}</div>
        <div v-if="l.ok && l.dues && l.dues.length" class="lender__plazo nodrag" @click.stop>
          <select class="nodrag" :value="plazo(l)" @change="e => setPlazo(l, e.target.value)" title="Plazo: número de cuotas elegido para estimar la cuota mensual.">
            <option v-for="n in l.dues" :key="n" :value="n">{{ n }} cuotas</option>
          </select>
          <span class="lender__cuota fld-doc" :title="cuotaTip(l, plazo(l)) + ' — clic: cómo se arma'" @click.stop="openFieldInfo('mk.cuota')">≈ {{ money(cuota(l, plazo(l))) }}/mes</span>
        </div>
        <div v-else-if="!l.ok" class="lender__rs">{{ l.reason }}</div>
      </div>
    </div>
  </div>
</template>
