<script setup>
// VISUAL ONLY (por ahora). Estos flujos se poblarán vía el MCP (atlas_save_flow);
// hoy son el andamiaje de la sección "Flujos" que va debajo del mapa.
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
</script>

<template>
  <section class="catalog">
    <div class="cat-head">
      <h2>Flujos</h2>
      <span class="soon">por mapear · se poblará vía MCP</span>
    </div>

    <div v-for="g in groups" :key="g.title" class="cat-group">
      <h3>{{ g.title }}</h3>
      <div class="cards">
        <article v-for="it in g.items" :key="it.name" class="card">
          <span class="card-icon">{{ it.icon }}</span>
          <div class="card-body">
            <div class="card-name">{{ it.name }}</div>
            <div class="card-sub">{{ it.sub }}</div>
          </div>
          <span class="card-tag">por mapear</span>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.catalog { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.cat-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 14px; }
.cat-head h2 { font-size: 16px; }
.soon { font-size: 12px; color: var(--muted); }

.cat-group { margin-bottom: 16px; }
.cat-group:last-child { margin-bottom: 0; }
.cat-group h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 10px; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.card {
  display: flex; align-items: center; gap: 12px;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 10px;
  padding: 12px 14px; cursor: default; transition: border-color .15s;
}
.card:hover { border-color: var(--accent); }
.card-icon { font-size: 22px; flex: none; }
.card-body { flex: 1; min-width: 0; }
.card-name { font-size: 14px; font-weight: 600; color: var(--text); }
.card-sub { font-size: 11px; color: var(--muted); margin-top: 2px; font-family: ui-monospace, monospace; }
.card-tag { font-size: 10px; color: var(--muted); background: var(--chip); padding: 2px 8px; border-radius: 999px; flex: none; }

@media (max-width: 640px) {
  .cards { grid-template-columns: 1fr; }
}
</style>
