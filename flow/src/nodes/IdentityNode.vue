<script setup>
import { Handle, Position } from '@vue-flow/core'
import { User } from 'lucide-vue-next'

// Primer paso del flujo de CRÉDITO (producto crédito + Credifamilia) tras seleccionar el lender:
// VALIDACIÓN DE IDENTIDAD. Nodo con cabecera + una caja negra con el ícono de usuario en el centro.
// Placeholder por ahora (vamos paso a paso); el resto de la cadena se agrega después.
</script>

<template>
  <div class="node node--identity">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="Validación de identidad — primer paso tras elegir el lender de crédito">
      <div class="node__title">Validación de identidad</div>
    </div>
    <div class="node__body">
      <div class="idn-box"><User :size="40" :stroke-width="1.5" /></div>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
