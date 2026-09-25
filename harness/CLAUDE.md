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
| `mock-corbeta` :8103 | `mock-bancolombia` :8104 | `mock-financial-health` :4000 | `mock-centrales` :8105 |
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
| `dev/qr-corbeta.ts` | ¿el canal QR cierra en estado 25 con código? (por API, sin browser) |
| `dev/walk-qr.ts` | ¿qué pantallas existen de verdad y en qué orden? (clickea solo). Al terminar imprime la pista de **PostHog** con la solicitud y la hora ya puestas — y contra local dice que no hay nada que mirar, porque el front local no escribe. ⚠ Es el runner que MÁS rastro dejaría en un ambiente desplegado (usa navegador: eventos del servidor + del cliente + grabación de sesión), pero hoy corre contra local porque necesita los mocks del banco |
| `dev/bancolombia-contract.ts` | ¿el mock cumple los esquemas zod del front? (`npm run contrato:bancolombia`) |
| `dev/sandbox-bancolombia.ts` | **¿el BANCO DE VERDAD acepta lo que mandamos?** el único que pega contra el gateway real (`make harness-sandbox`) |
| `dev/experian-check.ts` · `experian-api.ts` | ¿esta solicitud omitió el buró, y se puede *afirmar*? |
| **⚠ el `cURL error 7` a `127.0.0.1:9` NO es un fallo** | Aparece en el forense de casi cualquier corrida local y es **deliberado**: `H2O_API_HOST` y `CREDIFAMILIA_HOST_OAUTH` apuntan al puerto *discard* a propósito. Sin esa variable, `main` devuelve **500 en TODO `/lenders`** (`baseUrl(null)`); apuntada a un host muerto, la llamada falla en 0 ms y el orden del listado cae a las matrices de la BD. Perseguirlo cuesta un rato y no hay nada que arreglar |
| `make harness-ssr` | **¿a qué servicio llamó el SSR, y cómo le fue?** La consola del wizard: sus líneas `[outbound]` dicen URL, código y duración de CADA llamada saliente del servidor. ⚠ Es la ÚNICA vista de eso — la consola del navegador no ve las llamadas del servidor y el log de la corrida tampoco. `SOLO=1` filtra a lo saliente y los errores (sin eso, el ruido de Vite lo tapa) · `SEGUIR=1` se queda mirando. ⚠ Lo escribe `bin/advisor` al levantar el wizard (`> /tmp/asesor-wizard.log`, truncado en cada arranque): si lo levantaste a mano con `pnpm dev`, su salida se fue a ESA terminal |
| `dev/loki-trace.ts` | ¿POR QUÉ terminó así? forense en los logs (`make harness-loki UREQ=…`). ⚠ **No es la única forense de la casa**: ésta ancla en los LOGS —su fuerte es la regla con la que se evaluó cada entidad y el `timeline.ndjson` con payloads—, y `make trazador-ureq UREQ=… TARGET=…` ancla en la **BD**, así que contesta hasta dónde llegó aunque no haya un solo log, y suma qué VIO el cliente y qué archivos dejaron rastro. Es además la única que llega a **prod**, que ésta no mira. Las dos imprimen el comando de la otra al terminar. ⚠ Y sus defaults son OPUESTOS (`local` acá, `prod` allá): el target va escrito siempre |
| `dev/bcp-return.ts` | **el flujo VEHICULAR de BCP por HTTP, y qué se PIERDE al volver atrás** (`make harness-bcp-volver`). Camina las tres pantallas que ningún otro runner sabía caminar —formulario del vehículo, simulador embebido y gate manual— y después de cada tramo pide la pantalla ANTERIOR, que es lo que hace el navegador al apretar atrás. De ahí salieron F-185 y F-186. En LOCAL pide `make harness-peru` + `make harness-forms-g2`; contra `qa` el comercio **ya existe** (ver abajo) y hay que pasarle los teléfonos del bypass con `TEL=` |
| `make harness-suite-paises` | **¿el cliente nace con el país de su comercio, su documento y su celular?** La internacionalización como aserción declarada (`suites/paises.json`, clave `espera.pais`): la REGLA contra la base + valores fijados por país. Verde/rojo con exit code. ⚠ `requiere: lambda` a propósito: sin usuarios FRESCOS la aserción mide la escritura de una corrida vieja (así apareció un dominicano con `CC` del día anterior) |
| `bin/pg logs` (en la raíz) | los **CUERPOS crudos** de Loki para un selector y una ventana — cuando no hay uReq que anclar (el flujo murió antes de crear la solicitud): `bin/pg logs --target dev --query '{service_name="CreditopDev"} \|~ "1828230"' --start 2026-09-02T14:12:00Z --end 2026-09-02T14:17:00Z`. Reemplaza a `dev/loki-lineas.ts` desde el 2026-09-24. ⚠ La sonda de `trazador-acceso` imprime **labels**, no cuerpos; y el PHP de dev **y de qa** loguea como `service_name="CreditopDev"` (F-179) |
| `dev/ecommerce.ts` | **¿el CANAL ecommerce entrega lo que promete?** el carrito de una tienda de punta a punta, declarado en JSON y sin navegador (`make harness-ecommerce [SUITE=…]`). Contesta lo que `case.ts` no sabe contestar —`grep -c ecommerce dev/case.ts` da **0**, ese runner empieza DESPUÉS y no conoce canales—: si el contrato base64 se decodifica, si los seis campos del billing llegan como `prefill`, si el contexto se relee por `erId` **sin cookie**, y si la solicitud queda **atada al pedido** en la fila y en el puente. ⚠ Ese último chequeo no es decorativo: con el nombre viejo `ecommerce_request_id` (snake, el del v1) el backend **ignora el campo**, la solicitud nace sin vincular y **el comercio nunca recibe el veredicto de su compra**, sin ningún error. Probado rompiéndolo a propósito: da `fila=0 puente=0`. ⚠ La suite de la **sala de espera** va aparte (`suites/ecommerce-sala-de-espera.json`) porque depende de un PR sin mergear — separada y no «salteada», que un caso que se saltea se lee como verde. ⚠⚠ **SOLAPA con `channel/ecommerce-*.spec.ts`, y eso hay que decidirlo**: `ecommerce-no-cookie.spec.ts` ya fija el `erId`-en-URL y el vínculo, y `ecommerce-local-real.spec.ts` camina el flujo entero. La diferencia es el transporte —aquéllos van por **navegador** (Playwright, wizard corriendo, un `generate_checkout_url.php` que vive FUERA del repo y el perfil `.env.mock` de legacy) y éste va por **API en segundos, declarado en JSON**—, pero la cobertura se pisa. **No verifiqué si esos specs siguen pasando hoy**: nombran la rama de abril (`feature/onboarding/ecommerce-web-origination`) y el canal migró a OnboardingV2 desde entonces. Antes de agregar más casos acá, mirar si el lugar correcto es aquéllos |
| `dev/screens.ts` | **¿por qué PANTALLAS habría pasado el cliente?** el recorrido del wizard derivado del router en `main`, y al revés: `ENDPOINT=confirm-payment-schedule` → qué pantalla es (`make harness-pantallas`) |
| `dev/posthog-ureq.ts` · `pkg/posthog.ts` | **¿qué VIO el cliente, en el vocabulario del embudo?** la TERCERA fuente (BD = desenlace · Loki = causa · PostHog = recorrido): los eventos de una solicitud y el **cruce** pantalla caminada ↔ evento emitido, con los esperados DERIVADOS del código del front en la rama del target (`make harness-posthog UREQ=… DESDE=…`). El caminador lo dispara **sólo si el caso terminó mal** (`FORENSE=1` lo fuerza), la misma regla que `forensicOnClose` de Loki: medido 2026-09-02, consultarlo en TODA corrida llevó una de 108 s a 128 y otra a 237, y en el caso feliz no aportaba nada que la traza de BD no dijera. ⚠ Al cerrar, la lectura suele venir **PARCIAL** y ahí un evento que falta es atraso de ingesta, no una falta: se etiqueta como tal, porque marcarlo con ✗ manda a buscar un bug donde sólo hay que esperar (pasó con `confirmation`, que llegó dos minutos después). ⚠ Sólo el FRONT emite —`case.ts` es invisible en PostHog— y **local no escribe** (`APP_ENV=local` apaga `getServerPostHog`). ⚠ Un solo proyecto para todos los ambientes y **prod y dev comparten ids**: `loan_request_502057` es julio en prod y hoy en qa, la MISMA persona para PostHog; por eso se filtra por ambiente Y hora de la corrida. ⚠ La hora va en epoch: `toDateTime('…')` la lee en Bogotá (-05:00). ⚠ La ingesta tarda minutos: el caminador espera acotado y dice PARCIAL; el cruce completo se mira después con este comando |
| `dev/posthog-errors.ts` | **¿qué PANTALLAS del front se están rompiendo, y con qué?** el canal de LOGS agregado en dos cortes: por pantalla (DÓNDE: archivo + `loader`/`action` + error) y por patrón (QUÉ: los mensajes agrupados por PostHog, así 50 mensajes con distinto id cuentan como UN problema) — `make harness-posthog-errores [DIAS=7]`. ⚠ Sólo `staging` (los deploys de qa y de staging) y `production`: ni dev ni local tienen front desplegado. ⚠ El conteo es FRECUENCIA, no gravedad: un `ZodError` en el loader de una pantalla muy visitada suma más que una firma caída que le pasó a tres personas. Medido 2026-09-02, 3 días de prod: **2.123 `ZodError` del esquema del TEMA del comercio** (`data.colors.primary_color` en null) repartidos en 10 pantallas — es el mecanismo del punto 2 de **F-55** (el `catch` del loader que envuelve el tema del comercio redirige a `request-canceled`); y el loader de `request-canceled` con 82 errores, todos `DELETE /api/identity/request/<n>` → **403**, o sea la pantalla que cancela fallando al cancelar |
| `dev/warm-session.spec.ts` | **la sesión de asesor caducó y no quiero quedar bloqueado.** Pre-login headless que deja `.auth/cognito-state.<target>.json` listo, sin correr ningún flujo: `E2E_TARGET=<t> npx playwright test dev/warm-session.spec.ts --headed --project=chromium`. ⚠ **Contra `qa` y `staging` va HEADED**: el Managed Login de `auth.merchant` corta la automatización por fingerprint y en headless queda colgado en `/verifyPassword` (F-66). ⚠ Y el caminador **no lo dispara solo** — sólo LEE el cache y corta con «entrá una vez por el panel»; este spec es el camino por consola de esa frase |
| `dev/advisor-target.spec.ts` | **¿a dónde manda el front al elegir una entidad, en el canal del ASESOR?** Abre el listado con la sesión cacheada, elige y reporta la URL — nada más. Existe porque el caminador no puede llegar ahí cuando su siembra deja la entidad fuera del listado: acá la solicitud viene sembrada desde afuera con `synthFill(ur, { lender })`. ⚠ Usa `chooseEntity` de `pkg/wizard-browser.ts` y **no un localizador propio**: el primer intento con `locator('div').filter(...)` clickeó otro botón, la selección nunca llegó a la base (`lender_id` NULL) y la corrida igual dio «passed» |
| `dev/walk-wizard.ts` | **¿el FRONT encadena bien las pantallas?** el wizard entero por sus endpoints `.data` —loaders, actions, middleware, zod— sin navegador y en PARALELO, cada pantalla contrastada con la BD (`make harness-caminar CASOS='#hash:lender' CERRAR=1 MANUAL=1`). Es el tercer camino: `case.ts` no ve el front, el panel necesita a alguien clickeando. ⚠ Sigue SÓLO las redirecciones que la app emite —acá hay loaders que ESCRIBEN (`request-canceled` cancela al cargarse, F-50)— y la única URL que arma solo es el handoff a `/confirmation` que el backend le manda al cliente. Lo que no corre: el JavaScript del cliente. Medido 2026-09-02: 11 pantallas y estado 11 en local (73 s) y contra el front desplegado de qa (108 s). El paralelo rinde en los dos: contra qa, 3 en paralelo son 203 s contra ~325 s en fila (el techo ahí es ¼ de vCPU y el ALB cortando a los 60 s, F-180); en local, **3 en 74 s y 6 en 112 s** con `PHP_CLI_SERVER_WORKERS` puesto — sin esa variable eran 237 s para 3, porque `artisan serve` atiende de a una (F-181, y ahí está la receta). El front no fue el cuello en ningún caso; 3 en paralelo en local, los tres llegan a 11 en la BD, pero el tercero pasó de 120 s en la firma y la primera versión lo reportó como «no cerró» —el techo es el PHP local, no el caminador, y por eso ante un timeout ahora vuelve a mirar la BD antes de concluir (F-180: PHP sigue y termina). El protocolo (redirect = 202 con destino en el cuerpo; turbo-stream v3 vendoreado; promesas en líneas `P<id>:`) está deducido y documentado en `pkg/front.ts` |

### La siembra del caminador la pisa el formulario — y por eso «la entidad no salió en el listado» mentía

> **MEDICIÓN · 2026-09-16** — `sembrar()` corre ANTES de enviar `personal-info`, y el `action` de esa
> pantalla escribe los campos del cliente **encima**. La solicitud quedaba con ocupación
> «Desempleado» e ingreso **0**, y con eso una rt=2 se cae por regla DURA — tan afuera que el backend
> **ni siquiera evalúa el cupo** (cero líneas `QUOTA_CHECK` en Loki).
> **Cómo se veía:** `NO cerró: la entidad N no salió en el listado`, que se lee como un hecho del
> comercio cuando era del runner. Costó **ocho corridas** contra la base compartida antes de verse, y
> subir el `--score` no lo arregla: la exclusión era por ocupación e ingreso.

**Arreglado** con una resiembra DIRIGIDA: si la entidad pedida no está en el listado, se resiembra con
`synthFill(ur, { lender })` —que deriva el perfil que CUMPLE sus reglas (`deriveSynthReq`)— y se vuelve
a pedir la misma pantalla. **Una sola vez**: si tampoco aparece, la exclusión sí es del comercio y se
reporta como tal. Medido después del arreglo: 5 comercios con 5 entidades en plataforma distintas,
los 5 resembraron y los 5 llegaron a la selección.

⚠ **Y con `lender` NO se le pasan `income`/`score`**: pisarían justo lo que la derivación calculó.

### Los specs de `channel/` corrían contra DEV, no contra local (2026-09-14)

> **MEDICIÓN · 2026-09-14** — ⚠⚠ **Sin `E2E_TARGET`, TODOS los specs de `channel/` escribían en el
> ambiente COMPARTIDO.** `pkg/config.ts` arma `mockUrl` leyendo `.env.<target>` y `TARGET` por defecto
> es **dev**, así que `config.mockUrl` resolvía a `http://legacy-backend.inertia-develop` — aunque el
> docblock de `playwright.config.ts` dijera «el backend corre en localhost». Medido: una corrida de
> `ecommerce-notify` creó allá el `ecommerce_request` **7331** mientras la base local iba por **6907**.
> **Cómo se vuelve a comprobar:** `node -e "const {config}=await import('./pkg/config.ts'); console.log(config.mockUrl)"`
> sin `E2E_TARGET` puesto.

⚠ **Y ahí no había red que lo frenara:** el guard `I_KNOW_THIS_TOUCHES_SHARED_DEV` (F-53) protege las
escrituras que pasan por `pkg/db.ts`, **no las que van por la API** — que son justo las de estos specs.

**Arreglado** fijando `process.env.E2E_TARGET ||= 'local'` en `playwright.config.ts`, que carga antes
que cualquier spec. Con `||=` para poder apuntar a otro ambiente a propósito
(`E2E_TARGET=qa npx playwright test …`).

**Y los specs del canal quedaron sanos.** Estaban rotos por tres cosas distintas, ninguna de negocio:

| spec | qué tenía | estado |
|---|---|---|
| `ecommerce-ui` | nada | ✅ pasa |
| `ecommerce-notify` | usaba `resolve`/`dirname`/`fileURLToPath` **sin importarlos** → `ReferenceError` al cargar, y Playwright reportaba «No tests found», que se lee como «no hay pruebas» en vez de «están rotas» | ✅ pasa |
| `ecommerce-no-cookie` | ruta ABSOLUTA a un `generate_checkout_url.php` que se movió al repo el 2026-07-19 | ✅ carga y corre; el paso del navegador pide la ruta nueva del front |
| `ecommerce-local-real` | ídem + hash quemado (`17f7b360`) | ✅ ídem |
| `ecommerce-prefill-demo` | — | ⚪ es una DEMO visual, lo dice su encabezado |

**Los tres dejaron de depender del script PHP externo**: ahora arman el contrato con
`contractForSpec()` de `pkg/ecommerce.ts`, que vive en el repo, resuelve el comercio contra la BASE
—nada de hashes quemados— y usa un **`order_key` único por corrida**. Eso último no es cosmético: con
la clave fija del script, el `upsert` caía siempre en la MISMA fila y, una vez `processed = 1`, la
notificación al comercio **ya no se disparaba**. Es la misma lección que `ecommerceContract` había
aprendido y que estos specs no tenían.

⚠ **Lo que NO se pudo evaluar:** los dos specs de navegador necesitan `/ecommerce/{hash}/checkout`, que
**sólo existe en `develop` y en la rama del PR** — en cualquier otra el wizard de `:5174` devuelve 404.
Su lógica sigue sin ejercitarse hasta levantar el front correcto.

### El caminador del wizard tiene DOS motores, y la diferencia entre ellos ES el diagnóstico

`make harness-caminar` recorre el wizard de punta a punta. Lo que cambia con `MOTOR` es **cómo opera una
pantalla**; todo lo demás —el caso, la siembra, el paralelismo, la traza contra la BD, el forense— es el
mismo código:

| | `MOTOR=http` (default) | `MOTOR=navegador` |
|---|---|---|
| cómo avanza | postea al `.data` de la pantalla | Chromium **sin ventana**, clickea |
| qué corre | loaders, actions, middleware, zod | eso **y el JavaScript del cliente** |
| un caso, local | **20 s** | **357 s** (12 pantallas, estado 11) |
| 3 en paralelo | 22 s | **357 s**, 3 de 3 en estado 11 |
| evidencia | la traza contra la BD | + consola, red, captura y **traza de Playwright** |

El paralelo con navegador **sale gratis**: tres casos cuestan lo mismo que uno, porque el tiempo se va
esperando al backend y a los renders, no compitiendo. Un contexto por caso, un solo Chromium.

**Los cinco muros que hubo que enseñarle a pasar** (2026-09-03) — ninguno estaba en `wizard-steps.ts`, y
cada uno se veía como «pantalla trabada» hasta que la evidencia dijo otra cosa:

| pantalla | qué la trababa | cómo se resolvió |
|---|---|---|
| entrada | el botón dice «Iniciar solicitUD» y el patrón buscaba «solicitar» | `solicit` en `AVANZAR` |
| entrada | el radio de confirmación de cupo es de Radix: su etiqueta es un `<label>` HERMANO, así que `textContent` viene vacío y el fallback elegía **«Sí»** — que firma otro flujo, salta el buró y recorta el listado | elegir por NOMBRE ACCESIBLE, con `preferirRadio: /^no$/i` |
| listado | «No pudimos consultar esta entidad» es **por tarjeta**, no de la pantalla | no es muro en `lenders`: decide `chooseEntity` |
| plan de pagos | el envío genera los documentos (~30 s con Blade) y la espera de 12 s lo abandonaba **con el spinner puesto** | espera generosa por click; los guardas son el tope global y el contador sin progreso |
| firma | el botón no se habilita hasta que **se leyó el documento hasta el final** (`hasScrolledDocumentsToBottom`) | `readToEnd()`: desplaza los contenedores del diálogo y dispara el `scroll` que React escucha |
| OTP de firma | son **6 dígitos**, no los 4 del onboarding. Con 4 el campo se llena, no da error, y el botón nunca se habilita | el valor depende de la pantalla |

**Lo que el motor de navegador encontró en su PRIMERA corrida real** (2026-09-03, local, Pullman/77), y
que el motor HTTP cierra **en verde en 20 s**:

1. **`/self-service/<hash>/<ureq>/continue` NO EXISTE** → registrado como **F-184**, con el alcance
   medido (91 comercios en prod con el terreno servido) y la advertencia de por qué los logs no pueden
   confirmarlo. El motor HTTP no lo ve: recibe el 202 con el destino y salta al handoff sin cargarlo.
2. **El visor de PDF no abre NINGÚN documento y la pantalla de firma muestra «Error al cargar los
   documentos».** La consola da la causa: `The API version "5.4.296" does not match the Worker version
   "5.4.449"`. Los PDF están bien —se descargan con HTTP 200, `application/pdf`, 14 KB, y MinIO manda
   CORS correcto—: el que se rompe es el visor.

   ⚠ **Y NO es un bug del repo: es DERIVA del `node_modules` local.** `packages/ui` declara
   `pdfjs-dist: 5.4.296` (exacto), `react-pdf@10.2.0` depende de esa misma versión, y el `pnpm-lock.yaml`
   fija **una sola**: `5.4.449` **no aparece ni una vez en el lock**. Lo que estaba mal era el árbol
   instalado — `packages/ui/node_modules/pdfjs-dist` enlazaba a 5.4.449, una versión que quedó en el
   store de una instalación vieja. **El arreglo es `pnpm install --frozen-lockfile` en la raíz del
   monorepo**, y por eso producción no está afectada: un despliegue instala desde el lock.

   La lección para leer un fallo así: **antes de acusar al código, comparar lo instalado con el lock**
   (`ls -l packages/<x>/node_modules/<dep>` contra `grep <dep>@<ver> pnpm-lock.yaml`). Dos versiones en
   `node_modules/.pnpm` y una sola en el lock = deriva local, no bug.

   ⚠ Lo que sí es del producto: **el fallo del visor no se reporta a ninguna parte.** `onLoadError` sólo
   pinta el texto rojo (`SignDocuments.tsx`), no llama a PostHog. Si esto le pasara a un cliente en
   producción por cualquier otra causa, nadie se enteraría.

**Las CUATRO puertas, y por qué elegir mal invalida la prueba.** El panel entra por `asesor` (login
Cognito → `/merchant/*`), `autogestion` (el cliente solo → `/self-service/*`), `ecommerce` (URL base64
de la tienda) y `qr` (caja de un comercio Corbeta). ⚠ **Asesor y autogestión montan el MISMO módulo del
front para `solicitar`, así que la pantalla se ve idéntica** — pero `/merchant/*` está detrás de login
(medido: 302 a `/login`) y `/self-service/*` es público (200), y con sesión de asesor el backend
resuelve **punto de venta**: el flujo termina entregando el proceso en vez de seguir de largo. Probar
un comercio autogestionado por el canal del asesor prueba otra cosa, y la pantalla no lo delata; costó
dos vueltas de diagnóstico el 2026-09-09 (F-191). Y en autogestión **hay un solo dispositivo**: la
ventana B no se usa, el journey del cliente se camina en A.

**El canal de ASESOR con navegador: anda, y lo que lo frena no es el motor.** `MOTOR=navegador FLOW=merchant`
reusa el `storageState` que dejó el panel (`pkg/cognito.ts`) — un solo login para los N contextos de la
tanda, que es lo que evita golpear el pool. Dos cosas que aprendió el 2026-09-03 y que valen para
cualquier corrida de asesor:

- **El asesor manda sobre la sucursal, así que el caminador CORTA en vez de avisar.** La sesión está
  pegada a un comercio, y `/merchant` redirige al de la sesión: una corrida que pide Pullman termina en
  CeluRD y prueba otro comercio con el nombre del pedido (le pasó a una corrida del panel el 2026-09-02
  y el reporte no lo dijo). Ahora corta e imprime el `dbops assign` que lo movería. **No reasigna solo**:
  eso deja al asesor movido después de la corrida, y es una escritura que el panel hace explícita.
- **Ese comercio entra por el funnel DINÁMICO** (`/merchant/<hash>/request-amount`), no por `solicitar`,
  y ahí el caminador se para en un selector de producto cuyo mensaje de validación dice **«Selecciona un
  celular para continuar.»** — el campo es `productId` y la función que arma el texto se llama
  `getDynamicLoginProductError`. Para un comercio de celulares el texto pega; para uno de muebles diría
  lo mismo. ⚠ Y los dos comercios probados tienen `show_products = 0`, así que **por qué se exige el
  selector no está explicado**: mirar antes de llamarlo bug.

⚠ **TOPE DE TIEMPO POR CASO (`--tope`, 360 s por defecto), y no es un lujo.** La primera corrida del canal
de asesor giró **18 minutos sin imprimir una línea**: cada vuelta puede esperar `networkidle` + el cambio
de URL + los reintentos del click, y 40 vueltas sin progreso son media hora de silencio — por caso, en
paralelo. Ahora falla en ~2 min diciendo dónde y qué decía la pantalla. Un runner que no puede terminar
es peor que uno que falla.

⚠ **`pkg/wizard-steps.ts` está STALE y parece vivo.** Sus helpers buscan nueve `data-testid` y el front
tiene **dos**: verificado el 2026-09-03 contra la rama de qa, `otp-input`, `docnum-input`, `name-input`,
`surname-input`, `email-input`, `monthly-income-input`, `employment-submit` y los `date-selector-*` no
existen en ninguna parte del monorepo. Por eso el motor de navegador **no los usa**: opera por rol y
etiqueta, con `pkg/autofill-qr.ts` (el motor genérico que antes vivía dentro del caminador del canal QR
y ahora comparten los dos, con un mapa de campos por canal).

⚠ **Y hay DOS autorrellenos, no uno** — `pkg/autofill.ts` (una `r`, la chapita ⌨/⌥R del camino
visual, que se INYECTA en la página) y `pkg/autofill-qr.ts` (dos `r`, el de Playwright que usan los
caminadores). No se pueden fundir: uno vive en el DOM y el otro habla por el protocolo de Playwright.
Lo que **sí** está compartido, desde el 2026-09-10, es la regla del **trío de fecha**
(`pkg/date-trio.ts`), y hay motivo medido: un día/mes/año no se rellena eligiendo la primera opción
de cada combo —eso da `1 / Enero / <año actual>`, o sea hoy, que como fecha de expedición ninguna
validación acepta—, la regla la sabía UNO de los dos, y el otro escribía la fecha inválida en la base
sin que nada avisara. El inyectado la recibe por un `addInitScript` aparte (`injectableSource()`)
porque su guion se serializa y no puede importar; `pkg/date-trio.spec.ts` fija esa serialización
evaluándola en un Chromium.

### S3 en local: MinIO, o los documentos no existen

Sin esto, **cada subida de documento falla en silencio** y la URL que queda en la base da 404 (F-174).
No es sólo velocidad: es que **no se puede abrir el PDF que produjo una corrida**.

    docker run -d --name creditop-minio --network creditop-network -p 9000:9000 -p 9001:9001 \
      -e MINIO_ROOT_USER=creditop -e MINIO_ROOT_PASSWORD=creditop123 \
      -v creditop-minio-data:/data quay.io/minio/minio server /data --console-address ":9001"

Y en el `.env` de `legacy-backend` — **las tres, no dos**:

    AWS_ENDPOINT=http://host.docker.internal:9000     # a dónde ESCRIBE el contenedor
    AWS_USE_PATH_STYLE_ENDPOINT=true
    AWS_URL=http://localhost:9000/local-mock          # lo que se GUARDA en la base

⚠ `AWS_URL` es la que se olvida: `url()` arma la dirección con el nombre del bucket, **no** con el
endpoint, así que sin ella el archivo se guarda pero el link sigue dando 404. Los hosts son distintos a
propósito — el contenedor no resuelve `localhost` y el navegador no resuelve `host.docker.internal`.

Consola web en `:9001` (usuario y clave `creditop` / `creditop123`) para mirar los documentos.

⚠ **ACÁ DECÍA «para LocalStack en vez de MinIO: cambia sólo `AWS_ENDPOINT`». ES FALSO** — hay que
cambiar **`AWS_URL` también**, porque el puerto está en las dos y son puertos distintos (MinIO 9000,
LocalStack/ministack 4566). Con sólo el endpoint cambiado, la subida FUNCIONA y la URL que queda en
la base apunta a un puerto donde no hay nadie: exactamente el 404 silencioso de F-174, pero ahora
autoinfligido y más difícil de ver, porque el archivo sí existe.

**Para ministack (LocalStack), que es lo que usa Miguel:**

    AWS_ENDPOINT=http://host.docker.internal:4566     # a dónde ESCRIBE el contenedor
    AWS_USE_PATH_STYLE_ENDPOINT=true
    AWS_URL=http://localhost:4566/local-mock          # lo que se GUARDA y lo que pide el NAVEGADOR

⚠ **Y el bucket no se crea solo.** Medido el 2026-09-10: ministack estaba arriba y **sin ningún
bucket**, así que toda subida fallaba. Se crea una vez:

    AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_DEFAULT_REGION=us-east-1 \
      aws --endpoint-url http://localhost:4566 s3 mb s3://local-mock

Comprobado de punta a punta el 2026-09-10: un caso cerrado en estado 11 dejó sus cuatro documentos
como PDF de verdad, todos con HTTP 200 desde el host (14 KB · 145 KB · 158 KB · 10 KB).

⚠ **`legacy-application` necesita lo MISMO pero con otro host**: corre con `artisan serve` en la
máquina, no en Docker, así que su `AWS_ENDPOINT` va a `http://localhost:4566` (no
`host.docker.internal`). Sus `AWS_*` estaban VACÍOS, o sea que las subidas del admin —el logo del
comercio, el banner, las imágenes de la pantalla de bienvenida— no podían funcionar.

### Local monohilo: una línea y las corridas en paralelo dejan de hacer fila

Sail sirve el backend con `artisan serve`, que es el servidor embebido de PHP: **una petición a la vez**.
Por eso una tanda en paralelo contra local tardaba lo mismo que en fila y parecía un lock del código
(F-181). El servidor embebido acepta varios workers desde PHP 7.4 y el `ServeCommand` de Laravel 10 **ya
pasa la variable**, así que no hay que cambiar a fpm+nginx ni tocar la imagen. En el `.env` de
`legacy-backend`:

    PHP_CLI_SERVER_WORKERS=6

**Medido el 2026-09-03** con `harness-caminar`, casos idénticos que cierran en estado 11:

| | 1 worker | 6 workers |
|---|---|---|
| 1 caso | 73 s | 73 s |
| 3 en paralelo | 237 s | **74 s** |
| 6 en paralelo | — | **112 s** |

Tres casos pasan a costar lo mismo que uno. A 6 el techo asoma (dos de los seis tardaron 110 s en vez de
76): cada caso ocupa un worker mientras genera su PDF, así que conviene **workers ≥ casos en paralelo**.

⚠ **Para que tome efecto se reinicia el CONTENEDOR, no el proceso.** `supervisorctl` no tiene socket en
esa imagen y matar el PID de `artisan serve` deja el contenedor **arriba y sin nadie escuchando**. Es
`docker restart legacy-backend-laravel.test-1` y en ~20 s vuelve. Para comprobar que quedó:

    docker exec legacy-backend-laravel.test-1 ps ax -o pid,ppid,args | grep '\-S 0.0.0.0'

Tienen que salir un maestro y N hijos; con un solo proceso, la variable no llegó.

⚠ **Y esto NO convierte a local en un ambiente para medir capacidad.** `php -S` con workers no es
fpm+nginx: sirve para que la tanda no haga fila y para ver si dos casos se pisan de verdad, no para
sacar números de carga. Eso sigue necesitando otro ambiente (y qa tampoco lo es, F-180).

### Corridas 4× más rápidas — y qué se deja de probar a cambio

**El 86 % del tiempo de una corrida se va en fabricar PDF**, y es un costo **fijo de ~16 s por
documento**: un PDF de 14 KB tarda lo mismo que uno de 142 KB. No son los mocks (contestan en 1 ms) ni
dompdf en sí (28 ms con HTML simple).

El enrutado del generador **ya es configurable por `.env`**, sin tocar código
(`config/documents.php`: `DOC_GEN_{TIPO}` y `DOC_GEN_{TIPO}_LENDER_{ID}`). En el `.env` de
`legacy-backend`:

    DOC_GEN_PAGARE=microservice
    DOC_GEN_CONSENT=microservice
    DOC_GEN_FGA=microservice

Con eso los documentos salen del mock del pdf-mapper (:8100) en vez de renderizarse con dompdf.
**Medido: la suite de Motai baja de 95 s a 32 s; un caso suelto, de 93 s a 27 s.**

**Vuelto a medir el 2026-09-03 con `harness-caminar`, y combinado con los workers de PHP** (§«Local
monohilo»): las dos perillas juntas son la diferencia entre una tanda de minutos y una de segundos.

| | Blade · 1 worker | Blade · 6 workers | mock · 6 workers |
|---|---|---|---|
| 1 caso | 73 s | 73 s | **20 s** |
| 3 en paralelo | 237 s | 74 s | **22 s** |
| 6 en paralelo | — | 112 s | **27 s** |

El paso de la firma solo baja de **28 s a 2,7 s**: ahí estaba el costo. Seis casos completos, de punta a
punta y en estado 11, en menos de lo que tardaba uno.

⚠ **Pide el slug también en local, y el dump trae SÓLO el de Credifamilia.** Sin
`lenders.pdf_mapper_project_slug` el flujo corta con `Lender N is not configured for pdf-mapper-service`.
El mock acepta cualquier valor. *(Acá decía que para medir «se le puso `harness-local` al 77»; hoy —
2026-09-18— hay **once** entidades con slug en esta base: la 24 con el real `credifamilia`, la 77 con
`harness-local` y las otras nueve —6, 8, 152, 158, 168, 169, 170, 173, 211— con `demo-local`. Que
convivan dos nombres inventados no rompe nada, porque al mock le da igual, pero es config de PRUEBA y no
se replica a ningún otro ambiente.)*

**Y hay una sonda que contesta de una si esto quedó bien cableado**, sin correr un flujo:

    docker exec legacy-backend-laravel.test-1 php artisan pdf:health-check

Recorre **cada tupla (documento, entidad) que hoy enruta a `microservice`** y dice cuál no tiene el
mapper subido. Es el chequeo del producto, no del harness: usa las mismas rutas que usaría en producción.

⚠ **Y por eso el mock tiene que contestar `/health` y el `/status` con SU forma exacta.** Las dos se
agregaron el 2026-09-18 porque faltaban, y las dos fallaban de un modo que manda a mirar donde no es:
sin `/health` el comando aborta con «pdf-mapper-service /health returned HTTP 404» antes de revisar un
solo documento, y con el `/status` que el mock traía —`{project, document, available: true}`, inventado—
contestaba 200 y el comando lo leía como **mapper no bootstrappeado**, porque no mira `available` sino
dos claves llamadas `<doc>.json` y `<doc>.pdf` (`PdfHealthCheck.php:202-207`). Un mock que responde 200
con la forma equivocada es peor que uno que no responde: el 404 se ve.

⚠ **La perilla vive en el `.env` de OTRO repo, así que los runners la IMPRIMEN.** `docGenNotice()` en
`pkg/config.ts` lee ese `.env` y el caminador saca una línea de advertencia en su cabecera cuando los PDF
salen del mock. Una perilla que cambia *qué prueba* la corrida no puede estar invisible.

⚠ **Pide un dato:** la entidad necesita `lenders.pdf_mapper_project_slug`; sin él el flujo corta con
`Lender N is not configured for pdf-mapper-service`. En local se le pone cualquier valor —el mock acepta
todos—; en producción **sólo Credifamilia lo tiene**, y por eso es la única que hoy va por microservicio
(y por eso es 10× más rápida que Motai en local: su PDF lo hace un mock de 1 ms).

⚠⚠ **QUÉ SE PIERDE, Y NO ES POCO.** Con los documentos saliendo del mock, la corrida **deja de ejercitar
las plantillas Blade**. O sea que deja de atrapar exactamente la clase de bug de **F-150**: un builder
que produce claves que la plantilla no espera revienta con «Undefined variable» **en pleno render**, que
no es un documento con huecos sino **una firma caída** — y ya ocurrió en producción. Prenderlo mientras
se itera sobre reglas de negocio es razonable; **dejarlo prendido para validar documentos convierte el
verde en mentira**.

Y hay un ejemplo FRESCO de lo que se pierde, del 2026-09-02 en qa: el Rent to Own murió con
`Undefined variable $nombre_cliente` en `contrato_rto_con_codeudor.blade.php`, porque el mapa de
builders está clavado al id de producción (193) y en dev/qa la entidad es la 205. Con el mock prendido,
esa corrida habría cerrado **en verde** sobre ese mismo bug.

### El desenlace de un rt=1: el webhook, y el monolito viejo corriendo en local

Un rt=1 (Welli, Meddipay, Bancolombia, Prami) **no cierra en plataforma**: la entidad decide afuera y
avisa después. `legacy-backend` **no tiene ninguna ruta que reciba ese aviso** (F-170) — el receptor vive
en `legacy-application`. Y eso **se puede correr en local**, contra la MISMA base:

    cd ~/Desktop/CREDITOP/github/legacy-application && php artisan serve --port=8000

Con eso, un caso pide su desenlace y **el receptor es real**; lo único simulado es la entidad que llama:

    make harness-caso CASOS='#ddc769bd:23@webhook=fulfilled' LAMBDA=1 CERRAR=1

⚠ **Es OPT-IN a propósito.** Nunca pasa solo: el código que corre no es el de `legacy-backend`, y un
desenlace automático se leería como si lo fuera.

⚠ **Tres trampas que ya costaron y no se ven venir:**
- **Rutea por SUBDOMINIO** — el webhook vive en `api.localhost`, las de cliente en `aliados.localhost`.
  Pegarle al host pelado no da 404 sino **405 «Supported methods: GET, HEAD»** (cae en la ruta fallback),
  que manda a revisar el verbo cuando el problema es el Host.
- **`fetch` de Node DESCARTA el header `Host`** —es forbidden en el estándar— sin avisar, así que hay que
  poner el subdominio en la URL. `api.localhost` resuelve solo, sin tocar `/etc/hosts`.
- **Sin `WELLI_WEBHOOK_TOKEN` en el `.env` de application** el guard rechaza con 401 aunque el llamante
  traiga token.

⚠ **Y el desenlace que observes es el de HOY, no el de mañana**: los `STATUS_MAP` de los dos repos
difieren. Medido: `pendiente_desembolso` da **28** (application) y está escrito como **11** en
legacy-backend. El runner lo demuestra corriendo, no leyendo.

#### rt=0 también tiene desenlace, y es la familia más grande

«Redirige a la web de la entidad» describe la ida. La vuelta es un webhook **genérico** —uno solo para
Addi, PayJoy, Brilla, Sistecrédito—, no uno por entidad como en rt=1:

    export SELFMANAGER_TOKEN=<token de Sanctum con habilidad selfManager>
    make harness-caso CASOS='#0b3fef6a:6@webhook=completed' LAMBDA=1 CERRAR=1

El token se emite **una vez** en `legacy-application` —Sanctum guarda el hash, no el texto, así que el
que ya está en la base no sirve—:

    php artisan tinker --execute="echo \App\Models\User::find(<id>)->createToken('harness-local', ['selfManager'])->plainTextToken;"

⚠ **El `lender_id` del payload es el SLUG y no es estable entre ambientes** (el lender 6 es `addi` en
producción y `credifamilia-addi` en el dump local), por eso el runner lo lee de la base.

⚠ **Son DOS pasos**: el webhook no crea nada, busca lo que el flujo real ya dejó. El runner prepara la
transacción invocando `selfManager()` de la entidad por `artisan tinker` —su código real, no un INSERT
nuestro— y recién después dispara el webhook. Ver F-171 para las tres guardas rotas que hay ahí.

**Mapeo comprobado:** `completed`→11 · `failed`→6 · `cancelled`→7.

### El eje que las corridas por API no cubren: qué VEÍA el cliente

`case.ts` va por API y no abre el navegador — por eso es rápido y paralelizable. Lo que pierde es la
pantalla: una corrida dice «HTTP 500 en `confirm-payment-schedule`» y nadie sabe dónde habría estado
parado el cliente, que es lo que preguntan producto, soporte y QA.

`make harness-pantallas ENDPOINT=<endpoint>` contesta eso **sin integrar nada**: no maneja el navegador,
no corre nada, no valida. Deriva el recorrido de `apps/loan-request-wizard/app/routes.ts` en `main` —el
router mismo—, así que una pantalla nueva aparece sola y una borrada desaparece sola.

⚠ **Es un techo, no una traza.** Dice qué PUEDE llamar cada pantalla, no qué llamó en tu corrida: sale
de lo que la pantalla importa. La salida distingue los dos niveles —`→` lo llama esa pantalla, `·` está
en un paquete que importa— y no hay que leerlos igual.

### Lo que los runners NO escriben cada uno (2026-09-17)

Cinco cosas que estaban duplicadas entre `dev/*.ts` y hoy viven en `pkg/`. La regla no cambió —«al
agregar capacidad, va acá»— pero la deuda vieja seguía ahí, y **cada copia había aprendido una lección
distinta**, que es el modo de falla que importa: no es que hubiera dos, es que no hacían lo mismo.

| en `pkg/` | qué reemplazó | la lección que sólo tenía UNA de las copias |
|---|---|---|
| `http.ts` | **5** copias de `http()` | un timeout **no** es una caída, y `HTTP 0` los confunde (medido: 90.002 ms leídos como «el backend se murió»). Y ninguna dejaba bitácora |
| `phones.ts` | 2 derivaciones | el LARGO sale del país (`countries.cell_phone_lenght`) **y** el PREFIJO también: en RD el área ES el país, y con un dígito cualquiera el número se ubica en otro lado **sin fallar** |
| `merchants.ts` (`findBranch`) | **3** resoluciones | el canal de tienda necesita la sucursal **con credencial de ecommerce**; la de mostrador no tiene checkout |
| `otp-bypass.ts` | 2 copias | dos corridas a la vez se pisaban la lista, y la primera en terminar le borraba los teléfonos a las otras |
| `cognito.ts` (`sessionHealth`) | nada — era un hueco | el archivo puede estar y la sesión estar muerta: se mira el **vencimiento de las cookies**, no el `mtime` |

⚠ **Y una que NO se hizo, a propósito:** generalizar el patrón de «mutar un ajuste compartido sin
pisar a las corridas vecinas». El único otro candidato (`settings.front_end_url` en `mount-peru.ts`)
**sólo corre en local**, así que la carrera no existe ahí y además guarda un escalar, no una lista. Una
abstracción con un solo usuario es una abstracción inventada.

⚠ **Antes de agregar la sexta copia de algo, `grep` el nombre en `dev/`.** Las seis de arriba se
encuentran en un comando:

    for f in dev/*.ts; do grep -hoE '^(export )?(async )?function [a-zA-Z_][a-zA-Z0-9_]*' "$f" | sed -E 's/.*function //' | sed "s|\$| $f|"; done | sort | awk '{n[$1]=n[$1]" "$2; c[$1]++} END {for (k in c) if (c[k]>1) print k, c[k], n[k]}'

## Cuándo cargar una skill

Lo profundo por canal vive en skills, y se carga solo cuando hace falta:

| Skill | Cargala cuando |
|---|---|
| `harness-canal-qr` | trabajés el canal QR / Corbeta / Bancolombia (el más grande: mocks del banco, contrato zod, las 9–10 pantallas) |
| `harness-panel` | toques el panel: el mapa del recorrido, `CAPS`, el selector de comercio, el switch de front/Cognito, `dbops activity` |

> Propuestas para el panel salidas de las corridas de las cinco familias (semáforo de mocks,
> desenlace por familia, webhook de la entidad, entidades que van a reventar, plazos, documentos):
> `panel/IMPROVEMENTS-FROM-THE-RUNS.md` (2026-08-24). Respetan la regla: el panel corre, no valida.
| `harness-canal-ecommerce` | trabajés la entrada por tienda (URL base64) y su techo actual |

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

## Dos caminos, y cada uno tiene su dueño

- **Rápido — es TU camino (el del agente), por CLI.** `dev/sweep.ts`: el flujo por API, sin navegador.
  Segundos. Modos `matrix` · `close` · `abaco`. **Exit code = veredicto**: `0` cerró · `1` desenlace malo
  o el front mintió · `2` quedó a mitad. Usalo para analizar contra BD y backend mockeado.
- **Visual — es el camino de MIGUEL, por el panel** (`npm run dev`). `dev/guided.spec.ts`: el wizard
  real con bypasses. Sirve para lo que un mock no puede dar: interactividad, render, comportamiento del
  front.
- **Forense — `dev/experian-check.ts`.** Después de una corrida: ¿esta solicitud omitió Experian, y se
  puede *afirmar*? "No hay fila de buró nueva" tiene **tres** causas distintas (flujo firmado · la
  compuerta de frecuencia cortó antes · caché de 1 mes), y hay que descartar dos para creerle a la
  tercera. Mismo contrato que el rápido: **exit code = veredicto** (`0` probada · `1` sí se consultó ·
  `2` no concluyente). Detalle en F-60.

- **Forense de logs — `dev/loki-trace.ts` (`pkg/loki.ts`).** Después de una corrida: ¿por qué terminó
  así? ⚠ **Y si contesta «cero anclas», eso NO es «no se sabe hasta dónde llegó»**: las etapas salen de
  la BD y las arma `make trazador-ureq UREQ=… TARGET=…`, que no depende de que haya logs. Este runner lo
  imprime en los tres finales. La BD dice el desenlace, los logs dicen la causa — una regla que excluyó un lender **no mueve
  ningún estado**, así que es invisible para la traza contrastada. Colapsa la solicitud a un resumen
  (fallas deduplicadas con `×N`, una fila por entidad evaluada con su regla y veredicto, el recorrido del
  backend, y los silencios entre peticiones) y vuelca todo a `.runs/forense-<ureq>/`.
  **Se dispara solo** al cerrar los dos runners (`forensicOnClose`), y **solo si el veredicto salió mal o
  a mitad**: si cerró como se pedía no consulta nada (0 ms). En `guided.spec.ts` va **antes** de los
  `expect` a propósito — `expect` lanza, así que puesto después no correría nunca justo en los fallos que
  vino a explicar. Espera `E2E_LOKI_SETTLE_MS` antes de preguntar (el batch de `LokiHandler` flushea al
  morir el proceso) y se traga cualquier error: un forense que tumba la corrida que venía a explicar es
  peor que no tenerlo.
  ⚠ **NO es una fuente de aserción y no debe entrar en `veredicto()`**: la ausencia de una línea tiene
  cuatro causas indistinguibles (no se logueó · el level la filtró · el batch no hizo flush · lag de
  ingesta). Su exit code dice si se pudo *mirar*, no si el negocio pasó — nunca devuelve 1.
  ⚠ Solo ve **legacy-backend**: el `trace_id` no se propaga entre servicios (los Go no lo emiten), y solo
  encuentra traces que traigan el uReq en su `context` (~8% de las líneas ancla el resto). Lo declara al
  imprimir; leé ese bloque antes de concluir de una ausencia.
  **Tres modos, los elige solo y los anuncia:** *completo* (ancla + expande por trace) · *degradado* (hay
  ancla, no hay trace) · *ventana* (no hay ancla: todo lo de la ventana, **solo con Loki local**, atado a
  la URL y no a una perilla — contra uno compartido serían corridas ajenas).

**Observabilidad en local: `make harness-obs-up`** (Loki + Tempo **reales** en Docker — un mock
obligaría a reimplementar LogQL). La receta completa del `.env` del backend está en `README.md`
§Observabilidad. La trampa que no perdona: **`LOG_CHANNEL=loki`, no `stack`** — `stack` incluye
`dynamodb` con `ignore_exceptions => false` y sin credenciales de AWS la excepción **rompe el request**.

⚠ **Y CON `LOG_CHANNEL=loki` Y LOKI ABAJO, LOS ERRORES DE RUNTIME SE PIERDEN — en silencio.** Medido el
2026-09-10: un caso se trabó con `HTTP 500` en la generación de documentos, `storage/logs/laravel.log`
no tenía **nada** de esa solicitud (sólo la salida de unas pruebas de Pest, que sí escriben ahí) y
`make harness-loki UREQ=…` contestó «cero anclas». No había contenedor de Loki arriba. O sea que la
combinación normal de trabajo —el `.env` con `loki` y el stack de observabilidad sin levantar— deja el
peor de los dos mundos: ni archivo ni Loki.

**El camino que sí funciona sin observabilidad: PEDIRLE EL ENDPOINT DE NUEVO.** El cuerpo del 500 trae
la causa completa, y ahí no hay logging de por medio:

    curl -s -w '\nHTTP %{http_code}\n' http://localhost/api/loans/requests/promissory-note/<ureq>
    # → {"success":false,"message":"Blade PDF generation failed: Undefined variable $nombre_cliente
    #    (View: …/creditopxpdf/lenders/motai/rto/contrato_rto_con_codeudor.blade.php)"}

Antes de depurar un 500 en local, probá eso: es una línea y no depende de que nada esté arriba.

⚠ **NO apuntes el target `local` al Loki de dev.** Con la BD funciona (leés las filas que tu corrida
escribió); con Loki no, porque tu corrida local no escribió allá: leerías la corrida de otro cuyo
`user_request_id` coincide — y coincide, la BD local es un dump de dev y los id avanzan en el mismo rango
(2026-08-04: local 464664, dev 464620). `pkg/loki.ts:porQueNo` lo **bloquea**.

**No metas el modo rápido en el panel.** Ya se intentó y se revirtió: el panel existe para probar el
FRONTEND a mano; el rápido es una herramienta de análisis por consola. Mezclarlos confunde para qué
sirve cada uno. Si necesitás correr el rápido, es `node dev/sweep.ts …`, no un botón.

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica en ninguno de los dos — tener dos definiciones de "pasó" es
como empiezan a derivar, y ahí una divergencia deja de ser diagnóstico y pasa a ser ruido.

**Y para un runner PARALELO, pedí una instancia: `crearTraza({ salida, ancho })`.** Hasta el 2026-09-03
el estado de la traza (la solicitud, el contador, las alertas, la cola) vivía en el módulo, o sea UNA por
proceso: correcto para los tres runners de un caso, y roto para N casos a la vez —contador y alertas
compartidos, y las líneas de todos entrelazadas—. Por eso `walk-wizard.ts` nació con su propia copia
de esta lógica, que es justo lo que el párrafo de arriba prohíbe; ya no la tiene. Las funciones de módulo
(`paso`, `traceUReq`, `resumen`, `veredicto`) siguen ahí como delegación a una instancia por defecto, así
que **los runners de un caso no cambian nada**. `salida` manda las líneas al buffer del caso —en paralelo
se imprimen juntas al terminar— y `ancho` ajusta la columna cuando las rutas son largas.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que solo existen en el visual
y el rápido nunca los va a ver — F-50 fue una cancelación disparada por el routing del wizard
(`request-canceled` cancela en el loader), con el backend haciendo todo bien. El rápido valida negocio
y backend; el visual valida el camino real del usuario, que también tiene lógica de negocio.

⚠ **Y hay un tercer eje que ninguno de los dos cubre:** los **esquemas zod del front**. El runner por
consola pega contra el backend, que es más laxo, así que puede estar **verde con el recorrido visual
roto** (F-88). Si trabajás Bancolombia, cargá `harness-canal-qr` y corré `npm run contrato:bancolombia`.

## `case.ts`: tres cosas que aprendió el 2026-09-02, y que valen para cualquier runner

- **El veredicto del runner y lo que quedó en la base son DOS cosas.** Al cerrar, `case.ts` imprime
  `base: quedaron N usuario(s) y M solicitud(es) nuevos` contando desde una línea base tomada al
  arrancar — y si dijo **cero** pero la base creció, lo dice con todas las letras. Motivo: tres veces
  (F-176, F-180, la corrida de 42) reportó «0/N cerraron» con la base llena de usuarios íntegros: el
  guard de escrituras cortó DESPUÉS de que la API ya había escrito, o el gateway devolvió 504 a los 60 s
  mientras PHP seguía y terminaba. **Leé esa línea antes de repetir una corrida «fallida»** contra la
  compartida: repetirla duplica los datos.
- **El comercio se resuelve por `#hash`, por SLUG exacto o por NOMBRE (subcadena), en ese orden.** Antes
  sólo por nombre con `LIKE`: `pullman` andaba porque «Amoblando Pullman» lo contiene, y `viva-tu-credito`
  —el slug real— daba «no encontré el comercio». Una tanda de 40 sacada de la base por slug falló entera.
- **El país del comercio NO se adivina.** `merchantCountry()` reintenta una vez y si el payload no
  responde, el caso **aborta diciendo por qué**. Antes caía a Colombia en silencio: contra un backend
  saturado el dominicano y el peruano recibían teléfonos de forma colombiana, el peruano ni registraba
  (10 dígitos contra 9) y el fallo se leía como del backend. Un fallback que esconde la saturación es
  peor que fallar. ⚠ La rama del timeout está tipada pero **no ejercitada de punta a punta**: el prevuelo
  frena antes cuando la API está caída, y no encontré forma barata de que sólo el payload del comercio
  tarde. Si la ves disparar, anotalo.

- **Hay UN solo camino de ejecución, y `--lambda` sólo DICTA el buró.** Hasta el 2026-09-02 había dos:
  el flujo real por la API y un «sintético» —default sin `--lambda`— que insertaba la solicitud a mano,
  inyectaba el buró con `synthFill` y pedía el listado v1 que el wizard no usa. Cada bug de esa semana fue
  «arreglé un camino y el otro no» (teléfono por país, país sin adivinar, clave del error). Ahora
  `harness-caso` sin `LAMBDA=1` corre el flujo real con el buró que tenga el ambiente — que es lo que ve
  un cliente—; con `LAMBDA=1`, además, se dicta la respuesta de cada central para esa cédula. `synthFill`
  sólo queda para el cupo del codeudor.

- **`harness-caminar` también acepta `LAMBDA=1`, y sin él una compra de CrediPullman no cierra en
  local.** El dictado vive en `pkg/risk-lambda.ts` y lo comparten los dos runners. `synthFill` siembra
  «Empleado» al CARGAR personal-info, pero al ENVIARLA el backend consulta Agildata y Experian y evalúa
  las categorías con lo que contesten; sin dictado, el mock local contesta una persona sin empleo y un
  reporte fijo (score 654, 59 consultas, ninguna tarjeta). Con eso Premium se rechaza, el cliente cae en
  «Segunda oportunidad», que exige cuota inicial, y la corrida pasa por `/down-payment` (ver el punto
  siguiente). Con `LAMBDA=1` se
  dictan el empleo y un perfil de buró (`experian_profile_<cédula>`: score del caso, 1 consulta,
  1 tarjeta activa), una clave que sólo tiene el mock local. Medido el 2026-09-25: 0/2 → 2/2 en estado 11
  (`make harness-caminar CASOS='#13874eb6:77;#13874eb6:77' FLOW=ecommerce CERRAR=1 MANUAL=1 PAR=1
  LAMBDA=1 TARGET=local`). Contra dev/qa se ignora: ahí el backend le pregunta a la lambda de la empresa.

- **La cuota inicial se paga contra `make harness-wompi` (:8112), el mock de Wompi.** `/down-payment` no
  tiene action: corre en el navegador y abre el widget. El caminador hace lo que haría el cliente
  (`pkg/wompi-down-payment.ts`; no confundir con `pkg/wompi-mock.ts`, que intercepta en Playwright el checkout alojado del asesor): pide el preview y crea el intento por el proxy del wizard, le dice al mock que el
  comprador pagó (`POST /__mock/pay`) y consulta el estado hasta que sea terminal. Después sigue a
  `/first-payment-date`, como el «Continuar» de la pantalla de resultado. El backend no se entera en el
  momento: `PaymentStatusService` le pregunta a Wompi (`GET {WOMPI_HOST}/transactions?reference=`)
  cuando la transacción tiene más de 20 s, así que cada cuota tarda ~21 s. Es el camino que corre en
  producción: medido el 2026-09-25, las 121 cuotas iniciales de 30 días se confirmaron por esa consulta y
  ninguna por webhook, y la forma de la respuesta del mock es la de esas 121. Pide
  `WOMPI_HOST=http://host.docker.internal:8112/v1` en el `.env` del backend y `php artisan config:clear`;
  el `WOMPI_MOCK_ENABLED` que ya estaba no lo lee ningún código. `PAGO=DECLINED` prueba el rechazo (la
  solicitud queda en 3 y la fecha de pago la devuelve a `/down-payment`); `CUOTA=` paga más que el
  mínimo. Medido: 2/2 compras de tienda de CrediPullman en «Segunda oportunidad» cerraron en 11 con
  $500.000 de cuota inicial (`make harness-caminar CASOS='#13874eb6:77;#13874eb6:77' FLOW=ecommerce
  CERRAR=1 MANUAL=1 PAR=1 TARGET=local`).
  **En el navegador (desde el 2026-09-25) el widget es SIMULADO** (`pkg/wompi-widget.ts`, enganchado en
  `openWindow`): se intercepta `checkout.wompi.co/widget.js` y se sirve un `WidgetCheckout` con el mismo
  contrato que muestra el monto y dos botones, **Pagar** y **Rechazar**. Cada uno registra la transacción
  en el mock (APPROVED o DECLINED) y le devuelve al wizard lo que devolvería Wompi; de ahí sigue el
  camino real (`processing` → estado → el backend le pregunta al mock). Lo único que se acorta es la
  gracia de 20 s: se atrasa el `created_at` de la transacción 25 s en la base local, así la primera
  consulta ya reconcilia. Sólo con target `local`; `E2E_WOMPI_WIDGET=0` deja el widget real.
  ⚠ **Es del camino VISUAL (`openWindow`), no del caminador con `MOTOR=navegador`**: ése abre sus
  contextos en `pkg/wizard-browser.ts` (`openContext`), no instala el widget simulado, y además «Registrar
  pago» no está en `ADVANCE` — una compra con cuota inicial se queda en `/down-payment`. El `MOTOR=http`
  sí la paga (`payDownPayment`).
  ⚠ La base local trae la credencial de Wompi de producción de Pullman (`pub_prod_…`): con el mock la
  consulta del backend no sale de la máquina, y el widget simulado evita que el navegador abra el
  checkout real con esa llave.

- **Un solo helper HTTP con bitácora, y el listado está adentro.** `llamar()` es la única implementación;
  `get`/`post` son dos verbos sobre él. Antes eran dos copias que divergían (timeout 90 s vs 150 s, cómo
  reportaban un cuerpo no-JSON, y sólo una distinguía timeout de caída), más `http()` en el camino
  sintético. Y `lenders-v2` —**la** llamada que da sentido al caso— iba por `fetch` crudo y era la única
  del recorrido que no quedaba en la bitácora. Los tres `fetch` que siguen crudos son lecturas PREVIAS
  al caso (el payload del comercio para el tipo de documento y el país, y la sonda `vivo` del prevuelo):
  ahí no hay bitácora todavía.
- **Los `.catch` silenciosos NO eran 24 deudas.** Censo del 2026-09-02: 23 son lecturas de la base cuyo
  `null` se chequea en la línea siguiente («no encontrado o base caída», y el llamador lo trata igual).
  **Uno** violaba la regla de F-03: el dictado del score de Experian iba con `.catch(() => {})`, así que
  si fallaba el caso corría con el score por defecto del mock y el reporte decía igual «buró dictado» —
  Agildata sí se verificaba, Experian no. Ahora cuenta como dictado fallido. Si el número te importa,
  contalo (`grep -c 'catch(() => ' dev/case.ts`) y mirá la línea siguiente antes de llamarlo deuda.

⚠ **Y dos límites del entorno que hay que tener presentes al leer tiempos:** local sirve PHP con
`artisan serve`, **monohilo** — mide correctitud, no capacidad (F-181)—; y `qa` es ¼ de vCPU, 512 MB y
una sola tarea, con el ALB cortando a los 60 s: con 6 casos a la vez cierra, con 42 devuelve 504 mientras
PHP sigue escribiendo (F-180). Ninguno de los dos sirve para medir carga.

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

## El comercio de BCP (Perú), por ambiente

No hace falta sembrarlo en `qa`: **ya está**, y mejor repartido que en local — una entidad por sucursal.

| | local (lo siembra `make harness-peru`) | **qa / dev / staging** (ya existe) |
|---|---|---|
| comercio | `Comercio pruebas Perú` | `Comercio pruebas BCP` (allied **337**) |
| consumo (206) | misma sucursal | sucursal **2172**, hash `d5700512` — **sin** formulario de vehículo |
| vehicular (207) | misma sucursal | sucursal **2173**, hash `a8221e67` — **con** los placements 8/9 (`always_show`) |
| credential | por SUCURSAL | por COMERCIO (`allied_type = App\Models\Allied`) |
| form-service | mock `:8109` | el real |

⚠ **Contra `qa` el teléfono NO se puede derivar.** El OTP sólo se salta con los que están en
`settings.qa_otp_bypass_phones`, y el código son sus **últimos 4 dígitos**. Dos que sirven hoy:
`321411214` y `321411217` (los pasó Fercho). Uno por recorrido: con el mismo número los dos serían el
mismo cliente y el segundo chocaría con la solicitud del primero.

    make harness-bcp-volver TARGET=qa COMERCIO='#a8221e67' TEL=321411214,321411217 \
        FRONT=https://originaciones-qa.dev.creditop.com

⚠ **Y en el PANEL hay que declararlo, porque acá no coincide NADA entre ambientes**: ni el hash de la
sucursal ni el slug del comercio (`comercio-pruebas-peru` en local, `comercio-pruebas-bcp` en qa). El
panel resuelve el hash por ambiente si se lo decís en `.flows.json` —que está gitignoreado, así que
esto hay que ponerlo una vez por máquina—:

    "comercio-pruebas-peru": {
      "branch_hash": "50e007e4",
      "por_target": { "dev": "a8221e67", "qa": "a8221e67", "staging": "a8221e67" }
    }

Sin eso la card dice «no está en qa», que es falso: el comercio está, con otro hash. Cuando lo único
que cambia es el hash —y el slug se mantiene— el panel lo rescata solo buscando por nombre y lo avisa
en la card; acá no puede, porque el slug también cambia.

⚠ Y el **recorrido B deja una solicitud NEGADA**, así que fuera de local hay que pedirlo con `NIEGA=1`.
La base es COMPARTIDA por dev, qa y staging: lo que se ensucie ahí lo ve el equipo.

### El funnel DINÁMICO de RD (CeluRD/SmartPay) camina, y dónde vive el IMEI (2026-09-18)

    E2E_TARGET=local node bin/dbops.ts assign <sub> celurd 1bfb8cd0 <sub>   # la sesión manda sobre la sucursal
    make harness-caminar CASOS='#1bfb8cd0:152' FLOW=merchant MOTOR=navegador

Siete pantallas hasta el listado: `solicitar` → `request-amount` → `request-phone` → `request-otp` →
`request-personal-info` → `request-financial-info` → `lenders`. Antes moría en la SEGUNDA.

⚠ **`dbops assign` contra LOCAL no necesita `I_KNOW_THIS_TOUCHES_SHARED_DEV`** — el flag que imprime el
caminador aparece porque `bin/dbops.ts` apunta a **dev** por defecto (F-53). Con `E2E_TARGET=local`
explícito es una escritura local y reversible; **devolvé la asignación al terminar**.

⚠ **Y las pantallas de IMEI no están de este lado.** Al elegir SmartPay el flujo salta a un **handoff por
QR** («Escanea este código QR · usa tu celular para continuar»): `imei`, `imei/scan` y `imei/scan/success`
viven en el SEGUNDO dispositivo, que es coherente con que el escaneo use la cámara. Para caminarlas hace
falta seguir el handoff, como hace el guiado con sus ventanas A/B — el motor de navegador todavía no.
⚠ Ojo con el mensaje de esa corrida: dice «la entidad no está en el listado» cuando en realidad **la
pantalla ya avanzó sola** al QR. Es engañoso y todavía no está arreglado.

### El vehicular de BCP, caminado con NAVEGADOR de punta a punta (2026-09-18)

Nueve pantallas, ~160 s, y las nueve se pueden MIRAR (`.runs/caminar-…/ultima.png` + la traza):

    make harness-caminar CASOS='#50e007e4:207' MOTOR=navegador MONTO=60000 GATE=aprobado

    solicitar → celular → OTP → datos personales → formulario/pre →
    entidad/simulador → entidad/resultado (gate) → formulario/post → lenders

⚠ **`GATE=` es obligatorio acá y no tiene default a propósito.** `entidad/resultado` no ofrece
«Continuar»: ofrece **«Aprobado» / «Rechazado»**, porque ahí decide una persona. Sin la bandera el
caminador se detiene —no elige por nadie— y con `GATE=rechazado` la solicitud queda **NEGADA**, que en
una base compartida es basura que queda. Mismo criterio que el `--niega` del runner por HTTP.

⚠ **Antes esto no se podía caminar, y ninguna de las razones era del producto:** el botón del formulario
dice «Enviar» y no estaba en el patrón de avance; los selects del vehículo son una CASCADA y se llenaban
en una sola pasada; el trío de fecha los reclamaba sin poder llenarlos; el overlay de `react-scan`
interceptaba los clicks (**F-233**); y `clickAdvance` decía haber clickeado aunque fallara. El
recorrido es la prueba de que las cinco están arregladas.

### Las cuatro variables del WIZARD sin las que el vehicular no se ve (2026-09-18)

El recorrido con navegador llega igual, pero **degrada en silencio**: sin ellas el formulario del
vehículo tira «Oops! Algo salió mal» o el simulador abre con la URL pelada, que se ve idéntica a un
prellenado correcto. Van en `apps/loan-request-wizard/.env.local`, que es la capa que trae el wizard a
local — el `.env` apunta a `inertia-develop`:

    VITE_API_URL=http://localhost                         # ⚠ el `.env` dice `…inertia-develop/api`
    VITE_FORM_SERVICE_BASE_URL=http://localhost:8109      # el mock G2; el `.env` dice :8082, que está muerto
    VITE_BCP_VEHICLE_FORM_TYPE_ID=8                       # `SELECT id FROM form_types WHERE name='bcp-vehiculo-paso-1'`
    VITE_BCP_SIMULATOR_URL=http://localhost:8110/simulador # bin/mock-cuotealo

⚠⚠ **Y lo que esto destapó: `.env.local` puede NO EXISTIR.** `bin/advisor` lo escribe y lo restaura en su
`trap EXIT`; si muere mal, queda sólo `.env.local.asesor-bak` y el wizard pasa a leer el `.env`, que
apunta al **backend compartido de dev**. Un servidor de Vite ya levantado no se entera —tiene la config
en memoria— así que el problema aparece recién al reiniciarlo, y puede llevar días ahí. Medido el
2026-09-18: lo único que impidió que el wizard local escribiera contra dev fue que ese `VITE_API_URL`
termina en `/api` y el código le antepone otro, dando `api/api/…` y un 404. **Antes de reiniciar el
wizard, mirá si `.env.local` está.**

⚠ El país 167 en esa base **ya está completo** (`dial_code 51`, `phone_code +51`, largo 9, `PEN`,
`es-PE`) salvo `nationality`, que sigue en NULL.

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
- **El wizard local no arranca sin instalar el monorepo con pnpm.** Da
  `Cannot find module '@radix-ui/react-collapsible'` (declarado en `packages/ui/package.json` y en el
  lock, pero no materializado). ⚠ El monorepo usa **pnpm** (hay `node_modules/.pnpm`): un `npm install`
  falla con `Cannot read properties of null (reading 'name')` — sin tocar el lock, pero sin instalar nada.
  Es `pnpm install` en la raíz del monorepo.

## Qué deja esto en la tarea

Una corrida no termina cuando cierra: termina cuando lo que probó queda escrito donde alguien lo vuelva
a encontrar. El destino es la tarea en [`tablero/`](../tablero/CLAUDE.md), y son dos lugares distintos —
confundirlos es lo que volvía ilegibles las tareas grandes:

| lo que produjo la corrida | dónde va |
|---|---|
| la RECETA para volver a correrlo (sembrar el caso, el comando, cómo verificar dónde quedó) | **«Cómo se comprueba — y el MATERIAL»** del documento, que se MANTIENE: si la receta cambia, se corrige ahí |
| lo que pasó ESE día (cerró, no cerró, con qué se topó) | **un bloque de la pila** de la tarea (`BLOQUE=`, abajo), que se APILA |
| una trampa del SISTEMA, reproducible y con causa raíz | no se queda en la tarea: **gradúa a `F-xx`** (`tablero/data/traps/doc.md`) |

*(Hasta el 2026-09-23 lo del día iba al «Registro» del documento, como anotación. Ese día la historia
de las tareas pasó a la pila, y el lint del tablero frena una anotación nueva en una tarea.)*

⚠ **Va el COMANDO, no la conclusión, y no es estilo: el validador de la pila lo exige.** Un bloque que
trae una corrida la lleva en su caja ` ```harness `, con su `TARGET=`, y debajo su `Resultado:`. «Corrí
el caso y cerró» no deja rastro de nada; `make harness-caso CASOS='pullman' CERRAR=1 TARGET=local` sí.
Medido el 2026-09-18 sobre las anotaciones que había entonces: de 350, **308 tenían texto debajo y sólo
51 producían una fuente reconocible** — lo que se escribía a mano era prosa donde iba el comando.

⚠ **Y el arnés aparece en 33 de 68 tareas, pero sólo 8 lo nombran dentro de «Cómo se comprueba»**: las
otras 25 lo mencionan sueltas en la prosa, donde nadie las va a buscar al retomar. La sección existe
justamente para eso.

⚠ **A Jira NO va el arnés.** `## Tarea (publicable)` cambia de idioma: va *«se recorrió el flujo de
punta a punta con un cliente de prueba»*, nunca `make harness-caminar`. Nadie más del equipo corre esta
herramienta, así que nombrarla manda al lector a algo que no tiene y hace parecer que la prueba depende
de un juguete personal. El guard del tablero frena `make <target>`, `E2E_TARGET` y los puertos locales;
la regla entera, con qué poner en su lugar, está en [`tablero/CLAUDE.md`](../tablero/CLAUDE.md), en «La
frontera del guard está DENTRO del archivo».

**Y no hace falta escribirla a mano.** Con `BLOQUE=<id|slug>`, `harness-caso`, `harness-listado`,
`harness-caminar` y `harness-suite` agregan la corrida sola, como bloque, a la pila de esa tarea: el
título con el resumen, el comando exacto en su caja y la evidencia por caso como resultado, con
`via: harness` (`pkg/annotation.ts`, y su prueba le pregunta al validador del tablero en seco). Y
`MD=1` la emite como anotación, para un documento que NO es una tarea —un `CLAUDE.md`, una trampa—.
Lo aceptan los mismos cuatro, y devuelven la anotación completa —marcador con la fecha real, una línea
de evidencia por caso y el comando que la reproduce— al final de la corrida y **sola**, para copiarla
sin recortar:

    make harness-caso CASOS='pullman' CERRAR=1 MD=1

    > **MEDICIÓN · 2026-09-18** — 1/1 caso(s) en `local` · 1/1 cerraron en estado 11.
    > ✔ pullman · uReq 466858 · listado [100, 39, 77, 6, 9, 32, 68] · cerró en estado 11
    > **Cómo se vuelve a comprobar:** `make harness-caso CASOS=pullman LAMBDA=1 CERRAR=1 MANUAL=1 TARGET=local`

⚠ **El contrato lo fija el tablero, no el gusto de acá**: el marcador arranca la primera línea, TODAS
las líneas van dentro de la cita y el comando cierra como `Cómo se vuelve a comprobar`. Si deriva, la
anotación se pega, se ve bien y no es lo que dice ser. `pkg/annotation.spec.ts` lo fija leyendo el
**regex real** con que el tablero la reconoce (`reAnnotation`, en su `store`) — no una copia: un mock no
puede contradecir el documento del que nació. Y el bloque de `BLOQUE=` lo fija contra el validador de la
pila, en seco.

⚠ **Y lo que se resume es el DESENLACE, no el conteo.** «3/3 cerraron» no sirve dentro de una tarea tres
semanas después; qué entidades salieron y dónde terminó cada caso, sí. En `harness-listado` la
evidencia son las que NO salieron **con su causa**, que es la pregunta por la que se corre.

## Lo que hay que saber antes de correr (venía del árbol de contexto)

Mismo motivo que arriba: el contexto curado describe CreditOp y esto describe el arnés. Movido tal cual desde su nodo de `context/` el 2026-09-21, poco antes de que ese árbol se apagara. Lo que era conocimiento del PRODUCTO —quién decide el crédito por `response_type`— no vino: hoy vive en canon, y ya había divergido de esta copia.

### Antes de concluir


- **Un lender solo cierra in-platform si está en `lenders_by_allieds` del comercio**: forzar el 77 (de
  Pullman) en otro comercio da **pagaré HTTP 500**. Mirá la oferta primero (`dbops lenders-for`).
- **Muro Wompi (cierre rt=2 por UI) — VOLTEADO (`bin/close-lender`)**: el muro NO era el checkout de
  Wompi (`pkg/wompi-mock.ts` lo intercepta, verificado) sino el **scoring**: un perfil aprobado cae en
  categoría con `min_initial_fee=0` → cuota $0 → botón «Pagar» disabled → nunca llega a Wompi. El fix
  siembra un rt=2 sintético con `min_initial_fee>0` en TODAS las categorías. El cierre backend sigue
  siendo `asesor 3e67eade 77` (fuerza `initial_fee=0`).
- **`IPHONE_UA` obligatorio**: el wizard gatea validación y `loan-approved` por `onlyMobileValidation` —
  con UA de escritorio responde **403** y el loader queda en blanco. A y B usan UA de iPhone.
- **Reuse de puertos**: `bin/advisor` reusa el wizard :5174 y lo reinicia **solo si apuntaba a otro
  backend**; `mock-preapprovals` reusa solo si `MOCK_PA_DELAY_MS` coincide (el env se hornea al bootear).
- **El eje ecommerce se ejercita contra dev, no local** (la entrada del front está PENDIENTE DE MERGE →
  nodo `ecommerce`; F-54). En local el checkout SSR se degrada.
- **Timeouts**: el wizard usa lenders-v1 (pre-aprobación sincrónica lenta) → «Server Timeout» del
  `streamTimeout` (fix por env). `PICK_TIMEOUT` (default 300 s) espera tu click por pantalla del guiado — ⚠ la constante se llama así en el código pero **la variable de entorno que la mueve es `E2E_PICK_TIMEOUT_MS`** (`harness/dev/guided.spec.ts:79`); exportar `PICK_TIMEOUT` no hace nada. El test entero tiene su propio tope de 900 s (`:196`).
- **`MoneyInput` pierde `fill()` por hidratación**: `seedField` reintenta tecla a tecla.
- **Mutex de la cuenta 1827080**: Motai y SmartPay la necesitan ligada a comercios distintos;
  `pkg/account-lock.ts` (mkdir atómico) los serializa bajo `fullyParallel` y restaura a Motai al final.
- **SmartPay teléfono internacional** (`+57…`): `create-temporary-user` guarda el phone crudo pero
  `check-user-exists` normaliza a `+`+dígitos — sin el `+` da `BDUS004` (usuario no encontrado).
- **`X-Dev-Session`/`DEV_SESSION_KEY` obsoletos, y más muertos de lo que esto decía**: el gate de
  `/merchant/*` hoy es Cognito, y —medido el 2026-09-19— esos nombres aparecen **cero veces en
  `legacy-backend` y cero en `legacy-application`**. No es «existe sin consumidor»: **del lado del
  backend no existe**. Lo único que sobrevive es el comentario en el `.env.local` del arnés y las dos
  menciones de `harness/docs/` que ya lo marcan como obsoleto.

**(2026-09-19) Re-verificado entero, cuando esto era un nodo del árbol.** 14 afirmaciones auditadas contra el código del arnés y de
los dos monolitos, cero chequeos débiles y ninguna falsa. Exactos: **los ocho archivos que cita existen**
(`wompi-mock`, `account-lock`, `inject`, `laravel-crypt`, `mock-control`, `sweep`, `qr-corbeta`,
`close-lender`), los tres `field_id` que inyecta `synthFill` (**29** ocupación · **87** ingreso · **160**
reportado), el mutex por `mkdir` atómico con su comentario, el `IPHONE_UA`, los puertos **:5174** y
**:5195**, y el tope de **300 s** por pantalla del guiado. ✔ **Y la advertencia sobre los stashes se
confirmó en vivo**: hoy están en `{3}`, `{4}` y `{5}` — se volvieron a correr. Lo afinado: el flag
`X-Dev-Session` no es «sin consumidor», **no existe** del lado de los backends; y la variable que mueve
el timeout del guiado no se llama como la constante.

### Los bypasses del backend viven en STASHES (no en `main`)


Los `Http::fake` de proveedores + el fake de `PdfMapper` los aporta `legacy-backend` en modo mock, y
viven en **stashes locales sin commitear** que tocan `AppServiceProvider.php`.

⚠ **NO están aplicados por default** (working tree limpio en `main`) y **⚠ citá los stashes por
MENSAJE, nunca por índice**: cualquier `git stash` corre todos los números — este doc decía
`stash@{0}`/`{1}` y un día fueron `{3}`/`{4}`. ✔ **Comprobado otra vez el 2026-09-19: los tres siguen
existiendo y hoy están en `{3}`, `{4}` y `{5}`.** Se corrieron de nuevo, exactamente como esta
advertencia anticipaba — es la mejor prueba de que la receta por mensaje es la correcta.

```bash
cd ~/Desktop/CREDITOP/github/legacy-backend
git stash list | grep -nE "bypasses completos|cierre Creditop X"   # ver dónde están HOY
git stash apply "$(git stash list | grep -m1 'bypasses completos' | cut -d: -f1)"
git stash apply "$(git stash list | grep -m1 'cierre Creditop X'  | cut -d: -f1)"   # + PDF_MAPPER_FAKE=true
make up && make mock-all && make restart
```

Qué trae cada uno: **«local-e2e: bypasses completos + SmartPay forms-service FAKE»**
(`fakeFormsServiceRoutesForLocal`) y **«local-e2e: cierre Creditop X»** (fake pdf-mapper + `Throwable`
en handlers). Hay un tercero, **«local-e2e bypasses (S3 bucket + Sistecredito host)»**.

Otros bypasses del camino feliz: **OTP** — el teléfono se agrega al setting `qa_otp_bypass_phones` y el
código son los últimos dígitos (4 en registro, 6 en pagaré; el mecanismo → `onboarding`) ·
**`X-Fake-Scenario`** (`pkg/mock-control.ts`) fuerza fallos categorizados por request — intercepta
`**/*` porque el wizard es SSR y el header tiene que llegar al FE server.

### La inyección (el comando, no la semántica)


`synthFill` (`pkg/inject.ts`) escribe identidad + `user_field_values` (29 ocupación · 87 ingreso ·
160 reportado) + una fila `RiskCentralUserData` con la **fila Experian cifrada** con `APP_KEY`
(`pkg/laravel-crypt.ts`). En el guiado, `personal-info` NO se clickea real (su submit dispara
AgilData/Mareigua/Experian): `synthFill` inyecta y auto-avanza. La **semántica** de esos campos (qué
score pasa, qué regla datacrédito aplica) es turf de `profiling` / `kyc` — acá solo el mecanismo.

### Setup (Cognito, assign por SUB, puertos)


- **Puertos**: wizard **:5174** · panel **:5195** · MySQL local `127.0.0.1:3306` (schema `creditop`) ·
  API legacy `http://127.0.0.1:80/api` (vhost por header `Host`). Mocks → `harness/CLAUDE.md`.
- **Cognito** (`/merchant/*` = Motai/SmartPay exigen sesión): credenciales en `.cognito.json`
  (gitignored; el env `E2E_COGNITO_USER/PASS` gana). Sin credenciales los specs gated **skipean**, no
  fallan. **Caché de sesión**: los specs reusan `storageState` (`.auth/cognito-state.json`) →
  `cognitoLogin` es no-op mientras viva el refresh token (días); tras un login real re-guarda el estado.
  Cubre también el camino del panel (`E2E_ENTRY=cognito`): «Preparar + Lanzar ▶» no re-abre el Hosted UI
  por corrida.
- **Assign por SUB**: el backend resuelve el comercio por `x-cognito-identity-id` = el **sub real** del
  login web. `bin/advisor` asocia la fila `users` al comercio (`dbops assign`) solo si hace falta — un
  asesor = un comercio; revert con `dbops revoke`.
- **`.flows.json`** (gitignored): identidad del asesor + `merchants.<m>.branch_hash` + teléfono de
  bypass. **`.env.<target>`**: `E2E_DB_*`, `APP_KEY` (cifra la fila Experian).
- **El panel** (:5195) elige comercio, define el sintético y lanza `bin/advisor` con `E2E_INJECT=1`
  (buró invisible) o sin él (buró real). Solo local por diseño (fuerza el target).

**(2026-08-28)** Deriva = commits propios (el codeudor entró al runner — rt=2 ya no pide manos —, la
radicación de Credifamilia cierra con F-168, y config/inyección acompañando). Autodocumentado en los
commits del propio playground.

**(2026-09-18) Lo que cambió el contrato del arnés con el resto del árbol**, verificado corriéndolo:

- **La corrida se escribe sola como anotación: `MD=1`** en `harness-caso`, `-listado`, `-caminar` y
  `-suite`. Devuelve el marcador con la fecha real, una línea de evidencia por caso y el comando que
  la reproduce, al final y **solo**, para pegarlo sin recortar. No era comodidad: medido ese día, el
  86 % de las anotaciones pegadas a mano no traía el comando. *(Desde el 2026-09-23 lo que va a una
  tarea entra a su pila con `BLOQUE=`; `MD=1` queda para los documentos que no son una tarea.)*
- ⚠ **El TARGET va siempre en ese comando, aunque sea el default — que acá NO es `local`.**
  `E2E_TARGET` cae en `dev` si nadie lo dice, y dev y staging comparten base: una medición sin
  ambiente no se puede contrastar.
- **El panel dejó de ser una columna y pasó a ser un editor** (dos barras, consola abajo, el mapa del
  recorrido al centro). El mapa ahora **marca dónde va la corrida**, leyendo las líneas de la traza.
- **El aviso de «falta MinIO» mentía siempre**: el puerto del S3 local se leía fijo en 9000 y esta
  máquina usa ministack en `:4566`. Ahora sale del `AWS_ENDPOINT` del backend. Un aviso
  permanentemente rojo deja de leerse, y tapa a los que sí importan.
- **Qué GENERA los documentos es una perilla del `.env` de otro repo, y ahora el panel la muestra**
  (`DOC_GEN_*`: `blade` o `microservice`). Con el mock la corrida es mucho más rápida y **deja de
  ejercitar las plantillas Blade**, o sea que deja de atrapar la clase de bug de **F-150**. Medido con
  el mismo caso: **65,7 s con Blade contra 9,8 s con el mock**.

⚠ **Los hallazgos de producto que trajeron esas corridas NO están acá**: tienen su `F-xx` en el nodo
las trampas del sistema (F-214 listado vacío · F-218 una rt=2 que no pasa las reglas duras desaparece del listado · F-220 identidad sin proveedor ·
F-236 el techo del documento · F-238 la caché de asignación). Este nodo describe la herramienta; lo
que la herramienta encontró vive donde se busca por síntoma.

### Lo que NO está verificado

- El flujo ecommerce por UI en local sigue degradado (SSR `process.env.VITE_API_URL`); el cierre Motai
  por UI (marketplace ofreciendo el 158 + testids) sigue pendiente — validado solo por API.

### Bancolombia: hasta dónde llega una prueba (venía del árbol de contexto)

- **La decisión no es inyectable** (la toma la API del banco), pero **el escenario sí es direccionable en no-prod** por cédula y por celular (§7). Eso es más de lo que decía el padre ("frontera dura"): se pueden ejercitar con-cupo, sin-cupo, sesión expirada y riesgo de fraude sin mockear el transporte.
- El harness lo rutea **por ID antes que por `rt==1`** (`bancolombiaClose`: `validate-preapproved` con `Http::fake` + override `TestDoc=1998228194`). **No llega a Estado 11.**
- El eje ecommerce se degrada en local (Mixed Content contra el host interno) → usar dev desplegado.
