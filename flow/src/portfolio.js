// LA PISTA DE CARTERA: la vida de un crédito CreditopX después del 11, noche por noche. Es un modelo DE JUGUETE para
// entender, no un cálculo de producción: sigue la forma de `UpdateCreditopXRequestsCommand` (la causación) y de
// `processPayment` (la cascada), con números de ejemplo. De dónde sale cada pieza, en knowledge/:
//   · creditopx-portfolio-servicing#La causación por dentro: corte, interés del día y mora
//   · creditopx-portfolio-servicing#Gasto de cobranza por días de mora
//   · creditopx-payment-application#El pago mínimo va en cascada · #Qué pasa con el sobrante
//   · creditopx-credit-states (los estados y sus grupos) · creditopx-offer-calculation (FGA y cuota)
// Lo que simplifica, a propósito: corte mensual con la fecha de pago 5 días después; la tasa diaria es la mensual / 30;
// el seguro de vida es un valor por millón sobre el capital por facturar; sin colillas, subsidio ni pronto pago.
import { reactive, watch } from 'vue'

/** Los supuestos del ejemplo. Se editan en la vista; ninguno sale de una entidad real. */
export const DEFAULT_ASSUMPTIONS = {
  amount: 3000000, // lo que compra Juan
  downPayment: 0,
  term: 12, // cuotas
  monthlyRate: 1.9, // % mensual, interés corriente
  lateRate: 2.2, // % mensual, interés de mora
  fgaPct: 9, // % del FGA (en qa: 5 en AA·A·B y 9 en C·S·Y)
  vatPct: 19, // IVA del FGA
  lifePerMillion: 1500, // seguro de vida por millón de capital, cada mes
  guaranteeFee: 2000, // seguro de garantía, cargo fijo de cada corte
  ctxCommissionPct: 3, // comisión CTX del comercio a CreditOp, sobre lo desembolsado (forecast: tasa por comercio)
}

/** Los tramos del gasto de cobranza: se cobra el día en que la mora llega al inicio del tramo. */
export const COLLECTION_TIERS = [
  { from: 11, amount: 20000 },
  { from: 31, amount: 35000 },
  { from: 61, amount: 50000 },
]

/** Las historias que se pueden contar. */
export const SCENARIOS = [
  { key: 'ontime', label: 'Paga a tiempo', hint: 'Cada mes paga el mínimo el día del vencimiento.' },
  { key: 'late', label: 'Se atrasa 45 días', hint: 'No paga la cuota 2; a los 45 días se pone al día y sigue normal.' },
  { key: 'extra', label: 'Abona de más', hint: 'En la cuota 4 paga $1.000.000 extra: va a capital y acorta el plazo.' },
  { key: 'stops', label: 'Deja de pagar', hint: 'Paga 3 cuotas y no vuelve. A los 180 días es «castigada» y responde el fondo de garantías.' },
  { key: 'death', label: 'Fallece', hint: 'Paga 4 cuotas y fallece: el crédito se suspende y la aseguradora paga el saldo.' },
]

/** Los estados de `creditop_x_request_statuses` que usa la pista. */
export const STATES = {
  1: { name: 'Al día', group: 'vivo' },
  2: { name: 'En mora', group: 'vivo' },
  3: { name: 'Paz y salvo', group: 'cierre' },
  7: { name: 'Recuperado por fondo de garantías', group: 'cierre' },
  9: { name: 'Fallecido', group: 'suspendido' },
  14: { name: 'Recuperado por reclamación', group: 'cierre' },
}

/** Las franjas del reporte de riesgo del admin, con lo que ofrecería cobranza (rama `cobranza`, sin mergear). */
export const MORA_BANDS = [
  { key: 'ok', label: 'Al día', from: 0, to: 0, offer: null },
  { key: 'b1', label: '1-30', from: 1, to: 30, offer: 'M1 pago inmediato · M2 compromiso de pago · M3 mínimo a cuotas' },
  { key: 'b2', label: '31-60', from: 31, to: 60, offer: 'M4 normalización · M5 extensión de plazo' },
  { key: 'b3', label: '61-90', from: 61, to: 90, offer: '— (la rama no define alternativa para este tramo)' },
  { key: 'b4', label: '91-180', from: 91, to: 180, offer: 'M6 reestructuración (90-120) · M7 pago de capital (120-180)' },
  { key: 'b5', label: 'castigada', from: 181, to: Infinity, offer: 'M8 pago total con descuento a capital' },
]
export const bandOf = (days) => MORA_BANDS.find((b) => days >= b.from && days <= b.to) || MORA_BANDS[0]

/** El orden en que un pago llena el mínimo. */
export const CASCADE = [
  { key: 'collection', label: 'Gasto de cobranza' },
  { key: 'late', label: 'Interés de mora' },
  { key: 'interest', label: 'Interés corriente' },
  { key: 'life', label: 'Seguro de vida' },
  { key: 'guarantee', label: 'Seguro de garantía' },
  { key: 'principal', label: 'Capital (con su FGA)' },
]

/** A quién va cada componente. `read` = está en el código o el conocimiento; si no, es inferido. */
export const DESTINATIONS = {
  principal: { to: 'Comercio', note: 'pone el capital y es dueño del crédito', read: true },
  interest: { to: 'Comercio', note: 'el subsidio de CreditOp se le paga a la entidad: el interés es suyo', read: true },
  late: { to: 'Comercio', note: 'nadie lo dice en el código', read: false },
  collection: { to: '¿?', note: 'el código no dice quién lo cobra', read: false },
  life: { to: 'Aseguradora', note: 'al fallecer, la reclamación aplica lo que pagó la aseguradora', read: false },
  guarantee: { to: 'Fondo de garantías', note: 'si el fondo paga, el crédito pasa a 7', read: false },
  fga: { to: 'Fondo de garantías', note: 'vive dentro del capital: cada peso de capital lleva su parte', read: false },
}

const round = (n) => Math.round(n)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

/**
 * Corre el crédito día por día y devuelve la historia: una foto por día y los eventos.
 * Día 0 = el desembolso (el 11). Corte mensual el mismo día de cada mes; vence 5 días después.
 */
export function simulate(a, scenario) {
  const start = new Date(2026, 0, 15)
  const i = a.monthlyRate / 100
  const financed = a.amount - a.downPayment
  const fga = round(financed * (a.fgaPct / 100) * (1 + a.vatPct / 100))
  const base = financed + fga
  const quota = round(i === 0 ? base / a.term : (base * i) / (1 - Math.pow(1 + i, -a.term)))

  // El estado del crédito: lo por facturar y el mínimo (lo facturado que no se ha pagado).
  const s = {
    unbilled: base, // capital por facturar (incluye el FGA)
    fgaBalance: fga, // parte del capital POR FACTURAR que es FGA
    dueFga: 0, // parte del capital VENCIDO que es FGA
    due: { collection: 0, late: 0, interest: 0, life: 0, guarantee: 0, principal: 0 },
    accrued: 0, // interés causado del ciclo, todavía sin facturar
    newlyBilledPrincipal: 0, // el capital del último corte, que no causa mora los primeros 7 días
    installment: 0,
    nextBilling: 30, // día del próximo corte
    nextPayment: null, // día del vencimiento del mínimo
    daysLate: 0,
    status: 1,
    favor: 0, // saldo a favor
    closedAt: null,
  }
  const paid = { collection: 0, late: 0, interest: 0, life: 0, guarantee: 0, principal: 0, fga: 0, insurer: 0, fund: 0 }
  const events = [{ day: 0, kind: 'disbursement', voucher: 'compra', text: `Desembolso: queda Autorizada (11). Voucher de compra para el comercio.`, amount: a.amount }]
  const days = []
  const commission = round(financed * (a.ctxCommissionPct / 100))

  const dueTotal = () => Object.values(s.due).reduce((x, y) => x + y, 0)
  const totalBalance = () => s.unbilled + s.accrued + dueTotal()

  function applyPayment(day, amount, label) {
    let left = amount
    const parts = {}
    for (const c of CASCADE) {
      const take = Math.min(left, s.due[c.key])
      if (take <= 0) continue
      s.due[c.key] -= take; left -= take; parts[c.key] = take; paid[c.key] += take
      if (c.key === 'principal') {
        // El FGA no tiene paso propio: cada peso de capital lleva su parte (`GuaranteeAttribution`).
        const fgaPart = round(take * (s.dueFga / Math.max(1, s.due.principal + take)))
        s.dueFga -= fgaPart; paid.fga += fgaPart; parts.fga = fgaPart
      }
    }
    // El sobrante: sin mora, abono a capital que reduce el plazo (tipo 1). Con mora, no se imputa: queda a favor.
    let extra = 0
    if (left > 0 && s.status === 1 && dueTotal() === 0) {
      extra = Math.min(left, s.unbilled)
      const fgaPart = round(extra * (s.fgaBalance / Math.max(1, s.unbilled)))
      s.fgaBalance -= fgaPart; s.unbilled -= extra; left -= extra
      paid.principal += extra; paid.fga += fgaPart; parts.extra = extra
    }
    if (left > 0) { s.favor += left; parts.favor = left }
    events.push({ day, kind: 'payment', voucher: 'pago', text: label, amount, parts })
    if (dueTotal() === 0) {
      s.daysLate = 0; s.nextPayment = null
      if (s.status === 2) { s.status = 1; events.push({ day, kind: 'state', text: 'Vuelve a Al día (1): pagó todo lo vencido, con la mora y el gasto de cobranza.' }) }
    }
    if (totalBalance() <= 0) { s.status = 3; s.closedAt = day; events.push({ day, kind: 'state', text: 'Paz y salvo (3): el crédito se cerró.' }) }
  }

  // Cuándo paga Juan, según la historia: devuelve el monto a pagar hoy (0 = no paga).
  function decides(day) {
    const inst = s.installment
    const dueToday = s.nextPayment !== null && day === s.nextPayment
    switch (scenario) {
      case 'ontime': return dueToday ? dueTotal() : 0
      case 'extra': return dueToday ? dueTotal() + (inst === 4 ? 1000000 : 0) : 0
      case 'late':
        if (inst === 2 && dueToday) return 0
        if (s.daysLate === 45) return dueTotal()
        return dueToday && s.daysLate === 0 ? dueTotal() : 0
      case 'stops': return dueToday && inst <= 3 ? dueTotal() : 0
      case 'death': return dueToday && inst <= 4 ? dueTotal() : 0
      default: return 0
    }
  }

  const horizon = a.term * 30 + 260
  let deathDay = null
  for (let day = 0; day <= horizon; day++) {
    if (day > 0 && s.closedAt === null && (s.status === 1 || s.status === 2)) {
      // LA NOCHE (00:30): corte → interés del día → mora → gasto de cobranza.
      if (day === s.nextBilling && s.unbilled > 0) {
        s.installment += 1
        const last = s.installment >= a.term
        const principal = last ? s.unbilled : Math.min(s.unbilled, Math.max(0, quota - s.accrued))
        const life = round((s.unbilled / 1e6) * a.lifePerMillion)
        s.due.interest += s.accrued; s.accrued = 0
        s.due.principal += principal; s.due.life += life; s.due.guarantee += a.guaranteeFee
        const fgaPart = last ? s.fgaBalance : round(principal * (s.fgaBalance / Math.max(1, s.unbilled)))
        s.fgaBalance -= fgaPart; s.dueFga += fgaPart
        s.unbilled -= principal
        s.newlyBilledPrincipal = principal
        s.nextPayment = day + 5
        s.nextBilling = s.unbilled > 0 ? day + 30 : null
        events.push({ day, kind: 'billing', text: `Corte de la cuota ${s.installment}: el mínimo pasa a ${fmt(dueTotal())}.`, amount: dueTotal() })
      }
      s.accrued += round(s.unbilled * (i / 30))
      const overdue = s.nextPayment !== null && day > s.nextPayment && dueTotal() > 0
      if (overdue || s.daysLate > 0) {
        if (dueTotal() > 0) {
          s.daysLate += 1
          if (s.status === 1) { s.status = 2; events.push({ day, kind: 'state', text: 'Pasa a En mora (2): venció el mínimo sin pagarse.' }) }
          const lateBase = Math.max(0, s.due.principal - (day - (s.nextPayment - 5) <= 7 ? s.newlyBilledPrincipal : 0))
          s.due.late += round(lateBase * (a.lateRate / 100 / 30))
          const tier = COLLECTION_TIERS.find((t) => t.from === s.daysLate)
          if (tier) { s.due.collection += tier.amount; events.push({ day, kind: 'collection', text: `Gasto de cobranza: a los ${tier.from} días de mora se suman ${fmt(tier.amount)}.`, amount: tier.amount }) }
        }
      }
      // Lo que no se paga en el corte siguiente se acumula en el mínimo, que ya lo tiene.
    }

    // LO QUE HACE JUAN (de día).
    if (s.closedAt === null && (s.status === 1 || s.status === 2)) {
      if (scenario === 'death' && s.installment === 5 && deathDay === null && s.nextPayment !== null && day === s.nextPayment - 2) {
        deathDay = day
        s.status = 9
        events.push({ day, kind: 'state', text: 'Fallecido (9): el crédito se suspende, sin fila vigente y con el saldo congelado.' })
      } else {
        const pay = decides(day)
        if (pay > 0) applyPayment(day, pay, s.daysLate > 0 ? `Pago para ponerse al día (${s.daysLate} días de mora).` : `Pago de la cuota ${s.installment}.`)
      }
      if (scenario === 'stops' && s.daysLate === 181 && s.status === 2) {
        events.push({ day, kind: 'state', text: 'Más de 180 días: el reporte de riesgo la llama «castigada» (no es un estado del crédito).' })
      }
      if (scenario === 'stops' && s.daysLate === 200) {
        const owed = totalBalance()
        paid.fund += owed
        events.push({ day, kind: 'state', text: `Recuperado por fondo de garantías (7): el fondo paga ${fmt(owed)}; los saldos no se tocan.`, amount: owed })
        s.status = 7; s.closedAt = day
      }
    }
    if (s.status === 9 && deathDay !== null && day === deathDay + 60) {
      const owed = totalBalance()
      paid.insurer += owed
      events.push({ day, kind: 'state', text: `Reclamación: la aseguradora paga ${fmt(owed)} y el crédito queda Recuperado por reclamación (14).`, amount: owed })
      s.status = 14; s.closedAt = day
    }

    days.push({
      day, date: addDays(start, day), status: s.status, daysLate: s.daysLate, installment: s.installment,
      unbilled: s.unbilled, accrued: s.accrued, due: { ...s.due }, favor: s.favor,
      total: s.status === 1 || s.status === 2 || s.status === 9 ? totalBalance() : 0,
      paid: { ...paid }, nextPayment: s.nextPayment,
    })
    if (s.closedAt !== null && day >= s.closedAt + 20) break
  }
  return { days, events, quota, fga, base, financed, commission, start }
}

export const fmt = (n) => '$ ' + Math.round(n || 0).toLocaleString('es-CO')
export const dateOf = (d) => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' })

/** Lo que se elige en la vista, guardado en esta máquina. */
function load() { try { return JSON.parse(localStorage.getItem('flow.portfolio')) || {} } catch { return {} } }
const saved = load()
export const portfolio = reactive({
  scenario: SCENARIOS.some((x) => x.key === saved.scenario) ? saved.scenario : 'ontime',
  assumptions: { ...DEFAULT_ASSUMPTIONS, ...(saved.assumptions || {}) },
})
watch(portfolio, () => {
  try { localStorage.setItem('flow.portfolio', JSON.stringify(portfolio)) } catch { /* sin almacenamiento */ }
}, { deep: true })
