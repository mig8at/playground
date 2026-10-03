---
id: 12
title: "Codeudor — cierre propio tras la firma (pantalla \"Firma realizada con éxito\")"
ramas: cosigner-signature-success, motai/flujo-codeudor, fix/cosigner-signature-confirmation
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
- [x] Comprobar en local el tramo de firma del codeudor: monto, documentos y OTP por los loaders
  y actions reales del wizard, con proveedor OTP de prueba; firma, autorización y PDF con ambas
  evidencias contrastados por separado, incluida la confirmación renderizada en Chromium.
- [x] Comprobar el control local sin codeudor por el action de OTP del titular: destino aprobado,
  monto visible y autorización persistida. Comprobar IMEI por API con registro de dispositivo y desembolso.
- [ ] Resolver y volver a validar la entrada del titular al flujo con codeudor: el recorrido local
  desde confirmación llega a fecha de pago sin registrar/aprobar al codeudor y el backend lo frena.
  Termina cuando su OTP dirige a la espera con el crédito pendiente y la segunda firma permite cerrar.
- [ ] Validar en el frontend el recorrido de IMEI y la salida del titular por el estado del saga;
  los controles locales por API y loaders no certifican ese recorrido ni el servicio externo.
- [x] Corregir la confirmación local para afirmar únicamente la firma registrada: probado con
  autorización lograda, pendiente y dato ausente, más código inválido, vencido y limitación de intentos.
- [ ] Integrar la corrección de confirmación y verificarla en el ambiente elegido; termina cuando
  ese ambiente sirve el texto «Tu firma fue registrada correctamente» y no promete autorización
  sólo por el éxito del OTP. La rama local es `fix/cosigner-signature-confirmation`.

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

## Corrección preparada

La rama local del frontend cambia únicamente el mensaje de `cosigner/signature/success` y
agrega una regresión que atraviesa HttpClient, el schema, el repositorio, el caso de uso y el
action real con respuestas HTTP controladas. Confirma el acto de firma sin atribuirle el estado
del crédito; no agrega otra llamada con el token ya terminal ni altera el cierre del titular.
El cambio está en `2b801a4a`, disponible para revisión e integración.

`knowledge/cosigner-signature` sigue describiendo el código de main, incluida su afirmación
anterior de crédito formalizado: esta corrección es una propuesta de rama hasta integrarla.
Las pruebas del cierre con SQLite en memoria acreditan sus decisiones de catálogo y autorización.
Además se comprobó el tramo local del codeudor contra la base MySQL y plantillas Blade: rechazo
controlado de código, aceptación, autorización y archivos finales con las evidencias de ambos roles.
El proveedor OTP es simulado, el riesgo se prepara para el caso y el correo queda en log; esa prueba
no acredita la entrega externa del código/correo ni el saga del proveedor. La entrada completa del
titular sigue pendiente por el freno previo a registrar al codeudor.
El contador `signedDocuments` registra tipos del módulo, no la cantidad de PDF finales del catálogo.
El contrato para comprobarlos está en el tema local.
Los chequeos generales de diseño y tipos conservan exactamente sus diagnósticos anteriores;
la confirmación y su regresión pasan el chequeo de formato.


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
La firma del codeudor puede quedar registrada aunque la autorización del crédito siga pendiente. Su confirmación debe acreditar la firma que acaba de realizar, sin presentar como formalizado un crédito cuyo cierre todavía no se logró.

## Qué cambia
Al confirmar el código en el recorrido de firma correspondiente:

- **Comprador** → pantalla actual: "¡Felicidades, tu monto ha sido aprobado!", con el monto y sus accesos.
- **Codeudor** → confirmación propia: "¡Firma realizada con éxito! / Tu firma fue registrada correctamente." Sin monto y sin botones.

## Alcance
- Aplica al último paso del flujo, después de confirmar el código de la firma.
- El flujo del comprador **no cambia**: mismo recorrido y el mismo cierre con su monto.
- La firma en sí no cambia. La confirmación acredita que quedó registrada, incluso si la autorización del crédito sigue pendiente.
- Una firma no confirmada no muestra éxito: los errores de código y acceso siguen su tratamiento actual.

## Dónde probar
- Pruebas automáticas locales de la confirmación y errores de código. El recorrido completo en un ambiente desplegado sigue pendiente.
- **Precondición:** una solicitud con codeudor y la forma de entrar a firmar como codeudor, más una solicitud normal para comparar.

## Cómo validar
1. **Comprador (regresión).** Recorrer una solicitud normal hasta la firma. Al confirmar el código, sigue apareciendo "¡Felicidades, tu monto ha sido aprobado!" con el monto.
2. **Codeudor.** Firmar como codeudor. Al confirmar el código, aparece "¡Firma realizada con éxito!" con el texto "Tu firma fue registrada correctamente.", sin monto y sin botones.
3. **Autorización pendiente.** Si la firma quedó registrada pero el crédito sigue pendiente, la confirmación del codeudor sigue diciendo únicamente que su firma fue registrada.
4. **Código rechazado.** Un código incorrecto, vencido o limitado por intentos conserva su error y no muestra confirmación.

## Criterios de aceptación
- [ ] El comprador sigue viendo la pantalla de monto aprobado, sin cambios.
- [ ] El codeudor ve "¡Firma realizada con éxito!" con su mensaje de confirmación.
- [ ] La pantalla del codeudor no muestra monto ni botones.
- [ ] La confirmación de la firma del codeudor no afirma que el crédito quedó autorizado; ese estado se comprueba por separado.

## Dependencias / contraparte
El recorrido propio del codeudor ya registra su firma y devuelve el resultado de la autorización por separado. Esta corrección cambia su confirmación; queda pendiente integrarla y comprobar el recorrido completo con la configuración y documentos del ambiente elegido.
