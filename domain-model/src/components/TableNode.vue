<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { contextColor } from '../lib/transform'
import type { TableNodeData } from '../lib/types'

const props = defineProps<{ id: string; data: TableNodeData }>()

const color = computed(() => props.data.color ?? contextColor(props.data.entidad.contexto))
const isRoot = computed(() => props.data.entidad.tipo === 'aggregateRoot')
const isExternal = computed(() => props.data.entidad.tipo === 'external')
const unifiedCount = computed(() => {
  const l = props.data.entidad.legacy
  return (l?.absorbe?.length ?? 0) + (l?.tabla ? 1 : 0)
})
const tabla = computed(() => {
  if (isExternal.value) return 'IdP externo · AWS'
  const l = props.data.entidad.legacy
  return l?.tabla ?? (l?.ref ? 'green-field' : '—')
})
</script>

<template>
  <div
    class="table-node"
    :class="{ dimmed: data.dimmed, selected: data.selected, root: isRoot, external: isExternal }"
    :style="{ '--ctx': color }"
  >
    <header class="tn-header">
      <span
        v-if="unifiedCount > 1"
        class="tn-unified"
        :title="`Unifica ${unifiedCount} tablas del sistema anterior`"
      >{{ unifiedCount }}</span>
      <div class="tn-title">
        <span v-if="isRoot" class="tn-root" title="Aggregate Root">◆</span>
        <span v-if="isExternal" class="tn-root" title="Sistema externo (IdP)">☁</span>
        {{ data.entidad.name }}
      </div>
      <div class="tn-sub">
        <span class="tn-ctx">{{ data.contextoName }}</span>
        <span class="tn-tabla" :title="`tabla legacy: ${tabla}`">{{ tabla }}</span>
      </div>
    </header>

    <ul class="tn-cols">
      <li
        v-for="a in data.entidad.atributos"
        :key="a.n"
        class="tn-col"
        :class="{
          pk: a.n === data.entidad.identidad && !a.aws,
          fk: data.fkColumns.has(a.n) && !a.aws,
          aws: !!a.aws,
          nuevo: !!a.nuevo,
        }"
        :title="a.aws ? `referencia a recurso AWS (${a.aws})` : a.nuevo ? `nuevo (deber-ser): ${a.note || a.t}` : a.note || a.t"
      >
        <Handle :id="`t-${a.n}`" type="target" :position="Position.Left" class="tn-handle" />
        <span class="tn-cn">
          <span v-if="a.aws" class="tn-mark aws-mark">{{ a.aws }}</span>
          <span v-else-if="a.n === data.entidad.identidad" class="tn-mark pk-mark">PK</span>
          <span v-else-if="data.fkColumns.has(a.n)" class="tn-mark fk-mark">FK</span>
          <span v-if="a.event" class="tn-event" :title="a.event">↯</span>
          {{ a.n }}
        </span>
        <span class="tn-ct">{{ a.t }}</span>
        <Handle :id="`s-${a.n}`" type="source" :position="Position.Right" class="tn-handle" />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.table-node {
  width: 240px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  transition: opacity 0.15s, box-shadow 0.15s, transform 0.1s;
}
.table-node.root {
  border-color: var(--ctx);
  box-shadow: 0 0 0 1px var(--ctx), 0 4px 10px rgba(15, 23, 42, 0.12);
}
.table-node.selected {
  box-shadow: 0 0 0 2px var(--ctx), 0 8px 20px rgba(15, 23, 42, 0.2);
  transform: translateY(-1px);
}
.table-node.dimmed {
  opacity: 0.18;
}
.table-node.external {
  border: 2px dashed var(--ctx);
  background: #faf5ff;
}
.table-node.external .tn-header {
  background: repeating-linear-gradient(
    45deg,
    var(--ctx),
    var(--ctx) 8px,
    color-mix(in srgb, var(--ctx) 82%, #fff) 8px,
    color-mix(in srgb, var(--ctx) 82%, #fff) 16px
  );
}

.tn-header {
  background: var(--ctx);
  color: #fff;
  padding: 6px 10px;
  position: relative;
}
.tn-unified {
  position: absolute;
  top: 6px;
  right: 8px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 999px;
  background: #fff;
  color: var(--ctx);
  font-size: 10px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
}
.tn-title {
  font-weight: 700;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 5px;
  padding-right: 20px;
}
.tn-root {
  font-size: 11px;
  opacity: 0.9;
}
.tn-sub {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 9.5px;
  opacity: 0.92;
  margin-top: 1px;
}
.tn-tabla {
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

.tn-cols {
  list-style: none;
  margin: 0;
  padding: 0;
}
.tn-col {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 22px;
  padding: 0 10px;
  font-size: 11px;
  border-top: 1px solid #f1f5f9;
}
.tn-col.nuevo {
  box-shadow: inset 3px 0 0 #4ade80;
}
.tn-col.nuevo .tn-cn::after {
  content: 'nuevo';
  margin-left: 5px;
  font-size: 7.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #052e16;
  background: #4ade80;
  border-radius: 3px;
  padding: 0 4px;
  vertical-align: middle;
}
.tn-col.pk {
  background: #fffbeb;
}
.tn-col.fk {
  background: #eff6ff;
}
.tn-col.aws {
  background: #f1f5f9;
}
.tn-cn {
  font-family: ui-monospace, monospace;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tn-ct {
  color: #94a3b8;
  font-size: 9.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}
.tn-mark {
  font-size: 8px;
  font-weight: 700;
  padding: 0 3px;
  border-radius: 3px;
  line-height: 13px;
}
.pk-mark {
  background: #f59e0b;
  color: #fff;
}
.fk-mark {
  background: #3b82f6;
  color: #fff;
}
.aws-mark {
  background: #475569;
  color: #fff;
}
.tn-event {
  color: #8b5cf6;
  font-weight: 700;
  font-size: 12px;
  line-height: 1;
  cursor: help;
}

.tn-handle {
  width: 7px;
  height: 7px;
  background: var(--ctx);
  border: 1px solid #fff;
}
</style>
