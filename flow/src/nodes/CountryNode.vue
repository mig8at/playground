<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import {
  merchant, customLenders, COUNTRIES, countryById, entidadCfg, paisMatch,
  setMerchantPais, setSucursalPais, setEntidadPais, openFieldInfo, ui, RT_LABEL,
} from '../store'
import { Globe } from 'lucide-vue-next'

// Nivel 0 · PAÍS. Modela lo que HOY es "país" en CreditOp, con su estado real (ver el bloque
// PAÍS en store.js, verificado contra main + BD local):
//  · comercio  → allieds.country_id: el ÚNICO que el flujo usa (gate `alliedCountry === 60`).
//  · sucursal  → PROPUESTO: la columna no existe en allied_branches; hoy hereda del comercio.
//  · entidad   → lenders.country_id: existe pero el listado filtra por el literal 1 → no se lee.
// La sección de entidades muestra la regla que el admin NO valida: cablear en una sucursal una
// entidad de otro país. No se bloquea nada acá — el nodo es fiel, y hoy el sistema lo permite.
const PROD = { credito: 'Crédito', renting: 'Renting', rto: 'Renting con compra' }
const REAL = computed(() => COUNTRIES.filter(c => !c.bogus))
const comercioPais = computed(() => countryById(merchant.paisId))
const sucursalPais = computed(() => countryById(merchant.sucursalPaisId))
// La sucursal "hereda" mientras su país sea el mismo del comercio (hoy es lo único posible).
const hereda = computed(() => merchant.sucursalPaisId === merchant.paisId)

// Config del país tal como está en la tabla `countries` + qué la lee de verdad.
const CFG = computed(() => {
  const c = sucursalPais.value
  return [
    { key: 'pais.dial', label: 'Prefijo telefónico', val: c?.dial ? '+' + c.dial : '—', tag: 'muerto' },
    { key: 'pais.phoneLen', label: 'Longitud del celular', val: c?.phoneLen ? c.phoneLen + ' dígitos' : '—', tag: 'muerto' },
    { key: 'pais.docTypes', label: 'Tipos de documento', val: c?.docTypes?.length ? c.docTypes.join(' · ') : '—', tag: 'pisado' },
    { key: 'pais.locale', label: 'Idioma / locale', val: c?.locale || '—', tag: 'display' },
    { key: 'pais.currency', label: 'Moneda', val: c?.currency || '—', tag: 'display' },
  ]
})
const TAG = { muerto: 'no se usa', pisado: 'fuera de main', display: 'solo formatea' }

const entities = computed(() => [...customLenders])
const conflicto = computed(() => entities.value.filter(l => paisMatch(l) !== 'ok').length)
const MATCH_TITLE = {
  ok: 'mismo país que la sucursal',
  sinPais: 'la entidad quedó en el default 1: la regla de país no se puede evaluar',
  otro: 'país distinto al de la sucursal — hoy se cablea igual, sin error',
}
</script>

<template>
  <div class="node node--country prov-node">
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo (qué es país hoy)" @click="openFieldInfo('node.country')">
      <div class="node__title"><Globe :size="13" /> País</div>
      <span class="pl-cat pl-cat--gray">nivel 0</span>
    </div>
    <div class="node__body">
      <div class="dn-hint">
        Hoy “país” son <b>tres columnas distintas</b> y solo una manda: la del <b>comercio</b>.
        La de la <b>sucursal</b> no existe y la de la <b>entidad</b> no se lee.
      </div>

      <!-- Comercio: allieds.country_id (real, lo usa el flujo) -->
      <div class="dr dr--row">
        <div class="dr-top">
          <span class="dr-l fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('pais.comercio')">País del comercio</span>
          <span class="fld-tag fld-tag--decide">decide</span>
        </div>
        <span class="dr-c">
          <select class="nodrag cn-sel" :value="merchant.paisId" @change="e => setMerchantPais(e.target.value)">
            <option v-for="c in REAL" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </span>
      </div>

      <!-- Sucursal: columna PROPUESTA (allied_branches no la tiene) -->
      <div class="dr dr--row" :class="{ 'dr--on': !hereda }">
        <div class="dr-top">
          <span class="dr-l fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('pais.sucursal')">País de la sucursal</span>
          <span class="fld-tag fld-tag--pisado">propuesto</span>
        </div>
        <span class="dr-c">
          <select class="nodrag cn-sel" :value="merchant.sucursalPaisId" @change="e => setSucursalPais(e.target.value)">
            <option v-for="c in REAL" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </span>
      </div>
      <div v-if="hereda" class="cn-note">Hereda del comercio — es lo <b>único</b> posible hoy: <code>allied_branches</code> no tiene columna de país.</div>
      <div v-else class="cn-note cn-note--warn">
        <b>{{ merchant.sucursal }}</b> operaría en {{ sucursalPais?.name }} mientras el comercio reporta en
        {{ comercioPais?.name }}. Hoy el flujo lee el del <b>comercio</b>: esta sucursal recibiría el
        prefijo, los documentos y la moneda del país equivocado.
      </div>

      <!-- Config que YA existe en la tabla countries -->
      <div class="cfg-sub cfg-sub--extra">Config del país <span class="pl-hint">· tabla countries</span></div>
      <div v-for="f in CFG" :key="f.key" class="dr dr--row cn-ro nodrag" :class="{ 'fld-dead': f.tag !== 'display' }"
           :title="'clic: quién lo lee de verdad'" @click="openFieldInfo(f.key)">
        <div class="dr-top">
          <span class="dr-l">{{ f.label }}</span>
          <span class="fld-tag" :class="'fld-tag--' + f.tag">{{ TAG[f.tag] }}</span>
        </div>
        <span class="dr-c"><span class="fld-val">{{ f.val }}</span></span>
      </div>

      <!-- La regla que el admin no valida: entidad de otro país habilitada en la sucursal -->
      <div class="cfg-sub cfg-sub--extra">
        ¿Operan en {{ sucursalPais?.name }}? <span class="pl-hint">· lenders.country_id</span>
        <span v-if="conflicto" class="cfg-count cfg-count--warn">{{ conflicto }} ⚠</span>
      </div>
      <div v-if="!entities.length" class="cfg-empty">Sin entidades — creá alguna en “Entidades del comercio”.</div>
      <div v-for="l in entities" :key="l.name" class="cfg-row cfg-erow cn-erow"
           :class="['erow--rt' + l.rt, 'cn-erow--' + paisMatch(l), { 'cfg-row--cur': ui.selected === l.name }]"
           :title="MATCH_TITLE[paisMatch(l)]">
        <div class="erow__main" @click.stop="ui.selected = l.name">
          <div class="erow__top">
            <span class="erow__nm">{{ l.name }}</span>
            <span class="cfg-rt" :class="'rt' + l.rt">{{ RT_LABEL[l.rt] || ('rt' + l.rt) }}</span>
          </div>
          <div class="erow__sub" v-if="l.producto">
            <span class="cfg-cat" :class="'cfg-cat--' + l.producto">{{ PROD[l.producto] }}</span>
          </div>
        </div>
        <select class="nodrag cn-sel cn-sel--sm" :value="entidadCfg(l).paisId" @change="e => setEntidadPais(l, e.target.value)">
          <option v-for="c in COUNTRIES" :key="c.id" :value="c.id">{{ c.iso === '—' ? 'default 1' : c.iso }}</option>
        </select>
      </div>
      <div class="cn-note">
        La regla “una sucursal solo habilita entidades de su país” <b>no existe</b>: nada valida el cableado
        (<code>lenders_by_allied_branches</code>). Y no se puede prender todavía — <b>155 de 156</b> entidades
        están en el default 1, y el listado filtra por ese literal.
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Bottom" />
  </div>
</template>
