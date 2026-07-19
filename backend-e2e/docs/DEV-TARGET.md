# Correr backend-e2e contra DEV (`--target=dev`)

> ⚠ Los `docs/*.md` que se citan abajo vivían en `playground/docs/`, **borrada de `main`** (absorbida por el árbol de `context/`). Quedan como referencia histórica; para leer una: `git show 159906a:docs/<archivo>`.


> ⚠️ **Actualizado (Fase 4):** `--target=dev` se permite en los comandos READ-ONLY (`list`/`get`/`doctor`/
> `login`) + los acotados por namespace/clave (`create`/`clean`, con guard `I_KNOW_THIS_TOUCHES_SHARED_DEV`);
> el flujo de origination completo sigue **gated**. El **KYC real** (Experian/AgilData/Mareigua/TusDatos) y
> el comando `kyc` fueron **RETIRADOS** (Fase 1) — hoy todo es **inyección de KYC armado** (`synth`/
> `synth-fill`, ver [`../backend-mcp/README.md`](../../backend-mcp/README.md)). Lo de abajo sobre `kyc`/KYC
> real es **histórico**.
>
> Cómo apuntar el harness al **ambiente de desarrollo compartido** (en vez de local + mocks) para crear
> usuarios de prueba y operaciones acotadas — de forma **segura y limpia**.
>
> 🔒 Es la **BD compartida del equipo de desarrollo** (no prod, pero compartida). Reglas estrictas
> abajo. Ver también `docs/CONVENCIONES.md` *(histórico)* y el hallazgo de seguridad #12
> en `docs/hallazgos-backend.md` *(histórico)*.

---

## 1. Modelo de seguridad (leer primero)

Tocar dev compartido tiene guardas **innegociables**:

1. **NO existe borrado masivo** en ningún target (local ni dev). Siempre se borra **uno a uno, por
   clave**, los recursos creados. No hay `WHERE id > 0` / `TRUNCATE` / deletes por columna.
2. **Todo WRITE/DELETE a dev exige `I_KNOW_THIS_TOUCHES_SHARED_DEV=1`** (guard explícito).
3. **`--target=dev` solo está habilitado en `create`, `clean` y `kyc`** — el resto rehúsa (el cierre
   completo usa `database.Clean`, pendiente de integrar al ledger).
4. **Secretos y PII solo en `backend-e2e/.env.dev`** (gitignored, `.env.*`). Nunca se commitea.
5. **El auto-mode classifier de Claude Code bloquea estos comandos** (bypass de OTP + writes a dev
   compartido). Por eso **los corre el usuario**, vía el wrapper `scripts/dev.sh` autorizado por una
   regla de permiso local. Claude construye/itera; el humano ejecuta.

Cómo se cumple la regla #1 en el código:
- **`pkg/ledger`** (`.created-resources.json`, gitignored): registra cada recurso creado
  `{target, table, key_col, key_val}`. Persiste entre sesiones. `clean` lo borra uno a uno (idempotente).
- **`scrubIdentity`** (en `kyc.go`): borra los user(s) que matcheen doc/tel/email **por id**.
- **`database.Clean`** se refactorizó: el `ecommerce_requests` se borra por id (capturado), ya no bulk.

---

## 2. Setup (una vez)

### 2.1 · `backend-e2e/.env.dev` (gitignored — completar a mano)

```bash
# Cognito (login real — opcional, solo si probás el login):
export E2E_COGNITO_REGION=us-east-2
export E2E_COGNITO_CLIENT_ID=...           # del .env del frontend
export E2E_COGNITO_CLIENT_SECRET=...        # secreto — nunca commitear

# BD + API de dev:
export E2E_DB_HOST=...rds.amazonaws.com
export E2E_DB_PORT=3306
export E2E_DB_NAME=creditop
export E2E_DB_USER=...                       # idealmente un user acotado, NO admin
export E2E_DB_PASS='...'                      # ⚠️ comillas SIMPLES si tiene $ (si no, el shell lo expande)
export E2E_API_BASE_URL=http://legacy-backend.inertia-develop/api
export I_KNOW_THIS_TOUCHES_SHARED_DEV=1       # guard para writes a dev

export SEED=mig                               # namespace de tus recursos en dev

# Cliente de prueba para el KYC (datos PROPIOS, frescos — el KYC real los reconoce):
export E2E_CUSTOMER_DOC_TYPE=CC
export E2E_CUSTOMER_DOC=...                    # tu cédula
export E2E_CUSTOMER_EXPEDITION=AAAA-MM-DD      # fecha de expedición real
export E2E_CUSTOMER_BIRTH=AAAA-MM-DD           # fecha de nacimiento real (el backend real la exige)
export E2E_CUSTOMER_FIRST_NAME="..."
export E2E_CUSTOMER_SURNAME="..."
export E2E_CUSTOMER_GENDER=M
export E2E_CUSTOMER_PHONE=3131010101           # un teléfono de qa_otp_bypass_phones → OTP = últimos 4
export E2E_CUSTOMER_OTP=0101

# Identidad a LIMPIAR antes/después de cada prueba (tu user real: doc + tel + email):
export E2E_SCRUB_PHONE=...                      # tu teléfono real (el del user preexistente)
export E2E_SCRUB_EMAIL=...                      # tu email real
```

> El `.gitignore` cubre `.env.*` y `.created-resources.json` — verificá con `git check-ignore`.

### 2.2 · Wrapper `scripts/dev.sh`

Sourcea `.env.dev` y corre `go <args>`. Existe para que **una sola regla de permiso** autorice los
comandos dev sin que el classifier pregunte cada vez:

```bash
bash backend-e2e/scripts/dev.sh run . <comando> --target=dev
bash backend-e2e/scripts/dev.sh test ./pkg/database/ -run <Test> -v -count=1
```

### 2.3 · Regla de permiso (`.claude/settings.local.json`, gitignored)

```json
{ "permissions": { "allow": [
  "Bash(bash /ruta/abs/playground/backend-e2e/scripts/dev.sh:*)"
] } }
```

---

## 3. Crear un asesor (`create`)

Verbo de primera clase, simétrico con `[channel] merchant lender`. Crea un usuario sintético
namespaced (rol + comercio + branch), idempotente (UPSERT por `cognito_id`). **No destructivo.**

```bash
# Local:
go run . create comercial pullman

# Dev (con guard):
bash backend-e2e/scripts/dev.sh run . create --target=dev comercial pullman
```

- Formato del identificador: **`{seed}-{rol}-test`** (ej. `mig-adviser-test`), email
  `{seed}-{rol}-test@{comercio}.com`. Roles: `comercial|asesor → adviser`, `administrador → administrator`,
  `analista → analyst`, `superadmin`, `admincomercio`.
- "Login" del asesor = header **`x-cognito-identity-id: <cognito_id>`** (el backend resuelve por ahí,
  ver hallazgo #12 — no valida JWT). Imprime exports `eval`-friendly + el `DELETE` por clave para borrarlo.
- Reusa `merchant.Resolve` + `ensureBranch` + `createAsesor` → cero divergencia de SQL.

Limpieza: `clean --target=dev` borra el namespace del seed + lo anotado en el ledger.

---

## 4. Probe de KYC (`kyc`) — el flujo completo contra dev

Ejerce **register → otp-validate (OTP bypass) → personal-info → KYC real** y muestra la respuesta.
**Crear + eliminar por corrida**: limpia tu identidad antes y después → tests siempre limpios.

```bash
bash backend-e2e/scripts/dev.sh run . kyc --target=dev
# otro comercio:  ... run . kyc dentix --target=dev
# inspeccionar sin borrar:  ... run . kyc --target=dev --keep
```

Pasos internos:
1. **pre-scrub** — `scrubIdentity` borra cualquier user con tu `doc`/`E2E_SCRUB_PHONE`/`E2E_SCRUB_EMAIL`
   (+ requests + hijos), por id → libera el documento (evita `ONB005 DOCUMENT_DUPLICATE`).
2. **register** (tel `E2E_CUSTOMER_PHONE`). Para Pullman no manda el doc (lo fija personal-info).
3. **otp-validate** — OTP = últimos 4 del teléfono (bypass; ver §5) → crea el `user_request`.
4. **personal-info** — manda doc + nombres + **fecha de expedición** + **fecha de nacimiento** reales
   + un **email único por corrida** (`kyc-{uReqID}@creditop.com`) → dispara el KYC real.
5. Imprime la respuesta del KYC.
6. **post-scrub** (salvo `--keep`) — borra el user temporal creado → doc libre para la próxima.

Salida de éxito:
```json
{ "data": { "success": true, "payload": { "user_request_id": 463510 } },
  "message": "user successfully validated and personal info stored. laboral information obtained via risk centrals",
  "success": true }
```
`"laboral information obtained via risk centrals"` = el KYC (Experian Quanto en Pullman) **respondió
con datos**. (Comercio estándar → TusDatos; Pullman/Dentix → Experian Quanto.)

---

## 5. OTP bypass (cómo funciona)

Mecanismo **legítimo de QA** del backend (`Modules/Onboarding/App/Services/OtpBypassService.php`):

- El teléfono debe estar en el setting **`qa_otp_bypass_phones`** (tabla `settings`).
- El **código OTP = los últimos 4 dígitos del teléfono** (ej. `3131010101` → `0101`).
- **Solo aplica si `APP_ENV` es `local` o `development`** — dev lo es (confirmado). Prod/staging lo ignoran.
- Lo honra tanto el OTP de onboarding (`otp-validate`) como el del pagaré.

Ver qué teléfonos están en la lista (read-only):
```bash
bash backend-e2e/scripts/dev.sh test ./pkg/database/ -run TestOtpBypass -v -count=1
```

---

## 6. Limpieza

```bash
bash backend-e2e/scripts/dev.sh run . clean --target=dev          # namespace del seed + ledger (uno a uno)
```
- `clean` borra: el namespace del `SEED` (asesores/clientes/requests por marcador) **+** los recursos
  anotados en el ledger (cascada de hijos para `user_requests`). Idempotente.
- `kyc` además scrubea tu identidad (doc/tel/email) en cada corrida.
- Inspeccionar un documento y su user antes de borrar:
  `... test ./pkg/database/ -run TestInspectDoc -v -count=1`

---

## 7. Qué aprendimos (validaciones del backend real vs mock local)

El mock local es laxo; dev valida en serio. Para que `personal-info` pase y dispare el KYC:

| Requisito | Mock local | Dev real |
|---|---|---|
| `email` | cualquiera | **`unique:users,email`** + MX del dominio → usar email único por corrida |
| Fecha de **expedición** | hardcodeada `2010-01-01` | **debe ser la real** (si no, mismatch) |
| Fecha de **nacimiento** | no se manda | **`birth_day/month/year` requeridos** (si no, `ONB005 BIRTH_DATE_INVALID`) |
| Documento | fresco cada corrida (se limpia) | si ya está registrado → **`ONB005 DOCUMENT_DUPLICATE`** → liberar primero |

Hallazgos de backend relacionados (catalogados, **sin PR sin pedir**): ver
`docs/hallazgos-backend.md` *(histórico)* #12 (auth por header sin validar JWT +
`->can()` on null).

---

## 8. Quickstart (TL;DR)

```bash
# 0. (una vez) completar backend-e2e/.env.dev + .claude/settings.local.json (ver §2)

# 1. crear un asesor para Pullman en dev
bash backend-e2e/scripts/dev.sh run . create --target=dev comercial pullman

# 2. probe de KYC (crea cliente, dispara KYC real, limpia)
bash backend-e2e/scripts/dev.sh run . kyc --target=dev

# 3. limpiar el namespace
bash backend-e2e/scripts/dev.sh run . clean --target=dev
```

**Archivos clave:** `create.go`, `kyc.go`, `clean.go`, `pkg/ledger/`, `pkg/config` (`GetConfig`),
`scripts/dev.sh`, `.env.dev`. Mecánica común de los harness: `docs/HARNESS-ARQUITECTURA.md` *(histórico)*.
