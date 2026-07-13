<script setup>
// flujos de la combinación seleccionada
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
      <span class="muted">de <b>{{ comboName }}</b> · click → JSON + copiar árbol (Rino)</span>
    </div>

    <p v-if="!flows.length" class="fl-empty">
      Sin flujos en esta combinación todavía. Se crean vía el MCP (<code>atlas_save_flow</code> con <code>combination</code>).
    </p>

    <div class="fl-list">
      <article v-for="f in flows" :key="f.id" class="fl-card" @click="emit('open', { id: f.id, name: f.name })">
        <div class="fl-top">
          <b>{{ f.name }}</b>
          <span v-if="f.changed" class="fl-tag stale">⚠ {{ f.changed }}</span>
          <span v-else-if="f.has_base" class="fl-tag ok">✓</span>
        </div>
        <p v-if="f.description" class="fl-desc">{{ f.description }}</p>
        <div class="fl-meta">
          <span class="chip">{{ f.files }} archivos</span>
          <span v-for="r in f.repos" :key="r" class="chip repo">{{ r }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.flows { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.fl-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.fl-head h2 { font-size: 16px; }
.fl-empty { color: var(--muted); font-size: 13px; line-height: 1.5; }
.fl-empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.fl-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.fl-card { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: border-color .15s; }
.fl-card:hover { border-color: var(--accent); }
.fl-top { display: flex; align-items: center; gap: 8px; }
.fl-top b { font-size: 14px; }
.fl-tag { font-size: 10px; padding: 2px 8px; border-radius: 999px; margin-left: auto; }
.fl-tag.ok { color: var(--green); background: rgba(63,185,80,.14); }
.fl-tag.stale { color: #e3b341; background: rgba(227,179,65,.16); }
.fl-desc { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
.fl-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.chip { background: var(--chip); color: var(--muted); font-size: 11px; padding: 2px 8px; border-radius: 999px; }
.chip.repo { color: var(--accent); }
</style>
