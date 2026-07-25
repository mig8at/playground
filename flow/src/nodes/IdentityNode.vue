<script setup>
import { Handle, Position } from '@vue-flow/core'
import { User } from 'lucide-vue-next'

// Primer paso del flujo de CRÉDITO (producto crédito + Credifamilia) tras seleccionar el lender:
// VALIDACIÓN DE IDENTIDAD. Placeholder visual (cuadro negro + ícono de usuario) — vamos paso a paso;
// el resto de la cadena se irá agregando después.
</script>

<template>
  <div class="node node--identity" title="Validación de identidad — primer paso tras elegir el lender de crédito">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="idn-icon"><User :size="40" :stroke-width="1.5" /></div>
    <div class="idn-cap">Validación de identidad</div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
