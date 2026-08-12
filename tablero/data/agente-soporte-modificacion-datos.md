---
id: 46
title: "Agente Soporte — modificación de datos con autorización del cliente por WhatsApp"
stage: evaluation
created: "2026-08-11T18:20:00-05:00"
context_nodes: [actors, application, microservicios, servicing, backoffice]
jira: [CORE-258]
jira_title: "AGENTE SOPORTE- Modificacion de datos"
---

# Agente Soporte · modificación de datos

> **CORE-258** · `⏳ Por Hacer` · **5 pts** · nació en **Sprint 8** y se arrastró sin terminar
> · en aterrizaje, sin rama todavía
>
> Los 9 criterios de aceptación de Jira están completos allá (4.406 caracteres). Acá no se repiten:
> abajo está lo que se averiguó del sistema y lo que se decidió, que es lo que Jira no tiene.

Un asesor no debería poder cambiar los datos de un cliente sin que el cliente se entere y lo apruebe.
Hoy puede. La tarea pone al **dueño del dato** en el medio: el asesor pide el cambio desde WhatsApp,
el cliente lo autoriza desde el suyo, y nada se escribe hasta que hay consentimiento.

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
| plazos ofrecidos | `fee_numbers` de la línea de crédito, filtrado a `> cuotas pagadas` y `≤ max_fee_number` de la categoría (`simulatePossibleFees`) |

⚠ Las rutas del lado **Customer** salen con
`withoutMiddleware(['onlyMobileValidation','validate.authorized.status'])`. Revisar qué las protege
antes de exponerlas a un canal nuevo.

## El prototipo

`playground/sim-soporte/agente-soporte-simulacion.html` — dos ventanas estilo WhatsApp (asesor ·
cliente) con el flujo completo, las 4 opciones, las dos salidas de rechazo y un toggle para ver el
bloqueo por regla de negocio. Se levanta con la config `sim-soporte` de `.claude/launch.json` (:5299).

Trae dos paneles que son, en la práctica, **la especificación**: la traza de APIs (naranja = por
construir, verde = ya existe) y la fila de auditoría que quedaría.

**El prototipo no es el diseño final** — es para aterrizar la conversación. Revisar antes de codear.

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
3. **El aviso va siempre al dato ANTERIOR**, nunca sólo al nuevo. Es lo que permite detectar el
   cambio no autorizado.
4. **"No es tu cliente" y "no existe" responden idéntico.** Si difieren, el buscador se vuelve un
   oráculo de qué cédulas están en la base.
5. **Dos tablas, no una.** Contacto → tabla nueva (nombre propuesto: `user_data_change_requests`).
   Condiciones → `creditop_x_changes_log`, que ya existe, con el `otp_id` real.
   El nombre lleva `change_requests` y no `modifications` a propósito: la fila tiene que existir
   **antes** del cambio, porque es la que sostiene el estado mientras se espera al cliente
   (`pendiente_autorizacion → autorizada → aplicada | rechazada | bloqueada`). Un log guarda el
   desenlace; acá el registro **es** el flujo.

## Preguntas abiertas

- **Arquitectura del canal** — se descartó n8n (el flujo tiene estado y la seguridad quedaría
  repartida) y se inclina por **microservicio Go + Twilio**, que es lo que ya está configurado. Falta
  que Miguel lo cierre. Ver §«Arquitectura del canal» y §«Cómo funciona la API de WhatsApp».
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

## Deuda aparte (no es de esta tarea, pero se encontró acá)

`Admin/UserController@update` **resetea la contraseña del cliente a su número de documento** en cada
edición (`bcrypt($document_number)`). Cambiarle el correo a alguien le deja la clave en su cédula.
Es independiente del canal de WhatsApp y ya está en `main`. **Pendiente de registrar como finding**
en `context/server/data/flows/findings/doc.md` — Miguel lo decide.

## Arquitectura del canal — la decisión abierta

**n8n** llega antes a un piloto, pero el flujo tiene estado (sesión del asesor, ticket, espera del
cliente, timeout, rate limit) y una máquina de estados conversacional con dos actores se vuelve
frágil ahí. Peor: la lógica de seguridad quedaría repartida entre el workflow y el backend, que es
justo lo que no conviene con permisos.

**Microservicio Go** es coherente con la casa — `messaging-service`, `customer-service`,
`form-service`, `customer-profiling-service`, `financial-health-service` y `pdf-mapper-service` ya
son Go con hexagonal + OpenAPI-first, y comparten el repo privado `Creditop-SAS/platform`. Los
criterios de seguridad son código, no nodos.

**Lo que ninguna de las dos resuelve**: la escritura sigue viviendo en el MySQL de legacy, con sus
efectos colaterales (password, `ModelHasRoles`, `AlliedBranchesByUser`) y sus permisos Spatie.
Cualquier opción que escriba directo a la BD los duplica o los omite en silencio.

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

### ⚠ Ajuste pendiente en el prototipo: el menú no entra en botones

**En conversación abierta WhatsApp permite máximo 3 botones**; en plantilla aprobada, hasta 10. El
menú del asesor del prototipo tiene **4 opciones** (celular · correo · fecha de pago · plazo) y va
**en sesión**, no en plantilla. Dos salidas: **lista desplegable** (`twilio/list-picker`, hasta 10
opciones) o **dos niveles** («Datos de contacto» / «Condiciones del crédito»). Se inclina por la
lista: un solo paso y se lee mejor en el teléfono. **El HTML todavía muestra 4 botones.**

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

## Tarea (publicable)

Hoy un asesor puede modificar los datos de contacto de un cliente sin que el cliente se entere: el
cambio no requiere su autorización y no queda registro de quién lo hizo ni de qué valor había antes.
Se están reportando casos de gestión indebida.

Objetivo: que ningún cambio sobre los datos de un cliente se aplique sin que el propio cliente lo
autorice, y que todo cambio quede registrado.

Alcance propuesto — un canal de atención por WhatsApp donde:

- El asesor se identifica con su documento y un código de un solo uso enviado al celular registrado
  en su perfil.
- Sólo puede consultar y gestionar clientes que le corresponden. Un cliente que no le corresponde
  responde exactamente igual que un cliente inexistente.
- Los datos personales se muestran parcialmente ocultos durante toda la conversación.
- Al solicitar un cambio, el cliente recibe la solicitud en su canal actual — nunca en el nuevo — y
  debe autorizarla. Puede indicar que no la reconoce, lo que bloquea el cambio y lo escala a soporte.
- Los cambios sobre las condiciones del crédito (fecha de pago y plazo) exigen además un código de
  un solo uso escrito por el cliente, enviado por un canal distinto al de la conversación.
- Ningún cambio se aplica hasta completar la confirmación, y cada solicitud queda registrada con el
  asesor que la pidió, el valor anterior, el nuevo y el desenlace.
- Las reglas de elegibilidad que ya existen para los cambios de crédito se siguen respetando y no
  pueden saltarse desde el canal.

Pendiente de definición: la tecnología del canal, el mecanismo de autenticación entre el canal y los
servicios, el tratamiento de clientes eliminados (requiere Legal) y los límites de reenvío de códigos.

Se construyó una simulación navegable del flujo completo para acordar el detalle antes de
implementar.
