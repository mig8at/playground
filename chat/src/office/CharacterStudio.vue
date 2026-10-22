<script setup>
/* EL CREADOR DE PERSONAJES (`#/personajes`).
 *
 * A la izquierda, los personajes guardados (los primeros ocho van a la oficina); en el medio, el elegido girando
 * en 3D; a la derecha, su nombre, su forma y sus cinco colores — pelo, piel, ojos, camisa y pantalón — con
 * sugerencias y un selector libre. Todo se guarda solo en el navegador (stores/characters.js).
 *
 * La vista previa usa lo mismo que la oficina (appearance.js): cambiar un color repinta la paleta del modelo
 * sin volver a cargarlo; cambiar de forma sí lo cambia.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BASES, PARTS, SUGGESTIONS, makeCharacter, recolor } from './appearance.js'
import { useCharactersStore, MAX_IN_OFFICE } from '../stores/characters.js'

const store = useCharactersStore()
const selectedId = ref(store.characters[0]?.id || '')
const selected = computed(() => store.characters.find((c) => c.id === selectedId.value) || null)
const confirmDelete = ref(false)
watch(selectedId, () => { confirmDelete.value = false })

function create() {
  const c = store.add(selected.value?.base || 'Character_Male_1')
  selectedId.value = c.id
}
function remove() {
  if (!selected.value) return
  if (!confirmDelete.value) { confirmDelete.value = true; return }
  const index = store.characters.findIndex((c) => c.id === selectedId.value)
  store.remove(selectedId.value)
  selectedId.value = store.characters[Math.max(0, index - 1)]?.id || ''
  confirmDelete.value = false
}

// ── la vista previa 3D ──
const stage = ref(null)
let renderer, scene, camera, controls, observer, frame = 0
let current = null // { model, mixer, base }
let loading = 0

function setupStage() {
  scene = new THREE.Scene()
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  stage.value.appendChild(renderer.domElement)
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  camera.position.set(4.5, 3.2, 7.5)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1.25, 0)
  controls.enableDamping = true
  controls.enablePan = false
  controls.minDistance = 4
  controls.maxDistance = 14
  controls.maxPolarAngle = 1.45
  controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  controls.autoRotateSpeed = 1.2
  controls.addEventListener('start', () => { controls.autoRotate = false })
  scene.add(new THREE.HemisphereLight('#ffffff', '#cbbfae', 1.7))
  const sun = new THREE.DirectionalLight('#fff4e6', 2.2)
  sun.position.set(4, 8, 5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), new THREE.MeshStandardMaterial({ color: '#e8e2d8', roughness: 0.95 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
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
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    current?.mixer.update(dt)
    controls.update()
    renderer.render(scene, camera)
  }
  frame = requestAnimationFrame(loop)
}

async function showCharacter(c) {
  if (!c) { if (current) { scene.remove(current.model); current = null } return }
  if (current && current.base === c.base) { recolor(current.model, c.base, c.colors); return }
  const ticket = ++loading
  const { model, animations } = await makeCharacter(c.base, c.colors)
  if (ticket !== loading || !scene) return
  if (current) scene.remove(current.model)
  const mixer = new THREE.AnimationMixer(model)
  const idle = animations.find((a) => a.name === 'Idle')
  const wave = animations.find((a) => a.name === 'Wave')
  if (wave) {
    // Saluda al aparecer y queda en reposo.
    const action = mixer.clipAction(wave)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.play()
    mixer.addEventListener('finished', () => { action.fadeOut(0.3); if (idle) mixer.clipAction(idle).reset().fadeIn(0.3).play() })
  } else if (idle) mixer.clipAction(idle).play()
  scene.add(model)
  current = { model, mixer, base: c.base }
}

watch(() => selected.value && [selected.value.base, selected.value.id], () => showCharacter(selected.value))
watch(() => selected.value && { ...selected.value.colors }, () => {
  if (current && selected.value && current.base === selected.value.base) recolor(current.model, selected.value.base, selected.value.colors)
}, { deep: true })

onMounted(() => { setupStage(); showCharacter(selected.value) })
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  controls?.dispose()
  renderer?.dispose()
  renderer?.domElement.remove()
  scene = null
})

const swatchStyle = (color) => ({ background: color })
</script>

<template>
  <div class="studio">
    <aside class="studio-list" aria-label="Personajes">
      <ul>
        <li v-for="(c, i) in store.characters" :key="c.id">
          <button type="button" class="person" :class="{ on: c.id === selectedId }" @click="selectedId = c.id">
            <span class="dots" aria-hidden="true">
              <i :style="swatchStyle(c.colors.hair)"></i><i :style="swatchStyle(c.colors.skin)"></i><i :style="swatchStyle(c.colors.shirt)"></i>
            </span>
            <span class="person-main">
              <b>{{ c.name || 'Sin nombre' }}</b>
              <small>{{ BASES[c.base].label }}<template v-if="i >= MAX_IN_OFFICE"> · no entra en la oficina</template></small>
            </span>
          </button>
        </li>
      </ul>
      <button type="button" class="btn btn-sm new" @click="create">Nuevo personaje</button>
      <p class="note">Los primeros {{ MAX_IN_OFFICE }} trabajan en la oficina. Se guardan en este navegador.</p>
    </aside>

    <div ref="stage" class="studio-stage" aria-label="Vista previa del personaje: arrastrá para girarlo"></div>

    <section v-if="selected" class="studio-panel" aria-label="Cómo se ve">
      <label class="field" for="character-name">
        <span>Nombre</span>
        <input id="character-name" v-model="selected.name" class="input" maxlength="24" autocomplete="off">
      </label>

      <div class="field">
        <span>Forma</span>
        <div class="bases" role="radiogroup" aria-label="Forma">
          <button v-for="(b, key) in BASES" :key="key" type="button" role="radio" :aria-checked="selected.base === key"
                  class="base" :class="{ on: selected.base === key }" @click="store.setBase(selected.id, key)">{{ b.label }}</button>
        </div>
      </div>

      <div v-for="part in PARTS" :key="part.id" class="field">
        <span class="part-head">
          {{ part.label }}
          <label class="custom" :for="`color-${part.id}`">
            <input :id="`color-${part.id}`" v-model="selected.colors[part.id]" type="color">
            <code>{{ selected.colors[part.id] }}</code>
          </label>
        </span>
        <div class="swatches">
          <button v-for="color in SUGGESTIONS[part.id]" :key="color" type="button" class="swatch"
                  :class="{ on: selected.colors[part.id] === color }" :style="swatchStyle(color)"
                  :aria-label="`${part.label} ${color}`" :title="color" @click="selected.colors[part.id] = color"></button>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="store.resetColors(selected.id)">Colores originales</button>
        <button type="button" class="btn btn-ghost btn-sm danger" :disabled="store.characters.length <= 1" @click="remove">
          {{ confirmDelete ? '¿Seguro? Tocá de nuevo' : 'Borrar personaje' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.studio { flex: 1; min-height: 0; display: grid; grid-template-columns: 220px minmax(0, 1fr) 300px; background: var(--background) }
@media (max-width: 980px) { .studio { grid-template-columns: 200px minmax(0, 1fr); } .studio-panel { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border) } }
.studio-list { border-right: 1px solid var(--border); overflow: auto; padding: var(--space-2) 0; display: flex; flex-direction: column; gap: var(--space-2) }
.studio-list ul { list-style: none; margin: 0; padding: 0 }
.person { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px var(--gutter); border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit }
.person:hover { background: var(--hover) }
.person.on { background: var(--accent); color: var(--accent-foreground) }
.person:focus-visible { outline: 2px solid var(--ring); outline-offset: -2px }
.dots { display: grid; grid-template-columns: repeat(3, 10px); gap: 3px; flex: none }
.dots i { width: 10px; height: 10px; border-radius: 3px; box-shadow: inset 0 0 0 1px var(--border) }
.person-main { display: flex; flex-direction: column; min-width: 0 }
.person-main b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.person-main small { color: var(--fg-2); font-size: var(--text-xs) }
.new { margin: 0 var(--gutter) }
.note { margin: 0; padding: 0 var(--gutter); color: var(--fg-2); font-size: var(--text-xs); line-height: 1.5 }
.studio-stage { position: relative; min-height: 320px; background: radial-gradient(90% 80% at 50% 40%, var(--office-glow), var(--office-bg)) }
.studio-panel { border-left: 1px solid var(--border); overflow: auto; padding: var(--space-3) var(--space-4); display: flex; flex-direction: column; gap: var(--space-4) }
.field { display: flex; flex-direction: column; gap: 6px }
.field > span, .part-head { font-size: var(--text-sm); font-weight: 600; color: var(--fg-2) }
.part-head { display: flex; align-items: center; justify-content: space-between }
.custom { display: inline-flex; align-items: center; gap: 6px; font-weight: 400; cursor: pointer }
.custom input { width: 26px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: 5px; background: transparent; cursor: pointer }
.custom code { font-family: var(--font-mono); font-size: var(--text-xs) }
.bases { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px }
.base { padding: 7px 8px; border-radius: var(--radius-control); border: 1px solid var(--border); background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: var(--text-sm) }
.base.on { background: var(--office-accent); border-color: var(--office-accent); color: var(--office-accent-ink) }
.base:focus-visible, .swatch:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px }
.swatches { display: flex; flex-wrap: wrap; gap: 6px }
.swatch { width: 24px; height: 24px; border-radius: 6px; border: 0; cursor: pointer; box-shadow: inset 0 0 0 1px var(--border) }
.swatch.on { box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--office-accent) }
.actions { display: flex; justify-content: space-between; gap: var(--space-2); margin-top: auto }
.danger { color: var(--send-fail) }
</style>
