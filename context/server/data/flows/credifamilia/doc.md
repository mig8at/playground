# Credifamilia · contexto
> **estado:** al día con main · **Único lender `response_type = 4`**, híbrido: CreditOp origina in-platform pero el crédito se radica en Credifamilia por SOAP.

> ⚠ **LOCAL (2026-07-19, ver findings F-31/F-36/F-37):** el recorrido in-platform corre casi entero por API en local — el muro NO es el SOAP de radicación. Bloqueos reales, en orden: (1) `vinculacion` vía `pdf-mapper-service` — único doc `default => 'microservice'` sin fallback Blade — **resuelto** con `mock-pdf-mapper` :8100; (2) pagaré **Deceval**: exige `deceval_cert`/`deceval_key` X.509 en la credencial del par, que **no existen en el dump** (la credencial trae claves `credifamilia_*`) → 502 `createGirador`, decisión de NO mockear; (3) firma **Netco**: `NETCO_PASSWORD_DERIVATION_SECRET` ausente — y Credifamilia es el ÚNICO lender que referencia `signing_providers` (los demás firman in-platform). Queda en estado 28. Bonus: su `confirm` revela el KYC (`crosscore_validation · crosscore_biometric_enrollment`) y `simulate-payment-schedule` da 500 sin detener el flujo.

## Qué es
Credifamilia (lender **24**) es el único `response_type = 4` (un valor sin fila en el catálogo `response_types` 0-3). Es un **híbrido**: CreditOp origina **adentro** (identidad, plan de pagos, firma) como un CreditopX in-platform, pero el crédito se **radica en Credifamilia por SOAP** y lo gestiona el lender. Producto: **libranza privada de consumo** (`tipoProducto='Libranza'`).

| Pregunta | Respuesta |
|---|---|
| ¿Quién decide? | **Mixto**: gate LOCAL en el listado (0% si `totalNs<12` o `!debtCapacity`, en `SpecialConditionsController`) + decisión FINAL del lender al radicar |
| ¿Quién pone la plata / cobra? | Credifamilia |
| ¿Cómo cierra? | Origina in-platform → **radicación SOAP** → *polling* hasta APROBADO/RECHAZADO (estados **40/41** de `lender_transaction_statuses`, otro namespace que `user_request_statuses`) |
| ¿Simulable E2E? | ⚠ **Parcial**: el gate local sí es inyectable; KYC V2 (Evidente/CrossCore/Jumio) y la radicación SOAP son externos |

## Antes de concluir
- ⚠ **Un «APROBADO» de Credifamilia NO garantiza que venga el cupo.** Ante entrada inválida —el caso
  medido fue un correo con tilde— responde `Aprobado` con el payload **vacío**, y
  `PreApprovedLenderService.php:325-333` lo marca `pre_approved_lender = true` con
  `available = null`. El lado del RECHAZO sí tiene guarda para respuestas incompletas (`:335`); el
  del aprobado no. Síntoma: «no sale la opción para Credifamilia», sin error visible. Ver **F-113**.
- **Tiene límite de intentos DE SU LADO** (responde `status:3 / Rechazado` al agotarse) y ese límite
  no existe en nuestro código. Al depurar, un rechazo por intentos agotados es indistinguible de un
  rechazo de riesgo — y puede tapar el diagnóstico del problema original.

- **Único con flujo legal de documentos completo**: `ENABLED_LENDERS_FOR_LEGAL=[24]` — TyC sin firmar por WhatsApp, PDF vía `pdf-mapper-service`, custodia en **S3**. Es el patrón de firma/custodia que el plan Motai/Alta generaliza.
- ⚠ **POR QUÉ «NO SALE» EN PRUEBAS — medido el 2026-08-23, y NO es el buró.** La sucursal que se probó la excluye por una regla de grupo cuyo criterio es **`ocupación = Independiente`** (más edad 20–74, ingreso ≥ 1.850.000 y sin reportes). Y esa condición es **inalcanzable por el camino normal**: escribir el ingreso de Experian **pisa la ocupación con `Empleado` quemado** (**F-158**), aunque Agildata haya deducido `Independiente` correctamente. Dictar el buró para cumplir la regla **no alcanza**, y el síntoma es una ausencia silenciosa — antes de tocar el buró, mirá el valor FINAL del campo 29.
- **El OTRO gate, el del buró, es de otra regla — no los mezcles.** requiere fila de buró con `economicSector==1`, **≥12 'N' consecutivas**, sin negativos, y `cuota×1000/ingreso ≤ 0.4`. El fixture base trae sector 3/4 → `totalNs=0` → **0% por defecto**.
- **⚠ [CRÍTICO] Ambigüedad rt=2 vs rt=4**: el front y la memoria del equipo lo tratan como **rt=2** (CreditopX), pero la formalización SOAP y el plan extra-details en legacy **solo corren con `response_type==4`**. La BD confirma **rt=4** para id=24. Riesgo de configurarlo mal.
- **Colisión de ID**: lender 24 = Credifamilia, pero **allied 24 = Creditop**. Verificar el namespace antes de tocar un "24".
- No confundir con **"Credifamilia-addi"** (entrada redirect del catálogo en algunas sucursales).
- **El form_type 6 (additional-info) NO tiene seeder** — es data cargada a mano en dev/local. Un campo nuevo se agrega por migración/seeder en legacy-backend resolviendo por **NOMBRE** (los `field_id` son auto-increment y difieren por ambiente: "Ciudad de nacimiento" salió **233** en dev, 221/222 en local). Tras tocar la BD, **`PUT /v1/dynamic-form/6/schema`** para bustear el cache del form-service. Para VER el form: flow **`self-service`** (público), no `merchant`. Ver **form-service**.

## Contenido
**Las 3 integraciones = 3 etapas:**
1. **REST (pre-aprobación)** — Credifamilia es el ÚNICO lender con **polling** contra `/v1/preapprovals/check` (gateado por id=24, backoff 2/4/8/16/20s, 6 intentos, 180s) y el ÚNICO con **plan de cuotas dinámico** por backend (`supportsDynamicPaymentPlan(24)`).
2. **KYC V2 greenfield** (todo en legacy-backend) — jornada de identidad que ramifica por `step_details.type`: **Evidente** (validar → OTP → cuestionario → verificar) o **CrossCore + Jumio** (biométrico → webhook → evaluate) o AWS/ADO.
3. **Consumo SOAP (radicación)** — al autorizar (**Estado 11**), si `response_type==4` se dispara la formalización SOAP (`transaccionConsumo` + `guardarDocumentoOpenKm`) que radica el crédito con un PDF unificado de todos los documentos firmados.

**Recorrido punta a punta:** `/lenders` (Credifamilia "Pre aprobado", polling) → seleccionar → `update-user-request` → (rt=2 in-platform, sin URL) → `/confirmation` (cliente) + `/continue` (asesor, QR de autogestión) → jornada de identidad (Evidente / CrossCore+Jumio / AWS) → `first-payment-date` + plan de pagos (amortización francesa en backend) → `payment-schedule` → `sign-documents` (pagaré Deceval + docs Netco, OTP) → authorize (**Estado 11**) → **formalización SOAP** → voucher + notificación al comercio.

## Dónde mirar
- **Marketplace / pre-aprobación / selección** (front): `available-lenders.tsx`, `AvailableLenders.tsx`, `fetch-lender-preapproval.ts` (el polling), `lender-response.mapper.ts`, `lender.constants.ts` (`CREDIFAMILIA_LENDER_ID=24`, `supportsDynamicPaymentPlan`).
- **Handoff / identidad** (front): `loan-confirmation.tsx`, `loan-continue.tsx`, módulo `identity-validation/*` (UCs de Evidente + CrossCore).
- **Plan de cuotas dinámico** (front): `usePaymentPlanOptions.ts`, `payment-plan.repository.ts`, `payment-plan-options.tsx`.

⚠ **El wizard pide las cuotas SALTEÁNDOSE la validación de lender.** `payment-plan.repository.ts:49`
llama `…/loan-options/{loanRequestId}/{amount}` con **`?skip_lender_validation=true`** — siempre, no
condicionado. El controller lo lee (`CredifamiliaLoanOptionsController.php:24`,
`$request->boolean('skip_lender_validation')`) y lo pasa como 3.º argumento a
`CredifamiliaLoanOptionsService::handle` (`:31`). Con el flag en `false` (el default) la consulta exige
que la solicitud tenga `lender_id` **NULL, 0 o el de Credifamilia** (`:35-40`); con `true` esa
restricción **no se aplica**, así que el endpoint cotiza Credifamilia incluso para una solicitud ya
asignada a otro lender. Al depurar cuotas que "no deberían salir", mirar acá antes que la data.
- **Orquestación** (legacy): `ContinueUserFlowController.php`, `CreditopXFlowService.php`, `lenders/{LenderRetrievalService,PreApprovedLenderService}.php`.
- **Identidad — Evidente** (legacy): `app/Services/Lenders/CredifamiliaV2/Evidente/*` + `EvidenteController`.
- **Identidad — CrossCore + Jumio** (legacy): `app/Services/Lenders/CredifamiliaV2/CrossCore/*` + `CrossCoreController` + `ProcessCrossCoreEvaluation`.
- **Plan de pagos / amortización** (legacy): `app/Services/PaymentPlan/Credifamilia/*` (Engine/Math/ValueObjects) + los 7 controladores `PaymentPlan/Credifamilia*`.
- **Firma** (legacy): `Signing/Netco/*`, `CredifamiliaDocumentsBuilder`, `DocumentSigningService`, `DecevalPromissoryNoteService`.
- **Formalización SOAP** (legacy): `Pdf/{CredifamiliaFormalizationService,CredifamiliaLegalizationDocumentService,PdfMergeService}`, `Actions/Lenders/CredifamiliaConsumo/*`, `CredifamiliaConsumoService`, `LoanAuthorizationService`.
- **Bonificación / condiciones especiales** (legacy): `Jobs/Lenders/Credifamilia/*`, `SpecialConditionsController`.
- **Formulario adicional (G2, form_type 6)** — entre la identidad y la firma, Credifamilia muestra el form dinámico "backend-driven" (ruta `additional-info`): datos personales / PEP / TIN + la cascada **Departamento→Ciudad** (nacimiento, residencia, trabajo, expedición CC). Lo sirve el **form-service** (MS Go, no legacy); las respuestas caen en `user_field_values` (`form_id=6`). Ver nodos **form-service** y **dynamic-forms**. Front: `apps/loan-request-wizard/app/routes/additional-info-form.tsx`.

## La mecánica del SOAP de radicación (lo que los 9 archivos de `CredifamiliaConsumo` no dicen solos)

**Quién lo dispara.** No es un job ni un endpoint: `CredifamiliaConsumoService` implementa
`LenderFinalizationServiceInterface` y está registrado en
`Modules/Onboarding/App/Providers/OnboardingServiceProvider.php:185`. Entra por `finalize()` — su
`consult()` **lanza `LogicException`** a propósito (la pre-aprobación viene por el REST, no por acá).
Deja rastro con los marcadores `CredifamiliaConsumo finalize started` y `… finalize request built`.

**Dos operaciones, y los namespaces CAMBIAN entre ellas** (`SoapClient.php:31-45`, `:63`):

| operación | wrapper | namespace de los hijos |
|---|---|---|
| `transaccionConsumo` | `<ns:request>` | `http://request.web.proptech.credifamilia.com/` |
| `guardarDocumentoOpenKm` | `<ns:documentoConsumo>` | `http://dto.proptech.credifamilia.com/` |

Comparten `http://web.proptech.credifamilia.com` para la operación en sí. Confundir el wrapper no da un
error de esquema: rompe el handler del otro lado con **`Index out of bounds`**.

⚠ **El nombre del segundo servicio en el manual del proveedor (V5.3) es incorrecto.** Llamar
`guardarDocumento` —como dice el manual— devuelve **`EPR not found`**; el WSDL solo expone
`guardarDocumentoOpenKm`.

⚠ **Hay una capa de firma que el manual tampoco documenta: WS-Security X.509, además del mTLS.** Se
descubre leyendo el `wsp:Policy` del WSDL. Hay que firmar **`<soapenv:Body>` Y `<wsu:Timestamp>`**
(canonicalización exclusiva + RSA-SHA256, `:243-253`) y embeber el cert como `<wsse:BinarySecurityToken>`.
Consecuencia de diseño: **el `\SoapClient` nativo de PHP no sirve** —no deja inyectar el header antes del
send—, por eso el transporte es cURL directo con `CURLOPT_SSLCERT`/`SSLKEY` (`:448`). Se resuelve con PHP
core (`DOMDocument::C14N` + `openssl_sign`), sin `robrichards/wse-php` ni `xmlseclibs`.

**Estados e idempotencia** (`CredifamiliaConsumo.php:62-66`): `CREDIT_REGISTERED` (200) ·
`CREDIT_DUPLICATED` (409) · `CREDIT_INVALID` (400) · `CREDIT_ERROR` (500/SoapFault) · `CREDIT_COMPLETED`
(tras el documento). ⚠ **Son otro namespace que los estados 40/41** de la tabla de arriba. `register()` no
re-llama si ya existe una `LenderTransaction` `REGISTERED`/`DUPLICATED`/`COMPLETED` para ese
`user_request_id` (`:388`), y en el documento **200 y 409 mapean los dos a `COMPLETED`** — el 409 como
idempotencia, con la nota del propio código: *«no documentado pero seguro»* (`:338`).

⚠ **Las credenciales las siembra un comando que escribe claves que el Action no lee → F-137.** El Action
lee las del REST (`credifamilia_cert` / `credifamilia_key` / `credifamilia_password`), no las
`credifamilia_consumo_*`. Antes de depurar «falta la credencial», leé el finding.

**El PDF unificado va en orden fijo**: formulario · FGA (fianza) · tratamiento de datos · autorización de
desembolso · cédula. Lo arma `pdf-mapper-service` (Go) y el Action recibe el base64 ya generado.

**Reglas de formato que impone el proveedor** y que explican rechazos por dato, no por riesgo: fechas
`DD/MM/YYYY`, celular de 10 dígitos que empieza en `3`, dirección solo con `#` y `-`, plazo del enum
`{6,9,12,18,24,36,48,60}`, día de pago `02` o `16`, `tipoFianza` `Mensual`/`Anticipada`.

> Los `.md` del repo — `legacy-backend/docs/lenders/credifamilia/` (README, ESTADO, RESUMEN,
> PRUEBAS-Y-CONSULTAS, FORMALIZACION-PDF-CONTEXTO, `test/README`) — son de **2026-06-01** y describen como
> pendiente lo que ya corre: dan el trigger por «a definir» cuando existe, y separan credenciales que el
> código unificó. Sirven para el manual del proveedor y el detalle campo a campo; **para el estado, no**.

## Por qué «no consulta Credifamilia»: dos causas distintas

Es el segundo reporte más frecuente de #tech-ops después del webhook del agregador (3 casos en 5 días,
medido el 2026-08-05), y detrás hay **dos** cosas que no se parecen:

**1. Sin situación laboral, Credifamilia LANZA.** `app/Actions/Lenders/Credifamilia.php:216-221` mapea el
EAV **campo 29** (situación laboral) a su `tipoOcupacion` con un `match` de tres valores —`Empleado`→2,
`Independiente`→4, `Pensionado`→5— y su `default` es
`throw new \DomainException('Could not generate a transaction with this employment situation')`. O sea que
un usuario sin ese campo, o con cualquier otro valor, **no genera transacción**: la entidad no aparece y el
motivo no es de riesgo sino de dato faltante.

⚠ Y engancha con una trampa ya documentada en **kyc**: el campo 29 se escribe **`'Empleado'` hardcodeado**
al procesar Quanto (`Experian.php:374`). Así que el valor puede existir sin que nadie lo haya declarado —
lo cual hace pasar la compuerta, no fallarla. Los dos comportamientos conviven.

**2. Credifamilia puede devolver un APROBADO EN FALSO.** Con un correo que trae caracteres no válidos en la
parte local (el caso medido: una `é`), su API responde **`Aprobado` sin datos** en vez de un error que diga
qué pasó; el rechazo real aparece después como
`{"transactionId":…,"status":3,"status_detail":"Rechazado","valor_disponible_para_comprar":null,"url":null}`.
Consecuencia para soporte: la primera respuesta parece un éxito y el síntoma que ve el comercio es «no sale
la opción», que no se parece en nada a la causa.

> **FUENTE: el hilo de #tech-ops del 2026-08-05**, con el JSON pegado por quien lo investigó — no está
> verificado en código nuestro (es comportamiento de la API de ellos, y del lado nuestro sólo se ve la
> respuesta). Se registra porque el síntoma es recurrente y la causa no se deduce de los logs.

Sobre el correo hay un cambio en `main` que conviene no malinterpretar:
`Modules/Onboarding/App/Services/DynamicFormsService.php:1446-1461` reemplazó la regex casera
`[A-Za-z0-9._%+-]` por la regla `email` de Laravel (RFCValidation). Va en **dirección contraria** a
«bloquear caracteres especiales»: acepta todos los que el RFC permite en la parte local y rechaza los que
no. ⚠ No está confirmado que sea el cambio que cerró este incidente — vive en la ruta del **formulario
dinámico G2**, no en la del onboarding clásico por donde entró el caso.


## Regenerar los documentos de legalización — el endpoint sin autenticación

Entró a `main` el **2026-08-13** (dos commits de Oscar Rincon: *«locked endpoint»* → *«ship it
unlocked»*). Regenera y **vuelve a firmar electrónicamente ante Netco** los documentos de legalización
de una solicitud ya formalizada, sin que el cliente participe.

    POST /api/loans/admin/user-requests/{userRequestId}/regenerate-credifamilia-documents
    body: doc_types[] ⊂ {consent, disbursement_authorization, guarantee,
                         payment_schedule, regulation, terms_conditions}

Qué hace, en orden: arma los PDFs con `pdf-mapper-service`, **resetea las filas de
`netco_signing_documents` a `generated`** limpiando el `netco_uid` anterior para forzar la refirma, y
manda a firmar. El **pagaré queda afuera a propósito** porque va por Deceval, no por Netco.

⚠ **Reutiliza el ÚLTIMO OTP del usuario** (`otpRepository->findLatestByUserId`) en vez de pedirle uno
nuevo: la firma nueva se ata a una autenticación que el cliente hizo antes, para otra cosa. Y toma un
lock de caché `netco-sign:{userRequestId}` por 120 s para no chocar con una firma del cliente en curso
— la existencia de ese lock dice que las dos cosas pueden pasar a la vez.

### ⚠ El grupo `api/loans/admin` NO tiene autenticación

`Modules/Loans/App/Providers/RouteServiceProvider.php` monta ese prefijo con `->middleware('api')` y
nada más: sin `auth`, sin Cognito, sin roles. `admin.php` tampoco agrega middleware de grupo, y el
`authorize()` del FormRequest devuelve `true`. **No es un descuido y está documentado en el propio
controlador**, que además trae el interruptor:

    private const UNLOCKED = true;   // en `false` responde 423 y no ejecuta nada

El comentario del autor lo dice con todas las letras: *«el endpoint es ejecutable por cualquiera que
alcance la red»*, y que regenerar *«produce una firma electrónica NUEVA, con marca de tiempo nueva,
sobre un documento que el cliente pudo haber firmado ya»*.

⚠ **No es sólo este endpoint**: `POST /{userRequestId}/formalize-external-managed` vive en el mismo
grupo y hereda la misma falta de autenticación.

### No valida estado de la solicitud

No exige ningún `user_request_status_id`. Lo que sí exige de hecho: que la solicitud tenga configurado
el proveedor **Netco** y que el usuario tenga un OTP previo en la base. Una solicitud sin OTP no se
puede regenerar — y ése es el único freno real que hay.
