fix(loan-confirmation): the client no longer sees the advance bond

## Qué cambia y por qué

La fianza se maneja internamente y no se le muestra al cliente (decisión de producto del 2026-11-25, después de ver la
confirmación de Banco Finandina en qa). El #1564 ya quitó «Tipo de fianza» del detalle de la primera cuota; quedaba en
la tarjeta de abajo el renglón «Fianza Anticipada (incluye IVA)» con su valor (en qa, solicitud 505322: $537.642).

Ahora ese renglón no se pinta, para todas las entidades con plan de pagos. `advance_bond_total` sigue llegando en la
respuesta y en el esquema.

Lo que se queda, a propósito:

- «Monto total», que con fianza anticipada es el monto más la fianza (en el caso de qa, 5.537.642 sobre 5.000.000
  pedidos).
- Con fianza vencida, el renglón «Fianza» del detalle de la cuota: es parte de lo que suma el total de esa cuota.

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/components/PaymentPlanBreakdown.tsx`: la tarjeta de abajo sólo
  muestra «Monto total»; el comentario dice que la fianza no se muestra.
- `modules/loan-request-wizard/lenders-marketplace/src/components/LoanConfirmation.test.tsx`: con fianza anticipada no
  se ve su valor y sí el «Monto total».

## Cómo se comprobó

- `LoanConfirmation.test.tsx` (la corre la configuración de vitest de `apps/loan-request-wizard`): 5 de 5.
- `biome check` del módulo: 0 errores.
- `pnpm turbo run build --filter=loan-request-wizard...`: compila.
- Falta verlo en qa en la confirmación de una solicitud de Banco Finandina.
