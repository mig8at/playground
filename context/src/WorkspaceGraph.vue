<script setup>
import { ref, computed } from 'vue'
import { VueFlow, Handle, Position, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Network, Check, FileText, GitBranch, GitFork, X, Plus, AlertTriangle } from 'lucide-vue-next'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// Árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen + copy del
// flujo). Desde un nodo se DERIVA un hijo: elegís qué repos van a la rama nueva
// (mismo nombre replicado); el resto queda en la rama del padre. Seleccionar un nodo lo alinea (checkout+pull) y carga
// su árbol. El nodo raíz (CreditOp) trae el contexto del ecosistema; sus hijos
// son flujos específicos (solo contexto, sin checklist de tareas).
const props = defineProps({
  combinations: { type: Array, default: () => [] },
  repos: { type: Array, default: () => [] }, // [{alias,branch,commit}]
  selected: { type: String, default: '' },
  graphs: { type: Array, default: () => [] },
  copiedKey: { type: String, default: '' },
  aligning: { type: String, default: '' },
  alignResults: { type: Array, default: () => [] },
})
const emit = defineEmits(['derive', 'delete', 'select', 'copy', 'copy-text', 'show-doc'])

const repoAliases = computed(() => props.repos.map((r) => r.alias))

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
      edges.push({ id: c.id + '->' + ch.id, source: c.id, target: ch.id, type: 'smoothstep', animated: props.selected === ch.id, style: { stroke: '#4c9aff', strokeWidth: 1.6 } })
      place(ch, depth + 1)
    }
  }
  for (const r of roots) place(r, 0)
  return { nodes, edges, height: Math.max(260, row * ROW_H + 20) }
})

function nodeData(c, depth) {
  const flow = c.flow || null
  const rf = flow?.repo_files || {}
  return {
    id: c.id, name: c.name, depth, isChild: !!c.parent,
    selected: props.selected === c.id,
    aligning: props.aligning === c.id,
    isCopied: props.copiedKey === c.id,
    aligned: c.status?.aligned,
    branches: (c.status?.repos || []).map((r) => ({ alias: r.alias, current: r.current, target: r.target, state: r.state })),
    files: flow?.files || 0,
    repoChips: (flow?.repos || []).map((r) => ({ repo: r, files: rf[r] || 0 })),
    stale: staleOf(flow),
    changed: flow?.changed || 0,
    hasFlow: !!flow,
    doc: flow?.desc || '', // doc.md del flujo (documentación viva) — botón "doc" la copia sola

    alignResults: props.selected === c.id ? props.alignResults : [],
  }
}

// ── modales (fuera del canvas para no pelear con Vue Flow) ──
const PROTECTED = new Set(['main', 'master', 'develop', 'staging', 'production'])

const deriveParent = ref(null) // combo del que se deriva
const deriveName = ref('')
const deriveRepos = ref([]) // aliases que van a la rama NUEVA (el resto queda en la del padre)
const deriveCreate = ref(false) // crear las ramas localmente (git checkout -b)
function openDerive(id) {
  const c = props.combinations.find((x) => x.id === id)
  deriveParent.value = c || null
  deriveName.value = ''
  deriveRepos.value = [...repoAliases.value] // por defecto: todos
  deriveCreate.value = false
}
// rama en la que queda un repo NO seleccionado: la que tiene el padre (o su rama actual)
function parentBranch(a) {
  return deriveParent.value?.targets?.[a] || props.repos.find((r) => r.alias === a)?.branch || '—'
}
function confirmDerive() {
  const n = deriveName.value.trim()
  if (!n || !deriveParent.value || !deriveRepos.value.length) return
  emit('derive', { parent: deriveParent.value.id, name: n, repos: [...deriveRepos.value], create: deriveCreate.value })
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
        <Background pattern-color="#2a3340" :gap="18" />
        <template #node-ws="{ data }">
          <div class="wsnode" :class="{ sel: data.selected, child: data.isChild }" @click="emit('select', data.id)">
            <span v-if="data.stale" class="wsdot" :class="data.stale"
                  :title="data.stale === 'stale' ? data.changed + ' archivos cambiaron desde el análisis' : 'al día'"></span>
            <div class="wshead">
              <GitFork v-if="data.isChild" :size="13" class="wsfork" />
              <span class="wsname">{{ data.name }}</span>
              <span class="wsbadge" :class="data.aligned ? 'ok' : 'drift'">{{ data.aligning ? '⟳' : (data.aligned ? '✓' : '⚠') }}</span>
              <button class="wsx" title="borrar" @click.stop="openDelete(data.id)"><X :size="13" /></button>
            </div>

            <div class="wsbranches">
              <span v-for="b in data.branches" :key="b.alias" class="wsbr" :class="b.state">
                <b>{{ b.alias }}</b><GitBranch :size="10" />{{ b.current || '—' }}<template v-if="b.state === 'off'"> →{{ b.target }}</template>
              </span>
            </div>

            <div v-if="data.hasFlow" class="wsflow">
              <span class="wsfiles">{{ data.files }} archivos</span>
              <span v-for="r in data.repoChips" :key="r.repo" class="wschip">{{ r.repo.split('-')[0] }} {{ r.files }}</span>
            </div>
            <div v-else class="wsnoflow">sin flujo · hereda del padre al derivar</div>

            <div v-if="data.aligning" class="wsalign loading">⟳ alineando (checkout + pull)…</div>
            <div v-else-if="data.alignResults.length" class="wsalign">
              <span v-for="r in data.alignResults" :key="r.alias" class="wsachip" :class="alignClass(r)"
                    :title="r.error ? 'click: copiar comando manual' : ''"
                    @click.stop="r.error && emit('copy-text', r.manual, 'comando')">
                <b>{{ r.alias.split('-')[0] }}</b><template v-if="r.error">✗</template><template v-else>✓</template>
              </span>
            </div>

            <div class="wsbtns">
              <button class="wscopy" :disabled="!data.hasFlow" title="copiar el mapa del flujo (árbol de archivos)"
                      @click.stop="emit('copy', { combo: data.id, label: data.name })">
                <Check v-if="data.isCopied" :size="13" /><Network v-else :size="13" />
                map
              </button>
              <button v-if="data.doc" class="wsdoc" title="ver la documentación del flujo (doc.md)"
                      @click.stop="emit('show-doc', { id: data.id, name: data.name, doc: data.doc })"><FileText :size="13" /> doc</button>
              <button class="wsderive" title="derivar un hijo" @click.stop="openDerive(data.id)"><GitFork :size="13" /> derivar</button>
            </div>
          </div>
          <Handle type="target" :position="Position.Left" />
          <Handle type="source" :position="Position.Right" />
        </template>
      </VueFlow>
    </div>

    <!-- modales (derivar / borrar) fuera del canvas -->
    <Teleport to="body">
      <div v-if="deriveParent" class="modal-back" @click.self="deriveParent = null">
        <div class="modal">
          <div class="modal-head"><h3>Derivar de «{{ deriveParent.name }}»</h3><button class="wsx" @click="deriveParent = null"><X :size="16" /></button></div>
          <p class="modal-note">Elegí qué repos van a la rama nueva. Los no seleccionados quedan en la rama del padre. El nombre se replica en todos los seleccionados. Context solo registra los nombres; las ramas las creás vos.</p>
          <div class="modal-repos">
            <label v-for="a in repoAliases" :key="a" class="modal-repo" :class="{ on: deriveRepos.includes(a) }">
              <input type="checkbox" :value="a" v-model="deriveRepos" />
              <b>{{ a }}</b>
              <span class="modal-repo-br"><GitBranch :size="10" />{{ deriveRepos.includes(a) ? (deriveName.trim() || 'rama nueva') : parentBranch(a) }}</span>
            </label>
          </div>
          <input v-model="deriveName" class="modal-in" placeholder="nombre de rama (ej feature/motai-x)" @keyup.enter="confirmDerive" autofocus />
          <label class="modal-check"><input type="checkbox" v-model="deriveCreate" /> crear las ramas localmente (<code>git checkout -b</code> desde la rama del padre; si ya existe, la reusa)</label>
          <div class="modal-actions">
            <button class="modal-save" :disabled="!deriveName.trim() || !deriveRepos.length" @click="confirmDerive"><Plus :size="13" /> derivar en {{ deriveRepos.length }} repo{{ deriveRepos.length === 1 ? '' : 's' }}</button>
            <button class="modal-cancel" @click="deriveParent = null">cancelar</button>
          </div>
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
.ws-canvas { flex: 1; min-height: 0; background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }

.wsnode { position: relative; width: 296px; background: var(--panel2); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 10px; padding: 11px 13px; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.wsnode.child { border-left-color: var(--violet); }
.wsnode.sel { box-shadow: 0 0 0 1px var(--accent), var(--shadow); border-color: var(--accent); }
.wsnode:hover { border-color: var(--accent); }
.wsdot { position: absolute; top: 10px; right: 30px; width: 8px; height: 8px; border-radius: 50%; }
.wsdot.fresh { background: var(--green); }
.wsdot.stale { background: var(--amber); }
.wshead { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.wsfork { color: var(--violet); flex: none; }
.wsname { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsbadge { font-size: 11px; }
.wsbadge.ok { color: var(--green); }
.wsbadge.drift { color: var(--amber); }
.wsx { margin-left: auto; background: none; border: 0; color: var(--muted); cursor: pointer; display: inline-flex; padding: 0; }
.wsx:hover { color: var(--red); }

.wsbranches { display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }
.wsbr { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-family: var(--mono); color: var(--muted); }
.wsbr b { color: var(--text); margin-right: 3px; font-weight: 600; }
.wsbr.aligned { color: var(--green); }
.wsbr.off, .wsbr.moved { color: var(--amber); }

.wsflow { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 8px; }
.wsfiles { font-size: 11px; color: var(--text); font-weight: 600; }
.wschip { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--chip); color: var(--muted); font-family: var(--mono); }
.wsnoflow { font-size: 11px; color: var(--muted); font-style: italic; margin-bottom: 8px; }

.wsalign { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; font-size: 11px; }
.wsalign.loading { color: var(--amber); font-family: var(--mono); }
.wsachip { font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--bg); border: 1px solid var(--border); }
.wsachip.ok { color: var(--green); }
.wsachip.warn { color: var(--amber); cursor: pointer; }
.wsachip.err { color: var(--red); cursor: pointer; }

.wsbtns { display: flex; gap: 6px; }
.wscopy { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; background: var(--accent); color: #06101f; border: 0; border-radius: 6px; padding: 6px; font-weight: 600; font-size: 11px; cursor: pointer; }
.wscopy:hover:not(:disabled) { filter: brightness(1.08); }
.wscopy:disabled { opacity: .5; cursor: default; }
.wsderive { display: inline-flex; align-items: center; gap: 4px; background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
.wsderive:hover { border-color: var(--violet); color: var(--violet); }
.wsdoc { display: inline-flex; align-items: center; gap: 4px; background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 10px; font-size: 11px; cursor: pointer; }
.wsdoc:hover { border-color: var(--accent); color: var(--accent); }

:deep(.vue-flow__handle) { opacity: 0; }

/* ── modales ── */
.modal-back { position: fixed; inset: 0; background: rgba(6,10,16,.6); z-index: 200; display: flex; align-items: center; justify-content: center; }
.modal { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px; width: 420px; max-width: 92vw; box-shadow: var(--shadow); }
.modal-sm { width: 340px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.modal-head h3 { font-size: 15px; display: inline-flex; align-items: center; gap: 6px; }
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
.modal-actions { display: flex; gap: 8px; }
.modal-save { display: inline-flex; align-items: center; gap: 5px; background: var(--green); color: #06101f; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; }
.modal-save:disabled { opacity: .5; cursor: default; }
.modal-del { background: rgba(248,81,73,.15); color: var(--red); border: 1px solid rgba(248,81,73,.4); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.modal-cancel { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
</style>
