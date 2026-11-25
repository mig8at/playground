fix(loan-confirmation): the client no longer sees the bond (type and advance amount)

## Qué cambia y por qué

La fianza se maneja internamente: al cliente no se le muestra. En «Continúa con tu solicitud» salían dos renglones de
la fianza:

- «Tipo de fianza» («Anticipada» o «Vencida»), en el «Detalle de tu primera cuota», entre montos que suman el total de
  la cuota;
- «Fianza Anticipada (incluye IVA)» con su valor, en la tarjeta de abajo.

Visto en qa con Banco Finandina (solicitud 505322): Capital 110.032 + Intereses 101.339 + Seguro 9.192 = 220.563, con
«Tipo de fianza: Anticipada» en medio, y abajo «Fianza Anticipada (incluye IVA) $537.642».

Los dos salen para todas las entidades con plan de pagos. `bond_type` y `advance_bond_total` siguen en la respuesta y
en el esquema; sólo no se pintan. Se quedan «Monto total» y, con fianza vencida, el renglón «Fianza» de la cuota (es
parte de lo que suma el total de esa cuota). Esto reemplaza la regla del #1563, que ocultaba «Tipo de fianza» sólo
cuando el plan no tenía fianza (`hasBond`).

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/components/PaymentPlanBreakdown.tsx`: sin «Tipo de fianza» y sin
  «Fianza Anticipada (incluye IVA)».
- `modules/loan-request-wizard/lenders-marketplace/src/components/LoanConfirmation.test.tsx`: los casos esperan los
  renglones sin «Tipo de fianza»; uno comprueba que no sale con fianza vencida, anticipada ni sin fianza, y otro que con
  fianza anticipada no se ve su valor y sí el «Monto total».

## Cómo se comprobó

- `LoanConfirmation.test.tsx` (la corre la configuración de vitest de `apps/loan-request-wizard`): 5 de 5.
- `biome check` del módulo: 0 errores.
- `pnpm turbo run build --filter=loan-request-wizard...`: compila.
- Falta verlo en qa en la confirmación de una solicitud de Banco Finandina.
