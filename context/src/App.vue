<script setup>
import { ref, computed } from 'vue'
import tree from '../tree.json'

// ── Data: estructura del árbol (tree.json) + contenido por nodo (map.json/doc.md) ──
// Sin backend: todo se importa del repo. Editar tree.json (o agregar un flows/<id>/)
// y la viz se actualiza sola (HMR de Vite).
const mapMods = import.meta.glob('../server/data/flows/*/map.json', { eager: true })
const docMods = import.meta.glob('../server/data/flows/*/doc.md', { eager: true, query: '?raw', import: 'default' })
const idOf = (p) => p.split('/').slice(-2)[0]
const maps = {}; for (const p in mapMods) maps[idOf(p)] = mapMods[p].default || mapMods[p]
const docs = {}; for (const p in docMods) docs[idOf(p)] = docMods[p]

const combos = tree.combinations || []
const byId = computed(() => Object.fromEntries(combos.map(c => [c.id, c])))

// kind: del map.json si existe; si no, se infiere (sin padre = raíz, con contexts = task)
function kindOf(id) {
  const m = maps[id]
  if (m && m.kind) return m.kind
  const c = byId.value[id]
  if (!c) return 'reference'
  if (!c.parent) return 'root'
  if (c.contexts && c.contexts.length) return 'task'
  return 'reference'
}
const nameOf = (id) => (maps[id] && maps[id].name) || (byId.value[id] && byId.value[id].name) || id
const filesOf = (id) => (maps[id] && maps[id].files ? maps[id].files.length : 0)
const whenOf = (id) => (maps[id] && maps[id].when) || ''

// ── Árbol de CONTEXTOS (las tasks van aparte, aunque cuelguen de la raíz) ──
const childrenOf = (id) => combos.filter(c => c.parent === id && kindOf(c.id) !== 'task').map(c => c.id).sort()
const roots = combos.filter(c => !c.parent).map(c => c.id).sort()
const collapsed = ref(new Set())
const toggle = (id) => { const s = new Set(collapsed.value); s.has(id) ? s.delete(id) : s.add(id); collapsed.value = s }

const rows = computed(() => {
  const out = []
  const walk = (id, depth) => {
    const kids = childrenOf(id)
    out.push({ id, depth, hasKids: kids.length > 0 })
    if (!collapsed.value.has(id)) for (const k of kids) walk(k, depth + 1)
  }
  for (const r of roots) walk(r, 0)
  return out
})
const tasks = computed(() => combos.filter(c => kindOf(c.id) === 'task').map(c => c.id).sort())

// stats
const nContext = computed(() => combos.filter(c => kindOf(c.id) !== 'task').length)
const nTask = computed(() => tasks.value.length)
const nFiles = computed(() => combos.reduce((a, c) => a + filesOf(c.id), 0))

// ── Selección + panel de detalle ──
const sel = ref('creditop')
const select = (id) => { sel.value = id }
// al seleccionar una task, resaltar sus contextos en el árbol
const highlighted = computed(() => {
  const c = byId.value[sel.value]
  return new Set(c && c.contexts ? c.contexts : [])
})

// ── mini-render de markdown (sin deps): headings/bold/code/hr/listas/quote/tablas ──
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const inl = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[\[([^\]]+)\]\]/g, '<em>$1</em>')
function md(src) {
  if (!src) return ''
  const L = src.split('\n'); const o = []; let list = null, tbl = false
  const closeList = () => { if (list) { o.push(`</${list}>`); list = null } }
  const closeTbl = () => { if (tbl) { o.push('</tbody></table>'); tbl = false } }
  for (let i = 0; i < L.length; i++) {
    const ln = L[i]
    if (/^\s*\|.*\|\s*$/.test(ln)) {
      const cells = ln.trim().replace(/^\||\|$/g, '').split('|')
      if (/^\s*\|?[\s:|-]+\|?\s*$/.test(ln)) continue // separador
      if (!tbl) { closeList(); o.push('<table><tbody>'); tbl = true }
      o.push('<tr>' + cells.map(c => `<td>${inl(c.trim())}</td>`).join('') + '</tr>'); continue
    } else closeTbl()
    let m
    if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { closeList(); o.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`) }
    else if (/^\s*[-*]\s+/.test(ln)) { if (list !== 'ul') { closeList(); o.push('<ul>'); list = 'ul' } o.push(`<li>${inl(ln.replace(/^\s*[-*]\s+/, ''))}</li>`) }
    else if (/^\s*\d+\.\s+/.test(ln)) { if (list !== 'ol') { closeList(); o.push('<ol>'); list = 'ol' } o.push(`<li>${inl(ln.replace(/^\s*\d+\.\s+/, ''))}</li>`) }
    else if (/^>\s?/.test(ln)) { closeList(); o.push(`<blockquote>${inl(ln.replace(/^>\s?/, ''))}</blockquote>`) }
    else if (/^---+$/.test(ln.trim())) { closeList(); o.push('<hr>') }
    else if (ln.trim() === '') { closeList() }
    else { closeList(); o.push(`<p>${inl(ln)}</p>`) }
  }
  closeList(); closeTbl(); return o.join('\n')
}
const selDoc = computed(() => md(docs[sel.value] || '_(sin doc.md)_'))
</script>

<template>
  <div class="wrap">
    <header>
      <h1>context <span class="sub">· organización</span></h1>
      <div class="stats">
        <span class="pill ctx">{{ nContext }} contextos</span>
        <span class="pill task">{{ nTask }} tasks</span>
        <span class="pill">{{ nFiles }} archivos</span>
      </div>
      <p class="hint">Read-only. La estructura vive en <code>tree.json</code>; para agregar una task, un LLM edita ese JSON (+ <code>flows/&lt;id&gt;/</code>) y esto se actualiza.</p>
    </header>

    <div class="cols">
      <aside class="tree">
        <div class="section-label">Contextos</div>
        <div v-for="r in rows" :key="r.id"
             class="row" :class="{ sel: sel === r.id, hl: highlighted.has(r.id) }"
             :style="{ paddingLeft: (8 + r.depth * 18) + 'px' }" @click="select(r.id)">
          <span class="tog" @click.stop="r.hasKids && toggle(r.id)">{{ r.hasKids ? (collapsed.has(r.id) ? '▸' : '▾') : '·' }}</span>
          <span class="dot" :class="kindOf(r.id)"></span>
          <span class="nm">{{ nameOf(r.id) }}</span>
          <span class="cnt" v-if="filesOf(r.id)">{{ filesOf(r.id) }}</span>
        </div>

        <div class="section-label tasks-lbl">Tasks</div>
        <div v-for="t in tasks" :key="t" class="taskcard" :class="{ sel: sel === t }" @click="select(t)">
          <div class="tc-name"><span class="dot task"></span>{{ nameOf(t) }}</div>
          <div class="chips">
            <span v-for="cx in (byId[t].contexts || [])" :key="cx" class="chip" @click.stop="select(cx)">{{ cx }}</span>
          </div>
        </div>
      </aside>

      <main class="detail" v-if="byId[sel]">
        <div class="d-head">
          <span class="dot" :class="kindOf(sel)"></span>
          <h2>{{ nameOf(sel) }}</h2>
          <span class="kind" :class="kindOf(sel)">{{ kindOf(sel) }}</span>
          <span class="cnt big" v-if="filesOf(sel)">{{ filesOf(sel) }} archivos</span>
        </div>
        <p class="when" v-if="whenOf(sel)"><b>Cuándo:</b> {{ whenOf(sel) }}</p>
        <p class="path"><code>server/data/flows/{{ sel }}/</code> · doc.md + map.json</p>
        <div class="chips" v-if="byId[sel].contexts">
          <span class="chip" v-for="cx in byId[sel].contexts" :key="cx" @click="select(cx)">{{ cx }}</span>
        </div>
        <div class="doc" v-html="selDoc"></div>
      </main>
    </div>
  </div>
</template>
