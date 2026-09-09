<script setup>
/* La columna de lectura. Cada pieza marcada es un <span> con `tabindex`: se puede llegar con Tab y
   no sólo con el mouse — sin eso, en un teclado o en el celular la mitad de la herramienta no
   existe. */
defineProps({ parrafos: Array, titulo: String, marcas: String })
const emit = defineEmits(['entrar', 'salir', 'fijar'])
</script>

<template>
  <article class="lectura" :class="'m-' + marcas">
    <h1 class="titulo">{{ titulo }}</h1>
    <p v-for="(parrafo, i) in parrafos" :key="i">
      <template v-for="(pz, j) in parrafo" :key="j">
        <span
          v-if="pz.entrada && marcas !== 'ninguna'"
          class="mk"
          :data-tipo="pz.entrada.tipo"
          tabindex="0"
          @mouseenter="emit('entrar', { pz, el: $event.currentTarget })"
          @mouseleave="emit('salir')"
          @focus="emit('entrar', { pz, el: $event.currentTarget, ya: true })"
          @blur="emit('salir')"
          @click.stop="emit('fijar', { pz, el: $event.currentTarget })"
        >{{ pz.texto }}</span>
        <template v-else>{{ pz.texto }}</template>
      </template>
    </p>
  </article>
</template>

<style scoped>
.lectura{max-width:62ch;margin:0 auto;padding:34px 28px 120px}
/* Serif y 18px: es la única parte de la app que se lee de corrido, y a 14px sans se lee peor. */
.lectura p{font-family:Georgia,"Iowan Old Style","Times New Roman",serif;
  font-size:18px;line-height:1.85;margin:0 0 1.15em}
.titulo{font-family:Georgia,"Iowan Old Style",serif;font-size:26px;font-weight:600;
  letter-spacing:-.02em;margin:0 0 26px}

/* El subrayado punteado marca sin gritar: se ve que hay ayuda, pero no convierte el párrafo en un
   semáforo. El color dice de qué TIPO es la ayuda; el peso del punteado, cuánta atención pide. */
.mk{cursor:help;border-radius:2px;transition:background-color .12s;
  text-decoration:underline dotted var(--core) 1px;text-underline-offset:4px}
.mk[data-tipo="nueva"]{text-decoration-color:var(--nueva);text-decoration-thickness:1.5px}
.mk[data-tipo="frase"]{text-decoration:underline solid var(--frase) 1.5px}
.mk[data-tipo="sentido"]{text-decoration:underline wavy var(--sentido) 1px}
.mk:hover,.mk:focus{background:var(--soft-bg2);outline:none}
.mk:focus{box-shadow:0 0 0 2px var(--accent)}

/* SÓLO LO NUEVO, que es el modo por defecto y lo dictó verlo corriendo: con las 100 subrayadas
   también, el párrafo entero queda rayado —cubren la mayor parte de cualquier texto— y justo lo que
   uno está aprendiendo hoy deja de saltar. Acá el núcleo pierde el subrayado pero SIGUE respondiendo
   al mouse: la ayuda está, no se anuncia. */
.m-nuevo .mk[data-tipo="core"]{text-decoration:none}
</style>
