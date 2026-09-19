<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useTrazador } from './stores/trazador'
import { trazaATexto } from './trazaTexto'
import Buscador from './components/Buscador.vue'
import Historia from './components/Historia.vue'
import Mapa from './components/Mapa.vue'
import Detalle from './components/Detalle.vue'

const t = useTrazador()
// El mapa primero y solo: no toca ninguna fuente, así que el árbol se dibuja al instante y la app no
// arranca en blanco esperando a Redash. Después se mira la URL: si trae `?ureq=`, se rearma esa traza.
onMounted(async () => {
  await t.cargarMapa()
  t.desdeURL()
})

// LISTA O MAPA, y las dos conviven a propósito. La lista contesta «¿qué pasó en cada etapa?» mejor que
// nada —hora, salto, subs, eventos— y el mapa contesta «¿por dónde fue y dónde se cortó?», que una lista
// no puede. Reemplazar una por otra antes de saber cuál se usa es tirar algo que funciona: si el mapa
// gana, la lista se va sola, y eso se decide mirándolo, no ahora.
// EL MAPA PUEDE HABER DEJADO DE RESOLVER, y eso no se ve mirando la pantalla: el diagnóstico sale
// igual de prolijo, sólo que equivocado. Se muestra SÓLO lo grave (una etapa que nadie declara, una
// tabla que ya no existe) — los avisos de «mirá esto» viven en `make trazador-chequeo`, porque un
// cartel permanente deja de leerse y tapa a los que sí importan. Misma regla que el panel del harness.
const chequeoGrave = computed(() => (t.mapa?.chequeo || []).filter((h) => h.grave))

// La columna de la izquierda existe SÓLO cuando tiene algo adentro. Sin consultar nada, el mapa se
// queda con el ancho entero — que es la pantalla en la que uno lee el árbol declarado.
// ⚠ `items` y no `traza`: una búsqueda por cédula trae la historia de la persona ANTES de que haya
// una traza abierta, y ése es justo el momento en que la columna sirve para elegir cuál mirar.
const hayColumna = computed(() => Boolean(
  t.fase || t.traza || t.error || chequeoGrave.value.length || t.resultados?.items?.length))

/**
 * EL SIDEBAR SE MONTA SOBRE EL MAPA; NO LO EMPUJA.
 *
 * ⚠ El mapa tiene **dos anchos y nada más**: el 100 % con el sidebar cerrado, y el 100 % menos
 * `SIDEBAR_BASE` con el sidebar abierto. Ensanchar el sidebar más allá de su base **no reduce el
 * mapa**: lo tapa.
 *
 * Por qué, y es la diferencia con la versión anterior: el mapa se redibuja cuando cambia su ancho —la
 * separación entre nodos se recalcula—, así que si el sidebar lo empuja, **el dibujo entero se re-arma
 * en cada píxel del arrastre**. Se ve como un grafo que late mientras uno mueve el tirador, y además
 * la posición de cada nodo deja de ser estable justo cuando uno está mirándola. Con el sidebar como
 * capa, el mapa queda quieto: se recalcula UNA vez, al abrir o cerrar.
 */
const SIDEBAR_BASE = 380
const leerAncho = () => { try { const v = Number(localStorage.getItem('trazador.sidebar')); return Number.isFinite(v) && v >= 0 ? v : SIDEBAR_BASE } catch { return SIDEBAR_BASE } }
const anchoSidebar = ref(leerAncho())
// ⚠ Con try/catch: en una ventana privada o con las cookies bloqueadas el acceso a localStorage TIRA, y
// un layout que no arranca por no poder leer una preferencia es peor que uno que arranca con el default.
watch(anchoSidebar, (v) => { try { localStorage.setItem('trazador.sidebar', String(Math.round(v))) } catch { /* sin storage */ } })

/** Cerrado = 0. Es lo único que cambia el ancho del mapa, así que el mapa se entera de ESTO y no del
 *  ancho: ver `SIDEBAR_BASE` arriba. */
const cerrado = computed(() => anchoSidebar.value < 1)

const redimensionando = ref(false)
function tomarTirador() {
  redimensionando.value = true
  const mover = (e) => {
    // Se mide desde el BORDE DERECHO de la ventana, no como delta: así el tirador queda pegado al
    // cursor aunque el puntero se salga del elemento o se mueva más rápido que el render.
    const w = window.innerWidth - e.clientX
    // ⚠ Arrastrarlo hasta el borde CIERRA, y hay un umbral en vez de exigir el cero exacto: un sidebar
    // de 40px no sirve para nada y es imposible de agarrar de nuevo. Por debajo de la mitad de la base
    // se colapsa entero y el mapa pasa a ocupar todo.
    anchoSidebar.value = w < SIDEBAR_BASE / 2 ? 0 : Math.min(window.innerWidth - 220, Math.max(SIDEBAR_BASE, w))
  }
  const soltar = () => {
    redimensionando.value = false
    removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar)
  }
  addEventListener('pointermove', mover); addEventListener('pointerup', soltar)
}

const GLIFO = { aprobado:'✓', roto:'✕', abandonado:'!', 'en-curso':'·' }
const CLASE = { aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip' }

// COPIAR LA TRAZA ENTERA como texto: hechos de BD + logs por paso + avisos, todo junto. El destino de una
// traza casi nunca es esta pantalla — se pega en un ticket, en Slack o en un prompt — y un screenshot no se
// puede grepear ni citar. El texto lo arma `trazaTexto.js` desde el MISMO JSON que pinta la vista.
const copiado = ref(false)
async function copiar() {
  const texto = trazaATexto(t.traza, t.mapa)
  try {
    await navigator.clipboard.writeText(texto)
  } catch {
    // Sin permiso de clipboard (http, iframe): el textarea invisible sigue funcionando en todos lados.
    const ta = document.createElement('textarea')
    ta.value = texto
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copiado.value = true
  setTimeout(() => (copiado.value = false), 1800)
}
</script>

<template>

  <div class="cols" :class="{ midiendo: redimensionando, cerrado }">
    <!-- LA PERSONA · el sidebar izquierdo. Acá vive todo lo que NO es el recorrido: qué solicitud
         estás mirando, de quién es, y qué más intentó esa persona.

         ⚠ Esto era un BANNER a lo ancho de la ventana, arriba de todo — o sea un encabezado, que es
         justo lo que las cuatro herramientas terminaron de sacar. Tenía dos problemas medidos y los
         dos son del formato, no del contenido:
           · **le cobraba su alto al mapa y al panel de logs**, que no lo usan. Con una traza cargada
             eran ~170px de los que el mapa no veía uno;
           · **cambiaba de alto según el estado** —la espera, los datos, los avisos, la historia— así
             que el mapa se movía hacia abajo en cuanto buscabas. La regla que había escrita acá
             («región propia para que la barra del mapa no cambie de alto») trataba el síntoma:
             mientras sea una franja horizontal, lo que crezca empuja.
         En una columna, lo que crece scrollea y no mueve nada. Y de paso el contenido mejora: la
         ficha se lee como filas y la historia como una lista, que es lo que son.

         La columna aparece SÓLO cuando hay algo que decir: sin consultar, el mapa se queda con el
         ancho entero. Una columna vacía porque «está en la lista» es peor que no tenerla. -->
    <aside v-if="hayColumna" class="sidebar">
      <div class="region-head">
        <span>{{ t.traza ? 'Solicitud' : 'Buscando' }}</span>
        <span v-if="t.traza" class="badge badge-outline badge-xs ureq-b">{{ t.traza.ureq }}</span>
      </div>
      <div class="region-body">
        <!-- LA ESPERA, DICHA. Contra prod son ~20 s en dos saltos porque Redash es asíncrono; un spinner
             mudo tanto tiempo se lee como «se colgó». Cuál de los dos corre convierte la espera en
             información. Va acá, que es donde va a aparecer la respuesta. -->
        <div v-if="t.fase" class="cargando">
          <div class="progress progress-xs progress-ind barra"><i /></div>
          <span>{{ t.fase === 'buscando' ? 'buscando la solicitud…' : 'armando la traza: BD + logs…' }}</span>
          <span v-if="t.target === 'prod'" class="dim">prod pasa por la cola de Redash, tarda unos segundos</span>
        </div>

        <!-- AVISOS (`alert` de `taller.css`). ⚠ Y acá SÍ va el marco, que es lo contrario de lo que
             hicimos con los callouts de prosa: un alert es un mensaje que tiene que despegarse de lo
             que lo rodea, no una cita adentro de un texto. -->
        <div v-if="t.error" class="alert alert-destructive" role="alert">
          <span class="alert-icon" aria-hidden="true">✕</span>
          <div class="alert-title">No se pudo armar la traza</div>
          <div class="alert-desc">{{ t.error }}</div>
        </div>
        <div v-for="h in chequeoGrave" :key="h.texto" class="alert alert-destructive mapaRoto" role="alert">
          <span class="alert-icon" aria-hidden="true">⚠</span>
          <div class="alert-title">El mapa dejó de resolver</div>
          <div class="alert-desc">{{ h.texto }} — <code>make trazador-chequeo</code></div>
        </div>

        <!-- LA FICHA. ⚠ Era un párrafo de una línea con seis datos separados por `·`: en 300px eso es
             un muro de cuatro renglones donde hay que buscar dónde empieza cada campo. Una fila por
             dato, con el rótulo apagado a la izquierda, se recorre con el ojo sin leer. -->
        <dl v-if="t.traza" class="meta">
          <div><dt>comercio</dt><dd>{{ t.traza.comercio }}</dd></div>
          <div><dt>sucursal</dt><dd>{{ t.traza.sucursal }}</dd></div>
          <div v-if="t.traza.lender"><dt>entidad</dt>
            <dd>{{ t.traza.lender }} <span class="dim">rt={{ t.traza.rt }}</span></dd></div>
          <div><dt>monto</dt><dd>{{ Math.round(t.traza.monto).toLocaleString('es-CO') }}</dd></div>
          <div><dt>documento</dt><dd>{{ t.traza.documento }}</dd></div>
          <div><dt>canal</dt><dd>{{ t.traza.origen
            }}<span v-if="!t.traza.origenDerivado" class="dim"> (supuesto)</span></dd></div>
        </dl>

        <!-- La historia de la persona: sus solicitudes agrupadas por día. -->
        <Historia />
      </div>
    </aside>

    <!-- El mapa NO lleva el ancho del sidebar: sólo si está abierto o no. Así se recalcula una vez, al
         abrir o cerrar, y no en cada píxel del arrastre. -->
    <!-- El mapa es el EDITOR y `Detalle` el AUXILIARYBAR, en el vocabulario de `taller.css`.
         ⚠ Acá decía que el mapa NO lleva la clase `.editor` a propósito, porque «su regla propia ya
         dice todo lo que la compartida diría». Era cierto mientras era un bloque solo: desde que
         tiene una barra arriba que no scrollea con él, la columna flex de `.editor` es exactamente
         lo que hace falta y el nombre sí cambia algo. -->
    <section class="editor editor-mapa">
      <!-- EL ENCABEZADO DEL MAPA · acá vive lo que antes era el titlebar a lo ancho de la ventana.
           El buscador es lo ÚNICO que hace esta herramienta —escribís un id y ves la traza—, o sea
           es la barra de comandos del mapa, no un filtro sobre algo que ya está en pantalla.

           ⚠ El panel de logs pagaba por esta barra sin usarla: estaba arriba de las DOS columnas, así
           que el sidebar empezaba 44px más abajo por un buscador que no es suyo. -->
      <div class="region-head">
        <span>Trazador</span>
        <Buscador />
        <div class="region-actions">
          <!-- ⚠ ICONO y no «⧉ copiar traza»: en una barra de acciones el botón es `.region-action`,
               24×24, y el texto se le parte adentro — el primer intento quedó con «copi / traz» en
               dos renglones, tapado por el panel de logs. Lo que dice, lo dice el `title`. -->
          <button v-if="t.traza" class="region-action copiar" :class="{ ok: copiado }" @click="copiar"
                  :title="copiado ? 'copiado' : 'Copiar la traza completa como texto: hechos de BD + logs por paso + avisos. Para pegar en un ticket o un prompt.'">
            {{ copiado ? '✓' : '⧉' }}
          </button>
        </div>
      </div>
      <Mapa :cerrado="cerrado" />
    </section>

    <!-- El tirador viaja con el borde del panel. Con el sidebar cerrado queda pegado a la derecha y
         sigue sirviendo para volver a abrirlo, que es lo que evita que cerrarlo sea un camino de ida. -->
    <div class="tirador" role="separator" aria-orientation="vertical"
         :aria-label="cerrado ? 'Abrir el panel de logs' : 'Ancho del panel de logs'"
         :style="{ right: `${Math.round(anchoSidebar)}px` }"
         :title="cerrado ? 'abrir los logs' : 'arrastrar para ensanchar · doble clic para cerrar'"
         @pointerdown.prevent="tomarTirador"
         @dblclick="anchoSidebar = cerrado ? SIDEBAR_BASE : 0" />

    <!-- En capa sobre el mapa, no en el flujo: por eso ensancharlo lo TAPA en vez de deformarlo. -->
    <Detalle v-show="!cerrado" class="auxiliarybar" :style="{ width: `${Math.round(anchoSidebar)}px` }" />
  </div>

  <!-- STATUSBAR · lo que vale para TODA la pantalla y nunca scrollea: contra qué ambiente estás
       mirando, qué carril tomó la solicitud y cómo se recorre el mapa.

       ⚠ Esto flotaba ENCIMA del mapa, abajo a la izquierda. Un texto sobre el lienzo compite con lo
       dibujado y se pisa con los rótulos de los carriles de abajo; en una barra propia se lee sin
       taparle nada al mapa, y el ambiente deja de estar escondido dentro del buscador. -->
  <footer class="statusbar">
    <!-- ⚠ La solicitud y su desenlace VIVEN ACÁ desde que no hay titlebar. Antes estaban arriba y este
         renglón los evitaba a propósito para no repetirlos; ahora son justo lo que le falta — qué
         estás mirando y cómo terminó, sin gastar una barra entera en decirlo. -->
    <strong :class="{ prod: t.target === 'prod' }">{{ t.target }}</strong>
    <template v-if="t.traza">
      <span class="ico" :class="CLASE[t.traza.outcome]">{{ GLIFO[t.traza.outcome] }}</span>
      <span class="badge badge-outline" :class="CLASE[t.traza.outcome]">{{ t.traza.outcome }}</span>
      <span class="ureq">solicitud {{ t.traza.ureq }}</span>
    </template>
    <span v-if="t.traza?.ramal">carril <b>{{ t.traza.ramal }}</b></span>
    <span v-else-if="t.traza">sin carril todavía — se decide al elegir entidad</span>
    <!-- Las teclas se ven como teclas (`.kbd` de `taller.css`), no como texto que menciona teclas. -->
    <span class="sb-pista">clic abre la etapa · <kbd class="kbd">←</kbd><kbd class="kbd">→</kbd> recorren</span>
  </footer>

</template>

<style scoped>
/* Compacto: cada píxel de arriba se lo come el mapa, que es lo que uno mira. */
/* ⚠ LAS SUPERFICIES TIENEN QUE ESCALONARSE, y medirlo es la única forma de saber si pasa. La primera
   versión de esto puso `--panel2` en el header, el mapa Y el panel: los tres quedaron en la misma
   luminancia (12 sobre 255) y con ellos el input, que se supone HUNDIDO, dejó de distinguirse de su
   contenedor. Sin color, la profundidad es lo único que separa una capa de otra.

   La escalera, medida:  fondo 9  ·  lienzo del mapa 12  ·  header y panel 19  ·  tarjeta 24. */
/* EL MAPA ES UNA REGIÓN, con su encabezado y su cuerpo. La clase `.editor` le trae de `taller.css`
   la columna flex; lo de acá es lo propio.
   ⚠ Acá decía que etiquetarlo `.editor` no agregaba nada y por eso se había sacado. Era cierto
   mientras el mapa era un solo bloque: hoy tiene una barra arriba que NO tiene que scrollear con él,
   y eso es exactamente lo que la regla compartida resuelve. */
.editor-mapa { height:100%; background:var(--panel2) }
/* ⚠ `height:auto` y `flex:1`: `.mapa` se dibuja con `height:100%`, que dentro de una columna flex
   con alto definido significa «todo el alto del contenedor» — o sea el encabezado de arriba, por
   encima. Se ve como un mapa recortado abajo, no como un error. */
.editor-mapa > :deep(.mapa) { height:auto; flex:1 1 0; min-height:0 }
/* El encabezado se queda con la superficie del viejo titlebar (el escalón 19 de la escalera de
   arriba), para que siga leyéndose como una barra y no como el lienzo. ⚠ `height:auto` y
   `overflow:visible` contra la regla compartida: el buscador suma renglones —«coincidió como…», los
   recientes— y una barra de una línea los recortaría. */
.editor-mapa > .region-head { height:auto; overflow:visible; background:var(--card);
  padding:10px 18px; gap:12px; flex-wrap:wrap; text-transform:none; letter-spacing:normal;
  font-size:14px }
/* El nombre NO se queda con el espacio: lo quiere el buscador. (La regla compartida le da `flex:1`
   al primer hijo, que es lo correcto cuando el primer hijo es el título de una lista.) */
.editor-mapa > .region-head > :first-child { flex:none; font-weight:600; letter-spacing:-.01em;
  color:var(--txt) }
/* ⚠ El buscador NO envuelve dentro de la barra. Su regla propia es `flex-wrap: wrap` —correcto
   cuando era una fila entera para él— y acá partía la caja del `prod ▾ buscar` a un segundo renglón:
   el encabezado terminaba MÁS alto (107px) que las dos filas que vino a reemplazar (97px). */
.editor-mapa :deep(.buscador) { flex:1 1 340px; min-width:0; flex-wrap:nowrap }
.editor-mapa :deep(.buscador input) { flex:1 1 auto; min-width:0 }

/* ⚠ El alto sale del token compartido a mano: `taller.css` se lo pone a `.workbench > .statusbar`,
   y el trazador arma su layout con `#app` en flex, no con la grilla. Sin esto quedaba en 18px contra
   los 26 de las otras tres — el mismo elemento con dos alturas según la herramienta. */
.statusbar { height:var(--statusbar-h) }
.statusbar strong { color:var(--dim); font-weight:600; text-transform:uppercase; letter-spacing:.06em;
  font-size:10.5px }
.statusbar strong.prod { color:var(--warn) }
.statusbar b { color:var(--txt); font-weight:600 }
/* La pista de teclado al borde: es ayuda, no estado — lo último que se lee. */
.sb-pista { margin-left:auto; color:var(--tenue) }
/* El desenlace en el statusbar: el icono baja de 20 a 16px y la píldora pierde aire. En sus tamaños
   de tarjeta no entran en los 26px de la barra y la estiran, que es justo lo que esa barra no hace. */
.statusbar .ico { flex:0 0 16px; height:16px; font-size:10px }
.statusbar .badge { padding:1px 8px; font-size:10.5px }
.ureq { color:var(--dim); font-size:13px; font-variant-numeric:tabular-nums }
/* El resto lo pone `.region-action` (24×24, sin borde). Acá sólo el verde del acuse. */
.copiar { color:var(--dim); transition:color .12s }
.copiar:hover { color:var(--txt) }
.copiar.ok { color:var(--ok) }

/* ── LA COLUMNA DE LA IZQUIERDA ─────────────────────────────────────────────────────────────────
   `sidebar` de `taller.css` le pone el fondo y la columna flex; acá va sólo su ancho y el aire.
   ⚠ El ancho es FIJO y no arrastrable, a diferencia del panel de logs. No es un olvido: lo que hay
   acá tiene un largo conocido —seis campos y una lista de chips— así que ensancharla no muestra más.
   El panel de logs sí, porque adentro hay líneas de largo arbitrario. */
.sidebar { flex:0 0 var(--sidebar-w); border-right:1px solid var(--line) }
.sidebar > .region-body { padding:10px 14px 16px; display:flex; flex-direction:column; gap:12px }
.ureq-b { font-variant-numeric:tabular-nums }

/* LA FICHA, en filas. El rótulo apagado y angosto a la izquierda; el valor ocupa lo que queda y
   envuelve. ⚠ `min-width:0` en el valor: sin él, un nombre de comercio largo ensancha la fila y se
   sale de la columna en vez de partirse. */
.meta { margin:0; display:flex; flex-direction:column; gap:3px; font-size:12.5px }
.meta > div { display:flex; gap:8px; align-items:baseline }
.meta dt { flex:0 0 68px; color:var(--tenue); font-size:11px; text-transform:uppercase;
  letter-spacing:.05em }
.meta dd { margin:0; min-width:0; color:var(--txt); overflow-wrap:anywhere }

.cargando { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--dim) }
/* `progress progress-xs progress-ind` de `taller.css` — la pista, el filete de 3px y el movimiento
   indeterminado salen de ahí. Lo único propio es que NO ocupa el ancho: vive en un renglón junto al
   texto de la espera, así que es un ancho fijo y no crece con él.
   *(Acá el relleno era `--info`, el azul. Se fue con el componente: era decoración, no significado —
   lo que la barra dice, «sigue vivo», ya lo dice el movimiento.)* */
.barra { width:120px; flex:0 0 120px }
/* Sobre `.alert`: sólo el tamaño, que en una columna de 300px es más chico. */
.sidebar .alert { font-size:12.5px }
.sidebar .alert-desc { font-size:12.5px }
.mapaRoto code { background:var(--elev); padding:1px 6px;
  border-radius:var(--r-sm); font-size:11.5px }
/* ⚠ NO ES UN GRID DE TRES COLUMNAS: es el mapa en flujo y el panel EN CAPA encima.
   El mapa sólo tiene dos anchos —todo, o todo menos la base del sidebar—, así que su dibujo se
   recalcula al abrir o cerrar y no en cada píxel del arrastre. Un grid haría lo contrario: cada
   movimiento del tirador cambiaría la columna del mapa y el grafo se re-armaría entero, latiendo.
   ⚠ `flex:1` + `min-height:0`: sin el `min-height`, un hijo flex NO se achica por debajo de su
   contenido y el `overflow:auto` de adentro no se activa nunca — la página vuelve a estirarse y el
   mapa se va para arriba. Es la parte que siempre se olvida de este patrón. */
.cols { position:relative; flex:1; min-height:0; display:flex }
/* ⚠ Al mapa se le deja lugar con `margin-right` y no con `width: calc(…)`, y esa es la pieza que
   mantiene el invariante de arriba: el panel está EN CAPA, así que el mapa sigue teniendo dos anchos
   y nada más —todo, o todo menos la base— y se recalcula al abrir o cerrar, no en cada píxel del
   arrastre. (Antes el reparto colgaba de `> :first-child`, que era el mapa; con la columna de la
   izquierda delante, ese selector pasaba a apuntarle a ELLA.) */
.editor-mapa { flex:1 1 0; min-width:0; margin-right:380px }
.cols.cerrado .editor-mapa { margin-right:0 }

/* En capa, pegado a la derecha y por encima del mapa, y un punto MÁS CLARO que él: es lo que lo hace
   leerse como algo que está encima y no como otra zona del mismo plano. */
.auxiliarybar { position:absolute; top:0; right:0; bottom:0; z-index:2;
  background:var(--card); border-left:1px solid var(--line);
  overflow-y:auto; scrollbar-gutter:stable }

.cols.midiendo { cursor:col-resize; user-select:none }
/* El tirador va sobre el panel (z-index mayor) y con una zona de agarre más ancha que su línea: 5px de
   línea se ven bien y se agarran mal. */
.tirador { position:absolute; top:0; bottom:0; width:11px; margin-right:-3px; z-index:3;
  cursor:col-resize; background:transparent; display:flex; justify-content:center }
.tirador::before { content:''; width:5px; background:var(--line); transition:background .12s }
.tirador:hover::before, .cols.midiendo .tirador::before { background:var(--info) }
/* (Acá había un `@media (max-width:860px) { .cols { grid-template-columns:1fr } }`. Era cromo muerto:
   `.cols` no es un grid —el panel va EN CAPA y el mapa en flujo—, así que esa declaración no tenía a
   quién aplicarle. Se fue con el barrido de estilos viejos.) */
</style>
