<script setup>
// La pista «Cartera», el EDITOR: lo que pasa con un crédito CreditopX después del 11, para entenderlo (no para operar).
// La lógica es `portfolio.js`; las otras regiones son de la pista también: el sidebar (`PortfolioSidebar`: la historia y
// los supuestos), el detalle (`PortfolioDetail`: la noche elegida) y la consola (`PortfolioConsole`: la bitácora).
import { computed } from 'vue'
import './portfolio.css'
import { Play, Pause, RotateCcw as Restart } from 'lucide-vue-next'
import {
  portfolio, SCENARIOS, STATES, ARREARS_BANDS, bandOf, CASCADE, DESTINATIONS, fmt, dateOf,
  portfolioSim as sim, portfolioUi as clock, portfolioLastDay as lastDay, portfolioToday as today,
  playPortfolio, stopPortfolio, jumpPortfolio,
} from './portfolio.js'

const day = computed({ get: () => clock.day, set: (v) => { stopPortfolio(); clock.day = v } })

// La línea de tiempo: el saldo total como área y los eventos como marcas.
const W = 1000, H = 120, TOP = 8, AREA_H = 74
const xOf = (d) => (d / Math.max(1, lastDay.value)) * W
const maxTotal = computed(() => Math.max(...sim.value.days.map((x) => x.total), 1))
const yOf = (v) => TOP + AREA_H - (v / maxTotal.value) * AREA_H
const areaPath = computed(() => {
  const pts = sim.value.days.map((x) => `${xOf(x.day).toFixed(1)},${yOf(x.total).toFixed(1)}`)
  return `M0,${TOP + AREA_H} L${pts.join(' L')} L${W},${TOP + AREA_H} Z`
})
const lateSpans = computed(() => {
  const out = []; let from = null
  for (const x of sim.value.days) {
    if (x.status === 2 && from === null) from = x.day
    if (x.status !== 2 && from !== null) { out.push([from, x.day]); from = null }
  }
  if (from !== null) out.push([from, lastDay.value])
  return out
})
const MARK = { disbursement: 'pf-mk-disbursement', billing: 'pf-mk-billing', payment: 'pf-mk-payment', state: 'pf-mk-state', collection: 'pf-mk-collection' }

// Lo que debe hoy, por componente.
const debtParts = computed(() => {
  const t = today.value
  return [
    { key: 'unbilled', label: 'Capital por facturar', value: t.unbilled, cls: 'pf-c-principal-soft' },
    { key: 'accrued', label: 'Interés causado del ciclo', value: t.accrued, cls: 'pf-c-interest-soft' },
    ...CASCADE.slice().reverse().map((c) => ({ key: c.key, label: `${c.label} · vencido`, value: t.due[c.key], cls: 'pf-c-' + c.key })),
  ].filter((p) => p.value > 0)
})
const debtTotal = computed(() => debtParts.value.reduce((a, p) => a + p.value, 0))
const dueToday = computed(() => Object.values(today.value.due).reduce((a, b) => a + b, 0))

// El último pago hasta hoy: cómo se repartió y su voucher.
const lastPayment = computed(() => [...sim.value.events].reverse().find((e) => e.kind === 'payment' && e.day <= clock.day) || null)
const paymentParts = computed(() => {
  const p = lastPayment.value?.parts || {}
  const rows = CASCADE.map((c) => ({ key: c.key, label: c.label, value: p[c.key] || 0, cls: 'pf-c-' + c.key }))
  if (p.extra) rows.push({ key: 'extra', label: 'Sobrante → abono a capital (acorta el plazo)', value: p.extra, cls: 'pf-c-principal-soft' })
  if (p.favor) rows.push({ key: 'favor', label: 'Sobrante → saldo a favor', value: p.favor, cls: 'pf-c-favor' })
  return rows
})

// A quién va cada peso, acumulado hasta hoy.
const flows = computed(() => {
  const p = today.value.paid
  const rows = [
    { key: 'principal', label: 'Capital (sin el FGA)', value: p.principal - p.guaranteeFund },
    { key: 'guaranteeFund', label: 'FGA (dentro del capital)', value: p.guaranteeFund },
    { key: 'interest', label: 'Interés corriente', value: p.interest },
    { key: 'late', label: 'Interés de mora', value: p.late },
    { key: 'collection', label: 'Gasto de cobranza', value: p.collection },
    { key: 'life', label: 'Seguro de vida', value: p.life },
    { key: 'guarantee', label: 'Seguro de garantía', value: p.guarantee },
  ].map((r) => ({ ...r, ...DESTINATIONS[r.key] }))
  if (p.insurer) rows.push({ key: 'insurer', label: 'Reclamación del seguro de vida', value: p.insurer, to: 'Comercio', note: 'la aseguradora paga el saldo', read: false })
  if (p.fund) rows.push({ key: 'fund', label: 'Pago del fondo de garantías', value: p.fund, to: 'Comercio', note: 'el fondo responde por el crédito', read: false })
  return rows
})
const paidByCustomer = computed(() => {
  const p = today.value.paid
  return p.principal + p.interest + p.late + p.collection + p.life + p.guarantee
})

const state = computed(() => STATES[today.value.status] || { name: String(today.value.status), group: '' })
const band = computed(() => (today.value.status === 2 ? bandOf(today.value.daysLate) : ARREARS_BANDS[0]))
const scenarioLabel = computed(() => SCENARIOS.find((s) => s.key === portfolio.scenario)?.label)
const pct = (v, t) => (t > 0 ? (v / t) * 100 : 0) + '%'

const RAILS = [
  { key: 'ctx', name: 'CreditopX', rt: 'rt 2 · 3', lends: 'El comercio pone el capital', collects: 'CreditOp, a nombre del comercio', voucher: 'Sí: uno por cada cuota', earns: 'SaaS + comisión CTX sobre lo desembolsado', here: true },
  { key: 'agg', name: 'Agregador', rt: 'rt 0 · 1', lends: 'La entidad (Addi, Welli, Sistecrédito…)', collects: 'La entidad', voucher: 'No: lo da la entidad', earns: 'SaaS + comisión que paga la entidad' },
  { key: 'del', name: 'Delegada (Finandina)', rt: 'rt 4', lends: 'La entidad, con su plata', collects: 'La entidad', voucher: 'No: lo da la entidad', earns: 'SaaS (la comisión del riel 4 no está en forecast)' },
]
</script>

<template>
  <div class="pf">
    <section class="pf-sec" aria-label="Quién presta y quién cobra en cada riel">
      <div class="region-head group"><span>Los tres rieles</span><span class="count">quién presta, quién cobra, qué gana CreditOp</span></div>
      <div class="pf-rails">
        <article v-for="r in RAILS" :key="r.key" class="pf-rail" :class="{ here: r.here }">
          <header><strong>{{ r.name }}</strong><span class="count">{{ r.rt }}</span><span v-if="r.here" class="pf-pill pf-pill-outline">esta pista</span></header>
          <dl class="pf-kv">
            <dt>Presta</dt><dd>{{ r.lends }}</dd>
            <dt>Cobra</dt><dd>{{ r.collects }}</dd>
            <dt>Voucher de pago</dt><dd>{{ r.voucher }}</dd>
            <dt>Gana CreditOp</dt><dd>{{ r.earns }}</dd>
          </dl>
        </article>
      </div>
    </section>

    <section class="pf-sec" aria-label="El reloj">
      <div class="region-head group"><span>El reloj</span><span class="count">{{ scenarioLabel }} · la historia y los supuestos se eligen en el sidebar</span></div>
      <div class="pf-pad">
        <div class="pf-clock-head">
          <button type="button" class="region-action" :title="clock.playing ? 'Pausar' : 'Correr las noches'" :aria-label="clock.playing ? 'Pausar' : 'Correr las noches'" @click="playPortfolio">
            <Pause v-if="clock.playing" :size="15" /><Play v-else :size="15" /></button>
          <button type="button" class="region-action" title="Volver al desembolso" aria-label="Volver al desembolso" @click="jumpPortfolio(0)"><Restart :size="14" /></button>
          <strong>Día {{ today.day }}</strong><span class="count">{{ dateOf(today.date) }} · noche de las 00:30</span>
          <span class="pf-grow"></span>
          <span class="pf-pill" :class="today.status === 2 ? 'pf-pill-bad' : today.status === 1 ? 'pf-pill-ok' : 'pf-pill-muted'">
            {{ state.name }}<template v-if="today.daysLate"> · {{ today.daysLate }} días</template></span>
        </div>
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="pf-line" role="img" aria-label="El saldo total y los eventos del crédito">
          <rect v-for="(s, k) in lateSpans" :key="k" :x="xOf(s[0])" :y="TOP" :width="Math.max(2, xOf(s[1]) - xOf(s[0]))" :height="AREA_H" class="pf-late-span" />
          <path :d="areaPath" class="pf-area" />
          <line :x1="xOf(today.day)" :x2="xOf(today.day)" :y1="0" :y2="H" class="pf-now" />
          <g v-for="(e, k) in sim.events" :key="k" class="pf-mark" :class="[MARK[e.kind], { on: clock.selected === k }]" @click="jumpPortfolio(e.day, k)">
            <title>Día {{ e.day }} · {{ e.text }}</title>
            <rect v-if="e.kind === 'billing'" :x="xOf(e.day) - 1" :y="TOP + AREA_H + 6" width="2" height="9" />
            <circle v-else :cx="xOf(e.day)" :cy="TOP + AREA_H + (e.kind === 'payment' || e.kind === 'disbursement' ? 24 : 34)" :r="clock.selected === k ? 7 : 5" />
          </g>
        </svg>
        <input v-model.number="day" type="range" min="0" :max="lastDay" step="1" class="pf-range" aria-label="El día">
        <div class="pf-legend">
          <span><i class="pf-mk-disbursement"></i>desembolso · voucher de compra</span><span><i class="pf-mk-billing"></i>corte</span>
          <span><i class="pf-mk-payment"></i>pago · voucher de pago</span><span><i class="pf-mk-collection"></i>gasto de cobranza</span>
          <span><i class="pf-mk-state"></i>cambio de estado</span><span><i class="pf-late-sw"></i>en mora</span>
          <span class="pf-grow"></span><span>una marca abre su noche en el detalle</span>
        </div>
      </div>
    </section>

    <div class="pf-cols">
      <section class="pf-sec" aria-label="Lo que debe hoy">
        <div class="region-head group"><span>Lo que debe hoy</span><span class="count">{{ fmt(debtTotal) }}</span></div>
        <div class="pf-pad">
          <div class="pf-bar"><span v-for="p in debtParts" :key="p.key" :class="p.cls" :style="{ width: pct(p.value, debtTotal) }" :title="`${p.label}: ${fmt(p.value)}`"></span></div>
          <ul class="pf-rows">
            <li v-for="p in debtParts" :key="p.key"><i :class="p.cls"></i>{{ p.label }}<b>{{ fmt(p.value) }}</b></li>
            <li v-if="!debtParts.length" class="zero">Nada: el crédito está cerrado.</li>
          </ul>
          <p class="pf-note">El mínimo exigible es lo vencido: <b>{{ fmt(dueToday) }}</b><template v-if="today.nextPayment !== null">, {{ today.nextPayment < today.day ? 'venció' : 'vence' }} el día {{ today.nextPayment }}</template>.
            Cada noche el interés se causa sobre el capital por facturar; en el corte, lo causado y la cuota pasan al mínimo, que acumula lo que no se pagó.</p>
        </div>
      </section>

      <section class="pf-sec" aria-label="El último pago">
        <div class="region-head group"><span>El último pago</span><span class="count">en cascada</span></div>
        <div class="pf-pad">
          <template v-if="lastPayment">
            <div class="pf-pay">
              <div>
                <div class="pf-bar"><span v-for="p in paymentParts.filter((x) => x.value)" :key="p.key" :class="p.cls" :style="{ width: pct(p.value, lastPayment.amount) }" :title="`${p.label}: ${fmt(p.value)}`"></span></div>
                <ol class="pf-rows pf-cascade">
                  <li v-for="p in paymentParts" :key="p.key" :class="{ zero: !p.value }"><i :class="p.cls"></i>{{ p.label }}<b>{{ p.value ? fmt(p.value) : '—' }}</b></li>
                </ol>
              </div>
              <figure class="pf-voucher" aria-label="El voucher de pago">
                <div class="pf-voucher-head">Comprobante de pago</div>
                <div class="pf-voucher-ok">¡Transacción exitosa!</div>
                <div class="pf-voucher-date">{{ dateOf(sim.days[lastPayment.day].date) }}</div>
                <dl><dt>Entidad</dt><dd>CrediComercio</dd><dt>Pagado</dt><dd>{{ fmt(lastPayment.amount) }}</dd><dt>Método</dt><dd>En línea</dd></dl>
                <div class="pf-voucher-ref">REF 00{{ 505000 + lastPayment.day }}</div>
                <div class="pf-voucher-foot">** CLIENTE **</div>
              </figure>
            </div>
            <p class="pf-note">{{ lastPayment.text }} El voucher sale después del cobro, en una cola aparte: si el PDF falla, el pago no se deshace.</p>
          </template>
          <p v-else class="pf-note">Todavía no hay pagos. Corré el reloj hasta el primer vencimiento (día 35).</p>
        </div>
      </section>

      <section class="pf-sec" aria-label="A quién va cada peso">
        <div class="region-head group"><span>A quién va cada peso</span><span class="count">acumulado · Juan pagó {{ fmt(paidByCustomer) }}</span></div>
        <div class="pf-pad">
          <table class="table pf-flows">
            <tbody>
              <tr v-for="f in flows" :key="f.key" :class="{ zero: !f.value }">
                <td>{{ f.label }}</td><td class="num">{{ fmt(f.value) }}</td>
                <td><span class="pf-pill" :class="f.read ? 'pf-pill-outline' : 'pf-pill-inferred'" :title="f.note">{{ f.to }}</span></td>
              </tr>
            </tbody>
          </table>
          <p class="pf-callout"><strong>CreditOp</strong> no cobra intereses: gana el SaaS mensual del comercio y la comisión CTX, {{ fmt(sim.commission) }} por este crédito
            ({{ portfolio.assumptions.ctxCommissionPct }} % de lo desembolsado). Y si hay subsidio de intereses, lo pone de su bolsillo.</p>
          <p class="pf-note"><span class="pf-pill pf-pill-inferred">punteado</span> inferido: el código no dice a quién llega.</p>
        </div>
      </section>

      <section class="pf-sec" aria-label="El estado y la cobranza">
        <div class="region-head group"><span>Estado y cobranza</span></div>
        <div class="pf-pad">
          <div class="pf-bands">
            <span v-for="b in ARREARS_BANDS" :key="b.key" class="pf-pill" :class="(today.status === 2 ? band.key === b.key : (b.key === 'ok' && today.status === 1)) ? (b.key === 'ok' ? 'pf-pill-ok' : 'pf-pill-bad') : 'pf-pill-outline'">{{ b.label }}</span>
            <span v-for="(s, id) in STATES" v-show="+id > 2" :key="id" class="pf-pill" :class="today.status === +id ? 'pf-pill-muted' : 'pf-pill-inferred'">{{ s.name }}</span>
          </div>
          <p v-if="today.status === 2" class="pf-note">Franja <b>{{ band.label }}</b> del reporte de riesgo. Cobranza ofrecería: {{ band.offer }}.
            <span class="count">Las alternativas M1-M8 son de la rama «cobranza», sin mergear.</span></p>
          <p v-else-if="today.status === 1" class="pf-note">Al día: recibe recordatorios antes del vencimiento. Sólo los estados 1 y 2 se cobran.</p>
          <p v-else-if="today.status === 9" class="pf-note">Suspendido: no hay fila vigente, el saldo queda congelado y no se causa nada mientras se reclama al seguro.</p>
          <p v-else class="pf-note">Cerrado: {{ state.name }}.</p>
        </div>
      </section>
    </div>
  </div>
</template>
