// Aplica las correcciones de alineamiento modelo deber-ser <-> tablas reales
// detectadas en docs/audit/ALINEAMIENTO.md (barrido multi-agente + verificación adversarial).
// Idempotente: se puede correr varias veces. Uso: node scripts/apply-alignment-fixes.mjs
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const FILE = path.join(ROOT, 'src/data/modelo-dominio.json')
const m = JSON.parse(fs.readFileSync(FILE, 'utf8'))

const E = key => m.entidades.find(e => e.key === key) || (() => { throw new Error('entidad no existe: ' + key) })()
const A = (e, n) => (e.atributos || []).find(a => a.n === n) || (() => { throw new Error(`atributo ${e.key}.${n} no existe`) })()
const log = []
// marca un atributo como nuevo del rediseño (no existe en la tabla legacy)
const nuevo = (ekey, n, motivo) => {
  const a = A(E(ekey), n)
  if (a.nuevo !== true) { a.nuevo = true; log.push(`nuevo: ${ekey}.${n} (${motivo})`) }
  if (motivo && a.note == null) a.note = motivo
}
// fija el nombre de columna legacy de un atributo renombrado
const legacyCol = (ekey, n, col) => {
  const a = A(E(ekey), n)
  if (a.legacy !== col) { a.legacy = col; log.push(`legacy: ${ekey}.${n} -> ${col}`) }
}

// ───────────────────────────────────────────────────────────────────────────
// §1 — Errores reales de mapeo
// ───────────────────────────────────────────────────────────────────────────

// IntegrationContract: la tabla real lender_integration_flows es un LOG por solicitud
// (id, user_request_id, lender_id, data), no un contrato configurable -> green-field.
{
  const e = E('integrationContract')
  const ref = 'green-field (contrato de integración configurable; la tabla real lender_integration_flows es un log por solicitud {user_request_id, lender_id, data}, no respalda este concepto)'
  if (e.legacy?.tabla === 'lender_integration_flows') {
    e.legacy = { ref }
    log.push('integrationContract: reclasificada a green-field (lender_integration_flows era un log, no un contrato)')
  }
}

// ScoringClause -> creditop_x_lender_scoring: rangos reales son min_value/max_value; el resto son FKs nuevas.
legacyCol('scoringClause', 'min', 'min_value')
legacyCol('scoringClause', 'max', 'max_value')
nuevo('scoringClause', 'country_id', 'eje país del rediseño; no existe en creditop_x_lender_scoring')
nuevo('scoringClause', 'policy_version_id', 'versionado de política; FK nueva')
nuevo('scoringClause', 'scoring_policy_id', 'normalización de la política de scoring; FK nueva')
nuevo('scoringClause', 'evaluable_field_id', 'registro de facts (decisioning); FK nueva')
nuevo('scoringClause', 'status', 'estado de la cláusula; no existe en la tabla real')

// SignedRequestChange -> creditop_x_changes_log: la columna real es user_request_id, no loan_application_id.
legacyCol('signedRequestChange', 'loan_application_id', 'user_request_id')
nuevo('signedRequestChange', 'revolving_credit_id', 'vínculo al cupo rotativo; no existe en creditop_x_changes_log')
nuevo('signedRequestChange', 'previous_value', 'valor previo del cambio; no existe en la tabla real')
nuevo('signedRequestChange', 'new_value', 'valor nuevo del cambio; no existe en la tabla real')

// BureauProvider -> risk_centrals: la tabla real es un catálogo mínimo (id, name).
nuevo('bureauProvider', 'slug', 'identificador estable del proveedor; no existe en risk_centrals')
nuevo('bureauProvider', 'kind', 'capability del proveedor (credit_score/antifraud/pep_aml/identity); no existe en risk_centrals')
nuevo('bureauProvider', 'status', 'estado del proveedor; no existe en risk_centrals')

// ───────────────────────────────────────────────────────────────────────────
// §2 — Columnas nuevas del rediseño (existen en tabla real, pero el atributo es nuevo)
// ───────────────────────────────────────────────────────────────────────────
nuevo('onboardingForm', 'country_id', 'eje país del rediseño; no existe en form_types')
nuevo('creditPolicy', 'country_id', 'eje país del rediseño')
nuevo('scoringPolicy', 'country_id', 'eje país del rediseño; no existe en creditop_x_lender_scoring')
nuevo('riskMultiplierVariable', 'country_id', 'eje país del rediseño; no existe en creditop_x_profiling_multiplier_risk_vars')
nuevo('formField', 'semantic_role', 'el motor lee por rol semántico, no por field_id; no existe en fields')
nuevo('lender', 'closing_pattern_id', 'patrón de cierre como dato; FK nueva')
nuevo('lender', 'adapter_slug', 'adaptador de integración como dato; columna nueva')
nuevo('lenderTransaction', 'provider_type', 'discriminador del puerto unificado (payvalida/sistecrédito/gateway); columna nueva')
nuevo('eligibilityRule', 'policy_version_id', 'versionado de política; FK nueva (no existe en lender_rules)')
nuevo('eligibilityRule', 'rule_definition_id', 'catálogo canónico de reglas; FK nueva (no existe en lender_rules)')
nuevo('eligibilityPolicy', 'rule_definition_id', 'catálogo canónico de reglas; FK nueva (no existe en group_rules)')
nuevo('corporateUser', 'cognito_sub', 'identidad en Cognito (IdP); no existe en corporate_users (hoy auth por password)')
nuevo('countrySetting', 'value_type', 'tipado del valor; la tabla real settings usa serialized (tinyint), no value_type')
nuevo('countrySetting', 'status', 'estado del setting; no existe en settings')

// ───────────────────────────────────────────────────────────────────────────
// §3 — Referencia rota: 'merchant_settings' NO existe; la tabla real es 'settings'
// ───────────────────────────────────────────────────────────────────────────
for (const k of ['settingDefinition', 'settingBinding']) {
  const e = E(k)
  if (e.legacy?.ref && e.legacy.ref.includes('merchant_settings')) {
    const before = e.legacy.ref
    e.legacy.ref = before.replace(/merchant_settings\/settings|merchant_settings/g, 'settings')
    log.push(`${k}: ref corregida (merchant_settings inexistente -> settings)`)
  }
  // dejar constancia de que la tabla real 'settings' ya existe y respalda parcialmente este concepto
  if (e.legacy && !e.legacy.note) {
    e.legacy.note = "La tabla real 'settings' (code/key/value/serialized/country_id) ya existe y cubre parcialmente este rol; el deber-ser la normaliza en catálogo (SettingDefinition) + valor por scope (SettingBinding)."
    log.push(`${k}: nota de relación con tabla real 'settings'`)
  }
}

// ───────────────────────────────────────────────────────────────────────────
fs.writeFileSync(FILE, JSON.stringify(m, null, 2) + '\n')
console.log('Cambios aplicados (' + log.length + '):')
log.forEach(l => console.log('  - ' + l))
if (!log.length) console.log('  (sin cambios; ya estaba aplicado — idempotente)')
