# harness · reglas de trabajo

> **Para qué existe:** es **la herramienta con la que se valida una tarea contra el código real.** No es
> contexto (eso vive en **knowledge/** y las fuentes) ni el trabajo en sí (eso es `tablero/`): es lo que se usa para **comprobar
> corriendo** lo que en los otros dos está escrito. Si una afirmación se puede verificar acá, verificala
> antes de escribirla como cierta en un nodo.

Lo descriptivo (arquitectura en detalle, envs, Node 22.18+) vive en `README.md`. Acá van las **reglas
que ya costaron tiempo** — y el mapa mínimo para no perderse.

La historia —cómo se midió cada cosa, qué se probó y se descartó— y el detalle largo de cada herramienta están en
[`HISTORY.md`](HISTORY.md). Este archivo es para USAR el harness: leé el otro cuando una regla de acá no alcance.

## Cómo está construido (7 capas, y cada una tiene un trabajo)

| Capa | Qué es | Cuándo la tocás |
|---|---|---|
| `panel/` | La UI del harness (`npm run dev` → **:5195**). Es una cáscara sobre `bin/advisor`, no un segundo motor. | Camino visual: lo maneja Miguel |
| `bin/` | **Plumbing**: launchers (`asesor` · `ecommerce` · `qr` · `panel`), los 11 `mock-*` y utilidades (`dbops.ts` · `env-get.ts` · `steps-check.ts` · `preflight.ts`) | Casi nunca directo — el panel los llama |
| `dev/` | **Herramientas por consola**, una por pregunta (abajo) | Camino rápido: es TU camino |
| `pkg/` | La **librería compartida**: `trace.ts` (aserciones) · `db.ts` · `inject.ts` · `cognito.ts` · `http.ts` · `phones.ts` · `merchants.ts` · `otp-bypass.ts` · `qr.ts`+`qr-steps.ts` · `checkout-b64.ts` · `windows.ts` · … | Al agregar capacidad, va acá — no duplicada en dos runners |
| `mock-*/` | **la flota de mocks con launcher** (la tabla de puertos, abajo) + 2 páginas estáticas (`mock-bank/`, `mock-store/`, sin launcher: las sirve el spec) | Cuando el proveedor externo estorba |
| `channel/` | **13 suites de caracterización** (`*.spec.ts`): congelan el comportamiento ACTUAL | Antes de cambiar algo, para tener red |
| `.runs/` · `.auth/` | Forense de la última corrida (volcados, screenshots) | Cuando algo falló y hay que reconstruir |

**La cadena del camino visual:** panel (:5195) → `bin/advisor <comercio>` → `dev/guided.spec.ts`
(Playwright) → wizard real (:5174) → backend del target.

**Los mocks y sus puertos** (el launcher es `bin/<nombre>`):

| | | | |
|---|---|---|---|
| `mock-preapprovals` :8095 | `mock-redirect` :8096 | `mock-payvalida` :8097 | `mock-mdm` :8098 |
| `mock-lenders` :8099 | `mock-pdf-mapper` :8100 | `mock-forms` :8101 | `mock-abaco` :8102 |
| `mock-corbeta` :8103 | `mock-bancolombia` :8104 | `mock-financial-health` :4000 | `mock-bureaus` :8105 (centrales de riesgo) |
| `mock-deceval` :8106 | `mock-netco` :8107 | `mock-credifamilia` :8108 | `mock-forms-g2` :8109 |
| `mock-payment-link` :8113 (la API de CORE-746 + los plugins de VTEX y Shopify + tienda demo) | | | |

⚠ **`mock-forms` (:8101) y `mock-forms-g2` (:8109) son de DOS servicios distintos**, y el parecido de
los nombres ya costó una vuelta. El primero imita `onboarding-forms-service` —el flujo dinámico de los
comercios de RD, cuelga de `VITE_ONBOARDING_FORM_SERVICE`—; el segundo imita `form-service` —el
backend-driven, de donde salen el formulario del VEHÍCULO de BCP y los árboles de opciones, cuelga de
`VITE_FORM_SERVICE_BASE_URL`—. El segundo **no es opcional en local**: guardar un formulario ESCRIBE, y
sin él `bin/advisor` cae al host de dev, donde el `user_request_id` de una corrida local es la solicitud
de otra persona. Los esquemas son los de dev, capturados en modo lectura (`bin/mock-forms-g2 capturar`).

**Las herramientas de consola, por la pregunta que contestan.** Acá va el comando; parámetros, variantes y lo
que escribe cada una, fila por fila: [`HISTORY.md`](HISTORY.md) §«Las herramientas de consola, fila por fila».

| Tu pregunta | Comando |
|---|---|
| ¿qué entidades le salen al comercio? · ¿qué pasa si el cliente es así? | `make harness-listing MERCHANT=…` · `make harness-case CASES='…'` (`CLOSE=1`, `LAMBDA=1`, `JSON=1`) |
| ¿qué devuelve ESTE código del backend? (una clase, un servicio privado, una consulta, en local) | `make harness-recipe` (la lista) · `NAME=<receta> ARGS='--param valor'` · `CODE='return …;'` (PHP suelto) · `REPO=legacy-application` · `JSON=1` · `BLOCK=`. Abajo, «Las recetas de código» |
| ¿el FRONT encadena las pantallas? | `make harness-walk-wizard` (`ENGINE=browser`; skill `harness-caminador`) · `make harness-screens` |
| «corré Finandina» y quiero el VIDEO para compartir | `make harness-run RUN=finandina` (o `RUN=finandina,pullman`, a la vez): corridas con nombre de `runs.json`, sin ventana, en un celular de 420×900 (agente de iPhone), 600 ms por acción, y un `.mp4` por corrida en `.runs/videos/<fecha>/` (`SLOW=`, `HEADED=1`, `VIDEO=0`, `BLOCK=`). Sin `RUN`, la lista. Las que comparten ambiente y perillas van en UN proceso con `--parallel` (dos procesos contra qa se pisarían el bypass de OTP). Graba el Chromium del harness, no el Chrome de Jarvis: Playwright no graba un contexto que no creó. Una corrida entra a `runs.json` cuando ya cerró con esas perillas. Medido el 2026-11-19, las dos a la vez: Finandina en qa (505169, 3 min 46 s de video) y CrediPullman en local (468438, 1 min 9 s), las dos en 11 |
| ¿mi cambio rompió OTRO flujo? · ¿la regla de `knowledge/` sigue en pie? | `make harness-regression TARGET=local` · `make harness-suite` · `make harness-knowledge TARGET=local` |
| ¿local está listo para decir la verdad? | `make harness-doctor TARGET=local` · `make harness-environment TARGET=local LIVE=1` · `make harness-wizard` (:5174) |
| ¿el ambiente remoto está al día con su rama? | `make harness-env-drift TARGET=qa` |
| ¿qué FALLA, desde cuándo y dónde? | `make harness-failures` |
| ¿en qué recorrido cae cada entidad? · ¿qué desenlace da cada comercio × entidad? | `make harness-journey TARGET=… MERCHANT=…` · `dev/sweep.ts` |
| ¿POR QUÉ terminó así? | `make harness-loki UREQ=… TARGET=…` (F-234; no mira prod) · sin uReq, `bin/pg logs` · el SSR: `make harness-ssr` |
| ¿qué VIO el cliente? | `make harness-posthog UREQ=… TARGET=… TEL=…` · `make harness-posthog-errors` |
| ¿qué contesta cada BURÓ para mi cédula? · ¿omitió el buró? | `make harness-bureaus-set DOC=… SET='…'` (`-show`, `-reset`; sólo el mock local :8105) · `bin/bureaus-profile.ts` (también qa) · `dev/experian-check.ts` |
| el canal QR (skill `harness-canal-qr`) | `dev/qr-corbeta.ts` · `dev/walk-qr.ts` · `npm run contrato:bancolombia` · `make harness-sandbox` (el gateway REAL del banco) |
| el canal ecommerce (skill `harness-canal-ecommerce`) | `make harness-ecommerce` · `make harness-payment-link TARGET=local` · `make harness-store` (tienda demo :8113). Las dos últimas ESCRIBEN |
| auto-onboarding · CreditopX rotativo | `make harness-auto-onboarding TARGET=local\|qa` · `make harness-revolving TARGET=local\|qa` (la copia desde prod: `dev/copy-creditopx.ts`, `--apply` escribe) |
| BCP vehicular · países · pipeline de KYC v2 | `make harness-bcp-return` · `make harness-suite-countries` · `make harness-pipeline` + `make harness-pipeline-run` (sólo local) |
| la sesión de asesor o admin · ¿el asesor de prueba ENTRA? | `make harness-session` · `make harness-login TARGET=…` · `make harness-login-check TARGETS=dev,qa,staging ALLIED=<id>` |
| ¿el asesor de prueba de PROD está bien armado? | `make harness-prod-advisor ALLIED=<id>` (sin entrar, sólo lectura) |
| ¿a dónde manda el front al elegir entidad, canal asesor? | `dev/advisor-target.spec.ts` |

**Las que ESCRIBEN fuera de local, o tocan prod.** La fila entera de cada una está en `HISTORY.md`: leela antes de
correrla.

- `make harness-vtex TARGET=qa [CASES=…]`: compra en la tienda VTEX de verdad. ESCRIBE pedidos en VTEX y en qa.
  ⚠ La condición de pago «Creditop» apunta a PRODUCCIÓN (workspace `master`): el runner la desvía a la afiliación de
  pruebas sólo mientras compra y la devuelve, también con Ctrl-C; mientras dura, una compra de otra persona en la
  tienda también va a qa. Una afiliación de `master` se rechaza antes de comprar: compraría en prod.
- `make harness-allied-create TARGET=local|dev|staging`: crea un comercio por el admin. El ambiente es obligatorio;
  `CHECK=1` sólo muestra con quién actuaría; lo creado lleva «PRUEBA AUTO» y es lo único que `CLEANUP=1` borra.
- `make harness-client-reset TARGET=… DOC=…` (o `PHONE=…`; `APPLY=1`): da de baja al cliente para repetir el
  registro. qa usa el admin de dev; nunca prod.
- `make harness-setting TARGET=… A=set|add|remove|undo`: en local, cualquier setting; en la base compartida, sólo
  agregar o sacar un comercio «PRUEBA AUTO» de las `TEST_SETTING_KEYS`. Deja su foto en `.runs/settings/` y el
  comando para deshacerlo.

Y la única que crea algo en PROD, con su fila entera; la corre una PERSONA en su terminal, no un agente:

| Comando | Contesta |
|---|---|
| `dev/prod-run.ts` | **¿qué guarda PRODUCCIÓN de verdad?** (`E2E_TARGET=prod node dev/prod-run.ts [--apply]`, en la terminal de una persona). El único camino que crea algo en prod: el flujo público (registrar celular → OTP por SMS, que se tipea → datos personales) y para ahí, sin listado. Antes comprueba, sólo leyendo: la cédula en `PROD_ALLOWED_DOCS` y los datos de la persona en `harness/.env.prod` (fuera de git), una sucursal sin entidades que no consulte Experian (por defecto la de prueba de Creditop, `1a675cc3`), que no haya cliente activo con esa cédula y que el backend responda (pide la VPN de PROD). No importa `pkg/db.ts`: ni siembra, ni bypass, ni scrub. Para repetir, la baja es a mano en el admin de prod |

⚠ **El `cURL error 7` a `127.0.0.1:9` NO es un fallo.** Aparece en casi cualquier forense local y es
deliberado: `H2O_API_HOST` y `CREDIFAMILIA_HOST_OAUTH` apuntan al puerto *discard* a propósito (sin
ellas, `main` devuelve 500 en todo `/lenders`). No hay nada que arreglar.

⚠ **Antes de agregar una función a un runner, `grep` el nombre en `dev/`**: la capacidad compartida va a
`pkg/`, y las lecturas de la base de legacy-backend van por el conector (`pkg/backend-reads.ts` → `bin/pg … --json`),
no con SQL propio. El comando que encuentra las duplicadas y la lección de cada módulo:
[`HISTORY.md`](HISTORY.md) §«Funciones duplicadas entre runners».

Los specs de `channel/` corren contra **local** por defecto (`playwright.config.ts` fija
`E2E_TARGET ||= 'local'`); sin eso escribían en dev, y la guarda F-53 no frena las escrituras por API.

## Las recetas de código: correr el backend sin armar un flujo

`dev/recipe.ts` (Miguel, 2026-11-18: «herramientas que el modelo use día a día, como un artesano»). Corre PHP ADENTRO
de la app local —`legacy-backend` por defecto, o `legacy-application`— con sus clases, sus modelos y su base, por
`sail artisan tinker`, y devuelve lo que dio en segundos. Es el «corrido en local» de las incidencias sin caminar el
wizard: la clase que decide, llamada directo (un método privado, por reflexión, como hace `continuity`).

- **Una receta es un archivo de `recipes/<nombre>.php`**: PHP normal (`use`, `const`, funciones), con un comentario
  arriba cuya primera oración es la pregunta que contesta, y las marcas `@repo`, `@param <nombre> <qué es>` (adentro
  llega en `$params`) y `@writes` si escribe en la base local. Lo que `return`a sale como resultado; lo que imprime,
  como salida. Agregar una es agregar el archivo: sale sola en la lista y en el panel. **Un probe libre que sirvió dos
  veces se guarda como receta.**
- **El modo libre** (`CODE='…'`): una expresión sola se devuelve; un bloque con `;` va tal cual. No se guarda.
- ⚠ **Sólo local, por construcción**: el mismo proceso de PHP mira a qué base apunta la app ANTES de incluir la receta
  y no sigue si no es la del contenedor (`mysql`, `127.0.0.1`, `localhost`); sale 2. No hay `TARGET=` que cambiar.
  Medido el 2026-11-18 con la app apuntando a otro host: se negó. Los archivos temporales (`.harness-recipe-*.php` en
  la raíz del repo) se borran siempre, también si falla.
- Salida: `0` corrió · `1` la receta tiró una excepción (sale la clase, el mensaje y el archivo:línea) · `2` uso o la
  guarda. `JSON=1`: un objeto con `ok`, `result`, `output`, `error`. Cada corrida deja su última vez en
  `.runs/recipes/<nombre>.json`, que muestra la pestaña **Recetas** de la consola del panel (sólo la lista: las corre
  el agente).
- Las cinco que vivían sueltas en el Makefile (`harness-duplicate-phone`, `-user-country`, `-merchant-api-country`,
  `-reentry`, `-dni-clash`) son recetas desde el 2026-11-18, con el mismo `make` de siempre.
- **Las que leen y se usan a diario** (2026-11-18, cada una corrida en local en ~1 s): `salary` y `continuity` (el
  ingreso y la continuidad que toma el perfilamiento, con la fuente de cada uno), `debt-capacity` (la capacidad del
  detalle del backoffice y el monto de Finandina, con el cálculo del motor), `cancel-check` (si una solicitud se puede
  cancelar y qué la frena, sin cancelarla), `lender-quota` (el cupo del mes de una entidad CreditopX, por perfil) y
  `experian-omit` (si una sucursal se salta Experian según el código; si no coincide con `bin/pg experian check`, hay
  un bug). `make harness-recipe` dice qué pide cada una.
- **Al escribir una**: `$request->status` de `UserRequest` es una COLUMNA que tapa la relación del mismo nombre (va
  `$request->status()->value('name')`); y una receta que copia la lógica en vez de llamarla (`cancel-check` copia las
  guardas de `safeCancel` porque cancelar escribe y avisa a la tienda) lo dice en su comentario. `CODE` y `ARGS` pasan
  por `make` sin expandir: `$x` llega entero.

## Recorridos: cómo se nombra lo que se prueba

Un recorrido es `canal · riel · producto · +variación · desenlace`. Los nombres viven en
`journeys.json` y el porqué, con sus fuentes en `main`, en `knowledge/origination-paths`. Los
rieles se agrupan por dos ejes: **dueño de la política** (la entidad o Creditop) y **dónde se origina**
(afuera o en casa). El riel 4 se origina en casa y no es CreditopX. Una **variación** cambia el camino;
un **ajuste** (reglas, categorías, plazos, perfil) cambia valores en el mismo camino.

`make harness-journey TARGET=… MERCHANT=…` (o `LENDER=149,172`) mide en la base en qué recorrido cae
cada entidad. No se guarda: el riel de una misma entidad cambia entre ambientes. Antes de escribir una
suite o tocar un runner, ubicá el cambio: **encaja** (sólo ajustes), **encaja con variación** (una
variación o formalización que el catálogo no tiene) o **recorrido nuevo**.

El caminador y `harness-case` imprimen el recorrido de cada caso. El **formulario adicional**
(`dynamic-form/<n>`, `additional-info/<n>`) sólo lo recorre el caminador, y en local sus respuestas las guarda
`mock-forms-g2` (:8109). Los comandos de Motai y Credifamilia: [`HISTORY.md`](HISTORY.md) §«De Recorridos».

## Cuándo cargar una skill

Lo profundo vive en skills, y se carga cuando hace falta:

| Skill | Cargala cuando |
|---|---|
| `harness-local` | armes o repares local: S3, workers de PHP, `DOC_GEN_*`, pdf-mapper, `.env.local` del wizard, stashes, siembra, Cognito, Loki local |
| `harness-caminador` | uses `harness-walk-wizard`: los dos motores, las puertas, el login de asesor, BCP, el funnel de RD |
| `harness-desenlaces` | un caso tenga que cerrar: `LAMBDA=1`, la cuota inicial con Wompi, los webhooks de rt=1 y rt=0, qué mirar antes de concluir |
| `harness-canal-qr` | trabajes el canal QR / Corbeta / Bancolombia |
| `harness-canal-ecommerce` | trabajes la entrada por tienda (URL base64) |
| `harness-panel` | toques el panel: el mapa del recorrido, `CAPS`, el selector de comercio, el switch de front/Cognito |

Propuestas para el panel salidas de las corridas: `panel/IMPROVEMENTS-FROM-THE-RUNS.md`. Respetan la
regla: el panel corre, no valida.

## Cada corrida destruye la anterior — hacé la forense ANTES

`bin/advisor` arranca siempre con `scrubphone` (`bin/advisor:99`), que borra los users cliente del teléfono
de bypass **y sus `user_requests`**, con `FOREIGN_KEY_CHECKS=0` (`pkg/advisor.ts:178-197`). No hay undo.

- Antes de borrar, el scrub **vuelca lo que está por perderse** a `.runs/ureq-<id>.json` (estado, lender,
  records). Si te falta una corrida vieja, entrá por ahí.
- Si `user_requests` te da vacío para un id que imprimió una corrida vieja, no concluyas "nunca existió":
  lo borró el scrub (F-52). Mirá `.runs/`.
- `user_request_records` **no** está en `childTables` (`pkg/advisor.ts:17-24`) → sobrevive huérfano. Es lo
  único que permite reconstruir a posteriori; entrá por ahí.

## No le creas al verde

`dev/guided.spec.ts` se traga casi todos los errores con `.catch(() => {})` vacíos, y `shot()` imprime
`📸 <archivo>` aunque el screenshot haya fallado: un «1 passed» no dice nada (el conteo y el único paso
blindado: [`HISTORY.md`](HISTORY.md) §«De No le creas al verde»).

- Cada navegación se imprime **contrastada con la BD** (`pkg/trace.ts`): a la izquierda dónde está el
  front, a la derecha el estado real de la solicitud, con `▲` cuando la BD se movió. El navegador muestra
  la *pretensión*; la BD, lo que pasó.
- El guiado cierra con **TRAZA CONTRASTADA** (transiciones + tramos ciegos + alertas) y un **VEREDICTO**.
  Falla si la solicitud terminó Cancelada/Negada sin pedirlo, **o si el front mostró una pantalla de
  éxito con la BD sin sellar** (el patrón exacto de F-50). Leé ese bloque, no el "1 passed".
- Un **tramo ciego** largo (muchas pantallas sin una sola transición) es la firma de un flujo que avanza
  en pantalla sin persistir: la traza lo señala solo.
- Si escribís pasos nuevos, no envuelvas en `.catch` vacío el paso que le da sentido a la corrida (F-03).

## Cuatro formas de correr un flujo — cuál elegir

Se diferencian en **qué recorren**, y eso decide qué pueden encontrar (la tabla medida: `HISTORY.md`):

| camino | comando | qué recorre | tiempo (local) |
|---|---|---|---|
| **1 · UI**, el de Miguel | el panel (`make panel`, :5195) | el wizard en una ventana, a mano | el de quien maneja |
| **2 · navegador sin ventana** | `make harness-walk-wizard ENGINE=browser` | el wizard en Chromium: el JavaScript de la página | ~3 min por caso |
| **3a · el wizard por HTTP** | `make harness-walk-wizard` | loaders, actions y zod de cada pantalla, sin navegador | ~20 s por caso |
| **3b · el backend directo** | `make harness-case` | la API del backend, sin front | segundos |

**Cuál usar:**
- **¿Esta regla excluye de verdad?** o **¿qué pasa si el cliente es así?** → **3b**.
- **¿El flujo pasa pantalla por pantalla?**, rápido y con varios comercios → **3a**.
- **¿Funciona en la pantalla?**, o cuando 3a da verde y algo se rompe al hacer clic → **2**. El 2026-09-25
  encontró, en una sola tarde, cosas que 3a no ve: el 500 de la firma, la pantalla de OTP de la entidad que
  no existe fuera del asesor, las tarjetas que se despliegan.
- **Para mirarlo** → **1**.

**Las diferencias que hacen equivocarse de camino:**
- **Canales.** 3a y 2 entran por `FLOW=self-service|merchant|ecommerce`. **3b no tiene la tienda.**
- **Las perillas del cliente.** En 3b cada caso lleva las suyas (`CASES='pullman@score=700;pullman@score=300,income=900000'`);
  con `LAMBDA=1` se dicta el buró entero, y lo que no se dice es el cliente por defecto del panel
  (`CASE_BUREAU_DEFAULTS` en `pkg/risk-lambda.ts`). En 3a y 2, `AMOUNT`, el score y el ingreso valen para toda la
  tanda. Las claves que una suite puede dictar y afirmar (`categoria`, `cupo`, `plazo`, `consulta`, `preparar`…) y
  `"ambientes"` (en otro target la suite no corre y sale **3**): `HISTORY.md` §«De Cuatro formas…».
- **Una prueba que dicta un buró comprueba que contestó el lambda** (`bureauSourceProblem` en `pkg/loki.ts`): ante
  cualquier no-2xx el backend cae al fixture en silencio y el flujo sigue (F-139).
- **Las corridas que cierran agotan el cupo mensual del perfil en local**: `make harness-quota-reset TARGET=local APPLY=1`.
- **`TARGET=` es obligatorio** en `harness-case`, `-listing`, `-walk-wizard` y `-suite`, y es el que manda. Hasta el
  2026-11-02 esos cuatro no lo pasaban: el runner sólo lee `E2E_TARGET` (default `dev`), así que `TARGET=local`
  corría contra la base compartida. `E2E_TARGET` exportado sigue valiendo; si los dos difieren, no se corre.
- **Dos tandas lanzadas a la vez comparten identidad** (skill `harness-caminador`): los casos que tienen
  que ir juntos van en UNA tanda, con `PARALLEL=1`.
- **En paralelo sale casi gratis** en 2 y 3a: la tanda tarda lo que su caso más lento, y un caso completo
  cuesta lo mismo solo que con cinco al lado. Con `PHP_CLI_SERVER_WORKERS` ≥ casos (skill `harness-local`).

**Targets, variables y flags van en inglés, y los nombres viejos NO se borran**: siguen como alias
(`HARNESS_OLD_TARGETS` y `HARNESS_OLD_VARS` en el `Makefile`, `pkg/cli-aliases.ts`, `pkg/env.ts`), porque las
tareas guardan el comando exacto de cada medición.

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** El flujo por API, sin navegador, en segundos.
  **Exit code = veredicto**: `0` cerró · `1` desenlace malo o el front mintió · `2` quedó a mitad · `3` la suite no vale en ese target (`"ambientes"`) y no se corrió.
  **Para un agente, `JSON=1`** en `harness-case` y `harness-suite`: el texto va a stderr y stdout lleva un solo
  objeto `harness.case/v1` (casos con su solicitud, listado, cierre y desvíos; `ok`; `sinVeredicto` si no llegó
  a decidir). No busques el veredicto en el texto: cambia. Una suite con una clave que el runner no conoce
  **no corre** (antes se ignoraba y daba verde): al agregar una aserción, va también a `SUITE_KEYS` en `dev/case.ts`.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`, `dev/guided.spec.ts`): el wizard real
  con bypasses, para lo que un mock no puede dar.
- **Forense de logs — `dev/loki-trace.ts`.** Se dispara solo al cerrar si el veredicto salió mal o a
  mitad, y vuelca a `.runs/forense-<ureq>/`. ⚠ **NO es fuente de aserción y no entra en `veredicto()`**:
  la ausencia de una línea tiene cuatro causas indistinguibles. Solo ve `legacy-backend`. «Cero anclas»
  no es «no se sabe hasta dónde llegó»: eso lo dice la BD (`bin/pg sql`, el estado de la solicitud).

**No metas el modo rápido en el panel.** Ya se intentó y se revirtió: el panel existe para probar el
FRONTEND a mano.

Los dos caminos usan **la misma** capa de aserción (`pkg/trace.ts`): no la dupliques. Si el rápido pasa y el
visual falla, el problema está en el frontend, pero no vale al revés, y ninguno cubre los esquemas zod del front
(F-50, F-88): `HISTORY.md` §«De Dos caminos».

⚠ **NO apuntes el target `local` al Loki de dev**: leerías la corrida de otro con el mismo
`user_request_id` (la BD local es un dump de dev). `pkg/loki.ts:porQueNo` lo bloquea.

## Lo que aprendieron los runners, y vale para cualquiera

- **El veredicto del runner y lo que quedó en la base son DOS cosas.** Al cerrar, `case.ts` imprime
  `base: quedaron N usuario(s) y M solicitud(es) nuevos`. Tres veces reportó «0/N cerraron» con la base
  llena (el guard cortó después de que la API escribió, o el gateway dio 504 mientras PHP terminaba).
  **Leé esa línea antes de repetir una corrida «fallida»** contra la compartida: repetirla duplica datos.
- **El comercio se resuelve por `#hash`, por SLUG exacto o por NOMBRE (subcadena), en ese orden.**
- **El país del comercio NO se adivina**: si el payload no responde, el caso aborta diciendo por qué. Un
  fallback que esconde la saturación es peor que fallar.
- **Hay UN solo camino de ejecución, y `LAMBDA=1` sólo DICTA el buró.** Sin él corre el flujo real con el
  buró que tenga el ambiente; con él, se dicta la respuesta de cada central para esa cédula. En local,
  sin `LAMBDA=1` una compra de CrediPullman no cierra (skill `harness-desenlaces`).
- Los `.catch` silenciosos y los límites para leer tiempos (ni local ni `qa` sirven para medir carga, F-180 y
  F-181): [`HISTORY.md`](HISTORY.md) §«De Lo que aprendieron los runners».

## Mocks: arrancá a mano los que nadie levanta

**Con el panel arriba, él es el dueño de los mocks** (`panel/mocks.ts`, con el registro compartido en
`pkg/mock-registry.ts`): levanta los que faltan, adopta los que ya estaban sin matarlos y reinicia los suyos si se
caen o si su código cambió. Se manejan en la pestaña **Mocks** (`?consola=mocks`); `HARNESS_MOCKS=0` arranca el
panel sin tocar ninguno. Lo de abajo vale cuando el panel no está corriendo (los runners por consola); qué levanta
`bin/advisor` por su cuenta y el detalle: `HISTORY.md` §«De Mocks».

- **Los cuatro de Credifamilia no los levanta nadie.** Si tu flujo toca rt=4, corré vos
  `bin/mock-pdf-mapper start` (:8100, la vinculación **y el merge del paquete**), `bin/mock-deceval start`
  (:8106, el pagaré), `bin/mock-netco start` (:8107, la firma) y `bin/mock-credifamilia start` (:8108, la
  **radicación**). Faltando uno de los tres primeros, la solicitud queda en **estado 28** con un mensaje
  que habla del proveedor y no del mock (F-165).
  ⚠ **El cuarto es distinto y peor**: sin él la solicitud llega igual a **estado 11**, el endpoint
  devuelve **200** y el runner dice «cerró» — pero el backend salió al **sandbox real del lender**, dio
  504, y el crédito **nunca se radicó** (F-168). `dev/case.ts` ya avisa los cuatro en el prevuelo cuando
  el caso va a cerrar, y ahora reporta el estado de la radicación en cada cierre.
- **Si editás un mock, reinicialo** (`bin/<mock> stop && bin/<mock> start`): Node no recarga el módulo y `start`
  contesta `✓ ya arriba` sirviendo el código viejo (F-87). Sólo `mock-bancolombia` y `mock-corbeta` se reinician
  solos.

## Qué es real en cada target

**La regla del harness: `local` mockea, `dev` y `staging` prueban contra lo real.** Si en dev algo sale
por un mock, dev deja de ser representativo y la prueba no vale.

| | `local` | `dev` | `staging` | `qa` |
|---|---|---|---|---|
| pre-aprobaciones | mock `:8095` | **MS real** `pre-approvals-service…:8082` | MS real | MS real |
| └ Credifamilia en el MS | — | **lambda mock** `credifamilia-mockery-lamba` (desde 2026-10-15; antes el sandbox `pruebas.credifamilia.com.mx`, que rechazaba a todos). Se dicta con `LAMBDA=1 CF_FIANZA=…` | lambda mock | lambda mock |
| payvalida · mdm · lenders · forms · ábaco | mocks | reales | reales | reales |
| backend (rama que sirve) | local (sail/Docker) | `legacy-backend` → **develop** | `legacy-backend-stg` → **staging** | `legacy-backend-qa` → **qa** |
| BD | local (sail/Docker) | dev real (compartida) | **la misma de dev** | **la misma de dev** |
| front | local `:5174` | local `:5174` | **desplegado** (`originaciones-stg`) | **desplegado** (`originaciones-qa`) |

⚠ **`dev` y `staging` NO son el mismo backend, aunque el cluster se llame igual.** En `inertia-develop`
conviven **dos servicios**: `legacy-backend` (sirve la rama `develop`, workflow `main-dev.yaml`) y
`legacy-backend-qa` (sirve **`qa`**, workflow `main-qa.yaml`). La **BD sí es compartida**, así que un dato
sembrado se ve desde los dos y todo *parece* consistente — lo que cambia es **qué código responde**.
Confundirlos hace medir la rama equivocada: probando Ábaco contra `legacy-backend` (develop) daba
`MOTV1000` porque esa rama todavía decide por los modos deprecados, y se leía como "el feature está roto"
cuando en `qa` respondía `MOTV1001`. Para saber qué rama tenés enfrente, pedí un campo que solo exista en
una: `GET /api/loans/allied/{hash}` trae `allowed_document_types` solo con motai-v2 (o sea, solo en `qa`).

⚠ **El `APP_ENV` de `staging` está en disputa**: lo observado (el bypass de OTP anda ahí) y lo que dice el código
(`APP_ENV=develop` en los cuatro ambientes que no son producción) no encajan. Las dos mediciones: `HISTORY.md`
§«De Qué es real en cada target».

**La regla práctica hasta que alguien lo mida en el servicio: NO des por apagado nada en staging.** Ni
el OTP, ni la validación de nombre del KYC, ni ninguna otra condición
`app()->environment(['local','development'])`. Comprobá el valor efectivo antes de armar una prueba
encima. Y al revés, un `config('app.env') === 'staging'` (hay uno en `InitialFeePaymentService`)
tampoco dispara con ninguno de los dos valores. *(Vivía en el `CLAUDE.md` raíz hasta el 2026-09-27.)*

## Reglas sueltas

- **No corras `npm test` pelado**: colecta 98 tests en 35 archivos e incluye `dev/guided.spec.ts`, que es
  interactivo (`testIgnore` solo saca `_scratch/` y los reportes — `playwright.config.ts:28`). Pasá rutas.
- **En toda llamada por API mandá `x-cognito-identity-id`**: sin ese header `update-user-request` pone
  `corporate_user_id = NULL` y te borra el asesor de la solicitud en silencio (F-46).
- **Qué puede hacer el harness en cada ambiente lo dice UN archivo: `pkg/target-policy.ts`.** Prod (y cualquier
  target con `E2E_TARGET_READONLY=1`) es de sólo lectura POR REGLA: el `fetch` del proceso (lo instala `pkg/env.ts`)
  rechaza todo lo que no sea GET/HEAD/OPTIONS, la guarda de la base no escribe ni con
  `I_KNOW_THIS_TOUCHES_SHARED_DEV`, y `case`, `listing`, `sweep` y `walk-wizard` no arrancan (salida 2); la macro
  `harness_target` del `Makefile` tampoco acepta `TARGET=prod`. Y un target remoto no le habla al backend local
  (`http://localhost/api`) ni abre la base sin `E2E_DB_HOST`: las dos son una variable que falta y el resultado sería
  de local con la etiqueta de otro ambiente. Hasta el 2026-11-02 prod era de sólo lectura por AUSENCIA —el
  `.env.prod` del harness no traía API ni base, así que `TARGET=prod` corría contra localhost y lo reportaba como
  prod—. Fuera de la regla: el navegador de Playwright, `bin/pg` (Go, ya de sólo lectura en prod) y
  `dev/prod-run.ts`, que no importa `env.ts` a propósito: es la única excepción de prod y la corre una persona.
- **Correr el arnés contra la compartida YA NO pide `I_KNOW_THIS_TOUCHES_SHARED_DEV`.** La guarda sigue
  entera; lo que cambió es que las escrituras del arnés tienen **permisos angostos**
  (`PERMISOS_ANGOSTOS` en `pkg/db.ts`) en vez de necesitar el permiso general, que abría CUALQUIER
  escritura durante toda la shell — o sea que empujaba justo hacia lo peligroso. Hoy hay tres:
  `otp-bypass` (los teléfonos de prueba, `pkg/otp-bypass.ts`), `credencial-de-entidad` (la credencial
  comercio↔entidad que copia la siembra) y `siembra` (el cliente sintético, `pkg/inject.ts`).
  ⚠ **El permiso se concede por la SENTENCIA, no por la etiqueta**: el SQL tiene que matchear su patrón,
  así que no se puede usar de contrabando para otra escritura.
  ⚠ **Y `siembra` exige ADEMÁS un ámbito por usuario**, porque toca `users`, `user_summaries`,
  `user_field_values` y `risk_central_user_data`, que son tablas de personas: `UPDATE users … WHERE id=?`
  tiene la misma forma para un cliente sintético que para alguien real, así que el patrón no alcanza y
  hacen falta las FILAS. `synthFill` abre el ámbito con `conAmbitoDeSiembra([userID])` en cuanto resuelve
  el usuario del `user_request`, y fuera de ese ámbito la misma sentencia se bloquea. **Si agregás una
  escritura a la siembra, va con su patrón y su `usuario`** — si no, la guarda la frena y dice cuál era.
  ⚠ Lo que esto **no** cubre: que alguien abra el ámbito sobre una persona real a propósito. Eso deja de
  ser un accidente, que es la línea que el permiso general no sabía trazar. Para escribir algo que no sea
  del arnés, el flag se exporta igual.
- **El scrub por consola va con `E2E_TARGET=local` EXPLÍCITO** en el env del hijo: `bin/dbops.ts` es otro
  proceso, su default es **dev**, y ahí el guard de escrituras compartidas lo bloquea (F-53) sin que se note.
- El panel lanza `bin/advisor <slug>` **sin `auto`** (`panel/server.ts:153`) → siempre modo manual. El
  guiado es solo por terminal, y ahí el **comercio va primero**: `bin/advisor <comercio> auto`.
- Si matás `bin/advisor` con `kill -9`, verificá que el wizard recuperó su `.env.local`: queda en
  `.env.local.asesor-bak` y solo lo restaura el `trap EXIT` (`bin/advisor:198-201`).
- **El panel (:5195) suele estar YA arriba**: lo levanta Cockpit cuando Miguel abre la app Harness
  (`bin/cockpit status`). Si contesta, usá ése. Si lo levantás vos, bajalo al terminar: una instancia tuya
  colgada deja a Miguel sin poder arrancar el suyo (ya pasó dos veces).
- **El wizard local pide el monorepo instalado con `pnpm`**, no `npm` (skill `harness-local`).

## Qué deja esto en la tarea

Una corrida termina cuando lo que probó queda escrito donde alguien lo vuelva a encontrar, en la tarea de
[`tablero/`](../tablero/CLAUDE.md):

| lo que produjo la corrida | dónde va |
|---|---|
| la RECETA para volver a correrlo | **«Cómo se comprueba — y el MATERIAL»** del documento, que se MANTIENE |
| lo que pasó ESE día | **un bloque de la pila** (`BLOCK=<id|slug>`), que se APILA |
| una trampa del SISTEMA, reproducible y con causa raíz | **`F-xx`** en `knowledge/traps/traps.md` |

⚠ **Va el COMANDO, no la conclusión**, y el validador de la pila lo exige: la caja ` ```harness ` con su
`TARGET=` y debajo su `Resultado:`. Con `BLOCK=<id|slug>`, `harness-case`, `-listing`, `-walk-wizard` y
`-suite` agregan la corrida sola (`pkg/annotation.ts`). `MD=1` la emite como anotación, para un documento
que no es una tarea. Lo que se resume es el DESENLACE —qué entidades salieron y dónde terminó cada caso—,
no el conteo.

⚠ **A Jira NO va el arnés.** En `## Tarea (publicable)` va *«se recorrió el flujo de punta a punta con un
cliente de prueba»*, nunca `make harness-walk-wizard`. La regla: `tablero/CLAUDE.md`, «La frontera del
guard está DENTRO del archivo».
