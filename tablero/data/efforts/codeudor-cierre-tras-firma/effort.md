---
id: 12
title: "Codeudor — cierre propio tras la firma (pantalla \"Firma realizada con éxito\")"
stage: work
created: "2026-07-27T12:13:57-05:00"
context_nodes: [formalization, creditopx]
---

ESTADO 2026-07-28: CONTRATO CERRADO con Santi. Frontend LISTO y apagado; espera el deploy del campo.

CONTRATO ACORDADO (Santi dio el OK a la opción 1 — la de su propia infraestructura)
Backend hará, en la ruta del verify-otp del pagaré (Modules/Loans/routes/api.php):
   Route::post('validate/verify-otp', [ValidateOtpPromissoryNoteController::class, 'verifyOtp'])
       ->middleware('cosigner.token');
y en el success() del controlador:
   'signer_role' => $request->attributes->get('cosigner_actor') === Actor::Cosigner->value
       ? Actor::Cosigner->value : Actor::Applicant->value,
→ nos llega como data.signer_role = 'applicant' | 'cosigner'.
Es seguro para el titular: ResolveCosignerToken es SOFT (sin X-Cosigner-Token hace next() y el flujo del
titular pasa byte a byte igual — verificado en su código).
Nuestro front ya lo lee de data.signer_role, así que no hay que cambiar el envelope ni migrar nada. Esto
también zanja la duda del "dentro de payload": la clave que sale hoy en ese endpoint es 'data' (la variable
$payload del trait ApiResponse es interna).

FRONTEND — HECHO (rama feature/cosigner-signature-success, renombrada desde codebtor-*; 1 commit 719d7c40,
sin pushear, desde qa 2383d77b con --no-track)
Vocabulario unificado al del backend: applicant/cosigner (antes debtor/codebtor). Archivos:
· apps/loan-request-wizard/app/routes/cosigner-signature-success.tsx — pantalla (URL: signature-success)
· apps/loan-request-wizard/app/utils/signer-role.server.ts (+ .test.ts, 6 casos) — punto único de decisión
· apps/loan-request-wizard/app/routes/otp-validation.tsx — bifurcación tras authorize + analytics
· .../routes.ts, .../route-helpers.ts (cosignerSignatureSuccess), promissory-note.entity.ts (signer_role)
Verificado: HTTP 200 + copy correcto servido por el dev server tras el rename; 6/6 tests; typecheck 225 =
baseline de qa; biome limpio.

PENDIENTE (no nuestro)
1. Deploy del campo por Santi → con eso la pantalla se activa sola, sin re-desplegar el front.
2. Fase 5b-part-2 (firma técnica del codeudor + su OTP): BLOQUEADA por Netco/Deceval → hasta entonces
   nadie puede firmar como codeudor y la pantalla no es evaluable. CORE-317 se queda En progreso.
3. Preguntado a Santi y SIN respuesta todavía: (a) ¿el codeudor mandará X-Cosigner-Token en la llamada de
   la firma? (si sí, con lo acordado ya queda), (b) el cableado del deferred_for_cosigner del TITULAR
   → pantalla cosigner-waiting-signature: ¿lo toma él o nosotros? Hoy el front valida ese endpoint solo por
   success:true, así que mostraría "monto aprobado" con la solicitud sin pasar a 11.
4. Al pushear: conflicto trivial esperado en routes.ts / route-helpers.ts contra su rama (líneas distintas).

────────────────────────────────────────

LO QUE SANTI YA TIENE (rama feature/motai/flujo-codeudor, MISMO nombre en legacy-backend y frontend-monorepo)
Backend, 12 commits / 104 archivos / +8.639 líneas, con docs propias en docs/cosigner/:
· F1 datos (cosigners, cosigner_statuses, cosigner_status_records) · F2b endpoints + invitación WhatsApp +
  estado macro 17 "Solicita codeudor" · F3b actor applicant|cosigner en el motor + cosigner/continue ·
  F4 elegibilidad + cosigner/status (polling) · F5a columna signer_role enum('applicant','cosigner') en
  netco_signing_documents + unique de 3 columnas · F5b-part-1 firma cruzada (orden legal) · F5c enganche
  onboarding del codeudor (celular/OTP/formulario/identidad ADO).
Frontend, 7 commits: pantallas del TITULAR (cosigner-phone, cosigner-validating, cosigner-waiting-signature,
  cosigner-approved, cosigner-not-eligible) + entrada del CODEUDOR (cosigner/invitation por deep link,
  self-service-phone).

VERIFICADO CONTRA SU CÓDIGO (no supuesto)
· verify-otp NO devuelve el rol todavía: en su rama el controlador del OTP del pagaré tiene +11 líneas y son
  SOLO la rama del deferral. Lo de "mándalo en verify-otp con applicant/cosigner" es el contrato acordado
  por Slack, aún sin implementar.
· El signer_role que él mencionaba es la COLUMNA de netco_signing_documents (almacenamiento del documento),
  no un campo de respuesta de API. Por eso no lo encontraba antes: vive solo en su rama.
· El codeudor se identifica durante su onboarding por el TOKEN de invitación (X-Cosigner-Token), no por
  verify-otp. Son capas distintas.
· F5b-part-2 (firma técnica del codeudor + su OTP + cierre a 11) está BLOQUEADA por Netco/Deceval → nuestra
  pantalla no es evaluable hasta que eso se desbloquee.
· No hay conflicto con nuestro trabajo: él NO tocó otp-validation ni loan-approved ni el schema del pagaré.
  Solo coincidimos en routes.ts y route-helpers.ts (líneas distintas, conflicto trivial al mergear).

HALLAZGO ABIERTO (no es nuestro alcance, pero hay que avisarlo)
Cuando el titular firma y HAY codeudor activo, el backend NO autoriza: difiere y responde HTTP 200 success
con deferred_for_cosigner=true / status_id=null. El front valida ese endpoint con z.object({success:literal(true)}),
o sea solo mira success → mostraría "¡Felicidades, tu monto ha sido aprobado!" con la solicitud SIN pasar a 11
(el patrón de pantalla-de-éxito-sin-sellar). La pantalla correcta YA EXISTE (cosigner-waiting-signature, de
Santi) y nadie la invoca desde la firma. PREGUNTAR a Santi si ese cableado lo toma él o nosotros.

AL RETOMAR — en este orden
1. Cambiar el vocabulario del resolver: debtor/codebtor → applicant/cosigner (Santi ya lo confirmó).
2. Conectar el campo cuando exista, y confirmar la ubicación exacta (sigue sin aclararse el "dentro de payload":
   ese endpoint responde data.*, no hay clave payload).
3. Resolver el conflicto trivial de routes.ts / route-helpers.ts contra su rama.
4. La tarea CORE-317 se queda En progreso; no pasa a pruebas hasta que se pueda firmar como codeudor.

────────────────────────────────────────

TAREA JIRA: CORE-317 — https://creditop.atlassian.net/browse/CORE-317
Estado: 🚧 En progreso · Sprint activo: CORE Sprint 8 · creada 2026-07-27.
NO se notifica a Duncan todavía: la regla es avisar recién en "En pruebas", y esto no es evaluable
hasta que backend entregue el dato del rol (hoy el codeudor sigue cayendo en la pantalla del comprador).

PEDIDO
Tras firmar el OTP del pagaré, la pantalla final debe depender de QUIÉN firmó:
· comprador → "¡Felicidades, tu monto ha sido aprobado!" (loan-approved, con monto) — como hoy
· codeudor  → "¡Firma realizada con éxito!" (pantalla nueva, solo confirmación, sin acciones)
Por simplificación, el codeudor recorre el MISMO wizard que el comprador; lo único que cambia es el cierre.

ESTADO: hecho en frontend, apagado a la espera del dato del backend.
Rama frontend-monorepo: feature/codebtor-signature-success (desde qa 2383d77b, --no-track).
Commit local 4e1401a0 — 1 solo commit, SIN pushear todavía (Miguel decide).

ARCHIVOS (7)
· apps/loan-request-wizard/app/routes/codebtor-signature-success.tsx — pantalla nueva (molde: request-sent.tsx, CheckIcon)
· apps/loan-request-wizard/app/utils/signer-role.server.ts — resolveSignerRole(): ÚNICO punto de decisión
· apps/loan-request-wizard/app/utils/signer-role.server.test.ts — 6 casos (vitest), pasan
· apps/loan-request-wizard/app/routes/otp-validation.tsx — la bifurcación tras authorize + signer_role en analytics
· apps/loan-request-wizard/app/routes.ts — route("signature-success", …)
· apps/loan-request-wizard/app/utils/route-helpers.ts — ROUTE_PATHS.codebtorSignatureSuccess
· modules/loan-request-wizard/loan-origination/src/lib/domain/promissory-note.entity.ts — signer_role opcional

DÓNDE ESTÁ EL CAMBIO
otp-validation.tsx, action, tras authorizeResult.isOk(): antes iba SIEMPRE a ROUTE_PATHS.loanApproved.
Ahora: signerRole === "codebtor" ? codebtorSignatureSuccess : loanApproved.
Precedente que se usó de molde: la bifurcación por verifyData.metadata.lender_path === "IMEI" → securityValidation.

PENDIENTE — BACKEND (Santi)
El dato NO existe hoy: en el pagaré los campos de codeudor van vacíos
(Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php:272-274,
codebtor_name / codebtor_document_number / codebtor_address = '') y no hay endpoint ni tabla de codeudor
(grep sin resultados en database/migrations).
Propuesta enviada a Santi: que venga en la respuesta que el front YA consume,
POST /api/loans/requests/promissory-note/validate/verify-otp, como data.signer_role o metadata.signer_role
con valores "debtor" | "codebtor". Alternativa: endpoint aparte (por eso resolveSignerRole es async:
cambiar la fuente no toca el call-site).

DECISIONES
· Sin feature flag: resolveSignerRole devuelve "debtor" mientras el campo no llegue → comportamiento
  IDÉNTICO al actual, nadie ve la pantalla nueva. Cuando el backend lo mande, sale solo.
· signer_role declarado en data Y en metadata porque no está decidido dónde irá, y zod DESCARTA las claves
  no declaradas: sin eso el campo llegaría y el front lo tiraría en silencio (bug mudo).
· Fallback "debtor" a propósito: equivocarse hacia el comprador solo le muestra al codeudor la pantalla de
  hoy; al revés le escondería el monto aprobado a quien compró.

VERIFICADO
· Pantalla renderizada en el wizard local :5174 (desktop y mobile) — /self-service/{hash}/{ur}/signature-success
· 6 tests del resolver (vitest) pasan
· typecheck sin errores nuevos: 225 pre-existentes en qa, 225 con el cambio
· biome check limpio (7 archivos)
Falta: el camino e2e real (requiere el dato del backend para que alguien caiga en la pantalla nueva).
