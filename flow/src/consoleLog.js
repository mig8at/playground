import { reactive } from 'vue'

// La consola de Flow (el `panel` de la base, 2026-11-26): la salida que se sigue en el tiempo. Lo que llega por `bin/flow`
// —cada comando con lo que contestó la app, o su error— para ver qué cargó Claude en el escenario y cuándo. Vive en
// memoria: al recargar empieza vacía (lo que importa, el escenario, ya se guarda solo).
const MAX = 300
export const consoleLog = reactive({ lines: [], unseen: 0 })

export function logLine(text, { kind = '', source = 'bin/flow' } = {}) {
  consoleLog.lines.push({ id: Date.now() + Math.random(), at: new Date(), text, kind, source })
  if (consoleLog.lines.length > MAX) consoleLog.lines.splice(0, consoleLog.lines.length - MAX)
  consoleLog.unseen++
}
export function clearLog() { consoleLog.lines.splice(0); consoleLog.unseen = 0 }

// Una línea legible por comando: qué se pidió y qué quedó.
export function describeCommand(c, r) {
  if (!r.ok) return `${c.type}: ${r.error}`
  switch (c.type) {
    case 'import': return `import · ${r.name} (rt${r.rt})${c.payload?.sucursal?.id ? ' de la sucursal ' + c.payload.sucursal.id : ''}`
    case 'add': return `add · ${r.name}`
    case 'select': return `select · ${r.selected}`
    case 'unselect': return 'unselect · sin entidad elegida'
    case 'remove': return `remove · ${r.removed}`
    case 'clear': return `clear · ${r.removed.length ? r.removed.join(', ') : 'no había entidades'}`
    case 'client': return 'client · ' + (Object.entries(r.client || {}).map(([k, v]) => `${k}=${v}`).join(' ') || 'sin cambios')
    case 'view': return `view · ${r.view === 'graph' ? 'grafo' : 'tabla'}`
    case 'delegated': return `delegated · ${c.name}`
    default: return c.type
  }
}
