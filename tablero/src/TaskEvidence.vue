<script setup>
/* EVIDENCIA — cómo se trabajó ESTA tarea.
 *
 * El documento conserva el argumento completo. Esta vista lo hace operable sin inventar un resumen:
 * enlaces a las herramientas usadas y las comprobaciones fechadas que ya registró la tarea. El contexto
 * de Canon aparece junto a la decisión que lo usó, y Trazador sólo cuando se siguió una solicitud.
 *
 * ⚠ Acá había una sección «Harness · comandos reproducibles» con su «Abrir Harness ↗», que se mostraba
 * aunque la tarea no tuviera nada que correr en el arnés: ocupaba lugar y empujaba a llenarla con algo
 * que no aplicaba. Se retiró el 2026-09-23 (pedido de Miguel); un comando de Harness que sirva de
 * prueba sigue apareciendo en «Comprobaciones registradas», junto a la medición que respalda.
 *
 * Y el bloque entero sólo se dibuja si hay algo que mostrar: `evidence` trae ya filtrados los hallazgos
 * que dicen con qué se midieron, y sin ninguno App.vue no lo monta. Tenía su propio «Todavía no hay una
 * comprobación reproducible registrada», que en una tarea limpia era un contenedor vacío más.
 */
import { computed } from 'vue';

const props = defineProps({
  evidence: { type: Array, default: () => [] },
  tracerUrl: { type: String, required: true },
});

const hasSource = (item, source) => item?.sources?.includes(source);
const proofs = computed(() => [...props.evidence].sort((a, b) => (b.date || '').localeCompare(a.date || '')));
const trazadorCount = computed(() => proofs.value.filter(item => hasSource(item, 'trazador')).length);
</script>

<template>
  <section class="task-evidence" aria-label="Evidencia de trabajo">
    <header class="evidence-head">
      <h3>Evidencia de trabajo</h3>
      <p>Herramientas, comandos y comprobaciones que explican cómo se avanzó esta tarea.</p>
    </header>

    <section v-if="trazadorCount" class="evidence-section">
      <h4>Herramientas usadas</h4>
      <div class="tool-links">
        <a class="tool-link" :href="tracerUrl" target="_blank" rel="noopener">
          <span class="ui-icon" data-icon="search" aria-hidden="true"></span>
          <span><b>Trazador</b><small>{{ trazadorCount }} {{ trazadorCount === 1 ? 'comprobación registrada' : 'comprobaciones registradas' }}</small></span>
          <span class="tool-arrow" aria-hidden="true">↗</span>
        </a>
      </div>
    </section>

    <section class="evidence-section proof-section">
      <h4>Comprobaciones registradas <span>{{ proofs.length }}</span></h4>
      <article v-for="item in proofs" :key="`${item.date}-${item.what}`" class="proof">
        <div class="proof-meta">
          <time :datetime="item.date">{{ item.date }}</time>
          <span v-for="source in item.sources" :key="source" class="badge badge-outline badge-xs">{{ source }}</span>
        </div>
        <p>{{ item.what }}</p>
        <pre v-if="item.how">{{ item.how }}</pre>
      </article>
    </section>

  </section>
</template>

<style scoped>
.task-evidence { min-width: 0; color: var(--txt); }.evidence-head { padding: 2px 0 16px; border-bottom: 1px solid var(--line); }.evidence-head h3, .evidence-head p, .evidence-section p, .proof p { margin: 0 }.evidence-head h3 { font-size: 16px; font-weight: 650 }.evidence-head p { margin-top: 5px; color: var(--mut); font-size: 12.5px; line-height: 1.5 }
.evidence-section { padding: 16px 0; border-bottom: 1px solid var(--line); }.evidence-section h4 { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; color: var(--mut); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase }.evidence-section h4 span { padding: 1px 5px; border-radius: 999px; background: var(--line2); color: var(--txt); font-size: 9px; letter-spacing: 0 }
.tool-links { display: grid; grid-template-columns: minmax(0, 360px); gap: 9px }.tool-link { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); color: var(--txt); font: inherit; text-align: left; text-decoration: none; cursor: pointer }.tool-link:hover { border-color: color-mix(in srgb, var(--acc) 40%, var(--line)); background: var(--sel) }.tool-link .ui-icon { width: 15px; height: 15px; flex: none; color: var(--acc) }.tool-link b, .tool-link small { display: block }.tool-link b { font-size: 12px; font-weight: 600 }.tool-link small { margin-top: 3px; color: var(--mut); font-size: 10.5px; line-height: 1.35 }.tool-arrow { margin-left: auto; flex: none; color: var(--mut); font-size: 13px }
.proof pre { display: block; overflow-x: auto; margin: 0; padding: 8px 9px; border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--panel2); color: var(--txt); font: 11px/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere }
.proof + .proof { margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line) }.proof-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px }.proof-meta time { margin-right: 3px; color: var(--mut); font-size: 10.5px; font-variant-numeric: tabular-nums }.proof > p { margin-top: 6px; font-size: 12px; line-height: 1.5 }.proof pre { margin-top: 8px }
@media (max-width: 620px) { .tool-links { grid-template-columns: 1fr } }
</style>
