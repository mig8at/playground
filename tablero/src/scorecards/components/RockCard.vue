<script setup>
import SemaphoreCell from './SemaphoreCell.vue'

const props = defineProps({ rock: Object, weeks: Number })
const emit = defineEmits(['set', 'detail'])
</script>

<template>
  <section class="rock">
    <header class="rock-head">
      <div class="rock-n">{{ rock.n }}</div>
      <div>
        <h2>{{ rock.owner }} — {{ rock.title }}</h2>
        <p class="desc">{{ rock.description }}</p>
      </div>
    </header>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="kpi-col">KPI</th>
            <th class="meta-col">Meta</th>
            <th v-for="w in weeks" :key="w" class="wk">W{{ w }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(kpi, ki) in rock.kpis" :key="ki">
            <td class="kpi-col">
              <div class="kpi-name">{{ kpi.name }}</div>
              <button v-if="kpi.detail" class="detail-link" @click="emit('detail')">
                ver detalle W1 ↗
              </button>
            </td>
            <td class="meta-col">{{ kpi.target }}</td>
            <SemaphoreCell
              v-for="(cell, wi) in kpi.weeks"
              :key="wi"
              :cell="cell"
              :week="wi + 1"
              @set="(s) => emit('set', { kpiIdx: ki, week: wi, status: s })"
            />
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.rock {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 22px;
}
.rock-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
}
.rock-n {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  display: grid;
  place-items: center;
}
.rock-head h2 { font-size: 16px; margin: 0 0 4px; }
.desc { margin: 0; color: var(--ink-soft); font-size: 13px; line-height: 1.5; max-width: 70ch; }

.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
thead th {
  position: sticky;
  top: 0;
  background: var(--head);
  text-align: left;
  font-weight: 600;
  color: var(--ink-soft);
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
th.wk { text-align: center; width: 48px; font-variant-numeric: tabular-nums; }
.kpi-col { min-width: 300px; max-width: 340px; }
td.kpi-col { padding: 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
.kpi-name { line-height: 1.4; }
.meta-col { width: 84px; white-space: nowrap; }
td.meta-col {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  border-left: 1px solid var(--border);
  font-weight: 600;
  vertical-align: top;
}
tbody td.cell { border-bottom: 1px solid var(--border); }
.detail-link {
  margin-top: 6px;
  background: transparent;
  border: 0;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.detail-link:hover { text-decoration: underline; }
</style>
