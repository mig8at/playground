<script setup>
/* El paso a paso de una corrida, dentro de la interfaz: la meta, cómo terminó y cada paso con su localizador, lo
 * que falló y la foto de cómo quedó la página. Lee /api/runs/<id> (lo que deja report.go en la carpeta de la
 * corrida); las fotos se sirven desde /api/corridas/<id>/. */
import { computed } from 'vue'

const props = defineProps({ run: { type: Object, required: true } })
const meta = computed(() => props.run.corrida || {})
const steps = computed(() => props.run.pasos || [])
const shot = (name) => `/api/corridas/${encodeURIComponent(meta.value.id)}/${encodeURIComponent(name)}`
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
const fmtDate = (t) => (t ? new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const kwClass = (k) => ({ LISTO: 'kw-ok', 'NO PUDE': 'kw-bad', NECESITO: 'kw-ask', CONFIRMAR: 'kw-ask' })[k] || 'kw-none'
const usd = (n) => (n ? `US$ ${n.toFixed(2)}` : '')
// El resultado sin la palabra clave adelante (ya va en la píldora).
const result = computed(() => (meta.value.resultado || '').replace(/^\s*\**\s*(LISTO|NO PUDE|NECESITO|CONFIRMAR)\s*:?\**\s*/i, ''))
</script>

<template>
  <article class="run">
    <header class="run-head">
      <div class="run-title">
        <span v-if="meta.palabra" class="badge kw" :class="kwClass(meta.palabra)">{{ meta.palabra }}</span>
        <h1>{{ meta.meta || 'Corrida sin meta' }}</h1>
      </div>
      <p class="muted small">
        {{ meta.sitio }} · {{ fmtDate(meta.fecha) }} · {{ meta.pasos }} pasos<template v-if="meta.fallidos">, {{ meta.fallidos }} fallidos</template>
        <template v-if="meta.usd"> · {{ usd(meta.usd) }}</template><template v-if="meta.turnos"> · {{ meta.turnos }} turnos</template>
        <template v-if="meta.origen"> · {{ meta.origen }}</template>
      </p>
      <p v-if="(meta.vueltas || []).length > 1" class="muted small">Vueltas: {{ meta.vueltas.join(' → ') }}</p>
      <div v-if="result" class="run-result">{{ result }}</div>
    </header>

    <ol class="steps">
      <li v-for="(s, i) in steps" :key="i" class="step" :class="{ bad: !s.ok }">
        <div class="step-n">{{ i + 1 }}<span class="step-mark">{{ s.ok ? '✓' : '✗' }}</span></div>
        <div class="step-body">
          <code>{{ s.code }}</code>
          <div v-if="s.error" class="step-err">{{ s.error }}</div>
          <div v-for="(d, j) in s.dialogs || []" :key="j" class="muted small">diálogo: {{ d }}</div>
          <div v-if="s.note" class="muted small">{{ s.note }}</div>
          <div class="muted small step-meta">{{ fmtTime(s.at) }} · {{ s.url }}</div>
        </div>
        <a v-if="s.shot" class="step-shot" :href="shot(s.shot)" target="_blank" rel="noopener" :title="`Ver la foto del paso ${i + 1}`">
          <img :src="shot(s.shot)" :alt="`Cómo quedó la página en el paso ${i + 1}`" loading="lazy" />
        </a>
      </li>
    </ol>
    <p v-if="!steps.length" class="muted">La corrida no hizo ningún paso: sólo leyó (las fuentes están a la derecha).</p>
  </article>
</template>

<style scoped>
.run { padding: var(--space-6); max-width: 1100px; display: flex; flex-direction: column; gap: var(--space-4) }
.run-head { display: flex; flex-direction: column; gap: var(--space-2) }
.run-title { display: flex; align-items: center; gap: var(--space-3) }
.run-title h1 { margin: 0; font-size: var(--text-title); font-weight: 600 }
.run-result { white-space: pre-wrap; font-size: var(--text-body); line-height: 1.6; padding: var(--space-3) var(--space-4); border-left: 2px solid var(--border); background: var(--hover) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm) }
.kw { flex: none }
.kw-ok { background: var(--kw-ok); color: var(--kw-ink) }
.kw-bad { background: var(--kw-bad); color: var(--kw-ink) }
.kw-ask { background: var(--kw-ask); color: var(--kw-ink) }
.kw-none { background: var(--hover); color: var(--fg-2) }
.steps { list-style: none; margin: 0; padding: 0 }
.step { display: grid; grid-template-columns: 44px 1fr 280px; gap: var(--space-3); padding: var(--space-3) 0; border-top: 1px solid var(--border); align-items: start }
.step-n { font-variant-numeric: tabular-nums; color: var(--fg-3); font-size: var(--text-sm) }
.step-mark { margin-left: 4px; color: var(--kw-ok-ink) }
.step.bad .step-mark { color: var(--status-bad) }
.step-body { min-width: 0; display: flex; flex-direction: column; gap: 4px }
.step-body code { font-family: var(--font-mono); font-size: var(--text-sm); overflow-wrap: anywhere }
.step-err { color: var(--status-bad); font-size: var(--text-sm) }
.step-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.step-shot img { width: 100%; display: block; border: 1px solid var(--border); border-radius: var(--radius-control) }
.step.bad .step-shot img { border-color: var(--status-bad) }
@container (max-width: 640px) { .step { grid-template-columns: 36px 1fr } .step-shot { grid-column: 2 } }
</style>
