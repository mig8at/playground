<script setup>
// UN nodo del árbol, dibujado como caja. Se llama a sí mismo para los hijos — en un SFC de Vue 3 el
// componente puede referenciarse por su nombre de archivo.
//
// La ANIDACIÓN se ve por las cajas, no por paréntesis: un `bin` es un marco con sus dos lados
// adentro. Así `(2 × (monto + setup)) + extras` se lee por la forma y no contando paréntesis.
//
// Nada acá muta el árbol: se emite la ruta y el que manda (StageNode) reemplaza. Por eso el árbol
// puede ser inmutable y el `watch` de Vue ve cada cambio.
import { esRaiz } from './formulaTree.js'

const props = defineProps({
  node: Object,
  ruta: { type: Array, default: () => [] },
  sel: { type: Array, default: null },
  /** name → label, para mostrar el español en vez del identificador (la regla de siempre). */
  labels: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['sel', 'num'])

const mismaRuta = (a, b) => a && b && a.join('') === b.join('')
const elegido = () => mismaRuta(props.sel, props.ruta)
// Una raíz no es un tipo de nodo: es una potencia de exponente `1/n`, que es lo que el motor evalúa.
// Se detecta acá al dibujar, así que el texto guardado sigue siendo nativo del motor.
const rz = () => esRaiz(props.node)
</script>

<template>
  <!-- un cuadrito sin llenar -->
  <button v-if="!node || node.k === 'hueco'" class="nodrag fb__h" :class="{ on: elegido() }"
    @click.stop="emit('sel', ruta)" title="cuadrito vacío — elegí un campo, un número o una operación">▢</button>

  <!-- un campo o una base: se muestra el español, la fórmula guarda el identificador -->
  <button v-else-if="node.k === 'ref'" class="nodrag fb__r" :class="{ on: elegido() }"
    :title="node.name" @click.stop="emit('sel', ruta)">{{ labels[node.name] || node.name }}</button>

  <!-- un número: se escribe directo en la caja -->
  <span v-else-if="node.k === 'num'" class="fb__n" :class="{ on: elegido() }"
        @click.stop="emit('sel', ruta)">
    <input class="nodrag" :value="node.v" inputmode="decimal" spellcheck="false" @keydown.stop
      @input="emit('num', ruta, $event.target.value)"
      :style="{ width: Math.max(2, String(node.v ?? '').length + 1) + 'ch' }">
  </span>

  <!-- una RAÍZ: el radical con el índice arriba a la izquierda. Es `x ^ (1/n)`, detectado. -->
  <span v-else-if="rz()" class="fb__rz" :class="{ on: elegido() }" @click.stop="emit('sel', ruta)">
    <span class="fb__rz-i">
      <FormulaBoard :node="rz().idx" :ruta="[...ruta, ...rz().rutaIdx]" :sel="sel" :labels="labels"
        @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
    </span>
    <em class="fb__rz-s">√</em>
    <span class="fb__rz-x">
      <FormulaBoard :node="rz().x" :ruta="[...ruta, ...rz().rutaX]" :sel="sel" :labels="labels"
        @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
    </span>
  </span>

  <!-- una DIVISIÓN: fracción de verdad, numerador arriba y denominador abajo, con la línea en
       medio. Es la que más se gana en legibilidad: `fianza total ÷ cuotas` apilado se lee como lo
       que es, un reparto. -->
  <span v-else-if="node.o === '/'" class="fb__fr" :class="{ on: elegido() }"
        @click.stop="emit('sel', ruta)">
    <span class="fb__fr-n">
      <FormulaBoard :node="node.l" :ruta="[...ruta, 'l']" :sel="sel" :labels="labels"
        @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
    </span>
    <span class="fb__fr-d">
      <FormulaBoard :node="node.r" :ruta="[...ruta, 'r']" :sel="sel" :labels="labels"
        @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
    </span>
  </span>

  <!-- las demás operaciones: marco con los dos lados adentro. El marco es clickeable, así que se
       puede seleccionar la operación ENTERA para envolverla o reemplazarla. -->
  <span v-else class="fb__b" :class="{ on: elegido() }" @click.stop="emit('sel', ruta)">
    <FormulaBoard :node="node.l" :ruta="[...ruta, 'l']" :sel="sel" :labels="labels"
      @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
    <em class="fb__o">{{ node.o === '*' ? '×' : node.o }}</em>
    <FormulaBoard :node="node.r" :ruta="[...ruta, 'r']" :sel="sel" :labels="labels"
      @sel="r => emit('sel', r)" @num="(r, v) => emit('num', r, v)" />
  </span>
</template>
