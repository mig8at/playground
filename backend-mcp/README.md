# backend-mcp — MCP/CLI para tests de ORIGINACIÓN de crédito

> 🔒 **Repo LOCAL. Nunca se pushea.**

**Herramienta solo-LLM** (servidor **MCP** + CLI espejo, en Go) para que un modelo (Claude Code o
cualquier cliente MCP) **lea rápido la DB y arme casos de prueba** de la originación de crédito.
Standalone: **NO es dependencia de `backend-e2e` ni de `frontend-e2e`** — cada uno hace sus propias ops.

Apunta a **dev por defecto** o a **local** (`--target local`). Hace el camino
`canal → comercio → lender`: número → OTP (bypass) → **inyección de KYC armado** → listado de lenders →
sello **Estado 11** (CreditopX) → **webhook** ecommerce. Sin huella ni llamadas externas (usuarios
sintéticos, sin Experian real, autolimpieza). El **KYC real fue abandonado**: el path es siempre inyección.

## Índice
- [Quickstart](#quickstart)
- [Recetario](#recetario)
- [Comandos / tools](#comandos--tools)
- [Alcance: qué SÍ y qué NO se puede probar](#alcance-qué-sí-y-qué-no-se-puede-probar)
- [Extender a otro comercio/lender](#extender-a-otro-comerciolender)
- [Conceptos](#conceptos-kyc-armado-estado-11-webhook)
- [Seguridad](#seguridad)
- [Troubleshooting](#troubleshooting)
- [Setup de `.env.dev`](#setup-de-envdev) · [Archivos](#archivos)

---

## Quickstart

```bash
cd backend-mcp

# 1. Completá backend-mcp/.env.dev (ver "Setup de .env.<target>" más abajo).
#    Mínimo: E2E_DB_*, E2E_API_BASE_URL, SEED, I_KNOW_THIS_TOUCHES_SHARED_DEV=1, APP_KEY (el del backend de dev).
#    Para correr contra local: backend-mcp/.env.local (mismas claves; en local NO hace falta el guard).

# 2. Compilá.
go build -o creditop-mcp .

# 3. Primera prueba (CLI, vía el wrapper que sourcea .env.<target>):
bash scripts/dev.sh list pullman                 # dev (default): ¿conecta? lista comercios
bash scripts/dev.sh --target local list pullman  # idem contra el legacy local

# 4. El test estrella, de punta a punta, 100% sintético:
bash scripts/dev.sh synth 17f7b360 --ecommerce --notify
```

**Dos formas de usarlo:**
- **CLI** — `bash scripts/dev.sh <comando> [args]`. El wrapper hace `cd backend-mcp`, sourcea `.env.dev`
  y corre `go run . <comando>`. Una sola regla de permiso autoriza todos los comandos dev.
- **MCP** — conectado a Claude Code por stdio (ver [Conectar como MCP](#conectar-como-mcp)). Los mismos
  comandos quedan como **tools tipados**.

---

## Recetario

```bash
# --- Descubrir ---
bash scripts/dev.sh list                         # todos los comercios de dev
bash scripts/dev.sh list pullman                 # filtrar por nombre/slug/hash
bash scripts/dev.sh ecommerce                     # sucursales con credencial ecommerce (handshake)

# --- Flujo SINTÉTICO (sin Experian, sin huella) → arma un caso punta a punta ---
bash scripts/dev.sh synth pullman                          # entrada asesor → lenders
bash scripts/dev.sh synth 17f7b360 --ecommerce             # entrada ecommerce → CrediPullman + Addi
bash scripts/dev.sh synth 17f7b360 --ecommerce --notify    # + sella Estado 11 + dispara el webhook
bash scripts/dev.sh synth 17f7b360 --ecommerce --income=900000 --score=550   # variar el perfil
bash scripts/dev.sh synth 17f7b360 --ecommerce --keep      # NO borrar al final (para inspeccionar)

# --- Inyectar KYC armado sobre un user_request YA creado (ej. el del wizard en /personal-info) ---
bash scripts/dev.sh synth-fill <uReqID> [lender]

# --- Inspeccionar / diagnosticar (read-only) ---
bash scripts/dev.sh branchdiag 17f7b360          # candidatos + group rules de la sucursal
bash scripts/dev.sh grouprules 17f7b360 77       # qué exige el lender para entrar al listado
bash scripts/dev.sh rules 77                     # reglas de categoría (elegibilidad / Estado 11)
bash scripts/dev.sh reqdiag 463538               # estado de un user_request (Estado 11, ecommerce)
bash scripts/dev.sh summary 1031138508           # shape de user_summaries (qué fabricar)
bash scripts/dev.sh cryptocheck                  # ¿el APP_KEY es el de dev? (por HMAC, sin PII)

# --- Webhook a mano ---
bash scripts/dev.sh webhook-server               # mini-server en 127.0.0.1:8787 que imprime cada POST
bash scripts/dev.sh notify 463538                # dispara el webhook sintético de un request (loopback)

# --- Limpieza ---
bash scripts/dev.sh clean                        # borra los sintéticos del seed ({seed}-%-test)
bash scripts/dev.sh clean --identity             # + el cliente de prueba (doc/tel/email)
```

---

## Comandos / tools

Todo está como **tool MCP** (nombre con `_`) y como **subcomando CLI** (nombre corto) — salvo
`webhook-server`, que es solo CLI.

| Tool MCP / CLI | Tipo | Qué hace |
|---|---|---|
| `list_merchants` / `list [q]` | read | Lista comercios de dev (allied + branch + hash). Filtro opcional. |
| `list_ecommerce` / `ecommerce [q]` | read | Sucursales con credencial ecommerce (las únicas que pueden hacer el handshake base64). |
| `ecommerce_url` / `ecommerce-url <merchant> [phone]` | read | Arma la **URL del checkout** (`/ecommerce/{hash}/checkout?o=…&t=…`, contrato base64) que abre el wizard para entrar por ecommerce. Elige una sucursal con credencial del MISMO allied que el comercio; el teléfono va en el billing (= bypass → OTP por últimos 4). |
| `create_asesor` / `create <merchant> [role]` | write | Crea un usuario sintético (rol+comercio+branch), namespaced `{seed}-{rol}-test`. Idempotente. |
| `assign_asesor` / `assign <email\|sub> <merchant> [branchHash] [realSub]` | write | **Asocia un asesor real a un comercio** (para loguearlo en dev por Cognito y entrar al wizard del comercio): matchea la fila `users` por email/cognito_id, setea `allied_id`/`allied_branch_id` (del `branchHash` o resolviendo el comercio) + perfil Comercial. `realSub` corrige el `cognito_id` al **sub real del login web** (clave: el backend resuelve el asesor por ese sub). Crea la fila si no existe. Guarda snapshot `.asesor-snapshot.json` para revert. |
| `revoke_asesor` / `revoke` | write | Revierte el último `assign` con el snapshot (restaura cognito_id/allied/branch/profile previos, o borra la fila si la creó). |
| `scrub_phone` / `scrubphone <tel>` | write | Borra el/los usuarios CLIENTE de un teléfono (cell_phone) + sus user_requests/hijos, para que el próximo `register` cree un **TEMPORAL USER** fresco → el flujo cae en `/personal-info` (no `/lenders`). NUNCA toca asesores (filtra `cognito_id` no nulo). |
| `run_synth` / `synth <merchant> [lender] [--income=N] [--score=N] [--ecommerce] [--notify[=url]] [--keep]` | write | **100% sintético, sin huella ni llamadas externas**: doc ficticio → register → otp(bypass) → **inyecta KYC armado** (identidad + `users.age` + user_summaries + field 87/29/160 + fila Experian `risk_central_user_data` con `data` encriptada) → marketplace (sella **Estado 11**). **RULE-DRIVEN**: si das un `lender`, lee sus group rules (comercio) + category/datacredito rules (lender) y **deriva** el perfil a inyectar (ocupación, ingreso ≥ umbral, edad ∈ rango, género, score ≥ min) + siembra la credencial rt=1. `--income`/`--score` overridean lo derivado. `--notify` dispara el webhook al final. |
| `synth_fill` / `synth-fill <uReqID> [lender]` | write | **Inyecta el KYC armado sobre un user_request YA creado** (ej. el que arma el wizard al llegar a `/personal-info`): identidad (deja de ser TEMPORAL USER) + user_summaries + fields 87/29/160 + fila Experian encriptada — **sin tocar AgilData/Mareigua/TusDatos/Experian**. Luego navegar a `/lenders` muestra las ofertas. Doc sintético único por request. `lender` opcional (deriva el perfil de sus reglas). |
| `notify_ecommerce` / `notify <uReqID> [url]` | write | **Webhook sintético**: replica `processEcommerceTransaction` (POST según `ecommerce_id` + `processed=1` si responde 2xx). Sin `url` usa el **receiver loopback del MCP** (autocontenido). NO firma documentos. |
| — / `webhook-server [addr]` | — | (solo CLI) Mini-server de larga vida (default `127.0.0.1:8787`) que imprime cada POST recibido. |
| `clean` / `clean [--identity]` | write | Borra el namespace del seed (`{seed}-%-test` + requests + hijos), uno a uno por clave. `--identity`/`scrub_identity=true` también borra el cliente de prueba (doc/tel/email). |

**Diagnósticos read-only** (tool MCP + CLI, sin guard, leen config — no PII):

| Tool MCP / CLI | Qué muestra |
|---|---|
| `summary_shape` / `summary [doc]` | Esquema + muestra de `user_summaries` (para aprender el shape a fabricar). |
| `branch_diag` / `branchdiag <hash>` | `have_ctopx`, lenders candidatos de la sucursal, y `group_rules_count`. |
| `group_rules` / `grouprules <hash> [lender=77]` | Las group rules (en AND) que el lender exige para entrar al listado. |
| `lender_rules` / `rules [lender=77]` | `lender_users_category_rules` + `lender_users_categories` (elegibilidad / sello Estado 11). |
| `req_diag` / `reqdiag <uReqID>` | Estado de un user_request: fila + records CreditopX (status 11) + ecommerce_request (`processed`). |
| `crypto_check` / `cryptocheck` | Verifica que `APP_KEY` sea el de dev por HMAC, sin desencriptar PII. |
| `asesor_whois` / `whois <email\|sub>` | Filas `users` que matchean por cognito_id exacto o email (con su `allied_branch_hash`) — para ver a qué comercio está asociado un asesor antes de `assign`. |
| `otp_bypass_phones` / `bypassphones` | Teléfonos de `qa_otp_bypass_phones` (settings de dev) + su OTP (= últimos 4) — para CONSULTAR qué teléfonos pasan el OTP sin código real (solo `APP_ENV` local/development). El runtime usa el quemado en `.flows.json`. |
| `in_platform` / `inplatform` | Lenders **in-platform (rt=2/3)** + comercios que los ofrecen + flag ecommerce — los que el synth PUEDE validar. |
| `lender_offers` / `offers <lender>` | Qué comercios/branches OFRECEN un lender (match por nombre/id) + response_type + ecommerce. |
| `datacredito_rules` / `dcrules <hash> <lender>` | `lender_datacredito_rules` (capa lender rt=1: score/negativos) + si hay credencial de integración. |
| `mode_diag` / `modediag <uReqID> <lender>` | El `allied_mode`/whitelist del request (lo que filtra `filterAvailableLenderIds`). |

### Frontera de testeo sintético (rt=2 vs rt=1)
- **rt=2 in-platform** (CrediPullman, CrediFis X, Mediarte/Motai/DHI X…): la decisión vive ENTERA en legacy → el synth la cumple → **ofrecido + Estado 11**. ✅ Validable.
- **rt=1 integración** (Bancolombia #68/#100): la oferta la gatea la **API EXTERNA del lender** (`PreApprovedLenderService` → `BancolombiaBnpl::validateQuota` → API de Bancolombia), NO las reglas locales. Un usuario sintético no la pasa, por más que cumpla todas las reglas/capacidad locales. ❌ No inyectable (el caso es por-lender; ej. Banco de Bogotá #5 sí aparece).

---

## Alcance: qué SÍ y qué NO se puede probar

> **¿Ya se puede probar TODO legacy-backend con el MCP? No.** El MCP es una herramienta **enfocada a la
> ORIGINACIÓN de crédito**, no un harness general de todo el backend.

**✅ Cubierto y validado (Pullman + CrediPullman, ecommerce, punta a punta):**
- Entrada **asesor** (`register`) y **ecommerce** (handshake base64).
- `numero → otp(bypass) → inyección de KYC armado → listado de lenders`.
- Sello **Estado 11** (aprobación CreditopX) — se sella durante el GET del marketplace.
- **Webhook** ecommerce: `processed=1` + payload, vía atajo sintético al receiver loopback.

**🟡 Funciona pero requiere ajuste por caso (otros comercios/lenders):**
- El **listado** funciona para cualquier comercio. Pero `synth` inyecta un set FIJO de campos
  (`29/160/87` + `age` + un `datacredito` limpio) afinado a las reglas de **CrediPullman**. Otros lenders
  tienen *group rules* y *category rules* distintas → puede que `synth` no los apruebe sin tocar qué se
  inyecta. Usá `branchdiag` / `grouprules` / `rules` para descubrir qué pide cada uno y ajustá
  ([Extender a otro lender](#extender-a-otro-comerciolender)).

**❌ Fuera de alcance (hoy):**
- **Cierre / desembolso REAL** (firma del pagaré con **Netco/Deceval**, externo). Por eso el webhook va por
  atajo sintético — no se ejecuta `authorize` ni se firman documentos.
- **Validar respuestas reales de Experian/centrales** — el KYC real se abandonó; `synth` INYECTA lo que el backend leería, no llama al externo.
- Otros **orígenes** (payment links, integraciones rt=1 end-to-end, cupo rotativo rt=3 completo).
- Otros **dominios** de legacy-backend ajenos a la originación: gestión post-desembolso, pagos, panel
  admin, reportes, etc. **El MCP no los toca.**

---

## Extender a otro comercio/lender

La metodología (la misma que resolvió CrediPullman) es: **diagnosticar → inyectar lo que falte**.

```bash
# 1. ¿El lender es candidato de la sucursal? ¿hay group rules?
bash scripts/dev.sh branchdiag <hash>

# 2. ¿Qué fields exige para ENTRAR al listado? (se evalúan en AND)
bash scripts/dev.sh grouprules <hash> <lenderID>

# 3. ¿Qué exige para el SELLO / elegibilidad de categoría?
bash scripts/dev.sh rules <lenderID>
```

Con eso sabés qué falta. Los puntos de inyección en el código:
- **`setSynthIdentity`** ([db.go](db.go)) — campos de la tabla `users` (gender, `age`, fechas, doc…).
- **`injectIncomeFields`** ([db.go](db.go)) — `user_field_values` (87 ingreso, 29 ocupación, 160 reportado…).
  Agregá los `field_id` que pida `grouprules`.
- **`injectSummary` / `datacreditoData`** ([db.go](db.go)) — `user_summaries` + el `datacredito`
  encriptado (score, negativos, vector TC, capacidad). Ajustá para las `rules` de categoría del lender.

> Si un lender exige un `specific_table`/`column` que synth no setea, o un `field_id` nuevo, agregalo ahí.
> Tip: corré con `--keep` y `reqdiag <uReqID>` para ver el estado real y por qué un lender no aparece.

---

## Conceptos: KYC armado, Estado 11, webhook

**KYC armado (inyección — el KYC real fue abandonado).** El path es `run_synth`/`synth_fill`: evita Experian/centrales — en vez de llamar
al externo, **inyecta** lo que el backend leería. Para CrediPullman (#77, Pullman ecommerce) hay dos gates:
1. **Inclusión** en el listado → *group rules* de la sucursal (ocupación, reportado, ingresos, género y
   **`users.age` 18–82**, una **columna real** que synth setea — el backend la lee por query builder, no
   por el accessor de `date_of_birth`).
2. **Sello Estado 11** → fila `risk_central_user_data` con `data` **encriptada como Laravel**
   (`encrypted:collection`, AES-256-CBC con `APP_KEY`), que [crypto.go](crypto.go) replica. Se sella
   *durante* el GET del marketplace (`stampCreditopXApproval`).

**OTP bypass.** `synth` usa el mecanismo legítimo de QA: el teléfono debe estar en el setting
`qa_otp_bypass_phones`; el **código = los últimos 4 dígitos**. Solo si el backend corre como `APP_ENV`
local/development. Consultá los teléfonos habilitados con `bypassphones`.

**Webhook (`--notify`).** El cierre real (firma del pagaré → `disburse` → `authorize` →
`notifyEcommerceStore`) requiere firma **externa (Netco/Deceval)** — fuera del alcance sintético.
`--notify` replica fielmente `processEcommerceTransaction`: arma el payload según `ecommerce_id`, lo POSTea
y marca `ecommerce_requests.processed=1` **solo si el receiver responde 2xx** (igual que el backend). Por
defecto el receiver es un **loopback del propio MCP** (dev no alcanza tu localhost, pero el POST lo emite
el MCP), así que el ciclo entero queda local y verificable.

---

## Seguridad

- **Target dev (default) o local** (`--target local` / `E2E_TARGET`): config de `.env.<target>`.
- **Los WRITE a dev exigen `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`** (en `.env.dev`); en local no.
- **Nunca borrado masivo** — todo DELETE es por clave (id / doc / tel / email), con FK checks off.
- **Secretos + PII solo en `backend-mcp/.env.dev`** (gitignored). El server lo **autocarga** al arrancar
  (cwd o junto al binario). Nunca se commitea.
- Los usuarios sintéticos usan un **doc ficticio** (rango 2900000000–2999999999, improbable real) y se
  **autolimpian** por corrida (salvo `--keep`).

### Conectar como MCP

```jsonc
{
  "mcpServers": {
    "creditop-dev": {
      "command": "/ruta/abs/playground/backend-mcp/creditop-mcp",
      "cwd": "/ruta/abs/playground/backend-mcp"   // para que encuentre .env.dev
    }
  }
}
```

> Los tools de write quedan sujetos a los permisos del cliente MCP: el classifier puede pedir
> confirmación. No es un bypass de la salvaguarda — es una superficie tipada.

---

## Troubleshooting

| Síntoma | Causa / arreglo |
|---|---|
| `comercio no encontrado` | El query no matchea. Usá el **hash** de sucursal (`list`/`ecommerce`). |
| `token ecommerce no encontrado` | Esa sucursal no tiene `allied_ecommerce_credentials`. Elegí una de `ecommerce`. |
| `otp-validate (¿bypass?)` falla | el teléfono del synth no está en `qa_otp_bypass_phones`, o el backend no corre como `APP_ENV` local/development. Verificá con `bypassphones`. |
| `lenders: []` o falta CrediPullman | Revisá `grouprules`/`rules` del lender — falta inyectar algún field. Probá `--keep` + `reqdiag`. |
| `datacredito_forged` ≠ `ok` | Falta `APP_KEY` en `.env.dev`, o no hay risk_central Experian. Verificá con `cryptocheck`. |
| `notify` deja `processed: 0` | El receiver no respondió 2xx (igual que el backend real). Con loopback no debería pasar. |
| Estado 11 no se sella | El `datacredito` forjado no pasa las `rules` de categoría, o `available_amount`=0. Revisá `rules <lender>`. |
| `i/o timeout` al conectar | VPN/red hacia la DB de dev. Reintentá. |

---

## Setup de `.env.dev`

Hay dos perfiles: `.env.dev` (default) y `.env.local` (`--target local`), con las mismas claves. Vars que usa el MCP:

| Var | Para qué |
|---|---|
| `E2E_DB_USER/PASS/HOST/PORT/NAME` | Conexión MySQL al target (dev RDS o local). |
| `E2E_API_BASE_URL` | Base del legacy (vhost); dev `http://legacy-backend.inertia-develop/api`, local `http://localhost/api`. |
| `SEED` | Namespace de los sintéticos (`{seed}-%-test`, doc sintético determinístico). |
| `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` | Guard obligatorio para WRITE en **dev** (en local no aplica). |
| `E2E_SCRUB_PHONE`/`E2E_SCRUB_EMAIL` | Identidad puntual a limpiar con `clean --identity` (opcional). |
| **`APP_KEY=base64:…`** | El del backend del target — necesario para que `synth` forje el `datacredito` encriptado. |

---

## Archivos

```
main.go       server MCP (SDK oficial modelcontextprotocol/go-sdk) + modo CLI + tools/comandos
env.go        carga de .env.dev + Config (incl. AppKey) + guard
db.go         conexión + operaciones (resolver comercio/branch, crear asesor, inyectar KYC armado, scrub/clean por clave)
flow.go       HTTP (vhost) + pasos del flujo (register, otp-validate, personal-info, marketplace) + POST externo
ecommerce.go  handshake base64 (phpSerialize + token) → ecommerce-request/create + notifyEcommerce
crypto.go     cifrado/MAC estilo Laravel (Crypt::encryptString, AES-256-CBC) para el datacredito forjado
webhook.go    receiver loopback + mini webhook-server para capturar el webhook sintético
ops.go        operaciones de alto nivel (flow, synth, diagnósticos) compartidas por MCP y CLI
scripts/dev.sh  wrapper CLI: sourcea .env.dev y corre `go run . <args>`
```
