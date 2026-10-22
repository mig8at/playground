<script setup>
/* LA OFICINA — la vista 3D dentro de chat (`#/oficina`).
 *
 * Monta la escena de `scene.js` en el editor y le pone encima una barra para saltar a cada zona y prender o
 * apagar el giro solo. Arrastrar rota, la rueda acerca, clic derecho (o dos dedos) desplaza. Los carteles de
 * cada zona también llevan la cámara.
 *
 * Al salir de la vista se libera todo (WebGL, texturas, observador de tamaño): volver la crea de nuevo.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createOffice, ZONES } from './scene.js'

const host = ref(null)
const active = ref('overview')
const spinning = ref(true)
const failed = ref('')
let office = null

function go(id) { office?.focus(id) }
function toggleSpin() {
  spinning.value = !spinning.value
  office?.setAutoRotate(spinning.value)
}

onMounted(() => {
  try {
    office = createOffice(host.value, { onFocus: (id) => { active.value = id } })
    // Con movimiento reducido, quieta desde el principio.
    spinning.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    office.setAutoRotate(spinning.value)
  } catch (e) {
    failed.value = `No pude abrir la vista 3D: ${e.message}`
  }
})
onBeforeUnmount(() => office?.dispose())
</script>

<template>
  <div class="office">
    <div ref="host" class="office-stage" aria-label="Oficina en 3D: arrastrá para rotar, la rueda acerca"></div>
    <p v-if="failed" class="office-failed">{{ failed }}</p>
    <div class="office-bar" role="toolbar" aria-label="Zonas de la oficina">
      <button v-for="z in ZONES" :key="z.id" type="button" class="office-chip" :class="{ on: active === z.id }" @click="go(z.id)">
        {{ z.label }}
      </button>
      <button type="button" class="office-chip spin" :aria-pressed="spinning" @click="toggleSpin">
        {{ spinning ? 'Detener giro' : 'Girar sola' }}
      </button>
    </div>
    <p class="office-hint">Pasá el mouse por una zona para ver qué es · clic para acercarte · arrastrá para rotar · rueda para acercar</p>
  </div>
</template>

<style scoped>
.office { position: relative; flex: 1; min-height: 0; overflow: hidden;
  background: radial-gradient(120% 90% at 50% 35%, var(--office-glow), var(--office-bg)) }
.office-stage { position: absolute; inset: 0 }
.office-bar { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; flex-wrap: wrap; gap: 6px; pointer-events: none }
.office-chip { pointer-events: auto; font: inherit; font-size: var(--text-sm); padding: 6px 11px; border-radius: 999px; cursor: pointer;
  border: 0; background: var(--office-chip); color: var(--office-chip-ink); backdrop-filter: blur(6px) }
.office-chip:hover { background: var(--office-chip-hover) }
.office-chip.on { background: var(--office-accent); color: var(--office-accent-ink) }
.office-chip:focus-visible { outline: 2px solid var(--office-accent); outline-offset: 2px }
.office-chip.spin { margin-left: auto }
.office-hint { position: absolute; bottom: 10px; left: 0; right: 0; margin: 0; text-align: center; pointer-events: none;
  font-size: var(--text-xs); color: var(--office-hint) }
.office-failed { position: absolute; inset: auto 16px 40px; margin: 0; padding: 10px 14px; border-radius: 8px;
  background: var(--office-chip); color: var(--office-chip-ink) }
</style>

<style>
/* Las tarjetas las crea Three (CSS2DRenderer) fuera de Vue: van sin `scoped`. Sólo se ve la de la zona bajo el
   mouse, y no atrapa el puntero: el mouse sigue sobre la escena. */
.office-labels { position: absolute; inset: 0; pointer-events: none }
.office-label { pointer-events: none; display: grid; gap: 2px; max-width: 220px; text-align: left;
  padding: 9px 12px; border-radius: 10px; border-left: 3px solid var(--office-accent);
  background: var(--office-chip); color: var(--office-chip-ink); box-shadow: 0 8px 22px var(--office-shadow); backdrop-filter: blur(6px);
  transform: translateY(calc(-50% - 36px)); width: max-content }
.office-label b { font-size: 14px; font-weight: 700 }
.office-label span { font-size: 12px; line-height: 1.4 }
.office-label small { font-size: 11px; opacity: .7 }
</style>
