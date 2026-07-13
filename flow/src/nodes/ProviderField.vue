<script setup>
import { computed } from 'vue'
import { bureau, nulls, setNull, fieldNull, BURO_DESC, openFieldInfo } from '../store'
import { FIELD_DOCS } from '../fieldDocs'
import { useFails } from '../useFails'
import MoneyInput from '../MoneyInput.vue'
import AffixField from '../AffixField.vue'

const props = defineProps({
  label: String,
  fieldKey: String,
  type: { type: String, default: 'number' }, // number | money | select
  options: { type: Array, default: () => [] }, // strings o {value,label}
  min: Number,
  max: Number,
  ruleKey: String, // para resaltar cuando hace fallar al lender seleccionado
  certeza: { type: Number, default: 0 }, // 1=fuente más confiable del dato · 2=respaldo · 3=estimación
  info: { type: Boolean, default: false }, // dato informativo: se entrega pero NO decide hoy
})
const { bad } = useFails()
const isNull = computed(() => fieldNull(props.fieldKey))
const fail = computed(() => props.ruleKey ? bad(props.ruleKey) : false)
const certLabel = computed(() => ({ 1: 'Certeza 1 — fuente principal (más confiable)', 2: 'Certeza 2 — respaldo', 3: 'Certeza 3 — estimación' }[props.certeza] || null))
const optVal = (o) => (o && typeof o === 'object') ? o.value : o
const optLabel = (o) => (o && typeof o === 'object') ? o.label : o
// Clic en el label → sidebar de detalle (dónde vive / por qué). docKey = 'buro.<fieldKey>'.
const docKey = computed(() => 'buro.' + props.fieldKey)
const hasDoc = computed(() => !!FIELD_DOCS[docKey.value])
</script>

<template>
  <div class="field pv" :class="[{ 'kv--fail': fail, 'pv--info': info }, certeza ? 'pv--c' + certeza : '']" :title="certLabel">
    <input type="checkbox" class="null-tog nodrag" :checked="!!nulls[fieldKey]" @change="e => setNull(fieldKey, e.target.checked)" :title="info ? 'dato informativo (no decide hoy)' : 'simular sin dato (null)'" />
    <span class="pv-l" :class="{ 'fld-doc': hasDoc }" :title="hasDoc ? 'clic: dónde vive y por qué' : BURO_DESC[fieldKey]" @click="hasDoc && openFieldInfo(docKey)">{{ label }}</span>
    <b v-if="isNull" class="pv-null">— null</b>
    <template v-else>
      <AffixField v-if="type === 'money'" prefix="$"><MoneyInput class="afld__in" v-model="bureau[fieldKey]" /></AffixField>
      <select v-else-if="type === 'select'" class="nodrag" v-model="bureau[fieldKey]">
        <option v-for="o in options" :key="String(optVal(o))" :value="optVal(o)">{{ optLabel(o) }}</option>
      </select>
      <input v-else class="nodrag" type="number" :min="min" :max="max" v-model.number="bureau[fieldKey]" />
    </template>
  </div>
</template>
