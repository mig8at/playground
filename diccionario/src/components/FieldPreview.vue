<script setup lang="ts">
import { computed } from 'vue'
import type { FieldEntry } from '../dictionary'

const props = defineProps<{ field: FieldEntry }>()

const sample = computed(() => props.field.defaultValue || '')
// Un checkbox de una sola opción = una casilla de consentimiento.
const isConsent = computed(
  () => props.field.type === 'checkbox' && (props.field.options?.length ?? 0) === 1,
)

// Tabla: columnas por posición (col 1..N) derivadas de las celdas, y las
// dos primeras filas de muestra. El catálogo real no trae nombres de columna.
const cols = computed(() => {
  const set = new Set((props.field.cells || []).map((c) => c.col))
  return [...set].sort((a, b) => a - b)
})
const rowVals = (row: number) => {
  const map: Record<number, string> = {}
  ;(props.field.cells || []).filter((c) => c.row === row).forEach((c) => { map[c.col] = c.value })
  return map
}
const rows = computed(() => {
  const set = new Set((props.field.cells || []).map((c) => c.row))
  return [...set].sort((a, b) => a - b)
})
</script>

<template>
  <div class="preview">
    <!-- text -->
    <template v-if="field.type === 'text'">
      <label class="fl">{{ field.label }}</label>
      <input class="ctrl" type="text" :value="sample" :placeholder="field.id" disabled />
    </template>

    <!-- checkbox de 1 opción = consentimiento -->
    <template v-else-if="isConsent">
      <label class="opt consent"><input type="checkbox" :checked="!!sample" disabled /> {{ field.label }}</label>
    </template>

    <!-- checkbox con varias opciones = selección única (radio) -->
    <template v-else-if="field.type === 'checkbox'">
      <label class="fl">{{ field.label }} <span class="mini">selección única</span></label>
      <div class="opts">
        <label v-for="o in field.options" :key="o" class="opt">
          <input type="radio" :checked="sample === o" disabled /> {{ o }}
        </label>
      </div>
    </template>

    <!-- table -->
    <template v-else-if="field.type === 'table'">
      <label class="fl">{{ field.label }}</label>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead>
            <tr><th v-for="c in cols" :key="c">col {{ c }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r"><td v-for="c in cols" :key="c">{{ rowVals(r)[c] ?? '—' }}</td></tr>
            <tr class="ghost"><td v-for="c in cols" :key="c">…</td></tr>
          </tbody>
        </table>
      </div>
      <p class="mini muted">{{ (field.cells || []).length }} celdas mapeadas · posición (x, y, w) normalizada 0–1 sobre la página</p>
    </template>
  </div>
</template>

<style scoped>
.preview { border: 1px dashed var(--border2); border-radius: 8px; padding: 14px; background: var(--bg); }
.fl { display: block; font-size: 12px; color: var(--text2); margin-bottom: 6px; }
.mini { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text3); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; margin-left: 6px; }
.muted { display: block; margin: 8px 0 0; border: none; padding: 0; }
.ctrl { width: 100%; opacity: .9; }
.ctrl:disabled { color: var(--text); -webkit-text-fill-color: var(--text); }
.opts { display: flex; flex-direction: column; gap: 7px; }
.opt { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text2); }
.opt.consent { color: var(--text); line-height: 1.4; }
.opt input { accent-color: var(--accent); }
.tbl-wrap { overflow-x: auto; }
.tbl { border-collapse: collapse; width: 100%; font-size: 12px; }
.tbl th, .tbl td { border: 1px solid var(--border); padding: 5px 8px; text-align: left; white-space: nowrap; }
.tbl th { background: var(--surface2); color: var(--text2); font-weight: 600; font-family: "SF Mono", ui-monospace, monospace; font-size: 11px; }
.tbl td { color: var(--text); }
.tbl tr.ghost td { color: var(--text3); }
</style>
