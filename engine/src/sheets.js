// Monto, cuotas, tasa y fianza → la tabla de pagos.
//
// ═══ DOS NOMBRES PARA CADA COSA ═══
//   `name`  en INGLÉS  → es el nombre real: va en el JSON, en las fórmulas, en la API
//   `label` en ESPAÑOL → solo para mostrar. Corto, como lo diría el negocio
//   `help`  en ESPAÑOL → la explicación larga, como tooltip
//
// ═══ CADA INPUT DECLARA A QUÉ SE APLICA ═══
// En el cálculo hay exactamente DOS puntos de inserción, y todo costo entra por uno:
//
//   valor a financiar = monto − cuota inicial + lo que cae AL MONTO   ← la etapa `amount`
//   cuota total       = cuota del crédito + lo que cae A LA CUOTA     ← la etapa `charges`
//
// Cada punto es UNA ETAPA, o sea un nodo en pantalla, y cada uno es la SUMA de sus términos.
//
// ═══ EL MOTOR NO SABE QUÉ ES UNA FIANZA ═══
// Ni un seguro, ni un IVA, ni un 4×1000. No hay bloques cableados: todo costo es un CAMPO que se
// agrega a un punto de inserción, y su definición dice qué hace —
//
//   tipo    monto fijo, o porcentaje
//   base    sobre qué se aplica el porcentaje: la base del punto, u OTRO campo
//   spread  en la cuota: es un total que se reparte, o ya viene por cuota
//
// — así que un campo se lee como una frase: "IVA de la fianza = 19% de fianza". Los campos que
// arrancan puestos (`DEFAULT_FIELDS`) son valores por defecto de la configuración, no lógica del
// motor: se borran con una ×.
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
    // ── el crédito: lo que pide el CLIENTE. No es un punto de inserción, así que acá no se
    //    agregan campos: los costos van al monto o a la cuota.
    { name: 'amount', type: 'money', default: 10000000, min: 0, appliesTo: 'credit',
      label: 'monto', help: 'Lo que el cliente pide. Los costos que se agreguen lo suben o lo bajan.' },
    { name: 'installments', type: 'count', default: 24, min: 1, appliesTo: 'credit',
      label: 'cuotas', help: 'En cuántos pedazos se devuelve.' },
    { name: 'downPayment', type: 'money', default: 0, min: 0, appliesTo: 'credit', sign: -1,
      label: 'cuota inicial',
      help: 'Lo que el cliente pone de su bolsillo. RESTA: se financia menos. Se escribe en positivo; la fórmula la resta.' },

    // ── la tasa
    { name: 'statedRate', type: 'rate', default: 0.02, appliesTo: 'rate',
      label: 'tasa', help: 'En el período que dice el select de la izquierda.' },
    { name: 'compound', type: 'bool', default: true, appliesTo: 'rate',
      label: 'efectiva', help: 'Sí = capitaliza · No = nominal, divide proporcional.' },

    // NADA MÁS. Ni fianza, ni seguro de vida, ni IVA: el motor no sabe qué es ninguna de esas
    // cosas y no tiene por qué saberlo. Todo costo es un CAMPO agregado a un punto de inserción,
    // y su definición dice qué hace. Los que arrancan puestos son valores por defecto de la
    // configuración (ver `DEFAULT_FIELDS`), no lógica: se borran con una ×.
  ],

  /** Los dos puntos de inserción son la SUMA de sus términos, y TODOS los términos vienen de los
   *  campos agregados. La hoja no trae ninguno cableado. */
  terms: [],

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
    // `rows: 'none'` — la etapa SIGUE siendo dueña de las dos fórmulas (es lo que la pone en el
    // grafo y lo que hace que `cuota` dependa de ella), pero no las dibuja: el valor ya está al
    // lado de su input y la E.A. en la barra de arriba.
    { key: 'rate', title: 'tasa', group: 'config', rateBlock: true, rows: 'none',
      formulas: ['periodRate', 'annualEffectiveRate'] },
    // `showRows: false` esconde los PASOS, nunca el resultado: el nodo siempre muestra su última
    // fórmula. Acá los intermedios (fianza, IVA, 4×1000, fianza total) solo repiten los nombres
    // de sus inputs, así que eran ruido.
    // `insertion` es la insignia del encabezado. La llevan EXACTAMENTE estos dos nodos, y dice
    // el criterio con el que se elige entre ellos: si el costo paga intereses o no. Así se leen
    // como par aunque el layout no los ponga lado a lado — no puede, ver abajo.
    // `insertion` marca los dos puntos donde se pueden agregar campos. Ya NO se dibuja como
    // insignia: cuando los dos nodos estaban en columnas distintas era lo único que los hacía leer
    // como par, pero comparten columna y color, así que sobraba. El dato vive en el tooltip.
    { key: 'amount', title: 'al monto', group: 'config', rows: 'out', insertion: true,
      insertionHelp: 'Lo que entra acá se financia, así que PAGA INTERESES en cada cuota.',
      formulas: ['financedAmount'] },
    // Depende de `al monto`, y es un hecho del negocio, no del dibujo: el seguro de vida se
    // calcula sobre `financedAmount`. Con fianza al 5% y seguro 0,0014, financiar la fianza sube
    // el seguro de 14.000 a 14.700 por cuota. Comparten columna igual, porque están en el mismo
    // grupo — y esa dependencia se dibuja como flecha VERTICAL, de abajo de una a arriba de la
    // otra. Así el orden se ve sin que el cable tenga que ir hacia atrás.
    { key: 'charges', title: 'a la cuota', group: 'config', rows: 'out', insertion: true,
      insertionHelp: 'Lo que entra acá viaja arriba de cada pago y nunca entra al saldo, así que '
        + 'NO paga intereses.',
      formulas: ['installmentCharges'] },
    { key: 'installment', title: 'cuota',
      formulas: ['installment', 'totalInstallment'] },
  ],

  /** `appliesTo` que no son una etapa: se dibujan DENTRO de la etapa que los consume. Los de
   *  `blocks` los llena `resolveSheet` con lo que diga `where`, así que acá no van a mano. */
  inputHost: {},

  formulas: {
    // `if()` como selección de parámetro entre las dos convenciones que conviven en CreditOp
    // (ver F-71 en findings) — no es lógica de negocio.
    periodRate: 'if(compound, (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1,'
      + ' statedRate * statedPerYear / periodsPerYear)',
    annualEffectiveRate: '(1 + periodRate) ^ periodsPerYear - 1',

    installment: 'pmt(periodRate, installments, financedAmount)',
    totalInstallment: 'installment + installmentCharges',

    // `financedAmount` y `installmentCharges` las ARMA `resolveSheet` sumando los términos de los
    // campos agregados. Escribirlas acá sería tener dos fuentes para lo mismo.
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
  financedAmount: 'valor a financiar',
  installment: 'cuota del crédito',
  installmentCharges: 'cargos por cuota',
  totalInstallment: 'cuota total',
  periodRate: 'tasa del período',
  annualEffectiveRate: 'tasa efectiva anual',
}

/** Resuelve los períodos declarados a números y los deja como constantes. */
/** La base por defecto de un PORCENTAJE, según dónde caiga. Son las de los casos reales, no una
 *  elección arbitraria: una fianza es un % del monto y un seguro de vida es un % de lo financiado. */
export const RATE_BASE = { amount: 'amount', charges: 'financedAmount' }
export const RATE_BASE_LABEL = { amount: 'el monto', charges: 'el valor a financiar' }

/** Nombres que un campo agregado NO puede pisar. */
const RESERVADOS = new Set(['statedPerYear', 'periodsPerYear', 'i', 'n', 'prev'])

/** Lo que un campo VALE en pesos, para que otro pueda apoyarse en él.
 *  Un monto vale su perilla; un porcentaje y una fórmula valen su fórmula. */
export const enPesos = f => (f.kind === 'money' ? f.name : f.name + 'Value')

/** El campo leído como una frase — es lo que lo hace entendible sin abrir el código. */
export function describir(f, campos = []) {
  if (f.kind === 'formula') return `fórmula: ${f.expr || '(vacía)'}`
  const base = f.base
    ? (campos.find(x => x.name === f.base)?.label ?? f.base)
    : RATE_BASE_LABEL[f.at]
  const qué = f.kind === 'rate' ? `porcentaje sobre ${base}` : 'monto fijo'
  if (f.at !== 'charges') return `${qué}, se suma al monto que se financia`
  return f.spread ? `${qué}, es un TOTAL y se reparte entre las cuotas`
                  : `${qué}, se suma a CADA cuota`
}

/** Resuelve la hoja a lo que el motor come:
 *    · los períodos declarados → constantes numéricas
 *    · los campos agregados → sus inputs y, si son porcentaje, su fórmula
 *    · los dos puntos de inserción → la SUMA de los términos que les llegan
 *
 *  Los campos se resuelven EN ORDEN, así que uno puede apoyarse en otro anterior (el IVA sobre la
 *  fianza) pero nunca en uno posterior: no hay forma de escribir un ciclo.  */
export function resolveSheet(def, { periods = {}, fields = [] } = {}) {
  const p = { ...(def.periods || {}), ...periods }

  const formulas = { ...def.formulas }
  const formulaLabel = { ...FORMULA_LABEL }
  const inputs = [...(def.inputs || [])]
  const terms = [...(def.terms || [])]
  const llegan = {}   // etapa → fórmulas que se calculan ahí

  for (const f of fields) {
    // Una FÓRMULA no tiene perilla: su valor es la expresión. Los otros dos sí, y el tipo decide
    // cómo se escribe el número (pesos con separador de miles, o porcentaje).
    if (f.kind !== 'formula') {
      inputs.push({
        name: f.name, type: f.kind === 'rate' ? 'rate' : 'money', default: 0, min: 0,
        appliesTo: f.at, label: f.label, field: f.id,
        // el calificativo que se ve al lado del nombre: solo lo AMBIGUO, no todo
        note: f.kind === 'rate' && f.base
          ? 'de ' + (fields.find(x => x.name === f.base)?.label ?? f.base)
          : f.at === 'charges' && f.spread ? '÷ cuotas' : '',
        help: describir(f, fields),
      })
    }
    if (f.kind === 'rate') {
      const v = f.name + 'Value'
      // La base se resuelve A PESOS: si es otro campo, su valor en pesos, no su perilla. Sin esto
      // el "IVA de la fianza" se calculaba sobre la TASA de la fianza (0,05 × 0,19 = 0,0095 pesos)
      // en vez de sobre sus pesos, y el error era invisible porque quedaba en el redondeo.
      const otro = fields.find(x => x.name === f.base)
      const base = otro ? enPesos(otro) : (f.base || RATE_BASE[f.at])
      formulas[v] = `${base} * ${f.name}`
      formulaLabel[v] = f.label
      llegan[f.at] = [...(llegan[f.at] || []), v]
    }
    if (f.kind === 'formula') {
      // Se pasa TAL CUAL. Una expresión inválida, un ciclo o una referencia que no existe los caza
      // el motor y quedan como `status: 'error'` con su razón — no hace falta validar acá, y por
      // eso una fórmula se puede escribir en vivo sin que nada explote.
      formulas[f.name + 'Value'] = f.expr?.trim() || '0'
      formulaLabel[f.name + 'Value'] = f.label
      llegan[f.at] = [...(llegan[f.at] || []), f.name + 'Value']
    }
    terms.push({ value: enPesos(f), at: f.at, spread: !!f.spread })
  }

  // ── los dos puntos de inserción son la SUMA de lo que les llega
  const suma = etapa => terms.filter(t => t.at === etapa)
    .map(t => (etapa === 'charges' && t.spread ? `${t.value} / installments` : t.value))
  formulas.financedAmount = ['amount - downPayment', ...suma('amount')].join(' + ')
  formulas.installmentCharges = suma('charges').join(' + ') || '0'

  const stages = (def.stages || []).map(st => ({
    ...st, formulas: [...(llegan[st.key] || []), ...st.formulas],
  }))

  return {
    ...def, stages, inputs, formulas, formulaLabel, terms, fields,
    constants: {
      ...def.constants,
      statedPerYear: PERIODS[p.rateStatedIn],
      periodsPerYear: PERIODS[p.chargedEvery],
    },
  }
}

/** Un nombre de variable válido a partir de la etiqueta que escribió el usuario.
 *  "IVA de la fianza" → `ivaDeLaFianza`. Lo que importa es que sea un identificador que el
 *  tokenizer acepte, sin tildes ni espacios. */
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

/** Los campos con los que arranca la app. NO son lógica del motor: son la configuración que uno
 *  esperaría ver en un lender típico, puesta como campos normales y en cero. Se borran con una ×,
 *  y ahí el nodo queda vacío — que es el estado del que se parte para configurar otro. */
export const DEFAULT_FIELDS = [
  { label: 'fianza', kind: 'rate', at: 'amount' },
  { label: 'IVA de la fianza', kind: 'rate', at: 'amount', baseOf: 'fianza' },
  { label: 'seguro de vida', kind: 'rate', at: 'charges' },
]

export function defaultInputs(def) {
  const o = {}
  for (const it of def.inputs || []) o[it.name] = it.default
  return o
}
