# Motai · contexto
> **estado:** al día con main · Comercio aliado **158** (con su lender **MotaiX 158** rt=2 CreditopX) y sus **3 modos** compra/renting/alquiler; lo distintivo es el **modo del comercio** + **Ábaco** (ingresos gig, solo en renting, que SALTA el buró y hoy es informativo).

## Qué es
**Motai** es un **COMERCIO** aliado colombiano (`allied_id = 158`), no un lender ni un `response_type`. Expone **varios modos/productos** sobre el mismo wizard de originación — un eje **ortogonal** al `response_type`, que razona sobre el *lender*. Apunta a población **gig/migrante** (trabajadores de plataformas Rappi/DiDi/Uber y migrantes con **PEP = Permiso Especial de Permanencia**) que no tiene historial en el buró colombiano; por eso su rasgo central es un **underwriting alternativo por ingresos gig (Ábaco)** que reemplaza al buró en el modo renting.

> **Colisión de id `158`:** el número es **ambos** — el **allied 158** (el comercio, este nodo) y el **lender 158** ("Motai Renting", `response_type=2`, CreditopX in-platform; `isMotai = MOTAI_LENDER_IDS.includes(id)`, `MOTAI_LENDER_IDS=[158]`). Entidades distintas en tablas distintas que comparten número.

En el simulador **playground/flow**, Motai es el comercio *seed*; flow modela la vista **deber-ser** (productos como lenders CreditopX por categoría, Ábaco como "Información complementaria"), que es el **target de motai-v2**, no la v1 en main. Este nodo describe la **v1 real**: modos del comercio + bypass del buró + Ábaco no cableado.

## Contenido
**3 modos del comercio** (`allied_modes`, columna `config` casteada a array — `AlliedMode.php:23-25`), servidos al front como `partner_modes` (`RegisterCellPhoneService.php:50`, `where is_enabled=1`) y persistidos en `user_request_modes`:

| Modo (`code`) | Producto | ¿Persiste modo? | Bypass buró | Ábaco |
|---|---|---|---|---|
| `motai` | Compra financiada (crédito) | No (no-op) | No | No → `MOTV1000` |
| `motai-renting` | **Arrendamiento con opción de compra** (= "rent-to-own" del PRD) | **Sí** (id `2` hardcodeado) | **Sí** | **Sí** → `MOTV1001` |
| `alquiler` | Arrendamiento puro | No (no-op) | No | No → `MOTV1000` |

> Los ids reales de `allied_modes` para 158 **no están seedeados en ningún repo** (pregunta abierta). Compra y alquiler son **indistinguibles en el código legacy** (solo se ramifica por `isAbacoRequired`/`isMotaiRenting`); solo renting persiste fila de modo.

**Bypass de underwriting (renting).** `$isMotaiRenting = input('isMotaiRenting')===true || input('merchant_mode')==='motai_renting'` (`OnboardingController.php:1227`) fuerza `corbetaOnboarding=false` y **omite `userViability`/Experian y `validateRiskCentrals`**: el renting **sustituye** el score de buró por la prueba de ingresos gig de Ábaco. `attachMotaiRentingModeIfNeeded` (`:1215`, def `:1587`) fija el modo activo **solo si `isMotaiRenting===true`**, con la constante **`MOTAI_RENTING_ALLIED_MODE_ID = 2` hardcodeada** (`:36`). En renting se inyecta además el literal `'PEP'` + una laboral ficticia (`OnboardingService.php`).

**Ábaco = underwriting alternativo (solo renting).** Gate `POST motai/check-abaco-requirement` (`MotaiValidationService.php:70`) lee `AlliedMode.config['isAbacoRequired']` del modo activo → **`MOTV1001`** requiere / **`MOTV1000`** no (o "sin modo activo") / **`MOTV1002`** error (`:142-155`; 1000/1001 son HTTP 200). Con 1001 corre el sub-flujo (rutas `prefix scraping`, `routes/api.php:203`): `GET platforms` → `POST init/gig-economy` (JWT + cookie `sessionid`) → `login/step-1` → `login/step-2` (OTP de la plataforma gig) → `POST results`. Scrapea earnings de Uber/DiDi/Yango/inDrive/Rappi/DiDiFood, los **promedia** (`average_income`) y persiste un resumen por plataforma en `UserSummary.abaco`. Códigos por endpoint `ABAC1001–6004`. Ábaco es proveedor **EXTERNO** (CreditOp solo integra su API; cliente `Abaco.php`, **mock en env `local`** vía `AbacoFixture::generateDynamicMock`, `Abaco.php:211-217`). Toggles en el setting `abaco_config` (defaults: `enabled=true, platforms_check_enabled=false, webhook_enabled=false, mock_pass=true`).

**Ábaco NO decide (hoy).** `average_income` se computa y persiste (`AbacoParserService.php:47,187`) pero **ningún path de decisión lo lee** — captura **informativa**, no cableada. El **modo tampoco filtra el catálogo** de lenders: `AlliedModeLenderFilterService` es **NO-OP** salvo que `config['lenders']` traiga lista (los modos Motai no la traen, `:33`).

**Calculadora Motai** (fórmula quemada y **duplicada en el front**, `LenderCardContent.tsx:236` `getMotaiTotalAmount` + `useLenderSelection.ts:176`): `total = monto + alistamiento 1.500.000 + margen 100% + IVA 19%` → ej. `(4.534.000+1.500.000)·2·1,19 = $14.360.920`. Sin columnas de margen/IVA en BD.

**Decisión manual + cierre.** Hoy la decisión la toma el asesor en la pantalla de perfil financiero (`financial-profile.repository.ts:75` → `POST motai/update-status`, `approve` booleano; el ingreso que muestra viene de `FINANCIAL_HEALTH_API_URL` `:6`, **≠** Ábaco) → `BackDoorUserService.php:569`: aprobado ⇒ `targetStatus=11` + voucher; rechazado ⇒ `9` (`:587`). El cierre CreditopX estándar (OTP/pagaré/ADO/Estado 11 `authorize`) es del tronco **CreditopX**; la calculadora por comercio y la copia de reglas por sucursal, del padre **Merchants**.

## Dónde mirar
- **Modos del comercio** (legacy): `app/Models/AlliedMode.php:23` (`config`→array) · `RegisterCellPhoneService.php:50` (`partner_modes`) · `UserRequestModeRepository.php:10,18` (`findLatestActiveByUserRequestId` = último por id / `upsertActiveMode`) + `AlliedModeRepository.php` · `AlliedModeLenderFilterService.php:16,33` (filtro NO-OP) · migraciones `..._204622_create_merchant_modes_table.php` + `..._204647_create_request_modes_table.php`.
- **Bypass renting** (legacy): `OnboardingController.php:36` (constante `=2`), `:1227` (rama `isMotaiRenting`), `:1215,1587` (`attachMotaiRentingModeIfNeeded`) · `OnboardingService.php` (`'PEP'` + laboral ficticia). El motor que renting **SALTEA**: `DatacreditoQueryByAlliedController.php` (`userViability`, base de la política R1–R8 de MVP2).
- **Gate + flujo Ábaco** (legacy): `MotaiValidationController.php` + `MotaiValidationService.php:70,142-155` (MOTV) · `AbacoController.php` · `AbacoService.php` (`ABAC*`) · `AbacoParserService.php:47,187,194` (`average_income`, `UserSummary.abaco`) · `Abaco.php:211` (mock local) + `AbacoFixture.php` · requests `Abaco/{AbacoLogin,Init,Results,AbacoWebhook}Request.php` + `MotaiAbacoRequirementRequest.php` · `routes/api.php:197-206` · `config.php:14-18` (`ABACO_*`) · settings `..._003223_add_abaco_settings…:14-24` · columna `..._000000_add_abaco_column_to_user_summaries…` · `UserSummary.php`.
- **Front Ábaco** (front): módulo `modules/…/abaco/` (use-cases `check-abaco-requirement`/`initialize-flow`/`fetch-platforms`/`request-otp`/`verify-otp`/`get-results`, `abaco-context.tsx`, `abaco.repository.ts`, domain/ports) + rutas `app/routes/abaco/{index,layout,platforms,platform-otp-validation,internal-error}.tsx`.
- **Modo + marca + calc + decisión** (front): `merchant-mode.tsx` (ruta) + componente (`:41` `partner_modes.map`, `:5` branding quemado) · `lender.constants.ts:13` (`MOTAI_LENDER_IDS=[158]`) · `LenderCardContent.tsx:236` + `useLenderSelection.ts:176` (calc duplicada) · `financial-profile.repository.ts:6,75` · string `merchantMode==='motai-renting'` en 5 rutas (`phone-number.tsx:190`, `otp-verification.tsx:131`, `loan-request-form.tsx:257`, `bancolombia/onboarding/{otp,register}.tsx`).
- **Decisión manual** (legacy): `BackDoorUserController.php` → `BackDoorUserService.php:569,587` + `MotaiUpdateStatusRequest.php`.
- **application** = solo scaffolding de esquema (2 migraciones abaco portadas), **cero lógica** — nada que migrar desde ahí.

## Gotchas / riesgos
- **Ábaco NO cablea la decisión** hoy: `average_income` es dato **huérfano** (grep de consumidores vacío) y el front solo usa el booleano `completed`; la "validación de ingresos" no valida. El PRD MVP2 lo quiere cablear + **revertir el bypass** (Datacrédito 100%): es greenfield, no un toggle.
- **`MOTAI_RENTING_ALLIED_MODE_ID=2` hardcodeado, sin seeder** de `allied_modes`: si el id real difiere por ambiente, se fija el modo equivocado o revienta (`findById(2)` null).
- **Disparador dual inconsistente**: el bypass se activa con `isMotaiRenting` **o** `merchant_mode='motai_renting'`, pero el modo **solo se persiste** con el booleano → se puede saltar el buró sin registrar el modo (y `check-abaco-requirement` daría `MOTV1000`).
- **Compra y alquiler no persisten fila de modo** (solo renting) → sin trazabilidad del modo en 2 de 3 casos.
- **`GET init/gig-economy` está ROTO** (`AbacoController.php:42-50` llama `initGigEconomyFromToken()`, inexistente en el service; `routes/api.php:206`); solo el `POST` funciona.
- **Webhook `scraping.completed` = NO-OP**: dispatch comentado (`AbacoService.php:612`), solo loguea; además `webhook_enabled=false` por defecto → la finalización se detecta por **polling** del front.
- **PEP migratorio ≠ PEP AML**: aquí PEP = Permiso Especial de Permanencia (migrante gig); el literal `'PEP'` no dispara consulta a centrales. En el AML de TusDatos "PEP" = Persona Expuesta Políticamente.
- **Terminología invertida** (C1): el `motai-renting` del código = el *rent-to-own* del PRD (se queda el bien); `alquiler` = el *renting operativo* del PRD (lo devuelve). Fijar diccionario (memoria `nomenclatura-negocio`).
- **IMEI / device-lock (MDM)** es el cierre de la **compra de celulares** del allied Motai, árbol separado sin cruce con modos/Ábaco — fuera de este nodo (patrón afín en **SmartPay**).

## Bitácora
- **2026-07-23** — La des-motaización (tarea `motai-v2`) quedó reasentada **limpia sobre `qa`** en `feature/motai-clean-v2` (legacy-backend + frontend-monorepo, 1 commit c/u), PRs pendientes de crear. Saca modos (`allied_modes`/`user_request_modes`), `isMotaiRenting`/`merchant_mode`, los ifs por 158 y limpia el `openapi.yaml` de OnboardingV2; los reemplaza por config (`lenders.product`/`calculator`, `allied_documents`, Ábaco derivado de `product`, endpoint `recalculate`). **Sin mergear** → este nodo sigue describiendo la **v1 en main**; gradúa recién al mergear. Detalle in-flight en el tablero.
- **2026-07-18** — RENOMBRADO `motaix` → `motai` (nodo + id + refs). El nodo cuelga de **Merchants**, así que documenta el **COMERCIO** aliado 158 (Motai); **MotaiX** es su *lender* rt=2 y pertenece conceptualmente a **Entities**. El nombre viejo mezclaba los dos namespaces.
- **2026-07-17** — Fase de data: superficie de código curada (modos `allied_modes`/`user_request_modes`, Ábaco legacy+front, bypass `isMotaiRenting`, calc + decisión manual) + doc enriquecido desde `git 159906a:docs/codigo/MOTAI-FLUJO-ANALISIS.md` y `…/mejoras/MOTAI-PLAN-EVOLUCION.md`; líneas re-verificadas contra el código real. Corrige la v0 sembrada de flow (la vista "3 productos CreditopX / Información complementaria / cuota 30% + cargo 400k" era el deber-ser de flow/motai-v2, no la v1 en main; la calc real es alistamiento 1,5M + margen 100% + IVA 19%).
- **2026-07-17** — Contexto sembrado desde playground/flow (store `merchant`/`merchantCalc`/`CREDITOPX_PRODUCTS`, nodo IngresosExtrasNode, fieldDocs) + MAP.md §S5.

## Enlaces
- Padre: **Merchants** (alta/config/copia de reglas). Hermanos: **SmartPay**, **Pullman**. Tronco in-platform: **CreditopX**; buró/identidad: **kyc**; perfilamiento: **Profiling**; cierre legal: **Formalization**.
- Tarea que deriva de acá: **motai-v2** (des-motaización). Simulador: playground/flow (comercio seed "Motai").
- Memorias: `modelos-canales-flujos`, `abaco-gig-scraping`, `motai-plan-evolucion`, `nomenclatura-negocio`. Fuente profunda: `git 159906a:docs/codigo/MOTAI-FLUJO-ANALISIS.md`.
