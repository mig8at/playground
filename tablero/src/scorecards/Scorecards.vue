<script setup>
import { reactive, ref } from 'vue'
import { QUARTER, LEGEND, EMOJI, ROCKS } from './data.js'
import RockCard from './components/RockCard.vue'
import DetailDrawer from './components/DetailDrawer.vue'

// Clon profundo para editar el semáforo sin mutar el módulo de datos.
const rocks = reactive(JSON.parse(JSON.stringify(ROCKS)))
const detailOpen = ref(false)

function setCell(rockId, { kpiIdx, week, status }) {
  const rock = rocks.find((r) => r.id === rockId)
  rock.kpis[kpiIdx].weeks[week].status = status
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">
        <span class="logo">🚦</span>
        <div>
          <h1>Rocks &amp; Scorecards · Tecnología</h1>
          <p class="sub">{{ QUARTER.name }} · {{ QUARTER.range }}</p>
        </div>
      </div>
      <div class="legend">
        <span v-for="l in LEGEND" :key="l.status" class="leg" :title="l.desc">
          <span class="leg-dot" :class="'s-' + l.status">{{ EMOJI[l.status] }}</span>
          {{ l.label }}
        </span>
      </div>
    </header>

    <main class="content">
      <p class="intro">
        Cada objetivo es cuantificable y se mide semana a semana. Haz clic en una celda para
        actualizar el semáforo; en el Rock de Oscar, abre <b>“ver detalle W1”</b> para el desglose
        (índice de estabilidad, bitácora e incidentes de release).
      </p>

      <RockCard
        v-for="rock in rocks"
        :key="rock.id"
        :rock="rock"
        :weeks="QUARTER.weeks"
        @set="(p) => setCell(rock.id, p)"
        @detail="detailOpen = true"
      />

      <p class="foot">
        Prototipo · datos de W1 (29-jun a 5-jul 2026) sembrados desde la bitácora real. El detalle de
        disponibilidad, incidentes y releases sale de Slack #tech-ops / #producto-tech.
      </p>
    </main>

    <DetailDrawer :open="detailOpen" @close="detailOpen = false" />
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 16px 26px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand { display: flex; align-items: center; gap: 12px; }
.logo { font-size: 26px; }
.topbar h1 { font-size: 17px; margin: 0; }
.sub { margin: 2px 0 0; color: var(--ink-soft); font-size: 12.5px; }
.legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--ink-soft); }
.leg { display: inline-flex; align-items: center; gap: 5px; }
.leg-dot { width: 18px; height: 18px; border-radius: 5px; display: grid; place-items: center; font-size: 11px; }
.leg-dot.s-green { background: var(--green-bg); }
.leg-dot.s-yellow { background: var(--yellow-bg); }
.leg-dot.s-red { background: var(--red-bg); }
.leg-dot.s-none { background: var(--head); }

.content { max-width: 1180px; margin: 0 auto; padding: 24px 26px 60px; }
.intro { color: var(--ink-soft); font-size: 13.5px; line-height: 1.6; max-width: 90ch; margin: 0 0 22px; }
.foot { color: var(--ink-soft); font-size: 12px; margin-top: 8px; line-height: 1.5; }
</style>
