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

- En `users` está **vacío**: `allied_branch_id` poblado en **1 de 223.915** clientes. Inservible.
- En `user_requests` está **completo**: `allied_branch_id` en **359.790 de 359.823** solicitudes.
- El asesor cuelga de sucursales por `allied_branches_by_user` (**430** filas). Ojo con el nombre:
  la tabla es `allied_branches_by_user`, singular, aunque el modelo se llame `AlliedBranchesByUser`.

Entonces **"mis clientes" = clientes con al menos una solicitud en una sucursal del asesor**, y hay
que resolverlo por la solicitud, nunca por el usuario.

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
2. **El OTP del cliente sale por SMS, no por WhatsApp.** Si el código viaja por el mismo canal donde
   ocurre la conversación, quien ya tomó ese teléfono lo lee y deja de ser segundo factor.
   `messaging-service` ya manda SMS por LabsMobile — es el mismo `POST /api/v1/messages/send`
   cambiando el canal. Lo natural al implementar es mandarlo por el mismo chat: **no hacerlo**.
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

- **Arquitectura del canal** — n8n vs API directa vs microservicio Go propio. Ver la sección de
  abajo; falta decidir.
- **Cómo se autentica el canal contra el backend.** Hoy las rutas usan `auth.cognito`, que es de
  usuario, no de máquina. Sin definir.
- **¿Un check del cliente o dos?** El prototipo hace dos (autoriza la gestión, después aprueba el
  cambio). Es más seguro y es lo que se pidió, pero es fricción. Se puede colapsar a uno.
- **Alcance de "sus clientes"**: ¿todas las solicitudes históricas de las sucursales del asesor, o
  sólo las que él gestionó? La segunda es más estricta pero `user_requests.corporate_user_id` está
  sin auditar — hay que mirarlo antes de prometerlo.
- **Qué pasa con los 63 que hoy editan sin filtro.** Aplicar el filtro los va a romper. ¿Se migra
  gradual, se exceptúa a Administrador, se avisa?
- **Rate limit y timeout**: 3 reenvíos de OTP, cooldown de 5 min, sesión de 10 min. Hoy sólo existe
  `OtpService::canSendOtp($user, $cooldownMinutes = 2)` en legacy, y el `otp-service` real de
  producción **no está clonado** — no se pudo verificar qué límites tiene.
- **Clientes eliminados** (derecho al olvido / fraude): responder idéntico a "no encontrado".
  Requiere definición de Legal/Compliance sobre qué categorías aplican.

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
