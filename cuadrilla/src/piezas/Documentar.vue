<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { persona, docDe } from '../datos.js'
import { aHtml } from '../markdown.js'
import { trabarFondo } from '../scroll.js'
import Avatar from './Avatar.vue'

const props = defineProps({
  abierto: Boolean,
  epica:   { type: Object, required: true },
  quien:   { type: String, default: '' },
})
const emit = defineEmits(['guardar', 'cerrar'])

const dlg = ref(null)
const inp = ref(null)
const texto = ref('')
const modo = ref('editar')      // editar | preview
const existia = ref(false)

const quienEs = computed(() => (props.quien ? persona(props.quien) : null))
const html = computed(() => aHtml(texto.value))
// Vaciar el campo es válido: así se borra una doc que ya no sirve.
const vaciando = computed(() => existia.value && !texto.value.trim())

async function ver(m){
  modo.value = m
  if (m === 'editar') { await nextTick(); inp.value?.focus() }
}

watch(() => props.abierto, async (v) => {
  trabarFondo(v)
  if (v) {
    const d = docDe(props.epica, props.quien)
    texto.value = d?.texto ?? ''
    existia.value = !!d
    modo.value = 'editar'
    dlg.value?.showModal()
    await new Promise(r => requestAnimationFrame(r))
    inp.value?.focus()
  } else {
    dlg.value?.close()
  }
})

onUnmounted(() => { if (props.abierto) trabarFondo(false) })

const guardar = () => emit('guardar', { texto: texto.value })
</script>

<template>
  <dialog ref="dlg" @close="emit('cerrar')" @cancel.prevent="emit('cerrar')">
    <div class="d-head">
      <h2>
        Documentación
        <span v-if="quienEs" class="de"><Avatar :quien="quien" :tam="20" /> {{ quienEs.nombre }}</span>
        <button class="cerrar" title="cerrar" @click="emit('cerrar')">×</button>
      </h2>
      <p>
        Lo que el que llegue después necesita saber para no repetir tu camino: dónde quedó el cambio,
        qué decidiste, y <b>sobre todo las trampas</b> — lo que te costó tiempo.
      </p>
    </div>

    <div class="d-body">
      <div class="pestanas">
        <button type="button" class="pest" :class="{ on: modo === 'editar' }"
                :aria-pressed="modo === 'editar'" @click="ver('editar')">Editar</button>
        <button type="button" class="pest" :class="{ on: modo === 'preview' }"
                :aria-pressed="modo === 'preview'" @click="ver('preview')">Vista previa</button>
        <span class="md">markdown</span>
      </div>

      <textarea v-show="modo === 'editar'" ref="inp" v-model="texto" rows="14"
                placeholder="## Qué hice&#10;El árbol país→depto→ciudad quedó en tres tablas y un seeder.&#10;&#10;## Ojo con esto&#10;El seeder **no es idempotente**: corriéndolo dos veces duplica los departamentos.&#10;Truncá `countries`, `states` y `cities` antes."></textarea>

      <!-- El HTML pasa por DOMPurify en `markdown.js`; sin eso, esto sería un XSS con forma de nota. -->
      <div v-show="modo === 'preview'" class="preview md-cuerpo">
        <div v-if="html" v-html="html"></div>
        <p v-else class="vacio-md">Nada escrito todavía.</p>
      </div>
    </div>

    <div class="d-foot">
      <span class="aviso">{{ vaciando ? 'Vacío: se borra la documentación' : '' }}</span>
      <button class="ctl" @click="emit('cerrar')">Cancelar</button>
      <button class="primary" @click="guardar">{{ vaciando ? 'Borrar' : 'Guardar' }}</button>
    </div>
  </dialog>
</template>

<style scoped>
/* Panel lateral derecho, no modal centrado. Sigue siendo un `<dialog open-modal>` a propósito: eso
   trae gratis el Esc, la trampa de foco y el top layer —reimplementar eso a mano con un `<aside>`
   es donde se pierden los detalles de accesibilidad—. Lo único que cambia es dónde se para.

   `margin:0` + `left:auto` es lo que lo pega a la derecha: el navegador le pone `inset:0` y
   `margin:auto` a los diálogos modales, y eso es justo lo que los centra. */
dialog{border:1px solid var(--line);border-left:1px solid var(--line);border-radius:0;
  background:var(--panel);color:var(--page-ink);padding:0;
  width:min(620px,100vw);max-width:100vw;height:100vh;max-height:100vh;
  margin:0;left:auto;right:0;top:0;box-shadow:-12px 0 40px rgba(0,0,0,.22)}
/* Más suave que en un modal: el punto de un panel al costado es no tapar la página de atrás. */
dialog::backdrop{background:rgba(0,0,0,.32)}
/* `display` SOLO en [open]: en `dialog` a secas pisa el display:none del navegador y el panel
   queda dibujado al final de la página. */
dialog[open]{display:flex;flex-direction:column;animation:entra .22s cubic-bezier(.2,.9,.3,1)}
@keyframes entra{from{transform:translateX(100%)}to{transform:none}}

/* En angosto ocupa todo: un panel de 620px en un teléfono es un modal con peor animación. */
@media (max-width:680px){
  dialog{width:100vw;border-left:none}
}

.d-head{padding:17px 19px 0;flex:0 0 auto}
.d-head h2{font-size:16px;font-weight:600;margin:0;display:flex;align-items:center;gap:9px;
  flex-wrap:wrap}
.cerrar{margin-left:auto;background:none;border:none;color:var(--page-tenue);cursor:pointer;
  font-size:22px;line-height:1;padding:0 2px}
.cerrar:hover{color:var(--page-ink)}
.de{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:400;
  color:var(--page-soft);border:1px solid var(--line);padding:2px 9px 2px 2px;border-radius:20px}
.d-head p{font-size:12.5px;color:var(--page-soft);margin:6px 0 0;line-height:1.55}
.d-head p b{color:var(--page-ink);font-weight:500}
.d-body{padding:14px 19px 6px;display:flex;flex-direction:column;flex:1 1 auto;min-height:0}

.pestanas{display:flex;align-items:center;gap:2px;margin-bottom:10px;flex:0 0 auto}
.pest{font:inherit;font-size:12.5px;padding:5px 11px;border-radius:6px;border:1px solid transparent;
  background:none;color:var(--page-soft);cursor:pointer}
.pest:hover{color:var(--page-ink)}
.pest.on{border-color:var(--line);background:var(--panel-2);color:var(--page-ink);font-weight:500}
.md{margin-left:auto;font-size:11px;color:var(--page-tenue);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace}

/* Editor y preview comparten alto y crecen con el panel: alternar de pestaña no mueve el pie, y
   `min-height:0` es lo que deja que un hijo de flex se encoja de verdad en vez de desbordar. */
textarea,.preview{flex:1 1 auto;min-height:0;width:100%;padding:11px 13px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);overflow-y:auto}
textarea{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.7;
  color:var(--page-ink);resize:none}
textarea:focus{outline:none;border-color:var(--line-fuerte)}
textarea::placeholder{color:var(--page-tenue)}
.preview{background:var(--panel-2)}
.vacio-md{margin:0;font-size:12.5px;color:var(--page-tenue)}

.d-foot{padding:14px 19px 17px;display:flex;align-items:center;gap:9px;flex:0 0 auto;
  border-top:1px solid var(--line);margin-top:10px}
.aviso{font-size:11.5px;color:var(--page-tenue);margin-right:auto}
</style>
