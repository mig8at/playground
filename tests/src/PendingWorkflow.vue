<script setup>
// Las etapas de una tienda hacia producción, una debajo de otra y unidas por una línea: verde lo hecho, ámbar lo que
// frena la salida y gris lo que puede esperar.
import { computed } from 'vue'

const props = defineProps({ plan: { type: Object, required: true } })

// El estado de una etapa: todo hecho, algo frena, o sólo queda lo que puede esperar.
function stateOf(stage) {
  if (stage.items.every((i) => i.done)) return 'ok'
  return stage.items.some((i) => !i.done && i.blocks) ? 'block' : 'later'
}

const stages = computed(() => props.plan.stages.map((s) => ({
  ...s,
  state: stateOf(s),
  done: s.items.filter((i) => i.done).length,
})))
const blocking = computed(() => props.plan.stages.flatMap((s) => s.items).filter((i) => !i.done && i.blocks).length)
</script>

<template>
  <div class="pending">
    <p class="summary">
      <span v-if="blocking">{{ blocking }} cosas frenan la salida a producción.</span>
      <span v-else>Nada frena la salida a producción.</span>
    </p>
    <ol class="stages">
      <li v-for="s in stages" :key="s.title" class="stage" :data-state="s.state">
        <span class="node" aria-hidden="true">{{ s.state === 'ok' ? '✓' : '' }}</span>
        <div class="stage-head">
          <span class="stage-title">{{ s.title }}</span>
          <span class="count">{{ s.done }}/{{ s.items.length }}</span>
        </div>
        <ul class="items">
          <li v-for="i in s.items" :key="i.text" class="item" :data-state="i.done ? 'ok' : i.blocks ? 'block' : 'later'">
            <span class="mark" aria-hidden="true">{{ i.done ? '✓' : i.blocks ? '!' : '·' }}</span>
            <span class="text">{{ i.text }}</span>
            <span v-if="i.by && !i.done" class="by">{{ i.by }}</span>
          </li>
        </ul>
      </li>
    </ol>
    <p class="legend">
      <span class="item" data-state="ok"><span class="mark">✓</span>hecho</span>
      <span class="item" data-state="block"><span class="mark">!</span>frena producción</span>
      <span class="item" data-state="later"><span class="mark">·</span>puede esperar</span>
    </p>
  </div>
</template>

<style scoped>
.pending { padding: var(--space-3) var(--gutter); max-width: 760px }
.summary { margin: 0 0 var(--space-3); font-weight: 600 }
.stages { list-style: none; margin: 0; padding: 0 }
.stage { position: relative; padding: 0 0 var(--space-4) 32px; --c: var(--fg-3) }
.stage[data-state="ok"] { --c: var(--tests-ok) }
.stage[data-state="block"] { --c: var(--tests-warn) }
/* La línea que une una etapa con la siguiente. */
.stage:not(:last-child)::before { content: ''; position: absolute; left: 9px; top: 20px; bottom: 0; width: 2px; background: var(--border) }
.stage[data-state="ok"]:not(:last-child)::before { background: var(--tests-ok) }
.node { position: absolute; left: 0; top: 0; width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--c);
  background: var(--background); display: grid; place-items: center; font-size: 11px; font-weight: 700; color: var(--tests-ok-ink, var(--background)) }
.stage[data-state="ok"] .node { background: var(--tests-ok) }
.stage-head { display: flex; align-items: baseline; gap: var(--space-2); min-height: 20px }
.stage-title { font-weight: 600 }
.count { color: var(--fg-3); font-size: var(--text-sm) }
.items { list-style: none; margin: var(--space-1) 0 0; padding: 0; display: grid; gap: 2px }
.item { display: flex; align-items: baseline; gap: var(--space-2); font-size: var(--text-sm); line-height: 1.5 }
.mark { flex: none; width: 14px; text-align: center; font-weight: 700; color: var(--fg-3) }
.item[data-state="ok"] .mark { color: var(--tests-ok) }
.item[data-state="ok"] .text { color: var(--fg-3) }
.item[data-state="block"] .mark { color: var(--tests-warn) }
.by { flex: none; margin-left: auto; padding: 0 var(--space-2); border: 1px solid var(--border); border-radius: 999px;
  font-size: 11px; color: var(--fg-3); white-space: nowrap }
.legend { display: flex; gap: var(--space-4); margin: 0; padding-top: var(--space-2); border-top: 1px solid var(--border) }
</style>
