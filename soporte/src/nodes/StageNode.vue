<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Smartphone, ClipboardList, Search, LayoutList, MousePointerClick, Calculator, Banknote, Check, X, TriangleAlert, Minus } from 'lucide-vue-next'
import { ui, selectNode } from '../store'

const props = defineProps({ id: String, data: Object })
const ICONS = { registro: Smartphone, formulario: ClipboardList, buro: Search, listado: LayoutList, seleccion: MousePointerClick, cupo: Calculator, desembolso: Banknote }
const MARK = { ok: Check, warn: TriangleAlert, fail: X, skip: Minus }
const icon = computed(() => ICONS[props.data.stageId] || LayoutList)
const mark = computed(() => MARK[props.data.status] || Minus)
const sel = computed(() => ui.nodeId === props.data.stageId)
</script>

<template>
  <div class="stage nodrag" :class="['s-' + data.status, { 'stage--sel': sel }]" @click="selectNode(data.stageId)">
    <Handle id="l" type="target" :position="Position.Left" />
    <Handle id="r" type="source" :position="Position.Right" />
    <Handle id="b" type="source" :position="Position.Bottom" />
    <div class="stage__hd">
      <span class="stage__ic"><component :is="icon" :size="15" /></span>
      <span class="stage__lb">{{ data.label }}</span>
      <span class="stage__mk"><component :is="mark" :size="12" /></span>
    </div>
    <div v-if="data.detail && data.status !== 'skip'" class="stage__dt">{{ data.detail }}</div>
    <div v-if="data.reason && data.status === 'fail'" class="stage__reason">{{ data.reason }}</div>
  </div>
</template>
