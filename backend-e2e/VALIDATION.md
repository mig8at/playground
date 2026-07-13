# VALIDATION — estado de validación BACKEND (legacy-backend LOCAL, modo mock)

> Fecha: 2026-06-05 · Backend: `feature/onboarding/ecommerce-web-origination` con drivers `fake`.
> **Pre-requisito**: `stash@{0}` del legacy-backend = **set COMPLETO de bypasses** (Bancolombia, externos rt=1,
> dynamic-forms, SmartPay forms-service fake, Credifamilia, Motai MDM, PdfMapper). El fake de PdfMapper además
> está gated por `PDF_MAPPER_FAKE=true` en el `.env`. Re-aplicar y limpiar config: ver
> [SUITE.md → Requisitos](./SUITE.md#requisitos).

Este documento es el **dueño del estado de validación backend-only**: por flujo de originación dice qué
comando lo probó, qué se aseveró (tabla/columna/status concreto) y si está **verde** o **amarillo**, con el
bypass requerido **por referencia** (no copiado). Lo complementan:

- **Cómo correr** (CLI, subcomandos, ejemplos, cadena de cierre rt=2) → [SUITE.md](./SUITE.md).
- **Taxonomía `response_type` 0–4 y ciclo de vida `user_request_statuses`** → [../docs/NEGOCIO.md](../docs/NEGOCIO.md).
- **Estructura de tablas/columnas/relaciones** → [../docs/MODELO-DATOS.md](../docs/MODELO-DATOS.md).
- **Hardcodes (IDs, montos, status, branches, PII)** → [../docs/LOGICA-QUEMADA.md](../docs/LOGICA-QUEMADA.md).
- **Por qué "falla el random" / clasificación de fallos** → [../docs/CASOS-ESPECIALES.md](../docs/CASOS-ESPECIALES.md).
- **Mecanismo por flujo (qué hace distinto, citas archivo:línea, mocks)** → [../docs/REFERENCIA-FLUJOS.md](../docs/REFERENCIA-FLUJOS.md).

---

## Matriz de estado backend-validado

| Flujo | Estado | Comando (→ [SUITE.md](./SUITE.md#cli)) | Aserción concreta | Bypass requerido |
|-------|--------|-----------------------------------------|-------------------|------------------|
| **rt=2 in-platform → cierre** | 🟢 verde | `asesor 3e67eade 77` (Pullman → CrediPullman) | `user_requests.user_request_status_id = 11` (Autorizada) | PdfMapper fake (`PDF_MAPPER_FAKE=true`) · seed perfil aprobado |
| **Corbeta (inyección laboral dummy)** | 🟢 verde | `asesor a1c0b15d 68` (Alkosto, allied 209) | `merchant.Verify`: field 87 = 1.500.000, field 29 = Empleado (inyección corbeta confirmada). Cierra con **#68 Bancolombia** (lender que Alkosto SÍ ofrece — 209 no tiene rt=2 in-platform; usar 77 daba pagaré 500 porque 77 es de Pullman/allied 94) | — (auto-inyección del backend) |
| **Web / ecommerce (handshake base64)** | 🟢 verde | `web 17f7b360 77` (Pullman ecommerce, allied 94) | handshake base64 → register → otp → personal → laboral → **cierre CrediPullman #77 → Estado 11** + **webhook de cierre a la tienda**: el harness levanta un mock store (`host.docker.internal:9099`), apunta el `process_url` ahí y assertea `ecommerce_requests.processed=1` **y** POST recibido (paso 10/10 "Notificación al comercio"). El hash `d63f05e7` (Amoblar 38) sólo ofrece rt=1 → no cierra in-platform | — |
| **Rutas negativas (anti-fraude)** | 🟢 5/5 | `negative 3e67eade` | step1/2 `ONB001` (OTP) · step3 HTTP 422 (email) · step4 `ONB005`+`EXPEDITION_DATE_INVALID` (31-feb) · step5 **documento duplicado** (`DOCUMENT_DUPLICATE`) ✅. *Fix causa raíz:* el dueño original usa teléfono+documento FRESCOS (no `phoneA`, contaminado por pasos 1/4) → `findByDocumentAndType` lo detecta | OTP bypass (`qa_otp_bypass_phones`) |
| **Matriz multi-lender** | 🟢 verde | `asesor 3e67eade 77,96,37` | reporta 1✅/2❌ por entidad correctamente | igual que rt=2 |
| **Pullman Quanto (auto-ingreso)** | 🟢 verde | `asesor 3e67eade 77` | cierre → Estado 11 **y** Experian Acierta+Quanto inyecta el ingreso en `field 87`. Exige que el harness NO mande el documento en register (ver Hallazgo 4) | igual que rt=2 |
| **Revolving (rt=3)** | 🟡 ciclo 1 | `asesor 3e67eade 71` | ciclo 1: Estado 11 + Pagaré Maestro ✓; ciclo 2 (dedup pagaré) sin validar | seeds `creditop_x_revolving_credits` + `lenders_by_allieds`(71,94) |
| **Bancolombia (motor PLS)** | 🟡 PLS (no cierre) | `asesor bccce1c6 68` | `validate-preapproved` asigna lender 68 (BNPL) / 100 (Consumo) al `user_request` → "cupo en BNPL". El cierre OAuth es el portal del banco, fuera de alcance | `fakeBancolombiaForLocal` (Http::fake host) · `TestDoc=1998228194` (doc sandbox con cupo) |
| **Externos rt=1 · Welli (#23)** | 🟢 verde | `asesor 1941e23b 23` (Varix Center, allied 74) | `Welli::consult()` pre-aprueba → `GET /lenders` ofrece con `pre_approved_lender=true` y `transaction_data` poblado (WELLI-FAKE-001, cupo 5M) | `fakeExternalLendersForLocal` (Http::fake `run_risk`) |
| **Externos rt=1 · Meddipay (#39)** | 🟢 verde | `asesor 76db47f5 39` (Sonría, allied 26) | auth `/User/Login` + `/CreateOrder` mockeados → `result=APP` → pre-aprobado (MDP-FAKE-001) | `fakeExternalLendersForLocal` · neutralización del corte horario (ver Hallazgo 5) |
| **Externos rt=1 · BdB CeroPay (#133)** | 🟡 mock listo | — | mock host (auth + `/KYC` IsViable=true) construido, pero ningún branch del allied asociado (254) tiene credenciales → no se ofrece. **Gap de config, no de mock** | (pendiente seed credenciales) |
| **Externos rt=1 · BdB (#5), Sistecrédito (#9)** | ➖ fuera de set | — | #5 solo redirect al portal (sin pre-aprobación, ya aparece ofrecido); #9 pega a host `*.fake` (mock no construido) | — |
| **Credifamilia (rt=4 async)** | 🟢 verde | `asesor 80059314 24` (Élite Dental, allied 89) | radicación → `lender_transaction_statuses` 40 (CREDIT_IN_PROCESS) → polling → 41 (CREDIT_APPROVED) | bypass `Credifamilia::register()`/`::show()` local |
| **Motai (IMEI + Abaco)** | 🟢 verde | `asesor f0548728 158` (Motai, allied 158) | Estado 11 (ur 463483) | bypass MDM (`AlliedProductService::enroll`) · seed `credit_line_by_lenders` 158 |
| **SmartPay (cadena OTP+submit)** | 🟢 verde | `smartpay` | replica contra legacy-backend: `create-temporary-user` (BDUS002) → `check-user-exists` (BDUS003) → `accept-terms` (BDTM002) → **`dynamic-forms/create-user` (DYFS1001, crea `user_request`)** → `resolve-lenders-redirect` (BDUS005). El esquema del form lo sirve un fake en legacy-backend | `fakeDynamicFormsServiceForLocal` · `.env`: `BACKDOOR_API_KEY` + `ONBOARDING_FORMS_SERVICE_BASE_URL` |
| **Perfilador (motor de riesgo / oferta)** | 🟢 7/7 | `perfilador pullman 77` (CrediPullman) | valida la **DECISIÓN de oferta**, no solo el cierre (ver tabla 7/7 abajo). Varía score/ingreso/edad/reportado contra las reglas duras reales de #77. `profiling_reviews` registra las reglas evaluadas | seed perfil (`mocks.SeedRiskProfile`, struct `RiskProfile`) — sin mocks externos |

> El OTP de generate/validate en sí (micro↔otp-service) **no tiene endpoint en legacy-backend**, así que queda
> fuera del alcance backend-only en SmartPay. El cierre completo de Bancolombia (OAuth, 8 pasos) y de los
> externos rt=1 es el portal externo (redirect), igualmente fuera del in-platform.

### Perfilador — resultado 7/7

`go run . perfilador pullman 77` (CrediPullman) varía **una sola variable por caso** y observa la decisión de
oferta del marketplace (`GET /lenders`). Es el flujo que valida la **política de riesgo**, no solo que el
crédito cierra. Los casos viven en la tabla `perfiladorCases` (main.go), calibrados a las reglas duras **reales**
de #77 (verificadas en BD con `get lender 77`). El qué-decide-el-perfilador (reglas duras → categoría → oferta)
vive en [../docs/NEGOCIO.md](../docs/NEGOCIO.md) y [../docs/REFERENCIA-FLUJOS.md](../docs/REFERENCIA-FLUJOS.md).

| Perfil (1 variable) | Resultado | Regla que gobierna |
|---------------------|-----------|--------------------|
| score 800, ingreso 2.5M, edad 35, limpio | **CrediPullman OFRECIDO** | pasa todas las reglas duras |
| score **350** | **NO ofrecido** | `lender_datacredito_rules.score ≥ 400` |
| **reportado** en centrales (`field 160 = sí`) | **NO ofrecido** | `lender_rules` "reportado = no" |
| ingreso **900k** (`field 87`) | **NO ofrecido** | `lender_rules` ingreso `≥ 1.000.000` |
| edad **85** (`users.age`) | **NO ofrecido** | `lender_rules` edad `≤ 82` |
| ingreso **1.000.000** exacto | **OFRECIDO** (borde `≥ 1M`) | pasa el piso de ingreso |
| edad **18** (mínimo) | **OFRECIDO** (borde `≥ 18`) | pasa el piso de edad |

> Cuando #77 cae por una regla dura, **desaparece de los lenders ofrecidos** (el resto sigue) → confirma que el
> gate es por-lender. `profiling_reviews` se pobló con el registro por lender (`hard_rules` + `recommended_lender`).
> Backlog restante del Perfilador (extender a otros lenders #37/#95, dimensión **mora**, sembrar perfiles por
> categoría) — `SeedRiskProfile` ya soporta `Overdue`, falta calibrar los casos.

---

## Hallazgos clave

1. **El cierre in-platform (rt=2) funciona** forzando el lender + perfil sembrado + PdfMapper fake → Estado 11.
   Validado con CrediPullman (77).
2. **El marketplace real es muy restrictivo**: sin la config de riesgo (`lender_rules`/categorías) adecuada,
   devuelve pocos/cero lenders. Por eso el harness **fuerza el lender** para validar la *mecánica de cierre* de
   cada tipo, en vez de depender de la oferta (la oferta como tal se valida aparte con `perfilador`).
3. **El cierre rt=2 solo funciona con lenders plenamente configurados** (con `promissoryType`). Lenders sin esa
   config dan `promissory-note 500`. El 500 del Pagaré con guarantee se debe a `FGA=0` → PDF null → desreferencia
   null en `authorize` (no a "variable NULL → eval"). Detalle en [../docs/CASOS-ESPECIALES.md](../docs/CASOS-ESPECIALES.md).
4. **El guard de documento duplicado bloqueaba personal-info**: `register` persiste el `document_number`, así que
   `personal-info` veía el doc como duplicado (del mismo usuario) y cortaba con `ONB005` + subcode
   `DOCUMENT_DUPLICATE` (msg `"document number already in use"`) **antes** del bloque Quanto. Para los demás flujos
   es inocuo (el cierre siembra su propio perfil), pero Pullman necesita que `personal-info` ejecute. Fix del
   harness: para Pullman NO se manda el documento en register → `personal-info` lo fija por primera vez y corre
   Experian Acierta+Quanto. Sin tocar legacy-backend.
   *(Nota: `ONB005` es el código genérico `PERSONAL_INFO_VALIDATION_FAILED`, HTTP 200; el caso del documento usa
   subcode `DOCUMENT_DUPLICATE` y el de fecha imposible usa subcode `EXPEDITION_DATE_INVALID` — misma familia.)*
5. **La pre-aprobación rt=1 es selectiva y con corte horario**: `PreApprovedLenderService` solo invoca `consult()`
   para lenders con `lender_allied_credentials` del branch (no para todos los ofrecidos), y **salta el `consult()`
   si `currentTime > lenders.available_until`**. En el mirror local actual ningún lender tiene ese valor poblado
   (39/23/133 tienen `available_until = NULL`), pero el harness lo neutraliza igual (`closes.go:164` hace
   `UPDATE lenders SET available_until = NULL` para el lender bajo prueba) para que el flujo sea determinista
   independientemente del seed.
6. **SmartPay corre 100% local sin S3**: el `onboarding-forms-service` se fakea desde el legacy-backend (no se
   levanta el microservicio). El detalle del fake (wizard → forms-service, `fakeFormsServiceRoutesForLocal`,
   `/api/forms-fake/dynamic/*`) y de la cadena vive en [SUITE.md → SmartPay](./SUITE.md#smartpay-cadena-otpsubmit).

---

## Bypasses / fixtures aplicados

> Todos los bypasses de código del **legacy-backend** ya están en el working tree y respaldados en `stash@{0}`
> (set completo). El **harness** (`playground`) NO es bypass: es la herramienta y se commitea al repo local.
> El detalle de cada `Http::fake`, los seeds y el `.env` (`BACKDOOR_API_KEY`, `PDF_MAPPER_FAKE`,
> `ONBOARDING_FORMS_SERVICE_BASE_URL`) está en [../docs/REFERENCIA-FLUJOS.md](../docs/REFERENCIA-FLUJOS.md) y los
> hardcodes en [../docs/LOGICA-QUEMADA.md](../docs/LOGICA-QUEMADA.md). Resumen de qué cubre cada bypass:

| Bypass / fixture | Para qué | Flujo |
|------------------|----------|-------|
| `AppServiceProvider::fakeBancolombiaForLocal` | Http::fake OAuth + `validate-quota` (BNPL) + `validate` (Consumo) | Bancolombia |
| `AppServiceProvider::fakeExternalLendersForLocal` | Http::fake Welli (`run_risk` → approved 5M), Meddipay (`/User/Login` + `/CreateOrder` APP), CeroPay (`/authorizations` + `/KYC` IsViable) | rt=1 externos |
| `AppServiceProvider::fakeDynamicFormsServiceForLocal` + `fakeFormsServiceRoutesForLocal` | esquema OFS1000 + `genderapi.io` + `/api/forms-fake/dynamic/*` (SmartPay) | SmartPay / dynamic-forms |
| `AppServiceProvider::fakePdfMapperForLocal` (gated por `PDF_MAPPER_FAKE=true`) | Pagaré sin servicio PdfMapper real | cierres rt=2 |
| `Credifamilia::register()` / `::show()` short-circuit en `local` | radicación 40 sin host + estudio APROBADO 41 | rt=4 |
| `AlliedProductService::enroll` short-circuit en `local` | simula MDM enroll (IMEI) sin pegar a `merchant_gateways` | Motai |
| Seed `credit_line_by_lenders` (158, clon de 77) | sin esto el disburse Motai da "rate on null" (`PaymentCalculationService` lee `lender->creditLines->rate`) | Motai |
| Seeds `creditop_x_revolving_credits` + `lenders_by_allieds`(71,94) | cupo/FGA del Pagaré + asociar lender 71 al comercio | Revolving |
| `mocks.EnsureOtpBypass` → setting `qa_otp_bypass_phones` | salta Twilio; el OTP de bypass = últimos 4 dígitos del teléfono | **todos** |
| `TestDoc=1998228194` (forzado en `runOne`) | documento sandbox "con cupo" en no-prod; sin él el motor PLS no decide | Bancolombia |
| Seeds de perfil vía `php artisan tinker` en `legacy-backend-laravel.test-1` | `RiskCentralUserData.data` va encriptado; no se puede sembrar por SQL directo | Perfilador / cierres |

---

## Cómo reproducir

Los comandos del CLI (`web`/`asesor`, `smartpay`, `perfilador`, `negative`, `random`, `offer`, `list`, `setup`
+ los de operación `prep`/`get`/`doctor`/`clean`), sus defaults y ejemplos viven en
[SUITE.md → CLI](./SUITE.md#cli). En particular:

- `random [N]` corre N tripletas válidas al azar (desde `lenders_by_allieds`) y produce un mapa de completitud
  por `response_type` — útil para cobertura.
- `offer <hash>` lista qué lenders ofrece un branch (diagnóstico de marketplace, no cierra).
- `merchant.Verify` es **diagnóstico**: aunque Corbeta/Pullman fallen la verificación de inyección laboral, el
  cierre siembra su propio perfil y llega a Estado 11 igual.
