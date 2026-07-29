// Monto, cuotas, tasa y fianza → la tabla de pagos.
//
// ═══ DOS NOMBRES PARA CADA COSA ═══
//   `name`  en INGLÉS  → es el nombre real: va en el JSON, en las fórmulas, en la API
//   `label` en ESPAÑOL → solo para mostrar. Corto, como lo diría el negocio
//   `help`  en ESPAÑOL → la explicación larga, como tooltip
//
// ═══ CADA INPUT DECLARA A QUÉ SE APLICA ═══
// En el cálculo hay exactamente DOS puntos de inserción, y todo lo que entra va a uno:
//
//   valor a financiar = monto − lo que RESTA + lo que SUMA
//   cuota total       = cuota del crédito + lo que se suma A CADA PAGO
//
// Por eso `appliesTo` reemplaza a la lista `inputGroups` escrita a mano: el grupo se DERIVA de
// a qué se aplica el valor, no de cómo se me ocurrió ordenarlo.
//
// Y la fianza es la prueba de que un mismo costo puede ir a cualquiera de los dos: el
// `guaranteeUpfront` no es un flag técnico — es **a cuál de los dos grupos pertenece**. Por eso
// en la UI el encabezado de su sección ES el interruptor.
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
    // ── el crédito mismo ──
    { name: 'amount', type: 'money', default: 10000000, min: 0, appliesTo: 'credit',
      label: 'monto', help: 'Lo que el cliente pide. Las otras etapas lo suben o lo bajan.' },
    { name: 'installments', type: 'count', default: 24, min: 1, appliesTo: 'credit',
      label: 'cuotas', help: 'En cuántos pedazos se devuelve.' },
    { name: 'statedRate', type: 'rate', default: 0.02, appliesTo: 'rate',
      label: 'tasa', help: 'En el período que dice el select de la izquierda.' },
    { name: 'compound', type: 'bool', default: true, appliesTo: 'rate',
      label: 'efectiva', help: 'Sí = capitaliza · No = nominal, divide proporcional.' },

    { name: 'downPayment', type: 'money', default: 0, min: 0, appliesTo: 'credit', sign: -1,
      label: 'cuota inicial',
      help: 'Lo que el cliente pone de su bolsillo. RESTA: se financia menos. Se escribe en positivo; la fórmula la resta.' },

    // ── A LA CUOTA · se suman a cada pago ──
    { name: 'lifeInsuranceRate', type: 'rate', default: 0, appliesTo: 'installment',
      label: 'seguro de vida',
      help: 'Factor por peso financiado, por cuota. Si el cliente muere, la aseguradora paga el saldo. 0,0014 = 1.400 pesos por millón.' },

    // ── LA FIANZA · va a uno de los dos, y `guaranteeUpfront` elige a cuál ──
    { name: 'guaranteeRate', type: 'rate', default: 0, appliesTo: 'guarantee',
      label: 'fianza',
      help: 'Lo que cobra el fiador (Novafianza, FGA, FNG) por responder si el cliente no paga. Reemplaza al codeudor, y la paga el cliente.' },
    { name: 'guaranteeVatRate', type: 'rate', default: 0, appliesTo: 'guarantee',
      label: 'IVA de la fianza',
      help: 'Dejalo en 0 si la tarifa de la fianza ya lo trae adentro — es el caso del 9,64% de Novafianza en Alta.' },
    { name: 'transactionTaxRate', type: 'rate', default: 0, appliesTo: 'guarantee',
      label: '4 × 1000',
      help: 'GMF: el impuesto por mover plata en el sistema financiero, calculado sobre la fianza.' },
    // No va en la lista: es el encabezado-interruptor de la sección de fianza.
    { name: 'guaranteeUpfront', type: 'bool', default: true, appliesTo: 'guaranteeWhere',
      label: 'la fianza va',
      help: 'AL MONTO = se financia junto con el crédito, y por lo tanto genera intereses. A LA CUOTA = se reparte en los pagos y no entra al saldo.' },
  ],

  /** Las etapas del cálculo. Cada una es AUTOCONTENIDA: trae sus propios inputs (los que
   *  declaran su `appliesTo`) y sus propias fórmulas. No hay un nodo "entrada" que junte todo:
   *  si una perilla aplica al monto, su lugar es el nodo del monto.
   *
   *  `tasa` y `valor a financiar` van en PARALELO: ninguna depende de la otra (verificado
   *  contra las dependencias reales). `cuota` depende de las dos, así que va después. */
  stages: [
    { key: 'credit', title: 'el crédito', formulas: [] },
    { key: 'rate', title: 'tasa', formulas: ['periodRate', 'annualEffectiveRate'], rateBlock: true },
    // `showRows: false` — sus fórmulas intermedias (fianza, IVA, 4×1000, fianza total) solo
    // repiten los nombres de sus inputs, así que eran ruido. El resultado viaja en la arista.
    { key: 'amount', title: 'valor a financiar', showRows: false,
      formulas: ['guaranteeCost', 'guaranteeVat', 'guaranteeTax', 'totalGuarantee', 'financedAmount'] },
    { key: 'installment', title: 'cuota',
      formulas: ['installment', 'lifeInsurance', 'monthlyGuarantee', 'totalInstallment'] },
  ],

  /** `appliesTo` que no son una etapa: se dibujan DENTRO de la etapa que los consume.
   *  La fianza se calcula sobre el monto, así que sus perillas viven en `amount` — y su
   *  interruptor también, porque decide si el resultado va al monto o a la cuota. */
  inputHost: { guarantee: 'amount', guaranteeWhere: 'amount' },

  formulas: {
    // Cuando llegue el bloque de precio, la base pasa a ser `principal + deviceCost` — y no
    // moverá ningún número, porque con esas perillas en cero `principal` es igual a `amount`.
    guaranteeCost: 'amount * guaranteeRate',
    guaranteeVat: 'guaranteeCost * guaranteeVatRate',
    guaranteeTax: '(guaranteeCost + guaranteeVat) * transactionTaxRate',
    totalGuarantee: 'guaranteeCost + guaranteeVat + guaranteeTax',

    // Anticipada se financia; mensualizada no entra al saldo y se cobra en cada cuota.
    // Es aritmética, no un `if`: `guaranteeUpfront` vale 1 o 0.
    financedAmount: 'amount - downPayment + totalGuarantee * guaranteeUpfront',

    // `if()` como selección de parámetro entre las dos convenciones que conviven en CreditOp
    // (ver F-71 en findings) — no es lógica de negocio.
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',

    installment: 'pmt(periodRate, installments, financedAmount)',
    lifeInsurance: 'financedAmount * lifeInsuranceRate',
    monthlyGuarantee: 'totalGuarantee * (1 - guaranteeUpfront) / installments',
    totalInstallment: 'installment + lifeInsurance + monthlyGuarantee',
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

/** Notación colombiana de tasas, por período.
 *
 *  `ef` — EFECTIVA: capitaliza. `E.A.` es la que la ley obliga a publicar.
 *  `ve` — VENCIDA: nominal expresada en ese período y cobrada AL FINAL de cada uno.
 *
 *  La "V" de vencido no es decorativa: `pmt` cobra al final del período (el `type = 0` de
 *  Excel), así que *vencido* es exacto — y de paso queda dicho que *anticipado* no está
 *  soportado. Si algún día hace falta, es otra fórmula, no otra etiqueta.
 *
 *  Sobre `E.A.` y la familia `M.V./T.V.` no hay discusión: son las de mercado. Para semanal y
 *  quincenal no existe una forma estándar, así que se usa una corta y el tooltip la deletrea. */
export const RATE_NOTATION = {
  // Tres notaciones por período, porque son tres cosas distintas y confundirlas es F-71:
  //   ef — EFECTIVA: capitaliza. Aplicada su período da exactamente ese porcentaje.
  //   no — NOMINAL: se anualiza multiplicando y se reparte dividiendo. `mensual` da "N.M.",
  //        que es literalmente el `rate_suffix` de las 157 filas de credit_line_by_lenders.
  //   vc — VENCIDA: dice CUÁNDO se cobra, al final del período. Es lo que hace nuestro pmt.
  // Los nombres largos van escritos, no derivados: así "quincena vencidA" concuerda sin trucos.
  anual: { ef: 'E.A.', efN: 'efectiva anual', no: 'N.A.', noN: 'nominal anual',
    vc: 'A.V.', vcN: 'año vencido', nombre: 'anual', unidad: 'año' },
  semestral: { ef: 'E.S.', efN: 'efectiva semestral', no: 'N.S.', noN: 'nominal semestral',
    vc: 'S.V.', vcN: 'semestre vencido', nombre: 'semestral', unidad: 'semestre' },
  trimestral: { ef: 'E.T.', efN: 'efectiva trimestral', no: 'N.T.', noN: 'nominal trimestral',
    vc: 'T.V.', vcN: 'trimestre vencido', nombre: 'trimestral', unidad: 'trimestre' },
  bimestral: { ef: 'E.B.', efN: 'efectiva bimestral', no: 'N.B.', noN: 'nominal bimestral',
    vc: 'B.V.', vcN: 'bimestre vencido', nombre: 'bimestral', unidad: 'bimestre' },
  mensual: { ef: 'E.M.', efN: 'efectiva mensual', no: 'N.M.', noN: 'nominal mensual',
    vc: 'M.V.', vcN: 'mes vencido', nombre: 'mensual', unidad: 'mes' },
  quincenal: { ef: 'E.Q.', efN: 'efectiva quincenal', no: 'N.Q.', noN: 'nominal quincenal',
    vc: 'Q.V.', vcN: 'quincena vencida', nombre: 'quincenal', unidad: 'quincena' },
  semanal: { ef: 'E.Sm.', efN: 'efectiva semanal', no: 'N.Sm.', noN: 'nominal semanal',
    vc: 'Sm.V.', vcN: 'semana vencida', nombre: 'semanal', unidad: 'semana' },
  diaria: { ef: 'E.D.', efN: 'efectiva diaria', no: 'N.D.', noN: 'nominal diaria',
    vc: 'D.V.', vcN: 'día vencido', nombre: 'diaria', unidad: 'día' },
}

/** La sigla y su explicación larga. `rol` decide de qué familia sale, porque las dos filas
 *  del bloque de tasa dicen cosas distintas:
 *
 *    'dicha' — cómo viene el número del negocio. Ahí importa la CONVENCIÓN: efectiva (E.M.)
 *              o nominal (N.M.). Es la elección que cambia la cuota.
 *    'cobra' — la tasa que el motor aplica al saldo. Ahí la convención ya se resolvió, y lo
 *              único que queda por decir es CUÁNDO se cobra: vencida (M.V.), al final del
 *              período, porque es lo que hace pmt (el type=0 de Excel). De paso deja a la
 *              vista que anticipado no está soportado.
 */
export function notacion(periodo, efectiva, rol = 'dicha') {
  const n = RATE_NOTATION[periodo]
  if (!n) return { sigla: '', ayuda: '' }
  const cap = t => t[0].toUpperCase() + t.slice(1)

  if (rol === 'cobra') {
    return { sigla: n.vc,
      ayuda: `${cap(n.vcN)}: es la tasa que el motor aplica AL SALDO, al final de cada `
        + `${n.unidad}. Es la que entra al cálculo de la cuota.` }
  }
  return efectiva
    ? { sigla: n.ef,
        ayuda: `Tasa ${n.efN}: capitaliza. ${periodo === 'anual'
          ? 'Es la que la ley obliga a publicar y la que sirve para comparar.'
          : `Aplicada cada ${n.unidad} da exactamente ese porcentaje; al año da más.`}` }
    : { sigla: n.no,
        ayuda: `Tasa ${n.noN}: no capitaliza. Para llevarla a otro período se DIVIDE `
          + `proporcional.${periodo === 'mensual'
            ? ' Es el canon de la plataforma: "N.M." es el rate_suffix de las 157 filas de'
              + ' credit_line_by_lenders (ver F-71).'
            : ''}` }
}

/** Nombre en español de una fórmula, para lo poco que la UI necesita nombrar. */
export const FORMULA_LABEL = {
  guaranteeCost: 'fianza',
  guaranteeVat: 'IVA de la fianza',
  guaranteeTax: '4 × 1000',
  financedAmount: 'valor a financiar',
  totalGuarantee: 'fianza total',
  installment: 'cuota del crédito',
  lifeInsurance: 'seguro de vida',
  downPayment: 'cuota inicial',
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
