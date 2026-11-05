<script setup>
/* UNA TABLA CLAVE-VALOR DEL POSTMAN (parámetros y encabezados, ServicePanel.vue). Las claves que declara el esquema
   vienen puestas, en gris, y sólo se escribe el valor (con el ejemplo de pista y la descripción al pasar el mouse);
   debajo, filas libres para cualquier otra, con una vacía siempre al final.
   `rows` es el estado, `{ values: {clave: valor}, extras: [{key, value}] }`, y la tabla lo cambia en el lugar. Con
   `fold`, las claves declaradas se guardan en minúsculas (los encabezados no distinguen). */
import { watch } from 'vue'

const props = defineProps({
  declared: { type: Array, default: () => [] },
  rows: { type: Object, required: true },
  fold: Boolean,
  noun: { type: String, default: 'clave' }, // para «Agregar …» y «Quitar este …»
})
const keyOf = (name) => (props.fold ? name.toLowerCase() : name)

watch(() => props.rows.extras, (extras) => {
  const last = extras[extras.length - 1]
  if (!last || last.key || last.value) extras.push({ key: '', value: '' })
}, { deep: true, immediate: true })
</script>

<template>
  <table class="kv-table">
    <thead><tr><th>Clave</th><th>Valor</th><th class="act" aria-label="Quitar"></th></tr></thead>
    <tbody>
      <tr v-for="d in declared" :key="d.name" class="declared">
        <td class="key" :title="d.description || null">
          <code :class="{ described: d.description }">{{ d.name }}</code><span v-if="d.required" class="req" title="Obligatorio">*</span>
          <span v-if="d.description" class="visually-hidden">{{ d.description }}</span>
        </td>
        <td class="cell"><input v-model="rows.values[keyOf(d.name)]" class="cell-input" :placeholder="d.example" spellcheck="false" :aria-label="`Valor de ${d.name}`" /></td>
        <td class="act"></td>
      </tr>
      <tr v-for="(row, i) in rows.extras" :key="`x${i}`">
        <td class="cell"><input v-model="row.key" class="cell-input" :placeholder="`Agregar ${noun}`" spellcheck="false" aria-label="Clave" /></td>
        <td class="cell"><input v-model="row.value" class="cell-input" placeholder="valor" spellcheck="false" aria-label="Valor" /></td>
        <td class="act">
          <button v-if="row.key || row.value" type="button" class="region-action" title="Quitar" :aria-label="`Quitar este ${noun}`" @click="rows.extras.splice(i, 1)">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.kv-table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border);
  border-radius: var(--radius-md); overflow: hidden; font-size: var(--text-sm) }
.kv-table th, .kv-table td { border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle }
.kv-table th + th, .kv-table td + td { border-left: 1px solid var(--border) }
.kv-table tbody tr:last-child td { border-bottom: 0 }
.kv-table th { height: 28px; padding: 0 var(--space-3); background: var(--muted); color: var(--fg-2); font-size: var(--text-xs); font-weight: 600 }
.kv-table th:first-child, .kv-table td:first-child { width: 38% }
.kv-table .act { width: 32px; padding: 0; text-align: center; border-left: 0 }
/* La clave que dicta el esquema no se edita: va en gris, y su descripción al pasar el mouse (el subrayado punteado lo
   avisa), así todas las filas tienen el alto de su campo. */
.kv-table .key { height: 36px; padding: 0 var(--space-3); background: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.kv-table .key code { font-family: var(--font-mono); color: var(--foreground) }
.kv-table .key code.described { text-decoration: underline dotted var(--fg-3); text-underline-offset: 3px; cursor: help }
.kv-table .req { margin-left: 2px; color: var(--send-fail) }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap }
/* Las celdas que se escriben: el campo ocupa la celda entera y el foco la marca por dentro. */
.kv-table .cell { padding: 0 }
.kv-table .cell:focus-within { box-shadow: inset 0 0 0 1px var(--ring) }
.cell-input { display: block; width: 100%; height: 36px; padding: 0 var(--space-3); border: 0; outline: none; background: transparent;
  color: var(--foreground); font-family: var(--font-mono); font-size: var(--text-sm) }
.cell-input::placeholder { color: var(--fg-3) }
</style>
