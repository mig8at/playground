# Origen del onboarding: canal y backend del usuario

Cubre las columnas `users.onboarding_channel` y `users.onboarding_backend`: quién las escribe y
cuándo, en `legacy-backend`, `application`, el wizard de `frontend-monorepo` y
`onboarding-forms-service`. Describe el código de `main`; no dice qué proporción de usuarios tiene
el dato en un ambiente (las filas anteriores a la migración quedan en `null`) ni certifica que cada
despliegue tenga la migración aplicada.

## Las dos columnas y sus valores

La migración `2026_07_02_120000_add_onboarding_origin_to_users` de `legacy-backend` agrega las dos
columnas, ambas `nullable`. `application` no tiene migración propia: escribe sobre la misma base.

- `onboarding_channel`: `ecommerce`, `merchant`, `self_service` o `mobile`. Los tres primeros los
  declara el front; `mobile` sólo lo escribe el backend.
- `onboarding_backend`: `legacy`, `application` o `refactor`. Nunca viene del front. El comentario
  de la migración dice `legacy | application`, pero el código también escribe `refactor` (abajo).

El backoffice las devuelve como `onboardingChannel` y `onboardingBackend` en el detalle del usuario
(`UsersService`).

## Quién declara el canal

- **Wizard (`frontend-monorepo`)**: `resolveOnboardingChannel(flow, pathname)` devuelve `merchant` si
  la ruta empieza por `/merchant`, `ecommerce` si el flujo es `ecommerce`, y `self_service` en todo
  lo demás (autogestión, consumer-hub, Bancolombia). Sólo lo usa el envío del celular de
  `phone-number.tsx`, que lo agrega al cuerpo de `POST /api/onboarding/phone/register`.
- **`onboarding-forms-service`** (flujo dinámico): `send_otp.go` toma `onboarding_channel` del
  payload y, si viene vacío, usa `merchant`; lo reenvía a `create-temporary-user` de legacy.
- **Front de `application`** (`RegisterCellPhone.vue`): `ecommerce` si es ecommerce, `self_service`
  si es autogestión y `merchant` en el resto.
- **Validación**: `SendOtpCodeRequest` y `BackDoorPhoneNumberRequest` de legacy, y
  `StoreRegisterCellPhoneRequest` de `application`, aceptan sólo `ecommerce`, `merchant` y
  `self_service`. Un `mobile` enviado por un cliente web se rechaza.

## Dónde se escribe en legacy-backend

El canal entra al crear el usuario temporal y no después:

- `UserService::createTemporalUser` y `RegisterCellPhoneService::createTemporalUser` escriben el
  canal recibido y `onboarding_backend = 'legacy'`. `getOrCreateUser` sólo llama a la creación
  cuando no encuentra usuario por celular: un usuario existente conserva lo que tenía.
- Los que llaman pasan su canal: `OtpService::sendOtpCode` y `sendOtpCodeViaEmail` el del request,
  `RegisterCellPhoneService` el del request, `BackDoorUserService` (el `create-temporary-user` del
  flujo dinámico) el de `BackDoorPhoneNumberRequest`, y `MobileOnboardingService` el literal
  `mobile`. `BackDoorService` y `CreditStudyService` pasan `null`.
- `MobileOnboardingService::markMobileCreated`, al final del registro móvil, escribe
  `onboarding_channel = 'mobile'` y `onboarding_backend = 'refactor'`, cada uno sólo si estaba en
  `null`.
- El registro móvil de la nueva arquitectura (`UsersV1 UserRepository::createTemporalMobileUser`)
  escribe `mobile` y `refactor` al crear la fila, no al final.

## El canal se escribe una sola vez; el backend no

`App\Models\User::booted()` registra un `updating` que, si `onboarding_channel` cambia y ya tenía
valor, le devuelve el original. Lo mismo está en el `User` de `application`. Es un candado de
modelo, no de base: no protege un `update` por Query Builder ni una escritura a través de
`UsersV1\UserEntitie`, que no declara ese evento (lo advierte el propio `createTemporalMobileUser`).

`onboarding_backend` no tiene candado. En `application`, `RegisterCellPhoneController` reenvía el
canal a `phone/register` de legacy, hidrata el usuario que devuelve y, si su backend no es
`application`, lo pone en `application` y guarda. Como `phone/register` devuelve también usuarios
que ya existían, un usuario creado por legacy que vuelve a registrarse por `application` pasa a
figurar con backend `application`: la columna dice el último backend de `application` que lo
tocó, no siempre el que lo creó. Si ese guardado falla, sólo deja un warning.

## Límites

- Un usuario creado antes de la migración, o por un camino que pasa `null`, queda sin canal hasta
  que algún camino lo escriba estando en `null`.
- El canal refleja el primer registro, no el canal de la solicitud actual: una persona que entró
  por un comercio y vuelve por autogestión sigue con su canal original.
