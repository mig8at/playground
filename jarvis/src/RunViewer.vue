<script setup>
/* Una corrida, como un video: un escenario de tamaño fijo (16:9) que pasa por las fotos de cada paso —la de ANTES
 * de actuar, con el elemento que se va a tocar marcado, y la de cómo quedó— con su leyenda, play/pausa, la barra
 * de pasos y la tira de cuadros abajo. Lee /api/runs/<id> (lo que deja report.go); las fotos se sirven desde
 * /api/run-files/<id>/. Una corrida vieja (sin foto de antes ni cuadro) se ve igual, sólo con las de después. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({ run: { type: Object, required: true }, replayable: { type: Boolean, default: true }, bare: { type: Boolean, default: false } })
const emit = defineEmits(['replay'])
const meta = computed(() => props.run.run || {})
const steps = computed(() => props.run.steps || [])
const shot = (name) => `/api/run-files/${encodeURIComponent(meta.value.id)}/${encodeURIComponent(name)}`
const fmtDate = (t) => (t ? new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const kwClass = (k) => ({ LISTO: 'kw-ok', 'NO PUDE': 'kw-bad', NECESITO: 'kw-ask', CONFIRMAR: 'kw-ask' })[k] || 'kw-none'
const usd = (n) => (n ? `US$ ${n.toFixed(2)}` : '')
// El resultado sin la palabra clave adelante (ya va en la píldora) ni la negrita de Markdown.
const result = computed(() => (meta.value.result || '')
  .replace(/^\s*[*_#>`]*\s*(LISTO|NO PUDE|NECESITO|CONFIRMAR)\s*:?[*_]*\s*/i, '')
  .replace(/(\*\*|__)(.+?)\1/g, '$2'))

// ── los cuadros: por paso, el de antes (con el elemento marcado) y el de después ──
const frames = computed(() => steps.value.flatMap((s, i) => {
  const out = []
  if (s.before) out.push({ step: i, img: s.before, box: s.box, view: s.view, point: s.point, phase: 'antes' })
  if (s.shot) out.push({ step: i, img: s.shot, box: s.before ? null : s.box, view: s.view, point: s.point, phase: s.before ? 'después' : '' })
  return out
}))
const cur = ref(0)
const frame = computed(() => frames.value[cur.value] || null)
const step = computed(() => (frame.value ? steps.value[frame.value.step] : null))

// Qué hace el paso, en palabras: sale del código de Playwright que quedó en el script.
function describe(s) {
  if (!s) return ''
  if (s.guide) return s.guide // en el modo guía, lo que se le pidió a la persona
  const c = s.code || ''
  const t = s.target ? `«${s.target}»` : ''
  const arg = (c.match(/\.(?:fill|selectOption|press)\('((?:[^'\\]|\\.)*)'\)\s*$/) || [])[1]
  if (/^page\.goto\(/.test(c)) return `va a ${s.target}`
  if (/^page\.goBack/.test(c)) return 'vuelve atrás'
  if (/^page\.reload/.test(c)) return 'recarga la página'
  if (/^expect\(.*toBeVisible/.test(c)) return `comprueba que se vea ${t}`
  if (/^expect/.test(c)) return `comprueba ${t}`
  if (/^page\.once\('dialog'/.test(c)) return `contesta el diálogo ${t}`
  if (/waitForEvent\('download'\)|saveAs\(/.test(c)) return `baja ${t}`
  if (/scrollTo/.test(c)) return s.target === 'bajar la página' ? 'baja la página' : `baja hasta el final de ${t}`
  if (/\.dblclick\(/.test(c)) return `doble clic en ${t}`
  if (/\.click\(/.test(c)) return `clic en ${t}`
  if (/\.fill\(/.test(c)) return arg ? `escribe «${arg}» en ${t}` : `vacía ${t}`
  if (/\.selectOption\(/.test(c)) return `elige «${arg}» en ${t}`
  if (/\.uncheck\(/.test(c)) return `desmarca ${t}`
  if (/\.check\(/.test(c)) return `marca ${t}`
  if (/\.press\(/.test(c)) return `aprieta ${arg} en ${t}`
  if (/\.hover\(/.test(c)) return `pasa el mouse por ${t}`
  if (/\.setInputFiles\(/.test(c)) return `sube un archivo a ${t}`
  if (/\.dragTo\(/.test(c)) return `arrastra ${t}`
  return t || c
}
const boxStyle = computed(() => {
  const f = frame.value
  if (!f?.box || !f.view?.w || !f.view?.h) return null
  const pct = (n, d) => `${(n / d) * 100}%`
  return { left: pct(f.box.x, f.view.w), top: pct(f.box.y, f.view.h), width: pct(f.box.w, f.view.w), height: pct(f.box.h, f.view.h) }
})

// ── el cursor: va del punto del paso anterior al de éste, y en la foto de antes deja una onda donde toca ──
const cursor = ref(null) // { left, top } en % de la foto; se queda donde estaba si el cuadro no tiene punto
watch(frame, (f) => {
  if (f?.point && f.view?.w && f.view?.h) cursor.value = { left: `${(f.point.x / f.view.w) * 100}%`, top: `${(f.point.y / f.view.h) * 100}%` }
}, { immediate: true })
const ripple = computed(() => frame.value?.phase === 'antes' && !!frame.value?.point)

// ── los subtítulos (qué y por qué) y la voz del navegador ──
const captions = ref(readPref('jarvis.cc', true))
const voice = ref(readPref('jarvis.voz', false))
watch(captions, (v) => savePref('jarvis.cc', v))
watch(voice, (v) => { savePref('jarvis.voz', v); if (!v) speechSynthesis?.cancel() })
const subtitle = computed(() => {
  const s = step.value
  if (!s) return null
  const what = describe(s)
  const why = s.why && s.why !== what ? s.why.replace(/(\*\*|__)(.+?)\1/g, '$2') : ''
  return { what, why }
})
const spoken = computed(() => (subtitle.value ? [subtitle.value.what, subtitle.value.why].filter(Boolean).join('. ') : ''))
function speak() {
  if (!voice.value || !window.speechSynthesis || !spoken.value) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(spoken.value)
  u.lang = 'es-CO'
  u.rate = Math.min(1.6, 0.95 * speed.value)
  speechSynthesis.speak(u)
}
// Se dice una vez por paso, al entrar (no otra vez en la foto de después).
watch(() => frame.value?.step, () => speak())
function readPref(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1' } catch { return d } }
function savePref(k, v) { try { localStorage.setItem(k, v ? '1' : '0') } catch { /* sin almacenamiento */ } }

// ── reproducir ──
const playing = ref(false)
const speed = ref(1)
let timer = null
// Con voz, el cuadro dura lo que tarda en decirse (aprox. 65 ms por letra).
const frameMs = () => {
  const base = (frame.value?.phase === 'antes' ? 1500 : 1900) / speed.value
  if (!voice.value || frame.value?.phase === 'después') return base
  return Math.max(base, (spoken.value.length * 65) / speed.value)
}
function tick() {
  clearTimeout(timer)
  if (!playing.value) return
  timer = setTimeout(() => {
    if (cur.value >= frames.value.length - 1) { playing.value = false; return }
    cur.value++
    tick()
  }, frameMs())
}
function toggle() {
  if (!frames.value.length) return
  if (!playing.value && cur.value >= frames.value.length - 1) cur.value = 0
  playing.value = !playing.value
  tick()
}
function go(i) { cur.value = Math.max(0, Math.min(frames.value.length - 1, i)); if (playing.value) tick() }
function goStep(i) { const f = frames.value.findIndex((x) => x.step === i); if (f >= 0) go(f) }
function onKey(e) {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return
  if (e.key === ' ') { e.preventDefault(); toggle() }
  else if (e.key === 'ArrowRight') go(cur.value + 1)
  else if (e.key === 'ArrowLeft') go(cur.value - 1)
}

// ── el escenario: 16:9, y la foto entra entera (contenida) con el cuadro encima ──
const stage = ref(null)
const stageH = ref(360)
let obs = null
onMounted(() => {
  obs = new ResizeObserver(() => { if (stage.value) stageH.value = stage.value.clientHeight })
  if (stage.value) obs.observe(stage.value)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => { obs?.disconnect(); clearTimeout(timer); window.removeEventListener('keydown', onKey); window.speechSynthesis?.cancel() })
// Se puede repetir si algún paso trae su localizador (o es moverse o comprobar): las corridas viejas no.
const canReplay = computed(() => steps.value.some((s) => s.ok && (s.ref || ['goto', 'expect'].includes(s.action))))

// Otra corrida: desde el principio, con las fotos precargadas para que el video no parpadee.
watch(() => meta.value.id, () => {
  playing.value = false
  clearTimeout(timer)
  cur.value = 0
  for (const f of frames.value) new Image().src = shot(f.img)
}, { immediate: true })

// La tira sigue al cuadro actual.
const strip = ref(null)
watch(cur, async () => {
  await nextTick()
  strip.value?.querySelector('.thumb.on')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
})
</script>

<template>
  <article class="run">
    <header v-if="!bare" class="run-head">
      <div class="run-title">
        <span v-if="meta.keyword" class="badge kw" :class="kwClass(meta.keyword)">{{ meta.keyword }}</span>
        <h1>{{ meta.meta || 'Corrida sin meta' }}</h1>
        <button v-if="canReplay && replayable" type="button" class="btn btn-sm replay-btn" title="Recorrerla de nuevo en la sesión en vivo, paso a paso: en cada uno elegís si lo hace la herramienta, lo hacés vos o lo saltás" @click="emit('replay')">Reproducir esta corrida</button>
      </div>
      <p class="muted small">
        {{ meta.site }}<template v-if="meta.device === 'mobile'"> · móvil</template> · {{ fmtDate(meta.at) }} · {{ meta.steps }} pasos<template v-if="meta.failed">, {{ meta.failed }} fallidos</template>
        <template v-if="meta.usd"> · {{ usd(meta.usd) }}</template><template v-if="meta.turns"> · {{ meta.turns }} turnos</template>
        <template v-if="meta.source"> · {{ meta.source }}</template>
        <template v-if="(meta.rounds || []).length > 1"> · vueltas: {{ meta.rounds.join(' → ') }}</template>
      </p>
    </header>

    <section v-if="frames.length" class="player" aria-label="La corrida, paso a paso">
      <div ref="stage" class="stage" :class="{ bad: step && !step.ok }" @click="toggle">
        <div v-if="frame" class="shot-wrap">
          <img :src="shot(frame.img)" :style="{ maxHeight: `${stageH}px` }" :alt="`Paso ${frame.step + 1}: ${describe(step)}`" />
          <div v-if="boxStyle" :key="cur" class="hit" :class="{ bad: !step.ok }" :style="boxStyle"></div>
          <div v-if="cursor" class="cursor" :style="cursor" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.5-7.5L20 11z" /></svg>
            <span v-if="ripple" :key="`r${cur}`" class="ripple"></span>
          </div>
        </div>
        <div v-if="captions && subtitle" class="subs" aria-live="polite">
          <span class="subs-what">{{ subtitle.what }}</span>
          <span v-if="subtitle.why" class="subs-why">{{ subtitle.why }}</span>
        </div>
        <span v-if="frame?.phase" class="phase">{{ frame.phase }}</span>
        <span v-if="!playing" class="big-play" aria-hidden="true"><span class="ui-icon" data-icon="play"></span></span>
      </div>

      <div class="scrub" role="group" aria-label="Pasos">
        <button v-for="(f, i) in frames" :key="i" type="button" class="seg" :class="{ on: i === cur, past: i < cur, bad: !steps[f.step].ok, gap: i > 0 && frames[i - 1].step !== f.step }" :title="`Paso ${f.step + 1}${f.phase ? ' · ' + f.phase : ''}: ${describe(steps[f.step])}`" :aria-label="`Ir al paso ${f.step + 1}${f.phase ? ', ' + f.phase : ''}`" @click="go(i)"></button>
      </div>

      <div class="controls">
        <button type="button" class="ctl" title="Anterior (←)" aria-label="Cuadro anterior" :disabled="cur === 0" @click="go(cur - 1)">‹</button>
        <button type="button" class="ctl ctl-play" :title="playing ? 'Pausa (espacio)' : 'Reproducir (espacio)'" :aria-label="playing ? 'Pausa' : 'Reproducir'" @click="toggle">
          <span v-if="playing" class="pause-glyph" aria-hidden="true"></span>
          <span v-else class="ui-icon" data-icon="play" aria-hidden="true"></span>
        </button>
        <button type="button" class="ctl" title="Siguiente (→)" aria-label="Cuadro siguiente" :disabled="cur >= frames.length - 1" @click="go(cur + 1)">›</button>
        <span class="counter">paso {{ (frame?.step ?? 0) + 1 }} de {{ steps.length }}</span>
        <button type="button" class="ctl ctl-tog" :aria-pressed="captions" title="Subtítulos (qué y por qué)" aria-label="Subtítulos" @click.stop="captions = !captions">CC</button>
        <button type="button" class="ctl ctl-tog" :aria-pressed="voice" title="Que lo diga en voz alta (la voz del navegador)" aria-label="Voz" @click.stop="voice = !voice; voice && speak()">🔊</button>
        <button type="button" class="ctl ctl-speed" :title="`Velocidad ${speed}×`" aria-label="Cambiar la velocidad" @click="speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1; tick()">{{ speed }}×</button>
      </div>

      <div v-if="step" class="caption" :class="{ bad: !step.ok }">
        <div class="caption-what"><span class="mark">{{ step.manual ? '👉' : step.ok ? '✓' : '✗' }}</span> {{ describe(step) }}<span v-if="step.manual" class="muted small"> · lo hizo la persona</span></div>
        <div v-if="step.change" class="muted small">«{{ step.change.field }}»: {{ step.change.before || '(vacío)' }} → {{ step.change.after || '(vacío)' }}</div>
        <div v-if="step.error" class="caption-err">{{ step.error }}</div>
        <div v-for="(d, j) in step.dialogs || []" :key="j" class="muted small">diálogo: {{ d }}</div>
        <div v-if="step.note" class="muted small">{{ step.note }}</div>
        <code class="caption-code">{{ step.code }}</code>
        <div class="muted small ellipsis">{{ step.url }}</div>
      </div>

      <div ref="strip" class="strip">
        <button v-for="(s, i) in steps" :key="i" type="button" class="thumb" :class="{ on: frame && frame.step === i, bad: !s.ok }" :title="`Paso ${i + 1}: ${describe(s)}`" @click="goStep(i)">
          <img v-if="s.shot || s.before" :src="shot(s.shot || s.before)" alt="" loading="lazy" />
          <span class="thumb-n">{{ i + 1 }}</span>
        </button>
      </div>
    </section>
    <p v-else class="muted">La corrida no hizo ningún paso: sólo leyó (las fuentes están a la derecha).</p>

    <section v-if="result && !bare" class="run-result-wrap">
      <h2 class="small muted">Lo que respondió</h2>
      <div class="run-result">{{ result }}</div>
    </section>
  </article>
</template>

<style scoped>
.run { padding: var(--space-6); max-width: 1100px; display: flex; flex-direction: column; gap: var(--space-4) }
.run-head { display: flex; flex-direction: column; gap: var(--space-2) }
.run-title { display: flex; align-items: center; gap: var(--space-3) }
.run-title h1 { margin: 0; font-size: var(--text-title); font-weight: 600 }
.run-result-wrap h2 { margin: 0 0 var(--space-2); font-weight: 600 }
.run-result { white-space: pre-wrap; font-size: var(--text-body); line-height: 1.6; padding: var(--space-3) var(--space-4); border-left: 2px solid var(--border); background: var(--hover) }
.muted { color: var(--fg-3) }
.small { font-size: var(--text-sm) }
.kw { flex: none }
.kw-ok { background: var(--kw-ok); color: var(--kw-ink) }
.kw-bad { background: var(--kw-bad); color: var(--kw-ink) }
.kw-ask { background: var(--kw-ask); color: var(--kw-ink) }
.kw-none { background: var(--hover); color: var(--fg-2) }

/* el reproductor */
.player { display: flex; flex-direction: column; gap: var(--space-2) }
.stage { position: relative; aspect-ratio: 16 / 9; width: 100%; background: var(--stage-bg); border-radius: var(--radius-control); overflow: hidden; display: grid; place-items: center; cursor: pointer; outline: 2px solid transparent }
.stage.bad { outline-color: var(--status-bad) }
.shot-wrap { position: relative; display: inline-block; line-height: 0 }
.shot-wrap img { display: block; max-width: 100%; height: auto }
.hit { position: absolute; border: 2px solid var(--primary); border-radius: 4px; background: color-mix(in srgb, var(--primary) 14%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 25%, transparent); animation: hit-in 420ms ease-out; pointer-events: none }
.hit.bad { border-color: var(--status-bad); background: color-mix(in srgb, var(--status-bad) 14%, transparent); box-shadow: 0 0 0 4px color-mix(in srgb, var(--status-bad) 25%, transparent) }
@keyframes hit-in { from { transform: scale(1.25); opacity: 0 } to { transform: scale(1); opacity: 1 } }
.cursor { position: absolute; width: 0; height: 0; pointer-events: none; transition: left .7s cubic-bezier(.4, 0, .2, 1), top .7s cubic-bezier(.4, 0, .2, 1); z-index: 2 }
.cursor svg { position: absolute; left: -3px; top: -2px; fill: var(--cursor-fill); stroke: var(--cursor-line); stroke-width: 1.5; filter: drop-shadow(0 1px 2px rgb(0 0 0 / .5)) }
.ripple { position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 50%; border: 3px solid var(--primary); opacity: 0; animation: ripple .9s ease-out .75s 2 }
@keyframes ripple { 0% { transform: scale(.3); opacity: 1 } 100% { transform: scale(1.8); opacity: 0 } }
.subs { position: absolute; left: 50%; bottom: var(--space-4); transform: translateX(-50%); max-width: 88%; display: flex; flex-direction: column; align-items: center; gap: 2px; text-align: center; pointer-events: none; z-index: 3 }
.subs span { background: var(--subs-bg); color: var(--subs-ink); padding: 3px 10px; border-radius: 4px; line-height: 1.35 }
.subs-what { font-size: 15px; font-weight: 600 }
.subs-why { font-size: 13px; color: var(--subs-ink-2) }
.ctl-tog { font-size: var(--text-sm); padding: 0 var(--space-2) }
.ctl-tog[aria-pressed="false"] { opacity: .55 }
.replay-btn { margin-left: auto; flex: none }
.phase { position: absolute; top: var(--space-2); left: var(--space-2); font-size: var(--text-sm); padding: 2px 8px; border-radius: 999px; background: var(--stage-chip); color: var(--stage-ink) }
.big-play { position: absolute; right: var(--space-3); bottom: var(--space-3); width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--stage-chip); color: var(--stage-ink) }
.big-play .ui-icon { width: 20px; height: 20px }

.scrub { display: flex; gap: 2px; height: 6px }
.seg { flex: 1; min-width: 3px; padding: 0; border: 0; border-radius: 2px; background: var(--border); cursor: pointer }
.seg.gap { margin-left: 3px }
.seg.past { background: color-mix(in srgb, var(--primary) 55%, var(--border)) }
.seg.on { background: var(--primary) }
.seg.bad { background: color-mix(in srgb, var(--status-bad) 55%, var(--border)) }
.seg.bad.on { background: var(--status-bad) }

.controls { display: flex; align-items: center; gap: var(--space-2) }
.ctl { min-width: 32px; height: 32px; border: 1px solid var(--border); border-radius: var(--radius-control); background: transparent; color: var(--foreground); font-size: 18px; line-height: 1; display: grid; place-items: center; cursor: pointer }
.ctl:disabled { opacity: .4; cursor: default }
.ctl:not(:disabled):hover { background: var(--hover) }
.ctl-play { width: 40px }
.ctl-speed { font-size: var(--text-sm); margin-left: auto; padding: 0 var(--space-2) }
.pause-glyph { width: 12px; height: 14px; border-left: 4px solid currentColor; border-right: 4px solid currentColor }
.counter { color: var(--fg-3); font-size: var(--text-sm); font-variant-numeric: tabular-nums }

.caption { display: flex; flex-direction: column; gap: 4px; padding: var(--space-2) var(--space-3); border-left: 2px solid var(--primary); background: var(--hover); min-width: 0 }
.caption.bad { border-left-color: var(--status-bad) }
.caption-what { font-weight: 600 }
.caption .mark { color: var(--kw-ok-ink) }
.caption.bad .mark, .caption-err { color: var(--status-bad) }
.caption-err { font-size: var(--text-sm) }
.caption-code { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--fg-2); overflow-wrap: anywhere }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }

.strip { display: flex; gap: var(--space-2); overflow-x: auto; padding-bottom: var(--space-1) }
.thumb { position: relative; flex: none; width: 112px; aspect-ratio: 16 / 10; padding: 0; border: 2px solid transparent; border-radius: var(--radius-control); background: var(--stage-bg); overflow: hidden; cursor: pointer }
.thumb img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; opacity: .75 }
.thumb.on { border-color: var(--primary) }
.thumb.on img, .thumb:hover img { opacity: 1 }
.thumb.bad { border-color: color-mix(in srgb, var(--status-bad) 60%, transparent) }
.thumb.bad.on { border-color: var(--status-bad) }
.thumb-n { position: absolute; left: 4px; bottom: 4px; font-size: 11px; line-height: 1; padding: 2px 5px; border-radius: 3px; background: var(--stage-chip); color: var(--stage-ink) }
</style>
