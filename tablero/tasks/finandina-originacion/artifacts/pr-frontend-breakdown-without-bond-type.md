fix(loan-confirmation): the first-installment breakdown no longer shows the bond type

## Qué cambia y por qué

En «Continúa con tu solicitud», el «Detalle de tu primera cuota» mostraba el renglón «Tipo de fianza» con una palabra
(«Anticipada» o «Vencida») entre montos que suman el total de la cuota. No es un monto de la cuota y no agrega nada:

- con fianza anticipada (Banco Finandina y Credifamilia hoy), su valor ya sale abajo en «Fianza Anticipada (incluye
  IVA)», junto con el «Monto total»;
- con fianza vencida, ya sale el renglón «Fianza» con lo que suma a cada cuota.

Suelta y sin monto, en medio de los montos de la cuota, «Anticipada» se lee como «la pago por adelantado», que es lo
contrario de una fianza que va financiada dentro del crédito. Abajo la palabra sigue, pero acompañando el valor de la
fianza («Fianza Anticipada (incluye IVA)»). Visto en qa con Banco Finandina (solicitud 505322): Capital 110.032 + Intereses 101.339 + Seguro 9.192 =
220.563, y en medio «Tipo de fianza: Anticipada».

Ahora el detalle sólo tiene montos. Se quita el renglón para todas las entidades con plan de pagos; `bond_type` sigue
en la respuesta y en el esquema. Esto reemplaza la regla del #1563, que lo ocultaba sólo cuando el plan no tenía fianza
(`hasBond`).

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/components/PaymentPlanBreakdown.tsx`: sin el renglón.
- `modules/loan-request-wizard/lenders-marketplace/src/components/LoanConfirmation.test.tsx`: los casos esperan los
  renglones sin «Tipo de fianza», y uno nuevo comprueba que no sale con fianza vencida, anticipada ni sin fianza.

## Cómo se comprobó

- `LoanConfirmation.test.tsx` (la corre la configuración de vitest de `apps/loan-request-wizard`): 5 de 5.
- `biome check` del módulo: 0 errores.
- `pnpm turbo run build --filter=loan-request-wizard...`: compila.
- Falta verlo en qa en la confirmación de una solicitud de Banco Finandina.
