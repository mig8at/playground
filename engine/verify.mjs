import { evalSheet, evalPolicy } from './src/engine.js'
import { SHEET, PRESETS, POLICIES, withPeriods, defaultInputs } from './reference/full-sheet.js'

// Una hoja, N configuraciones. Cada punto de control viene del archivo fuente del producto.
let fails = 0, n = 0
const chk = (l, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) / Math.max(1, Math.abs(want)) < tol
  if (!ok) fails++; n++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l.padEnd(20)} ${String(got).padEnd(24)} fuente=${want}`)
}
const run = (key, over = {}) => {
  const p = PRESETS[key]
  const sheet = withPeriods(SHEET, p.periods)
  return evalSheet(sheet, { ...defaultInputs(SHEET), ...p.values, ...over }).res
}

const CASOS = {
  'motai-rto · Calculadora Renting VF.xlsx, pestaña Rent to Own': ['motai-rto', {}, {
    principal: 10790920, periodRate: 0.00412539027496773619, installment: 127814.61912543373 }],
  'motai-rto · 12 meses (C16)': ['motai-rto', { installments: 52 }, { installment: 230997.39188763683 }],
  'motai-rto · 18 meses (C17)': ['motai-rto', { installments: 78 }, { installment: 162077.89506091646 }],
  'salud Gaes · Calculadora PV V20251009.xlsm': ['salud-gaes', {}, {
    guaranteeCost: 1071930.081573879, totalGuarantee: 1280699.1842612077,
    financedAmount: 12000000, periodRate: 0.020897637252162315,
    installment: 477607.784682629, lifeInsurance: 15684 }],
  'salud Dentix · el otro .xlsm, fianza mensualizada': ['salud-dentix', {}, {
    guaranteeCost: 405000, totalGuarantee: 483877.8, financedAmount: 4500000,
    installment: 806916.701885247, monthlyGuarantee: 80646.3, lifeInsurance: 5881.5 }],
  'alta moto · Creditop-ALTA FLEET.pdf punto 9': ['alta-moto', {}, {
    guaranteeCost: 875350.56, financedAmount: 9955750.56, installment: 656503.3594365537,
    lifeInsurance: 13938.050784, totalInstallment: 690441.4102205536 }],
  'alta poliza · misma hoja, 2ª corrida': ['alta-poliza', {}, {
    financedAmount: 673000, installment: 74414.05752329578 }],
  'generico · 10.000.000 al 2% mensual': ['generico', {}, {
    financedAmount: 10000000, installment: 528710.9725324993 }],
}

for (const [titulo, [key, over, esperado]] of Object.entries(CASOS)) {
  console.log('\n=== ' + titulo)
  const res = run(key, over)
  for (const [k, want] of Object.entries(esperado)) {
    chk(k, res[k]?.status === 'ok' ? res[k].value : NaN, want, 1e-7)
  }
}

console.log('\n=== la serie cierra en cero')
for (const key of ['motai-rto', 'salud-gaes', 'alta-moto', 'generico']) {
  const p = PRESETS[key]
  const s = evalSheet(withPeriods(SHEET, p.periods), { ...defaultInputs(SHEET), ...p.values }).series
  const last = s.rows[s.rows.length - 1]
  const ok = Math.abs(last.closingBalance) < 1e-6
  if (!ok) fails++; n++
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${key.padEnd(14)} ${s.rows.length} filas · saldo final ${last.closingBalance.toFixed(6)}`)
}

console.log('\n=== politica (aparcada, pero viva): el mismo señor, tres plazos de motai-rto')
for (const [meses, cuotas] of [[12, 52], [18, 78], [24, 104]]) {
  const canon = run('motai-rto', { installments: cuotas }).totalInstallment.value
  const v = evalPolicy(POLICIES.motai, { weeklyRent: canon, monthlyIncome: 3200000, creditScore: 520 })
  console.log(`  ${meses}m  canon ${canon.toFixed(0).padStart(7)}  -> ${String(v.outcome).padEnd(14)} ${v.firedRule || ''} ${v.explanation || ''}`)
}

console.log('\n' + (fails ? `>>> ${fails}/${n} FALLAN` : `>>> ${n}/${n} — UNA hoja reproduce los 4 productos`))
