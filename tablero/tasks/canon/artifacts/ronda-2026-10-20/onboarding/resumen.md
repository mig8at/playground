# Ronda 2026-10-20 · imei, onboarding, kyc, perfilamiento, preaprobado, salud-financiera, credito365, bcp, bancolombia, credifamilia

59 líneas de la ronda en estos temas (42 archivos distintos). Todos los hashes nuevos de la ronda coinciden con
`origin/main` de los clones a la hora del trabajo (comprobado de nuevo después de un `git fetch` que hizo el verificador:
legacy-backend @ 406bf8a2, legacy-application @ 0c86754d). No hay archivos borrados ni renombrados: **ningún canon-patch**.
La prosa se comparó contra un `make canon-export` de hoy (revisión del corpus f201706ef5f8), no contra la copia de
`tablero/canon`, que es del 2026-10-01.

**Resultado:** 10 piezas con prosa (8 correcciones y 2 agregados) y 11 `verificado`, uno por tema.

| pieza | tipo | qué cambia |
|---|---|---|
| `salud-financiera-superficies` | corrección | una cuarta superficie, el aviso de cambio de suscripción, que borra las cachés de salud y de consejos |
| `perfilamiento-rotativo-motor` | corrección | en el motor nuevo, un cupo rotativo nuevo pasa por la política dura de la entidad; en el listado se cae si la falla, salvo que ya tenga cupo |
| `credifamilia-fianza` | corrección | el 4x1000 de la fianza se calcula sobre la fianza más su IVA, no sólo sobre el IVA |
| `imei-desbloqueo-por-pago` | corrección | el estado lo decide `stateInfo`, lo que está en cola manda, hay reintentos a 1, 5 y 15 min, una conciliación cada 10 min y el interruptor `legacy_application_payment_unlock_enabled` |
| `imei-desbloqueo-monolito-nuevo` | agregado | desbloqueo por pago de DeviceLockingV1: sin predictor, apagado sin la fila `device_locking_payment_unlock_enabled` |
| `onboarding-puerta-originacion` | agregado | comercio o sucursal deshabilitados → 403 `ALLIED_DISABLED` en 4 puntos de entrada; los huecos que quedan |
| `onboarding-arbol-rutas` | corrección | el árbol de entrada `/auto/…` del auto-onboarding de tienda |
| `onboarding-pipeline-kyc` | corrección | `CompleteKycService` consolida con el nombre tecleado si ninguna central confirmó la identidad |
| `onboarding-codigo-app` | corrección | cada código queda reservado hasta su vencimiento, se reintenta hasta 5 veces si choca, el consumo es atómico y las rutas de generar del monolito están rotas |
| `*-verificado` (11) | verificado | sube el hash de cada archivo releído cuya prosa sigue cierta |

⚠ **Una corrección con `archivos` ya declarados NO sube el hash**: sólo enlaza la sección al área (`ya_vigilados_nota`).
Por eso los archivos que respaldan una corrección también van en el `verificado` de su tema, y el orden del lote importa:
primero las correcciones y los agregados, después el `verificado`. Además, la corrección de imei enlaza el ancla del agregado
nuevo, así que el agregado va antes.

## Veredicto por línea

Las rutas son de `origin/main`. «Verificado» quiere decir que se releyó el diff completo entre los dos hashes y la prosa de las
secciones del área sigue cierta.

### salud-financiera
| archivo | veredicto | motivo |
|---|---|---|
| financial-health-service:cmd/http-server/main.go | corrección | sólo el comentario pasa a «four use cases» (main.go:92); el cambio real es la cuarta superficie, que contradice «tres superficies» |
| financial-health-service:internal/core/usecases/module.go | corrección | registra `handlesubscriptionchange.NewUseCase` (module.go:36), que borra las cachés de salud y de consejos: el informe ya no espera al TTL si alguien avisa el cambio. Ningún repo de los clones llama todavía a esa superficie |

### credito365
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:Modules/Onboarding/App/Services/UserRequestService.php | verificado | agrega la puerta de originación en la rama que crea otra solicitud (UserRequestService.php:320). La sección sobre Crédito365 sigue cierta; la puerta va en el agregado de onboarding |
| legacy-backend:Modules/Onboarding/routes/api.php | verificado | entran la ruta merchant-verified (api.php:47) y un comentario sobre los proxies de generar códigos (api.php:181); la reconciliación de Crédito365 no cambia |

### bcp
| archivo | veredicto | motivo |
|---|---|---|
| frontend-monorepo:…/lenders-marketplace/available-lenders.tsx | verificado | sólo agrega el manejo de `AlliedDisabledError` (available-lenders.tsx:951); la entrega por POST no cambia |
| legacy-backend:Modules/Onboarding/App/Services/UserRequestService.php | verificado | la misma puerta (:320); el vencimiento del link no se toca |

### credifamilia
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:Modules/Loans/App/Services/LoanAuthorizationService.php | verificado | agrega `registerIfCollectedInStore` (LoanAuthorizationService.php:215) en los tres cierres; la radicación en el proveedor no cambia |
| frontend-monorepo:…/available-lenders.tsx | verificado | como en bcp; la compuerta de consulta sigue igual |
| legacy-backend:app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php | corrección | el 4x1000 se calcula sobre la fianza más su IVA (TransactionRequest.php:341; fórmula en `app/Services/PaymentPlan/Credifamilia/ValueObjects/BondBreakdown.php`, commit 4f9d6b32). La sección decía «sólo sobre ese IVA» |

### bancolombia
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php | verificado | el cambio es de la fianza de Credifamilia; las secciones de errores del banco no se tocan |
| legacy-backend:Modules/Onboarding/App/Services/EcommerceRequestService.php | verificado | agrega la firma del comercio y el flag de auto-onboarding (EcommerceRequestService.php:376); el trámite de Bancolombia no cambia |
| legacy-backend:Modules/Onboarding/routes/api.php | verificado | como en credito365 |
| frontend-monorepo:apps/loan-request-wizard/app/routes.ts | verificado | agrega el árbol `/auto` (routes.ts:45) y el QR de continuar; las entradas de Bancolombia siguen iguales |
| frontend-monorepo:…/routes/bancolombia/onboarding/otp.tsx | verificado | sólo un comentario: esta pantalla no distingue `ALLIED_DISABLED` (otp.tsx:211) |
| legacy-application:app/Console/Kernel.php | verificado | agrega `app:reconcile-payment-unlocks` (Kernel.php:65); las tareas de la caja no cambian |

### perfilamiento
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:…/Customer/CreditopXQuotaController.php | corrección | la consulta de cupo del rotativo devuelve el motivo de la política dura (CreditopXQuotaController.php:968) |
| legacy-backend:…/lenders/LenderValidationService.php | corrección | `dropsWhenRulesFail`: rt=3 sale del listado si falla las reglas duras, salvo que ya tenga cupo aprobado (LenderValidationService.php:35). El histórico sigue retirando sólo rt=2 (legacy-application `app/Services/lenders/LenderValidationService.php:176`) |
| legacy-backend:Modules/Loans/App/Services/RevolvingCreditsService.php | corrección | paso 3b, `RevolvingHardPolicyGate`, antes de leer las centrales y sólo para cupos nuevos (RevolvingCreditsService.php:452) |

### preaprobado
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:Modules/Onboarding/App/Services/OnboardingService.php | verificado | sólo agrega `riskCentralsCheck` (OnboardingService.php:1422), una lectura para el auto-onboarding; las exclusiones del preaprobado no cambian |
| frontend-monorepo:…/repositories/loan-options.repository.ts | verificado | sólo traduce el 403 `ALLIED_DISABLED` a un error propio (loan-options.repository.ts:163) |
| legacy-backend:…/lenders/LenderValidationService.php | verificado | el cambio de rt=3 no toca la compuerta del preaprobado (va en perfilamiento) |
| frontend-monorepo:…/available-lenders.tsx (×2 áreas) | verificado | como en bcp; el recorte por cupo confirmado o código de la app y la cancelación no cambian |

### kyc
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:…/CrossCore/JumioOnboardingService.php | verificado | la URL de retorno usa `flowPrefixFor` (/ecommerce o /self-service, JumioOnboardingService.php:424); lo que dicen las secciones de CrossCore sigue cierto |
| legacy-application:app/Http/Controllers/Admin/UserController.php | verificado | excluye usuarios de prueba y prohíbe editar a mano a un temporal (UserController.php:137); la validación manual no cambia |
| legacy-backend:…/Customer/AdoController.php | verificado | la URL de callback usa `flowPrefixFor` (AdoController.php:58); el tope de ADO sigue igual |

### imei
| archivo | veredicto | motivo |
|---|---|---|
| legacy-backend:resources/views/creditopxpdf/paymentschedule.blade.php | verificado | se quitó la nota propia de cada entidad del plan de pagos; ninguna sección la mencionaba |
| legacy-backend:…/Customer/AdoController.php | verificado | como en kyc |
| legacy-backend:…/Customer/PromissoryNoteController.php | verificado | camino de firma Netco configurable (PromissoryNoteController.php:121), apagado sin fila en `netco_lender_settings`; el acuerdo IMEI no cambia |
| legacy-backend:…/Customer/ValidateOtpPromissoryNoteController.php | verificado | cambio de celular en el código de firma, sólo con pedido firmado (ValidateOtpPromissoryNoteController.php:286); el recorrido IMEI no cambia |
| legacy-backend:Modules/Loans/App/Services/DocumentSigningService.php | verificado | el mismo camino Netco (DocumentSigningService.php:112) |
| legacy-backend:Modules/Loans/App/Services/LoanAuthorizationService.php | verificado | registro de la cuota inicial cobrada en tienda, también al inscribir el IMEI; la autorización estándar y la de SmartPay no cambian |
| legacy-backend:Modules/Loans/routes/api.php | verificado | rutas phone-change y continue-qr (api.php:84) |
| legacy-application:app/Console/Kernel.php | corrección | la conciliación `app:reconcile-payment-unlocks` cada 10 min (Kernel.php:65) → en la corrección del desbloqueo por pago |
| legacy-application:…/Admin/CreditopXRequestHistoryController.php | verificado | filtra `is_test` y saca la cuota inicial de «Dinero Recaudado» (:221); el aviso del panel sigue usando la regla del job |
| legacy-backend:…/DeviceLockingV1ScheduleServiceProvider.php | agregado | agenda `device-locking:reconcile-payment-unlocks` (:36) → en el agregado del monolito nuevo; además, `verificado` |
| legacy-backend:app/Console/Commands/LockDevicesPastDueCommand.php | verificado | el 8 pasa a constante pública (:20); el umbral sigue siendo el mismo |
| legacy-backend:app/Console/Commands/SyncDeviceLocksCommand.php | verificado | un bloqueo sin fila ahora se clasifica (`UnregisteredLockClassifier`), queda con la fecha de `lastChanged` y deja una fila en `logs` (:161). Lo que la prosa dice sigue cierto; esto **no** está en canon (ver pendientes) |
| legacy-backend:app/Services/DeviceStateReader.php | verificado | expone `transitionState` y `lastChanged` (:69) |
| legacy-backend:config/device_locking.php | agregado | `payment_unlock_max_per_run` (:48) → en el agregado; además, `verificado` |
| legacy-application:…/Admin/CreditopXPaymentController.php | corrección (+verificado) | normaliza los residuos de punto flotante (`MoneyScale`, :180); va en el `verificado` porque las secciones del pago siguen ciertas |
| legacy-application:app/Jobs/UnlockDeviceIfUpToDate.php | corrección | reintentos `RETRY_DELAYS` (:92), cola de transiciones, interruptor y contrato de nombres de log |
| legacy-application:app/Services/Api/DeviceLockApiClient.php | corrección | `transitionState` deja de decidir: manda `stateInfo` y `pendingTransition` (:142) |

### onboarding
| archivo | veredicto | motivo |
|---|---|---|
| frontend-monorepo:…/loan-application-form/otp-verification.tsx (×2 áreas) | verificado | maneja `ALLIED_DISABLED` (otp-verification.tsx:527); va en el agregado de la puerta |
| legacy-backend:Modules/Onboarding/App/Services/UserRequestService.php | agregado (+verificado) | puerta de originación (:320) |
| legacy-backend:…/Controllers/OnboardingController.php | agregado (+verificado) | puerta ONB041 (:1327), auto-onboarding `startMerchantVerifiedSession` y `risk_centrals` en personal-info. El veredicto en el cuerpo sigue cierto |
| frontend-monorepo:apps/loan-request-wizard/app/routes.ts | corrección | el árbol `/auto` (routes.ts:45) |
| legacy-backend:Modules/Onboarding/App/Services/OnboardingService.php | verificado | `riskCentralsCheck` (:1422); el área no tiene secciones |
| frontend-monorepo:…/available-lenders.tsx | verificado | como en bcp |
| frontend-monorepo:…/loan-application-form/client-code.tsx | verificado | rediseño, logo del comercio y `ALLIED_DISABLED` (:161) |
| legacy-backend:…/ClientCodeRedemptionService.php | agregado (+verificado) | puerta CCO008 antes de consultar el código (:124) |
| legacy-backend:Modules/Onboarding/routes/api.php | verificado | como en credito365 |
| self-manager-api:internal/infra/generate/code-generator.go | corrección | `ErrCodeUsed`/`ErrCodeInvalidStatus` (:25) y consumo condicional (`store.Consume`, en `dynamodb_store.go:439`) |
| self-manager-api:internal/infra/generate/qr-generator.go | corrección | `saveWithUniqueCode`, hasta 5 intentos (:206); la reserva global por código está en `dynamodb_store.go` (`codeReservationItem`) |
| self-manager-api:internal/infra/handlers/generate/http_handler.go | corrección | el motivo del rechazo sólo va al log (`invalidCodeReason`, :168) |
| legacy-backend:…/Repositories/GenerateServiceRepository.php | corrección | generar QR, código de barras y código siguen el contrato viejo y fallan siempre (:36) |
| legacy-backend:…/OnboardingV2/App/Services/StorePersonalInfoService.php | verificado | sólo un comentario (:673); OBV21013 no cambia |
| legacy-backend:…/OnboardingV2/App/Services/CompleteKycService.php | corrección | `consolidateFromSubmittedNames` antes de firmar términos (:159) |

## Lo que verificó el subagente main-verifier (puerta de originación)

Revisó los dos monolitos. Confirma la regla, los cuatro puntos de entrada, que `createUserRequest` no tiene la puerta adentro y
el auto-onboarding bajo la puerta. El agregado ya recoge sus matices:
- OBV22012 lleva el subcódigo en `data.errorSubcode`, no en `error_subcode`.
- **Hueco:** `soft-update-user-request` (`UserRequestService::onlyUpdateUserRequest`) también crea otra solicitud y no
  pregunta, y el front la llama (`frontend-monorepo` user-request.repository.ts:16).
- legacy-application no tiene la regla. Para los comercios de `allowed_bypass_comerces` delega la validación del OTP en
  legacy-backend; ante el 403 cae a su validación local, que encuentra el OTP ya consumido. Esto se leyó, no se corrió.

## Lint (make canon-write DRY=1)

Con las 21 piezas en el orden de `pieces.txt`, el ensayo **pasa entero** («el borrador se abandonó, no se escribió nada»).
Dos rechazos en el camino, ya corregidos:
1. «`POST /` es un endpoint»: la corrección de salud-financiera nombraba la ruta y la cabecera. Se describió la operación.
2. «esas tablas no existen en el esquema de producción: `device_payment_unlocks`». Se quitó de `tablas` del agregado de imei.
   La prosa la sigue nombrando como la tabla del módulo. ⚠ Lo más probable es que la migración no esté aplicada en prod:
   el interruptor está apagado sin su fila, pero conviene saberlo antes de encenderlo.

Avisos que quedan: 7 `ya_vigilados_nota`, uno por cada pieza con prosa y archivos ya declarados. Es lo esperado: la sección
se enlaza al área, y el hash lo sube el `verificado` del mismo tema.

Orden del lote: salud-financiera (corrección, verificado) · perfilamiento (corrección, verificado) · credifamilia (corrección,
verificado) · credito365 · bcp · bancolombia · preaprobado · kyc · imei (agregado, corrección, verificado) · onboarding
(agregado, 3 correcciones, verificado).

## Visto y no dictado (otros temas o candidatos)

- **Bloqueos sin registro** (imei): la sincronización de las 03:00 clasifica un equipo bloqueado sin fila nuestra (esperado,
  desbloqueo en cola, inesperado: al día, saldado o por debajo del umbral; con el motor por comercio, sin veredicto) y deja una
  fila en `logs` (`app/Services/UnregisteredLockClassifier.php`). Es candidato a agregado; no lo armé porque la prosa
  actual no queda falsa.
- **Cuota inicial cobrada en tienda** (`Modules/Loans/App/Services/InitialFee/StoreInitialFeeRegisterService.php`): un
  registro de pago tipo 7 al crear el crédito. Es de cartera o formalización.
- **Firma Netco configurable** (`netco_lender_settings`, SigningV1): es de formalización.
- **Auto-onboarding de tienda** (pedido firmado, token de un solo uso, cambio de celular en la firma, fechas del pedido,
  `auto_onboarding_allied_branches`): es de ecommerce. Lo dejé dicho en la carpeta de notas compartida.
- **Retorno de identidad con `flowPrefixFor`** (/ecommerce o /self-service según el pedido vinculado): es de ecommerce o kyc.
- `datos/context` (usuario temporal, ~línea 63) puede necesitar el matiz de la consolidación con el nombre tecleado.
