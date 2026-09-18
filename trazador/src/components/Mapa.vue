<script setup>
// EL MAPA: el recorrido de UNA solicitud como grafo, y dónde se cortó.
//
// POR QUÉ EXISTE, al lado de `Etapas.vue` y no en su lugar. La lista contesta muy bien «¿qué pasó en
// cada etapa?» — estado, hora, salto, y al abrirla sus sub-pasos. Lo que una lista vertical no puede
// dar son tres cosas, y las tres son de diagnóstico:
//
//   1. LA FORMA. Nueve filas no muestran que esta solicitud fue por un carril y que había otros tres.
//      El ramal se ve acá arriba, y las etapas que en ese carril NO OCURREN se dibujan atenuadas en vez
//      de desaparecer: «no pasó por ahí» y «ahí no se pasa nunca» son diagnósticos opuestos.
//   2. CUÁNTO FALTABA. Un nodo rojo con cuatro grises detrás dice «murió a mitad» de un vistazo; cuatro
//      filas con `·` no dicen nada — se leen igual que el final de un flujo que terminó bien.
//   3. EL TIEMPO COMO DISTANCIA. El salto entre etapas hoy es un `+40m` en texto. Acá es el LARGO de la
//      arista, así que un hueco largo se ve antes de leerse — y ese hueco es justo la diferencia entre
//      «el cliente estaba pensando» y «algo se quedó colgado».
//
// ⚠ NO ES EL MAPA DEL HARNESS, y copiarlo hubiera sido el error. Aquél dibuja las 26 PANTALLAS que un
// comercio PUEDE recorrer; éste, las 9 ETAPAS DE NEGOCIO que UNA solicitud recorrió de verdad. Lo único
// que comparten a propósito es el vocabulario de ramales (`creditopx` · `agregador` · `redirect`), que
// ya estaba compartido en `ramales.json` — dos vocabularios para lo mismo es como empiezan a derivar.
//
// ⚠ Y LA REGLA DE `Etapas.vue` SE RESPETA IGUAL: se atenúa lo que NO EXISTE, nunca lo que está VACÍO.
// Una etapa sin evidencia es justo donde el flujo se pudo cortar; despintarla convierte la herramienta
// en una que nunca muestra el problema.
import { computed, ref, watch, onMounted } from 'vue'
import { useTrazador } from '../stores/trazador'

const t = useTrazador()

const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~',
  'no-aplica':'∅', condicional:'·', pendiente:'·' }
// El color es el mismo que usa la lista: dos escalas para el mismo estado sería otra cosa que
// desincronizar, y además el ojo ya aprendió ésta.
const COLOR = { ok:'var(--ok)', warn:'var(--warn)', fail:'var(--fail)', skip:'var(--skip)',
  'sin-evidencia':'var(--unknown)', 'sin-registro':'var(--skip)', 'no-aplica':'var(--skip)',
  condicional:'var(--skip)', pendiente:'var(--skip)' }

const ANCHO = 210, ALTO = 34, X = 96, BASE = 30   // el nodo, y la separación mínima entre dos etapas

// El detalle entra en 210px a 11px de system-ui: ~34 caracteres. Cortar en 30 a secas partía palabras
// («ramal credifami») y perdía el final de frases que sí entraban. Se corta en el último espacio.
const corto = (txt) => {
  const s = String(txt || '')
  if (s.length <= 34) return s
  const c = s.slice(0, 34)
  const i = c.lastIndexOf(' ')
  return (i > 20 ? c.slice(0, i) : c) + '…'
}

const aMin = (hhmmss) => {
  if (!hhmmss) return null
  const [h, m, s] = String(hhmmss).split(':').map(Number)
  return h * 60 + m + (s || 0) / 60
}

// EL LARGO DE LA ARISTA NO ES PROPORCIONAL AL TIEMPO, y tiene que no serlo: una solicitud retomada al
// día siguiente tiene un salto de 900 minutos y con escala lineal el mapa mediría diez pantallas de
// alto, que es peor que no dibujarlo. Va por logaritmo y con tope, así que la diferencia entre 2 y 40
// minutos se ve —que es la que importa— y la de 40 a 900 se satura, con el número al lado para el que
// quiera el dato exacto.
const largoDelSalto = (min) => (min === null || min < 1 ? 0 : Math.min(60, Math.round(18 * Math.log10(1 + min))))

const nodos = computed(() => {
  const es = t.etapas
  if (!es.length) return []
  const out = []
  let y = 26, previa = null
  for (const e of es) {
    const ahora = aMin(e.vivo?.at)
    let saltoMin = null
    if (ahora !== null && previa !== null && ahora - previa >= 1) saltoMin = Math.round(ahora - previa)
    if (ahora !== null) previa = ahora
    const extra = largoDelSalto(saltoMin)
    y += (out.length ? BASE + extra : 0)
    out.push({
      ...e, y, saltoMin, extra,
      // Los subs se dibujan como puntos a la derecha: es el grano que hace que «se rompió en listado»
      // pase a «se rompió consultando ESTA entidad» sin abrir nada.
      subs: (e.vivo?.subs || []).slice(0, 7),
      subsDe: (e.vivo?.subs || []).length,
      roto: t.traza?.brokeAt === e.id,
    })
    y += ALTO
  }
  return out
})

const alto = computed(() => (nodos.value.length ? nodos.value[nodos.value.length - 1].y + ALTO + 26 : 200))

// Qué etapas NO ocurren en el ramal que esta solicitud tomó. Sale del mapa declarado, no de la traza:
// es una afirmación sobre el flujo, no sobre este caso.
const ramal = computed(() => (t.mapa?.ramales || []).find((r) => r.id === t.traza?.ramal) || null)

// ── LA CÁMARA ────────────────────────────────────────────────────────────────────────────────────
const cam = ref({ x: 0, y: 0, k: 1, w: 0, h: 0 })
const lienzo = ref(null)
const arrastrando = ref(false)

function encuadrar() {
  const el = lienzo.value
  if (!el) return
  const w = el.clientWidth, h = el.clientHeight
  if (!w || !h) return                       // antes del primer layout: un scale(NaN) borra el dibujo
  const k = Math.min(1.1, (h - 20) / alto.value)
  cam.value = { ...cam.value, w, h, k, x: (w - (X + ANCHO + 150) * k) / 2, y: 10 }
}
onMounted(() => { encuadrar(); new ResizeObserver(encuadrar).observe(lienzo.value) })
// ⚠ LA CLAVE ES UN STRING: con `() => [ureq, largo]` el getter devuelve un ARRAY NUEVO en cada
// evaluación y Vue compara por referencia, así que el watcher se dispara en cada re-render en vez de
// cuando cambió la traza. (No era la causa del zoom muerto —esa está abajo, en el CSS— pero re-encuadrar
// de más es igual de falso.)
watch(() => `${t.traza?.ureq}:${nodos.value.length}`, encuadrar)

function rueda(ev) {
  ev.preventDefault()
  const k = Math.min(2.4, Math.max(0.35, cam.value.k * (ev.deltaY < 0 ? 1.12 : 0.89)))
  // Zoom hacia el cursor: si no, acercarse aleja lo que estabas mirando.
  const r = lienzo.value.getBoundingClientRect()
  const mx = ev.clientX - r.left, my = ev.clientY - r.top
  const f = k / cam.value.k
  cam.value = { ...cam.value, k, x: mx - (mx - cam.value.x) * f, y: my - (my - cam.value.y) * f }
}
function abajo(ev) {
  arrastrando.value = true
  const x0 = ev.clientX - cam.value.x, y0 = ev.clientY - cam.value.y
  const mover = (e) => { cam.value = { ...cam.value, x: e.clientX - x0, y: e.clientY - y0 } }
  const soltar = () => { arrastrando.value = false; removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar) }
  addEventListener('pointermove', mover); addEventListener('pointerup', soltar)
}
</script>

<template>
  <div class="mapa" ref="lienzo" @wheel="rueda" @pointerdown.self="abajo" @dblclick="encuadrar"
       :class="{ move: arrastrando }">
    <div v-if="!nodos.length" class="vacio">el mapa se dibuja al cargar una solicitud</div>

    <svg v-else :width="cam.w" :height="cam.h">
      <g :transform="`translate(${cam.x},${cam.y}) scale(${cam.k})`">
        <!-- LAS ARISTAS primero, para que los nodos queden encima -->
        <g v-for="(n, i) in nodos.slice(1)" :key="'a'+n.id">
          <line :x1="X - 30" :y1="nodos[i].y + ALTO" :x2="X - 30" :y2="n.y"
                :stroke="n.estado === 'pendiente' || n.estado === 'no-aplica' ? 'var(--line)' : COLOR[nodos[i].estado]"
                stroke-width="2" :stroke-dasharray="n.estado === 'no-aplica' ? '3 4' : null" />
          <!-- El salto SÓLO cuando lo hay: un «+0m» en cada arista es ruido que tapa los que importan -->
          <text v-if="n.saltoMin" :x="X - 24" :y="nodos[i].y + ALTO + n.extra / 2 + BASE / 2 + 3"
                class="salto">+{{ n.saltoMin >= 60 ? Math.floor(n.saltoMin/60)+'h '+(n.saltoMin%60)+'m' : n.saltoMin+'m' }}</text>
        </g>

        <g v-for="n in nodos" :key="n.id" class="nodo" :class="{ sel: t.etapaSel === n.id, fuera: n.estado === 'no-aplica' }"
           @click="t.etapaSel = n.id">
          <!-- DÓNDE SE CORTÓ. Un halo solo NO alcanza, y se vio corriéndolo: la vista abre sola la etapa
               que rompió (`indiceInteresante`), así que el halo cae exactamente encima del borde de
               selección y los dos resaltados se leen como uno. Por eso además va ROTULADO — «se cortó
               acá» no se confunde con «esto es lo que estás mirando», que es otra cosa. -->
          <g v-if="n.roto">
            <rect :x="X - 6" :y="n.y - 6" :width="ANCHO + 12" :height="ALTO + 12" rx="10"
                  fill="none" stroke="var(--fail)" stroke-width="2" opacity=".6" />
            <rect :x="X + ANCHO + 14" :y="n.y + 7" width="86" height="20" rx="5" fill="var(--fail)" opacity=".16" />
            <text :x="X + ANCHO + 20" :y="n.y + 21" class="corte">se cortó acá</text>
          </g>
          <circle :cx="X - 30" :cy="n.y + ALTO / 2" r="9" :fill="'var(--bg)'" :stroke="COLOR[n.estado]" stroke-width="2" />
          <text :x="X - 30" :y="n.y + ALTO / 2 + 4" class="glifo" :fill="COLOR[n.estado]">{{ GLIFO[n.estado] }}</text>

          <rect :x="X" :y="n.y" :width="ANCHO" :height="ALTO" rx="7" class="caja" :stroke="COLOR[n.estado]" />
          <text :x="X + 11" :y="n.y + 15" class="lab">{{ n.id }}</text>
          <text :x="X + 11" :y="n.y + 27" class="det">{{ corto(n.vivo?.detail || n.label) }}</text>
          <text v-if="n.vivo?.at" :x="X + ANCHO - 10" :y="n.y + 15" class="hora">{{ n.vivo.at }}</text>
          <text v-if="n.vivo?.lineas" :x="X + ANCHO - 10" :y="n.y + 27" class="hora">{{ n.vivo.lineas }} líneas</text>

          <!-- LOS SUB-PASOS como puntos. Es lo que convierte «se rompió en listado» en «se rompió
               consultando ESTA entidad» sin tener que abrir la etapa. -->
          <g v-for="(s, j) in n.subs" :key="j">
            <circle :cx="X + ANCHO + (n.roto ? 108 : 16) + j * 13" :cy="n.y + ALTO / 2" r="3.5" :fill="COLOR[s.status] || 'var(--skip)'">
              <title>{{ s.label }}{{ s.detail ? ' — ' + s.detail : '' }}</title>
            </circle>
          </g>
          <text v-if="n.subsDe > 7" :x="X + ANCHO + (n.roto ? 108 : 16) + 7 * 13" :y="n.y + ALTO / 2 + 4" class="mas">+{{ n.subsDe - 7 }}</text>
        </g>
      </g>
    </svg>

    <div class="pie">
      <span v-if="t.traza?.ramal" class="ramal" :title="ramal?.label">carril <b>{{ t.traza.ramal }}</b></span>
      <span v-else-if="t.traza" class="dim">sin carril todavía — se decide al elegir entidad</span>
      <span class="dim">arrastrar · rueda para acercar · doble clic encuadra</span>
    </div>
  </div>
</template>

<style scoped>
/* ⚠ EL ALTO NO PUEDE SALIR DEL CONTENIDO, y esto costó un rato de buscar el bug en el lugar equivocado.
   El `<svg>` toma su alto de `cam.h`, y `cam.h` se lee del contenedor con `clientHeight`: si el SVG es
   un hijo en flujo normal, el SVG estira al div, el div dispara el ResizeObserver, `encuadrar()` vuelve
   a leer un alto más grande y lo escribe otra vez en el SVG. Medido: el contenedor llegó a **17.601 px**
   y seguía creciendo 200 px cada 300 ms. El síntoma NO es un error —no hay ninguno en consola— sino que
   la rueda y el arrastre se ven MUERTOS: el zoom sí se aplicaba, y el re-encuadre del bucle lo pisaba en
   el mismo tick. Dos candados para que no vuelva: alto atado a la VENTANA (nunca al contenido) y el SVG
   fuera del flujo. La regla general: un canvas que LEE su tamaño del padre no puede ESCRIBIRLO en un
   hijo en flujo. */
.mapa { position:relative; height:calc(100vh - 215px); min-height:360px; overflow:hidden;
  background:var(--panel2); border-right:1px solid var(--line); cursor:grab; user-select:none }
.mapa svg { position:absolute; inset:0 }
.mapa.move { cursor:grabbing }
.vacio { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); font-size:12px }
.caja { fill:var(--panel); stroke-width:1.5 }
.nodo { cursor:pointer }
.nodo:hover .caja { fill:var(--sel) }
.nodo.sel .caja { fill:var(--sel); stroke-width:2.5 }
/* Atenuado, NO escondido: «acá esto no ocurre nunca» es un dato del diagnóstico. */
.nodo.fuera { opacity:.38 }
.glifo { font:600 11px ui-monospace,monospace; text-anchor:middle }
.lab { font:600 12px ui-monospace,monospace; fill:var(--txt) }
.det { font:11px system-ui; fill:var(--dim) }
.hora { font:10px ui-monospace,monospace; fill:var(--dim); text-anchor:end }
.salto { font:10px ui-monospace,monospace; fill:var(--dim); text-anchor:end }
.mas { font:10px system-ui; fill:var(--dim) }
.corte { font:600 10px system-ui; fill:var(--fail) }
.pie { position:absolute; left:0; right:0; bottom:0; display:flex; gap:12px; align-items:center;
  padding:6px 10px; font-size:11px; background:linear-gradient(transparent,var(--panel2) 40%) }
.ramal { color:var(--txt) } .ramal b { color:var(--accent) }
.dim { color:var(--dim) }
</style>
