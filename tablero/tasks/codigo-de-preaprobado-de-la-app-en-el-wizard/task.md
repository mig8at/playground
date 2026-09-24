---
id: 94
title: "Código de preaprobado de la app en la plataforma nueva"
ramas: feat/CORE-614-codigo-preaprobado-app, feat/CORE-614-codigo-app-solo-colombia, feat/codigo-alfanumerico-en-main
stage: work
created: "2026-09-21T16:40:00-05:00"
canon: [preaprobado, listado, onboarding, creditopx]
jira: [CORE-614]
jira_title: "Código de preaprobado de la app en la plataforma nueva"
---

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
- [x] Configurar el servicio de códigos en el backend de `qa` — `CODE_GENERATION_SERVICE_BASE_URL=
      http://self-manager-api.inertia-develop:8082` en `dev/legacy-backend-qa` + redespliegue (2026-09-24).
- [x] Servicio de códigos configurado en el backend de **producción** — un código inexistente para un
      comercio inexistente responde `409 invalid code` desde self-manager-api (2026-09-24). Dev y staging
      no se verificaron: el canje no está en sus ramas.
- [x] Validar en `qa` un canje real — código `9997` → solicitud 502728 con CrediPullman y el listado con
      una sola entidad (2026-09-24).
- [ ] Que el servicio de códigos emita `AA0000` en dev/qa; termina cuando `make harness-codigo-qa` devuelva
      un código de 6 caracteres. Hoy dev corre la imagen fijada `v0.0.3` (9/04, anterior al formato) y
      prod `3900158`: los dos emiten 4 números. PR limpio con sólo el formato:
      [self-manager-api#22](https://github.com/Creditop-SAS/self-manager-api/pull/22), contra `main`, con el CI
      en verde (arregla además el lint de `main`, que no arrancaba: config v1 contra golangci-lint v2.6).
      Depende de: quien etiquete el servicio y de infraestructura, que suba la imagen fijada en
      `environments/development/ecs-application`. ⚠ No etiquetar para prod antes de que `main` de
      `legacy-backend` y de aliados acepten `AA0000` (hoy `^\d{4}$` y `digits:4`).
- [ ] Llevar a `main` los tres PRs de la tarea (backend #1455, front #1045 y #1049), hoy sólo en `qa`.
      Es el único pendiente: el alcance está hecho y probado en `qa` (2026-09-24). Al llegar a `main`,
      graduar a canon y archivar.

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

## Lo que está bloqueado

> **HALLAZGO · 2026-09-24** — **tres trampas para configurar el servicio de códigos**, ninguna del
> código: (1) el despliegue (`config-ci/deploy-task.yaml`) copia las claves del secreto a la task
> definition **al desplegar**: una clave agregada después no llega al contenedor hasta otro despliegue
> —reiniciar no alcanza—, y las instancias viejas siguen atendiendo un par de minutos después del verde.
> (2) El host del ALB interno (`…develop.internal.creditop.com`) **no resuelve**: falla en <1 s con
> `503 Could not connect`. El bueno es `http://self-manager-api.inertia-develop:8082`. (3) Con la **VPN
> de prod**, `*.inertia-develop` resuelve a otra red (`172.32.x`) y todo parece caído —backends sin base,
> rutas en 404—; con la de dev vuelve a `10.0.x`.
> *(El hallazgo de abajo, «no tiene configurado», quedó resuelto el 2026-09-24.)*

> **HALLAZGO · 2026-09-23** — **el backend de `qa` no tiene configurado el servicio de códigos.** Un
> código inexistente para Pullman no responde «no disponible» sino **500** `CCO003` «Code generation
> service base URL is not configured.», con `upstream_endpoint` `/api/v1/generate/code/consult`. O sea:
> en `qa` no se puede canjear NINGÚN código, válido o no. Falta `CODE_GENERATION_SERVICE_BASE_URL` en el
> secreto de `legacy-backend-qa`. self-manager-api sólo tiene workflows de dev y prod; el de dev responde en
> **`http://self-manager-api.inertia-develop:8082`** (`/health` 200). ⚠ El host del ALB interno que
> declara `infrastructure/environments/development/internal-alb` (`…develop.internal.creditop.com`)
> **no resuelve** (NXDOMAIN): no sirve como valor.
> `curl -XPOST http://legacy-backend-qa.inertia-develop/api/onboarding/client-code/redeem -d '{"code":"ZZ0000","partner_branch_hash":"ec977139"}' -H 'Content-Type: application/json'` · TARGET=qa

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

*(Las tres preguntas y el hallazgo de abajo quedaron contestados por lo de arriba; se dejan como
historia de cómo se llegó.)*

> **HALLAZGO · 2026-09-22** — no falta unir dos identidades: `POST /v1/preapprovals/me/check` toma
> `X-User-Id` de la app y lo entrega como `applicant_id`; en legacy-backend ese valor es el mismo
> `users.id` que el servicio de códigos devuelve como `user_id`. Lo que falta es sólo el registro
> persistente del código y su resolución a lender.

> **HALLAZGO · 2026-09-22** — `POST /api/onboarding/generate-services/code` no emite el código:
> exige que ya lleguen `code`, `user_id`, `commerce_id`, `entity_id`, estado y fechas, y sólo devuelve
> texto. El servicio que sí consulta/consume cuatro dígitos no está entre los repos disponibles.

> **HALLAZGO · 2026-09-22** — no hay un allowlist de comercios en el wizard: la entrada `codigo` está
> bajo todo `/merchant/:partner_hash`, así que se ofrece a cualquier punto de venta de asesor. Pero el
> canje consulta el código con el `merchant_id` que sale de esa sucursal: un código no es portátil entre
> comercios. En términos de rollout, la pantalla es general; el camino útil sólo existe donde el
> emisor haya persistido ese comercio y un `lender_id` que el punto de venta pueda ofrecer.

## Lo que NO entra

- **Apagar el camino viejo en aliados** (decisión de Miguel, 2026-09-24): la tarea termina cuando el
  código se canjea y el usuario ya registrado ve el listado con su entidad. Retirar la pantalla de
  aliados es otra decisión, para después de que el camino nuevo esté en producción.
- La emisión del código: la hace self-manager-api y la app ya lo llama; es contraparte, no esta tarea.
- Cambiar lo que la app muestra hoy.
- Tocar la consulta de preaprobados de la app.
- Reescribir el listado de entidades: se le agrega un filtro, no se rehace.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Última comprobación: **2026-09-21**.

**Qué tanto se usa el camino viejo** (la marca es el comentario con que nace la solicitud):

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

**Generar un código para QA — lo único que hace falta** (VPN de dev). Un comando: resuelve comercio,
entidad habilitada y un cliente sintético contra la base de `qa` (sólo lectura), le pide el código al
servicio real y lo imprime con el enlace a la pantalla:

    make harness-codigo-qa                                     # Pullman ec977139, primera entidad, un SYNTH PRUEBA
    make harness-codigo-qa COMERCIO=<hash> ENTIDAD=<lender_id> USUARIO=<user_id>

**Los códigos guardados para QA:** [Códigos de preaprobado](https://claude.ai/artifact/1GXiuTAyaMTUGYgwC3ikDN)
(archivo en `artifacts/`, variante `canje-en-qa`) — 10 por cada uno de los 13 comercios de Colombia con
asesores en `qa`, se elige el comercio, sale uno disponible al azar y **al copiarlo queda tomado** —no le
sale a nadie más—, con el enlace a la pantalla de canje de su sucursal (estado en el almacén `db` de la
página, colección `codes`; si dos lo sacan a la vez, el segundo recibe otro). Salen del lote:

    make harness-codigo-qa LOTE=10        # → harness/.runs/codigos-qa.json (130 códigos, 2026-09-24)

⚠ **Vencen el último día del mes: al empezar el siguiente se corre el lote de nuevo** y se recarga la
colección (un `set` por documento, id `a<comercio>-u<cliente>-l<entidad>`, con `used: false`). El id es
la combinación, no el código, así que regenerar pisa el código viejo en la misma fila. Cada código usa un
cliente sintético distinto porque el servicio devuelve el MISMO código mientras siga activo para el mismo
cliente, comercio y entidad.

**El canje REAL en `qa`** (VPN de dev; la sesión de `cognito-state.qa.json` es MIGUEL TEST, en
`ec977139`). El `merchant_id` es el `allied_id` de la sucursal (Pullman = 94); el usuario, uno de PRUEBA
(los «SYNTH PRUEBA» con correo `@creditop.com`):

    curl -XPOST http://self-manager-api.inertia-develop:8082/api/v1/generate/code \
      -H 'Content-Type: application/json' -H 'X-User-Id: <usuario de prueba>' -d '{"merchant_id":94,"lender_id":77}'
    curl -D- -XPOST https://originaciones-qa.dev.creditop.com/merchant/ec977139/codigo \
      -H "Cookie: <cognito-state.qa>" --data 'code=<el código>'      # 302 a …/<id>/lenders + __session
    # el listado de esa solicitud con la __session nueva y con la vieja: una entidad contra todas

**Que producción tiene el servicio de códigos configurado**, sin leer ni escribir un código (la ruta
vieja `generate-services/code/consult` ya está en `main`; el backend exige 4 dígitos, así que va un
código válido con un comercio que NO existe). «not configured» = falta la variable; `invalid code` =
llegó al servicio:

    curl -XPOST http://legacy-backend.inertia-production/api/onboarding/generate-services/code/consult \
      -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"merchant_id":999999999,"code":"0000"}'

**El listado de un comercio, para ver contra qué se compara el filtro:**

    make harness-listado COMERCIO=<slug>

## Referencias

- Prototipo para QA: [Código de preaprobado](https://claude.ai/artifact/1GXiuTAyaMTUGYgwC3ikDN), hermano del
  [Contrato de checkout](https://claude.ai/artifact/3SeV7vVMBN2DFqMeVueGAb) de ecommerce.
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
