fix(lenders-marketplace): delegated origination leaves the guarantee to its payment plan

## Qué cambia y por qué

En originación delegada (`response_type` 4) la fianza la calcula el plan de pagos del backend con el perfil de la
entidad, sobre el `amount` que el asistente persiste al elegir la entidad. Banco Finandina es una entidad de ese riel
que decide con el motor de CreditopX, así que su preaprobación trae el FGA de la categoría del cliente (5 % o 9 %).

La tarjeta sumaba ese FGA al «valor a financiar» que muestra y al `amount` que persiste
(`financedAmountWithGuarantee`). El plan del riel después calculaba la fianza sobre ese `amount`: el FGA se cobraba
dos veces.

Caso medido en qa (Banco Finandina, perfil con FGA del 9 %, 5.000.000 pedidos):

| | antes | esperado después |
|---|---|---|
| valor a financiar en la tarjeta | 5.450.000 | 5.000.000 |
| `user_requests.amount` | 5.450.000 | 5.000.000 |
| fianza del plan (9 % + IVA 19 %) | 583.695 | 535.500 |
| total financiado | 6.033.695 | 5.535.500 (+ 4x1000 si el perfil lo cobra) |
| cuota mensual (24 cuotas) | 322.914 | ~296.251 |

El «esperado después» coincide con el simulador de aval que mandó la entidad: el aval es el % del perfil más IVA del
19 % sobre el valor solicitado.

Con este cambio, `response_type` 4 no suma FGA en la tarjeta (`cardGuaranteeRate` devuelve 0): muestra y persiste el
subtotal (monto − cuota inicial + costos administrativos). CreditopX (2 y 3) no cambia.

Credifamilia (el otro lender del riel) no cambia en la práctica: no recibe FGA de categoría, y en qa sus solicitudes
ya tienen `amount` igual a `original_amount`. El cambio anula todo FGA del card en `response_type` 4, también el
propio de la entidad, no sólo el de la categoría: en ese riel la fianza es del plan.

El % de la fianza lo sigue decidiendo la entidad, ahora sólo en el plan. El plan lo toma del perfil del riel
(`delegated_origination_profiles.bond_percentage_source`): con `pre_approval`, el % de la preaprobación (para Banco
Finandina, el FGA de la categoría, 5 % o 9 %); con `fng_table`, la tabla FNG. Por eso este cambio supone que cada
entidad del riel tiene su perfil con la fianza configurada; sin perfil, el plan del riel ya falla hoy.

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/lib/application/calculate-loan-financials.uc.ts`: el FGA del
  card pasa por `cardGuaranteeRate`, que vale 0 para originación delegada.
- `modules/loan-request-wizard/lenders-marketplace/src/lib/application/calculate-loan-financials.uc.test.ts`: el test
  que fijaba «el riel 4 muestra el valor con FGA» se reemplaza por cuatro casos: tres del riel 4 (valor mostrado,
  `amount` persistido aunque la categoría traiga FGA, costos administrativos) y uno de CreditopX, que sigue sumando
  el FGA a la base de las cuotas.

Consumidores del caso de uso:
- el asistente: `useLenderSelection` persiste `financedAmountWithGuarantee`, y la tarjeta muestra `totalAmount`;
- el backoffice, en la simulación del perfilamiento (`apps/backoffice/app/components/profiling/Paso3Simulation.tsx`,
  `Paso4Calculo.tsx`, `UserLenderCard.tsx`): replica la tarjeta del asistente, así que para el riel 4 también deja de
  mostrar el FGA, igual que lo que ve el cliente.

Nadie lee `guaranteeFundCost` ni `guaranteeFund` fuera del caso de uso.

## Cómo se comprobó

- Tests del caso de uso: 19 de 19 (vitest 3.2.4; el vitest 1.6 del módulo no arranca con el vite 7 del repo, igual en
  `main`).
- Build del asistente: `pnpm turbo run build --filter=loan-request-wizard`, 2 de 2.
- Biome y lint de diseño en el pre-commit. La complejidad de `execute` queda en 22, la misma de `main`.
- Pendiente: verlo en qa con una solicitud nueva de Banco Finandina. Las solicitudes ya creadas conservan su `amount`.
