<script setup>
import { ref, computed } from 'vue'
import { VueFlow, Handle, Position, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Copy, Check, GitBranch, GitFork, X, Plus, AlertTriangle } from 'lucide-vue-next'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

// Árbol de WORKSPACES: cada nodo es una combinación de ramas (resumen + copy del
// flujo). Desde un nodo se DERIVA un hijo que ramifica sobre el padre (mismo
// nombre en los 3 repos). Seleccionar un nodo lo alinea (checkout+pull) y carga
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
const emit = defineEmits(['derive', 'delete', 'select', 'copy', 'copy-text'])

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
    alignResults: props.selected === c.id ? props.alignResults : [],
  }
}

// ── modales (fuera del canvas para no pelear con Vue Flow) ──
const deriveParent = ref(null) // combo del que se deriva
const deriveName = ref('')
function openDerive(id) {
  const c = props.combinations.find((x) => x.id === id)
  deriveParent.value = c || null
  deriveName.value = ''
}
function confirmDerive() {
  const n = deriveName.value.trim()
  if (!n || !deriveParent.value) return
  emit('derive', { parent: deriveParent.value.id, name: n })
  deriveParent.value = null
  deriveName.value = ''
}

const deleteTarget = ref(null)
function confirmDelete() { if (deleteTarget.value) { emit('delete', deleteTarget.value.id); deleteTarget.value = null } }

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
              <button class="wsx" title="borrar" @click.stop="deleteTarget = combinations.find((c) => c.id === data.id)"><X :size="13" /></button>
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
              <button class="wscopy" :disabled="!data.hasFlow" @click.stop="emit('copy', { combo: data.id, label: data.name })">
                <Check v-if="data.isCopied" :size="13" /><Copy v-else :size="13" />
                {{ data.isCopied ? 'copiado' : 'copiar flujo' }}
              </button>
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
          <p class="modal-note">Crea un workspace hijo con una rama nueva del mismo nombre en los {{ repoAliases.length }} repos. Solo registra los nombres; las ramas las creás vos (Context alinea si existen).</p>
          <input v-model="deriveName" class="modal-in" placeholder="nombre de rama (ej feature/motai-x)" @keyup.enter="confirmDerive" autofocus />
          <div class="modal-preview">
            <span v-for="a in repoAliases" :key="a" class="modal-prev-chip"><b>{{ a.split('-')[0] }}</b><GitBranch :size="10" />{{ deriveName.trim() || '…' }}</span>
          </div>
          <div class="modal-actions">
            <button class="modal-save" :disabled="!deriveName.trim()" @click="confirmDerive"><Plus :size="13" /> derivar</button>
            <button class="modal-cancel" @click="deriveParent = null">cancelar</button>
          </div>
        </div>
      </div>

      <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
        <div class="modal modal-sm">
          <div class="modal-head"><h3><AlertTriangle :size="16" /> Borrar workspace</h3></div>
          <p class="modal-note">¿Borrar <b>{{ deleteTarget.name }}</b>? No toca git; solo quita el workspace de Context.</p>
          <div class="modal-actions">
            <button class="modal-del" @click="confirmDelete">sí, borrar</button>
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
.modal-preview { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 14px; }
.modal-prev-chip { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; font-family: var(--mono); color: var(--violet); background: rgba(188,140,255,.1); padding: 3px 8px; border-radius: 6px; }
.modal-prev-chip b { color: var(--text); margin-right: 2px; }
.modal-actions { display: flex; gap: 8px; }
.modal-save { display: inline-flex; align-items: center; gap: 5px; background: var(--green); color: #06101f; border: 0; border-radius: 8px; padding: 8px 16px; font-weight: 600; font-size: 13px; cursor: pointer; }
.modal-save:disabled { opacity: .5; cursor: default; }
.modal-del { background: rgba(248,81,73,.15); color: var(--red); border: 1px solid rgba(248,81,73,.4); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
.modal-cancel { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 8px; padding: 8px 16px; font-size: 13px; cursor: pointer; }
</style>
