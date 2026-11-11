# Campañas de WhatsApp del backoffice

Cómo se crea, se envía y se sigue una campaña de WhatsApp lanzada desde la sección Comunicaciones
del backoffice. Describe el módulo `CampaignV1` de `legacy-backend`, el envío de campañas de
`messaging-service` y el módulo `modules/backoffice/communications` de `frontend-monorepo` en las
refs de `sources.json`. Una campaña es una plantilla, un país y un CSV de teléfonos con las variables
de la plantilla. No cubre la difusión masiva de `BroadcastV1` ni el gateway que pone `x-user-id`. No
dice qué plantillas existen, si Temporal está prendido en un ambiente ni cuánto tarda un envío.

## La pantalla limpia el archivo y el servidor lo toma como viene

El asistente (`WhatsAppCampaignWizard`) sólo ofrece plantillas de `CO` y `DO`: `campaignTemplates`
descarta las de otros países que trae el listado. Una plantilla se identifica por nombre y país
(`templateKey`); la que viene con `enabled` en falso se muestra y no se puede elegir. Cada `{{n}}`
distinto del cuerpo es una columna del archivo, en orden numérico (`templateVariables`).

`reviewRecipients` revisa el CSV en el navegador. `parseCsv` parte por líneas y por comas, sin
comillas, y recorta cada celda. Si no hay encabezado o no hay filas, o si el encabezado no tiene
exactamente «variables + 1» columnas (cuenta la cantidad, no los nombres), no deja seguir. Después
`classify` excluye la fila, en este orden: con más celdas que el encabezado; con un celular que no
cumple `^\d{10}$` (`isNationalPhone`); con una variable vacía; con un celular ya visto en una fila
válida anterior. `cleanCsv` arma el archivo que se manda al crear con el encabezado y las filas
incluidas; `excludedCsv` es la descarga con el motivo de cada fila fuera.

El mensaje de prueba es un envío real: `testCsv` manda el encabezado y la primera fila incluida a
`POST …/templates/{templateName}/test` de `BroadcastV1`, al celular de diez dígitos que se escribe.

`CreateCampaignRequest::validate` no repite ninguna de esas reglas. Exige `x-user-id` entero
positivo, `name` de hasta 255 caracteres, `templateName` con `^[A-Za-z0-9_]+$`, `country` en
`SUPPORTED_COUNTRIES` (`CO`, `DO`) y `csv` como archivo `csv` o `txt`, no vacío, de hasta
`MAX_CSV_SIZE_KB` (1024). `CreateCampaignService::buildQueueBatch` toma cada fila de datos como
viene: no valida teléfonos, no deduplica y no comprueba que la plantilla exista para el país. El
encabezado fija cuántas variables hay: una fila corta viaja con menos y las celdas de más se cortan.
`CsvUtils::parse` sí respeta comillas, a diferencia del parser de la pantalla. Una campaña creada
sin pasar por la pantalla manda dos veces a un teléfono repetido y deja que cada número malo falle
en el envío.

Las rutas del backoffice en `frontend-monorepo` piden `campaign:view` para listar, ver el detalle y
leer el avance, y `campaign:create` para crear, probar e iniciar. En legacy-backend el grupo
`communications/whatsapp` de `Modules/Backoffice/routes/backoffice.php` sólo pide
`cognito.token:staff` y `ResolveBackofficeActor`.

## Crear y lanzar son dos pasos, y crear no es atómico ni idempotente

`LaunchCampaignUseCase` («Sí, iniciar envío») llama `createCampaign` y después `startCampaign`. Si
el arranque falla, devuelve el id con `started` en falso: la campaña queda creada sin lanzar y su
detalle ofrece «Iniciar envío» (`StartCampaignUseCase`).

`POST /api/v1/campaign` (`CreateCampaignService::createCampaignOrchestrator`) hace cinco escrituras
en orden (tres en la base, dos en S3), sin transacción ni compensación: inserta la fila en
`campaigns` (`create`: `name`, `template_name`, `created_by`); escribe el CSV original en
`raw-campaign-files/<id>.csv` (`createRawCampaignFile`) y guarda `raw_file_url` (`attachRawFile`);
escribe la cola en `campaign-queues/<id>.json` (`createCampaignQueue`) y guarda `queue_url`
(`attachQueue`). El `TECHNICAL_DEBT.md` del módulo dice cuatro y no coincide con el código. Los dos objetos van al bucket
compartido que eligen `RawCampaignFilesRepository` y `CampaignQueuesRepository` según
`app()->environment('production')`. Una falla a mitad contesta `CPV11002` y deja una campaña sin
una o las dos ubicaciones (`CPV1TD002`).

La cola es `{batch: [...]}` con un `CampaignQueueItemData` por fila de datos: `contentVariables`,
`recipients` (el teléfono), `template`, `country` y `status`, que nace en
`CampaignQueueItemStatus::PENDING`. El país no se guarda en `campaigns`: sólo viaja en cada ítem.

Crear no acepta llave de idempotencia (`GLOB007`): reintentar una creación que se cortó por tiempo
deja dos campañas, cada una con su archivo y su cola.

`POST /api/v1/campaign/{campaignId}/start` (`StartCampaignService`) no envía nada: llama
`MessagingClient::startCampaignSend`, que hace `POST /api/v1/campaigns/{campaignId}/start` en
messaging-service, y contesta 202 con `workflowId` y `runId` en cuanto ese servicio acepta.
`launched_by` se guarda con `updateLaunchedBy` sólo después de la aceptación; si se lanza otra vez
queda el último usuario. Si la base falla tras el 202, la API contesta `CPV15003` con la campaña ya
enviándose (`CPV1TD006`).

## messaging-service envía la cola de a un destinatario

`Starter::Start` ejecuta `SendCampaignWorkflow` en la task queue de
`temporal.workers.whatsapp_campaign_send.task_queue`. El workflow tiene una sola actividad,
`Activities::SendCampaign`, que corre `SendCampaignUseCase::Execute`: lee
`<campaign_queues_s3.prefix>/<id>.json`, recorre `batch` en orden y, por cada ítem en `pending`,
envía, decide el estado y reescribe la cola entera en S3 (`CampaignQueueRepository::Update`) antes
de pasar al siguiente. No hay paralelismo y el avance vive en la cola, no en el historial del
workflow.

Cada ítem sale por `SendMessageUseCase::Execute`, el mismo caso de uso de
`POST /api/v1/messages/send`, sólo por el canal `whatsapp`, con las variables posicionales
(`[a, b]` → `{"1": a, "2": b}`). Valen sus reglas: la plantilla se busca por nombre y país y, para
el proveedor real, tiene que estar habilitada y el teléfono tiene que ser un nacional válido para
el país. Con el modo QA prendido una plantilla terminada en `_qa` va al sink de pruebas en vez de
al proveedor (`QAConfig::EntregaReal`), y el sink acepta un teléfono inválido y una plantilla sin
configuración o deshabilitada; el país se sigue exigiendo.

Límites de la actividad: `StartToCloseTimeout` de 24 horas por intento (la corrida no tiene tope
propio), `HeartbeatTimeout` de 2 minutos con latido cada 15 segundos, y `RetryPolicy` de 5 intentos
en total con espera de 10 segundos a 5 minutos y coeficiente 2. Cada intento relee la cola y sigue
con lo que quedó en `pending`. `ErrCampaignQueueNotFound` y `ErrInvalidCampaignQueue` (cola
inexistente o con JSON ilegible) se devuelven como errores no reintentables. El envío de un ítem
tiene 30 segundos y la escritura de la cola otros 30.

## Relanzar sólo manda pendientes, salvo el ítem que no llegó a escribirse

El id del workflow es determinista: `campaign-send-<app.env>-<id>`, sin el segmento del ambiente si
`app.env` está vacío. El ambiente va en el id porque el namespace de Temporal es compartido y el id
de campaña sale de la base de cada ambiente. Con un envío abierto, otro arranque devuelve el `runId`
de la corrida abierta porque el SDK de Temporal absorbe el `WorkflowExecutionAlreadyStarted` (no se
fija `WorkflowExecutionErrorWhenAlreadyStarted`); la rama `errors.As` de `Starter::Start` no se
alcanza con esas opciones. Con el envío terminado arranca una corrida nueva. Como la
actividad salta lo que no está en `pending`, reintentar el lanzamiento no repite mensajes.

Un ítem en `not-successfully-sent` no se vuelve a enviar nunca: relanzar no lo toca. Reintentar los
fallidos pide otra campaña con esas filas.

El hueco de doble envío es un ítem enviado cuyo estado no llegó a la cola. `sendItem` y `saveQueue`
corren con `context.WithoutCancel`, así que un apagado ordenado del worker deja terminar el envío en
curso y su escritura, y el corte por `ctx` se revisa antes del ítem siguiente. Si la escritura falla
(`Execute` corta y devuelve el error) o el proceso muere entre el envío y la escritura, el ítem
sigue `pending` en S3 y el siguiente intento o relanzamiento lo vuelve a mandar.

## El estado de la campaña es una deducción sobre la cola

`campaigns` no guarda estado ni avance: sólo `launched_by`.
`GET /api/v1/campaign/{campaignId}/queue-detail` (`GetCampaignQueueDetailService`) lee la cola y
devuelve `total` y el conteo de los tres estados de `CampaignQueueItemStatus::ALL`, siempre los
tres: `pending`, `successfully-sent` y `not-successfully-sent`. Un estado desconocido en la cola
lanza excepción.

`successfully-sent` significa que `SendMessageUseCase::Execute` no devolvió error, o sea que el
proveedor —o el sink de QA— aceptó el mensaje; no hay acuse de entrega ni de lectura. `not-successfully-sent` junta
cualquier error: teléfono inválido, plantilla sin configuración o deshabilitada para el país,
rechazo o falla del proveedor. El motivo no se escribe en la cola: queda en el log
`campaign item not sent` de messaging-service, por índice del ítem.

El backoffice deduce el estado con `campaignStatus`: `launchedBy` nulo es `not_started` («Sin
iniciar»); lanzada con `pending > 0` es `sending` («Enviando»); lanzada sin pendientes es `finished`
(«Terminada»). `useLiveProgress` vuelve a leer sólo las campañas en `sending`, con la pestaña
visible. El detalle busca la plantilla sólo por nombre (`GetCampaignDetailUseCase`), así que con el
mismo nombre en dos países toma la primera.

Nadie consulta el workflow. Una corrida que agotó sus cinco intentos o dio con un error no
reintentable deja ítems en `pending` y la campaña se ve «Enviando» sin límite. Lanzarla otra vez
por API arranca una corrida nueva desde los pendientes (`StartCampaignService` no mira
`launchedBy`), pero la pantalla sólo ofrece «Iniciar envío» con `launchedBy` nulo: una campaña
trabada en «Enviando» no se relanza desde la pantalla.

## Qué frena el lanzamiento

`StartCampaignService::startCampaignOrchestrator` corta antes de llamar a messaging-service si la
campaña no existe (`CPV15002`) o si `queueUrl` es nulo (`CPV15004`), que es el resto de una creación
cortada antes de `attachQueue`. Esa campaña no se puede lanzar; para el avance, el BFF traduce
`CPV13004` a `EMPTY_QUEUE` y la muestra sin ítems.

En messaging-service, `campaignSendOptions` carga `campaignsend.DisabledModule` cuando
`temporal.enabled` es falso: `DisabledStarter::Start` devuelve `ErrCampaignSendUnavailable` y la API
contesta 503. Un id no positivo contesta 400 y cualquier otro error del arranque, 500.

`MessagingClient::startCampaignSend` trata como falla todo lo que no sea un 202 con un objeto JSON,
igual que no alcanzar el servicio, y `StartCampaignService` contesta `CPV15003`. En ninguno de estos
casos se escribe `launched_by`: la campaña sigue «Sin iniciar» y se puede reintentar.

messaging-service no lee la cola al aceptar el arranque (`StartCampaignSendUseCase` sólo valida el
id). Una cola que existe en la base pero no en el bucket que lee messaging-service se acepta con 202
y falla después dentro del workflow, sin reintentos y con la campaña ya marcada como lanzada.

## Qué queda en los logs

En `legacy-backend`, `createCampaignOrchestrator` registra `Command data.` con
`CreateCampaignCommand::toArray()`, que incluye `csv`: el archivo completo, con cada teléfono y cada
variable, en claro; `TECHNICAL_DEBT.md` lo registra como `CPV1TD001`, abierta a propósito, y dice que
el mismo `payload` va en los atributos del span. El CSV entero queda también en el log debug
`Starting …` de `TracingUtils::run`, que recibe `payload => $command->toArray()`. El controlador y la fachada registran `$request->all()`, que lleva el objeto del archivo
subido y no su contenido. Los repositorios de S3 registran sólo id de campaña, bucket, key y tamaño.

En messaging-service, `SendCampaignUseCase` registra por ítem el id de campaña, el índice, la
plantilla y el país, sin teléfono ni variables, y `CampaignQueueRepository` sólo bucket, key y
tamaño. El teléfono sí queda en claro por el camino común de envío: `TwilioClient` registra
`phone_number` al empezar cada WhatsApp, al aceptarse y en cada falla, y `SendMessageUseCase` lo registra al
rechazar un número inválido y en los avisos del modo QA. Las variables de la plantilla no se
registran en ese camino.
