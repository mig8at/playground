# CreditOp · raíz
> **estado:** al día con main · Plataforma colombiana de crédito en punto de venta y ecommerce; nodo CENTRAL del árbol — leelo primero para entender el ecosistema. ARRIBA cuelgan los CONTEXTOS (temas acotados, con jerarquía); ABAJO las TASKS (trabajo con ramas propias). Es también el HOGAR de lo transversal que ningún contexto dueña (datos, estados, harness, deuda).

## Qué es
CreditOp conecta 3 actores: **COMERCIOS** aliados (`allieds`, con SUCURSALES `allied_branches` como puerta de entrada por `hash`), **CLIENTES** que financian una compra, y **~150 LENDERS** que ponen el dinero. Usa DOS SOMBREROS:

1. **BRÓKER / marketplace** — muestra opciones y arma la solicitud, pero un tercero externo presta, decide y cobra (`response_type` **0** UTM/referido, **1** Integración por API, **4** Credifamilia por SOAP).
2. **OPERADOR** bajo la marca **CreditopX** (rt=**2** in-platform, rt=**3** cupo rotativo) — CreditOp origina, firma con OTP+pagaré, desembolsa hasta el **Estado 11 (Autorizada)** y lleva la cobranza; PERO el capital y el riesgo los pone el COMERCIO (marca blanca; CreditOp gana comisión por recaudo).

Una operación = combinación de **4 ejes ortogonales**: `response_type` (quién decide/gestiona) · producto/garantía (compra · SmartPay=celular con bloqueo MDM · Motai=arrendamiento/renting) · modo del comercio · canal (WooCommerce/self/VTEX, asesor con QR, Corbeta por lotes). El **Estado 11 es la frontera** entre originación y servicing/cartera.

## Los 8 invariantes · leé esto ANTES de concluir

Cada uno corrige una conclusión que parece obvia y es falsa. Están medidos y tienen su hallazgo; si vas
a afirmar algo que los contradice, medilo primero.

1. **La conducta la decide el PAR (comercio, entidad), no la entidad.** Si existe
   `lender_allied_credentials` para ese (lender, sucursal) se invoca la integración; si no existe, el
   flujo **ni siquiera llama**. Por eso «Bancolombia falla» casi nunca es cierto: falla *Bancolombia en
   ese comercio*. Explica de una sola vez F-25, F-26 y F-28 → **F-34**.
2. **No hay herencia viva: la configuración se COPIA.** entidad → comercio → sucursal → categoría, y la
   copia se dispara al habilitar la entidad (~37.000 filas por sucursal). Cambiar la regla «del lender»
   no cambia las copias que ya existen.
3. **Un comercio puede cambiar la FORMA del flujo, no sólo sus reglas.** El setting `corbeta_allieds`
   ([24, 209, 210, 211, 311]) salta el formulario y **fabrica** la info laboral — y como el buró se
   dispara al guardar lo laboral, ese comercio no consulta buró. Buscar «por qué no consultó» en el
   motor de buró es el camino equivocado.
4. **Un estado dice DÓNDE está la solicitud, nunca QUÉ completó.** El 10 pertenece al tramo de cierre y
   significa «adentro, sin firmar» (**F-103**); la fila del 9 **se escribe al CREAR** la solicitud
   (**F-106**); y `user_request_records` **no registra todas las transiciones** — los estados 1 y 10
   nunca dejan fila (**F-105**). Tres falsos verdes distintos, un solo error de lectura.
5. **La ausencia de un log no prueba nada.** Sólo ~13 % de las líneas dice a qué solicitud pertenece, y
   lo dice con tres nombres distintos (**F-102**); el wizard no manda logs a Loki (van a PostHog); y el
   webhook `lender-result` no registra su recepción (**F-94**). «No aparece en los logs» y «no ocurrió»
   son afirmaciones distintas.
6. **Un filtro por rol con `when()` encadenados falla ABIERTO.** Si ninguna condición matchea, no se
   aplica *ningún* filtro y el usuario ve el universo entero. Es lo que le mostraba a SmartPay los
   créditos de Mediarte y Pullman. Al crear un perfil nuevo hay que auditar esos encadenados uno por
   uno → contexto `actors`.
7. **Parte de la lógica de negocio vive en la BD y `grep` no la encuentra.** 42 procedimientos y
   funciones almacenados en MySQL calculan cosas que decide el negocio —el ingreso promedio y la
   ocupación que fijan la categoría, los 23 features `EX_*` del perfilador ML, el revolvente rt=3— y se
   invocan como STRING dentro de `DB::scalar`/`CALL`, así que buscar el nombre del campo en el código
   nunca llega a la fórmula. ⚠ Y **4 de esas 42 no tienen código fuente en ningún repositorio**, dos de
   ellas llamadas desde producción. Contexto `db-routines`.
8. **Verificá el NAMESPACE de un id antes de usarlo.** `24` = lender Credifamilia **y** allied Creditop ·
   `100` = lender Bancolombia Consumo **y** un allied · `158` = allied Motai **y** su lender ·
   `160`/`152`/`153` = SmartPay según el ambiente. Y el `response_type` de un lender **cambia entre
   ambientes**: verificarlo contra local miente (**F-95**).

## Dónde mirar · LA ARISTA (comercio × lender)

CreditOp es un **muchos-a-muchos**: un comercio ofrece varios lenders y un lender está en varios
comercios. El invariante 1 dice que **la conducta vive en la ARISTA**, no en los nodos — y por eso las
tablas que la representan son la puerta de entrada más rentable de todo el árbol. Todas en
`application/app/Models/`:

- **`application/app/Models/LendersByAllied.php:12`** (tabla `lenders_by_allieds`; las columnas de la calculadora, en `:19 $fillable`) — **la calculadora completa** de reglas
  comercio × entidad. Si una regla «del lender» no se aplica como esperabas, la fila que manda está
  acá, no en `lenders`.
- **`LendersByAlliedBranch.php:12`** (tabla `lenders_by_allied_branches`; `:14 $fillable`) — la capa de SUCURSAL: `url_utm`,
  `sort`, `status`. Es la que decide si la entidad **se ve** y en qué orden.
- **`LenderAlliedCredential.php:20`** ($fillable) — la credencial del par. **Su existencia decide si la integración
  se invoca o si el flujo ni siquiera llama** (F-34). Es la tabla que explica «esta entidad funciona en
  un comercio y no en otro».
- Los nodos: **`Allied.php:13`** (comercio) → **`AlliedBranch.php:12`** (sucursal, la puerta por `hash`)
  → **`Lender.php:12`** (entidad; el `response_type` que despacha todo está en su `:27 $fillable`) →
  **`UserRequest.php:18`** (la solicitud: el evento que une los dos lados).

⚠ **No hay herencia viva: se COPIA** (invariante 2). La copia se dispara al habilitar la entidad en el
comercio, desde el admin de `application` — ~37.000 filas por sucursal. Cambiar la config «del lender»
NO toca las copias existentes.

Para la lógica que LEE estas tablas: `creditopx` (la cascada rt=2), `merchants` (config por comercio),
`entities` (qué es un lender como dato), `actors` (quién puede ver qué).

## Arquitectura
Migración **strangler-fig en parallel-run**. La lógica vive repartida entre `application` (el VIEJO) y el par `legacy-backend + frontend-monorepo` (el NUEVO). En NEGOCIO: a `application` se le dice **ALIADOS**; al conjunto `legacy-backend + frontend-monorepo` se le dice **REFACTOR**. Detalle por repo → contextos **application** · **legacy-backend** · **frontend-monorepo** · **architecture**.

- **ALIADOS = `application`.** Monolito Laravel+Vue (NO modular): dominio en `app/` (Models, Http/Controllers/{Admin,Customer,Api}, Services, Console/Commands, Jobs) y rutas por audiencia (`admin.php`, `customer.php` ~37KB, `api.php`). Es el sistema HISTÓRICO y el runtime POR DEFECTO: corre la originación de casi todos los comercios y aloja EN EXCLUSIVA la creación de ENTIDADES/COMERCIOS, la asignación de SUCURSALES (con la copia de reglas/datacrédito por sucursal), el panel admin + SSO Cognito, y TODA la cobranza/servicing post-desembolso (crons diarios `UpdateCreditopX*`).
- **REFACTOR = `legacy-backend` + `frontend-monorepo`.** DESTINO de la migración; ya reconstruyó el núcleo de originación CreditopX (cierre rt=2/3, ecommerce/VTEX con contrato base64, cuota inicial Wompi, identidad, device-lock SmartPay), self-contained y validado e2e.
  - `legacy-backend` = Laravel MODULAR (nwidart/laravel-modules, `Modules/*`: Onboarding · Loans · Risk · Identity · Payments · Partner · System) + arquitectura V1/V2 = Controller delgado → Service → Command → Repository con envelope `{code,message,data}`.
  - `frontend-monorepo` = monorepo Turborepo+pnpm (`apps/loan-request-wizard` = wizard React Router v7 + SSR; `packages/*` = librerías `@creditop/*`; `modules/loan-request-wizard/*` = DDD). El front NO toca la BD: es cliente HTTP de `legacy-backend` (`VITE_API_URL`).

**BASE DE DATOS COMPARTIDA.** `application` y `legacy-backend` comparten LA MISMA base (misma RDS/Redis/Pusher en prod durante el parallel-run). Por eso `app/Models/` se REPITE en ambos: el puente REAL es la BD, no HTTP. Dos ejes que NO confundir:
- **DEPENDENCIA** — legacy NO llama a application en runtime; el único acople de código es application→legacy vía `GenerateServicesBridgeClient` / `NewFrontendUrlService`.
- **CUTOVER** — application sigue corriendo porque el desvío al wizard nuevo está **apagado por defecto**: la compuerta son **dos filas de la tabla `settings`** (`new_frontend_allied_branches` = `{"hashes":[…]}` por SUCURSAL · `new_frontend_allieds` = `{"<allied_id>":true}` por COMERCIO), evaluadas con **OR** por `NewFrontendUrlService`; si dan false, la solicitud corre íntegra en el flujo Inertia de application. **No las crea ninguna migración ni seeder** (son datos de operación) y **legacy-backend no las conoce**: la decisión de cutover vive 100% en application. ⚠ No confundir con el array `[24,209,210,211,311]`, que es OTRA costura: el redirect del checkout ecommerce de Corbeta, ese sí hardcodeado. Detalle de las 4 costuras → contexto **architecture**.

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
- **Cheat-sheet de mocks/bypasses/stashes** (OTP, identidad, forms, PDF, buró) + la **receta de usuario sintético** + la encriptación del buró (`laravel_encrypt` AES-256-CBC): `git 159906a:docs/operacion/HARNESS-ARQUITECTURA.md` + `…/HANDOFF-PRUEBAS-ONBOARDING.md` + `…/E2E-DATA-TESTIDS.md`. Memorias `synth-lender-type-boundary`, `harness-setup`, `backend-e2e-dev-target`, `datacredito-rules-per-lender`.

## Deuda técnica / hardcodes
➤ **Inventario VIVO y verificado de los ifs-quemados-por-ID: contexto [[hardcodes-entidades]]** (auditoría 2026-07-18 — 24 de 31 acoplamientos BLOQUEAN la integración por-config; 101 sitios con `archivo:línea`). Es el nodo de DOLOR: si una tarea integra o toca el flujo de una entidad/comercio, entra ahí ANTES de sumar otro hardcode. Reemplaza como fuente viva a los `git 159906a:docs/codigo/LOGICA-QUEMADA.md` de abajo.

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
- **2026-07-18** — nodo de DOLOR **hardcodes-entidades** (contexto transversal bajo la raíz): auditoría de 40 agentes → 24/31 acoplamientos por-ID bloquean la integración por-config (101 sitios verificados). Es la fuente viva de la "Deuda técnica / hardcodes" de arriba. 32 combos.
- **2026-07-18** — **+5 nodos → 28 combos.** Primero el movimiento estructural: se indexaron 3 repos e2e (`pre-approvals-service` 133 · `backend-e2e` 24 · `harness` 66) → oráculo pasa a **6 repos / 5.325 nodos**, lo que por fin hace linkable la superficie de pruebas y del MS Go. Luego: **ecommerce** (canal VTEX/Woo/base64, 71) y **payments** (pasarelas Wompi/Payvalida, 65) colgando de la raíz; **harness** (arnés E2E, 66) bajo *architecture*; **corbeta** (canal batch retail, estado 26, 28) como subcontexto de *aggregator*; **ms-preapprovals** refrescado con el lado servidor Go (15→72). `payments` cruza a *formalization*+*servicing* (`contexts`); `aggregator` podado 117→105 (12 archivos puramente-Corbeta migrados al subnodo). Todo 0 DROP contra el oráculo.
- **2026-07-18** — `flows-curated/` ELIMINADA (ya no hay data duplicada; el engine solo lee `flows/`). Antes se promovieron sus 2 nodos huérfanos —**Credifamilia** (rt=4, bajo Entities) y **Servicing** (post-Estado 11, fase colgando de la raíz)—, que no tenían hogar en el modelo contexto/task. El resto era o bien superado por la versión enriquecida, o bien renombrado (agregadores→aggregator, credipullman→pullman), o bien material de referencia ya resumido acá arriba. Recuperable: `git show <commit>^:context/server/data/flows-curated/<nodo>/doc.md`.
- **2026-07-18** — CORRECCIÓN (del análisis de código del contexto **architecture**): la compuerta del cutover NO es un array hardcodeado — son 2 filas de `settings` evaluadas con OR por `NewFrontendUrlService`. El array `[24,209,210,211,311]` es otra costura (checkout ecommerce Corbeta). Estaban conflacionados.
- **2026-07-17** — Fase de data de la raíz: repuestas las secciones transversales (Datos/tablas clave · Estados y catálogos · Frontera de pruebas/harness · Deuda técnica) + Arquitectura + Convenciones/glosario, adaptadas al modelo contexto/task vivo y con punteros a `git 159906a:docs/*` (docs/ fue removido de main) + memorias. Superficie de código = 58 entrypoints arquitectónicos (routes/models/servicios clave/bridge/crons).
- **2026-07-17** — Reestructura al modelo contexto/task; data curada previa movida a `flows-curated/` para re-linkar; siembra de contextos desde `playground/flow`.

## Enlaces
- **CONTEXTOS por group:** architecture (**application** · **legacy-backend** · **frontend-monorepo** · **ms-preapprovals** · **harness**) · entities (**creditopx** · **aggregator** [subctx → **corbeta**] · **redirect** · **credifamilia**) · creditopx (**profiling** · **amount-tiers**) · merchants (**motai** · **smartpay** · **pullman**) · **onboarding** · **formalization** · **servicing** · **ecommerce** · **payments** · **hardcodes-entidades** (deuda transversal) · **kyc** · **dynamic-forms** · **actors** · **entities** · **merchants** · **architecture**.
- **TASKS:** **Motai v2** (des-motaización · rama `feature/motai-v2`).
- **⚠ `playground/docs/` fue absorbido en los nodos y REMOVIDO de main el 2026-07-17.** El análisis maestro `archivo:línea` sobrevive en **git @ `159906a`**: `git show 159906a:docs/<ruta>` (ej `git show 159906a:docs/codigo/FLUJO-CREDITOPX-Y-DEPS-APPLICATION.md`). Ir ahí para re-verificar o regenerar.
- Memorias del ecosistema: `atlas-mcp-cross-repo`, `modelos-canales-flujos`, `plan-simplificacion`, `nomenclatura-negocio`.
