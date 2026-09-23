<script setup>
import { computed, ref, watch } from 'vue';
import { readPreference, savePreference } from './ui-state.js';

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
  <section class="repo-branches" aria-label="Consola de ramas de la tarea">
    <header class="console-head">
      <div class="console-title">
        <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        <span>Ramas</span><span class="count">{{ branches.length }}</span>
      </div>
      <p>{{ taskLabel || 'Tarea' }} · Git local ·
        <time v-if="snapshot.measuredAt" :datetime="snapshot.measuredAt" :title="exactMeasurement">{{ relativeMeasurement }}</time>
        <span v-else>sin medición</span>
        <span v-if="refreshing" class="refresh-state" role="status"> · midiendo Git y PRs…</span>
        <span v-else-if="refreshError" class="refresh-error" role="status" :title="refreshError"> · sin actualizar</span>
      </p>
      <button type="button" class="region-action refresh-branches" :disabled="refreshing" :aria-busy="refreshing"
              :aria-label="refreshing ? 'Actualizando ramas' : 'Refrescar ramas'"
              :title="refreshing ? 'Midiendo Git y PRs…' : 'Refrescar ramas'" @click="emit('refresh')">
        <span v-if="refreshing" class="spinner branch-spinner" aria-hidden="true"></span>
        <span v-else class="ui-icon" data-icon="refresh" aria-hidden="true"></span>
      </button>
      <button type="button" class="region-action" aria-label="Ocultar ramas" title="Ocultar ramas" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </header>

    <div v-if="repo" class="console-body">
      <main class="console-main">
        <header class="table-head">
          <span><b>{{ repo.name }}</b></span>
          <span>{{ repo.branches.length }} {{ repo.branches.length === 1 ? 'rama' : 'ramas' }} de esta tarea</span>
          <span class="environment-legend" aria-label="Leyenda de ambientes: llegó, pendiente, no aplica">
            <span title="el cambio llegó al ambiente"><b class="reached">✓</b> llegó</span>
            <span title="el ambiente existe pero el cambio todavía no llegó"><b>·</b> pendiente</span>
            <span title="ese ambiente no existe en el repositorio"><b>—</b> no aplica</span>
          </span>
        </header>
        <div class="branch-table">
          <table :aria-label="`Ramas de ${repo.name} para ${taskLabel || 'la tarea'}`">
            <thead><tr>
              <th>Rama</th><th>PR</th>
              <th v-for="environment in environments" :key="environment" :class="{ main: environment === 'main' }">{{ environment }}</th>
              <th>Commit</th>
            </tr></thead>
            <tbody>
              <tr v-for="branch in repo.branches" :key="branch.branch">
                <td class="branch-name" :title="branch.branch"><span>{{ branch.branch }}</span><small v-if="branch.local">local</small></td>
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
      </main>

      <aside class="repo-sidebar" aria-label="Repositorios de la tarea">
        <header>Repos de esta tarea <span class="count">{{ repos.length }}</span></header>
        <div class="repo-list" role="listbox" aria-label="Repositorios trabajados en la tarea">
          <button v-for="item in repos" :key="item.id" type="button" class="repo-option"
                  :class="{ selected: item.id === repo.id }" role="option" :aria-selected="item.id === repo.id" @click="chosen = item.id">
            <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
            <span class="repo-text"><b>{{ item.name }}</b><small>{{ item.branches.length }} {{ item.branches.length === 1 ? 'rama' : 'ramas' }}</small></span>
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="empty-branches">
      <strong>{{ taskLabel || 'Esta tarea' }}</strong><span>no tiene ramas asociadas en la medición local.</span><code>make tareas-ramas</code>
    </div>
  </section>
</template>

<style scoped>
.repo-branches { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; container-type:inline-size;
  color:var(--txt); background:var(--card); border-top:1px solid var(--line) }
.console-head { flex:none; display:flex; align-items:center; min-height:36px; gap:10px; padding:0 10px;
  border-bottom:1px solid var(--line); background:var(--panel2) }
.console-title { display:flex; align-items:center; gap:6px; padding:0 4px; font-size:12px; font-weight:600 }
.console-title .ui-icon { width:14px; height:14px; color:var(--acc) }
.count { display:grid; place-items:center; min-width:18px; height:18px; padding:0 5px;
  color:var(--txt); background:var(--line2); border-radius:999px; font-size:10px; font-variant-numeric:tabular-nums }
.console-head p { min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--mut); font-size:11px }
.refresh-branches { margin-left:auto }.console-head .region-action + .region-action { margin-left:2px }
.refresh-state { color:var(--acc) }.refresh-error { color:var(--warn) }.branch-spinner { width:13px; height:13px; border-width:1.5px }
.console-body { flex:1; display:flex; min-width:0; min-height:0; overflow:hidden }
.console-main { flex:1 1 auto; display:flex; flex-direction:column; width:calc(100% - 220px); min-width:0; min-height:0;
  background:var(--card) }
.table-head { flex:none; display:flex; align-items:center; gap:10px; min-height:32px; padding:0 12px;
  color:var(--mut); border-bottom:1px solid var(--line); font-size:10px }
.table-head > :last-child { margin-left:auto; white-space:nowrap }.table-head b { color:var(--txt); font-size:11px }
.environment-legend { display:flex; align-items:center; gap:9px; color:var(--mut); font-size:9px }
.environment-legend > span { display:inline-flex; align-items:center; gap:3px }.environment-legend b { min-width:8px; text-align:center }
.environment-legend .reached { color:var(--ok) }
.branch-table { min-width:0; min-height:0; overflow:auto }
table { width:100%; min-width:800px; border-collapse:separate; border-spacing:0; font-size:11px }
th { position:sticky; top:0; z-index:1; height:27px; padding:0 10px; color:var(--mut); background:var(--panel2);
  border-bottom:1px solid var(--line); text-align:left; font-size:10.5px; font-weight:600 }
td { height:33px; max-width:260px; padding:0 10px; color:var(--mut); border-bottom:1px solid var(--line);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
th:first-child, td:first-child { width:230px; min-width:230px; max-width:230px; position:sticky; left:0 }
th:nth-child(2), td:nth-child(2) { width:108px; min-width:108px; max-width:108px; position:sticky; left:230px;
  box-shadow:8px 0 10px -11px color-mix(in oklab, var(--txt) 75%, transparent) }
th:first-child, th:nth-child(2) { z-index:4; background:var(--panel2) }
td:first-child, td:nth-child(2) { z-index:2; background:var(--card) }
th.main, td.main { background:color-mix(in oklab, var(--panel2) 82%, var(--card)); border-left:1px solid var(--line) }
tbody tr:hover td { background:color-mix(in oklab, var(--acc) 5%, var(--card)) }
tbody tr:hover td.main { background:color-mix(in oklab, var(--acc) 5%, var(--panel2)) }
.branch-name { color:var(--txt); font-family:var(--mono) }.branch-name span { vertical-align:middle }
.branch-name small { margin-left:7px; padding:1px 5px; color:var(--warn); border:1px solid var(--line); border-radius:999px; font:9px var(--font-sans) }
.pr-cell a { margin-right:6px; color:var(--acc); text-decoration:none }.pr-cell span { font-size:9.5px }.pr-cell span.open { color:var(--warn) }
.environment { width:70px; text-align:center; font-weight:700 }.environment.reached { color:var(--ok) }
.commit code { margin-right:6px; padding:0; background:none }.commit span { color:var(--mut) }
.repo-sidebar { flex:0 0 220px; display:flex; flex-direction:column; width:220px; min-width:0; min-height:0;
  background:var(--panel2); border-left:1px solid var(--line) }
.repo-sidebar > header { flex:none; display:flex; align-items:center; gap:7px; min-height:32px; padding:0 10px;
  color:var(--mut); border-bottom:1px solid var(--line); font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase }
.repo-list { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:2px; padding:6px }
.repo-option { display:flex; align-items:center; gap:8px; min-width:0; min-height:38px; padding:5px 8px; color:var(--mut);
  text-align:left; background:transparent; border:0; border-radius:var(--radius-md); cursor:pointer }
.repo-option:hover { color:var(--txt); background:color-mix(in oklab, var(--acc) 7%, var(--panel2)) }
.repo-option.selected { color:var(--txt); background:var(--accent) }
.repo-option:focus-visible { outline:2px solid var(--ring); outline-offset:-1px }.repo-option .ui-icon { flex:none; width:15px; height:15px; color:var(--mut) }
.repo-option.selected .ui-icon { color:var(--acc) }.repo-text { display:flex; flex:1; flex-direction:column; gap:2px; min-width:0 }
.repo-text b, .repo-text small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }.repo-text b { font-size:11px }
.repo-text small { color:var(--mut); font-size:9.5px }
.empty-branches { display:flex; align-items:center; justify-content:center; flex:1; gap:7px; padding:16px;
  color:var(--mut); font-size:11px; text-align:center }.empty-branches strong { color:var(--txt) }
@container (max-width:620px) {
  .console-head p { display:none }
  .console-main { width:calc(100% - 180px) }
  .repo-sidebar { flex-basis:180px; width:180px }
  .environment-legend { gap:5px }.environment-legend > span { font-size:0 }.environment-legend b { font-size:9px }
  table { min-width:760px }
}
</style>
