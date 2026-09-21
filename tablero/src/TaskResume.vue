<script setup>
/* RETOMAR — la puerta de vuelta a una tarea.
 *
 * No resume el documento con IA ni inventa qué validación falta. Junta sólo señales que el tablero ya
 * deriva: el próximo paso escrito, los temas de canon declarados, anotaciones con cómo reproducible y ramas.
 * Las herramientas siguen viviendo en sus propias UIs; acá se entra al nodo, la corrida o la consola
 * precisos sin copiar sus datos a otro tablero.
 */
import { computed } from 'vue';

const props = defineProps({
  nextStep: { type: String, default: '' },
  temasCanon: { type: Array, default: () => [] },
  evidence: { type: Array, default: () => [] },
  toolSources: { type: Array, default: () => [] },
  branches: { type: Object, default: () => ({ ramas: [] }) },
  canonLink: { type: Function, required: true },
  harnessUrl: { type: String, required: true },
  trazadorUrl: { type: String, required: true },
});
const emit = defineEmits(['show-branches']);

const evidence = computed(() => [...props.evidence]
  .filter(item => item?.fuentes?.length)
  .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
  .slice(0, 2));
const hasSource = (source) => props.toolSources.includes(source);
const ramas = computed(() => props.branches?.ramas || []);
const ramasEnMain = computed(() => ramas.value.filter(rama => rama.en?.main).length);
const ramasLabel = computed(() => {
  if (!ramas.value.length) return 'Sin ramas medidas';
  const total = ramas.value.length;
  const enMain = ramasEnMain.value;
  return `${total} ${total === 1 ? 'rama' : 'ramas'} · ${enMain} en main`;
});
</script>

<template>
  <section class="task-resume" aria-label="Retomar esta tarea">
    <div class="resume-intro">
      <span class="ui-icon" data-icon="play" aria-hidden="true"></span>
      <div>
        <h3>Retomar</h3>
        <p>{{ nextStep || 'No hay un próximo paso escrito todavía. Actualizalo en el documento antes de seguir.' }}</p>
      </div>
    </div>

    <div class="resume-path">
      <section class="resume-step">
        <h4>Entender</h4>
        <div v-if="temasCanon.length" class="resume-canon">
          <a v-for="tema in temasCanon" :key="tema" :href="canonLink(tema)" target="_blank" rel="noopener"
             class="badge badge-outline resume-tema"
             :title="`Abrir canon (${tema} todavía no tiene enlace directo)`">{{ tema }} ↗</a>
        </div>
        <p v-else class="resume-empty">No hay temas de canon declarados.</p>
      </section>

      <section class="resume-step">
        <h4>Comprobar</h4>
        <div class="resume-tools">
          <a class="resume-tool" :href="harnessUrl" target="_blank" rel="noopener" title="Abrir Harness">
            <span class="ui-icon" data-icon="play" aria-hidden="true"></span><span>Harness</span>
            <small :class="{ used: hasSource('harness') }">{{ hasSource('harness') ? 'usado como evidencia' : 'abrir para ejecutar' }}</small>
          </a>
          <a class="resume-tool" :href="trazadorUrl" target="_blank" rel="noopener" title="Abrir Trazador">
            <span class="ui-icon" data-icon="search" aria-hidden="true"></span><span>Trazador</span>
            <small :class="{ used: hasSource('trazador') }">{{ hasSource('trazador') ? 'usado como evidencia' : 'abrir para contrastar' }}</small>
          </a>
        </div>
      </section>

      <section class="resume-step resume-proof">
        <h4>Última evidencia</h4>
        <template v-if="evidence.length">
          <article v-for="item in evidence" :key="`${item.fecha}-${item.que}`" class="resume-evidence">
            <div><time :datetime="item.fecha">{{ item.fecha }}</time><span>{{ item.que }}</span></div>
            <p><span v-for="source in item.fuentes" :key="source" class="badge badge-outline badge-xs">{{ source }}</span></p>
          </article>
        </template>
        <p v-else class="resume-empty">Todavía no hay una comprobación reproducible registrada.</p>
      </section>

      <button type="button" class="resume-branches" @click="emit('show-branches')">
        <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
        <span><b>Integrar</b><small>{{ ramasLabel }}</small></span>
        <span class="ui-icon resume-arrow" data-icon="chevron" aria-hidden="true"></span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.task-resume { min-width: 0; }
.resume-intro { display: flex; align-items: flex-start; gap: 9px; padding: 2px 0 14px; }.resume-intro > .ui-icon { flex: none; margin-top: 2px; color: var(--acc); }
h3, h4, p { margin: 0 }.resume-intro h3 { color: var(--txt); font-size: 12px; font-weight: 650 }.resume-intro p { margin-top: 3px; color: var(--txt); font-size: 12.5px; line-height: 1.45; }
.resume-path { border-top: 1px solid var(--line); }.resume-step, .resume-branches { min-width: 0; padding: 13px 0; border-bottom: 1px solid var(--line); }.resume-step h4 { margin-bottom: 8px; color: var(--mut); font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.resume-canon { display: flex; flex-wrap: wrap; gap: 4px }.resume-tema { color: var(--acc); font-size: 10.5px; text-decoration: none }.resume-empty { color: var(--mut); font-size: 11px; line-height: 1.4; }
.resume-tools { display: grid; gap: 8px }.resume-tool { display: grid; grid-template-columns: 14px minmax(0, auto); gap: 0 6px; align-items: center; color: var(--txt); font-size: 11.5px; text-decoration: none }.resume-tool .ui-icon { width: 13px; height: 13px; color: var(--mut) }.resume-tool small { grid-column: 2; color: var(--mut); font-size: 10px; }.resume-tool small.used { color: var(--acc) }.resume-tool:hover > span { color: var(--acc) }
.resume-evidence + .resume-evidence { margin-top: 9px }.resume-evidence > div { display: flex; gap: 7px; min-width: 0; color: var(--txt); font-size: 11px; line-height: 1.35 }.resume-evidence time { flex: none; color: var(--mut); font-variant-numeric: tabular-nums }.resume-evidence span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }.resume-evidence p { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px }.resume-evidence .badge { color: var(--mut) }
.resume-branches { display: flex; align-items: center; gap: 7px; width: 100%; border: 0; border-bottom: 1px solid var(--line); color: var(--txt); background: transparent; text-align: left; cursor: pointer }.resume-branches:hover { background: color-mix(in oklab, var(--acc) 7%, transparent) }.resume-branches > .ui-icon:first-child { color: var(--acc) }.resume-branches b, .resume-branches small { display: block }.resume-branches b { font-size: 11.5px; font-weight: 600 }.resume-branches small { margin-top: 3px; color: var(--mut); font-size: 10px; line-height: 1.35 }.resume-arrow { width: 13px; height: 13px; margin-left: auto; color: var(--mut) }
</style>
