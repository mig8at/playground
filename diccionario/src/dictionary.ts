import { reactive, computed } from 'vue'

// ---------------------------------------------------------------------------
// Modelo: un SOLO diccionario global de campos.
// La idea clave = "core común + extensiones por consumidor".
//   - El CORE (id, tipo, etiqueta, opciones) es lo compartible: lo que hace que
//     `first_name` sea el mismo campo en todos lados.
//   - Cada CONSUMIDOR (PDF mapper, form dinámico, …) le cuelga su propia
//     metadata sin ensuciar el core ni al resto.
// Semántica de escritura = APPEND-ONLY: se AGREGA y se DEPRECA (reversible),
// nunca se edita in-place ni se borra → seguro para todos los consumidores.
// ---------------------------------------------------------------------------

export type FieldType = 'text' | 'number' | 'date' | 'checkbox' | 'table'

export const CONSUMERS = ['pdfMapper', 'dynamicForm'] as const
export type Consumer = (typeof CONSUMERS)[number]

export const CONSUMER_META: Record<Consumer, { label: string; color: string }> = {
  pdfMapper: { label: 'PDF Mapper', color: 'var(--pdf)' },
  dynamicForm: { label: 'Form dinámico', color: 'var(--form)' },
}

// Extensión que cuelga el PDF mapper (mapeo de plantillas → PDF).
export interface PdfMapperExt {
  defaultValue?: string // valor de ejemplo para la vista previa
}

// Extensión que cuelga el form dinámico (backend-driven-form).
export interface DynamicFormExt {
  required?: boolean
  dataSource?: string // ej: country_tree
  relatedFieldId?: string // cascada: departamento → ciudad
  validation?: string // ej: email, min:0
}

export interface FieldEntry {
  id: string
  type: FieldType
  label: string
  options?: string[] // para checkbox
  status: 'active' | 'deprecated'
  createdAt: string
  deprecatedReason?: string
  consumers: {
    pdfMapper?: PdfMapperExt
    dynamicForm?: DynamicFormExt
  }
}

// --- Semilla: mismos ids reutilizados por distintos consumidores -----------
const SEED: FieldEntry[] = [
  {
    id: 'first_name', type: 'text', label: 'Primer nombre', status: 'active', createdAt: '2026-01-10',
    consumers: {
      pdfMapper: { defaultValue: 'JUAN' },
      dynamicForm: { required: true, validation: 'min:2' },
    },
  },
  {
    id: 'email', type: 'text', label: 'Correo electrónico', status: 'active', createdAt: '2026-01-10',
    consumers: {
      pdfMapper: { defaultValue: 'juan.perez@example.com' },
      dynamicForm: { required: true, validation: 'email' },
    },
  },
  {
    id: 'department', type: 'text', label: 'Departamento', status: 'active', createdAt: '2026-02-02',
    consumers: {
      pdfMapper: { defaultValue: 'ANTIOQUIA' },
      dynamicForm: { required: true, dataSource: 'country_tree' },
    },
  },
  {
    id: 'city', type: 'text', label: 'Ciudad', status: 'active', createdAt: '2026-02-02',
    consumers: {
      // el MISMO id lo usan los dos, cada uno con su metadata:
      pdfMapper: { defaultValue: 'BOGOTÁ' },
      dynamicForm: { required: true, dataSource: 'country_tree', relatedFieldId: 'department' },
    },
  },
  {
    id: 'monthly_income', type: 'number', label: 'Ingresos mensuales', status: 'active', createdAt: '2026-02-14',
    consumers: {
      pdfMapper: { defaultValue: '8.500.000' },
      dynamicForm: { required: true, validation: 'min:0' },
    },
  },
  {
    id: 'data_processing_consent', type: 'checkbox', label: 'Autorización tratamiento de datos (incl. perfilamiento crediticio)',
    options: ['accepted'], status: 'active', createdAt: '2026-07-24',
    consumers: {
      pdfMapper: { defaultValue: 'accepted' },
      dynamicForm: { required: true },
    },
  },
  {
    id: 'legacy_alias', type: 'text', label: 'Alias (obsoleto)', status: 'deprecated', createdAt: '2025-11-01',
    deprecatedReason: 'Reemplazado por first_name + last_name.',
    consumers: { pdfMapper: { defaultValue: 'JP' } },
  },
]

const STORAGE_KEY = 'creditop_diccionario_v1'

function load(): FieldEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
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

  /** Solo para el prototipo: vuelve a la semilla. */
  function resetSeed() {
    state.fields.splice(0, state.fields.length, ...JSON.parse(JSON.stringify(SEED)))
    persist()
  }

  return { fields, activeCount, deprecatedCount, byId, addField, deprecate, reactivate, resetSeed }
}
