<script setup>
import { computed } from 'vue'
import { Copy, Check, GitBranch } from 'lucide-vue-next'

// La combinación ES el flujo. Con un solo flujo por combinación ya no hace falta
// un canvas de grafo: se muestra como TARJETA con el recorrido de repos (en orden
// de flujo, con conteos) + UN botón "copiar todo el flujo".
const props = defineProps({
  comboName: { type: String, default: '' },
  graphs: { type: Array, default: () => [] },
  status: { type: Object, default: () => ({ repos: [] }) },
  copiedKey: { type: String, default: '' },
  aligning: { type: Boolean, default: false },
  alignResults: { type: Array, default: () => [] },
})
const emit = defineEmits(['copy', 'copy-text'])

const drift = computed(() => {
  const m = {}
  for (const r of (props.status?.repos || [])) m[r.alias] = r.state === 'aligned' ? 'ok' : 'drift'
  return m
})

function isCopied(group, key) { return props.copiedKey === group + '::' + key }
function kb(text) { return text ? '~' + Math.round(text.length / 1000) + 'k' : '' }
function stale(s) { if (!s || !s.has_base) return ''; return s.changed ? 'stale' : 'fresh' }
function alignClass(r) { return r.error ? (r.error.includes('sin commitear') ? 'warn' : 'err') : 'ok' }

// cada group → una tarjeta de flujo
const cards = computed(() => (props.graphs || []).map((g) => {
  const head = g.channel || (g.lenders || [])[0] || {}
  const rf = head.repo_files || {}
  const repos = (head.repos || []).map((r) => ({ repo: r, files: rf[r] || 0, drift: drift.value[r] || '' }))
  const allTree = g.trees?.['__all__'] || ''
  return {
    group: g.group,
    name: head.name || g.group,
    desc: head.desc || '',
    repos,
    totalFiles: head.files || repos.reduce((a, b) => a + b.files, 0),
    size: kb(allTree),
    hasTree: !!allTree,
    stale: stale(head),
    changed: head.changed || 0,
    lenders: g.channel ? (g.lenders || []).map((l) => ({
      id: l.id, name: l.name, files: l.files, size: kb(g.trees?.[l.id] || ''), hasTree: !!g.trees?.[l.id],
    })) : [],
  }
}))
</script>

<template>
  <section class="flows panel-section fade-in">
    <div class="section-head">
      <h2>Flujo de {{ comboName }}</h2>
      <span class="section-hint">flujo completo cross-repo · un solo copy baja todo el árbol para pegar a un LLM</span>
    </div>

    <!-- alineación: checkout + pull al seleccionar -->
    <div v-if="aligning" class="fg-align loading">⟳ alineando repos a {{ comboName }} (checkout + git pull)…</div>
    <div v-else-if="alignResults.length" class="fg-align">
      <span v-for="r in alignResults" :key="r.alias" class="fg-chip" :class="alignClass(r)"
            :title="r.error ? 'click para copiar el comando manual' : ''"
            @click="r.error && emit('copy-text', r.manual, 'comando')">
        <b>{{ r.alias }}</b>
        <template v-if="r.error">{{ alignClass(r) === 'warn' ? '⚠' : '✗' }} {{ r.error }}</template>
        <template v-else>{{ r.was !== r.now ? r.was + '→' + r.now : r.now }}{{ r.pulled ? ' · pull ✓' : '' }}</template>
      </span>
    </div>

    <!-- ramas actuales por repo (drift vs la combinación) -->
    <div v-if="status?.repos?.length" class="fg-legend">
      <span class="fg-legend-lbl">ramas:</span>
      <span v-for="r in status.repos" :key="r.alias" class="fg-branch" :class="r.state === 'aligned' ? 'ok' : 'drift'">
        <b>{{ r.alias }}</b><GitBranch :size="12" />{{ r.current }}<template v-if="r.state === 'off'"> →{{ r.target }}</template>
      </span>
    </div>

    <!-- skeleton mientras alinea / carga -->
    <div v-if="aligning || !graphs.length" class="flow-cards">
      <div class="flow-card skel-card">
        <div class="skel skel-line w40"></div>
        <div class="skel skel-line w80"></div>
        <div class="skel skel-pipe"></div>
        <div class="skel skel-btn"></div>
      </div>
    </div>

    <!-- tarjetas de flujo -->
    <div v-else class="flow-cards">
      <article v-for="c in cards" :key="c.group" class="flow-card">
        <div class="fc-head">
          <span class="fc-tag">flujo</span>
          <h3 class="fc-name">{{ c.name }}</h3>
          <span class="fc-meta">{{ c.totalFiles }} archivos · {{ c.repos.length }} repos</span>
          <span v-if="c.stale" class="fc-dot" :class="c.stale"
                :title="c.stale === 'stale' ? c.changed + ' archivos cambiaron desde el análisis' : 'al día con el análisis'"></span>
        </div>

        <p v-if="c.desc" class="fc-desc">{{ c.desc }}</p>

        <!-- recorrido de repos, en orden de flujo -->
        <div class="fc-pipe">
          <template v-for="(r, i) in c.repos" :key="r.repo">
            <div class="fc-repo" :class="r.drift">
              <span class="fc-repo-name">{{ r.repo }}</span>
              <span class="fc-repo-files">{{ r.files }} archivos</span>
            </div>
            <span v-if="i < c.repos.length - 1" class="fc-arrow">→</span>
          </template>
        </div>

        <!-- un solo copy: todo el flujo -->
        <button class="fc-copy" :disabled="!c.hasTree"
                :title="'copiar el árbol completo (' + c.totalFiles + ' archivos) para pegar a un LLM'"
                @click="emit('copy', { group: c.group, key: '__all__', label: c.name })">
          <Check v-if="isCopied(c.group, '__all__')" :size="16" />
          <Copy v-else :size="16" />
          <span>{{ isCopied(c.group, '__all__') ? 'copiado' : 'copiar todo el flujo' }} · {{ c.size }}</span>
        </button>

        <!-- copias por lender (solo si el flujo se ramifica) -->
        <div v-if="c.lenders.length" class="fc-lenders">
          <span class="fc-lenders-lbl">o por lender:</span>
          <button v-for="l in c.lenders" :key="l.id" class="fc-lchip" :disabled="!l.hasTree"
                  @click="emit('copy', { group: c.group, key: l.id, label: l.name })">
            <component :is="isCopied(c.group, l.id) ? Check : Copy" :size="12" />
            {{ l.name }} · {{ l.size }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.fg-align { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; font-size: 12px; }
.fg-align.loading { color: var(--amber); font-family: var(--mono); }
.fg-chip { font-family: var(--mono); background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
.fg-chip b { color: var(--text); margin-right: 5px; }
.fg-chip.ok { color: var(--green); }
.fg-chip.warn { color: var(--amber); cursor: pointer; }
.fg-chip.err { color: var(--red); cursor: pointer; }
.fg-chip.warn:hover, .fg-chip.err:hover { border-color: currentColor; }

.fg-legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 14px; }
.fg-legend-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.fg-branch { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-family: var(--mono); background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 3px 9px; }
.fg-branch b { color: var(--text); margin-right: 4px; }
.fg-branch.ok { color: var(--green); }
.fg-branch.drift { color: var(--amber); }

/* ── tarjeta de flujo (reemplaza el canvas Vue Flow) ── */
.flow-cards { display: flex; flex-direction: column; gap: 14px; }
.flow-card {
  position: relative; background: var(--panel2); border: 1px solid var(--border);
  border-left: 3px solid var(--accent); border-radius: var(--radius); padding: 18px 20px;
}
.fc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fc-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); background: rgba(76,154,255,.12); padding: 3px 8px; border-radius: 5px; }
.fc-name { font-size: 18px; font-weight: 600; color: var(--text); }
.fc-meta { font-size: 12px; color: var(--muted); font-family: var(--mono); }
.fc-dot { margin-left: auto; width: 9px; height: 9px; border-radius: 50%; }
.fc-dot.fresh { background: var(--green); }
.fc-dot.stale { background: var(--amber); }

.fc-desc { color: var(--muted); font-size: 13px; line-height: 1.6; margin: 12px 0 0; }

.fc-pipe { display: flex; align-items: stretch; flex-wrap: wrap; gap: 8px; margin: 16px 0 18px; }
.fc-repo {
  display: flex; flex-direction: column; gap: 3px; min-width: 150px;
  background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 9px 13px;
}
.fc-repo.ok { border-color: rgba(63,185,80,.35); }
.fc-repo.drift { border-color: rgba(227,179,65,.45); }
.fc-repo-name { font-size: 13px; font-weight: 600; font-family: var(--mono); color: var(--text); }
.fc-repo-files { font-size: 11px; color: var(--muted); }
.fc-arrow { display: flex; align-items: center; color: var(--accent); font-size: 18px; padding: 0 2px; }

.fc-copy {
  display: inline-flex; align-items: center; gap: 8px; background: var(--accent); color: #06101f;
  border: 0; border-radius: var(--radius-sm); padding: 11px 20px; font-weight: 600; font-size: 14px; cursor: pointer;
}
.fc-copy:hover:not(:disabled) { filter: brightness(1.08); }
.fc-copy:disabled { opacity: .5; cursor: default; }

.fc-lenders { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 14px; padding-top: 14px; border-top: 1px dashed var(--border); }
.fc-lenders-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
.fc-lchip { display: inline-flex; align-items: center; gap: 4px; background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 4px 11px; font-size: 12px; cursor: pointer; }
.fc-lchip:hover:not(:disabled) { border-color: var(--green); color: var(--green); }
.fc-lchip:disabled { opacity: .5; cursor: default; }

/* skeleton */
.skel-card { border-left-color: var(--border); }
.skel-line { height: 16px; margin-bottom: 12px; }
.skel-line.w40 { width: 40%; }
.skel-line.w80 { width: 80%; }
.skel-pipe { height: 52px; width: 60%; margin: 16px 0; }
.skel-btn { height: 42px; width: 220px; }
</style>
