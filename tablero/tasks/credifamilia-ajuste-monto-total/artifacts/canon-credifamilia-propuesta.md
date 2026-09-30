# Qué podría entrar a canon de Credifamilia, en el formato que canon espera

Propuesta para tener a mano cuando se dicte. **Nada de esto está escrito en canon todavía.** Cada pieza pasó el ensayo de canon (`/api/propose`: lista, sin rechazos del lint) y cada afirmación se verificó contra `main` de `pre-approvals-service`, `legacy-backend` y `legacy-application`.

## Cómo lo espera canon

Sale de la guía de dictado de canon (`skills/dictar.md` del repo de canon):

- **Entra** lo que el código no dice y lo que ahorra leerlo: dónde se decide algo, qué condición cambia el resultado, la trampa que hace perder una tarde. **No entra** lo que se entiende leyendo el archivo en un minuto, la historia de cómo se llegó, ni datos del ambiente (mediciones, fechas de cuándo se midió o se descubrió algo; el lint las rechaza).
- **Forma:** la primera oración es la regla, en negrita, y es la única negrita. Frases cortas con sujeto explícito. 60 a 200 palabras. Sin ⚠, sin listas de excepciones que no cambian la respuesta, sin hablar de «el código» ni de las fuentes. Si otra sección ya lo dice, se enlaza con `[[tema/context#ancla]]`.
- **Sólo lo que existe en `main`.** Un PR sin mergear no entra. Mismo `node` + `section` reemplaza la pieza: corregir es reescribir.
- **Metadatos por pieza:** `node`, `section` (el título; de él sale el ancla), `text`, `kind` (`addition` o `correction`), `source` (`verified`), `verified`, `as_asked`, `objetivo` (la responsabilidad), `se_deduce_leyendo` y `archivos` con los alias de repo de canon (`legacy-backend`, `pre-approvals-service`, …; se validan contra `main`).
- **Protocolo:** un borrador (`POST /api/draft`), una pieza por sección (`POST /api/draft/{id}`), y el cierre (`POST /api/draft/{id}/close`) guarda todo en una revisión. Desde este repo: `make canon-propose PIECE=…` ensaya y `make canon-write PIECE=… TITLE=…` escribe; el conector ya manda la cookie `AUTH_GOOGLE` de `connectors/.env.prod`.

Hoy `credifamilia/context` ya cubre: la puerta del listado, que un «aprobado» no trae cupo, el límite de intentos del proveedor, que la ocupación clasifica y no excluye, el sondeo de la espera, regenerar documentos, y que «autorizada» no es «radicada». Las piezas de abajo no repiten nada de eso.

## Piezas nuevas (4)

### N1 · La pre-aprobación de Credifamilia se resuelve en varias rondas: la primera radica y las siguientes consultan el estado

**La pre-aprobación de Credifamilia se resuelve en varias rondas: la primera radica y las siguientes sólo consultan el estado.** Cada ronda pide un token nuevo al proveedor, con el certificado del lender. La primera radica al cliente y recibe el número de transacción, con estado pendiente; las demás preguntan por esa transacción. El servicio no espera ni repite solo: quien vuelve a preguntar es el asistente, y la fila pendiente se reemplaza conservando su identidad.

El proveedor responde con un estado numérico. El 3 con detalle «APROBADO» es aprobado; el 3 con otro detalle, y el 4, son rechazo; el 0, el 1 y el 2 siguen pendientes. Los tiempos y el límite de intentos están en [[credifamilia/context#la-espera-es-normal-es-la-unica-entidad-con-sondeo]].

- **Cómo la buscarían** (`as_asked`): ¿cuántas llamadas hace la pre-aprobación de Credifamilia y cuándo queda aprobada o rechazada?
- **Objetivo del área:** Entender cómo se resuelve la pre-aprobación de Credifamilia en el microservicio: qué llamadas hace en cada ronda, quién repite la consulta y cómo se traduce el estado del proveedor.
- **Se deduce leyendo:** el orden de las llamadas al proveedor, qué hace cada ronda y cómo el estado numérico del proveedor se vuelve aprobado, pendiente o rechazado
- **Archivos:**
  - `pre-approvals-service`: `pre-approvals-service/internal/infra/lending_products/credifamilia/client.go`, `pre-approvals-service/internal/infra/lending_products/credifamilia/oauth2_strategy.go`, `pre-approvals-service/internal/infra/lending_products/credifamilia/adapter.go`, `internal/core/usecases/preapproval/check_preapproval.go`

### N2 · El servicio de pre-aprobados no guarda credenciales de Credifamilia: se las pide al backend

**El servicio de pre-aprobados no guarda credenciales de Credifamilia: se las pide al backend en cada consulta.** El backend busca la credencial del lender para el comercio y, si no hay, para la sucursal, y entrega el certificado y la llave, las claves de acceso, el usuario Negozia y la oficina. Si falta el certificado, la llave o las claves de acceso, la consulta no sale.

La configuración del servicio sólo trae las direcciones del proveedor y el tiempo de espera. La credencial sale de la misma tabla y de las mismas claves de certificado y llave que usa la radicación SOAP: [[credifamilia/context#el-soap-de-la-radicacion-se-firma-a-mano-y-su-certificado-sale-de-la-credencial-del-rest]].

- **Cómo la buscarían** (`as_asked`): ¿de dónde saca el servicio de pre-aprobados el certificado y las claves de Credifamilia?
- **Objetivo del área:** Saber de dónde obtiene el microservicio de pre-aprobados las credenciales de Credifamilia y qué pasa si faltan.
- **Se deduce leyendo:** quién entrega la credencial al microservicio, cómo la busca el backend por comercio y por sucursal, y cuáles campos exige el microservicio
- **Archivos:**
  - `pre-approvals-service`: `pre-approvals-service/internal/infra/lending_products/credifamilia/oauth2_strategy.go`, `internal/infra/services/credentials_service.go`, `internal/infra/lending_products/workflow.go`
  - `legacy-backend`: `Modules/Onboarding/App/Services/lenders/LenderCredentialService.php`, `Modules/Onboarding/App/Http/Controllers/LenderController.php`

### N3 · La radicación SOAP sólo hereda de la pre-aprobación la tasa y el tipo de fianza, y sólo si salió aprobada

**La radicación SOAP sólo hereda de la pre-aprobación la tasa efectiva, la tasa mensual y el tipo de fianza, y sólo si la pre-aprobación salió aprobada.** Si quedó rechazada o pendiente, o el servicio no respondió, esos datos viajan vacíos: no hay excepción ni valor por defecto. Falta entonces la tasa efectiva, que el proveedor marca como obligatoria.

El porcentaje de fianza no viaja en la radicación: sólo lo usa el plan de pagos. La tasa mensual, si la pre-aprobación no la trae, cae a la tasa guardada en la solicitud.

- **Cómo la buscarían** (`as_asked`): ¿qué datos de la pre-aprobación llegan a la radicación SOAP de Credifamilia y qué pasa si no está aprobada?
- **Objetivo del área:** Saber qué datos de la pre-aprobación llegan a la radicación SOAP de Credifamilia y qué ocurre cuando la pre-aprobación no salió aprobada.
- **Se deduce leyendo:** de qué claves de la pre-aprobación salen la tasa y el tipo de fianza del SOAP, y qué queda vacío cuando no hay pre-aprobación aprobada
- **Archivos:**
  - `legacy-backend`: `Modules/Onboarding/App/Services/lenders/CredifamiliaConsumo/CredifamiliaConsumoService.php`, `app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php`, `app/Services/PaymentPlan/Credifamilia/CredifamiliaPayloadBuilder.php`

### N4 · El SOAP de radicación pide datos que sólo captura el formulario dinámico

**El SOAP de radicación pide datos que sólo captura el formulario dinámico: activos, pasivos, dirección y las ciudades de residencia, nacimiento y expedición.** Cada dato sale del primer campo con valor entre varios equivalentes del formulario, y de cada campo se toma el valor más reciente. El patrimonio no se captura: se calcula como activos menos pasivos.

Las ciudades viajan como código DANE, buscando su nombre exacto en el catálogo de ciudades; si no coincide, el campo viaja vacío, sin valor por defecto. La ciudad de nacimiento cae a la del usuario si el formulario no la trae. El manual del proveedor marca todos estos datos como obligatorios.

No hay una definición productiva del formulario de Credifamilia en el código.

- **Cómo la buscarían** (`as_asked`): ¿qué campos del formulario dinámico necesita el SOAP de Credifamilia y de dónde salen las ciudades?
- **Objetivo del área:** Saber qué datos del formulario dinámico alimentan la radicación SOAP de Credifamilia y cómo se convierten las ciudades a código.
- **Se deduce leyendo:** qué campos del formulario llenan cada dato del SOAP, cuál gana entre varios equivalentes y cómo se resuelve la ciudad
- **Archivos:**
  - `legacy-backend`: `app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php`, `app/Actions/Lenders/CredifamiliaConsumo/SoapClient.php`

## Reescritura de lo que ya está dictado (3)

Las tres secciones sobre la radicación que se dictaron antes tienen varias negritas, listas y una tabla. Lo que canon espera es lo de abajo: mismo título, misma información, más corto. Como el título es el mismo, **reemplazan** a las actuales.

### R1 · El SOAP de la radicación se firma a mano y su certificado sale de la credencial del REST

**La radicación de consumo firma cada mensaje con el certificado del lender y lo envía con TLS mutuo.** Arma el sobre a mano porque el cliente SOAP nativo de PHP no produce una firma que el servidor del proveedor acepte. Sólo hay dos operaciones: radicar el crédito y subir el paquete firmado. El manual del proveedor llama «guardarDocumento» a la segunda, pero el WSDL real sólo expone la variante OpenKm.

El certificado, la llave y su contraseña salen de la credencial cifrada del lender para esa sucursal, con las mismas claves del REST. El NIT del comercio viaja como convenio y como comercio; sin comercio en la solicitud, ninguno viaja.

- **Cómo la buscarían** (`as_asked`): ¿cómo se autentica la radicación SOAP de Credifamilia y de dónde saca el certificado?
- **Objetivo del área:** Entender cómo se firma y se envía la radicación SOAP a Credifamilia y de dónde salen el certificado y el NIT.
- **Se deduce leyendo:** qué firma y transporte usa el cliente SOAP y qué claves de la credencial lee
- **Archivos:**
  - `legacy-backend`: `app/Actions/Lenders/CredifamiliaConsumo/SoapClient.php`, `app/Actions/Lenders/CredifamiliaConsumo/CredifamiliaConsumo.php`, `app/Console/Commands/SeedCredifamiliaConsumoCredentialCommand.php`, `app/Models/LenderAlliedCredential.php`

### R2 · El código de respuesta decide el estado de la transacción de radicación, y un 409 no es un fallo

**Un 409 del proveedor no es un fallo: la transacción queda duplicada y el proceso sigue.** El código de respuesta decide el estado: 200 la deja registrada, 409 duplicada, 400 inválida, y 500 o cualquier otro, con error. Al subir los documentos, 200 y 409 la completan.

Un Fault SOAP llega con HTTP 500 y se guarda como error con el mensaje del proveedor; un fallo de transporte también queda en error. Hay una transacción por lender y solicitud, y si ya está registrada, duplicada o completada no se vuelve a llamar al proveedor. La formalización sólo cuenta como exitosa con la transacción completada.

- **Cómo la buscarían** (`as_asked`): ¿qué estado queda en la transacción de Credifamilia según lo que contesta el proveedor?
- **Objetivo del área:** Saber qué estado de transacción queda según el código que contesta el proveedor al radicar y al subir documentos, y qué cuenta como éxito.
- **Se deduce leyendo:** el mapa de códigos a estados y qué errores lanzan y cuáles se guardan
- **Archivos:**
  - `legacy-backend`: `app/Actions/Lenders/CredifamiliaConsumo/CredifamiliaConsumo.php`, `app/Services/Pdf/CredifamiliaFormalizationService.php`

### R3 · La fianza de Credifamilia se financia si es anticipada y se cobra por cuota si es vencida

**Con fianza anticipada la fianza entra al capital financiado; con fianza vencida se reparte en cada cuota.** El tipo y el porcentaje llegan de la pre-aprobación del proveedor: el tipo 2 es anticipada y el 1 vencida, y cualquier otro valor lanza una excepción.

En la anticipada, la fianza, su IVA y el 4x1000 se suman al monto solicitado y no hay cuota de fianza. En la vencida el capital es el monto solicitado y el total de la fianza se divide entre el plazo. El IVA es un 19 % fijo. El comprobante sale del mismo cálculo que las cuotas. El plan de pagos dice «vencida» donde el SOAP dice «Mensual».

- **Cómo la buscarían** (`as_asked`): ¿cómo entra la fianza en el capital y en las cuotas de Credifamilia, y cómo se llama en el SOAP?
- **Objetivo del área:** Saber cómo entra la fianza en el capital y en las cuotas según su tipo, de dónde salen su tipo y su porcentaje, y cómo cambia su nombre entre el plan de pagos y la radicación.
- **Se deduce leyendo:** qué tipo de fianza financia y cuál reparte por cuota, y cómo se traduce al enum del SOAP
- **Archivos:**
  - `legacy-backend`: `app/Services/PaymentPlan/Credifamilia/Engine/CalculationContext.php`, `app/Services/PaymentPlan/Credifamilia/CredifamiliaPayloadBuilder.php`, `app/Services/PaymentPlan/Credifamilia/Math/FinancialMath.php`, `app/Actions/Lenders/CredifamiliaConsumo/TransactionRequest.php`

## Qué se dejó fuera, y por qué

- **Los rechazos que sólo se vieron en el QA del proveedor** («Listas restrictivas: Error en la consulta», NIT inexistente, certificado no confiable): son mediciones de un ambiente, no del código. Están en la receta de la tarea.
- **La lista de clientes de prueba y sus resultados:** datos de prueba del ambiente. Están en el artefacto de clientes de prueba.
- **La base del 4x1000 y cómo se compone `montoTotalCredito`:** el cambio vive en `develop` y todavía no está en `main`. Se gradúa al llegar, y entonces hay que corregir R3.
- **Que el comando que siembra las credenciales escribe otras claves que el código no lee:** es una trampa del sistema y está en las trampas como F-242, no en canon.
- **Dos caminos de pre-aprobación para Credifamilia conviviendo:** el monolito conserva su propio camino REST de radicación para el lender 24 junto al del microservicio, y el viejo `legacy-application` tiene otro. El código no dice cuál atiende cada solicitud en producción, así que no se puede afirmar. Si alguien lo confirma con datos de producción, es una sección.
- **Que el comentario «MOCK fallback Bogotá» del código es falso** (la ciudad no encontrada viaja vacía): está dicho en N4 sin nombrar el comentario; corregirlo en el código es de la tarea, no de canon.

## Para dictarlo

1. Releer que nada cambió en `main` (`go run . -ronda` desde el repo de canon).
2. Escribir las 7 piezas en un solo borrador y un solo cierre. Las tres reescrituras reemplazan las secciones actuales.
3. Verificar con `make canon-search Q='…'` que N1 a N4 aparecen, y dejar un bloque en la tarea con la cita.
