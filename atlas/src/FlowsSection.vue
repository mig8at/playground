<script setup>
// cada flujo de negocio como GRAFO: canal (tronco) → lenders (ramas).
// Copia por camino: cada lender copia (canal + ese lender); "todo" copia canal+todos.
const props = defineProps({
  comboName: { type: String, default: '' },
  graphs: { type: Array, default: () => [] }, // [{group, channel, lenders, trees}]
  copiedKey: { type: String, default: '' },
})
const emit = defineEmits(['copy'])

function isCopied(group, key) { return props.copiedKey === group + '::' + key }
function label(group, key, def) { return isCopied(group, key) ? '✓ copiado' : def }
</script>

<template>
  <section class="flows">
    <div class="fl-head">
      <h2>Flujos</h2>
      <span class="muted">de <b>{{ comboName }}</b> · canal → lenders (grafo). Cada (copiar) baja el árbol de ese camino</span>
    </div>

    <p v-if="!graphs.length" class="fl-empty">
      Sin flujos en esta combinación. Se crean vía el MCP (<code>atlas_save_flow</code> con <code>group</code> + <code>kind</code>).
    </p>

    <div v-for="g in graphs" :key="g.group" class="fl-graph">
      <!-- tronco: canal -->
      <div v-if="g.channel" class="fl-trunk">
        <div class="fl-node channel">
          <span class="fl-tag">canal</span>
          <span class="fl-name">{{ g.channel.name }}</span>
          <span class="fl-meta">{{ g.channel.files }} archivos</span>
        </div>
        <button
          class="fl-copy"
          :class="{ ghost: (g.lenders || []).length }"
          :disabled="!g.trees['__all__']"
          @click="emit('copy', { group: g.group, key: '__all__' })"
        >
          {{ label(g.group, '__all__', (g.lenders || []).length ? '⧉ todo el flujo' : '⧉ copiar árbol') }}
        </button>
      </div>

      <!-- ramas: lenders -->
      <div class="fl-branches">
        <div v-for="l in (g.lenders || [])" :key="l.id" class="fl-branch">
          <span v-if="g.channel" class="fl-connector">→</span>
          <div class="fl-node lender">
            <span class="fl-tag lender">lender</span>
            <span class="fl-name">{{ l.name }}</span>
            <span class="fl-meta">{{ l.files }} archivos</span>
          </div>
          <button
            class="fl-copy"
            :disabled="!g.trees[l.id]"
            :title="g.channel ? 'copia el árbol del canal + este lender' : 'copia el árbol de este flujo'"
            @click="emit('copy', { group: g.group, key: l.id })"
          >
            {{ label(g.group, l.id, '⧉ copiar') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.flows { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.fl-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.fl-head h2 { font-size: 16px; }
.fl-empty { color: var(--muted); font-size: 13px; line-height: 1.5; }
.fl-empty code { background: var(--chip); padding: 1px 5px; border-radius: 4px; font-size: 12px; }

.fl-graph { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; border-top: 1px solid var(--border); flex-wrap: wrap; }
.fl-graph:first-of-type { border-top: 0; padding-top: 0; }

.fl-trunk { display: flex; flex-direction: column; gap: 8px; flex: none; }
.fl-branches { display: flex; flex-direction: column; gap: 8px; }
.fl-branch { display: flex; align-items: center; gap: 10px; }
.fl-connector { color: var(--muted); font-size: 18px; flex: none; }

.fl-node {
  display: flex; flex-direction: column; min-width: 150px;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 9px 13px;
}
.fl-node.channel { border-left: 3px solid var(--accent); }
.fl-node.lender { border-left: 3px solid #3fb950; }
.fl-tag { font-size: 9px; text-transform: uppercase; letter-spacing: .5px; color: var(--accent); }
.fl-tag.lender { color: #3fb950; }
.fl-name { font-size: 14px; font-weight: 600; color: var(--text); margin-top: 1px; }
.fl-meta { font-size: 11px; color: var(--muted); }

.fl-copy {
  background: var(--accent); color: #06101f; border: 0; border-radius: 8px;
  padding: 8px 12px; font-weight: 600; font-size: 12px; cursor: pointer; white-space: nowrap; flex: none;
}
.fl-copy.ghost { background: var(--chip); color: var(--text); border: 1px solid var(--border); }
.fl-copy:disabled { opacity: .5; cursor: default; }
</style>
