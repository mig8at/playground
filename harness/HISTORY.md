# harness · historia y porqués

Esto es la historia y el «por qué» del harness: cómo se midió cada cosa, qué se probó y se descartó, y el detalle largo de cada herramienta.
Salió de `CLAUDE.md` el 2026-11-18, movido tal cual, sin reescribir; los títulos dicen de qué sección vino cada parte.
Para saber cómo se USA el harness —qué comando, contra qué ambiente, qué escribe— el lugar es [`CLAUDE.md`](CLAUDE.md).

## De «Cómo está construido»

### Las herramientas de consola, fila por fila

**Las herramientas de consola, por la pregunta que contestan:**

| Comando | Contesta |
|---|---|
| `dev/sweep.ts` | ¿qué desenlace da cada comercio × entidad? (modos `matrix` · `close` · `abaco`) |
| `dev/qr-corbeta.ts` · `dev/walk-qr.ts` | el canal QR: ¿cierra en estado 25 con código? (API) · ¿qué pantallas existen y en qué orden? (clickea). El detalle: skill `harness-canal-qr` |
| `dev/bancolombia-contract.ts` · `dev/sandbox-bancolombia.ts` | ¿el mock cumple los zod del front? (`npm run contrato:bancolombia`) · ¿el banco DE VERDAD acepta lo que mandamos? (`make harness-sandbox`, el único contra el gateway real) |
| `dev/experian-check.ts` | ¿esta solicitud omitió el buró, y se puede *afirmar*? (F-60) |
| `bin/bureaus.ts` | **¿qué contesta cada BURÓ para la cédula de mi prueba?** (`make harness-bureaus-set DOC=<cédula> SET='agildata=fail mareigua.income=3800000'`). Agildata → Mareigua → TusDatos es la cascada de IDENTIDAD (la primera que responde); el INGRESO y la ocupación salen sólo de Agildata o Mareigua (TusDatos no los trae; sin ninguna, el cliente los declara en el wizard), y Quanto los PISA si el comercio dispara Experian (`experian_trigger_allieds`). Cada buró `ok` · `empty` (sin información, sólo Agildata y Mareigua) · `fail` (HTTP 500), con sus valores: salario, empleo y meses; Acierta (score, negativos, consultas, moras) y Quanto (`experian.quantoIncome`, 0 = no estima). **Lo no dicho queda POR DEFECTO** (`BUREAU_DEFAULTS` en `pkg/risk-lambda.ts`, los mismos de la pestaña «Burós» del panel). `CATEGORY='CrediPullman:Segunda oportunidad'` busca con el simulador del backend (`bin/category.ts solve`) los valores de los burós que ponen el caso en ESA categoría, moviendo primero los burós y sólo si no queda otra la edad o el género (que avisa: son del caso). `make harness-bureaus-show DOC=…` lee lo que el mock contesta de verdad; `-reset` vuelve a los valores por defecto; `JSON=1` para un agente. ⚠ Sólo el mock local (:8105), y sólo cuenta cuando el backend consulta (no con el buró inyectado) |
| `bin/bureaus-profile.ts` | **¿las centrales van a contestar la persona que escribe el cliente?** `node bin/bureaus-profile.ts <local\|qa> <cédula> --name "NOMBRE" [--income --occupation --months --score] [--json]`: dicta un perfil entero antes de una compra — en qa al lambda de la empresa con `dictateCompanyLambda` (Ágil Data y Experian, confirmando), en local con `applyBureauConfig`. Lo usa el botón «Cargar mis datos en las centrales» de `ecommerce` (perfil en `ecommerce/.profile.json`). Para local exige `E2E_TARGET=local` en el entorno (F-187). En qa el ✓ no garantiza que la consulta caiga en el mismo contenedor (F-245) |
| `make harness-ssr` | **¿a qué servicio llamó el SSR del wizard, y cómo le fue?** Sus líneas `[outbound]` son la ÚNICA vista de eso. `ONLY=1` filtra; `FOLLOW=1` sigue. ⚠ Lo escribe `bin/advisor` en `/tmp/asesor-wizard.log`: si levantaste el wizard a mano, su salida está en ESA terminal |
| `dev/loki-trace.ts` | ¿POR QUÉ terminó así? forense en los logs (`make harness-loki UREQ=…`). Ancla en los LOGS y no mira prod (para una solicitud de prod, el tracer del equipo). `TARGET=` es obligatorio (F-234) |
| `bin/pg logs` (en la raíz) | los CUERPOS crudos de Loki cuando no hay uReq que anclar. ⚠ El PHP de dev **y de qa** loguea como `service_name="CreditopDev"` (F-179) |
| `dev/bcp-return.ts` | el flujo VEHICULAR de BCP por HTTP, y qué se PIERDE al volver atrás (`make harness-bcp-return`; F-185, F-186). En local pide `make harness-peru` + `make harness-forms-g2`; contra `qa` el comercio ya existe (skill `harness-caminador`) |
| `make harness-suite-countries` | ¿el cliente nace con el país de su comercio, su documento y su celular? (`suites/paises.json`; `requiere: lambda`) |
| `dev/ecommerce.ts` | el CANAL ecommerce de punta a punta por API y en JSON (`make harness-ecommerce`). ⚠ Solapa con `channel/ecommerce-*.spec.ts` (por navegador): antes de agregar casos, decidir cuál es el lugar. El detalle: skill `harness-canal-ecommerce` |
| `dev/payment-link.ts` | **¿el wizard abre bien un pedido creado por API?** (`make harness-payment-link TARGET=local`). Hace en la base lo que hará `POST /api/ecommerce/payment-link`: guarda el pedido con `origin = 'payment_link'`, una referencia y su vencimiento, y devuelve la URL con `?ref=`. Variantes para cada camino: completo → listado sin código; `NO_ACCEPTANCE=1` y `EXPIRED=1` → código; `NO_EXPEDITION=1` → formulario prellenado. ESCRIBE: el ambiente va explícito |
| `bin/mock-payment-link` · `make harness-store` | **¿el plugin de VTEX o de Shopify consigue la URL y el wizard abre el pedido?** Una tienda demo en http://localhost:8113/ con selector de plataforma: simula lo que manda VTEX (`authorize`) o Shopify (la sesión de pago offsite), lo traduce como lo haría cada plugin y llama a `POST /api/ecommerce/payment-link`, que por ahora es un mock del contrato de CORE-746 (`pkg/payment-link.ts`, copiado de legacy-backend#1682) y escribe en la base LOCAL la fila con `origin = 'payment_link'` y `?ref=`. Muestra los cuatro saltos y recibe el webhook del backend en `/webhook/<plataforma>`. Con VTEX, «Cobrar» hace el settle con el conector real (que consulta `GET /api/ecommerce/status/{orderId}`, también mockeado acá contra la base local). **Modo qa** (`STORE_BRANCHES=<json privado [{hash,name,allied,ecommerce_type_id,platform,credential}]>`, `MOCK_PAYMENT_LINK_PUBLIC=https://<túnel a :8113>`, `PAYMENT_LINK_URL=https://api.dev.creditop.com/legacy-api/ecommerce/payment-link` y el conector con `CREDITOP_API_URL` igual): las sucursales salen del archivo, el aviso de qa entra por el túnel y el comprador usa el celular de bypass sin cédula; la API real exige `https` en `return_url`, por eso la vuelta también va por el túnel. El Bearer del mock es la credencial de la sucursal; con la API de verdad en el backend local, `PAYMENT_LINK_URL=http://localhost/api/ecommerce/payment-link PAYMENT_LINK_TOKEN=<token Sanctum>`. ESCRIBE: sólo local |
| `dev/vtex-run.ts` · `pkg/vtex.ts` | **¿la tienda VTEX DE VERDAD sigue andando con el conector que está en `master`?** (`make harness-vtex TARGET=qa [CASES=aprobada,negada,cancelada,tienda-cancela]`). Sin nadie en el checkout: compra en la tienda de pruebas `creditop` por la API de Checkout (pedido → pago con Creditop → `gatewayCallback`, que dispara el authorize y devuelve la URL con `?ref=`), el caminador entra al wizard de qa con la identidad del caso (`--store vtex`) y llega al listado, y después cada caso recibe su desenlace (el simulador, o la cancelación desde la tienda) y se espera a VTEX. Dice por caso el estado de la transacción, cuánto tardó el primer authorize, `ProxyTimeout`, una cancelación negada y la versión del conector de cada workspace. Sin autenticar, la API de Checkout niega el pedido (`CHK003`): va con la llave de VTEX de `connectors/.env`. Qué conector y qué sucursal atienden lo decide la condición de pago activa: la sucursal es el App key de su afiliación (`activeBranchHash`; «Creditop · pruebas» → `ecf9342be`, o «Creditop · pruebas Mario» → `1126106a`, la copia de Mario hecha con `dev/copy-creditopx.ts`, las dos en el workspace `pruebas`, cuya app está en QA). ⚠ **Desde el 2026-11-12 la condición «Creditop» apunta a «Creditop · producción»** (workspace `master`, app en Producción, sucursal 84297564 de prod). El runner la apunta a la afiliación de pruebas de `--branch` (por defecto `ecf9342be`) sólo mientras compra y la devuelve, también con Ctrl-C (`withAffiliationFor`); el rotativo hace lo mismo con la de Mario. Mientras dura, una compra de otra persona en la tienda también va a qa. Una afiliación del workspace `master` se rechaza antes de comprar (`affiliationFor`): compraría en prod. `--branch` fuerza la sucursal del caso. ESCRIBE pedidos en VTEX y en qa, como una compra a mano |
| `make harness-auto-onboarding` · `dev/auto-onboarding-link.ts` | **¿un pedido completo SALTA el SMS y el formulario?** (`make harness-auto-onboarding TARGET=local\|qa [BRANCH=<hash>]`). Lo que haría una tienda que manda todo: crea pedidos por la API real de payment-link con el token de la sucursal y abre la URL como teléfono. «con» (celular, documento, nombres, correo, fechas de expedición y nacimiento, `termAccepted` y `policyAccepted`) tiene que ir a `validando` y al listado sin celular, código ni formulario, y sin OTP en la base; «sin» (sin aceptaciones) tiene que pedir el código. La sucursal tiene que estar en `auto_onboarding_allied_branches` (`harness-setting … LIST=hashes`); sin `BRANCH`, la de la última copia de comercio del ambiente. Fotos en `.runs/auto-onboarding-*`. Medido el 2026-11-06 con la copia de Mario: 2/2 en local y en qa. ⚠ No confundir con `dev/auto-onboarding.ts`, que mide, sólo en local, a dónde termina el comprador según lo que contesten las centrales |
| `make harness-revolving` · `dev/copy-creditopx.ts` | **¿el CreditopX ROTATIVO cierra de punta a punta?** (`make harness-revolving TARGET=local\|qa`). Dos compras por tienda con la copia de Mario Hernández (slug `mario-hernadez`, entidad 200, cupo 1.500.000), por el caminador en navegador hasta `loan-approved`: una bajo y otra sobre la mitad del cupo (la de arriba daba 403 de cuota inicial, legacy-backend#1881). Va con la identidad a mano: la entidad valida con ADO (biometría), que un navegador sin ventana no hace. Por la tienda VTEX de verdad: `make harness-vtex TARGET=qa CASES=rotativo` (apunta la condición de pago a la afiliación «Mario Hernández (qa)» mientras dura y la devuelve, `withAffiliationFor`). La copia sale de producción con `dev/copy-creditopx.ts` (sólo configuración, sin clientes ni secretos; vista previa por defecto, una transacción con `--apply`, el archivo para deshacer en `.runs/copy-creditopx/`; `--complete` agrega lo que le falte a una copia vieja). Ids en qa: comercio 350, sucursal 2233 (`1126106a`); en local se copia con `--ecommerce-like` de una sucursal local con credencial VTEX |
| `dev/screens.ts` | ¿por qué PANTALLAS habría pasado el cliente? (`make harness-screens`; derivado del router en `main`) |
| `make harness-posthog` | ¿qué VIO el cliente y en qué PANTALLA se rompió? Lo contesta el conector (`bin/pg events request`): eventos del front + su bitácora (pantalla · loader/action · error) y el replay, con `WINDOW=1d` (prod y los de pruebas comparten ids) y `TEL=` para la fase de auth. El cruce automático al cerrar una corrida sigue en `pkg/posthog.ts` |
| `make harness-posthog-errors` | ¿qué PANTALLAS del front se rompen en el ambiente, y con qué? (`bin/pg events errors`, `DAYS=7`). Sólo qa/staging y prod |
| `dev/session.ts` | adaptador de `bin/pg admin` y `bin/pg advisor`: sesiones, login y logout pertenecen a `connectors/`. Un solo archivo privado con cuenta, origen, cookies y localStorage en `connectors/.auth/sessions/`; los runners lo reutilizan con los adapters de `pkg/`. Credenciales sólo en connectors: `ADMIN_USER/PASS` y la clave compartida `ALLIED_TEST_ADVISOR_PASSWORD`. El asesor es el **de prueba del comercio** (`c<hash>-fake@`): lo resuelve `dbops test-advisor` (en local lo trae de la base compartida) y entra el conector con esa cuenta; `bin/advisor` lo exporta como `E2E_ADVISOR_ACCOUNT`/`E2E_ADVISOR_SUB`. El asesor no tiene cuenta de persona; `.admin.json` y `E2E_ADMIN_*` sólo producen aviso, nunca eligen identidad. Admin local emite sesión sin clave; asesor local :5174 usa pool dev. [Contrato](../connectors/CLAUDE.md) |
| `dev/allied-create.ts` | ¿el alta de un comercio deja bien a su asesor de prueba? Crea un COMERCIO por el conector del admin (`bin/pg admin allied-create`, en Go: HTTP con sesión y CSRF, sin ventana), comprueba en la BASE la sucursal y el `cognito_id`, y opcionalmente prueba el login (`LOGIN=1`) y lo borra por id exacto (`CLEANUP=1`). `make harness-allied-create TARGET=local\|dev\|staging` (el ambiente es OBLIGATORIO: escribe); `CHECK=1` sólo muestra con quién actuaría. Usa la sesión guardada con `bin/pg admin login --target <t>` (local se renueva sola) y dice con QUIÉN actúa antes de escribir. El alta ESCRIBE: lo creado lleva «PRUEBA AUTO» y es lo único que se borra, con los permisos angostos `prueba-comercio` y `prueba-asesor` de `pkg/db.ts`. Piezas: `pkg/allied-admin.ts` (verificar y borrar) y `pkg/pg.ts` (llamar al conector). El cliente del admin ya no vive en el harness: es `connectors/admin` |
| `make harness-doctor TARGET=local` | **¿el ambiente local está listo para que una corrida diga la verdad?** Antes de correr, en sólo lectura: la rama de legacy-backend y del front contra `origin/main` (lo medido es esa rama), el backend por una ruta que siempre contesta JSON, artisan y migraciones pendientes (las de vistas de reportes avisan; las de tablas frenan), los mocks (frenan centrales y entidades, que exige la consola; el resto avisa con a quién le hace falta) y los perfiles CreditopX agotados; avisa también entidades que exigen codeudor sin catálogo y planes de renting sin `count` ni `weeks` (el backend contesta 200 con el plan vacío y la pantalla de plan de pagos del asistente da 500 por su esquema). Cada problema trae su comando. Sale 1 si algo frena; `JSON=1` da `harness.doctor/v1`. Nació de cinco tropiezos del 2026-11-02 que se descubrieron después de correr |
| `make harness-regression TARGET=local` | **¿mi cambio rompió OTRO flujo?** Corre todas las suites del runner de casos en serie (comparten la base local), después de `harness-doctor` (si algo frena, no corre), y compara cada una con la corrida anterior guardada en `.runs/regression-last.json`: NUEVA · igual · SE ROMPIÓ · SE ARREGLÓ. `RESET=1` reinicia antes el cupo local; `ONLY=texto` corre sólo algunas y no guarda; `JSON=1` da `harness.regression/v1`. Avisa si legacy-backend o el front no están en `main`: lo medido es esa rama. Antes de dar por roto algo que pasó a rojo, repetí esa suite sola: una falla intermitente (un registro que no contestó) se ve igual en el resumen, y el desvío trae el detalle del caso |
| `make harness-failures` | **¿qué FALLA, desde cuándo, en qué ambiente y con qué comercio?** Cada corrida del runner de casos (`harness-case`, `-suite`, `-regression`) deja cada caso —verde o rojo— en un registro de esta máquina (`.runs/registry/cases.ndjson`, `pkg/failure-log.ts`): ambiente, suite, caso, comercio, entidad, canal, solicitud, desvíos, el comando para repetirlo y la rama del backend con que corrió. El comando lo agrupa por caso y AMBIENTE: rojo · intermitente (verde y rojo en las últimas 10) · sin veredicto · verde, con la historia y «rojo desde». Por defecto muestra lo que no está verde; `TARGET=`, `STATUS=`, `DAYS=`; `JSON=1` da `harness.failures/v1`; `HTML=1` escribe el dashboard (`.runs/registry/fallas.html`, autocontenido, con el tema de `tools/ui` leído al generarlo). Es un registro de DATOS, sin curar: una falla confirmada y explicada es una incidencia, y vive en el tablero (`tablero/tasks/incidencias`). Lo llenan el runner de casos (`runner: case`, canal `api`) y el caminador (`runner: walk`, canal = la puerta y el motor, p. ej. `self-service · http`: el mismo comercio por la tienda y por el asesor son dos filas) |
| `make harness-environment TARGET=local LIVE=1` | ¿la configuración es coherente y los servicios contestan? Sólo lectura: identifica la API por su ping, consulta el wizard sin seguir el login, autentica MySQL y ejecuta `SELECT 1`. En local también sondea los puertos del registro de mocks compartido con el panel; sólo los declarados en `MOCKS=bureaus,pdf-mapper` son obligatorios. Distingue HTTP de error, timeout y conexión rechazada, con el siguiente comando que revisar. `JSON=1` añade `health.checks`; `TIMEOUT_MS=10000` cambia la espera (default 5000, máximo 60000). No demuestra que el flujo cierre ni que el wizard tenga configuración fresca: eso lo miden las herramientas siguientes. |
| `make harness-env-drift TARGET=qa` | ¿el AMBIENTE remoto está al día con su rama? Las migraciones de la rama desplegada (`develop`/`qa`/`staging`) que la base compartida no tiene, y las rutas que el backend de esa rama le pide al lambda de centrales (los literales `/experian/…`, `/agildata/…`, `/mareigua/…`, `/tusdatos/…` de `app/Actions/RiskCentrals/`) que el lambda contesta con 404. Sólo lectura; sale 1 si hay desfase. El panel muestra lo mismo en el pie al elegir el ambiente, junto con dos avisos suyos: su propio código cambió después de arrancar, y el front local (:5174) sirve una rama sin el auto-onboarding. Lógica en `pkg/environment-drift.ts`. Medido el 2026-10-08: las dos cosas que cortaban la firma y el buró en qa salían en verde en todas las demás herramientas |
| `dev/wizard-ensure.ts` | ¿el wizard local (:5174) está al día con SU configuración? (`make harness-wizard`, `CHECK=1` sólo diagnostica). Mide que conteste, que su `.env` no se haya editado después de arrancar (Vite lo lee una sola vez) y que el login que sirve sea el de su `.env`; si falla, lo baja y lo levanta con `bin/advisor <comercio> preboot`. `bin/advisor` tiene la misma comprobación (la 5ª) y `harness-login-check` lo corre solo antes de probar. Lógica pura en `pkg/wizard-health.ts` |
| `dev/prod-advisor-check.ts` | ¿el asesor de prueba de un comercio de PRODUCCIÓN está bien armado para entrar? **SIN entrar, solo lectura y sin clave** (`make harness-prod-advisor ALLIED=<id>` o `EMAIL=<correo exacto>`): lee la base de prod por el conector `sql`, la cuenta en el pool de comercios de prod con el perfil de AWS `prod` (`admin-get-user`) y a qué login manda el wizard de prod; compara el `sub` del pool con `users.cognito_id`, y dice qué hacer. **No prueba el login: en prod no se hace** (es solo lectura, y el primer ingreso de un asesor puede completar su `cognito_id`); entrar de verdad se hace a mano. Pide `aws sso login --profile prod` y la VPN de prod; sin ellas sale con 2. La lógica pura vive en `pkg/prod-advisor.ts` |
| `dev/login-check.ts` | ¿el ASESOR DE PRUEBA de un comercio (`c…-fake@`) ENTRA al wizard de cada ambiente? (`make harness-login-check TARGETS=dev,qa,staging ALLIED=<id>`). Un proceso hijo por ambiente, con ventana como el panel; sin clave sólo descubre a qué login alojado manda cada front. La clave sale de `ALLIED_TEST_ADVISOR_PASSWORD`. `ALLIED=last` toma el asesor de prueba más reciente y `BLOCK=<tarea>` anota la corrida sólo si hubo un intento real. No toca el cache de sesión. La lógica pura vive en `pkg/login-probe.ts` |
| `dev/warm-session.spec.ts` | adaptador del pre-login del panel: delega a `connectors/advisor` y guarda su sesión única. qa/staging siguen usando ventana. Para consola: `make harness-login TARGET=…` |
| `dev/advisor-target.spec.ts` | ¿a dónde manda el front al elegir una entidad, canal ASESOR? Usa `chooseEntity`, no un localizador propio |
| `bin/pipeline-local` · `dev/pipeline-local.ts` | **¿qué nombre queda, y dónde frena, un cliente que va por el pipeline de KYC v2?** (`make harness-pipeline` levanta Temporal en Docker, customer-profiling-service y kyc-gateway apuntando SÓLO al mock de centrales, y deja la base local lista; `make harness-pipeline-run CASES=1,3` corre OTP v2 → datos personales v2 → workflow y lee `users`; `A=stop` lo baja). ⚠ El `config.yaml` del repo de kyc-gateway en la máquina apunta a las centrales REALES: el launcher genera la suya en `.runs/pipeline-local/` y no arranca si nombra un host que no es local. Sólo local: en qa el servicio de perfilamiento es uno y valida con el backend de **develop** (medido el 2026-10-16) |
| `dev/client-reset.ts` | **¿cómo repito el registro con la misma cédula?** (`make harness-client-reset TARGET=… DOC=…` o `PHONE=…`, `APPLY=1`). Da de baja al cliente por la papelera del admin (`pg admin client-disable`) y muestra el antes y el después; qa usa el admin de dev; nunca prod. Los usuarios `TEMP-…` del celular se informan y no se tocan |
| `dev/setting.ts` · `pkg/settings-write.ts` | **¿cómo prendo algo de un comercio para probar?** (`make harness-setting TARGET=… A=set|add|remove|undo`). Local: cualquier setting. Base compartida: sólo agregar o sacar un comercio «PRUEBA AUTO» de las settings de `TEST_SETTING_KEYS` (permiso angosto `setting-de-prueba`, que lleva la clave literal y escribe sólo si nadie la cambió desde que se leyó). Cada cambio deja su foto en `.runs/settings/` y el comando para deshacerlo |
| `dev/walk-wizard.ts` | ¿el FRONT encadena bien las pantallas? (`make harness-walk-wizard`). El detalle: skill `harness-caminador`. Con `JARVIS_CHROME=1` el motor de navegador maneja el Chrome de Miguel por Jarvis en vez de un Chromium, y con `JARVIS_HANDS=1` rellena pero marca cada botón para que lo toque él (`make jarvis-vtex-purchase`) |

### Funciones duplicadas entre runners

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
| `backend-reads.ts` | las lecturas de la base de legacy-backend que una prueba necesita (estado de una cédula, campos, historial de una solicitud, Experian por sucursal, settings entre ambientes, trabajos fallidos, OTP) van por el conector (`bin/pg … --json`), no con SQL propio: una consulta, un lugar |
| `cognito.ts` (`sessionHealth`) | la sesión se juzga por el vencimiento de las cookies, no por el `mtime` del archivo |

## De «Recorridos: cómo se nombra lo que se prueba»

El caminador lo escribe en su log: cada paso termina con su pieza (`⟨tramo común · Oferta⟩`,
`⟨variación Ábaco · Plataformas⟩`, `⟨en casa · Firma⟩`), sacada del mismo `panel/steps.json` que dibuja
el mapa, y al elegir la entidad imprime su recorrido, los campos del formulario de la sucursal y, si la
fecha de nacimiento no se escribe, que la edad se estima. `harness-case` imprime el mismo recorrido bajo cada caso (sin pasos, porque no navega pantallas). En el riel 4 se agrega el paso a paso, con `*` en lo que en `main` está atado a Credifamilia.

El **formulario adicional** sólo lo recorre el caminador (el runner de casos no navega pantallas), en sus dos
ubicaciones: después de elegir la entidad (`dynamic-form/<n>`, el 7 de Motai:
`make harness-walk-wizard TARGET=local CASES='motai:173' CLOSE=1 LAMBDA=1 MANUAL=1`, cierra en 11 con codeudor) y
antes de firmar (`additional-info/<n>`, el 6 de Credifamilia: `CASES='#82e8961e:24'`). Los contesta
`pkg/dynamic-form-answers.ts` con el esquema del loader, y `mock-forms-g2` (:8109) guarda las respuestas como el
servicio real: también en `user_field_values` de la base local, que es donde el backend mira si el formulario
ya se contestó. El formulario 7 y sus ubicaciones se cargaron en local como en producción
(`tablero/tasks/harness/artifacts/base-local-alineada-2026-11-04/formulario-7-motai.sql`, con cómo deshacerlo).

## De «No le creas al verde»

Hay **93 `.catch(() => {})`** en `dev/guided.spec.ts` (medido el 2026-09-02; el 31/7 eran 94 y antes 82 —
si el número te importa, contalo: `grep -c 'catch(() => {})' dev/guided.spec.ts`). El único paso blindado
es el salto a `/lenders`,
que distingue "ventana cerrada" y **tira** (`dev/guided.spec.ts:538-545`); el resto se traga el error.
`shot()` imprime `📸 <archivo>` aunque el screenshot haya fallado (`dev/guided.spec.ts:63-64`).

## De «Cuatro formas de correr un flujo — cuál elegir»

Se diferencian en **qué recorren**, y eso decide qué pueden encontrar. Medido el 2026-09-25 salvo
donde se dice otra cosa:

| camino | qué recorre | qué ve que los otros no | tiempo (local) |
|---|---|---|---|
| **1 · UI** — el panel (`make panel`, :5195). Es el de Miguel | el wizard en una ventana, manejado por una persona | lo que ve una persona: el diseño, la tarjeta del harness, lo que se siente raro | el de quien maneja (una compra por la tienda: 2 min) |
| **2 · navegador sin ventana** — `make harness-walk-wizard ENGINE=browser` | el mismo wizard en Chromium sin ventana: llena y hace clic | el JavaScript de la página: consola, botones que no se habilitan, tarjetas que se despliegan, el visor de PDF, pantallas que no existen | **~3 min por caso** (174–182 s hasta el estado 11), y en paralelo lo mismo |
| **3a · el wizard por HTTP** — `make harness-walk-wizard` (el motor por defecto) | el lado de servidor de cada pantalla (`.data`: loaders, actions, zod), sin navegador | el vínculo con el pedido y el prellenado en ecommerce; un action que redirige a donde no debe | ~20 s por caso (medido el 2026-09-03) |
| **3b · el backend directo** — `make harness-case` | la API del backend, sin front: crea la solicitud, inyecta el riesgo, pide el listado y elige la entidad | qué decide el backend y cómo responde cada entidad: espera, modal, redirect, OTP propio, error | segundos (no medido acá) |

Las diferencias que hacen equivocarse de camino (el resto de la lista sigue en `CLAUDE.md`):

- **Las perillas del cliente.** En 3b cada caso lleva las suyas (`CASES='pullman@score=700;pullman@score=300,income=900000'`),
  y con `LAMBDA=1` también el resto del buró que deciden las reglas: `negatives`, `delinquencies`, `consulted`,
  `cards`, `months` (meses de aportes en Agildata, de donde sale la continuidad) y `maturation=AAAA-MM-DD`. Lo que
  no se dice es **el mismo cliente por defecto del panel** (`CASE_BUREAU_DEFAULTS` en `pkg/risk-lambda.ts`: 13
  meses, 1 consulta, 1 tarjeta, sin negativos ni mora), dictado entero con `dictateCase`. Hasta el 2026-11-02 la
  consola dictaba 8 meses y sólo el score: el resto quedaba en el reporte fijo del mock (59 consultas, ninguna
  tarjeta) y CrediPullman caía en «Segunda oportunidad» donde el panel daba Premium. Las suites aceptan las mismas
  claves, por caso o en `porDefecto`, y pueden afirmar además `categoria` (por entidad, contra `users_category_log`;
  `null` es «ninguna»), `conConsulta`/`sinConsulta` (la compuerta de preaprobación de la tarjeta) y `cupo` (el
  `reason` de `POST /api/loans/lender/available-quota` por entidad, u `ok`: en local la preaprobación la contesta un
  mock que no llama al backend, y sin esto ninguna corrida ejercita las negativas del cupo) y `estadoAnteriores` (el
  estado en que quedan las solicitudes de los pasos previos del mismo cliente), `plazo` (el `fee_number` GUARDADO; sin
  entidad elegida falla, porque la columna nace en 1) y `consulta` (un GET al backend con `{ur}`, `{uid}` o `{lender}`
  en la ruta, con el user-agent de celular del caso: el `http` esperado —200 si no se dice—, `campos` por ruta de punto
  con igualdad exacta y `existen`; un campo ausente es falla, y conviene pedir al menos uno, porque un 200 genérico sin
  campos pasaría) e `imei` (si el equipo quedó inscrito en `user_request_products`: el cierre IMEI y el estándar
  llegan los dos a 11, F-157), `nombreGuardado` (`{"nombres", "apellidos"}`: lo que quedó en `users`, exacto, con Ñ
  y tildes; el runner no lo imprime) y `chequeoNombre` (el `reason` de la última fila de Ágil Data en
  `kyc_name_checks`, o `null`; `adopted` no prueba un cambio, por eso va con `nombreGuardado`; suite `nombres.json`). Arriba de todo, `"preparar": {"perfiles": [{"lender": 77, "perfil": "Premium", "activo": false}]}`
  prende o apaga un perfil (`lender_users_categories.active`), y `"aprobacionManual": [{"lender": 211, "activo": true}]`
  la aprobación manual de una entidad (`lender_requirements.manual_approval`), antes de correr y lo restaura al final, con foto en
  `.runs/profiles/` y comparar-y-cambiar (`pkg/profile-prep.ts`); sólo en una suite con `"ambientes": ["local"]`, y si
  no se pudo restaurar la corrida sale en rojo. El cierre pide el cupo extendido después de la identidad, como el front
  (`post-validation-step.server.ts`): `manual_approval` deja la solicitud en «Pendiente aprobación manual» (30) y
  `rejected` no cierra, porque el front la mandaría a «solicitud cancelada». Un paso con `"cerrar": false` elige la
  entidad pedida y se queda ahí aunque la suite cierre: es como se deja una solicitud hermana abierta. Las suites que
  respaldan reglas de `knowledge/` las nombran en su `nota` y el tema dice con qué suite se comprueba.
  Una suite que depende de los datos de UNA base (qué entidades tiene cada comercio) declara dónde vale con
  `"ambientes": ["local"]` (o `["local", "qa"]`); sin la clave vale en todos. En otro target `harness-suite` no
  corre nada, dice «esta suite vale en: …» y sale **3** (ni verde ni rojo); `harness-regression` y
  `harness-knowledge` la cuentan como «salteada», igual que las que son de otro runner (las `ecommerce*.json` las
  corre `make harness-ecommerce`). La decisión es `pkg/suite-scope.ts`. Medido el 2026-11-03: en qa, 11 de 18
  suites fallaban sin regresión por esto.
  `make harness-knowledge TARGET=local` corre todas las suites que algún tema cita (`SUITE=harness/suites/…` en su
  prosa) y dice, por tema, qué regla sigue en pie; `LIST=1` sólo muestra qué temas tienen suite y cuáles sólo están
  leídos en el código. Es la pareja de `make knowledge-check`: aquél avisa que una fuente cambió, éste contesta si
  la regla sigue siendo cierta corriendo.
  En 3a y 2, `AMOUNT`, el score y el ingreso valen para **toda la tanda**: dos montos distintos son dos tandas.
- **Una prueba que dicta un buró tiene que comprobar que contestó el lambda** (F-139): el backend tiene un respaldo
  silencioso, y ante CUALQUIER respuesta no-2xx del lambda (un 404 de «documento inexistente», un 500) cae al fixture y
  el flujo sigue como si nada. `pkg/loki.ts` → `bureauSources(desde, hasta)` + `bureauSourceProblem(líneas, ['tusdatos'])`
  devuelve el motivo si alguna central cayó al fixture o no dejó su marca `lambda`; reconoce la caída de Experian por
  su mensaje, que no trae marca. Se ancla por ventana de tiempo (las líneas no traen la solicitud): vale en local con
  las pruebas en fila, y tira si Loki no responde (`make harness-obs-up`). Los veredictos de TusDatos se dictan con
  `dictateTusdatosVerdict` (Ágil Data y Mareigua «sin información» para que la cascada llegue). Por ese respaldo,
  «documento inexistente» y «error del proveedor» no se pueden ejercitar en local.
- **Las corridas que cierran agotan el cupo mensual del perfil en local**: cada crédito CreditopX suma a
  `already_used_loan` y el reinicio del día 1 no corre en local. El prevuelo avisa los perfiles agotados del
  comercio (su cupo dará `profile_quota_exhausted` por la base, no por el caso), y
  `make harness-quota-reset TARGET=local APPLY=1` los pone en cero (sin el evento de auditoría del reinicio real).

### Los nombres están en inglés, y los viejos siguen andando

Desde el 2026-09-25 targets, variables y flags están en inglés (`harness-case`, `CASES=`, `--engine
browser`…). ⚠ **Los nombres viejos NO se borran**: las tareas guardan el comando exacto de cada medición,
y sin el nombre viejo no se podría repetir. Los traducen `HARNESS_OLD_TARGETS` y `HARNESS_OLD_VARS` en el
`Makefile`, `pkg/cli-aliases.ts` (flags) y `pkg/env.ts` (variables de entorno, como `E2E_ASESOR_HASH`). Las carpetas `mock-centrales/` y
`comercios/` pasaron a `mock-bureaus/` y `merchant-specs/`.

## De «Dos caminos, y cada uno tiene su dueño»

Los dos usan **la misma** capa de aserción (`pkg/trace.ts`: traza contrastada + `veredicto()` +
`ESTADO_ESPERADO`). No dupliques esa lógica: dos definiciones de «pasó» es como empiezan a derivar. Un
runner PARALELO pide su instancia: `crearTraza({ salida, ancho })`.

**Cómo leer una divergencia:** mismas aserciones, distinto transporte ⇒ si el rápido pasa y el visual
falla, el problema está en el **frontend**. **Pero no al revés:** hay bugs que sólo existen en el visual
(F-50: una cancelación disparada por el routing del wizard). Y un tercer eje que ninguno cubre: **los
esquemas zod del front** —el backend es más laxo, así que la consola puede dar verde con el recorrido
visual roto (F-88)—.

## De «Lo que aprendieron los runners, y vale para cualquiera»

- **Los `.catch` silenciosos se cuentan y se leen**: la mayoría son lecturas cuyo `null` se chequea en la
  línea siguiente. El que viola F-03 es el que se traga el paso que le da sentido a la corrida.
- **Límites del entorno al leer tiempos:** local sirve PHP con `artisan serve` —mide correctitud, no
  capacidad (F-181)— y `qa` es ¼ de vCPU con el ALB cortando a los 60 s (F-180). Ninguno sirve para
  medir carga.

## De «Mocks: arrancá a mano los que nadie levanta»

**Desde el 2026-09-25 el panel es su dueño** (`panel/mocks.ts`, con el registro compartido de 19 en `pkg/mock-registry.ts` y el mismo puerto y
el mismo «para quién» que usa `/api/estado`). Al arrancar, `npm run dev` levanta los que falten y
**adopta** los que ya estaban: un puerto que responde no se mata ni se reemplaza, queda como «otro
proceso». Mientras el panel viva, el que levantó él y se cae se reinicia (tres veces por minuto, después
queda en «se cae al arrancar») y el que tiene el código editado se reinicia solo — el F-87 de abajo deja
de pasar **para esos**. Uno ajeno con código nuevo no se toca: se marca «código nuevo». Al cerrar el panel
se cortan sólo los suyos. Se ve y se maneja en la pestaña **Mocks** de la consola (`?consola=mocks` en la URL del panel),
por `GET /api/mocks` y `POST /api/mocks/<id>/(start|stop|restart)`, y el aviso de «falta» del pie ofrece
**Iniciar** en el lugar. `HARNESS_MOCKS=0` arranca el panel sin tocar ninguno. Lo de abajo sigue valiendo
cuando el panel no está corriendo (los runners por consola).

- `bin/advisor` levanta `mock-preapprovals` siempre (`bin/advisor:120`) y, **solo con target `local`**,
  payvalida + mdm + lenders + forms + **ábaco** + **financial-health** (`bin/advisor:189-199`).
  `mock-redirect` lo levanta `bin/ecommerce` (`bin/advisor:56`). Contra `dev` no se levanta ninguno de
  esos seis. `mock-financial-health` es distinto al resto: **no inventa datos** — lee el usuario
  sintético REAL de la BD local (por eso ocupa el `:4000` que el `.env` del wizard ya apunta). Ver F-70.
- **Si editás un mock, asegurate de que el proceso que corre sea ese código** (F-87). Node no recarga el
  módulo: `start` veía el puerto respondiendo y salía con `✓ ya arriba`, sirviendo la versión anterior — el
  arreglo no se aplicaba y **nada lo avisaba**. `mock-bancolombia` y `mock-corbeta` ya lo resuelven solos:
  publican en `GET /` la huella `codigo` (mtime de su `server.mjs`) y su launcher reinicia si difiere. Los
  otros mocks **todavía no**: ahí reiniciá a mano (`bin/<mock> stop && bin/<mock> start`). Y cuando un
  arreglo "no hace nada", la primera pregunta es si lo que corre es lo que editaste.

## De «Qué es real en cada target»

La tabla, la regla y qué rama sirve cada backend siguen en `CLAUDE.md`. Acá, cómo se llegó a cada cosa.

⚠ Hasta el 2026-08-19, `.env.staging` apuntaba a **qa** (backend `-qa` + `originaciones-qa`) y el
target `staging` medía la rama equivocada. Se partió en dos: `.env.staging` (ahora sí `legacy-backend-stg`
+ `originaciones-stg`) y `.env.qa` (lo que el archivo viejo siempre fue). Para saber qué rama tenés
enfrente sin adivinar: `allowed_document_types` en `GET /api/loans/allied/{hash}` **solo** lo trae `qa`.

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
