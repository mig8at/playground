<script setup lang="ts">
import { ref, computed } from 'vue'
import { Search, Plus, RotateCcw, Archive, RefreshCw, BookMarked } from 'lucide-vue-next'
import { useDictionary, CATALOG_META, type FieldType } from './dictionary'
import AddFieldModal from './components/AddFieldModal.vue'
import FieldPreview from './components/FieldPreview.vue'

const dict = useDictionary()

const TYPES: FieldType[] = ['text', 'checkbox', 'table']

const search = ref('')
const filterType = ref<'all' | FieldType>('all')
const showDeprecated = ref(true)
const selectedId = ref<string | null>(null)
const showAdd = ref(false)
const deprecating = ref(false)
const reason = ref('')

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  return dict.fields.value.filter((f) => {
    if (!showDeprecated.value && f.status === 'deprecated') return false
    if (filterType.value !== 'all' && f.type !== filterType.value) return false
    if (q && !f.id.toLowerCase().includes(q) && !f.label.toLowerCase().includes(q)) return false
    return true
  })
})

const selected = computed(() => (selectedId.value ? dict.byId(selectedId.value) : null))

const select = (id: string) => { selectedId.value = id; deprecating.value = false; reason.value = '' }

const doDeprecate = () => {
  if (!selected.value) return
  dict.deprecate(selected.value.id, reason.value)
  deprecating.value = false
  reason.value = ''
}
</script>

<template>
  <div class="app">
    <header>
      <div class="title">
        <BookMarked :size="18" />
        <div>
          <h1>Diccionario de campos · PDF Mapper</h1>
          <p>El catálogo real del PDF Mapper como <strong>diccionario canónico</strong> de ids · <strong>append-only</strong> (agregar y deprecar, nunca editar ni borrar: el mismo id lo leen las plantillas ya mapeadas).</p>
        </div>
      </div>
      <div class="counts">
        <span class="pill ok">{{ dict.activeCount.value }} activos</span>
        <span class="pill warn">{{ dict.deprecatedCount.value }} obsoletos</span>
        <span class="pill mut">catálogo v{{ CATALOG_META.seededVersion }} · {{ CATALOG_META.updatedAt }}</span>
      </div>
    </header>

    <div class="toolbar">
      <div class="srch">
        <Search :size="14" />
        <input v-model="search" placeholder="Buscar por id o etiqueta…" />
      </div>
      <select v-model="filterType">
        <option value="all">Todos los tipos</option>
        <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
      </select>
      <label class="chk"><input type="checkbox" v-model="showDeprecated" /> ver obsoletos</label>
      <div class="spacer"></div>
      <button class="btn btn-ghost" title="Restaurar catálogo real" @click="dict.resetSeed(); selectedId = null"><RotateCcw :size="14" /></button>
      <button class="btn btn-primary" @click="showAdd = true"><Plus :size="15" /> Nuevo campo</button>
    </div>

    <div class="main">
      <!-- Lista -->
      <div class="list">
        <div class="list-count">{{ filtered.length }} de {{ dict.fields.value.length }} campos</div>
        <div v-if="filtered.length === 0" class="empty">Sin resultados.</div>
        <button v-for="f in filtered" :key="f.id" class="row" :class="{ sel: f.id === selectedId, dep: f.status === 'deprecated' }" @click="select(f.id)">
          <div class="row-main">
            <span class="mono id">{{ f.id }}</span>
            <span class="type" :class="f.type">{{ f.type }}</span>
          </div>
          <div class="row-sub">
            <span class="label">{{ f.label }}</span>
          </div>
          <span v-if="f.status === 'deprecated'" class="dep-badge">obsoleto</span>
        </button>
      </div>

      <!-- Detalle -->
      <div class="detail">
        <div v-if="!selected" class="empty det-empty">
          <BookMarked :size="28" :stroke-width="1.4" />
          <p>Elegí un campo para ver su definición y su vista previa.</p>
        </div>
        <template v-else>
          <div class="det-head">
            <div>
              <span class="mono id big">{{ selected.id }}</span>
              <span class="type" :class="selected.type">{{ selected.type }}</span>
              <span v-if="selected.status === 'deprecated'" class="dep-badge">obsoleto</span>
            </div>
            <div class="det-actions">
              <button v-if="selected.status === 'active'" class="btn btn-ghost" @click="deprecating = true"><Archive :size="14" /> Deprecar</button>
              <button v-else class="btn" @click="dict.reactivate(selected.id)"><RefreshCw :size="14" /> Reactivar</button>
            </div>
          </div>

          <p class="det-label">{{ selected.label }}</p>
          <p v-if="selected.options?.length" class="det-meta">
            opciones: <code>{{ selected.options.join(', ') }}</code>
          </p>
          <p v-if="selected.defaultValue" class="det-meta">valor de ejemplo: <code>{{ selected.defaultValue }}</code></p>
          <p v-if="selected.cells?.length" class="det-meta">{{ selected.cells.length }} celdas mapeadas</p>
          <p class="det-meta">creado: {{ selected.createdAt }}</p>
          <p v-if="selected.deprecatedReason" class="det-dep">⚠ {{ selected.deprecatedReason }}</p>

          <div v-if="deprecating" class="dep-box">
            <label>Motivo (opcional)</label>
            <input v-model="reason" placeholder="Reemplazado por…" @keyup.enter="doDeprecate" />
            <div class="dep-box-actions">
              <button class="btn btn-ghost" @click="deprecating = false">Cancelar</button>
              <button class="btn btn-primary" @click="doDeprecate">Deprecar</button>
            </div>
            <p class="note">No se borra: sigue resolviendo type/label para las plantillas que ya lo mapean.</p>
          </div>

          <h3>Vista previa</h3>
          <FieldPreview :field="selected" />
        </template>
      </div>
    </div>

    <AddFieldModal v-if="showAdd" @close="showAdd = false" />
  </div>
</template>

<style scoped>
.app { height: 100%; display: flex; flex-direction: column; max-width: 1100px; margin: 0 auto; }
header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 24px 14px; gap: 16px; }
.title { display: flex; gap: 12px; color: var(--accent); }
.title h1 { font-size: 17px; margin: 0; color: var(--text); }
.title p { margin: 4px 0 0; font-size: 12.5px; color: var(--text2); max-width: 640px; line-height: 1.5; }
.title strong { color: var(--text); font-weight: 600; }
.counts { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pill { font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
.pill.ok { color: var(--ok); } .pill.warn { color: var(--warn); } .pill.mut { color: var(--text3); }

.toolbar { display: flex; align-items: center; gap: 10px; padding: 0 24px 14px; }
.srch { position: relative; flex: 0 0 280px; color: var(--text3); }
.srch svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); }
.srch input { width: 100%; padding-left: 30px; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); }
.spacer { flex: 1; }

.main { flex: 1; display: grid; grid-template-columns: 380px 1fr; gap: 16px; padding: 0 24px 24px; overflow: hidden; }
.list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }
.list-count { font-size: 11px; color: var(--text3); padding: 2px 2px 4px; position: sticky; top: 0; }
.row { text-align: left; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; position: relative; color: var(--text); }
.row:hover { border-color: var(--border2); }
.row.sel { border-color: var(--accent); background: var(--surface2); }
.row.dep { opacity: .55; }
.row-main { display: flex; align-items: center; gap: 8px; }
.id { font-size: 12.5px; font-weight: 600; }
.id.big { font-size: 14px; }
.type { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }
.type.checkbox { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.type.table { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
.row-sub { display: flex; align-items: center; justify-content: space-between; margin-top: 3px; }
.label { font-size: 11.5px; color: var(--text2); }
.dep-badge { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--warn); border: 1px solid var(--warn); border-radius: 4px; padding: 1px 5px; }
.row .dep-badge { position: absolute; top: 9px; right: 10px; }

.detail { overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
.empty { color: var(--text3); font-size: 13px; padding: 20px; }
.det-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; }
.det-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.det-head > div:first-child { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.det-label { font-size: 14px; color: var(--text); margin: 12px 0 2px; }
.det-meta { font-size: 12px; color: var(--text2); margin: 2px 0; }
.det-meta code { color: var(--text); }
.det-dep { font-size: 12px; color: var(--warn); margin: 8px 0 0; }
.dep-box { border: 1px solid var(--warn); border-radius: 8px; padding: 12px; margin: 14px 0; display: flex; flex-direction: column; gap: 6px; }
.dep-box label { font-size: 11px; text-transform: uppercase; color: var(--text3); }
.dep-box-actions { display: flex; justify-content: flex-end; gap: 8px; }
.note { font-size: 11px; color: var(--text3); margin: 2px 0 0; }
h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); margin: 22px 0 10px; }
</style>
