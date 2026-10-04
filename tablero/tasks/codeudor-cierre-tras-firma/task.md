---
id: 12
title: "Codeudor — cierre propio tras la firma (pantalla \"Firma realizada con éxito\")"
ramas: cosigner-signature-success, motai/flujo-codeudor, fix/cosigner-signature-confirmation, fix/cosigner-entry-policy, fix/cosigner-authorization-recovery
stage: work
created: "2026-07-27T12:13:57-05:00"
knowledge: [cosigner-signature, device-imei-validation]
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
- [x] Resolver y volver a validar la entrada local del titular al flujo con codeudor: la consulta
  extendida conserva la política inicial cuando no hay type 2. El titular registra al codeudor,
  firma y queda en espera (29); la segunda firma cierra en 11. Elegibilidad por API y OTP simulado.
- [x] Comprobar la espera IMEI del titular en Chromium y el action del asesor por HTTP:
  estado 28, primer poll pendiente, registro del equipo, estado 11 y segundo poll con confirmación visible.
- [x] Comprobar el consumidor del saga en Chromium: evento nuevo, snapshot al entrar y
  recuperación HTTP al volver la red; descarta secuencia antigua. Soketi real local y estado controlado.
- [ ] Completar la integración con Temporal y los reportes reales de firma. El consumidor probado
  con estado controlado y las pruebas del workflow no acreditan el servicio completo.
- [x] Contrastar y corregir localmente `COMPLETED` con autorización fallida: ambas firmas y
  cuatro PDF finales conservados, solicitud 29 y token terminal; el titular confirma el estado real.
- [x] Preparar y comprobar recuperación operativa local con las firmas registradas: revisión
  previa, aplicación explícita, rollback y concurrencia; conserva documentos y no pide otro OTP.
- [ ] Integrar y verificar la recuperación de backend en el ambiente elegido; rama local
  `fix/cosigner-authorization-recovery`. Acordar su uso operativo y seguimiento de efectos que fallen
  después del commit: una solicitud ya autorizada no debe volver a cerrarse para reenviar un aviso.
- [ ] Completar el formulario/login del asesor para IMEI con sesión vigente; el action real ya
  pasó por HTTP. La sesión Cognito cacheada devolvió `invalid_grant` al renovarse.
- [x] Corregir la confirmación local para afirmar únicamente la firma registrada: probado con
  autorización lograda, pendiente y dato ausente, más código inválido, vencido y limitación de intentos.
- [ ] Integrar las correcciones locales y verificarlas en el ambiente elegido: confirmación
  `fix/cosigner-signature-confirmation` y entrada `fix/cosigner-entry-policy`. Termina cuando se
  sirve el texto de firma registrada y la solicitud que exige codeudor pasa por su registro y espera.

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
no acredita la entrega externa del código/correo ni el saga del proveedor. La entrada del titular
se comprobó después con la corrección de política descrita abajo, conservando esos límites.
El contador `signedDocuments` registra tipos del módulo, no la cantidad de PDF finales del catálogo.
El contrato para comprobarlos está en el tema local.
Los chequeos generales de diseño y tipos conservan exactamente sus diagnósticos anteriores;
la confirmación y su regresión pasan el chequeo de formato.


La rama local del backend `fix/cosigner-entry-policy` (`96b9b84f`) corrige la discrepancia entre
la consulta extendida y la firma: sin política type 2 conserva el requisito de codeudor de type 1.
Mantiene el envelope de cupo aprobado y los montos; las decisiones con política extendida,
rechazo y aprobación manual conservan sus reglas. Se comprobaron 45 tests de decisión/guards
y cinco del endpoint con SQLite aislado. El caso local 467111 pasó por 15 pantallas HTTP,
registro del codeudor, firma del titular y espera en 29; código incorrecto no cerró, y la firma
correcta cerró en 11 con cuatro PDF que contienen ambas evidencias. El control 467112 sin
codeudor terminó en 11 y mostró su monto en Chromium. La elegibilidad del codeudor se preparó
por API y el runner avanzó las esperas tras comprobar su resultado; la salida por saga sigue pendiente.
La evidencia reproducible está en `artifacts/holder-cosigner-entry-validation.json`.

La misma rama del frontend agrega `7a679dc7`: la espera IMEI aguarda a que el fetcher termine
su revalidación antes de navegar. Antes cambiaba la URL a aprobado y dejaba la pantalla vacía;
la corrección carga `loan-approved.data` y muestra el contenido. El caso 467115 empezó en 28,
consultó pendiente, rechazó IMEI inválido y registró el correcto mediante el action real del asesor.
Persistió equipo/estado 11 y el segundo poll mostró la confirmación. MDM/OTP locales; formulario
con login del asesor aún pendiente por sesión vencida. La evidencia está en
`artifacts/imei-saga-validation.json`.

El consumidor del saga pasó tres casos en Chromium con estado controlado y Soketi real local.
Las 21 pruebas del workflow y siete del cliente Soketi pasan; no acreditan servidor Temporal ni
compilación del servicio entero. `merchant-api` se registra sólo como repo citable, sin afirmar
actividad productiva. Los mecanismos y límites están en ambos temas de knowledge; casos y
correcciones de rama permanecen en esta tarea.

La misma rama agrega `7d592088`: conserva `status_id` del GET de validación y muestra el monto
como desembolsado sólo cuando el backend confirma 11. Estado pendiente o consulta fallida tienen
una pantalla explícita y consulta manual de lectura. La espera del codeudor deja de prometer cierre
al firmar. El caso 467116 registró ambas firmas y cuatro PDF finales, pero una excepción controlada
al reanudar dejó la solicitud en 29 con token terminal. Antes se veía «Felicidades»; después el
titular ve que aún no está autorizado por enlace directo, snapshot y socket. Los controles 467111,
467112 y 467115 en 11 conservan la confirmación. Catorce tests del frontend y nueve del cierre
pasan; diseño y tipos mantienen sus diagnósticos del entorno, sin nuevos errores del cambio.
`artifacts/holder-authorization-validation.json` conserva las mediciones y sus límites. El caminador
positivo reintentó la firma al conservar 29 y terminó con error; la prueba negativa usa el tramo
registrado más consultas y navegador, sin afirmar que aquel caminador completo pasó. La recuperación operativa local se describe abajo; aún requiere integración y validación
fuera de local.

## Recuperación operativa preparada

El backend `82ec2658` incorpora `loans:recover-cosigner-authorization`: por defecto inspecciona
una solicitud; `--apply` revalida bajo bloqueo y recupera con las evidencias ya persistidas.
Exige número, estado pendiente, último codeudor formalizado/inactivo con monto aceptado y OTP,
y documentos finales consistentes por catálogo/rol. Un histórico previo o cambio de montos a
persistir requiere revisión. Reutiliza número y URLs, sin otro OTP ni render. El cierre normal
comparte el bloqueo; si ya está en 11 termina sin repetir transición, histórico ni avisos.

La solicitud sintética 467117 quedó en 29 con ambas firmas por fallo controlado del cierre.
Dos aplicaciones solapadas terminaron en 11: una autorizó y otra respondió ya autorizada,
con un histórico y una transición nuevos. Conservaron número, montos, codeudor y filas de firma;
los cuatro PDF locales contienen ambas evidencias. Chromium mostró pendiente antes y confirmación
tras consultar estado por GET. Los 34 tests/159 assertions pasan con SQLite propio en memoria;
MySQL local también revirtió todos los cambios al fallar después de crear histórico en 467116.

Los avisos y voucher se simularon para contar una llamada por efecto, sin envío externo.
La revisión valida metadatos, sin certificar archivos remotos. Fallos posteriores al commit
conservan 11 y no se reparan repitiendo autorización; requieren seguimiento propio. No hay retry
automático, API nueva ni integración Temporal acreditada. La rama local de recuperación parte
de `96b9b84f` y su parche aplica al checkout principal. Evidencia y límites en
`artifacts/cosigner-authorization-recovery-validation.json`. Knowledge conserva el mecanismo
comprobado en `main`, incluida la guarda que ya existía para el histórico.

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
