---
name: harness-local
description: Preparar el ambiente LOCAL para correr el harness y que lo que dé sea cierto. Usala cuando armes o repares local (Docker/sail de legacy-backend, el wizard :5174), cuando los documentos den 404 o no se generen (S3 con MinIO/ministack, AWS_URL, pdf-mapper, DOC_GEN_*), cuando las corridas en paralelo tarden como en fila (PHP_CLI_SERVER_WORKERS), cuando el wizard local muestre «Oops!» o apunte a dev (.env.local), cuando haya que aplicar los stashes de bypasses, sembrar el cliente sintético (synthFill), configurar Cognito/puertos, o levantar Loki local y un 500 no deje logs.
---

# harness · preparar local

Lo que hay que tener armado en local para que una corrida pruebe lo que dice. Las reglas generales del
harness están en `harness/CLAUDE.md`; esto es la receta de cada pieza. Vivía allí hasta el 2026-09-27.

## Setup (Cognito, assign por SUB, puertos)

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

## Los bypasses del backend viven en STASHES (no en `main`)

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

## La inyección (el comando, no la semántica)

`synthFill` (`pkg/inject.ts`) escribe identidad + `user_field_values` (29 ocupación · 87 ingreso ·
160 reportado) + una fila `RiskCentralUserData` con la **fila Experian cifrada** con `APP_KEY`
(`pkg/laravel-crypt.ts`). En el guiado, `personal-info` NO se clickea real (su submit dispara
AgilData/Mareigua/Experian): `synthFill` inyecta y auto-avanza. La **semántica** de esos campos (qué
score pasa, qué regla datacrédito aplica) es turf de `profiling` / `kyc` — acá solo el mecanismo.

## S3 en local: MinIO, o los documentos no existen

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

⚠ **Con LocalStack cambian las DOS, `AWS_ENDPOINT` y `AWS_URL`**, porque el puerto está en las dos y
son puertos distintos (MinIO 9000, LocalStack/ministack 4566). Con sólo el endpoint cambiado, la subida
FUNCIONA y la URL que queda en la base apunta a un puerto donde no hay nadie: el 404 silencioso de
F-174, más difícil de ver porque el archivo sí existe.

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

## Local monohilo: una línea y las corridas en paralelo dejan de hacer fila

Sail sirve el backend con `artisan serve`, que es el servidor embebido de PHP: **una petición a la vez**.
Por eso una tanda en paralelo contra local tardaba lo mismo que en fila y parecía un lock del código
(F-181). El servidor embebido acepta varios workers desde PHP 7.4 y el `ServeCommand` de Laravel 10 **ya
pasa la variable**, así que no hay que cambiar a fpm+nginx ni tocar la imagen. En el `.env` de
`legacy-backend`:

    PHP_CLI_SERVER_WORKERS=6

**Medido el 2026-09-03** con `harness-walk-wizard`, casos idénticos que cierran en estado 11:

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

## Corridas 4× más rápidas — y qué se deja de probar a cambio

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

**Vuelto a medir el 2026-09-03 con `harness-walk-wizard`, y combinado con los workers de PHP** (§«Local
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
El mock acepta cualquier valor. Es config de PRUEBA: no se replica a ningún otro ambiente.

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

## PDF por el mock: toda entidad necesita un proyecto del pdf-mapper, y los runners se lo ponen

Con `DOC_GEN_*=microservice` en el `.env` del backend, los documentos los devuelve el mock del
pdf-mapper (:8100) — pero el backend arma la ruta con `lenders.pdf_mapper_project_slug` y, sin él, tira
`LenderDocumentSettingsMissingException` antes de llamarlo: `sign-documents` da 500. En la base local sólo
CrediPullman lo tenía (puesto a mano), y por eso era la única CreditopX que cerraba. Desde el 2026-09-25
**`wireMockDocProjects()` (`pkg/config.ts`) lo cablea**: el caminador, `case.ts` y el camino visual del
panel le ponen `harness-local` a toda entidad sin proyecto, sólo en local y sólo con los PDF por el mock
(la primera vez fueron 151). El mock acepta cualquier proyecto. En prod ninguna entidad lo tiene: no se
copia nada de allá.

## Las cuatro variables del WIZARD sin las que el vehicular no se ve (2026-09-18)

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

## Observabilidad en local, y un 500 sin logs

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

## El wizard local no arranca sin pnpm

Da
  `Cannot find module '@radix-ui/react-collapsible'` (declarado en `packages/ui/package.json` y en el
  lock, pero no materializado). ⚠ El monorepo usa **pnpm** (hay `node_modules/.pnpm`): un `npm install`
  falla con `Cannot read properties of null (reading 'name')` — sin tocar el lock, pero sin instalar nada.
  Es `pnpm install` en la raíz del monorepo.
