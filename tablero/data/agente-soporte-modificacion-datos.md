---
id: 46
title: "Agente Soporte — modificación de datos con autorización del cliente por WhatsApp"
ramas: support-bot
stage: work
created: "2026-08-11T18:20:00-05:00"
context_nodes: [actors, application, microservicios, servicing, backoffice]
jira: [CORE-258]
jira_title: "Agente de soporte: modificación de datos"
---

# Agente Soporte · modificación de datos

> **CORE-258** · `🧪 En pruebas` en Jira · **5 pts** · nació en **Sprint 8** y se arrastró sin terminar
> · **MERGEADO a `staging` el 2026-08-14** (PR #1095): los 16 endpoints del canal, desplegados y
> verificados en el ambiente. Falta la variable de entorno para que atienda.
>
> Los 9 criterios de aceptación de Jira están completos allá (4.406 caracteres). Acá no se repiten:
> abajo está lo que se averiguó del sistema y lo que se decidió, que es lo que Jira no tiene.

## Si retomás esto sin contexto, empezá acá  ·  actualizado 2026-08-20

**Qué es:** canal de WhatsApp para que un asesor pida cambios de datos de un cliente y el cliente los
autorice (más una autogestión del cliente para fecha de pago y plazo). Código en `Modules/SupportBot`
de `legacy-backend`, mergeado a `develop` (PR #1128) y `staging` (PR #1095).

**Dónde está de verdad (2026-08-20):** ✅ **el bloqueo de infra está CERRADO y el canal responde en
dev.** Las tres piezas quedaron: el módulo desplegado, las 16 rutas expuestas en el API Gateway, y
`SUPPORT_BOT_TOKEN` seteado. Verificado de punta a punta contra el gateway público — la guarda quedó
viva (sin token o con uno inválido da 401, con el correcto pasa al controlador) y una consulta con datos
inexistentes contesta 404 `CLIENT_NOT_FOUND`, o sea que llega hasta la base.

**El próximo paso es:** seguir validando el flujo del cliente **en local** hasta que esté completo, y
recién entonces armar **un PR con todo** (decisión de Miguel). Lo acumulado está en la rama
**PR https://github.com/Creditop-SAS/legacy-backend/pull/1166** (`feat/CORE-258-solicitud-operable` →
`develop`, abierto el 2026-08-20): 9 archivos, +705/-19, 6 defectos del canal + 1 latente, **68 tests en
verde**. Validado en local de punta a punta los DOS caminos —fecha y plazo— sobre créditos rt=2. ⚠ El
repo **no tiene checks de CI** en la rama: lo que valida es lo corrido a mano y la suite del módulo.

🔴 **Lo más importante que salió del flujo del cliente** (Registro (18)): el canal permitía cambiarle la
fecha y el plazo a créditos que **CreditOp no opera** — se le cambiaron a tres de Credifamilia (`rt=4`)
probando. Ahora sólo son gestionables los de `response_type = 2` («Creditop X»), y la comprobación está
en **dos lugares** a propósito: el filtro de la lista y una guarda en la ruta, porque el id va en la URL
y es enumerable. Pendiente de producto: confirmar el tope de **4** créditos por cliente.

Y pendiente de producto: `POST /change-requests/{id}/otp` está **inalcanzable** y la causa está entendida
(Registro (14)) — recomendación **sacarlo**.

ℹ La fila del asesor en dev (`users.id=1827130`) **se deja con el celular de Miguel a propósito**, para
poder repetir pruebas con entrega real. No es olvido: es la decisión.

✅ **El objetivo central de la tarea está DEMOSTRADO contra dev**: el cambio se escribió con un `otp_id`
real y validado, no con el `0` de producción.

✅ El defecto de `credits/*` (`find()` en vez de `findById()`) está **arreglado y desplegado en dev**.

✅ **El OTP ya está probado y funciona** (ver Registro 2026-08-20 (5)). Y para probar **no hace falta
mandarle un WhatsApp a nadie**: hay 34 teléfonos en `settings.qa_otp_bypass_phones` donde el bypass
evita llamar al proveedor y el código es los últimos 4 dígitos del número.

⚠ **Para no repetir el error que costó dos vueltas:** hay **dos** despliegues con la misma familia
`legacy-backend-develop` en cuentas AWS distintas. La cuenta `697767917359` corre la revisión 199 con 1
tarea y **no es la que atiende**; la que atiende corre 2 tareas. Si vas a medir algo de infra, confirmá
primero la cuenta — ver Registro 2026-08-20 (3).

**Lo que ya NO hay que investigar:** el gateway (hecho, 16 rutas, prefijo `/legacy-api/support/*`, host
`legacy-backend.develop.internal.creditop.com`), que el módulo esté desplegado (lo está: responde 503,
no 404) y que el token que dieron tenga forma válida (la tiene: 64 hex). El OTP también está construido.

---

## Estado del código — 2026-08-14 · **PRIMER TRAMO EN REVIEW**

**PR [#1095](https://github.com/Creditop-SAS/legacy-backend/pull/1095) → `staging`, mergeable**, un
solo commit **`9e094e20`**, 29 archivos, +1846 / −464. Rama
`feature/support-bot-onto-staging` en `legacy-backend`, sobre el HEAD de `origin/staging`
(`eddc3644`). **27 tests del módulo en verde.**

Qué trae: el módulo `Modules/SupportBot` (proveedores, rutas, middleware de token,
`ClientLookupService`, `SelfServiceController`, `SupportBotRequest`, `AuthorizationState`, comando de
humo), las **3 migraciones**, y el refactor de los dos `CreditChangeController` (Consumer + Customer)
extrayendo `CreditChangeService`.

**LOS 16 ENDPOINTS ESTÁN CONSTRUIDOS**, y coinciden uno a uno con los de los prototipos. Del canal no
falta código: lo que queda es desplegar y dos decisiones sin dueño (ver §«Preguntas abiertas»).

### Lo que se decidió con Miguel el 2026-08-14, en orden

1. **Todo lo que consume el bot entra por `/api/support/*`**, incluidas las 5 capacidades que también
   existen como endpoints del crédito. Ver el bloque en §«Las APIs a entregar».
2. **La validación de `wa` se deja sin formato** (presente, texto, ≤32). Un `wa=abc` sale por 404,
   indistinguible de un número no registrado.
3. **El backend lleva sólo el estado de AUTORIZACIÓN**; el recorrido conversacional es de n8n. Ver
   §«Reparto del trabajo» → «el estado eran dos cosas».
4. **El correo queda fuera por alcance.** Los prototipos sólo recorren celular, fecha de pago y plazo.
   Sumarlo después es una línea en `CAMPOS_CONTACTO` más su validación de forma.
5. **La autogestión exige celular + cédula.** El número dice de quién es la línea, la cédula de qué
   crédito hablamos. Una cédula que no coincide responde con el cuerpo **idéntico** al de un número no
   registrado: distinguirlos sería un oráculo, porque `by-phone` ya deja ver 7 de los 10 dígitos del
   documento y se podría completar el resto probando.
6. **El OTP es nuestro, no de n8n.** Filipo propuso validar el código de su lado y avisarnos «está
   correcto»; se descartó porque el `otp_id` desaparecería y un booleano en un request es una
   afirmación, no una prueba. La diferencia con su propuesta es un solo paso: nos reenvía el código en
   vez de un «sí». Para él es menos trabajo —no guarda códigos, ni vencimientos, ni contadores— y lo
   protege: si hay una disputa, «el workflow dijo que estaba ok» le pone la responsabilidad encima.

### 🔴 Un defecto de `main`/`staging` que el refactor destapó y corrige

Los dos `CreditChangeController` **no eran copias literales**. El de Consumer llama a
`UserRequestRepository::update()` —que existe— y el de Customer a **`updateUserRequest()`, que no
existe ni en el repositorio ni en su interfaz** (verificado: no está en ningún lado; las que se llaman
parecido son de otros servicios con otra firma).

O sea que el cambio de plazo por `requests/{id}/change-fee-number` y
`customer/requests/{id}/change-fee-number` **falla siempre** con «Call to undefined method», pasadas
la validación y la elegibilidad. Al unificar queda la llamada correcta: **esas dos rutas pasan de 500
a funcionar**. Es un cambio de comportamiento sobre una ruta que consume la app móvil, y es lo único
que yo miraría con lupa en review.

### Verificación de impacto antes de mergear

Lo que importaba no era la respuesta HTTP sino **qué queda escrito**: `creditop_x_requests_history` es
un ledger event-sourced que consumen 6 crons de servicing en `application` y 3 de bloqueo de
dispositivos en legacy (nodos `servicing` y `creditopx`).

Se ejecutaron **un cambio de fecha y uno de plazo reales**, desde el mismo estado de partida, con y
sin el cambio, contra una copia de la BD local: **mismas filas** en `creditop_x_requests_history`,
`creditop_x_changes_log`, `creditop_x_log` y `user_requests`. Para el plazo la referencia fue la
implementación de **Consumer**, que es la que sí funcionaba.

Además: nadie fuera del módulo usa `CreditChangeService`; las 4 migraciones no chocan (3 `CREATE` y 1
`ALTER` sobre tabla propia); el módulo no pisa ninguna ruta ni alias, y no hay rutas duplicadas en
todo el repo.

⚠ **Dos mediciones mías dieron falsos positivos antes de corregirlas**, y conviene saberlo para
repetir el trabajo: `opcache.revalidate_freq=2` sirve el código de la rama anterior si no se reinicia
php-fpm entre corridas, y un `git switch` falla en silencio si el árbol está sucio — con lo que se
termina comparando una rama contra sí misma. La confianza está en las corridas finales.

### 🔑 El OTP ya estaba hecho — el hallazgo que más cambia la estimación (2026-08-14)

`Modules/Onboarding/App/Services/OtpService.php` tiene el ciclo completo (`sendOtpCode`,
`validateOtpCode`, `verifyOtpCode`, `markOtpAsValidated`, `enableOtpAgain`, envío por SMS y por
WhatsApp) y la tabla `otps` tiene **295.450 filas**: está en producción hace rato. Y la firma es

```
validateOtpCode(ValidateOtpCodeRequest $req, bool $includeOtpId = false): array
```

con el docblock diciendo `'otp_id' => ?int (only when $includeOtpId)`. **Ese parámetro devuelve
exactamente lo que CORE-258 necesita como prueba de autorización.** Alguien ya lo previó. El tramo del
OTP fue **cablear, no construir**.

⚠ Dos cosas al reusarlo. Una: `OtpService` manda por **Twilio directo**
(`config('services.twilio.sms_sid')`, con `messagingServiceSid` hardcodeado), **no** por
`messaging-service` — y legacy-backend sí tiene clientes de `messaging-service` en otros lados
(`MessagingServiceClient`, `MessagingServiceRepository`). Hay **dos caminos a Twilio conviviendo**; se
eligió reusar `OtpService` tal cual y dejar la unificación como deuda aparte. Dos: `messaging-service`
sólo tiene 4 endpoints (`/api/v1/messages`, `/messages/send`, `/emails`, `/emails/send`) — es
**transporte**, no sabe de OTP. Filipo no puede resolver el OTP con él: generar y validar tiene que
ser nuestro, o el `otp_id` no prueba nada.

### El segundo factor, construido (commit `fe19d64e`)

`POST /self/otp` emite y manda; `POST /self/otp/verify` valida y abre la sesión. Encima,
`SessionService` + `SupportBotSession` sobre `AuthorizationState`.

**La decisión que define el diseño: el `otp_id` NUNCA sale en una respuesta.** Se guarda en el
contexto de la sesión y de ahí lo van a leer los endpoints de cambio. Si viajara al bot, éste podría
reusarlo o inventarlo y la fila de auditoría volvería a no significar nada. Hay un test que se pone
rojo si alguien lo agrega a la respuesta.

Detalles que costaron pensarse y conviene no revertir por descuido:

- **Los intentos se cuentan en la BD** (3), no en memoria: reiniciar n8n no puede regalar intentos o
  el código de 6 dígitos sería fuerza-bruteable. Al agotarlos vuelve a `identified` —sigue siendo
  quien es, pero la prueba empieza de cero— **y se resetean**, si no el reintento nacería agotado.
- **`lockForUpdate` en las transiciones**: dos mensajes del mismo número pueden llegar casi juntos
  (WhatsApp no serializa nada) y sin el lock dos fallos concurrentes contarían como uno.
- **Un `code` con letras se rechaza por forma ANTES de tocar el OTP**: un error del orquestador no
  debería costarle a la persona uno de sus tres intentos. Con `wa` es al revés y a propósito, porque
  la consecuencia es distinta.
- **La sesión dura 15 minutos** y el reloj se reinicia al verificar, no al empezar a escribir.
- ⚠ **En local el código siempre valida**: `ONBOARDING_DRIVER_OTP=fake`. La rama del código
  equivocado sólo se ejercita en los tests, con el `OtpService` simulado. Por eso el mock está: el
  real manda un SMS de verdad por Twilio, y contra la copia local —que es un dump de prod— le
  llegaría a un cliente real.

### Cómo se llegó acá (por si hay que reconstruir el razonamiento)

- La rama nació de `main`; se pidió bajarla a `staging`. Se hizo por cherry-pick, verificado línea por
  línea: las **1793 agregadas y 464 borradas son idénticas** a las de la rama sobre `main`, salvo las
  dos comas de las listas de módulos. La rama original `feature/support-bot` (commit `e535c605`) queda
  como respaldo, y su **PR #1089 se cerró** apuntando al #1095.
- Conflictos del trasplante: `composer.json` y `modules_statuses.json`, los dos «ambos agregaron al
  final de la lista». ⚠ `staging` **no tiene** los módulos `Backoffice` ni `Auth` ni la dependencia
  `firebase/php-jwt`; este módulo no usa ninguno, verificado clase por clase sobre los `use` del
  commit.
- ⚠ **`staging` y `main` son líneas largamente divergidas**: se separaron el 2026-07-22 (`21e46a0d`) y
  `main` le lleva ~117 commits. Cambiarle la base a un PR desde GitHub **no sirve** — mostraría esos
  117 como ruido. Hay que rebasar.
- **El refactor no cambia comportamiento, medido**: se compararon **144 peticiones** a los 18
  endpoints que pasan por los controllers refactorizados —mismo id, mismo endpoint— contra `staging`
  sin el cambio: idénticas en código HTTP, cuerpo y claves (80×200, 64×422). ⚠ Hay que **reiniciar
  php-fpm entre corridas**: `opcache.revalidate_freq=2` sirve el código de la rama anterior y
  contamina la comparación (me pasó, y la primera medición dio un falso «mejoró»).

### Defecto propio encontrado y arreglado: el 302

`FormRequest` elige el formato de la respuesta con `expectsJson()`, o sea con la cabecera `Accept` del
cliente. Sin ella responde **302 al home** y deja los errores en sesión — correcto para un formulario
web, inservible para el bot, que no tiene navegador y puede no mandar `Accept`. Medido: una llamada
sin el parámetro `wa` recibía la página de inicio, que el bot no puede distinguir de una caída.

Arreglado con `SupportBotRequest`, base del canal que sobrescribe `failedValidation`. **No** se fuerza
la cabecera de entrada a propósito: cambiaría también el formato de los errores que no son de
validación. Los 11 endpoints que faltan heredan el comportamiento.

**Decidido: la validación de `wa` se queda como está** (presente, texto, ≤32 caracteres, sin validar
formato de teléfono). Consecuencia aceptada: un `wa=abc` pasa la validación y sale por
`404 CLIENT_NOT_FOUND`, indistinguible de un número real no registrado.

### Migraciones: **ya corridas en la BD de dev/staging**

Las 3 tablas creadas el 2026-08-14, **0 migraciones pendientes** allá. Los 3 pendientes que había en
dev eran exactamente los de esta tarea, así que no se arrastró nada ajeno. Son puro `Schema::create`,
sin `ALTER` sobre tablas existentes ni foreign keys, y con `dropIfExists` en el `down()`: reversible
con `migrate:rollback --step=3`. **Quedan pendientes para producción.**

### Validado contra la BD de dev

Con la app local corriendo este código apuntada a la base de dev (227.793 usuarios allá contra
228.048 en la copia local — así se comprueba que de verdad leía dev). Los 8 casos correctos: 401 sin
token y con token equivocado, **422 sin el parámetro `wa`** (el 302 arreglado), 404 para número
inexistente / `TEMPORAL USER` / perfil no-cliente, y 200 con documento enmascarado para un cliente
real, en formato nacional y en formato Twilio. **Las 3 tablas del canal quedaron en 0 filas**: el
canal lee y no escribe.

### Para desplegar — el estado de infra (medido contra dev el 2026-08-20)

De los tres puntos, **dos ya están hechos** y queda uno:

> **MEDICIÓN · 2026-08-20** — contra el API Gateway público de dev, el canal responde 503
> `CHANNEL_NOT_CONFIGURED` con y sin token. Prueba que `SUPPORT_BOT_TOKEN` está VACÍO en el backend.
> `curl -s https://api.dev.creditop.com/legacy-api/support/clients -H "Authorization: Bearer <token>"`
> `# 503; ruta inventada → 404, así que el 503 viene del backend, no del gateway`

1. ✅ **`SUPPORT_BOT_TOKEN` — RESUELTO el 2026-08-20.** La clave estaba en el secreto de la cuenta
   equivocada; se agregó en la que corre el servicio y con el redespliegue el canal empezó a responder.

   > **MEDICIÓN · 2026-08-20** — el canal pasó de 503 a 422 a las 11:24:36, con la revisión nueva ya
   > corriendo. Sin token y con token inválido da 401; con el correcto, 422 del controlador. Y
   > `self/by-phone` con un número inexistente da 404 `CLIENT_NOT_FOUND`: la cadena llega a la BD.
   > `curl -s -o /dev/null -w '%{http_code}' https://api.dev.creditop.com/legacy-api/support/clients -H "Authorization: Bearer <token>"`

   **La lección, porque costó dos vueltas:** el 503 del middleware significa «el token esperado está
   VACÍO», no «el token no coincide» —eso es 401—. Esa distinción es la que permitió saber, sin acceso a
   la cuenta correcta, que la variable no llegaba al contenedor. Y el nombre de familia de la task
   definition es el MISMO en las dos cuentas, que es lo que hizo fácil medir en la que no atiende.

   *(Lo que decía antes acá — «el secreto está, la task definition quedó vieja» — estaba medido en la
   cuenta 697767917359, que no es la que sirve dev. Ver Registro 2026-08-20 (3).)*

   > **MEDICIÓN · 2026-08-20** — el secreto `dev/legacy-backend` tiene 164 claves, incluida
   > `SUPPORT_BOT_TOKEN` (64 hex, correcta). La task definition `legacy-backend-develop:199` enumera
   > **163**. La diferencia es exactamente 1: la que se agregó.
   > `aws ecs describe-task-definition --task-definition legacy-backend-develop --query 'taskDefinition.containerDefinitions[].secrets[].name'`

   **Por qué agregar la clave al secreto NO alcanza.** El módulo de Terraform arma la lista de secretos
   iterando las claves del JSON (`modules/ecs-application/task-definition.tf`, local
   `service_secret_values`), pero la lee con un **data source, en tiempo de plan**. Así que la clave
   nueva sólo entra a la task definition cuando alguien vuelve a aplicar Terraform. La revisión 199 se
   registró el **2026-08-05** y el servicio sigue corriendo esa misma revisión: no se aplicó ni se
   redesplegó desde entonces.

   **Acción para infra, en dos pasos:** aplicar `environments/dev/ecs-application` (registra una
   revisión nueva con la entrada 164) y redesplegar el servicio `legacy-backend` del cluster
   `creditop-develop`. Con eso la variable llega al contenedor.

   ✅ **Y NO hace falta tocar el cableado ni limpiar caches:** el servicio ya declara
   `secret = "dev/legacy-backend"` (el lugar correcto), y `config:cache` no corre en el build ni en el
   arranque —se verificó en `Dockerfile`, workflows y `bootstrap/cache/`—, así que no hay una segunda
   pared esperando después del apply.
2. ✅ **Gateway — HECHO.** Repo `infrastructure`, commit `67df336`, mergeado a `develop` (PR #65). Las
   **16 rutas** están expuestas una por una (no por comodín) bajo el prefijo **`/legacy-api/support/*`**
   → reescritas a `/api/support/*` contra el host `legacy-backend.develop.internal.creditop.com`, sin
   authorizer de Cognito. ⚠ Ojo con el prefijo: es `/legacy-api`, no `/api` — y la URL pública es
   `api.dev.creditop.com`, sin `/dev` de stage (con `/dev` da 404).
3. ✅ **La pregunta de seguridad — CONTESTADA por la config.** El gateway NO reenvía `x-user-id`: cada
   ruta declara `overwrite:header.host` y no copia cabeceras del cliente, y las rutas de support no
   llevan authorizer, así que nadie inyecta identidad por ahí. El riesgo que se temía (que el gateway
   pasara `x-user-id` a `ResolveCognitoUser`) no aplica a `/legacy-api/support/*`, que resuelve identidad
   por OTP. **Sigue valiendo revisarlo para las rutas viejas `api/loans/consumer/credits/*`**, que sí
   dependen de esa cabecera — pero eso es otra tarea.

Un asesor no debería poder cambiar los datos de un cliente sin que el cliente se entere y lo apruebe.
Hoy puede. La tarea pone al **dueño del dato** en el medio: el asesor pide el cambio desde WhatsApp,
el cliente lo autoriza desde el suyo, y nada se escribe hasta que hay consentimiento.

**Y desde la reunión con Manuela y Filipo (2026-08-12), un segundo frente**: el cliente puede
gestionar **por su cuenta** su fecha de pago y su plazo, sin asesor de por medio. Mismo canal, misma
verdad en el backend, pero **otro recorrido** — se identifica solo y no hay tercero que autorice. Los
datos de contacto **no** entran en la autogestión: siguen necesitando a un asesor que los pida.

**Qué hay que construir**: 16 endpoints, 11 de ellos nuevos — ver §«Las APIs a entregar».

## Por qué existe — el estado de hoy, verificado

Todo esto se comprobó contra el código y la copia local de la BD (`legacy-backend-mysql-1`, schema
`creditop`) el **2026-08-11**. No es diagnóstico de oído.

| hecho | evidencia |
|---|---|
| **63 personas** pueden editar clientes | roles con permiso `update user`: Administrador (18) + Superadmin comercio (45) |
| Alcanzan a **223.915** clientes, sin filtro | `Admin/UserController@index` sólo filtra `when(hasRole('Entidad Comercio'))`; para el resto es `User::query()` pelado |
| El único rol filtrado es el que **no** puede editar | `canEditAndDelete = !hasRole('Entidad Comercio')` — la lista filtrada y el permiso de edición son disjuntos |
| No existe el chequeo de "cliente asignado" | `@edit` resuelve cualquier `User` por route-model-binding |
| `onlyUpdateEmail` no tiene autorización | `UpdateEmailRequest::authorize()` → `return true`, literal |
| La edición **no deja rastro** | `@update` es un `$user->update([...])` en transacción; ninguna tabla registra quién cambió qué |
| **Y resetea la contraseña** | `@update` escribe `'password' => bcrypt($document_number)` en cada edición ⚠ ver «Deuda aparte» |

Rutas: `legacy-application` → `app/Http/Controllers/Admin/UserController.php:149` (update), `:611`
(onlyUpdateEmail), `:61` (index). Es el **admin viejo de Inertia**; el backoffice nuevo
(`Modules/Backoffice`, React+Refine) hoy sólo **lee** usuarios.

### El vínculo asesor↔cliente existe, pero no donde uno lo busca

Esta es la pieza que decide el diseño:

- Del lado del **cliente**, `users` está **vacío**: `allied_id` y `allied_branch_id` poblados en
  **1 de 223.915**. Inservible — por eso no se puede preguntar "¿de qué comercio es este cliente?".
- Del lado de la **solicitud**, `user_requests` está **completo**: `allied_id` en 359.791 de 359.823.
  Acá sí se puede preguntar.
- Del lado del **asesor**, lo que hay es `users.allied_id` + `multiple_allieds`, poblado en **45/45**
  de los Superadmin comercio. ⚠ **NO** `allied_branches_by_user`: esa tabla tiene 430 filas pero sólo
  **1** es de un usuario con rol — está muerta como mecanismo de permisos (ver §«El modelo del
  filtro»).

Entonces **"mis clientes" = clientes con al menos una solicitud en un comercio del asesor**, y hay
que resolverlo por la solicitud, nunca por el usuario.

**Para que quede sin ambigüedad, porque es fácil recordarlo al revés** (medido 2026-08-11):

| relación | ¿existe? | poblado |
|---|---|---|
| solicitud → **comercio** (`user_requests.allied_id`) | **sí** | 359.791 / 359.823 · 99,99 % |
| solicitud → **sucursal** (`user_requests.allied_branch_id`) | **sí** | 359.790 / 359.823 · 99,99 % |
| solicitud → **asesor** (`user_requests.corporate_user_id`) | sí, pero con huecos | 316.388 / 359.823 · **88 %** |
| **usuario** → comercio / sucursal (`users.allied_id`, `allied_branch_id`) | existe la columna, **no el dato** | **1 / 223.915** |

La que **no** existe es **usuario → comercio**. La de la **solicitud** sí, y además está declarada en
el modelo (`UserRequest::allied()`, `alliedBranch()`, `corporateUser()`).

⚠ Lo que sí falta en los dos casos: **no hay foreign keys declaradas** en `user_requests` —
`information_schema.KEY_COLUMN_USAGE` no devuelve ninguna. La integridad es por convención, así que
nada impide un `allied_branch_id` apuntando a una sucursal borrada. Vale un `LEFT JOIN` defensivo
antes de confiar en el cruce.

### El modelo del filtro: por COMERCIO. No hay otro con datos

La cadena es: **el asesor pertenece a un comercio → las solicitudes tienen comercio → los clientes
son los de esas solicitudes.** Sale de `users.allied_id` (+ `multiple_allieds`) cruzado contra
`user_requests.allied_id`.

Se evaluaron los tres criterios posibles y **dos se caen por falta de dato** (medido 2026-08-11):

| criterio | ¿hay dato para los que editan? |
|---|---|
| por **comercio** (`users.allied_id`) | ✅ **45/45** Superadmin comercio lo tienen |
| por **sucursal** (`allied_branches_by_user`) | ❌ **0/45**. La tabla tiene 430 filas pero **sólo 1** es de un usuario con rol (un Comercial): está muerta como mecanismo de permisos |
| por **asesor que gestionó** (`corporate_user_id`) | ⚠ existe al 88 %, pero deja 29.609 clientes sin dueño — terminarían atendiéndose por el admin viejo, que es lo que la tarea quiere dejar de usar |

⚠ **Corrección**: una versión anterior de esta tarea recomendaba filtrar **por sucursal**. Está mal —
para los usuarios que de verdad editan ese vínculo no existe. **Por comercio es la única opción
implementable hoy.**

**Lo que consigue** (clientes visibles por Superadmin comercio, vía su `allied_id`):

| | clientes |
|---|---|
| hoy, sin filtro | **223.915** |
| mínimo con el filtro | 1 |
| **promedio** | **7.282** |
| máximo (el comercio más grande) | 105.883 |

El máximo sigue siendo alto, pero **el filtro no está para reducir el número: está para cortar el
cruce entre comercios.** Que el Superadmin de Alkosto vea clientes de Alkosto es legítimo; que vea
los de Dentix, no. Eso es lo que hoy no existe y lo que esto corta.

### La regla, en una frase (alcance decidido)

> **No se muestra ningún cliente que no haya hecho una solicitud a un comercio que el asesor maneja.**

En SQL: `user_requests.allied_id ∈ (asesor.allied_id ∪ asesor.multiple_allieds)`. Un asesor con
varios comercios ve los clientes de todos ellos, y eso **es legítimo**: la regla no es «un asesor, un
comercio» sino «ves los comercios a los que perteneces».

**Un matiz que hay que resolver, porque las dos mitades no se comportan igual.** 2.346 clientes
(1,1 % de los 213.455 con solicitud) tienen solicitudes en **más de un comercio**. Para ellos:

- **Datos de contacto** (celular, correo) — el dato es del **cliente**, no de la solicitud: vive una
  sola vez en `users`. Cambiarlo afecta también su relación con el otro comercio, y no hay forma de
  cambiar «sólo la mitad». Es inevitable, y es aceptable porque **el cliente autoriza**.
- **Condiciones del crédito** (fecha de pago, plazo) — operan sobre **una solicitud concreta**. Acá
  sí hay que acotar: el asesor sólo puede tocar las solicitudes **de sus comercios**. Si no, el
  asesor de un comercio podría cambiarle el plazo a un crédito de otro.

Es decir, **dos reglas, no una**: la de *visibilidad del cliente* (≥1 solicitud en un comercio suyo)
y la de *solicitudes operables* (sólo las de sus comercios). La segunda es más estricta y es la que
aplica al listar créditos para cambiar fecha o plazo.

#### La query — una sola, sin ramas (probada contra la copia local, 2026-08-11)

Lo que el bot hace al buscar: resuelve el documento **y** la pertenencia en un solo paso. Si el
cliente no es de un comercio del asesor devuelve **cero filas** — el mismo resultado que si no
existiera, que es justo lo que la regla del 404 indistinguible pide.

```sql
SELECT c.id, c.document_number, c.full_name, c.cell_phone, c.email
FROM users c
WHERE c.document_number = :documento
  AND EXISTS (
    SELECT 1
    FROM user_requests ur, users a
    WHERE a.id = :asesor
      AND ur.user_id = c.id
      AND ( ur.allied_id = a.allied_id
            OR JSON_CONTAINS(a.multiple_allieds, CAST(ur.allied_id AS JSON)) )
  );
```

**El `OR JSON_CONTAINS` es lo que hace que no haga falta un caso especial**: un asesor de un comercio
y uno de tres pasan por el mismo código. Verificado — la misma query, sin tocar nada, da 105.883
clientes para un asesor del comercio grande y 3.640 para el de Americana + Serta + Dormiluna
(2.140 + 107 + 1.415, menos 22 que repiten entre marcas).

**Rinde bien**, y no por casualidad: la query **arranca por el documento** (índice único → 1 fila),
sigue por las solicitudes de ese cliente (`idx_user_requests_user_id` → un puñado) y **recién
entonces** evalúa el `JSON_CONTAINS`, sobre esas pocas filas y no sobre las 359.823. El `EXPLAIN` da
`const / const / ref`, sin un solo table scan. Ya existe además `idx_user_requests_composite
(user_id, allied_id)`, que es el índice ideal para esto.

⚠ **Al revés sí duele**: para **listar todos** los clientes de un asesor (un panel, un reporte), el
`JSON_CONTAINS` se evalúa contra toda la tabla y deja de haber índice que valga. Para ese caso,
resolver primero los comercios en una consulta chica y pasar un `IN (...)`:

```sql
-- 1) los comercios del asesor (1 fila, PK)
SELECT allied_id, multiple_allieds FROM users WHERE id = :asesor;
-- 2) con esa lista ya en la mano
SELECT DISTINCT c.* FROM users c
JOIN user_requests ur ON ur.user_id = c.id
WHERE ur.allied_id IN (:comercios);
```

Misma regla, dos formas según se busque **uno** o se listen **todos**.

### ⚠ FUERA DE ALCANCE (va en otra tarea): el filtro es auto-otorgable

**Decidido el 2026-08-11: roles y permisos del admin viejo se atacan aparte.** Queda acá anotado con
el detalle para que la tarea futura no tenga que volver a investigarlo — pero **no** es trabajo de
CORE-258.

Lo que pasa hoy (verificado 2026-08-11, `legacy-application`):

- `UpdateRequest::authorize()` es sólo `can('update user')` — permiso que **Superadmin comercio
  tiene**.
- `@edit` carga **cualquier** `User` por route-model-binding, sin acotar al ámbito de quien edita.
- La UI le ofrece **todos los comercios activos**: `Allied::where('status', 1)->get()`
  (`UserController.php:134`) — **183** comercios.
- `@update` escribe `multiple_allieds` con lo que venga en el request, sin validar contra el ámbito
  del editor.

**Consecuencia**: un Superadmin comercio puede editarse a sí mismo —o a cualquier otro usuario— y
**asignarse cualquiera de los 183 comercios activos**, con lo que pasaría el filtro de forma
perfectamente «legítima» y alcanzaría hasta **195.546** clientes. Sin OTP, sin aviso y **sin dejar
rastro**, porque la edición de usuarios tampoco se audita.

**Lo que esto implica para CORE-258, dicho sin adornos:** el filtro por comercio evita que un asesor
*consulte por accidente o por curiosidad* clientes de otro comercio, y deja rastro del cambio — que
es la mejora que la tarea busca. Lo que **no** hace es frenar a quien se proponga saltarlo: puede
asignarse el comercio y pasar el filtro «legítimamente». **Es una mejora real, no un control
completo**, y conviene no venderla como lo segundo.

Lo que la tarea futura tendrá que cerrar (relevado acá, sin hacer):

1. **`multiple_allieds` y `allied_id` no editables por quien no sea staff de CreditOp.** Un
   Superadmin comercio no debería tocar el ámbito de nadie, ni el propio.
2. **La lista de comercios de la UI filtrada** por el ámbito del editor, no `status = 1` a secas.
3. **`@edit`/`@update` validando que el usuario objetivo esté dentro del ámbito del editor** — hoy
   alcanza a cualquiera.
4. **Todo cambio de ámbito auditado y notificado**, igual que un cambio de datos de contacto: es una
   escalada de privilegios y merece el mismo tratamiento.

⚠ **Efecto colateral aparte, en el mismo `@update`**: `'multiple_allieds' => empty($request->multiple_allieds) ? [$user->allied_id] : $request->multiple_allieds`.
Si alguien edita a un asesor de grupo por cualquier motivo —corregirle el correo— y el formulario no
manda `multiple_allieds`, **el campo se resetea a `[allied_id]`** y el asesor pierde en silencio los
otros comercios del grupo. El campo que sostiene el permiso se borra sin querer.

### Dos huecos que este modelo deja abiertos

1. **Los 18 `Administrador` no tienen comercio** — `allied_id` en **0/18**: son staff interno de
   CreditOp, no de un comercio, así que no hay de dónde derivarles una lista. Necesitan política
   propia: o no entran al canal de WhatsApp (y siguen por el admin, con auditoría), o entran con
   alcance total pero **cada acción registrada y notificada**. **Decisión de negocio, no técnica.**
2. **`multiple_allieds` no es decorativo**: 44/45 lo tienen poblado y **3 operan más de un comercio**
   (hasta 3). El filtro tiene que ser `allied_id ∪ multiple_allieds`, no sólo `allied_id`, o esos
   tres pierden acceso a comercios que sí gestionan.

   Se sospechó que fueran **asesores de prueba** — la intuición era que cada comercio crea su propio
   asesor y por lo tanto nadie debería estar en dos. La evidencia dice que no (local, 2026-08-11):

   - El dominio `no-email.com` **no marca pruebas**: es el de **los 45** Superadmin comercio, o sea
     el patrón normal con que se crean.
   - Los comercios son reales y con volumen: `[41,42,43]` = **Americana de colchones** (2.872
     solicitudes) + **Serta** (144) + **Dormiluna** (1.862) — tres marcas del mismo grupo de
     colchones, 4.878 solicitudes entre las tres. El otro caso es `[14,23]` = **godentist** (1.714)
     + **Wonder** (778).

   O sea el caso de negocio es el **grupo empresarial con varias marcas**, no el asesor compartido
   entre clientes distintos. La regla «un comercio, un asesor» se cumple casi siempre, pero **no es
   invariante** y romperla deja sin acceso a quien administra un grupo.
   ⚠ Medido en la **copia local**, que puede estar desactualizada respecto de producción — la forma
   del dato sí es concluyente, el conteo exacto conviene reconfirmarlo contra prod antes de decidir.

   ⚠ **Y hay referencias rotas**: el asesor 2678 tiene `multiple_allieds = [63,64]` y **el comercio
   64 no existe** en `allieds` (266 comercios, id máximo 276). Es la consecuencia directa de que no
   haya FKs: el filtro tiene que tolerar ids colgados sin romperse ni, peor, sin abrir de más.

Lo mejor: ese cruce **ya está escrito** — `DashboardController::getLegacyUserRequestIds()`, que
`@index` usa para el rol `Entidad Comercio`. No hay que inventarlo, hay que aplicarlo a quienes sí
editan. `Entidad Comercio` es el rol **13** en `roles`, y no aparece en `user_profiles` (que llega a
12): son dos tablas distintas y no espejan.

## Las dos mitades — no son la misma tarea

Salió al construir el prototipo y parte el trabajo en dos, con costo muy distinto:

### A · Datos de contacto (celular, correo) — **arranca de cero**
No hay endpoint, no hay registro, no hay consentimiento. Todo por construir.
Consentimiento: **doble check conversacional** (el cliente autoriza la gestión, después aprueba el
cambio puntual). Registro: tabla **nueva**.

### B · Condiciones del crédito (fecha de pago, plazo) — **ya casi está**
`Modules/Loans/App/Http/Controllers/{Consumer,Customer}/CreditChangeController.php` ya implementa
`changePaymentDate` y `changeFeeNumber`, y `CreditChangeValidationService` ya valida elegibilidad.
Lo que falta es **el consentimiento**, y el hueco está literalmente marcado en el código:

```php
'otp_id' => 0, // OTP validation handled by mobile app authentication
```

…en `Consumer/…:237` y `Customer/…:391`. La columna `otp_id` existe en `creditop_x_changes_log`
esperando un OTP real. La premisa del comentario ("ya autenticó la app móvil") **deja de valer por
WhatsApp**: ahí no hay app que autentique. Por eso estos dos flujos piden **código escrito**, no un
botón — que es además el criterio que pidió el negocio.

Reglas que el backend ya aplica y que el bot **no debe poder saltar** (`CreditChangeValidationService`):

| | |
|---|---|
| `HAS_PENDING_PAYMENT` | bloquea si `next_payment_amount > 0` |
| `RECENT_CHANGE_EXISTS` | un solo cambio cada **6 meses** |
| `EXTERNALLY_SERVICED` | lenders con ciclo de vida gestionado afuera |
| `NO_ACTIVE_CREDIT` / `USER_REQUEST_NOT_FOUND` | — |
| fechas ofrecidas | ciclos fijos **5 / 16 / 28**, sólo las **2 próximas** (`getNextPaymentCycles`) |
| plazos ofrecidos | `fee_numbers` de la línea de crédito, filtrado a `> installment_number` y `≤ max_fee_number` de la categoría (`simulatePossibleFees`) |

**El filtro de plazos es aritmético, no una política** — y es fácil leerlo mal. `feeNum >
installment_number` existe por el cálculo de abajo: `adjustedFeeNumber = possibleFeeNumber -
installmentNumber + 1`. Si el plazo nuevo fuera igual o menor a lo ya pagado, ese número da cero o
negativo y la amortización se rompe. Sólo garantiza que **quede al menos una cuota por pagar**.

⚠ **No significa «sólo se puede ampliar».** Con la línea `3,6,9,12,18,24,36,48`, plazo actual 12 y 3
cuotas pagadas, las opciones válidas son **6, 9, 12, 18 y 24** — todas mayores a 3. El cliente **sí
puede reducir** el plazo (pagando cuotas más altas); el actual también se ofrece, marcado
`is_current`. *(El prototipo mostraba sólo 18 y 24 — corregido.)*

Dos cosas del código que conviene no imitar: el comentario dice «must be > installment_number **and
!= current fee_number**», pero el filtro **no** excluye el actual y el closure captura
`$currentFeeNumber` sin usarlo; y el `elseif ($possibleFeeNumber <= $installmentNumber)` de más abajo
es **inalcanzable**, porque el array ya viene filtrado.

⚠ Las rutas del lado **Customer** salen con
`withoutMiddleware(['onlyMobileValidation','validate.authorized.status'])`. Revisar qué las protege
antes de exponerlas a un canal nuevo.

## Segunda propuesta: el CLIENTE se autogestiona (2026-08-13)

De la reunión con **Manuela y Filipo**: además del canal del asesor, el **cliente** puede cambiar
**él mismo** su fecha de pago y su plazo. Sólo eso — los datos de contacto **no** se autogestionan.

**Por qué el alcance es más chico y no es arbitrario**: cambiar el celular desde el propio celular no
prueba nada. Si alguien tomó el teléfono, dejarle cambiar el número de contacto le entrega la cuenta.
Fecha y plazo, en cambio, son reversibles y no mueven el canal por el que se avisa.

**Lo que cambia respecto del flujo con asesor:** no hay un segundo actor que autorice. Allá el asesor
pedía y la clienta aprobaba —dos personas, dos canales—; acá **la misma persona pide y confirma**.
Toda la seguridad se corre a la **autenticación de entrada**.

**Los tres factores, y cuánto vale cada uno:**

| factor | tipo | qué tan fuerte |
|---|---|---|
| **número de WhatsApp** | algo que tienes | **el más fuerte, y es gratis** — el bot sabe de qué número viene y ese número está en el crédito |
| cédula | algo que sabes | débil: circula |
| código al celular | algo que tienes | **⚠ no agrega seguridad acá** — llega al mismo teléfono; su valor es dejar la prueba |

⚠ **La barrera real es el celular, no los datos.** Si el número de WhatsApp no coincide con el
registrado en el crédito, **no debe pasar** — sin importar qué datos aporte. La cédula sirve para
saber de qué crédito hablamos, no para autenticar.

#### ✅ Qué se guarda como prueba — decidido 2026-08-12

Cuando alguien cambia la fecha de pago o el plazo, queda una fila en `creditop_x_changes_log`, que
tiene **cuatro datos y nada más**:

| columna | qué guarda |
|---|---|
| `user_request_id` | de qué crédito |
| `change_type_id` | qué se cambió: 1 = fecha, 2 = plazo |
| **`otp_id`** | **cuál fue el código con que el cliente lo autorizó** |
| `created_at` | cuándo |

Esa tercera columna es el punto. Apunta a la fila del código que se le mandó al cliente y que él
escribió de vuelta: **es la prueba de que el dueño del crédito dio el sí.** Hoy se escribe `0`, que
no apunta a nada — el registro dice *"se cambió la fecha"* pero no puede decir *"y así fue como el
cliente lo aprobó"*. Si alguien reclama que nunca autorizó, no hay con qué responder.

**La decisión: el cliente también escribe un código.** Se descartó pedirle la **fecha de expedición**,
que era la propuesta inicial. Dos razones:

- **Es mejor factor.** La fecha de expedición está impresa en la misma cédula: quien tenga el
  documento —o una foto— tiene los dos datos. El número de WhatsApp es *algo que tienes*, verificado
  por la plataforma; conseguirlo a distancia es mucho más difícil.
- **Y produce la prueba**, que es lo que faltaba: una fila con un código emitido a tal hora y escrito
  de vuelta a tal otra. Los **dos flujos guardan lo mismo**, sin casos especiales en la tabla.

⚠ **Con una salvedad que conviene no confundir: en autogestión el código NO agrega seguridad.** Llega
al mismo teléfono desde el que la clienta escribe, así que no prueba nada que no supiéramos — ya
sabíamos que controla ese número. **Lo que aporta es evidencia**, y da la casualidad de que el
problema del `otp_id = 0` era de evidencia, no de seguridad. Quien hace el trabajo de seguridad es la
**validación del número contra el crédito**, no el código. Vale tenerlo claro para no venderlo como
lo que no es.

**El caso que hay que resolver: número que no coincide.** La gente cambia de número. Si escribe desde
uno distinto al registrado, **no debe pasar** — y ahí aparece una vuelta incómoda: para autogestionarse
necesita que el número coincida, pero para *cambiarlo* necesita un asesor, porque los datos de
contacto están fuera de la autogestión. Es coherente con el alcance, pero **el bot tiene que decirlo
con todas las letras** en vez de responder un «no te encuentro» que deja a la persona sin salida.

**Sobre la IA.** La idea era un agente conversacional. Lo que se puede: que el bot **entienda** lo
que el cliente escribe con sus palabras («quiero cambiar la fecha en que me cobran») y lo enrute a un
flujo fijo. Lo que **no** se puede: un asistente que converse libremente — Meta lo prohíbe desde
enero de 2026 (ver §«Por qué no una librería no oficial»). El prototipo muestra la interpretación
debajo de cada mensaje libre, para que la diferencia quede visible: **interpretar la intención, sí;
improvisar la respuesta, no.**

### Reparto del trabajo: la conversación es de Filipo (n8n)

**Filipo arma la capa conversacional en n8n** — entender lo que escribe el cliente y redactar las
respuestas. Eso reabre parcialmente la discusión de §«Arquitectura del canal», y en este reparto n8n
sí encaja: no lleva la lógica de negocio ni los permisos, sólo la conversación.

⚠ **Con una condición, que es donde esto se puede torcer: el ESTADO de la sesión no vive en n8n.**
Cada mensaje entrante es un webhook independiente, y en algún lado hay que recordar en qué punto va
la conversación —si ya se identificó, qué eligió, cuántos intentos lleva—. Si eso queda en n8n:

- no es auditable (la evidencia de quién autorizó qué tiene que estar en la BD, no en un workflow);
- no sobrevive a un reinicio ni a un despliegue de n8n;
- y los límites de intentos se vuelven falsificables desde afuera.

**Entonces**: n8n manda el mensaje al backend, el backend responde *qué sigue*, y n8n lo redacta y lo
envía. El backend es dueño del estado y de la decisión; n8n, de la forma. Así la capa conversacional
se puede rehacer sin tocar la seguridad, que es justo lo que se quiere si las respuestas van a
iterarse mucho.

#### ✅ REFINADO 2026-08-14 · «el estado» eran dos cosas, y sólo una es del backend

Lo de arriba decía «el backend es dueño del estado» sin separar qué estado, y eso llevaba a que el
backend conociera los pasos del menú. **Se dividió así, y está fijado en código:**

| | quién | por qué |
|---|---|---|
| **Estado de AUTORIZACIÓN** — si se identificó, si el OTP se verificó, cuántos intentos quedan, hasta cuándo vale | **backend** | reiniciar n8n no puede regalar intentos de OTP, ni afirmar quién está autenticado. Es el mismo problema del `x-user-id`: si lo dice el llamador, no vale |
| **Recorrido de la CONVERSACIÓN** — qué menú se mostró, qué opción eligió, cómo se repregunta, en qué idioma | **n8n** | si el backend los conociera, **cada ajuste de redacción sería un despliegue del backend**, y esos pasos cambian todo el tiempo mientras se afina el canal |

**El argumento que decide**: la seguridad no necesita que el backend lleve la conversación. Necesita
que el endpoint que escribe el dato **exija un `otp_id` que el backend mismo emitió y verificó**. Con
eso, aunque n8n se equivoque o se reemplace mañana por otra cosa, no se puede cambiar un dato sin
autorización real.

**Cómo quedó en el código** (commit `9e094e20`): `Modules\SupportBot\App\Support\AuthorizationState`
—un enum PHP, no de MySQL— con **cinco estados que no crecen**: `anonymous → identified → otp_sent →
otp_verified → expired`. Fija las transiciones válidas y concentra dos preguntas: `allowsWrite()`
(sólo con OTP verificado) y `consumesOtpAttempts()`.

Del grafo, lo que más importa: **nada vuelve de `otp_verified` a un estado anterior** salvo vencer. Si
se pudiera bajar a `identified`, quedaría una sesión con menos privilegio pero reutilizable, que es la
forma habitual de ese agujero. Sí se permite `identified → otp_sent → identified`, porque reenviar el
código es legítimo (un SMS que no llega) y lo que acota el reenvío es `otp_attempts`, no el grafo.

**7 tests fijan la frontera**, incluido uno que se pone rojo si alguien agrega un estado
conversacional al enum —y el mensaje le dice dónde va ese estado— y otro que impide bajar el
privilegio. Los comentarios de la migración, que antes decían `awaiting_document` / `awaiting_otp` /
`ready`, se corrigieron: sólo cambiaron **comentarios**, cero líneas de esquema, así que la tabla ya
creada en dev sigue idéntica.

⚠ **Nadie escribió esto antes porque la tarea no lo aclaraba.** Es decisión de Miguel, tomada el
2026-08-14.

## Los prototipos

Tres, cada uno con su botón en el tablero: **`▶ asesor`**, **`▶ cliente`** y **`▶ cliente qa`**. Los dos
primeros son maquetas de la CONVERSACIÓN, para mostrarle el flujo a producto. El tercero es una
herramienta: pega contra la API de verdad.

### `…-modificacion-datos.cliente-qa.html` — **el que se le pasa a QA**

El mismo chat, pero **sin nada simulado**: cada paso llama la API de `develop` y la columna del medio
muestra la respuesta cruda de cada llamada, con su código de error y sus milisegundos. Tres cosas que lo
hacen usable por alguien que no es del equipo:

- **Cero configuración.** El token va en el archivo y el campo del mensaje viene **pre-escrito** en cada
  paso —saludo, cédula, código—, así que probar es clic, clic, clic. Pero sigue siendo un campo: se pisa
  y el canal responde como con cualquier persona.
- **La tercera columna cambia de persona.** Celular + cédula **van juntos** (cambiar uno solo da
  `CLIENT_NOT_FOUND`, que parece un bug y no lo es) y hay una lista de los clientes que existen. Avisa si
  el número **no** está en `qa_otp_bypass_phones`, porque entonces el SMS **sale de verdad** — el error
  que ya se cometió una vez en esta tarea.
- **Separa el rechazo de negocio del bug.** `HAS_PENDING_PAYMENT` o `RECENT_CHANGE_EXISTS` se muestran
  como lo que son —respuestas correctas—; sólo un 401/5xx/red se presenta como algo que hay que
  reportar. Y trae `copiar reporte`, que pega todas las llamadas en el ticket **con el token tapado**.

⚠ **Tiene que servirse por HTTP** (el botón del tablero ya lo hace, y `make soporte-qa` levanta :5199):
el gateway de dev sólo manda cabeceras CORS cuando el `Origin` es real, y un archivo abierto con
`file://` manda `Origin: null`. Medido contra el preflight el 2026-08-20.

Al lado viven sus dos compañeros, que no son prototipos sino su andamiaje:
`…cliente-qa.casos.sql` —crea el cliente de prueba, y **correrlo otra vez es el reset**— y
`…cliente-qa.LEEME.md`, las instrucciones para QA.

### `…-modificacion-datos.cliente.html` — la autogestión

Una sola conversación. El cliente entra desde su celular, escribe en sus palabras, se identifica con
cédula + un código al celular y cambia fecha o plazo. Debajo de cada mensaje libre se ve **lo que el
bot interpretó**, que es lo que permite enrutar sin ser un asistente conversacional. Dos
interruptores: crédito no elegible, e identidad que no verifica.

### `…-modificacion-datos.asesor.html` — el canal del asesor

Dos ventanas estilo WhatsApp (asesor · cliente) con las 4 opciones del menú, las dos
salidas de rechazo y el OTP como notificación fuera del hilo.

Dos interruptores arriba, ambos **apagados** por defecto, para mostrar lo que no es el camino feliz:
- **Crédito no elegible** — el bloqueo por la regla de 6 meses, que el backend ya aplica;
- **Aviso por correo** — el tercer canal, **fuera de alcance** hasta hablar con producto (§Decisiones,
  punto 3). Al prenderlo aparece la bandeja de la clienta con su propio «No fui yo».

Trae dos paneles que son, en la práctica, **la especificación**: la traza de APIs (naranja = por
construir, verde = ya existe) y la fila de auditoría que quedaría.

**El prototipo no es el diseño final** — es para aterrizar la conversación. Revisar antes de codear.

## Las APIs a entregar — **16 endpoints, 11 nuevos**

Inventario sacado de las trazas de los dos prototipos, que se armaron justamente para esto.

> ### ✅ DECIDIDO 2026-08-14 · las 16 se sirven por `/api/support/*`, sin excepción
>
> «Ya existen y se usan tal cual» se refiere a la **lógica**, no a la ruta. El bot **no** llama a los
> endpoints del crédito por su URL actual: los 5 que ya existen se envuelven en rutas del canal. La
> razón es de seguridad y se verificó leyendo el middleware:
>
> - `api/loans/consumer/credits/*` (las 3 de lectura + `can-change`) va detrás de
>   `App\Http\Middleware\ResolveCognitoUser`, que resuelve al usuario **leyendo la cabecera
>   `x-user-id` sin verificar ningún token** (son 20 líneas, no hay más). Si el bot llamara ahí,
>   tendría que declarar él mismo de quién es el crédito, y el token compartido pasaría de decir
>   «quien llama es el bot» a ser **llave maestra sobre los 228.048 clientes**.
> - `api/loans/requests/*` y `api/loans/customer/requests/*` **no tienen autenticación alguna** (sólo
>   `api` + `AddOriginationFlowType`).
>
> Bajo `/api/support/*` decide el **backend** y no el llamador: token + sesión verificada
> (`support_bot_sessions`, abierta sólo tras el OTP contra el celular que coincide). Y el `otp_id`
> ahí se puede **exigir**, cosa que en las rutas viejas no, porque rompería la app móvil que hoy las
> consume — por eso `CreditChangeService` lo recibe como parámetro que los controllers no pasan.
>
> **Consecuencia operativa:** al API Gateway se expone **una** superficie, `/api/support/*`. Las
> rutas de `credits/*` siguen como están, para la app móvil.
>
> ⚠ **Los 5 envoltorios NO van en el primer PR** ([#1095](https://github.com/Creditop-SAS/legacy-backend/pull/1095)),
> y es a propósito: hoy la tabla `support_bot_sessions` está creada pero **ningún código la usa**, no
> hay servicio de OTP y el canal tiene una sola ruta. Sin sesión, los 3 de lectura quedarían detrás
> de sólo el token con el `user_request_id` en la URL —enumerable, o sea que se podrían leer las
> condiciones de cualquier cliente— y los 2 de escritura no tendrían un `otp_id` real que pasar, con
> lo que escribirían 0: el defecto que esta tarea viene a arreglar. **Van junto con los endpoints de
> OTP**, en el tramo siguiente. La decisión quedó escrita también en
> `Modules/SupportBot/routes/supportbot.php`.

### Ya existen y se usan tal cual — 3 ✅ **ejercitadas contra datos reales 2026-08-13**

Las tres del crédito, y sirven **igual para los dos actores**: la lógica no hay que tocarla (la ruta
sí cambia — ver la decisión de arriba).

| | qué da | verificado |
|---|---|---|
| `GET /credits/{id}/can-change` | si el crédito admite cambios | ✅ `true` en créditos activos sin pago pendiente |
| `GET /credits/{id}/payment-date-options` | las 2 próximas fechas de los ciclos 5/16/28 | ✅ «28 de enero \| 5 de febrero» |
| `GET /credits/{id}/fee-number-options` | los plazos válidos con su cuota | ⚠ funciona, **pero puede devolver lista vacía** |

⚠ **Un estado que el prototipo no contempla: elegible PERO sin opciones.** El crédito `126135`
responde `can_change = true` y **cero plazos**. No es un bug: su línea de crédito ofrece `3,6,9`,
lleva 3 cuotas pagadas (deja `6,9`) y su **categoría** tiene `max_fee_number = 3`, que descarta las
dos. Son **dos preguntas distintas** y hay que hacer las dos: que el crédito admita cambios no
garantiza que haya a qué cambiarse.

**El bot tiene que manejarlo** — hoy ofrecería un menú vacío. Y el mensaje no puede ser «no se puede»
a secas, porque para la *fecha* sí se puede: es sólo el plazo el que no tiene alternativas.

**Cómo se verificó** (por si hay que repetirlo): créditos con `creditop_x_requests_history.status IN
(1,8)` — ése es el filtro de «activo» de `getActiveByUserRequest`, y ojo que **211.572 de 214.777
filas tienen `status = 0`**, así que la mayoría de la tabla no sirve para probar. Usados: `126135`
(el del caso raro), `352432` y `352520`.

### Existen pero hay que MODIFICARLAS — 2

| | qué cambia |
|---|---|
| `POST /credits/{id}/change-payment-date` | hoy escribe `otp_id = 0`; debe recibir y guardar el `otp_id` real |
| `POST /credits/{id}/change-fee-number` | ídem |

✅ **Es el corazón de la tarea, y ya está resuelto**: los **dos** flujos terminan con un código
escrito por el cliente, así que los dos guardan un `otp_id` real y **no hay caso especial**. Ver
§«Qué se guarda como prueba».

### Nuevas — 11

**Del flujo del asesor (8).** Son las que sostienen el «pide uno, autoriza otro»:

| | qué hace |
|---|---|
| `POST /support/advisor/otp` | resuelve la cédula del asesor y manda OTP **al celular del perfil** |
| `POST /support/advisor/otp/verify` | valida el código y abre la sesión |
| `GET /support/clients?document=` | busca cliente **ya filtrado por comercio**; si no es suyo, 404 idéntico a «no existe» |
| `POST /support/change-requests` | crea la solicitud en `pendiente_autorizacion` — **no escribe el dato** |
| `PATCH /support/change-requests/{id}/authorize` | primer check: el cliente autoriza la gestión |
| `POST /support/change-requests/{id}/otp` | manda el OTP al cliente (cambios de crédito) |
| `POST /support/change-requests/{id}/confirm` | segundo check: **acá sí** escribe, junto con el registro |
| `PATCH /support/change-requests/{id}/reject` | rechazo o «no fui yo» — bloquea y escala |

**Del flujo del cliente (3).** Más corto porque no hay tercero que autorizar:

| | qué hace |
|---|---|
| `GET /support/self/by-phone?wa=` | resuelve al cliente por el número de WhatsApp desde el que escribe. **Si no coincide con el del crédito, no se sigue** |
| `POST /support/self/otp` | emite el código y lo manda al celular del crédito. Reusa el `otp-service` con `identifier` = sesión, así queda la fila a la que apuntar |
| `POST /support/self/otp/verify` | valida el código y abre la sesión. Cuenta intentos |

### Lo que NO construimos nosotros

`POST /nlu/interpretar` aparece en la traza del prototipo del cliente, pero **es de Filipo**: la capa
que entiende lo que la persona escribe y la enruta. Se lista para que quede claro dónde encaja, no
como entregable nuestro.

### Cómo se reparte

De los 16, **13 los consume el flujo del asesor y 8 el del cliente** (5 son compartidos). Si hubiera
que partir la entrega, **el flujo del cliente es el más barato**: 3 endpoints nuevos y las 5 del
crédito que ya existen o sólo se modifican. El del asesor es el caro, porque el «pide uno, autoriza
otro» es todo nuevo.

**Por dónde empezar.** Las 2 que se modifican (`change-payment-date`, `change-fee-number`) son la
puerta: hasta que reciban y guarden el `otp_id` real, ningún flujo cierra su registro. Y son el
cambio más chico de los 16 — un parámetro y una escritura.

## Decisiones tomadas (y por qué)

1. **El OTP del asesor va al celular de su perfil**, no al WhatsApp desde el que escribe. Si va al
   que escribe, cualquiera con una cédula ajena y un WhatsApp entra: sería preguntar, no autenticar.
2. **El OTP debe salir por un canal DISTINTO al de la conversación** — y ⚠ **es un CAMBIO respecto de
   lo que se hace hoy, no una descripción del presente.**

   **Hoy el OTP ya viaja por WhatsApp.** `OtpServiceRepository::generateOtp(..., ?string $template)`
   arma `$payload['whatsapp_template'] = $template` y lo postea a `/api/otp/generate` del
   `otp-service` (`Modules/System/App/Repositories/OtpServiceRepository.php:28-44`); el comentario del
   bypass de QA lo confirma («no se llama al provider externo ni se envía **SMS/Whatsapp**»). De las
   cuatro llamadas, dos pasan template (`Loans/…/OtpService.php:64`,
   `Onboarding/…/OtpService.php:420`) y dos no (`Onboarding:555`, `Auth/…/AuthService.php:633`).
   ⏳ **Sin confirmar**: si va sólo por WhatsApp o por WhatsApp **y** SMS, y cuál es el template.

   **Por qué igual hay que cambiarlo acá.** Hoy está bien: el cliente recibe el código por WhatsApp
   mientras usa el **wizard web** — canal distinto del que está usando. En esta tarea es al revés: el
   cliente autoriza **dentro de WhatsApp**, así que un código al mismo chat deja de ser segundo
   factor. **La regla no es «SMS sí, WhatsApp no» — es que el canal del OTP no coincida con el de la
   conversación.**

   Costo del cambio: `messaging-service` ya manda SMS por LabsMobile (mismo
   `POST /api/v1/messages/send`, otro canal), pero falta ver si el `otp-service` sabe emitir por SMS
   o sólo hace WhatsApp — **eso decide si es configuración o desarrollo**. El repo no está clonado.
3. **El aviso va siempre al dato ANTERIOR**, nunca sólo al nuevo — **por WhatsApp**. Es lo que
   permite detectar el cambio no autorizado: si alguien pide cambiarte el celular, el aviso llega al
   viejo, que es el que todavía tienes.

   ⚠ **El canal de correo NO entra en el alcance** (decidido 2026-08-11). El acuerdo es que la
   gestión ocurra **entera en WhatsApp**, y sumar un segundo canal de notificación es **decisión de
   producto**, no del prototipo. Mientras no se hable con ellos, no se asume.

   Está **construido y apagado**: el prototipo trae el check «Aviso por correo», *off* por defecto.
   Al prenderlo aparece la bandeja de la clienta con el correo y su propio «No fui yo». Existe para
   poder mostrarlo en esa conversación sin volver a construirlo — no como parte del entregable.

   El argumento a favor, para cuando se discuta: es el **único canal que sigue en manos del cliente
   si alguien le tomó el teléfono** — quien controla un WhatsApp robado no controla la bandeja. Y el
   argumento en contra: **ese hueco lo tapa mejor la biometría** (idea de Miguel), que además sirve
   para el caso de «no tengo el celular a la mano». Son alternativas al mismo problema, no
   complementos: conviene elegir una, y esa elección es de producto.

   Si algún día entra, la regla de implementación ya está pensada: en cuanto el cliente responde por
   **cualquiera** de los canales, el otro se agota. Un solo desenlace por solicitud, no dos.
4. **"No es tu cliente" y "no existe" responden idéntico.** Si difieren, el buscador se vuelve un
   oráculo de qué cédulas están en la base.
5. **Dos tablas, no una.** Contacto → tabla nueva (nombre propuesto: `user_data_change_requests`).
   Condiciones → `creditop_x_changes_log`, que ya existe, con el `otp_id` real.
   El nombre lleva `change_requests` y no `modifications` a propósito: la fila tiene que existir
   **antes** del cambio, porque es la que sostiene el estado mientras se espera al cliente
   (`pendiente_autorizacion → autorizada → aplicada | rechazada | bloqueada`). Un log guarda el
   desenlace; acá el registro **es** el flujo.

## Lo que falta para que el canal funcione — 2026-08-14

Suponiendo el PR mergeado, desplegado, con la variable puesta y la ruta en el gateway: **funciona una
sola cosa** — resolver de quién es un número de WhatsApp. Después de identificar a la persona no hay
siguiente paso.

### El camino más corto a algo usable: la autogestión

Y hay una razón para empezar por ahí que no es de esfuerzo: **las plantillas de Meta sólo bloquean el
flujo del asesor**. Ahí el cliente *no escribió primero* —lo estamos interrumpiendo— y el primer
mensaje tiene que ser plantilla aprobada. En autogestión **el cliente escribe primero**, así que la
ventana de 24 h está abierta y el texto libre está permitido. La autogestión no espera a Meta.

| pieza | de quién | estado |
|---|---|---|
| identificar por número + cédula | nuestro | ✅ hecho |
| OTP + máquina de sesión | nuestro | ✅ hecho |
| 3 rutas de lectura (`can-change`, fechas, plazos) | nuestro | ✅ hecho |
| 2 rutas de cambio, con `otp_id` real | nuestro | ✅ hecho |
| flujo del asesor (8 rutas) | nuestro | ✅ hecho |
| webhook de WhatsApp + conversación | Filipo | **no existe en ningún lado** |

**De nuestro lado no queda ninguna ruta.** Las dos reglas que sostienen las de crédito quedaron
aplicadas y escritas en `routes/supportbot.php`: exigen sesión en `otp_verified` —si no, el
`user_request_id` va en la URL y es enumerable— y toman el `otp_id` de la sesión, nunca de la
petición.

Lo que falta para que el canal FUNCIONE es de infraestructura y de Filipo: las 4 migraciones en cada
ambiente, `SUPPORT_BOT_TOKEN`, exponer `/api/support/*` en el gateway, y del otro lado el webhook de
entrada con verificación de firma más la capa conversacional.

Recordatorio de por qué importa el `otp_id`: **las 31 filas de `creditop_x_changes_log` en dev tienen
todas `otp_id = 0`** (verificado 2026-08-14). Hasta que esos 2 endpoints existan, el cambio se sigue
guardando sin prueba de autorización.

El flujo del asesor son **8 rutas más**, y ese sí depende de las plantillas. Va después, en paralelo
con la aprobación.

**Buena noticia para estimar**: parte de esas 15 ya tiene la lógica hecha y probada en el PR.
`ClientLookupService` expone `findForAdvisor`, `alliedsOf` y `operableRequestsFor`, los tres con tests
en verde, y son exactamente lo que necesita `GET /support/clients?document=`. Lo que hay que construir
de cero es la sesión y el OTP — y para el OTP hay servicios reusables en el repo
(`Modules/Onboarding/App/Services/OtpService.php`, `Modules/Loans/App/Services/OtpService.php`,
`Modules/System/App/Repositories/OtpServiceRepository.php`): habría que ver cuál sirve y meterlo por
inyección, no escribir otro.

### Qué puede avanzar Filipo desde ya, sin esperarnos

- **Las plantillas de Meta** — el camino crítico más largo, con lead time de días y rechazos posibles.
- **El webhook de entrada con verificación de firma**, que hoy no existe en ningún lado.
- **La capa NLU** (`POST /nlu/interpretar`), que ya está listada como entregable suyo.
- Y con el contrato ya fijado —bearer token, envelope `{success, message, errors.error_code}`, los 4
  códigos— puede escribir su cliente HTTP, el manejo de errores y los reintentos **una vez** y
  reusarlos para los 16. **Darle la especificación de los 15 que faltan lo desbloquea sin que
  esperemos a implementarlas**: armaría el flujo de n8n contra un mock y después sólo cambia la URL
  base.

## Preguntas abiertas

- 🔴 **¿Quién manda el mensaje de confirmación después de un cambio?** Descubierto 2026-08-14 y **sin
  dueño**. Los dos `CreditChangeController` llaman a `TwilioMessagingService`
  (`sendPaymentDateConfirmation`) — y eso **ya estaba en `staging` antes del refactor**, verificado: 2
  usos en cada uno, iguales antes y después. Pero el `CreditChangeService` extraído tiene **cero**
  código de notificación. O sea que cuando el canal llame al servicio, **ese mensaje no sale**. Hay que
  decidir: o lo manda el bot por n8n, o subimos la notificación al servicio. Si no se decide, sale
  duplicado o no sale.
- 🔴 **¿De qué lado cae el webhook de entrada de WhatsApp?** El doc dice que n8n maneja la conversación
  pero también que el estado vive en el backend. Nunca se definió quién lo monta, y no está en el plan
  de ningún tramo.
- ~~**Arquitectura del canal**~~ — **decidido 2026-08-12: `Modules/SupportAgent` en legacy-backend**,
  con Twilio como proveedor y webhook oficial. Ver §«Arquitectura del canal».
  ⚠ El módulo terminó llamándose **`Modules/SupportBot`** y las tablas **`support_bot_*`**, no
  `SupportAgent` / `support_agent_*` como decía el acuerdo. Es sólo el nombre; la condición de frontera
  limpia se respetó.
- **¿Mismo número o uno nuevo?** Propuesta: nuevo para asesores, el de siempre para clientes. Sin
  decidir — ver el final de la sección de WhatsApp.
- **Cómo se autentica el canal contra el backend.** Hoy las rutas usan `auth.cognito`, que es de
  usuario, no de máquina. Sin definir. (Distinto del login del asesor **dentro** del bot, que sí
  está diseñado: enrolamiento de `wa_id` + OTP al celular del perfil.)
- **¿Un check del cliente o dos?** El prototipo hace dos (autoriza la gestión, después aprueba el
  cambio). Es más seguro y es lo que se pidió, pero es fricción. Se puede colapsar a uno.
- ~~**Alcance de "sus clientes"**~~ — **resuelto: por COMERCIO**, que es el único criterio con datos
  (ver §«El modelo del filtro»). El asesor individual se registra en la auditoría, que es donde
  importa la trazabilidad.
- **¿Qué hacemos con los 18 `Administrador`?** No pertenecen a ningún comercio (`allied_id` en 0/18),
  así que el filtro no les aplica. ¿Quedan fuera del canal, o entran con alcance total y cada acción
  auditada y notificada? **Decisión de negocio.**
- ~~**¿Cerrar la edición de ámbito entra en esta tarea?**~~ — **No. Decidido 2026-08-11: va en otra
  tarea** (roles y permisos del admin viejo). El detalle relevado queda en §«FUERA DE ALCANCE» para
  que esa tarea no lo re-investigue.
- **¿El asesor ve TODAS las solicitudes de un cliente compartido, o sólo las de sus comercios?** Para
  cambios de crédito la respuesta debería ser «sólo las suyas» (ver §«La regla, en una frase»);
  afecta a 2.346 clientes. Falta confirmarlo.
- **Qué pasa con los 63 que hoy editan sin filtro.** Aplicar el filtro los va a romper. ¿Se migra
  gradual, se exceptúa a Administrador, se avisa?
- **Rate limit y timeout**: 3 reenvíos de OTP, cooldown de 5 min, sesión de 10 min. Hoy sólo existe
  `OtpService::canSendOtp($user, $cooldownMinutes = 2)` en legacy, y el `otp-service` real de
  producción **no está clonado** — no se pudo verificar qué límites tiene.
- **¿Qué dice el bot si el crédito es elegible pero no hay plazos disponibles?** Pasa de verdad (ver
  §«Las APIs a entregar»): la categoría del cliente puede descartar todas las opciones. Ofrecer un
  menú vacío no sirve, y decir «no se puede» tampoco, porque la *fecha* sí se puede cambiar.
- **Clientes eliminados** (derecho al olvido / fraude): responder idéntico a "no encontrado".
  Requiere definición de Legal/Compliance sobre qué categorías aplican.
- **El OTP del asesor le llega al mismo teléfono** donde tiene WhatsApp. El segundo factor se
  degrada: quien tenga ese aparato desbloqueado tiene los dos. Sigue sirviendo contra el atacante
  **remoto**, que es el caso que motivó la tarea; contra el que tiene el teléfono en la mano lo que
  protege es el timeout y que **el cliente igual debe autorizar**.
  → **Mitigación barata, sin código**: recomendar que el asesor converse desde **WhatsApp Web en la
  computadora** y reciba el OTP por SMS en el teléfono — dos dispositivos, factor recuperado. Ver
  §«El canal del asesor no tiene por qué ser WhatsApp».
- **¿El OTP se queda en WhatsApp o pasa a SMS?** Hoy va por WhatsApp (§Decisiones tomadas, punto 2).
  Cambiarlo depende de si el `otp-service` sabe emitir por SMS — el repo no está clonado, así que no
  se sabe si es configuración o desarrollo.

## Las tablas: qué existe y qué hay que crear

Verificado contra la copia local el 2026-08-13.

| tabla | ¿existe? | para qué |
|---|---|---|
| `creditop_x_changes_log` | ✅ **sí** | condiciones del crédito (fecha, plazo) |
| `user_data_change_requests` | ❌ **hay que crearla** | datos de contacto, con su ciclo de autorización |
| sesiones del bot | ❌ **hay que crearla** | en qué punto va cada conversación |

**Para las condiciones del crédito NO hace falta migración.** `creditop_x_changes_log` ya tiene la
columna `otp_id` como `bigint unsigned NOT NULL` — pasar el id real en vez de `0` es un cambio de
código, no de esquema. Es la parte más barata de toda la tarea.

**Las dos que faltan:**

1. **Sesiones del bot.** Es la que sostiene todo lo demás: cada mensaje entrante es un webhook
   independiente y sin esto no hay forma de saber en qué punto va la conversación. Necesita al menos
   `wa_id`, a quién resolvió, el estado, el contexto y cuándo expira. Va con prefijo propio
   (`support_bot_*`) por la frontera limpia que se acordó.
   ⚠ Acá vive también el **enrolamiento** del número del asesor — si es la misma tabla o una aparte
   está sin decidir: la sesión es efímera y el enrolamiento permanente, así que probablemente sean
   dos.
2. **`user_data_change_requests`.** La solicitud de cambio de contacto con su ciclo
   (`pendiente_autorizacion → autorizada → aplicada | rechazada | bloqueada`). Sólo la necesita el
   flujo del **asesor**: en autogestión no hay tercero que autorice, y los datos de contacto están
   fuera de ese alcance.

**Nada de esto está escrito todavía** — lo hecho hasta hoy sólo lee.

## Cómo se valida esto — y el estado de los tests

**⚠ La suite de módulos de `legacy-backend` está rota en `main`** (medido 2026-08-13, antes de tocar
nada): **284 tests fallan** contra 387 que pasan. Las causas son deuda acumulada, no del entorno —
**96 «Too few arguments»** (constructores que cambiaron y los tests quedaron viejos) más 14 de
columnas o tablas que ya no existen.

Consecuencia práctica: **«la suite pasa» no sirve como criterio de cierre**. Los tests de este módulo
hay que correrlos aislados por path, y conviene decirlo en la PR para que nadie los mezcle con el
ruido de fondo.

**El harness NO es la herramienta acá.** Es Playwright sobre el wizard, pensado para UI; estos son
endpoints REST y sus pruebas viven mejor en el repo, junto al código y corriendo en CI.

### ⚠ La receta para correr los tests — costó media tarde encontrarla (2026-08-14)

**Los tests NO usan tu BD local.** Usan el schema **`testing`** (`phpunit.xml` → `DB_DATABASE=testing`).
El `creditop` local es un dump de prod y está sano; `testing` estaba **151 migraciones atrasado**, y de
ahí venían los fallos — no del código.

Y hay tres trampas encadenadas:

1. **Desde la shell del host no conectan.** `DB_HOST=mysql` es el nombre del servicio de Docker y sólo
   resuelve dentro de la red del contenedor. Desde la terminal todos los tests con BD mueren al
   instante con error de DNS. **Hay que correrlos dentro**:
   `docker exec legacy-backend-laravel.test-1 sh -c 'cd /var/www/html && vendor/bin/pest Modules/SupportBot/Tests'`
2. **`testing` no se puede reconstruir con `migrate:fresh`.** La migración
   `2025_02_12_212827_add_insurance_per_million_to_lenders_by_allieds` hace
   `->after('initial_fee_percentage')` sobre `lenders_by_allieds`, y esa columna nunca se crea ahí (la
   de 2024 la agrega a `allieds`, otra tabla). En los ambientes reales nadie lo notó porque sus bases
   vienen de dumps, no de replayar migraciones. **Arreglo: borrar ese `->after(...)`** — el orden de
   columnas en MySQL es cosmético. Va en su propia rama, no mezclado con esta tarea.
3. 🔴 **Hay 42 funciones y procedimientos de MySQL que NO están en ninguna migración.** Viven sólo en
   la base (`FN_Mareigua_Occupation`, `FN_Experian_*`, `SP_Experian_Extract_Data`…). Una base armada
   desde el repo nace sin ellas y el código revienta con *«FUNCTION … does not exist»*. Y el usuario
   `creditop` **no puede ni leerlas** — hace falta root. **Esto es lo que hay que copiar y lo que se
   olvida.**

**La receta que funciona** (estructura + rutinas, **sin datos** — los datos son indiferentes, lo
comprobé en los dos sentidos):

```
# estructura + tabla migrations
mysqldump -ucreditop -p… --no-data --routines --triggers creditop | mysql -ucreditop -p… testing
mysqldump -ucreditop -p… creditop migrations | mysql -ucreditop -p… testing
# las 42 rutinas, con ROOT y sin DEFINER (mysqldump --routines con el usuario normal trae 1 de 42)
mysqldump -uroot -p… --routines --no-create-info --no-data --skip-triggers creditop \
  | sed -E 's/DEFINER=`[^`]*`@`[^`]*` //g' | mysql -uroot -p… testing
```

⚠ **No apuntar pest a `creditop` ni a la BD de dev.** 8 archivos del repo usan `RefreshDatabase`, que
hace `migrate:fresh` y **borra la base a la que apunte** — 5 en `Modules/Loans/tests/` y 3 en
`tests/Feature/`. Ninguno es de esta tarea: los 4 de este módulo usan `DatabaseTransactions` y
revierten lo suyo (verificado: los conteos de `testing` quedan idénticos antes y después). Correr
siempre con el filtro de path.

**Lo ya verificado** contra la copia local:

- Las **3 APIs de consulta** responden correctamente (ver §«Las APIs a entregar»).
- **27 tests del módulo pasan** (`Modules/SupportBot/Tests`), en 3 segundos — 20 del canal más 7 de
  `AuthorizationState`.
- **Ejercitado con un asesor y clientes reales de la base**, que es distinto de los tests porque usa
  la forma real de los datos: asesor **1073** (comercio 48, AHL) contra un cliente suyo, uno de otro
  comercio y un documento inventado. Los cuatro casos correctos, **incluido el que importa: el
  cliente de otro comercio no aparece**. El mismo cliente se resuelve por las dos vías —documento
  (asesor) y celular (autogestión)—, y el documento sale enmascarado (`1037****684`).

⚠ Los tests pasan **en local**. En CI fallarían como los otros 273 mientras las migraciones sigan
rotas: el esquema de la base de tests es hoy un paso manual, y el comando quedó escrito en el propio
test.

## Deuda aparte (no es de esta tarea, pero se encontró acá)

`Admin/UserController@update` **resetea la contraseña del cliente a su número de documento** en cada
edición (`bcrypt($document_number)`). Cambiarle el correo a alguien le deja la clave en su cédula.
Es independiente del canal de WhatsApp y ya está en `main`. **Pendiente de registrar como finding**
en `context/server/data/flows/findings/doc.md` — Miguel lo decide.

## Arquitectura del canal — ✅ DECIDIDO: `Modules/SupportAgent` en legacy-backend

**Decidido el 2026-08-12.** Un módulo Laravel dentro de `legacy-backend`, no un microservicio
aparte. Tres razones, en orden de peso:

1. **Atomicidad.** Escribir el cambio y su registro de auditoría **en la misma transacción**. Con un
   servicio aparte hablando HTTP eso no existe: o se inventan sagas y compensaciones, o se acepta que
   un fallo intermedio deje el dato cambiado sin registro. La auditoría es el corazón de esta tarea;
   no conviene que sea eventual.
2. **Reusa sin exponer.** `OtpService`, `CreditChangeValidationService`, los modelos y los permisos
   Spatie entran por inyección de dependencias. Desaparece el trabajo de diseñar, versionar y
   asegurar los endpoints HTTP intermedios — y con él, la pregunta de cómo se autentica el canal
   contra el backend, que estaba abierta desde el principio.
3. **Precedente directo.** `Modules/Backoffice` hizo exactamente esto: superficie nueva, con su
   propia API y su propia autenticación, dentro de legacy. Son 20 módulos; la arquitectura está
   hecha para esto.

**Lo que se acepta a cambio**, para que quede dicho: es PHP y el equipo viene haciendo Go; el
monolito crece, aunque legacy sea hoy el *destino* de la migración y no el origen; y el estado
conversacional (sesiones, máquina de estados) va a vivir en el MySQL transaccional.

⚠ **Condición: frontera limpia desde el primer commit.** Tablas propias con prefijo
(`support_agent_*`), namespace propio, y hablar con el resto **por servicios inyectados, nunca por
queries sueltas contra tablas ajenas**. Si algún día se extrae, el trabajo debe ser reemplazar
inyecciones por llamadas HTTP — no desenredar.

**Descartados**: microservicio Go (pierde la transacción única, que es lo que más importa acá) y n8n
como dueño del flujo (la lógica de seguridad quedaría repartida entre el workflow y el backend). n8n
**sí** queda, pero sólo como capa conversacional — ver §«Reparto del trabajo».

**Sobre WhatsApp**: hoy `messaging-service` es **sólo salida** (`/api/v1/messages/send`,
`/api/v1/emails/send`) — cero webhooks, cero inbound. Usa **Twilio** con `ContentSid` (plantillas
aprobadas por Meta). Ir directo a **Meta Cloud API** significa otra cuenta de WhatsApp Business, otro
número y otro proceso de aprobación de plantillas; seguir con **Twilio** reusa lo que ya está
configurado y facturado. En ambos casos hay que montar un **webhook público con verificación de
firma**, que hoy no existe en ningún lado.

⚠ **La ventana de 24 h condiciona el diseño del flujo, no sólo la infra.** WhatsApp sólo deja
mandar texto libre dentro de las 24 h posteriores al último mensaje **del usuario**. El cliente de
esta tarea **no escribió primero** — lo estamos interrumpiendo nosotros —, así que el mensaje que
abre la conversación («tu asesor solicita autorización para…») tiene que ser una **plantilla
aprobada por Meta**, con sus botones declarados en la plantilla misma. Consecuencias concretas:

- Los textos que el prototipo muestra del lado del cliente **no se pueden improvisar**: hay que
  redactarlos como plantillas y mandarlos a aprobación (lead time de días, y rechazos posibles).
- Los datos variables (nombre del asesor, dato actual, dato nuevo) van como **parámetros** de la
  plantilla, no como texto libre.
- Una vez que el cliente responde, se abre la ventana y el resto de la conversación sí puede ser
  libre. Sólo el **primer** mensaje de cada solicitud necesita plantilla.
- El OTP por SMS esquiva todo esto — otra razón para no mandarlo por WhatsApp.

Esto hay que arrancarlo temprano: es el camino crítico más largo y no depende de nosotros.

## Cómo funciona la API de WhatsApp (verificado 2026-08-11)

Lo que más confunde al arrancar: **no existe «mandá un mensaje y esperá la respuesta»**. No hay
`respuesta = enviarYEsperar(...)`. El modelo son dos entradas separadas al programa:

1. Vos llamás a la API → sale el mensaje → **la llamada termina** y te devuelve un id.
2. Cuando la persona responde, **Twilio le pega a una URL tuya** con un POST nuevo, independiente,
   que trae `Body`, `From` (`whatsapp:+57…`), `WaId`, `ProfileName` y `MessageSid`.

Es el propio WhatsApp como analogía: mandás y seguís con tu vida; cuando el otro contesta, suena el
teléfono. **Para el usuario se siente instantáneo** — la diferencia es sólo cómo se escribe el
código. Y de acá sale todo lo demás: la segunda llamada no sabe nada de la primera, así que el
estado de la conversación lo tenés que guardar vos.

### Qué falta para tener entrada (es poco)

El número que hoy manda los recordatorios **ya es un número corporativo en la WhatsApp Business
Platform vía Twilio**, y el mismo número puede recibir. Sólo falta:

- **Configurar la URL de entrada** en el Messaging Service (el `MessagingServiceSid` que la config
  de `messaging-service` ya guarda). Es configuración, no un número nuevo.
- **Un endpoint público** que la reciba.
- **Verificar `X-Twilio-Signature`** en cada request — sin eso cualquiera postea mensajes falsos y
  se hace pasar por un asesor.
- **Idempotencia por `MessageSid`**: Twilio reintenta ante error o timeout, y un reintento que
  reprocese un «Sí, autorizo» aplicaría el cambio dos veces.

### El login del asesor: WhatsApp no tiene sesión

Cada mensaje entrante es un POST suelto — sin cookie, sin token, sin conexión. Lo único que
identifica a quien escribe es su número. Entonces «login» acá es **atar un número a una identidad
nuestra y recordar esa atadura**:

- **El número como identidad de partida** — débil pero no nula: llega firmado por Twilio y WhatsApp
  ya verificó que pertenece a ese dispositivo. Más que un correo tipeado, menos que un token; se
  rompe con SIM swap o teléfono robado desbloqueado.
- **El OTP no valida el número de WhatsApp: valida que quien escribe controla el celular del
  asesor.** Escribe desde X, el código va a Y (el del perfil). Si X≠Y, el impostor escribe pero el
  código le llega al asesor real, que se entera del intento.
- **La sesión es una fila**: `wa_id → advisor_user_id, state, context, expires_at`. Cada webhook:
  buscar por `From`, leer el estado, interpretar el mensaje **según ese estado**, transicionar.

⚠ **Un `482913` que llega no significa nada por sí solo.** Es un OTP sólo si el estado es
`awaiting_otp`; en `awaiting_document` es una cédula mal formada y en `ready` es ruido. **El estado
es lo que le da sentido al mensaje** — y es la razón técnica de fondo por la que n8n encaja mal:
cada webhook es un disparo nuevo sin contexto.

**El OTP existente sirve tal cual**: `OtpService::verifyOtpCode` valida contra el `otp-service`
agrupando por **`identifier`**, no por teléfono («se valida contra el MISMO con el que se generó»,
dice el comentario). El `identifier` puede ser la sesión de WhatsApp. No hay que inventar OTP nuevo.

**Propuesta: enrolar el número.** La primera vez, cédula + OTP → se ata ese `wa_id` al asesor de
forma permanente. Después ese número entra directo; un número **nuevo** para el mismo asesor exige
OTP y **avisa al anterior**; y un mismo `wa_id` no puede ser dos asesores. Es vinculación de
dispositivo (el patrón de WhatsApp Web): convierte el número de «algo que el atacante afirma» en
«algo que el asesor tiene», y evita pedir OTP todo el día.

**Límites propios del canal, a tener en cuenta:** no hay logout (el asesor cierra WhatsApp y la
sesión sigue viva de nuestro lado → de ahí el timeout por inactividad); los webhooks pueden llegar
**desordenados**, así que la máquina de estados tiene que tolerar un mensaje que no corresponde al
estado actual sin romperse.

### El login del asesor, paso a paso sobre webhook

**Decidido 2026-08-11: se hace con webhook oficial** (Twilio), no con librerías tipo
`whatsapp-web.js` — ver §«Por qué no una librería no oficial».

La forma mental: **cada mensaje del asesor es un POST independiente**. No hay sesión de transporte,
así que el estado lo pone la BD. El handler siempre hace lo mismo — *identificar → leer estado →
interpretar según el estado → transicionar → responder*.

**Los cuatro pasos previos, en TODO mensaje entrante** (antes de mirar el contenido):

1. **Verificar `X-Twilio-Signature`.** Si no valida → 403 y log. Sin esto, cualquiera postea mensajes
   falsos y se hace pasar por un asesor.
2. **Idempotencia por `MessageSid`.** Twilio reintenta ante error o timeout; si el sid ya se procesó,
   responder 200 y salir. Sin esto un reintento puede reprocesar una autorización.
3. **Responder 200 rápido y hacer el trabajo aparte.** Twilio espera la respuesta unos segundos y
   reintenta si tarda: validar OTP + escribir en BD + enviar puede pasarse. El mensaje de vuelta se
   manda por la API (`POST /Messages`), **no** en el cuerpo de la respuesta.
4. **Buscar la sesión por `wa_id`** (`From`). Lo que venga después depende de en qué estado esté.

**El recorrido:**

| # | llega | estado previo | qué hace el servicio | estado nuevo | responde |
|---|---|---|---|---|---|
| 1 | «Hola» | *(sin sesión)* | ¿el `wa_id` está enrolado? Si no, crea sesión | `awaiting_document` | «Enviá tu cédula» |
| 2 | `79856214` | `awaiting_document` | lo interpreta **como cédula**; resuelve usuario + rol + permiso; genera OTP con `identifier = id de sesión` y lo manda **por SMS al celular del PERFIL** | `awaiting_otp` (+ `pending_advisor_id`, `otp_attempts=0`) | «Código enviado a 320\*\*\*\*145» |
| 3 | `482913` | `awaiting_otp` | lo interpreta **como OTP**; valida contra el `otp-service` por `identifier`. Si acierta: **enrola** el `wa_id` ↔ asesor | `ready` (+ `advisor_user_id`, `expires_at = now+10m`) | el menú |
| 4+ | lo que sea | `ready` | cada mensaje **renueva** `expires_at` | según el flujo | … |

**Los caminos que no son el feliz** — son los que hacen la diferencia:

- **Cédula que no existe, o existe sin permiso**: misma respuesta genérica en los dos casos, y contar
  el intento. Si difieren, el bot se vuelve un oráculo para saber qué cédulas son de asesores.
- **OTP equivocado**: `otp_attempts++`. Al superar el límite, bloquear la sesión y escalar — no dejar
  reintentar indefinidamente.
- **Sesión expirada**: si el `wa_id` **ya está enrolado**, no volver a pedir la cédula: pedir sólo el
  OTP. La cédula es para el enrolamiento, no para cada login.
- **Número nuevo para un asesor ya enrolado**: exige OTP **y avisa al número anterior**. Es la señal
  de alarma barata que detecta un intento de suplantación.
- **«Salir»**: cierra la sesión a mano, sin esperar el timeout.
- **Mensaje que no corresponde al estado** (llega una foto en `awaiting_otp`, o algo desordenado): no
  romper — repetir la consigna del estado actual.

⚠ **El OTP viaja por SMS, no por WhatsApp** (§«Decisiones tomadas»): si va por el mismo chat donde
ocurre la conversación, deja de ser segundo factor.

### Por qué no una librería no oficial (`whatsapp-web.js` y similares)

Se evaluó y **se descarta**. Automatizan el WhatsApp Web de una cuenta normal, lo que **viola los
términos de servicio**: el ban es no determinístico —detección heurística, un número aguanta meses y
otro cae en una semana— y para una fintech regulada, autorizar cambios de datos personales por un
canal que puede desaparecer sin aviso es un problema de compliance antes que técnico. Además hay que
mantener viva una sesión de navegador headless que se cae y pide re-escanear el QR; el webhook es un
endpoint HTTP sin estado propio. Y la vía oficial ya está paga y andando.

En el código la diferencia es mínima —`client.on('message', …)` contra un handler de `POST
/webhook`—; lo que cambia es quién inicia la conexión. Para desarrollo local, un túnel tipo ngrok da
una URL pública contra `localhost` y se prueba igual de rápido.

⚠ **Restricción nueva que conviene no descubrir tarde**: desde **enero de 2026 Meta prohíbe los bots
de «asistente» de IA abiertos** en la WhatsApp Business Platform — sólo se permiten bots
**estructurados** (menús, estados, FAQs, captura de datos). El prototipo cae del lado permitido, pero
significa que **no se puede «mejorar» después metiéndole un LLM que converse libremente**. El diseño
con menú no es sólo el más simple: hoy es el único viable.

### Costos: el flujo cae casi entero en la parte gratis

Desde julio 2025 Meta factura **por mensaje**, con 4 categorías (Marketing / Utility /
Authentication / Service). Lo que define el costo es **quién escribió primero**:

- **El asesor escribe primero** → abre su ventana de 24 h → todo su lado es **texto libre y
  gratis**: menú, búsqueda, confirmaciones. Cero plantillas, cero aprobaciones. Y como trabaja
  seguido, la ventana se le renueva sola.
- **Al cliente le escribimos nosotros** → **una** plantilla *Utility* (transaccional: el asesor pidió
  un cambio sobre su cuenta). Cuando responde, se abre **su** ventana y el resto es gratis.
- **El OTP va por SMS**, así que ni toca WhatsApp.

→ **Una solicitud de cambio ≈ un solo mensaje facturado.** Colombia tiene la tarifa más barata del
mundo: **~US$0.0008** por mensaje utility/authentication. Mil solicitudes/mes son menos de un dólar
en Meta, más el markup de Twilio (del orden de US$0.005/mensaje). **El costo no es un argumento en
esta decisión.** ⚠ Ese número sale de rate cards de terceros, no de Meta directo — confirmarlo en la
consola de Twilio antes de citarlo a alguien.

### Los componentes de WhatsApp y sus límites (verificado 2026-08-11)

Esto condiciona la redacción, no sólo el diseño: **no es que un texto largo se vea feo, es que no se
puede enviar.** Y hay dos regímenes distintos según si el mensaje va en conversación abierta o como
plantilla:

| | en conversación abierta | en plantilla aprobada |
|---|---|---|
| **botones** | máx **3** · **20** caracteres | hasta **10** · 25 caracteres |
| **lista** | máx **10** filas (y 10 secciones) · título **24** · descripción **72** | — |
| **texto** | libre | cuerpo **1024** · encabezado y pie **60** |

Notas: el encabezado de plantilla **no admite emojis ni formato**; el cuerpo sí (`*negrita*`,
`_cursiva_`, ` ```monoespaciado``` `). El total de una plantilla —encabezado + cuerpo + pie +
botones— entra en los 1024.

**El prototipo ya está ajustado a esto**: los 33 controles auditados caben. Tres textos hubo que
acortar, y sirven de ejemplo de lo ajustado que es el margen:

| decía | largo | límite | quedó |
|---|---|---|---|
| `Enviar al cliente para aprobación` | 33 | 20 (botón) | `Enviar al cliente` |
| `🗓️ Cambiar plazo del crédito` | 28 | 24 (fila) | `🗓️ Cambiar plazo` |
| `28 de septiembre de 2026` | 24 | 20 (botón) | `28 de septiembre` |

⚠ **Al redactar las plantillas del cliente, contar caracteres desde el principio.** Un texto que no
entra no se descubre al probar: se descubre cuando Meta rechaza la plantilla, y eso cuesta días.

### Los menús van como LISTA, no como botones

**En conversación abierta WhatsApp permite máximo 3 botones**; en plantilla aprobada, hasta 10. Dos
menús del flujo se pasan de tres:

- el del asesor tras elegir cliente — **4 opciones** (celular · correo · fecha de pago · plazo);
- el de plazos — **5 opciones** (6, 9, 12, 18, 24), y podrían ser más según la línea de crédito.

Los dos van **en sesión**, así que la salida es **lista desplegable** (`twilio/list-picker`, hasta 10
opciones): un solo paso y se lee mejor en el teléfono que dos niveles de submenú. ✅ **Aplicado en el
prototipo** — las opciones llevan además un subtítulo, que es donde se distingue «dato de contacto»
de «condición del crédito · pide OTP».

### Siguiente paso propuesto: el sandbox

Twilio tiene un **sandbox de WhatsApp** que da un número de pruebas al que uno se une mandando un
código, **sin registrar número propio ni esperar aprobación de plantillas**. Sirve para tener el
flujo real andando en el teléfono en días —dos personas haciendo de asesor y cliente— y recién
después pasar al número corporativo y al trámite de plantillas. Convierte el HTML en algo que se
prueba de verdad, y no compromete nada.

### El canal del asesor no tiene por qué ser WhatsApp (y conviene pensarlo)

**Asesor y cliente son dos conversaciones independientes**, correlacionadas por el ticket. El
**cliente** tiene que ser WhatsApp —es donde está y donde reconoce la marca—, pero el **asesor** no
está atado a nada. El mismo modelo de webhook sirve para varios canales (Twilio expone SMS, WhatsApp,
voz y RCS por la misma API; `messaging-service` ya habla SMS, WhatsApp y email).

| canal para el asesor | a favor | en contra |
|---|---|---|
| **WhatsApp** | ya lo usan todo el día, cero adopción; botones y listas | el OTP compite con el canal |
| **SMS** | webhook idéntico, sin plantillas ni ventana de 24 h | sin botones ni listas: todo texto plano |
| **Telegram** | bots gratis, sin plantillas, sin ventana, botones nativos | otra app que instalar y sostener |
| **Panel web** | control total, sin límites de canal | es el admin que ya existe — y el punto era que no lo usan |

Slack/Teams quedan descartados: los asesores son **Superadmin comercio**, gente de los comercios
(Alkosto, Dentix…), no empleados de CreditOp. No están en el workspace.

⚠ **Lo importante: elegir el canal es lo que arregla el problema del segundo factor.** El riesgo
anotado en §Preguntas abiertas —el OTP llega al mismo teléfono donde el asesor tiene WhatsApp— **se
resuelve eligiendo, no programando**: si conversa por **WhatsApp Web en la computadora** y el OTP le
llega por **SMS al teléfono**, son dos dispositivos y el factor vuelve a valer. Y es lo que va a pasar
naturalmente: un asesor en un punto de venta trabaja frente a una pantalla. Vale como **recomendación
de uso** aunque el canal siga siendo WhatsApp.

### Decisión abierta: ¿mismo número de WhatsApp o uno nuevo?

**Primero, lo que NO está en juego: el OTP no ocupa ningún número.** Sale por **SMS**, y el SMS de
CreditOp usa **remitente alfanumérico** — `TPOA: "Creditop"` en el cliente de LabsMobile
(`labsmobile_client.go:65`). Al destinatario le llega un mensaje de «Creditop», no de un teléfono.
SMS y WhatsApp son infraestructuras distintas (LabsMobile vs Twilio) y **no compiten por número**.
La pregunta es sólo cuántos números de **WhatsApp Business** hacen falta.

Hoy el número de WhatsApp manda recordatorios de cobranza y **nadie espera respuestas**. Montarle el
bot encima hace que todo el inbound caiga en el mismo webhook —asesores, respuestas a recordatorios,
clientes perdidos— y cambia la expectativa para todos los clientes que reciben cobranza.

⚠ **Un número registrado en la WhatsApp Business Platform deja de funcionar en la app normal de
WhatsApp.** Si el número candidato lo usa hoy alguien desde un celular, se pierde ese uso — hay que
confirmarlo antes de elegirlo.

Propuesta: **número nuevo para el canal de asesores** (audiencia interna; aísla el riesgo — un bug
del bot no toca la cobranza) y **el número de siempre para escribirle al cliente**, que ya reconoce
la marca. `messaging-service` ya soporta varias configs (la clave es plantilla × país), así que el
código no sufre.

⚠ **Cuidar la calidad del número**: Meta puntúa cada número por bloqueos y reportes, y si baja
recorta el límite de envío. Un mensaje de autorización que parezca phishing genera reportes — y el
castigo pega sobre el número que también se usa para cobrar.

---

## Registro

<!-- append-only, lo nuevo arriba. (Esta tarea no tenía sección de registro; se agrega siguiendo
     PLANTILLA-TAREA.md. Lo de arriba es el ESTADO, que se reescribe; esto es qué pasó cada día.) -->

### 2026-08-20 (22) — el prototipo para QA, y se borra el tercero (el de n8n)

Se entrega **`…-modificacion-datos.cliente-qa.html`**: el mismo chat de WhatsApp, contra la API real de
`develop`, con la respuesta cruda de cada llamada al costado. El detalle de qué hace y por qué está en
§«Los prototipos»; acá van sólo las decisiones y lo que costó.

**Se BORRA `…-modificacion-datos.n8n.html`** (decisión de Miguel). Antes de borrarlo se comprobó que no
se perdía nada: su valor declarado era «la especificación de las ramas por código de error», y menciona
**tres** (`CLIENT_NOT_FOUND`, `SESSION_NOT_FOUND`, `NOT_VERIFIED`) que este documento ya cubre. Además el
prototipo nuevo las implementa en código —qué se le dice al cliente ante cada código— así que la
especificación pasó de una maqueta a algo que se ejecuta. Y sigue en la historia de git.

**Lo que se aprendió construyéndolo**, que es más útil que el archivo:

1. 🔴 **El script de datos identificaba al cliente por el CELULAR.** Miguel lo corrió contra dev y salió
   404; el 404 era el síntoma. En dev `3131010100` es de **JOHN SMITH**, así que el `UPDATE` le habría
   reescrito el nombre y la cédula a un usuario de prueba de otra persona, **sin que nada avisara**.
   Corregido: la identidad es la **cédula** (un valor inventado para esto, así que sólo puede existir el
   usuario que el script creó) y el celular pasó a `3108000011`, que está en la lista de bypass y no lo
   usa nadie. Y quedó un chequeo: si dos clientes comparten el celular lo dice, porque
   `findByWhatsApp` resuelve con un `first()` y el canal atendería al otro.

2. **El celular y la cédula tienen que ir juntos en la UI.** Cambiar uno solo da `CLIENT_NOT_FOUND` y
   parece un bug del canal. La columna lista los clientes que existen con su cédula al lado.

3. **Un archivo abierto con `file://` no puede llamar a dev.** El gateway sólo manda `Access-Control-Allow-Origin`
   cuando el `Origin` es real; con `file://` viaja `Origin: null` y el preflight vuelve sin cabeceras.
   Verificado con `curl -X OPTIONS` desde los dos orígenes. De ahí que se sirva por HTTP.

4. **Con un número que no está en el bypass, el código NO se pre-escribe.** Poner los últimos 4 dígitos
   ahí sería mentir: en ese caso el código llega por SMS y la página no lo sabe. Es la misma trampa que
   ya costó un SMS a un número ajeno.

> **MEDICIÓN · 2026-08-20** — probado contra **dev** tal cual se entrega: abrir → tres clics → `QA`
> verificado y «tu crédito de Amoblando Pullman admite cambios»; un clic en `JOSE FERNANDO` → sus dos
> créditos con comercio, cuota y vencimiento. Y contra local, el ciclo completo del reset: cambio
> aplicado → correr el `.sql` → cero cambios que bloqueen, listo para probar otra vez.

⚠ **Deuda del propio prototipo:** la lista de teléfonos de QA es una **copia** de
`settings.qa_otp_bypass_phones` tomada hoy. Si alguien agrega un número en la base, el aviso va a decir
que manda SMS cuando ya no lo manda. Está anotado en el código; la verdad está en la BD.

### 2026-08-20 (21) — MERGEADO y probado en DEV · y ahí apareció por qué nunca se ven plazos

PR **#1166** mergeado a `develop` (22:31 UTC) y desplegado. Probado contra el **gateway público de dev**
(`api.dev.creditop.com/legacy-api/support/*`), o sea el camino real que va a usar n8n.

**Cómo se probó sin mandarle un SMS a nadie:** se buscó un cliente cuyo teléfono esté en
`settings.qa_otp_bypass_phones` **y** tenga crédito activo rt=2. En dev hay dos; el bueno es el **QA
1827797** (`3109000004`, doc `37670195`), porque su crédito 465094 tiene `next_payment_amount = 0`. Con
el bypass el proveedor no se llama y el código es los últimos 4 dígitos (`0004`).

> **MEDICIÓN · 2026-08-20 (dev, gateway público)**
> `by-phone` 200 (QA) · `self/otp` 200 · `verify` 200 con **`operable_credits` descrito** —o sea que el
> deploy trae el código nuevo— `465094 · Amoblando Pullman · CrediPullman · 2026-09-28 · cuota
> $106.410` · `can-change` **true** · `payment-date-options` → **05/10 y 16/10** ·
> `change-payment-date` → **aplicado**: fila 252121 cerrada (`status 0`) y **252122** activa con
> `2026-10-05`, más `creditop_x_changes_log #37` con **`otp_id = 297032`**, real.
>
> **Las dos guardas, contra dev:** el crédito 465095 —del MISMO cliente pero **sin lender**— da 422
> `CREDIT_NOT_SERVICED_BY_US` en vez del 500 que daba antes al simular plazos; y el 223999, que es de
> otra persona, da 404 `CREDIT_NOT_FOUND` sin confirmar que existe.
>
> Y el rechazo de negocio funciona: los dos créditos del otro cliente (45871) dan
> `HAS_PENDING_PAYMENT`, porque la regla real es **`next_payment_amount > 0`** («tenés una cuota por
> pagar»), no la mora — `days_past_due` de uno de ellos es 0 y aun así rechaza, con razón.

**🔴 Y ACÁ EL HALLAZGO NUEVO, que no es de esta tarea pero la bloquea a medias: el cambio de PLAZO no se
puede ofrecer a los clientes de la MEJOR categoría.**

`fee-number-options` devolvía `[]` con `can_change: true`. No es falta de datos: la línea de crédito del
lender ofrece `1,3,6,12`, el crédito va en la cuota 1 y su plazo es 12. El filtro por categoría es

    $possibleFeeNumbers = array_filter($possibleFeeNumbers,
        fn ($feeNum) => $feeNum <= $category->max_fee_number);

y la categoría de ese cliente (`users_category_log` → **12 «Premium»**) tiene **`max_fee_number = NULL`**,
o sea *sin tope*. Pero en PHP `3 <= null` es **false** —el null se convierte en 0— así que «sin tope» se
comporta como «tope 0» y **se filtran TODOS los plazos**. Comprobado: `php -r 'var_dump(3 <= null);'` →
`false`.

El efecto está al revés de lo que quiere el negocio: «Segunda oportunidad» (tope 6) sí podría cambiar a 3
o 6 cuotas, y «Premium» —sin tope— no puede cambiar a ninguno. **En dev, 58 de 144 categorías tienen el
tope en NULL.**

⚠ Es código de `Modules/Loans` **compartido con la app móvil**, así que el mismo agujero está en el cambio
de plazo de la app, no sólo en el canal. El arreglo es una línea (`$category->max_fee_number === null ||
$feeNum <= $category->max_fee_number`), pero **no se toca acá**: cambia el comportamiento de la app para
58 categorías y eso lo decide producto. Queda como tarea aparte.

Por eso el camino del plazo quedó validado **en local** (crédito 412224, con categoría que sí tiene tope)
y **no** en dev: en dev no hay un crédito rt=2 con `next_payment_amount = 0` cuya categoría tenga tope.

### 2026-08-20 (20) — la pregunta «¿ya se puede subir?», contestada midiendo: dos huecos y un bug propio

Miguel preguntó si se puede subir la rama. En vez de contestar de memoria se buscaron los agujeros, y
había tres cosas.

**1 · 🔴 Un bug MÍO, del mismo tipo que el `find()`/`findById()` de la semana.** `POST
/credits/{id}/change-fee-number` con un plazo que el canal no ofreció devolvía **500**, no el 422 que yo
había escrito: `escribir()` envolvía en `success()` **todo** lo que devolviera la acción —incluida la
respuesta de error del rechazo— y `JsonResponse::toArray` no existe.

Y lo que más importa de esto: **la regla YA tenía test y el test pasaba.** `CreditChangeServiceTest`
prueba el servicio directamente, así que nunca ejecutó el controlador. Es exactamente la trampa que el
docblock de `CreditEndpointsTest` describe desde la semana pasada, y volví a caer en ella. Arreglado
(`escribir()` pasa tal cual la respuesta que le devuelva la acción) y con **test de RUTA**, comprobado a
la manera de siempre: con el bug puesto de nuevo, **falla**; con el arreglo, pasa.

**2 · El camino del PLAZO nunca había corrido contra un crédito rt=2.** El de la mañana era Credifamilia
(rt=4), que la guarda nueva ahora bloquea — o sea que el único recorrido exitoso de `change-fee-number`
era sobre un crédito que ya no se acepta. Se midió si en local hay con qué probarlo: **de 17 créditos rt=2
sanos, 15 ofrecen plazos**. Corrido de punta a punta sobre el 412224 (Mediarte, rt=2):

> **MEDICIÓN · 2026-08-20 (local)** — `can-change` `true` · `fee-number-options` → 3, 6 y 12 cuotas ·
> `change-fee-number` a 12 **mandando `fee_value: 1` a propósito** → aplicado con **$210.000**, el valor
> real de la opción ofrecida, y `creditop_x_changes_log #49` con **`otp_id = 294589`**, el de la sesión.
> Con `fee_number: 99` → **422 `FEE_NOT_AVAILABLE`**.
>
> O sea que las dos cosas que este canal arregla quedaron demostradas en el camino del plazo: el monto no
> lo pone quien llama, y el `otp_id` no es 0.

**3 · La ruta del ASESOR había cambiado de forma sin test que la cuidara.** `GET /clients` pasó de
`operable_request_ids` a `operable_credits`, y sus tests cubrían **sólo los rechazos**
(`WRONG_ACTOR`, `CLIENT_NOT_FOUND`, `VALIDATION_FAILED`): la respuesta del camino feliz podía cambiar de
forma sin que nada se quejara. Agregado `test_el_asesor_recibe_los_creditos_operables_descritos`, que
afirma la forma completa de la fila y que el crédito de un lender que no operamos (rt=4) **no aparece**.

**Estilo:** `pint` marcaba 5 archivos; **2 ya fallaban antes** de tocarlos (no se reformatean: inflaría el
diff con código ajeno al cambio) y los 3 que yo ensucié quedaron formateados. ⚠ **CI no corre pint** —
ningún workflow lo menciona—, así que esto no rompía el build; se hace por el diff, no por la guardia.

**68 tests en verde. 9 archivos, +705/-19.** Lo que queda pendiente NO es validación: es decisión de
producto (el tope de 4, sacar `POST /change-requests/{id}/otp`, y la ruta vieja de `Modules/Loans` que
todavía acepta el monto de la cuota del llamador).

### 2026-08-20 (19) — el cliente elige entre SUS créditos, y sólo entre los que operamos nosotros

Miguel: *«desde usuario sí puede tener más de un crédito… después de autenticarse debería enviarle los
créditos activos con rt=2… que liste los créditos de diferentes comercios y que lo seleccione y pueda
cambiar el plazo o la fecha»*. Y el tope: *«en producción un usuario con más de dos créditos es algo muy
extraño, le pondría un filtro de los primeros 4 y eso después lo reboto con producto»*.

Y antes preguntó lo que había que preguntar: *«¿no es simplemente buscar todas las solicitudes con el
número de cédula?»*. **Sí lo es** — pero el resultado crudo no sirve para un menú:

> **MEDICIÓN · 2026-08-20 (dev)** — para el cliente de prueba: **168 solicitudes → 6 con crédito activo
> → 2 con `response_type = 2`**. Un menú de WhatsApp admite 10 filas, así que las 168 no caben; y de las
> 6 activas, 4 no son nuestras para tocar.

**🔴 EL HALLAZGO, y es de los caros:** los tres créditos a los que hoy les cambié fecha y plazo probando
el canal —**412380, 412375, 412268**— son **todos de Credifamilia, `response_type = 4`**. Un lender cuyo
ciclo de vida NO llevamos nosotros. La API aceptó los cambios y quedaron escritos en nuestras tablas
mientras el lender que de verdad lleva el crédito no se enteró. **Eso es peor que un rechazo**, porque
deja los dos lados creyendo cosas distintas del mismo crédito.

    SELECT ur.id, l.name, l.response_type FROM user_requests ur
      JOIN lenders l ON l.id = ur.lender_id WHERE ur.id IN (412380, 412375, 412268);
    -- 412380 | Credifamilia | 4      412375 | Credifamilia | 4      412268 | Credifamilia | 4

**Por qué rt=2 es la regla y no una preferencia.** En el catálogo `response_types` (0 UTM · 1 Integración
· **2 Creditop X** · 3 Cupo Rotativo, y un 4 que usa Credifamilia), sólo en «Creditop X» el comercio pone
el capital y **CreditOp lleva el crédito**: ahí la fecha de pago y el plazo son nuestros para cambiar. En
los demás decide y gestiona el lender externo. Medido en dev: de los créditos activos, **1906 son rt=2 y
78 no**.

**Lo que se construyó, en tres piezas que se necesitan las tres:**

1. **El filtro**, en `ClientLookupService::conCreditoActivo()` — se le sumó un `whereExists` sobre
   `lenders.response_type = 2` al que ya miraba `creditop_x_requests_history.status IN (1,8)`. Vale para
   las dos entradas: la del asesor y la autogestión.

2. **La guarda**, en `CreditController::creditoDeLaSesion()` — y esta es la mitad que importa: **filtrar
   la lista no alcanza**, porque el `user_request_id` va en la URL y es enumerable. Sin la guarda, pedir
   directo un id que no estaba en el menú se salta el filtro entero. Responde **422
   `CREDIT_NOT_SERVICED_BY_US`**, no 404: el crédito existe y es de quien pregunta, así que esconderlo lo
   dejaría creyendo que se perdió; lo que hay que explicarle es que ese no se gestiona por acá.

3. **El tope, que AVISA.** `MAX_OPERABLES = 4` con orden explícito (`ORDER BY id DESC` — sin orden, «los
   primeros 4» es lo que devuelva MySQL, que puede cambiar entre corridas) y un `operable_truncated` que
   dice cuándo se recortó. Recortar en silencio deja a alguien sin poder gestionar un crédito y sin
   entender por qué; con el aviso, el bot lo manda con un asesor. ⚠ **El 4 es PROVISIONAL** — así quedó
   marcado en el código, a confirmar con producto.

**Y un cambio de contrato: `operable_request_ids` → `operable_credits`.** Una lista de ids no se puede
elegir. «Crédito #223999 / Crédito #126135» le pide a la persona reconocer un número interno que nunca
vio; con el comercio y la próxima fecha reconoce el suyo de una. Ahora cada fila trae
`user_request_id`, `merchant`, `lender`, `next_payment_date`, `installment_value`, `installment_number`,
`fee_number`. **Devuelve datos, no texto armado**: el título y el subtítulo los compone quien pinta el
menú, porque los límites (24 y 72 caracteres por fila) son del canal y no del backend. La misma forma en
las dos entradas —`self/otp`, `self/otp/verify` y la del asesor— para que el orquestador arme el menú
igual venga de donde venga.

> **MEDICIÓN · 2026-08-20 (local, flujo completo)** — `by-phone` 200 · `self/otp` 200 con
> `already_verified` y **2 créditos descritos** (`223999 Mediarte 2025-07-16` · `126135 CeluRD Test
> 2026-01-16`), `operable_truncated: false` · `can-change` de 126135 `true` · fechas ofrecidas **28/08 y
> 05/09, las dos futuras** · `change-payment-date` 200 → en la BD la fila vieja quedó `status 0` y la
> nueva activa con `2026-08-28`.
>
> La guarda, pedida a mano: `credits/412380/can-change` (Credifamilia rt=4) → **422
> `CREDIT_NOT_SERVICED_BY_US`**; `credits/126135/can-change` (rt=2) → pasa.
>
> El segundo crédito del cliente está **174 días en mora** y el backend lo rechaza con
> `HAS_PENDING_PAYMENT` — la rama que el prototipo tiene que saber contestar, y ahora la ejercitó.

**El prototipo del cliente quedó al día con esto:** consume `operable_credits`, arma las filas con el
comercio como título (recortado a 24, con desempate por número de crédito si dos filas quedaran iguales)
y la cuota + la fecha como descripción, avisa cuando el backend recortó, y el matcheo de la respuesta va
contra **el título que se mostró** y no re-parseando números del texto — sacar el número parecía más
tolerante y era peor: un título con un número propio elegía otro crédito. Probado con un comercio de 47
caracteres: **cero violaciones** de los límites de WhatsApp.

⚠ **Y lo que faltaba, que Miguel vio de inmediato: la lista no aparecía.** El prototipo tiene DOS
motores —el guion (demo, que no toca la red) y el despachador de fases (modo real)— y yo había agregado la
lista sólo al segundo. En el modo por defecto el flujo iba de «verificado» derecho al menú de acciones,
así que el listado de comercios no existía. Agregado al guion como un paso propio (`creditos`), con un
interruptor **«Tiene créditos en 2 comercios»** encendido por defecto: con él prendido la persona elige
entre *Mediarte* y *CeluRD Test* y después ve el menú; apagado va derecho al menú, que es lo que pasa con
un solo crédito. Corrido en el navegador: **22 globos, cero violaciones de WhatsApp** en el camino con
lista. Lección: agregar algo al despachador **no** lo agrega al demo, y el demo es lo que se mira primero.

⚠ Y una tercera categoría de error que el prototipo no tenía: además de «culpa nuestra» (401/403/5xx/red)
y «dato del cliente» (404), están los **rechazos de negocio**, donde el backend ya escribió un mensaje
para que lo lea la persona. Ahí el ⚠ estorba: no hay nada roto ni nada que reintentar. Los códigos están
tomados del backend, no inventados: `HAS_PENDING_PAYMENT`, `EXTERNALLY_SERVICED`, `NO_ACTIVE_CREDIT`,
`RECENT_CHANGE_EXISTS`, `FEE_NOT_AVAILABLE` y el nuevo `CREDIT_NOT_SERVICED_BY_US`.

**66 tests en verde** (+3): sólo son operables los créditos que operamos nosotros · el tope ofrece 4 y
avisa cuando hay más · un crédito propio de un lender que no operamos se rechaza explicándolo. Los dos
primeros son de servicio y el tercero **de ruta**, que es donde vive la guarda.

⚠ **Trampa del fixture, medida:** `lenders` tiene FK a `paths` y `promissory_types` con default 1, y el
esquema `testing` de local está **vacío de catálogos** — el insert falla por integridad referencial y no
por la regla que se quiere probar. Hay que sembrar las dos filas. (`slug` también es obligatorio y sin
default.)

**Deuda chica encontrada de paso:** cuando el crédito está en mora, `payment-date-options` contesta *«No
puedes cambiar el **plazo** de tu crédito si tienes una deuda pendiente»* — el mensaje nombra el plazo
aunque se esté preguntando por la fecha. Es copy de `Modules/Loans` compartido por los dos caminos; lo ve
el cliente, así que conviene arreglarlo, pero no es de esta tarea.

⚠ **Nota de método:** el prototipo NO se pudo ejercitar desde el navegador del harness — sirve el archivo
como `data:` (origen opaco) y `fetch` a `localhost` queda bloqueado por CORS. Abriéndolo con `file://`
funciona. Lo verificado por API acá es curl contra local; lo verificado del prototipo es su lógica de
armado de filas, corrida en la página con las formas reales.

### 2026-08-20 (18) — autenticar PRIMERO, y dos bugs más — uno con plata de por medio

Pedido de Miguel: que el prototipo sea coherente con que **primero se autentica**. Había una incoherencia
real: `saludo` saludaba **por nombre** antes del OTP, y `by-phone` devuelve nombre y documento
enmascarado. En ese punto la persona no probó nada — sólo tiene el teléfono en la mano. Con un celular
robado, un «¡Hola María Fernanda!» ya entrega un dato. Corregido en los DOS modos: la llamada a
`by-phone` se hace igual (sirve para cortar si el número no está en ningún crédito, y eso no filtra nada
porque es su propio número) pero **el nombre se usa recién después de verificar**.

El demo también se reordenó —antes preguntaba la intención primero— y se le agregó el paso «acciones»,
que faltaba: verificar → **el crédito admite cambios** → recién ahí el menú. Corrido entero: 19 globos,
los dos caminos (fecha y plazo) y **cero violaciones de los límites de WhatsApp**.

> **MEDICIÓN · 2026-08-20** — camino del PLAZO cerrado contra local: `fee-number-options` 200 con 4
> opciones (actual 12, elegibles 6/18/24) · `change-fee-number` con **sólo `fee_number`** → 200, y el
> crédito 412375 quedó en 6 cuotas de **$177.442,87** con `otp_id = 296490`.

🔴 **El bug con plata de por medio.** `change-fee-number` daba **500 `Undefined array key "fee_value"`** a
quien siguiera el contrato, porque la validación sólo pide `fee_number` y `CreditChangeService` lee
`fee_value`. Pero lo grave no es el 500: es lo que hace con ese valor —

    'installment_value' => $selectedFee['fee_value'],

**el monto de la cuota lo pone quien llama.** Y la ruta VIEJA del crédito (`Modules/Loans`) lo **exige**
en el cuerpo validándolo sólo como `numeric, min:0`, sin compararlo contra lo que ofreció. O sea que por
ahí se puede fijar la cuota en lo que se quiera, y eso está en producción hoy.

Arreglado **en el canal**: el controlador busca la opción entre las que este canal ofreció y usa SU
valor; lo que venga en `fee_value` se ignora. Probado mandando `fee_value: 1` a propósito — el crédito
quedó en **$51.799,18**, el valor real. Y si el plazo pedido no está entre los ofrecidos, responde 422
`FEE_NOT_AVAILABLE` en vez de escribir.

⚠ **Arreglar la ruta vieja es otra tarea y no se toca acá**, pero conviene decidirlo: hoy acepta el monto
del llamador.

🔴 **Y un latente que salió escribiendo el test:** `simulatePossibleFees` hacía
`->userRequest->lender->cutoff_type_id` **sin guarda de null**, mientras las tres líneas de arriba usan
`?? 0`. Una solicitud sin lender —las incompletas no lo tienen— reventaba con 500 en vez de devolver «no
hay opciones». Corregido con `?->`.

**63 tests en verde.** La rama `feat/CORE-258-solicitud-operable` acumula **6 archivos, +257 líneas, seis
bugs** — sigue sin commitear, esperando el PR único.

### 2026-08-20 (17) — el flujo del cliente, en el orden correcto, y TRES bugs que salieron al correrlo

Miguel fijó el orden: **la persona pone su cédula, se valida con el OTP, y ahí se le trae su solicitud;
sobre esa solicitud puede hacer varias cosas.** El prototipo preguntaba la intención ANTES de saber quién
era y si había algo que hacer — ofrecer «cambiá tu fecha» antes de mirar es prometer sin mirar.
Reordenado: identidad → solicitud → **menú de acciones**.

⚠ Y eso resuelve solo el debate del NLU: **si el menú viene después, no hay texto libre que
interpretar.** La persona toca una opción de una lista cerrada.

**Todo en una rama, `feat/CORE-258-solicitud-operable`, sin commitear** (decisión de Miguel: un PR con
todo). Validado contra local, no contra dev.

> **MEDICIÓN · 2026-08-20** — flujo completo en local, en el orden nuevo: `by-phone` 200 (JOSE FERNANDO)
> · `self/otp` 200 · `verify` 200 con **6 solicitudes operables** de 166 · `can-change` `true` ·
> opciones **28/08 y 05/09, las dos futuras** · `change-payment-date` 200 → el crédito 412380 pasó de
> `2026-07-16` a `2026-08-28`, con `creditop_x_changes_log #45` y **`otp_id = 296489`**, no 0.

**Los tres bugs, todos encontrados corriendo el flujo y ninguno visible leyendo el código:**

1. 🔴 **n8n no tenía de dónde sacar el `user_request_id`.** `self/by-phone` no devolvía créditos y
   ninguna ruta los listaba; en el prototipo yo llenaba el campo a mano y eso lo tapaba. Ahora `verify`
   devuelve `operable_request_ids` — después de probar identidad, no antes: decirle a un número no
   verificado qué créditos tiene sería contarle algo a quien no demostró ser su dueño.

2. 🔴 **`operableRequestsFor` no filtraba por crédito activo**, así que devolvía todo el historial: un
   cliente de prueba daba 40 ids cuando el operable era uno. Medido en dev: entre el 7% y el 54% de los
   clientes de un comercio tiene más de una solicitud, pero sólo del 0% al 1,9% tiene más de un crédito
   ACTIVO. La regla que Miguel describió es real, pero es sobre el crédito vivo, no sobre la solicitud.

3. 🔴 **Un cliente ya verificado no podía volver a entrar.** `self/otp` daba **409 INVALID_STATE** porque
   `emit()` intentaba bajar la sesión de `otp_verified` a `otp_sent`, que la máquina prohíbe con razón.
   Pasa en el camino MÁS COMÚN: alguien hace un cambio y vuelve a los dos minutos, dentro de los 15 de
   TTL. Ahora contesta 200 con `already_verified: true` y las solicitudes operables, para que el bot
   siga. No debilita nada: para llegar ahí hay que acertar el número Y la cédula, igual que antes.

4. 🔴 **Y el peor, porque el cliente lo veía:** `payment-date-options` ofrecía fechas que
   `change-payment-date` rechaza. `getNextPaymentCycles` anclaba en la fecha del crédito y nunca en HOY,
   así que con una fecha vencida ofrecía dos opciones pasadas — y la validación exige
   `after_or_equal:today`. **Un menú donde TODAS las opciones fallan.** Corregido: el ancla es
   `max(fecha del crédito, hoy)`. Con fecha futura —el caso sano— no cambia nada.

   ⚠ Ese generador es COMPARTIDO: lo usan también las rutas viejas del crédito (Consumer y Customer),
   que **NO validan `after_or_equal:today`** — o sea que hoy la app móvil deja poner una fecha de pago en
   el pasado. Con este cambio dejan de OFRECERLA, pero validar su entrada es otra tarea.

**62 tests en verde**, con cuatro nuevos que blindan lo encontrado: una solicitud sin crédito activo no es
operable · la autogestión ve sus activos de cualquier comercio · no se ofrecen fechas pasadas aunque el
crédito tenga la fecha vencida · con fecha futura el ancla sigue siendo la del crédito.

### 2026-08-20 (16) — los prototipos VALIDAN los límites de WhatsApp al pintar (y encontraron uno)

La sección §«Los componentes de WhatsApp y sus límites» ya tenía los números y el guion se auditó a mano
contra ellos —33 controles—. Pero eso dejó un hueco que los despachadores nuevos abrieron: **arman los
textos y los botones desde lo que devuelve la API**, así que pueden producir mensajes que WhatsApp
rechazaría y nadie se enteraría hasta que Meta rechace la plantilla, que cuesta días.

Se agregó un validador que corre **al pintar cada globo** y pega el aviso al globo que lo produjo — no en
un log aparte, porque lo único que sirve es saber QUÉ mensaje concreto no se puede enviar. Chequea cuerpo
≤ 1024, botones ≤ 3 con ≤ 20 caracteres, filas de lista ≤ 10 con título ≤ 24 y descripción ≤ 72, y avisa
si más de 3 opciones van como botones en vez de lista.

Dos decisiones de implementación que importan:
- **Mide el TEXTO, no el HTML.** `<b>` no viaja a WhatsApp: viaja `*negrita*`. Contar el markup daría
  falsos positivos y en dos días nadie miraría los avisos.
- **Sólo revisa lo que manda el bot.** Lo que escribe la persona no pasa por límites de componentes.

> **MEDICIÓN · 2026-08-20** — el validador encontró de entrada una violación que la auditoría a mano de
> los 33 controles había dejado pasar: el botón **«Cambiar también el plazo» mide 24 y el límite de un
> botón es 20**. Corregido a «Cambiar el plazo» (16). Recorriendo los dos caminos del cliente —fecha y
> plazo— quedan 19 globos con **cero** violaciones, y el del asesor ya tenía cero.

**Y lo que esto va a atrapar en vivo**, que es su verdadero valor: si `fee-number-options` devuelve más de
10 plazos, la lista se pasa del techo de WhatsApp. Contra el dato de prueba no se ve; contra un crédito
real con una línea larga, sí. Eso es un requisito para la API —o el backend acota, o n8n pagina— y ahora
se descubre corriendo en vez de en la revisión de Meta.

⚠ De paso, un error propio: al acortar el botón dejé un comentario `//` DENTRO del array, y se comió el
resto de la línea. El prototipo quedó en blanco hasta que lo vi. Los `//` no van en medio de un literal.

### 2026-08-20 (15) — la FRONTERA del entregable: la API, no la conversación

Aclarado por Miguel: **lo que este equipo entrega es la API** —entregar datos y confirmar acciones—. Que
la conversación del cliente sea más o menos charlada, estilo chatbot, es **gusto y no necesidad**: el
recorrido del cliente debería ser, como el del asesor, una secuencia de ACCIONES. La conversación la arma
quien construya el bot en n8n.

⚠ **CORRECCIÓN de lo que se escribió primero acá.** Se dijo que el paso `nlu/interpretar` era «una
ficción de la maqueta que hacía daño». **Está mal**: esta misma tarea ya lo documentaba como ajeno, en la
sección §«Lo que NO construimos nosotros» — *«aparece en la traza del prototipo del cliente, pero es de
Filipo… se lista para que quede claro dónde encaja, no como entregable nuestro»*. La frontera estaba
escrita desde el 13/8; el error fue no leer esa sección antes de opinar.

> **MEDICIÓN · 2026-08-20** — el endpoint no existe ni existió: cero apariciones en `Modules/SupportBot`,
> cero entre las 16 rutas del gateway, cero integraciones de LLM, y `git log --all -S` sobre TODAS las
> ramas no encuentra ningún commit que lo haya creado. Está bien que no exista: no es nuestro.
> `git grep -iE "nlu/interpretar" $(git for-each-ref refs/remotes/origin)`

**Lo que sí era un problema, y es más chico:** el prototipo lo dibujaba bajo `/api/support/nlu/interpretar`
— **nuestro namespace**. Eso es lo que lo hacía parecer del backend, aunque la tarea dijera lo contrario:
quien mirara sólo la maqueta veía un endpoint del canal. Corregido: el paso dice ahora **`n8n · decide sin
llamarnos`** y se pinta distinto en la traza (gris, itálica). Y los dos prototipos llevan arriba la
frontera escrita, que antes sólo vivía en el cuerpo de la tarea.

**Y sobre si hace falta un modelo para interpretar** — la respuesta que salió de implementarlo: hay **dos
intenciones**. El despachador las resuelve con palabras clave y usa el menú como respaldo, que es más
barato, determinista y **testeable** — con un modelo sólo se puede esperar que acierte, no garantizarlo.
El criterio queda escrito: medir cuántas veces cae al menú, y recién ahí evaluar un clasificador. Si
igual se pone uno, dos condiciones: que CLASIFIQUE y no redacte (la plataforma prohíbe el asistente
abierto desde enero de 2026), y que el **catálogo de intenciones venga del backend** — es la única parte
que sí es nuestra, porque si n8n tiene su propia lista va a rutear a capacidades que no existen (como el
endpoint inalcanzable del Registro (14)).

### 2026-08-20 (14) — POR QUÉ el endpoint es inalcanzable: dos «segundos factores» en un solo objeto

Antes (Registro (10)) quedó medido QUE `POST /change-requests/{id}/otp` no se puede llamar. Acá queda la
causa, que es lo que decide el arreglo.

**Es del CLIENTE.** Entra por `solicitudDelCliente` → `sesionVerificada(wa, 'client')`. El asesor no lo
toca: él crea la solicitud y se queda esperando.

**El choque, en dos líneas de código.** El endpoint necesita dos cosas al mismo tiempo: la solicitud en
`Autorizada`, y la sesión pudiendo pasar a `OtpSent` para emitir un código nuevo. Pero `authorize` exige
que la sesión esté `OtpVerified`, y en `AuthorizationState`:

    self::OtpVerified => [self::Expired],

Una sola salida, con el porqué escrito al lado: *«Una vez probada la identidad, la sesión sólo puede
terminar — no se puede bajar a un estado con menos privilegio y seguir usándola.»* Las dos condiciones
son **mutuamente excluyentes**. Ninguna máquina está mal; el error fue suponer que se componen.

**La causa de fondo, y lo que hay que corregir si se quiere el segundo factor:** el diseño quería DOS
pruebas distintas —el OTP de la sesión prueba *quién sos*, el OTP del cambio prueba *que aprobaste ESTE
cambio*— y colgó las dos del MISMO objeto, la sesión. Así, probar la identidad consume el mecanismo que
iba a probar la intención. Si producto quiere el segundo factor, tiene que vivir en la **solicitud de
cambio**, no en la sesión: agregarle una transición a la sesión sería justo lo que la regla prohíbe.

**Y la evidencia de que quedó de una versión anterior del diseño:** `ChangeRequestFlowTest` tiene 10
tests, incluido `test_el_flujo_completo_escribe_el_dato_y_deja_la_prueba`, y **ninguno llama a `/otp`** —
el «flujo completo» va `authorize → confirm` y salta ese paso. Los tests ya codifican el flujo correcto.
Quien lo escribió incluso previó que la transición podía fallar (hay un `catch InvalidSessionTransition`)
pero sin un test que llegara ahí, nunca se vio que falla SIEMPRE.

**Recomendación:** sacarlo. Es lo que `confirm` y los tests ya dan por hecho, y la prueba que queda es el
`otp_id` de la identificación — el mismo que verificamos escrito en `creditop_x_changes_log #36`, que era
el objetivo de la tarea. Deja el gateway en 15 rutas.

### 2026-08-20 (13) — el del ASESOR también, y son DOS máquinas que se hablan

Mismo tratamiento, pero acá está la parte difícil de todo el canal: **n8n sostiene dos conversaciones y
lo único que las ata es el `request_id`**. No hay sesión compartida ni usuario común — el asesor tiene la
suya, el cliente la suya, y el backend rechaza cruzarlas (`WRONG_ACTOR`).

Se armaron **dos máquinas de fases** con un solo objeto compartido (`LINK`), que lleva el id de la
solicitud y nada más. Y eso hace visible algo que el guion escondía:

- la conversación del cliente **arranca DORMIDA, con el input trabado**. No existe hasta que el asesor
  crea la solicitud: ese momento es el webhook que n8n dispara hacia el otro chat. Verificado — antes de
  crear nada, `CB.fase = "dormida"` y el composer del cliente está deshabilitado;
- la del asesor **termina en «esperando»** y se traba: no puede seguir sola, y eso es correcto;
- para autorizar, **el cliente tiene que identificarse en SU conversación**. n8n no puede reusar la
  sesión del asesor. En el guion esto no se veía porque el cliente sólo tocaba un botón.

Y se aplicó lo aprendido en el del cliente: `POST /change-requests/{id}/otp` **no se llama**, porque es
inalcanzable (Registro (10)) y `confirm` no lo necesita. El prototipo salta directo de `authorize` a
`confirm`, que es lo que Filipo tiene que construir.

También lleva la separación de culpas: ante un **401** el asesor lee «tengo un problema técnico», no «no
encontré un asesor con esa cédula». Verificado con el token vacío.

Verificado en los dos modos servido por HTTP: demo → 14 globos, cero duplicados, 3 líneas declaradas y
**cero llamadas de red**; real → las dos fases arrancan como deben y el 401 se explica bien.

### 2026-08-20 (12) — el prototipo del cliente pasa de guion a MÁQUINA DE FASES (lo que n8n va a ser)

Hasta acá el prototipo era un **demo reel**: un puntero recorriendo pasos escritos, con los inputs
pre-rellenos. Aunque llamara la API de verdad, el CAMINO estaba escrito. Pedido de Miguel: que se
comporte como WhatsApp real, con las acciones que va a tomar n8n.

Se agregó un **despachador de fases** que en modo real reemplaza al puntero. Once fases —`saludo`,
`intencion`, `cedula`, `codigo`, `opcFecha`/`opcPlazo`, `elige…`, `aplica…`, `fin`— y cada una es un
nodo: recibe lo que la persona escribió o tocó, llama la API, y **la respuesta decide** qué contesta y a
qué fase pasa. El modo demo sigue con el guion, intacto, para mostrárselo a producto sin depender de
que local esté levantado.

Cuatro cosas del diseño que valen más que el código:
1. **La conversación arranca vacía y espera que la persona escriba**, como WhatsApp de verdad. No hay
   auto-avance ni inputs pre-rellenos: escribís tu cédula, tocás la opción.
2. **Los botones de lista entran por el MISMO camino que el texto.** Para n8n una respuesta de lista y
   un mensaje escrito llegan igual; tratarlos distinto en el prototipo esconde bugs de allá.
3. **Una fase que no entiende NO avanza**: vuelve a preguntar lo mismo. Es lo que hace un bot real, y un
   guion con puntero no lo puede representar.
4. **La rama la decide el backend.** Si `can_change` viene `false`, la conversación cambia porque el
   backend lo dijo — y el globo muestra su `message` tal cual, que es lo que el cliente leería.

🔴 **Y encontró un error de diseño mío, del tipo que importa:** ante un **401** (token del bot mal) el
bot le contestaba al cliente **«este número no está registrado en un crédito»**. Son culpas distintas y
confundirlas es mentirle a la persona, además de mandarla a buscar el problema donde no está. Se separó
con `esNuestraCulpa()`: 404 es del dato («no encontré una cuenta con ese número»), mientras 401, 403,
5xx y un fetch que no sale son **nuestros** y se contestan «tengo un problema técnico, intentá en un
rato». Verificado: con el token vacío ahora dice lo segundo.

Eso es exactamente la clase de regla que Filipo necesita y que no estaba escrita en ningún lado.

### 2026-08-20 (11) — ✅ probado contra DEV con entrega REAL, y con el `otp_id` que la tarea buscaba

Lo único que nunca se había validado era que **el proveedor entregue de verdad**: todo lo anterior fue
por bypass, y el `success: true` que devuelve `otp-service` no prueba que el mensaje llegue. Miguel
prestó su celular para cerrar eso.

**Costó una sola línea, y era un arreglo.** Miguel ya tenía usuario asesor en dev (`id=1827130`, perfil 4
Comercial, comercio 158, `miguel+motai@creditop.com`) pero su celular era `4-3015646544` — con el prefijo
basura `4-` que arrastran muchas filas de esa tabla, o sea **un número al que el proveedor no puede
entregar**. Ese asesor no podía recibir su OTP.

> **MEDICIÓN · 2026-08-20** — recorrido del asesor contra dev con ENTREGA REAL. `advisor/otp` a
> `whatsapp:+573016992677` → `qa_bypass=0`, el SMS llegó y el código (`184661`) verificó:
> `otp_verified`, `allied_ids: [158]`. Luego `clients` 200 (QA AUTOMATION) · `change-requests` 201 ·
> `authorize` 200 · `confirm` 200 **`aplicada`**.

🎯 **Y acá está lo que la tarea vino a conseguir, verificado en la base:**

> **MEDICIÓN · 2026-08-20** — el crédito 465030 quedó con `next_payment_date = 2026-10-05`, y el registro
> `creditop_x_changes_log #36` tiene **`otp_id = 297011`** — una fila real de `otps`, del celular del
> cliente, `validated = 1`, creada 25 segundos antes. **No es 0.**
> `SELECT otp_id FROM creditop_x_changes_log WHERE user_request_id=465030 ORDER BY id DESC LIMIT 1`

Eso es exactamente el defecto que el canal existía para cerrar: hoy producción escribe `otp_id = 0` y no
hay prueba de que nadie autorizara nada. Ahora la hay, y es trazable hasta el código que la persona
escribió.

**Dos cuidados que se tomaron y conviene repetir:**
- El cambio fue de **fecha de pago**, no de celular. Cambiarle el teléfono a un cliente bypasseado lo
  saca de la lista utilizable y **le rompe las pruebas a otros**; la fecha no le estorba a nadie.
- El cliente elegido es «QA AUTOMATION» (`3109000004`, doc `37670195`, solicitud `465030`), con teléfono
  bypasseado y crédito activo. Sólo a Miguel le llegó un mensaje real; al cliente, ninguno.

⚠ **Pendiente de limpieza:** la fila `users.id=1827130` quedó con `cell_phone='3016992677'`. El valor
anterior (`4-3015646544`) estaba roto, así que volver a él no tiene sentido — conviene dejarlo con un
número bypasseado o con el de Miguel a propósito, pero **decidido**, no por olvido.

### 2026-08-20 (10) — el recorrido del ASESOR funciona, y uno de los 16 endpoints es inalcanzable

Probado de punta a punta **en local**, por la ruta del canal y **sólo con el token** — cero Cognito en
todos los pasos (las 16 rutas del gateway se expusieron con `authorizer_name = null`, verificado en el
repo de infra).

> **MEDICIÓN · 2026-08-20** — recorrido completo del asesor en local: `advisor/otp` 200 ·
> `advisor/otp/verify` 200 (`allied_ids: [94]`) · `clients` 200 (MARIA GOMEZ, enmascarada) ·
> `change-requests` **201** (`request_id`, estado `pendiente_autorizacion`) · el CLIENTE se identifica ·
> `authorize` 200 (`autorizada`) · `confirm` 200 (**`aplicada`**, el dato escrito).
> Asesor `TMIGADVISER` / cel `3133122615` / comercio 94 · cliente `1099887704` / cel `3099000002`.

🔴 **`POST /change-requests/{id}/otp` no se puede llamar nunca.** La secuencia lo hace imposible:
`authorize` exige que la sesión del cliente esté `otp_verified`, y desde ese estado el endpoint responde
**409 «No se puede pasar de otp_verified a otp_sent»** — `AuthorizationState` prohíbe bajar el privilegio
de una sesión que ya probó su identidad, que es una regla correcta y deliberada.

Y **no hace falta**: `confirm` usa `$session->verifiedOtpId()`, o sea el OTP de la identificación, que es
justamente el `otp_id` REAL que esta tarea vino a poner donde producción escribe 0. O sea que el segundo
factor sobre el cambio ya está cubierto por el primero.

**La decisión es de producto, no de código:** o el endpoint se saca (y los 16 pasan a 15, con una ruta
menos en el gateway), o se acepta que un cambio pide su propio código y entonces hay que darle a la
máquina de estados una transición para eso. Hoy es código muerto que además hace fallar a cualquiera que
siga el diseño escrito.

**Dos correcciones al prototipo del asesor**, las dos salidas de correrlo:
- el id de la solicitud viene como **`request_id`**, no `id` — con `id` quedaba `undefined` y los pasos
  siguientes pegaban a `/change-requests/undefined/…`;
- el paso de confirmar ya no llama al OTP del cambio: era la llamada inalcanzable.

⚠ Para poder correrlo se agregó `3133122615` a `settings.qa_otp_bypass_phones` **en LOCAL** (64 → 65
números). Es una escritura local y descartable; la reversa quedó en `/tmp/bypass-local-antes.txt`.

⚠ **Y un error propio que conviene no repetir:** antes de eso probé el mismo asesor contra **dev**, donde
su teléfono NO está bypasseado, así que **salió un SMS real** a un número que no es mío
(`otp_service: {success: true}`, 19:13:33). Verifiqué que el documento fuera sintético pero no de quién
era el teléfono — un número en una fila de prueba puede ser el de una persona real. El OTP queda cifrado
en la tabla `otps`, así que no se puede leer sin el `APP_KEY`, y no se intentó.

### 2026-08-20 (9) — el fix ya está en dev, y los prototipos apuntan a dev con un click

Miguel mergeó `fix/CORE-258-credits-find-by-id` a `develop` y el deploy rodó. Verificado: el fix y el
test nuevo están en `origin/develop`, y el ambiente ya lo corre.

> **MEDICIÓN · 2026-08-20** — recorrido de autogestión COMPLETO contra dev, por el gateway público:
> `self/by-phone` 200 · `self/otp` 200 · `verify` 200 · `can-change` **200 `can_change: true`** ·
> `payment-date-options` 200 con opciones reales · `fee-number-options` 200 con cuotas y valores.
> Sujeto: teléfono `3108000001`, cédula `79799966`, solicitud `463278` (bypasseado, crédito activo).

⚠ **Un susto que NO era un bug, y conviene tenerlo escrito:** la primera corrida dio 500 con el mismo
`::find()` en `fee-number-options`, y estuve buscando un segundo defecto. No lo había: dev corre **2
tareas** y el rollout estaba a medias, así que las peticiones alternaban entre la imagen nueva y la
vieja. Seis intentos seguidos después dieron 200 los seis. **Justo después de un deploy, dev sirve una
mezcla** — un 500 aislado ahí no es un bug hasta que se repite.

**Los tres prototipos ahora tienen selector de ambiente** (local / dev), un click. Tres cosas que el
selector hace y que no son obvias:
- dev pega por el **API Gateway con prefijo `/legacy-api`**, no `/api`: son dos superficies distintas y
  confundirlas da 404.
- **limpia el token** al cambiar, porque el de dev y el de local son distintos y viven en secretos
  distintos. Dejarlo puesto daría un 401 confuso.
- al elegir dev **aparece un aviso**: dev es compartido con el equipo y los pasos finales del guion del
  cliente **escriben** (fecha de pago, plazo, datos de contacto) sobre clientes que otros usan para
  probar. No es decorativo — es la diferencia entre probar y estorbar.

### 2026-08-20 (8) — el prototipo del CLIENTE también corre contra la API local

Mismo tratamiento que el del asesor: interruptor **«Modo real»**, apagado idéntico a antes. Cableados
**los 7 pasos** del recorrido, o sea el flujo completo de autogestión — incluidos **los dos que
ESCRIBEN** (`change-payment-date` y `change-fee-number`).

Lo que aporta más que en el del asesor, y no lo tenía pensado al empezar:

1. **Los menús de WhatsApp se arman con lo que devuelve el backend.** Las fechas de corte y los plazos
   con su valor de cuota salen de `payment-date-options` y `fee-number-options`, no de los botones
   escritos en la maqueta. Si mañana cambian los ciclos, el menú cambia solo. `is_available` deshabilita
   la opción y `is_current` marca la actual (elegirla no es un cambio).
2. **Los pasos que escriben mandan una opción que el backend ofreció**, no una inventada: la primera
   disponible que no sea la actual. Una fecha a mano la rechazaría la validación
   (`after_or_equal:today` más el ciclo de corte), y el cuerpo del plazo va como
   `selected_fee: { fee_number }`, que es la forma que valida el request.
3. **La rama «no elegible» la decide el BACKEND, no el checkbox.** En modo real, `can_change` de la
   respuesta manda; el checkbox del prototipo sigue mandando en modo demo. Y si el backend dice que no,
   el globo muestra su `message` tal cual — que es lo que el cliente leería.

Un defecto propio, encontrado corriéndolo (y que estaba también en el del asesor, ya arreglado allá):
había **tres** caminos que llaman a `run()` —`reset()`, el auto-submit del input y la elección de un
botón— y cualquiera podía re-entrar al mismo paso, así que un fallo real pintaba el globo de error y el
STOP **dos veces**. Se lee como dos fallos distintos. Se arregló con dos defensas: un cerrojo `detenido`
y el bloque de STOP hecho idempotente.

Verificado en los dos modos, servido por HTTP: demo → 13 globos, 7 líneas declaradas, **cero
duplicados**, sin tocar la red; real → la llamada pintada en rojo, el error dentro del globo de WhatsApp
y un solo STOP.

### 2026-08-20 (7) — el prototipo del ASESOR ahora corre contra la API local

Pedido de Miguel: no un panel técnico aparte, sino **el mockup de WhatsApp manejado por la API**, para
ver la conversación real. Se cableó el del asesor (el del cliente queda para después).

**Cómo se hizo sin romper el mockup:** hay un interruptor **«Modo real»**. Apagado, el prototipo se
comporta EXACTAMENTE como antes —sirve para mostrárselo a producto sin depender de que local esté
levantado—; prendido, cada paso que declara una API la llama de verdad. El enganche ya existía en el
archivo: cada paso declaraba su `api` (el objeto `A`) y el motor permitía que el texto del globo fuera
una **función**. Sólo hubo que hacer `apiCall` asíncrono, llamarlo ANTES de armar el texto (antes el
orden congelaba el globo) y darle a los pasos un descriptor `real()`.

Lo que se ve: el error del backend aparece **dentro del globo de WhatsApp** («⚠ El backend rechazó la
verificación», con el código), y la traza de la derecha pinta cada llamada en verde o rojo con su HTTP y
su cuerpo. Cableados 6 pasos: login del asesor (otp + verify), buscar cliente, crear la solicitud de
cambio, autorizar y confirmar. Los no cableados lo dicen en la traza en vez de fingir.

Tres decisiones que costaron pensarlas:
1. **Un paso puede hacer VARIAS llamadas, y se ven las tres.** `authorize` exige sesión de CLIENTE, y en
   la conversación del asesor esa sesión no existe: n8n tiene que identificar al cliente en SU
   conversación antes. Esconderlo haría creer que el asesor autoriza por él.
2. **En modo real, una llamada que falla DETIENE el guion.** Sin eso la conversación seguía con globos
   simulados después de un error real — mezclar lo que pasó con lo que está escrito es peor que no
   correr, porque quien mira no puede distinguirlos.
3. **El token va al `localStorage`, no al archivo** (los artefactos se versionan), y el código del OTP se
   calcula como los últimos 4 dígitos del teléfono (bypass de local), así que el guion avanza solo.

Un defecto propio, encontrado corriéndolo: `apiCall` creaba un `<li>` que en el camino real nunca
agregaba y después intentaba quitar → `NotFoundError` en `removeChild`, que dejaba el guion trabado sin
decir nada. Arreglado y verificado en los dos modos.

⚠ **No se puede validar en la vista previa de archivo local**: envuelve el HTML en una URL `data:` que
bloquea los scripts inline. Hay que servirlo por HTTP — el tablero lo hace en `/artifacts/<archivo>`.

### 2026-08-20 (6) — tercer prototipo: cómo consume n8n, pegando contra local

Los dos prototipos que había muestran la **conversación** (lo que ve el cliente, lo que ve el asesor).
Se agrega `…-modificacion-datos.n8n.html`, que muestra la otra mitad: **qué llamadas hace n8n, en qué
orden y qué decide con cada respuesta** — y las respuestas son REALES, salen del backend local por
`fetch`, no de un guion. Si un paso falla ahí, falla de verdad.

**Por qué un tercer archivo y no cablear los dos que ya estaban:** son mockups pulidos de la
conversación y su valor es mostrárselos a producto. Atarlos a la API los rompería cuando local no esté
levantado, y además es otra pregunta y otro lector — el consumidor de esto es Filipo, que tiene que
construir los nodos.

Lo que aporta y no estaba escrito en ningún lado: **la especificación de las ramas**. Cada paso dice qué
hacer con cada código, porque ahí está la parte difícil — que `404 CLIENT_NOT_FOUND` es el MISMO cuerpo
si el número no existe o si la cédula no coincide (a propósito, para que el canal no sea un oráculo), y
que `409` tiene dos sabores distintos (`SESSION_NOT_FOUND` = volvé a identificarte, `NOT_VERIFIED` = te
falta el código). Si n8n los trata igual, el cliente queda en un callejón.

Y deja visible lo que más cuesta del recorrido del asesor: **n8n sostiene DOS conversaciones** y la
única cosa que las ata es el `id` de la solicitud de cambio. El asesor crea (sesión de asesor); el
cliente autoriza, recibe el código y confirma (sesión de cliente). El backend rechaza cruzarlas con
`WRONG_ACTOR`.

Detalles de la implementación, por si hay que retomarla:
- **El token NO está en el archivo.** Los artefactos se versionan, así que va en un campo y queda en el
  `localStorage`. El aviso está arriba en la página.
- El código del OTP se calcula solo como los últimos 4 dígitos del teléfono (el bypass de
  `local`/`development`), así que el flujo corre sin que nadie lea un SMS.
- **Se detiene en el primer paso que no dé 2xx**, a propósito: los pasos dependen del anterior y seguir
  sólo produce una cascada de 409 que esconde el problema real.
- Verificado servido por HTTP: el script corre (6 pasos cliente + 7 asesor), el CORS del backend local
  lo permite (`allowed_origins: ['*']` sobre `api/*`, preflight 204 con `Allow-Headers: authorization`)
  y sin token el diagnóstico dice «401 — el token no coincide», que es lo correcto.
- ⚠ **No se puede validar en la vista previa de archivo local**: envuelve el HTML en una URL `data:`, que
  bloquea los scripts inline. Hay que servirlo por HTTP — el tablero ya lo hace en `/artifacts/<archivo>`.
- De paso se les agregó `<meta charset="utf-8">` a los TRES prototipos de la tarea: ninguno lo declaraba
  y se veían con caracteres roídos en cualquier server que no manda el charset (se vio con
  `python3 -m http.server`).

### 2026-08-20 (5) — 🔴 el flujo de OTP FUNCIONA, y aparecieron dos defectos

Primera prueba funcional del canal en dev, con un cliente sintético cuyo teléfono está en la lista de
bypass de OTP (`settings.qa_otp_bypass_phones`, 34 números). **Elegir un número bypasseado fue a
propósito**: en `local`/`development` el bypass hace que `sendOtpCode` NO llame al proveedor, así que no
sale ningún WhatsApp a una persona real, y el código es los ÚLTIMOS 4 DÍGITOS del teléfono.

> **MEDICIÓN · 2026-08-20** — el recorrido de autogestión funciona de punta a punta contra dev:
> `self/by-phone` → 200 · `self/otp` → 200 `otp_sent` (destino enmascarado `313***4490`, 15 min, 3
> intentos) · `self/otp/verify` con código malo → 422 `OTP_INVALID` con `attempts_left: 2` · con el
> bypasseado → 200 `otp_verified`. Sujeto: teléfono `3132804490`, cédula `1004877929`, solicitud 464946.

🔴 **DEFECTO 1 — los 5 endpoints de `credits/*` revientan con 500.** Es la mitad de autogestión
completa, o sea lo que el cliente hace solo.

> **MEDICIÓN · 2026-08-20** — `GET credits/{id}/can-change`, `payment-date-options` y
> `fee-number-options` devuelven 500:
> `Call to undefined method Modules\Loans\App\Repositories\UserRequestRepository::find()`

La causa es de una palabra: `Modules/SupportBot/App/Http/Controllers/CreditController.php:177` llama
`$this->solicitudes->find($userRequestId)`, y el repositorio expone **`findById()`** — no tiene `find()`.

**Por qué nada lo agarró:** ningún test del módulo ejercita las rutas `credits/*`. Hay un
`CreditChangeServiceTest` que prueba el SERVICIO directamente, así que la llamada del controlador nunca
se ejecutó. Los 27 tests en verde no cubrían este camino.

⚠ **DEFECTO 2 (menor) — la normalización del número es frágil.** `wa=573132804490` (indicativo SIN el
`+`) da 404 `CLIENT_NOT_FOUND`, mientras `3132804490`, `+573132804490` y `whatsapp:+573132804490` dan
200. Twilio siempre manda el `+`, así que en producción no dispara — pero cualquier otro cliente HTTP
que arme el número a mano se come un «cliente no encontrado» que en realidad es un error de formato.

**Lo que queda por probar:** el recorrido del ASESOR (`advisor/otp` → `clients` → `change-requests/*`).
No se hizo en esta vuelta porque hace falta un usuario con perfil de asesor y comercios asignados.

### 2026-08-20 (4) — ✅ el canal responde en dev: bloqueo de infra cerrado

Se agregó `SUPPORT_BOT_TOKEN` al secreto de la cuenta **correcta** (la que corre el servicio que atiende
dev, no la 697767917359) y se redesplegó. A las **11:24:36** el canal pasó de 503 a 422.

Validación completa contra el gateway público `api.dev.creditop.com/legacy-api/support/*`:

| prueba | resultado | qué prueba |
|---|---|---|
| sin `Authorization` | 401 `UNAUTHORIZED` | la guarda quedó VIVA, no abierta |
| token inválido | 401 `UNAUTHORIZED` | compara de verdad |
| token correcto | 422 `VALIDATION_FAILED` | pasa al controlador |
| `self/by-phone?wa=573000000000` | 404 `CLIENT_NOT_FOUND` | llega hasta la BD |
| `clients` sin sesión | 409 `SESSION_NOT_FOUND` | la ruta del asesor exige OTP verificado, como se diseñó |
| ruta inexistente | 404 del gateway | control |

Las pruebas se hicieron con datos **inexistentes** a propósito: `wa=573000000000`, `document=0000000000`.
Ejercitan toda la cadena sin consultar los datos de ninguna persona real. Lo que falta —el flujo con un
cliente de verdad— arranca en `POST /self/otp`, que **manda un WhatsApp**: se acuerda antes con quién.

### 2026-08-20 (3) — CORRECCIÓN: la medición de (2) era de la cuenta equivocada

La entrada anterior está mal y se deja para que no se repita el error. Medí la task definition
`legacy-backend-develop:199` con las credenciales de la cuenta **697767917359** y concluí «falta aplicar
Terraform». Dos pruebas de que ese NO es el servicio que atiende dev:

- la imagen de esa revisión es `5b3c9f1` (2026-08-03) y tiene **cero** archivos de `Modules/SupportBot`,
  así que no podría devolver `CHANNEL_NOT_CONFIGURED`, que es un mensaje de ese middleware;
- las IPs no coinciden: esa tarea está en `10.0.37.188` y quien responde el 503 está en
  `172.32.72.196`. VPC distintas.

**Dónde vive el real:** el ALB interno de dev enruta `legacy-backend.develop.internal.creditop.com` a un
target group de la cuenta **`299276669008`** (`environments/dev/internal-alb/terragrunt.hcl`). Dani
mostró ese servicio: misma familia `legacy-backend-develop` pero **revisión 612**, con 2 tareas — que
coincide con el `desired_count = 2` de la config, mientras el de 697…359 corría 1. Son dos despliegues
distintos con el MISMO nombre de familia, y eso es lo que hizo fácil confundirse.

> **MEDICIÓN · 2026-08-20** — con la revisión 612 ya desplegada, el canal sigue en 503
> `CHANNEL_NOT_CONFIGURED`. El middleware devuelve 503 sólo cuando el token esperado está VACÍO (un
> token que no coincide da 401), así que la variable no está llegando al contenedor nuevo.
> `curl -s -o /dev/null -w '%{http_code}' https://api.dev.creditop.com/legacy-api/support/clients -H "Authorization: Bearer <token>"`

**La hipótesis que queda** (no verificada: no hay acceso a `299276669008` desde acá): la clave se agregó
al secreto `dev/legacy-backend` de la cuenta **697767917359**, y el servicio que atiende lee el
`dev/legacy-backend` de **su propia** cuenta, donde la clave no está.

**Cómo se confirma en un comando**, desde la cuenta donde corre el servicio:

    aws ecs describe-task-definition --task-definition legacy-backend-develop:612 \
      --query 'taskDefinition.containerDefinitions[].secrets[?name==`SUPPORT_BOT_TOKEN`]'

Vacío = la clave no está en el secreto de esa cuenta (o Terraform se aplicó antes de agregarla).

### 2026-08-20 (2) — ⚠ MEDICIÓN INVÁLIDA (ver la entrada de arriba): la causa del 503: la task definition, no el secreto

Miguel había agregado `SUPPORT_BOT_TOKEN` al secreto `dev/legacy-backend` en la consola de AWS, así que
el 503 no cerraba. Midiendo contra AWS: el secreto tiene **164 claves** y la task definition en uso
(`legacy-backend-develop:199`, del 2026-08-05) enumera **163** — falta exactamente la que se agregó.

El módulo de Terraform sí auto-enumera las claves del secreto, pero con un **data source en tiempo de
plan**: agregar la clave en la consola no cambia nada hasta que se aplique. El servicio además sigue
corriendo la revisión 199, o sea que tampoco se redesplegó.

Se descartaron dos causas alternativas antes de pedir el apply, para no perder otra vuelta: el servicio
**sí** declara `secret = "dev/legacy-backend"` (cableado correcto), y **no** hay `config:cache` en el
build ni en el arranque (`Dockerfile`, workflows y `bootstrap/cache/` revisados) — así que después del
apply no hay una segunda pared.

### 2026-08-20 — validación contra dev: el gateway está, la variable no

Se retomó el bloqueo de infra pegándole al ambiente de dev con el token que pasó infra. Resultado: el
API Gateway ya expone las 16 rutas (bloqueo #2, hecho) y el módulo está desplegado, pero
`SUPPORT_BOT_TOKEN` sigue vacío en el backend, así que todo da 503 (bloqueo #1, abierto). Camino
recorrido, por si hay que rehacerlo:

- El nombre real del módulo es `Modules/SupportBot`, no `SupportAgent` como decía la tarea.
- Loki NO sirve acá: `legacy-backend` no empuja ninguna línea al stack de dev (deuda conocida del canal
  de logs). El diagnóstico salió del código de infra, no de los logs.
- La pista fue el repo `infrastructure`: la rama `feat/CORE-258-rutas-support-bot-dev` (commit `67df336`,
  PR #65) expone las rutas. En el merge a `develop` alguien corrigió el host destino de
  `legacy-api.develop…` a `legacy-backend.develop.internal.creditop.com`.
- El gateway enumera las 16 (cero comodines) y no reenvía `x-user-id` → eso cierra la pregunta de
  seguridad para estas rutas.

## Tarea (publicable)

> **Estado al 2026-08-14 — primer tramo en revisión.** Está construida la base del canal: el módulo
> donde vive, el registro de auditoría que antes no existía, la autenticación del bot y el primer
> paso del flujo del cliente (reconocer de quién es el número de WhatsApp desde el que escribe). Se
> unificó además el código de cambio de condiciones, que estaba duplicado, y se verificó midiendo que
> ese cambio no altera el comportamiento actual. Las tablas nuevas ya están creadas en el ambiente de
> pruebas.
>
> Se sumó además el segundo factor: el cliente recibe un código de un solo uso por un canal distinto
> al de la conversación y prueba su identidad antes de poder hacer nada. La sesión que lo sostiene
> vive en el backend, no en la capa conversacional, para que reiniciarla no regale intentos.
>
> Para cerrar la autogestión faltan cinco servicios de consulta y cambio del crédito, que ya tienen
> sobre qué apoyarse. Del lado de la capa conversacional, falta el canal de entrada de WhatsApp.

Hoy un asesor puede modificar los datos de un cliente sin que el cliente se entere: el cambio no
requiere su autorización y no queda registro de quién lo hizo ni de qué valor había antes. Se están
reportando casos de gestión indebida.

Además, un cliente que sólo quiere mover su fecha de pago o cambiar el plazo de su crédito hoy
depende de que un asesor se lo gestione, aunque sea una operación que puede resolver él mismo.

**Objetivo.** Que ningún cambio sobre los datos de un cliente se aplique sin que el propio cliente lo
autorice, que todo cambio quede registrado, y que el cliente pueda gestionar por su cuenta lo que le
corresponde.

Se resuelve con un canal de atención por WhatsApp con **dos entradas**.

**1 · El asesor gestiona, el cliente autoriza.** Para cambios de datos de contacto y de condiciones
del crédito.

- El asesor se identifica con su documento y un código de un solo uso que llega al celular registrado
  en su perfil, no al que escribe.
- Sólo ve clientes de los comercios que maneja. Un cliente que no le corresponde responde exactamente
  igual que un cliente inexistente.
- Los datos personales se muestran parcialmente ocultos durante toda la conversación.
- Al pedir un cambio, el cliente lo recibe en su canal actual — nunca en el nuevo — y debe
  autorizarlo. Puede indicar que no lo reconoce, y eso bloquea el cambio y lo escala a soporte.
- Ningún cambio se aplica hasta que el cliente confirma.

**2 · El cliente se autogestiona.** Sólo fecha de pago y plazo; los datos de contacto siguen
necesitando a un asesor.

- Escribe con sus palabras y el canal lo lleva a la operación que corresponde.
- Se identifica con su documento y un código de un solo uso enviado al celular registrado en su
  crédito, que debe ser el mismo desde el que escribe.
- Elige entre las opciones que su crédito admite y confirma.

**Común a las dos.**

- Los cambios sobre las condiciones del crédito exigen un código de un solo uso, enviado por un canal
  distinto al de la conversación.
- Cada solicitud queda registrada con quién la pidió, el valor anterior, el nuevo y el desenlace —
  incluidos los rechazos, que son los que permiten detectar un patrón.
- Las reglas de elegibilidad que ya existen para los cambios de crédito se siguen respetando y no
  pueden saltarse desde el canal.

**Entregable técnico:** 16 servicios, todos publicados bajo la misma entrada del canal y con la misma
autenticación. Once son nuevos; cinco reutilizan lógica de cambio de condiciones que ya existe y está
probada, pero se sirven por el canal y no por su acceso actual — así la autorización la decide el
backend y no quien llama, y se puede exigir el código de un solo uso sin afectar a la aplicación móvil
que hoy usa esos servicios.

**Orden sugerido de entrega.** Conviene empezar por la autogestión del cliente y no por el flujo del
asesor, por una razón que no es de esfuerzo: el flujo del asesor interrumpe al cliente, y WhatsApp
exige que el primer mensaje de una conversación no iniciada por el usuario sea una plantilla aprobada
por Meta, cuya aprobación toma días. En la autogestión el cliente escribe primero, así que no depende
de esa aprobación. La autogestión son siete servicios; el flujo del asesor, ocho más.

**Para desplegar hace falta**, además del código: una variable de entorno con la credencial del canal
(distinta por ambiente; sin ella el canal queda cerrado a propósito), publicar la entrada del canal en
el API Gateway —una sola vez, cubre los 16—, y correr las migraciones en cada ambiente. En el ambiente
de pruebas ya están corridas.

**Pendiente de definición:** el tratamiento de clientes eliminados (requiere Legal), los límites de
reenvío de códigos, quién envía el mensaje de confirmación posterior al cambio, y de qué lado se monta
el canal de entrada de WhatsApp.

Se construyeron dos simulaciones navegables —una por entrada— para acordar el detalle antes de
implementar.
