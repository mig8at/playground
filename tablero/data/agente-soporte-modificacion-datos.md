---
id: 46
title: "Agente Soporte — modificación de datos con autorización del cliente por WhatsApp"
stage: work
created: "2026-08-11T18:20:00-05:00"
context_nodes: [actors, application, microservicios, servicing, backoffice]
jira: [CORE-258]
jira_title: "AGENTE SOPORTE- Modificacion de datos"
---

# Agente Soporte · modificación de datos

> **CORE-258** · `⏳ Por Hacer` en Jira · **5 pts** · nació en **Sprint 8** y se arrastró sin terminar
> · **en progreso**: aterrizada y con los dos prototipos acordados, sin rama todavía
>
> Los 9 criterios de aceptación de Jira están completos allá (4.406 caracteres). Acá no se repiten:
> abajo está lo que se averiguó del sistema y lo que se decidió, que es lo que Jira no tiene.

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

## Los prototipos

Dos propuestas, cada una con su botón en el tablero: **`▶ asesor`** y **`▶ cliente`**.

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

### Ya existen y se usan tal cual — 3 ✅ **ejercitadas contra datos reales 2026-08-13**

Las tres del crédito, y sirven **igual para los dos actores**: no hay que tocarlas.

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

## Preguntas abiertas

- ~~**Arquitectura del canal**~~ — **decidido 2026-08-12: `Modules/SupportAgent` en legacy-backend**,
  con Twilio como proveedor y webhook oficial. Ver §«Arquitectura del canal».
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

**Lo ya verificado** contra la copia local:

- Las **3 APIs de consulta** responden correctamente (ver §«Las APIs a entregar»).
- **12 tests del módulo pasan** (`Modules/SupportBot/Tests`), en 2 segundos.
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

## Tarea (publicable)

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

**Entregable técnico:** 16 endpoints, de los cuales 11 son nuevos, 2 son existentes que se modifican
y 3 se usan tal cual.

**Pendiente de definición:** el tratamiento de clientes eliminados (requiere Legal) y los límites de
reenvío de códigos.

Se construyeron dos simulaciones navegables —una por entrada— para acordar el detalle antes de
implementar.
