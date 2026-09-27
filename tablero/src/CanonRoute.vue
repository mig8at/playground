<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({ reference: { type: String, required: true }, label: String, server: { type: String, required: true } });
const emit = defineEmits(['resolved']);
const view = ref(null);
const error = ref('');
const loading = ref(false);
const root = ref(null);
const visible = ref(false);
const detailsOpen = ref(false);
const focus = computed(() => view.value?.steps.find(step => step.focused));
let controller, observer;
let loadedAt = 0;

async function load() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  const reference = props.reference;
  loading.value = true;
  error.value = '';
  try {
    const response = await fetch(`${props.server}/api/canon/route?ref=${encodeURIComponent(reference)}`, { signal: current.signal });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'No se pudo cargar el recorrido.');
    if (data.reference !== reference || !Array.isArray(data.steps) || !data.steps.length || !data.url) throw new Error('Canon devolvió un recorrido incompleto.');
    if (current.signal.aborted) return;
    view.value = data;
    loadedAt = Date.now();
    emit('resolved', reference, data.url);
  } catch (err) {
    if (current.signal.aborted) return;
    view.value = null;
    error.value = err.message || 'No se pudo cargar el recorrido.';
    emit('resolved', reference, null);
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}

function refresh() { if (visible.value && Date.now() - loadedAt >= 60000) load(); }
watch(() => [props.reference, props.server], () => {
  controller?.abort();
  view.value = null;
  detailsOpen.value = false;
  loadedAt = 0;
  if (visible.value) load();
});
onMounted(() => {
  observer = new IntersectionObserver(entries => {
    visible.value = entries.some(entry => entry.isIntersecting);
    if (visible.value && !loading.value && !view.value && !error.value) load();
  });
  observer.observe(root.value);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
});
onBeforeUnmount(() => {
  controller?.abort();
  observer?.disconnect();
  window.removeEventListener('focus', refresh);
  window.removeEventListener('online', refresh);
});
</script>

<template>
  <section ref="root" class="canon-route" :aria-label="label || 'Recorrido de Canon'" :aria-busy="loading">
    <template v-if="view">
      <div class="route-heading">
        <span>{{ view.title }} <span class="route-variant">· {{ view.variant_title }}</span></span>
        <a :href="view.url" target="_blank" rel="noopener">Ver mapa ↗</a>
      </div>
      <div class="route-track">
        <span v-if="view.before" class="route-more" :title="`${view.before} pasos anteriores en esta variante`">+{{ view.before }} antes</span>
        <ol aria-label="Secuencia documentada">
          <li v-for="step in view.steps" :key="step.id" :class="{ focused: step.focused }">
            <a :href="step.url" :aria-current="step.focused ? 'step' : undefined" :title="step.note || step.title" target="_blank" rel="noopener">
              <span class="route-dot" aria-hidden="true"></span>{{ step.title }}
            </a>
          </li>
        </ol>
        <span v-if="view.after" class="route-more" :title="`${view.after} pasos posteriores en esta variante`">+{{ view.after }} después</span>
      </div>
      <details :open="detailsOpen" @toggle="detailsOpen = $event.target.open">
        <summary>{{ focus ? 'Regla y fuente' : 'Condición del recorrido' }}</summary>
        <p v-if="view.when">{{ view.when }}</p>
        <p v-if="focus?.note">{{ focus.note }}</p>
        <a v-if="focus?.source_url" :href="focus.source_url" target="_blank" rel="noopener">Leer en Canon ↗</a>
      </details>
    </template>
    <div v-else class="route-unavailable" role="status">
      <span>{{ error || 'Cargando recorrido…' }}</span>
      <button v-if="error" type="button" @click="load">Reintentar</button>
    </div>
  </section>
</template>

<style scoped>
.canon-route { margin: 14px 0 4px; padding: 10px 0; min-width: 0; font-size: var(--text-sm); border-top: 1px solid var(--line) }
.route-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; color: var(--txt) }
.route-heading > span { font-weight: 600 }
.route-variant { color: var(--mut); font-weight: 400 }
a, button { color: var(--acc); text-decoration: none }
a:hover, button:hover { text-decoration: underline }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--acc); outline-offset: 4px }
.route-track { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 13px 0 }
ol { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px 0; padding: 0; margin: 0; list-style: none; min-width: 0 }
li { display: flex; align-items: center; min-width: 0 }
li + li::before { content: '→'; margin: 0 10px; color: var(--mut) }
li a { display: inline-flex; align-items: center; gap: 7px; color: var(--mut); overflow-wrap: anywhere }
li.focused a { color: var(--acc); font-weight: 600 }
.route-dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid currentColor; flex-shrink: 0 }
.focused .route-dot { background: currentColor }
.route-more, summary, .route-unavailable { color: var(--mut) }
summary { cursor: pointer; width: fit-content }
details p { margin: 8px 0; color: var(--txt); line-height: 1.5 }
.route-unavailable { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap }
button { background: none; border: 0; padding: 0; cursor: pointer; font: inherit }
</style>
