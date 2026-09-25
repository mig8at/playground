<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { vResize, readSize, saveSize, fitRegions, regionSize, reopenSize, cssSize, bindThemeToggle } from './workbench.js'
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
  await t.loadMap()
  t.fromURL()
})

// LISTA O MAPA, y las dos conviven a propósito. La lista contesta «¿qué pasó en cada etapa?» mejor que
// nada —hora, salto, subs, eventos— y el mapa contesta «¿por dónde fue y dónde se cortó?», que una lista
// no puede. Reemplazar una por otra antes de saber cuál se usa es tirar algo que funciona: si el mapa
// gana, la lista se va sola, y eso se decide mirándolo, no ahora.
// EL MAPA PUEDE HABER DEJADO DE RESOLVER, y eso no se ve mirando la pantalla: el diagnóstico sale
// igual de prolijo, sólo que equivocado. Se muestra SÓLO lo grave (una etapa que nadie declara, una
// tabla que ya no existe) — los avisos de «mirá esto» viven en `make trazador-chequeo`, porque un
// cartel permanente deja de leerse y tapa a los que sí importan. Misma regla que el panel del harness.
const checkSevere = computed(() => (t.stageMap?.check || []).filter((h) => h.grave))

// La persona siempre tiene una región preparada: evita que el mapa salte de ancho al empezar una
// búsqueda y deja claro desde el arranque dónde van a aparecer la ficha y las solicitudes. Cerrarla
// sigue siendo una preferencia explícita del operador, guardada en localStorage.
const hasColumn = computed(() => true)
const personResult = computed(() => {
  const people = Array.isArray(t.results?.people) ? t.results.people : []
  return people.length === 1 ? people[0] : null
})
const personTitle = computed(() => {
  if (t.trace) return 'Solicitud'
  if (t.phase) return 'Buscando'
  if (personResult.value) return 'Persona'
  if (t.results?.items?.length) return 'Solicitudes'
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

// Las dos columnas comparten un presupuesto con el mapa, con la regla de `workbench.js`: mínimo o nada.
// `personWidth` y `sidebarWidth` guardan lo que eligió la persona (0 = plegada) y lo que se pinta sale
// de `fitRegions`: si la ventana no alcanza, primero se achican, después se pliegan los logs y al
// final la ficha; el mapa conserva `--editor-min`. Un plegado por falta de lugar no pisa la preferencia.
const PERSON_BASE = 300
const personOpen = readSize('trazador.persona', 1) !== 0
const personWidthSaved = readSize('trazador.persona.width', PERSON_BASE)
const personWidth = ref(personOpen ? personWidthSaved : 0)
const lastPersonWidth = ref(readSize('trazador.persona.last-open', personWidthSaved || PERSON_BASE))

const SIDEBAR_BASE = 380
const savedSidebarWidth = readSize('trazador.sidebar', SIDEBAR_BASE)
const sidebarWidth = ref(savedSidebarWidth)
const lastSidebarWidth = ref(readSize('trazador.sidebar.last-open', savedSidebarWidth || SIDEBAR_BASE))
const sideMin = () => cssSize('--sidebar-min', 240)
const panelBudget = computed(() => Math.max(0, viewportWidth.value - cssSize('--editor-min', 360)))
const shownColumns = computed(() => {
  const [logs, person] = fitRegions(panelBudget.value, [
    { size: sidebarWidth.value, min: sideMin() },
    { size: hasColumn.value ? personWidth.value : 0, min: sideMin() },
  ])
  return { logs, person }
})
const visibleWidth = computed(() => shownColumns.value.logs)
const personWidthVisible = computed(() => shownColumns.value.person)
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
  if (visibleWidth.value) return hideLogs()
  // Abrir lo que no entra pliega la del otro lado: el pedido es explícito y gana.
  if (!reopenSize(lastSidebarWidth.value, sideMin(), maxSidebar.value, SIDEBAR_BASE)) personWidth.value = 0
  sidebarWidth.value = reopenSize(lastSidebarWidth.value, sideMin(), Infinity, SIDEBAR_BASE)
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
  if (personWidthVisible.value) return hidePerson()
  if (!reopenSize(lastPersonWidth.value, sideMin(), maxPerson.value, PERSON_BASE)) sidebarWidth.value = 0
  personWidth.value = reopenSize(lastPersonWidth.value, sideMin(), Infinity, PERSON_BASE)
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
  label: 'Ancho de la ficha', sign: 1, min: sideMin,
  max: maxPerson.value, defaultValue: PERSON_BASE, reopen: () => lastPersonWidth.value,
  get: () => personWidthVisible.value, set: (v) => { personWidth.value = v },
}))
const detailResize = computed(() => ({
  label: 'Ancho del panel de logs', sign: -1, min: sideMin,
  max: maxSidebar.value, defaultValue: SIDEBAR_BASE, reopen: () => lastSidebarWidth.value,
  get: () => visibleWidth.value, set: (v) => { sidebarWidth.value = v },
}))
const PANEL_BASE = 184
// Una altura guardada con el mínimo viejo (116) sube al nuevo en vez de plegarse: estaba abierta.
const savedPanel = readSize('trazador.recientes', PANEL_BASE)
const panelHeight = ref(savedPanel > 0 ? Math.max(savedPanel, cssSize('--panel-min', 124)) : 0)
const lastPanelHeight = ref(readSize('trazador.recientes.last-open', panelHeight.value || PANEL_BASE))
const panelMin = () => cssSize('--panel-min', 124)
const maxPanel = computed(() => Math.max(0, viewportHeight.value - 300))
const panelHeightVisible = computed(() => regionSize(panelHeight.value, panelMin(), maxPanel.value))
const recentClosed = computed(() => panelHeightVisible.value < 1)
const recentPanel = ref(null)
function hideRecent() {
  recentPanel.value?.restore()
  if (panelHeight.value) {
    lastPanelHeight.value = panelHeight.value
    saveSize('trazador.recientes.last-open', panelHeight.value)
  }
  panelHeight.value = 0
  recentToggle.value?.focus()
}
function toggleRecent() {
  if (panelHeightVisible.value) hideRecent()
  else panelHeight.value = reopenSize(lastPanelHeight.value, panelMin(), Infinity, PANEL_BASE)
}
watch(panelHeight, (v) => {
  saveSize('trazador.recientes', v)
  if (v > 0) {
    lastPanelHeight.value = v
    saveSize('trazador.recientes.last-open', v)
  }
})
const panelResize = computed(() => ({
  axis: 'y', label: 'Altura de recientes', sign: -1, min: panelMin, max: maxPanel.value,
  defaultValue: PANEL_BASE, reopen: () => lastPanelHeight.value,
  get: () => panelHeightVisible.value, set: (v) => { panelHeight.value = v },
}))
const resizeWindow = () => { viewportWidth.value = window.innerWidth; viewportHeight.value = window.innerHeight }
onMounted(() => window.addEventListener('resize', resizeWindow))
onUnmounted(() => window.removeEventListener('resize', resizeWindow))

// El desenlace es un DATO en castellano; la clase que lo pinta sale de esta tabla, nunca del dato.
const CLASS = { aprobado:'ok', roto:'fail', abandonado:'warn', 'en-curso':'skip' }

// El botón de tema del pie, el de la base: el renglón de `THEME_BOOT` ya aplicó el tema antes de
// pintar (lo inyecta `vite.config.js`), y esto sólo lo alterna y lo recuerda.
const themeToggle = ref(null)
let themeBinding = null
onMounted(() => { if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value) })
onUnmounted(() => themeBinding?.destroy())

// COPIAR LA TRAZA ENTERA como texto: hechos de BD + logs por paso + avisos, todo junto. El destino de una
// traza casi nunca es esta pantalla — se pega en un ticket, en Slack o en un prompt — y un screenshot no se
// puede grepear ni citar. El texto lo arma `traceText.js` desde el MISMO JSON que pinta la vista.
const copied = ref(false)
async function copyTrace() {
  const text = traceToText(t.trace, t.stageMap)
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

  <div class="columns" :style="{
    '--detail-width': `${Math.round(visibleWidth)}px`,
    '--person-width': `${Math.round(personWidthVisible)}px`,
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
    <aside v-if="hasColumn" v-show="!personClosed" class="sidebar person-panel" aria-label="Persona y solicitudes">
      <div class="region-head">
        <span>{{ personTitle }}</span>
        <span v-if="t.trace" class="toolbar-note ureq-id">{{ t.trace.ureq }}</span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Ocultar persona" aria-label="Ocultar persona" @click="hidePerson">
            <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="region-body">
        <!-- El estado vacío es el de la base (`.empty`): título y descripción, sin caja ni medio. Es el
             único título de la pantalla vacía: los otros estados vacíos dicen lo suyo en una línea. -->
        <div v-if="!t.phase && !t.error && !t.trace && !t.results" class="empty">
          <div class="empty-head">
            <div class="empty-title">Buscá una cédula, teléfono o solicitud</div>
            <div class="empty-desc">La ficha y las corridas de esa persona aparecerán acá.</div>
          </div>
        </div>
        <!-- LA ESPERA, DICHA. Contra prod son ~20 s en dos saltos porque Redash es asíncrono; un spinner
             mudo tanto tiempo se lee como «se colgó». Cuál de los dos corre convierte la espera en
             información. Va acá, que es donde va a aparecer la respuesta. -->
        <div v-if="t.phase" class="loading">
          <div class="progress progress-xs progress-ind loading-bar"><i /></div>
          <span>{{ t.phase === 'buscando' ? 'buscando la solicitud…' : 'armando la traza: BD + logs…' }}</span>
          <span v-if="t.target === 'prod'" class="dim">prod pasa por la cola de Redash, tarda unos segundos</span>
        </div>

        <!-- AVISOS (`alert` de la base): una barra a la izquierda y un tinte, cuadrado. Sin icono: la
             base no tiene uno de aviso y un carácter (✕ ⚠) no es un icono. -->
        <div v-if="t.error" class="alert alert-destructive" role="alert">
          <div class="alert-title">No se pudo armar la traza</div>
          <div class="alert-desc">{{ t.error }}</div>
        </div>
        <div v-for="h in checkSevere" :key="h.text" class="alert alert-destructive map-broken" role="alert">
          <div class="alert-title">El mapa dejó de resolver</div>
          <div class="alert-desc">{{ h.text }} — <code>make trazador-chequeo</code></div>
        </div>

        <!-- LA FICHA. ⚠ Era un párrafo de una línea con seis datos separados por `·`: en 300px eso es
             un muro de cuatro renglones donde hay que buscar dónde empieza cada campo. Una fila por
             dato, con el rótulo apagado a la izquierda, se recorre con el ojo sin leer. -->
        <dl v-if="t.trace" class="meta">
          <div><dt>solicitud</dt><dd class="ureq-id">{{ t.trace.ureq }}</dd></div>
          <div v-if="t.trace.statusN"><dt>estado</dt><dd>{{ t.trace.statusN }}</dd></div>
          <div v-if="t.trace.profiling"><dt>perfilamiento</dt><dd>{{ t.trace.profiling }}</dd></div>
          <div v-if="t.trace.quotaProfiles?.length"><dt>perfil de cupo</dt><dd class="quota-profiles">
            <span v-for="profile in t.trace.quotaProfiles" :key="`${profile.entity}:${profile.category}:${profile.quota}`">
              <strong>{{ profile.category }}</strong><span class="dim"> · {{ profile.entity }}</span><span v-if="profile.quota > 0" class="dim"> · cupo ${{ Math.round(profile.quota).toLocaleString('es-CO') }}</span>
            </span>
          </dd></div>
          <div v-if="t.trace.document"><dt>cédula</dt><dd>{{ t.trace.document }}</dd></div>
          <div v-if="t.trace.phone"><dt>teléfono</dt><dd>{{ t.trace.phone }}</dd></div>
          <div><dt>comercio</dt><dd>{{ t.trace.merchant }}</dd></div>
          <div><dt>sucursal</dt><dd>{{ t.trace.branch }}</dd></div>
          <div v-if="t.trace.lender"><dt>entidad</dt>
            <dd>{{ t.trace.lender }} <span class="dim">rt={{ t.trace.rt }}</span></dd></div>
          <div><dt>monto</dt><dd>{{ Math.round(t.trace.amount).toLocaleString('es-CO') }}</dd></div>
          <div><dt>canal</dt><dd>{{ t.trace.origin
            }}<span v-if="!t.trace.derivedOrigin" class="dim"> (supuesto)</span></dd></div>
        </dl>
        <dl v-else-if="personResult" class="meta" aria-label="Ficha de la persona encontrada">
          <div v-if="personResult.document"><dt>cédula</dt><dd>{{ personResult.document }}</dd></div>
          <div v-if="personResult.phone"><dt>teléfono</dt><dd>{{ personResult.phone }}</dd></div>
          <div><dt>solicitudes</dt><dd>{{ t.results?.history?.total ?? t.results?.items?.length ?? 0 }}</dd></div>
        </dl>

      </div>
    </aside>
    <div v-if="hasColumn" class="handle handle-person rsz" v-resize="personResize" />

    <!-- El mapa es el EDITOR y `Detail` el AUXILIARYBAR, en el vocabulario de la base. La columna
         central (`.workspace`) apila el mapa, su manija y la consola; es también la raíz que tapa la
         consola maximizada (ver `Recent.vue`). -->
    <div class="workspace" :style="{ '--recent-height': `${Math.round(panelHeightVisible)}px` }">
    <section class="editor editor-map">
      <!-- LA BANDA DEL MAPA · acá vive lo que antes era el titlebar a lo ancho de la ventana. El
           buscador es lo ÚNICO que hace esta herramienta —escribís un id y ves la traza—, o sea es la
           barra de comandos del mapa, no un filtro sobre algo que ya está en pantalla. Mide 40 como las
           otras columnas: sus controles son los de una banda (28). -->
      <div class="region-head">
        <span title="Clic abre la etapa · ← → recorren las etapas">Mapa</span>
        <SearchBox />
        <div class="region-actions">
          <!-- ⚠ ICONO y no «⧉ copiar traza»: en una barra de acciones el botón es `.region-action`,
               24×24, y el texto se le parte adentro — el primer intento quedó con «copi / traz» en
               dos renglones, tapado por el panel de logs. Lo que dice, lo dice el `title`. -->
          <button v-if="t.trace" class="region-action copy-trace" aria-label="Copiar traza completa" :class="{ ok: copied }" @click="copyTrace"
                  :title="copied ? 'copiado' : 'Copiar la traza completa como texto: hechos de BD + logs por paso + avisos. Para pegar en un ticket o un prompt.'">
            <span class="ui-icon" :data-icon="copied ? 'check' : 'copy'" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <!-- LA SUBBANDA dice CÓMO coincidió la búsqueda. El mismo número puede ser una cédula y un id de
           solicitud, y un buscador que elige en silencio muestra la solicitud de otra persona con total
           seguridad. ⚠ Vivía adentro de la banda y la hacía crecer a dos renglones: acá es la subbanda
           de 32 de la base, que existe sólo cuando hay una búsqueda. -->
      <div v-if="t.results" class="subband match">
        <span v-if="t.results.as?.length" class="grow">
          <span :class="{ warn: t.results.as.length > 1 }">coincidió como {{ t.results.as.join(' y ') }}</span>
          <span v-if="t.results.as.length > 1"> — mirá bien cuál buscabas</span>
        </span>
        <span v-else class="grow">sin coincidencias en {{ t.results.target }}</span>
        <span class="count">fuente {{ t.results.source }}</span>
      </div>
      <StageMap :closed="closed" :panel-width="visibleWidth" />
    </section>

    <!-- Recientes ocupa la consola inferior: es navegación de corridas, no contexto del inspector. Su
         manija va marcada `data-rsz="panel"`: la base la esconde mientras la consola está maximizada. -->
    <div class="handle handle-panel rsz" data-rsz="panel" v-resize="panelResize" />
    <Recent ref="recentPanel" id="trazador-recent" v-show="!recentClosed" class="panel recent-panel"
               :style="{ height: `${Math.round(panelHeightVisible)}px` }" @close="hideRecent" />
    </div>

    <!-- El tirador viaja con el borde del panel. Con el sidebar cerrado queda pegado a la derecha y
         sigue sirviendo para volver a abrirlo, que es lo que evita que cerrarlo sea un camino de ida. -->
    <div class="handle handle-detail rsz" v-resize="detailResize"
         :style="{ right: `${Math.round(visibleWidth)}px` }" />

    <!-- ⚠ DESVIACIÓN DECLARADA: el secundario va EN CAPA sobre el mapa, no en el flujo. Así ensancharlo
         no relocaliza el DOM del mapa (el grafo no se rearma entero en cada píxel del arrastre); la
         columna central sólo le deja el ancho que ocupa ahora (`--detail-width`). -->
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
         estás mirando y cómo terminó, sin gastar una barra entera en decirlo. (El círculo con ✓/✕ de
         al lado se fue: la píldora ya dice el desenlace, en texto y en color.) -->
    <strong :class="{ prod: t.target === 'prod' }">{{ t.target }}</strong>
    <template v-if="t.trace">
      <span class="badge badge-outline badge-xs" :class="CLASS[t.trace.outcome]">{{ t.trace.outcome }}</span>
      <span class="ureq">solicitud {{ t.trace.ureq }}</span>
    </template>
    <span v-if="t.trace?.lane">carril <b>{{ t.trace.lane }}</b></span>
    <span v-else-if="t.trace">sin carril todavía — se decide al elegir entidad</span>
    <!-- La pista del teclado del mapa vive en el tooltip de «Mapa»: en el pie repetía algo que se
         aprende una vez y se quedaba con el centro de la barra. -->
    <div class="layout-controls" role="group" aria-label="Regiones visibles">
      <!-- El tema, antes de los botones de disposición y separado 8: los de disposición van al final
           porque su orden copia la pantalla (izquierda, abajo, derecha). -->
      <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
      <button ref="personToggle" v-if="hasColumn" type="button" class="region-action" :aria-pressed="!personClosed"
              aria-label="Mostrar u ocultar la persona" title="Mostrar u ocultar la persona" @click="togglePerson">
        <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
      </button>
      <button ref="recentToggle" type="button" class="region-action" :aria-pressed="!recentClosed" aria-controls="trazador-recent"
              aria-label="Mostrar u ocultar recientes" title="Mostrar u ocultar recientes" @click="toggleRecent">
        <span class="ui-icon" data-icon="console" aria-hidden="true"></span>
      </button>
      <button ref="logsToggle" type="button" class="region-action" :aria-pressed="!closed" aria-controls="trazador-logs"
              aria-label="Mostrar u ocultar los logs" title="Mostrar u ocultar los logs" @click="toggleLogs">
        <span class="ui-icon" data-icon="detail" aria-hidden="true"></span>
      </button>
    </div>
  </footer>

</template>

<style scoped>
/* Casi todo es de la base: regiones, bandas, subbanda, controles, `.empty`, `.alert`, el pie. Acá queda
   lo que sólo significa algo en el trazador: cómo se arman sus tres columnas (el secundario flota), la
   ficha de la persona y el mapa que llena su editor. */

/* ── EL EDITOR: el mapa ──────────────────────────────────────────────────────────────────────────
   `.editor` le trae de la base la columna flex y su superficie; el lienzo usa la misma (`--map-canvas`
   es `--background`), así el mapa no pinta un fondo propio.
   ⚠ `height:auto` y `flex:1` en el lienzo: `.map` se dibuja con `height:100%`, que dentro de una
   columna flex con alto definido significa «todo el alto del contenedor» — o sea el encabezado de
   arriba, por encima. Se ve como un mapa recortado abajo, no como un error. */
.editor-map > :deep(.map) { height:auto; flex:1 1 0; min-height:0 }
/* El título NO se queda con el espacio: lo quiere el buscador. (La base le da `flex:1` al primer hijo,
   que es lo correcto cuando el primer hijo es el título de una lista.) */
.editor-map > .region-head > :first-child { flex:none }

/* Excepción declarada a «sin mayúsculas»: el ambiente del pie es una alarma (PROD), no una etiqueta. */
.statusbar strong { color:var(--dim); text-transform:uppercase; letter-spacing:.06em }
.statusbar strong.prod { color:var(--warn) }
.statusbar b { color:var(--txt) }
/* La pista de teclado al borde: es ayuda, no estado — lo último que se lee. */
.ureq { font-variant-numeric:tabular-nums }
/* 8 entre el tema y los botones de disposición: 4 de este margen más los 4 del grupo. */
.theme-toggle { margin-right:var(--space-1) }
/* El resto lo pone `.region-action`. Acá sólo el verde del acuse. */
.copy-trace.ok { color:var(--ok) }

/* ── LA COLUMNA DE LA IZQUIERDA ─────────────────────────────────────────────────────────────────
   `sidebar` de la base le pone el fondo, la línea y la columna flex; acá va sólo su ancho.
   El ancho tiene un mínimo de lectura, pero sí se puede arrastrar: en soporte hay comercios y
   perfilamientos largos. Por debajo del mínimo se pliega, igual que logs y recientes. */
.sidebar.person-panel { flex:0 0 var(--person-width); min-width:0 }
.person-panel > .region-body { padding:var(--gutter); display:flex; flex-direction:column; gap:var(--space-3) }
.ureq-id { font-variant-numeric:tabular-nums }

/* LA FICHA, en filas. El rótulo apagado y angosto a la izquierda; el valor ocupa lo que queda y
   envuelve. ⚠ `min-width:0` en el valor: sin él, un nombre de comercio largo ensancha la fila y se
   sale de la columna en vez de partirse. */
.meta { margin:0; display:flex; flex-direction:column }
.meta > div { display:flex; gap:var(--space-2); align-items:baseline; padding:var(--space-2) 0 }
.meta > div + div { border-top:1px solid var(--line) }
.meta dt { flex:0 0 72px; color:var(--faint); font-size:var(--text-xs) }
.meta dd { margin:0; min-width:0; color:var(--txt); overflow-wrap:anywhere }
.quota-profiles { display:flex; flex-direction:column; gap:var(--space-1) }

.loading { display:flex; align-items:center; gap:var(--space-2); flex-wrap:wrap; font-size:var(--text-sm); color:var(--dim) }
/* `progress progress-xs progress-ind` de la base: la pista, el filete y el movimiento salen de ahí. Lo
   único propio es que NO ocupa el ancho: vive en un renglón junto al texto de la espera. */
.loading-bar { width:120px; flex:0 0 120px }
.map-broken code { font-size:var(--text-sm) }

/* ⚠ NO ES UN GRID DE TRES COLUMNAS: el mapa y la consola están en flujo; el inspector sigue en capa.
   El área central deja lugar al inspector, sin una franja muerta al redimensionarlo. `flex:1` +
   `min-height:0`: sin el `min-height`, un hijo flex NO se achica por debajo de su contenido y el
   `overflow:auto` de adentro no se activa nunca — la página vuelve a estirarse y el mapa se va para
   arriba. Es la parte que siempre se olvida de este patrón. */
/* `overflow:clip`: con el secundario plegado, su manija queda pegada al borde derecho y la zona de
   agarre de la base (8 px, centrada en la línea) se salía 6 px de la ventana — la página scrolleaba de
   costado a 768. Recortar no crea un contenedor de scroll, así que nada de adentro cambia. */
.columns { position:relative; flex:1; min-height:0; display:flex; overflow:clip }
/* El margen vive en el área central, no en el mapa: la consola comparte exactamente el mismo ancho útil
   y ninguna de las dos regiones queda por debajo del inspector. */
.workspace { flex:1 1 0; display:flex; flex-direction:column; min-width:0; min-height:0;
  margin-right:var(--detail-width, 0px) }
.workspace .editor-map { flex:1 1 0; min-width:0; min-height:220px }
.workspace .recent-panel { flex:none; min-height:0 }
/* ⚠ DESVIACIÓN DECLARADA: en capa, pegado a la derecha y por encima del mapa. La base lo pone en su
   propia pista del grid; acá flota para que ensancharlo no relocalice el DOM del mapa. La superficie, la
   línea y la columna flex son las de `.auxiliarybar`. */
.auxiliarybar { position:absolute; top:0; right:0; bottom:0; z-index:2 }

/* ── LAS MANIJAS ─────────────────────────────────────────────────────────────────────────────────
   La base pone el aspecto (`.rsz`: se ve de 1 px al pasar y se agarra de 8); acá va DÓNDE. La del
   secundario viaja con su borde, en capa; las otras dos van en el flujo y quedan montadas aun con su
   región plegada, así se la puede recuperar arrastrando o con el teclado. */
.handle { position:absolute; top:0; bottom:0; width:var(--rsz); margin-right:-2px; z-index:3 }
.handle::before { left:calc(50% - .5px); right:auto; width:1px }
.handle-person { position:relative; top:auto; bottom:auto; flex:none; margin:0 -2px }
.handle-panel { position:relative; top:auto; bottom:auto; width:auto; height:var(--rsz); flex:none; margin:-2px 0; z-index:1 }
.handle-panel::before { left:0; right:0; width:auto; top:calc(50% - .5px); bottom:auto; height:1px }
/* (Acá había un `@media (max-width:860px) { .cols { grid-template-columns:1fr } }`. Era cromo muerto:
   `.cols` no es un grid —el panel va EN CAPA y el mapa en flujo—, así que esa declaración no tenía a
   quién aplicarle. Se fue con el barrido de estilos viejos.) */
</style>
