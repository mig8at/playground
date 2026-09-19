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
import { computed, nextTick, ref, watch, onMounted } from 'vue'
import { useTrazador } from '../stores/trazador'

// ⚠ LLEGA SI EL PANEL ESTÁ CERRADO, NO SU ANCHO — y la diferencia es la que hace que el mapa no lata.
// El ancho del mapa sólo cambia al abrir o cerrar el panel (cuando se ensancha, se monta encima), así
// que observar el ancho lo haría recalcularse en cada píxel del arrastre sin que su caja cambie.
const props = defineProps({ cerrado: { type: Boolean, default: false } })

const t = useTrazador()

const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~',
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
const RADIO = 9, Y0 = 60
const PASO_MIN = 74, MARGEN_X = 88, MARGEN_DER = 30
const CARRIL_MIN = 74, CARRIL_MAX = 130

/** El detalle entra en ~22 caracteres bajo un nodo del carril. Se corta en el último espacio: cortar
 *  a secas partía palabras («ramal credifami») y perdía el final de frases que sí entraban. */
const corto = (txt, tope = 34) => {
      const s = String(txt || '')
      if (s.length <= tope) return s
      const c = s.slice(0, tope)
      const i = c.lastIndexOf(' ')
      return (i > tope * 0.6 ? c.slice(0, i) : c) + '…'
}

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
const anchoCaja = ref(0)
/** Y el alto, que reparte los carriles: con pocos, respiran; con muchos, se juntan hasta el mínimo. */
const altoCaja = ref(0)

/**
 * Cuántas columnas tiene la fila más larga: el tronco hasta el corte, más el carril con más etapas.
 * Es lo que hay que hacer entrar.
 */
const columnas = computed(() =>
      Math.max(1, tronco.value.length - 1 + Math.max(0, ...carriles.value.map((c) => c.pasos.length))))

/**
 * ⚠ SIN TOPE SUPERIOR, Y ÉSE ES EL PUNTO: el mapa tiene que LLENAR el ancho que le queda, igual que el
 * del harness. Con un `PASO_MAX` fijo el dibujo dejaba de crecer pasados los ~1.250 px de caja y el
 * sobrante quedaba como fondo vacío a la derecha — en una pantalla de 1.900 sobraban **696 px**, y se
 * veía como que el mapa «no se estira» al mover el sidebar (se estiraba; lo que no crecía era el
 * dibujo). El mínimo sí se queda: por debajo los labels se pisan y ahí conviene scrollear.
 */
const PASO = computed(() => {
      if (!anchoCaja.value) return 120
      // ⚠ ACÁ VA UNA ESTIMACIÓN DE LA RESERVA DERECHA, NO LA REAL, y tiene que ser así: la reserva
      // sale de dónde terminan los textos, los textos se corren con el PASO, y el PASO saldría de la
      // reserva — `PASO → ancho → PASO`. La estimación rompe el ciclo.
      //
      // Calibrada midiendo: con 150 sobraban 77 px de lienzo sin usar; con 96 el borde derecho real
      // queda en ~30-40, que es el mismo aire que tiene la izquierda. Si en algún caso queda corta, el
      // lienzo sale unos píxeles más ancho que la caja y el contenedor scrollea — que es preferible a
      // recortar un texto.
      const util = anchoCaja.value - MARGEN_X - 96
      return Math.max(PASO_MIN, Math.floor(util / columnas.value))
})

/**
 * El salto de tiempo alarga la arista, pero NO puede competir con el ajuste: si se lo deja fijo, tres
 * saltos grandes empujan el dibujo fuera de la caja aunque el `PASO` ya se haya achicado al mínimo.
 * Va por logaritmo (una espera de un día no puede medir diez pantallas) y con tope proporcional.
 */
const largoDelSalto = (min) => (min === null || min < 1 ? 0
      : Math.min(Math.round(PASO.value * 0.45), Math.round(18 * Math.log10(1 + min))))

/** El estado de cada etapa, por id, salga o no en el recorrido de este ramal. */
const porEtapa = computed(() => Object.fromEntries(t.etapas.map((e) => [e.id, e])))

/**
 * DÓNDE SE ABRE EL MAPA. El tronco llega hasta `seleccion` y ahí se bifurca, y no es una elección
 * estética: **el ramal SALE del `response_type` del lender ya sellado en la solicitud**, así que antes
 * de que el cliente elija no existe. Bifurcar más temprano dibujaría una decisión que todavía no se
 * tomó; más tarde, escondería la única parte donde los caminos de verdad difieren.
 */
const CORTE = 'seleccion'

const tronco = computed(() => {
      const es = t.etapas
      const i = es.findIndex((e) => e.id === CORTE)
      return i < 0 ? es : es.slice(0, i + 1)
})

/** Las etapas de un ramal DESPUÉS del corte, en el orden del flujo. `obligatorio:false` = condicional. */
function pasosDeRamal(r) {
      const iCorte = t.etapas.findIndex((e) => e.id === CORTE)
      const orden = Object.fromEntries(t.etapas.map((e, i) => [e.id, i]))
      return (r.pasos || [])
            .filter((p) => (orden[p.id] ?? -1) > iCorte)
            .sort((a, b) => (orden[a.id] ?? 0) - (orden[b.id] ?? 0))
            .map((p) => ({ ...p, etapa: porEtapa.value[p.id] }))
}

/** Un color por carril, estable por posición. Los valores viven en `estilo.css` y no acá: son parte de
 *  la paleta, no de la lógica del mapa — y así el tema claro los cambia sin tocar este archivo. */
const COLOR_CARRIL = ['var(--carril1)', 'var(--carril2)', 'var(--carril3)', 'var(--carril4)', 'var(--carril5)']

const carriles = computed(() => {
      const rs = t.mapa?.ramales || []
      return rs.map((r, i) => ({
            id: r.id,
            label: r.label || r.id,
            color: COLOR_CARRIL[i % COLOR_CARRIL.length],
            activo: t.traza?.ramal === r.id,
            pasos: pasosDeRamal(r),
      }))
})

/**
 * EL RECORRIDO POR TECLADO, que venía de la lista y se trajo al borrarla.
 *
 * ⚠ Un `<g @click>` de SVG es invisible para el teclado y para un lector de pantalla: no recibe foco ni
 * anuncia que se puede activar. Por eso cada nodo lleva `tabindex` y rol de botón, y ←/→ recorren el
 * orden del flujo. Sin esto, quitar la lista no habría sido cambiar una vista por otra: habría sido
 * dejar la herramienta sin forma de navegarla que no fuera el mouse.
 */
const enOrden = computed(() => [...nodosTronco.value.map((n) => n.id),
      ...nodosPorCarril.value.flatMap((c) => c.nodos.map((n) => n.id))])

function mover(paso) {
      const ids = enOrden.value
      const i = ids.indexOf(t.etapaSel)
      const j = (i < 0 ? 0 : i + paso)
      if (j < 0 || j >= ids.length) return
      t.etapaSel = ids[j]
      lienzo.value?.querySelector(`[data-etapa="${ids[j]}"]`)?.focus()
}

/** El tronco con su posición y su salto de tiempo respecto de la etapa anterior. */
const nodosTronco = computed(() => {
      let x = MARGEN_X, previa = null
      return tronco.value.map((e, i) => {
            const ahora = aMin(e.vivo?.at)
            let saltoMin = null
            if (ahora !== null && previa !== null && ahora - previa >= 1) saltoMin = Math.round(ahora - previa)
            if (ahora !== null) previa = ahora
            if (i) x += PASO.value + largoDelSalto(saltoMin)
            return { ...e, x, y: Y0, saltoMin, roto: t.traza?.brokeAt === e.id }
      })
})

const xCorte = computed(() => (nodosTronco.value.at(-1)?.x ?? 40))

/** Cada carril arranca una columna después del corte y no vuelve nunca hacia atrás. */
const nodosPorCarril = computed(() => carriles.value.map((c, ci) => ({
      ...c,
      y: Y0 + (ci + 1) * CARRIL.value,
      nodos: c.pasos.map((p, i) => ({
            id: p.id,
            etapa: p.etapa,
            condicional: p.obligatorio === false,
            x: xCorte.value + PASO.value * (i + 1),
            y: Y0 + (ci + 1) * CARRIL.value,
            roto: t.traza?.brokeAt === p.id,
      })),
})))

/** El texto del carril que no tiene etapas propias. Como constante porque hay que MEDIRLO. */
const TEXTO_AFUERA = '— sin etapas propias: el desenlace ocurre afuera'

/**
 * Cuánto ocupa un texto, estimado por caracteres. No es exacto y no hace falta que lo sea: se usa para
 * reservar espacio, y quedarse corto se ve (texto contra el borde) mientras que pasarse no.
 *
 * ⚠ Medirlo de verdad con `getBBox()` sería circular: el ancho del lienzo sale de esto, y el bbox sale
 * de dibujar en ese lienzo. La estimación rompe el ciclo.
 */
const anchoTexto = (txt, pxPorChar) => String(txt || '').length * pxPorChar
const PX_MONO = 7.2, PX_DETALLE = 5.3, PX_CARRIL = 6.6, PX_AFUERA = 5.5

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
const bordeDerecho = computed(() => {
      let max = xCorte.value
      for (const c of nodosPorCarril.value) {
            const x0 = xCorte.value + PASO.value
            max = Math.max(max, x0 + anchoTexto(`${c.id} ← por acá fue`, PX_CARRIL))
            if (!c.nodos.length) max = Math.max(max, x0 + anchoTexto(TEXTO_AFUERA, PX_AFUERA))
            for (const n of c.nodos) {
                  const det = c.activo ? corto(n.etapa?.vivo?.detail || n.etapa?.label, 22) : ''
                  max = Math.max(max, n.x + anchoTexto(n.id, PX_MONO) / 2,
                                      n.x + anchoTexto(det, PX_DETALLE) / 2)
            }
      }
      for (const n of nodosTronco.value) {
            max = Math.max(max, n.x + anchoTexto(n.id, PX_MONO) / 2,
                                n.x + anchoTexto(corto(n.vivo?.detail || n.label, 22), PX_DETALLE) / 2)
      }
      return max
})

const ancho = computed(() => bordeDerecho.value + MARGEN_DER)
/**
 * La separación entre carriles se reparte igual que el `PASO`: con espacio de sobra los carriles
 * respiran, y con poco se juntan hasta el mínimo. Antes era una constante y el dibujo quedaba pegado
 * arriba dejando un tercio de la caja vacío — el espacio que sobra no es neutro, es espacio que el
 * grafo podría estar usando para leerse mejor.
 */
const CARRIL = computed(() => {
      const filas = carriles.value.length + 1
      if (!altoCaja.value || !filas) return CARRIL_MIN
      // El `- Y0 - 46`: arriba el margen propio y abajo el alto de los labels del último carril, que
      // cuelgan del nodo y sin esa reserva quedan cortados contra el borde.
      return Math.max(CARRIL_MIN, Math.min(CARRIL_MAX, Math.floor((altoCaja.value - Y0 - 46) / filas)))
})

/**
 * El alto también sale del CONTENIDO, con el mismo criterio que el ancho: el último carril más lo que
 * cuelga de sus nodos (label a +28 y detalle a +41) más el aire. Con `(carriles + 1) * CARRIL` sobraban
 * 99 px abajo contra 30 arriba — una reserva de una fila entera para un texto de dos renglones.
 */
const ALTO_ETIQUETAS = 46
const alto = computed(() =>
      Y0 + Math.max(1, carriles.value.length) * CARRIL.value + ALTO_ETIQUETAS + MARGEN_DER)

// ── LA MEDIDA DEL LIENZO ─────────────────────────────────────────────────────────────────────────
//
// Ya no hay cámara: no hay zoom ni arrastre, y el dibujo se adapta cambiando la SEPARACIÓN entre nodos
// (ver la nota de `PASO`). Lo único que hay que saber del DOM es cuánto ancho hay.
const lienzo = ref(null)

function medir() {
      const el = lienzo.value
      if (!el) return
      const w = el.clientWidth, h = el.clientHeight
      if (w) anchoCaja.value = w
      if (h) altoCaja.value = h
}

onMounted(() => { medir(); new ResizeObserver(medir).observe(lienzo.value) })

// ⚠ EL `ResizeObserver` NO ALCANZA, y hay que medir por ESTADO cuando el panel se abre o se cierra. Medido el 2026-09-18: al arrastrarlo, el `.mapa` pasó de 869 a 984 px y el observer **no
// disparó ni una vez** — ni el del componente ni uno nuevo creado a mano sobre el mismo elemento.
//
// ⚠ NO SE PUDO DISTINGUIR si falla siempre o sólo con el panel del navegador oculto, que es donde se
// midió y donde tampoco se componen frames. Da igual para la decisión: el ancho del sidebar es ESTADO
// de la app, no una consecuencia del layout, así que observarlo es determinista y no depende de que el
// navegador llegue a hacer el ciclo. El observer se queda para el resize de la VENTANA, que sí es puro
// layout.
watch(() => props.cerrado, () => nextTick(medir))

</script>

<template>
  <div class="mapa" ref="lienzo">
    <div v-if="!nodosTronco.length" class="vacio">el mapa se dibuja al cargar una solicitud</div>

    <!-- El SVG mide lo que mide el DIBUJO, no la caja: si por algún motivo no entra (muchos carriles
         en una ventana baja), el contenedor scrollea y no hay nada escondido detrás de un borde. -->
    <svg v-else :width="ancho" :height="alto">
      <g>
        <!-- ── EL TRONCO: lo que ocurre antes de que exista un ramal ── -->
        <g v-for="(n, i) in nodosTronco.slice(1)" :key="'ta'+n.id">
          <line :x1="nodosTronco[i].x" :y1="Y0" :x2="n.x" :y2="Y0" class="arista"
                :stroke="n.estado === 'no-aplica' ? 'var(--line)' : COLOR[nodosTronco[i].estado]"
                :stroke-dasharray="n.estado === 'no-aplica' ? '4 5' : null" />
          <!-- el salto SÓLO cuando lo hay: un «+0m» en cada arista tapa a los que importan -->
          <text v-if="n.saltoMin" :x="(nodosTronco[i].x + n.x) / 2" :y="Y0 - 12" class="salto">
            +{{ n.saltoMin >= 60 ? Math.floor(n.saltoMin/60)+'h '+(n.saltoMin%60)+'m' : n.saltoMin+'m' }}
          </text>
        </g>

        <!-- ── LAS CURVAS DE BIFURCACIÓN: cortas, porque salen DEL corte y no del principio ── -->
        <path v-for="c in nodosPorCarril" :key="'c'+c.id" class="arista"
              :d="`M ${xCorte} ${Y0} C ${xCorte + PASO * 0.5} ${Y0}, ${xCorte + PASO * 0.5} ${c.y}, ${xCorte + PASO} ${c.y}`"
              fill="none" :stroke="c.activo ? c.color : 'var(--line)'" :opacity="c.activo ? 1 : 0.45" />

        <!-- ── LOS CARRILES ── -->
        <g v-for="c in nodosPorCarril" :key="c.id" :class="{ apagado: !c.activo }">
          <line v-if="c.nodos.length > 1" :x1="c.nodos[0].x" :y1="c.y"
                :x2="c.nodos.at(-1).x" :y2="c.y" class="arista"
                :stroke="c.activo ? c.color : 'var(--line)'" />
          <text :x="xCorte + PASO" :y="c.y - 22" class="clbl" :fill="c.activo ? c.color : 'var(--dim)'">
            {{ c.id }}<tspan v-if="c.activo" class="aqui"> ← por acá fue</tspan>
          </text>
          <!-- ⚠ UN CARRIL SIN PASOS NO ES UN ERROR DE DIBUJO: es el dato. `redirect` no tiene ninguna
               etapa después de elegir porque el desenlace ocurre AFUERA, y verlo cortado ahí lo dice
               mejor que cualquier nota al pie. -->
          <text v-if="!c.nodos.length" :x="xCorte + PASO" :y="c.y + 5" class="afuera">
            {{ TEXTO_AFUERA }}
          </text>

          <g v-for="n in c.nodos" :key="n.id" class="nodo" :class="{ sel: t.etapaSel === n.id }"
             :data-etapa="n.id" tabindex="0" role="button" :aria-label="`etapa ${n.id}`"
             @click="t.etapaSel = n.id" @keydown.enter.prevent="t.etapaSel = n.id"
             @keydown.right.prevent="mover(1)" @keydown.left.prevent="mover(-1)">
            <circle v-if="n.roto" :cx="n.x" :cy="n.y" r="17" fill="none" stroke="var(--fail)"
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
            <circle :cx="n.x" :cy="n.y" :r="n.condicional ? 8 : RADIO"
                    :fill="n.condicional ? 'var(--panel2)' : (c.activo ? COLOR[n.etapa?.estado || 'pendiente'] : 'var(--skip)')"
                    :stroke="c.activo ? COLOR[n.etapa?.estado || 'pendiente'] : 'var(--skip)'"
                    :stroke-width="n.condicional ? 3 : 0" />
            <text v-if="!n.condicional && c.activo" :x="n.x" :y="n.y + 5" class="glifo">{{ GLIFO[n.etapa?.estado] }}</text>
            <text :x="n.x" :y="n.y + 28" class="nlbl">{{ n.id }}</text>
            <text v-if="c.activo" :x="n.x" :y="n.y + 41" class="ndet">{{ corto(n.etapa?.vivo?.detail || n.etapa?.label, 22) }}</text>
          </g>
        </g>

        <!-- los nodos del tronco van AL FINAL para quedar encima de las curvas -->
        <g v-for="n in nodosTronco" :key="n.id" class="nodo" :class="{ sel: t.etapaSel === n.id, fuera: n.estado === 'no-aplica' }"
           :data-etapa="n.id" tabindex="0" role="button" :aria-label="`etapa ${n.id}`"
           @click="t.etapaSel = n.id" @keydown.enter.prevent="t.etapaSel = n.id"
           @keydown.right.prevent="mover(1)" @keydown.left.prevent="mover(-1)">
          <g v-if="n.roto">
            <circle :cx="n.x" :cy="Y0" r="17" fill="none" stroke="var(--fail)" stroke-width="2" opacity=".6" />
            <text :x="n.x" :y="Y0 - 24" class="corte">se cortó acá</text>
          </g>
          <circle :cx="n.x" :cy="Y0" :r="RADIO" :fill="COLOR[n.estado]" />
          <text :x="n.x" :y="Y0 + 5" class="glifo">{{ GLIFO[n.estado] }}</text>
          <text :x="n.x" :y="Y0 + 28" class="nlbl">{{ n.id }}</text>
          <text :x="n.x" :y="Y0 + 41" class="ndet">{{ corto(n.vivo?.detail || n.label, 22) }}</text>
          <text v-if="n.vivo?.at" :x="n.x" :y="Y0 - 16" class="hora">{{ n.vivo.at }}</text>
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
.mapa { position:relative; height:100%; min-height:260px;
  overflow:auto; scrollbar-gutter:stable;
  /* ⚠ Sin `border-right`: el panel de logs ya trae su `border-left`, y las dos pintaban una al lado
     de la otra — medido, el mapa en 546–547 y el panel en 547–548, o sea una costura de 2px donde va
     un pelo de 1. Con el panel cerrado esa línea quedaba además pegada al borde de la ventana. */
  background:var(--panel2); user-select:none }
.vacio { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); font-size:12px }

.arista { stroke-width:2.5; stroke-linecap:round }
.nodo { cursor:pointer }
.nodo:hover .nlbl { fill:var(--info) }
.nodo:focus { outline:none }
.nodo:focus-visible .nlbl { fill:var(--info); text-decoration:underline }
.nodo.sel .nlbl { fill:var(--info); font-weight:700 }
/* Atenuado, NO escondido: «acá esto no ocurre nunca» es parte del diagnóstico. */
.nodo.fuera { opacity:.38 }
/* Un carril que esta solicitud no tomó se ve, pero no compite: es contexto, no recorrido. */
.apagado { opacity:.42 }

.glifo { font:600 11px ui-monospace,monospace; text-anchor:middle; fill:var(--bg) }
.nlbl { font:500 12px ui-monospace,monospace; fill:var(--txt); text-anchor:middle; letter-spacing:-.01em }
/* ⚠ `--dim` y no `--tenue`: el detalle del nodo es la RUTA de la etapa, o sea información que se
   lee. `--tenue` es el `muted-foreground` del tema y contra este fondo mide 4,41:1 — abajo de AA para
   10,5px. Medido en el navegador. `--tenue` queda para lo que de verdad es accesorio. */
.ndet { font:10.5px system-ui; fill:var(--dim); text-anchor:middle }
.hora { font:10px ui-monospace,monospace; fill:var(--tenue); text-anchor:middle }
.salto { font:10px ui-monospace,monospace; fill:var(--tenue); text-anchor:middle }
.clbl { font:600 12px system-ui; letter-spacing:-.01em }
.aqui { font-weight:400; font-size:11px; fill:var(--dim) }
.afuera { font:11px system-ui; fill:var(--dim) }
.corte { font:600 10px system-ui; fill:var(--fail); text-anchor:middle }

.dim { color:var(--dim) }
.recorte { color:var(--warn) }
</style>
