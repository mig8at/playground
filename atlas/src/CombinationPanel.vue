<script setup>
import { ref, computed } from 'vue'

// combinations = [{id, name, targets:{alias:branch}, status:{aligned, repos:[{alias,target,current,commit,state}]}}]
// repos = summary.repos [{alias, branch, commit}]  ·  branches = {alias:[branch,...]}
const props = defineProps({
  combinations: { type: Array, default: () => [] },
  repos: { type: Array, default: () => [] },
  branches: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['save', 'delete', 'need-branches'])

const repoAliases = computed(() => props.repos.map((r) => r.alias))
const currentBranch = computed(() => {
  const m = {}
  for (const r of props.repos) m[r.alias] = r.branch
  return m
})

const creating = ref(false)
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
  <section class="combos">
    <div class="cb-head">
      <h2>Combinaciones de ramas</h2>
      <button v-if="!creating" class="cb-new" @click="startCreate">+ nueva</button>
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
      <article v-for="c in combinations" :key="c.id" class="cb-card" :class="{ off: !c.status.aligned }">
        <div class="cb-card-head">
          <div class="cb-title">
            <b>{{ c.name }}</b>
            <span class="cb-badge" :class="c.status.aligned ? 'ok' : 'drift'">
              {{ c.status.aligned ? '✓ alineada' : '⚠ drift' }}
            </span>
          </div>
          <button class="x" @click="emit('delete', c.id)" title="borrar">×</button>
        </div>
        <ul class="cb-rows">
          <li v-for="r in c.status.repos" :key="r.alias" :class="r.state">
            <span class="cb-alias">{{ r.alias }}</span>
            <span class="cb-arrow">⑂ {{ r.target }}</span>
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
.combos { margin-top: 16px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.cb-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.cb-head h2 { font-size: 16px; }
.cb-new { background: var(--accent); color: #06101f; border: 0; border-radius: 8px; padding: 6px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }

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
.cb-card { background: var(--panel2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.cb-card.off { border-color: rgba(227,179,65,.4); }
.cb-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.cb-title { display: flex; align-items: center; gap: 8px; }
.cb-title b { font-size: 14px; }
.cb-badge { font-size: 10px; padding: 2px 8px; border-radius: 999px; }
.cb-badge.ok { color: var(--green); background: rgba(63,185,80,.14); }
.cb-badge.drift { color: #e3b341; background: rgba(227,179,65,.16); }
.cb-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cb-rows li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.cb-alias { flex: 0 0 130px; font-family: ui-monospace, monospace; color: var(--text); }
.cb-arrow { color: #bc8cff; font-family: ui-monospace, monospace; }
.cb-state { color: var(--muted); }
.cb-rows li.aligned .cb-state { color: var(--green); }
.cb-rows li.off .cb-state, .cb-rows li.moved .cb-state { color: #e3b341; }
.cb-state code { background: var(--chip); padding: 0 4px; border-radius: 3px; }
.x { background: none; border: 0; color: var(--muted); font-size: 18px; cursor: pointer; line-height: 1; }
.x:hover { color: var(--red); }
</style>
