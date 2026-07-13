<script setup>
import { computed } from 'vue'

// una FILA por flujo de negocio (group). Dentro, las etapas (canal → lender).
// Cada fila termina en su propio (copiar árbol).
const props = defineProps({
  comboName: { type: String, default: '' },
  flows: { type: Array, default: () => [] }, // [{id,name,files,group,created,...}]
  trees: { type: Object, default: () => ({}) }, // group → árbol
  copiedGroup: { type: String, default: '' },
})
const emit = defineEmits(['copy'])

// agrupa por group (fallback: id del flujo), preservando el orden de aparición
const rows = computed(() => {
  const map = new Map()
  for (const f of props.flows) {
    const g = f.group || f.id
    if (!map.has(g)) map.set(g, [])
    map.get(g).push(f)
  }
  return [...map.entries()].map(([group, stages]) => ({ group, stages }))
})
</script>

<template>
  <section class="flows">
    <div class="fl-head">
      <h2>Flujos</h2>
      <span class="muted">de <b>{{ comboName }}</b> · cada fila es un flujo (canal → lender); (copiar) baja el árbol completo de esa fila</span>
    </div>

    <p v-if="!flows.length" class="fl-empty">
      Sin flujos en esta combinación. Se crean vía el MCP (<code>atlas_save_flow</code> con <code>combination</code> + <code>group</code>).
    </p>

    <div v-for="row in rows" :key="row.group" class="fl-row">
      <template v-for="(f, i) in row.stages" :key="f.id">
        <span v-if="i > 0" class="fl-arrow">→</span>
        <div class="fl-stage" :title="f.description">
          <span class="fl-idx">{{ i + 1 }}</span>
          <span class="fl-body">
            <span class="fl-name">{{ f.name }}</span>
            <span class="fl-meta">{{ f.files }} archivos</span>
          </span>
        </div>
      </template>

      <span class="fl-arrow">→</span>
      <button class="fl-copy" :disabled="!trees[row.group]" @click="emit('copy', row.group)"
              :title="trees[row.group] ? 'copiar el árbol completo (estructura + contenido) de este flujo' : 'preparando árbol…'">
        {{ copiedGroup === row.group ? '✓ copiado' : '⧉ copiar árbol' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.flows { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.fl-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.fl-head h2 { font-size: 16px; }
.fl-empty { color: var(--muted); font-size: 13px; line-height: 1.5; }
.fl-empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.fl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.fl-row:last-child { margin-bottom: 0; }
.fl-arrow { color: var(--muted); font-size: 20px; flex: none; }
.fl-stage {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 14px;
}
.fl-idx {
  flex: none; width: 22px; height: 22px; border-radius: 50%;
  background: var(--chip); color: var(--muted); font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.fl-body { display: flex; flex-direction: column; }
.fl-name { font-size: 14px; font-weight: 600; color: var(--text); }
.fl-meta { font-size: 11px; color: var(--muted); }

.fl-copy {
  background: var(--accent); color: #06101f; border: 0; border-radius: 10px;
  padding: 10px 16px; font-weight: 600; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.fl-copy:disabled { opacity: .5; cursor: default; }
</style>
