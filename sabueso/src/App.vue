<script setup>
/* SABUESO: encontrar comercios (y entidades) que todavía no trabajan con CreditOp y llevar la relación con cada uno.
 *
 * Las regiones del workbench (tablero/tasks/sabueso: la maqueta):
 *   - sidebar: dos vistas apiladas, Comercios y Entidades, agrupadas por etapa en el orden del embudo. Prospectos por
 *     encaje; en negociación, por próximo paso (lo vencido arriba); entidades, por días en su etapa;
 *   - editor: la pestaña fija Embudo, la de Registro (buscar en el registro mercantil) y una por empresa abierta;
 *   - secundario: los datos de la empresa elegida, su encaje y de dónde salió;
 *   - panel: la actividad de todas, en vivo;
 *   - pie: los conteos.
 * Todo pasa por la API (sabueso/server). Rutas: `#/` (embudo), `#/registro`, `#/nueva`, `#/c/<id>`. */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { vResize, readSize, saveSize, readPref, savePref, fitRegions, cssSize, bindThemeToggle, toast, confirmDialog } from './workbench.js'

// ── los datos ──
const companies = ref([])
const stages = ref({ merchant: [], lender: [] })
const sectors = ref([])
const measuredAt = ref('')
const measureError = ref('')
const clientCount = ref(0)
const loaded = ref(false)
const apiError = ref('')

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Sabueso': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
  return out
}
async function load() {
  try {
    const s = await api('/api/state')
    companies.value = s.companies
    stages.value = s.stages
    sectors.value = s.sectors
    measuredAt.value = s.measuredAt
    measureError.value = s.measureError || ''
    clientCount.value = s.clients
    apiError.value = ''
  } catch { apiError.value = 'No contesta la API de Sabueso.' }
  loaded.value = true
}
// Corre una acción, avisa si falla y vuelve a leer.
async function act(fn, ok) {
  try { await fn(); await load(); if (ok) toast(ok); return true } catch (err) { toast('No se pudo', { description: err.message, kind: 'destructive', timeout: 0 }); return false }
}

// ── fechas ──
const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const shortDate = (iso) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
const clock = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })
function dueLabel(next) {
  if (!next) return ''
  if (next.due < today()) return 'vencido'
  if (next.due === today()) return 'hoy'
  return shortDate(next.due)
}
const overdue = (c) => c.next && c.next.due < today() && c.stage !== 'lost'
// Días en la etapa: desde el último cambio de etapa (o desde que entró).
function daysInStage(c) {
  const last = [...c.activities].reverse().find((a) => a.kind === 'stage' || a.kind === 'created')
  return last ? Math.max(0, Math.floor((Date.now() - new Date(last.at)) / 864e5)) : 0
}
// Una razón social del registro viene en mayúsculas: se muestra legible, sin la forma jurídica al final.
const SMALL = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'para', 'en'])
function pretty(name) {
  if (!name || name !== name.toUpperCase()) return name
  const words = name.toLowerCase().replace(/\s+(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|sas)\s*$/i, '').split(/\s+/)
  return words.map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}
const plural = (n, one, many) => `${n.toLocaleString('es-CO')} ${n === 1 ? one : many}`
const money = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M` : n ? `${Math.round(n / 1e3)} mil` : '—')
const stageName = (kind, id) => stages.value[kind]?.find((s) => s.id === id)?.name || id
const sectorName = (id) => sectors.value.find((s) => s.id === id)?.name || ''

// ── LAS ENTIDADES, OCULTAS por ahora (Miguel, 2026-11-21: «empecemos por comercio; oculta, no elimines»). El código
//    sigue: con true vuelven la vista, el embudo y el alta de entidades. ──
const SHOW_LENDERS = false
// ── LA VISTA SIMPLE (Miguel, 2026-11-21: «hagamos lo simple»): a la izquierda los comercios que tienen por dónde
//    contactarlos, al centro de qué es el comercio, a la derecha cómo contactarlo. Sólo se lee: lo actualiza la consola
//    (bin/sabueso) con Claude. Con false vuelve la vista completa (embudo, registro, etapas, bitácora), que sigue acá. ──
const SIMPLE = true
const KINDS = SHOW_LENDERS ? ['merchant', 'lender'] : ['merchant']

// ── el sidebar: las dos vistas, por etapa ──
const search = ref('')
const matches = (c) => { const q = search.value.trim().toLowerCase(); return !q || c.name.toLowerCase().includes(q) || (c.nit || '').includes(q) }
function sortFor(kind, stage) {
  if (stage === 'prospect') return (a, b) => b.fit - a.fit || b.points - a.points || a.name.localeCompare(b.name, 'es')
  if (kind === 'lender') return (a, b) => daysInStage(b) - daysInStage(a)
  const due = (c) => c.next?.due || '9999'
  return (a, b) => due(a).localeCompare(due(b)) || b.fit - a.fit
}
function groupsOf(kind) {
  return (stages.value[kind] || []).map((s) => ({
    ...s,
    items: companies.value.filter((c) => c.kind === kind && c.stage === s.id && matches(c)).sort(sortFor(kind, s.id)),
  })).filter((g) => g.items.length)
}
const merchantGroups = computed(() => groupsOf('merchant'))
const lenderGroups = computed(() => groupsOf('lender'))
const count = (kind) => companies.value.filter((c) => c.kind === kind && c.stage !== 'lost').length
const views = reactive({ merchant: readPref('sabueso.view-merchant', '1') !== '0', lender: readPref('sabueso.view-lender', '1') !== '0' })
function toggleView(kind) { views[kind] = !views[kind]; savePref(`sabueso.view-${kind}`, views[kind] ? '1' : '0') }
function rowMeta(c) {
  if (c.handedTo) return c.handedTo
  if (c.kind === 'lender') return `${daysInStage(c)} d`
  if (c.stage === 'prospect') return c.fit ? String(c.fit) : ''
  return dueLabel(c.next)
}
const groupHint = { prospect: 'por encaje', contacted: 'por próximo paso', demo: 'por próximo paso', preregistered: 'por próximo paso', kyb: 'por próximo paso', linking: 'por próximo paso' }

// ── las rutas y las pestañas del editor ──
const route = ref({ view: 'funnel', id: '' })
const openTabs = ref((() => { try { return JSON.parse(readPref('sabueso.tabs', '[]')) } catch { return [] } })())
const previewTab = ref('')
function readRoute() {
  const h = location.hash.replace(/^#\/?/, '')
  if (h.startsWith('c/')) {
    const id = h.slice(2)
    route.value = { view: 'company', id }
    if (!openTabs.value.includes(id)) {
      // Lo que se abre con un clic reemplaza a la pestaña de vista previa (en itálica, como en VS Code).
      if (previewTab.value && openTabs.value.includes(previewTab.value)) openTabs.value.splice(openTabs.value.indexOf(previewTab.value), 1, id)
      else openTabs.value.push(id)
      previewTab.value = id
    }
  } else if (h === 'registro') route.value = { view: 'discover', id: '' }
  else if (h.startsWith('nueva')) route.value = { view: 'new', id: h.includes('lender') ? 'lender' : 'merchant' }
  else route.value = { view: 'funnel', id: '' }
}
watch(openTabs, (v) => savePref('sabueso.tabs', JSON.stringify(v)), { deep: true })
const go = (hash) => { if (location.hash === hash) readRoute(); else location.hash = hash }
const pin = (id) => { if (previewTab.value === id) previewTab.value = '' }
function closeTab(id) {
  const i = openTabs.value.indexOf(id)
  if (i < 0) return
  openTabs.value.splice(i, 1)
  if (previewTab.value === id) previewTab.value = ''
  if (route.value.view === 'company' && route.value.id === id) go(openTabs.value.length ? `#/c/${openTabs.value[Math.max(0, i - 1)]}` : '#/')
}
const tabCompanies = computed(() => openTabs.value.map((id) => companies.value.find((c) => c.id === id)).filter(Boolean))
const company = computed(() => (route.value.view === 'company' ? companies.value.find((c) => c.id === route.value.id) : null))
// La que muestra el secundario: la abierta, o la última que se eligió.
const detail = computed(() => company.value)

// ── el embudo ──
const funnelOf = (kind) => (stages.value[kind] || []).filter((s) => s.id !== 'lost').map((s) => ({ ...s, n: companies.value.filter((c) => c.kind === kind && c.stage === s.id).length }))
const nextSteps = computed(() => companies.value.filter((c) => c.next && c.stage !== 'lost').sort((a, b) => a.next.due.localeCompare(b.next.due)))
const overdueCount = computed(() => companies.value.filter(overdue).length)
const sellingCount = computed(() => companies.value.filter((c) => c.stage === 'selling' || c.stage === 'live').length)
const measuring = ref(false)
async function remeasure() {
  measuring.value = true
  await act(() => api('/api/measure', { method: 'POST' }), 'Medido de nuevo en prod')
  measuring.value = false
}

// ── el registro mercantil ──
const disc = reactive({ sector: readPref('sabueso.disc-sector', 'motorcycles'), minPoints: 3, busy: false, list: null, source: '', error: '', hideClients: true })
const discShown = computed(() => (disc.list || []).filter((c) => !(disc.hideClients && c.client)))
const discHidden = computed(() => (disc.list || []).filter((c) => c.client).length)
async function runDiscover(sector) {
  if (sector) disc.sector = sector
  savePref('sabueso.disc-sector', disc.sector)
  go('#/registro')
  disc.busy = true
  disc.error = ''
  try {
    const r = await api('/api/discover', { method: 'POST', body: { sector: disc.sector, minPoints: Number(disc.minPoints) || 3 } })
    disc.list = r.candidates
    disc.source = r.source
  } catch (err) { disc.error = err.message; disc.list = null }
  disc.busy = false
}
async function track(c) {
  const ok = await act(() => api('/api/companies', { method: 'POST', body: { kind: 'merchant', name: c.name, nit: c.nit, sector: c.sector, ciiu: c.ciiu, region: c.region, points: c.points, renewed: c.renewed, source: 'registry' } }), `${pretty(c.name)} entró como prospecto`)
  if (ok) {
    const added = companies.value.find((x) => x.nit === c.nit)
    if (added) c.tracked = added.id
  }
}

// ── una empresa nueva, a mano ──
const blank = (kind) => ({ kind, name: '', nit: '', sector: '', region: '', points: 0, online: false, website: '', email: '', phone: '' })
const draft = ref(blank('merchant'))
watch(() => route.value, (r) => { if (r.view === 'new' && draft.value.kind !== r.id) draft.value = blank(r.id) })
async function createCompany() {
  if (!draft.value.name.trim()) { toast('Falta el nombre', { kind: 'destructive' }); return }
  let id = ''
  const ok = await act(async () => { id = (await api('/api/companies', { method: 'POST', body: { ...draft.value, points: Number(draft.value.points) || 0 } })).id }, 'Agregada')
  if (ok) { draft.value = blank(draft.value.kind); go(`#/c/${id}`); pin(id) }
}

// ── lo que se hace con una empresa ──
const patchCompany = (c, body, ok) => act(() => api(`/api/companies/${c.id}`, { method: 'PATCH', body }), ok)
const setStage = (c, stage) => stage !== c.stage && patchCompany(c, { stage }, `${c.name}: ${stageName(c.kind, stage)}`)
const composer = reactive({ kind: 'call', text: '' })
async function addActivity(c) {
  if (!composer.text.trim()) return
  const ok = await act(() => api(`/api/companies/${c.id}/activities`, { method: 'POST', body: { kind: composer.kind, text: composer.text } }))
  if (ok) composer.text = ''
}
const stepDraft = reactive({ open: false, text: '', due: '' })
function editStep(c) { stepDraft.open = true; stepDraft.text = c.next?.text || ''; stepDraft.due = c.next?.due || plusDays(2) }
async function saveStep(c) {
  if (await patchCompany(c, { next: { text: stepDraft.text, due: stepDraft.due } })) stepDraft.open = false
}
const handoff = reactive({ open: false, to: '' })
async function saveHandoff(c) {
  if (await patchCompany(c, { handedTo: handoff.to }, handoff.to ? `Lo retoma ${handoff.to}` : 'Vuelve a vos')) handoff.open = false
}
async function removeCompany(c) {
  if (!(await confirmDialog({ title: `¿Sacar a ${c.name} de Sabueso?`, description: 'Se borra con su bitácora. Si sólo no va, mejor «Descartar»: queda el registro de por qué.', confirm: 'Sacar', destructive: true }))) return
  if (await act(() => api(`/api/companies/${c.id}`, { method: 'DELETE' }), 'Sacada de Sabueso')) closeTab(c.id)
}
watch(() => route.value.id, () => { stepDraft.open = false; handoff.open = false; composer.text = '' })
// Un campo del secundario se guarda al salir de él.
function saveField(c, field, value) {
  const v = field === 'points' ? Number(value) || 0 : value
  if ((c[field] ?? '') === v) return
  patchCompany(c, { [field]: v })
}
// ── el contacto para la propuesta: lo busca Claude por internet (server/contact.go) ──
const CHANNEL = { email: 'Correo', phone: 'Teléfono', whatsapp: 'WhatsApp', form: 'Formulario' }
const FIT = { proposals: 'recibe propuestas', commercial: 'comercial', general: 'general' }
const CH_ICON = { email: 'send', phone: 'audio', whatsapp: 'comment', form: 'edit' }
const FIT_RANK = { proposals: 0, commercial: 1, general: 2 }
const CH_RANK = { email: 0, whatsapp: 1, phone: 2, form: 3 }
const sortedContacts = (c) => [...(c.research?.contacts || [])].sort((a, b) => FIT_RANK[a.fit] - FIT_RANK[b.fit] || CH_RANK[a.channel] - CH_RANK[b.channel])
const reachIcon = (c) => (c.research?.contacts.length ? CH_ICON[sortedContacts(c)[0].channel] : 'eye-off')
const reachTitle = (c) => { const b = sortedContacts(c)[0]; return b ? `${CHANNEL[b.channel]} ${b.value} · ${FIT[b.fit]}` : 'Sin canal público' }
// Un formulario: su URL si la trae el valor; si no, la página donde está.
const formUrl = (ct) => (ct.value.match(/https?:\/\/\S+/) || [ct.source])[0].replace(/[)'.,]+$/, '')
const contactHref = (ct) => ct.channel === 'form' ? formUrl(ct) : ({ email: `mailto:${ct.value}`, phone: `tel:${ct.value.replace(/[^+\d]/g, '')}`, whatsapp: `https://wa.me/${ct.value.replace(/\D/g, '')}` }[ct.channel] || ct.source)
const searching = ref('')
async function searchContact(c) {
  searching.value = c.id
  toast('Buscando el contacto con Claude', { description: 'Por internet, en el sitio de la empresa y directorios públicos. Tarda un minuto y medio, más o menos.' })
  await act(() => api(`/api/companies/${c.id}/contact`, { method: 'POST', body: {} }), 'Búsqueda terminada')
  searching.value = ''
}
const ACT_ICON = { research: 'search', note: 'comment', call: 'audio', email: 'send', meeting: 'video', stage: 'chevron', handoff: 'move', created: 'plus', client: 'check' }
const ACT_KINDS = [['call', 'Llamada'], ['email', 'Correo'], ['meeting', 'Reunión'], ['note', 'Nota']]
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return u } }
// Los comercios que tienen al menos un canal, del que más encaja al que menos; el elegido es el de la ruta o el primero.
const reachable = computed(() => companies.value.filter((c) => c.kind === 'merchant' && c.research?.contacts?.length).sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name, 'es')))
const picked = computed(() => (route.value.view === 'company' && reachable.value.find((c) => c.id === route.value.id)) || reachable.value[0] || null)
const logOf = (c) => [...c.activities].reverse()

// ── el panel: la actividad de todas ──
const recent = computed(() => companies.value.flatMap((c) => c.activities.map((a) => ({ ...a, company: c }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80))

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const viewportH = ref(window.innerHeight)
const sidebarOpen = ref(readSize('sabueso.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('sabueso.sidebar-w', 280))
const auxOpen = ref(readSize('sabueso.aux-open', 1) !== 0)
const auxW = ref(readSize('sabueso.aux-w', 300))
const panelOpen = ref(readSize('sabueso.panel-open', 1) !== 0)
const panelH = ref(readSize('sabueso.panel-h', 160))
const shown = computed(() => {
  const min = cssSize('--sidebar-min', 220)
  const [aux, sidebar] = fitRegions(viewportW.value - cssSize('--editor-min', 420), [
    { size: auxOpen.value ? auxW.value : 0, min },
    { size: sidebarOpen.value ? sidebarW.value : 0, min },
  ])
  const [panel] = fitRegions(viewportH.value - 260, [{ size: panelOpen.value ? panelH.value : 0, min: cssSize('--panel-min', 124) }])
  return { sidebar, aux, panel }
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shown.value.sidebar}px`, '--auxiliarybar-w': `${shown.value.aux}px`, '--panel-h': `${shown.value.panel}px` }))
const resizeOf = (key, w, open, sign, other, def) => ({
  label: key === 'sidebar' ? 'Ancho de las listas' : 'Ancho del detalle', sign, defaultValue: def,
  min: () => cssSize('--sidebar-min', 220), max: () => viewportW.value - shown.value[other] - cssSize('--editor-min', 420),
  get: () => shown.value[key],
  set: (v) => { if (!v) open.value = false; else { open.value = true; w.value = v } },
  reopen: () => w.value,
  commit: (v) => { saveSize(`sabueso.${key}-open`, v ? 1 : 0); if (v) saveSize(`sabueso.${key}-w`, w.value) },
})
const sidebarResize = resizeOf('sidebar', sidebarW, sidebarOpen, 1, 'aux', 280)
const auxResize = resizeOf('aux', auxW, auxOpen, -1, 'sidebar', 300)
const panelResize = {
  label: 'Alto de la actividad', axis: 'y', sign: -1, defaultValue: 160,
  min: () => cssSize('--panel-min', 124), max: () => viewportH.value - 260,
  get: () => shown.value.panel,
  set: (v) => { if (!v) panelOpen.value = false; else { panelOpen.value = true; panelH.value = v } },
  reopen: () => panelH.value,
  commit: (v) => { saveSize('sabueso.panel-open', v ? 1 : 0); if (v) saveSize('sabueso.panel-h', panelH.value) },
}
const toggle = (key, open) => { open.value = !shown.value[key]; saveSize(`sabueso.${key}-open`, open.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth; viewportH.value = window.innerHeight }
const onVisibility = () => { if (!document.hidden) load() }
const themeToggle = ref(null)
let themeBinding = null
let timer = null
onMounted(async () => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  document.addEventListener('visibilitychange', onVisibility)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  await load()
  openTabs.value = openTabs.value.filter((id) => companies.value.some((c) => c.id === id))
  timer = setInterval(() => { if (!document.hidden) load() }, 60_000)
  await nextTick()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  document.removeEventListener('visibilitychange', onVisibility)
  themeBinding?.destroy?.()
  clearInterval(timer)
})
</script>

<template>
  <!-- ── la vista simple ── -->
  <div v-if="SIMPLE" class="workbench simple" :style="layoutVars">
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Comercios">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Comercios</span><span class="count">{{ reachable.length }}</span></div>
      <div class="region-body">
        <a v-for="c in reachable" :key="c.id" class="row" :class="{ on: picked?.id === c.id }" :href="`#/c/${c.id}`" :title="reachTitle(c)">
          <span class="ui-icon" :data-icon="reachIcon(c)" aria-hidden="true"></span>
          <span>{{ pretty(c.name) }}</span>
          <span class="row-meta">{{ sectorName(c.sector) }}</span>
        </a>
        <div v-if="loaded && !reachable.length" class="side-empty">Todavía ninguno con un canal para contactarlo. Se buscan por consola: <code>bin/sabueso hunt --sector motorcycles</code>.</div>
        <div v-if="apiError" class="side-empty late">{{ apiError }}</div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head"><span>{{ picked ? pretty(picked.name) : 'Sabueso' }}</span></div>
      <div v-if="picked" class="region-body doc profile">
        <h1>{{ pretty(picked.name) }}</h1>
        <p class="profile-legal">{{ picked.name }}<template v-if="picked.nit"> · NIT {{ picked.nit }}</template></p>
        <p v-if="picked.research?.summary" class="profile-summary">{{ picked.research.summary }}</p>
        <dl class="facts">
          <template v-if="picked.sector"><dt>Sector</dt><dd>{{ sectorName(picked.sector) }}</dd></template>
          <template v-if="picked.region"><dt>Ciudad</dt><dd>{{ picked.region }}</dd></template>
          <template v-if="picked.points"><dt>Puntos de venta</dt><dd>{{ picked.points }} establecimientos activos en el registro mercantil</dd></template>
          <template v-if="picked.website"><dt>Sitio web</dt><dd><a :href="picked.website.startsWith('http') ? picked.website : `https://${picked.website}`" target="_blank" rel="noopener">{{ hostOf(picked.website.startsWith('http') ? picked.website : `https://${picked.website}`) }}</a></dd></template>
          <template v-if="picked.fitWhy?.length"><dt>Por qué encaja</dt><dd>{{ picked.fitWhy.join(' · ') }}</dd></template>
        </dl>
        <p class="muted small">Del registro mercantil de Confecámaras<template v-if="picked.research"> · contacto buscado por Claude el {{ shortDate(picked.research.at) }}</template>.</p>
      </div>
      <div v-else class="region-body"><div class="empty"><div class="empty-head">
        <div class="empty-title">Sin comercios todavía</div>
        <div class="empty-desc">Los busca la consola con Claude: <code>bin/sabueso hunt --sector motorcycles</code>. Acá aparecen los que tienen por dónde contactarlos.</div>
      </div></div></div>
    </main>

    <aside v-show="shown.aux" class="auxiliarybar" aria-label="Cómo contactarlo">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head"><span>Cómo contactarlo</span></div>
      <div v-if="picked" :key="picked.id" class="region-body">
        <a v-for="ct in sortedContacts(picked)" :key="ct.channel + ct.value" class="contact" :href="contactHref(ct)" target="_blank" rel="noopener">
          <span class="ui-icon" :data-icon="CH_ICON[ct.channel]" aria-hidden="true"></span>
          <span class="contact-body">
            <span class="contact-value">{{ ct.channel === 'form' ? `Formulario · ${hostOf(formUrl(ct))}` : ct.value }}</span>
            <span class="contact-area">{{ CHANNEL[ct.channel] }} · {{ ct.area }}</span>
            <span class="contact-source">{{ hostOf(ct.source) }}</span>
          </span>
          <span class="badge badge-xs" :class="ct.fit === 'proposals' ? '' : 'badge-outline'">{{ FIT[ct.fit] }}</span>
        </a>
      </div>
    </aside>

    <footer class="statusbar">
      <span>{{ apiError || plural(reachable.length, 'comercio con canal', 'comercios con canal') }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar los comercios" aria-label="Mostrar u ocultar los comercios" @click="toggle('sidebar', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar cómo contactarlo" aria-label="Mostrar u ocultar cómo contactarlo" @click="toggle('aux', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
      </div>
    </footer>
  </div>

  <!-- ── la vista completa (oculta por ahora: SIMPLE) ── -->
  <div v-else class="workbench" :style="layoutVars">
    <!-- ── las listas ── -->
    <aside v-show="shown.sidebar" class="sidebar" aria-label="Comercios y entidades">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head">
        <span>Sabueso</span>
        <div class="region-actions">
          <a class="region-action" href="#/registro" title="Buscar comercios en el registro mercantil" aria-label="Buscar en el registro"><span class="ui-icon" data-icon="search" aria-hidden="true"></span></a>
          <a class="region-action" href="#/nueva" title="Agregar una empresa a mano" aria-label="Agregar una empresa"><span class="ui-icon" data-icon="plus" aria-hidden="true"></span></a>
        </div>
      </div>
      <div class="side-search"><input v-model="search" class="input" type="search" placeholder="Filtrar por nombre o NIT" aria-label="Filtrar"></div>
      <section v-for="kind in KINDS" :key="kind" class="view" :class="{ open: views[kind] }">
        <div class="region-head">
          <button type="button" class="view-tog" :aria-expanded="views[kind]" @click="toggleView(kind)">
            <span class="ui-icon chev" data-icon="chevron" aria-hidden="true"></span><span>{{ kind === 'merchant' ? 'Comercios' : 'Entidades' }}</span>
          </button>
          <span class="count">{{ count(kind) }}</span>
        </div>
        <div v-if="views[kind]" class="region-body">
          <template v-for="g in (kind === 'merchant' ? merchantGroups : lenderGroups)" :key="g.id">
            <div class="region-head group"><span>{{ g.name }}<template v-if="groupHint[g.id] && kind === 'merchant'"> · {{ groupHint[g.id] }}</template><template v-if="kind === 'lender' && g.id !== 'prospect'"> · por días</template></span><span class="count">{{ g.items.length }}</span></div>
            <a v-for="c in g.items" :key="c.id" class="row" :class="{ on: company?.id === c.id }" :href="`#/c/${c.id}`" @dblclick="pin(c.id)">
              <i v-if="kind === 'merchant' && c.stage === 'prospect'" class="fit-dot" :class="c.fit >= 70 ? 'is-high' : c.fit >= 40 ? 'is-mid' : 'is-low'" aria-hidden="true"></i>
              <span :title="c.name">{{ pretty(c.name) }}</span>
              <span v-if="c.research" class="ui-icon reach" :class="{ none: !c.research.contacts.length }" :data-icon="reachIcon(c)" :title="reachTitle(c)" aria-hidden="true"></span>
              <span class="row-meta" :class="{ late: overdue(c) }">{{ rowMeta(c) }}</span>
            </a>
          </template>
          <div v-if="loaded && !(kind === 'merchant' ? merchantGroups : lenderGroups).length" class="side-empty">
            {{ search ? 'Nada coincide.' : kind === 'merchant' ? 'Sin comercios todavía: buscalos en el registro o agregalos a mano.' : 'Sin entidades todavía: agregalas a mano.' }}
          </div>
        </div>
      </section>
    </aside>

    <!-- ── el editor ── -->
    <main class="editor">
      <nav class="tabs" role="tablist" aria-label="Lo abierto">
        <a class="tab" :class="{ on: route.view === 'funnel' }" href="#/" role="tab" :aria-selected="route.view === 'funnel'">Embudo</a>
        <a class="tab" :class="{ on: route.view === 'discover' }" href="#/registro" role="tab" :aria-selected="route.view === 'discover'">Registro</a>
        <span v-if="route.view === 'new'" class="tab on" role="tab" aria-selected="true">Nueva</span>
        <span v-for="c in tabCompanies" :key="c.id" class="tab" :class="{ on: company?.id === c.id, preview: previewTab === c.id }" role="tab" :aria-selected="company?.id === c.id">
          <a class="tab-label" :href="`#/c/${c.id}`" :title="c.name" @dblclick="pin(c.id)">{{ pretty(c.name) }}</a>
          <button type="button" class="tab-close" :aria-label="`Cerrar ${c.name}`" @click="closeTab(c.id)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </span>
        <div v-if="company" class="region-actions">
          <button type="button" class="region-action" title="Pasarle esta empresa a una persona" aria-label="Pasar a una persona" @click="handoff.open = !handoff.open; handoff.to = company.handedTo || ''"><span class="ui-icon" data-icon="move" aria-hidden="true"></span></button>
          <button type="button" class="region-action" title="Sacar de Sabueso" aria-label="Sacar de Sabueso" @click="removeCompany(company)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
        </div>
      </nav>

      <!-- una empresa -->
      <template v-if="company">
        <div class="subband">
          <span class="sub-what">{{ [sectorName(company.sector), company.region, company.kind === 'lender' ? 'Entidad' : ''].filter(Boolean).join(' · ') || (company.kind === 'lender' ? 'Entidad' : 'Comercio') }}</span>
          <div class="stage-bar" role="group" aria-label="Etapa">
            <button v-for="s in stages[company.kind].filter((x) => x.id !== 'lost')" :key="s.id" type="button" class="stage" :class="{ on: s.id === company.stage }" :aria-pressed="s.id === company.stage" @click="setStage(company, s.id)">{{ s.name }}</button>
          </div>
        </div>
        <div class="region-body company">
          <div v-if="handoff.open" class="alert">
            <div class="alert-title">¿A quién se la pasás?</div>
            <div class="alert-desc">
              <p>Desde ahí la sigue esa persona, en persona o por llamada; acá queda marcado quién la retoma.</p>
              <form class="inline-form" @submit.prevent="saveHandoff(company)">
                <input v-model="handoff.to" class="input" placeholder="Laura, del equipo comercial" aria-label="A quién">
                <button type="submit" class="btn btn-sm">{{ handoff.to ? 'Pasar' : 'Volver a mí' }}</button>
                <button type="button" class="btn btn-sm btn-ghost" @click="handoff.open = false">Cancelar</button>
              </form>
            </div>
          </div>
          <div v-else-if="company.handedTo" class="alert"><div class="alert-desc"><p>Lo retoma <b>{{ company.handedTo }}</b>: sigue en persona. <button type="button" class="btn-link" @click="handoff.open = true; handoff.to = company.handedTo">Cambiar</button></p></div></div>
          <div v-if="company.stage === 'lost'" class="alert alert-warn"><div class="alert-desc"><p>Descartada. <button type="button" class="btn-link" @click="setStage(company, 'prospect')">Volver a prospecto</button></p></div></div>

          <!-- el próximo paso -->
          <div v-if="stepDraft.open" class="next-step editing">
            <form class="inline-form" @submit.prevent="saveStep(company)">
              <input v-model="stepDraft.text" class="input grow" placeholder="Llamar para agendar la demo" aria-label="Próximo paso">
              <input v-model="stepDraft.due" class="input" type="date" aria-label="Para cuándo">
              <button type="submit" class="btn btn-sm">Guardar</button>
              <button type="button" class="btn btn-sm btn-ghost" @click="stepDraft.open = false">Cancelar</button>
            </form>
          </div>
          <div v-else-if="company.next" class="next-step" :class="{ late: overdue(company) }">
            <span class="ui-icon" data-icon="clock" aria-hidden="true"></span>
            <span class="grow">{{ company.next.text }} · {{ dueLabel(company.next) }}</span>
            <button type="button" class="btn btn-sm btn-ghost" @click="editStep(company)">Cambiar</button>
            <button type="button" class="btn btn-sm btn-outline" @click="patchCompany(company, { clearNext: true }, 'Hecho')">Hecho</button>
          </div>
          <button v-else-if="company.stage !== 'lost'" type="button" class="next-step empty-step" @click="editStep(company)"><span class="ui-icon" data-icon="plus" aria-hidden="true"></span>Poner el próximo paso</button>

          <!-- la bitácora -->
          <ol class="log">
            <li v-for="a in logOf(company)" :key="a.id" :class="`is-${a.kind}`">
              <span class="log-when">{{ shortDate(a.at) }}</span>
              <span class="ui-icon" :data-icon="ACT_ICON[a.kind] || 'comment'" aria-hidden="true"></span>
              <span class="log-text">{{ a.text }}</span>
            </li>
          </ol>
        </div>
        <form class="composer" @submit.prevent="addActivity(company)">
          <div class="select"><select v-model="composer.kind" class="input" aria-label="Qué fue">
            <option v-for="[k, n] in ACT_KINDS" :key="k" :value="k">{{ n }}</option>
          </select></div>
          <input v-model="composer.text" class="input grow" placeholder="Qué pasó: con quién hablaste, qué dijeron, qué sigue" aria-label="Registrar">
          <button type="submit" class="btn btn-sm">Registrar</button>
        </form>
      </template>

      <!-- el embudo -->
      <div v-else-if="route.view === 'funnel'" class="region-body doc">
        <div v-if="apiError" class="alert alert-bad"><div class="alert-desc">{{ apiError }}</div></div>
        <section v-for="kind in KINDS" :key="kind" class="block">
          <h2>{{ kind === 'merchant' ? 'Comercios' : 'Entidades' }}</h2>
          <div class="funnel">
            <div v-for="s in funnelOf(kind)" :key="s.id" class="funnel-step" :class="{ zero: !s.n }"><span class="funnel-n">{{ s.n }}</span><span>{{ s.name }}</span></div>
          </div>
        </section>
        <section class="block">
          <h2>Próximos pasos <span v-if="overdueCount" class="late-count">{{ overdueCount }} vencido{{ overdueCount === 1 ? '' : 's' }}</span></h2>
          <div v-if="!nextSteps.length" class="muted">Ninguno puesto. Se ponen desde cada empresa.</div>
          <a v-for="c in nextSteps" :key="c.id" class="row" :href="`#/c/${c.id}`"><span>{{ pretty(c.name) }} · {{ c.next.text }}</span><span class="row-meta" :class="{ late: overdue(c) }">{{ dueLabel(c.next) }}</span></a>
        </section>
        <section class="block">
          <h2>Sectores</h2>
          <p class="muted">Lo que cada sector origina hoy en CreditOp (prod, últimos 180 días){{ measuredAt ? `, medido el ${shortDate(measuredAt)} a las ${clock(measuredAt)}` : '' }}. El encaje del ticket sale de ahí.
            <button type="button" class="btn-link" :disabled="measuring" @click="remeasure">{{ measuring ? 'Midiendo…' : 'Volver a medir' }}</button></p>
          <div v-if="measureError" class="alert alert-warn"><div class="alert-desc">No se pudo medir en prod: {{ measureError }}</div></div>
          <table class="table">
            <thead><tr><th>Sector</th><th class="num">Desembolsos</th><th class="num">Monto promedio</th><th class="num">Comercios</th><th>Encaje</th><th></th></tr></thead>
            <tbody>
              <tr v-for="s in sectors" :key="s.id">
                <td>{{ s.name }}<div v-if="s.note" class="cell-note">{{ s.note }}</div></td>
                <td class="num">{{ s.disbursed ? s.disbursed.toLocaleString('es-CO') : '—' }}</td>
                <td class="num">{{ money(s.avgAmount) }}</td>
                <td class="num">{{ s.merchants || '—' }}</td>
                <td><i class="fit-dot" :class="s.ticket === 'high' ? 'is-high' : 'is-mid'" aria-hidden="true"></i>{{ s.ticket === 'high' ? 'alto' : 'con variación' }}</td>
                <td class="num"><button type="button" class="btn btn-sm btn-outline" @click="runDiscover(s.id)">Buscar</button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- el registro mercantil -->
      <template v-else-if="route.view === 'discover'">
        <form class="subband discover-bar" @submit.prevent="runDiscover()">
          <span class="sub-what">Sector</span>
          <div class="select"><select v-model="disc.sector" class="input" aria-label="Sector"><option v-for="s in sectors" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
          <span class="sub-what">con al menos</span>
          <input v-model="disc.minPoints" class="input points-input" type="number" min="1" aria-label="Puntos mínimos">
          <span class="sub-what">puntos</span>
          <button type="submit" class="btn btn-sm" :disabled="disc.busy">{{ disc.busy ? 'Buscando…' : 'Buscar' }}</button>
          <label class="check"><input v-model="disc.hideClients" type="checkbox"> Ocultar los que ya son clientes<template v-if="discHidden"> ({{ discHidden }})</template></label>
        </form>
        <div class="region-body doc">
          <div v-if="disc.error" class="alert alert-bad"><div class="alert-desc">{{ disc.error }}</div></div>
          <div v-if="disc.busy" class="region-progress" aria-hidden="true"></div>
          <div v-if="!disc.list && !disc.busy" class="empty"><div class="empty-head">
            <div class="empty-title">Buscar comercios en el registro mercantil</div>
            <div class="empty-desc">Las empresas del sector con más establecimientos activos: cada establecimiento es un punto de venta. Se descartan las que ya son comercio de CreditOp, por NIT y por nombre.</div>
          </div><button type="button" class="btn" @click="runDiscover()">Buscar en {{ sectorName(disc.sector) }}</button></div>
          <template v-else-if="disc.list">
            <p class="muted">{{ plural(discShown.length, 'empresa', 'empresas') }} de {{ sectorName(disc.sector) }} con {{ disc.minPoints }} o más establecimientos activos. Fuente: {{ disc.source }}.</p>
            <table class="table">
              <thead><tr><th>Empresa</th><th class="num">Puntos</th><th>Cámara</th><th class="num">Renovó</th><th class="num">Encaje</th><th></th></tr></thead>
              <tbody>
                <tr v-for="c in discShown" :key="c.nit">
                  <td>{{ pretty(c.name) }}<div class="cell-note">{{ c.name }} · NIT {{ c.nit }}<template v-if="c.inactive"> · la empresa no está activa</template></div></td>
                  <td class="num">{{ c.points }}</td>
                  <td>{{ c.region }}</td>
                  <td class="num">{{ c.renewed }}</td>
                  <td class="num">{{ c.fit }}</td>
                  <td class="num">
                    <span v-if="c.client" class="badge badge-secondary" :title="`En CreditOp: ${c.client}`">ya es cliente</span>
                    <a v-else-if="c.tracked" class="btn btn-sm btn-ghost" :href="`#/c/${c.tracked}`">Abrir</a>
                    <button v-else type="button" class="btn btn-sm btn-outline" @click="track(c)">Agregar</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </div>
      </template>

      <!-- una empresa nueva -->
      <div v-else-if="route.view === 'new'" class="region-body doc">
        <section class="block new-form">
          <h2>Agregar {{ draft.kind === 'lender' ? 'una entidad' : 'un comercio' }} a mano</h2>
          <div v-if="SHOW_LENDERS" class="toggle-group toggle-outline toggle-joined" role="radiogroup" aria-label="Tipo">
            <a class="toggle" role="radio" :aria-checked="draft.kind === 'merchant'" :aria-pressed="draft.kind === 'merchant'" href="#/nueva">Comercio</a>
            <a class="toggle" role="radio" :aria-checked="draft.kind === 'lender'" :aria-pressed="draft.kind === 'lender'" href="#/nueva-lender">Entidad</a>
          </div>
          <form class="form-grid" @submit.prevent="createCompany">
            <div class="field wide"><label for="f-name">Nombre</label><input id="f-name" v-model="draft.name" class="input" placeholder="Motocentro Andino S.A.S."></div>
            <div class="field"><label for="f-nit">NIT</label><input id="f-nit" v-model="draft.nit" class="input" placeholder="901234567"></div>
            <div v-if="draft.kind === 'merchant'" class="field"><label for="f-sector">Sector</label>
              <div class="select"><select id="f-sector" v-model="draft.sector" class="input"><option value="">Sin sector</option><option v-for="s in sectors" :key="s.id" :value="s.id">{{ s.name }}</option></select></div></div>
            <div v-if="draft.kind === 'merchant'" class="field"><label for="f-points">Puntos de venta</label><input id="f-points" v-model="draft.points" class="input" type="number" min="0"></div>
            <div class="field"><label for="f-region">Ciudad o región</label><input id="f-region" v-model="draft.region" class="input" placeholder="Medellín"></div>
            <div class="field"><label for="f-web">Sitio web</label><input id="f-web" v-model="draft.website" class="input" placeholder="motocentroandino.co"></div>
            <div class="field"><label for="f-email">Correo público de la empresa</label><input id="f-email" v-model="draft.email" class="input" placeholder="ventas@motocentroandino.co"><span class="field-hint">El de ventas o contacto que publica la empresa, no el de una persona.</span></div>
            <div class="field"><label for="f-phone">Línea pública</label><input id="f-phone" v-model="draft.phone" class="input" placeholder="604 444 0000"></div>
            <label v-if="draft.kind === 'merchant'" class="check wide"><input v-model="draft.online" type="checkbox"> Vende en línea (cualquier plataforma)</label>
            <div class="wide"><button type="submit" class="btn">Agregar</button></div>
          </form>
        </section>
      </div>
    </main>

    <!-- ── la actividad ── -->
    <section v-if="shown.panel" class="panel" aria-label="La actividad">
      <div class="rsz rsz-edge-top" v-resize="panelResize"></div>
      <nav class="tabs" role="tablist" aria-label="Consola">
        <span class="tab on" role="tab" aria-selected="true">Actividad <span class="count">{{ recent.length }}</span></span>
        <div class="region-actions">
          <button type="button" class="region-action" title="Cerrar la actividad" aria-label="Cerrar la actividad" @click="toggle('panel', panelOpen)"><span class="ui-icon" data-icon="close" aria-hidden="true"></span></button>
        </div>
      </nav>
      <div class="region-body console">
        <a v-for="a in recent" :key="a.id" class="log-line" :href="`#/c/${a.company.id}`">
          <span class="log-time">{{ shortDate(a.at) }} {{ clock(a.at) }}</span><span><b>{{ pretty(a.company.name) }}</b> · {{ a.text }}</span>
        </a>
        <div v-if="!recent.length" class="log-line"><span class="log-time"></span><span>Todavía no hay actividad.</span></div>
      </div>
    </section>

    <!-- ── el detalle ── -->
    <aside v-show="shown.aux" class="auxiliarybar" aria-label="El detalle">
      <div class="rsz rsz-edge-left" v-resize="auxResize"></div>
      <div class="region-head"><span>Detalle</span></div>
      <div v-if="detail" :key="detail.id" class="region-body props">
        <div class="region-head group"><span>Datos</span></div>
        <div class="prop"><label for="d-name">Nombre</label><input id="d-name" class="input" :value="detail.name" @change="saveField(detail, 'name', $event.target.value)"></div>
        <div class="prop"><label for="d-nit">NIT</label><input id="d-nit" class="input" :value="detail.nit" @change="saveField(detail, 'nit', $event.target.value)"></div>
        <div v-if="detail.kind === 'merchant'" class="prop"><label for="d-sector">Sector</label>
          <div class="select"><select id="d-sector" class="input" :value="detail.sector" @change="saveField(detail, 'sector', $event.target.value)"><option value="">Sin sector</option><option v-for="s in sectors" :key="s.id" :value="s.id">{{ s.name }}</option></select></div></div>
        <div v-if="detail.kind === 'merchant'" class="prop"><label for="d-points">Puntos de venta</label><input id="d-points" class="input" type="number" min="0" :value="detail.points" @change="saveField(detail, 'points', $event.target.value)"></div>
        <div class="prop"><label for="d-region">Región</label><input id="d-region" class="input" :value="detail.region" @change="saveField(detail, 'region', $event.target.value)"></div>
        <label v-if="detail.kind === 'merchant'" class="check prop-check"><input type="checkbox" :checked="detail.online" @change="saveField(detail, 'online', $event.target.checked)"> Vende en línea</label>
        <template v-if="detail.kind === 'merchant'">
          <div class="region-head group"><span>Encaje</span><span class="count">{{ detail.fit }}</span></div>
          <ul class="why"><li v-for="w in detail.fitWhy" :key="w">{{ w }}</li></ul>
        </template>
        <div class="region-head group"><span>Contacto para la propuesta</span>
          <button type="button" class="region-action" :disabled="searching === detail.id" :title="detail.research ? 'Buscar de nuevo con Claude' : 'Buscar con Claude por internet'" :aria-label="detail.research ? 'Buscar de nuevo' : 'Buscar el contacto'" @click="searchContact(detail)"><span class="ui-icon" :data-icon="detail.research ? 'refresh' : 'search'" aria-hidden="true"></span></button></div>
        <div v-if="searching === detail.id" class="region-progress" aria-hidden="true"></div>
        <p v-if="searching === detail.id" class="prop-note">Claude está buscando en internet…</p>
        <template v-else-if="detail.research">
          <a v-for="ct in sortedContacts(detail)" :key="ct.channel + ct.value" class="contact" :href="contactHref(ct)" target="_blank" rel="noopener">
            <span class="ui-icon" :data-icon="CH_ICON[ct.channel]" aria-hidden="true"></span>
            <span class="contact-body"><span class="contact-value">{{ ct.channel === 'form' ? `Formulario · ${hostOf(formUrl(ct))}` : ct.value }}</span><span class="contact-area">{{ CHANNEL[ct.channel] }} · {{ ct.area }}</span></span>
            <span class="badge badge-xs" :class="ct.fit === 'proposals' ? '' : 'badge-outline'">{{ FIT[ct.fit] }}</span>
          </a>
          <p class="prop-note">{{ detail.research.contacts.length ? '' : 'Sin canal público. ' }}{{ detail.research.summary }}</p>
          <p class="prop-note sources">Fuentes: <template v-for="(ct, i) in sortedContacts(detail)" :key="i"><a :href="ct.source" target="_blank" rel="noopener">{{ hostOf(ct.source) }}</a>{{ i < detail.research.contacts.length - 1 ? ' · ' : '' }}</template><template v-if="!detail.research.contacts.length">ninguna</template>. Buscado el {{ shortDate(detail.research.at) }}.</p>
        </template>
        <p v-else class="prop-note">Todavía no se buscó. Claude busca en internet el canal por el que la empresa recibe propuestas (alianzas, compras, comercial) y, si no hay, el comercial general.</p>
        <div class="region-head group"><span>Contacto público</span></div>
        <div class="prop"><label for="d-web">Sitio web</label><input id="d-web" class="input" :value="detail.website" @change="saveField(detail, 'website', $event.target.value)"></div>
        <div class="prop"><label for="d-email">Correo de la empresa</label><input id="d-email" class="input" :value="detail.email" @change="saveField(detail, 'email', $event.target.value)"></div>
        <div class="prop"><label for="d-phone">Línea pública</label><input id="d-phone" class="input" :value="detail.phone" @change="saveField(detail, 'phone', $event.target.value)"></div>
        <div class="region-head group"><span>De dónde salió</span></div>
        <p class="prop-note">{{ detail.source === 'registry' ? `Registro mercantil de Confecámaras${detail.renewed ? `, renovó en ${detail.renewed}` : ''}${detail.ciiu ? `, CIIU ${detail.ciiu}` : ''}.` : 'Agregada a mano.' }} Entró el {{ shortDate(detail.created) }}.</p>
        <div v-if="detail.stage !== 'lost'" class="prop-actions"><button type="button" class="btn btn-sm btn-ghost" @click="setStage(detail, 'lost')">Descartar</button></div>
      </div>
      <div v-else class="region-body"><div class="empty"><div class="empty-head"><div class="empty-desc">Abrí una empresa para ver sus datos y su encaje.</div></div></div></div>
    </aside>

    <footer class="statusbar">
      <span>{{ apiError || (SHOW_LENDERS ? `${plural(count('merchant'), 'comercio', 'comercios')} · ${plural(count('lender'), 'entidad', 'entidades')}` : plural(count('merchant'), 'comercio', 'comercios')) }}</span>
      <span v-if="overdueCount" class="late">{{ plural(overdueCount, 'paso vencido', 'pasos vencidos') }}</span>
      <span v-if="sellingCount">{{ sellingCount }} vendiendo o en producción</span>
      <span v-if="clientCount">{{ clientCount }} clientes de CreditOp descartados al buscar</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.sidebar" title="Mostrar u ocultar las listas" aria-label="Mostrar u ocultar las listas" @click="toggle('sidebar', sidebarOpen)"><span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.panel" title="Mostrar u ocultar la actividad" aria-label="Mostrar u ocultar la actividad" @click="toggle('panel', panelOpen)"><span class="ui-icon" data-icon="console" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shown.aux" title="Mostrar u ocultar el detalle" aria-label="Mostrar u ocultar el detalle" @click="toggle('aux', auxOpen)"><span class="ui-icon" data-icon="detail" aria-hidden="true"></span></button>
      </div>
    </footer>
  </div>
</template>
