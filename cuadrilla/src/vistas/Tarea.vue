<script setup>
import { ref, computed } from 'vue'
import { persona, buscarEpica, ramasDe, docDe, guardarDoc, agregarRama, sacarRama,
         baseDe, nombresDeRepos, fraccion, dias, estadoDatos } from '../datos.js'
import { personaDe } from '../sesion.js'
import { aHtml } from '../markdown.js'
import Avatar from '../piezas/Avatar.vue'
import Barra from '../piezas/Barra.vue'
import Rama from '../piezas/Rama.vue'
import SumarRama from '../piezas/SumarRama.vue'
import Documentar from '../piezas/Documentar.vue'

/* LA TAREA: lo que UNA persona hace dentro de UNA épica. Tiene URL propia
   (`/epica/:id/:quien`) por el mismo motivo que la épica: para poder pegarla en Slack y que el
   otro caiga exactamente en «esto es lo que estoy tocando», sin tener que buscar su card entre
   seis. Es la unidad que se reparte y de la que se rinde cuentas. */
const props = defineProps({
  id:    { type: String, required: true },
  quien: { type: String, required: true },
})

const epica = computed(() => buscarEpica(props.id))

/* La URL acepta el id del tablero (`miguel`) o el login de GitHub (`mig-creditop`): quien comparte
   el enlace suele tener a mano el login, no el id interno, y hacer fallar la página por eso sería
   pedantería. El canónico es el id. */
const quien = computed(() => {
  const q = props.quien
  if (epica.value?.devs.includes(q)) return q
  return personaDe(q) ?? q
})

const enLaEpica = computed(() => epica.value?.devs.includes(quien.value) ?? false)
const yo = computed(() => persona(quien.value))
const ramas = computed(() => (epica.value ? ramasDe(epica.value, quien.value) : []))
const doc = computed(() => (epica.value ? docDe(epica.value, quien.value) : null))

const mergeadas = computed(() => ramas.value.filter(r => r.estado === 'mergeada').length)
const pct = computed(() => (ramas.value.length
  ? Math.round(mergeadas.value / ramas.value.length * 100) : 0))
const esperando = computed(() => ramas.value.filter(r => r.estado === 'aprobacion'))

// Los repos de la épica donde esta persona todavía no puso nada. Es la pregunta que contesta esta
// página: qué le falta tocar.
const sinTocar = computed(() => (epica.value ? nombresDeRepos(epica.value)
  .filter(r => !ramas.value.some(x => x.repo === r)) : []))

const sumando = ref(false)
const documentando = ref(false)

async function agregar(datos){
  await agregarRama(epica.value, datos)
  sumando.value = false
}
async function quitar(r){
  if (!confirm(`¿Sacar ${r.rama} (${r.repo}) de la épica? La rama sigue existiendo en origin.`)) return
  await sacarRama(epica.value, r.repo, r.rama)
}
async function documentar(datos){
  await guardarDoc(epica.value, quien.value, datos)
  documentando.value = false
}
</script>

<template>
  <p v-if="estadoDatos.estado === 'cargando'" class="perdido">Cargando…</p>

  <div v-else-if="!epica" class="perdido">
    <p>No existe esa épica.</p>
    <RouterLink to="/" class="volver">← Todas las épicas</RouterLink>
  </div>

  <template v-else>
    <RouterLink :to="{ name: 'epica', params: { id: epica.id } }" class="volver">
      ← {{ epica.nombre }}
    </RouterLink>

    <div class="cabeza">
      <Avatar :quien="quien" :tam="40" />
      <div class="titulo">
        <h1>{{ yo.nombre }}</h1>
        <p class="meta">
          en <RouterLink :to="{ name: 'epica', params: { id: epica.id } }">{{ epica.nombre }}</RouterLink>
          <template v-if="ramas.length"> · {{ fraccion(mergeadas, ramas.length) }}</template>
        </p>
      </div>
      <Barra v-if="ramas.length" :pct="pct" class="avance" />
    </div>

    <!-- Alguien puede llegar por un enlace viejo, o después de que lo sacaran de la épica. Su
         trabajo sigue estando —sacar a una persona no borra sus ramas— y se muestra igual. -->
    <p v-if="!enLaEpica" class="aviso">
      {{ yo.nombre }} ya no está asignado a esta épica, pero lo que hizo sigue acá.
    </p>

    <p v-if="esperando.length" class="trabe">
      <b>{{ esperando.length === 1 ? 'Una rama espera aprobación' : `${esperando.length} ramas esperan aprobación` }}</b>
      — la más vieja hace {{ dias(Math.max(...esperando.map(r => r.dias))) }}.
    </p>

    <section class="bloque">
      <header>
        <h2>Ramas</h2>
        <button class="add" @click="sumando = true"><span class="mas">＋</span> agregar rama</button>
      </header>

      <ul v-if="ramas.length" class="ramas">
        <li v-for="r in ramas" :key="r.repo + r.rama" class="fila">
          <Rama :r="r" :base="baseDe(epica, r.repo)" />
          <button class="x" title="sacar de la épica" @click="quitar(r)">×</button>
        </li>
      </ul>
      <p v-else class="vacio">
        Todavía sin ramas. Creala y pusheala, y después buscala con <b>agregar rama</b>.
      </p>

      <p v-if="sinTocar.length" class="falta">
        Repos de la épica que todavía no tocó:
        <span v-for="r in sinTocar" :key="r" class="repo mono">{{ r }} <i>↰ {{ baseDe(epica, r) }}</i></span>
      </p>
    </section>

    <section class="bloque">
      <header>
        <h2>Documentación</h2>
        <span v-if="doc" class="cuando">actualizada {{ doc.dias === 0 ? 'hoy' : `hace ${dias(doc.dias)}` }}</span>
        <button class="add" @click="documentando = true">
          <span v-if="doc" class="punto"></span><span v-else class="mas">＋</span>
          {{ doc ? 'editar' : 'escribir' }}
        </button>
      </header>

      <!-- Acá SÍ va completa y sin «leer más»: esta página es el lugar donde se viene a leerla. -->
      <div v-if="doc" class="md-cuerpo" v-html="aHtml(doc.texto)"></div>
      <p v-else class="vacio">
        Nada escrito. Es lo que el que llegue después necesita para no repetir tu camino.
      </p>
    </section>

    <SumarRama :abierto="sumando" :epica="epica" :quien="quien"
               @agregar="agregar" @cerrar="sumando = false" />
    <Documentar :abierto="documentando" :epica="epica" :quien="quien"
                @guardar="documentar" @cerrar="documentando = false" />
  </template>
</template>

<style scoped>
.volver{font-size:13px;color:var(--page-soft);text-decoration:none;display:inline-block;
  margin-bottom:14px}
.volver:hover{color:var(--page-ink)}
.perdido{padding:30px 0;color:var(--page-soft)}

.cabeza{display:flex;align-items:center;gap:13px;flex-wrap:wrap}
.titulo{flex:1;min-width:0}
h1{font-size:22px;font-weight:600;margin:0;letter-spacing:-.02em;line-height:1.25}
.meta{font-size:13px;color:var(--page-soft);margin:5px 0 0}
.meta a{color:var(--page-soft)}
.meta a:hover{color:var(--page-ink)}
.avance{flex:0 0 150px}

.aviso{margin:14px 0 0;font-size:12.5px;color:var(--page-tenue);border:1px dashed var(--line);
  border-radius:8px;padding:10px 12px}
.trabe{margin:14px 0 0;padding:10px 13px;border-radius:8px;font-size:12.5px;line-height:1.55;
  border:1px solid var(--line);background:var(--panel-2);color:var(--page-soft)}
.trabe b{color:var(--warn);font-weight:500}

.bloque{margin-top:16px;border:1px solid var(--line);border-radius:10px;background:var(--panel);
  padding:14px 15px}
.bloque header{display:flex;align-items:center;gap:10px;margin-bottom:11px}
h2{font-size:13px;font-weight:600;margin:0}
.cuando{font-size:11.5px;color:var(--page-tenue)}
.bloque header .add{margin-left:auto}
.add{font:inherit;font-size:12.5px;height:28px;padding:0 10px;border-radius:6px;
  border:1px solid var(--line);background:var(--panel);color:var(--page-soft);cursor:pointer;
  white-space:nowrap;display:inline-flex;align-items:center;gap:5px;
  transition:border-color .15s,color .15s}
.add:hover{border-color:var(--line-fuerte);color:var(--page-ink)}
.add .mas{font-size:13px;line-height:1}
.punto{width:6px;height:6px;border-radius:50%;background:var(--ok);flex:0 0 auto}

ul.ramas{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1px;
  border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--line)}
.fila{display:flex;align-items:stretch;background:var(--panel)}
.fila > :deep(.rama){flex:1;min-width:0}
.x{background:none;border:none;color:var(--page-tenue);cursor:pointer;font-size:16px;
  padding:0 11px;opacity:0;transition:opacity .15s,color .15s}
.fila:hover .x{opacity:1}
.x:hover{color:var(--bad)}

.vacio{margin:0;font-size:12.5px;color:var(--page-tenue);line-height:1.6}
.vacio b{color:var(--page-ink);font-weight:500}
.falta{margin:11px 0 0;font-size:11.5px;color:var(--page-tenue);display:flex;align-items:center;
  gap:6px;flex-wrap:wrap}
.falta .repo{border:1px dashed var(--line);border-radius:5px;padding:1px 8px}
.falta .repo i{font-style:normal;opacity:.7}
</style>
