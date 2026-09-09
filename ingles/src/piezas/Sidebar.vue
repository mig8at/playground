<script setup>
/* Las tres preguntas que uno se hace mientras lee, una por pestaña:
 *   LAS 100    — el vocabulario fijo, el que no cambia entre historias
 *   ESTA       — lo que ESTA historia agrega encima (y por eso puede crecer o achicarse)
 *   REPASAR    — lo que miraste, ordenado por cuántas veces. Sale del uso, no de una lista
 *
 * La tercera es la que justifica el contador. Las otras dos las podría imprimir un papel.
 */
import { computed, ref } from 'vue'
import { decir, hayVoz } from '../voz.js'
import { estado, veces, sabida, alternarSabida, olvidarTodo } from '../memoria.js'

const props = defineProps({ core: Object, lex: Object, usadas: Object, global: Object })
const pestana = ref('cien')
const filtro = ref('')

const coincide = (e) => {
  const q = filtro.value.trim().toLowerCase()
  return !q || e.en.toLowerCase().includes(q) || e.es.toLowerCase().includes(q)
}

const cien = computed(() =>
  props.core.palabras
    .map((p) => ({ en: p.en, es: p.es, nota: p.nota, tipo: 'core',
                   enHistoria: props.usadas.has(p.en.toLowerCase()) }))
    .filter(coincide))

const deLaHistoria = computed(() => {
  const orden = { sentido: 0, frase: 1, nueva: 2 }
  return [...props.lex.palabras.values(), ...props.lex.frases.values(), ...props.lex.huecos]
    .filter((e) => e.tipo !== 'core')
    .sort((a, b) => (orden[a.tipo] - orden[b.tipo]) || a.en.localeCompare(b.en))
    .filter(coincide)
})

/* Ordenado por cuántas veces se miró, de más a menos: arriba queda lo que más cuesta. Las marcadas
   «ya la sé» bajan al final en vez de desaparecer — el contador es la evidencia de cuánto costó, y
   si una se vuelve a caer conviene poder verla. */
const repasar = computed(() => {
  // El glosario GLOBAL, no el de la historia abierta: lo que costó en otra historia sigue costando.
  const todas = props.global
  return Object.entries(estado.vistas)
    .filter(([, n]) => n > 0)
    .map(([clave, n]) => ({ clave, n, sab: sabida(clave), e: todas.get(clave) }))
    .filter((r) => r.e && coincide(r.e))
    .sort((a, b) => (a.sab - b.sab) || (b.n - a.n))
})

const conteos = computed(() => {
  const de = (t) => deLaHistoria.value.filter((e) => e.tipo === t).length
  return { nuevas: de('nueva'), frases: de('frase') + props.lex.huecos.length, sentidos: de('sentido') }
})
</script>

<template>
  <aside class="side">
    <nav class="tabs">
      <button class="ctl" :aria-pressed="pestana==='cien'"  @click="pestana='cien'">Las 100</button>
      <button class="ctl" :aria-pressed="pestana==='hist'"  @click="pestana='hist'">
        Esta <span class="n">{{ deLaHistoria.length }}</span>
      </button>
      <button class="ctl" :aria-pressed="pestana==='rep'"   @click="pestana='rep'">
        Repasar <span class="n">{{ repasar.filter(r=>!r.sab).length }}</span>
      </button>
    </nav>

    <input v-model="filtro" class="buscar" type="search" placeholder="filtrar…" spellcheck="false">

    <div class="lista">
      <template v-if="pestana==='cien'">
        <p class="ayuda">
          Las mismas en todas las historias. En <b>negro</b> las que aparecen en ésta; las grises
          todavía no te han salido.
        </p>
        <div v-for="e in cien" :key="e.en" class="fila" :class="{ ausente: !e.enHistoria }">
          <div class="l1">
            <span class="en">{{ e.en }}</span>
            <button v-if="hayVoz()" class="son" @click="decir(e.en)">♪</button>
            <span v-if="veces(e.en.toLowerCase())" class="vz">{{ veces(e.en.toLowerCase()) }}</span>
          </div>
          <div class="es">{{ e.es }}</div>
          <div v-if="e.nota" class="nt">{{ e.nota }}</div>
        </div>
      </template>

      <template v-else-if="pestana==='hist'">
        <p class="ayuda">
          Lo que esta historia agrega: <b>{{ conteos.nuevas }}</b> palabras nuevas,
          <b>{{ conteos.frases }}</b> expresiones y <b>{{ conteos.sentidos }}</b> palabras del núcleo
          usadas con otro sentido.
        </p>
        <div v-for="e in deLaHistoria" :key="e.en" class="fila">
          <div class="l1">
            <span class="en" :data-tipo="e.tipo">{{ e.en }}</span>
            <button v-if="hayVoz()" class="son" @click="decir(e.en)">♪</button>
            <span v-if="veces(e.en.toLowerCase())" class="vz">{{ veces(e.en.toLowerCase()) }}</span>
          </div>
          <div class="es">{{ e.es }}</div>
          <div v-if="e.nota" class="nt">{{ e.nota }}</div>
        </div>
      </template>

      <template v-else>
        <p class="ayuda">
          Ordenadas por cuántas veces tuviste que mirarlas. Sale de lo que hiciste, no de una lista —
          y se acumula entre historias.
        </p>
        <p v-if="!repasar.length" class="vacio">
          Todavía nada. Pasá el mouse por el texto y las que consultes aparecen acá.
        </p>
        <div v-for="r in repasar" :key="r.clave" class="fila" :class="{ hecha: r.sab }">
          <div class="l1">
            <span class="en" :data-tipo="r.e.tipo">{{ r.e.en }}</span>
            <button v-if="hayVoz()" class="son" @click="decir(r.e.en)">♪</button>
            <span class="vz fuerte">{{ r.n }}</span>
            <button class="se" :aria-pressed="r.sab" @click="alternarSabida(r.clave)">
              {{ r.sab ? '✓' : 'ya la sé' }}
            </button>
          </div>
          <div class="es">{{ r.e.es }}</div>
        </div>
        <button v-if="repasar.length" class="ctl borrar" @click="olvidarTodo()">
          borrar todo lo contado
        </button>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.side{display:flex;flex-direction:column;height:100%;min-height:0;border-right:1px solid var(--line);
  background:var(--panel-2);min-width:0}
.tabs{display:flex;gap:6px;padding:12px 12px 8px;flex-wrap:wrap}
.tabs .n{opacity:.5;font-weight:400}
.buscar{margin:0 12px 10px;font:inherit;font-size:12.5px;height:28px;padding:0 9px;
  border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--page-ink)}
.buscar:focus{outline:none;border-color:var(--line-fuerte)}

.lista{flex:1;min-height:0;overflow-y:auto;padding:0 12px 24px}  /* min-height:0 o no scrollea (ver App.vue) */
.ayuda{font-size:11.5px;line-height:1.55;color:var(--page-tenue);margin:0 0 12px;
  padding-bottom:10px;border-bottom:1px solid var(--line)}
.vacio{font-size:12.5px;color:var(--page-tenue);line-height:1.6}

.fila{padding:7px 0;border-bottom:1px solid var(--line)}
.fila.ausente{opacity:.42}
.fila.hecha{opacity:.5}
.l1{display:flex;align-items:center;gap:6px}
.en{font-weight:600;font-size:13px;letter-spacing:-.01em}
.en[data-tipo="nueva"]{color:var(--nueva)}
.en[data-tipo="frase"]{color:var(--frase)}
.en[data-tipo="sentido"]{color:var(--sentido)}
.son{border:0;background:none;color:var(--page-tenue);cursor:pointer;font-size:13px;padding:0;
  line-height:1;transition:color .15s}
.son:hover{color:var(--accent)}
/* El contador vive pegado a la palabra y no en una columna aparte: así se lee «esta me costó 5», */
/* que es la frase que uno quiere, y no una tabla que hay que cruzar con la vista.               */
.vz{margin-left:auto;font-size:11px;color:var(--page-tenue);
  background:var(--soft-bg2);border-radius:9px;padding:1px 6px;min-width:20px;text-align:center}
.vz.fuerte{color:var(--nueva);font-weight:600}
.se{border:0;background:none;padding:0 0 0 6px;cursor:pointer;font:inherit;font-size:11px;
  color:var(--page-tenue)}
.se:hover{color:var(--page-ink)}
.se[aria-pressed="true"]{color:var(--sentido)}
.es{font-size:12.5px;line-height:1.5;color:var(--page-soft);margin-top:1px}
.nt{font-size:11.5px;line-height:1.5;color:var(--page-tenue);margin-top:3px}
.borrar{margin-top:14px;width:100%;justify-content:center}
</style>
