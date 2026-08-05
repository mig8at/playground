<script setup>
// El panel derecho: el detalle de la etapa elegida.
//
// UNA SOLA LISTA, no dos. Antes había «sub-pasos vivos» (con nombres de método) y aparte los «hitos
// declarados» del mapa (con nombres de negocio) — dos vistas paralelas del mismo dato, que es como se
// desincronizan. Ahora el server ya agrupa las líneas POR HITO y este componente solo pinta: lo vivo con
// su nombre de negocio, lo declarado sin actividad como chips apagados, y lo técnico plegado al final.
//
// La regla de siempre: acá NO se calcula nada del negocio. Si un estado se ve mal, el bug está en el
// ensamblado Go, no en esta capa.
import { computed, ref } from 'vue'
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~', pendiente:'·' }
const FUENTE = { db:'BD', loki:'logs', default:'supuesto' }
const ESTADO = { ok:'completó', warn:'completó con errores', fail:'FALLÓ', skip:'no se ejecutó',
  'sin-evidencia':'sin evidencia en la BD', 'sin-registro':'ocurrió pero no quedó registrada',
  pendiente:'sin consultar' }

const e = computed(() => t.etapaActiva)
const abrirTecnico = ref(false)

const TECNICO = /^Eventos sin nombre de negocio/

// Los subs que trae la corrida, separados: negocio arriba, lo técnico plegado.
const vivos = computed(() => (e.value?.vivo?.subs || []).filter((s) => !TECNICO.test(s.label)))
const tecnico = computed(() => (e.value?.vivo?.subs || []).find((s) => TECNICO.test(s.label)) || null)

// Los hitos declarados SIN actividad, como chips: dicen «por acá no pasó», que es media respuesta.
// Se casan por label — el server emite los subs con el mismo label del hito, a propósito.
const apagados = computed(() => {
  const con = new Set(vivos.value.map((s) => s.label))
  const out = []
  for (const b of e.value?.bloques || []) {
    for (const h of b.hitos || []) {
      if (!con.has(h.label)) out.push(h)
    }
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
      <template v-if="e.vivo?.eventosDe"> · {{ e.vivo.eventosDe }} líneas de log</template>
      <template v-if="!e.esqueleto"> · <span class="unknown">la BD no puede probar esta etapa</span></template>
    </div>

    <p v-if="e.vivo?.detail" class="regla">{{ e.vivo.detail }}</p>

    <section v-if="e.vivo?.reason" class="sec">
      <h3><span class="ico fail">✕</span> Motivo</h3>
      <pre class="why">{{ e.vivo.reason }}</pre>
    </section>

    <!-- LA LISTA: hechos de BD y actividad por hito de negocio, alineados en grid -->
    <section v-if="vivos.length" class="sec">
      <h3><span class="ico" :class="e.estado === 'fail' ? 'fail' : 'ok'">{{ e.estado === 'fail' ? '✕' : '✓' }}</span>
        Qué pasó <span class="src">{{ vivos.length }}</span></h3>
      <div class="tabla">
        <template v-for="(s, i) in vivos" :key="i">
          <div class="fila">
            <span class="dot" :class="s.status" />
            <span class="l" :title="s.label">{{ s.label }}</span>
            <span class="d">{{ s.detail }}</span>
            <span class="src">{{ FUENTE[s.source] || '' }}</span>
          </div>
          <div v-for="(h, j) in (s.hijos || [])" :key="i + '-' + j" class="fila hijo">
            <span class="dot" :class="h.status" />
            <span class="l" :title="h.label">{{ h.label }}</span>
            <span class="d">{{ h.detail }}</span>
            <span class="src">{{ FUENTE[h.source] || '' }}</span>
          </div>
        </template>
      </div>
    </section>

    <!-- Por acá NO pasó: los hitos declarados sin actividad, compactos -->
    <section v-if="apagados.length && t.traza" class="sec">
      <h3><span class="ico pendiente">·</span> Sin actividad <span class="src">{{ apagados.length }}</span></h3>
      <div class="chips">
        <span v-for="h in apagados" :key="h.id" class="chip"
              :title="h.porque || (h.matcher ? '' : 'se infiere por ausencia')">
          {{ h.label }}<template v-if="h.soloEnCodigo"> *</template>
        </span>
      </div>
      <p v-if="apagados.some((h) => h.soloEnCodigo)" class="nota">* existe en el código pero no se ha medido en logs</p>
    </section>

    <!-- Lo técnico, plegado: el backlog de hitos por declarar -->
    <section v-if="tecnico" class="sec">
      <h3 class="click" @click="abrirTecnico = !abrirTecnico">
        <span class="cr" :class="{ abierto: abrirTecnico }">▸</span>
        <span class="ico skip">·</span> {{ tecnico.label }}
        <span class="src">{{ tecnico.detail }}</span>
      </h3>
      <div v-if="abrirTecnico" class="tabla">
        <div v-for="(h, j) in (tecnico.hijos || [])" :key="j" class="fila hijo">
          <span class="dot" :class="h.status" />
          <span class="l mono" :title="h.label">{{ h.label }}</span>
          <span class="d">{{ h.detail }}</span>
        </div>
      </div>
    </section>

    <!-- Sin traza: el árbol declarado, apagado — el mapa de lo que se va a encender -->
    <template v-if="!t.traza">
      <p v-if="e.porque" class="regla">{{ e.porque }}</p>
      <section v-for="b in (e.bloques || [])" :key="b.id" class="sec">
        <h3><span class="ico pendiente">·</span> {{ b.label }} <span class="src">{{ b.tipo }}</span></h3>
        <p v-if="b.nota" class="nota">{{ b.nota }}</p>
        <div class="tabla">
          <div v-for="h in (b.hitos || [])" :key="h.id" class="fila">
            <span class="dot skip" />
            <span class="l dim">{{ h.label }}</span>
            <span class="d">{{ h.matcher ? '' : 'se infiere por ausencia' }}</span>
            <span v-if="h.soloEnCodigo" class="src">solo en código</span>
          </div>
          <div v-for="v in (b.valores || [])" :key="v.id" class="fila">
            <span class="dot skip" /><span class="l dim">{{ v.label }}</span>
            <span class="d">{{ v.rt ? 'rt ' + v.rt.join('/') : '' }}</span>
          </div>
          <div v-for="c in (b.conocidos || [])" :key="c.id" class="fila">
            <span class="dot skip" /><span class="l dim">{{ c.label }}</span>
            <span class="d">{{ c.nota || '' }}</span>
          </div>
        </div>
      </section>
      <p class="regla dim">
        Todavía no consultaste nada: esto es el árbol <b>declarado</b>. Buscá una cédula, un teléfono o un
        número de solicitud y las etapas se van a encender con lo que la corrida confirme.
      </p>
    </template>

    <!-- El log numerado -->
    <section v-if="e.vivo?.eventos?.length" class="sec">
      <h3><span class="ico ok">✓</span> Log <span class="src">{{ e.vivo.eventosDe }}</span></h3>
      <div class="log">
        <table>
          <tr v-for="(ev, i) in e.vivo.eventos" :key="i" :class="{ err: ev.level === 'error' }">
            <td class="ln">{{ i + 1 }}</td><td class="tm">{{ ev.at }}</td><td>{{ ev.msg }}</td>
          </tr>
        </table>
      </div>
      <p v-if="e.vivo.eventosDe > e.vivo.eventos.length" class="nota">
        mostrando {{ e.vivo.eventos.length }} de {{ e.vivo.eventosDe }} líneas — los errores van primero,
        para que el recorte nunca se coma la causa
      </p>
    </section>
  </main>
</template>

<style scoped>
main { padding:18px 20px; min-width:0 }
.crumb { color:var(--accent); font-size:15px; font-weight:600; margin-bottom:2px; word-break:break-word }
.sub2 { color:var(--dim); font-size:13px; margin-bottom:14px }
.regla { border-left:3px solid var(--accent); background:var(--panel); padding:10px 12px;
  border-radius:0 6px 6px 0; font-size:12px; color:var(--dim); margin:0 0 14px }
.sec { border:1px solid var(--line); border-radius:8px; margin-bottom:14px; overflow:hidden;
  background:var(--panel) }
h3 { display:flex; align-items:center; gap:9px; padding:10px 13px; margin:0; font-size:13px; font-weight:600 }
h3.click { cursor:pointer; user-select:none }
h3.click:hover { background:var(--sel) }
.cr { color:var(--dim); font-size:11px; display:inline-block; transition:transform .12s }
.cr.abierto { transform:rotate(90deg) }
.nota { padding:8px 13px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; margin:0 }

/* LA GRILLA: columnas fijas para que todo quede alineado — dot · nombre · detalle · fuente.
   `tabular-nums` para que ×24 y las horas no bailen. */
.tabla { border-top:1px solid var(--line) }
.fila { display:grid; grid-template-columns:10px minmax(0,1fr) auto 52px; align-items:center;
  gap:10px; padding:6px 13px; border-top:1px solid var(--line); font-size:13px }
.fila:first-child { border-top:0 }
.fila.hijo { grid-template-columns:10px minmax(0,1fr) auto 52px; padding-left:34px }
.dot { width:8px; height:8px; border-radius:50%; background:var(--skip); justify-self:center }
.dot.ok{background:var(--ok)} .dot.fail{background:var(--fail)} .dot.warn{background:var(--warn)}
.l { overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.l.mono { font-family:ui-monospace,Menlo,monospace; font-size:12px }
.d { color:var(--dim); font-size:12px; white-space:nowrap; font-variant-numeric:tabular-nums }
.src { font-size:10px; color:var(--dim); border:1px solid var(--line); border-radius:4px;
  padding:0 5px; white-space:nowrap; justify-self:end }
h3 .src { justify-self:auto }

.chips { display:flex; flex-wrap:wrap; gap:6px; padding:10px 13px; border-top:1px solid var(--line) }
.chip { font-size:12px; color:var(--dim); border:1px dashed var(--line); border-radius:999px; padding:2px 10px }

.why { color:var(--fail); font-family:ui-monospace,Menlo,monospace; font-size:12px;
  padding:9px 13px; margin:0; white-space:pre-wrap; word-break:break-word; border-top:1px solid var(--line) }
.log { background:var(--panel2); border-top:1px solid var(--line); overflow-x:auto;
  font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace }
table { border-collapse:collapse; width:100% }
td { padding:0 8px; vertical-align:top; white-space:pre-wrap; word-break:break-word }
td.ln { width:1%; text-align:right; color:var(--skip); user-select:none; white-space:nowrap;
  position:sticky; left:0; background:var(--panel2) }
td.tm { width:1%; color:var(--dim); white-space:nowrap; font-variant-numeric:tabular-nums }
tr.err td:not(.ln) { color:var(--fail) }
tr:hover td { background:var(--sel) }
</style>
