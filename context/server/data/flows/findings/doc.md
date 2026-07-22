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

Herramienta: `frontend-e2e/dev/sweep.ts` (`matrix` / `close`). Todo lo de abajo salió de correrla contra el backend local, 2026-07-19.

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

**Causa:** `scrubphone` (`pkg/asesor.ts:203`) borra los users cliente del teléfono de prueba y, con ellos, sus `user_requests` (`deleteUsers`, FK checks off). Como **cada corrida arranca scrubbeando**, la corrida N destruye la evidencia de la N-1. La 464499 la borró la corrida siguiente (464500, otro user_id, 33s después).

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

**`cryptocheck` se portó** a `frontend-e2e/bin/dbops.ts`. Lo que lo hace servir no es el HMAC sino **probar contra una fila Experian NO sintética** (documento fuera del rango 2.9B): contra una fila que forjamos nosotros el MAC siempre valida y el chequeo no dice nada. Importa porque con un `APP_KEY` equivocado la inyección de buró escribe un blob ilegible y **`/lenders` no ofrece nada, sin ningún error** — se ve idéntico a "el perfil no califica". `appKey()` solo valida presencia.

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

**Causa raíz verificada.** `bin/asesor` resolvía la URL del backend con `WIZ_API="$(grep -E '^E2E_API_BASE_URL=|^E2E_MOCK_URL=' .env.$TARGET | head -1 | sed … | tr …)"`. Con la **partición de variables**, `E2E_API_BASE_URL` dejó de estar en `frontend-e2e/.env.dev` y pasó al compartido `env/dev.env` — el archivo que el `grep` mira ya no tiene la clave. Un `grep` sin match devuelve **1**, `pipefail` lo propaga al pipeline, y bajo `set -e` la **asignación** aborta el script. El `2>/dev/null` no protege: silencia stderr, no el exit code. Por eso muere justo ahí y en silencio.

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

- `pkg/config.ts` — `loadCognitoCreds()` pasó de `process.env` pelado a la cadena `env()`, así que las credenciales viven en `frontend-e2e/.env.<target>` (gitignored) en vez de un `.cognito.json` único que habría que pisar para alternar.
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
