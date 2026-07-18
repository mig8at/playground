# CreditOp · raíz
> **estado:** al día con main · Plataforma colombiana de crédito en punto de venta y ecommerce; nodo CENTRAL del árbol — leelo primero para entender el ecosistema. ARRIBA cuelgan los CONTEXTOS (temas acotados, con jerarquía); ABAJO las TASKS (trabajo con ramas propias). Es también el HOGAR de lo transversal que ningún contexto dueña (datos, estados, harness, deuda).

## Qué es
CreditOp conecta 3 actores: **COMERCIOS** aliados (`allieds`, con SUCURSALES `allied_branches` como puerta de entrada por `hash`), **CLIENTES** que financian una compra, y **~150 LENDERS** que ponen el dinero. Usa DOS SOMBREROS:

1. **BRÓKER / marketplace** — muestra opciones y arma la solicitud, pero un tercero externo presta, decide y cobra (`response_type` **0** UTM/referido, **1** Integración por API, **4** Credifamilia por SOAP).
2. **OPERADOR** bajo la marca **CreditopX** (rt=**2** in-platform, rt=**3** cupo rotativo) — CreditOp origina, firma con OTP+pagaré, desembolsa hasta el **Estado 11 (Autorizada)** y lleva la cobranza; PERO el capital y el riesgo los pone el COMERCIO (marca blanca; CreditOp gana comisión por recaudo).

Una operación = combinación de **4 ejes ortogonales**: `response_type` (quién decide/gestiona) · producto/garantía (compra · SmartPay=celular con bloqueo MDM · Motai=arrendamiento/renting) · modo del comercio · canal (WooCommerce/self/VTEX, asesor con QR, Corbeta por lotes). El **Estado 11 es la frontera** entre originación y servicing/cartera.

## Arquitectura
Migración **strangler-fig en parallel-run**. La lógica vive repartida entre `application` (el VIEJO) y el par `legacy-backend + frontend-monorepo` (el NUEVO). En NEGOCIO: a `application` se le dice **ALIADOS**; al conjunto `legacy-backend + frontend-monorepo` se le dice **REFACTOR**. Detalle por repo → contextos **application** · **legacy-backend** · **frontend-monorepo** · **architecture**.

- **ALIADOS = `application`.** Monolito Laravel+Vue (NO modular): dominio en `app/` (Models, Http/Controllers/{Admin,Customer,Api}, Services, Console/Commands, Jobs) y rutas por audiencia (`admin.php`, `customer.php` ~37KB, `api.php`). Es el sistema HISTÓRICO y el runtime POR DEFECTO: corre la originación de casi todos los comercios y aloja EN EXCLUSIVA la creación de ENTIDADES/COMERCIOS, la asignación de SUCURSALES (con la copia de reglas/datacrédito por sucursal), el panel admin + SSO Cognito, y TODA la cobranza/servicing post-desembolso (crons diarios `UpdateCreditopX*`).
- **REFACTOR = `legacy-backend` + `frontend-monorepo`.** DESTINO de la migración; ya reconstruyó el núcleo de originación CreditopX (cierre rt=2/3, ecommerce/VTEX con contrato base64, cuota inicial Wompi, identidad, device-lock SmartPay), self-contained y validado e2e.
  - `legacy-backend` = Laravel MODULAR (nwidart/laravel-modules, `Modules/*`: Onboarding · Loans · Risk · Identity · Payments · Partner · System) + arquitectura V1/V2 = Controller delgado → Service → Command → Repository con envelope `{code,message,data}`.
  - `frontend-monorepo` = monorepo Turborepo+pnpm (`apps/loan-request-wizard` = wizard React Router v7 + SSR; `packages/*` = librerías `@creditop/*`; `modules/loan-request-wizard/*` = DDD). El front NO toca la BD: es cliente HTTP de `legacy-backend` (`VITE_API_URL`).

**BASE DE DATOS COMPARTIDA.** `application` y `legacy-backend` comparten LA MISMA base (misma RDS/Redis/Pusher en prod durante el parallel-run). Por eso `app/Models/` se REPITE en ambos: el puente REAL es la BD, no HTTP. Dos ejes que NO confundir:
- **DEPENDENCIA** — legacy NO llama a application en runtime; el único acople de código es application→legacy vía `GenerateServicesBridgeClient` / `NewFrontendUrlService`.
- **CUTOVER** — application sigue corriendo porque el ruteo es un **allowlist por comercio hardcodeado y creciente** (ej `WoocommerceController` `[24,209,210,211,311]`); todo comercio fuera de la lista corre íntegro en application.

> **Tesis de fondo.** CreditOp se adapta a cada comercio con **ifs quemados por ID** en vez de configuración; el deber-ser es un **modelo único paramétrico con reglas heredadas** (no copiadas ~37.000 veces por sucursal). Es el norte de las tasks de simplificación (Motai v2, etc.). Fuente: `git 159906a:docs/vision/UNIFICACION-Y-RESPONSABILIDADES.md`, `git 159906a:docs/mejoras/PLAN-ACCION-SIMPLIFICACION.md`.

## Datos / tablas clave
Sustrato transversal que **todos los contextos consultan** (ninguno lo dueña). Entidades centrales: `allieds` (comercio) → `allied_branches` (sucursal, puerta por hash) → `lenders` + `lenders_by_allieds` (config × comercio = TODA la calculadora de reglas) + `lenders_by_allied_branches` (config × sucursal: url_utm/sort/status) → `user_requests` (la solicitud) + el ledger `creditop_x_requests_history` (servicing).
- **3 capas de config** (NO hay herencia viva; se COPIA): entidad → comercio (8 toggles) → sucursal → categoría. La calculadora real vive en `lenders_by_allieds`; solo datacrédito tiene fallback al lender 5. Ver contextos **actors** · **merchants** · **entities**.
- **Dónde deciden**: `group_rules` + datacrédito + categoría clasifican/cortan (2 motores datacrédito con campos distintos, cascada que clasifica-no-excluye → contexto **creditopx** + subcontexto **profiling**). **BUG activo:** `min_income` (piso de ingreso de categorías) es **NO-OP en los 3 motores** — arreglarlo endurece la asignación.
- Detalle completo (176 columnas, muertas/divergentes, niveles N0-N3): `git 159906a:docs/codigo/MODELO-DATOS.md` + `…/CENSO-CAMPOS-CONFIG.md`. Reglas por comercio/lender: `…/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md`.

## Estados y catálogos
Las máquinas de estado son transversales; los contextos referencian ESTO y no lo repiten. **Tres catálogos que NO confundir:**
- `user_request_statuses` — la SOLICITUD. **Estado 11 (Autorizada) = la frontera** originación↔servicing. Otros: 3 Selección · 6 Negada · 7 Fallida · 8 Cancelada · 9 formulario perfil · 10 confirmación de pago · 26 Facturado.
- `creditop_x_user_request_statuses` (1-4) — el PRÉSTAMO in-platform post-11: 1 al día · 2 mora · 3 paz y salvo · 4 cancelado. Es "el que importa" para servicing.
- `lender_transaction_statuses` (namespace propio, ej 40/41) — el espejo de los lenders rt=1/rt=4 (agregadores + Credifamilia SOAP).
- Detalle (los 2 catálogos + los 6 crons post-11): `git 159906a:docs/codigo/CONTINUACION-CREDITO-ANALISIS.md`. Memoria `continuacion-credito-servicing`.

## Frontera de pruebas / harness
El mapa GLOBAL de simulación (material del OKR de metodología de pruebas). **El harness despacha por `response_type`:**
- **rt=2/3 (CreditopX in-platform) = INYECTABLE**: decide 100% en legacy con datos locales → usuario sintético sin KYC real (sembrar categoría + fila Experian encriptada); el harness Go cierra con `ForceOtpValidation`+`authorize`. Contexto **creditopx** = el más simulable.
- **rt=1 (agregadores) = NO inyectable**: decide una API externa → solo mock HTTP del transporte (contexto **aggregator**). **rt=4 (Credifamilia) = parcial** (gate local sí, KYC V2 + SOAP no).
- **Cheat-sheet de mocks/bypasses/stashes** (OTP, identidad, forms, PDF, buró) + la **receta de usuario sintético** + la encriptación del buró (`laravel_encrypt` AES-256-CBC): `git 159906a:docs/operacion/HARNESS-ARQUITECTURA.md` + `…/HANDOFF-PRUEBAS-ONBOARDING.md` + `…/E2E-DATA-TESTIDS.md`. Memorias `synth-lender-type-boundary`, `frontend-e2e-setup`, `backend-e2e-dev-target`, `datacredito-rules-per-lender`.

## Deuda técnica / hardcodes
La tesis de arriba ("ifs quemados por ID") tiene un inventario verificado con `archivo:línea`. Ítems load-bearing:
- **P0 vivo**: `dd($exception)` en `Wompi.php:78` corta en prod cualquier request que toque ese path.
- **~37.284 copias de reglas por sucursal** (5% ya derivada; 42 entidades corriendo el corte de Banco de Bogotá 640 sin decisión explícita) → contexto **merchants**.
- **Cognito sin validar el JWT** (`auth.cognito`, hallazgo de seguridad #12).
- Inventario completo: `git 159906a:docs/codigo/LOGICA-QUEMADA.md` · `…/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md` · `…/operacion/hallazgos-backend.md` · migración `…/codigo/ESTADO-MIGRACION.md` + `…/PENDIENTES-MIGRACION.md`.

## Cómo se lee este árbol
- **RAÍZ** (este nodo, `main`) = la base del ecosistema y el hogar de lo transversal; el punto de entrada para entender el todo.
- **CONTEXTOS** (cuelgan arriba, `main`) = piezas de conocimiento ACOTADAS y reutilizables (arquitectura de un repo, una familia de prestamista, un subsistema, un concepto). Pueden tener SUBCONTEXTOS más específicos. Documentación al día con `main`.
- **TASKS** (cuelgan abajo, ramas propias) = trabajo concreto sobre uno o varios contextos; cada task lista (chips) los contextos que necesita y lleva ramas por repo (bases distintas: application desde main, legacy desde staging, …). Usan la doc de sus contextos; no la repiten.

## Convenciones
- **Nomenclatura:** ALIADOS = `application` · REFACTOR = `legacy-backend`+`frontend-monorepo` · COMERCIO = `allied` · SUCURSAL = `allied_branch` · `response_type` 0/1/4 = bróker, 2/3 = CreditopX operador · Estado **11** = frontera originación↔servicing.
- **Ramas base:** RAÍZ y CONTEXTOS = `main` (documentación al día). TASKS = libres por repo.
- **Regla de oro playground:** `playground/*` se commitea local, sin push; los repos reales viven en ramas/stashes locales — no armar PRs sin pedir.
- **Glosario e IDs (colisiones):** verificá el **namespace** antes de tocar un id literal — `24` = lender Credifamilia **vs** allied Creditop · `100` = lender Bancolombia Consumo **vs** un allied · `158` = allied Motai (comercio) **vs** su lender · `160`/`152`/`153` = SmartPay (prod/dev). Glosario canónico (14 choques PRD×código×docs): memoria `nomenclatura-negocio`, `git 159906a:docs/negocio/NOMENCLATURA-NEGOCIO.md`.

## Bitácora
- **2026-07-17** — Fase de data de la raíz: repuestas las secciones transversales (Datos/tablas clave · Estados y catálogos · Frontera de pruebas/harness · Deuda técnica) + Arquitectura + Convenciones/glosario, adaptadas al modelo contexto/task vivo y con punteros a `git 159906a:docs/*` (docs/ fue removido de main) + memorias. Superficie de código = 58 entrypoints arquitectónicos (routes/models/servicios clave/bridge/crons).
- **2026-07-17** — Reestructura al modelo contexto/task; data curada previa movida a `flows-curated/` para re-linkar; siembra de contextos desde `playground/flow`.

## Enlaces
- **CONTEXTOS por group:** architecture (**application** · **legacy-backend** · **frontend-monorepo** · **ms-preapprovals**) · entities (**creditopx** · **aggregator** · **redirect**) · creditopx (**profiling** · **amount-tiers**) · merchants (**motaix** · **smartpay** · **pullman**) · **onboarding** · **formalization** · **kyc** · **dynamic-forms** · **actors** · **entities** · **merchants** · **architecture**.
- **TASKS:** **Motai v2** (des-motaización · rama `feature/motai-v2`).
- **⚠ `playground/docs/` fue absorbido en los nodos y REMOVIDO de main el 2026-07-17.** El análisis maestro `archivo:línea` sobrevive en **git @ `159906a`**: `git show 159906a:docs/<ruta>` (ej `git show 159906a:docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md`). Ir ahí para re-verificar o regenerar.
- Memorias del ecosistema: `atlas-mcp-cross-repo`, `modelos-canales-flujos`, `plan-simplificacion`, `nomenclatura-negocio`.
