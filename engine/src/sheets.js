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
//   valor a financiar = monto − lo que RESTA + lo que SUMA        ← la etapa `amount`
//   cuota total       = cuota del crédito + lo que suma A CADA PAGO ← la etapa `charges`
//
// Y cada punto es UNA ETAPA, o sea un nodo en pantalla. Agregar un costo nuevo de un lender es
// elegir uno de dos nodos; no hay una tercera respuesta posible.
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
    { name: 'lifeInsuranceRate', type: 'rate', default: 0, appliesTo: 'charges',
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
  ],

  /** ═══ A DÓNDE VA CADA COSTO MOVIBLE ═══
   *  La fianza es el MISMO costo en los dos casos; lo único que cambia es en qué punto de
   *  inserción entra — y por lo tanto EN QUÉ NODO se configura.
   *
   *  Es UN dato, no dos. Antes había un `appliesTo` que decidía dónde se DIBUJABA y un
   *  `guaranteeUpfront` que decidía a dónde iba la PLATA, y podían contradecirse: de hecho se
   *  contradecían siempre, porque el bloque se dibujaba en `al monto` incluso con la fianza
   *  yéndose a la cuota. El nodo decía una cosa y el cálculo hacía otra. */
  where: { guarantee: 'amount' },

  /** Bloques que se mueven COMPLETOS: sus inputs y sus fórmulas van juntos a la etapa que diga
   *  `where`. Mover solo los inputs armaba un ciclo — `al monto` leería `guaranteeRate` de
   *  `a la cuota`, y `a la cuota` ya lee `financedAmount` de `al monto`. */
  blocks: {
    guarantee: {
      inputs: ['guaranteeRate', 'guaranteeVatRate', 'transactionTaxRate'],
      formulas: ['guaranteeCost', 'guaranteeVat', 'guaranteeTax', 'totalGuarantee'],
    },
  },

  /** ═══ LO QUE LLEGA A CADA PUNTO DE INSERCIÓN ═══
   *  `financedAmount` y `installmentCharges` NO se escriben a mano: son la SUMA de sus términos, y
   *  las arma `resolveSheet`. Por eso agregar un costo es agregar un TÉRMINO — y por eso el botón
   *  "+ campo" de los nodos puede existir sin que el motor sepa nada de él.
   *
   *  `at`     — la etapa donde cae. Si es el nombre de un bloque movible, cae donde caiga el bloque.
   *  `spread` — es un TOTAL: si cae en `a la cuota` hay que repartirlo entre las cuotas. La fianza
   *             es un total; el seguro de vida ya viene por cuota.
   *
   *  Esto reemplazó a `financedAmount: '... + totalGuarantee * guaranteeUpfront'`. Multiplicar por
   *  cero disimulaba que con la fianza en la cuota el valor financiado no tiene NADA que ver con
   *  la fianza, y dejaba una dependencia falsa en la arista. */
  terms: [
    { value: 'totalGuarantee', at: 'guarantee', spread: true },
    { value: 'lifeInsurance', at: 'charges' },
  ],

  /** Las etapas del cálculo. Cada una es AUTOCONTENIDA: trae sus propios inputs (los que
   *  declaran su `appliesTo`) y sus propias fórmulas.
   *
   *  ═══ UN NODO POR PUNTO DE INSERCIÓN ═══
   *  Los dos puntos donde algo puede entrar al cálculo son DOS ETAPAS, no un flag:
   *
   *    `amount`  — al monto      → termina en `financedAmount`  (lo que se financia)
   *    `charges` — a la cuota    → termina en `installmentCharges` (lo que viaja en cada pago)
   *
   *  Por eso agregar un costo nuevo de un lender es ELEGIR UNO DE DOS NODOS: no hay una tercera
   *  respuesta posible, y las dos están en pantalla. Es la misma taxonomía de `appliesTo`, pero
   *  visible.
   *
   *  Y así `installment` queda con un solo trabajo: la anualidad (`pmt`) y la suma. Antes hacía
   *  las dos cosas — la anualidad Y los recargos — y por eso costaba leerlo.
   *
   *  `tasa` y `al monto` van en PARALELO: ninguna depende de la otra (verificado contra las
   *  dependencias reales, no supuesto). */
  //  ═══ TRES CLASES DE NODO, TRES COLORES ═══
  //  `group: 'config'` no es un truco de dibujo: dice que esas tres etapas son LA MISMA CLASE de
  //  cosa — lo que configura la entidad. Comparten columna y color, así que "configurar un lender"
  //  es llenar las cajas de ese color. Las otras dos clases son `el crédito` (lo que pide el
  //  cliente) y `cuota` + el plan (el resultado).
  stages: [
    { key: 'credit', title: 'el crédito', formulas: [] },
    { key: 'rate', title: 'tasa', group: 'config', rateBlock: true,
      formulas: ['periodRate', 'annualEffectiveRate'] },
    // `showRows: false` esconde los PASOS, nunca el resultado: el nodo siempre muestra su última
    // fórmula. Acá los intermedios (fianza, IVA, 4×1000, fianza total) solo repiten los nombres
    // de sus inputs, así que eran ruido.
    // `insertion` es la insignia del encabezado. La llevan EXACTAMENTE estos dos nodos, y dice
    // el criterio con el que se elige entre ellos: si el costo paga intereses o no. Así se leen
    // como par aunque el layout no los ponga lado a lado — no puede, ver abajo.
    { key: 'amount', title: 'al monto', group: 'config', showRows: false,
      insertion: 'con interés',
      insertionHelp: 'Entra al saldo, así que paga intereses en cada cuota — y sube la base del '
        + 'seguro de vida, que se cobra sobre lo financiado.',
      formulas: ['financedAmount'] },
    // Depende de `al monto`, y es un hecho del negocio, no del dibujo: el seguro de vida se
    // calcula sobre `financedAmount`. Con fianza al 5% y seguro 0,0014, financiar la fianza sube
    // el seguro de 14.000 a 14.700 por cuota. Comparten columna igual, porque están en el mismo
    // grupo — y esa dependencia se dibuja como flecha VERTICAL, de abajo de una a arriba de la
    // otra. Así el orden se ve sin que el cable tenga que ir hacia atrás.
    { key: 'charges', title: 'a la cuota', group: 'config', showRows: false,
      insertion: 'sin interés',
      insertionHelp: 'Se reparte en los pagos y nunca entra al saldo, así que no paga intereses.',
      formulas: ['lifeInsurance', 'installmentCharges'] },
    { key: 'installment', title: 'cuota',
      formulas: ['installment', 'totalInstallment'] },
  ],

  /** `appliesTo` que no son una etapa: se dibujan DENTRO de la etapa que los consume. Los de
   *  `blocks` los llena `resolveSheet` con lo que diga `where`, así que acá no van a mano. */
  inputHost: {},

  formulas: {
    // Cuando llegue el bloque de precio, la base pasa a ser `principal + deviceCost` — y no
    // moverá ningún número, porque con esas perillas en cero `principal` es igual a `amount`.
    guaranteeCost: 'amount * guaranteeRate',
    guaranteeVat: 'guaranteeCost * guaranteeVatRate',
    guaranteeTax: '(guaranteeCost + guaranteeVat) * transactionTaxRate',
    totalGuarantee: 'guaranteeCost + guaranteeVat + guaranteeTax',

    // `financedAmount` y `installmentCharges` las ARMA `resolveSheet` sumando los `terms`.
    // Escribirlas acá sería tener dos fuentes para lo mismo.

    // `if()` como selección de parámetro entre las dos convenciones que conviven en CreditOp
    // (ver F-71 en findings) — no es lógica de negocio.
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',

    lifeInsurance: 'financedAmount * lifeInsuranceRate',

    installment: 'pmt(periodRate, installments, financedAmount)',
    totalInstallment: 'installment + installmentCharges',
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
  installmentCharges: 'cargos por cuota',
  totalInstallment: 'cuota total',
  periodRate: 'tasa del período',
  annualEffectiveRate: 'tasa efectiva anual',
}

/** Resuelve los períodos declarados a números y los deja como constantes. */
/** Bases por punto de inserción: sobre qué se aplica un PORCENTAJE que cae ahí.
 *  Son las bases de los casos reales, no una elección arbitraria — la fianza es un % del monto y
 *  el seguro de vida es un % de lo financiado. */
export const RATE_BASE = { amount: 'amount', charges: 'financedAmount' }
export const RATE_BASE_LABEL = { amount: 'el monto', charges: 'el valor a financiar' }

/** Nombres que un campo agregado a mano NO puede pisar. */
const RESERVADOS = new Set(['statedPerYear', 'periodsPerYear', 'i', 'n', 'prev'])

/** Resuelve la hoja a lo que el motor come:
 *    · los períodos declarados → constantes numéricas
 *    · cada bloque movible → la etapa que lo aloja (inputs Y fórmulas juntos)
 *    · los campos agregados a mano → sus inputs y, si son porcentaje, su fórmula
 *    · los dos puntos de inserción → la SUMA de los términos que les llegan
 *
 *  Nada de esto vive escrito dos veces: `where` dice dónde cae cada bloque y `terms` dice qué
 *  suma cada punto. Las fórmulas salen de ahí.  */
export function resolveSheet(def, { periods = {}, where = {}, extras = [] } = {}) {
  const p = { ...(def.periods || {}), ...periods }
  const w = { ...(def.where || {}), ...where }

  const inputHost = { ...(def.inputHost || {}) }
  const formulas = { ...def.formulas }
  const formulaLabel = { ...FORMULA_LABEL }
  const inputs = [...(def.inputs || [])]
  const terms = [...(def.terms || [])]
  const llegan = {}   // etapa → fórmulas que se calculan ahí

  // ── bloques movibles: sus inputs y sus fórmulas van juntos a donde diga `where`
  for (const [nombre, b] of Object.entries(def.blocks || {})) {
    inputHost[nombre] = w[nombre]
    llegan[w[nombre]] = [...(llegan[w[nombre]] || []), ...b.formulas]
  }
  // un término puede caer en una etapa o "donde caiga tal bloque"
  const cae = t => (def.blocks?.[t.at] ? w[t.at] : t.at)

  // ── campos agregados a mano en la UI
  for (const e of extras) {
    inputs.push({
      name: e.name, type: e.kind === 'rate' ? 'rate' : 'money', default: 0, min: 0,
      appliesTo: e.at, label: e.label, extra: e.id,
      help: e.kind === 'rate'
        ? `Porcentaje sobre ${RATE_BASE_LABEL[e.at]}. Campo agregado a mano.`
        : 'Monto fijo. Campo agregado a mano.',
    })
    if (e.kind === 'rate') {
      // un porcentaje necesita su fórmula: el input es la tasa, el término es el resultado
      const f = e.name + 'Value'
      formulas[f] = `${RATE_BASE[e.at]} * ${e.name}`
      formulaLabel[f] = e.label
      llegan[e.at] = [...(llegan[e.at] || []), f]
      terms.push({ value: f, at: e.at, extra: e.id })
    } else {
      terms.push({ value: e.name, at: e.at, extra: e.id })   // un monto ES su término
    }
  }

  // ── los dos puntos de inserción son la SUMA de lo que les llega
  const suma = etapa => terms.filter(t => cae(t) === etapa)
    .map(t => (etapa === 'charges' && t.spread ? `${t.value} / installments` : t.value))
  formulas.financedAmount = ['amount - downPayment', ...suma('amount')].join(' + ')
  formulas.installmentCharges = suma('charges').join(' + ') || '0'

  // las del bloque van PRIMERO en su etapa: se calculan antes de la que las recoge
  const movidas = new Set(Object.values(def.blocks || {}).flatMap(b => b.formulas))
  const stages = (def.stages || []).map(st => ({
    ...st,
    formulas: [...(llegan[st.key] || []), ...st.formulas.filter(f => !movidas.has(f))],
  }))

  return {
    ...def, stages, inputs, inputHost, formulas, formulaLabel, terms,
    constants: {
      ...def.constants,
      statedPerYear: PERIODS[p.rateStatedIn],
      periodsPerYear: PERIODS[p.chargedEvery],
    },
  }
}

/** Un nombre de variable válido a partir de la etiqueta que escribió el usuario.
 *  "costo de estudio" → `costoDeEstudio`. En inglés no se puede: lo escribe él en español. Lo que
 *  importa es que sea un identificador que el tokenizer acepte, sin tildes ni espacios. */
export function nombreDe(label, def, usados = []) {
  const sinTildes = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const partes = sinTildes.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
  const base = partes.map((t, k) => (k ? t[0].toUpperCase() + t.slice(1) : t)).join('')
    .replace(/^[0-9]+/, '') || 'campo'
  const tomados = new Set([
    ...(def.inputs || []).map(x => x.name), ...Object.keys(def.formulas || {}),
    ...Object.keys(def.series?.rows || {}), ...RESERVADOS, ...usados,
  ])
  let n = base, i = 1
  while (tomados.has(n) || tomados.has(n + 'Value')) n = base + ++i
  return n
}

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
