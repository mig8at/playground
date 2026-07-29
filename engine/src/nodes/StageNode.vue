<script setup>
import { computed, ref, nextTick } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import { fmtNum } from '../engine.js'
import { RATE_BASE_LABEL, describir } from '../sheets.js'
import { inputs, fields, addField, removeField, basesDisponibles } from '../store.js'

// Una etapa AUTOCONTENIDA: sus propios inputs arriba, sus propias fórmulas abajo.
//
// El motor no sabe qué es una fianza: los dos puntos de inserción arrancan con los campos por
// defecto y todo lo demás se agrega acá. Cada campo dice qué hace, así que no hay un bloque con
// comportamiento cableado que haya que aprender aparte.
//
// La última fórmula va resaltada y se muestra SIEMPRE: es la salida de la etapa. `showRows: false`
// esconde los pasos intermedios, nunca el resultado.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el input
// perdería el foco a cada tecla.
const props = defineProps({ data: Object })

const val = r => {
  if (!r || r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate|Rate/.test(r.name) ? 6 : undefined)
}
const signo = f => (f.sign === -1 ? '−' : f.appliesTo === 'charges' ? '+' : '')
// Si la etapa tiene RateBlock, el bloque es dueño de `statedRate` y `compound`: sacarlos de la
// lista o se dibujan dos veces.
const DEL_BLOQUE = new Set(['statedRate', 'compound'])
const propios = computed(() => props.data.inputs.filter(f =>
  f.appliesTo === props.data.key && !(props.data.rateBlock && DEL_BLOQUE.has(f.name))))
// con `showRows: false` queda solo la salida
const filas = computed(() => (props.data.showRows ? props.data.rows : props.data.rows.slice(-1)))

// ── agregar un campo ──
// Solo en los puntos de inserción: lo que se agregue acá entra al cálculo POR acá. Los tres
// controles son las tres cosas que definen qué hace el campo, y se leen como una frase.
const nuevo = ref(null)
const campo = ref(null)
const baseDelPunto = computed(() => RATE_BASE_LABEL[props.data.key])
const bases = computed(() => basesDisponibles(props.data.key))
const frase = computed(() => (nuevo.value ? describir({ ...nuevo.value, at: props.data.key }, fields) : ''))

async function abrir() {
  nuevo.value = { label: '', kind: 'money', base: '', spread: false }
  await nextTick()
  campo.value?.focus()
}
function crear() {
  if (!nuevo.value?.label.trim()) return
  addField({ ...nuevo.value, at: props.data.key })
  nuevo.value = null
}
</script>

<template>
  <div class="n n--stage" :class="['st--' + data.key, data.group && 'g--' + data.group]"
       style="min-width:296px;max-width:296px">
    <Handle v-if="data.key !== 'credit'" id="in" type="target" :position="Position.Left" />
    <!-- solo las etapas con una dependencia DENTRO de su grupo: la flecha baja en vez de dar
         la vuelta por la izquierda -->
    <Handle v-if="data.hUp" id="up" type="target" :position="Position.Top" />
    <Handle v-if="data.hDown" id="down" type="source" :position="Position.Bottom" />
    <div class="n__hd">
      <b>{{ data.title }}</b>
      <!-- solo los dos puntos de inserción la llevan: es lo que los hace par -->
      <span v-if="data.insertion" class="n__kind n__kind--in" :title="data.insertionHelp">
        {{ data.insertion }}</span>
    </div>

    <div class="ent">
      <!-- inputs propios de la etapa -->
      <div v-for="f in propios" :key="f.name" class="ent__row"
           :class="{ 'is-zero': inputs[f.name] === 0 || inputs[f.name] === false }">
        <span class="ent__k" :title="f.help">
          <em v-if="signo(f)" class="sg">{{ signo(f) }}</em>{{ f.label }}
          <!-- solo lo AMBIGUO: sobre qué se aplica el %, o que es un total repartido -->
          <i v-if="f.note" class="ent__note">{{ f.note }}</i>
        </span>
        <button v-if="f.field" class="nodrag del" @click="removeField(f.field)"
          title="quitar este campo">×</button>
        <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
          <option :value="true">sí</option><option :value="false">no</option>
        </select>
        <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
        <PercentInput v-else-if="f.type === 'rate'" v-model="inputs[f.name]" />
        <input v-else class="nodrag nf" type="text" inputmode="numeric" v-model="inputs[f.name]">
      </div>

      <RateBlock v-if="data.rateBlock" />

      <!-- agregar un campo. Solo en los puntos de inserción: entra al cálculo por acá -->
      <template v-if="data.insertion">
        <div v-if="!nuevo" class="ent__add">
          <button class="nodrag addbtn" @click="abrir"
            :title="`Agrega un costo que entra ${data.title}.`">+ campo</button>
        </div>
        <div v-else class="ent__new">
          <div class="ent__row">
            <input ref="campo" class="nodrag nf nf--name" v-model="nuevo.label"
              placeholder="nombre del costo" @keydown.enter="crear"
              @keydown.esc="nuevo = null" @keydown.stop>
            <select class="nodrag nf nf--kind" v-model="nuevo.kind">
              <option value="money">monto</option>
              <option value="rate">%</option>
            </select>
          </div>
          <!-- sobre qué se aplica: la base del punto, u otro campo de este mismo nodo -->
          <div v-if="nuevo.kind === 'rate'" class="ent__row">
            <span class="ent__k">sobre</span>
            <select class="nodrag nf nf--base" v-model="nuevo.base">
              <option value="">{{ baseDelPunto }}</option>
              <option v-for="b in bases" :key="b.id" :value="b.name">{{ b.label }}</option>
            </select>
          </div>
          <!-- en la cuota: ¿ya viene por cuota, o es un total que se reparte? -->
          <div v-if="data.key === 'charges'" class="ent__row">
            <span class="ent__k">cada</span>
            <select class="nodrag nf nf--base" v-model="nuevo.spread">
              <option :value="false">cuota</option>
              <option :value="true">total ÷ cuotas</option>
            </select>
          </div>
          <div class="ent__row ent__frase">
            <span class="ent__k">{{ frase }}</span>
            <button class="nodrag ok" @click="crear" :disabled="!nuevo.label.trim()">✓</button>
          </div>
        </div>
      </template>
    </div>

    <!-- resultados de la etapa -->
    <div v-if="filas.length" class="grp-rows st-out">
      <div v-for="(r, i) in filas" :key="r.name" class="grp-row"
           :class="{ 'is-out': i === filas.length - 1, 'is-off': r.status !== 'ok' }"
           :title="r.expr">
        <span class="grp-k">{{ r.label }}</span>
        <b class="grp-v">{{ val(r) }}</b>
      </div>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
