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

- [ ] Decidir el alcance: sólo marcar los campos con su clave del catálogo, o además un editor de formularios
  y un catálogo único. Termina con la decisión en la pila. Depende de: Miguel.
- [ ] Medir el mapeo actual: qué claves del catálogo de pdf-mapper llena `OnboardingPayloadBuilder`, de qué
  ids de campo y cuáles se calculan (nombres partidos, fechas, moneda, enums). Termina con la tabla en
  `artifacts/` y su comando.
- [ ] Comprobar si el catálogo de pdf-mapper-service (`/api/fields`) y los campos de form-service comparten
  algún identificador hoy. Termina con la respuesta medida en un ambiente.
- [x] ~~Medir qué aporta la caché Redis de form-service~~ — 2026-10-29: unas 10 lecturas de esquema por día,
  31 % de aciertos (TTL 10 min) y unas 3 lecturas de S3 ahorradas por día. No aporta con este volumen (pila).
- [ ] Proponerle a José quitar Redis de form-service, con esos números. Depende de: José.
- [ ] Coordinar con José (form-service) antes de proponer cambios de contrato, y avisarle al equipo de #105
  (pdf-mapper en backoffice) que el editor de formularios va como proyecto aparte, no en el backoffice.
  Depende de: José.

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
   `diff`, igual que la foto de CORE-918. Recién con el diff vacío se borra la tabla escrita a mano.
5. **Ideas más grandes, a evaluar después de 1 a 4:**
   - un editor de formularios dinámicos al estilo de PDF Mapper Studio, que use el mismo catálogo. **Decisión
     de Miguel (2026-10-29): un proyecto Vue aparte, como `pdf-mapper-editor`; no va en el backoffice por ahora.**
   - que pdf-mapper tome sus campos del diccionario de form-service, para que haya un solo catálogo;
   - quitar Redis de form-service si la medición confirma que no aporta: MySQL es la verdad y S3 ya es caché.

## Lo que se evaluó y NO se eligió

- **Seguir agregando ids a la tabla de `OnboardingPayloadBuilder` por cada formulario nuevo:** es lo de hoy.
  Escala mal (ids por ambiente, código por entidad) y el orden de respaldo no se ve.

## Lo que NO entra

- Cambiar las plantillas PDF ya publicadas.
- El trabajo de Finandina (#107) y CORE-918 (#109): esta tarea los habilita, no los bloquea.

## Cómo se comprueba — y el MATERIAL para volver a hacerlo

Pendiente: el payload viejo contra el nuevo para un conjunto de solicitudes, con su comando.

## Referencias

- Origen: idea de Miguel del 2026-10-29, al revisar cómo Credifamilia llena sus documentos.
- Relacionadas: #105 (pdf-mapper en backoffice, CORE-818), #107 (Finandina), #109 (CORE-918).
- Antecedente, sin validar: el prototipo de diccionario de Miguel, hoy en `~/Desktop/CREDITOP/temp`.
