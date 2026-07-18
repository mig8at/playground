# Creditop · Frontend E2E

> 📚 **Contexto de negocio** (qué es Creditop, flujos, `response_type`, estados): docs maestros en
> [`../docs/`](../docs/) — empieza por [`../docs/NEGOCIO.md`](../docs/NEGOCIO.md). Para el encadenamiento
> FE↔BE (URL → archivo → endpoint → tabla) ver [`../docs/MAPA-FLUJOS.md`](../docs/MAPA-FLUJOS.md).
> Este README es **tool-specific**: cómo instalar, levantar el stack y correr/escribir Playwright.

> 🔒 **Repo LOCAL. Nunca se pushea.** Versionado local únicamente; sin remoto.

**Suite de tests automatizados de la UI del onboarding** (wizard `loan-request-wizard`) con
**Playwright + TypeScript**. Maneja el wizard real hasta el listado de lenders (`/lenders`).

**Autosuficiente en TS:** hace sus propias operaciones de DB con `mysql2` e **inyecta el KYC armado**
in-process (`pkg/inject` — identidad + summaries + field values + fila Experian cifrada), sin shellear a
`backend-mcp` ni llamar centrales. Apunta a **DEV por defecto** (Cognito real + RDS) o a **local**
(`--local`, legacy en Docker) — el mismo flujo contra `.env.<target>`.

**Entrada principal: el PANEL visual** — `npm run dev` → http://localhost:5195. Elegís comercio, definís
el usuario sintético (nombre/ingreso/score/…), "Preparar + Lanzar ▶" y el panel orquesta todo (assign +
inyección de buró + wizard headed). Por debajo shellea `bin/asesor` + `bin/dbops.ts` (que siguen
disponibles como plumbing por terminal: §2b, `make run/auto`). La sesión Cognito se CACHEA en
`.auth/cognito-state.json` → el Hosted UI solo aparece la primera vez (o cuando expira el refresh token).

Hay además specs sueltos de contrato/UI (§3–§6), varios todavía `test.fixme` — algunos heredados del
modo mock-local (`X-Fake-Scenario`).

---

## 1. Setup inicial

Pre-requisitos: Node 20+ y npm.

```bash
cd frontend-e2e
npm install
npx playwright install chromium    # baja el browser que Playwright usa (projects:[chromium])
```

Dependencias: `@playwright/test` (tests) + `mysql2` (acceso a DB del harness) — ver `package.json`.
Node 22.18+/23.6+ corre los `.ts` de `bin/` directo (type stripping), sin `tsx`.

---

## 2. Arrancar lo que el suite necesita

> El flujo principal (**§2b**, dev por defecto) **no** necesita levantar nada local: usa el RDS de dev + el
> wizard que `bin/asesor` levanta solo. Lo de abajo es para `--local` y para los specs de contrato/UI que
> corren contra el legacy LOCAL en modo mock.

En terminales separadas:

```bash
# Terminal 1 — legacy-backend en MODO MOCK (backend PHP real, recursos externos en fake)
cd ../../github/legacy-backend
make up && make mock-all && make restart
# → API en http://localhost (vhost legacy-backend.inertia-develop). Ver docs/local-dev.md.

# Terminal 2 — wizard (loan-request-wizard)
cd ../../github/frontend-monorepo/apps/loan-request-wizard
pnpm dev
# → http://localhost:5174
# 'pnpm dev' = react-router dev (React Router/Remix sobre Vite con SSR; port 5174 en vite.config.ts).
# El SSR es por qué injectFakeScenario intercepta **/* y no solo las llamadas al backend.
```

**Configuración del wizard** (`apps/loan-request-wizard/.env.local`):

- `VITE_API_URL=http://localhost` — apunta al legacy local. **Imprescindible** o la UI da timeouts.
- `VITE_ONBOARDING_FORM_SERVICE=http://localhost/api/forms-fake` — SmartPay dinámico (ver §7).

> El `.env.local` puede traer aún `DEV_SESSION_KEY` / `X-Dev-Session`: **obsoletos**. El gate de los flujos
> `/merchant/*` hoy es **Cognito** (ver §7), no el dev-session.

Pre-requisito operativo (legacy-backend): los **bypasses de QA ya están aplicados al working tree**
(stash@{0} incluye bypasses + el FAKE del forms-service de SmartPay). `PdfMapper` requiere `PDF_MAPPER_FAKE=true`.
El detalle de stashes vive en [`VALIDATION.md`](VALIDATION.md) y [`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md).

---

## 2b. Login de asesor contra DEV (`make run/auto asesor`)

Para trabajar contra el **backend de develop** (no local) logueando un asesor por el Cognito real:

```bash
bin/asesor pullman           # MANUAL: login asesor → monto → el browser queda abierto (manejás vos a mano)
bin/asesor pullman auto       # GUIADO: seed cada pantalla, vos das "Continuar"; en /lenders elegís y sigue
bin/ecommerce pullman         # MANUAL, entrando por el checkout de la tienda mock (sin login de asesor)
bin/ecommerce pullman auto    # GUIADO desde la tienda
#   equivalente por make:  make run|auto <asesor|ecommerce> <merchant>   (sin flags: todo headed contra dev)
```

> Sin flags: siempre **headed** contra **dev**. GUIADO siembra cada pantalla y vos das "Continuar"; MANUAL
> te deja en monto con el browser abierto (Inspector de Playwright → Resume ▶ para terminar).

Hay dos ENTRADAS, el resto del flujo es igual:
- **asesor** (`bin/asesor`): login por Cognito Hosted UI → `/merchant/{hash}/solicitar`.
- **ecommerce** (`bin/ecommerce`): arma la URL del checkout (contrato base64, sucursal con credencial del
  mismo allied) con `node bin/dbops.ts ecommerce-url <merchant>`, la abre → el loader SSR crea el
  `ecommerce_request` y redirige a `/solicitar`. SIN Cognito ni asesor. El monto y el teléfono vienen
  PRELLENADOS del contrato (el tel = bypass → OTP por últimos 4). El "volver al comercio" cae en la tienda
  mock (shim local por HTTP), no en un placeholder.

`run`/manual deja la sesión lista para operar a mano (queda en monto); `auto`/guiado además **siembra cada
pantalla y vos avanzás con "Continuar"** hasta `/lenders`, donde elegís el lender y el demo sigue. Qué hace
[`bin/asesor`](bin/asesor):

1. Levanta el wizard (:5174) apuntando a **dev** (`VITE_API_URL=http://legacy-backend.inertia-develop`,
   resuelve por VPN; lee la URL de `.env.dev`); reusa el wizard si ya está arriba (se reinicia solo si
   apuntaba a otro backend).
2. Login por el **Cognito Hosted UI real** (`login.creditop.com`) con las creds de `.cognito.json` (el pool es
   compartido dev+local). El login es independiente del backend.
3. Aterriza en `/merchant/{hash}/solicitar`. El comercio lo decide la **fila del asesor** (no la URL).
4. (`dev/guided.spec.ts`, en GUIADO y MANUAL) **scrub-cliente** (borra el usuario del teléfono con
   `node bin/dbops.ts scrubphone` para que el cliente vuelva a ser "TEMPORAL USER" → caiga en `/personal-info`)
   → monto → **teléfono de prueba** (en `qa_otp_bypass_phones`) → **OTP = últimos 4
   dígitos** (bypass QA) → `/personal-info` → **fill-kyc**: en vez de enviar el form (que dispararía el KYC
   REAL), el spec **inyecta el KYC armado** in-process con `synthFill` ([`pkg/inject`](pkg/inject.ts)):
   identidad + financiera + fila Experian cifrada, **sin AgilData/Mareigua/TusDatos/Experian** → navega a
   **`/lenders`** (loader uReqID-driven) → muestra las ofertas.

Cada fase imprime un **checklist** `○ <fase> …` (pendiente) / `● <fase> <estado> · Ns` (hecha), en bash y en
el spec — si algo se cuelga, la última línea con `○` sin su `●` es el paso exacto.

**Registro de flujos — `.flows.json`** (gitignored, junto a `.cognito.json`): identidad del asesor + datos
de prueba quemados (hashes por comercio + teléfono de bypass), a la mano.

```jsonc
{
  "asesor":   { "email": "...", "sub": "<sub-web-real-del-token>" },
  "otp_bypass_phone": "3131010101",                 // OTP = últimos 4 (0101); debe estar en qa_otp_bypass_phones de dev
  "merchants": { "pullman": { "branch_hash": "e9409aff" }, "motai": { "branch_hash": "f0548728" } }
}
```

`bin/asesor` lee del JSON el `branch_hash` (si el comercio no está, lo resuelve con `node bin/dbops.ts list`
y lo cachea) y el `otp_bypass_phone`, y **carga el permiso al asesor** (asocia su fila `users` al comercio,
con `node bin/dbops.ts assign`) **sólo si todavía no está en ese comercio** — un asesor = un comercio, así que
`auto asesor motai` lo mueve a motai y `auto asesor pullman` lo devuelve. El `sub` debe ser el **sub real del
login web** (el backend resuelve por `x-cognito-identity-id`). Revert del permiso: `node bin/dbops.ts revoke`.
Todas las ops de DB de frontend-e2e están en [`bin/dbops.ts`](bin/dbops.ts) (`whois`/`assign`/`revoke`/
`scrubphone`/`list`/`ecommerce-url`/`synth-fill`) — **TS + `mysql2`, sin backend-mcp**. (Para descubrir más
teléfonos de bypass: `cd ../backend-mcp && go run . bypassphones`.)

> ⚠️ Asociar/cambiar el comercio en **dev** escribe en la BD compartida (guarda `I_KNOW_THIS_TOUCHES_SHARED_DEV`,
> reversible). En **local** (`--local`) no hace falta el guard.

### Las dos ventanas (A / B) — topología por `response_type`

El demo usa **dos dispositivos**, porque el flujo real de CreditopX es de dos dispositivos. La pantalla se
parte siempre en dos mitades ([`pkg/windows.ts`](pkg/windows.ts), `COLS = { A: 0, B: 1 }`) — el tamaño y la
posición son los mismos en todos los specs:

| | Ventana | Qué es | Qué corre ahí |
|---|---|---|---|
| **A** | mitad **izquierda** | el dispositivo del **comercio** (el asesor operando en nombre del cliente) | login Cognito → monto → teléfono → OTP → datos → `/lenders`, y al final queda en el handoff `/continue` (QR de autogestión o "link por WhatsApp") |
| **B** | mitad **derecha** | el **celular del cliente** | lo que le toca al cliente según la rama (tabla de abajo). En CreditopX: `/self-service/{hash}/{ur}/confirmation` → plazos → cronograma → firma del pagaré por OTP → `loan-approved` |

**Ambas se abren desde el arranque** y B espera en un placeholder hasta que haya algo que mostrar.

Cuando A resuelve, **B abre lo que le toca al cliente en esa rama** (el enrutador vive en
[`dev/guided.spec.ts`](dev/guided.spec.ts)):

| Rama en A | Qué muestra B | Por qué |
|---|---|---|
| **rt=2 in-platform** (CreditopX) | `/self-service/{hash}/{ur}/confirmation` → journey real hasta la firma | Handoff genuino de 2 dispositivos: A queda en el QR / link |
| **Modal self-management** (Sistecrédito, Meddipay) | portal del lender ([`mock-bank`](mock-bank/index.html), genérico por `?lender=`) | El modal es el final **para A**, pero el cliente sigue por WhatsApp **en su celular** — también son 2 dispositivos |
| **Redirect externo rt=1** (Bancolombia) | una tarjeta que **explica**, no simula | Ese redirect ocurre de verdad en la **misma ventana A**; mandarlo a B enseñaría un modelo equivocado |
| **Handoff no estándar** | sigue esperando | No hay handoff que mostrar; se sella el estado best-effort |

Cómo se detecta cada rama en modo **manual** (nadie automatiza el flujo, así que B mira a A **por eventos** —
siguen llegando por CDP durante el `page.pause()`): navegación a `/continue`|`/confirmation` → CreditopX;
navegación externa → redirect; y el modal, que aparece **sin navegar**, se detecta con un marcador que emite el
`MutationObserver` inyectado en A. Todo eso está guardado por `seenLenders` (no hay handoff antes de elegir
lender), porque si no el Hosted UI de Cognito —que es una navegación externa al arrancar— dispararía la rama de
redirect, y el copy *"en tu celular"* del OTP dispararía la del modal.

Tres detalles que no son obvios:

- **B no hereda la sesión de A**, a propósito: `/self-service/*` matchea `route(":flow", public-layout.tsx)`
  en el wizard → layout **público**. `requireUserWithSession` solo lo exige `/merchant/*` vía
  `default-layout`. Es el celular del cliente, que en la vida real no tiene la sesión del asesor.
- **La captura de identidad (ADO) está mockeada** en B: es una foto del documento, no automatizable. El spec
  intercepta `**/validation-status` y responde `all_completed: true` para que el journey avance. La firma del
  pagaré sí es real (OTP), usando el teléfono de bypass.
- **A también usa user-agent de iPhone**: el wizard gatea validación y `loan-approved` por
  `onlyMobileValidation` — con UA de escritorio responde 403 y el loader queda en blanco.

---

## 3. Correr los tests

```bash
# Todos los tests (chromium headless). Los muchos test.fixme se reportan como "fixme", no fallan.
npm test

# Modo headed (ver el browser)
npm run test:headed

# UI mode (recomendado mientras se escribe un test nuevo)
npm run test:ui

# Debug paso a paso
npm run test:debug

# Reporte HTML del último run
npm run show-report

# Un spec concreto que SÍ corre verde:
npx playwright test e2e/triplet.spec.ts
npx playwright test merchant/corbeta.spec.ts
```

> ⚠️ **`npm test` ejecuta muchos `test.fixme`** (placeholders pendientes — ver §6). Aparecen como `fixme`
> en el reporte, **no** como pasados ni como fallados. No esperes que "todo verde" signifique cobertura total.

> ⚠️ El script `test:onboarding` de `package.json` apunta a `tests/onboarding`, carpeta que **NO existe**
> (el `testDir` real es `.`). Script roto; pendiente de eliminar.

Cuando algún test falla, Playwright guarda automáticamente:
- `test-results/<test>/trace.zip` — trace navegable (`npx playwright show-trace <path>`).
- `test-results/<test>/screenshot.png` — captura del momento del fallo.
- `test-results/<test>/video.webm` — grabación completa del recorrido.

Bajo `CI`, la config usa `retries` y el reporter de GitHub (`playwright.config.ts:30-34`).

---

## 4. Estructura — por ejes, espejo de `backend-e2e`

Organizado por los **tres ejes** del modelo `canal → comercio → lender` (igual que
`backend-e2e/{channel,merchant,lender,pkg}`), pero el "motor" es Playwright manejando el wizard:

```
frontend-e2e/
├── playwright.config.ts          ← testDir: '.', ignora _scratch/, project chromium
├── bin/dbops.ts                  ← CLI de ops de DB (whois/assign/revoke/scrubphone/list/ecommerce-url/synth-fill)
├── pkg/                          ← infra (≈ backend-e2e/pkg)
│   ├── db.ts                     ← pool mysql2 + helpers; lee .env.<target> (E2E_TARGET: dev|local)
│   ├── inject.ts                 ← synthFill: inyecta el KYC armado (port de backend-mcp opSynthFill)
│   ├── asesor.ts                 ← whois/assign/revoke/scrubphone (+ snapshot .asesor-snapshot.json)
│   ├── merchants.ts · ecommerce.ts ← resolución de comercio · contrato/URL de checkout
│   ├── laravel-crypt.ts          ← cripto estilo Laravel (encrypt/decrypt) para la fila Experian
│   ├── config.ts                 ← datos de prueba (hashes, teléfonos) + cognitoCreds
│   ├── cognito.ts                ← cognitoLogin(page): maneja el Hosted UI de Cognito
│   ├── account-lock.ts           ← MUTEX de la cuenta de prueba (1827080) — specs mock-local
│   └── mock-control.ts           ← injectFakeScenario: X-Fake-Scenario (specs de contrato/UI mock-local)
├── channel/                      ← eje CANAL: cómo ENTRA el flujo
│   ├── steps.ts                  ← pasos del wizard (amount→phone→otp→personal→employment) + ruteo post-OTP
│   ├── ecommerce-notify.spec.ts ✅ ← notify-store POSTea al process_url de la tienda
│   ├── ecommerce-ui.spec.ts ✅      ← contrato ecommerce (create exige handshake completo)
│   ├── ecommerce-local-real.spec.ts ✅ ← canal web /checkout → … → personal-info (OTP real)
│   ├── otp-subcodes.spec.ts ⏸️ · otp-ui.spec.ts ⏸️       ← contrato/UI OTP (todos fixme)
│   ├── kyc-subcodes.spec.ts ⏸️ · kyc-ui.spec.ts ⏸️       ← contrato/UI KYC (todos fixme)
│   └── smoke.spec.ts ⏸️                                   ← único test = fixme
├── merchant/                     ← eje COMERCIO: comportamiento por partner
│   ├── seed.ts                   ← helpers de seed por SQL/tinker (perfil aprobado, riesgo, estado/lender)
│   ├── corbeta.spec.ts ✅        ← flujo Corbeta UI → /lenders (resto de casos API: fixme)
│   ├── cupo-rotativo.spec.ts ✅  ← flujo del partner → /lenders (oferta rt=3 + API: fixme)
│   ├── pullman-credipullman.spec.ts ✅ ← Pullman/Quanto auto-inyecta → /lenders (cierre #77: fixme)
│   ├── motai-ui.spec.ts ✅ (gated Cognito) ← login Cognito → marketplace Motai
│   ├── smartpay-dynamic.spec.ts ✅ (gated Cognito) ← flujo dinámico completo → /lenders
│   └── motai.spec.ts ⏸️ · credifamilia.spec.ts ⏸️ · pullman-quanto.spec.ts ⏸️ · smartpay-rd.spec.ts ⏸️
├── lender/                       ← eje LENDER: el cierre por UI
│   ├── close.ts                  ← seedAndOfferLender / creditopXClose (helper de cierre por UI)
│   ├── creditopx-close.spec.ts ✅ ← sembrar perfil → marketplace OFRECE CrediPullman #77 (cierre full: fixme)
│   └── README.md                 ← (stale: dice "vacío"; ya hay close.ts + spec verde)
├── e2e/                          ← composición (≈ backend-e2e/main.go)
│   ├── triplet.ts                ← runner composable canal→comercio→lender (override por env)
│   ├── triplet.spec.ts ✅        ← matriz + override E2E_CHANNEL/E2E_MERCHANT/E2E_LENDER/E2E_AMOUNT
│   ├── happy-path.spec.ts ✅     ← amount → phone → otp → personal → laboral → lenders
│   └── marketplace-select.spec.ts ✅ ← el testid lender-action-{id} expone el CTA seleccionable
└── _scratch/                     ← specs dev/manuales (dev-*), excluidos del run por defecto
```

> ✅ = al menos **un test del archivo** corre verde contra el stack real.
> ⏸️ = el archivo es **solo `test.fixme`** (no corre nada).
> **La marca es por-test, no por-archivo**: varios specs ✅ tienen casos `fixme` adicionales (p. ej.
> `corbeta.spec.ts` cubre el flujo a `/lenders` pero sus tests de API quedan `fixme`;
> `creditopx-close.spec.ts` ofrece el #77 pero el cierre completo es `fixme`).
> Los `gated Cognito` **skipean** si no hay `.cognito.json` (no fallan). Ver §6 y
> [`VALIDATION.md`](VALIDATION.md).

### Runtime común: `Flow` + composer

Los specs activos imparten narración paso-a-paso (espejo de `backend-e2e/pkg/flow`) vía
[`pkg/flow.ts`](pkg/flow.ts). La composición declarativa por ejes (`{merchant, channel, lender}` →
`Flow`) vive en [`pkg/composer.ts`](pkg/composer.ts); los pasos atómicos del wizard standard en
[`pkg/wizard-steps.ts`](pkg/wizard-steps.ts) (módulo hoja, sin duplicación). Los specs se corren con
`make test [specs]` / `npx playwright test`; el flujo DEV/local end-to-end con `make auto`/`make run` (bin/asesor).

**Para agregar un comercio / canal / wizard nuevo** (o entender qué se reutiliza y qué es específico),
ver [`../docs/HARNESS-ARQUITECTURA.md`](../docs/HARNESS-ARQUITECTURA.md) (checklist de extensión,
espejado con backend-e2e).

---

## 5. Cómo agregar un test nuevo

### Si querés validar **el contrato del backend** (sin FE)

Hacés requests directos al backend con `request.newContext({ baseURL: config.mockUrl })`, mandás el header
`X-Fake-Scenario` cuando querés forzar un fallo categorizado, y assertás código + sufijo con el helper
tolerante `assertSubcode`. El backend real **NO emite un `error_subcode` top-level** — el shape es
heterogéneo (ver §13 y `pkg/error-shape.ts`), por eso se busca el marker en cualquier parte del body.

```ts
import { assertSubcode } from '../pkg/error-shape';

test('mi escenario nuevo', async () => {
    const api = await request.newContext({ baseURL: config.mockUrl });
    const res = await api.post(/* endpoint */, {
        data: { /* payload */ },
        headers: { 'X-Fake-Scenario': fakeScenarios.kyc.dateMismatch },
    });
    const body = await res.json();
    const r = assertSubcode(body, 'ONB005', expectedSubcodes.kyc.expeditionDateMismatch);
    expect(r.ok, r.debug).toBe(true);
});
```

### Si querés validar **lo que ve el usuario** (UI)

Importás `injectFakeScenario(page, scenario, mockUrl)` (de `pkg/mock-control.ts`) **antes de la primera
navegación** — eso intercepta `**/*` y añade el header a toda llamada del FE al backend (por el SSR del
wizard, no alcanza con interceptar solo el host del backend). Después navegás, llenás formularios y assertás
texto en pantalla.

**Reglas de selectores:**

- ✅ Preferir `page.getByRole('button', { name: /validar/i })`
- ✅ `page.getByLabel(/celular/i)` para inputs con label
- ✅ `page.getByText(/mensaje esperado/i)` para texto visible
- ❌ Evitar `page.locator('.btn-primary')` o XPath — frágiles a refactors de CSS
- 🟡 Si el FE no tiene roles/labels accesibles, agregar `data-testid` en el componente y usar
  `page.getByTestId('...')`. El backlog de testids vive en [`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md).

### Flujos de comercio (`/merchant/*`) con mutex

Si tu test re-apunta la cuenta de prueba a un comercio (Motai/SmartPay), usá `pkg/account-lock.ts`:
`acquireAccountLock()` + `pointAccount(allied, branch)` en `beforeAll`, y restaurar + `releaseAccountLock()`
en `afterAll`. El mecanismo (mutex por `mkdir` atómico, cuenta `1827080`) se detalla en
[`VALIDATION.md`](VALIDATION.md).

---

## 6. Cobertura actual y deuda

Estado **por-test** contra el stack local real. Para el backlog completo y los grupos de `data-testid`
ver [`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md); para el detalle de cada flujo, [`VALIDATION.md`](VALIDATION.md).

### ✅ Corren verde

- **Ecommerce (canal web)**: `channel/ecommerce-notify.spec.ts`, `ecommerce-ui.spec.ts`,
  `ecommerce-local-real.spec.ts`.
- **Comercios**: `corbeta.spec.ts` (flujo a `/lenders`), `cupo-rotativo.spec.ts` y
  `pullman-credipullman.spec.ts` (flujo del partner a `/lenders`), `motai-ui.spec.ts` y
  `smartpay-dynamic.spec.ts` (**gated Cognito** — skipean sin `.cognito.json`).
- **Lender**: `lender/creditopx-close.spec.ts` (siembra perfil y verifica que el marketplace **OFRECE**
  CrediPullman #77).
- **Composición**: `e2e/triplet.spec.ts`, `happy-path.spec.ts`, `marketplace-select.spec.ts`.

### ⏸️ Pendiente (`test.fixme` — hoy **NO** se ejercen)

- **OBS-OTP-02 (API)**: ✅ **2/5 activos + VALIDADOS E2E** (backlog #2): `NO_PREVIOUS_OTP` y `CODE_INVALID`
  pasan contra el stack local. 3 restantes (`CODE_EXPIRED`, `PROVIDER_UNREACHABLE`, `PROVIDER_ERROR`)
  quedan `fixme` razonado: nombres de escenario `expired`/`provider-down`/`provider-5xx` no verificados
  en `HttpFakeRegistrar`. **UI** (`otp-ui.spec.ts`): los 4 tests siguen `fixme`.
- **OBS-KYC-03 (API)**: ✅ **3/6 activos + VALIDADOS E2E**: `EXPEDITION_DATE_INVALID` (31-feb · `checkdate`),
  `DOCUMENT_DUPLICATE` (`findByDocumentAndType`), `ONB030 internal server error` (Experian `server-error`).
  3 restantes (TusDatos: `issue-date-mismatch`, `document-not-found`, `name-mismatch`) quedan `fixme`
  razonado: el partner default (Pullman) corre Experian Quanto, no TusDatos — activarlos requiere usar
  un partner_hash estándar. Aserciones tolerantes vía `pkg/error-shape.ts`. **UI** (`kyc-ui.spec.ts`):
  los 4 tests siguen `fixme`.
- **Smoke**: `channel/smoke.spec.ts` — su único test es `fixme`.
- **Cierre por UI**: `creditopx-close.spec.ts:25` (cierre completo hasta loan-approved) y los casos de cierre
  de `pullman-credipullman` / oferta rt=3 de `cupo-rotativo`. El bloqueador del cierre Creditop X por UI es la
  **config de lender del mirror** (#77 → Wompi hosted; #37 → `/continue?url=null` 404), validado en backend;
  **no** es falta de testids. Detalle en [`VALIDATION.md`](VALIDATION.md).
- **Specs por partner** mayormente `fixme`: `motai.spec.ts`, `credifamilia.spec.ts`, `pullman-quanto.spec.ts`,
  `smartpay-rd.spec.ts`.

### 🔭 Fuera del alcance inicial

- Tests contra staging real (necesita VPN + cuenta de QA).
- CI: el bloque `webServer` (comentado en `playwright.config.ts`) levanta legacy-backend (modo mock) + el
  wizard; descomentarlo + ajustar tiempos si se quiere CI.

---

## 7. Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `E2E_TARGET` | `dev` | Target del harness: `dev` (RDS + Cognito) o `local` (legacy en Docker). Lo setea `bin/asesor` (`--local`/`--dev`); `pkg/db.ts` lee `.env.<target>`. |
| `E2E_BASE_URL` | `http://localhost:5174` | Donde corre el wizard (FE). |
| `E2E_MOCK_URL` | `http://localhost` | baseURL del backend local (specs de contrato/UI mock-local). (`pkg/config.ts`) |
| `E2E_PARTNER_HASH` | `3e67eade` | Hash del aliado para entrar al flujo (allied 94). |
| `E2E_CHANNEL` / `E2E_MERCHANT` / `E2E_LENDER` / `E2E_AMOUNT` | _(unset)_ | Override de la tripleta y el monto en `e2e/triplet.ts`. |
| `E2E_COGNITO_USER` / `E2E_COGNITO_PASS` | de `.cognito.json` | Credenciales Cognito para `/merchant/*` y el flujo asesor. El env **tiene prioridad** sobre el archivo. |
| `CI` | _(unset)_ | Si está seteada, Playwright corre con retries y reporter de GitHub. |

> **Acceso a DB del harness** (`pkg/db.ts` / `bin/dbops.ts`): credenciales + `APP_KEY` en `.env.dev` y
> `.env.local` (gitignored): `E2E_DB_HOST/PORT/NAME/USER/PASS`, `APP_KEY` (cifra la fila Experian) y, en dev,
> `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`.

**Configuración del wizard** (en `apps/loan-request-wizard/.env.local`, **no** son env del harness):

| Variable | Valor | Para qué |
|---|---|---|
| `VITE_API_URL` | `http://localhost` | Apunta el wizard al legacy local. |
| `VITE_ONBOARDING_FORM_SERVICE` | `http://localhost/api/forms-fake` | **SmartPay dinámico**: el wizard llama al forms-service directo; como el microservicio NO se levanta, legacy-backend sirve su contrato como FAKE (`AppServiceProvider::fakeFormsServiceRoutesForLocal`, en stash; submit delega a `userCreateFacade`/DYFS1001). Apuntar aquí + **reiniciar el wizard**. Detalle en [`VALIDATION.md`](VALIDATION.md) §SmartPay. |

### Credenciales para pruebas de asesor (`/merchant/*`)

Los flujos `/merchant/*` (Motai, SmartPay) exigen **sesión Cognito** (el `default-layout` ata la URL al
comercio del usuario y redirige si el hash no coincide). Las credenciales se guardan en **`.cognito.json`**
(raíz de `frontend-e2e`, **gitignored** — nunca se commitea), leídas por `pkg/config.ts` (`loadCognitoCreds`):

```json
{ "user": "asesor@...", "pass": "..." }
```

`pkg/cognito.ts::cognitoLogin(page)` maneja el Hosted UI. Además la **cuenta debe estar ligada al comercio**
en la BD local (`users.allied_id` / `allied_branch_id` apuntando al partner; el re-apuntado lo automatiza
`pkg/account-lock.ts`). Sin `.cognito.json`, los specs de asesor (`merchant/motai-ui.spec.ts:44`,
`smartpay-dynamic.spec.ts:63`) **skipean** (no fallan). El detalle de Cognito + mutex + re-apuntado vive en
[`VALIDATION.md`](VALIDATION.md).

---

## 8. Troubleshooting

**`Error: connect ECONNREFUSED` contra la API** → legacy-backend no está arriba en modo mock. Levantalo con
`cd ../../github/legacy-backend && make up && make mock-all && make restart` (ver `docs/local-dev.md`).

**Tests UI fallan con timeout en selectores** → el wizard no apunta al legacy local. Verificá que
`loan-request-wizard` tenga `VITE_API_URL=http://localhost` en `.env.local` antes de arrancar, y que los
`data-testid` del flujo estén aplicados (viven en `git stash` de frontend-monorepo; backlog en
[`PLAN-PRUEBAS.md`](PLAN-PRUEBAS.md)).

**Specs de `/merchant/*` aparecen como `skipped`** → falta `.cognito.json` (o `E2E_COGNITO_USER`/`PASS`) y/o
la cuenta no está ligada al comercio. Ver §7.

**`browserType.launch: Executable doesn't exist`** → falta el browser de Playwright. Corré
`npx playwright install chromium`.

---

## 9. Filosofía del suite

- **Bug-compatible con producción**: lo que falla aquí debe fallar igual en prod. Si un test pasa contra el
  mock pero el flujo real está roto, es un bug del mock — no del test.
- **Sin garantías mágicas**: estos tests cubren caminos conocidos. Bugs nuevos requieren tests nuevos.
- **Lentos pero claros**: 5-30s por test es aceptable. Cuando un test falla, el video + trace deben mostrar
  exactamente qué pasó.
- **Selectores semánticos**: si Playwright se queja de "ambiguous selector", es señal de que el FE necesita
  un `aria-label` o un `data-testid`, no de que el test esté mal escrito.
