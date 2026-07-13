# Hallazgos de validación — dónde tocar el backend

> Bitácora de los **touch points** del backend descubiertos validando flujos en vivo.
> Los experimentos viven en la rama **local** `test` de `github/legacy-backend`
> (creada desde `mock-onboarding`, **no se pushea**). Cada hallazgo: causa raíz, dónde,
> fix propuesto, y cómo se validó.

| # | Flujo afectado | Tipo | Estado |
|---|---|---|---|
| 1 | Marketplace de lenders · crear comercio/branch (logos/QR a S3) | Entorno local | Destrabado (workaround) |
| 2 | Crear comercio · crear branch | **Bug real** | Destrabado (fix) |
| 3 | `personal-info` (continuación del onboarding) | **Bug real** | Destrabado (fix 1 línea) |
| 4 | Respuestas de error (Creditop X acceptance/promissory y más) | **Bug real** | Destrabado (fix `error()`) |
| 5 | Firma Creditop X (acceptance/promissory · scoring) | Migración sin correr | Destrabado (migración targeted) |
| 6 | Cierre de firma Creditop X (send-otp/verify-otp/authorize → desembolso) | 2 bugs reales + 6 guards locales | **Completo → status 11** (test E2E) |
| 7 | Cierre async de integración (Credifamilia · polling) | Guard local (show) + esquema del mock | **Completo → CREDIT_APPROVED** (test) |
| 8 | Cierre de Sistecrédito (redirect + webhook) | **Bug real (ruta sin registrar)** + 2 guards locales | **Completo → status 11** (test) |
| 9 | Cierre de Welli (polling por job en background) | 3 guards locales (register/status/clinic) | **Completo → status 11** (test) |
| 10 | Cierre Compensar (#47, OTP bifurcado) · BdB #5 (D-like) | guards locales | Compensar **completo** (test) · BdB E2E diferido |
| 11 | Webhooks Payvalida (#8) + Approbe (#41) | **4 bugs reales** + guards locales | **Completo → status 11** (tests) |

---

## ⭐ Inventario de cambios en la rama `test` (qué portar a PR vs qué es solo local)

> La rama `test` (de `github/legacy-backend`, **local, no se pushea**) acumula **23 archivos**
> cambiados (6 commits de esta tanda + los hallazgos #1–#4 del commit `test` previo). Se separan en
> **(A) bugs reales** que afectan prod → **candidatos a PR**, y **(B) guards locales** (solo
> `app()->environment('local','development')`) que **NO deben ir a prod** — son andamiaje para poder
> correr los flujos sin los servicios externos. Verificar siempre con `git diff` antes de portar.

**(A) BUGS REALES — portar a PR (afectan producción):**

| Archivo:línea | Bug / fix | Hallazgo |
|---|---|---|
| `Modules/Partner/App/Services/AlliedManagementService.php` (~305, ~788) | `front_url` es JSON casteado a array y se concatena como string → 422 al crear comercio/branch. Fix: extraer `['url']`. | #2 |
| `app/Notifications/Errors/ExceptionNotification.php:16` | `__construct(\Exception)` → debe ser `\Throwable` (recibe `\Error` desde `catch(\Throwable)`). **✅ YA MERGEADO/RESUELTO** en legacy-backend (commit `ea4adda3` "fix: exception"; `ExceptionNotification.php:16` ya es `__construct(\Throwable $exception, …)`). | #3 |
| `app/Traits/ApiResponse.php` (`error()`) | acepta `$e->getCode()` (SQLSTATE) como status HTTP → 500 que enmascara. Castea + valida 100–599. | #4 |
| `Modules/Loans/App/Services/CreditopXRequestHistoryService.php:1039` | `logAndNotifyError(\Exception)` → `\Throwable` (recurrencia de #3; enmascaraba el ledger). **✅ YA MERGEADO/RESUELTO** en legacy-backend (commit `ea4adda3`; la firma ya es `logAndNotifyError(\Throwable $exception, …)`). | #6 |
| ~~`app/Actions/RiskCentrals/Experian.php:184` · `new ExceptionNotification($errorMessage)` (string)~~ | **Cita superada/retirada:** en el `Experian.php` actual no existe `$errorMessage` ni ninguna llamada `new ExceptionNotification(...)` con string (las llamadas de la familia pasan el objeto `$exception`), y `:184` no es un `catch` sino una línea del log de config. No hay bug pendiente aquí. | #6 |
| `Modules/Risk/routes/api.php` | **ruta `api.sistecredito.webhook` sin registrar** (referenciada en `SistecreditoPay::register`) → `RouteNotFoundException`. | #8 |
| `routes/api.php` | **rutas `api.payvalida.webhook` y `api.approbe.webhook` sin registrar** (controllers existían). | #11 |
| `app/Http/Controllers/Api/PayvalidaController.php:6` y `ApprobeController.php:7` | importan `App\Http\Controllers\Customer\ProfilingReviewController` (NO existe) → debe ser `Modules\Risk\App\Http\Controllers\Customer\ProfilingReviewController`; el `\Error` no lo atrapa el `catch(\Exception)`. | #11 |

> Sugerencia de PR adicional (no aplicado): cambiar los `catch (\Exception)` que envuelven
> `generateVoucher`/`updateDisbursedLender`/notificaciones por `catch (\Throwable)` en los webhooks
> (Sistecrédito/Payvalida/Approbe) — misma familia que #3, evitan 500 enmascarados.

**(B) GUARDS LOCALES — NO portar (solo entorno local/dev):** simulan/evitan servicios externos
no disponibles en local. Todos bajo `if (app()->environment('local','development'))`.

| Archivo | Qué simula/evita en local | Hallazgo |
|---|---|---|
| `app/Actions/RiskCentrals/Experian.php` (`useMock`) | usa el fixture de Experian (genera `datacredito_score`) sin host real | #6 |
| `Modules/Loans/App/Services/OtpService.php` (`sendWhatsAppViaTwilio`) | OTP del pagaré: salta el envío Twilio (cuelga 60s) → crea la fila en `otps` | #6 |
| `Modules/Loans/App/Repositories/TwilioNotificationRepository.php`, `SnsNotificationRepository.php` | notificaciones SMS/WhatsApp: fake (cuelgan sin creds) | #6 |
| `app/Notifications/CreditopX/PromissoryNoteEmailNotification.php`, `Customer/VoucherEmailNotification.php` | no adjuntan URLs remotas de PDFs (el `fopen` del `attach` cuelga 60s) | #6/#10 |
| `Modules/Loans/App/Services/RequestCompletionService.php` (`cleanupTempFiles`) | salta `Storage::disk('s3')->delete` (cuelga 60s contra AWS) | #6 |
| `app/Actions/Lenders/Credifamilia.php` (`show`) | lee el estado del `response` almacenado (sin OAuth/cert/POST estado) | #7 |
| `Modules/Risk/App/Http/Controllers/Api/SistecreditoController.php` (`webhook`) | lee el estado del `response` almacenado (sin `GetTransactionResponse`) | #8 |
| `app/Actions/Lenders/Welli.php` (`register`/`fetchCreditStatus`/`changeClinic`) | simula `run_risk` ('desembolsado'), lee response almacenado, no-op clinic | #9 |
| `app/Actions/Lenders/Compensar.php` (`register`/`validate`) | simula `generacionOtp` y crea la transacción `Disbursed` | #10 |
| `app/Actions/Lenders/BancoDeBogota.php` (`register`/`updateStatus`) | simula 'Disbursed' + lee response almacenado (E2E no reproducido) | #10 |
| `app/Http/Controllers/Api/PayvalidaController.php`, `ApprobeController.php` (parte del webhook) | leen el estado del `response` almacenado (sin GET/POST externo) | #11 |
| `app/Http/Requests/Api/Payvalida/WebhookRequest.php`, `Approbe/WebhookRequest.php` | `authorize()` saltea el checksum (SHA256/encriptado) | #11 |

**(C) WORKAROUND / MIGRACIÓN DE ENTORNO (no es código de prod):**

| Cambio | Qué | Hallazgo |
|---|---|---|
| `config/filesystems.php` | disco `s3` cae a `local` cuando `AWS_BUCKET` está vacío | #1 |
| (BD, no archivo) | correr **solo** las 3 migraciones de scoring de Creditop X vía `--path` | #5 |
| (config, `make mock-all`) | drivers fake de onboarding (`ONBOARDING_DRIVER_*=fake`) en `.env` + restart | #6 |

---

## #1 · `Storage::disk('s3')` revienta sin S3 local — *entorno*

**Síntoma:** `GET /onboarding/loan-application/lenders/{id}` → 500
`AwsS3V3Adapter::__construct(): Argument #2 ($bucket) must be of type string, null given`.
Igual en crear comercio/branch (suben el QR a S3).

**Causa:** el código hace `Storage::disk('s3')` **hardcodeado** (logos de lenders, QR),
pero local tiene `FILESYSTEM_DISK=local` y `AWS_BUCKET`/`AWS_ENDPOINT` **vacíos**. El
`ministack` (S3 emulado) corre pero está en otra red (`bridge`), **no alcanzable** desde
la app. No es un bug de prod (prod sí tiene S3); es una **brecha de entorno local**.

**Dónde:** todas las llamadas `Storage::disk('s3')` (ej. `AlliedManagementService`,
listado de lenders).

**Workaround (rama test):** `config/filesystems.php` → el disco `s3` cae a `local`
cuando `AWS_BUCKET` está vacío.

**Fix real (a decidir):** (a) conectar `ministack` a la red de la app + crear el bucket
+ setear `AWS_ENDPOINT/AWS_BUCKET/use_path_style`; o (b) que estos puntos usen un disco
configurable y caigan a `local` en dev.

**Validado:** tras el workaround, `lenders/{id}` y `lenders-v2/{id}` → **200** (devuelven
los lenders del comercio: 2 y 3 de 3 configurados).

---

## #2 · `front_url` es JSON pero se concatena como string — **bug real**

**Síntoma:** crear comercio / crear branch → 422 `Array to string conversion`.

**Causa:** los settings `front_url` / `front_url_local` están guardados como **JSON**
`{ "url": "https://aliados.creditop.com/" }` y el modelo `Setting` castea `value` a
**array** → `getValue('front_url')` devuelve `['url' => '...']`. El servicio lo concatena
como string:
```php
$front_url = $this->settingRepository->getValue('front_url'); // ← array
$urlData = $front_url . 'aliados/onboarding' . '?allied=' . $slug; // ← Array to string
```

**Dónde (2 lugares):**
- `Modules/Partner/App/Services/AlliedManagementService.php:~305` (`storeAlliedBranch`)
- `Modules/Partner/App/Services/AlliedManagementService.php:~788` (crear allied)

**Fix real:** extraer la url del array →
```php
if (is_array($front_url)) { $front_url = $front_url['url'] ?? ''; }
```
(O normalizar `getValue` / el cast del setting. Este bug afecta a **prod también**, no
solo local — crear comercio/branch por API está roto.)

**Validado:** tras el fix, crear branch → **200** ("BR_…"), crear comercio → **200** (#263).

---

## #3 · `personal-info` da 500 — `ExceptionNotification` mal tipado enmascara todo — **bug real**

**Síntoma:** `POST /onboarding/loan-application/personal-info/{branch}/{id}` → **500**
(cortaba toda la continuación del onboarding: personal → laboral → lenders → firma).

**Causa raíz:** `app/Notifications/Errors/ExceptionNotification.php:16` tenía
`__construct(\Exception $exception)`, pero los `catch(\Throwable $e)` de
`app/Actions/RiskCentrals/Tusdatos.php` (líneas 125, 149, **168**, 227) le pasan el
throwable. Cuando ese throwable es un `\Error` (ej. **TypeError**) — que es `\Throwable`
pero **no** `\Exception` — construir `ExceptionNotification` lanza un TypeError **dentro
del catch** → 500 sin manejar, que **enmascara el error real** y mata el flujo.

**Dónde:** `app/Notifications/Errors/ExceptionNotification.php:16`.

**Fix real (1 línea):**
```php
public function __construct(\Throwable $exception, $user_request = null) // antes: \Exception
```
Arregla **todos** los `catch(\Throwable)->notify(new ExceptionNotification(...))` del
código (no solo Tusdatos): ahora el catch puede reportar con gracia en vez de tirar 500.

**Validado:** `personal-info` pasó de **500 → 200**, KYC mock OK y **persistió los datos
reales** del cliente (`TEMP-… / TEMPORAL USER` → `1020083965 / JUAN PRUEBA`). El flujo
avanza al paso de **laboral** (ONB004). El `user_request_status_id` sigue en 9
("Formulario de perfil") porque esa etapa abarca personal + laboral.

---

## Validado tras los fixes (sin nuevos bugs)

- **`laboral-info`** → 200 "laboral information stored". Funciona sin tocar nada (el
  bloqueo era el de personal-info). El `status` queda en 9 hasta elegir entidad.
- **Marketplace** (`GET lenders-v2/{id}`) post personal+laboral → 200, devuelve **solo
  los lenders del comercio**. Ej. Patprimo (config: Bancolombia BNPL, Addi, Sistecrédito):
  v2 lista los 3; v1 lista 2 (descarta Bancolombia BNPL → **las reglas se aplican**).
  Cubierto por `tests/marketplace.test.ts` (auto-skip si el backend no tiene S3).
- **Seleccionar entidad** (`POST update-user-request/{id}` con `lender_id`+`amount`+
  `fee_number`) → `user_request_status_id = 3` (Seleccionó entidad), setea el lender.
  Validado en las dos ramas del negocio:
  - **Integración** (Sistecrédito #9): devuelve `url` al portal del lender → flujo externo/async.
  - **Creditop X** (Mediarte X #54, comercio Mediarte Tunja #149): `standBy: true` +
    link de WhatsApp → continúa **in-platform** (validar identidad → firma).

## #4 · `error()` revienta con status no-HTTP — **bug real**

**Síntoma:** `GET /loans/requests/acceptance/{id}` y `promissory-note/{id}` → **500**
`ApiController::error(): Argument #2 ($status) must be of type int, string given`; tras
forzar int → `The HTTP status code "42" is not valid`.

**Causa:** `app/Traits/ApiResponse.php::error(string $message, int $status=400, …)`. Algún
controller hace `$this->error($e->getMessage(), $e->getCode())` y el `getCode()` de una
`PDOException` es un **SQLSTATE** (`"42S02"`) → `(int)"42S02" = 42` → no es código HTTP →
Symfony lanza → **500 que enmascara el error real**. (Mismo patrón de tipos que #3.)

**Fix (rama test):** `error()` acepta `int|string`, castea, y si no es código HTTP válido
(100–599) usa 400 y mueve el código a `errors`. Real: los callers no deben pasar
`$e->getCode()` como status HTTP.

**Validado:** acceptance/promissory pasaron de 500 → 400 con el **mensaje real** (ver #5).

## #5 · Firma Creditop X bloqueada por migraciones sin correr — *entorno*

**Síntoma (ya sin máscara):** `Table 'creditop.lender_user_fields_scoring_policy' doesn't exist`.

**Causa:** la firma Creditop X (`acceptance`/`promissory-note` → `LenderUserCategoryService`)
usa las tablas de scoring de Creditop X (`lender_user_fields_scoring_policy`,
`lender_payment_capacity_scoring_policy`, `lender_user_category_scoring_policy_rules`). Las
**migraciones existen** (feb-2026) pero **no se corrieron**: la BD local tiene **61
migraciones pendientes**.

**Resuelto (rama test):** `php artisan migrate` **completo falla** — la BD local se montó
desde un **dump SQL** (las tablas existen pero la tabla `migrations` está atrás), así que
la 1ª migración choca con `product_categories already exists`. Pivot: correr **solo las 3
migraciones de scoring** vía `--path` (esas tablas sí faltaban) → DONE sin dependencias.

**Validado:** `acceptance/{id}` → 200 (datos del pagaré) y `promissory-note/{id}` → 200
(con PDF de consentimiento generado, a storage local por el fallback #1). La firma Creditop
X queda alcanzable. Falta el cierre: `validate/send-otp → verify-otp → authorize` (desembolso).

> Aprendizaje: la BD local no está migrada incrementalmente; viene de un dump. Para alinear
> el esquema hay que correr migraciones **targeted** (`--path`), no `migrate` a secas.

## #6 · Cierre de firma Creditop X COMPLETO → status 11 (Desembolsada)

**Logrado:** el flujo real `send-otp → verify-otp → authorize → status 11` corre E2E en local.
Fijado en **`tests/firma.test.ts`** (cierre completo + verify-otp rechaza código incorrecto).

**El OTP del pagaré NO está fakeado.** A diferencia del OTP de onboarding (en `local` es
`1111`), el de Loans (`OtpService.php:37`) es `mt_rand(100000,999999)` guardado **encriptado**
(`Crypt::encryptString`, AES-256-CBC); `verify-otp` compara contra el valor **desencriptado** de
`otps`. El test lee la fila y la **desencripta** con el APP_KEY (`helpers.readLatestOtp`) — la
API no expone el código — para ejercitar el `verify-otp` REAL.

**Para reaching el desembolso hubo que entender la tubería de originación** (cada capa exige el
estado que produce el flujo real, no atajos): originar en un branch **SOLO Creditop X**
(`helpers.findCleanCxBranch`) evita que `personal-info` consulte lenders externos (Meddipay #39);
fijar lender + términos (rate/fee_number) evita división por cero en `PaymentCalculationService`;
generar `acceptance` + `promissory-note` crea el pagaré que exige `authorize`; el scoring asigna
la **categoría** (necesita `datacredito_score`); y `authorize` usa UA móvil (el backend bloquea
"desktop" vía `RedirectIdValidationIfDesktop`).

### Cambios en el backend (rama `test`) — 2 bugs reales + 6 guards locales

**Bugs reales (candidatos a PR):**
- **`CreditopXRequestHistoryService::logAndNotifyError(Exception → \Throwable)`** — recurrencia
  del **bug #3**: el `catch (\Throwable)` de `createFirstRegister` le pasaba un `\Error` →
  TypeError que enmascaraba el error real del ledger. (Una vez desenmascarado: el `\Error` real
  era `already_used_loan on null` porque sin `datacredito_score` no se asignaba categoría.)
  **✅ YA MERGEADO/RESUELTO** en legacy-backend (commit `ea4adda3` "fix: exception"; la firma ya
  es `logAndNotifyError(\Throwable $exception, …)`). Ya no es candidato a PR.
- ~~**`Experian.php:184`** — `new ExceptionNotification($errorMessage)` (string)~~ — **cita
  superada/retirada:** el `Experian.php` actual no tiene `$errorMessage` ni ninguna llamada
  `new ExceptionNotification(...)` con string, y `:184` no es un `catch`. No hay bug pendiente aquí.

**Guards locales `app()->environment('local','development')` (entorno, no prod):** completan el
sistema de fakes para lo que la rama `test` aún no cubría:
- `Experian.php` — auto-usa el fixture (`ExperianFixture`) en local sin host real → produce el
  `datacredito_score` que el scoring/categoría necesitan (antes: crash → score null).
- `OtpService::sendWhatsAppViaTwilio` y `TwilioNotificationRepository::sendNotification` y
  `SnsNotificationRepository::sendNotification` — el envío real cuelga ~60s sin credenciales;
  devuelven fake. Esto **destraba el send-otp real** (crea la fila en `otps`) y acelera las
  notificaciones post-commit.
- `PromissoryNoteEmailNotification` — no adjunta URLs remotas en local (el `fopen` colgaba ~60s).
- `RequestCompletionService::cleanupTempFiles` — salta el `Storage::disk('s3')->delete` (cuelga
  ~60s contra AWS S3 real).

> **Nota de entorno:** `make mock-all` (drivers fake de onboarding) debe estar activo. El server
> es `artisan serve` **single-threaded**: dejar que `authorize` termine su respuesta (no abortarla)
> evita congestionar requests siguientes.

## #7 · Cierre async de integración (Credifamilia) — polling validado en local

A diferencia de Creditop X (originación propia → desembolso in-platform), los lenders de
**integración** (response_type=1) los decide/fondea un **tercero**. El cierre desde Creditop es:
seleccionar lender → `register()` (externo, crea `lender_transactions`) → **polling**
`GET /onboarding/loan-application/lenders/{id}/{lender}/pre-approval-status` → cuando el lender
aprueba, mapea a **CREDIT_APPROVED (status_id 41)** y entrega la URL para continuar **en la
plataforma del lender**. No hay desembolso in-platform.

- **Guard local (`app/Actions/Lenders/Credifamilia.php::show()`):** en `local/development`,
  en vez de OAuth + POST de estado (con cert/key, no disponibles), toma la decisión async del
  `response` **YA almacenado** en la transacción (lo que la API del lender devolvería). El mapeo
  status→status_id (1/2→40, 3→41, 4→42) y `updateAsyncLender` corren igual.
- **Esquema del mock (CLI):** `lender_transactions` usa **`status_id`** (no `status`); el helper
  `db.mockCredifamiliaTransaction` insertaba `status` → fallaba en silencio. Corregido: inserta
  con `status_id` + un `response` JSON aprobado (`{status:3,status_detail:'APROBADO',…}`), `order_id`
  único por request (hay UNIQUE en `lender_id+order_id`).
- **Validado:** `tests/integracion.test.ts` — el polling reporta `is_approved=true` y deja la
  transacción en 41 (APROBADO), y `is_approved=false` → 42 (RECHAZADO). La decisión del lender se
  inyecta como `response` (es genuinamente externa, no producible en local).

## #8 · Cierre de Sistecrédito (#9) — redirect + webhook, validado en local

Sistecrédito es integración (response_type=1) pero **distinto de Credifamilia**: no hace polling
activo — redirige a su pasarela (`register()` → URL) y notifica de vuelta por un **webhook**
(`SistecreditoController::webhook`). El handler consulta el estado (`GetTransactionResponse`) y
mapea: `Approved` → user_request **status 11 (AUTORIZADA)** + voucher; `Pending/Started` → 10;
`Failed/Rejected/Expired/Abandoned` → 6; `Cancelled` → 8. (El lender fondea; el "desembolso"
desde Creditop es marcar 11.)

- **Bug real (candidato a PR):** la ruta `api.sistecredito.webhook` estaba **referenciada** en
  `SistecreditoPay::register()` (`urlConfirmation => route('api.sistecredito.webhook')`) pero
  **NO registrada** en ningún `routes/*.php` → `RouteNotFoundException` al originar Sistecrédito-Pay.
  Definida en `Modules/Risk/routes/api.php` (`POST /api/risk/sistecredito/webhook`).
- **Guards locales:**
  - `SistecreditoController::webhook()`: en local toma la decisión del gateway del `response` YA
    almacenado en la transacción (sin credenciales ni `GetTransactionResponse` externo).
  - `VoucherEmailNotification`: no adjunta la URL remota del voucher en local (el `fopen` del
    `attach()` cuelga ~60s — mismo patrón que el email del pagaré en #6).

> **Bug latente relacionado (misma familia que #3/#6):** el `catch (Exception)` del branch
> `Approved` del webhook **no atrapa** un `\Error`/TypeError (p.ej. `sendVoucherEmail(null)` si el
> usuario no tiene email) → 500. Debería ser `catch (\Throwable)`. (En el test damos email al
> usuario, así que no se dispara.)

- **Validado:** `tests/sistecredito.test.ts` — webhook `Approved` → user_request 11 (AUTORIZADA)
  y transacción 15; `Rejected` → no autoriza (transacción 13).

## #9 · Cierre de Welli (#23) — polling por JOB en background, validado en local

3er patrón de integración (≠ Credifamilia endpoint de polling, ≠ Sistecrédito webhook). Al
**seleccionar** Welli (`update-user-request`, `UserRequestService` case 23): `register()` →
`POST run_risk` (externo) crea `lender_transactions` y **despacha el job `StatusCheck`** (queue
`sync` → corre **inline**) → `updateStatus()` consulta `GET get_app` y mapea (`Welli::STATUS_MAP`)
el estado del lender → `user_request_status_id`. `'desembolsado'`/`'fulfilled'`/`'pendiente_
desembolso'` → **11 (AUTORIZADA)**; `'rejected'` → 6; etc. (No hay endpoint HTTP de status: el
cierre se dispara desde la selección + el job.)

- **Guards locales** (`app/Actions/Lenders/Welli.php`, `local/development`):
  - `register()`: simula la respuesta de `run_risk` (`estado='desembolsado'`) sin pegar al externo.
  - `fetchCreditStatus()`: lee el `response` YA almacenado en la transacción (en vez de `get_app`).
  - `changeClinic()`: no-op.
  - El job `StatusCheck` con `'desembolsado'` (estado final) se detiene en una iteración (no loop).
- **Validado:** `tests/welli.test.ts` — seleccionar Welli deja la transacción en 'desembolsado'
  (30) y el `user_request` en **11 (AUTORIZADA)**.

> Nota: con `queue=sync`, `StatusCheck` re-despacha **inline** mientras el estado no sea final;
> un estado no-final colgaría hasta el TTL (30 min). Por eso el guard devuelve un estado final.

## Taxonomía de lenders por patrón de flujo (análisis de TODOS los Action)

`response_type`: **0** = UTM redirect simple (~44 lenders, `action=null`, sin cierre de
integración — no requieren validación) · **1** = integración (con Action class) · **2** =
Creditop X originación propia (~muchos, `action=null`, un solo patrón).

| Lender | rt | Patrón de cierre | Aprobado → | Estado |
|---|---|---|---|---|
| Creditop X (#160/#95/#54…) | 2 | A · in-platform (acceptance→pagaré→verify-otp→authorize) | 11 | ✅ #6 |
| Credifamilia (#24) | 4 | B · polling-endpoint `pre-approval-status` → `show()` (rt=4 fuera del catálogo `response_types` 0-3) | 41 | ✅ #7 |
| Sistecrédito (#9) | 1 | C · redirect + **webhook** | 11 | ✅ #8 |
| Welli (#23/#141/#142) | 1 | D · polling por **job** `StatusCheck` (sync) | 11 | ✅ #9 |
| **Compensar (#47)** | 1 | A-like · OTP **bifurcado** register→`validate/otp` | 11 | ✅ #10 |
| BancoDeBogota (#5) | 1 | D-like · job `StatusCheck` + `updateStatus` (+ certs) | 11 | guards (E2E diferido*) |
| **Payvalida / Bancolombia (#8)** | 1 | C · redirect + **webhook** | 11 | ✅ #11 (+2 bugs) |
| **Approbe (#41)** | 1 | C · redirect encriptado + **webhook** | 11 | ✅ #11 (+2 bugs) |
| BancoDeBogotaCeroPay (#133) | 1 | redirect + `selfManager` | manual | autogestión* |
| Addi (#6) | 0 | stub + `selfManager` | manual | autogestión* |
| Prami (#12) / Meddipay (#39) | 1 | evaluación, **sin cierre** en el Action | manual | autogestión* |

> **Patrón "autogestión" (`selfManager`):** varios lenders no cierran async — un asesor/manual
> confirma el desembolso. **Bugs reales nuevos:** rutas de webhook **sin registrar** en Payvalida
> y Approbe (mismo patrón que el #8 de Sistecrédito).

## #10 · Compensar (#47) — OTP in-platform bifurcado, validado · BancoDeBogota (#5) — D-like, guards

**Compensar (#47) — patrón A-like (in-platform, 2 pasos):** seleccionar → `register()` genera/
envía el OTP del lender (`generacionOtp`); el usuario lo ingresa → `POST validate/otp`
(`ValidateOtpController@validateLenderOtp`) → `Compensar::validate()` valida (`validacionOtp`) y
crea la transacción `Disbursed` → el controller pone el **user_request en 11** + voucher.
- Guards locales (`Compensar.php`): `register()` simula OTP enviado; `validate()` crea la
  transacción `Disbursed` y devuelve `codigoAutorizacion` (que el controller usa para `request_number`).
- **Validado:** `tests/compensar.test.ts` (selección + validate/otp → user_request 11).

**BancoDeBogota (#5) — patrón D-like (= Welli):** `register()` despacha `StatusCheck` (job) →
`updateStatus()` (GET status) mapea `'Disbursed'` → user_request 11. Guards locales en
`register()`/`updateStatus()` (simula 'Disbursed' + lee response almacenado). **E2E no
reproducido:** la selección de #5 (`UserRequestService` case 1) **no alcanza `register`** en local
(va por una rama condicionada por flags de la credencial del branch — `bancolombia_type`/
`wompi_method` — o precondición de marketplace). El cierre es el **mismo patrón ya validado por
Welli**, así que se deja con los guards y E2E diferido.

## #11 · Webhooks Payvalida (#8) + Approbe (#41) — patrón C, validados (+4 bugs reales)

Ambos son redirect + **webhook** (como Sistecrédito): el lender notifica → el handler consulta
estado y mapea **`APROBADA`/`CREDIT_DISBURSED` → user_request 11** + voucher. Validados en
`tests/payvalida.test.ts` y `tests/approbe.test.ts`.

- **Bugs reales (candidatos a PR):**
  1. **Rutas de webhook sin registrar** (mismo bug que Sistecrédito): los controllers
     `PayvalidaController::webhook` / `ApprobeController::webhook` existían pero las rutas no.
     Registradas en `routes/api.php` → URI **en la raíz** (`/payvalida/webhook`, `/approbe/webhook`)
     porque ese grupo aplica `name('api.')` **sin** `prefix('api')`; nombres `api.{payvalida,approbe}.webhook`.
  2. **Namespace incorrecto de `ProfilingReviewController`** en ambos controllers: importaban
     `App\Http\Controllers\Customer\ProfilingReviewController` (NO existe) en vez de
     `Modules\Risk\App\Http\Controllers\Customer\ProfilingReviewController` → `Error` (class not
     found) al desembolsar, **no atrapado** por el `catch (\Exception)` (misma familia que #3).
- **Guards locales:** `WebhookRequest::authorize()` saltea el checksum (SHA256/encriptado); el
  controller lee el estado del `response` almacenado (sin GET/POST externo).
- **Nota:** Payvalida usa tabla aparte `payvalida_transactions`; Approbe usa `lender_transactions`.

### Patrón "autogestión" (`selfManager`) — implementado pero NO cableado

`selfManager()`/`selfManagerStatusId()` existen en varias clases (Addi #6, CeroPay #133,
Bancolombia, etc.) y mapean `completed/failed/cancelled` → status del lender, **pero ningún
endpoint los invoca** (no hay ruta). Es una feature **planeada/no conectada** para cierre manual
por un asesor. No hay flujo E2E que validar hoy; queda documentado como gap.

## Pendientes por validar (próximos touch points)

- **Portar a PR los bugs reales** (afectan prod): #8 (ruta `api.sistecredito.webhook`), #11
  (rutas Payvalida/Approbe + namespace `ProfilingReviewController`). *(Los de #3/#6 —
  `ExceptionNotification`/`logAndNotifyError` → `\Throwable` — ya están **mergeados/resueltos** en
  legacy-backend por `ea4adda3`; la cita de `Experian.php:184` quedó superada.)*
- **BancoDeBogota #5:** reproducir el E2E (entender la rama de selección que evita `register`).
- **`selfManager`:** si se prioriza el cierre manual, falta el endpoint que invoque `selfManager`.

> Recordatorio: la rama `test` es **local y desechable**. Los cambios #1 (workaround) y
> #2 (fix real) están **sin commitear** ahí. El #2 conviene portarlo a un PR de verdad.

---

## #12 · Auth Cognito: el backend confía en un header sin validar JWT — **seguridad** (+ bug 500-on-null)

> Descubierto el **2026-06-10** validando login contra dev (`legacy-backend.inertia-develop`) mientras
> se armaba el probe de login del playground (`backend-e2e/login.go` + `frontend-e2e/dev/cognito-login.spec.ts`).
> **NO portar a PR sin pedir** (convención). Catalogado para decisión del equipo.

**Hallazgo de seguridad (alto):** el middleware `auth.cognito` =
`app/Http/Middleware/ResolveCognitoUser.php:13-34` resuelve al usuario **únicamente** por los headers
`x-cognito-identity-id` (→ `users.cognito_id`) o `x-user-id` (→ `users.id`). **No valida ningún JWT**
ni firma. Si no encuentra usuario, **no aborta** (`if ($user) { Auth::login(...) }` y sigue igual).

Consecuencia: el backend de dev, **alcanzable directo en la red interna** (172.32.x.x), acepta una
identidad **forjada** — cualquiera en la red puede actuar como cualquier usuario con solo conocer/adivinar
un `cognito_id`. Validado: un GET autenticado con `x-cognito-identity-id: <cognito_id real>` resuelve al
usuario sin JWT. En prod presumiblemente hay un gateway (ALB/authorizer) que valida el JWT y **setea** el
header aguas abajo; pero el backend **no lo verifica por su cuenta**, así que la garantía depende 100% de
que nada hitee el backend directo. Si el backend es alcanzable sin pasar por el gateway → bypass total.

**Bug acoplado (500 enmascara 401/403):** `AlliedController@index` (y pares del grupo `auth.cognito` en
`Modules/Partner/routes/api.php:17`) hacen `$user->can(...)` / `->can()` sobre el usuario resuelto. Cuando
el header falta o no matchea, `Auth::user()` es **null** → `Call to a member function can() on null` →
**HTTP 500** en vez de 401/403. Misma familia que los `\Throwable` de #3/#6: un fallo de auth se reporta
como error de servidor, no como "no autorizado". Fix sugerido (a decidir): que `ResolveCognitoUser` aborte
con 401 cuando no resuelve usuario en rutas que lo exigen, o que los controllers validen `Auth::check()`.

**Nota de operación del playground:** este mismo mecanismo (header `x-cognito-identity-id`) es el que el
harness usa para "loguearse" tanto en local como contra dev — por eso el JWT del Hosted UI **no es
necesario** para la vía backend (solo para tests del frontend real). Ver memoria `backend-e2e-dev-target`.
