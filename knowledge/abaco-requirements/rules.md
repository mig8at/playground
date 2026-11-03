# Requisitos y consulta vigente de Ábaco

Mecanismo revisado en las refs locales de `main`, acotado al requisito, su consulta vigente y el cupo sin buró. No documenta la totalidad del scraping, la aceptación de ingreso ni las políticas del proveedor. Las mediciones de usuarios y la configuración de ambientes permanecen en sus tareas.

## Requisito por entidad

`LenderRequirementRepository::isAbacoEnabled` consulta una fila con `lender_id` y `abaco_is_enabled=true`; ids menores que uno devuelven false. `AbacoRequirementService` usa esa fuente para MOTV1001/MOTV1000 y responde MOTV1002 ante fallos. `AbacoStepResolver` emite `next_step:abaco` sólo con el requisito encendido y sin consulta vigente; en otro caso devuelve null. El producto renting/RTO no enciende el requisito por sí mismo en estas consultas. Omitir el paso por una consulta existente no prueba que el ingreso haya sido aprobado.

`POST abaco/check-requirement` (con el alias `check-abaco-requirement`) es una lectura: junto al código devuelve `completed` y `response`, y `can_skip`. Si la entidad no pide Ábaco responde `skip` con `completed=true` sin leer la base; si la pide, traduce la consulta vigente con `AbacoConsultStateResolver` (`pending` sin consulta, `skip` si fue saltada, `error` si está vacía o sin plataforma exitosa, `success` con al menos una), y si falla esa lectura degrada a `pending`. `can_skip` es true cuando la entidad no pide Ábaco o cuando `AbacoSkipPolicy` lo permite, y también si la política no se puede calcular. En MOTV1002 no viaja estado. `POST abaco/sync-results` usa el mismo envelope sin `can_skip`: si el estado no es terminal y hay `customer_id`, llama a `results()` del proveedor y relee la consulta; los estados pendientes no se graban.

## Dónde se pide el paso

El resolver sólo se invoca desde `CreditopXFlowService::getNextStepData`, que usa `POST requests/confirm`: primero el formulario dinámico, después Ábaco y al final la validación de identidad. `POST requests/identity-validation` llama directo a `getIdentityNextStepData`, sin los resolvers de formulario ni de Ábaco; el controlador lo declara como un salto deliberado para cortar el bucle cuando la consulta todavía no aterrizó, y no verifica que Ábaco se haya completado. En `application` el modelo `LenderRequirement` lleva la columna `abaco_is_enabled`, pero no se encontró un paso ni un salto de Ábaco en ese monolito.

## Vigencia de la consulta

`AbacoConsultRepository` busca por usuario, central 12 y `created_at` estrictamente posterior al umbral. La duración sale de `settings` con `code=setting`, `key=abaco_config`, propiedad `consult_validity_days`; se convierte a entero numérico entre 1 y 365, con default de 7 días ante ausencia, valor inválido o fallo de lectura del setting. No usa `whereDate` ni un mes fijo, aunque varios comentarios todavía digan «vigencia 1 mes» (el resolver, su interfaz, `AbacoConsultStateResolver`, `AbacoSkipService`, `AbacoService` y `CreditopXFlowService`). El gate verifica existencia, no calidad del resultado. `findRecentConsult` toma el id más reciente y devuelve array vacío si no puede leer el payload; un resultado sin detalle se distingue de null, que significa no encontrar consulta vigente.

Escriben la consulta: `AbacoService` al cerrar el scraping sólo en estados terminales (éxito, o error con el ingreso informal en 0), y `AbacoSkipService` en los dos saltos. Como la clave es el usuario y no la solicitud ni la entidad, cualquiera de esas consultas cierra el paso durante la vigencia para toda entidad con Ábaco que pida después.

## Salto del paso

`POST abaco/skip` no escribe nada si la entidad de la solicitud no pide Ábaco (responde éxito igual). Si la pide, distingue dos disparadores por `reason`: sin motivo es el salto voluntario («Continuar sin validar») y `scraping_timeout` es el vencimiento de la espera. Sólo el voluntario pasa por `AbacoSkipPolicy::canSkip`, que mira las filas tipo 2 (etapa extendida) de la entidad: deja saltar si no hay filas o si alguna no niega sin datos; una fila niega sin datos cuando tiene `min_monthly_trips` o `min_platform_seniority_months` mayor que cero y `reject_without_gig_data`. Si la política no se puede calcular, deja saltar; si niega, responde ABSK1004. Pasada la guarda, los dos saltos graban la consulta vigente por `user_id` con `state=skip`, sin plataformas, y el ingreso informal en 0.

Para el motor, una consulta saltada es una consulta sin datos: `AbacoGigProfileReader` la lee como perfil sin plataformas y `GigCriteria` deja pasar o niega según `reject_without_gig_data`. Por eso, si una persona salta en una entidad que lo permite y dentro de la vigencia pide en otra donde todas las filas tipo 2 niegan sin datos, el paso no se le vuelve a ofrecer (hay consulta vigente) y esas filas fallan sin que haya podido validar. Lo mismo vale para el salto por `scraping_timeout`, que no consulta la política de la entidad.

## Proveedor simulado en producción

`AbacoService` elige el cliente del proveedor en cada paso. Con `abaco_config.use_mock` y un `mock_host` válido usa el mock `abaco-mockery-lambda`; en producción ese switch se ignora salvo para los comercios de `PRODUCTION_MOCK_ALLIED_IDS` (hoy el 346, «Alta»), que el comentario del código registra como una excepción deliberada de negocio mientras el proveedor real no opera para ese comercio. Para esos comercios, con el switch encendido, cualquier cédula recibe el escenario por defecto del mock. La consulta que deja es por usuario como cualquier otra, así que cierra el paso y aporta el ingreso de plataformas a toda entidad con Ábaco durante la vigencia, incluidas las de otros comercios. El código no fija el valor del switch: depende del setting de cada ambiente.

## Cupo sin reporte de buró

En el motor `Modules/Loans/LenderUserCategoryService`, sólo si no hay reporte Datacrédito, el flag de Ábaco evita el corte por falta de buró. Las reglas previas de categoría siguen aplicando y el cupo sale de `calculateAvailableAmountWithInitialFee`; el ingreso no queda certificado por este salto. Si la lectura del requisito falla, su helper devuelve false y conserva la exigencia de buró por esa vía. Existe además otra vía de salto por país sin centrales activas. El listado modular ya resuelve las categorías con el motor de Loans: la vieja separación por id 160 no describe ese código. La clase homónima de `application` revisada todavía continúa sin categoría cuando falta Datacrédito; no debe atribuírsele el salto modular. Que los dos monolitos compartan datos no prueba que sus evaluaciones sean iguales.

## Backfill y retirada de modos

El backfill toma las entidades cuyo producto es renting/RTO y hace upsert de `abaco_is_enabled=true`; conserva las otras columnas, pero sí vuelve a encender el flag de las filas elegidas si se ejecuta otra vez. Su `down` no lo apaga. Es una traducción de datos al aplicar la migración, no una herencia automática para entidades futuras. La migración de retirada elimina `user_request_modes` y `allied_modes`; `down` recrea el esquema, sin recuperar filas. La presencia de ambos archivos en `main` no prueba que las migraciones hayan corrido ni que las tablas o flags tengan ese estado en dev, QA o producción.
