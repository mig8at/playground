import { reactive, computed } from 'vue'
import RAW_CATALOG from './catalog.json'

// ---------------------------------------------------------------------------
// El diccionario = el catálogo REAL del PDF Mapper como fuente de verdad.
// `catalog.json` es el export literal del editor (dev == prod, seededVersion 9):
// no se transcribe a mano, se pega tal cual y el adaptador de abajo lo normaliza.
//
// Un campo del catálogo tiene forma { id, type, label, options?, defaultValue }.
//   - text / checkbox → `defaultValue` es el VALOR DE EJEMPLO (string).
//   - table           → `defaultValue` es el arreglo de CELDAS (geometría + muestra).
//
// Semántica de escritura = APPEND-ONLY: se AGREGA y se DEPRECA (reversible),
// nunca se edita in-place ni se borra. Editar es destructivo: el mismo id lo
// leen las plantillas ya mapeadas, así que reusarlo cambia documentos viejos.
// ---------------------------------------------------------------------------

export type FieldType = 'text' | 'checkbox' | 'table'

// Celda de una tabla: posición normalizada (0..1) sobre la página + valor de muestra.
export interface Cell {
  row: number
  col: number
  value: string
  x: number
  y: number
  w: number
}

export interface FieldEntry {
  id: string
  type: FieldType
  label: string
  options?: string[] // checkbox: las casillas posibles
  defaultValue?: string // text/checkbox: valor de ejemplo curado
  cells?: Cell[] // table: celdas (geometría + muestra)
  status: 'active' | 'deprecated'
  createdAt: string
  deprecatedReason?: string
}

interface RawField {
  id: string
  type: string
  label: string
  options?: string[]
  defaultValue?: unknown
}
interface RawCatalog {
  fields: RawField[]
  metadata: { updatedAt: number; seededVersion: number }
}

const raw = RAW_CATALOG as RawCatalog

// Provenance del catálogo real, para mostrarlo en la UI.
export const CATALOG_META = {
  seededVersion: raw.metadata.seededVersion,
  updatedAt: new Date(raw.metadata.updatedAt).toISOString().slice(0, 10),
}

function normalizeType(t: string): FieldType {
  return t === 'checkbox' ? 'checkbox' : t === 'table' ? 'table' : 'text'
}

function fromCatalog(r: RawField): FieldEntry {
  const type = normalizeType(r.type)
  const e: FieldEntry = { id: r.id, type, label: r.label, status: 'active', createdAt: CATALOG_META.updatedAt }
  if (r.options?.length) e.options = r.options
  if (type === 'table' && Array.isArray(r.defaultValue)) e.cells = r.defaultValue as Cell[]
  else if (typeof r.defaultValue === 'string') e.defaultValue = r.defaultValue
  return e
}

const SEED: FieldEntry[] = raw.fields.map(fromCatalog)

const STORAGE_KEY = 'creditop_diccionario_v2'

function load(): FieldEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    /* ignore */
  }
  return JSON.parse(JSON.stringify(SEED))
}

const state = reactive<{ fields: FieldEntry[] }>({ fields: load() })

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.fields))
}

export const ID_RE = /^[a-z][a-z0-9_]*$/

export function useDictionary() {
  const fields = computed(() => state.fields)
  const activeCount = computed(() => state.fields.filter((f) => f.status === 'active').length)
  const deprecatedCount = computed(() => state.fields.filter((f) => f.status === 'deprecated').length)

  function byId(id: string) {
    return state.fields.find((f) => f.id === id)
  }

  /** APPEND-ONLY: agrega un campo nuevo. Rechaza ids duplicados o mal formados. */
  function addField(entry: FieldEntry): { ok: boolean; error?: string } {
    const id = entry.id.trim()
    if (!ID_RE.test(id)) return { ok: false, error: 'El id debe ser snake_case en minúsculas (ej: first_name).' }
    if (byId(id)) return { ok: false, error: `Ya existe un campo con el id "${id}".` }
    state.fields.unshift({ ...entry, id, status: 'active', createdAt: new Date().toISOString().slice(0, 10) })
    persist()
    return { ok: true }
  }

  /** DEPRECAR: no destruye, marca obsoleto (reversible). Sigue resolviendo para docs viejos. */
  function deprecate(id: string, reason: string) {
    const f = byId(id)
    if (!f) return
    f.status = 'deprecated'
    f.deprecatedReason = reason.trim() || undefined
    persist()
  }

  function reactivate(id: string) {
    const f = byId(id)
    if (!f) return
    f.status = 'active'
    f.deprecatedReason = undefined
    persist()
  }

  /** Solo para el prototipo: vuelve al catálogo real. */
  function resetSeed() {
    state.fields.splice(0, state.fields.length, ...JSON.parse(JSON.stringify(SEED)))
    persist()
  }

  return { fields, activeCount, deprecatedCount, byId, addField, deprecate, reactivate, resetSeed }
}
