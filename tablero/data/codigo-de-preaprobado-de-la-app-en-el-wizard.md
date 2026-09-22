---
id: 94
title: "Código de preaprobado de la app en la plataforma nueva"
ramas: feat/CORE-627-codigo-preaprobado-app
stage: work
created: "2026-09-21T16:40:00-05:00"
canon: [preaprobado, listado, onboarding, creditopx]
jira: [CORE-627]
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
de 2026, todas de un comercio y todas paradas en el estado con que nacen. Y los dos extremos **no se
hablan**: la app pinta un código generado en el propio dispositivo, de formato distinto al que el
receptor web acepta. O sea, esto no es un port 1:1 de algo que funciona: es reconstruirlo y, de paso,
decidir quién emite el código de verdad.

Validación: la receta y las consultas están en «Cómo se comprueba».

Las dos ramas están abiertas desde `qa`, con su PR en borrador (ver Referencias).

**El próximo paso es:** construir el endpoint del backend en su rama. No depende de la pregunta
abierta del emisor: lo que esa respuesta bloquea es la prueba punta a punta con un código real, no la
construcción — para eso alcanza con un código sembrado.

## Pendientes

- [ ] Confirmar quién emite el código y con qué formato; termina cuando haya un emisor nombrado y un
      formato acordado entre la app y el receptor web.
      Depende de: quien pidió la migración — y del equipo de la app móvil.
- [ ] Confirmar si la entidad objetivo es Credipullman; termina cuando esté dicho contra qué comercio y
      entidad se va a probar.
- [x] Decidir dónde filtra el listado — **va sólo en el front**, en el loader, antes de consultar
      preaprobados (2026-09-21).
- [ ] Elegir cómo sabe el front que esta solicitud vino por código: sesión del wizard o dato en la
      respuesta del endpoint nuevo; termina cuando el listado recorta sin preguntarle nada al cliente.
- [ ] Construir la pantalla de captura en el wizard; termina cuando un código válido deja la solicitud
      creada y redirige al listado.
- [ ] Llevar el filtro de una sola entidad al listado nuevo; termina cuando el listado responde una
      sola entidad para una solicitud que entró por código, y el caso se puede correr.
- [ ] Definir qué se hace cuando la entidad del código NO está en el listado; termina cuando esté
      elegido entre mostrar todo (lo que hace hoy) o avisar.

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

> **DECISIÓN · 2026-09-21** — el filtro a una sola entidad va **sólo en el front**. Verificado: el
> loader del listado decide a qué entidades les pide el preaprobado, **una por una**
> (`partitionLendersForPreApproval`), así que recortar antes no paga las consultas de las demás. La
> contra, asumida a sabiendas: `lenders-v2` sigue devolviendo todas y evaluándolas del lado backend, así
> que «una sola entidad» es verdad en pantalla, no en la API.

## Lo que está bloqueado

> **PREGUNTA · 2026-09-21 · quien pidió la migración** — ¿quién emite el código que el cliente
> presenta? La app lo genera en el dispositivo y no llama a ningún servicio de códigos; el receptor
> espera cuatro dígitos y la app muestra once caracteres. Hoy no hay un emisor que una los dos lados.

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

> **RIESGO · 2026-09-21** — el flujo entra sin OTP. En aliados eso se resuelve con una marca de sesión;
> en el wizard hay que darle un equivalente, o la solicitud queda accesible sin que nadie haya probado
> ser su dueño.

## Lo que NO entra

- La emisión del código (el servicio generador y lo que la app tenga que hacer): es contraparte, no
  esta tarea.
- Cambiar lo que la app muestra hoy.
- Tocar la consulta de preaprobados de la app.
- Reescribir el listado de entidades: se le agrega un filtro, no se rehace.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Última comprobación: **2026-09-21**.

**Qué tanto se usa el camino viejo** (la marca es el comentario con que nace la solicitud):

> **MEDICIÓN · 2026-09-21** — 12 solicitudes en total, todas en abril de 2026 y ninguna después.
> `make trazador-sql TARGET=prod SQL='SELECT date_format(created_at,"%Y-%m") AS mes, count(*) AS solicitudes FROM user_request_records WHERE comment = "Solicitud creada desde validacion de codigo cliente." GROUP BY 1 ORDER BY 1'`

> **MEDICIÓN · 2026-09-21** — las 12 son de un solo comercio (Celucambio), repartidas entre Celupresto
> (8) y Crediteame CC (4), y **las 12 siguen en el estado 9**, que es con el que nacen: ninguna avanzó.
> `make trazador-sql TARGET=prod SQL='SELECT a.name AS comercio, l.name AS entidad, ur.user_request_status_id AS estado, count(*) AS n, max(ur.created_at) AS ultima FROM user_request_records urr JOIN user_requests ur ON ur.id = urr.user_request_id LEFT JOIN allieds a ON a.id = ur.allied_id LEFT JOIN lenders l ON l.id = ur.lender_id WHERE urr.comment = "Solicitud creada desde validacion de codigo cliente." GROUP BY 1,2,3 ORDER BY n DESC'`

**Que la app genera el código sola** (se comprueba leyendo, y por la ausencia de llamadas):

    git -C ~/Desktop/CREDITOP/github/creditop_mobile grep -n '_generateSerialCode' origin/main
    git -C ~/Desktop/CREDITOP/github/creditop_mobile grep -rniE 'generate/code|generate-services' origin/main   # vacío

**Que el filtro no existe todavía en el listado nuevo:**

    git -C ~/Desktop/CREDITOP/github/legacy-backend grep -n 'client_code' origin/main -- Modules/Onboarding   # vacío
    git -C ~/Desktop/CREDITOP/github/frontend-monorepo grep -rni 'client-code' origin/main                     # vacío

**El listado de un comercio, para ver contra qué se compara el filtro:**

    make harness-listado COMERCIO=<slug>

## Referencias

- Temas de canon: `preaprobado`, `listado`, `onboarding`, `creditopx` (van en el frontmatter).
  `fronteras` ayuda para la parte de rutas internas entre módulos.
- Canon **no cubre** el código de cliente: la búsqueda por API no devuelve ninguna sección de este
  flujo. Si algo de acá queda en firme, es candidato a graduar.
- El precedente más cercano en el wizard nuevo es «Confirmación de cupo» (`flowSignatureChoice`), que
  marca una variante de flujo en la sesión del wizard.
- Jira: [CORE-627](https://creditop.atlassian.net/browse/CORE-627).
- PRs, los dos en borrador y contra `qa`, rama `feat/CORE-627-codigo-preaprobado-app`:
  [legacy-backend#1450](https://github.com/Creditop-SAS/legacy-backend/pull/1450) ·
  [frontend-monorepo#1043](https://github.com/Creditop-SAS/frontend-monorepo/pull/1043).

## Registro

### 2026-09-21
Contextualización de punta a punta, contra `main` de los cuatro repos. Se encontró el flujo completo en
legacy-application (pantalla de cuatro dígitos → consulta y consumo del código → creación manual de la
solicitud → redirección al listado → filtro de una sola entidad) y se confirmó que la consulta y el
consumo **ya viven en legacy-backend**, así que esa mitad no se migra. Se midió el uso en prod: doce
solicitudes de abril de 2026, un solo comercio, ninguna avanzó. Se leyó el lado de la app: el código lo
genera el propio dispositivo y el QR es una ilustración estática, con un formato distinto al que el
receptor acepta. Conclusión: no es un port 1:1; falta cerrar quién emite el código antes de construir. Se publicó como CORE-627 en el sprint activo, en estado de desarrollo; el título perdió la palabra «wizard», que fuera del equipo no dice nada. Después se aterrizó el reparto: se verificó que la solicitud sólo puede nacer en el backend (el wizard no tiene base y en el camino normal nace al validar el OTP), que existe un precedente con la misma forma en el canal de Corbeta, y que el listado nuevo consulta los preaprobados de a una entidad desde el front — por eso el recorte va ahí y no cuesta consultas de más. Se abrieron las dos ramas desde `qa` y sus PRs en borrador (#1450 y #1043), creadas con plumbing sobre `origin/qa` para no mover el working tree de los repos, que tienen otras sesiones encima.

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
  desde la pantalla donde hoy se pide el celular.
- Con un código válido, la solicitud se crea sin pedir celular ni código de verificación.
- El listado de entidades muestra **sólo** la entidad del preaprobado, en vez de todas las del comercio.

## Alcance
No entra la emisión del código: quién lo genera y con qué formato es una definición pendiente y
depende de la app. Tampoco cambia lo que la app muestra hoy, ni se rehace el listado de entidades: se le
agrega un filtro.

## Dónde probar
Por definir: hace falta acordar el comercio y la entidad con los que se va a probar. El único comercio
con historial por este camino es Celucambio, con las entidades Celupresto y Crediteame CC.

## Cómo validar
1. Entrar al flujo del comercio y elegir la opción de cliente que ya usa la app.
2. Ingresar un código válido.
3. Verificar que la solicitud queda creada sin pedir celular ni código de verificación.
4. Verificar que el listado de entidades muestra una sola: la del preaprobado.
5. Repetir con un código inválido y con uno ya usado, y verificar que avisa y no crea nada.
6. Repetir con un código cuya entidad no esté habilitada en ese comercio, y verificar el
   comportamiento acordado para ese caso.

## Criterios de aceptación
- Un código válido crea la solicitud y lleva al listado sin pedir celular ni verificación.
- El listado muestra exactamente una entidad: la del preaprobado.
- Un código inválido o ya usado avisa y no deja ninguna solicitud creada.
- El caso de la entidad no disponible en el comercio se comporta como se haya acordado, y se distingue
  de una entrada exitosa.

## Dependencias / contraparte
- **App móvil**: acordar quién emite el código y con qué formato. Hoy el código que muestra la app se
  arma en el propio teléfono y no coincide con el que la web acepta, así que los dos extremos todavía
  no se entienden.
- **Producto**: confirmar la entidad objetivo y qué debe pasar cuando su entidad no está disponible en
  el comercio.
