<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, selectNode } from '../store'

const props = defineProps({ id: String, data: Object })
const VD = { ok: 'preaprobado', lowp: 'prob. baja', error: 'no consultó', excl: 'excluido' }
const sel = computed(() => ui.nodeId === 'lender:' + props.data.lender.name)
const l = computed(() => props.data.lender)
</script>

<template>
  <div class="lender nodrag" :class="{ 'lender--sel': sel }" @click="selectNode('lender:' + l.name)">
    <Handle id="t" type="target" :position="Position.Top" />
    <div class="lender__top">
      <span class="lender__nm">{{ l.name }}</span>
      <span class="lender__rt" :class="'rt' + l.rt">rt{{ l.rt }}</span>
    </div>
    <div class="lender__vd" :class="'v-' + l.verdict"><i></i>{{ VD[l.verdict] || l.verdict }}</div>
  </div>
</template>
