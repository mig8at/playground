<script setup>
// El panel derecho: un paso del flujo, abierto como un job de CI.
//
// DOS NIVELES Y NADA MÁS: el paso principal (la etapa) y sus sub-pasos con nombre de negocio. Cada sub-paso
// se abre y muestra SUS líneas de log — no las de la etapa.
//
// Antes las líneas vivían en un panel al final con las 110 de la etapa juntas, mezcladas y sin dueño: para
// saber cuál correspondía a «Datos personales» y cuál a la cascada de KYC había que leerlas todas. El
// reparto lo hace el server (cada `Sub` trae sus `eventos`), así que acá sólo se pinta.
//
// Y se muestra MENOS por defecto: el porqué declarado, los pasos sin actividad y lo técnico arrancan
// plegados. La pregunta de entrada es «¿por dónde pasó y dónde se cortó?»; el resto es para cuando ya sabés
// qué estás buscando.
//
// La regla de siempre: acá NO se calcula nada del negocio. Si un estado se ve mal, el bug está en el
// ensamblado Go.
import { computed, ref, watch } from 'vue'
import { useTrazador } from '../stores/trazador'
import RegionMenu from '../RegionMenu.vue'
const emit = defineEmits(['close'])
const t = useTrazador()
const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~',
  'no-aplica':'∅', condicional:'·', pendiente:'·' }
const FUENTE = { db:'BD', loki:'logs', 'db+loki':'BD+logs', default:'supuesto' }
const ESTADO = { ok:'completó', warn:'completó con errores', fail:'FALLÓ', skip:'no se ejecutó',
  'sin-evidencia':'sin evidencia en la BD', 'sin-registro':'ocurrió pero no quedó registrada',
  'no-aplica':'no aplica a este ramal', condicional:'no se puede afirmar si ocurrió',
  pendiente:'sin consultar' }

const e = computed(() => t.etapaActiva)
const TECNICO = /^Eventos sin nombre de negocio/

const vivos = computed(() => (e.value?.vivo?.subs || []).filter((s) => !TECNICO.test(s.label)))
const tecnico = computed(() => (e.value?.vivo?.subs || []).find((s) => TECNICO.test(s.label)) || null)
const hayDatos = computed(() => vivos.value.some((s) => s.status && s.status !== 'skip'))

// Qué sub-paso está abierto. Uno a la vez, por índice: dos abiertos a la vez vuelven a la pared de texto
// que este cambio vino a deshacer. Se cierra al cambiar de etapa.
const abierto = ref(null)
const abrirTecnico = ref(false)
const abrirPorque = ref(false)
// Se declara ACÁ y no junto a `apagados`: el watch de abajo lleva `immediate` y corre durante el setup, así
// que una `ref` declarada después le llega en zona muerta. Compilaba y explotaba en runtime.
const verApagados = ref(false)
const alternar = (k) => { abierto.value = abierto.value === k ? null : k }

// AL ABRIR UNA ETAPA, SE ABRE SOLO EL PASO QUE FALLÓ. El sidebar ya elige la etapa interesante, pero adentro
// había que buscar cuál de los 8 pasos rompió — el dato ya venía en `status`, sólo faltaba usarlo. Si nada
// falló no se abre nada: abrir el primero por abrir vuelve a poner la pared de texto.
watch(() => e.value?.id, () => {
  abrirTecnico.value = false
  abrirPorque.value = false
  verApagados.value = false
  abierto.value = null
  for (let i = 0; i < vivos.value.length; i++) {
    const s = vivos.value[i]
    if (s.status === 'fail' && s.eventos?.length) { abierto.value = i; return }
    const j = (s.hijos || []).findIndex((h) => h.status === 'fail' && h.eventos?.length)
    if (j >= 0) { abierto.value = i + '-' + j; return }
  }
}, { immediate: true })

// Cuántos ERRORES trae un paso, para verlo SIN abrirlo. `eventosDe` dice cuántas líneas hay en total pero no
// cuántas son errores, y ese es el número que decide si vale la pena abrir.
const errores = (s) => (s.eventos || []).filter((ev) => ev.level === 'error').length

// ─── BUSCAR DENTRO DE LA TRAZA ───────────────────────────────────────────────────────────────────────
//
// Con 493 líneas repartidas en pasos plegados, encontrar «Wompi» o un código de error obligaba a abrirlos
// todos. El filtro no esconde pasos: los MARCA y dice cuántas coincidencias tiene cada uno. Esconder los que
// no matchean rompería la lectura del flujo, que es para lo que existe esta vista.
const filtro = ref('')
watch(() => e.value?.id, () => { filtro.value = '' })
const coincidencias = (s) => {
  const q = filtro.value.trim().toLowerCase()
  if (!q) return 0
  let n = (s.label || '').toLowerCase().includes(q) ? 1 : 0
  n += (s.eventos || []).filter((ev) => ev.msg.toLowerCase().includes(q)).length
  return n
}
// Abrible = tiene algo adentro. Antes era «tiene logs», y por eso los pasos de BD —los que afirman «2 de
// 6 consultadas» o «DETENIDA acá»— eran los únicos que no se podían auditar desde la vista.
//
// Acá vivió además un pliegue de la rutina («N pasos sin novedad»). Se quitó a pedido: decidía qué
// esconder con una heurística sobre la etiqueta, y esconder por corazonada es el trato equivocado para
// una vista de auditoría. El resumen de hallazgos ya contesta «¿dónde se rompió?» sin quitar renglones.
const abrible = (s) => !!(s.eventos?.length || s.evidencia)
const resalta = (msg) => {
  const q = filtro.value.trim().toLowerCase()
  return q && msg.toLowerCase().includes(q)
}
const totalCoincidencias = computed(() => {
  if (!filtro.value.trim()) return 0
  let n = 0
  for (const s of vivos.value) {
    n += coincidencias(s)
    for (const h of s.hijos || []) n += coincidencias(h)
  }
  for (const h of tecnico.value?.hijos || []) n += coincidencias(h)
  return n
})

// COPIAR UN SOLO PASO. La traza entera son 40 KB; para pegar en un hilo de Slack sólo la cascada de KYC,
// copiar todo es peor que no tener botón. Usa el mismo formato que `trazaTexto.js`.
const copiadoSub = ref(null)
async function copiarSub(s, k) {
  const L = [`── ${s.label}${s.detail ? ' — ' + s.detail : ''}  ·  ${t.traza?.target} / solicitud ${t.traza?.ureq} / ${e.value?.label}`]
  const vuelca = (x, sangria) => {
    if (x !== s) L.push(`${sangria}${x.label}${x.detail ? ' — ' + x.detail : ''}`)
    // La BD va CON el paso: el punto del botón es pegar una unidad que se explique sola, y un hallazgo
    // sin la fila que lo respalda obliga a quien lo lee a volver a preguntar de dónde salió.
    if (x.evidencia) {
      L.push(`${sangria}   ── BD · ${x.evidencia.fuente} ──`)
      x.evidencia.filas.forEach((f) => L.push(`${sangria}   ${f}`))
      L.push(`${sangria}   ${x.evidencia.sql.split('\n').map((r) => r.trim()).filter(Boolean).join(' ')}`)
    }
    ;(x.eventos || []).forEach((ev, i) => {
      L.push(`${sangria}${String(i + 1).padStart(3)}  ${ev.at}${ev.level === 'error' ? '  ERROR' : ''}  ${ev.msg}`)
    })
    if (x.eventosDe > (x.eventos || []).length) {
      L.push(`${sangria}     … ${x.eventos.length} de ${x.eventosDe} líneas (los errores van primero)`)
    }
    for (const h of x.hijos || []) vuelca(h, sangria + '   ')
  }
  vuelca(s, '   ')
  const texto = L.join('\n')
  try { await navigator.clipboard.writeText(texto) } catch {
    const ta = document.createElement('textarea')
    ta.value = texto; document.body.appendChild(ta); ta.select()
    document.execCommand('copy'); ta.remove()
  }
  copiadoSub.value = k
  setTimeout(() => { if (copiadoSub.value === k) copiadoSub.value = null }, 1500)
}

// Los sub-pasos declarados SIN actividad: dicen «por acá no pasó», que es media respuesta. Van plegados.
const apagados = computed(() => {
  // ⚠ Los hitos activos casi nunca son subs de PRIMER NIVEL: son hijos de su bloque, y los que se
  // fusionaron con una entidad viven en el `detail` de esa fila. Comparar sólo contra `vivos` hacía que
  // «Persistencia tras KYC ×1» apareciera arriba con actividad Y abajo en «sin actividad» — el mismo paso
  // dicho de las dos formas, que es la peor clase de error en una herramienta que existe para afirmar.
  const con = new Set()
  const marca = (s) => {
    con.add(s.label)
    // Lo fusionado no deja fila propia: su nombre queda en el detalle de la entidad («score 348 · Experian
    // disparado · Consulta terminada»). Se cuenta como activo, porque lo está.
    if (s.detail) for (const parte of s.detail.split(' · ')) con.add(parte.trim())
    for (const h of s.hijos || []) marca(h)
  }
  for (const s of e.value?.vivo?.subs || []) marca(s)
  const out = []
  for (const b of e.value?.bloques || []) {
    for (const h of b.hitos || []) if (!con.has(h.label)) out.push(h)
  }
  return out
})

const detailMenu = computed(() => [
  { id: 'contexto', label: 'Mostrar explicación de la etapa', checked: abrirPorque.value,
    disabled: (e.value?.vivo?.detail || e.value?.porque || '').length < 120 },
  { id: 'inactivos', label: 'Mostrar pasos sin actividad', count: apagados.value.length,
    checked: verApagados.value, disabled: !apagados.value.length || !t.traza },
  { id: 'tecnico', label: 'Mostrar eventos técnicos', checked: abrirTecnico.value, disabled: !tecnico.value },
  { separador: true },
  { id: 'plegar', label: 'Plegar todos los pasos', icon: 'collapse' },
])
function detailAction(id) {
  if (id === 'contexto') abrirPorque.value = !abrirPorque.value
  if (id === 'inactivos') verApagados.value = !verApagados.value
  if (id === 'tecnico') abrirTecnico.value = !abrirTecnico.value
  if (id === 'plegar') { abierto.value = null; abrirTecnico.value = false; abrirPorque.value = false; verApagados.value = false }
}

</script>

<template>
  <main class="detail-panel">
    <header class="detail-topbar">
      <span>Inspector</span>
      <span v-if="t.traza" class="toolbar-note">#{{ t.traza.ureq }}</span>
      <button type="button" class="region-action" title="Ocultar panel" aria-label="Ocultar logs" @click="emit('close')">
        <span class="ui-icon" data-icon="close" aria-hidden="true"></span>
      </button>
    </header>

    <div class="panel-views">
      <section class="panel-view abierta detail-panel-view">
        <header class="view-heading">
          <span>Detalle</span>
          <span v-if="t.traza && e" class="view-stage">{{ e.label }}</span>
          <span v-else class="view-hint">Elegí una solicitud</span>
        </header>

        <div v-if="t.traza && e" id="panel-detalle" class="panel-view-body detail-view-body">
    <!-- Migas (`breadcrumb` de `taller.css`): esto ya era un camino escrito con barras. Lo que suma
         el componente es que la ETAPA ACTUAL se distingue del camino que lleva hasta ella —va en el
         color del texto y el resto apagado—, así que se lee dónde estás sin contar separadores. -->
    <div class="region-head detail-toolbar">
    <nav class="crumb breadcrumb" aria-label="ubicación">
      <span class="breadcrumb-item">{{ t.traza?.target || t.target }}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-item">{{ t.traza?.ureq ?? '—' }}</span>
      <span class="breadcrumb-sep" aria-hidden="true">/</span>
      <span class="breadcrumb-item breadcrumb-page" aria-current="page">{{ e.label }}</span>
    </nav>
    <div class="region-actions toolbar" role="group" aria-label="Acciones de la etapa">
      <RegionMenu title="Opciones de la etapa" :items="detailMenu" :active="abrirPorque || verApagados || abrirTecnico" @select="detailAction" />
    </div>
    </div>
    <div class="sub2">
      <span>{{ ESTADO[e.estado] || e.estado }}</span>
      <span v-if="e.vivo?.at">a las {{ e.vivo.at }}</span>
      <span v-if="e.vivo?.source">fuente <b>{{ FUENTE[e.vivo.source] || '—' }}</b></span>
      <span v-if="e.vivo?.eventosDe">{{ e.vivo.eventosDe }} líneas</span>
      <span v-if="!e.esqueleto" class="unknown">la BD no puede probar esta etapa</span>
    </div>

    <!-- ⚠ El encabezado sale del scroll. Antes `main` scrolleaba ENTERO dentro del sidebar, así que
         recorrías trescientas líneas de log y perdías de vista de qué etapa eran — que es justo lo
         que uno necesita tener delante mientras las lee. -->
    <div class="region-body">

    <!-- El motivo de un fallo va SIEMPRE visible: es la respuesta a «¿por qué se cortó?» -->
    <pre v-if="e.vivo?.reason" class="why">{{ e.vivo.reason }}</pre>

    <!-- El detalle declarado (a veces son párrafos) va plegado: contexto, no respuesta. -->
    <template v-if="e.vivo?.detail || e.porque">
      <p v-if="(e.vivo?.detail || e.porque).length < 120" class="regla">{{ e.vivo?.detail || e.porque }}</p>
      <template v-else>
        <p v-if="abrirPorque" class="regla">{{ e.vivo?.detail || e.porque }}</p>
      </template>
    </template>

    <!-- LOS SUB-PASOS. Cada uno se abre y muestra SUS líneas. -->
    <section v-if="vivos.length" class="sec">
      <!-- `region-head grupo` de `taller.css`: la misma barra que el árbol de `context` y los grupos
           del tablero. Era un `<h3>` propio de 12,5px con banda y dos bordes — la misma idea escrita
           a mano. Lo que SUMA el componente es que se PEGA arriba: recorrés trescientas líneas de log
           y seguís viendo de qué paso son, que es justo lo que uno necesita ahí.
           ⚠ El icono va DENTRO del rótulo: `region-head > :first-child` se lleva el `flex: 1`, así
           que suelto se estiraba él y el texto quedaba contra el conteo. -->
      <div class="region-head grupo">
        <span class="gh"><span class="ico" :class="e.estado === 'fail' ? 'fail' : (hayDatos ? 'ok' : 'pendiente')">{{
          e.estado === 'fail' ? '✕' : (hayDatos ? '✓' : '·') }}</span>
          {{ hayDatos ? 'Pasos' : 'Nada medido acá' }}</span>
        <span class="badge badge-outline badge-xs src">{{ vivos.length }}</span>
        <input v-model="filtro" class="input input-xs buscar" type="search" placeholder="buscar en los logs…"
               aria-label="Buscar dentro de esta etapa" />
        <span v-if="filtro.trim()" class="badge badge-outline badge-xs src" :class="{ ok: totalCoincidencias }">
          {{ totalCoincidencias }} coincidencia{{ totalCoincidencias === 1 ? '' : 's' }}</span>
      </div>
      <div class="tabla">
        <template v-for="(s, i) in vivos" :key="i">
          <div class="fila" :class="{ clic: abrible(s), ab: abierto === i, hit: coincidencias(s) }">
            <button class="abre" :disabled="!abrible(s)" :aria-expanded="abierto === i"
                    @click="alternar(i)">
              <span class="cr" :class="{ on: abierto === i }">{{ abrible(s) ? '▸' : '' }}</span>
              <span class="dot" :class="s.status" />
              <span class="l" :title="s.label">{{ s.label }}</span>
            </button>
            <span v-if="coincidencias(s)" class="badge badge-outline badge-xs marca">{{ coincidencias(s) }}</span>
            <span v-if="errores(s)" class="badge badge-outline badge-xs errn" :title="errores(s) + ' líneas de error'">{{ errores(s) }} err</span>
            <span class="d" :title="s.detail">{{ s.detail }}</span>
            <span class="badge badge-outline badge-xs src">{{ FUENTE[s.source] || '' }}</span>
            <button v-if="abrible(s) || s.hijos?.length" class="region-action cp" :class="{ ok: copiadoSub === i }"
                    :aria-label="'Copiar ' + s.label" :title="'Copiar «' + s.label + '» con sus logs'" @click.stop="copiarSub(s, i)">
              <span class="ui-icon" :data-icon="copiadoSub === i ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
          </div>
          <!-- LA BD PRIMERO Y APARTE: es un ESTADO, no un evento. Va sin número de línea y sin hora en la
               misma columna que los logs a propósito — verlas juntas invita a leer una fila de BD como un
               momento del flujo, y `updated_at` se mueve con el webhook. -->
          <div v-if="abierto === i && s.evidencia" class="bd">
            <div class="bdh">BD · {{ s.evidencia.fuente }}</div>
            <p v-for="(f, k) in s.evidencia.filas" :key="k" class="bdf">{{ f }}</p>
            <details class="bdq accordion-item"><summary class="accordion-trigger">la consulta que corrió<span class="accordion-chev">⌄</span></summary><pre class="accordion-content">{{ s.evidencia.sql }}</pre></details>
          </div>
          <!-- Los logs DE ESTE PASO -->
          <div v-if="abierto === i && s.eventos?.length" class="log">
            <table>
              <tr v-for="(ev, j) in s.eventos" :key="j"
                  :class="{ err: ev.level === 'error', hit: resalta(ev.msg) }">
                <td class="ln">{{ j + 1 }}</td><td class="tm">{{ ev.at }}</td><td>{{ ev.msg }}</td>
              </tr>
            </table>
            <p v-if="s.eventosDe > s.eventos.length" class="nota">
              {{ s.eventos.length }} de {{ s.eventosDe }} líneas — los errores van primero, para que el
              recorte nunca se coma la causa
            </p>
          </div>
          <!-- Los hijos del grupo: cada uno con SUS logs, si los tiene. El grupo (Centrales, Validación
               de identidad, ¿Se disparó?) sale del mapa; el hijo es el paso concreto. -->
          <template v-for="(h, j) in (s.hijos || [])" :key="i + '-' + j">
            <div class="fila hijo" :class="{ clic: abrible(h), ab: abierto === i + '-' + j,
                                             hit: coincidencias(h) }">
              <button class="abre" :disabled="!abrible(h)" :aria-expanded="abierto === i + '-' + j"
                      @click="alternar(i + '-' + j)">
                <span class="cr" :class="{ on: abierto === i + '-' + j }">{{ abrible(h) ? '▸' : '' }}</span>
                <span class="dot" :class="h.status" />
                <span class="l" :title="h.label">{{ h.label }}</span>
              </button>
              <span v-if="coincidencias(h)" class="badge badge-outline badge-xs marca">{{ coincidencias(h) }}</span>
              <span v-if="errores(h)" class="badge badge-outline badge-xs errn" :title="errores(h) + ' líneas de error'">{{ errores(h) }} err</span>
              <span class="d" :title="h.detail">{{ h.detail }}</span>
              <span class="badge badge-outline badge-xs src">{{ FUENTE[h.source] || '' }}</span>
              <button v-if="abrible(h)" class="region-action cp" :class="{ ok: copiadoSub === i + '-' + j }"
                      :aria-label="'Copiar ' + h.label" :title="'Copiar «' + h.label + '» con sus logs'" @click.stop="copiarSub(h, i + '-' + j)">
                <span class="ui-icon" :data-icon="copiadoSub === i + '-' + j ? 'check' : 'copy'" aria-hidden="true"></span>
              </button>
            </div>
            <div v-if="abierto === i + '-' + j && h.evidencia" class="bd">
              <div class="bdh">BD · {{ h.evidencia.fuente }}</div>
              <p v-for="(f, k) in h.evidencia.filas" :key="k" class="bdf">{{ f }}</p>
              <details class="bdq accordion-item"><summary class="accordion-trigger">la consulta que corrió<span class="accordion-chev">⌄</span></summary><pre class="accordion-content">{{ h.evidencia.sql }}</pre></details>
            </div>
            <div v-if="abierto === i + '-' + j && h.eventos?.length" class="log">
              <table>
                <tr v-for="(ev, k) in h.eventos" :key="k"
                    :class="{ err: ev.level === 'error', hit: resalta(ev.msg) }">
                  <td class="ln">{{ k + 1 }}</td><td class="tm">{{ ev.at }}</td><td>{{ ev.msg }}</td>
                </tr>
              </table>
              <p v-if="h.eventosDe > h.eventos.length" class="nota">
                {{ h.eventos.length }} de {{ h.eventosDe }} líneas — los errores van primero
              </p>
            </div>
          </template>
        </template>
      </div>
    </section>

    <!-- Por acá NO pasó, plegado: es media respuesta, no la principal -->
    <template v-if="apagados.length && t.traza">
      <p v-if="verApagados" class="toolbar-note">{{ apagados.length }} pasos sin actividad · visibles desde Opciones de la etapa</p>
      <div v-if="verApagados" class="chips">
        <span v-for="h in apagados" :key="h.id" class="badge badge-outline chip"
              :title="h.porque || (h.matcher ? '' : 'se infiere por ausencia')">
          {{ h.label }}<template v-if="h.soloEnCodigo"> *</template>
        </span>
        <span v-if="apagados.some((h) => h.soloEnCodigo)" class="pie">* existe en el código, no medido en logs</span>
      </div>
    </template>

    <!-- Lo técnico: el backlog de pasos por declarar. También se abre por renglón. -->
    <section v-if="tecnico" class="sec">
      <!-- ⚠ Era un `<h3 @click>`: el teclado no llega a un encabezado y un lector de pantalla no lo
           anuncia como algo que se aprieta. Un `<button>` real con `aria-expanded`, con la misma piel
           de barra de grupo. -->
      <button type="button" class="region-head grupo click" :aria-expanded="abrirTecnico"
              @click="abrirTecnico = !abrirTecnico">
        <span class="gh"><span class="cr" :class="{ on: abrirTecnico }">▸</span>
          <span class="ico pendiente">·</span> {{ tecnico.label }}</span>
        <span class="badge badge-outline badge-xs src">sin nombre de negocio</span>
      </button>
      <div v-if="abrirTecnico" class="tabla">
        <template v-for="(h, j) in (tecnico.hijos || [])" :key="j">
          <div class="fila hijo" :class="{ clic: h.eventos?.length, ab: abierto === 't' + j,
                                           hit: coincidencias(h) }">
            <button class="abre" :disabled="!h.eventos?.length" :aria-expanded="abierto === 't' + j"
                    @click="alternar('t' + j)">
              <span class="cr" :class="{ on: abierto === 't' + j }">{{ h.eventos?.length ? '▸' : '' }}</span>
              <span class="dot" :class="h.status" />
              <span class="l mono" :title="h.label">{{ h.label }}</span>
            </button>
            <span v-if="coincidencias(h)" class="badge badge-outline badge-xs marca">{{ coincidencias(h) }}</span>
            <span v-if="errores(h)" class="badge badge-outline badge-xs errn">{{ errores(h) }} err</span>
            <span class="d" :title="h.detail">{{ h.detail }}</span>
            <button v-if="h.eventos?.length" class="region-action cp" :class="{ ok: copiadoSub === 't' + j }"
                    :aria-label="'Copiar ' + h.label" :title="'Copiar «' + h.label + '»'" @click.stop="copiarSub(h, 't' + j)">
              <span class="ui-icon" :data-icon="copiadoSub === 't' + j ? 'check' : 'copy'" aria-hidden="true"></span>
            </button>
          </div>
          <div v-if="abierto === 't' + j && h.eventos?.length" class="log">
            <table>
              <tr v-for="(ev, k) in h.eventos" :key="k"
                  :class="{ err: ev.level === 'error', hit: resalta(ev.msg) }">
                <td class="ln">{{ k + 1 }}</td><td class="tm">{{ ev.at }}</td><td>{{ ev.msg }}</td>
              </tr>
            </table>
          </div>
        </template>
      </div>
    </section>
    </div>
        </div>
        <div v-else class="empty inspector-vacio">
          <div class="empty-head">
            <div class="empty-media" aria-hidden="true">⌁</div>
            <p class="empty-title">Elegí una solicitud</p>
            <p class="empty-desc">El diagnóstico de la corrida se mostrará en este inspector.</p>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* La referencia aporta un panel de tarjetas sobrias: borde fino, radio generoso y superficies por
   capas. Acá esos rasgos delimitan VISTAS del inspector, sin convertir el diagnóstico en un dashboard. */
.detail-panel { display:flex; flex-direction:column; min-height:0; height:100%; min-width:0; padding:10px;
  gap:8px; overflow:hidden; container-type:inline-size; background:var(--panel2) }
.detail-topbar { flex:none; display:flex; align-items:center; gap:8px; min-height:32px; padding:0 3px;
  color:var(--dim); font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase }
.detail-topbar > :first-child { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.detail-topbar .toolbar-note { color:var(--txt); letter-spacing:0; text-transform:none; font-variant-numeric:tabular-nums }
.detail-topbar .region-action { border:1px solid var(--line); border-radius:var(--r-sm); background:var(--card) }
.detail-topbar .region-action:hover { color:var(--primary); border-color:var(--primary);
  background:color-mix(in srgb, var(--primary) 8%, var(--card)) }

.panel-views { display:flex; flex:1; flex-direction:column; min-height:0 }
.panel-view { display:flex; flex:none; flex-direction:column; min-height:0; overflow:hidden;
  background:var(--card); border:1px solid var(--line); border-radius:var(--r-lg) }
.panel-view.abierta { flex:1 }
.view-heading { flex:none; display:flex; align-items:center; gap:8px; min-height:42px; padding:0 12px;
  color:var(--txt); border-bottom:1px solid var(--line);
  background:color-mix(in srgb, var(--primary) 9%, var(--card)); box-shadow:inset 2px 0 0 var(--primary) }
.view-stage, .view-hint { min-width:0; margin-left:auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:11px; font-weight:400 }
.view-stage { color:var(--dim) }.view-hint { color:var(--tenue) }
.panel-view-body { flex:1; min-height:0 }
.detail-panel-view { container-type:inline-size }
.detail-view-body { display:flex; flex-direction:column; overflow:hidden }
.inspector-vacio { min-height:100%; padding:20px 10px }
/* El encabezado no scrollea; el cuerpo sí. El padding se mudó del `main` a los dos, porque un
   encabezado fijo con el padding del contenedor se despega del borde. */
.detail-view-body .crumb, .detail-view-body .sub2 { flex:none; padding-left:12px; padding-right:12px }
.detail-view-body .crumb { padding-top:10px }
.detail-view-body .region-body { padding:0 12px 12px }
/* Sobre `.breadcrumb`: sólo el tamaño y el peso que esta columna angosta necesita. El reparto de
   color —camino apagado, destino en el color del texto— lo pone la clase compartida. */
.crumb { font-size:13px; margin-bottom:3px; letter-spacing:-.01em }
.crumb .breadcrumb-page { font-weight:600 }
.sub2 { display:flex; flex-wrap:wrap; column-gap:8px; row-gap:3px; color:var(--dim); font-size:12px;
  padding-bottom:12px; margin:0; border-bottom:1px solid var(--line) }
.sub2 > span { min-width:0; overflow-wrap:anywhere }
.sub2 > span + span::before { content:'·'; color:var(--tenue); margin-right:8px }
/* ⚠ Un callout de barra izquierda va CUADRADO. El `border-radius: 0 r r 0` —esquinas redondeadas
   sólo del lado de afuera— era la silueta de la tarjeta vieja: redondea justo el lado que no tiene
   nada, y deja la barra recta peleando con una esquina curva a 2px. Vale para los tres. */
.regla { border-left:2px solid var(--primary); background:color-mix(in srgb, var(--primary) 5%, var(--card)); padding:10px 13px;
  font-size:12px; color:var(--dim); margin:0 0 12px; line-height:1.55 }
.link { display:block; margin:0 0 12px; padding:0; background:none; border:0; cursor:pointer;
  color:var(--info); font-size:12px; text-align:left }
.link:hover { text-decoration:underline }
/* ⚠ Acá decía que la tarjeta «se eleva sobre el panel» con borde, radio y fondo propio, y que era la
   única forma de decir «esto es una pieza» en una paleta sin color. Eran TRES señales para lo mismo,
   en una columna donde todo son piezas apiladas. Lo que separa una sección de la siguiente es su
   ENCABEZADO, y el marco sólo angostaba el contenido y dibujaba cuatro esquinas.
   El encabezado sale a sangre (`margin: 0 -20px` contra el padding del cuerpo): una banda de lado a
   lado se lee como encabezado; una barra con 20px de aire a los costados, como otra tarjeta. */
.sec { margin-bottom:16px }
/* Sobre `.region-head.grupo` de `taller.css`, que ya trae la forma, el color y el pegado. Lo que se
   declara acá son las dos desviaciones: sale A SANGRE (contra los 20px del cuerpo) porque una banda
   de lado a lado se lee como encabezado y una barra con aire a los costados como otra tarjeta; y
   lleva un borde arriba, porque acá los grupos se apilan sin lista de por medio. */
.region-head.grupo { margin:0 -12px; padding:7px 12px; width:calc(100% + 24px);
  border-top:1px solid var(--line) }
.region-head.grupo .gh { display:flex; align-items:center; gap:9px; min-width:0 }
/* El reset del `<button>` vive en `taller.css` (`button.region-head`): acá sólo lo que es de esta
   barra, que es que arrastrarla no seleccione el texto. */
button.region-head.grupo { user-select:none }
.nota { padding:7px 13px; color:var(--dim); font-size:11px; margin:0 }

/* La grilla: caret · punto · nombre · detalle · fuente. `tabular-nums` para que ×24 y las horas no bailen. */
.fila { display:grid; grid-template-columns:minmax(112px,1.1fr) max-content max-content minmax(64px,.75fr) 52px 24px;
  align-items:center; gap:7px; padding:0 13px; border-top:1px solid var(--line); font-size:13px }
.fila:first-child { border-top:0 }
.fila.hijo { padding-left:30px }
.fila.clic:hover { background:color-mix(in srgb, var(--primary) 6%, var(--card)) }
.fila.ab { background:color-mix(in srgb, var(--primary) 9%, var(--card)); box-shadow:inset 2px 0 0 var(--primary); font-weight:500 }
/* Marca de coincidencia del filtro: un borde, no un relleno — el relleno competiría con `ab` (abierto) y
   con el rojo de error, que dicen cosas más importantes. */
.fila.hit { box-shadow:inset 2px 0 0 var(--info) }

/* El disparador es un <button> real (antes `div @click`): teclado y lectores lo ven. Se le quita la piel
   de botón, no el comportamiento. `:disabled` cuando el paso no tiene logs — así el Tab no se detiene en
   filas que no hacen nada. */
.abre { display:grid; grid-template-columns:12px 10px minmax(0,1fr); align-items:center; gap:9px;
  width:100%; padding:6px 0; border:0; background:none; text-align:left; cursor:pointer; min-width:0 }
.abre:disabled { cursor:default }
.abre:focus-visible { outline:2px solid var(--info); outline-offset:-2px }
.cr { color:var(--dim); font-size:10px; display:inline-block; transition:transform .12s }
.cr.on { transform:rotate(90deg) }
.dot { width:8px; height:8px; border-radius:var(--r-full); background:var(--skip); justify-self:center }
.dot.ok{background:var(--ok)} .dot.fail{background:var(--fail)} .dot.warn{background:var(--warn)}
.l { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.l.mono { font-family:ui-monospace,Menlo,monospace; font-size:12px }
.d { min-width:0; overflow:hidden; text-overflow:ellipsis; color:var(--dim); font-size:12px;
  white-space:nowrap; font-variant-numeric:tabular-nums }
/* Sobre `.badge.badge-outline.badge-xs`: la fuente de un dato es una etiqueta, y el radio chico la
   distingue de las píldoras redondas que SÍ se pueden apretar. */
.src { color:var(--tenue); border-radius:var(--r-sm);
  padding:0 5px; white-space:nowrap; justify-self:end }
.region-head.grupo .src { justify-self:auto }

.chips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; align-items:center }
/* ⚠ El borde PUNTEADO se queda: es la seña de «esta etapa está apagada», no decoración. */
.chip { font-size:11.5px; color:var(--tenue); border-style:dashed;
  border-radius:var(--r-full); padding:2px 10px }
.pie { font-size:11px; color:var(--dim); margin:0 }

/* Sobre `.input.input-xs` de `taller.css` (el anillo, el borde y el alto salen de ahí). Lo propio es
   que no ocupa el ancho: vive DENTRO de la barra del grupo, al borde derecho. */
.buscar { margin-left:auto; width:170px; flex:none; font-weight:400 }
.region-head.grupo .src.ok { color:var(--info); border-color:var(--info) }
.marca { color:var(--info); border-color:currentColor;
  padding:0 6px; white-space:nowrap }
/* El conteo de errores va en la fila CERRADA: `eventosDe` dice cuántas líneas hay, no cuántas fallaron, y
   ese es el número que decide si vale la pena abrir. */
.errn { color:var(--fail); border-color:currentColor; border-radius:var(--r-sm); padding:0 5px;
  white-space:nowrap; font-variant-numeric:tabular-nums }
.cp { color:var(--dim); opacity:0; transition:opacity .1s }
.fila:hover .cp, .cp:focus-visible, .cp.ok { opacity:1 }
.cp:hover { color:var(--info); background:var(--sel) }
.cp.ok { color:var(--ok) }
tr.hit td { background:var(--sel) }
tr.hit td:not(.ln) { font-weight:600 }

.why { color:var(--fail); font-family:ui-monospace,Menlo,monospace; font-size:12px;
  background:var(--card); border-left:3px solid var(--fail);
  padding:9px 12px; margin:0 0 12px; white-space:pre-wrap; word-break:break-word }
.log { background:var(--panel2); border-top:1px solid var(--line); overflow-x:auto;
  font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace }
table { border-collapse:collapse; width:100% }
td { padding:0 8px; vertical-align:top; white-space:pre-wrap; word-break:break-word }
td.ln { width:1%; text-align:right; color:var(--texto-2); user-select:none; white-space:nowrap;
  position:sticky; left:0; background:var(--panel2) }
td.tm { width:1%; color:var(--dim); white-space:nowrap; font-variant-numeric:tabular-nums }
tr.err td:not(.ln) { color:var(--fail) }
tr:hover td { background:var(--sel) }

/* LA BD, deliberadamente distinta del log: fondo propio, sin numerar y sin columna de hora. Si se pareciera
   a una tabla de logs, una fila de estado se leería como un evento del flujo. */
.bd { margin: 0 0 2px 26px; padding: 8px 10px; border-left: 2px solid var(--bd, var(--unknown));
      background: color-mix(in srgb, currentColor 4%, transparent); }
.bdh { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin-bottom: 5px; }
.bdf { margin: 0; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.bdq { margin-top: 6px; font-size: 11px; opacity: .7; }
/* Sobre `.accordion-trigger`: acá el disparador vive dentro de un bloque de 11px, así que se le
   baja el alto y el tamaño. Lo que se adopta es el CHEVRON que rota y el anillo de foco. */
.bdq .accordion-trigger { padding: 0; font-size: 11px; font-weight: 400 }
.bdq .accordion-content { padding: 0 }
.bdq.accordion-item { border-bottom: 0 }
.bdq pre { margin: 4px 0 0; padding: 6px 8px; overflow-x: auto; font-size: 11px; line-height: 1.5;
           background: color-mix(in srgb, currentColor 5%, transparent); border-radius:var(--r-sm); }

.detail-toolbar { padding:10px 12px 4px; min-height:var(--region-head-h); border-bottom:0; background:transparent }
.detail-toolbar .crumb { margin:0; padding:0; flex:1; min-width:0; flex-wrap:nowrap; overflow:hidden }
.detail-toolbar .breadcrumb-page { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* El panel puede bajar hasta 280px mientras se redimensiona. En vez de hacer las seis columnas cada
   vez más angostas —hasta que rótulos y badges se monten— el detalle pasa a una segunda línea con su
   propia reserva. La información sigue disponible y no aparece una barra horizontal para una fila. */
@container (max-width: 430px) {
  .detail-view-body .crumb, .detail-view-body .sub2 { padding-left:10px; padding-right:10px }
  .detail-view-body .region-body { padding:0 10px 10px }
  .region-head.grupo { margin-left:-10px; margin-right:-10px; width:calc(100% + 20px); padding-left:10px; padding-right:10px;
    flex-wrap:wrap; row-gap:6px }
  .buscar { order:3; flex:1 0 100%; width:100%; margin-left:0 }
  .fila { grid-template-columns:minmax(0,1fr) max-content max-content 24px; gap:6px; padding:0 10px }
  .fila.hijo { padding-left:22px }
  .d { grid-column:1 / -1; grid-row:2; padding:0 0 8px 31px }
  .src { display:none }
  .cp { grid-column:4; grid-row:1 }
  .bd { margin-left:20px }
  td { padding-left:6px; padding-right:6px }
}
</style>
