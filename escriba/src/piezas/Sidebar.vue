<script setup>
/* Las dos preguntas que uno se hace acá, una por pestaña:
 *
 *   REGLAS  — el porqué, para leerlo de corrido. Cada una dice además si el oído sirve para algo,
 *             que es la meta-lección: saber CUÁNDO escuchar ayuda y cuándo es perder el tiempo.
 *   LO MÍO  — lo que vas fallando. Sale del uso y no de una lista, que es lo que lo hace servir.
 *
 * La primera la podría imprimir un papel. La segunda no existe hasta que practicás.
 */
import { computed, ref } from 'vue'
import { estado, alternarSabido, olvidarTodo, reglaDe, sabido } from '../memoria.js'
import { fichas } from '../ejercicio.js'

const props = defineProps({ reglas: Array })
const pestana = ref('reglas')
const abierta = ref(null)
const filtro = ref('')

const OIDO = { decide: 'el oído decide', ayuda: 'el oído ayuda a medias', no: 'el oído no ayuda' }

const coincide = (t) => {
  const q = filtro.value.trim().toLowerCase()
  return !q || String(t).toLowerCase().includes(q)
}

const conMarca = computed(() =>
  props.reglas
    .map((r) => ({ ...r, marca: reglaDe(r.id), n: (r.items ?? []).length }))
    .filter((r) => coincide(r.titulo + ' ' + r.resumen + ' ' + r.regla)))

/* Lo fallado, de todas las reglas y ordenado por cuánto costó. Lo marcado «ya la sé» baja al final
   en vez de desaparecer: la cuenta es la evidencia de cuánto costó y sirve si se vuelve a caer. */
const mio = computed(() => {
  const vistas = new Set()
  return fichas(props.reglas)
    .filter((f) => !vistas.has(f.clave) && vistas.add(f.clave))
    .map((f) => ({ ...f, marca: estado.items[f.clave] ?? { bien: 0, mal: 0 }, sab: sabido(f.clave) }))
    .filter((f) => f.marca.mal > 0 && coincide(f.va + ' ' + f.porque))
    .sort((a, b) => a.sab - b.sab || b.marca.mal - a.marca.mal)
})

const pendientes = computed(() => mio.value.filter((f) => !f.sab).length)
const pct = (m) => (m.bien + m.mal ? Math.round((100 * m.bien) / (m.bien + m.mal)) : null)
</script>

<template>
  <aside class="side">
    <nav class="tabs">
      <button class="ctl" :aria-pressed="pestana === 'reglas'" @click="pestana = 'reglas'">
        Reglas <span class="n">{{ reglas.length }}</span>
      </button>
      <button class="ctl" :aria-pressed="pestana === 'mio'" @click="pestana = 'mio'">
        Lo mío <span class="n">{{ pendientes }}</span>
      </button>
    </nav>

    <input v-model="filtro" class="buscar" type="search" placeholder="filtrar…" spellcheck="false">

    <div class="lista">
      <template v-if="pestana === 'reglas'">
        <p class="ayuda">
          Nueve familias. Tocá una para leerla entera — está escrita para entenderla, no para
          memorizarla.
        </p>
        <div v-for="r in conMarca" :key="r.id" class="fila">
          <button class="cab" :aria-expanded="abierta === r.id"
                  @click="abierta = abierta === r.id ? null : r.id">
            <span class="tit">{{ r.titulo }}</span>
            <span v-if="pct(r.marca) !== null" class="pct" :data-flojo="pct(r.marca) < 70">
              {{ pct(r.marca) }}%
            </span>
            <span v-else class="pct tenue">{{ r.n }}</span>
          </button>
          <div class="res tenue">{{ r.resumen }}</div>
          <template v-if="abierta === r.id">
            <p class="cuerpo">{{ r.regla }}</p>
            <p class="oido" :data-tono="r.seOye">{{ OIDO[r.seOye] }} — {{ r.oido }}</p>
          </template>
        </div>
      </template>

      <template v-else>
        <p class="ayuda">
          Lo que fallaste alguna vez, de más a menos. No es una lista que alguien eligió: sale de lo
          que hiciste.
        </p>
        <p v-if="!mio.length" class="vacio">
          Todavía nada. Hacé una vuelta y lo que se te escape aparece acá con su regla.
        </p>
        <div v-for="f in mio" :key="f.clave" class="fila" :class="{ hecha: f.sab }">
          <div class="cab estatica">
            <span class="tit">{{ f.va }}</span>
            <span class="vz">{{ f.marca.mal }}</span>
            <button class="se" :aria-pressed="f.sab" @click="alternarSabido(f.clave)">
              {{ f.sab ? '✓' : 'ya la sé' }}
            </button>
          </div>
          <div class="cuerpo chico">{{ f.porque }}</div>
        </div>
        <button v-if="mio.length" class="ctl borrar" @click="olvidarTodo()">
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

.lista{flex:1;min-height:0;overflow-y:auto;padding:0 12px 24px}  /* min-height:0 o no scrollea */
.ayuda{font-size:11.5px;line-height:1.55;color:var(--page-tenue);margin:0 0 12px;
  padding-bottom:10px;border-bottom:1px solid var(--line)}
.vacio{font-size:12.5px;color:var(--page-tenue);line-height:1.6}

.fila{padding:8px 0;border-bottom:1px solid var(--line)}
.fila.hecha{opacity:.5}
.cab{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:0;background:none;
  cursor:pointer;font:inherit;color:inherit;text-align:left}
.cab.estatica{cursor:default}
.tit{font-weight:600;font-size:13px;letter-spacing:-.01em;flex:1;min-width:0}
/* El porcentaje sólo aparece cuando ya practicaste esa regla: un 0% de arranque diría algo falso. */
.pct{font-size:11px;color:var(--va);flex:none}
.pct[data-flojo="true"]{color:var(--falla)}
.vz{font-size:11px;color:var(--falla);background:var(--soft-bg2);border-radius:9px;padding:1px 6px}
.se{border:0;background:none;padding:0 0 0 6px;cursor:pointer;font:inherit;font-size:11px;
  color:var(--page-tenue)}
.se:hover{color:var(--page-ink)}
.se[aria-pressed="true"]{color:var(--va)}

.res{font-size:11.5px;line-height:1.45;margin-top:2px}
.cuerpo{font-size:12.5px;line-height:1.6;color:var(--page-soft);margin:9px 0 0;
  padding-left:9px;border-left:2px solid var(--regla)}
.cuerpo.chico{font-size:12px;margin-top:4px}
.oido{font-size:11.5px;line-height:1.55;margin:8px 0 2px;color:var(--page-tenue)}
.oido[data-tono="decide"]{color:var(--va)}
.borrar{margin-top:14px;width:100%;justify-content:center}
</style>
