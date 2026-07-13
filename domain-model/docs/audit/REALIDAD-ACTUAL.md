# Cómo funciona Creditop HOY — realidad de los repos vs. el deber-ser

**Fecha:** 2026-06-03 · **Fuentes:** exploración multi-agente de `github/legacy-backend`, `bitbucket/application`, el harness de validación (+ sus `docs/`, hoy consolidados en `playground/backend-e2e` y `playground/docs/`), cruzada contra la BD local y el modelo deber-ser. Complementa `ALINEAMIENTO.md` (que cubre estructura tabla↔entidad); este doc cubre **flujos y comportamiento**.

---

## 1. Mapa de repos y arquitectura real

| Repo | Qué es realmente | Rol |
|---|---|---|
| **`bitbucket/application`** | **El monolito Laravel 10** (Inertia+Vue, Spatie, Fortify, Sanctum). 313 migraciones, 159 modelos → **dueño del esquema `creditop`**. 4 subdominios sobre el mismo host: `admin.` (back-office), `aliados.` (onboarding cliente + Creditop X + comercial), `perfil.` (autogestión móvil), `api.` | Monolito + dueño del schema |
| **`github/legacy-backend`** | Laravel **modular** (Modules/: Identity, Loans, Onboarding, Partner, Payments, Risk, System). API de originación. *El nombre engaña: es el más nuevo/modular.* | API de originación (en migración) |
| **`playground/backend-e2e`** | Harness Go que **valida la realidad** de la originación contra API+BD (flujos + `prep`/`get`/`doctor`). El conocimiento validado vive en `playground/docs/` y `domain-model/docs/`. *(Consolidó al extinto `creditop-cli`.)* | Validación / investigación |

**Frontera (clave):** `application` y `legacy-backend` **comparten la BD `creditop`** *y además* se llaman por **HTTP interno** (`INTERNAL_LEGACY_API_URL`). El flujo de loan-application está **a medio migrar** desde `legacy-backend` hacia `application`, con bypass condicional por comercio (`allied.hash` ∈ `allowed_comerces`) y un `// todo: remove the legacy methods when all tests pass`. Ambos escriben `user_requests` en la misma base.

> ⚠️ **Dos bases en dev, IDs distintos.** `legacy-backend` (Sail local) y `application` (RDS `inertia-dev…`) son bases separadas con IDs que **no coinciden**. Nuestra **copia local** (`legacy-backend-mysql-1`) se llenó desde el **dump de `inertia-dev`** → contiene los **IDs de la RDS de `application`** (p.ej. Corbeta 209/210/211, lender 153/158). No mezclar IDs entre fuentes.

---

## 2. Flujo real de originación (end-to-end)

```
Comercial (#4) inicia venta
  → register celular → OTP → personal-info → laboral-info        [Onboarding]
  → KYC / identidad (CrossCore, Evidente, TusDatos, Rekognition) [Identity]
  → riesgo/buró/scoring  (motor SQL: SPs/FNs — ver §3)           [Risk]
  → marketplace: lenders elegibles                                [reglas: comercio AND lender]
  → seleccionar entidad → cierre bifurcado por response_type      [5 patrones — ver §4]
  → estados: originación 1→2→9→3, decisión 10→11; converge en 11 (Autorizada/Desembolsada)
```

- **Quién origina:** el rol **Comercial (#4)** (no "Admin comercio"). Comercial vende → Admin/Superadmin comercio administran → back-office autoriza por estado.
- **Marketplace = config del comercio:** cada comercio define qué lenders ofrece (`lenders_by_allieds`, 990 asociaciones / 230 comercios) y por sucursal (`lenders_by_allied_branches`).
- **3ª capa (`lender_allied_credentials`) es GATE EFFECTIVO, opcional pero crítico:** "ofrecido en `lenders_by_allieds`" ≠ "evaluable por el motor". 18 lenders activos tienen ≥3 allieds que los OFRECEN sin tener la credencial (Credifamilia-addi #6 lidera con 136 allieds sin credencial; Bancolombia #68/#100 con 5/8). En esos casos el motor del lender no asigna el producto (validado en `backend-e2e::bancolombiaClose` → motor PLS no evalúa sin credencial; el harness siembra una vía `ensureBancolombiaCreds` copiándola de otro allied). Implicancia: el modelo debe leer la relación como **0..1**, no 1..1. Detalle cuantitativo en `ALINEAMIENTO.md §7.1`.
- **Elegibilidad = 2 capas en AND:** (A) reglas del comercio/sucursal (`group_rules` por `allied_branch_id` + `lender_rules`); (B) reglas intrínsecas del lender (`lender_users_category_rules`, `lender_datacredito_rules`, `lender_guarantee_criteria`, familia `creditop_x_*`). El cliente debe pasar ambas y caer en una `lender_users_category`.
- **Motor de elegibilidad (legacy-backend):** `GET onboarding/.../lenders/{ur}` → `LenderListingService` / `LenderValidationService` + `LenderRuleEvaluator` (`Modules/Loans/App/Services/LenderRuleEvaluator.php`) + `RiskCentralValidationService`.
- **28 filas en `user_request_statuses`** (el CLI cuenta 27 activos; el estado legacy 5 está inactivo; sin seeder, vienen del dump). Post-desembolso (facturación 25 / paz y salvo 26→27) se dispara por back-office/jobs, **no por endpoints REST**.

---

## 3. El motor de scoring/buró vive en SQL (no en el dominio)

**26 vistas + 42 rutinas** en la BD son un **segundo motor**, separado del PHP. Lo crítico:

- **`SP_Update_User_Request_Risk_Centrals`** — consolida la última consulta de cada central por día/usuario en `user_request_risk_central_user_data`. **No se llama desde ningún PHP** (corre fuera de banda: scheduler/cron/manual). Tiene **6 bloques copy-paste con `risk_central_id` quemado**: `IN (1,9)`=Experian/Acierta, `2`=TusDatos-ID, `3`=AgilData, `4`=TusDatos-AML, `5`=Ado, `6`=Mareigua. **Cero noción de país.**
- **`SP_Experian_Extract_Data(id, decrypt_key)`** — desencripta el JSON de buró y extrae ~30 campos con **json_paths literales** (`$.models[0].scoreValue`, `$.agregatedInfo.overview…`).
- **`FN_User_Income_Average` / `_Continuity` / `_Occupation`** — **waterfall cableado** AgilData → Mareigua → form values, con paths embebidos e `IF/ELSE` anidados.
- **`SP_CreditopX_Revolving_Credit` + `FN_CreditopX_Revolving_Credit(_Multiplier)`** — calcula el cupo rotativo (ingreso, gasto fijo, capacidad de pago). Núcleo del aparato Creditop X.
- **`FN_Decrypt_Data`** — **clave AES hardcodeada** → deuda de seguridad crítica (debería ir a KMS).
- Plataformas gig **AgilData / Mareigua** (cálculo de ingreso para informales) y **TusDatos / Experian-Acierta** son centrales reales; el ruteo a cada una está quemado en el SP.

**Invocado desde:** `Modules/Risk/.../{ProfilingReviewController,ProfilerMLController,MatrixModelController}.php`, `Modules/Onboarding/App/Services/ExperianProfileService.php`, `app/Actions/Lenders/Prami.php`.

---

## 4. Cierre por lender: híbrido data + hardcode

- **Como dato:** `lenders.action` = FQCN de la clase Action (p.ej. `App\Actions\Lenders\Payvalida`). Se instancia dinámicamente (`new $lender->action()`). **Pero solo 16/153 lenders** tienen `action` poblada.
- **Como hardcode (contradice "cierre como dato"):**
  - `UserRequestService::updateUserRequest` (`legacy-backend`): `switch($lender->response_type)` (data) **anidando** `switch($lender->id){ case 24 Credifamilia… case 23 Welli… }` + `if(credential type)` + `switch($lender->name){ Compensar, Sistecrédito, Meddipay }`.
  - `ValidateOtpController::validateLenderOtp`: `switch($lender->name){ Compensar→status 11…; Sistecrédito→status 11… }` extrae campos de la respuesta **a mano por lender**.
  - **STATUS_MAP cableado en cada clase** (`app/Actions/Lenders/BancoDeBogota.php:264`: `switch($apiResponse['Status']){ 'Disbursed'→11, 'Failed'→7… }`; `Welli.php:29` `const STATUS_MAP`). La tabla `lender_transaction_statuses` solo guarda **nombres** de estado por lender, no la traducción externo→interno.
- **20 archivos en `app/Actions/Lenders/`** (Integration base + OtpValidation helper + ~18 lenders) (Addi, Approbe, BancoDeBogota(+CeroPay), Bancolombia(+Bnpl/ConsumerLoan), Compensar, Credifamilia(+Consumo), Meddipay, Payvalida, Prami, Sistecredito(+Pay/Pos), Welli, Wompi…), todas extienden `Integration` (abstract `register()`), pero con **interfaces no uniformes**.
- **`LenderServiceFactory`** (patrón type-safe moderno) está **a medio migrar**: solo `WelliService` lo implementa; el resto cae al fallback `LegacyLenderService`.

**Taxonomía de lenders por `response_type` (CLI, eje 4):** 148 activos — rt=0 **46** (UTM, redirect sin cierre), rt=1 **16** (12 con Action class), rt=2 **74** (Creditop X), rt=3 **12** (cupo rotativo). 5 patrones de cierre validados con test: A (CX in-platform→11), B (Credifamilia polling→41), C (Sistecrédito/Payvalida/Approbe webhook→11), D (Welli job→11), A-like (Compensar OTP→11).

---

## 5. Reglas de elegibilidad: duplicación masiva confirmada

`lender_rules`: **~38.000 filas, 142 lenders, pero solo 63 triples `(column,operator,value)` distintos (solo 2 columns literales: age, gender; el resto por field_id).** La condición se **copia físicamente por lender**:

| Predicado | operador | value | lenders | filas |
|---|---|---|---|---|
| edad mínima | `>=` | 18 | **80** | 3.947 |
| ocupación (field 29) | `=` / ` =` | Empleado\|Pensionado\|Independiente | **141** (situación laboral) | 7.064 |
| ingresos mensuales (field 87) | `>=` | 1300000 | 63 | 3.398 |
| edad máxima | `<=` | 69 | 63 | 1.562 |

Las cifras del modelo deber-ser ("edad en 79 lenders", "ocupación en 140") **coinciden con la realidad** (80, 141). Hay **drift de dato** que delata la copia manual: operador `=` vs ` =` (con espacio → el evaluator hace `trim()`), y mismo predicado con orden de valores distinto. `RuleDefinition` (canónica) está **empíricamente justificada**. Evaluación: `LenderRuleEvaluator` resuelve el valor por `field_id`→`user_field_values` y aplica `match(operator)`; cualquier regla fallida ⇒ rechazo.

---

## 6. Roles / permisos: RBAC dual sin sincronizar

- **Dos tablas gemelas:** `roles` (13) y `user_profiles` (12), sembradas a mano para que el **id coincida** (1=Cliente, 2=Admin, 3=Operaciones, 4=Comercial, 5=Entidad, 6=Superadmin comercio, 7=Admin comercio, 8=Mesa servicio, 9=Tesorería, 10=Contabilidad, 11=Analista, 12=Logística; `roles` tiene un extra 13=Entidad Comercio).
- **El 1:1 está roto en datos:** ~219k clientes con `user_profile_id=1` **sin rol Spatie** asignado. El **perfil** manda para identidad; los **roles Spatie** solo gatean permisos de back-office y están parcialmente poblados.
- **5 roles de back-office = mismos 4 permisos**, se diferencian por **el estado que autorizan** (analista 16 / tesorería 13 / contabilidad 14 / mesa 15). `status_per_profiles` (allied×perfil×estado) es lo más cercano a "qué etapa ve cada perfil".
- **Mecanismo real:** Spatie `HasRoles` + permisos-string (`'view users'`, `'edit lender rules'`…) compartidos al front Inertia (`auth.allPermissionsNames`) y gateados en Vue. **No existe `autorizar:{etapa}`**; varias rutas admin **no tienen gate de servidor** (solo front) → revalidar en backend es deuda.

---

## 7. Flujos especiales (ramifican por documento / comercio / lender) — NO modelados

Verificados por el CLI (`flujos-especiales.md`), **ausentes en el deber-ser**:

| Flujo | Trigger | Qué lo hace especial |
|---|---|---|
| **PEP (migrantes)** | `document_type==='PEP'` | Bypassa centrales + scoring ML; inyecta laboral dummy (Empleado, $1.5M); ingreso real luego vía **Abaco** |
| **Motai** (#158, renting CX) | `isMotaiRenting` | Comparte bypass PEP; requiere Abaco; modos del comercio |
| **Corbeta** (Alkosto 209 / K-TRONIX 210 / Alkomprar 211) | `in_array(alliedId,[209,210,211])` | Mapeo propio de tipos de doc; código de compra POS Corbeta; forzado de monto |
| **Pullman** (Amoblando #94) | `allied_id==94` | Reconsulta siempre; Experian `aciertaQuanto` (no `quanto`); conexión `pullman_db` propia (en `application`) |
| **DENTIX** (#189) | `allied_id==189` | Bloque Experian con `quanto` |
| **Smartpay** | data-driven | Subsistema `DynamicForms*` (formulario configurable por comercio/modo) |
| **Magnocréditos** (#84) | CE → categoría fija 22 | Excepción de elegibilidad por documento |

---

## 8. Qué le falta al modelo deber-ser (candidatos a próximos cambios)

1. **Flujos especiales (§7)** — ninguno está representado (PEP solo como `bypass_centrales` derivable; falta el proceso: bypass + laboral dummy + Abaco). Conviene un mecanismo de "override/excepción por comercio/documento".
2. **El motor de scoring en SQL (§3)** — las 26 vistas + 42 rutinas (waterfall AgilData/Mareigua, consolidación de centrales por día, cupo rotativo CX) casi no están modeladas. Solo hay una nota en `preguntasAbiertas`.
3. **`CreditopCash`** — Action class nueva detectada, sin entrada en el modelo.
4. **Seed vs real en `lender_users_categories`** — el seed local es una versión vieja/simplificada (≠ loan_limit/FGA/max_amount reales). Documentarlo.
5. **Frontera application↔legacy-backend** — el modelo asume un solo dueño de la originación; la realidad es BD compartida + HTTP interno + migración a medias.

> Bien cubierto/alineado ya: hallazgos de BD (canales N:M, Role≡UserProfile, `multiple_allieds`→CustomerMerchant, KYC per-lender), los 5+1 patrones de cierre, los 27 estados, la clave AES de `FN_Decrypt_Data`, y el sesgo mono-país a burós colombianos (en `preguntasAbiertas`).

---

## 9. Incompleto / deuda / abierto (para no re-descubrir)

- **`SP_Update_User_Request_Risk_Centrals` sin invocador PHP** → depende de scheduler externo; riesgo de buró desactualizado por solicitud.
- **`LenderServiceFactory` a medio migrar** (solo Welli); `switch` hardcodeados coexisten.
- **`selfManager`** definido en 6 Actions pero **sin endpoint que lo invoque** (cierre manual planeado).
- **BancoDeBogota (#5)** E2E no reproducido en local (rama por flags de credencial `bancolombia_type`/`wompi_method`).
- **rt=0 (~46 lenders UTM)** sin cierre de integración — no validados.
- **Bugs reales del backend** detectados por el CLI **no portados a PR** (tocan prod → esperan visto bueno humano): `front_url` JSON, `catch(\Exception)`→`\Throwable` en webhooks, 3 rutas de webhook sin registrar (Sistecrédito, Payvalida, Approbe), SQLSTATE/`error()`.
- **Emails de error hardcodeados** (`santiago@creditop.com`, `laura.cabra@creditop.com`) en el cierre OTP.
- **Números de estado mágicos** (1,3,6,8,9,11,21…) dispersos sin enum central.
- **`OnboardingController`** con métodos `*Orchestrator` duplicados junto a los no-orchestrator → refactor a medias / posible código muerto.

### Nuevos (validación E2E jun 2026 — ver `ALINEAMIENTO.md §7`)

- **`lender_allied_credentials` gap sistémico:** 18 lenders activos tienen allieds que los ofrecen
  sin credencial (Credifamilia-addi #6 con 136; Bancolombia #68/#100 con 5/8). El motor del lender
  no evalúa sin credencial → el lender "ofrecido" en `lenders_by_allieds` no llega al cliente. Es
  un gap de **config**, no de código (no hay fallback documentado). El harness `backend-e2e`
  siembra la credencial faltante para Bancolombia con `ensureBancolombiaCreds`.
- **`ONB030 + "internal server error"`:** error_code NO documentado antes — emitido por Experian
  fake con escenarios `server-error`/`timeout`/`no-hit`. Distinto de ONB005 (KYC validación). Ya
  en `docs/REFERENCIA-FLUJOS.md §13`.
- **Shape de errores heterogéneo en el backend:** 4 formas distintas (concatenado al `error_code`,
  separado anidado en `errors.*`, `error.code` en KYC, `message` libre). Aserts del harness usan
  helper tolerante (`pkg/error-shape.ts::bodyContains`); detalle en `REFERENCIA-FLUJOS §13`.
- **`user_request_id` viaja en `errors.payload`** cuando OTP devuelve `ONB002` (success:false con
  payload útil = "ir a /personal-info"). No es error: es contrato. Tropezó el helper del spec
  hasta que se ajustó.
- **Pullman/Dentix usan Experian Quanto, NO TusDatos:** los escenarios fake `tusdatos.*`
  (`issue-date-mismatch`, etc.) **no aplican** al partner default `3e67eade` (Pullman, allied 94).
  Para gatillar TusDatos hace falta un partner estándar (no Pullman/Corbeta/Motai/Ecommerce). Esto
  está cubierto en §7 (Pullman/Dentix como flujos especiales) pero conviene mencionar la
  consecuencia: **las pruebas KYC con TusDatos requieren elegir partner**.
