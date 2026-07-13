<script setup>
import { ref, computed } from 'vue'
import { X, GitBranch, Plus } from 'lucide-vue-next'

// combinations = [{id, name, targets:{alias:branch}, status:{aligned, repos:[{alias,target,current,commit,state}]}}]
// repos = summary.repos [{alias, branch, commit}]  ·  branches = {alias:[branch,...]}
const props = defineProps({
  combinations: { type: Array, default: () => [] },
  repos: { type: Array, default: () => [] },
  branches: { type: Object, default: () => ({}) },
  selected: { type: String, default: '' },
})
const emit = defineEmits(['save', 'delete', 'need-branches', 'select'])

const repoAliases = computed(() => props.repos.map((r) => r.alias))
const currentBranch = computed(() => {
  const m = {}
  for (const r of props.repos) m[r.alias] = r.branch
  return m
})

const creating = ref(false)
const confirmId = ref('') // combinación con borrado pendiente de confirmar
const form = ref({ name: '', targets: {} })

function startCreate() {
  creating.value = true
  emit('need-branches')
  // por defecto, la rama actual de cada repo
  form.value = { name: '', targets: { ...currentBranch.value } }
}
function preset(branch) {
  const t = {}
  for (const a of repoAliases.value) t[a] = branch
  form.value.targets = t
}
function captureCurrent() {
  form.value.targets = { ...currentBranch.value }
}
function save() {
  if (!form.value.name.trim()) return
  emit('save', { name: form.value.name.trim(), targets: { ...form.value.targets } })
  creating.value = false
}

function stateLabel(s) {
  return { aligned: '✓', off: '✗ otra rama', moved: '⚠ avanzó' }[s] || ''
}
</script>

<template>
  <section class="combos panel-section">
    <div class="section-head cb-head">
      <h2>Combinaciones de ramas</h2>
      <span class="section-hint">click en una card → alinea repos y dibuja su flujo</span>
      <button v-if="!creating" class="cb-new" @click="startCreate"><Plus :size="14" /> nueva</button>
    </div>

    <!-- formulario nueva combinación -->
    <div v-if="creating" class="cb-form">
      <input v-model="form.name" class="cb-name" placeholder="nombre (ej Producción, Staging, feature-x)" @keyup.enter="save" />
      <div class="cb-presets">
        <span class="muted">rápido:</span>
        <button @click="preset('main')">todos en main</button>
        <button @click="preset('staging')">todos en staging</button>
        <button @click="captureCurrent">estado actual</button>
      </div>
      <div class="cb-repos">
        <div v-for="a in repoAliases" :key="a" class="cb-repo">
          <span class="cb-repo-name">{{ a }}</span>
          <select v-model="form.targets[a]" class="cb-select">
            <option v-for="b in (branches[a] || [currentBranch[a]])" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
      </div>
      <div class="cb-actions">
        <button class="cb-save" @click="save" :disabled="!form.name.trim()">guardar combinación</button>
        <button class="cb-cancel" @click="creating = false">cancelar</button>
      </div>
    </div>

    <p v-if="!combinations.length && !creating" class="cb-empty">
      Sin combinaciones. Creá una para atar cada repo a una rama y rastrear el drift.
    </p>

    <!-- lista de combinaciones -->
    <div class="cb-list">
      <article v-for="c in combinations" :key="c.id" class="cb-card" :class="{ off: !c.status.aligned, sel: c.id === selected }" @click="emit('select', c.id)">
        <div class="cb-card-head">
          <div class="cb-title">
            <b>{{ c.name }}</b>
            <span class="cb-badge" :class="c.status.aligned ? 'ok' : 'drift'">
              {{ c.status.aligned ? '✓ alineada' : '⚠ drift' }}
            </span>
          </div>
          <button class="x" @click.stop="confirmId = confirmId === c.id ? '' : c.id" title="borrar"><X :size="15" /></button>
        </div>
        <div v-if="confirmId === c.id" class="cb-confirm" @click.stop>
          ¿Borrar <b>{{ c.name }}</b>?
          <button class="cb-yes" @click="emit('delete', c.id); confirmId = ''">sí, borrar</button>
          <button class="cb-no" @click="confirmId = ''">cancelar</button>
        </div>
        <ul v-else class="cb-rows">
          <li v-for="r in c.status.repos" :key="r.alias" :class="r.state">
            <span class="cb-alias">{{ r.alias }}</span>
            <span class="cb-arrow"><GitBranch :size="12" /> {{ r.target }}</span>
            <span class="cb-state">
              <template v-if="r.state === 'aligned'">✓</template>
              <template v-else-if="r.state === 'off'">✗ está en <code>{{ r.current }}</code></template>
              <template v-else>⚠ avanzó ({{ r.commit }})</template>
            </span>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>

<style scoped>
.cb-head .cb-new { margin-left: auto; }
.cb-new { display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: #06101f; border: 0; border-radius: 8px; padding: 6px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
.cb-arrow { display: inline-flex; align-items: center; gap: 4px; }
.x { display: inline-flex; align-items: center; }
.cb-new:hover { filter: brightness(1.08); }
.cb-confirm { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); padding: 4px 0; }
.cb-yes { background: rgba(248,81,73,.15); color: var(--red); border: 1px solid rgba(248,81,73,.4); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.cb-no { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer; }

.cb-form { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 14px; }
.cb-name { width: 100%; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 9px 12px; border-radius: 8px; font-size: 14px; margin-bottom: 10px; box-sizing: border-box; }
.cb-name:focus { outline: none; border-color: var(--accent); }
.cb-presets { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.cb-presets button { background: var(--chip); border: 1px solid var(--border); color: var(--text); padding: 3px 10px; border-radius: 999px; font-size: 12px; cursor: pointer; }
.cb-presets button:hover { border-color: var(--accent); }
.cb-repos { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.cb-repo { display: flex; align-items: center; gap: 10px; }
.cb-repo-name { flex: 0 0 160px; font-size: 13px; font-family: ui-monospace, monospace; }
.cb-select { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; font-size: 13px; font-family: ui-monospace, monospace; }
.cb-actions { display: flex; gap: 8px; }
.cb-save { background: var(--green); color: #06101f; border: 0; border-radius: 8px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
.cb-save:disabled { opacity: .5; cursor: default; }
.cb-cancel { background: transparent; border: 1px solid var(--border); color: var(--muted); border-radius: 8px; padding: 7px 14px; font-size: 13px; cursor: pointer; }

.cb-empty { color: var(--muted); font-size: 13px; }
.cb-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.cb-card { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; transition: border-color .15s; }
.cb-card.off { border-color: rgba(227,179,65,.4); }
.cb-card.sel { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.cb-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cb-title { display: flex; align-items: center; gap: 8px; }
.cb-title b { font-size: 14px; }
.cb-badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; }
.cb-badge.ok { color: var(--green); background: rgba(63,185,80,.14); }
.cb-badge.drift { color: var(--amber); background: rgba(227,179,65,.16); }
.cb-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cb-rows li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cb-alias { flex: 0 0 130px; font-family: ui-monospace, monospace; color: var(--text); }
.cb-arrow { color: var(--violet); font-family: ui-monospace, monospace; }
.cb-state { color: var(--muted); }
.cb-rows li.aligned .cb-state { color: var(--green); }
.cb-rows li.off .cb-state, .cb-rows li.moved .cb-state { color: var(--amber); }
.cb-state code { background: var(--chip); padding: 0 4px; border-radius: 3px; }
.x { background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; line-height: 1; }
.x:hover { color: var(--red); }
</style>
