<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { persona, baseDe, buscarRemotas, cuantasSuyas, dias } from '../datos.js'
import { trabarFondo } from '../scroll.js'
import Avatar from './Avatar.vue'

/* El modal ya sabe DE QUIÉN es la rama: se abre desde la card de una persona. Por eso no hay campo
   «quién la trabaja» — preguntarlo sería pedir dos veces lo mismo. */
const props = defineProps({
  abierto: Boolean,
  epica:   { type: Object, required: true },
  quien:   { type: String, default: '' },
})
const emit = defineEmits(['agregar', 'cerrar'])

const dlg = ref(null)
const inpBuscar = ref(null)

const texto = ref('')
const elegida = ref(null)      // null = estoy buscando; con valor = estoy confirmando
const nota = ref('')
const todas = ref(false)       // salida de emergencia: ver también las ramas de los demás

const quienEs = computed(() => (props.quien ? persona(props.quien) : null))
const nombre = computed(() => quienEs.value?.nombre.split(' ')[0] ?? '')
const resultados = computed(() => buscarRemotas(props.epica, texto.value, props.quien, todas.value))
const libres = computed(() => resultados.value.filter(r => !r.tomada).length)
const suyas = computed(() => cuantasSuyas(props.epica, props.quien))

/* La rama base NO se elige acá: la épica ya declaró de qué rama sale cada repo, y ofrecer un
   selector permitía contradecir esa directiva desde el lugar más fácil de pasar por alto.

   Se guarda la base DETECTADA (lo que dice origin), no la declarada, porque es el hecho. Y si las
   dos no coinciden se avisa: la divergencia es información —«esta salió de main y el resto de
   develop»—, y taparla escribiendo la declarada la volvería invisible. */
const declarada = computed(() => (elegida.value ? baseDe(props.epica, elegida.value.repo) : null))
const detectada = computed(() => elegida.value?.base ?? null)
const desviada = computed(() =>
  detectada.value && declarada.value && detectada.value !== declarada.value)

function elegir(r){
  if (r.tomada) return
  elegida.value = r
  nota.value = ''
}

function volver(){
  elegida.value = null
  requestAnimationFrame(() => inpBuscar.value?.focus())
}

watch(() => props.abierto, async (v) => {
  trabarFondo(v)
  if (v) {
    texto.value = ''
    elegida.value = null
    nota.value = ''
    todas.value = false
    dlg.value?.showModal()
    await new Promise(r => requestAnimationFrame(r))
    inpBuscar.value?.focus()
  } else {
    dlg.value?.close()
  }
})

// Si la vista se desmonta con el modal abierto, el body quedaría trabado para siempre.
onUnmounted(() => { if (props.abierto) trabarFondo(false) })

function confirmar(){
  if (!elegida.value) return
  emit('agregar', {
    repo: elegida.value.repo,
    rama: elegida.value.rama,
    base: detectada.value,
    quien: props.quien,
    nota: nota.value,
  })
}
</script>

<template>
  <dialog ref="dlg" @close="emit('cerrar')" @cancel.prevent="emit('cerrar')">
    <div class="d-head">
      <h2>
        Agregar rama
        <span v-if="quienEs" class="de"><Avatar :quien="quien" :tam="20" /> {{ quienEs.nombre }}</span>
      </h2>
      <p v-if="!elegida && !todas">
        Las ramas que <b>{{ nombre }}</b> pusheó a <span class="mono">origin</span>, en los repos de
        la épica. Creala y pusheala en tu local y aparece acá.
      </p>
      <p v-else-if="!elegida">
        Todas las ramas de <span class="mono">origin</span> en los repos de la épica, no solo las de
        {{ nombre }}.
      </p>
      <p v-else>Confirmá en qué vas a trabajar.</p>
    </div>

    <!-- ── paso 1: buscar ─────────────────────────────────────────────────────────────────── -->
    <template v-if="!elegida">
      <div class="d-busca">
        <input ref="inpBuscar" v-model="texto" type="text" class="buscar mono" autocomplete="off"
               placeholder="filtrá por nombre de rama o repo…"
               @keydown.enter="resultados.find(r => !r.tomada) && elegir(resultados.find(r => !r.tomada))">
      </div>
      <div class="d-body lista">
        <button v-for="r in resultados" :key="r.repo + r.rama" type="button" class="res"
                :class="{ tomada: r.tomada, ajena: todas && r.empujo !== quien }"
                :disabled="!!r.tomada" @click="elegir(r)">
          <span class="linea1">
            <span class="rama mono">{{ r.rama }}</span>
            <span class="repo mono">{{ r.repo }}</span>
          </span>
          <span class="linea2">
            <template v-if="todas">
              <Avatar :quien="r.empujo" :tam="17" />
              <span class="empujo">{{ persona(r.empujo).nombre.split(' ')[0] }} · {{ dias(r.dias) }}</span>
            </template>
            <span v-else class="empujo">último commit hace {{ dias(r.dias) }}</span>
            <span v-if="r.base !== baseDe(epica, r.repo)" class="desvio mono">↰ {{ r.base }}</span>
            <span v-if="r.tomada" class="ocupada">
              ya está en la épica — {{ persona(r.tomada.autor).nombre.split(' ')[0] }}
            </span>
          </span>
        </button>

        <p v-if="!resultados.length" class="nada">
          <template v-if="texto">
            Ninguna coincide con «{{ texto }}».
          </template>
          <template v-else-if="!todas && !suyas">
            No hay ramas de <b>{{ nombre }}</b> en <span class="mono">origin</span> dentro de estos
            repos. ¿Ya le hiciste push?
          </template>
          <template v-else>Nada acá.</template>
        </p>

        <!-- La salida. `empujo` es el autor del último commit, no «quien creó la rama»: si pusheó
             con otro usuario de git, o si otro le metió un commit encima, su rama no figura como
             suya. Sin esta salida eso se vuelve un callejón. -->
        <p class="escape">
          <template v-if="!todas">
            ¿No la ves? Puede estar pusheada con otro usuario de git.
            <button type="button" class="link" @click="todas = true">ver todas las ramas</button>
          </template>
          <template v-else>
            <button type="button" class="link" @click="todas = false">volver a las de {{ nombre }}</button>
          </template>
        </p>
      </div>
    </template>

    <!-- ── paso 2: confirmar ──────────────────────────────────────────────────────────────── -->
    <div v-else class="d-body">
      <div class="elegida">
        <span class="rama mono">{{ elegida.rama }}</span>
        <span class="repo mono">{{ elegida.repo }}</span>
        <button type="button" class="link" @click="volver">cambiar</button>
      </div>

      <!-- La base es un HECHO, no un campo: la declaró la épica y se detecta desde origin. Acá solo
           se informa, y si las dos no coinciden se avisa en vez de dejar cambiarla. -->
      <div class="dato" :class="{ ojo: desviada }">
        <span class="rot">Sale de</span>
        <span class="valor mono">{{ detectada ?? declarada ?? '—' }}</span>
        <p v-if="desviada" class="pista-txt ojo">
          ⚠ La épica declaró <b class="mono">{{ declarada }}</b> para
          <span class="mono">{{ elegida.repo }}</span>, y esta rama parece salir de
          <b class="mono">{{ detectada }}</b>. Se agrega igual y queda marcada en la lista — pero
          revisá si ramificaste de donde querías.
        </p>
        <p v-else class="pista-txt">
          La rama base que la épica declaró para <span class="mono">{{ elegida.repo }}</span>.
          No se elige acá.
        </p>
      </div>

      <div class="campo">
        <label for="snota">En qué vas a trabajar</label>
        <input id="snota" v-model="nota" type="text" autocomplete="off"
               placeholder="Ej: el OTP que autoriza el cambio" @keydown.enter="confirmar">
        <p class="pista-txt">Opcional, pero es lo que evita que dos toquen lo mismo.</p>
      </div>
    </div>

    <div class="d-foot">
      <span class="aviso">
        <template v-if="!elegida && !todas">
          {{ libres }} {{ libres === 1 ? 'rama tuya disponible' : 'ramas tuyas disponibles' }}
        </template>
        <template v-else-if="!elegida">{{ libres }} disponibles en origin</template>
      </span>
      <button class="ctl" @click="emit('cerrar')">Cancelar</button>
      <button v-if="elegida" class="primary" :disabled="!base" @click="confirmar">Agregar rama</button>
    </div>
  </dialog>
</template>

<style scoped>
/* Anclado ARRIBA, no centrado. Dos razones: el alto cambia mucho entre el buscador (41 ramas) y el
   paso de confirmar, y centrando el modal SALTA verticalmente al elegir; y si la ventana del
   navegador es más alta que la pantalla visible, el centro de la ventana queda fuera de vista. */
dialog{border:1px solid var(--line);border-radius:14px;background:var(--panel);color:var(--page-ink);
  padding:0;width:min(560px,calc(100vw - 32px));max-height:min(78vh,620px);
  margin:max(7vh,20px) auto auto;
  box-shadow:0 18px 50px rgba(0,0,0,.28)}
dialog::backdrop{background:rgba(10,14,18,.5);backdrop-filter:blur(2px)}
/* `display` SOLO en [open]. Puesto en `dialog` a secas pisa el `display:none` que el navegador le
   da al diálogo cerrado —regla de UA, siempre pierde contra la del autor— y el modal aparece
   dibujado al final de la página. */
dialog[open]{display:flex;flex-direction:column;animation:sube .22s cubic-bezier(.2,.9,.3,1.1)}
@keyframes sube{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

.d-head{padding:17px 19px 0;flex:0 0 auto}
.d-head h2{font-size:16px;margin:0;letter-spacing:-.01em;display:flex;align-items:center;
  gap:9px;flex-wrap:wrap}
.de{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;
  color:var(--page-soft);background:var(--soft-bg);padding:3px 10px 3px 3px;border-radius:20px}
.d-head p{font-size:12.5px;color:var(--page-soft);margin:6px 0 0;line-height:1.5}
.d-body{padding:16px 19px 4px;display:flex;flex-direction:column;gap:16px;overflow-y:auto;flex:1 1 auto}

/* El buscador queda fijo y la lista scrollea: en 40 ramas, perder la caja de texto es perder todo. */
.d-busca{padding:13px 19px 0;flex:0 0 auto}
.buscar{width:100%;font:inherit;font-size:13.5px;padding:9px 12px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink)}
.buscar:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft-bg)}
.buscar::placeholder{font-family:-apple-system,sans-serif;color:var(--page-soft);opacity:.7}

.lista{gap:5px;padding-top:12px}
.res{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;
  padding:8px 11px;border-radius:8px;border:1px solid transparent;background:var(--soft-bg);
  cursor:pointer;font:inherit;color:var(--page-ink);width:100%}
.res:hover:not(:disabled){border-color:var(--accent);background:var(--page)}
/* Solo en modo «ver todas»: marca las que no son de esta persona, que son la excepción ahí. */
.res.ajena{box-shadow:inset 2.5px 0 0 var(--soft-bg2)}
.res.tomada{opacity:.5;cursor:not-allowed;border-style:dashed;border-color:var(--line)}
.linea1{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;width:100%}
.linea2{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.res .rama{font-size:12.5px;font-weight:600}
.res .repo{font-size:11px;color:var(--page-soft)}
.empujo{font-size:11px;color:var(--page-soft)}
.desvio{font-size:10.5px;color:var(--contract);font-weight:600;background:rgba(91,60,196,.12);
  padding:1px 6px;border-radius:5px}
.ocupada{font-size:10.5px;color:var(--page-soft);font-style:italic}
.nada{font-size:12.5px;color:var(--page-soft);line-height:1.6;padding:14px 2px}
.nada b{color:var(--page-ink)}
.escape{font-size:11.5px;color:var(--page-soft);line-height:1.6;margin:6px 0 2px;padding:0 2px}

.elegida{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding:10px 12px;
  border-radius:9px;background:var(--soft-bg);border-left:2.5px solid var(--accent)}
.elegida .rama{font-size:13px;font-weight:700}
.elegida .repo{font-size:11.5px;color:var(--page-soft)}
.link{background:none;border:none;font:inherit;font-size:11.5px;color:var(--accent);cursor:pointer;
  padding:0;text-decoration:underline;margin-left:auto}

.campo > label{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;
  color:var(--page-soft);font-weight:600;margin-bottom:6px}
.campo input[type=text]{width:100%;font:inherit;font-size:14px;padding:9px 12px;border-radius:8px;
  border:1px solid var(--line);background:var(--page);color:var(--page-ink)}
.campo input[type=text]:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft-bg)}
.campo input::placeholder{color:var(--page-soft);opacity:.65}
.pista-txt{font-size:11.5px;color:var(--page-soft);margin:8px 0 0;line-height:1.5}
.pista-txt b{color:var(--page-ink)}
.pista-txt.ojo{color:var(--warn)}
.pista-txt.ojo b{color:var(--warn)}

/* Bloque de solo lectura: sin borde de campo ni fondo de input, para que no se lea como algo
   editable. Si estuviera enmarcado como los demás, la gente intentaría cambiarlo. */
.dato{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.dato .rot{font-size:12px;color:var(--page-soft)}
.dato .valor{font-size:12.5px;font-weight:500;color:var(--page-ink);
  border:1px solid var(--line);border-radius:5px;padding:2px 9px}
.dato.ojo .valor{border-color:var(--warn);color:var(--warn)}
.dato .pista-txt{flex:1 0 100%;margin-top:0}

.fila{display:flex;flex-wrap:wrap;gap:7px}
.opc{display:inline-flex;align-items:center;gap:7px;padding:5px 13px;border-radius:22px;
  border:1px solid var(--line);background:var(--page);cursor:pointer;font:inherit;font-size:12.5px;
  color:var(--page-ink);transition:border-color .12s,background .12s}
.opc:hover{border-color:var(--accent)}
.opc.on{border-color:var(--accent);background:var(--soft-bg);font-weight:600}

.d-foot{padding:15px 19px 17px;display:flex;align-items:center;gap:9px;flex:0 0 auto;
  border-top:1px solid var(--line);margin-top:8px}
.aviso{font-size:11.5px;color:var(--page-soft);margin-right:auto}
</style>
