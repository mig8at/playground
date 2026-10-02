# harness · reglas de trabajo

> **Para qué existe:** es **la herramienta con la que se valida una tarea contra el código real.** No es
> contexto (eso es **canon**) ni el trabajo en sí (eso es `tablero/`): es lo que se usa para **comprobar
> corriendo** lo que en los otros dos está escrito. Si una afirmación se puede verificar acá, verificala
> antes de escribirla como cierta en un nodo.

Lo descriptivo (arquitectura en detalle, envs, Node 22.18+) vive en `README.md`. Acá van las **reglas
que ya costaron tiempo** — y el mapa mínimo para no perderse.

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

⚠ **`mock-forms` (:8101) y `mock-forms-g2` (:8109) son de DOS servicios distintos**, y el parecido de
los nombres ya costó una vuelta. El primero imita `onboarding-forms-service` —el flujo dinámico de los
comercios de RD, cuelga de `VITE_ONBOARDING_FORM_SERVICE`—; el segundo imita `form-service` —el
backend-driven, de donde salen el formulario del VEHÍCULO de BCP y los árboles de opciones, cuelga de
`VITE_FORM_SERVICE_BASE_URL`—. El segundo **no es opcional en local**: guardar un formulario ESCRIBE, y
sin él `bin/advisor` cae al host de dev, donde el `user_request_id` de una corrida local es la solicitud
de otra persona. Los esquemas son los de dev, capturados en modo lectura (`bin/mock-forms-g2 capturar`).

**Las herramientas de consola, por la pregunta que contestan:**

| Comando | Contesta |
|---|---|
| `dev/sweep.ts` | ¿qué desenlace da cada comercio × entidad? (modos `matrix` · `close` · `abaco`) |
| `dev/qr-corbeta.ts` · `dev/walk-qr.ts` | el canal QR: ¿cierra en estado 25 con código? (API) · ¿qué pantallas existen y en qué orden? (clickea). El detalle: skill `harness-canal-qr` |
| `dev/bancolombia-contract.ts` · `dev/sandbox-bancolombia.ts` | ¿el mock cumple los zod del front? (`npm run contrato:bancolombia`) · ¿el banco DE VERDAD acepta lo que mandamos? (`make harness-sandbox`, el único contra el gateway real) |
| `dev/experian-check.ts` | ¿esta solicitud omitió el buró, y se puede *afirmar*? (F-60) |
| `make harness-ssr` | **¿a qué servicio llamó el SSR del wizard, y cómo le fue?** Sus líneas `[outbound]` son la ÚNICA vista de eso. `SOLO=1` filtra; `FOLLOW=1` sigue. ⚠ Lo escribe `bin/advisor` en `/tmp/asesor-wizard.log`: si levantaste el wizard a mano, su salida está en ESA terminal |
| `dev/loki-trace.ts` | ¿POR QUÉ terminó así? forense en los logs (`make harness-loki UREQ=…`). Ancla en los LOGS; `make trazador-ureq` ancla en la BD y es la única que llega a prod. ⚠ Defaults OPUESTOS (`local` acá, `prod` allá): el target va escrito siempre |
| `bin/pg logs` (en la raíz) | los CUERPOS crudos de Loki cuando no hay uReq que anclar. ⚠ El PHP de dev **y de qa** loguea como `service_name="CreditopDev"` (F-179) |
| `dev/bcp-return.ts` | el flujo VEHICULAR de BCP por HTTP, y qué se PIERDE al volver atrás (`make harness-bcp-return`; F-185, F-186). En local pide `make harness-peru` + `make harness-forms-g2`; contra `qa` el comercio ya existe (skill `harness-caminador`) |
| `make harness-suite-countries` | ¿el cliente nace con el país de su comercio, su documento y su celular? (`suites/paises.json`; `requiere: lambda`) |
| `dev/ecommerce.ts` | el CANAL ecommerce de punta a punta por API y en JSON (`make harness-ecommerce`). ⚠ Solapa con `channel/ecommerce-*.spec.ts` (por navegador): antes de agregar casos, decidir cuál es el lugar. El detalle: skill `harness-canal-ecommerce` |
| `dev/screens.ts` | ¿por qué PANTALLAS habría pasado el cliente? (`make harness-screens`; derivado del router en `main`) |
| `dev/posthog-ureq.ts` | ¿qué VIO el cliente? eventos de una solicitud cruzados con las pantallas (`make harness-posthog UREQ=… SINCE=…`). ⚠ Al cerrar la lectura suele venir PARCIAL (ingesta de minutos); local no escribe; prod y dev comparten ids, así que se filtra por ambiente Y hora |
| `dev/posthog-errors.ts` | ¿qué PANTALLAS del front se rompen, y con qué? (`make harness-posthog-errors`). Sólo `staging` y `production`. El conteo es frecuencia, no gravedad |
| `dev/login-check.ts` | ¿el ASESOR DE PRUEBA de un comercio (`c…-fake@`) ENTRA al wizard de cada ambiente? (`make harness-login-check TARGETS=dev,qa,staging ALLIED=<id>`). Un proceso hijo por ambiente; sin clave sólo descubre a qué login alojado manda cada front. La clave sale de `ALLIED_TEST_ADVISOR_PASSWORD`. No toca el cache de sesión. La lógica pura vive en `pkg/login-probe.ts` |
| `dev/warm-session.spec.ts` | la sesión de asesor caducó: pre-login que deja `.auth/cognito-state.<target>.json`. ⚠ Contra `qa` y `staging` va HEADED (F-66) |
| `dev/advisor-target.spec.ts` | ¿a dónde manda el front al elegir una entidad, canal ASESOR? Usa `chooseEntity`, no un localizador propio |
| `dev/walk-wizard.ts` | ¿el FRONT encadena bien las pantallas? (`make harness-walk-wizard`). El detalle: skill `harness-caminador` |

⚠ **El `cURL error 7` a `127.0.0.1:9` NO es un fallo.** Aparece en casi cualquier forense local y es
deliberado: `H2O_API_HOST` y `CREDIFAMILIA_HOST_OAUTH` apuntan al puerto *discard* a propósito (sin
ellas, `main` devuelve 500 en todo `/lenders`). No hay nada que arreglar.

⚠ **Antes de agregar una función a un runner, `grep` el nombre en `dev/`**: la capacidad compartida va
a `pkg/` (`http.ts`, `phones.ts`, `merchants.ts`, `otp-bypass.ts`, `cognito.ts`…), porque cada copia
aprende una lección distinta y dejan de hacer lo mismo. Las duplicadas se encuentran en un comando:

    for f in dev/*.ts; do grep -hoE '^(export )?(async )?function [a-zA-Z_][a-zA-Z0-9_]*' "$f" | sed -E 's/.*function //' | sed "s|\$| $f|"; done | sort | awk '{n[$1]=n[$1]" "$2; c[$1]++} END {for (k in c) if (c[k]>1) print k, c[k], n[k]}'

| en `pkg/` | la lección que sólo tenía UNA de las copias |
|---|---|
| `http.ts` | un timeout **no** es una caída, y `HTTP 0` los confunde (90.002 ms leídos como «el backend se murió») |
| `phones.ts` | el LARGO y el PREFIJO salen del país: en RD el área ES el país, y un dígito cualquiera ubica el número en otro lado **sin fallar** |
| `merchants.ts` (`findBranch`) | el canal de tienda necesita la sucursal **con credencial de ecommerce** |
| `otp-bypass.ts` | dos corridas a la vez se pisaban la lista de teléfonos |
| `cognito.ts` (`sessionHealth`) | la sesión se juzga por el vencimiento de las cookies, no por el `mtime` del archivo |

Los specs de `channel/` corren contra **local** por defecto (`playwright.config.ts` fija
`E2E_TARGET ||= 'local'`); sin eso escribían en dev, y la guarda F-53 no frena las escrituras por API.

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

Hay **93 `.catch(() => {})`** en `dev/guided.spec.ts` (medido el 2026-09-02; el 31/7 eran 94 y antes 82 —
si el número te importa, contalo: `grep -c 'catch(() => {})' dev/guided.spec.ts`). El único paso blindado
es el salto a `/lenders`,
que distingue "ventana cerrada" y **tira** (`dev/guided.spec.ts:538-545`); el resto se traga el error.
`shot()` imprime `📸 <archivo>` aunque el screenshot haya fallado (`dev/guided.spec.ts:63-64`).

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

Se diferencian en **qué recorren**, y eso decide qué pueden encontrar. Medido el 2026-09-25 salvo
donde se dice otra cosa:

| camino | qué recorre | qué ve que los otros no | tiempo (local) |
|---|---|---|---|
| **1 · UI** — el panel (`make panel`, :5195). Es el de Miguel | el wizard en una ventana, manejado por una persona | lo que ve una persona: el diseño, la tarjeta del harness, lo que se siente raro | el de quien maneja (una compra por la tienda: 2 min) |
| **2 · navegador sin ventana** — `make harness-walk-wizard ENGINE=browser` | el mismo wizard en Chromium sin ventana: llena y hace clic | el JavaScript de la página: consola, botones que no se habilitan, tarjetas que se despliegan, el visor de PDF, pantallas que no existen | **~3 min por caso** (174–182 s hasta el estado 11), y en paralelo lo mismo |
| **3a · el wizard por HTTP** — `make harness-walk-wizard` (el motor por defecto) | el lado de servidor de cada pantalla (`.data`: loaders, actions, zod), sin navegador | el vínculo con el pedido y el prellenado en ecommerce; un action que redirige a donde no debe | ~20 s por caso (medido el 2026-09-03) |
| **3b · el backend directo** — `make harness-case` | la API del backend, sin front: crea la solicitud, inyecta el riesgo, pide el listado y elige la entidad | qué decide el backend y cómo responde cada entidad: espera, modal, redirect, OTP propio, error | segundos (no medido acá) |

**Cuál usar:**
- **¿Esta regla excluye de verdad?** o **¿qué pasa si el cliente es así?** → **3b**.
- **¿El flujo pasa pantalla por pantalla?**, rápido y con varios comercios → **3a**.
- **¿Funciona en la pantalla?**, o cuando 3a da verde y algo se rompe al hacer clic → **2**. El 2026-09-25
  encontró, en una sola tarde, cosas que 3a no ve: el 500 de la firma, la pantalla de OTP de la entidad que
  no existe fuera del asesor, las tarjetas que se despliegan.
- **Para mirarlo** → **1**.

**Las diferencias que hacen equivocarse de camino:**
- **Canales.** 3a y 2 entran por `FLOW=self-service|merchant|ecommerce`. **3b no tiene la tienda.**
- **Las perillas del cliente.** En 3b cada caso lleva las suyas (`CASES='pullman@score=700;pullman@score=300,income=900000'`).
  En 3a y 2, `AMOUNT`, el score y el ingreso valen para **toda la tanda**: dos montos distintos son dos tandas.
- **Dos tandas lanzadas a la vez comparten identidad** (skill `harness-caminador`): los casos que tienen
  que ir juntos van en UNA tanda, con `PARALLEL=1`.
- **En paralelo sale casi gratis** en 2 y 3a: la tanda tarda lo que su caso más lento, y un caso completo
  cuesta lo mismo solo que con cinco al lado. Con `PHP_CLI_SERVER_WORKERS` ≥ casos (skill `harness-local`).

### Los nombres están en inglés, y los viejos siguen andando

Desde el 2026-09-25 targets, variables y flags están en inglés (`harness-case`, `CASES=`, `--engine
browser`…). ⚠ **Los nombres viejos NO se borran**: las tareas guardan el comando exacto de cada medición,
y sin el nombre viejo no se podría repetir. Los traducen `HARNESS_OLD_TARGETS` y `HARNESS_OLD_VARS` en el
`Makefile`, `pkg/cli-aliases.ts` (flags) y `pkg/env.ts` (variables de entorno, como `E2E_ASESOR_SUB`). Las carpetas `mock-centrales/` y
`comercios/` pasaron a `mock-bureaus/` y `merchant-specs/`.

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** El flujo por API, sin navegador, en segundos.
  **Exit code = veredicto**: `0` cerró · `1` desenlace malo o el front mintió · `2` quedó a mitad.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`, `dev/guided.spec.ts`): el wizard real
  con bypasses, para lo que un mock no puede dar.
- **Forense de logs — `dev/loki-trace.ts`.** Se dispara solo al cerrar si el veredicto salió mal o a
  mitad, y vuelca a `.runs/forense-<ureq>/`. ⚠ **NO es fuente de aserción y no entra en `veredicto()`**:
  la ausencia de una línea tiene cuatro causas indistinguibles. Solo ve `legacy-backend`. «Cero anclas»
  no es «no se sabe hasta dónde llegó»: eso lo dice `make trazador-ureq`, desde la BD.

**No metas el modo rápido en el panel.** Ya se intentó y se revirtió: el panel existe para probar el
FRONTEND a mano.

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica: dos definiciones de «pasó» es como empiezan a derivar. Un
runner PARALELO pide su instancia: `crearTraza({ salida, ancho })`.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que sólo existen en el visual
(F-50: una cancelación disparada por el routing del wizard). Y un tercer eje que ninguno cubre: **los
esquemas zod del front** —el backend es más laxo, así que la consola puede dar verde con el recorrido
visual roto (F-88)—.

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
- **Los `.catch` silenciosos se cuentan y se leen**: la mayoría son lecturas cuyo `null` se chequea en la
  línea siguiente. El que viola F-03 es el que se traga el paso que le da sentido a la corrida.
- **Límites del entorno al leer tiempos:** local sirve PHP con `artisan serve` —mide correctitud, no
  capacidad (F-181)— y `qa` es ¼ de vCPU con el ALB cortando a los 60 s (F-180). Ninguno sirve para
  medir carga.

## Mocks: arrancá a mano los que nadie levanta

**Desde el 2026-09-25 el panel es su dueño** (`panel/mocks.ts`, un registro de 19 con el mismo puerto y
el mismo «para quién» que usa `/api/estado`). Al arrancar, `npm run dev` levanta los que falten y
**adopta** los que ya estaban: un puerto que responde no se mata ni se reemplaza, queda como «otro
proceso». Mientras el panel viva, el que levantó él y se cae se reinicia (tres veces por minuto, después
queda en «se cae al arrancar») y el que tiene el código editado se reinicia solo — el F-87 de abajo deja
de pasar **para esos**. Uno ajeno con código nuevo no se toca: se marca «código nuevo». Al cerrar el panel
se cortan sólo los suyos. Se ve y se maneja en la pestaña **Mocks** de la consola (`#…?consola=mocks`),
por `GET /api/mocks` y `POST /api/mocks/<id>/(start|stop|restart)`, y el aviso de «falta» del pie ofrece
**Iniciar** en el lugar. `HARNESS_MOCKS=0` arranca el panel sin tocar ninguno. Lo de abajo sigue valiendo
cuando el panel no está corriendo (los runners por consola).

- `bin/advisor` levanta `mock-preapprovals` siempre (`bin/advisor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** + **financial-health** (`bin/advisor:189-199`).
  `mock-redirect` lo levanta `bin/ecommerce` (`bin/advisor:56`). Contra `dev` no se levanta ninguno de
  esos seis. `mock-financial-health` es distinto al resto: **no inventa datos** — lee el usuario
  sintético REAL de la BD local (por eso ocupa el `:4000` que el `.env` del wizard ya apunta). Ver F-70.
- **Los cuatro de Credifamilia no los levanta nadie.** Si tu flujo toca rt=4, corré vos
  `bin/mock-pdf-mapper start` (:8100, la vinculación **y el merge del paquete**), `bin/mock-deceval start`
  (:8106, el pagaré), `bin/mock-netco start` (:8107, la firma) y `bin/mock-credifamilia start` (:8108, la
  **radicación**). Faltando uno de los tres primeros, la solicitud queda en **estado 28** con un mensaje
  que habla del proveedor y no del mock (F-165).
  ⚠ **El cuarto es distinto y peor**: sin él la solicitud llega igual a **estado 11**, el endpoint
  devuelve **200** y el runner dice «cerró» — pero el backend salió al **sandbox real del lender**, dio
  504, y el crédito **nunca se radicó** (F-168). `dev/case.ts` ya avisa los cuatro en el prevuelo cuando
  el caso va a cerrar, y ahora reporta el estado de la radicación en cada cierre.
- **Si editás un mock, asegurate de que el proceso que corre sea ese código** (F-87). Node no recarga el
  módulo: `start` veía el puerto respondiendo y salía con `✓ ya arriba`, sirviendo la versión anterior — el
  arreglo no se aplicaba y **nada lo avisaba**. `mock-bancolombia` y `mock-corbeta` ya lo resuelven solos:
  publican en `GET /` la huella `codigo` (mtime de su `server.mjs`) y su launcher reinicia si difiere. Los
  otros mocks **todavía no**: ahí reiniciá a mano (`bin/<mock> stop && bin/<mock> start`). Y cuando un
  arreglo "no hace nada", la primera pregunta es si lo que corre es lo que editaste.

## Qué es real en cada target

**La regla del harness: `local` mockea, `dev` y `staging` prueban contra lo real.** Si en dev algo sale
por un mock, dev deja de ser representativo y la prueba no vale.

| | `local` | `dev` | `staging` | `qa` |
|---|---|---|---|---|
| pre-aprobaciones | mock `:8095` | **MS real** `pre-approvals-service…:8082` | MS real | MS real |
| payvalida · mdm · lenders · forms · ábaco | mocks | reales | reales | reales |
| backend (rama que sirve) | local (sail/Docker) | `legacy-backend` → **develop** | `legacy-backend-stg` → **staging** | `legacy-backend-qa` → **qa** |
| BD | local (sail/Docker) | dev real (compartida) | **la misma de dev** | **la misma de dev** |
| front | local `:5174` | local `:5174` | **desplegado** (`originaciones-stg`) | **desplegado** (`originaciones-qa`) |

⚠ Hasta el 2026-08-19, `.env.staging` apuntaba a **qa** (backend `-qa` + `originaciones-qa`) y el
target `staging` medía la rama equivocada. Se partió en dos: `.env.staging` (ahora sí `legacy-backend-stg`
+ `originaciones-stg`) y `.env.qa` (lo que el archivo viejo siempre fue). Para saber qué rama tenés
enfrente sin adivinar: `allowed_document_types` en `GET /api/loans/allied/{hash}` **solo** lo trae `qa`.

⚠ **`dev` y `staging` NO son el mismo backend, aunque el cluster se llame igual.** En `inertia-develop`
conviven **dos servicios**: `legacy-backend` (sirve la rama `develop`, workflow `main-dev.yaml`) y
`legacy-backend-qa` (sirve **`qa`**, workflow `main-qa.yaml`). La **BD sí es compartida**, así que un dato
sembrado se ve desde los dos y todo *parece* consistente — lo que cambia es **qué código responde**.
Confundirlos hace medir la rama equivocada: probando Ábaco contra `legacy-backend` (develop) daba
`MOTV1000` porque esa rama todavía decide por los modos deprecados, y se leía como "el feature está roto"
cuando en `qa` respondía `MOTV1001`. Para saber qué rama tenés enfrente, pedí un campo que solo exista en
una: `GET /api/loans/allied/{hash}` trae `allowed_document_types` solo con motai-v2 (o sea, solo en `qa`).

⚠ **El `APP_ENV` de `staging` está EN DISPUTA, y no conviene apoyarse en él.** Se llegó a dar por
`APP_ENV=development`, deducido de que el bypass de OTP de QA funcionaba ahí y ese exige
`local`/`development` (2026-08-14). **El código dice otra cosa**: verificado contra `main` el 2026-09-07,
los cuatro ambientes que no son producción construyen la imagen con **`APP_ENV=develop`** —así lo pasan
`main-dev.yaml`, `main-qa.yaml`, `main-stg.yaml` y `main-lab.yaml`—, el Dockerfile convierte ese
argumento en la variable del contenedor, y **`APP_ENV=development` no aparece ni una vez en la historia
de esos workflows** (`git log -S` devuelve cero). Y `develop` no es `development`: la comparación de
Laravel es de cadena exacta.

Con `develop`, el bypass de OTP devuelve falso en su primera línea y la comparación de nombre del KYC
vuelve a ser estricta. Las dos observaciones no encajan, y la explicación posible es que el secreto del
servicio pise `APP_ENV` en tiempo de ejecución, que no se lee desde el repositorio.

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
- **No te quedes con el puerto del panel (:5195).** Si dejás una instancia tuya corriendo, el
  `npm run dev` de Miguel no arranca. Ya pasó dos veces: levantalo solo si lo vas a usar, y bajalo.
- **El wizard local pide el monorepo instalado con `pnpm`**, no `npm` (skill `harness-local`).

## Qué deja esto en la tarea

Una corrida termina cuando lo que probó queda escrito donde alguien lo vuelva a encontrar, en la tarea de
[`tablero/`](../tablero/CLAUDE.md):

| lo que produjo la corrida | dónde va |
|---|---|
| la RECETA para volver a correrlo | **«Cómo se comprueba — y el MATERIAL»** del documento, que se MANTIENE |
| lo que pasó ESE día | **un bloque de la pila** (`BLOQUE=<id|slug>`), que se APILA |
| una trampa del SISTEMA, reproducible y con causa raíz | **`F-xx`** en `tablero/data/traps/doc.md` |

⚠ **Va el COMANDO, no la conclusión**, y el validador de la pila lo exige: la caja ` ```harness ` con su
`TARGET=` y debajo su `Resultado:`. Con `BLOQUE=<id|slug>`, `harness-case`, `-listing`, `-walk-wizard` y
`-suite` agregan la corrida sola (`pkg/annotation.ts`). `MD=1` la emite como anotación, para un documento
que no es una tarea. Lo que se resume es el DESENLACE —qué entidades salieron y dónde terminó cada caso—,
no el conteo.

⚠ **A Jira NO va el arnés.** En `## Tarea (publicable)` va *«se recorrió el flujo de punta a punta con un
cliente de prueba»*, nunca `make harness-walk-wizard`. La regla: `tablero/CLAUDE.md`, «La frontera del
guard está DENTRO del archivo».
