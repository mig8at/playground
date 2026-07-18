# Onboarding · contexto
> **estado:** al día con main · La fase de SOLICITUD: entrada por link de sucursal → celular/OTP → se crea la `user_request` → formulario personal/laboral → estudio del cliente (KYC).
<!-- Seed desde playground/flow; superficie de código a linkar en la fase de data. -->

## Qué es
Onboarding es la fase donde se **arma la solicitud** antes de que la consolidación (getLenders) decida qué se ofrece. El usuario entra por un **link de sucursal con `hash`** (o por ecommerce con el monto en query base64), registra el celular, valida OTP y llena el formulario. El sujeto que resulta —la `user_request` más los datos personales/laborales y el perfil de buró (KYC)— es lo que después evalúan las reglas.

El punto no-obvio que marca el simulador: **la `user_request` NO nace en el simulador ni al capturar el monto**. El monto se captura antes (session/base64/body) y solo viaja; la solicitud se crea **tarde**, al validar OTP o guardar la info personal (`createUserRequest`, estado 1→9). El disparo del listado es un `GET` **JSON síncrono** (`entidades-v2` / `lenders-v2`), no SSE.

## Contenido
Orden real de la fase (MAP.md §S3):
1. **Entrada por hash** → resuelve la `AlliedBranch`, fija `allied_branch_id` + `allied_id` en sesión. Ecommerce entra con el monto en query base64.
2. **Captura de monto** — ANTES de crear la UR. Tres orígenes según canal: `session('amount')` (asesor), query base64 (ecommerce), body `amount` del otp-validate (wizard); en legacy el body tiene prioridad. `startV2` solo guarda sesión y **redirige, no crea UR**.
3. **Registro de celular + OTP** — application **delega a legacy** (`POST /api/onboarding/phone/register`). El envío de OTP ya está migrado.
4. **CREA la `user_request`** — `createUserRequest` hace `updateOrCreate` con `lender_id=null`, `credit_line_id=1` ("Libre inversión"), `fee/rate=0`, monto de sesión, estado 1 → luego estado **9**. Se **recicla**: reutiliza una UR previa en estados [1,3,9] del mismo user+sucursal.
5. **Formulario dinámico** personal/laboral → dispara la consulta de buró (KYC, §S4).
6. **Disparo del listado** — `GET entidades-v2/{userRequest}` (application) / `GET lenders-v2/{id}` (legacy), JSON síncrono. Ojo: **número mágico 180000** como default de monto si el front no lo manda.
7. **Selección de lender** → estado 3.

Campos que el simulador modela como inputs de la solicitud (nodo Solicitud): **Monto** (`user_requests.amount/original_amount`), **Cuota inicial** (`user_requests.initial_fee`, el % lo exige la categoría rt=2, no el comercio), **Salario declarado** (`user_field_values` field 87 — solo se pide si Ágil/Mareigua/Quanto no reportaron ingreso), **Tipo/N° de documento** (`users.document_type/number`; el N° gatea la consulta de buró), Nombre/Apellido (display), Fecha de expedición (dato de KYC, ninguna regla del simulador la usa).

Nota de terminología: el "PEP" del selector de tipo de doc es **Permiso Especial de Permanencia** (migratorio, Motai renting), NO Persona Expuesta Políticamente (eso es AML, ver KYC).

## Subcontextos
- **KYC** — el estudio del cliente (buró): Experian/Datacrédito da el único score; TusDatos identidad+AML; Ágil Data/Mareigua ingreso; Quanto ingreso estimado; todo cifrado en `risk_central_user_data` + espejo a `user_summaries` y EAV.

## Dónde mirar
- **Entrada por hash / celular** (application): `app/Http/Controllers/Customer/RegisterCellPhoneController.php:77` (index) · `:138-146` (resuelve `AlliedBranch::where('hash')`) · `:232-241` (ecommerce, amount base64) · `:179-222` (store → delega a legacy).
- **Resuelve sucursal** (legacy): `Modules/Onboarding/App/Services/UserRequestService.php:73` (`findByHash`) → `:124-125` (copia `allied_id/allied_branch_id`).
- **Captura de monto** (application): `app/Http/Controllers/Customer/SimulatorController.php:110-188` (config min/max) · `:190-211` (`startV2`, guarda sesión, no crea UR). Wizard (frontend): `apps/loan-request-wizard/app/routes/dynamic/request-amount.tsx:200`.
- **Crea la user_request** (application): `app/Http/Controllers/Customer/UserRequestController.php:58` (`createUserRequest`) → `:89-108` (`updateOrCreate`) → `:191` (estado 9). Callers: `ValidateOtpController.php:240`, `PersonalInfoController.php:265`. Gemelo legacy: `UserRequestService.php:71` → `:111-138` → `:241`.
- **Disparo del listado** (application): `app/Http/Controllers/Customer/ListLenderController.php:226` (`indexV2` → `getLenders`). Legacy: `Modules/Onboarding/App/Http/Controllers/LenderListingController.php:17`. Frontend: `.../lenders-marketplace/.../loan-options.repository.ts:25` (timeout 60s).
- **Tablas**: `user_requests` (user_id, allied_id, allied_branch_id, amount, original_amount, credit_line_id=1, user_request_status_id) · `user_request_statuses` · `user_request_records` (historial) · `allied_ecommerce_credentials` (bifurca canal) · `creditop_x_user_requests_records`.

## Gotchas / riesgos
- El simulador **no crea la solicitud** (startV2 solo guarda sesión + redirige); nace al validar OTP / guardar info.
- El monto tiene **3 orígenes** según canal y en legacy el body gana; el default **180000** enmascara el monto real si el front no lo manda.
- `lenders-v2` **no es SSE**: el "streaming" lo hace el loader del front resolviendo pre-aprobaciones lender-a-lender.
- La UR se **recicla** en estados [1,3,9]; `session('allied_branch')` guarda el **objeto** `AlliedBranch` (no un array).
- Valores quemados al crear: `credit_line_id=1`, `lender_id=null`, `fee/rate=0`.
- Estados de `user_requests`: `1` creada · `3` selección de entidad · `9` formulario perfil · `11` aprobado/desembolso · `25/26` otros.

## Bitácora
- **2026-07-17** — Contexto sembrado desde playground/flow (nodo SolicitudNode + fieldDocs `node.solicitud`/`sol.*` + MAP.md §S3).

## Enlaces
- Padre: raíz **CreditOp**. Subcontexto: **KYC**. Simulador: playground/flow (nodo Solicitud). Mapa: playground/flow/MAP.md §S3.
