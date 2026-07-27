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

export const SHEETS = {

  /* ═══════════ Motai · Renting puro ═══════════
     Fuente: "Calculadora Renting VF.xlsx", pestaña Renting.
     Ojo: la tarifa sale de amortizar el precio de venta a 24 meses (un ancla de PRECIO,
     no un plazo real) y prorratear esa cuota mensual a semana dividiendo por 30 y
     multiplicando por 7. Es un PRORRATEO LINEAL, distinto a la conversión compuesta
     que usa RTO — de ahí el +1,11% entre los dos productos. */
  'motai-renting': {
    label: 'Motai · Renting puro',
    note: 'Arriendo sin opción de compra. No hay saldo que amortizar: el PMT a 24 meses es un ancla de precio.',
    periodBase: 'mensual', periodCharged: 'semanal',

    constants: {
      setupFee: 1500000, marginFactor: 1, vatRate: 0.19, monthlyRate: 0.018,
      anchorTermMonths: 24, daysPerWeek: 7, daysPerMonth: 30,
    },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Costo contable de la moto', default: 4534000, min: 0 },
      { name: 'planDurationWeeks', type: 'count', label: 'Duración del plan', default: 4, enum: [1, 4, 12] },
    ],
    tables: {
      rentalPlans: {
        key: 'planDurationWeeks',
        rows: [
          { planDurationWeeks: 1, factor: 1.25, label: 'Semanal' },
          { planDurationWeeks: 4, factor: 1.00, label: 'Mensual' },
          { planDurationWeeks: 12, factor: 0.94, label: 'Trimestral' },
        ],
      },
    },
    formulas: {
      baseCost: 'assetCost + setupFee',
      margin: 'baseCost * marginFactor',
      vatAmount: '(baseCost + margin) * vatRate',
      salePrice: 'baseCost + margin + vatAmount',
      anchorPayment: 'pmt(monthlyRate, anchorTermMonths, salePrice)',
      weekMonthRatio: 'daysPerWeek / daysPerMonth',
      baseWeeklyRent: 'anchorPayment * weekMonthRatio',
      planFactor: 'lookup(rentalPlans, planDurationWeeks, "factor")',
      weeklyRent: 'baseWeeklyRent * planFactor',
      planTotal: 'weeklyRent * planDurationWeeks',
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
    note: 'Arriendo con opción de compra: es un crédito. Hay saldo, se amortiza semanal.',
    periodBase: 'semanal', periodCharged: 'semanal',

    constants: {
      setupFee: 1500000, marginFactor: 1, vatRate: 0.19, monthlyRate: 0.018,
      weeksPerYear: 52, monthsPerYear: 12,
    },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Costo contable de la moto', default: 4534000, min: 0 },
      { name: 'downPayment', type: 'money', label: 'Cuota inicial', default: 2000000, min: 0 },
      { name: 'extras', type: 'money', label: 'Extras / accesorios', default: 1000000, min: 0 },
      { name: 'termMonths', type: 'count', label: 'Plazo', default: 24, enum: [12, 18, 24] },
    ],
    formulas: {
      marginBase: 'assetCost - downPayment + setupFee',
      margin: 'marginBase * marginFactor',
      taxableBase: 'marginBase + margin + extras',
      vatAmount: 'taxableBase * vatRate',
      financedAmount: 'taxableBase + vatAmount',
      termWeeks: 'termMonths * weeksPerYear / monthsPerYear',
      weeklyRate: '(1 + monthlyRate) ^ (monthsPerYear / weeksPerYear) - 1',
      weeklyRent: 'pmt(weeklyRate, termWeeks, financedAmount)',
    },
    series: {
      name: 'planPago', n: 'termWeeks',
      rows: {
        openingBalance: 'if(i == 1, financedAmount, prev.closingBalance)',
        principal: 'ppmt(weeklyRate, i, termWeeks, financedAmount)',
        interest: 'ipmt(weeklyRate, i, termWeeks, financedAmount)',
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
    note: 'Sonria / Dentix / Gaes comparten estas fórmulas exactas. El comercio solo aporta valores.',
    periodBase: 'mensual', periodCharged: 'mensual',

    constants: {
      vatRate: 0.19, financialTransactionTaxRate: 0.004, lifeInsuranceFactor: 0.001307,
      monthsPerYear: 12, daysPerMonth: 30,
    },
    inputs: [
      { name: 'merchantId', type: 'count', label: 'Comercio', default: 178, enum: [142, 156, 178] },
      { name: 'requestedAmount', type: 'money', label: 'Monto requerido', default: 10719300.815738792, min: 0 },
      { name: 'termMonths', type: 'count', label: 'Plazo (meses)', default: 36, min: 1 },
      { name: 'annualEffectiveRate', type: 'rate', label: 'Tasa E.A.', default: 0.2817 },
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
      monthlyRate: '(1 + annualEffectiveRate) ^ (1 / monthsPerYear) - 1',
      dailyRate: '(1 + monthlyRate) ^ (1 / daysPerMonth) - 1',
      guaranteeCost: 'requestedAmount * guaranteeRate',
      vatOnGuarantee: 'guaranteeCost * vatRate',
      transactionTax: '(guaranteeCost + vatOnGuarantee) * financialTransactionTaxRate',
      totalGuarantee: 'guaranteeCost + vatOnGuarantee + transactionTax',
      disbursedAmount: 'if(guaranteePaidUpfront, requestedAmount + totalGuarantee, requestedAmount)',
      installment: 'pmt(monthlyRate, termMonths, disbursedAmount)',
      lifeInsurance: 'disbursedAmount * lifeInsuranceFactor',
      monthlyGuarantee: 'if(guaranteePaidUpfront, 0, totalGuarantee / termMonths)',
      firstPeriodInterest: 'disbursedAmount * dailyRate * firstPeriodDays',
      totalInstallment: 'installment + lifeInsurance + monthlyGuarantee',
      firstInstallment: 'totalInstallment + firstPeriodInterest',
    },
    series: {
      name: 'planPago', n: 'termMonths',
      rows: {
        openingBalance: 'if(i == 1, disbursedAmount, prev.closingBalance)',
        interest: 'openingBalance * monthlyRate',
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
    note: 'Dos créditos en el core (moto 18 cuotas + póliza 10) → la cuota baja en el mes 11.',
    periodBase: 'mensual', periodCharged: 'semanal',

    constants: { lifeInsuranceFactor: 0.0014, gpsMonthlyFee: 20000 },
    inputs: [
      { name: 'assetCost', type: 'money', label: 'Valor a financiar moto', default: 8485400, min: 0 },
      { name: 'gpsDevicePrice', type: 'money', label: 'GPS', default: 595000, min: 0 },
      { name: 'guaranteeRate', type: 'rate', label: 'Novafianza (incl. IVA y FNG)', default: 0.0964 },
      { name: 'monthlyRate', type: 'rate', label: 'Tasa M.V.', default: 0.0187 },
      { name: 'termMonths', type: 'count', label: 'Cuotas moto', default: 18, min: 1 },
      { name: 'insuranceAmount', type: 'money', label: 'Valor a financiar seguro', default: 673000, min: 0 },
      { name: 'insuranceTermMonths', type: 'count', label: 'Cuotas póliza', default: 10, min: 1 },
    ],
    formulas: {
      guaranteeCost: '(assetCost + gpsDevicePrice) * guaranteeRate',
      financedAmount: 'assetCost + gpsDevicePrice + guaranteeCost',
      installment: 'pmt(monthlyRate, termMonths, financedAmount)',
      lifeInsurance: 'financedAmount * lifeInsuranceFactor',
      vehicleInstallment: 'installment + lifeInsurance + gpsMonthlyFee',
      insuranceInstallment: 'pmt(monthlyRate, insuranceTermMonths, insuranceAmount)',
      totalInstallment: 'vehicleInstallment + insuranceInstallment',
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

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
