# ¿Canon le arma el contexto a una tarea real? (28 tareas de CORE)

Por cada tarea se escribieron las preguntas que alguien se hace para arrancarla y se buscaron en canon como lo haría un agente desde el CLI (búsqueda corta + leer la sección). 110 preguntas.

| veredicto | preguntas |
|---|---|
| parcial | 47 |
| si | 40 |
| no | 23 |

## Por tarea

- **CORE-845** Finandina: originación completa en Creditop — si=3 parcial=2 no=0  
  Da la política repartida, credenciales de buró por entidad y pagaré/Deceval; falta Finandina misma y una guía de alta de entidad nueva con entrega de la operación para desembolso.
- **CORE-819** Ecommerce: una compra nueva no debe reabrir la solicitud de un pedido anterior — si=1 parcial=2 no=1  
  Explica cómo nace la solicitud y cómo se ancla el pedido; falta la reutilización en el camino de tienda y cómo probar con la tienda de prueba.
- **CORE-826** Automatizar el comercio Crédito Directo (id 279) — si=0 parcial=2 no=2  
  Casi nada: mecanismo de categorías y pagaré; Crédito Directo X/LB, la suite qa-ui y el cierre CreditopX en qa no están.
- **CORE-800** Integración VTEX: enlace de pago con referencia y pedidos atribuidos a la sucursal — si=0 parcial=4 no=0  
  Da las puertas de entrada VTEX y el aviso a la tienda; falta el contrato del conector, la credencial de tienda y la confirmación del cobro.
- **CORE-820** Automatizar el comercio Tripleten (id 191) — si=0 parcial=0 no=4  
  No sirve: Addi, Tripleten, cierre rt=0 y la suite e2e están fuera de canon.
- **CORE-807** qa-ui: ramguiflex cliente 3109000008 marca rojo en Opciones de Financiamiento por Vanti 'Probabilidad alta' (monto sobre el máximo) — si=2 parcial=1 no=1  
  Explica que la probabilidad clasifica y el descarte del listado; falta la regla de monto sobre el máximo en la tarjeta y Vanti.
- **CORE-758** Ajuste 4x1000 — si=3 parcial=1 no=0  
  Muy bien: fianza, IVA, 4x1000 y radicación de Credifamilia; sólo falta el simulado de pre-aprobación en dev/qa.
- **CORE-795** Corregir la automatización · motai default: el cliente confirma el plazo — si=2 parcial=1 no=1  
  Contesta la pregunta clave (plazo por categoría y tramo con el monto guardado); falta Motai X y la suite qa-ui.
- **CORE-379** Generación manual de voucher desde el panel, con permiso y auditoría — si=2 parcial=3 no=0  
  Bien: condiciones del voucher, regeneración sin sesión, dos paneles y permisos; falta crear un permiso spatie y el nombre en S3.
- **CORE-607** Cambio de Imeis ya entregados — si=2 parcial=0 no=1  
  Explica dónde vive el IMEI y los bloqueos; no hay proceso de cambio de IMEI post-desembolso.
- **CORE-746** Implementar POST /api/ecommerce/payment-link para generar la URL de checkout — si=1 parcial=1 no=2  
  Da el checkout base64 y la puerta de enlace por API; falta Sanctum/abilities, order_key y la emisión de tokens.
- **CORE-564** Error en el valor aprobado- Prami y asyco — si=3 parcial=0 no=1  
  Muy bien: el aviso de Prami escribe monto y cuotas tal cual y el voucher imprime eso; falta ASYCO.
- **CORE-699** Refresco de Experian cuando falla — si=4 parcial=0 no=0  
  Muy bien: vigencia de 30 días por fecha, el fallido que bloquea, el disparador y salud financiera; sólo falta el efecto en mobile.
- **CORE-376** Unificar la generación de voucher, los logs y las respuestas de los webhooks de lenders — si=0 parcial=4 no=0  
  Piezas de Welli, Prami y voucher; falta el inventario de webhooks, updateDisbursedLender y la idempotencia de CORE-187.
- **CORE-818** PDF mapper en backoffice — si=0 parcial=4 no=0  
  Da el modelo del servicio de PDF, la clave de borrado y que existe access-service/cerbos; le falta el editor actual, el aislamiento por ambiente y cómo se agrega una sección con permisos al backoffice.
- **CORE-844** Originación sin asesor: recuperar la atribución de corporate_user_id — si=1 parcial=1 no=2  
  Da los tres canales (tienda/mostrador/autogestión) y dónde nace la solicitud; no tiene corporate_user_id, ResolveCognitoUser ni la atribución/comisión del asesor: hay que ir al código.
- **CORE-801** Integración Shopify: app de pagos con enlace de pago y pedidos atribuidos a la sucursal — si=2 parcial=1 no=1  
  Muy buena base del canal ecommerce (puertas, enlace por referencia, aviso a la tienda); faltan Shopify, el vínculo tienda↔sucursal y cómo probar en qa.
- **CORE-757** Ajuste de nombres en el onboarding v1 y v2 — si=2 parcial=2 no=0  
  Da la consolidación de identidad, la pausa por discrepancia, la llave del primer apellido y la frecuencia de Experian; falta la regla de fusión de nombres (Ñ/tildes/completar) y su ubicación.
- **CORE-688** Credifamilia materiales inicio — si=1 parcial=3 no=0  
  Da la radicación de nueve documentos y el motor por entidad/tipo; falta cómo se separa la vertical Materiales y cómo se reemplaza una plantilla en pdf-mapper.
- **CORE-764** Despliegue loan-servicing → development — si=1 parcial=2 no=1  
  Explica loan-servicing, la cadena nocturna y su rol en prod; falta la receta de despliegue de un servicio nuevo, el único worker por cola y config-ci/Sonar.
- **CORE-752** Refurbi auto onboarding v2 — si=3 parcial=1 no=0  
  Casi completa: el pedido por API con referencia de un uso y vencimiento, y migraciones/despliegue; sólo falta el contrato de la API de Refurbi.
- **CORE-774** Corregir la automatización · mediarte nuevo: debe ver la pantalla de opciones disponibles — si=1 parcial=2 no=1  
  Da la pausa del KYC y el OTP en modo QA; falta cómo dictarle la cédula al mock de centrales y todo sobre la suite qa-ui.
- **CORE-550** Trazabilidad en Grafana de las llamadas al perfilador ML — si=1 parcial=2 no=1  
  Da Loki y la probabilidad del listado, pero su única sección del modelo dice que no está en el camino del cliente, lo que choca con la tarea; falta el cliente del perfilador, makePrediction y el fallback.
- **CORE-378** original_amount se crea en 0 y deja el pre-aprobado sin monto (Welli/Meddipay/Prami muestran &quot;No pudimos consultar esta entidad&quot;) — si=0 parcial=3 no=1  
  Da dónde nace la solicitud y la compuerta de preaprobación; falta original_amount, qué entidades exigen monto y el loader del marketplace (loan-options).
- **CORE-640** Nuevo informe de dentix de financiación — si=2 parcial=1 no=0  
  Da disbursed_at/final_amount, el perfilamiento guardado por entidad y el reporte de originados; falta un mapa de informes existentes.
- **CORE-592** Api creación solicitudes por debajo — si=1 parcial=2 no=0  
  Da cómo nace y se reutiliza una solicitud y sus estados; no hay nada sobre crear solicitudes gestionadas por fuera.
- **CORE-480** DENTIX - Solicitud de campos adicionales en el informe de credifamilia  — si=1 parcial=1 no=1  
  Da dónde vive la tasa de Credifamilia; no tiene el informe de solicitudes ni a Dentix como comercio.
- **CORE-361** feat: autorización por perfil en el backoffice con permify — si=1 parcial=1 no=2  
  Da los dos paneles y su autenticación, y que la autorización la sirve access-service+cerbos (no Permify); falta el mapa de pantallas Refine y los perfiles de usuario.

## Preguntas sin respuesta o parciales

- CORE-845 · [parcial] ¿Cómo se da de alta una entidad nueva (lender) para que aparezca en el listado de un comercio?  
  hueco: No hay guía de alta de una entidad NUEVA de punta a punta (lenders, convenio comercio-entidad, tipo de respuesta, credenciales, documentos); Finandina no aparece en canon (búsqueda 'finandina' devuelve Credifamilia/CreditopX)
- CORE-845 · [parcial] ¿Cómo se entrega la operación aprobada a la entidad para que desembolse (estado 11, voucher)?  
  hueco: No hay patrón genérico de 'entregar la operación aprobada a la entidad para que desembolse' (rt híbrido); sólo el caso Credifamilia (radicación SOAP) sirve de análogo
- CORE-819 · [parcial] ¿Dónde se decide si una compra de ecommerce reutiliza una solicitud existente?  
  hueco: Describe la reutilización por cliente+comercio+sucursal 'sin vínculo con ecommerce', pero no el camino de tienda que reutiliza una solicitud de otro pedido ni el chequeo de estado final (legacy-backend: creación/recuperación de solicitud al validar OTP en el checkout ecommerce)
- CORE-819 · [parcial] ¿Qué estados son finales y no deberían reabrirse?  
  hueco: No hay un catálogo de qué estados son finales/no reabribles; se deduce del aviso a la tienda y de datos/context (estados por máquina)
- CORE-819 · [no] ¿Cómo pruebo una compra en la tienda de prueba de VTEX/Shopify en qa?  
  hueco: Cómo probar en qa con la tienda de prueba VTEX/Shopify y el simulador de resultado (shopify: 'nada'; vtex qa: sólo modo QA de mensajes)
- CORE-826 · [no] ¿Qué es Crédito Directo X LB y cómo se diferencia de Crédito Directo X?  
  hueco: Crédito Directo X / X LB (entidades CreditopX del comercio 279) no existen en canon; vive en datos (lenders) no en código
- CORE-826 · [no] ¿Cómo se agrega un comercio a la suite e2e (merchants.json) con sus perfiles?  
  hueco: La suite e2e qa-ui (merchants.json, perfiles, escenarios) no está en canon: es repo de QA fuera del corpus
- CORE-826 · [parcial] ¿Qué perfiles de cliente cambian la categoría (recuperar, premium, nuevo) en CreditopX?  
  hueco: El mecanismo de categorías sí; qué perfiles concretos (recuperar, premium, nuevo) tiene cada entidad no (es dato de categorías por lender en la BD)
- CORE-826 · [parcial] ¿Cómo se llega al desembolso de un CreditopX en QA (pagaré, firma, estado 11)?  
  hueco: Piezas sueltas de firma/pagaré; falta el recorrido de cierre CreditopX por asesor hasta estado 11 en qa
- CORE-800 · [parcial] ¿Cómo funciona hoy el conector VTEX y qué endpoints usa en legacy-backend?  
  hueco: Nombra las dos entradas VTEX (monolito viejo y nuevo) pero no el contrato del conector ni el inicio de pago por referencia (legacy-backend módulo ecommerce/VTEX)
- CORE-800 · [parcial] ¿Cómo se autentica un comercio ecommerce (credencial, hash de sucursal)?  
  hueco: Dice que el enlace de pago lleva la credencial de tienda de la sucursal, pero no cómo se emite/valida la credencial de tienda ni su marca de plataforma
- CORE-800 · [parcial] ¿Cómo se atribuye una solicitud a una sucursal y a una plataforma?  
  hueco: Origen de la solicitud y plataforma fija VTEX mencionados; falta cómo se registra sucursal+plataforma en el pedido (columnas de referencia en ecommerce orders)
- CORE-800 · [parcial] ¿Cómo se notifica a la tienda el estado final (webhook) y cómo se valida el cobro?  
  hueco: Aviso a la tienda bien cubierto; falta la confirmación del cobro (settlement) VTEX contra el estado autorizado
- CORE-820 · [no] ¿Cómo funciona Addi en el flujo (rt=0, redirect) y hasta dónde llega una prueba?  
  hueco: Addi (rt=0, redirect, estados marcados a mano por el comercio) no tiene sección: 'addi' sólo devuelve Bancolombia
- CORE-820 · [no] ¿Qué tipo de crédito usa Tripleten y por qué canal entran sus solicitudes?  
  hueco: Tripleten (comercio 191) no aparece; datos de comercio, no código
- CORE-820 · [no] ¿Cómo se agrega un comercio a merchants.json y su escenario e2e?  
  hueco: La suite e2e qa-ui y su merchants.json no están en canon
- CORE-820 · [no] ¿Cómo se cierra un rt=0 en pruebas si no devuelve estados?  
  hueco: Cierre de entidades rt=0 (sin webhook, estado manual) no cubierto; sólo webhooks de Welli/Meddipay (rt=1)
- CORE-807 · [parcial] ¿Cuándo una entidad sale con aviso de monto sobre el máximo y botón desactivado?  
  hueco: Sabe que el rango de monto vive en la fila comercio-entidad, pero no la tarjeta 'monto supera el máximo, ingresa máximo hasta X' con botón apagado (frontend-monorepo LenderMarketplace / tarjeta del listado)
- CORE-807 · [no] ¿Cómo es Vanti como entidad (tipo, montos máximos)?  
  hueco: Vanti/Brilla no existen en canon (tipo de respuesta, montos máximos)
- CORE-758 · [parcial] ¿Qué se radica a Credifamilia y cómo se prueba sin su ambiente?  
  hueco: Radicación bien cubierta; falta que en dev/qa/staging la pre-aprobación de Credifamilia la responde un simulado ('credifamilia mock' no lo encuentra)
- CORE-795 · [parcial] ¿Cómo se calcula la cuota de Motai X por categoría (recuperar mejores)?  
  hueco: Mecanismo de categoría sí; los tramos y tasa de Motai X (dato de configuración) no
- CORE-795 · [no] ¿Dónde vive la suite qa-ui y su calculadora (calc_credito.py)?  
  hueco: qa-ui y calc_credito.py fuera del corpus
- CORE-379 · [parcial] ¿Cómo se manejan permisos en el panel (spatie, model_has_permissions)?  
  hueco: Dónde se chequea el permiso sí; cómo crear y sembrar un permiso nuevo con spatie (model_has_permissions) no ('model_has_permissions' sin resultados)
- CORE-379 · [parcial] ¿Dónde se guarda el voucher en S3 y cómo se nombra?  
  hueco: Dice ruta fija por cliente y solicitud y lectura pública; no el bucket ni el formato del nombre con request_number, ni que el panel arma la URL a mano
- CORE-379 · [parcial] ¿Cómo se registra auditoría/log por solicitud?  
  hueco: Inventario de tablas sí; falta la convención de log por user_request_id (índices de logs, 8.1M filas) para auditoría
- CORE-607 · [no] ¿Hay un proceso o endpoint para cambiar el IMEI de un crédito ya entregado?  
  hueco: No hay proceso para cambiar el IMEI de un crédito ya desembolsado ni qué hacer con el bloqueo del equipo viejo (imei: legacy-backend módulo IMEI/bloqueos)
- CORE-746 · [parcial] ¿Qué rutas ecommerce existen hoy y cómo se autentican (Sanctum, abilities)?  
  hueco: Menciona el enlace de pago por API con token de sucursal; no Sanctum ni abilities ni el inventario de rutas ecommerce
- CORE-746 · [no] ¿Qué es order_key y cómo se detecta una transacción repetida?  
  hueco: order_key y detección de transacción repetida (409) no cubiertos
- CORE-746 · [no] ¿Cómo se emite un token de comercio para el plugin (WooCommerce)?  
  hueco: Emisión de token de tienda para el complemento (WooCommerce) no cubierta; 'credencial' devuelve credenciales de entidades
- CORE-564 · [no] ¿Qué es ASYCO y cómo están configurados sus lenders?  
  hueco: ASYCO no aparece (dato de comercio)
- CORE-376 · [parcial] ¿Qué webhooks de lenders existen y dónde viven los controladores?  
  hueco: No hay inventario de webhooks de entidades (Prami, Meddipay, Sistecrédito, Payvalida, Approbe, Bancolombia, SelfManager) en legacy-application
- CORE-376 · [parcial] ¿Qué hace generateVoucher y updateDisbursedLender?  
  hueco: generateVoucher y updateDisbursedLender por nombre no dan nada; falta el bloque repetido voucher+desembolso de los webhooks y su manejo de error
- CORE-376 · [parcial] ¿Qué cambió en WelliController en CORE-187 (idempotencia del voucher)?  
  hueco: Dice que Welli genera comprobante y marca desembolsada; no la guarda de idempotencia (sólo en la transición a 11) de CORE-187
- CORE-376 · [parcial] ¿Cómo se responden los webhooks a los lenders y qué esperan?  
  hueco: Sólo Prami (404/422) y Welli (token); no hay contrato común de respuesta de webhooks
- CORE-818 · [parcial] ¿Qué es hoy pdf-mapper (studio + service) y dónde vive su código?  
  hueco: Canon describe el servicio (plantilla+mapa+valores) y lo nombra en repos/operar#que-microservicios-hay, pero no menciona el editor/studio (pdf-mapper-studio) ni que publica a dev y prod a la vez ni guarda en el navegador
- CORE-818 · [parcial] ¿Cómo se agrega una sección nueva al backoffice nuevo y cómo se le ponen permisos ver/editar/borrar?  
  hueco: Sabe que hay access-service + cerbos con políticas en S3, pero no cómo se declara un recurso/permiso nuevo ni cómo se cablea una pantalla del backoffice (frontend-monorepo apps/backoffice, políticas de cerbos)
- CORE-818 · [parcial] ¿Cómo se separan los mappers por ambiente y por dónde entra el gateway hacia el servicio?  
  hueco: Cubre la clave de borrado X-Delete-Key; no cubre cómo se aísla un ambiente del otro en pdf-mapper-service ni las rutas del API Gateway hacia él (infrastructure / pdf-mapper-service)
- CORE-818 · [parcial] ¿De dónde salen los ids de campo del catálogo y sus valores al generar el PDF?  
  hueco: Explica la cascada de motor por catálogo/entidad/tipo y el id de proyecto; falta el catálogo de campos (ids) que arma el payload builder (F-188, legacy-backend payload builder de documentos)
- CORE-844 · [parcial] ¿Dónde se escribe user_requests.corporate_user_id al crear la solicitud, en los dos monolitos?  
  hueco: Canon dice que la solicitud nace al validar el código y que la lista del asesor muestra sólo las que él creó, pero no nombra dónde se fija corporate_user_id ni en qué caminos queda nulo (UserRequestService / OTP en legacy-backend y legacy-application)
- CORE-844 · [no] ¿Qué hace ResolveCognitoUser y por qué descarta al asesor?  
  hueco: No hay nada sobre la resolución del usuario Cognito del asesor en el wizard (middleware ResolveCognitoUser en legacy-backend); lo que sale es el pool del backoffice
- CORE-844 · [no] ¿De qué depende la comisión y el seguimiento comercial del asesor, y qué comercios no tienen asesores?  
  hueco: Canon no explica cómo se calcula la comisión/atribución por asesor ni qué es user_profile_id=4; habla de crear y deshabilitar asesores (users.user_profile_id, reportes comerciales)
- CORE-801 · [parcial] ¿Cómo se asocia una tienda Shopify a una sucursal y qué plataformas existen?  
  hueco: Shopify no aparece en canon; está el aviso por plataforma (VTEX/Woo) pero no la credencial de tienda ↔ sucursal ni el modelo de plataforma (ecommerce_platforms / credenciales de tienda en legacy-backend)
- CORE-801 · [no] ¿Cómo pruebo el canal en qa con una tienda de desarrollo?  
  hueco: No hay guía de prueba del canal ecommerce en qa (tienda dev, sucursal ecommerce configurada); los drivers fake son de proveedores
- CORE-757 · [parcial] ¿Dónde se decide qué nombre queda: lo que escribe el asesor o lo que devuelve la central?  
  hueco: Dice que un usuario se consolida cuando una central confirma el nombre; no dice cómo se combinan los nombres (Ñ, tildes, completar segundo apellido) ni en qué servicio (KYC del onboarding v1 en legacy-backend / customer-profiling)
- CORE-757 · [parcial] ¿Qué no se puede tocar al corregir nombres en la base (desembolsados, documentos radicados, llave del buró)?  
  hueco: Advierte que el primer apellido es llave del reporte y que el nombre del depósito no se arregla; falta la política de corrección masiva en base (qué clientes excluir, impacto en documentos ya radicados)
- CORE-688 · [parcial] ¿Cómo se configuran los documentos de legalización por entidad (y por vertical/producto)?  
  hueco: Explica el motor por catálogo/entidad/tipo; no explica cómo se distinguen documentos por vertical (Materiales) de la misma entidad ni dónde se configura (catálogo de firma por producto)
- CORE-688 · [parcial] ¿Cómo reemplazo la plantilla de un documento por una versión nueva sin romper los demás?  
  hueco: Explica las tres piezas (plantilla, mapa, valores) pero no el procedimiento para subir una plantilla nueva a un proyecto de pdf-mapper ni dónde se guarda el proyecto de Credifamilia
- CORE-688 · [parcial] ¿Cómo pruebo la legalización de Credifamilia de punta a punta?  
  hueco: Hay regeneración de documentos desde el panel y el paso de pre-aprobación en rondas; falta cómo probar la legalización en qa/local (mock del SOAP de Credifamilia)
- CORE-764 · [parcial] ¿Cómo se despliega un servicio Go a development (ECR, ECS, workflows por rama)?  
  hueco: Cubre workflows por rama/tag y el rollback de ECS; falta la receta de un servicio nuevo (repo de infrastructure, task definition, config-ci compartido)
- CORE-764 · [parcial] ¿Por qué no pueden correr dos workers de Temporal sobre la misma cola y qué permisos necesita el task role?  
  hueco: Tiene la familia de tareas que puede lanzar y la trampa de nightly.ecs.task_family; no explica la restricción de un solo worker por cola ni el minimumHealthyPercent=0
- CORE-764 · [no] ¿Por qué fallan coverage y Sonar en los PRs de servicios Go?  
  hueco: Nada sobre config-ci / go-pr.yaml / SonarCloud (repo config-ci de Creditop-SAS)
- CORE-752 · [parcial] ¿Qué hace la API que crea el pedido (Refurbi) y qué credencial usa?  
  hueco: Menciona el enlace de pago pedido por API con token de sucursal; Refurbi no aparece y falta el contrato de la API (endpoint en legacy-backend, CORE-746)
- CORE-774 · [parcial] ¿Qué hace el KYC cuando la central no reconoce la cédula con ese nombre?  
  hueco: Explica la pausa por discrepancia y los intentos; no describe el aviso que ve el asesor ni que vuelve a «Información de Identificación» (pantalla del wizard)
- CORE-774 · [parcial] ¿Cómo hago que el mock de centrales acepte una cédula/nombre en qa?  
  hueco: Dice cómo saber si se consulta un simulador o al proveedor real; no explica cómo dictarle la respuesta por cédula al lambda de mocks (risk-services-mockery-lambda, F-139)
- CORE-774 · [no] ¿Dónde vive la suite e2e qa-ui y cómo se corre?  
  hueco: qa-ui no aparece en canon (repo de automatización de QA); lo que sale es la suite PHPUnit
- CORE-550 · [parcial] ¿Dónde se llama al perfilador ML y qué hace makePrediction cuando falla?  
  hueco: Canon sólo tiene un modelo predictivo con URL quemada que «no está en el camino del cliente», lo que choca con la tarea (1.507 perfilamientos sin predicción en prod): falta el cliente del perfilador del listado y su catch (servicio de orden ML en los dos monolitos); sin verificar cuál de los dos es
- CORE-550 · [parcial] ¿Cómo ordena el listado con ML y qué pasa si no hay predicción (fallback a matrices)?  
  hueco: Hay secciones sobre probabilidad y orden sin producción, pero no el orden por ML (H2O) con fallback a matrices (servicio de orden de lenders en legacy-backend/legacy-application)
- CORE-550 · [no] ¿Qué ve el cliente en el listado si el perfilador no responde?  
  hueco: No hay nada sobre el efecto de la caída del perfilador en el orden/listado
- CORE-378 · [parcial] ¿De dónde sale original_amount y en qué momento se escribe?  
  hueco: Canon dice que la solicitud nace al validar el código pero no nombra original_amount vs amount ni la cadena de ?? del UserRequestService (Modules/Onboarding/App/Services/UserRequestService.php)
- CORE-378 · [parcial] ¿Qué entidades exigen monto en la consulta de pre-aprobado?  
  hueco: Cada entidad tiene su sección (Meddipay, Welli) pero no hay una que diga cuáles rechazan sin monto positivo (pre-approvals-service)
- CORE-378 · [no] ¿Cómo resuelve el loader del marketplace el monto que manda a pre-aprobados?  
  hueco: Nada sobre loan-options.repository.ts ni LenderListingService (session('amount')) en frontend-monorepo / legacy-backend
- CORE-378 · [parcial] ¿Cuándo sale el banner «No pudimos consultar esta entidad»?  
  hueco: Explica la compuerta y que ausente ≠ rechazado; no el estado de error de la tarjeta en el front
- CORE-640 · [parcial] ¿Qué informes para comercios existen hoy y cómo se generan/entregan?  
  hueco: Está el reporte de originados (roles, enlace público) pero no un mapa de qué informes existen ni dónde se construyen, ni nada de Dentix
- CORE-592 · [parcial] ¿Hay alguna API para crear solicitudes desde fuera del wizard?  
  hueco: Hay creación desde pedido (Corbeta, API de pedidos) y la merchant-api, pero nada sobre crear solicitudes gestionadas por fuera ni el workaround de usuarios fake
- CORE-592 · [parcial] ¿En qué estado y con qué datos debería quedar una solicitud gestionada por fuera?  
  hueco: Explica estados y que el estado no dice qué se completó; falta qué mínimo exige una solicitud para no romper reportes/cartera
- CORE-480 · [no] ¿Dónde se genera el informe de solicitudes de Credifamilia que recibe Dentix?  
  hueco: Canon no tiene el informe de solicitudes por entidad/comercio (exportación del admin o Redash)
- CORE-480 · [parcial] ¿Qué es Dentix como comercio y con qué entidades opera?  
  hueco: Sólo su otorgamiento especial; no qué entidades ni reportes tiene
- CORE-361 · [parcial] ¿Con qué se modela la autorización (Permify o Cerbos) y dónde viven las políticas?  
  hueco: Canon dice access-service + cerbos con políticas en S3; la tarea dice Permify: falta el modelo de autorización vigente y cómo lo consume el front (frontend-monorepo apps/backoffice, access-service)
- CORE-361 · [no] ¿Qué pantallas/recursos tiene el backoffice (Refine) y cuáles hay que proteger?  
  hueco: Ninguna sección mapea las pantallas, resources y dataProviders del backoffice Refine (apps/backoffice/app/components/AdminShell.tsx, routes.ts)
- CORE-361 · [no] ¿Qué perfiles de usuario existen (user_profile_id) y cuáles son staff?  
  hueco: No hay catálogo de user_profiles ni qué perfil es staff/asesor
