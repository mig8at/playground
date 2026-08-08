# Findings · cerrados (crónicas frías)

> Cuerpos completos de incidentes CERRADOS y hallazgos STALE, movidos de `doc.md` el 2026-08-08.
> El ancla `### F-xx` vive SIEMPRE en `doc.md`; esto es solo la crónica, para grep. Append-only.

### F-03 · Un `.catch(() => {})` convirtió una corrida rota en "1 passed"

**Síntoma:** el harness reporta éxito, pero el navegador no hizo nada de lo que dice el log.
**Causa raíz:** con la página cerrada, `goto`/`screenshot`/`pause` lanzan **todos**; envueltos en `.catch(() => {})` la corrida terminaba en verde. La foto del log era mentira: el `console.log('📸 …')` corre aunque el screenshot falle.
**Evidencia:** el `.png` conservaba la fecha de la corrida anterior; sin líneas `nav →`; duración anormalmente corta.
**Arreglo:** el salto distingue "ventana cerrada" de un error de navegación y **tira** en vez de tragarse el error.
**Estado:** resuelto. **Lección:** un `.catch` vacío sobre el paso que da sentido a la corrida es un mentiroso.

---

### F-76 · El backfill de una migración NO cubre las filas futuras: Motai perdió el PEP en dev/qa sin que nadie tocara nada

**Síntoma:** el selector de tipo de documento de Motai **no ofrece PEP** en dev/qa. `GET /api/loans/allied/f0548728` → `allowed_document_types: ["CC","CE"]`. Silencioso: nadie tocó código ni configuración, y Motai apunta justamente a **migrantes con PEP**.

**Causa raíz verificada — el dato lo puso un backfill de una-sola-vez, y las filas se recrearon después.** La des-motaización movió los tipos de documento del `if merchantMode === 'motai-renting'` quemado en el front a `lenders_by_allied_branches.document_types`, y su migración hizo el backfill (piso `["CC","CE"]` para todos + `["CC","CE","PEP"]` para el lender 158). **Ese backfill funcionó** (4.070 filas con valor, 11 NULL). Pero la columna es *nullable sin default*, y las asociaciones del 158 se **volvieron a crear después** de la migración —junto con la reconfiguración de sus `group_rules`—, así que nacieron con `document_types = NULL`. El "piso" del código (`AlliedInfoController::resolveAllowedDocumentTypes`) arranca en `['CC','CE']` y suma lo que traigan las filas: con NULL no suma nada → sin PEP.

**Evidencia:** las 3 sucursales del 158 con `document_types = NULL` y **0 filas con PEP en toda la base**; sus ids son altos (`lab#39917/39922/39930`) → creadas después del backfill. En local no se veía porque la fila de prueba se había sembrado a mano **con** PEP.

**Arreglo (aplicado):** `UPDATE lenders_by_allied_branches SET document_types = '["CC","CE","PEP"]' WHERE lender_id = 158` → 3 filas; el endpoint pasó a `["CC","CE","PEP"]`. Es **configuración de datos**, no código.

**Estado: desbloqueado, pero la causa sigue viva.** Poner el dato a mano no evita que se repita con la próxima sucursal o entidad que se habilite. Las filas se crean en `Modules/Partner/App/Services/AlliedManagementService.php` (`LendersByAlliedBranch::create`, en dos lugares) **justo al lado de donde se copian las reglas** (`addNewRule`/`addNewLenderRule`) — ese es el punto natural para que hereden los tipos de documento. Alternativas: default a nivel de columna, o mover el dato a `lender_requirements` (ya es la tabla de requisitos POR LENDER, y "acepta PEP" es una propiedad del lender más que de la sucursal). **Sin decidir.**

**Lección.** Un backfill migra el **pasado**; si el dato lo consume una fila que se crea dinámicamente, hace falta además que **el punto de creación lo herede** o que la columna tenga default — si no, el feature se degrada en silencio meses después y el síntoma no apunta a la migración. Y la trampa de método: validar la config en local con una fila **sembrada a mano** oculta exactamente este agujero. Cuando un dato "des-quemado" pasa a config, hay que probar el camino que la crea, no solo un caso plantado.

---

### F-13 · Wompi (cuota inicial)

`pkg/wompi-mock.ts` ya existía y `guided.spec.ts` no lo usaba. Aplicado a las dos ventanas. No se ejercita en la rama in-platform (ver F-09).

---

### F-14 · El harness arrastraba al usuario de vuelta al listado

**Síntoma:** tras elegir lender, la ventana A pasaba del handoff `/continue` a mostrar los lenders de nuevo.
**Causa raíz:** `cognitoLogin()` espera **15s** al input de usuario antes de concluir que no hay form. Con la sesión cacheada ese form nunca aparece, así que la entrada quedaba bloqueada mientras el usuario ya operaba; al desbloquearse, un "reintento del salto" veía que la URL ya no era `/lenders` y navegaba de vuelta.
**Evidencia:** el log salía **desordenado** — `entrada DIRECTA` aparecía después del journey completo de la otra ventana.
**Arreglo:** preguntar antes si hace falta login (`needsCognito()`) en vez de llamar a ciegas; el reintento vive dentro de la rama de login.
**Estado:** resuelto. **Lección:** un log fuera de orden delata que el script está bloqueado en otro lado.

### F-15 · La ventana B era una caja negra

Todos los listeners colgaban de A, así que 20 minutos de flujo del cliente no dejaron una sola línea (F-10). Ahora B tiene los mismos: navegaciones, console, `pageerror` y 5xx. **Encontró su primer muro (F-11) en la corrida siguiente.**

### F-16 · Un selector CSS pisaba el handler de otro botón

`document.querySelectorAll('.copy')` reasignaba el `onclick` de un botón que ya tenía el suyo, y reventaba con `$(undefined)`. Bug **preexistente**, invisible hasta que otro botón compartió la clase. Arreglado acotando a `.copy[data-copy]`.

### F-74 · El sweep resolvía el backend por su cuenta: contra `dev` registraba en LOCAL y dejaba la solicitud huérfana

Reincidencia de **F-65** por un camino que ese arreglo no cubría.

**Síntoma:** `sweep matrix/abaco` con `E2E_TARGET=dev` → todo 500 con `Attempt to read property "user_request_status_id" on null`. Parece un bug del backend de dev o una regresión del merge recién subido.
**Causa raíz verificada:** `dev/sweep.ts` tenía su **propia** resolución del API — `const API = process.env.E2E_MOCK_URL ?? 'http://localhost'` — sin pasar por la cadena por target. `.env.dev` define `E2E_API_BASE_URL` pero **no** `E2E_MOCK_URL`, así que el fallback mandaba el `register` del cliente al backend **LOCAL** mientras los `INSERT` (que sí usan `pkg/db.ts`) iban a la BD de **DEV**: el `user_request` nacía apuntando a un `users.id` que solo existe en local → **huérfano** → cualquier endpoint que resuelve el usuario revienta. `pkg/config.ts` ya lo resolvía bien (eso fue F-65); este archivo no lo usaba.
**Evidencia:** en dev **ningún** user con el teléfono de prueba `3131010101`; el `user_id` que referenciaban los uReq (`1828535`) existía **en local**, creado a la hora exacta de la corrida; los uReq sí estaban en dev.
**Arreglo:** `dev/sweep.ts` usa `config.mockUrl` (override por `E2E_MOCK_URL`, si no la cadena `.env.<target>`). Verificado: `local → http://localhost` · `dev → legacy-backend.inertia-develop` · `staging → legacy-backend-qa.inertia-develop`, y la regresión del camino local pasa.
**Estado: resuelto.** **Lección:** cada script que hable con el backend debe pedirle la URL a `pkg/config.ts`; una resolución propia con fallback a `localhost` no falla ruidosamente, **escribe en dos bases a la vez** y el síntoma aparece dos capas más abajo. Si ves 500 con "property ... on null" en un flujo sembrado, sospechá SIEMPRE de un uReq huérfano antes que del producto.

---

### F-30 · DENTIX no cierra en local: su pagaré es Deceval (SOAP)

**Síntoma:** el cierre headless de DENTIX #139 se traba en `promissory (show)` con HTTP 502 `{"operation":"createGirador"}` y authorize dice "PromissoryNote con ID de Deceval no encontrado". Queda en estado 28.
**Causa raíz:** DENTIX tiene `promissory_type_id = 2` = pagaré **desmaterializado en Deceval** (`Modules/Loans/App/Actions/DecevalSoap.php`, 4 operaciones SOAP contra `config('services.deceval.soap.host')` — sin host en el `.env` local). Celupresto/Mediarte/Motai usan `promissory_type_id = 1` (blade) y por eso sí cierran.
**Estado:** frontera documentada. Mockear Deceval exigiría envelopes SOAP válidos para 4 operaciones — hacerlo a ciegas es especulativo; si algún día hace falta, el 502 logueado trae la operación exacta.

### F-38 · Rotativo (rt=3) SÍ existe y se distingue — pero no cierra por config del comercio

**Cobertura previa: cero.** Hay **13 lenders rt=3 activos** en el dump y **ninguno** estaba en los comercios de `.flows.json`. Agregados `dentalix` (`51d2b8a2`) y `alpeluche` (`cb6a9f0a`).

**Lo que sí se validó:**
- Los rotativos **listan** y **seleccionan con `standBy`** (in-platform), igual que un rt=2.
- El backend **los trata distinto**: `select-payment-date` devuelve **`revolvingCredit: true`** y **3 fechas** de pago (los rt=2 devuelven 1–2). Ese es el marcador del producto.
- **Dentalix es el mejor escenario comparativo del dump**: ofrece el MISMO producto en las dos variantes — `Dentalpay X Consumo #101` (rt=2) y `Dentalpay X Rotativo #102` (rt=3) — así que permite un A/B real.

**Lo que NO cierra:** ninguna de las dos variantes llega a Estado 11, y fallan **en puntos distintos**:
- rt=3 #102 → `promissory (show)` HTTP 500 `Attempt to read property "fga" on null` (fondo de garantía)
- rt=2 #101 → pasa promissory pero `authorize` HTTP 500 `Attempt to read property "id" on null`

Como **su hermano rt=2 también falla**, el bloqueo NO es del producto rotativo: es config de ese comercio/lender que falta en el dump (`lender_guarantee_criteria` tiene una fila para #101 con **todos los campos en null**, y ninguna para #102). Sin diagnosticar más a fondo.

**Estado:** rotativo validado a nivel listado/selección/marcador; el cierre queda como frontera de datos, no de código.

### F-40 · Ecommerce: NO es ejercitable — la ruta de checkout ya no existe en el wizard

**Síntoma:** `GET /ecommerce/{hash}/checkout?o=<base64>` contra el wizard → **HTTP 404**.
**Causa raíz:** en `apps/loan-request-wizard/app/routes.ts` (main actual) el prefijo `:flow` → `:partner_hash` tiene hijos `solicitar`, `:phone_number/otp`, `:loan_request_id/*`… **pero NO `checkout`**. No existe ningún `routes/ecommerce/checkout.tsx`; lo único con nombre ecommerce vive bajo `routes/bancolombia/*` (`resolve-ecommerce-flow`, `ecommerce-loan-processing`), que es otro flujo.

**Lo que SÍ sigue vivo:** el lado de datos. `bin/dbops.ts ecommerce-url <merchant>` arma el contrato base64 correctamente, las tablas existen (`ecommerce_requests`, `allied_ecommerce_credentials`, `ecommerce_requests_log`, …) y **10 comercios tienen credencial ecommerce** (Pullman-pruebas, Amoblar, Colchones ensueño, Creditop, Rogans, …). O sea: el canal existe en backend; **lo que falta es la puerta de entrada en el frontend**.

**Implicancia para el harness:** `bin/ecommerce` y todo el eje "entrada por checkout" del suite están **stale** respecto del wizard actual. Antes de invertir en ese camino hay que averiguar si la ruta se movió, se renombró o el canal se replanteó (¿lo absorbió el flujo de Bancolombia?).

**Estado:** documentado como NO ejercitable. No es una limitación del entorno local ni de mocks: es que el frontend no expone la ruta.

---

### F-42 · Varios "servicios externos" existen como repo local

Antes de mockear algo, mirar `~/Desktop/CREDITOP/github/`: además de los tres repos conocidos hay **`onboarding-forms-service`**, **`messaging-service`** (el de `:8082`, cuya caída rompe el link por WhatsApp y el voucher — F-08), **`pre-approvals-service`**, `pdf-mapper-editor`, `dynamic-form`, `microservices`, `vtex`, `cognito-pre-sign-up`.

**Implicancia:** para varios muros hay **dos caminos** — mockear (rápido, fidelidad media) o **correr el servicio real** (más fiel). El de forms se pudo levantar en minutos; su límite fue S3, no el código. Vale evaluar caso por caso, sobre todo para `messaging-service`, que hoy es un fallo recurrente en los logs.

> 🔒 **Nota de seguridad:** `onboarding-forms-service/config/config.example.yaml` —un archivo de plantilla, versionado— contiene lo que parecen **credenciales AWS reales** (`aws.access_key_id` / `secret_access_key`). Vale confirmarlo con el equipo y rotarlas si es así.

### F-48 · Renting en v2: el discriminador es `product`, y estaba roto

En `main` el renting se decidía por **modo** (`user_request_modes` → `allied_modes.config.isAbacoRequired`; Motai tiene 3 modos y solo **#2 MotaiRenting** pide Ábaco). La rama `feature/motai-v2` **borra ese mecanismo** (elimina `AlliedMode`, `UserRequestMode` y su repositorio) y lo reemplaza por `lenders.product` + `lenders.calculator`.

**Pero el puente quedó roto:** `MotaiValidationService` en v2 leía `$userRequest->lender?->abaco`, y el commit `5013f4af` **quitó esa columna de la migración** ("Ábaco lo maneja otro equipo"). En un entorno limpio la columna no existe → `false` siempre → **el renting nunca pedía Ábaco**. En el local de desarrollo seguía andando por accidente (la columna quedó de una corrida anterior de la migración).

**Arreglo (commit local `bc373088` en la rama):** derivarlo del producto — `$userRequest->lender?->product === 'renting'`. Equivalente en datos: los únicos dos lenders con `abaco=1` son exactamente los que tienen `product='renting'`.

**Dato a confirmar con el equipo:** el lender **#158 "Motai Renting"** —el que la migración de v2 backfillea con `product='renting'` y la calculadora— **no está ofrecido en ninguna sucursal**, así que nunca lista. El renting *listable* es **#169 Motai R**.

### F-51 · El formulario de referencias del Figma: el mecanismo existe, la posición y los campos no

**Pregunta que lo originó:** en el diseño de Motai renting, después de "Continuar" en confirmation aparece un formulario (*Fecha de Vencimiento de Licencia* + *Referencia #1* y *#2*, cada una con Nombre / Parentesco / Contacto) y recién después la pantalla de Ábaco. En la corrida no aparece nunca. ¿Está en el front?

**Sí existe el mecanismo — formularios backend-driven.** El gate es `routes/additional-info.tsx`: le pregunta al backend qué formulario corresponde a la solicitud y enruta según la respuesta.

```ts
// additional-info.tsx:36
const nextPath = result.payload.formTypeId === null
      ? ROUTE_PATHS.signDocuments(String(loanRequestId))            // ← sin formulario: salta a firmar
      : ROUTE_PATHS.additionalInfoForm(String(loanRequestId), String(result.payload.formTypeId));
```

**Pero difiere del diseño en tres cosas (y una cuarta en la pantalla vecina):**

| # | Diseño | Código |
|---|---|---|
| 1 | el form va **entre confirmation y Ábaco** | el gate se entra desde `payment-schedule.tsx:171`, o sea **después del cronograma**, justo antes de firmar |
| 2 | Motai renting muestra el form | `form_types` tiene 6 filas y solo la **#6** está atada a un lender (**24 Credifamilia**); el #169 no tiene → `formTypeId=null` → salto directo a `sign-documents` |
| 3 | *Licencia* · *Parentesco* · 2 referencias | en `fields` **no hay ningún campo de licencia**; "Parentesco" solo existe como **"Parentesco con familiar PEP"** (id 82) —pregunta de PEP/AML, otra semántica—; y las referencias son **una sola** (ids 46-48: nombre / **dirección** / teléfono), no dos, y con *Dirección* donde el diseño pide *Contacto* |
| 4 | la pantalla de Ábaco ofrece **"Continuar sin validar"** | las rutas de `abaco/` son `index`, `platforms`, `platform-otp-validation`, `internal-error`: **ninguna permite saltear**. Hoy, una vez que entrás a Ábaco, es obligatorio |

**Consecuencia práctica:** el punto 2 se arregla con configuración (sembrar un form type), pero el **1 y el 4 son código** — mover el gate de posición y agregar la salida opcional de Ábaco. No alcanza con cargar datos.

**Caveat de alcance:** los puntos 2 y 3 se verificaron contra el **dump local**, que puede estar incompleto frente a staging. Antes de concluir que faltan en el producto, mirar `form_types`/`fields` en staging. Los puntos 1 y 4 salen del código y no dependen de la base.

### F-53 · La guarda de "estás tocando dev compartido" viene desarmada de fábrica

**Cómo apareció:** escribiendo los `CLAUDE.md` de `backend-mcp` y `backend-e2e`, dos revisiones independientes llegaron al mismo punto.

**El mecanismo.** Ambas herramientas protegen las escrituras contra el entorno compartido exigiendo una variable de entorno explícita — la idea es que tipearla te haga frenar y pensar:

```go
// backend-mcp/env.go:80  ·  backend-e2e/clean.go:52, create.go:104
I_KNOW_THIS_TOUCHES_SHARED_DEV
```

**El problema: los propios `.env` ya la traen puesta.** Está en los **cuatro** archivos, incluido el de `local`:

```
backend-mcp/.env.dev:7    I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-mcp/.env.local:7  I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-e2e/.env.dev:11   I_KNOW_THIS_TOUCHES_SHARED_DEV=1
backend-e2e/.env.local:11 I_KNOW_THIS_TOUCHES_SHARED_DEV=1
```

Y los `.env` se cargan solos: `backend-mcp/main.go:33` autocarga `.env.<target>` al arrancar, y `backend-e2e/Makefile:46` lo sourcea en cada target. Como el loader solo setea las variables que no estén presentes (`env.go:42`), **la guarda siempre evalúa true**. Nunca frena a nadie.

**Por qué en `backend-mcp` pesa más:** su target por defecto es **`dev`** (`main.go:51`), y `dev` apunta a un **RDS compartido**. O sea: correr un comando de escritura sin pensar en el target es el camino por defecto, y lo único que quedaba entre eso y la BD compartida es una guarda que ya viene satisfecha. En `backend-e2e` el default es `local` (`main.go:46`), así que hay que pedir `--target=dev` a propósito — la barrera real ahí es tipear el flag, no la variable.

**Dos agravantes verificados:**
- La guarda se apaga por **etiqueta, no por host**: compara `cfg.Target == "local"` y nunca mira `E2E_DB_HOST` (`backend-mcp/env.go:80`). Un `.env.local` apuntado a un host remoto pasa igual.
- El borrado grande de `backend-e2e` no es `clean` sino `pkg/database/database.go:31-72` (20 tablas, `FOREIGN_KEY_CHECKS=0`), que corre en 7 call sites **sin** chequear si el destino es compartido.

**No es un bug de código, es un default peligroso:** el mecanismo está bien diseñado y bien implementado; lo que lo anula es el dato de configuración que lo acompaña. Por eso no aparece leyendo el código de la guarda — hay que ir a mirar el `.env`.

**Qué haría falta (decisión del dueño, no del harness):** sacar la variable de los `.env` versionados —empezando por `.env.local`, donde no tiene ningún sentido— y dejar que se exporte a mano solo cuando de verdad se quiera tocar dev. Y evaluar que la guarda mire el **host** además de la etiqueta.

**Mientras tanto**, queda advertido en `backend-mcp/CLAUDE.md` y `backend-e2e/CLAUDE.md`: en esta máquina, la guarda no te va a frenar.

### F-56 · Cuatro de las cinco salidas de `/lenders` dan 404 fuera de `/merchant`

`available-lenders.tsx` arma sus destinos con `createRouteHelpers`, que prefija según el contexto (`/merchant`, `/self-service` o `/ecommerce`). Pero **`continue`, `gestionar` y `validate-lender-otp` solo están declaradas en el bloque `merchant` de `routes.ts`** (`:104, :129, :136`); el bloque público (`:flow`) no las tiene. Confirmado contra el artefacto generado `.react-router/types/+routes.ts:719`.

Consecuencia: en `self-service` o `ecommerce`, elegir un lender **renting** (`:554`), uno con **`path_id=3`** (`:548`), uno con **`validateLenderOtp`** (`:559`) o **CreditopX con QR** (`:564`) redirige a una ruta inexistente.

**Otros dos hallazgos del mismo paso, verificados:**

- **`standBy` es escritura muerta en `feature/motai-v2`.** El backend lo setea para rt=2/3/4 (`UserRequestService.php:435, :461, :610`) y el front **no lo lee nunca** (0 ocurrencias; el tipo del contrato ni lo declara). En `origin/develop` **sí** se usa. En esta rama el handoff de CreditopX se alcanza de rebote, por `showModal && sin url`.
- **`/continue?url=null` literal.** `available-lenders.tsx:566` hace `String(qrUrl)` y `qrUrl` es `null` salvo país 60; el string `'null'` viaja como query param y `loan-continue.tsx:104` usa `?? default`, que **no** cae al default porque `'null'` no es nullish → se genera un QR sobre la cadena `"null"`. Afecta a todo rt=2/3/4 fuera de República Dominicana.

### F-57 · Rescate antes de borrar `backend-e2e` y `backend-mcp`

Las dos herramientas se retiran (ver el porqué abajo). Esto es lo que valía la pena y **habría muerto con ellas**.

**Cierra F-38 — el 500 del pagaré con garantía.** F-38 dejó el síntoma "sin diagnosticar más a fondo" y sospechaba del `eval()`. La causa real, documentada en `backend-e2e/docs/VALIDATION.md:83`: **`FGA = 0` → el PDF sale `null` → desreferencia de null en `authorize`**. No es el `eval`. Para cerrarlo en local hay que sembrar `creditop_x_revolving_credits` + `lenders_by_allieds` con el cupo/FGA.

**Cierra la deuda de F-45 — la cadena backdoor de SmartPay.** F-45 anotó que `create-temporary-user` devolvía `BD000` sin traza y dejó abierto "si alguna vez importa ejercitar la orquestación REAL, hay que resolver el BD000". La respuesta estaba en `backend-e2e/main.go:461-464`: **el teléfono tiene que ir en E.164 consistente en TODA la cadena**, porque `createTemporaryUser` guarda el phone crudo pero `check-user-exists` y `resolve-lenders-redirect` normalizan a `"+"+dígitos` para el lookup; si no coinciden → `BDUS004`. La cadena completa es `create-temporary-user` (BDUS002) → `check-user-exists` (BDUS003) → `accept-terms` con términos **14/15** (BDTM002) → `dynamic-forms/create-user` (DYFS1001) → `resolve-lenders-redirect` (BDUS005). *No verificado corriéndolo — sale de leer el Go, que lo daba por verde.*

**El atajo de Credifamilia tiene una ventana de 1 hora.** `seedpreapproval` sembraba `status_id=41`, pero el consumidor real (`legacy-backend/app/Actions/Lenders/Credifamilia.php:130-137`) exige **tres** cosas: `status_id IN (40,41,42)` **+ `updated_at >= now()->subHour()` + un `status_detail` en `response`**. Sembrar el status y volver al día siguiente no sirve. La ventana no estaba documentada en ningún nodo.

**Diferencias dev vs local en `personal-info`** (`backend-e2e/docs/DEV-TARGET.md:190-197`): en dev el email tiene `unique:users,email` **+ validación MX del dominio**, la fecha de expedición debe ser real, y `birth_day/month/year` son **requeridos** — sin ellos, `ONB005 BIRTH_DATE_INVALID`. En local nada de eso aplica, así que un flujo que pasa en local puede morir en dev por validación de formulario.

**Motai #158 no desembolsa sin `credit_line_by_lenders`** (`VALIDATION.md:121`): es clon del 77 pero sin su línea de crédito, y `PaymentCalculationService` lee `lender->creditLines->rate` → "rate on null" en el `disburse`. Relevante porque el 158 se prueba en staging.

**`cryptocheck` se portó** a `harness/bin/dbops.ts`. Lo que lo hace servir no es el HMAC sino **probar contra una fila Experian NO sintética** (documento fuera del rango 2.9B): contra una fila que forjamos nosotros el MAC siempre valida y el chequeo no dice nada. Importa porque con un `APP_KEY` equivocado la inyección de buró escribe un blob ilegible y **`/lenders` no ofrece nada, sin ningún error** — se ve idéntico a "el perfil no califica". `appKey()` solo valida presencia.

**⚠ Lo que NO hay que migrar: la tabla "Perfilador 7/7"** de `backend-e2e/docs/VALIDATION.md:56-69`. Afirma que con ingreso 900k el lender #77 **desaparece** del listado, o sea que la group rule de ingreso excluye en rt=2. **El propio código de backend-e2e la desmiente** (`main.go:625-630`, que saltea los casos de ingreso para rt=2/3 con el comentario "los group rules CLASIFICAN, no excluyen — verificado"), y coincide con lo que ya dice el nodo de CrediPullman. Es evidencia stale de una calibración vieja.

**Lo único que se pierde a propósito: el `perfilador`.** Es el único ejercicio que **varía el perfil del usuario y asevera NO-oferta**; `sweep matrix` barre comercio × entidad con un perfil diseñado para pasar, así que nada afirma "este perfil no debería ser ofrecido". Su diseño valía: leía los umbrales **de la BD en runtime** (`MAX(lender_rules.value)` del field 87 para ingreso, `MIN(lender_users_category_rules.min_score)` para score), así que las expectativas no quedaban stale. Si alguna vez se quiere ese eje, va como un cuarto modo de `dev/sweep.ts` y esa es la receta.

**Por qué se borran.** `backend-mcp`: **no era un MCP** (sin `.mcp.json`, `mcpServers` vacío), el binario estaba **10 días atrás de la fuente**, 7 de sus comandos ya estaban duplicados en `dbops`, y sus 22 diagnósticos respondían preguntas que el árbol de contexto ya documenta con más precisión. Además tenía la superficie destructiva más grande del playground con la guarda desarmada (F-53). `backend-e2e`: probaba el backend por API, que es lo que hoy hace `dev/sweep.ts` con veredicto contra BD y exit code. Ninguna de las dos tenía un commit sustantivo desde el seed del repo (13-07), y ambas costaron mantenimiento en el refactor de `env/` sin devolver nada.

### F-59 · `bin/asesor` moría mudo en el paso `frontend` porque un `grep` sin match mata al script

**Síntoma.** Contra `dev` la corrida imprimía `○ frontend …` y terminaba con `code 1` **sin una sola línea más**: ni error, ni el `ok` del paso, ni el chequeo de backend. Parecía "el wizard no levantó", y ahí se pierde el tiempo (se descartó primero que `:5174` estuviera caído y que `set -e` matara el `curl && UP=1`; ninguna de las dos era).

**Causa raíz verificada.** `bin/asesor` resolvía la URL del backend con `WIZ_API="$(grep -E '^E2E_API_BASE_URL=|^E2E_MOCK_URL=' .env.$TARGET | head -1 | sed … | tr …)"`. Con la **partición de variables**, `E2E_API_BASE_URL` dejó de estar en `harness/.env.dev` y pasó al compartido `env/dev.env` — el archivo que el `grep` mira ya no tiene la clave. Un `grep` sin match devuelve **1**, `pipefail` lo propaga al pipeline, y bajo `set -e` la **asignación** aborta el script. El `2>/dev/null` no protege: silencia stderr, no el exit code. Por eso muere justo ahí y en silencio.

Ojo con la trampa de reproducirlo: en **zsh** (la shell interactiva) `ERR_EXIT` no aplica a las asignaciones, así que el mismo pipeline "sobrevive" y parece descartado. El shebang es `bash`; hay que reproducir con `bash -c`.

**Arreglo (aplicado).** Un helper `envget()` en `bin/asesor` que delega en `bin/envget.ts` — la cadena real (`process.env` > `.env.<target>` > `env/<target>.env` > heredado), con `|| true` para que una clave ausente deje la variable vacía y decida el fallback de cada caso, no la muerte del script. Se convirtieron las tres lecturas (`E2E_API_BASE_URL`/`E2E_MOCK_URL`, `E2E_PREAPPROVALS_ENDPOINT`, y `WIZ_BASE`). La cuarta (`VITE_ONBOARDING_FORM_SERVICE`) sigue siendo `grep` porque lee el `.env` del **wizard**, que es otro repo y no está en la cadena — pero con `{ grep … || true; }`.

**Regla que deja.** Cualquier `VAR="$(grep … )"` bajo `set -euo pipefail` es una bomba de tiempo: el día que la clave se mueve, el script no falla — **desaparece**.

### F-60 · Sonría no sirve para probar la omisión de Experian: el throttle corta antes que el flujo

**Síntoma.** Se preparó la prueba de "Confirmación de cupo" (omitir Experian con `flow_id=2`) contra **Sonría** en dev. Habría dado **verde por la razón equivocada**.

**Causa raíz verificada.** En el flujo clásico la compuerta es `Modules/Risk/…/DatacreditoQueryByAlliedController::validateDatacreditoQuery`, y el corte por flujo vive **adentro** de `app/Actions/RiskCentrals/Experian.php` (líneas 947/1037/1126, las tres variaciones). O sea: **el throttle se evalúa primero y, si corta, `Experian.php` ni se invoca** — el corte por `flow_id` nunca se ejerce.

La compuerta tiene dos ramas sobre `datacredito_frequencies`:

- `frequency IS NULL` → "consultar siempre": llama a Experian **en toda corrida** y luego incrementa el contador.
- `frequency` no nula → throttle: incrementa el contador **siempre** y consulta solo si `count % every == 0`.

Estado en dev (2026-07-21) y evidencia en la tabla `logs` (`controller = 'DatacreditoQueryByAlliedController'`, que persiste el veredicto con su `reason`):

| aliado | `frequency` | `every` | qué pasa |
|---|---|---|---|
| **26 Sonría** | 1 | 100.000.000 | `EXPERIAN_NOT_TRIGGERED · frequency_count_not_matched` — nunca consulta |
| **94 Amoblando Pullman** | 1 | 1 | `frequency_count_matched` — consulta siempre |
| **91 Mediarte** | **NULL** | 1 | `frequency_null_always_fires` — consulta siempre |

**Cómo probarlo bien.** Usar **Mediarte** (aliado 91, sucursal 375 `5da24bb1`, dado de alta en `.flows.json`): es el único que junta las dos condiciones — la compuerta siempre llega a `Experian.php`, y ahí ya se logró `flow_id=2` (solicitud `464334`, 16-jul). La prueba es concluyente cuando, para la misma solicitud, `logs` registra `EXPERIAN_TRIGGERED / frequency_null_always_fires` (⇒ la compuerta pasó) y **no** aparece fila nueva en `risk_central_user_data`.

**El confusor que hay que descartar.** `Experian::performRequest` cachea **1 mes** por `user_id` + `risk_central_id` (`Experian.php:251-254`). Con el usuario 1827671 la última fila Acierta (`risk_central_id = 1`) es del 17-jul 17:26, así que hasta el 17-ago "no hay fila nueva" **no prueba nada** — se explica por caché. Hay que correr con un usuario cuya caché esté fría.

**Y el contador NO es discriminante** (corrige una hipótesis previa): `$datacreditoQuery->increment('count')` corre en las **dos** ramas, incluso cuando `Experian.php` devolvió `null` por el flujo. Lo que discrimina es la fila en `risk_central_user_data`, no el contador.

**Actualización 2026-07-21 20:27 — la tabla de arriba ya no vale para Sonría.** Se pidió prender la consulta y el aliado 26 pasó a `frequency = NULL, every = 1`: hoy consulta siempre, así que **sirve igual que Mediarte** para esta prueba. Es un dato de configuración de dev/staging que cualquiera puede volver a cambiar — por eso el chequeo lee la regla en runtime en vez de asumirla.

**El chequeo está automatizado:** `node dev/experian-check.ts [<uReqId>]` (sin id, la última solicitud). Contrasta las cuatro cosas —firma, compuerta, caché, consulta— y sale con `0` omisión probada · `1` sí se consultó · `2` no concluyente. Dos trampas que ya resolvió y conviene no reintroducir:

- **Detectar la consulta por fecha suelta es un falso positivo.** `created_at >= solicitud` se come las consultas de solicitudes POSTERIORES del mismo usuario (la 464334 del 16-jul se comía una fila del 17-jul y daba "se consultó pese a la firma"). Hay que ir por el vínculo `user_request_risk_central_user_data`… pero esa tabla ata el reporte que quedó pegado a la solicitud **venga de consulta fresca o de caché**, así que la fecha sigue haciendo falta: anterior a la solicitud = reusado, posterior = consultado de verdad.
- **El contexto del veredicto vive en `logs.request`**, no en `response` (que queda vacío). Buscarlo en `response` devuelve `?` como razón y parece que la compuerta no dejó rastro.

### F-62 · En dev/staging está desplegada solo LA MITAD de la omisión de Experian: aparece el selector, pero nada lo aplica

**Síntoma.** En el wizard de dev/staging el selector "Confirmación de cupo" **aparece y se puede marcar**, así que parece que la funcionalidad está. Pero las solicitudes terminan con `flow_id = NULL`, y aunque se firmara, Experian se consultaría igual. Se pierde tiempo buscando la falla en el usuario, la caché o el comercio — no está en ninguno de los tres.

**Causa raíz verificada.** El cambio del backend **no está en `develop`** (comprobado con `git fetch` hecho; `origin/develop` en `278b28a5`). El commit `a603a5cd` figura **solo** en `origin/feat/backend-changes-for-already-confirmed-pre-approbal-flow-usage`. Y no es cuestión de un squash con otro sha: se comparó el **contenido** de los archivos en `origin/develop`.

Qué hay y qué no en lo desplegado:

| pieza | en `develop` | efecto |
|---|---|---|
| `check-if-able-to-omit` (RiskV2, `RKV26000`) | **SÍ** | el front pregunta y **muestra el selector** |
| corte por flujo en `app/Actions/RiskCentrals/Experian.php` | **NO** (0 menciones de flow/omit; la rama tiene 3) | **el buró se consulta igual** — y este es el camino que el wizard recorre |
| `RKV24029` en RiskV2 | **NO** | la API de decisión nunca dice "omitido" |
| `FLOW_ASSIGNABLE_STATUS_IDS` | `[1]` (la rama: `[1, 9]`) | la firma se rechaza en estado 9 con **`URV13005`** |

**Por qué entonces se ve el selector en staging.** Porque **front y backend van por caminos distintos**, y el front sí llegó:

| repo | commit | dónde está | dónde NO está |
|---|---|---|---|
| `frontend-monorepo` | `784585fe` (el selector) | `origin/staging` ✅ + la rama feature | `develop`, `main` |
| `legacy-backend` | `a603a5cd` (la omisión) | **solo** la rama feature | `develop`, `main`, `staging` |

`origin/staging` del front está **135 commits adelante** de `develop`. Y como staging **no tiene backend propio** (comparte el de dev, que corre `develop`), queda el peor cruce posible: **el front que muestra el selector está desplegado, y el backend que lo aplicaría no**. El selector no miente por sí solo — pregunta `check-if-able-to-omit`, que **sí** está en `develop` (viene del PR #982, la API de firma previa) y responde `RKV26000`. Lo que falta es todo lo que viene después.

Es la peor combinación posible para depurar: **la única pieza desplegada es la que hace visible el selector**. Todo lo que lo haría funcionar quedó afuera.

**Cómo se detectó.** Con `node dev/experian-api.ts <uReqId>`, que mide el veredicto de Experian **antes y después** de firmar sobre la misma solicitud: `check-if-able-to-omit` devolvió `RKV26000` (autorizado) pero la firma devolvió **HTTP 409 `URV13005`** — "User request status does not allow changing its flow" — sobre una solicitud en estado 9, que la rama sí admite. Ese desfase entre "el endpoint nuevo existe" y "la constante es la vieja" fue el hilo.

**Consecuencia práctica.** Ninguna prueba en dev/staging puede dar positiva hoy, por más limpio que esté el usuario o fría la caché. Hasta que el backend se despliegue, la validación va **contra el stack local** corriendo la rama (`CFE_TARGET=local`), donde el código sí tiene las tres piezas.

**Lección.** "Está mergeado" y "está desplegado en el ambiente contra el que pruebo" son afirmaciones distintas, y la segunda se verifica barata: `git show origin/develop:<archivo> | grep <lo que agregó la tarea>`. Vale hacerlo **antes** de armar el usuario de prueba, no después.

### F-64 · El "Recorrido del wizard" cambiaba de forma según el ambiente — y contra dev salía vacío por un error que el panel se comía

**Síntoma.** El mismo comercio dibujaba mapas distintos en `local` y en `dev`, como si la lógica del flujo dependiera del entorno. Contra dev el recorrido salía **directamente vacío** (solo el tronco), sin ningún error a la vista.

**Causa raíz verificada — son tres cosas encadenadas, no una:**

1. **La consulta moría en dev.** `dbops lenders-for` seleccionaba `COALESCE(l.product,'credit')`, pero **`lenders.product` no existe en dev** (la agrega una migración hoy aplicada solo en local). `COALESCE` no salva eso: maneja NULL, no una **columna ausente** — la consulta entera revienta con `Unknown column 'l.product' in 'field list'`.
2. **El panel se comía el error.** `/api/lenders` hacía `Array.isArray(lenders) ? lenders : []`, así que un `{error: …}` se normalizaba a lista vacía. El resultado era indistinguible de "este comercio no tiene entidades", y por eso el bug sobrevivió: **no fallaba, desaparecía**.
3. **El dibujo dependía de datos volátiles del ambiente.** Filtraba por `lender_status === 1` (un interruptor propio de cada base) y creaba **un carril por entidad** para la familia CreditopX — o sea que el padrón de cada ambiente cambiaba la cantidad de carriles. Incoherente además con el propio archivo, donde el **color** ya iba por producto con el comentario *"dos lenders del mismo producto recorren lo mismo"*.

**Arreglo (aplicado).**

- `bin/dbops.ts` — detecta la columna (`SHOW COLUMNS FROM lenders LIKE 'product'`) y degrada a `NULL` si no está, en vez de tumbar la consulta.
- `panel/server.ts` — el `{error}` viaja al cliente como `msg` en vez de convertirse en `[]`.
- `panel/index.html` — **un carril por RECORRIDO**, con clave `rt + product + desvíos + extensiones`, y **sin** filtrar por `lender_status`: lo apagado se anota (`(apagado)` + carril con `opacity .35`) y el orden es estable (rt, producto). Además `#trenwarn` avisa lo que no se pudo dibujar: sin entidades, o sin `product`.

**Verificado en el panel** (mismo comercio, Motai):

| | entidades | carriles |
|---|---|---|
| `local` | 5 | `credit·8 \| renting·10 \| rto·10 \| Agregador·3 \| Estándar·1` |
| `dev` | 4 | `rt2·8 \| Agregador·3 \| Estándar·1` + aviso explícito |

Y con datos simulados de "otro ambiente" sobre el mismo comercio —orden invertido, una entidad apagada y una entidad **extra** que repite un producto— la firma estructural da **idéntica**. Antes, ese mismo caso agregaba un carril y borraba otro.

**Lo que queda como diferencia legítima:** dev no tiene la columna `product`, así que ahí los CreditopX no se pueden separar por producto y van en un carril. No se disimula — se avisa. La diferencia es de **datos**, y el panel ahora lo dice en vez de cambiar de forma en silencio.

**Regla que deja.** Un diagrama que se arma con datos del ambiente tiene que separar **estructura** (la lógica, estable) de **estado** (qué está prendido hoy, variable). Mezclarlos convierte una diferencia de configuración en una aparente diferencia de comportamiento — y eso manda a depurar el lugar equivocado. Vale para este mapa y para cualquier visualización del playground.

### F-65 · El sembrado headless registraba al cliente en el backend LOCAL aunque el target fuera dev

**Síntoma.** Con "Saltar a: Lenders" contra `dev`, el wizard moría con *"Error al obtener las opciones de financiamiento"* y, en el log del SSR, `GET /api/onboarding/loan-application/lenders-v2/{id}` → **500 `Attempt to read property "id" on null`**. Sistemático: tres corridas seguidas. Con "Saltar a: Monto" el mismo comercio andaba bien.

**Causa raíz verificada.** `pkg/config.ts` definía `mockUrl: env('E2E_MOCK_URL', 'http://localhost')`, y **`E2E_MOCK_URL` no está definida en ningún target** → `config.mockUrl` valía `http://localhost` en los **tres**. El sembrado headless (`dev/guided.spec.ts::seedHeadless`) llama a `${config.mockUrl}/api/onboarding/phone/register`, así que:

1. registraba al cliente sintético en el backend **LOCAL** (sail),
2. se traía un `users.id` de la **base local** (siempre el mismo: 1828501, porque el scrub de dev no la toca),
3. e insertaba el `user_request` en la base de **DEV** con ese id ajeno.

Resultado: solicitud **huérfana**. `lenders-v2` la encuentra, hace `->user->id` sobre null y tira 500. Se confirmó de los dos lados: el usuario 1828501 **existe en local** con el teléfono de bypass y **no existe en dev**, donde ningún usuario tenía ese teléfono.

Solo se veía en el atajo headless: por el camino visual el cliente lo crea el wizard real, que sí apunta al backend del target.

**Arreglo (aplicado).**

- `pkg/config.ts` — `mockUrl` sale de la cadena por target: `E2E_MOCK_URL` (override explícito para un backend mockeado) y si no, `E2E_API_BASE_URL` sin el sufijo `/api`. Verificado: `local → http://localhost`, `dev` y `staging → http://legacy-backend.inertia-develop`. Y el register contra dev devolvió `1827708`, que **sí** está en la base de dev.
- `dev/guided.spec.ts` — antes de insertar el `user_request` se comprueba **contra la BD** que el usuario exista; si no, aborta e imprime el id devuelto, si hay alguien por teléfono y la **respuesta cruda del register**. Sembrar sin esa comprobación convertía un error de configuración en un 500 opaco cinco minutos de cold-boot después.

**Familia.** Es el mismo patrón que F-59 (`bin/asesor` leyendo `.env.$TARGET` a mano) y que F-64 (`/api/lenders` tragándose el error): **un default que parece inofensivo — `'http://localhost'` — enmascara la ausencia de configuración por target**. Regla: si un valor depende del ambiente, sale de la cadena (`env()`/`envget`); un fallback a localhost es aceptable solo cuando localhost ES la respuesta correcta para ese target.

**Deuda menor.** El nombre `mockUrl` ya no describe lo que es (viene del mock-server :4000, eliminado). Hoy es "el backend del target"; renombrarlo evitaría la próxima confusión.

### F-66 · El salto headless a `/lenders` "rebotaba" en staging — no era el front ni el estado, era una carrera post-login del harness

Continúa F-65: aquélla arregló la solicitud huérfana; esto es lo único que quedaba abierto del salto directo.

**Síntoma.** Con "Saltar a: Lenders" contra `staging`, el wizard quedaba en `/merchant/<hash>/solicitar` en vez de abrir el listado. El propio harness lo reportaba como *"El front rebotó la solicitud sembrada — su estado no pasa el guard de /lenders"*. En `local` el mismo salto **sí** funcionaba.

**Causa raíz verificada — es el harness, no el front ni el estado.**

Primero se descartó el título del pendiente ("staging es otro build con otro guard"): `git -C frontend-monorepo diff HEAD origin/staging` de `routes.ts`, `routes/lenders-marketplace/available-lenders.tsx`, `layouts/default-layout.tsx` y `routes/auth/callback.tsx` da **vacío** — el flujo de `/lenders` es idéntico en la rama y en el build desplegado (`origin/staging` @ `e896abaf`, que ya incluye la feature #719). Y ninguno de los **dos** loaders que corren en `/merchant/:hash/:ur/lenders` mira `user_request_status_id`: `default-layout` solo rebota si la sucursal del asesor ≠ el hash de la URL (acá **coinciden**, ambos `76db47f5`, probado por el `↪ 302 /merchant → /merchant/76db47f5/solicitar`), y el loader de `available-lenders` no tiene un solo `redirect`. El estado 9 nunca fue lo que rebotaba — por eso local, con el mismo estado, anda.

Lo que pasa es una **carrera post-login**:

1. Sin sesión de app cacheada (staging), el primer `goto` a `/lenders` rebota al Hosted UI de Cognito.
2. `cognitoLogin` volvía apenas la URL tocaba el host de la app (`waitForURL(hostPattern)`, un regex de **host**), es decir en una ruta de **tránsito** (`/auth/callback` → `/merchant` → `/solicitar`) **antes** de que la cadena terminara y el `Set-Cookie` de sesión se asentara.
3. El harness disparaba entonces el segundo `goto` a `/lenders` **con la cadena del callback aún en vuelo**. Ese goto tenía `.catch(() => {})`: Playwright lo abortaba por navegación en curso y el error se tragaba. La cadena del callback ganaba y dejaba el browser en `/solicitar`. **Nunca se emitió un `GET /lenders` que completara.**
4. `waitForURL(/lenders/, 60s)` esperaba un `/lenders` que ya nadie iba a pedir → timeout → quedaba en `/solicitar`.

**Evidencia.**

- En el log de la corrida **no aparece** ningún `↪ 3xx …/lenders → …/solicitar` (el response-listener de `guided.spec.ts` lo habría impreso). Solo el `↪ 302 /merchant → /merchant/76db47f5/solicitar`, que es el aterrizaje normal del callback ⇒ el server **no rebotó** `/lenders`.
- El `.auth/cognito-state.staging.json` reescrito durante la corrida contenía **solo cookies del dominio de Cognito** (`auth.merchant.creditop.com`), **ninguna del dominio de la app** — la foto del `storageState` se tomó en tránsito, antes de que existiera la sesión de app. Eso además dejaba el cache de staging **inútil**: nunca evitaba el login → siempre re-caía en la carrera (círculo).
- En local no ocurre: la sesión está cacheada, el único `goto` va directo a `/lenders`, sin login ni cadena de callback.

**Arreglo — parte 1: el salto ya llega (aplicado y verificado en vivo).**

- `pkg/cognito.ts` — tras el submit, `cognitoLogin` espera a **salir de las rutas de tránsito** (`AUTH_TRANSIT = /^\/(auth\/callback|merchant)\/?$/`) y a `networkidle` antes de volver, para no dejar redirects en vuelo.
- `dev/guided.spec.ts` (bloque `DIRECT_LENDERS`) — se separó el login del salto: primero `cognitoLogin` (que ahora descansa), y recién después el `goto` a `/lenders` **con reintento** (hasta 3, esperando un destino real), en vez de un único goto con catch vacío.
- Diagnóstico honesto: un flag `lendersBounced` (lo prende un 302 real `/lenders → /solicitar`) distingue "el front lo rechazó" de "el salto ni se pidió". El mensaje viejo asumía siempre lo primero.

Con esto la corrida del 2026-07-22 (uReq 464365) llegó: `entrada DIRECTA → /merchant/76db47f5/464365/lenders`.

**Segunda capa: por qué IGUAL se ve `/solicitar` durante el login.** Cuando el harness tiene que loguear, el aterrizaje post-login es `/solicitar` — no por el harness, sino por el **front**: `routes/auth/callback.tsx` hace `redirectTo = url.searchParams.get("redirectTo") || "/merchant"`, pero Cognito devuelve el destino en el `state`, no en un query `redirectTo`, así que **siempre cae en `/merchant` → `/solicitar`**. El `redirectTo` del deep-link se pierde. La única forma harness-side de no verlo es **no loguear**: reusar la sesión cacheada.

**El cache SÍ retiene la sesión — el diagnóstico inicial buscaba el nombre equivocado.** Primero se creyó que el `storageState` no guardaba la sesión, porque no aparecía `__session` (el nombre en el build local: `session.server.ts` → host-only). **Pero el deploy de staging llama a esa cookie `_session`** (UN guión bajo, `@.creditop.com`, compartida entre subdominios). El `storageState` sí la guardaba; filtrar por `__session` daba un falso "el cache no autentica". Por eso la validez NO se chequea por nombre de cookie sino por **fetch real** (abajo). Verificado: `.auth/cognito-state.staging.json` tras un pre-login tiene 8 cookies **incluida `_session`**.

**Arreglo — parte 2: reuso de sesión + pre-login (aplicado y verificado).**

- `pkg/cognito.ts::persistCognitoState()` — da `expires` (+7 días) a las *session cookies* (Playwright las serializa con `expires:-1` y puede descartarlas al restaurar) y escribe el `storageState`; `dev/guided.spec.ts` lo re-persiste **ya en `/lenders`** (autenticado). El cache queda con la sesión (`_session`) buena.
- `dev/warm-session.spec.ts` — **pre-login**: `cognitoLogin` + `persistCognitoState`, sin correr un flujo. **Headless en dev/local; HEADED en staging** (ver el gotcha abajo). Se corre una vez cuando el token caducó; después toda corrida arranca autenticada (sin login → sin `/solicitar`). Además `persistCognitoState` **descarta las cookies `oauth2:*`** (state CSRF efímero del handshake) para que el cache no las acumule (se vieron 5 juntas de logins a medias).
- `bin/session-check.ts` — chequeo REAL por target: pega a `/merchant` del front con las cookies del cache (`redirect: manual`) y mira si rebota a Cognito. **No filtra por nombre de cookie** (staging=`_session`, local=`__session`): la verdad es si el front deja pasar.
- **Panel** (`server.ts` + `index.html`) — dot en cada botón de ambiente: **verde** = sesión válida, **gris** = caducó/no existe/no verificable (clic → pre-login con loader ámbar). Endpoints `GET /api/session-status` (cacheado 60s) + `POST /api/session-refresh`.

**El diagnóstico "staging bloquea headless" también era FALSO — la causa raíz real era otro matcheo por substring.** El warm de staging "quedaba colgado en `/verifyPassword`" headless Y headed, incluso con contexto limpio. Una traza navegación-por-navegación (`response` + `framenavigated`) mostró la verdad: las URLs del Hosted UI llevan el host de la app **adentro del query** (`redirect_uri=https%3A%2F%2Foriginaciones-stg.dev.creditop.com…`), y `hostPattern` — un regex del host testeado contra el **href** — matcheaba eso **en la propia página del password**. Consecuencia: el "esperá a volver a la app" post-submit se satisfacía a los **0 segundos**, con el auth todavía en vuelo. Nadie esperó nunca el login real de staging:

- El warm declaraba "colgado" y fotografiaba el spinner de un auth que iba a completar segundos después.
- El goto siguiente de una corrida **interrumpía el auth en vuelo** → rebote a `/login` → Cognito otra vez (con el retry del salto, en LOOP: el usuario veía la pantalla de Cognito repetirse) — y cada vuelta acuñaba una cookie `oauth2:*` más (se encontraron 5 juntas: la huella del loop).
- En dev no se notaba: su pool (`login.creditop.com`) no contiene el host de la app como substring del query en la página del password de la misma forma, y la sesión solía estar cacheada.

**Arreglo (el de verdad):** `pkg/cognito.ts` compara `url.host === returnHost` (predicado de URL), no un regex contra el href. Con la espera real, el warm de staging completa **HEADLESS en ~29s** con `_session` en el cache — se revirtió el modo headed del panel: los tres targets se autentican sin ventana. Además `persistCognitoState` descarta las `oauth2:*` (state CSRF efímero) para no arrastrar handshakes muertos.

**Panel (cierre de la UX):** al abrir, el panel **chequea los 3 ambientes y pre-autentica** los que estén sin token (`missing`/`invalid`; `unreachable` no — front caído no es warmeable ni bloqueante). **"Preparar + Lanzar" queda deshabilitado** mientras el token del target activo se obtiene ("obteniendo token…") o falta ("sin token", apuntando al dot); con el dot verde se habilita y la corrida entra directa, sin ver Cognito ni `/solicitar`.

**Estado: RESUELTO y verificado en los tres targets** — `session-check` staging → `valid`, dot verde, warm headless reproducible; gating del botón verificado en sus tres estados (warming/missing/valid).

**Lección.** Las CUATRO pistas falsas de este finding comparten raíz: **conclusiones sacadas de un síntoma sin traza**. (1) "el estado 9 no pasa el guard" — el guard no mira el estado. (2) "staging es otro build" — diff vacío. (3) "el cache no retiene la sesión" — la retenía con otro nombre (`_session` vs `__session`). (4) "el Managed Login bloquea headless" — nunca se esperó al login. Y las DOS causas reales fueron **matcheos por substring donde había que comparar estructura**: el nombre de la cookie (3) y el host en el href (4) — `redirect_uri` mete el host de la app en CUALQUIER URL de Cognito, así que un regex de host sobre el href es un bug latente en todo harness OAuth. Verificá con un request/traza real ANTES de concluir; emparenta con F-03 (el fallo silenciado) y F-65 (el default que enmascara).

### F-67 · El salto a `/lenders` se colgaba 90s en staging — no era la inserción del sintético, era `domcontentloaded` esperando el stream de pre-aprobaciones

Continúa F-66: aquélla logró que el salto **llegue**; esto es por qué, ya llegando, la corrida tardaba ~140s y moría.

**Síntoma.** "Saltar a: Lenders" contra `staging`: la corrida duraba 141s y caía con `page.goto: Timeout 90000ms exceeded` en el salto a `/lenders` (`guided.spec.ts`). Se leía como *"la inserción del usuario sintético es lentísima en staging"*.

**Causa raíz verificada — no es la inserción, es el `waitUntil` del salto sobre una página que streamea.**

La inserción tarda **~1s**. Timestamps de `.runs/` (uReq 464379): la corrida arranca `18:12:30`, la 1ª fila cae `18:12:44` (14s de arranque de Playwright + browser + cargar sesión + lookup del asesor), y **las otras 6 filas del `synthFill` caen todas en `18:12:45`** — un segundo para todo el sembrado. El resto hasta `18:14:52` (141s) se lo come el `goto` a `/lenders`, que expira a los 90s.

Por qué se cuelga el `goto`: `/lenders` **streamea** (`entry.server.tsx:59` → `renderToPipeableStream`, `streamTimeout=240_000` en staging, `:15`) y el loader de `available-lenders.tsx` **no espera** las pre-aprobaciones — las arma como promesas (`loanOptionsPromise` → `fetchLenderPreApproval` por cada lender rt≠0, `VITE_PREAPPROVALS_ENDPOINT` → API externa de cada lender) y las resuelve vía `<Await>` en el componente. Con streaming, `DOMContentLoaded` no dispara hasta que **cierra el stream**, y el stream no cierra hasta que resuelven esos `<Await>`. El salto pedía `waitUntil: 'domcontentloaded'` → esperaba, de hecho, a que las 5 pre-aprobaciones rt≠0 (Welli #23, Welli Risk #166, BdB #5, Meddipay #39, Credifamilia #24) contestaran desde proveedores reales, con un usuario sintético que no existe en sus sistemas → >90s → timeout.

**El enmascarador: la "Confirmación de cupo" lo tapaba.** Con `flow_id=2` el backend recortaba el listado a **solo rt=0** (F-62/F-66: `LenderListingController`), así que `eligibleLenders` (los rt≠0) quedaba vacío → **cero pre-aprobaciones** → el stream cerraba al toque → `domcontentloaded` disparaba en segundos. Al sacar la confirmación de cupo del panel (flujo estándar, "sin firmar"), volvieron los 5 rt≠0 y con ellos el cuelgue. El veredicto de la corrida que falla dice `flujo: sin firmar`; el de las que entraban rápido, `flujo: 2`. Esa es la única variable que cambió, y es justo la que gobierna si hay pre-aprobaciones.

**Evidencia.** Timestamps en `.runs/ultima-corrida.json` (arriba). Código: `guided.spec.ts` goto con `domcontentloaded`/90s; `available-lenders.tsx:160-251` (pre-aprobaciones diferidas en `loanOptionsPromise`, consumidas con `<Await>`); `entry.server.tsx:15,59` (streaming + `streamTimeout` 240s en staging); recorte a rt=0 por `flow_id=2` en F-62/F-66.

**Arreglo (del harness, no del front — el front streamea a propósito, es buena UX).** `guided.spec.ts` (bloque `DIRECT_LENDERS`, salto + retry): `waitUntil: 'domcontentloaded'` → **`'commit'`** (timeout 90s → 30s). `commit` resuelve apenas el server responde (post-302 de sesión), sin esperar el stream: la página se pinta sola y la maneja el usuario, y quien confirma el aterrizaje es el `needsCognito()`/`waitForURL(/lenders|solicitar/)` de después, no el `waitUntil`. El comentario del salto deja escrito el porqué, para que nadie lo revierta a `domcontentloaded` "por seguridad".

**Estado: aplicado, type-check limpio. Las PIEZAS están verificadas (código + timestamps); el mecanismo integrador —que el cuelgue de 90s sea exactamente el stream de pre-aprobaciones y no un `await` bloqueante del shell (`getAlliedThemeUc`/`captureAnalyticsEventServer`)— se apoya en la eliminación (esos colgarían con o sin `flow_id=2`, y con `flow_id=2` la corrida entraba) pero NO se confirmó en vivo con una traza de red de la corrida colgada. Se cierra del todo cuando la próxima corrida con `commit` entre a `/lenders` en segundos.**

**Lección.** Un `waitUntil: 'domcontentloaded'` sobre una ruta con streaming SSR no espera "que cargue la página" — espera que **cierre el stream**, o sea todo lo diferido (acá, llamadas a proveedores externos). Para "ya navegué, la ventana es del usuario" el evento correcto es `commit`. Y el patrón que se repite desde F-66: un cambio aguas arriba (sacar la firma) **destapó** un costo que otra cosa venía absorbiendo — el "de repente está lento" casi nunca está donde uno mira primero (la inserción); la traza con timestamps lo ubicó en un segundo.

### F-68 · El guiado AUTO de Motai renting/rto nunca pasaba por Ábaco — lo salteaba el driver del harness, no la des-motaización

**Síntoma.** `bin/asesor motai auto` con un lender renting/rto (Motai R #169 / RB #170) cerraba en Estado 11 pero **sin pasar nunca por Ábaco**: la ventana B iba confirmation → first-payment directo, sin `/abaco/platforms` ni `/platform-otp-validation`. Se leía como *"la des-motaización rompió el trigger de Ábaco"* (antes se disparaba por modo `isMotaiRenting`; ahora por `lenders.product`).

**Causa raíz verificada — es el DRIVER del guiado, no el producto.**
- El trigger por-producto **funciona**: diagnóstico en el punto de confirmación → el uReq ya tiene el lender del producto en `user_requests.lender_id` y `check-abaco-requirement` da **MOTV1001** (`[diag Ábaco] lender_id=170 product=rto → REQUERIDO`). La regla `in_array(lender.product, ['renting','rto'])` de `MotaiValidationService` es correcta.
- El driver GUIADO (`guided.spec.ts`, bloque CreditopX de B) hacía `B.goto('.../first-payment-date')` **incondicional** tras confirmation — salteando el "Continuar" de `/confirmation`, que es donde vive el redirect a Ábaco (`loan-confirmation.tsx` action → check-abaco REQUIRED → `/abaco`). El `wakeB` del path MANUAL sí tenía la rama de Ábaco; el GUIADO (otro código) no.

**Red herring que costó tiempo.** El uReq FINAL quedaba con `lender_id=77` (CrediPullman, product=credit) → parecía *"el producto no llega a lender_id"*. Pero eso lo ponía el safety-net `closeCreditopX(uReq, {})`, que **defaulteaba a credipullman** y pisaba el lender real al cerrar por backend — pasa DESPUÉS de confirmación, no afecta el check. En confirmación el lender_id es el correcto (170).

**Evidencia.** El `[diag Ábaco]` (lender_id/product/pideAbaco) en confirmación; las corridas que saltaban confirmation→first-payment sin `/abaco`; `guided.spec.ts` (goto directo a first-payment); `loan-confirmation.tsx:194-206` (redirect a /abaco en el action); `MotaiValidationService` (requirement por product); `pkg/close.ts:54` (default credipullman).

**Arreglo (del harness, no del front).** `guided.spec.ts`: si el producto pide Ábaco, en vez del salto se clickea "Continuar" → `/abaco` y se AUTO-MANEJAN las pantallas gig (plataforma → credencial → Guardar → Continuar → OTP → verificar); el mock-abaco aprueba cualquier credencial/OTP (`/login` basta con success, `/results` da el fixture en local). `pkg/close.ts`: el safety-net usa el `lender_id` real del uReq (leído de la BD), sin default credipullman. Commits locales en playground.

**Estado: aplicado, type-check limpio. VERIFICADO que el guiado ENTRA a Ábaco (`/abaco → platforms → platform-otp-validation`) y cierra en Estado 11 (corrida uReq 464537, gig manejadas a mano). El AUTO-DRIVE de las pantallas gig (selectores uber/Guardar/Continuar/OTP) queda por confirmar en la próxima corrida hands-off.**

**Lección.** Hay DOS drivers de la ventana B (`wakeB` del modo manual + el bloque guiado en el cuerpo del test): arreglar la rama en uno no toca al otro. Y "el flujo saltea X" en un E2E semiauto casi siempre es el harness esquivando a propósito un muro no-automatizable (acá la captura ADO por foto), no el producto. El diagnóstico de 1 línea en el punto exacto de decisión (lender_id + check real) separó "regresión del producto" de "el harness no lo maneja" — que era lo que parecía y no era.

### F-69 · "Advisor validation error" en el `/continue` del asesor para lenders None-identity + Ábaco — un `validated=false` en una validación NO requerida

Destapado apenas el guiado empezó a RECORRER Ábaco (F-68): con el paso ya visible, la ventana del asesor mostró el error.

**Síntoma.** En un flujo Motai renting/rto (o cualquier **None-identity + Ábaco**), la ventana del **ASESOR** (`/continue`, variante `AbacoLoanContinueRouteContent`) muestra **"Los datos no pudieron ser validados para el cliente"** / `Error: Advisor validation error` — aunque el cliente (ventana B) cierra bien en Estado 11.

**Causa raíz verificada — bug de PRODUCTO, no del harness.** `ValidationStatusService::notRequiredValidationStatus` (backend, `Modules/Identity`) devolvía `validated=false` aunque `skipped=true` / `completed=true` / `status='not_required'`. Y el lado A (`loan-continue.tsx`, `hasAdvisorBusinessError`, ~línea 364) gatea con `data.ado && !data.ado.validated` **sin mirar `skipped`**. Para un lender None-identity (Motai, `identity_validation_type_id=1`), `resolveValidationType` ≠ `Ado` → `ado = notRequiredValidationStatus` (validated=false) → el asesor lo lee como "no validó" → error. **Como A pega al backend REAL (sin mock, a diferencia de B), esto ocurre también en producción**, no solo en el harness.

**Lo destapa la des-motaización.** Al poner Motai `product=renting/rto`, `check-abaco-requirement`=MOTV1001 → `isAbacoRequired=true` → el asesor cae en la variante Ábaco del `/continue` (antes, por modo, no caía ahí). El trigger de Ábaco está BIEN (F-68); lo expuesto es esa pantalla asumiendo validación de identidad (ADO) para un lender que es None-identity y no la pide.

**Evidencia.** Screenshot del asesor con "Advisor validation error"; `ValidationStatusService.php:330` (`notRequiredValidationStatus`, validated=false); `getValidationStatus:67-69` (`ado = notRequiredValidationStatus` cuando el tipo ≠ Ado); `loan-continue.tsx:359-366` (`hasAdvisorBusinessError` sin `skipped`); enum `IdentityValidationType` (`None=1`); Motai lenders con `identity_validation_type_id=1`.

**Arreglo.** `notRequiredValidationStatus` → `validated=true` (una validación no-requerida es una compuerta PASADA; el matiz "no se validó de verdad" queda en `skipped`/`status`). Aplica a `ado` y `crosscore` no-requeridos por igual. Commit en `feature/motai-clean-v2` de legacy-backend (junto a la des-motaización que lo expuso).

**Estado: aplicado. ValidationStatusServiceTest 22 passed (40 assertions); php -l limpio. Falta la confirmación E2E (el asesor deja de errorear y sigue a `financial-profile`) en la próxima corrida del guiado.**

**Lección.** El harness, al hacer que el guiado RECORRA Ábaco (F-68), destapó un bug de producto que el salto directo tapaba — el valor de un E2E no es solo "pasó/falló", es que *recorrer de verdad* un flujo expone lo que saltearlo esconde. Y la trampa semántica: `validated=false` para algo `not_required` hace que cualquier consumidor que gatee por `validated` trate un skip como fallo. Un booleano de "compuerta pasada" no debe ser `false` cuando la compuerta ni siquiera aplica.

### F-70 · La pantalla del asesor (`financial-profile`) muere con `fetch failed` en local — falta el MS financial-health (:4000) → mock que lee la BD real

El siguiente muro detrás de F-69: arreglado el "Advisor validation error", el asesor avanza a `financial-profile`… y el loader revienta.

**Síntoma.** En el `/continue` del asesor, al navegar a `financial-profile` (la revisión/decisión de Motai renting/rto): `TypeError: fetch failed` en `FinancialProfileRepository.getFinancialProfile` (`financial-profile.tsx` loader). Parece un bug del wizard; es infra local.

**Causa raíz verificada.** El loader SSR hace `POST {FINANCIAL_HEALTH_API_URL}/v1/financial-profile/me` (`financial-profile.repository.ts`). El `.env` del wizard trae `FINANCIAL_HEALTH_API_URL=http://localhost:4000` y **en local no corre ningún financial-health** (curl a :4000 → no conecta). El MS es externo al monorepo; nunca estuvo en la flota local. Reproducido por curl; mismo patrón que la sección B (env/servicio faltante con cara de bug de producto).

**Arreglo — `mock-financial-health` en la flota (harness).** Nuevo `mock-financial-health/server.ts` + `bin/mock-financial-health`, arrancado por `bin/asesor` en target `local` (junto a payvalida/mdm/lenders/forms/ábaco; el panel lo lista como `fin-health :4000`). Regla de diseño (pedida por Miguel): **no inventa datos** — lee el usuario sintético REAL de la BD local: `users` (nombre/doc/edad) · `user_field_values` 87/29 (ingreso/ocupación) · `user_summaries.datacredito` (score/negativos → `debtCapacityPercentage` derivado de `value_monthly_payment/ingreso`) · `user_summaries.abaco.average_income` → `monthlyInformalIncomeAmount` (el resultado real del flujo gig, si corrió). BD caída → **503 honesto**; uReq inexistente → 404. Ocupa el `:4000` que el `.env` del wizard ya apunta (cero cambios en el repo real); si el puerto lo usa otro proceso, el wrapper **corta con error** (chequeo de identidad `mock: financial-health`), no un "ya arriba" falso.

**Gotcha que ya mordió (para el próximo mock):** las columnas **JSON** de MySQL llegan por mysql2 **ya parseadas a objeto** — un `JSON.parse(valor)` sobre eso tira y un `catch → {}` silencioso deja los campos en null con cara de "no hay datos" (el primer curl devolvió `creditScore:null` con score=700 en la BD). Verificá contra `JSON_EXTRACT` antes de creerle a un null.

**Estado: aplicado y VERIFICADO por curl con un uReq real (score 700, negativos 0, debt 33%, 404/503 honestos). Falta verlo dentro del guiado (la pantalla del asesor renderizando el perfil).**

**Lección.** Detrás de un muro suele haber OTRO: F-68 (el guiado no recorría Ábaco) → F-69 (el asesor rebotaba por `validated=false`) → F-70 (el asesor no tenía financial-health en local). Cada arreglo corre la frontera de lo probable en local un paso más — y el inventario de la flota (README) es el mapa de esa frontera.

### F-87 · `bin/mock-* start` reusaba el proceso viejo: editabas el mock y seguía sirviendo la versión anterior

**Síntoma:** se corrige un mock, se vuelve a correr el panel, y el comportamiento es idéntico al de antes
del arreglo. Sin error, sin aviso: `✓ mock-bancolombia ya arriba (:8104)`.

**Causa raíz:** el `start` de los launchers decidía reusar mirando **sólo el modo fallo**
(`fail: 0|1`). Si el puerto respondía y el modo coincidía, salía por `exit 0` — y el proceso vivo tenía el
`server.mjs` **anterior** cargado en memoria (Node no recarga el módulo).

**Arreglo:** cada mock publica en `GET /` una huella de su propio código
(`codigo` = mtime en segundos de su `server.mjs`, vía `statSync(fileURLToPath(import.meta.url))`) y el
launcher la compara con el archivo en disco: si difieren, reinicia y lo dice
(«el proceso tiene código viejo en memoria»). Aplicado a `mock-bancolombia` (:8104) y `mock-corbeta`
(:8103), verificado con el ciclo start → start → `touch` → start.

**Parentesco:** es el mismo error de método que el log del wizard sin truncar (un artefacto viejo leído
como si fuera actual). Cuando un arreglo "no hace nada", **la primera pregunta es si lo que está corriendo
es el código que editaste** — no si el arreglo está mal.

---

### F-124 · El teléfono con prefijo NO estaba corrupto: E.164 es lo correcto. La hipótesis de «acumula prefijos» la refutó el dato

**Síntoma que se creyó ver.** Contando dígitos de `users.cell_phone` para clientes de comercios
dominicanos, apareció esto: 49 con 11 dígitos, 32 con 12, y hasta 15. Sólo 2 de 91 tenían 10 dígitos —
un número «nacional limpio». La lectura inmediata fue **«el campo acumula prefijos»**, y de ahí salió un
plan: normalizar el formato al guardar y arreglar a quien concatena.

**Lo que dijo el dato al separarlo bien** (prod, 2026-08-08). Dos cortes cambian la conclusión:

1. **Separar prueba de real** (`document_number` con letras = sintético). De 91, **57 son reales**.
2. **Mirar QUÉ hay después del prefijo**, no cuántos dígitos hay en total.

De los 33 clientes reales con 11 dígitos: **30 son `+1` + un móvil dominicano** (809/829/849) — o sea
**E.164 correcto**. El caso que se buscaba, «prefijo `+1` encima de un móvil colombiano», tiene **CERO
filas reales**. El ejemplo que lo sugería (`13023398616`) pertenece a un documento de prueba. Y los 17
de 12 dígitos son `+57` + móvil colombiano: también E.164 correcto.

**Causa raíz del error de lectura, que es lo que importa acá.** Se tomó *«tiene prefijo»* como
*«está contaminado»*. Es al revés: **`+18095551234` es la forma CORRECTA** de guardar un número
internacional (E.164). Contar dígitos y comparar contra el largo nacional mide la presencia del prefijo,
no la corrupción — y con dos países en juego, el largo nacional no es una vara.

**Lo que SÍ quedó confirmado, y es mucho menos:**

- **~6 clientes reales con basura al final**: `+573208088778000`, `+16892539592999`,
  `+168925395920909`, `+5731328044901`. Son E.164 válidos con 1 a 4 dígitos pegados después. Eso sí es
  malformado, y son 6 de 57.
- **`findByCellPhone` es `where('cell_phone', $exacto)`**
  (`Modules/Loans/App/Repositories/UserRepository.php:18`), comparación literal sobre una columna que
  guarda `+1 809…` (con espacio, del formulario dinámico), `+1809…` (sin espacio, del flujo IMEI),
  `809…` y `+57…`. El mismo cliente entrando por dos flujos **no se encuentra y se duplica**. El
  llamador intenta dos variantes (cruda y sólo-dígitos), lo que tapa el caso del espacio pero no los
  demás. ⚠ **Medido: 4 grupos de colisión, 9 usuarios — y los 9 son sintéticos** (teléfonos con sufijo
  `-t`/`-o`/`-t1`, documentos `74564456-t3`, `TEMP-916-…`). **Cero clientes reales duplicados.** Es un
  riesgo latente real, no un incendio.
- **Dos sitios del front concatenan y con formatos distintos**:
  `apps/loan-request-wizard/app/routes/dynamic/request-phone.tsx:171` y `:212` arman
  `` `+${countryCode} ${phone}` `` (**con espacio**), y
  `apps/loan-request-wizard/app/routes/imei/register-imei-action.server.ts:213` arma
  `` `${countryCode}${phoneNumber}` `` (sin espacio). El tercero,
  `modules/loan-request-wizard/consumer-hub/src/lib/infrastructure/phone-number.repository.ts:22`, manda
  `dialCode` **en su propio campo** — ése es el que está bien.

**Arreglo.** El único cambio que se hizo es el que se sostiene por sí solo, sin depender de esta
hipótesis: el default de `PhoneForm` deja de ser `+1` fijo y sale del país del comercio, porque el
formulario dinámico lo usa **Credifamilia** (lender 24, `form_type` 6, **colombiano**) y un cliente
colombiano veía el prefijo dominicano preseleccionado. **No** se escribió la normalización del formato,
y es deliberado: cambiar lo que se guarda con un lookup de comparación exacta es la forma de crear los
duplicados que hoy no existen.

**Cierre: los ~6 malformados TAMBIÉN eran de prueba.** El filtro «documento con letras» no los agarró
porque el padding fue **con dígitos**, y ahí está la firma: el mismo relleno aparece en los DOS campos a
la vez — documento `1558190300000` con teléfono `+16892539592999`, documento `15581903090909` con teléfono
`+168925395920909`, documento `123456555550`. Es la misma técnica de los sufijos `-t`/`-o`/`TEMP-`, con
dígitos en vez de letras: pegar relleno para que el usuario nuevo no choque con uno existente.

Y el corte por comercio lo confirma sin ambigüedad (prod, 2026-08-08):

| comercio | clientes | tel. malformado | doc. sospechoso |
|---|---:|---:|---:|
| **Carrefour** | 27 | **15** | 23 |
| **Comercio Prueba** | 11 | 3 | 9 |
| MAGGYSA | 31 | 1 | 16 |
| La Gracia Smartphone | 14 | **0** | 2 |
| Hot Tec | 10 | **0** | 4 |
| Gold Clave · 2blea · Multiservicios La Fe | 7 | **0** | 0 |

**Los cinco comercios de operación real tienen CERO teléfonos malformados entre 31 clientes.** Las 19
anomalías viven en Carrefour y «Comercio Prueba», que son el par de certificación del lanzamiento en
República Dominicana.

**Conclusión final: no hay ningún problema con el dato del teléfono de clientes reales.** El hilo entero
—«acumula prefijos», «hay que normalizar», «se duplican los usuarios»— era ruido de pruebas en
producción. El único cambio que sobrevive es el default de `PhoneForm`, que se justifica solo.

**Estado:** verificado el 2026-08-08 contra prod, con el corte por comercio.

⚠ **Y la tercera lección, la más incómoda: el documento de la tarea YA LO ADVERTÍA.** En su sección de
limpieza dice «2 comercios de prueba activos en producción, dentro del grupo dominicano — inflan
cualquier conteo por país». Estaba escrito y no se aplicó al medir. Antes de un censo sobre datos de
producción, **leer lo que ya se sabe de la contaminación de esos datos** — el corte que faltaba estaba
documentado, no había que descubrirlo.

⚠ **La lección, y es de método.** Un agregado (`COUNT` por largo) puede sostener una hipótesis falsa con
mucha convicción. Lo que la desarmó fueron dos cortes que había que *pensar*: **sacar los sintéticos** y
**mirar el contenido, no el tamaño**. Antes de proponer una migración de datos, hay que preguntarse qué
corte haría que la hipótesis se caiga — y correrlo. Acá el plan «normalizar el teléfono» habría tocado
57 filas reales para arreglar 6, con riesgo de duplicar clientes.

⚠ **Y un corolario sobre los datos de prueba en producción**: los sintéticos se marcan con sufijos en el
documento y en el teléfono (`-t`, `-o`, `TEMP-`), lo cual está bien pensado — pero **inflan cualquier
conteo por país o por formato**. Todo censo de este tipo tiene que filtrar `document_number REGEXP
'[^0-9]'` antes de concluir. Sin eso, acá el 38 % de las filas eran ruido.

---

