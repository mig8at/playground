# Validación de la inversión — ¿los lenders/comercios/países se adaptan a Creditop?

## Veredicto global

**PARCIAL — la inversión está ganada en el "quién ejecuta" y en la "elegibilidad", pero perdida en el "qué/cuándo/cómo se decide" y en el "multi-país".**

- **Lo que SÍ se invirtió (es DATA):** la *persistencia* y los *puertos* polimórficos. `BureauInquiry` + catálogo `RiskBureau` + `RiskBureauCredential` guardan la respuesta de cualquier central como fila; `LenderTransaction` con `ProviderType` colapsó 4 tablas casi-duplicadas en una raíz; `RuleDefinition` + bindings (`EligibilityRule`/`MerchantRuleBinding`) hacen la elegibilidad declarativa; `OnboardingForm`/`FormField`/`FormFieldPlacement` hacen la estructura del onboarding configurable; `Provider`/`ProviderType` unifican los 6 ejecutores KYC. Agregar un proveedor o una cláusula de elegibilidad ya es config.

- **Lo que NO se invirtió (sigue siendo CÓDIGO):** la **orquestación de decisión**. No existe `VerificationPolicy`; qué centrales consultar vive en `SP_Update_User_Request_Risk_Centrals` como 6 bloques `INSERT` por `risk_central_id`. El patrón de cierre de cada lender vive en clases `Action` por nombre (`Welli.php`, `Credifamilia.php`, `Sistecredito…`) con `switch(lender_id)`. El scoring/profiling vive en funciones SQL quemadas a Experian/AgilData/Mareigua por nombre y JSON-path.

- **La prueba de fuego falla hoy:** agregar **un país, un bureau o un lender de integración nuevo SIGUE siendo editar SQL/PHP**, no insertar filas. `bypass_centrales` es el síntoma de libro, no un caso aislado.

- **El eje país no llegó al motor de decisión:** `CreditPolicy`, `CategoryEligibilityCriteria`, `ScoringPolicy`, `OnboardingForm` cuelgan solo de `lender_id`. No hay `country_id` en el scoping de reglas, ni registro de proveedores por país, ni política de verificación por país. Además persiste la deuda `country_id=1` (Afganistán como default real de la operación colombiana).

- **Anti-patrones "tabla/columna por integración" residuales:** `BureauSummary` mantiene una columna literal por proveedor (`agildata`, `mareigua`, `tusdatos`, `datacredito`, `quanto`, `abaco`) → un bureau nuevo es `ALTER TABLE`. Y `IdentityVerification` aún lista `jumioVerification`/`crosscoreEvaluation`/`signingDocument` como entidades-miembro tipadas, reintroduciendo "una tabla por integración".

## Tabla de veredictos por área

| Área | Veredicto | Lo más importante |
|---|---|---|
| Verificación de identidad / KYC multi-país | Parcial | El ejecutor es genérico (`Provider`), pero la orquestación (qué pasos/centrales) sigue en `SP_Update_User_Request_Risk_Centrals` y en `bypass_centrales`. Falta `VerificationPolicy`. |
| Centrales de riesgo / buró multi-país | Parcial | `BureauInquiry` ya es genérico para almacenar; pero NO hay política de *a quién consultar por país+doc*, `BureauSummary` tiene columna-por-proveedor, y VOs queman "Datacredito". |
| Reglas de elegibilidad y scoring | Parcial | Elegibilidad invertida (`RuleDefinition`); scoring NO: `CategoryEligibilityCriteria` con 20+ columnas, `ScoringPolicy.variable` string, motor SQL atado a centrales CO. Sin eje país. |
| Integraciones y patrones de cierre | Parcial | `LenderTransaction` colapsó las tablas, pero el patrón de cierre vive en clases `Action` + `case lender_id == N`; webhooks registrados a mano. |
| Configuración por país | Parcial | `Country.is_operating`, `DocumentType` por país y `Money` son reales; pero `CountrySetting`/`HolidayCalendar` son notas de VO sin esquema, sin `VerificationPolicy`, motor SQL quema `field_id`/festivos. |
| Comportamiento por comercio/lender | Parcial | Elegibilidad y términos comerciales sí (`RuleDefinition` + `LenderTerms` + `lenders_by_allieds`); comportamiento de integración no (clases `Action`); comercio como bolsa de flags. |
| Formularios dinámicos / onboarding | Parcial | Estructura configurable por dato; pero sin scope país, `validation`/`data_source` texto opaco, y el motor SQL referencia `field_id=87`/`29` hardcodeados. |

## Patrones de generalización a adoptar

Cinco mecanismos transversales resuelven la mayoría de los 41 leaks. Ordenados por impacto.

### 1. `VerificationPolicy` declarativa (clave compuesta + pasos como filas)
**Qué es:** entidad de primera clase con clave `(country_id, lender_id NULLABLE, document_type_id NULLABLE)` y una colección ordenada de `VerificationStep { step_kind ∈ (bureau, aml/restrictive_list, facial_match, doc_verification, ocr, e_signature), required ∈ (mandatory|skip|optional), provider_kind, on_fail ∈ (block|skip|manual) }`. Resolución por especificidad: país base < override lender < override doc_type.
**Resuelve:** `bypass_centrales` (todos los leaks que lo citan), los flags `Lender.requires_restrictive_list_check` y `Lender.signing_provider_id`, `LenderValidationRequirement` (pasa a ser `scope=lender` de esta política), y `Customer.validated`/`manual_validation` (se derivan del cumplimiento + se persiste `verification_policy_version`).

### 2. Registro de proveedores por país (`CountryProviderBinding` + `BureauProvider`)
**Qué es:** promover `RiskBureau` (hoy VO `{name}`) a entidad `BureauProvider { slug, name, country_id (o N:M), kind ∈ (credit_score, antifraud, pep_aml, identity), capability }` — espejo del VO `Provider {slug, kind}` ya validado en KYC. Añadir `CountryProviderBinding (country_id, provider_slug, provider_kind, credential_ref, priority, status)`. La `VerificationPolicy` referencia el `provider_kind` (capability), y el binding resuelve qué proveedor real sirve esa capability en ese país.
**Resuelve:** "no existe registro de proveedores por país", el ruteo quemado `risk_central_id IN (1,8,9)`, el motor SQL que pregunta a `DATACREDITO` por nombre, y desbloquea el multi-país (agregar país = poblar bindings + policy).

### 3. `CountryBureauPolicy` + `BureauFieldMapping` (decisión y extracción como dato)
**Qué es:** filas `(country_id, risk_bureau_id, enabled, dedup_window, min_score_required)` que el motor itera vía `INSERT…SELECT` con JOIN, en vez de N bloques copy-paste; y un mapeo de extracción declarativo `BureauFieldMapping (provider_slug, capability → json_path)` (p.ej. `score=$.models[0].scoreValue`, `income=$.average_income`).
**Resuelve:** los 6 bloques de `SP_Update_User_Request_Risk_Centrals`, las `FN_User_Income_Average/Continuity/Occupation` con buros fijos, y los `CASE WHEN risk_central_id IN (…)` con JSON-path por central. Agregar bureau = filas, no editar SQL.

### 4. `LenderAdapter` resuelto por `ClosingPattern` (capability + status mapping como dato)
**Qué es:** VO catálogo `ClosingPattern (A_in_platform|A_like_otp|B_polling|C_webhook|D_job|autogestion|utm)` + `Lender.closing_pattern_id` + `Lender.adapter_slug`. Un `IntegrationContract` por lender con `{ endpoints[], auth_kind, checksum_kind, status_map }`. El `status_map` se materializa como `LenderStatusMapping (lender_id, external_status, internal_status_id)` — espejo del `LenderErrorCode` ya aceptado para errores. Endpoint genérico `/integrations/{lender_slug}/webhook` + `LenderCallback (url_pattern, verify_strategy)`.
**Resuelve:** el `switch(lender_id)` y las >11 clases `Action`, las rutas de webhook registradas a mano (los bugs `RouteNotFoundException` de Sistecredito/Payvalida/Approbe), los `STATUS_MAP` por proveedor, `self_management` boolean, y el enum `ProviderType` que quema `payvalida`/`sistecredito` (pasan a ser instancias de `external_lender`).

### 5. `Capability`/`SemanticRole` como dato + `Setting` key/value por scope
**Qué es:** (a) `FormField.semantic_role` (catálogo: `INCOME`, `OCCUPATION`, `NATIONAL_ID`…) para que el motor consulte POR ROL, no por `field_id`. (b) `CategoryEligibilityCriteria` y las 6 políticas de scoring colapsan a bindings de `RuleDefinition`/`ScoringClause {variable_code → catálogo ProfilingVariable}`. (c) `CountrySetting`/`MerchantSetting/MerchantCapability` materializadas como `(scope_id, key, value, value_type, status)`. (d) `country_id` como segundo eje de scoping en `CreditPolicy`/`OnboardingForm`/`FieldOption`.
**Resuelve:** `field_id=87/29` hardcodeado, las 20+ columnas de `CategoryEligibilityCriteria`, `ScoringPolicy.variable` string, la bolsa de flags del `Merchant` (`has_ctopx`, `flow_type`, `barcode_type`), `CountrySetting`/`HolidayCalendar` sin esquema, el `additional_data` json sin esquema, y la ausencia de scope país en formularios.

## Leaks priorizados

| Prioridad | Área | Dónde | Problema | Generalización propuesta |
|---|---|---|---|---|
| P0 | KYC | `SP_Update_User_Request_Risk_Centrals` (L2469-2616) | 6 bloques `INSERT` copy-paste por `risk_central_id`; sin eje país. Prueba de fuego fallada. | `CountryBureauPolicy` + `INSERT…SELECT` con JOIN (Patrón 3) |
| P0 | KYC | `DocumentType.bypass_centrales` (L6360) | Booleano que colapsa política multidimensional en sí/no; no escala por país/paso. | `VerificationPolicy` (Patrón 1) |
| P0 | Integraciones | `Lender` sin `closing_pattern`; `switch(lender_id)` + clases `Action` | El patrón de cierre es código; agregar lender = clase PHP nueva. | `ClosingPattern` + `LenderAdapter` (Patrón 4) |
| P0 | País | Ausencia de `VerificationPolicy`; motor SQL `DATACREDITO`, `field_id=87/29` | KYC multi-país sin punto de extensión; `Provider`/`RiskBureau` sin `country_id`. | `CountryProviderBinding` + `BureauProvider` (Patrón 2) |
| P0 | Centrales | `BureauSummary` (user_summaries) columnas `agildata`…`abaco` | Una columna por proveedor; bureau nuevo = `ALTER TABLE`. | Derivar de `BureauInquiry`/`BureauResponse` por fila (Patrón 2/3) |
| P0 | Scoring | `FN_CreditopX_Profiling_Multiplier_Risk`, `FN_User_*` | JSON-path Experian quemado; `RiskMultiplierVariable.name='EXPERIAN_SCORE'`. | `BureauFieldMapping` + `ProfilingVariable` canónica (Patrón 3) |
| P0 | Scoring | `CategoryEligibilityCriteria` (20+ columnas) | Contradice `RuleDefinition`; criterio nuevo = `ALTER TABLE`. | Bindings de `RuleDefinition` con `scope=category` (Patrón 5) |
| P0 | Scoring | `CreditPolicy`/`ScoringPolicy`/`CategoryEligibilityCriteria` solo `lender_id` | Sin eje país; un lender = un país de facto. | `country_id` en `CreditPolicy`/`PolicyVersion` (Patrón 5) |
| P0 | Integraciones | `routes/api.php`: webhooks sin registrar (Sistecredito/Payvalida/Approbe) | Ruta por integración a mano → `RouteNotFoundException` en prod. | Endpoint genérico + `LenderCallback` (Patrón 4) |
| P0 | País | `HolidayCalendar` desconectado; motor usa `DATE_ADD(INTERVAL n day)` | Calendario decorativo; mora ignora días hábiles → se corre en MX/PE. | Entity `HolidayCalendar (country_id, date)` + `next_business_day()` |
| P0 | Formularios | `VW_User_Field_Values_Resume`, `FN_User_*`: `field_id=87/29` | Significado de campo atado a id mágico; país nuevo no entra al scoring. | `FormField.semantic_role` + consulta por rol (Patrón 5) |
| P0 | Formularios | `OnboardingForm`/`FormField` sin `country_id` | Onboarding solo por lender; país nuevo sin punto de anclaje. | `country_id` nullable + `form_applicability` (Patrón 5) |
| P0 | Comercio | `Lender.response_type`/`path_id` + `LenderIntegrationFlow` (solo traza) | El flujo es discriminador + clase Action; no describe el flujo. | `IntegrationContract` + `LenderStatusMapping` (Patrón 4) |
| P1 | KYC | `Lender.requires_restrictive_list_check`, `signing_provider_id` | Flags/FK escalar deciden pasos KYC fuera de política. | `VerificationStep` en `VerificationPolicy` (Patrón 1) |
| P1 | KYC | `identityVerification`: `jumioVerification`/`crosscoreEvaluation`/`signingDocument` | Entidades-miembro por proveedor → "una tabla por integración". | Colapsar a `evidence (json)` gobernado por `Provider` |
| P1 | Centrales | `DatacreditoScoreRule`, `FrecuenciaDataCredito`, `DatacreditoQueryCounter` | Nombre "Datacredito" quemado en el concepto genérico. | `BureauScoreRule {bureau_provider_id, thresholds}` etc. (Patrón 2) |
| P1 | Integraciones | `Welli::STATUS_MAP`, mapeos en `Credifamilia`/`Sistecredito`/`Compensar` | Estado externo→interno en código por lender. | `LenderStatusMapping` (espejo de `LenderErrorCode`) (Patrón 4) |
| P1 | Integraciones | VO `ProviderType` (`own_lender|payvalida|sistecredito|…`) | Lenders concretos elevados a tipo del puerto. | `kind` genérico + `Lender.slug`/`closing_pattern` (Patrón 4) |
| P1 | Scoring | `ScoringPolicy.variable` varchar + 6 políticas dispersas | `variable` string sin catálogo; misma forma en 6 tablas. | `ScoringClause` canónico + `ProfilingVariable` (Patrón 5) |
| P1 | Comercio | `Merchant`: `has_ctopx`, `flow_type(int)`, `barcode_type`, `show_profiling`… | ~10 flags mezclan capability/UI/modo; capacidad nueva = columna. | `MerchantCapability/Setting`; `has_ctopx` → fila en `lenders_by_allieds` (Patrón 5) |
| P1 | País | `CountrySetting` nota de VO sin esquema | Setting nuevo por país no tiene dónde aterrizar → vuelve a código. | Materializar `(country_id, key, value, value_type, status)` (Patrón 5) |
| P1 | País | Deuda `country_id=1` (Afganistán) con 181 comercios/207k users | Operación cuelga de id no real → policies por país sobre datos inconsistentes. | Migrar 1→47, `is_operating` solo en 47, FK + check |
| P2 | Integraciones | `selfManager()` sin cablear; `LoanApplication.self_management` bool | Capability sin invocación; boolean rígido. | `closing_pattern=autogestion` + transición declarada (Patrón 4) |
| P2 | Comercio | `Lender.additional_data` (json), `pdf_mapper_project_slug`, `validation_type(int)` | Escape hatches sin esquema ocultan config quemada por lender. | Tipar contra `IntegrationContract`; `validation_type`→`IdentityValidationType`; `pdf_mapper`→`DocumentTemplate` |
| P2 | Formularios | `FormField.validation`/`data_source`/`type` varchar libre | Strings opacos interpretados por código; validación no declarativa. | `ValidationSpec`/`DataSourceRef` + catálogo `validation_rules(key, kind, params, country_id)` |
| P2 | Formularios | `FieldOption` sin scope país/locale | Opciones globales → país nuevo fragmenta en `FormField` distinto. | `country_id` nullable en `FieldOption` o resolver por `data_source` (Patrón 5) |
| P2 | Formularios | `FieldAnswer` `value text` + `CAST(... AS decimal)` quemado | Sin locale/moneda; CAST asume formato CO → rompe en DOP. | Parseo por `ValidationSpec` + `Country.locale/currency` |
| P2 | País | `Country.currency/locale` varchar sin reglas de formato | Sin decimales/redondeo; COP=0 dec, otras=2. | `currency_decimals`/`rounding_mode` leídos por VO `Money` |
| P3 | KYC | `Customer.validated`/`manual_validation` booleanos | Resultado sin referencia a qué política/versión se cumplió. | Derivar de `VerificationPolicy` + persistir versión (Patrón 1) |
| P3 | País | `users.is_new_document_format` flag de migración | Mezcla estado de migración con regla de formato. | Derivar de `DocumentType.format`; flag con fecha de retiro |
| P3 | Formularios | `UserFieldRule` acoplada por `field_id` | Scoring por campo atado a id físico CO. | Apoyar en `semantic_role` (Patrón 5) |

## Caso `bypass_centrales` — resolución concreta recomendada

**Veredicto: el dueño tiene razón — está mal como booleano.** Es el síntoma de la enfermedad (ausencia de `VerificationPolicy`), no un caso aislado. Un `tinyint(1)` por `DocumentType` solo sabe decir "todo o nada", no puede expresar que un PEP migrante *salte el bureau de crédito pero SÍ corra AML/listas restrictivas y match facial*, ni que la regla cambie por país. Cada excepción regulatoria futura ("PA en Perú salta bureau pero no antifraude") obligaría a otra columna booleana.

**Resolución:**
1. Crear `VerificationPolicy` con clave `(country_id, document_type_id, lender_id NULLABLE)` y colección ordenada de `VerificationStep { step_kind, required ∈ (mandatory|skip|optional), provider_kind, on_fail }`.
2. **`bypass_centrales` desaparece como columna.** El caso "migrante PEP en Colombia" se vuelve una fila de política para `(CO, PEP)` con:
   - `step_kind=bureau, required=skip`
   - `step_kind=aml/restrictive_list, required=mandatory`
   - `step_kind=facial_match, required=mandatory` (si aplica)
3. La migración es trivial: 1 fila de política por cada `DocumentType` actual; donde hoy `bypass_centrales=1`, el step `bureau` queda en `skip`.
4. Resultado: agregar "PEP que SÍ requiere facial" o "extranjero sin historial en Perú" = **insertar filas, cero columnas/`if` nuevos.**

## Multi-país KYC — cómo debe quedar

**Principio: mismo proceso conceptual, proveedores/entidades/servicios por país resueltos como dato.** El motor nunca pregunta a "DATACREDITO"; pregunta por una *capability* ("el bureau de crédito del país X") y el registro resuelve el proveedor real.

**Modelo objetivo (sin entidad nueva por combinación):**

1. **Capabilities, no proveedores concretos:** la `VerificationPolicy` referencia `provider_kind`/capability (`bureau`, `pep_aml`, `identity`, `facial_match`, `e_signature`), nunca un slug específico.

2. **`CountryProviderBinding (country_id, provider_kind, provider_slug, credential_ref, priority, status)`:** resuelve qué proveedor real sirve cada capability en cada país. Espejo del VO `Provider {slug, kind}` ya validado. Agregar país = poblar bindings, no crear tablas.

3. **`BureauProvider`** (promoviendo `RiskBureau`) con `country_id`/N:M y `kind`; `BureauFieldMapping (provider_slug, capability → json_path)` hace que el motor extraiga score/income/continuidad leyendo el mapping, no un `CASE WHEN risk_central_id IN (…)`.

4. **`CountryBureauPolicy`** itera filas en `SP_Update_User_Request_Risk_Centrals` (reducido a un `INSERT…SELECT` con JOIN), eliminando los 6 bloques.

5. **Calendario y formato por país como dato:** `HolidayCalendar (country_id, holiday_date)` consultado por `next_business_day(country_id, date)` en el motor de mora; `CountrySetting` key/value para `currency_decimals`, `rounding_mode`, `cell_phone_length`, `address_format`, husos.

6. **Scope país en formularios y reglas:** `country_id` en `OnboardingForm`/`CreditPolicy`; `FormField.semantic_role` para que el scoring lea por rol (`INCOME`), no por `field_id=87`.

7. **Prerrequisito ineludible:** sanear `country_id=1`→`47`; sin un país real consistente, ninguna policy por país es confiable.

**Prueba de fuego resultante:** dar de alta Perú = insertar filas en `BureauProvider`, `CountryProviderBinding`, `VerificationPolicy`, `CountryBureauPolicy`, `HolidayCalendar`, `CountrySetting` y `OnboardingForm(country_id=PE)`. **Cero código, cero tablas nuevas, cero `if id == N`.**