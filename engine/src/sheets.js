// Monto, cuotas, tasa y fianza → la tabla de pagos.
//
// ═══ DOS NOMBRES PARA CADA COSA ═══
//   `name`  en INGLÉS  → es el nombre real: va en el JSON, en las fórmulas, en la API
//   `label` en ESPAÑOL → solo para mostrar. Corto, como lo diría el negocio
//   `help`  en ESPAÑOL → la explicación larga, como tooltip
//
// La UI nunca muestra `name` y el documento nunca muestra `label`. Así un cambio de redacción
// no puede tocar una fórmula, y traducir la interfaz no puede romper el contrato de la API.
//
// La hoja paramétrica completa (19 fórmulas, 17 inputs, y las 6 configuraciones de producto)
// vive en `reference/full-sheet.js` — fuera de la app pero viva: `verify.mjs` la corre y sigue
// probando que una sola hoja reproduce los cuatro productos. Crecer de a un bloque:
// docs/HOJA-COMPLETA.md.
//
// Convenciones: tasas en DECIMAL (0.02, no 2) · la UI muestra porcentaje, el documento guarda
// el decimal.

/** Cuántos períodos de cada clase caben en un año. La diaria usa 360 (convención comercial). */
export const PERIODS = {
  anual: 1, semestral: 2, trimestral: 4, bimestral: 6,
  mensual: 12, quincenal: 24, semanal: 52, diaria: 360,
}

export const SHEET = {
  /** `rateStatedIn` = en qué período lo dice el negocio · `chargedEvery` = en qué período se cobra */
  periods: { rateStatedIn: 'mensual', chargedEvery: 'mensual' },

  inputs: [
    { name: 'amount', type: 'money', default: 10000000, min: 0,
      label: 'monto', help: 'Lo que el cliente pide. La fianza se le suma después.' },
    { name: 'installments', type: 'count', default: 24, min: 1,
      label: 'cuotas', help: 'En cuántos pedazos se devuelve.' },
    { name: 'statedRate', type: 'rate', default: 0.02,
      label: 'tasa', help: 'En el período que dice el select de la izquierda.' },
    { name: 'compound', type: 'bool', default: true,
      label: 'efectiva', help: 'Sí = capitaliza · No = nominal, divide proporcional.' },

    // ── tanda 1 · fianza (la usan 3 de los 6 productos reales) ──
    { name: 'guaranteeRate', type: 'rate', default: 0,
      label: 'fianza',
      help: 'Lo que cobra el fiador (Novafianza, FGA, FNG) por responder si el cliente no paga. Reemplaza al codeudor, y la paga el cliente.' },
    { name: 'guaranteeVatRate', type: 'rate', default: 0,
      label: 'IVA de la fianza',
      help: 'Dejalo en 0 si la tarifa de la fianza ya lo trae adentro — es el caso del 9,64% de Novafianza en Alta.' },
    { name: 'transactionTaxRate', type: 'rate', default: 0,
      label: '4 × 1000',
      help: 'GMF: el impuesto por mover plata en el sistema financiero, calculado sobre la fianza.' },
    { name: 'guaranteeUpfront', type: 'bool', default: true,
      label: 'fianza anticipada',
      help: 'Sí = se suma al desembolso y se financia · No = se cobra repartida en las cuotas.' },
  ],

  /** Solo presentación. La hoja no depende de estos grupos. */
  inputGroups: {
    'crédito': ['amount', 'installments'],
    'fianza': ['guaranteeRate', 'guaranteeVatRate', 'transactionTaxRate', 'guaranteeUpfront'],
  },

  formulas: {
    // Cuando llegue el bloque de precio, la base pasa a ser `principal + deviceCost` — y no
    // moverá ningún número, porque con esas perillas en cero `principal` es igual a `amount`.
    guaranteeCost: 'amount * guaranteeRate',
    guaranteeVat: 'guaranteeCost * guaranteeVatRate',
    guaranteeTax: '(guaranteeCost + guaranteeVat) * transactionTaxRate',
    totalGuarantee: 'guaranteeCost + guaranteeVat + guaranteeTax',

    // Anticipada se financia; mensualizada no entra al saldo y se cobra en cada cuota.
    // Es aritmética, no un `if`: `guaranteeUpfront` vale 1 o 0.
    financedAmount: 'amount + totalGuarantee * guaranteeUpfront',

    // `if()` como selección de parámetro entre las dos convenciones que conviven en CreditOp
    // (ver F-71 en findings) — no es lógica de negocio.
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',

    installment: 'pmt(periodRate, installments, financedAmount)',
    monthlyGuarantee: 'totalGuarantee * (1 - guaranteeUpfront) / installments',
    totalInstallment: 'installment + monthlyGuarantee',
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
    /** Encabezados de la tabla — los mismos que usa el .xlsx original. */
    labels: {
      openingBalance: 'saldo inicial', interest: 'interés', principal: 'capital',
      payment: 'cuota', closingBalance: 'saldo final',
    },
  },

  output: 'totalInstallment',
}

/** Nombre en español de una fórmula, para lo poco que la UI necesita nombrar. */
export const FORMULA_LABEL = {
  financedAmount: 'valor a financiar',
  totalGuarantee: 'fianza total',
  installment: 'cuota del crédito',
  monthlyGuarantee: 'fianza por cuota',
  totalInstallment: 'cuota total',
  periodRate: 'tasa del período',
  annualEffectiveRate: 'tasa efectiva anual',
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
