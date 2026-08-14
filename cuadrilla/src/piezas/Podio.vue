<script setup>
import { computed } from 'vue'
import { persona, podio, aprobacionesTotales } from '../datos.js'
import Avatar from './Avatar.vue'

/* Reconocimiento a quienes sostienen la revisión del equipo.

   Ordena por PRs aprobados, pero al lado de cada uno van dos datos más y no de adorno: cuántas
   líneas miró y en cuántos días respondió. Un ranking de aprobaciones a secas premia al que pasa
   el sello sin leer, que es lo contrario de lo que esto quiere reconocer. Las tres cifras se
   muestran juntas y NO se combinan en un puntaje: eso lo juzga quien mira.

   Las alturas son PROPORCIONALES a las aprobaciones, no escalones fijos de podio. Con escalones,
   1 y 2 aprobaciones se ven como un abismo; proporcional, la forma dice la verdad. */
const filas = computed(() => podio())
const total = computed(() => aprobacionesTotales())
const tope = computed(() => Math.max(1, ...filas.value.map(f => f.n)))

const conPuesto = computed(() => filas.value.map((f, i) => ({ ...f, puesto: i + 1 })))

/* Los tres primeros en el orden clásico 2 · 1 · 3: el del medio es el más alto y así se lee como
   podio sin necesidad de explicarlo. Con menos de tres, se muestra lo que hay. */
const tres = computed(() => {
  const t = conPuesto.value.slice(0, 3)
  return [t[1], t[0], t[2]].filter(Boolean)
})
const resto = computed(() => conPuesto.value.slice(3))

// 40px de piso para que el último no quede como una línea sin lugar para el número.
const alto = f => `${40 + Math.round(f.n / tope.value * 76)}px`
const nombre = f => persona(f.quien).nombre.split(' ')[0]
</script>

<template>
  <section class="panel">
    <header>
      <h2>Quién revisa</h2>
      <span class="ph">aprobar PRs es sostener al equipo</span>
      <span v-if="total" class="tot">{{ total }} {{ total === 1 ? 'aprobación' : 'aprobaciones' }}</span>
    </header>

    <div v-if="tres.length" class="podio">
      <div v-for="f in tres" :key="f.quien" class="col" :class="{ primero: f.puesto === 1 }">
        <span class="n">{{ f.n }}</span>
        <Avatar :quien="f.quien" :tam="f.puesto === 1 ? 34 : 28" />
        <span class="nombre">{{ nombre(f) }}</span>
        <div class="barra" :style="{ height: alto(f) }">
          <span class="puesto">{{ f.puesto }}</span>
        </div>
        <!-- Las líneas solo si se conocen: un «0 líneas» junto a alguien que sí revisó se lee como
             que no hizo nada, y el que no sabe es el tablero. -->
        <span class="detalle">
          <template v-if="f.lineas">{{ f.lineas.toLocaleString('es') }} líneas · </template>
          {{ f.demora === 1 ? '1 día' : `${f.demora} días` }}
        </span>
      </div>
    </div>

    <!-- Del cuarto en adelante, en una línea: el podio destaca, pero nadie desaparece del tablero. -->
    <ul v-if="resto.length" class="resto">
      <li v-for="f in resto" :key="f.quien">
        <Avatar :quien="f.quien" :tam="18" />
        <span>{{ nombre(f) }}</span>
        <i>{{ f.n }}</i>
      </li>
    </ul>

    <p v-if="!tres.length" class="vacio">
      Todavía nadie aprobó un PR. Sale de <b>quién aprobó</b> en GitHub, así que aparece cuando la
      GitHub App esté conectada — o simulándolo con
      <span class="mono">npm run simular -- aprobar</span>.
    </p>
  </section>
</template>

<style scoped>
.panel{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:14px 16px 16px}
header{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
h2{font-size:12.5px;font-weight:500;margin:0;color:var(--page-ink)}
.ph{font-size:11.5px;color:var(--page-tenue)}
.tot{font-size:11.5px;color:var(--page-tenue);margin-left:auto}

/* `align-items:flex-end` es lo que hace el podio: las columnas se apoyan en la misma base y solo
   varía su alto. */
.podio{display:flex;align-items:flex-end;justify-content:center;gap:26px;margin-top:18px}
.col{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;flex:0 1 130px}
.n{font-size:17px;font-weight:600;color:var(--page-ink);letter-spacing:-.03em;line-height:1}
.primero .n{font-size:22px}
.nombre{font-size:12px;color:var(--page-soft);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;max-width:100%}
.primero .nombre{color:var(--page-ink);font-weight:500;font-size:12.5px}

/* El escalón. Gris para el 2° y 3°, contraste pleno para el 1°: en esta app el color significa
   estado, así que destacar al primero con color lo haría parecer una alerta. */
.barra{width:100%;border-radius:6px 6px 0 0;background:var(--soft-bg2);
  display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;
  transition:height .5s cubic-bezier(.4,0,.2,1)}
.primero .barra{background:var(--page-ink)}
.puesto{font-size:11px;font-weight:600;color:var(--page-tenue)}
.primero .puesto{color:var(--page)}

.detalle{font-size:10.5px;color:var(--page-tenue);text-align:center;line-height:1.4}

.resto{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line);
  display:flex;gap:16px;flex-wrap:wrap;justify-content:center}
.resto li{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--page-soft)}
.resto i{font-style:normal;font-weight:600;color:var(--page-ink)}

.vacio{margin:12px 0 0;font-size:11.5px;color:var(--page-tenue);line-height:1.6}
.vacio b{color:var(--page-ink);font-weight:500}

@media (max-width:520px){
  .podio{gap:12px}
  .col{flex:1 1 0}
  .detalle{display:none}
}
</style>
