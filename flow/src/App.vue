<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { VueFlow, Panel } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

import MerchantNode from './nodes/MerchantNode.vue'
import CanalNode from './nodes/CanalNode.vue'
import SolicitudNode from './nodes/SolicitudNode.vue'
import ExperianNode from './nodes/ExperianNode.vue'
import AgilDataNode from './nodes/AgilDataNode.vue'
import TusDatosNode from './nodes/TusDatosNode.vue'
import MareiguaNode from './nodes/MareiguaNode.vue'
import IngresosExtrasNode from './nodes/IngresosExtrasNode.vue'
import BuroNode from './nodes/BuroNode.vue'
import LendersNode from './nodes/LendersNode.vue'
import SettingsBar from './nodes/SettingsBar.vue'
import LendersConfigNode from './nodes/LendersConfigNode.vue'
import DefaultNode from './nodes/DefaultNode.vue'
import ComercioNode from './nodes/ComercioNode.vue'
import RelacionNode from './nodes/RelacionNode.vue'
import PerfilamientoNode from './nodes/PerfilamientoNode.vue'
import CategoryNode from './nodes/CategoryNode.vue'
import TramoNode from './nodes/TramoNode.vue'
import GroupRulesNode from './nodes/GroupRulesNode.vue'
import BranchStatusNode from './nodes/BranchStatusNode.vue'
import LifecycleNode from './nodes/LifecycleNode.vue'
import CreditStatusNode from './nodes/CreditStatusNode.vue'
import FieldInfoPanel from './nodes/FieldInfoPanel.vue'
import { ui, findLenderDef, perfilOf, lenders, closeFieldInfo } from './store'
import { settings } from './settings'

// El tema/visibilidad los maneja la barra "Configuraciones" (settings.js). Acá solo derivamos isDark
// para pintar el canvas (clase dark de Vue Flow + color del patrón de fondo).
const isDark = computed(() => settings.theme === 'dark')
// ¿La entidad seleccionada realmente se OFRECE (pasó el listado)? Si no pasa, no tiene sentido mostrar
// la formalización post-selección. Es dependencia del watch para que aparezca/desaparezca al cambiar el escenario.
const selPasses = computed(() => { const s = ui.selected; return s ? !!lenders.value.find(l => l.name === s)?.ok : false })

// Esc: 1º cierra el sidebar de detalle; 2º deselecciona la entidad (cierra el cluster de config).
// Clic en el canvas (pane) cierra solo el sidebar. Sin robar Esc cuando se está tipeando en un input.
function onKey(e) {
  if (e.key !== 'Escape') return
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) { t.blur(); return }
  if (ui.fieldInfo) closeFieldInfo()
  else if (ui.selected) ui.selected = null
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const nodes = ref([
  // Config del comercio: "Entidades del comercio" (incluye los productos CreditopX) entra al merchant desde arriba.
  { id: 'lenders-cfg', type: 'lenderscfg', position: { x: 20, y: 40 } },
  { id: 'merch', type: 'merchant', position: { x: 20, y: 540 } },
  // Canal (asesor | ecommerce): entre el comercio y la solicitud. El resto del spine + burós se corrió
  // +340 a la derecha para hacerle lugar sin apretar el layout.
  { id: 'canal', type: 'canal', position: { x: 320, y: 380 } },
  { id: 'sol', type: 'solicitud', position: { x: 680, y: 380 } },
  { id: 'exp', type: 'experian', position: { x: 800, y: 20 } },
  { id: 'agil', type: 'agildata', position: { x: 1050, y: 20 } },
  { id: 'tus', type: 'tusdatos', position: { x: 1300, y: 20 } },
  { id: 'mareigua', type: 'mareigua', position: { x: 1550, y: 20 } },
  { id: 'buro', type: 'buro', position: { x: 1100, y: 380 } },
  { id: 'out', type: 'lenders', position: { x: 1430, y: 380 } },
])

// Colores de los conectores por tema [oscuro, claro]: en claro se oscurecen para no perder contraste.
const EDGE_C = {
  cfg:   ['#6fb0e8', '#3f7fb0'], // config / herencia (azul, punteado)
  flow:  ['#185FA5', '#2f6cac'], // comercio → solicitud
  purp:  ['#7F77DD', '#6157cf'], // solicitud → perfil
  green: ['#0F6E56', '#178067'], // perfil → entidades
  exp:   ['#6aa9e2', '#3f7fb0'],
  agil:  ['#5dcaa5', '#178067'],
  tus:   ['#b6afe8', '#8379d6'],
  mare:  ['#e0a94e', '#9a6510'],
  base:  ['#5dcaa5', '#178067'], // config de lender → fila (teal, punteado)
}
const ec = (k) => EDGE_C[k][isDark.value ? 0 : 1]
// Edges base (spine + burós). Se reconstruyen al cambiar de tema o selección para tomar el color correcto.
function baseEdges() {
  return [
    { id: 'e-lenders-cfg', source: 'lenders-cfg', sourceHandle: 'tomerch', target: 'merch', targetHandle: 'top', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e0', source: 'merch', sourceHandle: 'toflow', target: 'canal', targetHandle: 'in', animated: false, style: { stroke: ec('flow'), strokeWidth: 2 } },
    { id: 'e0b', source: 'canal', sourceHandle: 'out', target: 'sol', animated: false, style: { stroke: ec('flow'), strokeWidth: 2 } },
    { id: 'e1', source: 'sol', target: 'buro', targetHandle: 'in', animated: false, style: { stroke: ec('purp'), strokeWidth: 2 } },
    { id: 'e2', source: 'buro', sourceHandle: 'out', target: 'out', animated: false, style: { stroke: ec('green'), strokeWidth: 2 } },
    { id: 'pe1', source: 'exp', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('exp'), strokeWidth: 1.5 } },
    { id: 'pe2', source: 'agil', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('agil'), strokeWidth: 1.5 } },
    { id: 'pe3', source: 'tus', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('tus'), strokeWidth: 1.5 } },
    { id: 'pe4', source: 'mareigua', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('mare'), strokeWidth: 1.5 } },
  ]
}
const edges = ref(baseEdges())

// Config → plantilla → oferta (izquierda a derecha, causal). Al seleccionar un lender aparece a la
// derecha el inspector de su "plantilla de sucursal" (relación, nivel 3). El conector de CONFIG sale
// SIEMPRE de "Entidades del comercio" (lenders-cfg), único nodo de config (incluye los productos
// CreditopX). Según el tipo de entidad:
//  · CreditopX (producto, p.ej. "Sonría Compra") → alimenta la "Política base" (nivel 0), que HEREDA
//    hacia la plantilla de sucursal.
//  · Entidad base (rt0/rt1/rt2 builtin) → alimenta la ficha directo (rt0/rt1 avisa "lo decide su API").
// SIN auto-zoom: al seleccionar, la plantilla aparece en su posición FIJA (a la izquierda de
// "Entidades del comercio"); la cámara NO se mueve (la maneja el usuario). Posiciones ordenadas
// (base arriba, heredada abajo) y sin solaparse entre sí ni con los nodos base.
const DYN = ['default', 'comercio', 'relacion', 'perfil']
// Al MONTAR: fit-view-on-init encuadra todos los nodos presentes (el grafo base) → se arranca viendo
// todo, no un zoom en la esquina. Al SELECCIONAR: NO se re-encuadra solo (la cámara la maneja el
// usuario con scroll para zoom y arrastrando para mover).
// Depende también de isDark → al cambiar de tema los edges se reconstruyen con el color adecuado.
watch([() => ui.selected, isDark, selPasses], ([sel]) => {
  const base = nodes.value.filter(n => !DYN.includes(n.id) && !n.id.startsWith('cat-') && n.id !== 'tramo' && n.id !== 'grouprules' && n.id !== 'branchstatus' && n.id !== 'extra' && n.id !== 'lifecycle' && n.id !== 'cstatus')
  const def = sel ? findLenderDef(sel) : null
  if (!def) { nodes.value = base; edges.value = baseEdges(); return } // cerrar: quita la plantilla, sin mover la cámara
  // Cadena config-de-lender → comercio → sucursal, para CUALQUIER lender (CreditopX o externo).
  // "Config de lender" (n0) = plantilla del lender (familia CreditopX o config propia del externo);
  // la sucursal COPIA de ahí y comercio/sucursal la pisan (puntitos). Ownership: comercio dueño de
  // config de comercio (n1) y config de sucursal (n2); la config de lender rige el catálogo.
  const add = [
    // Columna de config (x=-300) espaciada por altura: entidad ~290 · comercio hasta ~490 (crece con
    // "campos fuera de la solicitud") · sucursal ~380. Gaps generosos para no solaparse ni con comercio expandido.
    { id: 'default', type: 'basetpl', position: { x: -300, y: 40 } },      // Config de lender  (40..330)
    { id: 'comercio', type: 'comercio', position: { x: -300, y: 400 } },   // Config de comercio (400..~890)
    { id: 'relacion', type: 'relacion', position: { x: -300, y: 900 } },   // Config de sucursal (900..~1280)
    { id: 'perfil', type: 'perfilamiento', position: { x: -640, y: 40 } }, // Perfilamiento hub (40..~270), a la izquierda de "Config de lender"
  ]
  // El conector de "Config de lender" apunta a la FILA del lender seleccionado en "Entidades del
  // comercio" (no al centro del nodo): producto CreditopX → su fila; entidad base → la suya.
  const rowHandle = def.generated ? ('tpl-prod-' + def.product) : ('tpl-base-' + def.name)
  const addE = [
    { id: 'e-base-cat', source: 'default', sourceHandle: 'tocat', target: 'lenders-cfg', targetHandle: rowHandle, animated: false, style: { stroke: ec('base'), strokeWidth: 1.5, strokeDasharray: '5 4' } },
    { id: 'e-cfg-com', source: 'merch', sourceHandle: 'tocom', target: 'comercio', targetHandle: 'in', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } },
    { id: 'e-cfg-suc', source: 'merch', sourceHandle: 'tosuc', target: 'relacion', targetHandle: 'in', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } },
    // Perfilamiento = config de la entidad: sale del costado IZQUIERDO de "Configurar entidad" y entra
    // por el costado DERECHO del nodo (categorías viven por lender_id, como su economía).
    { id: 'e-perf', source: 'default', sourceHandle: 'toperf', target: 'perfil', targetHandle: 'in', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '6 5' } },
  ]
  // rt=2: las CATEGORÍAS y los TRAMOS son nodos propios, en FILA ARRIBA del hub Perfilamiento
  // (conectados hacia abajo). Se comparan lado a lado; la que gana se resalta. Solo CreditopX.
  if (def.rt === 2) {
    const cats = perfilOf(sel)
    // Fila de categorías + tramo ARRIBA del hub perfil (x=-640). Las tarjetas miden ~750px de alto,
    // así que rowY=-800 deja su base (~-50) por encima del hub (top 40) con aire. dx=280 = ancho (~260) + gap.
    const rowY = -800, x0 = -1200, dx = 280
    cats.forEach((c, i) => {
      add.push({ id: 'cat-' + c.id, type: 'categoria', data: { catId: c.id }, position: { x: x0 + i * dx, y: rowY } })
      addE.push({ id: 'e-cat-' + c.id, source: 'cat-' + c.id, sourceHandle: 'down', target: 'perfil', targetHandle: 'fromcats', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '5 4' } })
    })
    add.push({ id: 'tramo', type: 'tramo', position: { x: x0 + cats.length * dx, y: rowY } })
    addE.push({ id: 'e-tramo', source: 'tramo', sourceHandle: 'down', target: 'perfil', targetHandle: 'fromcats', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '5 4' } })
  }
  // Estado en sucursal (lenders_by_allied_branches.status): 1ª compuerta dura de la 2ª capa. Nodo propio
  // a la IZQUIERDA del hub "Configurar sucursal" (relacion en x=-300, y=900), conectado lado-con-lado:
  // costado derecho de "Estado en sucursal" → costado izquierdo de "Configurar sucursal" (flujo horizontal).
  add.push({ id: 'branchstatus', type: 'branchstatus', position: { x: -640, y: 900 } })
  addE.push({ id: 'e-bs', source: 'branchstatus', sourceHandle: 'out', target: 'relacion', targetHandle: 'fromstatus', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } })
  // group_rules por sucursal: nodo propio (~220px) arriba-izquierda del hub "Configurar sucursal"
  // (relacion en y=900). y=620 → base ~840, por encima del hub con aire; a la izquierda (x=-680) para no pisar comercio.
  add.push({ id: 'grouprules', type: 'grouprules', position: { x: -680, y: 620 } })
  addE.push({ id: 'e-gr', source: 'grouprules', sourceHandle: 'down', target: 'relacion', targetHandle: 'fromgr', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } })

  // ── A la DERECHA del listado (espejo de la config que cuelga a la izquierda), en cadena:
  // "Ingresos extras" (Ábaco valida ingreso extra si la entidad lo tiene activo) → "Formalización"
  // (stepper del rt) → "Estado del crédito". Solo si la entidad REALMENTE se ofrece (pasó el listado):
  // si no pasa, no hay ingreso extra que validar ni nada que formalizar. El edge inicial sale de la FILA
  // del lender seleccionado en el listado (handle psel-<name>). Separaciones (~110px de aire) alineadas.
  if (selPasses.value) {
    const EXTRA_X = 1860, LIFE_X = 2210, LIFE_Y = 380
    add.push({ id: 'extra', type: 'ingresosextras', position: { x: EXTRA_X, y: LIFE_Y } })
    add.push({ id: 'lifecycle', type: 'lifecycle', position: { x: LIFE_X, y: LIFE_Y } })
    add.push({ id: 'cstatus', type: 'cstatus', position: { x: LIFE_X + 350, y: LIFE_Y } })
    addE.push({ id: 'e-extra-in', source: 'out', sourceHandle: 'psel-' + sel, target: 'extra', targetHandle: 'in', animated: false, style: { stroke: ec('green'), strokeWidth: 1.6 } })
    addE.push({ id: 'e-extra-out', source: 'extra', sourceHandle: 'out', target: 'lifecycle', targetHandle: 'in', animated: false, style: { stroke: ec('green'), strokeWidth: 1.6 } })
    addE.push({ id: 'e-life-out', source: 'lifecycle', sourceHandle: 'out', target: 'cstatus', targetHandle: 'in', animated: false, style: { stroke: ec('green'), strokeWidth: 1.6 } })
  }

  nodes.value = [...base, ...add]
  edges.value = [...baseEdges(), ...addE]
}, { immediate: true }) // immediate: reconstruye la config del lender seleccionado al rehidratar
</script>

<template>
  <div class="app">
    <div class="main">
      <div class="canvas">
        <VueFlow :class="{ dark: isDark }" :nodes="nodes" :edges="edges" :min-zoom="0.2" :max-zoom="2" :nodes-draggable="true" :fit-view-on-init="true" :fit-view-options="{ padding: 0.14 }" @pane-click="closeFieldInfo">
          <template #node-merchant="props"><MerchantNode v-bind="props" /></template>
          <template #node-canal="props"><CanalNode v-bind="props" /></template>
          <template #node-lenderscfg="props"><LendersConfigNode v-bind="props" /></template>
          <template #node-solicitud="props"><SolicitudNode v-bind="props" /></template>
          <template #node-experian="props"><ExperianNode v-bind="props" /></template>
          <template #node-agildata="props"><AgilDataNode v-bind="props" /></template>
          <template #node-tusdatos="props"><TusDatosNode v-bind="props" /></template>
          <template #node-mareigua="props"><MareiguaNode v-bind="props" /></template>
          <template #node-ingresosextras="props"><IngresosExtrasNode v-bind="props" /></template>
          <template #node-buro="props"><BuroNode v-bind="props" /></template>
          <template #node-lenders="props"><LendersNode v-bind="props" /></template>
          <template #node-basetpl="props"><DefaultNode v-bind="props" /></template>
          <template #node-comercio="props"><ComercioNode v-bind="props" /></template>
          <template #node-relacion="props"><RelacionNode v-bind="props" /></template>
          <template #node-perfilamiento="props"><PerfilamientoNode v-bind="props" /></template>
          <template #node-categoria="props"><CategoryNode v-bind="props" /></template>
          <template #node-tramo="props"><TramoNode v-bind="props" /></template>
          <template #node-grouprules="props"><GroupRulesNode v-bind="props" /></template>
          <template #node-branchstatus="props"><BranchStatusNode v-bind="props" /></template>
          <template #node-lifecycle="props"><LifecycleNode v-bind="props" /></template>
          <template #node-cstatus="props"><CreditStatusNode v-bind="props" /></template>
          <Background :pattern-color="isDark ? '#2f2e27' : '#cfcabd'" :gap="22" />
          <Panel position="top-left" class="hud">
            <div class="hud__app">CreditOp · simulador de onboarding</div>
            <div class="hud__sub">comercio → solicitud → burós → perfil → entidades</div>
          </Panel>
          <Panel position="top-right" class="hud hud--legend">
            <div class="lg"><span class="lg__chip rt2">rt2</span> CreditopX · decide CreditOp</div>
            <div class="lg"><span class="lg__chip rt1">rt1</span> agregador · decide su API</div>
            <div class="lg"><span class="lg__chip rt0">rt0</span> redirect · decide su sitio</div>
            <div class="lg lg--dash"><span class="lg__dash"></span> config / herencia</div>
            <div class="lg"><span class="lg__chip mprod--credito">C</span><span class="lg__chip mprod--renting">R</span><span class="lg__chip mprod--rto">RB</span> productos</div>
            <div class="lg"><i class="kv-dot inh-heredada"></i> heredada <i class="kv-dot inh-editada"></i> editada</div>
            <div class="lg"><i class="lg-sw lg-sw--won"></i> categoría gana <i class="lg-sw lg-sw--off"></i> no aplica <i class="lg-sw lg-sw--fail"></i> no cumple</div>
          </Panel>
        </VueFlow>
        <FieldInfoPanel />
      </div>
    </div>
    <SettingsBar />
  </div>
</template>
