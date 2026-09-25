<script setup>
// La consola inferior es navegación de trabajo: no repite el inspector ni ocupa la barra del mapa.
// Muestra las solicitudes de la búsqueda abierta y, al costado, las consultas guardadas en este
// navegador, para retomar una sin volver a buscarla.
//
// Es la consola de la base, pieza por pieza: la banda son las pestañas (En curso · Todas) con las
// acciones al borde (maximizar, cerrar); la subbanda dice qué consulta se está viendo; el cuerpo es una
// tabla, y las consultas guardadas son el sidebar interno (`.split-side`), que se pliega solo bajo 600.
// Como en una consola angosta ese sidebar no está, la subbanda ofrece la misma elección en un select.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { bindPanelMaximize, readPref, savePref } from '../workbench.js'
import { useTrazador } from '../stores/trazador'

const emit = defineEmits(['close'])
const t = useTrazador()
const key = (recent) => recent.personKey
  ? `${recent.target}:persona:${recent.personKey}`
  : `${recent.target}:consulta:${recent.q}`
const data = (recent) => {
  const total = Number.isInteger(recent.total) ? recent.total : null
  const documentNumber = recent.document || ''
  const phone = recent.phone || ''
  return {
    entryKey: key(recent),
    target: recent.target,
    kind: documentNumber ? 'Cédula' : (phone ? 'Teléfono' : (recent.kind || '')),
    queryText: documentNumber || phone || recent.q,
    meta: total === null ? recent.target : `${recent.target} · ${total} ${total === 1 ? 'solicitud' : 'solicitudes'}`,
  }
}
const activeKey = computed(() => {
  if (!t.results || !t.q.trim()) return ''
  const people = Array.isArray(t.results.people) ? t.results.people : []
  const keys = people.length === 1
    ? [people[0]?.personKey]
    : [...new Set((t.results.items || []).map((item) => item?.personKey).filter(Boolean))]
  return keys.length === 1
    ? `${t.target}:persona:${keys[0]}`
    : `${t.target}:consulta:${t.q.trim()}`
})
// Qué consulta se está viendo, dicho como en el sidebar: «Cédula 38612965».
const currentQuery = computed(() => {
  const recent = t.recentItems.find((item) => key(item) === activeKey.value)
  if (!recent) return t.q.trim()
  const { kind, queryText } = data(recent)
  return [kind, queryText].filter(Boolean).join(' ')
})
const inProgress = computed(() => (t.results?.items || [])
  .filter((item) => item.outcome === 'en-curso' || /en curso/i.test(item.statusN || ''))
  .sort((a, b) => `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`)))
const all = computed(() => [...(t.results?.items || [])]
  .sort((a, b) => `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`)))
// La pestaña de la consola es una preferencia: se recuerda, pero no va en la ruta (no es lo que se mira).
const mainView = ref(readPref('trazador.console-view', 'in-progress') === 'all' ? 'all' : 'in-progress')
watch(mainView, (v) => savePref('trazador.console-view', v))
const directQuery = computed(() => (t.results?.items || []).filter((item) => item.direct).length === 1)
// Por teléfono/cédula interesa primero qué sigue vivo. Por UREQ, en cambio, ya se tiene una solicitud
// abierta y lo útil es ver de inmediato todos los intentos de esa persona, sin esconderlos en una pestaña.
watch(() => t.results, () => {
  mainView.value = directQuery.value ? 'all' : (inProgress.value.length ? 'in-progress' : 'all')
})
const rows = computed(() => mainView.value === 'in-progress' ? inProgress.value : all.value)
const date = (item) => [item.date, item.time].filter(Boolean).join(' · ') || 'sin fecha'
// Abrir una fila no es una nueva consulta: carga esta solicitud dentro del grupo que ya está abierto.
const openInProgress = (item) => t.viewTrace(item.ureq)
const status = (item) => item.statusN || item.outcome?.replace('-', ' ') || '—'
// El desenlace es un DATO en castellano; la clase que lo pinta sale de esta tabla, nunca del dato.
const STATUS_CLASS = { aprobado: 'ok', 'en-curso': 'ok', roto: 'fail', abandonado: 'warn' }
const statusClass = (item) => STATUS_CLASS[item.outcome] || ''
// El select de la subbanda: el otro camino para elegir una consulta guardada cuando no hay sidebar.
function openByKey(entryKey) {
  const recent = t.recentItems.find((item) => key(item) === entryKey)
  if (recent) t.openRecent(recent)
}

// Maximizar es el de la base: temporal, Escape desde la consola restaura. La raíz que tapa es la
// columna central (`.workspace` de `App.vue`), no un `.workbench`.
const maximizeButton = ref(null)
let maximize = null
onMounted(() => {
  const button = maximizeButton.value
  if (button) maximize = bindPanelMaximize(button, { root: button.closest('.workspace'), panel: button.closest('.panel') })
})
onBeforeUnmount(() => { maximize?.set(false); maximize?.destroy() })
function close() {
  maximize?.set(false)
  emit('close')
}
// El pie también la pliega: al hacerlo se deshace el maximizado, o el editor quedaría tapado sin consola.
defineExpose({ restore: () => maximize?.set(false) })
</script>

<template>
  <section class="recent" aria-label="Solicitudes y consultas recientes">
    <nav class="tabs" role="tablist" aria-label="Solicitudes de la búsqueda">
      <button type="button" class="tab" role="tab" :aria-selected="mainView === 'in-progress'" @click="mainView = 'in-progress'">
        En curso <span class="count">{{ inProgress.length }}</span>
      </button>
      <button type="button" class="tab" role="tab" :aria-selected="mainView === 'all'" @click="mainView = 'all'">
        Todas <span class="count">{{ all.length }}</span>
      </button>
      <div class="region-actions">
        <button ref="maximizeButton" type="button" class="region-action"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" title="Ocultar recientes" aria-label="Ocultar recientes" @click="close">
          <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
    </nav>

    <div class="subband">
      <span v-if="t.results" class="grow"><strong>{{ currentQuery }}</strong> · {{ t.target }} · más reciente primero</span>
      <span v-else class="grow">Ninguna consulta abierta</span>
      <span v-if="t.recentItems.length" class="select recent-picker">
        <select class="input input-xs" aria-label="Consulta guardada" :value="activeKey" @change="openByKey($event.target.value)">
          <option value="" disabled>Consultas guardadas</option>
          <option v-for="recent in t.recentItems" :key="data(recent).entryKey" :value="data(recent).entryKey">
            {{ [data(recent).kind, data(recent).queryText].filter(Boolean).join(' ') }} · {{ data(recent).target }}
          </option>
        </select>
      </span>
    </div>

    <div class="split">
      <div class="split-main" aria-live="polite">
        <table v-if="t.results && rows.length" class="table"
               :aria-label="`${mainView === 'in-progress' ? 'Solicitudes en curso' : 'Todas las solicitudes'} ordenado de forma descendente`">
          <thead><tr><th>Solicitud</th><th>Comercio</th><th>Fecha</th><th>Estado</th></tr></thead>
          <tbody>
            <tr v-for="item in rows" :key="item.ureq" class="request-row" :class="{ on: item.ureq === t.trace?.ureq }"
                tabindex="0" :aria-selected="item.ureq === t.trace?.ureq" :title="`Abrir solicitud ${item.ureq}`"
                @click="openInProgress(item)" @keydown.enter.prevent="openInProgress(item)">
              <td class="request-id">{{ item.ureq }}</td>
              <td class="request-merchant">{{ item.merchant || '—' }}</td>
              <td class="request-date">{{ date(item) }}</td>
              <td class="request-status" :class="statusClass(item)">{{ status(item) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">
          <div class="empty-desc">{{ t.results
            ? `No hay solicitudes ${mainView === 'in-progress' ? 'en curso' : 'en esta consulta'}.`
            : 'Buscá una persona para ver sus solicitudes.' }}</div>
        </div>
      </div>

      <aside class="split-side" aria-label="Consultas guardadas">
        <div class="region-head group"><span>Consultas guardadas</span><span class="count">{{ t.recentItems.length }}</span></div>
        <div v-if="t.recentItems.length" class="recent-list" role="list">
          <div v-for="recent in t.recentItems" :key="data(recent).entryKey" class="row recent-row"
               :class="{ on: data(recent).entryKey === activeKey }" role="listitem">
            <button type="button" class="recent-open" :aria-current="data(recent).entryKey === activeKey ? 'page' : undefined"
                    :title="`Abrir ${data(recent).queryText} en ${data(recent).target}`" @click="t.openRecent(recent)">
              <span class="recent-query"><span v-if="data(recent).kind" class="recent-kind">{{ data(recent).kind }}</span>{{ data(recent).queryText }}</span>
              <span class="row-meta">{{ data(recent).meta }}</span>
            </button>
            <div class="row-actions">
              <button type="button" class="region-action" :aria-label="`Borrar consulta ${data(recent).queryText}`"
                      :title="`Borrar ${data(recent).queryText} de este navegador`" @click="t.removeRecent(recent)">
                <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </div>
        <p v-else class="recent-none">Las consultas que abras quedan acá, en este navegador.</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* Casi todo es de la base (tabs, subband, split, table, row, row-actions, count, empty). Acá queda lo
   que sólo significa algo en esta consola: las columnas de la tabla, la solicitud elegida y cómo se
   abre una consulta guardada. */
.recent { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; container-type:inline-size;
  --region-bg:var(--card) }
/* El select de la subbanda es el otro camino para elegir una consulta: aparece cuando la base pliega
   el sidebar interno, bajo 600. */
.recent-picker { display:none; flex:none; width:200px }
@container (max-width: 600px) { .recent-picker { display:block } }

.table th { position:sticky; top:0; z-index:1; background:var(--region-bg) }
.table td { max-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dim) }
.table th:first-child { width:112px }
.table th:nth-child(3) { width:168px }
.table th:last-child { width:96px }
.request-row { cursor:pointer }
.request-row:hover td { background:var(--hover) }
/* La solicitud abierta es la fila elegida de la `.table` de la base (`tr.on`). */
.request-id { font-family:var(--font-mono); font-size:var(--text-sm); color:var(--txt) }
.request-date { font-variant-numeric:tabular-nums }
.request-status { font-weight:600 }
.request-row.on .request-status:not(.ok):not(.fail):not(.warn) { color:var(--accent-foreground) }

/* Una consulta guardada: la fila de la base, con el botón que la abre ocupando lo que queda. */
.recent-list { padding:var(--space-1) 0 }
.recent-open { display:flex; flex:1; align-items:center; gap:var(--space-2); min-width:0; height:var(--row-h); padding:0;
  border:0; background:none; color:inherit; font:inherit; text-align:left; cursor:pointer }
.recent-open:focus-visible { outline-offset:-2px }
.recent-query { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; font-family:var(--font-mono); font-size:var(--text-sm) }
.recent-kind { margin-right:var(--space-1); font-family:var(--font-sans); color:var(--faint) }
.row.on .recent-kind { color:var(--accent-foreground) }
.recent-none { margin:0; padding:var(--space-2) var(--gutter); color:var(--faint); font-size:var(--text-sm) }
</style>
