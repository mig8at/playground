<script setup>
// La pista «Cartera»: lo que pasa con un crédito CreditopX después del 11, para entenderlo (no para operar). La lógica
// es `portfolio.js`; acá sólo se dibuja: la comparación de los rieles, el reloj de noches, el saldo, la cascada del
// último pago con su voucher, a quién va cada peso, el estado con su franja de mora y la bitácora.
import { computed, ref, watch, onUnmounted } from 'vue'
import { Play, Pause, RotateCcw as Restart } from 'lucide-vue-next'
import {
  portfolio, simulate, SCENARIOS, STATES, ARREARS_BANDS, bandOf, CASCADE, DESTINATIONS, COLLECTION_TIERS,
  DEFAULT_ASSUMPTIONS, fmt, dateOf,
} from './portfolio.js'

const sim = computed(() => simulate(portfolio.assumptions, portfolio.scenario))
const lastDay = computed(() => sim.value.days.length - 1)
const day = ref(0)
watch(() => [portfolio.scenario, JSON.stringify(portfolio.assumptions)], () => { day.value = Math.min(day.value, lastDay.value) })
const today = computed(() => sim.value.days[Math.min(day.value, lastDay.value)])

// El reloj: corre una noche cada 60 ms.
const playing = ref(false)
let timer = null
function play() {
  if (playing.value) { stop(); return }
  if (day.value >= lastDay.value) day.value = 0
  playing.value = true
  timer = setInterval(() => { if (day.value >= lastDay.value) stop(); else day.value += 1 }, 60)
}
function stop() { playing.value = false; clearInterval(timer); timer = null }
onUnmounted(stop)
function jump(d) { stop(); day.value = d }

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
const MARK = { disbursement: 'mk-disbursement', billing: 'mk-billing', payment: 'mk-payment', state: 'mk-state', collection: 'mk-collection' }

// Lo que debe hoy, por componente.
const debtParts = computed(() => {
  const t = today.value
  return [
    { key: 'unbilled', label: 'Capital por facturar', value: t.unbilled, cls: 'c-principal-soft' },
    { key: 'accrued', label: 'Interés causado del ciclo', value: t.accrued, cls: 'c-interest-soft' },
    ...CASCADE.slice().reverse().map((c) => ({ key: c.key, label: `${c.label} · vencido`, value: t.due[c.key], cls: 'c-' + c.key })),
  ].filter((p) => p.value > 0)
})
const debtTotal = computed(() => debtParts.value.reduce((a, p) => a + p.value, 0))
const dueToday = computed(() => Object.values(today.value.due).reduce((a, b) => a + b, 0))

// El último pago hasta hoy: cómo se repartió y su voucher.
const lastPayment = computed(() => [...sim.value.events].reverse().find((e) => e.kind === 'payment' && e.day <= day.value) || null)
const paymentParts = computed(() => {
  const p = lastPayment.value?.parts || {}
  const rows = CASCADE.map((c) => ({ key: c.key, label: c.label, value: p[c.key] || 0, cls: 'c-' + c.key }))
  if (p.extra) rows.push({ key: 'extra', label: 'Sobrante → abono a capital (acorta el plazo)', value: p.extra, cls: 'c-principal-soft' })
  if (p.favor) rows.push({ key: 'favor', label: 'Sobrante → saldo a favor', value: p.favor, cls: 'c-favor' })
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
const log = computed(() => sim.value.events.filter((e) => e.day <= day.value).slice(-9).reverse())
const scenarioHint = computed(() => SCENARIOS.find((s) => s.key === portfolio.scenario)?.hint)
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

    <section class="pf-sec" aria-label="La historia y el reloj">
      <div class="region-head group">
        <div class="toggle-group" role="radiogroup" aria-label="La historia">
          <button v-for="s in SCENARIOS" :key="s.key" type="button" class="toggle" role="radio" :aria-checked="portfolio.scenario === s.key"
            :aria-pressed="portfolio.scenario === s.key" @click="portfolio.scenario = s.key; jump(0)">{{ s.label }}</button>
        </div>
      </div>
      <div class="pf-pad">
        <p class="pf-hint">{{ scenarioHint }}</p>
        <div class="pf-clock-head">
          <button type="button" class="region-action" :title="playing ? 'Pausar' : 'Correr las noches'" :aria-label="playing ? 'Pausar' : 'Correr las noches'" @click="play">
            <Pause v-if="playing" :size="15" /><Play v-else :size="15" /></button>
          <button type="button" class="region-action" title="Volver al desembolso" aria-label="Volver al desembolso" @click="jump(0)"><Restart :size="14" /></button>
          <strong>Día {{ today.day }}</strong><span class="count">{{ dateOf(today.date) }} · noche de las 00:30</span>
          <span class="pf-grow"></span>
          <span class="pf-pill" :class="today.status === 2 ? 'pf-pill-bad' : today.status === 1 ? 'pf-pill-ok' : 'pf-pill-muted'">
            {{ state.name }}<template v-if="today.daysLate"> · {{ today.daysLate }} días</template></span>
        </div>
        <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="pf-line" role="img" aria-label="El saldo total y los eventos del crédito">
          <rect v-for="(s, k) in lateSpans" :key="k" :x="xOf(s[0])" :y="TOP" :width="Math.max(2, xOf(s[1]) - xOf(s[0]))" :height="AREA_H" class="pf-late-span" />
          <path :d="areaPath" class="pf-area" />
          <line :x1="xOf(today.day)" :x2="xOf(today.day)" :y1="0" :y2="H" class="pf-now" />
          <g v-for="(e, k) in sim.events" :key="k" class="pf-mark" :class="MARK[e.kind]" @click="jump(e.day)">
            <title>Día {{ e.day }} · {{ e.text }}</title>
            <rect v-if="e.kind === 'billing'" :x="xOf(e.day) - 1" :y="TOP + AREA_H + 6" width="2" height="9" />
            <circle v-else :cx="xOf(e.day)" :cy="TOP + AREA_H + (e.kind === 'payment' || e.kind === 'disbursement' ? 24 : 34)" r="5" />
          </g>
        </svg>
        <input v-model.number="day" type="range" min="0" :max="lastDay" step="1" class="pf-range" aria-label="El día" @input="stop">
        <div class="pf-legend">
          <span><i class="mk-disbursement"></i>desembolso · voucher de compra</span><span><i class="mk-billing"></i>corte</span>
          <span><i class="mk-payment"></i>pago · voucher de pago</span><span><i class="mk-collection"></i>gasto de cobranza</span>
          <span><i class="mk-state"></i>cambio de estado</span><span><i class="pf-late-sw"></i>en mora</span>
        </div>
        <details class="pf-assume">
          <summary>Supuestos del ejemplo · {{ fmt(portfolio.assumptions.amount) }} a {{ portfolio.assumptions.term }} cuotas · cuota {{ fmt(sim.quota) }}</summary>
          <div class="pf-assume-grid">
            <label>Monto<input v-model.number="portfolio.assumptions.amount" class="input" type="number" min="100000" step="100000"></label>
            <label>Cuotas<input v-model.number="portfolio.assumptions.term" class="input" type="number" min="1" max="48"></label>
            <label>Interés mensual %<input v-model.number="portfolio.assumptions.monthlyRate" class="input" type="number" min="0" step="0.1"></label>
            <label>Mora mensual %<input v-model.number="portfolio.assumptions.lateRate" class="input" type="number" min="0" step="0.1"></label>
            <label>FGA %<input v-model.number="portfolio.assumptions.guaranteeFundPct" class="input" type="number" min="0" step="1"></label>
            <label>Seguro de vida por millón<input v-model.number="portfolio.assumptions.lifePerMillion" class="input" type="number" min="0" step="100"></label>
            <label>Seguro de garantía por corte<input v-model.number="portfolio.assumptions.guaranteeFee" class="input" type="number" min="0" step="500"></label>
            <label>Comisión CTX %<input v-model.number="portfolio.assumptions.ctxCommissionPct" class="input" type="number" min="0" step="0.5"></label>
          </div>
          <p class="pf-note">FGA {{ fmt(sim.guaranteeFund) }} (con IVA) sobre {{ fmt(sim.financed) }}: Juan debe {{ fmt(sim.base) }}. Gasto de cobranza:
            {{ COLLECTION_TIERS.map((t) => `${fmt(t.amount)} el día ${t.from}`).join(' · ') }}. Números de juguete, ninguno es de una entidad real.
            <button type="button" class="btn btn-link" @click="portfolio.assumptions = { ...DEFAULT_ASSUMPTIONS }">volver a los de ejemplo</button></p>
        </details>
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
        <div class="region-head group"><span>Bitácora</span><span class="count">{{ log.length }}</span></div>
        <div class="pf-log">
          <div v-for="(e, k) in log" :key="k" class="log-line" :class="MARK[e.kind]" @click="jump(e.day)"><span class="log-time">día {{ e.day }}</span><span>{{ e.text }}</span></div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Los colores de la pista salen del tema: el capital es la tinta de la marca, los intereses y seguros las series del
   tema y la mora y la cobranza los estados. Nada de colores fijos: cambia con la paleta de Cockpit. */
.pf { display: flex; flex-direction: column; font-size: var(--text-base); color: var(--foreground);
  --c-principal: var(--primary-ink); --c-principal-soft: color-mix(in oklab, var(--primary-ink) 35%, var(--card));
  --c-interest: var(--chart-1); --c-interest-soft: color-mix(in oklab, var(--chart-1) 35%, var(--card));
  --c-late: var(--status-warn); --c-collection: var(--status-bad); --c-life: var(--chart-3); --c-guarantee: var(--chart-4);
  --c-favor: var(--fg-3) }
.pf-sec { border-bottom: 1px solid var(--border); min-width: 0 }
.pf-sec > .region-head.group { gap: var(--space-2) }
.pf-sec > .region-head.group .count { margin-left: auto }
.pf-pad { padding: var(--space-3) var(--space-4) var(--space-4) }
.pf-grow { flex: 1 }
.pf-note { margin: var(--space-2) 0 0; color: var(--fg-2); line-height: 1.55 }
.pf-hint { margin: 0 0 var(--space-2); color: var(--fg-2) }
.pf-pill { display: inline-flex; align-items: center; height: 20px; padding: 0 var(--space-2); border-radius: 999px; border: 1px solid transparent;
  font-size: var(--text-xs); font-weight: 500; white-space: nowrap; color: var(--fg-2) }
.pf-pill-outline { border-color: var(--border) }
.pf-pill-inferred { border-color: var(--border); border-style: dashed; color: var(--fg-3) }
.pf-pill-muted { background: var(--muted); color: var(--foreground) }
.pf-pill-ok { border-color: var(--status-ok); color: var(--status-ok) }
.pf-pill-bad { background: var(--status-bad); color: var(--on-status-bad) }
.pf-rails { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) }
.pf-rail { padding: var(--space-3) var(--space-4); min-width: 0 }
.pf-rail + .pf-rail { border-left: 1px solid var(--border) }
.pf-rail.here { box-shadow: inset 0 2px 0 var(--primary-ink) }
.pf-rail header { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2) }
.pf-rail header .pf-pill { margin-left: auto }
.pf-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--space-3); margin: 0 }
.pf-kv dt { color: var(--fg-3) } .pf-kv dd { margin: 0; color: var(--fg-2) }
.pf-clock-head { display: flex; gap: var(--space-2); align-items: center; margin-bottom: var(--space-2) }
.pf-line { width: 100%; height: 120px; display: block }
.pf-area { fill: color-mix(in oklab, var(--primary-ink) 18%, transparent); stroke: var(--primary-ink); stroke-width: 1.5; vector-effect: non-scaling-stroke }
.pf-late-span { fill: color-mix(in oklab, var(--status-bad) 14%, transparent) }
.pf-now { stroke: var(--foreground); stroke-width: 1; vector-effect: non-scaling-stroke }
.pf-mark { cursor: pointer }
.mk-disbursement circle, .pf-legend .mk-disbursement { fill: var(--primary-ink); background: var(--primary-ink) }
.mk-payment circle, .pf-legend .mk-payment { fill: var(--status-ok); background: var(--status-ok) }
.mk-collection circle, .pf-legend .mk-collection { fill: var(--status-bad); background: var(--status-bad) }
.mk-state circle, .pf-legend .mk-state { fill: var(--status-warn); background: var(--status-warn) }
.mk-billing rect, .pf-legend .mk-billing { fill: var(--fg-3); background: var(--fg-3) }
.pf-range { width: 100%; margin: var(--space-1) 0; accent-color: var(--primary-ink) }
.pf-legend { display: flex; gap: var(--space-4); flex-wrap: wrap; color: var(--fg-3); font-size: var(--text-sm) }
.pf-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px }
.pf-legend .mk-billing { width: 2px; height: 9px; border-radius: 0 }
.pf-legend .pf-late-sw { width: 12px; border-radius: 2px; background: color-mix(in oklab, var(--status-bad) 22%, transparent) }
.pf-assume { margin-top: var(--space-3) }
.pf-assume summary { cursor: pointer; color: var(--fg-3); font-size: var(--text-sm) }
.pf-assume-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-2); margin-top: var(--space-2) }
.pf-assume-grid label { display: flex; flex-direction: column; gap: var(--space-1); color: var(--fg-3); font-size: var(--text-sm) }
.pf-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) }
.pf-cols > .pf-sec:nth-child(odd) { border-right: 1px solid var(--border) }
.pf-bar { display: flex; height: 14px; border-radius: var(--radius-sm); overflow: hidden; background: var(--muted) }
.pf-bar span { display: block; min-width: 2px; transition: width var(--motion-fast) }
.pf-rows { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column }
.pf-rows li { display: flex; align-items: center; gap: var(--space-2); min-height: 24px }
.pf-rows li b { margin-left: auto; font-weight: 500; font-family: var(--font-mono); font-size: var(--text-sm); white-space: nowrap }
.pf-rows li.zero { color: var(--fg-3) }
.pf-rows i { width: 8px; height: 8px; border-radius: 2px; flex: none }
.pf-cascade { counter-reset: c } .pf-cascade li::before { counter-increment: c; content: counter(c); color: var(--fg-3); width: 12px; font-size: var(--text-xs) }
.c-principal { background: var(--c-principal) } .c-principal-soft { background: var(--c-principal-soft) }
.c-interest { background: var(--c-interest) } .c-interest-soft { background: var(--c-interest-soft) }
.c-late { background: var(--c-late) } .c-collection { background: var(--c-collection) }
.c-life { background: var(--c-life) } .c-guarantee { background: var(--c-guarantee) } .c-favor { background: var(--c-favor) }
.pf-pay { display: grid; grid-template-columns: minmax(0, 1fr) 176px; gap: var(--space-4); align-items: start }
/* El voucher: la tirilla, con la tinta del tema y el corte en zigzag del papel. */
.pf-voucher { margin: 0; padding: var(--space-3) var(--space-3) var(--space-4); background: var(--background); color: var(--foreground);
  border: 1px solid var(--border); border-bottom: 0; text-align: center; font-size: var(--text-sm);
  --zz: 6px; mask: conic-gradient(from -45deg at bottom, transparent 90deg, black 0) bottom / calc(var(--zz) * 2) var(--zz) repeat-x,
    linear-gradient(black 0 0) top / 100% calc(100% - var(--zz)) no-repeat }
.pf-voucher-head { color: var(--fg-3); font-size: var(--text-xs); letter-spacing: .04em; padding-bottom: var(--space-2); border-bottom: 1px dashed var(--border) }
.pf-voucher-ok { margin-top: var(--space-2); font-weight: 600; color: var(--status-ok) }
.pf-voucher-date { color: var(--fg-3); font-size: var(--text-xs) }
.pf-voucher dl { display: grid; grid-template-columns: auto auto; justify-content: space-between; gap: 2px var(--space-2); margin: var(--space-2) 0; text-align: left }
.pf-voucher dt { color: var(--fg-3) } .pf-voucher dd { margin: 0; text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.pf-voucher-ref { padding: var(--space-1) 0; border-top: 1px dashed var(--border); border-bottom: 1px dashed var(--border); font-family: var(--font-mono); color: var(--primary-ink) }
.pf-voucher-foot { margin-top: var(--space-2); color: var(--fg-3); font-family: var(--font-mono); font-size: var(--text-xs) }
.pf-flows tr.zero td { color: var(--fg-3) }
.pf-flows .num { font-family: var(--font-mono); font-size: var(--text-sm); white-space: nowrap }
.pf-callout { margin: var(--space-3) 0 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); background: var(--muted); color: var(--fg-2); line-height: 1.55 }
.pf-bands { display: flex; flex-wrap: wrap; gap: var(--space-1) }
.pf-log { padding: var(--space-2) 0 var(--space-3); max-height: 220px; overflow: auto }
.pf-log .log-line { cursor: pointer; border-left: 2px solid transparent }
.pf-log .log-line:hover { background: var(--hover) }
.pf-log .mk-payment { border-left-color: var(--status-ok) } .pf-log .mk-collection { border-left-color: var(--status-bad) }
.pf-log .mk-state { border-left-color: var(--status-warn) } .pf-log .mk-disbursement { border-left-color: var(--primary-ink) }
@media (max-width: 900px) { .pf-rails, .pf-cols { grid-template-columns: 1fr } .pf-pay { grid-template-columns: 1fr } .pf-rail + .pf-rail { border-left: 0 } }
</style>
