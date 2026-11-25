fix(loan-confirmation): the first-installment breakdown adds up and hides the bond type without a bond

## Qué cambia y por qué

En «Continúa con tu solicitud», el detalle de la primera cuota de una entidad de originación delegada mostraba capital
y seguro de vida pero no los intereses, así que sus renglones no sumaban el total. Visto en qa con Banco Finandina:
capital 119.934 + seguro 10.020 para un total de 280.561. Lo que faltaba era el interés del mes (110.460) y el de los
días que pasan de 30 hasta la primera fecha de pago (40.148).

- El detalle muestra «Intereses» y, si los hay, «Intereses de los días hasta tu primera fecha de pago». Los dos llegan
  en la respuesta de continuar la solicitud desde Creditop-SAS/legacy-backend#2100 (`first_installment_interest` y
  `first_installment_extra_days_interest`). Son opcionales en el esquema: con un backend que todavía no los manda, la
  pantalla queda como antes.
- Un plan sin fianza (ni en la cuota ni anticipada) ya no muestra «Tipo de fianza».

Con Creditop-SAS/legacy-backend#2100, Banco Finandina cobra los días adicionales en la última cuota, como dicen sus
T&C: su primera cuota deja de traer ese renglón y queda igual a las demás.

## Qué se tocó

- `modules/loan-request-wizard/lenders-marketplace/src/components/PaymentPlanBreakdown.tsx`: los dos intereses y
  «Tipo de fianza» sólo con fianza.
- `modules/loan-request-wizard/lenders-marketplace/src/lib/domain/entities/loan-request.entity.ts`: los dos campos,
  opcionales.
- `modules/loan-request-wizard/lenders-marketplace/src/components/LoanConfirmation.test.tsx`: tres casos nuevos (sin
  fianza, con los dos intereses, sin intereses de días adicionales).

## Cómo se comprobó

- `LoanConfirmation.test.tsx` (la corre la configuración de vitest de `apps/loan-request-wizard`): 5 de 5.
- La suite de `lenders-marketplace`: 472 de 475; las 3 que fallan son de `lender-response.mapper.action-text.test.ts`
  (el texto del botón de Nequi), que no importa ninguno de los archivos tocados.
- `pnpm turbo run build --filter=loan-request-wizard...`: compila.
- La suma puede quedar a 1 o 2 pesos del total, porque el backend redondea cada renglón por separado.
- Falta verlo en qa con una solicitud nueva de Banco Finandina, después de los dos merges.
