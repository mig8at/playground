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

const GLYPH = { ok: '✔', warn: '!', fail: '✕', skip: '·', 'sin-evidencia': '?', 'sin-registro': '~',
  'no-aplica': '∅', condicional: '·' }
const DOT = { ok: '●', fail: '✕', warn: '!' }
const SOURCE = { db: 'BD', loki: 'logs', 'db+loki': 'BD+logs', default: 'supuesto' }
const STATUS = { ok: 'completó', warn: 'completó con errores', fail: 'FALLÓ', skip: 'no se ejecutó',
  'sin-evidencia': 'sin evidencia en la BD', 'sin-registro': 'ocurrió pero no quedó registrada',
  'no-aplica': 'no aplica a este ramal', condicional: 'no se puede afirmar si ocurrió' }

const line = (e) => {
  const p = [`${e.at || ''}`, `[${SOURCE[e.source] || '—'}]`]
  if (e.lines) p.push(`${e.lines} líneas`)
  return p.filter(Boolean).join(' · ')
}

// Un renglón de log: `  N  HH:MM:SS  mensaje`, con ERROR marcado en la propia línea porque el texto plano
// no tiene color.
const events = (evs, ofValue, indent) => {
  const out = []
  ;(evs || []).forEach((ev, i) => {
    const err = ev.level === 'error' ? '  ERROR' : ''
    out.push(`${indent}${String(i + 1).padStart(3)}  ${ev.at}${err}  ${ev.msg}`)
  })
  if (ofValue > (evs || []).length) {
    out.push(`${indent}     … ${evs.length} de ${ofValue} líneas (los errores van primero)`)
  }
  return out
}

const sub = (s, indent) => {
  const out = []
  const source = SOURCE[s.source] ? ` [${SOURCE[s.source]}]` : ''
  out.push(`${indent}${DOT[s.status] || '○'} ${s.label}${s.detail ? ' — ' + s.detail : ''}${source}`)
  // La BD ANTES que los logs y marcada como tal: en un hilo de soporte, la afirmación y la fila que la
  // respalda tienen que llegar juntas, o el que lee vuelve a preguntar de dónde salió el número. La
  // consulta va con el `?` ya resuelto para que se pueda pegar en Redash y comprobar.
  if (s.evidence) {
    out.push(`${indent}   ── BD · ${s.evidence.source} ──`)
    s.evidence.rows.forEach((f) => out.push(`${indent}   ${f}`))
    out.push(`${indent}   ${s.evidence.sql.split('\n').map((r) => r.trim()).filter(Boolean).join(' ')}`)
  }
  out.push(...events(s.events, s.eventsOf, indent + '   '))
  for (const h of s.children || []) out.push(...sub(h, indent + '   '))
  return out
}

export function traceToText(tr, stageMap) {
  const L = []

  // Cabecera: los hechos de la solicitud, que es lo primero que un ticket necesita.
  L.push(`── TRAZA · solicitud ${tr.ureq} · ${tr.target} · ${String(tr.outcome || '').toUpperCase()} ──`)
  const meta = [tr.merchant, tr.branch].filter(Boolean).join(' · ')
  const lender = tr.lender ? `${tr.lender} (rt=${tr.rt})` : ''
  const amount = tr.amount ? `monto ${Math.round(tr.amount).toLocaleString('es-CO')}` : ''
  const channel = tr.origin ? `canal ${tr.origin}${tr.derivedOrigin ? '' : ' (supuesto)'}` : ''
  const l2 = [meta, lender, amount, tr.document ? `doc ${tr.document}` : '', channel].filter(Boolean).join(' · ')
  if (l2) L.push(l2)
  if (tr.statusN) L.push(`estado ${tr.status} «${tr.statusN}»${tr.brokeAt ? ` · rompió en: ${tr.brokeAt}` : ''}`)
  L.push(`fuentes: ${(tr.sources || []).join(' + ')}` +
    (stageMap?.version ? ` · mapa v${stageMap.version} + hitos v${stageMap.subVersion}` : ''))
  L.push('')

  for (const e of tr.stages || []) {
    // Las «no aplica» van en una línea: son una pregunta cerrada, no un tramo que leer.
    if (e.status === 'no-aplica') {
      L.push(`${GLYPH[e.status]} ${e.label} — ${e.detail || ''}`)
      L.push('')
      continue
    }
    L.push(`${GLYPH[e.status] || '·'} ${e.label} · ${STATUS[e.status] || e.status} · ${line(e)}`)
    if (e.reason) L.push(`   ✕ motivo: ${e.reason}`)
    if (e.detail) L.push(`   ${e.detail}`)
    for (const s of e.subs || []) L.push(...sub(s, '   '))
    L.push('')
  }

  if (tr.orphans?.length) {
    L.push(`── SIN UBICAR (${tr.orphans.length} líneas que ni el patrón ni el span reclaman) ──`)
    L.push(...events(tr.orphans, tr.orphans.length, '   '))
    L.push('')
  }
  for (const w of tr.warnings || []) L.push(`⚠ ${w}`)
  L.push('')
  L.push('la BD dice QUÉ pasó · los logs dicen POR QUÉ · una ausencia en logs no prueba nada')
  return L.join('\n')
}
