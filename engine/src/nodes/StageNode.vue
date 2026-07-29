<script setup>
import { computed, ref, nextTick } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import { fmtNum } from '../engine.js'
import { RATE_BASES, describir } from '../sheets.js'
import { inputs, fields, out, addField, removeField, setExpr, basesDisponibles } from '../store.js'

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
// Si la etapa tiene RateBlock, el bloque es dueño de `statedRate` y `compound`: sacarlos de la
// lista o se dibujan dos veces.
const DEL_BLOQUE = new Set(['statedRate', 'compound'])
const propios = computed(() => props.data.inputs.filter(f =>
  f.appliesTo === props.data.key && !(props.data.rateBlock && DEL_BLOQUE.has(f.name))))
// `nFilas` lo calcula el layout desde `rows` de la hoja: todas, solo la salida, o ninguna. La
// etapa sigue siendo dueña de sus fórmulas aunque no dibuje ninguna.
const filas = computed(() => props.data.rows.slice(props.data.rows.length - props.data.nFilas))

// ── agregar un campo ──
// Solo en los puntos de inserción: lo que se agregue acá entra al cálculo POR acá. Los tres
// controles son las tres cosas que definen qué hace el campo, y se leen como una frase.
const nuevo = ref(null)
const campo = ref(null)
// Las bases con nombre del punto (el monto neto, el bruto, lo financiado) más los campos ya
// creados en este nodo. Un campo solo puede apoyarse en los ANTERIORES, así que un ciclo no se
// puede ni escribir.
const basesFijas = computed(() => RATE_BASES[props.data.key] || [])
const bases = computed(() => basesDisponibles(props.data.key))
const frase = computed(() => (nuevo.value ? describir({ ...nuevo.value, at: props.data.key }, fields) : ''))

// ── los campos FÓRMULA ──
// No tienen perilla: su valor es la expresión, así que se dibujan aparte de `propios` (que son los
// inputs). Se muestran con la expresión editable y el resultado al lado — la celda de una hoja de
// cálculo. Si la expresión está mal, el motor devuelve la razón y se muestra ahí mismo.
const formulaFields = computed(() =>
  fields.filter(f => f.kind === 'formula' && f.at === props.data.key))
const resultado = f => out.value.res[f.name + 'Value']
// Por qué no dio. El `reason` de un `skipped` es un CÓDIGO del motor, no prosa: `upstream` con un
// `dependsOn`, o `missing_input` con un `missing`. Un ciclo, además, lo reporta en la fórmula que
// lo CIERRA y no en la que lo escribió, así que hay que perseguir la cadena hasta la causa real —
// sin esto la celda decía "—" o "upstream", que es justo cuando más hace falta saber por qué.
const razon = f => {
  let r = resultado(f)
  const visto = new Set()
  while (r?.status === 'skipped' && r.reason === 'upstream' && r.dependsOn?.[0]) {
    const sig = r.dependsOn[0]
    if (visto.has(sig)) break
    visto.add(sig)
    r = out.value.res[sig]
  }
  if (!r || r.status === 'ok') return ''
  if (r.status === 'error') return r.reason
  if (r.reason === 'missing_input') return `falta ${r.missing?.[0] ?? 'un dato'}`
  return 'sin calcular'
}

async function abrir() {
  nuevo.value = { label: '', kind: 'money', base: basesFijas.value[0]?.value || '',
                  spread: false, expr: '' }
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
    <!-- el de la izquierda solo si algo la apunta desde afuera del grupo -->
    <Handle v-if="data.hIn" id="in" type="target" :position="Position.Left" />
    <!-- solo las etapas con una dependencia DENTRO de su grupo: la flecha baja en vez de dar
         la vuelta por la izquierda -->
    <Handle v-if="data.hUp" id="up" type="target" :position="Position.Top" />
    <Handle v-if="data.hDown" id="down" type="source" :position="Position.Bottom" />
    <!-- El tooltip lleva la consecuencia (paga intereses o no). Estuvo como insignia visible
         mientras los dos puntos de inserción caían en columnas distintas y era lo único que los
         hacía leer como par; comparten columna y color, así que ya sobraba en pantalla. -->
    <div class="n__hd" :title="data.insertionHelp">
      <b>{{ data.title }}</b>
    </div>

    <div class="ent">
      <!-- inputs propios de la etapa -->
      <div v-for="f in propios" :key="f.name" class="ent__row">
        <span class="ent__k" :title="f.help">
          <span class="ent__kt">{{ f.label }}</span>
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

      <!-- campos fórmula: la expresión ES el valor, así que se ve y se edita -->
      <div v-for="f in formulaFields" :key="f.id" class="ent__f">
        <div class="ent__row">
          <span class="ent__k" :title="f.help"><span class="ent__kt">{{ f.label }}</span></span>
          <button class="nodrag del" @click="removeField(f.id)" title="quitar este campo">×</button>
          <input class="nodrag nf nf--expr" :value="f.expr" :title="f.expr"
            @input="setExpr(f.id, $event.target.value)" @keydown.stop spellcheck="false"
            placeholder="p. ej. amount * 0.05">
        </div>
        <div class="ent__row ent__fres">
          <span class="ent__k"></span>
          <b class="ent__fv" :class="{ 'is-bad': resultado(f)?.status !== 'ok' }">
            {{ resultado(f)?.status === 'ok' ? fmtNum(resultado(f).value) : '—' }}</b>
        </div>
        <div v-if="razon(f)" class="ent__err">{{ razon(f) }}</div>
      </div>

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
              <option value="formula">fórmula</option>
            </select>
          </div>
          <!-- una fórmula se escribe entera: no necesita base ni ÷ cuotas, eso se escribe ahí -->
          <div v-if="nuevo.kind === 'formula'" class="ent__row">
            <input class="nodrag nf nf--expr" v-model="nuevo.expr" @keydown.stop spellcheck="false"
              placeholder="p. ej. amount * 0.05 / installments">
          </div>
          <!-- sobre qué se aplica: la base del punto, u otro campo de este mismo nodo -->
          <div v-if="nuevo.kind === 'rate'" class="ent__row">
            <span class="ent__k">sobre</span>
            <select class="nodrag nf nf--base" v-model="nuevo.base">
              <option v-for="b in basesFijas" :key="b.value" :value="b.value" :title="b.help">
                {{ b.label }}</option>
              <option v-for="b in bases" :key="b.id" :value="b.name">{{ b.label }}</option>
            </select>
          </div>
          <!-- en la cuota: ¿ya viene por cuota, o es un total que se reparte? -->
          <div v-if="data.key === 'charges' && nuevo.kind !== 'formula'" class="ent__row">
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
