<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { persona, docDe } from '../datos.js'
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
const trampa = ref('')

const quienEs = computed(() => (props.quien ? persona(props.quien) : null))
const nombre = computed(() => quienEs.value?.nombre.split(' ')[0] ?? '')
const existia = ref(false)
// Vaciar los dos campos es válido: así se borra una doc que ya no sirve.
const vaciando = computed(() => existia.value && !texto.value.trim() && !trampa.value.trim())

watch(() => props.abierto, async (v) => {
  trabarFondo(v)
  if (v) {
    const d = docDe(props.epica, props.quien)
    texto.value = d?.texto ?? ''
    trampa.value = d?.trampa ?? ''
    existia.value = !!d
    dlg.value?.showModal()
    await new Promise(r => requestAnimationFrame(r))
    inp.value?.focus()
  } else {
    dlg.value?.close()
  }
})

onUnmounted(() => { if (props.abierto) trabarFondo(false) })

const guardar = () => emit('guardar', { texto: texto.value, trampa: trampa.value })
</script>

<template>
  <dialog ref="dlg" @close="emit('cerrar')" @cancel.prevent="emit('cerrar')">
    <div class="d-head">
      <h2>
        Documentación
        <span v-if="quienEs" class="de"><Avatar :quien="quien" :tam="20" /> {{ quienEs.nombre }}</span>
      </h2>
      <p>Lo que el que llegue después necesita saber para no repetir tu camino.</p>
    </div>

    <div class="d-body">
      <div class="campo">
        <label for="dtexto">Qué hiciste y dónde quedó</label>
        <textarea id="dtexto" ref="inp" v-model="texto" rows="6"
                  placeholder="Dónde está el cambio, qué decisiones tomaste y qué quedó a medias."></textarea>
      </div>

      <div class="campo">
        <label for="dtrampa">Ojo con esto <i>opcional</i></label>
        <textarea id="dtrampa" v-model="trampa" rows="3"
                  placeholder="Lo que te costó tiempo: una columna con nombre engañoso, un cache que hay que bustear, un seeder que no es idempotente…"></textarea>
        <p class="pista-txt">
          Es el campo que separa un diario de algo útil: acá va lo que al otro le va a doler.
        </p>
      </div>
    </div>

    <div class="d-foot">
      <span class="aviso">{{ vaciando ? 'Vacía los dos campos y se borra la documentación' : '' }}</span>
      <button class="ctl" @click="emit('cerrar')">Cancelar</button>
      <button class="primary" @click="guardar">{{ vaciando ? 'Borrar' : 'Guardar' }}</button>
    </div>
  </dialog>
</template>

<style scoped>
dialog{border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--page-ink);
  padding:0;width:min(560px,calc(100vw - 32px));max-height:min(78vh,660px);
  margin:max(7vh,20px) auto auto;box-shadow:0 12px 40px rgba(0,0,0,.2)}
dialog::backdrop{background:rgba(0,0,0,.45)}
/* `display` SOLO en [open]: en `dialog` a secas pisa el display:none del navegador y el modal
   queda dibujado al final de la página. */
dialog[open]{display:flex;flex-direction:column;animation:sube .2s cubic-bezier(.2,.9,.3,1.1)}
@keyframes sube{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.d-head{padding:17px 19px 0;flex:0 0 auto}
.d-head h2{font-size:16px;font-weight:600;margin:0;display:flex;align-items:center;gap:9px;
  flex-wrap:wrap}
.de{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:400;
  color:var(--page-soft);border:1px solid var(--line);padding:2px 9px 2px 2px;border-radius:20px}
.d-head p{font-size:12.5px;color:var(--page-soft);margin:6px 0 0;line-height:1.5}
.d-body{padding:16px 19px 4px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;flex:1 1 auto}

.campo > label{display:block;font-size:12px;color:var(--page-soft);font-weight:500;margin-bottom:6px}
.campo > label i{font-style:normal;font-weight:400;color:var(--page-tenue);margin-left:5px}
textarea{width:100%;font:inherit;font-size:13.5px;line-height:1.6;padding:10px 12px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink);resize:vertical}
textarea:focus{outline:none;border-color:var(--line-fuerte)}
textarea::placeholder{color:var(--page-tenue)}
.pista-txt{font-size:11.5px;color:var(--page-tenue);margin:7px 0 0;line-height:1.5}

.d-foot{padding:15px 19px 17px;display:flex;align-items:center;gap:9px;flex:0 0 auto;
  border-top:1px solid var(--line);margin-top:8px}
.aviso{font-size:11.5px;color:var(--page-tenue);margin-right:auto}
</style>
