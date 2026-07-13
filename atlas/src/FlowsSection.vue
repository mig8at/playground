<script setup>
// flujos de la combinación seleccionada, como una fila-pipeline: A → B → …
const props = defineProps({
  comboName: { type: String, default: '' },
  flows: { type: Array, default: () => [] }, // [{id,name,files,repos,up_to_date,has_base,changed}]
})
const emit = defineEmits(['open'])
</script>

<template>
  <section class="flows">
    <div class="fl-head">
      <h2>Flujos</h2>
      <span class="muted">de <b>{{ comboName }}</b> · click en una etapa → JSON + copiar árbol (Rino)</span>
    </div>

    <p v-if="!flows.length" class="fl-empty">
      Sin flujos en esta combinación todavía. Se crean vía el MCP (<code>atlas_save_flow</code> con <code>combination</code>).
    </p>

    <div v-else class="fl-row">
      <template v-for="(f, i) in flows" :key="f.id">
        <span v-if="i > 0" class="fl-arrow">→</span>
        <button class="fl-stage" @click="emit('open', { id: f.id, name: f.name })">
          <span class="fl-idx">{{ i + 1 }}</span>
          <span class="fl-body">
            <span class="fl-name">{{ f.name }}</span>
            <span class="fl-meta">{{ f.files }} archivos</span>
          </span>
          <span v-if="f.changed" class="fl-dot stale" title="archivos cambiados">⚠</span>
          <span v-else-if="f.has_base" class="fl-dot ok" title="al día">✓</span>
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.flows { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.fl-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.fl-head h2 { font-size: 16px; }
.fl-empty { color: var(--muted); font-size: 13px; line-height: 1.5; }
.fl-empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.fl-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fl-arrow { color: var(--muted); font-size: 20px; flex: none; }
.fl-stage {
  display: flex; align-items: center; gap: 10px;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 14px; cursor: pointer; transition: border-color .15s; text-align: left;
}
.fl-stage:hover { border-color: var(--accent); }
.fl-idx {
  flex: none; width: 22px; height: 22px; border-radius: 50%;
  background: var(--chip); color: var(--muted); font-size: 12px; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.fl-body { display: flex; flex-direction: column; }
.fl-name { font-size: 14px; font-weight: 600; color: var(--text); }
.fl-meta { font-size: 11px; color: var(--muted); }
.fl-dot { font-size: 12px; }
.fl-dot.ok { color: var(--green); }
.fl-dot.stale { color: #e3b341; }
</style>
