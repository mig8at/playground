fix(delegated-origination): an offer the engine no longer approves answers 409 OFFER_CHANGED, not 500

## Qué cambia y por qué

En originación delegada (`response_type` 4), Banco Finandina toma el cupo del cliente de la preaprobación
`creditop_x`, y pre-approvals-service la vuelve a evaluar en cada consulta. Si entre el listado y la firma el
cliente se queda sin cupo (por ejemplo, se agota la bolsa mensual de su perfil), la preaprobación pasa a
`rejected`, el plan no tiene insumos y la simulación del plan respondía 500 «Ocurrió un error durante el cálculo
del plan de pagos». El wizard mostraba un error genérico.

Medido en qa el 2026-11-17 (solicitud 505130, Banco Finandina, 5.000.000): con la bolsa del perfil normal,
`GET …/promissory-note/505130/simulate-payment-schedule` respondió 200; con la bolsa bajada a lo ya usado,
respondió 500.

En el tipo 2 ese caso ya responde 409 `OFFER_CHANGED` (la compuerta `OfferStillStandsGuard`), que el wizard
reconoce y devuelve al cliente al listado. Este cambio lleva el riel 4 a lo mismo:

- `OfferStillStandsGuard` pregunta, para una entidad del riel 4 cuyos insumos salen de la preaprobación
  `creditop_x`, cuánto aprueba hoy el motor. Si aprueba menos de lo que se financia (`amount`), o ya no
  aprueba (`rejected`, `not_eligible`), responde el mismo 409. La compuerta ya corre al generar los
  documentos, al validar el OTP de firma y en la autorización, así que el riel 4 queda frenado en esos pasos
  con el mismo error.
- El plan del riel 4 (`ExternallyManagedPaymentScheduleService`, simular y confirmar) pasa por la compuerta
  entera sólo para las entidades que toman el cupo de la preaprobación `creditop_x` (Banco Finandina), como el
  plan del tipo 2: además de la comprobación nueva, el tope de créditos del cliente en el mes y la comparación con
  la foto de la oferta. Esas dos ya corrían para Finandina al generar los documentos, en el OTP y en la
  autorización; ahora frenan desde el plan.

No frena nada cuando no se puede saber: si pre-approvals-service no contesta, contesta un error o `pending`,
se sigue como antes. Tampoco vuelve a medir una solicitud que ya reservó su cupo del mes (al autorizar), para
no contar su propio crédito como usado.

**Credifamilia (Salud y Materiales) no cambia.** Queda afuera antes de cualquier consulta
(`CredifamiliaLenders::supports`): su plan no pasa por la compuerta y la comprobación nueva no le hace ninguna
consulta en los documentos, el OTP ni la autorización.

`not_eligible` también cuenta como «ya no aprueba»: el servicio lo usa cuando la entidad no evaluará al cliente
para el producto, y el listado tampoco se lo ofrecería.

**Costo.** Cada paso que pasa por la compuerta (simular y confirmar el plan, documentos, OTP, autorización) hace
una consulta más a pre-approvals-service para Banco Finandina, que vuelve a evaluar al cliente en el motor. Al
simular el plan son dos: la de la compuerta y la del propio plan. Cada una tiene un tope de 25 s si el servicio
no contesta.

## Qué se tocó

- `app/Services/PaymentPlan/DelegatedOrigination/CreditopXPreApprovalInputs.php`: `approvedAmountNow()`, el cupo
  que aprueba el motor hoy (0 si dice que no, null si no se sabe). Se corrige el docblock que decía que el
  servicio guarda la preaprobación.
- `app/Services/PaymentPlan/DelegatedOrigination/DelegatedOfferCheck.php` (nuevo): decide si aplica (no es
  Credifamilia, riel 4, insumos `creditop_x_pre_approval`, sin cupo reservado) y pregunta.
- `Modules/Loans/App/Services/InitialFee/OfferStillStandsGuard.php`: la comprobación del riel 4.
- `Modules/Loans/App/Services/PaymentSchedule/ExternallyManagedPaymentScheduleService.php`: la compuerta al
  simular y al confirmar el plan, sólo si aplica.
- Pruebas: `OfferStillStandsGuardTest` (cinco casos del riel 4), `CreditopXApprovedAmountNowTest` (nuevo, con
  la respuesta del servicio simulada), `ExternallyManagedOfferChangedTest` (nuevo: el plan de Finandina responde
  el 409 al simular y al confirmar, sin calcular nada, y una entidad fuera de la consulta no llega a la
  compuerta) y `ValidateInitialFeePaidTest` (la compuerta con la consulta nueva apagada).

## Cómo se comprobó

- `OfferStillStandsGuardTest`, `ValidateInitialFeePaidTest`, `ExternallyManagedOfferChangedTest` y las pruebas de
  `tests/Unit/PaymentPlan/DelegatedOrigination/`: 62 de 62, sobre SQLite.
- Falta verlo en qa: repetir el caso de la 505130 (bajar la bolsa del perfil después de elegir la entidad) y
  ver el 409 y el aviso del wizard que devuelve al listado.
