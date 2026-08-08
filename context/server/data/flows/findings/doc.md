# Findings · registro vivo de hallazgos

> **estado:** abierto, se agrega al final · Bitácora de cosas que **costaron tiempo descubrir**: por qué algo se rompía, qué lo causaba de verdad y cómo se arregló. Nace de la sesión 2026-07-18 en la que se logró cerrar por primera vez un crédito CreditopX punta a punta en local.

## Para qué sirve

Cuando algo no funciona en local, la pregunta cara no es "¿cómo lo arreglo?" sino **"¿qué está realmente roto?"**. Varios de los muros de acá se veían como un bug del producto y eran una variable de entorno faltante; otros se veían como "el harness no hace nada" y eran un error que el front se tragaba en silencio. Antes de depurar un muro, buscalo acá.

Cada entrada trae: **síntoma** (lo que ves) → **causa raíz** (verificada, no supuesta) → **evidencia** (cómo se comprobó) → **arreglo** → **estado**.

## Cómo agregar un hallazgo

Agregá una sección `### F-NN · <título>` al final del bloque que corresponda, con esos cinco campos. Reglas:

- **La causa raíz va verificada.** Si es una hipótesis, decilo (`hipótesis, sin confirmar`).
- **Guardá la evidencia concreta**: la línea de log, la consulta SQL, el HTTP status. Sirve para reconocer el mismo problema la próxima vez.
- **Si el síntoma engaña, decilo en el título.** El valor está en romper la pista falsa (ej. "no era Bancolombia, era Payvalida").
- **Y agregalo al índice de abajo**, bajo la pregunta que contesta. Sin eso el hallazgo existe pero no se encuentra, que para este archivo es casi lo mismo que no existir.

---

## Dónde mirar

Este nodo no tiene puertas de código propias: es una **bitácora**, y su puerta es el índice de acá
abajo. Tres formas de entrar, en orden de rendimiento:

1. **Por síntoma** → la tabla de abajo. Es lo que contesta «¿ya nos pasó esto?» en un salto.
2. **Por `F-xx`** cuando venís de una cita: `harness/pkg/trace.ts`, `harness/pkg/cognito.ts`,
   `trazador/server/etapas.go` y `tablero/data/*.md` citan hallazgos por número. Buscá `### F-94`.
3. **Por texto crudo** cuando el síntoma no está en la tabla: `grep -n "<mensaje de error>"` sobre este
   archivo. Los hallazgos guardan la evidencia literal —la línea de log, el HTTP status, la consulta—
   justamente para que se reconozcan así.

⚠ Los archivos del `map.json` de este nodo son los que los hallazgos CITAN, no una superficie que este
nodo dueñe. Para entender un subsistema, andá a su nodo; acá está lo que ya salió mal en él.

## Índice · ¿con qué síntoma llegás?

Este archivo pesa **~58.000 tokens**: leerlo entero para responder una pregunta no es viable. Entrá por
acá, saltá al `F-xx` y leé sólo eso.

> ⚠ **Las letras A–O NO son temas, son historia.** La convención decía «al final de su sección
> temática», pero en la práctica lo nuevo se fue appendeando al final físico del archivo: hoy la
> sección «O · El código de compra en caja» contiene el código de compra (F-79…F-92) **y además**
> F-93…F-106, que son de datos, logs y estados y no tienen nada que ver. La sección «L · Motai» tiene
> harness, Cognito y ecommerce adentro. **No confíes en la letra: confiá en este índice**, que está
> armado por tema real y cruza las secciones. Y los números tampoco van en orden de archivo (F-73…F-77
> están arriba de todo).

| Si tu síntoma es… | Mirá |
|---|---|
| **«le salen menos cuotas de las parametrizadas»** | F-110 |
| **«le aprobaron cupo a alguien que no debía»** | F-112 |
| **«no sale la opción de una entidad, sin error»** | F-113 |
| **«esto anda en local y no en dev/qa» / «probé contra el ambiente equivocado»** | F-06 · F-18 · F-61 · F-62 · F-65 · F-73 · F-74 · F-76 · F-77 · F-95 |
| **«parece un bug del producto» (y es una env faltante)** | F-04 · F-05 · F-23 · F-70 · F-98 · F-99 · F-104 |
| **«la pantalla no avanza y no hay ningún error»** | F-01 · F-02 · F-03 · F-58 · F-88 · F-91 · F-92 |
| **«¿qué significa de verdad esta tabla/columna?»** | F-19 · F-24 · F-93 · F-96 · F-97 · F-100 · F-101 · F-103 · F-105 · F-106 |
| **«los logs no me dicen de qué solicitud son»** | F-20 · F-98 · F-99 · F-102 |
| **«no le aparece ninguna entidad en el listado»** | F-04 · F-34 · F-56 · F-75 · F-78 |
| **«¿qué integra de verdad este comercio / esta entidad?»** | F-25 · F-26 · F-27 · F-28 · F-34 · F-35 · F-37 |
| **«el buró: ¿se consultó para ESTA solicitud?»** | F-101 · F-107 |
| **«¿hay evidencia en la BD que el trazador no mira?»** | F-108 |
| **«¿esta herramienta es de verdad solo-lectura?»** | F-109 |
| **«el crédito no cierra en local»** | F-07 · F-08 · F-09 · F-10 · F-11 · F-12 · F-13 · F-29 · F-30 · F-31 · F-36 |
| **«falló la validación de identidad / se canceló solo»** | F-10 · F-55 · F-60 · F-62 · F-63 |
| **«firma, pagaré, OTP de firma»** | F-02 · F-11 · F-12 · F-30 · F-32 · F-36 · F-37 · F-58 · **F-121** |
| **«el pagaré dice una persona y la BD dice otra»** | **F-121** |
| **«el webhook del lender no llegó (¿o sí?)»** | F-94 · F-100 · F-111 |
| **«el agregador aprobó / el cliente firmó, y sigue en Seleccionó entidad»** | F-111 · F-94 |
| **«el perfilador / el orden del listado / el cupo»** | F-04 · F-93 · F-104 |
| **«¿por qué a este cliente no le salió esta entidad?»** | **F-118** · F-112 · F-115 |
| **«una entidad dejó de salir de un día para otro, sin deploy»** | **F-119** |
| **«el motor decidió sin evaluar las reglas»** | **F-120** |
| **Canal Corbeta y código de compra en caja** | F-79 · F-80 · F-81 · F-82 · F-83 · F-84 · F-85 · F-86 · F-87 · F-88 · F-89 · F-90 · F-91 · F-92 |
| **Bancolombia (BNPL / Consumo)** | F-05 · F-54 · F-83 · F-84 · F-89 · F-90 · F-91 · F-92 |
| **Motai · Ábaco · renting** | F-46 · F-47 · F-48 · F-49 · F-50 · F-51 · F-68 · F-69 |
| **SmartPay · IMEI** | F-21 · F-22 · F-23 · F-24 · F-32 |
| **Ecommerce** | F-40 · F-54 |
| **Flujo dinámico (RD)** | F-41 · F-42 · F-43 · F-44 · F-45 |
| **Rotativo (rt=3) y servicing** | F-38 · F-39 · F-114 · F-115 · F-116 · F-117 |
| **«el rotativo le dio cupo 0 y no sé por qué»** | F-115 · F-117 |
| **«lo que vio en pantalla no es lo que quedó guardado»** | F-114 |
| **«el mismo cálculo está hecho dos veces y no coinciden»** | F-71 · F-114 · **F-122** |
| **«el pagaré no se firma / Deceval lo rechaza»** | **F-122** · F-121 |
| **Tasas, fianza y cálculo** | F-71 · F-72 |
| **«el harness hace algo raro» (la herramienta, no el producto)** | F-14 · F-15 · F-16 · F-17 · F-33 · F-52 · F-53 · F-57 · F-59 · F-64 · F-66 · F-67 · F-87 · F-90 |

Un `F-xx` puede estar en varias filas a propósito: se entra por el síntoma, y el mismo hallazgo se ve
distinto según con qué pregunta llegues.

---

## A · Errores que NO dejan rastro visible

El patrón más caro de todos: la pantalla se rompe o no avanza, y no hay ni un error a la vista.

### F-01 · El loader SSR esconde los 5xx del backend

**Síntoma:** `/lenders` muestra "Error al obtener las opciones de financiamiento" y el log del harness no reporta nada; parece que el salto a lenders "no funcionó".
**Causa raíz:** el loader de `/lenders` corre en el **servidor** (SSR de react-router). Un 500 del backend nunca llega al browser como status 5xx — llega como HTML del error boundary. Los listeners de `page.on('response')` no lo ven.
**Evidencia:** el 500 solo aparece pegándole directo al endpoint: `curl .../api/onboarding/loan-application/lenders-v2/<ur>`.
**Arreglo:** `preflightLenders()` en `guided.spec.ts` consulta el endpoint **antes** de navegar e imprime el `message` del backend.
**Estado:** resuelto.

### F-02 · "Firmar" rebota a los documentos sin ningún mensaje

**Síntoma:** en `sign-documents` apretás Firmar y volvés a la misma pantalla, sin error. Repetible infinitas veces.
**Causa raíz:** el action de `sign-documents.tsx` envía el OTP del pagaré y, si falla, cae en un `catch` que solo reporta la excepción y **devuelve `undefined`** → sin `redirectTo` → el componente no navega. El error es invisible por diseño.
**Evidencia:** `laravel.ERROR: Failed to send OTP {"error":"[HTTP 401] Unable to create record: Authenticate"}` (Twilio).
**Arreglo:** ver F-12 (el bypass de OTP).
**Estado:** resuelto — pero **el patrón sigue vivo**: cualquier fallo dentro de ese action se ve como "no pasa nada".

### F-03 · Un `.catch(() => {})` convirtió una corrida rota en "1 passed"

**Síntoma:** el harness reporta éxito, pero el navegador no hizo nada de lo que dice el log.
**Causa raíz:** con la página cerrada, `goto`/`screenshot`/`pause` lanzan **todos**; envueltos en `.catch(() => {})` la corrida terminaba en verde. La foto del log era mentira: el `console.log('📸 …')` corre aunque el screenshot falle.
**Evidencia:** el `.png` conservaba la fecha de la corrida anterior; sin líneas `nav →`; duración anormalmente corta.
**Arreglo:** el salto distingue "ventana cerrada" de un error de navegación y **tira** en vez de tragarse el error.
**Estado:** resuelto. **Lección:** un `.catch` vacío sobre el paso que da sentido a la corrida es un mentiroso.

---

## B · Variables de entorno faltantes que parecen bugs del producto

Tres incidentes distintos, el mismo patrón: falta una env var → se arma una URL inválida → explota lejos del origen.

### F-04 · `/lenders` da 500 en todo local (H2O sin host)

**Síntoma:** ninguna solicitud puede listar entidades.
**Causa raíz:** falta `H2O_API_HOST` → `config()` da `null` → `->baseUrl(null)` → **TypeError**. No lo atrapa ningún `catch (Exception)` del profiler (`TypeError` extiende `Error`, no `Exception`) ni `profileWithFallback`, que **no tiene try/catch**. El fallback a matrices internas, que existe justamente para esto, nunca corre.
**Evidencia:** `PendingRequest::baseUrl(): Argument #1 ($url) must be of type string, null given` en `ProfilerMLController:96`.
**Arreglo:** `H2O_API_HOST=http://127.0.0.1:9` → falla rápido con `ConnectionException` (que **sí** extiende `Exception`) → cae al fallback. Restaura el comportamiento que antes daba el corto-circuito `return 404`, hoy ausente en `main`.
**Estado:** resuelto en local + `preflightLenders()` sugiere el fix si detecta la firma del error.

### F-05 · Elegir Bancolombia falla — y no era Bancolombia

**Síntoma:** "No pudimos procesar tu solicitud · código `<uReq>-63`".
**Causa raíz:** el lender #8 tiene en BD `action = App\Actions\Lenders\Payvalida` (el proveedor de **recaudo**). Sin `PAYVALIDA_HOST`, el template `{+host}/api/v3/porders` se resuelve **sin host**. La solicitud nunca salía hacia el banco.
**Evidencia:** `cURL error 3: URL rejected: No host part in the URL for /api/v3/porders`.
**Arreglo:** `mock-payvalida` (:8097) + `PAYVALIDA_HOST=http://host.docker.internal:8097`.
**Estado:** resuelto.

### F-06 · `localhost` desde el backend NO es tu máquina

**Síntoma:** el mock está arriba y responde por curl, pero el backend no lo alcanza.
**Causa raíz:** legacy-backend corre en Docker: `localhost` es el contenedor.
**Evidencia:** `docker compose exec laravel.test curl localhost:8097` → **HTTP 000**; `host.docker.internal:8097` → **HTTP 200**.
**Arreglo:** usar `host.docker.internal` en las env que apuntan a mocks del harness.
**Estado:** resuelto. **Ojo:** el truco inverso también aplica — para que algo falle *rápido* a propósito (F-04), `127.0.0.1:<puerto cerrado>` es ideal.

---

### F-73 · El backend de `qa` es OTRO servicio del mismo cluster — probar contra `dev` mide la rama equivocada

**Síntoma:** Ábaco responde `MOTV1000` ("no requiere") contra el ambiente remoto para Motai Renting #158, con la tabla `lender_requirements` correctamente sembrada (`abaco_is_enabled=1`) y el código mergeado en `qa`. Se lee como "el feature está roto" o "falta el deploy".
**Causa raíz verificada — dos servicios distintos, nombre del cluster engañoso.** En el cluster `inertia-develop` conviven **`legacy-backend`** (sirve la rama **`develop`**, workflow `main-dev.yaml`) y **`legacy-backend-qa`** (sirve **`qa`**, `main-qa.yaml` con `on: push: branches: [qa]`). El `.env.staging` del harness apuntaba su API a `legacy-backend.inertia-develop`, o sea **front desplegado de qa + backend de develop**. Y como la **BD sí es compartida** entre ambos, los datos se ven desde los dos y todo *parece* consistente: lo único que cambia es **qué código responde**. `develop` todavía decide Ábaco por los modos deprecados (`$isAbacoRequired = $this->isAbacoRequired($alliedMode->config)`) → sin modo activo (nadie los escribe desde junio) → `false` → `MOTV1000`.
**Evidencia:** mismo request a los dos hosts → `legacy-backend.inertia-develop` sin `allowed_document_types` (no tiene motai-v2), `legacy-backend-qa.inertia-develop` **con** el campo; las rutas del merge de Ábaco dan **404** en el primero y **405** (existe) en el segundo; ningún commit de `qa` es ancestro de `origin/develop` (14 vs 12 commits divergidos). Con el host de qa: `MOTV1001` + cadena completa.
**Arreglo:** `.env.staging` → `E2E_API_BASE_URL=http://legacy-backend-qa.inertia-develop/api` (la BD queda igual: es compartida a propósito). Documentado en `.env.staging.example`, en el `CLAUDE.md` de playground (decía "staging comparte BD/API con dev" — comparte BD, **no** API) y en la tabla de targets del `CLAUDE.md` de `harness`.
**Estado: resuelto y verificado.** Truco para saber qué rama tenés enfrente sin adivinar: `GET /api/loans/allied/{hash}` trae `allowed_document_types` **solo** con motai-v2, o sea solo en `qa`. **Lección:** cuando un feature "no funciona" en un ambiente remoto, lo primero es probar que ese host sirve la rama que creés — un dato en la BD compartida no dice nada del código desplegado.

---

### F-76 · El backfill de una migración NO cubre las filas futuras: Motai perdió el PEP en dev/qa sin que nadie tocara nada

**Síntoma:** el selector de tipo de documento de Motai **no ofrece PEP** en dev/qa. `GET /api/loans/allied/f0548728` → `allowed_document_types: ["CC","CE"]`. Silencioso: nadie tocó código ni configuración, y Motai apunta justamente a **migrantes con PEP**.

**Causa raíz verificada — el dato lo puso un backfill de una-sola-vez, y las filas se recrearon después.** La des-motaización movió los tipos de documento del `if merchantMode === 'motai-renting'` quemado en el front a `lenders_by_allied_branches.document_types`, y su migración hizo el backfill (piso `["CC","CE"]` para todos + `["CC","CE","PEP"]` para el lender 158). **Ese backfill funcionó** (4.070 filas con valor, 11 NULL). Pero la columna es *nullable sin default*, y las asociaciones del 158 se **volvieron a crear después** de la migración —junto con la reconfiguración de sus `group_rules`—, así que nacieron con `document_types = NULL`. El "piso" del código (`AlliedInfoController::resolveAllowedDocumentTypes`) arranca en `['CC','CE']` y suma lo que traigan las filas: con NULL no suma nada → sin PEP.

**Evidencia:** las 3 sucursales del 158 con `document_types = NULL` y **0 filas con PEP en toda la base**; sus ids son altos (`lab#39917/39922/39930`) → creadas después del backfill. En local no se veía porque la fila de prueba se había sembrado a mano **con** PEP.

**Arreglo (aplicado):** `UPDATE lenders_by_allied_branches SET document_types = '["CC","CE","PEP"]' WHERE lender_id = 158` → 3 filas; el endpoint pasó a `["CC","CE","PEP"]`. Es **configuración de datos**, no código.

**Estado: desbloqueado, pero la causa sigue viva.** Poner el dato a mano no evita que se repita con la próxima sucursal o entidad que se habilite. Las filas se crean en `Modules/Partner/App/Services/AlliedManagementService.php` (`LendersByAlliedBranch::create`, en dos lugares) **justo al lado de donde se copian las reglas** (`addNewRule`/`addNewLenderRule`) — ese es el punto natural para que hereden los tipos de documento. Alternativas: default a nivel de columna, o mover el dato a `lender_requirements` (ya es la tabla de requisitos POR LENDER, y "acepta PEP" es una propiedad del lender más que de la sucursal). **Sin decidir.**

**Lección.** Un backfill migra el **pasado**; si el dato lo consume una fila que se crea dinámicamente, hace falta además que **el punto de creación lo herede** o que la columna tenga default — si no, el feature se degrada en silencio meses después y el síntoma no apunta a la migración. Y la trampa de método: validar la config en local con una fila **sembrada a mano** oculta exactamente este agujero. Cuando un dato "des-quemado" pasa a config, hay que probar el camino que la crea, no solo un caso plantado.

---

### F-77 · Mergear a `qa` NO aplica migraciones: el deploy solo actualiza el servicio ECS

**Síntoma:** el PR está mergeado en `qa`, el deploy salió verde, el código nuevo responde… y el comportamiento que **depende de una migración** sigue como antes. Se lee como "la migración falló" o "el backfill no hizo nada".

**Causa raíz verificada — el workflow de deploy no corre `artisan migrate`.** `.github/workflows/main-qa.yaml` (y su gemelo de dev) solo delega en `Creditop-SAS/config-ci/.github/workflows/deploy-ecs-service.yaml`: construye la imagen y actualiza el servicio. Las migraciones viven en un workflow **aparte y manual**, `.github/workflows/run-migrations.yml`, que es `workflow_dispatch` y **pide a mano** imagen + host + usuario + base + password. Nadie lo dispara solo.

**Evidencia:** en la BD compartida dev/qa, la tabla `migrations` tiene las tres de `lender_requirements` (batches 188, 190, 191) pero **ninguna** de las dos que mergeé en el PR #1028 (`2026_07_28_100000_backfill_abaco_is_enabled_from_lender_product`, `2026_07_28_110000_drop_allied_modes_and_user_request_modes_tables`). Consecuencia concreta: `allied_modes` y `user_request_modes` **siguen existiendo** en dev/qa, y el backfill nunca corrió — que Ábaco siguiera pidiéndose fue **suerte**: la fila de `lender_requirements` del 158 ya existía desde el 2026-07-14 (la puso el trabajo de Fercho), no el backfill.

**Ojo con el workflow manual.** Leyendo `run-migrations.yml` tiene dos problemas de forma (no lo ejecuté, es lectura): usa `inputs.aws_key_id`, `inputs.aws_secret_access_key`, `inputs.aws_region` y `inputs.aws_bucket`, que **no están declarados** en `on.workflow_dispatch.inputs`; y al `docker run` le faltan las barras de continuación después de `--env AWS_ACCESS_KEY_ID=…`, así que el comando se corta antes de `php artisan migrate`. Tal como está, es probable que ni corra.

**Arreglo / procedimiento:** después de mergear algo con migraciones a `dev`/`qa`, **disparar `run-migrations` a mano** (o pedirlo a quien tenga los secretos) y **verificar en la tabla `migrations`** que la fila apareció. No dar por aplicada una migración porque el deploy salió verde. Emparejar con [F-73] (el backend de `qa` es otro servicio) y [F-76] (un backfill no cubre filas futuras): las tres son formas distintas de creer que un cambio está en un ambiente cuando no está.

---

## C · Lo que en local es simulado (y qué tan fiel es el resto)

### F-07 · La pre-aprobación y el cupo de las tarjetas son inventados

**Síntoma:** una tarjeta dice "Pre aprobado · Cupo disponible $25.000.000 · 1,88% M.V".
**Causa raíz:** sale de `mock-preapprovals` (`MOCK_PA_CUPO=25000000`, `MOCK_PA_RATE=0.0188`), no de la lógica real.
**Evidencia:** el crédito quedó con **tasa 1,82**, no 1,88 → los términos finales sí los calcula el backend; la *decisión* de mostrarlo pre-aprobado, no.
**Arreglo:** `E2E_REAL_PREAPPROVALS=1` apunta al MS real (más lento, necesita VPN).
**Estado:** por diseño. **Implicancia:** el harness sirve para probar **el cierre**, no **la decisión de qué se ofrece**.

### F-08 · Qué es REAL en un cierre CreditopX local

Auditado contra la BD tras cerrar un crédito completo:

| Real | Simulado / ausente |
|---|---|
| Máquina de estados (llega a **Estado 11 "Autorizada"** con `request_number`) | Pre-aprobación y cupo de las tarjetas (F-07) |
| Términos calculados por el backend (tasa 1,82 · 12 cuotas · final 1,6M · inicial 800k) | Siembra del `user_request` (INSERT directo: saltea monto/teléfono/OTP/datos) |
| Registro `creditop_x_user_requests_records` | Link por WhatsApp (messaging service :8082 caído) |
| Filas de `otps` (el bypass persiste el registro igual que uno real) | AML TusDatos (driver fake, `job-fake-12345`) |
| Generación de documentos en el backend (14KB/10KB/435KB) | `user_request_documentations` y `netco_signing_documents` quedan **vacías** (sin S3) |

**Además:** el **voucher de desembolso falla** post-Estado-11 (`Voucher generation failed: Trying to access array offset on null`) — sin diagnosticar.

### F-09 · Con `standBy` NO hay pago por pasarela, y está bien

**Síntoma:** el crédito llega a Estado 11 sin ninguna fila en `payment_gateway_transactions`, pese a tener `initial_fee = 800.000`.
**Causa raíz:** es correcto. Con `standBy` el flujo NO pasa por `initial-fee-payment` (el guard `&& !response.data.standBy`); la cuota inicial no se cobra por pasarela en la rama in-platform.
**Estado:** no es un bug. Anotado porque **parece uno**.

---

## D · Los 4 muros para cerrar un crédito rt=2 en local

Superados los cuatro, un CreditopX cierra punta a punta (verificado: Estado 11 con `request_number` real).

### F-10 · Captura de identidad (ADO)

Foto del documento contra un proveedor externo: imposible con usuario sintético. Es **client-side**, así que no deja rastro en el backend — una corrida se trabó 20 minutos en silencio absoluto. Se saltea navegando directo a `first-payment-date`.

### F-11 · Los PDFs del cierre no cargan

`sign-documents` previsualiza consentimiento/pagaré/garantía desde `local-mock.s3.amazonaws.com`, host que **no existe** en local → "Error al cargar el documento" ×3 → no se puede firmar. Resuelto con `pkg/pdf-mock.ts` (PDF mínimo válido + CORS; solo intercepta buckets falsos, así que contra dev no toca nada).

### F-12 · El OTP de la firma sale por Twilio

401 en local. El backend **ya tiene** bypass de QA: si el teléfono está en el setting `qa_otp_bypass_phones` y `APP_ENV` es local/development, no manda SMS y el código son los **últimos 6 dígitos del celular**. El teléfono del harness (`3131010101`) no estaba en la lista. Agregado.

> **Ojo con la pista falsa:** buscar una *tabla* `qa_otp_bypass_phones` da "no existe" y lleva a concluir que el bypass no está implementado. Es una **fila de `settings`** (migración `add_qa_otp_bypass_phones_to_settings_table`).

### F-13 · Wompi (cuota inicial)

`pkg/wompi-mock.ts` ya existía y `guided.spec.ts` no lo usaba. Aplicado a las dos ventanas. No se ejercita en la rama in-platform (ver F-09).

---

## E · Cosas que el harness hacía mal

### F-14 · El harness arrastraba al usuario de vuelta al listado

**Síntoma:** tras elegir lender, la ventana A pasaba del handoff `/continue` a mostrar los lenders de nuevo.
**Causa raíz:** `cognitoLogin()` espera **15s** al input de usuario antes de concluir que no hay form. Con la sesión cacheada ese form nunca aparece, así que la entrada quedaba bloqueada mientras el usuario ya operaba; al desbloquearse, un "reintento del salto" veía que la URL ya no era `/lenders` y navegaba de vuelta.
**Evidencia:** el log salía **desordenado** — `entrada DIRECTA` aparecía después del journey completo de la otra ventana.
**Arreglo:** preguntar antes si hace falta login (`needsCognito()`) en vez de llamar a ciegas; el reintento vive dentro de la rama de login.
**Estado:** resuelto. **Lección:** un log fuera de orden delata que el script está bloqueado en otro lado.

### F-15 · La ventana B era una caja negra

Todos los listeners colgaban de A, así que 20 minutos de flujo del cliente no dejaron una sola línea (F-10). Ahora B tiene los mismos: navegaciones, console, `pageerror` y 5xx. **Encontró su primer muro (F-11) en la corrida siguiente.**

### F-16 · Un selector CSS pisaba el handler de otro botón

`document.querySelectorAll('.copy')` reasignaba el `onclick` de un botón que ya tenía el suyo, y reventaba con `$(undefined)`. Bug **preexistente**, invisible hasta que otro botón compartió la clase. Arreglado acotando a `.copy[data-copy]`.

### F-74 · El sweep resolvía el backend por su cuenta: contra `dev` registraba en LOCAL y dejaba la solicitud huérfana

Reincidencia de **F-65** por un camino que ese arreglo no cubría.

**Síntoma:** `sweep matrix/abaco` con `E2E_TARGET=dev` → todo 500 con `Attempt to read property "user_request_status_id" on null`. Parece un bug del backend de dev o una regresión del merge recién subido.
**Causa raíz verificada:** `dev/sweep.ts` tenía su **propia** resolución del API — `const API = process.env.E2E_MOCK_URL ?? 'http://localhost'` — sin pasar por la cadena por target. `.env.dev` define `E2E_API_BASE_URL` pero **no** `E2E_MOCK_URL`, así que el fallback mandaba el `register` del cliente al backend **LOCAL** mientras los `INSERT` (que sí usan `pkg/db.ts`) iban a la BD de **DEV**: el `user_request` nacía apuntando a un `users.id` que solo existe en local → **huérfano** → cualquier endpoint que resuelve el usuario revienta. `pkg/config.ts` ya lo resolvía bien (eso fue F-65); este archivo no lo usaba.
**Evidencia:** en dev **ningún** user con el teléfono de prueba `3131010101`; el `user_id` que referenciaban los uReq (`1828535`) existía **en local**, creado a la hora exacta de la corrida; los uReq sí estaban en dev.
**Arreglo:** `dev/sweep.ts` usa `config.mockUrl` (override por `E2E_MOCK_URL`, si no la cadena `.env.<target>`). Verificado: `local → http://localhost` · `dev → legacy-backend.inertia-develop` · `staging → legacy-backend-qa.inertia-develop`, y la regresión del camino local pasa.
**Estado: resuelto.** **Lección:** cada script que hable con el backend debe pedirle la URL a `pkg/config.ts`; una resolución propia con fallback a `localhost` no falla ruidosamente, **escribe en dos bases a la vez** y el síntoma aparece dos capas más abajo. Si ves 500 con "property ... on null" en un flujo sembrado, sospechá SIEMPRE de un uReq huérfano antes que del producto.

---

## F · Trampas al verificar (falsos negativos propios)

Errores cometidos **al comprobar**, que casi llevan a "arreglar" cosas que no estaban rotas.

### F-17 · La CSP de la página de login rompe tus pruebas de fetch

Un `fetch` cross-origin de prueba fallaba con "Failed to fetch" y parecía que el mock no servía. Era que el wizard había redirigido a `login.creditop.com`, cuya CSP bloquea fetches externos. **Verificá desde un origin sin CSP.**

### F-18 · `E2E_TARGET` default es `dev`, no `local`

Un script de diagnóstico consultaba **dev** sin avisar, y los datos no cuadraban (fechas de otro día, filas inexistentes). Exportá `E2E_TARGET=local` explícito en cualquier consulta suelta.

### F-19 · La tabla de credenciales es POLIMÓRFICA

`lender_allied_credentials` no tiene `allied_branch_id`: usa `allied_type` + `allied_id`, y la credencial puede colgar del **comercio** o de la **sucursal**. Buscar solo por sucursal da un falso "no tiene" (Motai la tiene a nivel comercio, id 554).

### F-20 · El `laravel.log` local está tapado de ruido

Llegó a **1,2 GB** de `Driver [loki] is not supported`: `GRAFANA_LOKI_ENABLED=false` no registra el driver, pero el canal `stack` de `config/logging.php` lo sigue listando. Los errores reales **sí** llegan, pero enterrados: buscar en una ventana chica del final da "no hay nada". Truncar con `: > laravel.log` (no `rm`: php-fpm lo tiene abierto y no liberarías el espacio). `LOG_CHANNEL=daily` acotaría el crecimiento.

---

## G · Canal SmartPay (IMEI / bloqueo de dispositivo)

### F-21 · La originación distintiva de SmartPay NO puede dispararse fuera de producción

**Síntoma:** se prueba el canal SmartPay en local (o dev) y el flujo se comporta como un CreditopX rt=2 común: no salta el AML, no aparece el "Acuerdo de bloqueo de dispositivo", no hay desembolso diferido.

**Causa raíz — una inconsistencia dentro del propio código:**

```php
// app/Models/UserRequest.php:189
public function isSmartPay(): bool
{
    return $this->isImeiPath() && (int) $this->lender?->id === 160; // hardcode
}
```

```php
// config/lenders.php:24  — el MISMO canal, resuelto por entorno
'smartpay_lender_id' => env('APP_ENV') === 'production' ? 160 : 153,
```

El branding del mailer (`Lender::isSmartpayChannel()`) usa el **config consciente del entorno**; la originación usa un **160 hardcodeado**. Como fuera de producción el lender de SmartPay es el 153, `isSmartPay()` es **siempre false** en local y en dev.

**Qué queda gateado detrás de ese hardcode** (o sea: NO testeable fuera de prod):
- `TusDatosService:442` → el **skip del AML** de fondo
- `DeviceLockAgreementService:51` → el **acuerdo de bloqueo de dispositivo** (el contrato distintivo, en vez de pagaré + garantía + Netco)
- `ContinueUserFlowController:91` → su rama del flujo de continuación

**Qué SÍ funciona igual** (porque cuelga de `isImeiPath()` o del path del lender, no del id):
- `AddOriginationFlowType:54` emite `metadata.lender_path = lender->path->name` → **el wizard corre la rama IMEI** (selección de equipo y escaneo de IMEI)
- `AdoController:256` → credenciales de ADO por-lender
- Los crons de servicing device-lock (leen lenders con path IMEI)

**Evidencia:** en el dump local existen el **152** (`smartpay`, rt=2, path IMEI) y el **153** (`SmartPay`, rt=1, path IMEI); **no existe el 160**. Con el 152 el listado y la rama IMEI del front funcionan, pero los tres puntos de arriba no.

**Arreglo:** ninguno aplicado — es una decisión de producto, no del harness. Dos caminos: (a) clonar un lender con `id=160` en la BD local (patrón de `close-lender.ts`) para destrabar el flujo completo sin tocar código; (b) que `isSmartPay()` consuma `config('lenders.smartpay_lender_id')` como su hermano `isSmartpayChannel()` — **probablemente el bug real**, porque hoy la feature no es ejercitable en ningún entorno de prueba.

**Estado:** abierto · **vale reportarlo al equipo.**

### F-22 · CeluRD es el comercio del canal, y es RD (no Colombia)

**Síntoma:** al probar SmartPay los montos salen en `RD$` y el formato cambia.
**Causa raíz:** no es un bug: el canal es dominicano. `CeluRD Test` (allied **270**, sucursal `1bfb8cd0`) tiene `country_id = 60` (RD), y el seeder y el contrato por defecto del canal también son RD (locale `es_DO`, moneda `DOP`).
**Evidencia:** el listado renderiza `RD$ 2,000,000` y la sucursal aparece como "Celu Rd Santo Domingo".
**Estado:** informativo. Ojo al comparar cifras con los comercios colombianos — **no son la misma moneda**.

### F-23 · El escaneo de IMEI no funciona en local (MDM con host falso)

**Síntoma:** el flujo SmartPay llega hasta el handoff del asesor y el escaneo del IMEI no completa.
**Causa raíz:** `AlliedProductService::enroll` hace **dos** llamadas al merchant-gateway (Trustonic), ambas con header `X-Lb-Tenant-Id` = `allieds.trustonic_tenant_key`:
1. `POST /device-locking/devices/enroll` `{ imei }`
2. `GET /device-locking/devices/status?deviceIds=<imei>` → `{ devices: [ { marketName, model, manufacturer } ] }`

Con la respuesta de (2) **crea el Product y asocia el IMEI** al `user_request`. Si `devices` viene vacío, corta con "No se encontró el IMEI". En local `MERCHANT_GATEWAYS_HOST=https://merchant-gateways.fake` → no resuelve. Además `CeluRD.trustonic_tenant_key` estaba en **null**.
**Arreglo:** `mock-mdm` (:8098, implementa enroll/status + lock/unlock/release para los crons de servicing) + `MERCHANT_GATEWAYS_HOST=http://host.docker.internal:8098` + tenant key sembrada.
**Evidencia:** `POST device/register {imei:'356938035643809', user_request_id}` → `"Dispositivo registrado correctamente"`, con fila en `user_request_products` (imei asociado) y el producto creado desde la respuesta del MDM.
**Estado:** resuelto.

> **Dato práctico:** el IMEI se valida con `size:15` (exactamente 15 caracteres) en `AssociateImeiRequest`. El equipo NO se elige de un catálogo previo: **lo determina el MDM** a partir del IMEI escaneado.

### F-24 · `requires_imei` nunca se guarda (mass assignment silencioso)

**Síntoma:** ningún producto de la base tiene `requires_imei = 1`, ni siquiera los que crea el enrolamiento de IMEI.
**Causa raíz:** `AlliedProductService::enroll` hace `Product::firstOrCreate([...], ['requires_imei' => 1, ...])`, pero **`requires_imei` no está en `Product::$fillable`** → Eloquent lo descarta sin avisar. El producto se crea con el default de la columna (0).
**Evidencia:** producto #194 creado por un enrolamiento real quedó con `requires_imei = 0`; `SELECT COUNT(*) FROM products WHERE requires_imei = 1` → **0** en toda la base.
**Impacto:** hoy **latente** — el único uso de `requires_imei` en `app/` y `Modules/` es esa escritura, nadie lo lee. Pero la intención del código está rota y cualquier consumidor futuro leería datos incorrectos.
**Arreglo:** agregar `requires_imei` al `$fillable` (una línea). No aplicado — es código de producto.
**Estado:** abierto · vale reportarlo junto con F-21.

---

## H · Qué integra de verdad cada entidad (relevado, no supuesto)

### F-25 · La mayoría de las entidades NO llama a nadie — no necesitan mock

**Síntoma:** se asume que ninguna entidad se puede probar en local porque los hosts del `.env` son `*.fake`.
**Causa raíz:** falso. Probando entidad por entidad contra el backend real, la mayoría **no hace ninguna llamada saliente** al seleccionarla: devuelve un modal con la URL del portal del proveedor, que sale de config, no de una API.

| Entidad | Al seleccionar | ¿Mock? |
|---|---|---|
| Sufi #7 (rt0) | modal "Continua el proceso con el asesor comercial" | **no** |
| Su+pay #11 (rt1) | modal | **no** |
| Meddipay #39 (rt1) | modal | **no** |
| Addi #6 (rt0) | modal "Se ha enviado un mensaje de WhatsApp con un link" | **no** |
| Sistecrédito #9 (rt1) | `GET /getCreditToken` | **sí** |
| Bancolombia #8 (rt1) | Payvalida `POST /api/v3/porders` | **sí** (F-05) |

**Implicancia:** toda la rama **agregador / self-management** —la del modal "seguí en tu celular"— ya era testeable en local sin construir nada. La `action` del lender en BD dice quién integra: `(sin action)` = no llama.

**Estado:** relevado. Mock para los que sí integran: `mock-lenders` (:8099).

### F-26 · Dos fallos que NO se arreglan mockeando

Aparecieron en el mismo relevamiento y conviene reconocerlos para no perder tiempo:

- **Banco de Bogotá #5** → `Undefined variable $certPath` en `BancoDeBogota.php:138`. Es un **bug de PHP**: revienta antes de llamar a nadie. Ningún mock lo arregla; necesita el config del certificado o un fix de código.
- **Welli #23 / Approbe #41 / BancolombiaBnpl #68** → `Attempt to read property "url_utm" on null`. No es el proveedor: la entidad **no está configurada para esa sucursal** (falta la fila en `lenders_by_allied_branches`). Error de método al probar — hay que usar un comercio que sí la tenga.

**Lección:** antes de culpar a un servicio externo, mirar si el error es un `Undefined variable` o un `on null` — eso es código o config, no red.

### F-27 · `new URL('//ruta', base)` no es la ruta que creés

**Síntoma:** un mock propio respondía siempre desde su handler raíz y su log quedaba vacío, pese a que el backend claramente lo llamaba.
**Causa raíz:** el backend arma la URL con **doble barra** (`baseUrl` + `/{pos}/getCreditToken` con `{pos}` vacío → `//getCreditToken`). En JS, `new URL('//x', base)` se interpreta como URL **protocolo-relativa**: `host='x'`, `pathname='/'`.
**Evidencia:** `new URL('//getCreditToken?a=1','http://localhost:8099').pathname` → `'/'`.
**Arreglo:** colapsar las barras iniciales antes de parsear: `String(req.url).replace(/^\/{2,}/, '/')`.
**Estado:** resuelto. **La pista fue el log VACÍO** — si el mock responde pero no registra nada, no está viendo lo que creés.

---

## I · Barrido headless (matriz de conductas + cierre por API)

Herramienta: `harness/dev/sweep.ts` (`matrix` / `close`). Todo lo de abajo salió de correrla contra el backend local, 2026-07-19.

### F-28 · Matriz de conductas por comercio × entidad (relevada, no supuesta)

Al seleccionar una entidad, el backend responde una COMBINACIÓN de rasgos (no uno solo): `standBy` · `showModal` · `openProcessModal` (2ª variante de modal: "seguí en el punto de venta / en la app del lender", con `showModal=false`) · `validateLenderOtp` · `url` (a veces junto con modal). Resumen de lo relevado (7 comercios, ~35 selecciones):

| Conducta | Entidades (ejemplos) |
|---|---|
| standBy (in-platform) | TODOS los rt=2 · **Credifamilia rt=4 #24** (¡sin llamar al WSDL!) |
| modal + url del portal | Addi #6, Sufi #7, Su+pay #11, Abanta #50, Global Care #14, Brilla #19 |
| processModal (sin url) | Lagobo #35, Davivienda #36, Meddipay #39 (en sonria) |
| otp-lender (`validateLenderOtp`) | Sistecrédito #9 — origination in-house con OTP del lender |
| ERROR | BdB #5 (solo en algunos comercios, F-26) · Prami #12 (`array offset on null`) |

Hallazgos puntuales:
- **Credifamilia rt=4 selecciona con `standBy` y CERO llamadas externas** → la parte in-platform del flujo rt=4 (confirmation → fechas → firma) se puede recorrer en local sin VPN; el SOAP de radicación es de la formalización, no de la selección.
- **`Brilla Guajira #123` NO lista en el marketplace pero SÍ se deja seleccionar por API** → listado y seleccionabilidad son decisiones independientes.
- **La conducta depende del COMERCIO, no solo de la entidad**: BdB #5 funciona en celucambio (url→slm.bancodebogota.com) y en sonria (url→**bit.ly**) pero revienta con `$certPath` en godentist; Bancolombia #68/#100 en pullman devuelven url→**originaciones-stg.dev.creditop.com** (la URL sale de config por comercio — `url_utm` —, no de una API); Meddipay #39 da processModal en sonria y modal en godentist.

### F-29 · Receta del cierre rt=2 100% por API (sin navegador)

Secuencia verificada que lleva una solicitud de cero a **Estado 11 "Autorizada" con `request_number`** (Celupresto #96 y Mediarte 0% #94):

```
POST /api/onboarding/loan-application/update-user-request/{ur}   (select → standBy)
GET  /api/loans/requests/{ur}                                    (continue index)
POST /api/loans/requests/confirm {user_request_id}               → next_step: identity_validation
                                                                   (aws_validation · document_and_facial_recognition = el ADO;
                                                                    headless NO bloquea los pasos siguientes)
GET  /api/loans/requests/promissory-note/{ur}/select-payment-date  → { nextPaymentDates:[{date,day}], selectedCycle }
POST /api/loans/requests/promissory-note/{ur}/confirm-payment-date { payment_date }
GET  /api/loans/requests/promissory-note/{ur}/simulate-payment-schedule
POST /api/loans/requests/promissory-note/{ur}/confirm-payment-schedule { fee_number, selected_cycle, … }
GET  /api/loans/requests/promissory-note/{ur}          ← GENERA los documentos (es lo que hace el loader
                                                          de sign-documents); SIN esto, authorize muere con
                                                          "PromissoryNote no encontrado"
POST …/promissory-note/validate/send-otp                (bypass QA → sin SMS)
POST …/promissory-note/validate/verify-otp {otp: últimos 6 del celular}  → estado 28
POST …/promissory-note/validate/authorize               → estado 11 + request_number
```

Gotchas: las rutas de fechas/cronograma viven bajo el prefijo `promissory-note` (un 404 lo enseñó); el estado **28 "Autorizado pendiente desembolso" es el intermedio real** entre verify-otp y authorize; todo con UA de iPhone.

### F-30 · DENTIX no cierra en local: su pagaré es Deceval (SOAP)

**Síntoma:** el cierre headless de DENTIX #139 se traba en `promissory (show)` con HTTP 502 `{"operation":"createGirador"}` y authorize dice "PromissoryNote con ID de Deceval no encontrado". Queda en estado 28.
**Causa raíz:** DENTIX tiene `promissory_type_id = 2` = pagaré **desmaterializado en Deceval** (`Modules/Loans/App/Actions/DecevalSoap.php`, 4 operaciones SOAP contra `config('services.deceval.soap.host')` — sin host en el `.env` local). Celupresto/Mediarte/Motai usan `promissory_type_id = 1` (blade) y por eso sí cierran.
**Estado:** frontera documentada. Mockear Deceval exigiría envelopes SOAP válidos para 4 operaciones — hacerlo a ciegas es especulativo; si algún día hace falta, el 502 logueado trae la operación exacta.

### F-31 · Credifamilia rt=4: la cadena real de bloqueos (no era el SOAP)

**Hipótesis previa (equivocada):** "Credifamilia no se puede probar en local porque su radicación es SOAP y el WSDL da 504".
**Realidad, recorriendo el flujo headless:** la selección y casi todo el cierre in-platform funcionan **sin tocar el WSDL**. Los bloqueos son otros y aparecen en este orden:

| # | Muro | Causa | ¿Mockeable? |
|---|---|---|---|
| 1 | `vinculacion` | `pdf-mapper-service` con host falso. En `config/documents.php` es el ÚNICO doc con `default => 'microservice'` **por diseño** (D-TF-3: sin contraparte Blade, política 503 en vez de degradar) | **sí** → `mock-pdf-mapper` :8100 |
| 2 | pagaré | `promissory_type_id = 2` (**deceval**) → `DecevalSoap`, 4 operaciones SOAP sin host → 502 `{"operation":"createGirador"}` | difícil (envelopes SOAP) |
| 3 | firma | **Netco**: `NETCO_PASSWORD_DERIVATION_SECRET is missing — refusing to derive a blank password`. No hay NINGUNA variable `NETCO_*` en el `.env` local | pendiente |

**El discriminador del muro 2 es `promissory_type_id`** (tabla `promissory_types`: 1=`ownership`, 2=`deceval`):

| Lender | tipo | ¿Cierra headless? |
|---|---|---|
| Celupresto #96, Mediarte 0% #94, Motai R #169 | 1 ownership | **sí** → Estado 11 |
| Credifamilia #24, DENTIX #139 | 2 deceval | no → queda en 28 |

O sea **el mismo muro (Deceval) bloquea a DENTIX rt=2 y a Credifamilia rt=4**: no es una frontera de `response_type`, es del tipo de pagaré. Corrige el modelo mental de F-30.

**Además, el `confirm` revela el tipo de KYC por entidad** — útil para saber qué validación exige cada flujo sin leer código:
- Celupresto/Mediarte → `aws_validation` · `document_and_facial_recognition`
- Credifamilia → `crosscore_validation` · `crosscore_biometric_enrollment`

**Bonus:** `simulate-payment-schedule` da HTTP 500 en Credifamilia ("Ocurrió un error durante el cálculo del plan de pagos") pero `confirm-payment-schedule` responde 200 igual — el cronograma se confirma sin haber simulado. Sin diagnosticar; anotado porque es un 500 que NO detiene el flujo.

**Estado:** muro 1 resuelto; 2 y 3 documentados como frontera. Para cerrar un rt=4 completo harían falta un mock de Deceval (4 ops SOAP) y las credenciales/mock de Netco.

### F-32 · La regla de `promissory_type` tiene una excepción: el path IMEI difiere el desembolso

**Predicción (F-31):** "los lenders con `promissory_type_id = 1` cierran headless".
**Verificado:** CrediPullman #77 y Motai C #168 → **Estado 11** con `request_number`, como predecía.
**Excepción encontrada:** **smartpay #152 tiene tipo 1 y NO cierra.** Porque en el path IMEI el desembolso está DIFERIDO por diseño: `authorize` no es el paso final.

Secuencia correcta del path IMEI (SmartPay) — `authorize` **no se llama**:

```
… verify-otp  →  POST device/register {imei, user_request_id}     (el asesor escanea)
              →  POST device/{ur}/disburse                        (autoriza Y desembolsa)
```

Llamar a `authorize` en ese flujo lo **rompe**: falla, hace rollback y deja el OTP consumido, con lo que el `disburse` posterior arranca en falso. (`dev/sweep.ts` ya ramifica solo detectando `paths.name='IMEI'`.)

**Estado real en local:** ni con la secuencia correcta cierra. Con el IMEI ya enrolado, `device/disburse` corre la autorización interna (`Loan authorization started {otp_id: null}` — es normal: `resolveValidatedOtp` acepta null y busca el último OTP validado) y muere con `Attempt to read property "id" on null`, con rollback. Queda en 28.

**Inferencia fuerte, no probada:** es otra manifestación de **F-21** (el hardcode del 160). Con lender ≠ 160, `isSmartPay()` es false, así que el flujo mezcla el **set de documentos del path IMEI** —el log confirma que genera SOLO `consent` + `payment-schedule`, sin pagaré ni FGA, tal como describe el diseño de SmartPay— con las **expectativas de la autorización estándar**, que sí espera un pagaré. Falta algo que la rama SmartPay habría creado. No se persiguió el null exacto.

**Modelo mental actualizado** de qué cierra headless en local:

| Condición | Resultado |
|---|---|
| `promissory_type_id = 1` (ownership) **y** path ≠ IMEI | **cierra** → Estado 11 (Celupresto, Mediarte 0%, Motai C, CrediPullman) |
| `promissory_type_id = 1` **y** path = IMEI | no cierra → 28 (smartpay #152; ver F-21) |
| `promissory_type_id = 2` (deceval) | no cierra → 28 (Credifamilia #24, DENTIX #139) |

### F-33 · zsh no hace word-splitting (trampa al verificar)

**Síntoma:** un loop `for L in "slug 77"; do set -- $L; cmd $1 $2` pasó `"slug 77"` como UN argumento; la herramienta reportó "sin branch_hash" para un comercio que sí lo tenía, y por un momento pareció un bug de datos.
**Causa raíz:** a diferencia de bash, **zsh no divide en palabras las expansiones sin comillas**. `set -- $L` deja `$1="slug 77"`.
**Arreglo:** `${=L}` en zsh, o evitar el truco: `for pair in slug:77; do S="${pair%%:*}"; L="${pair##*:}"`.
**Estado:** anotado en la sección de trampas — el error se veía como "el dato no existe" cuando era el shell.

### F-34 · La conducta la decide la CREDENCIAL del par (comercio, entidad) — no la entidad

Es el mecanismo que explica, de una sola vez, F-25 ("la mayoría no llama a nadie"), F-26 ("BdB falla solo en algunos comercios") y la observación de F-28 de que la conducta cambia por comercio.

**Regla, verificada en dos entidades independientes:**

> Si existe `lender_allied_credentials` para ese (lender, sucursal) → **se invoca la integración** (y ahí aparecen los fallos reales del proveedor). Si NO existe → el flujo **ni siquiera llama a la action**: devuelve modal + la url de config (`url_utm`), sin tráfico saliente.

**Evidencia — Banco de Bogotá #5** (mismo lender, distinta conducta):

| Comercio | ¿Credencial? | Conducta |
|---|---|---|
| godentist, coexito | **sí** (`banco_de_bogota_pem`, `…_key`, `…_passphrase`, …) | invoca → **revienta** `Undefined variable $certPath` |
| celucambio, sonria | **no** | modal + `url→slm.bancodebogota.com` (o `bit.ly`), sin llamada |

**Evidencia — Sistecrédito #9** (además elige entre DOS integraciones):

```php
// app/Actions/Lenders/Sistecredito.php::register
if ($credential->credential->has('sistecredito_pos')) return (new SistecreditoPos)->register($request);
return (new SistecreditoPay)->register($request);
```

| Comercio | Credencial | Conducta observada |
|---|---|---|
| pullman, celucambio, godentist, coexito, colchones-ensueno, compuworking, dentix | con `sistecredito_pos` → **POS** | `otp-lender` (valida OTP del lender) + `GET /getCreditToken` |
| ostu, patprimo, atmos | **sin credencial** | modal + `url→credinet.co`, sin llamada |

**Consecuencias prácticas:**
1. **Para reproducir un bug de integración hay que elegir el comercio correcto**, no solo la entidad. "Banco de Bogotá falla" es falso a secas: falla *donde tiene credencial*.
2. **Un mock solo sirve si el par tiene credencial.** Apuntar `SISTECREDITO_HOST` a un mock no cambia nada en ostu/patprimo/atmos: nunca se llama.
3. Para *ver* una integración en local, buscar primero dónde hay credencial.

> ⚠ **El `credential` está ENCRIPTADO** (cast de Eloquent). Leerlo por SQL directo devuelve basura y el chequeo `has('sistecredito_pos')` da **falso negativo en todos** — parece que ningún comercio usa POS. Hay que consultarlo por Eloquent (`php artisan tinker`), como en la evidencia de arriba. Emparenta con F-19 (la misma tabla, además, es polimórfica).

### F-35 · Matriz completa: 24 comercios barridos

Cobertura del barrido headless sobre **todos** los comercios de `.flows.json`. Conductas observadas, agrupadas:

- **standBy (in-platform)** — todos los rt=2 y Credifamilia rt=4. Único grupo que puede cerrarse en local (ver F-32 para las excepciones).
- **modal + url de config** — el caso más común, sin tráfico saliente: Addi, Sufi, Servicrédito, Brilla, Global Care, Abanta, Su+pay, Welli, Meddipay, y **Bancolombia #68/#100**, cuya url apunta a `originaciones-stg.dev.creditop.com` (staging de CreditOp, no del banco).
- **processModal** (`openProcessModal` con `showModal:false`) — Lagobo, Davivienda, Meddipay en sonria.
- **otp-lender** — Sistecrédito donde hay credencial POS.
- **ERROR** — Banco de Bogotá donde hay credencial (F-26/F-34); Prami #12 (`array offset on null`).

**Dato útil:** los comercios de electro (alkosto, alkomprar, k-tronix) son idénticos entre sí — solo Bancolombia #68/#100 — así que como escenarios de prueba son intercambiables y no aportan cobertura nueva.

### F-36 · El muro de Deceval NO es el host: son credenciales criptográficas (y por eso NO se mockea)

**Suposición razonable (equivocada):** "falta `services.deceval.soap.host`; con un mock del SOAP alcanza".
**Realidad:** `DecevalSoap` firma el envelope con **WS-Security** usando material X.509 que saca de la credencial del par:

```php
File::put($certPath = tempnam('', ''), $credential->credential['deceval_cert']);
File::put($keyPath  = tempnam('', ''), $credential->credential['deceval_key']);
static::wss($document, $credential->credential['deceval_username'],
            $credential->credential['deceval_password'], "file://{$keyPath}", "file://{$certPath}");
```

**Y esas credenciales no existen en el dump local** (verificado por tinker, que es la única vía — F-34):

| Lender | Credencial del par | ¿`deceval_cert`? |
|---|---|---|
| DENTIX #139 (dentix) | **ninguna** | — |
| Credifamilia #24 (mediarte) | sí, pero con claves `credifamilia_*` (`_client_id`, `_cert`, `_key`, `_negozia`, `_office_id`) | **ausente** |

O sea el 502 `{"operation":"createGirador"}` es **falta de credencial**, no de red — otra instancia del patrón de F-34.

**Por qué NO se mockea (decisión, no pereza):** haría falta fabricar tres cosas —usuario, contraseña y un par cert/key X.509 autofirmado— más el servidor SOAP. El resultado sería un test que **valida contra material inventado por uno mismo**: no prueba nada de la integración real y da falsa confianza. El parseo de la respuesta sí está mapeado por si algún día hay credenciales de pruebas reales: busca `RespuestaCrearGiradorDaneServiceDTO` (ns `http://deceval.com/sdl/services/`) y exige `<exitoso>true</exitoso>`, si no lee `<descripcion>`.

**Estado:** frontera CERRADA a propósito. Para cruzarla hacen falta credenciales de pruebas de Deceval, no más código.

### F-37 · Netco solo lo usa Credifamilia — DENTIX no lo necesita

`DocumentSigningProviderFactory` rutea por `lender->signingProvider->name`, con `default => null` (= firma in-platform, sin proveedor externo). En BD, la tabla `signing_providers` tiene **una sola fila** (`netco`, id 1) y **solo el lender 24 la referencia**:

| Lender | `signing_provider_id` | Firma |
|---|---|---|
| Credifamilia #24 | 1 (netco) | externa → exige `NETCO_PASSWORD_DERIVATION_SECRET` (ausente en local) |
| DENTIX #139, Celupresto #96, Motai R #169, smartpay #152 | **null** | in-platform (funciona) |

**Consecuencia:** el mapa de fronteras queda más fino de lo que decía F-31 — **DENTIX está bloqueado SOLO por Deceval**, no por Netco. Y Credifamilia acumula las dos.

**Nota:** el guard de Netco (`refusing to derive a blank password`) es intencional y está testeado (`NetcoCredentialDeriverTest`). No es un descuido: es una negativa explícita a operar con un secreto vacío.

---

## J · Los tres flujos que faltaban: rotativo, servicing y ecommerce

### F-38 · Rotativo (rt=3) SÍ existe y se distingue — pero no cierra por config del comercio

**Cobertura previa: cero.** Hay **13 lenders rt=3 activos** en el dump y **ninguno** estaba en los comercios de `.flows.json`. Agregados `dentalix` (`51d2b8a2`) y `alpeluche` (`cb6a9f0a`).

**Lo que sí se validó:**
- Los rotativos **listan** y **seleccionan con `standBy`** (in-platform), igual que un rt=2.
- El backend **los trata distinto**: `select-payment-date` devuelve **`revolvingCredit: true`** y **3 fechas** de pago (los rt=2 devuelven 1–2). Ese es el marcador del producto.
- **Dentalix es el mejor escenario comparativo del dump**: ofrece el MISMO producto en las dos variantes — `Dentalpay X Consumo #101` (rt=2) y `Dentalpay X Rotativo #102` (rt=3) — así que permite un A/B real.

**Lo que NO cierra:** ninguna de las dos variantes llega a Estado 11, y fallan **en puntos distintos**:
- rt=3 #102 → `promissory (show)` HTTP 500 `Attempt to read property "fga" on null` (fondo de garantía)
- rt=2 #101 → pasa promissory pero `authorize` HTTP 500 `Attempt to read property "id" on null`

Como **su hermano rt=2 también falla**, el bloqueo NO es del producto rotativo: es config de ese comercio/lender que falta en el dump (`lender_guarantee_criteria` tiene una fila para #101 con **todos los campos en null**, y ninguna para #102). Sin diagnosticar más a fondo.

**Estado:** rotativo validado a nivel listado/selección/marcador; el cierre queda como frontera de datos, no de código.

### F-39 · Servicing (cobranza por hardware): VERIFICADO end-to-end en local

Es la única parte del post-Estado-11 ejercitable localmente, y **funciona**. Los 3 crons viven en `legacy-backend` (`app/Console/Kernel.php`): lock 04:00 · unlock 05:00 · unroll 06:00.

**Receta verificada** (primera vez que se corre el ciclo completo):
1. Tener una solicitud con **IMEI enrolado** (`user_request_products.imei`).
2. Sembrar una fila en el ledger **`creditop_x_requests_history`** con `creditop_x_requests_status_id = 2` (mora) y `days_past_due >= 8` — clonar una fila existente y cambiar esos campos.
3. `php artisan app:lock-devices-past-due` → *"Dispatched 1 device locking jobs"*.
4. El job llama al MDM y persiste en **`device_locks`**: `status = locked`, `locked_at`, y el `api_response` completo.

**El ledger tiene 214.746 filas en el dump local** — o sea hay material real para ejercitar mora sin inventar casi nada.

**Gotcha del contrato (nos mordió):** `lock`/`unlock`/`release` NO usan el mismo contrato que `enroll`. El cuerpo es `{ devices: [{deviceId, title, message}] }` y la respuesta se lee con `data_get($response, 'results.0')`. Un mock que devuelva `{deviceId, state}` plano deja el `device_lock` en **`failed`** aunque responda `success: true` — silencioso y confuso. Corregido en `mock-mdm`.

**Lo que sigue sin cubrir del post-11:** el resto del servicing CreditopX (cascada de cobranza, mora, intereses, seguros, capital) corre en **`application`**, no en legacy — fuera del alcance de este stack local.

### F-40 · Ecommerce: NO es ejercitable — la ruta de checkout ya no existe en el wizard

**Síntoma:** `GET /ecommerce/{hash}/checkout?o=<base64>` contra el wizard → **HTTP 404**.
**Causa raíz:** en `apps/loan-request-wizard/app/routes.ts` (main actual) el prefijo `:flow` → `:partner_hash` tiene hijos `solicitar`, `:phone_number/otp`, `:loan_request_id/*`… **pero NO `checkout`**. No existe ningún `routes/ecommerce/checkout.tsx`; lo único con nombre ecommerce vive bajo `routes/bancolombia/*` (`resolve-ecommerce-flow`, `ecommerce-loan-processing`), que es otro flujo.

**Lo que SÍ sigue vivo:** el lado de datos. `bin/dbops.ts ecommerce-url <merchant>` arma el contrato base64 correctamente, las tablas existen (`ecommerce_requests`, `allied_ecommerce_credentials`, `ecommerce_requests_log`, …) y **10 comercios tienen credencial ecommerce** (Pullman-pruebas, Amoblar, Colchones ensueño, Creditop, Rogans, …). O sea: el canal existe en backend; **lo que falta es la puerta de entrada en el frontend**.

**Implicancia para el harness:** `bin/ecommerce` y todo el eje "entrada por checkout" del suite están **stale** respecto del wizard actual. Antes de invertir en ese camino hay que averiguar si la ruta se movió, se renombró o el canal se replanteó (¿lo absorbió el flujo de Bancolombia?).

**Estado:** documentado como NO ejercitable. No es una limitación del entorno local ni de mocks: es que el frontend no expone la ruta.

---

## K · Flujo dinámico (RD) y servicios que existen como repo

### F-41 · "Formulario no encontrado" = el flujo DINÁMICO sin su schema

**Síntoma:** con un comercio de RD (ej. CeluRD/SmartPay) el wizard va a `/merchant/{hash}/request-amount` —no a `/solicitar`— y muestra **"Formulario no encontrado · El formulario que intentas abrir no existe o ya no está disponible"**.

**Causa raíz:** los comercios con `allieds.country_id = 60` entran por el **flujo dinámico**, cuyo loader pide el schema a un servicio aparte:

```
GET {VITE_ONBOARDING_FORM_SERVICE}/dynamic/{partner_hash}/schema
```

En local esa env apunta a `onboarding-forms-service.inertia-develop:8092` (necesita VPN) — o, peor, **falta** y entonces el loader tira 500 `missing_env`.

**Se intentó lo correcto antes de mockear:** el servicio REAL existe en `~/github/onboarding-forms-service` (Go), **compila y levanta** en :8092 apuntando al MySQL local. Pero **sus schemas viven en S3** y con las credenciales del `config.example.yaml` la llamada muere en `S3 HeadObject 400`. Correr el servicio no alcanza: hace falta el bucket.

**Arreglo:** `mock-forms` (:8101), con las rutas reales leídas del router del servicio (`schema`, `send-otp`, `validate-otp`, `submit`, `upload`, `find-user-by-*`, en variantes `/dynamic/…` y `/dynamic/full/…`). **Diseñado para migrar a fidelidad real sin tocar código**: si existe `mock-forms/schemas/<hash>.json` sirve ESE. Con VPN: `curl …inertia-develop:8092/v1/dynamic/<hash>/schema > mock-forms/schemas/<hash>.json`.

> ⚠ **El síntoma NO distingue dos causas distintas.** El loader **valida la forma** del schema y exige `theme` + `components.logo.boxs.image` + `components.logo.boxs.userName`. Si falta cualquiera, tira 502 con `errorStage: 'invalid_schema_shape'` y la pantalla dice **"Formulario no encontrado" igual que si el servicio estuviera caído**. Para distinguirlos hay que mirar el log del wizard, no la pantalla. (Nos costó una iteración: el primer schema genérico era válido según el tipo `FormSchema` pero no pasaba esa validación.)

**Estado:** resuelto con schema genérico; **fidelidad pendiente** hasta traer el schema real de dev.

### F-42 · Varios "servicios externos" existen como repo local

Antes de mockear algo, mirar `~/Desktop/CREDITOP/github/`: además de los tres repos conocidos hay **`onboarding-forms-service`**, **`messaging-service`** (el de `:8082`, cuya caída rompe el link por WhatsApp y el voucher — F-08), **`pre-approvals-service`**, `pdf-mapper-editor`, `dynamic-form`, `microservices`, `vtex`, `cognito-pre-sign-up`.

**Implicancia:** para varios muros hay **dos caminos** — mockear (rápido, fidelidad media) o **correr el servicio real** (más fiel). El de forms se pudo levantar en minutos; su límite fue S3, no el código. Vale evaluar caso por caso, sobre todo para `messaging-service`, que hoy es un fallo recurrente en los logs.

> 🔒 **Nota de seguridad:** `onboarding-forms-service/config/config.example.yaml` —un archivo de plantilla, versionado— contiene lo que parecen **credenciales AWS reales** (`aws.access_key_id` / `secret_access_key`). Vale confirmarlo con el equipo y rotarlas si es así.

### F-43 · El formulario dinámico carga pero no deja avanzar: dos causas distintas

Continuación de F-41. Con el schema servido, el formulario **renderiza** pero rechaza todo: ciudad vacía, *"No pudimos validar tu correo"*, *"Selecciona un tipo de documento válido"*. Son **dos mecanismos independientes**, y ninguno se ve en la pantalla:

**(a) Los desplegables salen del PROPIO schema.** `PersonalInfoForm` lee `fields.cityOfResidence.options` y `fields.documentType.options`. Si el schema no trae `cityOfResidence`, el select queda vacío y el form bloquea con *"Selecciona tu ciudad para continuar"*.

> **Dato útil:** `PersonalInfoForm` es el **único paso realmente data-driven**. `AmountForm`, `PhoneForm`, `OtpForm` y `FinancialInfoForm` **no leen `fields`** — su contenido no depende del schema. O sea, para un schema mockeado, el único paso que hay que modelar con cuidado es el de datos personales.

**(b) El veredicto de correo/documento viaja en un campo `code`, no en el HTTP status.** El wizard compara contra constantes de `request-personal-info.shared.ts`; con **200 OK pero sin el `code` esperado** muestra el error de validación igual:

| Endpoint | Disponible | Ya registrado |
|---|---|---|
| `POST /v1/dynamic/full/find-user-by-email` | `OFS6001` | `OFS6000` |
| `POST /v1/dynamic/full/find-user-by-document-number` | `OFS7001` | `OFS7000` |

**Arreglo:** ambos en `mock-forms`. El mock acepta `?taken=1` (o `MOCK_FORMS_TAKEN=1`) para devolver el veredicto de "ya registrado" y ejercitar ese camino sin ensuciar datos.

**Patrón que se repite en este flujo:** *200 OK con cuerpo inesperado* se ve exactamente igual que *servicio caído*. Ya nos pasó tres veces (F-41 forma del schema, F-43 código de veredicto, F-39 contrato de lock). **Cuando algo del flujo dinámico "no anda", comparar el CUERPO contra lo que el consumidor espera — no mirar solo el status.**

### F-44 · El flujo dinámico usa OTRA taxonomía de documentos (no CC/CE/PEP)

**Síntoma:** se escribe un número de identidad válido y aparece **"Selecciona un tipo de documento válido"** — y el mensaje sale **debajo del campo NÚMERO**, no del selector, así que parece que el número está mal.

**Causa raíz:** el flujo dinámico (RD/VE) **no comparte la taxonomía de documentos del flujo clásico colombiano**. `dynamic-step-one.ts::isSupportedDocumentType` admite exactamente cuatro tipos, cada uno con su patrón:

| Tipo | Qué es | Patrón |
|---|---|---|
| `CED` | cédula dominicana | exactamente **11 dígitos** |
| `CI_VE` | cédula de identidad venezolana | 6 a 11 dígitos |
| `PAS` | pasaporte | 6 a 9 alfanuméricos |
| `PAS_VE` | pasaporte venezolano | 6 a 9 alfanuméricos |

**`CC`, `CE` y `PEP` NO están soportados** — cualquiera de ellos hace fallar la validación pase lo que pase en el número. Un schema (real o mockeado) que ofrezca los tipos colombianos deja el flujo dinámico **intransitable**.

**Evidencia:** con `10311385677` (11 dígitos, cédula dominicana válida) el form rechazaba mientras `documentType` fuera `CC`; con `CED` valida.

**Arreglo:** `mock-forms` ahora ofrece `CED/CI_VE/PAS/PAS_VE` y permite alfanuméricos en el número (para pasaporte).

**Implicancia de negocio:** el eje **país** no es solo formato de moneda (F-22) ni de pantallas (F-41) — también cambia **qué documentos existen**. Cualquier trabajo sobre el flujo dinámico debe asumir la taxonomía RD/VE, no la colombiana.

### F-45 · Flujo dinámico completo: los 5 pasos y qué exige cada uno

Cierre de F-41/F-43/F-44. El flujo dinámico (RD) recorre **cinco rutas** y cada una tiene su propio requisito; fallar cualquiera deja una pantalla que no explica la causa:

| Paso | Ruta | Qué exige | Si falla |
|---|---|---|---|
| 1 | `request-amount` | `GET /dynamic/{hash}/schema` **con forma válida** (`theme` + `components.logo.boxs.image` + `.userName`) | "Formulario no encontrado" (F-41) |
| 2 | `request-phone` | — | — |
| 3 | `request-otp` | `POST …/send-otp` y `…/validate-otp` | — |
| 4 | `request-personal-info` | `fields.cityOfResidence.options` en el schema + veredicto en `code` (`OFS6001`/`OFS7001`) + tipo de documento de la taxonomía RD/VE | ciudad vacía · "No pudimos validar tu correo" · "Selecciona un tipo de documento válido" (F-43, F-44) |
| 5 | `request-financial-info` | el submit debe devolver **`{ redirect }`** | 502 `submit_missing_redirect` → "espera unos minutos e intenta nuevamente" |

**Sobre el paso 5:** el servicio real orquesta el alta contra el legacy por **endpoints backdoor** (`create-temporary-user` → `accept-terms` → `resolve-lenders-redirect`), autenticados con `Authorization: Bearer <BACKDOOR_API_KEY>` (está en el `.env` de legacy) y con el teléfono en **E.164** (`+57…`, el patrón exige `^\+[1-9]\d{0,2}…`). Se intentó replicar esa cadena; la auth y el formato se resolvieron pero `create-temporary-user` devuelve `BD000` sin traza útil.

**Decisión:** `mock-forms` crea la solicitud por el **mismo camino que el resto del harness** (register + INSERT + `synthFill`, como `dev/sweep.ts`). El resultado es **equivalente** —un `user_request` real que `/lenders` consume— aunque el *cómo* difiera del servicio real. Verificado: submit → `{redirect:"/merchant/1bfb8cd0/464477/lenders?amount=8900", userRequestId:464477}`, la solicitud existe con el documento y monto enviados, y lista `smartpay rt2`.

> **Deuda anotada:** si alguna vez importa ejercitar la orquestación REAL (que crea el usuario como lo hace producción), hay que resolver el `BD000` de `create-temporary-user`. Para el objetivo de "recorrer el flujo dinámico en local", el atajo alcanza.

---

## L · Motai RENTING y Ábaco (rama motai-v2)

### F-46 · Elegir lender BORRA el asesor de la solicitud (y eso rompe Ábaco)

**Síntoma:** el login y los results de Ábaco mueren con `SQLSTATE[23000] … Column 'corporate_user_id' cannot be null` al insertar en `user_request_additional_information`.

**Causa raíz — NO es un bug del producto, es la llamada la que no se identifica.** En `UserRequestService:278`:

```php
$corporate_user_id = (auth()->check()) ? auth()->user()->id : $request->corporate_user_id;
```

`update-user-request` (la selección de lender) **reescribe** el campo: si la petición no está autenticada y no manda `corporate_user_id` en el cuerpo, lo deja en **NULL** — borrando el asesor que la solicitud ya tenía.

El wizard no sufre esto porque manda el header **`x-cognito-identity-id`** (lo arma `default-layout`), que el middleware `ResolveCognitoUser` convierte en usuario autenticado. Las solicitudes históricas creadas por UI conservan el asesor; las creadas por API pura, no.

**Evidencia** (aislado paso a paso):

| Momento | `corporate_user_id` |
|---|---|
| tras el INSERT | 1827080 |
| tras `synthFill` | 1827080 |
| **tras `update-user-request`** | **NULL** |

**Arreglo:** `dev/sweep.ts` manda `x-cognito-identity-id` con el sub del asesor en todas sus llamadas. **Lección general: una llamada por API que no manda ese header no es equivalente a la del wizard** — puede borrar datos en silencio.

### F-47 · Ábaco: la mitad ya estaba mockeada en el código

Ábaco es 100% externo (no hay código del proveedor), pero **antes de mockear conviene mirar qué ya está resuelto**:

| Endpoint | ¿Sale al proveedor en local? | Por qué |
|---|---|---|
| `/results` | **no** | `Abaco::results()` corta en `app()->environment(['local'])` y devuelve `AbacoFixture::generateDynamicMock()` |
| `/platforms` | **no** | el setting `abaco_config.platforms_check_enabled = false` lo sirve desde la config en BD |
| `/init/gig-economy` | **sí** | → `mock-abaco` :8102 |
| `/login` | **sí** | → `mock-abaco` :8102 |

**Gotchas del contrato** (`app/Actions/RiskCentrals/Abaco.php`):
- Los POST van **form-encoded** (`Http::asForm()`), no JSON.
- La respuesta de `init` debe traer `customer_id`/`token`/`redirect_url` **en la RAÍZ**: el cliente ya envuelve como `['success'=>…, 'data'=>$response->json()]`. Anidarlos bajo `data` devuelve **200 "initialized successfully" con los campos VACÍOS** — cuarta aparición del patrón "200 con cuerpo inesperado".
- Si `init` devuelve `redirect_url`, el backend le hace GET y extrae la cookie **`sessionid`**.

**Cómo se controla el veredicto:** el fixture keyea por `platforms[SLUG].auth === '200 - OK'`, marca que escribe el **paso 2** del login (no el 1). Con el `auth` puesto, `abaco_config.mock_pass` decide: `true` → `{"UBER":"success"}` · `false` → `{"UBER":"error"}`.

**Uso:** `node dev/sweep.ts abaco <slug> <lenderId>` corre la cadena entera.

### F-48 · Renting en v2: el discriminador es `product`, y estaba roto

En `main` el renting se decidía por **modo** (`user_request_modes` → `allied_modes.config.isAbacoRequired`; Motai tiene 3 modos y solo **#2 MotaiRenting** pide Ábaco). La rama `feature/motai-v2` **borra ese mecanismo** (elimina `AlliedMode`, `UserRequestMode` y su repositorio) y lo reemplaza por `lenders.product` + `lenders.calculator`.

**Pero el puente quedó roto:** `MotaiValidationService` en v2 leía `$userRequest->lender?->abaco`, y el commit `5013f4af` **quitó esa columna de la migración** ("Ábaco lo maneja otro equipo"). En un entorno limpio la columna no existe → `false` siempre → **el renting nunca pedía Ábaco**. En el local de desarrollo seguía andando por accidente (la columna quedó de una corrida anterior de la migración).

**Arreglo (commit local `bc373088` en la rama):** derivarlo del producto — `$userRequest->lender?->product === 'renting'`. Equivalente en datos: los únicos dos lenders con `abaco=1` son exactamente los que tienen `product='renting'`.

**Dato a confirmar con el equipo:** el lender **#158 "Motai Renting"** —el que la migración de v2 backfillea con `product='renting'` y la calculadora— **no está ofrecido en ninguna sucursal**, así que nunca lista. El renting *listable* es **#169 Motai R**.

### F-49 · Dónde vive el paso de Ábaco en el front (y por qué el harness se lo comía)

**Síntoma:** una corrida de Motai R (`product='renting'`) llegó a `loan-approved` **sin pasar nunca por Ábaco**, pese a que el backend respondía `MOTV1001 requiere Abaco`.

**Causa raíz — el muro lo ponía el harness.** La bifurcación NO está donde uno la buscaría (en una pantalla propia del renting) sino en el **`action` de `/confirmation`**:

```ts
// routes/loan-confirmation.tsx:194
if (abacoRequirement.code === AbacoRequirementCode.REQUIRED) {
      return routeHelpers.redirect(ROUTE_PATHS.abaco(String(loanRequestId)));   // :206
}
```

O sea: se dispara **al tocar "Continuar" en confirmation**, y por lo tanto **ANTES del ADO**. El harness saltaba de `confirmation` directo a `first-payment-date` para esquivar la captura de identidad (F-10) — y con eso se comía exactamente el paso que se quería ver.

**El front consulta el requerimiento en TRES lugares**, todos vía el mismo endpoint del backend:

| Archivo | Para qué |
|---|---|
| `routes/loan-confirmation.tsx` | **la entrada real** a `/abaco` (action del "Continuar") |
| `routes/identity-validation-status.tsx` | `buildCompletionPath()` → `requestSent` si requiere Ábaco, `firstPaymentDate` si no |
| `routes/api/validation-status.tsx` | expone `validationStatusAbaco: {required, completed}` al polling |

**Respuesta a "¿cómo se hacía antes con modes?":** el **frontend nunca supo de modos**. Siempre preguntó lo mismo (`POST /api/onboarding/motai/check-abaco-requirement`) y ramificó por el código de respuesta. Lo único que cambió en v2 es **cómo decide el backend**: antes `allied_modes.config.isAbacoRequired` del modo de la solicitud; ahora `lenders.product === 'renting'` (F-48). Por eso la des-motaización no tocó estas rutas.

**Arreglo:** `guided.spec.ts` pregunta el requerimiento **antes** de saltear: si es `MOTV1001`, deja a B en `confirmation` (y avisa que el "Continuar" lleva a `/abaco`); si no, saltea el ADO como siempre. Verificado en el mismo comercio: `#169 Motai R` → se queda · `#168 Motai C` → saltea.

**Lección transferible:** cuando un flujo "no pasa por X", revisar primero si el harness **saltea** el punto donde X se decide. Los atajos que compensan pasos no automatizables pueden tapar justo la rama bajo prueba.

### F-50 · Renting cancelada después de Ábaco: una fila faltante que el front convierte en cancelación

**Síntoma:** la solicitud **464498** (`#169 Motai R`, tel 3131010101) pasó Ábaco entera y a los ~90s quedó **Cancelado**. Rastro en BD:

```
user_requests.user_request_status_id = 8            (Cancelado)
user_request_records: 3 → 8 "Cancelación no voluntaria código 5001"
```

**Ojo con la columna:** `user_requests.status` (=1) **no es** el estado de la solicitud; el estado vive en **`user_request_status_id`**. Mirar la columna equivocada hace creer que la solicitud está sana.

**Causa raíz — un dato que la migración de v2 no sembró.** `lender_identity_validation_types` no tiene fila para los lenders nuevos de Motai (**158, 168, 169, 170**). Todos los demás rt=2 sí la tienen. Y el resolutor la lee con un default silencioso:

```php
// ValidationStatusService.php:298
(int) ($userRequest->lender?->primaryIdentityValidationType?->identity_validation_type_id ?? 0)
```

Sin fila → `0` = **`Unknown`** (¡no `None`, que es `1`!) → `IdentityValidationStepResolver` cae en su `default` → `next_step: 'error'`, `type: 'unsupported_validation'`.

**Y ahí el front lo convierte en cancelación, en tres saltos, todos "fallback":**

| # | Dónde | Qué hace con un tipo que no conoce |
|---|---|---|
| 1 | `abaco/platform-otp-validation.tsx:257` | fallback → `identity-validation-instructions` |
| 2 | `identity-validation-instructions.tsx:94` | el `action` solo contempla `ado_validation` y `crosscore_validation`; el `return` final → `request-canceled` |
| 3 | `request-canceled.tsx:32` | **cancela en el `loader`** (no es una pantalla pasiva): `CancelLoanRequestUc` sin código → default **5001** "Error genérico de validación", `voluntary=false` |

`loan-confirmation.tsx:258` tiene el mismo fallback, así que el flujo normal (sin Ábaco) llega al mismo pozo.

**Lo peligroso es la forma, no el dato:** un tipo de validación no soportado —una condición de **configuración**— termina cancelando el crédito del cliente, sin mensaje ni código propio. `request-canceled` es una ruta que *ejecuta* la cancelación con solo aterrizar en ella, y es el destino de todos los fallbacks del wizard.

**Pista que lo delataba:** `identity.validation_type.drift_detected {"lender_id":169,"primary_validation_type":0,"legacy_validation_type":2}` repetido cada ~30s antes del cancel. El warning existe justo para esto: la fuente primaria (tabla) y la legacy (`lenders.validation_type`) discrepan y **gana la primaria**, aunque valga `0`.

**Arreglo local (solo BD, dump local):** sembrar la fila con `identity_validation_type_id = 1` (`None`) para 158/168/169/170 → el resolutor devuelve `no_validation_required` → post-Ábaco enruta a `first-payment-date` y el flujo cierra.

```sql
INSERT INTO lender_identity_validation_types (lender_id, identity_validation_type_id, `order`, status, created_at, updated_at)
SELECT l.id, 1, 1, 1, NOW(), NOW() FROM lenders l WHERE l.id IN (158,168,169,170)
  AND NOT EXISTS (SELECT 1 FROM lender_identity_validation_types t WHERE t.lender_id=l.id AND t.`order`=1);
```

**Dos cosas a decidir con el equipo (no las decide el harness):**
1. **Qué validación de identidad debe usar renting.** El dato legacy se contradice a sí mismo: `#158 Motai Renting` tiene `validation_type=1` (None) y `#169 Motai R` tiene `2` (AWS). Se sembró `None` porque es lo que deja correr el flujo en local y es coherente con el resto del harness (el ADO ya se finge validado, F-10). **La migración de v2 debería sembrar esta tabla explícitamente.**
2. **El fallback que cancela.** Un `unsupported_validation` debería terminar en una pantalla de error de configuración, no en una cancelación no voluntaria con código genérico.

**Verificado en la práctica (uReq 464499, mismo comercio y lender):** con la fila sembrada el flujo de renting cierra entero — `confirmation → abaco → abaco/platforms → abaco/platform-otp-validation → first-payment-date → payment-schedule → sign-documents → otp-validation → loan-approved`, con rastro `3 → 28 → 11` (Autorizada).

### F-51 · El formulario de referencias del Figma: el mecanismo existe, la posición y los campos no

**Pregunta que lo originó:** en el diseño de Motai renting, después de "Continuar" en confirmation aparece un formulario (*Fecha de Vencimiento de Licencia* + *Referencia #1* y *#2*, cada una con Nombre / Parentesco / Contacto) y recién después la pantalla de Ábaco. En la corrida no aparece nunca. ¿Está en el front?

**Sí existe el mecanismo — formularios backend-driven.** El gate es `routes/additional-info.tsx`: le pregunta al backend qué formulario corresponde a la solicitud y enruta según la respuesta.

```ts
// additional-info.tsx:36
const nextPath = result.payload.formTypeId === null
      ? ROUTE_PATHS.signDocuments(String(loanRequestId))            // ← sin formulario: salta a firmar
      : ROUTE_PATHS.additionalInfoForm(String(loanRequestId), String(result.payload.formTypeId));
```

**Pero difiere del diseño en tres cosas (y una cuarta en la pantalla vecina):**

| # | Diseño | Código |
|---|---|---|
| 1 | el form va **entre confirmation y Ábaco** | el gate se entra desde `payment-schedule.tsx:171`, o sea **después del cronograma**, justo antes de firmar |
| 2 | Motai renting muestra el form | `form_types` tiene 6 filas y solo la **#6** está atada a un lender (**24 Credifamilia**); el #169 no tiene → `formTypeId=null` → salto directo a `sign-documents` |
| 3 | *Licencia* · *Parentesco* · 2 referencias | en `fields` **no hay ningún campo de licencia**; "Parentesco" solo existe como **"Parentesco con familiar PEP"** (id 82) —pregunta de PEP/AML, otra semántica—; y las referencias son **una sola** (ids 46-48: nombre / **dirección** / teléfono), no dos, y con *Dirección* donde el diseño pide *Contacto* |
| 4 | la pantalla de Ábaco ofrece **"Continuar sin validar"** | las rutas de `abaco/` son `index`, `platforms`, `platform-otp-validation`, `internal-error`: **ninguna permite saltear**. Hoy, una vez que entrás a Ábaco, es obligatorio |

**Consecuencia práctica:** el punto 2 se arregla con configuración (sembrar un form type), pero el **1 y el 4 son código** — mover el gate de posición y agregar la salida opcional de Ábaco. No alcanza con cargar datos.

**Caveat de alcance:** los puntos 2 y 3 se verificaron contra el **dump local**, que puede estar incompleto frente a staging. Antes de concluir que faltan en el producto, mirar `form_types`/`fields` en staging. Los puntos 1 y 4 salen del código y no dependen de la base.

### F-52 · El scrub del harness borra la corrida anterior y deja el historial huérfano

**Cómo apareció:** al verificar el cierre de la uReq 464499 (F-50), la fila de `user_requests` **ya no existía**, pero sus `user_request_records` sí, con el rastro completo `3 → 28 → 11`.

**Causa:** `scrubphone` (`pkg/asesor.ts:236`) borra los users cliente del teléfono de prueba y, con ellos, sus `user_requests` (`deleteUsers` en `:178`, FK checks off). Como **cada corrida arranca scrubbeando**, la corrida N destruye la evidencia de la N-1. La 464499 la borró la corrida siguiente (464500, otro user_id, 33s después).

**Y el borrado es parcial:** `user_request_records` **no está** en la lista `childTables`, así que sus filas sobreviven al borrado del padre.

```
huérfanos en user_request_records:  873 / 1288  (68%)
```

**Dos implicancias opuestas, las dos importantes:**
- *A favor:* el historial huérfano es lo único que permitió reconstruir F-50 después de que la solicitud desapareciera. Sin él, la corrida cancelada no habría dejado rastro alguno.
- *En contra:* consultar `user_requests` por el id que imprimió una corrida vieja devuelve **vacío**, lo que se lee como "nunca existió" en vez de "lo borró el scrub". Es una trampa de verificación del mismo tipo que las de la sección F.

**Regla práctica:** para hacer forense de una corrida, consultarla **antes** de lanzar la siguiente; o buscar por `user_request_records`, que sobrevive. Y al mirar una solicitud vieja, recordar que la columna de estado es `user_request_status_id`, no `status` (F-50).

### F-53 · La guarda de "estás tocando dev compartido" viene desarmada de fábrica

**Cómo apareció:** escribiendo los `CLAUDE.md` de `backend-mcp` y `backend-e2e`, dos revisiones independientes llegaron al mismo punto.

**El mecanismo.** Ambas herramientas protegen las escrituras contra el entorno compartido exigiendo una variable de entorno explícita — la idea es que tipearla te haga frenar y pensar:

```go
// backend-mcp/env.go:80  ·  backend-e2e/clean.go:52, create.go:104
I_KNOW_THIS_TOUCHES_SHARED_DEV
```

**El problema: los propios `.env` ya la traen puesta.** Está en los **cuatro** archivos, incluido el de `local`:

```
backend-mcp/.env.dev:7    I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-mcp/.env.local:7  I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-e2e/.env.dev:11   I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-e2e/.env.local:11 I_KNOW_THIS_TOUCHES_SHARED_DEV=1
```

Y los `.env` se cargan solos: `backend-mcp/main.go:33` autocarga `.env.<target>` al arrancar, y `backend-e2e/Makefile:46` lo sourcea en cada target. Como el loader solo setea las variables que no estén presentes (`env.go:42`), **la guarda siempre evalúa true**. Nunca frena a nadie.

**Por qué en `backend-mcp` pesa más:** su target por defecto es **`dev`** (`main.go:51`), y `dev` apunta a un **RDS compartido**. O sea: correr un comando de escritura sin pensar en el target es el camino por defecto, y lo único que quedaba entre eso y la BD compartida es una guarda que ya viene satisfecha. En `backend-e2e` el default es `local` (`main.go:46`), así que hay que pedir `--target=dev` a propósito — la barrera real ahí es tipear el flag, no la variable.

**Dos agravantes verificados:**
- La guarda se apaga por **etiqueta, no por host**: compara `cfg.Target == "local"` y nunca mira `E2E_DB_HOST` (`backend-mcp/env.go:80`). Un `.env.local` apuntado a un host remoto pasa igual.
- El borrado grande de `backend-e2e` no es `clean` sino `pkg/database/database.go:31-72` (20 tablas, `FOREIGN_KEY_CHECKS=0`), que corre en 7 call sites **sin** chequear si el destino es compartido.

**No es un bug de código, es un default peligroso:** el mecanismo está bien diseñado y bien implementado; lo que lo anula es el dato de configuración que lo acompaña. Por eso no aparece leyendo el código de la guarda — hay que ir a mirar el `.env`.

**Qué haría falta (decisión del dueño, no del harness):** sacar la variable de los `.env` versionados —empezando por `.env.local`, donde no tiene ningún sentido— y dejar que se exporte a mano solo cuando de verdad se quiera tocar dev. Y evaluar que la guarda mire el **host** además de la etiqueta.

**Mientras tanto**, queda advertido en `backend-mcp/CLAUDE.md` y `backend-e2e/CLAUDE.md`: en esta máquina, la guarda no te va a frenar.

### F-54 · La entrada por ecommerce existe y funciona — pero hoy solo resuelve Bancolombia

**Corrige a F-40**, que concluía que el eje ecommerce estaba muerto porque "no hay ruta `checkout` en el wizard". Es más matizado: lo que falta es la **landing**, no el mecanismo.

**Lo que SÍ funciona hoy (verificado contra el backend local, no supuesto):**

```
GET /api/onboarding/checkout/{allied_branch_hash}?o=&p=&t=&u=&ps=[&config=]
```

Los 5 parámetros van en **base64** (`CorbetaCheckoutController.php:119-146`): `o`=order (debe traer `billing` y `total`), `p`=products, `t`=token, `u`=return_url, `ps`=process_endpoint. Si falta uno → `SP20754` sin explicación.

El backend decodifica, **crea la solicitud** y responde **302** a
`{FRONTEND_URL_DEV}/bancolombia/self-service/{hash}/resolve-ecommerce-flow/{uReq}` (`:1250`).
Esa ruta **sí existe** en la rama actual (`routes.ts:158`). Probado con Pullman (`13874eb6`): creó la uReq y redirigió correctamente.

**El muro real: ese resolvedor es de BANCOLOMBIA.** `routes/bancolombia/ecommerce/resolve-ecommerce-flow.tsx` tiene título *"Validando información - Bancolombia"*, importa de `@creditop/bancolombia-origination` y su `SupportedFlowType` es `"bnpl" | "consumo"`. Con un comercio **CreditopX** el flowType sale `no_preapproved` y el propio loader llama `cancelCorbetaCheckout`:

```tsx
if (flowType === "no_preapproved") {
      await cancelCorbetaCheckout({ … });     // ← la solicitud nace CANCELADA
```

Evidencia: la uReq 464508 (Pullman, $1.5M) quedó en estado **8** con `Cancelación no voluntaria código 5001` **en el mismo segundo** de su creación. Es el mismo código genérico de F-50 — otra ruta que cancela desde el `loader`.

**Dónde está la pieza que falta.** La landing genérica multi-flujo —`route("checkout", "routes/checkout-redirection.tsx")` + `route("waiting-room", "routes/ecommerce-continue.tsx")`— existe **solo** en `feat/ecommerce-checkout-integration` (abril 2026). Verificado que **no** está en `main`, `develop`, `feature/motai-v2`, `feature/onboarding/ecommerce-web-origination` ni `feature/onboarding/ecommerce-continue-route`.

Dato de contexto: `feature/onboarding/ecommerce-continue-route` (junio, ya en `develop`) registró `/ecommerce/.../continue` — el handoff de CreditopX. O sea **develop tiene el medio del árbol ecommerce, pero no la puerta**.

**Trampas de entorno que costaron dos intentos:**

| Síntoma | Causa |
|---|---|
| 302 a `originaciones.dev.creditop.com` | `resolveFrontendBaseUrl()` (`:1160`) cae al default de `config/app.php`. **Sin `FRONTEND_URL_DEV` en `legacy-backend/.env`, el flujo local se ESCAPA A DEV sin avisar.** |
| `BP12700001` "user conflict" | el teléfono/documento ya tiene usuario con otra identidad (`:265`). Scrubbear antes. |
| 404 mudo al armar la URL | `E2E_API_BASE_URL` ya trae `/api` en local → `/api/api/…`. |

**Qué quedó en el harness:** `pkg/checkout-b64.ts` arma y sigue la URL base64 (`urlCheckout` / `seguirCheckout`), y `E2E_ENTRY=ecommerce` en `guided.spec.ts` entra por ahí. **Ojo:** cada GET al checkout **crea una solicitud**, así que no se puede pre-seguir headless *y* navegar el browser — genera dos y deja la primera huérfana.

**Confirmación desde el navegador (no solo por API).** La corrida visual con `E2E_ENTRY=ecommerce` sobre Pullman lo dejó a la vista, y la traza contrastada lo cazó en el **paso 1**:

```
01 A /bancolombia/self-service/13874eb6/resolve-ecommerce-flow/464508 │ BD 8 «Cancelado» ← DESENLACE MALO
04 A /bancolombia/self-service/13874eb6/no-preapproved                │ BD 8 «Cancelado»
```

El wizard aterriza en **`/no-preapproved`** —la pantalla de "no preaprobado" de Bancolombia— y la corrida termina en timeout esperando una pantalla a la que nunca va a llegar. Sin la traza, eso se veía como un cuelgue mudo de 5 minutos; con ella, el diagnóstico está en la primera línea.

**Confirmado desde el OTRO extremo: el plugin de WooCommerce.** `playground/creditop-woocommerce` (v1.0.20, lo que el comercio instala) es el productor real de esa URL, y en `class-creditop-gateway.php:507` apunta a:

```php
$redirect_url = $base . '/ecommerce/' . $hash . '/checkout' . '?o=' . …
```

O sea **el plugin apunta hoy a la landing que esta rama no tiene**. El propio comentario del plugin avisa del cambio de path (`/ecommerce/{hash}/checkout`, no `/checkout/{hash}` como el monolito viejo), así que la ruta se movió y el wizard de `main`/`develop` no la acompañó. Si producción funciona, es porque corre una rama que sí la tiene.

**Detalle de serialización, para quien reimplemente el contrato:** el plugin manda `o` y `u` **PHP-serializados** (`serialize()`) y `p` como JSON. Las dos formas funcionan: `deserializeData` (`CorbetaCheckoutController.php:767-787`) intenta `unserialize`, cae a `json_decode`, y castea array→objeto en ambos casos. El harness manda todo JSON y el backend lo acepta igual.

**Para correr un comercio CreditopX (Pullman) por ecommerce hace falta la landing genérica de la rama de abril.** Con lo que hay en `develop`, la entrada base64 solo tiene sentido para comercios Bancolombia.

### F-55 · El ruteo de validación de identidad tiene tres agujeros que CANCELAN el crédito

**Amplía a F-50.** Aquel arregló el síntoma (sembrar la fila faltante para 4 lenders). Auditando **todas** las bifurcaciones del wizard aparecieron tres agujeros más, del mismo mecanismo: el front no contempla un valor, cae en un fallback, y el fallback termina en `request-canceled` — **cuya ruta cancela en el `loader`**.

**1 · El backend emite 7 tipos de paso; el front mapea 5.** Verificado por grep sobre `apps/` y `modules/`:

```
aws_validation · ado_validation · crosscore_validation · evidente_validation · no_validation_required   → mapeados
unsupported_validation      → 0 ocurrencias en TODO el frontend
no_validation_configured    → 0 ocurrencias
```

Los dos huérfanos salen de `IdentityValidationStepResolver.php:100-111` (rama `default`) y `CreditopXFlowService.php:94-102` (lender sin `primaryIdentityValidationType`). Caen en el fallback de `loan-confirmation.tsx:258` → `identity-validation-instructions` → su action no matchea → `:94` → cancelación.

**Lo importante para F-50:** el enum `IdentityValidationType` tiene 7 casos y el resolver mapea 5 (1,2,4,5,6). **`Unknown=0` y `Questions=3` son valores REALES que caen en el default.** Sembrar la fila no alcanza si el valor sembrado es `3`: un lender con `identity_validation_type_id = 3` mata la solicitud igual.

Y el backend **ya avisa**: marca esos casos con `next_step => 'error'`. El front lee solo `step_details.type` (`loan-confirmation.tsx:241`) e ignora `next_step` — descarta la señal explícita.

**2 · Un fallo al cargar el TEMA VISUAL cancela el crédito.** `identity-validation-instructions.tsx:31-40`: el `catch` del loader —que envuelve el `GetAlliedThemeUc`, o sea el fetch del branding del comercio— redirige a `request-canceled`. Un problema de theming mata una solicitud viva. Esa pantalla tiene **cinco** salidas a cancelación (`:63, :77, :88, :94, :103`) más la del loader.

**3 · Renting + Evidente se cancela solo.** `abaco/platform-otp-validation.tsx` mapea 3 tipos (`aws`, `ado`, `no_validation_required`) — grep de `evidente` da **0**. Al terminar Ábaco, un lender con Evidente cae en el fallback `:258` → instructions → cancelación. `crosscore` zafa de casualidad porque instructions sí lo maneja.

**Contraste que muestra que es arreglable:** el mismo tipo huérfano **sí** está contenido en `identity-validation-status.tsx:128` (cambio de proveedor en caliente), donde el `default` cae a `defaultPath` en vez de a instructions. La misma clase de valor se maneja bien en un lugar y mal en el otro.

**Qué haría falta (decisión del equipo):** que el front honre `next_step === 'error'` con una pantalla de error de configuración, y que `request-canceled` deje de cancelar desde el `loader` — hoy **navegar o recargar esa URL cancela la solicitud**.

### F-56 · Cuatro de las cinco salidas de `/lenders` dan 404 fuera de `/merchant`

`available-lenders.tsx` arma sus destinos con `createRouteHelpers`, que prefija según el contexto (`/merchant`, `/self-service` o `/ecommerce`). Pero **`continue`, `gestionar` y `validate-lender-otp` solo están declaradas en el bloque `merchant` de `routes.ts`** (`:104, :129, :136`); el bloque público (`:flow`) no las tiene. Confirmado contra el artefacto generado `.react-router/types/+routes.ts:719`.

Consecuencia: en `self-service` o `ecommerce`, elegir un lender **renting** (`:554`), uno con **`path_id=3`** (`:548`), uno con **`validateLenderOtp`** (`:559`) o **CreditopX con QR** (`:564`) redirige a una ruta inexistente.

**Otros dos hallazgos del mismo paso, verificados:**

- **`standBy` es escritura muerta en `feature/motai-v2`.** El backend lo setea para rt=2/3/4 (`UserRequestService.php:435, :461, :610`) y el front **no lo lee nunca** (0 ocurrencias; el tipo del contrato ni lo declara). En `origin/develop` **sí** se usa. En esta rama el handoff de CreditopX se alcanza de rebote, por `showModal && sin url`.
- **`/continue?url=null` literal.** `available-lenders.tsx:566` hace `String(qrUrl)` y `qrUrl` es `null` salvo país 60; el string `'null'` viaja como query param y `loan-continue.tsx:104` usa `?? default`, que **no** cae al default porque `'null'` no es nullish → se genera un QR sobre la cadena `"null"`. Afecta a todo rt=2/3/4 fuera de República Dominicana.

### F-57 · Rescate antes de borrar `backend-e2e` y `backend-mcp`

Las dos herramientas se retiran (ver el porqué abajo). Esto es lo que valía la pena y **habría muerto con ellas**.

**Cierra F-38 — el 500 del pagaré con garantía.** F-38 dejó el síntoma "sin diagnosticar más a fondo" y sospechaba del `eval()`. La causa real, documentada en `backend-e2e/docs/VALIDATION.md:83`: **`FGA = 0` → el PDF sale `null` → desreferencia de null en `authorize`**. No es el `eval`. Para cerrarlo en local hay que sembrar `creditop_x_revolving_credits` + `lenders_by_allieds` con el cupo/FGA.

**Cierra la deuda de F-45 — la cadena backdoor de SmartPay.** F-45 anotó que `create-temporary-user` devolvía `BD000` sin traza y dejó abierto "si alguna vez importa ejercitar la orquestación REAL, hay que resolver el BD000". La respuesta estaba en `backend-e2e/main.go:461-464`: **el teléfono tiene que ir en E.164 consistente en TODA la cadena**, porque `createTemporaryUser` guarda el phone crudo pero `check-user-exists` y `resolve-lenders-redirect` normalizan a `"+"+dígitos` para el lookup; si no coinciden → `BDUS004`. La cadena completa es `create-temporary-user` (BDUS002) → `check-user-exists` (BDUS003) → `accept-terms` con términos **14/15** (BDTM002) → `dynamic-forms/create-user` (DYFS1001) → `resolve-lenders-redirect` (BDUS005). *No verificado corriéndolo — sale de leer el Go, que lo daba por verde.*

**El atajo de Credifamilia tiene una ventana de 1 hora.** `seedpreapproval` sembraba `status_id=41`, pero el consumidor real (`legacy-backend/app/Actions/Lenders/Credifamilia.php:130-137`) exige **tres** cosas: `status_id IN (40,41,42)` **+ `updated_at >= now()->subHour()` + un `status_detail` en `response`**. Sembrar el status y volver al día siguiente no sirve. La ventana no estaba documentada en ningún nodo.

**Diferencias dev vs local en `personal-info`** (`backend-e2e/docs/DEV-TARGET.md:190-197`): en dev el email tiene `unique:users,email` **+ validación MX del dominio**, la fecha de expedición debe ser real, y `birth_day/month/year` son **requeridos** — sin ellos, `ONB005 BIRTH_DATE_INVALID`. En local nada de eso aplica, así que un flujo que pasa en local puede morir en dev por validación de formulario.

**Motai #158 no desembolsa sin `credit_line_by_lenders`** (`VALIDATION.md:121`): es clon del 77 pero sin su línea de crédito, y `PaymentCalculationService` lee `lender->creditLines->rate` → "rate on null" en el `disburse`. Relevante porque el 158 se prueba en staging.

**`cryptocheck` se portó** a `harness/bin/dbops.ts`. Lo que lo hace servir no es el HMAC sino **probar contra una fila Experian NO sintética** (documento fuera del rango 2.9B): contra una fila que forjamos nosotros el MAC siempre valida y el chequeo no dice nada. Importa porque con un `APP_KEY` equivocado la inyección de buró escribe un blob ilegible y **`/lenders` no ofrece nada, sin ningún error** — se ve idéntico a "el perfil no califica". `appKey()` solo valida presencia.

**⚠ Lo que NO hay que migrar: la tabla "Perfilador 7/7"** de `backend-e2e/docs/VALIDATION.md:56-69`. Afirma que con ingreso 900k el lender #77 **desaparece** del listado, o sea que la group rule de ingreso excluye en rt=2. **El propio código de backend-e2e la desmiente** (`main.go:625-630`, que saltea los casos de ingreso para rt=2/3 con el comentario "los group rules CLASIFICAN, no excluyen — verificado"), y coincide con lo que ya dice el nodo de CrediPullman. Es evidencia stale de una calibración vieja.

**Lo único que se pierde a propósito: el `perfilador`.** Es el único ejercicio que **varía el perfil del usuario y asevera NO-oferta**; `sweep matrix` barre comercio × entidad con un perfil diseñado para pasar, así que nada afirma "este perfil no debería ser ofrecido". Su diseño valía: leía los umbrales **de la BD en runtime** (`MAX(lender_rules.value)` del field 87 para ingreso, `MIN(lender_users_category_rules.min_score)` para score), así que las expectativas no quedaban stale. Si alguna vez se quiere ese eje, va como un cuarto modo de `dev/sweep.ts` y esa es la receta.

**Por qué se borran.** `backend-mcp`: **no era un MCP** (sin `.mcp.json`, `mcpServers` vacío), el binario estaba **10 días atrás de la fuente**, 7 de sus comandos ya estaban duplicados en `dbops`, y sus 22 diagnósticos respondían preguntas que el árbol de contexto ya documenta con más precisión. Además tenía la superficie destructiva más grande del playground con la guarda desarmada (F-53). `backend-e2e`: probaba el backend por API, que es lo que hoy hace `dev/sweep.ts` con veredicto contra BD y exit code. Ninguna de las dos tenía un commit sustantivo desde el seed del repo (13-07), y ambas costaron mantenimiento en el refactor de `env/` sin devolver nada.

### F-58 · Un rechazo de la firma de flujo llega como HTTP 200 y el front lo toma como éxito

**Síntoma (potencial, hoy latente).** En "Confirmación de cupo" el asesor marca que el cliente ya tiene cupo, se firma el flujo `already-confirmed-pre-approval` y el backend deja de consultar Experian. Si el backend **rechaza** la firma, el front no se entera: la solicitud sigue en `flow_id=1`, **Experian se consulta**, y no queda rastro (ni error en pantalla ni evento en Sentry).

**Causa raíz verificada.** Estas APIs llevan el veredicto en el `code` del body, no en el status HTTP. En `frontend-monorepo/modules/loan-request-wizard/loan-application-form/src/lib/infrastructure/pre-approval-flow.repository.ts` conviven los dos criterios:

- `checkAbleToOmitExperianAcierta` (:38) **sí** ramifica: `okAsync(result.payload.code === ABLE_TO_OMIT_CODE)`.
- `signFlow` (:61-63) **no**: `if (result.success) return okAsync({ code: result.payload.code })` — devuelve éxito con solo que el HTTP haya salido bien, y nadie mira el `code` después.

Y el rechazo viaja en 200 (`FlowSignatureService::getHttpCode`): `URV13000`→200 (firmado) y **`URV13004`→200 (rechazado, sin escritura)**. Los demás sí se ven: `URV13005`→409, `URV13001`→404, `URV13002`→422, `URV13003`→500. El llamador (`otp-verification.tsx:166`) solo chequea `signResult.isErr()`, así que el rechazo nunca entra al `captureServerException` que tiene al lado.

**Por qué HOY no se dispara.** El único rechazo posible es `ACPA1001` (el comercio no está autorizado a omitir), y es **la misma pregunta que el front ya hizo** antes de mostrar el selector — sobre la **misma sucursal**: `UserRequestRepository::findWithEcommerceExclusions` filtra por `allied_branch_id`, así que una solicitud reusada nunca pertenece a otra sucursal. Solo lo dispararía una carrera editando el setting `allowed_to_omit_experian_allieds` entre la pantalla de monto y el OTP.

**Por qué igual queda anotado.** El propio validador lo anuncia: *"More flow actions/validations — each with its own ACPA1xxx rejection reason — will be added here"* (`AlreadyConfirmedPreApprovalFlowValidator`). Cuando lleguen validaciones que el front NO pueda anticipar (p. ej. "este usuario no tiene pre-aprobados de verdad"), el fallo silencioso se vuelve real — y es justo el caso caro: pagás la consulta creyendo que la omitiste.

**Arreglo (pendiente).** Que `signFlow` exija `code === 'URV13000'` y devuelva `errAsync` si no, para caer en el `captureServerException` ya existente. No cambia el comportamiento del usuario (la firma es best-effort a propósito: si falla, sigue el flujo estándar); solo hace que la falla **deje rastro**.

**Estado.** Detectado el 2026-07-21 con la rama ya **mergeada** (front `784585fe` + back `a603a5cd`), por eso no se corrigió en el momento. Detalle completo en el nodo `confirmacion-de-cupo`.

### F-59 · `bin/asesor` moría mudo en el paso `frontend` porque un `grep` sin match mata al script

**Síntoma.** Contra `dev` la corrida imprimía `○ frontend …` y terminaba con `code 1` **sin una sola línea más**: ni error, ni el `ok` del paso, ni el chequeo de backend. Parecía "el wizard no levantó", y ahí se pierde el tiempo (se descartó primero que `:5174` estuviera caído y que `set -e` matara el `curl && UP=1`; ninguna de las dos era).

**Causa raíz verificada.** `bin/asesor` resolvía la URL del backend con `WIZ_API="$(grep -E '^E2E_API_BASE_URL=|^E2E_MOCK_URL=' .env.$TARGET | head -1 | sed … | tr …)"`. Con la **partición de variables**, `E2E_API_BASE_URL` dejó de estar en `harness/.env.dev` y pasó al compartido `env/dev.env` — el archivo que el `grep` mira ya no tiene la clave. Un `grep` sin match devuelve **1**, `pipefail` lo propaga al pipeline, y bajo `set -e` la **asignación** aborta el script. El `2>/dev/null` no protege: silencia stderr, no el exit code. Por eso muere justo ahí y en silencio.

Ojo con la trampa de reproducirlo: en **zsh** (la shell interactiva) `ERR_EXIT` no aplica a las asignaciones, así que el mismo pipeline "sobrevive" y parece descartado. El shebang es `bash`; hay que reproducir con `bash -c`.

**Arreglo (aplicado).** Un helper `envget()` en `bin/asesor` que delega en `bin/envget.ts` — la cadena real (`process.env` > `.env.<target>` > `env/<target>.env` > heredado), con `|| true` para que una clave ausente deje la variable vacía y decida el fallback de cada caso, no la muerte del script. Se convirtieron las tres lecturas (`E2E_API_BASE_URL`/`E2E_MOCK_URL`, `E2E_PREAPPROVALS_ENDPOINT`, y `WIZ_BASE`). La cuarta (`VITE_ONBOARDING_FORM_SERVICE`) sigue siendo `grep` porque lee el `.env` del **wizard**, que es otro repo y no está en la cadena — pero con `{ grep … || true; }`.

**Regla que deja.** Cualquier `VAR="$(grep … )"` bajo `set -euo pipefail` es una bomba de tiempo: el día que la clave se mueve, el script no falla — **desaparece**.

### F-60 · Sonría no sirve para probar la omisión de Experian: el throttle corta antes que el flujo

**Síntoma.** Se preparó la prueba de "Confirmación de cupo" (omitir Experian con `flow_id=2`) contra **Sonría** en dev. Habría dado **verde por la razón equivocada**.

**Causa raíz verificada.** En el flujo clásico la compuerta es `Modules/Risk/…/DatacreditoQueryByAlliedController::validateDatacreditoQuery`, y el corte por flujo vive **adentro** de `app/Actions/RiskCentrals/Experian.php` (líneas 947/1037/1126, las tres variaciones). O sea: **el throttle se evalúa primero y, si corta, `Experian.php` ni se invoca** — el corte por `flow_id` nunca se ejerce.

La compuerta tiene dos ramas sobre `datacredito_frequencies`:

- `frequency IS NULL` → "consultar siempre": llama a Experian **en toda corrida** y luego incrementa el contador.
- `frequency` no nula → throttle: incrementa el contador **siempre** y consulta solo si `count % every == 0`.

Estado en dev (2026-07-21) y evidencia en la tabla `logs` (`controller = 'DatacreditoQueryByAlliedController'`, que persiste el veredicto con su `reason`):

| aliado | `frequency` | `every` | qué pasa |
|---|---|---|---|
| **26 Sonría** | 1 | 100.000.000 | `EXPERIAN_NOT_TRIGGERED · frequency_count_not_matched` — nunca consulta |
| **94 Amoblando Pullman** | 1 | 1 | `frequency_count_matched` — consulta siempre |
| **91 Mediarte** | **NULL** | 1 | `frequency_null_always_fires` — consulta siempre |

**Cómo probarlo bien.** Usar **Mediarte** (aliado 91, sucursal 375 `5da24bb1`, dado de alta en `.flows.json`): es el único que junta las dos condiciones — la compuerta siempre llega a `Experian.php`, y ahí ya se logró `flow_id=2` (solicitud `464334`, 16-jul). La prueba es concluyente cuando, para la misma solicitud, `logs` registra `EXPERIAN_TRIGGERED / frequency_null_always_fires` (⇒ la compuerta pasó) y **no** aparece fila nueva en `risk_central_user_data`.

**El confusor que hay que descartar.** `Experian::performRequest` cachea **1 mes** por `user_id` + `risk_central_id` (`Experian.php:251-254`). Con el usuario 1827671 la última fila Acierta (`risk_central_id = 1`) es del 17-jul 17:26, así que hasta el 17-ago "no hay fila nueva" **no prueba nada** — se explica por caché. Hay que correr con un usuario cuya caché esté fría.

**Y el contador NO es discriminante** (corrige una hipótesis previa): `$datacreditoQuery->increment('count')` corre en las **dos** ramas, incluso cuando `Experian.php` devolvió `null` por el flujo. Lo que discrimina es la fila en `risk_central_user_data`, no el contador.

**Actualización 2026-07-21 20:27 — la tabla de arriba ya no vale para Sonría.** Se pidió prender la consulta y el aliado 26 pasó a `frequency = NULL, every = 1`: hoy consulta siempre, así que **sirve igual que Mediarte** para esta prueba. Es un dato de configuración de dev/staging que cualquiera puede volver a cambiar — por eso el chequeo lee la regla en runtime en vez de asumirla.

**El chequeo está automatizado:** `node dev/experian-check.ts [<uReqId>]` (sin id, la última solicitud). Contrasta las cuatro cosas —firma, compuerta, caché, consulta— y sale con `0` omisión probada · `1` sí se consultó · `2` no concluyente. Dos trampas que ya resolvió y conviene no reintroducir:

- **Detectar la consulta por fecha suelta es un falso positivo.** `created_at >= solicitud` se come las consultas de solicitudes POSTERIORES del mismo usuario (la 464334 del 16-jul se comía una fila del 17-jul y daba "se consultó pese a la firma"). Hay que ir por el vínculo `user_request_risk_central_user_data`… pero esa tabla ata el reporte que quedó pegado a la solicitud **venga de consulta fresca o de caché**, así que la fecha sigue haciendo falta: anterior a la solicitud = reusado, posterior = consultado de verdad.
- **El contexto del veredicto vive en `logs.request`**, no en `response` (que queda vacío). Buscarlo en `response` devuelve `?` como razón y parece que la compuerta no dejó rastro.

### F-61 · Staging falla el login del asesor porque es OTRO pool de Cognito sobre la MISMA base

**Síntoma.** Contra `staging` el login de Cognito pasa sin problema, pero el wizard responde **"No tienes un comercio asignado"**. Se ve como un problema de permisos del comercio; no lo es.

**Causa raíz verificada.** Staging **no tiene backend propio**: usa el mismo legacy-backend y la misma base que dev. Lo único propio es el frontend desplegado. Pero el **frontend de staging entra por otro pool**:

| | puerta de Cognito | client |
|---|---|---|
| dev / local | `login.creditop.com` | `14lo4ra4khrdaomd78f0sqh2l4` |
| **staging** | `auth.merchant.creditop.com` | `il7p9uebtjjaoaqc6q9brg6f` |

Dos pools ⇒ la misma persona tiene **dos `sub` distintos**. Y del lado del backend hay **una sola fila** `users` con **un solo** `cognito_id`. Con el asesor de dev (`users` 1827080, `a.arismendy@uniandes.edu.co`, `cognito_id = 319b25f0-…`), entrar por staging le manda al backend un `sub` que esa fila no tiene → no lo encuentra → "no tienes un comercio asignado".

**Por qué no alcanza con "crear otra fila".** En `users`, `email`, `document_number` y `cell_phone` son **índices únicos**: no se puede duplicar a la misma persona con el otro `sub`. Pisarle el `cognito_id` a la fila de dev funciona, pero es **excluyente** — mientras esté el de staging, dev deja de andar.

**Solución (aplicada).** Una **cuenta de asesor por pool**, y que todo lo de Cognito sea **por target**:

- `pkg/config.ts` — `loadCognitoCreds()` pasó de `process.env` pelado a la cadena `env()`, así que las credenciales viven en `harness/.env.<target>` (gitignored) en vez de un `.cognito.json` único que habría que pisar para alternar.
- `pkg/cognito.ts` — el cache de sesión pasó de `.auth/cognito-state.json` a `.auth/cognito-state.<target>.json`. **No era cosmético**: el archivo viejo tenía cookies de los **dos** pools mezcladas (`login.creditop.com` **y** `.auth.merchant.creditop.com`), y con un único archivo la sesión de dev se inyecta en la corrida de staging — el front queda autenticado para Cognito y desconocido para el backend, **sin que aparezca el login** que lo corregiría.
- `bin/asesor` — `E2E_ASESOR_SUB` / `E2E_COGNITO_USER` de `.env.<target>` pisan al `asesor` de `.flows.json` (que describe al de dev). Es el `sub` que usa `load-permiso` para el assign.

En dev existe una familia de cuentas QA `oscar+<comercio>@creditop.com`, una por sucursal (`oscar+mediarte` ya está en la 375 de Mediarte, `oscar+dentix` en la 844 de DENTIX). Son las candidatas naturales para el pool de staging.

**Lo que queda abierto.** El `sub` de staging **no se puede deducir offline** (los de ambos pools son UUIDv7, sin nada que los distinga) y el storageState cacheado **no guarda JWT** — solo cookies. Se confirma en el primer login: si el wizard abre el comercio, el `cognito_id` que la fila ya tenía era el de staging; si repite "no tienes un comercio asignado", era del otro pool y hay que leer el real del id_token de esa sesión.

### F-62 · En dev/staging está desplegada solo LA MITAD de la omisión de Experian: aparece el selector, pero nada lo aplica

**Síntoma.** En el wizard de dev/staging el selector "Confirmación de cupo" **aparece y se puede marcar**, así que parece que la funcionalidad está. Pero las solicitudes terminan con `flow_id = NULL`, y aunque se firmara, Experian se consultaría igual. Se pierde tiempo buscando la falla en el usuario, la caché o el comercio — no está en ninguno de los tres.

**Causa raíz verificada.** El cambio del backend **no está en `develop`** (comprobado con `git fetch` hecho; `origin/develop` en `278b28a5`). El commit `a603a5cd` figura **solo** en `origin/feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage`. Y no es cuestión de un squash con otro sha: se comparó el **contenido** de los archivos en `origin/develop`.

Qué hay y qué no en lo desplegado:

| pieza | en `develop` | efecto |
|---|---|---|
| `check-if-able-to-omit` (RiskV2, `RKV26000`) | **SÍ** | el front pregunta y **muestra el selector** |
| corte por flujo en `app/Actions/RiskCentrals/Experian.php` | **NO** (0 menciones de flow/omit; la rama tiene 3) | **el buró se consulta igual** — y este es el camino que el wizard recorre |
| `RKV24029` en RiskV2 | **NO** | la API de decisión nunca dice "omitido" |
| `FLOW_ASSIGNABLE_STATUS_IDS` | `[1]` (la rama: `[1, 9]`) | la firma se rechaza en estado 9 con **`URV13005`** |

**Por qué entonces se ve el selector en staging.** Porque **front y backend van por caminos distintos**, y el front sí llegó:

| repo | commit | dónde está | dónde NO está |
|---|---|---|---|
| `frontend-monorepo` | `784585fe` (el selector) | `origin/staging` ✅ + la rama feature | `develop`, `main` |
| `legacy-backend` | `a603a5cd` (la omisión) | **solo** la rama feature | `develop`, `main`, `staging` |

`origin/staging` del front está **135 commits adelante** de `develop`. Y como staging **no tiene backend propio** (comparte el de dev, que corre `develop`), queda el peor cruce posible: **el front que muestra el selector está desplegado, y el backend que lo aplicaría no**. El selector no miente por sí solo — pregunta `check-if-able-to-omit`, que **sí** está en `develop` (viene del PR #982, la API de firma previa) y responde `RKV26000`. Lo que falta es todo lo que viene después.

Es la peor combinación posible para depurar: **la única pieza desplegada es la que hace visible el selector**. Todo lo que lo haría funcionar quedó afuera.

**Cómo se detectó.** Con `node dev/experian-api.ts <uReqId>`, que mide el veredicto de Experian **antes y después** de firmar sobre la misma solicitud: `check-if-able-to-omit` devolvió `RKV26000` (autorizado) pero la firma devolvió **HTTP 409 `URV13005`** — "User request status does not allow changing its flow" — sobre una solicitud en estado 9, que la rama sí admite. Ese desfase entre "el endpoint nuevo existe" y "la constante es la vieja" fue el hilo.

**Consecuencia práctica.** Ninguna prueba en dev/staging puede dar positiva hoy, por más limpio que esté el usuario o fría la caché. Hasta que el backend se despliegue, la validación va **contra el stack local** corriendo la rama (`CFE_TARGET=local`), donde el código sí tiene las tres piezas.

**Lección.** "Está mergeado" y "está desplegado en el ambiente contra el que pruebo" son afirmaciones distintas, y la segunda se verifica barata: `git show origin/develop:<archivo> | grep <lo que agregó la tarea>`. Vale hacerlo **antes** de armar el usuario de prueba, no después.

### F-63 · `RKV24027` (dato vigente) corta ANTES que la omisión por flujo — y se lee como si la omisión fallara

**Síntoma.** Con la tarea ya desplegada y el flujo firmado (`flow_id = 2`), dos de las tres variaciones de Experian devuelven `RKV24029` (omitido por flujo) pero la tercera devuelve **`RKV24027`**. Leído como "no todas se omitieron", parece que la omisión funciona a medias. No es así.

**Causa raíz verificada.** Las etapas de `CheckExperianTriggerService` corren en orden, y **"¿ya hay dato vigente para esta central?" (`RKV24027`) se evalúa antes** que la ventana de frecuencia y que la omisión por flujo (`RKV24029`). Si el usuario ya tiene un reporte fresco de esa central, la evaluación corta ahí y **nunca llega** a la etapa del flujo. `RKV24027` también significa "no se consulta" — solo que por otro motivo.

O sea: esa central **no participa de la medición**, no es que falle.

**Cómo leerlo bien.** Los únicos códigos que significan "sí, consultá" son `RKV24000` / `RKV24007` / `RKV24020` / `RKV24021`. Todo lo demás es una razón para no consultar. La prueba de la tarea es el **cambio**: centrales que devolvían uno de esos cuatro **antes** de firmar y devuelven `RKV24029` **después**. Contar como fallo a las que ya venían en `RKV24027` es un falso negativo — fue exactamente el primer veredicto equivocado de `dev/experian-api.ts`, ya corregido.

**Medición real (staging, 2026-07-21, con `91aaad3b` desplegado):**

| central | antes de firmar | después |
|---|---|---|
| `experian-acierta` | `RKV24021` (sí consulta) | **`RKV24029`** ✅ |
| `experian-quanto` | `RKV24021` (sí consulta) | **`RKV24029`** ✅ |
| `experian-acierta-quanto` | `RKV24027` (caché) | `RKV24027` — no participó |

Firma `URV13000`, `flow_id` 1 → 2. **Lo único que cambió entre ambas mediciones fue la firma** ⇒ la omisión de la tarea funciona.

**Cierra F-62:** el PR #988 se mergeó (`91aaad3b`) y se desplegó. La huella del build viejo era `URV13005` al firmar en estado 9; con el nuevo, `URV13000`.

### F-64 · El "Recorrido del wizard" cambiaba de forma según el ambiente — y contra dev salía vacío por un error que el panel se comía

**Síntoma.** El mismo comercio dibujaba mapas distintos en `local` y en `dev`, como si la lógica del flujo dependiera del entorno. Contra dev el recorrido salía **directamente vacío** (solo el tronco), sin ningún error a la vista.

**Causa raíz verificada — son tres cosas encadenadas, no una:**

1. **La consulta moría en dev.** `dbops lenders-for` seleccionaba `COALESCE(l.product,'credit')`, pero **`lenders.product` no existe en dev** (la agrega una migración hoy aplicada solo en local). `COALESCE` no salva eso: maneja NULL, no una **columna ausente** — la consulta entera revienta con `Unknown column 'l.product' in 'field list'`.
2. **El panel se comía el error.** `/api/lenders` hacía `Array.isArray(lenders) ? lenders : []`, así que un `{error: …}` se normalizaba a lista vacía. El resultado era indistinguible de "este comercio no tiene entidades", y por eso el bug sobrevivió: **no fallaba, desaparecía**.
3. **El dibujo dependía de datos volátiles del ambiente.** Filtraba por `lender_status === 1` (un interruptor propio de cada base) y creaba **un carril por entidad** para la familia CreditopX — o sea que el padrón de cada ambiente cambiaba la cantidad de carriles. Incoherente además con el propio archivo, donde el **color** ya iba por producto con el comentario *"dos lenders del mismo producto recorren lo mismo"*.

**Arreglo (aplicado).**

- `bin/dbops.ts` — detecta la columna (`SHOW COLUMNS FROM lenders LIKE 'product'`) y degrada a `NULL` si no está, en vez de tumbar la consulta.
- `panel/server.ts` — el `{error}` viaja al cliente como `msg` en vez de convertirse en `[]`.
- `panel/index.html` — **un carril por RECORRIDO**, con clave `rt + product + desvíos + extensiones`, y **sin** filtrar por `lender_status`: lo apagado se anota (`(apagado)` + carril con `opacity .35`) y el orden es estable (rt, producto). Además `#trenwarn` avisa lo que no se pudo dibujar: sin entidades, o sin `product`.

**Verificado en el panel** (mismo comercio, Motai):

| | entidades | carriles |
|---|---|---|
| `local` | 5 | `credit·8 \| renting·10 \| rto·10 \| Agregador·3 \| Estándar·1` |
| `dev` | 4 | `rt2·8 \| Agregador·3 \| Estándar·1` + aviso explícito |

Y con datos simulados de "otro ambiente" sobre el mismo comercio —orden invertido, una entidad apagada y una entidad **extra** que repite un producto— la firma estructural da **idéntica**. Antes, ese mismo caso agregaba un carril y borraba otro.

**Lo que queda como diferencia legítima:** dev no tiene la columna `product`, así que ahí los CreditopX no se pueden separar por producto y van en un carril. No se disimula — se avisa. La diferencia es de **datos**, y el panel ahora lo dice en vez de cambiar de forma en silencio.

**Regla que deja.** Un diagrama que se arma con datos del ambiente tiene que separar **estructura** (la lógica, estable) de **estado** (qué está prendido hoy, variable). Mezclarlos convierte una diferencia de configuración en una aparente diferencia de comportamiento — y eso manda a depurar el lugar equivocado. Vale para este mapa y para cualquier visualización del playground.

### F-65 · El sembrado headless registraba al cliente en el backend LOCAL aunque el target fuera dev

**Síntoma.** Con "Saltar a: Lenders" contra `dev`, el wizard moría con *"Error al obtener las opciones de financiamiento"* y, en el log del SSR, `GET /api/onboarding/loan-application/lenders-v2/{id}` → **500 `Attempt to read property "id" on null`**. Sistemático: tres corridas seguidas. Con "Saltar a: Monto" el mismo comercio andaba bien.

**Causa raíz verificada.** `pkg/config.ts` definía `mockUrl: env('E2E_MOCK_URL', 'http://localhost')`, y **`E2E_MOCK_URL` no está definida en ningún target** → `config.mockUrl` valía `http://localhost` en los **tres**. El sembrado headless (`dev/guided.spec.ts::seedHeadless`) llama a `${config.mockUrl}/api/onboarding/phone/register`, así que:

1. registraba al cliente sintético en el backend **LOCAL** (sail),
2. se traía un `users.id` de la **base local** (siempre el mismo: 1828501, porque el scrub de dev no la toca),
3. e insertaba el `user_request` en la base de **DEV** con ese id ajeno.

Resultado: solicitud **huérfana**. `lenders-v2` la encuentra, hace `->user->id` sobre null y tira 500. Se confirmó de los dos lados: el usuario 1828501 **existe en local** con el teléfono de bypass y **no existe en dev**, donde ningún usuario tenía ese teléfono.

Solo se veía en el atajo headless: por el camino visual el cliente lo crea el wizard real, que sí apunta al backend del target.

**Arreglo (aplicado).**

- `pkg/config.ts` — `mockUrl` sale de la cadena por target: `E2E_MOCK_URL` (override explícito para un backend mockeado) y si no, `E2E_API_BASE_URL` sin el sufijo `/api`. Verificado: `local → http://localhost`, `dev` y `staging → http://legacy-backend.inertia-develop`. Y el register contra dev devolvió `1827708`, que **sí** está en la base de dev.
- `dev/guided.spec.ts` — antes de insertar el `user_request` se comprueba **contra la BD** que el usuario exista; si no, aborta e imprime el id devuelto, si hay alguien por teléfono y la **respuesta cruda del register**. Sembrar sin esa comprobación convertía un error de configuración en un 500 opaco cinco minutos de cold-boot después.

**Familia.** Es el mismo patrón que F-59 (`bin/asesor` leyendo `.env.$TARGET` a mano) y que F-64 (`/api/lenders` tragándose el error): **un default que parece inofensivo — `'http://localhost'` — enmascara la ausencia de configuración por target**. Regla: si un valor depende del ambiente, sale de la cadena (`env()`/`envget`); un fallback a localhost es aceptable solo cuando localhost ES la respuesta correcta para ese target.

**Deuda menor.** El nombre `mockUrl` ya no describe lo que es (viene del mock-server :4000, eliminado). Hoy es "el backend del target"; renombrarlo evitaría la próxima confusión.

### F-66 · El salto headless a `/lenders` "rebotaba" en staging — no era el front ni el estado, era una carrera post-login del harness

Continúa F-65: aquélla arregló la solicitud huérfana; esto es lo único que quedaba abierto del salto directo.

**Síntoma.** Con "Saltar a: Lenders" contra `staging`, el wizard quedaba en `/merchant/<hash>/solicitar` en vez de abrir el listado. El propio harness lo reportaba como *"El front rebotó la solicitud sembrada — su estado no pasa el guard de /lenders"*. En `local` el mismo salto **sí** funcionaba.

**Causa raíz verificada — es el harness, no el front ni el estado.**

Primero se descartó el título del pendiente ("staging es otro build con otro guard"): `git -C frontend-monorepo diff HEAD origin/staging` de `routes.ts`, `routes/lenders-marketplace/available-lenders.tsx`, `layouts/default-layout.tsx` y `routes/auth/callback.tsx` da **vacío** — el flujo de `/lenders` es idéntico en la rama y en el build desplegado (`origin/staging` @ `e896abaf`, que ya incluye la feature #719). Y ninguno de los **dos** loaders que corren en `/merchant/:hash/:ur/lenders` mira `user_request_status_id`: `default-layout` solo rebota si la sucursal del asesor ≠ el hash de la URL (acá **coinciden**, ambos `76db47f5`, probado por el `↪ 302 /merchant → /merchant/76db47f5/solicitar`), y el loader de `available-lenders` no tiene un solo `redirect`. El estado 9 nunca fue lo que rebotaba — por eso local, con el mismo estado, anda.

Lo que pasa es una **carrera post-login**:

1. Sin sesión de app cacheada (staging), el primer `goto` a `/lenders` rebota al Hosted UI de Cognito.
2. `cognitoLogin` volvía apenas la URL tocaba el host de la app (`waitForURL(hostPattern)`, un regex de **host**), es decir en una ruta de **tránsito** (`/auth/callback` → `/merchant` → `/solicitar`) **antes** de que la cadena terminara y el `Set-Cookie` de sesión se asentara.
3. El harness disparaba entonces el segundo `goto` a `/lenders` **con la cadena del callback aún en vuelo**. Ese goto tenía `.catch(() => {})`: Playwright lo abortaba por navegación en curso y el error se tragaba. La cadena del callback ganaba y dejaba el browser en `/solicitar`. **Nunca se emitió un `GET /lenders` que completara.**
4. `waitForURL(/lenders/, 60s)` esperaba un `/lenders` que ya nadie iba a pedir → timeout → quedaba en `/solicitar`.

**Evidencia.**

- En el log de la corrida **no aparece** ningún `↪ 3xx …/lenders → …/solicitar` (el response-listener de `guided.spec.ts` lo habría impreso). Solo el `↪ 302 /merchant → /merchant/76db47f5/solicitar`, que es el aterrizaje normal del callback ⇒ el server **no rebotó** `/lenders`.
- El `.auth/cognito-state.staging.json` reescrito durante la corrida contenía **solo cookies del dominio de Cognito** (`auth.merchant.creditop.com`), **ninguna del dominio de la app** — la foto del `storageState` se tomó en tránsito, antes de que existiera la sesión de app. Eso además dejaba el cache de staging **inútil**: nunca evitaba el login → siempre re-caía en la carrera (círculo).
- En local no ocurre: la sesión está cacheada, el único `goto` va directo a `/lenders`, sin login ni cadena de callback.

**Arreglo — parte 1: el salto ya llega (aplicado y verificado en vivo).**

- `pkg/cognito.ts` — tras el submit, `cognitoLogin` espera a **salir de las rutas de tránsito** (`AUTH_TRANSIT = /^\/(auth\/callback|merchant)\/?$/`) y a `networkidle` antes de volver, para no dejar redirects en vuelo.
- `dev/guided.spec.ts` (bloque `DIRECT_LENDERS`) — se separó el login del salto: primero `cognitoLogin` (que ahora descansa), y recién después el `goto` a `/lenders` **con reintento** (hasta 3, esperando un destino real), en vez de un único goto con catch vacío.
- Diagnóstico honesto: un flag `lendersBounced` (lo prende un 302 real `/lenders → /solicitar`) distingue "el front lo rechazó" de "el salto ni se pidió". El mensaje viejo asumía siempre lo primero.

Con esto la corrida del 2026-07-22 (uReq 464365) llegó: `entrada DIRECTA → /merchant/76db47f5/464365/lenders`.

**Segunda capa: por qué IGUAL se ve `/solicitar` durante el login.** Cuando el harness tiene que loguear, el aterrizaje post-login es `/solicitar` — no por el harness, sino por el **front**: `routes/auth/callback.tsx` hace `redirectTo = url.searchParams.get("redirectTo") || "/merchant"`, pero Cognito devuelve el destino en el `state`, no en un query `redirectTo`, así que **siempre cae en `/merchant` → `/solicitar`**. El `redirectTo` del deep-link se pierde. La única forma harness-side de no verlo es **no loguear**: reusar la sesión cacheada.

**El cache SÍ retiene la sesión — el diagnóstico inicial buscaba el nombre equivocado.** Primero se creyó que el `storageState` no guardaba la sesión, porque no aparecía `__session` (el nombre en el build local: `session.server.ts` → host-only). **Pero el deploy de staging llama a esa cookie `_session`** (UN guión bajo, `@.creditop.com`, compartida entre subdominios). El `storageState` sí la guardaba; filtrar por `__session` daba un falso "el cache no autentica". Por eso la validez NO se chequea por nombre de cookie sino por **fetch real** (abajo). Verificado: `.auth/cognito-state.staging.json` tras un pre-login tiene 8 cookies **incluida `_session`**.

**Arreglo — parte 2: reuso de sesión + pre-login (aplicado y verificado).**

- `pkg/cognito.ts::persistCognitoState()` — da `expires` (+7 días) a las *session cookies* (Playwright las serializa con `expires:-1` y puede descartarlas al restaurar) y escribe el `storageState`; `dev/guided.spec.ts` lo re-persiste **ya en `/lenders`** (autenticado). El cache queda con la sesión (`_session`) buena.
- `dev/warm-session.spec.ts` — **pre-login**: `cognitoLogin` + `persistCognitoState`, sin correr un flujo. **Headless en dev/local; HEADED en staging** (ver el gotcha abajo). Se corre una vez cuando el token caducó; después toda corrida arranca autenticada (sin login → sin `/solicitar`). Además `persistCognitoState` **descarta las cookies `oauth2:*`** (state CSRF efímero del handshake) para que el cache no las acumule (se vieron 5 juntas de logins a medias).
- `bin/session-check.ts` — chequeo REAL por target: pega a `/merchant` del front con las cookies del cache (`redirect: manual`) y mira si rebota a Cognito. **No filtra por nombre de cookie** (staging=`_session`, local=`__session`): la verdad es si el front deja pasar.
- **Panel** (`server.ts` + `index.html`) — dot en cada botón de ambiente: **verde** = sesión válida, **gris** = caducó/no existe/no verificable (clic → pre-login con loader ámbar). Endpoints `GET /api/session-status` (cacheado 60s) + `POST /api/session-refresh`.

**El diagnóstico "staging bloquea headless" también era FALSO — la causa raíz real era otro matcheo por substring.** El warm de staging "quedaba colgado en `/verifyPassword`" headless Y headed, incluso con contexto limpio. Una traza navegación-por-navegación (`response` + `framenavigated`) mostró la verdad: las URLs del Hosted UI llevan el host de la app **adentro del query** (`redirect_uri=https%3A%2F%2Foriginaciones-stg.dev.creditop.com…`), y `hostPattern` — un regex del host testeado contra el **href** — matcheaba eso **en la propia página del password**. Consecuencia: el "esperá a volver a la app" post-submit se satisfacía a los **0 segundos**, con el auth todavía en vuelo. Nadie esperó nunca el login real de staging:

- El warm declaraba "colgado" y fotografiaba el spinner de un auth que iba a completar segundos después.
- El goto siguiente de una corrida **interrumpía el auth en vuelo** → rebote a `/login` → Cognito otra vez (con el retry del salto, en LOOP: el usuario veía la pantalla de Cognito repetirse) — y cada vuelta acuñaba una cookie `oauth2:*` más (se encontraron 5 juntas: la huella del loop).
- En dev no se notaba: su pool (`login.creditop.com`) no contiene el host de la app como substring del query en la página del password de la misma forma, y la sesión solía estar cacheada.

**Arreglo (el de verdad):** `pkg/cognito.ts` compara `url.host === returnHost` (predicado de URL), no un regex contra el href. Con la espera real, el warm de staging completa **HEADLESS en ~29s** con `_session` en el cache — se revirtió el modo headed del panel: los tres targets se autentican sin ventana. Además `persistCognitoState` descarta las `oauth2:*` (state CSRF efímero) para no arrastrar handshakes muertos.

**Panel (cierre de la UX):** al abrir, el panel **chequea los 3 ambientes y pre-autentica** los que estén sin token (`missing`/`invalid`; `unreachable` no — front caído no es warmeable ni bloqueante). **"Preparar + Lanzar" queda deshabilitado** mientras el token del target activo se obtiene ("obteniendo token…") o falta ("sin token", apuntando al dot); con el dot verde se habilita y la corrida entra directa, sin ver Cognito ni `/solicitar`.

**Estado: RESUELTO y verificado en los tres targets** — `session-check` staging → `valid`, dot verde, warm headless reproducible; gating del botón verificado en sus tres estados (warming/missing/valid).

**Lección.** Las CUATRO pistas falsas de este finding comparten raíz: **conclusiones sacadas de un síntoma sin traza**. (1) "el estado 9 no pasa el guard" — el guard no mira el estado. (2) "staging es otro build" — diff vacío. (3) "el cache no retiene la sesión" — la retenía con otro nombre (`_session` vs `__session`). (4) "el Managed Login bloquea headless" — nunca se esperó al login. Y las DOS causas reales fueron **matcheos por substring donde había que comparar estructura**: el nombre de la cookie (3) y el host en el href (4) — `redirect_uri` mete el host de la app en CUALQUIER URL de Cognito, así que un regex de host sobre el href es un bug latente en todo harness OAuth. Verificá con un request/traza real ANTES de concluir; emparenta con F-03 (el fallo silenciado) y F-65 (el default que enmascara).

### F-67 · El salto a `/lenders` se colgaba 90s en staging — no era la inserción del sintético, era `domcontentloaded` esperando el stream de pre-aprobaciones

Continúa F-66: aquélla logró que el salto **llegue**; esto es por qué, ya llegando, la corrida tardaba ~140s y moría.

**Síntoma.** "Saltar a: Lenders" contra `staging`: la corrida duraba 141s y caía con `page.goto: Timeout 90000ms exceeded` en el salto a `/lenders` (`guided.spec.ts`). Se leía como *"la inserción del usuario sintético es lentísima en staging"*.

**Causa raíz verificada — no es la inserción, es el `waitUntil` del salto sobre una página que streamea.**

La inserción tarda **~1s**. Timestamps de `.runs/` (uReq 464379): la corrida arranca `18:12:30`, la 1ª fila cae `18:12:44` (14s de arranque de Playwright + browser + cargar sesión + lookup del asesor), y **las otras 6 filas del `synthFill` caen todas en `18:12:45`** — un segundo para todo el sembrado. El resto hasta `18:14:52` (141s) se lo come el `goto` a `/lenders`, que expira a los 90s.

Por qué se cuelga el `goto`: `/lenders` **streamea** (`entry.server.tsx:59` → `renderToPipeableStream`, `streamTimeout=240_000` en staging, `:15`) y el loader de `available-lenders.tsx` **no espera** las pre-aprobaciones — las arma como promesas (`loanOptionsPromise` → `fetchLenderPreApproval` por cada lender rt≠0, `VITE_PREAPPROVALS_ENDPOINT` → API externa de cada lender) y las resuelve vía `<Await>` en el componente. Con streaming, `DOMContentLoaded` no dispara hasta que **cierra el stream**, y el stream no cierra hasta que resuelven esos `<Await>`. El salto pedía `waitUntil: 'domcontentloaded'` → esperaba, de hecho, a que las 5 pre-aprobaciones rt≠0 (Welli #23, Welli Risk #166, BdB #5, Meddipay #39, Credifamilia #24) contestaran desde proveedores reales, con un usuario sintético que no existe en sus sistemas → >90s → timeout.

**El enmascarador: la "Confirmación de cupo" lo tapaba.** Con `flow_id=2` el backend recortaba el listado a **solo rt=0** (F-62/F-66: `LenderListingController`), así que `eligibleLenders` (los rt≠0) quedaba vacío → **cero pre-aprobaciones** → el stream cerraba al toque → `domcontentloaded` disparaba en segundos. Al sacar la confirmación de cupo del panel (flujo estándar, "sin firmar"), volvieron los 5 rt≠0 y con ellos el cuelgue. El veredicto de la corrida que falla dice `flujo: sin firmar`; el de las que entraban rápido, `flujo: 2`. Esa es la única variable que cambió, y es justo la que gobierna si hay pre-aprobaciones.

**Evidencia.** Timestamps en `.runs/ultima-corrida.json` (arriba). Código: `guided.spec.ts` goto con `domcontentloaded`/90s; `available-lenders.tsx:160-251` (pre-aprobaciones diferidas en `loanOptionsPromise`, consumidas con `<Await>`); `entry.server.tsx:15,59` (streaming + `streamTimeout` 240s en staging); recorte a rt=0 por `flow_id=2` en F-62/F-66.

**Arreglo (del harness, no del front — el front streamea a propósito, es buena UX).** `guided.spec.ts` (bloque `DIRECT_LENDERS`, salto + retry): `waitUntil: 'domcontentloaded'` → **`'commit'`** (timeout 90s → 30s). `commit` resuelve apenas el server responde (post-302 de sesión), sin esperar el stream: la página se pinta sola y la maneja el usuario, y quien confirma el aterrizaje es el `needsCognito()`/`waitForURL(/lenders|solicitar/)` de después, no el `waitUntil`. El comentario del salto deja escrito el porqué, para que nadie lo revierta a `domcontentloaded` "por seguridad".

**Estado: aplicado, type-check limpio. Las PIEZAS están verificadas (código + timestamps); el mecanismo integrador —que el cuelgue de 90s sea exactamente el stream de pre-aprobaciones y no un `await` bloqueante del shell (`getAlliedThemeUc`/`captureAnalyticsEventServer`)— se apoya en la eliminación (esos colgarían con o sin `flow_id=2`, y con `flow_id=2` la corrida entraba) pero NO se confirmó en vivo con una traza de red de la corrida colgada. Se cierra del todo cuando la próxima corrida con `commit` entre a `/lenders` en segundos.**

**Lección.** Un `waitUntil: 'domcontentloaded'` sobre una ruta con streaming SSR no espera "que cargue la página" — espera que **cierre el stream**, o sea todo lo diferido (acá, llamadas a proveedores externos). Para "ya navegué, la ventana es del usuario" el evento correcto es `commit`. Y el patrón que se repite desde F-66: un cambio aguas arriba (sacar la firma) **destapó** un costo que otra cosa venía absorbiendo — el "de repente está lento" casi nunca está donde uno mira primero (la inserción); la traza con timestamps lo ubicó en un segundo.

### F-68 · El guiado AUTO de Motai renting/rto nunca pasaba por Ábaco — lo salteaba el driver del harness, no la des-motaización

**Síntoma.** `bin/asesor motai auto` con un lender renting/rto (Motai R #169 / RB #170) cerraba en Estado 11 pero **sin pasar nunca por Ábaco**: la ventana B iba confirmation → first-payment directo, sin `/abaco/platforms` ni `/platform-otp-validation`. Se leía como *"la des-motaización rompió el trigger de Ábaco"* (antes se disparaba por modo `isMotaiRenting`; ahora por `lenders.product`).

**Causa raíz verificada — es el DRIVER del guiado, no el producto.**
- El trigger por-producto **funciona**: diagnóstico en el punto de confirmación → el uReq ya tiene el lender del producto en `user_requests.lender_id` y `check-abaco-requirement` da **MOTV1001** (`[diag Ábaco] lender_id=170 product=rto → REQUERIDO`). La regla `in_array(lender.product, ['renting','rto'])` de `MotaiValidationService` es correcta.
- El driver GUIADO (`guided.spec.ts`, bloque CreditopX de B) hacía `B.goto('.../first-payment-date')` **incondicional** tras confirmation — salteando el "Continuar" de `/confirmation`, que es donde vive el redirect a Ábaco (`loan-confirmation.tsx` action → check-abaco REQUIRED → `/abaco`). El `wakeB` del path MANUAL sí tenía la rama de Ábaco; el GUIADO (otro código) no.

**Red herring que costó tiempo.** El uReq FINAL quedaba con `lender_id=77` (CrediPullman, product=credit) → parecía *"el producto no llega a lender_id"*. Pero eso lo ponía el safety-net `closeCreditopX(uReq, {})`, que **defaulteaba a credipullman** y pisaba el lender real al cerrar por backend — pasa DESPUÉS de confirmación, no afecta el check. En confirmación el lender_id es el correcto (170).

**Evidencia.** El `[diag Ábaco]` (lender_id/product/pideAbaco) en confirmación; las corridas que saltaban confirmation→first-payment sin `/abaco`; `guided.spec.ts` (goto directo a first-payment); `loan-confirmation.tsx:194-206` (redirect a /abaco en el action); `MotaiValidationService` (requirement por product); `pkg/close.ts:54` (default credipullman).

**Arreglo (del harness, no del front).** `guided.spec.ts`: si el producto pide Ábaco, en vez del salto se clickea "Continuar" → `/abaco` y se AUTO-MANEJAN las pantallas gig (plataforma → credencial → Guardar → Continuar → OTP → verificar); el mock-abaco aprueba cualquier credencial/OTP (`/login` basta con success, `/results` da el fixture en local). `pkg/close.ts`: el safety-net usa el `lender_id` real del uReq (leído de la BD), sin default credipullman. Commits locales en playground.

**Estado: aplicado, type-check limpio. VERIFICADO que el guiado ENTRA a Ábaco (`/abaco → platforms → platform-otp-validation`) y cierra en Estado 11 (corrida uReq 464537, gig manejadas a mano). El AUTO-DRIVE de las pantallas gig (selectores uber/Guardar/Continuar/OTP) queda por confirmar en la próxima corrida hands-off.**

**Lección.** Hay DOS drivers de la ventana B (`wakeB` del modo manual + el bloque guiado en el cuerpo del test): arreglar la rama en uno no toca al otro. Y "el flujo saltea X" en un E2E semiauto casi siempre es el harness esquivando a propósito un muro no-automatizable (acá la captura ADO por foto), no el producto. El diagnóstico de 1 línea en el punto exacto de decisión (lender_id + check real) separó "regresión del producto" de "el harness no lo maneja" — que era lo que parecía y no era.

### F-69 · "Advisor validation error" en el `/continue` del asesor para lenders None-identity + Ábaco — un `validated=false` en una validación NO requerida

Destapado apenas el guiado empezó a RECORRER Ábaco (F-68): con el paso ya visible, la ventana del asesor mostró el error.

**Síntoma.** En un flujo Motai renting/rto (o cualquier **None-identity + Ábaco**), la ventana del **ASESOR** (`/continue`, variante `AbacoLoanContinueRouteContent`) muestra **"Los datos no pudieron ser validados para el cliente"** / `Error: Advisor validation error` — aunque el cliente (ventana B) cierra bien en Estado 11.

**Causa raíz verificada — bug de PRODUCTO, no del harness.** `ValidationStatusService::notRequiredValidationStatus` (backend, `Modules/Identity`) devolvía `validated=false` aunque `skipped=true` / `completed=true` / `status='not_required'`. Y el lado A (`loan-continue.tsx`, `hasAdvisorBusinessError`, ~línea 364) gatea con `data.ado && !data.ado.validated` **sin mirar `skipped`**. Para un lender None-identity (Motai, `identity_validation_type_id=1`), `resolveValidationType` ≠ `Ado` → `ado = notRequiredValidationStatus` (validated=false) → el asesor lo lee como "no validó" → error. **Como A pega al backend REAL (sin mock, a diferencia de B), esto ocurre también en producción**, no solo en el harness.

**Lo destapa la des-motaización.** Al poner Motai `product=renting/rto`, `check-abaco-requirement`=MOTV1001 → `isAbacoRequired=true` → el asesor cae en la variante Ábaco del `/continue` (antes, por modo, no caía ahí). El trigger de Ábaco está BIEN (F-68); lo expuesto es esa pantalla asumiendo validación de identidad (ADO) para un lender que es None-identity y no la pide.

**Evidencia.** Screenshot del asesor con "Advisor validation error"; `ValidationStatusService.php:330` (`notRequiredValidationStatus`, validated=false); `getValidationStatus:67-69` (`ado = notRequiredValidationStatus` cuando el tipo ≠ Ado); `loan-continue.tsx:359-366` (`hasAdvisorBusinessError` sin `skipped`); enum `IdentityValidationType` (`None=1`); Motai lenders con `identity_validation_type_id=1`.

**Arreglo.** `notRequiredValidationStatus` → `validated=true` (una validación no-requerida es una compuerta PASADA; el matiz "no se validó de verdad" queda en `skipped`/`status`). Aplica a `ado` y `crosscore` no-requeridos por igual. Commit en `feature/motai-clean-v2` de legacy-backend (junto a la des-motaización que lo expuso).

**Estado: aplicado. ValidationStatusServiceTest 22 passed (40 assertions); php -l limpio. Falta la confirmación E2E (el asesor deja de errorear y sigue a `financial-profile`) en la próxima corrida del guiado.**

**Lección.** El harness, al hacer que el guiado RECORRA Ábaco (F-68), destapó un bug de producto que el salto directo tapaba — el valor de un E2E no es solo "pasó/falló", es que *recorrer de verdad* un flujo expone lo que saltearlo esconde. Y la trampa semántica: `validated=false` para algo `not_required` hace que cualquier consumidor que gatee por `validated` trate un skip como fallo. Un booleano de "compuerta pasada" no debe ser `false` cuando la compuerta ni siquiera aplica.

### F-70 · La pantalla del asesor (`financial-profile`) muere con `fetch failed` en local — falta el MS financial-health (:4000) → mock que lee la BD real

El siguiente muro detrás de F-69: arreglado el "Advisor validation error", el asesor avanza a `financial-profile`… y el loader revienta.

**Síntoma.** En el `/continue` del asesor, al navegar a `financial-profile` (la revisión/decisión de Motai renting/rto): `TypeError: fetch failed` en `FinancialProfileRepository.getFinancialProfile` (`financial-profile.tsx` loader). Parece un bug del wizard; es infra local.

**Causa raíz verificada.** El loader SSR hace `POST {FINANCIAL_HEALTH_API_URL}/v1/financial-profile/me` (`financial-profile.repository.ts`). El `.env` del wizard trae `FINANCIAL_HEALTH_API_URL=http://localhost:4000` y **en local no corre ningún financial-health** (curl a :4000 → no conecta). El MS es externo al monorepo; nunca estuvo en la flota local. Reproducido por curl; mismo patrón que la sección B (env/servicio faltante con cara de bug de producto).

**Arreglo — `mock-financial-health` en la flota (harness).** Nuevo `mock-financial-health/server.ts` + `bin/mock-financial-health`, arrancado por `bin/asesor` en target `local` (junto a payvalida/mdm/lenders/forms/ábaco; el panel lo lista como `fin-health :4000`). Regla de diseño (pedida por Miguel): **no inventa datos** — lee el usuario sintético REAL de la BD local: `users` (nombre/doc/edad) · `user_field_values` 87/29 (ingreso/ocupación) · `user_summaries.datacredito` (score/negativos → `debtCapacityPercentage` derivado de `value_monthly_payment/ingreso`) · `user_summaries.abaco.average_income` → `monthlyInformalIncomeAmount` (el resultado real del flujo gig, si corrió). BD caída → **503 honesto**; uReq inexistente → 404. Ocupa el `:4000` que el `.env` del wizard ya apunta (cero cambios en el repo real); si el puerto lo usa otro proceso, el wrapper **corta con error** (chequeo de identidad `mock: financial-health`), no un "ya arriba" falso.

**Gotcha que ya mordió (para el próximo mock):** las columnas **JSON** de MySQL llegan por mysql2 **ya parseadas a objeto** — un `JSON.parse(valor)` sobre eso tira y un `catch → {}` silencioso deja los campos en null con cara de "no hay datos" (el primer curl devolvió `creditScore:null` con score=700 en la BD). Verificá contra `JSON_EXTRACT` antes de creerle a un null.

**Estado: aplicado y VERIFICADO por curl con un uReq real (score 700, negativos 0, debt 33%, 404/503 honestos). Falta verlo dentro del guiado (la pantalla del asesor renderizando el perfil).**

**Lección.** Detrás de un muro suele haber OTRO: F-68 (el guiado no recorría Ábaco) → F-69 (el asesor rebotaba por `validated=false`) → F-70 (el asesor no tenía financial-health en local). Cada arreglo corre la frontera de lo probable en local un paso más — y el inventario de la flota (README) es el mapa de esa frontera.

### F-75 · El marketplace sale VACÍO si el lender que ofrece la sucursal no tiene `group_rules` propias

**Síntoma:** `/lenders` responde OK pero con **cero entidades** para Motai en dev ("lenders-v2 OK pero con CERO lenders"). Se lee como filtro duro de datacrédito, cupo o un lender apagado.

**Causa raíz verificada — un lender SIN reglas nunca se agrega.** En `LenderValidationService::validateRulesByLender` el acumulador arranca vacío y solo se llena dentro del `if ($filteredGroupRules->count() > 0)`, cuando la evaluación da true:
```php
$return_lenders = [];                          // arranca VACÍO
foreach ($lenders as $lender) {
    if ($filteredGroupRules->count() > 0) {    // ← sin reglas para ESTE lender, nunca entra
        if ($global_result) $return_lenders[] = $lender;
    }
}
```
Ese camino solo corre si la sucursal **tiene** `group_rules` (si no tiene ninguna, `LenderListingService` devuelve todos). Lo traicionero es la combinación: la sucursal 682 de Motai **tenía** 14 `group_rules`, pero configuradas para los lenders **5, 6, 8, 9, 11, 12** — y los que ofrecía (`lenders_by_allied_branches`) eran **62 y 158**. Cruce vacío → listado vacío. Encaja con que las reglas **se copian por sucursal al habilitar la entidad**: a estos dos nunca se les copiaron.

**Evidencia:** los tres conjuntos por separado — ofrecidos `62, 158` · con reglas `5, 6, 8, 9, 11, 12` · intersección **∅**. Y el cruce estaba **invertido** entre ambientes: en local el 62 tenía reglas pero no estaba ofrecido, y 168/169/170 sí listaban. Confirmación por descarte: la asociación existía, ambos `status=1`, las migraciones de motai-v2 estaban, el buró sintético bien inyectado, y `users_category_log` **sin filas** — o sea el motor de cupo **nunca llegó a correr**, el filtro de reglas cortó antes.

**Arreglo:** es **configuración de datos**, no código — crear `group_rules` + `lender_rules` para el lender en esa sucursal (lo hizo Duncan el 2026-07-28: 14 → 18 grupos, ahora 62 y 158 con reglas). Tras eso el 158 lista y el sintético del harness pasa las 6 reglas (ocupación, `field 160=no`, ingreso ≥ 1.000.000, género, edad 18–100) con `lender_datacredito_rules.score` en 0.

**Estado: resuelto en dev y verificado** (`sweep matrix motai` → `158 [lista] → standBy (in-platform)`). **Lección:** "marketplace vacío" con la sucursal bien configurada casi nunca es el buró ni el cupo: comparar **los tres conjuntos** —qué ofrece la sucursal, qué lenders tienen reglas, y la intersección— ubica la causa en una consulta. Y `users_category_log` vacío es la firma de que el corte fue **antes** del motor de categorías.

---

### F-78 · El badge del marketplace lo decide PREAPROBADOS, que le pregunta a OTRO backend — un fix de cupo mergeado en `qa` no mueve la tarjeta

**Síntoma:** el fix de "cupo sin buró para lenders que validan ingreso por Ábaco" está mergeado en `qa` y desplegado, pero la tarjeta de Motai Renting sigue diciendo **"Sin cupo disponible"**. Se lee como "el fix no funciona" o "falta desplegar".

**Causa raíz verificada — dos evaluaciones distintas, en dos ambientes distintos.** El chip de rechazo NO sale del cupo que calculó el backend que sirve al front: lo pinta la resolución de **pre-aprobaciones** en `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/services/lender-resolution.service.ts:57` — copy curado para el estado terminal `low_probability`/rechazado que devuelve el MS. Y el MS de `pre-approvals-service` pregunta el cupo rt=2 con un `POST` a `…/api/loans/lender/available-quota` contra **su propia** `base_url`, que en dev apunta a `legacy-backend.inertia-develop` (rama **develop**), no al servicio de qa (`config/config.example.yaml:136`). El fix estaba solo en `qa`.

**Evidencia — el mismo POST, el mismo usuario, a los dos backends:**
```
qa  (legacy-backend-qa.inertia-develop) → has_quota:true,  status:approved, available_amount:20.000.000, categoría 179
dev (legacy-backend.inertia-develop)    → has_quota:false, reason:"eligibility_criteria_not_met", 0
```
Y las dos evaluaciones quedaron registradas en `users_category_log` del mismo usuario PEP sin buró (id 1827761, uReq 464529), 21 s aparte: `92638` con `"skipped_bureau_abaco":true` y cupo (la de qa) y `92639` con `"datacredito":false` y cupo 0 (la que disparó el MS). Como el badge dijo rechazado, el MS **no** leyó la respuesta de qa.

**Segundo agujero en el mismo camino — hay DOS clases `LenderUserCategoryService`.** `Modules/Loans/App/Services/…` (la que tiene el skip) y `Modules/Onboarding/App/Services/lenders/…` (la gemela, sin skip). En `LenderRetrievalService.php:720` un hardcode decide cuál corre:
```php
if ($ctopx_lender_id == 160) {  // solo CrediPullman
    …lenderUserCategoryServiceCtopx  // ← Modules\Loans (con el skip)
} else {
    …lenderUserCategoryService       // ← Modules\Onboarding (SIN el skip)
}
```
O sea que para **158** el listado usa la gemela, y de ahí salen `fee_number`, `initial_fee_percentage`, `creditLines->max_amount` — y el filtro que **elimina** al lender si `available_amount < min_amount`. Truco para distinguirlas en el log: la de Loans escribe la clave `occupation`, la de Onboarding `ocupations` (con typo).

**Arreglo:** para que la tarjeta cambie, el fix tiene que estar en la rama que sirve el backend **al que le pregunta el MS** (hoy `develop`) — o apuntar la config del MS a qa. Aparte, decidir la gemela: parchearla igual o unificar las dos en un solo servicio.

**Lección.** Validar un cambio de cupo rt=2 sólo contra `qa` **no** prueba el marketplace: el número que ve el usuario pasa por el MS, y el MS tiene su propia idea de cuál es "el backend". Cuando un badge y una respuesta de API se contradicen, buscar **cuántos** evaluadores corrieron (`users_category_log` da uno por llamada) antes de dudar del código.

---

## M · Convenciones de tasa (dos conviven y dan distinto)

### F-71 · En CreditOp conviven DOS convenciones de tasa — nominal (el canon) y efectiva (Credifamilia) — y ya divergieron en producción: 1,82 % N.M. vs TEA 28,79 %

Parece un detalle de redondeo. No lo es: son dos definiciones distintas de "la tasa", y un mismo crédito puede documentarse a una y amortizarse a la otra.

**Síntoma.** Un crédito de Credifamilia mostraba en el documento **TEA 28,79 %** (→ 2,13 % M.V.) mientras el motor de amortización usaba **1,82 %** mensual (→ 24,2 % E.A.). Cuatro puntos y medio de diferencia anual entre el papel y la cuota. El síntoma engaña: parece un dato mal sembrado, y en realidad son dos convenciones legítimas chocando.

**Causa raíz verificada.** No hay una sola fuente de la tasa.

- El **canon de la plataforma es NOMINAL**: `credit_line_by_lenders.rate_suffix` = **"N.M."** en las **157/157** filas de la BD local. `Modules/Loans` la usa dividiendo — `rate/100` mensual, `rate/200` quincenal, `rate/30` diaria — que para una tasa **nominal es lo correcto**, no un bug.
- **Credifamilia es la excepción**: guarda **TEA** y **capitaliza**. `app/Services/PaymentPlan/Credifamilia/Math/FinancialMath.php:29` lo dice explícito: *"Intentionally uses the compound effective formula. `annualEffectiveRate/360` (nominal simple) is NOT used — this matches the Calculadora PV V20251009.xlsm convention."*
- Y **Credifamilia (lender 24) también tiene su fila con `1.82 N.M.`** en `credit_line_by_lenders`. Ahí está el choque: `user_requests.rate` se sembraba desde esa fila y el motor usaba la TEA de la pre-aprobación.

**Evidencia.**
- BD local: `SELECT rate_suffix, COUNT(*) FROM credit_line_by_lenders GROUP BY rate_suffix` → **N.M. · 157**. Y `lender_id=24 → rate 1.82, suffix N.M.`
- `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php:90` → `$formatRate = $isBiweekly ? $rate/200 : $rate/100;`
- `Modules/Loans/App/Services/CreditopXRequestHistoryService.php:1165` → `$dailyRate = $rate / 30;`
- `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php:224-227` — el comentario de **CORE-127** documenta la divergencia con el ejemplo exacto: *"user_request.rate se sembraba en la selección desde otra fuente y podía divergir (p.ej. **1.82 vs TEA 28.79 → 2.13**)"*.
- Sólo **4 lenders** son de corte quincenal (`cutoff_type_id=2`), o sea que `rate/200` toca poco; los otros **129** son mensuales.

**Arreglo.** CORE-127 ya tapó el **síntoma en el documento**: `nominal_monthly_rate` y `interest_rate` ahora salen los dos del motor de Credifamilia, así que en el papel siempre cuadran (`(1+TEA)^(1/12)−1`). **La convención doble sigue viva** — no se unificó, se hizo consistente en un consumidor.

Lo que falta es **declarar la convención en vez de deducirla**. Las dos son la misma expresión con los mismos dos parámetros, y sólo cambia `×` por `^`:

```
nominal    periodRate = statedRate  *  statedPerYear / periodsPerYear
efectiva   periodRate = (1 + statedRate) ^ (statedPerYear / periodsPerYear) - 1
```

Verificado que reproduce el código real exacto: `rate/100` = `r×12/12` · `rate/200` = `r×12/24` · `rate/30` = `r×12/360` · Credifamilia `^(1/12)` y `^(1/360)`. De paso deja ver que la rama `$isBiweekly ? $formatRate/15 : $formatRate/30` de `PaymentCalculationService:291` es un **no-op**: los dos caminos dan `rate/30`; con un solo `periodsPerYear=360` desaparece.

Implementado en `playground/engine`: cada hoja declara `rateConvention` y la franja avisa cuando una hoja `effective` contradice el N.M. de la plataforma.

**Estado: causa raíz VERIFICADA contra BD local + código de los dos repos. El síntoma del documento está arreglado en producción (CORE-127); la convención doble NO está unificada. El modelo paramétrico está implementado y verificado sólo en `playground/engine`, no en los repos reales.**

**El pecado de fondo: el porcentaje sin período.** Un "2%" no es un dato, es medio dato — el
número sin su unidad. Y la BD lo muestra literal: de las **cuatro** columnas de tasa del schema,
**solo una declara el período**.

| columna | ¿declara el período? |
|---|---|
| `credit_line_by_lenders.rate` | **SÍ** → `rate_suffix = "N.M."` |
| `user_requests.rate` | **NO** |
| `lender_users_categories.rate` | **NO** |
| `creditop_x_lender_configuration.late_payment_interest_rate` | **NO** |

Y la que se desincronizó en CORE-127 —el `1.82` contra la TEA `28.79`— fue **`user_requests.rate`**,
justamente la que perdió la unidad al copiarse. La columna con `rate_suffix` nunca fue ambigua;
las otras tres son números pelados y cualquiera puede leerlos como quiera.

Regla que sale de acá: **nunca mostrar ni guardar un porcentaje sin su período al lado.** En
`playground/engine` está aplicado — cada tasa lleva su etiqueta (`statedRate` MENSUAL ·
`periodRate` SEMANAL · `annualEffectiveRate` ANUAL) y las tres se reetiquetan solas al cambiar
la periodicidad, así que ninguna puede mentir.

**Ojo al mapear un .xlsm.** Los tres archivos de negocio (`Calculadora Renting VF.xlsx`, los dos `Calculadora PV V20251009.xlsm`) **capitalizan**. Si transcribís una calculadora a código y el lender guarda N.M., estás importando la excepción y no el canon. Es exactamente cómo nació esta divergencia.

**Lo que NO diverge — y por eso el arreglo es chico.** La anualidad es **transversal**: `pv * r / (1 - (1+r)^-n)` con fallback `pv/n`, idéntica en **12 sitios** de `legacy-backend` + `legacy-application`, más `FinancialMath::payment` de Credifamilia. La composición también (`cuota = anualidad + seguro de vida + fondo de garantía`, `PaymentCalculationService:71-132`) y el mecanismo de amortización también. Lo único que cambia es **con qué tasa** se alimenta, y eso es una línea.

## N · La fianza (el `.xlsm` y producción calculan distinto sobre el MISMO costo)

### F-72 · Tres divergencias entre la calculadora de negocio y el código: el IVA cableado, el 4×1000 que no existe, y una fianza "mensual" que no es un total repartido

Hermana de [F-71](#f-71): ahí eran dos convenciones de **tasa**; acá son dos definiciones del mismo **costo**. Y la trampa es peor, porque las tres divergencias van en la misma dirección — transcribir el `.xlsm` a código **cobra de más**.

**Síntoma.** Al reproducir la fianza de un crédito de salud desde la `Calculadora PV V20251009.xlsm` el valor a financiar sale distinto al que arma el backend, con la misma tarifa y el mismo monto. La diferencia es chica (miles de pesos sobre millones), así que se lee como redondeo y no como tres reglas distintas.

**Causa raíz verificada.** El `.xlsm` y `PaymentCalculationService` modelan la fianza de forma distinta en tres puntos. En lo único que **coinciden** es en la base, y eso importa decirlo para que nadie lo "arregle".

| | `.xlsm` (negocio) | `PaymentCalculationService` (producción) |
|---|---|---|
| **base** | `guaranteeBase = principal + deviceCost`, y `principal` viene de `marginBase = assetCost − downPayment + setupFee` | `($amount + $administrativeCosts)` con `$amount = original_amount − initial_fee` |
| **IVA** | campo aparte (`guaranteeVatRate`); en Alta va en **0** porque el 9,64 % de Novafianza ya lo trae adentro | **cableado al 19 % y multiplicado adentro**: `* (1 + (19 / 100))` |
| **4×1000 (GMF)** | lo **cobra**: `guaranteeTax = (guaranteeCost + guaranteeVat) * 0.004` | **no existe** — ninguna mención en todo `Modules/Loans/App/Services/PaymentSchedule/` |
| **mensualizada** | reparte un **total**: `totalGuarantee * (1 − guaranteeUpfront) / installments` | **% mensual del total financiado**: `guarantee_fixed_monthly_percentage% × totalAmountNoFee`, cobrado en **cada** cuota |

La base **sí coincide**: los dos descuentan la cuota inicial **antes** de calcular la fianza. Es un % de lo que se va a financiar *antes de sumarse ella misma* — ni del monto pedido, ni del valor final (eso sería circular).

La cuarta divergencia es la más peligrosa porque no es un redondeo: **la "fianza mensual" del `.xlsm` y la de producción son mecanismos diferentes.** Un `0,50 %` en `guarantee_fixed_monthly_percentage` a 36 cuotas suma **18 %** del financiado, no 0,5 %.

**Evidencia.**
- `Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php:82-85` → `// IVA hardcoded at 19% — matches monolito business rule.` seguido de `$guarantee = ($amount + $administrativeCosts) * ($inputs['guarantee_fund_percentage'] / 100) * (1 + (19 / 100));`
- `PaymentCalculationService.php:188-197` (`calculateInitialAmount`) → `$amount = $userRequest->original_amount; if ($userRequest->initial_fee > 0) { $amount -= $userRequest->initial_fee; }`
- `PaymentCalculationService.php:100` → `$guaranteePerMillionFixedMonthly = ($inputs['guarantee_fixed_monthly_percentage'] / 100) * $totalAmountNoFee;`
- `grep -rn "gmf\|GMF\|0.004" Modules/Loans/App/Services/PaymentSchedule/` → **sin resultados**.
- `playground/engine/reference/full-sheet.js` (la hoja verificada 30/30 contra los `.xlsm`) → `guaranteeBase` · `guaranteeCost` · `guaranteeVat` · `guaranteeTax` · `monthlyGuarantee`.

**Y el dato que ordena cuál importa.** En la copia local, `lenders_by_allieds` (994 filas):

| columna | comercios | valores |
|---|---|---|
| `guarantee_fund_percentage` (anticipada) | **338** | 5 % a 36,5 % · moda 13 · 15 · 10 · 12 · 14 |
| `guarantee_fixed_monthly_percentage` | **2** (lender 139) | 0,50 % |
| `administrative_costs_percentage` | **225** | — |
| `life_insurance_percentage` | 48 | — |
| `guarantee_insurance_per_million` | 0 | sin uso |

O sea: **la fianza anticipada es el caso real** (338 comercios) y la mensualizada es una excepción de dos filas. Y `administrative_costs_percentage`, que usan **225 comercios**, **entra a la base de la fianza** — cualquier normalización que lo omita calcula la fianza de menos.

**Qué hacer.**
- **Al transcribir un `.xlsm`**, mirar las tres: si el IVA ya viene en la tarifa, el campo va en 0; el GMF probablemente no se cobra; y si la fianza es mensual, confirmar si es un total repartido o un % por cuota — no son lo mismo.
- **Al normalizar**, el `administrative_costs_percentage` no es opcional: es parte de la base.
- **El IVA al 19 % cableado debería ser un dato con fecha**, no una constante en el código: fue 16 % hasta 2017. Misma deuda que el techo de usura.
- Prototipo con las dos bases (neto y bruto) como opción explícita: `playground/engine` — ver su README.

## O · El código de compra en caja (Corbeta → Bancolombia)

### F-79 · El canal del código de compra está APAGADO desde enero de 2026 — si no ves códigos, no es tu bug

**Síntoma:** vas a ejercitar el código de compra en punto de venta (el PIN que el cliente presenta en caja de Alkosto/K-TRONIX/Alkomprar) y no encontrás casos vivos: ninguna solicitud reciente en el estado que habilita el endpoint, ningún código emitido. Se lee como "el ambiente está mal sembrado" o "rompí algo".

**Causa raíz verificada — el canal dejó de emitir, aunque el tráfico sigue entrando.** Medido sobre la copia local de la BD (dump fresco al **2026-07-30**, o sea NO es falta de datos recientes):

| | |
|---|---|
| `purchase_codes` emitidos por mes | oct-25 **6.605** · nov-25 **9.682** · dic-25 1.905 · ene-26 **18** · feb-26 **3** · mar-26 **5** · abr–jul **0** |
| Solicitudes en estado **25** (`Pendiente de facturación`) con lender 68 | 119 en total, la última de **2026-03**; **cero** desde abril |
| Solicitudes de los retail Corbeta (209/210/211) | **siguen entrando**: mar-26 111 · abr 112 · may 56 · jun 68 |
| Estado **26** (`Facturado`) en toda la historia del dump | **10**, todas entre sep y dic de 2025 |
| Dónde terminan las de 2026 | 99 en estado 9 · **85 Canceladas** · 22 Autorizadas (11) · **0 en estado 25** |

Es decir: los comercios siguen originando, pero el camino ya **no pasa por el estado 25**, que es requisito duro del guard del código (ver F-82). Y el ciclo completo (facturar en caja → estado 26) se cerró 10 veces en total.

**Evidencia adicional:** en el mismo período `ecommerce_requests` sólo tiene filas de **jun-26 (22)** y **jul-26 (4)** → el canal ecommerce unificado es reciente y chico. De las 119 solicitudes en estado 25, **118 no tienen `ecommerce_request`**: son del camino clásico de `application`.

**Qué hacer.** Antes de depurar el código de compra o de sembrar un caso, asumí que **no hay tráfico vivo** y construí el caso a mano por el flujo del QR. Y antes de estimar un reemplazo de proveedor, preguntá **por qué se apagó**: cambiar quién emite el código no arregla un embudo que se corta antes.

**Dónde se corta, afinado (2026-07-31).** No es que las solicitudes no lleguen al estado 25: **llegan con todo listo y no reciben código.** De las 4 solicitudes de mar-26 en estado 25 (todas **Alkosto, allied 209, sucursal 946**), las 4 tienen la secuencia BNPL completa en el flow (`user_request_id`, `bnpl_transaction_id`, `retrieve_quota`, `retrieve_terms`, `acceptance_terms`) pero **sólo 2 tienen fila en `purchase_codes`**. El último código emitido para Alkosto es del **2026-03-02** (279 en total para ese comercio) y la solicitud del **2026-03-13** —la más reciente que alcanzó el estado 25, con `transactionId` presente— **no tiene código ni PIN**. O sea el embudo funciona hasta la puerta del código y ahí muere.

**Por qué la copia local no puede decir POR QUÉ.** Dos límites, los dos verificados:
- La tabla `logs` (donde el cliente de Corbeta escribe `CORBETA - register` / `Corbeta - query`) sólo retiene **2026-06-03 .. 2026-07-19** (1.017 filas) — los casos de marzo quedaron fuera de la ventana. Dato lateral: en esa ventana hay **cero** llamadas a Corbeta logueadas.
- El camino del código **puede fallar sin dejar rastro**: con un HTTP 400 y sin seed de `LenderErrorCode` para `App\Actions\Allieds\Corbeta`, `handleException` retorna `void` y `register()` hace `return $apiResponse` **nunca asignada** → `Error` de PHP 8, que **no es `Exception`** y ningún `catch` de la cadena lo captura (ver el riesgo P1 del handoff). Así que la ausencia de filas en `allied_errors_captures` **no prueba** que no se intentó.

**Lo que sí muestra `allied_errors_captures`** (retiene desde 2026-01-30): **todas** las capturas relacionadas con Corbeta vienen de `CorbetaCheckoutController::show` — la entrada **ecommerce**, no la del código — y con los códigos de los **casos de prueba cableados** (`CORB006`, `BP20755`, `BP20790`, `BP409XXX3`, `BP50020550`, `SP20754`). Concentradas en los primeros días de **junio de 2026**, que es cuando aparecen las únicas 22 filas de `ecommerce_requests`. Lectura: lo que se ejercitó últimamente es el **checkout ecommerce** (probablemente un barrido de QA), no el camino de caja.

**Estado:** el apagado está medido y es reproducible. La CAUSA (comercial, técnica o de flujo) **sigue sin determinar** y no se puede cerrar desde la copia local: hace falta el log de producción de marzo de 2026, o preguntarle a negocio. Quien lo investigue: mirá primero si la llamada a Corbeta explotaba por P1 (fallo silencioso, sin captura).

---

### F-80 · `bnpl_transaction_id` "ausente en el 100 %" es un artefacto de medir sobre el histórico — hoy SÍ se escribe

**Síntoma:** un diagnóstico read-only reportó que el identificador que Bancolombia exige para emitir el código (`data.security.transactionId`) no estaba en `lender_integration_flows` para **ninguna** de las 120 solicitudes elegibles, y lo levantó como bloqueante duro. La hipótesis fue "el front usa `ListAccountsAndQuota`, que no escribe la clave".

**La hipótesis del front es incorrecta — verificado en `origin/main`.** El wizard llama a **los dos** endpoints, en orden: el **loader** de `apps/loan-request-wizard/app/routes/bancolombia/bnpl/loan-info-view.tsx:96` usa `RetrieveBnplQuotaUc` → `bancolombia-bnpl/retrieve-quota` → **ese sí escribe** la clave (`BancolombiaBnplController.php:238`); el **action** (`:189`) usa `ListBnplAccountsQuotaUc` → `list-accounts-and-quota` → ese no escribe nada y la lee con `?? null` (`:477`). Lo mismo en `bancolombia/ecommerce/ecommerce-loan-processing.tsx` (`:254` retrieve / `:339` list).

**Causa raíz verificada — CORTE TEMPORAL: el escritor no existía antes de diciembre de 2025.** Ninguna fila de `lender_integration_flows` del lender 68 tiene la clave antes de **2025-12**; desde ahí se escribe con regularidad: **dic-25 = 20 · mar-26 = 51 · abr-26 = 35 · may-26 = 41**. Cruzado contra las 119 solicitudes en estado 25 (que van de abr-25 a mar-26):

```
2025-04..11 : 94 solicitudes → 0 con transactionId   (el escritor no existía)
2025-12     : 15            → 1
2026-01     :  6            → 0
2026-03     :  4            → 4   ← 100 %
```

O sea: el "0 de 120" midió un período que **precede al código que escribe la clave**. En la ventana reciente la cobertura es total (4 de 4). Y las filas de flow con la clave siguen creándose hasta **may-26**, en meses donde **ninguna** solicitud llegó al estado 25 (ver F-79): el flujo BNPL del wizard corre y escribe; lo que se detuvo es la emisión del código.

**Corrige una explicación previa mía.** Antes atribuí la ausencia a que "118 de 119 venían del camino clásico de `application`, que nunca toca el wizard". **Eso no se sostiene:** el join contra `user_requests_by_ecommerce_request` sólo distingue el **checkout ecommerce base64**, no separa el camino clásico del **QR/self-service**, que también es wizard y tampoco tiene `ecommerce_request`. De hecho las 5 que **sí** tienen la clave son todas "sin ecommerce_request", lo contrario de lo que esa hipótesis predecía.

**Riesgo que SÍ queda — el canal ecommerce no lo garantiza.** La única solicitud de la población con `ecommerce_request` (ene-26) **no** tiene la clave, y es coherente con el código: `bancolombia/ecommerce/resolve-ecommerce-flow.tsx` resuelve la pre-aprobación con `ValidatePreapprovedUc` (→ `validate-preapproved`), **no** con `retrieve-quota`. Si un reemplazo del emisor del código tiene que servir también al canal ecommerce, ahí el `transactionId` **no está garantizado** y hay que resolverlo aparte.

**Qué hacer.** No busques el bug en el front ni trates B1 como bloqueante sin fechar la muestra. Antes de implementar, verificá **el caso concreto**: entrá por el QR en dev, llegá al paso del código y confirmá que la fila de flow ya trae `bnpl_transaction_id`.

```bash
cd ~/Desktop/CREDITOP/github/legacy-backend && docker exec -e MYSQL_PWD="$(grep -m1 '^DB_PASSWORD=' .env | cut -d= -f2-)" legacy-backend-mysql-1 mysql -u"$(grep -m1 '^DB_USERNAME=' .env | cut -d= -f2-)" creditop -e "SELECT ur.id, DATE(ur.created_at) AS creada, IF(JSON_EXTRACT(f.data,'\$.bnpl_transaction_id') IS NULL,'FALTA','tiene') AS transaction_id FROM user_requests ur LEFT JOIN lender_integration_flows f ON f.user_request_id=ur.id AND f.lender_id=68 WHERE ur.user_request_status_id=25 AND ur.lender_id=68 ORDER BY ur.id DESC LIMIT 10;"
```

> ⚠ **La credencial va con `$(…)` DENTRO del `-e`.** La forma `DBP=$(…) docker exec -e MYSQL_PWD="$DBP" …` **no funciona**: en una asignación-prefijo el shell expande `$DBP` contra el entorno *anterior* a la asignación, así que `MYSQL_PWD` viaja vacío y mysql responde `ERROR 1045 … (using password: NO)`. Vale para cualquier consulta contra la copia local (contenedor `legacy-backend-mysql-1`, schema `creditop`, credenciales en `legacy-backend/.env`).

**Ojo con las cifras entre ambientes:** el diagnóstico previo vio 0/120 y **29** flows del 68; la copia local da 5/119 y **223**. Son entornos distintos — no discutas conclusiones sin fijar de dónde salió el número.

**Estado:** causa raíz verificada contra código + BD (2026-07-31). El equivalente para Consumo (`loan_validate_key`) no se pudo medir: **cero** solicitudes de lender 100 han estado en estado 25.

---

### F-81 · El sandbox del *In Store Billing Code* responde 409 a cualquier dato real, y no ejercita la seguridad

**Síntoma:** probás `POST /generateBillingCode` contra el sandbox de Bancolombia con datos de un `user_request` real y siempre vuelve **409 `BP12700001`** ("conflicto debido a la data de petición"). Se lee como un conflicto de negocio o como credenciales mal armadas.

**Causa raíz verificada — el mock despacha por igualdad estricta del JSON completo.** El dispatcher vive **dentro del propio OpenAPI** (`x-microcks-operation`, `dispatcher: SCRIPT`, Groovy): parsea el body y lo compara con `requestJSON == <ejemplo>` contra **cuatro juegos literales** de valores (transactionId + address + cityCode + departmentCode). Cualquier otra combinación cae en `DefaultResponse`, que para **ambas** operaciones es `409 BP12700001`. Para `retrieve-order-details` el dispatch es más simple: mapea por `billingCode` (`1770694a38b230dbf0f0` facturada · `6f1e621130c0ea7b4161` pendiente · `48799a34f861da1d561b` cancelada · `5aa5078c6d9087cdf158` sin-información), default igual 409.

~~**Y el sandbox tampoco valida la seguridad:** en el catálogo `Sandbox` el `tlsProfileJWT` está **vacío** y no hay `endpointRetrieve` (todo va a Microcks). Pasar en sandbox **no** prueba el JWT ni el mTLS.~~

⚠ **ESO ES FALSO — medido contra el sandbox real el 2026-08-04** (`https://gw-sandbox-qa.apps.ambientesbc.com`, credencial #1124 de Alkosto). El gateway (APIC) **está delante** del mock y **sí** ejercita la seguridad: verifica la **firma RS256 del JWT contra el módulo del certificado que uno manda** en `x-client-certificate`, y rechaza todo lo demás. La lectura de la config del catálogo describía Microcks, no el gateway que lo protege.

| se rompió a propósito | respuesta real |
|---|---|
| sin `json-web-token` / basura | 403 `SA403` *The input data is not a valid JWT* |
| JWT firmado con otra llave privada | 403 `SA403` ***RSA signature did not verify*** |
| JWT con `exp` vencido | 403 `SA403` *JWT has expired at…* |
| sin `x-client-certificate` / basura | 400 `SA500` *Error con la lectura del modulus* |
| `Client-Id` o `Client-Secret` malo | **401** con cuerpo `{"httpCode","httpMessage","moreInformation"}` — **sin `errors`** |
| `message-id` no-UUIDv4 | 400 `SA400` *no cumple con la expresión regular* |

**Lo que el certificado sí y no prueba:** el certificado de la credencial #1124 está **vencido hace 400 días y es autofirmado**, y aun así el camino feliz devuelve 200. El gateway lo usa para leer el módulo y verificar la firma, pero **no valida vigencia ni cadena**. Renovarlo sigue haciendo falta para `Development`/`Testing`/producción — pero **no bloquea probar**.

**Qué hacer.**
- Un 409 en sandbox = "no coincidiste con un escenario", no un error de negocio. Para ejercitar el camino feliz hay que mandar **exactamente** los valores del escenario, dirección incluida.
- ~~Primer smoke test: **`HEAD /health`**, que no exige ninguna cabecera~~ → **también falso: `HEAD /health` pelado da 401.** Exige `Client-Id` **y** `Client-Secret` (con los dos → 200; sólo con `Client-Id` → 401). El contrato dice que no lleva cabeceras y **el contrato miente**: quien implemente la sonda leyendo el spec se queda con un `health()` que devuelve `false` con el servicio sano.
- Para el mapeo de datos reales, el sandbox es inútil: hay que hacerlo con `Http::fake()` en tests propios.
- **`GET /retrieve-order-details` no se puede ejercitar en Sandbox, y la causa está en el spec**: responde **400 `SA409` «Identificación de aplicación inválida»** para los 4 `billingCode` del dispatcher y para el que el propio sandbox acaba de emitir. **No es la credencial**: en `x-ibm-configuration.catalogs`, el catálogo `Sandbox` define `endpoint` (→ Microcks) pero **no `endpointRetrieve`**; `Development` y `Testing` definen los dos (`…/faas/order/api/v1/createOrder` y `/consultOrder`). El GET no tiene backend a dónde ir. `SA409`, `SA403` y `SA500` **no existen en el OpenAPI**.
- **Hay dos 409 y no son lo mismo:** `BP21000` (conflicto real de `transactionId`, sólo con el payload `identificadorIncorrecto` exacto) vs `BP12700001` (`DefaultResponse` del mock, cualquier dato real). Tratar "409 ⇒ ya se generó" confunde los dos.

**Bonus verificado del contrato:** `message-id` está **validado como UUID v4 por regex** (no es una recomendación: otro formato = `SA400` — **confirmado contra el banco**), y `billingStatus` **no es un enum** (`string maxLength 35`; los tres valores viven sólo en la descripción) → cualquier `switch` sobre el estado necesita un `default` fail-closed.

**Estado:** leído del OpenAPI (2.661 líneas) el 2026-07-31; **corregido con llamadas reales al sandbox el 2026-08-04** (27 casos). Detalle completo del contrato en el nodo `bancolombia` §6; la corrida, en la tarea `bancolombia-billing-code`.

---

### F-82 · El guard del código de compra está escrito en NEGATIVO y se lee al revés

**Síntoma:** dos diagnósticos read-only del mismo archivo se contradijeron sobre si el estado 25 **habilita** o **excluye** la generación del código. La diferencia era material: todas las cifras de elegibilidad se habían calculado asumiendo que habilita.

**Causa raíz verificada.** `Modules/Onboarding/App/Services/merchants/PurchaseCodeService.php:106` es una **guarda de salida temprana**:

```php
if (!$allied || !$this->isCorbetaAllied((int) $allied->id) || $userRequest->user_request_status_id != 25 || !in_array($userRequest->lender_id, [68, 100])) {
    …  return $this->buildResponse('PCS000');   // no genera
}
```

El `!= 25` está **dentro** del `if` que aborta → para pasar hay que cumplir `== 25`. **El estado 25 habilita.** Y su nombre en `user_request_statuses` lo confirma: **"Pendiente de facturación"**.

**Qué hacer.** Al citar una condición de este tipo, transcribir el `if` completo o decir explícitamente "para pasar hace falta X". Media línea copiada de una guarda negativa invierte el sentido y arrastra todas las cifras que dependan de ella.

**Estado:** resuelto. Las cifras calculadas asumiendo que 25 habilita son las correctas.

---

### F-83 · El límite de 20 caracteres del `address` de Bancolombia no lo cumple ninguna de las dos fuentes

**Síntoma:** el contrato del *In Store Billing Code* declara `address` con **`maxLength 20`** y lo describe
como "dirección de residencia del cliente". Suena a un detalle de validación; es un bloqueante.

**Medido en la copia local (2026-07-31), las tres fuentes candidatas:**

| Fuente | Filas | Exceden 20 | % | Máximo |
|---|---|---|---|---|
| `allied_branches.address` — **todas** | 1.692 | **1.134** | **67 %** | 134 |
| `allied_branches.address` — sólo Corbeta (24/209/210/211) | 133 | **82** | **62 %** | 86 |
| **Dirección de residencia del CLIENTE** (`fields.id = 44`, «Dirección de Residencia», vía `user_field_values`) | 2.267 | **630** | **28 %** | 90 |

Hoy se manda la de la **sucursal** (`CodeGenerationService` la toma de `alliedBranch->address`), que es
justo la peor de las tres. Y truncar no es una salida: un ejemplo real de Corbeta,
`«Centro comercial mall plaza, Local A1033, Avenida Kevin Angel entre calles 56 y 57G»` (86 chars), queda
en **`«Centro comercial mal»`** — cortado a mitad de palabra e inservible como dirección. Si Bancolombia
usa ese dato para la factura, además hay consecuencia fiscal.

**Lo que esto cierra y lo que abre.** Cierra la duda de magnitud: **no es un caso borde, es la mayoría**.
Abre la pregunta operativa, que es para el banco y no para nosotros: **¿qué hace Bancolombia con una
dirección de más de 20?** ¿Trunca, rechaza con `SA400`, o el campo es informativo? Sin esa respuesta, las
tres opciones (truncar, mandar la del cliente, mandar la de la sucursal) son igual de arbitrarias.

**Dato lateral útil:** existir un campo propio para la dirección del cliente **con el flujo Bancolombia
como razón de ser** (el field 44 se usa en su aceptación de términos, y el diccionario lo describe "sin
acentos, sin símbolos") es indicio de que el banco espera la del cliente, no la del punto de venta.
Indicio, no confirmación.

**Estado:** medido y reproducible. La decisión depende del banco.

---

### F-84 · El `Message-Id` fijo de no-producción SÍ es un UUID v4 válido (y el que no lo es está comentado)

**Síntoma / sospecha razonable:** el contrato valida `message-id` con un **regex de UUID v4**
(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, no es "se recomienda"), y las
Actions de Bancolombia fijan un `Message-Id` **constante fuera de producción**
(`BancolombiaBnpl.php:413`: `app()->environment() === 'production' ? Str::uuid() : '<constante>'`). Si esa
constante no fuera un v4, dev y sandbox darían `SA400` en todas las llamadas.

**Verificado — no hay riesgo hoy.** Las dos constantes que existen en el código, contra el regex del contrato:

```
cf5e04d7-519b-4834-ab75-3b02f7389f84   ✓ v4 válido   (VIVA, BancolombiaBnpl.php:413)
c4e6bd04-5149-11e7-b114-b2f933d5fe66   ✗ es v1, no v4 (COMENTADA, BancolombiaConsumerLoan.php:409)
```

La viva pasa (`4834` → versión 4, `ab75` → variante `[89ab]`). La que fallaría es un UUID **v1** —
el tercer grupo empieza en `1`— y está detrás de un `//`.

**Qué hacer.** Nada ahora; pero si alguien descomenta esa línea de `BancolombiaConsumerLoan.php:409`, todas
las llamadas de Consumo en dev/sandbox van a dar `SA400` por una razón que no aparece en ningún log de
negocio. Vale un comentario en el código o borrarla.

**Estado:** verificado contra el regex del OpenAPI. Riesgo latente, no activo.

---

### F-85 · Por el canal ASESOR un comercio Corbeta no cierra ahí: entrega el crédito al celular del cliente

**Síntoma / pregunta:** si el canal QR es "autogestión pura", ¿qué pasa si un asesor entra a una sucursal
Corbeta por el flujo normal? ¿Se rompe, o hay dos caminos válidos?

**Verificado (BD local, sucursal 946 / allied 209):** no se rompe — **converge**. Al seleccionar
Bancolombia BNPL como lo hace la acción de `/lenders`
(`POST update-user-request/{ur}` con `lender_id=68`) la respuesta es un **handoff al cliente**:

```
url            /bancolombia/bnpl/explicacion-de-flujo/{encryptCode}
showModal      true      · openProcessModal  true      · openNewTab false
modalMessage   «Se ha enviado un mensaje de WhatsApp con un link para continuar el proceso.»
estado en BD   1 → 3 (Seleccionó entidad)
```

O sea el asesor no completa nada: el flujo sigue en el celular del cliente, en **las mismas pantallas
`bancolombia/*`** del self-service. El canal asesor no es un recorrido alternativo, es un paso previo que
termina en el mismo lugar.

**⚠ Lo que NO se pudo probar, y por qué importa:** se intentó demostrar que el marketplace **no lista**
para un comercio Corbeta (lo que haría del canal asesor un camino imposible), y `lenders-v2` devolvió
**404** — pero **el control con un comercio NO-Corbeta devolvió el mismo 404**, así que ese 404 es del
endpoint o de sus precondiciones, no del comercio. La hipótesis "el asesor no puede llegar a elegir en
Corbeta" **queda sin sostén**: no la uses para justificar decisiones.

**Consecuencia práctica** (para el panel del harness): **el QR no tiene sentido en un comercio NO-Corbeta**,
porque `RegisterCellPhoneController@oldIndex` sólo redirige al self-service a los allieds del
`Setting('corbeta_allieds')`; para el resto el QR cae en `registrar-celular/{hash}`, que es el mismo tronco
del asesor.

Al revés —esconder el asesor en Corbeta— **no se justifica con "está roto"**: hace algo y ese algo es
correcto. El panel igual ofrece **sólo QR** en comercios Corbeta (decisión de Miguel, 2026-07-31), pero por
otra razón: **no es el camino de producción** — en la caja de Alkosto el cliente entra escaneando, no hay
asesor ni carrito. Es una baranda de la UI, no una prohibición: por CLI (`bin/asesor <comercio>`) el canal
sigue disponible y sirve para ejercitar justo el handoff de arriba. La distinción importa porque el motivo
queda escrito en el tooltip del panel, y "está roto" habría sido mentira.

**Estado:** el handoff está verificado; la inferencia sobre el marketplace, retirada.

---

### F-86 · El regreso de una pantalla externa no se puede deducir del `document.referrer`: cross-origin el browser manda sólo el origen

**Síntoma:** en el canal QR, después de la pantalla de autenticación simulada de Bancolombia (mock :8104),
el cliente aterrizaba en **`/login`** — el login de **asesor** (Cognito) — dentro de un canal que es
autogestión pura. La traza del run:

```
05 A /bancolombia/bnpl/start/JNDDQZFECD
06 A /_login-simulado
07 A /login        ← acá no debería estar nunca
```

**Hipótesis descartadas (verificadas contra `origin/main`):**

| se sospechó | se comprobó |
|---|---|
| `loan-info` exige sesión | `layouts/bancolombia/origination-layout.tsx` no tiene loader ni sesión ni redirect |
| el loader manda a login | `GET /bancolombia/bnpl/loan-info/{code}?code=…` responde **200 sin sesión** |
| algún redirect a `/login` en la ruta | en TODO el monorepo sólo hay 3 (`backoffice/logout`, `auth/callback`, y el action de `personal-info`), ninguno alcanzable desde ahí |

**Causa raíz:** el harness deducía el destino de regreso transformando `document.referrer`
(`/start/` → `/loan-info/`). Pero el wizard vive en `:5174` y el mock en `:8104`: **son orígenes
distintos**, y la política default del browser (`strict-origin-when-cross-origin`) recorta el referrer a
**`http://localhost:5174/`, sin path**. El `replace('/start/', …)` no encontraba nada, el destino quedaba
en `/` — y **`/` → 302 `/merchant` → `/login`** (verificado con `curl -D -`). El `/login` no era una falla
del flujo de Bancolombia: era el wizard haciendo lo correcto con una URL raíz.

Ojo con el diagnóstico: el referrer **no llegaba vacío**, llegaba *truncado*. Por eso el guard
`if (!ref)` no saltaba y no había ningún error — sólo un destino silenciosamente equivocado.

**Arreglo:** el retorno se **registra**, no se adivina. El mock expone `POST /_control/retorno {url}` y el
harness se lo dice en cuanto la URL del wizard muestra `/bancolombia/{tipo}/start/{encryptCode}` — ahí
están el código y el producto, exactos. El referrer queda sólo como respaldo y **únicamente si trae
`/start/`**; sin destino conocido la página ya no navega a ninguna parte, avisa.

**Regla general:** cualquier mock que sirva una pantalla en su propio puerto y tenga que devolver el
control al front está en esta situación. El referrer sirve para *loguear*, no para *navegar*.

---

### F-87 · `bin/mock-* start` reusaba el proceso viejo: editabas el mock y seguía sirviendo la versión anterior

**Síntoma:** se corrige un mock, se vuelve a correr el panel, y el comportamiento es idéntico al de antes
del arreglo. Sin error, sin aviso: `✓ mock-bancolombia ya arriba (:8104)`.

**Causa raíz:** el `start` de los launchers decidía reusar mirando **sólo el modo fallo**
(`fail: 0|1`). Si el puerto respondía y el modo coincidía, salía por `exit 0` — y el proceso vivo tenía el
`server.mjs` **anterior** cargado en memoria (Node no recarga el módulo).

**Arreglo:** cada mock publica en `GET /` una huella de su propio código
(`codigo` = mtime en segundos de su `server.mjs`, vía `statSync(fileURLToPath(import.meta.url))`) y el
launcher la compara con el archivo en disco: si difieren, reinicia y lo dice
(«el proceso tiene código viejo en memoria»). Aplicado a `mock-bancolombia` (:8104) y `mock-corbeta`
(:8103), verificado con el ciclo start → start → `touch` → start.

**Parentesco:** es el mismo error de método que el log del wizard sin truncar (un artefacto viejo leído
como si fuera actual). Cuando un arreglo "no hace nada", **la primera pregunta es si lo que está corriendo
es el código que editaste** — no si el arreglo está mal.

---

### F-88 · El front valida cada respuesta del banco con zod, y el runner por consola no lo veía: dos verdes que no se cruzaban

**Síntoma:** el runner por consola cerraba los DOS productos (estado 25 + código emitido, verde), y sin
embargo el recorrido visual moría en la primera pantalla después de autenticarse en el banco con
**«Error al cargar la información. No pudimos cargar la información.»** — sin nombrar ningún campo.

**Causa raíz (verificada):** los controllers de Bancolombia hacen **passthrough** del `data` del banco
(`'retrieve_quota' => $quotaResponse['data']`, `'purchase' => $purchaseResponse['data']`, …), así que las
claves que manda el proveedor las termina validando **el front** con zod
(`bancolombia-origination/src/domain/schemas/origination/{bnpl,loan}/*-api.schema.ts`). El mock cumplía lo
que el **backend** exige —que la clave exista— y no lo que el **front** exige. Tres incumplimientos en
`retrieve-quota` alcanzaban para tumbar la respuesta entera:

| el front exige | el mock mandaba |
|---|---|
| `signatureMethod: z.string()` | ausente |
| `commission: z.number()` | ausente |
| `account.accounts[].id: z.number()` | `'1'` (string) |

Y el UC, ante un `safeParse` fallido, devuelve `success:false` sin el detalle → la pantalla sólo puede
mostrar el banner genérico. **El error no dice qué campo falta: eso es lo que hace caro el diagnóstico.**

**Lo que esto enseña del método, más que del bug:** los dos caminos del harness (consola y visual) *no*
son el mismo camino con distinta piel. El de consola pega contra los endpoints del backend y **nunca
ejercita los esquemas del front**; el visual sí. Un verde por consola no autoriza a decir "el flujo anda",
sólo "el backend cierra". Al revés también: el visual no comprueba la BD.

**Arreglo:** el mock alineado con los esquemas del front en los 7 pasos de BNPL y los 7 de Consumo, y —lo
que evita la repetición— un chequeo que **importa los zod REALES del monorepo** y valida las respuestas del
mock armando el payload igual que el backend (`dev/contrato-bancolombia.ts`). Corre sin browser y sin BD, y
dice el campo exacto que falta. Los 14 contratos pasan.

**Detalles del contrato que no son intuitivos** (todos verificados, y todos capaces de costar una corrida):

- **Los dos extremos piden tipos distintos para el mismo dato**: `accounts[].id` es `z.number()` en el
  listado y `z.string()` en `select_account.account.id`. Gana el más estricto de cada lado.
- **Los `type` de Consumo son enums cerrados**: `TASA_FIJA` (no `FIJA`), `SEGURO_DE_VIDA` (no `VIDA`).
  Los valores cortos le servían al backend, que sólo los arrastra.
- **Un opcional presente y a medias rompe más que ausente**: `terms.security` es `.optional()`, pero si va
  tiene que traer `customerValidateKey`.
- **`user_id` en el payload de originación lo pone el BACKEND**, no el banco — un chequeo que lo omita
  acusa al mock de algo que no es suyo (me pasó, y estaba mal el chequeo).

**Estado:** arreglado y verificado contra los esquemas reales; el recorrido visual avanza de `loan-info` a
`loan-summary` y `signature`.

---

### F-89 · El regreso del banco tiene UNA sola URL y es un despachador: `/bancolombia/{tipo}/redirect`

**Síntoma:** con el retorno apuntado a `loan-info` el primer salto al banco volvía bien, pero el
**segundo** —la clave dinámica al firmar— dejaba al cliente parado en la página del banco.

**Causa raíz (verificada):** el recorrido sale al banco **dos veces** (autenticación al empezar, clave
dinámica al firmar) y el wizard tiene una ruta dedicada para el regreso:
`routes/bancolombia/bnpl/redirect.tsx` y su gemela `loan/redirect.tsx` (`routes.ts:190` y `:220`). Su
`clientLoader` lee la sesión del cliente y decide solo:

```
step === 'session'      → loan-info/{code}?code=…      (ecommerce → ecommerce-loan-processing)
step === 'dynamic_key'  → processing/{code}?code=…      (ecommerce → payment-success, y antes POSTea origination)
(fallback)              → loan-info/{code}?code=…
```

Que ese despachador exista **es la evidencia de que el banco vuelve siempre al mismo sitio**: si el
proveedor pudiera volver a una pantalla distinta por paso, no haría falta. Apuntar el retorno a una
pantalla concreta funciona por casualidad en el primer salto.

**Arreglo:** el harness registra `/bancolombia/{bnpl|consumo}/redirect?code=…` y deja que el wizard rutee.
Sirve para los dos saltos y para los dos productos sin conocer el paso.

**Estado:** verificado en BNPL (los dos saltos). Ver también F-86 (por qué el retorno se registra en vez de
deducirse del referrer).

---

### F-90 · Las perillas de falla del mock eran GLOBALES: cualquier error terminaba en `no-preapproved`, no en la pantalla de error

**Síntoma:** para ver las pantallas de error del canal QR se forzó primero `errorCode: 'BP20790'` y después
`MOCK_BC_FAIL=1`. **Las dos veces el recorrido murió en la pantalla 3** con
`self-service/{hash}/no-preapproved/` — nunca apareció `business-error` ni `bnplError`.

**Causa raíz (verificada):** las dos perillas se evalúan **antes de cualquier ruta** del mock, así que
aplican a TODAS. Y lo primero que hace este canal es la **compuerta de pre-aprobación**
(`PreApprovedLenderService::validateBancolombiaPreapprove`, que consulta las dos APIs del banco): si esa
falla, ninguna aprueba → `PLS005` → `no-preapproved`, y el flujo **nunca llega** a los pasos donde viven las
pantallas de error. Una falla global no simula "el banco se cayó a mitad del crédito", simula "el banco
estaba caído desde antes de empezar" — que es un escenario válido, pero **otro**.

Las dos hipótesis previas (`errorCode → business-error`, `MOCK_BC_FAIL → bnplError`) quedan **refutadas** y
no por el mapeo, sino por el alcance de la perilla. Anotarlas como refutadas importa: el mapeo perilla →
pantalla de error **sigue sin verificarse**.

**Arreglo:** perilla nueva `errorEn` en `/_control/escenario`: el `errorCode` se dispara sólo cuando el path
contiene ese texto (`'retrieve-quota'`, `'origination'`, `'purchase-intention'`…). `null` = todas, como
antes. `MOCK_BC_FAIL` se deja global **a propósito** — es el escenario "el banco no responde", y ahora se
sabe qué pantalla produce.

**Regla general para mocks de este tipo:** una perilla de falla sin ALCANCE sólo puede ejercitar el primer
paso que la toca. Si el flujo empieza con una llamada al mismo proveedor, ese primer paso se come todos los
escenarios.

**Estado:** el alcance está arreglado y verificado; el mapeo de cada pantalla de error a su perilla queda
pendiente de caminar.

---

### F-91 · Un error de NEGOCIO del banco cancela la solicitud y le dice al cliente «intenta de nuevo» — y `business-error` no existe para autogestión

**Síntoma:** forzando `BP20790` (compra reciente / saldo en actualización) sólo en `retrieve-quota`, el
cliente ve en `bnpl/loan-info` el banner **genérico**: «Error al cargar la información. No pudimos cargar la
información. **Por favor, intenta de nuevo.**» + botón *Volver a intentar*.

**Lo que pasa por detrás, verificado en BD:** la solicitud queda en **estado 8 «Cancelado»**
(`user_requests.user_request_status_id = 8`). El controller lo hace a propósito
(`BancolombiaBnplController`, rama `BP20790`: `ErrorCaptureService::capture` + `CancelRequestService::cancelRequest`).

O sea: **la pantalla invita a reintentar algo que el backend ya canceló.** El reintento no puede funcionar, y
el cliente no tiene forma de saber por qué — el mensaje del banco («compra reciente», «saldo en
actualización») es accionable y **no se le muestra**: se aplana al banner genérico.

**Y la pantalla dedicada no aplica a este canal:** `bnpl/business-error` existe, pero sólo se navega desde
`bancolombia/bnpl/redirect.tsx:91` **dentro de la rama `isEcommerceFlow`** y desde
`ecommerce-loan-processing.tsx`. En autogestión (el canal QR) **no hay ruta que lleve ahí**, así que todo
error de negocio del banco se ve igual que un fallo técnico.

**Cómo reproducirlo** (una línea, ahora que el error tiene alcance — F-90):

```
E2E_TARGET=local npx tsx dev/caminar-qr.ts --producto bnpl \
  --escenario '{"errorCode":"BP20790","errorEn":"retrieve-quota"}'
```

**Estado:** comportamiento verificado (pantalla + estado 8 en BD). **No es una regresión del harness: es
cómo se comporta el producto hoy.** Si se quiere mejorar, el arreglo natural es enrutar los códigos de
negocio a `business-error` también en autogestión, o al menos no ofrecer "reintentar" sobre una solicitud
cancelada. Queda como observación, no como tarea asumida.

---

### F-92 · Un 401 del gateway de Bancolombia no trae `errors` → revienta DENTRO del manejador de errores

**Síntoma:** una integración Bancolombia con credencial mal aprovisionada no falla con un error de negocio legible: tira un `Error` de PHP 8 (`Undefined array key "errors"`) **desde el propio `catch`**, así que el mensaje que llega arriba no habla de credenciales.

**Causa raíz verificada.** `Bancolombia::getRequestExceptionCode()` (`app/Actions/Lenders/Bancolombia.php:27`) accede por índice directo:

```php
return $exception->response->collect()['errors'][0]['code'];
```

Todos los errores **de negocio** del banco traen `errors[]` (`SA400`, `BP21000`, `BP12700001`, `SP500`…), así que el acceso parece seguro. Pero el **401 lo emite el gateway, no el servicio**, y su cuerpo tiene otra forma —comprobado contra `gw-sandbox-qa` el 2026-08-04:

```json
{"httpCode":"401","httpMessage":"Unauthorized","moreInformation":"Invalid client id or secret."}
```

Sin `errors`, `['errors'][0]['code']` lanza. Y como lo llama `Integration::handleException()` (`app/Actions/Lenders/Integration.php:82`), la excepción nace **dentro del manejador**: no la atrapa ningún `catch` de la cadena.

**No es teórico:** de las 4 credenciales Bancolombia distintas que hay en `lender_allied_credentials` (lenders 68/100), **sólo una** (#1124, `application_name = creditop`) está aprovisionada en el sandbox; las otras tres —incluida la de los 167 comercios `creditop-bnpl`— dan 401. Cualquiera de ellas contra ese host pega el camino roto.

**Qué hacer.** `?? null` en el acceso (`['errors'][0]['code'] ?? null`), y que el `null` se trate como "código desconocido". `BancolombiaBillingCode` **no** está afectado: atrapa `\Exception` directo y su `traceFailure()` ya contempla la respuesta sin forma esperada. Los afectados son `BancolombiaConsumerLoan` y `BancolombiaBnpl`, que sí pasan por `handleException`.

**Estado:** verificado el 2026-08-04 llamando al sandbox con `Client-Id` y `Client-Secret` inválidos. Relacionado: F-81.

---

### F-93 · `displayed_lenders` no es una tabla: es una columna JSON de `profiling_reviews`

**Síntoma.** Se busca la tabla `displayed_lenders` para saber qué entidades se le mostraron al cliente, no existe en el schema, y se concluye que **el listado no se persiste** — que para rt=2 hay que reconstruirlo re-evaluando el motor y para rt=1 pedirlo a DynamoDB. Se llegó a escribir eso como hecho en un mapa de etapas.

**Causa raíz verificada.** El dato existe, pero como **columna JSON de `profiling_reviews`**, no como tabla propia. Esa tabla guarda el snapshot completo del motor de perfilamiento:

| columna | qué trae |
|---|---|
| `displayed_lenders` (json) | `[{id, name, probability, weighted_score, profiling_percentage}, …]` — **lo que el cliente vio**, con su clasificación |
| `hard_rules` (json) | la evaluación de las reglas duras |
| `recommended_lender` | la entidad recomendada |
| `disbursed_lender` | la que terminó desembolsando (la escribe el webhook del lender, ver F-94) |
| `datacredito_query` | si se consultó datacrédito |
| `demog_predictions` · `matrix_predictions` · `ML_predictions` (json) | las tres fuentes del orden |

**Evidencia.** `SELECT COUNT(*), SUM(displayed_lenders IS NOT NULL), SUM(hard_rules IS NOT NULL) FROM profiling_reviews` → **588 filas, las 588 con las dos columnas llenas** (dump local, 2026-08-05). Una fila real de la uReq 464542: `recommended_lender = 170` y `displayed_lenders` con `[{"id":170,"name":"Motai RB","probability":"Probabilidad alta","weighted_score":1}, …]`.

**Arreglo.** Para "qué se le mostró al cliente" leer `profiling_reviews.displayed_lenders` de la solicitud, no re-evaluar nada. Es mejor que inferirlo de los logs: es literalmente lo que se renderizó, con la probabilidad ya calculada.

**La pista falsa que hay que romper.** Buscar por nombre de tabla. `information_schema.TABLES LIKE '%display%'` no devuelve nada y eso se lee como "el dato no existe"; hay que buscar también en `COLUMNS`. Lo mismo aplica a cualquier snapshot guardado como JSON.

**Estado:** verificado el 2026-08-05 contra el dump local y contra producción vía Redash.

---

### F-94 · El webhook `lender-result` no deja huella de recepción: «no llegó» y «llegó y falló» se ven igual

**Síntoma.** Es **el reporte más frecuente de #tech-ops** (10 casos en los 10 días del 27-jul al 5-ago): *«Prami confirma originación pero en CT quedó en seleccionar entidad»*, *«Welli ya lo tomó y el estado no cambió»*, *«firmó en prami y no cambió el estado»*. Se revisa la solicitud, está en estado 3 con su lender elegido, y **no hay forma de saber si el webhook del agregador llegó**.

> **RE-MEDIDO el 2026-08-05 leyendo los hilos, no sólo los títulos: 8 casos en 5 días** (31-jul al 5-ago),
> sobre 35 reportes clasificables — **23 % de todos los incidentes del canal**, y el primero por lejos: el
> siguiente motivo empata en 4. La resolución fue SIEMPRE manual: generar el voucher a mano, cambiar el
> estado, o pedirle el `order_id` al agregador. Y en un caso medido (uReq 519064) esa intervención manual se
> delata sola en la traza — el historial queda con las horas fuera de orden de flujo (ver F-96).

**Causa raíz verificada.** El webhook entra por `POST api/onboarding/loan-application/{user_request_id}/lender-result` (`Modules/Onboarding/routes/webhooks.php:18`) → `ListLenderController::storeLenderResult` → `ProfilingReviewController::updateAsyncLender`. Y en ese camino:

- **`ListLenderController` no tiene ni un `Log::`** (grep del archivo completo). No loguea que llegó, ni el payload, ni el resultado.
- **No hay tabla que registre la recepción.** Buscando en `information_schema` por `%webhook%`, `%callback%`, `%notification%` la única que aparece es `experian_notifications`, que es de otra cosa.

O sea que del camino **exitoso** la única huella es el efecto: `profiling_reviews.disbursed_lender` con valor. Y del camino **fallido**, la única es que `$this->error(...)` devuelve 404/500 y eso sí queda como `http_exception_rendering` — cuya `url` (en el `context`, no en el mensaje) contiene `lender-result`.

**La consecuencia que importa.** Los dos casos malos son **indistinguibles desde la BD**: `disbursed_lender` está vacío tanto si el agregador nunca llamó como si llamó y explotó. Y mandan a revisar lugares opuestos — uno es problema del tercero, el otro es nuestro. Lo único que los separa es la excepción HTTP.

**Arreglo.** Corto: para diagnosticar, cruzar `disbursed_lender` con la búsqueda de `lender-result` en el campo `url` de las excepciones. De fondo: **falta un log de recepción en `ListLenderController`** — con `user_request_id`, `lender_id`, `is_approved` y el resultado. Sin eso, "no llegó" es una inferencia por ausencia y no se puede afirmar.

**Estado:** verificado el 2026-08-05 leyendo el controlador y el schema. Implementado como etapa `respuesta-lender` en `playground/trazador`, con los tres casos separados.

---

### F-95 · El `response_type` de un lender cambia según el ambiente: verificarlo contra local miente

**Síntoma.** Se clasifica una entidad por familia (`creditopx` rt=2/3/4 · `agregador` rt=1 · `redirect` rt=0), se verifica contra el dump local, y en dev o prod la misma entidad cae en **otra familia**. Parece un bug de la clasificación.

**Causa raíz verificada.** El `response_type` es dato de configuración y **no está sincronizado entre ambientes**. `Sistecrédito` (lender id 9) es el caso claro:

| ambiente | `response_type` | familia |
|---|---|---|
| local (dump) | **1** | agregador |
| dev | **0** | redirect |
| prod | **0** | redirect |

No es un nombre duplicado: hay un solo `Sistecrédito` y su id es 9 en los tres. Es la misma fila con distinto valor.

**Evidencia.** `SELECT id, response_type, name FROM lenders WHERE id IN (8,9,12,32,39,68)` corrido contra el dump local, contra dev y contra prod (vía Redash) el 2026-08-05. `Bancolombia` (8), `Prami` (12) y `Meddipay` (39) coinciden en rt=1 en los tres; `Sistecrédito` (9) no.

**Arreglo.** Cualquier cosa que dependa del `response_type` se resuelve **contra la BD del target que se está mirando**, nunca contra local ni contra una tabla hardcodeada. Y no se puede cachear entre targets. Por lo mismo, una lista de lenders por familia no puede vivir en un archivo versionado: mentiría en algún ambiente.

**La pista falsa.** Verificar contra local lo que corrió en dev. Es la misma clase de error que F-53 y que la confusión dev/staging: la consulta es correcta, la base es la equivocada.

**Estado:** verificado el 2026-08-05 en los tres ambientes.

---

### F-96 · `user_request_records` repite estados y no es cronológico: «la última fila» puede ser anterior al resto

**Síntoma.** Dos problemas que aparecen juntos al reconstruir el historial de una solicitud:

1. El "historial" muestra el mismo estado muchas veces seguidas, así que **contar filas miente** sobre cuántas veces avanzó el flujo.
2. Ordenando por `created_at`, **la última fila puede tener una hora anterior** a otras etapas del flujo. Una línea de tiempo armada así se lee como que la solicitud fue hacia atrás.

**Causa raíz verificada.** La tabla escribe **una fila por cada toque**, no por cada transición: si algo actualiza la solicitud cinco veces sin cambiarle el estado, quedan cinco filas iguales. Y las filas **no están garantizadas en orden de flujo** — hay solicitudes con el estado final registrado antes que estados intermedios (reutilización, backfill, o escrituras fuera de secuencia; no se determinó cuál).

**Evidencia.** La uReq 464168 tiene **cinco filas consecutivas de estado 9** («Formulario de perfil») entre 22:35 y 23:04. Y la uReq 464432 (staging) tiene el estado 8 «Cancelado» registrado a las 10:38 mientras el estado 3 «Seleccionó entidad» está a las 16:29 — el desenlace **antes** de la selección.

**Arreglo.** Dos cosas, y las dos hacen falta:

- **Colapsar estados consecutivos repetidos** al leer el historial. Sin eso, cualquier métrica de "cuántos pasos dio" está inflada.
- **No usar «la última fila» como el evento más reciente.** Si se necesita cuándo ocurrió un estado puntual, buscar ese estado; y si las horas de las etapas no son monótonas, **avisarlo** en vez de reordenar por hora — reordenar esconde el dato y pone la etapa en el lugar equivocado del flujo.

**Estado:** verificado el 2026-08-05 contra dev y staging. Implementado en `playground/trazador` (colapso + aviso de no-monotonía).

---

### F-97 · La BD guarda el documento FINAL, los logs guardan todos los intentos: buscar por cédula puede no encontrar

**Síntoma.** Un cliente llama a soporte y dicta su cédula. Se busca en la BD y **no existe** — pero el caso sí ocurrió, y los logs de esa misma solicitud contienen esa cédula muchas veces.

**Causa raíz verificada.** `users.document_number` guarda el valor que quedó **guardado**; los logs guardan **cada intento**, incluidos los que fallaron. Si el cliente (o el asesor) tipeó mal y corrigió, la BD tiene solo el último y los logs tienen los dos.

**Evidencia.** uReq 519245 en producción. Sus logs traen **dos documentos distintos**:

| documento | líneas de log | ¿está en la BD? |
|---|---|---|
| `1006004143` | **26** | **no** |
| `1006004134` | 7 | sí — es el del `user_id` 375387 |

Dos dígitos transpuestos. Y explica el resto de la traza: los cuatro intentos fallidos con el documento equivocado dispararon `ONB005/DOCUMENT_DUPLICATE` y agotaron la compuerta de intentos por hora (`Rate limit exceeded, returning ONB040`, `current_attempt: 4` de `max_per_hour: 4`).

**Arreglo.** Cuando la búsqueda por documento no encuentra nada, **no concluir que el caso no existe**: buscar ese mismo valor en los logs. Y al revés — un `DOCUMENT_DUPLICATE` seguido de un rate limit es la firma de alguien peleando con un dato mal tipeado, no necesariamente de un fraude o de un cliente ya registrado.

**Estado:** verificado el 2026-08-05 contra producción (BD vía Redash + logs de Loki).

---

### F-98 · Sin `GRAFANA_TEMPO_ENDPOINT` los logs no llevan `trace_id` — y el span lo abre un middleware con alias, no global

**Síntoma.** Los logs llegan a Loki correctamente pero **sin `trace_id`**, así que no se pueden agrupar las líneas de una misma petición: una traza queda como una lista plana de eventos sueltos. Y en el camino contrario, un `php artisan tinker` que loguea a propósito tampoco lleva trace, lo que hace pensar que la instrumentación está rota.

**Causa raíz verificada.** Son **dos condiciones independientes** y las dos tienen que cumplirse:

1. **El processor que estampa el trace solo se registra si Tempo está habilitado.** `app/Providers/GrafanaServiceProvider.php::configureLogging` envuelve el `pushProcessor` en `if (config('grafana.tempo.enabled'))`, y ese processor es el único que escribe `$record->extra['trace_id']`. Además `initializeOpenTelemetry()` arranca con `if (!$endpoint) { return; }` — **sin `GRAFANA_TEMPO_ENDPOINT` el SDK de OpenTelemetry nunca se inicializa**, así que no hay span y `Span::getCurrent()` no está grabando.
2. **El span de la petición lo abre `App\Http\Middleware\OpenTelemetryMiddleware`**, que está registrado como **alias `'otel'`** en `app/Http/Kernel.php:68` — **no es global**. Una ruta que no lo declare no tiene span, y por lo tanto sus logs no llevan trace aunque Tempo esté configurado. Y nada que corra fuera de una petición HTTP (comandos de artisan, crons, colas) tiene span nunca.

**Evidencia.** Verificado el 2026-08-05 con un Tempo local en Docker: con `GRAFANA_TEMPO_ENABLED=true` y `GRAFANA_TEMPO_ENDPOINT=http://…:4318/v1/traces`, un `Log::channel('loki')` desde `tinker` sale **sin** trace, y una petición a `POST api/onboarding/loan-application/update-user-request/{id}` —que sí tiene el middleware, comprobado con `artisan route:list`— sale **con** un trace de 32 hex, recuperable después en Tempo (`GET /api/traces/<id>` → 200, span `POST api/onboarding/phone/register`).

**Arreglo.** Para que los logs sean agrupables hacen falta las dos cosas: el endpoint de Tempo configurado **y** que la ruta pase por el middleware `otel`. El sampler es `AlwaysOnSampler` mientras `grafana.sampling.rate` sea ≥ 1.0 (el default), así que el muestreo no hay que tocarlo.

**El detalle que cuesta una hora.** El endpoint lleva el path: `…:4318/v1/traces`. `OtlpHttpTransportFactory->create($endpoint, …)` usa la URL tal cual y **no le agrega la ruta**, así que con solo `http://host:4318` el `trace_id` igual aparece en los logs (el span existe) pero las trazas se van a un 404 — funciona a medias y no avisa.

**Estado:** verificado el 2026-08-05 contra un Tempo local.

---

### F-99 · `LOG_CHANNEL=stack` en local puede romper el request: el canal incluye `dynamodb` con `ignore_exceptions => false`

**Síntoma.** Se quiere ver los logs de la app en local, se pone `LOG_CHANNEL=stack` (que es el canal que incluye Loki) y empiezan a fallar peticiones que antes andaban.

**Causa raíz.** En `config/logging.php` el canal `stack` es `['dynamodb', 'loki']` con **`'ignore_exceptions' => false`**. El canal `dynamodb` usa el `DynamoDbHandler` de Monolog contra la tabla `inertia_logs`, con un `new DynamoDbClient([...])` construido **dentro del array de configuración**. En local no hay credenciales de AWS, así que ese handler falla — y con `ignore_exceptions` en `false` la excepción **no se traga**: se propaga desde la llamada a `Log::`.

**Evidencia.** Leído en `config/logging.php` (canal `stack` y canal `dynamodb`) el 2026-08-05. ⚠ **La consecuencia no se probó**: al detectar la configuración se eligió `LOG_CHANNEL=loki` para evitarla, así que "rompe el request" es la lectura del código, no una observación. La configuración sí está verificada.

**Arreglo.** En local usar `LOG_CHANNEL=loki` (un solo destino, el único que existe ahí). Si se quieren archivo **y** Loki, hay que agregar un canal a `config/logging.php` — archivo versionado del repo de la compañía. En los ambientes desplegados `stack` funciona porque sí hay credenciales de AWS.

**El dato de contexto.** En producción la etiqueta `channel` de Loki tiene **dos** valores (`loki` y `production`), o sea que allá llegan logs por más de un canal — consistente con que `stack` esté activo.

**Estado:** configuración verificada el 2026-08-05; la consecuencia es inferida del código y está sin comprobar.

---

### F-100 · `profiling_reviews.disbursed_lender` tiene TRES escritores: verlo lleno no prueba que llegó un webhook

**Síntoma.** Una herramienta de soporte reporta «el webhook del agregador se aplicó: desembolsa Crediemo»
sobre una solicitud **rt=2**, que decide in-platform y no espera ningún webhook. Visto en la uReq 520830 de
prod (Crediemo, rt=2) y en la 509592 (Credifamilia, rt=4, que radica por SOAP). En los dos casos el dato de
fondo era correcto —esa entidad desembolsó— y la **atribución** era falsa.

**Causa raíz** (verificada). El campo lo escriben **tres** caminos distintos, y ninguno deja marca de cuál
fue:

1. **`authorize()` in-platform** — `updateDisbursedLender` corre dentro de `handlePostCommitSideEffects`
   (`Modules/Loans/App/Services/LoanAuthorizationService.php`, ver el nodo `formalization`). Es el camino de
   rt=2/3 y también el de Credifamilia rt=4, que pasa por `authorize()` antes de la radicación SOAP.
2. **El webhook del agregador** — `ListLenderController::storeLenderResult` →
   `ProfilingReviewController::updateAsyncLender`. Es el de rt=1.
3. **Los espejos de API de lender** — `app/Actions/Lenders/BancoDeBogota.php` y el resto también llaman
   `updateDisbursedLender` al mapear `Disbursed → 11`.

Y el endpoint del webhook **no filtra por lender**: valida `lender_id` como entero y nada más, sin lista
blanca ni chequeo de `response_type`. Así que tampoco se puede argumentar «este lender no podría haberlo
llamado».

**Evidencia.** `disbursed_lender` lleno en 520830 (rt=2, estado 11) y en 509592 (rt=4, estado 11); las dos
solicitudes pasaron por `authorize()`, que escribe el campo por sí solo. El webhook, además, **no registra
su recepción** en ninguna tabla ni log (F-94), así que la ausencia de rastro no distingue «no lo llamaron» de
«lo llamaron y el campo ya estaba escrito».

**Arreglo.** Separar las dos preguntas, que no son la misma:

- *¿quién desembolsa?* → `disbursed_lender`. Es confiable.
- *¿llegó el webhook?* → **no** se responde con este campo. Para rt=1 en estado 3 la firma es
  `disbursed_lender` vacío **más** ausencia de excepción con la url del webhook (F-94); para cualquier
  solicitud que ya alcanzó el estado 11 o el intermedio, el campo lo puede haber escrito `authorize()`.

Concretamente: antes de rotular «webhook», mirá el `response_type`. Si el ramal no espera webhook, el campo
lo llenó otro camino y decir «webhook» manda a revisar una integración que no existe.

**La pista falsa.** Que el nombre del campo (`disbursed_lender`) y el del endpoint (`lender-result`) suenen a
lo mismo. Son dos mecanismos que escriben una misma celda.

**Estado:** los tres escritores verificados en código el 2026-08-05; los dos casos de prod medidos vía
Redash. Cuál de los tres escribió una fila puntual **sigue siendo indeterminable** — es F-94, no se arregla
sin instrumentar la recepción.

---

### F-101 · `risk_centrals` mezcla dos momentos del flujo: leerla como «la lista de burós» pone ADO en la etapa equivocada

**Síntoma.** Una vista de soporte que muestra el catálogo completo de centrales con las no consultadas
marcadas —lo correcto, porque una ausencia sin universo no se puede interpretar— acaba mostrando **`Ado` como
«no consultada» bajo «Consulta a burós»**, una etapa donde `Ado` no se consulta nunca. Lo mismo con
`TusDatos - AML`, `crosscore`, `evidente` y `Deceval`: cinco de once filas ubicadas en un momento del flujo
que no les corresponde.

**Causa raíz** (verificada). `risk_centrals` no es el catálogo de burós del onboarding: es la tabla donde se
guarda **cualquier** dato de un tercero de identidad o riesgo, y sus filas se escriben en tres momentos
distintos.

- **Onboarding** (antes del listado): Acierta (1), TusDatos-Identidad (2), Agildata (3), Mareigua (6),
  Quanto (8), Acierta+Quanto (9). Los llama `Modules/Onboarding`.
- **Post-selección** (tramo de cierre, después de `confirmation`): TusDatos-AML (4), Ado (5), crosscore (10),
  evidente (11). Los llama `Modules/Identity` / `CredifamiliaV2`.
- **Ni uno ni otro**: Deceval (7) no es una consulta — es el **pagaré**
  (`Modules/Loans/App/Services/PromissoryNote/DecevalPromissoryNoteService.php`).

**Evidencia.** Medido en prod el 2026-08-05 (Redash, 21 días): de 2.431 filas de `Ado`, cruzadas con la
transición a estado 3 del mismo cliente en ventana ±6 h, **1.903 se escriben después de seleccionar entidad y
186 antes** (91 %, media 24 min después). El cruce es por `user_id` —la tabla no guarda `user_request_id`—
así que las 186 son compatibles con clientes de varias solicitudes. En código: `AdoController` vive en
`Modules/Identity/App/Http/Controllers/Customer/` y su callback apunta a
`/self-service/{hash}/{ureq}/identity-validation-status?provider=ado`; en el wizard el bloque de rutas
`identity-validation*` está bajo un comentario literal `// creditop x`, después de `lenders` y
`lender-results` (`frontend-monorepo/apps/loan-request-wizard/app/routes.ts`).

**Y hay un segundo filo:** en el tramo post-selección el proveedor lo elige el **lender**
(`lender_identity_validation_types`, fallback `lenders.validation_type` → `IdentityValidationStepResolver`),
y de los 7 valores del enum **sólo `Ado`, `CrossCore` y `Evidente` escriben fila**. Medido en prod: de 119
lenders in-platform, **64 usan Ado, 46 usan AWS OCR+Rekognition (que no deja fila) y 9 no validan**. O sea
que **para casi la mitad de los lenders, cero filas en el tramo biométrico es lo normal** — el OCR y el
reconocimiento facial corrieron y su único rastro son los logs de `Modules/Identity`.

**Arreglo.** Dos reglas, y la segunda es la que no es obvia:

1. Reparte el catálogo **por momento del flujo**, no lo vuelques entero en una etapa. Que el reparto sea un
   dato editable con el call site que lo prueba, no una lista en código.
2. Antes de mostrar «centrales no consultadas», decí **qué camino tenía configurado ese lender**. Sin esa
   línea, la ausencia se lee como un paso que faltó — y para 46 lenders sería un falso positivo cada vez.

**La pista falsa.** La regla «mostrá el catálogo completo con las no consultadas marcadas» es correcta y
justamente por eso engaña: el universo tiene que ser el del **momento**, no el de la tabla. Un universo
demasiado grande no es más honesto — afirma que algo pudo pasar donde no puede pasar.

**Estado:** verificado en código y medido en prod el 2026-08-05. Aplicado en `playground/trazador` (etapa
`biometria`, reparto declarado en `mapa/substeps.json`). Los patrones de log del tramo AWS están declarados
pero **sin medir**: el censo de mensajes no tiene ninguna línea de ese tramo.

---

### F-102 · Sólo el 13 % de las líneas de log dice a qué solicitud pertenece, y lo dice con tres nombres distintos

**Síntoma.** Reconstruir el recorrido de una solicitud desde los logs no se puede hacer filtrando: hay que
**anclar y expandir** (buscar las líneas que nombran el uReq o el user_id, sacar sus `trace_id` y traer todas
las líneas de esos traces). Y esa expansión mezcla solicitudes: un cliente con varias solicitudes arrastra
las líneas de las otras.

**Causa raíz** (verificada, dos partes independientes).

**(1) El campo falta en la mayoría de las líneas.** Censo de los campos de contexto sobre las 493 líneas de
una traza real (uReq 519245 de prod): **180 campos distintos y ninguno aparece en más del 23 %**.

| campo | líneas | % |
|---|---|---|
| `user_id` | 111 | 23 % |
| `lender_id` | 81 | 16 % |
| **`user_request_id`** | **62** | **13 %** |
| `cell_phone` | 38 | 8 % |

No existe una llave que identifique la solicitud en la mayoría de las líneas. Por eso la expansión por
`trace_id` no es una comodidad: es la única forma de completar la evidencia, y con ella entra el riesgo.

**(2) Cuando el campo está, viaja con TRES grafías:**

| campo | quién lo escribe |
|---|---|
| `context_user_request_id` | el backend, snake_case |
| `context_userRequestId` | la integración **BNPL de Bancolombia**, camelCase |
| `context_request_id` | `app/Services/PdfMapperClient.php` — es el id de correlación del MS de PDFs (`$request->requestId ?? Str::uuid()`), o sea que **el nombre del campo no significa «user_request»**; le pasan el uReq |

**Evidencia.** Medido el 2026-08-05 contra producción (Loki + Redash), 8 solicitudes de 7 comercios y 6
entidades, cubriendo rt 0/1/2/3/4:

| uReq | comercio · lender | rt | líneas ciertas | contaminadas |
|---|---|---|---|---|
| 520374 | **Alkosto** · Bancolombia | 1 | **58 %** | 0 |
| 520830 | Emo · Crediemo | 2 | 20 % | 0 |
| 519245 | DENTIX · Sistecrédito | 0 | 13 % | 0 |
| 520835 | Mediarte X | 2 | 13 % | 0 |
| 519687 | Free Spirit · Credi Free | 3 | 14 % | 0 |
| 519949 | Free Spirit · Credi Free | 3 | 5 % | 0 |
| 519372 | DENTIX · **Credifamilia** | 4 | 8 % | **3, de la uReq 519397** |
| 520530 | Sonría · **Credifamilia** | 4 | 4 % | **5, de la uReq 520535** |

Tres lecturas de esa tabla:

- **La contaminación aparece sólo con clientes de varias solicitudes.** Los dos casos sucios son clientes con
  4 solicitudes; los seis limpios, de una sola.
- **El contraste Corbeta (58 %) contra Credifamilia (4 %) no es de volumen** — Corbeta loguea *menos*. Es que
  identifica lo que loguea. Es la prueba de que esto se arregla logueando distinto, no logueando más.
- Y hay un daño que no se ve en la columna: en la uReq 520530, **36 líneas vienen de un trace que toca dos
  solicitudes y no dicen de cuál son**. No se pueden descartar (serían el 20 % de la evidencia) ni afirmar.

**La regresión que lo hizo evidente.** Al cambiar el ancla de substring (`|= "520374"`) a filtro exacto por
campo (`| json | context_user_request_id="520374"`) —que es estrictamente mejor: filtra en el servidor y no
gasta el `limit` de 5000 en ruido— la traza de Alkosto pasó de **12 líneas y 5 traces a 6 y 2**, porque BNPL
usa camelCase. Se detectó comparando antes/después sobre la misma solicitud; sin ese contraste habría quedado
como una mejora silenciosa que perdía la mitad de la evidencia.

**Arreglo.** Dos cambios en el backend, en orden de impacto:

1. **`user_request_id` en el contexto de TODA línea de log** de una petición de originación. Es una línea en
   el contexto del logger, no un refactor. Con eso el trazador deja de *inferir* y pasa a *filtrar*: las
   líneas afirmables van de 13 % a ~100 %, la expansión por trace queda como complemento y la contaminación
   se vuelve imposible en vez de detectable.
2. **Una sola grafía**, snake_case, incluida la integración BNPL. Barato y ya costó una regresión.

Y una palanca aparte, que resuelve otro problema (la cobertura del mapa, no la identidad): **conectar
Tempo**. En el código los spans tienen nombre —`tracer->startSpan('AlliedProductsController::upsertUserRequestProduct')`—
pero **ese nombre no viaja a Loki**, sólo el `span_id`; vive en Tempo, y el token de Grafana ya tiene
`traces:read`. Con el nombre del span, ubicar una línea dejaría de depender de reconocer su prosa.

**La pista falsa.** Creer que el problema es que «logs y trazas están separados». No lo están: el `trace_id`
está en el **100 %** de las líneas y une la petición completa — esa parte funciona. Lo que no está unificado
es la **identidad de la solicitud dentro del log**.

**Mitigación aplicada mientras tanto** (`playground/trazador`), toda medida, ninguna suficiente:
- ancla por campo exacto con las tres grafías (`-anclas` mide de quién es cada línea);
- las líneas que traen OTRO `user_request_id` se descartan — no es una heurística, lo dicen en su propio
  contexto — y las dudosas de un trace mezclado se declaran en un aviso;
- herencia por `span_id` para las líneas que ningún patrón reclama (cobertura 92 % → 98 % en la 519245).

**Estado:** medido el 2026-08-05 en producción sobre 8 solicitudes. Los dos arreglos de fondo son del
backend y **no están hechos**.

---

### F-103 · Una solicitud TRABADA no está «rota» en la BD: sigue en curso, y el estado 10 no significa que el desembolso ocurrió

**Síntoma.** Una solicitud que **falló firmando documentos** se ve sana. El desenlace en la BD es «en curso»
—no hay estado de muerte— y cualquier vista que reparta estados por etapa la pinta como si el tramo de
cierre hubiera terminado. Reportado sobre la uReq **464709 de staging**: falló la firma y el paso de
desembolso salía en **verde**.

**Causa raíz** (verificada). Dos cosas distintas que es fácil colapsar en una:

1. **«A qué etapa PERTENECE un estado» ≠ «ese estado prueba que la etapa TERMINÓ».** El estado **10
   («Pendiente de autorización») pertenece** al tramo de cierre —lo escribe
   `PaymentScheduleService::handleSelectPaymentDate` al elegir la fecha de pago, ver el nodo
   `formalization`— pero significa que el flujo está **ADENTRO**, con el pagaré sin firmar. Los que sí
   cierran son los `sellados` (11, 28, 5, 25, 26). Tratar el 10 como cierre es afirmar un desembolso que no
   ocurrió.
2. **Trabada ≠ rota.** `user_request_statuses` tiene estados de muerte (6 Negada, 8 Cancelado, 12
   Autorización negada, 24 Rechazado por identidad), y **el 10 no es ninguno**. Una solicitud que se queda
   ahí figura «en curso» para siempre: no aparece en ningún listado de fallidas, y el corte no se ve en
   ninguna parte salvo que alguien lo busque.

**Evidencia.** uReq 464709 (staging, DENTIX, rt=2): último estado 10, `user_request_records` sin
transiciones posteriores, cero filas de `Deceval` en `risk_central_user_data`, cero líneas de log en la
ventana. El desenlace calculado por `desenlaceDe` es «en-curso».

**Arreglo.** Separar los tres conceptos, que son tres y no dos:

| pregunta | qué la contesta |
|---|---|
| ¿a qué etapa pertenece este estado? | el reparto estado→etapa (el 10 es de `desembolso`) |
| ¿la etapa **terminó**? | sólo los estados de cierre (los `sellados` + el terminal propio de cada etapa) |
| ¿la solicitud quedó **detenida** acá? | el estado final ES de esa etapa y no cierra → **es el corte** |

En `playground/trazador` esto quedó como tres mapas explícitos (`estadoEtapa`, `estadoCierra`,
`estadoDetiene`), y la etapa donde se detuvo se marca en rojo con el motivo: *«DETENIDA acá: la solicitud
entró a esta etapa y no salió — estado 10 “Pendiente de autorización”. No figura como rota en la BD, sigue
en curso.»*

**La pista falsa.** Que el desenlace de la BD diga «en curso» invita a leer la solicitud como viva. Para
soporte no lo está: nadie la va a mover. **Buscar solicitudes trabadas por su desenlace no las encuentra —
hay que buscarlas por estado + antigüedad.**

**Y una advertencia de diseño para cualquier vista de flujo:** un sub-paso que DESCRIBE configuración (p. ej.
«este lender valida identidad con Ado») no es evidencia de que algo ocurrió. Contarlo como tal produce la
misma clase de falso verde — pasó dos veces en el trazador antes de marcarlo explícitamente como
declarativo.

**Estado:** verificado el 2026-08-06 contra staging. El comportamiento del backend NO es un bug: el 10 es un
estado legítimo del tramo de cierre. Lo que era un bug es leerlo como cierre.

---

### F-104 · El perfilador ML nuevo NUNCA corre en producción (falta la env), y el viejo lleva caído desde el 2026-08-05

**Síntoma.** El listado de entidades tarda minutos y en los logs aparecen
`cURL error 28: Operation timed out after 15002 milliseconds … for
http://profiler.inertia-production:8000/predict_w_experian`, repetidos varias veces en una misma
solicitud (4 en la uReq **521997** de prod). El mensaje empieza con `cURL error 28` y no nombra a nadie:
leerlo sin llegar al final de la URL lleva a atribuírselo al lender que se estaba evaluando en ese
momento — que es un servicio EXTERNO— cuando el que no responde es INTERNO.

**Causa raíz** (verificada, dos capas independientes):

1. **El perfilador nuevo está apagado por configuración, no por falla.** `ProfilerMLController::mlModelV1`
   tiene la estrategia **cableada** como `new_then_legacy`: primario `NewProfilerMLService`, respaldo el
   modelo H2O de siempre. Pero `NewProfilerMLService` arranca con una guarda —si
   `config('services.new_profiler_ml.host')` viene vacío devuelve `error` sin llamar a nadie— y esa config
   sale de **`NEW_PROFILER_ML_HOST`**, que en prod **no está puesta**. Resultado: el primario falla
   *siempre*, y `fallback_triggered` viene en `true` en **13.902 de 13.902** filas con forma de array entre
   el 2026-07-01 y el 2026-08-05 (**100 %**). La huella queda en la BD:
   `previous_attempt.details = "Configure services.new_profiler_ml.host para usar el nuevo perfilador."`.
2. **El respaldo (H2O) está caído desde el 2026-08-05 ~16:00 (Bogotá).** Medido por hora sobre
   `profiling_reviews`: el 2026-08-06 son **1.513 de 1.513** solicitudes sin ninguna respuesta del modelo
   (`error` o `status:error` con el 503 «El servidor de predicciones no está disponible»). Hubo una caída
   igual del **2026-07-24 al 2026-07-28**. En los días buenos ese mismo respaldo sí puntúa.

⚠ **`fallback_triggered: true` NO significa «lo ordenaron las matrices»** — significa que el perfilador
NUEVO falló y respondió el VIEJO, que sigue siendo un modelo. Leerlo como «el ML está apagado» manda a
revisar configuración cuando lo que hay es un servicio sin responder (y al revés).

**Evidencia.**
- `legacy-backend`: `Modules/Risk/App/Http/Controllers/ProfilerML/ProfilerMLController.php` —
  `$strategy = 'new_then_legacy'`, `profileWithFallback()` marca `fallback_triggered`, y `makePrediction()`
  usa `->baseUrl(config('services.h2oapi.host'))->timeout(15)` (de ahí los 15002 ms).
- `Modules/Onboarding/App/Services/ProfilerML/NewProfilerMLService.php` — la guarda `if ($host === '')`.
- `config/services.php` → `'new_profiler_ml' => ['host' => env('NEW_PROFILER_ML_HOST'), …]`.
- BD prod (`profiling_reviews.ML_predictions`, 59.841 filas del 2026-07-01 al 2026-08-05) y el corte por
  hora del 2026-08-05/06.

⚠ **Y cada timeout manda un correo.** El `catch` de `makePrediction` hace
`Notification::route('mail', ['santiago@creditop.com','jose.guzman@creditop.com'])`. Cuatro timeouts en una
solicitud son cuatro correos; con ~1.500 solicitudes diarias fallando, el volumen no es anecdótico.

**Arreglo.** Dos, separados: (a) poner `NEW_PROFILER_ML_HOST` en prod **o** dejar de intentar el primario,
para no pagar el intento fallido en cada solicitud; (b) el 503 de `profiler.inertia-production:8000` es de
infraestructura y no se arregla desde este código.

**Estado:** verificado el 2026-08-06 contra código (`main`) y datos de producción. **La caída del respaldo
seguía activa a la hora de medir.** No verificado: qué ordena el listado cuando ningún perfilador responde
— `matrix_predictions` sólo viene poblada en ~27 % de las filas y esa proporción no cambia en los días de
caída, así que **no** es el respaldo del orden.

---

### F-105 · `user_request_records` NO registra todas las transiciones: los estados 1 y 10 nunca dejan fila

**Síntoma.** Una solicitud está en el estado 10 («Pendiente de autorización») y su historial de
transiciones termina en el 3. Cualquier reconstrucción del recorrido hecha sólo con
`user_request_records` —que es la tabla natural para eso— muestra un camino que **no llega** al estado en
el que la solicitud está de verdad, y no avisa: no hay hueco visible, la lista simplemente termina antes.
Encontrado en la uReq **464709 de staging** al poner el historial al lado de la afirmación que se apoyaba
en él.

**Causa raíz** (medida, mecanismo NO verificado en código). El estado vigente vive en
**`user_requests.user_request_status_id`** y el recorrido en **`user_request_records`**, y son dos
escrituras distintas: hay estados que se escriben en la primera y **nunca** en la segunda. Medido en prod
sobre las solicitudes creadas desde el 2026-08-05:

| estado | solicitudes | sin fila en el historial |
|---|---|---|
| **1** | 58 | **58 (100 %)** |
| **10** «Pendiente de autorización» | 44 | **44 (100 %)** |
| 11 | 257 | 37 (14 %) |
| 8 | 92 | 17 (18 %) |
| 6 | 115 | 4 (3 %) |
| 9 | 1.075 | 24 (2 %) |
| 3 | 308 | 1 (0,3 %) |

El 1 y el 10 son **categóricos**, no ruido: en esa ventana no hay una sola solicitud en esos estados con
fila de historial. Los demás porcentajes parecen carreras (la fila se escribe después) y no se
investigaron.

⚠ **Lo que NO está verificado**: por qué. No se buscó en el código quién escribe `user_request_records`
ni con qué condición se lo salta. La tabla de arriba dice **que** pasa y con qué frecuencia; el mecanismo
es hipótesis.

**Evidencia.** `SELECT ur.user_request_status_id, COUNT(DISTINCT ur.id), COUNT(DISTINCT CASE WHEN r.id IS
NULL THEN ur.id END) FROM user_requests ur LEFT JOIN user_request_records r ON r.user_request_id = ur.id
AND r.user_request_status_id = ur.user_request_status_id WHERE ur.created_at >= '2026-08-05' GROUP BY 1`
(prod). Y el caso puntual: la 464709 de staging tiene filas sólo para los estados 3 y 9, con
`user_requests.user_request_status_id = 10`.

**Arreglo.** Del lado de quien lee: **el recorrido son las dos tablas**, no una. El trazador ya lo hace —
el bloque de evidencia del paso «DETENIDA acá» muestra el historial y debajo el estado vigente, y dice
explícitamente cuándo el segundo no aparece en el primero. Del lado del backend no se propone nada: haría
falta ver primero por qué se salta la escritura.

**Estado:** verificado el 2026-08-06 (medición en prod + caso en staging). Relacionado con **F-103**: aquel
dice que el estado 10 no prueba que el desembolso ocurrió; éste dice que además **ni siquiera aparece en
el historial**, así que un recorrido que termina antes del 10 no significa que no haya llegado.

---

### F-106 · La fila de estado 9 en `user_request_records` se escribe al CREAR la solicitud: no prueba que el formulario se completó

**Síntoma.** Cualquier reconstrucción que lea «hay fila de estado 9» como «el cliente completó el
formulario» pinta verde la etapa donde más solicitudes mueren. El trazador lo hacía (`estadoCierra[9]`), y
como el **50,9 % de las solicitudes de los últimos 30 días queda en estado 9 sin elegir entidad**, el falso
verde caía justo en el caso más consultado por soporte.

**Causa raíz** (medida en 4 trazas; mecanismo en código NO verificado). La fila de estado 9 nace junto con
la solicitud: en las 4 trazas del censo del 2026-08-07 con esa fila, está a **≤1 segundo** del `created_at`
de `user_requests` — 520593 (13:30:43/13:30:43), 522154 (06:01:14/06:01:14), 522239 (11:24:33/11:24:33),
522237 (11:23:14/11:23:15). En 522154 el primer log del formulario llega **30 minutos después** (Agildata
06:31:22). O sea: estado 9 = «la solicitud existe», no «el formulario se llenó».

⚠ **No verificado**: quién escribe esa fila y por qué en la creación (no se buscó en el código), ni la
medición poblacional (la consulta de verificación a escala fue bloqueada; el dato fino son esas 4 trazas +
el 50,9 % que sí está medido con ventana explícita).

**Evidencia.** Los 4 pares created_at/fila-9 de arriba (prod y staging, censo 2026-08-07). La proporción:
`user_requests` últimos 30 días = 25.841, de las cuales 13.145 en estado 9 sin lender (50,9 %); a 60 días
49,7 %.

**Arreglo.** Del lado de quien lee: estado 9 **pertenece** a la etapa del formulario pero **no la cierra**
— la prueba de cierre son los logs del formulario o el paso a un estado posterior. El trazador ya lo
aplica: `bd.detienen=[9]` en `etapas.json` (estar en 9 = seguir adentro) y la fila se muestra rotulada
«se escribe al CREAR la solicitud». Es la tercera vez que el mismo patrón engaña — estado 10 (F-103),
historial incompleto (F-105), y ahora el 9 — la regla general: **un estado dice dónde está la solicitud,
nunca qué completó**.

**Estado:** verificado el 2026-08-07 sobre 4 trazas + proporción a 30/60 días. Relacionado: F-103, F-105.

---

### F-107 · El vínculo buró↔solicitud NO es un hecho: lo calcula un stored procedure POR FECHA, y sólo cuando alguien lo corre a mano

**Síntoma.** `user_request_risk_central_user_data` parece la respuesta al viejo problema de que
`risk_central_user_data` se indexa por `user_id` y no por solicitud. Se lee como una clave foránea que
ata cada consulta de buró a SU solicitud. **No lo es** — y creerle produce dos errores: afirmar
atribución exacta donde hay una heurística, y leer su vacío como «no se consultó el buró».

**Causa raíz** (verificada en el código del procedimiento). Lo llena
`SP_Update_User_Request_Risk_Centrals`, un stored procedure que vive en
`legacy-backend/migrate.sql:282-405` — un `.sql` suelto en la raíz del repo, **no** en
`database/migrations`. Existe en prod desde el **2025-12-11**. Su lógica, por cada central (1 Experian ·
2 TusDatos · 3 AgilData · 4 AML):

1. toma las solicitudes que NO estén en `user_request_risk_central_verified` (la tabla **marcador** de
   «ya procesada» — eso explica sus 301.690 filas con `created_at` NULL);
2. para cada una, engancha la fila de `risk_central_user_data` del **mismo `user_id`** cuya fecha sea la
   **máxima menor o igual** a la de la solicitud, tomando la última del día
   (`ROW_NUMBER() … PARTITION BY user_id, DATE(created_at) ORDER BY TIME(created_at) DESC`);
3. al terminar, marca la solicitud en `_verified`.

⚠ **Eso es exactamente la inferencia por fecha, precomputada.** No es un dato que el flujo escriba
cuando consulta el buró. Y opera a granularidad de **DÍA**: dos solicitudes del mismo cliente el mismo
día reciben **la misma** fila de buró — que es justo el caso de contaminación que el trazador reporta
(522213 / 522223 / 522227, mismo cliente, AML a las 11:22-11:23). **No desambigua el caso difícil; sólo
congela una respuesta plausible para el fácil.**

**Y no corre solo.** No hay migración, cron ni scheduler que lo invoque: `grep` del nombre del SP y de
la tabla sobre `legacy-backend`, `legacy-application` y `frontend-monorepo` no devuelve un solo call
site. Alguien lo ejecutó **a mano el 2026-08-07 ~04:50** en prod y dev a la vez: prod 952.413 filas /
441.847 solicitudes escritas entre 04:50:00 y 04:50:16; dev 566.944, techo 04:50:42. Desde entonces,
**cero filas nuevas** — 0 de las 292 solicitudes de prod creadas después de las 05:00 tienen vínculo.
Como el SP sólo procesa lo no marcado, es idempotente y está pensado para re-correrse; lo que no existe
es quién lo dispare.

**Evidencia.** El cuerpo del SP en `legacy-backend/migrate.sql:282-405` (el `INSERT … _verified` de
cierre en `:399`). `information_schema.routines` en prod: creado 2025-12-11. Las cuatro consultas de
conteo/techo contra prod y dev (trazador `-sql`, sólo lectura). Historial: `git log -S` del nombre de la
tabla en los dos repos sólo devuelve la migración de 2025 — nada en 2026.

**Arreglo.** En el harness, `experian-check.ts` consulta el **techo de cobertura** y, si la solicitud es
posterior, dice «SIN DATO — no se puede saber por acá» en vez de «no se consultó», con un veredicto NO
CONCLUYENTE que va **antes** que las otras tres causas. Para el trazador: **no lo uses como verdad**.
Sirve como *corroboración* de la inferencia por fecha que ya hace —coinciden por construcción— pero no
la mejora, y en el caso que importa (varias solicitudes el mismo día) tiene el mismo error. Los avisos
de contaminación siguen siendo la lectura honesta.

**Estado:** verificado el 2026-08-07 contra el código del SP, prod, dev y la copia local.
⚠ **Corrige una versión anterior de este mismo hallazgo** que decía que la tabla «resuelve exacto» la
atribución por solicitud: es falso, y el error fue leer el nombre y la forma (dos FKs) sin leer quién la
escribe. **Un pivote con foreign keys no prueba que el dato sea autoritativo** — hay que buscar el
escritor.

**Pendiente, y vale preguntarlo**: quién lo corrió y para qué. Si la intención es dejarlo agendado, el
techo deja de degradarse; si además alguien hiciera que el flujo escriba el vínculo **en el momento de
consultar**, ahí sí pasaría a ser el hecho que hoy no es.


### F-108 · Hay 14 tablas de LOG en la BD que ninguna herramienta lee — pero sólo 2 sirven para atar a una solicitud

**Síntoma.** El trazador busca el «por qué» sólo en Loki, y declara tramos ciegos (la etapa de validación
biométrica sale con **0 líneas de log en 25 de 25 trazas** del censo). Mientras tanto la propia BD tiene
un juego de tablas de auditoría que nadie mira: `otp_logs`, `deceval_logs`, `compare_face_logs`,
`ocr_logs`, `qr_logs`, `twilio_logs`, `creditop_x_log`, `creditop_x_changes_log`, `deceval_logs`,
`reminder_dispatch_log`, `reminder_email_log`, `reports_log`, `statements_of_account_log`,
`allied_status_log`, `log_user_special_credit_grant_by_lender`.

**Causa raíz** (medida en prod). Las cuatro que tocan tramos donde el trazador está ciego **declaran
`user_request_id`**, pero sólo dos lo llenan:

| tabla | filas | con `user_request_id` | sirve |
|---|---|---|---|
| `deceval_logs` | 1.404 | **1.404 (100 %)** · 174 solicitudes | **sí** |
| `otp_logs` | 983.921 | **10.334 (1 %)** · 8.174 solicitudes | sí, parcial |
| `compare_face_logs` | 8.115 | **0** | no |
| `ocr_logs` | 10.633 | **0** | no |

⚠ **`compare_face_logs` y `ocr_logs` tienen la columna y NUNCA la escriben.** Es el mismo patrón que
F-107 y que `risk_central_user_data`: el esquema promete atribución por solicitud y el dato no la
entrega. Quien los quiera usar tiene que cruzar por `user_id` — y hereda la contaminación entre
solicitudes del mismo cliente.

**Evidencia.** Consultas de conteo contra prod (trazador `-sql`, sólo lectura, 2026-08-07). Y el caso
concreto que lo desinfla: la uReq **464709 de staging** —la que falló firmando documentos, el reporte
que originó todo este tramo— tiene **0 filas en las cuatro**. `deceval_logs` cubre 174 solicitudes en
total, así que su cobertura es fina: sirve cuando está, y no está casi nunca.

**Arreglo.** Ninguno aplicado, a propósito. Lo que corresponde es lo que dice la medición:
`deceval_logs` es el único candidato limpio para sumar al trazador (100 % atado, y cubre justo el tramo
del pagaré, que es el reporte de soporte más caro). `otp_logs` al 1 % no vale el join. Las otras dos NO
se deben usar por `user_request_id` — devolverían vacío siempre y eso se leería como «no pasó», el
mismo falso negativo de F-107.

**Estado:** verificado el 2026-08-07 contra prod y staging. **No verificado**: las otras 10 tablas de
log (`qr_logs`, `twilio_logs`, `creditop_x_log`…) — no se midió si atan a una solicitud ni qué cubren.

⚠ **La lección, que es la que generaliza**: que una tabla declare `user_request_id` no significa que lo
escriba. Antes de construir sobre una columna de atribución, contá cuántas filas la traen — dos de
cuatro dieron cero.

⚠ **Y una segunda, sobre el ACCESO**: «no se puede leer» depende de POR DÓNDE preguntes. El usuario de
Redash (prod) no puede leer `routine_definition` ni `performance_schema`; la conexión **directa a MySQL
de dev sí lee los cuerpos de las 42 rutinas**. Antes de declarar algo irrecuperable, probá las tres vías
que hay —Redash, MySQL directo de dev, copia local— porque tienen privilegios distintos. Yo declaré
«irrecuperable con cualquier credencial» habiendo probado dos de las tres.

---

### F-109 · El «solo lectura» del `-sql` del trazador dependía del motor, no de su guarda: `INTO OUTFILE` pasaba

**Síntoma.** Ninguno visible — y ése es el punto. La herramienta anuncia «Consulta de solo lectura» y
rechaza `UPDATE`/`DROP`, así que se usa con esa confianza contra producción. Pero una consulta que
ESCRIBE podía atravesarla entera.

**Causa raíz** (verificada en código y ejercitada). `esSoloLectura` (`trazador/server/sql.go:47`) tiene
tres guardas: que arranque con `SELECT`/`WITH`, que sea una sola sentencia, y una lista de verbos de
escritura. **`SELECT … INTO OUTFILE '/ruta'` pasa las tres**: arranca con SELECT, es una sentencia, y
`into`/`outfile` no están en la lista de verbos. Medido el 2026-08-07 contra dev: la consulta **llegó a
MySQL** y sólo la frenó el servidor por falta del privilegio `FILE`. O sea que el «solo lectura» no lo
garantizaba la herramienta sino la configuración del motor — contra un usuario con `FILE`, habría
escrito un archivo en el servidor de base de datos.

Y un falso positivo simétrico, del mismo mecanismo: la lista de verbos matcheaba `REPLACE` por palabra,
así que rechazaba **la función de cadena** `REPLACE(col,'a','b')` como si fuera `REPLACE INTO`. MySQL
tiene `REPLACE()` e `INSERT()` como funciones; contar saltos de línea con
`LENGTH(x)-LENGTH(REPLACE(x,CHAR(10),''))` era imposible.

**Evidencia.** `sql.go:47-63`. Ejercitado contra dev: `SELECT 1 INTO OUTFILE '/tmp/x'` →
«la consulta falló» (llegó al servidor) antes del arreglo; «consulta rechazada» después.
`SELECT REPLACE('ab','a','x')` → rechazada antes, devuelve fila después.

**Arreglo.** Aplicado. Un patrón propio para `INTO OUTFILE|DUMPFILE` (van de dos palabras, no entran en
una lista de verbos sueltos), y la lista de verbos ahora **ignora el verbo seguido de `(`** — un
paréntesis pegado es una función, y la sentencia siempre lleva separador antes del destino
(`REPLACE INTO`). No debilita: las otras dos guardas siguen intactas y se verificó con 6 casos.

**Estado:** verificado y corregido el 2026-08-07.

⚠ **La lección**: una guarda de «solo lectura» hay que probarla con la escritura que **empieza como una
lectura**, no sólo con `UPDATE`/`DROP`. Si el único motivo por el que no se escribió es que el usuario
no tenía el privilegio, la guarda no estaba haciendo su trabajo.

---

### F-110 · El rotativo (rt=3) NO usa categorías: calcula un PLAZO MÍNIMO y por eso «desaparecen» las cuotas parametrizadas

**Síntoma.** Negocio parametriza los plazos de un comercio —por ejemplo 1, 3 y 6 cuotas— y al cliente le
aparece **sólo la más larga**. Se lee como un error de configuración y no lo es. Reportado en #tech-ops
el 2026-08-03 por **dos personas distintas en el mismo día** («solo le sale a 6 cuotas cuando está
parametrizado a 1, 3 y 6» · «este cliente lo quería a 3 pero quedó a 1»), lo que lo vuelve un patrón y
no un caso.

**Causa raíz** (verificada en código, y confirmada por la dueña de política). El rotativo **no pasa por
el motor de categorías** de rt=2. Tiene su propia cadena en
`application/app/Services/lenders/RevolvingLoanConfigService.php`, y el paso 8 dice literal:

```php
//8. Calcular el plazo mínimo. Dividir el cupo aprobado por la capacidad de pago.
$min_fee_number = ceil($available_amount / $payment_capacity) + 1;
```

O sea: **el plazo mínimo se CALCULA a partir del cupo y la capacidad de pago**, y recorta por abajo las
opciones que el comercio dejó configuradas. Si el cupo aprobado son 6 veces la capacidad mensual, el
mínimo da 6 y las de 1 y 3 desaparecen. El enganche y el FGA, en la misma función, salen de
`creditop_x_profiling_down_payments_fga` por **`multiplier_risk`**, no por categoría.

**Evidencia.** El hilo de #tech-ops del 2026-08-03: *«Rotativo NO tiene categorías»* · *«esas
condiciones se manejaron con reglas duras»* · *«la política de rotativo es estándar para todos, y
dependiendo del riesgo puede arrojar un plazo mín, por eso se le acota»* · *«pero estaba revisando y no
lo pueden ver en redash»*. Y el código: `RevolvingLoanConfigService.php:64` (ingreso), `:73` (gastos),
`:77` (capacidad), `:80` (multiplicador), `:86` (multiplicador ≤ 3 ⇒ rechazo), `:90-93` (cupo capado por
`lenders.max_rev_credit` y redondeado de a 50.000), `:95` (el plazo mínimo), `:99-104` (enganche/FGA por
`multiplier_risk`).

⚠ **Y por qué no se puede diagnosticar con los datos**: ni el multiplicador ni la capacidad de pago se
persisten, y el multiplicador lo calcula `FN_CreditopX_Revolving_Credit_Multiplier` — una función
almacenada **sin fuente en ningún repositorio** (ver el nodo `db-routines`). La frase «no lo pueden ver
en redash» no es una queja: es una consecuencia estructural.

**Arreglo.** Documental, aplicado: el nodo `creditopx` afirmaba que rt=2 y rt=3 comparten «el motor de
categorías» — falso para rt=3, corregido con la fórmula completa. Del lado del producto no se propone
nada: que el plazo mínimo se calcule puede ser exactamente lo que riesgo quiere. Lo que faltaba era que
estuviera escrito, para que soporte no lo persiga como un error de parametrización.

**Estado:** verificado el 2026-08-07 contra el código de `main`. **No verificado**: si el recorte ocurre
en el backend o si el front además filtra; y si `min_fee_number` se persiste en `revolving_credits`
(la columna existe en tres modelos).

⚠ **La lección de método**: esta regla no estaba en el código de forma legible ni en ningún doc — estaba
en la **respuesta de una persona en un hilo de soporte**. Las preguntas de #tech-ops son un detector de
huecos de documentación: cuando alguien pregunta «¿por qué el sistema hizo X?», la respuesta suele ser
una regla de negocio que nadie escribió.

---

### F-111 · El webhook de Prami ata SÓLO por `order_id` y con `firstOrFail()`: si no matchea, la solicitud se queda en «Seleccionó entidad» para siempre

**Síntoma.** «Aprobado por Prami / el cliente ya firmó, pero en CreditOp sigue en *Seleccionó entidad*».
Reportado **seis veces en una semana** en #tech-ops (2026-08-01 al 2026-08-04, cuatro personas
distintas). Se ve idéntico a «el agregador no llamó», y no lo es: el agregador llamó y CreditOp descartó
la llamada.

**Causa raíz** (verificada en código; el diagnóstico original lo dio un dev en el hilo del 2026-08-02).
`legacy-application/app/Http/Controllers/Api/PramiController.php:39-42`:

```php
$transaction = LenderTransaction::query()
    ->where('lender_id', $lender->id)
    ->where('order_id', $request->validated('order_id'))
    ->firstOrFail();      // ← si el order_id no matchea, LANZA y no se actualiza nada
```

El único vínculo es el `order_id`. **No hay respaldo por cliente, documento ni solicitud.** Si el
cliente cotizó dos veces —o si el `order_id` que devuelve Prami no es el de la cotización guardada—
`firstOrFail()` corta la transacción entera y la solicitud queda intacta. Textual del hilo: *«hay dos
solicitudes desde Prami, pero ninguno de los `order_id` que llega coincide con la solicitud del cliente
… por esta razón nunca se actualiza»*.

**Y dos cosas más que el mismo código revela:**

1. **De acá salen los estados 7 y 20** — los que ninguna etapa del trazador mapeaba (F-105/F-106 los
   dejaron como hueco). El webhook traduce el estado del agregador al nuestro (`:51-56`):
   `No_Completado`→**7** «No terminó proceso» · `Rechazado`→**6** «Negada» ·
   `Aprobado`→**20** «Aprobada no desembolsada» · `Originado`→**11** «Autorizada».
   Mismo mapeo en `MeddipayController.php:61`. O sea que **7 y 20 son estados de AGREGADOR**, no del
   flujo in-platform: por eso no aparecían en el recorrido de rt=2.
2. **El webhook PISA el monto**: `'final_amount' => $request->amount` (`:59`). Si hubiera matcheado, el
   valor de la solicitud pasaba a ser el que manda Prami — y en el caso del hilo diferían ($799.000 del
   webhook contra $918.900 de la solicitud). Cuando el `order_id` no matchea, esa discrepancia queda
   invisible; cuando matchea, gana el agregador sin avisar.

⚠ Y el lender se resuelve por **nombre**: `Lender::where('name', 'Prami')->firstOrFail()` (`:37`).
Renombrar la entidad en el admin rompe el webhook entero, en silencio. Es el anti-patrón 3 de
`hardcodes-entidades`.

**Evidencia.** El código citado. El hilo de #tech-ops del 2026-08-02 con el diagnóstico del dev, y seis
reportes del mismo síntoma entre el 2026-08-01 y el 2026-08-04 (Prami ×4, Welli ×1, y uno de firma).

**Arreglo.** Ninguno propuesto: el fallback correcto —¿buscar por cliente? ¿por la última transacción
pendiente?— es una decisión de negocio, porque elegir mal ataría el resultado a la solicitud equivocada.
Lo que faltaba era saber que el síntoma «se quedó en seleccionar entidad» tiene **dos causas
indistinguibles desde la BD**: el agregador no llamó (F-94), o llamó y el `order_id` no matcheó (ésta).

**Estado:** verificado el 2026-08-07 contra `main`. **No verificado**: con qué frecuencia falla el match
en producción — el webhook no deja registro cuando `firstOrFail()` lanza, así que no se puede contar.
Ése es justamente el motivo por el que se ve como si el agregador no hubiera llamado.

---

### F-112 · La compuerta de capacidad de endeudamiento NO mira los gastos que declara el cliente, y viene APAGADA por defecto

**Síntoma.** Un cliente declara ingresos de $8.219.178 y gastos de $8.327.000 —gasta más de lo que
gana— y el sistema le aprueba un cupo de $6.445.956. Negocio lo lee como un fallo del motor de riesgo.
Preguntado en #tech-ops el 2026-08-05 («por lo cual no se le debió haber ofrecido CTX pero se le aprobó
cupo, ¿por qué?») y **la pregunta quedó sin responder en el hilo**.

**Causa raíz** (verificada en código). Hay **dos cosas distintas** que se llaman «capacidad», y la que
decide no usa los gastos declarados:

1. **`calculatePaymentCapacity`** (`legacy-backend/Modules/Loans/App/Services/LenderUserCategoryService.php:333`)
   sí usa los gastos —`floor(((ingreso_field87 − gastos_field90) / ingreso) × 100)`— pero devuelve un
   **PORCENTAJE**, no un monto, y alimenta el **scoring**. Con los números de arriba da negativo: baja
   el puntaje, no rechaza.
2. **La COMPUERTA dura** (`:664`) calcula otra cosa:
   ```php
   $debtCapacity    = (int) $salary - ($adjustedMonthlyPayment - $debtToIgnore);
   $minDebtCapacity = ($rule->min_debt_capacity / 100) * ((int) $salary);
   ```
   O sea **salario menos la cuota mensual reportada en DATACRÉDITO**. Los gastos que el cliente declaró
   **no entran en ningún término**. Un cliente con poca deuda reportada pasa la compuerta por más que
   declare que gasta todo lo que gana.

**Y la compuerta casi siempre está apagada.** Dos salidas tempranas que devuelven `eligible: true`:

- `:651` — si el tier **no configura** `min_debt_capacity` (o lo deja en ≤ 0), **no hay chequeo**.
- `:667-673` — el chequeo sólo se aplica cuando `debt_capacity_amount_validation == 0`; con cualquier
  otro valor **se aprueba sin evaluar**. Es un flag con doble negación: «validación por monto» apagada
  es lo que ENCIENDE la validación de capacidad.

⚠ Y la deuda reportada además se descuenta: `debtToIgnore` (`:646`) ignora el **100 %** de la cuota de
una tarjeta cuya próxima cuota iguala el saldo, y el **70 %** de la cuota en el resto de los casos.

**Evidencia.** El código citado. El hilo de #tech-ops del 2026-08-05 con el caso y sus cifras.
En el mismo hilo, una segunda regla que tampoco estaba escrita: **un embargo de CUENTA BANCARIA no
bloquea** — «pasó todas las reglas… porque es una cuenta bancaria, no una deuda», y determinar un
*overdue account* «se calcula por detrás, no es sólo si aparece en datacrédito». Que un embargo deba
bloquear CTX estaba **en el backlog de producto**, no implementado.

**Arreglo.** Documental. Del lado del producto no se propone nada: que la compuerta mire la deuda
reportada y no lo declarado puede ser deliberado (lo declarado no se verifica). Lo que faltaba era que
estuviera escrito, porque **negocio y motor llaman «capacidad» a dos cosas distintas** y por eso el
mismo caso se lee como bug desde un lado y como correcto desde el otro.

**Cuántos la tienen encendida, medido en prod** (`lender_users_category_rules`, 2026-08-07): de **195
tiers**, **133 declaran `min_debt_capacity > 0`** … pero sólo **35 tienen además
`debt_capacity_amount_validation = 0`**, que es lo que de verdad ENCIENDE el chequeo. O sea que **la
compuerta corre en 35 de 195 tiers (18 %)**: en los otros 160 la capacidad de endeudamiento no se
evalúa, incluidos **98 que configuraron un mínimo creyendo que sí aplicaba**. Ese es el número que
convierte esto de matiz en agujero: casi todos los que quisieron poner el límite no lo tienen activo.

**Estado:** verificado el 2026-08-07 contra `main` (legacy-backend) y contra los datos de producción.

---

### F-113 · Credifamilia devuelve «APROBADO» con datos VACÍOS cuando la entrada es inválida, y nuestro código lo acepta como pre-aprobado

**Síntoma.** «No sale la opción para Credifamilia» en el marketplace. No hay error, no hay rechazo: la
entidad simplemente no aparece. Reportado el 2026-08-05 en #tech-ops **y en paralelo por el propio grupo
de Credifamilia** — o sea, dos canales el mismo día.

**Causa raíz** (verificada en código; el diagnóstico lo hizo un dev en el hilo). Dos fallas apiladas, y
la primera tapó a la segunda:

1. **El disparador**: un **correo con tilde** (o cualquier carácter no ASCII). Credifamilia no lo
   rechaza — responde **`"Aprobado"` con el payload vacío**. Textual del hilo: *«en la respuesta no dice
   que falló por el correo, dice "Aprobado" sin datos»*.
2. **Nuestro lado lo acepta.** `legacy-backend/Modules/Onboarding/App/Services/lenders/PreApprovedLenderService.php:325-333`:
   ```php
   if ($statusId == 41 && $statusDetail == 'APROBADO') {
       $lender->probability = 'Pre aprobado';
       $lender->available = $responseData['valor_disponible_para_comprar'] ?? null;  // ← queda NULL
       $lender->pre_approved_lender = true;
   ```
   La entidad queda marcada **pre-aprobada con cupo `null`**. ⚠ Y la asimetría es lo llamativo: el lado
   del RECHAZO sí tiene guarda defensiva (`:335` trata como rechazado un estado final sin
   `statusDetail`, con comentario explicándolo), pero el lado del APROBADO **no valida que venga el
   cupo**.

**Y una tercera capa que enmascaró el diagnóstico**: Credifamilia tiene un **límite de intentos de su
lado** (`{"transactionId":…,"status":3,"status_detail":"Rechazado"}`) que se agotó mientras se depuraba.
Del hilo: *«O desde un principio era rechazo, pero por el correo no lo pudimos ver»* — es decir, nunca se
supo si el cliente estaba rechazado desde el principio. Los intentos se pueden reiniciar del lado de
CreditOp, pero el límite es del proveedor y **no está en nuestro código**.

**Evidencia.** El código citado. El hilo de #tech-ops del 2026-08-05 (35 respuestas, el más largo del
canal). El arreglo del correo **sí se desplegó ese día**: commit `7a1b652c` en `legacy-backend`
(«feat: backend email restriction improvements», 2026-08-05 14:11) agrega
`regex:/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/` a `StorePersonalInfoRequest` y
`PersonalInfoRequest`.

**Arreglo.** El disparador está tapado (ya no entra un correo con tilde). **El falso aprobado NO**: si
Credifamilia responde `APROBADO` sin `valor_disponible_para_comprar` por cualquier otra causa, el
comportamiento se repite. Lo dijo el dev en el hilo: *«si bien nosotros no debemos dejar que pase un
correo con caracteres especiales, ellos no deben enviarnos un aprobado en falso»*. Una guarda simétrica
a la del rechazo —tratar `APROBADO` sin cupo como no-concluyente en vez de pre-aprobado— cerraría la
clase entera de fallas, no sólo la del correo.

**Estado:** verificado el 2026-08-07 contra `main`. **No verificado**: qué hace el front con un lender
`pre_approved_lender = true` y `available = null` (si esconde la card o la rompe) — el síntoma reportado
es «no sale la opción», pero no se ejercitó.

⚠ **La lección de método**: acá había TRES fallas encadenadas (correo → falso aprobado → límite de
intentos) y cada una explicaba el síntoma por sí sola. Cuando un caso tarda 35 mensajes en cerrarse, casi
siempre es esto: arreglar la primera capa hace que el síntoma cambie, no que desaparezca.

---

### F-114 · El cupo rotativo se calcula DOS veces con motores distintos: el que se muestra no es el que se otorga

**Síntoma.** «Las condiciones que vio el cliente en pantalla no son las del cupo que le quedó» — cuota
inicial distinta, FGA distinto, o un cupo que en pantalla existía y al confirmar es 0.

**Causa raíz** (verificada leyendo los dos cuerpos completos el 2026-08-07). Hay **dos
implementaciones independientes** del mismo cálculo:

- **La que OTORGA** — `legacy-application/app/Services/lenders/RevolvingLoanConfigService.php:30`, PHP.
  Es la que crea la fila de `revolving_credits`.
- **La que MUESTRA condiciones** — `legacy-backend/Modules/Loans/App/Services/RevolvingCreditsService.php:486`
  → `RevolvingCreditRepository.php:113` → `CALL SP_CreditopX_Revolving_Credit`, todo en SQL.

Divergen en cinco puntos, y **cada uno cambia el número por separado**:

| | PHP (otorga) | SQL (muestra) |
|---|---|---|
| función de multiplicador | `FN_CreditopX_Revolving_Credit_Multiplier` — 6 variables, incluye continuidad laboral | `FN_CreditopX_Profiling_Multiplier_Risk` — **otra función**, sólo Experian |
| deuda CreditOp en la capacidad | la **suma** (`+ ctop_debt`) | la **resta** |
| rechazo | `multiplier <= 3` → cupo 0 | **no rechaza** |
| redondeo | a 50.000 (`floor`) | a 10.000 (`TRUNCATE(x,-4)`) |
| nivel para cuota inicial/FGA | `(int) m` — trunca | `m=5 ? 5 : TRUNCATE(m,0)+1` — **redondea hacia arriba** |
| plazo mínimo | `ceil(cupo / capacidad)+1` | `trunc(max_rev_credit / capacidad)+1` |

El más visible en soporte es el último de la lista de arriba: con multiplicador **3,7**, el PHP lee la
fila del **nivel 3** y el SP la del **nivel 4** — distinta cuota inicial y distinto FGA para el mismo
cliente en la misma sesión.

**Evidencia.** Los dos cuerpos, leídos el 2026-08-07: el PHP en `main`; el SP por
`go run . -target dev -sql "SELECT routine_definition FROM information_schema.routines WHERE routine_name='SP_CreditopX_Revolving_Credit'"`.
El SP también está en `legacy-backend/migrate.sql`.

**Arreglo.** Ninguno aplicado. Lo primero no es unificar sino **decidir cuál es la intencionada**: el SP
tiene bloques comentados (la capacidad de endeudamiento, el redondeo viejo a 50.000) que sugieren que
quedó atrás, pero es el que alimenta la pantalla que ve el cliente.

**Estado:** verificado el 2026-08-07 contra `main` + prod. **No verificado**: si el front llama de verdad
al endpoint de condiciones en el flujo vivo, o si sólo lo usa el backoffice. Eso decide si el cliente
llega a ver los dos números o no.

---

### F-115 · Un rechazo de cupo rotativo no deja NINGÚN rastro: ni log, ni fila, ni estado

**Síntoma.** «Al cliente el rotativo le dio cupo 0 / no le salió la entidad» y no hay forma de contestar
por qué. El trazador muestra que entró y que no hubo cupo, y ahí se acaba.

**Causa raíz** (verificada). `RevolvingLoanConfigService.php:87`:

```php
if ($multiplier_results['multiplier'] <= 3) {
    return ['approved_limit' => 0, 'multiplier' => ..., 'initial_fee' => null, 'min_fee_number' => null];
}
```

El `return` sale **antes** de crear cualquier fila. Y cuatro líneas más arriba, `:85`, está el TODO sin
hacer: `//TODO guardar log con resultados`. La ironía es que el dato existe y es completo: la función
`FN_CreditopX_Revolving_Credit_Multiplier` devuelve un JSON con **el valor y el puntaje de las seis
variables** más el multiplicador final. Se decodifica en `:84`, se usa para comparar contra 3, y se
descarta.

O sea: el cómputo es auditable por construcción y **nadie lo persiste**.

**Evidencia.** El código citado. Y el lado negativo, medido: las rutinas SQL no escriben a Loki (nodo
`db-routines`), no hay fila en `revolving_credits`, y el rechazo no cambia el estado de la solicitud, así
que tampoco hay transición en `user_request_records`. Tres fuentes, las tres vacías.

**Arreglo.** No aplicado. Guardar el JSON del multiplicador —en una tabla propia o en el snapshot de
`profiling_reviews`— convertiría la pregunta «¿por qué le dio 0?» de imposible a trivial. Es el mismo
patrón que ya resolvió `profiling_reviews` para rt=2 (F-93).

**Estado:** verificado el 2026-08-07 contra `main`.

---

### F-116 · `ctop_debt` descarta las cuotas de los créditos CreditopX por precedencia de `??` en PHP

**Síntoma.** Ninguno visible. La capacidad de pago del rotativo sale más alta de lo que debería para
clientes que ya tienen cupo rotativo activo **y** créditos CreditopX vigentes.

**Causa raíz** (verificada). `legacy-application/app/Services/lenders/RevolvingLoanConfigService.php:35`:

```php
$ctop_debt = $revolvingLoanLimit?->installment_amount ?? 0 + $ctopxLoans?->sum('installment_value') ?? 0;
```

En PHP el `+` liga **más fuerte** que el `??`, así que eso se evalúa como:

```php
$revolvingLoanLimit?->installment_amount ?? (0 + $ctopxLoans?->sum('installment_value')) ?? 0
```

Si el cliente **ya tiene** un cupo rotativo activo, `installment_amount` no es null → el `??` corta ahí y
**la suma de las cuotas de los CreditopX nunca se agrega**. La intención («sumar las dos deudas») sólo se
cumple en el caso en que la primera es null.

Y el efecto va en la dirección peligrosa: `ctop_debt` **se suma** a la capacidad de pago (`:77`, para
des-contar la deuda que Experian ya trae doble). Perder un sumando ahí sube la capacidad, y la capacidad
multiplica el cupo.

**Evidencia.** El código citado, y la tabla de precedencia de PHP: aritméticos por encima de `??`. Es la
misma familia que el `min_income` NO-OP del nodo `profiling`: un bug que no rompe nada, no tira error y
cambia el número en silencio.

**Arreglo.** No aplicado — es un repo real. El arreglo es paréntesis:
`($a ?? 0) + ($b ?? 0)`. ⚠ Ojo: **arreglarlo baja los cupos** de los clientes con deuda CreditopX previa,
así que no es un cambio cosmético.

**Estado:** verificado el 2026-08-07 contra `main`. **No verificado**: cuántos clientes en producción caen
en el caso (cupo rotativo activo + créditos CreditopX vigentes).

---

### F-117 · Sin fuente de continuidad laboral, el rotativo castiga con 0 puntos — peor que el peor cliente

**Síntoma.** Clientes que «deberían» clasificar bien salen con multiplicador bajo, o directamente
rechazados por el corte `<= 3`, sin nada malo en el buró.

**Causa raíz** (verificada leyendo la función y midiendo la tabla de rangos). En
`FN_CreditopX_Revolving_Credit_Multiplier`, la variable `CONTINUITY` **pesa 20 sobre 100** (empatada en
segundo lugar con los créditos negativos vigentes) y sale de `agildata` o, si no hay, de `mareigua`. Si
no hay ninguna de las dos:

```sql
DECLARE value_CONTINUITY INT DEFAULT 0;
...
SET continuityValue = NULL;   -- ninguna fuente
SELECT value INTO value_CONTINUITY FROM ...rangs... WHERE continuityValue BETWEEN min AND max;
```

El `BETWEEN` con `NULL` no matchea ninguna fila, el `SELECT … INTO` no asigna, y la variable **conserva
su `DEFAULT 0`**. Pero el piso de la tabla de rangos es **1** (`continuidad 0 → 1 punto`): el 0 no es un
valor del dominio, es la marca de «no se pudo calcular». Con peso 20, **la ausencia de datos pesa más
que la peor continuidad posible**.

**Evidencia.** Cuerpo de la función leído desde dev el 2026-08-07. Los 22 rangos de
`creditop_x_profiling_multiplier_risk_rangs`, medidos en prod: todos los valores de puntaje son 1..5, sin
un solo 0 salvo la celda de score que documenta el hermano de este bug (`EXPERIAN_SCORE 1-300 → 0`).

**Arreglo.** No aplicado. Dos caminos, y no son equivalentes: agregar un rango que capture el NULL
(decisión de producto: ¿ausencia = 1 punto, o = neutro?), o **cortar antes** y no otorgar sin fuente de
continuidad, que al menos es explícito. Hoy se otorga igual, con la penalización escondida en un
`DEFAULT`.

**Estado:** verificado el 2026-08-07. **No verificado**: qué porcentaje de solicitudes rt=3 llega sin
`agildata` ni `mareigua`. Eso decide si es un caso de borde o el caso normal.

---

### F-118 · `category_rules_acceptance`: una clave AUSENTE no es un criterio que pasó, y la misma regla tiene dos grafías

**Síntoma.** Al leer por qué el perfilamiento rechazó a un cliente, el diagnóstico sale al revés:
«no tiene datos de buró» cuando lo que falló fue la continuidad laboral, o «este tier pasó todo» cuando
en realidad nunca se evaluó.

**Causa raíz** (verificada en el escritor y en datos de prod). `users_category_log.category_rules_acceptance`
es un JSON `{tier_id: {criterio: bool}}` y tiene **dos trampas de lectura**, las dos por cómo se escribe:

1. **La evaluación CORTA, y lo que cortó no deja clave.** `LenderUserCategoryService::evaluateEligibility:403`
   mide primero cinco criterios sin buró —ocupación, edad, ingreso, género, continuidad— y si alguno da
   `false` **retorna en `:425`** sin tocar Datacrédito. Un tier con 5 claves murió antes del buró; uno con
   11-12 llegó. Las claves que faltan **no pasaron: no se evaluaron**. Leerlas como «true» invierte el
   diagnóstico.
   ⚠ Y en Go la trampa es peor, porque el lenguaje colabora: `checks["datacredito"] == false` es **true
   cuando la clave no existe** (el cero del tipo). Hay que usar `_, ok := checks["datacredito"]`. Pasó
   escribiendo el lector del trazador: el tier 12 de la uReq 522511 salía «sin buró» y lo que falló era
   `employment_continuity`.
2. **La misma regla se escribe de DOS formas.** Hay **dos clases llamadas `LenderUserCategoryService`**:
   `Modules/Loans/App/Services/LenderUserCategoryService.php:407` escribe `occupation` y
   `Modules/Onboarding/App/Services/lenders/LenderUserCategoryService.php:93` escribe **`ocupations`**.
   Un parser que busque una sola queda ciego a las filas del otro escritor, en silencio.

Y hay **dos claves de nivel raíz** que no son tiers y hay que descartar antes de iterar:
`blacklisted` (documento en la lista negra de esa entidad, `CreditopXBlacklistedDocument::isBlacklisted`)
y `validacion_venezolanos`. Ver F-120 para la segunda.

**Evidencia.** Los dos escritores. El decodificador del backoffice
(`Modules/Backoffice/App/Services/ApplicationsService.php:1432`), que ya documenta el corte y las dos
banderas. Y filas de prod del 2026-08-06: el lender 167 escribe `"ocupations"` y los lenders 94 y 46
escriben `"occupation"`, en el mismo día.

**Arreglo.** El lector del trazador ya respeta las dos reglas (`trazador/server/fuentes.go`
`GetCategorias`). En el producto no se tocó nada: unificar la grafía es un cambio a un repo real y
rompería a quien ya parsea la forma vieja.

**Estado:** verificado el 2026-08-07 contra `main` + prod.

---

### F-119 · `loan_limit` es un cupo «mensual» que nunca se reinicia: la categoría desaparece sola y sin aviso

**Síntoma.** «Esta entidad dejó de salirle a todos los clientes de este comercio», sin deploy, sin
cambio de configuración y sin error.

**Causa raíz** (verificada). `lender_users_categories.loan_limit` es, según la documentación de negocio,
el *«monto total disponible para colocar **mensualmente** por categoría»* [Confluence · *Preguntas
frecuentes*, v15]. En el motor es uno de los cuatro topes del cupo: `loan_limit − already_used_loan`
(`LenderUserCategoryService::calculateAvailableAmountWithInitialFee:491`). Cuando el consumido alcanza al
tope, el cupo disponible da ≤ 0 y **la entidad se saca del marketplace** — el mismo `unset` que cualquier
otro rechazo, sin mensaje distinguible.

El problema es que **el contador sólo sube**:

- se incrementa al desembolsar, y sólo en rt=2:
  `Modules/Loans/App/Services/CreditopXRequestHistoryService.php:415` `$category->already_used_loan += $userRequest->final_amount;`
- **no hay ningún cron, comando ni job que lo reinicie.** Grepeado en `app/Console` y `routes` de los dos
  repos: cero. El propio documento de negocio lo admite: *«se debe validar con negocio si corresponde
  reiniciar. El reinicio se realiza estableciendo el campo `already_used_loan` en NULL»* — o sea, a mano.

Así que un tope pensado como presupuesto **mensual** está implementado como acumulado **de por vida**.

**Evidencia.** El código citado. Y la medición en prod del 2026-08-07, que es la que da la dimensión real:
de **202 categorías**, ninguna está agotada y ninguna pasa el 80 %; 176 tienen `already_used_loan = 0` y
**26 acumulan, la mayor en 34,3 %** de su `loan_limit`. O sea: **no es una falla activa, es una que se
acerca sola** — el contador no puede bajar sin intervención humana.

**Arreglo.** Ninguno aplicado. Lo barato no es el reset automático (decidir el período es de negocio):
es una **alerta** cuando una categoría cruza el 80 %, porque hoy el evento se manifiesta como «la entidad
desapareció» y no como «se agotó el cupo del mes».

**Estado:** verificado el 2026-08-07 contra `main` + prod.

---

### F-120 · Un documento CE en el lender 84 SALTA todo el motor de reglas y recibe una categoría fija

**Síntoma.** Ninguno reportado — se encontró leyendo el escritor de `category_rules_acceptance`. Aparece
como una fila de log con la bandera `validacion_venezolanos` y sin ninguna evaluación de tiers.

⚠ **El árbol YA tenía este hardcode** (`hardcodes-entidades`, fila «Magnocell + CE»), descrito como
«bypass del gate datacrédito». Esta entrada lo CORRIGE hacia arriba: no salta el gate del buró, salta el
**motor de reglas completo**.

**Causa raíz** (verificada). `Modules/Onboarding/App/Services/lenders/LenderUserCategoryService.php:40`:

```php
//Valida para magnocell si es venezolano, de ser as.. salta reglas  y pone 2da categoria
if ($user->document_type == "CE" && $lender_id == 84) {
    $lenderUserCategory = LenderUsersCategory::find(22);
    $acceptances["validacion_venezolanos"] = true;
    ...
    return $lenderUserCategory;
}
```

Dos cosas, y las dos importan:

- **Es un hardcode de entidad y de categoría**: `lender_id == 84` y `find(22)` literales. Va al nodo
  `hardcodes-entidades`.
- **Salta el motor entero.** No evalúa ningún tier: asigna la categoría 22 y retorna. O sea que para ese
  par (documento extranjero, lender 84) **las políticas de riesgo configuradas no se aplican**, ni las
  duras ni las de buró.

⚠ Y una asimetría en el propio log: la fila se escribe con `current_available_amount = 0` mientras el
objeto que se devuelve **sí trae** `available_amount` calculado. El registro dice cupo 0 y el cliente
recibe cupo. Cualquier reporte que sume esa columna va a subcontar este caso.

**Evidencia.** El código citado. El gemelo en `Modules/Loans/…/LenderUserCategoryService.php:368` tiene el
mismo bloque **comentado**, o sea que el camino nuevo no lo lleva: los dos motores tratan distinto al
mismo cliente según cuál lo evalúe.

**Arreglo.** Ninguno. Antes de tocarlo hay que preguntar: si la intención es una política más laxa para
documento extranjero, eso se expresa como un tier con `occupation`/`min_score` propios y queda auditable
—hoy la decisión no deja rastro de por qué se otorgó—.

**Estado:** verificado el 2026-08-07 contra `main`. **No verificado**: cuántas solicitudes de prod
llevan la bandera, y si el lender 84 sigue activo.

---

### F-121 · El pagaré es un PDF congelado y el cliente es una referencia viva: pueden decir personas distintas, y nada lo detecta

**Síntoma.** El pagaré firmado está a nombre de una persona y el dashboard y la BD muestran otra, para
la misma solicitud. Pasó en producción en **diciembre de 2025** (post mortem cerrado el 2026-01-09).

**Causa raíz** (verificada en el modelo y en el esquema de prod). `promissory_notes` **no guarda los datos
del firmante**: guarda `promissory_note_url` —el PDF ya generado— más `user_id` y `user_request_id`
(`legacy-backend/app/Models/PromissoryNote.php:14-24`). O sea:

- el **PDF** es un snapshot congelado en el instante de la firma;
- el **`user_id`** es un puntero vivo a `users`, cuyos datos de identidad **se pueden editar después**.

Editar el nombre o el documento del usuario después de firmar deja el documento legal y el registro
apuntando a personas distintas, **sin ningún error y sin ninguna alerta**. Y no es hipotético: el
procedimiento manual que causó el incidente consistía literalmente en *«registrar un usuario con datos
personales… modificar posteriormente los datos para asociarlos al usuario final»*.

⚠ Lo que lo vuelve grave no es el desfase sino que **es indetectable después del hecho**: medido en prod
el 2026-08-07, **no existe ninguna tabla de auditoría de `users`** (las únicas `*_history` del esquema son
del ledger de CreditopX). No hay forma de preguntarle a la BD quién cambió qué ni cuándo. El incidente de
diciembre se encontró **abriendo el PDF y comparando a ojo**.

Dos causas contribuyentes que el propio post mortem nombra y que siguen vivas: el flujo **no valida** que
el usuario ya tenga solicitudes previas antes de dejar continuar, y no hay procedimiento formal para
registros manuales en producción.

**Evidencia.** El modelo citado. El censo de tablas de prod (0 tablas de auditoría de `users`).
Confluence · *Post Mortem: Inconsistencias en Registro Manual de Solicitud en Producción por Error
Humano*, v3, estado **Cerrado** — cerrado el ticket, no el mecanismo.

**Arreglo.** Ninguno aplicado. Lo mínimo que cierra el agujero de detección es barato: **congelar en
`promissory_notes` el documento y el nombre del firmante** en el momento de generar el PDF. Con eso la
discrepancia pasa de invisible a una comparación de dos columnas. La validación de «este usuario ya tiene
solicitudes» es otro cambio, y más invasivo.

**Estado:** verificado el 2026-08-07 contra `main` + prod. **No verificado**: si hoy existe algún camino
en el backoffice que permita editar documento/nombre de un usuario con crédito desembolsado — el post
mortem describe el procedimiento manual, no la superficie de UI que lo permite.

---

### F-122 · El mismo guard de Deceval usa `||` en un repo y `&&` en el otro: en `legacy-application` NUNCA detecta un rechazo

**Síntoma.** El cliente firma —o cree que firma— y el proceso revienta más adelante con un error que no
se parece a la causa: un null pointer, o un pagaré creado con «cuenta de girador 0» que Deceval rechaza
después. El rechazo real ocurrió varios pasos antes y nadie lo vio.

**Causa raíz** (verificada leyendo las dos versiones el 2026-08-07). Después de `createGirador` hay que
comprobar si Deceval respondió `exitoso=true`. Los dos repos escriben el mismo chequeo con distinto
operador:

```php
// legacy-backend · Modules/Loans/App/Actions/DecevalSoap.php:352 — CORRECTO
if ($successfulResponses->count() === 0 || $successfulResponses->item(0)->textContent !== 'true') {

// legacy-application · app/Actions/DecevalSoap.php:294 — IMPOSIBLE
if ($successfulResponses->count() === 0 && $successfulResponses->item(0)->textContent !== 'true') {
```

Con `&&` el guard **no puede detectar un rechazo**: si hay respuesta (`count() > 0`), la primera
condición ya es falsa y el `&&` corta — el `exitoso=false` nunca se mira. La única rama que dispara es
`count() === 0`, y ahí `item(0)` es `null`, o sea que el chequeo que sí corre es el que además accede a
una propiedad de null. **La condición está escrita al revés de lo que necesita.**

⚠ El caso concreto que lo destapa es el conflicto de identidad `SDL.DA.0439`: Deceval responde
`exitoso=false` con `cuentaGirador = 0`, el guard lo deja pasar, y el flujo sigue hasta crear el pagaré
con cuenta 0 — que falla con `SDL.DA.0388`, un error que no menciona la identidad por ningún lado.

Y **no es un solo lugar**: el mismo patrón aparece en `application/app/Actions/DecevalSoap.php:294` (el
girador) y `:408` (el pagaré).

**Evidencia.** Las dos versiones en `main` de cada repo. El camino de `legacy-application` **está vivo**:
`routes/customer.php:79-84` sirve la vista previa y la firma, y `PromissoryNoteController` /
`ValidateOtpPromissoryNoteController` instancian la factory. La documentación de negocio lo describe como
historia («el guard del monolito era `count()===0 && !==true` — nunca validó `exitoso`»), pero está en
presente en el código.

**Arreglo.** No aplicado — es un repo real. Es cambiar `&&` por `||` en dos lugares. ⚠ Y el arreglo
**hace aparecer errores que hoy no se ven**: casos que llegaban lejos y morían confusamente van a fallar
temprano y claro, que es lo que se quiere, pero cambia lo que ve soporte.

**Estado:** verificado el 2026-08-07 contra `main` de los dos repos. **No verificado**: qué proporción
del tráfico de pagarés Deceval sirve hoy `legacy-application` contra `legacy-backend` — de eso depende
si es una falla latente o activa.

⚠ **La lección general, que vale más que el bug**: durante una migración strangler, el código migrado y
el original **divergen en silencio**. Acá el arreglo se hizo del lado nuevo y el viejo —que sigue
sirviendo tráfico— quedó con el defecto. Al leer un comportamiento en el repo migrado, **no asumir que el
otro hace lo mismo**: es el mismo patrón que las dos implementaciones del rotativo (F-114) y las dos
convenciones de tasa (F-71).

---
