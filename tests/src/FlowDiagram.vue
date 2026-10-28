<script setup>
// Un diagrama de secuencia en SVG: una columna por actor y una fila por paso. Los colores salen del tema, así que se
// ve igual en claro y en oscuro.
import { computed } from 'vue'

const props = defineProps({ flow: { type: Object, required: true } })

const COL = 190 // ancho de cada columna
const HEAD = 64 // alto de la cabecera de actores
const ROW = 46 // alto de un mensaje con subtítulo
const ROW_SHORT = 34 // alto de un mensaje sin subtítulo
const PHASE = 38 // alto del título de un tramo
const PAD = 16

const xOf = computed(() => Object.fromEntries(props.flow.actors.map((a, i) => [a.id, PAD + COL * i + COL / 2])))
const width = computed(() => PAD * 2 + COL * props.flow.actors.length)

// Cada paso con su posición vertical ya calculada.
const rows = computed(() => {
  let y = HEAD + 12
  let n = 0
  return props.flow.steps.map((s) => {
    const h = s.phase ? PHASE : s.sub ? ROW : ROW_SHORT
    const row = { ...s, y, h, n: s.phase ? null : ++n }
    y += h
    return row
  })
})
const height = computed(() => {
  const last = rows.value[rows.value.length - 1]
  return (last ? last.y + last.h : HEAD) + PAD
})
</script>

<template>
  <figure class="flow">
    <svg :viewBox="`0 0 ${width} ${height}`" :style="{ maxWidth: `${width}px` }" role="img" :aria-label="flow.title">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" class="arrow-head" />
        </marker>
      </defs>
      <!-- las líneas de vida -->
      <line v-for="a in flow.actors" :key="`l-${a.id}`" class="lifeline" :x1="xOf[a.id]" :x2="xOf[a.id]" :y1="HEAD" :y2="height - PAD" />
      <!-- los actores -->
      <g v-for="a in flow.actors" :key="a.id">
        <rect class="actor" :x="xOf[a.id] - COL / 2 + 10" y="8" :width="COL - 20" :height="HEAD - 16" rx="8" />
        <text class="actor-name" :x="xOf[a.id]" :y="a.sub ? 30 : 37" text-anchor="middle">{{ a.label }}</text>
        <text v-if="a.sub" class="actor-sub" :x="xOf[a.id]" y="46" text-anchor="middle">{{ a.sub }}</text>
      </g>
      <g v-for="(s, i) in rows" :key="i">
        <!-- el título de un tramo -->
        <template v-if="s.phase">
          <rect class="phase-band" :x="PAD / 2" :y="s.y + 8" :width="width - PAD" :height="PHASE - 12" rx="6" />
          <text class="phase" :x="PAD" :y="s.y + 26">{{ s.phase }}</text>
        </template>
        <!-- una nota sobre un actor -->
        <template v-else-if="s.note">
          <rect class="note" :x="xOf[s.note] - COL / 2 - 30" :y="s.y + 4" :width="COL + 60" :height="s.h - 8" rx="6" />
          <text class="msg" :x="xOf[s.note]" :y="s.y + (s.sub ? 20 : 22)" text-anchor="middle">{{ s.n }} · {{ s.text }}</text>
          <text v-if="s.sub" class="msg-sub" :x="xOf[s.note]" :y="s.y + 35" text-anchor="middle">{{ s.sub }}</text>
        </template>
        <!-- un mensaje entre dos actores -->
        <template v-else>
          <line class="msg-line" :class="{ back: s.back }" :x1="xOf[s.from]" :x2="xOf[s.to] + (xOf[s.to] > xOf[s.from] ? -3 : 3)"
            :y1="s.y + (s.sub ? 26 : 22)" :y2="s.y + (s.sub ? 26 : 22)" marker-end="url(#flow-arrow)" />
          <text class="msg" :x="(xOf[s.from] + xOf[s.to]) / 2" :y="s.y + (s.sub ? 20 : 16)" text-anchor="middle">{{ s.n }} · {{ s.text }}</text>
          <text v-if="s.sub" class="msg-sub" :x="(xOf[s.from] + xOf[s.to]) / 2" :y="s.y + 40" text-anchor="middle">{{ s.sub }}</text>
        </template>
      </g>
    </svg>
  </figure>
</template>

<style scoped>
.flow { margin: 0; padding: var(--space-3) var(--gutter); max-width: 100%; overflow-x: auto }
/* Se achica hasta el ancho del editor; por debajo de 720px se desplaza en vez de volverse ilegible. */
.flow svg { display: block; width: 100%; min-width: 720px; height: auto; font-family: inherit }
.lifeline { stroke: var(--border); stroke-dasharray: 4 4 }
.actor { fill: var(--muted); stroke: var(--border) }
.actor-name { fill: var(--foreground); font-size: 13px; font-weight: 600 }
.actor-sub, .msg-sub { fill: var(--muted-foreground); font-size: 10.5px }
.phase-band { fill: color-mix(in oklab, var(--primary) 8%, transparent) }
.phase { fill: var(--foreground); font-size: 12px; font-weight: 600 }
.note { fill: color-mix(in oklab, var(--primary) 14%, var(--background)); stroke: var(--primary) }
.msg { fill: var(--foreground); font-size: 12px }
/* Un halo del color del fondo: las líneas de vida no cortan el texto que las cruza. */
.msg, .msg-sub { paint-order: stroke; stroke: var(--background); stroke-width: 4px; stroke-linejoin: round }
.msg-line { stroke: var(--foreground); stroke-width: 1.25 }
.msg-line.back { stroke: var(--muted-foreground); stroke-dasharray: 5 3 }
.arrow-head { fill: var(--foreground) }
</style>
