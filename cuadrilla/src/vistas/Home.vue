<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { EPICAS, avance, conteo, masVieja, crearEpica, basesDistintas, estadoDatos, dias, fraccion, enumerar } from '../datos.js'
import Pila from '../piezas/Pila.vue'
import Barra from '../piezas/Barra.vue'
import Resumen from '../piezas/Resumen.vue'
import NuevaEpica from '../piezas/NuevaEpica.vue'

const router = useRouter()
const modal = ref(false)

const gente = computed(() => new Set(EPICAS.flatMap(e => e.devs)).size)

function tarjeta(e){
  return { ...avance(e), ...conteo(e), quien: enumerar(e.devs), vieja: masVieja(e) }
}

async function nueva(nombre, devs, repos){
  const e = await crearEpica(nombre, devs, repos)
  modal.value = false
  router.push({ name: 'epica', params: { id: e.id } })   // entrás directo a la que acabás de crear
}
</script>

<template>
  <div class="tope">
    <div>
      <h1>Épicas</h1>
      <p class="sub">
        <b>{{ EPICAS.length }}</b> {{ EPICAS.length === 1 ? 'épica' : 'épicas' }} ·
        <b>{{ gente }}</b> {{ gente === 1 ? 'persona' : 'personas repartidas' }}
      </p>
    </div>
    <button class="primary" @click="modal = true"><span class="mas">＋</span> Nueva épica</button>
  </div>

  <Resumen class="resumen" />

  <p v-if="estadoDatos.estado === 'sinServer'" class="sin-server">
    No se pudieron leer las épicas: el server no responde. Levantalo con <span class="mono">npm run dev</span>.
  </p>

  <div class="grid">
    <RouterLink v-for="e in EPICAS" :key="e.id" class="epica" :class="{ recien: e.nueva }"
                :to="{ name: 'epica', params: { id: e.id } }">
      <div class="cuerpo">
        <div class="l1">
          <h3>{{ e.nombre }}</h3>
          <span class="flecha">↗</span>
        </div>

        <!-- Con una base por repo, la card muestra la única si todos coinciden y avisa «bases
             mixtas» si no. Poner la primera y callar el resto haría creer que salen todos de ahí. -->
        <p class="meta mono">
          {{ e.repos?.length ?? 0 }} {{ e.repos?.length === 1 ? 'repo' : 'repos' }}
          <template v-if="basesDistintas(e).length === 1">
            <span class="sep">·</span> {{ basesDistintas(e)[0] }}
          </template>
          <template v-else-if="basesDistintas(e).length > 1">
            <span class="sep">·</span> {{ basesDistintas(e).length }} bases
          </template>
          <template v-if="e.ramas.length">
            <span class="sep">·</span> {{ e.ramas.length }} {{ e.ramas.length === 1 ? 'rama' : 'ramas' }}
          </template>
        </p>

        <p class="estado">
          <span v-if="tarjeta(e).vieja" class="badge aprobacion">
            {{ dias(tarjeta(e).vieja.dias) }} esperando aprobación
          </span>
          <span v-else-if="tarjeta(e).total && tarjeta(e).pct === 100" class="badge mergeada">
            todo mergeado
          </span>
          <span v-else-if="tarjeta(e).total" class="badge desarrollo">
            {{ tarjeta(e).desarrollo }} en desarrollo
          </span>
          <span v-else class="badge desarrollo">sin ramas todavía</span>
        </p>

        <div class="gente">
          <Pila :devs="e.devs" :tam="24" />
          <span class="nombres">{{ tarjeta(e).quien }}</span>
        </div>
      </div>

      <!-- El avance va al pie, pegado al borde: la card se lee de arriba abajo y termina en el dato
           que resume todo. Y la fracción al lado del %, para que el número nunca sea magia. -->
      <div class="pie">
        <span class="frac">{{ tarjeta(e).total ? fraccion(tarjeta(e).mergeadas, tarjeta(e).total) : '—' }}</span>
        <Barra :pct="tarjeta(e).pct" />
      </div>
    </RouterLink>

    <button class="agregar" @click="modal = true">
      <span class="mas">＋</span>
      <span>Nueva épica</span>
    </button>
  </div>

  <!-- El descargo sigue, pero como pie de página y en una línea: sacarlo del todo sería mentir
       sobre de dónde salen estos números; ocupar seis renglones arriba era peor. -->
  <p class="pie-mock">
    Prototipo del 12 ago 2026. Las <b>épicas se guardan de verdad</b>, en SQLite
    (<span class="mono">cuadrilla.db</span>). Lo que sigue siendo de mentira es el catálogo del que
    se elige: los repos, la gente y las ramas de <span class="mono">origin</span> salen de una lista
    fija —tomada de <span class="mono">git for-each-ref</span> el 10 ago— y el estado de cada rama
    (PR, días, mergeada) todavía no lo lee nadie de GitHub.
  </p>

  <NuevaEpica :abierto="modal" @crear="nueva" @cerrar="modal = false" />
</template>

<style scoped>
.tope{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.tope > div{flex:1;min-width:0}
.sub{color:var(--page-soft);font-size:13px;margin:6px 0 0}
.sub b{color:var(--page-ink);font-weight:500}
.primary .mas{font-size:14px;line-height:1}

.resumen{margin-top:18px}
.grid{margin-top:12px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(288px,1fr))}
.sin-server{margin:16px 0 0;font-size:12.5px;color:var(--bad);line-height:1.6}
.pie-mock{margin:22px 0 0;font-size:11.5px;color:var(--page-tenue);line-height:1.6;max-width:80ch}
.pie-mock b{color:var(--page-soft);font-weight:500}

/* Card plana: sin sombra y sin levantarse al pasar. Lo único que cambia en hover es el borde —
   el movimiento distrae en una reja de seis. */
.epica{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  text-decoration:none;color:inherit;display:flex;flex-direction:column;overflow:hidden;
  transition:border-color .15s}
.epica:hover{border-color:var(--line-fuerte)}
.epica.recien{animation:entra .35s cubic-bezier(.2,.9,.3,1.1)}
@keyframes entra{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

.cuerpo{padding:15px 16px 14px;display:flex;flex-direction:column;gap:9px;flex:1}
.l1{display:flex;align-items:flex-start;gap:10px}
h3{font-size:15px;font-weight:500;margin:0;line-height:1.4;flex:1}
.flecha{font-size:13px;color:var(--page-tenue);opacity:0;transition:opacity .15s;line-height:1.4}
.epica:hover .flecha{opacity:1;color:var(--page-soft)}

.meta{font-size:12px;color:var(--page-tenue);margin:0}
.meta .sep{opacity:.5;margin:0 2px}
.estado{margin:0}

.gente{display:flex;align-items:center;gap:9px;margin-top:auto;padding-top:4px}
.nombres{font-size:12.5px;color:var(--page-soft);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}

.pie{border-top:1px solid var(--line);background:var(--panel-2);padding:10px 16px;
  display:flex;align-items:center;gap:12px}
.frac{font-size:11.5px;color:var(--page-tenue);white-space:nowrap;flex:0 0 auto}
.pie :deep(.med){flex:1}

.agregar{background:none;border:1px dashed var(--line);border-radius:10px;min-height:150px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
  color:var(--page-tenue);cursor:pointer;font:inherit;font-size:13px;
  transition:border-color .15s,color .15s}
.agregar:hover{border-color:var(--line-fuerte);color:var(--page-ink)}
.agregar .mas{font-size:20px;line-height:1;font-weight:300}
</style>
