// LO MÍNIMO. Monto, número de cuotas y tasa → la tabla de pagos.
//
// La hoja paramétrica completa (19 fórmulas, 17 inputs, y las 6 configuraciones de producto:
// Motai, Alta, salud…) vive en `reference/full-sheet.js`. Está fuera de la app a propósito —
// para poder ordenar esto de a poco— pero **viva**: `verify.mjs` la corre y sigue probando que
// una sola hoja reproduce los cuatro productos con 30 puntos de control exactos.
//
// Para crecer de a un bloque: ver docs/HOJA-COMPLETA.md.
//
// Convenciones: nombres en inglés · tasas en DECIMAL (0.02, no 2) · la UI muestra porcentaje
// pero el documento guarda el decimal.

/** Cuántos períodos de cada clase caben en un año. La diaria usa 360 (convención comercial). */
export const PERIODS = {
  anual: 1, semestral: 2, trimestral: 4, bimestral: 6,
  mensual: 12, quincenal: 24, semanal: 52, diaria: 360,
}

export const SHEET = {
  /** `rateStatedIn` = en qué período lo dice el negocio · `chargedEvery` = en qué período se cobra */
  periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },

  inputs: [
    { name: 'amount', type: 'money', label: 'Monto', default: 10000000, min: 0 },
    { name: 'installments', type: 'count', label: 'Número de cuotas', default: 24, min: 1 },
    { name: 'statedRate', type: 'rate', label: 'Tasa, en el período de arriba', default: 0.02 },
    { name: 'compound', type: 'bool', label: 'Efectiva (capitaliza). No = nominal, divide', default: true },
  ],

  formulas: {
    // `if()` como selección de parámetro entre las dos convenciones que conviven en CreditOp
    // (ver F-71 en findings) — no es lógica de negocio.
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',
    installment: 'pmt(periodRate, installments, amount)',
  },

  series: {
    name: 'plan', n: 'installments',
    rows: {
      openingBalance: 'if(i == 1, amount, prev.closingBalance)',
      interest: 'openingBalance * periodRate',
      principal: 'installment - interest',
      payment: 'installment',
      closingBalance: 'openingBalance - principal',
    },
  },

  output: 'installment',
}

/** Resuelve los períodos declarados a números y los deja como constantes. */
export function withPeriods(def, override = {}) {
  const p = { ...(def.periods || {}), ...override }
  return {
    ...def,
    constants: {
      ...def.constants,
      statedPerYear: PERIODS[p.rateStatedIn],
      periodsPerYear: PERIODS[p.chargedEvery],
    },
  }
}

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
