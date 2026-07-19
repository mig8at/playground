# backend-e2e — el harness de originación de crédito, sin navegador

CLI en Go (módulo `creditop-tests`) que ejerce la **originación de crédito** de CreditOp end-to-end
pegándole por HTTP+BD al **`legacy-backend`** — sin UI, sin Playwright. Es el par "backend" de
[`../frontend-e2e`](../frontend-e2e/) (mismo stack, pero desde el wizard).

> 🔒 Convención de `playground/`: **commit local, sin push.** Los secretos viven en `.env.local` /
> `.env.dev`, ambos gitignoreados por el `.gitignore` raíz (`.env.*`).

## Por qué existe

Probar un crédito a mano es caro: hay que registrar un teléfono, pasar un OTP, llenar personal +
laboral, esperar que el marketplace liste, elegir entidad, firmar pagaré y cerrar. Y cada
combinación **(canal × comercio × entidad)** se comporta distinto — Pullman auto-inyecta el ingreso,
Corbeta inyecta un laboral dummy, Motai pide IMEI, Credifamilia es asíncrono, Bancolombia decide
afuera. El harness convierte todo eso en **un comando de una línea** que además **imprime el paso a
paso**, así cuando algo se rompe se ve *en qué paso* y *por qué*.

El segundo motivo es documental: `--explain` imprime los pasos del flujo **sin correrlos**. Sirve
para leer qué pasos tiene un flujo antes de tocarlo. Ojo: no es un dry-run puro — ver el gotcha de
`--explain` más abajo.

## Arranque rápido

Requiere el `legacy-backend` local arriba en modo mock (proveedores externos en `fake`):

```bash
cd ~/Desktop/CREDITOP/github/legacy-backend && make up && make mock-all && make restart
```

Después, desde `backend-e2e/`:

```bash
make doctor                                  # 8 checks del setup (MySQL, esquema, OTP bypass, HTTP :80, stash…)
make local vtex pullman credipullman         # flujo ecommerce completo → Estado 11
make scenario smoke                          # el mismo combo, nombrado en presets.json
go run . asesor pullman credipullman --explain   # lee los pasos del flujo sin correrlos (igual necesita MySQL)
```

`make help` lista todos los atajos. `go run . help` imprime el uso del CLI crudo.

## Las dos formas de correr un flujo

Hay **dos entradas** al harness y conviene no confundirlas:

| | Comando unificado (`flow`) | Clásico (`[canal] merchant lender`) |
|---|---|---|
| Invocación | `make local <ecommerce> <merchant> <lender> [state]` → `go run . flow …` | `go run . <web\|asesor\|vtex> <merchant> <lender[,l2,…]>` |
| Entrada | siempre el **contrato base64 unificado** (`/vtex/init`) | la del canal elegido |
| Parametriza | entorno · ecommerce (notificador) · merchant · lender · **state** | canal · merchant · lista de lenders (matriz) |
| Rechazos | sí — `state=rejected\|7\|8` vía simulador de agregador | no |
| Cuándo | matriz ecommerce, webhooks al comercio, probar rechazos | matriz multi-lender, canal asesor, cierres in-platform |

El `state` sólo existe en `flow` porque ahí está la bifurcación: **rt 2/3 + approved → cierre REAL**;
cualquier otra cosa (agregadores rt 0/1, o un state de rechazo) → **simulador**, que cambia el estado
vía Eloquent como haría el webhook del lender y deja que `UserRequestObserver` notifique
(`flow.go:162`). El harness no puede cerrar contra un lender externo, así que simula su respuesta.

```bash
make local vtex pullman credipullman            # cierre real + webhook + settle VTEX
make local vtex pullman bancolombia rejected    # simulador → Estado 6 → observer notifica
make dev vtex 638bd7f1 bancolombia rejected WEBHOOK=https://webhook.site/...
```

`vtex|woocommerce|self` no cambian la entrada: **flipean `ecommerce_type_id`** de la credencial del
comercio (3/1/2) para elegir el notificador — y lo **revierten al salir** (`setEcommerceType`,
`flow.go:94`). Ese revert existe porque el flip manual quedaba pegado.

## Subcomandos reales

Verificados contra el `switch` de `main.go:70`. Todo lo que no matchea un `case` cae al default y se
interpreta como **canal**, o sea `<web|asesor|vtex> <merchant> <lender>`.

**Flujo**
| Comando | Qué hace |
|---|---|
| `<web\|asesor\|vtex> <merchant> <lender[,l2…]>` | compone y corre el flujo; lista con comas = matriz multi-lender |
| `flow <ecommerce> <merchant> <lender> [state]` | comando unificado (arriba) |
| `scenario <name>` · `scenarios` | combo nombrado de `presets.json` · lista los disponibles |
| `aggregator <merchant> [status=11]` | corre la entrada ecommerce completa (init+create+onboarding, **sin** cierre) y después cambia el estado vía el simulador, para que `UserRequestObserver` notifique al comercio |
| `smartpay [branch=3e67eade]` | cadena backdoor + `dynamic-forms/create-user` de SmartPay |

**Descubrimiento / diagnóstico**
| Comando | Qué hace |
|---|---|
| `list` | catálogo desde la BD: comercios (hash·nombre·slug·kind) y lenders (id·nombre·rt) |
| `offer <merchant>` | qué lenders ofrece un comercio (`GET /lenders`) — **no es read-only**: onboardea un usuario de prueba fijo (borrando antes sus filas) y le siembra el perfil aprobado vía tinker, así que necesita Docker |
| `perfilador <merchant> <lender>` | varía **una** dimensión del perfil y observa si el lender se sigue ofreciendo |
| `random [N=5]` | N tripletas válidas al azar (smoke) |
| `comparev2 <merchant>` | onboardea y compara `/lenders` v1 vs `/lenders-v2` |

**Operación** (absorbidos del extinto `creditop-cli`; hoy son Go nativo)
| Comando | Qué hace |
|---|---|
| `prep --merchant X --lender Y [--asesor n] [--branch h] [--ecommerce] [--cognito-id sub]` | siembra precondicionales; imprime `export E2E_*` por **stdout** (para `eval`) y el resumen por stderr |
| `get <user-request\|merchant\|lender> <arg> [--json]` | inspector read-only |
| `create <role> <merchant> [branchHash]` | usuario sintético namespaced (UPSERT idempotente por `cognito_id`) |
| `doctor [--json]` | 8 checks del setup, con fix inline |
| `login [--show-token]` | login Cognito REAL (`E2E_COGNITO_*`); no toca BD |
| `clean [--seed X]` | borra el namespace del seed + el ledger, **uno a uno** |
| `setup` | migra esquema base + seed (BD local nueva) |

**Flags globales:** `--explain` (documenta sin correr los pasos — pero **no** es un dry-run puro, ver
Gotchas) · `--target=local|dev`.

## Cómo está armado

El código se organiza por los **tres ejes** del modelo `[channel] → [merchant] → [lender]`, no por
"un archivo por flujo". Un flujo concreto es la **composición** de los tres.

| Ruta | Qué es |
|---|---|
| `main.go` | CLI: switch de subcomandos, `usage()`, y los runners de offer/perfilador/random/smartpay/setup |
| `flow.go` | el comando unificado `flow` + el assert de notificación al comercio |
| `prep.go` `get.go` `create.go` `clean.go` `doctor.go` `login.go` | un archivo por subcomando de operación |
| `presets.go` + `presets.json` | alias de merchant por entorno, defaults y scenarios nombrados |
| `channel/` | **canal**: `asesor` (register→otp→personal→laboral), `web` (base64), `vtex` (init/settel), + `storewebhook.go` (listener local) |
| `merchant/` | **comercio**: resuelve el branch desde la BD e infiere su `Kind` |
| `lender/` | **lender**: resuelve el lender y despacha el cierre vía la tabla `strategies` |
| `pkg/flow/` | runner de pasos autodocumentados (`Run`, `RunAll`, `Explain`, `Ctx`) |
| `pkg/config/` | conexión local hardcodeada; en `dev` sobreescribe desde env |
| `pkg/database/` | conexión mysql TCP, `Clean`, `Migrations`, asserts |
| `pkg/mocks/` | seeds de perfil (`SeedApprovedProfile`, `SeedRiskProfile`) + `EnsureOtpBypass` |
| `pkg/identity/` | el **seed** (namespace de tus recursos): `SEED` → `CREDITOP_SEED` → archivo → usuario@host |
| `pkg/ledger/` | registro de recursos creados en `.created-resources.json` (gitignored) para que `clean` borre por clave |
| `pkg/client/` | HTTP + los helpers de impresión (colores, `PrintStep`, `PrintOK`) |
| `scripts/flow.sh` | orquesta `doctor → prep → flujo → get [→ clean]` en un solo comando |
| `scripts/dev.sh` | sourcea `.env.dev` y ejecuta `go <args>` — existe para que UNA regla de permiso cubra los comandos contra dev |

### Los tres ejes, en concreto

**Canal** (`channel/channel.go`) — sólo tres son válidos: `web`, `asesor`, `vtex`. Cualquier otra
cosa muere con "canal inválido".

**Comercio** (`merchant/merchant.go`) — se resuelve **contra la BD** por hash exacto (de branch o de
allied) o por `LIKE` sobre nombre de branch / slug / nombre del allied — **NO por id**: un id
numérico cae al `LIKE` y puede resolver a otro comercio (`get merchant 94` devuelve #178 Euromattress
porque matcheó la sucursal "Calle 94", no el allied 94). El `Kind` que se le infiere **sí** tiene ids
hardcodeados (`inferKind`: 158 → motai, 94/189 → pullman; corbeta sale del setting `corbeta_allieds`)
y cambia la entrada:

| Kind | Efecto en el flujo |
|---|---|
| `standard` | flujo estándar |
| `corbeta` | el backend inyecta laboral dummy (field 87 = 1.500.000, field 29 = Empleado) → se omite el formulario |
| `pullman` | Experian Quanto auto-inyecta el ingreso → se omite el laboral **y** se omite el documento en `register` |
| `motai` | renting: flag `isMotaiRenting` en la entrada |
| `ecommerce` | headless, entrada base64 |

**Lender** (`lender/lender.go`) — el dispatch de cierre vive en **UNA** tabla declarativa,
`strategies`, que se consulta en orden y gana el primer match:

| Estrategia | Matchea | Cierre |
|---|---|---|
| `motai` | id 158 o nombre contiene "motai" | Abaco → firma renting (OTP) → `device/register` (IMEI) → `device/disburse` → E11 |
| `credifamilia` | id 24 o nombre | async: radica (status 40) → polling → 41 |
| `bancolombia` | id 68/100 o nombre | motor PLS (BNPL vs Consumo); **fuerza `TestDoc=1998228194`** (sandbox) |
| `revolving` | `response_type == 3` | in-platform con Pagaré Maestro |
| `external` | `response_type == 1` | pre-aprobación mockeada; el cierre real es el portal externo |
| `creditopXDefault` | todo lo demás (rt=2) | originación in-platform hasta Estado 11 |

**Agregar un lender nuevo = una entrada más en `strategies`.** Está separado `creditopXDefault`
para que la tabla represente las *excepciones*, no el caso normal.

## Conceptos que hay que tener claros

**Local está hardcodeado.** Con `--target` ausente o `local`, la conexión **no** sale del `.env`:
sale de `pkg/config/config.go:20`. BD `creditop`/`password` en `127.0.0.1:3306`, API
`http://127.0.0.1:80/api`, y el vhost se fuerza por header `Host: legacy-backend.inertia-develop`
(`client.go:24`) porque Sail responde por vhost. El `.env.local` **sólo** aporta `E2E_*` (ej. `SEED`).
Con `--target=dev` sí se leen `E2E_DB_*` / `E2E_API_BASE_URL` de `.env.dev` — ver
[`DEV-TARGET.md`](docs/DEV-TARGET.md).

**El guard de dev.** `--target=dev` está permitido de entrada sólo en `list`/`get`/`doctor`/`login`/
`create`/`clean`/`scenarios`. El flujo completo se abre **únicamente** exportando
`I_KNOW_THIS_TOUCHES_SHARED_DEV=1` (`main.go:63`). `clean` **no** borra fila por fila: el ledger sí
va uno a uno por clave (`cleanLedger`), pero `cleanNamespace` hace `DELETE … WHERE id IN (…)` sobre
solicitudes, filas hijas, `users` y branches, con `FOREIGN_KEY_CHECKS=0`. **Ojo en dev**: los ids a
borrar se derivan del marcador del seed sólo para los asesores; los **clientes** salen de
`SELECT DISTINCT user_id FROM user_requests` de ese asesor (`clean.go:130,154`), así que arrastra
usuarios reales que no llevan el marcador.

**El seed = tu namespace.** Todo lo que `prep`/`create` siembran queda marcado con tu seed
(`{seed}-adviser-test`, `COM_{seed}`, `BR_{seed}`), y `clean` borra exactamente eso. El seed sale de
`SEED` (`.env.local`/`.env.dev`) → `CREDITOP_SEED` → archivo persistido → derivado de usuario@host.

**OTP — son dos, y se resuelven distinto.** El flujo agrega tu teléfono al setting
`qa_otp_bypass_phones` (`mocks.EnsureOtpBypass`), y eso es lo único común: corta el **envío** a
Twilio en ambos casos. El código en sí:

- **Entrada / onboarding** → se **deriva** del teléfono: últimos **4** dígitos
  (`channel.OtpCode(cfg.TestPhone, 4)` en `channel/channel.go:167`, `web.go:74`, `vtex.go:148`).
- **Pagaré, Motai** → también derivado, pero de **6** dígitos (`lender/closes.go:97`).
- **Pagaré, CreditopX/revolving** (el caso normal rt=2/3) → **no se deriva ningún código**: se hace
  `send-otp` y después se fuerza `otps.validated = 1` con `mocks.ForceOtpValidation`, y se postea
  `authorize` con el `otp_id` (`lender/lender.go:246`, `lender/closes.go:39,63`).

**Perfil aprobado = inyección, no centrales.** El `score` va plano pero la columna `data` de
`risk_central_user_data` va **encriptada**, así que el seed se hace por `php artisan tinker` dentro
del contenedor. El KYC real (Experian/TusDatos/etc.) y los comandos `kyc`/`negative` fueron
**retirados**.

## Gotchas

- **El harness shellea a Docker.** `SeedApprovedProfile`/`SeedRiskProfile` corren
  `docker exec -i legacy-backend-laravel.test-1 php artisan tinker` (`pkg/mocks/mocks.go:37,100`).
  Si tus contenedores se llaman distinto, esos seeds fallan — y sin ellos el cierre no asigna
  categoría ni genera documentos.
- **`--explain` no corre los pasos del flujo, pero tampoco es inerte.** En el camino clásico
  (`<canal> <merchant> <lender>`) necesita **MySQL arriba**: `runDynamic` hace `database.Connect` +
  `merchant.Resolve` + `lender.Resolve` antes de mirar el flag (`main.go:238-252`), y sin BD muere
  con "resolviendo comercio". Y en `runOne` el `if explain` recién aparece **después** de
  `channel.StartStoreWebhook()`, así que con canal `web`/`vtex` el explain **abre el listener en
  :9099**. Sólo el comando `flow` protege ese bloque (y el flip de credencial) con `if !explain`
  (`flow.go:157`) — igual resuelve comercio y lender contra la BD.
- **Puerto 9099** es el listener del webhook de tienda. El harness lo levanta y le pasa al backend
  `http://host.docker.internal:9099/webhook` (`channel/storewebhook.go:31,61`). Si el puerto está
  ocupado, el flujo **no falla**: avisa y deja de verificar el webhook.
- **En `dev` el cluster no alcanza tu :9099** → hace falta un receptor público:
  `WEBHOOK=https://webhook.site/...` (o `E2E_STORE_WEBHOOK_URL`). Si no lo pasás, `flow` cae al
  default de `presets.json`, que es **un token de webhook.site compartido** — sirve para ver que
  llegó, no como evidencia limpia.
- **`prep` imprime a stdout para `eval`.** Si querés leer el resumen, mirá **stderr**; el stdout es
  código shell (`export E2E_...`). Por eso los targets del Makefile hacen `eval "$prep_out"`.
- **Los "❌" de `random` suelen ser gaps de config, no bugs.** `random` filtra a lenders con cierre
  montado — `response_type IN (2,3) OR id IN (24,68,100)` (`main.go:898`) — pero la tripleta puede
  igual fallar por falta de categoría o de asociación de branch.
- **`presets.json` NO cachea la BD.** Es sólo alias de tipeo + defaults; la resolución sigue pegando
  a la BD en runtime. Si un alias queda stale, el comando **falla fuerte** en `merchant.Resolve` —
  nunca en silencio.
- **`make` usa un hack de argumentos posicionales** (`MAKECMDGOALS` + un catch-all `%:` no-op). Si
  inventás un target nuevo, agregalo a `CMDS` en el Makefile o los args se lo comen.
- **El Makefile asume `LEGACY=$HOME/Desktop/CREDITOP/github/legacy-backend`** (línea 34) y toma
  `gen-contract.php`, `.cognito.json` y `dev-tokens.json` de `../frontend-e2e/`. Si esos paths no
  existen, `make ready` degrada (avisa y sigue) en vez de romper.
- El OTP de `generate/validate` real (micro ↔ otp-service) **no tiene endpoint en legacy-backend**,
  así que queda fuera del alcance backend-only en SmartPay.

## Docs vecinos

- [`SUITE.md`](docs/SUITE.md) — manual largo del CLI: requisitos, stashes del legacy-backend, cadena de
  cierre rt=2 paso a paso. El detalle operativo más denso está acá.
- [`VALIDATION.md`](docs/VALIDATION.md) — matriz de qué flujo está 🟢/🟡, con la aserción concreta
  (tabla·columna·status) y el bypass que requiere cada uno. Es la respuesta a "¿esto ya se probó?".
- [`DEV-TARGET.md`](docs/DEV-TARGET.md) — el modelo de seguridad para tocar **dev compartido**: guardas,
  setup del `.env.dev`, y por qué los comandos contra dev los corre el humano vía `scripts/dev.sh`.

⚠️ **Los tres arrastran punteros rotos a `../docs/`**, que fue **borrado** de `main` y absorbido por
el árbol de `context/`. Recuperable con `git show 159906a:docs/<ruta>`. Además `SUITE.md` documenta
los subcomandos `negative` y `kyc`, que **ya no existen** en `main.go` (él mismo lo marca como
histórico al principio). Tomá esos tres docs como referencia de mecanismo, no de CLI vigente — la
fuente de verdad del CLI es `usage()` en `main.go:159`.

Fuera de esta carpeta: [`../frontend-e2e/`](../frontend-e2e/) (el mismo stack desde la UI, con el
panel `npm run dev` en :5195), [`../backend-mcp/`](../backend-mcp/) (inyección `synth`/`synth-fill`,
que reemplazó al KYC real) y [`../context/`](../context/) (el mapa cross-repo y la bitácora de
`findings`).
