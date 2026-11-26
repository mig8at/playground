<script setup>
// La pista «Cartera»: lo que pasa con un crédito CreditopX después del 11, para entenderlo (no para operar). La lógica
// es `portfolio.js`; acá sólo se dibuja: la comparación de los rieles, el reloj de noches, el saldo, la cascada del
// último pago con su voucher, a quién va cada peso, el estado con su franja de mora y la bitácora.
import { computed, ref, watch, onUnmounted } from 'vue'
import { Play, Pause, RotateCcw, Receipt } from 'lucide-vue-next'
import {
  portfolio, simulate, SCENARIOS, STATES, MORA_BANDS, bandOf, CASCADE, DESTINATIONS, COLLECTION_TIERS,
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
const MARK = { disbursement: 'mk-blue', billing: 'mk-tick', payment: 'mk-green', state: 'mk-amber', collection: 'mk-red' }

// Lo que debe hoy, por componente.
const owedParts = computed(() => {
  const t = today.value
  return [
    { key: 'unbilled', label: 'Capital por facturar', value: t.unbilled, cls: 'c-principal-soft' },
    { key: 'accrued', label: 'Interés causado del ciclo', value: t.accrued, cls: 'c-interest-soft' },
    ...CASCADE.slice().reverse().map((c) => ({ key: c.key, label: `${c.label} · vencido`, value: t.due[c.key], cls: 'c-' + c.key })),
  ].filter((p) => p.value > 0)
})
const owedTotal = computed(() => owedParts.value.reduce((a, p) => a + p.value, 0))
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
    { key: 'principal', label: 'Capital (sin el FGA)', value: p.principal - p.fga },
    { key: 'fga', label: 'FGA (dentro del capital)', value: p.fga },
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
const paidByJuan = computed(() => {
  const p = today.value.paid
  return p.principal + p.interest + p.late + p.collection + p.life + p.guarantee
})

const state = computed(() => STATES[today.value.status] || { name: String(today.value.status), group: '' })
const band = computed(() => (today.value.status === 2 ? bandOf(today.value.daysLate) : MORA_BANDS[0]))
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
    <section class="pf-rails" aria-label="Quién presta y quién cobra en cada riel">
      <article v-for="r in RAILS" :key="r.key" class="pf-rail" :class="{ here: r.here }">
        <header><b>{{ r.name }}</b><small>{{ r.rt }}</small><span v-if="r.here" class="pf-here">esta pista</span></header>
        <dl>
          <dt>Presta</dt><dd>{{ r.lends }}</dd>
          <dt>Cobra las cuotas</dt><dd>{{ r.collects }}</dd>
          <dt>Voucher de pago</dt><dd>{{ r.voucher }}</dd>
          <dt>Gana CreditOp</dt><dd>{{ r.earns }}</dd>
        </dl>
      </article>
    </section>

    <section class="pf-controls">
      <div class="pf-scenarios" role="radiogroup" aria-label="La historia">
        <button v-for="s in SCENARIOS" :key="s.key" type="button" role="radio" :aria-checked="portfolio.scenario === s.key"
          :class="{ on: portfolio.scenario === s.key }" @click="portfolio.scenario = s.key; jump(0)">{{ s.label }}</button>
      </div>
      <p class="pf-hint">{{ scenarioHint }}</p>
      <details class="pf-assume">
        <summary>Supuestos del ejemplo · {{ fmt(portfolio.assumptions.amount) }} a {{ portfolio.assumptions.term }} cuotas · cuota {{ fmt(sim.quota) }}</summary>
        <div class="pf-assume-grid">
          <label>Monto<input v-model.number="portfolio.assumptions.amount" type="number" min="100000" step="100000"></label>
          <label>Cuotas<input v-model.number="portfolio.assumptions.term" type="number" min="1" max="48"></label>
          <label>Interés mensual %<input v-model.number="portfolio.assumptions.monthlyRate" type="number" min="0" step="0.1"></label>
          <label>Mora mensual %<input v-model.number="portfolio.assumptions.lateRate" type="number" min="0" step="0.1"></label>
          <label>FGA %<input v-model.number="portfolio.assumptions.fgaPct" type="number" min="0" step="1"></label>
          <label>Seguro de vida por millón<input v-model.number="portfolio.assumptions.lifePerMillion" type="number" min="0" step="100"></label>
          <label>Seguro de garantía por corte<input v-model.number="portfolio.assumptions.guaranteeFee" type="number" min="0" step="500"></label>
          <label>Comisión CTX %<input v-model.number="portfolio.assumptions.ctxCommissionPct" type="number" min="0" step="0.5"></label>
        </div>
        <p class="pf-note">FGA {{ fmt(sim.fga) }} (con IVA) sobre {{ fmt(sim.financed) }}: Juan debe {{ fmt(sim.base) }}. Gasto de cobranza:
          {{ COLLECTION_TIERS.map((t) => `${fmt(t.amount)} el día ${t.from}`).join(' · ') }}. Números de juguete, ninguno es de una entidad real.
          <button type="button" class="pf-link" @click="portfolio.assumptions = { ...DEFAULT_ASSUMPTIONS }">volver a los de ejemplo</button></p>
      </details>
    </section>

    <section class="pf-card pf-clock" aria-label="El reloj de la cartera">
      <div class="pf-clock-head">
        <button type="button" class="pf-icon" :aria-label="playing ? 'Pausar' : 'Correr las noches'" @click="play">
          <Pause v-if="playing" :size="15" /><Play v-else :size="15" /></button>
        <button type="button" class="pf-icon" aria-label="Volver al desembolso" @click="jump(0)"><RotateCcw :size="14" /></button>
        <b>Día {{ today.day }}</b><span class="pf-mut">{{ dateOf(today.date) }} · noche de las 00:30</span>
        <span class="pf-state" :class="['st-' + state.group, { 'st-late': today.status === 2 }]">{{ state.name }}<template v-if="today.daysLate"> · {{ today.daysLate }} días de mora</template></span>
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
        <span><i class="mk-blue"></i>desembolso · voucher de compra</span><span><i class="mk-tick"></i>corte</span>
        <span><i class="mk-green"></i>pago · voucher de pago</span><span><i class="mk-red"></i>gasto de cobranza</span>
        <span><i class="mk-amber"></i>cambio de estado</span><span><i class="pf-late-sw"></i>en mora</span>
      </div>
    </section>

    <div class="pf-grid">
      <section class="pf-card" aria-label="Lo que debe hoy">
        <h3>Lo que debe hoy <span class="pf-mut">{{ fmt(owedTotal) }}</span></h3>
        <div class="pf-bar"><span v-for="p in owedParts" :key="p.key" :class="p.cls" :style="{ width: pct(p.value, owedTotal) }" :title="`${p.label}: ${fmt(p.value)}`"></span></div>
        <ul class="pf-rows">
          <li v-for="p in owedParts" :key="p.key"><i :class="p.cls"></i>{{ p.label }}<b>{{ fmt(p.value) }}</b></li>
          <li v-if="!owedParts.length" class="pf-mut">Nada: el crédito está cerrado.</li>
        </ul>
        <p class="pf-note">El mínimo exigible es lo vencido: <b>{{ fmt(dueToday) }}</b><template v-if="today.nextPayment !== null">, {{ today.nextPayment < today.day ? 'venció' : 'vence' }} el día {{ today.nextPayment }}</template>.
          Cada noche el interés se causa sobre el capital por facturar; en el corte, lo causado y la cuota pasan al mínimo, que acumula lo que no se pagó.</p>
      </section>

      <section class="pf-card" aria-label="El último pago">
        <h3>El último pago <span class="pf-mut">en cascada</span></h3>
        <template v-if="lastPayment">
          <div class="pf-pay">
            <div>
              <div class="pf-bar"><span v-for="p in paymentParts.filter((x) => x.value)" :key="p.key" :class="p.cls" :style="{ width: pct(p.value, lastPayment.amount) }" :title="`${p.label}: ${fmt(p.value)}`"></span></div>
              <ol class="pf-rows pf-cascade">
                <li v-for="p in paymentParts" :key="p.key" :class="{ zero: !p.value }"><i :class="p.cls"></i>{{ p.label }}<b>{{ p.value ? fmt(p.value) : '—' }}</b></li>
              </ol>
            </div>
            <figure class="pf-voucher" aria-label="El voucher de pago">
              <div class="pf-voucher-top"><Receipt :size="14" /> Comprobante de pago</div>
              <b>¡Transacción exitosa!</b>
              <small>{{ dateOf(sim.days[lastPayment.day].date) }}</small>
              <dl><dt>Entidad</dt><dd>CrediComercio</dd><dt>Monto pagado</dt><dd>{{ fmt(lastPayment.amount) }}</dd><dt>Método</dt><dd>En línea</dd></dl>
              <span class="pf-voucher-ref">REF 00{{ 505000 + lastPayment.day }}</span>
            </figure>
          </div>
          <p class="pf-note">{{ lastPayment.text }} El voucher sale después del cobro, en una cola aparte: si el PDF falla, el pago no se deshace.</p>
        </template>
        <p v-else class="pf-note">Todavía no hay pagos. Corré el reloj hasta el primer vencimiento (día 35).</p>
      </section>

      <section class="pf-card" aria-label="A quién va cada peso">
        <h3>A quién va cada peso <span class="pf-mut">acumulado · Juan pagó {{ fmt(paidByJuan) }}</span></h3>
        <table class="pf-flows">
          <tbody>
            <tr v-for="f in flows" :key="f.key" :class="{ zero: !f.value }">
              <td>{{ f.label }}</td><td class="num">{{ fmt(f.value) }}</td>
              <td><span class="pf-dest" :class="{ inferred: !f.read }" :title="f.note">→ {{ f.to }}</span></td>
            </tr>
          </tbody>
        </table>
        <div class="pf-ctop">
          <b>CreditOp</b> no cobra intereses: gana el SaaS mensual del comercio y la comisión CTX, {{ fmt(sim.commission) }} por este crédito
          ({{ portfolio.assumptions.ctxCommissionPct }} % de lo desembolsado). Y si hay subsidio de intereses, lo pone de su bolsillo.
        </div>
        <p class="pf-note"><span class="pf-dest inferred">punteado</span> = inferido: el código no dice a quién llega.</p>
      </section>

      <section class="pf-card" aria-label="El estado y la cobranza">
        <h3>Estado y cobranza</h3>
        <div class="pf-bands">
          <span v-for="b in MORA_BANDS" :key="b.key" class="pf-band" :class="{ on: today.status === 2 ? band.key === b.key : (b.key === 'ok' && today.status === 1) }">{{ b.label }}</span>
          <span v-for="(s, id) in STATES" v-show="+id > 2" :key="id" class="pf-band pf-band-end" :class="{ on: today.status === +id }">{{ s.name }}</span>
        </div>
        <p v-if="today.status === 2" class="pf-note">Franja <b>{{ band.label }}</b> del reporte de riesgo. Cobranza ofrecería: {{ band.offer }}.
          <span class="pf-mut">(Las alternativas M1-M8 son de la rama «cobranza», sin mergear.)</span></p>
        <p v-else-if="today.status === 1" class="pf-note">Al día: recibe recordatorios antes del vencimiento. Sólo los estados 1 y 2 se cobran.</p>
        <p v-else-if="today.status === 9" class="pf-note">Suspendido: no hay fila vigente, el saldo queda congelado y no se causa nada mientras se reclama al seguro.</p>
        <p v-else class="pf-note">Cerrado: {{ state.name }}.</p>
        <h4>Bitácora</h4>
        <ul class="pf-log">
          <li v-for="(e, k) in log" :key="k" :class="MARK[e.kind]" @click="jump(e.day)"><span>día {{ e.day }}</span>{{ e.text }}</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pf { padding: 14px 16px 24px; display: flex; flex-direction: column; gap: 12px; font-size: 12.5px; color: var(--foreground);
  --c-principal: #534ab7; --c-principal-soft: color-mix(in oklab, #534ab7 35%, var(--card)); --c-interest: #7f77dd;
  --c-interest-soft: color-mix(in oklab, #7f77dd 35%, var(--card)); --c-late: #d85a30; --c-collection: #993c1d;
  --c-life: #1d9e75; --c-guarantee: #5dcaa5; --c-favor: var(--fg-3) }
.pf-mut { color: var(--fg-3); font-weight: 400 }
.pf-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: 12px 14px; min-width: 0 }
.pf-card h3 { margin: 0 0 10px; font-size: 13px; font-weight: 600; display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap }
.pf-card h4 { margin: 12px 0 6px; font-size: 12px; font-weight: 600; color: var(--fg-2) }
.pf-note { margin: 8px 0 0; color: var(--fg-2); line-height: 1.5 }
.pf-rails { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px }
.pf-rail { border: 1px solid var(--border); border-radius: var(--radius-lg, 10px); padding: 10px 12px; background: var(--card) }
.pf-rail.here { border-color: var(--purple); background: var(--tint-purple) }
.pf-rail header { display: flex; gap: 6px; align-items: baseline; margin-bottom: 6px }
.pf-rail header small { color: var(--fg-3) }
.pf-here { margin-left: auto; font-size: 11px; color: var(--purple-d) }
.pf-rail dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 0 }
.pf-rail dt { color: var(--fg-3) } .pf-rail dd { margin: 0 }
.pf-controls { display: flex; flex-direction: column; gap: 6px }
.pf-scenarios { display: flex; gap: 6px; flex-wrap: wrap }
.pf-scenarios button { all: unset; cursor: pointer; padding: 5px 11px; border-radius: 999px; border: 1px solid var(--border); color: var(--fg-2) }
.pf-scenarios button:hover { color: var(--foreground); border-color: var(--fg-3) }
.pf-scenarios button.on { background: var(--tint-purple); border-color: var(--purple); color: var(--foreground); font-weight: 600 }
.pf-hint { margin: 0; color: var(--fg-2) }
.pf-assume summary { cursor: pointer; color: var(--fg-3) }
.pf-assume-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 8px }
.pf-assume-grid label { display: flex; flex-direction: column; gap: 3px; color: var(--fg-3); font-size: 11.5px }
.pf-assume-grid input { font: inherit; color: var(--foreground); background: var(--input, var(--card)); border: 1px solid var(--border); border-radius: 6px; padding: 4px 6px }
.pf-link { all: unset; cursor: pointer; color: var(--blue); margin-left: 4px }
.pf-clock-head { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap }
.pf-icon { all: unset; cursor: pointer; display: inline-flex; padding: 4px; border-radius: 6px; border: 1px solid var(--border) }
.pf-icon:hover { border-color: var(--fg-3) }
.pf-state { margin-left: auto; padding: 2px 9px; border-radius: 999px; font-weight: 600; background: var(--tint-green); color: var(--green) }
.pf-state.st-vivo { background: var(--tint-green) }
.pf-state.st-late { background: var(--tint-red); color: var(--red) }
.pf-state.st-suspendido { background: var(--tint-amber); color: var(--amber) }
.pf-state.st-cierre { background: var(--muted); color: var(--fg-2) }
.pf-line { width: 100%; height: 120px; display: block }
.pf-area { fill: color-mix(in oklab, var(--purple) 22%, transparent); stroke: var(--purple); stroke-width: 1.5; vector-effect: non-scaling-stroke }
.pf-late-span { fill: color-mix(in oklab, var(--red) 14%, transparent) }
.pf-now { stroke: var(--foreground); stroke-width: 1.5; vector-effect: non-scaling-stroke }
.pf-mark { cursor: pointer }
.pf-mark circle { vector-effect: non-scaling-stroke }
.mk-blue circle, .pf-legend .mk-blue { fill: var(--blue); background: var(--blue) }
.mk-green circle, .pf-legend .mk-green { fill: var(--green); background: var(--green) }
.mk-red circle, .pf-legend .mk-red { fill: var(--red); background: var(--red) }
.mk-amber circle, .pf-legend .mk-amber { fill: var(--amber); background: var(--amber) }
.mk-tick rect, .pf-legend .mk-tick { fill: var(--fg-3); background: var(--fg-3) }
.pf-range { width: 100%; margin: 4px 0 2px }
.pf-legend { display: flex; gap: 14px; flex-wrap: wrap; color: var(--fg-3); font-size: 11.5px }
.pf-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0 }
.pf-legend .mk-tick { width: 2px; height: 9px; border-radius: 0 }
.pf-legend .pf-late-sw { width: 12px; border-radius: 2px; background: color-mix(in oklab, var(--red) 20%, transparent) }
.pf-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px }
.pf-bar { display: flex; height: 18px; border-radius: 5px; overflow: hidden; background: var(--muted) }
.pf-bar span { display: block; min-width: 2px; transition: width .15s }
.pf-rows { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px }
.pf-rows li { display: flex; align-items: center; gap: 7px }
.pf-rows li b { margin-left: auto; font-weight: 500; font-variant-numeric: tabular-nums }
.pf-rows li.zero { color: var(--fg-3) }
.pf-rows i { width: 9px; height: 9px; border-radius: 2px; flex: none }
.pf-cascade { counter-reset: c } .pf-cascade li::before { counter-increment: c; content: counter(c); color: var(--fg-3); width: 12px; font-size: 11px }
.c-principal, .pf-bar .c-principal { background: var(--c-principal) } .c-principal-soft { background: var(--c-principal-soft) }
.c-interest { background: var(--c-interest) } .c-interest-soft { background: var(--c-interest-soft) }
.c-late { background: var(--c-late) } .c-collection { background: var(--c-collection) }
.c-life { background: var(--c-life) } .c-guarantee { background: var(--c-guarantee) } .c-favor { background: var(--c-favor) }
.pf-pay { display: grid; grid-template-columns: minmax(0, 1fr) 150px; gap: 12px; align-items: start }
.pf-voucher { margin: 0; background: var(--paper); color: var(--paper-ink); border-radius: 12px 12px 4px 4px; padding: 0 0 10px; text-align: center;
  display: flex; flex-direction: column; gap: 3px; font-size: 11px; overflow: hidden; border: 1px solid var(--border) }
.pf-voucher-top { background: #252256; color: #cfcdf0; padding: 9px 6px; display: flex; gap: 5px; justify-content: center; align-items: center; margin-bottom: 4px }
.pf-voucher b { font-size: 12px } .pf-voucher small { color: #777 }
.pf-voucher dl { display: grid; grid-template-columns: auto auto; justify-content: space-between; gap: 1px 8px; margin: 4px 10px; text-align: left }
.pf-voucher dt { color: #777 } .pf-voucher dd { margin: 0; text-align: right }
.pf-voucher-ref { margin: 2px 10px 0; background: #eeedfe; color: #3c3489; border-radius: 6px; padding: 3px 0; font-weight: 600 }
.pf-flows { width: 100%; border-collapse: collapse }
.pf-flows td { padding: 3px 4px; border-bottom: 1px solid var(--border) }
.pf-flows tr.zero td { color: var(--fg-3) }
.pf-flows .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap }
.pf-dest { padding: 1px 7px; border-radius: 999px; border: 1px solid var(--fg-3); white-space: nowrap; font-size: 11.5px }
.pf-dest.inferred { border-style: dashed; color: var(--fg-2) }
.pf-ctop { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: var(--tint-blue); line-height: 1.5 }
.pf-bands { display: flex; flex-wrap: wrap; gap: 4px }
.pf-band { padding: 3px 8px; border-radius: 6px; border: 1px solid var(--border); color: var(--fg-2) }
.pf-band.on { background: var(--tint-red); border-color: var(--red); color: var(--foreground); font-weight: 600 }
.pf-band:first-child.on { background: var(--tint-green); border-color: var(--green) }
.pf-band-end { border-style: dashed } .pf-band-end.on { background: var(--muted); border-color: var(--fg-3); border-style: solid }
.pf-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 210px; overflow: auto }
.pf-log li { cursor: pointer; padding-left: 9px; border-left: 3px solid var(--fg-3); line-height: 1.4 }
.pf-log li span { color: var(--fg-3); margin-right: 6px; font-variant-numeric: tabular-nums }
.pf-log li.mk-green { border-color: var(--green) } .pf-log li.mk-red { border-color: var(--red) }
.pf-log li.mk-amber { border-color: var(--amber) } .pf-log li.mk-blue { border-color: var(--blue) }
@media (max-width: 900px) { .pf-rails, .pf-grid { grid-template-columns: 1fr } .pf-pay { grid-template-columns: 1fr } }
</style>
