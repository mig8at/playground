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
