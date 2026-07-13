<script setup lang="ts">
import { reactive, ref, computed, watch, watchEffect } from 'vue'
import { VueFlow, useVueFlow, Handle, Position, MarkerType, type Node, type Edge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import RangeSlider from '../components/RangeSlider.vue'
import ValueSlider from '../components/ValueSlider.vue'

// ===== Países: misma regla, distinta FUENTE del dato y UMBRAL (FactSourceBinding) =====
const PAISES: Record<string, { label: string; buro: string; scoreDef: number; money: string }> = {
  CO: { label: '🇨🇴 Colombia', buro: 'Datacrédito', scoreDef: 600, money: '$' },
  PE: { label: '🇵🇪 Perú', buro: 'Equifax/Sentinel', scoreDef: 650, money: 'S/ ' },
  MX: { label: '🇲🇽 México', buro: 'Buró/Círculo', scoreDef: 650, money: '$' },
}
const pais = ref('CO')
const money = computed(() => PAISES[pais.value].money)
const fmtMoney = (n: number) => money.value + n.toLocaleString('es')

// ===== Familias =====
type Fam = 'regulatorio' | 'demografico' | 'capacidad' | 'buro' | 'alternativo'
const FAM_LABEL: Record<Fam, string> = { regulatorio: 'Regulatorio · KYC-AML', demografico: 'Demográfico', capacidad: 'Capacidad de pago', buro: 'Riesgo / centrales', alternativo: 'Datos alternativos' }
const FAM_ORDER: Fam[] = ['regulatorio', 'demografico', 'capacidad', 'buro', 'alternativo']
const esComercio = (who: string) => who === 'comercio'
const actorFamilias = (who: string): Fam[] => (esComercio(who) ? ['demografico', 'capacidad', 'alternativo'] : FAM_ORDER)

// ===== Catálogo de reglas =====
type Kind = 'min' | 'max' | 'range' | 'set' | 'bool_false' | 'bool_true'
interface Regla { key: string; label: string; campo: string; familia: Fam; reg?: boolean; kind: Kind; def: any; unit?: string; options?: string[]; lo?: number; hi?: number; step?: number; money?: boolean }
const RULES: Regla[] = [
  { key: 'listas', label: 'No en listas restrictivas', campo: 'enLista', familia: 'regulatorio', reg: true, kind: 'bool_false', def: true },
  { key: 'consentimiento', label: 'Consentimiento habeas data', campo: 'autoriza', familia: 'regulatorio', reg: true, kind: 'bool_true', def: true },
  { key: 'edad', label: 'Edad permitida', campo: 'edad', familia: 'demografico', kind: 'range', def: { min: 18, max: 69 }, lo: 18, hi: 90, step: 1, unit: 'años' },
  { key: 'genero', label: 'Género permitido', campo: 'genero', familia: 'demografico', kind: 'set', def: ['M', 'F'], options: ['M', 'F'] },
  { key: 'nacionalidad', label: 'Nacionalidad', campo: 'pais', familia: 'demografico', kind: 'set', def: ['CO', 'PE', 'MX', 'VE', 'Otro'], options: ['CO', 'PE', 'MX', 'VE', 'Otro'] },
  { key: 'ingreso_min', label: 'Ingreso mínimo', campo: 'ingreso', familia: 'capacidad', kind: 'min', def: 1300000, lo: 0, hi: 4000000, step: 100000, money: true },
  { key: 'dti_max', label: 'Cuota/ingreso (DTI)', campo: 'dti', familia: 'capacidad', kind: 'max', def: 40, lo: 0, hi: 100, step: 5, unit: '%' },
  { key: 'ocupacion', label: 'Ocupación', campo: 'ocupacion', familia: 'capacidad', kind: 'set', def: ['Empleado', 'Independiente', 'Pensionado'], options: ['Empleado', 'Independiente', 'Pensionado', 'Desempleado'] },
  { key: 'score_min', label: 'Score mínimo', campo: 'score', familia: 'buro', kind: 'min', def: 600, lo: 300, hi: 850, step: 10, unit: 'pts' },
  { key: 'sin_mora', label: 'Sin mora actual', campo: 'moraActual', familia: 'buro', kind: 'bool_false', def: true },
  { key: 'servicios', label: 'Servicios/telco al día', campo: 'serviciosAlDia', familia: 'alternativo', kind: 'bool_true', def: true },
]
const rulesDe = (who: string, fam: Fam) => RULES.filter((r) => r.familia === fam && (!esComercio(who) || !r.reg))

// ===== Solicitantes =====
interface Usuario { id: string; nombre: string; edad: number; genero: 'M' | 'F'; score: number; ingreso: number; ocupacion: string; reportado: boolean; pais: string; dti: number; moraActual: boolean; enLista: boolean; autoriza: boolean; serviciosAlDia: boolean; cedula: string }
const RAW: Omit<Usuario, 'cedula'>[] = [
  { id: 'u1', nombre: 'Ana', edad: 24, genero: 'F', score: 690, ingreso: 1_800_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 28, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u2', nombre: 'Bruno', edad: 19, genero: 'M', score: 580, ingreso: 1_200_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 35, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u3', nombre: 'Carla', edad: 71, genero: 'F', score: 720, ingreso: 3_000_000, ocupacion: 'Pensionado', reportado: false, pais: 'CO', dti: 20, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u4', nombre: 'Diego', edad: 30, genero: 'M', score: 640, ingreso: 900_000, ocupacion: 'Empleado', reportado: true, pais: 'CO', dti: 45, moraActual: true, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u5', nombre: 'Elena', edad: 45, genero: 'F', score: 610, ingreso: 2_100_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 30, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u6', nombre: 'Faruk', edad: 28, genero: 'M', score: 550, ingreso: 1_500_000, ocupacion: 'Desempleado', reportado: false, pais: 'CO', dti: 50, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: false },
  { id: 'u7', nombre: 'Sofía', edad: 22, genero: 'F', score: 660, ingreso: 1_350_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 25, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u8', nombre: 'Mateo', edad: 38, genero: 'M', score: 700, ingreso: 2_600_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 22, moraActual: false, enLista: true, autoriza: true, serviciosAlDia: true },
  { id: 'u9', nombre: 'Lucía', edad: 67, genero: 'F', score: 590, ingreso: 1_100_000, ocupacion: 'Pensionado', reportado: false, pais: 'PE', dti: 33, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u10', nombre: 'Iván', edad: 26, genero: 'M', score: 530, ingreso: 1_400_000, ocupacion: 'Independiente', reportado: true, pais: 'MX', dti: 48, moraActual: true, enLista: false, autoriza: true, serviciosAlDia: false },
  { id: 'u11', nombre: 'Marta', edad: 33, genero: 'F', score: 750, ingreso: 2_900_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 18, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u12', nombre: 'Hugo', edad: 52, genero: 'M', score: 605, ingreso: 1_900_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 55, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u13', nombre: 'Paula', edad: 18, genero: 'F', score: 600, ingreso: 1_000_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 30, moraActual: false, enLista: false, autoriza: false, serviciosAlDia: true },
  { id: 'u14', nombre: 'Leo', edad: 44, genero: 'M', score: 680, ingreso: 1_600_000, ocupacion: 'Empleado', reportado: false, pais: 'VE', dti: 27, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u15', nombre: 'Diana', edad: 29, genero: 'F', score: 560, ingreso: 2_200_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 40, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u16', nombre: 'Nico', edad: 73, genero: 'M', score: 640, ingreso: 3_200_000, ocupacion: 'Pensionado', reportado: false, pais: 'MX', dti: 15, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u17', nombre: 'Sara', edad: 27, genero: 'F', score: 615, ingreso: 1_450_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 32, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u18', nombre: 'Tomás', edad: 41, genero: 'M', score: 700, ingreso: 2_400_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 24, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u19', nombre: 'Rosa', edad: 58, genero: 'F', score: 575, ingreso: 1_300_000, ocupacion: 'Pensionado', reportado: false, pais: 'CO', dti: 38, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u20', nombre: 'Pablo', edad: 23, genero: 'M', score: 640, ingreso: 1_100_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 42, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u21', nombre: 'Inés', edad: 36, genero: 'F', score: 720, ingreso: 2_700_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 19, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u22', nombre: 'Raúl', edad: 49, genero: 'M', score: 560, ingreso: 1_700_000, ocupacion: 'Independiente', reportado: true, pais: 'CO', dti: 47, moraActual: true, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u23', nombre: 'Lina', edad: 31, genero: 'F', score: 660, ingreso: 1_900_000, ocupacion: 'Empleado', reportado: false, pais: 'PE', dti: 28, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u24', nombre: 'Óscar', edad: 64, genero: 'M', score: 600, ingreso: 1_250_000, ocupacion: 'Pensionado', reportado: false, pais: 'CO', dti: 35, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u25', nombre: 'Vera', edad: 20, genero: 'F', score: 590, ingreso: 980_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 30, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: false },
  { id: 'u26', nombre: 'Caleb', edad: 39, genero: 'M', score: 710, ingreso: 3_100_000, ocupacion: 'Empleado', reportado: false, pais: 'MX', dti: 21, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u27', nombre: 'Nora', edad: 47, genero: 'F', score: 545, ingreso: 2_000_000, ocupacion: 'Independiente', reportado: false, pais: 'VE', dti: 44, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u28', nombre: 'Beto', edad: 25, genero: 'M', score: 670, ingreso: 1_550_000, ocupacion: 'Empleado', reportado: false, pais: 'CO', dti: 26, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
  { id: 'u29', nombre: 'Cielo', edad: 70, genero: 'F', score: 630, ingreso: 2_300_000, ocupacion: 'Pensionado', reportado: false, pais: 'CO', dti: 22, moraActual: false, enLista: true, autoriza: true, serviciosAlDia: false },
  { id: 'u30', nombre: 'Iker', edad: 18, genero: 'M', score: 605, ingreso: 1_400_000, ocupacion: 'Independiente', reportado: false, pais: 'CO', dti: 33, moraActual: false, enLista: false, autoriza: true, serviciosAlDia: true },
]
const usuarios = ref<Usuario[]>(RAW.map((u, i) => ({ ...u, cedula: (1_000_000_000 + i * 137_000_111).toLocaleString('es') })))
const userById = computed<Record<string, Usuario>>(() => Object.fromEntries(usuarios.value.map((u) => [u.id, u])))
const scoreBand = (s: number) => (s < 580 ? '#ef4444' : s < 650 ? '#f59e0b' : '#10b981')

// ===== Config por actor: comercio + DOS lenders =====
type Cfg = Record<string, { on: boolean; value: any }>
function mkCfg(enabled: Record<string, any>): Cfg {
  const c: Cfg = {}
  for (const r of RULES) c[r.key] = { on: r.key in enabled, value: structuredClone(r.key in enabled ? enabled[r.key] : r.def) }
  return c
}
const LENDER_A_DEF: Record<string, any> = { listas: true, consentimiento: true, edad: { min: 18, max: 69 }, score_min: 600, ingreso_min: 1_300_000, sin_mora: true }
const LENDER_B_DEF: Record<string, any> = { listas: true, consentimiento: true, edad: { min: 18, max: 75 }, score_min: 550, ingreso_min: 1_500_000, sin_mora: true }
const COMERCIO_DEF: Record<string, any> = { ocupacion: ['Empleado', 'Independiente', 'Pensionado'] }
const comercioCfg = reactive(mkCfg(COMERCIO_DEF))
const lenderACfg = reactive(mkCfg(LENDER_A_DEF))
const lenderBCfg = reactive(mkCfg(LENDER_B_DEF))
const cfgOf = (who: string): Cfg => (who === 'comercio' ? comercioCfg : who === 'lenderB' ? lenderBCfg : lenderACfg)
function applyDefaults(cfg: Cfg, enabled: Record<string, any>) { for (const r of RULES) { cfg[r.key].on = r.key in enabled; cfg[r.key].value = structuredClone(r.key in enabled ? enabled[r.key] : r.def) } }
function toggleOpt(cfg: Cfg, key: string, opt: string) { const a: string[] = cfg[key].value; const i = a.indexOf(opt); if (i >= 0) a.splice(i, 1); else a.push(opt) }
// país → umbral del score (A = banda país; B = 50 pts más laxo)
watch(pais, (p) => { lenderACfg.score_min.value = PAISES[p].scoreDef; lenderBCfg.score_min.value = PAISES[p].scoreDef - 50 })

// ===== Evaluación: comercio (puerta) → A y B en paralelo. Aprueba si pasa comercio Y (A o B). =====
function evalActor(u: Usuario, cfg: Cfg): { ok: boolean; regla: Regla | null } {
  for (const r of RULES) {
    const c = cfg[r.key]
    if (!c?.on) continue
    const v = (u as any)[r.campo]
    let pass = true
    if (r.kind === 'min') pass = Number(v) >= Number(c.value)
    else if (r.kind === 'max') pass = Number(v) <= Number(c.value)
    else if (r.kind === 'range') pass = Number(v) >= Number(c.value.min) && Number(v) <= Number(c.value.max)
    else if (r.kind === 'set') pass = (c.value as string[]).includes(v)
    else if (r.kind === 'bool_false') pass = v === false
    else if (r.kind === 'bool_true') pass = v === true
    if (!pass) return { ok: false, regla: r }
  }
  return { ok: true, regla: null }
}
interface Veredicto { status: 'approved' | 'rejected'; mOk: boolean; aOk: boolean; bOk: boolean; approvedBy: string; comercioReason?: string; aReason?: string; bReason?: string }
const evaluacion = computed(() => {
  const per: Record<string, Veredicto> = {}
  let cPass = 0, apprA = 0, apprB = 0, apprAny = 0
  for (const u of usuarios.value) {
    const m = evalActor(u, comercioCfg)
    if (!m.ok) { per[u.id] = { status: 'rejected', mOk: false, aOk: false, bOk: false, approvedBy: '', comercioReason: m.regla!.label }; continue }
    cPass++
    const a = evalActor(u, lenderACfg), b = evalActor(u, lenderBCfg)
    if (a.ok) apprA++
    if (b.ok) apprB++
    const any = a.ok || b.ok
    if (any) apprAny++
    per[u.id] = { status: any ? 'approved' : 'rejected', mOk: true, aOk: a.ok, bOk: b.ok, approvedBy: a.ok && b.ok ? 'EX' : a.ok ? 'E' : b.ok ? 'X' : '', aReason: a.ok ? undefined : a.regla?.label, bReason: b.ok ? undefined : b.regla?.label }
  }
  return { per, total: usuarios.value.length, cPass, apprA, apprB, apprAny }
})
const veredictoDe = (id: string) => evaluacion.value.per[id]

// ===== Tooltip =====
const tip = ref<{ u: Usuario; v: Veredicto; x: number; y: number } | null>(null)
const showTip = (uid: string, e: MouseEvent) => { tip.value = { u: userById.value[uid], v: veredictoDe(uid), x: e.clientX, y: e.clientY } }
const moveTip = (e: MouseEvent) => { if (tip.value) tip.value = { ...tip.value, x: e.clientX, y: e.clientY } }
const hideTip = () => { tip.value = null }

// ===== Grafo =====
const { fitView } = useVueFlow()
const COLS = 4
const nodes = ref<Node[]>([
  ...usuarios.value.map((u, i) => ({ id: u.id, type: 'user', position: { x: 20, y: 20 } , data: { uid: u.id }, })),
  { id: 'comercio', type: 'actor', position: { x: 360, y: 200 }, data: { who: 'comercio' } },
  { id: 'lenderA', type: 'actor', position: { x: 720, y: 0 }, data: { who: 'lenderA' } },
  { id: 'lenderB', type: 'actor', position: { x: 720, y: 470 }, data: { who: 'lenderB' } },
  { id: 'credito', type: 'outcome', position: { x: 1090, y: 250 }, data: {} },
])
// posiciones de los usuarios en grilla
nodes.value.forEach((n) => { if (n.type === 'user') { const i = usuarios.value.findIndex((u) => u.id === n.id); n.position = { x: 20 + (i % COLS) * 64, y: 18 + Math.floor(i / COLS) * 64 } } })

const edges = ref<Edge[]>([])
watchEffect(() => {
  const e = evaluacion.value, green = '#10b981', red = '#ef4444', gray = '#cbd5e1', cA = '#dc2626', cB = '#6366f1'
  const list: Edge[] = []
  for (const u of usuarios.value) {
    const ok = e.per[u.id].mOk
    list.push({ id: `e-${u.id}-com`, source: u.id, target: 'comercio', type: 'smoothstep', animated: ok, style: { stroke: ok ? green : red, strokeWidth: ok ? 1.5 : 1.1, strokeDasharray: ok ? undefined : '4 4', opacity: ok ? 0.85 : 0.45 } })
  }
  const lbl = (txt: string, fill: string, color: string) => ({ label: txt, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6, labelBgStyle: { fill }, labelStyle: { fill: color, fontWeight: 700, fontSize: 11 } })
  list.push({ id: 'e-com-A', source: 'comercio', target: 'lenderA', type: 'smoothstep', animated: e.cPass > 0, ...lbl(`${e.cPass} evaluados`, '#fef2f2', '#991b1b'), style: { stroke: cA, strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: cA } })
  list.push({ id: 'e-com-B', source: 'comercio', target: 'lenderB', type: 'smoothstep', animated: e.cPass > 0, ...lbl(`${e.cPass} evaluados`, '#eef2ff', '#3730a3'), style: { stroke: cB, strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: cB } })
  list.push({ id: 'e-A-cred', source: 'lenderA', target: 'credito', type: 'smoothstep', animated: e.apprA > 0, ...lbl(`Externo: ${e.apprA}`, '#ecfdf5', '#065f46'), style: { stroke: e.apprA ? green : gray, strokeWidth: 2.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: e.apprA ? green : gray } })
  list.push({ id: 'e-B-cred', source: 'lenderB', target: 'credito', type: 'smoothstep', animated: e.apprB > 0, ...lbl(`Creditop X: ${e.apprB}`, '#ecfdf5', '#065f46'), style: { stroke: e.apprB ? green : gray, strokeWidth: 2.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: e.apprB ? green : gray } })
  edges.value = list
})
function reset() { applyDefaults(comercioCfg, COMERCIO_DEF); applyDefaults(lenderACfg, LENDER_A_DEF); applyDefaults(lenderBCfg, LENDER_B_DEF); pais.value = 'CO'; fitView({ padding: 0.1 }) }

const actorTitle = (who: string) => (who === 'comercio' ? 'Comercio' : who === 'lenderA' ? 'Lender externo' : 'Creditop X')
const actorSub = (who: string) => (who === 'comercio' ? 'Puerta de entrada · solo endurece' : who === 'lenderA' ? 'Agregador · cierra fuera (redirect/API)' : 'In-platform · marca del comercio (CrediPullman)')
const actorOrigin = (who: string) => (who === 'lenderA' ? 'externo' : who === 'lenderB' ? 'Creditop X · marca blanca' : '')
const actorIco = (who: string) => (who === 'comercio' ? '🏬' : who === 'lenderA' ? '🏦' : '🟣')
const actorBadge = (who: string) => { const e = evaluacion.value; return who === 'comercio' ? `${e.cPass}/${e.total}` : who === 'lenderA' ? `${e.apprA}/${e.cPass}` : `${e.apprB}/${e.cPass}` }

// ===== Comparación A vs B (aporte de cada lender) =====
const showCompare = ref(true)
const comparativa = computed(() => {
  const e = evaluacion.value
  let ambos = 0, soloA = 0, soloB = 0, ninguno = 0, comercioRej = 0
  for (const u of usuarios.value) {
    const v = e.per[u.id]
    if (!v.mOk) comercioRej++
    else if (v.aOk && v.bOk) ambos++
    else if (v.aOk) soloA++
    else if (v.bOk) soloB++
    else ninguno++
  }
  const mejorSolo = Math.max(e.apprA, e.apprB)
  return { ambos, soloA, soloB, ninguno, comercioRej, union: e.apprAny, mejorSolo, marginal: e.apprAny - mejorSolo, total: e.total }
})
const pctOf = (n: number) => (comparativa.value.total ? (n / comparativa.value.total) * 100 : 0) + '%'
</script>

<template>
  <div class="sim">
    <header class="sim-bar">
      <span class="sim-brand"><strong>CREDITOP</strong> · externo vs Creditop X (marca propia) sobre el mismo pool</span>
      <div class="sim-pais">
        <span>País:</span>
        <button v-for="(p, k) in PAISES" :key="k" :class="{ on: pais === k }" @click="pais = k">{{ p.label }}</button>
        <span class="sim-buro">buró: <b>{{ PAISES[pais].buro }}</b></span>
      </div>
      <button class="sim-reset" @click="reset">↺ Reiniciar</button>
    </header>

    <div class="sim-disclaimer" role="note">
      ⚠️ <b>Demo educativa.</b> Reglas, umbrales y perfiles son <b>ilustrativos</b> — NO reproducen la lógica real de originación de Creditop (pipeline ML, unlock, categorías). Para evaluar contra las reglas reales de BD: <code>creditop elegibilidad</code>.
    </div>

    <div class="sim-hint">
      El comercio ofrece un <b>lender externo</b> y su propia línea <b>Creditop X (marca CrediPullman)</b> — <b>mismo motor de reglas</b>, distinto origen.
      Llega al crédito si lo aprueba <b>al menos uno</b>. Cada ficha marca quién: <b>E</b>=externo, <b>X</b>=Creditop X, <b>EX</b>=ambos.
      <span class="sim-legend">
        <span class="lg"><i class="sw f"></i>♀</span><span class="lg"><i class="sw m"></i>♂</span>
        <span class="lg"><i class="dot ok"></i>aprobado</span>
        <span class="lg"><i class="dot no"></i>filtrado</span>
        <span class="lg">hover = datos</span>
      </span>
      <span class="sim-kpi">✅ {{ evaluacion.apprAny }} · Ext:{{ evaluacion.apprA }} · CX:{{ evaluacion.apprB }} · ❌ {{ evaluacion.total - evaluacion.apprAny }} de {{ evaluacion.total }}</span>
    </div>

    <main class="sim-canvas">
      <VueFlow v-model:nodes="nodes" :edges="edges" :min-zoom="0.25" :max-zoom="2" fit-view-on-init :elements-selectable="false">
        <template #node-user="{ data }">
          <template v-for="u in [userById[data.uid]]" :key="data.uid">
            <div class="chip" :class="[u.genero === 'F' ? 'f' : 'm', veredictoDe(u.id).status]" @mouseenter="showTip(u.id, $event)" @mousemove="moveTip" @mouseleave="hideTip">
              <Handle type="source" :position="Position.Right" />
              <span class="chip-sex">{{ u.genero === 'F' ? '♀' : '♂' }}</span>
              <span class="chip-age">{{ u.edad }}</span>
              <span class="chip-status" :class="[veredictoDe(u.id).status, 'by' + veredictoDe(u.id).approvedBy]">{{ veredictoDe(u.id).status === 'approved' ? veredictoDe(u.id).approvedBy : '✕' }}</span>
            </div>
          </template>
        </template>

        <template #node-actor="{ data }">
          <div class="n-actor" :class="data.who">
            <Handle type="target" :position="Position.Left" />
            <Handle type="source" :position="Position.Right" />
            <header class="na-head">
              <span class="na-ico">{{ actorIco(data.who) }}</span>
              <b>{{ actorTitle(data.who) }}</b>
              <span v-if="actorOrigin(data.who)" class="na-origin">{{ actorOrigin(data.who) }}</span>
              <span class="na-badge">{{ actorBadge(data.who) }}</span>
            </header>
            <p class="na-sub">{{ actorSub(data.who) }}</p>
            <div class="na-fams nodrag">
              <template v-for="fam in actorFamilias(data.who)" :key="fam">
                <div class="na-fam">{{ FAM_LABEL[fam] }}</div>
                <ul class="na-rules">
                  <li v-for="r in rulesDe(data.who, fam)" :key="r.key" :class="{ on: cfgOf(data.who)[r.key].on, reg: r.reg }">
                    <label class="na-rule-h">
                      <input type="checkbox" v-model="cfgOf(data.who)[r.key].on" :disabled="r.reg" />
                      <span class="na-rname">{{ r.label }}<span v-if="r.reg" class="lock">🔒</span></span>
                    </label>
                    <div v-if="cfgOf(data.who)[r.key].on" class="na-rval">
                      <template v-if="r.kind === 'set'">
                        <button v-for="o in r.options" :key="o" type="button" class="na-opt" :class="{ sel: cfgOf(data.who)[r.key].value.includes(o) }" @click="toggleOpt(cfgOf(data.who), r.key, o)">{{ o }}</button>
                      </template>
                      <template v-else-if="r.kind === 'bool_false' || r.kind === 'bool_true'"><span class="na-fixed">{{ r.kind === 'bool_false' ? 'debe ser NO' : 'debe ser SÍ' }}</span></template>
                      <RangeSlider v-else-if="r.kind === 'range'" v-model:min="cfgOf(data.who)[r.key].value.min" v-model:max="cfgOf(data.who)[r.key].value.max" :lo="r.lo ?? 0" :hi="r.hi ?? 100" :step="r.step" :unit="r.unit" />
                      <template v-else>
                        <ValueSlider v-model="cfgOf(data.who)[r.key].value" :lo="r.lo ?? 0" :hi="r.hi ?? 100" :step="r.step" :unit="r.unit" :money="r.money" :mode="r.kind === 'min' ? '≥' : '≤'" />
                        <span v-if="r.key === 'score_min' && !esComercio(data.who)" class="na-src">fuente: {{ PAISES[pais].buro }}</span>
                      </template>
                    </div>
                  </li>
                </ul>
              </template>
            </div>
          </div>
        </template>

        <template #node-outcome>
          <div class="n-out">
            <Handle type="target" :position="Position.Left" />
            <span class="no-ico">💳</span><b>Crédito</b>
            <span class="no-n">{{ evaluacion.apprAny }}</span><span class="no-sub">aprobados (A∪B)</span>
          </div>
        </template>

        <Background :gap="22" pattern-color="#e2e8f0" />
        <Controls />
      </VueFlow>

      <!-- Panel comparación A vs B -->
      <div v-if="showCompare" class="sim-compare">
        <header @click="showCompare = false"><b>Comparación A vs B</b><span class="cmp-x">▾ ocultar</span></header>
        <div class="cmp-bar">
          <div class="seg ambos" :style="{ width: pctOf(comparativa.ambos) }" :title="'Ambos: ' + comparativa.ambos"></div>
          <div class="seg soloA" :style="{ width: pctOf(comparativa.soloA) }" :title="'Solo A: ' + comparativa.soloA"></div>
          <div class="seg soloB" :style="{ width: pctOf(comparativa.soloB) }" :title="'Solo B: ' + comparativa.soloB"></div>
          <div class="seg ninguno" :style="{ width: pctOf(comparativa.ninguno) }" :title="'Ninguno: ' + comparativa.ninguno"></div>
          <div class="seg com" :style="{ width: pctOf(comparativa.comercioRej) }" :title="'Comercio: ' + comparativa.comercioRej"></div>
        </div>
        <ul class="cmp-legend">
          <li><i class="d ambos"></i>Ambos (Ext∩CX)<b>{{ comparativa.ambos }}</b></li>
          <li><i class="d soloA"></i>Solo externo<b>{{ comparativa.soloA }}</b></li>
          <li><i class="d soloB"></i>Solo Creditop X<b>{{ comparativa.soloB }}</b></li>
          <li><i class="d ninguno"></i>Ninguno<b>{{ comparativa.ninguno }}</b></li>
          <li><i class="d com"></i>Filtrado comercio<b>{{ comparativa.comercioRej }}</b></li>
        </ul>
        <div class="cmp-insight">
          Juntos aprueban <b>{{ comparativa.union }}</b> — <b class="up">+{{ comparativa.marginal }}</b> vs el mejor lender solo ({{ comparativa.mejorSolo }}).
        </div>
      </div>
      <button v-else class="sim-compare-btn" @click="showCompare = true">▴ Comparación A vs B</button>

      <div v-if="tip" class="sim-tip" :style="{ left: tip.x + 14 + 'px', top: tip.y + 14 + 'px' }">
        <div class="tip-head"><b>{{ tip.u.nombre }}</b> <span>CC {{ tip.u.cedula }}</span></div>
        <div class="tip-grid">
          <span>Edad</span><b>{{ tip.u.edad }} años</b>
          <span>Género</span><b>{{ tip.u.genero === 'F' ? 'Mujer' : 'Hombre' }}</b>
          <span>País</span><b>{{ tip.u.pais }}</b>
          <span>Score</span><b :style="{ color: scoreBand(tip.u.score) }">{{ tip.u.score }} pts</b>
          <span>Ingreso</span><b>{{ fmtMoney(tip.u.ingreso) }}</b>
          <span>DTI</span><b>{{ tip.u.dti }}%</b>
          <span>Ocupación</span><b>{{ tip.u.ocupacion }}</b>
          <span>Mora actual</span><b :class="{ red: tip.u.moraActual }">{{ tip.u.moraActual ? 'sí' : 'no' }}</b>
          <span>Listas</span><b :class="{ red: tip.u.enLista }">{{ tip.u.enLista ? 'reportado' : 'limpio' }}</b>
        </div>
        <div class="tip-lenders" v-if="tip.v.mOk">
          <div class="tl" :class="tip.v.aOk ? 'ok' : 'no'"><b>Externo</b> {{ tip.v.aOk ? '✓ aprueba' : '✗ ' + tip.v.aReason }}</div>
          <div class="tl" :class="tip.v.bOk ? 'ok' : 'no'"><b>Creditop X</b> {{ tip.v.bOk ? '✓ aprueba' : '✗ ' + tip.v.bReason }}</div>
        </div>
        <div class="tip-status" :class="tip.v.status">
          <template v-if="!tip.v.mOk">❌ Filtrado en comercio · {{ tip.v.comercioReason }}</template>
          <template v-else-if="tip.v.status === 'approved'">✅ Crédito aprobado (por {{ tip.v.approvedBy === 'EX' ? 'externo y Creditop X' : tip.v.approvedBy === 'E' ? 'el lender externo' : 'Creditop X' }})</template>
          <template v-else>❌ Rechazado por externo y Creditop X</template>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.sim { height: 100vh; display: flex; flex-direction: column; background: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; }
.sim-bar { display: flex; align-items: center; gap: 14px; padding: 9px 18px; background: #0f172a; color: #fff; flex-wrap: wrap; }
.sim-brand { font-size: 13px; color: #94a3b8; } .sim-brand strong { color: #fff; }
.sim-disclaimer { font-size: 11.5px; color: #92400e; background: #fffbeb; border-bottom: 1px solid #fde68a; padding: 6px 18px; line-height: 1.5; }
.sim-disclaimer b { color: #78350f; }
.sim-disclaimer code { background: #fef3c7; border-radius: 4px; padding: 1px 5px; font-family: ui-monospace, monospace; font-size: 11px; }
.sim-pais { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 12px; color: #94a3b8; }
.sim-pais button { border: 1px solid #334155; background: #1e293b; color: #cbd5e1; border-radius: 7px; padding: 3px 9px; cursor: pointer; font-size: 12px; }
.sim-pais button.on { background: #2563eb; color: #fff; border-color: #2563eb; }
.sim-buro { margin-left: 4px; } .sim-buro b { color: #e2e8f0; }
.sim-reset { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 5px 12px; font-size: 12.5px; cursor: pointer; }
.sim-hint { font-size: 12px; color: #475569; padding: 7px 18px; background: #fff; border-bottom: 1px solid #e2e8f0; line-height: 1.55; display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
.sim-hint b { color: #0f172a; }
.sim-legend { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #64748b; }
.sim-legend .lg { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; }
.sw { width: 12px; height: 12px; border-radius: 4px; display: inline-block; } .sw.f { background: #f9a8d4; } .sw.m { background: #93c5fd; }
.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; } .dot.ok { background: #10b981; box-shadow: 0 0 0 2px #10b98140; } .dot.no { background: #cbd5e1; }
.sim-kpi { margin-left: auto; font-weight: 700; color: #0f172a; background: #f1f5f9; border-radius: 20px; padding: 3px 12px; white-space: nowrap; font-size: 12px; }
.sim-canvas { flex: 1; min-height: 0; position: relative; }

.chip { position: relative; width: 50px; height: 50px; border-radius: 15px; border: 1.5px solid #e2e8f0; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 3px rgba(15,23,42,.12); transition: opacity .2s, transform .12s, box-shadow .2s; }
.chip.f { background: #fce7f3; } .chip.m { background: #dbeafe; }
.chip.approved { box-shadow: 0 0 0 2px #10b98155, 0 2px 8px rgba(16,185,129,.35); }
.chip.rejected { opacity: .4; filter: grayscale(.3); }
.chip:hover { transform: scale(1.12); opacity: 1; z-index: 20; box-shadow: 0 4px 14px rgba(15,23,42,.3); }
.chip-age { font-size: 19px; font-weight: 800; } .chip.f .chip-age { color: #be185d; } .chip.m .chip-age { color: #1e40af; }
.chip-sex { position: absolute; top: 2px; left: 5px; font-size: 10px; opacity: .65; } .chip.f .chip-sex { color: #be185d; } .chip.m .chip-sex { color: #1e40af; }
.chip-status { position: absolute; bottom: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 2px; border-radius: 8px; font-size: 9px; font-weight: 800; display: flex; align-items: center; justify-content: center; color: #fff; border: 2px solid #fff; }
.chip-status.rejected { background: #ef4444; }
.chip-status.byE { background: #dc2626; } .chip-status.byX { background: #6366f1; } .chip-status.byEX { background: #10b981; }

.sim-tip { position: fixed; z-index: 1000; pointer-events: none; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 10px 12px; width: 218px; box-shadow: 0 8px 24px rgba(0,0,0,.3); font-size: 12px; }
.tip-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 7px; }
.tip-head b { font-size: 14px; color: #fff; } .tip-head span { font-size: 9.5px; color: #94a3b8; font-family: ui-monospace, monospace; }
.tip-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; }
.tip-grid span { color: #94a3b8; } .tip-grid b { color: #fff; text-align: right; font-weight: 600; } .tip-grid b.red { color: #fca5a5; }
.tip-lenders { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.tl { font-size: 10.5px; padding: 3px 7px; border-radius: 5px; } .tl b { color: #fff; margin-right: 4px; }
.tl.ok { background: #064e3b; color: #6ee7b7; } .tl.no { background: #3f2a2a; color: #fca5a5; }
.tip-status { margin-top: 7px; padding: 5px 8px; border-radius: 6px; font-weight: 700; font-size: 11px; text-align: center; }
.tip-status.approved { background: #064e3b; color: #6ee7b7; } .tip-status.rejected { background: #4c1d1d; color: #fca5a5; }

.n-actor { width: 262px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 2px 8px rgba(15,23,42,.1); overflow: hidden; }
.na-head { display: flex; align-items: center; gap: 8px; padding: 9px 12px; color: #fff; }
.n-actor.comercio .na-head { background: #f59e0b; } .n-actor.lenderA .na-head { background: #dc2626; } .n-actor.lenderB .na-head { background: #6366f1; }
.na-head b { font-size: 14px; flex: 1; } .na-ico { font-size: 15px; }
.na-badge { background: rgba(255,255,255,.25); border-radius: 12px; padding: 1px 9px; font-size: 12px; font-weight: 700; }
.na-origin { background: rgba(255,255,255,.22); border-radius: 10px; padding: 1px 7px; font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.na-sub { margin: 0; padding: 6px 12px 2px; font-size: 10.5px; color: #94a3b8; }
.na-fams { padding: 2px 10px 10px; }
.na-fam { font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: #94a3b8; margin: 9px 0 2px; border-bottom: 1px solid #f1f5f9; padding-bottom: 2px; }
.na-rules { list-style: none; margin: 0; padding: 0; } .na-rules li { padding: 4px 0; } .na-rules li.on { background: #fafdff; } .na-rules li.reg { background: #fff7ed; }
.na-rule-h { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.na-rname { font-size: 11.5px; color: #334155; } .lock { margin-left: 4px; font-size: 10px; }
.na-rval { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 4px 0 2px 21px; }
.na-rval input[type=number] { width: 86px; font-size: 12px; padding: 3px 6px; border: 1px solid #cbd5e1; border-radius: 6px; }
.na-src { font-size: 9.5px; color: #2563eb; width: 100%; }
.na-fixed { font-size: 10.5px; color: #64748b; font-style: italic; }
.na-opt { font-size: 10px; border: 1px solid #cbd5e1; background: #fff; color: #64748b; border-radius: 12px; padding: 2px 7px; cursor: pointer; }
.na-opt.sel { background: #0f172a; color: #fff; border-color: #0f172a; }

/* Panel comparación A vs B */
.sim-compare { position: absolute; top: 12px; right: 12px; width: 250px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 6px 20px rgba(15,23,42,.15); padding: 12px 14px; z-index: 30; }
.sim-compare > header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 10px; }
.sim-compare > header b { font-size: 13px; color: #0f172a; } .cmp-x { font-size: 10.5px; color: #94a3b8; }
.cmp-bar { display: flex; height: 16px; border-radius: 8px; overflow: hidden; background: #f1f5f9; }
.cmp-bar .seg { height: 100%; transition: width .35s ease; }
.seg.ambos { background: #10b981; } .seg.soloA { background: #dc2626; } .seg.soloB { background: #6366f1; } .seg.ninguno { background: #94a3b8; } .seg.com { background: #e2e8f0; }
.cmp-legend { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.cmp-legend li { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: #475569; }
.cmp-legend .d { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 10px; }
.cmp-legend .d.ambos { background: #10b981; } .cmp-legend .d.soloA { background: #dc2626; } .cmp-legend .d.soloB { background: #6366f1; } .cmp-legend .d.ninguno { background: #94a3b8; } .cmp-legend .d.com { background: #cbd5e1; }
.cmp-legend b { margin-left: auto; color: #0f172a; font-weight: 700; }
.cmp-insight { margin-top: 10px; padding: 8px 10px; background: #ecfdf5; border-radius: 8px; font-size: 11.5px; color: #065f46; line-height: 1.4; }
.cmp-insight b { color: #064e3b; } .cmp-insight b.up { color: #059669; }
.sim-compare-btn { position: absolute; top: 12px; right: 12px; z-index: 30; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 11px; font-size: 12px; font-weight: 700; color: #334155; cursor: pointer; box-shadow: 0 2px 8px rgba(15,23,42,.12); }

.n-out { width: 130px; background: #0f172a; color: #fff; border-radius: 12px; padding: 14px; text-align: center; box-shadow: 0 4px 12px rgba(15,23,42,.25); }
.no-ico { font-size: 22px; display: block; } .n-out b { font-size: 14px; display: block; margin-top: 2px; }
.no-n { font-size: 30px; font-weight: 800; color: #4dd0a0; display: block; line-height: 1.1; margin-top: 4px; } .no-sub { font-size: 10px; color: #94a3b8; }
</style>
