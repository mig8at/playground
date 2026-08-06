// La traza COMPLETA como texto plano, para el portapapeles.
//
// Existe porque el destino de una traza casi nunca es la pantalla donde se armó: se pega en un ticket de
// Jira, en un hilo de Slack o en un prompt de un modelo. Un screenshot no se puede grepear ni citar; este
// texto sí, y lleva TODO junto — los hechos de la BD (estados, centrales, scores), los logs de cada paso con
// su hora, los avisos y lo que quedó sin ubicar.
//
// Es un RENDER más del mismo `Traza` que pintan la consola, el HTML y la Vue: acá no se decide nada, solo se
// serializa. Si un estado sale mal en el texto, el bug está en el ensamblado Go.
//
// Formato: texto plano con glifos, indentado a mano. Markdown haría más ruido del que quita — los mensajes
// de log traen backticks, asteriscos y llaves que romperían el formato al pegarse.

const GLIFO = { ok: '✔', warn: '!', fail: '✕', skip: '·', 'sin-evidencia': '?', 'sin-registro': '~',
  'no-aplica': '∅', condicional: '·' }
const PUNTO = { ok: '●', fail: '✕', warn: '!' }
const FUENTE = { db: 'BD', loki: 'logs', 'db+loki': 'BD+logs', default: 'supuesto' }
const ESTADO = { ok: 'completó', warn: 'completó con errores', fail: 'FALLÓ', skip: 'no se ejecutó',
  'sin-evidencia': 'sin evidencia en la BD', 'sin-registro': 'ocurrió pero no quedó registrada',
  'no-aplica': 'no aplica a este ramal', condicional: 'no se puede afirmar si ocurrió' }

const linea = (e) => {
  const p = [`${e.at || ''}`, `[${FUENTE[e.source] || '—'}]`]
  if (e.lineas) p.push(`${e.lineas} líneas`)
  return p.filter(Boolean).join(' · ')
}

// Un renglón de log: `  N  HH:MM:SS  mensaje`, con ERROR marcado en la propia línea porque el texto plano
// no tiene color.
const eventos = (evs, de, sangria) => {
  const out = []
  ;(evs || []).forEach((ev, i) => {
    const err = ev.level === 'error' ? '  ERROR' : ''
    out.push(`${sangria}${String(i + 1).padStart(3)}  ${ev.at}${err}  ${ev.msg}`)
  })
  if (de > (evs || []).length) {
    out.push(`${sangria}     … ${evs.length} de ${de} líneas (los errores van primero)`)
  }
  return out
}

const sub = (s, sangria) => {
  const out = []
  const fuente = FUENTE[s.source] ? ` [${FUENTE[s.source]}]` : ''
  out.push(`${sangria}${PUNTO[s.status] || '○'} ${s.label}${s.detail ? ' — ' + s.detail : ''}${fuente}`)
  out.push(...eventos(s.eventos, s.eventosDe, sangria + '   '))
  for (const h of s.hijos || []) out.push(...sub(h, sangria + '   '))
  return out
}

export function trazaATexto(tr, mapa) {
  const L = []

  // Cabecera: los hechos de la solicitud, que es lo primero que un ticket necesita.
  L.push(`── TRAZA · solicitud ${tr.ureq} · ${tr.target} · ${String(tr.outcome || '').toUpperCase()} ──`)
  const meta = [tr.comercio, tr.sucursal].filter(Boolean).join(' · ')
  const lender = tr.lender ? `${tr.lender} (rt=${tr.rt})` : ''
  const monto = tr.monto ? `monto ${Math.round(tr.monto).toLocaleString('es-CO')}` : ''
  const canal = tr.origen ? `canal ${tr.origen}${tr.origenDerivado ? '' : ' (supuesto)'}` : ''
  const l2 = [meta, lender, monto, tr.documento ? `doc ${tr.documento}` : '', canal].filter(Boolean).join(' · ')
  if (l2) L.push(l2)
  if (tr.estadoN) L.push(`estado ${tr.estado} «${tr.estadoN}»${tr.brokeAt ? ` · rompió en: ${tr.brokeAt}` : ''}`)
  L.push(`fuentes: ${(tr.sources || []).join(' + ')}` +
    (mapa?.version ? ` · mapa v${mapa.version} + hitos v${mapa.subVersion}` : ''))
  L.push('')

  for (const e of tr.etapas || []) {
    // Las «no aplica» van en una línea: son una pregunta cerrada, no un tramo que leer.
    if (e.status === 'no-aplica') {
      L.push(`${GLIFO[e.status]} ${e.label} — ${e.detail || ''}`)
      L.push('')
      continue
    }
    L.push(`${GLIFO[e.status] || '·'} ${e.label} · ${ESTADO[e.status] || e.status} · ${linea(e)}`)
    if (e.reason) L.push(`   ✕ motivo: ${e.reason}`)
    if (e.detail) L.push(`   ${e.detail}`)
    for (const s of e.subs || []) L.push(...sub(s, '   '))
    L.push('')
  }

  if (tr.huerfanas?.length) {
    L.push(`── SIN UBICAR (${tr.huerfanas.length} líneas que ni el patrón ni el span reclaman) ──`)
    L.push(...eventos(tr.huerfanas, tr.huerfanas.length, '   '))
    L.push('')
  }
  for (const w of tr.warnings || []) L.push(`⚠ ${w}`)
  L.push('')
  L.push('la BD dice QUÉ pasó · los logs dicen POR QUÉ · una ausencia en logs no prueba nada')
  return L.join('\n')
}
