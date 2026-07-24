# frontend-e2e · el arnés que MANEJA el wizard

> Harness de pruebas del onboarding de CreditOp: **Playwright + TypeScript manejando el wizard real**
> (`loan-request-wizard`, :5174) de punta a punta — desde el monto hasta el cierre del crédito.
> Su hermano headless es [`../backend-e2e`](../backend-e2e) (Go, mismo modelo, sin navegador).

> 🔒 **Repo LOCAL. Nunca se pushea** (convención de `playground/`: commit local, sin remoto).

## Por qué existe

Probar un flujo de originación a mano cuesta 10 minutos y es irrepetible: hay que loguear un asesor por
Cognito, conseguir un teléfono que bypasee el OTP, pasar un KYC que llama a centrales reales (Experian,
TusDatos, AgilData, Mareigua) y esquivar media docena de proveedores externos que en local no resuelven.

Este harness **corta todo eso sin falsear el producto**:

- El perfil aprobado **no se consigue, se inyecta**: `pkg/inject.ts::synthFill` escribe identidad +
  summaries + field values + **la fila Experian encriptada** (cripto Laravel portada en
  `pkg/laravel-crypt.ts`) directo en el `user_request`. El wizard de ahí en adelante corre REAL.
- Lo que no se puede automatizar (foto del documento / ADO, checkout hosted de Wompi) se **intercepta**,
  no se saltea a ciegas.
- Los proveedores que en local apuntan a hosts `*.fake` tienen su **mock con puerto propio** (§Mocks).

Es autosuficiente en TS: habla MySQL con `mysql2` (`pkg/db.ts`), **no shellea a `backend-mcp`**.

---

## Arranque rápido

Pre-requisitos: **Node 22.18+ (o 23.6+)** y npm — el harness corre `.ts` con node nativo, sin `tsx`
(`panel/server.ts`, `bin/dbops.ts`, `dev/sweep.ts`, `close-lender.ts`, `create3.ts`). Con Node 20 no hay
type-stripping y no arranca ni `npm run dev` (`ERR_UNKNOWN_FILE_EXTENSION`).

```bash
npm install
npx playwright install chromium

npm run dev            # ← LA ENTRADA: Panel del harness en http://localhost:5195
```

El panel es un `node panel/server.ts` sin dependencias. Elegís comercio → definís el usuario sintético
(nombre / documento / edad / ingreso / score / negativos / consultas) → prendés y apagás lenders de la
sucursal → "Preparar + Lanzar ▶". Por debajo shellea `bin/dbops.ts` y `bin/asesor`, y te muestra la
consola de la corrida en vivo.

Por terminal, lo mismo (los bins son *plumbing*, no una segunda entrada):

```bash
bin/asesor pullman              # MANUAL: login asesor (Cognito real) → queda en monto, manejás vos
bin/asesor pullman auto         # GUIADO: siembra cada pantalla, vos das "Continuar"
bin/asesor pullman auto rejected  # 3er arg (solo con auto): success (default) | rejected | pending
bin/ecommerce pullman [auto]    # igual, pero entra por el CHECKOUT de la tienda (sin asesor)
#  equivalente por make:  make run|auto <asesor|ecommerce> <merchant>
```

**El comercio va PRIMERO.** `bin/asesor auto` es el error típico y el script lo rechaza explícitamente.

### Los dos targets

| | `dev` (default) | `local` |
|---|---|---|
| Backend | `legacy-backend.inertia-develop` (**necesita VPN**) | `http://localhost` (Docker/Sail) |
| DB | RDS compartido | mysql local |
| Login | Cognito Hosted UI real (`login.creditop.com`) | el mismo pool (es compartido) |
| Escrituras | **guardadas** por `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` | libres |
| Mocks locales | solo `mock-preapprovals` | + payvalida · mdm · lenders · forms (abaco y pdf-mapper: a mano; redirect: solo entrada ecommerce) |

Lo elige `E2E_TARGET`/`CFE_TARGET` y `pkg/db.ts` lee el `.env.<target>` correspondiente (`.env.dev` /
`.env.local`, ambos gitignored: credenciales de DB + `APP_KEY`, que es lo que cifra la fila Experian).
**El panel fuerza `local`, `dev` o `staging`** y agrega el guard solo cuando el target NO es local.

⚠ **`staging` NO es un entorno aparte.** En `legacy-backend` la API y la BD de staging son **las mismas
que las de dev**; el único con ambiente propio es el **frontend**. Por eso `env/staging.env` son dos
líneas (`E2E_INHERITS=dev` + `E2E_BASE_URL`) en vez de repetir credenciales: copiarlas garantizaría que
deriven el día que roten. Consecuencia práctica: **lo que verificás en BD es el mismo dato en dev y en
staging**, y dos corridas simultáneas se pisan — separalas por teléfono/documento o corré de a una.

---

## La cadena: panel → bin/asesor → guided.spec.ts

Todo el flujo interactivo vive en **un solo spec**: [`dev/guided.spec.ts`](dev/guided.spec.ts) (893 líneas).
`bin/asesor` es el que prepara el terreno y lo lanza; el panel es el que lanza a `bin/asesor`.

Lo que hace `bin/asesor` antes de correr el spec, en orden (cada fase imprime `○ pendiente` / `● hecha`
— si algo se cuelga, **la última línea con `○` sin su `●` es el paso exacto**):

1. **load-permiso** — asocia la fila `users` del asesor al comercio (`dbops assign`), *sólo si no está ya
   ahí*. Un asesor = un comercio: `bin/asesor motai` lo mueve, `bin/asesor pullman` lo devuelve.
2. **scrub-cliente** — borra el usuario del teléfono de bypass para que vuelva a ser "TEMPORAL USER" y
   caiga en `/personal-info`.
3. **backend** — un `curl` al endpoint allied ANTES del cold-boot. Un 5xx del backend mata el dev server
   del wizard (react-router SSR + Node 25: un `UnhandledPromiseRejection` lo tumba), así que se corta acá
   en vez de perder 3 minutos booteando un wizard condenado.
4. **frontend** — levanta el wizard en :5174 con `VITE_API_URL` apuntando al target. Si ya estaba arriba
   contra OTRO backend, lo reinicia (marca el valor en `/tmp/asesor-wizard.api`).
5. `npx playwright test dev/guided.spec.ts --headed --workers=1`.

Dentro del spec: monto → teléfono (`qa_otp_bypass_phones`) → **OTP = últimos 4 dígitos** → y en
`/personal-info` la jugada central: en vez de enviar el formulario (que dispararía el KYC REAL), llama a
`synthFill` in-process y navega a `/lenders`. De ahí elegís el lender y el demo ramifica.

### Las dos ventanas (A / B)

El flujo real de CreditopX es de **dos dispositivos**, así que el demo abre dos ventanas en mitades
([`pkg/windows.ts`](pkg/windows.ts) es la fuente única de tamaño y posición — el tiling va por CDP y solo
funciona headed):

| | Qué es | Qué corre ahí |
|---|---|---|
| **A** (izq.) | el dispositivo del **comercio** (el asesor) | login → monto → tel → OTP → datos → `/lenders` → queda en el handoff `/continue` (QR o "link por WhatsApp") |
| **B** (der.) | el **celular del cliente** | espera en un placeholder hasta que A resuelva, y ahí abre lo que le toca al cliente |

| Rama que toma A | Qué muestra B | Por qué |
|---|---|---|
| **rt=2 in-platform** (CreditopX) | `/self-service/{hash}/{ur}/confirmation` → journey real hasta la firma | handoff genuino de 2 dispositivos |
| **Modal self-management** (Sistecrédito, Meddipay) | portal del lender ([`mock-bank/index.html`](mock-bank/index.html), genérico por `?lender=`) | el modal cierra el flujo *para A*, pero el cliente sigue por WhatsApp en su celular |
| **Redirect externo rt=1** (Bancolombia) | una tarjeta que **explica**, no simula | ese redirect ocurre de verdad en la MISMA ventana A; mandarlo a B enseñaría un modelo equivocado |

Tres cosas que no son obvias:

- **B no hereda la sesión de A, a propósito**: `/self-service/*` cae en el layout público del wizard
  (`requireUserWithSession` solo lo exige `/merchant/*`). Es el celular del cliente, que en la vida real
  no tiene la sesión del asesor.
- **A también usa user-agent de iPhone**: el wizard gatea validación y `loan-approved` por
  `onlyMobileValidation` — con UA de escritorio responde 403 y el loader queda en blanco.
- **El ADO (captura de identidad) está mockeado** en B: es una foto del documento, no automatizable. Se
  intercepta `**/validation-status`. La firma del pagaré sí es real (OTP con el teléfono de bypass).

### Registro de datos: `.flows.json` (gitignored)

```jsonc
{
  "asesor": { "email": "…", "sub": "<sub REAL del token web>" },   // el backend resuelve por x-cognito-identity-id
  "otp_bypass_phone": "3131010101",                                 // OTP = 0101
  "merchants": { "pullman": { "branch_hash": "…" }, "motai": { … } }  // 26 comercios cacheados
}
```

Si el comercio no está, `bin/asesor` lo resuelve con `dbops list` y lo cachea solo.

---

## Mocks locales — puertos verificados

Cada uno existe porque un muro concreto lo pedía. Todos: `bin/mock-X [start|stop|status|logs]`.

| Mock | Puerto (env) | Qué destraba | Lo levanta |
|---|---|---|---|
| `mock-preapprovals` | **8095** `MOCK_PA_PORT` | MS de pre-aprobaciones: todas las cards aprobadas con cupo, sin proveedores externos | `bin/asesor` **siempre** (salvo `E2E_REAL_PREAPPROVALS=1`) |
| `mock-redirect` | **8096** `MOCK_REDIRECT_PORT` | shim del redirect de infra `/checkout/{hash}` → wizard, + `/return` (la "tienda" a la que vuelve el cliente) | `bin/ecommerce` |
| `mock-payvalida` | **8097** `MOCK_PV_PORT` | rt=1 Bancolombia (#8, `action = Payvalida`): sin `PAYVALIDA_HOST` la URL sale sin host → cURL error 3 | `bin/asesor` en `local` |
| `mock-mdm` | **8098** `MOCK_MDM_PORT` | IMEI / device-locking de SmartPay (`merchant-gateways.fake`) + los 3 crons de servicing | `bin/asesor` en `local` |
| `mock-lenders` | **8099** `MOCK_LENDERS_PORT` | pasarela de entidades que sí integran (Sistecrédito…). Ruta desconocida → responde 200 y la **loguea en mayúsculas** | `bin/asesor` en `local` |
| `mock-pdf-mapper` | **8100** `MOCK_PDFMAP_PORT` | `vinculacion` de Credifamilia es microservicio **por diseño** (sin fallback Blade) | a mano |
| `mock-forms` | **8101** `MOCK_FORMS_PORT` | schema del flujo DINÁMICO (RD, `country_id=60`) — sin él: "Formulario no encontrado" | `bin/asesor` en `local` |
| `mock-abaco` | **8102** `MOCK_ABACO_PORT` | Ábaco (ingresos gig del renting Motai): solo `init` y `login` — `/results` y `/platforms` ya están resueltos en el código | a mano |
| `mock-financial-health` | **4000** `MOCK_FINHEALTH_PORT` | MS de salud financiera de la pantalla del ASESOR (`financial-profile`, decisión Motai renting/rto). **No inventa**: lee el sintético real de la BD local (ingreso 87, score, `abaco.average_income`). Puerto = el `FINANCIAL_HEALTH_API_URL` que el `.env` del wizard ya trae (F-70) | `bin/asesor` en `local` |

Casi todos aceptan un env para **forzar el camino de error** (`MOCK_*_FAIL=1`, `MOCK_MDM_EMPTY=1`,
`MOCK_PV_CODE≠0000`) y `MOCK_PA_DELAY_MS` para poder VER el loader de las cards.

El backend corre en Docker: apuntalo con **`host.docker.internal:<puerto>`**, no `localhost` (excepto
Payvalida, que en su header dice `localhost`; verificá contra tu `.env` de legacy-backend).

Hay además dos mocks *in-process* que no son servidores: [`pkg/wompi-mock.ts`](pkg/wompi-mock.ts)
(intercepta el checkout hosted de la cuota inicial) y [`pkg/pdf-mock.ts`](pkg/pdf-mock.ts) (sirve un PDF
válido en `sign-documents`, porque en local el bucket S3 es `local-mock` y el visor muestra
"Error al cargar el documento" ×3 → no se puede firmar).

---

## Barrido headless: `dev/sweep.ts`

Probar N comercios × M entidades por UI cuesta minutos por corrida; por API son segundos. `sweep` imita
las llamadas del wizard pantalla por pantalla, **sin navegador**, contra el backend local (default
`E2E_TARGET=local`, pero un `E2E_TARGET` ya exportado en tu shell **GANA** — verificá que no tengas `dev`
exportado antes de barrer, porque sweep siembra uReqs):

```bash
node dev/sweep.ts matrix motai pullman        # conducta de CADA entidad: standBy | modal | redirect | otp-lender | ERROR+causa
node dev/sweep.ts close  motai 168 2000000    # cierre rt=2 entero por API, paso por paso con su HTTP status
node dev/sweep.ts abaco  motai 169            # cadena renting: requiere → init → login(1,2) → results
```

Manda `x-cognito-identity-id` en todas sus llamadas — sin ese header, `update-user-request` **borra el
asesor de la solicitud en silencio** (`corporate_user_id = NULL`) y Ábaco después revienta. Los hallazgos
de estos barridos están numerados en el nodo `findings` del árbol de contexto.

---

## Estructura

Organizada por los **tres ejes** del modelo `canal → comercio → lender`, espejo de `backend-e2e`:

```
frontend-e2e/
├── panel/{server.ts,index.html}   ← LA ENTRADA (:5195) — wrapper fino sobre dbops + asesor
├── bin/                           ← plumbing por terminal
│   ├── asesor · ecommerce         ← el flujo guiado/manual (ecommerce = wrapper con CFE_ENTRY)
│   ├── dbops.ts                   ← ops de DB: whois|assign|revoke|scrubphone|list|ecommerce-url|
│   │                                 synth-fill|estado11|lender-rt|lenders-for|lender-set|lender-sort|flow-id
│   ├── mock-*                     ← la flota (§Mocks)
│   ├── close-lender               ← → close-lender.ts: clona un rt=2 con min_initial_fee>0 en TODAS las
│   │                                 categorías (el muro del cierre era el scoring, no Wompi)
│   ├── panel                      ← = npm run dev
│   └── testids                    ← on|off|status|regen: aplica patches/e2e-testids.patch al monorepo
├── pkg/                           ← infra
│   ├── db.ts (mysql2 + guard) · inject.ts (synthFill) · laravel-crypt.ts (fila Experian)
│   ├── asesor.ts · merchants.ts · ecommerce.ts (contrato base64) · cognito.ts · config.ts
│   ├── windows.ts (A/B) · wompi-mock · pdf-mock · payvalida-mock · mock-control (X-Fake-Scenario)
│   ├── close.ts (cierre rt=2 por secuencia backend) · flow.ts · composer.ts · wizard-steps.ts
│   └── account-lock.ts (mutex de la cuenta 1827080) · error-shape.ts · dynamic.ts (flujo RD)
├── dev/     guided.spec.ts (EL flujo) · sweep.ts (headless) · specs de login/probe
├── channel/ eje CANAL: ecommerce-*, otp-*, kyc-*, vtex-checkout, smoke + steps.ts
├── merchant/ eje COMERCIO: pullman-*, motai*, smartpay-*, corbeta, credifamilia, cupo-rotativo + seed.ts
├── lender/  eje LENDER (cierre por UI): creditopx-close, cierre-x, wompi-close + close.ts
├── e2e/     composición: triplet.{ts,spec.ts}, happy-path, marketplace-select
├── mock-*/  los servidores (server.mjs) + mock-store/ y mock-bank/ (páginas file://)
├── create3.ts  ← LOCAL: crea 3 lenders Motai de prueba (credit/renting/rto). `node create3.ts --clean`
└── _scratch/   specs manuales, excluidos del run
```

---

## Correr los specs sueltos

```bash
npm test                          # playwright test — testDir '.', project chromium
npx playwright test e2e/triplet.spec.ts merchant/corbeta.spec.ts   # los que corren verde
npm run test:ui                   # recomendado mientras escribís uno nuevo
npm run show-report
make test [specs...]              # atajo equivalente
```

⚠ **`npm test` colecta 98 tests en 35 archivos, y ahí adentro entran los `dev/*.spec.ts`** — incluido
`dev/guided.spec.ts`, que es **interactivo** (espera tus clicks hasta 5 min por pantalla) y los de login
contra Cognito. `testIgnore` solo excluye `_scratch/`, `node_modules/`, `playwright-report/` y
`test-results/` — ninguna carpeta de specs reales, así que `dev/` entra igual. Si querés un run
desatendido, pasale rutas.

⚠ Muchos specs son **`test.fixme`** (aparecen como `fixme`, ni pasan ni fallan): "todo verde" ≠ cobertura.
El estado por-test, con el motivo de cada fixme, vive en [`VALIDATION.md`](docs/VALIDATION.md).

Al fallar, Playwright deja `test-results/<test>/{trace.zip,screenshot.png,video.webm}`
(`npx playwright show-trace <path>`). El flujo guiado además saca fotos numeradas a `.auth/`
(`guided-NN-*.png`, y `guided-ERROR-NN` cuando la app muestra su banner de error).

---

## Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `E2E_TARGET` / `CFE_TARGET` | `dev` | target del harness; `pkg/db.ts` lee `.env.<target>` |
| `E2E_BASE_URL` | `http://localhost:5174` | dónde corre el wizard |
| `E2E_MOCK_URL` | `http://localhost` | baseURL del backend local |
| `E2E_PARTNER_HASH` | `3e67eade` | hash del aliado para entrar al flujo |
| `E2E_COGNITO_USER` / `_PASS` | de `.cognito.json` | el env **gana** sobre el archivo; sin ninguno los specs gated **skipean** |
| `I_KNOW_THIS_TOUCHES_SHARED_DEV` | `1` en `.env.dev` | guard de `assertWriteAllowed()` para escrituras a DB compartida |
| `E2E_GUIDED` · `E2E_ENTRY` · `E2E_RESULT` | los setea `bin/asesor` | guiado/manual · cognito/ecommerce · success\|rejected\|pending |
| `E2E_INJECT` · `E2E_STEP_TARGET` · `E2E_AMOUNT` | los setea el panel | inyectar buró sí/no · saltar a monto\|phone\|personal-info\|lenders · monto |
| `E2E_SYNTH_*` | los setea el panel | perfil sintético (INCOME/SCORE/NAME/DOCTYPE/DOC/GENDER/AGE/NEG/CONS/OCC/DOB/EXP/EMAIL) |
| `E2E_REAL_PREAPPROVALS` | `0` | `1` → usa el MS de pre-aprobaciones real (lento, VPN) en vez del mock |
| `E2E_SHOTS` | `1` | fotos del trazo (apagar con `0`) |
| `E2E_PREVIEW` | `0` | tiling A/B; lo pone en `1` `bin/asesor` — con `npx playwright test` no hay preview |
| `E2E_PREVIEW_SLOWMO` | `150` | slow-mo; solo aplica si `E2E_PREVIEW=1` |
| `PANEL_PORT` | `5195` | puerto del panel |
| `CI` | — | activa retries + reporter de GitHub |

---

## Gotchas

- **`/lenders` da "Error al obtener las opciones de financiamiento"** → casi siempre es un **500 de
  `lenders-v2`**, no del harness. En local la causa típica es que falte `H2O_API_HOST` en el `.env` de
  legacy-backend: el profiler ML llama a H2O, `config()` devuelve `null` → `->baseUrl(null)` → **TypeError**
  que ningún `catch (Exception)` atrapa. Fix local (falla rápido y cae al fallback de matrices, que es el
  orden que corre en prod igual): `H2O_API_HOST=http://127.0.0.1:9` + `H2O_API_KEY=local-disabled`.
  El `preflightLenders()` del spec lo detecta ANTES de navegar y te imprime la excepción — sin él no se ve
  nada, porque el loader es **SSR**: el 500 nunca llega al browser como 5xx, llega como HTML del error
  boundary. Y ojo: el health-check de `bin/asesor` pega a `/api/loans/allied/{hash}`, que **responde 200
  aunque `lenders-v2` esté roto** → verde en falso para este fallo.
- **El eje ecommerce está STALE**: según el barrido de findings (F-40), la ruta de checkout ya no existe en
  el wizard de `main` → `bin/ecommerce` y los `channel/ecommerce-*.spec.ts` darían 404 ahí. No verificado
  en esta pasada; tratalo como sospechoso antes de invertir tiempo.
- **`npm run test:onboarding` está roto**: apunta a `tests/onboarding`, carpeta que no existe.
- **Un asesor = un comercio.** Cambiar de comercio en `dev` **escribe en la BD compartida** (reversible,
  con guard). `node bin/dbops.ts revoke` restaura desde `.asesor-snapshot.json`.
- **El scrub del teléfono borra la corrida anterior**: cada arranque hace `scrubphone`, que elimina el
  usuario del teléfono de bypass y arrastra sus solicitudes. Si `lenders-v2` te dice que el uReq no existe,
  suele ser eso.
- **`bin/asesor` mueve el `.env.local` del wizard** a `.env.local.asesor-bak` mientras corre (si lo dejara,
  Vite hot-reloadearía valores fake) y lo restaura en un `trap EXIT`. Si matás el proceso con `kill -9`,
  revisá que haya vuelto.
- **`create3.ts`, `close-lender.ts` y `dbops lender-set` escriben datos sintéticos.** Son reversibles
  (`--clean`, `--clean`, status inverso) pero `lender-set` toca `lenders.status`, que es **global**.
- **`bin/testids`** aplica `data-testid` como capa local sobre el frontend-monorepo (`git apply` sin
  commitear). Si el patch no aplica limpio, el componente cambió: reubicá a mano y `bin/testids regen`.

---

## Docs de esta carpeta

| Doc | Qué aporta |
|---|---|
| [`VALIDATION.md`](docs/VALIDATION.md) | **estado por-test**: qué corre verde, qué es `fixme` y POR QUÉ. Además: fake del forms-service de SmartPay, mutex de la cuenta de prueba, login Cognito y re-apuntado de comercio |
| [`PLAN-PRUEBAS.md`](docs/PLAN-PRUEBAS.md) | backlog accionable: testids pendientes con rutas reales, helpers por construir, orden de trabajo. Y la premisa corregida (el muro del cierre rt=2 no eran los testids, era la config de lender del mirror) |
| [`lender/README.md`](lender/README.md) | ⚠ **stale**: dice "vacío por ahora", pero el eje ya tiene `close.ts` + 3 specs |
| [`mock-forms/schemas/README.md`](mock-forms/schemas/README.md) | cómo bajar el schema REAL de un comercio del flujo dinámico (con VPN) para que `mock-forms` lo sirva en vez del genérico |

**Contexto de negocio** (qué es CreditOp, `response_type`, estados, entidades): el árbol de contexto en
[`../context/`](../context/) — empezá por [`../context/docs/ROUTE-MAP.md`](../context/docs/ROUTE-MAP.md) y el nodo
`harness` (`../context/server/data/flows/harness/doc.md`). El nodo `findings` es la **bitácora de muros
locales** (F-01..F-52): buscá ahí antes de depurar algo que huele a "ya nos pasó".

> ⚠ Varios docs de esta carpeta (`VALIDATION.md`, `PLAN-PRUEBAS.md`, `lender/README.md`) y algunos
> comentarios de specs todavía enlazan `../docs/*.md`. **Esa carpeta fue borrada** de `main` (absorbida por
> el árbol de contexto); son punteros rotos, recuperables con `git show 159906a:docs/<ruta>`.

## Filosofía

- **Bug-compatible con producción**: lo que falla acá debe fallar igual en prod. Si un test pasa contra el
  mock pero el flujo real está roto, el bug es del mock.
- **Mockear lo mínimo, y delatar lo desconocido**: `mock-lenders` responde 200 a rutas que no conoce y las
  loguea en mayúsculas — el próximo muro se documenta solo en vez de aparecer como un error opaco.
- **Lentos pero claros**: 5-30s por test es aceptable. Cuando falla, el video + trace + las fotos de
  `.auth/` tienen que mostrar exactamente qué pasó.
- **Selectores semánticos** (`getByRole`/`getByLabel`/`getByText`). Si Playwright se queja de ambigüedad,
  es señal de que al FE le falta un `aria-label` o un `data-testid`, no de que el test esté mal escrito.
