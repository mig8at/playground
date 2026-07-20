<script setup>
import { reactive, computed } from 'vue'
import {
  STABILITY, AVAILABILITY, INCIDENTS, CRITICAL_INCIDENTS,
  RELEASES, RELEASE_KPIS, DATA_INTEGRITY, SOURCES,
} from '../data.js'

defineProps({ open: Boolean })
const emit = defineEmits(['close'])

// Copia editable de los pesos → el índice se recalcula (regla "ajustable" del PDF).
const rows = reactive(STABILITY.components.map((c) => ({ ...c })))

const totalWeight = computed(() => rows.reduce((s, r) => s + Number(r.weight || 0), 0))
const index = computed(() => rows.reduce((s, r) => s + r.health * Number(r.weight || 0), 0) / 100)
const indexStatus = computed(() => (index.value >= STABILITY.target ? 'green' : index.value >= STABILITY.target - 15 ? 'yellow' : 'red'))

function contrib(r) { return (r.health * Number(r.weight || 0)) / 100 }
function resetWeights() { STABILITY.components.forEach((c, i) => (rows[i].weight = c.weight)) }
</script>

<template>
  <transition name="drawer">
    <aside v-if="open" class="drawer">
      <div class="backdrop" @click="emit('close')"></div>
      <div class="panel">
        <header class="panel-head">
          <div>
            <div class="eyebrow">Rock · Oscar Rincón · Detalle {{ STABILITY.week }}</div>
            <h2>Disponibilidad de flujos críticos — Semana 29-jun a 5-jul 2026</h2>
          </div>
          <button class="close" @click="emit('close')">✕</button>
        </header>

        <div class="panel-body">
          <!-- Índice de estabilidad (compuesto, pesos editables) -->
          <section class="block">
            <div class="block-title">
              <h3>Índice de estabilidad del Rock</h3>
              <button class="ghost" @click="resetWeights">restaurar pesos</button>
            </div>
            <p class="muted">Índice = Σ(salud × peso) / 100. Ajusta los pesos y mira cómo recalcula.</p>

            <div class="index-hero" :class="'s-' + indexStatus">
              <div class="index-val">{{ index.toFixed(1) }}%</div>
              <div class="index-meta">
                <span>Meta ≥ {{ STABILITY.target }}%</span>
                <span class="badge" :class="'s-' + indexStatus">
                  {{ indexStatus === 'green' ? 'CUMPLE' : indexStatus === 'yellow' ? 'ALERTA' : 'NO CUMPLE' }}
                </span>
              </div>
            </div>

            <table class="mini">
              <thead>
                <tr><th>KPI</th><th>Salud</th><th>Peso %</th><th>Aporte</th></tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in rows" :key="i">
                  <td>{{ r.kpi }} <span class="formula">({{ r.formula }})</span></td>
                  <td class="num">{{ r.health }}</td>
                  <td class="num">
                    <input type="number" min="0" max="100" v-model.number="r.weight" />
                  </td>
                  <td class="num strong">{{ contrib(r).toFixed(1) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Índice de estabilidad</td>
                  <td></td>
                  <td class="num" :class="{ warn: totalWeight !== 100 }">{{ totalWeight }}%</td>
                  <td class="num strong">{{ index.toFixed(1) }}</td>
                </tr>
              </tfoot>
            </table>
            <p v-if="totalWeight !== 100" class="warn-text">⚠ Los pesos suman {{ totalWeight }}% (no 100%).</p>
          </section>

          <!-- Disponibilidad: total vs por causa -->
          <section class="block">
            <h3>Disponibilidad · total vs. por causa</h3>
            <p class="muted">{{ AVAILABILITY.windowNote }}</p>
            <table class="mini">
              <thead><tr><th>Vista</th><th>Downtime pond.</th><th>Disponibilidad</th></tr></thead>
              <tbody>
                <tr v-for="(row, i) in AVAILABILITY.byCause" :key="i" :class="{ strong: row.strong }">
                  <td>{{ row.view }}</td>
                  <td class="num">{{ row.downtime }} min</td>
                  <td class="num">
                    {{ row.avail }}
                    <span v-if="row.status === 'red'" class="dot-red">●</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p class="muted">Flujo que jala el resultado: <b>{{ AVAILABILITY.worst }}</b></p>
            <div class="chips">
              <span v-for="f in AVAILABILITY.flows" :key="f" class="flow-chip">{{ f }}</span>
            </div>
          </section>

          <!-- Bitácora de incidentes -->
          <section class="block">
            <h3># incidentes críticos: {{ CRITICAL_INCIDENTS.count }}</h3>
            <p class="muted">{{ CRITICAL_INCIDENTS.breakdown }}</p>
            <table class="mini log">
              <thead>
                <tr><th>Fecha</th><th>Flujo</th><th>Incidente</th><th>Tipo·Causa</th><th>Downtime</th></tr>
              </thead>
              <tbody>
                <tr v-for="(x, i) in INCIDENTS" :key="i" :class="{ nocount: !x.counts }">
                  <td class="nowrap">{{ x.date }}</td>
                  <td class="nowrap"><b>{{ x.flow }}</b></td>
                  <td>
                    {{ x.incident }}
                    <span v-if="x.note" class="note">{{ x.note }}</span>
                  </td>
                  <td class="nowrap">
                    <span class="tag" :class="'t-' + x.type.replace('/', '')">{{ x.type }}</span>
                    <span class="cause" :class="'c-' + x.cause">{{ x.cause }}</span>
                  </td>
                  <td class="num">{{ x.counts ? x.downtime : '—' }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr><td colspan="4">TOTAL que cuenta</td><td class="num strong">≈ {{ AVAILABILITY.downtimeMin }}</td></tr>
              </tfoot>
            </table>
          </section>

          <!-- Releases -->
          <section class="block">
            <h3>Releases y KPIs de release</h3>
            <p class="muted">"Regresión" = cualquier release que hubo que reversar o parchear (change failure), sin importar la causa.</p>
            <table class="mini">
              <thead><tr><th>Release</th><th>¿Regresión?</th><th>¿Incidente?</th><th>Causa</th></tr></thead>
              <tbody>
                <tr v-for="(r, i) in RELEASES" :key="i">
                  <td><b>{{ r.name }}</b><span v-if="r.note" class="note">{{ r.note }}</span></td>
                  <td><span class="yn" :class="r.regression ? 'yes' : 'no'">{{ r.regression ? 'SÍ' : 'NO' }}</span></td>
                  <td><span class="yn" :class="r.incident ? 'yes' : 'no'">{{ r.incident ? 'SÍ' : 'NO' }}</span></td>
                  <td class="nowrap">{{ r.cause }}</td>
                </tr>
              </tbody>
            </table>
            <div class="kpi-pills">
              <span class="pill red">% releases sin regresiones = {{ RELEASE_KPIS.sinRegresiones }} · meta ≥ 95%</span>
              <span class="pill red"># incidentes de release = {{ RELEASE_KPIS.incidentesRelease }} · meta ≤ 1</span>
            </div>
          </section>

          <!-- Integridad de datos -->
          <section class="block callout-danger">
            <h3>⚠ {{ DATA_INTEGRITY.title }}</h3>
            <p>{{ DATA_INTEGRITY.text }}</p>
          </section>

          <section class="block sources">
            <span class="muted">Trazabilidad (Slack):</span>
            <span v-for="s in SOURCES" :key="s" class="src">{{ s }}</span>
          </section>
        </div>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.drawer { position: fixed; inset: 0; z-index: 50; }
.backdrop { position: absolute; inset: 0; background: rgba(15, 20, 35, 0.45); }
.panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: min(760px, 96vw);
  background: var(--bg);
  box-shadow: -12px 0 40px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.eyebrow { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ink-soft); }
.panel-head h2 { font-size: 16px; margin: 4px 0 0; }
.close { border: 0; background: transparent; font-size: 18px; cursor: pointer; color: var(--ink-soft); }
.panel-body { overflow-y: auto; padding: 20px 22px 40px; }

.block { margin-bottom: 26px; }
.block h3 { font-size: 14px; margin: 0 0 4px; }
.block-title { display: flex; align-items: center; justify-content: space-between; }
.muted { color: var(--ink-soft); font-size: 12.5px; margin: 2px 0 12px; line-height: 1.5; }

.index-hero {
  display: flex; align-items: center; gap: 18px;
  padding: 16px 18px; border-radius: 12px; margin-bottom: 14px;
  border: 1px solid var(--border);
}
.index-hero.s-red { background: var(--red-bg); }
.index-hero.s-yellow { background: var(--yellow-bg); }
.index-hero.s-green { background: var(--green-bg); }
.index-val { font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; }
.index-meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }

table.mini { border-collapse: collapse; width: 100%; font-size: 12.5px; }
table.mini th { text-align: left; color: var(--ink-soft); font-weight: 600; padding: 7px 8px; border-bottom: 1px solid var(--border); }
table.mini td { padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.mini tfoot td { font-weight: 700; border-top: 2px solid var(--border-strong); }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.strong td, td.strong, tr.strong td { font-weight: 700; }
.formula { color: var(--ink-soft); font-size: 11px; }
table.mini input {
  width: 56px; text-align: right; padding: 3px 6px;
  border: 1px solid var(--border-strong); border-radius: 6px; font: inherit;
}
.warn { color: var(--red-ink); font-weight: 700; }
.warn-text { color: var(--red-ink); font-size: 12px; margin: 6px 0 0; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.flow-chip { font-size: 11px; padding: 3px 9px; border-radius: 999px; background: var(--head); border: 1px solid var(--border); }

.log td .note { display: block; color: var(--ink-soft); font-size: 11px; margin-top: 3px; line-height: 1.4; }
.nowrap { white-space: nowrap; }
tr.nocount { opacity: 0.55; }
.tag { display: inline-block; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 5px; background: #eee; margin-right: 4px; }
.t-A { background: #ffd7d1; color: #8a1c0f; }
.t-AB { background: #ffe6c9; color: #8a530f; }
.t-B { background: #fff3c4; color: #7a5c00; }
.cause { font-size: 10px; padding: 1px 5px; border-radius: 5px; }
.c-tercero { background: #e9defd; color: #5b32a8; }
.c-interna { background: #dbeafe; color: #1e4fa3; }
.c-negocio { background: #e5e7eb; color: #4b5563; }

.yn { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 5px; }
.yn.yes { background: #ffd7d1; color: #8a1c0f; }
.yn.no { background: #d3f0dc; color: #1c6b3a; }

.kpi-pills, .chips { margin-top: 10px; }
.kpi-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { font-size: 12px; padding: 5px 10px; border-radius: 8px; font-weight: 600; }
.pill.red { background: var(--red-bg); color: var(--red-ink); }
.badge { font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; width: fit-content; }
.badge.s-red { background: var(--red-ink); color: #fff; }
.badge.s-yellow { background: #b8860b; color: #fff; }
.badge.s-green { background: #1c6b3a; color: #fff; }
.dot-red { color: var(--red-ink); }

.callout-danger { background: var(--red-bg); border: 1px solid #f3c2ba; border-radius: 12px; padding: 14px 16px; }
.callout-danger p { margin: 6px 0 0; font-size: 13px; line-height: 1.55; }
.ghost { border: 1px solid var(--border-strong); background: transparent; border-radius: 7px; font-size: 11px; padding: 3px 8px; cursor: pointer; color: var(--ink-soft); }
.sources { display: flex; align-items: center; gap: 8px; }
.src { font-size: 12px; color: var(--accent); }

.drawer-enter-active .panel, .drawer-leave-active .panel { transition: transform 0.25s ease; }
.drawer-enter-from .panel, .drawer-leave-to .panel { transform: translateX(100%); }
.drawer-enter-active .backdrop, .drawer-leave-active .backdrop { transition: opacity 0.25s ease; }
.drawer-enter-from .backdrop, .drawer-leave-to .backdrop { opacity: 0; }
</style>
