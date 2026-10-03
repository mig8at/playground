---
id: 12
title: "Codeudor — cierre propio tras la firma (pantalla \"Firma realizada con éxito\")"
ramas: cosigner-signature-success, motai/flujo-codeudor
stage: work
created: "2026-07-27T12:13:57-05:00"
knowledge: [cosigner-signature]
canon: [formalizacion, creditopx]
jira: [CORE-317]
jira_title: "Codeudor: confirmación propia al terminar la firma"
---

## Pendientes

- [x] Contrastar el cierre disponible en `main` y enlazar su mecanismo local: recorrido propio
  del codeudor, token obligatorio, OTP, firma registrada y autorización separadas.
- [ ] Validar el recorrido real del codeudor hasta la confirmación con su propio OTP y documentos;
  termina cuando la evidencia identifica firma registrada, autorización y archivos finales por separado.
- [ ] Validar la espera del titular después de su firma y los casos sin codeudor e IMEI;
  termina cuando el destino coincide con el estado de la solicitud en cada caso.
- [ ] Revisar el copy del cierre cuando `userRequestAuthorized` es false; termina cuando no se
  presenta como crédito formalizado una solicitud cuya autorización no se logró.
  Depende de: producto y backend — comportamiento esperado para firma registrada con cierre pendiente.

## Objetivo

Que el codeudor tenga una confirmación propia tras firmar, sin mostrarle el monto aprobado del
titular. La implementación que sirve para retomar está en `knowledge/cosigner-signature`, con
fuentes de `main`; los bloques de la tarea mantienen la entrega medida y el límite de validación.

## Dónde se toca

El wizard tiene rutas propias `cosigner/signature/*` y usa las APIs de UserRequestV1 para el OTP
del codeudor. Su ruta de éxito depende del resultado `signed`, no de `data.signer_role` en el
OTP del titular. En backend, el guard estricto deriva la solicitud del token y la verificación
registra la firma antes de intentar reanudar la autorización diferida.

El titular mantiene su OTP y autorización. Su redirección distingue
`data.user_request.deferred_for_cosigner`; success por sí solo no significa cierre del crédito.

## Lo que se evaluó y ya no describe el camino actual

El diseño inicial reutilizaba el OTP del titular y esperaba un campo `signer_role` con valores
`applicant`/`cosigner`. El resolver tolerante sigue en el código para analítica, con fallback al
titular, pero ese controller no expone el campo y el codeudor ya firma por su propio recorrido.
No se conserva como requisito de activación esperar el despliegue de aquel campo.

## Cómo se comprueba

Comprobar token ausente, inválido, vencido y terminal; el turno `waiting_cosigner_signature`;
código correcto, incorrecto, vencido y limitación de intentos. Para el éxito, inspeccionar tanto
`formalized` y la evidencia de firma como `userRequestAuthorized`, el estado de la solicitud y
los documentos con ambas firmas. Comprobar el caso sin catálogo y el fallo de autorización:
la respuesta de firma puede ser exitosa y la solicitud seguir pendiente.

La revisión estática y una pantalla renderizada no reemplazan ese recorrido funcional. No se
declara aceptada ni cerrada la tarea de producto por esta adaptación de contexto.

## Tarea (publicable)

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
