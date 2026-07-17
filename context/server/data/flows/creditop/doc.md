# CreditOp · raíz
> **estado:** al día con main · Plataforma colombiana de crédito en punto de venta y ecommerce; nodo PADRE de todos los flujos — leélo primero para entender el ecosistema antes de bajar a un flujo puntual.

## Qué es
CreditOp conecta 3 actores: **COMERCIOS** aliados (`allieds`, con SUCURSALES `allied_branches` como puerta de entrada por hash), **CLIENTES** que financian una compra, y **~150 LENDERS** que ponen el dinero. Usa DOS SOMBREROS:

1. **BRÓKER / marketplace** — muestra opciones y arma la solicitud, pero un tercero externo presta, decide y cobra (`response_type` **0** UTM/referido, **1** Integración por API, **4** Credifamilia por SOAP).
2. **OPERADOR** bajo la marca **CreditopX** (rt=**2** in-platform, rt=**3** cupo rotativo) — CreditOp origina, firma con OTP+pagaré, desembolsa hasta el **Estado 11 (Autorizada)** y lleva la cobranza; PERO el capital y el riesgo los pone el COMERCIO (marca blanca; CreditOp gana comisión por recaudo).

Una operación = combinación de **4 ejes ortogonales**: `response_type` (quién decide/gestiona) · producto/garantía (compra · SmartPay=celular con bloqueo MDM · Motai=arrendamiento/renting) · modo del comercio · canal (WooCommerce/self/VTEX, asesor con QR, Corbeta por lotes). El **Estado 11 es la frontera** entre originación y servicing/cartera.

## Arquitectura
Migración **strangler-fig en parallel-run**. La lógica vive repartida entre `application` (el VIEJO) y el par `legacy-backend + frontend-monorepo` (el NUEVO). En NEGOCIO: a `application` se le dice **ALIADOS**; al conjunto `legacy-backend + frontend-monorepo` se le dice **REFACTOR**.

- **ALIADOS = `application`.** Monolito Laravel+Vue (NO modular): dominio en `app/` (Models, Http/Controllers/{Admin,Customer,Api}, Services, Console/Commands, Jobs) y rutas por audiencia (`admin.php`, `customer.php` ~37KB, `api.php`). Es el sistema HISTÓRICO y el runtime POR DEFECTO: corre la originación de casi todos los comercios y aloja EN EXCLUSIVA la creación de ENTIDADES/COMERCIOS, la asignación de SUCURSALES (con la copia de reglas/datacrédito por sucursal), el panel admin + SSO Cognito de aliados, y TODA la cobranza/servicing post-desembolso (crons diarios de mora/pagos/revolving = `UpdateCreditopX*`).
- **REFACTOR = `legacy-backend` + `frontend-monorepo`.** DESTINO de la migración; ya reconstruyó el núcleo de originación CreditopX (cierre rt=2/3, ecommerce/VTEX con contrato base64, cuota inicial Wompi, identidad, device-lock SmartPay), self-contained y validado e2e.
  - `legacy-backend` = Laravel MODULAR (nwidart/laravel-modules, `Modules/*` por dominio: Onboarding · Loans · Risk · Identity · Payments · Partner · System) + arquitectura V1/V2 = Controller delgado → Service → Command → Repository con envelope `{code,message,data}`.
  - `frontend-monorepo` = monorepo Turborepo+pnpm (`apps/loan-request-wizard` = wizard React Router v7 + SSR; `packages/*` = librerías `@creditop/*`; `modules/loan-request-wizard/*` = DDD domain/application/infrastructure/ports/ui). El front NO toca la BD: es puro cliente HTTP de `legacy-backend` (`VITE_API_URL`).

**BASE DE DATOS COMPARTIDA.** `application` y `legacy-backend` comparten LA MISMA base de datos (misma RDS/Redis/Pusher en prod durante el parallel-run). Por eso `app/Models/` se REPITE en ambos (User, Allied, AlliedBranch, Lender, LendersByAllied, LendersByAlliedBranch, UserRequest y el ledger `CreditopX*`): el puente REAL es la BD, no HTTP. Dos ejes que NO hay que confundir:
- **DEPENDENCIA** — legacy NO llama a application en runtime (0 dependencias de código); el único acople de código es application→legacy vía `GenerateServicesBridgeClient` / `NewFrontendUrlService`.
- **CUTOVER** — application todavía CORRE porque el ruteo es un **allowlist por comercio hardcodeado y creciente** (ej `WoocommerceController` `[24,209,210,211,311]`); cualquier comercio fuera de la lista corre íntegro en application.

**Estado de la migración (NO terminó).** DUPLICADA viva en ambos: cierre CreditopX (pagaré), VTEX, documentos web, notificaciones; `LenderRetrievalService` (Aliados) ≈ `LenderListingService` (Refactor); `RiskCentralValidationService` (viejo) ≈ `DatacreditoRuleEvaluator` (nuevo); alta `Admin/Allied*` ≈ `Modules/Partner` (este último GEMELO MUERTO no invocado). SOLO EN REFACTOR: dynamic-forms de SmartPay, notificador de ecommerce unificado. FLUJOS QUE CRUZAN: una solicitud se origina en legacy pero su cartera vive en application; el callback biométrico ADO postea a application; el wizard hace de BRIDGE al panel viejo (SSO Cognito HMAC a `ALIADOS_BASE_URL`); los webhooks de agregadores rt=1 están COPIADOS-SIN-RUTA (código muerto) en legacy y solo funcionan en application.

> **Tesis de fondo.** CreditOp se adapta a cada comercio con **ifs quemados por ID** en vez de configuración; el deber-ser es un **modelo único paramétrico con reglas heredadas** (no copiadas ~37.000 veces por sucursal). Es el norte de los flujos de simplificación (Motai v2, etc.).

## Datos / tablas clave
Sustrato transversal que **todos los flujos consultan** (ninguno lo dueña). Entidades centrales: `allieds` (comercio) → `allied_branches` (sucursal, puerta por hash) → `lenders` + `lenders_by_allieds` (config × comercio = TODA la calculadora de reglas) + `lenders_by_allied_branches` (config × sucursal: url_utm/sort/status) → `user_requests` (la solicitud) + el ledger `creditop_x_requests_history` (servicing).
- **3 capas de config** (NO hay herencia viva; se COPIA): entidad → comercio (8 toggles) → sucursal → categoría. La calculadora real vive en `lenders_by_allieds`; solo datacrédito tiene fallback al lender 5.
- **Dónde deciden**: group rules + datacrédito + categoría clasifican/cortan (motor de decisión: `docs/codigo/ONBOARDING-DATOS-DECISION-ANALISIS.md` + `docs/codigo/REGLAS-POR-COMERCIO-Y-LENDER.md`; 2 motores datacrédito con campos distintos, cascada que clasifica-no-excluye). **BUG activo:** `min_income` (piso de ingreso de categorías) es **NO-OP en los 3 motores** — arreglarlo endurece la asignación.
- Fuentes profundas: `docs/codigo/MODELO-DATOS.md` (estructura de tablas, verified con SHOW COLUMNS) · `docs/codigo/CENSO-CAMPOS-CONFIG.md` (176 columnas: 33 muertas / ~20 divergentes / BUG min_income) · `docs/mejoras/MAPA-ATRIBUTOS-POR-NIVEL.md` (atributo → nivel N0-N3, deber-ser).

## Estados y catálogos
Las máquinas de estado son transversales; los flujos referencian ESTO y no lo repiten. **Tres catálogos que NO hay que confundir:**
- `user_request_statuses` — la SOLICITUD. **Estado 11 (Autorizada) = la frontera** originación↔servicing. Otros vistos: 3 Selección · 6 Negada · 7 Fallida · 8 Cancelada · 10 confirmación de pago · 26 Facturado.
- `creditop_x_user_request_statuses` (1-4) — el PRÉSTAMO in-platform post-11: 1 al día · 2 mora · 3 paz y salvo · 4 cancelado. Es "el que importa" para servicing.
- `lender_transaction_statuses` (namespace propio, ej 40/41) — el espejo de los lenders rt=1/rt=4 (agregadores + Credifamilia SOAP).
- Fuente: `docs/codigo/CONTINUACION-CREDITO-ANALISIS.md` §2 (los 2 catálogos) · `docs/codigo/MODELO-DATOS.md`.

## Frontera de pruebas / harness
El mapa GLOBAL de simulación (material del OKR de metodología de pruebas). **El harness despacha por `response_type`:**
- **rt=2/3 (CreditopX in-platform) = INYECTABLE**: decide 100% en legacy con datos locales → usuario sintético sin KYC real (sembrar categoría + fila Experian encriptada); el harness Go cierra con `ForceOtpValidation`+`authorize`.
- **rt=1 (agregadores) = NO inyectable**: decide una API externa → solo mock HTTP del transporte. **rt=4 (Credifamilia) = parcial** (gate local sí, KYC V2 + SOAP no).
- **Cheat-sheet de mocks/bypasses/stashes** (OTP, identidad, forms, PDF, buró) + la **receta de usuario sintético** + la encriptación del buró (`laravel_encrypt` AES-256-CBC) viven en los docs de operación.
- Fuentes: `docs/operacion/HARNESS-ARQUITECTURA.md` (composer + estrategias cross-repo) · `docs/operacion/HANDOFF-PRUEBAS-ONBOARDING.md` (receta synth + scrub) · `docs/operacion/E2E-DATA-TESTIDS.md` (testids + `bin/testids`) · `docs/codigo/CASOS-ESPECIALES.md` (por qué falla cada caso: casi todo ❌ = gap de config, no flujo distinto) · `docs/codigo/REFERENCIA-FLUJOS.md` §14/§15 · memorias `synth-lender-type-boundary`, `frontend-e2e-*`, `backend-e2e-dev-target`.

## Deuda técnica / hardcodes
La tesis de arriba ("ifs quemados por ID") tiene un inventario verificado con `archivo:línea`. Ítems load-bearing:
- **P0 vivo**: `dd($exception)` en `Wompi.php:78` corta en prod cualquier request que toque ese path.
- **~37.284 copias de reglas por sucursal** (5% ya derivada; 42 entidades corriendo el corte de Banco de Bogotá 640 sin decisión explícita).
- **Cognito sin validar el JWT** (`auth.cognito`, hallazgo de seguridad #12).
- Fuentes: `docs/codigo/LOGICA-QUEMADA.md` (240 líneas, IDs/status/rt quemados) · `docs/codigo/HALLAZGO-GESTION-REGLAS-POR-SUCURSAL.md` (mecanismo + números) · `docs/vision/UNIFICACION-Y-RESPONSABILIDADES.md` (apéndice Fallas 1-4) · `docs/operacion/hallazgos-backend.md`.

## Cómo se lee este árbol
- **RAÍZ** (este nodo, `main`) = la base del ecosistema; el punto de entrada para entender el todo.
- **FLUJOS** (hijos directos, `main`) = documentación productiva de cada flujo del ecosistema (Motai, Credifamilia, …), siempre al día con `main`. Material de referencia.
- **TAREAS** (nietos, ramas propias) = trabajo sobre un flujo, con ramas por repo (pueden nacer de bases distintas: application desde main, legacy desde staging, …). Usan la documentación del flujo padre; no la repiten.

## Convenciones
- **Nomenclatura:** ALIADOS = `application` · REFACTOR = `legacy-backend`+`frontend-monorepo` · COMERCIO = `allied` · SUCURSAL = `allied_branch` · `response_type` 0/1/4 = bróker, 2/3 = CreditopX operador · Estado **11** = frontera originación↔servicing.
- **Ramas base:** RAÍZ y FLUJOS = `main` (documentación al día). TAREAS = libres por repo.
- **Regla de oro playground:** `playground/*` se commitea local, sin push; los repos reales (application/legacy-backend/frontend-monorepo) viven en ramas/stashes locales — no armar PRs sin pedir.
- **Glosario e IDs (colisiones):** verificá el **namespace** antes de tocar un id literal — `24` = lender Credifamilia **vs** allied Creditop · `100` = lender Bancolombia Consumo **vs** un allied · `158` = allied Motai (comercio) **vs** su lender · `160`/`152`/`153` = SmartPay (prod/dev). Glosario canónico (14 choques PRD×código×docs): `docs/NOMENCLATURA-NEGOCIO.md`.

## Bitácora
- **2026-07-17** — La raíz absorbió el material TRANSVERSAL (Datos/tablas clave, Estados y catálogos, Frontera de pruebas/harness, Deuda técnica) como resúmenes compactos que apuntan a los docs profundos como fuente — en vez de crear un 2º tipo de nodo "referencia" (que recrearía las subcarpetas de `docs/` dentro del árbol). Decisión: el árbol modela FLUJOS; lo transversal es sustrato del ecosistema y su hogar fiel es la raíz. Roster de flujos: creditopx (tronco) · agregadores · motai · credifamilia · smartpay · continuacion-servicing.
- **2026-07-17** — `application` (el monolito) se movió de Bitbucket a GitHub: ahora vive en `github/legacy-application` (mismo código PHP; el clon de `bitbucket/application` fue eliminado). Los 3 repos del ecosistema quedan en GitHub. OJO: `github/loan-application` es OTRO repo (microservicios Go de Onboarding & Risk — Lambda/Terraform), no el monolito.

## Enlaces
- Índice maestro: `playground/docs/CREDITOP.md` (§12 con leyenda).
- Modelos y canales: `docs/negocio/MODELOS-Y-CANALES.md` · Estado migración: `docs/codigo/ESTADO-MIGRACION.md`, `docs/codigo/PENDIENTES-MIGRACION.md`.
- Nomenclatura de negocio: `docs/NOMENCLATURA-NEGOCIO.md`.
