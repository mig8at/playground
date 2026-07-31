---
title: "Codeudor: al terminar la firma ve una confirmación propia en lugar de la pantalla de monto aprobado"
---

## En una línea
Cuando quien firma es el **codeudor**, al terminar la firma ve una confirmación propia ("¡Firma realizada con éxito!") en lugar de la pantalla de monto aprobado del comprador.

## Por qué
Hoy el codeudor recorre el mismo flujo de solicitud que el comprador y, al firmar, termina viendo "¡Felicidades, tu monto ha sido aprobado!" con el monto del crédito. Eso no corresponde: el crédito no es suyo, él solo lo respalda. Necesita una confirmación que le diga que su firma quedó registrada.

## Qué cambia
Al confirmar el código de la firma (consentimiento, pagaré y fondo de garantías), el sistema reconoce quién firmó:

- **Comprador** → pantalla actual: "¡Felicidades, tu monto ha sido aprobado!", con el monto y sus accesos.
- **Codeudor** → pantalla nueva: "¡Firma realizada con éxito! / Tu firma fue registrada correctamente. El crédito ha quedado formalizado." Sin monto y sin botones.

## Alcance
- Aplica al último paso del flujo, después de confirmar el código de la firma.
- El flujo del comprador **no cambia**: mismo recorrido y el mismo cierre con su monto.
- La firma en sí no cambia: el codeudor firma igual que hoy y el crédito queda formalizado igual.
- Si el sistema no logra determinar quién firmó, se muestra la pantalla actual (la del comprador). El cierre nunca se bloquea ni se corta.

## Dónde probar
- Ambiente de pruebas, flujo de solicitud hasta la firma con código.
- **Precondición:** una solicitud con codeudor y la forma de entrar a firmar como codeudor, más una solicitud normal para comparar.

## Cómo validar
1. **Comprador (regresión).** Recorrer una solicitud normal hasta la firma. Al confirmar el código, sigue apareciendo "¡Felicidades, tu monto ha sido aprobado!" con el monto.
2. **Codeudor.** Firmar como codeudor. Al confirmar el código, aparece "¡Firma realizada con éxito!" con el texto "Tu firma fue registrada correctamente. El crédito ha quedado formalizado.", sin monto y sin botones.
3. **Borde.** Si no se puede determinar quién firmó, se muestra la pantalla de monto aprobado (comportamiento actual) y el crédito igual queda formalizado.

## Criterios de aceptación
- [ ] El comprador sigue viendo la pantalla de monto aprobado, sin cambios.
- [ ] El codeudor ve "¡Firma realizada con éxito!" con su mensaje de confirmación.
- [ ] La pantalla del codeudor no muestra monto ni botones.
- [ ] En ambos casos la firma se completa y el crédito queda formalizado.

## Dependencias / contraparte
Backend: falta que, al validar el código de la firma, el sistema informe si quien firmó es el comprador o el codeudor. Mientras ese dato no esté disponible, todos siguen viendo la pantalla actual (no hay cambio visible ni riesgo). Una vez disponible, la separación funciona sin necesidad de otra publicación de la aplicación.
