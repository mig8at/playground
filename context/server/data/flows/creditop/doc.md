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
   salta el formulario y **fabrica** la info laboral — y como el buró se dispara al guardar lo laboral,
   ese comercio no consulta buró. Buscar «por qué no consultó» en el motor de buró es el camino
   equivocado. (⚠ La lista de allieds «Corbeta» DIVERGE según quién pregunta — setting vs varios
   hardcodes → `corbeta` §el gate.)
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
Las máquinas de estado son transversales; **este es el catálogo canónico — los contextos apuntan acá y
listan solo sus estados de llegada distintivos.** Tres catálogos que NO confundir:

- `user_request_statuses` — la SOLICITUD. Catálogo completo (verificado contra la BD local —dump de
  dev— el 2026-08-08, `SELECT id,name`):
  **1** Validación OTP · **2** Cédula cargada · **3** Seleccionó entidad · **4** No desembolsada ·
  **5** Desembolsada · **6** Negada · **7** No terminó proceso · **8** Cancelado · **9** Formulario de
  perfil · **10** Pendiente de autorización · **11 Autorizada = LA FRONTERA originación↔servicing** ·
  **12** Autorización negada · **13** Autorizado tesorería · **14** Autorizado contabilidad · **15**
  Autorizado mesa de servicio · **16** Autorizado analista · **17** Solicita codeudor · **18** Solicita
  documentación · **19** Cuota Inicial · **20** Aprobada no desembolsada · **21** En aprobación del
  médico · **22/23** Validación aprobada/rechazada, espera de revisión · **24** Rechazado por validación
  de identidad · **25** Pendiente de facturación · **26** Facturado · **27** Paz y salvo · **28**
  Autorizado pendiente desembolso.
- `creditop_x_user_request_statuses` (1-4) — el PRÉSTAMO in-platform post-11: 1 al día · 2 mora ·
  3 paz y salvo · 4 cancelado. Es «el que importa» para servicing. ⚠ No confundir su `3 paz y salvo`
  con el **27** de la solicitud: mismos nombres, namespaces distintos.
- `lender_transaction_statuses` (namespace propio, ej 40/41) — el espejo de los lenders rt=1/rt=4.

## Frontera de pruebas / harness
El mapa GLOBAL de simulación (material del OKR de metodología de pruebas) vive en el nodo **harness**,
tabla rt-por-rt. El resumen que no cambia: **lo in-platform (rt=2/3) se INYECTA** con usuario sintético
y se sella a Estado 11; **lo de integración (rt=0/1/4) lo decide un tercero** — se mockea el host y se
valida pre-aprobación/handoff, nunca el cierre. La receta del sintético y la fila Experian cifrada:
nodos `kyc` y `harness` §inyección.

## Deuda técnica / hardcodes
➤ **Inventario VIVO y verificado de los ifs-quemados-por-ID: contexto [[hardcodes-entidades]]** (auditoría 2026-07-18 — 24 de 31 acoplamientos BLOQUEAN la integración por-config; 101 sitios con `archivo:línea`). Es el nodo de DOLOR: si una tarea integra o toca el flujo de una entidad/comercio, entra ahí ANTES de sumar otro hardcode. Reemplaza como fuente viva a los `git 159906a:docs/codigo/LOGICA-QUEMADA.md` de abajo.

La tesis de arriba ("ifs quemados por ID") tiene un inventario verificado con `archivo:línea`. Ítems load-bearing:
- **P0 vivo**: el `dd($exception)` de Wompi corta en prod cualquier request que toque ese path → contexto **payments** (el dueño del detalle y su estado).
- **Copias de reglas por sucursal** (decenas de miles; el conteo y el corte heredado de BdB 640) → contexto **merchants**.
- **Cognito sin validar el JWT** (`auth.cognito` confía en headers) → contexto **actors**.
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
