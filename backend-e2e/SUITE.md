# Suite E2E — manual del CLI Go · `[channel] → [merchant] → [lender]`

> 🔒 Parte del repo LOCAL `playground/` — nunca se pushea.
>
> ⚠️ **Stale:** los subcomandos `negative` y `kyc` fueron **RETIRADOS** (Fase 1) — el KYC con mocks /
> X-Fake-Scenario ya no se usa; el path es **inyección** (`synth`/`synth-fill` en backend-mcp · `pkg/inject`
> en frontend-e2e). Las menciones a `negative`/`kyc` más abajo son históricas. Además `--target=dev`
> (Fase 4) habilita los read-only + `create`/`clean`.

Un solo módulo Go (`creditop-tests`) que ejerce la **originación de crédito** de Creditop contra el
**legacy-backend LOCAL en modo mock** (backend PHP real, proveedores externos en `fake`). En vez de una
carpeta por "flujo", el código se organiza por los **tres ejes** del modelo, y un CLI compone cualquier
combinación al vuelo.

**Este doc es el DUEÑO del CLI**: subcomandos, defaults y cómo se componen los flujos. Para el contexto de
negocio (qué es cada `response_type`, ciclo de vida de estados) ver [`../docs/NEGOCIO.md`](../docs/NEGOCIO.md);
para los hardcodes (IDs, montos, branches, PII) ver [`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md);
para el detalle de cada cierre (citas archivo:línea, mocks) ver [`../docs/REFERENCIA-FLUJOS.md`](../docs/REFERENCIA-FLUJOS.md);
para el **estado/resultado** de cada flujo ver [`VALIDATION.md`](VALIDATION.md); para el quickstart UI ver
[`../frontend-e2e/README.md`](../frontend-e2e/README.md).

---

## Requisitos

- **legacy-backend en modo mock** (targets reales del Makefile del legacy-backend, líneas 38/77/54):
  ```bash
  cd ../../github/legacy-backend && make up && make mock-all && make restart
  ```
- **Bypasses y fakes** (`AppServiceProvider`): los flujos de cierre requieren los `Http::fake` de los
  proveedores externos + el fake de PdfMapper. **Ya están aplicados al working tree** del legacy-backend
  (todos presentes en `app/Providers/AppServiceProvider.php:31-35`). Si una BD/checkout limpio los perdió,
  viven en `git stash` (numeración correcta abajo). El fake de PdfMapper además exige `PDF_MAPPER_FAKE=true`
  en el `.env` del backend (`AppServiceProvider.php:278` gatea `fakePdfMapperForLocal` por ese env).
- **BD local** en `127.0.0.1:3306` (driver mysql por TCP, sin `.env` — ver "Conexión" abajo). Para una BD
  nueva: `go run . setup` (migra esquema base + seed).

### Stashes del legacy-backend (numeración real)

`git -C ../../github/legacy-backend stash list`:

| stash | Contenido |
|---|---|
| `stash@{0}` | **bypasses completos + SmartPay forms-service FAKE** (`fakeFormsServiceRoutesForLocal` → `/api/forms-fake/dynamic`) |
| `stash@{1}` | **cierre Creditop X**: fake de PdfMapper (`fakePdfMapperForLocal`) + `Throwable` en handlers |
| `stash@{2}` | bypasses S3 bucket + host Sistecrédito |

> ⚠️ Corrección frecuente: `stash@{0}` **NO** es el fake de PdfMapper. El fake de PdfMapper (cierre Creditop X)
> es `stash@{1}`. Ambos ya están aplicados al working tree; reaplicar solo si se perdieron.

---

## CLI (fuente canónica — regenerado desde `usage()`/`main.go`)

```bash
go run . <web|asesor> <comercio> <lender[,lender2,...]>   # compone y corre el flujo (lista = matriz)
go run . smartpay [branch]                                # SmartPay: cadena OTP+submit (backdoor + create-user). default branch=3e67eade
go run . perfilador <comercio> <lender>                   # MOTOR DE RIESGO: ¿se ofrece el lender según el perfil?
go run . random [N]                                       # N tripletas VÁLIDAS al azar (lenders_by_allieds) E2E. default N=5
go run . offer <comercio>                                 # qué lenders ofrece un comercio (descubrir pares válidos)
go run . list                                             # comercios y lenders disponibles (de la BD)
go run . negative [comercio]                              # rutas negativas / anti-fraude de la entrada
go run . setup                                            # migra el esquema base + seed (BD local nueva)

# flag global:
go run . <...> --explain                                  # imprime el PASO A PASO documentado SIN ejecutar (no toca el backend)
```

### Flujo de pasos autodocumentado (`pkg/flow`)
Cada flujo se ejecuta como una **secuencia de pasos numerados**: el runner (`pkg/flow`) imprime, por paso,
el título + una descripción de **qué hace** y luego el resultado (`✓ detalle` / `✗ error`), con un **resumen
final** (`N/N pasos · tiempo`). El triplete compone un solo flujo de punta a punta —
entrada del canal (`channel.AsesorSteps`/`WebSteps`) → verificación del comercio → cierre del lender
(`lender.CloseSteps`, con Creditop X descompuesto en pasos granulares)— así el **cierre dejó de ser opaco**.
`negative` corre como **batería** (`RunAll`: ejecuta las 5 aserciones aunque alguna falle → `4/5`).
Con `--explain` se imprime solo la documentación del flujo (útil para entender un comando sin correrlo).

```
[6/9] Selección de lender + perfil aprobado
  ↳ Siembra el perfil aprobado (datacrédito 750) y fija el lender #77 en el user_request.
  ✓ lender #77 seleccionado · perfil aprobado
...
🟢 FLUJO OK · 9/9 pasos · 12.5s
```

| Subcomando | Args | Default | Qué hace | Ref. en `main.go` |
|---|---|---|---|---|
| `web`/`asesor` | `<comercio> <lender[,…]>` | — | `runDynamic`: resuelve comercio+lender(es) por nombre desde BD y corre `[canal]→[comercio]→[lender]`. Lista con comas ⇒ matriz (un cierre por lender, datos aislados por `variant()`). | `main.go:74-79,100-145` |
| `smartpay` | `[branch]` | `branch=3e67eade` | `runSmartpay`: cadena OTP+submit de SmartPay contra legacy-backend (sin microservicio). | `main.go:54-59,189` |
| `perfilador` | `<comercio> <lender>` | — | `runPerfilador`: valida el motor de riesgo — varía el perfil y comprueba que el marketplace ofrece/rechaza el lender. | `main.go:60-65,287` |
| `random` | `[N]` | `N=5` | `runRandom`: N tripletas válidas al azar desde `lenders_by_allieds` (filtradas a rt 2/3 o id 24/68/100), canal web si el branch es ecommerce. Smoke aleatorio + mapa de completitud por `response_type`. | `main.go:66-73,453` |
| `offer` | `<comercio>` | — | `runOffer`: onboarding asesor + `GET /lenders` para descubrir qué lenders ofrece un comercio (siembra perfil aprobado score 750 antes del marketplace). | `main.go:48-53,420` |
| `list` | — | — | `listCatalog`: comercios (hash·nombre·slug·kind) y lenders (id·nombre·rt) de la BD. | `main.go:38-39,567` |
| `negative` | `[comercio]` | — | `runNegative`: rutas negativas / anti-fraude de la entrada (ver eje canal). | `main.go:42-47,400` |
| `setup` | — | — | `setup`: migraciones + seed para BD local nueva. | `main.go:40-41,583` |
| `prep` | `--merchant X --lender Y [--asesor n] [--branch h]` | `--asesor comercial` | `runPrep`: siembra precondicionales (branch + oferta `lenders_by_allieds` + credencial si aplica + asesor sintético namespaced por seed). Exporta `E2E_*` (stdout) para `eval`; resumen humano (stderr). Idempotente. | `prep.go` |
| `get` | `<user-request\|merchant\|lender> <arg> [--json]` | — | `runGet`: inspector read-only (kubectl get / gh pr view). Exit 0 OK · 1 not found · 2 args. | `get.go` |
| `doctor` | `[--json]` | — | `runDoctor`: 8 checks del setup local (MySQL, esquema, scoring, OTP bypass, backend HTTP, drivers, stash, .cognito.json) con fix inline. Exit 1 si hay fail. | `doctor.go` |
| `clean` | `[--seed X]` | seed de la máquina | `runClean`: borra el namespace sembrado por `prep` (asesores/clientes/solicitudes/comercios del seed). Seguro: solo el marcador del seed. | `clean.go` |

> Los subcomandos `prep`/`get`/`doctor`/`clean` consolidaron al extinto `creditop-cli`. El E2E
> completo (prep → flujo → get → clean) se orquesta con [`scripts/flow.sh`](scripts/flow.sh).

> El default branch `3e67eade` es un branch de **Amoblando Pullman** (allied 94). El catálogo de
> hashes/slugs reales está en [`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md).

### Ejemplos

```bash
go run . web 17f7b360 77                   # canal web (ecommerce base64) → CrediPullman → Estado 11 (Pullman tiene creds ecommerce + lender 77)
go run . asesor a1c0b15d 68                # Corbeta (Alkosto, inyección laboral) → Bancolombia (lender que ofrece)
go run . asesor 80059314 credifamilia      # rt=4 async → APROBADO
go run . asesor 3e67eade 77,95             # matriz multi-lender — DEMO de detección de gaps (95 puede fallar por config)
go run . asesor 1941e23b 23                # rt=1 Welli → pre-aprobado vía integración (host mockeado)
go run . smartpay                          # SmartPay branch default 3e67eade (cadena OTP+submit, sin micro)
go run . asesor 3e67eade 77 --explain      # documenta el flujo paso a paso SIN ejecutar
go run . random 8                          # 8 tripletas válidas al azar + mapa de completitud por rt
go run . offer alkosto                     # descubrir qué lenders ofrece Alkosto
```

> **Elegir el lender correcto para el comercio.** Un lender solo cierra in-platform si está asociado al
> allied del comercio (`lenders_by_allieds`). P.ej. el #77 (CrediPullman) es de **Pullman (allied 94)**; forzarlo
> en otro comercio da **pagaré HTTP 500**. Usá `offer <comercio>` para ver qué lenders ofrece cada uno.

> Comercio y lender se resuelven **por nombre/slug/hash/id desde la BD** (`merchant.Resolve`/`lender.Resolve`)
> — nada hardcodeado en el comando. `go run . list` muestra qué hay para componer.

---

## SmartPay (cadena OTP+submit · BDUS/BDTM/DYFS)

El microservicio `onboarding-forms-service` es solo un proxy; la lógica de originación vive en legacy-backend.
El harness **replica esa cadena directamente** y **NO levanta el microservicio** (`runSmartpay`, `main.go:189-253`):

| # | Paso | Endpoint (`/api/onboarding/backdoor` salvo create-user) | Code esperado |
|---|---|---|---|
| 1 | create-temporary-user (dispara send-otp) | `backdoor/create-temporary-user` | **BDUS002** |
| 2 | check-user-exists (dispara validate-otp) | `backdoor/check-user-exists` → `userId` | **BDUS003** |
| 3 | accept-terms (políticas SmartPay) | `backdoor/accept-terms` (terms **14/15**) | **BDTM002** |
| 4 | **SUBMIT** (originación) | `onboarding/dynamic-forms/create-user` → `userRequestId` | **DYFS1001** |
| 5 | resolve-lenders-redirect (best-effort) | `backdoor/resolve-lenders-redirect` | **BDUS005** |

- **terms 14/15** son las políticas SmartPay reales: id 14 = *Política de Tratamiento de Datos CTOP SMartpay*,
  id 15 = *Términos y condiciones CTOP SMARTPAY* (tabla `terms_and_conditions`).
- El esquema del formulario que pide `create-user` lo sirve el fake del legacy-backend
  (`fakeDynamicFormsServiceForLocal`, `AppServiceProvider.php:150`; SmartPay forms-service FAKE en `stash@{0}`).
- **Teléfono en formato internacional** (`+573098000123`, `main.go:194`): `create-temporary-user` guarda el
  phone crudo, pero `check-user-exists`/`resolve` normalizan a `+`+dígitos; usar `+57…` en toda la cadena hace
  que lo guardado coincida con lo buscado (si no, BDUS004 usuario no encontrado).
- El paso OTP generate/validate en sí (micro↔otp-service) **queda fuera** — no tiene endpoint en legacy-backend.
- `BACKDOOR_API_KEY` del harness (`gKz9fG25ylWZmB7lfrH13F8CVZDuBBG2`, `config.go:18`) debe coincidir con el
  `.env` del backend (línea 119); protege los endpoints `backdoor/*`.

SmartPay es el lender **#152** (rt=2) / **#153** (rt=1). Su cierre in-platform usa el `CreditopXClose` estándar
(NO IMEI; el IMEI es de Motai #158). El detalle SmartPay del lado UI (wizard, mutex, Cognito) vive en
[`../frontend-e2e/VALIDATION.md`](../frontend-e2e/VALIDATION.md).

---

## Los tres ejes

### `channel/` — cómo ENTRA el flujo

- **asesor** (`Entry`→`asesorEntry`, `channel.go:74`): register → otp → personal → laboral. Se adapta al
  comercio (Motai añade `isMotaiRenting`; Corbeta/Pullman omiten el formulario laboral porque el backend lo
  auto-inyecta — `SkipLaboral`, `merchant.go:73`).
- **web** (`webEntry`, `web.go`): handshake ecommerce/headless — contrato base64 (`phpSerialize`) →
  `ecommerce-request/create` → register → otp (con `ecommerce_request_id`) → personal → laboral. La credencial
  sale de `allied_ecommerce_credentials.credential` (texto plano).
- **`NegativePaths`** (`negative.go`): subcódigos OTP (ONB001 + `CODE_INVALID`/`NO_PREVIOUS_OTP`), payload 422,
  fecha imposible (ONB005 + `EXPEDITION_DATE_INVALID`, 31-feb), documento duplicado (ONB005 + `DOCUMENT_DUPLICATE`).
  El `+` denota código compuesto: el backend real concatena el sufijo al `error_code` (ej.
  `ONB005_EXPEDITION_DATE_INVALID`) — ver [`../docs/REFERENCIA-FLUJOS.md`](../docs/REFERENCIA-FLUJOS.md) §13
  (nomenclatura).
- **OTP por bypass**: el teléfono se agrega al setting **`qa_otp_bypass_phones`** (fila de la tabla `settings`,
  `code='setting'`, `value` = array JSON) vía `EnsureOtpBypass` (`mocks.go:78-86`). Con el teléfono en esa lista
  el envío de OTP no pega a Twilio y el **código = últimos dígitos del teléfono** (`OtpCode`, `channel.go:53`:
  registro usa los últimos 4, el pagaré los últimos 6).

> ⚠️ No existe ningún setting llamado `qa_otp_bypass` ni una tabla homónima — el único es `qa_otp_bypass_phones`.

### `merchant/` — el COMERCIO

- `Resolve`/`List` (`merchant.go:32,124`): branch desde la BD (`allied_branches` + `allieds`). `inferKind`
  deduce el tipo por config: `standard` · `corbeta` (allied en `settings.corbeta_allieds`) · `pullman`
  (allied 94/189) · `motai` (allied 158) · `ecommerce` (con `allied_ecommerce_credentials`).
- `Verify(db, uReqID)` (`merchant.go:87`): comprueba el comportamiento esperado tras la entrada.
  - **Corbeta** → laboral dummy: `field 87=1500000` y `field 29=Empleado` (auto-inyectados por el backend).
  - **Pullman** → ingreso Experian Quanto inyectado en `field 87` (no vacío / no 0).
  - Standard/Ecommerce/Motai → no-op (su validación vive en el cierre del lender).
- `have_ctopx` es columna de `allieds` (no tabla, no a nivel branch); su enforcement como gate no está
  verificado en código — la oferta efectiva pasa por `lenders_by_allieds` (+ credencial). Detalle de hardcodes
  de comercio (fields 87/29/160, allied 94/158, montos) → [`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md);
  estructura de tablas → [`../docs/MODELO-DATOS.md`](../docs/MODELO-DATOS.md).

### `lender/` — a quién y cómo se CIERRA

`Close` (`lender.go:68-85`) despacha la estrategia por id/rt. **`CreditopXClose` es la rama DEFAULT del switch**
(sin `case`): cualquier lender que NO caiga en motai/credifamilia/bancolombia/rt=3/rt=1 cae ahí — **no valida
`rt==2` explícitamente**. Orden real del switch:

```
ID 158 | name~motai      → motaiClose
ID 24  | name~credifamilia → credifamiliaClose
ID 68/100 | name~bancolombia → bancolombiaClose   # ¡por ID, antes que rt==1!
rt == 3              → revolvingClose
rt == 1              → externalClose
default (incl. rt=2) → CreditopXClose
```

- **`CreditopXClose`** (rama default; lenders rt=2 en BD, p.ej. #37/#77/#95/#152): seed perfil aprobado →
  `UPDATE user_requests` con `lender_id`/`rate`/`fee_number`/`initial_fee` (sin `credit_line`; `authorize` lee
  `rate`) → `GET loans/requests/promissory-note/{uReq}` (PdfMapper fake) → `send-otp` → force-otp →
  `authorize` → asserta **`user_request_status_id=11`** (`closes`… en `lender.go:89-112`).
- **`revolvingClose`** (rt=3, `closes.go:18-71`): ciclo 1 genera Pagaré Maestro + crea
  `creditop_x_revolving_credits` y llega a **Estado 11**; ciclo 2 verifica que la 2ª compra no duplica el pagaré.
- **`motaiClose`** (#158, `closes.go:76-119`): check-abaco-requirement → `GET lenders` → update-user-request →
  send-otp/verify-otp → `device/register` (IMEI `356938035643809`) → `device/{id}/disburse` → **Estado 11**.
  *Gaps conocidos: MDM enroll / Abaco (ver [`VALIDATION.md`](VALIDATION.md)).*
- **`bancolombiaClose`** (#68/#100, `closes.go:126-147`): `validate-preapproved` (motor PLS decide BNPL #68 vs
  Consumo #100) → asserta que el motor asignó lender 68/100. **Cierre PARCIAL** (no llega a Estado 11): el
  cierre completo (login-redirect→origination, 8 pasos OAuth) es el portal del banco.
- **`credifamiliaClose`** (#24, rt=4, `closes.go:217-242`): `GET lenders` radica (status 40) → polling
  `pre-approval-status` → asserta **APROBADO (`lender_transactions.status_id=41`)**.
- **`externalClose`** (rt=1: Welli/Meddipay/CeroPay…, `closes.go:157-182`): con el host mockeado
  (`fakeExternalLendersForLocal`), `GET /lenders` debe devolver el lender con `pre_approved_lender=true` y
  `transaction_data` poblado. Neutraliza el corte horario (`UPDATE lenders SET available_until=NULL` para el
  lender bajo prueba). **Cierre PARCIAL**: el cierre completo es el portal externo (redirect).

> El mecanismo detallado de cada cierre (citas archivo:línea, mocks, rutas exactas) vive en
> [`../docs/REFERENCIA-FLUJOS.md`](../docs/REFERENCIA-FLUJOS.md). La taxonomía `response_type` 0-4 y el ciclo de
> vida de `user_request_statuses` (9 Formulario perfil, 10 Pendiente autorización, 11 Autorizada) en
> [`../docs/NEGOCIO.md`](../docs/NEGOCIO.md). El porqué de los fallos del `random` y las cifras de deuda rt=2 en
> [`../docs/CASOS-ESPECIALES.md`](../docs/CASOS-ESPECIALES.md).

---

## De dónde viene cada flujo (los 11 originales, ahora combinaciones)

Columna clave: **cierre completo (asserta Estado 11) vs parcial (solo valida pre-aprobación / handoff).**

| Flujo original | = canal → comercio → lender | Cierre | ¿Estado 11? |
|---|---|---|---|
| 1 standard_co | `asesor → standard → 77` (CreditopXClose) | completo | ✅ Estado 11 |
| 2 pullman | `asesor → pullman → …` (merchant.Verify: Quanto + CreditopXClose) | completo | ✅ Estado 11 |
| 3 corbeta | `asesor → corbeta → …` (merchant.Verify: laboral dummy + CreditopXClose) | completo | ✅ Estado 11 |
| 4 revolving | `asesor → standard → <lender rt=3>` (revolvingClose) | completo (ciclo 1) | ✅ Estado 11 + Pagaré Maestro |
| 5 motai | `asesor → motai → 158` (motaiClose) | completo | ✅ Estado 11 |
| 6 smartpay | `go run . smartpay` (cadena BDUS/BDTM/DYFS; form-service fakeado) | submit (DYFS1001) | crea `user_request` |
| 7 ecommerce | `web → <branch ecommerce> → 77` (webEntry + CreditopXClose) | completo | ✅ Estado 11 |
| 8 negative_paths | `go run . negative` | n/a (rutas negativas) | n/a |
| 9 bancolombia | `asesor → <branch bancolombia> → 68/100` (bancolombiaClose) | **parcial** | ❌ (motor PLS; cierre en portal del banco) |
| 10 credifamilia | `asesor → <branch credifamilia> → 24` (credifamiliaClose) | parcial (async) | APROBADO (status 41), no Estado 11 |
| 11 creditop_x | `asesor → <branch have_ctopx> → 77/95/37` (CreditopXClose) | completo | ✅ Estado 11 |

> Nota Bancolombia: **#68/#100 tienen `response_type=1` en BD** (no un rt propio). El harness los enruta a
> `bancolombiaClose` **por ID** en el switch, ANTES de la rama `rt==1`/`externalClose`. No asumir que tienen un
> rt distinto. El motor PLS solo decide con el override de documento (ver "Datos y fakes").
>
> Nota Creditop X #37: es rt=2 (`deceval-sin-cred`) y cae igual en la rama default `CreditopXClose`; el routing
> no exige rt==2 (es la rama default del switch). Estado de cierre por UI vs backend en [`VALIDATION.md`](VALIDATION.md).

---

## Datos y fakes (overrides operativos)

Datos PII de prueba y overrides que el harness inyecta para que el motor decida (los hardcodes "de negocio"
viven en [`../docs/LOGICA-QUEMADA.md`](../docs/LOGICA-QUEMADA.md); aquí solo los del harness):

- **`config.go:10-19`** — sin `.env`: conexión hardcodeada (usuario `creditop`/`password`,
  `127.0.0.1:3306`/`creditop`; API `http://127.0.0.1:80/api`; `PartnerHash` default `3e67eade`; `TestAmount`
  1.500.000). El harness **NO lee `.env`**.
- **PII por defecto** (`config.go`): teléfono `3000000000`, doc `1000000000`, email `test@creditop.com`. En
  matriz/`random`/`perfilador` se aíslan por índice con `variant()` (`main.go:172-177`).
- **Override Bancolombia `TestDoc=1998228194`** (`runOne`, `main.go:149-152`): cuando el lender es 68/100 o el
  nombre contiene "bancolombia", el harness fuerza ese documento para activar el **sandbox de cupo** Bancolombia
  en no-prod (sin él el motor PLS no asigna cupo).
- **`fakeBancolombiaForLocal`** (`AppServiceProvider.php:241`): `Http::fake` del host Bancolombia (OAuth +
  `validate-quota` BNPL + `validate` Consumo). Sin él el motor PLS no decide.
- **`SeedApprovedProfile`** (`mocks.go:15`) / **`SeedRiskProfile`** (`mocks.go:44`): siembran perfil
  datacrédito vía `php artisan tinker` (score, negativos, `field 160` reportado). `runOffer`/cierres rt=2
  siembran score 750; `perfilador` varía 800/350/reportado.
- **Otros fakes** (todos en `AppServiceProvider.php:31-35`, working tree): `fakePdfMapperForLocal`
  (`PDF_MAPPER_FAKE=true`), `fakeExternalLendersForLocal` (Welli/Meddipay/CeroPay),
  `fakeDynamicFormsServiceForLocal` + `fakeFormsServiceRoutesForLocal` (SmartPay).
- **Seed `setup`** (`database.Migrations`, `database.go:104-111`): product_categories, countries
  (id 60 = República Dominicana, requerido por SmartPay), lender_paths, statuses.

> Estado, resultado y bypasses pendientes de stash de cada flujo → [`VALIDATION.md`](VALIDATION.md).
> Clasificación de los fallos del `random` (mapa de completitud por rt) → [`../docs/CASOS-ESPECIALES.md`](../docs/CASOS-ESPECIALES.md).

---

## Conexión: SIEMPRE a la BD/stack LOCAL

- **BD**: contenedor `legacy-backend-mysql-1` → schema `creditop` (usuario `creditop`/`password`), expuesto en
  `127.0.0.1:3306` por TCP. Consola: `docker exec legacy-backend-mysql-1 mysql -ucreditop -ppassword creditop -e "SQL"`.
- **API**: `http://127.0.0.1:80/api` (`config.go:13`).
- El seed/bypass de perfil corre `php artisan tinker` dentro de `legacy-backend-laravel.test-1` (`mocks.go:32`).

El par "frontend" de este harness (Playwright, mismo stack desde la UI del wizard) está en
[`../frontend-e2e/README.md`](../frontend-e2e/README.md); su estado + detalle SmartPay/mutex/Cognito en
[`../frontend-e2e/VALIDATION.md`](../frontend-e2e/VALIDATION.md).
