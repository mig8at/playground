# Harness E2E · contexto
> **estado:** al día con main · La infra de PRUEBAS que ejercita la originación punta a punta: **harness** (Playwright/TS), con DOS caminos y una sola definición de «pasó» (`pkg/trace.ts`): el **rápido** (`dev/sweep.ts`, por API sin navegador) y el **visual** (`dev/guided.spec.ts`, el wizard React real con bypasses). Eje central: la **frontera de inyectabilidad** (rt=2/3 in-platform SÍ se inyectan; rt=0/1/4 los decide un tercero). Las reglas operativas del día a día viven en `harness/CLAUDE.md`; acá va lo que hay que SABER del sistema para probarlo.

## Qué es
Cuando necesitás **probar / ejercitar / mockear un flujo de originación** (¿este comercio ofrece este
lender?, ¿el cierre llega a Estado 11?, ¿la notificación a la tienda dispara?, ¿el motor de riesgo
rechaza este perfil?), esta es la herramienta. No es producto: es el arnés que corre el producto contra
un stack local (o dev, con guarda) y **asevera** el resultado contra la BD.

La regla que lo hace posible: el perfil aprobado NO se consigue llamando centrales — se **inyecta**
(`synthFill`, in-process con `mysql2` + la fila Experian cifrada estilo Laravel). El KYC real queda solo
en los specs de contrato negativo. La flota de mocks, sus puertos y quién levanta cada uno: tabla en
`harness/CLAUDE.md` (un mock por muro concreto, con su F-xx).

## Antes de concluir

- **Un lender solo cierra in-platform si está en `lenders_by_allieds` del comercio**: forzar el 77 (de
  Pullman) en otro comercio da **pagaré HTTP 500**. Mirá la oferta primero (`dbops lenders-for`).
- **Muro Wompi (cierre rt=2 por UI) — VOLTEADO (`bin/close-lender`)**: el muro NO era el checkout de
  Wompi (`pkg/wompi-mock.ts` lo intercepta, verificado) sino el **scoring**: un perfil aprobado cae en
  categoría con `min_initial_fee=0` → cuota $0 → botón «Pagar» disabled → nunca llega a Wompi. El fix
  siembra un rt=2 sintético con `min_initial_fee>0` en TODAS las categorías. El cierre backend sigue
  siendo `asesor 3e67eade 77` (fuerza `initial_fee=0`).
- **`IPHONE_UA` obligatorio**: el wizard gatea validación y `loan-approved` por `onlyMobileValidation` —
  con UA de escritorio responde **403** y el loader queda en blanco. A y B usan UA de iPhone.
- **Reuse de puertos**: `bin/asesor` reusa el wizard :5174 y lo reinicia **solo si apuntaba a otro
  backend**; `mock-preapprovals` reusa solo si `MOCK_PA_DELAY_MS` coincide (el env se hornea al bootear).
- **El eje ecommerce se ejercita contra dev, no local** (la entrada del front está PENDIENTE DE MERGE →
  nodo `ecommerce`; F-54). En local el checkout SSR se degrada.
- **Timeouts**: el wizard usa lenders-v1 (pre-aprobación sincrónica lenta) → «Server Timeout» del
  `streamTimeout` (fix por env). `PICK_TIMEOUT` (default 300s) espera tu click por pantalla del guiado.
- **`MoneyInput` pierde `fill()` por hidratación**: `seedField` reintenta tecla a tecla.
- **Mutex de la cuenta 1827080**: Motai y SmartPay la necesitan ligada a comercios distintos;
  `pkg/account-lock.ts` (mkdir atómico) los serializa bajo `fullyParallel` y restaura a Motai al final.
- **SmartPay teléfono internacional** (`+57…`): `create-temporary-user` guarda el phone crudo pero
  `check-user-exists` normaliza a `+`+dígitos — sin el `+` da `BDUS004` (usuario no encontrado).
- **`X-Dev-Session`/`DEV_SESSION_KEY` obsoletos**: el gate de `/merchant/*` hoy es Cognito; el flag
  existe con comentario pero sin consumidor.

## La frontera de inyectabilidad (rt por rt) — el eje central

Qué se puede sellar localmente vs. qué lo decide un tercero. Determina si un flujo es probable E2E o
solo «parcial»:

| response_type | Quién decide | ¿Inyectable? | Hasta dónde llega la prueba |
|---|---|---|---|
| **rt=2 · CreditopX (in-platform)** | 100% en `legacy-backend` | **SÍ** (total) | cierre entero por API (`dev/sweep.ts close`: perfil → lender → pagaré → OTP → authorize → **asserta Estado 11**) y por UI (`bin/close-lender`, ver Gotchas) |
| **rt=3 · Cupo Rotativo** | in-platform, igual que rt=2 | **SÍ** | el ciclo 1 crea `creditop_x_revolving_credits` + Pagaré Maestro → Estado 11; el ciclo 2 **no debe duplicar** el pagaré (esa es la aserción que importa) |
| **rt=1 · Integración (Welli/Meddipay/CeroPay…)** | **API externa del lender** | **NO** | con el host mockeado se valida pre-aprobación + handoff (`pre_approved_lender=true` + `transaction_data`); el cierre real es el portal externo |
| **rt=1 · Bancolombia 68/100** | motor PLS + API del banco | **NO** (parcial) | el canal QR cierra a **estado 25 + código** contra mocks (`dev/qr-corbeta.ts`, `mock-bancolombia`); contra el gateway real, `make harness-sandbox`. → nodo `bancolombia` |
| **rt=4 · Credifamilia 24 (async)** | radicación + polling SOAP | **NO** (async) | se asevera **APROBADO** en `lender_transactions`, no Estado 11 → nodo `credifamilia` |
| **rt=0 · UTM / redirect** | el lender externo, sin retorno | **NO** (simulado) | entrada + `simulator/aggregator-result` (bloqueado en prod) para disparar el observer → nodo `ecommerce` |

Resumen operativo: **lo in-platform (rt 2/3) se inyecta y se sella a Estado 11; lo de integración
(rt 0/1/4) se mockea el host y se valida la pre-aprobación / el handoff, nunca el cierre.**

## Los bypasses del backend viven en STASHES (no en `main`)

Los `Http::fake` de proveedores + el fake de `PdfMapper` los aporta `legacy-backend` en modo mock, y
viven en **stashes locales sin commitear** que tocan `AppServiceProvider.php`.

⚠ **NO están aplicados por default** (working tree limpio en `main`) y **⚠ citá los stashes por
MENSAJE, nunca por índice**: cualquier `git stash` corre todos los números — este doc decía
`stash@{0}`/`{1}` y un día fueron `{3}`/`{4}`.

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
  login web. `bin/asesor` asocia la fila `users` al comercio (`dbops assign`) solo si hace falta — un
  asesor = un comercio; revert con `dbops revoke`.
- **`.flows.json`** (gitignored): identidad del asesor + `merchants.<m>.branch_hash` + teléfono de
  bypass. **`.env.<target>`**: `E2E_DB_*`, `APP_KEY` (cifra la fila Experian).
- **El panel** (:5195) elige comercio, define el sintético y lanza `bin/asesor` con `E2E_INJECT=1`
  (buró invisible) o sin él (buró real). Solo local por diseño (fuerza el target).

**(2026-08-28)** Deriva = commits propios (el codeudor entró al runner — rt=2 ya no pide manos —, la
radicación de Credifamilia cierra con F-168, y config/inyección acompañando). Autodocumentado en los
commits del propio playground.

## Dónde mirar

- `harness/dev/guided.spec.ts` — el demo guiado de 2 ventanas; detección del cierre **por conducta**
  (no por rt); el watcher del banner de error.
- `harness/dev/sweep.ts` — el recorredor headless (`matrix` · `close` · `abaco`); **exit code =
  veredicto**.
- `harness/pkg/trace.ts` — la única definición de «pasó»: traza contrastada + `veredicto()` +
  `ESTADO_ESPERADO`. No duplicarla en ningún runner.
- `harness/pkg/inject.ts` — `synthFill` · `harness/pkg/laravel-crypt.ts` — la cripto de la fila
  Experian · `harness/pkg/db.ts` — pool mysql2 + `assertWriteAllowed` (el guard de dev).
- `harness/pkg/windows.ts` — fuente única del tiling A/B (CDP), `IPHONE_UA`.
- `harness/pkg/cognito.ts` — Hosted UI + caché de sesión · `harness/pkg/asesor.ts` —
  whois/assign/revoke/scrubphone.
- `harness/panel/server.ts` — el panel; `harness/create3.ts` — fabrica 3 lenders Motai sintéticos
  clonando el 62.
- Estado por-spec (qué corre verde y qué es `fixme` y por qué): `harness/docs/VALIDATION.md` — no se
  replica acá porque envejece con cada corrida.

## Lo que NO está verificado
- El flujo ecommerce por UI en local sigue degradado (SSR `process.env.VITE_API_URL`); el cierre Motai
  por UI (marketplace ofreciendo el 158 + testids) sigue pendiente — validado solo por API.
