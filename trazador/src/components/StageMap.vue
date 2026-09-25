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
// ⚠ NO ES EL MAPA DEL HARNESS en lo que DICE: aquél dibuja pantallas posibles y éste etapas reales.
// Pero ahora sí comparten lenguaje visual —riel grueso por carril, tronco neutro y rótulo + contexto—:
// dos mapas distintos no necesitan pedirle al usuario aprender dos convenciones de lectura.
//
// ⚠ Y LA REGLA DE `Etapas.vue` SE RESPETA IGUAL: se atenúa lo que NO EXISTE, nunca lo que está VACÍO.
// Una etapa sin evidencia es justo donde el flujo se pudo cortar; despintarla convierte la herramienta
// en una que nunca muestra el problema.
import { computed, nextTick, ref, watch, onMounted } from 'vue'
import { useTrazador } from '../stores/trazador'

// El ancho actual del panel llega como estado, además de observar el contenedor. Así el mapa recupera
// espacio durante el arrastre sin esperar a que el navegador entregue un ResizeObserver; el resizer
// publica una vez por frame y las celdas mínimas de las etiquetas evitan que el texto salte.
const props = defineProps({
      closed: { type: Boolean, default: false },
      panelWidth: { type: Number, default: 0 },
})

const t = useTrazador()

const GLYPH = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~',
  'no-aplica':'∅', condicional:'·', pendiente:'·' }
// El color es el mismo que usa la lista: dos escalas para el mismo estado sería otra cosa que
// desincronizar, y además el ojo ya aprendió ésta.
const COLOR = { ok:'var(--ok)', warn:'var(--warn)', fail:'var(--fail)', skip:'var(--skip)',
  'sin-evidencia':'var(--unknown)', 'sin-registro':'var(--skip)', 'no-aplica':'var(--skip)',
  condicional:'var(--skip)', pendiente:'var(--skip)' }

/**
 * ⚠ EL MAPA SE AJUSTA CAMBIANDO EL LAYOUT, NO LA ESCALA — y ésa es toda la diferencia.
 *
 * Antes esto tenía zoom: el dibujo medía lo que medía y un `scale()` lo metía en la caja. El problema
 * es que **el texto escala con él**: a 0,65 los nombres de las etapas dejaban de leerse, que es lo
 * único que el mapa tiene que hacer. Poner un piso a la escala tampoco alcanzaba — abajo del piso el
 * dibujo se cortaba y había que arrastrar.
 *
 * Ahora la separación entre nodos (`PASO`) se calcula con el ancho disponible, así que el mapa entra
 * SIEMPRE y **el texto nunca cambia de tamaño**. El mínimo existe porque por debajo los labels se
 * pisan entre sí; si ni con el mínimo entra, el contenedor scrollea, que es lo honesto.
 */
// ⚠ EL MARGEN IZQUIERDO NO ES EL DEL NODO, ES EL DE SU TEXTO. El label y el detalle van CENTRADOS
// bajo el círculo, así que un detalle de 22 caracteres a 10,5px mide ~115 px y sobresale ~57 a cada
// lado: con el nodo a 30 px del borde, el texto se salía por la izquierda. El margen tiene que cubrir
// la mitad del texto más ancho, no el radio del círculo. Medido con `getBBox()`: con 68 el contenido
// arrancaba en x=10; con 88 queda a ~30 del borde, que es lo que se ve como aire y no como recorte.
// Cada estación reserva la misma celda para su nombre. Antes el paso podía bajar hasta 74px
// mientras `respuesta-lender` ocupaba más de 100px en una sola línea: las etiquetas se pegaban y
// parecían un único nodo. Dos líneas cortas mantienen el mapa legible y, si no caben todas las
// columnas, el lienzo se desplaza horizontalmente en vez de aplastar el texto.
// La escala acompaña al mapa del Harness: piezas densas, aire entre carriles y texto pequeño. La
// reserva sigue siendo explícita para que la densidad no vuelva a convertirse en etiquetas montadas.
const RADIO = 7, Y0 = 52
const LABEL_WIDTH = 82, LABEL_LINES = 2, LABEL_LINE_HEIGHT = 11
const Y_LABEL = 24, Y_DETAIL = 48, LABELS_HEIGHT = 60
const STEP_MIN = 90, X_MARGIN = 64, RIGHT_MARGIN = 22
const LANE_MIN = 84, LANE_MAX = 124

/** El detalle entra en ~22 caracteres bajo un nodo del carril. Se corta en el último espacio: cortar
 *  a secas partía palabras («ramal credifami») y perdía el final de frases que sí entraban. */
const short = (txt, limit = 34) => {
      const s = String(txt || '')
      if (s.length <= limit) return s
      const c = s.slice(0, limit)
      const i = c.lastIndexOf(' ')
      return (i > limit * 0.6 ? c.slice(0, i) : c) + '…'
}

// Un nombre de etapa es un identificador, no prosa: partirlo por sus separadores conserva las
// palabras y deja siempre la misma reserva vertical debajo de cada estación.
const labelLines = (txt, limit = 10) => {
      const words = String(txt || '—').replace(/[-_/]+/g, ' ').trim().split(/\s+/)
      const lines = []
      for (const originalWord of words) {
            const word = originalWord.length > limit ? `${originalWord.slice(0, limit - 1)}…` : originalWord
            const last = lines.at(-1)
            if (last && `${last} ${word}`.length <= limit) lines[lines.length - 1] += ` ${word}`
            else if (lines.length < LABEL_LINES) lines.push(word)
            else lines[LABEL_LINES - 1] = `${lines[LABEL_LINES - 1].slice(0, limit - 1)}…`
      }
      return lines
}
const laneLabel = (c) => short(c.title || c.id, 22)
const laneSubtitle = (c) => short(c.subtitle || '', 42)
const OUTSIDE_LINES = ['sin etapas propias', 'desenlace fuera del trazador']

const aMin = (hhmmss) => {
      if (!hhmmss) return null
      const [h, m, s] = String(hhmmss).split(':').map(Number)
      return h * 60 + m + (s || 0) / 60
}

/**
 * EL LARGO DE LA ARISTA NO ES PROPORCIONAL AL TIEMPO, y tiene que no serlo: una solicitud retomada al
 * día siguiente tiene un salto de 900 minutos y con escala lineal el mapa mediría diez pantallas. Va
 * por logaritmo y con tope, así que la diferencia entre 2 y 40 minutos se ve —que es la que importa— y
 * la de 40 a 900 se satura, con el número al lado para el que quiera el dato exacto.
 */
/** El ancho útil del lienzo, que es lo que manda sobre la separación entre nodos. */
const boxWidth = ref(0)
/** Y el alto, que reparte los carriles: con pocos, respiran; con muchos, se juntan hasta el mínimo. */
const boxHeight = ref(0)

/**
 * Cuántas columnas tiene la fila más larga: el tronco hasta el corte, más el carril con más etapas.
 * Es lo que hay que hacer entrar.
 */
const columns = computed(() =>
      Math.max(1, trunk.value.length - 1 + Math.max(0, ...lanes.value.map((c) => c.steps.length))))

/**
 * ⚠ SIN TOPE SUPERIOR, Y ÉSE ES EL PUNTO: el mapa tiene que LLENAR el ancho que le queda, igual que el
 * del harness. Con un `PASO_MAX` fijo el dibujo dejaba de crecer pasados los ~1.250 px de caja y el
 * sobrante quedaba como fondo vacío a la derecha — en una pantalla de 1.900 sobraban **696 px**, y se
 * veía como que el mapa «no se estira» al mover el sidebar (se estiraba; lo que no crecía era el
 * dibujo). El mínimo sí se queda: por debajo los labels se pisan y ahí conviene scrollear.
 */
const STEP = computed(() => {
      if (!boxWidth.value) return 120
      // ⚠ ACÁ VA UNA ESTIMACIÓN DE LA RESERVA DERECHA, NO LA REAL, y tiene que ser así: la reserva
      // sale de dónde terminan los textos, los textos se corren con el PASO, y el PASO saldría de la
      // reserva — `PASO → ancho → PASO`. La estimación rompe el ciclo.
      //
      // Calibrada midiendo: con 150 sobraban 77 px de lienzo sin usar; con 96 el borde derecho real
      // queda en ~30-40, que es el mismo aire que tiene la izquierda. Si en algún caso queda corta, el
      // lienzo sale unos píxeles más ancho que la caja y el contenedor scrollea — que es preferible a
      // recortar un texto.
      const util = boxWidth.value - X_MARGIN - 96
      return Math.max(STEP_MIN, Math.floor(util / columns.value))
})

/**
 * El salto de tiempo alarga la arista, pero NO puede competir con el ajuste: si se lo deja fijo, tres
 * saltos grandes empujan el dibujo fuera de la caja aunque el `PASO` ya se haya achicado al mínimo.
 * Va por logaritmo (una espera de un día no puede medir diez pantallas) y con tope proporcional.
 */
const jumpLength = (min) => (min === null || min < 1 ? 0
      : Math.min(Math.round(STEP.value * 0.45), Math.round(18 * Math.log10(1 + min))))

/** El estado de cada etapa, por id, salga o no en el recorrido de este ramal. */
const byStage = computed(() => Object.fromEntries(t.stages.map((e) => [e.id, e])))

/**
 * DÓNDE SE ABRE EL MAPA. El tronco llega hasta `seleccion` y ahí se bifurca, y no es una elección
 * estética: **el ramal SALE del `response_type` del lender ya sellado en la solicitud**, así que antes
 * de que el cliente elija no existe. Bifurcar más temprano dibujaría una decisión que todavía no se
 * tomó; más tarde, escondería la única parte donde los caminos de verdad difieren.
 */
const CUT = 'seleccion'

const trunk = computed(() => {
      const isIt = t.stages
      const i = isIt.findIndex((e) => e.id === CUT)
      return i < 0 ? isIt : isIt.slice(0, i + 1)
})

/** Las etapas de un ramal DESPUÉS del corte, en el orden del flujo. `obligatorio:false` = condicional. */
function laneSteps(r) {
      const cutIndex = t.stages.findIndex((e) => e.id === CUT)
      const order = Object.fromEntries(t.stages.map((e, i) => [e.id, i]))
      return (r.steps || [])
            .filter((p) => (order[p.id] ?? -1) > cutIndex)
            .sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0))
            .map((p) => ({ ...p, stage: byStage.value[p.id] }))
}

/** Un color por carril, estable por posición. Los valores viven en `style.css` y no acá: son parte de
 *  la paleta, no de la lógica del mapa — y así el tema claro los cambia sin tocar este archivo. */
const LANE_COLOR = {
      creditopx: 'var(--carril1)',
      agregador: 'var(--secondary)',
      redirect: 'var(--skip)',
      credifamilia: 'var(--carril5)',
}
const LANE_COLOR_FALLBACK = ['var(--carril1)', 'var(--carril2)', 'var(--carril3)', 'var(--carril4)', 'var(--carril5)']

const lanes = computed(() => {
      const rs = t.stageMap?.lanes || []
      return rs.map((r, i) => {
            const [title, ...detail] = String(r.label || r.id).split(' · ')
            return {
                  id: r.id,
                  label: r.label || r.id,
                  title: title || r.id,
                  subtitle: detail.join(' · '),
                  color: LANE_COLOR[r.id] || LANE_COLOR_FALLBACK[i % LANE_COLOR_FALLBACK.length],
                  active: t.trace?.lane === r.id,
                  steps: laneSteps(r),
            }
      })
})

// Antes de cargar una solicitud se muestran todos los caminos como en el harness. Una vez existe una
// traza, el color del carril sigue diciendo qué ruta es y el color del nodo pasa a decir qué ocurrió.
const nodeColor = (n, c) => c.active ? COLOR[n.stage?.status || 'pendiente'] : c.color

/**
 * EL RECORRIDO POR TECLADO, que venía de la lista y se trajo al borrarla.
 *
 * ⚠ Un `<g @click>` de SVG es invisible para el teclado y para un lector de pantalla: no recibe foco ni
 * anuncia que se puede activar. Por eso cada nodo lleva `tabindex` y rol de botón, y ←/→ recorren el
 * orden del flujo. Sin esto, quitar la lista no habría sido cambiar una vista por otra: habría sido
 * dejar la herramienta sin forma de navegarla que no fuera el mouse.
 */
const inOrder = computed(() => [...trunkNodes.value.map((n) => n.id),
      ...nodesByLane.value.flatMap((c) => c.nodes.map((n) => n.id))])

function mover(step) {
      const ids = inOrder.value
      const i = ids.indexOf(t.selectedStage)
      const j = (i < 0 ? 0 : i + step)
      if (j < 0 || j >= ids.length) return
      t.selectedStage = ids[j]
      canvas.value?.querySelector(`[data-etapa="${ids[j]}"]`)?.focus()
}

/** El tronco con su posición y su salto de tiempo respecto de la etapa anterior. */
const trunkNodes = computed(() => {
      let x = X_MARGIN, previous = null
      return trunk.value.map((e, i) => {
            const now = aMin(e.live?.at)
            let minJump = null
            if (now !== null && previous !== null && now - previous >= 1) minJump = Math.round(now - previous)
            if (now !== null) previous = now
            if (i) x += STEP.value + jumpLength(minJump)
            return { ...e, x, y: Y0, minJump: minJump, roto: t.trace?.brokeAt === e.id }
      })
})

const cutX = computed(() => (trunkNodes.value.at(-1)?.x ?? 40))

/** Cada carril arranca una columna después del corte y no vuelve nunca hacia atrás. */
const nodesByLane = computed(() => lanes.value.map((c, ci) => ({
      ...c,
      y: Y0 + (ci + 1) * LANE.value,
      nodes: c.steps.map((p, i) => ({
            id: p.id,
            stage: p.stage,
            condicional: p.required === false,
            x: cutX.value + STEP.value * (i + 1),
            y: Y0 + (ci + 1) * LANE.value,
            roto: t.trace?.brokeAt === p.id,
      })),
})))

/**
 * Cuánto ocupa un texto, estimado por caracteres. No es exacto y no hace falta que lo sea: se usa para
 * reservar espacio, y quedarse corto se ve (texto contra el borde) mientras que pasarse no.
 *
 * ⚠ Medirlo de verdad con `getBBox()` sería circular: el ancho del lienzo sale de esto, y el bbox sale
 * de dibujar en ese lienzo. La estimación rompe el ciclo.
 */
const textWidth = (txt, pxPerChar) => String(txt || '').length * pxPerChar
const PX_MONO = 6.4, PX_DETAIL = 4.8, PX_LANE = 6, PX_OUTSIDE = 5

/**
 * ⚠ LA RESERVA DERECHA SE CALCULA DEL CONTENIDO, no es una constante — y la constante tenía un caso
 * donde NO alcanzaba. Los textos no terminan donde termina el último nodo:
 *
 *   · el label y el detalle van CENTRADOS, así que sobresalen media anchura a la derecha;
 *   · el rótulo del carril («credifamilia ← por acá fue») arranca en su PRIMER nodo y se extiende;
 *   · y el peor: «— sin etapas propias…» mide ~260 px desde el primer nodo de un carril VACÍO, que no
 *     cuenta para `maxCarril` porque no tiene nodos. Con la reserva fija de 132 y un `PASO` chico ese
 *     texto se salía del lienzo. Hoy no se veía por casualidad: con `PASO = 124` terminaba 2 px antes
 *     que el carril más largo.
 *
 * Se toma el extremo derecho de TODOS y se le suma el mismo aire que lleva la izquierda.
 */
const rightEdge = computed(() => {
      let max = cutX.value
      for (const c of nodesByLane.value) {
            const x0 = cutX.value + STEP.value
            const title = c.active ? `${laneLabel(c)} · recorrido real` : laneLabel(c)
            max = Math.max(max, x0 + textWidth(title, PX_LANE),
                                x0 + textWidth(laneSubtitle(c), PX_OUTSIDE))
            if (!c.nodes.length) max = Math.max(max, x0 + textWidth(OUTSIDE_LINES.at(-1), PX_OUTSIDE))
            for (const n of c.nodes) {
                  const det = c.active ? short(n.stage?.live?.detail || n.stage?.label, 22) : ''
                  max = Math.max(max, n.x + LABEL_WIDTH / 2,
                                      n.x + textWidth(det, PX_DETAIL) / 2)
            }
      }
      for (const n of trunkNodes.value) {
            max = Math.max(max, n.x + LABEL_WIDTH / 2,
                                n.x + textWidth(short(n.live?.detail || n.label, 22), PX_DETAIL) / 2)
      }
      return max
})

const width = computed(() => rightEdge.value + RIGHT_MARGIN)
/**
 * La separación entre carriles se reparte igual que el `PASO`: con espacio de sobra los carriles
 * respiran, y con poco se juntan hasta el mínimo. Antes era una constante y el dibujo quedaba pegado
 * arriba dejando un tercio de la caja vacío — el espacio que sobra no es neutro, es espacio que el
 * grafo podría estar usando para leerse mejor.
 */
const LANE = computed(() => {
      const rows = lanes.value.length + 1
      if (!boxHeight.value || !rows) return LANE_MIN
      // El `- Y0 - ALTO_ETIQUETAS`: arriba el margen propio y abajo la celda fija de los labels del
      // último carril, que evita que sus dos líneas y el detalle se recorten contra el borde.
      return Math.max(LANE_MIN, Math.min(LANE_MAX, Math.floor((boxHeight.value - Y0 - LABELS_HEIGHT) / rows)))
})

/**
 * El alto también sale del CONTENIDO, con el mismo criterio que el ancho: el último carril más lo que
 * cuelga de sus nodos (label a +28 y detalle a +41) más el aire. Con `(carriles + 1) * CARRIL` sobraban
 * 99 px abajo contra 30 arriba — una reserva de una fila entera para un texto de dos renglones.
 */
const height = computed(() =>
      Y0 + Math.max(1, lanes.value.length) * LANE.value + LABELS_HEIGHT + RIGHT_MARGIN)

// ── LA MEDIDA DEL LIENZO ─────────────────────────────────────────────────────────────────────────
//
// Ya no hay cámara: no hay zoom ni arrastre, y el dibujo se adapta cambiando la SEPARACIÓN entre nodos
// (ver la nota de `PASO`). Lo único que hay que saber del DOM es cuánto ancho hay.
const canvas = ref(null)

function measure() {
      const el = canvas.value
      if (!el) return
      const w = el.clientWidth, h = el.clientHeight
      if (w) boxWidth.value = w
      if (h) boxHeight.value = h
}

onMounted(() => { measure(); new ResizeObserver(measure).observe(canvas.value) })

// El ResizeObserver cubre cambios externos (ventana, fuente, zoom) y el prop cubre el arrastre. En los
// dos casos se mide tras el render para leer la caja final, no el ancho previo al margin del editor.
watch(() => [props.closed, props.panelWidth], () => nextTick(measure))

</script>

<template>
  <div class="mapa" ref="canvas">
    <!-- ⚠ ESTO NO ES «TODAVÍA NO BUSCASTE NADA»: esa pantalla no existe. `etapas` es un getter que
         SIEMPRE devuelve el mapa declarado —el trazador dibuja las etapas en gris antes de que haya
         consulta, a propósito—, así que esta rama sólo se alcanza si `mapa.etapas` viene vacío, o sea
         si el mapa no cargó. Decía «el mapa se dibuja al cargar una solicitud», que describe un
         estado que nunca ocurre; ahora dice lo que pasó de verdad.
         La anatomía es la compartida (`.empty` de `workbench.css`): medio, título y descripción. -->
    <div v-if="!trunkNodes.length" class="vacio empty">
      <div class="empty-head">
        <div class="empty-media">⚠</div>
        <p class="empty-title">El mapa del flujo no cargó</p>
        <p class="empty-desc">Sin etapas declaradas no hay nada que dibujar. Comprobalo con <code>make trazador-chequeo</code>.</p>
      </div>
    </div>

    <!-- El SVG mide lo que mide el DIBUJO, no la caja: si por algún motivo no entra (muchos carriles
         en una ventana baja), el contenedor scrollea y no hay nada escondido detrás de un borde. -->
    <svg v-else :width="width" :height="height">
      <g>
        <!-- ── EL TRONCO: lo que ocurre antes de que exista un ramal ── -->
        <g v-for="(n, i) in trunkNodes.slice(1)" :key="'ta'+n.id">
          <line :x1="trunkNodes[i].x" :y1="Y0" :x2="n.x" :y2="Y0" class="arista"
                :stroke="t.trace ? (n.status === 'no-aplica' ? 'var(--line)' : COLOR[trunkNodes[i].status]) : 'var(--map-trunk)'"
                :stroke-dasharray="n.status === 'no-aplica' ? '4 5' : null" />
          <!-- el salto SÓLO cuando lo hay: un «+0m» en cada arista tapa a los que importan -->
          <text v-if="n.minJump" :x="(trunkNodes[i].x + n.x) / 2" :y="Y0 - 10" class="salto">
            +{{ n.minJump >= 60 ? Math.floor(n.minJump/60)+'h '+(n.minJump%60)+'m' : n.minJump+'m' }}
          </text>
        </g>

        <!-- ── LAS CURVAS DE BIFURCACIÓN: cortas, porque salen DEL corte y no del principio ── -->
        <g v-for="c in nodesByLane" :key="'c'+c.id" :class="{ apagado: t.trace && !c.active }">
          <path class="arista"
                :d="`M ${cutX} ${Y0} C ${cutX + STEP * 0.5} ${Y0}, ${cutX + STEP * 0.5} ${c.y}, ${cutX + STEP} ${c.y}`"
                fill="none" :stroke="c.color" />
        </g>

        <!-- ── LOS CARRILES ── -->
        <g v-for="c in nodesByLane" :key="c.id" :class="{ apagado: t.trace && !c.active }">
          <line v-if="c.nodes.length > 1" :x1="c.nodes[0].x" :y1="c.y"
                :x2="c.nodes.at(-1).x" :y2="c.y" class="arista"
                :stroke="c.color" />
          <text :x="cutX + STEP" :y="c.y - 18" class="clbl" :fill="c.color">
            {{ laneLabel(c) }}<tspan v-if="c.active" class="aqui"> · recorrido real</tspan>
          </text>
          <text v-if="laneSubtitle(c)" :x="cutX + STEP" :y="c.y - 7" class="csub">{{ laneSubtitle(c) }}</text>
          <!-- ⚠ UN CARRIL SIN PASOS NO ES UN ERROR DE DIBUJO: es el dato. `redirect` no tiene ninguna
               etapa después de elegir porque el desenlace ocurre AFUERA, y verlo cortado ahí lo dice
               mejor que cualquier nota al pie. -->
          <text v-if="!c.nodes.length" :x="cutX + STEP" :y="c.y + 5" class="afuera">
            <tspan v-for="(line, i) in OUTSIDE_LINES" :key="line" :x="cutX + STEP" :dy="i ? 12 : 0">{{ line }}</tspan>
          </text>

          <g v-for="n in c.nodes" :key="n.id" class="nodo" :class="{ sel: t.selectedStage === n.id }"
             :data-etapa="n.id" tabindex="0" role="button" :aria-label="`etapa ${n.id}`"
             @click="t.selectedStage = n.id" @keydown.enter.prevent="t.selectedStage = n.id"
             @keydown.right.prevent="mover(1)" @keydown.left.prevent="mover(-1)">
            <circle v-if="n.roto" :cx="n.x" :cy="n.y" r="13" fill="none" stroke="var(--fail)"
                    stroke-width="2" opacity=".6" />
            <!-- hueco = CONDICIONAL (puede saltearse) · sólido = siempre ocurre en este ramal. Es la
                 convención del mapa del harness, y acá vale igual: dibujar todo sólido muestra el peor
                 caso como si fuera el único. -->
            <!-- ⚠ EL ESTADO ES DEL CARRIL QUE SE RECORRIÓ, Y SÓLO DE ÉSE. El `estado` y el `detail`
                 de una etapa salen de ESTA traza, que fue por UN ramal: pintarlos en los otros
                 carriles afirma sobre un camino que no se recorrió. Se vio corriéndolo — `biometria`
                 aparecía en el carril `creditopx` con «no aplica a ramal redirect», que en creditopx
                 es falso. Los carriles inactivos muestran la FORMA (qué etapas tiene y cuáles son
                 condicionales) y nada más: es contexto, no diagnóstico. -->
            <circle :cx="n.x" :cy="n.y" :r="n.condicional ? 6 : RADIO"
                    :fill="n.condicional ? 'var(--map-canvas)' : nodeColor(n, c)"
                    :stroke="n.condicional ? nodeColor(n, c) : 'var(--map-canvas)'"
                    :stroke-width="n.condicional ? 2.5 : 2" />
            <text v-if="!n.condicional && c.active" :x="n.x" :y="n.y + 3" class="glifo">{{ GLYPH[n.stage?.status] }}</text>
            <text :x="n.x" :y="n.y + Y_LABEL" class="nlbl">
              <tspan v-for="(line, i) in labelLines(n.id)" :key="line" :x="n.x" :dy="i ? LABEL_LINE_HEIGHT : 0">{{ line }}</tspan>
            </text>
            <text v-if="c.active" :x="n.x" :y="n.y + Y_DETAIL" class="ndet">{{ short(n.stage?.live?.detail || n.stage?.label, 22) }}</text>
          </g>
        </g>

        <!-- los nodos del tronco van AL FINAL para quedar encima de las curvas -->
        <g v-for="n in trunkNodes" :key="n.id" class="nodo" :class="{ sel: t.selectedStage === n.id, fuera: n.status === 'no-aplica' }"
           :data-etapa="n.id" tabindex="0" role="button" :aria-label="`etapa ${n.id}`"
           @click="t.selectedStage = n.id" @keydown.enter.prevent="t.selectedStage = n.id"
           @keydown.right.prevent="mover(1)" @keydown.left.prevent="mover(-1)">
          <g v-if="n.roto">
            <circle :cx="n.x" :cy="Y0" r="13" fill="none" stroke="var(--fail)" stroke-width="2" opacity=".6" />
            <text :x="n.x" :y="Y0 - 19" class="corte">se cortó acá</text>
          </g>
          <circle :cx="n.x" :cy="Y0" :r="RADIO" :fill="t.trace ? COLOR[n.status] : 'var(--map-trunk)'" stroke="var(--map-canvas)" stroke-width="2" />
          <text :x="n.x" :y="Y0 + 3" class="glifo">{{ GLYPH[n.status] }}</text>
          <text :x="n.x" :y="Y0 + Y_LABEL" class="nlbl">
            <tspan v-for="(line, i) in labelLines(n.id)" :key="line" :x="n.x" :dy="i ? LABEL_LINE_HEIGHT : 0">{{ line }}</tspan>
          </text>
          <text :x="n.x" :y="Y0 + Y_DETAIL" class="ndet">{{ short(n.live?.detail || n.label, 22) }}</text>
          <text v-if="n.live?.at" :x="n.x" :y="Y0 - 13" class="hora">{{ n.live.at }}</text>
        </g>
      </g>
    </svg>

  </div>
</template>

<style scoped>
/* ⚠ EL ALTO NO PUEDE SALIR DEL CONTENIDO, y el ancho tampoco puede depender de la barra de scroll.
   Son dos realimentaciones distintas y las dos ya mordieron o estuvieron cerca:

   1. Con el SVG dimensionado desde el contenedor —como en la versión con zoom— el SVG estiraba al div,
      el div disparaba el ResizeObserver y el cálculo leía un alto mayor y lo escribía otra vez. Medido:
      el contenedor llegó a 17.601 px creciendo 200 px cada 300 ms, SIN un solo error en consola. Hoy el
      SVG mide lo que mide el DIBUJO y el div tiene alto de viewport, así que no se realimentan.
   2. `scrollbar-gutter: stable` es contra la otra: `clientWidth` se achica cuando aparece la barra, y de
      ese ancho sale `PASO` — sin el gutter, el dibujo entraría, la barra desaparecería, el ancho
      volvería a crecer y el mapa oscilaría. Reservar el canal de una vez corta el ciclo.

   La regla que sirve para las dos: lo que se MIDE del contenedor no puede depender de lo que se DIBUJA
   adentro. */
.mapa { --map-canvas:var(--background);
  --map-trunk:color-mix(in oklab, var(--foreground) 68%, var(--background));
  position:relative; height:100%; min-height:260px;
  overflow:auto; scrollbar-gutter:stable;
  /* ⚠ Sin `border-right`: el panel de logs ya trae su `border-left`, y las dos pintaban una al lado
     de la otra — medido, el mapa en 546–547 y el panel en 547–548, o sea una costura de 2px donde va
     un pelo de 1. Con el panel cerrado esa línea quedaba además pegada al borde de la ventana. */
  background:var(--map-canvas); user-select:none }
/* Sobre `.empty`: sólo que ocupe el lienzo entero. El resto —el centrado, los tamaños, el medio— lo
   pone la clase compartida. */
.vacio { position:absolute; inset:0 }

.arista { stroke-width:4px; stroke-linecap:round }
.nodo { cursor:pointer }
.nodo:hover .nlbl { fill:var(--info) }
.nodo:focus { outline:none }
.nodo:focus-visible .nlbl { fill:var(--info); text-decoration:underline }
.nodo.sel .nlbl { fill:var(--info); font-weight:700 }
.nodo.sel circle { stroke:var(--ring) !important; stroke-width:2.5px }
/* Atenuado, NO escondido: «acá esto no ocurre nunca» es parte del diagnóstico. */
.nodo.fuera circle { opacity:.38 }
.nodo.fuera .nlbl { fill:var(--fg-3) }
/* Un carril que esta solicitud no tomó se ve, pero no compite: es contexto, no recorrido. */
.apagado circle, .apagado .arista { opacity:.32 }
.apagado .clbl, .apagado .csub, .apagado .nlbl { opacity:.52 }

.glifo { font:600 9px ui-monospace,monospace; text-anchor:middle; fill:var(--map-canvas) }
.nlbl { font:600 11px ui-monospace,monospace; fill:var(--txt); text-anchor:middle; letter-spacing:-.01em }
/* ⚠ `--dim` y no `--tenue`: el detalle del nodo es la RUTA de la etapa, o sea información que se
   lee. `--tenue` es el `muted-foreground` del tema y contra este fondo mide 4,41:1 — abajo de AA para
   10,5px. Medido en el navegador. `--tenue` queda para lo que de verdad es accesorio. */
.ndet { font:9.5px system-ui; fill:var(--dim); text-anchor:middle }
.hora { font:9px ui-monospace,monospace; fill:var(--tenue); text-anchor:middle }
.salto { font:9px ui-monospace,monospace; fill:var(--tenue); text-anchor:middle }
.clbl { font:700 var(--text-xs) system-ui; letter-spacing:-.01em }
.csub { font:9px system-ui; fill:var(--dim) }
.aqui { font-weight:400; font-size:9.5px; fill:var(--dim) }
.afuera { font:9.5px system-ui; fill:var(--dim) }
.corte { font:600 9px system-ui; fill:var(--fail); text-anchor:middle }

.dim { color:var(--dim) }
.recorte { color:var(--warn) }
</style>
