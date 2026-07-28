// Las cuatro hojas reales + la política de Motai.
//
// Convenciones (ver docs/DICCIONARIO.md):
//   · nombres en inglés, camelCase
//   · TASAS EN DECIMAL: 0.19, no 19. Así lo escriben los .xlsm originales y así se le pasan
//     derecho a pmt() — desaparece el /100 de todas las fórmulas.
//   · sin signos invertidos: downPayment entra POSITIVO y la fórmula lo resta
//     (el Excel lo pide en negativo, que es una trampa).
//   · las claves de tabla son NÚMEROS; el texto solo vive en `label`, para mostrar.
//
// Los números están verificados contra los archivos fuente — ver docs/VERIFICACION.md.
//
// ── LA TASA ──────────────────────────────────────────────────────────────────────────
// Cada hoja declara `rateConvention`, porque en CreditOp conviven DOS y dan distinto:
//
//   nominal    periodRate = statedRate * statedPerYear / periodsPerYear
//   effective  periodRate = (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1
//
// Mismos dos parámetros; solo cambia × por ^. `statedPerYear` = en qué período lo dice el
// negocio; `periodsPerYear` = en qué período se cobra.
//
// El CANON de la plataforma es NOMINAL: `credit_line_by_lenders.rate_suffix` = "N.M."
// en las 157 filas, y Modules/Loans hace rate/100, rate/200, rate/30 — división, que para
// una tasa nominal es lo correcto.
//
// Estas hojas salen de los .xlsm, que capitalizan (`effective`). Esa discrepancia YA pegó
// en producción: ver F-71 en context/server/data/flows/findings/doc.md (CORE-127).

/** Cuántos períodos de cada clase caben en un año. Reemplaza a la sopa de constantes
 *  (weeksPerYear, monthsPerYear, daysPerMonth…): eran todas la MISMA pregunta.
 *  La diaria usa 360 — convención comercial, no calendario. */
export const PERIODS = {
  anual: 1, semestral: 2, trimestral: 4, bimestral: 6,
  mensual: 12, quincenal: 24, semanal: 52, diaria: 360,
}

export const SHEETS = {

  /* ═══════════ Simulador básico ═══════════
     La hoja MÍNIMA: sin IVA, sin seguros, sin fianza, sin margen. Nada de CreditOp.
     Solo la mecánica: monto + tasa + nº de cuotas + cada cuánto se paga → cuota.

     Fijate que no necesita `termIn`: si decís "24 cuotas" directamente, no hay que traducir
     ningún plazo. `termIn` solo existe cuando el negocio dice el plazo en meses pero cobra
     en otro período (el caso de Motai). Acá el nº de cuotas ES n. */
  'simulador': {
    label: 'Simulador básico · sin lógica de negocio',
    note: 'Lo mínimo que hace falta para sacar una cuota. Cambiá la periodicidad y mirá cómo se mueve todo.',
    realWorldCharge: null,
    rateConvention: 'effective',
    periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },

    constants: {},
    inputs: [
      { name: 'amount', type: 'money', label: 'Monto a financiar', default: 10000000, min: 0 },
      { name: 'statedRate', type: 'rate', label: 'Tasa (en el período de arriba)', default: 0.02 },
      { name: 'installments', type: 'count', label: 'Número de cuotas', default: 24,
        enum: [6, 12, 18, 24, 36, 48, 60] },
    ],
    formulas: {
      periodRate: '(1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1',
      annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',
      installment: 'pmt(periodRate, installments, amount)',
      totalPaid: 'installment * installments',
      totalInterest: 'totalPaid - amount',
    },
    groups: {
      'Tasa': ['periodRate', 'annualEffectiveRate'],
      'Cuota': ['installment'],
      'Lo que se paga en total': ['totalPaid', 'totalInterest'],
    },
    output: 'installment',
  },

  /* ═══════════ Motai · Renting puro ═══════════
     Fuente: "Calculadora Renting VF.xlsx", pestaña Renting + motai-manu.pdf.

     ⚠ POR QUÉ ACÁ NO HAY TASA — y no es un detalle técnico, es la estructura legal.
     Sin opción de compra el cliente NUNCA es dueño: paga por USAR la moto y al final la
     devuelve. No hay capital que amortizar, así que no hay interés — y sin interés no es
     un crédito, y sin crédito no aplica el techo de usura.

     Por eso el `anchorRate` NO se llama `monthlyRate`: el doc de Manuela lo lista como
     "Tasa mensual 1,8% · **Parámetro**", mientras que en la hoja de RTO la misma cifra
     dice "Equivale a ~0,4125% semanal". El documento ya las trata distinto. Acá el 1,8%
     solo sirve para FIJAR UN PRECIO (amortizar el precio de venta a 24 meses y prorratear
     ÷30 ×7); llamarlo tasa invita a que alguien lo "corrija" a una conversión compuesta y
     con eso convierta el arriendo en un crédito.

     Es la razón de fondo del +1,11% contra RTO que veníamos anotando como pregunta: no es
     una conversión mal hecha, es que acá no hay nada que convertir. */
  'motai-renting': {
    label: 'Motai · Renting puro',
    legalNature: 'arrendamiento operativo',   // El cliente devuelve la moto. Sin interés → no es crédito → no aplica usura.
    note: 'Arriendo sin opción de compra. No hay saldo que amortizar: el PMT a 24 meses es un ancla de precio.',
    realWorldCharge: 'semanal',   // el motor no amortiza acá: prorratea ÷30 ×7
    rateConvention: null,   // no amortiza: no hay saldo, no hay tasa de período ni E.A.
    periods: { chargedEvery: 'semanal' },   // solo para rotular: acá el prorrateo es ÷30 ×7

    constants: {
      setupFee: 1500000, marginFactor: 1, vatRate: 0.19,
      anchorRate: 0.018,   // NO es una tasa de interés: es el parámetro que fija el precio
      anchorTermMonths: 24, daysPerWeek: 7, daysPerMonth: 30,
    },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Costo contable de la moto', default: 4534000, min: 0 },
      { name: 'planDurationWeeks', type: 'count', label: 'Duración del arriendo (semanas) — el cobro es SIEMPRE semanal', default: 4, enum: [1, 4, 12] },
    ],
    tables: {
      rentalPlans: {
        key: 'planDurationWeeks',
        rows: [
          { planDurationWeeks: 1, factor: 1.25, label: '1 sem' },
          { planDurationWeeks: 4, factor: 1.00, label: '1 mes' },
          { planDurationWeeks: 12, factor: 0.94, label: '1 trim' },
        ],
      },
    },
    formulas: {
      baseCost: 'assetCost + setupFee',
      margin: 'baseCost * marginFactor',
      vatAmount: '(baseCost + margin) * vatRate',
      salePrice: 'baseCost + margin + vatAmount',
      anchorPayment: 'pmt(anchorRate, anchorTermMonths, salePrice)',
      weekMonthRatio: 'daysPerWeek / daysPerMonth',
      baseWeeklyRent: 'anchorPayment * weekMonthRatio',
      planFactor: 'lookup(rentalPlans, planDurationWeeks, "factor")',
      weeklyRent: 'baseWeeklyRent * planFactor',
      planTotal: 'weeklyRent * planDurationWeeks',
    },
    groups: {
      'Precio de venta': ['baseCost', 'margin', 'vatAmount', 'salePrice'],
      'Tarifa base': ['anchorPayment', 'weekMonthRatio', 'baseWeeklyRent'],
      'Plan elegido': ['planFactor', 'weeklyRent', 'planTotal'],
    },
    series: {
      name: 'planPago', n: 'planDurationWeeks',
      rows: {
        rent: 'weeklyRent',
        cumulative: 'if(i == 1, weeklyRent, prev.cumulative + weeklyRent)',
      },
    },
    output: 'weeklyRent',
  },

  /* ═══════════ Motai · Rent to Own ═══════════
     Fuente: "Calculadora Renting VF.xlsx", pestaña Rent to Own.
     Acá SÍ hay saldo: convierte la tasa a semanal (compuesta) y amortiza en semanas.
     La columna "Semanas" del documento de Manuela dice 12/18/24 pero son MESES;
     los montos solo cuadran con 52/78/104. */
  'motai-rto': {
    label: 'Motai · Rent to Own',
    legalNature: 'crédito',   // Con opción de compra. El doc de Manuela: "esencialmente un crédito disfrazado de arriendo".
    note: 'Arriendo con opción de compra: es un crédito. Hay saldo, se amortiza semanal.',
    realWorldCharge: 'semanal',
    // El .xlsx hace (1+C12)^0,230769-1 → capitaliza. Pero el lender 170 "Motai RB" guarda
    // 1.82 N.M. en la tabla: misma trampa que Credifamilia (F-71).
    rateConvention: 'effective',
    // Los tres períodos, declarados en vez de cableados como números
    periods: { rateStatedIn: 'mensual', chargedEvery: 'semanal', termIn: 'mensual' },

    constants: {
      setupFee: 1500000, marginFactor: 1, vatRate: 0.19,
      statedRate: 0.018,
    },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Costo contable de la moto', default: 4534000, min: 0 },
      { name: 'downPayment', type: 'money', label: 'Cuota inicial', default: 2000000, min: 0 },
      { name: 'extras', type: 'money', label: 'Extras / accesorios', default: 1000000, min: 0 },
      { name: 'termMonths', type: 'count', label: 'Plazo (meses) — el cobro es semanal', default: 24, enum: [12, 18, 24] },
    ],
    formulas: {
      marginBase: 'assetCost - downPayment + setupFee',
      margin: 'marginBase * marginFactor',
      taxableBase: 'marginBase + margin + extras',
      vatAmount: 'taxableBase * vatRate',
      financedAmount: 'taxableBase + vatAmount',
      periodRate: '(1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1',
      annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',
      termPeriods: 'termMonths * periodsPerYear / termPerYear',
      weeklyRent: 'pmt(periodRate, termPeriods, financedAmount)',
    },
    groups: {
      'Valor a financiar': ['marginBase', 'margin', 'taxableBase', 'vatAmount', 'financedAmount'],
      'Tasa y plazo': ['periodRate', 'annualEffectiveRate', 'termPeriods'],
      'Canon': ['weeklyRent'],
    },
    series: {
      name: 'planPago', n: 'termPeriods',
      rows: {
        openingBalance: 'if(i == 1, financedAmount, prev.closingBalance)',
        principal: 'ppmt(periodRate, i, termPeriods, financedAmount)',
        interest: 'ipmt(periodRate, i, termPeriods, financedAmount)',
        payment: 'principal + interest',
        closingBalance: 'openingBalance - principal',
      },
    },
    output: 'weeklyRent',
  },

  /* ═══════════ CreditopX · salud ═══════════
     Fuente: los dos "Calculadora PV V20251009.xlsm" (fórmulas idénticas, distinto escenario).
     El comercio (Sonria/Dentix/Gaes) NO es un proyecto: es una fila de la tabla. */
  'creditopx-salud': {
    label: 'CreditopX · salud',
    legalNature: 'crédito',   // Financiación directa.
    note: 'Sonria / Dentix / Gaes comparten estas fórmulas exactas. El comercio solo aporta valores.',
    realWorldCharge: 'mensual',
    // FinancialMath.php:29 lo dice explícito: "Intentionally uses the compound effective
    // formula. annualEffectiveRate/360 (nominal simple) is NOT used — this matches the
    // Calculadora PV V20251009.xlsm convention."
    rateConvention: 'effective',
    periods: { rateStatedIn: 'anual', chargedEvery: 'mensual', termIn: 'mensual' },

    constants: {
      vatRate: 0.19, financialTransactionTaxRate: 0.004, lifeInsuranceFactor: 0.001307,
      daysPerYear: 360,        // para la tasa diaria. Comercial, no calendario.
    },
    inputs: [
      { name: 'merchantId', type: 'count', label: 'Comercio (allied_id)', default: 178, enum: [142, 156, 178] },
      { name: 'requestedAmount', type: 'money', label: 'Monto requerido', default: 10719300.815738792, min: 0 },
      { name: 'termMonths', type: 'count', label: 'Plazo (meses)', default: 36, min: 1 },
      { name: 'statedRate', type: 'rate', label: 'Tasa como la da el negocio (E.A.)', default: 0.2817 },
      { name: 'guaranteePaidUpfront', type: 'bool', label: 'Fianza anticipada', default: true },
      { name: 'firstPeriodDays', type: 'count', label: 'Días hasta 1ª cuota', default: 9, min: 0 },
    ],
    tables: {
      merchantConfig: {
        key: 'merchantId',
        rows: [
          { merchantId: 142, maxAmount: 12000000, guaranteeRate: 0.09, label: 'Dentix' },
          { merchantId: 156, maxAmount: 12000000, guaranteeRate: 0.10, label: 'Sonria' },
          { merchantId: 178, maxAmount: 12000000, guaranteeRate: 0.10, label: 'Gaes' },
        ],
      },
    },
    formulas: {
      maxAmount: 'lookup(merchantConfig, merchantId, "maxAmount")',
      guaranteeRate: 'lookup(merchantConfig, merchantId, "guaranteeRate")',
      periodRate: '(1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1',
      annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',
      dailyRate: '(1 + statedRate) ^ (statedPerYear / daysPerYear) - 1',
      guaranteeCost: 'requestedAmount * guaranteeRate',
      vatOnGuarantee: 'guaranteeCost * vatRate',
      transactionTax: '(guaranteeCost + vatOnGuarantee) * financialTransactionTaxRate',
      totalGuarantee: 'guaranteeCost + vatOnGuarantee + transactionTax',
      disbursedAmount: 'if(guaranteePaidUpfront, requestedAmount + totalGuarantee, requestedAmount)',
      installment: 'pmt(periodRate, termMonths, disbursedAmount)',
      lifeInsurance: 'disbursedAmount * lifeInsuranceFactor',
      monthlyGuarantee: 'if(guaranteePaidUpfront, 0, totalGuarantee / termMonths)',
      firstPeriodInterest: 'disbursedAmount * dailyRate * firstPeriodDays',
      totalInstallment: 'installment + lifeInsurance + monthlyGuarantee',
      firstInstallment: 'totalInstallment + firstPeriodInterest',
    },
    groups: {
      'Comercio': ['maxAmount', 'guaranteeRate'],
      'Tasas': ['periodRate', 'annualEffectiveRate', 'dailyRate'],
      'Fianza': ['guaranteeCost', 'vatOnGuarantee', 'transactionTax', 'totalGuarantee'],
      'Desembolso': ['disbursedAmount'],
      'Cuota': ['installment', 'lifeInsurance', 'monthlyGuarantee', 'firstPeriodInterest',
                'totalInstallment', 'firstInstallment'],
    },
    series: {
      name: 'planPago', n: 'termMonths',
      rows: {
        openingBalance: 'if(i == 1, disbursedAmount, prev.closingBalance)',
        interest: 'openingBalance * periodRate',
        principal: 'installment - interest',
        closingBalance: 'openingBalance - principal',
        payment: 'installment + lifeInsurance + monthlyGuarantee + if(i == 1, firstPeriodInterest, 0)',
      },
    },
    output: 'totalInstallment',
  },

  /* ═══════════ Alta Fleet ═══════════
     Fuente: "Creditop-ALTA FLEET-270726-203915.pdf", punto 9.
     Una operación del cliente = DOS créditos en el core, con plazos distintos (18 y 10).
     Por eso la cuota es ESCALONADA: baja en el mes 11 cuando se acaba la póliza.
     El documento dice "cuotas semanales fijas de $225.000" y ese número NO reconcilia
     con el plan mensual por ninguna vía (+33,2% en el contrato). Pendiente con Manuela. */
  'alta-fleet': {
    label: 'Alta Fleet',
    legalNature: 'crédito',   // El PDF (punto 7) exige LENGUAJE de alquiler, pero los instrumentos son de crédito: pagaré Deceval, fianza, FNG y "seguro de vida DEUDORES".
    note: 'Dos créditos en el core (moto 18 cuotas + póliza 10) → la cuota baja en el mes 11.',
    realWorldCharge: 'semanal',
    // El PDF da 1,87% M.V. y amortiza mensual: statedPerYear = periodsPerYear = 12, así que
    // nominal y efectiva dan el MISMO número. Se declara nominal por ser el canon N.M.
    rateConvention: 'nominal',
    // Amortiza MENSUAL (así lo hace el PDF); que además se cobre semanal es el puente que falta.
    periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual', termIn: 'mensual' },

    constants: { lifeInsuranceFactor: 0.0014, gpsMonthlyFee: 20000 },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Valor a financiar moto', default: 8485400, min: 0 },
      { name: 'gpsDevicePrice', type: 'money', label: 'GPS', default: 595000, min: 0 },
      { name: 'guaranteeRate', type: 'rate', label: 'Novafianza (incl. IVA y FNG)', default: 0.0964 },
      { name: 'statedRate', type: 'rate', label: 'Tasa como la da el negocio (M.V.)', default: 0.0187 },
      { name: 'termMonths', type: 'count', label: 'Cuotas moto', default: 18, min: 1 },
      { name: 'insuranceAmount', type: 'money', label: 'Valor a financiar seguro', default: 673000, min: 0 },
      { name: 'insuranceTermMonths', type: 'count', label: 'Cuotas póliza', default: 10, min: 1 },
    ],
    formulas: {
      periodRate: 'statedRate * statedPerYear / periodsPerYear',
      annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',
      guaranteeCost: '(assetCost + gpsDevicePrice) * guaranteeRate',
      financedAmount: 'assetCost + gpsDevicePrice + guaranteeCost',
      installment: 'pmt(periodRate, termMonths, financedAmount)',
      lifeInsurance: 'financedAmount * lifeInsuranceFactor',
      vehicleInstallment: 'installment + lifeInsurance + gpsMonthlyFee',
      insuranceInstallment: 'pmt(periodRate, insuranceTermMonths, insuranceAmount)',
      totalInstallment: 'vehicleInstallment + insuranceInstallment',
    },
    groups: {
      'Tasa': ['periodRate', 'annualEffectiveRate'],
      'Crédito moto': ['guaranteeCost', 'financedAmount', 'installment', 'lifeInsurance',
                       'vehicleInstallment'],
      'Crédito póliza': ['insuranceInstallment'],
      'Total al cliente': ['totalInstallment'],
    },
    series: {
      name: 'planPago', n: 'termMonths',
      rows: {
        vehiclePayment: 'vehicleInstallment',
        policyPayment: 'if(i <= insuranceTermMonths, insuranceInstallment, 0)',
        totalPayment: 'vehiclePayment + policyPayment',
      },
    },
    output: 'totalInstallment',
  },
}

/* ═══════════ Políticas ═══════════
   Motai: Renting y RTO comparten esta misma política — el documento lo dice explícito
   ("mismas reglas de validación"). Tres hojas, una política: por eso son recursos distintos. */
export const POLICIES = {
  motai: {
    label: 'Motai · política de riesgo',
    appliesTo: ['motai-renting', 'motai-rto'],
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
        {
          id: 'R3', label: 'Score mínimo', test: 'creditScore >= minCreditScore',
          fail: 'Score {creditScore}, por debajo del mínimo de {minCreditScore}.',
        },
        {
          id: 'R4', label: 'Canon mínimo', test: 'weeklyRent >= minWeeklyRent',
          fail: 'El canon de {weeklyRent} no llega al mínimo de {minWeeklyRent}.',
        },
        {
          id: 'R5', label: 'Canon máximo', test: 'weeklyRent <= maxWeeklyRent',
          fail: 'El canon de {weeklyRent} supera el máximo de {maxWeeklyRent}.',
        },
        {
          id: 'R6', label: 'Cuota vs ingreso', test: 'incomeShare <= maxIncomeShare',
          fail: 'El canon se lleva el {incomeSharePct|1}% del ingreso semanal ({weeklyIncome}); el tope es {maxIncomeSharePct|0}%.',
        },
      ],
    },
    outcome: {
      mode: 'first',
      branches: [
        { when: 'monthlyIncome >= directApprovalIncome', then: 'aprobado', label: 'Ingreso ≥ 3.000.000' },
        { when: 'monthlyIncome < coSignerIncome', then: 'condicional', label: 'Ingreso < 2.900.000 → codeudor' },
        {
          when: 'true', then: 'revision_manual', label: 'Banda 2.900.000 – 2.999.999',
          note: 'El documento de Manuela no cubre esta banda. Se manda a revisión en vez de dejarla caer en silencio.',
        },
      ],
    },
  },
}

/** Constantes que YA NO se escriben a mano: salen de los selects de período. No se listan
 *  como constantes editables porque no son de la hoja, son derivadas. */
export const DERIVED_PERIOD_CONSTANTS = ['statedPerYear', 'periodsPerYear', 'termPerYear']

/** Resuelve los períodos declarados a números y los deja como constantes.
 *  Única fuente: la usan el store, el arnés de verificación y cualquier consumidor. */
export function withPeriods(def, override = {}) {
  const p = { ...(def.periods || {}), ...override }
  const c = {}
  if (p.rateStatedIn) c.statedPerYear = PERIODS[p.rateStatedIn]
  if (p.chargedEvery) c.periodsPerYear = PERIODS[p.chargedEvery]
  if (p.termIn) c.termPerYear = PERIODS[p.termIn]
  return { ...def, constants: { ...def.constants, ...c } }
}

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
