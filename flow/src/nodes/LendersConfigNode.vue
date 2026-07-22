<script setup>
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { customLenders, addCustomLender, removeCustomLender, duplicateCustomLender, ui, openFieldInfo, RT_LABEL } from '../store'
import { Plus, Trash2, Copy } from 'lucide-vue-next'

// Listado ÚNICO de entidades del comercio, TODAS creadas por el usuario (persisten en localStorage).
// CreditopX, agregador y redirect son solo el response_type. Arranca vacío: se crean una a una.
const PRODUCTOS = [{ key: 'credito', label: 'Crédito' }, { key: 'renting', label: 'Renting' }, { key: 'rto', label: 'Renting con compra' }]
const productoLabel = (k) => PRODUCTOS.find(p => p.key === k)?.label || ''
// Nombre y "quién decide" por response_type — más descriptivo que "rt2" y más visual.
const RT_WHO = { 0: 'redirige a su sitio', 1: 'decide su API', 2: 'decide CreditOp', 3: 'decide CreditOp' }
const rtName = (rt) => RT_LABEL[rt] || ('rt' + rt) // RT_LABEL unificado, importado de store.js
const rtWho = (rt) => RT_WHO[rt] || ''
const entities = computed(() => [...customLenders]) // catálogo = solo lo que creó el usuario
const baseSel = (l) => ui.selected === l.name

// Crear entidad propia: Nombre + Tipo de respuesta (categoría) + Producto. Persiste en localStorage.
const creating = ref(false)
const newName = ref('')
const newRt = ref('2')
const newProducto = ref('credito')
function create() {
  const l = addCustomLender(newName.value, newRt.value, newProducto.value)
  if (l) { ui.selected = l.name; creating.value = false; newName.value = ''; newRt.value = '2'; newProducto.value = 'credito' }
}
// Duplicar: clona la entidad (nombre único) y la deja seleccionada para editar la copia.
function dup(name) { const l = duplicateCustomLender(name); if (l) ui.selected = l.name }
</script>

<template>
  <div class="node node--cfg">
    <div class="node__hd node__hd--blue nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.lendersCfg')">
      <div class="node__title">Entidades del comercio</div>
      <span class="cfg-count">{{ entities.length }}</span>
    </div>
    <div class="node__body">
      <div class="cfg-hint">Catálogo del comercio: CreditopX, agregador y redirect son lenders (por response_type). Creá las que ofrece el comercio, una a una. Cada sucursal decide cuáles activa (“Estado en sucursal”).</div>
      <div v-if="!entities.length" class="cfg-empty">Sin entidades — creá la primera con “+ Agregar entidad”.</div>
      <div v-for="l in entities" :key="l.name" class="cfg-row cfg-erow cfg-pick" :class="['erow--rt' + l.rt, { 'cfg-row--cur': baseSel(l) }]" :title="l.name" @click="ui.selected = l.name">
        <Handle :id="'tpl-base-' + l.name" type="target" :position="Position.Left" class="row-h" />
        <div class="erow__main">
          <div class="erow__top">
            <span class="erow__nm">{{ l.name }}</span>
            <span class="cfg-rt fld-doc" :class="'rt' + l.rt" title="clic: quién decide según el tipo" @click.stop.prevent="openFieldInfo('mk.rt')">{{ rtName(l.rt) }}</span>
          </div>
          <div class="erow__sub">
            <span v-if="l.producto" class="cfg-cat fld-doc" :class="'cfg-cat--' + l.producto" title="clic: qué es el producto" @click.stop.prevent="openFieldInfo('cfg.producto')">{{ productoLabel(l.producto) }}</span>
            <span class="erow__who">{{ rtWho(l.rt) }}</span>
          </div>
        </div>
        <div class="erow__acts">
          <button class="cfg-dup nodrag" title="duplicar entidad" @click.stop.prevent="dup(l.name)"><Copy :size="12" /></button>
          <button class="cfg-del nodrag" title="borrar entidad" @click.stop.prevent="removeCustomLender(l.name)"><Trash2 :size="12" /></button>
        </div>
      </div>

      <button v-if="!creating" class="cfg-add nodrag" @click.stop="creating = true"><Plus :size="13" /> Agregar entidad</button>
      <div v-else class="cfg-new nodrag">
        <input class="nodrag" v-model="newName" placeholder="Nombre de la entidad" title="Nombre de la nueva entidad." @keyup.enter="create" />
        <select class="nodrag" v-model="newRt" title="Tipo de respuesta (categoría): define quién decide el crédito. rt2 CreditopX · rt1 agregador · rt0 redirect.">
          <option value="2">CreditopX · rt2</option>
          <option value="1">Agregador · rt1</option>
          <option value="0">Redirect · rt0</option>
        </select>
        <select class="nodrag" v-model="newProducto" title="Producto de la entidad: crédito, renting o renting con compra.">
          <option v-for="p in PRODUCTOS" :key="p.key" :value="p.key">{{ p.label }}</option>
        </select>
        <div class="cfg-new__actions">
          <button class="cfg-new__ok nodrag" :disabled="!newName.trim()" @click.stop="create">Crear</button>
          <button class="cfg-new__x nodrag" @click.stop="creating = false; newName = ''">Cancelar</button>
        </div>
      </div>
    </div>
    <Handle id="tomerch" type="source" :position="Position.Bottom" />
  </div>
</template>
