<script setup>
import { ref, computed } from 'vue'
import { VueFlow, Handle, Position, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { Network, Check, FileText, GitBranch, GitFork, X, Plus, AlertTriangle } from 'lucide-vue-next'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

// Árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen + copy del
// flujo). Desde un nodo se DERIVA un hijo: elegís qué repos van a la rama nueva
// (mismo nombre replicado); el resto queda en la rama del padre. Seleccionar un nodo lo alinea (checkout+pull) y carga
// su árbol. El nodo raíz (CreditOp) trae el contexto del ecosistema; sus hijos
// son flujos específicos (solo contexto, sin checklist de tareas).
const props = defineProps({
  combinations: { type: Array, default: () => [] },
  repos: { type: Array, default: () => [] }, // [{alias,branch,commit}]
  repoBranches: { type: Object, default: () => ({}) }, // alias → [ramas locales]
  selected: { type: String, default: '' },
  graphs: { type: Array, default: () => [] },
  copiedKey: { type: String, default: '' },
  aligning: { type: String, default: '' },
  alignResults: { type: Array, default: () => [] },
})
const emit = defineEmits(['derive', 'delete', 'select', 'copy', 'copy-text', 'show-doc'])

const repoAliases = computed(() => props.repos.map((r) => r.alias))

const ALIAS_SHORT = { application: 'app', 'frontend-monorepo': 'front', 'legacy-backend': 'legacy' }
function shortAlias(a) { return ALIAS_SHORT[a] || a.split('-')[0] }

function staleOf(flow) { if (!flow || !flow.has_base) return ''; return flow.changed ? 'stale' : 'fresh' }
function alignClass(r) { return r.error ? (r.error.includes('sin commitear') ? 'warn' : 'err') : 'ok' }

// ── layout: árbol por profundidad (padre → hijos a la derecha) ──
const COL_W = 348, ROW_H = 250
const layout = computed(() => {
  const combos = props.combinations
  const idset = new Set(combos.map((c) => c.id))
  const childrenBy = {}
  const roots = []
  for (const c of combos) {
    if (c.parent && idset.has(c.parent)) (childrenBy[c.parent] ||= []).push(c)
    else roots.push(c)
  }
  const nodes = [], edges = []
  let row = 0
  const place = (c, depth) => {
    nodes.push({ id: c.id, type: 'ws', position: { x: depth * COL_W, y: row * ROW_H }, data: nodeData(c, depth) })
    row++
    for (const ch of (childrenBy[c.id] || [])) {
      edges.push({ id: c.id + '->' + ch.id, source: c.id, target: ch.id, type: 'smoothstep', animated: props.selected === ch.id, style: { stroke: '#bc8cff', strokeWidth: 2 } })
      place(ch, depth + 1)
    }
  }
  for (const r of roots) place(r, 0)
  return { nodes, edges, height: Math.max(260, row * ROW_H + 20) }
})

// Rol por profundidad: raíz (creditop = base/main) → flujo (hijo directo) →
// tarea (nieto+: trabajo sobre un flujo). Solo las tareas se pueden borrar.
// Clave ASCII (para la clase CSS) + label con acento + tooltip.
const ROLE_LABEL = { raiz: 'raíz', flujo: 'flujo', tarea: 'tarea' }
const ROLE_TIP = { raiz: 'la base del ecosistema (main)', flujo: 'un flujo del ecosistema — derivá tareas desde acá', tarea: 'trabajo sobre un flujo (rama de feature)' }
function roleOf(depth) { return depth === 0 ? 'raiz' : depth === 1 ? 'flujo' : 'tarea' }

function nodeData(c, depth) {
  const flow = c.flow || null
  const rf = flow?.repo_files || {}
  // Ramas del nodo agrupadas por rama OBJETIVO (dedup): un chip por rama distinta.
  // Verde = los repos están en ella; naranja = drift. El tooltip dice en qué rama
  // está realmente cada repo (así el nombre largo no ensucia el nodo).
  const byTarget = {}
  for (const r of c.status?.repos || []) {
    const drift = r.state === 'off' || r.state === 'moved'
    const g = (byTarget[r.target] ||= { target: r.target || '—', aligned: true, repos: [] })
    if (drift) g.aligned = false
    g.repos.push(`${r.alias}: ${r.current || '—'}${drift ? ` → objetivo ${r.target}` : ' ✓'}`)
  }
  const branchChips = Object.values(byTarget).map((g) => ({ target: g.target, aligned: g.aligned, tip: g.repos.join('\n') }))
  return {
    id: c.id, name: c.name, depth, isChild: !!c.parent,
    role: roleOf(depth), roleLabel: ROLE_LABEL[roleOf(depth)], roleTip: ROLE_TIP[roleOf(depth)], canDelete: depth >= 1,
    selected: props.selected === c.id,
    aligning: props.aligning === c.id,
    isCopied: props.copiedKey === c.id,
    aligned: c.status?.aligned,
    branchChips,
    files: flow?.files || 0,
    repoChips: (flow?.repos || []).map((r) => ({ short: shortAlias(r), files: rf[r] || 0 })),
    stale: staleOf(flow),
    changed: flow?.changed || 0,
    hasFlow: !!flow,
    doc: flow?.desc || '', // doc.md del flujo (documentación viva)
    alignResults: props.selected === c.id ? props.alignResults : [],
  }
}

// ── modales (fuera del canvas para no pelear con Vue Flow) ──
const PROTECTED = new Set(['main', 'master', 'develop', 'staging', 'production'])

const deriveParent = ref(null) // combo del que se deriva
const deriveName = ref('')
const deriveRepos = ref([]) // aliases que van a la rama NUEVA (el resto queda en la del flujo)
const deriveCreate = ref(false) // crear las ramas localmente (git checkout -b)
const deriveBases = ref({}) // alias → rama BASE desde la que se corta la rama nueva
// Derivar de la RAÍZ crea un FLUJO (documentación sobre main); de un flujo/tarea, una TAREA.
const deriveMode = computed(() => (deriveParent.value && !deriveParent.value.parent ? 'flow' : 'task'))
function branchesFor(a) {
  const list = props.repoBranches[a] || []
  return list.length ? list : ['main']
}
function openDerive(id) {
  const c = props.combinations.find((x) => x.id === id)
  deriveParent.value = c || null
  deriveName.value = ''
  deriveRepos.value = [...repoAliases.value] // por defecto: todos
  deriveCreate.value = false
  // base por defecto = main (los flujos viven en main; la tarea corta de ahí salvo que cambies)
  deriveBases.value = Object.fromEntries(repoAliases.value.map((a) => [a, branchesFor(a).includes('main') ? 'main' : branchesFor(a)[0]]))
}
// rama en la que queda un repo NO seleccionado: la del flujo (padre) o su rama actual
function parentBranch(a) {
  return deriveParent.value?.targets?.[a] || props.repos.find((r) => r.alias === a)?.branch || '—'
}
function confirmDerive() {
  const n = deriveName.value.trim()
  if (!n || !deriveParent.value) return
  if (deriveMode.value === 'flow') {
    emit('derive', { parent: deriveParent.value.id, name: n, mode: 'flow' })
  } else {
    if (!deriveRepos.value.length) return
    const bases = {}
    for (const a of deriveRepos.value) bases[a] = deriveBases.value[a] || 'main'
    emit('derive', { parent: deriveParent.value.id, name: n, mode: 'task', repos: [...deriveRepos.value], bases, create: deriveCreate.value })
  }
  deriveParent.value = null
  deriveName.value = ''
}

const deleteTarget = ref(null)
const deleteBranches = ref(false) // borrar también las ramas locales propias del workspace
function openDelete(id) { deleteTarget.value = props.combinations.find((c) => c.id === id) || null; deleteBranches.value = false }
// ramas PROPIAS del workspace (distintas a las del padre, no protegidas) = las que borraría localmente
const deleteOwnBranches = computed(() => {
  const t = deleteTarget.value
  if (!t) return []
  const pt = props.combinations.find((c) => c.id === t.parent)?.targets || {}
  return Object.entries(t.targets || {})
    .filter(([alias, br]) => !PROTECTED.has(br) && pt[alias] !== br)
    .map(([alias, branch]) => ({ alias, branch }))
})
function confirmDelete() {
  if (!deleteTarget.value) return
  emit('delete', { id: deleteTarget.value.id, deleteBranches: deleteBranches.value })
  deleteTarget.value = null
}

// re-encuadrar el canvas (con zoom tope 0.8 para no acercar de más) al iniciar y
// cuando cambia la cantidad de nodos (derivar/borrar)
const { fitView, onNodesInitialized } = useVueFlow()
function refit(duration = 0) { setTimeout(() => { try { fitView({ padding: 0.2, maxZoom: 0.8, duration }) } catch {} }, 60) }
onNodesInitialized(() => refit())
</script>

<template>
  <section class="ws fade-in">
    <p v-if="!combinations.length" class="ws-empty">
      Sin workspaces. Derivá uno desde un nodo existente con el botón <b>derivar</b>.
    </p>

    <div v-else class="ws-canvas">
      <VueFlow :nodes="layout.nodes" :edges="layout.edges" :nodes-draggable="false"
               :min-zoom="0.25" :max-zoom="1.4" :default-viewport="{ x: 40, y: 40, zoom: 0.75 }"
               :zoom-on-scroll="false" :pan-on-scroll="false" :prevent-scrolling="false">
        <Background pattern-color="#232b36" :gap="26" :size="1" />
        <Controls position="bottom-left" :show-interactive="false" />
        <template #node-ws="{ data }">
          <div class="wsnode" :class="{ sel: data.selected, child: data.isChild }" @click="emit('select', data.id)">
            <div class="wshead">
              <GitFork v-if="data.isChild" :size="13" class="wsfork" />
              <span class="wsname" :title="data.name">{{ data.name }}</span>
              <span class="wsrole" :class="'role-' + data.role" :title="data.roleTip">{{ data.roleLabel }}</span>
              <span class="wsbadge" :class="data.aligning ? 'busy' : (data.aligned ? 'ok' : 'drift')"
                    :title="data.aligning ? 'alineando…' : (data.aligned ? 'alineado' : 'desalineado (drift) — seleccioná para alinear')">
                {{ data.aligning ? '⟳' : (data.aligned ? '✓' : '⚠') }}
              </span>
              <button v-if="data.canDelete" class="wsx" title="borrar workspace" @click.stop="openDelete(data.id)"><X :size="13" /></button>
            </div>

            <div class="wsbranches">
              <span v-for="b in data.branchChips" :key="b.target" class="wsbrchip" :class="{ ok: b.aligned }" :title="b.tip">
                <GitBranch :size="10" /><span class="wsbrchip-t">{{ b.target }}</span>
              </span>
            </div>

            <div class="wsdiv"></div>

            <div v-if="data.hasFlow" class="wsflow">
              <span class="wsfiles">{{ data.files }} archivos</span>
              <span v-for="r in data.repoChips" :key="r.short" class="wsflow-repo">· {{ r.short }} {{ r.files }}</span>
              <span v-if="data.stale === 'stale'" class="wsflow-stale" :title="data.changed + ' archivos cambiaron desde el análisis'">⚠ {{ data.changed }}</span>
            </div>
            <div v-else class="wsnoflow">sin flujo · hereda del padre al derivar</div>

            <div v-if="data.aligning" class="wsalign loading"><span class="wsspin">⟳</span> alineando (checkout + pull)…</div>
            <div v-else-if="data.alignResults.length" class="wsalign">
              <span v-for="r in data.alignResults" :key="r.alias" class="wsachip" :class="alignClass(r)"
                    :title="r.error ? r.error + ' · click: copiar comando' : 'ok'"
                    @click.stop="r.error && emit('copy-text', r.manual, 'comando')">
                <b>{{ shortAlias(r.alias) }}</b><template v-if="r.error">✗</template><template v-else>✓</template>
              </span>
            </div>

            <div class="wsbtns">
              <button class="wsbtn wsmap" :disabled="!data.hasFlow" title="copiar el mapa del flujo (árbol de archivos)"
                      @click.stop="emit('copy', { combo: data.id, label: data.name })">
                <Check v-if="data.isCopied" :size="13" /><Network v-else :size="13" /> map
              </button>
              <button v-if="data.doc" class="wsbtn wsdoc" title="ver la documentación del flujo (doc.md)"
                      @click.stop="emit('show-doc', { id: data.id, name: data.name, doc: data.doc })"><FileText :size="13" /> doc</button>
              <button class="wsbtn wsderive" title="derivar un hijo" @click.stop="openDerive(data.id)"><GitFork :size="13" /> derivar</button>
            </div>
          </div>
          <Handle type="target" :position="Position.Left" />
          <Handle type="source" :position="Position.Right" />
        </template>
      </VueFlow>
      <div class="ws-legend">
        <span><i class="lg ok"></i> alineado</span>
        <span><i class="lg drift"></i> drift</span>
        <span><i class="lg new"></i> derivado</span>
      </div>
    </div>

    <!-- modales (derivar / borrar) fuera del canvas -->
    <Teleport to="body">
      <div v-if="deriveParent" class="modal-back" @click.self="deriveParent = null">
        <div class="modal">
          <div class="modal-head">
            <h3>{{ deriveMode === 'flow' ? 'Nuevo flujo desde' : 'Nueva tarea desde' }} «{{ deriveParent.name }}»</h3>
            <button class="modal-x" @click="deriveParent = null"><X :size="16" /></button>
          </div>

          <!-- FLUJO: nodo de documentación productiva sobre main -->
          <template v-if="deriveMode === 'flow'">
            <p class="modal-note">Un <b>flujo</b> es documentación productiva <b>sobre main</b> (los repos quedan en main). Después curás qué archivos lo componen y su doc.</p>
            <input v-model="deriveName" class="modal-in" placeholder="nombre del flujo (ej Motai)" @keyup.enter="confirmDerive" autofocus />
            <div class="modal-actions">
              <button class="modal-save" :disabled="!deriveName.trim()" @click="confirmDerive"><Plus :size="13" /> crear flujo</button>
              <button class="modal-cancel" @click="deriveParent = null">cancelar</button>
            </div>
          </template>

          <!-- TAREA: rama de trabajo por repo, desde la base que elijas -->
          <template v-else>
            <p class="modal-note">Una <b>tarea</b> trabaja sobre el flujo. Elegí los repos y desde qué <b>base</b> se corta la rama nueva; el nombre se replica en los seleccionados.</p>
            <div class="modal-repos">
              <label v-for="a in repoAliases" :key="a" class="modal-repo" :class="{ on: deriveRepos.includes(a) }">
                <input type="checkbox" :value="a" v-model="deriveRepos" />
                <b>{{ a }}</b>
                <template v-if="deriveRepos.includes(a)">
                  <span class="modal-repo-from">desde</span>
                  <select class="modal-base" v-model="deriveBases[a]" @click.stop>
                    <option v-for="br in branchesFor(a)" :key="br" :value="br">{{ br }}</option>
                  </select>
                </template>
                <span v-else class="modal-repo-br"><GitBranch :size="10" />{{ parentBranch(a) }}</span>
              </label>
            </div>
            <input v-model="deriveName" class="modal-in" placeholder="nombre de rama (ej feature/motai-x)" @keyup.enter="confirmDerive" autofocus />
            <label class="modal-check"><input type="checkbox" v-model="deriveCreate" /> crear las ramas localmente (<code>git checkout -b</code> desde la base elegida; si ya existe, la reusa)</label>
            <div class="modal-actions">
              <button class="modal-save" :disabled="!deriveName.trim() || !deriveRepos.length" @click="confirmDerive"><Plus :size="13" /> crear tarea en {{ deriveRepos.length }} repo{{ deriveRepos.length === 1 ? '' : 's' }}</button>
              <button class="modal-cancel" @click="deriveParent = null">cancelar</button>
            </div>
          </template>
        </div>
      </div>

      <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
        <div class="modal modal-sm">
          <div class="modal-head"><h3><AlertTriangle :size="16" /> Borrar workspace</h3></div>
          <p class="modal-note">¿Borrar <b>{{ deleteTarget.name }}</b> de Context? Por defecto NO toca git.</p>
          <template v-if="deleteOwnBranches.length">
            <label class="modal-check"><input type="checkbox" v-model="deleteBranches" /> borrar también las ramas <b>locales</b> de este workspace</label>
            <div class="modal-repos" v-if="deleteBranches">
              <span v-for="b in deleteOwnBranches" :key="b.alias" class="modal-repo on">
                <b>{{ b.alias }}</b><span class="modal-repo-br"><GitBranch :size="10" />{{ b.branch }}</span>
              </span>
            </div>
            <p v-if="deleteBranches" class="modal-note" style="margin-top:2px">Nunca toca el remoto: si una rama está publicada, la del remoto <b>queda</b> (solo se borra la local, con <code>git branch -D</code>).</p>
          </template>
          <div class="modal-actions">
            <button class="modal-del" @click="confirmDelete">{{ deleteBranches ? 'sí, borrar + ramas locales' : 'sí, borrar' }}</button>
            <button class="modal-cancel" @click="deleteTarget = null">cancelar</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.ws { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ws-empty { color: var(--muted); font-size: 13px; }
.ws-canvas { position: relative; flex: 1; min-height: 0; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }

.wsnode { position: relative; width: 300px; background: var(--panel2); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; padding: 11px 13px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.wsnode.child { border-left-color: var(--violet); }
.wsnode.sel { box-shadow: 0 0 0 1px var(--accent), var(--shadow); border-color: var(--accent); }
.wsnode:hover { border-color: var(--accent); }

.wshead { display: flex; align-items: center; gap: 6px; }
.wsfork { color: var(--violet); flex: none; }
.wsname { font-size: 15px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.wsbadge { font-size: 12px; flex: none; }
.wsbadge.ok { color: var(--green); }
.wsbadge.drift { color: var(--amber); }
.wsbadge.busy { color: var(--muted); }
.wsrole { flex: none; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; padding: 2px 6px; border-radius: 4px; }
.wsrole.role-raiz { background: rgba(76,154,255,.15); color: var(--accent); }
.wsrole.role-flujo { background: rgba(188,140,255,.16); color: var(--violet); }
.wsrole.role-tarea { background: var(--chip); color: var(--muted); }
.wsx { flex: none; background: none; border: 0; color: var(--muted); cursor: pointer; display: inline-flex; padding: 0; opacity: 0; transition: opacity .12s, color .12s; }
.wsnode:hover .wsx { opacity: 1; }
.wsx:hover { color: var(--red); }

.wsdiv { height: 1px; background: var(--border); opacity: .55; margin: 9px 0; }

.wsbranches { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.wsbrchip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; font-family: var(--mono); font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(227,179,65,.12); color: var(--amber); border: 1px solid rgba(227,179,65,.32); cursor: default; }
.wsbrchip.ok { background: rgba(63,185,80,.12); color: var(--green); border-color: rgba(63,185,80,.32); }
.wsbrchip svg { flex: none; }
.wsbrchip-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wsflow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; font-family: var(--mono); color: var(--muted); }
.wsfiles { color: var(--text); font-weight: 600; }
.wsflow-repo { color: var(--muted); }
.wsflow-stale { margin-left: auto; color: var(--amber); }
.wsnoflow { font-size: 11px; color: var(--muted); font-style: italic; }

.wsalign { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 9px; font-size: 11px; }
.wsalign.loading { color: var(--amber); font-family: var(--mono); align-items: center; gap: 5px; }
.wsspin { display: inline-block; animation: wsspin 1s linear infinite; }
@keyframes wsspin { to { transform: rotate(360deg); } }
.wsachip { font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); display: inline-flex; align-items: center; gap: 2px; }
.wsachip.ok { color: var(--green); }
.wsachip.warn { color: var(--amber); cursor: pointer; }
.wsachip.err { color: var(--red); cursor: pointer; }

.wsbtns { display: flex; gap: 6px; margin-top: 11px; }
.wsbtn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border-radius: 6px; padding: 6px 10px; font-size: 11px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: filter .12s, border-color .12s, color .12s; }
.wsmap { flex: 1; background: var(--accent); color: #06101f; }
.wsmap:hover:not(:disabled) { filter: brightness(1.08); }
.wsmap:disabled { opacity: .5; cursor: default; }
.wsdoc { background: var(--chip); color: var(--text); border-color: var(--border); font-weight: 500; }
.wsdoc:hover { border-color: var(--accent); color: var(--accent); }
.wsderive { background: var(--chip); color: var(--text); border-color: var(--border); font-weight: 500; }
.wsderive:hover { border-color: var(--violet); color: var(--violet); }

/* leyenda flotante + controles del canvas */
.ws-legend { position: absolute; bottom: 12px; right: 14px; display: flex; gap: 12px; background: rgba(22,27,34,.85); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 11px; color: var(--muted); backdrop-filter: blur(3px); }
.ws-legend span { display: inline-flex; align-items: center; gap: 5px; }
.ws-legend .lg { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.ws-legend .lg.ok { background: var(--green); }
.ws-legend .lg.drift { background: var(--amber); }
.ws-legend .lg.new { background: var(--violet); }

:deep(.vue-flow__handle) { opacity: 0; }
:deep(.vue-flow__controls) { box-shadow: var(--shadow); border-radius: 8px; overflow: hidden; }
:deep(.vue-flow__controls-button) { background: var(--panel2); border-bottom: 1px solid var(--border); color: var(--text); fill: var(--text); }
:deep(.vue-flow__controls-button:hover) { background: var(--chip); }
:deep(.vue-flow__controls-button svg) { fill: var(--text); }

/* ── modales ── */
.modal-back { position: fixed; inset: 0; background: rgba(6,10,16,.6); z-index: 200; display: flex; align-items: center; justify-content: center; }
.modal { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; width: 420px; max-width: 92vw; box-shadow: var(--shadow); }
.modal-sm { width: 340px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.modal-head h3 { font-size: 15px; display: inline-flex; align-items: center; gap: 6px; }
.modal-x { background: none; border: 0; color: var(--muted); cursor: pointer; display: inline-flex; padding: 0; }
.modal-x:hover { color: var(--text); }
.modal-note { font-size: 12px; color: var(--muted); line-height: 1.5; margin: 0 0 12px; }
.modal-in { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 14px; box-sizing: border-box; margin-bottom: 10px; }
.modal-in:focus { outline: none; border-color: var(--accent); }
.modal-check { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; color: var(--text); line-height: 1.45; margin: 0 0 12px; cursor: pointer; }
.modal-check input { margin-top: 2px; accent-color: var(--violet); cursor: pointer; flex: 0 0 auto; }
.modal-check code, .modal-note code { background: var(--chip); padding: 0 4px; border-radius: 4px; font-family: var(--mono); font-size: 11px; }
.modal-repos { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.modal-repo { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--muted); background: var(--bg); }
.modal-repo.on { border-color: var(--violet); color: var(--text); background: rgba(188,140,255,.08); }
.modal-repo input { accent-color: var(--violet); cursor: pointer; }
.modal-repo b { flex: 1; font-weight: 600; }
.modal-repo-br { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-family: var(--mono); color: var(--violet); }
.modal-repo:not(.on) .modal-repo-br { color: var(--muted); }
.modal-repo-from { font-size: 11px; color: var(--muted); flex: none; }
.modal-base { background: var(--panel2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 3px 6px; font-size: 11px; font-family: var(--mono); max-width: 140px; cursor: pointer; }
.modal-base:focus { outline: none; border-color: var(--violet); }
.modal-actions { display: flex; gap: 8px; }
.modal-save { display: inline-flex; align-items: center; gap: 5px; background: var(--green); color: #06101f; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; }
.modal-save:disabled { opacity: .5; cursor: default; }
.modal-del { background: rgba(248,81,73,.15); color: var(--red); border: 1px solid rgba(248,81,73,.4); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.modal-cancel { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
</style>
