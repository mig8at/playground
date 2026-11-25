<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Check, CircleAlert, Info, MousePointerClick } from 'lucide-vue-next'
import { ui, findLenderDef, selectionCheck, openFieldInfo } from '../store'

// Elegir la entidad: el wizard llama `update-user-request` y el backend valida y pasa la solicitud a 3. NO vuelve a
// consultar el cupo (verificado en main el 2026-11-25): este nodo reemplaza a la «Re-evaluación en POS», que dibujaba
// una consulta que no existe.
const name = computed(() => ui.selected)
const lender = computed(() => findLenderDef(name.value))
const check = computed(() => (name.value ? selectionCheck(name.value) : null))
</script>

<template>
  <div v-if="lender" class="node node--recheck prov-node" :class="{ 'node--recheck-blocked': check && !check.allowed }">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--amber nhd-doc" title="clic: qué valida el backend al elegir" @click="openFieldInfo('psel.selection')">
      <div class="node__title"><MousePointerClick :size="13" /> Elegir la entidad</div>
      <span class="pl-cat">update-user-request</span>
    </div>
    <div class="node__body rc-body">
      <div class="rc-hint">El backend no vuelve a consultar el cupo: valida y pasa la solicitud a <b>3 · Selección de entidad</b>.</div>
      <div v-for="c in check.checks" :key="c.key" class="sel-check" :class="{ 'sel-check--no': !c.ok, 'sel-check--info': c.info }">
        <Info v-if="c.info" :size="12" /><Check v-else-if="c.ok" :size="12" /><CircleAlert v-else :size="12" />
        <span>{{ c.label }}</span>
      </div>
      <div class="rn-status" :class="check.allowed ? 'ok' : 'no'">
        <Check v-if="check.allowed" :size="13" /><CircleAlert v-else :size="13" />
        <span>{{ check.allowed ? 'pasa a estado 3' : 'se rechaza: la solicitud no avanza' }}</span>
      </div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>

<style scoped>
.sel-check { display: flex; align-items: flex-start; gap: 6px; font-size: 10.5px; line-height: 1.4; color: var(--ink); margin: 3px 0; }
.sel-check svg { flex: none; margin-top: 2px; color: var(--green); }
.sel-check--no svg, .sel-check--no { color: var(--red); }
.sel-check--info { color: var(--mut); }
.sel-check--info svg { color: var(--mut); }
</style>
