# Actors · contexto
> **estado:** al día con main · Quién es quién en CreditOp: **cliente**, **asesor** y las figuras de **back-office** — todos filas de la MISMA tabla `users`. Por dónde entra cada uno, cómo se autentica y qué alcance ve.

## Qué es
Este contexto responde dos preguntas: **quién puede hacer qué** y **por dónde entra**. Todo actor humano — el cliente que pide el crédito, el asesor que origina en el mostrador y las figuras de back-office que operan y configuran — es una fila de la **misma tabla `users`**. Lo que los separa es `user_profile_id` (que **es** el `roles.id` de Spatie), el **dominio por el que se autentica** y el **filtro de visibilidad** que su rol aplica sobre `user_requests`.

Importa porque casi ningún control de acceso está en un Gate o una Policy: la autorización real vive en (a) tres puertas de login mutuamente excluyentes, (b) cascadas de `when($user->hasRole(...))` embebidas en las queries de listado, duplicadas en dos repos, y (c) el prefijo de URL del wizard nuevo. Tocar un rol sin mirar los tres puntos rompe el alcance en silencio.

Frontera: **quién decide el crédito** no es ningún actor humano → **Entities** (`response_type`). **Quién configura la oferta** (alta entidad→comercio→sucursal, calculadora, hash+QR) → **Merchants**. Las **pantallas** que recorre el cliente → **Onboarding**.

## Antes de concluir
- **`user_profile_id` ES `roles.id`.** No es una FK declarada ni hay constraint: lo mantiene un seeder (`ModelHasRolesTableSeeder`). Insertar un rol en el medio desalinea a todos los usuarios existentes.
- **El seeder de permisos está desactualizado.** Siembra **31** (re-contado el 2026-09-19; decía 30 — entraron los de links de pago), pero el menú del admin referencia **15 permisos que no existen en el seeder** (`view creditop x*`, `view credentials module`, `view user validation module`, `view videos module`, `view standar dashboard module`, `view application logs`…). Levantar un entorno desde seeders da un panel admin mutilado.
- **`Entidad Comercio` no está sembrado** pero es el 3.er rol más usado del código (**47** `hasRole('Entidad Comercio')`, re-contados el 2026-09-19). Igual que arriba: existe sólo en la BD real. Y **representa a un LENDER, no a un comercio**: el usuario de SmartPay (`genaoalexander@gmail.com`) tiene `allied_id 277` (Carrefour) pero su identidad de alcance es `lender_id 160` (SmartPay). Verificado en prod el 2026-08-07.
- **Los filtros por rol escritos con `when()` fallan ABIERTO, no cerrado**, y el patrón es **más grande de lo que este nodo decía**: re-contado el 2026-09-19, hay **28 archivos** que lo usan —**20 en `application` y 8 en `legacy-backend`**—. La consulta arranca trayendo todo y cada `when($user->hasRole(...))` sólo *agrega* un filtro; un rol que no matchea ninguna rama **no restringe nada**. Ejemplo vivo: `application/app/Exports/RequestsCtopXRiskExport.php:64-68` (`Comercial`, `Entidad`, `Superadmin comercio`). ⚠ **El ejemplo que este nodo citaba —`CreditopXRequestsReportExport.php:76-91`— ya no sirve: ese archivo dejó de filtrar por rol** y hoy acota por `allied_id` y `corporate_user_id`. Pero **tiene otra cosa**, y encaja con el bullet de hardcodes de personas de más abajo: su `__toString()` resuelve el usuario con un **correo personal quemado**, `User::where('email', 'laura.cabra@creditop.com')` (`:80`) — el export se renderiza haciéndose pasar por esa persona.
- **La lógica de alcance está duplicada** en `application` y `legacy-backend` (parallel-run). Cambiar un rol en uno y no en el otro produce dos listados distintos para el mismo usuario.
- **`corporate_users` / `CorporateUser` = muertos**, y encima confunden: el nombre sugiere que ahí vive el asesor. `User::corporateUser()` apunta a una FK inexistente; si alguien la invoca, revienta.
- **Password inicial del asesor = su cédula** (`bcrypt($request->document_number)`), y no hay ningún forzado de cambio en el alta. ⚠ **Y desde el 2026-09-17 eso vale para DOS altas, no una:** `application/app/Http/Controllers/Admin/AlliedCorporateUserController.php:87` (comercio) y `LenderCorporateUserController.php:102` (entidad) — el espejo nuevo copió el patrón tal cual.
- **La baja del asesor es soft y muta el identificador**: `document_number` pasa a `"4-1020…-t1"`. Reactivar a mano es delicado y el `-t` es lo que lo excluye de estadísticas.
- **`aliados.` mezcla anónimo y autenticado**: la gran mayoría de las **207** rutas de `routes/customer.php` corre sin `auth` (el total se re-contó el 2026-09-19; eran 203. El reparto exacto que decía este nodo —~173— **no se pudo re-derivar** con confianza: los grupos anidados hacen que un conteo automático mienta, y prefiero dejar el orden de magnitud antes que un número inventado) (son el onboarding del cliente). No asumir "estoy en aliados ⇒ hay asesor logueado"; el código pregunta `auth()->check()` caso por caso.
- **`status_per_profiles` se lee con `first()`** sin `orderBy` ni `where('value',1)`: el estado destino de la solicitud depende del orden de inserción, y el store borra+recrea toda la matriz del comercio en cada guardado.
- **`ResolveCognitoUser` confía en headers HTTP** (`x-user-id`, `x-cognito-identity-id`) para hacer `Auth::login`. Es seguro sólo si el API Gateway es el único camino hacia esas rutas; los READMEs de los módulos V2 lo dicen explícitamente ("la seguridad se apoya en la frontera de red").
- **El wizard guarda asesor y cliente en el mismo slot de sesión.** La cookie `_session` (dominio `.creditop.com`, 7 días) usa la clave `user` tanto para el asesor de Cognito hosted-UI como para el cliente del consumer-hub (`otp-login.tsx:116`), y `requireUserWithSession` sólo verifica que **exista** un `user`; el refresh se saltea porque el cliente no trae `refreshToken`.
- **El SSO mapea por email**, no por `cognito_id`: un cambio de email en `users` rompe el puente wizard→aliados sin error visible (redirige al login).
- **Etiqueta de canal inconsistente en el wizard**: `getChannelFromPathname` mapea `/self-service` → `pos_autogestion` (`analytics-taxonomy.ts:55-56`) mientras `public-layout.tsx:52` emite `channel: "self_service"` para la misma ruta; `/ecommerce` no está cubierto y cae en `"unknown"`.
- **Hardcodes de personas**: 5 celulares personales de staff —con nombre de pila en el comentario— en `legacy-backend/Modules/Identity/App/Services/ManualValidationService.php:18-24` (verificado el 2026-09-19; el archivo está en el monolito NUEVO, no en `application`) y el email `admin.ecommerce@creditop.com` como asesor por defecto hacia los lenders.
- **Gemelo no ruteado**: `legacy-backend/Modules/Identity/App/Http/Controllers/Customer/AuthController.php` es el port 1:1 (Inertia→JSON) del login del asesor, pero **no está registrado en ninguna ruta**.

## Contenido

**Una sola identidad.** Guard único `web` → provider `users` → `App\Models\User` (`config/auth.php:38-43`, `config/auth.php:62-66`). No hay guard de asesor ni de admin. En el schema, `users.user_profile_id` default 1 y `corporate_user_id` viene comentado como *"Indica que usuario comercial creo al cliente"* (`database/migrations/2014_10_12_000000_create_users_table.php:17-22`).

**Los 12 roles + 1.** `RolesTableSeeder:25-38` siembra en este orden (el id importa): **1** Cliente · **2** Administrador · **3** Operaciones · **4** Comercial · **5** Entidad · **6** Superadmin comercio · **7** Admin comercio · **8** Mesa de servicio · **9** Tesoreria · **10** Contabilidad · **11** Analista · **12** Logistica. `ModelHasRolesTableSeeder:21-28` asigna `Role::find($user->user_profile_id)`: **`user_profiles.id` y `roles.id` son el mismo número**, por eso el código mezcla `hasRole('Comercial')` con `user_profile_id == 4` como sinónimos. Hay un **13.º rol, `Entidad Comercio`, que NO está en el seeder** pero sí en producción: 45 `hasRole('Entidad Comercio')` en `application` y presente en la lista de login (`FortifyServiceProvider.php:40`).

**Tres puertas de login, mutuamente excluyentes:**

| Puerta | Dónde | Quién pasa | Credencial |
|---|---|---|---|
| Fortify | `admin.{host}` (`config/fortify.php:92`, username = email `config/fortify.php:49`) | los 11 roles de `FortifyServiceProvider.php:27-42` — **todos menos `Cliente` y `Comercial`** | email + password |
| `Customer\AuthController` | `aliados.{host}/login-comercial` (`routes/customer.php:109-111`) | **sólo `Comercial`** (`shouldAuth`, `app/Http/Controllers/Customer/AuthController.php:29-32`) | email + password |
| `LoginCellphoneController` | `perfil.{host}/login` (`routes/profile.php:20-21`) | el **cliente** (descarta `first_name = 'TEMPORAL USER'`, `app/Http/Controllers/Profile/LoginCellphoneController.php:30`) | celular → OTP o FaceID, **sin password** |

`Authenticate::redirectTo` (`app/Http/Middleware/Authenticate.php:20-24`) es la matriz inversa: `aliados.`→`customer.login`, `perfil.`→`profile.login`, resto→`login`. Consecuencia estructural: **Superadmin comercio (6) y Admin comercio (7) son gente del comercio pero entran por el panel `admin.`**; sólo el asesor de mostrador (Comercial) usa el panel de aliados.

**Cuatro subdominios = cuatro superficies** (`RouteServiceProvider.php:49-76`): `api.` (máquinas) · `admin.` (back-office, 56 controllers, **único** grupo de middleware que lleva `Authenticate`, `Kernel.php:74`) · `aliados.` (57 controllers) · `perfil.` (9 controllers, cliente, **mobile-only** vía `onlyMobile`→`RedirectProfileIfDesktop`) + el sitio público. **`aliados.` es mixto**: de sus 203 declaraciones de ruta sólo **30** están dentro de `Route::middleware(['auth'])` (`routes/customer.php:185-232`); las otras ~173 son el onboarding **anónimo** del cliente corriendo en el mismo dominio que el panel del asesor.

**El asesor NO vive en `corporate_users`.** `Admin\AlliedCorporateUserController@store` (`app/Http/Controllers/Admin/AlliedCorporateUserController.php:71-96`) crea una fila en **`users`** con: `document_number` y `cell_phone` **prefijados con el id de perfil** (`"4-1020…"`) para no chocar con la cédula del cliente; `password = bcrypt(document_number)` (su propia cédula); `ModelHasRoles` con `role_id = user_profile_id`; N filas en `allied_branches_by_user` si es multi-sucursal; `multiple_allieds` (JSON). Si el comercio tiene algún lender rt=2 y el perfil es 4 o 6, le agrega `view creditop x requests` + `view creditop x` (`app/Http/Controllers/Admin/AlliedCorporateUserController.php:105-112`). Perfiles asignables: todos menos `[1,2,5]`, y quien no es perfil 2 sólo puede crear perfil 4 (`app/Http/Controllers/Admin/AlliedCorporateUserController.php:58-60`). La baja es **soft**: `status=0`, `document_number .= '-t{n}'`, email y celular a NULL (`app/Http/Controllers/Admin/AlliedCorporateUserController.php:130-145`) — de ahí el `like '%-t%'` de `User::getFilteredIds()` (`User.php:147-165`).

**Desde el 2026-09-17 sí se puede CREAR un usuario de entidad, y cuelga de `lender_id`.** El perfil «Entidad Comercio» ya existía y medio admin ya filtraba por él —solicitudes CreditopX, pagos, la lista de comercios, la de usuarios, el dashboard, todos por `users.lender_id`—, pero no había por dónde crear uno. `Admin\LenderCorporateUserController` (`application/app/Http/Controllers/Admin/LenderCorporateUserController.php`) es el espejo de `AlliedCorporateUserController`, con **una sola diferencia y es la que importa**: el usuario de comercio cuelga de `allied_id` más su punto de venta, y el de entidad cuelga de `lender_id` — que se toma **de la entidad de la URL y nunca del formulario** (`application/app/Http/Controllers/Admin/LenderCorporateUserController.php:92`), así que no hay manera de crear un usuario apuntando a la entidad de otro. Mismo truco de prefijo que el asesor: `document_number` y `cell_phone` se guardan antepuestos con el id del perfil (`:87`, `:100`), y al deshabilitar el documento se renombra con un sufijo `-tN` correlativo (`:133-142`), que es lo que libera el número original.

⚠ **Y lleva un comercio QUEMADO por necesidad, el 24.** Un usuario de entidad no pertenece a ningún comercio —lo que lo ata a su entidad es `lender_id`—, pero medio admin da por hecho que todo usuario tiene uno: el dashboard estándar hace `whereIn('id', $user->multiple_allieds)` para ese rol y **revienta en `count(null)` apenas el usuario entra**. Por eso se le asigna el comercio propio de CreditOp (`DEFAULT_ALLIED_ID = 24`, sucursal `17`, en `application/app/Http/Controllers/Admin/LenderCorporateUserController.php:39-40`): satisface el supuesto sin darle acceso a un comercio ajeno. ⚠ Cuidado al leer ese `24` en otra parte: como **entidad** es Credifamilia y como **comercio** es Creditop — el índice de quemados está por par (columna, id), no por id.

La tabla **`corporate_users` y el modelo `CorporateUser` son código muerto**: cero `create/where/find` en los dos repos; sus dos únicas relaciones (`User::corporateUser()` `app/Models/User.php:188-191` y `AlliedBranch::corporateUsers()`) nunca se invocan, y la primera declara la FK `user_id`, columna que **la migración de `corporate_users` ni siquiera define**. Lo vivo es `user_requests.corporate_user_id` → `belongsTo(User::class)` (`UserRequest.php:86-89`); hay exports que literalmente hacen `leftJoin('users as corporate_users', …)`. El gemelo `Modules/Partner` de `legacy-backend` también usa `App\Models\User`.

**Alcance: quién ve qué.** No hay policies; el filtro es una cascada de `when($user->hasRole(...))` sobre la query de listado — `UserProfilingService::applyRoleFilters` (`app/Services/UserProfilingService.php:202-235`), **duplicada casi 1:1** en `legacy-backend/Modules/Loans/App/Repositories/UserRequestRepository.php:97-138`:
- **Comercial** → su comercio **y** su sucursal **y** (`corporate_user_id` = él **o** `0` **o** `NULL`) → lo suyo + lo autogestionado.
- **Admin comercio** → su `allied_id` + las sucursales de `allied_branches_by_user`.
- **Superadmin comercio** → todos los comercios de `multiple_allieds`.
- **Entidad** → `user_requests.lender_id == users.lender_id`.
- **Entidad Comercio** → su lender + una lista de ids "legacy" (si viene vacía, `whereRaw('0 = 1')`).
- **Mesa de servicio** → `multiple_allieds` ∩ estados `[10,11]` · **Tesoreria** `[15,12]` · **Contabilidad/Logistica** `[11,13,14]`.
- Transversal: quien **no** es perfil 2 no ve solicitudes anteriores a `allieds.production_date` (`app/Services/UserProfilingService.php:190-198`).

**Permisos (Spatie).** `PermissionsTableSeeder` siembra **30** permisos y `RoleHasPermissionsTableSeeder` los mapea (`[permission_id, role_id]`; el rol 2 Administrador se lleva casi todos). El menú del panel admin es 100% permission-driven (`can:` en `resources/js/navigation/vertical/configuration.js`) más un gate por país (`hiddenForCountries: [60]`). Al front llegan por la prop compartida `allPermissionsNames` junto con `user_profile_id`, `allied_id`, `multiple_allieds` y `allied_country_id` (`HandleInertiaRequests.php:42-48`). Autorización real de servidor (`authorize()` de Form Request) prácticamente sólo en `ManualValidationRequest.php:16` → `can('validate identity manually')`.

**`status_per_profiles` no es un permiso.** La tabla (`allied_id × user_profile_id × user_request_status_id × value`) se edita en `Admin\AlliedModulesController` (index `app/Http/Controllers/Admin/AlliedModulesController.php:20-64`; store = **DELETE de todo el comercio + recreate**, `app/Http/Controllers/Admin/AlliedModulesController.php:69-71`, y sólo persiste los `true`). Pero se **consume como resolvedor de estado**, no como check: `$modules = StatusPerProfile::where(allied)->where(profile)->first(); $user_request_status_id = $modules->user_request_status_id;` (`Admin\UserRequestController.php:375-380`) — un `first()` sin `orderBy` ni `where('value',1)`.

**Cognito: dos usos muy distintos del mismo campo `users.cognito_id`.**
1. **Asesor** — OAuth2 hosted UI (remix-auth, `utils/auth/auth.server.ts:29-54`, scopes `openid/phone/email`, cookie de dominio `.creditop.com`). El alta al pool está gateada: `checkEmailExists` sólo acepta `user_profile_id = 4` **con** `allied_id`, o `= 2` (`legacy-backend/Modules/Onboarding/App/Http/Controllers/UserController.php:55-77`); `saveCognitoSub` graba el `sub` (`Modules/Onboarding/App/Http/Controllers/UserController.php:79-96`).
2. **Cliente** — usuario **provisionado por máquina** cuyo username es el teléfono `+57…`: `adminCreateUser` con `MessageAction: SUPPRESS`, password aleatorio de 16 chars que se **rota inmediatamente después** de emitir los tokens (`CognitoService.php:79-101`, `Modules/Onboarding/App/Services/CognitoService.php:121-149`). El cliente nunca conoce una contraseña.

Del lado backend, `ResolveCognitoUser` (alias `auth.cognito`, `legacy-backend/app/Http/Kernel.php:66`) resuelve la fila de `users` desde los headers `x-user-id` / `x-cognito-identity-id` y hace `Auth::login` (`legacy-backend/app/Http/Middleware/ResolveCognitoUser.php:15-32`) — o sea, **la autenticación se termina en el gateway y el backend confía en el header**. Lo usan `Modules/Partner` entero (`routes/api.php:17`), el perfilamiento del asesor y el `consumer/credits/*` del cliente (`Modules/Loans/routes/api.php:116`, `Modules/Loans/routes/api.php:129`).

**Puente SSO wizard → panel viejo.** El wizard arma `sig = HMAC-SHA256("{access_token}|{ts}", INTERNAL_SSO_TOKEN)` (`app/utils/aliados-sso.server.ts:14-16`) y auto-postea un form a `aliados.…/sso/cognito-login` (`routes/auth/aliados-sso.tsx:27-31`). `SsoCognitoController` valida firma + ventana de **300 s** (`app/Http/Controllers/Customer/SsoCognitoController.php:100-116`), consulta `/oauth2/userInfo`, mapea **por email** (`app/Http/Controllers/Customer/SsoCognitoController.php:67`), exige `hasRole('Comercial')` (`app/Http/Controllers/Customer/SsoCognitoController.php:74`) y hace `Auth::login` (ruta en `routes/customer.php:35`).

**El wizard nuevo: el canal es el prefijo de URL.** `RouteContext = "ecommerce" | "merchant" | "self-service"` (`app/utils/route-helpers.ts:4-15`). El **único** gate de auth de todo el wizard es `layouts/default-layout.tsx:21` (`requireUserWithSession`), que envuelve el árbol `/merchant` (`app/routes.ts:70`); `/self-service`, `/ecommerce`, bancolombia y consumer-hub son públicos a nivel Remix, y `public-layout.tsx:8-16` sólo valida que `:flow` sea uno de los dos primeros. ⚠ La cabecera `x-cognito-identity-id` **ya no la arma ese layout**: se mudó a `frontend-monorepo/apps/loan-request-wizard/app/utils/backend-auth-headers.server.ts:12`, que la construye para cualquier llamada al backend y **sin mirar el árbol de la ruta** — por eso una sesión de asesor abierta viaja también en `/ecommerce/*`. El layout sí sigue **fijando al asesor a su sucursal**: si el `:partner_hash` de la URL no es el de su `allied_branch`, redirige al suyo (`app/layouts/default-layout.tsx:78-89`).

**Handoff asesor → cliente: tres representaciones del canal, ninguna compartida.**
- `application` — `session('self_management') = !Auth::check() && !session('ecommerce')` (`RegisterCellPhoneController.php:134-135`), que termina persistido en `user_requests.self_management` (columna añadida 2026-01-26). Si el link se abre en otra pestaña o se le manda al cliente lo decide `lenders_by_allieds.user_self_management` (config comercio×lender): `openNewTab = !auth()->user() || user_self_management === 0` (`ConfirmationController.php:101`); el link sale por WhatsApp + email (`app/Http/Controllers/Customer/ConfirmationController.php:80-106`).
- `legacy-backend` — `AddOriginationFlowType` inyecta `metadata.origination_flow_type = 'ecommerce' | 'merchant'`, derivado de si existe fila en `user_requests_by_ecommerce_request` (`Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:14-15`, `Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:43-45`). **No distingue autogestión**: la colapsa dentro de `merchant`.
- `wizard` — `channel` de analytics con 5 valores (`analytics-taxonomy.ts:44-50`) y, sobre todo, `session_type = origination | client_biometric`, con **20 segmentos de path** (confirmation, identity-validation, sign-documents, otp-validation, imei, abaco…) que marcan dónde **el cliente toma el teclado** aunque el canal sea el del asesor (`app/utils/analytics-taxonomy.ts:78-104`).

**Y en `legacy-backend` el handoff lo decide un FLAG, no el canal** (`UserRequestService::updateUserRequest`,
verificado contra `main` el 2026-09-16). Al elegir entidad hay dos ramas excluyentes:

    if ($lenderByAllied->user_self_management && $url != '')      → WhatsApp con $url · showModal = true
    else if (auth() === null && !$allied->self_managed
             && !isset($ecommerceRequestId))                       → modal «continuá con el asesor comercial»

⚠ **`$url` no es siempre nuestro**: para rt=0/1 es la URL **de la entidad** (el cliente termina en Welli),
y para rt=2/3/4 sin credencial es `/self-service/<hash>/<ureq>/confirmation`, que es NUESTRA pantalla.
El mismo mecanismo manda dos cosas distintas.

⚠ **Consecuencias que contradicen el modelo intuitivo «asesor = manda WhatsApp»:**
- **Con asesor y el flag APAGADO no se manda nada**: el checkout de la entidad se abre en una pestaña en
  la pantalla del asesor (`openNewTab`), y el cliente no recibe ningún link.
- **En autogestión con una entidad EXTERNA y el flag encendido, el WhatsApp SÍ sale** — no hay
  continuación en plataforma, así que la guarda no aplica y el link de la entidad se envía igual.

**Quién decide si el flujo sigue en el lugar: `LenderTabBehaviorResolver::continuesInPlace()`**
(`Modules/Onboarding/App/Services/lenders/`). Con el trío `auth()` + `allieds.self_managed` +
`lenders_by_allieds.user_self_management` decide si se puebla `continueUrl`, que es lo que hace que el
front siga derecho en vez de mostrar la pantalla de entrega. El asesor autenticado manda sobre la
configuración del comercio.

⚠⚠ **Y `isset($ecommerceRequestId)` de esa condición es SIEMPRE FALSO.** El payload de la selección que
manda el front es `{lender_id, fee_number, original_amount, amount, initial_fee, rate, transaction_data}`
(`LoanRequestPayload` en `lenders-marketplace/src/lib/domain/entities/loan-option.entity.ts`) — ese campo
no viaja. O sea que la exclusión de ecommerce del modal **nunca excluyó nada**, y una compra de tienda
recibe el modal «continuá con el asesor» igual que si hubiera entrado sola. El vínculo real está
persistido desde el checkout y vive en TRES lugares: `ecommerce_requests.user_request_id`,
`.original_user_request_id` y la tabla puente `user_requests_by_ecommerce_request` — el mismo trío que ya
excluye `UserRequestV1\App\Repositories\UserRequestRepository::findWithEcommerceExclusions()`.

⏳ **PENDIENTE DE MERGE** — en la rama `qa` (PR `legacy-backend#1409`) el canal pasa a ser un valor con
nombre (`OnboardingOrigin`) resuelto del vínculo persistido, el pedido de la tienda gana sobre la sesión,
y `continuesInPlace` se reduce a «entrega sólo el mostrador». En `main` sigue vigente lo de arriba.

**El QR de la pantalla de confirmación NO es un plan B del WhatsApp: es por el DISPOSITIVO.**
`RedirectIdValidationIfDesktop` (`app/Http/Middleware/`) envuelve la validación de identidad y mira el
user-agent:

- **navegador de escritorio** → corta con **HTTP 403** y cuerpo `{userRequestId, qrUrl, message:
  'continue-link-sent'}`, genera un QR de `/self-service/<hash>/<ureq>/confirmation`, lo sube a S3 como
  `temp/continue-<ureq>.png` **público**, y **además** manda el WhatsApp (`sendContinueLinkWhenDesktop`),
  acotado a **una vez por día** por solicitud (`checkIfContinueLinkWhenDesktopWasSentToday`).
- **celular** → borra ese objeto de S3 y deja pasar.

El motivo es que la identidad necesita cámara. Manda **las dos cosas** —el QR para escanear ahí mismo y
el link por si prefiere el celular—, así que «salió un QR» no significa que el WhatsApp haya fallado.

⚠ **Y ese 403 explica un síntoma que ya confundió**: `/initial-fee-payment` responde `continue-link-sent`
para las entidades en plataforma, y mandarlas al cobro por pasarela rompe el flujo.

⚠ **Hay TRES QR distintos y conviene no confundirlos:** el de escritorio de arriba (identidad) · el de
**República Dominicana**, que con `$allied->country_id == 60` fuerza `qrUrl` + `showModal` en la
selección misma, antes de todo lo demás · y el del canal **Corbeta → Bancolombia**, que es otro recorrido
entero (nodo `bancolombia`). El primero los genera `App\Actions\Qr::create()`, que **manda la URL a un
servicio de terceros** (`generator.qrcode.studio`) y deja la imagen en un bucket público; `QrService`
documenta que para payloads que no son URLs públicas va `generatePayloadSvg()`, que renderiza local.

**Actores no humanos.** `api.{host}` es la superficie de máquinas: webhooks de lenders con Sanctum + ability (`ability:Pash`, `ability:prami`, `routes/api.php:41-60`), y alguno sin auth con el comentario explícito de que *"la key en base64 es la única barrera de seguridad"* (`routes/api.php:36-39`). Además el asesor **sale** hacia los lenders como dato: `Onboarding\AlliedBranchController::getByHash` devuelve el email del `corporateUser` de la última solicitud de ese usuario en esa sucursal, para el `advisory_code` de Welli y el bloque `store` de Meddipay/Prami; si no hubo asesor cae al hardcode `admin.ecommerce@creditop.com` (`Modules/Onboarding/App/Http/Controllers/AlliedBranchController.php:16`, `Modules/Onboarding/App/Http/Controllers/AlliedBranchController.php:100-123`).

**Cliente en apuros → asesor.** Cuando la validación de identidad falla, `ManualValidationService::triggerManualValidation` notifica por SMS/WhatsApp a los usuarios del comercio que tengan el permiso `validate identity manually` (`legacy-backend/Modules/Identity/App/Repositories/UserRepository.php:31-38`), más una lista de **5 celulares personales hardcodeados** de gente de CreditOp (`ManualValidationService.php:18-24`, `Modules/Identity/App/Services/ManualValidationService.php:66-70`); el desenlace lo ejecuta `Admin\UserController@manualValidation` (`legacy-backend/app/Http/Controllers/Admin/UserController.php:195`).

**El listado de entidades ya NO es un GET anónimo.** `/entidades/{userRequest}` y `/entidades-v2/{userRequest}`
llevan el middleware `loanFlowStarted` (`EnsureLoanFlowStarted`, alias en `app/Http/Kernel.php:115`):
solo entra quien inició la solicitud en esa sesión. El motivo está escrito en la propia ruta
(`routes/customer.php:168-172`): esas URLs quedaron indexadas y **cualquier GET de Googlebot disparaba
todas las consultas de preaprobado contra los proveedores**. Consecuencia práctica: pegarle directo a
esas rutas rebota; el asesor que retoma desde `/solicitudes` sí pasa porque `validateTempUsers` llama
a `LoanFlow::markStarted()` a mano (`UserRequestController.php:1514`).

**(2026-08-28) Re-verificación asistida de los 20 archivos derivados** (worker → 6; las 2 que
invalidaban, verificadas — ciertas): **la fuga del reporte de originados está ARREGLADA** — el export
filtra `when(hasRole('Entidad Comercio'))` al `lender_id` del usuario autenticado
(`CreditopXRequestsReportExport:131`); un usuario de entidad ya no baja créditos ajenos, y el reporte
además excluye pruebas. Y la lista de celulares de validación manual **creció a 7** (se sumaron dos
líneas — sigue siendo hardcode de personas, ahora más grande). Más: el actor codeudor con middlewares
propios, deduplicación del refresh de Cognito, candado write-once en el origen del usuario, y los
permisos del comprobante.

### Dos permisos nuevos de septiembre, y lo que cada uno revela

**`register creditop x payments` (id 74) — antes no había NINGUNA autorización.** Registrar un pago estaba disponible para cualquiera que pudiera ver el módulo de créditos originados. Desde el 2026-09-02 es un permiso propio, que se puede prender y apagar **por comercio y por perfil**. El chequeo vive dentro de `PaymentDialog` —lo que cubre de una las siete pantallas que lo montan— **y en las rutas de pago y de OTP, que no tenían autorización en absoluto**. Un seeder de backfill se lo dio a todos los que ya podían registrar pagos, y un comando de artisan lo otorga o lo quita por comercio (`application/app/Console/Commands/RegisterPaymentPermissionCommand.php`). Medido en prod el 2026-09-18: **1.740 usuarios** y **1 rol** lo tienen — o sea que el backfill hizo su trabajo y el permiso hoy **no restringe a casi nadie**; su valor es poder apagarlo puntualmente.

**`view commercial users in statistics` (id 75) — y el descubrimiento que lo motivó.** Por defecto las estadísticas **excluyen** a los clientes ligados a cuentas comerciales; este permiso los deja entrar. Medido en prod el 2026-09-18: lo tiene **un solo usuario** y **ningún rol**, así que para todo el resto las cifras van depuradas. ⚠ **Lo que importa acá es por qué hizo falta:** la normalización del criterio comercial sólo contemplaba `perfil-documento` y no `perfil-documento-tN`, así que sobre una cuenta de pruebas deshabilitada quedaba `documento-tN` y **el cliente real con esa cédula no se excluía**. Medido en producción: **224 clientes con 668 solicitudes y 32 desembolsos** estaban inflando las cifras. Hoy se quita primero el sufijo `-t…` y después el prefijo de perfil. ⚠ Y las cuentas comerciales de **prueba** quedan fuera **siempre**, incluso con el permiso: el permiso abre los comerciales reales, no los de prueba. Es el mismo sufijo `-tN` que deja el deshabilitado de usuarios, visto desde el otro lado: **una cuenta comercial deshabilitada sigue chocando con la cédula de un cliente real.**

**(2026-09-19) Nodo RE-VERIFICADO entero.** 18 afirmaciones auditadas contra `main`, cero chequeos
débiles y ninguna falsa. Exactos: los **12 roles** del seeder y su orden, los **11** que pasan por
Fortify, los **cinco celulares de staff** con su nombre al lado, la contraseña inicial igual a la
cédula, y el gemelo de `Identity` que **sigue definido y sin una sola ruta**. Lo corregido son sobre
todo **conteos que crecieron** —31 permisos sembrados, 47 `hasRole('Entidad Comercio')`, 207 rutas— y
un **ejemplo que caducó sin que la regla caducara**: el archivo que este nodo usaba para ilustrar el
`when()` que falla abierto dejó de filtrar por rol, pero el patrón **está en 28 archivos** entre los
dos monolitos. ⚠ Y al ir a buscarlo apareció un hardcode de persona que no estaba en la lista: ese
mismo export se renderiza **haciéndose pasar por un correo personal quemado**.

⚠ **Una cosa que NO pude re-derivar y por eso queda marcada:** el reparto «~173 de 203 sin `auth`». El
total sí se re-contó (207), pero los grupos anidados de `routes/customer.php` hacen que un conteo
automático dé cualquier cosa —probé dos y dieron 139 y 205—, así que **el número fino queda sin
confirmar**. Lo que sostiene el bullet es la forma, no la cifra.

## Dónde mirar
- **Mapa de superficies** — application: `app/Providers/RouteServiceProvider.php:49-76` (4 subdominios + namespace por actor) · `app/Http/Kernel.php:32-87` (grupos; sólo `admin` trae `Authenticate` en `app/Http/Kernel.php:74`; aliases `onlyMobile`/`onlyWithUser` en `app/Http/Kernel.php:110-113`, `loanFlowStarted` en `app/Http/Kernel.php:115`). En legacy-backend, junto a `auth.cognito` (`legacy-backend/app/Http/Kernel.php:66`) hay ahora `cognito.token` → `EnsureCognitoAccessToken` (`legacy-backend/app/Http/Kernel.php:67`).
- **Puertas de login** — `app/Providers/FortifyServiceProvider.php:27-42` (11 roles → admin) · `config/fortify.php:49`+`config/fortify.php:92` · `app/Http/Controllers/Customer/AuthController.php:29-32` (sólo Comercial) · `app/Http/Controllers/Profile/LoginCellphoneController.php:21-48` · `app/Http/Middleware/Authenticate.php:20-24` (matriz de redirect) · `app/Http/Middleware/RedirectProfileIfDesktop.php:17-26`.
- **Identidad y roles** — `legacy-backend/app/Models/User.php:32-64` (fillable), `legacy-backend/app/Models/User.php:165-183` (`getFilteredIds`, el `-t%`), `legacy-backend/app/Models/User.php:206-209` (relación muerta a `CorporateUser`), `legacy-backend/app/Models/User.php:219-222` (`lender()` = rol Entidad), `legacy-backend/app/Models/User.php:237-240` (`generatedUserRequests`), `legacy-backend/app/Models/User.php:304-307` (`branches`) · `database/seeders/RolesTableSeeder.php:25-38` · `database/seeders/ModelHasRolesTableSeeder.php:21-28` · migraciones `database/migrations/2014_10_12_000000_create_users_table.php:17-22`, `…create_user_profiles_table.php`, `…create_corporate_users_table.php` (sin `user_id`).
- **Alta / baja del asesor** — `app/Http/Controllers/Admin/AlliedCorporateUserController.php:58-60` (perfiles asignables), `app/Http/Controllers/Admin/AlliedCorporateUserController.php:71-96` (crea en `users`, prefijos, password=cédula), `app/Http/Controllers/Admin/AlliedCorporateUserController.php:105-112` (permisos CreditopX), `app/Http/Controllers/Admin/AlliedCorporateUserController.php:130-145` (soft delete `-t{n}`) · gemelo API: `legacy-backend/Modules/Partner/App/Http/Controllers/AlliedCorporateUserController.php` bajo `Modules/Partner/routes/api.php:17`.
- **Alcance por rol** — `app/Services/UserProfilingService.php:202-235` (+ `app/Services/UserProfilingService.php:190-198` `production_date`) · gemelo `legacy-backend/Modules/Loans/App/Repositories/UserRequestRepository.php:97-138`.
- **Permisos / módulos** — `database/seeders/PermissionsTableSeeder.php` (30) · `database/seeders/RoleHasPermissionsTableSeeder.php:17-87` · `app/Http/Middleware/HandleInertiaRequests.php:42-48` · `resources/js/navigation/vertical/configuration.js` (`can:`, `hiddenForCountries`) · `app/Http/Requests/Admin/User/ManualValidationRequest.php:16` · `app/Http/Controllers/Admin/AlliedModulesController.php:20-71` y su consumo real en `app/Http/Controllers/Admin/UserRequestController.php:375-380` · `…database/migrations/2023_10_12_173144_create_status_per_profiles_table.php:14-26`.
- **Cognito** — asesor: `frontend-monorepo/apps/loan-request-wizard/utils/auth/auth.server.ts:29-54`, `utils/auth/auth-helpers.server.ts:15-45`, `app/routes/auth/callback.tsx:10-23` · cliente: `legacy-backend/Modules/Onboarding/App/Services/CognitoService.php:79-101`, `legacy-backend/Modules/Onboarding/App/Services/CognitoService.php:121-149` · resolución: `legacy-backend/app/Http/Middleware/ResolveCognitoUser.php:15-32` + `legacy-backend/app/Http/Kernel.php:66` · enrolamiento: `legacy-backend/Modules/Onboarding/App/Http/Controllers/UserController.php:44-96` (rutas en `Modules/Onboarding/routes/api.php:36-42`).
- **SSO wizard→aliados** — `frontend-monorepo/.../app/utils/aliados-sso.server.ts:7-23` · `.../app/routes/auth/aliados-sso.tsx:27-31` · `application/app/Http/Controllers/Customer/SsoCognitoController.php:67-91` (mapeo por email + `hasRole('Comercial')`), `application/app/Http/Controllers/Customer/SsoCognitoController.php:100-116` (HMAC + 300 s) · ruta: `application/routes/customer.php:35`.
- **Canal y handoff** — `application/app/Http/Controllers/Customer/RegisterCellPhoneController.php:134-135` · `.../Customer/ConfirmationController.php:80-106` (`openNewTab` en `application/app/Http/Controllers/Customer/ConfirmationController.php:101`) · `application/app/Models/UserRequest.php:45`+`application/app/Models/UserRequest.php:50` (`self_management`) · `legacy-backend/Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:14-15`,`legacy-backend/Modules/Loans/App/Http/Middleware/AddOriginationFlowType.php:43-45` · `frontend-monorepo/.../app/utils/route-helpers.ts:4-15`+`frontend-monorepo/apps/loan-request-wizard/app/utils/route-helpers.ts:88-99` · `.../app/layouts/default-layout.tsx:21-24`,`frontend-monorepo/apps/loan-request-wizard/app/layouts/default-layout.tsx:78-89` · `.../app/layouts/public-layout.tsx:8-16` · `.../app/utils/analytics-taxonomy.ts:44-65`,`frontend-monorepo/apps/loan-request-wizard/app/utils/analytics-taxonomy.ts:78-104`.
- **Cambio de sucursal del asesor** — `application/app/Http/Controllers/Customer/UserAllyBranchController.php:14-22` (cache `user-{id}:ally-branch` con TTL hasta fin de día; sólo rol Comercial).
- **Cliente autenticado post-crédito** — `frontend-monorepo/.../app/routes/consumer-hub/otp-login.tsx:108-120` (OTP → AccessToken de Cognito → `session.set("user", …)`), API en `legacy-backend/Modules/Loans/routes/api.php:129`.
- **Máquinas** — `application/routes/api.php:36-60` (Sanctum + `ability:`; `/voucher/regenerate` sin auth) · `legacy-backend/Modules/Onboarding/App/Http/Controllers/AlliedBranchController.php:16`,`legacy-backend/Modules/Onboarding/App/Http/Controllers/AlliedBranchController.php:100-123` (email del asesor hacia los lenders).
- **Cliente en apuros** — `legacy-backend/Modules/Identity/App/Services/ManualValidationService.php:18-24`,`legacy-backend/Modules/Identity/App/Services/ManualValidationService.php:66-70` · `legacy-backend/Modules/Identity/App/Repositories/UserRepository.php:31-38` · ruta `legacy-backend/Modules/Identity/routes/api.php:57`.

## Lo que NO está verificado
- El reparto real de permisos por rol vive en la BD (`role_has_permissions`), no en el seeder — el seeder mapea menos permisos de los que existen.
- Conviven dos formas de decir «sucursal del usuario» (`allied_branches_by_user` vs `users.allied_branch_id`, más el override en caché): sin determinar cuál gana en cada pantalla.
