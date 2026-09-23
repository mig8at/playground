---
id: 94
title: "Código de preaprobado de la app en la plataforma nueva"
ramas: feat/CORE-614-codigo-preaprobado-app, feat/CORE-614-codigo-app-solo-colombia
stage: work
created: "2026-09-21T16:40:00-05:00"
canon: [preaprobado, listado, onboarding, creditopx]
jira: [CORE-614]
jira_title: "Código de preaprobado de la app en la plataforma nueva"
---

## Si retomás esto sin contexto, empezá acá

Se busca llevar a **legacy-backend + frontend-monorepo** el flujo por el que un cliente que vio un
preaprobado en la app móvil llega al comercio con un **código**, lo entrega, y el listado de entidades
le muestra **sólo la entidad de ese preaprobado**.

Estado real: el flujo existe entero en **legacy-application** y está leído de punta a punta (pantalla,
orquestación y filtro del listado; rutas exactas abajo). La mitad de abajo —consultar y consumir el
código— **ya vive en legacy-backend** y legacy-application la llama por HTTP, así que eso NO se migra.
El reparto ya está aterrizado: **una** pieza de backend (el endpoint que crea la solicitud a partir del
código, porque el wizard no toca la base) y **tres** de frontend (pantalla, entrada y recorte del
listado). El filtro va sólo en el front.

Ya comprobado (no repetir): en prod esto **nunca pasó de una prueba** — 12 solicitudes, todas de abril
de 2026, todas de un comercio y todas paradas en el estado con que nacen. El emisor es
**self-manager-api**, y la app de producción (`main-pro`) ya lo consume desde abril: los dos extremos
SÍ se hablan. *(Hasta el 2026-09-23 esto decía que la app generaba el código en el dispositivo: se había
leído `main` de creditop_mobile, que no es la rama que sale a producción.)*

Validación: la receta y las consultas están en «Cómo se comprueba».

Las dos ramas están abiertas desde `qa`, con su PR en borrador (ver Referencias).

**Los pasos 2, 3, 4 y 5 del plan están hechos, en sus ramas y PROBADOS CORRIENDO**: el endpoint del
backend (con test y con un mock del servicio de códigos que antes no existía), la pantalla de captura,
la entrada visible y el recorte del listado. El recorrido entero —pantalla, código, listado con una
sola entidad— cierra en local con una sesión de asesor real, queda automatizado en harness y se vio
con capturas: el conmutador aparece en las dos pantallas. El bloqueo restante es el contrato del
emisor productivo, no una validación técnica pendiente.

**El próximo paso es:** que se mergee #1049 (Colombia) y que el `AA0000` de self-manager-api llegue de
su `develop` a `main` — hoy `main` todavía emite cuatro dígitos; el wizard acepta los dos. Después,
apagar el camino viejo en aliados.

## Pendientes

- [x] Confirmar quién emite el código — **self-manager-api**: persiste `user_id`, `merchant_id` y
      `lender_id`, vence el último día del mes y la app de producción ya lo llama (2026-09-23).
- [x] Confirmar el piloto — **no hay piloto**: tiene que servir para todos los comercios, y el wizard
      ya no tiene allowlist (sólo el corte de Colombia) (2026-09-23).
- [x] Decidir dónde filtra el listado — **va sólo en el front**, en el loader, antes de consultar
      preaprobados (2026-09-21).
- [x] Elegir cómo sabe el front que esta solicitud vino por código — sesión del wizard con
      `clientCodeLender:<user_request_id>`; el listado recorta sin preguntarle nada al cliente
      (2026-09-22).
- [x] Construir el endpoint que crea la solicitud desde el código — `POST
      /api/onboarding/client-code/redeem`, corriendo en local contra el mock (2026-09-22).
- [x] Construir la pantalla de captura en el wizard — `/merchant/:partner_hash/codigo`, con su
      entrada desde la pantalla del celular (2026-09-22).
- [x] Ver el recorrido completo con una sesión de asesor: pantalla → código → listado con UNA
      entidad. Corrido en local contra el backend nuevo (2026-09-22).
- [x] Mirar la pantalla — capturada con la sesión de asesor; de ahí salieron dos arreglos (2026-09-22).
- [x] Llevar el recorte de una sola entidad al listado — en el loader, antes de disparar las
      consultas de preaprobado (2026-09-22).
- [x] Ofrecer el código sólo en comercios de Colombia — conmutador oculto, pantalla del código con
      redirección y canje rechazado fuera de Colombia; PR aparte contra `qa` (2026-09-23).
- [x] Definir qué se hace cuando la entidad del código NO está en el listado — lo evita el emisor: la
      app sólo pide código para una entidad de un preaprobado de ESE comercio. Si igual pasa, el
      listado muestra todas, como hoy (2026-09-23).
- [ ] Apagar el camino viejo en aliados, recién con #1049 mergeado y el `AA0000` en `main` de
      self-manager-api.

## Objetivo

Cuando esto esté hecho:

- Un cliente con un preaprobado en la app llega al comercio, entrega su código, y desde el **wizard
  nuevo** —no desde aliados— se le crea la solicitud y se le muestra el listado.
- Ese listado trae **únicamente la entidad del preaprobado**.
- La consulta y el consumo del código siguen donde ya están, en legacy-backend; no se duplica esa parte.
- El código que muestra la app y el que acepta el receptor son **el mismo**, emitido por un solo lugar.

## Dónde se toca

**legacy-application** — lo que hay hoy; es el original que se lee, no se toca salvo para apagarlo al final:

- `routes/customer.php:126-127` — `GET /codigo-cliente/{allied_branch_hash?}` y
  `POST /codigo-cliente/confirmar-codigo`.
- `app/Http/Controllers/Customer/ClientCodeController.php` — el orquestador entero: valida el código
  (`digits:4`), consulta, **inserta a mano** en `user_requests` (estado 9, `credit_line_id` 1) y en
  `user_request_records` con el comentario `Solicitud creada desde validacion de codigo cliente.`,
  consume, y si el consumo falla **borra las dos filas**. Termina en
  `LoanFlow::markStarted()` y redirige a `customer.lenders.index-v2`.
- `app/Services/Api/GenerateServicesBridgeClient.php:17-18` — el puente: pega contra
  `LEGACY_BACKEND_BASE_URL` + `/api/onboarding/generate-services` con `/code/consult` y
  `/code/consumConfirm`.
- `app/Http/Controllers/Customer/ListLenderController.php:246` y `:301` — `filterClientCodeFlowLenders`:
  el filtro de una sola entidad.
- `resources/js/pages/customer/client-code/IndexCaptureApplication.vue` — la pantalla: cuatro casillas
  de un dígito, «Ingresa el código del cliente» / «Pide al cliente su código».
- `resources/js/pages/customer/onboarding/RegisterCellPhone.vue:145-150` — el conmutador
  «nuevo usuario / usuario de la app» que es por donde se entra.
- `app/Support/LoanFlow.php:36` — `client_code.flow` cuenta como evidencia de flujo iniciado.

**legacy-backend** — la mitad que ya está, más lo que falta:

- `Modules/Onboarding/routes/api.php:164-170` — el grupo `generate-services`, con `code`,
  `code/consult` y `code/consumConfirm`. **Esto ya existe y no se migra.**
- `Modules/Onboarding/App/Repositories/GenerateServiceRepository.php:15-19` — es un proxy al servicio
  generador (`CODE_GENERATION_SERVICE_BASE_URL`, `/api/v1/generate/code…`).
- `Modules/Onboarding/routes/api.php:52` — `lenders-v2/{user_request_id}` →
  `LenderListingController@index` → `Modules/Onboarding/App/Services/lenders/LenderListingService.php`.
  **Ahí NO hay filtro por código** — verificado; es lo que hay que agregar.
- `LenderListingService::stampCreditopXApproval` — el lugar donde el listado nuevo ya sabe de un
  preaprobado de la casa; conviene mirarlo antes de inventar otro camino.
- `Modules/Onboarding/App/Services/CorbetaUserRequestService.php:107` — `createOrReuseUserRequestId`:
  **el precedente exacto** de «el cliente llega con un código y se le crea la solicitud», hecho con
  Eloquent. Es el patrón a copiar para el endpoint nuevo.

**frontend-monorepo** — lo que hay que crear; hoy **no existe nada** de esto (búsqueda vacía):

- `apps/loan-request-wizard/app/routes.ts` — donde entraría la ruta de captura, al lado de `solicitar`.
- `app/utils/route-helpers.ts:4` — los tres flujos son `ecommerce | merchant | self-service`; la
  pantalla vieja la opera el asesor, así que esto es `merchant`.
- `app/routes/loan-application-form/phone-number.tsx:134` y `:181-189` — el selector de «Confirmación
  de cupo» y `flowSignatureChoice` en sesión: el precedente más cercano de marcar una variante de flujo.
- `app/routes/lenders-marketplace/available-lenders.tsx` — la pantalla del listado.
- `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/services/preapproval-gate.service.ts`
  — `partitionLendersForPreApproval`: acá se decide a qué entidades se les consulta el preaprobado, de
  a una. Es donde el recorte cuesta menos.

**creditop_mobile** — el otro extremo:

- `packages/feature_home/lib/presentation/pages/physical_store_info_page.dart:249-280` — arma la tarjeta
  y **genera el código en el dispositivo**.
- `app/lib/infrastructure/home/datasources/preapprovals_datasource.dart` — de dónde saca los
  preaprobados que muestra.

## Cómo se ataca

Son cambios en **los dos repos**, y el reparto es desparejo: **una** pieza de backend y **tres** de
frontend.

**legacy-backend — una pieza, y es la que no se puede evitar.** Un endpoint que reciba el código y el
comercio y devuelva la solicitud creada con su entidad. Es obligatorio porque el wizard **no toca la
base**: en el camino normal la solicitud nace cuando el backend valida el OTP, y acá no hay OTP que la
dispare. No arranca de cero — llama a `code/consult` y `code/consumConfirm`, que ya existen, y crea la
solicitud con el patrón de `CorbetaUserRequestService::createOrReuseUserRequestId` (Eloquent), **no**
con el INSERT crudo a dos tablas que hace aliados.

**frontend-monorepo — tres piezas, el grueso de lo que se ve.**

1. Ruta y pantalla de captura del código, en el flujo `merchant`.
2. La entrada visible: el «¿ya tenés la app?» en la pantalla donde hoy se pide el celular.
3. El recorte del listado a la entidad del código, en el loader.

**Nada que tocar** en el servicio generador, en la consulta y el consumo del código, ni en el listado
en sí.

Orden sugerido; cada paso se entrega solo:

1. **Cerrar el contrato del código** (no es código, y bloquea lo demás): quién lo emite, con qué
   formato y cuánto vive.
2. **El endpoint del backend**, probado contra un código sembrado. Es la pieza más aislada.
3. **La pantalla y su POST** en el front, que para entonces ya tiene a quién llamar.
4. **El recorte del listado.**
5. **La entrada visible.**
6. **Apagar el camino viejo** en aliados, recién cuando el nuevo esté probado.

## Lo que se evaluó y NO se eligió

**Migrar también la consulta y el consumo del código.** Era lo primero que parecía tocar, y no: el
puente de aliados apunta a `LEGACY_BACKEND_BASE_URL`, así que esa mitad **ya corre en legacy-backend**
desde antes. Migrarla sería moverla a donde ya está.

**Copiar el filtro tal cual, leyendo la sesión.** El filtro viejo se apoya en `session('client_code.flow')`,
que es sesión de Laravel; el wizard nuevo tiene la suya, del lado de su servidor. Copiar la forma no
sirve: hay que elegir por dónde viaja el dato, y por eso es una casilla pendiente y no un detalle de
implementación.

**Tratarlo como un port 1:1 de algo que funciona.** Se descartó por lo medido: doce solicitudes de
abril, ninguna avanzó, y el código de la app ni siquiera tiene el formato que el receptor acepta.

## Lo que está decidido

> **DECISIÓN · 2026-09-21** — la consulta y el consumo del código NO se migran: ya viven en
> legacy-backend (`generate-services`) y aliados sólo los llama por HTTP. La migración es de la
> pantalla, la creación de la solicitud y el filtro del listado.

> **DECISIÓN · 2026-09-21** — la pantalla de captura va en el flujo `merchant` del wizard: el texto de
> la pantalla vieja es «Pide al cliente su código», o sea la opera el asesor, no el cliente.

> **DECISIÓN · 2026-09-22** — la entrada al código es el **conmutador de dos opciones** de la
> aplicación anterior («Usuario nuevo» / «Usuario app»), arriba y en las dos pantallas — no un enlace
> al pie. El enlace estaba —en el HTML, con su href y su texto— y aun así no se veía: una entrada que
> hay que buscar es una entrada que nadie usa, y el camino queda construido sin que nadie entre por él.
> El segundo arreglo salió de la misma captura: la pantalla del código estaba centrada
> verticalmente, así que el conmutador saltaba ~250px al alternar.

> **DECISIÓN · 2026-09-23** — el código de la app se ofrece **sólo en comercios de Colombia**, y se
> resuelve en el front: el país ya llega en el tema del comercio (`country.isoCode`, ISO de tres letras
> = `COL`, que el backend llena con `iso_code_2`), así que no cuesta una llamada. Se compara el ISO y no
> el id 47 para no atar la regla a un número. Son tres puntos con UNA regla (`offersClientCode`): el
> conmutador, un loader nuevo en `/codigo` que redirige a la pantalla del celular, y el action del
> canje — esconder el botón solo no alcanzaba, la URL se escribe a mano. **Sin país conocido no se
> ofrece**: función de un país, perderla un momento cuesta menos que mostrarla donde no va.

> **DECISIÓN · 2026-09-21** — el filtro a una sola entidad va **sólo en el front**. Verificado: el
> loader del listado decide a qué entidades les pide el preaprobado, **una por una**
> (`partitionLendersForPreApproval`), así que recortar antes no paga las consultas de las demás. La
> contra, asumida a sabiendas: `lenders-v2` sigue devolviendo todas y evaluándolas del lado backend, así
> que «una sola entidad» es verdad en pantalla, no en la API.

## Lo que está bloqueado

> **HALLAZGO · 2026-09-23** — **el emisor es self-manager-api y la app ya lo consume.** En `main-pro`
> de creditop_mobile, `LenderCodeDataSource` hace `POST /self-manager-api/v1/generate/code` con
> `merchant_id` y `lender_id` (entró el 2026-04-08, TT-135: coincide con las doce solicitudes de abril).
> El `lender_id` es el `lendingProductId` del preaprobado, que es el `lenders.id` (pre-approvals-service
> lo usa así, incluida la reescritura de Welli 141/142 → 23). El servicio guarda el código con dueño,
> comercio y entidad, lo reusa mientras esté activo, vence el **último día del mes** en que se generó, y
> la consulta es por `merchant_id` + código: un código no sirve en otro comercio.
> ⚠ El formato `AA0000` está en `develop` del servicio; `main` todavía emite **cuatro dígitos**. El
> wizard acepta los dos desde `c0efac64`.
> ⚠ El servicio no valida que la entidad esté habilitada en el comercio: esa garantía la da la app,
> que sólo pide código para un preaprobado que mostró en ese comercio.

> **DECISIÓN · 2026-09-23 · Miguel** — no hay piloto: el camino tiene que servir para todos los
> comercios. Y el caso «la entidad del código no está en el listado» lo resuelve el emisor, no el
> wizard: se deja como está (se muestra el listado completo).

*(Las tres preguntas y el hallazgo de abajo quedaron contestados por lo de arriba; se dejan como
historia de cómo se llegó.)*

> **PREGUNTA · 2026-09-21 · quien pidió la migración** — ¿quién emite el código que el cliente
> presenta? La app lo genera en el dispositivo y no llama a ningún servicio de códigos; el receptor
> espera cuatro dígitos y la app muestra once caracteres. Hoy no hay un emisor que una los dos lados.

> **HALLAZGO · 2026-09-22** — no falta unir dos identidades: `POST /v1/preapprovals/me/check` toma
> `X-User-Id` de la app y lo entrega como `applicant_id`; en legacy-backend ese valor es el mismo
> `users.id` que el servicio de códigos devuelve como `user_id`. Lo que falta es sólo el registro
> persistente del código y su resolución a lender.

> **HALLAZGO · 2026-09-22** — `POST /api/onboarding/generate-services/code` no emite el código:
> exige que ya lleguen `code`, `user_id`, `commerce_id`, `entity_id`, estado y fechas, y sólo devuelve
> texto. El servicio que sí consulta/consume cuatro dígitos no está entre los repos disponibles.

> **MEDICIÓN · 2026-09-22** — Pullman (aliado 94) sólo tiene configurado CrediPullman (lender 77).
> La app de ejemplo anuncia `creditop_x` con id de producto 80: el emisor debe resolver el lender desde
> configuración autoritativa, no copiar el id que pinta el móvil.
> **DB · prod**
>
> ```sql
> SELECT lba.allied_id, lba.lender_id, l.name AS lender FROM lenders_by_allieds lba JOIN lenders l ON l.id = lba.lender_id WHERE l.name LIKE "%Pullman%" ORDER BY lba.allied_id, lba.lender_id
> ```

> **HALLAZGO · 2026-09-22** — no hay un allowlist de comercios en el wizard: la entrada `codigo` está
> bajo todo `/merchant/:partner_hash`, así que se ofrece a cualquier punto de venta de asesor. Pero el
> canje consulta el código con el `merchant_id` que sale de esa sucursal: un código no es portátil entre
> comercios. En términos de rollout, la pantalla es general; el camino útil sólo existe donde el
> emisor haya persistido ese comercio y un `lender_id` que el punto de venta pueda ofrecer.

> **PREGUNTA · 2026-09-21 · quien pidió la migración** — ¿la entidad objetivo es Credipullman? En
> producción las únicas doce solicitudes por este camino son de otro comercio y otras dos entidades.

> **PREGUNTA · 2026-09-21 · quien pidió la migración** — cuando la entidad del código no aparece en el
> listado del comercio, ¿se muestra todo o se avisa? Hoy se muestra todo, en silencio.

## Riesgos

> **RIESGO · 2026-09-21** — el filtro viejo, si la entidad del código no está en el listado, devuelve
> **la lista completa** y sólo deja un log. Copiado tal cual, un cliente que viene por un preaprobado
> vería el listado normal y nadie se enteraría: parece que funciona.

> **RIESGO · 2026-09-21** — el flujo viejo crea la solicitud **insertando a mano** en dos tablas, sin
> pasar por el camino normal de creación. Repetir eso en el backend nuevo salta las reglas que hoy
> corren al nacer una solicitud; si se reusa el camino normal, hay que verificar que tolere no tener OTP.

> **RIESGO · 2026-09-22** — **en el equipo le dicen «OTP» a este código.** El título original de
> CORE-614 era «Flujo de otp app para refactor» y su descripción hablaba del «otp generado para el
> comercio». Pero el flujo entra SIN el OTP de verificación de celular, así que las dos cosas se
> llaman igual y son distintas: el código del preaprobado y el código de seis dígitos que valida el
> teléfono. Cualquier texto que diga «sin OTP» necesita decir de cuál habla, o alguien va a leer lo
> contrario de lo que dice.

> **RIESGO · 2026-09-21** — el flujo entra sin OTP. En aliados eso se resuelve con una marca de sesión;
> en el wizard hay que darle un equivalente, o la solicitud queda accesible sin que nadie haya probado
> ser su dueño.

## Lo que NO entra

- La emisión del código: la hace self-manager-api y la app ya lo llama; es contraparte, no esta tarea.
- Cambiar lo que la app muestra hoy.
- Tocar la consulta de preaprobados de la app.
- Reescribir el listado de entidades: se le agrega un filtro, no se rehace.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Última comprobación: **2026-09-21**.

**Qué tanto se usa el camino viejo** (la marca es el comentario con que nace la solicitud):

> **MEDICIÓN · 2026-09-21** — 12 solicitudes en total, todas en abril de 2026 y ninguna después.
> **DB · prod**
>
> ```sql
> SELECT date_format(created_at,"%Y-%m") AS mes, count(*) AS solicitudes FROM user_request_records WHERE comment = "Solicitud creada desde validacion de codigo cliente." GROUP BY 1 ORDER BY 1
> ```

> **MEDICIÓN · 2026-09-21** — las 12 son de un solo comercio (Celucambio), repartidas entre Celupresto
> (8) y Crediteame CC (4), y **las 12 siguen en el estado 9**, que es con el que nacen: ninguna avanzó.
> **DB · prod**
>
> ```sql
> SELECT a.name AS comercio, l.name AS entidad, ur.user_request_status_id AS estado, count(*) AS n, max(ur.created_at) AS ultima FROM user_request_records urr JOIN user_requests ur ON ur.id = urr.user_request_id LEFT JOIN allieds a ON a.id = ur.allied_id LEFT JOIN lenders l ON l.id = ur.lender_id WHERE urr.comment = "Solicitud creada desde validacion de codigo cliente." GROUP BY 1,2,3 ORDER BY n DESC
> ```

**Que la app le pide el código a self-manager-api** — ⚠ en `main-pro`, la rama de producción de la
app; `main` todavía tiene el generador local y por eso se concluyó al revés:

    git -C ~/Desktop/CREDITOP/github/creditop_mobile grep -n 'generate/code' origin/main-pro -- '*.dart'
    git -C ~/Desktop/CREDITOP/github/self-manager-api show origin/develop:internal/core/domain/code.go   # AA0000, vence fin de mes
    git -C ~/Desktop/CREDITOP/github/self-manager-api grep -n plainCodeLength origin/main                 # main: 4 dígitos

**Que el filtro no existe todavía en el listado nuevo:**

    git -C ~/Desktop/CREDITOP/github/legacy-backend grep -n 'client_code' origin/main -- Modules/Onboarding   # vacío
    git -C ~/Desktop/CREDITOP/github/frontend-monorepo grep -rni 'client-code' origin/main                     # vacío

**Correr el endpoint nuevo de punta a punta, en local.** El servicio de códigos es externo y en
local no existe, así que hay un mock que lo reemplaza. Cuatro pasos:

    make harness-codes                          # el mock, en :8111 (deja la terminal ocupada)
    # en el .env de legacy-backend, una sola vez:
    #   CODE_GENERATION_SERVICE_BASE_URL=http://host.docker.internal:8111
    docker exec legacy-backend-laravel.test-1 php artisan config:clear

    # sembrar un código: el user_id tiene que ser un usuario REAL de la base local con celular y
    # correo (el proxy lo verifica contra la BD), y el lender uno habilitado en esa sucursal
    curl -s -XPOST http://127.0.0.1:8111/_control/sembrar -H 'Content-Type: application/json' \
      -d '{"code":"4821","user_id":1830684,"lender_id":24,"merchant_id":26}'

    curl -s -XPOST http://localhost/api/onboarding/client-code/redeem -H 'Content-Type: application/json' \
      -d '{"code":"4821","partner_branch_hash":"76db47f5","amount":1500000}'

**La prueba reproducible desde la interfaz** (requiere que `harness-codes` siga arriba y una sesión
de asesor viva) no necesita armar el JSON a mano:

    make harness-codigo COMERCIO=13874eb6 CODIGO=0102
    make harness-codigo-prueba HASH=13874eb6 CODIGO=0102 LENDER='Sistecrédito'

El primer comando elige un usuario local real y una entidad habilitada para la sucursal; el segundo
abre `/merchant/<hash>/codigo`, redime por la UI y exige que el marketplace muestre **sólo** esa entidad.
Para otro comercio, se reemplazan los tres argumentos por los que imprima `make harness-codigo`.

⚠ El mock arrancaba en :8110 y hubo que moverlo a :8111 porque el 8110 ya estaba ocupado por otro
proceso de la máquina. Si el puerto cambia, cambia en los dos lados (mock y `.env` del backend).

**El test del servicio**, con ruta explícita, nunca la suite entera:

    php vendor/bin/phpunit Modules/Onboarding/tests/Unit/ClientCodeRedemptionServiceTest.php

**Recorrer el flujo COMPLETO con sesión de asesor** (es lo que prueba el recorte, y necesita el
login real de Cognito):

    cd harness && CFE_TARGET=local CFE_FRONT=local bin/asesor sonria   # loguea y levanta el wizard en :5174

Eso deja la sesión en `harness/.auth/cognito-state.dev.json`. Con sus cookies de `localhost`:

    # 1 · la pantalla responde
    curl -s -o /dev/null -w '%{http_code}\n' -b <cookies> http://localhost:5174/merchant/76db47f5/codigo
    # 2 · redimir: devuelve 302 a .../<id>/lenders y la cookie __session con clientCodeLender:<id>
    curl -s -D- -o /dev/null -XPOST http://localhost:5174/merchant/76db47f5/codigo -b jar -c jar \
      -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode 'code=6060'
    # 3 · el listado, CON la cookie del funnel y sin ella: una entidad contra ocho

⚠ El `_at` de la sesión dura ~24 h: si la pantalla responde 302 al login, la sesión venció y hay que
volver a correr `bin/asesor`.

**Que el código sólo se ofrece en Colombia** (2026-09-23). ⚠ El asesor manda sobre la sucursal: para
probar otro comercio hay que reasignarlo (`E2E_TARGET=local node bin/dbops.ts assign <sub> <slug>
<hash> <sub>`), **esperar 60 s** —el wizard cachea el perfil del asesor (`USER_DATA_CACHE_TTL_MS`) y
mientras tanto sigue redirigiendo a la sucursal vieja— y devolverlo a Motai (`f0548728`) al terminar.
Con la sesión de asesor, contra el wizard de la rama:

    curl -s -o page.html -w '%{http_code} %{redirect_url}' -H "Cookie: <_session;_at;_rt>" http://localhost:5174/merchant/<hash>/solicitar
    grep -c 'Usuario app' page.html          # 1 en Colombia · 0 fuera
    curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Cookie: …" http://localhost:5174/merchant/<hash>/codigo

⚠ La pantalla del código pasó a **seis casillas** (`c0efac64`, formato `AA0000`) y el autorrelleno del
harness escribe su `0101` repetido hasta llenarlas: queda `010101`, que no es válido, y el botón nunca
se habilita. Por eso `harness-codigo-prueba` corre con `E2E_AUTORELLENO=0`.

> **MEDICIÓN · 2026-09-23** — Perú (`50e007e4`, comercio de pruebas, país 167 completo: `PER` · `+51` ·
> `PEN`): la pantalla del celular responde **200** con el prefijo `+51` y **sin** «Usuario app»; `/codigo`
> responde **302** a `/merchant/50e007e4/solicitar`; el POST directo del código contesta «Este punto de
> venta no recibe códigos de la app» y no canjea. Colombia (Motai, `f0548728`): las dos pantallas **200**
> y con el conmutador. Contra el wizard de `feat/CORE-614-codigo-app-solo-colombia`.
> `curl -H "Cookie: …" http://localhost:5184/merchant/50e007e4/codigo` · TARGET=local

> **MEDICIÓN · 2026-09-23** — con el cambio puesto, el canje sigue andando en Colombia: `0923` en Motai
> crea la solicitud local **466900** y el listado queda con **una sola** entidad, Credifamilia-addi.
> `make harness-codigo COMERCIO=f0548728 CODIGO=0923 && make harness-codigo-prueba HASH=f0548728 CODIGO=0923 LENDER='Credifamilia-addi'` · TARGET=local

**El listado de un comercio, para ver contra qué se compara el filtro:**

    make harness-listado COMERCIO=<slug>

> **MEDICIÓN · 2026-09-22** — el endpoint nuevo cierra en local: el código sembrado deja la
> solicitud **466885** creada con el lender del código (24), estado 9, monto 1.500.000, su traza
> escrita, y el código marcado como usado en el servicio de códigos. Un segundo intento con el mismo
> código responde **409** y no crea nada.
> `curl -s -XPOST http://localhost/api/onboarding/client-code/redeem -d '{"code":"4821","partner_branch_hash":"76db47f5","amount":1500000}' -H 'Content-Type: application/json'` · TARGET=local

> **MEDICIÓN · 2026-09-22** — el listado de esa solicitud devuelve **9 entidades**, y la del código
> (24, Credifamilia) está entre ellas. Confirma lo decidido: la API no recorta, y el front tiene el
> dato para hacerlo.
> `curl -s http://localhost/api/onboarding/loan-application/lenders-v2/466885` · TARGET=local

> **MEDICIÓN · 2026-09-22** — **el recorrido cierra entero en local, con sesión de asesor real.** Con
> la sesión que deja `bin/asesor sonria` (`CFE_TARGET=local CFE_FRONT=local`): la pantalla del código
> responde **200**; el POST del código redime y redirige a `/merchant/76db47f5/466889/lenders`
> dejando en la cookie del funnel `{"clientCodeLender:466889":24}`; y ese listado **nombra sólo a
> Credifamilia**. La misma solicitud pedida **sin** esa cookie nombra **las ocho** entidades del
> comercio. O sea: el recorte es lo que hace la diferencia, y sin él la solicitud ve el listado
> completo. (El conteo es por nombres en el HTML, que alcanza para distinguir una de ocho.)

> **MEDICIÓN · 2026-09-22** — la prueba automatizada del harness redimió `0102` en Amoblando Pullman
> (`13874eb6`) y creó la solicitud local **466893**. La UI redirigió a
> `/merchant/13874eb6/466893/lenders` y el único lender visible fue **Sistecrédito**. Cubre pantalla,
> action del wizard, endpoint, consumo del mock y el recorte por cookie del funnel.
> `make harness-codigo-prueba HASH=13874eb6 CODIGO=0102 LENDER='Sistecrédito'` · TARGET=local

> **MEDICIÓN · 2026-09-22** — la ruta de la pantalla quedó montada en el árbol del asesor y no en el
> público. Se comprueba comparándola con una ruta viva y con una inexistente: `/merchant/<hash>/codigo`
> y `/merchant/<hash>/solicitar` responden **302** al login, y `/merchant/<hash>/no-existe-xyz`
> responde **404**. Puesta sólo en el árbol público **no daba 404**: React Router la resolvía en el
> vecino, que es como se cuela una pantalla que parece andar y no es la que se pidió.

> **MEDICIÓN · 2026-09-22** — el recorte del listado no empeora el lint que el repo ya tolera: el
> `.then` del loader tiene complejidad **36** en `qa`, subió a **41** con el bloque escrito adentro, y
> vuelve a **36** con el recorte en su propia función.

> **MEDICIÓN · 2026-09-22** — los caminos de error responden como deben, sin crear solicitudes:
> código que no es de 4 dígitos → 422 · sucursal desconocida → 404 · servicio de códigos caído o sin
> configurar → se propaga su error tal cual, con el endpoint upstream adentro.

## Referencias

- Temas de canon: `preaprobado`, `listado`, `onboarding`, `creditopx` (van en el frontmatter).
  `fronteras` ayuda para la parte de rutas internas entre módulos.
- Canon **no cubre** el código de cliente: la búsqueda por API no devuelve ninguna sección de este
  flujo. Si algo de acá queda en firme, es candidato a graduar.
- El precedente más cercano en el wizard nuevo es «Confirmación de cupo» (`flowSignatureChoice`), que
  marca una variante de flujo en la sesión del wizard.
- Jira: [CORE-614](https://creditop.atlassian.net/browse/CORE-614), creada por Laura Cabra. Su título
  y su descripción son hoy los de esta tarea; **el texto original era**: «Flujo de otp app para
  refactor — Cuando un cliente llega con su otp generado para el comercio, en el front deberia de
  existir la pantalla para redimirlo». CORE-627, que se había creado acá antes de saber que ya existía
  la de Laura, quedó **❌ Invalidada** con un comentario que apunta a esta.
- PRs, los dos en borrador y contra `qa`, rama `feat/CORE-614-codigo-preaprobado-app`:
  [legacy-backend#1455](https://github.com/Creditop-SAS/legacy-backend/pull/1455) ·
  [frontend-monorepo#1045](https://github.com/Creditop-SAS/frontend-monorepo/pull/1045).
  Mergeado ese, la restricción a Colombia va aparte, rama `feat/CORE-614-codigo-app-solo-colombia`:
  [frontend-monorepo#1049](https://github.com/Creditop-SAS/frontend-monorepo/pull/1049), contra `qa`.
  (Los primeros —#1450 y #1043— quedaron cerrados: renombrar la rama de CORE-627 a CORE-614 **cerró
  los PRs en vez de moverlos**. Cada uno tiene un comentario apuntando al que lo continúa.)

## Registro

### 2026-09-23 · el contrato del código
Miguel contestó las tres preguntas abiertas: el emisor es self-manager-api, no hay piloto (sirve para
todos los comercios) y el caso de la entidad fuera del listado lo evita el emisor. Se verificó contra el
código antes de escribirlo, y eso corrigió un error de la tarea: la app no genera el código en el
teléfono, lo pide al servicio desde abril. Se había leído la rama equivocada de la app. Queda un solo
desfasaje: el formato nuevo del código está en la rama de desarrollo del servicio y no en producción.

### 2026-09-23
Se pidió que la entrada del código de la app aparezca sólo en Colombia. Se resolvió en el front, sin
tocar el backend: el tema del comercio ya traía el país, así que una sola regla decide el conmutador, la
pantalla del código (que ahora redirige fuera de Colombia) y el canje. Se abrió un PR nuevo desde `qa`
al día, porque el anterior ya estaba mergeado. Se probó corriendo en local contra un comercio de Perú y
contra Motai: afuera no aparece ni se deja entrar por URL, y adentro el canje sigue dejando una sola
entidad. Construyendo apareció que la prueba automatizada del canje había quedado rota desde que la
pantalla pasó a seis casillas: el autorrelleno las llenaba con un código inválido. Se apagó el
autorrelleno en esa prueba.

### 2026-09-22
Se retomó CORE-614 desde Jira y los repos. La tarjeta sigue en progreso, sin comentarios ni criterios
nuevos; Laura Cabra es la informadora. Se comprobó que el identificador autenticado que recibe el
microservicio de preaprobados es el `users.id` legado, así que la app puede emitir un código canjeable
sin construir un puente de identidad. No se implementó Flutter porque hacerlo hoy seguiría produciendo
códigos que el receptor no conoce: el proxy `generate-services/code` sólo representa un registro ya
existente y el emisor/almacén real no está en los repos. También se midió el candidato de piloto:
Pullman (94) tiene CrediPullman (77). El contrato pendiente debe resolver producto→lender del lado
autoritativo; el ejemplo móvil usa el producto 80 y no sirve como `lender_id`. Se dejó además una
prueba repetible en harness: siembra el código contra el mock y verifica desde la UI del asesor que la
solicitud llega a lenders con una única entidad. La prueba local pasó para Amoblando Pullman con
`0102` → Sistecrédito (solicitud 466893). El launcher también fuerza Vite a `127.0.0.1`: antes podía
anunciar :5174 disponible estando sólo en `::1`, inaccesible desde Chrome.

### 2026-09-21
Contextualización de punta a punta, contra `main` de los cuatro repos. Se encontró el flujo completo en
legacy-application (pantalla de cuatro dígitos → consulta y consumo del código → creación manual de la
solicitud → redirección al listado → filtro de una sola entidad) y se confirmó que la consulta y el
consumo **ya viven en legacy-backend**, así que esa mitad no se migra. Se midió el uso en prod: doce
solicitudes de abril de 2026, un solo comercio, ninguna avanzó. Se leyó el lado de la app: el código lo
genera el propio dispositivo y el QR es una ilustración estática, con un formato distinto al que el
receptor acepta. Conclusión: no es un port 1:1; falta cerrar quién emite el código antes de construir. Se publicó como CORE-627 en el sprint activo, en estado de desarrollo; el título perdió la palabra «wizard», que fuera del equipo no dice nada. Después se aterrizó el reparto: se verificó que la solicitud sólo puede nacer en el backend (el wizard no tiene base y en el camino normal nace al validar el OTP), que existe un precedente con la misma forma en el canal de Corbeta, y que el listado nuevo consulta los preaprobados de a una entidad desde el front — por eso el recorte va ahí y no cuesta consultas de más. Se abrieron las dos ramas desde `qa` y sus PRs en borrador (#1450 y #1043), creadas con plumbing sobre `origin/qa` para no mover el working tree de los repos, que tienen otras sesiones encima.

### 2026-09-22
Se construyó el endpoint del backend y se probó corriéndolo. Crea la solicitud con la entidad del
código reusando el proxy que ya existía, con seis pruebas del servicio y un mock nuevo del servicio de
códigos —que en local no estaba configurado, así que este camino no se podía correr—. Medido: el
código sembrado deja la solicitud creada y consumida, el segundo intento devuelve 409 sin crear nada, y
el listado de esa solicitud trae las nueve entidades del comercio con la del código adentro, que es lo
que confirma que el recorte le toca al front. Después se hizo el front entero: pantalla de captura, entrada
visible desde la pantalla del celular y recorte del listado. Dos cosas se descubrieron construyendo y
no leyendo: el endpoint hablaba un envelope que el wizard no sabe desenvolver —corregido, con códigos
de error propios para que la pantalla distinga los rechazos—, y la ruta puesta en el árbol público no
daba 404 sino que la resolvía el árbol vecino, que es la trampa que ya había costado un revert de main.
La pantalla todavía no se vio con ojos: el árbol del asesor pide sesión de Cognito.

Apareció que el trabajo ya tenía tarjeta: **CORE-614**, de Laura Cabra, con la misma intención escrita
en una línea. Se pasó a esa: lleva ahora el título y la descripción de acá, y la que se había creado el
día anterior (CORE-627) quedó invalidada con un comentario que apunta a la buena. Al renombrar las
ramas de `CORE-627` a `CORE-614`, **GitHub cerró los dos PRs en lugar de moverlos**, así que se
recrearon (#1455 y #1045) y los cerrados quedaron enlazados a su reemplazo. De leer la tarjeta original
salió además un choque de vocabulario que vale más que el trámite: en el equipo a este código le dicen
«OTP», que es el mismo nombre del código que valida el teléfono — y este flujo justamente no lo pide.

<!-- ─────────────────────────────────────────────────────────────────────────────────────────────
     DE ACÁ PARA ABAJO ES LO ÚNICO QUE SALE A JIRA.
     ───────────────────────────────────────────────────────────────────────────────────────────── -->


## Tarea (publicable)

## En una línea
Que el cliente que vio un preaprobado en la app pueda presentar su código en el comercio y continuar la
solicitud desde la plataforma nueva, viendo únicamente la entidad de ese preaprobado.

## Por qué
Hoy este camino sólo existe en la plataforma anterior, que se está dejando atrás. Mientras siga ahí, el
cliente que llega con un preaprobado de la app no puede atenderse desde el flujo nuevo, y cada mejora
del listado de entidades hay que hacerla dos veces.

## Qué cambia
- Aparece una pantalla para ingresar el código del cliente dentro del flujo nuevo, a la que se llega
  desde la pantalla donde hoy se pide el celular. **Sólo en comercios de Colombia**: en los demás
  países la opción no aparece y la pantalla del código no se puede abrir.
- Con un código válido, la solicitud se crea sin pedir celular ni código de verificación.
- El listado de entidades muestra **sólo** la entidad del preaprobado, en vez de todas las del comercio.

## Alcance
No entra la emisión del código: la hace el servicio de códigos, que la app ya consume. Tampoco cambia lo que la app muestra hoy, ni se rehace el listado de entidades: se le
agrega un filtro.

## Dónde probar
Cualquier comercio de Colombia: el camino es general, sin un piloto. Hace falta un cliente con un
preaprobado de ese comercio en la app, para que la app le genere el código. Como contraste, un comercio
de otro país, donde la opción no debe aparecer.

## Cómo validar
1. Entrar al flujo del comercio y elegir la opción de cliente que ya usa la app.
2. Ingresar un código válido.
3. Verificar que la solicitud queda creada sin pedir celular ni código de verificación.
4. Verificar que el listado de entidades muestra una sola: la del preaprobado.
5. Repetir con un código inválido y con uno ya usado, y verificar que avisa y no crea nada.
6. Entrar al flujo de un comercio de otro país (por ejemplo, Perú) y verificar que la opción de
   cliente de la app no aparece, y que abrir directamente la pantalla del código lleva a la del celular.
7. Repetir con un código cuya entidad no esté habilitada en ese comercio, y verificar el
   comportamiento acordado para ese caso.

## Criterios de aceptación
- Un código válido crea la solicitud y lleva al listado sin pedir celular ni verificación.
- El listado muestra exactamente una entidad: la del preaprobado.
- Un código inválido o ya usado avisa y no deja ninguna solicitud creada.
- La opción de código de la app sólo existe en comercios de Colombia.
- El caso de la entidad no disponible en el comercio se comporta como se haya acordado, y se distingue
  de una entrada exitosa.

## Dependencias / contraparte
- **Servicio de códigos**: el formato de dos letras y cuatro números todavía no está publicado en
  producción; hasta entonces emite cuatro dígitos. La web acepta los dos.
