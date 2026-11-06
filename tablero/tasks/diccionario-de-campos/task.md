---
id: 110
title: "Diccionario de campos compartido entre formularios y documentos"
stage: evaluation
created: "2026-10-29T18:30:00-05:00"
knowledge: [dynamic-form-schema]
canon: []
jira: []
jira_title: ""
---

## Pendientes

- [ ] Presentarle a Oscar la propuesta (`artifacts/propuesta-diccionario-de-campos.html`): un solo id de campo
  entre formulario dinámico y PDF, y quitar Redis y S3 de form-service. Termina con su decisión en la pila.
  Depende de: Oscar.
- [ ] Medir el mapeo actual: qué claves del catálogo de pdf-mapper llena `OnboardingPayloadBuilder`, de qué
  ids de campo y cuáles se calculan (nombres partidos, fechas, moneda, enums). Termina con la tabla en
  `artifacts/` y su comando.
- [ ] Comprobar si el catálogo de pdf-mapper-service (`/api/fields`) y los campos de form-service comparten
  algún identificador hoy. Termina con la respuesta medida en un ambiente.
- [x] ~~Medir qué aporta la caché Redis de form-service~~ — 2026-10-29: unas 10 lecturas de esquema por día,
  31 % de aciertos (TTL 10 min) y unas 3 lecturas de S3 ahorradas por día. No aporta con este volumen (pila).
- [x] ~~Medir el uso de las cachés de form-service~~ — el árbol de países se escribe 70 veces por semana en
  Redis y en S3 y no se lee nunca; el esquema acierta 31 % (pila).
- [ ] Avisarle al equipo de #105 (pdf-mapper en backoffice) que el editor de formularios va como proyecto
  aparte, no en el backoffice.

## Objetivo

Que un dato tenga UN nombre en todo el camino: el campo del formulario dinámico que lo pide, el hueco del
PDF que lo muestra y, si aplica, el campo de la radicación. Hoy esa relación vive escrita a mano en código y
atada a ids que cambian por ambiente. Con un diccionario compartido, un formulario nuevo (el de Finandina,
por ejemplo) llenaría sus documentos sin código: alcanza con marcar cada campo con su clave.

## Dónde se toca

- **legacy-backend · `Modules/Loans/App/Services/DocumentGeneration/Payload/OnboardingPayloadBuilder.php`**:
  arma los datos de los PDF. Por cada clave del catálogo lista los ids de campo del formulario a leer, en orden
  de respaldo (`address` ← 186, 175, 44; `city` ← 185, 174, 10, 162, 93). En `qa` son 41 lecturas sobre
  68 ids distintos. Medido el 2026-10-29: en la base local los ids 175 y 174 no existen.
- **form-service**, de José: arma el esquema del formulario desde las tablas `form_types`, `forms`, `fields`,
  `field_options` y `field_categories`, y guarda respuestas en `user_field_values`. Lectura cache-aside:
  Redis, después S3 y después reconstrucción desde MySQL (`knowledge/dynamic-form-schema`).
- **pdf-mapper-service y pdf-mapper-editor (PDF Mapper Studio)**: plantillas y mapas en S3, con un catálogo de
  campos (`/api/fields`). Según una nota de julio, sin verificar hoy: unos 128 campos y catálogo sólo de altas.
- **Radicación de Credifamilia (`TransactionRequest`)**: también lee ids a mano, por ejemplo la ocupación del
  campo 29.

## Cómo se ataca

1. **Marcar los campos.** Una columna `document_key` en `fields` con la clave del catálogo de pdf-mapper. Se
   carga por nombre de campo, no por id, en cada ambiente.
2. **Armar por clave.** `OnboardingPayloadBuilder` lee «la respuesta del campo marcado con `address`». La regla
   de precedencia es explícita: primero el formulario de la entidad de la solicitud, después la respuesta más
   reciente. Las transformaciones (nombres, fechas, moneda, enums) siguen en código, pero atadas a la clave.
3. **Chequeo cruzado.** Una verificación que avise si una clave marcada no existe en el catálogo, o si una
   clave que una plantilla usa no tiene campo que la llene.
4. **Migrar sin romper.** Generar el payload viejo y el nuevo para varias solicitudes reales y comparar con
   `diff`, igual que la foto de CORE-918 (`tablero/tasks/originacion-delegada-generica`, «Cómo se comprueba»).
   Recién con el diff vacío se borra la tabla escrita a mano. Falta fijar el ambiente y qué solicitudes (una
   consulta que las elija, de varias entidades y formularios): los payloads llevan datos de clientes, así que
   no salen del ambiente donde se generan.
5. **Desacoplar form-service (propuesta del 2026-10-30).** Hoy el asistente va a form-service, que lee y
   escribe la base de legacy (`legacy_mysql`, `creditop`): un camino circular. Destino:
   - legacy-backend entrega el formulario publicado al asistente y guarda las respuestas (en su base, como hoy);
   - form-service pasa a ser el catálogo: ver, editar y publicar formularios por entidad, como JSON versionado
     en S3 (fuente de verdad, no caché), con un índice de versión vigente. Sin Redis ni tablas propias;
   - un editor en Vue, como proyecto aparte al estilo de PDF Mapper Studio (no en el backoffice);
   - cada campo del JSON lleva su `document_key`, validada contra el catálogo de pdf-mapper al publicar;
   - cada respuesta registra el formulario y la versión que contestó.

   ⚠ **Lo que este destino rompe si no se resuelve antes.** Hoy quien escribe las respuestas en
   `user_field_values` es form-service (en la base de legacy, además de una copia en S3), y legacy-backend **no
   lee esas filas**: las pide a form-service con `FormServiceClient::answers`, que lee Redis y S3. Lo usa el checkout
   vehicular de BCP (`app/Actions/Lenders/Bcp/BcpVehicular.php:213`, verificado en `main`). Application, en cambio,
   lee las filas directo (`knowledge/dynamic-form-schema`). Antes de quitar Redis y S3 de form-service hay que
   decidir:
   - con qué se reemplaza `FormServiceClient::answers` en BCP (leer `user_field_values` en legacy-backend, y con qué
     regla: la de application toma la fila de id mayor por campo y no filtra por titular);
   - quién escribe las respuestas durante la transición, para no tener dos escritores sobre la misma tabla
     (legacy-backend ya escribe las del form 1 desde el onboarding, y el DELETE de form-service las alcanza).
   Mongo no: S3 alcanza con este volumen y sigue el patrón de pdf-mapper. Se reconsidera si el editor necesita
   consultas que S3 no resuelve.

## Lo que se evaluó y NO se eligió

- **Seguir agregando ids a la tabla de `OnboardingPayloadBuilder` por cada formulario nuevo:** es lo de hoy.
  Escala mal (ids por ambiente, código por entidad) y el orden de respaldo no se ve.
- **Mover definición y respuestas a un servicio propio con Mongo:** las respuestas son datos del crédito que
  leen documentos, radicación y evaluación; sacarlas de la base de legacy crea dos fuentes de verdad y llamadas
  de red por cada lectura. Sólo la definición se va al catálogo.

## Lo que NO entra

- Cambiar las plantillas PDF ya publicadas.
- El trabajo de Finandina (#107) y CORE-918 (#109): esta tarea los habilita, no los bloquea.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Pendiente: el payload viejo contra el nuevo para un conjunto de solicitudes, con su comando.

## Referencias

- Origen: idea de Miguel del 2026-10-29, al revisar cómo Credifamilia llena sus documentos.
- Relacionadas: #105 (pdf-mapper en backoffice, CORE-818), #107 (Finandina), #109 (CORE-918).
- Antecedente, sin validar: el prototipo de diccionario de Miguel, hoy en `~/Desktop/CREDITOP/temp`.
