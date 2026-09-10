<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, onMounted } from 'vue'
import { VueFlow, useVueFlow, type Edge, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import TableNode from '../components/TableNode.vue'
import DetailPanel from '../components/DetailPanel.vue'
import {
  buildGraph,
  layoutClustered,
  layoutVecindad,
  neighborsOf,
  tamanoDeNodo,
  vecindad,
  contextColor,
  contextLabel,
} from '../lib/transform.js'
import type { Modelo } from '../lib/types.js'
import raw from '../data/modelo-dominio.json'

const modelo = raw as unknown as Modelo
const STORAGE_KEY = 'creditop-erd-positions-v1'
const VECINAS_KEY = 'creditop-erd-vecinas-v1'
/* Arriba de esta fracción del modelo, la consulta ya no describe una vecindad —una consulta de una
 * letra trae casi todo— y reacomodar casi todo destruiría el agrupamiento por contexto, que es lo que
 * hace legible el mapa completo. Ahí se deja el mapa quieto y sólo se filtra. */
const FRACCION_ACOMODAR = 0.6

const { fitView, onNodeClick, onPaneClick, onNodeDragStop } = useVueFlow()

const built = buildGraph(modelo)
const dir: 'LR' | 'TB' = 'TB'

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}
function savePositions(ns: Node[]) {
  const map: Record<string, { x: number; y: number }> = {}
  for (const n of ns) map[n.id] = n.position
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  // La base es lo guardado: a esto se vuelve cuando el buscador suelta el subgrafo.
  for (const n of ns) posicionesBase.set(n.id, n.position)
}

function initialLayout(): Node[] {
  const saved = loadPositions()
  const laid = layoutClustered(built.nodes, built.edges, 3, dir)
  if (Object.keys(saved).length) {
    return laid.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n))
  }
  return laid
}

const nodes = shallowRef<Node[]>(initialLayout())
const edges = shallowRef<Edge[]>(built.edges)

// ---- estado de UI ----
const contexts = modelo.contextos
const active = ref<Set<string>>(new Set(contexts.map((c) => c.key)))
const selectedKey = ref<string | null>(null)
const query = ref('')
/* «de pronto sus conexiones más cercanas»: el buscador muestra la coincidencia y UN salto de vecinas.
 * Es una perilla y no una decisión fija porque las dos vistas contestan cosas distintas — la tabla sola
 * dice «existe y así es», con sus vecinas dice «con qué se une». Se recuerda entre sesiones. */
const conVecinas = ref<boolean>(localStorage.getItem(VECINAS_KEY) !== '0')
// Los dos conteos van separados: mezclarlos haría que el buscador diga que encontró lo que no encontró.
const nCoincidencias = ref<number | null>(null)
const nVecinas = ref(0)

// Lo último que resolvió `applyView`: `acomodar` necesita saber qué es coincidencia y qué es vecina.
let coincidenciaActual: Set<string> | null = null

/* Las posiciones del mapa completo, para poder VOLVER. El buscador acomoda el subgrafo que muestra, y
 * sin esta copia no habría cómo deshacerlo al borrar la consulta. */
const posicionesBase = new Map<string, { x: number; y: number }>()

// busca por nombre/clave (nueva), por tabla legacy base (vieja),
// y por las tablas viejas absorbidas/unificadas en esta entidad
function matchesQuery(e: {
  name: string
  key: string
  legacy?: { tabla?: string; ref?: string; absorbe?: string[] }
}): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  if (e.name.toLowerCase().includes(q) || e.key.toLowerCase().includes(q)) return true
  const l = e.legacy
  if (!l) return false
  return (
    (l.tabla ?? '').toLowerCase().includes(q) ||
    (l.ref ?? '').toLowerCase().includes(q) ||
    !!l.absorbe?.some((t) => t.toLowerCase().includes(q))
  )
}

const selectedEntidad = computed(
  () => modelo.entidades.find((e) => e.key === selectedKey.value) ?? null,
)

const counts = computed(() => {
  const c: Record<string, number> = {}
  for (const e of modelo.entidades) c[e.contexto] = (c[e.contexto] || 0) + 1
  return c
})

/* ---- aplicar filtros/resaltado a nodes & edges ----
 *
 * ⚠ EL BUSCADOR NO ES UN FILTRO A SECAS, y ahí está el cambio. Antes escondía todo lo que no coincidía,
 * y como las vecinas quedaban escondidas **las aristas también** (una arista se esconde si le falta una
 * punta): el resultado eran cajas sueltas, cada una en el lugar donde estaba en el mapa grande, sin una
 * sola línea. O sea que el buscador contestaba «existe» y borraba justo lo que un ERD sirve para
 * contestar, que es con qué se une. Ahora muestra la coincidencia **y un salto de vecinas**, que llevan
 * sus aristas puestas.
 *
 * Y los chips de contexto siguen mandando sobre las dos: una vecina de un contexto apagado no aparece.
 * Apagar un contexto es una decisión explícita; que el buscador la pise sería peor que el hueco. */
function applyView() {
  const hayConsulta = !!query.value.trim()
  const enContexto = (id: string, ctx: string) => active.value.has(ctx) && !!id

  // 1. lo que coincide DE VERDAD con lo escrito (null = no hay consulta, se ve todo)
  const coincide = hayConsulta
    ? new Set(
        nodes.value
          .filter((n) => active.value.has(n.data!.entidad.contexto) && matchesQuery(n.data!.entidad))
          .map((n) => n.id),
      )
    : null

  // 2. lo que se MUESTRA: la coincidencia y, si está pedido, su vecindad a un salto
  const mostrar =
    coincide && conVecinas.value
      ? vecindad(coincide, edges.value as { source: string; target: string }[], 1)
      : coincide

  const neigh = selectedKey.value
    ? neighborsOf(selectedKey.value, edges.value as { source: string; target: string }[])
    : null

  let vecinasVisibles = 0
  nodes.value = nodes.value.map((n): any => {
    const ctx = n.data!.entidad.contexto
    const hidden = !enContexto(n.id, ctx) || (!!mostrar && !mostrar.has(n.id))
    const vecina = !hidden && !!coincide && !coincide.has(n.id)
    if (vecina) vecinasVisibles++
    const dimmed = !!neigh && !neigh.has(n.id)
    return {
      ...n,
      hidden,
      data: {
        ...n.data!,
        dimmed,
        vecina,
        resultado: !hidden && !!coincide && coincide.has(n.id),
        selected: n.id === selectedKey.value,
      },
    }
  })
  coincidenciaActual = coincide
  nCoincidencias.value = coincide ? coincide.size : null
  nVecinas.value = vecinasVisibles

  const visible = new Set(nodes.value.filter((n) => !n.hidden).map((n) => n.id))
  edges.value = edges.value.map((e): any => {
    const hidden = !visible.has(e.source) || !visible.has(e.target)
    const dim = !!neigh && (!neigh.has(e.source) || !neigh.has(e.target))
    /* Una arista entre dos vecinas es cierta pero no es la respuesta: se deja tenue para que la que sí
     * toca lo buscado se distinga sin tener que leer los nombres. */
    const entreVecinas = !!coincide && !coincide.has(e.source) && !coincide.has(e.target)
    return {
      ...e,
      hidden,
      animated: !!neigh && !dim,
      style: { ...e.style, opacity: dim ? 0.12 : entreVecinas ? 0.3 : 1 },
    }
  })
}

/* ACOMODAR el subgrafo que quedó a la vista. Sin esto el buscador encuentra pero no muestra: las cajas
 * conservan la posición que tenían en el mapa de 105 tablas, así que una tabla y su vecina pueden
 * quedar a tres pantallas y el encuadre tiene que alejarse hasta que no se lea nada.
 *
 * ⚠ Se acomoda en MEMORIA y no se guarda: al borrar la consulta se vuelve a `posicionesBase`, que es el
 * mapa que el usuario armó. Por eso arrastrar mientras se busca no persiste (ver `onNodeDragStop`). */
function acomodar() {
  const visibles = nodes.value.filter((n) => !n.hidden)
  const hayConsulta = !!query.value.trim()

  const tope = Math.round(nodes.value.length * FRACCION_ACOMODAR)
  if (!hayConsulta || visibles.length < 2 || visibles.length > tope) {
    nodes.value = nodes.value.map((n) => {
      const p = posicionesBase.get(n.id)
      return p ? { ...n, position: p } : n
    })
    return
  }

  const coincide = coincidenciaActual
  const centro = visibles.filter((n) => !coincide || coincide.has(n.id))
  const anillo = visibles.filter((n) => !!coincide && !coincide.has(n.id))
  const puestos = new Map(layoutVecindad(centro, anillo).map((n) => [n.id, n.position]))
  nodes.value = nodes.value.map((n) => {
    const p = puestos.get(n.id)
    return p ? { ...n, position: p } : n
  })
}

/* El piso de legibilidad. El título de una tabla se dibuja a 13 px: a 0,7 queda en ~9 px, que todavía
 * se lee, y más abajo ya no — a 0,53 (lo que daba `user_requests` antes de subir el piso) los nombres
 * son manchas. Y el margen del encuadre entra en la cuenta: `fitView` con `padding` 0,15 deja el
 * contenido a z/1,3, así que comparar el z crudo contra el piso deja pasar vistas ilegibles. */
const ZOOM_LEGIBLE = 0.7
const MARGEN = 0.15

function cabeLegible(ns: Node[]): boolean {
  const caja = document.querySelector('.canvas') as HTMLElement | null
  if (!caja || !ns.length) return false
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const n of ns) {
    const { w, h } = tamanoDeNodo(n)
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  const z = Math.min(caja.clientWidth / (maxX - minX), caja.clientHeight / (maxY - minY))
  return z / (1 + 2 * MARGEN) >= ZOOM_LEGIBLE
}

/* El buscador: filtrar es inmediato —se escribe y se ve—, pero acomodar y encuadrar esperan a que la
 * mano pare. Si no, cada tecla mueve las cajas y reencuadra, y buscar se vuelve marear. */
let pendiente: ReturnType<typeof setTimeout> | undefined
function buscar() {
  applyView()
  clearTimeout(pendiente)
  pendiente = setTimeout(async () => {
    acomodar()
    /* ⚠ Esperar el tick NO es adorno: `fitView` mide contra el estado interno de Vue Flow, que se
     * actualiza cuando llega el prop. Sin esto encuadra las posiciones VIEJAS —las del mapa grande— y
     * después las cajas se mueven, así que lo buscado termina fuera de pantalla. Se vio midiendo: la
     * coincidencia quedaba en y = −555. Es el mismo motivo del `setTimeout` de `selectNode`. */
    await nextTick()
    await new Promise((r) => setTimeout(r, 20))
    /* ⚠ Se encuadra LO ENCONTRADO, no el subgrafo entero, y eso es deliberado: con 29 vecinas, meter
     * todo en pantalla obliga a un zoom donde no se lee ningún nombre —o sea contesta la pregunta y a
     * la vez la tapa—. Encuadrando la coincidencia, la tabla buscada queda legible y el anillo asoma
     * alrededor; lo que no entra se alcanza arrastrando o por el minimapa, que para eso está. */
    if (!coincidenciaActual) {
      fitView({ padding: 0.15, duration: 400 })
      return
    }
    const aLaVista = nodes.value.filter((n) => !n.hidden)
    const foco = aLaVista.filter((n) => coincidenciaActual!.has(n.id)).map((n) => n.id)
    if (!foco.length) return
    /* Si la vecindad entera cabe sin caer abajo del piso de legibilidad, se encuadra ENTERA — que es lo
     * que uno quiere ver cuando la tabla tiene tres vecinas. Si no cabe, se encuadra lo encontrado y el
     * anillo asoma: preferimos que la tabla buscada se lea y haya que arrastrar, antes que meter 32
     * cajas en pantalla a un zoom donde no se lee ningún nombre. */
    const entera = cabeLegible(aLaVista)
    fitView({
      nodes: entera ? aLaVista.map((n) => n.id) : foco,
      padding: entera ? MARGEN : 0.3,
      duration: 400,
      maxZoom: 1,
    })
  }, 260)
}

// ---- acciones ----
function toggleContext(key: string) {
  active.value.has(key) ? active.value.delete(key) : active.value.add(key)
  active.value = new Set(active.value)
  applyView()
}
function allContexts(on: boolean) {
  active.value = on ? new Set(contexts.map((c) => c.key)) : new Set()
  applyView()
}
function alternarVecinas() {
  conVecinas.value = !conVecinas.value
  localStorage.setItem(VECINAS_KEY, conVecinas.value ? '1' : '0')
  buscar()
}
function selectNode(key: string | null) {
  selectedKey.value = key
  applyView()
  if (key) {
    const n = nodes.value.find((x) => x.id === key)
    if (n)
      setTimeout(
        () => fitView({ nodes: [key], padding: 0.6, duration: 400, maxZoom: 1.2 }),
        20,
      )
  }
}

onNodeClick(({ node }) => selectNode(node.id))
onPaneClick(() => selectNode(null))
/* ⚠ Con una consulta activa NO se guarda: las posiciones que se ven son las que armó el buscador para
 * el subgrafo, y escribirlas se llevaría puesto el mapa completo que el usuario acomodó a mano. */
onNodeDragStop(() => {
  if (query.value.trim()) return
  savePositions(nodes.value)
})

onMounted(() => {
  for (const n of nodes.value) posicionesBase.set(n.id, n.position)
  applyView()
  setTimeout(() => fitView({ padding: 0.15 }), 80)
})
</script>

<template>
  <div class="app">
    <div class="ctxbar">
      <button class="ctx-all" @click="allContexts(true)">Todos</button>
      <button class="ctx-all" @click="allContexts(false)">Ninguno</button>
      <button
        v-for="c in contexts"
        :key="c.key"
        class="ctx-chip"
        :class="{ off: !active.has(c.key) }"
        :style="{ '--ctx': contextColor(c.key) }"
        :title="c.desc"
        @click="toggleContext(c.key)"
      >
        <span class="dot" />
        {{ contextLabel(c.key) }}
        <em>{{ counts[c.key] || 0 }}</em>
      </button>

      <div class="ctx-search">
        <input
          v-model="query"
          @input="buscar"
          type="search"
          placeholder="Buscar tabla (nueva o vieja)…"
          title="Busca por nombre/clave nueva o por tabla legacy"
        />
        <!-- La perilla aparece cuando hay algo escrito, que es cuando significa algo. -->
        <button
          v-if="nCoincidencias !== null"
          class="ctx-vec"
          :class="{ off: !conVecinas }"
          @click="alternarVecinas"
          :title="
            conVecinas
              ? 'Se muestran también las tablas que se unen a lo encontrado (un salto). Clic para ver sólo lo encontrado.'
              : 'Sólo lo encontrado, sin sus relaciones. Clic para traer las tablas vecinas.'
          "
        >
          + vecinas
        </button>
        <span v-if="nCoincidencias !== null" class="match">
          {{ nCoincidencias }} resultado(s)<template v-if="conVecinas && nVecinas">
            · {{ nVecinas }} vecina(s)</template>
        </span>
      </div>
    </div>

    <main class="canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :min-zoom="0.05"
        :max-zoom="2.5"
        fit-view-on-init
        :default-edge-options="{ type: 'smoothstep' }"
      >
        <template #node-table="props">
          <TableNode :id="props.id" :data="props.data" />
        </template>

        <Background :gap="22" pattern-color="#e2e8f0" />
        <Controls />
        <MiniMap
          :node-color="(n: any) => contextColor((n.data?.entidad?.contexto) || '')"
          pannable
          zoomable
        />
      </VueFlow>

      <DetailPanel
        :entidad="selectedEntidad"
        :modelo="modelo"
        @close="selectNode(null)"
        @goto="selectNode"
      />

      <div class="legend">
        <div><span class="ln solid" /> relación interna</div>
        <div><span class="ln dashed" /> referencia entre contextos</div>
        <div><span class="sw" style="background:#f59e0b" /> PK &nbsp; <span class="sw" style="background:#3b82f6" /> FK &nbsp; <span class="sw" style="background:#475569" /> ref. AWS &nbsp; <span style="color:#8b5cf6;font-weight:700">↯</span> emite evento &nbsp; ◆ aggregate root</div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f8fafc;
}
.ctxbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 7px 14px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.ctx-all {
  font-size: 11px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  color: #475569;
}
.ctx-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 3px 10px 3px 8px;
  cursor: pointer;
  color: #334155;
}
.ctx-chip .dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--ctx);
}
.ctx-chip em {
  font-style: normal;
  font-size: 10px;
  color: #94a3b8;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 0 5px;
}
.ctx-chip.off {
  opacity: 0.4;
  text-decoration: line-through;
}
.ctx-search {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ctx-search input {
  width: 240px;
  padding: 5px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  font-size: 12px;
  color: #334155;
  background: #f8fafc;
}
.ctx-search input:focus {
  outline: none;
  border-color: #94a3b8;
  background: #fff;
}
.ctx-search input::placeholder {
  color: #94a3b8;
}
.ctx-vec {
  font-size: 11px;
  background: #eef2ff;
  border: 1px solid #c7d2fe;
  color: #4338ca;
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
  white-space: nowrap;
}
.ctx-vec.off {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #94a3b8;
}
.ctx-search .match {
  font-size: 10px;
  color: #94a3b8;
  white-space: nowrap;
}

.canvas {
  position: relative;
  flex: 1;
  min-height: 0;
}
.legend {
  position: absolute;
  left: 12px;
  bottom: 12px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #475569;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: 5;
}
.legend .ln {
  display: inline-block;
  width: 22px;
  height: 0;
  vertical-align: middle;
  margin-right: 4px;
}
.legend .ln.solid {
  border-top: 2px solid #64748b;
}
.legend .ln.dashed {
  border-top: 2px dashed #64748b;
}
.legend .sw {
  display: inline-block;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  vertical-align: middle;
}
</style>
