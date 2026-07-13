<script setup lang="ts">
// Slider de doble pomo (rango min–max) sin dependencias: dos <input range> superpuestos.
import { computed } from 'vue'
const props = defineProps<{ min: number; max: number; lo: number; hi: number; step?: number; unit?: string; money?: boolean }>()
const emit = defineEmits<{ 'update:min': [number]; 'update:max': [number] }>()
const pct = (v: number) => ((v - props.lo) / (props.hi - props.lo)) * 100
const fmt = (v: number) => (props.money ? '$' + v.toLocaleString('es') : v + (props.unit ? ' ' + props.unit : ''))
const minOnTop = computed(() => props.min > props.hi - (props.hi - props.lo) / 8) // evita que el pomo min quede atrapado al tope
function onMin(e: Event) { let v = Number((e.target as HTMLInputElement).value); if (v > props.max) v = props.max; emit('update:min', v) }
function onMax(e: Event) { let v = Number((e.target as HTMLInputElement).value); if (v < props.min) v = props.min; emit('update:max', v) }
</script>

<template>
  <div class="rs">
    <div class="rs-vals"><b>{{ fmt(min) }}</b><span class="rs-dash">–</span><b>{{ fmt(max) }}</b></div>
    <div class="rs-track">
      <div class="rs-base"></div>
      <div class="rs-fill" :style="{ left: pct(min) + '%', right: 100 - pct(max) + '%' }"></div>
      <input type="range" class="rs-in" :class="{ top: minOnTop }" :min="lo" :max="hi" :step="step || 1" :value="min" @input="onMin" />
      <input type="range" class="rs-in" :min="lo" :max="hi" :step="step || 1" :value="max" @input="onMax" />
    </div>
  </div>
</template>

<style scoped>
.rs { width: 100%; }
.rs-vals { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #0f172a; margin-bottom: 1px; }
.rs-vals b { font-weight: 700; } .rs-dash { color: #94a3b8; }
.rs-track { position: relative; height: 22px; }
.rs-base { position: absolute; top: 9px; left: 0; right: 0; height: 4px; background: #e2e8f0; border-radius: 2px; }
.rs-fill { position: absolute; top: 9px; height: 4px; background: #2563eb; border-radius: 2px; }
.rs-in { position: absolute; top: 0; left: 0; width: 100%; height: 22px; margin: 0; -webkit-appearance: none; appearance: none; background: transparent; pointer-events: none; }
.rs-in.top { z-index: 3; }
.rs-in::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #2563eb; cursor: pointer; pointer-events: auto; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.rs-in::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #2563eb; cursor: pointer; pointer-events: auto; }
.rs-in::-webkit-slider-runnable-track { background: transparent; height: 22px; }
.rs-in::-moz-range-track { background: transparent; height: 22px; }
</style>
