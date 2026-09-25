<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { readPreference, savePreference } from './ui-state.js';
import { bindPanelMaximize } from './workbench.js';

const props = defineProps({
  snapshot: { type: Object, required: true },
  taskLabel: { type: String, default: '' },
  refreshing: { type: Boolean, default: false },
  refreshError: { type: String, default: '' },
});
const emit = defineEmits(['close', 'refresh']);
const branches = computed(() => props.snapshot.branches || []);
const repos = computed(() => {
  const groups = new Map();
  for (const branch of branches.value) {
    if (!groups.has(branch.repo)) groups.set(branch.repo, { id: branch.repo, name: branch.repo, branches: [] });
    groups.get(branch.repo).branches.push(branch);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
});
const chosen = ref(readPreference('ramas-repo-tarea', ''));
const repo = computed(() => repos.value.find((item) => item.id === chosen.value) || repos.value[0] || null);

watch(repo, (current) => {
  if (!current || chosen.value === current.id) return;
  chosen.value = current.id;
}, { immediate: true });
watch(chosen, (id) => savePreference('ramas-repo-tarea', id));

const ENVIRONMENT_ORDER = ['develop', 'staging', 'qa', 'main'];
const environments = computed(() => {
  const seen = new Set();
  for (const branch of repo.value?.branches || []) {
    for (const environment of Object.keys(branch.own || {})) seen.add(environment);
  }
  return ENVIRONMENT_ORDER.filter((a) => seen.has(a))
    .concat([...seen].filter((a) => !ENVIRONMENT_ORDER.includes(a)).sort());
});

const prLabel = (pr) => {
  if (!pr) return 'sin PR';
  if (pr.draft) return 'borrador';
  if (pr.state === 'MERGED') return 'mergeado';
  if (pr.state === 'CLOSED') return 'cerrado';
  if (pr.revision === 'APPROVED') return 'aprobado';
  if (pr.revision === 'CHANGES_REQUESTED') return 'piden cambios';
  if (pr.revision === 'REVIEW_REQUIRED') return 'por revisar';
  return 'abierto';
};
const environmentTitle = (branch, environment) => {
  if (!(environment in (branch.own || {}))) return `${environment} no existe en este repositorio`;
  if (!branch.in?.[environment]) return `el cambio todavía no está en ${environment}`;
  return branch.how?.[environment] === 'pr'
    ? `llegó a ${environment} por el commit del PR`
    : `el patch de la rama ya está en ${environment}`;
};
const exactMeasurement = computed(() => {
  if (!props.snapshot.measuredAt) return '';
  const date = new Date(props.snapshot.measuredAt);
  if (Number.isNaN(date.getTime())) return props.snapshot.measuredAt;
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
});
// El botón de maximizar es el de la base: temporal, Escape desde la consola restaura.
const maximizeButton = ref(null);
let maximize = null;
onMounted(() => { if (maximizeButton.value) maximize = bindPanelMaximize(maximizeButton.value); });
onBeforeUnmount(() => { maximize?.set(false); maximize?.destroy(); });
const relativeMeasurement = computed(() => {
  if (!props.snapshot.measuredAt) return 'sin medición';
  const min = Math.max(0, Math.round((Date.now() - new Date(props.snapshot.measuredAt).getTime()) / 60000));
  if (!Number.isFinite(min)) return 'medición sin fecha';
  if (min < 2) return 'medido recién';
  if (min < 60) return `medido hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `medido hace ${hours} h`;
  return `medido hace ${Math.round(hours / 24)} d`;
});
</script>

<template>
  <!-- La consola de ramas, en la forma de la base: banda de 40 con las acciones (refrescar, maximizar,
       cerrar), subbanda con el repo elegido y la leyenda, la tabla, y el sidebar interno de repos a la
       derecha. Con la consola angosta el sidebar se pliega solo y el repo se elige en la subbanda. -->
  <div class="repo-branches" aria-label="Consola de ramas de la tarea">
    <div class="region-head">
      <span class="console-title">Ramas <span class="count">{{ branches.length }}</span></span>
      <span class="console-meta">{{ taskLabel || 'Tarea' }} · Git local ·
        <time v-if="snapshot.measuredAt" :datetime="snapshot.measuredAt" :title="exactMeasurement">{{ relativeMeasurement }}</time>
        <span v-else>sin medición</span>
        <span v-if="refreshing" class="refresh-state" role="status"> · midiendo Git y PRs…</span>
        <span v-else-if="refreshError" class="refresh-error" role="status" :title="refreshError"> · sin actualizar</span>
      </span>
      <div class="region-actions">
        <button type="button" class="region-action" :disabled="refreshing" :aria-busy="refreshing"
                :aria-label="refreshing ? 'Actualizando ramas' : 'Refrescar ramas'"
                :title="refreshing ? 'Midiendo Git y PRs…' : 'Refrescar ramas'" @click="emit('refresh')">
          <span v-if="refreshing" class="spinner branch-spinner" aria-hidden="true"></span>
          <span v-else class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
        </button>
        <button ref="maximizeButton" type="button" class="region-action"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" aria-label="Ocultar ramas" title="Ocultar ramas" @click="maximize?.set(false); emit('close')">
          <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <template v-if="repo">
      <div class="subband">
        <span class="grow"><strong>{{ repo.name }}</strong> · {{ repo.branches.length }} {{ repo.branches.length === 1 ? 'rama' : 'ramas' }} de esta tarea</span>
        <span class="select repo-picker"><select v-model="chosen" class="input input-xs" aria-label="Repositorio">
          <option v-for="item in repos" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select></span>
        <span class="environment-legend" aria-label="Leyenda de ambientes: llegó, pendiente, no aplica">
          <span title="el cambio llegó al ambiente"><b class="reached">✓</b> llegó</span>
          <span title="el ambiente existe pero el cambio todavía no llegó"><b>·</b> pendiente</span>
          <span title="ese ambiente no existe en el repositorio"><b>—</b> no aplica</span>
        </span>
      </div>
      <div class="split">
        <div class="split-main branch-table">
          <table class="table" :aria-label="`Ramas de ${repo.name} para ${taskLabel || 'la tarea'}`">
            <thead><tr>
              <th>Rama</th><th>PR</th>
              <th v-for="environment in environments" :key="environment" :class="{ main: environment === 'main' }">{{ environment }}</th>
              <th>Commit</th>
            </tr></thead>
            <tbody>
              <tr v-for="branch in repo.branches" :key="branch.branch">
                <td class="branch-name" :title="branch.branch"><span>{{ branch.branch }}</span><span v-if="branch.local" class="badge badge-outline badge-xs">local</span></td>
                <td class="pr-cell">
                  <a v-if="branch.pr" :href="branch.pr.url" target="_blank" rel="noopener">#{{ branch.pr.number }}</a>
                  <span :class="{ open: branch.pr?.state === 'OPEN' }">{{ prLabel(branch.pr) }}</span>
                </td>
                <td v-for="environment in environments" :key="environment" class="environment"
                    :class="{ main: environment === 'main', reached: branch.in?.[environment] }"
                    :title="environmentTitle(branch, environment)" :aria-label="environmentTitle(branch, environment)">
                  <span v-if="!(environment in (branch.own || {}))">—</span><span v-else-if="branch.in?.[environment]">✓</span><span v-else>·</span>
                </td>
                <td class="commit" :title="`${branch.commit} · ${branch.subject}`"><code>{{ branch.commit }}</code><span>{{ branch.subject }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <aside class="split-side" aria-label="Repositorios de la tarea">
          <div class="region-head group"><span>Repos de esta tarea</span><span class="count">{{ repos.length }}</span></div>
          <div class="repo-list" role="listbox" aria-label="Repositorios trabajados en la tarea">
            <div v-for="item in repos" :key="item.id" class="row" :class="{ on: item.id === repo.id }"
                 role="option" tabindex="0" :aria-selected="item.id === repo.id"
                 @click="chosen = item.id" @keydown.enter.prevent="chosen = item.id" @keydown.space.prevent="chosen = item.id">
              <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
              <span>{{ item.name }}</span>
              <span class="row-meta" :title="`${item.branches.length} ${item.branches.length === 1 ? 'rama' : 'ramas'}`">{{ item.branches.length }}</span>
            </div>
          </div>
        </aside>
      </div>
    </template>

    <div v-else class="empty-branches">
      <strong>{{ taskLabel || 'Esta tarea' }}</strong><span>no tiene ramas asociadas en la medición local.</span><code>make tareas-ramas</code>
    </div>
  </div>
</template>

<style scoped>
/* Casi todo es de la base (region-head, subband, split, table, row, count). Acá queda lo que sólo
   significa algo en esta consola: los ambientes, las dos columnas fijas y el color del estado. */
.repo-branches { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; container-type:inline-size;
  --region-bg: var(--card) }
/* `.region-head > :first-child` de la base estira el primer hijo; acá lo que se estira es la medición. */
.region-head > .console-title { flex:none; display:inline-flex; align-items:center; gap:var(--space-2) }
.console-meta { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--mut);
  font-size:var(--text-xs); font-weight:400 }
.refresh-state { color:var(--acc) }.refresh-error { color:var(--warn) }
.branch-spinner { width:14px; height:14px; border-width:1.5px }
.environment-legend { display:flex; align-items:center; gap:var(--space-3); color:var(--mut); font-size:var(--text-xs) }
.environment-legend > span { display:inline-flex; align-items:center; gap:var(--space-1) }
.environment-legend b { min-width:8px; text-align:center }
.environment-legend .reached { color:var(--ok) }
/* El repo se elige en el sidebar interno; cuando la consola es angosta ese sidebar no está (la base lo
   pliega bajo 600) y aparece este select en la subbanda, que es el otro camino para lo mismo. */
.repo-picker { display:none; width:180px; flex:none }
@container (max-width:600px) {
  .repo-picker { display:block }
  .console-meta, .environment-legend > span { display:none }
}
.branch-table { display:block }
.table { min-width:800px; border-collapse:separate; border-spacing:0 }
.table th { position:sticky; top:0; z-index:1; background:var(--card) }
.table td { max-width:260px; color:var(--mut); overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.table th:first-child, .table td:first-child { width:240px; min-width:240px; max-width:240px; position:sticky; left:0 }
.table th:nth-child(2), .table td:nth-child(2) { width:112px; min-width:112px; max-width:112px; position:sticky; left:240px;
  box-shadow:8px 0 10px -11px color-mix(in oklab, var(--txt) 75%, transparent) }
.table th:first-child, .table th:nth-child(2) { z-index:4 }
.table td:first-child, .table td:nth-child(2) { z-index:2; background:var(--card) }
.table th.main, .table td.main { background:color-mix(in oklab, var(--foreground) 3%, var(--card)); border-left:1px solid var(--line) }
.table tbody tr:hover td { background:color-mix(in oklab, var(--foreground) 5%, var(--card)) }
.branch-name { color:var(--txt); font-family:var(--font-mono); font-size:var(--text-sm) }
.branch-name .badge { margin-left:var(--space-2); vertical-align:middle; color:var(--warn) }
.pr-cell a { margin-right:var(--space-2); color:var(--acc); text-decoration:none }
.pr-cell span { font-size:var(--text-xs) }.pr-cell span.open { color:var(--warn) }
.environment { width:72px; text-align:center; font-weight:600 }.environment.reached { color:var(--ok) }
.commit code { margin-right:var(--space-2); padding:0; background:none; font-size:var(--text-sm) }.commit span { color:var(--mut) }
.repo-list { padding:var(--space-1) 0 }
.empty-branches { display:flex; align-items:center; justify-content:center; flex:1; gap:var(--space-2); padding:var(--space-4);
  color:var(--mut); font-size:var(--text-xs); text-align:center }.empty-branches strong { color:var(--txt) }
</style>
