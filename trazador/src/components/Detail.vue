<script setup>
// El inspector es un REGISTRO, no otra representación del mapa. El mapa responde «por dónde fue»;
// acá se leen todas las líneas en secuencia sin abrir acordeones para cada sub-paso.
import { computed, nextTick, ref, watch } from 'vue'
import { useTrazador } from '../stores/trazador'

const emit = defineEmits(['close'])
const t = useTrazador()
const filter = ref('')
const logEntry = ref(null)
const anchors = new Map()

const STATUS = {
  ok: 'completó', warn: 'con avisos', fail: 'falló', skip: 'sin actividad',
  pendiente: 'sin registro', 'sin-evidencia': 'sin evidencia', 'sin-registro': 'sin registro',
  'no-aplica': 'no aplica', condicional: 'condicional',
}

const actual = computed(() => t.activeStage)
const q = computed(() => filter.value.trim().toLocaleLowerCase())

function includeStep(step, events, evidences, counter) {
  if (step.evidence) evidences.push({
    kind: 'evidencia', step: step.label, evidence: step.evidence, status: step.status,
  })
  for (const event of step.events || []) {
    events.push({
      kind: 'evento', step: step.label, at: event.at || '—', level: event.level || 'info',
      message: event.msg || '', source: step.source,
    })
  }
  counter.total += Number(step.eventsOf || step.events?.length || 0)
  for (const child of step.children || []) includeStep(child, events, evidences, counter)
}

// Las líneas dentro de cada etapa se ordenan por hora. Las etapas mantienen el orden del mapa, que es
// el único orden confiable cuando dos fuentes reportan la misma hora sin milisegundos.
function sectionOf(stage) {
  const events = []
  const evidences = []
  const counter = { total: 0 }
  for (const step of stage.live?.subs || []) includeStep(step, events, evidences, counter)
  events.sort((a, b) => a.at.localeCompare(b.at))
  return {
    id: stage.id,
    labelText: stage.label,
    status: stage.status,
    at: stage.live?.at || '',
    reasonText: stage.live?.reason || '',
    detail: stage.live?.detail || stage.because || '',
    lines: [...evidences, ...events],
    total: counter.total,
  }
}

const sections = computed(() => (t.stages || []).map(sectionOf))
const text = (section, line = null) => [
  section.labelText, section.status, section.reasonText, section.detail,
  line?.step, line?.message, line?.evidence?.source, ...(line?.evidence?.rows || []),
].filter(Boolean).join(' ').toLocaleLowerCase()
const matches = (section, line) => !q.value || text(section, line).includes(q.value)

const visibleSections = computed(() => sections.value.map((section) => {
  const matchesStage = !q.value || text(section).includes(q.value)
  const lines = matchesStage ? section.lines : section.lines.filter((line) => matches(section, line))
  return { ...section, lines: lines, matchesStage: matchesStage }
}).filter((section) => {
  if (q.value) return section.matchesStage || section.lines.length
  // El registro enumera hechos, no huecos: las etapas sin una línea no gastan alto. La seleccionada
  // queda como ancla incluso vacía, para que un clic en el mapa siempre tenga una respuesta visible.
  return section.lines.length || section.reasonText || section.detail || section.id === actual.value?.id
}))

const totalLines = computed(() => sections.value.reduce((total, section) => total + section.lines.length, 0))
const totalVisibles = computed(() => visibleSections.value.reduce((total, section) => total + section.lines.length, 0))

function logText() {
  const lines = [`TRAZADOR · ${t.trace?.target || t.target} · solicitud ${t.trace?.ureq ?? '—'}`]
  for (const section of visibleSections.value) {
    lines.push(`\n── ${section.labelText} · ${STATUS[section.status] || section.status}${section.at ? ` · ${section.at}` : ''} ──`)
    if (section.reasonText) lines.push(`MOTIVO  ${section.reasonText}`)
    else if (section.detail && section.detail.length <= 180) lines.push(`CONTEXTO  ${section.detail}`)
    for (const line of section.lines) {
      if (line.kind === 'evidencia') {
        lines.push(`BD · ${line.step} · ${line.evidence.source}`)
        for (const row of line.evidence.rows || []) lines.push(`  ${row}`)
        if (line.evidence.sql) lines.push(`  SQL  ${line.evidence.sql.replace(/\s+/g, ' ').trim()}`)
      } else {
        lines.push(`${line.at}  ${line.step}  ${(line.level || 'info').toUpperCase()}  ${line.message}`)
      }
    }
  }
  return lines.join('\n')
}
function copyLog() {
  const copyWithSelection = (content) => {
    const area = document.createElement('textarea')
    area.value = content
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  const content = logText()
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(content).catch(() => copyWithSelection(content))
  else copyWithSelection(content)
}

function anchor(id, element) {
  if (element) anchors.set(id, element)
  else anchors.delete(id)
}
async function focusStage(id) {
  if (!id) return
  await nextTick()
  const target = anchors.get(id)
  if (!target || !logEntry.value) return
  logEntry.value.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior: 'smooth' })
}
function selectStage(id) {
  t.selectedStage = id
  focusStage(id)
}
watch(() => actual.value?.id, (id) => { focusStage(id) }, { immediate: true })
</script>

<template>
  <main class="detail-panel">
    <header class="detail-topbar">
      <span>Registro</span>
      <span v-if="t.trace" class="toolbar-note">Solicitud #{{ t.trace.ureq }}</span>
      <button type="button" class="region-action" title="Ocultar panel" aria-label="Ocultar logs" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </header>

    <section v-if="t.trace" id="panel-detalle" class="registro-view" aria-label="Registro completo de la corrida">
      <header class="registro-toolbar">
        <span class="registro-identidad">{{ t.trace.target || t.target }} · {{ totalLines }} registros</span>
        <input v-model="filter" class="input input-xs" type="search" placeholder="buscar en el registro…"
               aria-label="Buscar en todo el registro" />
        <span v-if="filter" class="registro-conteo">{{ totalVisibles }} visibles</span>
        <button type="button" class="region-action registro-copy"
                aria-label="Copiar registro visible"
                :title="filter ? 'Copiar registros filtrados' : 'Copiar registro completo'"
                @click="copyLog">
          <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
        </button>
      </header>

      <div ref="logEntry" class="registro-body" aria-live="polite">
        <section v-for="section in visibleSections" :key="section.id" :ref="(el) => anchor(section.id, el)"
                 class="log-stage" :class="{ activa: actual?.id === section.id }">
          <button type="button" class="stage-bar" :aria-current="actual?.id === section.id ? 'step' : undefined"
                  :title="`Ir a ${section.labelText} en el mapa`" @click="selectStage(section.id)">
            <span class="stage-dot" :class="section.status" aria-hidden="true"></span>
            <span class="stage-label">{{ section.labelText }}</span>
            <span v-if="section.at" class="stage-time">{{ section.at }}</span>
            <span class="stage-status">{{ STATUS[section.status] || section.status }}</span>
          </button>

          <p v-if="section.reasonText" class="stage-reason">{{ section.reasonText }}</p>
          <p v-else-if="section.detail && section.detail.length <= 180" class="stage-detail">{{ section.detail }}</p>

          <div v-if="section.lines.length" class="log-lines" role="list">
            <template v-for="(line, index) in section.lines" :key="`${line.kind}-${index}-${line.step}`">
              <details v-if="line.kind === 'evidencia'" class="log-evidence" role="listitem">
                <summary>
                  <span class="log-kind">BD</span><span class="log-step">{{ line.step }}</span>
                  <span class="log-summary">{{ line.evidence.source }}</span><span class="accordion-chev">⌄</span>
                </summary>
                <p v-for="(row, rowIndex) in line.evidence.rows" :key="rowIndex" class="evidence-row">{{ row }}</p>
                <details class="query accordion-item"><summary class="accordion-trigger">consulta SQL<span class="accordion-chev">⌄</span></summary><pre class="accordion-content">{{ line.evidence.sql }}</pre></details>
              </details>
              <div v-else class="log-line" :class="`nivel-${line.level}`" role="listitem">
                <time>{{ line.at }}</time>
                <span class="log-step" :title="line.step">{{ line.step }}</span>
                <span class="log-level">{{ line.level === 'error' ? 'ERROR' : (line.level || 'INFO').toUpperCase() }}</span>
                <span class="log-message">{{ line.message }}</span>
              </div>
            </template>
            <p v-if="section.total > section.lines.filter((line) => line.kind === 'evento').length" class="log-cut">
              {{ section.lines.filter((line) => line.kind === 'evento').length }} de {{ section.total }} líneas de log; los errores se priorizan en el recorte.
            </p>
          </div>
          <p v-else class="stage-empty">Sin líneas registradas para esta etapa.</p>
        </section>

        <div v-if="!visibleSections.length" class="empty inspector-vacio">
          <div class="empty-head">
            <div class="empty-media" aria-hidden="true">⌕</div>
            <p class="empty-title">No hay coincidencias</p>
            <p class="empty-desc">Probá otra palabra, código o nombre de etapa.</p>
          </div>
        </div>
      </div>
    </section>

    <div v-else class="empty inspector-vacio">
      <div class="empty-head">
        <div class="empty-media" aria-hidden="true">⌁</div>
        <p class="empty-title">Elegí una solicitud</p>
        <p class="empty-desc">El registro completo de la corrida aparecerá acá.</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.detail-panel { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; overflow:hidden;
  container-type:inline-size; background:var(--card) }
.detail-topbar { flex:none; display:flex; align-items:center; gap:8px; min-height:42px; padding:0 12px;
  color:var(--txt); border-bottom:1px solid var(--line); font-size:13px; font-weight:600 }
.detail-topbar .toolbar-note { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--dim); font-size:11px; font-weight:400; font-variant-numeric:tabular-nums }
.detail-topbar .region-action { margin-left:auto; border:1px solid transparent; border-radius:var(--r-sm); background:transparent }
.detail-topbar .region-action:hover { color:var(--primary); border-color:var(--line); background:var(--panel2) }

.registro-view { display:flex; flex:1; flex-direction:column; min-width:0; min-height:0; overflow:hidden }
.registro-toolbar { flex:none; display:flex; align-items:center; gap:8px; min-height:38px; padding:0 12px;
  border-bottom:1px solid var(--line); background:var(--panel2) }
.registro-identidad { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dim);
  font:11px/1 var(--font-mono); font-variant-numeric:tabular-nums }
.registro-toolbar .input { flex:1 1 120px; min-width:90px; max-width:230px; margin-left:auto; font-weight:400 }
.registro-conteo { flex:none; color:var(--tenue); font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap }
.registro-copy { flex:none; border:1px solid transparent; border-radius:var(--r-sm); color:var(--dim); background:transparent }
.registro-copy:hover { color:var(--txt); border-color:var(--line); background:var(--card) }

.registro-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin;
  scrollbar-color:var(--line) transparent; background:var(--card) }
.log-stage { scroll-margin-top:4px; border-bottom:1px solid var(--line) }
.stage-bar { position:sticky; top:0; z-index:1; display:grid; grid-template-columns:8px minmax(0,1fr) max-content max-content;
  align-items:center; gap:8px; width:100%; min-height:31px; padding:0 12px; color:var(--dim); background:var(--card);
  border:0; border-bottom:1px solid var(--line); text-align:left; font:600 11px/1 var(--font-sans); cursor:pointer }
.stage-bar:hover { color:var(--txt); background:var(--sel) }
.stage-bar:focus-visible { outline:2px solid var(--ring); outline-offset:-2px }
.log-stage.activa .stage-bar { color:var(--txt); background:color-mix(in srgb, var(--primary) 8%, var(--card)); box-shadow:inset 2px 0 0 var(--primary) }
.stage-dot { width:7px; height:7px; border-radius:var(--r-full); background:var(--skip) }
.stage-dot.ok { background:var(--ok) }.stage-dot.fail { background:var(--fail) }.stage-dot.warn { background:var(--warn) }
.stage-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.stage-time, .stage-status { color:var(--tenue); font-size:10px; font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap }
.stage-status { text-transform:lowercase }
.stage-reason, .stage-detail { margin:0; padding:8px 12px; color:var(--dim); font-size:11px; line-height:1.5 }
.stage-reason { color:var(--fail); background:color-mix(in srgb, var(--fail) 4%, var(--card)); border-left:2px solid var(--fail) }
.stage-empty { margin:0; padding:8px 12px 10px 28px; color:var(--tenue); font-size:11px }

.log-lines { font:11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace }
.log-line { display:grid; grid-template-columns:44px minmax(72px, .65fr) max-content minmax(0, 2fr); gap:8px;
  align-items:start; padding:4px 12px; color:var(--dim); border-bottom:1px solid color-mix(in srgb, var(--line) 70%, transparent) }
.log-line:hover { background:var(--sel); color:var(--txt) }
.log-line time { color:var(--tenue); font-variant-numeric:tabular-nums; white-space:nowrap }
.log-step { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--texto-2) }
.log-level { color:var(--tenue); font-size:10px; white-space:nowrap }
.log-message { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap }
.nivel-error { color:var(--fail); background:color-mix(in srgb, var(--fail) 4%, var(--card)) }
.nivel-error .log-level { color:var(--fail); font-weight:700 }
.log-cut { margin:0; padding:7px 12px 8px; color:var(--tenue); font:10.5px/1.45 var(--font-sans) }

.log-evidence { margin:0; padding:0 12px; color:var(--dim); border-bottom:1px solid color-mix(in srgb, var(--line) 70%, transparent);
  background:color-mix(in srgb, var(--info) 4%, var(--card)) }
.log-evidence > summary { display:grid; grid-template-columns:26px minmax(0,1fr) max-content 12px; gap:8px; align-items:center;
  min-height:29px; cursor:pointer; list-style:none; font:11px/1.3 var(--font-sans) }
.log-evidence > summary::-webkit-details-marker { display:none }
.log-kind { color:var(--info); font:600 10px/1 var(--font-mono) }.log-summary { color:var(--tenue); font-size:10px }
.evidence-row { margin:0; padding:2px 0; color:var(--texto-2); font:11px/1.45 ui-monospace, SFMono-Regular, monospace; overflow-wrap:anywhere }
.query { margin:6px 0 8px; border-bottom:0 }.query .accordion-trigger { padding:0; font-size:10px; font-weight:500 }
.query pre { margin:4px 0 0; padding:6px 8px; overflow:auto; color:var(--dim); background:var(--panel2); border-radius:var(--r-sm); font:10px/1.45 ui-monospace, SFMono-Regular, monospace }

.inspector-vacio { display:grid; flex:1; min-height:0; place-items:center; padding:20px 12px; background:var(--card) }
.empty-head { max-width:230px; text-align:center }.empty-media { margin:0 auto 8px }.empty-title { margin:0; color:var(--txt); font-size:12px; font-weight:600 }.empty-desc { margin:4px 0 0; color:var(--dim); font-size:11px; line-height:1.45 }

@container (max-width: 430px) {
  .registro-toolbar { flex-wrap:wrap; align-content:center; padding-top:6px; padding-bottom:6px }
  .registro-toolbar .input { order:3; flex:1 0 100%; max-width:none }
  .stage-bar { grid-template-columns:8px minmax(0,1fr) max-content; padding-left:10px; padding-right:10px }
  .stage-status { display:none }.log-line { grid-template-columns:42px minmax(0,1fr) max-content; gap:6px; padding-left:10px; padding-right:10px }
  .log-line .log-step { grid-column:2; grid-row:1 }.log-line .log-level { grid-column:3; grid-row:1 }
  .log-line .log-message { grid-column:2 / -1; grid-row:2 }.log-evidence { padding-left:10px; padding-right:10px }
}
</style>
