<script setup>
// El panel derecho: el detalle de la etapa elegida — sub-pasos y log numerado.
//
// Muestra los hitos DECLARADOS incluso cuando la corrida no los tocó, en gris. Un hito apagado es
// información: dice que ese paso del flujo no se recorrió. Mostrar solo lo que ocurrió dejaría la pregunta
// «¿y por dónde NO fue?» sin respuesta, que es la mitad de un diagnóstico.
import { computed } from 'vue'
import { useTrazador } from '../stores/trazador'
const t = useTrazador()
const GLIFO = { ok:'✓', warn:'!', fail:'✕', skip:'·', 'sin-evidencia':'?', 'sin-registro':'~', pendiente:'·' }
const FUENTE = { db:'BD', loki:'logs', default:'supuesto' }
const ESTADO = { ok:'completó', warn:'completó con errores', fail:'FALLÓ', skip:'no se ejecutó',
  'sin-evidencia':'sin evidencia en la BD', 'sin-registro':'ocurrió pero no quedó registrada',
  pendiente:'sin consultar' }

const e = computed(() => t.etapaActiva)
// Los sub-pasos que trae la corrida, indexados por etiqueta para poder casarlos con los hitos declarados.
const vivos = computed(() => Object.fromEntries((e.value?.vivo?.subs || []).map((s) => [s.label, s])))
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

    <p v-if="e.porque" class="regla">{{ e.porque }}</p>
    <p v-if="e.vivo?.detail" class="regla">{{ e.vivo.detail }}</p>

    <section v-if="e.vivo?.reason" class="sec">
      <h3><span class="ico fail">✕</span> Motivo</h3>
      <pre class="why">{{ e.vivo.reason }}</pre>
    </section>

    <!-- Los sub-pasos que SÍ trajo la corrida (árbol: familia/central → entidad) -->
    <section v-if="e.vivo?.subs?.length" class="sec">
      <h3><span class="ico ok">✓</span> Sub-pasos <span class="src">{{ e.vivo.subs.length }}</span></h3>
      <div v-for="(s, i) in e.vivo.subs" :key="i">
        <div class="fila">
          <span class="dot" :class="s.status" />
          <span class="l">{{ s.label }}</span>
          <span class="d">{{ s.detail }}</span>
          <span class="src">{{ FUENTE[s.source] || '' }}</span>
        </div>
        <div v-for="(h, j) in (s.hijos || [])" :key="j" class="fila hijo">
          <span class="dot" :class="h.status" />
          <span class="l">{{ h.label }}</span>
          <span class="d">{{ h.detail }}</span>
        </div>
      </div>
    </section>

    <!-- Los hitos DECLARADOS: el árbol que existe siempre, encendido o apagado -->
    <section v-for="b in (e.bloques || [])" :key="b.id" class="sec">
      <h3>
        <span class="ico" :class="b.hitos?.some(h => vivos[h.label]) ? 'ok' : 'pendiente'">
          {{ b.hitos?.some(h => vivos[h.label]) ? '✓' : '·' }}
        </span>
        {{ b.label }}
        <span class="src">{{ b.tipo }}</span>
      </h3>
      <p v-if="b.nota" class="nota">{{ b.nota }}</p>
      <div v-for="h in (b.hitos || [])" :key="h.id" class="fila">
        <span class="dot" :class="vivos[h.label] ? 'ok' : 'skip'" />
        <span class="l" :class="{ dim: !vivos[h.label] }">{{ h.label }}</span>
        <span class="d">{{ h.matcher ? '' : 'se infiere por ausencia' }}</span>
        <span v-if="h.soloEnCodigo" class="src">solo en código</span>
      </div>
      <div v-for="v in (b.valores || [])" :key="v.id" class="fila">
        <span class="dot skip" /><span class="l">{{ v.label }}</span>
        <span class="d">{{ v.rt ? 'rt ' + v.rt.join('/') : '' }}</span>
      </div>
    </section>

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

    <p v-if="!t.traza" class="regla dim">
      Todavía no consultaste nada: esto es el árbol <b>declarado</b>. Buscá una cédula, un teléfono o un
      número de solicitud y las etapas se van a encender con lo que la corrida confirme.
    </p>
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
.nota { padding:8px 13px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; margin:0 }
.fila { display:flex; align-items:center; gap:9px; padding:6px 13px 6px 34px;
  border-top:1px solid var(--line); font-size:13px }
.fila.hijo { padding-left:56px }
.dot { width:8px; height:8px; border-radius:50%; flex:0 0 8px; background:var(--skip) }
.dot.ok{background:var(--ok)} .dot.fail{background:var(--fail)} .dot.warn{background:var(--warn)}
.l { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.d { color:var(--dim); font-size:12px; white-space:nowrap }
.why { color:var(--fail); font-family:ui-monospace,Menlo,monospace; font-size:12px;
  padding:9px 13px; margin:0; white-space:pre-wrap; word-break:break-word; border-top:1px solid var(--line) }
.log { background:var(--panel2); border-top:1px solid var(--line); overflow-x:auto;
  font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace }
table { border-collapse:collapse; width:100% }
td { padding:0 8px; vertical-align:top; white-space:pre-wrap; word-break:break-word }
td.ln { width:1%; text-align:right; color:var(--skip); user-select:none; white-space:nowrap;
  position:sticky; left:0; background:var(--panel2) }
td.tm { width:1%; color:var(--dim); white-space:nowrap }
tr.err td:not(.ln) { color:var(--fail) }
tr:hover td { background:var(--sel) }
</style>
