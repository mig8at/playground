# Auditoría de reducción — ¿cuánto se puede simplificar el deber-ser?

## Resumen ejecutivo (potencial total realista de reducción)

- **Estimado bruto inflado por solapamientos.** Los 55 hallazgos suman ~150 columnas y ~27 entidades, pero al deduplicar el mismo caso aparece hasta 3-4 veces (BureauSummary lo reportan 4 lentes; las 3 entidades KYC, 3 lentes; ScoringPolicy/ScoringRule, 3 lentes; CategoryEligibilityCriteria, 3 lentes). El potencial **realista y conservador es ~95-110 columnas conceptuales y ~13-16 entidades** (las 30+ columnas KYC y las 18-22 de criterios se cuentan una sola vez).
- **El grueso del ahorro de columnas viene de 3 focos concretos:** (a) las ~18 columnas-criterio de `CategoryEligibilityCriteria` → filas de `RuleDefinition`; (b) las ~30 columnas tipadas-por-proveedor de las 3 entidades KYC (`JumioVerification`/`CrosscoreEvaluation`/`SigningDocument`) → `evidence` json gobernado por `Provider`; (c) ~18 flags de modo/capability del `Merchant`/`Lender` → filas de `Setting` o derivadas de políticas.
- **El ahorro de entidades es modesto pero limpio:** ~13-16 entidades, casi todas de bajo riesgo y semánticamente respaldadas por el propio modelo: 3 KYC + `BureauSummary` (1) + fusión `ScoringPolicy`/`ScoringRule` (−1) + 2-3 VOs catálogo duplicados + 2 multiplicadores concretos + `LenderIntegrationFlow` a telemetría.
- **Lo de mayor impacto/riesgo combinado son los criterios y el KYC**, porque están explícitamente marcados como contradicción del modelo (RuleDefinition ya existe; Provider ya existe). Son la prioridad 1.
- **El riesgo se concentra en montos del ledger** (`used_limit`, `total_payment_amount`, `next_payment_amount`): técnicamente derivables, pero conviene **dejarlos documentados, no ejecutarlos** sin validar performance/cobranza. Lo mismo los snapshots de auditoría.
- **Nada de lo reducible toca datos regulatorios ni contratos legacy:** el payload crudo de buró/transacción, los pagarés Deceval, el snapshot de `CreditDecision` y el ledger de cobranza se preservan intactos; la reducción es **conceptual** y mantiene el mapeo `legacy` para la migración física.

## Tabla priorizada (ordenada por impacto/riesgo)

| Prioridad | Tipo | Dónde | Ahorro | Riesgo | Propuesta |
|---|---|---|---|---|---|
| P0 | flags→settings | `Merchant`: flow_type, barcode_type, show_profiling, self_managed, preapproved_registration, allows_other_payment, payment, is_available_in_app, initial_fee | ~9 cols → filas | bajo | A `MerchantSetting` (key/value/value_type); el motor lee por scope. Modelo ya cita estos casos. |
| P0 | criterios→reglas | `CategoryEligibilityCriteria` (~18 cols-criterio) | ~18 cols → 3 (id/category_id/lender_id) | medio | Cada criterio = fila `RuleDefinition` scope=category. El doc lo marca como contradicción de RuleDefinition. |
| P0 | columnas→filas | `BureauSummary` (agildata, mareigua, tusdatos, datacredito, quanto, abaco) | 6 cols + 1 entidad → vista | medio | Eliminar entidad; consolidado = proyección sobre `BureauInquiry`. Buró nuevo = fila, no ALTER TABLE. |
| P0 | fusión | `ScoringPolicy` + `ScoringRule` (misma tabla `creditop_x_lender_scoring`) | 2 entidades → 1; 6 cols dup | bajo | Una sola `ScoringClause`; la "policy" es agrupación por lender_id. Cero pérdida de trazabilidad. |
| P1 | KYC→evidence | `JumioVerification` + `CrosscoreEvaluation` + `SigningDocument` | 3 entidades → 1; ~30 cols → ~6 + evidence json | medio | `evidence` json gobernado por VO `Provider`. Anti-patrón "tabla por integración" ya marcado P1. |
| P1 | flags→VO | `OccupationMultiplier` + `SocialStratumMultiplier` | 2 VOs → filas de `RiskMultiplierVariable` | bajo | El modelo ya declara que son "casos concretos" de la variable genérica. |
| P1 | criterios→reglas | `PaymentCapacityRule` + `UserFieldRule` + `UserCategoryRule` | 3 VOs → filas `ScoringClause` | bajo | Misma forma banda→puntos; discriminar por `variable_code` contra `ProfilingVariable`. |
| P1 | columnas→filas | `payment_gateway_transactions` | 1 entidad → absorbida; 3 cols → 1 attr + VO | medio | Añadir a `LenderTransaction.legacy.absorbe`; discriminador provider_type='payment_gateway'. |
| P1 | derivar | `Customer.full_name`, `CorporateUser.full_name`, `Customer.age` | 3 cols → 0 | bajo | Funciones puras (concat / fecha). No participan en FK ni unicidad. |
| P1 | escape-hatch | `Role.guard_name`, `Permission.guard_name` | 2 cols → 0 | bajo | Flag técnico de framework (Spatie), no dominio. A fueraDeAlcance. |
| P2 | flags→bindings | `CategoryEligibilityCriteria`: special_granting, debt_capacity_amount_validation, tc_vector_validation, overdue_vector_validation | 4 flags → 0 | medio | "Activo" = existe el binding/regla. |
| P2 | columnas→filas | `Merchant.has_ctopx` + `MerchantBranch.has_ctopx` | 2 cols → fila/binding | medio | A `MerchantLenderTerms`; invariante Branch≤Merchant pasa a regla de resolución. |
| P2 | derivar/políticas | `Lender.requires_restrictive_list_check`, `signing_provider_id`, `response_type`, `path_id` | 4 cols → 0 | medio | Derivados de `VerificationPolicy` / `ClosingPattern`+`IntegrationContract`. Evita doble fuente de verdad. |
| P2 | binding-regla | `Customer.validated`, `manual_validation`, `cell_phone_validation` | 3 cols → derivadas | medio | De cumplimiento de `VerificationPolicy`+versión / `Otp` validado. |
| P2 | fusión VO | `RequestStatus` + `CreditopXRequestStatus` (27 estados) | 2 VOs → 1 | medio | Mismo catálogo duplicado entre agregador y Creditop X. |
| P2 | fusión VO | `PaymentMethod` + `CreditopXPaymentMethod` | 2 VOs → 1 + binding | bajo | Mismo catálogo; la habilitación por lender es binding. |
| P2 | escape-hatch | `Customer.new_id`/is_new_document_format | 1 col → 0 | bajo | Formato lo gobierna `DocumentType.format` por país. |
| P2 | telemetría | `Customer.manual_register`, `mobile_created`; `Country.image`, `LenderPaymentChannel.image` | 4 cols → 0 | bajo | Canal de origen y branding no son dominio. |
| P2 | renombrar | `DatacreditoScoreRule`/`FrecuenciaDataCredito`/`DatacreditoQueryCounter` | nombre quemado → `BureauScoreRule` param. por bureau_provider_id | bajo | Des-quemar "Datacredito"; **mantener la entidad** (umbral regulatorio). |
| P2 | normalizar | `ScoringClause.variable` (string libre) | normaliza, no reduce cols | bajo | FK a catálogo `ProfilingVariable`. |
| P3 | fusión VO | `CreditopXPaymentType` + `PrincipalPaymentType` + `GatewayPaymentType` | 3 VOs → 1 con discriminador | medio | Catálogos enum solapados. |
| P3 | telemetría | `LenderIntegrationFlow` (vs `IntegrationContract`) | −1 entidad dominio | bajo | Traza runtime por solicitud = observabilidad, no dominio. Resuelve colisión legacy. |
| P3 | entidad→VO | `DeviceEnrollment` → fase de `DeviceLock` | 2 entidades → 1 | medio | Comparten IMEI; fases consecutivas (enroll→lock). |
| P3 | escape-hatch | `Lender.additional_data`, `MerchantBranch.datacredito_trigger`, `AdditionalInformation.data_json`/data_files | ~4 cols-json → 0/tipadas | medio | Tipar contra `IntegrationContract`/`Setting`/`VerificationPolicy`/`FieldAnswer`. **Conservar additional_data hasta migrar sus claves.** |
| P3 | derivar | `CreditCategory.already_used_loan`, `LoanApplication.amount_available` | 2 cols → 0 | medio | Agregados del ledger / propiedad de `RevolvingCredit`, no de la solicitud. |
| P3 | derivar (documentar) | `RevolvingCredit.used_limit`, `total_payment_amount`, `next_payment_amount` | 3 cols → 0 (o caché) | **alto** | Derivables del ledger/plan, pero **no ejecutar sin validar** performance/cobranza/snapshot de corte. |
| P4 | derivar (condicional) | `CategoryDecisionLog.current_available_amount` | 0-1 col | alto | Solo si es lectura viva; si es snapshot de decisión, **NO tocar**. |

## Por tipo de reducción (con subtotal)

**1. Flags → Settings/Policies (subtotal: ~22 columnas, 0 entidades).**
`Merchant` (~9 flags de modo/capability + 2 `has_ctopx`) a `MerchantSetting`; `Lender` requires_restrictive_list_check / signing_provider_id / response_type / path_id (4) derivados de políticas; `Customer.validated`/manual_validation/cell_phone_validation (3) de `VerificationPolicy`/`Otp`; `CategoryEligibilityCriteria` 4 flags-de-activación a presencia-de-binding. Riesgo bajo-medio. Estos flags son la "doble fuente de verdad" que el config-driven elimina.

**2. Columnas → Filas / por-proveedor (subtotal: ~9 columnas, 2 entidades).**
`BureauSummary` (6 cols-por-proveedor + 1 entidad → vista derivada de `BureauInquiry`); `payment_gateway_transactions` (3 cols → 1 attr + VO; 1 entidad absorbida por `LenderTransaction`). Riesgo medio. El payload crudo ya vive como fila; el ruteo por proveedor ya es `BureauFieldMapping(json_path)`.

**3. Criterios tipados → Reglas (subtotal: ~18 columnas, 3-4 entidades/VOs).**
`CategoryEligibilityCriteria` ~18 cols-criterio → filas de `RuleDefinition` scope=category (deja id/category_id/lender_id); fusión `ScoringPolicy`+`ScoringRule` (−1 entidad); `PaymentCapacityRule`/`UserFieldRule`/`UserCategoryRule` (3 VOs → filas `ScoringClause`); normalización de `variable` a catálogo `ProfilingVariable`. Riesgo medio. Es la mayor concentración de columnas y está explícitamente respaldada por el doc de validación.

**4. Derivadas / calculables (subtotal: ~8 columnas firmes + 4-5 de alto riesgo a documentar).**
Firmes (riesgo bajo): `Customer.full_name`, `CorporateUser.full_name`, `Customer.age`, `Customer.new_id`. Medio: `CreditCategory.already_used_loan`, `LoanApplication.amount_available`, `ProfilingReview.datacredito_query`. **Alto — solo documentar**: `used_limit`, `total_payment_amount`, `next_payment_amount`, `current_available_amount` (snapshots de ledger/corte; derivarlos puede destruir auditoría o degradar performance).

**5. Fusiones de entidad (subtotal: ~3-4 entidades).**
`ScoringPolicy`/`ScoringRule` (ya contado en criterios); `LenderIntegrationFlow` a telemetría (−1 dominio); `DeviceEnrollment` → fase de `DeviceLock` (−1). Riesgo bajo-medio.

**6. VOs / catálogos (subtotal: ~6-8 VOs).**
`RequestStatus`+`CreditopXRequestStatus` (−1); `PaymentMethod`+`CreditopXPaymentMethod` (−1); cluster de PaymentType (3→1, −2); `OccupationMultiplier`+`SocialStratumMultiplier` → filas (−2); `ProviderType` limpiar enum residual; `Datacredito*` renombrar a `BureauScoreRule` (no elimina entidad, des-quema nombre). Riesgo bajo-medio.

**7. KYC providers → evidence (subtotal: ~30 columnas, 3 entidades → 1).**
`JumioVerification`+`CrosscoreEvaluation`+`SigningDocument` colapsan a `evidence` json + `provider` ref en `IdentityVerification`. El mayor ahorro de columnas en una sola jugada. Riesgo medio (preservar `evidence`, `external_ref`, `validation`/`comment`).

**8. Escape-hatches / restos (subtotal: ~9-11 columnas, 0-1 entidad).**
`guard_name` ×2, `manual_register`, `mobile_created`, `Country.image`, `LenderPaymentChannel.image`, `new_id`, `datacredito_query`; json sin esquema (`additional_data`, `datacredito_trigger`, `data_json`/data_files). Riesgo bajo salvo los json (medio, requieren tipado previo).

## Qué NO reducir (y por qué)

**Contratos legacy / payload de integración (evidencia):**
- `BureauInquiry.data/request/additional_info` y `LenderTransaction.request/response`: payload crudo regulatorio y de conciliación/disputa. Son el **destino** de la colapsación, no candidatos a borrar.
- `Lender.additional_data`: aunque es escape-hatch, **conservarlo como traza** hasta migrar sus claves a settings tipados; dropearlo ahora pierde datos sin esquema conocido.
- `IntegrationContract`, `BureauProvider`, `CountryProviderBinding`, `CountryBureauPolicy`, `BureauFieldMapping`: es la infraestructura config-driven que **habilita** la reducción; fusionarlas re-quemaría el ruteo multi-país.

**Datos regulatorios / financieros:**
- `DatacreditoScoreRule` (umbrales de buró): renombrar a `BureauScoreRule`, **no disolver** en RuleDefinition genérico — es decisión de buró auditable con semántica regulatoria propia.
- `RiskProfilingTier` (down_payment + FGA), `ScoreAdjustmentBand` (opera post-scoring), `CreditCategory.{loan_limit, rate, FGA, min_initial_fee, max_amount}`: términos comerciales/financieros del producto y resultados del pipeline, no criterios de entrada.
- Ledger: `Payment`/`PaymentRegister`/`RevolvingCreditPayment` (3 semánticas contables distintas), `RequestHistoryEntry` (47 cols de cobranza), `SignedLegalDocument` + `deceval_response_data` (valor probatorio del pagaré), `SignedRequestChange`.

**Snapshots inmutables de auditoría (NO derivar aunque sean "recalculables"):**
- `CreditDecision.category_rules_acceptance` + `policy_version_id`, `RiskAssessmentSnapshot`, `ProfilingRun.number_of_samples`/processing_time, y `current_available_amount` **si** es snapshot del momento de decisión. El punto es congelar el valor histórico.

**Términos no derivables entre sí:**
- `LoanApplication.original_amount`/final_amount/amount (cada uno es un momento del acuerdo); `RevolvingCredit.approved_limit` vs `calculated_limit` (decisión humana vs salida del motor; pueden diferir por override); `billing_used_limit` (corte vigente ≠ used_limit total); todos los `*_percentage` de `LenderTerms` (parámetros negociados, son entrada del cálculo).

**Tipado base de país y seguridad:**
- `Country.is_operating`/operational_since (driver de expansión), `cell_phone_length`/locale/currency/phone_code (contrato de validación de uso intensivo — `CountrySetting` es para settings variables, no para reemplazar el locale base).
- `Customer.password`/two_factor_secret/recovery_codes/cognito_id, credenciales (`RiskBureauCredential`, `EcommerceCredential`): load-bearing, no telemetría.

**Trazabilidad:** en cada columna/entidad dropeada conceptualmente, **NO eliminar el atributo `legacy`** del mapeo. La reducción es del deber-ser; la tabla/columna física se preserva para la migración.

## Recomendación

**Reducir ya (riesgo bajo, respaldo explícito del modelo, sin tocar regulatorio):**
1. Fusionar `ScoringPolicy`+`ScoringRule` → `ScoringClause` (misma tabla, cero riesgo de trazabilidad).
2. `OccupationMultiplier`+`SocialStratumMultiplier` → filas de `RiskMultiplierVariable`.
3. `Merchant` flags de modo/capability → `MerchantSetting`.
4. Derivar `full_name` (×2), `age`, `new_id`; sacar `guard_name` ×2, `manual_register`/`mobile_created`, `*.image`.
5. Renombrar el cluster `Datacredito*` → `BureauScoreRule` (parametrizar por bureau_provider_id, sin eliminar la entidad).
6. Fusionar VOs catálogo duplicados: `RequestStatus`, `PaymentMethod`, cluster PaymentType.

**Reducir con validación (riesgo medio, ejecutar tras confirmar):**
7. `CategoryEligibilityCriteria` → bindings de `RuleDefinition` (alto impacto; validar el evaluador genérico cubre todos los operadores).
8. KYC: colapsar las 3 entidades a `evidence` json bajo `Provider` (preservar `validation`/`comment` y external_refs).
9. `BureauSummary` → vista derivada; absorber `payment_gateway_transactions` en `LenderTransaction`.
10. Derivar flags de validación del `Customer` desde `VerificationPolicy`+versión.

**Solo documentar para la migración (NO ejecutar ahora):**
- Montos del ledger derivables: `RevolvingCredit.used_limit`/total_payment_amount/next_payment_amount — dejar como caché explícita documentada; derivar requiere validar performance del motor de cupo y el uso por cobranza.
- `current_available_amount`: confirmar si es snapshot o lectura viva antes de decidir.
- Escape-hatches json (`additional_data`, `datacredito_trigger`, `data_json`): documentar el plan de tipado; mantener el blob como traza hasta migrar sus claves.

**Cifra a comunicar (conservadora):** ~95-110 columnas conceptuales y ~13-16 entidades reducibles en el deber-ser, de las cuales **~40-50 columnas y ~8-10 entidades son de bajo riesgo y ejecutables ya**; el resto queda documentado para la migración física, preservando en todos los casos el mapeo `legacy` y los datos regulatorios/snapshots intactos.