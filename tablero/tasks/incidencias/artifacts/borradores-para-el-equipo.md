# Borradores para socializar con el equipo · 2026-11-03

Incidencias encontradas al revisar el código de `main` y medidas en producción (sólo lectura) o corridas en local.
**Nada de esto está en Jira ni tiene cambios hechos**: es para conversarlo con el equipo y decidir dueño y arreglo.
Los comandos con que se midió cada una están en la tarea `incidencias` del tablero de Miguel.

Cada borrador dice: qué pasa · a quién afecta y cuánto · cómo se comprobó · cómo se reproduce · una propuesta.

---

## 1 · Clientes del KYC nuevo quedan con continuidad laboral 0 aunque Mareigua tenga sus meses (Alta)

**Qué pasa.** Cuando Ágil Data no tiene información de la persona, el pipeline nuevo de KYC guarda su resumen como
una lista vacía. El motor de perfiles toma «Ágil Data o, si no hay, Mareigua», pero una lista vacía no cuenta como
«no hay», así que nunca mira Mareigua y la continuidad laboral da 0. Los perfiles que piden continuidad dejan afuera
a ese cliente. El flujo viejo no tiene el problema: ahí se guarda vacío como nulo y sí cae a Mareigua.

**Cuánto.** En producción se guardan así unos 2.700 resúmenes por mes (2.656 en octubre, 54 en los primeros días de
noviembre); 555 de los 2.726 tienen 12 meses en Mareigua.

**Cómo se comprobó.** Corrido en local: un cliente con Ágil Data vacía y Mareigua con 6 meses de continuidad, por el
pipeline nuevo, queda con continuidad calculada 0. El mismo cliente por el flujo viejo queda con Mareigua y sale en
la categoría alta.

**Dónde.** `legacy-backend` · `Modules/Loans/App/Services/LenderUserCategoryService.php` (`getContinuity`: `agildata ??
mareigua`) y `Modules/RiskV2/App/Extractors/RiskCentral/AgildataExtractor.php` (`summarise` devuelve `[]` sin datos).

**Propuesta.** Que `getContinuity` trate una colección vacía como ausente, o que el pipeline guarde nulo. Una línea en
cualquiera de los dos lados.

---

## 2 · SmartPay: dos respuestas del formulario nunca suman puntos (Alta)

**Qué pasa.** La política de puntaje de SmartPay compara el texto exacto de la respuesta. Dos opciones no coinciden
con lo que guarda el formulario: el rango «RD$40,001 – RD$50,000» está escrito con raya larga y el formulario guarda
guion, y «Trabajo en delivery o plataformas» no existe en el formulario (que guarda «Conductor de plataforma
digital»). Quien elige esas opciones suma 0 en vez de 15 o 10.

**Cuánto.** De 38 clientes con ese rango de ingreso, 14 quedaron en una categoría peor de la que les correspondía
(más cuota inicial y más tasa). Verificado con una evaluación real: el log guardó 90 puntos y le correspondían 105.

**Además.** Dos rangos de capacidad de pago se pisan en 50 (uno da 15 puntos y el otro 10), y el código toma el
primero que devuelva la base, sin orden.

**Propuesta.** Corregir los textos de la política (es un cambio de datos, no de código) y los rangos que se pisan.

---

## 3 · El desembolso de un equipo con IMEI no revisa en qué estado está la solicitud (Seguridad)

**Qué pasa.** La ruta que desembolsa un equipo (`POST api/loans/requests/device/{id}/disburse`) no pide sesión ni
revisa el estado de la solicitud: sólo que tenga un IMEI guardado. Para SmartPay lleva la solicitud a «autorizada»
sin mirar si estaba cancelada o ya desembolsada. Si ya estaba autorizada, vuelve a generar el PDF, el plan de
pagos, el correo y el comprobante, y vuelve a cancelar los otros créditos del cliente. El id de la solicitud es
secuencial.

**Cómo se comprobó.** Corrido en local, con una solicitud de prueba de SmartPay cerrada por el canal del equipo:

| paso | respuesta | estado | registros «Desembolso IMEI» |
|---|---|---|---|
| desembolso normal | 200 | 11 | 1 |
| repetir el desembolso sobre la ya autorizada | 200 «Crédito desembolsado correctamente» | 11 | 2 |
| cancelarla (8) y repetirlo | 200 «Crédito desembolsado correctamente» | **11** | 3 |
| la ruta normal de autorización, sobre la misma | **403** «CREDIT_ALREADY_DISBURSED» | 11 | 3 |

Las llamadas fueron sin sesión, sólo con el id. El histórico del crédito no se duplicó (esa parte tiene guarda).

**Propuesta.** Decidir con el equipo qué guarda va: el estado esperado (como la ruta normal de autorización), una
sesión o un token del flujo.

---

## 4 · Una solicitud llega a «autorizada» sin que la identidad haya terminado (Media)

**Qué pasa.** En los comercios que usan el KYC nuevo, ni el listado, ni la elección de entidad, ni la firma, ni la
autorización revisan que la validación de identidad haya terminado: la única guarda es la pantalla.

**Cómo se comprobó.** Corrido en local con un cliente del comercio 26 cuya identidad quedó sin confirmar: la corrida
dijo que la cédula es de otra persona y pidió corregir, y la cuenta sigue como «TEMPORAL USER» con el nombre que tecleó.
Con llamadas directas, sin pasar por la pantalla, recibió el listado completo, eligió Credifamilia Salud, confirmó
fecha y plan, se le generó el pagaré, validó el OTP y la autorización la dejó en **estado 11 (autorizada)**. Lo
único que frenó fue la radicación ante Credifamilia, que exige las imágenes de la cédula (y no las había porque la
identidad nunca terminó): la solicitud quedó autorizada sin radicar.

**En producción.** Las 5 solicitudes autorizadas desde octubre con el cliente todavía temporal son de entidades que
originan y validan de su lado (Addi, Brilla, Welli, Meddipay). No se vio en entidades que origina Creditop.

**Con una CreditopX no llega.** Repetido con un cliente de Mediarte en la misma situación: las CreditopX del
comercio no salen en el listado, y al elegir una igual por llamada directa todo pasa hasta el código de firma, pero la
autorización la rechaza («el usuario no tiene una categoría vigente con la entidad») y queda en estado 28. La
categoría exige la consulta a centrales, que nunca corrió. O sea que lo expuesto son las entidades de riel 4, cuyo
freno es la radicación.

**De paso.** El backend acepta elegir una entidad que no estaba en el listado del cliente, y avanza con ella hasta
generar el pagaré.

**Propuesta.** Que la autorización (o la elección de entidad) exija la identidad terminada en los comercios del KYC
nuevo, y no sólo la pantalla.

---

## 5 · La sucursal de ecommerce de un comercio de otro país nace en una ciudad de Colombia (Media)

**Qué pasa.** Al crear la sucursal de ecommerce, los dos monolitos le ponen siempre la ciudad «TODAS LAS CIUDADES»
de Colombia, sea cual sea el país del comercio. Los documentos imprimen «BOGOTÁ» para esa ciudad.

**Cómo se comprobó.** Corrido en local con un comercio peruano: la sucursal nació en la ciudad comodín de Colombia.
En producción hay tres sucursales con ciudad de otro país (dos de comercios peruanos en Bogotá).

**Propuesta.** Usar la ciudad comodín del país del comercio.

---

## 6 · Dos sucursales activas no reciben solicitudes porque comparten código con otra (Media)

**Qué pasa.** El código (hash) de cada sucursal se arma con la hora al segundo y no se exige que sea único. Dos altas
en el mismo segundo dan el mismo código, y el sistema siempre resuelve la primera.

**Cuánto.** En producción hay 4 pares de sucursales con el mismo código; en cada par la segunda tiene 0 solicitudes.
Dos de ellas están activas: «CC CENTRO MAYOR» (comercio 76) y «1402-Bqlla Cl 76» (comercio 41).

**Propuesta.** Generar el código al azar con chequeo de unicidad (ya existe una función así para otra alta) y darles
a esas dos sucursales su propio enlace.

---

## 7 · El cupo de CreditopX se cae si Experian manda las tarjetas como nulo (Baja · robustez)

**Qué pasa.** Una validación del motor de perfiles recorre las tarjetas de crédito del reporte de Experian sin
contemplar que vengan como nulo; otras dos validaciones del mismo archivo sí lo contemplan. En producción no pasa
hoy (Experian real no manda ese nulo: 0 casos en 24 horas), pero el simulador de qa sí, y ahí el cupo se caía.

**Dónde.** `LenderUserCategoryService.php`, línea 1298.

**Propuesta.** Tolerar el nulo como las otras dos validaciones. Una línea.

---

## 8 · Pasarse del tope de validaciones de identidad cancela la solicitud sin decir por qué (Media)

**Qué pasa.** Cuando un cliente supera el tope de validaciones de identidad con ADO (hoy 8 en 24 horas, configurable),
el backend responde con un código claro («demasiados intentos, intente más tarde»). El asistente no lo mira: cualquier
falla al iniciar la validación lo manda a la pantalla de «solicitud cancelada», que al cargar **cancela la solicitud**
y le muestra «Debido a nuestras políticas internas, no podemos continuar con tu solicitud». El cliente no sabe que
podía volver a intentarlo al día siguiente, y la solicitud ya no sirve.

**Cómo se comprobó.** Corrido en local con un cliente de prueba con 8 intentos en las últimas 24 horas:

| paso | respuesta |
|---|---|
| iniciar la validación de identidad | 429 «Ha excedido el número máximo de intentos… intente nuevamente más tarde» (`TOO_MANY_ATTEMPTS`) |
| lo que llama la pantalla de cancelación | 200, la solicitud pasa a **8 (cancelada)** con el mensaje de políticas internas |

El paso del asistente que une los dos (cualquier falla → pantalla de cancelación) está leído en el código; la analítica
lo registra como «enroll_failed», sin el motivo.

**Propuesta.** Que el asistente distinga el tope: un mensaje de «intentaste demasiadas veces, vuelve mañana» sin
cancelar la solicitud (o cancelarla con un motivo propio que se pueda contar).

---

## 9 · Registrar el equipo de un crédito IMEI: tres formas de quedar trabado (Media)

**Qué pasa.** Después de la firma, el asesor registra el IMEI del equipo y el sistema lo inscribe en la plataforma de
bloqueo y desembolsa. Tres cosas salen mal:

1. **Un rechazo del proveedor de bloqueo sale como error del servidor.** «El equipo ya está inscrito» o «IMEI no
   reconocido» son respuestas de negocio del proveedor, pero el backend las devuelve como error 500. Para el monitoreo
   se ven igual que una caída.
2. **El equipo queda inscrito afuera sin quedar guardado acá.** El sistema inscribe primero y después pide el modelo
   del equipo; si el proveedor no lo reporta, responde error, pero la inscripción ya se hizo y en nuestra base no hay
   ningún registro del IMEI.
3. **Si el desembolso falla, el reintento no puede funcionar.** La pantalla dice «El IMEI quedó registrado, pero no
   pudimos desembolsar… Intenta nuevamente», y el reintento vuelve a registrar el equipo desde cero en vez de sólo
   desembolsar. Si el proveedor rechaza la segunda inscripción, el reintento termina en «El dispositivo ya está
   registrado» y nunca llega al desembolso: la solicitud queda firmada, con el equipo guardado, sin desembolsar.

**Cómo se comprobó.** Corrido en local con una solicitud de SmartPay firmada, simulando las respuestas del proveedor:

| caso | respuesta del sistema | qué quedó |
|---|---|---|
| el proveedor dice «equipo ya inscrito» (409) | 500 «El dispositivo ya está registrado» | — |
| el proveedor dice «IMEI no reconocido» (422) | 500 «El dispositivo no es reconocido» | — |
| el proveedor inscribe pero no reporta modelo | 500 «El dispositivo no reporta modelo» | inscripción hecha afuera, ningún registro del IMEI acá |
| registro correcto y después el reintento | primero 200; el reintento, 500 «El dispositivo ya está registrado» | solicitud en «Autorizado pendiente desembolso», con el IMEI guardado |

Que el reintento vuelve a registrar está leído en el código del asistente. **Falta confirmar** con el proveedor real
qué contesta al inscribir dos veces el mismo equipo: en local esa respuesta se simuló.

**Propuesta.** Responder los rechazos del proveedor como 4xx; guardar el registro antes de dar por buena la
inscripción (o deshacerla si falta el modelo); y que el reintento después de un desembolso fallido sólo desembolse.

---

## 10 · En el formulario de datos de siempre, el cliente choca consigo mismo si reenvía sus datos (Baja)

**Qué pasa.** En los comercios que no usan el KYC nuevo, si el cliente vuelve a mandar su propio formulario de datos
personales (por ejemplo, volviendo atrás después de enviarlo), el sistema lo rechaza como si fuera otra persona:
primero por el correo («El correo electrónico ya se encuentra registrado») y, si cambia el correo, por el documento
(«El número de documento ya se encuentra registrado con el celular *******200», que es su propio celular). El
formulario del KYC nuevo no tiene este problema: ahí el dueño de la solicitud está exento de los dos chequeos.

**Cómo se comprobó.** Corrido en local con un cliente de Pullman que ya había completado el formulario: reenviar los
mismos datos dio el error del correo (422), y con otro correo, el del documento con su propio celular.

**Falta medir** cuántas veces le pasa a un cliente real: no está claro que el asistente lo lleve de vuelta al
formulario salvo que use el botón atrás o envíe dos veces.

**Propuesta.** Eximir al dueño de la solicitud, como ya hace el formulario nuevo.

---

## Sobre originación delegada (CORE-918)

Lo que sigue va con la tarea de originación delegada, no con incidencias, pero conviene conversarlo junto:

- **En el front de qa, la tarjeta de Credifamilia Materiales sale en error** («No pudimos consultar esta entidad»):
  el front sólo espera y reintenta la preaprobación de Credifamilia Salud. Visto en qa el 2026-11-03.
- **Para llevar Materiales a producción falta:** el alias de preaprobación en `main` de pre-approvals-service, los
  estados de transacción del 214, su tabla de porcentajes FNG, y correr las migraciones de perfil y slug con
  `APP_ENV=production` (con otro valor se cargan sobre otra entidad).
- **El front de qa se presenta como escritorio ante el backend** en una de sus consultas, y eso podría mandarle al
  cliente el mensaje de «continuar en el celular». Falta comprobar si pasa en producción.
