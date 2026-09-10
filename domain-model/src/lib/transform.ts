import dagre from 'dagre'
import type { Edge, Node } from '@vue-flow/core'
import { MarkerType } from '@vue-flow/core'
import type { Entidad, Modelo } from './types'

// Paleta estable por contexto (los 8 contextos del modelo).
export const CONTEXT_COLORS: Record<string, string> = {
  geography: '#0ea5e9',
  identity: '#10b981',
  commerce: '#f59e0b',
  credit: '#ef4444',
  origination: '#6366f1',
  creditopX: '#ec4899',
  decisioning: '#0891b2',
  platform: '#475569',
}

export const contextColor = (ctx: string) => CONTEXT_COLORS[ctx] ?? '#64748b'

// Etiquetas de contexto en inglés (las del JSON vienen en español). Mantiene
// consistencia con los nombres de entidad/columna, que ya están en inglés.
export const CONTEXT_LABELS: Record<string, string> = {
  geography: 'Geography',
  identity: 'Identity',
  commerce: 'Commerce',
  credit: 'Credit',
  origination: 'Origination',
  creditopX: 'Creditop X',
  decisioning: 'Decisioning',
  platform: 'Plataforma AWS',
}

export const contextLabel = (ctx: string) => CONTEXT_LABELS[ctx] ?? ctx

const NODE_W = 240
// alto aproximado: header (44) + n columnas * 22 + padding
const rowH = 22
const headerH = 46
const nodeHeight = (e: Entidad) => headerH + e.atributos.length * rowH + 8

// Devuelve un handle de columna válido o cae al PK / primera columna.
function pickHandle(e: Entidad, preferred?: string): string {
  const names = e.atributos.map((a) => a.n)
  if (preferred && names.includes(preferred)) return preferred
  if (e.identidad && names.includes(e.identidad)) return e.identidad
  return names[0] ?? 'id'
}

/* El tamaño que va a ocupar un nodo en el lienzo. Lo exporta porque el encuadre necesita el alto REAL
 * —cada tabla mide según cuántas columnas tiene— para saber si un subgrafo cabe legible o no. */
export function tamanoDeNodo(n: Node): { w: number; h: number } {
  return { w: NODE_W, h: nodeHeight((n.data as any).entidad as Entidad) }
}

export interface BuildResult {
  nodes: Node[]
  edges: Edge[]
}

export function buildGraph(modelo: Modelo): BuildResult {
  const byKey = new Map(modelo.entidades.map((e) => [e.key, e]))

  // FK por entidad: nombres de columna que participan en una relación (rol).
  const fkByEntity = new Map<string, Set<string>>()
  for (const e of modelo.entidades) {
    const set = new Set<string>()
    for (const r of e.relaciones ?? []) if (r.rol) set.add(r.rol)
    fkByEntity.set(e.key, set)
  }

  const nodes: Node[] = modelo.entidades.map((e) => ({
    id: e.key,
    type: 'table',
    position: { x: 0, y: 0 },
    data: {
      entidad: e,
      contextoName: contextLabel(e.contexto),
      fkColumns: fkByEntity.get(e.key) ?? new Set(),
      dimmed: false,
      selected: false,
      vecina: false,
      resultado: false,
    },
  }))

  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const e of modelo.entidades) {
    for (const r of e.relaciones ?? []) {
      const target = byKey.get(r.a)
      if (!target) continue
      const id = `${e.key}->${r.a}:${r.rol ?? ''}`
      if (seen.has(id)) continue
      seen.add(id)
      const color = contextColor(e.contexto)
      edges.push({
        id,
        source: e.key,
        target: r.a,
        sourceHandle: `s-${pickHandle(e, r.rol)}`,
        targetHandle: `t-${pickHandle(target, target.identidad)}`,
        type: 'smoothstep',
        animated: false,
        label: r.card,
        data: { tipo: r.tipo, contexto: e.contexto },
        style: {
          stroke: color,
          strokeWidth: r.tipo === 'referencia' ? 1.5 : 2,
          strokeDasharray: r.tipo === 'referencia' ? '5 4' : undefined,
        },
        labelStyle: { fontSize: '10px', fill: '#475569' },
        labelBgStyle: { fill: '#fff', fillOpacity: 0.85 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      })
    }
  }

  return { nodes, edges }
}

// Layout jerárquico con dagre. dir: LR (izq→der) por defecto.
export function layout(
  nodes: Node[],
  edges: Edge[],
  dir: 'LR' | 'TB' = 'LR',
): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: dir, nodesep: 40, ranksep: 90, marginx: 30, marginy: 30 })

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: nodeHeight(n.data!.entidad) })
  }
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  return nodes.map((n) => {
    const { x, y } = g.node(n.id)
    return {
      ...n,
      position: { x: x - NODE_W / 2, y: y - nodeHeight(n.data!.entidad) / 2 },
    }
  })
}

// Layout agrupado por contexto: cada contexto se organiza con su propio dagre
// (solo aristas intra-contexto) y los bloques se empacan en una grilla. Lee mucho
// mejor para un ERD de dominio porque mantiene juntas las tablas de cada agregado.
// Orden canónico de los 8 contextos (mismo orden que `contextos` en modelo-dominio.json).
const CTX_ORDER = [
  'geography',
  'identity',
  'commerce',
  'credit',
  'origination',
  'creditopX',
  'decisioning',
  'platform',
]

export function layoutClustered(
  nodes: Node[],
  edges: Edge[],
  cols = 3,
  dir: 'LR' | 'TB' = 'TB',
  groupOf?: (n: Node) => string,
  order?: string[],
): Node[] {
  const gap = 90
  const groupKey = groupOf ?? ((n: Node) => (n.data as any).entidad.contexto as string)
  const ord = order ?? CTX_ORDER
  const byCtx = new Map<string, Node[]>()
  for (const n of nodes) {
    const c = groupKey(n)
    if (!byCtx.has(c)) byCtx.set(c, [])
    byCtx.get(c)!.push(n)
  }
  const ctxKeys = [...byCtx.keys()].sort((a, b) => ord.indexOf(a) - ord.indexOf(b))

  // 1) layout interno de cada contexto → bloque con bbox local
  const blocks = ctxKeys.map((ctx) => {
    const block = byCtx.get(ctx)!
    const ids = new Set(block.map((n) => n.id))
    const intra = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    const laid = layout(block, intra, dir)
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const n of laid) {
      const h = headerH + (n.data as any).entidad.atributos.length * rowH + 8
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + NODE_W)
      maxY = Math.max(maxY, n.position.y + h)
    }
    return { ctx, laid, w: maxX - minX, h: maxY - minY, minX, minY }
  })

  // 2) empacar bloques en grilla con filas de altura variable
  const colW = Math.max(...blocks.map((b) => b.w)) + gap
  const out: Node[] = []
  let row = 0
  let rowY = 0
  let rowMaxH = 0
  blocks.forEach((b, i) => {
    const col = i % cols
    if (col === 0 && i > 0) {
      rowY += rowMaxH + gap * 1.4
      rowMaxH = 0
      row++
    }
    const ox = col * colW
    const oy = rowY
    for (const n of b.laid) {
      out.push({
        ...n,
        position: { x: ox + (n.position.x - b.minX), y: oy + (n.position.y - b.minY) },
      })
    }
    rowMaxH = Math.max(rowMaxH, b.h)
  })
  void row
  return out
}

/* VECINDAD CERRADA de un conjunto de entidades: ellas mismas más lo que está a `saltos` aristas.
 *
 * Existe en plural porque el buscador la necesita así: una consulta puede matchear varias entidades y
 * lo que hay que mostrar es la vecindad de TODAS, no la de cada una por separado. Un salto es el
 * default a propósito — es «con qué se une esto», que es la pregunta que uno le hace a un ERD; a dos
 * saltos, en este modelo, ya vuelve medio grafo.
 *
 * Acepta la forma mínima {source,target} para evitar la profundidad del genérico Edge. */
export function vecindad(
  claves: Iterable<string>,
  edges: { source: string; target: string }[],
  saltos = 1,
): Set<string> {
  const set = new Set<string>(claves)
  for (let i = 0; i < saltos; i++) {
    // La frontera de esta ronda, para no volver a expandir lo que ya está adentro.
    const frontera = new Set<string>()
    for (const e of edges) {
      if (set.has(e.source) && !set.has(e.target)) frontera.add(e.target)
      if (set.has(e.target) && !set.has(e.source)) frontera.add(e.source)
    }
    if (!frontera.size) break
    for (const k of frontera) set.add(k)
  }
  return set
}

/* ACOMODAR UNA VECINDAD: la coincidencia al centro, las vecinas en anillo alrededor.
 *
 * ⚠ No es dagre, y el motivo se midió mirándolo. Una vecindad es una ESTRELLA, y dagre pone todas las
 * hojas en el mismo rango: las 29 vecinas de `user_requests` quedaban en UNA fila de ~7.600 px, así que
 * el encuadre bajaba a zoom 0,1 y no se leía ni un nombre. Acá las vecinas se reparten en columnas a
 * los dos lados y ENVUELVEN cuando la columna se llena, así que el bloque queda ancho y alto en vez de
 * ancho y plano — y lo buscado queda en el medio, que es donde uno lo busca.
 *
 * Devuelve SÓLO los nodos que acomodó, con su posición nueva. */
export function layoutVecindad(coincidencias: Node[], vecinas: Node[]): Node[] {
  const gapX = 70
  const gapY = 26
  const colW = NODE_W + gapX

  const alto = (n: Node) => nodeHeight((n.data as any).entidad as Entidad)
  const apilar = (ns: Node[], x: number): Node[] => {
    const h = ns.reduce((t, n) => t + alto(n) + gapY, -gapY)
    let y = -h / 2
    return ns.map((n) => {
      const p = { x, y }
      y += alto(n) + gapY
      return { ...n, position: p }
    })
  }

  const centro = apilar(coincidencias, 0)
  const altoCentro = coincidencias.reduce((t, n) => t + alto(n) + gapY, -gapY)

  /* Alto objetivo de cada columna del anillo: al menos lo que mide el centro, y nunca tan poco que
   * una vecinaSuelta abra una columna nueva. */
  const objetivo = Math.max(altoCentro, 760)
  const columnas: Node[][] = []
  let actual: Node[] = []
  let acumulado = 0
  for (const v of vecinas) {
    const h = alto(v) + gapY
    if (actual.length && acumulado + h > objetivo) {
      columnas.push(actual)
      actual = []
      acumulado = 0
    }
    actual.push(v)
    acumulado += h
  }
  if (actual.length) columnas.push(actual)

  /* Las columnas se alternan derecha/izquierda desde el centro hacia afuera, así el bloque crece
   * parejo a los dos lados en vez de irse para un lado solo. */
  const out = [...centro]
  columnas.forEach((col, i) => {
    const paso = Math.floor(i / 2) + 1
    const x = i % 2 === 0 ? paso * colW : -paso * colW
    out.push(...apilar(col, x))
  })
  return out
}

// vecinos directos (in/out) de UNA entidad — para el modo resaltado del clic.
export function neighborsOf(
  key: string,
  edges: { source: string; target: string }[],
): Set<string> {
  return vecindad([key], edges, 1)
}
