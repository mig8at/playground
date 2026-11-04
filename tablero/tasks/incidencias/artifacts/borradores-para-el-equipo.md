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

**Y queda trabada.** Leído en el código: la autorización se guarda primero y la radicación corre después, aparte.
Cuando la radicación falla por la cédula, la solicitud ya está autorizada pero no se mandan las notificaciones ni el
comprobante, y las pantallas del pagaré ya no dejan reintentar porque la solicitud está en «autorizada». Hay una ruta del
admin para volver a radicar.

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

## 11 · La simulación de una refinanciación CreditopX cuenta dos veces los gastos de cobranza (Baja)

**Qué pasa.** Al refinanciar un crédito CreditopX, la simulación muestra cuánto se condona: intereses, mora, gastos de
cobranza y el «descuadre» entre el saldo total y sus componentes. El código supone que el saldo total no incluye la
cobranza, pero hoy sí la incluye en los créditos que se actualizan. Entonces la cobranza aparece dos veces en lo
condonado: una como concepto propio y otra dentro del descuadre. Lo que queda escrito en el crédito refinanciado sale
bien; lo que ve quien simula y lo que queda en la bitácora del movimiento, no.

**Cuánto.** Medido en producción sobre el último registro de cada crédito con gastos de cobranza: los 1.113 créditos
vigentes que se movieron en noviembre incluyen la cobranza en el saldo total; los que se movieron por última vez hasta
agosto (unos 1.100) no la incluyen. Septiembre está mezclado. O sea, la suposición del código era cierta cuando se
escribió (finales de agosto) y dejó de serlo.

**Por qué cambió en septiembre.** El 16 de septiembre se corrigió el proceso nocturno para que el saldo total incluyera
la cobranza (antes el cliente veía una cifra menor a la que iba a pagar). Ese arreglo es correcto, pero la refinanciación
se había escrito dos semanas antes con el supuesto contrario y no se actualizó.

**Propuesta.** Calcular el descuadre sumando también los gastos de cobranza a los componentes, o tomarlos del descuadre
y no como concepto aparte.

---

## 12 · El checkout de ecommerce deserializa datos de la dirección sin restringir clases (Seguridad · urgente)

**Qué pasa.** El endpoint que crea una solicitud desde una tienda recibe el pedido, la URL de vuelta, la configuración
y la URL de proceso codificados en la dirección, y los reconstruye con `unserialize()` **sin restringir qué clases
puede instanciar**. Reconstruir datos que vienen de afuera permitiendo cualquier clase es un riesgo conocido de PHP
(inyección de objetos): una entrada preparada puede hacer que se creen objetos que el código no espera. El endpoint
está en un grupo **sin autenticación** y la reconstrucción ocurre **antes** de validar la credencial de la tienda, así
que cualquiera que llegue a la URL pasa por ahí.

**Cómo se comprobó.** Leyendo el código de `main` (no se intentó explotarlo): en `legacy-backend`,
`EcommerceRequestService` llama a `unserialize()` en cuatro puntos sin la opción `allowed_classes`; en
`legacy-application`, `WoocommerceController` hace lo mismo. El checkout de Corbeta, en el mismo repositorio, ya usa la
forma segura (`allowed_classes => false`), así que la corrección ya tiene precedente adentro.

**Propuesta.** Usar `allowed_classes => false` (o pasar el contenido a JSON) en los dos monolitos, y revisar el
contrato con los complementos de las tiendas. Conviene avisar a seguridad y priorizarlo.

---

## 13 · La credencial de las tiendas de ecommerce es predecible (Seguridad)

**Qué pasa.** La credencial con la que una tienda se identifica para crear solicitudes se arma juntando el id del
comercio, el código (hash) de la sucursal y la fecha de creación, y convirtiéndolo a hexadecimal. El código de la
sucursal es público (viaja en las direcciones de las compras) y el id del comercio es un número bajo y secuencial, así
que quien conozca esos dos datos y la fecha puede reconstruir la credencial. Es igual en los dos monolitos.

**Cómo se comprobó.** Leyendo el código de `main`: la credencial se genera con `bin2hex(id + hash + fecha)` al crear
la sucursal de ecommerce. Hay una forma segura de generar credenciales (bytes al azar) ya usada en el mismo sistema
para otros secretos.

**Propuesta.** Generar la credencial con bytes aleatorios y decidir la rotación de las que ya existen.

---

## 14 · La contraseña del certificado de Credifamilia Consumo queda en los registros (Seguridad · activo)

**Qué pasa.** Cada vez que se radica un crédito de Credifamilia Consumo, el sistema escribe en los registros (que van a
la herramienta de observabilidad del equipo) la contraseña del certificado con que se firma, en texto plano. El resto
del mismo archivo evita a propósito registrar esos secretos; una sola traza se quedó con la contraseña.

**Cómo se comprobó.** Leyendo el código de `main` (el método que arma el cliente de firma registra la contraseña) y
contando en los registros de producción: esa traza salió **14 veces en las últimas 24 horas**, así que está ocurriendo
hoy. No se trajo el contenido para no exponer el valor.

**Propuesta.** Sacar la contraseña de esa traza y decidir con seguridad si el certificado se rota. Aparte, el comando
que siembra esa credencial usa nombres de campo distintos a los que lee la radicación.

---

## 15 · La vista previa de pago devuelve el nombre del titular con solo el número de solicitud (Seguridad)

**Qué pasa.** La pantalla de pago tiene una consulta pública (sin sesión) que, dado el número de una solicitud,
devuelve el nombre completo del titular junto con el monto y la entidad. El número de solicitud es consecutivo. Hay un
interruptor que exigiría un identificador firmado en vez del número pelado, pero viene **apagado por omisión**.

**Cómo se comprobó.** Leyendo el código de `main`: el interruptor `require_credit_token` es falso por defecto, la
consulta acepta un id numérico y devuelve el nombre del titular, y la ruta es pública. En local, una llamada sin sesión
llegó a la lógica de negocio (no la frenó ninguna autenticación).

**Propuesta.** Encender el interruptor del identificador firmado (o exigirlo siempre) para que el número consecutivo no
devuelva datos del titular.

---

## 16 · El pre-registro de comercios no tiene freno contra un programa que cambie el correo (Seguridad · decisión)

**Qué pasa.** El formulario público de pre-registro de comercios manda un token que, por ir en la página, cualquiera
puede ver; el propio código lo dice: filtra llamadas anónimas pero no protege contra abuso. El único límite es de 10
envíos por minuto **por correo**, así que un programa que cambie el correo en cada envío no tiene límite. Tampoco hay
captcha. El mismo código lo reconoce («para eso hace falta un captcha»).

**Cuánto cuesta el abuso.** Cada envío guarda una fila de pre-registro (sin deduplicar) y registra en los logs el
nombre, correo, teléfono y documento del prospecto. No crea comercios, usuarios ni cuentas, ni manda correos o SMS.
O sea: el costo es llenar la base y los logs con datos personales, no gastos de mensajería.

**Cómo se comprobó.** Leyendo `main` del backend y del front (sin llamar al endpoint). No se revisó si el API Gateway o
CloudFront tienen un límite propio: eso vive en el repositorio de infraestructura.

**Propuesta.** Decidir entre captcha en el formulario o un límite por origen en el gateway, y revisar si hace falta
registrar los datos personales completos en cada envío.

---

## 17 · En el admin viejo, tres listados muestran todo a roles que no deberían (Seguridad)

**Qué pasa.** Tres pantallas del admin de `legacy-application` no recortan lo que muestran según el rol de quien entra:

- **Usuarios:** sólo recorta para «Entidad Comercio» (y ni eso si ese usuario no tiene entidad asignada). Cualquier
  otro rol con el permiso de ver usuarios ve a todos.
- **Links de pago:** sólo recorta para un perfil (el 6). Admin comercio, Comercial, Entidad Comercio y los demás con el
  permiso ven los links de todos los comercios.
- **Revisión de perfilamiento:** no tiene chequeo de permiso (sólo el menú la esconde) y los datos se filtran por el
  comercio que llega en la petición, no por el del usuario. El rol sólo recorta la lista desplegable de comercios, así
  que cualquier usuario del admin puede pedir los datos de un comercio que no es suyo.

**Cómo se comprobó.** Leyendo `main` (el mismo commit que el último tag de producción). No se corrió: falta saber qué
roles tienen de verdad los permisos de ver usuarios y ver links en la base.

**Propuesta.** Decidir qué ve cada rol y aplicarlo en la consulta (no sólo en el menú o en el desplegable).

---

## 18 · El admin viejo tiene rutas de prueba en producción, y una escribe en la base (Seguridad)

**Qué pasa.** Tres rutas de prueba del admin de `legacy-application` siguen registradas en producción (están en el
último tag), sin ninguna condición de ambiente. Todas piden sesión iniciada:

- **`/create-profiling`:** pide además un permiso del tablero. Recorre todas las solicitudes autorizadas o en estado 3,
  **crea registros de perfilamiento**, se quita el límite de memoria y de tiempo, y termina con un volcado de depuración
  en la respuesta. En producción eso es una carga pesada y escrituras disparables desde el navegador.
- **`/pruebas-modelo`:** sin permiso específico. Busca un usuario por cédula con sus datos de centrales y llama a un
  modelo de predicción alojado en un servicio externo de pruebas (un dominio de replit).
- **`/test-perfilamiento`:** sin permiso específico; por la forma del método, una llamada debería fallar antes de
  ejecutar nada (leído, no corrido).

**Cómo se comprobó.** Leyendo `main` (igual al último tag). No se llamó a ninguna ruta.

**Propuesta.** Sacar las tres del registro de rutas (o limitarlas a ambientes locales), y revisar con quien la mantenga
si `/pruebas-modelo` todavía se usa y si sus datos deben salir a ese servicio externo.

---

## 19 · El bloqueo y desbloqueo de celulares financiados se puede pedir sin sesión (Seguridad · alta)

**Qué pasa.** En el backend nuevo, las rutas que bloquean, desbloquean, quitan el PIN y consultan el estado del celular
financiado (la garantía de los créditos IMEI) están **fuera del grupo que exige sesión**. Reciben el IMEI y la llave del
comercio ante el proveedor de bloqueo directamente en la petición, y la reenvían sin comprobar que ese equipo sea de ese
comercio; sólo dejan registro de quién lo pidió. Lo único que se interpone es conocer esa llave.

**Cómo se comprobó.** Leyendo `main`: las cuatro rutas están después del cierre del grupo autenticado, con sólo la
observabilidad y el grupo base, que no autentica; el servicio dice explícitamente que toma la llave «del request HTTP,
no de la base». Está así desde marzo de 2026. **No se probó contra ningún ambiente.**

**Falta comprobar:** si la llave del comercio llega al navegador (el admin viejo la manda en el cuerpo de la petición,
así que el front la tiene) y si el API Gateway le pone una autorización delante a estas rutas (eso vive en el
repositorio de infraestructura).

**Propuesta.** Meter las cuatro rutas en el grupo autenticado y resolver la llave del comercio desde la base a partir
del equipo, no desde la petición.

---

## 20 · En el admin viejo, los datos de un cliente se abren por id sin mirar de qué comercio es (Seguridad)

**Qué pasa.** En el admin de `legacy-application`, varias pantallas que reciben el id en la dirección no comprueban que
el registro sea del comercio de quien está conectado. Un usuario de un comercio (Admin o Superadmin comercio) que
escriba el id de otro cliente puede ver:

- **los documentos de identidad** (las dos caras de la cédula y la foto del rostro) y el resultado de listas de control;
- **el formulario** que llenó el cliente;
- **sus solicitudes**, incluidas las de otros comercios;
- **el detalle de un crédito CreditopX** (el listado sí mira un permiso, el detalle no).

**Cómo se comprobó.** Leyendo `main` (igual al último tag): ninguna de esas rutas lleva chequeo de permiso ni compara
el comercio del registro con el del usuario, y el grupo del admin sólo exige sesión. No se corrió; falta saber si el
menú las esconde a esos roles (el servidor no lo impide) y si esos roles tienen usuarios en producción.

**Propuesta.** Añadir una política que compare el comercio del registro con el del usuario conectado (o restringir
estas pantallas a roles internos).

---

## 21 · En el admin viejo, acciones que cambian datos sólo piden estar conectado (Seguridad)

**Qué pasa.** Varias acciones del admin de `legacy-application` que **escriben** no revisan ningún permiso: alcanza con
tener sesión en el admin, aunque el menú sí las esconda a quien no tiene el permiso. Las verificadas:

- dar de baja a un usuario y a un usuario comercial, las dos **por un enlace (GET)**;
- desactivar una entidad;
- **borrar de verdad** (sin papelera) las credenciales de integración de una entidad;
- cambiar las reglas y la frecuencia de consulta a Datacrédito, y el disparador de Datacrédito del punto de venta
  (con una opción que lo reescribe en todas las sucursales del comercio);
- cambiar el estado de una solicitud al gestionarla;
- la validación manual (pasa la solicitud a 10 o a 6 y le manda un mensaje al cliente);
- los envíos de mensajes de marketing (sólo la pantalla pide el permiso; el envío no).

El backend nuevo tiene equivalentes de cuatro de ellas (baja de usuario comercial, disparador, desactivar entidad y
reglas de Datacrédito) que tampoco miran permisos: confían en la identidad que pone el gateway.

**Cómo se comprobó.** Leyendo `main` (igual al último tag): esas rutas sólo están en el grupo que exige sesión, sin el
chequeo de permiso que otras rutas del mismo archivo sí tienen, y sus controladores no autorizan. No se corrió nada.
Falta saber cuántos usuarios no administradores pueden entrar al admin (un comentario del código habla de unos 790).

**Propuesta.** Ponerle a cada acción el mismo permiso que ya usa su menú, y pasar las bajas de GET a POST/DELETE.

---

## 22 · El auto-onboarding se salta el pipeline nuevo de KYC (Media)

**Qué pasa.** En el canal de auto-onboarding (la tienda que llena los datos del cliente sola), el asistente guarda los
datos personales y valida el código del celular **siempre por el camino viejo**. El formulario normal, en cambio,
pregunta primero si el comercio usa el pipeline nuevo de KYC y elige el camino según eso. Resultado: un comercio que va
por el pipeline nuevo, si además usa auto-onboarding, valida la identidad por la cascada vieja y nunca corre el pipeline.

**Cómo se comprobó.** Leyendo `main` del front y del backend: las pantallas del auto-onboarding usan sólo los
repositorios del camino viejo, mientras que el formulario normal resuelve el flujo del comercio y elige entre los dos.
No se corrió todavía: falta sembrar en local un comercio que esté en el pipeline y tenga auto-onboarding.

**Ojo al arreglarlo.** Hay que cambiar las dos pantallas juntas (OTP y guardado); si se cambia sólo una, el buró se
consulta dos veces. Y con el pipeline, la pantalla de «validando» ya no sabe en el momento si la identidad pasó: eso
cambia lo que ve el cliente y lo decide producto.

**Propuesta.** Que el auto-onboarding resuelva el flujo del comercio como el formulario normal y use el camino nuevo
cuando corresponde.

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
