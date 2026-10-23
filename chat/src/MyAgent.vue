<script setup>
/* MI AGENTE (`#/mi-agente`) — PROTOTIPO. Tu yo que contesta por vos: a la izquierda su muñeco girando en 3D (el mismo
 * kit del creador de personajes, `office/appearance.js`); a la derecha su nombre, su forma, sus colores, el modelo que
 * va a usar, sus reglas y cómo contestaría. Cada cambio saca una foto del muñeco, que es su avatar en el chat.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BASES, PARTS, SUGGESTIONS, makeCharacter, recolor } from './office/appearance.js'
import { useMyAgentStore, MODELS, RULES } from './stores/myAgent.js'
import { useChatStore } from './stores/chat.js'

const mine = useMyAgentStore()
const chat = useChatStore()
const a = computed(() => mine.agent)

// Cómo contestaría: con un mensaje de ejemplo y tus tareas de cuadrilla de verdad.
const sample = { from: 'Duncan', text: '¿Podés revisar mi PR hoy?' }
const preview = computed(() => mine.draftReply({ from: sample.from, text: sample.text, tasks: chat.myTasks, owner: chat.ownerName() }))

// ── el muñeco en 3D, y su foto para el avatar ──
const stage = ref(null)
let renderer, scene, camera, controls, observer, frame = 0, current = null, loading = 0, shotTimer = 0

function setupStage() {
  scene = new THREE.Scene()
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  stage.value.appendChild(renderer.domElement)
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(3.6, 2.8, 6.4)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.2, 0)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 4
  controls.maxDistance = 12
  controls.maxPolarAngle = 1.45
  scene.add(new THREE.HemisphereLight('#ffffff', '#cbbfae', 1.8))
  const sun = new THREE.DirectionalLight('#fff4e6', 2.2)
  sun.position.set(4, 8, 5)
  scene.add(sun)
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = stage.value
    if (!w || !h) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  }
  observer = new ResizeObserver(resize)
  observer.observe(stage.value)
  resize()
  let last = performance.now()
  const loop = (now) => {
    frame = requestAnimationFrame(loop)
    current?.mixer.update(Math.min(0.05, (now - last) / 1000))
    last = now
    controls.update()
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(loop)
}

// La foto: un recorte cuadrado de la cara y el torso, chico, para el avatar del chat.
function snapshot() {
  clearTimeout(shotTimer)
  shotTimer = setTimeout(() => {
    if (!renderer) return
    const src = renderer.domElement
    const side = Math.min(src.width, src.height) * 0.55
    const out = document.createElement('canvas')
    out.width = out.height = 96
    out.getContext('2d').drawImage(src, (src.width - side) / 2, src.height * 0.08, side, side, 0, 0, 96, 96)
    mine.agent.avatar = out.toDataURL('image/png')
  }, 700)
}

async function showAgent() {
  const c = a.value
  if (current && current.base === c.base) { recolor(current.model, c.base, c.colors); snapshot(); return }
  const ticket = ++loading
  const { model, animations } = await makeCharacter(c.base, c.colors)
  if (ticket !== loading || !scene) return
  if (current) scene.remove(current.model)
  const mixer = new THREE.AnimationMixer(model)
  const idle = animations.find((x) => x.name === 'Idle')
  if (idle) mixer.clipAction(idle).play()
  scene.add(model)
  current = { model, mixer, base: c.base }
  snapshot()
}

watch(() => a.value.base, showAgent)
watch(() => ({ ...a.value.colors }), showAgent, { deep: true })
onMounted(() => { setupStage(); showAgent() })
onBeforeUnmount(() => {
  clearTimeout(shotTimer)
  cancelAnimationFrame(frame)
  observer?.disconnect()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = null
})
</script>

<template>
  <div class="my-agent">
    <div class="stage-wrap">
      <div ref="stage" class="stage" aria-label="Tu agente en 3D: arrastrá para girarlo"></div>
      <span class="badge-proto">prototipo</span>
    </div>

    <section class="panel" aria-label="Tu agente">
      <header class="who">
        <img v-if="a.avatar" class="avatar-img" :src="a.avatar" alt="">
        <span>
          <b>{{ a.name || 'Mi agente' }}</b>
          <small>{{ a.mode === 'agente' ? 'contesta por vos ahora' : 'apagado: contestás vos' }}</small>
        </span>
        <span class="mode" role="group" aria-label="Quién contesta">
          <button type="button" :class="{ on: a.mode === 'yo' }" @click="mine.setMode('yo')">Contesto yo</button>
          <button type="button" :class="{ on: a.mode === 'agente' }" @click="mine.setMode('agente')">Contesta mi agente</button>
        </span>
      </header>

      <label class="field" for="agent-name">
        <span>Nombre</span>
        <input id="agent-name" v-model="mine.agent.name" class="input" maxlength="24" autocomplete="off" placeholder="Mini Miguel">
      </label>

      <div class="field">
        <span>Forma</span>
        <div class="bases" role="radiogroup" aria-label="Forma">
          <button v-for="(b, key) in BASES" :key="key" type="button" role="radio" :aria-checked="a.base === key"
                  class="base" :class="{ on: a.base === key }" @click="mine.setBase(key)">{{ b.label }}</button>
        </div>
      </div>

      <div v-for="part in PARTS" :key="part.id" class="field">
        <span class="part-head">
          {{ part.label }}
          <label class="custom" :for="`agent-color-${part.id}`">
            <input :id="`agent-color-${part.id}`" v-model="mine.agent.colors[part.id]" type="color">
          </label>
        </span>
        <div class="swatches">
          <button v-for="color in SUGGESTIONS[part.id]" :key="color" type="button" class="swatch"
                  :class="{ on: a.colors[part.id] === color }" :style="{ background: color }"
                  :aria-label="`${part.label} ${color}`" :title="color" @click="mine.agent.colors[part.id] = color"></button>
        </div>
      </div>

      <div class="field">
        <span>Modelo</span>
        <div class="models" role="radiogroup" aria-label="Modelo">
          <button v-for="m in MODELS" :key="m.id" type="button" role="radio" :aria-checked="a.model === m.id"
                  class="model" :class="{ on: a.model === m.id }" @click="mine.agent.model = m.id">
            <b>{{ m.name }}</b><small>{{ m.note }}</small>
          </button>
        </div>
        <p class="hint">Por ahora contesta con una plantilla; el modelo se conecta en el paso siguiente.</p>
      </div>

      <div class="field">
        <span>Reglas</span>
        <ul class="rules"><li v-for="r in RULES" :key="r">{{ r }}</li></ul>
      </div>

      <div class="field">
        <span>Así contestaría</span>
        <div class="sample">
          <p class="sample-in"><b>{{ sample.from }}:</b> {{ sample.text }}</p>
          <div class="sample-out">
            <img v-if="a.avatar" class="avatar-img small" :src="a.avatar" alt="">
            <p>{{ preview }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.my-agent { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 380px; background: var(--background) }
@media (max-width: 900px) { .my-agent { grid-template-columns: 1fr; grid-template-rows: 320px auto; overflow: auto } }
.stage-wrap { position: relative; min-height: 320px }
.stage { position: absolute; inset: 0; background: radial-gradient(90% 80% at 50% 40%, var(--office-glow), var(--office-bg)) }
.badge-proto { position: absolute; top: var(--space-3); left: var(--space-3); padding: 2px 8px; border-radius: 999px; font-size: var(--text-xs);
  background: var(--office-chip); color: var(--office-chip-ink) }
.panel { border-left: 1px solid var(--border); overflow: auto; padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4) }
.who { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap }
.who .mode { flex-basis: 100% ; justify-content: center }
.who > span:first-of-type { display: flex; flex-direction: column; min-width: 0; flex: 1 }
.who b { font-size: 15px }
.who small { color: var(--fg-2); font-size: var(--text-xs) }
.avatar-img { width: 44px; height: 44px; border-radius: 12px; background: var(--office-bg); object-fit: cover; flex: none }
.avatar-img.small { width: 28px; height: 28px; border-radius: 8px }
.mode { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 2px; gap: 2px }
.mode button { border: 0; background: transparent; color: var(--fg-2); font: inherit; font-size: var(--text-xs); padding: 4px 10px; border-radius: 999px; cursor: pointer }
.mode button.on { background: var(--office-accent); color: var(--office-accent-ink) }
.field { display: flex; flex-direction: column; gap: 6px }
.field > span, .part-head { font-size: var(--text-sm); font-weight: 600; color: var(--fg-2) }
.part-head { display: flex; align-items: center; justify-content: space-between }
.custom input { width: 26px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: transparent; cursor: pointer }
.bases { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px }
.base { padding: 7px 8px; border-radius: var(--radius-control); border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: var(--text-sm) }
.base.on, .model.on { border-color: var(--office-accent); box-shadow: inset 0 0 0 1px var(--office-accent) }
.swatches { display: flex; flex-wrap: wrap; gap: 6px }
.swatch { width: 22px; height: 22px; border-radius: 6px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px var(--border) }
.swatch.on { box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--office-accent) }
.models { display: flex; flex-direction: column; gap: 6px }
.model { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: var(--radius-control); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer }
.model b { font-size: var(--text-sm) }
.model small { color: var(--fg-2); font-size: var(--text-xs) }
.hint { margin: 0; color: var(--fg-2); font-size: var(--text-xs) }
.rules { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: var(--text-sm) }
.sample { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: var(--radius-control); background: var(--muted) }
.sample-in { margin: 0; font-size: var(--text-sm) }
.sample-out { display: flex; gap: 8px; align-items: flex-start }
.sample-out p { margin: 0; padding: 8px 10px; border-radius: 10px; background: var(--bubble-mine); font-size: var(--text-sm); line-height: 1.45 }
</style>
