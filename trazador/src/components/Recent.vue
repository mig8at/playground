<script setup>
// La consola inferior es navegación de trabajo: no repite el inspector ni ocupa la barra del mapa.
// Guarda las últimas corridas del navegador, para retomar una sin volver a buscarla.
import { computed, ref, watch } from 'vue'
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
const description = computed(() => t.recentItems.length
  ? 'Elegí una consulta para volver a abrir su grupo de solicitudes.'
  : 'Las consultas que abras quedarán disponibles en este navegador.')
const inProgress = computed(() => (t.results?.items || [])
  .filter((item) => item.outcome === 'en-curso' || /en curso/i.test(item.statusN || ''))
  .sort((a, b) => `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`)))
const all = computed(() => [...(t.results?.items || [])]
  .sort((a, b) => `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`)))
const vistaPrincipal = ref('en-curso')
const directQuery = computed(() => (t.results?.items || []).filter((item) => item.direct).length === 1)
// Por teléfono/cédula interesa primero qué sigue vivo. Por UREQ, en cambio, ya se tiene una solicitud
// abierta y lo útil es ver de inmediato todos los intentos de esa persona, sin esconderlos en una pestaña.
watch(() => t.results, () => {
  vistaPrincipal.value = directQuery.value ? 'todas' : (inProgress.value.length ? 'en-curso' : 'todas')
})
const rows = computed(() => vistaPrincipal.value === 'en-curso' ? inProgress.value : all.value)
const date = (item) => [item.date, item.time].filter(Boolean).join(' · ') || 'sin fecha'
// Abrir una fila no es una nueva consulta: carga esta solicitud dentro del grupo que ya está abierto.
const openInProgress = (item) => t.viewTrace(item.ureq)
const status = (item) => item.statusN || item.outcome?.replace('-', ' ') || '—'
const statusClass = (item) => `estado-${item.outcome || 'desconocido'}`
</script>

<template>
  <section class="recientes-console" aria-label="Consultas recientes">
    <header class="console-head">
      <div class="console-tabs" role="tablist" aria-label="Panel inferior">
        <span class="console-tab" role="tab" aria-selected="true">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
          Recientes
          <span class="console-count">{{ t.recentItems.length }}</span>
        </span>
      </div>
      <p class="console-note">{{ description }}</p>
      <div class="region-actions toolbar">
        <button type="button" class="region-action" title="Ocultar recientes" aria-label="Ocultar recientes" @click="emit('close')">
          <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
    </header>

    <div class="console-body">
      <div class="console-stage" aria-live="polite">
        <section v-if="t.results" class="solicitudes-curso" aria-label="Solicitudes de la búsqueda">
          <header class="curso-head">
            <div class="curso-tabs" role="tablist" aria-label="Solicitudes de la búsqueda">
              <button type="button" role="tab" :aria-selected="vistaPrincipal === 'en-curso'" @click="vistaPrincipal = 'en-curso'">
                En curso <span>{{ inProgress.length }}</span>
              </button>
              <button type="button" role="tab" :aria-selected="vistaPrincipal === 'todas'" @click="vistaPrincipal = 'todas'">
                Todas <span>{{ all.length }}</span>
              </button>
            </div>
            <span>más reciente primero</span>
          </header>
          <div v-if="rows.length" class="curso-tabla" role="table" :aria-label="`${vistaPrincipal === 'en-curso' ? 'Solicitudes en curso' : 'Todas las solicitudes'} ordenado de forma descendente`">
            <div class="curso-fila curso-columnas" role="row">
              <span role="columnheader">Solicitud</span><span role="columnheader">Comercio</span>
              <span role="columnheader">Fecha</span><span role="columnheader">Estado</span>
            </div>
            <button v-for="item in rows" :key="item.ureq" type="button" class="curso-fila curso-dato" role="row"
                    :class="{ seleccionada: item.ureq === t.trace?.ureq }"
                    :title="`Abrir solicitud ${item.ureq}`" @click="openInProgress(item)">
              <span class="curso-ureq" role="cell">{{ item.ureq }}</span>
              <span class="curso-comercio" role="cell">{{ item.merchant || '—' }}</span>
              <span class="curso-fecha" role="cell">{{ date(item) }}</span>
              <span class="curso-estado" :class="statusClass(item)" role="cell">{{ status(item) }}</span>
            </button>
          </div>
          <div v-else class="curso-vacio">No hay solicitudes {{ vistaPrincipal === 'en-curso' ? 'en curso' : 'en esta consulta' }}.</div>
        </section>
        <div v-else class="stage-vacio">
          <span class="prompt-mark" aria-hidden="true">›</span>
          <div>
            <p class="stage-title">{{ t.results ? 'No hay solicitudes en curso' : 'Esperando una consulta' }}</p>
            <p class="stage-copy">{{ t.results ? 'Esta búsqueda no tiene solicitudes abiertas.' : 'Buscá una persona para ver sus solicitudes en curso.' }}</p>
          </div>
        </div>
      </div>

      <aside class="console-sidebar" aria-label="Navegador de consultas recientes">
        <header class="console-sidebar-head">
          <span class="console-sidebar-title">Consultas</span>
          <span class="console-sidebar-caption">guardadas localmente</span>
          <span class="sidebar-count">{{ t.recentItems.length }}</span>
        </header>
        <div v-if="t.recentItems.length" class="lista-recientes" aria-label="Consultas recientes guardadas">
          <div v-for="recent in t.recentItems" :key="data(recent).entryKey" class="reciente" :class="{ activa: data(recent).entryKey === activeKey }">
            <button type="button" class="abrir-reciente" :aria-current="data(recent).entryKey === activeKey ? 'page' : undefined"
                    :title="`Abrir ${data(recent).queryText} en ${data(recent).target}`" @click="t.openRecent(recent)">
              <span class="reciente-texto">
                <span class="reciente-consulta"><span v-if="data(recent).kind" class="reciente-tipo">{{ data(recent).kind }}</span>{{ data(recent).queryText }}</span>
                <span class="reciente-meta">{{ data(recent).meta }}</span>
              </span>
            </button>
            <button type="button" class="borrar-reciente" :aria-label="`Borrar consulta ${data(recent).queryText}`"
                    :title="`Borrar ${data(recent).queryText} de este navegador`" @click="t.removeRecent(recent)">
              <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div v-else class="sidebar-vacio">No hay corridas guardadas.</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.recientes-console { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; container-type:inline-size;
  background:var(--card); border-top:1px solid var(--line) }
.console-head { flex:none; display:flex; align-items:center; min-height:38px; gap:12px; padding:0 10px;
  border-bottom:1px solid var(--line); background:var(--panel2) }
.console-tabs { align-self:stretch; display:flex; align-items:stretch }
.console-tab { display:flex; align-items:center; gap:6px; min-width:0; padding:0 4px; color:var(--txt);
  border-bottom:2px solid var(--primary); font-size:12px; font-weight:600 }
.console-tab .ui-icon { width:14px; height:14px; color:var(--primary) }
.console-count { display:grid; place-items:center; min-width:18px; height:18px; padding:0 5px; border-radius:var(--r-full);
  color:var(--secondary-foreground); background:var(--secondary); font-size:10px; font-variant-numeric:tabular-nums }
.console-note { min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--dim); font-size:11px }
.console-head .region-actions { margin-left:auto }
.console-head .region-action { border:1px solid transparent; border-radius:var(--r-sm) }
.console-head .region-action:hover { color:var(--primary); border-color:var(--line); background:var(--card) }
.console-body { flex:1; display:flex; min-width:0; min-height:0; overflow:hidden }
.console-stage { flex:1 1 0; min-width:0; min-height:0; background:color-mix(in srgb, var(--panel2) 42%, var(--card)); color:var(--dim) }
.solicitudes-curso { display:flex; flex-direction:column; min-width:0; height:100% }
.curso-head { flex:none; display:flex; align-items:center; gap:10px; min-height:32px; padding:0 12px; border-bottom:1px solid var(--line) }
.curso-head > :last-child { margin-left:auto; color:var(--tenue); font-size:10px; white-space:nowrap }
.curso-tabs { align-self:stretch; display:flex; align-items:stretch; gap:3px }
.curso-tabs button { display:flex; align-items:center; gap:5px; padding:0 7px; color:var(--tenue); background:none; border:0; border-bottom:2px solid transparent;
  font:600 10px/1 var(--font-sans); cursor:pointer }
.curso-tabs button:hover { color:var(--txt) }.curso-tabs button[aria-selected="true"] { color:var(--txt); border-bottom-color:var(--primary) }
.curso-tabs button:focus-visible { outline:2px solid var(--primary); outline-offset:-2px }
.curso-tabs button span { display:grid; place-items:center; min-width:16px; height:16px; padding:0 4px; color:var(--secondary-foreground); background:var(--secondary);
  border-radius:var(--r-full); font-size:9px; font-variant-numeric:tabular-nums }
.curso-tabla { min-height:0; overflow:auto }
.curso-fila { display:grid; grid-template-columns:106px minmax(120px, 1fr) 132px 62px; align-items:center; gap:8px; min-width:0; width:100%; padding:0 12px;
  text-align:left; font-size:11px }
.curso-columnas { position:sticky; top:0; z-index:1; min-height:25px; color:var(--dim); background:var(--panel2); border-bottom:1px solid var(--line);
  font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase }
.curso-dato { min-height:34px; color:var(--dim); background:transparent; border:0; border-bottom:1px solid var(--line); cursor:pointer }
.curso-dato:hover { color:var(--txt); background:color-mix(in srgb, var(--primary) 7%, var(--panel2)); box-shadow:inset 2px 0 0 var(--primary) }
.curso-dato.seleccionada { color:var(--txt); background:color-mix(in srgb, var(--primary) 12%, var(--panel2)); box-shadow:inset 2px 0 0 var(--primary) }
.curso-dato:focus-visible { outline:2px solid var(--primary); outline-offset:-2px }
.curso-fila > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.curso-ureq { color:var(--txt); font-family:var(--font-mono); font-size:12px }
.curso-comercio { color:var(--dim) }.curso-fecha { color:var(--tenue); font-variant-numeric:tabular-nums }
.curso-estado { color:var(--dim); font-size:10px; font-weight:600 }.curso-estado.estado-en-curso { color:var(--ok) }
.curso-estado.estado-aprobado { color:var(--ok) }.curso-estado.estado-roto { color:var(--fail) }
.curso-estado.estado-abandonado { color:var(--warn) }.curso-vacio { padding:14px 12px; color:var(--dim); font-size:11px }
.stage-vacio { display:flex; align-items:center; justify-content:center; gap:10px; min-width:0; height:100%; padding:16px }
.prompt-mark { flex:none; color:var(--primary); font:24px/1 var(--font-mono) }
.stage-title, .stage-copy { margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.stage-title { color:var(--txt); font:600 12px/1.45 var(--font-mono) }
.stage-copy { margin-top:2px; font-size:11px }
.console-sidebar { flex:0 0 236px; display:flex; flex-direction:column; min-width:0; min-height:0;
  background:var(--card); border-left:1px solid var(--line) }
.console-sidebar-head { flex:none; display:flex; align-items:center; gap:6px; min-height:38px; padding:0 12px;
  border-bottom:1px solid var(--line) }
.console-sidebar-title { color:var(--txt); font-size:11px; font-weight:600 }
.console-sidebar-caption { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--tenue); font-size:10px }
.sidebar-count { display:grid; place-items:center; min-width:17px; height:17px; padding:0 4px; border-radius:var(--r-full);
  color:var(--secondary-foreground); background:var(--secondary); font-size:10px; letter-spacing:0; font-variant-numeric:tabular-nums }
.console-sidebar-caption + .sidebar-count { margin-left:auto }
.lista-recientes { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; padding:0 }
.reciente { display:flex; align-items:center; min-width:0; min-height:46px; color:var(--dim);
  background:transparent; border-bottom:1px solid var(--line); box-shadow:inset 2px 0 0 transparent }
.reciente:hover { color:var(--txt); background:color-mix(in srgb, var(--secondary) 38%, var(--card)) }
.reciente.activa { color:var(--txt); background:color-mix(in srgb, var(--secondary) 66%, var(--card)); box-shadow:inset 2px 0 0 var(--primary) }
.abrir-reciente { flex:1; display:flex; align-items:center; min-width:0; min-height:46px; padding:7px 4px 7px 12px;
  color:inherit; text-align:left; font:12px/1.2 inherit; font-variant-numeric:tabular-nums; background:none; border:0; cursor:pointer }
.abrir-reciente:focus-visible, .borrar-reciente:focus-visible { outline:2px solid var(--primary); outline-offset:-1px }
.reciente-texto { display:flex; flex-direction:column; gap:2px; min-width:0 }
.reciente-consulta, .reciente-meta { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.reciente-consulta { color:var(--txt); font-family:var(--font-mono); font-size:12px; font-weight:550 }
.reciente-tipo { margin-right:5px; color:var(--tenue); font-family:var(--font-sans); font-size:10px; font-weight:500 }
.reciente-meta { color:var(--tenue); font-size:10px }
.borrar-reciente { flex:none; display:grid; place-items:center; width:24px; height:24px; margin-right:4px; padding:0;
  color:var(--tenue); background:none; border:0; border-radius:var(--r-sm); cursor:pointer; opacity:0; transition:opacity .12s ease }
.reciente:hover .borrar-reciente, .reciente:focus-within .borrar-reciente { opacity:1 }
.borrar-reciente:hover { color:var(--fail); background:color-mix(in srgb, var(--fail) 10%, transparent); opacity:1 }
.sidebar-vacio { padding:16px 12px; color:var(--tenue); font-size:11px; line-height:1.45 }
@container (max-width: 520px) {
  .console-note { display:none }
  .console-stage { display:none }
  .console-sidebar { flex:1; border-left:0 }
}
</style>
