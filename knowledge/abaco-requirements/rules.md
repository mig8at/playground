# Requisitos y consulta vigente de Ábaco

Mecanismo revisado en las refs locales de `main`, acotado al requisito, su consulta vigente y el cupo sin buró. No documenta la totalidad del scraping, la aceptación de ingreso ni las políticas del proveedor. Las mediciones de usuarios y la configuración de ambientes permanecen en sus tareas.

## Requisito por entidad

`LenderRequirementRepository::isAbacoEnabled` consulta una fila con `lender_id` y `abaco_is_enabled=true`; ids menores que uno devuelven false. `AbacoRequirementService` usa esa fuente para MOTV1001/MOTV1000 y responde MOTV1002 ante fallos. `AbacoStepResolver` emite `next_step:abaco` sólo con el requisito encendido y sin consulta vigente; en otro caso devuelve null. El producto renting/RTO no enciende el requisito por sí mismo en estas consultas. Omitir el paso por una consulta existente no prueba que el ingreso haya sido aprobado.

## Vigencia de la consulta

`AbacoConsultRepository` busca por usuario, central 12 y `created_at` estrictamente posterior al umbral. La duración sale de `settings` con `code=setting`, `key=abaco_config`, propiedad `consult_validity_days`; se convierte a entero numérico entre 1 y 365, con default de 7 días ante ausencia, valor inválido o fallo de lectura del setting. No usa `whereDate` ni un mes fijo, aunque el comentario antiguo del resolver todavía mencione un mes. El gate verifica existencia, no calidad del resultado. `findRecentConsult` toma el id más reciente y devuelve array vacío si no puede leer el payload; un resultado sin detalle se distingue de null, que significa no encontrar consulta vigente.

## Cupo sin reporte de buró

En el motor `Modules/Loans/LenderUserCategoryService`, sólo si no hay reporte Datacrédito, el flag de Ábaco evita el corte por falta de buró. Las reglas previas de categoría siguen aplicando y el cupo sale de `calculateAvailableAmountWithInitialFee`; el ingreso no queda certificado por este salto. Si la lectura del requisito falla, su helper devuelve false y conserva la exigencia de buró por esa vía. Existe además otra vía de salto por país sin centrales activas. El listado modular ya resuelve las categorías con el motor de Loans: la vieja separación por id 160 no describe ese código. La clase homónima de `application` revisada todavía continúa sin categoría cuando falta Datacrédito; no debe atribuírsele el salto modular. Que los dos monolitos compartan datos no prueba que sus evaluaciones sean iguales.

## Backfill y retirada de modos

El backfill toma las entidades cuyo producto es renting/RTO y hace upsert de `abaco_is_enabled=true`; conserva las otras columnas, pero sí vuelve a encender el flag de las filas elegidas si se ejecuta otra vez. Su `down` no lo apaga. Es una traducción de datos al aplicar la migración, no una herencia automática para entidades futuras. La migración de retirada elimina `user_request_modes` y `allied_modes`; `down` recrea el esquema, sin recuperar filas. La presencia de ambos archivos en `main` no prueba que las migraciones hayan corrido ni que las tablas o flags tengan ese estado en dev, QA o producción.
