<script setup>
/* La columna de lectura. Cada pieza marcada es un <span> con `tabindex`: se puede llegar con Tab y
   no sólo con el mouse — sin eso, en un teclado o en el celular la mitad de la herramienta no
   existe.
 *
 * Y cada PÁRRAFO se puede pedir en español. Es otra ayuda, no la misma más grande: el glosario
 * contesta «qué quiere decir esta palabra» y esto contesta «qué está diciendo esta frase», que es la
 * pregunta que queda cuando entendés todas las palabras y aun así no entendés la oración — el inglés
 * ordena distinto y ahí el diccionario no ayuda.
 */
import { ref } from 'vue'
import { parrafoPedido, marcarParrafo } from '../memoria.js'

const props = defineProps({
  parrafos: Array, titulo: String, marcas: String,
  traduccion: { type: Array, default: () => [] },
  historiaId: String,
})
const emit = defineEmits(['entrar', 'salir', 'fijar'])

const abiertos = ref(new Set())
const hay = (i) => !!props.traduccion[i] && props.marcas !== 'ninguna'
const abierto = (i) => abiertos.value.has(i)
/* Abierto Y permitido. El modo ciego apagaba el botón pero dejaba en pantalla las traducciones que
   ya estuvieran desplegadas —medido: 0 botones y 4 traducciones—, y ese modo existe justamente para
   releer sin NINGUNA ayuda. Lo que estaba abierto vuelve al salir de ciego: el Set no se toca. */
const mostrando = (i) => abierto(i) && hay(i)
const pedido = (i) => parrafoPedido(`${props.historiaId}#${i}`)

/* Varias pueden quedar abiertas a la vez, a propósito: esto es un lector, no un acordeón. Cerrar la
   anterior al abrir otra obligaría a ir y volver para comparar dos párrafos seguidos. */
function alternar(i) {
  if (!hay(i)) return
  const s = new Set(abiertos.value)
  if (s.has(i)) s.delete(i)
  else { s.add(i); marcarParrafo(`${props.historiaId}#${i}`) }
  abiertos.value = s
}

/* ⌘ en Mac y Ctrl en el resto, y se aceptan las dos en todas partes para no depender de adivinar la
   plataforma. Lo que sí hay que atajar es que en macOS Ctrl+clic ES el clic derecho: el
   `contextmenu` se cancela SÓLO cuando vino con Ctrl, así que el clic derecho de siempre sigue
   funcionando. */
const conModificador = (e) => e.metaKey || e.ctrlKey
function porClic(e, i) {
  if (!conModificador(e)) return
  e.preventDefault()
  alternar(i)
}
</script>

<template>
  <article class="lectura" :class="'m-' + marcas">
    <h1 class="titulo">{{ titulo }}</h1>

    <div v-for="(parrafo, i) in parrafos" :key="i" class="bloque">
      <!-- El botón está SIEMPRE, no sólo al pasar el mouse: un gesto con tecla que nadie ve no
           existe, y en una pantalla táctil no hay ni tecla ni hover. Tenue hasta que lo mirás. -->
      <button
        v-if="hay(i)" class="pedir" :class="{ on: abierto(i), visto: pedido(i) }"
        :aria-pressed="abierto(i)" :title="abierto(i) ? 'ocultar el español' : 'verlo en español'"
        @click.stop="alternar(i)"
      >es</button>

      <p @click="porClic($event, i)" @contextmenu="$event.ctrlKey && $event.preventDefault()">
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
            @click="conModificador($event) || ($event.stopPropagation(), emit('fijar', { pz, el: $event.currentTarget }))"
          >{{ pz.texto }}</span>
          <template v-else>{{ pz.texto }}</template>
        </template>
      </p>

      <p v-if="mostrando(i)" class="es">{{ traduccion[i] }}</p>
    </div>
  </article>
</template>

<style scoped>
/* El padding izquierdo grande NO es estético: es donde vive el botón del margen. Sin reservarlo, en
   una ventana angosta el botón se sale del contenedor y queda cortado. */
.lectura{max-width:66ch;margin:0 auto;padding:34px 28px 120px 62px}
.bloque{position:relative}
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

.pedir{position:absolute;left:-40px;top:6px;width:26px;height:22px;padding:0;
  border:1px solid transparent;border-radius:5px;background:none;cursor:pointer;
  font:inherit;font-size:11px;color:var(--page-tenue);opacity:.3;
  transition:opacity .15s,color .15s,border-color .15s}
.bloque:hover .pedir{opacity:1}
.pedir:hover{color:var(--page-ink);border-color:var(--line)}
.pedir:focus-visible{opacity:1;outline:2px solid var(--accent);outline-offset:1px}
.pedir.on{opacity:1;color:var(--accent);border-color:var(--line)}
/* Punto: este párrafo ya lo pediste alguna vez. Al releer dice cuáles no se entendieron solos. */
.pedir.visto::after{content:"";position:absolute;top:1px;right:1px;width:4px;height:4px;
  border-radius:50%;background:var(--page-tenue)}
.pedir.on.visto::after{background:var(--accent)}

/* Sans y más chico: tiene que leerse como una NOTA al lado del texto, no como parte de la historia.
   La barra a la izquierda es lo que evita confundirse de idioma al bajar la vista. */
.lectura p.es{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  font-size:14.5px;line-height:1.65;color:var(--page-soft);
  margin:-.55em 0 1.35em;padding:2px 0 2px 13px;border-left:2px solid var(--line-fuerte)}

@media (max-width:900px){
  .lectura{padding-left:44px}
  .pedir{left:-34px}
}
</style>
