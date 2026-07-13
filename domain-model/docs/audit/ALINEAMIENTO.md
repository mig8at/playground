# Alineamiento modelo deber-ser ↔ tablas reales

**Fecha:** 2026-06-03 · **Modelo:** v4.0 (99 entidades, 75 value-objects) · **BD real:** 212 tablas (copia local de dev).
**Método:** cruce determinístico (`scripts/audit-legacy-refs.mjs`) + barrido multi-agente (7 contextos + verificación adversarial + reconciliación de VOs y gap inverso). Insumos en `docs/audit/`.

---

## TL;DR

| Nivel | Resultado |
|---|---|
| **Entidad → tabla** (¿apunta a tabla inexistente?) | **0 referencias rotas.** 66 mapeadas a tablas existentes, 26 nuevas marcadas `green-field`, 7 externas. |
| **Columna → columna** (barrido fino) | **30 hallazgos confirmados** (0 refutados). Se dividen en *errores reales de mapeo* y *columnas nuevas del rediseño sin marcar como nuevas*. |
| **Green-field con tabla existente** | **2 confirmados** (`SettingDefinition`, `SettingBinding` → la tabla `settings` ya existe). |
| **Value-objects** | 67/75 con tabla real, 6 enums puros, **2 a revisar** (`PricingFormula`, `Offer`). Trazabilidad VO→tabla **no está en el JSON** (gap sistémico). |
| **Gap inverso** | De 135 tablas no cubiertas: 74 ya son VOs, 31 telemetría, 19 infra Laravel, 4 temp — **7 posibles omisiones de dominio**. |

La buena noticia: **el modelo no apunta a ninguna tabla que no exista.** Los problemas reales son (1) un puñado de entidades que dicen mapear una tabla pero su forma no coincide con la real, y (2) columnas nuevas del rediseño que no están señaladas explícitamente como nuevas — justo tu preocupación.

---

## 1. Errores reales de mapeo (ALTA — corregir)

Entidades marcadas `mapeada_ok` cuya **forma no coincide** con la tabla real (la tabla existe, pero el modelo le atribuye columnas/propósito que no tiene):

| Entidad | Tabla legacy | Problema | Acción sugerida |
|---|---|---|---|
| **IntegrationContract** | `lender_integration_flows` | La tabla real es un **log por solicitud** (`id, user_request_id, lender_id, data`), **no** un contrato de integración configurable. Ninguno de `endpoints/auth_kind/checksum_kind/webhook_url_pattern/verify_strategy/status` existe. | Reclasificar a **green-field** (es un concepto nuevo); la tabla actual no lo respalda. |
| **ScoringClause** | `creditop_x_lender_scoring` | Re-modelo normalizado sobre una tabla de forma distinta: solo `points` coincide; los rangos reales son **`min_value`/`max_value`** (el modelo dice `min`/`max`); `country_id/policy_version_id/scoring_policy_id/evaluable_field_id` no existen. | Corregir nombres de columna (`min`→`min_value`, `max`→`max_value`) y marcar las FKs nuevas como green-field. |
| **SignedRequestChange** | `creditop_x_changes_log` | `loan_application_id` no existe — la columna real es **`user_request_id`** (error de mapeo). `revolving_credit_id/previous_value/new_value` tampoco existen. | Corregir `loan_application_id`→`user_request_id`; marcar el resto como nuevo. |
| **BureauProvider** | `risk_centrals` | La tabla real es un catálogo mínimo (`id, name`); `slug/kind/status` no existen. | Marcar `slug/kind/status` como columnas nuevas del rediseño. |

> Nota: `IntegrationContract` y `ScoringClause` son los más serios — el modelo **reusa el nombre de una tabla real para un concepto distinto**, lo que rompe la trazabilidad que el resto del modelo respeta.

## 2. Columnas NUEVAS del rediseño sin marcar como nuevas (ALTA/MEDIA — anotar)

Atributos con `legacy=null` sobre tablas existentes: **no son errores**, son columnas que el deber-ser agrega. El problema es que **no están señaladas como nuevas** — un lector no distingue "columna legacy que olvidaron mapear" de "columna nueva del rediseño". Recomendación: marcar explícitamente (p.ej. `nuevo:true` o `legacy:"green-field"` a nivel atributo).

- `OnboardingForm.country_id`, `CreditPolicy.country_id`, `ScoringPolicy.country_id`, `RiskMultiplierVariable.country_id` — eje multi-país (cambios de `apply-inversion-2`).
- `FormField.semantic_role` — lectura por rol semántico (inversión-2).
- `Lender.closing_pattern_id`, `Lender.adapter_slug` — patrón de cierre como dato.
- `LenderTransaction.provider_type` — discriminador del puerto unificado.
- `EligibilityRule.{policy_version_id, rule_definition_id}`, `EligibilityPolicy.rule_definition_id` — motor de reglas canónico.
- `CorporateUser.cognito_sub` — identidad en Cognito (¿debería vivir en el IdP, no en la tabla?).
- `countrySetting.{value_type, status}` — la tabla real `settings` usa `serialized` (no `value_type`) y no tiene `status`.

## 3. Green-field que en realidad ya tienen tabla (ALTA — revisar el reverso)

Tu preocupación inversa, confirmada:

- **`SettingDefinition` y `SettingBinding`** se declaran `green-field`, pero la tabla **`settings` YA EXISTE** (`code, key, value, serialized, country_id`) y cumple parcialmente el rol de catálogo/parametrización. No son green-field puros: deberían declarar `legacy.tabla = settings` (o `absorbe`).
- **Doc rota:** el `legacy.ref` de ambas cita la tabla **`merchant_settings`, que NO existe** (solo existe `settings`). Corregir el texto.
- `EvaluableField` (green-field) tiene un candidato por nombre (`fields`) pero con propósito distinto (campos de formulario vs. catálogo de facts) → MEDIA, probablemente sí es nuevo.

## 4. Columnas reales dropeadas en silencio (MEDIA — documentar en `reducidas` o modelar)

Columnas de negocio en tablas reales que el modelo no representa **ni como atributo ni en `reducidas[]`** (excluye `id/created_at/updated_at`):

- `countries.iso_code_1`; `settings.{code, serialized}`; `allieds.nit` (NIT fiscal del comercio).
- `users.{identity_id, corporate_user_id, profile_data, resource}` (FKs/datos de identidad y vínculo con asesor).
- `lenders.{country_id, ecommerce, url, email, action, sort}`.
- `lender_users_categories.{available_amount_multiplier, life_percentage}` (cálculo de cupo y seguro).
- `fields.description`; `user_requests.confirmation_email_attachments`; `lender_error_codes.description`; `payment_registers.payment_method` (texto).
- **`RequestHistoryEntry` (ledger Creditop X) — el más extenso:** ~18 columnas de **seguro de vida / garantía / desglose de cuota / facturación** no modeladas (`paid_guarantee*`, `*_insurance*`, `installment_principal_value`, `installment_interest_value`, `billing_principal_amount`, `late_payment_principal_exclude`, `installments_waived_interest`, …). Relevantes para aging y estado de cuenta — vale revisar si el modelo del ledger debe incluirlas.

## 5. Value-objects (trazabilidad)

- **67/75** tienen tabla real identificable (ej. `Bank→banks`, `FrecuenciaDataCredito→datacredito_frequencies`, `MerchantBeneficiary→beneficiaries_by_allieds`).
- **6** son enums/VO-DDD puros sin tabla (OK): `ProviderType, ChangeType, ClosingPattern, Money, Document, Terms`.
- **2 a revisar:** `PricingFormula` (parámetros dispersos en `lender_*` / `treasury_calculations`) y `Offer` (no hay tabla `offers` — ¿debe persistirse?).
- **Gap sistémico:** el JSON **no anota `legacy.tabla` en los value-objects** (sí en entidades). Recomendación: agregar la anotación para cerrar la trazabilidad VO→tabla.
- A confirmar manualmente: `Provider→risk_centrals`, `RiskAssessmentSnapshot→profilings/creditop_x_revolving_credits_history`, `EcommerceChannel→ecommerces`, `UserCategoryRule` (¿`lender_user_category_scoring_policy_rules` o `lender_users_category_rules`?).

## 6. Gap inverso — posibles omisiones de dominio (7)

De 135 tablas no cubiertas por entidad, la mayoría es ruido legítimo (74 ya son VOs, 31 telemetría, 19 infra Laravel, 4 temp). **Candidatas a omisión real:**

- **Pricing/cupo (las más claras):** `creditop_x_occupation_multiplier_by_lender`, `creditop_x_social_strata_multiplier_by_lender`, `lender_term_capital_adjustment_factors`, `creditop_x_lender_residual_balances`.
- **Bordeline:** `bonifications` (incentivos/cashback — el modelo lo declara fuera de alcance), `log_user_special_credit_grant_by_lender` (otorgamiento especial), `identity_validation_attempts` (proceso KYC transaccional, no solo catálogo).

---

---

## ✅ Correcciones aplicadas (`scripts/apply-alignment-fixes.mjs`, idempotente)

Aplicadas al `modelo-dominio.json` el 2026-06-03 (33 cambios; build `vue-tsc` OK; auditoría = 0 refs rotas):

- **§1 Errores de mapeo:** `IntegrationContract` reclasificada a **green-field** (su tabla era un log); `ScoringClause.min/max` → `legacy: min_value/max_value`; `SignedRequestChange.loan_application_id` → `legacy: user_request_id`; `BureauProvider.{slug,kind,status}` marcados nuevos.
- **§2 Columnas nuevas marcadas:** **25 atributos** ahora llevan `nuevo:true` (eje país, `semantic_role`, `closing_pattern_id`, `provider_type`, FKs de versionado/reglas, `cognito_sub`, etc.). Nuevo marcador visible como badge **nuevo** en el ERD (TableNode) y el panel de detalle.
- **§3 Referencia rota:** `SettingDefinition`/`SettingBinding` — corregida la mención a `merchant_settings` (inexistente) → `settings`, con nota de relación con la tabla real.

### §4 + §6 aplicados (`scripts/apply-alignment-fixes-2.mjs`, idempotente — 76 cambios)

**§4 — columnas reales no modeladas, clasificadas:**
- **Modeladas como atributo** (dato de negocio): `merchant.nit`, `customer.{user_profile_id, identity_id, corporate_user_id}`, `lender.{url, email, country_id}`, `creditCategory.{available_amount_multiplier, life_percentage}`, `formField.description`, `lenderErrorCode.description`, `country.iso_code_1`, `countrySetting.{code, serialized}`, y el **ledger completo de `requestHistoryEntry`** (`user_id` + 18 columnas de seguro/garantía/cuota/facturación — el ítem de mayor peso de negocio).
- **Documentadas como `reducida`** (branding/UI, infra AWS/auth, flags→Setting, `action`→ClosingPattern, `allied_id`→CustomerMerchant, `profile_data`→Profiling, `payment_method`→FK, etc.).

**§6 — tablas de dominio no cubiertas, resueltas (7/7):**
- **6 entidades nuevas:** `OccupationMultiplier`, `SocialStrataMultiplier`, `TermCapitalAdjustmentFactor` (→ agregado `creditPolicy`), `LenderResidualBalance` (→ `lender`), `IdentityValidationAttempt` (→ `identityVerification`), `Bonification` (raíz en creditopX — se modela por llevar dinero, distinto del `incentiveLog` telemetría).
- **1 a `fueraDeAlcance`:** `log_user_special_credit_grant_by_lender` (telemetría).

Resultado: **105 entidades**, mapeada_ok 71, **0 referencias rotas**, build `vue-tsc` OK. Tablas cubiertas por entidad: 82; en `fueraDeAlcance`: 21.

**Pendientes resueltos por datos:** `merchant.price` → vestigial (263/266 comercios en 0) y `customer.resource` → muerta (100% NULL en dev). Ambas documentadas como `reducida` con su evidencia. **Sin pendientes `revisar`.**

## 7. Hallazgos de validación E2E (jun 2026)

Nuevos hallazgos descubiertos por la sesión de validación de los harness E2E
(`backend-e2e`/`frontend-e2e`). Ninguno requiere cambio en `modelo-dominio.json` —
el modelo ya los respeta o no entran en su scope; se documentan aquí porque
**informan cómo se debe LEER el modelo contra la realidad**.

### 7.1 `LenderAlliedCredential` es OPCIONAL en la práctica (gap sistémico)

El modelo lo señala correctamente (`merchant_id`: *"asociado cuando aplica"*),
pero la magnitud del gap no estaba cuantificada. Conteo real (BD local
`legacy-backend-mysql-1`, dump de dev, jun 2026):

| Lender | Allieds ofrecen (`lenders_by_allieds.status=1`) | SIN credencial | % gap |
|---|---:|---:|---:|
| `#6` Credifamilia-addi | (muchos) | **136** | mayoritario |
| `#9` Sistecrédito | — | 45 | — |
| `#11` Sufi+pay | — | 31 | — |
| `#23` Welli | — | 30 | — |
| `#5` Banco de Bogotá | — | 30 | — |
| `#7` Sufi · `#32` Vanti · `#19` Brilla | — | 14 c/u | — |
| `#39` Meddipay | — | 11 | — |
| `#17` PayJoy · `#22` Servicrédito | — | 9 c/u | — |
| `#100` Bancolombia Consumo | 78 | 8 | 10% |
| `#16` Crediminuto · `#12` Prami · `#8` Bancolombia | — | 6 c/u | — |
| `#68` Bancolombia BNPL | 109 | 5 | 5% |
| `#18` Krediya · `#24` Credifamilia | — | 5 / 4 | — |
| `#14` Global Care · `#10` Crediwonder | — | 3 c/u | — |

Total: **18 lenders activos** con ≥3 allieds sin credencial.

**Comportamiento observado** (en `backend-e2e::bancolombiaClose`): sin la fila en
`lender_allied_credentials`, el motor PLS de Bancolombia **no evalúa el lender**
para ese allied (la pre-aprobación falla con error genérico). El harness siembra
la credencial faltante (`ensureBancolombiaCreds`, copia de una existente) — con
`fakeBancolombiaForLocal` el contenido no importa, solo que la fila exista.

Implicancia para el modelo: la cardinalidad `merchant→lenderAlliedCredential`
debería leerse como **0..1 (no 1..1)**, y la lógica de marketplace asume que
"ofrecido en `lenders_by_allieds`" **NO IMPLICA** "evaluable" — falta la credencial.
Candidato a documentar como pregunta abierta o entidad de "fallback/política
de credencial compartida" en una próxima iteración.

### 7.2 `ONB030 internal server error` (Experian fake) no estaba mapeado

Descubierto al validar `frontend-e2e::kyc-subcodes` contra el backend real:
los escenarios Experian fake (`server-error`/`timeout`/`no-hit`) emiten
**`ONB030 + "internal server error"`** — un `error_code` NUEVO que no aparecía
en `docs/REFERENCIA-FLUJOS.md` ni en este audit. Es un error de PROVEEDOR
(bureau falló), distinto de `ONB005` (validación KYC). No requiere entidad nueva
(es un código de respuesta); ya documentado en `REFERENCIA-FLUJOS §13`.

### 7.3 Shape de errores HETEROGÉNEO en el backend

Al implementar los specs reescritos contra el backend real (`pkg/error-shape.ts`),
se observaron 4 formas distintas según el endpoint:

1. `error_code` concatenado: `"ONB005_EXPEDITION_DATE_INVALID"`.
2. Anidado: `errors.error_code` + `errors.error_subcode` (separados).
3. KYC anidado: `error.code: "DOCUMENT_NOT_FOUND"`.
4. Mensaje libre: `message: "document number already in use"`.

`backend-e2e::channel/negative.go::errField` ya manejaba esta heterogeneidad con
un OR (`errCode || errSubcode || message`). Los specs nuevos del frontend adoptan
la misma estrategia con `bodyContains` recursivo. No es un error del modelo —
es una característica del backend real que conviene catalogar.

### 7.4 `user_request_id` viaja en `errors.payload.user_request_id` cuando otp-validate devuelve `ONB002`

Detalle que tropezó el setup helper de un spec: el FE consume el `user_request_id`
desde `body.errors.payload.user_request_id` (no desde `body.data.payload.*`)
cuando el OTP devuelve `success:false + error_code: "ONB002"` (que es lo NORMAL —
ONB002 = "ir a /personal-info"). El backend trata la respuesta como "error con
payload útil"; el FE la trata como "ruta a personal-info con el id". No es un
defecto: es contrato. Vale documentarlo en flujos como caso de "error_code que
no es error".

## Prioridad de acción

1. **Corregir mapeos errados (§1):** `IntegrationContract` y `ScoringClause` (nombre de tabla/columna), `SignedRequestChange.loan_application_id→user_request_id`.
2. **Marcar como nuevas las columnas del rediseño (§2)** para que el modelo distinga "nuevo" de "olvidé mapear".
3. **Reclasificar `SettingDefinition`/`SettingBinding` (§3)** a la tabla `settings` y corregir la referencia a `merchant_settings` inexistente.
4. **Decidir sobre el ledger de Creditop X (§4)** — el bloque de seguro/garantía/cuota es el de mayor peso de negocio sin modelar.
5. **Anotar `legacy.tabla` en los VOs (§5)** y resolver `treasury_calculations`/`Offer`.
6. **Evaluar las 4 tablas de pricing/cupo (§6)** como posible agregado de underwriting faltante.

> Artefactos: `docs/audit/ground-truth.json` (determinístico), `docs/audit/sweep-result.json` (barrido completo con evidencia por hallazgo), `docs/audit/{real_tables.txt, real_columns.tsv, by-context/*.json}`.
