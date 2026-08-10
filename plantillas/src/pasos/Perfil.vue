<script setup>
defineProps({ solicitud: String, valores: Object })
</script>

<template>
  <div class="paso">
    <h3>Tu perfil</h3>
    <p class="ayuda">
      Acá va a ir el perfil del usuario. Por ahora es solo texto: el componente está en el catálogo,
      declarado sin efecto de backend, para poder tener un paso siguiente sin inventar un formulario.
    </p>
    <p class="ayuda">
      El número verificado fue <b>{{ valores?.telefono_e164 || '—' }}</b>.
    </p>
  </div>
</template>
