<script setup>
/* EVIDENCIA — cómo se trabajó ESTA tarea.
 *
 * El documento conserva el argumento completo. Esta vista lo hace operable sin inventar un resumen:
 * enlaces a las herramientas declaradas, comandos de Harness extraídos del mismo Markdown privado y
 * las comprobaciones fechadas que ya registró la tarea. El contexto de Canon aparece junto a la
 * decisión que lo usó; Trazador queda sólo cuando se siguió una solicitud y Harness para corridas.
 */
import { computed } from 'vue';

const props = defineProps({
  evidence: { type: Array, default: () => [] },
  notes: { type: String, default: '' },
  harnessUrl: { type: String, required: true },
  tracerUrl: { type: String, required: true },
  branches: { type: Object, default: () => ({ ramas: [] }) },
});
const emit = defineEmits(['show-branches']);

const hasSource = (item, source) => item?.fuentes?.includes(source);
const proofs = computed(() => [...props.evidence]
  .filter(item => item?.como || item?.fuentes?.length)
  .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')));
const trazadorCount = computed(() => proofs.value.filter(item => hasSource(item, 'trazador')).length);
const harnessEvidence = computed(() => proofs.value.filter(item => hasSource(item, 'harness')));
const ramas = computed(() => props.branches?.ramas || []);
const ramasEnMain = computed(() => ramas.value.filter(rama => rama.en?.main).length);
const ramasLabel = computed(() => ramas.value.length
  ? `${ramas.value.length} ${ramas.value.length === 1 ? 'rama' : 'ramas'} · ${ramasEnMain.value} en main`
  : 'Sin ramas medidas');

// Sólo se muestran comandos que arrancan una comprobación de Harness. Las consultas `curl` y la
// configuración del backend quedan en el documento: listarlas como «Harness» haría parecer que el
// arnés las ejecuta. El mismo comando puede estar en la receta y en una medición, por eso se deduplica.
const reHarness = /^(?:make\s+harness-[\w-]+(?:\s+.*)?|(?:cd\s+harness\s+&&\s+)?(?:[A-Z_]+=[^\s]+\s+)*bin\/asesor(?:\s+.*)?|npx\s+playwright(?:\s+.*)?|node\s+dev\/[^\s]+(?:\s+.*)?)$/i;
function cleanHarnessCommand(line) {
  const candidate = String(line || '').replace(/^>\s?/, '').replaceAll('`', '')
    .replace(/\s+·\s+TARGET=.*$/i, '').replace(/\s+#.*$/, '').trim();
  return reHarness.test(candidate) ? candidate : '';
}
const harnessCommands = computed(() => {
  const candidates = [
    // Los comandos de la receta son bloques de código sangrados. No se escanea la prosa: «volver a
    // correr bin/asesor» es una instrucción humana, no un comando que se pueda copiar y ejecutar.
    ...props.notes.split('\n').filter(line => /^(?: {4}|\t)/.test(line)).map(line => line.trim()),
    ...harnessEvidence.value.flatMap(item => String(item.como || '').split('\n')),
  ];
  return [...new Set(candidates.map(cleanHarnessCommand).filter(Boolean))];
});
</script>

<template>
  <section class="task-evidence" aria-label="Evidencia de trabajo">
    <header class="evidence-head">
      <h3>Evidencia de trabajo</h3>
      <p>Herramientas, comandos y comprobaciones que explican cómo se avanzó esta tarea.</p>
    </header>

    <section v-if="trazadorCount" class="evidence-section">
      <h4>Herramientas usadas</h4>
      <div v-if="trazadorCount" class="tool-links">
        <a class="tool-link" :href="tracerUrl" target="_blank" rel="noopener">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <span><b>Trazador</b><small>{{ trazadorCount ? `${trazadorCount} ${trazadorCount === 1 ? 'comprobación registrada' : 'comprobaciones registradas'}` : 'abrir para contrastar' }}</small></span>
          <span class="tool-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </section>

    <section class="evidence-section harness-section">
      <div class="section-title">
        <h4>Harness · comandos reproducibles</h4>
        <a :href="harnessUrl" target="_blank" rel="noopener">Abrir Harness ↗</a>
      </div>
      <p v-if="!harnessCommands.length" class="empty">No hay comandos de Harness registrados en el cuerpo de esta tarea.</p>
      <ol v-else class="command-list">
        <li v-for="command in harnessCommands" :key="command"><code>{{ command }}</code></li>
      </ol>
    </section>

    <section class="evidence-section proof-section">
      <h4>Comprobaciones registradas <span v-if="proofs.length">{{ proofs.length }}</span></h4>
      <p v-if="!proofs.length" class="empty">Todavía no hay una comprobación reproducible registrada.</p>
      <article v-for="item in proofs" :key="`${item.fecha}-${item.que}`" class="proof">
        <div class="proof-meta">
          <time :datetime="item.fecha">{{ item.fecha }}</time>
          <span v-for="source in item.fuentes" :key="source" class="badge badge-outline badge-xs">{{ source }}</span>
        </div>
        <p>{{ item.que }}</p>
        <pre v-if="item.como">{{ item.como }}</pre>
      </article>
    </section>

    <button type="button" class="branches-link" @click="emit('show-branches')">
      <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
      <span><b>Ramas de la tarea</b><small>{{ ramasLabel }}</small></span>
      <span class="tool-arrow" aria-hidden="true">→</span>
    </button>
  </section>
</template>

<style scoped>
.task-evidence { min-width: 0; color: var(--txt); }.evidence-head { padding: 2px 0 16px; border-bottom: 1px solid var(--line); }.evidence-head h3, .evidence-head p, .evidence-section p, .proof p { margin: 0 }.evidence-head h3 { font-size: 16px; font-weight: 650 }.evidence-head p { margin-top: 5px; color: var(--mut); font-size: 12.5px; line-height: 1.5 }
.evidence-section { padding: 16px 0; border-bottom: 1px solid var(--line); }.evidence-section h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; color: var(--mut); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase }.evidence-section h4 span { padding: 1px 5px; border-radius: 999px; background: var(--line2); color: var(--txt); font-size: 9px; letter-spacing: 0 }
.tool-links { display: grid; grid-template-columns: minmax(0, 360px); gap: 9px }.tool-link { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); color: var(--txt); font: inherit; text-align: left; text-decoration: none; cursor: pointer }.tool-link:hover { border-color: color-mix(in srgb, var(--acc) 40%, var(--line)); background: var(--sel) }.tool-link .ui-icon { width: 15px; height: 15px; flex: none; color: var(--acc) }.tool-link b, .tool-link small { display: block }.tool-link b { font-size: 12px; font-weight: 600 }.tool-link small { margin-top: 3px; color: var(--mut); font-size: 10.5px; line-height: 1.35 }.tool-arrow { margin-left: auto; flex: none; color: var(--mut); font-size: 13px }
.section-title { display: flex; gap: 10px; align-items: baseline; justify-content: space-between }.section-title a { color: var(--acc); font-size: 11px; text-decoration: none; white-space: nowrap }.command-list { display: grid; gap: 7px; margin: 0; padding-left: 25px }.command-list li { padding-left: 2px; color: var(--mut); font-size: 11px }.command-list code, .proof pre { display: block; overflow-x: auto; margin: 0; padding: 8px 9px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); color: var(--txt); font: 11px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere }.empty { color: var(--mut); font-size: 12px; line-height: 1.5 }
.proof + .proof { margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line) }.proof-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px }.proof-meta time { margin-right: 3px; color: var(--mut); font-size: 10.5px; font-variant-numeric: tabular-nums }.proof > p { margin-top: 6px; font-size: 12px; line-height: 1.5 }.proof pre { margin-top: 8px }.branches-link { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 14px 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; color: var(--txt); font: inherit; text-align: left; cursor: pointer }.branches-link:hover { background: color-mix(in oklab, var(--acc) 7%, transparent) }.branches-link .ui-icon { width: 15px; height: 15px; color: var(--acc) }.branches-link b, .branches-link small { display: block }.branches-link b { font-size: 12px; font-weight: 600 }.branches-link small { margin-top: 3px; color: var(--mut); font-size: 10.5px }
@media (max-width: 620px) { .tool-links { grid-template-columns: 1fr } }
</style>
