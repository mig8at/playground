---
name: harness-caminador
description: Recorrer el wizard con `make harness-walk-wizard` (motor HTTP o ENGINE=browser) y leer lo que devuelve. Usala cuando una corrida del caminador se trabe en una pantalla, diga «la entidad no salió en el listado», gire sin imprimir, choque con otra tanda, cuando haya que elegir la puerta (asesor, autogestión, ecommerce, QR) o sacar la sesión de asesor por consola, y para los recorridos de BCP (vehicular y por ambiente), el funnel dinámico de RD/SmartPay, o saber qué pantallas vio el cliente.
---

# harness · el caminador del wizard

Cómo funciona `make harness-walk-wizard`, qué muros aprendió a pasar y qué recorridos están probados.
Cuál de las cuatro formas de correr un flujo elegir está en `harness/CLAUDE.md`. Vivía allí hasta el
2026-09-27.

## El caminador del wizard tiene DOS motores, y la diferencia entre ellos ES el diagnóstico

`make harness-walk-wizard` recorre el wizard de punta a punta. Lo que cambia con `ENGINE` es **cómo opera una
pantalla**; todo lo demás —el caso, la siembra, el paralelismo, la traza contra la BD, el forense— es el
mismo código:

| | `ENGINE=http` (default) | `ENGINE=browser` |
|---|---|---|
| cómo avanza | postea al `.data` de la pantalla | Chromium **sin ventana**, clickea |
| qué corre | loaders, actions, middleware, zod | eso **y el JavaScript del cliente** |
| un caso, local | **20 s** | **357 s** (12 pantallas, estado 11) · **~175 s** desde el 2026-09-25 (abajo) |
| 3 en paralelo | 22 s | **357 s**, 3 de 3 en estado 11 |
| evidencia | la traza contra la BD | + consola, red, captura y **traza de Playwright** |

⚠ **La mitad de ese tiempo eran esperas del propio caminador**, medidas el 2026-09-25 con la traza de una
corrida de 276 s: 120 s esperando que cambiara la URL en las dos pantallas con pasos internos
(`solicitar`, `personal-info`), 100 s esperando una casilla-sonda que la pantalla no tenía (10 s × 10) y
30 s esperando en el listado un botón que no existe. Se arreglaron las tres (`screenPrint`, `sondaAparece`,
«Hemos terminado de consultar») y los mismos casos por la tienda bajaron de 360 → 174 s (CrediPullman) y
382 → 182 s (Compucredit con cuota inicial), los dos en estado 11. La traza siguiente mostró otras dos
esperas enteras de 60 s: la pregunta de «confirmación de cupo» (radios de Radix, que no son `input`) y el
diálogo de la firma. Con los radios y los diálogos en la huella, Compucredit bajó a **117 s**.

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

**El canal de ASESOR con navegador: anda, y lo que lo frena no es el motor.** `ENGINE=browser FLOW=merchant`
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

⚠ **Dos tandas lanzadas a la vez se pisan la identidad.** El teléfono y la cédula de cada caso salen de su
índice y de la hora de arranque, así que el caso 0 de dos `harness-walk-wizard` lanzados en el mismo momento
es la MISMA persona: el 2026-09-25 una tanda de Sistecrédito giró 480 s en personal-info mientras otra
usaba su cédula. Casos que tienen que correr juntos van en UNA tanda (`CASES='a;b' PARALLEL=1`).

⚠ **TOPE DE TIEMPO POR CASO (`--timeout`, 360 s por defecto), y no es un lujo.** La primera corrida del canal
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

## La siembra del caminador la pisa el formulario — y por eso «la entidad no salió en el listado» mentía

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

## El login de ASESOR por consola

El canal de asesor (`FLOW=merchant`, y el panel en ese canal) pide una sesión de Cognito. **No hace falta
entrar por el panel para tenerla:**

    make harness-session TARGET=local    # ¿sirve la sesión cacheada? un fetch, sin login: valid · invalid · missing · unreachable
    make harness-login  TARGET=local    # ⚠ abre una ventana: entra a Cognito y deja la sesión en harness/.auth/

- La cuenta sale de `harness/.cognito.json` (o `E2E_COGNITO_USER`/`E2E_COGNITO_PASS`), y la sesión queda en
  `harness/.auth/cognito-state.<clave>.json`. Los N contextos de una tanda **reusan esa misma** (un solo
  login para todos: no se golpea el pool). O sea que «diez asesores en paralelo» son diez sesiones del
  MISMO asesor.
- **Va con ventana a propósito**: el Managed Login corta la automatización headless por fingerprint
  (F-66). En local y dev pide el front :5174 arriba.
- **Local y dev comparten la sesión**: con el front local la clave es `dev` en los dos. Staging y qa tienen
  la suya.
- **El caminador la renueva solo** antes de arrancar si no sirve (abre la ventana y lo avisa;
  `--no-warm` lo apaga), porque el token vive ~4 min y entre renovar a mano y arrancar ya se estaría
  muriendo.
- ⚠ **La sesión manda sobre la sucursal**: `/merchant` redirige al comercio asignado al asesor, no al que
  pidió la corrida. El caminador corta y dice el `dbops assign` que lo movería; no reasigna solo.

## El eje que las corridas por API no cubren: qué VEÍA el cliente

`case.ts` va por API y no abre el navegador — por eso es rápido y paralelizable. Lo que pierde es la
pantalla: una corrida dice «HTTP 500 en `confirm-payment-schedule`» y nadie sabe dónde habría estado
parado el cliente, que es lo que preguntan producto, soporte y QA.

`make harness-screens ENDPOINT=<endpoint>` contesta eso **sin integrar nada**: no maneja el navegador,
no corre nada, no valida. Deriva el recorrido de `apps/loan-request-wizard/app/routes.ts` en `main` —el
router mismo—, así que una pantalla nueva aparece sola y una borrada desaparece sola.

⚠ **Es un techo, no una traza.** Dice qué PUEDE llamar cada pantalla, no qué llamó en tu corrida: sale
de lo que la pantalla importa. La salida distingue los dos niveles —`→` lo llama esa pantalla, `·` está
en un paquete que importa— y no hay que leerlos igual.

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

    make harness-bcp-return TARGET=qa MERCHANT='#a8221e67' TEL=321411214,321411217 \
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

⚠ Y el **recorrido B deja una solicitud NEGADA**, así que fuera de local hay que pedirlo con `DENY=1`.
La base es COMPARTIDA por dev, qa y staging: lo que se ensucie ahí lo ve el equipo.

## El funnel DINÁMICO de RD (CeluRD/SmartPay) camina, y dónde vive el IMEI (2026-09-18)

    E2E_TARGET=local node bin/dbops.ts assign <sub> celurd 1bfb8cd0 <sub>   # la sesión manda sobre la sucursal
    make harness-walk-wizard CASES='#1bfb8cd0:152' FLOW=merchant ENGINE=browser

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

## El vehicular de BCP, caminado con NAVEGADOR de punta a punta (2026-09-18)

Nueve pantallas, ~160 s, y las nueve se pueden MIRAR (`.runs/caminar-…/ultima.png` + la traza):

    make harness-walk-wizard CASES='#50e007e4:207' ENGINE=browser AMOUNT=60000 GATE=aprobado

    solicitar → celular → OTP → datos personales → formulario/pre →
    entidad/simulador → entidad/resultado (gate) → formulario/post → lenders

⚠ **`GATE=` es obligatorio acá y no tiene default a propósito.** `entidad/resultado` no ofrece
«Continuar»: ofrece **«Aprobado» / «Rechazado»**, porque ahí decide una persona. Sin la bandera el
caminador se detiene —no elige por nadie— y con `GATE=rechazado` la solicitud queda **NEGADA**, que en
una base compartida es basura que queda. Mismo criterio que el `--deny` del runner por HTTP.

⚠ **Antes esto no se podía caminar, y ninguna de las razones era del producto:** el botón del formulario
dice «Enviar» y no estaba en el patrón de avance; los selects del vehículo son una CASCADA y se llenaban
en una sola pasada; el trío de fecha los reclamaba sin poder llenarlos; el overlay de `react-scan`
interceptaba los clicks (**F-233**); y `clickAdvance` decía haber clickeado aunque fallara. El
recorrido es la prueba de que las cinco están arregladas.

## Las consolas que acompañan al caminador, en detalle

- `dev/walk-wizard.ts` — **¿el FRONT encadena bien las pantallas?** el wizard entero por sus endpoints `.data` —loaders, actions, middleware, zod— sin navegador y en PARALELO, cada pantalla contrastada con la BD (`make harness-walk-wizard CASES='#hash:lender' CLOSE=1 MANUAL=1`). Es el tercer camino: `case.ts` no ve el front, el panel necesita a alguien clickeando. ⚠ Sigue SÓLO las redirecciones que la app emite —acá hay loaders que ESCRIBEN (`request-canceled` cancela al cargarse, F-50)— y la única URL que arma solo es el handoff a `/confirmation` que el backend le manda al cliente. Lo que no corre: el JavaScript del cliente. Medido 2026-09-02: 11 pantallas y estado 11 en local (73 s) y contra el front desplegado de qa (108 s). El paralelo rinde en los dos: contra qa, 3 en paralelo son 203 s contra ~325 s en fila (el techo ahí es ¼ de vCPU y el ALB cortando a los 60 s, F-180); en local, **3 en 74 s y 6 en 112 s** con `PHP_CLI_SERVER_WORKERS` puesto — sin esa variable eran 237 s para 3, porque `artisan serve` atiende de a una (F-181, y ahí está la receta). El front no fue el cuello en ningún caso; 3 en paralelo en local, los tres llegan a 11 en la BD, pero el tercero pasó de 120 s en la firma y la primera versión lo reportó como «no cerró» —el techo es el PHP local, no el caminador, y por eso ante un timeout ahora vuelve a mirar la BD antes de concluir (F-180: PHP sigue y termina). El protocolo (redirect = 202 con destino en el cuerpo; turbo-stream v3 vendoreado; promesas en líneas `P<id>:`) está deducido y documentado en `pkg/front.ts`
- `dev/screens.ts` — **¿por qué PANTALLAS habría pasado el cliente?** el recorrido del wizard derivado del router en `main`, y al revés: `ENDPOINT=confirm-payment-schedule` → qué pantalla es (`make harness-screens`)
- `dev/posthog-ureq.ts` · `pkg/posthog.ts` — **¿qué VIO el cliente, en el vocabulario del embudo?** la TERCERA fuente (BD = desenlace · Loki = causa · PostHog = recorrido): los eventos de una solicitud y el **cruce** pantalla caminada ↔ evento emitido, con los esperados DERIVADOS del código del front en la rama del target (`make harness-posthog UREQ=… SINCE=…`). El caminador lo dispara **sólo si el caso terminó mal** (`FORENSE=1` lo fuerza), la misma regla que `forensicOnClose` de Loki: medido 2026-09-02, consultarlo en TODA corrida llevó una de 108 s a 128 y otra a 237, y en el caso feliz no aportaba nada que la traza de BD no dijera. ⚠ Al cerrar, la lectura suele venir **PARCIAL** y ahí un evento que falta es atraso de ingesta, no una falta: se etiqueta como tal, porque marcarlo con ✗ manda a buscar un bug donde sólo hay que esperar (pasó con `confirmation`, que llegó dos minutos después). ⚠ Sólo el FRONT emite —`case.ts` es invisible en PostHog— y **local no escribe** (`APP_ENV=local` apaga `getServerPostHog`). ⚠ Un solo proyecto para todos los ambientes y **prod y dev comparten ids**: `loan_request_502057` es julio en prod y hoy en qa, la MISMA persona para PostHog; por eso se filtra por ambiente Y hora de la corrida. ⚠ La hora va en epoch: `toDateTime('…')` la lee en Bogotá (-05:00). ⚠ La ingesta tarda minutos: el caminador espera acotado y dice PARCIAL; el cruce completo se mira después con este comando
- `dev/posthog-errors.ts` — **¿qué PANTALLAS del front se están rompiendo, y con qué?** el canal de LOGS agregado en dos cortes: por pantalla (DÓNDE: archivo + `loader`/`action` + error) y por patrón (QUÉ: los mensajes agrupados por PostHog, así 50 mensajes con distinto id cuentan como UN problema) — `make harness-posthog-errors [DIAS=7]`. ⚠ Sólo `staging` (los deploys de qa y de staging) y `production`: ni dev ni local tienen front desplegado. ⚠ El conteo es FRECUENCIA, no gravedad: un `ZodError` en el loader de una pantalla muy visitada suma más que una firma caída que le pasó a tres personas. Medido 2026-09-02, 3 días de prod: **2.123 `ZodError` del esquema del TEMA del comercio** (`data.colors.primary_color` en null) repartidos en 10 pantallas — es el mecanismo del punto 2 de **F-55** (el `catch` del loader que envuelve el tema del comercio redirige a `request-canceled`); y el loader de `request-canceled` con 82 errores, todos `DELETE /api/identity/request/<n>` → **403**, o sea la pantalla que cancela fallando al cancelar
