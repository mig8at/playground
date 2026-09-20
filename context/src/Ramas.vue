<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({ snapshot: { type: Object, required: true } })
const emit = defineEmits(['close'])
const repos = computed(() => props.snapshot.repos || [])
const guardado = localStorage.getItem('context.ramas.repo') || ''
const repoId = ref(repos.value.some((repo) => repo.id === guardado) ? guardado : (repos.value[0]?.id || ''))
const repo = computed(() => repos.value.find((item) => item.id === repoId.value) || repos.value[0] || null)
watch(repoId, (id) => localStorage.setItem('context.ramas.repo', id))

const ESTADOS = {
  'con-cambios': 'cambios locales',
  fusionada: 'fusionada',
  'remoto-ausente': 'remoto ausente',
  divergida: 'divergió',
  adelantada: 'adelantada',
  atrasada: 'atrasada',
  activa: 'activa',
  'sin-cambios': 'sin cambios propios',
  'al-dia': 'al día',
}

function diferencia(adelante, atras, referencia) {
  if (!adelante && !atras) return `igual a ${referencia}`
  return [`+${adelante}`, `−${atras}`, referencia].join(' ')
}
const contraMain = (rama) => rama.nombre === repo.value?.ramaBase
  ? 'rama base'
  : diferencia(rama.adelanteMain, rama.atrasMain, repo.value?.ramaBase || 'main')
const contraRemoto = (rama) => {
  if (!rama.remoto) return 'sin upstream'
  if (!rama.remotoExiste) return `${rama.remoto} ausente`
  return diferencia(rama.adelanteRemoto, rama.atrasRemoto, rama.remoto)
}
const fecha = (value) => value || 'sin fecha'
</script>

<template>
  <section class="ramas-console panel" aria-label="Ramas de los repositorios">
    <header class="console-head">
      <div class="console-tabs" role="tablist" aria-label="Panel inferior">
        <span class="console-tab" role="tab" aria-selected="true">
          <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
          Ramas
          <span class="console-count">{{ snapshot.resumen?.ramas || 0 }}</span>
        </span>
      </div>
      <p class="console-note">Git local · sin fetch · {{ snapshot.generado || 'sin medición' }}</p>
      <div class="region-actions toolbar" role="group" aria-label="Acciones de ramas">
        <button type="button" class="region-action" aria-label="Ocultar ramas" title="Ocultar ramas" @click="emit('close')">
          <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
        </button>
      </div>
    </header>

    <div v-if="repo" class="console-body">
      <main class="console-stage">
        <header class="tabla-head">
          <span><b>{{ repo.nombre }}</b> · base <code>{{ repo.ramaBase }}</code></span>
          <span>{{ repo.resumen.activas }} activas · {{ repo.resumen.fusionadas }} fusionadas</span>
        </header>
        <div class="ramas-tabla" role="table" :aria-label="`Ramas de ${repo.nombre}`">
          <div class="rama-fila rama-columnas" role="row">
            <span role="columnheader">Rama</span><span role="columnheader">Estado</span>
            <span role="columnheader">Contra main</span><span role="columnheader">Contra remoto</span>
            <span role="columnheader">Último cambio</span><span role="columnheader">Commit</span>
          </div>
          <div v-for="rama in repo.ramas" :key="rama.nombre" class="rama-fila rama-dato" :class="{ actual: rama.actual }" role="row">
            <span class="rama-nombre" role="cell" :title="rama.nombre">
              <span v-if="rama.actual" class="rama-actual" title="checkout actual" aria-label="checkout actual"></span>{{ rama.nombre }}
              <small v-if="rama.cambios">{{ rama.cambios }} sin commit</small>
            </span>
            <span role="cell"><span class="estado" :data-estado="rama.estado">{{ ESTADOS[rama.estado] || rama.estado }}</span></span>
            <span role="cell" :title="contraMain(rama)">{{ contraMain(rama) }}</span>
            <span role="cell" :title="contraRemoto(rama)">{{ contraRemoto(rama) }}</span>
            <span class="rama-fecha" role="cell">{{ fecha(rama.ultimoCambio) }}</span>
            <span class="rama-commit" role="cell" :title="`${rama.sha} · ${rama.autor} · ${rama.asunto}`">
              <code>{{ rama.sha }}</code> {{ rama.asunto }}
            </span>
          </div>
        </div>
      </main>

      <aside class="console-sidebar" aria-label="Repositorios">
        <header class="console-sidebar-head">
          <span>Repositorios</span><span class="sidebar-count">{{ repos.length }}</span>
        </header>
        <div class="lista-repos" role="listbox" aria-label="Repositorios indexados por context">
          <button v-for="item in repos" :key="item.id" type="button" class="repo"
                  :class="{ activa: item.id === repo.id }" role="option" :aria-selected="item.id === repo.id"
                  @click="repoId = item.id">
            <span class="ui-icon" data-icon="server" aria-hidden="true"></span>
            <span class="repo-texto">
              <span class="repo-nombre">{{ item.nombre }}</span>
              <span class="repo-meta"><code>{{ item.ramaActual || 'detached' }}</code><template v-if="item.cambios"> · {{ item.cambios }} cambios</template></span>
            </span>
            <span class="repo-count">{{ item.resumen.ramas }}</span>
          </button>
        </div>
      </aside>
    </div>

    <div v-else class="panel-vacio">
      No hay snapshot local. Ejecutá <code>make context-ramas</code> desde el playground.
    </div>
  </section>
</template>

<style scoped>
.ramas-console { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; container-type:inline-size;
  color:var(--foreground); background:var(--card); border-top:1px solid var(--border) }
.console-head { flex:none; display:flex; align-items:center; min-height:38px; gap:12px; padding:0 10px;
  border-bottom:1px solid var(--border); background:var(--muted) }
.console-tabs { align-self:stretch; display:flex; align-items:stretch }
.console-tab { display:flex; align-items:center; gap:6px; min-width:0; padding:0 4px;
  border-bottom:2px solid var(--primary); font-size:12px; font-weight:600 }
.console-tab .ui-icon { width:14px; height:14px; color:var(--primary) }
.console-count, .sidebar-count, .repo-count { display:grid; place-items:center; min-width:18px; height:18px; padding:0 5px;
  color:var(--secondary-foreground); background:var(--secondary); border-radius:999px; font-size:10px; font-variant-numeric:tabular-nums }
.console-note { min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--muted-foreground); font-size:11px }.console-head .region-actions { margin-left:auto }
.console-body { flex:1; display:flex; min-width:0; min-height:0; overflow:hidden }
.console-stage { flex:1 1 0; display:flex; flex-direction:column; min-width:0; min-height:0;
  background:color-mix(in srgb, var(--muted) 42%, var(--card)) }
.tabla-head { flex:none; display:flex; align-items:center; gap:10px; min-height:32px; padding:0 12px;
  color:var(--muted-foreground); border-bottom:1px solid var(--border); font-size:10px }
.tabla-head > :last-child { margin-left:auto; white-space:nowrap }.tabla-head b { color:var(--foreground); font-size:11px }
.ramas-tabla { min-height:0; overflow:auto }
.rama-fila { display:grid; grid-template-columns:minmax(145px, 1.15fr) 116px 130px 155px 92px minmax(190px, 1.6fr);
  align-items:center; gap:8px; min-width:920px; width:100%; padding:0 12px; font-size:11px }
.rama-columnas { position:sticky; top:0; z-index:1; min-height:25px; color:var(--foreground); background:var(--muted);
  border-bottom:1px solid var(--border); font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase }
.rama-dato { min-height:34px; color:var(--muted-foreground); border-bottom:1px solid var(--border) }
.rama-dato.actual { color:var(--foreground); background:color-mix(in srgb, var(--primary) 7%, transparent); box-shadow:inset 2px 0 0 var(--primary) }
.rama-fila > span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.rama-nombre { display:flex; align-items:center; gap:6px; color:var(--foreground); font-family:var(--font-mono) }
.rama-nombre small { margin-left:auto; color:var(--primary); font:9px/1 var(--font-sans) }
.rama-actual { flex:none; width:7px; height:7px; background:var(--primary); border-radius:50% }
.rama-fecha { font-variant-numeric:tabular-nums }.rama-commit code { margin-right:5px; padding:0; background:none }
.estado { display:inline-flex; align-items:center; min-height:18px; padding:0 6px; border-radius:999px; font-size:9.5px; font-weight:600 }
.estado[data-estado="al-dia"], .estado[data-estado="fusionada"] { color:var(--ctx); background:color-mix(in srgb, var(--ctx) 14%, transparent) }
.estado[data-estado="activa"], .estado[data-estado="adelantada"], .estado[data-estado="con-cambios"] { color:var(--task); background:color-mix(in srgb, var(--task) 14%, transparent) }
.estado[data-estado="atrasada"], .estado[data-estado="sin-cambios"] { color:var(--al-deriva); background:color-mix(in srgb, var(--al-deriva) 12%, transparent) }
.estado[data-estado="divergida"], .estado[data-estado="remoto-ausente"] { color:var(--al-muerta); background:color-mix(in srgb, var(--al-muerta) 14%, transparent) }
.console-sidebar { flex:0 0 244px; display:flex; flex-direction:column; min-width:0; min-height:0;
  background:var(--muted); border-left:1px solid var(--border) }
.console-sidebar-head { flex:none; display:flex; align-items:center; gap:7px; min-height:32px; padding:0 10px;
  color:var(--muted-foreground); border-bottom:1px solid var(--border); font-size:10px; font-weight:600; letter-spacing:.06em; text-transform:uppercase }
.lista-repos { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:2px; padding:6px }
.repo { display:flex; align-items:center; gap:8px; min-width:0; min-height:40px; padding:5px 7px; color:var(--muted-foreground);
  text-align:left; background:transparent; border:1px solid transparent; border-radius:var(--radius); cursor:pointer }
.repo:hover { color:var(--foreground); background:color-mix(in srgb, var(--primary) 7%, var(--muted)); border-color:var(--border) }
.repo.activa { color:var(--foreground); background:color-mix(in srgb, var(--primary) 12%, var(--muted));
  border-color:color-mix(in srgb, var(--primary) 35%, var(--border)); box-shadow:inset 2px 0 0 var(--primary) }
.repo:focus-visible { outline:2px solid var(--ring); outline-offset:-1px }.repo .ui-icon { flex:none; width:15px; height:15px; color:var(--secondary) }
.repo.activa .ui-icon { color:var(--primary) }.repo-texto { display:flex; flex:1; flex-direction:column; gap:2px; min-width:0 }
.repo-nombre, .repo-meta { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }.repo-nombre { font-size:11px; font-weight:600 }
.repo-meta { color:var(--muted-foreground); font-size:9.5px }.repo-meta code { padding:0; background:none }.repo-count { flex:none }
.panel-vacio { display:grid; place-items:center; flex:1; color:var(--muted-foreground); font-size:11px }
@container (max-width:640px) { .console-stage { display:none }.console-sidebar { flex:1; border-left:0 }.console-note { display:none } }
</style>
