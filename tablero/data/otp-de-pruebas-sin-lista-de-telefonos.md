---
id: 70
title: "El OTP de pruebas, sin lista de teléfonos"
stage: work
created: "2026-08-24T15:30:00-05:00"
context_nodes: [onboarding, kyc, formalization]
jira: []
jira_title: ""
---

# El OTP de pruebas, sin lista de teléfonos

## Si retomás esto sin contexto, empezá acá

Para probar cualquier flujo hay que pasar por OTP, y hoy eso se resuelve **cargando el teléfono en una
lista** (`settings.qa_otp_bypass_phones`): si está ahí, el código son los últimos dígitos del propio
número. Funciona, pero cada número nuevo es una carga a mano, y **mete dos ramas de código de prueba en
producción** que dependen de que un `if (env)` acierte — y ya sabemos que **`staging` corre con
`APP_ENV=development`**, así que ese bypass está activo ahí.

**El spike ya está hecho y funciona** (2026-08-24, ver mediciones): con la lambda de mocks levantada en
local y `OTP_SERVICE_HOST` apuntado a ella, el OTP de identidad acepta **cualquier código**, incluso
texto. Sin listas, sin headers, sin tocar una línea de `legacy-backend`.

**El próximo paso es:** decidir si las rutas de OTP entran al repo de la lambda
(`risk-services-mockery-lambda`) y con qué comportamiento por defecto.

## Objetivo

Que probar el OTP no requiera **ni cargar un teléfono en una lista, ni mandar headers**, y que el código
de producción **no tenga ninguna rama de prueba**.

## Cómo funciona hoy — son DOS sistemas, no uno

| | onboarding (identidad) | **pagaré (firma)** |
|---|---|---|
| genera el código | el **microservicio** de OTP | **`mt_rand`**, 6 dígitos, en `Modules/Loans/App/Services/OtpService.php:55` |
| envía | el microservicio | SNS o Twilio según país, vía **microservicio de mensajería** |
| valida | el microservicio | **local**, contra la tabla `otps` encriptada |
| host configurable | `OTP_SERVICE_HOST` (`services.otp_service.host`) | `MESSAGING_SERVICE_HOST` (default `localhost:8082`) |
| bypass de pruebas | lista, últimos **4** dígitos | lista, últimos **6** dígitos |

Los dos clientes del microservicio —`AuthV1\OtpClient` y `System\OtpServiceRepository`— leen **el mismo
host**, y el servicio expone sólo tres rutas: `POST /api/otp/generate`, `POST /api/otp/validate` y
`GET /health`.

⚠ **La diferencia que decide el diseño**: en identidad **valida el microservicio**, así que un mock puede
aceptar cualquier código. En la firma **valida legacy contra su propia tabla**, así que ningún mock puede
hacer que acepte cualquiera — ahí el código hay que **leerlo**, no adivinarlo.

## Los mecanismos de prueba que conviven hoy — son TRES

1. **`Onboarding\OtpBypassService`** — lista en `settings.qa_otp_bypass_phones`, últimos 4 dígitos, sólo
   `local`/`development`.
2. **El mismo bypass otra vez, escrito inline** en `AuthV1\ValidateOtpService` (líneas ~150-180): misma
   setting, misma lógica, **duplicada**.
3. **`FakeOtpServiceRepository`** — driver fake in-process que se activa con `ONBOARDING_DRIVER_OTP=fake`,
   sirve fixtures de `resources/fixtures/onboarding/otp/` y permite elegir escenario por header
   `X-Fake-Scenario`. Se niega a registrarse si `APP_ENV=production`.

## Lo que se evaluó y NO se eligió

**Un OTP fijo («siempre 1234»).** Es lo más cómodo y lo más peligroso. Comparando qué pasa **si el gate de
ambiente falla**: con un código fijo, cualquiera entra a **cualquier** cuenta; devolviendo el código en la
respuesta, pido OTP para el teléfono ajeno y me lo dan — igual de malo; con la lista, el daño queda
acotado a los números cargados. Y el gate **ya falla parcialmente**: `staging` corre con
`APP_ENV=development`.

**El driver fake por header (`X-Fake-Scenario`).** Es el mecanismo mejor construido de los tres, pero
**el front es SSR y no habla directo con `legacy-backend`**: el header no sobrevive el salto, y pedirle a
QA que lo inyecte a través del SSR es exactamente la maniobra que se quiere evitar. Sirve para pruebas
por API; no para QA manual.

**Tocar la validación local de la firma.** Sería volver a poner un `if (env)` en el código de producción,
que es lo que esta tarea viene a sacar.

## Cómo se ataca

**Paso 1 · identidad (resuelve el 90% de la fricción).** Tres rutas en la lambda y apuntar
`OTP_SERVICE_HOST` a ella en local, dev y staging. `validate` acepta cualquier código; con el admin API
de Mockoon se puede **dictar uno por identificador** cuando haga falta probar el rechazo. Cero cambios en
`legacy-backend`.

**Paso 2 · la firma, como bandeja de SMS.** El mensaje que sale lleva el código adentro
(`"Tu código de verificación es: 123456"`). Apuntando `MESSAGING_SERVICE_HOST` a la lambda, ese texto
llega ahí; Mockoon puede guardarlo en una variable global con el teléfono como clave —el mismo mecanismo
que ya usan las centrales— y exponerlo para consulta. QA lo lee; el harness lo automatiza en un request.

**Paso 3 · borrar los dos bypass por lista** y la setting. Empezando por el **inline de `AuthV1`**, que es
una copia literal de `OtpBypassService` y se puede sacar sin esperar nada.

## Lo que NO entra

Cambiar cómo se genera o valida el OTP en producción. Unificar los dos sistemas de OTP en uno —que
probablemente convenga, pero es otro trabajo—. Y el `$isDoLogic` / `$phoneCode = '+57'` que asoman en
`Loans\OtpService`: son del censo de país, no de esta tarea.

## Cómo se comprueba

Levantar la lambda sin SAM ni `node_modules`, sobre el mismo archivo de definición que se despliega:

    cd <risk-services-mockery-lambda>
    npx -y @mockoon/cli@latest start --data riskservices.json --port 3000

Y apuntar `legacy-backend` a ella (⚠ **también hay que poner `ONBOARDING_DRIVER_OTP=real`**, ver abajo):

    OTP_SERVICE_HOST=http://host.docker.internal:3000

> **MEDICIÓN · 2026-08-24 · el spike funciona.** Con las tres rutas agregadas al `riskservices.json` y la
> lambda en `:3000`, pidiéndole al cliente real de legacy:
>
>     clase: Modules\System\App\Repositories\OtpServiceRepository
>     generate         → {"success":true,"message":"ok"}
>     validate(9999)   → {"success":true,"valid":true,"message":"ok"}
>     validate("hola") → {"success":true,"valid":true,"message":"ok"}
>
> **Acepta cualquier código, incluso texto.** Y sin tocar una línea de `legacy-backend`.

> **MEDICIÓN · 2026-08-24** — 🔴 **en local hay DOS mecanismos apuntados a la vez y uno es config muerta.**
> `OTP_SERVICE_HOST` apunta a `host.docker.internal:8105` —el mock de centrales del harness, que **ya
> atiende `/api/otp/generate` y `/api/otp/validate`**— pero **nunca se usa**, porque
> `ONBOARDING_DRIVER_OTP=fake` hace que el contenedor resuelva `FakeOtpServiceRepository`, que responde
> desde fixtures **sin salir a la red**. Se descubrió porque el spike no recibía requests: la clase que
> resolvía era la fake. Con `ONBOARDING_DRIVER_OTP=real` el request sí sale.

> **MEDICIÓN · 2026-08-24** — **el envío por SNS del wizard es código muerto**: `sendSmsNotification` y
> `sendSmsMessage` (`Onboarding\OtpService`) **no tienen ni un llamador** en la rama `qa`. El wizard usa
> el microservicio (`OtpServiceRepositoryInterface`). El `mt_rand` que sí está vivo es el del **pagaré**.

> **DECISIÓN · 2026-08-24 (Miguel)** — el comportamiento por defecto es **cualquier teléfono y cualquier
> OTP**. Dictar un código concreto queda como la excepción, vía el admin API de la lambda.

> **MEDICIÓN · 2026-08-24 · las rutas están escritas, probadas y con PR.** Rama `feature/otp-mock` desde
> `main` de `risk-services-mockery-lambda`, **PR #29**. Contra el **cliente real** de `legacy-backend`
> (no el doble in-process):
>
>     --- teléfono SIN dictar ---
>     generate       → {"success":true,"message":"ok"}
>     validate(777)  → {"success":true,"valid":true,"message":"ok"}
>     --- teléfono CON 4321 dictado por el admin API ---
>     validate(4321) → {"success":true,"valid":true,"message":"ok"}
>     validate(0000) → {"success":true,"valid":false,"message":"invalid code"}
>
> Y el control que importa: **otro teléfono, sin dictar, sigue aceptando cualquiera** — el dictado es por
> identificador, no global, así que dos pruebas en paralelo no se pisan.
>
> **No toca ninguna ruta existente**: 130 líneas, todas insertadas, en una carpeta `OTP` nueva.

> **DECISIÓN · 2026-08-24** — **este PR no permite borrar todavía el bypass por lista.** Lo vuelve
> innecesario para **identidad**, que es donde está la mayor parte de la fricción, pero la **firma del
> pagaré** genera y valida dentro de legacy: hasta que los dos sistemas se unifiquen, sacar la lista
> dejaría a QA sin poder firmar.

> **MEDICIÓN · 2026-08-24** — 🔴 **`$isDoLogic` no decide «es RD»: decide «manda SMS además de
> WhatsApp», y el nombre miente.** El bloque real (`Loans\OtpService`):
>
>     $country   = $this->phoneService->resolveCountry($phoneCode, $user->cell_phone);
>     $isDoLogic = $country === 'DO' || str_contains($user->cell_phone, '+');
>     if ($isDoLogic) { /* SMS por el microservicio de mensajería */ }
>     else            { 'SMS skipped for Colombia' }   // ← no manda SMS
>
> **Con Perú, `resolveCountry` devuelve `PE`, no entra al `if`, y el cliente NO recibe SMS** — sólo
> WhatsApp, con un log que dice «for Colombia». Es el patrón P3 del censo: el mundo binario CO/DO.

> **MEDICIÓN · 2026-08-24** — y **`resolveCountry` no lee de la base**: usa `libphonenumber` para
> **adivinar el país del número**, con fallback `'CO'` si el parseo falla (`System\PhoneService:29`).
> El país verdadero ya lo sabe la solicitud —el controller hace
> `$userRequest->allied?->country?->phone_code ?? '+57'`, que **sí** va por la BD— y después el servicio
> lo tira y lo vuelve a adivinar del teléfono.

> **MEDICIÓN · 2026-08-24** — **el bypass inline de AuthV1 ya está fuera**: 34 líneas, más la dependencia
> de `SettingsService` que no tenía otro uso. Los tests que cubren OTP dan **el mismo resultado que la
> rama base** (11 failed, 4 passed; preexistentes). PR **legacy-backend #1195** contra `qa`.

## Registro

### 2026-08-24

- **La lambda mergeó, y con eso salió el primer bypass.** PR **#1195**: `AuthV1\ValidateOtpService` deja
  de tener su copia inline. **Los otros dos usos siguen** (`Loans\OtpService` y `Loans\OtpValidationService`),
  porque cubren la firma.

- **Lo siguiente, ya medido y listo para decidir: que el canal salga de la base.** El controller ya lee
  el país correctamente; el problema es que `Loans\OtpService` lo descarta y lo re-adivina del teléfono,
  y decide el canal con un ternario binario. El arreglo limpio es **pasarle el país** (el modelo, no el
  prefijo) en vez de que lo deduzca — así el servicio tiene `phone_code`, `iso` y lo que se agregue.

  ⚠ Falta un dato que **hoy no existe en ninguna tabla**: «¿este país recibe SMS además de WhatsApp?».
  Sería una columna nueva en `countries`. Y ⚠ **el cambio no es neutro**: hoy `str_contains($cell_phone, '+')`
  también activa el SMS, así que un teléfono guardado con `+` lo recibe aunque su país sea Colombia —
  son **5.276 usuarios en prod** con el teléfono guardado con caracteres no numéricos. Al pasar a leer
  de la base, esos dejan de recibirlo. Es un heurístico accidental que conviene perder, pero **es un
  cambio de comportamiento y hay que decirlo**, no descubrirlo.


- **Fase A cerrada: la lambda queda lista para QA.** PR **#29** en `risk-services-mockery-lambda`
  (`feature/otp-mock`, desde `main`). Falta desplegarla y apuntar `OTP_SERVICE_HOST` en el ambiente.

- **El argumento que ordena la fase B**, y que apareció comparando las dos firmas: el microservicio ya es
  **multi-país por diseño** —`generateOtp(string $country, …)`— mientras el camino de la firma tiene
  `$phoneCode = '+57'` de default y un `$isDoLogic` binario que elige entre SNS y Twilio. Migrar la firma
  al microservicio **no arregla ese hardcode: lo hace desaparecer**. O sea que unificar el OTP y avanzar
  la internacionalización son el mismo trabajo.

  ⚠ Pero es un **cambio de producción** —toca el flujo que emite un título valor— así que va con su
  propia validación, no junto con la fase A. Y la firma necesita seguir guardando el registro local de
  `Otp`: su `id` viaja como `otp_id` a la autorización y al documento, o sea es **evidencia**. Eso no se
  toca; lo que se delega es la generación y la validación del código.


- **Análisis y spike, en la misma sesión.** Salió de querer sacar la lista de teléfonos de pruebas. El
  análisis encontró que son **dos sistemas de OTP** y **tres mecanismos de prueba**, y que el camino de
  la lambda ya está a medio andar: `OTP_SERVICE_HOST` existe, el mock del harness ya responde esas rutas,
  y el patrón `*_MOCK_HOST` es el que el equipo ya usa para las centrales.

- **El spike está probado en local** y las tres rutas quedaron escritas en el `riskservices.json` del repo
  de la lambda, **sin commitear**. Falta decidir si entran así.


## Tarea (publicable)

## En una línea
Que probar el código de verificación por SMS no requiera cargar cada teléfono en una lista, y que el
sistema deje de llevar código de prueba adentro.

## Por qué
Hoy, para probar cualquier flujo hay que pasar por el código de verificación que llega al celular. Eso se
resuelve cargando el número en una lista de excepciones: si está ahí, el código son los últimos dígitos
del propio teléfono. Cada número nuevo es una carga a mano, y cada persona que prueba depende de que
alguien la haga.

Además, esa excepción **vive dentro del sistema** y se activa según el ambiente. Uno de los ambientes de
prueba está configurado de una forma que la deja activa sin que sea evidente, así que conviene sacarla
del todo en vez de confiar en que el interruptor esté bien puesto.

## Qué cambia
El código de verificación de la validación de identidad pasa a atenderlo el mismo simulador que ya se usa
para las centrales de riesgo, elegido por configuración del ambiente. En los ambientes de prueba,
**cualquier teléfono sirve y cualquier código se acepta**; quien prueba escribe lo que quiera y avanza.
Cuando haga falta probar un rechazo, se puede dictar un código concreto para un teléfono puntual.

Para el código que firma el pagaré —que funciona distinto, porque lo genera y valida el propio sistema—
el simulador queda como **bandeja de entrada**: recibe el mensaje y permite consultar qué código se envió,
en vez de tener que adivinarlo.

En producción no cambia nada: el sistema sigue hablando con el proveedor real, y la lista de excepciones
desaparece.

## Alcance
**Entra**: la validación de identidad y el código de la firma, en los ambientes de prueba.

**No entra**: cambiar cómo se genera o valida el código en producción, ni unificar los dos sistemas de
código de verificación que hoy conviven —que probablemente convenga, pero es otro trabajo.

## Dónde probar
Ambientes local, desarrollo y QA. No aplica a producción.

## Cómo validar
1. Iniciar una solicitud con **un teléfono cualquiera**, que no esté cargado en ninguna lista.
2. En la pantalla del código de verificación, escribir **cualquier número** y confirmar que avanza.
3. Repetir con otro teléfono distinto, sin pedirle a nadie que lo dé de alta.
4. Para la firma: completar hasta el pagaré y confirmar que el código enviado se puede **consultar**, sin
   tener que deducirlo del número de teléfono.

## Criterios de aceptación
- Se puede completar una validación de identidad con un teléfono nunca antes usado y un código
  cualquiera.
- Nadie necesita cargar un teléfono en una lista para poder probar.
- En producción el comportamiento es idéntico al de hoy: código real, enviado por el proveedor real.
- La lista de teléfonos de excepción queda vacía y sin uso.

## Dependencias / contraparte
- **Infraestructura**: apuntar la configuración del ambiente al simulador en local, desarrollo y QA.
- **QA**: confirmar que «cualquier código se acepta» es el comportamiento deseado por defecto, y qué
  casos de rechazo hay que poder forzar.
