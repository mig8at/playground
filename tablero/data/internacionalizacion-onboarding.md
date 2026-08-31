---
id: 43
title: "Internacionalización de CreditOp"
stage: tasks
created: "2026-08-05T17:11:17-05:00"
context_nodes: [onboarding, dynamic-forms, merchants, entities, smartpay, hardcodes-entidades]
jira: [CORE-365]
jira_title: "Internacionalización de CreditOp"
ramas: pais-como-dato, pais-configuracion, pais/el-pais-es-configuracion, pais/backfill-del-default-historico, pais/reparar-columnas-de-documentos, pais/documentos-que-acepta-el-backend, pais/borrar-documentos-de-sucursal, pais/monto-y-telefono-en-solicitar, pais/el-largo-del-celular-en-el-flujo-dinamico
---

# Internacionalización de CreditOp

> **ESTADO (2026-08-27) — segunda tanda: el país sale del código.** Lo de abajo, del 19/8, es la PRIMERA
> tanda y sigue siendo cierto. Esto es lo que pasó después.
>
> **Los tres PRs del documento ya MERGEARON hoy** (medido con `make tareas-ramas N=71`), y quedan **dos
> abiertos**: el que se bloqueó a propósito y uno nuevo que salió de probar BCP. ⚠ **Producción todavía
> no tiene NADA de esta segunda tanda** — verificado en `main` de los tres repos.
>
> | PR | destino | estado | qué |
> |---|---|---|---|
> | `legacy-backend` #1220 | `qa` | ✅ mergeado 27/8 | el documento lo dicta la ENTIDAD; selector y validador leen lo mismo |
> | `legacy-application` #83 | `develop` | ✅ mergeado 27/8 | el gemelo |
> | `frontend-monorepo` #889 | `qa` | ✅ mergeado 27/8 | resolvedor de país compartido, moneda del monto, largo del documento |
> | `frontend-monorepo` #900 | `qa` | 🔵 abierto | el largo del celular manda también en el flujo dinámico (**bloqueo de Perú que estaba vivo en `qa`**), y el campo avisa cuando recorta |
> | `legacy-backend` #1225 | `qa` | ⛔ **BLOQUEADO a propósito** | borra la columna de la sucursal, y tres ramas desplegadas todavía la leen |
>
> **La prueba de que sirve:** el comercio dominicano **cierra una solicitud entera con `CED`** y el
> colombiano con `CC`. Antes los dos terminaban marcados como colombianos.
>
> 📄 **El detalle vive en dos archivos hermanos, y no se copia acá para que no se desincronice:**
> `tablero/data/pais-fuera-del-codigo.md` (la ejecución: el modelo de país, el orden por ambiente, el
> registro día por día) y `tablero/data/lo-que-queda-de-pais-quemado.md` (el censo de lo que todavía
> asume Colombia, con sus mediciones contra producción). Los dos tienen su §«Registro» al día.
>
>
> 📐 **Prototipo del documento genérico** (2026-08-27): `tablero/data/artifacts/internacionalizacion-onboarding.tarjeta-identidad.html`
> — la tarjeta de identidad **sin país** que reemplaza a `IdBack` (reverso de la cédula colombiana) y
> `PepCard` (PEP). Un archivo, sin dependencias, editable en vivo; se ve con `make soporte-qa`, que sirve
> esa carpeta. Estructura tomada de ICAO 9303 TD1. La ficha de los dos componentes que reemplaza y el
> hallazgo de la MRZ están en `tablero/data/lo-que-queda-de-pais-quemado.md`.
>
> ⚠ **Y un bloqueante de Perú que no cabe en estos PRs:** el número de documento es único en TODA la
> tabla, sin mirar tipo ni país. **84.656 DNI peruanos ya están ocupados** por documentos colombianos de
> 8 dígitos. Está medido en el archivo del censo.

> **estado (2026-08-19, tarde):** el trabajo está hecho en los tres repos; lo que está desordenado es
> **dónde quedó cada pieza**. Abajo, en §«Las ramas de esta tarea», está la única tabla que hay que
> mirar. Resumen: **las TRES piezas mergeadas y desplegadas** — backend y admin en `develop`, front en
> `staging`. El merge del admin a `main` que se hizo por afán quedó como percance registrado (abajo), y
> **sigue sin llegar a producción porque ese repo despliega por TAG**. Lo que sigue son las pruebas, y
> **contra qué ambiente correrlas no es obvio**: ver §«Dónde se prueba esto».
>
> ⚠ **El percance del admin (19/8): `legacy-application` #50 se aprobó y mergeó a `main`.** Verificado
> que **no rompe nada** —el detalle medido está en la bitácora del 19/8 (2)— y que **todavía no llegó a
> producción**: ese repo despliega a prod **por TAG** (`main-prod.yaml`, `on: push: tags`), y ningún tag
> contiene el commit; prod sigue en `v1.0.27`. Pero cuando alguien taguee, **sale**. Que el tag caiga
> después de las pruebas es ahora una condición de la tarea, no un detalle.
>
> ✅ **El front ya está listo para mergear, y no se mergea por decisión, no por impedimento.**
> El bloqueante era Sonar (`typescript:S6759` sobre la firma de `PhoneForm`), **arreglado y pusheado el
> 19/8**: check en `SUCCESS`, `reviewDecision: APPROVED` (la aprobación **sobrevivió al push** porque el
> ruleset tiene `dismiss_stale_reviews_on_push: false`) e hilo de revisión **resuelto**. El mismo arreglo
> le falta a la rama de `main` (#785), si esa rama sobrevive.
>
> ⚠ **Pero el botón de merge no lo tiene Miguel.** #834 sigue en `BLOCKED` con todo satisfecho, y la
> causa está medida: el ruleset **«main»** del repo cubre `~DEFAULT_BRANCH` **y `refs/heads/staging`**,
> trae la regla `update` (restringe quién actualiza la rama) y tiene **cero `bypass_actors`**. La cuenta
> `mig-creditop` tiene `push` pero no `maintain` ni `admin`. Histórico consistente: los últimos 6 merges
> a `staging` los apretó **OscarRinc** (uno yamid). O sea que cuando toque mergear, **hay que pedirlo**.
>
> ⚠ **El admin (`legacy-application`) no tiene ambiente de staging**: ese repo solo tiene `develop` (dev)
> y `main` (prod) — ni rama ni workflow `stg`, ni referencia a un servicio `-stg`. Los dos criterios de
> aceptación del selector de ciudad **no se validan en staging**; van en dev, y ya tienen con qué porque
> dev y staging comparten la BD y las ciudades de RD quedaron sembradas. Su deploy de dev **sí está
> vivo** (`main-dev.yaml` desde `develop`, última corrida `success` el 12/8).
>
> ⚠ **Pero el `develop` del front está CONGELADO** — último commit 2026-07-03, **267 commits detrás de
> `main`**, y `loans-dev.yaml` no corre desde esa misma fecha. Mergear el wizard ahí desplegaría a dev un
> build de hace mes y medio + el cambio de países. **Y no hace falta:** `harness/.env.dev` levanta el
> wizard **local** (`E2E_BASE_URL=http://localhost:5174`) contra la API de dev, que ya trae el `country`.
> El front se valida contra dev **sin mergear nada**; su merge de ambiente es `staging` (#834).
>
> ⚠ **`qa` y `staging` son DOS ramas divergentes y vivas**, y **Motai vive solo en `qa`**. Por eso el
> cherry-pick a `staging` entró limpio y a `qa` choca en `AlliedInfoController` (Motai agregó
> `allowed_document_types` en el mismo hueco del array donde países agrega `country`). Trampa asociada:
> `harness/.env.staging` apunta a `legacy-backend-qa`, que es **la rama equivocada** para verificar esto.
>
> La tarea **llega** por SmartPay (RD), pero el objetivo real es que el onboarding sea multi-país por
> **filas de configuración** y no por forks: **celular** (prefijo/longitud/validación), **tipos de
> documento** y **mensajes** (copy, plantillas, moneda y formatos).
>
> Esta tarea es la **única** del tema: la que llevaba el detalle repo-por-repo se eliminó el 2026-08-09 y
> lo que valía se absorbió acá (§Material de QA y backlog). Se recupera con
> `git show d84bd0f:tablero/data/smartpay-multipais-country-pack.md`.

## Las ramas de esta tarea

**Esta es la lista buena.** A propósito **omite las ramas anteriores** (`feature/pais-como-dato` en los
tres repos y `feature/pais-como-dato-onto-staging` del backend): existieron, algunas siguen abiertas
como PR, pero **no son el camino** y tenerlas a la vista es lo que causó el desorden. Si un PR viejo
estorba, se cierra; no se mergea.

| repo | rama de trabajo | va contra | estado |
|---|---|---|---|
| `legacy-backend` | `feature/pais-como-dato-onto-develop` | **`develop`** | ✅ **mergeada** (PR #1126, 18/8) y desplegada a dev |
| `legacy-application` | `feature/pais-como-dato-onto-develop` | **`develop`** | ✅ **mergeada** (PR #68, 19/8, la mergeó Miguel sin revisión: `develop` no tiene ruleset) |
| `frontend-monorepo` | `feature/pais-como-dato-onto-staging` | **`staging`** | ✅ **mergeada** (PR #834, 19/8 15:22, la apretó sanvipi-ctop) y desplegada a `loan-request-wizard-stg` |

**Segunda tanda — «el país es configuración» (2026-08-24).** El detalle vive en la tarea
`pais-fuera-del-codigo.md`; acá queda el estado de las ramas para que esta tabla no mienta.

| repo | rama de trabajo | va contra | estado |
|---|---|---|---|
| `legacy-backend` | `feature/pais-desde-el-comercio` | `develop` | ✅ **mergeada** (PR #1191, 24/8) y desplegada a dev |
| `legacy-backend` | **`feature/pais-configuracion`** | **`qa`** | 🟡 **PR #1193 abierto**, un commit, esperando aprobación |
| `legacy-application` | **`feature/pais-configuracion`** | **`develop`** | 🟡 **PR #80 abierto**, un commit, esperando aprobación |

⚠ **La corrección de rumbo del 24/8: `develop` NO es el camino.** Medido: en `legacy-backend`,
`develop` está **332 commits detrás de `main`** mientras `qa` está a **11/8** — o sea al día. En
`frontend-monorepo` es peor: `develop` a 433. Y el historial muestra que **`main` se alimenta de ramas
de feature directamente**, no de qa ni de develop: `qa`, `develop` y `staging` son **ambientes**, no
etapas de un flujo. Por eso la segunda tanda va desde **`qa`**.

⚠ **Excepción: `legacy-application` NO TIENE rama `qa`.** Sólo `develop` y `main`. Ahí la base sigue
siendo `develop`.

⚠ **Y `dev`, `qa` y `staging` son UNA SOLA base de datos** (mismo host, mismo schema): una migración se
corre una vez y sirve para las tres. Prod tiene la suya, y **sus ids de entidad NO coinciden** — 12 ids
son entidades distintas en cada base (el 152 es Refurbicredit en prod y smartpay en dev), así que
ninguna corrección de datos se copia de una a la otra.

**Ramas anteriores que quedaron sin camino** (no se mergean; si un PR viejo estorba, se cierra):
`feature/pais-desde-el-comercio-onto-qa` (reemplazada por la consolidada, PR #1192 cerrado) y el
PR #79 de `legacy-application` (cerrado, reemplazado por el #80).

**Por qué cada uno va a donde va:**
- **backend → `develop`**: es el ambiente compartido donde el equipo prueba, y sus 3 migraciones ya
  están aplicadas ahí (dev y staging comparten BD, así que sirvieron para los dos).
- **admin → `develop`**: `legacy-application` **no tiene staging** —sólo `develop` (dev) y `main`
  (prod)—, y su deploy de dev está vivo. `develop` no tiene commits propios (es subconjunto de `main`),
  así que el cherry-pick entra limpio.
- **front → `staging`**: su `develop` está **congelado** desde el 2026-07-03 (267 commits detrás de
  `main`, `loans-dev.yaml` sin correr), así que mergear ahí no pondría el cambio «en dev»: publicaría un
  build de hace mes y medio. Y no hace falta, porque el harness levanta el wizard **local** contra la
  API de dev, que ya publica `country`.

### Dónde se prueba esto (medido el 2026-08-19, después de mergear las tres)

**El wizard de staging NO habla con el backend de staging.** `loans-stg.yaml` construye
`loan-request-wizard-stg` con `VITE_API_URL=http://legacy-backend.inertia-develop` — o sea el servicio
de **dev**, exactamente el mismo que usa el wizard de dev. El servicio `legacy-backend-stg` (que sirve
la rama `staging`) **no es** lo que responde detrás del wizard desplegado en staging.

Eso resuelve el rompecabezas: **la pareja que sirve hoy es «front de `staging`» + «backend de
`develop`», y las dos mitades tienen el cambio.** Se puede probar de punta a punta ya.

⚠ Corolario incómodo: el port del backend a `staging` (#1121), que costó un día de trabajo, **no es lo
que sirve al wizard de staging**. Alimenta a `legacy-backend-stg`, un servicio aparte. No estuvo de más
—deja `staging` coherente consigo mismo— pero no era el camino crítico.

⚠ Y esto sale de los **build args** del workflow: un secreto de runtime (`dev/loan-request-wizard-stg`)
podría sobrescribirlo. Confirmarlo empíricamente en la primera corrida antes de sacar conclusiones de un
resultado raro.

**🔴 La trampa que va a morder: `E2E_TARGET=staging` del harness NO es staging.** Apunta a
`legacy-backend-qa` (rama **`qa`**) y a `originaciones-qa.dev.creditop.com` (el front de **`qa`**). El
commit de países **no está en `qa`** y encima **choca** ahí. Correr las pruebas con ese target mide la
rama equivocada y va a parecer que el cambio no funciona.

| qué probar | dónde | por qué |
|---|---|---|
| **wizard** (celular, prefijo, país) | wizard desplegado de `staging`, **o** wizard local `:5174` con `E2E_TARGET=dev` | el front de `staging` y el backend de `develop` tienen los dos el cambio |
| **admin** (selectores de ciudad) | **dev** (`main-dev.yaml`, desplegado `success` el 19/8) | `legacy-application` no tiene staging, y dev comparte BD con staging: las ciudades de RD ya están sembradas |
| ~~`qa`~~ | **no** | el commit no está ahí y choca al portarlo (Motai) |

📌 **Dato que falta:** la URL pública del servicio `loan-request-wizard-stg` no está escrita en ningún
lado del playground —lo único documentado es `originaciones-qa.dev.creditop.com`, que es **qa**—. Hay
que averiguarla y anotarla acá, o probar con el wizard local contra dev, que ya funciona.

### El desorden, dicho sin adornos (retrospectiva del 19/8)

Las tres ramas se cortaron **de `main`** y se apuntaron **a `main`**, que era lo cómodo pero no lo
correcto: `main` es producción y esta tarea todavía no está probada. De ahí salió todo lo demás.

1. **`legacy-backend`** debió nacer **en `develop`** desde el principio. En vez de eso salió contra
   `main` y después se portó **también a `staging`** (#1121) — un ambiente de más, con su propio port y
   su propia verificación. Trabajo duplicado por no haber elegido el destino al empezar.
2. **`frontend-monorepo`** también salió contra `main`. Debió nacer **en `staging`**. Hoy ya está bien
   parado ahí (#834) — pero llegó por un segundo port, no de entrada.
3. **`legacy-application`** debió nacer **en `develop`**. Salió contra `main` y, por afán, **se aprobó y
   mergeó ahí** el 19/8. Es el único de los tres que terminó en una rama de producción.

**La lección, para que sirva la próxima:** *el destino de la rama se elige ANTES del primer commit, y el
destino de una tarea sin probar nunca es `main`.* La convención `<rama>-onto-<ambiente>` que el repo ya
usa es el parche, no el plan — sirve para portar algo que ya existe, no para decidir a dónde va.

## Contextos que usa
- **onboarding** — el journey que hay que parametrizar: entrada por hash de sucursal → celular/OTP → nace la
  `user_request` → formulario personal/laboral. El gate de país está en el loader de la pantalla de celular.
- **dynamic-forms** — la generación **G1 es el fork de RD** ("dynamic" quiere decir República Dominicana):
  5 pantallas propias con los tipos de documento y los rangos en RD$ escritos a mano en TS.
- **merchants** — donde vive la config por comercio/sucursal (`allieds.country_id`, la copia de reglas por
  sucursal, `lenders_by_allied_branches`). El país del comercio está acotado a `Rule::in([47, 60])`.
- **entities** — `lenders.country_id` (default 1) y el `response_type` como eje de despacho.
- **smartpay** — el canal por donde entra la tarea (RD: `country_id=60`, locale `es_DO`, moneda `DOP`).
- **hardcodes-entidades** — la lente transversal: la fila **"país RD/Colombia" (6 sitios, P2)** ya está en su
  catálogo de bloqueadores. Este trabajo es des-hardcodear esa fila.

## El dolor en una frase
**RD ya está en producción, pero como un fork y no como configuración.** `alliedCountry === 60` en el loader
de la pantalla de celular redirige a **un wizard entero aparte** (5 pantallas + `PersonalInfoForm.tsx` de 896
líneas + `FinancialInfoForm.tsx` de 577). Si el tercer país entra por el mismo camino, son 5 pantallas más y
un tercer catálogo de documentos.

## Censo: ya hay CUATRO columnas de país y tres mienten
El problema no es de cobertura — es del `DEFAULT 1`. Verificado contra `main` de
`legacy-backend`/`frontend-monorepo` + BD local (2026-08-05):

| Tabla | Columna | Datos reales | Estado |
|---|---|---|---|
| `allieds` | `country_id` NOT NULL **DEFAULT 1** | 264 en 47 · 2 en 60 | **sana** — y la única que el flujo lee (sesión `alliedCountry`) |
| `lenders` | `country_id` NOT NULL **DEFAULT 1** | **155 en 1** · 1 en 60 | basura + **tres** filtros literales `where('country_id', 1)`. Aun así decide mensajería y tasa |
| `users` | `country_id` NOT NULL **DEFAULT 1** | **215.844 en 1** · 12.183 en 47 · 1 en 60 | basura inconsistente, **sin lector** |
| `users` | `issue_country` varchar nullable | **0 filas** pobladas | vacía **pero sí se lee** → ver bug abajo |
| `allied_branches` | — | — | **falta** (la que sí hace falta) |
| `user_requests` | — | — | **falta** — la solicitud no congela el país |
| `countries` | la fila de config | `dial_code`, `cell_phone_lenght`, `locale`, `currency`, iso | **es la que ya casi sirve y casi nadie lee** |

**El defecto de diseño es el default, no la tabla.** `DEFAULT 1` apunta a una fila real (`id 1` =
Afghanistan), así que **"sin definir" es indistinguible de "definido mal"** — y es lo que pasó en las
tres columnas rotas. Con `NULL` los 155 lenders y los 215.844 usuarios habrían gritado el primer día.
Regla para lo que se agregue: **sin default, o nullable.**

**Los OCHO filtros literales `->where('country_id', 1)` hoy funcionan por accidente** —leen el default,
no un país. `legacy-backend` (3): `LenderRetrievalService:458` · `OnboardingService:1782` ·
`Identity/LenderRepository:52`. **`application` (5)**: `Customer/ListLenderController:87` ·
`Customer/PersonalInfoController:1329` · `Customer/SimulatorController:44` ·
`Services/lenders/LenderRetrievalService:174` **y** `:459`.
Poblar bien `lenders.country_id` sin arreglarlos primero **vacía el listado en los dos frentes**. La
versión parametrizada ya existe y nadie la usa en ese camino (`Onboarding/LenderRepository:18-22`).

**Semántica correcta de cada una** (importa para no volver a mezclarlas):
- `allieds.country_id` = donde el comercio **reporta** (país central). Hoy hace **dos** trabajos: ese y
  "el país que gobierna el flujo". Con la de la sucursal hay que quitarle el segundo — si no, la columna
  nueva no arregla nada porque el gate sigue leyendo la del comercio.
- `allied_branches.country_id` = donde se **opera / se atiende al cliente**. Es la que debe gobernar.
- `lenders.country_id` = **en qué moneda está denominada esa fila** (no "dónde opera"). Por eso es
  singular y está bien que lo sea.
- `users.country_id` / `issue_country` = **de dónde es la persona**. Es OTRO EJE: un colombiano atendido
  en una sucursal RD es legítimo. No mezclar con el eje de operación.

**Dónde NO ponerla:** en `lenders_by_allied_branches` (el cableado) ni en las tablas de config que
cuelgan de esas (calculadora, group rules, categorías, tramos). Es derivable de los dos lados y ahí es
donde una tercera copia fabrica deriva: el cableado **valida** que sucursal y entidad coincidan, no
guarda una opinión propia.

**La que falta y nadie pidió: `user_requests`.** La solicitud congela `rate`, `initial_fee`,
`final_amount`, `fee_value`… y **no congela el país** (verificado: no tiene columna de país, moneda ni
locale). El día que se corrija el país de una sucursal, las solicitudes históricas cambian
**retroactivamente** de moneda, de documentos válidos y de plantilla de mensaje — en originación eso
toca documentos ya firmados. Snapshot, no FK viva, igual que el resto de esa tabla.

**Bug ya cobrando:** `issue_country` está en **0 filas** y se lee como
`$user->issue_country ?? 'COLOMBIANA'` (`OnboardingPayloadBuilder.php:129`) → **todos los documentos
generados afirman nacionalidad colombiana**, incluidos los de RD.

## Auditoría: dónde se usa el país, para qué, y qué está quemado
Barrido de los 4 repos contra `main` (2026-08-05). La conclusión que no esperaba: **buena parte del
código YA está parametrizado por país y está inerte porque el DATO está vacío.**

### 🔴 El hallazgo: la mensajería ya es multi-país y nadie lo sabe
**11 lectores** de `countries.phone_code`, en 6 archivos, todos con el mismo patrón:

```php
$phoneCode = $userRequest->allied?->country?->phone_code ?? '+57';
```

`NotificationService` (×5) · `VoucherService` (×2) · `ValidateOtpPromissoryNoteController` (×2) ·
`TwilioMessagingService` · `TwilioController`.

Y la columna está **vacía en las 253 filas** (su migración sembró por `iso_code_2`, que guarda el
alpha-3 → 0 filas tocadas). → **Los 11 caen siempre al `'+57'`**: el OTP del pagaré, las notificaciones,
el voucher y todo Twilio salen con prefijo colombiano **también para RD**.

→ **Corrección al plan: NO matar `phone_code` — poblarla.** Son **dos `UPDATE`** y es el arreglo más
barato y de mayor impacto de toda la tarea. La capa de mensajería no hay que internacionalizarla: hay
que encenderla.

### El mapa por propósito

| Para qué | Dónde | ¿Config o quemado? |
|---|---|---|
| **Decide el flujo** | `phone-number.tsx:70` `alliedCountry === 60` → wizard RD | lee config, **branch literal** |
| **Prefijo de mensajería** | 11 lectores de `country->phone_code` | **config ✓** — dato vacío → siempre `+57` |
| **Ruteo SMS/WhatsApp** | `$isDoLogic` **×4** (`NotificationService` ×3 + `TwilioController:187`) + `getRoutingData` (`'do':'co'`) | **quemado**, y con dos definiciones distintas de "es RD" |
| **Credenciales Twilio** | `sendWhatsAppNotification`: `if($dialCode){}else{}` + `contentSid`/`messagingServiceSid` literales en el método | **quemado** |
| **Moneda / formato** | `currency_format` desde `allied->country` (4 controllers) | **config ✓** |
| | `formatCurrencyWithSymbol(amount, locale="es-CO", currency="COP")` + `maximumFractionDigits: 0` | **quemado** — y el `0` borra los centavos del **DOP** |
| | 45 `Intl.NumberFormat` crudos + 13 `toLocaleString("es-CO"/"es-DO")` fuera del helper | **quemado** |
| | `'COP'` literal en `InitialFeePaymentService:312` (Wompi), `ValidateOtpController:135`, `SelfDevelopmentNotifier` ×2, `VtexService:53` | **quemado** |
| **Fecha / zona horaria** | `America/Bogota` **×7**: `ConsentService` ×2, `OnboardingPayloadBuilder:86` (fecha de firma), `LeaseAgreementService:102`, `DecevalSoap` ×2, `ReminderNotification:81` | **quemado** — en RD (UTC-4) un documento firmado 23:30 imprime el día anterior |
| | `->locale('es')` ×6 para formatear fechas | **quemado** |
| **Listado de entidades** | `->where('country_id', 1)` **×8** (3 legacy + **5 application**) | **quemado**; existe la versión parametrizada y no se usa |
| **Tasa y usura** | `PaymentCalculationService:201` (`!= 60`), `updateUsuryRate` (saltea 60) | **quemado**, pero reconocen el problema |
| **Gate de datacrédito** | `addNewRule:80` no crea reglas si el comercio no es CO | **config-ish ✓** en `application`; **el gemelo de legacy no tiene la compuerta** |
| **Documentos / KYC** | `issue_country ?? 'COLOMBIANA'`; genderapi `country=CO` ×2; Deceval `CC=>1/CE=>2` ×3 | **quemado** |
| **Geografía** | form-service lee `countries`/`country_zones`/`country_cities`, read-only, `status=1` | **config ✓** |
| | `COUNTRY_ID = 47` en `additional-info-form.tsx:34` | **quemado** |
| **Pagos** | Payvalida country `343` | **quemado** |
| **Alta / validación** | `Rule::in([47, 60])` en el alta de comercio; `Country::COLOMBIA_ID` solo existe en `application` | **quemado** |
| **Sin uso** | `users.country_id` (215.844 en el default, sin lector), `iso_code_3`, `address_format`, `image` | muerto |

### Cobertura: 13 repos, no 4

| Repo | Veredicto |
|---|---|
| `legacy-backend` | el grueso (ver tabla arriba) |
| `legacy-application` | 83 `country_id` en 56 archivos · `COLOMBIA_ID` ×4 — **contado, no auditado línea por línea** |
| `frontend-monorepo` | 7 `alliedCountry` · 64 `es-CO\|es-DO` · helper de moneda con default CO |
| `form-service` | ✅ read-only sobre el catálogo legacy, **sin hardcodes** |
| **`messaging-service`** | ✅ **country-first** — ver abajo |
| **`onboarding-forms-service`** | ⚠ **hardcodeado a RD** — ver abajo |
| `creditop_mobile` (Flutter) | `+57` en el router y el gateway de Cognito (`app_router.dart:165,189,192`, `cognito_auth_gateway_impl.dart`) |
| `dynamic-form` | ya tiene un **mapa país→prefijo** (`phone-analyzer.ts:4`: `CO:'57', MX:'52', US:'1', ES:'34', AR:'54', CL:'56'`) + `es-CO` como default ×5 en `logic.ts` |
| `pdf-mapper-editor` | `defaultValue: 'COLOMBIANA'` (`useEditorStore.ts:54`) — **el segundo sitio del mismo hardcode** |
| `pre-approvals-service` · `cognito-pre-sign-up` · `microservices` · `vtex` | agnósticos / cero |

### 🟢 `messaging-service` ya está construido country-first
El MS al que legacy le habla **no hay que internacionalizarlo: ya lo está.**
- `domain.Message` lleva `Country`; `provider_config.go` tiene `CountryISO2`.
- **Config de proveedor por país, en tabla**: `labsMobileConfigRepo.GetByCountry(countryISO2)` y
  `whatsAppConfigRepository.GetByTemplateAndCountry(templateName, countryISO2)`.
- El sufijo de plantilla **se deriva del ISO**, que es justo lo que propusimos:
  `fmt.Sprintf("whatsapp_auth_otp_%s", strings.ToLower(msg.Country))` (`send_message.go:65`).
- `normalizeNationalPhone(country, recipient)` normaliza según el país.
- Y **falla explícito** si falta la config: *"LabsMobile config disabled for country %s"* /
  *"WhatsApp config disabled for template %s country %s"*.

→ Dato nuevo: el proveedor SMS es **LabsMobile** (no solo Twilio), y su habilitación es **por país**.
→ Consecuencia: poblar `countries.phone_code` no alcanza — hay que **verificar que existan las filas de
config de `DO`** en el MS (LabsMobile + cada plantilla WhatsApp), o el envío falla con `ErrNotFound` en
vez de mandar mal. Se suma al paso 1.

### ⚠ `onboarding-forms-service` es el espejo invertido: hardcodeado a RD
El proveedor del wizard dinámico (el de las 5 pantallas RD) **asume República Dominicana**:
- `const countryISO3166Alpha3Prefix = "dom"` (`supplementary_document_repository.go:25`) — el prefijo de
  las rutas S3 de documentos, con un **TODO explícito** admitiéndolo, y el README lo repite.
- `getCountryFromPhone(phoneNumber)` deriva el país del teléfono, y `send_otp.go:166-168` usa
  `payload.country` con fallback al detectado.

→ O sea: **un servicio asume Colombia y el otro asume República Dominicana, y los dos alimentan el mismo
wizard.** Es la mejor foto del problema que encontró esta auditoría.

### `legacy-application` — el que más tiene (auditado línea por línea)
Es el monolito que corre en producción por defecto, y es el **menos** parametrizado de los dos backs.

- **⚠ 5 filtros literales `country_id = 1`** (arriba). Con los 3 de legacy son **ocho**.
- **`'+57'` pelado en 7 sitios** — y sin el `?->country?->phone_code ?? '+57'` que sí tiene legacy: acá
  es concatenación cruda al `PhoneNumber` de AWS SNS. `SmsController:21,45` · `OtpController:38` ·
  `ValidateIdentityController:654` · `ValidateOtpPromissoryNoteController:211` ·
  `CreditopXPaymentController:1608` · y **`app/Models/User.php:133`**, un accessor del modelo que
  devuelve `'+57' . $this->cell_phone`: el país está cosido al modelo de usuario.
- **⚠ La moneda entra en la FIRMA de Wompi**: `Actions/Lenders/Wompi.php:52` → `$rawSignature .= 'COP'`.
  No es cosmético — cambiar la moneda cambia el hash de integridad de la transacción.
- **`'COP'` en 9 sitios** de pagos e integraciones: `Wompi:52,116` · `WompiController:164` ·
  `Payvalida:37` (`'money'`) · `SistecreditoPay:40` · `UserRequestController:158,184` (`codigoMoneda`) ·
  `EcommerceController:208` · `VtexController:132` · `WoocommerceController:282` (los 3 últimos con
  fallback `?? 'COP'`).
- **`America/Bogota` ×3 más**: `ConsentController:66,146` (documentos de consentimiento) y
  `ReminderNotification:74`. **Total entre los dos repos: 10.**
- **`!= 60` en dos comandos de cron** (servicing): `CorrectNegativeInterestHistory:453` y
  `UpdateCreditopXRequestsCommand:64`.
- **`47` quemado en el front Vue**: `AlliedInfoCreate.vue:116` (`country_id: 47` como default del alta de
  comercio) y `AlliedRules.vue:1196` (`allied?.country_id === 47`, el gate de datacrédito **también** en
  el front). Y `AlliedController:86` mezcla las dos formas en una línea:
  `whereIn('id', [Country::COLOMBIA_ID, 60])`.
- **`Country::COLOMBIA_ID = 47`** existe solo acá (`app/Models/Country.php:16`), usado en 2 sitios.
- **Sí hay `lang/`** (a diferencia de legacy-backend), pero son **8 archivos del scaffolding de Laravel**
  (auth · pagination · passwords · validation) en `es` y `en`. No hay copy de la aplicación: la
  infraestructura existe y está vacía.

**🟢 Precedentes buenos que conviene copiar** (acá sí está bien hecho):
- El **menú del admin se filtra por país con una lista**, no con un `if`: `VerticalNavGroup.vue:24`,
  `VerticalNavLink.vue:16`, `VerticalNavSectionTitle.vue:16` → `countries.includes(auth?.allied_country_id)`.
- `CreditopXFormController:19` arma el select de departamentos con
  `CountryZone::where('country_id', $userRequest->allied->country_id)` — el país del comercio, no un literal.

**⚠ Documentos: 10 plantillas PDF nombradas por id de lender**, con el país cosido en el texto legal.
Y una que hay que **verificar con negocio**: `consent_152.blade.php` — el lender **152 se llama
"smartpay"** y en el dump está cableado a la sucursal del comercio RD, pero su consentimiento es un
contrato **100% colombiano**: acreedor *REFURBI COLOMBIA S.A.S.* con NIT, *cédula de ciudadanía*, mora
según la *Superintendencia Financiera de Colombia* y *Ley 1581 de 2012*. O el cableado del dump es
ruido, o hay un documento del país equivocado. En cualquiera de los dos casos el **mecanismo** —una
plantilla por id con el país en el texto— es el problema estructural.

### Volumen
`legacy-backend` 71 `country_id` (casi todos `$fillable`/modelos) · `application` 83 en 56 archivos ·
`frontend-monorepo` 7 `alliedCountry` en 3 archivos, 64 `es-CO|es-DO` en ~20 · `form-service` solo lee ·
**`pre-approvals-service` es agnóstico** (7 menciones, todas pass-through de `issue_country`).

**Lectura:** el problema no está repartido parejo. Se concentra en **mensajería** (que ya está resuelta y
apagada), **formato de dinero** (helper con default CO) y **fecha/zona horaria** (7 hardcodes en
documentos legales). El resto son literales sueltos.

## Por dónde arrancar: "config de país" y "geolocalización" no son el mismo trabajo
La geografía **ya existe y es de tres niveles** (`countries` → `country_zones` = departamentos/provincias
→ `country_cities`), y está más completa de lo que parece. Censo (BD local):

| | |
|---|---|
| países | **253**, todos `status=1` → hoy no hay forma de decir "operamos acá" |
| países con zonas | **214** (4.110 zonas en total) |
| zonas de **RD** | **32** ✅ — son sus 31 provincias + Distrito Nacional, están bien |
| ciudades de **RD** | **0** ⛔ |
| ciudades de **CO** | 1.123 |
| `address_format` | **0 filas** pobladas |
| suciedad conocida | `country_zones.code`: de 4.110 filas solo 419 numéricas; en CO 3 malas (`EXT`, `MED`, `TODOS`) |

Y el dato que decide la prioridad: **el wizard RD hoy NO consume `country_cities`.** Su ciudad de
residencia (`field_id` 162) sale de constantes TS / del forms-service externo, no del árbol. El árbol lo
consume la **G2** (`form-service`, `PUT /v1/field-options/country-tree/{countryId}`) — que es justamente
el camino que **ya es multi-país por diseño** y que ya se ejercitó sin escribir código (la cascada
Departamento→Ciudad de nacimiento de Credifamilia, 2026-07-23).

→ **Cargar las ciudades de RD es un INSERT, no un diseño**, y solo hace falta el día que una pantalla de
RD pida ciudad desde el árbol. Arrancar por ahí gasta la primera semana en higiene de 250 países sin
mover nada observable, mientras los tres bloqueadores reales siguen intactos.

### ¿Credifamilia creó tablas nuevas? NO — el form-service lee LAS MISMAS
Verificado en `github/form-service` (rama `main`, 2026-08-05). Sus queries no tienen tabla propia ni
migraciones: leen el catálogo legacy tal cual, y sus entidades viven bajo
`internal/core/entities/legacy_forms`.

| Query (`internal/infra/storage/mysql/queries/`) | Tabla | Qué hace |
|---|---|---|
| `GetCountryByID` · `GetCountryByISOCode1` · `ListAllCountries` | `countries` | **SELECT** de la fila completa: `dial_code, iso_code_1/2/3, address_format, cell_phone_lenght, phone_code, locale, currency, status` |
| `ListCountryZonesByCountryID` | `country_zones` | SELECT `WHERE country_id = ? AND status = 1` |
| `ListCountryCitiesByZoneIDs` | `country_cities` | SELECT `WHERE country_zone_id IN (…) AND status = 1` |

**Es read-only:** en todo el set de queries los únicos INSERT/DELETE son sobre `user_field_values`. No
hay DDL. → **No existe un segundo catálogo de países/ciudades, y no hay que crear uno.** `countries` ya
tiene **dos consumidores vivos en repos distintos** (el `currency_format` de legacy y el form-service);
una tabla paralela sería una tercera opinión del mismo hecho — justo la enfermedad que esta tarea cura.

**Consecuencia para el plan: los cambios a `countries` son ADITIVOS, no un refactor libre.** Tocar esas
columnas rompe un microservicio en otro repo, con deploy propio:
- **Renombrar `cell_phone_lenght`** (el typo) rompe `country_queries.sql` — el typo está horneado en el
  SELECT. Exige PR coordinado en los dos repos o lectura dual transitoria.
- **Renombrar las columnas ISO corridas** rompe `GetCountryByISOCode1`, que busca por `iso_code_1` — o
  sea que el form-service **ya depende** de que ahí viva el alpha-2. Mejor: **dejarlas quietas**,
  documentar el corrimiento y agregar una columna nueva bien nombrada si hace falta.
- **`status`** es gate vivo (ver arriba): no se reutiliza.
- **Poblar lo vacío es seguro y es la parte que rinde**: `phone_code`, `address_format`, `locale` y
  `currency` ya se están SELECTeando y hoy llegan nulos. Llenarlos no rompe nada y le da datos a un
  consumidor que ya los pide.

**Orden propuesto para el catálogo:**

1. **`countries` como fila de configuración** — el arranque real, y es **más chico de lo que parece**.

   **Inventario exacto (BD local, 253 filas):**

   | Columna | Llenas | Qué es | Veredicto |
   |---|---|---|---|
   | `name` | 253 | nombre | sirve |
   | `iso_code_1` | 253 | **alpha-2** (`CO`, `DO`) — la clave real | sirve; es la que usa `GetCountryByISOCode1` del form-service |
   | `status` | 253 en 1 | activo | **gate vivo** del form-service (countries/zones/cities) — no reutilizar |
   | `dial_code` | **2** | prefijo sin `+` (`57`, `1`) | solo CO y DO — que son justo los que operamos |
   | `cell_phone_lenght` *(sic)* | **2** | 10 y 10 | typo; el `$fillable` usa el nombre correcto y no escribe |
   | `locale` · `currency` | **6** | AR·CO·DO·MX·PE·PR | **dos notaciones dentro de la misma tabla**: `es-CO`/`es-DO` con guion, `es_AR`/`es_MX`/`es_PE`/`es_PR` con guion bajo |
   | `iso_code_2` | 253 | dice alpha-2 y **guarda alpha-3** (`COL`, `DOM`) | engaña; rompió la migración de `phone_code` |
   | `iso_code_3` · `address_format` · `image` · `phone_code` | **0** | — | muertas |

   **La buena noticia: para CO y RD la fila YA está completa en lo que sirve** (`dial_code`,
   `cell_phone_lenght`, `locale`, `currency`, `iso_code_1`). No hay que poblar casi nada.

   **Agregar — solo dos** (lo demás se deriva o no va acá):
   - **`is_operating`** (bool). No se puede derivar y `status` no se puede reutilizar: es gate vivo del
     form-service, apagar un país lo borraría del formulario dinámico.
   - **`otp_length`** (tinyint). Hoy son constantes (`OTP_LENGTH_SHORT=4` / `LONG=6`) más un
     `otpLength: 4` quemado en el wizard.

   **Arreglar, no agregar:**
   - **Poblar `phone_code`, NO matarla** — tiene **11 lectores vivos** que hoy caen al `'+57'` por defecto
     (ver la auditoría). Son dos `UPDATE`. Decidir si el valor lleva `+` (los lectores lo concatenan crudo).
   - **Unificar la notación de `locale`** — hoy la propia tabla se contradice.
   - **`iso_code_2`**: NO renombrar (el form-service depende de `iso_code_1`); documentar el corrimiento.
   - `cell_phone_lenght`: el typo está horneado en el SQL del form-service → renombrar solo con PR
     coordinado en los dos repos.

   **Lo que NO va en `countries`:**
   - **tipos de documento** → catálogo + aplicabilidad (pierde los niveles sucursal/entidad si va acá).
   - **burós/proveedores por país** → relación N:M propia, es el bloque A.bis.
   - **sufijo de plantilla** → se **deriva** de `lower(iso_code_1)`; no hace falta columna.
   - **formato de fecha / decimales** → los da `Intl` desde `locale` + `currency`.
   - **`timezone`** → real (CO es UTC-5, RD UTC-4, y hay 6 crons diarios con fecha de corte), pero es de
     **servicing**: anotado, fuera del alcance de onboarding.
2. **Tipos de documento** — catálogo + aplicabilidad (ver la sección de las tres capas). **No** es parte
   de geo y **no** es una columna JSON de `countries`: meterla ahí pierde los niveles sucursal/entidad
   que ya existen en `lenders_by_allied_branches.document_types`.
3. **`allied_branches.country_id`** — la única pieza *geo* que sí es de arranque, porque desbloquea todo
   lo demás. Va con **invariante**: la ciudad debe pertenecer a una zona de ese país, validado en el
   único camino de escritura. Sin eso no es una columna nueva, es una quinta opinión (la deriva ya
   existe: la sucursal del comercio RD apunta a una ciudad colombiana).
4. **Geo (datos)** — ⚠ **ya NO es diferido: es prerequisito del invariante ciudad↔país.** En prod las
   **13 sucursales de comercios RD apuntan a ciudades colombianas** porque RD tiene **0 ciudades**.
   Cargar las ciudades de RD, `address_format`, y limpiar `country_zones.code`.

El patrón que no escala no es "faltan features": es que **el país es un `if` literal en vez de una fila
cargada una vez por solicitud**. En `main`: **28 archivos PHP con `'+57'` literal**, `?? '+57'` como default
en toda la cadena de OTP, y el predicado
`$isDoLogic = (lender.country_id === 60) || $countryIso === 'DO' || str_contains($cell_phone, '+')`
**copiado 4 veces** (`NotificationService` ×3 + `TwilioController.php:187`), con una definición de "es RD"
distinta de la del repositorio de mensajería (`LoanMessagingServiceRepository::getRoutingData`, que prioriza
el país del contexto sobre el del teléfono).

## Dónde vive la configuración: las tres capas que hay que separar
El debate "herencia (`countries` → tipos de documento) vs. tabla de configuración que une conceptos" mezcla
tres cosas distintas. La decisión de diseño de esta tarea es **separarlas**:

1. **CATÁLOGO — qué existe.** Un tipo de documento tiene atributos propios (código, label, regex, longitudes,
   código por proveedor). Eso es una entidad y merece su tabla (`document_types`). No es "ensuciar" nada:
   hoy ese conocimiento vive como **regex en TypeScript** (`dynamic-step-one.ts`) y **closures en PHP**
   (`PersonalInfoRequest`), duplicado y divergente. `CED` no es hijo de una fila de `countries`.
2. **APLICABILIDAD — dónde aplica.** Acá la regla de Fercho es la correcta: **no** colgar
   `country_document_types` de `countries` ni crear una tabla por par (país / comercio / sucursal / entidad =
   4 tablas que divergen). **Una** tabla que referencia a los padres. Y esto **ya está hecho a medias**: la
   migración de Motai v2 agregó `lenders_by_allied_branches.document_types` (json).
3. **RESOLUCIÓN — quién gana.** Es **código**, no schema: un resolvedor, una precedencia escrita, un test.
   Motai v2 ya eligió una regla — **unión** de los `document_types` de las entidades de la sucursal, con piso
   `["CC","CE"]` (`AlliedInfoController::resolveAllowedDocumentTypes`). Es una regla válida y hay que
   heredarla, con una corrección obligatoria multi-país: **la unión debe intersectarse con el catálogo del
   país**, o una sucursal mixta le ofrecería `CED` a un colombiano.

**El hallazgo que decide el foco:** `lenders_by_allied_branches.document_types` está poblada en **6231 de
6231 filas** de la BD local (`["CC","CE"]` ×6228, `["CC","CE","PEP"]` ×3 = Motai) y **no tiene ningún lector
en `main`** de ninguno de los dos repos — su único consumidor vive en `feature/motai-v2`. Mientras tanto el
wizard sigue con `z.enum(["CC","CE","PEP"])` y el backend con `in:CC,CE,PEP`. O sea: **la pregunta "dónde
viven los tipos de documento" ya se contestó una vez en la BD y la respuesta está muerta.** El riesgo de esta
tarea no es elegir mal la forma de la tabla: es construir la tabla y no matar los catálogos hardcodeados.

**Forma propuesta** (una tabla de aplicabilidad, FKs reales, precedencia por especificidad):

```
document_types        (id, code, name, regex, min_length, max_length, sort, status)      -- catálogo
document_type_scopes  (id, document_type_id FK, country_id FK NULL, allied_id FK NULL,
                       allied_branch_id FK NULL, lender_id FK NULL, is_enabled, sort, status)
```

Gana el ámbito **más específico no-nulo**. Se eligen FKs nullables y **no** un `(scope_type, scope_id)`
polimórfico a propósito: los ámbitos son pocos y conocidos, y este código ya tiene dos tablas sin FK que sus
propios docs describen como no confiables (`user_field_values` sin unique ni FKs; `settings` con arrays de
ids en JSON). La clase de bug que más veces mordió acá es exactamente la que una FK ataja
(`country_id` default 1). Costo aceptado: una dimensión nueva = una migración.

**Y la regla para no reinventar `settings`:** tabla de configuración = **columnas tipadas + FK al catálogo**.
No key/value, no bolsa JSON. El JSON de `document_types` es aceptable mientras el catálogo sea cerrado y
diminuto (CC/CE/PEP); deja de serlo al entrar CED/PAS/CI_VE con regex por país.

**Alcance del genérico:** hacerlo **para tipos de documento primero**. Longitud de celular, `otp_length`,
locale y moneda salen de `countries` (S1) mientras no haya un segundo caso que exija ámbito por sucursal.
Construir el motor genérico antes de tener dos casos es cómo nace un `settings` nuevo.

## Lo que la premisa "sucursales en otro país" necesita antes de existir
La sucursal **no sabe en qué país está**: no hay `allied_branches.country_id`; el flujo lee el país del
**comercio**. Consecuencias:
- Una sucursal en otro país es hoy **invisible** para el flujo.
- Los dos criterios ya se contradicen en el dato: la única sucursal del comercio RD (`country_id=60`) apunta
  a una **ciudad colombiana**. Es 1 fila de 1692 — dato sucio, no un comercio multi-país real; pero nada lo
  impide porque nada lo valida.
- Derivar el país por `country_city_id` → `country_zones` **no** sirve como camino canónico: el nodo
  `bancolombia` documenta que `country_zones` está sucio (4110 filas, solo 419 con código numérico).

→ **Decisión propuesta:** `allied_branches.country_id` explícito (nullable, fallback al comercio), poblado
desde la ciudad **una vez** y con check de consistencia, en vez de derivarlo en caliente por dos joins sobre
una tabla sucia. Y `session('alliedCountry')` pasa a leer el país de la **sucursal**.

## ¿Una entidad puede operar en varios países? El esquema ya contestó: NO
Si un comercio puede tener sucursales en varios países, la pregunta simétrica es si una **entidad**
puede. La respuesta no es de criterio, es de esquema: **la economía de la entidad está denominada en
moneda y vive en `credit_line_by_lenders`, que cuelga de `lender_id` y no tiene dimensión de país.**
Verificado en la BD local:

| lender | país | `min_amount` | `max_amount` | `rate` |
|---|---|---|---|---|
| SmartPay (153) | 60 RD | 1.000 | 100.000 | 10,00 |
| CrediPullman (77) | 1 *(default)* | 500.000 | 6.000.000 | 1,82 |
| Creditop X (37) | 1 *(default)* | 1.000.000 | 3.000.000 | 0,20 |

→ **Modelo: una fila de `lenders` por país.** No es una convención que se pueda elegir: es lo que el
esquema obliga, y es lo que de hecho ya pasa (SmartPay RD es el lender 153/160, no una variante del
mismo). La alternativa (`lender_countries` N:M) forzaría una dimensión de país en las 8+ tablas que
cuelgan de `lender_id` — `credit_line_by_lenders`, `lenders_by_allieds`, `lender_users_categories`,
`creditop_x_conditions_by_amount_by_lender`, tramos, reglas… Eso es un refactor de la plataforma, no
una internacionalización.

**Dos consecuencias:**
1. La regla que propone Miguel —*una sucursal solo habilita entidades de su país*— pasa a ser una
   **igualdad simple** entre dos columnas que ya existen, no un join contra una tabla N:M. Barata.
2. Y pasa a ser **necesaria**, no opcional: con una fila por país el catálogo crece (N países × M
   entidades) y sin esa validación el admin puede cablear la fila del país equivocado — que es
   justamente la fila con la moneda equivocada. Hoy en el dump ya hay **1 fila así**.
3. El corolario incómodo: cada canal que se gatea **por id de lender** paga un hardcode por país.
   `isSmartPay()` ya lo demuestra (`id === 160` en prod, 153 en dev). Con una fila por país, la
   capacidad tiene que ser **columna/flag** (`path_id`, `product`, un `capability`), nunca un id.

## Plan por bloques
Orden pensado para que ningún bloque posterior tenga que volver a decidir país.

**A · Fundamento**
1. `countries` como única fuente de verdad — **el arranque**; detalle y orden en «Por dónde arrancar» (los
   4 arreglos de datos + `otp_length` / `date_format` / `template_suffix` / `status` que discrimine).
1.bis `allied_branches.country_id` con invariante contra `country_city_id`, y quitarle a
   `allieds.country_id` el segundo trabajo (dejar de gobernar el flujo).
2. Un solo resolvedor de país por solicitud, con precedencia escrita (sucursal → comercio → teléfono →
   default) y **un** lugar donde vive el default.
3. Que el país llegue al front como **payload**, no como `if` en el loader: extender `partner-info` (ya trae
   `country_id`) con `country: { iso2, dial_code, phone_length, otp_length, document_types[], locale, currency }`.
4. **No abrir un tercer wizard: converger el fork de RD.** Con (3), el wizard clásico y las 5 pantallas
   `request-*` son el mismo flujo con otro catálogo y otra moneda. Se puede pantalla por pantalla, empezando
   por celular/OTP (lo que menos difiere).

**A.bis · La consecuencia más grande del país de la sucursal: los BURÓS**
Verificado (2026-08-05): **hoy ninguna selección de buró mira el país. Cero.** El buró se elige por reglas
de entidad/sucursal (`lender_datacredito_rules` copiadas por sucursal, los dos motores de datacrédito) y
por cascada de proveedores para el ingreso. Todos los proveedores son **colombianos**: Experian/Datacrédito,
TusDatos, Ágil Data, Mareigua, Quanto. `CreditBureauAggregatorService` sí toca `country_cities`, pero solo
como filtro de ciudad para listar sucursales — no para elegir proveedor. Y hay un `'country' => 'CO'`
**quemado** en la llamada a genderapi (`PersonalInfoProcessingService.php:243`, con un gemelo en
`DynamicFormsService`).

→ Una solicitud de una sucursal RD hoy llamaría a burós colombianos con una cédula dominicana. RD lo
esquiva de rebote porque `isSmartPay` **saltea el AML** y el path IMEI usa credenciales por-lender: otra
vez un hardcode haciendo de regla de país. **Los proveedores por país son una dimensión que no existe** y
hay que sumarla al catálogo (qué buró/proveedor aplica en cada país), no solo prefijo y moneda.

**B · Celular**
5. Un `PhoneField` único configurado por país. Hoy "10 dígitos" y el prefijo están cableados en ≥6 sitios
   independientes (`imei/Entry.tsx:6-7,49,56`, `register-imei-action.server.ts:13-14` con el **mismo Set
   duplicado**, `phone-number-step-form.tsx:67`, `update-user-phone.schema.ts:9`).
6. Guardar **E.164** y dejar de inferir el país del formato del string: hoy `users.cell_phone` queda a veces
   nacional y a veces `+1809…`, y el backend usa `str_contains($cell_phone, '+')` como prueba de que es RD.
   Agregar `users.country_id` (o `dial_code`).
7. libphonenumber en los dos lados. El backend ya lo tiene (`PhoneService::resolveCountry` / `toNational`);
   el front no: `normalizePhoneE164` marca **cualquier** número de 10 dígitos como `+57` — y RD también tiene
   10 dígitos, así que todo usuario dominicano entra a la analítica como colombiano.
8. Enrutar mensajería por país, no con un booleano: `sendWhatsAppNotification` elige cuenta Twilio,
   `contentSid` y `messagingServiceSid` con `if($dialCode){}else{}` y **los SIDs literales en el método**.
   El sufijo de plantilla (`whatsapp_auth_otp_do` / `_co`) es el mecanismo correcto — hacerlo
   `strtolower($iso2)`. Unificar los 4 `$isDoLogic` copiados.

**C · Tipos de documento**
9. Catálogo + aplicabilidad + resolvedor, según la sección de arriba; y **matar** los tres catálogos que hoy
   compiten: el `z.enum` del clásico, las regex TS del wizard RD, y las `field_options` de la G2.
10. **Antes de agregar códigos, auditar quién les da semántica de negocio.** `document_type` hoy decide cosas
    que no son del país: `DatacreditoRuleEvaluator.php:21` (`CE` + lender 84 **cortocircuita el gate de
    datacrédito**; gemelo en `LenderUserCategoryService.php:356`), `DecevalSoap` mapea `CC=>1, CE=>2` en tres
    sitios, `WelliRegistrationData.php:49-50`, `TusDatosService.php:45,252`, PEP en `UsersService.php:1276`.
    Un `CED` cae al `else` **en silencio**. → `document_types.provider_codes` + hacer esos mapas fail-closed,
    y quitar el default `'CC'` de `UserService.php:170`, `VtexService.php:213`,
    `EcommerceRequestService.php:335`, `CorbetaCheckoutController.php:905`.
11. Validar en un lugar, derivado del catálogo: `PersonalInfoRequest.php:21` (`in:CC,CE,PEP` + closure con
    reglas colombianas: 5-10 dígitos, rango `10000..3000000000`) y su gemelo
    `OnboardingV2/.../StorePersonalInfoRequest.php:52`.

**D · Mensajes**
12. i18n en el wizard: **no existe** (`i18next` está solo en `apps/backoffice`). Medido: **139 de 355 `.tsx`**
    del subárbol de onboarding tienen literales con tildes/ñ (~438 ocurrencias, y es el piso). Alcance
    sugerido: solo `loan-application-form` + `dynamic-form` (justo lo que converge el punto 4), con `es-CO` /
    `es-DO` como primeros locales.
13. El backend también tiene copy y **no tiene infraestructura**: `config/app.php` declara `'locale' => 'es'`
    y **no hay directorio `lang/` en `main`**. Regla propuesta: **el back manda `code`, el front pinta el
    texto** — el contrato `ONB0xx`/`BDPH00x` ya existe y el wizard ya rutea por código; el `message` queda
    como debug. Lo que sí traduce el back es lo que **sale** de CreditOp (SMS/WhatsApp por plantilla con
    sufijo de país, mails, PDFs). Ojo con `ACTION_ERRORS` en `register-imei-action.server.ts:29-71`: 9
    mensajes en español duros **en el server del front**.
14. Moneda y fecha del país, no del componente. El patrón bueno ya está en `main`:
    `currency_format = [locale, currency]` derivado de `allied->country`
    (`LenderListingController.php:27-38`, `ContinueUserFlowController.php:45`,
    `PaymentScheduleController.php:94`). Extenderlo a toda respuesta con dinero y borrar los defaults
    hardcodeados (`es-DO`/`DOP` en consumer-hub, `es-CO` en `stat-cards.tsx:33`, `COP $` en
    `bancolombia/payment-success.tsx:75`). Detalle que se pasa de largo: `amountToBucket` tiene los cortes en
    500K-5M — **escala COP**; en DOP todo cae en el bucket más bajo.

**E · Que no se vuelva a romper**
15. Arreglar `->where('country_id', 1)` (`LenderRetrievalService.php:458`, `OnboardingService.php:1782`)
    **antes** de que una entidad nazca con su país correcto y **desaparezca del listado sin error**. Ya existe
    la versión parametrizada: `LenderRepository.php:18-22`. Dos líneas, bloqueador silencioso.
16. Guardrail en CI: fallar si aparece `=== 60`, `== 47`, `'+57'`, `es-CO`, `CC,CE,PEP` fuera de la capa de
    config. Es lo único que funcionó con la des-motaización.
17. Ejercitar el segundo país **corriendo**: eje `country` en el harness con un comercio RD. Aviso: la
    originación distintiva de SmartPay **es falsa fuera de producción** (`isSmartPay()` hardcodea lender 160;
    en dev el del canal es 153 — F-21), así que el canal donde nace la tarea no es probable sin sortear eso.

## ✅ CONTRASTE CONTRA PRODUCCIÓN (2026-08-05, vía `make trazador-sql`)
Todo lo anterior se auditó contra el dump local. Se corrió el mismo censo contra **prod** y hay
diferencias que cambian el plan. **Aviso que vale para todo el resto: los ids NO coinciden entre
ambientes** — en local el 152 se llama «smartpay» y en prod es «Refurbicredit». Cualquier conclusión
sobre un lender puntual sacada del dump local **no vale**.

| Pregunta | Local (dev) | **PROD** | Efecto |
|---|---|---|---|
| `countries.phone_code` | NULL ×253 | **NULL** | ✅ **P3 confirmado**: los 11 lectores caen al `'+57'` en producción |
| `cell_phone_lenght` DO | 10 | **11** | ⚠ **corrige lo que dije**: no son «los dos 10 dígitos» |
| `locale` / `currency` 47·60 | es-CO/COP · es-DO/DOP | **idem** | ✅ la fila de los dos países operativos está completa |
| Lenders cableados en **2 países** | 0 | **1** | ⚠ **hay conflicto en prod** — y es SmartPay |
| Lender **160** | no existe | **SmartPay · country_id 60 · rt=2 · 12 cableados en países 47 y 60** | ✅ resuelve 2 preguntas abiertas |
| Lenders 152 / 153 | «smartpay» / «SmartPay» | **«Refurbicredit» / «Crediemo»**, country_id 1, ambos CO | ✅ disuelve la alerta del consentimiento |
| Comercios · sucursales RD | 2 · 1 | **9 · 13** (vs 308 · 2209 en CO) — **2 son de prueba** | huella real pero chica |
| `users` por país | 215.844 en 1 · 12.183 en 47 | **363.240 en 1 · 12.189 en 47 · CERO en 60** | ⚠ ningún usuario RD tiene país |
| `users.issue_country` | 0 | **0 de 375.429** | ✅ bug confirmado en prod |

### Lo que cambia

**1. ✅ El conflicto de SmartPay (160) es CABLEADO MUERTO — no hay que partir la fila.** Investigado
contra prod:

| | |
|---|---|
| economía (`credit_line_by_lenders`) | `min 2.500 · max 95.000 · rate 1,9 · cuotas 6,8,10,12` → **escala DOP** |
| `path_id` | **2 = IMEI** → `isImeiPath()` true, y con id 160 `isSmartPay()` dispara |
| solicitudes | **206, TODAS en país 60**, del 2026-03-03 al 2026-08-05 (vivo hoy) |
| solicitudes por comercios CO | **CERO** |

Los 12 cableados incluyen comercios colombianos que **nunca se usaron**. Como la economía está en DOP
—95.000 COP no compra un celular— esos cableados no podían ser legítimos. → **No se parte la fila**: se
limpian los cableados CO. Y el 160 **ya tiene `country_id = 60` bien puesto**, así que ni siquiera entra
en los 129 UPDATE del backfill. **F2 vuelve a ser mecánico.**

**1.bis ⚠ Hilo abierto que sale de ahí, y toca a F1/F3.** El 160 tiene `country_id = 60`, así que el
filtro literal `->where('country_id', 1)` **lo excluye del listado**. Pero tiene 206 solicitudes: o
SmartPay no se ofrece por `getLenders` (entra por su propio canal IMEI, lo cual es coherente con el
nodo) o hay otro camino. **Confirmarlo ANTES de tocar los ocho filtros**, para no cambiarle el
comportamiento al único flujo RD vivo sin darnos cuenta.

**1.ter ✅ El documento del 160 no es problema.** No tiene `consent_160.blade`, pero tampoco lo
necesita: por el path IMEI firma el **acuerdo de bloqueo**, y `DeviceLockAgreementService` saca locale y
moneda de `$userRequest->allied?->country` — **el país del COMERCIO**. O sea que se adapta solo: RD →
`es-DO`/`DOP`, CO → `es-CO`/`COP`. Es la pieza mejor hecha de todo lo auditado.

**2. ✅ Se resuelven dos preguntas abiertas del nodo `smartpay`.** El lender **160 de prod es `rt=2`**
(el nodo lo daba por dudoso: su seeder lo crea `rt=1`) y su `country_id` **está bien puesto en 60** — no
es basura como los otros 155. Cuando se toque el nodo, esto gradúa.

**3. ✅ Muere la alerta del consentimiento colombiano.** En prod el lender 152 es **Refurbicredit** — y
el consentimiento nombra a *REFURBI COLOMBIA S.A.S.*, o sea que **está bien**. La alerta salía de que en
el dump local el 152 se llama «smartpay». Era ruido de ambiente, no un documento del país equivocado.
Queda una pregunta nueva y más chica: **qué documento usa el 160**, que no tiene blade propio.

**4. ⚠ `cell_phone_lenght` de RD es 11 en prod, no 10.** Probablemente signifique «1 + los 10
nacionales». Es ambiguo y hay que decidirlo **antes** de que el `PhoneField` (Fr3) lo lea, o RD va a
exigir 11 dígitos en un campo donde el usuario escribe 10.

**5. ⚠ Cero usuarios en país 60**, con 9 comercios y 13 sucursales RD activos. O los usuarios de RD caen
en el default 1 (lo más probable), o RD casi no origina. Se cruza con el otro dato: el `country_id = 47`
**dejó de escribirse el 2026-07-06** (el default 1 sigue creciendo hasta hoy). Algo que poblaba el país
del usuario se apagó hace un mes. Vale una pasada, no bloquea.

## 🔀 MODELO ACORDADO (2026-08-05, decisión de equipo): una BD por país

**Cada país es una base de datos**, con sus propias tablas de `allieds` y `lenders`. La jerarquía:

```
countries (1 fila = este país)  ──1:N──▶  allieds  ──1:N──▶  allied_branches
   │  country_zones / country_cities                              │
   │  tipos de documento · moneda · locale · bandera               │
   └──────────── se HEREDA hacia abajo ────────────────────────────┘
                                     allieds ──N:M──▶ lenders  (lenders_by_allieds)
                                     branch  ──N:M──▶ lenders  (lenders_by_allied_branches)
                                              ↑ acá la sucursal ACTIVA/DESACTIVA entidad y tipos de doc
```

- **Un comercio vive en UN país.** Totto en varios países = `Totto CO`, `Totto MX`, `Totto AR`, cada uno
  en su base, cada uno con sus sucursales y su config.
- **Un lender vive en UN país** — hay que recrearlo por país. No es una decisión nueva: el esquema ya lo
  obliga (la economía cuelga de `lender_id` **sin dimensión de país** y está denominada en moneda) y prod
  ya lo hace (SmartPay 160: economía en DOP, **206 solicitudes, todas de país 60**).
- **La sucursal hereda del comercio, y el comercio del país**: tipos de documento, moneda, locale,
  bandera. La sucursal es el último nivel y puede **activar/desactivar** entidades y tipos de documento.

### ✅ La tabla `countries` se queda, aunque tenga UNA fila
La duda era razonable: dentro de DB-CO tendría una sola fila. Se queda igual, por cuatro razones:
1. **No es "una tabla de una fila": es el registro de configuración del tenant.** La alternativa es que
   locale/moneda/prefijo vivan en `config`/`.env` — que es exactamente cómo se llegó a `'+57'` en 28
   archivos y a `America/Bogota` en 10.
2. **Las subtablas necesitan padre**: `country_zones.country_id` apunta a esa fila.
3. **`allieds.country_id` necesita a quién apuntar** (es la relación directa del modelo).
4. **El form-service ya la consulta** por id y por ISO (`GetCountryByID`, `GetCountryByISOCode1`);
   matarla rompe otro repo con deploy propio.

Y la razón de fondo: con la config del país **en la BD**, `legacy-backend` es **un artefacto desplegado
N veces** con distinta conexión. Si vive en el `.env`, la pregunta "de qué país soy" se muda al deploy —
invisible para SQL y para el admin, y con N configs divergiendo.

### ⛔ `allied_branches.country_id` NO se agrega (corrige M2)
Es derivable: `allied_branches.allied_id → allieds.country_id`. Mi argumento anterior ("el shard key
tiene que estar en cada fila que se mueve") **no aplica**: el join para extraer las filas de un país se
hace **una vez, dentro de la misma base, antes de partir**, y después del split la columna es una
**constante** — la misma enfermedad que este documento persigue (`country_id = 1` en 155 filas + ocho
`where('country_id', 1)`). Ninguno de los casos que la justificarían aplica: la sucursal no puede ser de
otro país (decidido), no se shardea por sucursal, y el runtime ya trae el comercio cargado con la
sucursal (cache de 30 s en `RegisterCellPhoneController` + sesión).

**Lo mismo vale para el resto**: ninguna tabla necesita columna propia de país, porque toda cadena de
padres queda **dentro del mismo shard**.

⚠ **Excepción, y por OTRA razón**: el snapshot de `user_requests` (`country_id`/`locale`/`currency`)
sigue en pie. No es shard key — es **hecho histórico**: el país de la sucursal *hoy* puede no ser el que
valía cuando esa solicitud se firmó, y ahí lo que se congela es la moneda y los documentos de un
contrato.

### De dónde lee el flujo "de qué país soy"
Dos opciones: (a) del comercio (`allieds.country_id → countries`) o (b) de la única fila de `countries`
de esta base. **Se elige (a)**, porque funciona en los dos mundos: hoy (una base con los dos países) y
después del split. El resolvedor se escribe una vez. Ojo con el sesgo de diseñar solo para el estado
final: la convivencia en una sola base va a durar mucho, y puede durar para siempre.

### Herencia de tipos de documento: el nivel que falta es el de ARRIBA
La cadena que pide el modelo —país → comercio → sucursal— encaja con el diseño de catálogo +
aplicabilidad + resolvedor. Dos precisiones:
- **El último eslabón ya existe**: `lenders_by_allied_branches.document_types` (json, en
  `feature/motai-v2`) es «la sucursal activa/desactiva tipos de documento», con unión + piso
  `["CC","CE"]`. Lo que falta es el nivel **país** por encima.
- ⚠ **Pero ese eslabón es por sucursal-ENTIDAD, no por sucursal.** Y está bien que lo sea: hay entidades
  con reglas propias de documento (Magnocell + `CE`, lender 84). Así que los ámbitos de aplicabilidad son
  **país · comercio · sucursal · entidad**, no tres.

### La N:M comercio↔entidad que pide el modelo YA EXISTE
`lenders_by_allieds` (nivel comercio) + `lenders_by_allied_branches` (nivel sucursal, donde se activa y
desactiva). Esa parte no hay que diseñarla: hay que **usarla** y sumarle el nivel país.

### ⚠ El costo que trae "un lender por país"
Recrear un lender por país duplica **todo su árbol de config** (`credit_line_by_lenders`,
`lender_users_categories` + reglas, tramos, `creditop_x_lender_configuration`). Con 5 países son 5 copias
que derivan. No bloquea nada hoy, pero conviene esperarlo: la salida es una **plantilla de entidad** de
la que cada país instancie.

### Pendientes de datos que el modelo destapa
- **Las 13 sucursales de comercios RD apuntan a ciudades colombianas** — porque RD tiene **0 ciudades**.
  El invariante ciudad↔país es correcto pero **no se puede encender** hasta cargarlas: **la geo de RD
  deja de ser diferida y pasa a ser prerequisito**.
- **3 sucursales sin comercio** (`allied_id` no resuelve) de 2.212: sin país, no se pueden asignar a
  ninguna base. Adoptarlas o borrarlas antes de partir.
- **`countries.image`** (la bandera del modelo) existe y está **vacía en las 253 filas**.
- El **hash de sucursal** tiene **4 colisiones en prod** y es `crc32` de un timestamp al segundo. Bajo BD
  por país sería la llave de **ruteo**. Va como finding aparte (F-103).

## 🎯 PRIMER ENTREGABLE: «el paso DO» — que República Dominicana quede bien parada
Alcance chico, cerrado y verificable: **solo datos + un invariante**. Ningún repo externo, ningún deploy
riesgoso. Al terminar, RD es un país de primera clase y el modelo acordado se puede encender.

### El hallazgo que lo justifica: «SANTO DOMINGO», la de Antioquia
Las **13 sucursales** de los comercios RD apuntan todas a una ciudad colombiana llamada
**SANTO DOMINGO** — que existe (municipio de Antioquia). Alguien escribió «Santo Domingo» en el
selector, salió una opción plausible, y **el dato equivocado es invisible a ojo**. Sus direcciones reales
son inequívocamente dominicanas:

| Comercio | Dirección | Provincia RD real |
|---|---|---|
| Carrefour · MAGGYSA · Multiservicios La Fe | `Autopista Duarte km 9/10/22`, `La Cuaba, Pedro Brand` | Santo Domingo (Oeste) |
| MAGGYSA | `Calle 4 Sur #11 Ensanche Luperón` | Distrito Nacional |
| MAGGYSA | `Av. San Vicente de Paúl 321, Santo Domingo Este` | Santo Domingo (Este) |
| Hot Tec · 2blea · Gold Clave · La Gracia | `Juan Sánchez Ramírez`, `Plaza Bienaventuranza`, `Plaza Europiel Herrera` | Distrito Nacional / Santo Domingo |

→ Todas están en el área metropolitana de Santo Domingo. **El re-apuntado es mecánico.**

### Las columnas de `countries`: qué se decide (spec cerrada)

| Columna | Hoy en prod | Decisión | Acción |
|---|---|---|---|
| `phone_code` | **NULL** en 253, con **11 lectores** que caen a `'+57'` | **es la columna canónica del prefijo, y lleva el `+`** (los lectores concatenan crudo) | `UPDATE` → `+57` / `+1` |
| `dial_code` | `57` · `1` (sin `+`), solo esas 2 filas | **se queda** (el form-service la `SELECT`ea) pero **no es la que el código lee** | documentar la diferencia |
| `cell_phone_lenght` *(sic)* | CO **10** · DO **11** | ⚠ **hoy es inconsistente.** Se define como **dígitos NACIONALES, sin prefijo** → DO debe ser **10** (809/829/849 + 7). «Con prefijo» se calcula: `LEN(dial_code) + esto` | `UPDATE` DO 11→10 |
| `locale` | `es-CO` · `es-DO` ✓ | correcta; las otras 4 filas usan `_` | `UPDATE` de notación |
| `currency` | `COP` · `DOP` ✓ | ya está | — |
| `iso_code_1` | alpha-2 (`CO`/`DO`) | **es la clave real** — `GetCountryByISOCode1` del form-service la usa | no tocar |
| `iso_code_2` | guarda **alpha-3** (`COL`/`DOM`) | mal nombrada; **NO renombrar** (rompe el MS) | documentar |
| `image` (la bandera del modelo) | **vacía** en 253 | del modelo, baja prioridad | opcional |
| `iso_code_3` · `address_format` | **vacías** en 253 | sin consumidor | dejar quietas |
| `status` | 253 en `1` | **gate vivo** del form-service (countries + zones + cities) | **no reutilizar** |
| **`is_operating`** | no existe | **AGREGAR** — es lo que dice «operamos acá», y es lo que después habilita la regla de entidades por país | `ALTER` + `UPDATE` 47/60 |
| **`timezone`** | no existe | **AGREGAR** — hay **10** `America/Bogota` quemados, incluida la **fecha de firma de documentos**. DO es `America/Santo_Domingo` (UTC-4): un contrato firmado 23:30 imprime el día anterior | `ALTER` + poblar; el arreglo de los 10 sitios va después |
| ~~`otp_length`~~ | — | **descartada**: el largo es 4 o 6 según el **momento** (pagaré = 6), no según el país. Sin consumidor = próxima `iso_code_3` | no se agrega |

### Tipos de documento a nivel país

⚠ **Corrección verificada:** `lenders_by_allied_branches.document_types` **NO existe en producción** —
vive solo en `feature/motai-v2`. Así que el nivel sucursal está **sin construir en prod**, y eso
simplifica: no hay forma heredada con la que ser compatible, y el JSON de motai-v2 conviene
**reemplazarlo antes de mergear** en vez de mergear y migrar.

**Forma:** el catálogo lleva el país, porque **un tipo de documento se define por el país que lo acepta**
— `CED` es dominicano, `CC` colombiano, `PEP` lo emite Colombia para migrantes. No es un catálogo global
con aplicabilidad por país: son catálogos distintos.

```
document_types (id, country_id, code, name, description, regex, min_length, max_length, sort, status)
   UNIQUE (country_id, code)   -- `PAS` puede existir en los dos países con reglas distintas
```

⚠ **Sin `provider_codes`** (decisión de Miguel, correcta): el catálogo describe **qué es** un tipo de
documento; cómo lo llama Deceval es **mapeo de integración** y sobrecargaría la tabla con lógica de
negocio. Va en tabla propia (ver abajo). Y **`users.document_type` sigue guardando el código como
string** — no se convierte en FK ahora: 375.429 filas y todos sus consumidores.

**Y el contenido ya existe: está hardcodeado.** Poblarlo es transcribir las reglas que hoy viven en
código, no inventar reglas nuevas:

| País | Código | Regla de hoy | De dónde sale |
|---|---|---|---|
| CO | `CC` | solo dígitos, 5-10, rango `10000..3000000000` | closure de `PersonalInfoRequest` |
| CO | `CE` · `PEP` | `[A-Za-z0-9]{3,20}` | misma closure |
| DO | `CED` | **exactamente 11 dígitos** | `dynamic-step-one.ts` |
| DO | `CI_VE` | 6-11 dígitos | idem |
| DO | `PAS` · `PAS_VE` | `[A-Z0-9]{6,9}` | idem |

**Los niveles de abajo solo RESTRINGEN.** Comercio / sucursal / entidad eligen un subconjunto de los
tipos de su país — nunca agregan uno que el país no tenga. La resolución es la que ya eligió motai-v2
(unión de lo que habilitan las entidades de la sucursal, con piso), **intersectada con el catálogo del
país**. Sin esa intersección, una sucursal mixta ofrecería `CED` a un colombiano.

**Ámbitos: cuatro, no tres** — país · comercio · sucursal · **entidad**. El último hace falta porque hay
entidades con regla propia de documento (Magnocell acepta `CE` donde el gate general no).

### Qué MÁS estamos hardcodeando hoy que merece tabla (verificado)

**Sí vale tabla nueva:**

| Qué | Cómo está hoy | Forma |
|---|---|---|
| **Tipos de documento** | tres catálogos hardcodeados (zod enum · closure PHP · constantes TS) | `document_types` (arriba) |
| **Códigos por integración** | `DecevalSoap` mapea `CC=>1, CE=>2` en **3 sitios** y `WelliRegistrationData` otro; un código desconocido cae al `else` **en silencio** | `(integration_key\|lender_id, document_code, external_code)` — lo que sacamos del catálogo |
| **Burós/proveedores por país** | ⚠ **ninguna selección de buró mira el país.** Todos son colombianos (Experian/Datacrédito · TusDatos · Ágil Data · Mareigua · Quanto) → una solicitud RD llamaría a Datacrédito con una cédula dominicana | `risk_centrals` **ya existe** como tabla; falta la **N:M con `countries`** |
| **Reglas regulatorias del país** | ver abajo, los dos verificados | `country_regulatory_rates(country_id, effective_from, usury_rate, tax_rate)` — con **historia**, porque la usura cambia mensualmente y está certificada |

**Los dos regulatorios, verificados en código:**
- **Impuesto.** `PromissoryNoteController:378` calcula el fondo de garantías con `* (1 + (19 / 100))` y el
  comentario *«se pone fijo el iva para todos en 19%»* — con la línea que usaba `$lender->iva`
  **comentada justo arriba**. En RD el ITBIS es **18%**. Es un impuesto: pertenece al país, no al lender.
- **Tasa de usura.** **No se guarda en ninguna parte.** Sale de un form (`$request->usury_rate`) y hace
  un **UPDATE masivo destructivo** de `credit_line_by_lenders.rate` para todo lender que la supere,
  salteando el 140 y el país 60. No queda registro de cuál era el techo en cada momento, y se **pierde**
  la tasa configurada del lender.

**NO hagas tabla — ya tienen hogar:**

| Qué | Dónde va |
|---|---|
| Plantillas y SIDs de WhatsApp/SMS | **`messaging-service` ya los tiene** en tabla por `CountryISO2` (`WhatsAppConfig`, `LabsMobileConfig`). El hardcode de legacy muere **delegando**, no creando tabla |
| Capacidades por lender (los arrays `[218,219,221,222]`, `MANUAL_BIRTH_*`, Welli `[23,141,142,166]`…) | son **columnas/flags**, y `lender_requirements` ya arrancó ese patrón (`abaco_is_enabled`, `dynamic_form_is_enabled`) |
| Plantillas de documento por id (`consent_{id}.blade`) | una **columna** `consent_template`, no una tabla |
| IVA por comercio | la columna **`lenders_by_allieds.iva` ya existe y está poblada** — solo está desconectada. Pero resuelve el caso equivocado: el IVA es impuesto, va al país |

**Anotado, no ahora:** feriados por país (afecta fecha de corte y mora) — es de servicing.

### Los cuatro pasos
1. **Cargar las ciudades de RD.** ✅ Las **32 provincias ya están** (`country_zones` ids 934-965, códigos
   de 2 letras, todas `status=1`) — solo falta `country_cities`, que está en **0**. Se cuelgan de las
   zonas existentes; no hay trabajo de zonas.
   - ⚠ **Decidir qué va en `country_cities.code`.** Para Colombia es el código DANE de 5 dígitos y el
     nodo `bancolombia` documenta que *derivar el departamento del código de ciudad es lo correcto*. Para
     RD no hay consumidor todavía: usar el código de la ONE (o `provincia+secuencia`) y **documentarlo**,
     porque el día que exista un consumidor va a asumir el formato colombiano.
   - Alcance mínimo viable: **Distrito Nacional + provincia Santo Domingo**. Completar el resto después.
2. **Re-apuntar las 13 sucursales** a su ciudad RD real, según la tabla de arriba.
3. **Completar la fila 60 de `countries`** según la spec de arriba: `phone_code = '+1'`,
   `cell_phone_lenght` 11→**10**, `timezone = 'America/Santo_Domingo'`, `is_operating = 1`.
4. **Encender el invariante** ciudad↔país: la ciudad de una sucursal debe pertenecer a una zona del país
   de su comercio. Recién es posible después de (1) y (2).

### Lo que este entregable NO toca
Ni los 8 filtros literales, ni el resolvedor, ni el front, ni los tipos de documento. Todo eso viene
después y **no bloquea** esto. Lo único externo: el `phone_code` del paso 3 exige que exista antes la
config de `DO` en `messaging-service` (**P2**).

### Limpieza que conviene incluir
- **12 cableados muertos** del lender 160 a comercios colombianos (0 solicitudes).
- **2 comercios de prueba en producción** dentro del set RD: `Comercio Prueba` (2 sucursales) y
  `pruebaaaaaa` (0). Inflan cualquier conteo de comercios por país.
- **3 sucursales sin comercio** (`allied_id` no resuelve) de 2.212: sin país, no se pueden asignar a
  ninguna base.

## PLAN DE ACCIÓN — la secuencia ejecutable (consolida todo lo anterior)
> Esta sección es **el orden real de ejecución**; «Plan por bloques» queda como mapa temático y el
> «Paso a paso CreditopX» como detalle de ese producto. Etiquetas: **[dato]** = SQL/config, sin deploy ·
> **[código]** = rama en repo real (sin PR hasta que Miguel apruebe) · **[negocio]** = pregunta a personas.

### AHORA — sin tocar código de producción
- ~~**P1**~~ ✅ **HECHO contra prod** (`make trazador-sql`) — ver «Contraste contra producción». El
  reparto **no** se sostiene: en prod hay **1 conflicto** (SmartPay 160, cableado en 47 y 60).
- ~~**P1.bis** ¿se parte SmartPay 160 en dos filas?~~ ✅ **RESUELTO con datos: NO.** Su economía está en
  DOP (2.500–95.000) y sus **206 solicitudes son todas de país 60**; los cableados a comercios CO tienen
  **cero uso**. Es cableado muerto → se limpia, no se parte. F2 vuelve a ser mecánico.
- **P1.ter [código, previo a F1]** Confirmar por dónde se ofrece SmartPay: con `country_id = 60` el
  filtro literal `= 1` lo excluye de `getLenders`, y sin embargo tiene 206 solicitudes. Hay que saber si
  entra por su canal IMEI antes de tocar los ocho filtros.
- **P2 [dato]** `messaging-service`: ubicar dónde viven las filas de config (`LabsMobileConfig`,
  `WhatsAppConfig`) y **verificar/crear las de `DO`** — sin ellas el envío RD falla con `ErrNotFound`.
- **P3 [dato]** Poblar `countries.phone_code`: `'+57'` en 47, `'+1'` en 60 (**después** de P2).
  ✅ **Confirmado en prod que está NULL**, y `dial_code` viene **sin `+`** (`57`, `1`) mientras los 11
  lectores concatenan crudo → el valor va **con** `+`. Riesgo bajo: para CO es no-op (igual al fallback);
  para RD corrige el prefijo. Enciende los 11 lectores.
- **P3.bis [negocio]** `cell_phone_lenght` de DO = **11** en prod (CO = 10). Decidir si significa
  «con el 1» o si está mal, **antes** de que Fr3 lo lea.
- **P4 [dato]** Unificar notación de `locale` (4 filas `es_XX` → `es-XX`, BCP-47 como `Intl`).
- ~~**P5** ¿el consentimiento del 152 está mal para RD?~~ ✅ **RESUELTO**: en prod el 152 es
  **Refurbicredit** (colombiano) y el documento lo nombra correctamente. Era ruido del dump de dev.
  Queda la versión chica: **qué documento firma el 160**, que no tiene blade propio.
- **P5 [negocio]** ¿RD corre solo SmartPay o más canales? (9 comercios y 13 sucursales en país 60, de los
  cuales `Comercio Prueba` y `pruebaaaaaa` son **de prueba, en producción**).

### ETAPA 1 — migraciones aditivas (`legacy-backend`, una rama) [código]
- **M1** `countries`: `+ is_operating` (true solo 47/60) · `+ otp_length` (default 4) · re-seed de
  `phone_code` **por `iso_code_1`** (la migración que no falle esta vez). **No renombrar nada** (el
  form-service lee estas columnas).
- **M2** ~~`allied_branches.country_id`~~ **se cae**: es derivable de `allied_id → allieds.country_id`
  (ver el modelo acordado). En su lugar: **endurecer `allieds.country_id`** como única fuente —
  `NOT NULL`, sin default, y dejar EXPLÍCITO que es inmutable (hoy lo es por accidente: no está en el
  `->only([...])` de `AlliedController::update`; el día que alguien lo agregue, "cambiar el país" pasa a
  significar "mover de base de datos"). Y el **invariante ciudad↔país** como check al escribir, que
  tampoco necesita columna — bloqueado hasta cargar las ciudades de RD.
- **M3** `user_requests`: `+ country_id / locale / currency` (snapshot). Escribirlo en **los tres
  gemelos** de creación: `UserRequestController` (G1) · `UserRequestService` (G2) ·
  `FindOrCreateService` (G3).
- **M4** Quitar el `DEFAULT 1` de `lenders.country_id` y `allieds.country_id` (queda obligatorio al
  escribir): que "sin definir" vuelva a ser distinguible de "definido mal".

### ETAPA 2 — los 8 filtros literales, con transición sin ventana [código, 2 ramas]
- **F1** Los 8 `->where('country_id', 1)` → `->whereIn('country_id', [1, $paisResuelto])`
  (3 en legacy · 5 en application). Deploy. *Acepta ambos mundos durante la transición.*
- **F2** Backfill `lenders.country_id`: los **129 UPDATE** del dry-run (`SQL=1`) + decidir a mano los
  **23 huérfanos activos** (o apagarlos).
- **F3** Limpiar el `1` del `whereIn` → `->where('country_id', $paisResuelto)`. Deploy. Fin: la columna
  vuelve a ser configuración.

### ETAPA 3 — el resolvedor y el gobierno de la sucursal [código]
- **R1** `session('alliedCountry')` ← país de la **sucursal** (fallback comercio). Es el cambio chico
  con blast radius grande: gobierna el gate del wizard.
- **R2** Un `CountryContext` único (precedencia sucursal → comercio → default) + test que la fije.
  Unificar los **4** `$isDoLogic` copiados y el `'do':'co'` para que lean de ahí.
- **R3** `application`: los **7 `'+57'` pelados** (incl. el accessor `User.php:133`) → prefijo del país
  del contexto, como ya hace legacy. Y los 2 `genderapi country=CO` + el `?? 'COLOMBIANA'` de
  `OnboardingPayloadBuilder:129` (+ su gemelo en pdf-mapper-editor).

### ETAPA 4 — front [código, `frontend-monorepo`]
- **Fr1** `partner-info` devuelve `country: { iso2, dial_code, phone_length, otp_length, locale,
  currency, document_types[] }` → el wizard deja de comparar `=== 60`.
- **Fr2** Moneda: `formatCurrencyWithSymbol` toma locale/currency del payload y
  `maximumFractionDigits` **por moneda** (el `0` actual le borra los centavos al DOP); migrar los 58
  formateos manuales al helper (los del flujo de solicitud primero).
- **Fr3** `PhoneField` único por país (mata los ≥6 sitios con "10 dígitos"/`+57` cableados) +
  `normalizePhoneE164` con libphonenumber (hoy etiqueta a los RD como `+57` en analítica).

### ETAPA 5 — tipos de documento [código + dato]
- **D1** Catálogo `document_types` + `document_type_scopes` + resolvedor (unión ∩ catálogo del país).
- **D2** Decidir el destino de `lenders_by_allied_branches.document_types` (json de motai-v2): migra o
  se reemplaza **antes** de mergear — no las dos.
- **D3** Los mapas por proveedor (`provider_codes`) y quitar los default `'CC'` fail-open.

### ETAPA 6 — validación y guardrail [código, playground]
- **V1** Eje `country` en el harness (comercio RD e2e; con el bloqueador F-21 documentado).
- **V2** Guardrail CI: prohibir `=== 60`, `== 47`, `'+57'`, `es-CO`, `in:CC,CE,PEP` fuera de la capa
  de config — lo único que evitó la recaída en motai-v2.

**Fuera de este alcance, ya anotado:** `America/Bogota` ×10 y `'COP'` en la firma de Wompi (fase
CreditopX-3: formalización/pagos por país) · geo de RD (INSERT diferido) · i18n de textos (CO y RD
comparten español) · timezone de servicing.

## Paso a paso para internacionalizar CreditopX
CreditopX (rt=2/3 in-platform) es el corte correcto para arrancar: **CreditOp decide con datos locales**,
así que no hay contrato con un tercero que renegociar por país — al revés de los agregadores rt=1, que son
instituciones colombianas. Y ya hay prueba de vida: **SmartPay RD es un miembro de la familia corriendo en
país 60**. La vara de éxito: **dar de alta el tercer país sin escribir código**.

**Fase 0 · Que el dato diga la verdad** *(sin código nuevo; bloquea todo lo demás)*
1. ✅ **HECHO** — `make harness-paises` (`harness/dev/paises.ts`, read-only; `SQL=1` imprime los
   UPDATE sin ejecutarlos). Corrida contra **local** (2026-08-05): **156 entidades → 129 a poblar ·
   0 en conflicto · 26 sin cablear (23 activas) · 1 ya correcta** (SmartPay 153).
   - **Cero conflictos**: hoy ninguna entidad está cableada en sucursales de dos países, así que el
     backfill es inequívoco para las 129. La única que no es CO es **SmartPay 152 → 60**.
   - **Radio de explosión: 128 entidades ACTIVAS** saldrían del default 1 al poblar → con los tres
     filtros literales vivos, desaparecen del listado sin error. **Los filtros van primero.**
   - Las 23 huérfanas activas se resuelven a mano (o se apagan si están muertas).
   - Confirmado de paso el desacuerdo de sucursal: **1** con comercio DO y ciudad CO.
   - Falta correrlo contra **dev/prod**: el reparto puede ser otro.
2. Backfill de `lenders.country_id` **y recién después** matar los **ocho** `->where('country_id', 1)`
   (3 en `legacy-backend` + 5 en `application`). En ese orden: al revés el listado queda vacío.
3. Poblar `countries` para CO y RD (aditivo: `phone_code`, `address_format`, `locale`, `currency`) + agregar
   `is_operating`, `otp_length`, `date_format`, `template_suffix`.

**Fase 1 · El país de la operación**
4. `allied_branches.country_id` con invariante contra `country_city_id`.
5. `session('alliedCountry')` pasa a leer la **sucursal**; `allieds.country_id` queda como origen/fallback.
6. `user_requests` **congela** país + locale + moneda al nacer (snapshot, no join).
7. Un resolvedor único con la precedencia escrita, y un test que lo fije.

**Fase 2 · Alta de un lender CreditopX en el país N — la prueba de fuego**
Todo esto ya cuelga de `lender_id`, así que **una fila por país lo resuelve solo**. Es checklist de datos:
8. `lenders` (country_id = N) + `credit_line_by_lenders` en moneda local + `lender_users_categories` y sus
   reglas (`min_income`, `max_amount` en moneda local) + tramos + `creditop_x_lender_configuration`.
9. Cablearlo en `lenders_by_allied_branches` de las sucursales de ese país, **con la validación de país**.
10. Empaquetarlo como **seeder**. Si el alta necesita tocar código, no está internacionalizado.

**Fase 3 · Lo que en rt=2 es colombiano y hay que parametrizar** *(el trabajo real)*
11. **Riesgo/burós.** El gate de datacrédito **pasa si no hay regla** (`DatacreditoRuleEvaluator`: sin regla
    → skip), y `application` ya bloquea crear reglas para comercios no-CO (`addNewRule:80`). Pero **el
    gemelo de `legacy-backend` NO tiene esa compuerta** (`AlliedManagementService`): una sucursal RD creada
    desde legacy recibe reglas colombianas → y ahí el evaluador es **fail-closed** (`no_datacredito_data`)
    → no se ofrece nada. **Es el primer arreglo de esta fase.** Y decisión de negocio: en un país sin buró,
    ¿el riesgo lo lleva solo la categoría de perfilamiento?
12. **Formalización.** Pagaré Deceval + garantía + Netco son colombianos. SmartPay RD ya demostró el
    reemplazo (un solo acuerdo de bloqueo), pero por `if id==160`. Llevarlo a config
    (`promissory_type_id`, `signing_provider_id`, plantilla de consentimiento).
13. **Cuota inicial.** rt=2 con `initial_fee > 0` va a Wompi/Payvalida, y Payvalida está quemado al country
    `343` (Colombia). Sin pasarela local: o el enganche es 0 en ese país, o hay pasarela por país.
14. **Regulación.** La usura es colombiana y ya hay dos hardcodes que lo reconocen
    (`updateUsuryRate` saltea `country_id == 60`; `calculateRate` bifurca en `!= 60`). Volverlos regla de
    `countries`, no un `60` literal.

**Fase 4 · Front** — país como payload en `partner-info` → `PhoneField` por país → documentos del catálogo
→ moneda/formatos en todas las respuestas → converger el fork del wizard RD.

**Fase 5 · Prueba** — eje `country` en el harness con un comercio RD. Bloqueador conocido: `isSmartPay()`
hardcodea el lender 160, así que la originación distintiva **no es ejercitable** fuera de producción (F-21).

## Decisiones abiertas
- ~~¿Se arranca por enriquecer la geolocalización?~~ **RESUELTO (2026-08-05):** no. El árbol geo ya existe
  y es de 3 niveles (RD ya tiene sus 32 provincias); lo que falta son datos (ciudades de RD) con payoff
  diferido. Se arranca por **`countries` como fila de config** → tipos de documento →
  `allied_branches.country_id`. Detalle en «Por dónde arrancar».
- ~~¿Cuál país manda?~~ **RESUELTO (2026-08-05, Miguel):** manda el de la **SUCURSAL** — es donde se
  atiende al cliente, y de ahí salen el prefijo del celular, los burós, la moneda y los documentos. El del
  **comercio** queda como país de **origen/reporte** (y fallback); el de la **entidad** significa "en qué
  moneda está denominada esa fila"; el del **usuario** es otro eje (de dónde es la persona). La
  `user_request` **copia** el de la sucursal al nacer (snapshot, no join vivo).
- **¿`phone_code` sobrevive o se queda solo `dial_code`?** Son dos columnas para lo mismo y una está vacía.
  Elegir una antes de que el código nuevo lea la equivocada.
- **¿Se congela el país en `user_requests`?** Sin snapshot, corregir el país de una sucursal reescribe
  moneda/documentos/plantillas de solicitudes ya firmadas. Yo lo agregaría; es decisión de negocio.
- **¿`allied_branches.country_id` entra en esta tarea o es prerequisito aparte?** Sin él, "sucursales en otro
  país" no existe; con él, hay que revisar la copia de reglas por sucursal (37.284 copias) y `Rule::in([47,60])`.
- **¿Se converge el fork de RD (A4) o se acepta un wizard por país?** Convergir es más trabajo ahora y es lo
  único que hace que el país N+1 sea configuración.
- **¿i18n de verdad, o "un idioma, N países"?** CO y RD comparten español: si el próximo mercado también, D12
  se puede diferir y el 80% del dolor está en documentos, moneda y formatos.
- **¿`lenders_by_allied_branches.document_types` (json, en `feature/motai-v2`) se mergea y luego migra a la
  tabla nueva, o se reemplaza antes de mergear?** No hacer las dos.
- ¿RD corre **solo** SmartPay u otros canales? (pregunta ya abierta en el nodo `smartpay`).

## Trampas verificadas (arreglar antes de construir encima)
- **`countries.phone_code` está vacío en las 250 filas.** La migración `2026_02_20_100000_add_phone_code_…`
  siembra con `where('iso_code_2','CO')`/`'DO'`, pero **`iso_code_2` guarda el alpha-3** (`COL`, `DOM`): las
  dos UPDATE matchearon 0 filas. Las columnas están corridas — `iso_code_1`=alpha-2, `iso_code_2`=alpha-3,
  `iso_code_3` vacío. Importa doble: `PhoneService::resolveCountry` devuelve alpha-2, así que cualquier join
  contra `iso_code_2` falla. **Verificado en la BD local; falta confirmar en dev/prod.**
- **`Country::$fillable` declara `cell_phone_length` y la columna es `cell_phone_lenght`** (typo) → ese
  fillable no escribe nada. `dane_code` del fillable tampoco existe en la tabla.
- **`locale` en dos notaciones**: la tabla dice `es-CO` (estilo `Intl`) y el PDF de SmartPay usa `es_DO`
  (estilo PHP/Carbon, `DeviceLockAgreementService.php:164`). Elegir una y convertir en el borde.
- Solo **6 de 250** filas de `countries` tienen `locale`; `currency` igual. `dial_code` viene **sin `+`**
  (`57`, `1`) mientras el código compara contra `'+57'`.
- `Country::COLOMBIA_ID = 47` existe **solo en `application`**; `legacy-backend` no lo tiene.
- **`users.issue_country` está en 0 filas y SÍ se lee**: `$user->issue_country ?? 'COLOMBIANA'`
  (`OnboardingPayloadBuilder.php:129`) → todos los documentos generados afirman nacionalidad colombiana,
  incluidos los de RD. Arreglo barato y visible.
- **`users.country_id` es la cuarta columna de país y nadie la lee**: 215.844 filas en el default 1 contra
  12.183 en 47 y 1 en 60. Algo escribe 47 a veces: hay que encontrar qué antes de darle semántica.
- **Hay TRES filtros literales `->where('country_id', 1)`** sobre `lenders`, no dos:
  `LenderRetrievalService:458`, `OnboardingService:1782` y `Identity/LenderRepository:52`.
- **`countries.status` no discrimina**: las 253 filas están en 1. Hoy no hay forma de expresar "operamos
  en este país", que es justo lo que necesita la regla de habilitación por sucursal.
- **`address_format` está vacío en las 253 filas** y `country_zones.code` está sucio (419 numéricas de
  4.110; en CO `EXT`/`MED`/`TODOS`) → no derivar el país de la solicitud por ese camino.

## Material de QA y backlog (heredado de la tarea 44, que se eliminó el 2026-08-09)

> ⚠ Esto está **arriba** de la marca publicable a propósito: NO se publica solo. La descripción que hoy
> vive en CORE-365 es la de este archivo; lo de abajo es lo que le faltaría al ticket para que QA pueda
> validar sin preguntar. Subirlo es una decisión, no un automatismo.

### Lo que NO entró en las ramas, y por qué (backlog real)
- **La corrección de los puntos de venta dominicanos. SIGUE PENDIENTE** — las 3 migraciones **no la
  hacen**, y es a propósito: sembrar las ciudades es la *precondición* (antes no había a dónde
  moverlos), no la corrección. **Re-medido en prod el 2026-08-18: son 16, no 13**, y las 16 son
  comercios dominicanos apuntando al «SANTO DOMINGO» de Antioquia. Cruzadas las direcciones contra los 8
  municipios sembrados, **solo 3 se resuelven solas**: 2201 → `SANTO DOMINGO ESTE`, 2234 →
  `LOS ALCARRIZOS`, y 2221 → `PEDRO BRAND` (⚠ ésta se contradice: la dirección dice «Pedro Brand» *y*
  «Santo Domingo Oeste»). Las otras 13 hay que **preguntárselas al comercio**: 2 no tienen dirección
  usable («Tienda 1», «Tienda 2») y varias son «Autopista Duarte km N», que cruza varios municipios. El
  comando `paises:auditar-sucursales` imprime la dirección de cada uno justamente para esto.
- **El registro de países mal cargado.** La fila `countries.id = 1` se llama «Afghanistan» y tiene moneda
  e idioma de Colombia; a ella apuntan **186 entidades y 364.527 usuarios**. Hoy es inocuo porque el
  camino vivo resuelve por comercio, que apunta a la fila correcta. **Tarea aparte por ser destructiva**,
  y en el mismo cambio tienen que ir las 8 consultas con id de país fijo o el listado de crédito queda
  vacío.
- **Consolidar la resolución del país en el backend.** Las 4 copias de `currency_format` y las 4 de la
  heurística `$isDoLogic` siguen repartidas. Nada se comporta mal hoy por eso: es orden.
- **El valor por omisión del formateador de plata del front.** De 28 llamadas, 21 no pasan el idioma y
  caen a Colombia en silencio. Quitarlo obliga a tocar esas 21 — merece su propio PR.
- **La semántica de `cell_phone_lenght`.** Dice 10 para Colombia y 11 para RD, y los dos móviles
  nacionales son de 10 dígitos. Sin definir eso, no se puede validar largos con esa columna, así que **no
  se expone al front**.

### Cómo se validaría y criterios de aceptación
### En una línea
El país del comercio pasa a ser configuración que el sistema consulta, en vez de estar escrito dentro del
programa como «Colombia».

### Por qué
Llevamos cinco meses originando crédito en República Dominicana con el país escrito en el código, y eso ya
produce datos incorrectos: los puntos de venta dominicanos quedaron registrados en una ciudad de Colombia
que se llama igual, los mensajes salen con el prefijo telefónico colombiano y los contratos dominicanos
dicen «COLOMBIANA». No falta funcionalidad: falta que el país sea un dato que el sistema consulte.

### Qué cambia
- El **prefijo telefónico** sale del país del comercio. El dato ya existía, pero estaba guardado en una
  columna que el sistema no lee.
- Se cargan las **ciudades de República Dominicana**. No había ninguna, y por eso el selector sólo podía
  ofrecer ciudades colombianas.
- El **selector de ciudad del admin** sólo ofrece ciudades del país del comercio. Si el comercio es
  dominicano, la ciudad colombiana ya no aparece.
- Los **documentos** toman la nacionalidad del país del comercio cuando no está el dato del cliente, en
  vez de decir siempre «COLOMBIANA».
- El **país viaja al flujo de solicitud**: la pantalla del teléfono y la de datos complementarios lo usan
  en vez de asumir Colombia.
- Se agrega una **revisión** que lista los puntos de venta cuya ciudad está en otro país que su comercio.

### Alcance
- Aplica a los comercios de República Dominicana y a los de Colombia por igual: cada uno recibe su país.
- **Colombia no cambia.** Antes obtenía «+57» por omisión y ahora lo obtiene del dato: es el mismo valor.
- **No** corrige los puntos de venta ya mal registrados: eso necesita confirmar la dirección con cada
  comercio.
- **No** valida el largo del número de celular: ese dato está definido de forma ambigua entre los dos
  países y se decide aparte.
- Si el país no se puede determinar, todo se comporta como antes: ninguna pantalla queda bloqueada.

### Dónde probar
- Ambiente de pruebas · un comercio de República Dominicana y uno de Colombia.
- **Precondición:** el comercio dominicano debe tener el país configurado y al menos un punto de venta.

### Cómo validar
1. **Admin, comercio dominicano** → editar un punto de venta → el selector de ciudad sólo ofrece
   municipios dominicanos. Buscar una ciudad colombiana no devuelve nada.
2. **Admin, comercio colombiano** → el selector sigue ofreciendo las ciudades de siempre (regresión).
3. **Solicitud en comercio dominicano** → el documento generado dice «DOMINICANA».
4. **Solicitud en comercio colombiano** → el documento sigue diciendo «COLOMBIANA» (regresión).
5. **Revisión** → correr `paises:auditar-sucursales`: lista los puntos de venta mal registrados y no
   modifica nada.

### Criterios de aceptación
- Un comercio dominicano no puede quedar con una ciudad de otro país desde el admin.
- Un comercio colombiano se comporta exactamente igual que antes en las cuatro pantallas tocadas.
- El documento de una solicitud dominicana no dice «COLOMBIANA».
- Si el país de un comercio no está configurado, el flujo sigue funcionando con el comportamiento actual.

## Bitácora
- **2026-08-05** — Tarea abierta en evaluación. Barrido de contexto + verificación contra `main` de los dos
  repos y la BD local: las tres nociones de país, el fork de RD, los 28 archivos con `'+57'`, el predicado
  `isDoLogic` cuadruplicado, y el estado real de `countries`. Hallazgo que orienta el diseño:
  `lenders_by_allied_branches.document_types` ya existe y está poblada (6231/6231) **sin ningún lector en
  `main`** — el problema no es la forma de la tabla, es que nada la consume y los catálogos hardcodeados
  siguen vivos. Pendiente: cerrar las decisiones abiertas y recién ahí escribir `jira_title` + afinar la
  sección publicable.
- **2026-08-05 (2)** — Aterrizado el arranque. Censo de columnas de país: son **cuatro** y tres mienten
  (`lenders` 155/156 en el default, `users` 215.844 en el default sin lector, `issue_country` vacía pero
  leída). El defecto raíz es `DEFAULT 1`, que hace indistinguible "sin definir" de "definido mal".
  Descartado arrancar por geolocalización: el árbol ya es de 3 niveles y **RD ya tiene sus 32 provincias**
  — falta cargar sus ciudades (0), pero el wizard RD no consume `country_cities` (las toma de constantes /
  del forms-service), así que es un INSERT diferido y no un diseño. Orden acordado: `countries` como fila
  de config → tipos de documento → `allied_branches.country_id` (con invariante) → geo como ticket de datos.
  Sumado el hueco de snapshot en `user_requests`. En `flow` quedó el modelo visible: un select de país por
  nodo de config, con el estado real de cada columna.
- **2026-08-05 (3)** — Resuelta la duda de Credifamilia: el **form-service NO creó tablas propias**, lee
  `countries` / `country_zones` / `country_cities` legacy y es **read-only** (solo escribe
  `user_field_values`). Además ya SELECTea la fila completa de `countries` — incluidas `phone_code`,
  `cell_phone_lenght` y `address_format`, que hoy le llegan vacías. Dos correcciones al plan: los cambios
  a `countries` son **aditivos** (renombrar el typo o las ISO rompe queries de otro repo con deploy
  propio) y **`status` NO se puede reutilizar** como "operamos acá" porque es gate vivo de los tres
  SELECT del form-service → `is_operating` aparte.
- **2026-08-05 (4)** — **Decidido: manda el país de la SUCURSAL.** Los cuatro niveles quedan con semántica
  separada (sucursal = opera · comercio = reporta/origen · entidad = moneda de la fila · usuario = de dónde
  es la persona) y la `user_request` copia el de la sucursal al nacer. Con eso el resolvedor ya se puede
  escribir. Hallazgo que sale de la misma decisión: **la selección de burós no mira el país en ningún
  lado** — todos los proveedores son colombianos y RD solo lo esquiva por el hardcode de `isSmartPay`. Se
  suma "proveedores por país" como dimensión del catálogo (bloque A.bis).
- **2026-08-05 (5)** — **Paso 1 ejecutado.** `make harness-paises` (dry-run, no escribe). En local:
  129 entidades a poblar, **0 conflictos**, 26 sin cablear, y un radio de explosión de **128 activas**
  que saldrían del default 1 — confirma que los tres filtros literales se arreglan ANTES del backfill.
  La única entidad no colombiana inferida es SmartPay 152 → 60. Pendiente: correrlo contra dev/prod.
- **2026-08-05 (6)** — Auditoría de uso del país en los 4 repos. Hallazgo que corrige el plan: **la
  mensajería YA está parametrizada** — 11 lectores de `countries.phone_code` con fallback `'+57'` — y
  está inerte porque la columna está vacía en las 253 filas. Poblarla son dos UPDATE y arregla el
  prefijo de OTP/notificaciones/voucher/Twilio para RD. También: `America/Bogota` quemado en **7**
  sitios (incluida la fecha de firma de documentos), el helper de moneda del front tiene default
  `es-CO`/`COP` **y `maximumFractionDigits: 0`**, que le borra los centavos al DOP, y
  `pre-approvals-service` es agnóstico de país.
- **2026-08-05 (7)** — Auditoría completada sobre los **13** repos locales (la anterior cubría 4). Dos
  hallazgos que cambian el paso 1: **`messaging-service` ya es country-first** (config de proveedor y de
  plantilla por `CountryISO2` en tabla, sufijo derivado del ISO, proveedor SMS **LabsMobile**, y falla
  explícito si no hay config) → poblar `phone_code` no alcanza, hay que crear las filas de config de
  `DO` en el MS. Y **`onboarding-forms-service` está hardcodeado a RD** (`countryISO3166Alpha3Prefix =
  "dom"`, con TODO propio): un servicio asume CO y el otro DO, y los dos alimentan el mismo wizard.
  Menores: `creditop_mobile` con `+57` en router y Cognito, `dynamic-form` con un mapa país→prefijo ya
  hecho, `pdf-mapper-editor` con el segundo `'COLOMBIANA'`. **Pendiente: `legacy-application` está
  contado (83 en 56 archivos) pero no auditado línea por línea.**
- **2026-08-05 (8)** — `legacy-application` auditado. **Corrección: los filtros literales
  `country_id = 1` son OCHO, no tres** (5 viven en application). Es el repo menos parametrizado: `'+57'`
  pelado en 7 sitios —incluido un accessor del modelo `User`— sin el fallback de config que sí tiene
  legacy; `'COP'` en 9 sitios de pagos, y en Wompi **entra en la firma** de la transacción; 3
  `America/Bogota` más (10 en total); `47` quemado hasta en el front Vue. Precedentes buenos a copiar:
  el menú del admin filtra por país con una lista y el select de departamentos usa el país del comercio.
  Y un pendiente para negocio: el consentimiento del lender 152 ("smartpay", cableado a la sucursal RD)
  es un contrato 100% colombiano.
- **2026-08-05 (10)** — **Censo corrido contra PRODUCCIÓN** (modo `-sql` nuevo del trazador, vía Redash,
  solo agregados). Confirma `phone_code` NULL y `issue_country` 0/375.429, y **corrige tres cosas**: hay
  **1 conflicto de país y es SmartPay 160** (cableado en comercios 47 **y** 60 → F2 deja de ser
  mecánico); el **160 es rt=2 con country_id 60 bien puesto**, lo que resuelve dos preguntas abiertas del
  nodo `smartpay`; y la alerta del consentimiento colombiano **se disuelve** — en prod el 152 es
  *Refurbicredit*, no SmartPay. Aviso general: **los ids no coinciden entre ambientes**, así que ninguna
  conclusión sobre un lender puntual sacada del dump local vale. Además: `cell_phone_lenght` de DO es
  **11** en prod (no 10) y hay **cero usuarios en país 60**.
- **2026-08-05 (11)** — Investigado el 160 contra prod: **el conflicto es cableado muerto**. Economía en
  DOP (2.500–95.000), `path_id=2` (IMEI), **206 solicitudes todas de país 60** y **cero** por los
  comercios colombianos cableados. No se parte la fila: se limpian los cableados. F2 vuelve a ser
  mecánico. El documento tampoco es problema — el acuerdo de bloqueo saca locale/moneda del país del
  **comercio**, así que se adapta solo. Queda un hilo: con `country_id=60` el filtro `= 1` debería
  excluirlo del listado y aun así originó 206 veces → confirmar que entra por el canal IMEI antes de
  tocar los ocho filtros.
- **2026-08-05 (12)** — **Pivote de equipo: BD por país.** Comercios y entidades primarias con
  asociación a país, sucursales heredan, diseñado para replicar a una base por país. Registrado con las
  dos decisiones que obliga (el comercio pasa a ser por país → hace falta un nivel `grupo` global; y qué
  tablas son globales vs por país, porque en MySQL no hay join entre bases) y con la observación de que
  la herencia hoy **se copia**, lo que es el peor punto de partida para shardear. Hallazgo colateral
  verificado en prod: **el hash de sucursal tiene 4 colisiones** — es `crc32` de un timestamp al segundo,
  así que dos sucursales creadas en el mismo segundo comparten hash. Va como finding aparte (F-103):
  es un bug de hoy, no de multipaís, y bajo BD por país el hash sería la llave de RUTEO.
- **2026-08-05 (13)** — **Modelo cerrado y M2 corregido.** Miguel señaló —con razón— que
  `allied_branches.country_id` es innecesario: se deriva de `allied_id → allieds.country_id`. Mi
  argumento del shard key no aplicaba (el join de extracción se hace una vez, antes de partir, y después
  del split la columna es una constante: la misma enfermedad del `country_id = 1`). Se cae la columna;
  queda `allieds.country_id` endurecido como única fuente. El snapshot de `user_requests` sobrevive por
  otra razón: no es shard key, es hecho histórico. Y la tabla `countries` se queda aunque tenga una fila
  —es el registro de configuración del tenant, las subtablas la necesitan de padre y el form-service la
  consulta—, con la razón de fondo de que así el backend es UN artefacto desplegado N veces en vez de N
  configs divergiendo. Se destapa que la geo de RD sube de diferida a **prerequisito**.
- **2026-08-05 (14)** — **Aterrizado el primer entregable: «el paso DO».** Confirmado con montos que la
  operación RD es REAL (207 solicitudes del lender 160: min 1.100 · prom 9.257 · max 70.000 → en DOP es
  un celular; en COP serían USD 2 y no financia nadie). Lo que está mal es sólo el dato de ciudad: las 13
  sucursales apuntan a **«SANTO DOMINGO» de Antioquia**, un municipio colombiano que existe — el error es
  invisible a ojo. Sus direcciones son inequívocamente dominicanas, así que el re-apuntado es mecánico.
  Las 32 provincias de RD ya están cargadas y limpias; solo faltan las ciudades. Alcance del entregable:
  cargar ciudades → re-apuntar 13 → completar la fila 60 → encender el invariante. **Corregido el conteo
  de RD: 9 comercios / 13 sucursales** (antes dije 7/11), de los cuales 2 son de prueba en producción.
- **2026-08-05 (15)** — **Cerrada la spec de columnas y de tipos de documento.** `countries`: `phone_code`
  es la canónica del prefijo y lleva el `+`; `cell_phone_lenght` se define como dígitos **nacionales** y
  por eso DO baja de 11 a **10**; se agregan **`is_operating`** y **`timezone`** (hay 10 `America/Bogota`
  quemados, uno en la fecha de firma de documentos); se **descarta `otp_length`** porque el largo lo
  decide el momento, no el país. Y **corrección verificada: `lenders_by_allied_branches.document_types`
  NO existe en producción** —solo en `feature/motai-v2`—, así que el nivel sucursal está sin construir y
  el JSON conviene reemplazarlo **antes** de mergear. El catálogo de documentos lleva `country_id` porque
  un tipo se define por el país que lo acepta, y **su contenido ya está hardcodeado**: poblarlo es
  transcribir las reglas de `PersonalInfoRequest` (CO) y `dynamic-step-one.ts` (DO).
- **2026-08-05 (16)** — `provider_codes` **sale** del catálogo de documentos (decisión de Miguel: es
  mapeo de integración, no definición del tipo) → tabla propia. Y relevado **qué más merece tabla**:
  códigos por integración (Deceval mapea en 3 sitios, fail-open), **burós por país** (`risk_centrals` ya
  existe, falta la N:M — hoy ninguna selección de buró mira el país) y **reglas regulatorias con
  historia**, con dos hallazgos nuevos verificados: el **IVA está quemado en 19%** en el cálculo del
  fondo de garantías con la línea de `$lender->iva` comentada al lado (en RD el ITBIS es 18%), y la
  **tasa de usura no se guarda en ninguna parte** — sale de un form y hace un UPDATE masivo destructivo
  de las tasas, sin registro histórico. Y lo que NO merece tabla porque ya tiene hogar: plantillas de
  mensajería (están en `messaging-service` por país), capacidades por lender (`lender_requirements`) y
  plantillas de documento (una columna).
- **2026-08-05 (9)** — Consolidado el **PLAN DE ACCIÓN ejecutable**: P1-P5 ahora (datos/preguntas, sin
  deploy) → M1-M4 migraciones aditivas → F1-F3 los 8 filtros con `whereIn` transicional (sin ventana de
  listado vacío) → R1-R3 resolvedor + sucursal gobierna → Fr1-Fr3 front → D1-D3 documentos → V1-V2
  harness y guardrail. Las secciones anteriores quedan como mapa/detalle.
- **2026-08-09** — **A pruebas.** Medido el estado real: la implementación existe en **3 ramas
  `feature/pais-como-dato`**, un commit de trabajo por repo, que hasta hoy eran **solo locales**.
  Qué trae cada una:
  - **backend** (`feat(paises)…`, 9 archivos, +554): el país se expone al front (`AlliedInfoController`),
    entra al payload de onboarding con la nacionalidad, un comando de auditoría de país por sucursal, y
    **3 migraciones** — poblar `phone_code` desde `dial_code`, agregar nacionalidad a `countries`, y
    **sembrar las ciudades de República Dominicana** (justo el hueco que el censo había marcado en 0).
    Incluye **2 archivos de test unitario** (nacionalidad del payload y resolución de país del teléfono).
  - **wizard** (`feat(wizard)…`, 5 archivos, +128): el país del comercio llega por el tema del aliado y
    las pantallas de teléfono y de información adicional lo usan en vez de asumir Colombia.
  - **admin** (`fix(admin)…`, 3 archivos, +62): los dos selectores de ciudad filtran por el país del
    comercio.

  Hecho hoy: **las 3 ramas se pushearon** (autorizado explícitamente), **CORE-365** recibió la
  descripción publicable y pasó a **🧪 En pruebas**; los **5 puntos ya estaban** puestos en el ticket.
  ⚠ Ojo con el campo: el board CORE puntea en **`customfield_10036` («Story Points»)** — 8 de 8 tickets
  medidos lo usan y ninguno usa `customfield_10016`, que es el que devuelve vacío si uno consulta el
  equivocado.

  **Pendiente y bloqueante para QA:** abrir los PRs (no se pudo desde acá: `gh` sin sesión) y desplegar.
  Y los cambios de **Motai siguen fuera de `main`**, así que los PRs pueden pedir rebase.

- **2026-08-18** — **El backend llegó a `staging`: portado, probado, mergeado, desplegado y migrado.**
  El encargo era pasar lo trabajado sobre `main` a `staging` partiendo de que «staging va más
  adelantado». **Medido, esa premisa es cierta a medias:** en `legacy-backend`, `staging` bifurcó de
  `main` el 22-07 y **`main` lleva 123 commits que `staging` no tiene**, contra 24 propios de staging; en
  `frontend-monorepo` sí va adelante (main 5 / staging 15). Y apareció una tercera rama viva, **`qa`**
  (105 commits sobre staging), que es la que el harness llama «staging».

  **El port.** Simulado antes de tocar nada con `git merge-tree` (no escribe): a `staging` el commit
  entra **limpio** en backend y en wizard —los archivos tocados son byte-idénticos entre main y
  staging—; a `qa` **choca** (backend en `AlliedInfoController`, wizard en `allied-theme.repository.ts` y
  `allied-theme.ts`), justo el rebase por Motai que esta tarea venía anticipando. Se siguió la convención
  que el repo ya usa (`*-onto-staging`, con dos ramas así ya mergeadas): rama
  `feature/pais-como-dato-onto-staging` desde `origin/staging` + cherry-pick. ⚠ Ojo con un detalle que
  casi muerde: `git checkout -b … origin/staging` deja el **upstream apuntando a `staging`**, así que un
  `git push` pelado podría querer escribir en la rama de ambiente (lo salvó que `push.default` es
  `simple`, que rechaza cuando los nombres difieren). Se pusheó con refspec explícito.

  **La prueba de las migraciones, antes de subir.** El local **ya no servía como banco**: estaba migrado
  desde el desarrollo (`phone_code` poblado, columna `nationality`, 8 ciudades RD), o sea que probaba el
  estado final, no el camino. Y un `rollback` estaba descartado porque las 3 están en los lotes 182-184 y
  el último es el 188 — se habría llevado migraciones ajenas. Así que se armó una **BD de scratch**
  (`creditop_stgtest` en el MySQL local) forzada al **pre-estado exacto medido en staging**: sin columna
  `nationality`, `phone_code` NULL en las 253 filas, 0 ciudades dominicanas, y las provincias
  `Distrito Nacional` (934) y `Santo Domingo` (964) presentes —sin las cuales la migración de ciudades
  **lanza excepción**—. Resultados: las 3 corren; **idempotentes** (segunda corrida: sigue en 8 ciudades,
  0 duplicados, la columna no revienta); el **rollback devuelve el pre-estado exacto**; y el guard del
  `down()` cumple su promesa —con una sucursal apuntando a BOCA CHICA, borró las otras 7 y **dejó esa**,
  sin huérfanos—. Los 2 tests unitarios pasan **sobre la base de staging** (11 assertions).

  **🔴 Hallazgo de infraestructura: ni el deploy ni el CI corren migraciones.** El workflow reutilizable
  de `config-ci` (`deploy-ecs-service.yaml`) tiene jobs de gitleaks, build, trivy, sonar, push,
  update-catalog, deploy, summary y slack — **ningún paso de migraciones**. Y el workflow que debería
  hacerlo, `run-migrations.yml`, **está roto y nunca corrió** (cero corridas en la historia del repo): a
  la línea `--env AWS_ACCESS_KEY_ID=…` le falta el `\` de continuación, así que el `docker run` termina
  ahí, sin la imagen y sin el `php artisan migrate`; encima esos `inputs.aws_*` no están declarados.
  Corolario medido: de las 385 migraciones de `qa`, **1 sigue sin aplicar** en la BD compartida
  (`2026_08_16_110000_add_pending_cosigner_signature_request_status`) — se aplican a mano.

  **Cómo se aplicaron.** Desde el contenedor local apuntado a la BD de staging, con `--path` para correr
  **solo las 3** y no arrastrar la pendiente ajena de `qa`. ⚠ Trampa de shell que costó un intento: la
  contraseña de `harness/.env.staging` **contiene `$`**, así que `set -a; . archivo` la expande y el
  login falla con `Access denied`; hay que leer el valor literal (`grep … | cut -d= -f2-`).

  **Validado contra staging** (`legacy-backend-stg`, no `-qa`), con foto de antes y después:
  - el payload de `GET /api/loans/allied/{hash}` **antes** traía `branch, colors, id, image, lender,
    name, slug`; **ahora** los mismos **+ `country`** — nada se perdió;
  - comercio dominicano (`1bfb8cd0`, CeluRD) → `id 60 · DOM · phone_code +1 · DOP · es-DO`;
  - comercio colombiano (`7426056a`, godentist) → `id 47 · COL · phone_code +57 · COP · es-CO`
    (**regresión OK**);
  - datos: 2 `phone_code` poblados (solo COL y DOM, las otras 251 quedan NULL a propósito), columna
    `nationality` con `COLOMBIANA`/`DOMINICANA`, y **8 municipios** dominicanos en sus dos provincias;
  - la auditoría reporta **5 sucursales** desalineadas en staging: **1676** (CeluRD Santo Domingo →
    MEDELLÍN) y **2021** (EXCELSIOR → SAN CRISTÓBAL) son los casos reales, y **2020/2024/2055** son de
    comercios pegados a la fila mal cargada `countries.id = 1` («Afghanistan»).

  ⚠ **Y un efecto lateral del admin, para cuando se pruebe en dev:** esos 3 comercios apuntan a
  `country_id = 1`, un país con 32 zonas y **0 ciudades**, así que con el filtro del admin su selector
  **queda vacío**. En prod no pasa: los 325 comercios se reparten 314 Colombia / 11 RD y ninguno cae en
  la fila 1. Es un artefacto de los datos de dev, pero se va a reportar como bug si QA cae ahí.

  **🔴 Y el bloqueante real NO era abrir los PRs: es la REVISIÓN.** Medido el 2026-08-18: los **tres PRs
  ya estaban abiertos desde el 2026-08-10** —front **#785**, backend **#1061**, admin **#50**, los tres
  contra `main`— y siguen **OPEN, en `REVIEW_REQUIRED` y sin un solo toque desde ese día**. O sea que la
  nota del 2026-08-09 («no hay PRs abiertos») quedó vieja al día siguiente, y lo que frena hace 8 días es
  que nadie los revisó. (`gh` sí tiene sesión ahora — `mig-creditop`, scope `repo` — por si hay que
  operarlos por consola.)

  ⚠ **Y esos 3 PRs apuntan a `main`, no a `staging`.** El backend llegó a staging por un PR aparte
  (**#1121**, `feature/pais-como-dato-onto-staging` → `staging`, mergeado hoy 13:40). Para que el
  **front** llegue a staging hace falta el mismo movimiento: cortar de `origin/staging` y cherry-pickear
  `410976d4` — simulado, entra **limpio**. El base por defecto de estos repos es `main`, así que un PR
  para staging se apunta con `--base staging` a mano.

  **Y un arreglo del propio archivo:** la marca `## Tarea (publicable)` estaba **arriba** de la
  `## Bitácora`, y el extractor (`store.go`, «lo de abajo se publica») tomaba entonces **20.437 chars de
  cuerpo privado** como publicables — por eso el guard fallaba con repos y rutas. Se movió la marca al
  final: ahora lo publicable son 1.222 chars y **pasa el guard**. ⚠ El mismo descuido está en
  `bcp-peru-estructurar-entidad.md`.

- **2026-08-19** — **Medido el estado real de merge en los tres repos.** Confirmado que **el backend
  también llegó a `develop`**: PR **#1126** (`feature/pais-como-dato-onto-develop` → `develop`), abierto
  y mergeado el 18/8 (10:27 y 14:46 hora local), **`APPROVED`** — es el único de los cinco PR de esta
  tarea que recibió revisión de alguien. El `Deploy Legacy Backend to Dev` corrió sobre ese merge y quedó
  `success`. La bitácora del 18 sólo había registrado el tramo de staging (#1121), así que este dato
  faltaba. Con eso el backend queda en **develop + staging**, desplegado en los dos, y **fuera de `main`
  y de `qa`**.

  **Verificación por patch-id (`git cherry`, detecta squash), no por nombre de rama**, de cada commit
  contra todas las ramas de ambiente de su repo:

  | repo | commit | main | develop | staging | qa | otras |
  |---|---|---|---|---|---|---|
  | `legacy-backend` | `7933352f` (+554/-1, 9 arch.) | ❌ | ✅ #1126 | ✅ #1121 | ❌ | — |
  | `frontend-monorepo` | `410976d4` (+128/-11, 5 arch.) | ❌ | ❌ | ❌ | ❌ | ❌ `new-main` |
  | `legacy-application` | `c81320b0` (+62/-5, 3 arch.) | ❌ | ❌ | *no existe* | *no existe* | ❌ `canary` |

  **Los PR vivos, y por qué están parados.** Ninguno choca — **lo que frena es la revisión**:
  - `legacy-backend` **#1061 → main**: OPEN, `REVIEW_REQUIRED`, sin un toque desde el 2026-08-10.
  - `frontend-monorepo` **#785 → main**: OPEN, `REVIEW_REQUIRED`, sin tocar desde el 10/8.
  - `frontend-monorepo` **#834 → staging**: OPEN, abierto el 18/8. `mergeable: MERGEABLE` y
    `mergeStateStatus: BLOCKED` — o sea **bloqueado por la revisión obligatoria, no por conflicto**.
  - `legacy-application` **#50 → main**: OPEN desde el 10/8, `mergeable: CLEAN` y **sin
    `reviewDecision`** — en ese repo no hay protección que exija revisión, así que se podría mergear.

  🔴 **Y la causa de fondo: a ninguno de los tres se le pidió revisor.** `reviewRequests` está **vacío**
  en #785, #834 y #50, y los tres tienen **0 reviews**. El `REVIEW_REQUIRED` del front no es «alguien lo
  está mirando y no contesta»: es la protección de rama pidiendo una revisión que **nunca se asignó**.
  Los únicos comentarios de los PR del front son del bot de Sonar, con **Quality Gate passed** (3 issues
  nuevos en #785, 1 en #834, ninguno bloqueante). O sea: **CI verde, cero humanos convocados.**
  - Y los tres commits **siguen aplicando limpio sobre el `main` de hoy** (simulado con `git merge-tree`,
    que no escribe). El rebase que se temía por Motai no hace falta contra `main`.

  **🔴 Hallazgo nuevo: el `develop` de `frontend-monorepo` está congelado.** Último commit **2026-07-03**,
  **267 commits detrás de `main`** (y sólo 28 propios), y el workflow que despliega el wizard a dev
  (`loans-dev.yaml`, que dispara con push a `develop`) **no corre desde ese mismo 2026-07-03**. Mergear
  ahí no es «poner el cambio en dev»: es publicar a dev un wizard de hace mes y medio con el país encima.
  **Y no hace falta hacerlo**, porque el harness ya prueba el front de otra forma: `harness/.env.dev`
  tiene `E2E_BASE_URL=http://localhost:5174` — el wizard corre **local** contra
  `legacy-backend.inertia-develop`, que desde ayer ya publica `country`. O sea que **el cambio del front
  se puede validar contra dev hoy, sin mergear nada**. Su merge de ambiente es `staging` (#834).
  Contraste: en `legacy-application` el `develop` **sí está vivo** (`main-dev.yaml`, última corrida
  `success` el 12/8) y no tiene commits propios (61 detrás de `main`, subconjunto puro), así que ahí el
  cherry-pick sí es el camino — y **entra limpio** (simulado).

  **El conflicto con `qa` sigue igual** (reverificado hoy, no heredado): backend choca en
  `AlliedInfoController.php`; front choca en `allied-theme.repository.ts` y `allied-theme.ts`. A
  `develop` y a `new-main`, en cambio, el commit del front entra **limpio**.

  **Y Jira está bien puesto**, para variar: **CORE-365** figura en **«👀 En revisión»** con sus 5 puntos
  (snapshot del 18/8 20:56). La bitácora del 09-08 lo había dejado en «🧪 En pruebas», pero el estado de
  hoy describe mejor la realidad — lo que falta es que a alguien **le pidan** mirar los PR. No hace falta moverlo.

  **Lo que sigue, en orden:** (1) conseguir revisión de **#834** —es el único merge que hace que las
  pantallas de teléfono cambien en un ambiente—; (2) abrir `feature/pais-como-dato-onto-develop` en
  `legacy-application` (cherry-pick de `c81320b0` sobre `origin/develop`, limpio) para poder validar en
  dev los dos criterios del selector de ciudad; (3) **asignar revisor a los tres** —es el paso que falta de verdad, ninguno tiene—, teniendo en cuenta
  que #50 no tiene protección de rama y podría mergearse sin ella; (4)
  los tres a `main` cuando pasen revisión.

- **2026-08-19 (2)** — **El admin se mergeó a `main` por afán, y el susto valía la pena medirlo.** PR
  **#50** aprobado y mergeado (commit de merge `b766f619`). Miguel avisó con la duda correcta: *no puedo
  correr las migraciones en prod, ¿esto rompe algo?* **No.** Tres verificaciones:

  1. **El commit no trae migraciones** (`git show --name-only` → ninguna), y lo que el código lee **ya
     existe en prod desde siempre**: `allieds.country_id`, `country_zones.country_id`,
     `country_cities.status/name/id`. Las 3 migraciones del backend agregan `countries.nationality`,
     pueblan `countries.phone_code` y siembran ciudades de RD — **ninguna de esas la toca este código**.
     No hay dependencia de esquema, sólo de datos.
  2. **Todavía no llegó a producción.** `main-prod.yaml` de `legacy-application` dispara **por TAG**
     (`on: push: tags: - "*"`), **no** por push a `main`. `git tag --contains c81320b0` → ninguno; prod
     sigue corriendo `87af70a8` (tag `v1.0.27`, del 14/8). El merge a `main` no desplegó nada. ⚠ Pero
     **el próximo tag lo publica**, y ese tag lo va a empujar cualquiera por cualquier otra razón.
  3. **Nada destructivo cuando salga**, que era el riesgo real y no tenía que ver con migraciones:
     **editar una sucursal RD existente NO le borra la ciudad.** `form.city_id` se inicializa de
     `alliedBranch.country_city_id`, independiente de `:items`; `AppAutocomplete` es un wrapper delgado
     de `v-autocomplete`, que conserva el `v-model` aunque el valor no esté en la lista; y
     `UpdateRequest` valida `city_id` sólo con `required`, **sin `exists`**. Guardar reenvía el id
     intacto. Lo único es cosmético: el campo no puede pintar el nombre de una ciudad ausente de la
     lista.

  **El efecto que sí va a tener, medido contra prod hoy:** son **314 comercios de Colombia y 12 de
  República Dominicana**, y RD tiene **32 provincias cargadas y CERO ciudades**. Así que para esos 12
  los dos selectores quedan con **una sola opción, «TODAS LAS CIUDADES»** (el comodín se conserva
  siempre, por diseño). Colombia intacto con sus 1.123. La mitad **preventiva** del fix funciona igual
  —ya nadie puede elegir la «Santo Domingo» de Antioquia—; la **correctiva** no puede hasta que existan
  las ciudades. **No es una regresión**: elegir la ciudad RD correcta en prod nunca fue posible.

  **Y la salida al bloqueo de migraciones:** la de las ciudades de RD es **sólo datos, un INSERT de 8
  municipios**, sin cambio de esquema. No tiene por qué ir atada a un deploy ni a `php artisan migrate`:
  se puede aplicar cuando se pueda tocar prod, antes o después del tag, y el selector se llena solo. Las
  otras dos (`nationality`, `phone_code`) son del wizard, no del admin.

  **🔴 El front NO está aprobado: lo frena Sonar, no la revisión.** `typescript:S6759` («marcá las props
  del componente como read-only») pega en la firma de `PhoneForm`, tocada para agregarle
  `defaultCountryCode`. La regla corre **sólo sobre código nuevo**, por eso aparece ahora aunque esa
  firma ya era así antes del cambio. Arreglado en local sobre
  `feature/pais-como-dato-onto-staging` (`8bc9c909`, **sin pushear**): `Readonly<IPhoneFormProps>`, que
  es la convención que el repo ya usa en **112** componentes, con la firma partida en varias líneas
  porque Biome lo exige por longitud. Lint del módulo en verde; no hay tests ahí. ⚠ El mismo arreglo
  falta en la rama de `main` (#785). Corrección a lo que escribí más temprano hoy: el `Quality Gate
  passed` del bot es el **portón**, que pasa; los *issues* abiertos que reporta al lado son otra cosa y
  son los que hay que limpiar.

  **Y la retrospectiva, que es lo que Miguel pidió dejar por escrito:** las tres ramas se cortaron de
  `main` y se apuntaron a `main`. Debieron nacer en `develop` (backend y admin) y en `staging` (front).
  De ese error salieron el port extra del backend a staging, el port del front, y el merge del admin a
  producción. Quedó escrito arriba, en **§«Las ramas de esta tarea»**, con la tabla de las **tres ramas
  buenas** y la instrucción explícita de ignorar las anteriores — que es la parte que evita repetirlo.

- **2026-08-19 (3)** — **Front destrabado: Sonar arreglado, pusheado y en verde.** El arreglo
  (`Readonly<IPhoneFormProps>` + la firma partida por Biome) se pusheó a
  `feature/pais-como-dato-onto-staging` (`8bc9c909`), con refspec explícito y verificando que
  `origin/staging` quedara intacto. Resultado en #834: `SonarCloud Code Analysis` → **SUCCESS**,
  `reviewDecision` → **APPROVED**, hilo de revisión **resuelto**, `mergeable: MERGEABLE`.

  **Dos cosas que aclara el episodio:**
  - **La aprobación no se cayó con el push**, porque el ruleset tiene
    `dismiss_stale_reviews_on_push: false`. En un repo con esa opción encendida, arreglar Sonar habría
    tirado abajo la revisión de Joel y habría que pedirla de nuevo. Conviene saberlo antes de pushear
    sobre un PR ya aprobado.
  - **El comentario de Joel era exactamente esto**: «solo sugiero validar la corrección que sugiere
    SonarQube». No era una objeción de diseño; era el mismo hallazgo. Y su review quedó como `APPROVED`
    igual, con el `COMMENTED` al lado — leer sólo `reviewDecision` (que estaba vacío en ese momento)
    hacía parecer que no había aprobado nadie.

  🔴 **Y queda un impedimento que no es del PR: Miguel no puede apretar merge.** #834 sigue `BLOCKED`
  con todo satisfecho. Medido: el ruleset **«main»** (id 6625180, `enforcement: active`) cubre
  `~DEFAULT_BRANCH` **y `refs/heads/staging`**, incluye la regla `update` —restringe quién puede
  actualizar esas ramas— y tiene la lista de **`bypass_actors` VACÍA**; y `mig-creditop` figura con
  `push: true` pero `maintain: false`, `admin: false`. Consistente con el histórico: los últimos 6
  merges a `staging` los apretó **OscarRinc** (uno, yamid). **Cuando toque mergear, hay que pedírselo a
  alguien con permiso** — no es algo que se resuelva del lado del PR. Lo mismo va a pasar en `main`,
  que el mismo ruleset cubre.

  ⚠ **Y para el paso siguiente que Miguel nombró («pasar a qa»): a `qa` NO entra.** Reverificado hoy:
  el commit del front choca en `allied-theme.repository.ts` y `allied-theme.ts`, y el del backend en
  `AlliedInfoController.php` — es el rebase por Motai, que vive sólo en esa rama. Pasar a `qa` no es
  mergear: es un tercer port con resolución de conflictos a mano. **Antes de prometer QA en `qa`,
  decidir si las pruebas van ahí o en `staging`** (donde el backend ya está y el front ya está listo).

- **2026-08-19 (4)** — **Armado el PR del admin contra `develop`: #68.** Rama
  `feature/pais-como-dato-onto-develop` cortada de `origin/develop` **con `--no-track`** (para que no
  quede apuntando a la rama de ambiente: es la trampa que casi muerde en el port a staging del backend)
  y cherry-pick de `c81320b0`. Entró limpio y **el diff resultante es idéntico byte a byte al de
  `main`** —verificado comparando `git show` de los dos commits—, así que no hay deriva entre lo que se
  mergeó por error y lo que se va a probar. Pusheado con refspec explícito; `origin/develop` intacto.

  Estado del PR: `MERGEABLE / CLEAN`, revisor pedido a **Joelsrh23** (el mismo que revisó el front de
  esta tarea, así que llega con el contexto puesto). El cuerpo del PR explica por qué existe teniendo
  #50 ya mergeado, que no trae migraciones, y deja los 3 pasos de prueba en dev **más el aviso de los 3
  comercios pegados a `countries.id = 1`**, que van a ver el selector vacío por datos de dev y no por el
  cambio.

  📌 **Y un dato que cambia quién puede hacer qué: `develop` de `legacy-application` NO tiene ruleset**
  (`rules/branches/develop` → vacío). O sea que **este PR sí lo puede mergear Miguel** cuando esté
  aprobado — al revés que el front, donde el ruleset «main» cubre también `staging` y deja el botón sólo
  a quien tenga bypass. Vale la pena tenerlo separado en la cabeza: **no es que «no podemos mergear»; es
  que cada repo tiene una regla distinta.**

  **Queda un cabo suelto deliberado:** los PR viejos a `main` (#785 del front, #1061 del backend) siguen
  abiertos y ya no son el camino. No se tocaron: cerrarlos es decisión de Miguel, y hacerlo sin avisar
  borraría la discusión que tienen encima.

- **2026-08-19 (5)** — **El admin quedó en `develop`: Miguel mergeó #68 él mismo** (15:17), sin esperar
  revisión. Podía: ese repo **no tiene ruleset en `develop`**, así que no hay aprobación obligatoria. ⚠
  Matiz que conviene no confundir: **GitHub no deja aprobar tu propio PR** —era el autor—, así que lo
  que hizo no fue auto-aprobar sino **mergear directo**, que es otra cosa y ahí sí estaba habilitado. La
  petición de revisión a Joelsrh23 queda como cortesía, no como requisito.

  **Con eso quedan DOS de las tres piezas en su lugar** (`legacy-backend` y `legacy-application`, las
  dos en `develop` y desplegadas a dev) y **falta una sola: el front**. #834 está aprobado, con Sonar en
  verde y el hilo resuelto; lo único que lo frena es la decisión de probar primero — y, cuando se
  decida, que lo apriete alguien con bypass en el ruleset de `staging`.

- **2026-08-19 (6)** — **Las tres piezas mergeadas y desplegadas, y el mapa de pruebas corregido.**
  #834 lo mergeó **sanvipi-ctop** a las 15:22 (los dos commits —país y el fix de Sonar— confirmados en
  `origin/staging` por patch-id) y `loans-stg.yaml` terminó **`success`**. El admin (#68) ya había
  cerrado su deploy a dev, también **`success`**. Estado: backend `develop` ✅ · admin `develop` ✅ ·
  front `staging` ✅.

  **🔴 Y al ir a preparar las pruebas apareció el hallazgo que las ordena: el wizard de staging no
  habla con el backend de staging.** `loans-stg.yaml` construye `loan-request-wizard-stg` con
  `VITE_API_URL=http://legacy-backend.inertia-develop` — el servicio de **dev**, el mismo que usa el
  wizard de dev. `legacy-backend-stg` no es lo que responde detrás. La consecuencia es buena: la pareja
  viva es **front de `staging` + backend de `develop`**, y las dos tienen el cambio, así que se puede
  probar ya. La consecuencia incómoda es que **el port del backend a `staging` (#1121) no era el camino
  crítico**: alimenta un servicio aparte. ⚠ Sale de los build args del workflow; un secreto de runtime
  podría sobrescribirlo, así que conviene confirmarlo en la primera corrida.

  **Y queda avisada la trampa que iba a morder:** `E2E_TARGET=staging` del harness apunta a
  `legacy-backend-qa` (rama `qa`) y a `originaciones-qa`, donde el commit **no está** y además choca.
  Probar con ese target mediría la rama equivocada. El mapa completo quedó arriba en §«Dónde se prueba
  esto».

- **2026-08-19 (7)** — **El front VALIDADO en LOCAL, con captura: `+1` para RD y `+57` para Colombia.**
  Después del incidente de la BD compartida, las pruebas se movieron a local (y sin correr PHPUnit: los
  PR de CORE-431 se mergearon a develop mientras tanto — #1140 y #70, por Oscar — y los checkouts locales
  de los dos repos quedaron en `develop`, que ya trae países + el candado juntos).

  **La corrida** (`dev/paises-local-probe.spec.ts`, nuevo): asesor logueado → `/merchant/{hash}/request-amount`
  → equipo + monto → `request-phone`, y el prefijo preseleccionado se lee de la pantalla.
  - **CeluRD Santo Domingo (país 60)** → selector en **+1** ✅ (el placeholder «RD$16.450» que se ve NO es del cambio: está QUEMADO en el front — ver hallazgo en la entrada 9)
  - **Dentix Chia (país 47)** → selector en **+57** ✅ (regresión limpia)
  Capturas en `harness/.auth/paises-local-{rd,co}.png`.

  **La pila local que lo hace posible** (todo documentado ya en el harness, sólo hubo que conectarlo):
  backend local en `develop` (sail, `:80`) + **`bin/mock-forms` (:8101)** para el schema del flujo
  dinámico —su cabecera documenta EXACTAMENTE este caso, hasta nombra a CeluRD— + wizard `:5174` con dos
  variables de entorno inyectadas por `launch.json`.

  **Trampas que costaron intentos, para la próxima:**
  - **`VITE_API_URL` va SIN `/api`**: `allied-theme.repository` y `product.repository` agregan `/api`
    ellos mismos (así lo pasa el build de deploy — `loans-stg.yaml` lo confirma). Con el sufijo, todo da
    404 en `/api/api/...`.
  - **La cadena de precedencia de env es: `launch.json env` > `.env.local` > `.env`** — el wizard tiene
    un `.env.local` que pisa al `.env`, así que editar `.env` no sirve; la perilla buena es el env del
    proceso.
  - **El mock de forms sirve bajo `/v1`**: `VITE_ONBOARDING_FORM_SERVICE=http://localhost:8101/v1`.
  - **El comercio del asesor queda FIJADO en la cookie de sesión**: reasignar en BD no alcanza — hay que
    renovar sesión (`make login local`) para que el wizard lea la asignación nueva.
  - **El selector de equipo viene de `/api/partners/products/{hash}`, por comercio**: godentist no tiene
    productos y el schema genérico exige elegir uno → para el caso CO sirve DENTIX (5 productos).

  **Qué queda SIN probar del front:** la otra ruta tocada, `additional-info-form` (el árbol
  departamento→ciudad por país), necesita el form-service y datos de formulario — se prueba en dev
  cuando toque QA. Y el criterio del admin (selector de ciudad) sigue pendiente de mirarse en dev,
  donde ya está desplegado.

- **2026-08-19 (8)** — **Validado también contra DEV, con TODO real: +1 para RD, +57 para Colombia.**
  Los checkouts locales pasaron a las ramas mergeadas (`develop` en backend y admin; **`staging` en el
  front**, que trae los 2 commits de países) y la misma sonda corrió con el wizard local apuntado al
  ambiente compartido — que es el modo de prueba documentado del harness para dev.

  **Cero mocks esta vez:** backend real (`legacy-backend` → develop), **forms-service real** (tiene los
  schemas de los dos comercios — sirvió el de Smartpay con su branding), productos reales, Cognito real.
  - **CeluRD Santo Domingo** → `request-phone` con **+1** preseleccionado ✅
  - **Dentix Chia** → **+57** ✅ (regresión limpia)
  Capturas: `harness/.auth/paises-local-{rd-dev,co-dev}.png`.

  **La escritura a la BD compartida fue una sola y quedó revertida:** la asignación del asesor
  (`users.allied_branch_id`) para entrar a cada comercio, hecha con `E2E_TARGET=dev` +
  `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` exportado a mano (F-53), y **restaurada a Motai `f0548728`** al
  terminar — verificado con SELECT. Las corridas no pasaron del prefijo: no se creó ninguna solicitud.

  **Un dato de ruteo que salió gratis:** con la asignación a CeluRD, el wizard mandó al asesor
  **directo a `/request-amount`** (el flujo dinámico) — en dev el comercio RD entra solo por ahí, sin
  tocar `/solicitar`. La detección de flujo por comercio funciona.

  **Con esto, la evidencia del front cubre local Y dev.** Queda: `additional-info-form`
  (departamento→ciudad por país) y el criterio del admin en dev — y la decisión de QA formal.

- **2026-08-19 (9)** — **Qué hace exactamente el cambio del front, y qué sigue quemado.** Revisado
  archivo por archivo sobre la rama mergeada, para tenerlo claro antes de validar en staging:
  - **Lo que hace:** el back agrega `country {id, name, iso_code, phone_code, currency, locale}` al
    payload del comercio; el front lo guarda en el theme del aliado, y DOS pantallas lo consumen:
    `request-phone` convierte `phone_code` («+1» → «1») y lo pasa como **prefijo preseleccionado**, y
    `additional-info-form` usa `country.id` para pedir el **árbol departamento→ciudad del país** en vez
    del `47` fijo. Todo *fail-open*: si el país no llega, se comporta como antes.
  - **Lo que NO hace:** la **LISTA** de prefijos sigue quemada en `PhoneForm` (`options: [+1, +57]`) —
    el cambio elige cuál viene preseleccionado, no de dónde sale la lista. Un tercer país exige tocar el
    front de nuevo. Tampoco trae `cell_phone_lenght` (a propósito: semántica sin definir), ni toca el
    flujo clásico (`/solicitar`), ni la mensajería.
  - 🔴 **Hardcode NUEVO encontrado al revisar:** `AmountForm.tsx:147` tiene `placeholder="RD$16.450"`
    **fijo** — el flujo dinámico le muestra «RD$» de placeholder a TODOS los comercios, incluidos los
    colombianos (Dentix lo mostró; quedó tapado por el valor tecleado en la captura). Corrige además la
    entrada (7): ese placeholder no era evidencia del cambio de países. Va a la fila del catálogo de
    hardcodes.
  - ✅ **URL del front de staging CONFIRMADA por Miguel: `originaciones-stg.dev.creditop.com`** (build
    propio, distinto de qa y de dev). `.env.staging` ya apunta ahí. El mapa completo:
    `originaciones.dev` = dev · `originaciones-qa.dev` = qa · `originaciones-stg.dev` = staging.
  - 📌 **Dos decisiones de Miguel (2026-08-19), con su porqué:** la lista quemada `[+1, +57]` **se queda
    así por ahora** — las pruebas se hacen con celulares COLOMBIANOS aun en comercios RD, y como el
    cambio *preselecciona sin forzar*, el tester puede volver a +57 y seguir; reemplazar el código por
    el del país rompería esa práctica. Y el placeholder `RD$16.450` de `AmountForm` **también se queda**:
    inventariado en el catálogo de hardcodes, sin acción por ahora. Lo que la tarea venía a validar —
    **el país sale del comercio, no del código** — quedó demostrado: mismo build, dos comercios, dos
    comportamientos, y la única diferencia es una fila en la BD.

- **2026-08-24** — **La tarea se cerró y se volvió a abrir el mismo día, con el alcance ampliado**: pasa
  de «onboarding por país» a **Internacionalización de CreditOp**. El detalle de la ejecución vive en la
  tarea `pais-fuera-del-codigo.md`; acá queda el hilo para que ésta no envejezca.

  **De dónde salió.** De una pregunta sobre **moneda por país**. La respuesta fue que la moneda ya viaja
  en el payload del comercio (`country {…, currency, locale}`, que puso esta misma tarea) pero **nadie la
  consume** en el front. Al tirar del hilo por la entidad peruana que viene, apareció el fondo del asunto.

- **2026-08-24 (2)** — **El problema del país 1, y su causa raíz, que no era la que parecía.** En
  producción **191 de 192 entidades tienen `country_id = 1`, que es Afganistán**, y el sistema funciona
  porque esa fila fue editada con los datos de Colombia (`es-CO`, `COP`, 10 dígitos, y en dev también
  `dial_code 57`).

  Se creyó que la causa era el `DEFAULT 1` de la columna. **No lo era**: los comercios están bien (317 en
  47, 14 en 60, cero en 1). La diferencia estaba en el formulario — el alta de **comercios** siempre leyó
  la lista de países del backend, y la de **entidades** la tenía escrita en el Vue con **una sola opción,
  `{ value: 1, title: 'Colombia' }`**: el id de Afganistán rotulado Colombia. El operador no podía elegir
  otra cosa ni darse cuenta. **Un formulario leía configuración y el otro la tenía escrita.**

- **2026-08-24 (3)** — **Lo que se hizo, en dos partes.** (a) Diez consultas —cinco por monolito— dejan de
  preguntar por el país 1 y toman el del **comercio** de la solicitud, comparándolo contra el de la
  entidad. Durante la transición se acepta también el `1`, porque sin ese puente hay una ventana donde
  **139 entidades activas desaparecen del listado sin lanzar ningún error**. (b) El país pasa a ser dato:
  `is_operating`, los 18 países de Latinoamérica cargados con prefijo, longitud de celular, idioma y
  moneda, los `locale` normalizados a BCP-47, las tres validaciones del admin contra la columna, los
  selectores leyendo `Country::operating()`, y el país del comercio **corregible mientras esté vacío**.

  ⚠ **Sin regex de celular por país, y a propósito**: los rangos de prefijos móviles cambian cuando el
  regulador asigna bloques, y un regex viejo **rechaza clientes reales** — falla cerrado. Queda en la
  longitud, que además ya tenía columna.

- **2026-08-24 (4)** — **Dos cosas que sólo aparecieron corriéndolo, no leyendo.** `getLenders()` —el
  camino **principal** del listado de `legacy-backend`— **no filtraba por país en absoluto**: no estaba en
  ningún censo porque **una ausencia de filtro no se puede grepear**. Su gemelo de `legacy-application` sí
  filtra ahí; se perdió al portar el código. Y el repositorio de Onboarding ya tenía el parámetro
  `$countryId`… con `default = 1`, o sea que sin pasárselo se comporta igual que el literal.

  Lo destapó el segundo criterio del A/B: con los diez literales ya corregidos, una entidad movida a Perú
  **seguía apareciendo** en un comercio colombiano. El primer criterio —«que no cambie nada»— daba verde
  igual, porque el fallback y el preaprobado no se ejercitan en una corrida normal.

- **2026-08-24 (5)** — **Censo exhaustivo de supuestos de país** (13 agentes, 6 barridos, verificación
  adversarial de cada hallazgo sobre los 4 repos): **186 confirmados**, ~140 sitios, más de 400 líneas.
  Informe completo en `tablero/data/artifacts/censo-hardcodes-pais-2026-08-24.md`. La conclusión que
  reordena el trabajo: **no falta configuración por país — el código no la lee**. `countries` ya tiene
  `locale`, `currency`, `nationality`, `phone_code`, `cell_phone_length` y `address_format`, y esta última
  **está declarada y muerta**. Dos tercios de los hallazgos son **teléfono** y **plata**.

- **2026-08-24 (6)** — **Corrección de rumbo en las ramas, y es la parte que más conviene recordar.** Se
  venía trabajando contra `develop` y **`develop` no es el camino**: en `legacy-backend` está **332
  commits detrás de `main`** y `qa` está a 11/8. Los merges a `main` vienen de **ramas de feature
  directamente**, así que `qa`, `develop` y `staging` son **ambientes, no etapas**. La segunda tanda pasó
  a salir de `qa` —salvo `legacy-application`, que no tiene esa rama—, y todo quedó **consolidado en una
  rama y un commit por repo**, con el paso a paso del despliegue escrito en la descripción del PR. La
  tabla de §«Las ramas de esta tarea» tiene el estado.

- **2026-08-24 (7)** — **La migración ya corrió en la base compartida.** `dev`, `qa` y `staging` son **una
  sola base**: se corre una vez. Antes: 7 países con moneda, 4 con prefijo, **4 locales inválidos**, sin
  `is_operating`. Después: **20 con moneda · 19 con prefijo · 0 inválidos · 18 habilitados** y Afganistán
  apagado. Se hizo con protocolo —credenciales por entorno **sin tocar ningún `.env`**, que es la trampa
  de CORE-431— y verificando con el harness que no rompió nada.

  ⚠ Y un detalle del método: **`--pretend` subestima** cuando la migración lee datos. Mostró 3 sentencias
  y no los 18 `UPDATE` del catálogo, porque en modo simulado los `SELECT` no se ejecutan.

- **2026-08-24 (8)** — **Lo que queda para después, con su razón.** El **backfill** de las 191 entidades
  se posterga: sólo es seguro con el código **desplegado**, y hoy `develop` lo tiene pero `qa` y `staging`
  no, así que moverlas ahora los dejaría con listados vacíos. Se hará con **un comando** que **infiera en
  cada base**, nunca copiando ids: están medidos **12 ids que son entidades distintas** en prod y en la
  compartida —el 152 es Refurbicredit en una y smartpay en la otra—, lo que explica de paso el
  `production ? 160 : 152` de `isSmartPay()`.

  **Y el estado final se validó entero en local**: con el backfill aplicado **y** el puente sacado, los
  tres casos dan idéntico al baseline. El plan cierra antes de tocar nada compartido.

- **2026-08-24 (9)** — **Lo próximo, y por qué el cimiento ya está.** El front ya recibe `phoneCode`,
  `currency` y `locale` del comercio y los guarda en el theme; `formatCurrencyWithSymbol` ya acepta locale
  y moneda. **Ningún llamador se los pasa**, así que todos caen en el default colombiano — y
  `maximumFractionDigits: 0` le borra los centavos a DOP, PEN, BRL y USD. La receta: **quitar los
  defaults** para que el llamador que no pasa el país falle al compilar, en vez de perseguirlos con grep.
  Para el celular, el prefijo ya se preselecciona; lo que queda quemado es la **lista** `[+1, +57]`, que
  ahora puede salir de `countries`.


## Tarea (publicable)

## En una línea
Que el país sea configuración y no algo escrito en el programa, para poder habilitar un país nuevo
cargando datos en vez de publicando una versión.

## Por qué
El sistema asume un solo país en el código: el prefijo y la longitud del celular, los tipos de documento
válidos, los textos, la moneda y los formatos. Por eso el segundo país se resolvió con una copia paralela
de las pantallas de solicitud, y un tercero costaría otra copia.

Y hay un problema de fondo que salió al abrir esto: **casi todas las entidades financieras están
registradas en un país que no es el suyo**. La pantalla que las da de alta ofrecía una sola opción, mal
etiquetada, así que quien las cargó no podía elegir otra cosa ni darse cuenta. El sistema funciona porque
a ese país equivocado le copiaron encima los datos de Colombia. Mientras eso siga así, una entidad de otro
país no le aparece a nadie aunque esté bien configurada — que es exactamente lo que bloquea la operación
de Perú.

## Qué cambia
1. **El listado de entidades usa el país del comercio que está atendiendo**, en vez de asumir uno fijo.
   Para un comercio colombiano o dominicano no cambia nada; para uno de otro país, empieza a funcionar.
2. **El administrador ofrece los países donde se puede dar de alta**, leídos de una tabla y no de una
   lista escrita en el programa. Habilitar un país nuevo pasa a ser un cambio de dato.
3. **Se puede corregir el país de un comercio** mientras no tenga puntos de venta ni solicitudes. Hasta
   ahora era imposible: equivocarse al crearlo obligaba a crear otro y dejaba uno huérfano.
4. **Queda cargado el catálogo de los 18 países de Latinoamérica** con prefijo telefónico, longitud de
   celular, idioma y moneda — la base sobre la que después las pantallas pueden mostrar la moneda y el
   prefijo correctos.

**Y lo que se sumó después** (segunda tanda, lo que ve el solicitante):

5. **El formulario de solicitud habla en el idioma del país**: el monto en su moneda y con sus separadores,
   el celular con su prefijo y su longitud, y los tipos de documento que ese país acepta — no los
   colombianos.
6. **El documento que se le dibuja al solicitante se adapta.** Antes había dos ilustraciones fijas —la
   cédula colombiana y el permiso de permanencia— y se elegía entre ellas; ahora hay una sola que muestra
   la bandera del país del comercio, el gentilicio, el nombre real del documento elegido, la entidad que
   lo expide y la fecha de nacimiento cuando el comercio la pide. La entidad emisora depende del país **y**
   del tipo: los documentos de extranjeros los expide la oficina de migraciones, no la de nacionales.
7. **Lo que no se le pregunta al solicitante y no se puede deducir se marca visiblemente** en vez de
   inventarse, para que nadie confunda un relleno con un dato real.

## Alcance
**Entra**: el listado de entidades, el alta y edición de comercios y entidades, el registro de países, y
—en el flujo de solicitud— la moneda, el prefijo y la longitud del celular, los tipos de documento por país
y la ilustración del documento.

⚠ Los tres últimos figuraban antes como «no entra»: **entraron en la segunda tanda** y por eso se movieron.

**No entra** (son pasos siguientes, con su propio trabajo): el catálogo de ciudades de países nuevos; la
mensajería, que tiene su propio camino; el pasaporte, que tiene otra forma y se ilustra aparte; y
**corregir el registro de las entidades mal cargadas**, que se hace después y sólo una vez que este cambio
esté en el aire — al revés, desaparecen de los listados.

Habilitar un país **no** significa que el crédito funcione de punta a punta ahí: eso depende además de que
el país tenga central de riesgo, documentos y geografía cargados. La separación es deliberada — configurar
un comercio no origina crédito, así que no hay razón para impedir el alta mientras el país se prepara.

## Dónde probar
**El ambiente `qa`** (originaciones-qa), que es donde está todo esto. Comparte base de datos con desarrollo
y con staging, así que lo que se carga en uno se ve en los tres — pero **el código es distinto en cada
uno**, y esto está en `qa`. Comercios de referencia: uno colombiano (**Kreditkasa** o **Dentix**), uno
dominicano (**CeluRD**) y el comercio de prueba de Perú.

⚠ **Producción todavía no tiene nada de esto.** Y al desplegarlo habrá que cargar allá las banderas
aparte: son datos y no viajan con el código.

⚠ **El código de verificación por SMS no llega al teléfono en `qa`**: se publica en el canal de mensajería
de pruebas del equipo en Slack, en el hilo del número que se usó.

## Cómo validar

**La configuración (primera tanda)**

1. **Que no se rompió nada**: entrar con un comercio colombiano y con uno dominicano y confirmar que el
   listado muestra **exactamente las mismas** entidades que antes del cambio, en el mismo orden.
2. **Que el país nuevo funciona**: con el comercio de Perú, confirmar que su entidad aparece en el
   listado. Antes de este cambio ese listado salía **vacío**.
3. **Que el administrador acompaña**: al crear un comercio o una entidad, el selector de país ofrece los
   18 países de Latinoamérica y **no** ofrece ningún otro.
4. **Que el país se puede corregir**: en un comercio recién creado, sin puntos de venta ni solicitudes, el
   campo de país es editable. En uno con operación, no aparece.

**El flujo del solicitante (segunda tanda)**

5. Arrancar una solicitud con un comercio de cada país y mirar las primeras dos pantallas: el monto tiene
   que salir en la moneda del país y el celular con su prefijo y su cantidad de dígitos.
6. Llegar al paso de la fecha de expedición y comprobar el documento en cada país:

|| país || tipos que debe ofrecer || qué debe decir el documento ||
| Colombia | C.C. y C.E. | bandera colombiana · «Cédula de ciudadanía» · Registraduría · COLOMBIANA |
| Perú | DNI y C.E. | bandera peruana · «Documento Nacional de Identidad» · RENIEC |
| República Dominicana | Cédula y NUI | bandera dominicana · «Cédula de identidad» · JCE |

7. En esa misma pantalla: elegir la fecha de expedición y comprobar que **el documento gira solo** y muestra
   el reverso con esa fecha resaltada; volver a tocarlo para verlo de frente.
8. **El caso que más importa**: cambiar el tipo a cédula de extranjería. La entidad emisora tiene que
   cambiar también — en Colombia pasa a Migración Colombia, en Perú a Migraciones —, porque no la expide la
   misma oficina que la de nacionales.

## Criterios de aceptación
- El listado de entidades de un comercio colombiano y de uno dominicano es idéntico antes y después.
- La entidad peruana aparece en el listado de un comercio peruano, y **no** aparece en uno colombiano.
- Se puede crear un comercio y una entidad en cualquiera de los 18 países de Latinoamérica.
- Ningún país fuera de esa lista se puede elegir al crear un comercio o una entidad.
- El país de un comercio se puede corregir sólo mientras no tenga puntos de venta ni solicitudes.
- Ninguna entidad activa deja de aparecer en un listado donde antes aparecía.
- En los tres países se ve la bandera correcta y el nombre correcto del documento; al cambiar el tipo
  cambian el nombre y la entidad emisora.
- El documento gira al completar la fecha y responde al toque.
- Ningún dato aparece cortado a media palabra, y los que no se le piden al solicitante se ven marcados como
  desconocidos y no con un valor de relleno que se pueda confundir con uno real.
- Colombia no cambia respecto de lo que se veía antes, salvo por la bandera y el gentilicio, que no estaban.

## Dependencias / contraparte
- **Orden obligatorio**: el cambio del registro de países se aplica **antes** de publicar el cambio de
  código. Ya está aplicado en el ambiente compartido por desarrollo y QA.
- **Para producción**: además del despliegue hay que cargar las banderas de los países donde se opera. Es
  un cambio de datos, va por fuera del código, y sin él el documento se ve con un emblema gris en vez de la
  bandera.
- **Negocio**: confirmar la longitud del celular de los países que todavía no operan antes de abrir cada
  uno — varios planes de numeración son ambiguos, y la duda ya existe con República Dominicana, que hoy
  figura con una longitud distinta a la de Colombia.
- **Negocio**: decidir a qué país corresponden las entidades que hoy no tienen forma de deducirlo, o
  confirmar que están inactivas y se apagan. Hace falta para el paso siguiente, no para éste.
