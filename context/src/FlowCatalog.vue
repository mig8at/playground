<script setup>
import { computed } from 'vue'

// flows = flujos reales guardados (del estado WS): [{id, name, files, repos}]
const props = defineProps({ flows: { type: Array, default: () => [] } })
const emit = defineEmits(['open'])

// catálogo esperado. Cada item se enlaza a un flujo real por slug (== id del flujo).
const groups = [
  {
    title: 'Canales / Productos',
    items: [
      { icon: '🛒', name: 'Pullman', sub: 'CreditopX · rt=2 · in-platform' },
      { icon: '📱', name: 'SmartPay', sub: 'CreditopX · rt=2 · IMEI / garantía' },
      { icon: '🛵', name: 'Motai', sub: 'allied 158 · renting · 3 modos' },
    ],
  },
  {
    title: 'Lenders',
    items: [
      { icon: '🏪', name: 'CrediPullman', sub: 'rt=2 · in-platform' },
      { icon: '🏦', name: 'Bancolombia', sub: 'rt=1 · BNPL externo' },
      { icon: '🛵', name: 'MotaiX', sub: 'rt=2 · renting / RTO' },
    ],
  },
]

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
const flowBySlug = computed(() => {
  const m = {}
  for (const f of props.flows) m[f.id] = f
  return m
})
function mapped(item) { return flowBySlug.value[slug(item.name)] || null }

function onClick(item) {
  const f = mapped(item)
  if (f) emit('open', { id: f.id, name: item.name })
}
</script>

<template>
  <section class="catalog">
    <div class="cat-head">
      <h2>Flujos</h2>
      <span class="soon">click en un flujo mapeado → JSON de sus archivos · el resto se mapea vía MCP</span>
    </div>

    <div v-for="g in groups" :key="g.title" class="cat-group">
      <h3>{{ g.title }}</h3>
      <div class="cards">
        <article
          v-for="it in g.items"
          :key="it.name"
          class="card"
          :class="{ live: mapped(it) }"
          @click="onClick(it)"
        >
          <span class="card-icon">{{ it.icon }}</span>
          <div class="card-body">
            <div class="card-name">{{ it.name }}</div>
            <div class="card-sub">{{ it.sub }}</div>
          </div>
          <template v-if="mapped(it)">
            <span v-if="mapped(it).changed" class="card-tag stale" title="archivos cambiados desde el análisis">⚠ {{ mapped(it).changed }} cambió</span>
            <span v-else-if="mapped(it).has_base" class="card-tag on" title="al día con los repos">✓ {{ mapped(it).files }}</span>
            <span v-else class="card-tag on">{{ mapped(it).files }} archivos</span>
          </template>
          <span v-else class="card-tag">por mapear</span>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.catalog { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.cat-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.cat-head h2 { font-size: 16px; }
.soon { font-size: 12px; color: var(--muted); }

.cat-group { margin-bottom: 16px; }
.cat-group:last-child { margin-bottom: 0; }
.cat-group h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 10px; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.card {
  display: flex; align-items: center; gap: 12px;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 14px; cursor: default; transition: border-color .15s; opacity: .7;
}
.card.live { cursor: pointer; opacity: 1; }
.card.live:hover { border-color: var(--accent); }
.card-icon { font-size: 22px; flex: none; }
.card-body { flex: 1; min-width: 0; }
.card-name { font-size: 14px; font-weight: 600; color: var(--text); }
.card-sub { font-size: 11px; color: var(--muted); margin-top: 2px; font-family: ui-monospace, monospace; }
.card-tag { font-size: 10px; color: var(--muted); background: var(--chip); padding: 2px 8px; border-radius: 999px; flex: none; }
.card-tag.on { color: var(--green); background: rgba(63,185,80,.14); }
.card-tag.stale { color: #e3b341; background: rgba(227,179,65,.16); }

@media (max-width: 640px) {
  .cards { grid-template-columns: 1fr; }
}
</style>
