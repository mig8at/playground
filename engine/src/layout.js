import { FORMULA_LABEL } from './sheets.js'

// `formulaLabel` viene de la hoja RESUELTA, así que trae también la de los campos agregados a
// mano. FORMULA_LABEL es el fallback para cuando se llama con una hoja sin resolver.

// el crédito → (tasa ∥ al monto) → a la cuota → cuota → plan de pagos.
// Cada etapa es AUTOCONTENIDA: trae sus propios inputs y sus propias fórmulas.
//
// Ninguna columna está escrita a mano: la profundidad sale de las dependencias REALES del AST.
// Por eso `tasa` y `al monto` caen en paralelo (ninguna depende de la otra) y `a la cuota` cae
// después de `al monto` — porque el seguro de vida se calcula sobre lo financiado. Ese hecho
// no está declarado en ningún lado: lo dibuja la fórmula.
// El nodo mide 296 y la etiqueta del cable lleva nombre + valor ("valor a financiar
// 10.000.000"), así que la columna tiene que dejarle ~150px o se corta detrás del nodo.
const COL_W = 452
const GAP_Y = 34

// El alto de la tabla, MEDIDO en el DOM y no estimado: 53 de chrome + 20 por fila, con un tope
// de 430 (a partir de ahí scrollea). Comprobado con n = 1 · 2 · 6 · 12 · 24.
const seriesH = n => Math.min(430, 53 + n * 20)

export function layoutSheet(def, out, opts = {}) {
  // `nPlazos` — cuántas filas tiene la vitrina. Viene de afuera porque la lista de plazos es estado
  // de la app, no de la hoja resuelta, y el alto tiene que contarla o los nodos se solapan.
  const { inputValues = {}, nPlazos = 0 } = opts
  const stages = def.stages || []

  const nodes = []
  const edges = []
  const host = def.inputHost || {}
  // a qué etapa pertenece cada input: su `appliesTo`, o el anfitrión si no es una etapa
  const etapaDe = a => host[a] || a

  const LBL = def.formulaLabel || FORMULA_LABEL
  const porNombre_ = Object.fromEntries((def.inputs || []).map(i => [i.name, i]))
  /** La expresión, para MOSTRAR: los `name` traducidos a su label y `*` como `×`.
   *
   *  La regla de la hoja es que la UI nunca muestra un `name` — y las filas de expresión la estaban
   *  rompiendo con `fianzaValue * ivaDeLaFianza`. Esto es SOLO presentación: el editor sigue en
   *  crudo (ahí se escriben los nombres) y el documento guarda los nombres.  */
  const traducir = expr => String(expr || '')
    .replace(/[A-Za-z_][A-Za-z0-9_.]*/g, id => LBL[id] || porNombre_[id]?.label || id)
    .replace(/\*/g, '×')
  // `verExpr`: la fila muestra su EXPRESIÓN debajo del nombre. Se prende cuando la perilla del campo
  // vive en otra etapa — es el caso de `tarifas` → `costos al monto`, donde el nodo de abajo mostraba
  // los pesos pero no de dónde salían. Ahí la expresión es lo que hace entendible la configuración
  // sin tener que meter el 10% dentro de la fórmula (que ataría la hoja a un solo lender).
  const row = (name, verExpr = false, ajena = false) => ({
    name, expr: def.formulas[name], exprEs: traducir(def.formulas[name]),
    label: LBL[name] || name, verExpr, ajena,
    status: out.res[name]?.status ?? 'skipped',
    value: out.res[name]?.status === 'ok' ? out.res[name].value : undefined,
  })
  // el alto cuenta TODO lo que hay adentro: inputs propios, el bloque de tasa, la sección de
  // fianza con su encabezado, y las fórmulas. Contar solo las fórmulas hacía que los nodos de
  // una misma columna se solaparan.
  const propios = k => (def.inputs || []).filter(i => etapaDe(i.appliesTo) === k)
  // Un campo FÓRMULA no es un input, así que `propios` no lo ve: hay que contarlo aparte o los
  // nodos de una misma columna se solapan y los clicks caen en el nodo equivocado. Ocupa dos filas
  // (nombre + expresión, y el resultado debajo). Y el botón `+ campo` también ocupa.
  // el editor de la expresión se dibuja donde vive la perilla, igual que los demás inputs
  const formulas_ = k => (def.fields || []).filter(f => f.kind === 'formula' && etapaDe(f.at) === k)
  const stageH = st => {
    const ins = propios(st.key)
    const enBloque = st.rateBlock ? ins.filter(i => ['statedRate', 'compound'].includes(i.name)).length : 0
    return 40
      + (ins.length - enBloque) * 21
      + (st.rateBlock ? 75 : 0)    // medido en el DOM, no estimado (era 113 con el panel viejo)
      + formulas_(st.key).length * 38
      + (st.insertion ? 24 : 0)    // el botón `+ campo`
      // la lista de plazos y la vitrina también ocupan: sin contarlas, los nodos de una misma
      // columna se solapan y los clicks caen en el nodo equivocado
      + (st.termsEditor ? 26 : 0)
      + (st.termsCompare && nPlazos ? 20 + nPlazos * 19 : 0)
      + (cuantasFilas(st) ? 8 + cuantasFilas(st) * 22 : 0)
      + 12
  }
  const salida = st => (st && st.formulas.length ? st.formulas[st.formulas.length - 1] : null)
  // La fórmula que genera un CAMPO se dibuja como fila SOLO si su perilla vive en otro nodo.
  //
  // En el mismo nodo sería un duplicado —el valor ya se ve en la línea del campo, con su perilla o
  // su expresión— y ponía "seguro de vida" dos veces. Pero cuando `inputHost` manda las perillas a
  // una etapa aparte, esa fila es justamente el punto: arriba las tarifas, abajo los pesos.
  const deCampo = new Map((def.fields || [])
    .map(f => [f.name + 'Value', etapaDe(f.at)]))   // fórmula → dónde vive su perilla
  // `aliasRows` las marca `resolveSheet`: un subtotal de un solo término es una copia de ese
  // término, así que no se dibuja (sigue existiendo como fórmula, la necesita el total).
  const alias = new Set(def.aliasRows || [])
  // `alsoShow` son valores de OTRA etapa que esta dibuja para que su suma cierre. No los posee —no
  // cambian el grafo ni las dependencias— solo se leen.
  //
  // Y un nodo que se lee como SUMA no esconde ninguno de sus términos: `aliasRows` existe para no
  // repetir un subtotal en una LISTA, pero en una suma esconder un término deja un total que no
  // coincide con lo que está arriba — el mismo defecto que `alsoShow` vino a arreglar.
  const visibles = st => [
    ...(st.alsoShow || []),
    ...st.formulas.filter(f =>
      deCampo.get(f) !== st.key && (st.sumRows || !alias.has(f))),
  ]
  // `rows` dice CUÁNTAS de sus fórmulas dibuja una etapa. Es distinto de cuáles POSEE: `tasa` es
  // dueña de las suyas —eso es lo que la pone en el grafo y lo que hace que `cuota` dependa de
  // ella— y no dibuja ninguna.
  //   'all' (por defecto) todas · 'out' solo la salida · 'none' ninguna
  const cuantasFilas = st => {
    const v = visibles(st).length
    return st.rows === 'none' ? 0 : st.rows === 'out' ? Math.min(1, v) : v
  }

  // qué etapa depende de qué etapa. Cuenta las fórmulas Y los inputs: si una etapa lee un
  // input que vive en otra, eso ES una dependencia (y es lo que pone `el crédito` primero).
  const dueño = {}
  stages.forEach(st => st.formulas.forEach(f => (dueño[f] = st.key)))
  for (const i of def.inputs || []) dueño[i.name] = etapaDe(i.appliesTo)
  const dep = new Map(stages.map(st => [st.key, new Map()]))
  for (const st of stages) {
    for (const f of st.formulas) {
      for (const d of new Set(out.deps[f] || [])) {
        const otra = dueño[d]
        if (otra && otra !== st.key) {
          if (!dep.get(st.key).has(otra)) dep.get(st.key).set(otra, new Set())
          dep.get(st.key).get(otra).add(d)
        }
      }
    }
  }

  // ── columnas ──
  // Un `group` en la hoja hace que varias etapas COMPARTAN columna, porque son la misma clase de
  // cosa. Para calcular la profundidad se CONDENSA cada grupo en un solo nodo: así la dependencia
  // interna (`a la cuota` lee `al monto`) no empuja de columna. Esa flecha se dibuja vertical.
  const grupoDe = Object.fromEntries(stages.map(st => [st.key, st.group || null]))
  const cond = k => (grupoDe[k] ? '@g:' + grupoDe[k] : k)
  const depC = new Map()
  for (const st of stages) {
    const a = cond(st.key)
    if (!depC.has(a)) depC.set(a, new Set())
    for (const o of dep.get(st.key).keys()) if (cond(o) !== a) depC.get(a).add(cond(o))
  }
  const sinFormulas = new Set(stages.filter(st => !st.formulas.length).map(st => st.key))
  const profC = {}
  const dC = n => {
    if (profC[n] != null) return profC[n]
    if (sinFormulas.has(n)) return (profC[n] = 0)   // una etapa sin fórmulas va primero
    profC[n] = 1                                    // guarda contra ciclos
    const ds = [...(depC.get(n) || [])]
    profC[n] = ds.length ? 1 + Math.max(...ds.map(dC)) : 1
    return profC[n]
  }
  const prof = {}
  for (const st of stages) prof[st.key] = dC(cond(st.key))

  // Qué handles necesita cada etapa. Se calcula acá y no en el nodo porque depende de las aristas:
  // los verticales solo existen si hay una dependencia DENTRO del grupo, y el de la izquierda solo
  // si algo la apunta desde AFUERA. Así ningún nodo muestra puntos que no usa.
  const vArriba = new Set(), vAbajo = new Set(), entra = new Set()
  for (const st of stages) {
    for (const o of dep.get(st.key).keys()) {
      if (grupoDe[st.key] && grupoDe[o] === grupoDe[st.key]) { vArriba.add(st.key); vAbajo.add(o) }
      else entra.add(st.key)
    }
  }

  const cols = new Map()
  for (const st of stages) {
    const c = prof[st.key]
    if (!cols.has(c)) cols.set(c, [])
    cols.get(c).push(st)
  }
  const maxCol = Math.max(...[...cols.keys()])

  // ── las filas ──
  // Se recorre de IZQUIERDA A DERECHA y cada etapa se alinea con la fila de su dependencia
  // principal (la más profunda). Centrar cada columna por su cuenta dejaba en diagonal a etapas
  // que se leen juntas.
  const altoCol = c => cols.get(c).reduce((h, st) => h + stageH(st) + GAP_Y, -GAP_Y)
  const porClave = Object.fromEntries(stages.map(st => [st.key, st]))
  const fila = {}
  // dónde QUIERE estar: centrada contra sus dependencias más profundas. Cuando varias empatan en
  // profundidad se centra contra el CONJUNTO — sin eso, una etapa que lee las tres del grupo se
  // pegaba a la primera y quedaba arriba de todo el grafo.
  const quiere = st => {
    const ds = [...dep.get(st.key).keys()].filter(k => fila[k] != null)
    if (!ds.length) return 0
    const max = Math.max(...ds.map(k => prof[k]))
    const top = ds.filter(k => prof[k] === max)
    return top.reduce((a, k) => a + fila[k] + stageH(porClave[k]) / 2, 0) / top.length
      - stageH(st) / 2
  }
  for (const c of [...cols.keys()].sort((a, b) => a - b)) {
    const sts = cols.get(c)
    if (sts.length === 1) { fila[sts[0].key] = quiere(sts[0]); continue }
    // varias comparten columna: se reparten alrededor del promedio de donde quieren estar
    const centro = sts.reduce((a, st) => a + quiere(st) + stageH(st) / 2, 0) / sts.length
    let y = centro - altoCol(c) / 2
    for (const st of sts) { fila[st.key] = y; y += stageH(st) + GAP_Y }
  }
  // La primera columna no tiene nada que la ancle. Sin esto el nodo inicial queda más arriba que
  // todo el grafo, así que se centra contra lo que depende de él.
  // Ojo: la primera columna NO es siempre la 0 — desde que `el crédito` calcula el monto neto,
  // ninguna etapa cae en profundidad 0. Hay que tomar la mínima que exista.
  const primera = cols.get(Math.min(...cols.keys())) || []
  if (primera.length === 1) {
    const st = primera[0]
    const hijos = stages.filter(x => dep.get(x.key).has(st.key))
    if (hijos.length) {
      fila[st.key] = hijos.reduce((a, x) => a + fila[x.key] + stageH(x) / 2, 0) / hijos.length
        - stageH(st) / 2
    }
  }

  for (const [c, sts] of cols) {
    for (const st of sts) {
      nodes.push({
        id: '@st:' + st.key, type: 'stageNode', position: { x: c * COL_W, y: fila[st.key] },
        data: {
          key: st.key, title: st.title, rateBlock: !!st.rateBlock, group: st.group,
          insertion: st.insertion, insertionHelp: st.insertionHelp,
          termsEditor: !!st.termsEditor, termsCompare: !!st.termsCompare,
          hUp: vArriba.has(st.key), hDown: vAbajo.has(st.key), hIn: entra.has(st.key),
          nFilas: cuantasFilas(st),
          // la expresión se ve cuando la perilla del campo está en OTRA etapa
          sumRows: !!st.sumRows,
          rows: visibles(st).map(f => row(f, deCampo.has(f), (st.alsoShow || []).includes(f))),
          inputs: (def.inputs || []).filter(i => etapaDe(i.appliesTo) === st.key),
        },
      })
    }
  }

  // entre etapas, con etiqueta de qué cruza
  // La arista lleva NOMBRE + VALOR. Importa cuando la etapa origen no muestra sus fórmulas
  // (`showRows: false`): ahí el cable es el único lugar donde se ve el resultado.
  //
  // Un cable puede llevar varios valores (`el crédito` le manda `amount` y `installments` a
  // `a la cuota`). Rotular "2 valores" era honesto pero inútil: se rotula la SALIDA de la etapa
  // origen, que es la que interesa, y se cuenta el resto con `+N`.
  const porNombre = Object.fromEntries((def.inputs || []).map(i => [i.name, i]))
  const fmt = v => (Math.abs(v) < 1 && v !== 0
    ? (v * 100).toFixed(4).replace(/0+$/, '').replace(/[.,]$/, '').replace('.', ',') + '%'
    : Math.round(v).toLocaleString('es-CO'))
  const etiqueta = n => {
    const nom = LBL[n] || porNombre[n]?.label || n
    const r = out.res[n]
    if (r?.status === 'ok') return nom + ' ' + fmt(r.value)          // es una fórmula
    const v = inputValues[n]                                        // es un input
    if (v === true) return nom + ' sí'
    if (v === false) return nom + ' no'
    return v === '' || v == null ? nom : nom + ' ' + fmt(Number(v))
  }
  for (const st of stages) {
    for (const [otra, via] of dep.get(st.key)) {
      const stOtra = stages.find(x => x.key === otra)
      const salidaOtra = salida(stOtra)
      // Una etapa SIN fórmulas propias es un nodo de puras perillas (`inputsOf`). Ahí no hay una
      // salida que rotular, y poner la primera que cruce engañaba —"fianza 10% +1" se lee como si
      // solo cruzara la fianza. Los nombres ya están en los dos nodos, así que va sin etiqueta.
      const cual = salidaOtra ? (via.has(salidaOtra) ? salidaOtra : [...via][0]) : null
      // Dentro del grupo la flecha BAJA; entre grupos sale por el costado derecho y entra por el
      // izquierdo. Los handles van SIEMPRE explícitos: una etapa con flecha interna tiene DOS
      // handles de salida (`down` y `out`), y sin decir cuál, Vue Flow tomaba el primero — la
      // arista externa de `el crédito` salía por ABAJO en vez de por el costado.
      const interno = grupoDe[st.key] && grupoDe[otra] === grupoDe[st.key]
      edges.push({
        id: otra + '->' + st.key, source: '@st:' + otra, target: '@st:' + st.key,
        sourceHandle: interno ? 'down' : 'out', targetHandle: interno ? 'up' : 'in',
        label: cual ? etiqueta(cual) + (via.size > 1 ? ` +${via.size - 1}` : '') : '',
        // el `+N` era un misterio: el tooltip lista todo lo que cruza, con su nombre en español
        ...(via.size > 1 ? { labelBgStyle: { fill: 'transparent' },
          data: { cruzan: [...via].map(n => LBL[n] || porNombre[n]?.label || n).join(' · ') } } : {}),
        style: { strokeWidth: 1.5, opacity: interno ? .7 : .85 },
      })
    }
  }

  // la tabla, al final
  const S = out.series
  const alimenta = stages.find(st => salida(st) === def.output)
  if (S) {
    nodes.push({
      // la tabla se CENTRA contra la etapa que la alimenta. Alinearla por el borde superior la
      // dejaba colgando y el grafo entero quedaba pesado abajo.
      id: '@series', type: 'seriesNode',
      position: {
        x: (maxCol + 1) * COL_W,
        y: alimenta ? fila[alimenta.key] + stageH(alimenta) / 2 - seriesH(S.rows?.length || 0) / 2 : 0,
      },
      data: {
        title: 'Plan de pagos', cols: S.cols || [], rows: S.rows || [],
        error: S.error, labels: def.series?.labels || {},
      },
    })
    if (alimenta) {
      edges.push({
        id: 'stage->series', source: '@st:' + alimenta.key, target: '@series', sourceHandle: 'out',
        // con `etiqueta` y no solo el nombre: todos los demás cables llevan su valor
        label: etiqueta(def.output), style: { strokeWidth: 1.6 },
      })
    }
  }
  return { nodes, edges }
}
