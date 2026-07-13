<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const WS_URL = 'ws://localhost:8787/ws'

const status = ref('conectando…')
const dash = ref(null)
const loading = ref(false)
const errorMsg = ref('')
const activity = ref(null)
let ws = null
let retry = null

const online = computed(() => status.value === 'server on')

function connect() {
  ws = new WebSocket(WS_URL)
  ws.onopen = () => { status.value = 'server on'; refresh() }
  ws.onmessage = (e) => {
    let d
    try { d = JSON.parse(e.data) } catch { return }
    if (d.type === 'dashboard_data') {
      loading.value = false
      if (d.ok) { dash.value = d; errorMsg.value = '' }
      else errorMsg.value = d.error || 'error'
    } else if (d.type === 'activity_data') {
      if (d.ok) activity.value = d
    }
  }
  ws.onclose = () => { status.value = 'desconectado'; retry = setTimeout(connect, 1500) }
  ws.onerror = () => ws && ws.close()
}

function refresh() {
  if (!online.value) return
  loading.value = true
  ws.send(JSON.stringify({ type: 'dashboard' }))
  ws.send(JSON.stringify({ type: 'activity' }))
}

// --- helpers de presentación ---
const sprint = computed(() => dash.value?.sprint || {})
const counts = computed(() => dash.value?.counts || { total: 0, todo: 0, inProgress: 0, done: 0, donePct: 0 })
const tasks = computed(() => dash.value?.tasks || [])
const points = computed(() => dash.value?.points || { hasData: false })
const timeData = computed(() => dash.value?.time || { hasData: false })

const seg = computed(() => {
  const t = counts.value.total || 1
  return {
    done: (counts.value.done / t) * 100,
    prog: (counts.value.inProgress / t) * 100,
    todo: (counts.value.todo / t) * 100,
  }
})

// ¿voy al día? comparo % tareas hechas vs % tiempo transcurrido
const pace = computed(() => {
  const done = counts.value.donePct || 0
  const time = sprint.value.timePct || 0
  if (done >= time) return { label: 'vas al día 🟢', cls: 'ok' }
  if (done >= time - 25) return { label: 'un poco atrás 🟡', cls: 'warn' }
  return { label: 'vas atrasado 🔴', cls: 'bad' }
})

// --- heatmap de actividad estilo GitHub ---
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const dayLabels = ['', 'Lun', '', 'Mié', '', 'Vie', '']

function levelFor(n) {
  if (n <= 0) return 0
  if (n <= 2) return 1
  if (n <= 5) return 2
  if (n <= 11) return 3
  return 4
}
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const heatmap = computed(() => {
  if (!activity.value) return null
  const days = activity.value.days || {}
  const WEEKS = 26
  const end = new Date(); end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - (WEEKS * 7 - 1))
  start.setDate(start.getDate() - start.getDay()) // retroceder al domingo

  const cells = []
  const cur = new Date(start)
  while (cur <= end) {
    const iso = toISO(cur)
    const count = days[iso] || 0
    cells.push({ date: iso, count, level: levelFor(count) })
    cur.setDate(cur.getDate() + 1)
  }

  const weeks = Math.ceil(cells.length / 7)
  const monthCols = []
  let prev = -1
  for (let w = 0; w < weeks; w++) {
    const first = cells[w * 7]
    const m = first ? new Date(first.date + 'T00:00:00').getMonth() : prev
    monthCols.push(m !== prev ? MONTHS[m] : '')
    prev = m
  }
  return { cells, monthCols, total: activity.value.total }
})

const CAT = {
  new: { label: 'Por hacer', cls: 'todo' },
  indeterminate: { label: 'En curso', cls: 'prog' },
  done: { label: 'Hecho', cls: 'done' },
}
function catOf(c) { return CAT[c] || CAT.new }

onMounted(connect)
onBeforeUnmount(() => { clearTimeout(retry); ws && ws.close() })
</script>

<template>
  <main class="wrap">
    <div class="shell">
      <header class="head">
        <div>
          <h1>Mi sprint</h1>
          <p class="sub">Dashboard personal · Jira</p>
        </div>
        <div class="head-right">
          <span class="status" :class="online ? 'on' : 'off'"><span class="dot"></span>{{ status }}</span>
          <button class="refresh" :disabled="!online || loading" @click="refresh">{{ loading ? '…' : '↻ Refrescar' }}</button>
        </div>
      </header>

      <p v-if="errorMsg" class="banner err">✗ {{ errorMsg }}</p>
      <p v-else-if="!dash" class="banner">Cargando tu sprint…</p>

      <template v-if="dash">
        <!-- Sprint + timeline -->
        <section class="card sprint">
          <div class="sprint-top">
            <div>
              <h2>{{ sprint.name }}</h2>
              <p class="dates">{{ sprint.start }} → {{ sprint.end }}</p>
            </div>
            <div class="daysleft" :class="sprint.daysLeft <= 1 ? 'urgent' : ''">
              ⏳ {{ sprint.daysLeft }} {{ sprint.daysLeft === 1 ? 'día' : 'días' }} restante{{ sprint.daysLeft === 1 ? '' : 's' }}
            </div>
          </div>
          <div class="timeline">
            <div class="tl-fill" :style="{ width: sprint.timePct + '%' }"></div>
          </div>
          <p class="tl-label">Día {{ sprint.daysElapsed }} de {{ sprint.daysTotal }} · {{ sprint.timePct }}% del tiempo transcurrido</p>
        </section>

        <!-- KPI tiles -->
        <section class="tiles">
          <div class="tile"><div class="big">{{ counts.total }}</div><div class="lbl">Tareas</div></div>
          <div class="tile todo"><div class="big">{{ counts.todo }}</div><div class="lbl">Por hacer</div></div>
          <div class="tile prog"><div class="big">{{ counts.inProgress }}</div><div class="lbl">En curso</div></div>
          <div class="tile done"><div class="big">{{ counts.done }}</div><div class="lbl">Hechas</div></div>
        </section>

        <!-- Avance + ritmo -->
        <section class="card">
          <div class="prog-head">
            <b>Avance de tareas</b>
            <span>{{ counts.done }} / {{ counts.total }} · {{ counts.donePct }}%</span>
          </div>
          <div class="segbar">
            <div class="s-done" :style="{ width: seg.done + '%' }"></div>
            <div class="s-prog" :style="{ width: seg.prog + '%' }"></div>
            <div class="s-todo" :style="{ width: seg.todo + '%' }"></div>
          </div>
          <p class="pace" :class="pace.cls">
            Ritmo: {{ sprint.timePct }}% del tiempo · {{ counts.donePct }}% hecho → <b>{{ pace.label }}</b>
          </p>
        </section>

        <!-- Heatmap de actividad (estilo GitHub) -->
        <section v-if="heatmap" class="card">
          <div class="hm-title">
            <b>Actividad</b>
            <span>{{ heatmap.total }} cambios · últimas 26 semanas</span>
          </div>
          <div class="hm-scroll">
            <div class="hm">
              <div class="hm-months"><span v-for="(m, i) in heatmap.monthCols" :key="i">{{ m }}</span></div>
              <div class="hm-body">
                <div class="hm-days"><span v-for="(dl, i) in dayLabels" :key="i">{{ dl }}</span></div>
                <div class="hm-grid">
                  <div
                    v-for="(cel, i) in heatmap.cells" :key="i"
                    class="hm-cell" :class="'lv' + cel.level"
                    :title="cel.count + (cel.count === 1 ? ' cambio' : ' cambios') + ' · ' + cel.date"
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div class="hm-legend">
            <span>Menos</span><i class="lv0"></i><i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i><span>Más</span>
          </div>
        </section>

        <!-- Puntos / Horas (secundario) -->
        <section class="tiles two">
          <div class="tile soft">
            <div class="big">{{ points.hasData ? (points.done + '/' + points.total) : '—' }}</div>
            <div class="lbl">Story points{{ points.hasData ? ' (hechos/total)' : '' }}</div>
          </div>
          <div class="tile soft">
            <div class="big">{{ timeData.hasData ? (timeData.spentHours + 'h') : '—' }}</div>
            <div class="lbl">Horas dedicadas</div>
          </div>
        </section>
        <p v-if="!points.hasData || !timeData.hasData" class="note">
          Tus tareas aún no tienen <b>story points</b> ni <b>estimación de tiempo</b> en Jira. En cuanto empieces a cargarlos, este panel los mostrará automáticamente.
        </p>

        <!-- Lista de tareas -->
        <section class="card">
          <b class="list-title">Mis tareas del sprint</b>
          <ul class="tasks">
            <li v-for="t in tasks" :key="t.key">
              <span class="chip" :class="catOf(t.category).cls">{{ catOf(t.category).label }}</span>
              <a :href="t.url" target="_blank" rel="noopener" class="key">{{ t.key }}</a>
              <span class="summ">{{ t.summary }}</span>
              <span v-if="t.points != null" class="pts">{{ t.points }} pts</span>
            </li>
            <li v-if="!tasks.length" class="empty">No tienes tareas asignadas en el sprint activo.</li>
          </ul>
        </section>
      </template>

      <p class="future">Tu herramienta personal · datos en vivo de tu sprint por WebSocket.</p>
    </div>
  </main>
</template>

<style scoped>
.wrap { min-height: 100vh; padding: 28px 20px; display: flex; justify-content: center; }
.shell { width: min(760px, 100%); }

.head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.head h1 { font-size: 26px; margin: 0; letter-spacing: -0.02em; }
.sub { color: var(--ink-soft); font-size: 13px; margin: 3px 0 0; }
.head-right { display: flex; align-items: center; gap: 10px; }
.status { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 999px; }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.status.on { color: #1c8a4a; background: #d3f0dc; }
.status.off { color: #b3261e; background: #fddad3; }
.refresh { border: 1px solid var(--border-strong); background: var(--surface); border-radius: 8px; padding: 6px 11px; font: inherit; font-size: 12.5px; cursor: pointer; }
.refresh:disabled { opacity: 0.5; cursor: default; }

.banner { text-align: center; color: var(--ink-soft); padding: 30px; }
.banner.err { color: var(--red-ink); }

.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  padding: 18px 20px; margin-bottom: 14px;
}
.sprint-top { display: flex; justify-content: space-between; align-items: flex-start; }
.sprint h2 { font-size: 17px; margin: 0; }
.dates { color: var(--ink-soft); font-size: 12.5px; margin: 3px 0 0; }
.daysleft { font-size: 13px; font-weight: 700; background: var(--head); padding: 6px 12px; border-radius: 999px; white-space: nowrap; }
.daysleft.urgent { background: var(--red-bg); color: var(--red-ink); }
.timeline { height: 8px; border-radius: 999px; background: var(--head); overflow: hidden; margin: 14px 0 6px; }
.tl-fill { height: 100%; background: var(--accent); border-radius: 999px; }
.tl-label { font-size: 12px; color: var(--ink-soft); margin: 0; }

.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.tiles.two { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 560px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
.tile {
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px; text-align: center;
}
.tile .big { font-size: 30px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.tile .lbl { font-size: 11.5px; color: var(--ink-soft); margin-top: 6px; }
.tile.todo .big { color: #6b7280; }
.tile.prog .big { color: #1e4fa3; }
.tile.done .big { color: #1c8a4a; }
.tile.soft { background: var(--head); }

.prog-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 10px; }
.prog-head span { color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.segbar { display: flex; height: 12px; border-radius: 999px; overflow: hidden; background: var(--head); }
.s-done { background: #34c77b; } .s-prog { background: #4c7ef0; } .s-todo { background: #d1d5db; }
.pace { font-size: 12.5px; margin: 12px 0 0; }
.pace.ok { color: #1c8a4a; } .pace.warn { color: #b8860b; } .pace.bad { color: var(--red-ink); }

.note { font-size: 12px; color: var(--ink-soft); line-height: 1.5; margin: -4px 2px 16px; }
.note b { color: var(--ink); }

.list-title { font-size: 13px; display: block; margin-bottom: 10px; }
.tasks { list-style: none; margin: 0; padding: 0; }
.tasks li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--border); font-size: 13px; }
.tasks li:first-of-type { border-top: 0; }
.chip { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.chip.todo { background: #eceef1; color: #4b5563; }
.chip.prog { background: #dbe6fe; color: #1e4fa3; }
.chip.done { background: #d3f0dc; color: #1c6b3a; }
.key { font-weight: 700; color: var(--accent); text-decoration: none; white-space: nowrap; }
.summ { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.pts { font-size: 11px; color: var(--ink-soft); white-space: nowrap; }
.empty { color: var(--ink-soft); }

/* heatmap estilo GitHub */
.hm-title { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; margin-bottom: 12px; }
.hm-title span { color: var(--ink-soft); font-size: 12px; }
.hm-scroll { overflow-x: auto; padding-bottom: 4px; }
.hm { display: inline-block; }
.hm-months { display: grid; grid-template-columns: repeat(26, 13px); margin-left: 25px; font-size: 9px; color: var(--ink-soft); margin-bottom: 3px; }
.hm-body { display: flex; gap: 3px; }
.hm-days { display: grid; grid-template-rows: repeat(7, 11px); gap: 2px; font-size: 8.5px; color: var(--ink-soft); width: 22px; }
.hm-days span { line-height: 11px; }
.hm-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); grid-auto-columns: 11px; gap: 2px; }
.hm-cell { width: 11px; height: 11px; border-radius: 2px; }
.hm-legend { display: flex; align-items: center; gap: 3px; justify-content: flex-end; margin-top: 10px; font-size: 10px; color: var(--ink-soft); }
.hm-legend i { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.lv0 { background: #ebedf0; } .lv1 { background: #9be9a8; } .lv2 { background: #40c463; } .lv3 { background: #30a14e; } .lv4 { background: #216e39; }

.future { text-align: center; color: var(--ink-soft); font-size: 12px; margin-top: 20px; }
</style>
