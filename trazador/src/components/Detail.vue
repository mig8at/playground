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

// El estado es un DATO en castellano; lo que se pinta es una de las cinco clases de estado de
// `style.css`. Así el nombre del estado nunca es un selector.
const STATUS_CLASS = { ok: 'ok', warn: 'warn', fail: 'fail', 'sin-evidencia': 'unknown' }
const statusClass = (status) => STATUS_CLASS[status] || 'skip'

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
  <aside class="log-panel" aria-label="Registro">
    <!-- La banda de 40, como todas las columnas: título, qué solicitud y las acciones (copiar, cerrar). -->
    <div class="region-head">
      <span>Registro</span>
      <span v-if="t.trace" class="toolbar-note">Solicitud #{{ t.trace.ureq }}</span>
      <div class="region-actions">
        <button v-if="t.trace" type="button" class="region-action"
                aria-label="Copiar registro visible"
                :title="filter ? 'Copiar registros filtrados' : 'Copiar registro completo'"
                @click="copyLog">
          <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
        </button>
        <button type="button" class="region-action" title="Ocultar panel" aria-label="Ocultar logs" @click="emit('close')">
          <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <template v-if="t.trace">
      <!-- LA SUBBANDA dice qué se está viendo y lleva el filtro. Con el filtro puesto, el contador lo
           delata (`.count.filtered`: «3 / 7»). -->
      <div class="subband log-toolbar">
        <span class="log-identity">{{ t.trace.target || t.target }}</span>
        <input v-model="filter" class="input input-xs log-filter" type="search" placeholder="buscar en el registro…"
               aria-label="Buscar en todo el registro" />
        <span class="count" :class="{ filtered: filter }">{{ filter ? `${totalVisibles} / ${totalLines}` : totalLines }}</span>
      </div>

      <div ref="logEntry" class="region-body log-body" aria-live="polite" aria-label="Registro completo de la corrida">
        <section v-for="section in visibleSections" :key="section.id" :ref="(el) => anchor(section.id, el)"
                 class="log-stage" :class="{ on: actual?.id === section.id }">
          <!-- Cada etapa es un encabezado de grupo de la base (`button.region-head.group`): se pega arriba
               mientras se recorren sus líneas, así siempre se sabe en cuál se está. -->
          <button type="button" class="region-head group stage-head" :aria-current="actual?.id === section.id ? 'step' : undefined"
                  :title="`Ir a ${section.labelText} en el mapa`" @click="selectStage(section.id)">
            <span class="stage-label"><span class="stage-dot" :class="statusClass(section.status)" aria-hidden="true"></span><span class="stage-name">{{ section.labelText }}</span></span>
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
              <!-- Una línea de log de la base: mono de 12 sobre 20, la hora aparte y apagada, sin
                   separadores entre líneas. -->
              <div v-else class="log-line" :class="`level-${line.level}`" role="listitem">
                <span class="log-time">{{ line.at }}</span>
                <span class="log-step" :title="line.step">{{ line.step }}</span>
                <span class="log-level">{{ line.level || 'info' }}</span>
                <span class="log-message">{{ line.message }}</span>
              </div>
            </template>
            <p v-if="section.total > section.lines.filter((line) => line.kind === 'evento').length" class="log-cut">
              {{ section.lines.filter((line) => line.kind === 'evento').length }} de {{ section.total }} líneas de log; los errores se priorizan en el recorte.
            </p>
          </div>
          <p v-else class="stage-empty">Sin líneas registradas para esta etapa.</p>
        </section>

        <div v-if="!visibleSections.length" class="empty">
          <div class="empty-desc">No hay coincidencias: probá otra palabra, código o nombre de etapa.</div>
        </div>
      </div>
    </template>

    <div v-else class="empty">
      <div class="empty-desc">Elegí una solicitud: el registro completo de la corrida aparecerá acá.</div>
    </div>
  </aside>
</template>

<style scoped>
/* La banda, la subbanda, el cuerpo que scrollea, el encabezado de grupo, la línea de log y el estado
   vacío son de la base. Queda lo que sólo significa algo en este registro: las columnas de una línea,
   el estado de cada etapa y la evidencia de BD. */
.log-panel { container-type:inline-size }
/* Posicionado: `focusStage` scrollea al `offsetTop` de la etapa, que se mide contra este cuerpo. */
.log-body { position:relative }
.log-identity { flex:none; font-family:var(--font-mono); font-size:var(--text-xs) }
.log-filter { flex:1 1 120px; min-width:90px; max-width:240px; margin-left:auto }

/* El encabezado de cada etapa: el nombre (con su punto de estado) se estira; hora y estado al borde.
   El padding a los costados es el de la banda, así el texto arranca a 12 del borde. */
.stage-head { gap:var(--space-2); padding:0 var(--gutter) }
.stage-label { display:flex; align-items:center; gap:var(--space-2) }
/* La etapa elegida en el mapa, como la fila elegida de la base: la superficie del acento y la barra
   de 2 a la izquierda. ⚠ `--accent` es opaco, así que el encabezado pegado sigue tapando las líneas. */
.log-stage.on > .stage-head { background:var(--accent); color:var(--accent-foreground); box-shadow:inset 2px 0 0 var(--primary) }
.stage-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.stage-dot { flex:none; width:8px; height:8px; border-radius:999px; background:currentColor }
.stage-time, .stage-status { flex:none; color:var(--faint); font-size:var(--text-xs); font-weight:400; font-variant-numeric:tabular-nums; white-space:nowrap }
.log-stage.on .stage-time, .log-stage.on .stage-status { color:var(--accent-foreground) }
.stage-reason, .stage-detail { margin:0; padding:var(--space-2) var(--gutter); color:var(--dim); font-size:var(--text-sm) }
/* Un callout: la barra a la izquierda y un tinte, cuadrado. */
.stage-reason { color:var(--fail); background:color-mix(in oklab, var(--fail) 6%, transparent); border-left:2px solid var(--fail) }
.stage-empty { margin:0; padding:var(--space-1) var(--gutter) var(--space-2); color:var(--faint); font-size:var(--text-sm) }

/* Las líneas: las cuatro columnas de un registro. La hora y el nivel se quedan con su ancho; el paso
   se corta; el mensaje envuelve. */
.log-lines { padding:var(--space-1) 0 }
.log-step { flex:0 1 96px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dim) }
.log-level { flex:none; color:var(--faint); font-size:var(--text-xs) }
.log-message { flex:1 1 0; min-width:0 }
/* El nivel de error se lee en la tinta, no en un fondo. */
.level-error .log-level, .level-error .log-message { color:var(--fail) }
.level-error .log-level { font-weight:600 }
.log-cut { margin:0; padding:var(--space-1) var(--gutter) var(--space-2); color:var(--faint); font-size:var(--text-xs) }

/* La evidencia de BD: un `<details>` que se abre sobre sus filas y su consulta. Es un ESTADO, no un
   evento, así que no se escribe como una línea de log. */
.log-evidence { margin:0; padding:0 var(--gutter); color:var(--dim) }
.log-evidence > summary { display:flex; align-items:center; gap:var(--space-2); min-height:var(--row-h); cursor:pointer;
  list-style:none; font-size:var(--text-sm) }
.log-evidence > summary::-webkit-details-marker { display:none }
.log-evidence .log-step { flex:1 1 0 }
.log-kind { flex:none; color:var(--info); font-family:var(--font-mono); font-size:var(--text-xs); font-weight:600 }
.log-summary { flex:none; color:var(--faint); font-size:var(--text-xs) }
.evidence-row { margin:0; color:var(--dim); font-family:var(--font-mono); font-size:var(--text-xs); overflow-wrap:anywhere }
.query { margin:var(--space-1) 0 var(--space-2); border-bottom:0 }
.query .accordion-trigger { padding:0; font-size:var(--text-xs) }
.query pre { margin:var(--space-1) 0 0; overflow:auto; color:var(--dim); font-family:var(--font-mono); font-size:var(--text-xs) }

/* Angosto, el mensaje baja a su propio renglón y el estado de la etapa se va (el punto lo dice). */
@container (max-width: 430px) {
  .log-line { flex-wrap:wrap; row-gap:0 }
  .log-message { flex-basis:100% }
  .stage-status { display:none }
}
</style>
