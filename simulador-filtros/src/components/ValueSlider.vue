<script setup lang="ts">
// Slider de un pomo para umbrales ≥/≤ (score, ingreso, DTI). Resalta la región aceptada.
const props = defineProps<{ modelValue: number; lo: number; hi: number; step?: number; unit?: string; money?: boolean; mode?: '≥' | '≤' }>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()
const pct = (v: number) => ((v - props.lo) / (props.hi - props.lo)) * 100
const fmt = (v: number) => (props.money ? '$' + v.toLocaleString('es') : v + (props.unit ? ' ' + props.unit : ''))
const fillStyle = () => (props.mode === '≤'
  ? { left: '0%', right: 100 - pct(props.modelValue) + '%' }  // acepta por debajo
  : { left: pct(props.modelValue) + '%', right: '0%' })       // ≥: acepta por encima
</script>

<template>
  <div class="rs">
    <div class="rs-vals"><span class="rs-op">{{ mode }}</span><b>{{ fmt(modelValue) }}</b></div>
    <div class="rs-track">
      <div class="rs-base"></div>
      <div class="rs-fill" :style="fillStyle()"></div>
      <input type="range" class="rs-in" :min="lo" :max="hi" :step="step || 1" :value="modelValue" @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" />
    </div>
  </div>
</template>

<style scoped>
.rs { width: 100%; }
.rs-vals { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #0f172a; margin-bottom: 1px; }
.rs-op { font-weight: 700; color: #64748b; } .rs-vals b { font-weight: 700; }
.rs-track { position: relative; height: 22px; }
.rs-base { position: absolute; top: 9px; left: 0; right: 0; height: 4px; background: #e2e8f0; border-radius: 2px; }
.rs-fill { position: absolute; top: 9px; height: 4px; background: #10b981; border-radius: 2px; }
.rs-in { position: absolute; top: 0; left: 0; width: 100%; height: 22px; margin: 0; -webkit-appearance: none; appearance: none; background: transparent; }
.rs-in::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #10b981; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.rs-in::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #fff; border: 2px solid #10b981; cursor: pointer; }
.rs-in::-webkit-slider-runnable-track { background: transparent; height: 22px; }
.rs-in::-moz-range-track { background: transparent; height: 22px; }
</style>
