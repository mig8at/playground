<script setup>
// El inspector es un REGISTRO, no otra representación del mapa. El mapa responde «por dónde fue»;
// acá se leen todas las líneas en secuencia sin abrir acordeones para cada sub-paso.
import { computed, nextTick, ref, watch } from 'vue'
import { useTrazador } from '../stores/trazador'

const emit = defineEmits(['close'])
const t = useTrazador()
const filtro = ref('')
const registro = ref(null)
const anclas = new Map()

const ESTADO = {
  ok: 'completó', warn: 'con avisos', fail: 'falló', skip: 'sin actividad',
  pendiente: 'sin registro', 'sin-evidencia': 'sin evidencia', 'sin-registro': 'sin registro',
  'no-aplica': 'no aplica', condicional: 'condicional',
}

const actual = computed(() => t.etapaActiva)
const q = computed(() => filtro.value.trim().toLocaleLowerCase())

function incluirPaso(paso, eventos, evidencias, contador) {
  if (paso.evidencia) evidencias.push({
    tipo: 'evidencia', paso: paso.label, evidencia: paso.evidencia, estado: paso.status,
  })
  for (const evento of paso.eventos || []) {
    eventos.push({
      tipo: 'evento', paso: paso.label, at: evento.at || '—', nivel: evento.level || 'info',
      mensaje: evento.msg || '', fuente: paso.source,
    })
  }
  contador.total += Number(paso.eventosDe || paso.eventos?.length || 0)
  for (const hijo of paso.hijos || []) incluirPaso(hijo, eventos, evidencias, contador)
}

// Las líneas dentro de cada etapa se ordenan por hora. Las etapas mantienen el orden del mapa, que es
// el único orden confiable cuando dos fuentes reportan la misma hora sin milisegundos.
function seccionDe(etapa) {
  const eventos = []
  const evidencias = []
  const contador = { total: 0 }
  for (const paso of etapa.vivo?.subs || []) incluirPaso(paso, eventos, evidencias, contador)
  eventos.sort((a, b) => a.at.localeCompare(b.at))
  return {
    id: etapa.id,
    etiqueta: etapa.label,
    estado: etapa.estado,
    at: etapa.vivo?.at || '',
    motivo: etapa.vivo?.reason || '',
    detalle: etapa.vivo?.detail || etapa.porque || '',
    lineas: [...evidencias, ...eventos],
    total: contador.total,
  }
}

const secciones = computed(() => (t.etapas || []).map(seccionDe))
const texto = (seccion, linea = null) => [
  seccion.etiqueta, seccion.estado, seccion.motivo, seccion.detalle,
  linea?.paso, linea?.mensaje, linea?.evidencia?.fuente, ...(linea?.evidencia?.filas || []),
].filter(Boolean).join(' ').toLocaleLowerCase()
const coincide = (seccion, linea) => !q.value || texto(seccion, linea).includes(q.value)

const seccionesVisibles = computed(() => secciones.value.map((seccion) => {
  const coincideEtapa = !q.value || texto(seccion).includes(q.value)
  const lineas = coincideEtapa ? seccion.lineas : seccion.lineas.filter((linea) => coincide(seccion, linea))
  return { ...seccion, lineas, coincideEtapa }
}).filter((seccion) => {
  if (q.value) return seccion.coincideEtapa || seccion.lineas.length
  // El registro enumera hechos, no huecos: las etapas sin una línea no gastan alto. La seleccionada
  // queda como ancla incluso vacía, para que un clic en el mapa siempre tenga una respuesta visible.
  return seccion.lineas.length || seccion.motivo || seccion.detalle || seccion.id === actual.value?.id
}))

const totalLineas = computed(() => secciones.value.reduce((total, seccion) => total + seccion.lineas.length, 0))
const totalVisibles = computed(() => seccionesVisibles.value.reduce((total, seccion) => total + seccion.lineas.length, 0))

function textoRegistro() {
  const lineas = [`TRAZADOR · ${t.traza?.target || t.target} · solicitud ${t.traza?.ureq ?? '—'}`]
  for (const seccion of seccionesVisibles.value) {
    lineas.push(`\n── ${seccion.etiqueta} · ${ESTADO[seccion.estado] || seccion.estado}${seccion.at ? ` · ${seccion.at}` : ''} ──`)
    if (seccion.motivo) lineas.push(`MOTIVO  ${seccion.motivo}`)
    else if (seccion.detalle && seccion.detalle.length <= 180) lineas.push(`CONTEXTO  ${seccion.detalle}`)
    for (const linea of seccion.lineas) {
      if (linea.tipo === 'evidencia') {
        lineas.push(`BD · ${linea.paso} · ${linea.evidencia.fuente}`)
        for (const fila of linea.evidencia.filas || []) lineas.push(`  ${fila}`)
        if (linea.evidencia.sql) lineas.push(`  SQL  ${linea.evidencia.sql.replace(/\s+/g, ' ').trim()}`)
      } else {
        lineas.push(`${linea.at}  ${linea.paso}  ${(linea.nivel || 'info').toUpperCase()}  ${linea.mensaje}`)
      }
    }
  }
  return lineas.join('\n')
}
function copiarRegistro() {
  const copiarConSeleccion = (contenido) => {
    const area = document.createElement('textarea')
    area.value = contenido
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  const contenido = textoRegistro()
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(contenido).catch(() => copiarConSeleccion(contenido))
  else copiarConSeleccion(contenido)
}

function anclar(id, elemento) {
  if (elemento) anclas.set(id, elemento)
  else anclas.delete(id)
}
async function enfocarEtapa(id) {
  if (!id) return
  await nextTick()
  const destino = anclas.get(id)
  if (!destino || !registro.value) return
  registro.value.scrollTo({ top: Math.max(0, destino.offsetTop - 4), behavior: 'smooth' })
}
function seleccionarEtapa(id) {
  t.etapaSel = id
  enfocarEtapa(id)
}
watch(() => actual.value?.id, (id) => { enfocarEtapa(id) }, { immediate: true })
</script>

<template>
  <main class="detail-panel">
    <header class="detail-topbar">
      <span>Registro</span>
      <span v-if="t.traza" class="toolbar-note">Solicitud #{{ t.traza.ureq }}</span>
      <button type="button" class="region-action" title="Ocultar panel" aria-label="Ocultar logs" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </header>

    <section v-if="t.traza" id="panel-detalle" class="registro-view" aria-label="Registro completo de la corrida">
      <header class="registro-toolbar">
        <span class="registro-identidad">{{ t.traza.target || t.target }} · {{ totalLineas }} registros</span>
        <input v-model="filtro" class="input input-xs" type="search" placeholder="buscar en el registro…"
               aria-label="Buscar en todo el registro" />
        <span v-if="filtro" class="registro-conteo">{{ totalVisibles }} visibles</span>
        <button type="button" class="region-action registro-copy"
                aria-label="Copiar registro visible"
                :title="filtro ? 'Copiar registros filtrados' : 'Copiar registro completo'"
                @click="copiarRegistro">
          <span class="ui-icon" data-icon="copy" aria-hidden="true"></span>
        </button>
      </header>

      <div ref="registro" class="registro-body" aria-live="polite">
        <section v-for="seccion in seccionesVisibles" :key="seccion.id" :ref="(el) => anclar(seccion.id, el)"
                 class="log-stage" :class="{ activa: actual?.id === seccion.id }">
          <button type="button" class="stage-bar" :aria-current="actual?.id === seccion.id ? 'step' : undefined"
                  :title="`Ir a ${seccion.etiqueta} en el mapa`" @click="seleccionarEtapa(seccion.id)">
            <span class="stage-dot" :class="seccion.estado" aria-hidden="true"></span>
            <span class="stage-label">{{ seccion.etiqueta }}</span>
            <span v-if="seccion.at" class="stage-time">{{ seccion.at }}</span>
            <span class="stage-status">{{ ESTADO[seccion.estado] || seccion.estado }}</span>
          </button>

          <p v-if="seccion.motivo" class="stage-reason">{{ seccion.motivo }}</p>
          <p v-else-if="seccion.detalle && seccion.detalle.length <= 180" class="stage-detail">{{ seccion.detalle }}</p>

          <div v-if="seccion.lineas.length" class="log-lines" role="list">
            <template v-for="(linea, indice) in seccion.lineas" :key="`${linea.tipo}-${indice}-${linea.paso}`">
              <details v-if="linea.tipo === 'evidencia'" class="log-evidence" role="listitem">
                <summary>
                  <span class="log-kind">BD</span><span class="log-step">{{ linea.paso }}</span>
                  <span class="log-summary">{{ linea.evidencia.fuente }}</span><span class="accordion-chev">⌄</span>
                </summary>
                <p v-for="(fila, filaIndice) in linea.evidencia.filas" :key="filaIndice" class="evidence-row">{{ fila }}</p>
                <details class="query accordion-item"><summary class="accordion-trigger">consulta SQL<span class="accordion-chev">⌄</span></summary><pre class="accordion-content">{{ linea.evidencia.sql }}</pre></details>
              </details>
              <div v-else class="log-line" :class="`nivel-${linea.nivel}`" role="listitem">
                <time>{{ linea.at }}</time>
                <span class="log-step" :title="linea.paso">{{ linea.paso }}</span>
                <span class="log-level">{{ linea.nivel === 'error' ? 'ERROR' : (linea.nivel || 'INFO').toUpperCase() }}</span>
                <span class="log-message">{{ linea.mensaje }}</span>
              </div>
            </template>
            <p v-if="seccion.total > seccion.lineas.filter((linea) => linea.tipo === 'evento').length" class="log-cut">
              {{ seccion.lineas.filter((linea) => linea.tipo === 'evento').length }} de {{ seccion.total }} líneas de log; los errores se priorizan en el recorte.
            </p>
          </div>
          <p v-else class="stage-empty">Sin líneas registradas para esta etapa.</p>
        </section>

        <div v-if="!seccionesVisibles.length" class="empty inspector-vacio">
          <div class="empty-head">
            <div class="empty-media" aria-hidden="true">⌕</div>
            <p class="empty-title">No hay coincidencias</p>
            <p class="empty-desc">Probá otra palabra, código o nombre de etapa.</p>
          </div>
        </div>
      </div>
    </section>

    <div v-else class="empty inspector-vacio">
      <div class="empty-head">
        <div class="empty-media" aria-hidden="true">⌁</div>
        <p class="empty-title">Elegí una solicitud</p>
        <p class="empty-desc">El registro completo de la corrida aparecerá acá.</p>
      </div>
    </div>
  </main>
</template>

<style scoped>
.detail-panel { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; overflow:hidden;
  container-type:inline-size; background:var(--card) }
.detail-topbar { flex:none; display:flex; align-items:center; gap:8px; min-height:42px; padding:0 12px;
  color:var(--txt); border-bottom:1px solid var(--line); font-size:13px; font-weight:600 }
.detail-topbar .toolbar-note { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--dim); font-size:11px; font-weight:400; font-variant-numeric:tabular-nums }
.detail-topbar .region-action { margin-left:auto; border:1px solid transparent; border-radius:var(--r-sm); background:transparent }
.detail-topbar .region-action:hover { color:var(--primary); border-color:var(--line); background:var(--panel2) }

.registro-view { display:flex; flex:1; flex-direction:column; min-width:0; min-height:0; overflow:hidden }
.registro-toolbar { flex:none; display:flex; align-items:center; gap:8px; min-height:38px; padding:0 12px;
  border-bottom:1px solid var(--line); background:var(--panel2) }
.registro-identidad { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dim);
  font:11px/1 var(--font-mono); font-variant-numeric:tabular-nums }
.registro-toolbar .input { flex:1 1 120px; min-width:90px; max-width:230px; margin-left:auto; font-weight:400 }
.registro-conteo { flex:none; color:var(--tenue); font-size:10px; font-variant-numeric:tabular-nums; white-space:nowrap }
.registro-copy { flex:none; border:1px solid transparent; border-radius:var(--r-sm); color:var(--dim); background:transparent }
.registro-copy:hover { color:var(--txt); border-color:var(--line); background:var(--card) }

.registro-body { flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin;
  scrollbar-color:var(--line) transparent; background:var(--card) }
.log-stage { scroll-margin-top:4px; border-bottom:1px solid var(--line) }
.stage-bar { position:sticky; top:0; z-index:1; display:grid; grid-template-columns:8px minmax(0,1fr) max-content max-content;
  align-items:center; gap:8px; width:100%; min-height:31px; padding:0 12px; color:var(--dim); background:var(--card);
  border:0; border-bottom:1px solid var(--line); text-align:left; font:600 11px/1 var(--font-sans); cursor:pointer }
.stage-bar:hover { color:var(--txt); background:var(--sel) }
.stage-bar:focus-visible { outline:2px solid var(--ring); outline-offset:-2px }
.log-stage.activa .stage-bar { color:var(--txt); background:color-mix(in srgb, var(--primary) 8%, var(--card)); box-shadow:inset 2px 0 0 var(--primary) }
.stage-dot { width:7px; height:7px; border-radius:var(--r-full); background:var(--skip) }
.stage-dot.ok { background:var(--ok) }.stage-dot.fail { background:var(--fail) }.stage-dot.warn { background:var(--warn) }
.stage-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.stage-time, .stage-status { color:var(--tenue); font-size:10px; font-weight:500; font-variant-numeric:tabular-nums; white-space:nowrap }
.stage-status { text-transform:lowercase }
.stage-reason, .stage-detail { margin:0; padding:8px 12px; color:var(--dim); font-size:11px; line-height:1.5 }
.stage-reason { color:var(--fail); background:color-mix(in srgb, var(--fail) 4%, var(--card)); border-left:2px solid var(--fail) }
.stage-empty { margin:0; padding:8px 12px 10px 28px; color:var(--tenue); font-size:11px }

.log-lines { font:11.5px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace }
.log-line { display:grid; grid-template-columns:44px minmax(72px, .65fr) max-content minmax(0, 2fr); gap:8px;
  align-items:start; padding:4px 12px; color:var(--dim); border-bottom:1px solid color-mix(in srgb, var(--line) 70%, transparent) }
.log-line:hover { background:var(--sel); color:var(--txt) }
.log-line time { color:var(--tenue); font-variant-numeric:tabular-nums; white-space:nowrap }
.log-step { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--texto-2) }
.log-level { color:var(--tenue); font-size:10px; white-space:nowrap }
.log-message { min-width:0; overflow-wrap:anywhere; white-space:pre-wrap }
.nivel-error { color:var(--fail); background:color-mix(in srgb, var(--fail) 4%, var(--card)) }
.nivel-error .log-level { color:var(--fail); font-weight:700 }
.log-cut { margin:0; padding:7px 12px 8px; color:var(--tenue); font:10.5px/1.45 var(--font-sans) }

.log-evidence { margin:0; padding:0 12px; color:var(--dim); border-bottom:1px solid color-mix(in srgb, var(--line) 70%, transparent);
  background:color-mix(in srgb, var(--info) 4%, var(--card)) }
.log-evidence > summary { display:grid; grid-template-columns:26px minmax(0,1fr) max-content 12px; gap:8px; align-items:center;
  min-height:29px; cursor:pointer; list-style:none; font:11px/1.3 var(--font-sans) }
.log-evidence > summary::-webkit-details-marker { display:none }
.log-kind { color:var(--info); font:600 10px/1 var(--font-mono) }.log-summary { color:var(--tenue); font-size:10px }
.evidence-row { margin:0; padding:2px 0; color:var(--texto-2); font:11px/1.45 ui-monospace, SFMono-Regular, monospace; overflow-wrap:anywhere }
.query { margin:6px 0 8px; border-bottom:0 }.query .accordion-trigger { padding:0; font-size:10px; font-weight:500 }
.query pre { margin:4px 0 0; padding:6px 8px; overflow:auto; color:var(--dim); background:var(--panel2); border-radius:var(--r-sm); font:10px/1.45 ui-monospace, SFMono-Regular, monospace }

.inspector-vacio { display:grid; flex:1; min-height:0; place-items:center; padding:20px 12px; background:var(--card) }
.empty-head { max-width:230px; text-align:center }.empty-media { margin:0 auto 8px }.empty-title { margin:0; color:var(--txt); font-size:12px; font-weight:600 }.empty-desc { margin:4px 0 0; color:var(--dim); font-size:11px; line-height:1.45 }

@container (max-width: 430px) {
  .registro-toolbar { flex-wrap:wrap; align-content:center; padding-top:6px; padding-bottom:6px }
  .registro-toolbar .input { order:3; flex:1 0 100%; max-width:none }
  .stage-bar { grid-template-columns:8px minmax(0,1fr) max-content; padding-left:10px; padding-right:10px }
  .stage-status { display:none }.log-line { grid-template-columns:42px minmax(0,1fr) max-content; gap:6px; padding-left:10px; padding-right:10px }
  .log-line .log-step { grid-column:2; grid-row:1 }.log-line .log-level { grid-column:3; grid-row:1 }
  .log-line .log-message { grid-column:2 / -1; grid-row:2 }.log-evidence { padding-left:10px; padding-right:10px }
}
</style>
