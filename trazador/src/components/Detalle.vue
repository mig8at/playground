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
</script>

<template>
  <main v-if="e">
    <div class="crumb">
      {{ t.traza?.target || t.target }} / {{ t.traza?.ureq ?? '—' }} / {{ e.label }}
    </div>
    <div class="sub2">
      {{ ESTADO[e.estado] || e.estado }}
      <template v-if="e.vivo?.at"> · a las {{ e.vivo.at }}</template>
      <template v-if="e.vivo?.source"> · fuente <b>{{ FUENTE[e.vivo.source] || '—' }}</b></template>
      <template v-if="e.vivo?.eventosDe"> · {{ e.vivo.eventosDe }} líneas</template>
      <template v-if="!e.esqueleto"> · <span class="unknown">la BD no puede probar esta etapa</span></template>
    </div>

    <!-- El motivo de un fallo va SIEMPRE visible: es la respuesta a «¿por qué se cortó?» -->
    <pre v-if="e.vivo?.reason" class="why">{{ e.vivo.reason }}</pre>

    <!-- El detalle declarado (a veces son párrafos) va plegado: contexto, no respuesta. -->
    <template v-if="e.vivo?.detail || e.porque">
      <p v-if="(e.vivo?.detail || e.porque).length < 120" class="regla">{{ e.vivo?.detail || e.porque }}</p>
      <template v-else>
        <button class="link" @click="abrirPorque = !abrirPorque">
          {{ abrirPorque ? '− ocultar' : '+ por qué' }}
        </button>
        <p v-if="abrirPorque" class="regla">{{ e.vivo?.detail || e.porque }}</p>
      </template>
    </template>

    <!-- LOS SUB-PASOS. Cada uno se abre y muestra SUS líneas. -->
    <section v-if="vivos.length" class="sec">
      <h3><span class="ico" :class="e.estado === 'fail' ? 'fail' : (hayDatos ? 'ok' : 'pendiente')">{{
        e.estado === 'fail' ? '✕' : (hayDatos ? '✓' : '·') }}</span>
        {{ hayDatos ? 'Pasos' : 'Nada medido acá' }} <span class="src">{{ vivos.length }}</span>
        <input v-model="filtro" class="buscar" type="search" placeholder="buscar en los logs…"
               aria-label="Buscar dentro de esta etapa" />
        <span v-if="filtro.trim()" class="src" :class="{ ok: totalCoincidencias }">
          {{ totalCoincidencias }} coincidencia{{ totalCoincidencias === 1 ? '' : 's' }}</span>
      </h3>
      <div class="tabla">
        <template v-for="(s, i) in vivos" :key="i">
          <div class="fila" :class="{ clic: abrible(s), ab: abierto === i, hit: coincidencias(s) }">
            <button class="abre" :disabled="!abrible(s)" :aria-expanded="abierto === i"
                    @click="alternar(i)">
              <span class="cr" :class="{ on: abierto === i }">{{ abrible(s) ? '▸' : '' }}</span>
              <span class="dot" :class="s.status" />
              <span class="l" :title="s.label">{{ s.label }}</span>
            </button>
            <span v-if="coincidencias(s)" class="marca">{{ coincidencias(s) }}</span>
            <span v-if="errores(s)" class="errn" :title="errores(s) + ' líneas de error'">{{ errores(s) }} err</span>
            <span class="d">{{ s.detail }}</span>
            <span class="src">{{ FUENTE[s.source] || '' }}</span>
            <button v-if="abrible(s) || s.hijos?.length" class="cp" :class="{ ok: copiadoSub === i }"
                    :title="'Copiar «' + s.label + '» con sus logs'" @click.stop="copiarSub(s, i)">
              {{ copiadoSub === i ? '✓' : '⧉' }}
            </button>
          </div>
          <!-- LA BD PRIMERO Y APARTE: es un ESTADO, no un evento. Va sin número de línea y sin hora en la
               misma columna que los logs a propósito — verlas juntas invita a leer una fila de BD como un
               momento del flujo, y `updated_at` se mueve con el webhook. -->
          <div v-if="abierto === i && s.evidencia" class="bd">
            <div class="bdh">BD · {{ s.evidencia.fuente }}</div>
            <p v-for="(f, k) in s.evidencia.filas" :key="k" class="bdf">{{ f }}</p>
            <details class="bdq"><summary>la consulta que corrió</summary><pre>{{ s.evidencia.sql }}</pre></details>
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
              <span v-if="coincidencias(h)" class="marca">{{ coincidencias(h) }}</span>
              <span v-if="errores(h)" class="errn" :title="errores(h) + ' líneas de error'">{{ errores(h) }} err</span>
              <span class="d">{{ h.detail }}</span>
              <span class="src">{{ FUENTE[h.source] || '' }}</span>
              <button v-if="abrible(h)" class="cp" :class="{ ok: copiadoSub === i + '-' + j }"
                      :title="'Copiar «' + h.label + '» con sus logs'" @click.stop="copiarSub(h, i + '-' + j)">
                {{ copiadoSub === i + '-' + j ? '✓' : '⧉' }}
              </button>
            </div>
            <div v-if="abierto === i + '-' + j && h.evidencia" class="bd">
              <div class="bdh">BD · {{ h.evidencia.fuente }}</div>
              <p v-for="(f, k) in h.evidencia.filas" :key="k" class="bdf">{{ f }}</p>
              <details class="bdq"><summary>la consulta que corrió</summary><pre>{{ h.evidencia.sql }}</pre></details>
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
      <button class="link" @click="verApagados = !verApagados">
        {{ verApagados ? '−' : '+' }} {{ apagados.length }} paso{{ apagados.length === 1 ? '' : 's' }} sin actividad
      </button>
      <div v-if="verApagados" class="chips">
        <span v-for="h in apagados" :key="h.id" class="chip"
              :title="h.porque || (h.matcher ? '' : 'se infiere por ausencia')">
          {{ h.label }}<template v-if="h.soloEnCodigo"> *</template>
        </span>
        <span v-if="apagados.some((h) => h.soloEnCodigo)" class="pie">* existe en el código, no medido en logs</span>
      </div>
    </template>

    <!-- Lo técnico: el backlog de pasos por declarar. También se abre por renglón. -->
    <section v-if="tecnico" class="sec">
      <h3 class="click" @click="abrirTecnico = !abrirTecnico">
        <span class="cr" :class="{ on: abrirTecnico }">▸</span>
        <span class="ico pendiente">·</span> {{ tecnico.label }}
        <span class="src">sin nombre de negocio</span>
      </h3>
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
            <span v-if="coincidencias(h)" class="marca">{{ coincidencias(h) }}</span>
            <span v-if="errores(h)" class="errn">{{ errores(h) }} err</span>
            <span class="d">{{ h.detail }}</span>
            <button v-if="h.eventos?.length" class="cp" :class="{ ok: copiadoSub === 't' + j }"
                    :title="'Copiar «' + h.label + '»'" @click.stop="copiarSub(h, 't' + j)">
              {{ copiadoSub === 't' + j ? '✓' : '⧉' }}
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

    <!-- Sin traza: el árbol declarado, apagado -->
    <template v-if="!t.traza">
      <section v-for="b in (e.bloques || [])" :key="b.id" class="sec">
        <h3><span class="ico pendiente">·</span> {{ b.label }} <span class="src">{{ b.tipo }}</span></h3>
        <div class="tabla">
          <div v-for="h in (b.hitos || [])" :key="h.id" class="fila">
            <span class="cr" /><span class="dot skip" /><span class="l dim">{{ h.label }}</span>
            <span class="d">{{ h.matcher ? '' : 'se infiere por ausencia' }}</span>
          </div>
          <div v-for="v in (b.valores || [])" :key="v.id" class="fila">
            <span class="cr" /><span class="dot skip" /><span class="l dim">{{ v.label }}</span>
            <span class="d">{{ v.rt ? 'rt ' + v.rt.join('/') : '' }}</span>
          </div>
          <div v-for="c in (b.conocidos || [])" :key="c.id" class="fila">
            <span class="cr" /><span class="dot skip" /><span class="l dim">{{ c.label }}</span>
            <span class="d">{{ c.nota || '' }}</span>
          </div>
        </div>
      </section>
      <p class="regla dim">
        Todavía no consultaste nada: esto es el árbol <b>declarado</b>. Buscá una cédula, un teléfono o un
        número de solicitud y las etapas se van a encender con lo que la corrida confirme.
      </p>
    </template>
  </main>
</template>

<style scoped>
main { padding:18px 20px; min-width:0 }
.crumb { color:var(--accent); font-size:15px; font-weight:600; margin-bottom:2px; word-break:break-word }
.sub2 { color:var(--dim); font-size:13px; margin-bottom:12px }
.regla { border-left:3px solid var(--accent); background:var(--panel); padding:10px 12px;
  border-radius:0 6px 6px 0; font-size:12px; color:var(--dim); margin:0 0 12px; line-height:1.55 }
.link { display:block; margin:0 0 12px; padding:0; background:none; border:0; cursor:pointer;
  color:var(--accent); font-size:12px; text-align:left }
.link:hover { text-decoration:underline }
.sec { border:1px solid var(--line); border-radius:8px; margin-bottom:12px; overflow:hidden;
  background:var(--panel) }
h3 { display:flex; align-items:center; gap:9px; padding:10px 13px; margin:0; font-size:13px; font-weight:600 }
h3.click { cursor:pointer; user-select:none }
h3.click:hover { background:var(--sel) }
.nota { padding:7px 13px; color:var(--dim); font-size:11px; margin:0 }

/* La grilla: caret · punto · nombre · detalle · fuente. `tabular-nums` para que ×24 y las horas no bailen. */
.tabla { border-top:1px solid var(--line) }
.fila { display:grid; grid-template-columns:minmax(0,1fr) auto auto auto 52px 24px; align-items:center;
  gap:9px; padding:0 13px; border-top:1px solid var(--line); font-size:13px }
.fila:first-child { border-top:0 }
.fila.hijo { padding-left:30px }
.fila.clic:hover { background:var(--sel) }
.fila.ab { background:var(--sel); font-weight:600 }
/* Marca de coincidencia del filtro: un borde, no un relleno — el relleno competiría con `ab` (abierto) y
   con el rojo de error, que dicen cosas más importantes. */
.fila.hit { box-shadow:inset 2px 0 0 var(--accent) }

/* El disparador es un <button> real (antes `div @click`): teclado y lectores lo ven. Se le quita la piel
   de botón, no el comportamiento. `:disabled` cuando el paso no tiene logs — así el Tab no se detiene en
   filas que no hacen nada. */
.abre { display:grid; grid-template-columns:12px 10px minmax(0,1fr); align-items:center; gap:9px;
  width:100%; padding:6px 0; border:0; background:none; text-align:left; cursor:pointer; min-width:0 }
.abre:disabled { cursor:default }
.abre:focus-visible { outline:2px solid var(--accent); outline-offset:-2px }
.cr { color:var(--dim); font-size:10px; display:inline-block; transition:transform .12s }
.cr.on { transform:rotate(90deg) }
.dot { width:8px; height:8px; border-radius:50%; background:var(--skip); justify-self:center }
.dot.ok{background:var(--ok)} .dot.fail{background:var(--fail)} .dot.warn{background:var(--warn)}
.l { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.l.mono { font-family:ui-monospace,Menlo,monospace; font-size:12px }
.d { color:var(--dim); font-size:12px; white-space:nowrap; font-variant-numeric:tabular-nums }
.src { font-size:10px; color:var(--dim); border:1px solid var(--line); border-radius:4px;
  padding:0 5px; white-space:nowrap; justify-self:end }
h3 .src { justify-self:auto }

.chips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; align-items:center }
.chip { font-size:12px; color:var(--dim); border:1px dashed var(--line); border-radius:999px; padding:2px 10px }
.pie { font-size:11px; color:var(--dim); margin:0 }

.buscar { margin-left:auto; width:170px; padding:2px 8px; font-size:12px; border:1px solid var(--line);
  border-radius:5px; background:var(--bg); color:var(--txt); font-weight:400 }
.buscar:focus { outline:1px solid var(--accent); outline-offset:-1px }
h3 .src.ok { color:var(--accent); border-color:var(--accent) }
.marca { font-size:10px; color:var(--accent); border:1px solid var(--accent); border-radius:999px;
  padding:0 6px; white-space:nowrap }
/* El conteo de errores va en la fila CERRADA: `eventosDe` dice cuántas líneas hay, no cuántas fallaron, y
   ese es el número que decide si vale la pena abrir. */
.errn { font-size:10px; color:var(--fail); border:1px solid var(--fail); border-radius:3px; padding:0 5px;
  white-space:nowrap; font-variant-numeric:tabular-nums }
.cp { border:0; background:none; color:var(--dim); cursor:pointer; font-size:12px; padding:2px 4px;
  border-radius:4px; opacity:0; transition:opacity .1s }
.fila:hover .cp, .cp:focus-visible, .cp.ok { opacity:1 }
.cp:hover { color:var(--accent); background:var(--sel) }
.cp.ok { color:var(--ok) }
tr.hit td { background:var(--sel) }
tr.hit td:not(.ln) { font-weight:600 }

.why { color:var(--fail); font-family:ui-monospace,Menlo,monospace; font-size:12px;
  background:var(--panel); border-left:3px solid var(--fail); border-radius:0 6px 6px 0;
  padding:9px 12px; margin:0 0 12px; white-space:pre-wrap; word-break:break-word }
.log { background:var(--panel2); border-top:1px solid var(--line); overflow-x:auto;
  font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace }
table { border-collapse:collapse; width:100% }
td { padding:0 8px; vertical-align:top; white-space:pre-wrap; word-break:break-word }
td.ln { width:1%; text-align:right; color:var(--skip); user-select:none; white-space:nowrap;
  position:sticky; left:0; background:var(--panel2) }
td.tm { width:1%; color:var(--dim); white-space:nowrap; font-variant-numeric:tabular-nums }
tr.err td:not(.ln) { color:var(--fail) }
tr:hover td { background:var(--sel) }

/* LA BD, deliberadamente distinta del log: fondo propio, sin numerar y sin columna de hora. Si se pareciera
   a una tabla de logs, una fila de estado se leería como un evento del flujo. */
.bd { margin: 0 0 2px 26px; padding: 8px 10px; border-left: 2px solid var(--bd, #8b6cc1);
      background: color-mix(in srgb, currentColor 4%, transparent); border-radius: 0 3px 3px 0; }
.bdh { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .65; margin-bottom: 5px; }
.bdf { margin: 0; font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }
.bdq { margin-top: 6px; font-size: 11px; opacity: .7; }
.bdq summary { cursor: pointer; }
.bdq pre { margin: 4px 0 0; padding: 6px 8px; overflow-x: auto; font-size: 11px; line-height: 1.5;
           background: color-mix(in srgb, currentColor 5%, transparent); border-radius: 3px; }

</style>
