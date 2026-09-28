---
id: 97
title: "Credifamilia alcance desarrollo: ajuste monto total"
stage: evaluation
created: "2026-09-28T12:00:00-05:00"
canon: [credifamilia/context#autorizada-no-es-radicada-el-estado-no-prueba-que-llego-al-proveedor, credifamilia/context#es-un-hibrido-y-esa-palabra-evita-dos-errores]
jira: [CORE-653]
jira_title: "Credifamilia alcance desarrollo: ajuste monto total"
ramas: fix/CORE-653-credifamilia-monto-total
---

# Credifamilia alcance desarrollo: ajuste monto total

## Pendientes

- [ ] Confirmar la base del 4x1000; termina cuando haya respuesta escrita de cuál vale: el alcance lo calcula sobre el IVA (`IVA × 0,004` → $714,64 en el ejemplo) y el motor del plan de pagos sobre fianza + IVA (`(fianza + IVA) × 0,004` → $4.475,89). Son $3.761 de diferencia en el ejemplo.
  Depende de: producto / Credifamilia — cuál es la fórmula oficial (la calculadora de Credifamilia se citó en CORE-127 como la vara del motor).
- [ ] Confirmar la regla de redondeo; termina cuando se sepa si `montoTotalCredito` va con 2 decimales o redondeado al entero superior (el alcance pide las dos cosas), y si el redondeo es por componente o sólo al total. Ojo: el ejemplo del alcance TRUNCA (4x1000 714,638 → «714,63»; total «6.343.651,72»); redondeando da 714,64 y 6.343.651,73.
  Depende de: producto / Credifamilia — y si el SOAP acepta decimales en ese campo (hoy se manda entero).
- [ ] Confirmar qué va con fianza **Mensual/Vencida**; termina cuando esté escrito si `montoTotalCredito = montoSolicitado` (lo que ya hace el motor: la fianza no se financia, se cobra por cuota) o si también suma fianza.
  Depende de: producto
- [ ] Implementar en `legacy-backend` el cálculo de `montoTotalCredito` para la radicación; termina cuando el SOAP de una solicitud Anticipada lleve monto + total fianza, con una prueba unitaria que reproduzca el ejemplo del alcance ($5.223.964 → $6.343.651,72 o lo que se decida arriba).
- [ ] Alinear el motor del plan de pagos si la base del 4x1000 cambia; termina cuando voucher («Total a financiar»), plan de cuotas y SOAP den el mismo total para el mismo caso.
- [ ] Correr en local una solicitud Credifamilia con fianza Anticipada hasta la radicación contra el mock SOAP; termina cuando el log `credifamilia.consumo.soap_payload` de esa solicitud muestre el total correcto.
- [ ] Escribir la publicable y pasarla por el guard antes de que Miguel la vea.

## Objetivo

Que el `montoTotalCredito` que CreditOp informa a Credifamilia en la radicación (operación SOAP
`transaccionConsumo`, la «orden de desembolso») sea el calculado por CreditOp con la regla del alcance:
**monto solicitado + total fianza** (fianza + IVA + 4x1000) cuando la fianza es anticipada, y que sea el
mismo total que ya muestran el voucher y el plan de cuotas.

## Dónde se toca

Todo está en `legacy-backend`. En `legacy-application` no existe la radicación SOAP
(`git grep montoTotalCredito origin/main` no da nada ahí): el cambio es de un solo repo.

- **El campo, hoy**: `app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php:131` —
  `'montoTotalCredito' => (int) $this->userRequest->final_amount`. `montoSolicitado` (L128) es
  `(int) user_requests.amount` (trunca; `amount` trae decimales en prod, ej. 8083032.6425). El docblock
  (L43-44) ya lista «composición de montoTotalCredito» como decisión de producto pendiente.
- **De dónde sale `final_amount` al autorizar**: `Modules/Loans/App/Services/LoanAuthorizationService.php:586`
  `authorizeRequest()` → sin calculadora, `PromissoryNoteService::calculateAmounts()` (L625-632), el
  desglose genérico `total_amount_no_fee_no_guarantee`. Para el lender 24 ese desglose **no** trae la
  fianza (lo dice el propio `OnboardingPayloadBuilder`: «el breakdown genérico da 0 para lender 24»).
- **Quién arma el request del SOAP**: `Modules/Onboarding/App/Services/lenders/CredifamiliaConsumo/CredifamiliaConsumoService.php:156`
  `buildRequest()` — ya lee el preaprobado (`transaction_data`) para la TEA y el `bond_type`; de ahí
  mismo sale `guarantee_percentage` (decimal, 0.18 en prod) y `guarantee_type` (2 = Anticipada).
- **El motor que ya lo calcula**: `app/Services/PaymentPlan/Credifamilia/Engine/CalculationContext.php:95-111`
  — `bondBase = monto × %`, `bondIva = bondBase × 0,19`, `fourPerThousand = (bondBase + bondIva) × 0,004`,
  `totalDisbursement = monto + totalBond` sólo si `Anticipada`. El IVA sale de
  `CredifamiliaPayloadBuilder::DEFAULT_IVA_RATE = 0.19` (L15).
- **El voucher ya usa el motor**: `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php:248`
  `total_financed_amount = credit_conditions.total_disbursement` (vía `CredifamiliaPaymentPlanSummaryService`).
  O sea: **el voucher ya dice el total con fianza, y el SOAP no**.
- Mock local de la radicación: `harness/bin/mock-credifamilia` (:8108).

## Cómo se ataca

1. **Cerrar las tres preguntas** (4x1000, redondeo, Mensual). Sin la del 4x1000 no hay una sola fórmula:
   implementar la del alcance tal cual dejaría el SOAP con un total distinto al del voucher y al capital
   sobre el que el motor calcula las cuotas.
2. **Una sola fuente del total**: que `TransactionRequest` tome `montoTotalCredito` del motor
   (`total_disbursement` del resumen del plan, la misma que ya imprime el voucher) en vez de
   `final_amount`. Si la fórmula oficial difiere del motor, se corrige **en el motor** (paso 1 de
   `CalculationContext`), y así voucher, cuotas y SOAP se mueven juntos.
3. **Redondeo** según lo que se decida, aplicado en un lugar (el armado del SOAP), con prueba.
4. **Prueba unitaria** del ejemplo del alcance y de un caso Mensual (total = monto).
5. **Corrida local** hasta la radicación con el mock, mirando el payload registrado.
6. Un PR en `legacy-backend` con todo.

## Lo que se evaluó y NO se eligió

**Calcular la fórmula del alcance a mano dentro de `TransactionRequest`.** Es lo más corto (el
preaprobado ya está en `buildRequest`), pero duplica el cálculo que ya hace el motor y, con la base
del 4x1000 distinta, deja tres totales para el mismo crédito: el del voucher, el de las cuotas y el del
SOAP. Sólo tendría sentido si se decide que el 4x1000 del motor está bien para las cuotas y mal para el
SOAP, que no tiene sentido de negocio.

**Arreglar `final_amount` al autorizar (`authorizeRequest`) para Credifamilia.** `final_amount` lo leen
muchos lados (cupos de CreditopX, reportes de comercio, `ApprovedConfirmationController`) con la
semántica «valor a financiar sin fondo de garantía». Cambiarlo para un lender cambia qué significa la
columna. Queda descartado salvo que producto pida que la BD también guarde el total con fianza.

## Lo que NO entra

- El resto de los campos pendientes del SOAP (tablas de códigos, `fechaIngreso`, bloque bancario, etc.).
- El truncado de `montoSolicitado` a entero, salvo que la decisión de redondeo lo alcance.
- Cambiar la semántica de `user_requests.final_amount`.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Lo que se mandó a Credifamilia (prod, sólo lectura), por tipo de fianza:

```sql prod
SELECT l.request->>'$.tipoFianza' tf, COUNT(*) n,
       SUM(CAST(l.request->>'$.montoTotalCredito' AS SIGNED) - CAST(l.request->>'$.montoSolicitado' AS SIGNED) > 1) con_diferencia
FROM user_requests ur
JOIN logs l ON l.user_request_id = ur.id AND l.name = 'credifamilia.consumo.soap_payload'
WHERE ur.lender_id = 24 AND ur.id > 500000
GROUP BY 1
```

(Filtrar por `user_requests` primero: sobre `logs` sola, Redash no termina en 60 s. Desde `make`, el
`$` del JSON path va como `$$`.)

El ejemplo del alcance, para la prueba unitaria: monto 5.223.964 · 18 % → fianza 940.313,52 · IVA
178.659,57 · 4x1000 714,64 (sobre IVA) · total fianza 1.119.687,73 · **total 6.343.651,73**. Con la
fórmula del motor: 4x1000 4.475,89 · **total 6.347.412,98**.

Local: el cierre entero de Credifamilia en local (receta en la memoria `credifamilia-flujo-mapa` y la
suite `harness/suites/credifamilia.json`) + `bin/mock-credifamilia start` y
`CREDIFAMILIA_CONSUMO_WSDL` apuntado al mock. Hace falta un preaprobado con `guarantee_type = 2`.

## Referencias

- Alcance: «Alcance - Ajuste Campo MontoTotal Crédito» (PDF de Credifamilia/producto, en Downloads de Miguel).
- CORE-127 (`datos-erroneos-voucher-credifamilia`): cuando el voucher pasó a salir del motor y se agregó el 4x1000.
- Canon no documenta todavía la fianza ni el total a financiar de Credifamilia: al mergear, gradúa.



## Tarea (publicable)

## En una línea
El monto total del crédito que CreditOp informa a Credifamilia al radicar incluye la fianza cuando es anticipada.

## Por qué
Hoy, al radicar, el monto total informado es igual al monto solicitado, aun cuando la fianza es anticipada y por lo tanto se financia dentro del capital. El comprobante que ve el cliente sí muestra el total con fianza, así que la orden de desembolso y el comprobante no coinciden.

## Qué cambia
Al radicar un crédito con fianza anticipada, el monto total informado pasa a ser: monto solicitado + fianza + IVA de la fianza + 4x1000. Con fianza mensual no cambia.

## Alcance
No cambia el formulario, ni las pantallas del cliente, ni el monto solicitado. No cambia cómo se calculan las cuotas, salvo que la definición oficial del 4x1000 obligue a ajustarlo (pendiente de confirmar).

## Dónde probar
Pendiente: se define al terminar el desarrollo.

## Cómo validar
Pendiente.

## Criterios de aceptación
- En una solicitud con fianza anticipada, el monto total informado a Credifamilia es monto solicitado + total fianza, con la regla de redondeo acordada.
- Con el ejemplo del alcance (monto $5.223.964, fianza 18 %) el total coincide con el valor acordado.
- En una solicitud con fianza mensual, el monto total informado es igual al monto solicitado.
- El total informado coincide con el «Total a financiar» del comprobante del cliente.

## Dependencias / contraparte
Confirmación de producto / Credifamilia sobre la base del 4x1000 y la regla de redondeo.
