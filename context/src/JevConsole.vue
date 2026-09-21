<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  node: { type: String, required: true },
  nodeName: { type: String, required: true },
  files: { type: Array, default: () => [] },
  names: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['select-node', 'close'])

const command = ref('brief')
const phase = ref('idle')
const error = ref('')
const helpOpen = ref(false)
const brief = ref(null)
const scoped = ref(null)
const review = ref(null)
const route = ref(null)
const selectedFiles = ref([])

const fileCandidates = computed(() => {
  const priority = (path) => {
    const value = path.toLowerCase()
    if (/\/(?:routes?|controllers?|services?|use-cases?)\//.test(value)) return 0
    if (/(?:route|controller|service|repository|component|handler)\./.test(value)) return 1
    if (/\/tests?\//.test(value)) return 3
    return 2
  }
  return [...new Set(props.files)].sort((a, b) => priority(a) - priority(b) || a.localeCompare(b)).slice(0, 12)
})
const selectedCount = computed(() => selectedFiles.value.length)
const currentScope = computed(() => scoped.value?.node === props.node &&
  scoped.value.files?.map((file) => file.path).join('|') === selectedFiles.value.join('|'))
const shortSummary = computed(() => {
  const text = brief.value?.summary || scoped.value?.brief?.summary || ''
  return text.length > 760 ? `${text.slice(0, 757).trimEnd()}…` : text
})
const nameOf = (node) => props.names[node] || node
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`

watch(() => props.node, () => {
  selectedFiles.value = []
  brief.value = null
  scoped.value = null
  review.value = null
  error.value = ''
})

function setSuggestedFiles() {
  selectedFiles.value = fileCandidates.value.slice(0, 3)
}

function apiError(value) {
  return {
    'invalid-query': 'Escribí una pregunta breve, sin datos sensibles.',
    'sensitive-query': 'La consulta parece incluir datos sensibles y no se envió.',
    'invalid-node': 'El nodo solicitado no es válido.',
    'invalid-scope': 'Elegí entre uno y tres archivos declarados por el nodo.',
    'jev-unavailable': 'JEV no está disponible en este entorno. La ficha local sigue lista.',
  }[value] || 'No se pudo preparar esta etapa.'
}

async function call(action, payload) {
  phase.value = 'loading'
  error.value = ''
  try {
    const response = await fetch(`/api/jev/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const data = await response.json()
    if (!response.ok || data.error) throw new Error(data.error || 'jev-unavailable')
    phase.value = 'idle'
    return data
  } catch (reason) {
    phase.value = 'error'
    error.value = apiError(reason.message)
    return null
  }
}

async function runBrief(node = props.node) {
  const data = await call('brief', { node })
  if (!data) return
  brief.value = data
  if (node !== props.node) emit('select-node', node)
}

async function runRoute(question) {
  if (!question) { error.value = 'Después de route escribí una pregunta.'; return }
  const data = await call('route', { query: question })
  if (data) route.value = data
}

async function runScope() {
  const data = await call('scope', { node: props.node, files: selectedFiles.value })
  if (data) { scoped.value = data; review.value = null }
}

async function runReview(question) {
  if (!question) { error.value = 'Después de guide escribí qué querés decidir.'; return }
  if (!currentScope.value) { error.value = 'Primero prepará el scope de código seleccionado.'; return }
  const data = await call('review', { node: props.node, files: selectedFiles.value, query: question })
  if (data) review.value = data
}

async function runCommand() {
  const [verb = '', ...rest] = command.value.trim().split(/\s+/)
  const argument = rest.join(' ').trim()
  if (!verb || verb === 'help') { helpOpen.value = true; error.value = ''; return }
  if (verb === 'brief') return runBrief(argument || props.node)
  if (verb === 'route') return runRoute(argument)
  if (verb === 'scope') return runScope()
  if (verb === 'guide' || verb === 'review') return runReview(argument)
  error.value = `No conozco «${verb}». Probá help.`
}

function openNode(node) {
  if (node) emit('select-node', node)
}
</script>

<template>
  <section class="jev-console panel" aria-label="Navegador de investigación JEV">
    <div class="region-head jev-console-head">
      <span class="jev-console-title"><span class="ui-icon" data-icon="console" aria-hidden="true"></span>JEV</span>
      <span class="jev-stage"><b>1</b> mapa</span><span class="jev-stage"><b>2</b> ficha</span><span class="jev-stage"><b>3</b> evidencia</span>
      <span v-if="phase === 'loading'" class="jev-pending"><span class="spinner" aria-hidden="true"></span>preparando…</span>
      <button type="button" class="region-action jev-console-close" aria-label="Ocultar consola JEV" title="Ocultar consola JEV" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </div>

    <div class="jev-console-body">
      <div class="jev-session">
        <form class="jev-command" @submit.prevent="runCommand">
          <span class="jev-prompt" aria-hidden="true">jev ›</span>
          <input v-model="command" class="input input-sm" aria-label="Comando JEV"
                 autocomplete="off" spellcheck="false" placeholder="brief · route pregunta · scope · guide pregunta" />
          <button class="btn btn-ghost btn-icon btn-xs" type="submit" aria-label="Ejecutar comando JEV" title="Ejecutar comando JEV">
            <span class="ui-icon" data-icon="play" aria-hidden="true"></span>
          </button>
        </form>
        <p class="jev-guard">La ficha y el scope son locales. <code>guide</code> es el único paso que consulta JEV.</p>
        <p v-if="error" class="jev-error" role="status">{{ error }}</p>

        <div v-if="helpOpen" class="jev-output jev-help">
          <b>Comandos</b>
          <span><code>route pregunta</code> → propone una entrada general.</span>
          <span><code>brief [nodo]</code> → prepara la ficha curada.</span>
          <span><code>scope</code> → prepara los 1–3 archivos elegidos.</span>
          <span><code>guide pregunta</code> → JEV elige la siguiente evidencia; no responde ni ejecuta código.</span>
        </div>

        <div v-if="route" class="jev-output jev-route-output">
          <div class="jev-output-head"><b>Ruta</b><span>{{ route.mode === 'live' ? 'JEV + mapa local' : 'mapa local' }}</span></div>
          <template v-if="route.decision?.node">
            <span>Entrada sugerida</span>
            <button class="jev-link" type="button" @click="openNode(route.decision.node)">{{ nameOf(route.decision.node) }}</button>
            <span v-if="route.jev" class="jev-muted">{{ pct(route.jev.probability) }} · {{ pct(route.jev.confidence) }} confianza</span>
          </template>
          <template v-else>
            <span>Sin una entrada segura; revisá las candidatas locales.</span>
          </template>
          <div v-if="route.baseline?.length" class="jev-candidates">
            <button v-for="candidate in route.baseline" :key="candidate.node" type="button" @click="openNode(candidate.node)">
              {{ nameOf(candidate.node) }}
            </button>
          </div>
        </div>

        <div v-if="brief || scoped" class="jev-output jev-brief-output">
          <div class="jev-output-head"><b>Ficha general</b><span><code>{{ (brief || scoped.brief).node }}</code></span></div>
          <p>{{ shortSummary }}</p>
          <div class="jev-facts">
            <span>{{ (brief || scoped.brief).files.total }} archivos</span>
            <span v-for="(count, repo) in (brief || scoped.brief).files.by_repo" :key="repo">{{ repo }} · {{ count }}</span>
          </div>
          <div v-if="(brief || scoped.brief).sections?.length" class="jev-sections">
            <span v-for="section in (brief || scoped.brief).sections" :key="section">{{ section }}</span>
          </div>
        </div>

        <div v-if="scoped" class="jev-output jev-scope-output">
          <div class="jev-output-head"><b>Evidencia acotada</b><span>{{ scoped.source_chars.toLocaleString() }} caracteres · {{ scoped.redactions }} redacciones</span></div>
          <details v-for="file in scoped.files" :key="file.path" class="jev-code-preview">
            <summary><code>{{ file.path }}</code><span>{{ file.ref }} · líneas {{ file.line_start }}–{{ file.line_end }}<template v-if="file.truncated"> · recortado</template></span></summary>
            <pre>{{ file.content }}</pre>
          </details>
        </div>

        <div v-if="review" class="jev-output jev-guide-output">
          <div class="jev-output-head"><b>Siguiente paso</b><span>JEV</span></div>
          <template v-if="review.decision?.next">
            <span>Revisar primero</span>
            <code>{{ review.decision.next }}</code>
            <span v-if="review.jev" class="jev-muted">{{ pct(review.jev.probability) }} · {{ pct(review.jev.confidence) }} confianza</span>
          </template>
          <template v-else><span>JEV no recomienda una siguiente evidencia con seguridad. Conservá la revisión manual.</span></template>
          <p v-if="review.jev?.needs_case_data >= .5" class="jev-case-note">Podría requerir evidencia de un caso; no se solicitó ni se envió.</p>
        </div>
      </div>

      <aside class="jev-evidence" aria-label="Selección de evidencia de código">
        <div class="jev-evidence-head"><b>Scope</b><span :title="nodeName"><code>{{ node }}</code></span></div>
        <p>Elegí hasta tres fuentes declaradas. Se leen desde <code>main</code> u <code>origin/main</code>, se limitan y se revisan antes de salir.</p>
        <div class="jev-evidence-actions">
          <button type="button" class="btn btn-outline btn-sm" @click="setSuggestedFiles">Elegir 3 sugeridos</button>
          <span>{{ selectedCount }}/3</span>
        </div>
        <label v-for="file in fileCandidates" :key="file" class="jev-file-option">
          <input v-model="selectedFiles" type="checkbox" :value="file" :disabled="!selectedFiles.includes(file) && selectedCount >= 3" />
          <code :title="file">{{ file }}</code>
        </label>
        <p v-if="!fileCandidates.length" class="jev-muted">Este nodo no declara código seleccionable.</p>
        <button type="button" class="btn btn-sm jev-scope-button" :disabled="!selectedCount || phase === 'loading'" @click="runScope">
          Preparar scope local
        </button>
      </aside>
    </div>
  </section>
</template>
