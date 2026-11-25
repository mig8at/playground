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
import QuantoNode from './nodes/QuantoNode.vue'
import AgilDataNode from './nodes/AgilDataNode.vue'
import TusDatosNode from './nodes/TusDatosNode.vue'
import MareiguaNode from './nodes/MareiguaNode.vue'
import IngresosExtrasNode from './nodes/IngresosExtrasNode.vue'
import BuroNode from './nodes/BuroNode.vue'
import LendersNode from './nodes/LendersNode.vue'
import EditorActions from './nodes/EditorActions.vue'
import LendersConfigNode from './nodes/LendersConfigNode.vue'
import DefaultNode from './nodes/DefaultNode.vue'
import ComercioNode from './nodes/ComercioNode.vue'
import RelacionNode from './nodes/RelacionNode.vue'
import PerfilamientoNode from './nodes/PerfilamientoNode.vue'
import CategoryNode from './nodes/CategoryNode.vue'
import TramoNode from './nodes/TramoNode.vue'
import GroupRulesNode from './nodes/GroupRulesNode.vue'
import BranchStatusNode from './nodes/BranchStatusNode.vue'
import FormStageNode from './nodes/FormStageNode.vue'
import LenderSelectionNode from './nodes/LenderSelectionNode.vue'
import ReturnNode from './nodes/ReturnNode.vue'
import IdentityNode from './nodes/IdentityNode.vue'
import PlanPagosNode from './nodes/PlanPagosNode.vue'
import DelegatedProfileNode from './nodes/DelegatedProfileNode.vue'
import PreApprovalNode from './nodes/PreApprovalNode.vue'
import QuotaEngineNode from './nodes/QuotaEngineNode.vue'
import FirmaNode from './nodes/FirmaNode.vue'
import EstadoNode from './nodes/EstadoNode.vue'
import CodeudorNode from './nodes/CodeudorNode.vue'
import InfoAdicionalNode from './nodes/InfoAdicionalNode.vue'
import CreditStatusNode from './nodes/CreditStatusNode.vue'
import FieldInfoPanel from './nodes/FieldInfoPanel.vue'
import { ui, findLenderDef, entidadCfg, perfilOf, perfil, bureau, fieldNull, providerDown, lenders, postSelSteps, selectionCheck, usesCategories, usesQuotaEngine, isInHouse, delegatedOf, closeFieldInfo, focusWinningProfile, persistPing } from './store'
import { Check } from 'lucide-vue-next'

// El tema lo pone workbench.js (el de Cockpit) como clase `dark` en el <html>; acá sólo se sigue, para los colores
// que se pintan por código (los edges y el patrón de fondo). `ui-theme` avisa cada cambio.
const isDark = ref(document.documentElement.classList.contains('dark'))
const onTheme = () => { isDark.value = document.documentElement.classList.contains('dark') }
// «guardado» en el pie: aparece cada vez que se persiste el escenario y se va solo.
const justSaved = ref(false)
let savedTimer
watch(() => persistPing.n, () => { justSaved.value = true; clearTimeout(savedTimer); savedTimer = setTimeout(() => { justSaved.value = false }, 1600) })
// ¿La entidad seleccionada realmente se OFRECE (pasó el listado)? Si no pasa, no tiene sentido mostrar
// la formalización post-selección. Es dependencia del watch para que aparezca/desaparezca al cambiar el escenario.
const selPasses = computed(() => { const s = ui.selected; return s ? !!lenders.value.find(l => l.name === s)?.ok : false })
// ¿La entidad seleccionada activó Ábaco (Información complementaria)? Solo entonces se muestra ese nodo.
// Dependencia del watch para que aparezca/desaparezca al togglear el flag en Configurar entidad.
const selAbaco = computed(() => { const s = ui.selected; if (!s) return false; const d = findLenderDef(s); return !!(d && entidadCfg(d).abacoExtra) })
// Ingreso TOTAL del solicitante = base (cascada Ágil→Mareigua→Quanto→declarado) + extra Ábaco (si aplica).
// Gatea el codeudor en renting: si el total > 3.000.000 NO se pide codeudor.
const selIncome = computed(() => {
  const base = perfil.value?.salario ?? 0
  const extra = (providerDown.abaco || fieldNull('abacoIncome')) ? 0 : (bureau.abacoIncome ?? 0)
  return base + extra
})
// Al elegir, el backend sólo valida (selectionCheck): si algo se rechaza, el recorrido se corta ahí.
const selCanContinue = computed(() => {
  const name = ui.selected, lender = name ? findLenderDef(name) : null
  return !!(lender && (!isInHouse(lender.rt) || selectionCheck(name).allowed))
})
// El carrusel es propio de cada entidad: al cambiar de lender volvemos al primer perfil.
watch(() => ui.selected, (next, prev) => { if (next !== prev) { if (next) focusWinningProfile(next); else ui.profileIndex = 0 } })

// Esc: 1º cierra el sidebar de detalle; 2º deselecciona la entidad (cierra el cluster de config).
// Clic en el canvas (pane) cierra solo el sidebar. Sin robar Esc cuando se está tipeando en un input.
function onKey(e) {
  const t = e.target
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')
  if (e.key !== 'Escape') return
  if (typing) { t.blur(); return }
  if (ui.fieldInfo) closeFieldInfo()
  else if (ui.selected) ui.selected = null
}
onMounted(() => { window.addEventListener('keydown', onKey); window.addEventListener('ui-theme', onTheme) })
onUnmounted(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('ui-theme', onTheme); clearTimeout(savedTimer) })

const nodes = ref([
  // Config del comercio: "Entidades del comercio" (incluye los productos CreditopX) entra al merchant desde arriba.
  { id: 'lenders-cfg', type: 'lenderscfg', position: { x: 20, y: 40 } },
  { id: 'merch', type: 'merchant', position: { x: 20, y: 540 } },
  // Canal (asesor | ecommerce): entre el comercio y la solicitud. El resto del spine + burós se corrió
  // +340 a la derecha para hacerle lugar sin apretar el layout.
  { id: 'canal', type: 'canal', position: { x: 320, y: 380 } },
  { id: 'sol', type: 'solicitud', position: { x: 680, y: 380 } },
  { id: 'exp', type: 'experian', position: { x: 340, y: 20 } },
  { id: 'quanto', type: 'quanto', position: { x: 600, y: 20 } },
  { id: 'agil', type: 'agildata', position: { x: 860, y: 20 } },
  { id: 'tus', type: 'tusdatos', position: { x: 1120, y: 20 } },
  { id: 'mareigua', type: 'mareigua', position: { x: 1380, y: 20 } },
  { id: 'buro', type: 'buro', position: { x: 1170, y: 380 } },
  { id: 'out', type: 'lenders', position: { x: 1540, y: 380 } },
  // El servicio de preaprobación cuelga ARRIBA del listado: es ahí, tarjeta por tarjeta, donde se le consulta. Muestra
  // la entidad elegida. (Los burós se corrieron a la izquierda, sobre canal y solicitud, para dejarle el lugar.)
  { id: 'preapproval', type: 'preapproval', position: { x: 1640, y: 110 } },
  // El motor de cupo de legacy-backend, arriba de la preaprobación: se le pregunta, no lo ve el cliente.
  { id: 'engine', type: 'engine', position: { x: 2209, y: 100 } },   // lo reubica placeDecisionColumn
])

// Colores de los conectores por tema [oscuro, claro]: en claro se oscurecen para no perder contraste.
const EDGE_C = {
  cfg:   ['#6fb0e8', '#3f7fb0'], // config / herencia (azul, punteado)
  flow:  ['#185FA5', '#2f6cac'], // comercio → solicitud
  purp:  ['#7F77DD', '#6157cf'], // solicitud → perfil
  green: ['#0F6E56', '#178067'], // perfil → entidades
  exp:   ['#6aa9e2', '#3f7fb0'],
  quanto:['#8ec0ee', '#5a90c4'], // Experian · Quanto (familia azul, un poco más claro que Acierta)
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
    // Preaprobación → motor (le pregunta, de izquierda a derecha) SÓLO si la entidad elegida usa el motor (CreditopX, Finandina): con Credifamilia o un
    // agregador, el servicio le pregunta a la API de la entidad y esta línea mentiría. Sin entidad elegida, tenue.
    ...(!ui.selected || usesQuotaEngine(findLenderDef(ui.selected))
      ? [{ id: 'e-pa-engine', source: 'preapproval', sourceHandle: 'toengine', target: 'engine', targetHandle: 'fromleft', animated: false, style: { stroke: ec('purp'), strokeWidth: 1.4, strokeDasharray: '5 4', opacity: ui.selected ? 1 : 0.35 } }]
      : []),
    { id: 'e-preapproval', source: 'preapproval', sourceHandle: 'down', target: 'out', targetHandle: 'top', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '5 4' } },
    { id: 'pe1', source: 'exp', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('exp'), strokeWidth: 1.5 } },
    { id: 'pe1b', source: 'quanto', target: 'buro', targetHandle: 'top', animated: false, style: { stroke: ec('quanto'), strokeWidth: 1.5 } },
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
// Grilla del inspector de la entidad seleccionada. Con los nodos de perfil limitados y con
// scroll, estas bandas dejan aire fijo entre tarjetas y evitan los grandes saltos verticales.
const SELECTED_LAYOUT = {
  // Lo que DECIDE el cupo va en una columna sobre el motor de cupo, que es quien lo aplica. Estas posiciones son las de
  // partida: placeDecisionColumn la corre para dejar el motor justo arriba de «Validación de identidad». (2026-11-25)
  profileInputs: { x: 1460, y: -1080 }, // categoría (268×467) + tramo (348×236), misma fila
  tramoX: 1760,
  profileHub: { x: 1664, y: -540 },     // centrado sobre el motor; ≤ 240 de alto, termina 70 px arriba
  delegated: { x: 2835, y: -60 },       // la ficha delegada: placeDecisionColumn la pone sobre «Plan de pagos», que la lee
  lender: { x: -320, y: 90 },
  commerce: { x: -320, y: 570 },
  groupRules: { x: -1060, y: 720 },
  branchStatus: { x: -680, y: 1120 },
  branch: { x: -320, y: 1120 },
}
// Al MONTAR: fit-view-on-init encuadra todos los nodos presentes (el grafo base) → se arranca viendo
// todo, no un zoom en la esquina. Al SELECCIONAR: NO se re-encuadra solo (la cámara la maneja el
// usuario con scroll para zoom y arrastrando para mover).
// Depende también de isDark → al cambiar de tema los edges se reconstruyen con el color adecuado.
// EL CAMINO DE LA ENTIDAD ELEGIDA (2026-11-25): lo que recorre queda pleno; la configuración que lo alimenta, a media
// luz («contexto»); y lo que esa entidad NO usa, apagado (al pasar el mouse vuelve, para poder leerlo). Las líneas
// siguen a sus nodos, y las del camino se engrosan. Sin entidad elegida, todo igual.
const CONTEXT = new Set(['lenders-cfg', 'merch', 'default', 'comercio', 'relacion', 'branchstatus', 'grouprules'])
function offFor(def) {
  const off = new Set()
  if (!usesQuotaEngine(def) && !isInHouse(def.rt)) off.add('engine')   // agregador y redirect: nunca le preguntan
  if (!usesCategories(def)) off.add('perfil')                         // sin categorías: el hub no decide nada
  if (def.rt === 0) off.add('preapproval')                            // el redirect no pasa por la preaprobación
  return off
}
// El motor de cupo va justo ARRIBA de «Validación de identidad» (lo que se le pregunta después de la identidad baja
// derecho) y la columna que decide (categorías y tramos → perfilamiento) encima de él. La identidad cambia de lugar
// según la entidad (en renting va después de Ábaco), así que la columna se ubica a partir de ella.
const ENGINE_W = 316, IDENTITY_W = 165
function placeDecisionColumn(ns) {
  const idn = ns.find(n => n.id === 'identity')
  const ex = idn ? idn.position.x + IDENTITY_W / 2 - ENGINE_W / 2 : 2209
  const at = { engine: { x: ex, y: 100 }, perfil: { x: ex + 24, y: -230 }, 'cat-carousel': { x: ex - 158, y: -770 }, tramo: { x: ex + 142, y: -770 } }
  // La ficha de originación delegada, sobre «Plan de pagos», que es quien la lee (días, fianza, de dónde salen los
  // números); de ahí baja también a la radicación o al estado final (formalización). Sin plan a la vista, a su lado.
  const pp = ns.find(n => n.id === 'planpagos')
  at.delegated = pp ? { x: pp.position.x + 115 - 174, y: -110 } : { x: ex + 380, y: -110 }
  return ns.map(n => (at[n.id] ? { ...n, position: at[n.id] } : n))
}
// Lo que lee la ficha delegada en main (2026-11-25): el plan de pagos (PaymentDateService y los controladores de
// PaymentPlan) y, al autorizar, la formalización (LoanAuthorizationService). Se dibuja sólo con esos pasos a la vista.
function delegatedEdges(ns) {
  if (!ns.some(n => n.id === 'delegated')) return []
  const has = (id) => ns.some(n => n.id === id)
  const st = { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '6 5' }
  const out = []
  if (has('planpagos')) out.push({ id: 'e-deleg-plan', source: 'delegated', sourceHandle: 'down', target: 'planpagos', targetHandle: 'fromprofile', animated: false, style: st })
  if (has('stage-radica')) out.push({ id: 'e-deleg-radica', source: 'delegated', sourceHandle: 'right', target: 'stage-radica', targetHandle: 'fromprofile', animated: false, style: st })
  else if (has('estado')) out.push({ id: 'e-deleg-estado', source: 'delegated', sourceHandle: 'right', target: 'estado', targetHandle: 'fromprofile', animated: false, style: st })
  return out
}
function paint(def, ns, edgeList) {
  ns = placeDecisionColumn(ns)
  edgeList = [...edgeList, ...delegatedEdges(ns)]
  if (!def) {
    nodes.value = ns.map(n => ({ ...n, class: undefined }))
    edges.value = edgeList
    return
  }
  const off = offFor(def)
  const role = (id) => (off.has(id) ? 'off' : CONTEXT.has(id) ? 'context' : 'path')
  nodes.value = ns.map(n => ({ ...n, class: 'node-' + role(n.id) }))
  edges.value = edgeList.map(e => {
    const a = role(e.source), b = role(e.target)
    const r = a === 'off' || b === 'off' ? 'off' : a === 'context' || b === 'context' ? 'context' : 'path'
    const st = { ...(e.style || {}) }
    if (r === 'off') st.opacity = 0.12
    else if (r === 'context') st.opacity = Math.min(st.opacity ?? 1, 0.45)
    else st.strokeWidth = Math.max(Number(st.strokeWidth) || 1.5, 2.2)
    return { ...e, style: st, class: 'edge-' + r }
  })
}

// La ficha del riel 4 cambia la cadena (categorías o su API, radicación): también la mira.
const selDelegated = computed(() => JSON.stringify(findLenderDef(ui.selected)?.entidad?.delegated || null))
watch([() => ui.selected, () => ui.profileIndex, isDark, selPasses, selAbaco, selIncome, selCanContinue, selDelegated], ([sel]) => {
  const base = nodes.value.filter(n => !DYN.includes(n.id) && !n.id.startsWith('cat-') && n.id !== 'tramo' && n.id !== 'grouprules' && n.id !== 'branchstatus' && n.id !== 'extra' && n.id !== 'selection' && n.id !== 'identity' && n.id !== 'planpagos' && n.id !== 'firma' && n.id !== 'estado' && n.id !== 'codeudor' && n.id !== 'infoadicional' && n.id !== 'delegated' && !n.id.startsWith('stage-') && n.id !== 'return' && n.id !== 'cstatus')
  const def = sel ? findLenderDef(sel) : null
  if (!def) { paint(null, base, baseEdges()); return } // cerrar: quita la plantilla, sin mover la cámara
  // Cadena config-de-lender → comercio → sucursal, para CUALQUIER lender (CreditopX o externo).
  // "Config de lender" (n0) = plantilla del lender (familia CreditopX o config propia del externo);
  // la sucursal COPIA de ahí y comercio/sucursal la pisan (puntitos). Ownership: comercio dueño de
  // config de comercio (n1) y config de sucursal (n2); la config de lender rige el catálogo.
  const add = [
    // Columna de config: cada nivel recibe una banda propia. Los gaps absorben tanto los campos
    // extra como la configuración importada, evitando que una tarjeta alta pise la siguiente.
    { id: 'default', type: 'basetpl', position: SELECTED_LAYOUT.lender },
    { id: 'comercio', type: 'comercio', position: SELECTED_LAYOUT.commerce },
    { id: 'relacion', type: 'relacion', position: SELECTED_LAYOUT.branch },
    { id: 'perfil', type: 'perfilamiento', position: SELECTED_LAYOUT.profileHub },
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
    // Perfilamiento → motor de cupo: el motor aplica la categoría que gana.
    { id: 'e-perf-engine', source: 'perfil', sourceHandle: 'out', target: 'engine', targetHandle: 'top', animated: false, style: { stroke: ec('purp'), strokeWidth: 1.4, strokeDasharray: '5 4' } },
  ]
  // rt=2: las CATEGORÍAS y los TRAMOS son nodos propios, en FILA ARRIBA del hub Perfilamiento
  // (conectados hacia abajo). Se comparan lado a lado; la que gana se resalta. Solo CreditopX.
  if (usesCategories(def)) {
    const cats = perfilOf(sel)
    // Una categoría a la vez: el carrusel vive en la tarjeta. Todas se siguen evaluando; sólo
    // cambia cuál se inspecciona, para que 3+ perfiles no conviertan el grafo en una pared.
    const { x: x0, y: rowY } = SELECTED_LAYOUT.profileInputs
    const catIndex = Math.max(0, Math.min(ui.profileIndex, cats.length - 1))
    const cat = cats[catIndex]
    if (cat) {
      add.push({ id: 'cat-carousel', type: 'categoria', data: { catId: cat.id }, position: { x: x0, y: rowY } })
      addE.push({ id: 'e-cat-carousel', source: 'cat-carousel', sourceHandle: 'down', target: 'perfil', targetHandle: 'fromcats', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '5 4' } })
    }
    if (def.rt === 2) {   // los tramos por monto son de CreditopX
      add.push({ id: 'tramo', type: 'tramo', position: { x: SELECTED_LAYOUT.tramoX, y: rowY } })
      addE.push({ id: 'e-tramo', source: 'tramo', sourceHandle: 'down', target: 'perfil', targetHandle: 'fromcats', animated: false, style: { stroke: ec('base'), strokeWidth: 1.4, strokeDasharray: '5 4' } })
    }
  }
  // rt=4: la ficha de originación delegada cuelga de «Configurar entidad» (es su config; la usa el plan de pagos).
  if (def.rt === 4) {
    add.push({ id: 'delegated', type: 'delegated', position: SELECTED_LAYOUT.delegated })
  }
  // Estado en sucursal (lenders_by_allied_branches.status): membresía solo-BD (default true; NO filtra el getLenders vivo, solo la lee el simulador viejo). Nodo propio
  // a la IZQUIERDA del hub "Configurar sucursal" (relacion en x=-300, y=900), conectado lado-con-lado:
  // costado derecho de "Estado en sucursal" → costado izquierdo de "Configurar sucursal" (flujo horizontal).
  add.push({ id: 'branchstatus', type: 'branchstatus', position: SELECTED_LAYOUT.branchStatus })
  addE.push({ id: 'e-bs', source: 'branchstatus', sourceHandle: 'out', target: 'relacion', targetHandle: 'fromstatus', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } })
  // group_rules tiene altura variable. Va en una columna propia, a la izquierda del estado de
  // sucursal, para que ambos puedan crecer sin quedar uno encima del otro.
  add.push({ id: 'grouprules', type: 'grouprules', position: SELECTED_LAYOUT.groupRules })
  addE.push({ id: 'e-gr', source: 'grouprules', sourceHandle: 'down', target: 'relacion', targetHandle: 'fromgr', animated: false, style: { stroke: ec('cfg'), strokeWidth: 1.4, strokeDasharray: '6 5' } })

  // ── A la DERECHA del listado (espejo de la config que cuelga a la izquierda), en cadena:
  // ["Información complementaria" SOLO si la entidad activó Ábaco] → "Formalización" (stepper del rt) →
  // "Estado del crédito". Solo si la entidad REALMENTE se ofrece (pasó el listado). Si no hay Ábaco, el
  // listado va DIRECTO a la formalización (que se corre a donde iría el nodo extra). El edge inicial sale
  // de la FILA del lender seleccionado en el listado (handle psel-<name>).
  if (selPasses.value) {
    const LIFE_Y = 380
    const GS = { stroke: ec('green'), strokeWidth: 1.6 }
    // Cada paso avanza lo que mide el nodo anterior más un hueco fijo, así la cadena queda pareja.
    const WIDTH = { selection: 295, extra: 300, identity: 165, codeudor: 260, planpagos: 230, infoadicional: 305, firma: 195, return: 250, formstage: 210 }
    const GAP = 70
    // Después de validar la identidad del titular, el wizard le vuelve a preguntar al motor de cupo con la política
    // «titular extendida» (`available-quota/extended`, que decide el paso siguiente). Lo llama el servidor del wizard,
    // no la preaprobación, y para cualquier entidad que siga en casa (rt 2 y 4): si no tiene esa política, aprueba sin
    // evaluar y va a la fecha de pago. Verificado en main el 2026-11-25 (post-validation-step.server.ts).
    const engineToIdentity = () => { if (isInHouse(def.rt)) addE.push({ id: 'e-engine-identity', source: 'engine', sourceHandle: 'down', target: 'identity', targetHandle: 'fromengine', animated: false, style: { stroke: ec('purp'), strokeWidth: 1.4, strokeDasharray: '5 4' } }) }
    const adv = (key) => (WIDTH[key] || 280) + GAP
    let x = 1920, prevSrc = 'out', prevH = 'psel-' + sel   // arranca en la fila del lender del listado
    // Flujo de CRÉDITO (producto crédito + Credifamilia rt=4): lo estamos rearmando PASO A PASO.
    // Por ahora, el 1er (y único) nodo tras elegir el lender es la validación de identidad; el resto
    // de la cadena se irá agregando después.
    const isDelegated = def.rt === 4
    const isCredit = def.rt === 2 && (def.producto === 'credito' || def.producto === 'consumo')
    const isRenting = def.rt === 2 && (def.producto === 'renting' || def.producto === 'rto')
    if (isDelegated) {
      // ── Riel 4 · originación delegada: elegir → identidad → formulario de la entidad → plan (con la ficha) →
      // firma → [radicación si la ficha la pide] → estado 11. El orden es el del wizard: el formulario de la
      // entidad (form 25 en Finandina) va ANTES de elegir la primera fecha de pago.
      const step = (id, type, data) => {
        add.push({ id, type, data, position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-' + id, source: prevSrc, sourceHandle: prevH, target: id, targetHandle: 'in', animated: false, style: GS })
        prevSrc = id; prevH = 'out'; x += adv(type)
      }
      step('selection', 'selection')
      if (!selCanContinue.value) { paint(def, [...base, ...add], [...baseEdges(), ...addE]); return }
      step('identity', 'identity')
      engineToIdentity()
      step('infoadicional', 'infoadicional')
      step('planpagos', 'planpagos')
      step('firma', 'firma')
      if (delegatedOf(def).formalization) step('stage-radica', 'formstage', { stepKey: 'radica' })
      step('estado', 'estado')
    } else if (isCredit || isRenting) {
      // El listado es solo una oferta. Antes de cualquier formulario in-platform aparece el segundo
      // motor; si bloquea, el gráfico termina aquí y deja visible la causa.
      add.push({ id: 'selection', type: 'selection', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-selection', source: prevSrc, sourceHandle: prevH, target: 'selection', targetHandle: 'in', animated: false, style: GS })
      prevSrc = 'selection'; prevH = 'out'; x += adv('selection')
      if (!selCanContinue.value) {
        paint(def, [...base, ...add], [...baseEdges(), ...addE])
        return
      }
      // Flujo in-platform, en reconstrucción PASO A PASO. Renting/rto: primero Ábaco (ingreso extra
      // editable), luego identidad. Crédito (+ Credifamilia): directo a validación de identidad.
      if (isRenting) {
        add.push({ id: 'extra', type: 'ingresosextras', position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-extra', source: prevSrc, sourceHandle: prevH, target: 'extra', targetHandle: 'in', animated: false, style: GS })
        prevSrc = 'extra'; prevH = 'out'; x += adv('extra')
      }
      add.push({ id: 'identity', type: 'identity', position: { x, y: LIFE_Y } })
      engineToIdentity()
      addE.push({ id: 'e-identity', source: prevSrc, sourceHandle: prevH, target: 'identity', targetHandle: 'in', animated: false, style: GS })
      prevSrc = 'identity'; prevH = 'out'; x += adv('identity')
      // Renting: bifurcación por ingreso. Si el ingreso del solicitante ≤ 3.000.000 se exige CODEUDOR
      // (mismos datos que Solicitud) antes del plan de pagos; si es mayor, el flujo sigue directo.
      if (isRenting && selIncome.value <= 3000000) {
        add.push({ id: 'codeudor', type: 'codeudor', position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-codeudor', source: prevSrc, sourceHandle: prevH, target: 'codeudor', targetHandle: 'in', animated: false, style: GS })
        prevSrc = 'codeudor'; prevH = 'out'; x += adv('codeudor')
      }
      // Plan de pagos (todo CreditopX): primera fecha de pago (5/16/28) + número de cuotas del listado.
      add.push({ id: 'planpagos', type: 'planpagos', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-planpagos', source: prevSrc, sourceHandle: prevH, target: 'planpagos', targetHandle: 'in', animated: false, style: GS })
      prevSrc = 'planpagos'; prevH = 'out'; x += adv('planpagos')
      // Consumo (Credifamilia): "Información adicional" (form_type 6) entre plan de pagos y firma.
      if (def.producto === 'consumo') {
        add.push({ id: 'infoadicional', type: 'infoadicional', position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-infoadicional', source: prevSrc, sourceHandle: prevH, target: 'infoadicional', targetHandle: 'in', animated: false, style: GS })
        prevSrc = 'infoadicional'; prevH = 'out'; x += adv('infoadicional')
      }
      // Firma del pagaré (OTP de 6) → Estado (success/false).
      add.push({ id: 'firma', type: 'firma', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-firma', source: prevSrc, sourceHandle: prevH, target: 'firma', targetHandle: 'in', animated: false, style: GS })
      prevSrc = 'firma'; prevH = 'out'; x += adv('firma')
      add.push({ id: 'estado', type: 'estado', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-estado', source: prevSrc, sourceHandle: prevH, target: 'estado', targetHandle: 'in', animated: false, style: GS })
    } else {
      // rt=1 (agregador) / rt=0 (redirect): formalización externa/redirect como cadena de etapas.
      if (selAbaco.value) {
        add.push({ id: 'extra', type: 'ingresosextras', position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-extra', source: prevSrc, sourceHandle: prevH, target: 'extra', targetHandle: 'in', animated: false, style: GS })
        prevSrc = 'extra'; prevH = 'out'; x += adv('extra')
      }
      // Etapas del rt (POSTSEL_STEPS: rt1 radica→decision · rt0 redirect) → Estado del crédito.
      for (const key of postSelSteps(def.rt, sel).map(s => s.key)) {
        const id = 'stage-' + key
        add.push({ id, type: 'formstage', data: { stepKey: key }, position: { x, y: LIFE_Y } })
        addE.push({ id: 'e-' + id, source: prevSrc, sourceHandle: prevH, target: id, targetHandle: 'in', animated: false, style: GS })
        prevSrc = id; prevH = 'out'; x += adv('formstage')
      }
      add.push({ id: 'return', type: 'return', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-return', source: prevSrc, sourceHandle: prevH, target: 'return', targetHandle: 'in', animated: false, style: GS })
      prevSrc = 'return'; prevH = 'out'; x += adv('return')
      add.push({ id: 'cstatus', type: 'cstatus', position: { x, y: LIFE_Y } })
      addE.push({ id: 'e-cstatus', source: prevSrc, sourceHandle: prevH, target: 'cstatus', targetHandle: 'in', animated: false, style: GS })
    }
  }

  paint(def, [...base, ...add], [...baseEdges(), ...addE])
}, { immediate: true }) // immediate: reconstruye la config del lender seleccionado al rehidratar
</script>

<template>
  <div class="workbench">
    <main class="editor">
      <div class="region-head">
        <span class="flow-title">Flujo de una solicitud</span>
        <span class="flow-crumbs">comercio → solicitud → burós → perfil → entidades → después de elegir</span>
        <EditorActions />
      </div>
      <div class="region-body canvas">
        <VueFlow :nodes="nodes" :edges="edges" :min-zoom="0.2" :max-zoom="2" :nodes-draggable="true" :fit-view-on-init="true" :fit-view-options="{ padding: 0.14 }" @pane-click="closeFieldInfo">
          <template #node-merchant="props"><MerchantNode v-bind="props" /></template>
          <template #node-canal="props"><CanalNode v-bind="props" /></template>
          <template #node-lenderscfg="props"><LendersConfigNode v-bind="props" /></template>
          <template #node-solicitud="props"><SolicitudNode v-bind="props" /></template>
          <template #node-experian="props"><ExperianNode v-bind="props" /></template>
          <template #node-quanto="props"><QuantoNode v-bind="props" /></template>
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
          <template #node-formstage="props"><FormStageNode v-bind="props" /></template>
          <template #node-selection="props"><LenderSelectionNode v-bind="props" /></template>
          <template #node-return="props"><ReturnNode v-bind="props" /></template>
          <template #node-identity="props"><IdentityNode v-bind="props" /></template>
          <template #node-planpagos="props"><PlanPagosNode v-bind="props" /></template>
          <template #node-delegated="props"><DelegatedProfileNode v-bind="props" /></template>
          <template #node-preapproval="props"><PreApprovalNode v-bind="props" /></template>
          <template #node-engine="props"><QuotaEngineNode v-bind="props" /></template>
          <template #node-firma="props"><FirmaNode v-bind="props" /></template>
          <template #node-estado="props"><EstadoNode v-bind="props" /></template>
          <template #node-codeudor="props"><CodeudorNode v-bind="props" /></template>
          <template #node-infoadicional="props"><InfoAdicionalNode v-bind="props" /></template>
          <template #node-cstatus="props"><CreditStatusNode v-bind="props" /></template>
          <Background :pattern-color="isDark ? '#2f2e27' : '#cfcabd'" :gap="22" />
          <Panel position="bottom-right" class="hud hud--legend">
            <div class="lg"><span class="lg__chip rt2">rt2</span> CreditopX · decide CreditOp</div>
            <div class="lg"><span class="lg__chip rt4">rt4</span> delegada · su política, cierra acá</div>
            <div class="lg"><span class="lg__chip rt1">rt1</span> agregador · decide su API</div>
            <div class="lg"><span class="lg__chip rt0">rt0</span> redirect · decide su sitio</div>
            <div class="lg lg--dash"><span class="lg__dash"></span> config / herencia</div>
            <div class="lg"><span class="lg__ext"></span> con halo: contesta un tercero</div>
            <div class="lg"><span class="lg__dim"></span> con entidad elegida: a media luz su config · apagado lo que no usa</div>
            <div class="lg"><span class="lg__chip mprod--credito">C</span><span class="lg__chip mprod--renting">R</span><span class="lg__chip mprod--rto">RB</span> productos</div>
            <div class="lg"><i class="kv-dot inh-heredada"></i> heredada <i class="kv-dot inh-editada"></i> editada</div>
            <div class="lg"><i class="lg-sw lg-sw--won"></i> categoría gana <i class="lg-sw lg-sw--off"></i> no aplica <i class="lg-sw lg-sw--fail"></i> no cumple</div>
          </Panel>
        </VueFlow>
      </div>
    </main>
    <FieldInfoPanel />
    <footer class="statusbar">
      <span>{{ ui.selected ? 'Entidad elegida: ' + ui.selected : 'Elegí una entidad en «Entidades disponibles» para ver lo que sigue' }}</span>
      <span v-if="justSaved" class="flow-saved"><Check :size="12" /> escenario guardado</span>
    </footer>
  </div>
</template>
