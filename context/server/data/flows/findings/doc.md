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
