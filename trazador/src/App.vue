<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize } from './workbench.js'
import { useTrazador } from './stores/trazador'
import { traceToText } from './traceText'
import SearchBox from './components/SearchBox.vue'
import StageMap from './components/StageMap.vue'
import Detail from './components/Detail.vue'
import Recent from './components/Recent.vue'

const t = useTrazador()
// El mapa primero y solo: no toca ninguna fuente, así que el árbol se dibuja al instante y la app no
// arranca en blanco esperando a Redash. Después se mira la ruta: `/traza/:target/:cedula/:ureq` rearma esa corrida.
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
const checkSevere = computed(() => (t.mapa?.chequeo || []).filter((h) => h.grave))

// La persona siempre tiene una región preparada: evita que el mapa salte de ancho al empezar una
// búsqueda y deja claro desde el arranque dónde van a aparecer la ficha y las solicitudes. Cerrarla
// sigue siendo una preferencia explícita del operador, guardada en localStorage.
const hasColumn = computed(() => true)
const personResult = computed(() => {
  const people = Array.isArray(t.resultados?.personas) ? t.resultados.personas : []
  return people.length === 1 ? people[0] : null
})
const personTitle = computed(() => {
  if (t.traza) return 'Solicitud'
  if (t.fase) return 'Buscando'
  if (personResult.value) return 'Persona'
  if (t.resultados?.items?.length) return 'Solicitudes'
  return 'Persona'
})

/* El panel sigue en capa para que el mapa no tenga que relocalizar su DOM, pero el editor deja justo
   el ancho que el panel ocupa AHORA. Reservar siempre 380px hacía que, al achicar los logs, quedara un
   pasillo negro inútil entre ambos. El resizer ya publica cambios por frame y Mapa mide ese ancho en
   el siguiente frame: la estación conserva su celda y el lienzo recupera espacio de forma continua. */
const viewportWidth = ref(window.innerWidth)
const viewportHeight = ref(window.innerHeight)
const logsToggle = ref(null)
const personToggle = ref(null)
const recentToggle = ref(null)

// Las dos columnas comparten un presupuesto: el mapa nunca baja de 220px y, al ensanchar un sidebar,
// el otro cede sólo el espacio que le sobra. Si se arrastra por debajo de su mínimo, se pliega al borde
// pero conserva su último ancho para volver con el mismo tirador o con el botón de la barra de estado.
const MIN_WORKSPACE = 220
const PERSON_BASE = 300
const personOpen = readSize('trazador.persona', 1) !== 0
const personWidthSaved = readSize('trazador.persona.width', PERSON_BASE)
const personWidth = ref(personOpen ? personWidthSaved : 0)
const lastPersonWidth = ref(readSize('trazador.persona.last-open', personWidthSaved || PERSON_BASE))

const SIDEBAR_BASE = 380
const savedSidebarWidth = readSize('trazador.sidebar', SIDEBAR_BASE)
const sidebarWidth = ref(savedSidebarWidth)
const lastSidebarWidth = ref(readSize('trazador.sidebar.last-open', savedSidebarWidth || SIDEBAR_BASE))
const panelBudget = computed(() => Math.max(0, viewportWidth.value - MIN_WORKSPACE))
const visibleWidth = computed(() => Math.min(sidebarWidth.value,
  Math.max(0, panelBudget.value - Math.min(personWidth.value, panelBudget.value))))
const personWidthVisible = computed(() => Math.min(personWidth.value,
  Math.max(0, panelBudget.value - visibleWidth.value)))
const personClosed = computed(() => personWidthVisible.value < 1)
const maxPerson = computed(() => Math.max(0, panelBudget.value - visibleWidth.value))
const maxSidebar = computed(() => Math.max(0, panelBudget.value - personWidthVisible.value))

function hideLogs() {
  if (sidebarWidth.value) {
    lastSidebarWidth.value = sidebarWidth.value
    saveSize('trazador.sidebar.last-open', sidebarWidth.value)
  }
  sidebarWidth.value = 0
  logsToggle.value?.focus()
}
function toggleLogs() {
  if (sidebarWidth.value) hideLogs()
  else sidebarWidth.value = Math.min(lastSidebarWidth.value || SIDEBAR_BASE, maxSidebar.value)
}
function hidePerson() {
  if (personWidth.value) {
    lastPersonWidth.value = personWidth.value
    saveSize('trazador.persona.last-open', personWidth.value)
  }
  personWidth.value = 0
  personToggle.value?.focus()
}
function togglePerson() {
  if (personWidth.value) hidePerson()
  else personWidth.value = Math.min(lastPersonWidth.value || PERSON_BASE, maxPerson.value)
}
const closed = computed(() => visibleWidth.value < 1)
watch(sidebarWidth, (v) => {
  saveSize('trazador.sidebar', v)
  if (v > 0) {
    lastSidebarWidth.value = v
    saveSize('trazador.sidebar.last-open', v)
  }
})
watch(personWidth, (v) => {
  saveSize('trazador.persona.width', v)
  saveSize('trazador.persona', v > 0 ? 1 : 0)
  if (v > 0) {
    lastPersonWidth.value = v
    saveSize('trazador.persona.last-open', v)
  }
})
const personResize = computed(() => ({
  label: 'Ancho de la ficha', sign: 1, min: 240,
  max: maxPerson.value, defaultValue: PERSON_BASE, collapsible: true,
  get: () => personWidthVisible.value, set: (v) => { personWidth.value = v },
}))
const detailResize = computed(() => ({
  label: 'Ancho del panel de logs', sign: -1, min: 280,
  max: maxSidebar.value, defaultValue: SIDEBAR_BASE, collapsible: true,
  get: () => visibleWidth.value, set: (v) => { sidebarWidth.value = v },
}))
const PANEL_BASE = 184
const panelHeight = ref(readSize('trazador.recientes', PANEL_BASE))
const lastPanelHeight = ref(readSize('trazador.recientes.last-open', panelHeight.value || PANEL_BASE))
const maxPanel = computed(() => Math.max(116, viewportHeight.value - 300))
const panelHeightVisible = computed(() => Math.min(panelHeight.value, maxPanel.value))
const recentClosed = computed(() => panelHeightVisible.value < 1)
function hideRecent() {
  if (panelHeight.value) {
    lastPanelHeight.value = panelHeight.value
    saveSize('trazador.recientes.last-open', panelHeight.value)
  }
  panelHeight.value = 0
  recentToggle.value?.focus()
}
function toggleRecent() {
  if (panelHeight.value) hideRecent()
  else panelHeight.value = Math.min(lastPanelHeight.value || PANEL_BASE, maxPanel.value)
}
watch(panelHeight, (v) => {
  saveSize('trazador.recientes', v)
  if (v > 0) {
    lastPanelHeight.value = v
    saveSize('trazador.recientes.last-open', v)
  }
})
const panelResize = computed(() => ({
  axis: 'y', label: 'Altura de recientes', sign: -1, min: 116, max: maxPanel.value,
  defaultValue: PANEL_BASE, collapsible: true,
  get: () => panelHeightVisible.value, set: (v) => { panelHeight.value = v },
}))
const resizeWindow = () => { viewportWidth.value = window.innerWidth; viewportHeight.value = window.innerHeight }
onMounted(() => window.addEventListener('resize', resizeWindow))
onUnmounted(() => window.removeEventListener('resize', resizeWindow))

const GLYPH = { aprobado:'✓', roto:'✕', abandonado:'!', 'en-curso':'·' }
const CLASS = { aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip' }

// COPIAR LA TRAZA ENTERA como texto: hechos de BD + logs por paso + avisos, todo junto. El destino de una
// traza casi nunca es esta pantalla — se pega en un ticket, en Slack o en un prompt — y un screenshot no se
// puede grepear ni citar. El texto lo arma `traceText.js` desde el MISMO JSON que pinta la vista.
const copied = ref(false)
async function copyTrace() {
  const text = traceToText(t.traza, t.mapa)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Sin permiso de clipboard (http, iframe): el textarea invisible sigue funcionando en todos lados.
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
  copied.value = true
  setTimeout(() => (copied.value = false), 1800)
}
</script>

<template>

  <div class="cols" :class="{ cerrado: closed }" :style="{
    '--detail-width': `${Math.round(visibleWidth)}px`,
    '--persona-width': `${Math.round(personWidthVisible)}px`,
  }">
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

         La columna queda abierta desde el arranque: el estado inicial explica qué hacer y reserva
         un lugar estable para la ficha y la historia, sin hacer que el mapa salte al buscar. -->
    <aside v-if="hasColumn" v-show="!personClosed" class="sidebar persona-panel" aria-label="Persona y solicitudes">
      <div class="region-head">
        <span>{{ personTitle }}</span>
        <span v-if="t.traza" class="toolbar-note ureq-b">{{ t.traza.ureq }}</span>
        <div class="region-actions toolbar">
          <button type="button" class="region-action" title="Ocultar persona" aria-label="Ocultar persona" @click="hidePerson">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <div v-if="!t.fase && !t.error && !t.traza && !t.resultados" class="persona-vacia">
          <div class="empty-media" aria-hidden="true">⌕</div>
          <p>Buscá una cédula, teléfono o solicitud.</p>
          <span>La ficha y las corridas de esa persona aparecerán acá.</span>
        </div>
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
        <div v-for="h in checkSevere" :key="h.texto" class="alert alert-destructive mapaRoto" role="alert">
          <span class="alert-icon" aria-hidden="true">⚠</span>
          <div class="alert-title">El mapa dejó de resolver</div>
          <div class="alert-desc">{{ h.texto }} — <code>make trazador-chequeo</code></div>
        </div>

        <!-- LA FICHA. ⚠ Era un párrafo de una línea con seis datos separados por `·`: en 300px eso es
             un muro de cuatro renglones donde hay que buscar dónde empieza cada campo. Una fila por
             dato, con el rótulo apagado a la izquierda, se recorre con el ojo sin leer. -->
        <dl v-if="t.traza" class="meta">
          <div><dt>solicitud</dt><dd class="ureq-b">{{ t.traza.ureq }}</dd></div>
          <div v-if="t.traza.estadoN"><dt>estado</dt><dd>{{ t.traza.estadoN }}</dd></div>
          <div v-if="t.traza.perfilamiento"><dt>perfilamiento</dt><dd>{{ t.traza.perfilamiento }}</dd></div>
          <div v-if="t.traza.perfilesCupo?.length"><dt>perfil de cupo</dt><dd class="perfiles-cupo">
            <span v-for="profile in t.traza.perfilesCupo" :key="`${profile.entidad}:${profile.categoria}:${profile.cupo}`">
              <strong>{{ profile.categoria }}</strong><span class="dim"> · {{ profile.entidad }}</span><span v-if="profile.cupo > 0" class="dim"> · cupo ${{ Math.round(profile.cupo).toLocaleString('es-CO') }}</span>
            </span>
          </dd></div>
          <div v-if="t.traza.documento"><dt>cédula</dt><dd>{{ t.traza.documento }}</dd></div>
          <div v-if="t.traza.telefono"><dt>teléfono</dt><dd>{{ t.traza.telefono }}</dd></div>
          <div><dt>comercio</dt><dd>{{ t.traza.comercio }}</dd></div>
          <div><dt>sucursal</dt><dd>{{ t.traza.sucursal }}</dd></div>
          <div v-if="t.traza.lender"><dt>entidad</dt>
            <dd>{{ t.traza.lender }} <span class="dim">rt={{ t.traza.rt }}</span></dd></div>
          <div><dt>monto</dt><dd>{{ Math.round(t.traza.monto).toLocaleString('es-CO') }}</dd></div>
          <div><dt>canal</dt><dd>{{ t.traza.origen
            }}<span v-if="!t.traza.origenDerivado" class="dim"> (supuesto)</span></dd></div>
        </dl>
        <dl v-else-if="personResult" class="meta" aria-label="Ficha de la persona encontrada">
          <div v-if="personResult.documento"><dt>cédula</dt><dd>{{ personResult.documento }}</dd></div>
          <div v-if="personResult.telefono"><dt>teléfono</dt><dd>{{ personResult.telefono }}</dd></div>
          <div><dt>solicitudes</dt><dd>{{ t.resultados?.historia?.total ?? t.resultados?.items?.length ?? 0 }}</dd></div>
        </dl>

      </div>
    </aside>
    <div v-if="hasColumn" class="tirador tirador-persona rsz" v-resize="personResize" />

    <!-- El mapa recibe el ancho visible del panel para recuperar exactamente el espacio que se libera
         al arrastrarlo. Sus estaciones tienen celdas mínimas, de modo que nunca se aplastan. -->
    <!-- El mapa es el EDITOR y `Detalle` el AUXILIARYBAR, en el vocabulario de `taller.css`.
         ⚠ Acá decía que el mapa NO lleva la clase `.editor` a propósito, porque «su regla propia ya
         dice todo lo que la compartida diría». Era cierto mientras era un bloque solo: desde que
         tiene una barra arriba que no scrollea con él, la columna flex de `.editor` es exactamente
         lo que hace falta y el nombre sí cambia algo. -->
    <div class="workspace-main" :style="{ '--recent-height': `${Math.round(panelHeightVisible)}px` }">
    <section class="editor editor-mapa">
      <!-- EL ENCABEZADO DEL MAPA · acá vive lo que antes era el titlebar a lo ancho de la ventana.
           El buscador es lo ÚNICO que hace esta herramienta —escribís un id y ves la traza—, o sea
           es la barra de comandos del mapa, no un filtro sobre algo que ya está en pantalla.

           ⚠ El panel de logs pagaba por esta barra sin usarla: estaba arriba de las DOS columnas, así
           que el sidebar empezaba 44px más abajo por un buscador que no es suyo. -->
      <div class="region-head">
        <span>Trazador</span>
        <SearchBox />
        <div class="region-actions toolbar">
          <!-- ⚠ ICONO y no «⧉ copiar traza»: en una barra de acciones el botón es `.region-action`,
               24×24, y el texto se le parte adentro — el primer intento quedó con «copi / traz» en
               dos renglones, tapado por el panel de logs. Lo que dice, lo dice el `title`. -->
          <button v-if="t.traza" class="region-action copiar" aria-label="Copiar traza completa" :class="{ ok: copied }" @click="copyTrace"
                  :title="copied ? 'copiado' : 'Copiar la traza completa como texto: hechos de BD + logs por paso + avisos. Para pegar en un ticket o un prompt.'">
            <span class="ui-icon" :data-icon="copied ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <StageMap :cerrado="closed" :ancho-panel="visibleWidth" />
    </section>

    <!-- Recientes ocupa la consola inferior: es navegación de corridas, no contexto del inspector. -->
    <div class="tirador tirador-consola rsz" v-resize="panelResize" />
    <Recent id="trazador-recientes" v-show="!recentClosed" class="panel recientes-console"
               :style="{ height: `${Math.round(panelHeightVisible)}px` }" @close="hideRecent" />
    </div>

    <!-- El tirador viaja con el borde del panel. Con el sidebar cerrado queda pegado a la derecha y
         sigue sirviendo para volver a abrirlo, que es lo que evita que cerrarlo sea un camino de ida. -->
    <div class="tirador tirador-detalle rsz" v-resize="detailResize"
         :style="{ right: `${Math.round(visibleWidth)}px` }" />

    <!-- En capa sobre el mapa, no en el flujo: por eso ensancharlo lo TAPA en vez de deformarlo. -->
    <Detail id="trazador-logs" @close="hideLogs" v-show="!closed" class="auxiliarybar" :style="{ width: `${Math.round(visibleWidth)}px` }" />
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
      <span class="ico" :class="CLASS[t.traza.outcome]">{{ GLYPH[t.traza.outcome] }}</span>
      <span class="badge badge-outline" :class="CLASS[t.traza.outcome]">{{ t.traza.outcome }}</span>
      <span class="ureq">solicitud {{ t.traza.ureq }}</span>
    </template>
    <span v-if="t.traza?.ramal">carril <b>{{ t.traza.ramal }}</b></span>
    <span v-else-if="t.traza">sin carril todavía — se decide al elegir entidad</span>
    <!-- Las teclas se ven como teclas (`.kbd` de `taller.css`), no como texto que menciona teclas. -->
    <span class="sb-pista">clic abre la etapa · <kbd class="kbd">←</kbd><kbd class="kbd">→</kbd> recorren</span>
    <div class="layout-controls" role="group" aria-label="Regiones visibles">
      <button ref="personToggle" v-if="hasColumn" type="button" class="region-action" :aria-pressed="!personClosed"
              aria-label="Mostrar u ocultar la persona" title="Mostrar u ocultar la persona" @click="togglePerson">
        <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
      </button>
      <button ref="logsToggle" type="button" class="region-action" :aria-pressed="!closed" aria-controls="trazador-logs"
              aria-label="Mostrar u ocultar los logs" title="Mostrar u ocultar los logs" @click="toggleLogs">
        <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
      </button>
      <button ref="recentToggle" type="button" class="region-action" :aria-pressed="!recentClosed" aria-controls="trazador-recientes"
              aria-label="Mostrar u ocultar recientes" title="Mostrar u ocultar recientes" @click="toggleRecent">
        <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
      </button>
    </div>
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
  padding:var(--space-2) var(--space-3); gap:var(--space-2); flex-wrap:wrap; text-transform:none; letter-spacing:normal;
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
   `sidebar` de `taller.css` le pone el fondo y la columna flex; acá va sólo su ancho.
   El ancho tiene un mínimo de lectura, pero sí se puede arrastrar: en soporte hay comercios y
   perfilamientos largos. Por debajo del mínimo se pliega, igual que logs y recientes. */
.sidebar.persona-panel { flex:0 0 var(--persona-width); min-width:0; padding:0; gap:0; background:var(--card);
  border-right:1px solid var(--line); --region-bg:var(--card) }
.persona-panel > .region-head { min-height:42px; padding:0 12px; color:var(--txt); background:transparent;
  border:0; border-bottom:1px solid var(--line); border-radius:0 }
.persona-panel > .region-head > :first-child { font-size:13px; font-weight:650 }
.persona-panel > .region-head .region-action { border:1px solid transparent; border-radius:var(--r-sm); background:transparent }
.persona-panel > .region-head .region-action:hover { color:var(--primary); border-color:var(--line);
  background:var(--panel2) }
.persona-panel > .region-body { --historia-gutter:12px; --historia-gutter-doble:24px; padding:12px;
  display:flex; flex-direction:column; gap:14px; background:transparent; border:0; border-radius:0 }
.ureq-b { font-variant-numeric:tabular-nums }
.persona-vacia { margin:auto 0; display:flex; flex-direction:column; align-items:center; gap:7px;
  padding:20px 8px; color:var(--dim); text-align:center; font-size:12px; line-height:1.5 }
.persona-vacia .empty-media { margin:0 0 3px; width:32px; height:32px; font-size:15px }
.persona-vacia p { margin:0; color:var(--txt); font-weight:500 }
.persona-vacia span { max-width:220px }

/* LA FICHA, en filas. El rótulo apagado y angosto a la izquierda; el valor ocupa lo que queda y
   envuelve. ⚠ `min-width:0` en el valor: sin él, un nombre de comercio largo ensancha la fila y se
   sale de la columna en vez de partirse. */
.meta { margin:0; display:flex; flex-direction:column; gap:0; padding:0; font-size:12.5px;
  background:transparent; border:0; border-radius:0 }
.meta > div { display:flex; gap:8px; align-items:baseline; padding:7px 0 }
.meta > div + div { border-top:1px solid var(--line) }
.meta dt { flex:0 0 68px; color:var(--tenue); font-size:11px; text-transform:uppercase;
  letter-spacing:.05em }
.meta dd { margin:0; min-width:0; color:var(--txt); overflow-wrap:anywhere }
.meta dd.perfiles-cupo { display:flex; flex-direction:column; gap:3px }
.perfiles-cupo > span { overflow-wrap:anywhere }
.perfiles-cupo strong { font-weight:650; color:var(--txt) }

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
/* ⚠ NO ES UN GRID DE TRES COLUMNAS: el mapa y la consola están en flujo; el inspector sigue en capa.
   El área central deja lugar al inspector, sin una franja muerta al redimensionarlo. `flex:1` +
   `min-height:0`: sin el `min-height`, un hijo flex NO se achica por debajo de su
   contenido y el `overflow:auto` de adentro no se activa nunca — la página vuelve a estirarse y el
   mapa se va para arriba. Es la parte que siempre se olvida de este patrón. */
.cols { position:relative; flex:1; min-height:0; display:flex }
/* El margen vive en el área central, no en el mapa: la consola comparte exactamente el mismo ancho
   útil y ninguna de las dos regiones queda por debajo del inspector. */
.workspace-main { flex:1 1 0; display:flex; flex-direction:column; min-width:0; min-height:0;
  margin-right:var(--detail-width, 0px) }
.workspace-main .editor-mapa { flex:1 1 0; min-width:0; min-height:220px; height:auto; margin-right:0 }
.workspace-main .recientes-console { flex:none; min-height:0 }

/* En capa, pegado a la derecha y por encima del mapa, y un punto MÁS CLARO que él: es lo que lo hace
   leerse como algo que está encima y no como otra zona del mismo plano. */
.auxiliarybar { position:absolute; top:0; right:0; bottom:0; z-index:2;
  background:var(--card); border-left:1px solid var(--line);
  overflow-y:auto; scrollbar-gutter:stable }

.tirador { position:absolute; top:0; bottom:0; width:var(--rsz); margin-right:-2px; z-index:3 }
.tirador::before { left:-3px; right:-3px }
/* El borde de la ficha vive en el flujo, antes del mapa. Al estar siempre montado también permite
   recuperar la ficha arrastrando desde la izquierda cuando está plegada. */
.tirador-persona { position:relative; top:auto; right:auto !important; bottom:auto; width:var(--rsz);
  flex:none; margin:0 -2px; z-index:3 }
/* El segundo tirador es horizontal: arriba de la consola. Arrastrar hacia arriba le da más espacio a
   las corridas; queda montado aun cerrada, para poder restaurarla arrastrando desde el borde inferior. */
.tirador-consola { position:relative; top:auto; right:auto !important; bottom:auto; width:auto; height:var(--rsz);
  flex:none; margin:0; z-index:1 }
.tirador-consola::before { top:-3px; bottom:-3px; left:0; right:0 }
@media (max-width: 760px) {
  .statusbar .sb-pista { display: none }
  .editor-mapa > .region-head { padding: var(--space-2); gap: var(--space-2) }
}
/* (Acá había un `@media (max-width:860px) { .cols { grid-template-columns:1fr } }`. Era cromo muerto:
   `.cols` no es un grid —el panel va EN CAPA y el mapa en flujo—, así que esa declaración no tenía a
   quién aplicarle. Se fue con el barrido de estilos viejos.) */
</style>
