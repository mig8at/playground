// UNA hoja paramétrica + las configuraciones de cada producto.
//
// ═══ POR QUÉ UNA SOLA HOJA ═══
// Antes había cuatro hojas con cuatro juegos de fórmulas — una por producto. Eso es el mismo
// problema de "CreditOp no escala" mudado de PHP a JSON: si el servicio sale así, movimos el
// hardcode de lugar. El objetivo es lo contrario: **una fórmula, N configuraciones**.
//
// Y el código real YA está normalizado así. Mirá la firma de
// `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService::performCalculation`:
//
//   amount · original_amount · rate · fee_number · is_biweekly ·
//   administrative_costs_percentage · administrative_fixed_value ·
//   guarantee_fund_percentage · life_insurance_percentage · life_insurance_fixed ·
//   insurance_fixed_monthly_percentage · guarantee_fixed_monthly_percentage · …
//
// Eso es UNA función con ~15 perillas, no una por lender. Esta hoja espeja esa forma.
//
// VERIFICADO: la hoja reproduce los cuatro productos reales — 23 puntos de control exactos
// contra los .xlsm y el PDF. Ver docs/VERIFICACION.md y `node verify.mjs`.
//
// ═══ CONVENCIONES ═══
//   · nombres en inglés, camelCase · tasas en DECIMAL (0.19, no 19) · todo positivo
//   · claves de tabla numéricas, el texto solo en `label`
//   · `if()` solo para SELECCIÓN DE PARÁMETRO (elegir entre dos fórmulas de tasa), nunca
//     para lógica de negocio
//
// ═══ LA TASA ═══
// En CreditOp conviven DOS convenciones y dan distinto (ver F-71 en findings):
//   nominal    periodRate = statedRate * statedPerYear / periodsPerYear
//   efectiva   periodRate = (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1
// El canon de la plataforma es NOMINAL (`credit_line_by_lenders.rate_suffix` = "N.M." en
// las 157 filas). Los .xlsm capitalizan. Por eso `compound` es una perilla de la config,
// no una decisión de la hoja.

/** Cuántos períodos de cada clase caben en un año. Una sola fuente: reemplaza a la sopa de
 *  constantes (weeksPerYear, monthsPerYear, daysPerMonth…) que eran la MISMA pregunta.
 *  La diaria usa 360 — convención comercial, no calendario. */
export const PERIODS = {
  anual: 1, semestral: 2, trimestral: 4, bimestral: 6,
  mensual: 12, quincenal: 24, semanal: 52, diaria: 360,
}

/** Derivadas de los selects de período: no se listan como constantes editables. */
export const DERIVED_PERIOD_CONSTANTS = ['statedPerYear', 'periodsPerYear']

const money = (name, label) => ({ name, type: 'money', label, default: 0, min: 0 })
const rate = (name, label) => ({ name, type: 'rate', label, default: 0 })
const count = (name, label, def) => ({ name, type: 'count', label, default: def, min: 0 })
const bool = (name, label, def) => ({ name, type: 'bool', label, default: def })

export const SHEET = {
  label: 'Hoja estándar',
  note: 'Una sola hoja para todos los productos. Lo que cambia son los VALORES, no las fórmulas.',
  periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },

  constants: {},

  inputs: [
    money('assetCost', 'Monto base / costo del bien'),
    money('downPayment', 'Cuota inicial — positiva, la fórmula la resta'),
    money('setupFee', 'Alistamiento / costos administrativos fijos'),
    money('extras', 'Extras y accesorios'),
    rate('marginFactor', 'Margen — 1 = duplica la base, 0 = sin margen'),
    rate('priceVatRate', 'IVA sobre el precio'),
    money('deviceCost', 'Dispositivo que se financia aparte (GPS…)'),
    rate('guaranteeRate', 'Fianza / fondo de garantía'),
    rate('guaranteeVatRate', 'IVA sobre la fianza — 0 si la tarifa ya lo incluye'),
    rate('transactionTaxRate', '4×1000 sobre la fianza'),
    bool('guaranteeUpfront', 'Fianza anticipada (si no, se mensualiza)', true),
    rate('statedRate', 'Tasa, en el período declarado arriba'),
    bool('compound', 'Tasa efectiva (capitaliza). No = nominal, divide', true),
    count('installments', 'Número de cuotas', 24),
    rate('lifeInsuranceRate', 'Seguro de vida — factor por peso financiado'),
    money('lifeInsuranceFixed', 'Seguro de vida — parte fija'),
    money('monthlyFixed', 'Cargos fijos por cuota (canon GPS…)'),
  ],

  /** Solo presentación: agrupa los 17 inputs para que el nodo sea legible. */
  inputGroups: {
    'monto': ['assetCost', 'downPayment', 'setupFee', 'extras', 'deviceCost'],
    'precio': ['marginFactor', 'priceVatRate'],
    'fianza': ['guaranteeRate', 'guaranteeVatRate', 'transactionTaxRate', 'guaranteeUpfront'],
    'plazo': ['installments'],
    'cargos por cuota': ['lifeInsuranceRate', 'lifeInsuranceFixed', 'monthlyFixed'],
  },

  formulas: {
    marginBase: 'assetCost - downPayment + setupFee',
    margin: 'marginBase * marginFactor',
    taxableBase: 'marginBase + margin + extras',
    priceVat: 'taxableBase * priceVatRate',
    principal: 'taxableBase + priceVat',

    guaranteeBase: 'principal + deviceCost',
    guaranteeCost: 'guaranteeBase * guaranteeRate',
    guaranteeVat: 'guaranteeCost * guaranteeVatRate',
    guaranteeTax: '(guaranteeCost + guaranteeVat) * transactionTaxRate',
    totalGuarantee: 'guaranteeCost + guaranteeVat + guaranteeTax',

    financedAmount: 'principal + deviceCost + totalGuarantee * guaranteeUpfront',

    // `if()` como selección de parámetro entre las dos convenciones — no es lógica de negocio
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',

    installment: 'pmt(periodRate, installments, financedAmount)',
    lifeInsurance: 'financedAmount * lifeInsuranceRate + lifeInsuranceFixed',
    monthlyGuarantee: 'totalGuarantee * (1 - guaranteeUpfront) / installments',
    totalInstallment: 'installment + lifeInsurance + monthlyGuarantee + monthlyFixed',
    totalPaid: 'totalInstallment * installments',
    totalInterest: 'totalPaid - financedAmount',
  },

  groups: {
    'Precio': ['marginBase', 'margin', 'taxableBase', 'priceVat', 'principal'],
    'Fianza': ['guaranteeBase', 'guaranteeCost', 'guaranteeVat', 'guaranteeTax', 'totalGuarantee'],
    'Valor a financiar': ['financedAmount'],
    'Tasa': ['periodRate', 'annualEffectiveRate'],
    'Cuota': ['installment', 'lifeInsurance', 'monthlyGuarantee', 'totalInstallment'],
    'Total': ['totalPaid', 'totalInterest'],
  },

  series: {
    name: 'plan', n: 'installments',
    rows: {
      openingBalance: 'if(i == 1, financedAmount, prev.closingBalance)',
      interest: 'openingBalance * periodRate',
      principal: 'installment - interest',
      payment: 'totalInstallment',
      closingBalance: 'openingBalance - principal',
    },
  },

  output: 'totalInstallment',
}

/** Todo en cero: la base sobre la que cada producto pone solo lo suyo. */
const ZERO = Object.fromEntries(SHEET.inputs.map(i => [i.name, i.default]))

/* ═══════════════════════════════════════════════════════════════════════════════════════
   CONFIGURACIONES · lo único que cambia entre productos son estos valores.
   Cada una está verificada contra su archivo fuente (ver docs/VERIFICACION.md).
   ═══════════════════════════════════════════════════════════════════════════════════════ */
export const PRESETS = {
  'generico': {
    label: 'Genérico · 10.000.000 al 2% mensual',
    note: 'Sin costos asociados: solo monto, tasa y cuotas.',
    periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },
    values: { ...ZERO, assetCost: 10000000, statedRate: 0.02, installments: 24 },
  },

  'motai-rto': {
    label: 'Motai · Rent to Own, 24 meses',
    note: 'Fuente: Calculadora Renting VF.xlsx, pestaña Rent to Own. El PRD lo llama '
      + '"un crédito disfrazado de arriendo". Tasa EFECTIVA (el .xlsx capitaliza) — ojo que '
      + 'el lender 170 guarda 1.82 N.M. en la tabla: misma trampa que Credifamilia (F-71).',
    legalNature: 'crédito',
    periods: { rateStatedIn: 'mensual', chargedEvery: 'semanal' },
    values: { ...ZERO, assetCost: 4534000, downPayment: 2000000, setupFee: 1500000,
      marginFactor: 1, extras: 1000000, priceVatRate: 0.19, statedRate: 0.018, installments: 104 },
  },

  'salud-gaes': {
    label: 'CreditopX salud · Gaes, 36 meses, fianza anticipada',
    note: 'Fuente: Calculadora PV V20251009.xlsm. La misma hoja sirve a Sonria, Dentix y Gaes: '
      + 'lo único que cambia es la tarifa de fianza.',
    legalNature: 'crédito',
    periods: { rateStatedIn: 'anual', chargedEvery: 'mensual' },
    values: { ...ZERO, assetCost: 10719300.815738792, guaranteeRate: 0.10, guaranteeVatRate: 0.19,
      transactionTaxRate: 0.004, statedRate: 0.2817, installments: 36, lifeInsuranceRate: 0.001307 },
  },

  'salud-dentix': {
    label: 'CreditopX salud · Dentix, 6 meses, fianza mensualizada',
    note: 'Mismo producto que Gaes con otros valores — y con la fianza MENSUALIZADA en vez de '
      + 'anticipada, que en la hoja es solo `guaranteeUpfront = no`.',
    legalNature: 'crédito',
    periods: { rateStatedIn: 'anual', chargedEvery: 'mensual' },
    values: { ...ZERO, assetCost: 4500000, guaranteeRate: 0.09, guaranteeVatRate: 0.19,
      transactionTaxRate: 0.004, guaranteeUpfront: false, statedRate: 0.2879, installments: 6,
      lifeInsuranceRate: 0.001307 },
  },

  'alta-moto': {
    label: 'Alta Fleet · crédito de la moto, 18 cuotas',
    note: 'Fuente: Creditop-ALTA FLEET.pdf, punto 9. Tasa NOMINAL (`compound = no`), que es el '
      + 'canon N.M. de la plataforma. El 9,64% de Novafianza ya trae IVA y FNG adentro, por eso '
      + '`guaranteeVatRate = 0`. Los 20.000 del canon GPS van en `monthlyFixed`.',
    legalNature: 'crédito',
    periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },
    values: { ...ZERO, assetCost: 8485400, deviceCost: 595000, guaranteeRate: 0.0964,
      statedRate: 0.0187, installments: 18, compound: false, lifeInsuranceRate: 0.0014,
      monthlyFixed: 20000 },
  },

  'alta-poliza': {
    label: 'Alta Fleet · crédito de la póliza, 10 cuotas',
    note: 'La MISMA hoja, segunda corrida. Una operación del cliente = dos créditos en el core, '
      + 'con plazos distintos (18 y 10) — y por eso la cuota baja en el mes 11. No es un caso '
      + 'especial de la hoja: son dos evaluaciones.',
    legalNature: 'crédito',
    periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },
    values: { ...ZERO, assetCost: 673000, statedRate: 0.0187, installments: 10, compound: false },
  },
}

/** Motai Renting NO entra en la hoja, y no es una limitación técnica.
 *  Sin opción de compra el cliente nunca es dueño: no hay saldo, no hay interés, no es
 *  crédito, y no le aplica el techo de usura. Su "tasa" del 1,8% es un PARÁMETRO DE PRECIO
 *  (el .xlsx la lista como "Parámetro", no como tasa): amortiza el precio de venta a 24 meses
 *  y prorratea ÷30 ×7 para fijar una tarifa. No hay `installments`, no hay amortización, no
 *  hay E.A. Meterlo acá a la fuerza con perillas en cero sería fingir que es un crédito.
 *  Detalle completo en el nodo `motai` del contexto. */
export const NO_NORMALIZABLE = {
  'motai-renting': 'Arrendamiento operativo: no amortiza, no tiene tasa. Es un precio, no un crédito.',
}

/* ═══════════ Política · aparcada ═══════════
   Sigue acá porque `verify.mjs` la ejercita, pero fuera de la UI: el foco está en la entrada
   y el cálculo. Diseño completo en docs/POLITICA-Y-CALCULO.md. */
export const POLICIES = {
  motai: {
    label: 'Motai · política de riesgo',
    appliesTo: ['motai-rto'],
    constants: {
      minCreditScore: 400, minWeeklyRent: 150000, maxWeeklyRent: 300000,
      maxIncomeShare: 0.25, weeksPerYear: 52, monthsPerYear: 12,
      directApprovalIncome: 3000000, coSignerIncome: 2900000,
    },
    inputs: [
      { name: 'weeklyRent', type: 'money', label: 'Canon semanal', from: 'hoja' },
      { name: 'monthlyIncome', type: 'money', label: 'Ingreso mensual', default: 3200000 },
      { name: 'creditScore', type: 'count', label: 'Score Datacrédito', default: 520 },
    ],
    derived: {
      weeklyIncome: 'monthlyIncome * monthsPerYear / weeksPerYear',
      incomeShare: 'weeklyRent / weeklyIncome',
      incomeSharePct: 'incomeShare * 100',
      maxIncomeSharePct: 'maxIncomeShare * 100',
    },
    gate: {
      mode: 'all',
      rules: [
        { id: 'R3', label: 'Score mínimo', test: 'creditScore >= minCreditScore',
          fail: 'Score {creditScore}, por debajo del mínimo de {minCreditScore}.' },
        { id: 'R4', label: 'Canon mínimo', test: 'weeklyRent >= minWeeklyRent',
          fail: 'El canon de {weeklyRent} no llega al mínimo de {minWeeklyRent}.' },
        { id: 'R5', label: 'Canon máximo', test: 'weeklyRent <= maxWeeklyRent',
          fail: 'El canon de {weeklyRent} supera el máximo de {maxWeeklyRent}.' },
        { id: 'R6', label: 'Cuota vs ingreso', test: 'incomeShare <= maxIncomeShare',
          fail: 'El canon se lleva el {incomeSharePct|1}% del ingreso semanal ({weeklyIncome});'
            + ' el tope es {maxIncomeSharePct|0}%.' },
      ],
    },
    outcome: {
      mode: 'first',
      branches: [
        { when: 'monthlyIncome >= directApprovalIncome', then: 'aprobado', label: 'Ingreso ≥ 3.000.000' },
        { when: 'monthlyIncome < coSignerIncome', then: 'condicional', label: 'Ingreso < 2.900.000 → codeudor' },
        { when: 'true', then: 'revision_manual', label: 'Banda 2.900.000 – 2.999.999',
          note: 'El PRD no cubre esta banda. Se manda a revisión en vez de dejarla caer en silencio.' },
      ],
    },
  },
}

/** Resuelve los períodos declarados a números y los deja como constantes. */
export function withPeriods(def, override = {}) {
  const p = { ...(def.periods || {}), ...override }
  const c = {}
  if (p.rateStatedIn) c.statedPerYear = PERIODS[p.rateStatedIn]
  if (p.chargedEvery) c.periodsPerYear = PERIODS[p.chargedEvery]
  return { ...def, constants: { ...def.constants, ...c } }
}

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
