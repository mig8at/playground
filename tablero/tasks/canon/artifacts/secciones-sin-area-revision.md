# Revisión del vocabulario de canon (2026-11-05), las dos mitades

Refs: legacy-backend c470cf456 · legacy-application e22f485d · frontend-monorepo d7f6801fc · creditop_mobile 2dbedbe0 ·
pre-approvals-service 8bfbee9 · financial-health-service 7909c80. Enlaces: 0 rotos en 52 (con AnchorOf real).

## Entradas a reescribir (texto propuesto por los verificadores)

- **Salud financiera**: «La pantalla de la app con el puntaje, la capacidad de endeudamiento y los consejos del cliente; sin el beneficio completo muestra una versión reducida. Cómo se arma: [[salud-financiera/context]]; el reporte de buró del que sale: [[kyc/context]]; el canal: [[mobile/context]].»
- **Mis créditos**: «…donde el cliente consulta sus créditos CreditopX (consumo y rotativo); las deudas con otras entidades no salen aquí.» (DebtSummaryController, creditop_x_requests_history)
- **Viable**: agregar «Ojo: "no viable" también es la respuesta del disparador de Experian (RKV24009) y el veredicto de algunas entidades en la preaprobación: [[kyc/context]], [[preaprobado/context]].»
- **Llamadas de cobro**: «La gestión de cobro de un crédito en mora; se apoya en el estado que tiene el sistema, que puede ir atrasado respecto al pago: [[cartera/context]]. No confundir con "cobranza externa", la entidad que gestiona sus propios créditos: [[entidad/context]].» (producto: revisar)
- **LB**: no hay flag «integración LB»; lo que mueve a un comercio son new_frontend_allieds / new_frontend_allied_branches → enlazar [[arquitectura/context#quien-ve-el-recorrido-nuevo-lo-deciden-dos-filas-de-configuracion]].
- **CTX / CreditopX**: «El crédito de la casa: las entidades con tipo de respuesta 2 (consumo) y 3 (rotativo), con política de Creditop. "CTX política estándar" = el paquete de reglas por defecto. [[creditopx/context]]; los tipos: [[entidad/context#el-eje-que-decide-todo-es-el-tipo-de-respuesta]].» (falso: «la familia ES el tipo 2»; arquitectura no tiene el mapa de tipos)
- **CATEGORY_RULE_REJECTED**: «Registro del monolito nuevo, a nivel debug, con los criterios de una regla de categoría que no se cumplieron: [[perfilamiento/context#category-rule-rejected]].»
- **QUOTA_CHECK_REJECTED · REVOLVING_CREDIT_REJECTED**: «Registros de rechazo de cupo del monolito nuevo, del endpoint de cupo y del motor del rotativo; se leen por `reason` y `product_type`: [[perfilamiento/context#quota-check-rejected-revolving-credit-rejected]].»
- **hard_rules**: «La columna `profiling_reviews.hard_rules`: la foto, por entidad, de las reglas evaluadas en el perfilamiento de una solicitud. Cómo leerla y sus límites: [[listado/context#…]].» (completar anclas de listado)
- **Créditos de consumo**: «dos cosas: (1) el producto de libre destino, que ofrecen las entidades CreditopX "X Consumo" y también Bancolombia, Credifamilia y la entidad de Perú; (2) el menú del admin viejo que lista los créditos CreditopX. "No aparece en créditos de consumo pero sí en solicitudes" = dos máquinas de estado: [[datos/context#un-estado-dice-donde-esta-no-que-se-completo]].» (producto)
- **Sonría**: «comercio de salud (allied 26), no entidad. Su particularidad con Welli: [[welli/context#que-es-y-por-que-son-varias-entidades]] y [[welli/context#el-veredicto-entra-por-el-monolito-viejo-y-sonria-se-omite]].»
- **Prami**: «entidad (12) que decide afuera y avisa por webhook. "Aprobado y quedó en seleccionar entidad" o "el monto no es el pactado": [[fronteras/context#el-aviso-de-prami-no-se-pierde-llega-con-un-identificador-que-no-existe]]. Fuera del preaprobado por lista en código: [[preaprobado/context#y-dentro-del-sistema-nuevo-hay-dos-puntos-con-listas-distintas]].»
- **SmartPay** (FALSO: es entidad, no comercio): «entidad CreditopX (160 en prod, tipo de respuesta 2) de celulares a crédito en mostrador, en República Dominicana. Entra por el formulario dinámico ([[onboarding/context]]) y el equipo queda bloqueable (Trustonic): [[imei/context]]. Su id está fijado en el código y no coincide entre ambientes (fuera de prod, 152 o 153 según el archivo).»
- **Nequi**: «medio de pago que aparece entre las entidades (192, tipo 0): cobra la compra, no origina crédito. Sólo existe en legacy-backend. [[nequi/context#aparece-entre-las-entidades-pero-al-elegirla-no-se-origina-un-credito-se-cobra-la-compra]].»
- **Solicitud, por dentro** (FALSO «treinta estados de este glosario»: son 32 en prod): «Estado de la solicitud — en `user_requests` es `user_request_status_id` (no `status`), contra el catálogo `user_request_statuses`, que cambia según el ambiente: [[datos/context#el-catalogo-de-estados-de-la-solicitud-depende-del-ambiente]].» + agregar la columna en datos.

Sin cambios: Preaprobado, Política, Punto de venta, Colilla, Refactor/aliados, Entidad, Registro, last_validation, Activar, Welli, Motai, Codeudor, Todos aparecen como empleados, El error del banco (no verificado), Aval/FGA, Cuota inicial, Cascada.
Producto (fecha de revisión): Preaprobado, Política, Refactor/aliados, LB, CTX (capital del comercio), Llamadas de cobro, Créditos de consumo, Motai, Sonría.

## Errores encontrados en OTROS temas
- perfilamiento#quota-check-rejected…: el rotativo tiene TRES etapas (hard_policy desde e8c9f9630, RevolvingCreditsService.php:449), no dos.
- cartera#la-colilla-puede-condonar…: se dispara con next_billing_date <= hoy (el corte), no al vencer la fecha de pago (UpdateCreditopXRemoveOutstandingBalances.php:48-49).
- preaprobado#y-dentro-del-sistema-nuevo-hay-dos-puntos-con-listas-distintas: el título dice «listas distintas» y el cuerpo «las mismas»; las listas sí difieren entre monolitos ([12,23,141,142,166] vs [12,141,142,166]).
- datos: ninguna sección nombra user_request_status_id.

# Las 14 secciones sin área (fuera del vocabulario)

| tema | sección | salida | archivos |
|---|---|---|---|
| backoffice | Guardar la política… clones | ANCLAR + corregir («sólo una de tres políticas» es falso: desde fd742d2b3 lee/escribe la extendida en la misma categoría) | legacy-backend: Modules/Backoffice/App/Services/LenderRulesWriterService.php, Modules/Backoffice/App/Services/LenderRulesService.php, Modules/Onboarding/App/Services/lenders/LenderValidationService.php, Modules/Partner/App/Http/Controllers/LenderRulesController.php · legacy-application: app/Http/Controllers/Admin/LenderRulesController.php |
| backoffice | Listo para operar… | ANCLAR + 3 correcciones (quitar «y el admin viejo»; payments depende del método de pago; en rotativo la política sí bloquea y profiles→conditions) | legacy-backend: Modules/Backoffice/App/Services/LenderReadinessService.php, Modules/Backoffice/routes/backoffice.php |
| fronteras | Puerta abierta | ANCLAR (sigue en main) + matices (el BFF no manda X-Internal-Key; financing-amounts sin llamador; la vecina no tiene secreto). ⚠ es una vulnerabilidad abierta | legacy-backend: Modules/Onboarding/App/Http/Middleware/InternalBffKeyMiddleware.php, Modules/Onboarding/routes/webhooks.php, Modules/Onboarding/config/config.php · frontend-monorepo: apps/loan-request-wizard/app/routes/entidad/resultado.tsx |
| observabilidad | Volumen de registros | SACAR (método, y ya no vale: entitlement e identity silencian latidos) | — |
| perfilamiento | Cuentas embargadas | ANCLAR + «sólo lo evalúa el monolito nuevo» | legacy-backend: Modules/Loans/App/Services/LenderUserCategoryService.php, database/migrations/2026_09_08_130000_add_seized_accounts_to_lender_users_category_rules.php · legacy-application: app/Services/lenders/LenderUserCategoryService.php |
| perfilamiento | CATEGORY_RULE_REJECTED | ANCLAR + «una fila por cada evaluación del par; manda la más reciente» | legacy-backend: Modules/Loans/App/Services/LenderUserCategoryService.php, Modules/Loans/App/Repositories/UsersCategoryLogRepository.php, config/logging.php · legacy-application: app/Services/lenders/LenderUserCategoryService.php |
| perfilamiento | QUOTA_CHECK / REVOLVING | ANCLAR + tres motivos (hard_policy) | legacy-backend: Modules/Loans/App/Http/Controllers/Customer/CreditopXQuotaController.php, Modules/Loans/App/Services/RevolvingCreditsService.php |
| mobile | Arquitectura… | SACAR (repite AGENTS.md, 2 errores) | — |
| mobile | Qué backend usa… | ANCLAR recortando 1.er párrafo; identidad no va por /customers | Creditop-SAS/creditop_mobile: app/lib/config/environment_config.dart, app/lib/infrastructure/home/datasources/preapprovals_datasource.dart, app/lib/ui/identity_gate/identity_sign_out.dart, app/lib/config/dependency_injection.dart (ref main-pro) |
| internacionalizacion | Tipo de documento del PAÍS | ANCLAR tal cual | legacy-backend: app/Services/DocumentTypesService.php, Modules/Onboarding/App/Services/RegisterCellPhoneService.php |
| cuota | Factor por plazo | ANCLAR tal cual (los dos monolitos) | legacy-backend: Modules/Loans/App/Services/PaymentSchedule/PaymentCalculationService.php, Modules/Onboarding/App/Services/lenders/LenderRetrievalService.php · legacy-application: app/Http/Controllers/Customer/PromissoryNoteController.php |
| documentos | El producto determina el armador | ANCLAR + orden real plantilla→slug→producto→genérico; sólo legacy-backend | legacy-backend: Modules/Loans/App/Services/DocumentGeneration/CatalogDocumentPayloadResolver.php, …/Payload/CrediAsycoPayloadBuilder.php, …/Payload/AltaPayloadBuilder.php |
| bcp | Identificador quemado | ANCLAR con título nuevo (corregido en d4e951746): «Los identificadores de consumo y vehicular salen de la configuración del ambiente; el literal es sólo el de desarrollo.» | legacy-backend: config/services.php, app/Actions/Lenders/Bcp/Bcp.php, app/Actions/Lenders/Bcp/BcpVehicular.php, app/Http/Controllers/Api/AlternateFlowRejectionController.php, Modules/Onboarding/App/Services/lenders/Bcp/BcpService.php |
| negocio | El que decide es el comercio | PRODUCTO (responsable producto/dirección comercial); actores enlaza acá | — |
