# backend-mcp — MCP/CLI para armar casos de ORIGINACIÓN de crédito

> 🔒 **Repo LOCAL. Nunca se pushea.**

Binario Go (`creditop-mcp`) que es **dos cosas a la vez**: un **servidor MCP por stdio** (23 tools tipados)
y un **CLI** con las mismas ops. Sirve para que un modelo —o vos— **lea la config real de la BD y fabrique
un caso de prueba de originación** sin KYC real: número → OTP (bypass) → **inyección del KYC armado** →
listado de lenders → sello **Estado 11** (CreditopX) → **webhook** ecommerce.

Apunta a **dev por defecto** o a **local** (`--target local`). Standalone: **no es dependencia de
`backend-e2e` ni de `frontend-e2e`**.

## Por qué existe

Probar originación de punta a punta exige que el usuario **tenga buró**. Llamar a Experian/centrales de
verdad no es opción (huella, costo, no reproducible), y el intento de KYC real **se abandonó**. La salida
fue invertir el problema: en vez de llamar al externo, **inyectar en la BD exactamente lo que el backend
leería** — `users.age`, `user_field_values`, `user_summaries` y la fila `risk_central_user_data` con el
`data` **encriptado igual que Laravel**. Ese último punto es el corazón: sin replicar el
`encrypted:collection` (AES-256-CBC con el `APP_KEY` del backend) los lenders CreditopX nunca se ofrecen,
por más que el resto del perfil esté perfecto.

El segundo problema era **saber qué inyectar**. Cada (comercio, lender) pide cosas distintas, así que los
diagnósticos read-only (`branchdiag`/`grouprules`/`rules`/`dcrules`) existen para **leer las reglas** y el
`synth` es **rule-driven**: si le pasás un lender, deriva el perfil mínimo que las cumple.

## ⚠ Dónde encaja hoy (leé esto antes de usarlo)

Buena parte de esta maquinaria **fue portada a TypeScript en `frontend-e2e`** y ese harness ya es
autosuficiente (no shellea acá):

| Necesitás | Usá |
|---|---|
| Manejar el **wizard real** (Playwright, asesor/ecommerce, panel :5195) | `frontend-e2e` — `pkg/inject.ts` es un **port 1:1** de `opSynthFill`, `pkg/laravel-crypt.ts` de `crypto.go`, `pkg/asesor.ts` de `asesor.go`, `bin/dbops.ts` del CLI de ops |
| **Explorar la config** de dev/local (qué lender pide qué, quién ofrece a quién, qué hay en un request) | **este repo** — los diagnósticos no están portados |
| Un caso **sin navegador**, 100% por API, en un comando | **este repo** (`synth`) |
| Exponer todo esto **como tools MCP** a un modelo | **este repo** (es el único que lo hace) |

No es una herramienta muerta, pero tampoco es el único camino: si estás en el harness del wizard,
probablemente ya tenés el equivalente ahí.

---

## Arranque rápido

```bash
cd backend-mcp

# 1. Completá .env.dev y/o .env.local (ver "Config" más abajo). Mínimo:
#    E2E_DB_*, E2E_API_BASE_URL, SEED, APP_KEY (el del backend del target),
#    y en dev I_KNOW_THIS_TOUCHES_SHARED_DEV=1.

# 2. Compilá (verificado: go 1.25.5, `go build` limpio).
go build -o creditop-mcp .

# 3. ¿Conecta? (read-only, por el wrapper que sourcea .env.<target>)
bash scripts/dev.sh list pullman                 # dev (default)
bash scripts/dev.sh --target local list pullman  # legacy local

# 4. El caso estrella, punta a punta, 100% sintético:
bash scripts/dev.sh synth 17f7b360 --ecommerce --notify
```

**Dos formas de invocarlo:**
- **CLI** — `bash scripts/dev.sh <comando> [args]`: hace `cd backend-mcp`, `source .env.<target>` y
  `go run . <args>`. También podés correr `go run . <args>` a mano si ya tenés el entorno.
- **MCP** — el binario **sin argumentos** habla MCP por stdio (`mcp.NewServer` + `StdioTransport`,
  server name `creditop-dev`). Ver [Conectar como MCP](#conectar-como-mcp).

---

## Recetario

```bash
# --- Descubrir ---
bash scripts/dev.sh list                         # comercios (allied + branch + hash)
bash scripts/dev.sh list pullman                 # filtrar por nombre/slug/hash
bash scripts/dev.sh ecommerce                    # sucursales con credencial ecommerce (handshake base64)
bash scripts/dev.sh inplatform                   # lenders rt=2/3 + quién los ofrece → contra qué correr synth
bash scripts/dev.sh offers credipullman          # qué sucursales ofrecen un lender

# --- Flujo SINTÉTICO (sin Experian, sin huella) ---
bash scripts/dev.sh synth pullman                          # entrada asesor → lenders
bash scripts/dev.sh synth 17f7b360 --ecommerce             # entrada ecommerce (handshake base64)
bash scripts/dev.sh synth 17f7b360 --ecommerce --notify    # + webhook (--notify SOLO aplica con --ecommerce)
bash scripts/dev.sh synth 17f7b360 77                      # RULE-DRIVEN: deriva el perfil de las reglas del #77
bash scripts/dev.sh synth 17f7b360 --income=900000 --score=550   # overridear lo derivado
bash scripts/dev.sh synth 17f7b360 --keep                  # NO borrar el cliente al final (para inspeccionar)

# --- Inyectar sobre un user_request YA creado (ej. el del wizard parado en /personal-info) ---
bash scripts/dev.sh synth-fill <uReqID> [lender]

# --- Diagnosticar (read-only, sin guard) ---
bash scripts/dev.sh branchdiag 17f7b360          # have_ctopx + lenders candidatos + group_rules_count
bash scripts/dev.sh grouprules 17f7b360 77       # qué exige el lender para ENTRAR al listado (AND)
bash scripts/dev.sh rules 77                     # reglas de categoría (elegibilidad / Estado 11)
bash scripts/dev.sh dcrules 17f7b360 68          # lender_datacredito_rules + credencial de integración
bash scripts/dev.sh reqdiag 463538               # el request: fila + records CreditopX + ecommerce_request
bash scripts/dev.sh modediag 463538 77           # whitelist del allied_mode (filterAvailableLenderIds)
bash scripts/dev.sh summary 1031138508           # shape de user_summaries (qué fabricar)
bash scripts/dev.sh cryptocheck                  # ¿el APP_KEY es el del target? (por HMAC, sin PII)
bash scripts/dev.sh bypassphones                 # teléfonos de qa_otp_bypass_phones + su OTP

# --- Webhook a mano ---
bash scripts/dev.sh webhook-server               # mini-server 127.0.0.1:8787 que imprime cada POST
bash scripts/dev.sh notify 463538                # dispara el webhook sintético (loopback si no das url)

# --- Limpieza ---
bash scripts/dev.sh clean                        # borra los asesores del seed ({seed}-%-test) + hijos
bash scripts/dev.sh clean --identity             # + la identidad de E2E_SCRUB_PHONE/E2E_CUSTOMER_DOC/E2E_SCRUB_EMAIL
```

---

## Comandos / tools

El CLI acepta **los dos nombres** (kebab y el snake del tool MCP): `branchdiag` == `branch_diag`.

### Reads (sin guard) — la mayoría leen config, pero `summary` devuelve una fila REAL de `user_summaries` (ingresos + datacrédito) y `whois` devuelve email/nombre de usuarios reales. Cuidado al pegar su salida.

| CLI / tool MCP | Qué muestra |
|---|---|
| `list [q]` · `list_merchants` | Comercios: allied + branch + hash. Filtro por nombre/slug/hash. |
| `ecommerce [q]` · `list_ecommerce` | Sucursales con `allied_ecommerce_credentials` — las únicas que pueden hacer el handshake. |
| `ecommerce-url <m> [tel]` · `ecommerce_url` | Arma la URL del checkout (`/ecommerce/{hash}/checkout?o=…&t=…`). Prefiere una branch ecommerce del **mismo allied** que el comercio. Monto default 600000, tel default `3131010101`. |
| `inplatform` · `in_platform` | Lenders **rt=2/3** (in-platform) + comercio/hash que los ofrece + flag ecommerce. |
| `offers <lender>` · `lender_offers` | Qué sucursales ofrecen un lender (por nombre o id) + rt + ecommerce. |
| `branchdiag <hash>` · `branch_diag` | `have_ctopx`, lenders candidatos (`lenders_by_allied_branches`), `group_rules_count`. |
| `grouprules <hash> [lender=77]` · `group_rules` | Las group rules **en AND** que el lender exige para entrar al listado (`field_id`/`operator`/`value` o `specific_table`/`column`). |
| `rules [lender=77]` · `lender_rules` | `lender_users_category_rules` + `lender_users_categories` (elegibilidad / sello Estado 11). |
| `dcrules <hash> <lender>` · `datacredito_rules` | `lender_datacredito_rules` (score/negativos por sucursal) + si hay `lender_allied_credentials`. |
| `modediag <uReqID> <lender>` · `mode_diag` | El `allied_mode` del request y su whitelist `config['lenders']` — lo que filtra `filterAvailableLenderIds`. |
| `reqdiag <uReqID>` · `req_diag` | La fila `user_requests` + `creditop_x_user_requests_records` (5=iniciado, 11=aprobado) + el `ecommerce_request` (`processed`). |
| `summary [doc]` · `summary_shape` | `SHOW COLUMNS` de `user_summaries` + una fila de muestra: el shape a fabricar. |
| `cryptocheck` · `crypto_check` | Recomputa el HMAC de una fila Experian **real** con tu `APP_KEY`. `mac_valid=true` ⇒ la llave es la correcta. No desencripta nada. |
| `whois <email\|sub>` · `asesor_whois` | Filas `users` que matchean por `cognito_id` exacto o email, con su `allied_branch_hash`. |
| `bypassphones` · `otp_bypass_phones` | Teléfonos de `qa_otp_bypass_phones` + su OTP (= últimos 4). Solo válido si el backend corre con `APP_ENV` local/development. |

### Writes (exigen `I_KNOW_THIS_TOUCHES_SHARED_DEV=1` en dev; en local no)

| CLI / tool MCP | Qué hace |
|---|---|
| `synth <m> [lender] [--income=N] [--score=N] [--ecommerce] [--notify[=url]] [--keep]` · `run_synth` | El caso completo. Doc sintético → [handshake ecommerce] → register → otp(bypass) → **inyecta el KYC armado** (identidad + `users.age` + `user_summaries` + fields 87/29/160 + fila Experian encriptada) → GET marketplace (que **sella el Estado 11**). Con `lender`, deriva el perfil de sus reglas y siembra la credencial si es rt≠2/3. Autolimpia el CLIENTE sintético salvo `--keep`. NO revierte: la fila `lender_allied_credentials` sembrada por `ensureLenderCredential` (solo con lender rt≠2/3, copiada de otro comercio) ni la fila `ecommerce_requests` del handshake — ambas quedan en dev y hay que borrarlas a mano. |
| `synth-fill <uReqID> [lender]` · `synth_fill` | Lo mismo pero **sobre un request que ya existe** (el que arma el wizard al llegar a `/personal-info`). Después navegás a `/lenders` y aparecen las ofertas. |
| `create <m> [rol]` · `create_asesor` | Asesor sintético namespaced `{seed}-{slug-en}-test`, donde el rol se traduce: comercial→`adviser`, administrador→`administrator`, analista→`analyst`, superadmin→`super-admin`, admincomercio→`merchant-admin` (ej. `create pullman comercial` → `mcp-adviser-test`). El `clean` igual lo barre porque usa `{seed}-%-test`. Idempotente (upsert por `cognito_id`). |
| `assign <email\|sub> <m> [branchHash] [realSub]` · `assign_asesor` | Asocia un asesor **real** a un comercio para poder loguearlo por Cognito y entrar a su wizard: setea `allied_id`/`allied_branch_id` + perfil Comercial. `realSub` corrige el `cognito_id` al **sub real del login web** (el backend resuelve el asesor por ese sub). Crea la fila si no existe. Snapshot en `.asesor-snapshot.json`. |
| `revoke` · `revoke_asesor` | Revierte el último `assign` con el snapshot (o borra la fila si la creó). |
| `scrubphone <tel>` · `scrub_phone` | Borra los users **CLIENTE** de un teléfono + requests/hijos → el próximo `register` crea un TEMPORAL USER y el flujo cae en `/personal-info`. **Nunca toca asesores** (filtra `cognito_id` no nulo). |
| `notify <uReqID> [url]` · `notify_ecommerce` | Webhook sintético: replica `processEcommerceTransaction` (payload según `ecommerce_id`, `processed=1` solo si el receiver responde 2xx). Sin url usa el loopback del propio MCP. |
| `clean [--identity]` · `clean` | Borra el namespace del seed, uno a uno por clave. `--identity` / `scrub_identity=true` borra además la identidad de `E2E_SCRUB_PHONE`/`E2E_CUSTOMER_DOC`/`E2E_SCRUB_EMAIL`. |

### Solo CLI (no están expuestos como tools MCP)

Nacieron para diagnosticar casos de soporte puntuales; quedaron en el binario:

| CLI | Para qué |
|---|---|
| `lenderconf <lenderID>` | `image`/`url` del lender + su `url_utm` por comercio y por sucursal. Del caso Lagobo: el WhatsApp de autogestión manda `url_utm` verbatim, así que si llega un `.jpg` el problema es el dato, no el código. |
| `lendersbytype <rt>` | Lenders de un `response_type` marcando cuáles tienen `url`/`image` que **parecen imagen** — el "deber ser" contra el que comparar. |
| `userreqs <tel>` | Los últimos 10 `user_requests` de un teléfono + el snapshot `profiling_reviews.displayed_lenders` del más reciente. |
| `seedpreapproval <uReqID> <lender> [monto=500000]` | **WRITE** · siembra un `lender_transactions` APROBADO (`status_id=41`) para que `validatePreApproveLender` pre-apruebe **sin llamada HTTP externa**. Falla si no existe `lender_transaction_statuses.id=41`. |
| `branchrule-add <hash> <lender>` / `branchrule-del <groupRuleID>` | **WRITE** · crea/borra un `group_rule` + `lender_rule` trivial-true (`users.age != -1`) para probar que un candidato **sin group rule** se cae del listado y reaparece al darle una. |
| `webhook-server [addr]` (alias `serve`) | Mini-server de larga vida (default `127.0.0.1:8787`) que imprime cada POST. **Único comando que no necesita DB.** |

### Frontera de testeo sintético (rt=2 vs rt=1)

- **rt=2 in-platform** (CrediPullman, CrediFis X, Motai/DHI X…): la decisión vive **entera** en legacy → el
  synth la cumple → **ofrecido + Estado 11**. ✅ Validable.
- **rt=1 integración** (Bancolombia #68/#100): la oferta la gatea la **API externa del lender**
  (`PreApprovedLenderService` → `BancolombiaBnpl::validateQuota`), no las reglas locales. Un usuario
  sintético no la pasa por más que cumpla todo lo local. ❌ No inyectable — el caso es **por lender**
  (Banco de Bogotá #5 sí aparece).

---

## Alcance: qué SÍ y qué NO

**✅ Cubierto y validado** (Pullman + CrediPullman, entrada asesor y ecommerce): `numero → otp(bypass) →
inyección → listado`, sello **Estado 11** (se sella *durante* el GET del marketplace,
`stampCreditopXApproval`) y el **webhook** ecommerce con `processed=1`.

**🟡 Requiere ajuste por caso:** el listado anda para cualquier comercio, pero el set de campos que se
inyecta está afinado a CrediPullman. Otros lenders piden otras group/category rules → puede que no
aprueben sin tocar qué se inyecta (ver [Extender](#extender-a-otro-comerciolender)).

**❌ Fuera de alcance:**
- **Cierre / desembolso real** — la firma del pagaré es externa (**Netco/Deceval**). Por eso el webhook va
  por atajo sintético: no se ejecuta `authorize` ni se firma nada.
- **Validar respuestas reales de Experian/centrales** — se INYECTA lo que el backend leería.
- Payment links, rt=1 end-to-end, rt=3 completo.
- Todo lo ajeno a la originación (post-desembolso, pagos, panel admin, reportes).

---

## Extender a otro comercio/lender

Metodología: **diagnosticar → inyectar lo que falte.**

```bash
bash scripts/dev.sh branchdiag <hash>            # 1. ¿es candidato? ¿hay group rules?
bash scripts/dev.sh grouprules <hash> <lender>   # 2. ¿qué exige para ENTRAR al listado? (AND)
bash scripts/dev.sh rules <lender>               # 3. ¿qué exige para el SELLO / categoría?
```

Puntos de inyección en el código:
- **`deriveSynthReq`** ([synthrules.go](synthrules.go)) — lo primero a mirar: traduce reglas → perfil.
  Hoy entiende `field 87 >=` (ingreso), `operator =` sobre fields (toma el **primer valor** de una lista
  `A|B|C`), `users.gender`, `users.age` (rango) y el `min_score` mayor. **Cualquier otra forma de regla
  la ignora en silencio** — ese es el borde por el que se cae un lender nuevo.
- **`setSynthIdentity`** ([db.go](db.go)) — columnas de `users` (incluida `age`, que el query builder de
  `validateRulesByLender` lee **como columna**, no vía el accessor de `date_of_birth`).
- **`injectIncomeFields`** ([db.go](db.go)) — `user_field_values` (87 ingreso, 29 ocupación, 160 reportado…).
- **`injectSummary` / `datacreditoData`** ([db.go](db.go)) — `user_summaries` + el cuerpo de datacrédito
  (vector TC, negativos, capacidad) que chequea `LenderUserCategoryService`.

> Tip: corré con `--keep` y después `reqdiag <uReqID>` / `modediag <uReqID> <lender>` para ver el estado
> real y por qué un lender no aparece.

---

## Conceptos

**KYC armado.** El path es `run_synth`/`synth_fill`. Para CrediPullman (#77) hay **dos gates**:
1. **Inclusión** en el listado → group rules de la sucursal (ocupación, reportado, ingreso, género y
   `users.age`).
2. **Sello Estado 11** → fila `risk_central_user_data` con `data` **encriptada como Laravel**
   (`encrypted:collection`, AES-256-CBC con `APP_KEY`), replicado en [crypto.go](crypto.go). Se sella
   *durante* el GET del marketplace.

**OTP bypass.** Mecanismo legítimo de QA: el teléfono debe estar en el setting `qa_otp_bypass_phones` y el
**código = los últimos 4 dígitos**. Solo si el backend corre con `APP_ENV` local/development. `synth` usa
el teléfono **quemado** `3131010101`.

**Webhook (`--notify`).** El cierre real (`disburse` → `authorize` → `notifyEcommerceStore`) exige firma
externa. `--notify` replica `processEcommerceTransaction`: arma el payload según `ecommerce_id`
(1 = WooCommerce → `process_url + order_identifier`, body `{status}`; el resto = webhook genérico con
`orderId`/`approvedAmount`/`status`/`transactionId`), lo POSTea y marca `processed=1` **solo si responde
2xx** — igual que el backend. El receiver por defecto es un **loopback efímero del propio MCP**
(`127.0.0.1:0`): dev no alcanza tu localhost, pero acá el POST lo emite el MCP, así que el ciclo cierra.

---

## Gotchas

- **`--notify` solo hace algo junto con `--ecommerce`.** En `opSynth` la condición es literal
  `if notify && ecommerce` — sin entrada ecommerce no hay `ecommerce_request` que notificar y el flag se
  ignora **sin avisar**.
- **El binario `creditop-mcp` del repo está viejo** (compilado 2026-06-12; las fuentes son del 06-22).
  Si lo tenés registrado como MCP, **recompilá** (`go build -o creditop-mcp .`) o vas a correr una versión
  vieja de los tools.
- **La regla de permiso de Claude Code apunta a `backend-e2e/scripts/dev.sh`, no a este.**
  (`.claude/settings.local.json` del playground). Los comandos de acá van a pedir confirmación.
- **El doc sintético es determinístico por seed** (`synthDoc`: `29` + hash del seed). Dos `synth` con el
  mismo seed reusan el mismo documento, y cada corrida hace un **pre-scrub** de ese doc → la corrida
  anterior con `--keep` se pierde. `synth-fill` en cambio usa `2900000000 + uReqID` (único por request).
- **`clean` NO borra el cliente sintético.** Solo barre el namespace de asesores
  (`cognito_id LIKE '{seed}-%-test'`). El cliente se limpia solo al final de `synth` (salvo `--keep`), o a
  mano con `clean --identity` + `E2E_CUSTOMER_DOC=<doc sintético>`.
- **`synth <comercio>` puede resolver una sucursal sin credencial ecommerce.** `resolveMerchant` matchea
  por hash/slug/nombre y ordena por `status DESC, id` — para `--ecommerce` pasá directamente el **hash**
  que sale de `ecommerce` (ej. `17f7b360`).
- **Pullman (allied 94) y Dentix (189)**: `register` **no manda el documento** (`needsPersonalInfo`),
  porque en esos comercios lo fija `personal-info` y mandarlo antes da `ONB005 DOCUMENT_DUPLICATE`.
- **Defaults quemados** que sorprenden: `grouprules` sin hash usa `17f7b360`; `grouprules`/`rules` sin
  lender usan **77**; el monto del synth es `1.500.000`.
- **`deriveSynthReq` es best-effort**: si el lender pide una regla con una forma que no contempla, la
  ignora y el synth "falla sin motivo aparente". Empezá siempre por `grouprules`.
- **Las escrituras van directo a la BD, sin pasar por el backend.** Nada de esto ejercita validaciones de
  aplicación — valida el *listado y el sello*, no la captura de datos.

---

## Seguridad

- **Target dev (default) o local** (`--target local` / `E2E_TARGET`) → decide qué `.env.<target>` se carga.
- **Los WRITE a dev exigen `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`**; con `--target local` el guard pasa solo.
- **Nunca borrado masivo** — todo DELETE es por clave (id/doc/tel/email), con `FOREIGN_KEY_CHECKS=0`
  acotado a esos ids.
- **Secretos y PII solo en `.env.dev` / `.env.local`**, ignorados por el `.gitignore` raíz del playground
  (`.env.*`). El binario los autocarga al arrancar (cwd, y además junto al ejecutable). Ojo: el
  `.gitignore` local de esta carpeta **solo** cubre `.asesor-snapshot.json`.
- Los clientes sintéticos usan un doc en el rango **2900000000–2999999999** (los CC reales son < ~1.4B) y
  se autolimpian salvo `--keep` — pero el autoclean solo borra el cliente: `lender_allied_credentials` y
  `ecommerce_requests` quedan (ver `synth`).

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

> Sin argumentos el binario arranca en modo MCP. Los tools de write quedan sujetos a los permisos del
> cliente: no es un bypass del guard, es una superficie tipada.

---

## Troubleshooting

| Síntoma | Causa / arreglo |
|---|---|
| `comercio no encontrado` | El query no matchea. Usá el **hash** de sucursal (`list` / `ecommerce`). |
| `token ecommerce no encontrado` | Esa sucursal no tiene `allied_ecommerce_credentials`. Elegí una de `ecommerce`. |
| `otp-validate (¿bypass?)` falla | El teléfono no está en `qa_otp_bypass_phones`, o el backend no corre con `APP_ENV` local/development. Verificá con `bypassphones`. |
| `lenders: []` o falta el lender esperado | Falta inyectar algún field. `grouprules`/`rules`, después `--keep` + `reqdiag` / `modediag`. |
| `datacredito_forged` ≠ `ok` | Falta `APP_KEY`, o no hay `risk_centrals` Experian (Acierta / Acierta+Quanto) en el target. `cryptocheck`. |
| `notify` deja `processed: 0` | El receiver no respondió 2xx (igual que el backend real). Con loopback no debería pasar. |
| Estado 11 no se sella | El datacrédito forjado no pasa las `rules` de categoría, o `available_amount`=0. `rules <lender>`. |
| `--notify` no hizo nada | Te faltó `--ecommerce` (ver Gotchas). |
| `i/o timeout` al conectar | VPN/red hacia la BD de dev. Reintentá. |

---

## Config (`.env.dev` / `.env.local`)

Mismas claves en los dos perfiles. El parser acepta `KEY=v` o `export KEY=v`, comillas y comentarios
inline, y **no pisa** variables ya presentes en el entorno.

| Var | Para qué | Default |
|---|---|---|
| `E2E_DB_USER/PASS/HOST/PORT/NAME` | MySQL del target. | port `3306`, name `creditop` |
| `E2E_API_BASE_URL` | Base del legacy (se usa además como header `Host` / vhost). | `http://legacy-backend.inertia-develop/api` |
| `SEED` | Namespace de los sintéticos (`{seed}-%-test` + doc determinístico). | `mcp` |
| `APP_KEY` | `base64:…` del backend del target — sin esto no se forja el datacrédito encriptado. | — |
| `I_KNOW_THIS_TOUCHES_SHARED_DEV` | `=1` habilita los WRITE en **dev**. | — |
| `E2E_SCRUB_PHONE` / `E2E_CUSTOMER_DOC` / `E2E_SCRUB_EMAIL` | Identidad puntual que borra `clean --identity`. | — |
| `E2E_TARGET` | Alternativa a `--target`. | `dev` |

---

## Archivos

```
main.go        modo MCP (SDK modelcontextprotocol/go-sdk) + modo CLI + registro de los 23 tools
env.go         parser de .env.<target> + Config + guardOK()
ops.go         ops de alto nivel compartidas por MCP y CLI (synth, diagnósticos, casos de soporte)
synthrules.go  deriveSynthReq: reglas del (comercio, lender) → perfil sintético mínimo
db.go          conexión + escrituras (identidad, summaries, fields, datacrédito, asesores, borrado por clave)
flow.go        HTTP contra el legacy (vhost por header Host) + register / otp-validate / marketplace
ecommerce.go   handshake base64 (phpSerialize + token) → ecommerce-request/create + notifyEcommerce
crypto.go      cifrado/MAC estilo Laravel (AES-256-CBC + HMAC) para el datacrédito forjado
asesor.go      assign/revoke (con snapshot), whois, scrubphone, parser de qa_otp_bypass_phones
webhook.go     receiver loopback efímero + webhook-server de larga vida
scripts/dev.sh wrapper CLI: sourcea .env.<target> y corre `go run . <args>`
```

## Ver también

- **`frontend-e2e/README.md`** — el harness del wizard (Playwright + panel :5195). Tiene su propio port de
  la inyección; es el camino por defecto si necesitás UI.
- **`backend-e2e/DEV-TARGET.md` · `backend-e2e/SUITE.md`** — el harness Go de backend, apuntando a dev.
- **`context/server/data/flows/harness/`** (árbol de context) — el mapa de todo el aparato de pruebas:
  quién inyecta qué, mocks, puertos, Cognito, namespacing.
