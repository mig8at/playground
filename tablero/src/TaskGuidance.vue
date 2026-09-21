<script setup>
/* ORIENTACIÓN DE LA TAREA — una propuesta efímera, no otro estado del tablero.
 *
 * Jev sólo recibe una proyección mínima de `retomar`: título, etapa, próximo paso, edad y conteos.
 * Por eso este bloque no finge haber leído el documento, las ramas o Jira. Tampoco escribe: copiar
 * deja un borrador en el portapapeles para que la persona decida qué hacer con él.
 */
import { computed, ref, watch } from 'vue';

const props = defineProps({
  guidance: { type: Object, default: null },
  loading: Boolean,
  error: { type: String, default: '' },
});
const emit = defineEmits(['start', 'close', 'copy']);

const alternativesOpen = ref(false);
watch(() => props.guidance, () => { alternativesOpen.value = false; });

const actionLabel = {
  ejecutar: 'Ejecutar el próximo paso',
  desbloquear: 'Desbloquear antes de avanzar',
  'pedir-respuesta': 'Pedir una respuesta',
  decidir: 'Tomar una decisión',
  'archivar-o-replantear': 'Replantear o archivar',
};
const urgencyLabel = ['Puede esperar', 'Normal', 'Conviene priorizar', 'Crítica'];
const action = computed(() => props.guidance?.action || '');
const isReview = computed(() => props.guidance?.review || !action.value);
const alternatives = computed(() => (props.guidance?.alternatives || [])
  .filter(item => item.action !== action.value)
  .slice(0, 3));
</script>

<template>
  <section class="task-guidance" aria-live="polite" aria-label="Orientación de siguiente paso">
    <div class="guidance-head">
      <span class="guidance-spark" aria-hidden="true">✦</span>
      <strong>Orientación</strong>
      <span v-if="loading" class="guidance-status">analizando…</span>
      <button type="button" class="btn btn-ghost btn-icon btn-xs guidance-close" aria-label="Cerrar orientación"
              title="Cerrar" @click="emit('close')">×</button>
    </div>

    <template v-if="loading">
      <p class="guidance-copy">Jev está evaluando sólo los metadatos mínimos de esta tarea.</p>
    </template>

    <template v-else-if="error">
      <p class="guidance-error">{{ error }}</p>
      <button type="button" class="btn btn-outline btn-sm" @click="emit('start')">Reintentar</button>
    </template>

    <template v-else-if="guidance">
      <template v-if="isReview">
        <p class="guidance-title">Hace falta revisión humana</p>
        <p class="guidance-copy">No hubo una orientación con confianza suficiente. Abrí Context o revisá la tarea antes de decidir.</p>
      </template>
      <template v-else>
        <div class="guidance-main">
          <p class="guidance-title">{{ actionLabel[action] || action }}</p>
          <span class="guidance-chip" :class="'u-' + Math.round(guidance.urgency || 0)">
            {{ urgencyLabel[Math.round(guidance.urgency || 0)] || 'A revisar' }}
          </span>
          <span class="guidance-blocker">{{ guidance.externalBlocker ? 'depende de terceros' : 'puede avanzar localmente' }}</span>
        </div>
        <p class="guidance-copy">Es una orientación, no un cambio de estado ni de pendientes.</p>
      </template>

      <div class="guidance-actions">
        <button v-if="!isReview" type="button" class="btn btn-outline btn-sm" @click="emit('copy')">Copiar como borrador</button>
        <button v-if="alternatives.length" type="button" class="btn btn-ghost btn-sm guidance-options"
                :aria-expanded="alternativesOpen" @click="alternativesOpen = !alternativesOpen">
          {{ alternativesOpen ? 'Ocultar opciones' : 'Ver opciones' }}
        </button>
      </div>
      <ul v-if="alternativesOpen" class="guidance-alternatives" aria-label="Alternativas de orientación">
        <li v-for="option in alternatives" :key="option.action">
          <span>{{ actionLabel[option.action] || option.action }}</span>
          <small>{{ Math.round(option.probability * 100) }}%</small>
        </li>
      </ul>
    </template>

    <template v-else>
      <p class="guidance-copy">Jev puede orientar el siguiente tipo de acción con el título, la etapa, el próximo paso, la antigüedad y los conteos. No envía el cuerpo, ramas ni Registro.</p>
      <button type="button" class="btn btn-outline btn-sm" @click="emit('start')">Analizar con Jev</button>
    </template>
  </section>
</template>

<style scoped>
.task-guidance { max-width: 760px; padding: 10px 12px; border-left: 2px solid var(--acc); background: var(--panel2); }
.guidance-head { display: flex; align-items: center; gap: 6px; min-height: 18px; color: var(--txt); font-size: 11.5px; }
.guidance-spark { color: var(--acc); font-size: 13px; line-height: 1; }
.guidance-status { color: var(--mut); font-weight: 400; }
.guidance-close { margin-left: auto; color: var(--mut); }
.guidance-main { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 8px; margin-top: 7px; }
.guidance-title { margin: 0; color: var(--txt); font-size: 12.5px; font-weight: 600; }
.guidance-chip, .guidance-blocker { font-size: 10.5px; color: var(--mut); white-space: nowrap; }
.guidance-chip { padding: 1px 6px; border: 1px solid var(--line2); border-radius: var(--radius); }
.guidance-chip.u-2 { color: var(--warn); border-color: color-mix(in oklab, var(--warn) 45%, var(--line)); }
.guidance-chip.u-3 { color: var(--bad); border-color: color-mix(in oklab, var(--bad) 45%, var(--line)); }
.guidance-copy, .guidance-error { margin: 6px 0 0; color: var(--mut); font-size: 11.5px; line-height: 1.45; }
.guidance-error { color: var(--bad); }
.guidance-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.guidance-actions .btn { height: 26px; font-size: 11px; }
.guidance-options { color: var(--mut); }
.guidance-alternatives { display: grid; gap: 3px; margin: 8px 0 0; padding: 7px 0 0; border-top: 1px solid var(--line); list-style: none; color: var(--mut); font-size: 11px; }
.guidance-alternatives li { display: flex; justify-content: space-between; gap: 10px; }
.guidance-alternatives small { font-variant-numeric: tabular-nums; }
</style>
