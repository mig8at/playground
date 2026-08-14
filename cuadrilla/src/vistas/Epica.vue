<script setup>
import { ref, computed } from 'vue'
import { persona, ESTADOS, buscarEpica, avance, conteo, masVieja, ramasDe, genteDe,
         agregarRama, docDe, guardarDoc, baseDe, sacarRama, estadoDatos,
         dias, fraccion, enumerar } from '../datos.js'
import { aHtml } from '../markdown.js'
import Avatar from '../piezas/Avatar.vue'
import Barra from '../piezas/Barra.vue'
import Rama from '../piezas/Rama.vue'
import SumarRama from '../piezas/SumarRama.vue'
import Documentar from '../piezas/Documentar.vue'
import EditarEpica from '../piezas/EditarEpica.vue'

const props = defineProps({ id: { type: String, required: true } })

const epica = computed(() => buscarEpica(props.id))
const filtro = ref('todo')
const abriendo = ref(null)      // de quién es la card que abrió el buscador de ramas
const documentando = ref(null)  // de quién es la card que abrió la documentación
const desplegadas = ref(new Set())   // docs abiertas, por persona

const desplegada = q => desplegadas.value.has(q)
function alternarDoc(q){
  const s = new Set(desplegadas.value)
  s.has(q) ? s.delete(q) : s.add(q)
  desplegadas.value = s
}

/* «leer más» solo aparece si de verdad hay más que leer: un enlace que despliega lo mismo que ya
   se ve es peor que no tenerlo. Se mide sobre el markdown crudo —umbral ~2 líneas—; medir el HTML
   renderizado contaría las etiquetas y una nota corta con dos negritas pediría desplegarse. */
const hayMas = d => (d.texto?.length ?? 0) > 110
const editando = ref(false)

const av = computed(() => avance(epica.value))
const c  = computed(() => conteo(epica.value))
const vieja = computed(() => masVieja(epica.value))

// Los repos que la épica declaró, con cuántas ramas tiene cada uno. Un repo en cero es la señal
// útil: se dijo que se iba a tocar y todavía no lo agarró nadie.
const repos = computed(() => (epica.value.repos ?? []).map(r => ({
  nombre: r.repo,
  base: r.base,
  n: epica.value.ramas.filter(x => x.repo === r.repo).length,
})))
const huerfanos = computed(() => repos.value.filter(r => !r.n).length)

// El progreso de CADA involucrado: sus ramas mergeadas sobre sus ramas. La fracción va siempre
// al lado del porcentaje — un % suelto por persona se lee como calificación, y no lo es.
const cuadrilla = computed(() => genteDe(epica.value).map(quien => {
  const suyas = ramasDe(epica.value, quien)
  const mergeadas = suyas.filter(r => r.estado === 'mergeada').length
  const esperando = suyas.filter(r => r.estado === 'aprobacion')
  return {
    quien,
    nombre: persona(quien).nombre,
    ramas: filtro.value === 'todo' ? suyas : suyas.filter(r => r.estado === filtro.value),
    total: suyas.length,
    mergeadas,
    pct: suyas.length ? Math.round(mergeadas / suyas.length * 100) : 0,
    esperando: esperando.length,
    masDias: esperando.length ? Math.max(...esperando.map(r => r.dias)) : 0,
    doc: docDe(epica.value, quien),
  }
}))

// Con filtro puesto se esconde a quien no tiene nada de ese estado; sin filtro, todos aparecen
// aunque no hayan creado ninguna rama — no arrancar también es información.
const visibles = computed(() =>
  filtro.value === 'todo' ? cuadrilla.value : cuadrilla.value.filter(p => p.ramas.length))

async function agregar(datos){
  await agregarRama(epica.value, datos)
  abriendo.value = null
  filtro.value = 'todo'          // si no, la rama recién agregada podría nacer escondida por el filtro
}

async function quitar(r){
  if (!confirm(`¿Sacar ${r.rama} (${r.repo}) de la épica? La rama sigue existiendo en origin.`)) return
  await sacarRama(epica.value, r.repo, r.rama)
}

async function documentar(datos){
  const quien = documentando.value
  await guardarDoc(epica.value, quien, datos)
  // Se despliega la que acabás de escribir: verla colapsada justo después de guardarla deja la
  // duda de si se guardó.
  desplegadas.value = new Set([...desplegadas.value, quien])
  documentando.value = null
}
</script>

<template>
  <!-- «Cargando» y «no existe» se ven igual y no son lo mismo: entrando por URL directa, la lista
       todavía no llegó y decir «no existe» manda a buscar un bug que no hay. -->
  <p v-if="estadoDatos.estado === 'cargando'" class="perdido">Cargando…</p>
  <div v-else-if="!epica" class="perdido">
    <p>{{ estadoDatos.estado === 'sinServer' ? 'Sin server: no se pudieron leer las épicas.' : 'No existe esa épica.' }}</p>
    <RouterLink to="/" class="volver">← Todas las épicas</RouterLink>
  </div>

  <template v-else>
    <RouterLink to="/" class="volver">← Todas las épicas</RouterLink>

    <div class="cabeza">
      <div class="titulo">
        <h1>{{ epica.nombre }}</h1>
        <p class="meta">
          {{ epica.devs.length === 1 ? '1 persona' : `cuadrilla de ${epica.devs.length}` }}
          <template v-if="av.total"> · {{ fraccion(av.mergeadas, av.total) }}</template>
        </p>
      </div>
      <Barra v-if="av.total" :pct="av.pct" class="avance" />
      <button class="add" @click="editando = true">editar</button>
    </div>

    <!-- El contrato de la épica: dónde se toca y desde dónde sale todo el mundo. -->
    <div class="contrato">
      <span class="rot">Se toca en</span>
      <div class="repos">
        <!-- Repo y su base juntos: son un solo dato («este repo, desde esta rama»), y separarlos
             en dos listas obligaba a cruzarlas con la vista. -->
        <span v-for="r in repos" :key="r.nombre" class="repo" :class="{ sin: !r.n }"
              :title="r.n ? `${r.n} ${r.n === 1 ? 'rama' : 'ramas'}` : 'nadie lo ha agarrado'">
          <span class="mono nom">{{ r.nombre }}</span>
          <span class="mono desde">↰ {{ r.base }}</span>
          <i v-if="r.n" class="cnt">{{ r.n }}</i>
        </span>
        <span v-if="!repos.length" class="rot">— sin repos declarados</span>
      </div>
    </div>

    <p v-if="huerfanos" class="nadie">
      {{ huerfanos === 1 ? 'Hay 1 repo declarado que nadie agarró todavía.'
                         : `Hay ${huerfanos} repos declarados que nadie agarró todavía.` }}
    </p>

    <p v-if="vieja" class="trabe">
      <b>Lo más trabado:</b> <span class="mono">{{ vieja.rama }}</span> en
      <span class="mono">{{ vieja.repo }}</span> — {{ persona(vieja.autor).nombre }},
      abierto hace {{ dias(vieja.dias) }} y sin aprobar.
    </p>

    <div v-if="av.total" class="filtros">
      <button class="chip" :aria-pressed="filtro === 'todo'" @click="filtro = 'todo'">
        Todo <span class="n">{{ av.total }}</span>
      </button>
      <button v-for="(e, k) in ESTADOS" :key="k" class="chip"
              :aria-pressed="filtro === k" @click="filtro = k">
        {{ e.etiqueta }} <span class="n">{{ c[k] }}</span>
      </button>
    </div>

    <p v-if="!av.total" class="vacio-epica">
      Todavía nadie agregó una rama. Cada quien crea y pushea la suya desde la base que declaró el
      repo —{{ repos.map(r => `${r.nombre} desde ${r.base}`).join(' · ') }}— y después la busca con
      <b>agregar rama</b> en su card.
    </p>

    <div class="personas">
      <section v-for="p in visibles" :key="p.quien" class="persona">
        <header>
          <Avatar :quien="p.quien" :tam="32" />
          <div class="p-nom">
            <!-- El nombre lleva a su tarea: la página propia de lo que esa persona toca acá. -->
            <RouterLink :to="{ name: 'tarea', params: { id: epica.id, quien: p.quien } }" class="p-link">
              <b>{{ p.nombre }}</b>
            </RouterLink>
            <span class="p-frac">{{ p.total ? fraccion(p.mergeadas, p.total) : 'sin ramas todavía' }}</span>
          </div>
          <span v-if="p.esperando" class="badge aprobacion">
            {{ p.esperando }} {{ p.esperando === 1 ? 'espera' : 'esperan' }} · {{ dias(p.masDias) }}
          </span>
          <Barra :pct="p.pct" class="avance" />
          <!-- El botón vive acá, en la card de la persona: por eso el buscador ya sabe de quién
               es la rama y no vuelve a preguntar. -->
          <div class="acciones">
            <button class="add" @click="abriendo = p.quien">
              <span class="mas">＋</span> agregar rama
            </button>
            <button class="add doc" :class="{ tiene: p.doc }" @click="documentando = p.quien">
              <span v-if="p.doc" class="punto"></span><span v-else class="mas">＋</span>
              documentación
            </button>
          </div>
        </header>

        <ul v-if="p.ramas.length" class="ramas">
          <!-- La base contra la que se compara es la DEL REPO de esa rama, no una de la épica. -->
          <Rama v-for="r in p.ramas" :key="r.repo + r.rama" :r="r" :base="baseDe(epica, r.repo)"
                @quitar="quitar(r)" />
        </ul>
        <p v-else class="sin-ramas">Todavía no agregó ninguna rama a esta épica.</p>

        <!-- La doc se RENDERIZA acá, no se esconde tras el botón: existe para que la lea el resto,
             y una nota que hay que ir a buscar no la lee nadie. -->
        <div v-if="p.doc" class="doc-panel" :class="{ nueva: p.doc.nueva }">
          <div class="doc-head">
            <span class="rot">Documentación</span>
            <span class="cuando">actualizada {{ p.doc.dias === 0 ? 'hoy' : `hace ${dias(p.doc.dias)}` }}</span>
            <button class="editar" @click="documentando = p.quien">editar</button>
          </div>

          <!-- Sanitizado en `markdown.js` antes de llegar acá. -->
          <div class="doc-texto md-cuerpo" :class="{ recortado: !desplegada(p.quien) }"
               v-html="aHtml(p.doc.texto)"></div>

          <button v-if="hayMas(p.doc)" class="mas-doc" @click="alternarDoc(p.quien)">
            {{ desplegada(p.quien) ? 'leer menos' : 'leer más' }}
          </button>
        </div>
      </section>

      <p v-if="!visibles.length" class="vacio">Nadie tiene ramas en ese estado.</p>
    </div>

    <SumarRama :abierto="!!abriendo" :epica="epica" :quien="abriendo ?? ''"
               @agregar="agregar" @cerrar="abriendo = null" />
    <Documentar :abierto="!!documentando" :epica="epica" :quien="documentando ?? ''"
                @guardar="documentar" @cerrar="documentando = null" />
    <EditarEpica :abierto="editando" :epica="epica" @cerrar="editando = false" />
  </template>
</template>

<style scoped>
.volver{font-size:13px;color:var(--page-soft);text-decoration:none;display:inline-block;
  margin-bottom:14px}
.volver:hover{color:var(--page-ink)}
.perdido{padding:30px 0;color:var(--page-soft)}

.cabeza{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.titulo{flex:1;min-width:0}
.meta{font-size:13px;color:var(--page-soft);margin:6px 0 0}
.cabeza > .avance{flex:0 0 170px}

/* El contrato de la épica. Va arriba de todo lo demás porque es lo que se acordó ANTES de trabajar. */
.contrato{margin-top:18px;display:flex;align-items:center;gap:10px 18px;flex-wrap:wrap;
  background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px 13px}
.rot{font-size:11px;color:var(--page-tenue)}
.repos{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;flex:1}
.repo{font-size:12px;padding:2px 4px 2px 8px;border-radius:5px;border:1px solid var(--line);
  background:var(--panel);display:inline-flex;align-items:center;gap:7px;color:var(--page-soft)}
.repo.sin{border-style:dashed;color:var(--page-tenue);background:none}
.repo .nom{color:var(--page-ink)}
.repo.sin .nom{color:var(--page-tenue)}
/* La base va pegada al repo y en tono menor: es un atributo suyo, no otra etiqueta. */
.repo .desde{font-size:11px;color:var(--page-tenue);border-left:1px solid var(--line);
  padding:0 4px 0 7px}
.cnt{font-style:normal;font-size:10.5px;color:var(--page-tenue);padding-right:3px}
.nadie{margin:10px 0 0;font-size:12.5px;color:var(--page-tenue);padding-left:2px}

/* Sin bloque de color: una línea con el punto de estado alcanza. */
.trabe{margin:14px 0 0;padding:10px 13px;border-radius:8px;font-size:12.5px;line-height:1.55;
  border:1px solid var(--line);background:var(--panel-2);color:var(--page-soft)}
.trabe b{color:var(--warn);font-weight:500}
.trabe .mono{color:var(--page-ink)}

.filtros{display:flex;gap:7px;flex-wrap:wrap;margin-top:20px}

.vacio-epica{margin:16px 0 0;background:var(--panel-2);border:1px solid var(--line);
  border-radius:8px;padding:13px 15px;color:var(--page-soft);font-size:12.5px;line-height:1.65}
.vacio-epica b{color:var(--page-ink);font-weight:500}

.personas{margin-top:14px;display:flex;flex-direction:column;gap:10px}
.persona{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:13px 15px 14px;transition:border-color .15s}
.persona:hover{border-color:var(--line-fuerte)}
.persona header{display:flex;align-items:center;gap:10px 11px;flex-wrap:wrap}
/* min-width sobre el nombre: sin esto el flex lo encoge hasta partir «Miguel / Ochoa» en dos
   líneas antes de bajar los botones a la fila siguiente. Que baje lo que sobra, no el nombre. */
.p-nom{flex:1 1 auto;min-width:150px}
.p-nom b{font-size:14px;font-weight:500;display:block;line-height:1.35;white-space:nowrap}
.p-link{text-decoration:none;color:inherit}
.p-link:hover b{text-decoration:underline}
.p-frac{font-size:12px;color:var(--page-tenue);white-space:nowrap}
.persona .avance{flex:0 1 130px;min-width:90px}
/* Los dos botones se mueven juntos: partirlos en filas distintas se ve accidental. */
.acciones{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}

.add{font:inherit;font-size:12.5px;height:28px;padding:0 10px;border-radius:6px;
  border:1px solid var(--line);background:var(--panel);color:var(--page-soft);cursor:pointer;
  white-space:nowrap;display:inline-flex;align-items:center;gap:5px;
  transition:border-color .15s,color .15s}
.add:hover{border-color:var(--line-fuerte);color:var(--page-ink)}
.add .mas{font-size:13px;line-height:1}
/* Cuando ya hay documentación el botón lleva un punto lleno en vez del «＋»: se distingue de un
   vistazo quién dejó contexto y quién no, sin agregar otra etiqueta. */
.add.doc.tiene{color:var(--page-ink);border-color:var(--line-fuerte)}
.punto{width:6px;height:6px;border-radius:50%;background:var(--ok);flex:0 0 auto}

.doc-panel{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:var(--panel-2);
  padding:11px 13px}
.doc-panel.nueva{animation:entra .35s cubic-bezier(.2,.9,.3,1.1)}
@keyframes entra{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
.doc-head{display:flex;align-items:baseline;gap:9px;margin-bottom:7px}
.doc-head .rot{font-size:11.5px;color:var(--page-soft);font-weight:500}
.doc-head .cuando{font-size:11px;color:var(--page-tenue)}
.editar{margin-left:auto;background:none;border:none;font:inherit;font-size:11.5px;
  color:var(--page-soft);cursor:pointer;padding:0;text-decoration:underline}
.editar:hover{color:var(--page-ink)}
.doc-texto{margin:0;font-size:12.5px;line-height:1.65;color:var(--page-soft);white-space:pre-wrap}
/* Recorte a 2 líneas con line-clamp: corta por LÍNEA renderizada, no por cantidad de caracteres,
   así el corte cae donde el texto realmente se pasa y no a mitad de una palabra corta. */
.doc-texto.recortado{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;
  overflow:hidden;white-space:normal}
.mas-doc{margin-top:7px;background:none;border:none;padding:0;font:inherit;font-size:11.5px;
  color:var(--page-soft);cursor:pointer;text-decoration:underline}
.mas-doc:hover{color:var(--page-ink)}

ul.ramas{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:1px;
  border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--line)}
.sin-ramas{margin:10px 0 0;font-size:12.5px;color:var(--page-tenue)}
</style>
