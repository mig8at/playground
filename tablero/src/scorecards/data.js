// Modelo del framework Rocks & Scorecards · Tecnología · Q3 2026.
// Datos de W1 (semana 29-jun a 5-jul 2026) sembrados desde la bitácora real.

export const QUARTER = {
  name: 'Q3 2026',
  range: '06-jul a 28-sep · 13 semanas',
  weeks: 13,
}

export const EMOJI = { green: '🟢', yellow: '🟡', red: '🔴', none: '·' }

export const LEGEND = [
  { status: 'green', label: 'CUMPLE', desc: 'meta alcanzada' },
  { status: 'yellow', label: 'ALERTA', desc: 'cerca de la meta' },
  { status: 'red', label: 'INCUMPLE', desc: 'requiere acción' },
  { status: 'none', label: 'SIN DATO', desc: 'aún no medido' },
]

// Construye la fila de 13 semanas; siembra W1 y deja el resto en "sin dato".
function weeks(w1) {
  const arr = Array.from({ length: QUARTER.weeks }, () => ({ status: 'none', value: '' }))
  if (w1) arr[0] = { status: w1.status, value: w1.value }
  return arr
}

export const ROCKS = [
  {
    id: 'laura',
    n: 1,
    owner: 'Laura Cabra',
    title: 'Destrabar el revenue bloqueado por tech',
    description:
      'Cumplir el pipeline 100% de producto en las fechas comprometidas, asegurando un flujo de entrega predecible y gestionando oportunamente los bloqueos que puedan afectar su ejecución.',
    kpis: [
      { name: '% de cumplimiento del pipeline (salidas / comprometidas por Tech)', target: '90%', weeks: weeks({ status: 'red', value: '36.36%' }) },
      { name: 'Número de entregables detenidos por externos', target: '0', weeks: weeks({ status: 'red', value: '2' }) },
      { name: 'Número de entregables detenidos por Creditop', target: '0', weeks: weeks({ status: 'red', value: '5' }) },
    ],
  },
  {
    id: 'oscar',
    n: 2,
    owner: 'Oscar Rincón',
    title: 'Estabilidad de flujos críticos de producción',
    description:
      'Mantener la estabilidad de los flujos críticos de producción en un nivel igual o superior al 95% durante el Q.',
    kpis: [
      { name: '# incidentes críticos en producción', target: '0 / sem', weeks: weeks({ status: 'red', value: '3' }), detail: true },
      { name: 'Disponibilidad semanal de los flujos críticos', target: '≥ 99.9%', weeks: weeks({ status: 'red', value: '99.1%' }), detail: true },
      { name: '% releases sin regresiones (7 días post-despliegue)', target: '≥ 95%', weeks: weeks({ status: 'red', value: '33%' }), detail: true },
      { name: '# incidentes relacionados con releases recientes', target: '≤ 1 / sem', weeks: weeks({ status: 'red', value: '2' }), detail: true },
    ],
  },
]

// ---- Detalle W1 del Rock de Oscar (la página hija del PDF) ----

// Índice de estabilidad = Σ(salud × peso) / 100. Pesos editables → recalcula.
export const STABILITY = {
  week: 'W1',
  target: 95,
  components: [
    { kpi: 'Disponibilidad de flujos críticos', formula: 'valor directo', health: 99.1, weight: 40 },
    { kpi: '# incidentes críticos', formula: '100 − 20×3', health: 40, weight: 25 },
    { kpi: '% releases sin regresiones', formula: 'valor directo', health: 33, weight: 20 },
    { kpi: '# incidentes de releases', formula: '100 − 30×(2−1)', health: 70, weight: 15 },
  ],
}

export const AVAILABILITY = {
  total: 99.1,
  target: 99.9,
  capacityMin: 50400,
  downtimeMin: 450,
  windowNote: 'Horario de servicio 8:00–20:00 × 7 días = 84 h/flujo (5.040 min). 10 flujos → capacidad 50.400 flujo-min.',
  flows: ['Dentix', 'Sonria', 'Refurbi', 'Pullman', 'Smartpay', 'Welli', 'DFS', 'Bancolombia', 'Prami', 'Crédito Directo/Credimovil'],
  byCause: [
    { view: 'Total (lo que vivió el negocio)', downtime: 450, avail: '99.1%', status: 'red', strong: true },
    { view: 'Atribuible a causas internas', downtime: 138, avail: '99.73%' },
    { view: 'Atribuible a terceros (Welli 294 + Dentix 18)', downtime: 312, avail: 'impacto 0.62 pts' },
  ],
  worst: 'Welli ≈ 94.17% (tercero). Dentix = 99.64% (tercero).',
}

export const INCIDENTS = [
  { date: '3-jul', flow: 'Welli', incident: 'Flujo roto en originación ("ya funciona todo bien", 17:54)', type: 'A', cause: 'tercero', scope: '~294 min (13:00→17:54) · todos los PDV', downtime: 294, counts: true,
    note: 'No fue el release. Welli cambió el formato de fecha de nacimiento sin avisar y se rompió el flujo.' },
  { date: '3-jul', flow: 'Dentix', incident: 'Firma caída por certificado Deceval vencido → apagada en todos los PDV (13:47)', type: 'A', cause: 'tercero', scope: '~18 min (13:29→13:47) · todos los PDV', downtime: 18, counts: true,
    note: 'Se toma "apagada en todos los PDV" como cierre de nuestra ventana; el resto quedó en el tercero (Deceval).' },
  { date: '3–4 jul', flow: 'Refurbi', incident: 'Doble cobro de cuota inicial no reflejado', type: 'A/B', cause: 'interna', scope: '~120 min · parcial (0.3)', downtime: 36, counts: true, note: '' },
  { date: '4-jul', flow: 'Smartpay', incident: 'Error al tomar pago del usuario comercial', type: 'B', cause: 'interna', scope: '~100 min · 1 comercio (0.4)', downtime: 40, counts: true, note: '' },
  { date: '2-jul', flow: 'Prami', incident: 'Error en Smart Idiomas', type: 'B', cause: 'interna', scope: '~30 min · parcial (0.4)', downtime: 12, counts: true, note: '' },
  { date: 'Varios', flow: 'Perfilador / integraciones', incident: 'Perfilador no muestra FG, Welli no ofrecido, CTX, Bancolombia, Credipullman intermitente (agregado)', type: 'B', cause: 'interna', scope: 'agregado · parcial', downtime: 50, counts: true, note: 'Degradaciones menores agregadas.' },
  { date: '1-jul', flow: 'Refurbi', incident: 'Ecommerce: "cualquier usuario obtiene error"', type: '—', cause: 'negocio', scope: '—', downtime: 0, counts: false,
    note: 'Error de políticas (no pasó políticas), no es error nuestro. NO cuenta.' },
  { date: '2-jul', flow: 'Pullman', incident: 'No genera pago de clientes', type: '—', cause: 'tercero', scope: '—', downtime: 0, counts: false, note: 'Escalado con Pullman (soporte). NO cuenta.' },
  { date: '2-jul', flow: 'Prami', incident: 'Centro Sanare no ofrece entidad', type: '—', cause: 'tercero', scope: '—', downtime: 0, counts: false, note: 'Caso de soporte escalado a terceros. NO cuenta.' },
]

export const CRITICAL_INCIDENTS = {
  count: 3,
  breakdown: 'Welli (tercero), Dentix (tercero) y Refurbi doble cuota (interno). Interno = 1 · Terceros = 2.',
}

export const RELEASES = [
  { name: 'Crédito Directo (nueva funcionalidad en comercio)', regression: true, incident: true, cause: 'Interna (tech)', note: 'Se reversó la funcionalidad en el comercio por la incidencia.' },
  { name: 'Refactor de entidades (Welli)', regression: false, incident: false, cause: '—', note: 'Release limpio. El bug que apareció fue por un cambio de formato de fecha de Welli (tercero), no por el despliegue.' },
  { name: 'Cambio de fondo de garantías', regression: true, incident: true, cause: 'Negocio/spec', note: 'No fue defecto de código: el cambio subía el costo de los créditos al desembolsar y se reversó. Cuenta igual porque el release entregó el cambio y hubo que devolverlo.' },
]

export const RELEASE_KPIS = {
  sinRegresiones: '1 / 3 = 33%',
  incidentesRelease: '2',
}

export const DATA_INTEGRITY = {
  title: 'Fuera de disponibilidad, pero el mayor impacto de la semana',
  text: 'El golpe operativo más grande no fue de disponibilidad, fue de integridad de datos (Tipo D): el incidente del fondo de garantías (3-jul) dejó "todos los créditos de dos días mal", con montos inflados e implicaciones legales. No baja la disponibilidad, pero sí cuenta como release con regresión. Conclusión: se necesita una métrica separada de integridad/rework.',
}

export const SOURCES = ['#tech-ops', '#producto-tech']
