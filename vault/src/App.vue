<script setup>
/* EL LLAVERO: las llaves de Miguel que no se comparten, en llaveros. A la izquierda los grupos (servicios, ambientes,
 * repos…); al centro, los llaveros del grupo como tarjetas, o uno abierto con sus llaves. Nada se descifra al pintar:
 * «Ver» trae UN valor por 20 s y «Copiar» lo copia sin mostrarlo.
 *
 * Todo pasa por la API (vault/server) sobre lib/vault, la misma librería de `bin/pg vault`. Rutas: `#/g/<grupo>`,
 * `#/r/<llavero>`, `#/export`, `#/import`. */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { vResize, readSize, saveSize, fitRegions, cssSize, bindThemeToggle } from './workbench.js'

const rings = ref([])
const loaded = ref(false)
const apiError = ref('')
const error = ref('')
const route = ref({ view: 'group', id: 'all' })
const search = ref('')

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'X-Vault': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}`)
  return out
}
async function load() {
  try {
    rings.value = (await api('/api/rings')).rings
    apiError.value = ''
  } catch { apiError.value = 'No contesta la API del Llavero.' }
  loaded.value = true
}
async function act(fn) {
  error.value = ''
  try { await fn(); await load(); return true } catch (err) { error.value = err.message; return false }
}

// ── los grupos: lo que va antes de « · » en el nombre, si lo comparten varios; un repo (en minúscula) va a Repos ──
function groupOf(name, prefixes) {
  const prefix = name.includes(' · ') ? name.split(' · ')[0] : ''
  const shared = [...prefixes].find((p) => name.toLowerCase().startsWith(p.toLowerCase()))
  if (shared) return shared
  if (prefix && prefix[0] === prefix[0].toLowerCase()) return 'Repos'
  return 'Servicios'
}
const groups = computed(() => {
  const count = new Map()
  for (const r of rings.value) {
    if (!r.name.includes(' · ')) continue
    const p = r.name.split(' · ')[0]
    if (p[0] !== p[0].toLowerCase()) count.set(p, (count.get(p) || 0) + 1)
  }
  const prefixes = new Set([...count].filter(([, n]) => n > 1).map(([p]) => p))
  const by = new Map()
  for (const r of rings.value) {
    const g = groupOf(r.name, prefixes)
    if (!by.has(g)) by.set(g, [])
    by.get(g).push(r)
  }
  const order = (g) => (g === 'Servicios' ? 0 : g === 'Repos' ? 2 : 1)
  const PLURAL = { Ambiente: 'Ambientes' }
  return [...by].map(([name, list]) => ({ id: slug(PLURAL[name] || name), name: PLURAL[name] || name, rings: list, keys: list.reduce((n, r) => n + r.keys.length, 0) }))
    .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name, 'es'))
})
const totalKeys = computed(() => rings.value.reduce((n, r) => n + r.keys.length, 0))
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const q = computed(() => search.value.trim().toLowerCase())
const matches = (r) => !q.value || r.name.toLowerCase().includes(q.value) || r.keys.some((k) => k.name.toLowerCase().includes(q.value))
const shownGroups = computed(() => {
  // Un grupo que ya no existe (se borró su último llavero, o una ruta vieja) muestra todos.
  const one = route.value.view === 'group' && groups.value.find((g) => g.id === route.value.id)
  const list = one ? [one] : groups.value
  return list.map((g) => ({ ...g, rings: g.rings.filter(matches) })).filter((g) => g.rings.length)
})
const ring = computed(() => (route.value.view === 'ring' ? rings.value.find((r) => r.id === route.value.id || r.slug === route.value.id) : null))
const ringKeys = computed(() => (ring.value?.keys || []).filter((k) => !q.value || k.name.toLowerCase().includes(q.value) || ring.value.name.toLowerCase().includes(q.value)))

// ── rutas ──
function readRoute() {
  const h = location.hash
  let m
  if ((m = h.match(/^#\/r\/(.+)$/))) route.value = { view: 'ring', id: decodeURIComponent(m[1]) }
  else if ((m = h.match(/^#\/g\/(.+)$/))) route.value = { view: 'group', id: decodeURIComponent(m[1]) }
  else if (h === '#/export' || h === '#/import') route.value = { view: h.slice(2), id: '' }
  else route.value = { view: 'group', id: 'all' }
  confirm.value = ''
  editing.value = ''
  error.value = ''
}
const go = (hash) => { location.hash = hash }
const backHash = computed(() => {
  if (!ring.value) return '#/'
  const g = groups.value.find((x) => x.rings.some((r) => r.id === ring.value.id))
  return g ? `#/g/${g.id}` : '#/'
})

// ── borrar con dos toques, renombrar con doble clic ──
const confirm = ref('')
const editing = ref('')
const editValue = ref('')
function askDelete(id) { confirm.value = confirm.value === id ? '' : id }
async function deleteRing(r) {
  if (confirm.value !== r.id) return askDelete(r.id)
  confirm.value = ''
  if (await act(() => api(`/api/rings/${r.id}?force=1`, { method: 'DELETE' })) && route.value.view === 'ring') go(backHash.value)
}
async function deleteKey(k) {
  if (confirm.value !== k.id) return askDelete(k.id)
  confirm.value = ''
  await act(() => api(`/api/rings/${ring.value.id}/keys/${encodeURIComponent(k.name)}`, { method: 'DELETE' }))
}
async function startEdit(id, value) {
  editing.value = id
  editValue.value = value
  await nextTick()
  document.querySelector('[data-editing]')?.select()
}
async function finishEdit(save) {
  const id = editing.value
  editing.value = ''
  const value = editValue.value.trim()
  if (!save || !value || !ring.value) return
  if (id === 'ring') {
    if (value !== ring.value.name) await act(() => api(`/api/rings/${ring.value.id}`, { method: 'PATCH', body: { name: value } }))
  } else {
    const k = ring.value.keys.find((x) => x.id === id)
    if (k && value !== k.name) await act(() => api(`/api/rings/${ring.value.id}/keys/${encodeURIComponent(k.name)}`, { method: 'PATCH', body: { name: value } }))
  }
}
async function newRing() {
  const taken = new Set(rings.value.map((r) => r.name.toLowerCase()))
  let name = 'Llavero nuevo'
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `Llavero nuevo ${i}`
  let id = ''
  if (await act(async () => { id = (await api('/api/rings', { method: 'POST', body: { name } })).id })) {
    go(`#/r/${id}`)
    await nextTick()
    startEdit('ring', name)
  }
}

// ── ver y copiar ──
const shown = reactive({})
async function reveal(k) {
  if (k.id in shown) { delete shown[k.id]; return }
  try {
    shown[k.id] = (await api(`/api/rings/${ring.value.id}/keys/${encodeURIComponent(k.name)}/reveal`, { method: 'POST' })).value
    setTimeout(() => { delete shown[k.id] }, 20000)
  } catch (err) { error.value = err.message }
}
const copied = ref('')
async function copy(k) {
  try {
    const value = (await api(`/api/rings/${ring.value.id}/keys/${encodeURIComponent(k.name)}/reveal`, { method: 'POST' })).value
    // Dentro de Cockpit la app es un iframe: el portapapeles moderno puede no estar; el viejo sí, con el clic.
    try { await navigator.clipboard.writeText(value) } catch {
      const t = Object.assign(document.createElement('textarea'), { value })
      t.style.cssText = 'position:fixed;opacity:0'
      document.body.append(t)
      t.select()
      document.execCommand('copy')
      t.remove()
    }
    copied.value = k.id
    setTimeout(() => { if (copied.value === k.id) copied.value = '' }, 1500)
  } catch (err) { error.value = err.message }
}

// ── agregar una llave ──
const draft = reactive({ name: '', value: '' })
async function addKey() {
  if (!draft.name.trim() || !draft.value) { error.value = 'Falta el nombre o el valor'; return }
  if (await act(() => api(`/api/rings/${ring.value.id}/keys`, { method: 'POST', body: { name: draft.name, value: draft.value } }))) {
    draft.name = ''
    draft.value = ''
    document.querySelector('[data-draft-name]')?.focus()
  }
}

// ── exportar e importar ──
const xfer = reactive({ pass: '', pass2: '', replace: false, zip: '', zipName: '', busy: false, result: '' })
function resetXfer() { Object.assign(xfer, { pass: '', pass2: '', replace: false, zip: '', zipName: '', busy: false, result: '' }) }
async function doExport() {
  if (xfer.pass.length < 8) { error.value = 'La contraseña tiene que tener al menos 8 caracteres'; return }
  if (xfer.pass !== xfer.pass2) { error.value = 'Las dos contraseñas no coinciden'; return }
  xfer.busy = true
  error.value = ''
  try {
    const out = await api('/api/export', { method: 'POST', body: { passphrase: xfer.pass } })
    xfer.result = `${out.rings} llaveros y ${out.keys} llaves → Descargas: ${out.file}`
    xfer.pass = xfer.pass2 = ''
  } catch (err) { error.value = err.message }
  xfer.busy = false
}
function pickZip(e) {
  const file = e.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { xfer.zip = String(reader.result).split(',')[1] || ''; xfer.zipName = file.name; xfer.result = '' }
  reader.readAsDataURL(file)
}
async function doImport() {
  if (!xfer.zip) { error.value = 'Elegí el zip'; return }
  if (!xfer.pass) { error.value = 'Falta la contraseña del zip'; return }
  xfer.busy = true
  error.value = ''
  try {
    const r = await api('/api/import', { method: 'POST', body: { passphrase: xfer.pass, zip: xfer.zip, replace: xfer.replace } })
    xfer.result = `${r.Rings} llaveros: ${r.Added} llaves nuevas, ${r.Same} iguales, ${r.Replaced} reemplazadas` +
      (r.Conflicts?.length ? `. Con otro valor, sin tocar: ${r.Conflicts.join(', ')}` : '')
    xfer.pass = ''
    await load()
  } catch (err) { error.value = err.message }
  xfer.busy = false
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
// Un nombre largo (FINANDINA_EXPERIAN) se parte después de un guión bajo: con <wbr>, no con un espacio invisible,
// para que copiar el nombre dé el nombre.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const breakable = (s) => esc(s).replace(/_/g, '_<wbr>')

// ── las regiones, con el contrato de la base ──
const viewportW = ref(window.innerWidth)
const sidebarOpen = ref(readSize('vault.sidebar-open', 1) !== 0)
const sidebarW = ref(readSize('vault.sidebar-w', 240))
const shownSidebar = computed(() => {
  const [w] = fitRegions(viewportW.value - cssSize('--editor-min', 360), [{ size: sidebarOpen.value ? sidebarW.value : 0, min: cssSize('--sidebar-min', 200) }])
  return w
})
const layoutVars = computed(() => ({ '--sidebar-w': `${shownSidebar.value}px`, '--auxiliarybar-w': '0px' }))
const sidebarResize = {
  label: 'Ancho de los grupos', sign: 1, defaultValue: 240,
  min: () => cssSize('--sidebar-min', 200), max: () => viewportW.value - cssSize('--editor-min', 360),
  get: () => shownSidebar.value,
  set: (v) => { if (!v) sidebarOpen.value = false; else { sidebarOpen.value = true; sidebarW.value = v } },
  reopen: () => sidebarW.value,
  commit: (v) => { saveSize('vault.sidebar-open', v ? 1 : 0); if (v) saveSize('vault.sidebar-w', sidebarW.value) },
}
function toggleSidebar() { sidebarOpen.value = !shownSidebar.value; saveSize('vault.sidebar-open', sidebarOpen.value ? 1 : 0) }
const onWindowResize = () => { viewportW.value = window.innerWidth }
const onVisibility = () => { if (!document.hidden) load() }
const onKey = (e) => { if (e.key === 'Escape' && confirm.value) confirm.value = '' }
const themeToggle = ref(null)
let themeBinding = null
onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('hashchange', readRoute)
  window.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  if (themeToggle.value) themeBinding = bindThemeToggle(themeToggle.value)
  readRoute()
  load()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('hashchange', readRoute)
  window.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  themeBinding?.destroy?.()
})
</script>

<template>
  <div class="workbench" :style="layoutVars" @click="(e) => { if (confirm && !e.target.closest('[data-confirm]')) confirm = '' }">
    <aside v-show="shownSidebar" class="sidebar" aria-label="Grupos">
      <div class="rsz rsz-edge-right" v-resize="sidebarResize"></div>
      <div class="region-head"><span>Llavero</span><span class="count">{{ rings.length }}</span></div>
      <div class="region-body">
        <a class="group-row" :class="{ on: route.view === 'group' && !groups.some((g) => g.id === route.id) }" href="#/">
          <span class="ui-icon" data-icon="key" aria-hidden="true"></span><span class="group-name">Todos</span><span class="count">{{ rings.length }}</span>
        </a>
        <a v-for="g in groups" :key="g.id" class="group-row" :class="{ on: (route.view === 'group' && route.id === g.id) || (ring && g.rings.some((r) => r.id === ring.id)) }" :href="`#/g/${g.id}`">
          <span class="ui-icon" data-icon="folder" aria-hidden="true"></span><span class="group-name">{{ g.name }}</span><span class="count">{{ g.rings.length }}</span>
        </a>
        <div class="side-actions">
          <a class="group-row" :class="{ on: route.view === 'export' }" href="#/export" @click="resetXfer"><span class="ui-icon" data-icon="download" aria-hidden="true"></span><span class="group-name">Exportar</span></a>
          <a class="group-row" :class="{ on: route.view === 'import' }" href="#/import" @click="resetXfer"><span class="ui-icon" data-icon="folder" aria-hidden="true"></span><span class="group-name">Importar</span></a>
        </div>
      </div>
    </aside>

    <main class="editor">
      <div class="region-head">
        <template v-if="ring"><a class="back" :href="backHash" aria-label="Volver a los llaveros"><span class="ui-icon" data-icon="back" aria-hidden="true"></span></a><span>{{ ring.name }}</span></template>
        <span v-else-if="route.view === 'export'">Exportar</span>
        <span v-else-if="route.view === 'import'">Importar</span>
        <span v-else>{{ groups.find((g) => g.id === route.id)?.name || 'Todos los llaveros' }}</span>
        <input v-if="route.view === 'group' || ring" v-model="search" class="search" type="search" :placeholder="ring ? 'Buscar una llave' : 'Buscar un llavero o una llave'" aria-label="Buscar">
      </div>
      <div class="region-body">
        <p v-if="error" class="alert alert-bad" role="alert">{{ error }}</p>

        <!-- los llaveros, como tarjetas -->
        <template v-if="route.view === 'group'">
          <div v-if="loaded && !rings.length && !apiError" class="empty"><div class="empty-head">
            <div class="empty-title">Todavía no hay llaveros</div>
            <div class="empty-desc">Creá uno y guardá sus llaves: se cifran con tu llave personal, que el equipo no tiene.</div>
          </div></div>
          <section v-for="g in shownGroups" :key="g.id" class="group">
            <h2 v-if="shownGroups.length > 1 || !groups.some((x) => x.id === route.id)" class="group-title">{{ g.name }} <span>{{ plural(g.rings.length, 'llavero', 'llaveros') }} · {{ plural(g.keys, 'llave', 'llaves') }}</span></h2>
            <div class="cards">
              <div v-for="r in g.rings" :key="r.id" class="card" role="link" tabindex="0" @click="go(`#/r/${r.id}`)" @keydown.enter="go(`#/r/${r.id}`)">
                <div class="card-head">
                  <span class="ui-icon" data-icon="lock" aria-hidden="true"></span>
                  <span class="card-title" v-html="breakable(r.name)"></span>
                  <button v-if="confirm === r.id" type="button" class="confirm" data-confirm @click.stop="deleteRing(r)">Borrar{{ r.keys.length ? ` con ${plural(r.keys.length, 'llave', 'llaves')}` : '' }}</button>
                  <button v-else type="button" class="icon danger" data-confirm title="Borrar el llavero" aria-label="Borrar el llavero" @click.stop="deleteRing(r)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
                </div>
                <div class="card-count">{{ plural(r.keys.length, 'llave', 'llaves') }}</div>
                <div class="chips">
                  <span v-for="k in r.keys.slice(0, 6)" :key="k.id" class="chip">{{ k.name }}</span>
                  <span v-if="r.keys.length > 6" class="chip more">+{{ r.keys.length - 6 }}</span>
                </div>
              </div>
              <button v-if="g === shownGroups[shownGroups.length - 1]" type="button" class="card card-new" @click="newRing">
                <span class="ui-icon" data-icon="plus" aria-hidden="true"></span><span>Nuevo llavero</span>
              </button>
            </div>
          </section>
          <div v-if="loaded && rings.length && !shownGroups.length && q" class="empty"><div class="empty-head"><div class="empty-title">Nada coincide con «{{ search }}»</div></div></div>
        </template>

        <!-- un llavero abierto -->
        <div v-else-if="ring" class="ring">
          <div class="ring-head">
            <input v-if="editing === 'ring'" v-model="editValue" data-editing class="ring-name-input" aria-label="Nombre del llavero" @keydown.enter="finishEdit(true)" @keydown.esc.stop="finishEdit(false)" @blur="finishEdit(true)">
            <h1 v-else title="Doble clic para renombrar" @dblclick="startEdit('ring', ring.name)" v-html="breakable(ring.name)"></h1>
            <button type="button" class="icon" title="Renombrar" aria-label="Renombrar el llavero" @click="startEdit('ring', ring.name)"><span class="ui-icon" data-icon="edit" aria-hidden="true"></span></button>
            <span class="spacer"></span>
            <button v-if="confirm === ring.id" type="button" class="confirm" data-confirm @click="deleteRing(ring)">Borrar con {{ plural(ring.keys.length, 'llave', 'llaves') }}</button>
            <button v-else type="button" class="icon danger" data-confirm title="Borrar el llavero" aria-label="Borrar el llavero" @click="deleteRing(ring)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
          </div>
          <div class="ring-sub">{{ plural(ring.keys.length, 'llave', 'llaves') }}, cifradas con tu llave personal</div>
          <div class="keys">
            <div v-for="k in ringKeys" :key="k.id" class="key">
              <input v-if="editing === k.id" v-model="editValue" data-editing class="mono" aria-label="Nombre de la llave" @keydown.enter="finishEdit(true)" @keydown.esc.stop="finishEdit(false)" @blur="finishEdit(true)">
              <span v-else class="key-name" title="Doble clic para renombrar" @dblclick="startEdit(k.id, k.name)" v-html="breakable(k.name)"></span>
              <span v-if="k.id in shown" class="key-value shown">{{ shown[k.id] }}</span>
              <span v-else class="key-value"><span class="dots">••••••••</span><span class="print" title="La huella: cambia si cambia el valor">{{ k.print }}</span></span>
              <span class="tools">
                <button type="button" class="icon" :title="k.id in shown ? 'Ocultar' : 'Ver por 20 s'" :aria-label="k.id in shown ? 'Ocultar' : 'Ver'" @click="reveal(k)"><span class="ui-icon" :data-icon="k.id in shown ? 'eye-off' : 'eye'" aria-hidden="true"></span></button>
                <button type="button" class="icon" :title="copied === k.id ? 'Copiado' : 'Copiar el valor'" aria-label="Copiar el valor" @click="copy(k)"><span class="ui-icon" :data-icon="copied === k.id ? 'check' : 'copy'" aria-hidden="true"></span></button>
                <button v-if="confirm === k.id" type="button" class="confirm" data-confirm @click="deleteKey(k)">Borrar</button>
                <button v-else type="button" class="icon danger" data-confirm title="Borrar la llave" aria-label="Borrar la llave" @click="deleteKey(k)"><span class="ui-icon" data-icon="trash" aria-hidden="true"></span></button>
              </span>
            </div>
            <div v-if="!ringKeys.length" class="key-empty">{{ ring.keys.length ? `Ninguna llave coincide con «${search}».` : 'Sin llaves todavía.' }}</div>
          </div>
          <form class="add" autocomplete="off" @submit.prevent="addKey">
            <input v-model="draft.name" data-draft-name class="mono" placeholder="NOMBRE" aria-label="Nombre de la llave nueva">
            <input v-model="draft.value" type="password" placeholder="Valor" aria-label="Valor de la llave nueva">
            <button type="submit" class="btn btn-sm">Guardar</button>
          </form>
        </div>

        <!-- exportar -->
        <div v-else-if="route.view === 'export'" class="xfer">
          <h1>Exportar el llavero</h1>
          <p>Un zip con los {{ rings.length }} llaveros y sus {{ totalKeys }} llaves, para llevarlos a otra máquina. Cada valor va cifrado con la contraseña que pongas acá, no con tu llave personal: sin ella el zip no sirve, así que guardala aparte.</p>
          <form autocomplete="off" @submit.prevent="doExport">
            <input v-model="xfer.pass" type="password" placeholder="Contraseña del zip (8 o más)" aria-label="Contraseña del zip">
            <input v-model="xfer.pass2" type="password" placeholder="Repetila" aria-label="Repetir la contraseña">
            <button type="submit" class="btn btn-sm" :disabled="xfer.busy">{{ xfer.busy ? 'Exportando…' : 'Exportar a Descargas' }}</button>
          </form>
          <p v-if="xfer.result" class="result">{{ xfer.result }}</p>
        </div>

        <!-- importar -->
        <div v-else-if="route.view === 'import'" class="xfer">
          <h1>Importar un llavero</h1>
          <p>Un zip exportado desde el Llavero, con su contraseña. Se agregan los llaveros y las llaves que falten; una llave que ya está con otro valor no se toca, salvo que lo marques.</p>
          <form autocomplete="off" @submit.prevent="doImport">
            <label class="file"><input type="file" accept=".zip,application/zip" @change="pickZip"><span class="ui-icon" data-icon="attach" aria-hidden="true"></span><span>{{ xfer.zipName || 'Elegir el zip…' }}</span></label>
            <input v-model="xfer.pass" type="password" placeholder="Contraseña del zip" aria-label="Contraseña del zip">
            <label class="check"><input v-model="xfer.replace" type="checkbox"> Reemplazar las que tengan otro valor</label>
            <button type="submit" class="btn btn-sm" :disabled="xfer.busy">{{ xfer.busy ? 'Importando…' : 'Importar' }}</button>
          </form>
          <p v-if="xfer.result" class="result">{{ xfer.result }}</p>
        </div>
      </div>
    </main>

    <footer class="statusbar">
      <span>{{ apiError || `${plural(rings.length, 'llavero', 'llaveros')} · ${plural(totalKeys, 'llave', 'llaves')} · cifradas con tu llave personal` }}</span>
      <div class="layout-controls" role="group" aria-label="Tema y regiones visibles">
        <button ref="themeToggle" type="button" class="region-action theme-toggle"><span class="ui-icon" aria-hidden="true"></span></button>
        <button type="button" class="region-action" :aria-pressed="!!shownSidebar" title="Mostrar u ocultar los grupos" aria-label="Mostrar u ocultar los grupos" @click="toggleSidebar">
          <span class="ui-icon" data-icon="sidebar" aria-hidden="true"></span>
        </button>
      </div>
    </footer>
  </div>
</template>
