# Motai v2 · task
> **rama:** `feature/motai-v2` · **PR:** backend →develop · frontend →staging · **estado:** 🧪 en pruebas
>
> Des-motaizar la originación de Motai: sacar los ifs quemados (`isMotaiRenting` / lender `158` / modos) y moverlos a **configuración por columna en BD** (`lenders.product`/`calculator`, `lenders_by_allied_branches.document_types`, `allied_documents`), para que otra entidad renting/RTO entre por **filas de config**, no por deploy.

## Contextos que usa
- **motai** — el flujo Motai v1 tal como ES hoy (comercio `158`, in-platform rt=2, 3 productos, Ábaco informativo): el punto de partida que esta tarea lleva al deber-ser. No se repite su mecánica acá.
- **creditopx** — el destino: los productos pasan a ser **lenders CreditopX rt=2 por categoría**, hermanos de Pullman/SmartPay; el listado/categoría/cupo siguen corriendo por su cascada (`getLenders`).
- **merchants** — donde vive la config nueva: la calculadora por comercio (`lenders_by_allieds`), las columnas `product`/`calculator`, la ficha flaca del comercio y la copia de reglas por sucursal.
- **dynamic-forms** — `document_types` por sucursal habilita el tipo **PEP**; el salto de buró pasó a ser el bypass "por documento PEP", no por flag.
- **kyc** — el salto de buró (`skipBureau`) y la fuente de ingreso **Ábaco** (gig) que la política MVP2 exige cablear (hoy `average_income` se calcula y se descarta). El detalle de burós lo cede este nodo a **kyc**.

## Objetivo
Llevar Motai v1 al modelo único paramétrico (deber-ser del group Plataforma; motiva ~40M/mes de negocio nuevo del PRD MVP2). Es **el primer escalón ejecutado** del plan: un solo anti-patrón ("preguntar si es Motai por un id fijo") repetido en ~35 puntos de los dos repos, reemplazado por **categoría de producto + ficha por comercio**. El target (7 piezas):

1. **CATEGORÍA DE PRODUCTO** — los productos dejan de ser "modos" del comercio y pasan a ser **lenders CreditopX por categoría** (crédito / arrendamiento / arrendamiento-con-compra) elegidos en el marketplace; muere el disparador dual `isMotaiRenting` / `MOTAI_LENDER_IDS=[158]` y la pantalla `merchant-mode`.
2. **INGRESOS por CASCADA** de fuentes (App → **Ábaco**; No-App → AgilData/Mareigua/TusDatos) → **es la misma regla con otra fuente**, no código por perfil; persistir `average_income` de Ábaco (hoy huérfano) y cablearlo.
3. **CALCULADORA ÚNICA en backend** (hoy quemada y DUPLICADA en el front): renting `(monto + 1.500.000) · 2 · 1,19` y RTO (amortización semanal, cuota inicial editable).
4. **VIABILIDAD R1–R8 por CONFIG** en el motor de reglas que Motai HOY SALTEA (`RiskCentralValidationService` + `ProfilingRulesService`; `DatacreditoQueryByAlliedController.php:385` con `$lender_id=24` quemado) — reescritas como **claves estables** (`references.count_min=2`, `datacredito.query_required`, `datacredito.score_min=400`, `pricing.canon_weekly_min=150k`/`_max=300k`, `capacity.installment_to_weekly_income_max=25%`, `capacity.dti_monthly_max=40%`, `capacity.debt_to_networth_max<50%`).
5. **DECISIÓN por INGRESO** (PRD): ingreso ≥ $3M → aprobación directa; < $2.9M → codeudor obligatorio. La FUENTE no cambia la decisión (App = No-App).
6. **CODEUDOR** = pieza NUEVA (modelo + formulario + gate `cosigner.score_min>650`), solo si ingreso < $2.9M.
7. **PEP** (Permiso Especial de Permanencia, sin historial local): tipo de documento por config; consultar Datacrédito al 100% en thin-file = **decisión de negocio abierta** (C2/C3).

**Frontera de alcance.** El flujo termina en la **pantalla del asesor** (aprobar / validar codeudor / rechazar). Quedan **fuera**: firma/desembolso/cobranza post-aprobación (Estado 11, `PromissoryNote`, servicing en `application`), el **panel/rol del administrador** (workstream aparte; hoy la decisión la toma el **asesor** por `BackDoorUserController`→`BackDoorUserService.php:569-642` — `motaiUpdateStatusOrchestrator` hace `approve?11:9`, request `MotaiUpdateStatusRequest`, sin auth ni "validar codeudor"), el **motor de decisión** R1–R8 corriendo solo, y el **IMEI/device-lock** de compra de celulares (árbol separado, no se cruza).

## Ramas y PRs por repo
| Repo | Rama | Base | PR → | Estado |
|---|---|---|---|---|
| `legacy-backend` | `feature/motai-v2` | staging | **develop** (retargeteado) | pusheado |
| `frontend-monorepo` | `feature/motai-v2` | staging | **staging** (sin retargetear) | pusheado |
| `application` | — | — | — | sin cambios (§3.3: sin lógica Motai) |

**Commits nuestros — backend:** `936f0a7c` des-motaización · `32cd4203` TyC por comercio · `607fd2b0` recálculo liviano · `5013f4af` quitar columna `abaco` · `44eb3c02` merge develop (resolución del retarget) · `098322a8` fix `$hasCredifamilia` · `4022b6c9` fix ProfilerML. **Frontend:** `653e7939` · `15f3b3e9` · `6708ea5b`.
⚠ El diff del PR de backend vs develop muestra ~52 archivos: arrastra la divergencia staging↔develop (ruido heredado), **no todo es nuestro** — lo real son los commits de arriba. Los fixes `098322a8` (`$hasCredifamilia` indefinido) y `4022b6c9` (ProfilerML 500 sin `H2O_API_HOST`) son bugs pre-existentes de develop; el de `$hasCredifamilia` **también vive en develop → avisar al equipo**.
`application` no se toca (§3.3, verificado 2026-07-12): sin lógica Motai, solo copy de marketing (`resources/js/pages/customer/lenders/list/v2/ListLenders.vue:296,813,1225`) + 2 migraciones de esquema Ábaco (`2026_03_06_003223_add_abaco_settings_to_settings_table.php` · `2026_03_09_000000_add_abaco_column_to_user_summaries_table.php`) — schema del equipo de Ábaco, no des-motaización.

## Lo que se hizo
<!-- por frente: QUÉ · POR QUÉ · dónde vive (anclas verificadas 2026-07-12 vs staging) · CÓMO AJUSTAR -->

### 1 · Des-hardcode del disparador Motai (front + back)
**Qué.** Eliminado end-to-end (**0** referencias por grep en ambos repos): `isMotaiRenting`/`is_motai_renting`, `merchant_mode`/`merchantMode`, `MOTAI_LENDER_IDS`, e id `158` como **lógica**. **Por qué.** Era un flujo bifurcado: el flag viajaba en cada payload (teléfono/OTP/personal-info) y el back bypasseaba pasos mientras el front calculaba precio con fórmula quemada gateada por id.
**Dónde vivía (censo, posición pre-cambio):**
- Back: disparador dual `OnboardingController.php:1216`; rama bypass `:1217-1311` (fuerza `corbeta=false` `:1222`, salta userViability/Experian `:1279`, salta `validateRiskCentrals` `:1311`); whitelist del campo en OTP `ValidateOtpCodeRequest.php:36` + `SendOtpCodeRequest.php:40`; plumbing del flag por `RegisterCellPhoneService.php` / `UserService.php` / `OtpService.php:364,371`.
- Front: sobreescribe el monto `useLenderSelection.ts:164`; salta la validación de cuota inicial `AvailableLenders.tsx:553-557`; salta OTP/modal → `continue` `available-lenders.tsx:77`; selecciona `MotaiLenderCardContent` `LenderCardContent.tsx:895`; habilita PEP `personal-info-form.tsx:63-69`; payload `isMotaiRenting` en `phone-number.tsx:190` / `otp-verification.tsx:131` / `loan-request-form.tsx:257`; constante `MOTAI_LENDER_IDS=[158]` en `lender.constants.ts:13` **+** inline duplicada en `phone-number-step-form.tsx:24`.
**Ahora (config):** `lenders.product` (`credit`|`renting`|`rto`) decide la card y los skips; `lenders_by_allied_branches.document_types` habilita PEP; el **salto de buró** pasó a ser el bypass por tipo de documento **PEP** en `storePersonalInfo` (`OnboardingService.php:314,338`, que ya existía). Default de negocio quemado a limpiar: la tarjeta PEP fija `nationality:'VENEZOLANA'` (`init-loan-request.tsx:266-268`).
**Cómo ajustar** = editar columnas, no `if`. Anti-patrón adyacente (mismo viaje, no-Motai): `ONVACATION_LENDER_IDS=[313]` (`phone-number-step-form.tsx:25`) y `HIDE_AVAILABLE_CREDIT_TAG_LENDER_IDS=[160]` (`lender.constants.ts:31`) — la categoría+config debería absorberlos.

### 2 · Muerte de los "modes"
**Qué.** Deprecadas en código `allied_modes`/`user_request_modes`; **6 archivos borrados** (modelos `AlliedMode.php`/`UserRequestMode.php`, repos `AlliedModeRepository.php`/`UserRequestModeRepository.php` + interfaces/bindings), `AlliedModeLenderFilterService.php` eliminado, y la página de modos del front. **Por qué (el punto clave):** los modos eran la raíz del hardcode y una **inconsistencia de flujo** — el usuario **pre-elegía** el producto en la pantalla de modos, el modo viajaba en `session`, y al llegar a `/lenders` el `AlliedModeLenderFilterService` **re-decidía/filtraba** por ese modo (además era **NO-OP**: leía `config['lenders']` que ningún config traía). Sin modos, `/lenders` decide como cualquier solicitud.
**Dónde.** Filtro `AlliedModeLenderFilterService.php:16-42` (cableado en `LenderRetrievalService.php:211` + `LenderListingService.php:127` → ahora passthrough); const `MOTAI_RENTING_ALLIED_MODE_ID=2` en `OnboardingController.php:36` (sin seeder — la fila se insertaba a mano, migración de nombre engañoso `2026_03_09_204622_create_merchant_modes_table.php` que crea `allied_modes`); front `merchant-mode.tsx` (componente + ruta `route("modes")` + `motai-bg.png`).
**Cómo ajustar.** Las **tablas** `allied_modes`/`user_request_modes` siguen en BD (drop físico pendiente — BD compartida con `application`).

### 3 · Calculadora renting/rto en BD (no en código)
**Qué.** Dos columnas nuevas en la tabla `lenders` (modelo `Lender`, `$fillable`/`$casts`) — `lenders.product` (default `credit`) y `lenders.calculator` (json, `null` = identidad) — evaluadas en backend por **`app/Support/FormulaCalculator.php`** (NUEVO; `symfony/expression-language`, **sin `eval`**, `guard()` = solo aritmética escalar, **fail-safe** → degrada a `{amount}`). `LenderListingService::attachCalculatedFields` → `buildCalculated()` corre el `calculator` **por fila de `plans` (renting) / `terms` (rto)** y adjunta `calculated={amount, plans:[{...,payment}], payment_unit, default_plan}` a cada lender del listado. **Por qué.** Que los cálculos vivan en **datos**, no en código.
**Formato del `calculator`:** `{ params:{setup_fee,margin,tax,weekly_rate}, formulas:{amount,payment}, plans|terms }`. Renting = `amount=(amount+1.500.000)*(1+1.0)*(1+0.19)` → **$14.360.920** para el ejemplo del PRD (coincide exacto con la fórmula quemada); `payment=amount*weekly_rate*factor`.
**Front.** `RentingLenderCardContent` (NUEVO) **solo lee** `calculated`; elegir un plan cambia la fila, **no recalcula ni llama al backend**. Se borró el hardcode `getMotaiTotalAmount`/`RENTING_PLANS` (`LenderCardContent.tsx:236-245`, usado en `:810`).
**Cómo ajustar** = editar el json en BD. ⚠ El `calculator` de `158` sembrado en la migración solo trae `formulas.amount` (sin `plans`/`payment` → **sin selector de cuotas**); las `plans` se probaron con lenders clonados (169/170) en local. `FormulaCalculator.php` y `RentingLenderCardContent.tsx` son **archivos nuevos** (aún no en el índice del árbol).

### 4 · Ábaco: flag introducido y luego removido (lo maneja otro equipo)
**Qué.** Se agregó `lenders.abaco` (bool) y se **REMOVIÓ** (`5013f4af`): la forma final (columna/tabla/nombre) la define el equipo de Ábaco. `MotaiValidationService.php:82` queda como **seam** (`$userRequest->lender?->abaco ?? false` → sin columna, Eloquent devuelve `null` → `false` = "no requerido") → **hoy nadie entra al flujo Ábaco** hasta que ellos cableen la fuente. El gate `checkAbacoRequirementOrchestrator` (`MotaiValidationController`, request `MotaiAbacoRequirementRequest`) devuelve `MOTV1001`/`MOTV1000` (gate `:110-111,183-189`, mapas `:139-159`). El endpoint `/api/onboarding/motai/check-abaco-requirement` sigue vivo (lo consumen 4 loaders del wizard vía `abaco.repository.ts:30`) y `/api/onboarding/motai/update-status` sale de `financial-profile.repository.ts:75,81` — **NO borrar**; candidatos a rename `/abaco/*`. Las ramas `isAbacoRequired` que cambian destino/polling (flag legítimo, se alimenta de config del lender) viven en `loan-continue.tsx:349,393,400,433` + `identity-validation-status.tsx:188-189,596` (polling Ábaco **36** intentos, `validation-polling.constants.ts:3`).
**Saneamiento pendiente (E0):** `GET scraping/init/gig-economy` está **roto** — `AbacoController.php:42-51` llama `initGigEconomyFromToken()` que no existe (solo `initGigEconomy` `:278`) → borrar la ruta (`routes/api.php:205`); webhook Ábaco **NO-OP** (`AbacoService.php:599-628`, `webhook_enabled=false`); y `average_income` se calcula (`AbacoParserService.php:168-190`) pero `AbacoService.php:575` **ignora la clave y NO lo persiste** → **prerequisito de TODA la política MVP2** (§Objetivo pieza 2).

### 5 · TyC por comercio (`allied_documents`)
**Qué.** Tabla nueva `allied_documents` (`allied_id`, `type` ∈ {`terms_and_conditions`|`data_policy`|`risk_policy`|…}, `terms_and_conditions_id` FK, `sort`, `status`) + modelo `AlliedDocument` (NUEVO) + `Allied::documents()`; el back los expone por `AlliedInfoController` y los persiste al aceptar (`RegisterCellPhoneService::storeTermsAndConditions`). **Aclaración de modelo:** `allied_documents` **NO guarda la URL** — guarda un **FK al catálogo `terms_and_conditions`** (donde ya vivía la URL/versión); lo que se movió a config es el **mapeo comercio→documento**. **Por qué.** Des-hardcodear los `terms_and_conditions_id` quemados.
**Antes (hardcode):** TyC por rama `if($isMotaiRenting)` → ids **16/17** (si no, **18/13**), **duplicado** en `RegisterCellPhoneService.php:411-442` + `UserService.php:325-362` (+ id 18 en `OnboardingController.php:120,810,812`); legal atado a Credifamilia `LegalService.php:31,35,41` (`ENABLED_LENDERS_FOR_LEGAL=[24]`, `templateProject='credifamilia'`); PDFs S3 quemados en `phone-number-step-form.tsx:39,45`.
**Cómo resuelve `storeTermsAndConditions`:** (1) `hasCredifamilia` → doc `18` (aún hardcoded); (2) comercio con filas en `allied_documents` → registra **esas** (por `sort`); (3) si no → **DEFAULT en código** (último TyC activo + doc `13`). La migración backfillea **solo 158** (`data_policy=16` + `terms_and_conditions=17`).
**Cómo ajustar / ⚠:** la config por comercio **REEMPLAZA** al default (debe ser completa, o el comercio pierde su política de datos); el backfill **no es idempotente** (sin `updateOrInsert` → re-correr duplica); docs `13`/`18` siguen hardcodeados en el fallback; y el consentimiento sigue quemado `terms:true` en el payload (`phone-number.tsx:187`, `otp-resend.tsx:122`) — atar a la config real.

### 6 · Recálculo de monto en `/lenders` (endpoint liviano)
**Qué.** `GET lenders-v2/{ur}/recalculate?amount=` → `LenderListingController@recalculate` → `LenderListingService::recalculate` → `{lenders:{<id>:{product,calculated}}}`. Corre **solo `FormulaCalculator`** (~**0.15s** vs ~**0.67s** el listado). **Por qué:** la cuota depende del monto, pero la **elegibilidad y el cupo del pre-aprobado NO** (son del usuario, amount-independientes) → no se re-corren pre-aprobados/perfilamiento/datacrédito.
**Front.** `AvailableLenders.handleAmountChange` (**debounce 450ms**) → `recalcFetcher.load('/merchant/{hash}/{ur}/lenders/recalculate?amount=')` → merge del `calculated` en las cards. Ruta-recurso `recalculate.tsx` (NUEVA) vive **solo bajo `merchant/`** y se llama con **path absoluto** (en self-service da 404 silencioso). Monto **STATELESS** (no va a la URL). El crédito calcula la cuota **client-side** (instantáneo).
**Borde:** lenders sensibles al mínimo (welli/meddipay/prami/bancolombia-consumo) no se re-consultan solos al cruzar el mínimo → botón "reintentar" por card (gateado `requestedAmount >= minimumAmount`).

## Cómo probar / validar
**Barrido grep de completitud** (2026-07-15, ambos repos) — prueba de que la des-motaización no dejó lógica quemada:

| Búsqueda | frontend-monorepo | legacy-backend |
|---|---|---|
| `isMotaiRenting` / `is_motai_renting` | **0** | **0** |
| `merchantMode` / `merchant-mode` / `merchant_mode` | **0** | **0** |
| `MOTAI_LENDER_IDS` | **0** (constante+export borrados) | n/a |
| ruta de modos (`merchant-mode.tsx`, `route("modes")`) | **0** | **0** |
| `allied_modes` / `user_request_modes` (código) | n/a | **0** (3 comentarios "deprecado"; tablas quedan en BD) |
| id `158` como **lógica** | **0** | **0** |

Lo que legítimamente queda con "motai"/"158" NO es lógica: el `158` en la migración es **backfill de datos**; `MotaiValidationService`/rutas `/api/onboarding/motai/*` son **nombres** de endpoints (lógica interna ya genérica); el bypass PEP en `storePersonalInfo` es el mecanismo correcto (keyea por `document_type==='PEP'`). **Plan dual-read** (los 8 PRs del deber-ser): cada paso introduce el mecanismo genérico **leyendo con fallback al hardcode**, se verifica E2E, y el último borra los hardcodes; el E2E de los 3 modos corre antes y después de cada PR. Prueba E2E del flujo aún **pendiente** (requiere la migración corrida — ver Pendientes).

## Bitácora
- **2026-07-15** — Arranque de la des-motaización sobre `feature/motai-v2` (nacida de staging). Censo re-verificado B1–B18 (backend) / F1–F17 (frontend) vs staging.
- **2026-07-17** — **Retargeteo del PR de legacy staging → `develop`** (por pedido del líder); conflictos resueltos con merge de develop (`44eb3c02`). Frontend NO se retargeteó (sigue →staging, limpio). Fixes de develop que entraron por el merge: `$hasCredifamilia` (`098322a8`, también en develop) y ProfilerML sin `H2O_API_HOST` (`4022b6c9`).
- **2026-07-17** — Ábaco: se removió el flag `lenders.abaco` (lo define otro equipo); endpoint `check-abaco-requirement` conservado como seam.
- **2026-07-17** — Fase de data: superficie de código curada + doc enriquecido desde `git 159906a:docs/mejoras/DES-MOTAIZACION.md` · `DES-MOTAIZACION-CONFLUENCE.md` · `docs/chages/MOTAI-V2-MAPA-DE-CAMBIOS.md`.

## Pendientes
- [ ] Migración en staging/prod (por pipeline); sin ella Motai se comporta como `credit`.
- [ ] `calculator` de 158 con `plans`/`payment` (hoy solo `amount`) + backfills idempotentes (`updateOrInsert`).
- [ ] RTO (`product='rto'`): seed de `terms` **52/78/104 semanas** (= 12/18/24 meses — **C10**, el PRD dice mal 12/18/24 "semanas"), card propia, fórmula de valor a financiar (VF no reversa limpio).
- [ ] TyC: docs `13`/`18` hardcodeados en el fallback + validar entrega por entidad con **legal**.
- [ ] Drop físico `allied_modes`/`user_request_modes` (BD compartida con `application`) · `PHP >= 8.4` en CI (por `symfony/expression-language ^8.1`) · rename rutas `/api/onboarding/motai/*` → genéricas · CRUD admin de `product`/`calculator`/`document_types`/`allied_documents`.
- [ ] Cerrar con negocio: **C9** score mínimo titular (PRD dice **400** en un lado, **0** en otro) · **C2/C3** ¿Datacrédito 100% aplica a PEP (thin-file)? · **D6** ¿el producto se elige en el marketplace (cae la pantalla de modos)? · **D7** ¿renting y RTO son 2 lenders o 1 con flag "opción de compra"?

## Enlaces
- **Contextos hermanos:** **Motai** (v1 = como ES) · **CreditopX** (rt=2, listado/cupo) · **Merchants** (config/ficha) · **Dynamic Forms** (`document_types`) · **KYC** (buró/Ábaco). Raíz: **CreditOp**.
- **Memorias:** `[[motai-plan-evolucion]]` (plan E0–E4, PIVOT §10, DES-MOTAIZACION censo) · `[[motai-v2-validacion-local]]` (pusheado + TyC por comercio + harness panel) · `[[abaco-gig-scraping]]` (Ábaco proveedor externo, ingreso informativo) · `[[nomenclatura-negocio]]` (choques PRD×código, "renting"=RTO).
- **Fuente histórica (git `159906a`):** `docs/mejoras/DES-MOTAIZACION.md` (censo B1–B18/F1–F17 + 8 PRs) · `docs/mejoras/DES-MOTAIZACION-CONFLUENCE.md` (versión negocio) · `docs/chages/MOTAI-V2-MAPA-DE-CAMBIOS.md` (mapa de cambios vigente) · `docs/mejoras/MOTAI-PLAN-EVOLUCION.md` · `docs/codigo/MOTAI-FLUJO-ANALISIS.md` (⚠ estado ANTES de esta rama).
- **Jira:** CORE-265 (flujo unificado) · CORE-266 (calculadora) · CORE-267 (TyC) · CORE-268 (recálculo) — sprint CORE Sprint 7.
