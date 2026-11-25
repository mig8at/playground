fix(lenders-marketplace): delegated origination leaves the guarantee to its plan, and the first installment adds up

## Qué cambia y por qué

En originación delegada (`response_type` 4) la fianza la calcula el plan de pagos del backend con el perfil de la
entidad. Banco Finandina es una entidad de ese riel que decide con el motor de CreditopX, así que su preaprobación trae
el FGA de la categoría del cliente (5 % o 9 %).

La tarjeta del listado sumaba ese FGA al «valor a financiar» que muestra y al `amount` que se guarda al elegir
(`financedAmountWithGuarantee`). Después el plan del riel calculaba la fianza sobre ese `amount`, que ya la traía: la
fianza se cobraba dos veces.

Medido en qa el 2026-11-25 (Banco Finandina, 5.000.000 pedidos, categoría con FGA del 9 %): las dos solicitudes del
día quedaron con `original_amount` 5.000.000 y `amount` 5.450.000. En el caso medido el 2026-11-23 el plan cobró
583.695 de fianza (9 % + IVA sobre 5.450.000) y financió 6.033.695; sobre 5.000.000 son 535.500 más el 4x1000.

Los T&C del crédito de Finandina (cláusula 6) y su simulador de aval piden la fianza una sola vez, incorporada al
monto a financiar: con 5.000.000 y el 5 %, 5.298.690 financiados y 5.000.000 netos al cliente.

Con este cambio, `response_type` 4 no suma FGA en la tarjeta (`cardGuaranteeRate` devuelve 0): muestra y guarda el
subtotal sin FGA (el monto pedido menos la cuota inicial, más los costos administrativos del comercio si los tiene; con
5.000.000 y sin costos, 5.000.000), y la fianza la pone sólo el plan. CreditopX (2 y 3) no cambia: sigue sumando el FGA
a la base de las cuotas.

El simulador de perfilamiento del backoffice usa el mismo cálculo, así que para una entidad del riel 4 también deja de
sumar el FGA. Su leyenda («valor a financiar + FGA») no cambia en este PR.

Credifamilia (el otro lender del riel) no cambia en la práctica: no recibe FGA de categoría, y en qa sus solicitudes ya
tienen `amount` igual a `original_amount`. El cambio anula todo FGA de la tarjeta en `response_type` 4, también el
propio de la entidad: en ese riel la fianza es del plan.

## La pantalla «Continúa con tu solicitud»

El detalle de la primera cuota mostraba capital y seguro de vida pero no los intereses, así que no sumaba su total (en
qa: 119.934 + 10.020 para un total de 280.561). Ahora muestra el interés del mes y, si los hay, el interés de los días
que pasan de 30 hasta la primera fecha de pago; los dos llegan en la respuesta de continuar la solicitud (cambio de
legacy-backend que va junto). Con un backend que todavía no los manda, la pantalla queda como antes. Un plan sin fianza
(ni en la cuota ni anticipada) ya no muestra «Tipo de fianza».

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/lib/application/calculate-loan-financials.uc.ts`: el FGA de la
  tarjeta pasa por `cardGuaranteeRate`, que es 0 en `response_type` 4.
- `modules/loan-request-wizard/lenders-marketplace/src/components/PaymentPlanBreakdown.tsx` y
  `src/lib/domain/entities/loan-request.entity.ts`: los dos intereses (opcionales en el esquema) y «Tipo de fianza» sólo
  con fianza.
- `modules/loan-request-wizard/lenders-marketplace/src/components/LoanConfirmation.test.tsx`: tres casos nuevos (sin
  fianza, con los dos intereses, sin intereses de días adicionales).
- `modules/loan-request-wizard/lenders-marketplace/src/lib/application/calculate-loan-financials.uc.test.ts`: el caso
  que fijaba «el riel 4 muestra el valor con FGA» se reemplaza por cuatro: tres del riel 4 (valor mostrado, `amount`
  guardado aunque la categoría traiga FGA, costos administrativos) y uno de CreditopX, que sigue sumando el FGA.

## Cómo se comprobó

- `calculate-loan-financials.uc.test.ts`: 16 de 16.
- La suite del módulo: 472 de 475. Las 3 que fallan son de `lender-response.mapper.action-text.test.ts` (el texto del
  botón de Nequi), que no importa ni toca este archivo.
- `LoanConfirmation.test.tsx` (la corre la configuración de vitest del wizard): 5 de 5.
- `pnpm turbo run build --filter=loan-request-wizard...`: compila.
- Falta verlo en qa con una solicitud nueva de Banco Finandina: `amount` igual al pedido y la fianza del plan sobre ese
  monto.

Es el mismo cambio del PR #1515, que se cerró porque apuntaba a `main` y el flujo es qa → main.
