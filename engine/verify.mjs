import { evalSheet, evalPolicy } from './src/engine.js'
import { SHEETS, POLICIES, defaultInputs, withPeriods } from './src/sheets.js'
let fails = 0
const chk = (l, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) / Math.max(1, Math.abs(want)) < tol
  if (!ok) fails++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l.padEnd(30)} ${String(got).padEnd(23)} xlsm=${want}`)
}
const G = (slug, over, key) => {
  const d = withPeriods(SHEETS[slug]), r = evalSheet(d, { ...defaultInputs(d), ...over }).res[key]
  return r && r.status === 'ok' ? r.value : NaN
}

console.log('=== motai-rto · las tres cuotas (C16/C17/C18)')
for (const [m, n, w] of [[12,52,230997.39188763683],[18,78,162077.89506091646],[24,104,127814.61912543373]]) {
  chk(`${m}m -> termPeriods`, G('motai-rto',{termMonths:m},'termPeriods'), n)
  chk(`${m}m -> weeklyRent`, G('motai-rto',{termMonths:m},'weeklyRent'), w)
}
console.log('\n=== motai-renting · los tres planes (C13/C14/C15)')
for (const [w, want] of [[1,216470.43167903228],[4,173176.3453432258],[12,162785.76462263224]])
  chk(`plan ${w} sem`, G('motai-renting',{planDurationWeeks:w},'weeklyRent'), want)
chk('salePrice', G('motai-renting',{},'salePrice'), 14360920)

console.log('\n=== creditopx-salud · Gaes 36m / 10% / anticipada')
for (const [k,w] of [['periodRate',0.020897637252162315],['dailyRate',0.0006896469242549941],
  ['guaranteeCost',1071930.081573879],['totalGuarantee',1280699.1842612077],['disbursedAmount',12000000],
  ['installment',477607.784682629],['lifeInsurance',15684],['firstPeriodInterest',74481.86781953936],
  ['firstInstallment',567773.6525021683]]) chk(k, G('creditopx-salud',{},k), w)

console.log('\n=== creditopx-salud · Dentix 6m / 9% / mensual')
const d2 = {merchantId:142, requestedAmount:4500000, termMonths:6, statedRate:0.2879,
  guaranteePaidUpfront:false, firstPeriodDays:20}
for (const [k,w] of [['periodRate',0.02130826215],['guaranteeRate',0.09],['guaranteeCost',405000],['totalGuarantee',483877.8],
  ['disbursedAmount',4500000],['installment',806916.7019],['lifeInsurance',5881.5],
  ['monthlyGuarantee',80646.3],['firstInstallment',956719.981]]) chk(k, G('creditopx-salud',d2,k), w, 1e-7)

console.log('\n=== alta-fleet · punto 9 del PDF')
for (const [k,w] of [['guaranteeCost',875351],['financedAmount',9955751],['installment',656503],
  ['lifeInsurance',13938],['vehicleInstallment',690441],['insuranceInstallment',74414]])
  chk(k, G('alta-fleet',{},k), w, 1e-5)

console.log('\n=== series')
for (const s of ['motai-rto','creditopx-salud','alta-fleet']) {
  const d = withPeriods(SHEETS[s]), o = evalSheet(d, defaultInputs(d)).series
  const last = o.rows[o.rows.length-1]
  console.log(`  ${s.padEnd(17)} ${String(o.rows.length).padStart(3)} filas` +
    (o.error?'  ERR '+o.error:'') +
    (last.closingBalance!=null ? `  saldo final=${last.closingBalance.toFixed(2)}` : '') +
    (last.totalPayment!=null ? `  ult.pago=${last.totalPayment.toFixed(0)} (mes 1=${o.rows[0].totalPayment.toFixed(0)})` : ''))
}

console.log('\n=== politica motai · el mismo señor, tres plazos')
for (const m of [12,18,24]) {
  const rent = G('motai-rto',{termMonths:m},'weeklyRent')
  const v = evalPolicy(POLICIES.motai, {weeklyRent:rent, monthlyIncome:3200000, creditScore:520})
  console.log(`  ${m}m  canon ${rent.toFixed(0).padStart(7)}  -> ${String(v.outcome).padEnd(14)} ${v.firedRule||''} ${v.explanation||''}`)
}
console.log('\n' + (fails ? `>>> ${fails} FALLAS` : '>>> TODO CUADRA'))
