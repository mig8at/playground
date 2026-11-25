<script setup>
import { computed, ref } from 'vue'
import { X, Check, Minus, CircleAlert, ChevronRight } from 'lucide-vue-next'
import {
  customLenders, merchant, lenders, state, bureau, clientProfile as profile, setNull, editTick, money, RT_LABEL,
  branchGateDiag, branchCreditBureauRules, categoryDiag, usesQuotaEngine, usesPreApproval, preApprovalResponseOf,
  setPreApprovalField, installmentBreakdown, bondOf, calcValue, selectionCheck,
  identityOutcome, setIdentityResult, IDENTITY_PROVIDERS, paymentDateOptions, paymentSchedule, delegatedOf, CREDITOPX_PAYMENT_DAYS,
  closingOutcome, setSignatureOk,
} from './store'

// La TABLA del flujo (2026-11-25): el mismo cliente contra todas las entidades, paso por paso. Cada fila es un paso de
// la solicitud y cada columna una entidad; cada celda dice si la entidad pasa ese paso, y al abrirla sale la
// «calculadora» del paso. No tiene lógica propia: todo sale de `store.js`, lo mismo que dibuja el grafo, y lo carga
// `bin/flow` (import, client). Por ahora tiene las dos primeras filas: el listado y la preaprobación.

// ── El cliente, arriba: los datos que deciden. Editarlos recalcula toda la tabla.
const EMP = [['empleado', 'Empleado'], ['independiente', 'Independiente'], ['pensionado', 'Pensionado'], ['desempleado', 'Desempleado']]
const CONT = [['<3m', '< 3 meses'], ['3m', '3 meses'], ['6m', '6 meses'], ['12m', '12 meses o más']]
function setBureau(key, v, numeric = true) {
  bureau[key] = numeric ? (v === '' ? null : Number(v)) : v
  setNull(key, v === '' || v == null)
  editTick.n++
}
function setAmount(v) { state.monto = String(v).replace(/\D/g, ''); editTick.n++ }
const amount = computed(() => parseInt(String(state.monto).replace(/\D/g, '')) || 0)

// ── Las columnas: las entidades del comercio, en el orden en que se cargaron.
const columns = computed(() => {
  editTick.n // dependencia: recalcula al editar
  const byName = Object.fromEntries(lenders.value.map(r => [r.name, r]))
  return customLenders.filter(l => merchant.enabled[l.name]).map(l => ({ def: l, row: byName[l.name] || null }))
})

// ── Fila 1 · el LISTADO: ¿aparece la tarjeta? Reglas duras de la sucursal (tipo de documento, datacrédito, grupos).
// CreditopX que no las cumple desaparece; las demás siguen, con probabilidad baja: decide la entidad.
function listingCell(c) {
  const rt = c.def.rt
  if (!c.row) return { status: 'off', title: 'No sale', line: 'el país de la entidad no es el del comercio' }
  const gate = branchGateDiag(c.def.name).gate
  if (gate.ok) return { status: 'pass', title: 'Sale', line: 'cumple las reglas duras', gate }
  if (rt === 2) return { status: 'fail', title: 'No sale', line: gate.reason, gate }
  return { status: 'warn', title: 'Sale con prob. baja', line: gate.reason, gate }
}

// ── Fila 2 · la PREAPROBACIÓN: ¿cuánto le prestan? Quién contesta depende del tipo de la entidad.
function whoDecides(l) {
  if (l.rt === 0) return 'nadie: redirige a su sitio'
  if (usesQuotaEngine(l)) return l.rt === 2 ? 'motor de cupo (CreditopX)' : 'motor de cupo, con la política de ' + l.name
  if (usesPreApproval(l)) return 'la API de ' + l.name
  return '—'
}
// El cupo de verdad, no el monto pedido (el listado guarda min(monto, cupo)): el de la categoría que gana si decide el
// motor, o el monto máximo que contesta la API (o el tope de la entidad si no se dictó).
// Como el listado: topeado por el máximo del comercio para esa entidad (`lenders_by_allieds.max_amount`, que hereda el
// de la línea de crédito).
function maxQuota(l) {
  const cap = calcValue(merchant.nombre, 'montoMax', l) || Infinity
  let q = 0
  if (usesQuotaEngine(l)) { const w = categoryDiag(l.name).rows.find(x => x.won); q = w ? w.cupo : 0 }
  else if (usesPreApproval(l)) q = preApprovalResponseOf(l.name).maxAmount ?? (l.terms?.amountMax || 0)
  return Math.min(q, cap)
}
function preApprovalCell(c, first) {
  if (first.status === 'fail' || first.status === 'off') return { status: 'off', title: 'No llega', line: 'se cortó en el listado' }
  const l = c.def, r = c.row
  if (l.rt === 0) return { status: 'na', title: 'No aplica', line: 'redirige: decide la entidad en su sitio' }
  const max = maxQuota(l)
  if (r.ok) return { status: 'pass', title: 'Aprobada' + (max ? ' · hasta ' + money(max) : ''), line: r.category ? 'categoría ' + r.category : whoDecides(l) }
  return { status: 'fail', title: 'Rechazada', line: r.reason }
}

// ── Fila 3 · ELEGIR la entidad: el cliente toca «Continuar» en la tarjeta y el backend guarda la elección
// (`update-user-request`, UserRequestService::updateUserRequest, verificado en main el 2026-11-25). NO vuelve a preguntar
// el cupo: valida el monto contra el pedido de la tienda y la cuota inicial contra el monto, guarda entidad, montos,
// plazo, tasa y cuota inicial, y pasa la solicitud a 3. Lo que sigue depende del riel.
const NEXT_BY_RT = {
  0: 'redirige al sitio de la entidad',
  1: 'se radica en la API de la entidad',
  2: 'sigue en CreditOp: validación de identidad',
  4: 'sigue en CreditOp: validación de identidad',
}
function selectionCell(c, previous) {
  if (previous.status === 'fail' || previous.status === 'off') return { status: 'off', title: 'No llega', line: 'se cortó antes' }
  const check = selectionCheck(c.def.name)
  if (!check.allowed) return { status: 'fail', title: 'No la deja elegir', line: check.checks.find(x => !x.ok)?.label }
  return { status: 'pass', title: 'Pasa a 3 · Selección', line: NEXT_BY_RT[c.def.rt] || '' }
}

// ── Fila 4 · VALIDACIÓN DE IDENTIDAD: sólo para las que originan en casa (CreditopX y delegada). Un proveedor comprueba
// que quien está del otro lado es el dueño de la cédula; si el primario no valida, pasa al siguiente en orden
// (`identityOutcome`, knowledge/identity-validation). El agregador y el redirect la hacen en el flujo de la entidad.
function identityCell(c, previous) {
  if (previous.status !== 'pass') return { status: 'off', title: 'No llega', line: 'se cortó antes' }
  if (c.def.rt === 0 || c.def.rt === 1) return { status: 'na', title: 'No aplica', line: 'la valida la entidad en su flujo' }
  const o = identityOutcome(c.def)
  if (o.status === 'unset') return { status: 'warn', title: 'Sin proveedor', line: 'el backend contesta error y el cliente ve las instrucciones de siempre' }
  const names = o.providers.map(p => p.label.replace(/^Validación /, '')).join(' → ')
  if (o.status === 'pass') return { status: 'pass', title: 'Validada', line: names }
  return { status: 'fail', title: 'No validó', line: names + ': ninguno validó' }
}

// ── Fila 5 · PLAN DE PAGOS: el cliente elige la primera fecha y ve sus cuotas. CreditopX ofrece el 5, 16 o 28; la
// delegada, los días de su ficha. En la delegada el interés de los días de más va en la primera o en la última cuota.
// La fecha y el plazo elegidos acá son de la tabla (no se guardan en el escenario).
const planChoice = ref({}) // { [nombre]: { date: label, n } }
function planFor(c) {
  const r = c.row, opts = paymentDateOptions(c.def)
  const pick = planChoice.value[c.def.name] || {}
  const first = opts.find(o => o.label === pick.date) || opts[0]
  const dues = (r?.dues || []).slice().sort((a, b) => a - b)
  const n = dues.includes(pick.n) ? pick.n : dues[dues.length - 1]
  return { opts, first, dues, n, plan: r && n && first ? paymentSchedule(r, n, first) : null }
}
function planCell(c, previous) {
  if (previous.status !== 'pass') return { status: 'off', title: 'No llega', line: 'se cortó antes' }
  if (c.def.rt === 0 || c.def.rt === 1) return { status: 'na', title: 'No aplica', line: 'el plan lo arma la entidad' }
  const p = planFor(c)
  if (!p.plan) return { status: 'warn', title: 'Sin plan', line: 'no hay plazos o fechas para armarlo' }
  const extra = p.plan.extraInterest && p.plan.extraOn ? ` · +${money(p.plan.extraInterest)} en la ${p.plan.extraOn === 1 ? 'primera' : 'última'}` : ''
  return { status: 'pass', title: `${money(p.plan.breakdown.cuota)} × ${p.n} cuotas`, line: `1.ª fecha ${p.first.label}${extra}` }
}

// ── Fila 6 · FIRMA Y CIERRE: firma los documentos con un OTP, se autoriza (estado 11) y, en la delegada, se formaliza
// según su ficha. Si la categoría que ganó lleva codeudor, firma la rama con codeudor del catálogo.
const withCosigner = (c) => /codeudor/i.test(String(c.row?.category || ''))
function closingCell(c, previous) {
  if (previous.status !== 'pass') return { status: 'off', title: 'No llega', line: 'se cortó antes' }
  if (c.def.rt === 0 || c.def.rt === 1) return { status: 'na', title: 'No aplica', line: c.def.rt === 0 ? 'cierra en el sitio de la entidad' : 'la entidad informa el resultado' }
  const o = closingOutcome(c.def, withCosigner(c))
  if (!o.signs) return { status: 'fail', title: 'No firmó', line: 'sin OTP no se autoriza: no llega a 11' }
  const after = o.formalization ? (/radica la/.test(o.formalization) ? ' · radica' : '') : ''
  return { status: 'pass', title: '11 · Autorizada' + after, line: `${o.sign.docs.length} documentos · cobra ${o.sign.externallyServiced ? 'la entidad' : 'Creditop'}` }
}

const ROWS = [
  { key: 'listing', n: 1, label: 'Listado', ask: '¿Aparece la tarjeta?' },
  { key: 'preapproval', n: 2, label: 'Preaprobación', ask: '¿Cuánto le prestan?' },
  { key: 'selection', n: 3, label: 'Elegir la entidad', ask: '¿Qué se guarda al tocar «Continuar»?' },
  { key: 'identity', n: 4, label: 'Validación de identidad', ask: '¿Es el dueño de la cédula?' },
  { key: 'plan', n: 5, label: 'Plan de pagos', ask: '¿Cuándo paga y cuánto?' },
  { key: 'closing', n: 6, label: 'Firma y cierre', ask: '¿Qué firma y cómo termina?' },
]
const NEXT_ROWS = []

const grid = computed(() => columns.value.map(c => {
  const listing = listingCell(c)
  const preapproval = preApprovalCell(c, listing)
  const selection = selectionCell(c, preapproval)
  const identity = identityCell(c, selection)
  const plan = planCell(c, identity)
  return { c, cells: { listing, preapproval, selection, identity, plan, closing: closingCell(c, plan) } }
}))

// ── La celda abierta: la «calculadora» del paso, en el panel de la derecha.
const open = ref(null) // { name, row }
const openCol = computed(() => open.value && grid.value.find(g => g.c.def.name === open.value.name))
function toggle(name, row) { open.value = open.value && open.value.name === name && open.value.row === row ? null : { name, row } }

// Detalle del listado: cada compuerta con lo que pide y lo que tiene el cliente.
const listingDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'listing') return null
  const name = openCol.value.c.def.name
  const gate = branchGateDiag(name).gate
  const dc = branchCreditBureauRules(name)
  return { gate, dc }
})
const FIELD = { employment: 'Ocupación', gender: 'Género', monthlyIncome: 'Ingreso', age: 'Edad', documentType: 'Tipo de documento' }
const condText = (x) => {
  const c = x.c, v = Array.isArray(c.value) ? c.value.join(' | ') : (c.field === 'monthlyIncome' ? money(c.value) : c.value)
  const op = c.op === 'in' ? 'es' : c.op === 'not in' ? 'no es' : c.op
  return `${FIELD[c.field] || c.field} ${op} ${v}`
}

// Detalle de la preaprobación: las categorías (si decide el motor), lo que dicta la API, y la calculadora de cuota.
const CHECK = { occupation: 'ocupación', age: 'edad', income: 'ingreso verificado', continuity: 'continuidad', gender: 'género', score: 'score', negatives: 'negativos', delinq: 'mora', history: 'historia', inquiries: 'consultas' }
const preDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'preapproval') return null
  const { def: l, row: r } = openCol.value.c
  const cats = usesQuotaEngine(l) ? categoryDiag(l.name) : null
  return { l, r, cats, who: whoDecides(l), pa: usesPreApproval(l) ? preApprovalResponseOf(l.name) : null }
})
const term = ref(null)
const terms = computed(() => (preDetail.value?.r?.dues || []).slice().sort((a, b) => a - b))
const chosenTerm = computed(() => terms.value.includes(term.value) ? term.value : terms.value[terms.value.length - 1])
const quote = computed(() => {
  const d = preDetail.value
  if (!d || !d.r || !d.r.ok || !chosenTerm.value || d.l.rt === 0) return null
  const b = installmentBreakdown(d.r, chosenTerm.value)
  return { ...b, bond: d.l.rt === 4 ? bondOf(d.l) : null, n: chosenTerm.value }
})
// Detalle de la elección: las validaciones y lo que queda guardado en la solicitud.
const selDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'selection') return null
  const { def: l, row: r } = openCol.value.c
  const check = selectionCheck(l.name)
  const n = (r?.dues || []).slice().sort((a, b) => a - b).pop() || 0
  const b = r && n && l.rt !== 0 ? installmentBreakdown(r, n) : null
  const fee = r?.initialFeeAmount || 0
  // `amount`: CreditopX guarda el valor a financiar CON el FGA (la base de sus cuotas); la delegada, sin él (la fianza
  // la pone su plan); el resto, el monto menos la cuota inicial más los costos del comercio.
  let saved = amount.value - fee, savedWhy = 'monto − cuota inicial'
  if (b && l.rt === 2) { saved = b.capital; savedWhy = 'monto − cuota inicial + costos del comercio + FGA con IVA' }
  else if (b && l.rt !== 4) { saved = b.financiado + b.admin; savedWhy = 'monto − cuota inicial + costos del comercio' }
  return { l, r, check, n, fee, saved, savedWhy, next: NEXT_BY_RT[l.rt] }
})
const idDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'identity') return null
  const l = openCol.value.c.def
  return { l, outcome: identityOutcome(l), inHouse: l.rt === 2 || l.rt === 4 }
})
const ID_RESULTS = [['valida', 'valida'], ['no_valida', 'no valida']]
const planDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'plan') return null
  const c = openCol.value.c
  return { c, l: c.def, ...planFor(c) }
})
const closeDetail = computed(() => {
  if (!openCol.value || open.value.row !== 'closing') return null
  const c = openCol.value.c
  return { c, l: c.def, cosigner: withCosigner(c), ...closingOutcome(c.def, withCosigner(c)) }
})
function setPlan(name, key, v) { planChoice.value = { ...planChoice.value, [name]: { ...(planChoice.value[name] || {}), [key]: v } } }
const shownRows = computed(() => {
  const rows = planDetail.value?.plan?.rows || []
  return rows.length <= 6 ? rows : [...rows.slice(0, 3), null, ...rows.slice(-2)]
})
const STATUS = [['aprueba', 'aprueba'], ['rechaza', 'rechaza'], ['timeout', 'no contesta']]
const setPa = (k, v) => { setPreApprovalField(open.value.name, k, v) }
</script>

<template>
  <div class="tv">
    <!-- El cliente -->
    <section class="tv-client" aria-label="El cliente de la solicitud">
      <div class="tv-client__title">El cliente</div>
      <label class="tv-f"><span>Monto</span><input inputmode="numeric" :value="money(amount)" @change="e => setAmount(e.target.value)" /></label>
      <label class="tv-f"><span>Ocupación</span>
        <select :value="profile.employment ?? ''" @change="e => setBureau('employment', e.target.value, false)">
          <option v-for="[k, t] in EMP" :key="k" :value="k">{{ t }}</option>
        </select></label>
      <label class="tv-f tv-f--s"><span>Edad</span><input type="number" :value="profile.edad ?? ''" @change="e => setBureau('edad', e.target.value)" /></label>
      <label class="tv-f tv-f--s"><span>Score</span><input type="number" :value="profile.score ?? ''" @change="e => setBureau('score', e.target.value)" /></label>
      <label class="tv-f tv-f--s"><span>Negativos 12m</span><input type="number" :value="profile.negatives12m ?? ''" @change="e => setBureau('negatives12m', e.target.value)" /></label>
      <label class="tv-f"><span>Continuidad laboral</span>
        <select :value="bureau.agilContinuity ?? ''" @change="e => setBureau('agilContinuity', e.target.value, false)">
          <option v-for="[k, t] in CONT" :key="k" :value="k">{{ t }}</option>
        </select></label>
      <div class="tv-f tv-f--ro"><span>Ingreso</span><b>{{ money(profile.salario) }}</b><em>{{ profile.salarioFuente }}</em></div>
      <div class="tv-f tv-f--ro"><span>Documento</span><b>{{ state.tipoDoc }}</b></div>
    </section>

    <div class="tv-body">
      <div class="tv-scroll">
        <div v-if="!grid.length" class="tv-empty">No hay entidades cargadas. Se cargan por consola: <code>bin/flow import --branch … --lender …</code></div>
        <div v-else class="tv-grid" :style="{ gridTemplateColumns: `150px repeat(${grid.length}, minmax(168px, 1fr))` }">
          <!-- Cabecera: una entidad por columna -->
          <div class="tv-corner">{{ merchant.nombre }}<small>{{ merchant.sucursal }}</small></div>
          <div v-for="g in grid" :key="'h' + g.c.def.name" class="tv-colhead">
            <span class="lg__chip" :class="'rt' + g.c.def.rt">rt{{ g.c.def.rt }}</span>
            <b>{{ g.c.def.name }}</b>
            <small>{{ RT_LABEL[g.c.def.rt] }} · {{ g.c.def.producto }}</small>
          </div>

          <!-- Filas que ya funcionan -->
          <template v-for="row in ROWS" :key="row.key">
            <div class="tv-rowhead"><span class="tv-n">{{ row.n }}</span><b>{{ row.label }}</b><small>{{ row.ask }}</small></div>
            <button v-for="g in grid" :key="row.key + g.c.def.name" type="button" class="tv-cell"
              :class="['tv-cell--' + g.cells[row.key].status, { 'tv-cell--open': open && open.name === g.c.def.name && open.row === row.key }]"
              :disabled="g.cells[row.key].status === 'off'" @click="toggle(g.c.def.name, row.key)">
              <span class="tv-cell__ic">
                <Check v-if="g.cells[row.key].status === 'pass'" :size="13" />
                <X v-else-if="g.cells[row.key].status === 'fail'" :size="13" />
                <CircleAlert v-else-if="g.cells[row.key].status === 'warn'" :size="13" />
                <Minus v-else :size="13" />
              </span>
              <span class="tv-cell__t">{{ g.cells[row.key].title }}</span>
              <span class="tv-cell__l">{{ g.cells[row.key].line }}</span>
              <ChevronRight v-if="g.cells[row.key].status !== 'off'" class="tv-cell__go" :size="12" />
            </button>
          </template>

          <!-- Lo que viene: la forma de la tabla, sin datos todavía -->
          <template v-for="(label, i) in NEXT_ROWS" :key="'next' + i">
            <div class="tv-rowhead tv-rowhead--next"><span class="tv-n">{{ ROWS.length + i + 1 }}</span><b>{{ label }}</b><small>próximamente</small></div>
            <div v-for="g in grid" :key="'n' + i + g.c.def.name" class="tv-cell tv-cell--next"></div>
          </template>
        </div>
      </div>

      <!-- La calculadora del paso -->
      <aside v-if="openCol" class="tv-calc auxiliarybar" aria-label="El detalle del paso">
        <div class="region-head">
          <span class="tv-calc__h"><span class="tv-n">{{ ROWS.find(x => x.key === open.row)?.n }}</span> {{ openCol.c.def.name }}</span>
          <div class="region-actions"><button type="button" class="region-action" title="Cerrar" aria-label="Cerrar" @click="open = null"><X :size="15" /></button></div>
        </div>

        <div v-if="listingDetail" class="region-body tv-calc__b">
          <h3>¿Aparece la tarjeta?</h3>
          <p class="tv-p">Antes de preguntarle a nadie, CreditOp mira las <b>reglas duras</b> de la sucursal para esta entidad:
            requisitos que el cliente cumple o no. {{ openCol.c.def.rt === 2
              ? 'Es CreditopX: si no las cumple, la tarjeta no sale.'
              : 'No es CreditopX: aunque no las cumpla, la tarjeta sale con probabilidad baja, porque la que decide es la entidad.' }}</p>

          <div class="tv-gate" :class="listingDetail.gate.documentTypes.ok ? 'ok' : 'no'">
            <div class="tv-gate__h"><Check v-if="listingDetail.gate.documentTypes.ok" :size="12" /><X v-else :size="12" /> Tipo de documento</div>
            <div class="tv-kv"><span>acepta</span><b>{{ listingDetail.gate.documentTypes.docs.join(', ') || 'ninguno' }}</b></div>
            <div class="tv-kv"><span>el cliente</span><b>{{ state.tipoDoc }}</b></div>
          </div>

          <div class="tv-gate" :class="!listingDetail.gate.datacredito.on ? 'na' : listingDetail.gate.datacredito.ok ? 'ok' : 'no'">
            <div class="tv-gate__h"><Check v-if="listingDetail.gate.datacredito.ok" :size="12" /><X v-else :size="12" /> Centrales de riesgo (datacrédito)</div>
            <template v-if="listingDetail.gate.datacredito.on">
              <div class="tv-kv"><span>score mínimo</span><b>{{ listingDetail.dc.minScore || 'sin mínimo' }} <em>· el cliente {{ profile.score ?? 'sin dato' }}</em></b></div>
              <div class="tv-kv"><span>negativos máx.</span><b>{{ listingDetail.dc.maxNegatives < 20 ? listingDetail.dc.maxNegatives : 'sin tope' }} <em>· {{ profile.negatives12m ?? 'sin dato' }}</em></b></div>
              <div class="tv-kv"><span>consultas máx.</span><b>{{ listingDetail.dc.maxInquiries < 20 ? listingDetail.dc.maxInquiries : 'sin tope' }} <em>· {{ profile.inquiries6m ?? 'sin dato' }}</em></b></div>
              <div v-for="f in listingDetail.gate.datacredito.fails" :key="f.key" class="tv-why">✗ {{ f.reason }}</div>
            </template>
            <div v-else class="tv-p tv-p--m">La sucursal no le pone reglas de centrales a esta entidad.</div>
          </div>

          <div class="tv-gate" :class="!listingDetail.gate.groups.on ? 'na' : listingDetail.gate.groups.ok ? 'ok' : 'no'">
            <div class="tv-gate__h"><Check v-if="listingDetail.gate.groups.ok" :size="12" /><X v-else :size="12" /> Grupos de reglas de la sucursal</div>
            <div v-if="!listingDetail.gate.groups.on" class="tv-p tv-p--m">No hay grupos: no filtra.</div>
            <div v-else class="tv-p tv-p--m">Alcanza con cumplir UN grupo entero.</div>
            <div v-for="(gr, i) in listingDetail.gate.groups.groups" :key="i" class="tv-group" :class="gr.ok ? 'ok' : 'no'">
              <div v-for="(x, j) in gr.conds" :key="j" class="tv-cond" :class="x.ok ? 'ok' : 'no'">
                <Check v-if="x.ok" :size="11" /><X v-else :size="11" /> {{ condText(x) }}<em v-if="!x.ok"> · {{ x.reason }}</em>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="preDetail" class="region-body tv-calc__b">
          <h3>¿Cuánto le prestan?</h3>
          <p class="tv-p">El servicio de preaprobación le pregunta a <b>{{ preDetail.who }}</b>. Lo que contesta es el <b>cupo</b>:
            el máximo que le prestan a este cliente. Si pide más, la tarjeta le pide bajar el monto.</p>

          <!-- Decide el motor: la categoría -->
          <template v-if="preDetail.cats">
            <div class="tv-sec">Categorías: gana la primera que cumple todo</div>
            <div v-for="row in preDetail.cats.rows" :key="row.cat.id" class="tv-catrow" :class="{ won: row.won, ok: row.ok && !row.won, no: !row.ok }">
              <span class="tv-catrow__n">{{ row.cat.label }}</span>
              <span v-if="row.won" class="tv-catrow__s">gana · cupo {{ money(row.cupo) }} · {{ row.cat.maxFeeNumber ? 'hasta ' + row.cat.maxFeeNumber + ' cuotas' : 'sin tope de cuotas' }}<template v-if="row.cat.fga != null"> · FGA {{ row.cat.fga }} %</template></span>
              <span v-else-if="row.ok" class="tv-catrow__s">también cumple</span>
              <span v-else class="tv-catrow__s">falla: {{ Object.entries(row.checks).filter(([, v]) => !v).map(([k]) => CHECK[k] || k).join(', ') }}</span>
            </div>
          </template>

          <!-- Decide la API: se dicta lo que contesta -->
          <template v-if="preDetail.pa">
            <div class="tv-sec">Lo que contesta la API (dictalo)</div>
            <div class="tv-chips">
              <button v-for="[k, t] in STATUS" :key="k" type="button" class="chip-toggle" :class="{ on: preDetail.pa.status === k }" @click="setPa('status', k)">{{ t }}</button>
            </div>
            <label class="tv-f tv-f--row"><span>Monto máximo</span><input type="number" :value="preDetail.pa.maxAmount ?? ''" placeholder="el de la entidad" @change="e => setPa('maxAmount', e.target.value)" /></label>
            <label class="tv-f tv-f--row"><span>Tasa % mensual</span><input type="number" step="0.01" :value="preDetail.pa.rate ?? ''" placeholder="la de la entidad" @change="e => setPa('rate', e.target.value)" /></label>
          </template>

          <div class="tv-verdict" :class="preDetail.r && preDetail.r.ok ? 'ok' : 'no'">
            <template v-if="preDetail.r && preDetail.r.ok">Aprobada: le prestan hasta <b>{{ money(maxQuota(preDetail.l)) }}</b> y pide {{ money(amount) }}</template>
            <template v-else>{{ preDetail.r ? preDetail.r.reason : 'sin respuesta' }}</template>
          </div>

          <!-- La calculadora de la cuota -->
          <template v-if="quote">
            <div class="tv-sec">La cuota</div>
            <div v-if="terms.length <= 10" class="tv-chips">
              <button v-for="n in terms" :key="n" type="button" class="chip-toggle" :class="{ on: n === chosenTerm }" @click="term = n">{{ n }}</button>
              <span class="tv-p tv-p--m">cuotas</span>
            </div>
            <label v-else class="tv-f tv-f--row"><span>Plazo</span>
              <select :value="chosenTerm" @change="e => term = Number(e.target.value)"><option v-for="n in terms" :key="n" :value="n">{{ n }} cuotas</option></select></label>
            <div class="tv-kv"><span>Monto que pide</span><b>{{ money(amount) }}</b></div>
            <div v-if="preDetail.r.initialFeeAmount" class="tv-kv"><span>− Cuota inicial ({{ preDetail.r.initialFeePct }} %)</span><b>{{ money(preDetail.r.initialFeeAmount) }}</b></div>
            <div class="tv-kv"><span>= Se financia</span><b>{{ money(quote.financiado) }}</b></div>
            <div v-if="quote.admin" class="tv-kv"><span>+ Costos del comercio</span><b>{{ money(quote.admin) }}</b></div>
            <div v-if="quote.fga" class="tv-kv"><span>+ Fianza con IVA<template v-if="quote.bond"> ({{ quote.bond.pct }} %, {{ quote.bond.type === 'mensual' ? 'vencida' : 'anticipada' }})</template></span>
              <b>{{ money(quote.fga) }}<em v-if="quote.bond && quote.bond.type === 'mensual'"> · en las cuotas</em></b></div>
            <div class="tv-kv"><span>= Capital del crédito</span><b>{{ money(quote.capital) }}</b></div>
            <div class="tv-kv"><span>Tasa mensual</span><b>{{ preDetail.r.rate ?? '—' }} %</b></div>
            <div class="tv-kv"><span>Seguros por cuota</span><b>{{ money(Math.round(quote.seguros)) }}</b></div>
            <div class="tv-total"><span>Cuota mensual · {{ quote.n }} cuotas</span><b>{{ money(quote.cuota) }}</b></div>
            <p v-if="quote.bond" class="tv-p tv-p--m">La fianza sale de {{ quote.bond.pctFrom }}. En la delegada la cuota real la calcula el backend
              (suma el 4×1000 y el interés de los días hasta la primera cuota): esto es una aproximación.</p>
          </template>
          <p v-else-if="preDetail.l.rt === 0" class="tv-p tv-p--m">El redirect no muestra cuota: el cliente la ve en el sitio de la entidad.</p>
        </div>

        <div v-else-if="selDetail" class="region-body tv-calc__b">
          <h3>¿Qué pasa al elegirla?</h3>
          <p class="tv-p">El cliente toca «Continuar» en la tarjeta. El backend <b>no vuelve a preguntar el cupo</b>: confía en lo que
            mostró la tarjeta. Revisa dos cosas, guarda la elección en la solicitud y la pasa al estado <b>3 · Selección de entidad</b>.</p>

          <div class="tv-sec">Lo que revisa</div>
          <div v-for="c in selDetail.check.checks" :key="c.key" class="tv-cond" :class="c.info ? '' : (c.ok ? 'ok' : 'no')">
            <Check v-if="c.ok && !c.info" :size="11" /><X v-else-if="!c.ok" :size="11" /><Minus v-else :size="11" /> {{ c.label }}
          </div>

          <div class="tv-sec">Lo que queda guardado en la solicitud</div>
          <div class="tv-kv"><span>Entidad</span><b>{{ selDetail.l.name }}</b></div>
          <div class="tv-kv"><span>Monto pedido <em>original_amount</em></span><b>{{ money(amount) }}</b></div>
          <div class="tv-kv"><span>Monto a financiar <em>amount</em></span><b>{{ money(selDetail.saved) }}</b></div>
          <p class="tv-p tv-p--m">{{ selDetail.savedWhy }}</p>
          <div class="tv-kv"><span>Cuota inicial</span><b>{{ money(selDetail.fee) }}</b></div>
          <div v-if="selDetail.n" class="tv-kv"><span>Plazo <em>fee_number</em></span><b>{{ selDetail.n }} cuotas</b></div>
          <div class="tv-kv"><span>Tasa</span><b>{{ selDetail.r?.rate ?? '—' }} %</b></div>
          <div class="tv-kv"><span>Estado</span><b>3 · Selección de entidad</b></div>

          <div class="tv-verdict" :class="selDetail.check.allowed ? 'ok' : 'no'">
            <template v-if="selDetail.check.allowed">Sigue: {{ selDetail.next }}.</template>
            <template v-else>No la deja elegir: {{ selDetail.check.checks.find(x => !x.ok)?.label }}</template>
          </div>
          <p class="tv-p tv-p--m">Si la solicitud ya tenía OTRA entidad elegida (o ya está en 11), elegir una distinta no la cambia:
            crea una solicitud nueva para esa entidad, y ahí sí revisa que la originación esté habilitada en la sucursal.</p>
        </div>

        <div v-else-if="idDetail" class="region-body tv-calc__b">
          <h3>¿Es el dueño de la cédula?</h3>
          <p class="tv-p">En el listado las centrales ya compararon el <b>nombre</b> que escribió con el de la cédula. Acá se
            comprueba a la <b>persona</b>: que quien está del otro lado es el dueño del documento. Lo hace un proveedor que
            elige cada entidad, y si el primero no valida, se pasa al siguiente en orden.</p>
          <template v-if="!idDetail.inHouse">
            <p class="tv-p tv-p--m">{{ idDetail.l.rt === 0 ? 'El redirect' : 'El agregador' }} no pasa por acá: la identidad la
              valida la entidad en su propio flujo.</p>
          </template>
          <template v-else-if="idDetail.outcome.status === 'unset'">
            <div class="tv-verdict no">{{ idDetail.l.name }} no tiene proveedor de identidad cargado
              (<code>lender_identity_validation_types</code>). En el backend eso es un error que no se ve: contesta
              «next_step: error» y el cliente ve las instrucciones de siempre.</div>
          </template>
          <template v-else>
            <div class="tv-sec">Proveedores, en orden (dictá lo que contesta cada uno)</div>
            <div v-for="(p, i) in idDetail.outcome.steps" :key="p.slug" class="tv-gate" :class="p.result === 'valida' ? 'ok' : 'no'">
              <div class="tv-gate__h">{{ i === 0 ? 'Primario' : 'Respaldo ' + i }} · {{ p.label }}</div>
              <div class="tv-p tv-p--m">{{ IDENTITY_PROVIDERS[p.slug] || p.slug }}</div>
              <div v-if="p.slug !== 'none' && p.slug !== 'questions'" class="tv-chips">
                <button v-for="[k, t] in ID_RESULTS" :key="k" type="button" class="chip-toggle" :class="{ on: p.result === k }"
                  @click="setIdentityResult(idDetail.l.name, p.slug, k)">{{ t }}</button>
              </div>
            </div>
            <div v-for="p in idDetail.outcome.providers.slice(idDetail.outcome.steps.length)" :key="'skip' + p.slug" class="tv-gate na">
              <div class="tv-gate__h">Respaldo · {{ p.label }}</div>
              <div class="tv-p tv-p--m">no se usa: ya validó uno antes</div>
            </div>
            <div class="tv-verdict" :class="idDetail.outcome.status === 'pass' ? 'ok' : 'no'">
              <template v-if="idDetail.outcome.status === 'pass'">Validada con {{ idDetail.outcome.by.label }}: sigue al plan de pagos.</template>
              <template v-else>Ningún proveedor validó: la solicitud no sigue.</template>
            </div>
          </template>
          <p class="tv-p tv-p--m">Dos atajos: si un administrador validó a la persona a mano en las últimas 24 horas, el paso se
            salta; y si el país del comercio no tiene centrales habilitadas, no se pide (los proveedores sólo conocen
            personas colombianas).</p>
        </div>

        <div v-else-if="planDetail" class="region-body tv-calc__b">
          <h3>¿Cuándo paga y cuánto?</h3>
          <p class="tv-p">El cliente elige el <b>día del mes</b> en que va a pagar y ve sus cuotas. <template v-if="planDetail.l.rt === 4">
            {{ planDetail.l.name }} ofrece los días de su ficha ({{ delegatedOf(planDetail.l).paymentDays.join(', ') }}): la primera
            fecha es ese día del mes que viene si faltan 30 días o más; si no, del siguiente.</template><template v-else>
            CreditopX ofrece el {{ CREDITOPX_PAYMENT_DAYS.join(', ') }}: sólo las fechas que caen entre 26 y 60 días después de mañana.</template></p>
          <template v-if="planDetail.plan">
            <div class="tv-sec">Primera fecha de pago</div>
            <div class="tv-chips">
              <button v-for="o in planDetail.opts" :key="o.label" type="button" class="chip-toggle" :class="{ on: o.label === planDetail.first.label }"
                @click="setPlan(planDetail.l.name, 'date', o.label)">{{ o.label }}</button>
            </div>
            <label class="tv-f tv-f--row"><span>Plazo</span>
              <select :value="planDetail.n" @change="e => setPlan(planDetail.l.name, 'n', Number(e.target.value))">
                <option v-for="n in planDetail.dues" :key="n" :value="n">{{ n }} cuotas</option></select></label>

            <div class="tv-sec">La cuota</div>
            <div class="tv-kv"><span>Capital del crédito</span><b>{{ money(planDetail.plan.breakdown.capital) }}</b></div>
            <div class="tv-kv"><span>Tasa mensual</span><b>{{ planDetail.c.row.rate ?? '—' }} %</b></div>
            <div class="tv-kv"><span>Cuota (capital + intereses + seguro)</span><b>{{ money(planDetail.plan.breakdown.cuota) }}</b></div>
            <template v-if="planDetail.l.rt === 4">
              <div class="tv-kv"><span>Días de más hasta la 1.ª fecha</span><b>{{ planDetail.plan.extraDays }} días</b></div>
              <div class="tv-kv"><span>Su interés</span><b>{{ money(planDetail.plan.extraInterest) }}</b></div>
              <p class="tv-p tv-p--m">Entre el desembolso (hoy) y la primera fecha pasan más de 30 días: esos días de más se cobran
                en la <b>{{ planDetail.plan.extraOn === 1 ? 'primera' : 'última' }}</b> cuota
                ({{ delegatedOf(planDetail.l).extraDaysInterest === 'last_installment' ? 'su ficha dice last_installment, como sus T&C' : 'la regla de Credifamilia' }}).</p>
            </template>

            <div class="tv-sec">Las cuotas</div>
            <template v-for="(r, i) in shownRows" :key="i">
              <div v-if="r" class="tv-kv" :class="{ 'tv-kv--hi': r.n === planDetail.plan.extraOn && planDetail.plan.extraInterest }">
                <span>#{{ r.n }} · {{ r.label }}</span><b>{{ money(r.amount) }}</b></div>
              <div v-else class="tv-p tv-p--m">…</div>
            </template>
            <div class="tv-total"><span>Total a pagar</span><b>{{ money(planDetail.plan.total) }}</b></div>
            <p class="tv-p tv-p--m">Aproximado: el plan real lo calcula el backend (con el 4×1000 y sus redondeos).</p>
          </template>
          <p v-else class="tv-p tv-p--m">{{ planDetail.l.rt === 0 || planDetail.l.rt === 1 ? 'El plan lo arma la entidad en su flujo.' : 'No hay plazos o fechas para armar el plan.' }}</p>
        </div>

        <div v-else-if="closeDetail" class="region-body tv-calc__b">
          <h3>¿Qué firma y cómo termina?</h3>
          <template v-if="closeDetail.l.rt === 0 || closeDetail.l.rt === 1">
            <p class="tv-p">{{ closeDetail.l.rt === 0 ? 'El redirect cierra en el sitio de la entidad: CreditOp no sella el resultado.' : 'El agregador: la entidad firma y decide en su flujo, y le informa el resultado a CreditOp.' }}</p>
          </template>
          <template v-else>
            <p class="tv-p">El cliente ve los documentos llenos con sus datos, los firma con un <b>código OTP</b> que le llega al celular, y
              con eso se <b>autoriza</b> el crédito: la solicitud pasa al estado <b>11</b> (terminal), toma número y se crea el crédito.</p>

            <div class="tv-sec">Qué firma</div>
            <p class="tv-p tv-p--m">Sale {{ closeDetail.sign.source }}<template v-if="closeDetail.cosigner"> (la categoría que ganó lleva
              codeudor: él también firma)</template>.</p>
            <div v-for="d in closeDetail.sign.docs" :key="d" class="tv-cond ok"><Check :size="11" /> {{ d }}</div>
            <div class="tv-kv"><span>Pagaré</span><b>{{ closeDetail.sign.deceval ? 'desmaterializado en Deceval' : 'firmado con los documentos' }}</b></div>

            <div class="tv-sec">La firma</div>
            <div class="tv-chips">
              <button type="button" class="chip-toggle" :class="{ on: closeDetail.signs }" @click="setSignatureOk(closeDetail.l.name, true)">firma con el OTP</button>
              <button type="button" class="chip-toggle" :class="{ on: !closeDetail.signs }" @click="setSignatureOk(closeDetail.l.name, false)">no firma</button>
            </div>

            <div class="tv-sec">Después de firmar</div>
            <div class="tv-kv"><span>Estado</span><b>{{ closeDetail.signs ? '11 · Autorizada' : 'no llega a 11' }}</b></div>
            <div v-if="closeDetail.formalization" class="tv-kv"><span>Formalización (riel 4)</span><b>{{ closeDetail.formalization }}</b></div>
            <div class="tv-kv"><span>Quién cobra el crédito</span><b>{{ closeDetail.sign.externallyServiced ? 'la entidad, en su sistema' : 'Creditop' }}</b></div>
            <p class="tv-p tv-p--m">Si la formalización falla, la autorización ya quedó: la solicitud está en 11, pero sin notificaciones ni
              comprobante, y repetir el OTP no lo arregla.</p>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.tv { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--ink); }
.tv-client { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--card); }
.tv-client__title { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--mut); font-weight: 600; align-self: center; margin-right: 4px; }
.tv-f { display: flex; flex-direction: column; gap: 2px; font-size: 10px; color: var(--mut); }
.tv-f input, .tv-f select { font-size: 12px; padding: 3px 6px; width: 120px; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }
.tv-f--s input { width: 64px; }
.tv-f--ro b { font-size: 12px; color: var(--ink); padding: 3px 0; }
.tv-f--ro em { font-style: normal; font-size: 9.5px; }
.tv-f--row { flex-direction: row; justify-content: space-between; align-items: center; margin: 4px 0; }
.tv-f--row input { width: 130px; }

.tv-body { flex: 1; min-height: 0; display: flex; }
.tv-scroll { flex: 1; min-width: 0; overflow: auto; padding: 14px 16px 24px; }
.tv-empty { color: var(--mut); font-size: 12px; padding: 24px; }
.tv-grid { display: grid; gap: 6px; align-items: stretch; }
.tv-corner { font-size: 11px; font-weight: 600; color: var(--fg-2); display: flex; flex-direction: column; justify-content: flex-end; padding: 4px 2px; }
.tv-corner small, .tv-colhead small, .tv-rowhead small { font-weight: 400; color: var(--mut); font-size: 10px; }
.tv-colhead { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--card); border: 1px solid var(--line); font-size: 12px; position: sticky; top: -14px; z-index: 1; }
.tv-colhead .lg__chip { align-self: flex-start; }
.tv-rowhead { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 8px 4px; font-size: 12px; }
.tv-rowhead--next { opacity: .6; }
.tv-n { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--card2); color: var(--fg-2); font-size: 10px; font-weight: 700; margin-bottom: 2px; }

.tv-cell { position: relative; display: grid; grid-template-columns: 18px 1fr; grid-template-rows: auto auto; gap: 2px 6px; align-items: start; text-align: left;
  padding: 9px 22px 9px 9px; min-height: 64px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; font: inherit; transition: border-color .12s, transform .12s; }
.tv-cell:hover:not(:disabled) { border-color: color-mix(in oklab, var(--ink) 35%, var(--line)); }
.tv-cell__ic { grid-row: 1 / 3; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; }
.tv-cell__t { font-size: 12px; font-weight: 600; }
.tv-cell__l { grid-column: 2; font-size: 10.5px; line-height: 1.35; color: var(--fg-2); }
.tv-cell__go { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); color: var(--mut); }
.tv-cell--pass { background: var(--tint-green); border-color: var(--bd-green); }
.tv-cell--pass .tv-cell__ic { background: var(--green); color: var(--badge-fg); }
.tv-cell--fail { background: var(--tint-red); border-color: color-mix(in oklab, var(--red) 40%, var(--card)); }
.tv-cell--fail .tv-cell__ic { background: var(--red); color: var(--badge-fg); }
.tv-cell--warn { background: var(--tint-amber); border-color: color-mix(in oklab, var(--amber) 40%, var(--card)); }
.tv-cell--warn .tv-cell__ic { background: var(--amber); color: var(--badge-fg); }
.tv-cell--na .tv-cell__ic { background: var(--card2); color: var(--mut); }
.tv-cell--off { opacity: .4; cursor: default; background: transparent; border-style: dashed; }
.tv-cell--off .tv-cell__ic { color: var(--mut); }
.tv-cell--open { outline: 2px solid var(--ink); outline-offset: 1px; }
.tv-cell--next { min-height: 40px; cursor: default; background: transparent; border-style: dashed; border-color: color-mix(in oklab, var(--ink) 22%, transparent); }

.tv-calc { width: 340px; flex: none; }
.tv-calc__h { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; }
.tv-calc__b { overflow: auto; padding: 12px 14px 20px; font-size: 12px; }
.tv-calc__b h3 { margin: 0 0 6px; font-size: 14px; }
.tv-p { font-size: 11.5px; line-height: 1.45; color: var(--fg-2); margin: 0 0 10px; }
.tv-p--m { font-size: 10.5px; color: var(--mut); margin: 4px 0; }
.tv-sec { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--mut); font-weight: 600; margin: 14px 0 6px; }
.tv-gate { border: 1px solid var(--line); border-left-width: 3px; border-radius: 5px; padding: 7px 9px; margin-bottom: 8px; background: var(--card); }
.tv-gate.ok { border-left-color: var(--green); } .tv-gate.no { border-left-color: var(--red); } .tv-gate.na { border-left-color: var(--line); }
.tv-gate__h { display: flex; align-items: center; gap: 5px; font-weight: 600; font-size: 11.5px; margin-bottom: 4px; }
.tv-kv { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; padding: 2px 0; }
.tv-kv span { color: var(--fg-2); }
.tv-kv b { text-align: right; font-weight: 600; }
.tv-kv em { font-style: normal; font-weight: 400; color: var(--mut); }
.tv-why { font-size: 10.5px; color: var(--red); margin-top: 3px; }
.tv-group { border-top: 1px dashed var(--line); padding: 4px 0 2px; }
.tv-group:first-of-type { border-top: 0; }
.tv-cond { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 0; }
.tv-cond.ok { color: var(--green); } .tv-cond.no { color: var(--red); }
.tv-cond em { font-style: normal; color: var(--mut); }
.tv-catrow { display: flex; flex-direction: column; padding: 5px 8px; border-radius: 4px; margin-bottom: 3px; border: 1px solid var(--line); font-size: 11px; }
.tv-catrow.won { background: var(--tint-green); border-color: var(--bd-green); font-weight: 600; }
.tv-catrow.no { opacity: .6; }
.tv-catrow__s { font-size: 10px; color: var(--fg-2); font-weight: 400; }
.tv-chips { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin-bottom: 6px; }
.tv-verdict { margin-top: 12px; padding: 8px 10px; border-radius: 5px; font-size: 12px; }
.tv-verdict.ok { background: var(--tint-green); } .tv-verdict.no { background: var(--tint-red); }
.tv-kv--hi { background: var(--tint-amber); border-radius: 3px; padding: 2px 4px; margin: 0 -4px; }
.tv-total { display: flex; justify-content: space-between; margin-top: 8px; padding: 8px 10px; border-radius: 5px; background: var(--card2); font-size: 12.5px; }
.tv-total b { font-size: 14px; }
</style>
