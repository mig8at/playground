// §4 (columnas reales no modeladas) + §6 (tablas de dominio no cubiertas) de docs/audit/ALINEAMIENTO.md.
// Idempotente. Resuelve tipos desde docs/audit/real_columns.tsv. Uso: node scripts/apply-alignment-fixes-2.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FILE = path.join(ROOT, 'src/data/modelo-dominio.json')
const m = JSON.parse(fs.readFileSync(FILE, 'utf8'))

// mapa {tabla:{col:tipo}} desde el esquema real
const colType = {}
for (const line of fs.readFileSync(path.join(ROOT, 'docs/audit/real_columns.tsv'), 'utf8').split('\n')) {
  const [t, c, ty] = line.split('\t')
  if (t && c) (colType[t] = colType[t] || {})[c] = ty
}
const typeOf = (table, col) => colType[table]?.[col] || 'varchar(255)'
const realCols = table => Object.keys(colType[table] || {})

const E = key => m.entidades.find(e => e.key === key) || (() => { throw new Error('entidad no existe: ' + key) })()
const log = []

// añade un atributo (dato de negocio) si no existe; tipo desde el esquema real
function addAttr(ekey, table, col, note) {
  const e = E(ekey)
  if ((e.atributos || []).some(a => a.n === col || a.legacy === col)) return
  e.atributos.push({ n: col, t: typeOf(table, col), note })
  log.push(`atributo: ${ekey}.${col} (${typeOf(table, col)})`)
}
// documenta una columna como reducida (colapsada/derivada/infra)
function addReducida(ekey, col, via) {
  const e = E(ekey)
  e.legacy = e.legacy || {}
  e.legacy.reducidas = e.legacy.reducidas || []
  const existing = e.legacy.reducidas.find(r => r.legacy === col)
  if (existing) { if (existing.via !== via) { existing.via = via; log.push(`reducida(via): ${ekey}.${col} → ${via}`) } return }
  e.legacy.reducidas.push({ n: col, legacy: col, via })
  log.push(`reducida: ${ekey}.${col} (${via})`)
}
function addFuera(table, motivo) {
  m.fueraDeAlcance = m.fueraDeAlcance || { nota: '', tablas: [] }
  if (!m.fueraDeAlcance.tablas.includes(table)) {
    m.fueraDeAlcance.tablas.push(table)
    log.push(`fueraDeAlcance: ${table} (${motivo})`)
  }
}
// crea una entidad nueva mapeada a una tabla real (atributos = columnas reales)
function ensureEntity({ key, name, contexto, tipo, descripcion, table, relaciones }) {
  if (m.entidades.some(e => e.key === key)) return
  const atributos = realCols(table).map(c => ({ n: c, t: typeOf(table, c) }))
  m.entidades.push({ key, name, contexto, tipo, identidad: 'id', descripcion,
    atributos, legacy: { tabla: table }, relaciones: relaciones || [] })
  log.push(`ENTIDAD NUEVA: ${key} -> ${table} (${atributos.length} cols)`)
}
function addMember(aggRoot, key) {
  const a = m.agregados.find(x => x.root === aggRoot)
  if (a && !a.miembros.includes(key)) { a.miembros.push(key); log.push(`miembro: ${key} -> agregado ${aggRoot}`) }
}

// ═══════════════════════════════════════════════════════════════════════════
// §4 — Columnas reales no modeladas: atributo | reducida
// ═══════════════════════════════════════════════════════════════════════════

// merchant -> allieds
addAttr('merchant', 'allieds', 'nit', 'NIT / identificación tributaria del comercio aliado')
for (const c of ['image', 'qr_image', 'banner_url', 'background_url', 'app_ecommerce_url', 'new_screens',
  'primary_color', 'secondary_color', 'font_color', 'quaternary_color', 'quinary_color', 'senary_color'])
  addReducida('merchant', c, 'branding / UI (no dominio)')
addReducida('merchant', 'aws_arn', 'infra AWS (referencia de recurso)')
addReducida('merchant', 'price', 'columna vestigial: 263/266 comercios en 0 (sin uso real como tarifa)')

// customer -> users
addAttr('customer', 'users', 'user_profile_id', 'perfil/rol del usuario (1:1 con role; ver HALLAZGOS-BD)')
addAttr('customer', 'users', 'identity_id', 'referencia de identidad externa')
addAttr('customer', 'users', 'corporate_user_id', 'asesor / usuario corporativo asociado')
addReducida('customer', 'allied_id', 'normalizado a CustomerMerchant (comercio primario del cliente)')
addReducida('customer', 'allied_branch_id', 'normalizado a CustomerMerchant (sucursal primaria)')
addReducida('customer', 'profile_data', 'perfilamiento → ProfilingRun/ProfilingReview')
addReducida('customer', 'resource', 'columna muerta: 100% NULL en dev (227.603/227.603)')
addReducida('customer', 'remember_token', 'infra auth (no dominio)')

// lender -> lenders
addAttr('lender', 'lenders', 'url', 'URL pública del lender')
addAttr('lender', 'lenders', 'email', 'email de contacto del lender')
addAttr('lender', 'lenders', 'country_id', 'país del lender (eje multi-país; columna real existente)')
for (const c of ['image', 'voucher_image_url', 'description', 'benefits', 'show_intro_screen', 'intro_background_url', 'complementary_form'])
  addReducida('lender', c, 'branding / UI (no dominio)')
addReducida('lender', 'ecommerce', 'flag → Setting (config como dato)')
addReducida('lender', 'action', 'reemplazado por ClosingPattern (patrón de cierre como dato)')
addReducida('lender', 'sort', 'orden de presentación (UI)')

// creditCategory -> lender_users_categories
addAttr('creditCategory', 'lender_users_categories', 'available_amount_multiplier', 'multiplicador del cupo disponible')
addAttr('creditCategory', 'lender_users_categories', 'life_percentage', 'porcentaje de seguro de vida aplicado')

// formField -> fields
addAttr('formField', 'fields', 'description', 'descripción del campo del formulario')

// lenderErrorCode -> lender_error_codes
addAttr('lenderErrorCode', 'lender_error_codes', 'description', 'descripción extendida del código de error (complementa message)')

// country -> countries
addAttr('country', 'countries', 'iso_code_1', 'código ISO alpha/numérico-1 del país')

// countrySetting -> settings
addAttr('countrySetting', 'settings', 'code', 'código del setting (clasificador, además de key)')
addAttr('countrySetting', 'settings', 'serialized', 'indica si value está serializado (mecanismo real de tipado)')

// loanApplication -> user_requests
addReducida('loanApplication', 'confirmation_email_attachments', 'artefacto del email de confirmación (no dominio)')

// paymentRegister -> creditop_x_payment_register
addReducida('paymentRegister', 'payment_method', 'normalizado a PaymentMethod (payment_method_id FK)')

// requestHistoryEntry -> creditop_x_requests_history : LEDGER COMPLETO (montos de seguro/garantía/cuota)
{
  const table = 'creditop_x_requests_history'
  const e = E('requestHistoryEntry')
  const have = new Set((e.atributos || []).flatMap(a => [a.n, a.legacy]).filter(Boolean))
  const has = c => have.has(c) || (e.legacy?.reducidas || []).some(r => r.legacy === c)
  const skip = new Set(['id', 'created_at', 'updated_at', 'deleted_at'])
  for (const c of realCols(table)) {
    if (skip.has(c) || has(c)) continue
    const note = c === 'user_id' ? 'cliente (FK)' : 'desglose financiero del estado de cuenta (seguro/garantía/cuota/facturación)'
    e.atributos.push({ n: c, t: typeOf(table, c), note })
    log.push(`atributo(ledger): requestHistoryEntry.${c} (${typeOf(table, c)})`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// §6 — Tablas de dominio no cubiertas: entidad nueva | fueraDeAlcance
// ═══════════════════════════════════════════════════════════════════════════

ensureEntity({ key: 'occupationMultiplier', name: 'OccupationMultiplier', contexto: 'credit', tipo: 'entity',
  descripcion: 'Multiplicador de cupo por ocupación, por lender (config de underwriting).',
  table: 'creditop_x_occupation_multiplier_by_lender',
  relaciones: [{ a: 'lender', card: 'N:1', rol: 'lender_id', tipo: 'referencia' }] })
addMember('creditPolicy', 'occupationMultiplier')

ensureEntity({ key: 'socialStrataMultiplier', name: 'SocialStrataMultiplier', contexto: 'credit', tipo: 'entity',
  descripcion: 'Multiplicador de cupo y salario mínimo por estrato social, por lender (config de underwriting).',
  table: 'creditop_x_social_strata_multiplier_by_lender',
  relaciones: [{ a: 'lender', card: 'N:1', rol: 'lender_id', tipo: 'referencia' }] })
addMember('creditPolicy', 'socialStrataMultiplier')

ensureEntity({ key: 'termCapitalAdjustmentFactor', name: 'TermCapitalAdjustmentFactor', contexto: 'credit', tipo: 'entity',
  descripcion: 'Factor de ajuste de capital por plazo, por lender (config de pricing). Tabla real vacía (aún sin uso).',
  table: 'lender_term_capital_adjustment_factors',
  relaciones: [{ a: 'lender', card: 'N:1', rol: 'lender_id', tipo: 'referencia' }] })
addMember('creditPolicy', 'termCapitalAdjustmentFactor')

ensureEntity({ key: 'lenderResidualBalance', name: 'LenderResidualBalance', contexto: 'credit', tipo: 'entity',
  descripcion: 'Saldo residual por lender (Creditop X). Tabla real vacía (aún sin uso).',
  table: 'creditop_x_lender_residual_balances',
  relaciones: [{ a: 'lender', card: 'N:1', rol: 'lender_id', tipo: 'interna' }] })
addMember('lender', 'lenderResidualBalance')

ensureEntity({ key: 'bonification', name: 'Bonification', contexto: 'creditopX', tipo: 'aggregateRoot',
  descripcion: 'Bonificación / cashback al usuario (monto real). Se modela por llevar dinero — distinto del incentiveLog (telemetría) removido. Polimórfica vía entity_type/entity_id.',
  table: 'bonifications',
  relaciones: [{ a: 'customer', card: 'N:1', rol: 'user_id', tipo: 'referencia' }] })

ensureEntity({ key: 'identityValidationAttempt', name: 'IdentityValidationAttempt', contexto: 'identity', tipo: 'entity',
  descripcion: 'Intento de validación de identidad (KYC): estado y hash de documento frontal/posterior/facial por solicitud. Dato transaccional del proceso de verificación.',
  table: 'identity_validation_attempts',
  relaciones: [
    { a: 'loanApplication', card: 'N:1', rol: 'user_request_id', tipo: 'referencia' },
    { a: 'customer', card: 'N:1', rol: 'user_id', tipo: 'referencia' },
  ] })
addMember('identityVerification', 'identityValidationAttempt')

// out of scope: el LOG del otorgamiento especial (telemetría; el grant en sí vive en categoryEligibilityCriteria.special_granting)
addFuera('log_user_special_credit_grant_by_lender', 'telemetría: log de otorgamiento especial (el grant vive en special_granting)')

// ═══════════════════════════════════════════════════════════════════════════
fs.writeFileSync(FILE, JSON.stringify(m, null, 2) + '\n')
console.log('Cambios aplicados (' + log.length + '):')
log.forEach(l => console.log('  - ' + l))
if (!log.length) console.log('  (sin cambios; idempotente)')
